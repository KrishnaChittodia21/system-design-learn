import type { Topic } from '../../types';

const topic: Topic = {
  id: 'db-sql-fundamentals',
  phase: 'databases',
  order: 0,
  title: 'SQL Fundamentals: Joins, Query Execution Order, Normal Forms & Schema Design',
  subtitle:
    'Every join type on one tiny dataset, NULL traps, the logical order a SELECT is evaluated in, how Postgres actually executes it (nested loop / hash / merge), window functions, CTEs, 1NF→5NF on one evolving order sheet, deliberate denormalization, an interview-grade e-commerce schema and the classic SQL round problems.',
  estimatedMinutes: 120,
  sources: [
    'PostgreSQL 17 docs — SQL Commands: SELECT (Description: the order clauses are processed in)',
    'PostgreSQL 17 docs — 7.2 Table Expressions (joined tables), 7.8 WITH Queries (CTE inlining, MATERIALIZED)',
    'PostgreSQL 17 docs — 3.5 Window Functions, 4.2.8 Window Function Calls (frame defaults), 9.23 Subquery Expressions (NOT IN and NULL)',
    'PostgreSQL 17 docs — Ch 51 Overview of PostgreSQL Internals (51.5 Planner/Optimizer: nested loop, merge, hash join), 19.4 Resource Consumption (work_mem, hash_mem_multiplier), 19.7 Query Planning (join_collapse_limit, geqo_threshold)',
    'Itzik Ben-Gan — T-SQL Querying (Microsoft Press), Ch 1 Logical Query Processing',
    'Silberschatz, Korth & Sudarshan — Database System Concepts, 7th ed., Ch 7 Relational Database Design (FDs, BCNF vs 3NF, MVDs, 4NF)',
    'C. J. Date — Database Design and Relational Theory (2nd ed.), chapters on BCNF, 4NF and 5NF / join dependencies',
    'Ramakrishnan & Gehrke — Database Management Systems, Ch 14 Evaluating Relational Operators (join algorithms)',
    'All query results in this topic were checked on PostgreSQL 17 in a throwaway transaction',
  ],
  tags: ['sql', 'joins', 'postgres', 'query-planner', 'window-functions', 'cte', 'normalization', 'bcnf', 'schema-design', 'denormalization', 'interview-sql'],
  cheatSheet: [
    'A join is a filtered Cartesian product, not a Venn diagram: each left row is emitted once per matching right row, so joins multiply rows (fan-out). INNER keeps matches; LEFT/RIGHT also keep unmatched rows from one side with NULLs; FULL keeps both; CROSS = |A|×|B|.',
    'Semi-join (EXISTS / IN) returns each outer row at most once; anti-join = NOT EXISTS. Never use NOT IN on a nullable subquery: one NULL makes every comparison UNKNOWN and the result is empty.',
    'LEFT JOIN + WHERE on a right-table column silently becomes an INNER JOIN (Postgres even plans it as one). Filters on the optional side go in ON; filters on the preserved side go in WHERE. Count with COUNT(o.id), not COUNT(*).',
    'Logical order: FROM/JOIN → WHERE → GROUP BY → HAVING → window functions → SELECT list → DISTINCT → UNION/INTERSECT/EXCEPT → ORDER BY → LIMIT/OFFSET. That is why aliases and aggregates fail in WHERE, and window functions need a wrapping subquery to be filtered.',
    'Postgres pipeline: parser → analyzer → rewriter (views, rules) → planner (cost-based, statistics) → executor (pull-based plan tree). The planner freely reorders explicit JOINs up to join_collapse_limit = 8 items; beyond that your written order constrains the search, and GEQO takes over at 12 FROM items.',
    'Nested loop: small outer + indexed inner, and the only option for non-equi joins. Hash join: big unsorted equi-joins; build side must fit work_mem × hash_mem_multiplier (4 MB × 2 by default) or it splits into batches. Merge join: both inputs already sorted on the key.',
    'ROW_NUMBER = unique 1..n; RANK = ties share and leave gaps (1,1,3); DENSE_RANK = ties share, no gaps (1,1,2). Default frame with ORDER BY is RANGE … CURRENT ROW, so peers (equal sort keys) share one running total; say ROWS for a per-row total.',
    'Normal forms in one breath: 1NF atomic, no repeating groups; 2NF no partial dependency on a composite key; 3NF no transitive dependency; BCNF every determinant is a key; 4NF no independent multi-valued facts in one table; 5NF no table that is the lossless join of its projections.',
    'Denormalize only for a measured read path, and name the propagation mechanism (same-transaction write, trigger, materialized view, CDC → read model) plus who repairs drift. Snapshots that must not change (price paid) are not denormalization; they are facts.',
    'Schema defaults for an Indian e-commerce/payments interview: money as bigint paise with CHECK (≥ 0) and a currency column; FKs + CHECKs + UNIQUE in the database; soft deletes need partial unique indexes; index for the top queries, e.g. orders (customer_id, created_at DESC).',
  ],
  sections: [
    {
      heading: 'Joins by example: INNER, LEFT, RIGHT, FULL, CROSS and SELF on one tiny dataset',
      body: `**Intuition:** picture every row of the left table being paired with every row of the right table (the Cartesian product), then the ON condition crossing out pairs that do not match. INNER keeps the survivors. The OUTER joins then add back rows that found no partner, padding the missing side with NULL.

We use the same two tables in every example of this topic. Four orders, three customers; order 104 is a guest checkout (\`customer_id\` is NULL) and Meera has never ordered.

| Join | Rule | Rows here | Result |
|---|---|---|---|
| INNER | matching pairs only | 3 | Asha-101, Asha-102, Ravi-103 |
| LEFT | all customers, order columns NULL when unmatched | 4 | the 3 above + Meera-NULL |
| RIGHT | all orders, customer columns NULL when unmatched | 4 | the 3 above + NULL-104 |
| FULL | both sides preserved | 5 | the 3 + Meera-NULL + NULL-104 |
| CROSS | every pair, no condition | 12 | 3 × 4 |
| SELF | a table joined to itself under two aliases | 2 | Ravi→Asha, Meera→Asha (who referred whom) |

**Three things the Venn-diagram picture hides**
- **Rows multiply.** Asha appears twice in the INNER result because she has two orders. A join is not a set intersection; one-to-many joins fan out, and every SUM over the "one" side is then counted twice. That is the root of most wrong-report bugs.
- **RIGHT JOIN is LEFT JOIN with the tables swapped.** Most style guides ban RIGHT for readability: read the FROM clause left to right and the "preserved" table is always the first one.
- **NATURAL JOIN and USING are fragile.** NATURAL joins on *every* same-named column. Add a \`created_at\` to both tables later and the join silently starts matching on timestamps too. Write explicit ON conditions in production code.

**Self-joins** answer "row relates to another row of the same entity": referrals, manager hierarchies, "pairs of orders by the same customer within 10 minutes". Use a LEFT self-join when the root (Asha, referred by nobody) must still appear.

**In interviews say:** "I think of a join as a filtered product, so before writing it I ask what the cardinality is: one-to-one, one-to-many or many-to-many. That tells me if the row count can grow and if my aggregates need to happen before the join."`,
      diagram: `customers                               orders
+----+-------+-----------+-------+      +-----+-------------+-----------+-------+
| id | name  | city      | ref_by|      | id  | customer_id | status    | paise |
+----+-------+-----------+-------+      +-----+-------------+-----------+-------+
| 1  | Asha  | Bengaluru | NULL  |      | 101 | 1           | paid      | 50000 |
| 2  | Ravi  | Pune      | 1     |      | 102 | 1           | cancelled | 20000 |
| 3  | Meera | Delhi     | 1     |      | 103 | 2           | paid      | 75000 |
+----+-------+-----------+-------+      | 104 | NULL(guest) | paid      | 30000 |
                                        +-----+-------------+-----------+-------+
 ON o.customer_id = c.id
   Asha  --> 101, 102     (fan-out: Asha appears twice)
   Ravi  --> 103
   Meera --> (none)       LEFT/FULL keep her with NULL order columns
   (none)--> 104          RIGHT/FULL keep it with NULL customer columns`,
      code: [
        {
          language: 'sql',
          title: 'The running dataset and every join type (row counts verified on PG 17)',
          code: `CREATE TABLE customers (
  id          int PRIMARY KEY,
  name        text NOT NULL,
  city        text NOT NULL,
  referred_by int REFERENCES customers(id)       -- self-reference
);
CREATE TABLE orders (
  id          int PRIMARY KEY,
  customer_id int REFERENCES customers(id),      -- NULL = guest checkout
  status      text NOT NULL,
  total_paise bigint NOT NULL CHECK (total_paise >= 0)
);
INSERT INTO customers VALUES (1,'Asha','Bengaluru',NULL),(2,'Ravi','Pune',1),(3,'Meera','Delhi',1);
INSERT INTO orders VALUES (101,1,'paid',50000),(102,1,'cancelled',20000),
                          (103,2,'paid',75000),(104,NULL,'paid',30000);

SELECT c.name, o.id FROM customers c JOIN       orders o ON o.customer_id = c.id; -- 3 rows
SELECT c.name, o.id FROM customers c LEFT JOIN  orders o ON o.customer_id = c.id; -- 4: + Meera/NULL
SELECT c.name, o.id FROM customers c RIGHT JOIN orders o ON o.customer_id = c.id; -- 4: + NULL/104
SELECT c.name, o.id FROM customers c FULL JOIN  orders o ON o.customer_id = c.id; -- 5
SELECT c.name, o.id FROM customers c CROSS JOIN orders o;                         -- 12

-- SELF join: who referred whom (LEFT keeps Asha, the root)
SELECT c.name, r.name AS referred_by
  FROM customers c
  LEFT JOIN customers r ON r.id = c.referred_by;   -- Asha/NULL, Ravi/Asha, Meera/Asha`,
        },
      ],
      keyPoints: [
        'Join = filtered Cartesian product; one-to-many joins multiply rows.',
        'OUTER joins pad the unmatched side with NULL; FULL = LEFT ∪ RIGHT.',
        'Prefer explicit ON over NATURAL/USING; prefer LEFT over RIGHT.',
      ],
      source: 'PostgreSQL 17 docs — 7.2.1.1 Joined Tables',
    },
    {
      heading: 'Semi-joins and anti-joins: EXISTS, IN, NOT EXISTS and the NOT IN null trap',
      body: `**Intuition:** sometimes you do not want the other table's columns, only a yes/no: "customers *who have* a paid order" (semi-join) or "customers *who have no* order" (anti-join). SQL has no SEMI JOIN keyword, but EXISTS and IN express it, and the planner turns them into real Semi Join / Anti Join plan nodes.

**Why not just JOIN + DISTINCT?** \`customers JOIN orders\` returns Asha twice; you would need DISTINCT, which sorts or hashes the whole result. A semi-join stops probing at the first match and never duplicates the outer row.

**The NOT IN trap (asked constantly).** \`WHERE c.id NOT IN (SELECT customer_id FROM orders)\` returns **zero rows** on our data, even though Meera has no orders. Order 104 has \`customer_id = NULL\`, so \`3 NOT IN (1, 1, 2, NULL)\` expands to \`3<>1 AND 3<>1 AND 3<>2 AND 3<>NULL\` = \`TRUE AND … AND UNKNOWN\` = UNKNOWN, and WHERE drops UNKNOWN rows. NOT EXISTS correlates row by row with \`=\`, where a NULL simply fails to match, so it correctly returns Meera.

**The plans differ too.** Because of the NULL semantics, Postgres cannot turn NOT IN into an anti-join. It runs a *hashed SubPlan* if the subquery result fits in \`work_mem\`, and a plain SubPlan rescanned **per outer row** if it does not. That is quadratic, and it is how a NOT IN report that took 2 s at 100K rows takes hours at 10M. NOT EXISTS becomes a **Hash Anti Join** (or Merge/Nested Loop Anti Join).

| Want | Write | Plan node (PG 17) | NULL-safe |
|---|---|---|---|
| has at least one match | \`EXISTS (…)\` or \`IN (subquery)\` | Hash/Nested Loop Semi Join | yes |
| has no match | \`NOT EXISTS (…)\` | Hash Anti Join | yes |
| has no match | \`LEFT JOIN … WHERE o.customer_id IS NULL\` | Hash (Right) Anti Join | yes |
| has no match | \`NOT IN (subquery)\` | hashed SubPlan / per-row SubPlan | **no** |

A detail worth knowing: the LEFT JOIN anti pattern is only recognised when the IS NULL test is on a column the join condition forces non-null (the join key). Testing \`o.id IS NULL\` (the PK) still works logically, but PG 17 plans it as an outer join plus a Filter.

**Say this:** "I default to NOT EXISTS for anti-joins: it is NULL-safe and the planner turns it into an anti-join. NOT IN is fine only for a literal list or a subquery on a NOT NULL column."`,
      code: [
        {
          language: 'sql',
          title: 'Semi- and anti-joins on the running dataset',
          code: `-- Semi-join: customers with at least one paid order -> Asha, Ravi (Asha once, not twice)
SELECT c.name
  FROM customers c
 WHERE EXISTS (SELECT 1 FROM orders o
                WHERE o.customer_id = c.id AND o.status = 'paid');

-- Anti-join, correct: customers with no orders -> Meera
SELECT c.name
  FROM customers c
 WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);

-- Anti-join, WRONG: returns 0 rows because order 104 has customer_id NULL
SELECT c.name
  FROM customers c
 WHERE c.id NOT IN (SELECT customer_id FROM orders);

-- If you must keep NOT IN, exclude NULLs explicitly (still a SubPlan, not an anti-join)
SELECT c.name
  FROM customers c
 WHERE c.id NOT IN (SELECT customer_id FROM orders WHERE customer_id IS NOT NULL);

-- EXPLAIN of the NOT EXISTS version (PG 17):
--   Hash Right Anti Join  Hash Cond: (o.customer_id = c.id)
-- EXPLAIN of the NOT IN version:
--   Seq Scan on customers c  Filter: (NOT (ANY (id = (hashed SubPlan 1).col1)))`,
        },
      ],
      keyPoints: [
        'EXISTS/IN = semi-join: each outer row at most once, stops at the first match.',
        'NOT IN + any NULL in the subquery = empty result.',
        'NOT EXISTS plans as an anti-join; NOT IN can degrade to a per-row SubPlan.',
      ],
      source: 'PostgreSQL 17 docs — 9.23 Subquery Expressions (EXISTS, IN, NOT IN)',
    },
    {
      heading: 'NULL in joins and the LEFT JOIN + WHERE trap',
      body: `**Intuition:** SQL has three truth values: TRUE, FALSE and UNKNOWN. Anything compared with NULL is UNKNOWN, and both ON and WHERE keep only TRUE. So NULL never joins to NULL, and a filter on a NULL-padded column throws the padded row away.

**The trap.** Product asks for "every customer with their count of paid orders, including customers with zero". The obvious query:

\`... FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.status = 'paid' GROUP BY c.id\`

returns **2 rows** (Asha 1, Ravi 1). Meera's padded row has \`o.status = NULL\`, the WHERE evaluates UNKNOWN, and she disappears. The LEFT JOIN is now an INNER JOIN in disguise, and the planner knows it: \`EXPLAIN\` shows a plain **Hash Join**, because Postgres "reduces" an outer join whose nullable side is filtered by a strict condition.

**Four rules that cover almost every case**
1. **A filter on the optional (right) side goes in ON**: \`LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'\` → 3 rows, Meera = 0.
2. **A filter on the preserved (left) side goes in WHERE.** Putting \`AND c.city = 'Pune'\` in the ON of a LEFT JOIN does *not* remove Asha and Meera; it only stops their orders from matching (they come back with NULLs). This is the reverse trap.
3. **Count the optional side's key**: \`COUNT(o.id)\` gives Meera 0; \`COUNT(*)\` counts the padded row and gives her 1.
4. **Wrap aggregates of the optional side**: \`SUM(o.total_paise)\` over no rows is NULL, not 0. Use \`COALESCE(SUM(...), 0)\`.

**The "fix" that is still wrong:** \`WHERE o.status = 'paid' OR o.id IS NULL\` looks right on the sample, but a customer whose only orders are *cancelled* has non-NULL order rows that all fail the test. They vanish instead of showing 0. Only the ON placement is correct.

**Matching NULL to NULL on purpose** (e.g. reconciling two snapshots where NULL means "unknown region"): \`IS NOT DISTINCT FROM\` treats two NULLs as equal, but Postgres cannot hash or merge on it. It falls back to a Nested Loop with a Join Filter, which is fine for 10K rows and fatal for 10M. At scale, coalesce to a sentinel in an expression on both sides, or normalise NULLs away at write time.`,
      code: [
        {
          language: 'sql',
          title: 'Same question, three answers (results verified on PG 17)',
          code: `-- WRONG: WHERE on the optional side -> 2 rows, Meera lost
SELECT c.name, COUNT(o.id) AS paid_orders
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.id
 WHERE o.status = 'paid'
 GROUP BY c.id, c.name;

-- WRONG: COUNT(*) counts the NULL-padded row -> Meera shows 1
SELECT c.name, COUNT(*) AS paid_orders
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
 GROUP BY c.id, c.name;

-- RIGHT: filter in ON, count the optional key, coalesce sums
SELECT c.name,
       COUNT(o.id)                       AS paid_orders,   -- Asha 1, Ravi 1, Meera 0
       COALESCE(SUM(o.total_paise), 0)   AS paid_paise     -- 50000, 75000, 0
  FROM customers c
  LEFT JOIN orders o
    ON o.customer_id = c.id
   AND o.status = 'paid'                 -- belongs to the join, not the result filter
 GROUP BY c.id, c.name;                  -- group by the key, not just the name`,
        },
      ],
      keyPoints: [
        'ON decides which rows match; WHERE decides which result rows survive.',
        'A strict WHERE predicate on the nullable side turns LEFT into INNER.',
        'COUNT(o.id) and COALESCE(SUM(...),0) for zero-safe aggregates.',
      ],
      source: 'PostgreSQL 17 docs — 7.2.1.1 Joined Tables (ON vs WHERE for outer joins), 9.2 Comparison Functions (IS DISTINCT FROM)',
    },
    {
      heading: 'Logical query processing order: why an alias fails in WHERE',
      body: `**Intuition:** you write SELECT first, but the database *defines* the result as if SELECT ran near the end. Each clause takes the virtual table from the step before. A clause can only see names that exist by the time it runs.

**The order (PostgreSQL's SELECT reference lists this sequence; the window step comes from its window-function docs, which place windows after grouping and HAVING)**

| # | Clause | Input → output | What it can reference |
|---|---|---|---|
| 1 | FROM / JOIN (and WITH before it) | tables → one joined row set | table columns |
| 2 | WHERE | rows → filtered rows | columns; **no** aggregates, **no** SELECT aliases |
| 3 | GROUP BY | rows → groups | columns, expressions |
| 4 | HAVING | groups → filtered groups | aggregates, grouping columns |
| 5 | window functions | rows/groups → same rows + window values | aggregates, grouping columns |
| 6 | SELECT list | compute output expressions and aliases | everything above |
| 7 | DISTINCT / DISTINCT ON | remove duplicate output rows | output rows |
| 8 | UNION / INTERSECT / EXCEPT | combine queries | output rows |
| 9 | ORDER BY | sort | output aliases, or any input column if no DISTINCT |
| 10 | LIMIT / OFFSET | slice | — |

Many blog diagrams put window functions after DISTINCT. In PostgreSQL (and the standard), windows are computed *before* DISTINCT. Check it on the running data: \`SELECT DISTINCT city, count(*) OVER () FROM customers\` returns three rows, each with **3**, the count of all rows before de-duplication.

**Consequences you are expected to explain**
- **Alias in WHERE fails**: \`SELECT upper(city) AS c ... WHERE c = 'PUNE'\` → \`column "c" does not exist\`. WHERE (step 2) runs before the alias is born (step 6). Repeat the expression, or wrap the query in a subquery/CTE.
- **Aggregate in WHERE fails**: aggregates do not exist until step 3. Row filters go in WHERE (cheap, reduce input early); group filters go in HAVING.
- **Alias in HAVING fails in Postgres** (\`HAVING n > 1\` → error). Write \`HAVING count(*) > 1\`.
- **Postgres lets you GROUP BY an output alias or ordinal** (\`GROUP BY c\` or \`GROUP BY 1\`). This is an extension inherited from SQL-92 compatibility. Do not rely on it in portable SQL; standard SQL and SQL Server reject it.
- **ORDER BY alias works, but not inside an expression**: \`ORDER BY c\` is fine; \`ORDER BY c || 'x'\` fails, because an expression in ORDER BY is resolved against input columns.
- **Window functions cannot appear in WHERE** (Postgres has no QUALIFY clause). Compute ROW_NUMBER in a subquery, filter outside.
- **LIMIT without ORDER BY is non-deterministic**: the order depends on the physical plan, and it changes when the plan changes.

**Logical ≠ physical.** This order defines *meaning*, not execution. The planner pushes WHERE predicates into scans, reorders joins, and may stop early for LIMIT. It just must produce the same answer as if the steps ran in order.`,
      diagram: `  FROM customers c LEFT JOIN orders o ON ...   (1)  4 rows, Meera padded
          |
        WHERE c.city <> 'Delhi'                 (2)  3 rows  (aliases unknown)
          |
        GROUP BY c.id, c.name                   (3)  2 groups
          |
        HAVING COUNT(o.id) >= 1                 (4)  2 groups (aggregates OK)
          |
        window: RANK() OVER (ORDER BY SUM(..))  (5)  rank computed per group
          |
        SELECT name, SUM(..) AS paise           (6)  aliases are born here
          |
        DISTINCT                                (7)
          |
        ORDER BY paise DESC                     (9)  alias usable
          |
        LIMIT 10                                (10)`,
      code: [
        {
          language: 'sql',
          title: 'What works and what errors (PostgreSQL 17 behaviour)',
          code: `SELECT upper(city) AS c FROM customers WHERE c = 'PUNE';
-- ERROR: column "c" does not exist          (WHERE runs before SELECT)

SELECT city, count(*) AS n FROM customers GROUP BY city HAVING n > 1;
-- ERROR: column "n" does not exist          (use HAVING count(*) > 1)

SELECT upper(city) AS c, count(*) FROM customers GROUP BY c;
-- works in Postgres (extension), not portable

SELECT city AS c FROM customers ORDER BY c;          -- works
SELECT city AS c FROM customers ORDER BY c || 'x';   -- ERROR: column "c" does not exist

-- Filtering on a window function: compute inside, filter outside
SELECT *
  FROM (SELECT o.*, row_number() OVER (PARTITION BY customer_id
                                       ORDER BY total_paise DESC) AS rn
          FROM orders o) t
 WHERE rn = 1;                                       -- biggest order per customer

-- Windows run before DISTINCT: three rows, each with count = 3
SELECT DISTINCT city, count(*) OVER () FROM customers;`,
        },
      ],
      keyPoints: [
        'FROM → WHERE → GROUP BY → HAVING → window → SELECT → DISTINCT → ORDER BY → LIMIT.',
        'A clause sees only names produced by earlier steps.',
        'The order is semantic; the planner may execute physically in any equivalent way.',
      ],
      source: 'PostgreSQL 17 docs — SQL Commands: SELECT (Description); Itzik Ben-Gan — T-SQL Querying, Ch 1 Logical Query Processing',
    },
    {
      heading: 'Physical execution: parser, rewriter, planner, executor and the three join algorithms',
      body: `**Intuition:** the SQL text says *what*; the planner decides *how*. It is a cost-based search over equivalent plans, and the most consequential choices are the join order and the join algorithm.

**The pipeline.** A generic engine has a transport layer (connection, auth), a query processor (parser + optimizer), an execution engine, and a storage engine (transactions, locks, buffers, recovery). In PostgreSQL that maps onto:
1. **Parser**: text → parse tree; syntax errors are raised here.
2. **Analyzer**: resolves tables, columns and types through the catalog; "relation does not exist" is raised here.
3. **Rewriter**: expands views and rules into the query tree.
4. **Planner/optimizer**: enumerates scan methods (seq, index, bitmap), join orders and join methods, and estimates costs from \`pg_statistic\`. With up to \`join_collapse_limit\` (8) items it searches join orders exhaustively. Beyond \`geqo_threshold\` (12) FROM items it switches to the genetic optimizer.
5. **Executor**: a tree of nodes, each pulling rows from its children ("Volcano" model). Buffer and visibility mechanics are covered in *db-postgres-internals*, and EXPLAIN reading in *db-indexing*.

**The three join algorithms**

| | Nested loop | Hash join | Merge join |
|---|---|---|---|
| How | for each outer row, probe the inner (ideally with an index) | build a hash table on the smaller input, stream the larger one past it | walk two inputs sorted on the join key in lockstep |
| Cost | outer rows × inner probe | O(N + M), plus memory | O(N + M) if already sorted, + sort cost otherwise |
| Wins when | outer side small (≤ a few thousand rows) and inner indexed; LIMIT queries | large, unsorted equi-joins; reporting | both sides arrive sorted (index order, earlier sort), very large inputs |
| Join conditions | **any**, including \`<\`, BETWEEN, LIKE | equality only | equality (merge-joinable operators) only |
| Memory | tiny | build side must fit \`work_mem × hash_mem_multiplier\` or it spills into batches | sort may spill to disk |

**Facts interviewers probe**
- **Non-equi joins can only use a nested loop.** "Match each payment to the settlement window it falls in" (\`p.ts BETWEEN w.lo AND w.hi\`) is a nested loop. At 200K × 50K that is 10 billion comparisons. Fixes: range types + GiST index for an indexed inner side, or bucket both sides on a coarse equality key first.
- **FULL JOIN needs a hash- or merge-joinable condition.** Postgres refuses a FULL JOIN on a BETWEEN condition outright with "FULL JOIN is only supported with merge-joinable or hash-joinable join conditions".
- **Hash join memory.** In PG 15+, \`hash_mem_multiplier\` defaults to 2.0, so with \`work_mem = 4MB\` a hash can use about 8 MB. A bigger build side is split into 2^k batches written to temp files. With \`work_mem = 64kB\`, joining 50K rows showed \`Batches: 32\`. Raise \`work_mem\` per session for reports, not globally: it applies per hash/sort node, per backend.
- **Bad estimates pick bad algorithms.** Planner thinks the outer has 12 rows, so it picks a nested loop; reality is 48,000 rows, so it does 48,000 index probes. The fix is \`ANALYZE\`, extended statistics or a query rewrite, not hints (core Postgres has none).`,
      diagram: `NESTED LOOP                 HASH JOIN                     MERGE JOIN
 outer (small)               build: Hash(customers)        sorted A    sorted B
  row 1 --probe idx--> inner      id -> row                  1  <------> 1
  row 2 --probe idx--> inner probe: Seq Scan orders          1  <------> 1
  row 3 --probe idx--> inner   for each order: h(cust_id)    2  <------> 2
 any ON condition              equality only; spills to      3     (no 3)
 cost ~ outer x probe          batches if > work_mem x 2     advance smaller side`,
      code: [
        {
          language: 'sql',
          title: 'Seeing the algorithms in EXPLAIN (PG 17, synthetic tables a=200K, b=50K rows)',
          code: `-- Equality join, tiny work_mem: hash join that spills into batches
SET work_mem = '64kB';
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF) SELECT count(*) FROM a JOIN b ON a.id = b.id;
--  Hash Join (actual rows=50000)
--    Hash Cond: (a.id = b.id)
--    ->  Seq Scan on a (actual rows=200000)
--    ->  Hash (actual rows=50000)
--          Buckets: 4096  Batches: 32  Memory Usage: 89kB     <- spilled
RESET work_mem;

-- Range (non-equi) join: nested loop is the only option
EXPLAIN (COSTS OFF) SELECT count(*) FROM a JOIN b ON a.ts BETWEEN b.lo AND b.hi;
--  Nested Loop
--    Join Filter: ((a.ts >= b.lo) AND (a.ts <= b.hi))
--    ->  Seq Scan on a
--    ->  Materialize -> Seq Scan on b

-- Same condition as FULL JOIN: rejected at plan time
SELECT count(*) FROM a FULL JOIN b ON a.ts BETWEEN b.lo AND b.hi;
-- ERROR: FULL JOIN is only supported with merge-joinable or hash-joinable join conditions

-- Experiment only (never in production): forbid a method to compare costs
SET enable_nestloop = off;   -- then EXPLAIN again and compare estimated vs actual`,
        },
      ],
      keyPoints: [
        'Parser → analyzer → rewriter → planner → executor; the planner picks join order and method.',
        'Nested loop handles any condition; hash and merge need equality.',
        'Hash memory = work_mem × hash_mem_multiplier per node; beyond that it batches to disk.',
      ],
      source: 'PostgreSQL 17 docs — 51.5 Planner/Optimizer, 19.4 Resource Consumption, 19.7 Query Planning',
    },
    {
      heading: 'Aggregation and window functions: GROUP BY vs OVER, ranking, running totals, top-N per group',
      body: `**Intuition:** GROUP BY *collapses* rows into one per group. A window function *keeps every row* and attaches a value computed over related rows. Think of it as "GROUP BY that does not throw the rows away".

**Anatomy:** \`fn() OVER (PARTITION BY k ORDER BY s ROWS|RANGE frame)\`. PARTITION BY is the group, ORDER BY sets the order inside it, and the frame picks which rows the function sees.

**Ranking on salaries 300, 300, 200, 100 (verified)**

| salary | ROW_NUMBER | RANK | DENSE_RANK |
|---|---|---|---|
| 300 | 1 | 1 | 1 |
| 300 | 2 | 1 | 1 |
| 200 | 3 | 3 | 2 |
| 100 | 4 | 4 | 3 |

- **ROW_NUMBER** for "exactly N rows per group" and de-duplication. Add a tie-breaker (\`ORDER BY revenue DESC, id\`), or the winner among ties is arbitrary and can change between runs.
- **RANK** for "competition ranking" (two golds, no silver).
- **DENSE_RANK** for "the Nth distinct value" (second-highest salary = DENSE_RANK 2 = 200).

**Running totals and the frame default.** With ORDER BY and no frame, the default is \`RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW\`, and RANGE includes **peers** (rows with an equal sort key). Two payments on 2 Jan of 50 and 70 both show 220, not 150 then 220. Write \`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW\` (or add a unique tie-breaker) for a strictly per-row total. Use ROWS for "last 7 rows" and RANGE with an interval for "last 7 days".

**Other workhorses**
- \`LAG/LEAD\`: compare with the previous or next row (day-over-day delta, session gaps).
- \`SUM(x) FILTER (WHERE status = 'paid')\`: conditional aggregation in one pass instead of three subqueries.
- \`first_value\`, \`ntile(4)\` for quartiles, \`percentile_cont(0.99) WITHIN GROUP (ORDER BY latency)\` for p99 (an ordered-set aggregate, not a window).

**Top-N per group: two shapes**
1. **ROW_NUMBER in a subquery, filter rn ≤ N.** One pass, but it ranks *every* row of every group: sort plus window over the whole input. Fine for reports.
2. **LATERAL + index.** For each category, \`LIMIT 3\` from an index on \`(category_id, revenue DESC)\`. Cost is about groups × N index probes. With 2,000 categories and 50M rows it reads around 6,000 index entries instead of sorting 50M. Interviewers love this contrast.`,
      code: [
        {
          language: 'sql',
          title: 'Ranking, running totals, conditional aggregates and top-3 per category two ways',
          code: `-- Running total per customer: ROWS avoids the peer-sharing surprise
SELECT customer_id, id, total_paise,
       SUM(total_paise) OVER (PARTITION BY customer_id ORDER BY id
                              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_paise,
       total_paise - LAG(total_paise) OVER (PARTITION BY customer_id ORDER BY id) AS delta
  FROM orders
 WHERE customer_id IS NOT NULL;

-- Conditional aggregation in one scan
SELECT COUNT(*) FILTER (WHERE status = 'paid')            AS paid_orders,      -- 3
       SUM(total_paise) FILTER (WHERE status = 'paid')    AS paid_paise         -- 155000
  FROM orders;

-- Top-3 products per category by 7-day revenue: (1) window, ranks every row
SELECT category_id, product_id, revenue_paise
  FROM (SELECT category_id, product_id, revenue_paise,
               ROW_NUMBER() OVER (PARTITION BY category_id
                                  ORDER BY revenue_paise DESC, product_id) AS rn
          FROM product_revenue_7d) t
 WHERE rn <= 3;

-- (2) LATERAL: ~3 index probes per category
-- needs: CREATE INDEX ON product_revenue_7d (category_id, revenue_paise DESC, product_id);
SELECT c.id AS category_id, top.product_id, top.revenue_paise
  FROM categories c
 CROSS JOIN LATERAL (
        SELECT r.product_id, r.revenue_paise
          FROM product_revenue_7d r
         WHERE r.category_id = c.id
         ORDER BY r.revenue_paise DESC, r.product_id
         LIMIT 3) top;`,
        },
      ],
      keyPoints: [
        'GROUP BY collapses rows; OVER keeps them.',
        'ROW_NUMBER exact N (add a tie-breaker); RANK gaps; DENSE_RANK Nth distinct value.',
        'Default frame is RANGE … CURRENT ROW: peers share the value. Use ROWS for per-row totals.',
        'Top-N per group: window for reports, LATERAL + composite index for many groups/large tables.',
      ],
      source: 'PostgreSQL 17 docs — 3.5 Window Functions, 4.2.8 Window Function Calls, 9.22 Window Functions, 7.2.1.5 LATERAL Subqueries',
    },
    {
      heading: 'Subqueries vs CTEs vs joins: same answer, different plans',
      body: `**Intuition:** the three are mostly ways of *spelling* the same relational question. The planner flattens many of them to the same plan, but not all. Know which forms are flattened and which are executed literally.

| Form | Postgres behaviour | Use it for |
|---|---|---|
| \`IN / EXISTS (subquery)\` in WHERE | pulled up into a Semi Join | "has a match" filters |
| \`NOT EXISTS\` | Anti Join | "has no match" |
| Subquery in FROM (derived table) | usually flattened into the outer query | naming an intermediate step, filtering on window results |
| **Correlated scalar subquery in SELECT** | executed as a SubPlan **per outer row** (no decorrelation) | small outer sets only; rewrite as JOIN + GROUP BY or LATERAL for big ones |
| Non-recursive CTE (WITH) | **PG 12+: inlined** if referenced once and side-effect free; materialized otherwise | readability; force behaviour with \`MATERIALIZED\` / \`NOT MATERIALIZED\` |
| Recursive CTE | iterates until no new rows | trees and graphs: category hierarchy, referral chains |
| Data-modifying CTE (\`WITH x AS (UPDATE … RETURNING)\`) | always executed exactly once | move rows atomically, e.g. archive then delete |

**The "CTE is an optimization fence" myth.** It was true before PostgreSQL 12: every CTE was materialized, and predicates outside could not be pushed inside. Since 12, \`WITH x AS (SELECT * FROM orders) SELECT * FROM x WHERE id = 5\` plans as a direct index scan on orders. Write \`AS MATERIALIZED\` and you get a CTE Scan with a filter on top: the whole CTE is computed first. Use MATERIALIZED on purpose when an expensive CTE is referenced twice, or to stop the planner from pushing a predicate into a bad plan.

**Correlated scalar subqueries are the SQL N+1.** \`SELECT c.name, (SELECT max(created_at) FROM orders o WHERE o.customer_id = c.id) FROM customers c\` runs one index probe per customer. That is fine for a page of 50, and 2M probes for a full export. Rewrite as \`LEFT JOIN (SELECT customer_id, max(created_at) … GROUP BY customer_id)\`. That is one hash aggregate plus one hash join.

**Aggregate before you join (pre-aggregation).** When two one-to-many children hang off one parent (order_items *and* payments under orders), joining both before GROUP BY multiplies rows: 3 items × 2 payments = 6 rows per order, so every payment is summed 3 times. Aggregate each child in its own subquery or CTE, then join the totals 1:1.`,
      code: [
        {
          language: 'sql',
          title: 'Recursive CTE, pre-aggregation to avoid fan-out, and an explicit materialization choice',
          code: `-- Referral chain upwards from Meera (id 3): Meera -> Asha
WITH RECURSIVE chain AS (
  SELECT id, name, referred_by, 0 AS depth FROM customers WHERE id = 3
  UNION ALL
  SELECT c.id, c.name, c.referred_by, chain.depth + 1
    FROM customers c JOIN chain ON c.id = chain.referred_by
   WHERE chain.depth < 10                          -- guard against cycles in bad data
)
SELECT * FROM chain;

-- Fan-out-safe order totals: aggregate each child first, then join 1:1
WITH items AS (
  SELECT order_id, SUM(qty * unit_price_paise) AS item_paise
    FROM order_items GROUP BY order_id
), paid AS (
  SELECT order_id, SUM(amount_paise) AS paid_paise
    FROM payments WHERE status = 'captured' GROUP BY order_id
)
SELECT o.id, i.item_paise, COALESCE(p.paid_paise, 0) AS paid_paise
  FROM orders o
  JOIN items i ON i.order_id = o.id
  LEFT JOIN paid p ON p.order_id = o.id;

-- Expensive CTE used twice: compute once on purpose
WITH big AS MATERIALIZED (
  SELECT customer_id, SUM(total_paise) AS ltv FROM orders GROUP BY customer_id
)
SELECT (SELECT avg(ltv) FROM big) AS avg_ltv, (SELECT max(ltv) FROM big) AS max_ltv;`,
        },
      ],
      keyPoints: [
        'IN/EXISTS/NOT EXISTS become semi/anti joins; correlated scalar subqueries run per row.',
        'PG 12+ inlines single-use CTEs; MATERIALIZED forces the old fence.',
        'Two one-to-many children: aggregate each, then join (avoid fan-out double counting).',
      ],
      source: 'PostgreSQL 17 docs — 7.8 WITH Queries (Common Table Expressions), 9.23 Subquery Expressions',
    },
    {
      heading: 'Normalization 1NF → 3NF on one evolving order sheet, with the anomaly each step removes',
      body: `**Intuition:** a functional dependency (FD) \`X → Y\` means "if I know X, there is exactly one Y". Normalization moves every fact into the table whose key determines it. Each fact is then stored once, and changing it is one write.

**Start: the ops team's spreadsheet (unnormalized).** One row per order, items packed into a text cell:

\`order_sheet(order_id, order_date, customer_phone, customer_name, customer_city, items = 'P10 Kettle x1 @149900; P22 Mug x2 @29900')\`

You cannot index "orders containing P22", and every report parses strings.

**1NF: atomic values, no repeating groups.** One row per order line, key \`(order_id, product_id)\`:
\`order_lines(order_id, product_id, order_date, customer_id, customer_name, customer_city, product_name, unit_price_paise, qty)\`

**FDs in this table:** \`order_id → order_date, customer_id\` · \`customer_id → customer_name, customer_city\` · \`product_id → product_name\` · \`(order_id, product_id) → qty, unit_price_paise\`.

**2NF: no partial dependency on part of a composite key.** \`product_name\` depends only on \`product_id\`; the order and customer columns depend only on \`order_id\`. Split:
- \`products(product_id, name, list_price_paise)\`
- \`orders(order_id, order_date, customer_id, customer_name, customer_city)\`
- \`order_items(order_id, product_id, qty, unit_price_paise)\`

Note that \`unit_price_paise\` *stays* in order_items. The price **charged on that order** is a fact about the order line; the **list price today** is a fact about the product. They are different attributes that happen to share a name. Treating the charged price as redundant is a classic over-normalization bug: a price change would rewrite past invoices.

**3NF: no transitive dependency through a non-key column.** In \`orders\`, \`order_id → customer_id → customer_name\`. Split \`customers(customer_id, name, city)\` and keep only \`customer_id\` in orders.

| Step | Anomaly it removes, on this data |
|---|---|
| UNF → 1NF | **Query anomaly:** "which orders contain P22?" needs string parsing; qty cannot be summed. |
| 1NF → 2NF | **Update:** renaming "Kettle" means updating 40,000 lines; miss one and reports disagree. **Insert:** a new product cannot exist until someone orders it. **Delete:** deleting the last order of P22 erases the only record of P22. |
| 2NF → 3NF | **Update:** Asha moves city, and 37 order rows must change, or the "orders by city" report double-counts her. **Insert/Delete:** no customer row without an order; deleting her only order deletes her. |

**Where most OLTP schemas stop:** 3NF (practically, BCNF), then deliberate snapshots and read models. The one-line mnemonic: every non-key column depends on *the key, the whole key, and nothing but the key*.`,
      diagram: `UNF  order_sheet: 5001 | Asha | Bengaluru | "P10 Kettle x1; P22 Mug x2"
        |  split repeating group into rows
1NF  order_lines (order_id, product_id)* , date, cust_*, product_name, price, qty
        |  remove partial deps:  product_id -> name ;  order_id -> date, cust_*
2NF  products(product_id*)   orders(order_id*, cust_id, cust_name, city)
     order_items(order_id*, product_id*, qty, unit_price_paise)
        |  remove transitive dep:  order_id -> cust_id -> cust_name, city
3NF  customers(id*)  orders(id*, customer_id)  products(id*)
     order_items(order_id*, product_id*, qty, unit_price_paise)   (* = key)`,
      code: [
        {
          language: 'sql',
          title: 'The 3NF result, with the invariants enforced by the database',
          code: `CREATE TABLE customers (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  city       text NOT NULL,
  phone      text NOT NULL UNIQUE                    -- natural key kept unique
);
CREATE TABLE products (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             text   NOT NULL,
  list_price_paise bigint NOT NULL CHECK (list_price_paise >= 0)   -- today's price
);
CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE order_items (
  order_id         bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       bigint NOT NULL REFERENCES products(id),
  qty              int    NOT NULL CHECK (qty > 0),
  unit_price_paise bigint NOT NULL CHECK (unit_price_paise >= 0), -- price charged: a fact of the line
  PRIMARY KEY (order_id, product_id)
);
-- Reverse lookup for "orders containing product X" (the PK only serves order_id first)
CREATE INDEX order_items_product_idx ON order_items (product_id);`,
        },
      ],
      keyPoints: [
        '1NF atomic rows; 2NF whole key; 3NF nothing but the key.',
        'Each step removes update, insert and delete anomalies for one kind of fact.',
        'Price charged on an order line is not redundant with the product list price.',
      ],
      source: 'Silberschatz et al. — Database System Concepts, Ch 7',
    },
    {
      heading: 'BCNF, 4NF and 5NF: overlapping keys, independent multi-valued facts and join dependencies',
      body: `**Intuition:** 3NF fixes almost everything, but leaves three rarer shapes. Interviewers at senior level ask about them to see whether you understand *dependencies*, not mnemonics.

**BCNF: every determinant must be a candidate key.** Warehouse picking at an e-commerce fulfilment centre:
\`order_pickers(order_id, category, picker_id)\`. Rules: each picker works exactly one category (\`picker_id → category\`), and each (order, category) gets one picker (\`(order_id, category) → picker_id\`).
- Candidate keys: \`(order_id, category)\` and \`(order_id, picker_id)\`. Every column is part of some key, so the table *is* in 3NF.
- But \`picker_id → category\` has a determinant that is not a key. Moving picker Kiran from Electronics to Grocery means updating every row she ever picked: an update anomaly.
- **BCNF decomposition:** \`pickers(picker_id, category)\` + \`order_pickers(order_id, picker_id)\`.
- **The cost:** the rule "one picker per (order, category)" now spans two tables. No single UNIQUE constraint can enforce it, so you need a trigger or application check. This is the textbook trade-off: **3NF can always preserve dependencies; BCNF sometimes cannot.** Saying this out loud is a strong senior signal.

**4NF: no two independent multi-valued facts in one table.** \`product_options(product_id, colour, size)\` for a T-shirt sold in {red, blue} × {S, M, L}. If colour and size are *independent* (every colour comes in every size), this is the multi-valued dependency \`product_id ↠ colour\`, \`product_id ↠ size\`. Adding "green" means inserting 3 rows; forget one and the catalogue claims green has no M. Split into \`product_colours\` and \`product_sizes\`.
- **The catch:** if only some combinations exist (blue has no L), colour and size are *not* independent. The three-column table is then a correct list of real SKUs and is already in 4NF. Decide from the business rule, not from the shape.

**5NF: no table that is just the join of its projections.** \`seller_brand_category(seller, brand, category)\` with the rule: "if a seller carries a brand, and the seller is approved in a category, and the brand makes products in that category, then the seller sells that brand in that category". The three-column table is then exactly the join of \`seller_brands\`, \`seller_categories\` and \`brand_categories\`. Storing it as one table repeats facts, and inserting one approval requires inserting many derived rows. Without such a rule (each triple is an independent business decision), the 3-column table is already 5NF. 5NF violations are rare; recognising one is enough.

| Form | Violation smell | Example here | Fix |
|---|---|---|---|
| BCNF | a non-key column determines part of a key | picker → category | split; enforce the lost rule in a trigger |
| 4NF | Cartesian-product rows of independent lists | colours × sizes | one table per independent list |
| 5NF | an all-key table rebuildable from 3 projections | seller × brand × category rule | store the three binary relations |`,
      code: [
        {
          language: 'sql',
          title: 'BCNF decomposition and the dependency that has to move into a trigger',
          code: `CREATE TABLE pickers (
  picker_id bigint PRIMARY KEY,
  category  text   NOT NULL                  -- picker_id -> category, stored once
);
CREATE TABLE order_pickers (
  order_id  bigint NOT NULL,
  picker_id bigint NOT NULL REFERENCES pickers(picker_id),
  PRIMARY KEY (order_id, picker_id)
);

-- Lost by decomposition: (order_id, category) -> picker_id. Re-enforce it.
CREATE FUNCTION one_picker_per_category() RETURNS trigger AS $fn$
BEGIN
  IF EXISTS (SELECT 1
               FROM order_pickers op
               JOIN pickers p  ON p.picker_id = op.picker_id
               JOIN pickers me ON me.picker_id = NEW.picker_id
              WHERE op.order_id = NEW.order_id
                AND p.category  = me.category
                AND op.picker_id <> NEW.picker_id) THEN
    RAISE EXCEPTION 'order % already has a picker for this category', NEW.order_id;
  END IF;
  RETURN NEW;
END $fn$ LANGUAGE plpgsql;

CREATE TRIGGER order_pickers_bcnf BEFORE INSERT OR UPDATE ON order_pickers
  FOR EACH ROW EXECUTE FUNCTION one_picker_per_category();
-- Under concurrency this check can race (two inserts both see "no picker"): lock the
-- order row first (SELECT ... FROM orders WHERE id = $1 FOR UPDATE) or use SERIALIZABLE.`,
        },
      ],
      keyPoints: [
        'BCNF: every determinant is a candidate key; may lose dependency preservation.',
        '4NF: independent multi-valued facts go in separate tables, but only if truly independent.',
        '5NF: decompose only when a business rule makes the triple derivable from pairs.',
      ],
      source: 'C. J. Date — Database Design and Relational Theory (5NF, join dependencies); Silberschatz et al. — Ch 7.3 (BCNF vs 3NF dependency preservation), 7.6 (4NF)',
    },
    {
      heading: 'When to denormalize: read models, reporting and what it costs',
      body: `**Intuition:** normalization optimises for *writing* facts correctly; some screens need to *read* a pre-joined answer in 5 ms. Denormalization is a cache you store in the database, and every cache needs an invalidation story. The basic trade-off table is in *db-fundamentals*. This section is about the mechanisms and their failure modes.

**Swiggy-style restaurant card:** name, rating, rating count, cuisines, "300+ orders this week", delivery-time estimate, for 50 cards per scroll at around 20K QPS. Normalized, that is restaurants ⋈ ratings aggregate ⋈ cuisines (m:n) ⋈ orders-last-7-days aggregate per request. Aggregating ratings on every read is the part that does not scale.

| Mechanism | Freshness | Write cost | Failure mode | Good for |
|---|---|---|---|---|
| Column updated in the **same transaction** (\`rating_count = rating_count + 1\`) | immediate | a hot row per popular restaurant: row-lock contention | lock waits on viral items; fix with sharded counters (N rows, sum on read) | counters, totals |
| **Trigger** | immediate | hidden write amplification on every insert | surprises during bulk loads; logic invisible to the app | small, stable derivations |
| **Materialized view** + \`REFRESH … CONCURRENTLY\` | minutes (scheduled) | full recompute per refresh (needs a UNIQUE index for CONCURRENTLY) | refresh time grows with the data; stale between refreshes | dashboards, leaderboards |
| **CDC / outbox → read model** (Debezium → Kafka → Elasticsearch/Redis/another table) | seconds | async, off the write path | lag, reordering, replays: consumers must be idempotent | search cards, feeds, cross-service views |
| **Reporting warehouse** (star schema: fact_orders + dims) | minutes to hours | ETL/ELT pipeline | schema drift, late-arriving facts | analytics, finance reports |

**Costs to name in an interview**
- **Storage and write amplification:** each copy is another write, another index entry and more WAL.
- **Drift:** two copies disagree after a partial failure or a bug. You need a reconciliation job (compare source vs read model, repair) and an owner for it.
- **Schema coupling:** renaming a source column now breaks consumers.
- **Correctness scope:** never make a denormalized copy the source for a *decision* (stock check, balance check). Read it for display, decide on the normalized source.

**Not denormalization (keep it):** the price paid on an order line, the shipping address *as it was* at order time, the tax rate applied. These are historical facts, and they must not follow later changes.

**Rule of thumb:** normalize the write model to 3NF/BCNF. Denormalize only after a measured slow read path, using the least-coupled mechanism that meets the freshness need (same txn < 1 ms, MV minutes, CDC seconds). Write the repair job before you need it.`,
      code: [
        {
          language: 'sql',
          title: 'Two denormalizations for the restaurant card: hot-row-safe counter and a refreshable rollup',
          code: `-- 1) Sharded counter: spread a hot restaurant's increments over 16 rows
CREATE TABLE restaurant_rating_counter (
  restaurant_id bigint NOT NULL,
  shard         smallint NOT NULL,           -- 0..15, chosen randomly per write
  ratings       bigint NOT NULL DEFAULT 0,
  stars_sum     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (restaurant_id, shard)
);
INSERT INTO restaurant_rating_counter AS r (restaurant_id, shard, ratings, stars_sum)
VALUES ($1, floor(random() * 16)::int, 1, $2)
ON CONFLICT (restaurant_id, shard)
DO UPDATE SET ratings = r.ratings + 1, stars_sum = r.stars_sum + EXCLUDED.stars_sum;

-- 2) Weekly order counts as a materialized view, refreshed every 5 minutes
CREATE MATERIALIZED VIEW restaurant_week_stats AS
SELECT o.restaurant_id,
       COUNT(*)                     AS orders_7d,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY o.delivery_minutes) AS p50_delivery_min
  FROM food_orders o
 WHERE o.created_at >= now() - interval '7 days'
 GROUP BY o.restaurant_id;
CREATE UNIQUE INDEX ON restaurant_week_stats (restaurant_id);   -- required for CONCURRENTLY
REFRESH MATERIALIZED VIEW CONCURRENTLY restaurant_week_stats;   -- readers are not blocked`,
        },
      ],
      keyPoints: [
        'Denormalization = a cache inside the DB: name its propagation and repair mechanism.',
        'Same-txn counters create hot rows; shard them.',
        'Historical snapshots (price paid, address used) are facts, not denormalization.',
      ],
      source: 'PostgreSQL 17 docs — CREATE MATERIALIZED VIEW, REFRESH MATERIALIZED VIEW; Martin Kleppmann — Designing Data-Intensive Applications, Ch 3 & 11 (derived data)',
    },
    {
      heading: 'Schema-design walkthrough: an e-commerce orders schema end to end',
      body: `**Intuition:** a schema round is a design round in miniature. Requirements → entities and cardinalities → tables and keys → constraints that make bad states impossible → indexes for the named queries → what you would change at 10× scale. Say each step out loud.

**1. Requirements (ask, then write down).** Customers place orders of many products, and a product sits in many categories. Show order history (newest first, paginated), the order detail page, "top products per category", and payment status. Products can be delisted but old orders must still render. Amounts in INR, GST-inclusive.

**2. Entities and cardinalities.** customer 1–n address · customer 1–n order · order 1–n order_item · product 1–n order_item · product n–m category (junction table \`product_categories\`) · order 1–n payment (retries, partial refunds).

**3. Decisions worth defending**
- **Money as \`bigint\` paise**, with a \`currency char(3)\` column. Integers add exactly. \`float\`/\`double\` cannot represent 0.1 and drift in sums. \`numeric\` is exact but slower, and node-postgres returns it as a string. ₹1,49,999.00 = 14,999,900 paise; bigint holds ~9.2 × 10^18. Do GST and discount splits in integer paise, and put the rounding remainder on one line deterministically.
- **Surrogate keys** (\`bigint identity\`, or UUIDv7 when ids are generated client-side or across shards), plus **UNIQUE on natural keys** (email, SKU, idempotency key).
- **Status as text + CHECK** (or a lookup table). Postgres enums are awkward to remove values from, and a CHECK is easy to change in a migration.
- **Snapshots on the order:** \`unit_price_paise\`, product title and the shipping address are copied at checkout.
- **Soft delete only where history needs it.** Products get \`deleted_at\` (old orders reference them). Use \`ON DELETE RESTRICT\` on order_items → products, so nothing can hard-delete a sold product. Uniqueness must ignore deleted rows: \`CREATE UNIQUE INDEX … (sku) WHERE deleted_at IS NULL\`; a plain UNIQUE (sku) blocks re-listing a SKU forever. Every query must also filter \`deleted_at IS NULL\`, which ORMs do with default scopes. A view or an archive table is the alternative when soft-deleted rows dominate.
- **Constraints over app checks:** \`CHECK (qty > 0)\`, \`CHECK (amount_paise >= 0)\`, FKs everywhere, \`UNIQUE (idempotency_key)\` on orders and payments so a double-tap creates one order.

**4. Indexes from the queries, not from the columns**

| Query | Index |
|---|---|
| order history: \`WHERE customer_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20\` | \`orders (customer_id, created_at DESC, id DESC)\`, which serves keyset pagination too |
| order detail items | PK \`order_items (order_id, line_no)\` |
| "orders containing product X" (support, recalls) | \`order_items (product_id)\` |
| products of a category | junction PK \`(category_id, product_id)\` + reverse \`(product_id)\` |
| payment by gateway reference (webhook) | \`UNIQUE (gateway, gateway_ref)\` |

**5. At 10× scale, say:** partition \`orders\`/\`order_items\` by month (range on created_at) for retention; shard by \`customer_id\` if a single primary is the limit. order_items should carry \`customer_id\` too then, so it co-locates with its order. Move "top products" to a read model (see the denormalization section).`,
      code: [
        {
          language: 'sql',
          title: 'Interview-grade DDL: paise, snapshots, m:n, soft delete and query-driven indexes',
          code: `CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku         text   NOT NULL,
  title       text   NOT NULL,
  price_paise bigint NOT NULL CHECK (price_paise >= 0),
  deleted_at  timestamptz                                   -- soft delete: old orders still render
);
CREATE UNIQUE INDEX products_sku_live ON products (sku) WHERE deleted_at IS NULL;

CREATE TABLE product_categories (                           -- many-to-many junction
  category_id bigint NOT NULL REFERENCES categories(id),
  product_id  bigint NOT NULL REFERENCES products(id),
  PRIMARY KEY (category_id, product_id)                     -- serves "products in category"
);
CREATE INDEX ON product_categories (product_id);            -- serves "categories of product"

CREATE TABLE orders (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id     bigint NOT NULL REFERENCES customers(id),
  status          text   NOT NULL CHECK (status IN ('created','paid','shipped','delivered','cancelled')),
  currency        char(3) NOT NULL DEFAULT 'INR',
  total_paise     bigint NOT NULL CHECK (total_paise >= 0),
  ship_address    jsonb  NOT NULL,                          -- snapshot at checkout
  idempotency_key uuid   NOT NULL UNIQUE,                   -- double-tap = one order
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_history ON orders (customer_id, created_at DESC, id DESC);

CREATE TABLE order_items (
  order_id         bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_no          smallint NOT NULL,
  product_id       bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  title_snapshot   text   NOT NULL,
  unit_price_paise bigint NOT NULL CHECK (unit_price_paise >= 0),
  qty              int    NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, line_no)
);
CREATE INDEX ON order_items (product_id);`,
        },
      ],
      keyPoints: [
        'Requirements → cardinalities → keys → constraints → indexes per query → scale story.',
        'bigint paise + currency; snapshots for price/title/address; idempotency key UNIQUE.',
        'Soft delete needs partial unique indexes and RESTRICT FKs; prefer it only where history needs it.',
      ],
      source: 'PostgreSQL 17 docs — 5.4 Constraints, 11.8 Partial Indexes',
    },
    {
      heading: 'Interview SQL classics: Nth highest, duplicates, gaps and islands',
      body: `**Intuition:** SDE-2 SQL rounds at Indian product companies reuse a handful of patterns, wrapped in different stories. Recognise the pattern, state the edge cases (ties, NULLs, empty result), then write it.

**1. Second-highest (Nth highest) salary, overall or per department**
- State the edge cases first. **Ties:** 300, 300, 200 → second-highest is 200, not 300. **Fewer than N distinct values:** return NULL, not "no row". **NULL salaries:** Postgres sorts NULLs *first* under DESC, so filter them out.
- \`DENSE_RANK() = N\` handles ties. A scalar subquery with \`SELECT DISTINCT salary … ORDER BY salary DESC OFFSET N-1 LIMIT 1\`, wrapped in an outer SELECT, returns NULL when absent.
- Classic \`max(salary) WHERE salary < (SELECT max(salary) …)\` works only for N = 2.

**2. Find and remove duplicates**
- Find: \`GROUP BY lower(email) HAVING count(*) > 1\`.
- Remove keeping the oldest: rank with \`ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY id)\` and delete rn > 1. Then **add the constraint** (\`CREATE UNIQUE INDEX ON users (lower(email))\`), or the duplicates come back next week. On 50M rows, delete in batches of 5–10K to keep transactions and replication lag small.

**3. Gaps and islands**
- **Islands (consecutive runs):** login streaks, consecutive days a rider was online. Trick: for consecutive dates, \`d - ROW_NUMBER()\` is constant within a run. Group by that difference. De-duplicate first (two logins on one day break the arithmetic).
- **Gaps (missing values):** missing invoice numbers for a GST audit. \`LEAD(no) OVER (ORDER BY no)\` and keep rows where \`next > no + 1\`. Or anti-join against \`generate_series(min, max)\` when you need every missing number listed.

**4. Others you should be able to write in 3 minutes:** customers who bought in every month of the quarter (\`GROUP BY customer HAVING count(DISTINCT month) = 3\`), month-over-month growth (\`LAG\`), "users who did A but never B" (NOT EXISTS), and a running balance per wallet (window SUM with ROWS frame).`,
      code: [
        {
          language: 'sql',
          title: 'Verified solutions: Nth highest per department, dedupe + constraint, islands and gaps',
          code: `-- Second-highest DISTINCT salary per department; NULL when a department has < 2 values
-- emp: eng {300,300,200,100}, ops {90}  ->  eng 200, ops NULL
SELECT d.dept,
       (SELECT salary
          FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS dr
                  FROM emp e
                 WHERE e.dept = d.dept AND e.salary IS NOT NULL) t
         WHERE dr = 2
         LIMIT 1) AS second_highest
  FROM (SELECT DISTINCT dept FROM emp) d;

-- Remove case-insensitive duplicate emails, keep the lowest id, then prevent recurrence
DELETE FROM users u
 USING (SELECT id, ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY id) AS rn
          FROM users) d
 WHERE u.id = d.id AND d.rn > 1;
CREATE UNIQUE INDEX users_email_ci ON users (lower(email));

-- Islands: login streaks. 1,2,3 Mar and 5,6 Mar -> two streaks (3 days, 2 days)
WITH days AS (SELECT DISTINCT user_id, login_date FROM logins),
     grp  AS (SELECT user_id, login_date,
                     login_date - ROW_NUMBER() OVER (PARTITION BY user_id
                                                     ORDER BY login_date)::int AS island
                FROM days)
SELECT user_id, min(login_date) AS streak_start, max(login_date) AS streak_end,
       count(*) AS days
  FROM grp
 GROUP BY user_id, island
 ORDER BY user_id, streak_start;

-- Gaps: invoice numbers 1,2,3,6,7,10 -> missing ranges 4..5 and 8..9
SELECT no + 1 AS gap_start, next_no - 1 AS gap_end
  FROM (SELECT no, LEAD(no) OVER (ORDER BY no) AS next_no FROM invoices) t
 WHERE next_no > no + 1;`,
        },
      ],
      keyPoints: [
        'Nth highest: DENSE_RANK for ties; a scalar subquery gives NULL when absent.',
        'Dedupe = ROW_NUMBER + remove rn > 1, then a UNIQUE index so it cannot recur.',
        'Islands: value − ROW_NUMBER is constant per run; gaps: LEAD and next > current + 1.',
      ],
      source: 'Itzik Ben-Gan — T-SQL Querying, gaps and islands chapter; PostgreSQL 17 docs — 9.22 Window Functions',
    },
  ],
  codeChallenges: [
    {
      id: 'db-sql-fundamentals-cc-1',
      title: 'Fix the city revenue report: the vanishing customers, the merged Ashas and the tripled revenue',
      context:
        'A NestJS reporting endpoint feeds the finance team\'s "revenue per customer in a city" sheet for a month. Finance says (a) customers with no orders are missing although the sheet must list every customer in the city, (b) two different customers named Asha appear as one row, and (c) revenue for multi-item orders is far higher than the payment gateway settlement report. On a 4-customer sample the query returns a single row: Asha, orders 4, revenue 4,79,000 paise. The correct answer is three rows totalling 2,59,600 paise.',
      task: 'Rewrite the query (and the mapping code) so that every customer of the city appears once, zero-activity customers show 0, order counts and units are correct, and revenue equals the sum of captured payments for orders in the window. Keep it a single round trip.',
      starter: {
        language: 'typescript',
        title: 'reports.repository.ts (buggy)',
        code: `import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class ReportsRepository {
  constructor(private readonly pool: Pool) {}

  async cityRevenue(city: string, from: Date, to: Date) {
    const { rows } = await this.pool.query(
      \`SELECT c.city, c.name,
              COUNT(*)             AS orders,
              SUM(oi.qty)          AS units,
              SUM(p.amount_paise)  AS revenue_paise
         FROM customers c
         LEFT JOIN orders o       ON o.customer_id = c.id
         LEFT JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN payments p     ON p.order_id = o.id
        WHERE c.city = $1
          AND o.created_at >= $2 AND o.created_at < $3
          AND p.status = 'captured'
        GROUP BY c.city, c.name
        ORDER BY revenue_paise DESC\`,
      [city, from, to],
    );
    // finance wants rupees
    return rows.map((r) => ({ ...r, revenue: r.revenue_paise / 100 }));
  }
}`,
      },
      hints: [
        'Which predicates in WHERE reference tables on the optional side of a LEFT JOIN, and what happens to a NULL-padded row when they are evaluated?',
        'Order 101 has 3 item rows and 2 payment rows. How many rows does it contribute after both joins, and how many times is each payment summed?',
        'What does GROUP BY c.name do with two different customers who share a name? What type does node-postgres return for SUM over a bigint column?',
      ],
      solution: {
        language: 'typescript',
        title: 'reports.repository.ts (fixed)',
        code: `import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

export interface CustomerRevenueRow {
  customerId: number;
  name: string;
  orders: number;
  units: number;
  revenuePaise: bigint; // exact integer paise; format to rupees only at the edge
}

@Injectable()
export class ReportsRepository {
  constructor(private readonly pool: Pool) {}

  async cityRevenue(city: string, from: Date, to: Date): Promise<CustomerRevenueRow[]> {
    const { rows } = await this.pool.query(
      \`WITH o AS (                       -- orders in the window, filtered BEFORE the outer join
         SELECT id, customer_id FROM orders
          WHERE created_at >= $2 AND created_at < $3
       ), units AS (                     -- pre-aggregate child 1: one row per order
         SELECT oi.order_id, SUM(oi.qty) AS units
           FROM order_items oi JOIN o ON o.id = oi.order_id
          GROUP BY oi.order_id
       ), paid AS (                      -- pre-aggregate child 2: one row per order
         SELECT p.order_id, SUM(p.amount_paise) AS paise
           FROM payments p JOIN o ON o.id = p.order_id
          WHERE p.status = 'captured'
          GROUP BY p.order_id
       )
       SELECT c.id                                   AS customer_id,
              c.name,
              COUNT(o.id)::int                       AS orders,      -- 0 for no orders
              COALESCE(SUM(u.units), 0)::int         AS units,
              COALESCE(SUM(pd.paise), 0)::text       AS revenue_paise -- exact, as text
         FROM customers c
         LEFT JOIN o          ON o.customer_id = c.id
         LEFT JOIN units u    ON u.order_id = o.id                 -- 1:1 with o
         LEFT JOIN paid pd    ON pd.order_id = o.id                -- 1:1 with o
        WHERE c.city = $1                                          -- preserved side: WHERE is fine
        GROUP BY c.id, c.name                                      -- group by the key
        ORDER BY SUM(pd.paise) DESC NULLS LAST, c.id\`,
      [city, from, to],
    );
    return rows.map((r) => ({
      customerId: r.customer_id,
      name: r.name,
      orders: r.orders,
      units: r.units,
      revenuePaise: BigInt(r.revenue_paise),
    }));
  }
}`,
      },
      explanation: `**Bugs fixed, verified on a 4-customer sample (starter: 1 row, Asha 4 orders 4,79,000 paise; fixed: Asha#4 1,49,900 · Asha#1 1,09,700 · Meera 0):**
1. **LEFT JOIN + WHERE trap.** \`o.created_at\` and \`p.status\` filters in WHERE discard NULL-padded rows, so Meera vanished. The window filter now lives in the \`o\` CTE; the captured filter lives inside \`paid\`. Only \`c.city\` (preserved side) stays in WHERE.
2. **Wrong GROUP BY.** \`GROUP BY c.city, c.name\` merged two different customers named Asha. Group by the key \`c.id\`. Adding \`c.name\` is harmless, and Postgres would even allow selecting it without that, because it is functionally dependent on the PK.
3. **Fan-out double counting.** Joining two one-to-many children (3 items × 2 payments for order 101) produced 6 rows. Each captured payment was summed 3 times and \`COUNT(*)\` counted rows, not orders. Each child is pre-aggregated to one row per order, then joined 1:1, and orders are counted with \`COUNT(o.id)\`.
4. **NULL aggregates.** \`COALESCE(..., 0)\` gives zero-activity customers 0 instead of NULL.
5. **Sort order.** \`ORDER BY revenue_paise DESC\` puts NULLs first in Postgres. The new ORDER BY says NULLS LAST and adds a deterministic tie-breaker.
6. **Money types.** \`SUM(bigint)\` returns \`numeric\`, which node-postgres returns as a string; \`/ 100\` coerced it into a float of rupees. Return exact paise (text → BigInt) and format at the presentation layer.`,
      followUps: [
        {
          q: 'This report now takes 40 s over 30M orders for a month. What do you check first and what would you change?',
          a: 'Run `EXPLAIN (ANALYZE, BUFFERS)`. The `o` CTE needs an index on `orders (created_at)`, or better `(created_at) INCLUDE (customer_id)`, for an index-only scan of the window. The two pre-aggregations hash-aggregate the window\'s items and payments, so check for `Batches > 1` and raise `work_mem` for this session only. If finance runs it daily, maintain a `daily_customer_revenue` rollup (written by a nightly job or CDC). The report then reads ~30 rows per customer-month instead of 30M orders.',
        },
        {
          q: 'Finance now wants revenue net of refunds, where refunds live in a third child table and can arrive the next month. How do you extend the query without reintroducing fan-out?',
          a: 'Add a third pre-aggregated CTE, `refunds AS (SELECT order_id, SUM(amount_paise) … GROUP BY order_id)`, and LEFT JOIN it 1:1 like `paid`. Decide the accounting rule explicitly. Attribute refunds to the order\'s month (join on order id, ignore the refund date) or to the refund\'s month (filter refunds by their own `created_at` and group by refund month). The two give different monthly numbers, and finance usually wants the second for settlement reconciliation.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-cc-2',
      title: 'Normalize the marketplace listings sheet into a constrained schema and migrate the data',
      context:
        'A marketplace imported its seller catalogue from spreadsheets into one table. Support keeps hitting anomalies: a seller who changed city still shows the old city on half their listings, a product\'s title differs between sellers, a product cannot be created before a seller lists it, and searching for "Appliances" requires LIKE \'%Appliances%\'. Colours are a product property and do not depend on the seller.',
      task: 'Design a normalized schema (at least BCNF, and 4NF for independent multi-valued facts) with database-enforced constraints. Write the INSERT … SELECT migration from the old table, and state which functional dependencies justified each table.',
      starter: {
        language: 'sql',
        title: 'seller_listings (one wide table)',
        code: `CREATE TABLE seller_listings (
  seller_id     int,
  seller_name   text,
  seller_gstin  text,
  seller_city   text,
  sku           text,
  title         text,
  brand         text,
  mrp_paise     bigint,
  price_paise   bigint,
  stock         int,
  categories    text,      -- 'Kitchen, Appliances'
  colours       text,      -- 'red,blue'
  PRIMARY KEY (seller_id, sku)
);

-- sample rows
-- 7 | Kitchen King | 29ABCDE1234F1Z5 | Bengaluru | KET-1 | Steel Kettle 1.5L | Prestige | 199900 | 149900 |  40 | Kitchen, Appliances | red,blue
-- 8 | HomeMart     | 27ABCDE9999F1Z2 | Pune      | KET-1 | Steel Kettle 1.5L | Prestige | 199900 | 154900 |  10 | Kitchen, Appliances | red,blue
-- 7 | Kitchen King | 29ABCDE1234F1Z5 | Bengaluru | MUG-2 | Ceramic Mug       | Borosil  |  39900 |  29900 | 200 | Kitchen             | white

-- typical query today
SELECT * FROM seller_listings WHERE categories LIKE '%Appliances%';`,
      },
      hints: [
        'Write the FDs: what does seller_id alone determine? What does sku alone determine? What needs both?',
        'categories and colours are comma-separated lists, which breaks 1NF. Are colours and categories independent of each other and of the seller?',
        'Migrate the parents first (sellers, products, categories), then the junctions, using string_to_array + unnest. Check first that each sku has exactly one (title, brand, mrp) across sellers.',
      ],
      solution: {
        language: 'sql',
        title: 'Normalized schema + migration (tested on PG 17: 2 sellers, 2 products, 2 categories, 3 product_categories, 3 colours, 3 listings)',
        code: `-- FDs: seller_id -> name, gstin, city | gstin -> seller_id (candidate key)
--      sku -> title, brand, mrp       | (seller_id, sku) -> price, stock
--      sku ->> category, sku ->> colour  (independent multi-valued facts -> 4NF split)
CREATE TABLE sellers (
  id     int PRIMARY KEY,
  name   text     NOT NULL,
  gstin  char(15) NOT NULL UNIQUE,              -- second candidate key, enforced
  city   text     NOT NULL
);
CREATE TABLE products (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku       text   NOT NULL UNIQUE,
  title     text   NOT NULL,
  brand     text   NOT NULL,
  mrp_paise bigint NOT NULL CHECK (mrp_paise >= 0)
);
CREATE TABLE categories (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text NOT NULL UNIQUE);
CREATE TABLE product_categories (
  product_id  bigint REFERENCES products(id),
  category_id bigint REFERENCES categories(id),
  PRIMARY KEY (product_id, category_id)
);
CREATE INDEX ON product_categories (category_id);   -- "all products in Appliances"
CREATE TABLE product_colours (
  product_id bigint REFERENCES products(id),
  colour     text NOT NULL,
  PRIMARY KEY (product_id, colour)
);
CREATE TABLE listings (                              -- the only seller x product fact
  seller_id   int    NOT NULL REFERENCES sellers(id),
  product_id  bigint NOT NULL REFERENCES products(id),
  price_paise bigint NOT NULL CHECK (price_paise > 0),
  stock       int    NOT NULL CHECK (stock >= 0),
  PRIMARY KEY (seller_id, product_id)
);

-- Pre-check: must return 0 rows, else resolve conflicting titles/MRPs first
SELECT sku FROM seller_listings GROUP BY sku HAVING count(DISTINCT (title, brand, mrp_paise)) > 1;

BEGIN;
INSERT INTO sellers SELECT DISTINCT seller_id, seller_name, seller_gstin, seller_city FROM seller_listings;
INSERT INTO products (sku, title, brand, mrp_paise)
  SELECT DISTINCT sku, title, brand, mrp_paise FROM seller_listings;
INSERT INTO categories (name)
  SELECT DISTINCT trim(c) FROM seller_listings, unnest(string_to_array(categories, ',')) AS c;
INSERT INTO product_categories
  SELECT DISTINCT p.id, cat.id
    FROM seller_listings s
    JOIN products p ON p.sku = s.sku
   CROSS JOIN LATERAL unnest(string_to_array(s.categories, ',')) AS c(name)
    JOIN categories cat ON cat.name = trim(c.name);
INSERT INTO product_colours
  SELECT DISTINCT p.id, trim(x)
    FROM seller_listings s JOIN products p ON p.sku = s.sku
   CROSS JOIN LATERAL unnest(string_to_array(s.colours, ',')) AS x;
INSERT INTO listings
  SELECT s.seller_id, p.id, s.price_paise, s.stock
    FROM seller_listings s JOIN products p ON p.sku = s.sku;
COMMIT;`,
      },
      explanation: `**Why each table exists**
- **sellers:** \`seller_id → name, gstin, city\` was a partial dependency on the (seller_id, sku) key (2NF violation). The city-drift anomaly disappears. \`gstin\` is a second candidate key, so it gets UNIQUE.
- **products:** \`sku → title, brand, mrp\` was the other partial dependency. Titles can no longer differ between sellers, and a product can exist before any listing (insert anomaly gone).
- **categories + product_categories:** the comma list violated 1NF. The junction table makes "products in Appliances" an indexed equality lookup instead of a LIKE scan.
- **product_colours:** colours are a multi-valued fact of the product, independent of category and seller. Keeping a colour × category × seller product of rows would be a 4NF violation.
- **listings:** only price and stock truly depend on (seller, product).

**Migration safety:** the pre-check catches SKUs whose duplicated attributes already drifted (DISTINCT would otherwise create a UNIQUE violation, or silently pick one). Parents load before children; the whole load runs in one transaction; \`trim\` normalises "Kitchen, Appliances" spacing. Constraints (CHECK price > 0, stock ≥ 0, FKs, UNIQUE gstin/sku) make the old anomalies impossible to reintroduce.`,
      followUps: [
        {
          q: 'Sellers want different colours in stock per listing (seller 7 has only red kettles). Does your 4NF split still hold?',
          a: 'No. Once availability depends on the seller, colour is no longer an independent multi-valued fact of the product. The fact becomes "seller S stocks product P in colour C with quantity Q", so the right table is `listing_variants(seller_id, product_id, colour, stock)` with a composite FK to `product_colours (product_id, colour)`. The FK keeps sellers to colours the product actually comes in. Stock moves from `listings` to the variant level.',
        },
        {
          q: 'The old table has 80M rows and the app must keep writing during migration. How do you run this without a long outage?',
          a: 'Create the new tables, then dual-write from the app (or install a trigger on `seller_listings` that upserts into the new tables). Backfill in id-ordered batches of ~10K rows with `INSERT … ON CONFLICT DO NOTHING`, sleeping between batches to keep replication lag low. Verify with count and checksum queries per seller, switch reads behind a feature flag, then stop the old writes. Never run one 80M-row INSERT … SELECT: it holds one huge transaction, bloats WAL and blocks vacuum.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'db-sql-fundamentals-iq-01',
      difficulty: 'hard',
      question:
        'Design the relational schema for orders on a Flipkart-style marketplace: customers, products in many categories, orders with multiple line items, and payments with retries. Walk me through keys, constraints, how you store money and which indexes you create.',
      context: 'The interviewer gives 25 minutes and expects DDL-level detail for the core tables, not boxes and arrows.',
      whatInterviewerLooksFor: [
        'Starts from the queries and invariants, not from a list of tables',
        'Correct cardinalities, including a junction table for product↔category',
        'Money as integer minor units with currency; snapshots of price/title/address on the order',
        'Invariants pushed into the database: FK, CHECK, UNIQUE (idempotency)',
        'Indexes justified by named queries; a credible plan for 10× scale',
      ],
      modelAnswer: `**Clarify (1 min):** top queries are order history per customer (newest first), the order detail page, category browse, and the payment webhook lookup. Invariants: an order total never changes after payment, and a double-tap must not create two orders.

**Entities:** customers 1–n orders; orders 1–n order_items; products n–m categories via \`product_categories(category_id, product_id)\`; orders 1–n payments (a failed attempt, then a success, then a partial refund).

**Key decisions**
- **Money:** \`bigint\` paise + \`currency char(3)\`. Floats cannot represent 0.10; \`numeric\` is exact but slower and arrives as a string in node-postgres. GST splits are done in integer paise with a deterministic remainder line.
- **Snapshots:** order_items stores \`unit_price_paise\` and \`title_snapshot\`; orders stores the shipping address as it was. A price change tomorrow must not rewrite yesterday's invoice. That is a fact of the line, not denormalization.
- **Keys:** bigint identity (or UUIDv7 if clients or multiple shards generate ids), plus \`UNIQUE (idempotency_key)\` on orders and \`UNIQUE (gateway, gateway_ref)\` on payments, so webhook retries are no-ops.
- **Constraints:** \`CHECK (qty > 0)\`, \`CHECK (amount_paise >= 0)\`, status \`CHECK (status IN (…))\`, FKs with \`ON DELETE RESTRICT\` from order_items to products. Products are soft-deleted with \`deleted_at\` and a partial unique index on \`sku WHERE deleted_at IS NULL\`.

**Indexes from queries**
| Query | Index |
|---|---|
| history page | \`orders (customer_id, created_at DESC, id DESC)\`, also serving keyset pagination |
| order detail | \`order_items\` PK \`(order_id, line_no)\` |
| category browse | junction PK \`(category_id, product_id)\` |
| recalls / "who bought X" | \`order_items (product_id)\` |

**Numbers:** 5M orders/day × 3 lines ≈ 15M item rows/day. At ~80 B per row plus index overhead, that is ~1.5–2 GB/day: fine for one Postgres primary for a year, with monthly range partitions for retention.

**10×:** shard by \`customer_id\` (history stays single-shard) and carry customer_id on order_items so lines co-locate. Category top-sellers move to a CDC-fed read model.`,
      followUps: [
        {
          q: 'Sellers want a "my orders" page too. Orders are sharded by customer_id. What now?',
          a: 'A seller\'s lines span every shard, so a seller query would scatter-gather. Maintain a seller-side projection, `seller_order_lines(seller_id, created_at, order_id, line_no, …)`, sharded by seller_id and fed from the outbox/CDC stream. It is eventually consistent (seconds), which is fine for a seller dashboard. Payouts reconcile against the source of truth, not the projection.',
        },
        {
          q: 'Why not store the order as one JSONB document instead of order_items rows?',
          a: 'JSONB is tempting because an order is read as a whole. But you lose FK checks to products, CHECK constraints per line, and cheap "who bought product X" queries (they need a GIN index over every document). Partial updates (cancel one line) also rewrite the whole TOASTed value. A reasonable hybrid keeps relational lines and adds a JSONB `attributes` column for seller-specific options that are never queried.',
        },
        {
          q: 'How do you keep orders.total_paise consistent with its items?',
          a: 'Compute it in the same transaction that inserts the lines, and freeze it once paid. Enforce it with a deferred constraint trigger that checks `total = SUM(qty × unit_price) − discounts` at commit, or by recomputing in a nightly reconciliation job that alerts on any mismatch. Never recompute totals from current product prices.',
        },
      ],
      pitfalls: [
        'Storing money as float/double or as rupees in numeric without stating rounding rules',
        'Joining to the live products table to show historical order prices',
        'Creating indexes on "every foreign key" without naming the queries they serve',
        'Soft delete with a plain UNIQUE (sku), which blocks re-listing forever',
      ],
    },
    {
      id: 'db-sql-fundamentals-iq-02',
      difficulty: 'medium',
      question:
        'A junior asks why `SELECT price * qty AS amount FROM order_items WHERE amount > 1000` fails, yet Postgres accepts `GROUP BY amount` and `ORDER BY amount`. Explain the evaluation order you would teach them, and where window functions and DISTINCT fit in it.',
      whatInterviewerLooksFor: [
        'States the logical order correctly, including window functions before DISTINCT',
        'Explains that aliases are created in the SELECT step',
        'Knows GROUP BY alias is a Postgres extension and ORDER BY alias is standard',
        'Distinguishes logical order from physical execution',
      ],
      modelAnswer: `**The logical order** defines what each clause can see:
1. **FROM / JOIN**: build the row set.
2. **WHERE**: filter rows. Only input columns exist here; no aggregates, no output aliases.
3. **GROUP BY**: form groups.
4. **HAVING**: filter groups; aggregates are available.
5. **Window functions**: computed over the post-HAVING rows.
6. **SELECT list**: output expressions are evaluated and **aliases are born here**.
7. **DISTINCT**: de-duplicate output rows.
8. **UNION / INTERSECT / EXCEPT**.
9. **ORDER BY**: can use output aliases.
10. **LIMIT / OFFSET**.

**So:** \`WHERE amount > 1000\` runs at step 2, before \`amount\` exists at step 6, giving \`column "amount" does not exist\`. Fix it by repeating the expression (\`WHERE price * qty > 1000\`) or by wrapping the query in a subquery/CTE and filtering outside. The planner inlines that, so it costs nothing.

**Why GROUP BY alias works in Postgres:** it is a non-standard extension. When a GROUP BY name does not match an input column, Postgres tries output-column names and ordinals. Standard SQL and SQL Server reject it, and an input column with the same name wins over the alias, which is a subtle source of bugs. HAVING does *not* accept aliases in Postgres.

**ORDER BY alias** is standard because ORDER BY logically runs after SELECT. But inside an expression (\`ORDER BY amount + 1\`) Postgres resolves names against input columns, so it fails.

**Windows and DISTINCT:** windows run before DISTINCT. \`SELECT DISTINCT city, count(*) OVER () FROM customers\` returns each city with the *total* row count, not the number of distinct cities. Windows cannot appear in WHERE either, so "latest order per customer" needs ROW_NUMBER in a subquery filtered outside (Postgres has no QUALIFY).

**Caveat:** this is semantic order only. The planner pushes predicates into scans, reorders joins and stops early for LIMIT, as long as the result is the same.`,
      followUps: [
        {
          q: 'If the subquery wrapper is inlined anyway, is there ever a performance difference between repeating the expression and wrapping?',
          a: 'Usually none: the planner flattens a simple subquery and pushes the predicate down. Differences appear when the wrapper cannot be flattened: it contains LIMIT, a window function, DISTINCT ON, a volatile function like `random()`, or a CTE marked MATERIALIZED. Then the inner query is computed fully and filtered afterwards. Also, an index on `(price * qty)` is only used if the predicate is written as the exact indexed expression.',
        },
        {
          q: 'Where does a FILTER clause on an aggregate, like count(*) FILTER (WHERE status = \'paid\'), sit in this order?',
          a: 'It is part of the aggregate, so it is evaluated during step 3 (grouping/aggregation), row by row as each row is fed to that aggregate. Unlike WHERE, it does not remove rows from the group, it only decides which rows this one aggregate sees. That is why one query can compute paid, cancelled and total counts in a single pass.',
        },
      ],
      pitfalls: [
        'Claiming SQL executes "top to bottom as written"',
        'Placing window functions after DISTINCT or ORDER BY',
        'Saying GROUP BY alias is standard SQL',
      ],
    },
    {
      id: 'db-sql-fundamentals-iq-03',
      difficulty: 'hard',
      question:
        'Product wants the top 3 dishes by revenue in each of 4,000 cuisine categories for the last 7 days, refreshed for a home-screen widget. Write the query, handle ties sensibly, and tell me how it performs on 120M order-line rows.',
      context: 'Asked in the style of a food-delivery backend SQL round; the interviewer wants both the SQL and the physical cost reasoning.',
      whatInterviewerLooksFor: [
        'Chooses ROW_NUMBER vs RANK vs DENSE_RANK deliberately for ties',
        'Pre-aggregates revenue per dish before ranking',
        'Knows the window approach sorts the whole input; offers LATERAL + index',
        'Moves the result to a precomputed read model given the refresh need',
      ],
      modelAnswer: `**Step 1: aggregate, then rank.** Ranking raw order lines is wrong: revenue is a sum per dish.
- CTE \`rev\`: \`SELECT d.cuisine_id, ol.dish_id, SUM(ol.qty * ol.unit_price_paise) AS revenue_paise FROM order_lines ol JOIN dishes d ON d.id = ol.dish_id WHERE ol.created_at >= now() - interval '7 days' GROUP BY 1, 2\`.
- Outer: \`ROW_NUMBER() OVER (PARTITION BY cuisine_id ORDER BY revenue_paise DESC, dish_id) AS rn\` in a subquery, then \`WHERE rn <= 3\` outside, because window functions cannot be filtered in the same level's WHERE.

**Ties:** a widget has exactly 3 slots, so ROW_NUMBER with a deterministic tie-breaker (\`dish_id\`) keeps the output stable between refreshes. RANK could return 5 rows for a cuisine when there are ties; DENSE_RANK "top 3 revenue values" could return even more.

**Cost:** 7 days of a 120M-row table is ~20M lines. The scan reads them through an index on \`created_at\` (or the latest weekly partitions), then a HashAggregate down to ~300K (cuisine, dish) groups. The sort for the window is over 300K rows, not 20M: tens of MB, around 1–3 s in total. The dominant cost is aggregating 20M lines, not the ranking.

**When LATERAL wins:** if revenue were already stored per dish (a \`dish_revenue_7d\` table with an index on \`(cuisine_id, revenue_paise DESC, dish_id)\`), then \`cuisines CROSS JOIN LATERAL (… ORDER BY revenue_paise DESC, dish_id LIMIT 3)\` does 4,000 × 3 index reads. That is ~12K tuples in milliseconds, versus ranking 300K rows.

**What I would ship:** a job every 5–15 minutes (or a materialized view refreshed CONCURRENTLY) writes \`top_dishes(cuisine_id, rank, dish_id, revenue_paise)\`. The widget reads ≤ 12K rows, or caches them in Redis. Nobody runs a 20M-row aggregation per page view.`,
      followUps: [
        {
          q: 'Revenue should exclude cancelled orders, but cancellations can happen up to 2 hours after the order. How does that affect your refresh design?',
          a: 'A rollup computed at 10:00 includes orders that may be cancelled by 12:00. Either recompute the trailing 7 days on every run (simple, and fine at 20M lines every 15 minutes), or maintain incremental per-day aggregates that are adjusted on cancellation events: subtract the line\'s revenue from that day\'s bucket. The incremental version needs idempotent event handling, because a replayed cancel would subtract twice.',
        },
        {
          q: 'What if the business says "show all dishes tied for 3rd place"?',
          a: 'Switch to `RANK() … WHERE rnk <= 3`, which includes every dish that ties at the cut-off, and accept a variable-length list. The UI must then cap or scroll. With DENSE_RANK you would get every dish among the top three distinct revenue values, which can be dozens when revenues are coarse (many dishes at exactly the same price × qty). That is usually not what product means.',
        },
      ],
      pitfalls: [
        'Ranking individual order lines instead of aggregated revenue',
        'Using RANK without realising it can return more than 3 rows per group',
        'Running the 7-day aggregation on every home-screen request',
      ],
    },
    {
      id: 'db-sql-fundamentals-iq-04',
      difficulty: 'hard',
      question:
        'A nightly job finds wallet accounts that have never transacted using `WHERE id NOT IN (SELECT account_id FROM wallet_txns)`. It returned zero rows for a week, and then started taking 6 hours. Explain both symptoms and fix the query.',
      context: 'Payments company scenario. wallet_txns has 900M rows; a migration last week made account_id nullable for "system" transactions.',
      whatInterviewerLooksFor: [
        'Three-valued logic: one NULL makes NOT IN UNKNOWN for every row',
        'Knows NOT IN cannot be planned as an anti-join, and the hashed vs per-row SubPlan cliff',
        'Fixes with NOT EXISTS (or LEFT JOIN … IS NULL on the join key), explains the plan',
        'Suggests a better data model for the question (a first_txn_at column)',
      ],
      modelAnswer: `**Symptom 1: zero rows.** After the migration, system transactions have \`account_id = NULL\`. \`x NOT IN (a, b, …, NULL)\` means \`x <> a AND x <> b AND … AND x <> NULL\`. The last term is UNKNOWN, so the whole predicate is at best UNKNOWN for *every* account, and WHERE keeps only TRUE. The query is logically correct SQL that returns nothing.

**Symptom 2: 6 hours.** Because of those NULL semantics, Postgres cannot convert NOT IN into an anti-join. It evaluates a SubPlan. If the subquery result fits in hash memory (\`work_mem × hash_mem_multiplier\`), it is a *hashed SubPlan*: one hash build plus a probe per account, which is fine. 900M account_ids (even ~50M distinct) do not fit, so the planner falls back to a plain SubPlan that rescans the materialized subquery **for each outer row**. That is accounts × transactions comparisons, which is quadratic.

**Fix:** \`WHERE NOT EXISTS (SELECT 1 FROM wallet_txns t WHERE t.account_id = a.id)\`
- NULL-safe: a NULL account_id simply never equals \`a.id\`.
- Plans as a **Hash Anti Join**, or a Nested Loop Anti Join probing \`wallet_txns (account_id)\` once per account. With 20M accounts and an index, that is 20M index probes, minutes not hours. Check with \`EXPLAIN\` that the node says "Anti Join".
- \`LEFT JOIN wallet_txns t ON t.account_id = a.id WHERE t.account_id IS NULL\` is equivalent and also becomes an anti-join; testing the join key (not some other column) is what lets the planner recognise the pattern.

**Better model:** the question "has this account ever transacted?" is asked nightly over 900M rows. Store \`first_txn_at\` on accounts, set once in the transaction-insert path with \`UPDATE … WHERE first_txn_at IS NULL\`. The job becomes \`WHERE first_txn_at IS NULL\` on a partial index: milliseconds.

**Process lesson:** making a column nullable silently changed query semantics elsewhere. Search for NOT IN on that column whenever you change nullability.`,
      followUps: [
        {
          q: 'Could you keep NOT IN by adding WHERE account_id IS NOT NULL in the subquery? Is that good enough?',
          a: 'It fixes correctness: no NULLs, so no UNKNOWN. It does not fix performance, because the planner still will not produce an anti-join for NOT IN, and at 900M rows the hashed SubPlan will not fit in memory, so the per-row rescan returns. It is also fragile: the next person who removes the filter reintroduces the bug. NOT EXISTS is correct and fast by construction.',
        },
        {
          q: 'The anti-join now runs in 8 minutes but saturates the primary\'s I/O at 02:00 when settlement batches also run. Options?',
          a: 'Run it on a read replica (the job is read-only and a few seconds of lag is irrelevant), or drive it from the `first_txn_at` column so it touches only a partial index. If it must stay on the primary, iterate accounts in keyset batches (`WHERE id > $last ORDER BY id LIMIT 50000`) with short pauses. Many small anti-joins against the `(account_id)` index keep I/O smooth, and each statement stays short so it does not hold back vacuum.',
        },
      ],
      pitfalls: [
        'Saying "NOT IN and NOT EXISTS are equivalent"',
        'Blaming the slowdown only on table growth without mentioning the SubPlan fallback',
        'Adding DISTINCT to the subquery and calling it fixed',
      ],
    },
    {
      id: 'db-sql-fundamentals-iq-05',
      difficulty: 'expert',
      question:
        'An order-lookup API joins orders (40M rows) to shipments. p50 is 15 ms, but for merchants with large catalogues p99 is 9 seconds. EXPLAIN shows a Nested Loop with the outer side estimated at 40 rows and actually returning 180,000. Explain what is going on and how you decide between nested loop, hash and merge join here.',
      whatInterviewerLooksFor: [
        'Reads the estimate-vs-actual gap as the root cause, not "nested loops are bad"',
        'Knows the cost shape of each join algorithm and when each wins',
        'Knows the fixes: statistics, extended stats, query shape, generic vs custom plans',
        'Does not reach for global enable_* switches or hints as the fix',
      ],
      modelAnswer: `**What happened:** the planner estimated 40 outer rows, and for 40 rows a nested loop with an index probe on \`shipments (order_id)\` is optimal: 40 × ~0.02 ms. For big merchants the outer side is 180,000 rows, so it does 180,000 random index probes. Each one is cheap, but many hit disk, and 180K × ~0.05 ms ≈ 9 s. The algorithm is not wrong; the **estimate** is.

**Why estimates go wrong here**
- **Skew:** \`merchant_id\` has a long tail. \`pg_statistic\` keeps a most-common-values list (default 100 entries, \`default_statistics_target\`). A big merchant missing from it gets the "average" selectivity.
- **Correlated predicates:** \`merchant_id = $1 AND status = 'open'\` multiplies two selectivities as if they were independent.
- **Generic plans:** a prepared statement (most Node ORMs, or pg with named statements) can switch to a generic plan after 5 executions. It is planned for an "average" merchant and reused for the giant one.

**Algorithm choice in one table**
| Algorithm | Cost shape | Right when |
|---|---|---|
| Nested loop | outer × index probe | outer ≤ ~ thousands, inner indexed; LIMIT queries; non-equi conditions |
| Hash join | build smaller side + one pass of the larger | big equi-joins without useful order; build side fits work_mem × 2 |
| Merge join | sort (or index order) both + one merge pass | both inputs arrive sorted on the key, or very large inputs |

For 180K orders × their shipments, a hash join (hash the 180K order ids, scan the matching shipments) or a merge on \`order_id\` index order would be ~300–600 ms.

**Fixes, in order**
1. \`ALTER TABLE orders ALTER merchant_id SET STATISTICS 1000; ANALYZE orders;\` so big merchants enter the MCV list.
2. \`CREATE STATISTICS (dependencies, mcv) ON merchant_id, status FROM orders;\` for the correlated predicates.
3. Set \`plan_cache_mode = force_custom_plan\` for this statement's session (or use unnamed statements) so each call is planned with the real parameter.
4. Pagination: this API should never return 180K rows. Keyset-paginate to 50 and the nested loop is right again.

I would not set \`enable_nestloop = off\` globally: it fixes this query and breaks hundreds of others.`,
      followUps: [
        {
          q: 'After the statistics fix the planner picks a hash join for big merchants, but EXPLAIN shows Batches: 16 and it is still 2 s. What next?',
          a: 'Batches > 1 means the build side did not fit in `work_mem × hash_mem_multiplier` and spilled to temp files, which costs write plus read I/O. Check which side is being hashed: it should be the smaller one. Raise `work_mem` for this query only (`SET LOCAL work_mem = \'256MB\'` inside the transaction). Narrow the hashed rows by selecting fewer columns, because the hash stores the whole projected tuple. Or add a covering index so the probe side becomes an index-only scan.',
        },
        {
          q: 'Why might the planner still prefer the nested loop when the query has LIMIT 50?',
          a: 'With LIMIT, the planner costs a plan by how fast it produces the *first* 50 rows. A nested loop driven by an index in ORDER BY order can emit 50 rows after ~50 probes and stop, while a hash join must build the whole hash table first. That is correct if matches are dense. If matches are rare (the filter rejects most rows), the "fast start" estimate is a disaster. This is the classic LIMIT-plus-filter trap, fixed by a composite index matching filter + order.',
        },
      ],
      pitfalls: [
        'Concluding "nested loops are slow, disable them"',
        'Not reading estimated vs actual rows',
        'Ignoring prepared-statement generic plans in ORM-driven apps',
      ],
    },
    {
      id: 'db-sql-fundamentals-iq-06',
      difficulty: 'expert',
      question:
        'Our warehouse team tracks picking in one table: order_pickers(order_id, category, picker_id). Each picker handles exactly one category, and each order gets one picker per category. Is this table normalized? Take it as far as you would in production, and tell me what you give up.',
      whatInterviewerLooksFor: [
        'Lists the functional dependencies and candidate keys before naming a normal form',
        'Recognises the table is in 3NF but not BCNF (overlapping candidate keys)',
        'Shows the anomalies concretely',
        'Knows BCNF decomposition can lose dependency preservation, and how to re-enforce the rule',
      ],
      modelAnswer: `**Dependencies first.**
- FD1: \`picker_id → category\` (a picker works one category).
- FD2: \`(order_id, category) → picker_id\` (one picker per order-category).
- Candidate keys: \`(order_id, category)\`, and also \`(order_id, picker_id)\`, since picker_id gives category and then FD2 applies.

**Which normal form?**
- 2NF/3NF test non-key attributes. Every attribute here is *prime* (part of some candidate key), so there are no partial or transitive dependencies of a non-prime attribute: the table is **in 3NF**.
- BCNF requires every determinant to be a superkey. \`picker_id\` determines \`category\` but is not a superkey, so it is **not in BCNF**.

**Anomalies that follow**
- Update: Kiran moves from Electronics to Grocery, and every historical row of hers must change. Miss one and she "works" two categories.
- Insert: a new picker's category cannot be recorded until she picks an order.
- Delete: removing the only order she picked forgets her category.

**BCNF decomposition:** \`pickers(picker_id PK, category)\` + \`order_pickers(order_id, picker_id, PK both)\`. It is lossless, because the shared attribute picker_id is a key of pickers.

**What we give up:** FD2 now spans two tables. No single UNIQUE constraint expresses "one picker per (order, category)". This is the textbook result: 3NF decomposition always preserves dependencies, BCNF sometimes cannot. Options:
1. A BEFORE INSERT trigger that joins pickers and rejects a second picker of the same category. Under concurrency it must lock the order row (\`SELECT … FOR UPDATE\` on orders) or run SERIALIZABLE, or two inserts both pass.
2. Keep a redundant \`category\` column in order_pickers with a composite FK \`(picker_id, category) → pickers(picker_id, category)\` (needs a UNIQUE on that pair) plus \`UNIQUE (order_id, category)\`. The redundancy is fully constraint-checked, so it cannot drift, and FD2 is enforced declaratively.

**What I'd ship:** option 2. It is technically back to 3NF, but every copy is guarded by an FK, and declarative constraints are race-free. Normal forms are tools for removing anomalies, not goals in themselves.`,
      followUps: [
        {
          q: 'In option 2, what happens when Kiran legitimately changes category next month?',
          a: 'The FK `(picker_id, category) → pickers` blocks updating `pickers.category` while old rows reference the old pair, unless the FK is `ON UPDATE CASCADE`, which would rewrite history. The cleaner model treats assignment as time-varying: `picker_assignments(picker_id, category, valid_from, valid_to)` with an exclusion constraint against overlapping periods. order_pickers then references the assignment that was valid at pick time. History stays true.',
        },
        {
          q: 'How do you prove the BCNF decomposition is lossless rather than just asserting it?',
          a: 'A binary decomposition R → R1, R2 is lossless if the common attributes form a key of at least one side. Here R1 = pickers(picker_id, category) and R2 = order_pickers(order_id, picker_id). They share `picker_id`, which is the key of R1, so joining them back on picker_id cannot create spurious rows: each order_pickers row matches exactly one pickers row.',
        },
      ],
      pitfalls: [
        'Declaring "it has a composite key, so it violates 2NF" without listing dependencies',
        'Claiming BCNF is always achievable without any cost',
        'Proposing an app-level check without discussing concurrency',
      ],
    },
    {
      id: 'db-sql-fundamentals-iq-07',
      difficulty: 'hard',
      question:
        'The restaurant listing page computes average rating, rating count, cuisines and "orders this week" with joins and aggregates on every request. It is at 20K QPS and the DB is at 85% CPU. A teammate proposes adding those as columns on the restaurants table. How do you evaluate and implement that denormalization?',
      context: 'Food-delivery listing service; ratings arrive at ~300/s, orders at ~2,000/s at dinner peak; 400K restaurants.',
      whatInterviewerLooksFor: [
        'Quantifies read savings vs write cost before deciding',
        'Picks a propagation mechanism per field based on freshness needs',
        'Spots the hot-row contention problem on popular restaurants',
        'Has a drift-detection and repair story; keeps decisions on the source of truth',
      ],
      modelAnswer: `**Quantify first.** Each card today aggregates ratings (median restaurant ~2K ratings) and 7 days of orders. 20K QPS × 50 cards per page means aggregating huge row sets per second; even cached partially, that is the CPU. Precomputed columns turn it into a PK lookup per card: ~0.05 ms. The read win is >100×.

**Choose a mechanism per field, by freshness need**
| Field | Freshness need | Mechanism |
|---|---|---|
| rating_count, rating_sum | seconds is fine; must be exact eventually | incremental update on rating insert |
| cuisines | changes weekly | copy as \`text[]\` on the listing row, updated by the admin flow in the same transaction |
| orders_7d | minutes is fine | rollup job / materialized view every 5 min |

**The hot-row trap:** \`UPDATE restaurants SET rating_count = rating_count + 1\` in the rating transaction serialises every rating of a viral restaurant on one row lock. It also creates a new tuple version per update, bloating the hot listing row that 20K QPS reads. Better options:
- Keep the counters out of \`restaurants\` in a separate \`restaurant_stats\` table, sharded into N rows per restaurant (sum on read, or fold periodically).
- Or consume rating events (outbox/CDC) and apply batched increments every second: one UPDATE per restaurant per second instead of per rating.

**Write cost:** ~300 ratings/s → ≤ 300 small updates/s, or far fewer when batched. That is trivial next to the 20K QPS of reads removed.

**Correctness guardrails**
- Average = \`rating_sum / rating_count\`, stored as integers (no floating drift from repeatedly updated averages).
- A nightly reconciliation recomputes from \`ratings\` and repairs plus alerts on any difference > 0. That is how you find the bug where an edit did not adjust the sum.
- Never use \`orders_7d\` for anything but display. Ranking/fraud logic reads the source.

**Also consider before denormalizing:** the listing is a read-heavy, geo-filtered, sortable view, which is a classic case for a search index (Elasticsearch/OpenSearch) fed by CDC. Then the denormalized document lives there and Postgres stays normalized.`,
      followUps: [
        {
          q: 'A customer edits a 5-star rating to 1 star. How does each mechanism handle edits and deletes?',
          a: 'Incremental counters must apply the delta: `rating_sum += new − old`, count unchanged. A delete does `sum −= old, count −= 1`. That requires the event to carry the old value (CDC before-images: in Postgres logical decoding, set `REPLICA IDENTITY FULL` on ratings, or read the old row in the same transaction). Recompute-style rollups handle edits automatically, at the cost of rescanning. The nightly reconciliation catches any path that forgot the delta.',
        },
        {
          q: 'The rollup job for orders_7d runs every 5 minutes and takes 4 minutes. What breaks first as you grow?',
          a: 'Soon the runtime exceeds the interval and runs overlap or queue, and REFRESH MATERIALIZED VIEW CONCURRENTLY doubles the work, diffing old vs new. Switch to incremental daily buckets: `restaurant_daily_orders(restaurant_id, day, count)` updated per order event (or per minute in batches). orders_7d is then a SUM over 7 small rows per restaurant, or itself maintained by adding today and subtracting the day that fell out of the window.',
        },
      ],
      pitfalls: [
        'Denormalizing without stating how and when each copy is updated',
        'Updating a counter on the hot restaurants row inside every rating transaction',
        'Storing a running average as a float and updating it incrementally',
      ],
    },
    {
      id: 'db-sql-fundamentals-iq-08',
      difficulty: 'medium',
      question:
        'Delivery partners get a bonus for working 5 or more consecutive days. Given rider_shifts(rider_id, shift_date) with possibly multiple shifts per day, write SQL to list each rider\'s streaks with start, end and length, and then find riders who qualify this month.',
      context: 'Classic gaps-and-islands question as asked in Indian product-company SQL rounds.',
      whatInterviewerLooksFor: [
        'De-duplicates to one row per rider-day first',
        'Uses the date minus ROW_NUMBER trick (or LAG-based run detection) and explains why it works',
        'Handles month boundaries explicitly',
        'Mentions an index and the cost at scale',
      ],
      modelAnswer: `**Approach (islands):** for consecutive dates, \`shift_date − ROW_NUMBER()\` is constant inside a run and jumps when a day is missing.

1. **De-duplicate:** \`SELECT DISTINCT rider_id, shift_date FROM rider_shifts\`. Two shifts on one day would give two row numbers for the same date and break the arithmetic.
2. **Tag islands:** \`shift_date - ROW_NUMBER() OVER (PARTITION BY rider_id ORDER BY shift_date)::int AS grp\`. Example: 1, 2, 3 Mar get row numbers 1, 2, 3 → grp = 28 Feb for all three; 5 and 6 Mar get 4 and 5 → grp = 1 Mar.
3. **Collapse:** \`GROUP BY rider_id, grp\` → \`min(shift_date) AS start, max(shift_date) AS end, count(*) AS days\`.
4. **Qualify:** \`HAVING count(*) >= 5\`, plus the month rule.

**Month boundary:** decide the business rule out loud. If a streak from 28 Feb to 4 Mar should count for March only when 5 days fall in March, filter the input to March *before* step 2. If any streak *ending* in March counts, compute islands over a wider window (previous month + this month) and filter on \`end\`. These give different payouts, so ask.

**Alternative:** \`LAG(shift_date) OVER (…)\` to flag a new island when the gap > 1 day, then a running \`SUM(flag)\` as the island id. It is more verbose but generalises to "gap ≤ 2 days still counts" (just change the threshold). The ROW_NUMBER trick cannot do that.

**Cost:** 300K riders × 30 days = 9M rows/month. With an index on \`(rider_id, shift_date)\` the window can read pre-sorted input without a sort: a few seconds as a nightly batch. Store results in \`rider_streaks\` for the payout service. Do not compute them on the rider app's request path.

**Edge cases to say:** time zones (a shift starting 23:30 IST stored in UTC is the previous date: use \`(started_at AT TIME ZONE 'Asia/Kolkata')::date\`), and riders with zero shifts (absent, which is correct here).`,
      followUps: [
        {
          q: 'Product changes the rule: a single missed day does not break the streak but does not count towards it. How does your query change?',
          a: 'Use the LAG formulation. Mark a new island when `shift_date − LAG(shift_date) > 2` (a gap of more than one missed day), take a running SUM of those flags as the island id, then group. `count(*)` still counts only worked days, while `max − min + 1` gives the calendar span. The ROW_NUMBER subtraction cannot express a tolerance, because it assumes strictly consecutive values.',
        },
        {
          q: 'Finance also needs missing invoice numbers per rider payout series. Same technique?',
          a: 'That is the gaps half of the problem: `LEAD(invoice_no) OVER (PARTITION BY series ORDER BY invoice_no)`, keeping rows where `next > invoice_no + 1` to emit ranges `(invoice_no + 1, next − 1)`. To list every missing number, anti-join `generate_series(min, max)` per series against the table, but cap the range size: a single bad row with invoice_no 99,999,999 would generate a hundred million numbers.',
        },
      ],
      pitfalls: [
        'Forgetting to de-duplicate multiple shifts per day',
        'Using DENSE_RANK on dates and getting wrong groups for duplicates',
        'Ignoring IST vs UTC date boundaries',
      ],
    },
    {
      id: 'db-sql-fundamentals-iq-09',
      difficulty: 'medium',
      question:
        'Write a query that returns the second-highest distinct transaction amount for every merchant, including merchants that have only one distinct amount (show NULL for them). Then tell me how your answer changes for the Nth highest and when the amount column contains NULLs.',
      whatInterviewerLooksFor: [
        'Handles ties via DISTINCT or DENSE_RANK',
        'Preserves merchants without a second value (outer join or scalar subquery)',
        'Knows NULLs sort first under DESC in Postgres',
        'Generalises cleanly to N and discusses performance',
      ],
      modelAnswer: `**Ties decide the function.** Amounts 500, 500, 300: the "second-highest distinct" is 300, so use \`DENSE_RANK\` (or DISTINCT before ranking). ROW_NUMBER would return 500, and RANK would skip rank 2 entirely (500, 500, 300 → ranks 1, 1, 3) and return nothing.

**Query shape**
- Inner: \`SELECT merchant_id, amount_paise, DENSE_RANK() OVER (PARTITION BY merchant_id ORDER BY amount_paise DESC) AS dr FROM txns WHERE amount_paise IS NOT NULL\`.
- Keep merchants without a rank 2: \`SELECT m.id, r.amount_paise FROM merchants m LEFT JOIN (… WHERE dr = 2 …) r ON r.merchant_id = m.id\`. DENSE_RANK = 2 can still appear on several rows (500, 300, 300), so take \`SELECT DISTINCT\` or \`max(amount_paise)\` in the derived table.
- The filter \`dr = 2\` sits in the derived table: it must be outside the window's own level, because window functions cannot appear in WHERE.

**Nth highest:** replace 2 with N. The scalar-subquery form (\`SELECT DISTINCT amount … ORDER BY amount DESC OFFSET N-1 LIMIT 1\`), used as a column expression per merchant, also returns NULL naturally when there is no Nth value. The classic \`max(x) WHERE x < (SELECT max(x) …)\` only works for N = 2.

**NULLs:** Postgres sorts NULL *first* under DESC, so an unfiltered DENSE_RANK makes NULL the "highest" amount. Filter \`IS NOT NULL\`, or write \`ORDER BY amount_paise DESC NULLS LAST\`. MySQL does the opposite (NULLs last under DESC), which is a portability trap worth naming.

**Performance:** the window version sorts all transactions of all merchants. On 500M transactions that is a big sort, run as a batch job. The per-merchant scalar form with an index on \`(merchant_id, amount_paise DESC)\` reads about N distinct values per merchant via the index: fast for an API that asks about one merchant at a time.`,
      followUps: [
        {
          q: 'Amounts are stored in paise but a few legacy rows are in rupees (100× smaller). How would you detect them with SQL before the report lies?',
          a: 'Compare each transaction with its merchant\'s typical scale. Compute `percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_paise)` per merchant and flag rows below median / 50 that also look like whole-rupee values. Join against the payment gateway\'s settlement records (which are authoritative) on the gateway reference and flag ratio = 100. Fix the data with a migration plus a CHECK or unit column, so the second-highest query does not silently pick a mis-scaled value.',
        },
        {
          q: 'The interviewer adds: "return the merchant\'s second-highest amount AND the date it first occurred". What changes?',
          a: 'You need a row-level attribute of the winning value, so rank distinct amounts first, then pick the earliest occurrence. Either `DENSE_RANK` over amounts and then `min(created_at)` grouped by (merchant, amount) among rows with dr = 2, or `ROW_NUMBER() OVER (PARTITION BY merchant_id, amount_paise ORDER BY created_at)` to keep the first occurrence of each amount, then rank those. Say the tie rule for two amounts in the same second.',
        },
      ],
      pitfalls: [
        'Using ROW_NUMBER, which returns the top value again when it is duplicated',
        'An inner join that drops merchants with only one distinct amount',
        'Not handling NULL ordering under DESC',
      ],
    },
    {
      id: 'db-sql-fundamentals-iq-10',
      difficulty: 'hard',
      question:
        'Your product catalogue uses soft deletes (deleted_at) on products and on the product_tags many-to-many table. Support reports that a merchant cannot re-create a product with a SKU they deleted, deleted tags still show up on product pages, and the tag cloud counts are wrong. Diagnose and redesign.',
      whatInterviewerLooksFor: [
        'Partial unique indexes scoped to live rows',
        'Understands that every join must filter both sides\' deleted_at, and how ORMs miss junction tables',
        'Considers hard-deleting junction rows or archive tables instead of soft-deleting everything',
        'Discusses FK behaviour and index/bloat cost of soft deletes',
      ],
      modelAnswer: `**Diagnosis**
1. **Cannot re-create SKU:** \`UNIQUE (merchant_id, sku)\` still sees the soft-deleted row. Fix: \`CREATE UNIQUE INDEX … ON products (merchant_id, sku) WHERE deleted_at IS NULL\`. Uniqueness then applies only among live rows, and history keeps any number of deleted copies.
2. **Deleted tags still showing:** the product page query is \`products JOIN product_tags JOIN tags\`. The ORM's soft-delete scope applies to the root entity (products) but not to the junction or the joined tags. Every relation needs \`deleted_at IS NULL\` on *each* soft-deletable table, and in ON clauses when the join is LEFT (in WHERE it would turn the LEFT JOIN into an INNER JOIN).
3. **Wrong tag-cloud counts:** \`COUNT(*)\` over the junction includes soft-deleted links, and links to soft-deleted products.

**Redesign principle:** soft delete is for entities with *history value* (products referenced by orders, for audit or undo). A junction row has no history value worth the complexity.
- **product_tags:** hard delete. If you need an audit trail, write the removal to an append-only \`product_tag_events\` table (or rely on CDC).
- **products:** keep \`deleted_at\`, and expose a view \`live_products AS SELECT * FROM products WHERE deleted_at IS NULL\` that application queries use by default.
- **FKs:** soft-deleted products stay referenced by order_items (good: \`ON DELETE RESTRICT\` still guards hard deletes). Decide what happens to live tags of a soft-deleted product: usually leave them, because the view hides the product.
- **Indexes:** make hot indexes partial (\`WHERE deleted_at IS NULL\`) so dead rows do not bloat them. If 70% of rows are deleted, move them to \`products_archive\` (same schema) with a periodic \`WITH moved AS (DELETE … RETURNING *) INSERT INTO products_archive SELECT * FROM moved\`.

**Tag-cloud count, correctly:** count junction rows joined to live products and live tags only, or maintain a counter updated in the same transaction as tag link changes.

**Say this:** "Soft delete is a cross-cutting rule, so I enforce it in one place (views or partial indexes plus a lint on raw queries), not by hoping every query remembers."`,
      followUps: [
        {
          q: 'A GDPR-style deletion request arrives for a customer. Does soft delete satisfy it?',
          a: 'No. A `deleted_at` row still holds the personal data, and so do backups, replicas and CDC topics. You need real erasure or irreversible anonymisation of PII columns (name, phone, address → NULL or a hash), while keeping non-personal facts needed for accounting (order totals, tax) linked to a pseudonymous id. Document retention for backups (they expire within N days) and make sure CDC consumers and the search index process the anonymisation event too.',
        },
        {
          q: 'How does the partial unique index interact with "undo delete" if a new live product already took the SKU?',
          a: 'Undo sets `deleted_at = NULL`, which makes the row live again and enters it into the partial unique index. If another live row has the same (merchant_id, sku), the UPDATE fails with a unique violation. That is correct behaviour: surface it as "SKU now in use, rename before restoring". Do not catch-and-ignore. Running the restore inside a transaction with the conflict check keeps it race-free.',
        },
      ],
      pitfalls: [
        'Keeping a plain UNIQUE constraint on a soft-deleted table',
        'Filtering deleted_at only on the root entity in joins',
        'Soft-deleting junction rows by default "for consistency"',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'db-sql-fundamentals-boe-1',
      question:
        'A finance report does customers LEFT JOIN orders LEFT JOIN order_items LEFT JOIN payments and then SUMs payment amounts per customer. Estimate the row count after each join, how badly revenue is inflated, and what the pre-aggregated rewrite processes instead.',
      assumptions: [
        '10M customers; 30% have never ordered',
        '200M orders; average 2.5 line items per order, 1.2 payment rows per order (retries/partial captures)',
        'Each payment row should be counted once; ~5M joined rows/s per core for hash joins, 8 parallel workers',
      ],
      steps: [
        { label: 'customers ⟕ orders', calc: '200M matched rows + 3M customers padded with NULL ≈ 203M rows' },
        { label: '⟕ order_items', calc: 'each order fans out ×2.5 → 200M × 2.5 = 500M + 3M padded ≈ 503M rows' },
        { label: '⟕ payments', calc: 'per order 2.5 items × 1.2 payments = 3 rows avg → 600M + 3M ≈ 603M rows' },
        { label: 'Revenue inflation', calc: 'each payment appears once per item of its order → SUM inflated ≈ 2.5× on average (×1 for single-item orders, ×10 for 10-item baskets)' },
        { label: 'Runtime of the wrong query', calc: '~1.3B rows produced across the three joins ÷ (5M/s × 8 workers) ≈ 30–35 s of join CPU, plus spills' },
        { label: 'Pre-aggregated rewrite', calc: 'aggregate items 500M → 200M rows; payments 240M → 200M; then 1:1 joins → output stays ≈ 203M rows before GROUP BY customer' },
      ],
      answer:
        'The naive query materialises ~600M intermediate rows and overstates revenue about 2.5× on average, worse for big baskets. Pre-aggregating each child per order keeps every join 1:1 (≈203M rows) and makes the sums exact.',
      insight:
        'Fan-out is a correctness bug before it is a performance bug: whenever two one-to-many children hang off the same parent, aggregate each child to the parent\'s grain first. For a daily report, go further and maintain a per-customer-per-day rollup, so the report reads ~10M rows instead of joining 600M.',
      followUps: [
        {
          q: 'The marketing team now wants the same report broken down by product category, and a product can be in 3 categories. What happens to the numbers?',
          a: 'The product↔category junction adds another fan-out: each item row becomes ~3 rows, so each category\'s revenue is correct individually but the categories sum to ~3× total revenue. Make that explicit in the report ("totals are not additive across categories"), or allocate each item to one primary category if finance needs additive numbers. Rows grow from 500M to ~1.5B, so this belongs in a warehouse star schema, not OLTP Postgres.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-boe-2',
      question:
        'A nightly job hash-joins 200M orders to 5M active customers (id, name, city). work_mem is 64MB. Estimate the hash table size, the number of batches, the temp I/O, and what work_mem would make it a single batch.',
      assumptions: [
        'PostgreSQL 16, hash_mem_multiplier = 2.0 (default since PG 15) → hash memory limit = 128MB',
        'Projected build tuple: id 8 B + name ~16 B + city ~12 B ≈ 36 B data; ~16 B minimal-tuple header + ~16 B hash-join tuple header + 8 B bucket pointer ≈ 40 B overhead → ~80 B/row',
        'Probe side projection (customer_id, total_paise, created_at) ≈ 24 B data + headers ≈ 50 B/row',
      ],
      steps: [
        { label: 'Build side size', calc: '5M × ~80 B ≈ 400MB' },
        { label: 'Batches', calc: '400MB ÷ 128MB ≈ 3.1 → rounded up to a power of two = 4 batches (the planner often picks 8 for safety)' },
        { label: 'Build spill', calc: 'batches 2–4 of the build side written then read: 3/4 × 400MB ≈ 300MB written + 300MB read' },
        { label: 'Probe spill', calc: '200M × 50 B ≈ 10GB probe input; 3/4 spilled ≈ 7.5GB written + 7.5GB read' },
        { label: 'Total temp I/O', calc: '≈ 15–16GB; at ~500MB/s effective ≈ 30 s of extra I/O, competing with live traffic' },
        { label: 'Single-batch work_mem', calc: 'need ≥ 400MB hash memory → work_mem ≥ 200MB with multiplier 2 → SET LOCAL work_mem = \'256MB\' for this job only' },
      ],
      answer:
        'About a 400MB hash table → 4 (or 8) batches at 64MB work_mem, causing ~15GB of temp-file I/O. SET LOCAL work_mem = 256MB for this session makes it a single in-memory batch.',
      insight:
        'The cheapest fixes shrink the build side: project only needed columns (dropping name alone saves ~20%), filter customers before hashing, and raise work_mem per session rather than globally. work_mem is per hash/sort node per backend, so 200 connections × 256MB is how databases get OOM-killed.',
      followUps: [
        {
          q: 'The job runs with 4 parallel workers using Parallel Hash. Does that change the memory math?',
          a: 'Yes. Parallel Hash builds one shared hash table, and its budget is roughly work_mem × hash_mem_multiplier × (workers + leader): 128MB × 5 = 640MB here. So the 400MB table fits in one batch even at 64MB work_mem. The total memory the query uses is higher, though, so count parallel workers when sizing RAM for concurrent jobs.',
        },
        {
          q: 'Customers grow to 50M active. What do you change?',
          a: 'The build side becomes ~4GB, so a single batch would need work_mem ≥ 2GB, which is unreasonable. Accept batching (≈ 32 batches) but cut its cost: hash only the customers that appear in the window (semi-join or pre-filter by last_order_at), drop wide columns, or switch to a merge join if both sides can be read in customer_id order from indexes. Or move the job to the warehouse.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-boe-3',
      question:
        'An analytics team stores 500M order lines in one flat table that repeats customer and product details on every row. Estimate its size versus a 3NF schema (customers, products, orders, order_items), and what that means for the buffer cache on a 64GB-RAM Postgres box.',
      assumptions: [
        '10M customers, 2M products, 200M orders, 500M order lines',
        'Flat row: customer name 20 B, phone 12 B, address 120 B, product title 60 B, brand 15 B, category 20 B, plus line facts (order_id, product_id, qty, unit price, created_at) 36 B ≈ 283 B data',
        'Postgres per-row overhead ≈ 24 B tuple header + 4 B line pointer; ignore indexes and fill factor',
      ],
      steps: [
        { label: 'Flat table', calc: '(283 + 28) B ≈ 311 B × 500M ≈ 155GB' },
        { label: 'order_items (3NF)', calc: 'order_id 8 + product_id 8 + qty 4 + unit_price_paise 8 ≈ 28 B data (+ alignment ≈ 32) + 28 B overhead ≈ 60 B × 500M ≈ 30GB' },
        { label: 'orders', calc: 'id 8 + customer_id 8 + created_at 8 + total 8 + status ~8 ≈ 40 B + 28 B ≈ 68 B × 200M ≈ 14GB' },
        { label: 'customers + products', calc: '10M × ~180 B ≈ 1.8GB; 2M × ~130 B ≈ 0.26GB' },
        { label: '3NF total', calc: '30 + 14 + 1.8 + 0.26 ≈ 46GB vs 155GB → ~3.4× smaller' },
        { label: 'Cache fit', calc: '64GB RAM: ~16GB shared_buffers + ~40GB OS cache. 3NF hot set (last 90 days ≈ 25% ≈ 12GB) fits; flat table 90 days ≈ 39GB mostly does not' },
      ],
      answer:
        'Roughly 155GB flat versus ~46GB normalized, about 3.4× smaller. The 3NF working set fits comfortably in memory, while the flat table\'s recent data does not.',
      insight:
        'Normalization is also a cache-efficiency decision: narrower rows mean more rows per 8KB page, fewer pages read per scan, and a working set that stays in RAM. A flat table pays off only in a columnar warehouse, where compression and column pruning remove the repetition cost. OLTP Postgres should stay normalized and feed a warehouse for flat analytics.',
      followUps: [
        {
          q: 'We must keep a title_snapshot (60 B) and a shipping-address snapshot (120 B) for legal reasons. Redo the estimate.',
          a: 'The title snapshot belongs on order_items: +60 B × 500M ≈ +30GB, though long titles may be TOASTed or compressed. The address belongs on orders (one per order, not per line): +120 B × 200M ≈ +24GB. The total is ≈ 100GB, still ~1.5× smaller than flat. That shows putting each snapshot at its correct grain (address per order, not per line) is itself a normalization decision.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'db-sql-fundamentals-mcq-01',
      difficulty: 'medium',
      question:
        'Using the running dataset (Asha: orders 101 paid, 102 cancelled; Ravi: 103 paid; Meera: no orders; 104 is a guest order), a dashboard should list every customer with their non-cancelled orders. Which rows does this query return?',
      code: {
        language: 'sql',
        code: `SELECT c.name, o.id
  FROM customers c
  LEFT JOIN orders o ON o.customer_id = c.id
 WHERE o.status <> 'cancelled';`,
      },
      options: [
        'Asha-101, Ravi-103, Meera-NULL',
        'Asha-101, Ravi-103',
        'Asha-101, Asha-102, Ravi-103, Meera-NULL',
        'Asha-101, Ravi-103, NULL-104',
      ],
      correct: [1],
      explanation:
        'Meera\'s NULL-padded row has o.status = NULL, and NULL <> \'cancelled\' is UNKNOWN, so WHERE drops it. The LEFT JOIN degenerates into an inner join. Option A is the intended result, which needs the predicate in ON. Option C ignores the filter. Option D would need a RIGHT/FULL join, because the guest order has no matching customer.',
      followUps: [
        {
          q: 'You move the predicate into ON. Meera now shows NULL, but so does someone who only has cancelled orders. Is that correct for the dashboard?',
          a: 'Yes. "Every customer with their non-cancelled orders" means a customer whose orders are all cancelled has zero matching orders, so one NULL-padded row is the right shape. If the UI shows a count, use `COUNT(o.id)` so both cases show 0. With `COUNT(*)` they would show 1, which is the next bug.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-02',
      difficulty: 'hard',
      question:
        'This anti-join returns zero rows even though Meera (id 3) has never ordered. orders contains a guest order with customer_id NULL. What is the most accurate explanation?',
      code: {
        language: 'sql',
        code: `SELECT c.name
  FROM customers c
 WHERE c.id NOT IN (SELECT customer_id FROM orders);`,
      },
      options: [
        'NOT IN expands to a chain of <> comparisons ANDed together; the comparison with NULL is UNKNOWN, so no row can evaluate to TRUE',
        'The planner turns NOT IN into a Hash Anti Join, and hash joins skip NULL keys, which drops Meera',
        'NOT IN only works with literal lists; with a subquery, Postgres silently treats it as IN',
        'The subquery returns duplicates (customer 1 twice), and NOT IN requires a DISTINCT subquery to work',
      ],
      correct: [0],
      explanation:
        '3 NOT IN (1, 1, 2, NULL) is 3<>1 AND 3<>1 AND 3<>2 AND 3<>NULL, i.e. TRUE AND … AND UNKNOWN = UNKNOWN, and WHERE keeps only TRUE. Postgres does not plan NOT IN as an anti-join, precisely because of this semantics; it uses a hashed or plain SubPlan, so B is wrong. C is invented. Duplicates do not affect NOT IN (D).',
      followUps: [
        {
          q: 'You switch to NOT EXISTS. What plan node should you now see in EXPLAIN, and why does it matter at 200M orders?',
          a: 'A Hash Anti Join (or Hash Right Anti Join in PG 16+, or a Nested Loop Anti Join with an index probe). It matters because NOT IN uses a hashed SubPlan only while the subquery result fits in hash memory. Beyond that, Postgres re-scans the materialized subquery for every outer row, which is quadratic. The anti join is one hash build plus one pass, whatever the size.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-03',
      difficulty: 'expert',
      question:
        'customers has 3 rows in 3 different cities. What does this PostgreSQL query return?',
      code: {
        language: 'sql',
        code: `SELECT DISTINCT city, count(*) OVER () AS n
  FROM customers;`,
      },
      options: [
        '3 rows, each with n = 1, because DISTINCT is applied before the window counts rows',
        '1 row with n = 3, because count(*) OVER () collapses the result like an aggregate',
        '3 rows, each with n = 3, because window functions are evaluated before DISTINCT',
        'An error: window functions cannot be combined with DISTINCT',
      ],
      correct: [2],
      explanation:
        'Logical order is … HAVING → window functions → SELECT list → DISTINCT. The empty OVER () counts all 3 input rows, and DISTINCT then removes nothing, because the (city, 3) pairs are already unique. A assumes the order many blog diagrams show. B confuses a window with an aggregate: windows never collapse rows. The combination is legal (D).',
      followUps: [
        {
          q: 'How would you get the number of distinct cities next to each row, without a second query?',
          a: 'Postgres does not allow `count(DISTINCT city) OVER ()`, since DISTINCT is not implemented for window aggregates. Options: a scalar subquery, `(SELECT count(DISTINCT city) FROM customers)`, computed once as an InitPlan. Or use `dense_rank() OVER (ORDER BY city)` in a subquery and take `max(dr) OVER ()` outside. The scalar subquery is clearer and cheap.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-04',
      difficulty: 'expert',
      question: 'Which of these statements fail in PostgreSQL 17? Select ALL that apply.',
      code: {
        language: 'sql',
        code: `-- (1)
SELECT upper(city) AS c FROM customers WHERE c = 'PUNE';
-- (2)
SELECT city, count(*) AS n FROM customers GROUP BY city HAVING n > 1;
-- (3)
SELECT upper(city) AS c, count(*) FROM customers GROUP BY c;
-- (4)
SELECT city AS c FROM customers ORDER BY c;
-- (5)
SELECT city AS c FROM customers ORDER BY c || 'x';`,
      },
      options: ['(1)', '(2)', '(3)', '(4)', '(5)'],
      correct: [0, 1, 4],
      explanation:
        '(1) WHERE runs before the alias exists. (2) Postgres does not resolve output aliases in HAVING. (5) an expression in ORDER BY is resolved against input columns, so c is unknown. (3) works because Postgres lets GROUP BY fall back to output-column names (a non-standard extension). (4) is standard: ORDER BY can name an output column. All five behaviours were verified on PG 17.',
      followUps: [
        {
          q: 'A table gains a real column named c. What does statement (3) now group by, and why is that dangerous?',
          a: 'When a GROUP BY name matches both an input column and an output alias, Postgres picks the **input column**. So after the migration, (3) silently groups by the new column instead of upper(city), and the query still runs with different results. That is why teams ban alias/ordinal GROUP BY in reviews and repeat the expression instead.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-05',
      difficulty: 'hard',
      question:
        'Order 101 has 3 order_items rows and two payment rows: one failed (₹1,097) and one captured (₹1,097 = 109,700 paise). What revenue does this query report for order 101?',
      code: {
        language: 'sql',
        code: `SELECT o.id, SUM(p.amount_paise) AS revenue_paise, SUM(oi.qty) AS units
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN payments p     ON p.order_id = o.id AND p.status = 'captured'
 WHERE o.id = 101
 GROUP BY o.id;`,
      },
      options: ['109,700', '219,400', '329,100', '658,200'],
      correct: [2],
      explanation:
        'The captured-payment filter is in ON, so only one payment row joins. That row is repeated once per item row (3), so SUM = 3 × 109,700 = 329,100. 109,700 would need pre-aggregation. 219,400 would be the result if the failed payment were also counted without items fan-out. 658,200 counts both payments across all 3 items. The units sum is correct only because there is exactly one captured payment; with two captures it would double too.',
      followUps: [
        {
          q: 'Someone "fixes" it with SUM(DISTINCT p.amount_paise). Why is that wrong in general?',
          a: 'DISTINCT collapses equal values, not equal rows. Two legitimate partial captures of ₹500 each would be summed as ₹500. It happens to give the right answer for one payment, so it passes the test case and fails in production. The correct fix is to aggregate payments per order in a subquery or CTE and join that 1:1, or to use a scalar subquery for the payment total.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-06',
      difficulty: 'expert',
      question:
        'A logistics query matches 50M GPS pings to 2M delivery trips with `ON p.ts BETWEEN t.started_at AND t.ended_at AND p.rider_id = t.rider_id`. It is fast. Then someone drops the rider_id condition "because ts is enough", and the query never finishes. Why?',
      options: [
        'BETWEEN on timestamps disables index usage entirely, so both tables are now sequentially scanned for each other',
        'The planner switches to a merge join on ts, which needs a full sort of both tables in memory and spills to disk',
        'Removing rider_id makes the join a CROSS JOIN, because Postgres ignores range conditions in ON',
        'Without an equality predicate, hash and merge join are impossible, so the planner must use a nested loop that compares on the order of 50M × 2M pairs unless an index can serve the range',
      ],
      correct: [3],
      explanation:
        'Hash and merge joins need an equality (hashable/mergejoinable) condition; rider_id = rider_id was the hash key, and the range was just a filter. Without it, only a nested loop remains: ~10^14 comparisons unless an index on the inner side serves the range. A is wrong: a B-tree on ts can serve a range probe, it is just a probe per outer row. B: merge join does not support range conditions. C: the range is still applied, as a Join Filter.',
      followUps: [
        {
          q: 'Rider_id is genuinely unavailable on the pings. How do you make the range join fast?',
          a: 'Give the nested loop an indexed inner side. Store trips with a `tstzrange` column and a GiST index, then probe `t.period @> p.ts`: one index probe per ping. Or bucket both sides on an equality key: add `minute_bucket` to pings and explode each trip into the minute buckets it spans. A hash join on the bucket then needs only a range check as a filter. Both turn a quadratic loop into roughly linear work.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-07',
      difficulty: 'expert',
      question:
        'A reconciliation job must show ledger entries without a bank match AND bank entries without a ledger match, matching on timestamps within ±2 minutes. What happens with this query on PostgreSQL?',
      code: {
        language: 'sql',
        code: `SELECT l.id AS ledger_id, b.id AS bank_id
  FROM ledger l
  FULL JOIN bank_txns b
    ON l.ts BETWEEN b.ts - interval '2 minutes'
                AND b.ts + interval '2 minutes';`,
      },
      options: [
        'It runs as a slow nested loop that compares every ledger row with every bank row, then appends the unmatched rows',
        'It fails at planning time with "FULL JOIN is only supported with merge-joinable or hash-joinable join conditions"',
        'It runs as a merge full join after sorting both tables on ts, treating the BETWEEN as a sort-range condition',
        'It runs, but unmatched bank rows are silently dropped, because FULL JOIN degrades to LEFT JOIN on range conditions',
      ],
      correct: [1],
      explanation:
        'Postgres implements FULL JOIN only with hash or merge join, and both need an equality (hash- or merge-joinable) condition. A pure range condition offers neither, so planning fails with that exact error (verified on PG 17). A is wrong because the nested-loop executor cannot emit the unmatched rows of the inner side. C is wrong because merge join cannot use BETWEEN as its merge key. D describes behaviour that does not exist: Postgres errors rather than silently changing semantics.',
      followUps: [
        {
          q: 'You add `l.amount_paise = b.amount_paise AND` before the BETWEEN. Does it run now, and how?',
          a: 'Yes. On PG 17 it plans as a **Hash Full Join** with `Hash Cond: (l.amount_paise = b.amount_paise)` and the timestamp window as a `Join Filter`. The equality gives the hash key, and the range is checked on each candidate pair, with "matched" meaning both pass. Performance now depends on how many rows share an amount: thousands of ₹99 transactions per day all land in one hash bucket chain and get range-checked pairwise.',
        },
        {
          q: 'Even when it runs, why do reconciliation engineers avoid FULL JOIN for this?',
          a: 'A window match is many-to-many: one bank credit of ₹500 can fall within ±2 minutes of two ledger rows of ₹500. FULL JOIN then reports both as matched, and one is a real break. Reconciliation needs one-to-one matching: rank candidates by time distance with `ROW_NUMBER`, take each side\'s best unclaimed partner (or match greedily in application code), then report leftovers from both sides with two anti-joins.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-08',
      difficulty: 'hard',
      question:
        'A month-end report\'s EXPLAIN ANALYZE shows `Hash Join … Buckets: 1048576  Batches: 64  Memory Usage: 131073kB` and heavy temp-file writes. work_mem is 64MB. Select ALL changes that would directly reduce the number of batches.',
      options: [
        'SET LOCAL work_mem = \'1GB\' inside the report\'s transaction',
        'Select only the columns the report needs from the hashed (inner) side instead of SELECT *',
        'Raise hash_mem_multiplier for the reporting role',
        'Add a B-tree index on the probe side\'s join column',
        'Increase shared_buffers so more of both tables stay cached',
      ],
      correct: [0, 1, 2],
      explanation:
        'Batches = hash table size ÷ (work_mem × hash_mem_multiplier). Raising either factor (A, C), or shrinking each hashed tuple by projecting fewer columns (B), reduces batches. An index on the probe side (D) does not change the hash size; it might make a different join method viable, but it does not shrink this hash. shared_buffers (E) caches table pages and is not used for executor hash tables.',
      followUps: [
        {
          q: 'Why not just set work_mem = 1GB in postgresql.conf for everyone?',
          a: 'work_mem is a per-operation budget: each sort or hash node in each backend may use it (hashes up to 2× with the default multiplier). One complex query can have 5 such nodes, and 300 connections × 5 × 1–2GB can far exceed RAM, which gets backends OOM-killed and the whole cluster restarted into crash recovery. Raise it per session or role for known batch jobs; keep the global default modest (4–64MB).',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-09',
      difficulty: 'hard',
      question:
        'A nightly export joins two 300M-row tables on account_id, both with a B-tree index on account_id, and must output rows ORDER BY account_id. The planner picks a Merge Join and the team asks whether a hash join would be faster. What is the best answer?',
      options: [
        'Merge join is likely right: both inputs can be read in key order from the indexes, the merge is one linear pass, and the output is already sorted, so no separate sort of 300M rows is needed',
        'A hash join is always faster for large equi-joins, so set enable_mergejoin = off for the export session',
        'Merge join is only chosen because statistics are stale; after ANALYZE it should become a nested loop with index probes',
        'Merge join is wrong because it requires both tables to fit in work_mem, which 300M rows cannot',
      ],
      correct: [0],
      explanation:
        'Merge join shines when both inputs arrive sorted (index order or an earlier sort) and the output must be sorted too: it avoids building a giant hash table and a final sort. A hash join would need hash memory for one side (spilling heavily) plus a 300M-row sort for ORDER BY. B over-generalises. C is wrong: 300M index probes would be far slower. D describes sorting/hashing memory, not the merge itself, which streams.',
      followUps: [
        {
          q: 'The index scans for the merge are slow because the heap is in random order relative to account_id. What can you do?',
          a: 'An Index Scan visiting heap pages out of order causes random I/O; EXPLAIN shows high `shared read` counts and the planner\'s correlation statistic for account_id is near 0. Options: covering indexes (`INCLUDE` the exported columns) for index-only scans, provided the visibility map is current after VACUUM. Or physically reorder with `CLUSTER`/pg_repack on account_id for a one-time correlation boost. Or let the planner Seq Scan + Sort instead, which is sequential I/O and can win for full-table exports.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-10',
      difficulty: 'medium',
      question:
        'pay has rows (1 Jan, 100), (2 Jan, 50), (2 Jan, 70), (3 Jan, 10). What running_total does this query show for the (2 Jan, 50) row?',
      code: {
        language: 'sql',
        code: `SELECT d, amt,
       SUM(amt) OVER (ORDER BY d) AS running_total
  FROM pay;`,
      },
      options: ['150', '220', '120', '100'],
      correct: [1],
      explanation:
        'With ORDER BY and no frame clause, the default frame is RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW. RANGE includes all peers (rows with the same d), so both 2 Jan rows see 100 + 50 + 70 = 220 (verified on PG 17). 150 is what ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW would give, but only if the 50 row happened to sort first, which is not guaranteed. 120 and 100 ignore the frame semantics.',
      followUps: [
        {
          q: 'Finance wants a strictly increasing per-transaction running balance that is reproducible across runs. What exactly do you change?',
          a: 'Two things. Use a ROWS frame (`ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`) so peers do not share a total, and make the order total by adding a unique tie-breaker: `ORDER BY d, txn_id`. Without the tie-breaker, ROWS still gives per-row totals, but which of the two 2 Jan rows gets 150 vs 220 can change between runs or plans. That breaks reconciliation diffs.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-11',
      difficulty: 'hard',
      question:
        'Salaries in eng are 300, 300, 200, 100. A candidate writes this to get the second-highest salary. What does it return?',
      code: {
        language: 'sql',
        code: `SELECT salary
  FROM (SELECT salary, RANK() OVER (ORDER BY salary DESC) AS r
          FROM emp WHERE dept = 'eng') t
 WHERE r = 2;`,
      },
      options: [
        '200, because RANK skips duplicates',
        '300, because the second 300 gets rank 2',
        'No rows, because the ranks are 1, 1, 3, 4',
        'Two rows of 300, because ties share rank 2',
      ],
      correct: [2],
      explanation:
        'RANK gives ties the same rank and leaves a gap: 300→1, 300→1, 200→3, 100→4, so nothing has rank 2 (verified on PG 17). DENSE_RANK (1, 1, 2, 3) would return 200, the intended answer. ROW_NUMBER would return 300 (option B\'s logic). Option D misremembers how ties are numbered.',
      followUps: [
        {
          q: 'The interviewer asks for the second-highest per department, and departments with a single distinct salary must appear with NULL. What do you change?',
          a: 'Use `DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC)`, keep `dr = 2` in a derived table, and LEFT JOIN it from the distinct list of departments (or use a correlated scalar subquery per department). An inner filter alone drops departments that have no rank 2. Also filter `salary IS NOT NULL`, since NULL sorts first under DESC in Postgres and would take rank 1.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-12',
      difficulty: 'expert',
      question:
        'After upgrading from PostgreSQL 11 to 16, this query went from 4 s to 3 ms, with no index or data changes. What is the most likely reason?',
      code: {
        language: 'sql',
        code: `WITH recent AS (
  SELECT * FROM orders WHERE created_at > now() - interval '30 days'
)
SELECT * FROM recent WHERE id = $1;`,
      },
      options: [
        'PostgreSQL 16 caches CTE results across executions, so after the first call the result is served from memory',
        'PostgreSQL 16 automatically creates an index on created_at when a CTE filters on it',
        'PostgreSQL 16 runs every CTE in parallel workers, which makes materialization 1000× faster',
        'Since PostgreSQL 12, a side-effect-free CTE referenced once is inlined, so the planner pushes id = $1 down and uses the primary-key index instead of materializing 30 days of orders',
      ],
      correct: [3],
      explanation:
        'Before PG 12, every CTE was an optimization fence: computed fully (all 30 days of orders) and then filtered. From PG 12, non-recursive, side-effect-free CTEs referenced once are inlined unless marked MATERIALIZED, so id = $1 becomes a PK lookup. Postgres does not cache query results across executions (A) or auto-create indexes (B). Parallelism (C) cannot explain a 1000× drop.',
      followUps: [
        {
          q: 'When would you deliberately write AS MATERIALIZED on PostgreSQL 16?',
          a: 'When an expensive CTE is referenced more than once (it would be materialized anyway, but stating it documents intent), or when inlining lets the planner push a predicate into a plan it misestimates. Materializing then acts as a deliberate fence. Another case is a CTE calling a volatile or expensive function you want evaluated exactly once per row. Always compare `EXPLAIN ANALYZE` with and without it: the fence also blocks index use from outer predicates.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-13',
      difficulty: 'expert',
      question:
        'A grocery app stores slot_bookings(store_id, slot_start, van_id). Each van belongs to exactly one store (van_id → store_id), and each store slot is served by exactly one van ((store_id, slot_start) → van_id). Which statement is correct?',
      options: [
        'It violates 2NF, because van_id depends on only part of the key (store_id, slot_start)',
        'It is in BCNF, because every column belongs to some candidate key',
        'It is in 3NF but not BCNF: van_id determines store_id but is not a superkey, while store_id is prime, so 3NF allows it',
        'It violates 1NF, because slot_start is a timestamp that encodes both date and time',
      ],
      correct: [2],
      explanation:
        'Candidate keys are (store_id, slot_start) and (van_id, slot_start). van_id → store_id has a non-superkey determinant, so BCNF fails. 3NF tolerates it because store_id is a prime attribute. A misreads 2NF: van_id depends on the whole key. B confuses "all attributes prime" (which gives 3NF) with BCNF. A timestamp is atomic (D).',
      followUps: [
        {
          q: 'You decompose into vans(van_id, store_id) and bookings(van_id, slot_start). Which business rule can no longer be enforced with a simple UNIQUE constraint?',
          a: '"One van per store slot", i.e. (store_id, slot_start) unique, because store_id now lives in another table. Two vans of the same store could be booked for the same slot. Re-enforce it by keeping store_id in bookings with a composite FK `(van_id, store_id) → vans(van_id, store_id)` plus `UNIQUE (store_id, slot_start)`. Or use a trigger with locking. The redundant-but-FK-checked column is usually the pragmatic choice.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-14',
      difficulty: 'medium',
      question:
        'product_options(product_id, colour, size) lists only the combinations actually manufactured: the blue shirt has no L. A teammate cites 4NF and splits it into product_colours(product_id, colour) and product_sizes(product_id, size). What goes wrong?',
      options: [
        'Nothing: the split is lossless because product_id is a key of both new tables',
        'Joining the two tables back invents combinations that do not exist (blue + L), so the decomposition is lossy for this data',
        'The split violates 1NF because colour and size become repeating groups',
        'The split is correct but needs a CHECK constraint to stop duplicate colours',
      ],
      correct: [1],
      explanation:
        '4NF splitting is valid only when colour and size are independent (a multi-valued dependency product_id ↠ colour). Here availability depends on the pair, so there is no MVD, and the three-column table is already in 4NF. Splitting loses the information about which pairs exist, and the join returns spurious rows. A misapplies the losslessness test (product_id is not a key of either new table). C and D are unrelated.',
      followUps: [
        {
          q: 'How would you model this so that both "all colours a product comes in" and "which exact SKUs exist" are fast and consistent?',
          a: 'Keep `variants(product_id, colour, size, sku UNIQUE)` as the source of truth, one row per real SKU. "Colours of a product" is `SELECT DISTINCT colour FROM variants WHERE product_id = $1`, served by an index on `(product_id, colour)`. If you also keep a `product_colours` table for display order or swatches, add a composite FK from variants `(product_id, colour)` to it, so no SKU can use an undeclared colour.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-15',
      difficulty: 'hard',
      question:
        'Which of these are sound uses of redundancy (denormalization or snapshots) in an e-commerce system? Select ALL that apply.',
      options: [
        'Copying unit price and product title into order_items at checkout',
        'Copying the customer\'s current email into every order row, refreshed nightly, and using it to send payment receipts',
        'A finance dashboard reading an hourly-refreshed materialized view of revenue per city per day',
        'Using a denormalized rating_count column, updated asynchronously, to decide which restaurants get a payout bonus',
        'A product search index in OpenSearch fed by CDC from the normalized catalogue tables',
      ],
      correct: [0, 2, 4],
      explanation:
        'A records historical facts that must not change. The dashboard (C) and the search index (E) are read models with a known staleness and a rebuildable source. B sends receipts to an email up to a day stale: the decision should read the source of truth. D makes a money decision from an eventually consistent copy: payouts must be computed from the normalized ratings, and the copy is for display only.',
      followUps: [
        {
          q: 'The CDC-fed search index silently missed 0.1% of price updates after a connector restart. How do you detect and repair drift?',
          a: 'Run a periodic reconciliation: page through products by id from Postgres and compare a hash of `(price, title, updated_at)` against the indexed documents, using bulk `mget`. Reindex any mismatches. Also make every document carry the source `updated_at` (or the LSN), and make the consumer reject older versions. A replay after a restart then cannot overwrite newer data, and the gap is detectable as an `updated_at` mismatch.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-16',
      difficulty: 'hard',
      question: 'Review this DDL for an order system with soft-deleted users. Select ALL lines that are real bugs.',
      code: {
        language: 'sql',
        code: `CREATE TABLE users (
  id         bigint PRIMARY KEY,
  email      text NOT NULL UNIQUE,                         -- (A)
  deleted_at timestamptz
);
CREATE TABLE order_items (
  order_id    bigint NOT NULL REFERENCES orders(id),
  product_id  bigint NOT NULL REFERENCES products(id)
              ON DELETE CASCADE,                           -- (B)
  qty         int NOT NULL CHECK (qty > 0),                -- (C)
  unit_price  double precision NOT NULL,                   -- (D)
  created_at  timestamptz NOT NULL DEFAULT now(),          -- (E)
  PRIMARY KEY (order_id, product_id)
);`,
      },
      options: [
        '(A) a plain UNIQUE on email with soft deletes',
        '(B) ON DELETE CASCADE from order_items to products',
        '(C) CHECK (qty > 0)',
        '(D) double precision for the price',
        '(E) timestamptz with DEFAULT now()',
      ],
      correct: [0, 1, 3],
      explanation:
        'A blocks a user from re-registering with an email whose account was soft-deleted; use a partial unique index WHERE deleted_at IS NULL (on lower(email)). B means deleting a product erases sales history, so use RESTRICT plus soft delete. D uses binary floating point for money: sums drift, and 0.1 cannot be represented. Use bigint paise or numeric. C and E are correct practice.',
      followUps: [
        {
          q: 'Line (A) is fixed with a partial unique index on lower(email). What does the application\'s login query need to look like to use it?',
          a: 'The query must match the index expression and predicate: `WHERE lower(email) = lower($1) AND deleted_at IS NULL`. If the query compares `email = $1` (no lower) or omits `deleted_at IS NULL`, the planner cannot use the partial expression index. It falls back to a scan or a different index, and the case-insensitive check is not enforced in the read path either. Normalising emails to lower case on write is a simpler alternative.',
        },
      ],
    },
    {
      id: 'db-sql-fundamentals-mcq-17',
      difficulty: 'expert',
      question:
        'An export lists 2M customers with their last order date using a correlated scalar subquery: `SELECT c.id, (SELECT max(o.created_at) FROM orders o WHERE o.customer_id = c.id) FROM customers c`. It takes 25 minutes. Which explanation and fix are best?',
      options: [
        'The scalar subquery runs as a SubPlan once per customer (2M index probes); rewrite as a LEFT JOIN to orders pre-aggregated by customer_id, which is one hash aggregate and one hash join',
        'Postgres converts the subquery into a semi-join, but the semi-join returns duplicates; adding DISTINCT fixes the time',
        'max() cannot use indexes in Postgres; replace it with ORDER BY created_at DESC LIMIT 1 in the same subquery',
        'Scalar subqueries are always executed once and cached, so the slowness must come from network transfer of 2M rows',
      ],
      correct: [0],
      explanation:
        'Postgres decorrelates EXISTS/IN into semi-joins but executes a correlated scalar subquery in the SELECT list as a per-row SubPlan. 2M probes on `orders (customer_id, created_at)` add up, much worse without that index. A single GROUP BY customer_id over orders plus a hash join is one pass. B describes the wrong transformation. C is false: max() can use a B-tree index via a min/max optimisation. D: a SubPlan is cached only for uncorrelated subqueries.',
      followUps: [
        {
          q: 'For an API that shows one page of 50 customers, which version do you prefer and why?',
          a: 'The correlated subquery (or a LATERAL with `ORDER BY created_at DESC LIMIT 1`), backed by an index on `(customer_id, created_at DESC)`. 50 index probes take well under a millisecond, while the GROUP BY version would aggregate all 200M orders just to use 50 rows, unless the planner pushes the filter down. Shape choice depends on how many outer rows you actually have: per-row probes for small pages, set-based aggregation for exports.',
        },
      ],
    },
  ],
};

export default topic;

