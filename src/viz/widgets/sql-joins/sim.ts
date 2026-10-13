// Pure simulation of SQL joins and of a query's logical execution order.
// Rows are evaluated with SQL three-valued logic (NULL = anything → UNKNOWN), so the
// NULL customer_id on a guest order never matches, and a WHERE on the right table of a
// LEFT JOIN drops the NULL-filled rows. No React here so it can be tested with Node.
import type { BaseFrame } from '../../core';

export type Val = string | number | null;
export type Row = Record<string, Val>;

export interface Customer extends Row {
  id: number;
  name: string;
  city: string;
}
export interface Order extends Row {
  id: number;
  customer_id: number | null;
  /** total in paise (₹1 = 100 paise), as in the lesson's running dataset */
  paise: number;
  status: string;
}

// Same running dataset as the db-sql-fundamentals lesson: Asha has two orders (one cancelled),
// Ravi one, Meera none, and order 104 is a guest checkout with customer_id NULL.
export const CUSTOMERS: Customer[] = [
  { id: 1, name: 'Asha', city: 'Bengaluru' },
  { id: 2, name: 'Ravi', city: 'Pune' },
  { id: 3, name: 'Meera', city: 'Delhi' },
];
export const ORDERS: Order[] = [
  { id: 101, customer_id: 1, status: 'paid', paise: 50000 },
  { id: 102, customer_id: 1, status: 'cancelled', paise: 20000 },
  { id: 103, customer_id: 2, status: 'paid', paise: 75000 },
  { id: 104, customer_id: null, status: 'paid', paise: 30000 },
];

/** SQL equality: NULL on either side → UNKNOWN (null) */
export function sqlEq(a: Val, b: Val): boolean | null {
  if (a === null || b === null) return null;
  return a === b;
}

export type Mode = 'joins' | 'order';
export type JoinType = 'inner' | 'left' | 'right' | 'full' | 'anti';
export type FilterAt = 'where' | 'on';

export interface Params {
  mode: Mode;
  join: JoinType;
  filterAt: FilterAt;
}
export const DEFAULT_PARAMS: Params = { mode: 'joins', join: 'left', filterAt: 'where' };

export const JOIN_SQL: Record<JoinType, string> = {
  inner: 'SELECT … FROM customers c INNER JOIN orders o ON o.customer_id = c.id',
  left: 'SELECT … FROM customers c LEFT JOIN orders o ON o.customer_id = c.id',
  right: 'SELECT … FROM customers c RIGHT JOIN orders o ON o.customer_id = c.id',
  full: 'SELECT … FROM customers c FULL OUTER JOIN orders o ON o.customer_id = c.id',
  anti: 'SELECT c.* FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)',
};
export const JOIN_NAME: Record<JoinType, string> = {
  inner: 'INNER JOIN',
  left: 'LEFT JOIN',
  right: 'RIGHT JOIN',
  full: 'FULL OUTER JOIN',
  anti: 'anti-join (NOT EXISTS)',
};

/** a joined row: either side may be missing (NULL-filled) */
export interface JRow {
  c: Customer | null;
  o: Order | null;
}

export type Mark = 'match' | 'nomatch' | 'unknown';

export interface JoinFrame extends BaseFrame {
  mode: 'joins';
  /** customer row being scanned, -1 if none */
  cur: number;
  /** order row being looked at (right-side pass), -1 if none */
  curOrder: number;
  /** comparison outcome per order id, for the current customer */
  marks: Record<number, Mark>;
  /** order ids matched by at least one customer so far */
  matchedOrders: number[];
  result: JRow[];
  /** index of result rows added in this frame */
  fresh: number[];
  done?: boolean;
}

