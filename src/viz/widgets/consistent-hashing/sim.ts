// Pure simulation of a consistent-hash ring with virtual nodes, compared against naive `hash % N`.
// Scripted scenario: build the ring → map keys → add a node → remove a node.
import type { BaseFrame } from '../../core';

export interface Params {
  /** physical nodes at the start (one more is added during the scenario) */
  nodes: number;
  /** virtual nodes (ring points) per physical node */
  vnodes: number;
}

export const DEFAULT_PARAMS: Params = { nodes: 4, vnodes: 3 };
export const KEY_COUNT = 60;
export const NODE_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export interface RingPoint {
  /** position on the ring in [0, 1) */
  pos: number;
  node: string;
  vi: number;
  state: 'normal' | 'new' | 'gone';
}

export interface KeyDot {
  id: string;
  pos: number;
  owner: string;
  /** owner before the latest membership change, when it differs */
  prev?: string;
  moved: boolean;
}

export interface Compare {
  label: string;
  ring: number;
  naive: number;
  total: number;
}

export interface Frame extends BaseFrame {
  points: RingPoint[];
  keys: KeyDot[];
  showKeys: boolean;
  /** physical nodes currently on the ring (bar chart rows) */
  nodes: string[];
  counts: Record<string, number>;
  /** fraction of the ring each node owns (its expected share of keys) */
  share: Record<string, number>;
  trace?: { key: string; keyPos: number; pointPos: number; node: string };
  /** node removed in phase 3 (set on those frames) */
  removed?: string;
  compare?: Compare;
}

/** FNV-1a followed by the murmur3 finaliser: cheap, deterministic, well spread. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const toPos = (h: number) => h / 4294967296;

function buildPoints(nodes: string[], vnodes: number): RingPoint[] {
  const pts: RingPoint[] = [];
  for (const n of nodes) for (let i = 0; i < vnodes; i++) pts.push({ pos: toPos(hash32(`${n}#${i}`)), node: n, vi: i, state: 'normal' });
  return pts.sort((a, b) => a.pos - b.pos);
}

/** first ring point clockwise from pos (wrapping past 1.0 back to the start) */
export function lookup(points: RingPoint[], pos: number): RingPoint {
  const live = points.filter((p) => p.state !== 'gone');
  return live.find((p) => p.pos >= pos) ?? live[0];
}

function countBy(keys: KeyDot[], nodes: string[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const n of nodes) c[n] = 0;
  for (const k of keys) c[k.owner] = (c[k.owner] ?? 0) + 1;
  return c;
}

export function ringShare(points: RingPoint[]): Record<string, number> {
  const live = points.filter((p) => p.state !== 'gone');
  const out: Record<string, number> = {};
  live.forEach((p, i) => {
    const prev = live[(i - 1 + live.length) % live.length];
    let d = p.pos - prev.pos;
    if (d <= 0) d += 1;
    if (live.length === 1) d = 1;
    out[p.node] = (out[p.node] ?? 0) + d;
  });
  return out;
}

function shareText(points: RingPoint[], nodes: string[]): string {
  const sh = ringShare(points);
  const top = nodes.reduce((a, x) => ((sh[x] ?? 0) > (sh[a] ?? 0) ? x : a), nodes[0]);
  return `${top} owns ${Math.round((sh[top] ?? 0) * 100)}% of the ring (fair share ${Math.round(100 / nodes.length)}%)`;
}

function balance(counts: Record<string, number>, nodes: string[]) {
  const vals = nodes.map((n) => counts[n]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = KEY_COUNT / nodes.length;
  const minNode = nodes[vals.indexOf(min)];
  const maxNode = nodes[vals.indexOf(max)];
  return { min, max, avg, minNode, maxNode, ratio: max / avg };
}

const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
const fmt = (p: number) => p.toFixed(2);

function describeSpread(moved: KeyDot[], field: 'owner' | 'prev'): string {
  const by: Record<string, number> = {};
  for (const k of moved) {
    const n = k[field]!;
    by[n] = (by[n] ?? 0) + 1;
  }
  return Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `${n}:${c}`)
    .join(', ');
}

