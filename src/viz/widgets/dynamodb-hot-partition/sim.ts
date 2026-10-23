// Pure model of DynamoDB write capacity per partition with one viral key.
// Keys hash into [0, 1); each partition owns a hash range and can serve at most 1,000 WCU.
// Story: spread traffic → viral key → throttling despite table headroom → burst capacity buys
// seconds → adaptive capacity isolates the key on its own partition (still capped) → write
// sharding (key#0..N-1) spreads it → reads now scatter-gather N items.
import type { BaseFrame } from '../../core';

export const PART_WCU = 1000;
export const START_PARTITIONS = 4;
export const BG_KEYS = 24;
export const BG_WRITES = 30; // writes/s per background key
export const BURST_SECONDS = 300;
export const HOT_KEY = 'ITEM#viral';

export interface Params {
  /** writes per second on the viral key */
  viral: number;
  /** item size in KB (1 WCU per 1 KB, rounded up) */
  itemKB: number;
  /** write shards used by the fix */
  shards: number;
}

export const wcuPerWrite = (kb: number) => Math.ceil(kb);

/** FNV-1a 32-bit → [0, 1) */
export function hash01(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // final avalanche so similar keys spread
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export interface Partition {
  lo: number;
  hi: number;
  /** true for the partition carved out around a single hot key */
  isolated: boolean;
}

export interface KeyLoad {
  key: string;
  h: number;
  wcu: number;
  hot: boolean;
}

export interface PartLoad {
  demand: number;
  served: number;
  throttled: number;
  keys: number;
}

export function partitionOf(parts: Partition[], h: number): number {
  // an isolated partition owns exactly one hash value and takes precedence
  const iso = parts.findIndex((p) => p.isolated && p.lo === h);
  return iso >= 0 ? iso : parts.findIndex((p) => !p.isolated && h >= p.lo && h < p.hi);
}

export function loads(parts: Partition[], keys: KeyLoad[]): PartLoad[] {
  const out = parts.map(() => ({ demand: 0, served: 0, throttled: 0, keys: 0 }));
  for (const k of keys) {
    const p = out[partitionOf(parts, k.h)];
    p.demand += k.wcu;
    p.keys++;
  }
  for (const p of out) {
    p.served = Math.min(PART_WCU, p.demand);
    p.throttled = p.demand - p.served;
  }
  return out;
}

export function evenPartitions(n: number): Partition[] {
  return Array.from({ length: n }, (_, i) => ({ lo: i / n, hi: (i + 1) / n, isolated: false }));
}

export type Phase = 'table' | 'normal' | 'viral' | 'burst' | 'adaptive' | 'sharded' | 'reads';

export interface Frame extends BaseFrame {
  phase: Phase;
  parts: Partition[];
  keys: KeyLoad[];
  loads: PartLoad[];
  tableWcu: number;
  usedWcu: number;
  throttled: number;
  /** seconds burst capacity can cover the excess (Infinity if none) */
  burstSeconds: number | null;
}

/** background: user keys writing 1 KB items (1 WCU each) */
export function backgroundKeys(): KeyLoad[] {
  return Array.from({ length: BG_KEYS }, (_, i) => {
    const key = `USER#${1000 + i * 37}`;
    return { key, h: hash01(key), wcu: BG_WRITES, hot: false };
  });
}

export function simulate(p: Params): Frame[] {
  const wcu = wcuPerWrite(p.itemKB);
  const frames: Frame[] = [];
  const bg = backgroundKeys();
  const hot: KeyLoad = { key: HOT_KEY, h: hash01(HOT_KEY), wcu: p.viral * wcu, hot: true };
  let parts = evenPartitions(START_PARTITIONS);
  const tableWcu = PART_WCU * START_PARTITIONS;
  const push = (phase: Phase, keys: KeyLoad[], caption: string, extra: Partial<Frame> = {}) => {
    const ls = loads(parts, keys);
    frames.push({
      caption,
      phase,
      parts: parts.map((x) => ({ ...x })),
      keys: keys.map((k) => ({ ...k })),
      loads: ls,
      tableWcu,
      usedWcu: ls.reduce((s, l) => s + l.served, 0),
      throttled: ls.reduce((s, l) => s + l.throttled, 0),
      burstSeconds: null,
      ...extra,
    });
  };

  push(
    'table',
    bg.map((k) => ({ ...k, wcu: 0 })),
    `Table provisioned at ${tableWcu.toLocaleString('en-US')} WCU = ${START_PARTITIONS} partitions × ${PART_WCU.toLocaleString('en-US')} WCU. hash(partition key) picks the partition. The viral item is ${p.itemKB} KB, so each of its writes costs ceil(${p.itemKB} / 1) = ${wcu} WCU (user items are 1 KB = 1 WCU).`,
    { predict: `A viral item gets ${p.viral.toLocaleString('en-US')} writes/s = ${(p.viral * wcu).toLocaleString('en-US')} WCU. The table has ${tableWcu.toLocaleString('en-US')} WCU. Will it throttle?` },
  );
  push('normal', bg, `${BG_KEYS} user keys × ${BG_WRITES} writes/s × 1 WCU = ${(BG_KEYS * BG_WRITES).toLocaleString('en-US')} WCU, spread by the hash. High-cardinality keys: every partition well under ${PART_WCU.toLocaleString('en-US')}.`);

  const all = [...bg, hot];
  const lsV = loads(parts, all);
  const hp = partitionOf(parts, hot.h);
  const used = lsV.reduce((s, l) => s + l.served, 0);
  push(
    'viral',
    all,
    lsV[hp].throttled > 0
      ? `${HOT_KEY} lands on partition ${hp + 1}: demand ${lsV[hp].demand.toLocaleString('en-US')} WCU vs a ${PART_WCU.toLocaleString('en-US')} WCU ceiling → ${lsV[hp].throttled.toLocaleString('en-US')} WCU/s throttled, while the table uses only ${used.toLocaleString('en-US')} of ${tableWcu.toLocaleString('en-US')}. ThrottledRequests with table headroom is the hot-partition signature.`
      : `${HOT_KEY} lands on partition ${hp + 1}: ${lsV[hp].demand.toLocaleString('en-US')} WCU, still under ${PART_WCU.toLocaleString('en-US')}. No throttling at this rate; push the slider up.`,
  );

  const excess = lsV[hp].throttled;
  const bgOnHot = lsV[hp].demand - hot.wcu;
  const bank = Math.max(0, PART_WCU - bgOnHot) * BURST_SECONDS; // unused WCU·s banked over 5 minutes before the spike
  const burstSecs = excess > 0 ? bank / excess : null;
  if (excess > 0) {
    push(
      'burst',
      all,
      `Burst capacity: partition ${hp + 1} banked its unused capacity for up to ${BURST_SECONDS} s (≈ ${bank.toLocaleString('en-US')} WCU·s). At ${excess.toLocaleString('en-US')} excess WCU/s that hides the problem for ~${Math.round(burstSecs!)} s, then throttling starts. AWS may also spend burst on background work: never plan on it.`,
      { burstSeconds: burstSecs },
    );
  }

  // adaptive capacity: split for heat → the hot key gets a partition of its own
  const old = parts[hp];
  parts = [...parts.slice(0, hp), { lo: old.lo, hi: old.hi, isolated: false }, { lo: hot.h, hi: hot.h, isolated: true }, ...parts.slice(hp + 1)];
  const lsA = loads(parts, all);
  const iso = parts.findIndex((x) => x.isolated);
  push(
    'adaptive',
    all,
    lsA[iso].throttled > 0
      ? `Adaptive capacity isolates ${HOT_KEY} on its own partition, so the user keys stop suffering. But one key can never exceed ${PART_WCU.toLocaleString('en-US')} WCU: still ${lsA[iso].throttled.toLocaleString('en-US')} WCU/s throttled. The key design has to change.`
      : `Adaptive capacity isolates ${HOT_KEY} on its own partition (${lsA[iso].demand.toLocaleString('en-US')} WCU, under the ${PART_WCU.toLocaleString('en-US')} per-key ceiling). Throttling stops, but the next spike above ${(PART_WCU / wcu).toLocaleString('en-US')} writes/s would bring it back.`,
  );

  // write sharding: key#0..N-1, writes spread evenly (random suffix)
  parts = parts.filter((x) => !x.isolated);
  const shardKeys: KeyLoad[] = Array.from({ length: p.shards }, (_, i) => {
    const key = `${HOT_KEY}#${i}`;
    return { key, h: hash01(key), wcu: (p.viral * wcu) / p.shards, hot: true };
  });
  const lsS = loads(parts, [...bg, ...shardKeys]);
  const maxPart = Math.max(...lsS.map((l) => l.demand));
  const totalDemand = lsS.reduce((s, l) => s + l.demand, 0);
  const thr = lsS.reduce((s, l) => s + l.throttled, 0);
  push(
    'sharded',
    [...bg, ...shardKeys],
    `Write sharding: write to ${HOT_KEY}#0…#${p.shards - 1} (random suffix). Each shard key gets ${Math.round((p.viral * wcu) / p.shards).toLocaleString('en-US')} WCU and they hash to ${new Set(shardKeys.map((k) => partitionOf(parts, k.h))).size} of ${parts.length} partitions. Busiest partition now ${Math.round(maxPart).toLocaleString('en-US')} WCU` +
      (thr <= 0
        ? `, nothing throttled.`
        : totalDemand > tableWcu
          ? `, still ${Math.round(thr).toLocaleString('en-US')} WCU/s throttled: total demand ${Math.round(totalDemand).toLocaleString('en-US')} WCU exceeds the table's ${tableWcu.toLocaleString('en-US')}. Sharding spreads load, it does not create capacity: raise WCU or use on-demand.`
          : `, still ${Math.round(thr).toLocaleString('en-US')} WCU/s throttled: shards hashed unevenly, add more shards until every partition fits.`),
  );
  push(
    'reads',
    [...bg, ...shardKeys],
    `The price: reading the viral item's total is now a scatter-gather of ${p.shards} GetItems (${p.shards} × 0.5 RCU eventually consistent for ≤ 4 KB) and a sum in the app. For a counter, also consider buffering increments in the service and flushing one ADD per second.`,
  );
  return frames;
}
