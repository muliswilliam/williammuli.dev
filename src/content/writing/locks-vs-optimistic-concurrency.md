---
title: "SELECT FOR UPDATE vs Conditional Writes: Two Ways to Solve the Same Race Condition"
description: "A seat reservation race solved with PostgreSQL row locks and conditional updates, using TypeScript and Drizzle ORM."
date: 2026-08-20
heroImage: /writing/locks-vs-optimistic-concurrency-hero.jpg
tags: [postgresql, concurrency, row-locks, optimistic-concurrency]
---

Two customers click **Reserve** for seat A12 at almost the same time.

The application handling each request runs the same code:

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

Read the seat. Check that it is available. Reserve it.

## Introduction

Every statement is valid. The logic looks correct. It may also pass every test that sends one request at a time. The bug only appears when two requests make a decision from the same state before either has finished changing it.

That makes concurrency bugs unusually deceptive. Nothing has to crash, time out, or return a database error. Each request can complete successfully while the combined result violates a business rule. The failure lives in the timing between otherwise reasonable operations.

PostgreSQL gives us several tools for handling that race. Two particularly useful options are pessimistic locking with `SELECT FOR UPDATE` and optimistic concurrency with a conditional write.

They can protect the same business invariant, but they make competing requests behave differently.

`SELECT FOR UPDATE` says:

> I am working with this row. Other conflicting operations need to wait.

A conditional write says:

> Everyone can try, but the database should only accept a write if its assumptions are still true.

The distinction is not simply about syntax. It determines whether a competing request waits, fails, retries, or discovers that it lost through an affected-row count. Those outcomes shape latency, error handling, transaction design, and how the system behaves when one resource becomes heavily contested.

This article builds the race, fixes it both ways, and compares what each fix means under contention. We will also look at version-based optimistic concurrency, why conditional writes do not replace transactions, and how to choose the mechanism that matches the invariant being protected.

The application snippets use **TypeScript with Drizzle ORM and PostgreSQL**. I will also show the underlying SQL because concurrency is one of those areas where the database behavior matters more than the abstraction used to call it.

## Our example: reserving a seat

The ticketing system has a `seats` table with three possible states:

```ts
export const seatStatus = pgEnum("seat_status", [
  "available",
  "reserved",
  "sold",
]);

export const seats = pgTable("seats", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  publicId: uuid("public_id").defaultRandom().notNull().unique(),
  number: varchar("number", { length: 20 }).notNull(),
  status: seatStatus("status").default("available").notNull(),
  reservedBy: bigint("reserved_by", { mode: "number" }),
  version: integer("version").default(1).notNull(),
});
```

The state transition we care about is small:

```text
AVAILABLE -> RESERVED
```

The business rule is stronger than that diagram looks:

> At most one customer may successfully reserve a seat.

The first implementation checks this rule in application code. That is where the gap opens.

## The race condition

Imagine Alice and Bob both attempt to reserve A12. Their requests can interleave like this:

```text
Alice                          Bob

SELECT seat A12
-> AVAILABLE

                               SELECT seat A12
                               -> AVAILABLE

UPDATE A12
-> RESERVED by Alice

                               UPDATE A12
                               -> RESERVED by Bob
```

Alice asks whether A12 is available. PostgreSQL says yes.

Bob asks the same question before Alice's change becomes visible to him. PostgreSQL also says yes.

Both requests then act on answers that were accurate when they were read. Alice can receive a successful response even if Bob's later update replaces `reservedBy`. No individual query needs to fail for the business operation to be wrong.

The read is not the thing we need to protect. The invariant is.

The application currently performs two separate actions:

```text
check the condition

then

act on the condition
```

Nothing guarantees the condition remains true between those actions. This is a time-of-check to time-of-use race.

We need to remove that gap, either by preventing a competing transaction from changing the row while we work or by making the write itself enforce the condition.

## Approach 1: `SELECT FOR UPDATE`

A normal `SELECT` reads a row. `SELECT FOR UPDATE` reads it and acquires a row-level lock because the transaction intends to change it.

