// Pure challenge logic shared by the UI and scripts/validate-challenges.mjs (plain node loads this file,
// so: type-only imports, no path aliases, no browser APIs).
import type {
  CompareOp,
  Expr,
  FaultMetric,
  FaultPuzzle,
  FlowPuzzle,
  Knob,
  MatchPuzzle,
  RoutePacket,
  RoutePuzzle,
  Rule,
  SequencePuzzle,
  SpikeGoal,
  SpikeMetric,
  SpikePuzzle,
  TuneConstraint,
  TuneEdge,
  TunePuzzle,
} from './types';

export type Values = Record<string, number>;

/**
 * Pure numeric helpers that tune expressions may call by id: { op: 'fn', fn: 'mm1Latency', args: [...] }.
 * Add new ones here (pure, total, documented); never anything that touches the outside world.
 */
export const FUNCTIONS: Record<string, { arity: number; doc: string; run: (...a: number[]) => number }> = {
  ceil: { arity: 1, doc: 'round up', run: (x) => Math.ceil(x) },
  floor: { arity: 1, doc: 'round down', run: (x) => Math.floor(x) },
  round: { arity: 1, doc: 'round to nearest', run: (x) => Math.round(x) },
  pow: { arity: 2, doc: 'x to the power y', run: (x, y) => x ** y },
  log2: { arity: 1, doc: 'base-2 logarithm', run: (x) => Math.log2(x) },
  /** M/M/1 mean response time: service time / (1 − utilisation); ∞ at or above saturation */
  mm1Latency: {
    arity: 2,
    doc: 'M/M/1 response time = serviceMs / (1 − utilisation); Infinity when utilisation ≥ 1',
    run: (serviceMs, util) => (util >= 1 ? Infinity : serviceMs / (1 - util)),
  },
  /** probability that at least one of n parallel calls exceeds its p-quantile: 1 − q^n */
  fanoutTail: { arity: 2, doc: '1 − q^n (chance one of n calls is slower than its q-quantile)', run: (q, n) => 1 - q ** n },
};

export function evalExpr(e: Expr, v: Values): number {
  if (typeof e === 'number') return e;
  if ('knob' in e) return v[e.knob] ?? NaN;
  switch (e.op) {
    case 'add':
      return e.args.reduce<number>((s, a) => s + evalExpr(a, v), 0);
    case 'mul':
      return e.args.reduce<number>((s, a) => s * evalExpr(a, v), 1);
    case 'sub': {
      const [first, ...rest] = e.args.map((a) => evalExpr(a, v));
      return rest.reduce((s, x) => s - x, first ?? 0);
    }
    case 'div': {
      const [first, ...rest] = e.args.map((a) => evalExpr(a, v));
      return rest.reduce((s, x) => (x === 0 ? (s === 0 ? NaN : Infinity) : s / x), first ?? 0);
    }
    case 'min':
      return Math.min(...e.args.map((a) => evalExpr(a, v)));
    case 'max':
      return Math.max(...e.args.map((a) => evalExpr(a, v)));
    case 'pick': {
      const i = Math.round(evalExpr(e.index, v));
      return i >= 1 && i <= e.list.length ? e.list[i - 1] : Infinity;
    }
    case 'if':
      return evalRule(e.cond, v) ? evalExpr(e.then, v) : evalExpr(e.else, v);
    case 'fn': {
      const f = FUNCTIONS[e.fn];
      return f ? f.run(...e.args.map((a) => evalExpr(a, v))) : NaN;
    }
  }
}

const EPS = 1e-9;
export function compare(a: number, op: CompareOp, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  switch (op) {
    case '<':
      return a < b - EPS;
    case '<=':
      return a <= b + EPS;
    case '>':
      return a > b + EPS;
    case '>=':
      return a >= b - EPS;
    case '==':
      return Math.abs(a - b) <= EPS || a === b;
    case '!=':
      return !(Math.abs(a - b) <= EPS || a === b);
  }
}

export function evalRule(r: Rule, v: Values): boolean {
  if ('all' in r) return r.all.every((x) => evalRule(x, v));
  if ('any' in r) return r.any.some((x) => evalRule(x, v));
  if ('not' in r) return !evalRule(r.not, v);
  return compare(evalExpr(r.left, v), r.op, evalExpr(r.right, v));
}

