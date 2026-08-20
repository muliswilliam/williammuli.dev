# Postgres Labs Article Series Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write four long-form articles for the site's writing section, adapting labs 02-11 of `~/projects/systems-engineering-lab` into publishable posts.

**Architecture:** Each article is an independent markdown file dropped into `src/content/writing/`. Astro's content collection uses a glob loader (`src/content.config.ts`) that picks up any new `*.md` file in that folder automatically - no registration step needed. Each file must satisfy the collection's Zod schema (`title`, `description`, `date`, `heroImage`, `heroAlt`, `tags`).

**Tech Stack:** Astro content collections (markdown + YAML frontmatter), no code changes, verification via `npm run build` (schema validation) and shell checks (word count, banned phrasing, snippet accuracy).

## Global Constraints

- Source repo for all facts/snippets: `~/projects/systems-engineering-lab`. Every SQL/code snippet quoted in an article must appear verbatim in a file under that repo - verify with `grep -F` before committing.
- Output repo: `~/projects/personal-website`. Files go in `src/content/writing/<slug>.md`. No other files are modified.
- Frontmatter schema (from `src/content.config.ts`): `title: string`, `description: string`, `date: coerced date`, `heroImage: string`, `heroAlt: string` (default `"Heading image"`), `tags: string[]`.
- `heroImage` uses placeholder path `/writing/<slug>-hero.jpg` per existing site convention (see `browser-hero.jpg`, `flux-hero.jpg`). The actual image file is out of scope for this plan.
- Length: 1200-2000 words per article, measured excluding frontmatter.
- Voice: personal hook (1-2 short paragraphs) then a rigorous technical explainer. No em dash (`—`) anywhere - use `-`. No "it's not just X, it's Y" or "the difference is stark" constructions, or similar AI-tell phrasing.
- Structure per article (prose-driven, not literal headers): hook -> concept explained precisely -> real evidence (SQL/code pulled from the lab repo) -> the naive break -> the fix and why it works -> tradeoffs / when you'd use the alternative.
- Titles are lowercase, matching existing posts (`how a browser loads a page`, `understanding flux architecture`).
- `date: 2026-08-20` for all four articles (today's date at plan authorship time).

---

### Task 1: Article A - postgres schema design, query plans, and indexes

**Files:**
- Create: `src/content/writing/postgres-schema-and-query-plans.md`
- Read (source of facts/snippets), all under `~/projects/systems-engineering-lab/labs/`:
  - `02-relational-modeling-and-constraints/README.md`
  - `02-relational-modeling-and-constraints/src/db/schema.ts`
  - `02-relational-modeling-and-constraints/src/scenarios/naive-inserts.ts`
  - `02-relational-modeling-and-constraints/src/scenarios/corrected-inserts.ts`
  - `02-relational-modeling-and-constraints/drizzle/0000_redundant_klaw.sql`
  - `03-sql-querying-and-query-plans/README.md`
  - `03-sql-querying-and-query-plans/src/scenarios/explain-demo.ts`
  - `03-sql-querying-and-query-plans/src/scenarios/naive-report.ts`
  - `03-sql-querying-and-query-plans/src/scenarios/corrected-report.ts`
  - `04-indexes-and-performance-basics/README.md`
  - `04-indexes-and-performance-basics/src/scenarios/before-indexing.ts`
  - `04-indexes-and-performance-basics/src/scenarios/after-indexing.ts`
  - `04-indexes-and-performance-basics/src/scenarios/index-definitions.ts`
  - `04-indexes-and-performance-basics/drizzle/0001_add_performance_indexes.sql`

**Interfaces:**
- Consumes: nothing from other tasks (independent article).
- Produces: nothing consumed by other tasks (standalone deliverable). Optional: article may casually mention the series exists, but must not hard-link to slugs from Tasks 2-4 since those files won't exist yet when this task runs.

**Content requirements** (must all be present in the draft):
- The problem a foreign key / `NOT NULL` / `UNIQUE` / `CHECK` constraint actually prevents, shown with the real constraint definition from `02-relational-modeling-and-constraints/src/db/schema.ts` and the specific naive insert from `naive-inserts.ts` that the constraint rejects (with the actual Postgres error).
- The internal numeric ID + public UUID pattern from lab 02's schema, and why both exist (join/index performance internally, non-guessable identifier externally).
- At least one real query from lab 03 (a join, a CTE, or a window function) shown as actual SQL or Drizzle code from the scenario files, paired with what `EXPLAIN` reports for it (sequential scan vs the shape of the plan) from `explain-demo.ts` or the README's observed output.
- The naive vs corrected report comparison from `naive-report.ts` / `corrected-report.ts` - what was wrong with the naive query (e.g. join fan-out or a missing aggregation) and what changed.
- A concrete before/after from lab 04: the query from `before-indexing.ts`, its plan without the index, the index definition from `index-definitions.ts` or the migration SQL, and the plan after.
- At least one sentence on write amplification / index maintenance cost - indexes are not free.

- [ ] **Step 1: Read the source material**

Run and read the full contents of each file listed above:

```bash
cat ~/projects/systems-engineering-lab/labs/02-relational-modeling-and-constraints/README.md
cat ~/projects/systems-engineering-lab/labs/02-relational-modeling-and-constraints/src/db/schema.ts
cat ~/projects/systems-engineering-lab/labs/02-relational-modeling-and-constraints/src/scenarios/naive-inserts.ts
cat ~/projects/systems-engineering-lab/labs/02-relational-modeling-and-constraints/src/scenarios/corrected-inserts.ts
cat ~/projects/systems-engineering-lab/labs/03-sql-querying-and-query-plans/README.md
cat ~/projects/systems-engineering-lab/labs/03-sql-querying-and-query-plans/src/scenarios/explain-demo.ts
cat ~/projects/systems-engineering-lab/labs/03-sql-querying-and-query-plans/src/scenarios/naive-report.ts
cat ~/projects/systems-engineering-lab/labs/03-sql-querying-and-query-plans/src/scenarios/corrected-report.ts
cat ~/projects/systems-engineering-lab/labs/04-indexes-and-performance-basics/README.md
cat ~/projects/systems-engineering-lab/labs/04-indexes-and-performance-basics/src/scenarios/before-indexing.ts
cat ~/projects/systems-engineering-lab/labs/04-indexes-and-performance-basics/src/scenarios/after-indexing.ts
cat ~/projects/systems-engineering-lab/labs/04-indexes-and-performance-basics/src/scenarios/index-definitions.ts
```

Note down, for each "content requirement" above, which file and line range you'll quote from.

- [ ] **Step 2: Write the draft**

Create `src/content/writing/postgres-schema-and-query-plans.md` with this exact frontmatter:

```markdown
---
title: postgres schema design, query plans, and indexes
description: What a foreign key actually prevents, how to read an EXPLAIN plan, and why an index isn't free.
date: 2026-08-20
heroImage: /writing/postgres-schema-and-query-plans-hero.jpg
heroAlt: Heading image
tags: [postgresql, sql, database-design, performance]
---
```

Follow with the article body per the "Content requirements" list above and the structure/voice rules in Global Constraints. Every SQL/TypeScript snippet quoted must be copied verbatim (not paraphrased) from the files read in Step 1.

- [ ] **Step 3: Verify word count**

```bash
awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' ~/projects/personal-website/src/content/writing/postgres-schema-and-query-plans.md | wc -w
```

Expected: a number between 1200 and 2000. If outside that range, edit the draft and re-run.

- [ ] **Step 4: Verify no banned phrasing**

```bash
grep -nE "it.s not just|the difference is stark|—" ~/projects/personal-website/src/content/writing/postgres-schema-and-query-plans.md
```

Expected: no output (empty). If it matches, rewrite the flagged line and re-run.

- [ ] **Step 5: Verify snippet accuracy**

For every fenced code block in the article that claims to be SQL or TypeScript from the lab, confirm it appears in the cited source file. Example check (repeat per snippet, adjusting the search string):

```bash
grep -F "REPLACE_WITH_EXACT_SNIPPET_LINE" ~/projects/systems-engineering-lab/labs/02-relational-modeling-and-constraints/src/db/schema.ts
```

Expected: the line is found in the source file for every snippet. If a snippet doesn't match, fix the quote in the article rather than the source.

- [ ] **Step 6: Validate the content schema**

```bash
cd ~/projects/personal-website && npm run build
```

Expected: build succeeds with no Zod validation error for the `writing` collection (an invalid frontmatter field or missing required key fails the build with a content collection error naming the file).

- [ ] **Step 7: Commit**

```bash
cd ~/projects/personal-website
git add src/content/writing/postgres-schema-and-query-plans.md
git commit -m "$(cat <<'EOF'
docs: add "postgres schema design, query plans, and indexes" article

Adapts labs 02-04 from systems-engineering-lab (constraints, query plans, indexing).
EOF
)"
```

---

### Task 2: Article B - transactions and what postgres actually sees

**Files:**
- Create: `src/content/writing/transactions-and-what-postgres-actually-sees.md`
- Read, all under `~/projects/systems-engineering-lab/labs/`:
  - `05-transactions-and-atomicity/README.md`
  - `05-transactions-and-atomicity/src/scenarios/naive-transfer.ts`
  - `05-transactions-and-atomicity/src/scenarios/transactional-transfer.ts`
  - `05-transactions-and-atomicity/src/scenarios/balance-utils.ts`
  - `05-transactions-and-atomicity/src/db/schema.ts`
  - `06-mvcc-and-visibility/README.md`
  - `06-mvcc-and-visibility/src/scenarios/xmin-xmax-ctid.ts`
  - `06-mvcc-and-visibility/src/scenarios/readers-dont-block-writers.ts`
  - `06-mvcc-and-visibility/src/scenarios/snapshot-isolation.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks.

**Content requirements:**
- A concrete money-transfer scenario: the naive version from `naive-transfer.ts` where a crash/failure between the debit and credit write leaves accounts inconsistent, with the actual balances or code path that produces the inconsistency.
- The fixed version from `transactional-transfer.ts` wrapping both writes in one `BEGIN`/`COMMIT`, quoted verbatim, and why atomicity closes the gap (there is no observable intermediate state).
- MVCC explained precisely: what `xmin`, `xmax`, and `ctid` are, using the actual query/output from `xmin-xmax-ctid.ts`.
- A concrete demonstration from `readers-dont-block-writers.ts` or `snapshot-isolation.ts`: two sessions, one holding a transaction open, and what a second session sees or doesn't block on - quoting the real scenario code/SQL.
- A closing paragraph tying MVCC back to Task 1's transactions: Postgres doesn't lock the table for every read because each transaction sees a consistent snapshot of committed tuple versions.

- [ ] **Step 1: Read the source material**

```bash
cat ~/projects/systems-engineering-lab/labs/05-transactions-and-atomicity/README.md
cat ~/projects/systems-engineering-lab/labs/05-transactions-and-atomicity/src/scenarios/naive-transfer.ts
cat ~/projects/systems-engineering-lab/labs/05-transactions-and-atomicity/src/scenarios/transactional-transfer.ts
cat ~/projects/systems-engineering-lab/labs/05-transactions-and-atomicity/src/scenarios/balance-utils.ts
cat ~/projects/systems-engineering-lab/labs/05-transactions-and-atomicity/src/db/schema.ts
cat ~/projects/systems-engineering-lab/labs/06-mvcc-and-visibility/README.md
cat ~/projects/systems-engineering-lab/labs/06-mvcc-and-visibility/src/scenarios/xmin-xmax-ctid.ts
cat ~/projects/systems-engineering-lab/labs/06-mvcc-and-visibility/src/scenarios/readers-dont-block-writers.ts
cat ~/projects/systems-engineering-lab/labs/06-mvcc-and-visibility/src/scenarios/snapshot-isolation.ts
```

- [ ] **Step 2: Write the draft**

Create `src/content/writing/transactions-and-what-postgres-actually-sees.md` with this exact frontmatter:

```markdown
---
title: transactions and what postgres actually sees
description: A broken money transfer, a fixed one, and the MVCC machinery that makes both possible.
date: 2026-08-20
heroImage: /writing/transactions-and-what-postgres-actually-sees-hero.jpg
heroAlt: Heading image
tags: [postgresql, transactions, mvcc, database-internals]
---
```

Follow with the article body per the "Content requirements" list and the Global Constraints structure/voice rules.

- [ ] **Step 3: Verify word count**

```bash
awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' ~/projects/personal-website/src/content/writing/transactions-and-what-postgres-actually-sees.md | wc -w
```

Expected: between 1200 and 2000.

- [ ] **Step 4: Verify no banned phrasing**

```bash
grep -nE "it.s not just|the difference is stark|—" ~/projects/personal-website/src/content/writing/transactions-and-what-postgres-actually-sees.md
```

Expected: no output.

- [ ] **Step 5: Verify snippet accuracy**

For every SQL/TypeScript snippet in the article, confirm it appears in its cited source file, e.g.:

```bash
grep -F "REPLACE_WITH_EXACT_SNIPPET_LINE" ~/projects/systems-engineering-lab/labs/05-transactions-and-atomicity/src/scenarios/transactional-transfer.ts
```

Expected: found for every snippet.

- [ ] **Step 6: Validate the content schema**

```bash
cd ~/projects/personal-website && npm run build
```

Expected: build succeeds, no schema validation error.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/personal-website
git add src/content/writing/transactions-and-what-postgres-actually-sees.md
git commit -m "$(cat <<'EOF'
docs: add "transactions and what postgres actually sees" article

Adapts labs 05-06 from systems-engineering-lab (atomicity, MVCC/visibility).
EOF
)"
```

---

### Task 3: Article C - isolation levels, anomalies, and retries

**Files:**
- Create: `src/content/writing/isolation-levels-anomalies-and-retries.md`
- Read, all under `~/projects/systems-engineering-lab/labs/`:
  - `07-isolation-read-committed/README.md`
  - `07-isolation-read-committed/src/scenarios/dirty-read-attempt.ts`
  - `07-isolation-read-committed/src/scenarios/non-repeatable-read.ts`
  - `07-isolation-read-committed/src/scenarios/read-uncommitted-vs-read-committed.ts`
  - `08-repeatable-read-and-snapshots/README.md`
  - `08-repeatable-read-and-snapshots/src/scenarios/repeatable-read-snapshot.ts`
  - `08-repeatable-read-and-snapshots/src/scenarios/concurrent-write-conflict.ts`
  - `08-repeatable-read-and-snapshots/src/scenarios/write-skew.ts`
  - `09-serializable-and-retries/README.md`
  - `09-serializable-and-retries/src/scenarios/serializable-detects-conflict.ts`
  - `09-serializable-and-retries/src/scenarios/serializable-with-retry.ts`
  - `09-serializable-and-retries/src/scenarios/write-skew-under-repeatable-read.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks.

**Content requirements:**
- Read Committed section: the actual non-repeatable read demonstrated in `non-repeatable-read.ts` (same query run twice in one transaction, different results because another transaction committed in between), and the explicit statement, sourced from the README, that Postgres's `READ UNCOMMITTED` behaves like `READ COMMITTED` (no dirty reads ever) - cite the specific scenario/test that proves this (`read-uncommitted-vs-read-committed.ts` or `dirty-read-attempt.ts`).
- Repeatable Read section: the snapshot behavior from `repeatable-read-snapshot.ts` (same query repeated returns the same result even after a concurrent commit), and the write skew example from `write-skew.ts` - two transactions that each look individually valid under Repeatable Read but together violate an invariant.
- Serializable section: the same or an analogous scenario re-run under Serializable in `serializable-detects-conflict.ts`, showing the serialization failure (actual Postgres error/SQLSTATE), then the retry loop from `serializable-with-retry.ts` (bounded attempts, backoff) quoted verbatim.
- One paragraph explicitly contrasting all three: same two-transaction shape, three different outcomes, because each level answers "what can this transaction see and what dependencies get flagged" differently.
- A closing paragraph on why Serializable isn't the default choice: it trades throughput/retries for the guarantee, referencing `contention-and-throughput.ts` if it has concrete numbers.

- [ ] **Step 1: Read the source material**

```bash
cat ~/projects/systems-engineering-lab/labs/07-isolation-read-committed/README.md
cat ~/projects/systems-engineering-lab/labs/07-isolation-read-committed/src/scenarios/dirty-read-attempt.ts
cat ~/projects/systems-engineering-lab/labs/07-isolation-read-committed/src/scenarios/non-repeatable-read.ts
cat ~/projects/systems-engineering-lab/labs/07-isolation-read-committed/src/scenarios/read-uncommitted-vs-read-committed.ts
cat ~/projects/systems-engineering-lab/labs/08-repeatable-read-and-snapshots/README.md
cat ~/projects/systems-engineering-lab/labs/08-repeatable-read-and-snapshots/src/scenarios/repeatable-read-snapshot.ts
cat ~/projects/systems-engineering-lab/labs/08-repeatable-read-and-snapshots/src/scenarios/concurrent-write-conflict.ts
cat ~/projects/systems-engineering-lab/labs/08-repeatable-read-and-snapshots/src/scenarios/write-skew.ts
cat ~/projects/systems-engineering-lab/labs/09-serializable-and-retries/README.md
cat ~/projects/systems-engineering-lab/labs/09-serializable-and-retries/src/scenarios/serializable-detects-conflict.ts
cat ~/projects/systems-engineering-lab/labs/09-serializable-and-retries/src/scenarios/serializable-with-retry.ts
cat ~/projects/systems-engineering-lab/labs/09-serializable-and-retries/src/scenarios/write-skew-under-repeatable-read.ts
```

- [ ] **Step 2: Write the draft**

Create `src/content/writing/isolation-levels-anomalies-and-retries.md` with this exact frontmatter:

```markdown
---
title: isolation levels, anomalies, and retries
description: The same race condition under read committed, repeatable read, and serializable, and why the last one needs a retry loop.
date: 2026-08-20
heroImage: /writing/isolation-levels-anomalies-and-retries-hero.jpg
heroAlt: Heading image
tags: [postgresql, isolation-levels, concurrency, transactions]
---
```

Follow with the article body per the "Content requirements" list and the Global Constraints structure/voice rules.

- [ ] **Step 3: Verify word count**

```bash
awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' ~/projects/personal-website/src/content/writing/isolation-levels-anomalies-and-retries.md | wc -w
```

Expected: between 1200 and 2000.

- [ ] **Step 4: Verify no banned phrasing**

```bash
grep -nE "it.s not just|the difference is stark|—" ~/projects/personal-website/src/content/writing/isolation-levels-anomalies-and-retries.md
```

Expected: no output.

- [ ] **Step 5: Verify snippet accuracy**

```bash
grep -F "REPLACE_WITH_EXACT_SNIPPET_LINE" ~/projects/systems-engineering-lab/labs/09-serializable-and-retries/src/scenarios/serializable-with-retry.ts
```

Expected: found for every quoted snippet, checked against its actual cited source file.

- [ ] **Step 6: Validate the content schema**

```bash
cd ~/projects/personal-website && npm run build
```

Expected: build succeeds, no schema validation error.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/personal-website
git add src/content/writing/isolation-levels-anomalies-and-retries.md
git commit -m "$(cat <<'EOF'
docs: add "isolation levels, anomalies, and retries" article

Adapts labs 07-09 from systems-engineering-lab (read committed, repeatable read, serializable).
EOF
)"
```

---

### Task 4: Article D - locks vs optimistic concurrency

**Files:**
- Create: `src/content/writing/locks-vs-optimistic-concurrency.md`
- Read, all under `~/projects/systems-engineering-lab/labs/`:
  - `10-row-locks-and-select-for-update/README.md`
  - `10-row-locks-and-select-for-update/src/scenarios/lost-update-without-lock.ts`
  - `10-row-locks-and-select-for-update/src/scenarios/select-for-update.ts`
  - `10-row-locks-and-select-for-update/src/scenarios/lock-modes.ts`
  - `10-row-locks-and-select-for-update/src/scenarios/nowait-and-lock-timeout.ts`
  - `11-conditional-writes-and-optimistic-concurrency/README.md`
  - `11-conditional-writes-and-optimistic-concurrency/src/scenarios/lost-update-naive.ts`
  - `11-conditional-writes-and-optimistic-concurrency/src/scenarios/optimistic-concurrency.ts`
  - `11-conditional-writes-and-optimistic-concurrency/src/scenarios/conditional-write-publish.ts`
  - `11-conditional-writes-and-optimistic-concurrency/src/scenarios/lock-comparison.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by other tasks.

**Content requirements:**
- The lost-update race shown naively in `lost-update-without-lock.ts` (or lab 11's `lost-update-naive.ts`): two concurrent read-then-write sequences on the same row, one update silently overwriting the other.
- The row-lock fix from `select-for-update.ts`: the actual `SELECT ... FOR UPDATE` statement, what it blocks (the second transaction waits instead of racing), and at least one lock mode distinction from `lock-modes.ts` (e.g. `FOR UPDATE` vs `FOR SHARE` vs `FOR NO KEY UPDATE`).
- The `NOWAIT`/lock-timeout variant from `nowait-and-lock-timeout.ts` - failing fast instead of waiting, and when that's preferable.
- The optimistic alternative from `optimistic-concurrency.ts` / `conditional-write-publish.ts`: the `WHERE id = ? AND version = ?` conditional update, quoted verbatim, and what happens on a lost race (zero rows affected, caller detects and retries) instead of blocking.
- A direct comparison paragraph, ideally referencing `lock-comparison.ts` if it runs both approaches: when you'd choose blocking (short critical section, contention is the common case) vs when you'd choose optimistic (long user-think-time between read and write, contention is rare, or you want to fail fast without holding a connection open).

- [ ] **Step 1: Read the source material**

```bash
cat ~/projects/systems-engineering-lab/labs/10-row-locks-and-select-for-update/README.md
cat ~/projects/systems-engineering-lab/labs/10-row-locks-and-select-for-update/src/scenarios/lost-update-without-lock.ts
cat ~/projects/systems-engineering-lab/labs/10-row-locks-and-select-for-update/src/scenarios/select-for-update.ts
cat ~/projects/systems-engineering-lab/labs/10-row-locks-and-select-for-update/src/scenarios/lock-modes.ts
cat ~/projects/systems-engineering-lab/labs/10-row-locks-and-select-for-update/src/scenarios/nowait-and-lock-timeout.ts
cat ~/projects/systems-engineering-lab/labs/11-conditional-writes-and-optimistic-concurrency/README.md
cat ~/projects/systems-engineering-lab/labs/11-conditional-writes-and-optimistic-concurrency/src/scenarios/lost-update-naive.ts
cat ~/projects/systems-engineering-lab/labs/11-conditional-writes-and-optimistic-concurrency/src/scenarios/optimistic-concurrency.ts
cat ~/projects/systems-engineering-lab/labs/11-conditional-writes-and-optimistic-concurrency/src/scenarios/conditional-write-publish.ts
cat ~/projects/systems-engineering-lab/labs/11-conditional-writes-and-optimistic-concurrency/src/scenarios/lock-comparison.ts
```

- [ ] **Step 2: Write the draft**

Create `src/content/writing/locks-vs-optimistic-concurrency.md` with this exact frontmatter:

```markdown
---
title: locks vs optimistic concurrency
description: Two buyers, one seat - comparing SELECT FOR UPDATE against a version-checked conditional write.
date: 2026-08-20
heroImage: /writing/locks-vs-optimistic-concurrency-hero.jpg
heroAlt: Heading image
tags: [postgresql, concurrency, row-locks, optimistic-concurrency]
---
```

Follow with the article body per the "Content requirements" list and the Global Constraints structure/voice rules.

- [ ] **Step 3: Verify word count**

```bash
awk 'BEGIN{c=0} /^---$/{c++; next} c>=2{print}' ~/projects/personal-website/src/content/writing/locks-vs-optimistic-concurrency.md | wc -w
```

Expected: between 1200 and 2000.

- [ ] **Step 4: Verify no banned phrasing**

```bash
grep -nE "it.s not just|the difference is stark|—" ~/projects/personal-website/src/content/writing/locks-vs-optimistic-concurrency.md
```

Expected: no output.

- [ ] **Step 5: Verify snippet accuracy**

```bash
grep -F "REPLACE_WITH_EXACT_SNIPPET_LINE" ~/projects/systems-engineering-lab/labs/11-conditional-writes-and-optimistic-concurrency/src/scenarios/optimistic-concurrency.ts
```

Expected: found for every quoted snippet, checked against its actual cited source file.

- [ ] **Step 6: Validate the content schema**

```bash
cd ~/projects/personal-website && npm run build
```

Expected: build succeeds, no schema validation error.

- [ ] **Step 7: Commit**

```bash
cd ~/projects/personal-website
git add src/content/writing/locks-vs-optimistic-concurrency.md
git commit -m "$(cat <<'EOF'
docs: add "locks vs optimistic concurrency" article

Adapts labs 10-11 from systems-engineering-lab (row locks / SELECT FOR UPDATE vs conditional writes).
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** all 10 labs (02-11) are assigned to exactly one task; all four articles from the spec are covered; frontmatter schema, length, voice, and hero-image-placeholder requirements from the spec appear in Global Constraints and are re-stated in each task's Step 2.
- **Placeholder scan:** the only literal placeholder text is `REPLACE_WITH_EXACT_SNIPPET_LINE` in the snippet-verification steps - this is intentional, since the actual snippets don't exist until Step 2 of that task produces them; the step instructs the worker to substitute their own quoted lines before running it.
- **Type/name consistency:** slugs, frontmatter field names, and file paths are identical between the spec and every task; each task is fully independent (no shared interfaces to drift).
