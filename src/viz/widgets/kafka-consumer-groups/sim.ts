// Pure, deterministic simulation of one Kafka topic read by one consumer group.
// Scripted story: produce keyed messages → poll/commit → a consumer joins (rebalance) →
// a consumer crashes before its offsets are committed → the new owner resumes from the
// committed offset (at-least-once) or, with commit-before-process, skips work (at-most-once).
import type { BaseFrame } from '../../core';

export type CommitMode = 'after' | 'before';

export interface Params {
  partitions: number;
  consumers: number;
  commit: CommitMode;
}

export interface LogRecord {
  key: string;
  /** how many times the group has fully processed this record */
  processed: number;
}

export interface PartitionView {
  log: LogRecord[];
  /** committed offset = next offset the group will read after a restart/rebalance */
  committed: number;
  /** owner's in-memory fetch position (≥ committed); equals committed when unowned */
  position: number;
  owner: number | null;
}

export interface ConsumerView {
  id: number;
  alive: boolean;
  partitions: number[];
}

export interface Frame extends BaseFrame {
  partitions: PartitionView[];
  consumers: ConsumerView[];
  /** partitions that just received records (for highlighting) */
  produced: number[];
  /** a rebalance happened in this step */
  rebalance: boolean;
  /** offsets fetched in this step, per partition: [from, to) */
  fetched: [number, number][];
}

const KEYS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy'];
const MAX_POLL = 3;

/** deterministic string hash → partition (Kafka's default partitioner uses murmur2 the same way) */
export function partitionFor(key: string, partitions: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h % partitions;
}