export function joinRows(join: JoinType): JRow[] {
  const out: JRow[] = [];
  const matched = new Set<number>();
  for (const c of CUSTOMERS) {
    const ms = ORDERS.filter((o) => sqlEq(o.customer_id, c.id) === true);
    ms.forEach((o) => matched.add(o.id));
    if (join === 'anti') {
      if (!ms.length) out.push({ c, o: null });
      continue;
    }
    for (const o of ms) out.push({ c, o });
    if (!ms.length && (join === 'left' || join === 'full')) out.push({ c, o: null });
  }
  if (join === 'right' || join === 'full') for (const o of ORDERS) if (!matched.has(o.id)) out.push({ c: null, o });
  return out;
}

function joins(p: Params): JoinFrame[] {
  const j = p.join;
  const frames: JoinFrame[] = [];
  const result: JRow[] = [];
  const matchedOrders = new Set<number>();
  const keepsLeft = j === 'left' || j === 'full';
  const keepsRight = j === 'right' || j === 'full';
  const push = (f: Omit<JoinFrame, 'mode' | 'result' | 'matchedOrders'>) =>
    frames.push({ mode: 'joins', result: [...result], matchedOrders: [...matchedOrders], ...f });

  const rule =
    j === 'inner'
      ? 'keeps only pairs where ON is TRUE'
      : j === 'left'
        ? 'keeps every customer; a customer with no match gets one row with the order columns NULL'
        : j === 'right'
          ? 'keeps every order; an order with no matching customer gets the customer columns NULL'
          : j === 'full'
            ? 'keeps matched pairs plus unmatched rows from BOTH sides, NULL-filled'
            : 'returns each customer for whom NO order matches, once, with no order columns';
  push({
    cur: -1,
    curOrder: -1,
    marks: {},
    fresh: [],
    caption: `${JOIN_NAME[j]} ${rule}. Logically: compare every customer with every order on o.customer_id = c.id (a nested loop; real engines may hash or merge, same result).`,
  });

  push({
    cur: -1,
    curOrder: -1,
    marks: {},
    fresh: [],
    caption: `Think of it as a filtered product: ${CUSTOMERS.length} customers × ${ORDERS.length} orders = ${CUSTOMERS.length * ORDERS.length} candidate pairs (that is CROSS JOIN). ON crosses out every pair where o.customer_id = c.id is not TRUE.`,
  });

  CUSTOMERS.forEach((c, ci) => {
    const marks: Record<number, Mark> = {};
    for (const o of ORDERS) {
      const r = sqlEq(o.customer_id, c.id);
      marks[o.id] = r === null ? 'unknown' : r ? 'match' : 'nomatch';
    }
    const ms = ORDERS.filter((o) => marks[o.id] === 'match');
    const hasNull = ORDERS.some((o) => marks[o.id] === 'unknown');
    const predictFor = ms.length === 0 && ci === CUSTOMERS.findIndex((x) => !ORDERS.some((o) => o.customer_id === x.id));
    push({
      cur: ci,
      curOrder: -1,
      marks,
      fresh: [],
      caption: `${c.name} (id ${c.id}): ON is TRUE for ${ms.length ? ms.map((o) => `order ${o.id}`).join(' and ') : 'no order'}${hasNull ? '; for guest order 104, NULL = ' + c.id + ' is UNKNOWN, which counts as not matching' : ''}.`,
      predict: predictFor ? `${c.name} has no orders. What does ${JOIN_NAME[j]} emit for ${c.name}?` : undefined,
    });
    ms.forEach((o) => matchedOrders.add(o.id));
    const before = result.length;
    let caption: string;
    if (j === 'anti') {
      if (ms.length) caption = `NOT EXISTS is FALSE for ${c.name}: a matching order exists, so ${c.name} is filtered out (the first match is enough; the subquery stops there).`;
      else {
        result.push({ c, o: null });
        caption = `NOT EXISTS is TRUE for ${c.name}: no order matched, so ${c.name} is returned. Note anti-joins never emit order columns.`;
      }
    } else if (ms.length) {
      for (const o of ms) result.push({ c, o });
      caption = `Emit ${ms.length} row${ms.length > 1 ? 's' : ''}: ${c.name} paired with ${ms.map((o) => o.id).join(', ')}${ms.length > 1 ? `. One-to-many: ${c.name} appears twice, which is why SUM over customer columns after a join can double-count` : ''}.`;
    } else if (keepsLeft) {
      result.push({ c, o: null });
      caption = `No match, but ${JOIN_NAME[j]} preserves the left side: emit ${c.name} with o.id, o.status, o.total_paise all NULL.`;
    } else {
      caption = `No match and ${JOIN_NAME[j]} does not preserve customers, so ${c.name} produces no row.`;
    }
    push({
      cur: ci,
      curOrder: -1,
      marks,
      fresh: Array.from({ length: result.length - before }, (_, k) => before + k),
      caption: `${caption} Result so far: ${result.length} row${result.length === 1 ? '' : 's'}.`,
    });
  });

  // right-side pass
  const unmatched = ORDERS.filter((o) => !matchedOrders.has(o.id));
  const firstU = unmatched[0];
  push({
    cur: -1,
    curOrder: ORDERS.indexOf(firstU),
    marks: {},
    fresh: [],
    caption: `Now the orders side: order${unmatched.length > 1 ? 's' : ''} ${unmatched.map((o) => o.id).join(', ')} never matched any customer (guest checkout, customer_id NULL; NULL never equals anything, not even NULL).`,
    predict: `Does order ${firstU.id} appear in the ${JOIN_NAME[j]} result?`,
  });
  const before = result.length;
  if (keepsRight) for (const o of unmatched) result.push({ c: null, o });
  push({
    cur: -1,
    curOrder: ORDERS.indexOf(firstU),
    marks: {},
    fresh: Array.from({ length: result.length - before }, (_, k) => before + k),
    caption: keepsRight
      ? `${JOIN_NAME[j]} preserves the right side: emit order ${firstU.id} with c.id, c.name, c.city NULL.`
      : j === 'anti'
        ? `NOT EXISTS only ever returns customer rows, so order ${firstU.id} can never appear; orders are just probed.`
        : `${JOIN_NAME[j]} does not preserve unmatched orders, so order ${firstU.id} is dropped.`,
  });

  const counts = (['inner', 'left', 'right', 'full', 'anti'] as JoinType[]).map((k) => `${k === 'anti' ? 'NOT EXISTS' : k.toUpperCase()} ${joinRows(k).length}`);
  push({
    cur: -1,
    curOrder: -1,
    marks: {},
    fresh: [],
    done: true,
    caption: `${JOIN_NAME[j]} returns ${result.length} row${result.length === 1 ? '' : 's'}. Row counts on this data: ${counts.join(' · ')}. ${
      j === 'anti'
        ? 'An anti-join returns each outer row at most once and never pads.'
        : 'OUTER joins add back unmatched rows padded with NULL; INNER keeps only TRUE pairs.'
    }`,
  });
  push({
    cur: -1,
    curOrder: -1,
    marks: {},
    fresh: [],
    done: true,
    caption:
      j === 'inner'
        ? `Rows multiply: Asha appears twice because she has two orders. A join is a filtered product, not a set intersection, so a SUM over customer columns after this join counts Asha twice.`
        : j === 'left'
          ? `Use it as an anti-join: add WHERE o.customer_id IS NULL and only Meera remains, the same answer as NOT EXISTS. Testing the join key is what lets Postgres plan a Hash Anti Join.`
          : j === 'right'
            ? `RIGHT JOIN is LEFT JOIN with the tables swapped: orders o LEFT JOIN customers c gives the same ${result.length} rows. Most style guides prefer LEFT so the preserved table is always first.`
            : j === 'full'
              ? `FULL = LEFT ∪ RIGHT: the 3 matched pairs, Meera with NULL order columns and order 104 with NULL customer columns. Handy for reconciling two sources.`
              : `The NOT IN trap: WHERE c.id NOT IN (SELECT customer_id FROM orders) returns 0 rows here. For Meera, 3 NOT IN (1, 1, 2, NULL) ends in 3 <> NULL = UNKNOWN, and WHERE drops UNKNOWN. NOT EXISTS correlates with = per row, so it is NULL-safe.`,
  });
  return frames;
}

