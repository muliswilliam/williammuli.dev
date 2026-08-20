---
title: transactions and what postgres actually sees
description: A broken money transfer, a fixed one, and the MVCC machinery that makes both possible.
date: 2026-08-20
heroImage: /writing/transactions-and-what-postgres-actually-sees-hero.jpg
tags: [postgresql, transactions, mvcc, database-internals]
---

A transfer row once sat at status `pending` for days before anyone noticed, and I remember losing part of an afternoon to figuring out why. The transfer itself was just two writes: pull money out of one account, put it into another. The first write had gone through. The second one hadn't. No alert fired for it - a deploy had landed in the gap between two independent SQL statements, and whatever was supposed to run the second one was gone by the time its turn came. The money hadn't vanished from the world, only from the ledger's account of itself, unaccounted for until someone went digging for stuck rows.

Later I rebuilt that exact failure against a real Postgres instance, in a small lab, so the corruption would show up as actual numbers instead of a half-remembered anecdote. Fixing it turned out to be the easy part. The more interesting part was going one level further down, into MVCC, the mechanism that lets Postgres hand you that fix without forcing every reader to queue up behind every writer.

The naive version of a transfer debits one account and credits another with two separate statements, no explicit transaction around either one:

```typescript
await pool.query("UPDATE accounts SET balance_cents = balance_cents - $1 WHERE id = $2", [
  opts.amountCents,
  opts.fromAccountId,
]);

if (opts.injectFailureAfterDebit) {
  throw new SimulatedCrashError(
    "simulated crash after debit, before credit (naive, non-transactional transfer)",
    transferId,
  );
}
```

Under Postgres's default autocommit behavior, a bare statement with no `BEGIN` in front of it is its own implicit transaction. The moment that debit `UPDATE` finishes, it is committed and durable, full stop. Postgres has no idea a second statement is supposed to follow it, and it does not hold anything open waiting to see whether that second statement shows up. The `injectFailureAfterDebit` branch above simulates exactly the kind of thing that ends careers of "temporary" scripts: a crash, a dropped connection, an uncaught exception, arriving after the debit committed and before the credit ever ran.

Here is what that actually does to the numbers, captured from a real run against seeded accounts:

```text
fromBalanceBefore: 2293113   fromBalanceAfter: 2292113   (debited - correct)
toBalanceBefore: 1532517     toBalanceAfter: 1532517     (NOT credited - bug)
totalBalanceBefore: 24936589
totalBalanceAfter: 24935589
moneyVanishedCents: 1000
```

Ten dollars just left the system. Account 1 is down 1,000 cents, account 2 never moved, and the sum across every account in the bank dropped by exactly the amount that was supposed to move sideways, not vanish. The transfer's audit row is left at `status = 'pending'` forever, because there is no code left running after the injected failure that could mark it anything else - which is itself the operational signal: a reconciliation job that scans for old `pending` rows is looking for precisely this.

The fix is not a smarter retry or a cleverer catch block. It is wrapping both statements in one transaction, so their fates are tied together instead of independent:

```typescript
await client.query("BEGIN");
```

```typescript
await client.query("UPDATE accounts SET balance_cents = balance_cents - $1 WHERE id = $2", [
  opts.amountCents,
  opts.fromAccountId,
]);

if (opts.injectFailureAfterDebit) {
  throw new Error("simulated crash after debit, before credit (transactional transfer)");
}

// Statement 2: credit the destination account - part of the same
// transaction as statement 1.
await client.query("UPDATE accounts SET balance_cents = balance_cents + $1 WHERE id = $2", [
  opts.amountCents,
  opts.toAccountId,
]);
```

```typescript
await client.query("COMMIT");
```

And the failure path, which now runs through a `catch`:

```typescript
} catch (error) {
  await client.query("ROLLBACK");
```

Same injected failure, same point in the code, same two statements. The only difference is `BEGIN` before the first one and `ROLLBACK` in the `catch` block. Run it against the same kind of crash and the numbers hold:

```text
fromBefore: 2291113      fromAfter: 2291113   (unchanged)
toBefore: 1533517        toAfter: 1533517     (unchanged)
```

The debit `UPDATE` still executes, identically to the naive version - but this time it was never durable on its own. It only becomes permanent at `COMMIT`, and `COMMIT` never ran, because the thrown error was caught first. `ROLLBACK` discards everything issued on that connection since `BEGIN`, including the debit and the `pending` audit row inserted at the top of the same transaction. That is the whole guarantee an atomic transaction gives you: not that failures cannot happen, but that when one does, there is no observable intermediate state for anyone to trip over. No other connection, and no later query against the same connection, can see "half a transfer." Either both writes are there or neither is, and there is no window where only one exists. (One consequence worth naming: the audit row that records the failure has to be inserted as its own separate statement after `ROLLBACK` completes, since a row written inside the transaction that just got rolled back would have been undone along with everything else.)

