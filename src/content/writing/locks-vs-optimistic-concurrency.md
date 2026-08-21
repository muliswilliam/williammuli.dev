---
title: "Pessimistic vs Optimistic Concurrency in Postgres"
description: "A seat reservation race solved with PostgreSQL row locks and conditional updates, using TypeScript and Drizzle ORM."
date: 2026-08-20
tags: [postgresql, concurrency, row-locks, optimistic-concurrency]
---

## Introduction

When two requests try to change the same PostgreSQL row, individually correct queries can combine into an incorrect result. This article compares two ways to prevent that: pessimistic concurrency with `SELECT FOR UPDATE` and optimistic concurrency with a conditional `UPDATE`.

Both techniques can protect the same business invariant, but they handle competition differently. A row lock makes one request wait before it decides. A conditional write lets both requests attempt the change, then reports which one lost. That difference affects transaction design, latency under contention, failure handling, and retry behavior.

We will build both solutions around a seat-reservation race using PostgreSQL, TypeScript, and Drizzle ORM. Along the way, we will cover transaction boundaries, version-based checks, lock duration, deadlocks, timeouts, and idempotent retries, then finish with a practical guide for choosing between the two approaches.

Here is the race. Two customers click **Reserve** for seat A12 at almost the same time. Both requests return success.

The database tells a different story. It contains one seat and one winner. If Bob's update runs last, the row says the seat belongs to Bob. Alice still has a confirmation for a reservation that no longer exists.

The bug appears only when two executions of this code interleave:

```ts
const seat = await db.query.seats.findFirst({
  where: eq(seats.id, seatId),
});

if (!seat) {
  throw new Error("Seat not found");
}

if (seat.status !== "available") {
  throw new Error("Seat is unavailable");
}

await db
  .update(seats)
  .set({
    status: "reserved",
    reservedBy: userId,
  })
  .where(eq(seats.id, seatId));
```

Each request follows three steps:

1. Read the seat.
2. Check that it is available.
3. Reserve it.

The code fails because the decision and the write are separate. Both requests can read `available`, both can pass the check, and both can report success. The second update quietly replaces the first customer's `reservedBy` value.

The fix must preserve the reservation rule regardless of how concurrent requests are ordered.

## The race condition: two requests reserve one seat

The examples use this `seats` table:

```ts
export const seatStatus = pgEnum("seat_status", [
  "available",
  "reserved",
  "sold",
]);

export const seats = pgTable("seats", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  number: varchar("number", { length: 20 }).notNull(),
  status: seatStatus("status").default("available").notNull(),
  reservedBy: bigint("reserved_by", { mode: "number" }),
  version: integer("version").default(1).notNull(),
});
```

The relevant state transition is:

```text
AVAILABLE -> RESERVED
```

For any seat, only one request may complete that transition successfully.

The original code checks the invariant before the update, leaving a window in which Alice and Bob can interleave like this:

![Sequence diagram of Alice and Bob both reading seat A12 as available, then both updating it, with Bob's update silently overwriting Alice's reservation](/writing/locks-vs-optimistic-concurrency-race.svg)

Each request acts on a result that was true when it was read. Both queries complete successfully, and the second update overwrites the first reservation.

The reservation operation therefore needs concurrency control that allows only one request to complete the state transition.

## Solution 1: lock the seat row with `SELECT FOR UPDATE`

### Lock and update in the same transaction

`SELECT FOR UPDATE` reads a row and acquires a row-level lock for the transaction that intends to change it.

```sql
BEGIN;

SELECT id, status
FROM seats
WHERE id = 123
FOR UPDATE;

UPDATE seats
SET
    status = 'reserved',
    reserved_by = 42
WHERE id = 123;

COMMIT;
```

PostgreSQL holds the lock until the transaction commits or rolls back. A conflicting update, delete, or locking read on that row must wait.

The transaction boundary is part of the solution. The lock must cover the read, the decision, and the write:

```ts
await db.transaction(async (tx) => {
  const result = await tx.execute<{
    id: number;
    status: "available" | "reserved" | "sold";
  }>(sql`
    SELECT id, status
    FROM seats
    WHERE id = ${seatId}
    FOR UPDATE
  `);

  const seat = result.rows[0];

  if (!seat) {
    throw new Error("Seat not found");
  }

  if (seat.status !== "available") {
    throw new Error("Seat is unavailable");
  }

  await tx
    .update(seats)
    .set({
      status: "reserved",
      reservedBy: userId,
    })
    .where(eq(seats.id, seatId));
});
```

