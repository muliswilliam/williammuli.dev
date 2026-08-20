---
title: postgres schema design, query plans, and indexes
description: What a foreign key actually prevents, how to read an EXPLAIN plan, and why an index isn't free.
date: 2026-08-20
heroImage: /writing/postgres-schema-and-query-plans-hero.jpg
tags: [postgresql, sql, database-design, performance]
---

I once watched a "temporary" migration script quietly insert an employee row that pointed at a company id which no longer existed - the company had been deleted weeks earlier. Nobody caught it: the dashboard kept rendering, payroll kept running, and the orphaned row just sat there, wrong, because nothing in the schema actually checked that `company_id` pointed at something real. That is the moment a foreign key stops being an academic detail and turns into the difference between the database rejecting a bad write outright and someone stumbling onto it during an incident review months later.

So I rebuilt it on purpose, this time in a small lab, to see precisely which Postgres error code fires for each missing guarantee - and then kept going, into how Postgres actually plans a query and what an index costs you in return. That is what follows.

Start with the boring-sounding stuff: `NOT NULL`, a foreign key, `UNIQUE`, `CHECK`. It is easy to treat these as ORM boilerplate you fill in and forget. They are not boilerplate. They are the only part of the system that still works when the application code, the validation layer, or the well-meaning script someone runs from their laptop has been bypassed.

Here is the actual schema, unedited:

```typescript
export const employees = pgTable(
  "employees",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    publicId: uuid("public_id").notNull().unique().defaultRandom(),
    companyId: bigint("company_id", { mode: "number" })
      .notNull()
      .references(() => companies.id),
    fullName: text("full_name").notNull(),
    email: text("email").notNull().unique(),
    role: text("role").notNull(),
    annualSalaryCents: integer("annual_salary_cents").notNull(),
    currency: text("currency").notNull(),
    employmentStatus: text("employment_status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("employees_annual_salary_cents_positive", sql`${table.annualSalaryCents} > 0`),
    check(
      "employees_employment_status_valid",
      sql`${table.employmentStatus} in ('active', 'terminated')`,
    ),
  ],
);
```

Now the naive version of the same table, built with raw SQL specifically so it has none of that:

```typescript
export const NAIVE_DDL = `
  DROP TABLE IF EXISTS naive_employees;
  DROP TABLE IF EXISTS naive_companies;

  CREATE TABLE naive_companies (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    public_id uuid,
    name text,
    country text,
    currency text
  );

  CREATE TABLE naive_employees (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    public_id uuid,
    company_id bigint,
    full_name text,
    email text,
    role text,
    annual_salary_cents integer,
    currency text,
    employment_status text
  );
`;
```

Against the naive table, this insert succeeds:

```typescript
await attempt(
  "employee references a company that does not exist",
  "foreign key (employees.company_id -> companies.id)",
  `INSERT INTO naive_employees
     (public_id, company_id, full_name, email, role, annual_salary_cents, currency, employment_status)
   VALUES (gen_random_uuid(), $1, 'Ghost Employee', 'ghost@example.com', 'engineer', 10000000, 'USD', 'active')`,
  [999_999_999],
);
```

There is now a "ghost employee" in the table, pointed at a company id that has never existed. No error, no warning. Run the same insert against the real schema and Postgres rejects it with SQLSTATE `23503`, foreign_key_violation. A negative salary gets `23514`, check_violation. A reused `public_id` gets `23505`, unique_violation. A missing `full_name` gets `23502`, not_null_violation. Four failure modes, four codes, and none require the application to remember to check first - Postgres enforces every one inside the same transaction as the write, regardless of which script or session produced it.

There is a limit worth being honest about. `CHECK` on `employment_status` restricts the set of legal values for one row - it has no idea what the row's previous value was. Hire someone as `'terminated'`, then run this:

```typescript
await attempt(
  "terminated employee is reactivated (terminated -> active)",
  "NOT enforced by CHECK - it only restricts the value set, not the transition",
  `UPDATE employees SET employment_status = 'active' WHERE email = $1`,
  [terminatedEmail],
);
```

That update succeeds. `'active'` is a member of the allowed set, so `CHECK` has nothing to object to; it cannot see the row used to say `'terminated'`. Stopping that transition needs memory of the prior value - a trigger comparing `OLD` to `NEW`, or an application-level state machine. `CHECK` is cheap and always enforced, but it is a value-set guarantee, not a state-transition rule.