That answers the "all or nothing" half of the story. It does not answer a question that comes up the moment two transactions run at the same time against the same rows: if a transaction's writes are invisible to everyone else until `COMMIT`, how does Postgres pull that off without making every read wait behind every write? The answer is MVCC - multiple version concurrency control - and the short version is that Postgres never overwrites a row in place. An `UPDATE` inserts a new tuple version next to the old one and marks the old one dead, rather than mutating anything.

Three fields make this concrete. `xmin` is the id of the transaction that created a given tuple version. `xmax` is the id of the transaction that deleted or superseded it, or `0` if it is still the live version. `ctid` is that tuple's current physical address on disk - page number and offset within the page. Insert a row and then update it, and the actual values look like this, captured from a real table:

```text
inserted:               xmin=757, ctid=(0,20), value=1
updated:                xmin=758, xmax=0,      ctid=(0,21), value=2
```

The update did not touch the original tuple's slot. It produced a brand-new tuple at a new `ctid`, stamped with a new `xmin`. Reading the raw page bytes directly with `pageinspect`, bypassing ordinary visibility rules entirely, shows both versions still sitting there:

```text
raw page, OLD line pointer (lp=20): lp_flags=1, t_xmin=757, t_xmax=758, t_ctid=(0,21)
raw page, NEW line pointer (lp=21): lp_flags=1, t_xmin=758, t_xmax=0,   t_ctid=(0,21)
```

The old line pointer is still physically present (`lp_flags=1`), its `t_xmax` is now set to the transaction that replaced it, and its `t_ctid` points forward at the new tuple - a literal chain link on disk between the dead version and the one that superseded it. An ordinary `SELECT` filtering by that old `ctid`, taken from a fresh snapshot after the update committed, finds nothing at all: visibility rules apply even to a scan that names a physical address directly, which is exactly why reaching for `pageinspect` is the only way to see a dead tuple that has not been vacuumed yet.

This versioning is also what lets a plain reader avoid blocking a writer. Open a transaction, run a plain `SELECT` on a row, and hold that transaction open without committing:

```typescript
await reader.begin();
await reader.query("SELECT value FROM counters WHERE label = $1", [LABEL]);
```

A concurrent session can `UPDATE` and `COMMIT` that same row while the reader's transaction is still sitting open, because the plain `SELECT` never took a row lock in the first place - it just read the set of tuple versions visible under its own snapshot. Timed against a writer that runs immediately afterward:

```typescript
const writeStart = Date.now();
await writer.query("UPDATE counters SET value = value + 1 WHERE label = $1", [LABEL]);
const writeElapsedMs = Date.now() - writeStart;
```

the write returns almost instantly, even though the reader is still holding its transaction open for another three seconds. Swap the plain `SELECT` for a locking read, `SELECT ... FOR UPDATE`, on the same row, and the same writer now sits blocked until the reader finishes:

```text
phase 1 (plain SELECT, open tx, held 3000ms): writer's UPDATE returned in   2ms
phase 2 (SELECT ... FOR UPDATE, held 3000ms): writer's UPDATE returned in 3002ms
```

Two milliseconds versus three full seconds, same row, same hold time, same writer. The only variable that changed is whether the reader asked for a row lock. A plain read is just a lookup against already-committed tuple versions; it was never in the writer's way to begin with. `FOR UPDATE` is a different request entirely - it asks Postgres to hold a real lock on the row, and a real lock is exactly what a concurrent writer has to wait behind.

Put the two halves of this together and the connection is direct. A transaction's atomicity guarantee only works because nothing it writes becomes visible to anyone else until `COMMIT` - and MVCC is the reason that visibility rule does not require locking the whole table to enforce. Every reader gets handed its own consistent snapshot of tuple versions that count as already-committed as of that moment, checked against each tuple's `xmin` and `xmax`, with no coordination between readers and no blocking of writers required. Postgres does not need to lock a row just because someone is looking at it, because looking at it and holding it open are two different things: an open transaction protects your own view of the world, not the world itself. That is also why the transfer fix from earlier is safe by construction - a transaction in progress writes new tuple versions that nobody outside it can see, and either all of them become visible together at `COMMIT`, or `ROLLBACK` makes sure none of them ever do.
