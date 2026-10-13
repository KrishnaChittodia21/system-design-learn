// Pure, deterministic simulation of shard-key strategy vs. workload skew, then resharding
// by moving whole logical shards to a new node.
import { rng, type BaseFrame } from '../../core';

export type Strategy = 'hash' | 'range';
export type Workload = 'celebrity' | 'time';

export interface Params {
  strategy: Strategy;
  workload: Workload;
  /** physical shard nodes before resharding */
  shards: number;
  /** % of operations that hit the celebrity key / are new time-ordered inserts */
  skew: number;
}

export type Phase = 'intro' | 'load' | 'summary' | 'plan' | 'copy' | 'cutover' | 'fix' | 'wrap';

export interface Frame extends BaseFrame {
  phase: Phase;
  nodes: number;
  /** logical shard → physical node */
  slotNode: number[];
  /** ops per logical shard so far (for the current mapping/scheme) */
  slotLoad: number[];
  /** rows stored per logical shard */
  slotRows: number[];
  nodeLoad: number[];
  totalOps: number;
  /** logical shards being moved to the new node */
  moving: number[];
  movedRows: number;
  totalRows: number;
  /** % of rows a naive "hash % N" (or re-split ranges) rehash would move */
  naiveMovePct: number;
  /** logical shard holding the celebrity key / the insert tail */
  hotSlot: number;
  salted: boolean;
}

export const LOGICAL = 16;
export const BASE_ROWS = 10_000;
const BATCHES = 6;
const OPS_PER_BATCH = 200;
const CELEB = 4242;
const SALTS = 16;