/** false when the gauge's `applies` rule doesn't hold for these values (it then shows "n/a") */
export function constraintApplies(c: TuneConstraint, v: Values): boolean {
  return !c.applies || evalRule(c.applies, v);
}

/** a gauge passes when it holds, or when it doesn't apply to the current setting */
export function constraintHolds(c: TuneConstraint, v: Values): boolean {
  return !constraintApplies(c, v) || compare(evalExpr(c.left, v), c.op, evalExpr(c.right, v));
}

/** knob ids a gauge depends on (both sides plus its `applies` rule) */
export function constraintRefs(c: TuneConstraint): Set<string> {
  const out = knobRefs({ left: c.left, op: c.op, right: c.right });
  if (c.applies) knobRefs(c.applies, out);
  return out;
}

/**
 * The gauge's value line for these knob values, per its `display`:
 * { text: shown in the gauge, spoken: for its accessible name, na: the gauge doesn't apply }.
 */
export function gaugeText(c: TuneConstraint, v: Values): { text: string; spoken: string; na: boolean } {
  if (!constraintApplies(c, v)) return { text: 'n/a', spoken: 'not applicable', na: true };
  const l = evalExpr(c.left, v);
  const r = evalExpr(c.right, v);
  const ok = compare(l, c.op, r);
  const d = c.display ?? 'number';
  if (d === 'yesno') {
    const yn = (x: number) => (x !== 0 && !Number.isNaN(x) ? 'yes' : 'no');
    const needYes = compare(1, c.op, r);
    const needNo = compare(0, c.op, r);
    const need = needYes !== needNo ? ` · needs ${needYes ? 'yes' : 'no'}` : '';
    return { text: ok ? yn(l) : yn(l) + need, spoken: yn(l) + need.replace(' · ', ', '), na: false };
  }
  if (typeof d === 'object') {
    const t = ok ? d.pass : d.fail;
    return { text: t, spoken: t, na: false };
  }
  const dec = c.decimals ?? 0;
  const unit = c.unit ?? '';
  const a = formatNum(l, dec, unit);
  const b = formatNum(r, dec, unit);
  return { text: `${a} ${OP_TEXT[c.op]} ${b}`, spoken: `${a} ${OP_TEXT[c.op]} ${b}`, na: false };
}

/** knob ids referenced by an expression / rule (for highlighting and validation) */
export function knobRefs(x: Expr | Rule, out = new Set<string>()): Set<string> {
  if (typeof x === 'number') return out;
  if ('knob' in x) out.add(x.knob);
  else if ('all' in x) x.all.forEach((r) => knobRefs(r, out));
  else if ('any' in x) x.any.forEach((r) => knobRefs(r, out));
  else if ('not' in x) knobRefs(x.not, out);
  else if ('left' in x) {
    knobRefs(x.left, out);
    knobRefs(x.right, out);
  } else if (x.op === 'pick') knobRefs(x.index, out);
  else if (x.op === 'if') {
    knobRefs(x.cond, out);
    knobRefs(x.then, out);
    knobRefs(x.else, out);
  } else x.args.forEach((a) => knobRefs(a, out));
  return out;
}

/** function ids referenced by an expression / rule */
export function fnRefs(x: Expr | Rule, out = new Set<string>()): Set<string> {
  if (typeof x === 'number' || 'knob' in x) return out;
  if ('all' in x) x.all.forEach((r) => fnRefs(r, out));
  else if ('any' in x) x.any.forEach((r) => fnRefs(r, out));
  else if ('not' in x) fnRefs(x.not, out);
  else if ('left' in x) {
    fnRefs(x.left, out);
    fnRefs(x.right, out);
  } else if (x.op === 'pick') fnRefs(x.index, out);
  else if (x.op === 'if') {
    fnRefs(x.cond, out);
    fnRefs(x.then, out);
    fnRefs(x.else, out);
  } else {
    if (x.op === 'fn') out.add(x.fn);
    x.args.forEach((a) => fnRefs(a, out));
  }
  return out;
}

/** every value a knob can take, in order */
export function knobValues(k: Knob): number[] {
  if (k.kind === 'toggle') return [0, 1];
  if (k.kind === 'choice') return (k.choices ?? []).map((c) => c.value);
  const min = k.min ?? 0;
  const max = k.max ?? min;
  const step = k.step && k.step > 0 ? k.step : 1;
  const out: number[] = [];
  for (let i = 0; min + i * step <= max + EPS && out.length < 100_001; i++) out.push(+(min + i * step).toFixed(10));
  return out;
}