// ------------------------------------------------------------------ logical execution order
export type Clause = 'query' | 'from' | 'join' | 'where' | 'group' | 'having' | 'select' | 'order' | 'limit' | 'done';

export interface Table {
  cols: string[];
  rows: Val[][];
  /** per-row display state */
  state: ('keep' | 'drop' | 'null' | 'new' | 'unknown' | 'group0' | 'group1' | 'group2')[];
  /** optional per-row note shown at the right */
  note?: string[];
}

export interface OrderFrame extends BaseFrame {
  mode: 'order';
  clause: Clause;
  table: Table | null;
}

export function sqlText(filterAt: FilterAt): string[] {
  return [
    'SELECT c.name, COUNT(o.id) AS paid_orders, COALESCE(SUM(o.total_paise), 0) AS paid_paise',
    'FROM customers c',
    filterAt === 'on' ? "LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'" : 'LEFT JOIN orders o ON o.customer_id = c.id',
    filterAt === 'where' ? "WHERE o.status = 'paid'" : '-- (no WHERE: the paid filter is in ON)',
    'GROUP BY c.id, c.name',
    'HAVING COALESCE(SUM(o.total_paise), 0) < 60000',
    'ORDER BY paid_paise',
    'LIMIT 10;',
  ];
}
/** which SQL line each clause highlights */
export const CLAUSE_LINE: Record<Clause, number> = { query: -1, from: 1, join: 2, where: 3, group: 4, having: 5, select: 0, order: 6, limit: 7, done: -1 };