/** 32-bit finaliser (murmur3 fmix) as a stand-in for a real hash function. */
export function hash32(k: number): number {
  let h = k >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const RANGE_WIDTH = BASE_ROWS / LOGICAL; // 625 ids per range; the last range is open-ended

interface Op {
  key: number;
  insert: boolean;
  celeb: boolean;
}

function makeOps({ workload, skew }: Params): Op[] {
  const rand = rng(97 + skew * 13 + (workload === 'time' ? 7 : 0));
  const ops: Op[] = [];
  let nextId = BASE_ROWS;
  for (let i = 0; i < BATCHES * OPS_PER_BATCH; i++) {
    const hot = rand() * 100 < skew;
    const uniform = Math.floor(rand() * BASE_ROWS);
    if (workload === 'celebrity') ops.push(hot ? { key: CELEB, insert: false, celeb: true } : { key: uniform, insert: false, celeb: false });
    else ops.push(hot ? { key: nextId++, insert: true, celeb: false } : { key: uniform, insert: false, celeb: false });
  }
  return ops;
}

export function simulate(p: Params): Frame[] {
  const { strategy, workload, shards: S, skew } = p;
  const ops = makeOps(p);
  const insertedIds = ops.filter((o) => o.insert).map((o) => o.key);

  /** logical shard of a key. salt ≥ 0 means a salted sub-key (hash-prefixed, so it scatters under both schemes) */
  const slotOf = (key: number, salt = -1, prefixHash = false): number => {
    // salted sub-keys are chosen so the 16 salts cover all 16 logical shards
    if (salt >= 0) return (hash32(key) + salt) % LOGICAL;
    if (prefixHash) return hash32(key * 31 + 1_000_003) % LOGICAL;
    if (strategy === 'hash') return hash32(key) % LOGICAL;
    return Math.min(LOGICAL - 1, Math.floor(key / RANGE_WIDTH));
  };

  // logical → physical: hash spreads slots round-robin, range keeps neighbours together
  const initialMap = Array.from({ length: LOGICAL }, (_, s) => (strategy === 'hash' ? s % S : Math.floor((s * S) / LOGICAL)));

  const rowsBySlot = (prefix = false) => {
    const rows = new Array(LOGICAL).fill(0);
    for (let k = 0; k < BASE_ROWS; k++) rows[slotOf(k, -1, prefix)]++;
    for (const id of insertedIds) rows[slotOf(id, -1, prefix)]++;
    return rows;
  };
  const finalRows = rowsBySlot();
  const totalRows = BASE_ROWS + insertedIds.length;

  const loadFor = (n: number, mode: 'plain' | 'salted' | 'prefixed') => {
    const load = new Array(LOGICAL).fill(0);
    ops.slice(0, n).forEach((o, i) => {
      if (mode === 'salted' && o.celeb) load[slotOf(o.key, i % SALTS)]++;
      else load[slotOf(o.key, -1, mode === 'prefixed')]++;
    });
    return load;
  };
  const nodeLoads = (slotLoad: number[], map: number[], nodes: number) => {
    const nl = new Array(nodes).fill(0);
    slotLoad.forEach((l, s) => (nl[map[s]] += l));
    return nl;
  };
  const pct = (a: number, b: number) => Math.round((100 * a) / Math.max(1, b));

  const hotSlot = workload === 'celebrity' ? slotOf(CELEB) : slotOf(BASE_ROWS + 1);

  // naive rehash: hash % (S+1), or re-cutting the key range into S+1 equal pieces
  const naiveNode = (key: number, n: number) =>
    strategy === 'hash' ? hash32(key) % n : Math.min(n - 1, Math.floor((Math.min(key, BASE_ROWS - 1) * n) / BASE_ROWS));
  let naiveMoved = 0;
  for (let k = 0; k < BASE_ROWS; k++) if (naiveNode(k, S) !== naiveNode(k, S + 1)) naiveMoved++;
  for (const id of insertedIds) if (naiveNode(id, S) !== naiveNode(id, S + 1)) naiveMoved++;
  const naiveMovePct = pct(naiveMoved, totalRows);

  const frames: Frame[] = [];
  const base = {
    nodes: S,
    slotNode: initialMap,
    moving: [] as number[],
    movedRows: 0,
    totalRows,
    naiveMovePct,
    hotSlot,
    salted: false,
  };
  const push = (f: Partial<Frame> & { phase: Phase; caption: string; slotLoad: number[]; slotRows: number[]; totalOps: number }) => {
    const map = f.slotNode ?? base.slotNode;
    const nodes = f.nodes ?? base.nodes;
    frames.push({ ...base, ...f, slotNode: [...map], nodes, nodeLoad: nodeLoads(f.slotLoad, map, nodes) });
  };

  const wlText =
    workload === 'celebrity'
      ? `${skew}% of operations are likes on one celebrity post (key ${CELEB}); the rest hit random keys`
      : `${skew}% of operations insert new rows with increasing ids (≥ ${BASE_ROWS}); the rest update random old rows`;
  const stratText = strategy === 'hash' ? `hash(key) → one of ${LOGICAL} logical shards` : `key ranges of ${RANGE_WIDTH} ids → ${LOGICAL} logical shards (the last range is open-ended)`;
  const initialRows = new Array(LOGICAL).fill(0);
  for (let k = 0; k < BASE_ROWS; k++) initialRows[slotOf(k)]++;

  push({
    phase: 'intro',
    slotLoad: new Array(LOGICAL).fill(0),
    slotRows: initialRows,
    totalOps: 0,
    caption: `${S} nodes, ${BASE_ROWS.toLocaleString('en-US')} rows, ${stratText}. Workload: ${wlText}.`,
    predict: `With ${strategy} sharding, will this workload spread evenly over the ${S} nodes? Which node gets hot, if any?`,
  });

  // ---- load phase ----
  const rowsAt = (n: number) => {
    const rows = [...initialRows];
    ops.slice(0, n).forEach((o) => o.insert && rows[slotOf(o.key)]++);
    return rows;
  };
  for (let b = 1; b <= BATCHES; b++) {
    const n = b * OPS_PER_BATCH;
    const sl = loadFor(n, 'plain');
    const nl = nodeLoads(sl, initialMap, S);
    const top = nl.indexOf(Math.max(...nl));
    const share = pct(nl[top], n);
    const fair = pct(1, S);
    let caption = `Batch ${b}: ${n} ops so far. Busiest node N${top + 1} has ${share}% of the traffic (fair share ${fair}%).`;
    if (b === 1) {
      caption +=
        workload === 'celebrity'
          ? ` Every like on key ${CELEB} lands on logical shard L${hotSlot + 1}, whatever the strategy: the key is atomic.`
          : strategy === 'range'
            ? ` Every new id is larger than the last, so every insert lands in the last range L${LOGICAL}.`
            : ` Hashing scatters the increasing ids across all logical shards.`;
    }
    push({ phase: 'load', slotLoad: sl, slotRows: rowsAt(n), totalOps: n, caption });
  }

  const plainLoad = loadFor(ops.length, 'plain');
  const nl0 = nodeLoads(plainLoad, initialMap, S);
  const hotNode = nl0.indexOf(Math.max(...nl0));
  const hotShare = pct(nl0[hotNode], ops.length);
  const isHot = hotShare >= Math.round(150 / S);
  push({
    phase: 'summary',
    slotLoad: plainLoad,
    slotRows: finalRows,
    totalOps: ops.length,
    caption: isHot
      ? `Hot shard: N${hotNode + 1} serves ${hotShare}% of all ops vs a fair ${pct(1, S)}%. ${workload === 'celebrity' ? 'Hashing spreads keys evenly, not traffic.' : 'A monotonic key under range sharding makes the newest range the only one that takes writes.'}`
      : `Load is roughly even: the busiest node serves ${hotShare}% vs a fair ${pct(1, S)}%. ${workload === 'time' && strategy === 'hash' ? 'The price: "latest 20 inserts" is now a scatter-gather across all nodes.' : 'Raise the skew to create a hotspot.'}`,
  });

  // ---- resharding: add node S (0-based), move whole logical shards ----
  const newNode = S;
  const want = Math.max(1, Math.floor(LOGICAL / (S + 1)));
  const counts = new Array(S).fill(0);
  initialMap.forEach((n) => counts[n]++);
  const moving: number[] = [];
  // rebalance by load: the hottest logical shard first, then from the nodes with the most load/slots
  const bySlotLoad = [...Array(LOGICAL).keys()].sort((a, b) => plainLoad[b] - plainLoad[a]);
  moving.push(bySlotLoad[0]);
  counts[initialMap[bySlotLoad[0]]]--;
  // a hot shard is isolated on the new node by itself; otherwise take an even share of shards
  while (!isHot && moving.length < want) {
    const donor = counts.indexOf(Math.max(...counts));
    const cand = bySlotLoad.find((s) => initialMap[s] === donor && !moving.includes(s));
    if (cand === undefined) break;
    moving.push(cand);
    counts[donor]--;
  }
  const movedRows = moving.reduce((a, s) => a + finalRows[s], 0);
  const newMap = initialMap.map((n, s) => (moving.includes(s) ? newNode : n));

  push({
    phase: 'plan',
    slotLoad: plainLoad,
    slotRows: finalRows,
    totalOps: ops.length,
    nodes: S + 1,
    caption: `Add node N${S + 1}. A naive ${strategy === 'hash' ? `hash % ${S + 1}` : `re-cut into ${S + 1} equal ranges`} would move ${naiveMovePct}% of all rows. With logical shards we move whole shards instead: ${isHot ? `isolate the hottest, L${moving[0] + 1}, on the new node (rebalance by load, not row count)` : `${moving.length} shards, an even share`}.`,
    predict: `What fraction of the ${totalRows.toLocaleString('en-US')} rows has to be copied, and will moving the hottest shard cool things down?`,
  });
  push({
    phase: 'copy',
    slotLoad: plainLoad,
    slotRows: finalRows,
    totalOps: ops.length,
    nodes: S + 1,
    moving,
    movedRows,
    caption: `Copy ${moving.map((s) => `L${s + 1}`).join(', ')} to N${S + 1}: snapshot, then stream changes (CDC) until the lag is ≈ 0. That is ${movedRows.toLocaleString('en-US')} rows (${pct(movedRows, totalRows)}%) vs ${naiveMovePct}% for the naive rehash. No key is rehashed.`,
  });

  const nl1 = nodeLoads(plainLoad, newMap, S + 1);
  const top1 = nl1.indexOf(Math.max(...nl1));
  const share1 = pct(nl1[top1], ops.length);
  const stillHot = isHot && newMap[hotSlot] === top1 && share1 >= Math.round(150 / (S + 1));
  push({
    phase: 'cutover',
    slotLoad: plainLoad,
    slotRows: finalRows,
    totalOps: ops.length,
    nodes: S + 1,
    slotNode: newMap,
    moving,
    movedRows,
    caption: `Cutover: briefly fence writes to the moving shards, verify counts, flip the logical → physical map. Replaying the workload, the busiest node is now N${top1 + 1} at ${share1}% (was ${hotShare}%).${
      stillHot
        ? workload === 'celebrity'
          ? ' The celebrity key moved with its shard: the hotspot moved, it did not shrink.'
          : strategy === 'range'
            ? ' The open-ended last range moved, and the insert hotspot moved with it.'
            : ''
        : ''
    }`,
    predict:
      stillHot
        ? workload === 'celebrity'
          ? `Splitting shards cannot split one key. What change spreads the likes on key ${CELEB}?`
          : `Moving or splitting the last range keeps every new id in one place. What change spreads the inserts?`
        : undefined,
  });

  // ---- the real fix: spread the hot key/tail, then even out logical shards per node ----
  const fixMap = [...newMap];
  const rebalanced: number[] = [];
  if (isHot) {
    const cnt = new Array(S + 1).fill(0);
    fixMap.forEach((n) => cnt[n]++);
    for (;;) {
      const hi = cnt.indexOf(Math.max(...cnt));
      const lo = cnt.indexOf(Math.min(...cnt));
      if (cnt[hi] - cnt[lo] <= 1) break;
      const slot = fixMap.lastIndexOf(hi);
      fixMap[slot] = lo;
      cnt[hi]--;
      cnt[lo]++;
      rebalanced.push(slot);
    }
  }
  const rebalancedRows = rebalanced.reduce((a, s) => a + finalRows[s], 0);
  const rebalanceText = rebalanced.length
    ? ` With the hotspot gone, ${rebalanced.length} more logical shard${rebalanced.length > 1 ? 's' : ''} (${pct(rebalancedRows, totalRows)}% of rows) move so every node owns ${Math.floor(LOGICAL / (S + 1))}–${Math.ceil(LOGICAL / (S + 1))}.`
    : '';
  if (workload === 'celebrity') {
    const sl = loadFor(ops.length, 'salted');
    const nl2 = nodeLoads(sl, fixMap, S + 1);
    const top2 = nl2.indexOf(Math.max(...nl2));
    push({
      phase: 'fix',
      slotLoad: sl,
      slotRows: finalRows,
      totalOps: ops.length,
      nodes: S + 1,
      slotNode: fixMap,
      moving: rebalanced,
      movedRows: rebalancedRows,
      salted: true,
      caption: `Key salting: write each like to one of ${SALTS} sub-counters ${CELEB}#0..#${SALTS - 1} (salts picked so the sub-keys cover every logical shard).${rebalanceText} Busiest node: N${top2 + 1} at ${pct(nl2[top2], ops.length)}%. Reads now sum ${SALTS} sub-counters, or a rollup job does.`,
    });
  } else {
    const sl = loadFor(ops.length, strategy === 'range' ? 'prefixed' : 'plain');
    const nl2 = nodeLoads(sl, fixMap, S + 1);
    const top2 = nl2.indexOf(Math.max(...nl2));
    push({
      phase: 'fix',
      slotLoad: sl,
      slotRows: strategy === 'range' ? rowsBySlot(true) : finalRows,
      totalOps: ops.length,
      nodes: S + 1,
      slotNode: fixMap,
      moving: rebalanced,
      movedRows: rebalancedRows,
      salted: strategy === 'range',
      caption:
        strategy === 'range'
          ? `Hash-prefix the key (or switch the table to hash sharding): new ids scatter across all shards.${rebalanceText} Busiest node: N${top2 + 1} at ${pct(nl2[top2], ops.length)}%. The cost: "rows from the last hour" becomes a scatter-gather.`
          : `Nothing to fix for writes: hashing already spread the inserts (busiest node ${pct(nl2[top2], ops.length)}%). The trade-off is reads: time-range queries hit every shard.`,
    });
  }

  push({
    phase: 'wrap',
    slotLoad: frames[frames.length - 1].slotLoad,
    slotRows: frames[frames.length - 1].slotRows,
    totalOps: ops.length,
    nodes: S + 1,
    slotNode: fixMap,
    salted: frames[frames.length - 1].salted,
    caption: `Takeaways: a hot KEY needs caching, salting or batching; a hot SHARD is fixed by moving logical shards (by load, not row count). Logical shards make resharding a copy of ${pct(movedRows, totalRows)}% of the data instead of ${naiveMovePct}%.`,
  });

  return frames;
}