export function simulate({ nodes: n0, vnodes }: Params): Frame[] {
  const frames: Frame[] = [];
  const names0 = NODE_NAMES.slice(0, n0);
  const added = NODE_NAMES[n0];
  const keyIds = Array.from({ length: KEY_COUNT }, (_, i) => `user:${i + 1}`);
  const keyHash = keyIds.map((k) => hash32(k));

  // ---- phase 1: the initial ring --------------------------------------------------------------
  let points = buildPoints(names0, vnodes);
  let keys: KeyDot[] = keyIds.map((id, i) => {
    const pos = toPos(keyHash[i]);
    return { id, pos, owner: lookup(points, pos).node, moved: false };
  });
  let counts = countBy(keys, names0);
  const base = (extra: Partial<Frame>): Frame => ({
    points,
    keys,
    showKeys: true,
    nodes: names0,
    counts,
    share: ringShare(points),
    caption: '',
    ...extra,
  });

  frames.push(
    base({
      showKeys: false,
      caption: `${n0} physical nodes × ${vnodes} virtual node${vnodes > 1 ? 's' : ''} each = ${points.length} points on the ring. Each point sits at hash("${names0[0]}#0"), hash("${names0[0]}#1")…, so one server owns several arcs.`,
    }),
  );
  frames.push(
    base({
      caption: `${KEY_COUNT} keys are hashed onto the same ring. Rule: a key belongs to the first point clockwise from it, i.e. the coloured arc it lands in.`,
      predict: `${keyIds[0]} lands at ${fmt(keys[0].pos)} on the ring. Which node owns it?`,
    }),
  );
  for (let i = 0; i < 3; i++) {
    const k = keys[i];
    const p = lookup(points, k.pos);
    const wrapped = p.pos < k.pos;
    frames.push(
      base({
        trace: { key: k.id, keyPos: k.pos, pointPos: p.pos, node: p.node },
        caption: `${k.id} hashes to ${fmt(k.pos)} and walks clockwise${wrapped ? ' past 1.0, wrapping to the start,' : ''} to ${p.node}#${p.vi} at ${fmt(p.pos)}, so node ${p.node} stores it. A lookup is one binary search over the sorted points.`,
      }),
    );
  }
  let b = balance(counts, names0);
  frames.push(
    base({
      caption: `Load: ${b.minNode} holds ${b.min} keys, ${b.maxNode} holds ${b.max} (ideal ${b.avg.toFixed(1)}). The busiest node carries ${b.ratio.toFixed(2)}× the average; ${shareText(points, names0)}${vnodes < 8 ? '. Few vnodes means uneven arcs' : ''}.`,
      predict: `Node ${added} joins. What share of the ${KEY_COUNT} keys move on the ring, and what share would move with hash % N going ${n0}→${n0 + 1}?`,
    }),
  );

  // ---- phase 2: add a node ----------------------------------------------------------------------
  const names1 = [...names0, added];
  const newPts = buildPoints([added], vnodes).map((p) => ({ ...p, state: 'new' as const }));
  points = [...points, ...newPts].sort((a, b) => a.pos - b.pos);
  frames.push(
    base({
      nodes: names1,
      counts: { ...counts, [added]: 0 },
      caption: `${added}'s ${vnodes} point${vnodes > 1 ? 's' : ''} land on the ring. Each new point claims only the arc between its counter-clockwise neighbour and itself; no other arc changes.`,
    }),
  );
  keys = keys.map((k) => {
    const owner = lookup(points, k.pos).node;
    return owner === k.owner ? { ...k, moved: false, prev: undefined } : { ...k, owner, prev: k.owner, moved: true };
  });
  counts = countBy(keys, names1);
  const movedAdd = keys.filter((k) => k.moved);
  const naiveAdd = keyHash.filter((h) => names0[h % n0] !== names1[h % (n0 + 1)]).length;
  frames.push(
    base({
      nodes: names1,
      counts,
      caption:
        movedAdd.length === 0
          ? `No key happened to fall into ${added}'s new arcs, so 0 keys moved. With few vnodes a new node can start almost empty.`
          : `${movedAdd.length} of ${KEY_COUNT} keys (${pct(movedAdd.length, KEY_COUNT)}) moved, every one of them to ${added}, taken from ${describeSpread(movedAdd, 'prev')}. Expected ≈ 1/${n0 + 1} = ${pct(1, n0 + 1)}. All other keys stay put.`,
    }),
  );
  const cmpAdd: Compare = { label: `add ${added} (${n0}→${n0 + 1})`, ring: movedAdd.length, naive: naiveAdd, total: KEY_COUNT };
  frames.push(
    base({
      nodes: names1,
      counts,
      compare: cmpAdd,
      caption: `Same change with hash % N: ${naiveAdd} of ${KEY_COUNT} keys (${pct(naiveAdd, KEY_COUNT)}) change server, since a key stays only if h % ${n0} = h % ${n0 + 1} (≈ ${pct(1, n0 + 1)} do). For a cache that is a miss storm.`,
    }),
  );
  b = balance(counts, names1);
  // remove the busiest of the original nodes, so the move is visible
  const removed = names0.reduce((best, x) => (counts[x] > counts[best] ? x : best), names0[0]);
  frames.push(
    base({
      nodes: names1,
      counts,
      compare: cmpAdd,
      caption: `Load after the add: min ${b.min} (${b.minNode}), max ${b.max} (${b.maxNode}), ideal ${b.avg.toFixed(1)}, so the max is ${b.ratio.toFixed(2)}× the average; ${shareText(points, names1)}.`,
      predict: `Node ${removed} now crashes and leaves the ring. Which keys move, and where do they go with ${vnodes} vnode${vnodes > 1 ? 's' : ''} per node?`,
    }),
  );

  // ---- phase 3: remove a node --------------------------------------------------------------------
  const names2 = names1.filter((x) => x !== removed);
  points = points.map((p) => ({ ...p, state: p.node === removed ? 'gone' : 'normal' }));
  keys = keys.map((k) => {
    const owner = lookup(points, k.pos).node;
    return owner === k.owner ? { ...k, moved: false, prev: undefined } : { ...k, owner, prev: k.owner, moved: true };
  });
  counts = countBy(keys, names2);
  const movedRem = keys.filter((k) => k.moved);
  const receivers = new Set(movedRem.map((k) => k.owner));
  const naiveRem = keyHash.filter((h) => names1[h % (n0 + 1)] !== names2[h % n0]).length;
  frames.push(
    base({
      removed,
      nodes: names2,
      counts,
      caption:
        movedRem.length === 0
          ? `${removed} owned no keys, so nothing moves.`
          : `Only ${removed}'s ${movedRem.length} keys move (${pct(movedRem.length, KEY_COUNT)}). Each goes to the next live point clockwise: ${describeSpread(movedRem, 'owner')}. ${receivers.size === 1 ? `With ${vnodes === 1 ? 'one vnode' : 'few vnodes'} one neighbour absorbs the whole load.` : `Spread over ${receivers.size} survivors because ${removed}'s arcs were scattered around the ring.`}`,
    }),
  );
  const cmpRem: Compare = { label: `remove ${removed} (${n0 + 1}→${n0})`, ring: movedRem.length, naive: naiveRem, total: KEY_COUNT };
  frames.push(
    base({
      removed,
      nodes: names2,
      counts,
      compare: cmpRem,
      caption: `hash % N on the same removal: ${naiveRem} of ${KEY_COUNT} keys (${pct(naiveRem, KEY_COUNT)}) change server, including keys whose server never failed.`,
    }),
  );
  b = balance(counts, names2);
  frames.push(
    base({
      removed,
      nodes: names2,
      counts,
      compare: cmpRem,
      caption: `Load after the removal: min ${b.min} (${b.minNode}), max ${b.max} (${b.maxNode}), ideal ${b.avg.toFixed(1)}, so the max is ${b.ratio.toFixed(2)}× the average; ${shareText(points, names2)}.`,
    }),
  );
  frames.push(
    base({
      removed,
      nodes: names2,
      counts,
      compare: cmpRem,
      caption: `Takeaway: the ring moved ${movedAdd.length} + ${movedRem.length} keys where hash % N moved ${naiveAdd} + ${naiveRem}. ${vnodes < 8 ? 'Raise vnodes per node to even out the arcs and spread a failed node’s keys over more survivors.' : 'With many vnodes per node, the arcs even out and a failed node’s keys spread over many survivors.'}`,
    }),
  );

  return frames;
}
