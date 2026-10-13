// Pure simulation of normalising an orders table: UNF (repeating groups) → 1NF → 2NF → 3NF,
// plus a separate BCNF example. Each step names the functional dependency it removes and
// replays one update / insert / delete anomaly before and after the split. Decompositions are
// checked for losslessness with a real natural join. No React here so it can be tested with Node.
import type { BaseFrame } from '../../core';

export type Val = string | number | null;
export type RowState = 'anom' | 'fixed' | 'new' | 'reject' | 'gone' | undefined;

export interface Rel {
  name: string;
  cols: string[];
  /** primary-key columns */
  key: string[];
  rows: Val[][];
  state?: RowState[];
  /** columns to tint: col → group (0 = whole key, 1/2 = determinant groups) */
  colGroup?: Record<string, number>;
  /** row index → cell column that changed (shown bold) */
  changed?: Record<number, string>;
}

export type Anomaly = 'update' | 'insert' | 'delete';
export interface Params {
  anomaly: Anomaly;
  /** add frames that natural-join the pieces back and compare */
  checks: boolean;
  bcnf: boolean;
}
export const DEFAULT_PARAMS: Params = { anomaly: 'update', checks: true, bcnf: true };

export type NF = 'UNF' | '1NF' | '2NF' | '3NF' | 'BCNF';
export interface NormFrame extends BaseFrame {
  nf: NF;
  tables: Rel[];
  /** functional dependencies to show; `bad` ones are highlighted as the violation */
  fds: { text: string; bad?: boolean }[];
  lossless?: { ok: boolean; rows: number; of: number };
}

// ------------------------------------------------------------------ relational helpers
export function project(r: Rel, cols: string[], name: string, key: string[]): Rel {
  const idx = cols.map((c) => r.cols.indexOf(c));
  const seen = new Set<string>();
  const rows: Val[][] = [];
  for (const row of r.rows) {
    const v = idx.map((i) => row[i]);
    const k = JSON.stringify(v);
    if (!seen.has(k)) {
      seen.add(k);
      rows.push(v);
    }
  }
  return { name, cols, key, rows };
}

export function naturalJoin(a: Rel, b: Rel): Rel {
  const common = a.cols.filter((c) => b.cols.includes(c));
  const extra = b.cols.filter((c) => !common.includes(c));
  const rows: Val[][] = [];
  for (const ra of a.rows)
    for (const rb of b.rows)
      if (common.every((c) => ra[a.cols.indexOf(c)] !== null && ra[a.cols.indexOf(c)] === rb[b.cols.indexOf(c)]))
        rows.push([...ra, ...extra.map((c) => rb[b.cols.indexOf(c)])]);
  return { name: `${a.name} ⋈ ${b.name}`, cols: [...a.cols, ...extra], key: [], rows };
}

/** same set of rows, ignoring column order */
export function sameRows(a: Rel, b: Rel): boolean {
  if (a.cols.length !== b.cols.length || !a.cols.every((c) => b.cols.includes(c))) return false;
  const norm = (r: Rel) =>
    new Set(r.rows.map((row) => JSON.stringify(a.cols.map((c) => row[r.cols.indexOf(c)]))));
  const A = norm(a);
  const B = norm(b);
  return A.size === B.size && [...A].every((x) => B.has(x));
}

// ------------------------------------------------------------------ data
// The lesson's evolving order sheet (db-sql-fundamentals): Asha orders a Kettle and Mugs,
// Ravi orders Mugs, Asha later orders a Teapot. unit_price is the price CHARGED on the line.
const ITEMS: [number, string, string, string, string, string, string, number, number][] = [
  // order, date, cust, cust_name, city, product, p_name, unit_price, qty
  [5001, 'Mar 1', 'C1', 'Asha', 'Bengaluru', 'P10', 'Kettle', 149900, 1],
  [5001, 'Mar 1', 'C1', 'Asha', 'Bengaluru', 'P22', 'Mug', 29900, 2],
  [5002, 'Mar 2', 'C2', 'Ravi', 'Pune', 'P22', 'Mug', 29900, 4],
  [5003, 'Mar 5', 'C1', 'Asha', 'Bengaluru', 'P31', 'Teapot', 89900, 1],
];

export const NF1: Rel = {
  name: 'order_lines',
  cols: ['order_id', 'date', 'cust_id', 'cust_name', 'city', 'prod_id', 'p_name', 'unit_price', 'qty'],
  key: ['order_id', 'prod_id'],
  rows: ITEMS.map((r) => [...r]),
};