Step back from what the constraints stop, for a moment, to a different decision baked into that same schema: both tables carry a `bigint id` and a `uuid public_id`. Each one is doing a job the other handles badly. The `bigint` is sequential, small, and cheap to index - every foreign key and join uses it internally. A random UUID as primary key fragments the b-tree on every insert, since new rows do not land next to each other physically. The `uuid` exists for the opposite reason: handed out in API responses and URLs, it must not be guessable, because a predictable id lets one tenant enumerate another tenant's records. Internal joins get a small, ordered key; the outside world gets a key that leaks no information about insertion order or row count.

Constraints protect correctness at write time. `EXPLAIN` tells you what Postgres will do at read time. Here is a join across three tables, run through Drizzle's query builder against a schema with no indexes beyond what `PRIMARY KEY`/`UNIQUE` forces automatically:

```typescript
const query = db
  .select({
    customerId: customers.id,
    customerName: customers.fullName,
    orderCount: countDistinct(orders.id),
    revenueCents: sum(orderLines.lineTotalCents),
  })
  .from(customers)
  .innerJoin(orders, eq(orders.customerId, customers.id))
  .innerJoin(orderLines, eq(orderLines.orderId, orders.id))
  .groupBy(customers.id, customers.fullName)
  .orderBy(desc(sum(orderLines.lineTotalCents)))
  .limit(5);
```

The lab checks the resulting plan for exactly one thing:

```typescript
const hasSeqScan = explainLines.some((line) => line.includes("Seq Scan"));
```

And it is true, every time, on this schema: `EXPLAIN` shows sequential scans on `orders` and `order_lines`, hash joins to combine them, and a hash aggregate for the `GROUP BY`. That is the expected shape with no supporting indexes on the join columns - Postgres walks both tables in full because nothing lets it jump directly to matching rows. Plain `EXPLAIN` only estimates this without running the query; `EXPLAIN ANALYZE` actually executes it and reports real timings and row counts alongside the estimates, which matters later when the estimate and reality disagree.

Reading a plan matters, but writing a wrong-but-plausible query matters more, because it never triggers an error. Here is the naive version of "revenue and order count per customer":

```typescript
export async function runNaiveRevenueReport(limit = 10): Promise<NaiveRevenueRow[]> {
  return db
    .select({
      customerId: customers.id,
      customerName: customers.fullName,
      reportedOrderCount: sql<number>`count(${orders.id})::int`,
      revenueCents: sql<string>`sum(${orderLines.lineTotalCents})`,
    })
    .from(customers)
    .innerJoin(orders, eq(orders.customerId, customers.id))
    .innerJoin(orderLines, eq(orderLines.orderId, orders.id))
    .groupBy(customers.id, customers.fullName)
    .orderBy(sql`sum(${orderLines.lineTotalCents}) desc`)
    .limit(limit);
}
```

To get at `line_total_cents`, this has to join all the way out to `order_lines`. But once that join exists, each order row gets duplicated once per line it has - an order with four lines contributes four identical `orders.id` values to the joined result set. `count(orders.id)` counts rows in the joined result, not distinct orders. Real output from this exact query, against real seed data:

```json
{"customerName":"Ward Brown","reportedOrderCount":20,"actualOrderCount":6,"inflated":true,"revenueCents":"1958607"}
```

Ward Brown has six real orders. The query reports twenty. Meanwhile `revenueCents` is completely correct, because `sum(line_total_cents)` adds each line's own total exactly once - the fan-out does not touch a `sum` the way it touches a `count`. That is what makes this dangerous: the number everyone actually checks on a dashboard is accurate, so the wrong number sitting right next to it never gets a second look.

The general fix is to pre-aggregate the one-to-many child table down to one row per parent before joining, instead of joining raw and counting across the join:

```sql
WITH order_totals AS (
  SELECT order_id, sum(line_total_cents) AS order_revenue_cents
  FROM order_lines
  GROUP BY order_id
)
SELECT
  c.id, c.full_name,
  count(o.id)                    AS order_count,   -- now correct
  sum(ot.order_revenue_cents)    AS revenue_cents
FROM customers c
JOIN orders o        ON o.customer_id = c.id
JOIN order_totals ot ON ot.order_id = o.id
GROUP BY c.id, c.full_name;
```