interface Agg {
  name: string;
  rows: JRow[];
  count: number;
  sum: number | null;
}
const LIMIT = 10;
const UNDER = 60000;

/** full evaluation of the sample query, used by the frames and by tests */
export function runQuery(filterAt: FilterAt) {
  const on = (c: Customer, o: Order) => sqlEq(o.customer_id, c.id) === true && (filterAt === 'where' || o.status === 'paid');
  const joined: JRow[] = [];
  for (const c of CUSTOMERS) {
    const ms = ORDERS.filter((o) => on(c, o));
    if (ms.length) for (const o of ms) joined.push({ c, o });
    else joined.push({ c, o: null });
  }
  // o.status = 'paid' with SQL three-valued logic: NULL → UNKNOWN (null)
  const whereRes = joined.map((r) => (filterAt === 'on' ? true : r.o === null ? null : r.o.status === 'paid'));
  const filtered = joined.filter((_, i) => whereRes[i] === true);
  const ids: number[] = [];
  for (const r of filtered) if (!ids.includes(r.c!.id)) ids.push(r.c!.id);
  const groups: Agg[] = ids.map((id) => {
    const rows = filtered.filter((r) => r.c!.id === id);
    const vals = rows.filter((r) => r.o).map((r) => r.o!.paise);
    return { name: rows[0].c!.name, rows, count: vals.length, sum: vals.length ? vals.reduce((a, b) => a + b, 0) : null };
  });
  const having = groups.map((g) => (g.sum ?? 0) < UNDER);
  const kept = groups.filter((_, i) => having[i]);
  const projected = kept.map((g) => [g.name, g.count, g.sum ?? 0] as [string, number, number]);
  const sorted = [...projected].sort((a, b) => a[2] - b[2]);
  const limited = sorted.slice(0, LIMIT);
  return { joined, whereRes, filtered, groups, having, projected, sorted, limited };
}

const JCOLS = ['c.id', 'c.name', 'o.id', 'o.status', 'o.total_paise'];
const jvals = (r: JRow): Val[] => [r.c?.id ?? null, r.c?.name ?? null, r.o?.id ?? null, r.o?.status ?? null, r.o?.paise ?? null];
const OUT = ['name', 'paid_orders', 'paid_paise'];

