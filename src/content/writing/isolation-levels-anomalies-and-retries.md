---
title: isolation levels, anomalies, and retries
description: The same race condition under read committed, repeatable read, and serializable, and why the last one needs a retry loop.
date: 2026-08-20
heroImage: /writing/isolation-levels-anomalies-and-retries-hero.jpg
tags: [postgresql, isolation-levels, concurrency, transactions]
---

A teammate once asked me why a balance he had just read at the top of a transaction was different by the time he read it again, twenty lines later, before he had committed anything. He was convinced it was a bug in our code, maybe a caching layer we didn't know about. It wasn't a bug. It was Postgres doing exactly what its default isolation level promises, and nobody on the team had read that promise closely enough to expect it.

That conversation is the reason I eventually ran the same two-transaction race three times against a real Postgres instance, once under each isolation level people actually reach for, and wrote down what happened. The race barely changes shape. The outcome changes completely, and the third version explains why "just use serializable" is not free advice.

Start with Read Committed, Postgres's default. The setup is deliberately small: one `accounts` row with a `balance_cents` column, and two independent connections. Transaction A opens, reads the balance, and does not commit yet. Transaction B opens on its own connection, updates that same row, and commits. Transaction A, still open, still uncommitted, runs the exact same `SELECT balance_cents FROM accounts WHERE id = $1` a second time. A real captured run from the lab looks like this:

```text
transaction A: first read           accountId=26  firstRead=2000000
transaction B: BEGIN, UPDATE, COMMIT accountId=26  committedBalanceCents=2025000
transaction A: second read          accountId=26  secondRead=2025000
```

Transaction A never committed and never rolled back. It ran one query twice and got two different answers. That is a non-repeatable read, and it is not a bug - it is the documented behavior of Read Committed, which takes a fresh snapshot at the start of every *statement*, not once per transaction. A later statement in an open transaction can see commits that landed after the transaction began, as long as they landed before that statement ran. If your code reads a value once and reuses it later in the same transaction, assuming it can't have changed underneath you, Read Committed does not back that assumption up.

The natural next question, especially from anyone who has used a database with a real READ UNCOMMITTED mode, is whether Postgres will show you a write that hasn't even committed yet - a dirty read. It won't, and it is worth watching it not happen instead of just taking the claim on faith. The lab's `dirty-read-attempt.ts` scenario has transaction A debit a row and deliberately withhold the commit, then has transaction B open with an explicit `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED` and read the same row while A is still hanging open:

```json
{"accountId":"25","originalBalanceCents":1000000}
{"accountId":"25","uncommittedBalanceCents":995000}
{"requestedIsolationLevel":"READ UNCOMMITTED","actualIsolationLevel":"read uncommitted"}
{"balanceSeenWhileAUncommitted":1000000,"aStillUncommitted":995000}
{"balanceSeenAfterACommit":995000}
{"sawDirtyRead":false}
```

B asked for READ UNCOMMITTED by name, and Postgres accepted the request without complaint - `actualIsolationLevel` even echoes the label back. B's read still returned the original, committed value, not A's in-flight debit. Only after A committed did B's next read pick up the change. `read-uncommitted-vs-read-committed.ts` makes the point more directly by running the identical non-repeatable-read experiment twice, once requesting each level, and diffing the results.

```json
{"requestedIsolationLevel":"READ COMMITTED","actualIsolationLevel":"read committed","firstRead":3000000,"secondRead":3025000}
{"requestedIsolationLevel":"READ UNCOMMITTED","actualIsolationLevel":"read uncommitted","firstRead":3000000,"secondRead":3025000}
{"behaviorIsIdentical":true}
```

Same first read, same second read, same everything except the echoed label. Postgres accepts READ UNCOMMITTED as valid syntax, for SQL-standard portability, and maps it onto the exact same Read Committed machinery, because there is no separate, weaker visibility rule underneath it to select. MVCC checks a tuple's commit status, not the isolation level of whoever is looking at it: an in-flight update has no committed version for anyone else's snapshot to include, no matter what that snapshot claims to be.

Repeatable Read exists for exactly the complaint my teammate had. It takes one snapshot at the start of the transaction and reuses it for every statement inside that transaction, instead of taking a fresh one per statement. Rerun the identical setup - A reads, B updates and commits, A reads again in the same open transaction - under Repeatable Read instead of Read Committed, and the second read no longer moves:

```json
{"accountId":"8","firstRead":2000000}
{"accountId":"8","committedBalanceCents":2025000}
{"accountId":"8","secondRead":2000000}
```

`secondRead` matches `firstRead`, not the committed value. That fixes the non-repeatable read. It also changes what happens when two transactions race to update the same row: instead of one commit silently overwriting the other's intent based on stale data, Postgres detects that the row changed since the snapshot was taken and refuses the second writer. Two Repeatable Read transactions both read a balance, both compute a new balance from what they read, and both try to commit:

```json
{"accountId":"9","aRead":500000,"bRead":500000}
{"accountId":"9","aNewBalance":510000}
{"accountId":"9","bErrorCode":"40001","bErrorMessage":"could not serialize access due to concurrent update"}
```

A's update and commit succeed. B's update fails outright with a real Postgres error, SQLSTATE `40001`. Nothing is silently lost - B's transaction must be retried by whatever called it, or its intended write never happens.

That same-row protection has a well-known blind spot, though, and it is the reason Repeatable Read is not the end of the story. It has no way to catch an invariant that spans two different rows. The canonical version of this, straight out of the Postgres documentation, is two on-call staff members and a rule that at least one of them must always be reachable. Each one checks "is my colleague still on call?", sees yes, and decides it's safe to go off call themselves:

```json
{"staffAId":"8","staffBId":"9","aSawBOnCallBeforeWriting":true,"bSawAOnCallBeforeWriting":true}
{"staffAId":"8","aWentOffCall":true}
{"staffBId":"9","bWentOffCall":true}
{"aCommitted":true,"bCommitted":true,"finalOnCallCount":0,"invariantViolated":true}
```

Both transactions committed. Both reads were completely accurate as of the snapshot each one took. Neither transaction touched the row the other wrote to, so the same-row check that produced `40001` above never had anything to fire on. The result is zero staff on call, which the invariant was supposed to prevent, with no error raised anywhere. This is write skew, and it is not a bug in either transaction's logic - each one behaved correctly relative to the snapshot it was handed. The anomaly belongs to the isolation level, not the application code.

Serializable is the level built to catch that. Run the identical hand-scripted interleaving - the same two doctors, the same reads, the same order of commits - and change only the requested isolation level from REPEATABLE READ to SERIALIZABLE:

```json
{"aliceId":"13","bobId":"14","actualIsolationLevel":"serializable"}
{"othersOnCallSeenByAlice":1}
{"othersOnCallSeenByBob":1}
"transaction A: Alice commits 'go off call' - succeeds, no conflict yet"
{"sqlstate":"40001","message":"could not serialize access due to read/write dependencies among transactions"}
{"onCallCountAfter":1,"invariantHeld":true}
```

Alice's commit goes through - nothing has gone wrong from Postgres's point of view yet, because up to that point nobody's write has conflicted with anybody's read. Bob's commit is rejected, with a real SQLSTATE, `40001`, and a message naming exactly what happened: a read/write dependency cycle among concurrent transactions. Underneath, Postgres's Serializable Snapshot Isolation tracks what each transaction's queries logically depended on, using predicate locks, and watches for rw-antidependencies - cases where one transaction read a value that another transaction later overwrote. Alice's transaction read Bob's row while it was still true, and Bob's transaction later wrote it to false; Bob's transaction read Alice's row while it was still true, and Alice's transaction later wrote it to false. Two edges in opposite directions between the same two transactions form a cycle, the dangerous structure SSI exists to detect. Since Alice already committed, Postgres can't undo her, so it aborts Bob instead. The invariant holds: one doctor stays on call.

But an aborted transaction is only half a fix - Bob's actual request, to go off call if it's safe, has simply vanished along with the error. The lab's retry loop, `serializable-with-retry.ts`, closes that gap:

```typescript
export async function retryGoOffCall(
  connectionString: string,
  team: string,
  staffName: string,
  staffId: number,
  opts: { maxAttempts?: number; firstAttemptDelayMs?: number } = {},
): Promise<RetryOutcome> {
  const maxAttempts = opts.maxAttempts ?? 5;
  let conflictsEncountered = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await attemptGoOffCall(connectionString, team, staffId, {
      firstAttemptDelayMs: attempt === 1 ? opts.firstAttemptDelayMs : undefined,
    });

    if (result.outcome === "committed" || result.outcome === "rejected") {
      log.info(
        { staffName, staffId, attempt, outcome: result.outcome, othersOnCall: result.othersOnCall },
        `attempt ${attempt}: terminal outcome`,
      );
      return { staffName, staffId, finalOutcome: result.outcome, attempts: attempt, conflictsEncountered };
    }

    conflictsEncountered += 1;
    const backoffMs = randomizedBackoffMs(attempt);
    log.warn(
      { staffName, staffId, attempt, sqlstate: result.sqlstate, backoffMs: Math.round(backoffMs) },
      `attempt ${attempt}: serialization failure (${result.sqlstate}) - backing off and retrying with fresh reads`,
    );
    await sleep(backoffMs);
  }

  throw new Error(`${staffName}: exhausted ${maxAttempts} attempts without a terminal outcome`);
}
```

The bound matters: an unbounded retry under sustained contention can spin forever, so this throws loudly instead of looping past `maxAttempts`. The backoff matters too, since retrying instantly just recreates the same collision. But the detail that makes this correct, rather than merely persistent, is that every attempt opens a brand-new transaction and re-reads current state from scratch, instead of replaying the original decision with the values it read the first time. Run it against real concurrency and that shows up directly:

```json
{"staffName":"Dr. Bob Nkemelu","attempt":1,"outcome":"conflict","sqlstate":"40001","backoffMs":46}
{"staffName":"Dr. Alice Chen","attempt":1,"outcome":"committed","othersOnCall":1}
{"staffName":"Dr. Bob Nkemelu","attempt":2,"outcome":"rejected","othersOnCall":0}
{"onCallCountAfter":1,"invariantHeld":true,"exactlyOneSucceeded":true}
```

Bob's first attempt conflicts and backs off. On his second attempt, he re-reads and sees `othersOnCall: 0`, because Alice's clock-out already committed while he was waiting - so he correctly and permanently refuses. That refusal isn't a failure to retry again; it's the loop discovering the real answer changed while it wasn't looking, which is exactly what a retry loop should do when the decision is time-sensitive.

Put the three levels side by side and they are running the exact same two-transaction shape: two participants, each reading before either writes, each acting on what they read. What changes is the question Postgres is willing to ask on their behalf. Read Committed only promises that each statement sees committed data as of that statement's start, so it never notices that two statements inside one transaction disagreed with each other. Repeatable Read promises that every statement inside a transaction agrees with every other statement in that transaction, which is enough to catch a same-row write racing against stale data, but that promise is scoped to rows a transaction actually touches, not to invariants that live only in application logic and span rows nobody locked together. Serializable promises something stronger: that the whole set of committed transactions is equivalent to running them one at a time in some order, which requires tracking read/write dependencies across rows and aborting whichever transaction would break that equivalence. Same race, three different outcomes, because "what can this transaction see" and "what dependencies count as dangerous" are different questions at each level, not three settings on the same dial.

None of that makes Serializable the obvious default. The lab measured the same five-person version of the on-call race under both approaches: Serializable with a retry loop needed eleven total attempts and six real `40001` conflicts to land on the correct outcome of four committed and one correctly rejected, in 331 milliseconds. The same workload under Repeatable Read with no retry logic needed exactly five attempts, zero conflicts, and 186 milliseconds - and reached the wrong answer, with every staff member off call. Serializable is slower not because it's poorly implemented, but because catching the anomaly requires real bookkeeping (predicate locks recording what every transaction's queries logically read) and an abort-and-retry round trip whenever two transactions' read sets and write sets cross in the wrong pattern. That cost rises with contention, not just row count, so a hot, frequently-written invariant sees far more aborts than a rarely-touched one. If the invariant can be reshaped to live in a single row - a counter with a `CHECK` constraint and a conditional `UPDATE`, say - a plain Read Committed write against that one row gets the same guarantee without needing Serializable's retry machinery at all. Reach for Serializable when the invariant genuinely spans multiple rows and can't be reshaped, when the retry cost is affordable, and when every code path opening a Serializable transaction is actually prepared to catch `40001` and try again - the guarantee only holds if something on your side is listening for the error.