/** range assignor: partitions split into contiguous chunks; extra consumers get nothing */
export function rangeAssign(partitions: number, members: number[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const sorted = [...members].sort((a, b) => a - b);
  const per = Math.floor(partitions / sorted.length);
  const extra = partitions % sorted.length;
  let p = 0;
  sorted.forEach((c, i) => {
    const n = per + (i < extra ? 1 : 0);
    out.set(
      c,
      Array.from({ length: n }, (_, k) => p + k),
    );
    p += n;
  });
  return out;
}

const cname = (c: number) => `C${c + 1}`;
const pname = (p: number) => `P${p}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function simulate({ partitions: P, consumers: C, commit }: Params): Frame[] {
  const parts = Array.from({ length: P }, () => ({ log: [] as LogRecord[], committed: 0, position: 0, owner: null as number | null }));
  const consumers = Array.from({ length: C }, (_, id) => ({ id, alive: true, partitions: [] as number[] }));
  const frames: Frame[] = [];

  const snapshot = (caption: string, extra: Partial<Frame> = {}): Frame => ({
    caption,
    partitions: parts.map((p) => ({ log: p.log.map((r) => ({ ...r })), committed: p.committed, position: p.position, owner: p.owner })),
    consumers: consumers.map((c) => ({ id: c.id, alive: c.alive, partitions: [...c.partitions] })),
    produced: [],
    rebalance: false,
    fetched: [],
    ...extra,
  });

  /** eager rebalance: everyone revokes, the assignor re-deals, positions reset to committed */
  const rebalance = () => {
    const live = consumers.filter((c) => c.alive).map((c) => c.id);
    const before = parts.map((p) => p.owner);
    const a = rangeAssign(P, live);
    consumers.forEach((c) => (c.partitions = a.get(c.id) ?? []));
    parts.forEach((p, i) => {
      p.owner = null;
      p.position = p.committed;
      for (const [c, ps] of a) if (ps.includes(i)) p.owner = c;
    });
    const moved = parts.map((p, i) => (p.owner !== before[i] ? i : -1)).filter((i) => i >= 0);
    const idle = consumers.filter((c) => c.alive && c.partitions.length === 0).map((c) => cname(c.id));
    return { moved, idle };
  };
  const assignmentText = () =>
    consumers
      .filter((c) => c.alive && c.partitions.length)
      .map((c) => `${cname(c.id)}←${c.partitions.map(pname).join('+')}`)
      .join(', ');

  const produce = (keys: string[]) => {
    const touched = new Set<number>();
    for (const k of keys) {
      const p = partitionFor(k, P);
      parts[p].log.push({ key: k, processed: 0 });
      touched.add(p);
    }
    return [...touched];
  };
  const lag = () => parts.reduce((s, p) => s + (p.log.length - p.committed), 0);

  /** owners fetch up to MAX_POLL records from their position */
  const poll = (only?: number) => {
    const fetched: [number, number][] = parts.map(() => [0, 0]);
    parts.forEach((p, i) => {
      if (p.owner === null || (only !== undefined && p.owner !== only)) return;
      const from = p.position;
      const to = Math.min(p.log.length, from + MAX_POLL);
      p.position = to;
      fetched[i] = [from, to];
    });
    return fetched;
  };
  const process = (fetched: [number, number][]) =>
    fetched.forEach(([from, to], i) => {
      for (let o = from; o < to; o++) parts[i].log[o].processed++;
    });
  const commitAll = (only?: number) =>
    parts.forEach((p) => {
      if (p.owner === null || (only !== undefined && p.owner !== only)) return;
      p.committed = Math.max(p.committed, p.position);
    });

  // ---------- 0: initial assignment ----------
  const { idle: idle0 } = rebalance();
  frames.push(
    snapshot(
      `Topic "orders" has ${P} partition${P > 1 ? 's' : ''}; group "billing" has ${C} consumer${C > 1 ? 's' : ''}. The range assignor gives each partition to exactly one member: ${assignmentText()}.` +
        (idle0.length ? ` ${list(idle0)} ${idle0.length > 1 ? 'are' : 'is'} IDLE: there are more consumers than partitions.` : ''),
    ),
  );

  // ---------- 1: produce keyed messages ----------
  const batch1 = KEYS.slice(0, 6);
  const t1 = produce(batch1);
  const aliceP = partitionFor('alice', P);
  frames.push(
    snapshot(
      `Producers write 6 keyed events. partition = hash(key) mod ${P}: ${batch1.map((k) => `${k}→${pname(partitionFor(k, P))}`).join(', ')}. Each partition is an append-only log; offsets count from 0.`,
      {
        produced: t1,
        predict: `alice sends a second event. Which partition does it land in, and why does that matter?`,
      },
    ),
  );
  const batch2 = ['alice', 'bob', 'grace'];
  const t2 = produce(batch2);
  frames.push(
    snapshot(
      `alice’s second event lands in ${pname(aliceP)} again: same key → same partition, so one user’s events stay in order. Total lag is now ${lag()} records (log-end offset − committed offset, summed).`,
      { produced: t2 },
    ),
  );

  // ---------- 2: poll + commit ----------
  let fetched = poll();
  const fetchedN = fetched.reduce((s, [a, b]) => s + b - a, 0);
  if (commit === 'after') {
    process(fetched);
    frames.push(
      snapshot(
        `Each owner polls up to ${MAX_POLL} records from its partitions (${fetchedN} in total) and processes them. Nothing is committed yet, so lag is still ${lag()}: a crash now would replay them.`,
        { fetched },
      ),
    );
    commitAll();
    frames.push(snapshot(`Owners commit offset = last processed + 1. Committed offsets advance; lag drops to ${lag()}.`));
  } else {
    commitAll();
    frames.push(
      snapshot(
        `Each owner polls up to ${MAX_POLL} records (${fetchedN} in total) and commits their offsets BEFORE processing. Lag already reads ${lag()} even though no work is done yet.`,
        { fetched },
      ),
    );
    process(fetched);
    frames.push(snapshot(`They process the fetched records. With commit-before-process, the bookmark always runs ahead of the work.`));
  }
  // drain the rest so the group is caught up before the join
  fetched = poll();
  process(fetched);
  commitAll();
  frames.push(
    snapshot(`Another poll → process → commit loop drains the remaining records. Lag is ${lag()}: the group is caught up.`, {
      fetched,
      predict:
        C + 1 > P
          ? `A new consumer ${cname(C)} joins the group, but there are already ${C} consumers for ${P} partitions. What will ${cname(C)} do?`
          : `A new consumer ${cname(C)} joins the group. What happens to the partition assignment, and to consumption while it changes?`,
    }),
  );

  // ---------- 3: a consumer joins → rebalance ----------
  consumers.push({ id: C, alive: true, partitions: [] });
  const r1 = rebalance();
  frames.push(
    snapshot(
      `${cname(C)} joins → REBALANCE. With the eager protocol every member revokes all partitions (a brief stop-the-world), then the assignor re-deals: ${assignmentText()}.` +
        (r1.idle.length
          ? ` ${list(r1.idle)} ${r1.idle.length > 1 ? 'get' : 'gets'} nothing and sit${r1.idle.length > 1 ? '' : 's'} idle: max useful consumers = partitions = ${P}.`
          : ` ${r1.moved.length} partition${r1.moved.length === 1 ? '' : 's'} changed owner; new owners resume from the committed offset.`),
      { rebalance: true },
    ),
  );

  // ---------- 4: more traffic, consumed under the new assignment ----------
  const t3 = produce(['carol', 'heidi', 'ivan', 'dave']);
  frames.push(snapshot(`4 more events arrive (lag ${lag()}).`, { produced: t3 }));
  fetched = poll();
  process(fetched);
  commitAll();
  frames.push(snapshot(`Owners under the new assignment poll, process and commit. Lag is back to ${lag()}.`, { fetched }));

  // ---------- 5: crash before commit ----------
  const victim = 0; // C1 always owns P0 under the range assignor
  const vParts = consumers[victim].partitions;
  // produce events whose keys land on the victim's partitions
  const victimKeys = KEYS.concat(KEYS.map((k) => k + '2')).filter((k) => vParts.includes(partitionFor(k, P))).slice(0, 3);
  const t4 = produce(victimKeys);
  frames.push(
    snapshot(
      `New events for ${victimKeys.join(', ')} land in ${list(t4.map(pname))}, owned by ${cname(victim)}. Lag ${lag()}.`,
      { produced: t4 },
    ),
  );
  fetched = poll(victim);
  const vf = fetched.map(([a, b], i) => (b > a ? `${pname(i)} offsets ${a}–${b - 1}` : '')).filter(Boolean);
  if (commit === 'after') {
    process(fetched);
    frames.push(
      snapshot(
        `${cname(victim)} polls ${list(vf)} and finishes processing them (e.g. charges the cards). Its commit is due next…`,
        { fetched, predict: `${cname(victim)} crashes before it commits. When its partitions move, where does the new owner start reading?` },
      ),
    );
  } else {
    commitAll(victim);
    frames.push(
      snapshot(`${cname(victim)} polls ${list(vf)} and commits the new offsets first, as commit-before-process does. Processing is next…`, {
        fetched,
        predict: `${cname(victim)} crashes before processing them. When its partitions move, will those records ever be processed?`,
      }),
    );
  }
  consumers[victim].alive = false;
  frames.push(
    snapshot(
      `${cname(victim)} CRASHES. ${commit === 'after' ? 'The work was done but the bookmark never moved.' : 'The bookmark moved but the work was never done.'} Its heartbeats stop; after session.timeout.ms (45 s default) the coordinator evicts it.`,
    ),
  );
  const r2 = rebalance();
  const newOwners = vParts.map((p) => `${pname(p)}→${parts[p].owner === null ? 'nobody' : cname(parts[p].owner!)}`);
  frames.push(
    snapshot(
      `Eviction triggers a REBALANCE: ${list(newOwners)}. ${list(vParts.map((p) => `${pname(p)} resumes from committed offset ${parts[p].committed}`))}.` +
        (r2.idle.length ? ` Idle: ${list(r2.idle)}.` : ''),
      { rebalance: true },
    ),
  );
  fetched = poll();
  process(fetched);
  const dups = parts.reduce((s, p) => s + p.log.filter((r) => r.processed > 1).length, 0);
  commitAll();
  const lost = parts.reduce((s, p) => s + p.log.slice(0, p.committed).filter((r) => r.processed === 0).length, 0);
  // finish any leftovers
  for (let k = 0; k < 4 && lag() > 0; k++) {
    const f2 = poll();
    process(f2);
    commitAll();
  }
  frames.push(
    snapshot(
      commit === 'after'
        ? `The new owner re-reads from the committed offset, so ${dups} record${dups === 1 ? ' is' : 's are'} processed TWICE (×2). That is at-least-once delivery: no loss, but handlers must be idempotent.`
        : `The new owner starts after the committed offset, so ${lost} record${lost === 1 ? ' was' : 's were'} NEVER processed. That is at-most-once delivery: no duplicates, but silent loss — and lag reads 0, so the metric never shows it.`,
      { fetched },
    ),
  );
  frames.push(
    snapshot(
      `Lag is ${lag()} and every partition still has exactly one owner. Commit ${commit === 'after' ? 'after processing → duplicates on crash (the usual default; make handlers idempotent)' : 'before processing → loss on crash (rarely what you want)'}.`,
    ),
  );
  return frames;
}