function order(p: Params): OrderFrame[] {
  const q = runQuery(p.filterAt);
  const trap = p.filterAt === 'where';
  const frames: OrderFrame[] = [];
  const push = (clause: Clause, table: Table | null, caption: string, predict?: string) => frames.push({ mode: 'order', clause, table, caption, predict });
  const nulls = q.joined.filter((r) => !r.o).map((r) => r.c!.name);
  const meeraIn = q.limited.some((r) => r[0] === 'Meera');

  push(
    'query',
    null,
    `Goal: customers whose paid spend is under ₹600 (60000 paise), including those who never paid, lowest first. SQL is written SELECT-first but logically runs FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT.`,
  );
  push(
    'from',
    { cols: ['c.id', 'c.name', 'c.city'], rows: CUSTOMERS.map((c) => [c.id, c.name, c.city]), state: CUSTOMERS.map(() => 'keep') },
    `FROM customers c: the starting row set is all ${CUSTOMERS.length} customers. Meera has never ordered.`,
    trap ? undefined : "The paid filter now sits in ON. Asha's order 102 is cancelled and fails ON: does Asha also get a NULL-padded row?",
  );
  push(
    'join',
    { cols: JCOLS, rows: q.joined.map(jvals), state: q.joined.map((r) => (r.o ? 'keep' : 'null')) },
    trap
      ? `LEFT JOIN orders: ${q.joined.length} rows. Asha fans out to 2 orders (one cancelled), Ravi has 1, and ${nulls.join(' and ')} is padded with NULL order columns. Guest order 104 matches nobody and, on the right side, disappears.`
      : `LEFT JOIN … ON o.customer_id = c.id AND o.status = 'paid': cancelled 102 fails ON, but Asha still matches 101, so no padded row for her. ${nulls.join(' and ')} has no paid order and is kept, NULL-padded: ${q.joined.length} rows.`,
    trap ? `WHERE o.status = 'paid' runs next. What happens to ${nulls.join(' and ')}'s NULL-padded row?` : undefined,
  );
  if (trap) {
    push(
      'where',
      {
        cols: [...JCOLS, "status='paid'"],
        rows: q.joined.map((r, i) => [...jvals(r), q.whereRes[i] === null ? 'UNKNOWN' : q.whereRes[i] ? 'TRUE' : 'FALSE']),
        state: q.whereRes.map((w) => (w === true ? 'keep' : w === null ? 'unknown' : 'drop')),
      },
      `WHERE evaluates each row with three-valued logic: for ${nulls.join(' and ')}, NULL = 'paid' is UNKNOWN; cancelled 102 is FALSE. WHERE keeps only TRUE.`,
    );
    push(
      'where',
      { cols: JCOLS, rows: q.filtered.map(jvals), state: q.filtered.map(() => 'keep') },
      `After WHERE: ${q.filtered.length} rows, and the NULL-padded row is gone. A strict filter on the optional side silently turned the LEFT JOIN into an INNER JOIN (Postgres even plans it as a plain Hash Join).`,
    );
  } else {
    push(
      'where',
      { cols: JCOLS, rows: q.filtered.map(jvals), state: q.filtered.map((r) => (r.o ? 'keep' : 'null')) },
      `No WHERE clause, so all ${q.filtered.length} rows survive, including Meera's padded row. ON decides what matches; WHERE filters the joined result.`,
    );
    push(
      'where',
      { cols: JCOLS, rows: q.filtered.map(jvals), state: q.filtered.map((r) => (r.o ? 'keep' : 'null')) },
      `Why not WHERE o.status = 'paid' OR o.id IS NULL? It looks right on this sample, but a customer whose only orders are cancelled has non-NULL order rows that all fail, so they vanish instead of showing 0. Only the ON placement is correct.`,
    );
  }
  const gi = (id: number) => q.groups.findIndex((g) => g.rows[0].c!.id === id);
  push(
    'group',
    { cols: JCOLS, rows: q.filtered.map(jvals), state: q.filtered.map((r) => `group${gi(r.c!.id)}`) as Table['state'], note: q.filtered.map((r) => `group ${r.c!.name}`) },
    `GROUP BY c.id, c.name buckets the rows into ${q.groups.length} group${q.groups.length === 1 ? '' : 's'}: ${q.groups.map((g) => `${g.name} (${g.rows.length} row${g.rows.length === 1 ? '' : 's'})`).join(', ')}.`,
  );
  const aggTable = (st?: Table['state'], note?: string[]): Table => ({
    cols: ['c.name', 'COUNT(o.id)', 'SUM(o.total_paise)'],
    rows: q.groups.map((g) => [g.name, g.count, g.sum]),
    state: st ?? q.groups.map((_, i) => `group${i}` as Table['state'][number]),
    note,
  });
  const zero = q.groups.find((g) => g.sum === null);
  push(
    'group',
    aggTable(),
    `Aggregates per group: ${q.groups.map((g) => `${g.name} count ${g.count}, sum ${g.sum ?? 'NULL'}`).join('; ')}. COUNT(o.id) skips NULLs${zero ? `, so ${zero.name} counts 0 (COUNT(*) would say 1) and her SUM is NULL, not 0` : ''}.`,
    `HAVING keeps spend under 60000. Will Meera, who has paid nothing, be in the answer?`,
  );
  push(
    'having',
    aggTable(
      q.having.map((h) => (h ? 'keep' : 'drop')),
      q.groups.map((g, i) => `${g.sum ?? 0} < ${UNDER}: ${q.having[i] ? 'keep' : 'drop'}`),
    ),
    `HAVING filters whole groups after aggregation; WHERE could not, because SUM does not exist yet. ${q.groups.filter((_, i) => !q.having[i]).map((g) => `${g.name} (${g.sum})`).join(', ')} is dropped.${trap ? ' Meera is not even here to be judged: WHERE removed her earlier.' : ' COALESCE turns Meera’s NULL sum into 0, so she qualifies.'}`,
  );
  push(
    'select',
    { cols: OUT, rows: q.projected, state: q.projected.map(() => 'new') },
    `SELECT computes the output columns and gives birth to the aliases paid_orders and paid_paise. WHERE ran before this step, which is why WHERE paid_paise < 60000 would fail with "column does not exist".`,
  );
  push(
    'order',
    { cols: OUT, rows: q.sorted, state: q.sorted.map(() => 'keep') },
    `ORDER BY paid_paise sorts ascending. It runs after SELECT, so the alias is visible here.`,
  );
  push(
    'limit',
    { cols: OUT, rows: q.limited, state: q.limited.map(() => 'keep') },
    `LIMIT ${LIMIT} slices the sorted rows: ${q.limited.length} row${q.limited.length === 1 ? '' : 's'} (${q.limited.map((r) => `${r[0]} ${r[2]}`).join(', ')}). Without ORDER BY, which rows LIMIT keeps would depend on the plan.`,
  );
  push(
    'done',
    { cols: OUT, rows: q.limited, state: q.limited.map(() => (trap ? 'drop' : 'keep')) },
    trap
      ? `Wrong answer${meeraIn ? '' : ': Meera, the customer who most needs the campaign, is missing'} because WHERE on o.status discarded her NULL-padded row. Switch "Paid filter" to ON to fix it.`
      : `Correct: Meera 0 and Asha 50000. A filter on the optional side belongs in ON, which keeps the outer join outer.`,
  );
  return frames;
}

export type SqlFrame = JoinFrame | OrderFrame;

export function simulate(p: Params): SqlFrame[] {
  return p.mode === 'joins' ? joins(p) : order(p);
}