export function initialValues(knobs: Knob[]): Values {
  return Object.fromEntries(knobs.map((k) => [k.id, k.initial]));
}

/** snap a raw value onto the knob's allowed values */
export function snapKnob(k: Knob, raw: number): number {
  const vals = knobValues(k);
  if (!vals.length) return raw;
  return vals.reduce((best, x) => (Math.abs(x - raw) < Math.abs(best - raw) ? x : best), vals[0]);
}

/**
 * Exhaustive grid search over every knob combination. Returns the number of combinations tried, the first
 * solution found (or null), and how many combinations satisfy everything. `limit` guards against huge grids.
 */
export function searchTune(p: TunePuzzle, limit = 2_000_000): { tried: number; solutions: number; first: Values | null; tooBig: boolean } {
  const lists = p.knobs.map((k) => knobValues(k));
  const total = lists.reduce((n, l) => n * Math.max(1, l.length), 1);
  if (total > limit) return { tried: 0, solutions: 0, first: null, tooBig: true };
  let solutions = 0;
  let first: Values | null = null;
  const idx = lists.map(() => 0);
  for (let n = 0; n < total; n++) {
    const v: Values = {};
    p.knobs.forEach((k, i) => (v[k.id] = lists[i][idx[i]]));
    if (p.constraints.every((c) => constraintHolds(c, v))) {
      solutions++;
      first ??= v;
    }
    for (let i = idx.length - 1; i >= 0; i--) {
      idx[i]++;
      if (idx[i] < lists[i].length) break;
      idx[i] = 0;
    }
  }
  return { tried: total, solutions, first, tooBig: false };
}

/** tune board parts shown for these knob values: nodes whose `showIf` holds, and wires between shown nodes whose own `showIf` holds */
export function tuneVisible(p: TunePuzzle, v: Values): { nodes: Set<string>; edges: TuneEdge[] } {
  const nodes = new Set(p.nodes.filter((n) => !n.showIf || evalRule(n.showIf, v)).map((n) => n.id));
  const edges = p.edges.filter(([a, b, , showIf]) => nodes.has(a) && nodes.has(b) && (!showIf || evalRule(showIf, v)));
  return { nodes, edges };
}

/* ------------------------------------------------------------------ scoring + mode checks */

export type Stars = 1 | 2 | 3;

/** 3 stars: flawless · 2: at most two misses + hints combined · 1: finished */
export function starsFor(misses: number, hints: number): Stars {
  const slips = misses + hints;
  return slips === 0 ? 3 : slips <= 2 ? 2 : 1;
}

export const flowSlots = (p: FlowPuzzle) => p.nodes.filter((n) => n.answer);
export const flowFits = (p: FlowPuzzle, slotId: string, optionId: string) => p.nodes.find((n) => n.id === slotId)?.answer === optionId;

/** sequence: does step `stepId` belong at 0-based position `pos`? */
export const sequenceFits = (p: SequencePuzzle, pos: number, stepId: string) => p.steps[pos]?.id === stepId;
/** number of leading positions filled (packets flow up to the first gap) */
export function sequencePrefix(filled: (string | undefined)[]): number {
  const gap = filled.findIndex((x) => !x);
  return gap === -1 ? filled.length : gap;
}

export const faultIds = (p: FaultPuzzle) => p.nodes.filter((n) => n.fault).map((n) => n.id);
export const faultFits = (p: FaultPuzzle, nodeId: string, optionId: string) => p.nodes.find((n) => n.id === nodeId)?.fault?.answer === optionId;

/** current alarm value: bad → good in proportion to how many of the metric's faults are fixed */
export function metricValue(m: FaultMetric, fixed: ReadonlySet<string>, allFaults: string[]): number {
  const drivers = m.fixedBy?.length ? m.fixedBy : allFaults;
  const share = drivers.length ? drivers.filter((id) => fixed.has(id)).length / drivers.length : 1;
  return m.bad + (m.good - m.bad) * share;
}

export const matchFits = (p: MatchPuzzle, leftId: string, rightId: string) => p.left.find((l) => l.id === leftId)?.answer === rightId;

/* ------------------------------------------------------------------ route */