export const UNF: Rel = {
  name: 'order_sheet (unnormalised)',
  cols: ['order_id', 'date', 'cust_id', 'cust_name', 'city', 'items'],
  key: ['order_id'],
  rows: [
    [5001, 'Mar 1', 'C1', 'Asha', 'Bengaluru', 'P10 Kettle x1 @149900; P22 Mug x2 @29900'],
    [5002, 'Mar 2', 'C2', 'Ravi', 'Pune', 'P22 Mug x4 @29900'],
    [5003, 'Mar 5', 'C1', 'Asha', 'Bengaluru', 'P31 Teapot x1 @89900'],
  ],
};

export const NF2 = {
  orders: project(NF1, ['order_id', 'date', 'cust_id', 'cust_name', 'city'], 'orders', ['order_id']),
  products: project(NF1, ['prod_id', 'p_name'], 'products', ['prod_id']),
  items: project(NF1, ['order_id', 'prod_id', 'qty', 'unit_price'], 'order_items', ['order_id', 'prod_id']),
};
export const NF3 = {
  customers: project(NF2.orders, ['cust_id', 'cust_name', 'city'], 'customers', ['cust_id']),
  orders: project(NF2.orders, ['order_id', 'date', 'cust_id'], 'orders', ['order_id']),
  products: NF2.products,
  items: NF2.items,
};

// BCNF example from the lesson: warehouse picking. picker_id → category, (order_id, category) → picker_id.
export const PICK: Rel = {
  name: 'order_pickers',
  cols: ['order_id', 'category', 'picker_id'],
  key: ['order_id', 'category'],
  rows: [
    [5001, 'Electronics', 'Kiran'],
    [5001, 'Kitchen', 'Dev'],
    [5002, 'Kitchen', 'Lata'],
    [5003, 'Electronics', 'Kiran'],
  ],
};
export const BCNF = {
  pickers: project(PICK, ['picker_id', 'category'], 'pickers', ['picker_id']),
  orderPickers: project(PICK, ['order_id', 'picker_id'], 'order_pickers', ['order_id', 'picker_id']),
};

// ------------------------------------------------------------------ frame helpers
const clone = (r: Rel): Rel => ({ ...r, rows: r.rows.map((x) => [...x]), state: r.rows.map(() => undefined), changed: {} });
const ci = (r: Rel, c: string) => r.cols.indexOf(c);
const rowsWhere = (r: Rel, c: string, v: Val) => r.rows.map((row, i) => (row[ci(r, c)] === v ? i : -1)).filter((i) => i >= 0);

function mark(r: Rel, idx: number[], s: RowState): Rel {
  const t = clone(r);
  idx.forEach((i) => (t.state![i] = s));
  return t;
}
function setCell(r: Rel, i: number, col: string, v: Val, s: RowState): Rel {
  const t = clone(r);
  t.rows[i][ci(t, col)] = v;
  t.state![i] = s;
  t.changed![i] = col;
  return t;
}
function addRow(r: Rel, row: Val[], s: RowState): Rel {
  const t = clone(r);
  t.rows.push(row);
  t.state!.push(s);
  return t;
}
function tint(r: Rel, groups: Record<string, number>): Rel {
  return { ...clone(r), colGroup: groups };
}

