---
title: "PostgreSQL Locks, Part 3: Advisory Locks and Choosing the Right Lock"
description: "The last of three parts on PostgreSQL locking: advisory locks and their pitfalls, every lock type in pg_locks, a decision guide for choosing between row, table, advisory, and Serializable, and how to observe locks in production."
date: 2026-09-03
tags: [postgresql, locks, concurrency, advisory-locks]
series:
  name: "PostgreSQL Locks"
  part: 3
---

## Introduction

[Part 1](/writing/postgresql-locks-part-1-table-locks/) covered table-level locks and [Part 2](/writing/postgresql-locks-part-2-row-locks/) covered row-level locks. Both protect things that exist in the database: a table or a row. Some invariants are not about either. Only one scheduler instance should run the nightly job. A tenant's search index must not be rebuilt by two processes at once. Two deploys must not run migrations at the same time. There is no row to lock, or locking the obvious row would block unrelated traffic.

Advisory locks exist for those cases. This part covers them in full, including the pitfalls that come from a lock PostgreSQL does not connect to any data. It then lists the lock types you will meet in `pg_locks` but never request, brings the series together with criteria for choosing between a row lock, a table lock, an advisory lock, and no lock at all, and finishes with the queries and settings for seeing locks in production.

## Advisory locks

Advisory locks are locks on numbers. PostgreSQL guarantees that two sessions cannot both hold an exclusive advisory lock on the same key at the same time. What the key means is entirely up to the application. PostgreSQL never connects an advisory lock to any row or table.

The eight acquire functions form a grid:

| | Exclusive | Shared |
| --- | --- | --- |
| Session scope, wait | `pg_advisory_lock` | `pg_advisory_lock_shared` |
| Session scope, try | `pg_try_advisory_lock` | `pg_try_advisory_lock_shared` |
| Transaction scope, wait | `pg_advisory_xact_lock` | `pg_advisory_xact_lock_shared` |
| Transaction scope, try | `pg_try_advisory_xact_lock` | `pg_try_advisory_xact_lock_shared` |

The `try` variants return `false` instead of waiting. The others return `void` once the lock is held. Session locks are released with `pg_advisory_unlock`, `pg_advisory_unlock_shared`, or `pg_advisory_unlock_all`. Transaction locks have no unlock function.

Each function accepts either one `bigint` key or two `int` keys. The two-key form is a convenient namespace: the first integer names the kind of thing being locked and the second names the instance. For string identifiers, `hashtext(text)` produces an `int` and `hashtextextended(text, seed)` produces a `bigint`. Hashes can collide, which for a lock means two unrelated operations occasionally serialize with each other. That is a performance cost, not a correctness bug.

### Session scope and transaction scope

Session-level advisory locks do not follow transaction semantics. A session lock acquired in a transaction that later rolls back is still held. A session lock acquired twice must be released twice. The lock disappears only on explicit unlock or when the connection closes.

Transaction-level advisory locks are released when the transaction commits or rolls back, exactly like row and table locks.

Transaction scope is the safe default, for one reason above all others. Connection poolers such as PgBouncer in transaction mode hand a different server connection to each transaction. A session-level lock taken in one transaction lands on a server connection that the next transaction may not get back. The application believes it holds the lock, but the lock belongs to a connection now serving someone else. Use session scope only when the application owns a dedicated connection for the duration of the work.

### When an advisory lock is the right tool

Advisory locks fit work where the thing being protected has no row, or where locking its row would block unrelated traffic:

- **Singleton jobs.** Several application instances run the same scheduler, and only one of them should execute a given job per tick.
- **Per-tenant serialization.** Rebuilding a tenant's search index or cache must not run twice concurrently, but locking the tenant row would block every ordinary write for that tenant.
- **Coordinating with systems outside the database.** A lock held while writing files or calling an external API is a promise between application instances, not about database rows.
- **Migration runners.** Several tools, including Rails, take an advisory lock so that two deploys do not run migrations at once.

A scheduled job that must run at most once per tick looks like this:

```ts
const JOB_NAMESPACE = 1;

async function runSingleton(
  client: Client,
  jobId: number,
  work: (client: Client) => Promise<void>,
): Promise<"ran" | "skipped"> {
  await client.query("BEGIN");

  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1, $2) AS acquired",
      [JOB_NAMESPACE, jobId],
    );

    if (!rows[0]!.acquired) {
      await client.query("ROLLBACK");
      return "skipped";
    }

    await work(client);
    await client.query("COMMIT");
    return "ran";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
```

An instance that loses the race skips the tick immediately instead of queuing behind the winner and running the job a second time.

### Advisory lock pitfalls

Three problems recur.

**Advisory locks protect only against other advisory locks.** Code that updates a row without taking the advisory lock is not blocked by it. If a row exists and the invariant is about that row, a row lock enforces it against every writer. An advisory lock enforces it only against code that follows the convention.

**Advisory locks consume the shared lock table.** Unlike row locks, every advisory lock is an entry in shared memory sized by `max_locks_per_transaction` times the number of connections. A query that takes one advisory lock per row can exhaust it and prevent the server from granting any lock at all.

**`LIMIT` does not bound a locking function.** In `SELECT pg_advisory_lock(id) FROM jobs WHERE ... LIMIT 100`, PostgreSQL may evaluate the function for rows the `LIMIT` later discards. With session scope those locks are never released. Put the row selection in a subquery and call the function on its output.

## Locks you meet but never request

`pg_locks` shows more lock types than the families covered in this series. Most of them are PostgreSQL's own infrastructure, and knowing what they mean makes lock debugging faster:

| `locktype` | What it is | When you see it |
| --- | --- | --- |
| `relation` | Table-level lock on a table, index, view, or sequence | Every statement |
| `tuple` | Place-in-line lock while waiting for a row | Row lock contention |
| `transactionid` | Every transaction holds an exclusive lock on its own ID | A waiter for a row lock waits on this |
| `virtualxid` | Same, for transactions that have not yet written | `CREATE INDEX CONCURRENTLY` waits on these |
| `extend` | Right to add pages to a relation | Many concurrent inserters into one table |
| `page` | Page-level lock | Rare, hot index pages |
| `object` | Lock on a catalog object that is not a relation | `DROP` of schemas, roles, and types |
| `spectoken` | Speculative insertion token | `INSERT ... ON CONFLICT` racing on a unique key |
| `advisory` | Advisory lock | Your `pg_advisory_*` calls |
| `frozenid`, `applytransaction`, `userlock` | Internal | Vacuum freezing, logical replication, legacy |

`SIReadLock` is a lock mode rather than a type. Rows with that mode on `relation`, `page`, or `tuple` types are the predicate locks `SERIALIZABLE` uses to detect dangerous read-write patterns. They are never granted or denied and never cause a wait.

## Choosing a lock

Start from the invariant, not from the lock. Then choose the narrowest mechanism that protects it:

![Decision diagram for choosing between row locks, DDL lock modes, advisory locks, and Serializable transactions](/writing/postgres-locks-choosing.svg)

Five questions cover most cases.

**1. Is the invariant about specific rows?** If yes, a row lock or a conditional write is the answer, and the [pessimistic vs optimistic article](/writing/locks-vs-optimistic-concurrency/) covers how to choose between them. If the invariant is about a row that does not exist yet, such as "at most one active session per user", a unique constraint is a stronger tool than any lock.

**2. Which row lock mode?** Take the weakest mode that excludes the operations you must exclude. `FOR NO KEY UPDATE` for updating non-key columns. `FOR UPDATE` only for deletes and key changes. `FOR SHARE` when the transaction only needs the row to stay unchanged. Every step up the ladder blocks more concurrent work.

**3. Is the invariant about the table's shape?** Schema changes take their own table locks. Choose the form of the DDL that takes the weakest lock for the longest part of the work, set `lock_timeout`, and retry. Reach for an explicit `LOCK TABLE` only for a whole-table batch computation, and take `SHARE ROW EXCLUSIVE` rather than `SHARE`.

**4. Does the thing you are protecting have no row at all?** A job name, a tenant-wide operation, a file on disk. This is what advisory locks are for. Prefer transaction scope. Use `try` variants when the loser should skip rather than wait.

**5. Is the rule about a set of rows that changes?** "At least one person on call", "total allocations under budget". Row locks only protect rows that exist when they are taken. Either lock a parent row that stands for the set, or use `SERIALIZABLE` and retry on `40001` as the [write skew article](/writing/repeatable-read-write-skew-postgresql/) shows.