The SQL looks like this:

```sql
BEGIN;

SELECT *
FROM seats
WHERE id = 123
FOR UPDATE;

-- verify that the seat is available

UPDATE seats
SET
    status = 'reserved',
    reserved_by = 42
WHERE id = 123;

COMMIT;
```

PostgreSQL holds the row lock until the transaction commits or rolls back. A conflicting update, delete, or locking read on the same row must wait for that transaction to finish.

With Drizzle, the same operation can keep the locking query explicit:

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

The transaction boundary is part of the solution. A `SELECT FOR UPDATE` outside a transaction, or inside a transaction that ends before the related update, does not protect the decision. The lock must remain held while the application validates the row and performs the change.

## What happens to the competing request?

Replay the same race with the locking read:

```text
Alice                          Bob

BEGIN

SELECT A12 FOR UPDATE
-> AVAILABLE
-> lock acquired

                               BEGIN

                               SELECT A12 FOR UPDATE
                               -> waits...

UPDATE A12
-> RESERVED by Alice

COMMIT
-> lock released

                               SELECT returns
                               -> RESERVED

                               cannot reserve

                               ROLLBACK
```

Alice reaches the row first and acquires the lock. Bob does not get to read the same row for update and independently decide that it is available. His query waits.

When Alice commits, Bob's query continues. It now sees `reserved`, so the application rejects his attempt.

The database has turned two concurrent decisions into an ordered sequence. Only one transaction gets to make the decision from the locked state at a time.

## Why this is pessimistic concurrency control

Pessimistic concurrency assumes another operation may conflict, so it coordinates access before doing the work:

```text
acquire lock
-> inspect state
-> perform related writes
-> commit
-> release lock
```

That model is useful when the operation requires several related database steps based on a stable row.

Consider a withdrawal workflow:

```text
lock account
-> read balance
-> validate withdrawal
-> insert ledger entry
-> update balance
-> commit
```

The decision cannot be expressed as one simple state transition. The transaction needs to read a value, calculate from it, write a related record, and update the original row. Locking the account gives that critical section a clear owner.

The cost is waiting. While one transaction holds the lock, conflicting transactions cannot proceed.

## Keep locked transactions short

This is a dangerous transaction:

```text
BEGIN

SELECT seat FOR UPDATE

call payment provider

send confirmation email

perform expensive computation

UPDATE seat

COMMIT
```

The lock now lives for the duration of network calls and unrelated work.

The payment provider may respond in 100 milliseconds. It may take five seconds. It may time out after thirty. During that time, every transaction that needs a conflicting lock on the seat waits behind it while also occupying application and database resources.

Keep transactions that hold locks as short as the invariant allows. Do the database work that needs atomicity, commit, then perform unrelated I/O outside the critical section. If the business process spans a long time, model that time explicitly with states such as `reserved` and `reservation_expires_at` instead of holding a database transaction open.

Waiting also needs a policy. PostgreSQL supports `NOWAIT` when the caller should fail immediately rather than queue:

```sql
SELECT *
FROM seats
WHERE id = 123
FOR UPDATE NOWAIT;
```

Another option is a bounded `lock_timeout`. Both turn an indefinite wait into an application-visible failure that can become a retry, a conflict response, or a queued job. The important part is deciding what waiting means for the user instead of accepting an unbounded default accidentally.

## Approach 2: conditional writes

The original implementation is dangerous because the availability check happens separately from the write:

```text
SELECT seat

if seat.status == AVAILABLE

    UPDATE seat
```

We can move the condition into the update itself:

```sql
UPDATE seats
SET
    status = 'reserved',
    reserved_by = 42
WHERE id = 123
  AND status = 'available'
RETURNING *;
```

This statement does not say, "I saw an available seat earlier, so update it now."

It says:

> Reserve this seat only if it is still available when PostgreSQL performs the update.

The Drizzle version is direct:

```ts
const reserved = await db
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

if (reserved.length === 0) {
  throw new Error("Seat is no longer available");
}
```

