# Concurrency Article Rewrite Design

## Goal

Rewrite `locks-vs-optimistic-concurrency.md` as a tighter technical guide without reducing its technical depth. The article should help application developers understand the race, implement both solutions correctly with PostgreSQL and Drizzle ORM, and choose based on the behavior they want under conflict.

## Audience and voice

The audience is application developers who use PostgreSQL and understand basic transactions but may not have a precise model of concurrent writes. The voice should be concrete, direct, and useful. Code and request timelines should establish the behavior before prose explains it.

## Structure

1. **Introduction and concrete race**: Open with two customers reserving the same seat and the broken TypeScript implementation. State what the reader will learn.
2. **Define the invariant**: Show the interleaving once and identify the invariant as at most one successful reservation.
3. **Fix 1: `SELECT FOR UPDATE`**: Present SQL and Drizzle implementations, transaction scope, the waiting request, and the need to keep the critical section short.
4. **Fix 2: conditional update**: Present SQL and Drizzle implementations, zero affected rows as a domain conflict, and status-based versus version-based conditions.
5. **Behavior under contention**: Compare waiting with losing a conditional write. Explain that both approaches use database locking internally and neither removes contention.
6. **Transactions, retries, and failures**: Explain when a conditional update still belongs in a transaction, then cover lock timeouts, deadlocks, idempotency, and safe retry boundaries.
7. **Decision guide**: Give a compact table based on operation shape, contention, conflict behavior, and time between read and write.
8. **Practical takeaways**: End with explicit rules tied to the invariant and the losing request.

## Technical content to retain

- PostgreSQL SQL alongside TypeScript with Drizzle ORM
- The difference between ordinary reads and `SELECT FOR UPDATE`
- The requirement that the lock and related write share one transaction
- Conditional updates that check their returned row or affected-row count
- Version-based optimistic concurrency as a concise extension
- Short locked transactions with no network calls or user think time
- Transactions for multiple writes that must succeed or fail together
- Deadlocks, lock timeouts, conflict responses, and idempotent retries

## Content to remove or consolidate

- Repeated explanations of pessimistic versus optimistic concurrency
- Separate sections that restate waiting versus failing or expected contention
- Multiple conclusions about protecting the invariant
- Examples that do not change the reader's implementation decision

## Constraints

- Preserve the existing frontmatter and hero image reference.
- Do not add, remove, or alter illustrations or image assets.
- Keep the seat-reservation example as the main thread.
- Do not invent benchmarks or production claims.
- Keep code examples internally consistent with the existing schema.

## Verification

- Confirm every section has one distinct job.
- Confirm the article opens with a concrete example and ends with actionable selection rules.
- Check SQL and Drizzle snippets for consistent identifiers and conditions.
- Run the production build so Astro validates content, types, and prerendering.
- Verify the rendered article contains the intended headings and no illustration changes.