Then decide what the losing transaction should do, because every locking mechanism has a wait policy:

| Loser should | Row lock | Table lock | Advisory lock |
| --- | --- | --- | --- |
| Wait | default | default | `pg_advisory_xact_lock` |
| Wait, but not forever | `lock_timeout` | `lock_timeout` | `lock_timeout` |
| Fail immediately | `NOWAIT` | `NOWAIT` | `pg_try_advisory_xact_lock` |
| Take something else | `SKIP LOCKED` | not applicable | try a different key |

Waiting suits short database-bound critical sections where the loser has nothing else to do. Failing fast suits interactive requests where a user is waiting for an answer. Skipping suits workers that have a queue of alternatives.

## Observing locks in production

A blocked session shows up in `pg_stat_activity` with `wait_event_type = 'Lock'`. The `wait_event` column names the lock type, and `pg_blocking_pids()` resolves who is holding it up:

```sql
SELECT
    a.pid,
    a.state,
    a.wait_event,
    pg_blocking_pids(a.pid) AS blocked_by,
    now() - a.xact_start AS transaction_age,
    left(a.query, 80) AS query
FROM pg_stat_activity a
WHERE a.wait_event_type = 'Lock'
ORDER BY a.xact_start;
```

To see what is held on one table, query `pg_locks` directly:

```sql
SELECT l.pid, l.mode, l.granted, a.state, left(a.query, 60) AS query
FROM pg_locks l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'relation'
  AND l.relation = 'orders'::regclass
ORDER BY l.granted DESC;
```

Rows with `granted = false` are the queue. A held `ACCESS SHARE` from a session in state `idle in transaction` next to a waiting `ACCESS EXCLUSIVE` is the outage from Part 1, caught in the act.

Four settings deserve deliberate values rather than defaults:

- `lock_timeout` bounds every lock wait. Set it per session in migration tooling and consider a generous default for application connections.
- `statement_timeout` bounds how long a statement may run, which bounds how long its locks are held.
- `idle_in_transaction_session_timeout` kills sessions that stop mid-transaction. It is the single most effective setting against locks held by forgotten transactions.
- `log_lock_waits = on` writes a log line whenever a session waits longer than `deadlock_timeout`. It costs almost nothing and makes lock contention visible before it becomes an incident.

## Series checklist

1. Assume every statement takes locks. Look up the mode before running DDL against a busy table.
2. Set `lock_timeout` for any statement that needs a strong table lock, and retry on `55P03`.
3. Prefer `NOT VALID` plus `VALIDATE`, and `CONCURRENTLY`, so the strong lock is brief and the long work runs under a weak one.
4. Lock rows with `FOR NO KEY UPDATE` by default. Use `FOR UPDATE` only to delete or change keys.
5. Add `OF table` to a locking clause on a join unless you mean to lock every table.
6. Lock several rows in primary key order to prevent deadlocks, and retry on `40P01`.
7. Use `SKIP LOCKED` for queues and `NOWAIT` or `lock_timeout` for interactive requests.
8. Prefer transaction-scoped advisory locks. Use session scope only on a dedicated connection.
9. Keep external calls and user think time outside any transaction that holds locks.
10. Turn on `log_lock_waits` and set `idle_in_transaction_session_timeout`.

The outage that opened Part 1 was an `ACCESS EXCLUSIVE` request queued behind a long `ACCESS SHARE` holder, with the application queued behind both. A three-second `lock_timeout` and a retry loop would have turned it into a slightly slower deploy. That is the shape of most lock problems in PostgreSQL. The lock system is doing exactly what the conflict matrix says. The fix is knowing what you asked for.

## References

- [PostgreSQL explicit locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL `pg_locks` view](https://www.postgresql.org/docs/current/view-pg-locks.html)
- [PostgreSQL advisory lock functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)
- [Systems Engineering Lab 13: Advisory locks](https://github.com/muliswilliam/systems-engineering-lab/tree/main/labs/13-advisory-locks)
- [Systems Engineering Lab 32: Deadlocks and lock debugging](https://github.com/muliswilliam/systems-engineering-lab/tree/main/labs/32-deadlocks-and-lock-debugging)