There is no application-level interval between checking the state and changing it. PostgreSQL evaluates the `WHERE` condition as part of the write. The returned rows tell the application whether the state transition happened.

## Alice and Bob try again

Both requests now submit the same conditional update:

```text
Alice                          Bob

UPDATE A12
WHERE status = AVAILABLE

                               UPDATE A12
                               WHERE status = AVAILABLE

-> 1 row updated

                               -> 0 rows updated
```

Alice changes the row first. When Bob's statement can evaluate the row, `status = 'available'` is no longer true. His update matches zero rows.

Zero rows is not a database error. It is the result the application needs:

> The precondition for this operation no longer holds.

The application can turn that outcome into an HTTP `409 Conflict`, a domain-specific error, or a message such as "This seat was just reserved by someone else."

Only one caller can observe a returned row and report a successful reservation. The invariant now lives in the statement that changes the data.

## Why this is optimistic concurrency control

Optimistic concurrency does not reserve exclusive access before the application attempts its change. It lets concurrent operations compete, then detects which operation was based on stale assumptions.

```text
attempt conditional work
-> inspect result
-> succeed or report conflict
```

This is optimistic because the common path assumes there will be no conflict. Most requests can complete without the application opening a transaction, locking a row, reading it, and then issuing a second statement.

The database still coordinates concurrent writes internally. A conditional update does not make row-level contention disappear. The architectural difference is that the application does not deliberately hold a lock across a read-decide-write sequence. It asks PostgreSQL to make the decision and the change in one operation.

## Version-based optimistic concurrency

A status check protects one specific transition. Sometimes we need to detect any change made since an object was read.

Suppose the application reads this row:

```text
id       123
status   available
version  7
```

It later updates the row with the version it observed:

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

If nobody changed the row, version `7` still matches and the update succeeds. If another request changed it first, the stored version is now `8`, the condition matches nothing, and zero rows are returned.

In Drizzle:

```ts
const updated = await db
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

if (updated.length === 0) {
  throw new ConcurrencyConflictError();
}
```

The status-based update asks whether one business condition still holds:

```text
Is this seat still available?
```

The version-based update asks a broader question:

```text
Has this row changed since I read it?
```

Version checks are useful for forms, documents, account settings, and other objects that may be read, edited for some time, and written later. Holding a database lock while a person edits a form would be a poor design. Sending the version with the eventual update lets the server reject a stale save without holding a connection open during that think time.

The application must still decide what a version conflict means. It may ask the user to reload, merge non-overlapping changes, or re-read and retry. Retrying blindly is only safe when repeating the business operation cannot duplicate an external side effect or produce a different unintended decision.

## Status checks and version checks protect different things

The two conditional-write forms are related, but they are not interchangeable.

This update:

```sql
UPDATE seats
SET status = 'reserved'
WHERE id = 123
  AND status = 'available';
```

protects the `AVAILABLE -> RESERVED` transition. It does not detect an unrelated change to a column such as `notes` if the seat remains available.

This update:

```sql
UPDATE seats
SET status = 'reserved', version = version + 1
WHERE id = 123
  AND version = 7;
```

detects any update that follows the same versioning discipline. It does not, by itself, express that only available seats may be reserved. A caller with the current version could still move a sold seat back to reserved unless the application, statement, or database also enforces the allowed state transition.

The condition should name the assumption the business operation actually depends on. Sometimes that is a domain state, sometimes it is a version, and sometimes both belong in the `WHERE` clause.

## Waiting versus failing

The easiest way to remember the practical difference is to look at the losing request.

With pessimistic locking:

```text
Request A -> gets the lock
Request B -> waits
```

With optimistic concurrency:

```text
Request A -> succeeds
Request B -> attempts the conditional update
Request B -> receives a conflict result
```

For two people competing for one seat, either model can produce a correct result.

Now imagine 20,000 people trying to buy the final ticket for a major concert. Queuing thousands of transactions behind a row lock is unlikely to help. Once the first reservation succeeds, the waiters have no useful work left to perform. A conditional update lets each losing request discover that the required state no longer exists and return a conflict.