export const edgeKey = (from: string, to: string) => `${from}>${to}`;

/** wires leaving a node, in edge order */
export const routeOut = (p: RoutePuzzle, node: string) => p.edges.filter(([a]) => a === node).map(([, b, label]) => ({ to: b, label }));

/** does `path` (a node sequence from the packet's start) still lie on one of the packet's acceptable routes? */
export function routeOnTrack(k: RoutePacket, path: readonly string[]): boolean {
  return k.paths.some((r) => path.length <= r.length && path.every((x, i) => r[i] === x));
}

/**
 * The choices at the end of `path`: every outgoing wire, marked ok when it keeps the packet on an acceptable route.
 * `why` is the packet's explanation for a wrong hop (or its optional note for a right one).
 */
export function routeChoices(p: RoutePuzzle, k: RoutePacket, path: readonly string[]) {
  const at = path[path.length - 1];
  return routeOut(p, at).map((o) => {
    const key = edgeKey(at, o.to);
    const ok = routeOnTrack(k, [...path, o.to]);
    return { ...o, key, ok, why: ok ? k.right?.[key] : k.wrong[key] };
  });
}

/** the packet has arrived: it followed a whole acceptable path */
export const routeArrived = (k: RoutePacket, path: readonly string[]) => k.paths.some((r) => r.length === path.length && r.every((x, i) => path[i] === x));

/** the meter total of a node sequence */
export function routeCost(p: RoutePuzzle, path: readonly string[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += p.meter?.costs[edgeKey(path[i - 1], path[i])] ?? 0;
  return sum;
}

/* ------------------------------------------------------------------ spike: the deterministic traffic simulation */

export interface SpikeSample {
  /** simulated second */
  t: number;
  /** offered requests per second */
  offered: number;
  /** after edge shedding */
  admitted: number;
  p99: number;
  /** % of offered requests that fail (overflow at saturated nodes) */
  errors: number;
  /** % rejected at the edge */
  shed: number;
  cost: number;
  /** utilisation per node with a capacity (1 = 100%) */
  util: Record<string, number>;
  /** nodes whose latency is in the p99 (≥ 1% of requests wait on them) */
  inP99: string[];
  /** bursts active at this tick (their labels) */
  bursts: string[];
}

/** the tick times 0, step, 2·step … duration */
export function spikeTimes(p: SpikePuzzle): number[] {
  const out: number[] = [];
  const step = p.step > 0 ? p.step : 1;
  for (let i = 0; i * step <= p.duration + EPS && out.length < 1000; i++) out.push(+(i * step).toFixed(6));
  return out;
}

/** offered rps at second t: linear between the traffic points */
export function spikeTraffic(p: SpikePuzzle, t: number): number {
  const pts = p.traffic;
  if (!pts.length) return 0;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [t1, r1] = pts[i];
    const [t0, r0] = pts[i - 1];
    if (t <= t1) return t1 === t0 ? r1 : r0 + ((r1 - r0) * (t - t0)) / (t1 - t0);
  }
  return pts[pts.length - 1][1];
}

/** a node's latency at utilisation u: queueing ms / (1 − u) (at most 10×), the timeout once saturated */
export function spikeLatency(ms: number, timeoutMs: number, u: number): number {
  if (u >= 1) return timeoutMs;
  return Math.min(timeoutMs, ms / Math.max(0.1, 1 - u));
}

