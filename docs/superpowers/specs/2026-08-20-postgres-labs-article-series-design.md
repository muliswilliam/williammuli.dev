---
title: PostgreSQL labs article series - design
description: Plan for turning labs 2-11 of the systems-engineering-lab repo into four long-form blog posts.
date: 2026-08-20
---

## Purpose

Turn labs 2-11 of `~/projects/systems-engineering-lab` (a hands-on PostgreSQL/backend systems curriculum) into a four-part article series for the public writing section of this site. Each lab already has a substantial README (300-600 lines) covering the concept, a naive/broken scenario, a fix, and production notes - that's the raw material.

## Source material

Repo: `~/projects/systems-engineering-lab`

- Lab 02 - Relational Modeling and Constraints
- Lab 03 - SQL Querying and Query Plans
- Lab 04 - Indexes and Performance Basics
- Lab 05 - Transactions and Atomicity
- Lab 06 - MVCC and Visibility
- Lab 07 - Isolation: Read Committed
- Lab 08 - Repeatable Read and Snapshots
- Lab 09 - Serializable and Retries
- Lab 10 - Row Locks and SELECT ... FOR UPDATE
- Lab 11 - Conditional Writes and Optimistic Concurrency

## Output

Four markdown files in `src/content/writing/`, matching the existing frontmatter schema:

```yaml
---
title: string (lowercase, matches site convention)
description: string
date: date
heroImage: /writing/<slug>-hero.jpg
heroAlt: string
tags: [array of strings]
---
```

### Article A - `postgres-schema-and-query-plans`

Labs: 02, 03, 04.

Angle: constraints as invariants, reading `EXPLAIN`, and why an index isn't free - the foundation before concurrency enters the picture.

### Article B - `transactions-and-what-postgres-actually-sees`

Labs: 05, 06.

Angle: atomicity via a broken-then-fixed money transfer, then MVCC/tuple visibility (`xmin`/`xmax`) as the mechanism that makes transactions possible without blocking every reader.

### Article C - `isolation-levels-anomalies-and-retries`

Labs: 07, 08, 09.

Angle: Read Committed to Repeatable Read to Serializable as an escalating story - same two-transaction scenario, three isolation levels, three different (mis)behaviors, ending in why Serializable needs a retry loop.

### Article D - `locks-vs-optimistic-concurrency`

Labs: 10, 11.

Angle: `SELECT ... FOR UPDATE` vs `WHERE version = ?` conditional updates on the same race condition (two buyers, one seat) - when to block vs when to fail-and-retry.

## Per-article structure

Loose and prose-driven, not a rigid checklist of headers:

1. Hook - the production scenario that makes the concept matter (1-2 short paragraphs, personal framing: "I wanted to see X actually happen").
2. The concept, explained precisely.
3. Real evidence - actual SQL/schema/query output pulled from the lab repo, shown inline as code blocks.
4. The break - what goes wrong naively, shown concretely.
5. The fix and why it works.
6. A short closing on tradeoffs / when you'd reach for the alternative mechanism.

Length target: 1200-2000 words per article.

## Voice

Hybrid: personal hook and framing, then a rigorous technical explainer for the bulk of the piece. Direct, plain statements. No em-dash (use "-"). Avoid AI-tell constructions like "it's not just X, it's Y" or "the difference is stark" - state the fact and move on.

## Sourcing approach

For each article, read the relevant lab READMEs and source files (schema, seed scripts, scenario scripts, SQL) directly from `~/projects/systems-engineering-lab/labs/<lab>/` to pull accurate, real snippets rather than paraphrasing from memory. Verify any command or query shown actually appears in the lab before including it.

## Open item

The site schema requires `heroImage`, but no images exist yet for these four posts. Each article's frontmatter will use a placeholder path following the existing convention (`/writing/<slug>-hero.jpg`); the actual image files are not part of this work and should be added before publishing.

## Out of scope

- Labs 01, and 12+ (not part of this series).
- Any code changes to either repo.
- Hero image creation.
- Publishing/deployment.
