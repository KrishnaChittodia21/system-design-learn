// Pure logic for Splitwise-style debt simplification: exact equal splits, net balances from a
// ledger, the topic's greedy settle (largest debtor pays largest creditor) and an exact minimum
// built from the maximum number of disjoint zero-sum groups (each group of k settles in k-1).
// No React here so the maths can be checked with Node.
import type { BaseFrame } from '../../core';

export type Algo = 'raw' | 'greedy' | 'optimal';
export type Dataset = 'counter' | 'trip' | 'chain';

export interface Params {
  algo: Algo;
  data: Dataset;
}

export interface Expense {
  label: string;
  paidBy: string;
  amount: number;
  among: string[];
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface Frame extends BaseFrame {
  people: string[];
  /** remaining net balance per person (+ is owed money, − owes) */
  net: Record<string, number>;
  transfers: Transfer[];
  /** zero-sum groups found by the exact method (indices into people), shown on the optimal run */
  groups: string[][];
  done: boolean;
}

/** Equal split that always sums: base + 1 unit to the first r participants. */
export function equalSplit(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

export function dataset(d: Dataset): { people: string[]; expenses: Expense[] | null; net: Record<string, number> } {
  if (d === 'counter') {
    // the topic's verified counterexample (₹)
    return { people: ['A', 'B', 'C', 'D', 'E'], expenses: null, net: { A: 300, B: 400, C: -200, D: -200, E: -300 } };
  }
  if (d === 'chain') {
    const expenses: Expense[] = [
      { label: 'Cab', paidBy: 'B', amount: 100, among: ['A'] },
      { label: 'Lunch', paidBy: 'C', amount: 100, among: ['B'] },
      { label: 'Ticket', paidBy: 'D', amount: 100, among: ['C'] },
    ];
    return { people: ['A', 'B', 'C', 'D'], expenses, net: netFromLedger(['A', 'B', 'C', 'D'], expenses) };
  }
  const people = ['Asha', 'Bilal', 'Chen', 'Divya'];
  const expenses: Expense[] = [
    { label: 'Hotel', paidBy: 'Asha', amount: 1200, among: people },
    { label: 'Dinner', paidBy: 'Bilal', amount: 1000, among: ['Asha', 'Bilal', 'Chen'] },
    { label: 'Cabs', paidBy: 'Chen', amount: 400, among: people },
    { label: 'Museum', paidBy: 'Divya', amount: 300, among: ['Bilal', 'Chen', 'Divya'] },
  ];
  return { people, expenses, net: netFromLedger(people, expenses) };
}

export function netFromLedger(people: string[], expenses: Expense[]): Record<string, number> {
  const net: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  for (const e of expenses) {
    const shares = equalSplit(e.amount, e.among.length);
    net[e.paidBy] += e.amount;
    e.among.forEach((u, i) => (net[u] -= shares[i]));
  }
  return net;
}

/** Without simplification: every participant pays the payer back for every expense. */
export function rawTransfers(expenses: Expense[]): Transfer[] {
  const out: Transfer[] = [];
  for (const e of expenses) {
    const shares = equalSplit(e.amount, e.among.length);
    e.among.forEach((u, i) => {
      if (u !== e.paidBy && shares[i] > 0) out.push({ from: u, to: e.paidBy, amount: shares[i] });
    });
  }
  return out;
}

/** The topic's greedy: largest debtor pays largest creditor; ≤ n−1 transfers, not always minimal. */
export function simplifyGreedy(net: Record<string, number>, order: string[] = Object.keys(net)): Transfer[] {
  const cred = order.filter((u) => net[u] > 0).map((u) => ({ u, v: net[u] }));
  const debt = order.filter((u) => net[u] < 0).map((u) => ({ u, v: -net[u] }));
  const out: Transfer[] = [];
  while (cred.length && debt.length) {
    cred.sort((a, b) => b.v - a.v);
    debt.sort((a, b) => b.v - a.v);
    const c = cred[0];
    const d = debt[0];
    const amt = Math.min(c.v, d.v);
    out.push({ from: d.u, to: c.u, amount: amt });
    c.v -= amt;
    d.v -= amt;
    if (c.v === 0) cred.shift();
    if (d.v === 0) debt.shift();
  }
  return out;
}

/** Maximum number of disjoint zero-sum groups covering all non-zero balances (n ≤ ~12). */
export function zeroSumGroups(net: Record<string, number>): string[][] {
  const users = Object.keys(net).filter((u) => net[u] !== 0);
  const n = users.length;
  const full = (1 << n) - 1;
  const sum = new Array<number>(full + 1).fill(0);
  for (let m = 1; m <= full; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low] + net[users[31 - Math.clz32(low)]];
  }
  // best[m] = max groups partitioning m (only defined when sum[m] === 0); choice[m] = the group containing m's lowest bit
  const best = new Array<number>(full + 1).fill(-1);
  const choice = new Array<number>(full + 1).fill(0);
  best[0] = 0;
  for (let m = 1; m <= full; m++) {
    if (sum[m] !== 0) continue;
    const low = m & -m;
    const rest = m ^ low;
    // enumerate submasks s of rest; group = s | low
    for (let s = rest; ; s = (s - 1) & rest) {
      const g = s | low;
      if (sum[g] === 0 && best[m ^ g] >= 0 && best[m ^ g] + 1 > best[m]) {
        best[m] = best[m ^ g] + 1;
        choice[m] = g;
      }
      if (s === 0) break;
    }
  }
  const groups: string[][] = [];
  for (let m = full; m; m ^= choice[m]) groups.push(users.filter((_, i) => choice[m] & (1 << i)));
  return groups;
}

/** Exact minimum: settle each zero-sum group on its own (k members → k−1 transfers). */
export function simplifyOptimal(net: Record<string, number>): Transfer[] {
  return zeroSumGroups(net).flatMap((g) => simplifyGreedy(Object.fromEntries(g.map((u) => [u, net[u]]))));
}

const fmt = (n: number) => `₹${Math.abs(n)}`;

export function simulate(p: Params): Frame[] {
  const { people, expenses, net } = dataset(p.data);
  const frames: Frame[] = [];
  const cur = { ...net };
  const done: Transfer[] = [];
  const groups = p.algo === 'optimal' ? zeroSumGroups(net) : [];
  const snap = (caption: string, fin = false, predict?: string) =>
    frames.push({ people, net: { ...cur }, transfers: done.map((t) => ({ ...t })), groups, done: fin, caption, predict });

  const balances = people
    .filter((u) => net[u] !== 0)
    .map((u) => `${u} ${net[u] > 0 ? '+' : '−'}${fmt(net[u]).slice(1)}`)
    .join(', ');
  const intro = expenses
    ? `Ledger: ${expenses.map((e) => `${e.label} ₹${e.amount} paid by ${e.paidBy} for ${e.among.length === people.length ? 'everyone' : e.among.join('+')}`).join('; ')}. Net balances (a view derived from the ledger, summing to 0): ${balances}.`
    : `Net balances (+ is owed, − owes): ${balances}. They sum to zero, as every ledger does.`;
  const plan: Transfer[] =
    p.algo === 'raw' ? (expenses ? rawTransfers(expenses) : simplifyGreedy(net)) : p.algo === 'greedy' ? simplifyGreedy(net, people) : simplifyOptimal(net);

  const predict =
    p.algo === 'greedy' && p.data === 'counter'
      ? 'Greedy pairs the biggest debtor (E, ₹300) with the biggest creditor (B, ₹400). How many transfers will it need in total?'
      : p.algo === 'optimal'
        ? 'Can you spot people whose balances cancel out on their own?'
        : undefined;
  snap(intro, false, predict);

  if (p.algo === 'optimal')
    snap(
      `Exact method: find the most disjoint zero-sum groups. Here: ${groups.map((g) => `{${g.join(', ')}}`).join(' and ')}. Each group of k people settles in k−1 transfers, so the minimum is ${
        people.filter((u) => net[u] !== 0).length
      } − ${groups.length} = ${plan.length}.`,
    );
  if (p.algo === 'raw' && !expenses) snap('This dataset has only balances, no ledger, so “raw” falls back to greedy settlement.');

  for (const t of plan) {
    cur[t.from] += t.amount;
    cur[t.to] -= t.amount;
    done.push(t);
    const why =
      p.algo === 'greedy'
        ? ' (largest remaining debtor → largest remaining creditor)'
        : p.algo === 'optimal'
          ? ` (inside group {${groups.find((g) => g.includes(t.from))?.join(', ')}})`
          : ' (pay the payer back for this expense)';
    snap(`Transfer ${done.length}: ${t.from} pays ${t.to} ${fmt(t.amount)}${why}.`);
  }

  const g = simplifyGreedy(net, people).length;
  const o = simplifyOptimal(net).length;
  const r = expenses ? rawTransfers(expenses).length : null;
  const lesson =
    p.algo === 'greedy' && g > o
      ? `Greedy needed ${g}; the exact minimum is ${o}. Greedy is O(n log n) and ≤ n−1, but it misses independent zero-sum subgroups.`
      : p.algo === 'optimal'
        ? `Minimum ${o} transfer(s)${g > o ? `, one fewer than greedy’s ${g}` : `, same as greedy here`}. Finding it is NP-hard (bitmask DP, fine up to ~20 people).`
        : p.algo === 'raw'
          ? `${done.length} raw transfer(s) vs ${o} after simplification. Same money, fewer payments.`
          : `Greedy needed ${g}, which is also optimal for this data.`;
  snap(`Settled: every balance is zero after ${done.length} transfer(s). ${lesson}${r !== null && p.algo !== 'raw' ? ` (Paying back each expense directly would take ${r}.)` : ''}`, true);
  return frames;
}