/** one tick of the simulation with these cards installed (pure) */
export function spikeSample(p: SpikePuzzle, installed: ReadonlySet<string>, t: number): SpikeSample {
  const cards = p.cards.filter((c) => installed.has(c.id));
  const offered = spikeTraffic(p, t);
  const keep = cards.reduce((k, c) => c.effects.reduce((kk, e) => ('shed' in e ? kk * (1 - Math.min(1, Math.max(0, e.shed))) : kk), k), 1);
  const admitted = offered * keep;
  const util: Record<string, number> = {};
  const inP99: string[] = [];
  let overflow = 0;
  let p99 = 0;
  const active = (p.bursts ?? []).filter((b) => t >= b.from - EPS && t < b.to - EPS);
  for (const n of p.nodes) {
    let loadF = 1;
    let capF = 1;
    let addMs = 0;
    for (const c of cards)
      for (const e of c.effects) {
        if ('shed' in e || e.node !== n.id) continue;
        if (e.load !== undefined) loadF *= e.load;
        if (e.capacity !== undefined) capF *= e.capacity;
        if (e.ms !== undefined) addMs += e.ms;
      }
    const burst = active.filter((b) => b.node === n.id).reduce((s, b) => s + b.add, 0);
    const driven = (admitted * (n.share ?? 0) + burst) * loadF;
    const load = driven + (n.base ?? 0);
    const cap = n.capacity !== undefined ? n.capacity * capF : Infinity;
    const u = cap > 0 ? load / cap : Infinity;
    if (n.capacity !== undefined) util[n.id] = u;
    if (load > cap) overflow += load - cap;
    const ms = (n.ms ?? 0) + addMs;
    if (ms > 0 && admitted > 0 && driven / admitted >= 0.01 - EPS) {
      inP99.push(n.id);
      p99 += spikeLatency(ms, n.timeoutMs ?? 20 * ms, u);
    }
  }
  return {
    t,
    offered,
    admitted,
    p99,
    errors: offered > 0 ? Math.min(100, (overflow / offered) * 100) : 0,
    shed: offered > 0 ? (1 - keep) * 100 : 0,
    cost: cards.reduce((s, c) => s + (c.cost ?? 0), 0),
    util,
    inP99,
    bursts: active.map((b) => b.label ?? '').filter(Boolean),
  };
}

/** a goal's metric in a sample (util in %) */
export function spikeValue(s: SpikeSample, m: SpikeMetric): number {
  if (m.startsWith('util:')) return (s.util[m.slice(5)] ?? NaN) * 100;
  return s[m as 'p99' | 'errors' | 'shed' | 'cost'];
}

export const spikeHolds = (s: SpikeSample, g: SpikeGoal) => compare(spikeValue(s, g.metric), '<=', g.max);

/** the whole run with a fixed card set: every sample, the first breach of each goal, and whether all goals held */
export function spikeRun(p: SpikePuzzle, installed: ReadonlySet<string>) {
  const samples = spikeTimes(p).map((t) => spikeSample(p, installed, t));
  const breaches: { goal: number; t: number; value: number }[] = [];
  p.goals.forEach((g, gi) => {
    const s = samples.find((x) => !spikeHolds(x, g));
    if (s) breaches.push({ goal: gi, t: s.t, value: spikeValue(s, g.metric) });
  });
  breaches.sort((a, b) => a.t - b.t || a.goal - b.goal);
  return { samples, breaches, pass: breaches.length === 0 };
}

/**
 * Every card set (up to `maxCards`): which pass. Returns the passing sets (card ids in card order), the minimal ones
 * (no passing proper subset) and how many sets were tried. 3–8 cards → at most 256 runs.
 */
export function searchSpike(p: SpikePuzzle) {
  const ids = p.cards.map((c) => c.id);
  const max = p.maxCards ?? ids.length;
  const passing: string[][] = [];
  let tried = 0;
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const set = ids.filter((_, i) => mask & (1 << i));
    if (set.length > max) continue;
    tried++;
    if (spikeRun(p, new Set(set)).pass) passing.push(set);
  }
  const minimal = passing.filter((s) => !passing.some((o) => o.length < s.length && o.every((x) => s.includes(x))));
  minimal.sort((a, b) => a.length - b.length);
  return { tried, passing, minimal };
}

/* ------------------------------------------------------------------ wire labels (Board.tsx draws, the validator checks) */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LabelPlace {
  x: number;
  /** text baseline */
  y: number;
  anchor: 'start' | 'middle' | 'end';
  /** the label's approximate box (mono 11px: 0.6em per character, ~13px tall) */
  box: { l: number; r: number; t: number; b: number };
}

/**
 * Where a wire's label goes. The wire runs from (x1, y1) to (x2, y2) between the clipped ends of nodes a and b
 * (centres + rendered sizes); `boardW` is the board width.
 * - Mostly horizontal wire: centred above it at 60%; if the visible wire is shorter than the text, lifted clear
 *   above both nodes instead of overlapping their borders.
 * - Otherwise: beside the wire at 60%, on the side its upward normal points to; if the gap between the nodes is
 *   too short for a line of text, beside the gap past the wider node. A label that would leave the board on
 *   that side goes to the other side.
 */
