---
title: "PostgreSQL Locks, Part 1: Table-Level Locks and the Lock Queue"
description: "The first of three parts on PostgreSQL locking: the four lock families, the eight table-level lock modes, what ALTER TABLE really takes, and why a waiting lock can take an application down."
date: 2026-09-01
tags: [postgresql, locks, concurrency, migrations]
series:
  name: "PostgreSQL Locks"
  part: 1
---

## Introduction

A migration adds a nullable column to the `orders` table. In staging it finishes in four milliseconds. In production the deploy hangs, and within seconds every request that touches `orders` stops responding. The application is down.

Nothing was writing to `orders`. A reporting query had been reading it for twenty minutes.

The `ALTER TABLE` needed an `ACCESS EXCLUSIVE` lock on the table, so it waited for the reporting query to finish. Every new `SELECT` from the application then queued behind the waiting `ALTER TABLE`, even though a `SELECT` never conflicts with another `SELECT`. The migration was correct SQL. The outage came from a lock nobody typed.

Every statement in PostgreSQL takes locks. Most of them are implicit, and the ones you can take explicitly only work well when you understand the ones you cannot avoid. Two earlier articles on this site used `SELECT FOR UPDATE` and isolation levels to fix a specific race. This series steps back and covers the whole lock system in three parts.

This part maps the four families of locks, then covers table-level locks in full: the eight modes, which commands take each one, how they conflict, what `ALTER TABLE` really takes, and the queue behavior behind the outage above. [Part 2](/writing/postgresql-locks-part-2-row-locks/) covers row-level locks. [Part 3](/writing/postgresql-locks-part-3-advisory-locks-and-choosing/) covers advisory locks, how to choose between all of them, and how to see locks in production.

## Four families of locks

PostgreSQL exposes four kinds of locks to an application:

![Overview of PostgreSQL's four lock families, showing what each protects, who takes it, where it is stored, and how long it is held](/writing/postgres-locks-families.svg)

- **Table-level locks** protect a whole table. Every statement that touches a table takes one, and DDL takes the strong ones.
- **Row-level locks** protect individual rows against concurrent writers and lockers. `UPDATE`, `DELETE`, and foreign key checks take them automatically, and `SELECT ... FOR ...` takes them explicitly.
- **Page-level locks** protect a buffer page for the instant it takes to read or write a row. The executor takes and releases them internally.
- **Advisory locks** protect whatever your application decides a number means. PostgreSQL only provides the mutual exclusion.

Two rules apply to table and row locks. First, once a transaction acquires a lock, it holds the lock until the transaction commits or rolls back. There is no statement that releases a lock early, although rolling back to a savepoint releases locks acquired after that savepoint. Second, a transaction waiting for a conflicting lock waits indefinitely unless a `lock_timeout` is set or PostgreSQL detects a deadlock.

Two categories are out of scope for the series. Lightweight locks and spinlocks protect PostgreSQL's own shared memory structures. They appear as `LWLock` wait events in `pg_stat_activity`, but you cannot request them. Predicate locks, which appear in `pg_locks` as `SIReadLock`, are bookkeeping for `SERIALIZABLE` transactions. They never block anything. The [write skew article](/writing/repeatable-read-write-skew-postgresql/) covers what they detect.

## Table-level locks

Every statement that references a table acquires one of eight table-level lock modes on it. The names are historical. `ROW EXCLUSIVE` is a table lock, not a row lock. Each name describes the kind of operation that traditionally acquired the mode, not the granularity of what it protects.

| Mode | Taken automatically by |
| --- | --- |
| `ACCESS SHARE` | `SELECT`, and any statement that only reads the table |
| `ROW SHARE` | `SELECT ... FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE` |
| `ROW EXCLUSIVE` | `INSERT`, `UPDATE`, `DELETE`, `MERGE` |
| `SHARE UPDATE EXCLUSIVE` | `VACUUM`, `ANALYZE`, `CREATE INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, `CREATE STATISTICS`, `COMMENT ON`, some `ALTER TABLE` and `ALTER INDEX` forms |
| `SHARE` | `CREATE INDEX` without `CONCURRENTLY` |
| `SHARE ROW EXCLUSIVE` | `CREATE TRIGGER`, `ALTER TABLE ... ADD FOREIGN KEY`, `ALTER TABLE ... ENABLE/DISABLE TRIGGER` |
| `EXCLUSIVE` | `REFRESH MATERIALIZED VIEW CONCURRENTLY` |
| `ACCESS EXCLUSIVE` | `DROP TABLE`, `TRUNCATE`, `REINDEX`, `CLUSTER`, `VACUUM FULL`, `REFRESH MATERIALIZED VIEW`, most `ALTER TABLE` forms, `LOCK TABLE` without a mode |

Modes do not form a simple ladder. Two transactions can hold the same table in different modes at the same time as long as those modes do not conflict. The conflict matrix is the fact to remember:

![Conflict matrix of PostgreSQL's eight table-level lock modes, with conflicting pairs filled in black](/writing/postgres-locks-table-conflicts.svg)

Four observations fall out of the matrix:

- **Only `ACCESS EXCLUSIVE` blocks a plain `SELECT`.** Reads continue during `VACUUM`, `CREATE INDEX`, `CREATE INDEX CONCURRENTLY`, and `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
- **`ROW EXCLUSIVE` does not conflict with itself.** Any number of transactions can write to a table at once. Coordination between them happens at the row level, which is the subject of Part 2.
- **`SHARE UPDATE EXCLUSIVE` conflicts with itself.** Two `VACUUM` runs or two `CREATE INDEX CONCURRENTLY` commands on the same table serialize, but neither blocks reads or writes. The mode means "share the table with reads and writes, exclude other maintenance."
- **`SHARE` blocks every write but allows other `SHARE` holders.** A plain `CREATE INDEX` freezes the table's contents for its duration, which is why the `CONCURRENTLY` variant exists.

## What `ALTER TABLE` actually takes

`ALTER TABLE` covers dozens of operations with different lock modes and different amounts of work. The lock mode decides what the statement blocks. The work decides for how long.

| Operation | Lock mode | Work |
| --- | --- | --- |
| `ADD COLUMN` with no default or a constant default | `ACCESS EXCLUSIVE` | Catalog update only, milliseconds |
| `ADD COLUMN` with a volatile default such as `now()` | `ACCESS EXCLUSIVE` | Full table rewrite |
| `ALTER COLUMN ... TYPE` | `ACCESS EXCLUSIVE` | Full table rewrite in most cases |
| `ALTER COLUMN ... SET NOT NULL` | `ACCESS EXCLUSIVE` | Full table scan, skipped if a valid `CHECK (col IS NOT NULL)` exists |
| `ADD CONSTRAINT ... CHECK` | `ACCESS EXCLUSIVE` | Full table scan |
| `ADD CONSTRAINT ... CHECK ... NOT VALID` | `ACCESS EXCLUSIVE` | Catalog update only |
| `ADD FOREIGN KEY`, with or without `NOT VALID` | `SHARE ROW EXCLUSIVE` on both tables | Scan of the referencing table unless `NOT VALID` |
| `VALIDATE CONSTRAINT` | `SHARE UPDATE EXCLUSIVE` | Full table scan while writes continue |
| `SET STATISTICS`, `SET (fillfactor)`, `SET (autovacuum_*)` | `SHARE UPDATE EXCLUSIVE` | Catalog update only |
| `ATTACH PARTITION` | `SHARE UPDATE EXCLUSIVE` on the parent | Scan of the partition unless a matching `CHECK` exists |
| `DROP COLUMN` | `ACCESS EXCLUSIVE` | Catalog update only |
| `CREATE INDEX` | `SHARE` | Full table scan, writes blocked |
| `CREATE INDEX CONCURRENTLY` | `SHARE UPDATE EXCLUSIVE` | Two table scans, writes continue |

The table shows the pattern behind safe migrations. Split an operation into a step that takes a strong lock briefly and a step that takes a weak lock for a long time. `ADD CONSTRAINT ... NOT VALID` followed by `VALIDATE CONSTRAINT` is the canonical example. `CREATE INDEX CONCURRENTLY` and `ADD FOREIGN KEY ... NOT VALID` follow the same shape.

## The lock queue does not skip

A brief `ACCESS EXCLUSIVE` lock is still dangerous, because of how PostgreSQL queues lock requests. When a transaction requests a lock that conflicts with a held lock, it joins a queue for that table. Later requests then check for conflicts against the held locks **and against the requests already waiting**. A new `ACCESS SHARE` request conflicts with the waiting `ACCESS EXCLUSIVE` request, so it queues behind it.

This is what took the application down in the introduction:

![Timeline showing a long SELECT holding ACCESS SHARE, an ALTER TABLE queuing for ACCESS EXCLUSIVE behind it, and new application SELECTs queuing behind the ALTER TABLE](/writing/postgres-locks-queue-pileup.svg)

The queue is fair by design. Without it, a steady stream of readers could starve the `ALTER TABLE` forever. The consequence is that the cost of a migration is not the lock it holds but the lock it waits for.

The defense is a bounded wait:

```sql
SET lock_timeout = '3s';

ALTER TABLE orders ADD COLUMN notes text;
```

If the `ALTER TABLE` cannot get its lock within three seconds, PostgreSQL cancels it:

```text
ERROR:  canceling statement due to lock timeout
SQLSTATE 55P03
```

The migration runner should catch `55P03`, wait with backoff, and try again. Each attempt blocks the application for at most three seconds. Without the timeout, one attempt can block it for as long as the oldest reader runs.

Two related settings protect the other side. `statement_timeout` bounds how long a query may run, which bounds how long it can hold `ACCESS SHARE`. `idle_in_transaction_session_timeout` ends sessions that opened a transaction and then stopped issuing statements, which is the most common way a lock is held far longer than intended.

## Taking a table lock explicitly

`LOCK TABLE` acquires any of the eight modes by name:

```sql
BEGIN;

LOCK TABLE inventory_snapshots IN SHARE ROW EXCLUSIVE MODE;

-- read the current inventory, compute the snapshot, insert it

COMMIT;
```

`LOCK TABLE` only works inside a transaction block. Outside one, the lock would be released as soon as the statement finished. Without a mode, it takes `ACCESS EXCLUSIVE`. `NOWAIT` makes it fail instead of queue.

Explicit table locks are rarely the right tool. Row locks handle most write coordination, and DDL takes its own table locks. The main legitimate use is a batch operation that must read a table, compute something from the whole of it, and write the result, while excluding other writers.

`SHARE ROW EXCLUSIVE` is the mode for that job, for a specific reason. The intuitive choice, `SHARE`, blocks writers but does not conflict with itself. Two transactions can both hold `SHARE`, and when both then try to write, each needs `ROW EXCLUSIVE`, which conflicts with the other's `SHARE`. Neither can proceed and PostgreSQL aborts one with a deadlock error. `SHARE ROW EXCLUSIVE` conflicts with itself, so the second transaction waits at the `LOCK TABLE` statement instead.

This is an instance of a general rule from the PostgreSQL documentation: the first lock a transaction takes on an object should be the most restrictive mode it will need for that object. Lock upgrades are how transactions deadlock with themselves.

## What to take from this part

Table-level locks are mostly implicit, and the strong ones come from DDL. The conflict matrix tells you what a statement blocks, the amount of work tells you for how long, and the queue tells you why even a brief strong lock needs a `lock_timeout`. Reads are only ever blocked by `ACCESS EXCLUSIVE`, and writes are only blocked by `SHARE` and stronger.

The next part moves down a level. Writers coordinate with each other through row-level locks, which have four modes of their own, a subtle split between two of them that exists for foreign keys, and two clauses that turn a table into a work queue. Continue with [Part 2: Row-Level Locks](/writing/postgresql-locks-part-2-row-locks/).

## References

- [PostgreSQL explicit locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL `ALTER TABLE` lock modes](https://www.postgresql.org/docs/current/sql-altertable.html)
- [PostgreSQL `LOCK` statement](https://www.postgresql.org/docs/current/sql-lock.html)
- [Systems Engineering Lab 29: Safe schema migrations](https://github.com/muliswilliam/systems-engineering-lab/tree/main/labs/29-safe-schema-migrations)