A locking read outside a transaction is ineffective for this workflow. In autocommit mode, the statement ends immediately, so PostgreSQL releases the lock before the later update runs.

### A competing request waits for the row lock

With the lock in place, the race becomes an ordered sequence:

![Sequence diagram of Alice locking seat A12, Bob blocking on the same lock until Alice commits, then Bob's resumed read returning RESERVED and rolling back](/writing/locks-vs-optimistic-concurrency-wait.svg)

Bob's locking read resumes after Alice commits and returns the new value, so his reservation attempt stops.

This is pessimistic concurrency control: coordinate before making the change. It fits operations that must read stable state and perform several related database actions, such as validating a balance, inserting a ledger entry, and updating the account.

### Keep lock-holding transactions short

A lock-holding transaction should follow this sequence:

1. Begin the transaction.
2. Lock the row.
3. Read and validate the current state.
4. Perform the related database writes.
5. Commit the transaction.

Keep payment calls, email, user input, and expensive computation outside the transaction. Those operations extend the lock duration and force conflicting requests to wait.

Set an explicit wait policy. `FOR UPDATE NOWAIT` fails immediately when the row is locked, while a bounded `lock_timeout` limits how long the statement may wait. The application can translate either failure into a retry, a conflict response, or a queued operation.

## Solution 2: enforce availability in the `UPDATE`

### Check availability in the write

The seat transition fits in one statement:

```sql
UPDATE seats
SET
    status = 'reserved',
    reserved_by = 42
WHERE id = 123
  AND status = 'available'
RETURNING *;
```

The condition is evaluated as part of the write, so PostgreSQL reserves the seat only if it is still available at update time.

The Drizzle version is just as direct:

```ts
const [reservedSeat] = await db
  .update(seats)
  .set({
    status: "reserved",
    reservedBy: userId,
  })
  .where(
    and(
      eq(seats.id, seatId),
      eq(seats.status, "available"),
    ),
  )
  .returning();

if (!reservedSeat) {
  throw new Error("Seat is no longer available");
}
```

The status check and state change execute in one statement. One request updates the row and receives it through `RETURNING`. The other request matches zero rows:

![Sequence diagram of Alice and Bob both sending a conditional UPDATE on seat A12, where only Alice's request matches and returns a row while Bob's returns zero rows](/writing/locks-vs-optimistic-concurrency-conditional.svg)

Zero returned rows indicates that the precondition no longer holds. The application can return an HTTP `409 Conflict`, show that the seat was just taken, or offer another seat.

The caller must inspect the affected-row count or returned rows to determine whether the update succeeded.

### Use version checks to detect intervening updates

The seat update names the exact business condition:

```sql
WHERE id = 123
  AND status = 'available'
```

Sometimes the requirement is broader: reject the write if anything changed after the row was read. Add a version column and include the observed version in the update:

```sql
UPDATE seats
SET
    status = 'reserved',
    reserved_by = 42,
    version = version + 1
WHERE id = 123
  AND version = 7
RETURNING *;
```

In Drizzle:

```ts
const [updatedSeat] = await db
  .update(seats)
  .set({
    status: "reserved",
    reservedBy: userId,
    version: sql`${seats.version} + 1`,
  })
  .where(
    and(
      eq(seats.id, seatId),
      eq(seats.version, expectedVersion),
    ),
  )
  .returning();

if (!updatedSeat) {
  throw new ConcurrencyConflictError();
}
```

A status condition validates a specific state transition. A version condition detects any versioned change made after the row was read.

They protect different assumptions. The status condition enforces the allowed transition, while the version condition detects other versioned changes. Use the condition the operation depends on, or combine both conditions when both assumptions matter.

Version checks are useful when time passes between reading and writing, such as editing a form. Holding a database lock during that time would waste a connection and block unrelated work.

## Compare both approaches under contention

The practical difference appears in the losing request:

| Question | `SELECT FOR UPDATE` | Conditional write |
| --- | --- | --- |
| When is conflict handled? | Before the decision | At the attempted write |
| What does the competing request do? | Waits, or fails to acquire the lock | Completes with zero matching rows |
| Typical database work | Locking read plus one or more writes | One write, unless related changes need a transaction |
| Best fit | Short, multi-step database decisions | State transitions with a clear precondition |
| Long gap between read and write | Poor fit | Good fit with a version check |

### Conditional writes still use row locks

PostgreSQL coordinates conditional updates with row locks. If one transaction has updated A12 but has not committed, another conditional update may wait for that transaction to finish before PostgreSQL can decide whether its `WHERE` clause still matches.

The difference is ownership at the application level:

- `SELECT FOR UPDATE` deliberately holds a lock across a read-decide-write sequence.
- A conditional write asks PostgreSQL to validate the assumption at write time.

### Contention remains on a hot row

A frequently updated row remains a hot spot under either approach. Ten thousand users reserving ten thousand different seats produce little conflict. Ten thousand users reserving one remaining seat produce one winner and many losers. Locking changes how the losers queue. A conditional write changes how they discover the loss.

## Transactions, failure handling, and safe retries

### Use a transaction for related writes

A single conditional update is enough only when the complete business operation fits in that statement. A reservation often requires two writes:

1. Mark the seat as reserved.
2. Insert the reservation record.

Those changes must succeed or fail together:

```ts
await db.transaction(async (tx) => {
  const [seat] = await tx
    .update(seats)
    .set({
      status: "reserved",
      reservedBy: userId,
    })
    .where(
      and(
        eq(seats.id, seatId),
        eq(seats.status, "available"),
      ),
    )
    .returning();

  if (!seat) {
    throw new Error("Seat is no longer available");
  }

  await tx.insert(reservations).values({
    seatId,
    userId,
    expiresAt,
  });
});
```

The condition and the transaction provide different guarantees:

- The condition allows only an available seat to become reserved.
- The transaction makes the seat update and reservation insert atomic.

### Handle concurrency failures explicitly

A production implementation should define behavior for each concurrency outcome:

- zero rows from a conditional write;
- lock acquisition failure or timeout;
- deadlock detection;
- transaction rollback;
- a client retry after the server committed but the response was lost.

### Retry the complete transaction

Restart the complete transaction from a fresh read on each retry. Re-evaluate the business decision, and use bounded retries with backoff to control load under heavy contention.

### Make retries idempotent

Retries also need idempotency. If an attempt can charge a card, publish a message, or call another service, repeating it blindly may duplicate the side effect. Keep external I/O outside the locked transaction where possible, and use an idempotency key or durable workflow when the operation crosses system boundaries.

When several rows must be locked, acquire them in a consistent order. PostgreSQL can detect and break a deadlock by aborting one transaction, but consistent ordering prevents many deadlocks before they occur.

## Choose based on the operation and conflict behavior

Start with the invariant, then ask what the losing request should do.

### Choose `SELECT FOR UPDATE` when

- the decision requires several reads or writes based on stable database state;
- the critical section is short and entirely database-bound;
- waiting briefly is preferable to rebuilding and retrying the operation;
- the application has an explicit timeout and deadlock policy.

### Choose a conditional write when

- the change can be guarded by a precise `WHERE` condition;
- the caller should receive a clear conflict result when the assumption is stale;
- conflicts are uncommon or failed contenders have no useful work left;
- meaningful time passes between reading and writing.

Use a transaction with either approach when several database changes must commit atomically.

The two techniques can also coexist. A workflow may lock one aggregate while using a unique constraint or conditional update to protect another invariant. Choose each mechanism according to the invariant PostgreSQL must enforce.

## Implementation checklist

1. Write the invariant before choosing the mechanism.
2. Keep a business precondition and its write together in one statement or protected transaction.
3. Use `SELECT FOR UPDATE` for short, multi-step decisions that need stable rows.
4. Use conditional writes for state transitions that fit in a `WHERE` clause.
5. Map zero affected rows to a domain conflict.
6. Keep network calls and user think time outside locked transactions.
7. Combine concurrency control with transactions when related writes must be atomic.
8. Design timeouts, deadlock handling, idempotency, and bounded retries as part of the operation.

For seat A12, both solutions preserve the rule that only one reservation may succeed. The deciding factor is the behavior you want under conflict: make the competitor wait before deciding, or let it attempt the transition and report that the precondition was lost.
