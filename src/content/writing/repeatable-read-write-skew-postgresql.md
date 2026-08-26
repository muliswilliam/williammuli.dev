---
title: "How Write Skew Happens Under Repeatable Read in PostgreSQL"
description: "A practical example of write skew under PostgreSQL Repeatable Read, followed by a Serializable implementation with bounded retries."
date: 2026-08-25
tags: [postgresql, transactions, concurrency, isolation-levels]
---

## Introduction

Consider an on-call scheduling system with one rule: at least one person must remain available.

Alice and Bob are both on call. Alice tries to sign off, so the application checks whether anyone else is available. It finds Bob and approves the change. At the same time, Bob does the same check, finds Alice, and is also allowed to sign off.

Because the requests overlap, each one makes its decision before the other's update becomes visible. PostgreSQL accepts both updates, leaving the team without anyone on call.

The implementation appears reasonable: read the current state, verify the rule, then update the row inside a transaction. The natural next step is to strengthen the transaction from PostgreSQL's default `READ COMMITTED` isolation level to `REPEATABLE READ`. If every statement sees one consistent snapshot, the decision should remain valid for the transaction.

Using `REPEATABLE READ` seems reasonable here because it gives each transaction a stable view of the database. The limitation is that Alice and Bob update different rows. PostgreSQL sees no same-row write conflict, so both transactions can commit using snapshots in which the other person was still on call. The individual decisions are consistent with their snapshots, but the combined result violates the scheduling rule.

This is **write skew**. We will start with the application rule, apply `REPEATABLE READ`, and examine why it fails. We will then fix the problem with `SERIALIZABLE`, handle `SQLSTATE 40001` correctly, and measure the cost of protecting the rule under contention.

## Start with the rule

The example uses a small `on_call_staff` table:

```ts
import {
  bigint,
  boolean,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

export const onCallStaff = pgTable("on_call_staff", {
  id: bigint("id", { mode: "number" })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  team: text("team").notNull(),
  name: text("name").notNull().unique(),
  isOnCall: boolean("is_on_call").notNull(),
});
```

The starting state is:

| Person | On call |
| --- | --- |
| Alice | Yes |
| Bob | Yes |

The rule is simple: every team must always have at least one person on call.

A normal row-level `CHECK` constraint cannot express this rule because the result depends on other rows in the table. Each person's row is valid by itself when `is_on_call` becomes `false`. The invalid state only appears when both rows are considered together.

The initial implementation wraps the check and update in a transaction:

```ts
import type { Client } from "pg";

async function goOffCall(
  client: Client,
  team: string,
  staffId: number,
): Promise<"committed" | "rejected"> {
  await client.query("BEGIN");

  try {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)
       FROM on_call_staff
       WHERE team = $1
         AND is_on_call = true
         AND id != $2`,
      [team, staffId],
    );

    const othersOnCall = Number(rows[0]!.count);

    if (othersOnCall < 1) {
      await client.query("ROLLBACK");
      return "rejected";
    }

    await client.query(
      `UPDATE on_call_staff
       SET is_on_call = false
       WHERE id = $1`,
      [staffId],
    );

    await client.query("COMMIT");
    return "committed";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
```

No isolation level is specified, so PostgreSQL uses `READ COMMITTED`. The transaction ensures that each request either completes its read and update or rolls them back together. It does not prevent another transaction from evaluating the same rule at the same time.

If Alice's `SELECT` and Bob's `SELECT` both run before either transaction commits, both queries return `1`. Alice then updates her row, Bob updates his row, and both transactions commit. Since the updates target different rows, neither request waits for or overwrites the other.

## First attempt: use Repeatable Read

The transaction makes its update based on the result of an earlier query. A reasonable first attempt is to run the operation under `REPEATABLE READ`, so every read in the transaction uses the same database snapshot.

The initial implementation only needs one change:

```ts
await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
```

PostgreSQL takes the transaction's snapshot when its first query runs and uses that snapshot for later reads. If the operation performs additional validation queries before the update, they continue to see the same committed state even when another transaction commits in the meantime.

PostgreSQL also protects competing writes to the same row. If two Repeatable Read transactions try to update one row after taking their snapshots, one can commit and the other is aborted with:

```text
SQLSTATE 40001: could not serialize access due to concurrent update
```

These guarantees are sufficient for some workflows, particularly when concurrent transactions update the same row. In this case, the query reads the state of the team while each transaction updates a different staff row. Both snapshots can remain internally consistent without PostgreSQL detecting a same-row write conflict.

![Comparison showing that Read Committed and Repeatable Read use different snapshot rules but both allow the on-call write-skew problem](/writing/read-committed-vs-repeatable-read.svg)

## Why Repeatable Read does not fix it

To reproduce the overlap, the example uses two independent `pg.Client` connections. This makes the order of the reads, updates, and commits explicit. The remaining examples use the following small helpers:

```ts
import { Client } from "pg";

async function connectClient(
  connectionString: string,
): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