By the time `orders` joins to `order_totals`, every order contributes exactly one row - the CTE already collapsed the fan-out - so a plain `count(orders.id)` finally counts what it looks like it is counting:

```json
{"customerName":"Ward Brown","orderCount":6,"actualOrderCount":6,"matches":true,"revenueCents":"1958607"}
```

A narrower fix also exists: swap `count(orders.id)` for `count(DISTINCT orders.id)` in the original query. It is correct and cheap for this one fan-out. Its limit shows up the moment a second one-to-many table joins in - refunds, shipments, returns - because `DISTINCT` on one column does nothing about a fan-out from a different join. Pre-aggregating each branch in its own CTE before joining scales to any number of child tables; sprinkling `DISTINCT` in the right spot does not.

That covers correctness. Scale changes the calculus in a different way: sequential scans are invisible on a few thousand rows. They are not invisible on hundreds of thousands. The lab reuses the exact commerce schema above, seeds it to roughly 1.2 million combined rows, and runs the query shapes a real application actually issues - "this customer's ten most recent orders" being the first one:

```typescript
summaries.push(
  await explainAnalyze(
    pool,
    log,
    "Q1 recent orders for a customer (composite index target)",
    "SELECT id, placed_at, status FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC LIMIT 10",
    [ids.customerIdWithOrders],
  ),
);
```

`orders.customer_id` is a foreign key, and Postgres does not automatically index foreign key columns the way it indexes `PRIMARY KEY`/`UNIQUE` columns. Before any index exists, that query plans as a parallel sequential scan and finishes in 5.380 ms - fine in isolation, less fine multiplied across every customer viewing their order history at once. The fix is a composite index:

```sql
CREATE INDEX IF NOT EXISTS idx_orders_customer_id_placed_at ON orders (customer_id, placed_at);
```

After that index exists, the same query runs in 0.025 ms - roughly 215x faster - and the plan changes to `Index Scan Backward using idx_orders_customer_id_placed_at`. The composite ordering matters: because the index is physically sorted first by `customer_id` and then by `placed_at` within each customer, "this customer's orders, most recent first" is already contiguous inside the index. Postgres just walks it backward instead of running a separate `Sort` step. A plain index on `customer_id` alone would answer the equality filter but still need to sort the results afterward.

Indexes are not a uniform win, and the lab measures that too. An index only helps when following it is cheaper than reading the table directly, which depends on selectivity - what fraction of rows actually match. With `idx_orders_status` in place, filtering for `status = 'cancelled'` (about 7.5% of rows) uses the index and finishes in 5.119 ms. Filtering for `status = 'paid'` (57.8% of rows) plans as a sequential scan instead, at 20.706 ms - the index exists but Postgres decides walking 185,000-plus index entries back to the heap costs more than reading the table straight through. An index existing does not mean Postgres will use it.

None of that six-index gain comes without a cost, worth stating in real numbers rather than a hand-wave. Every index is a separate structure Postgres keeps correct on every write that touches an indexed column, forever, whether or not that write ever benefits from the index existing. Inserting the same 20,000 new orders (plus their order_lines) against this schema:

| State | Total time | Throughput |
|---|---|---|
| Before (0 of 6 indexes) | 555 ms | 108,095 rows/sec |
| After (6 of 6 indexes) | 784 ms | 76,542 rows/sec |

That is roughly 41% slower wall-clock and about 29% lower throughput, for the identical insert workload, purely from index maintenance. Six indexes across two tables is not an extreme case - it is a realistic handful of query shapes for a small commerce app - and the cost lands on every insert, not just the ones that later benefit from a faster read. Index the queries you actually run and can point to, not every column that appears in a `WHERE` clause "just in case."

None of this is exotic. A foreign key, a `CHECK`, a composite index are default tools, not advanced ones. What changes how you use them is watching, concretely, what happens without them: a ghost row that never should exist, a `count` that quietly inflates next to a `sum` that never does, a query that drops from 5.4 milliseconds to 25 microseconds because Postgres finally has a sorted path to the rows it needs. Reading the error code, reading the plan, and knowing what the fix costs are the same skill, applied three times.