export function placeEdgeLabel(w: { x1: number; y1: number; x2: number; y2: number }, a: Box, b: Box, text: string, boardW: number): LabelPlace {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const tw = [...text].length * 6.6;
  const boxOf = (x: number, y: number, anchor: LabelPlace['anchor']): LabelPlace => {
    const l = anchor === 'middle' ? x - tw / 2 : anchor === 'end' ? x - tw : x;
    return { x, y, anchor, box: { l, r: l + tw, t: y - 10, b: y + 3 } };
  };
  if (Math.abs(nx) < 0.35) {
    if (len >= tw + 10) return boxOf(w.x1 + dx * 0.6 + nx * 13, w.y1 + dy * 0.6 + ny * 13 + 4, 'middle');
    return boxOf((w.x1 + w.x2) / 2, Math.min(a.y - a.h / 2, b.y - b.h / 2) - 6, 'middle');
  }
  const side = nx < 0 ? -1 : 1;
  const short = Math.abs(dy) < 18;
  const cx = short ? (w.x1 + w.x2) / 2 : w.x1 + dx * 0.6;
  const y = short ? (w.y1 + w.y2) / 2 + 4 : w.y1 + dy * 0.6 + ny * 13 + 4;
  const off = short ? Math.max(a.w, b.w) / 2 + 6 : Math.abs(nx) * 13;
  const at = (s: number) => boxOf(cx + s * off, y, s < 0 ? 'end' : 'start');
  const first = at(side);
  return first.box.l < 2 || first.box.r > boardW - 2 ? at(-side) : first;
}

/* ------------------------------------------------------------------ text helpers */

/** digits needed to show a number exactly (up to 6), e.g. 0.25 → 2 */
const digitsOf = (x: number | undefined) => {
  if (x === undefined || !Number.isFinite(x)) return 0;
  for (let d = 0; d < 6; d++) if (Math.abs(x * 10 ** d - Math.round(x * 10 ** d)) < 1e-9) return d;
  return 6;
};

/** digits a knob's value is shown with: `decimals`, else as many as its step / min (choice: its values) need */
export function knobDecimals(k: Knob): number {
  if (k.decimals !== undefined) return k.decimals;
  if (k.kind === 'choice') return Math.max(0, ...(k.choices ?? []).map((c) => digitsOf(c.value)));
  if (k.kind === 'toggle') return 0;
  return Math.max(digitsOf(k.step ?? 1), digitsOf(k.min ?? 0));
}

/** a knob's value as words: a choice's button text, a toggle's "on" / "off", else the number */
export function knobLabel(k: Knob, value: number): string {
  if (k.kind === 'choice') return k.choices?.find((c) => Math.abs(c.value - value) < 1e-9)?.label ?? formatNum(value, knobDecimals(k));
  if (k.kind === 'toggle') return value === 1 ? 'on' : 'off';
  return formatNum(value, knobDecimals(k));
}

/** placeholder syntax: {id}, {id:2} (decimals), {id.label} (choice text / on-off) */
export const PLACEHOLDER = /\{([\w-]+)(\.label)?(?::(\d))?\}/g;

/**
 * "{W} acks" → "2 acks" using knob values. With `knobs`, `{id}` uses the knob's decimals and `{id.label}`
 * its words; `{id:n}` always shows n decimals. Unknown ids are left as they are.
 */
export function interpolate(text: string | undefined, v: Values, knobs: Knob[] = []): string {
  return (text ?? '').replace(PLACEHOLDER, (m, id: string, label?: string, dec?: string) => {
    if (!(id in v)) return m;
    const k = knobs.find((x) => x.id === id);
    if (label) return k ? knobLabel(k, v[id]) : m;
    return formatNum(v[id], dec !== undefined ? Number(dec) : k ? knobDecimals(k) : 0);
  });
}

export function formatNum(x: number, decimals = 0, unit = ''): string {
  if (x === Infinity) return '∞' + unit;
  if (x === -Infinity) return '−∞' + unit;
  if (Number.isNaN(x)) return '—';
  const s = x.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return s + unit;
}

export const OP_TEXT: Record<CompareOp, string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '==': '=', '!=': '≠' };

/** Fisher–Yates; never returns the input order when there is more than one distinct order */
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let tries = 0; tries < 6; tries++) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (a.length < 2 || a.some((x, i) => x !== items[i])) break;
  }
  return a;
}