async function countOthersOnCall(
  client: Client,
  team: string,
  staffId: number,
): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)
     FROM on_call_staff
     WHERE team = $1
       AND is_on_call = true
       AND id != $2`,
    [team, staffId],
  );

  return Number(rows[0]!.count);
}

async function setOffCall(
  client: Client,
  staffId: number,
): Promise<void> {
  await client.query(
    `UPDATE on_call_staff
     SET is_on_call = false
     WHERE id = $1`,
    [staffId],
  );
}

```

```ts
const txA = await connectClient(connectionString);
const txB = await connectClient(connectionString);

await txA.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
await txB.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
```

Both transactions take their snapshots before either person changes state.

Alice checks whether somebody else is on call:

```ts
const othersSeenByAlice = await countOthersOnCall(
  txA,
  team,
  aliceId,
);
```

Her query returns `1` because Bob is on call in her snapshot.

Bob performs the same check in his transaction:

```ts
const othersSeenByBob = await countOthersOnCall(
  txB,
  team,
  bobId,
);
```

His query also returns `1` because Alice is on call in his snapshot.

![Sequence diagram showing Alice and Bob each reading the other as on call under Repeatable Read, then both committing updates that leave nobody on call](/writing/repeatable-read-write-skew-race.svg)

Both transactions therefore decide that going off call is allowed, update their respective rows, and commit. After both commits, the table contains two off-call rows and the on-call count is `0`.

PostgreSQL does not raise an error because neither transaction writes a row changed by the other. Each transaction is consistent with its own snapshot, although the combined result differs from every possible order in which the transactions could have run one at a time.

If Alice ran first and committed before Bob began, Bob would see zero other people on call and stay. The reverse order would make Alice stay. No serial order allows both people to clock out.

This is what makes the result write skew: it could not happen if the two transactions ran one after the other.

## How the transactions depend on each other

After Alice commits, Bob's transaction does not see her change. That is the expected behavior of `REPEATABLE READ`. Bob must continue using the snapshot in which Alice was still on call.

The anomaly involves two read-write dependencies:

1. Alice reads Bob's row as on call, then Bob changes that row.
2. Bob reads Alice's row as on call, then Alice changes that row.

The dependencies point in opposite directions and form a cycle:

![Diagram showing Alice's transaction depending on Bob's row and Bob's transaction depending on Alice's row, forming the write-skew cycle](/writing/write-skew-dependency-cycle.svg)

Repeatable Read preserves both snapshots without rejecting this cycle. Its same-row conflict detection does not cover a rule evaluated across several rows.

## Use Serializable to detect the anomaly

The same transaction sequence can be run with one change to the isolation level:

```ts
await txA.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
await txB.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
```

The reads, decisions, updates, and commit order remain the same.

PostgreSQL's Serializable isolation keeps track of what concurrent transactions read and later change. If their combined result could not happen when the transactions run one after the other, PostgreSQL aborts one of them.

![Sequence diagram showing PostgreSQL allowing Alice to commit, then aborting Bob with SQLSTATE 40001 under Serializable isolation](/writing/serializable-detects-write-skew.svg)

Both queries still return `1`, since Alice and Bob take their snapshots before either update commits. Alice commits first. When Bob tries to commit, PostgreSQL detects how the two transactions conflict and aborts Bob's transaction with `SQLSTATE 40001`. Bob's update is rolled back, so his row remains on call and the final count is `1`.

Serializable does not make the transactions execute one at a time. They still run concurrently, but the final result must be one that could have occurred if they had run one after the other. When PostgreSQL cannot provide that result, one transaction receives `SQLSTATE 40001`.

## Handle the serialization failure

The aborted transaction preserves the scheduling rule, but Bob's request still needs an outcome. The application must handle the serialization failure rather than returning success or silently dropping the request.

For this operation, `40001` means the entire decision must be attempted again. It does not mean the original `UPDATE` should be replayed.

The failed transaction made its decision using a snapshot that PostgreSQL could not serialize with the other transaction. Its previous reads and decision should therefore be discarded.

A small helper identifies PostgreSQL's serialization failure by its SQLSTATE:

```ts
function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "40001"
  );
}
```

A single attempt opens a transaction, reads the current state, makes the business decision, and commits:

```ts
async function attemptGoOffCall(
  connectionString: string,
  team: string,
  staffId: number,
): Promise<"committed" | "rejected" | "conflict"> {
  const client = await connectClient(connectionString);

  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    const othersOnCall = await countOthersOnCall(
      client,
      team,
      staffId,
    );

    if (othersOnCall < 1) {
      await client.query("ROLLBACK");
      return "rejected";
    }

    await setOffCall(client, staffId);
    await client.query("COMMIT");
    return "committed";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);

    if (isSerializationFailure(error)) {
      return "conflict";
    }

    throw error;
  } finally {
    await client.end();
  }
}
```

Only the conflict outcome is retryable. A committed transaction succeeded. A rejected transaction read a valid current state and found that going off call would be unsafe.

## Retry with a fresh snapshot