export function simulate(p: Params): NormFrame[] {
  const frames: NormFrame[] = [];
  const push = (f: NormFrame) => frames.push(f);
  const a = p.anomaly;
  const FD_ORDER = { text: 'order_id → date, cust_id, cust_name, city' };
  const FD_PROD = { text: 'prod_id → p_name' };
  const FD_LINE = { text: '(order_id, prod_id) → qty, unit_price' };
  const FD_CUST = { text: 'cust_id → cust_name, city' };
  const bad = (d: { text: string }) => ({ ...d, bad: true });

  push({
    nf: 'UNF',
    tables: [clone(UNF)],
    fds: [],
    caption: `The ops team's order sheet: one row per order, with the line items packed into a text cell (a repeating group). You can't index "orders containing P22", and qty can't be summed without parsing strings.`,
  });
  push({
    nf: '1NF',
    tables: [clone(NF1)],
    fds: [{ text: 'key: (order_id, prod_id)' }],
    caption: `1NF: atomic values, one row per order line, key (order_id, prod_id): ${NF1.rows.length} rows. The repeating group is gone, but "P22 is a Mug" is stored twice and Asha's city three times.`,
  });
  push({
    nf: '1NF',
    tables: [tint(NF1, { order_id: 1, date: 1, cust_id: 1, cust_name: 1, city: 1, prod_id: 2, p_name: 2, qty: 0, unit_price: 0 })],
    fds: [bad(FD_ORDER), bad(FD_PROD), FD_LINE],
    caption: `Partial dependencies: date and the customer columns depend on order_id alone, p_name on prod_id alone. Only qty and unit_price (the price charged on this line) need the whole key. 2NF forbids depending on part of the key.`,
  });

  // 1NF anomaly, product level
  const mug = rowsWhere(NF1, 'prod_id', 'P22');
  if (a === 'update') {
    push({
      nf: '1NF',
      tables: [mark(NF1, mug, 'anom')],
      fds: [bad(FD_PROD)],
      caption: `Update anomaly: marketing renames "Mug" to "Coffee mug". The fact "P22 is called Mug" lives in ${mug.length} rows (in production, thousands), so every one must change.`,
      predict: 'A buggy update renames only the row for order 5001. What is P22 called now?',
    });
    push({
      nf: '1NF',
      tables: [setCell(mark(NF1, mug, 'anom'), mug[0], 'p_name', 'Coffee mug', 'reject')],
      fds: [bad(FD_PROD)],
      caption: `Both: P22 is "Coffee mug" on one row and "Mug" on another, so reports disagree. Nothing in the schema prevents it, because the same fact is stored twice.`,
    });
  } else if (a === 'insert') {
    push({
      nf: '1NF',
      tables: [clone(NF1)],
      fds: [bad(FD_PROD)],
      caption: `Insert anomaly: the catalogue team wants to add a new product, P40 Toaster, before anyone orders it.`,
      predict: 'Where in order_lines can the Toaster go, given the key is (order_id, prod_id)?',
    });
    push({
      nf: '1NF',
      tables: [addRow(NF1, [null, null, null, null, null, 'P40', 'Toaster', null, null], 'reject')],
      fds: [bad(FD_PROD)],
      caption: `Rejected: order_id is part of the primary key and cannot be NULL. A product cannot exist until someone orders it.`,
    });
  } else {
    const st = rowsWhere(NF1, 'order_id', 5003);
    push({
      nf: '1NF',
      tables: [mark(NF1, st, 'anom')],
      fds: [bad(FD_PROD)],
      caption: `Delete anomaly: order 5003 is deleted. It is the last (only) order of P31 Teapot.`,
      predict: 'After deleting order 5003, what does the database still know about product P31?',
    });
    push({
      nf: '1NF',
      tables: [mark(NF1, st, 'gone')],
      fds: [bad(FD_PROD)],
      caption: `Nothing: the only record that P31 is a Teapot was lost with the order. Deleting one fact destroyed an unrelated one.`,
    });
  }

  push({
    nf: '2NF',
    tables: [clone(NF2.orders), clone(NF2.products), clone(NF2.items)],
    fds: [FD_ORDER, FD_PROD, FD_LINE],
    caption: `2NF: move each partial dependency into a table keyed by its determinant: orders (order_id → …) and products (prod_id → name; a list price would live here too). unit_price stays in order_items: the price charged is a fact of the line, not of the product.`,
  });
  const p22 = rowsWhere(NF2.products, 'prod_id', 'P22');
  if (a === 'update')
    push({
      nf: '2NF',
      tables: [clone(NF2.orders), setCell(NF2.products, p22[0], 'p_name', 'Coffee mug', 'fixed'), clone(NF2.items)],
      fds: [FD_PROD],
      caption: `Fixed: P22's name is one row in products, so the rename is a single-row update that cannot be half-done. Past invoices keep their charged unit_price.`,
    });
  else if (a === 'insert')
    push({
      nf: '2NF',
      tables: [clone(NF2.orders), addRow(NF2.products, ['P40', 'Toaster'], 'fixed'), clone(NF2.items)],
      fds: [FD_PROD],
      caption: `Fixed: P40 Toaster is simply a new row in products, keyed by prod_id. No order is needed.`,
    });
  else
    push({
      nf: '2NF',
      tables: [
        mark(NF2.orders, rowsWhere(NF2.orders, 'order_id', 5003), 'gone'),
        mark(NF2.products, rowsWhere(NF2.products, 'prod_id', 'P31'), 'fixed'),
        mark(NF2.items, rowsWhere(NF2.items, 'order_id', 5003), 'gone'),
      ],
      fds: [FD_PROD],
      caption: `Fixed: deleting order 5003 removes its orders and order_items rows, but P31 Teapot survives in products.`,
    });
  if (p.checks) {
    const back = naturalJoin(naturalJoin(NF2.items, NF2.orders), NF2.products);
    push({
      nf: '2NF',
      tables: [{ ...clone(back), name: 'order_items ⋈ orders ⋈ products' }],
      fds: [],
      lossless: { ok: sameRows(back, NF1), rows: back.rows.length, of: NF1.rows.length },
      caption: `Lossless check: natural-joining the three tables gives back ${back.rows.length} rows, exactly the 1NF table. Each join is on the key of one side, so no spurious rows appear.`,
    });
  }

  // transitive dependency in 2NF orders
  const asha = rowsWhere(NF2.orders, 'cust_id', 'C1');
  push({
    nf: '2NF',
    tables: [tint(NF2.orders, { order_id: 0, date: 0, cust_id: 1, cust_name: 2, city: 2 }), clone(NF2.products), clone(NF2.items)],
    fds: [{ text: 'order_id → cust_id' }, bad(FD_CUST)],
    caption: `2NF still has a transitive dependency: order_id → cust_id → cust_name, city. Customer facts depend on a non-key column, so Asha is stored in ${asha.length} order rows.`,
    predict:
      a === 'update'
        ? 'Asha moves from Bengaluru to Mysuru. How many rows must change, and what if one is missed?'
        : a === 'insert'
          ? 'A new customer, C3 Meera, signs up but has not ordered yet. Can we store her?'
          : 'Order 5002 is deleted. What happens to customer Ravi?',
  });
  if (a === 'update')
    push({
      nf: '2NF',
      tables: [setCell(mark(NF2.orders, asha, 'anom'), asha[0], 'city', 'Mysuru', 'reject'), clone(NF2.products), clone(NF2.items)],
      fds: [bad(FD_CUST)],
      caption: `Update anomaly: ${asha.length} rows hold Asha's city. Updating only order 5001 leaves her in both Mysuru and Bengaluru, and an "orders by city" report double-counts her.`,
    });
  else if (a === 'insert')
    push({
      nf: '2NF',
      tables: [addRow(NF2.orders, [null, null, 'C3', 'Meera', 'Delhi'], 'reject'), clone(NF2.products), clone(NF2.items)],
      fds: [bad(FD_CUST)],
      caption: `Insert anomaly: customer facts can only live in an orders row, whose key order_id cannot be NULL. Meera cannot exist until she orders.`,
    });
  else
    push({
      nf: '2NF',
      tables: [mark(NF2.orders, rowsWhere(NF2.orders, 'order_id', 5002), 'gone'), clone(NF2.products), mark(NF2.items, rowsWhere(NF2.items, 'order_id', 5002), 'gone')],
      fds: [bad(FD_CUST)],
      caption: `Delete anomaly: order 5002 was Ravi's only order, so deleting it erases the only record of customer C2 Ravi from Pune.`,
    });

  push({
    nf: '3NF',
    tables: [clone(NF3.customers), clone(NF3.orders), clone(NF3.products), clone(NF3.items)],
    fds: [FD_CUST, { text: 'order_id → date, cust_id' }],
    caption: `3NF: move cust_id → cust_name, city into customers; orders keeps only cust_id. Every non-key column now depends on the key, the whole key, and nothing but the key.`,
  });
  const c1 = rowsWhere(NF3.customers, 'cust_id', 'C1');
  if (a === 'update')
    push({
      nf: '3NF',
      tables: [setCell(NF3.customers, c1[0], 'city', 'Mysuru', 'fixed'), clone(NF3.orders), clone(NF3.products), clone(NF3.items)],
      fds: [FD_CUST],
      caption: `Fixed: Asha's city is one row in customers. One single-row update, and both of her orders see Mysuru through the join.`,
    });
  else if (a === 'insert')
    push({
      nf: '3NF',
      tables: [addRow(NF3.customers, ['C3', 'Meera', 'Delhi'], 'fixed'), clone(NF3.orders), clone(NF3.products), clone(NF3.items)],
      fds: [FD_CUST],
      caption: `Fixed: Meera is a new customers row; she needs no order to exist.`,
    });
  else
    push({
      nf: '3NF',
      tables: [
        mark(NF3.customers, rowsWhere(NF3.customers, 'cust_id', 'C2'), 'fixed'),
        mark(NF3.orders, rowsWhere(NF3.orders, 'order_id', 5002), 'gone'),
        clone(NF3.products),
        mark(NF3.items, rowsWhere(NF3.items, 'order_id', 5002), 'gone'),
      ],
      fds: [FD_CUST],
      caption: `Fixed: deleting order 5002 removes its rows from orders and order_items; customer C2 Ravi stays in customers.`,
    });
  if (p.checks) {
    const back = naturalJoin(NF3.orders, NF3.customers);
    push({
      nf: '3NF',
      tables: [{ ...clone(back), name: 'orders ⋈ customers' }],
      fds: [],
      lossless: { ok: sameRows(back, NF2.orders), rows: back.rows.length, of: NF2.orders.rows.length },
      caption: `Lossless check: orders ⋈ customers on cust_id rebuilds the ${NF2.orders.rows.length}-row 2NF orders table exactly, because cust_id is the key of customers.`,
    });
  }
  push({
    nf: '3NF',
    tables: [clone(NF3.customers), clone(NF3.orders), clone(NF3.products), clone(NF3.items)],
    fds: [],
    caption: `Result: customers, orders, products and order_items, with each fact stored once: P22's name in 1 row instead of 2, Asha's city in 1 row instead of 3. Reads now need joins; that is the trade you later relax with deliberate denormalisation.`,
  });

  if (p.bcnf) {
    push({
      nf: '3NF',
      tables: [clone(PICK)],
      fds: [{ text: '(order_id, category) → picker_id' }, { text: 'picker_id → category' }],
      caption: `BCNF needs a different shape. Warehouse picking: each picker works exactly one category, and each (order, category) gets one picker. Candidate keys: (order_id, category) and (order_id, picker_id).`,
    });
    const kiran = rowsWhere(PICK, 'picker_id', 'Kiran');
    push({
      nf: '3NF',
      tables: [tint(PICK, { picker_id: 1, category: 2, order_id: 0 })],
      fds: [{ text: '(order_id, category) → picker_id' }, bad({ text: 'picker_id → category' })],
      caption: `Every column is part of some candidate key, so this is in 3NF. It is not BCNF: picker_id determines category, but picker_id is not a key. "Kiran works Electronics" is stored ${kiran.length} times.`,
    });
    if (a === 'update')
      push({
        nf: '3NF',
        tables: [setCell(mark(PICK, kiran, 'anom'), kiran[0], 'category', 'Grocery', 'reject')],
        fds: [bad({ text: 'picker_id → category' })],
        caption: `Update anomaly: Kiran moves from Electronics to Grocery, but only one of her ${kiran.length} rows is updated. Now she works two categories.`,
      });
    else if (a === 'insert')
      push({
        nf: '3NF',
        tables: [addRow(PICK, [null, 'Grocery', 'Zoya'], 'reject')],
        fds: [bad({ text: 'picker_id → category' })],
        caption: `Insert anomaly: new picker Zoya joins Grocery but has picked no order yet; order_id is in every key, so the row is rejected.`,
      });
    else
      push({
        nf: '3NF',
        tables: [mark(PICK, rowsWhere(PICK, 'picker_id', 'Lata'), 'gone')],
        fds: [bad({ text: 'picker_id → category' })],
        caption: `Delete anomaly: order 5002 is removed, and with it the only record that Lata works Kitchen.`,
      });
    frames[frames.length - 1].predict = 'How would you split the table so every determinant is a key, and which rule becomes harder to enforce?';
    push({
      nf: 'BCNF',
      tables: [clone(BCNF.pickers), clone(BCNF.orderPickers)],
      fds: [{ text: 'picker_id → category' }, { text: 'key (order_id, picker_id)' }],
      caption: `BCNF: split on the violating dependency into pickers(picker_id → category) and order_pickers(order_id, picker_id). Every determinant is now a key, and each picker's category is stored once.`,
    });
    if (p.checks) {
      const back = naturalJoin(BCNF.orderPickers, BCNF.pickers);
      push({
        nf: 'BCNF',
        tables: [{ ...clone(back), name: 'order_pickers ⋈ pickers' }],
        fds: [],
        lossless: { ok: sameRows(back, PICK), rows: back.rows.length, of: PICK.rows.length },
        caption: `Lossless check: joining on picker_id rebuilds all ${PICK.rows.length} original rows, because picker_id is the key of pickers.`,
      });
    }
    push({
      nf: 'BCNF',
      tables: [clone(BCNF.pickers), addRow(BCNF.orderPickers, [5001, 'Lata'], 'anom')],
      fds: [bad({ text: '(order_id, category) → picker_id' })],
      caption: `The cost: "one picker per (order, category)" now spans two tables, so no single UNIQUE constraint enforces it. Adding Lata to order 5001 gives it two Kitchen pickers unless a trigger or app check stops it. 3NF always preserves dependencies; BCNF sometimes cannot.`,
    });
  }
  return frames;
}