There are workloads where waiting is the better tradeoff. If a short operation performs several database steps and conflicts are common, letting one transaction finish while another waits can be simpler and cheaper than repeatedly aborting, rebuilding state, and retrying the entire operation.

The choice is not "locks are slow" versus "optimistic updates are fast." It is a choice about what the system should make competing work do.

## Contention does not disappear

Consider two workloads:

```text
10,000 users
10,000 different seats
```

and:

```text
10,000 users
1 remaining seat
```

In the first workload, conflicts are rare. Optimistic concurrency is a natural fit because nearly every operation can succeed on its first attempt.

In the second workload, contention is unavoidable. With a conditional write, many operations lose. With pessimistic locking, many operations wait or fail to acquire a lock. Neither mechanism removes the fact that thousands of callers want one resource.

They determine:

- who waits;
- who fails;
- who retries;
- how quickly a losing request learns the result;
- how much work happens inside the critical section;
- which invariant remains true regardless of timing.

Those are application and product decisions as much as database decisions. A background worker may be happy to wait or retry. A person clicking a button may need a quick conflict response. A payment flow may require an idempotency key before any retry is safe.

## Conditional writes do not replace transactions

A single conditional update is enough when the invariant and the operation fit in that one statement. Real reservation flows often need another write:

```text
update the seat

insert a reservation record
```

Those changes should succeed or fail together. We can combine a conditional write with a transaction:

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

Two guarantees now work together.

The conditional write protects:

> Only an available seat may transition to reserved.

The transaction protects:

> The seat update and reservation record either both happen or neither happens.

Transactions provide atomicity across the related writes. The condition provides concurrency control for the state transition. They solve different parts of the operation.

## When `SELECT FOR UPDATE` is the better fit

Use `SELECT FOR UPDATE` when the operation needs to:

1. read current state;
2. make a decision from that state;
3. perform multiple related database operations;
4. prevent a conflicting modification during that short critical section.

It is particularly useful when contention is expected and the work inside the lock is small and entirely database-bound. The model is direct: one transaction owns the decision, competing transactions wait, and the next transaction sees the committed result.

Be cautious when the transaction includes network I/O, user think time, expensive computation, or an unpredictable number of rows. Decide how long callers may wait, acquire locks in a consistent order when several rows are involved, and handle deadlocks and timeouts as normal operational outcomes.

## When a conditional write is the better fit

Use a conditional write when the operation naturally reads as:

> Perform this state transition only if condition X is still true.

Seat reservation maps cleanly to that model:

```text
AVAILABLE -> RESERVED
```

It is also a strong fit when conflicts are uncommon, when callers should fail quickly, or when there is meaningful time between reading and writing. The operation stays small, and zero updated rows becomes a first-class domain result rather than an unexpected database failure.

Make sure every caller checks that result. A conditional update whose affected-row count is ignored is only half an implementation. Also define whether a conflict is returned to the user, retried, merged, or queued.

## The database should protect the invariant

The original implementation asks the application to trust an observation it made earlier:

```text
I checked the seat,
and I think it is still available.
```

Both corrected implementations move that trust into the database.

The locking version guarantees that no conflicting transaction can change the row while the application makes its decision.

The conditional version guarantees that the state transition only happens if the required condition is true at write time.

The useful starting question is not "Should I use `SELECT FOR UPDATE`?" It is:

> What invariant am I trying to protect?

For this ticketing system:

> A seat cannot have two active reservations.

Once the invariant is explicit, choose the simplest database mechanism that enforces it correctly. That may be a unique constraint, a conditional update, a row lock, a transaction at a stronger isolation level, or a combination of them.

For the race in this article, the decision comes down to behavior under conflict:

```text
Pessimistic concurrency
-> coordinate before the change
-> competing work waits or fails to acquire the lock

Optimistic concurrency
-> attempt the change with a precondition
-> competing work succeeds or receives a conflict result
```

Both approaches can protect the same business rule. They resolve the race at different moments. Choose based on the shape of the operation, the expected contention, and what the losing request should do next.