The retry loop uses exponential backoff with jitter, capped at 300 ms:

```ts
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomizedBackoffMs(attempt: number): number {
  const cap = Math.min(300, 25 * 2 ** attempt);
  return Math.random() * cap;
}
```

It creates a new attempt after each serialization failure:

```ts
async function retryGoOffCall(
  connectionString: string,
  team: string,
  staffId: number,
  maxAttempts = 5,
): Promise<"committed" | "rejected"> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await attemptGoOffCall(
      connectionString,
      team,
      staffId,
    );

    if (result !== "conflict") {
      return result;
    }

    await sleep(randomizedBackoffMs(attempt));
  }

  throw new Error(`exhausted ${maxAttempts} attempts`);
}
```

Every retry starts a new transaction and reads a new snapshot. It does not reuse the previous count or the previous decision.

![Flow diagram showing Bob's first transaction failing with SQLSTATE 40001, backing off, starting a new transaction, reading fresh state, and safely rejecting the request](/writing/serializable-retry-fresh-snapshot.svg)

In this run, Alice commits on her first attempt. Bob's first attempt receives `SQLSTATE 40001`, rolls back, waits for a short randomized delay, and starts a new transaction. The new snapshot includes Alice's committed change, so Bob now counts zero other people on call. His request returns `rejected` without updating his row, leaving the final on-call count at `1`.

The purpose of the retry is not to force the original update through. It repeats the read and the business decision using the current database state.

Use bounded retries with randomized backoff. An unlimited retry loop can keep a request alive forever during sustained contention, while synchronized immediate retries can cause the same transactions to collide repeatedly.

## Measure the retry cost under contention

To compare the behavior under contention, I ran the same operation with five staff members trying to go off call concurrently.

![Visual comparison of transaction attempts, serialization failures, wall-clock time, and final on-call state under Serializable with retries and Repeatable Read](/writing/contention-results-comparison.svg)

Serializable required more than twice as many attempts in this run. That additional work came from detecting conflicting transaction histories and retrying them until the requests reached valid outcomes.

The exact timings and retry counts vary with scheduling and contention. In this comparison, Repeatable Read completed with less work because it did not detect the problem. It also produced no database conflict for the application to record, even though the final state broke the scheduling rule.

## Other ways to protect the rule

Serializable is appropriate when a rule depends on several rows or tables and concurrent transactions must produce the same result as running one at a time.

Depending on the data model, a narrower mechanism may provide the required guarantee with less retry overhead.

![Decision diagram for choosing between a conditional update or constraint, SELECT FOR UPDATE, and Serializable transactions with retries](/writing/choosing-concurrency-control.svg)

### Lock the rows that define the decision

The transaction can lock the relevant team rows before counting and updating them:

```sql
SELECT id
FROM on_call_staff
WHERE team = $1
FOR UPDATE;
```

Concurrent requests for the same team then wait instead of evaluating the rule against independent snapshots. This can be easier to reason about for a small, known set of rows, but it introduces blocking and requires every writer to follow the same locking protocol.

### Put the rule in one guarded write

If the model can maintain the remaining capacity in one row, a conditional update may enforce the boundary directly:

```sql
UPDATE on_call_teams
SET available_count = available_count - 1
WHERE id = $1
  AND available_count > 1
RETURNING *;
```

One statement can then protect the rule under `READ COMMITTED`. This avoids Serializable's broader transaction checks and retries, but introduces a shared counter that must remain consistent with the staff records.

### When Serializable is appropriate

When the rule cannot be reduced to a row constraint, unique constraint, or precise conditional update, Serializable provides a general guarantee. The application cost is explicit handling for aborted transactions.

## Production considerations

Track `40001` failures by operation rather than only as a database-wide error count. A rising failure rate can indicate that more requests are trying to change the same related data at the same time.

Also measure:

- retry attempts per logical request;
- requests that exhaust the retry limit;
- latency added by retries and backoff;
- the final domain outcome, including business rejections;
- long-running Serializable transactions.

Keep Serializable transactions short. Perform the database reads and writes required for the decision, then commit. Network calls, email delivery, and other external side effects should not happen inside a transaction that may be rolled back and retried.

If the transaction must trigger external work, persist that intent transactionally and process it after commit. Retrying a database transaction must not charge a card or publish the same message twice.

`REPEATABLE READ` behaved as documented in this example. Alice and Bob each received a stable snapshot, but stable snapshots alone could not coordinate a rule spanning both rows. `SERIALIZABLE` detected the dependency between the transactions and rejected one commit. Retrying that transaction with a fresh snapshot allowed the application to evaluate the rule again using current data and preserve the intended final state.

## References

- [PostgreSQL transaction isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Systems Engineering Lab 08: Repeatable Read and snapshots](https://github.com/muliswilliam/systems-engineering-lab/tree/main/labs/08-repeatable-read-and-snapshots)
- [Systems Engineering Lab 09: Serializable and retries](https://github.com/muliswilliam/systems-engineering-lab/tree/main/labs/09-serializable-and-retries)
