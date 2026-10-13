// Pure, deterministic script of Dynamo-style quorum writes and reads (N replicas, W, R).
// Act 1: one replica is down during a write, recovers stale, then a quorum read.
// Act 2: a read-during-write race showing why R + W > N alone is not linearizable.
import type { BaseFrame } from '../../core';

export type Repair = 'off' | 'blocking';

export interface Params {
  n: number;
  w: number;
  r: number;
  /** blocking read repair: write the newest value back to a write quorum before returning */
  repair: Repair;
}

export type ReplicaStatus = 'up' | 'down' | 'slow';

export interface Replica {
  val: string;
  ver: number;
  status: ReplicaStatus;
}

export type MsgKind = 'write' | 'ack' | 'read' | 'reply' | 'repair';

export interface Msg {
  to: number;
  kind: MsgKind;
}

export type Outcome = 'ok' | 'fail' | 'fresh' | 'stale' | 'pending';

export interface Frame extends BaseFrame {
  act: 1 | 2;
  replicas: Replica[];
  msgs: Msg[];
  /** replicas that acknowledged the current write */
  acked: number[];
  /** replicas in the current read set */
  readSet: number[];
  /** who is acting: label shown on the client box */
  client: string;
  outcome?: Outcome;
  /** text shown next to the client, e.g. "read → B (v2)" */
  result?: string;
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const name = (i: number) => `R${i + 1}`;
const names = (xs: number[]) => (xs.length ? xs.map(name).join(', ') : 'none');

export function clampParams(p: Params): Params {
  const n = Math.max(3, Math.min(7, Math.round(p.n)));
  return { n, w: Math.max(1, Math.min(n, Math.round(p.w))), r: Math.max(1, Math.min(n, Math.round(p.r))), repair: p.repair };
}

export function simulate(raw: Params): Frame[] {
  const { n, w, r, repair } = clampParams(raw);
  const frames: Frame[] = [];
  const reps: Replica[] = range(0, n).map(() => ({ val: 'A', ver: 1, status: 'up' as ReplicaStatus }));
  const snap = () => reps.map((x) => ({ ...x }));
  const overlapRule = r + w > n ? `R + W = ${r + w} > N = ${n}: every read set overlaps every write set` : `R + W = ${r + w} ≤ N = ${n}: a read set can miss the write set entirely`;
  const push = (f: Omit<Frame, 'replicas'>) => frames.push({ ...f, replicas: snap() });

  // ---------------- Act 1 ----------------
  push({
    act: 1,
    msgs: [],
    acked: [],
    readSet: [],
    client: 'client',
    caption: `${n} replicas hold key k = "A" (version 1). A write waits for W=${w} acks, a read asks R=${r} replica${r > 1 ? 's' : ''} and keeps the newest version. ${overlapRule}.`,
  });

  const down = n - 1;
  reps[down].status = 'down';
  push({
    act: 1,
    msgs: [],
    acked: [],
    readSet: [],
    client: 'client',
    caption: `${name(down)} crashes. ${n - 1} of ${n} replicas are reachable${w > n - 1 ? `, which is fewer than W=${w}` : ''}.`,
    predict: `The client writes "B" (v2). ${w > n - 1 ? `Only ${n - 1} replicas can ack but W=${w}. What does the client hear, and what is left on the replicas?` : `How many acks does the coordinator wait for before telling the client OK?`}`,
  });

  const live = range(0, n - 1);
  push({
    act: 1,
    msgs: live.map((i) => ({ to: i, kind: 'write' as MsgKind })),
    acked: [],
    readSet: [],
    client: 'writer',
    outcome: 'pending',
    result: 'write "B" v2…',
    caption: `The coordinator sends "B" (v2) to all ${n - 1} reachable replicas. ${name(down)} is down and gets nothing.`,
  });

  const needed = Math.min(w, n - 1);
  const acked: number[] = [];
  for (let k = 0; k < needed; k++) {
    reps[k].val = 'B';
    reps[k].ver = 2;
    acked.push(k);
    push({
      act: 1,
      msgs: [{ to: k, kind: 'ack' }],
      acked: [...acked],
      readSet: [],
      client: 'writer',
      outcome: 'pending',
      result: `acks ${acked.length}/${w}`,
      caption: `${name(k)} stores "B" v2 and acks (${acked.length}/${w}).${acked.length === w ? ' That is a write quorum.' : ''}`,
    });
  }
  const writeOk = w <= n - 1;
  // replicas that were sent the write but have not applied it yet (slow, write still in flight)
  const slow = range(needed, n - 1);
  slow.forEach((i) => (reps[i].status = 'slow'));
  if (writeOk) {
    push({
      act: 1,
      msgs: [],
      acked: [...acked],
      readSet: [],
      client: 'writer',
      outcome: 'ok',
      result: 'write OK',
      caption: `W=${w} acks received, so the client gets OK. ${slow.length ? `${names(slow)} ${slow.length === 1 ? 'is' : 'are'} slow: the write is still in flight to ${slow.length === 1 ? 'it' : 'them'}. ` : ''}Only ${names(acked)} hold "B".`,
    });
  } else {
    push({
      act: 1,
      msgs: [],
      acked: [...acked],
      readSet: [],
      client: 'writer',
      outcome: 'fail',
      result: 'write FAILED',
      caption: `Only ${acked.length} of W=${w} acks can ever arrive, so the client gets an error (W=N trades write availability for read speed). But ${names(acked)} already stored "B": a failed write is not rolled back.`,
    });
  }

  reps[down].status = 'up';
  push({
    act: 1,
    msgs: [],
    acked: [...acked],
    readSet: [],
    client: 'reader',
    caption: `${name(down)} comes back with the old "A" v1 (no hint has been handed off yet). Holding "B" right now: ${names(acked)}.`,
  });

  // read set: the R fastest responders, worst case the replicas furthest from the write set
  const readSet1 = range(n - r, n);
  push({
    act: 1,
    msgs: readSet1.map((i) => ({ to: i, kind: 'read' as MsgKind })),
    acked: [...acked],
    readSet: readSet1,
    client: 'reader',
    outcome: 'pending',
    result: 'read…',
    caption: `A client reads k with R=${r}. Suppose the ${r === 1 ? 'first reply comes' : `first ${r} replies come`} from ${names(readSet1)}${slow.length ? ' (slow writers can still be fast readers)' : ''}.`,
    predict: `Write set: ${names(acked)}. Read set: ${names(readSet1)}. Will the read return "B"?`,
  });
  const overlap1 = readSet1.filter((i) => reps[i].ver === 2);
  const newest1 = overlap1.length ? 'B' : 'A';
  push({
    act: 1,
    msgs: readSet1.map((i) => ({ to: i, kind: 'reply' as MsgKind })),
    acked: [...acked],
    readSet: readSet1,
    client: 'reader',
    outcome: !overlap1.length && writeOk ? 'stale' : 'fresh',
    result: `read → "${newest1}" v${overlap1.length ? 2 : 1}`,
    caption: overlap1.length
      ? `Overlap at ${names(overlap1)}: the replies carry v1 and v2, the coordinator keeps the newest, and the read returns "B".${writeOk ? ` R + W > N guaranteed this overlap.` : ` Note: it returns a value whose write FAILED. Failed writes can surface later.`}`
      : writeOk
        ? `No overlap: every reply is "A" v1, so the client reads STALE data although the write was acknowledged. R + W = ${r + w} ≤ N = ${n}.`
        : `No reply carries v2, so the read returns "A", which is consistent with the failed write.`,
  });

  // background convergence: hinted handoff / anti-entropy
  reps.forEach((x) => {
    x.val = 'B';
    x.ver = 2;
    x.status = 'up';
  });
  push({
    act: 1,
    msgs: [],
    acked: [],
    readSet: [],
    client: 'client',
    caption: `Later, the in-flight writes land and anti-entropy (Merkle-tree repair or hinted handoff) brings every replica to "B" v2. Quorums give overlap; repair gives convergence.`,
  });

  // ---------------- Act 2: read during a write ----------------
  reps[0].val = 'C';
  reps[0].ver = 3;
  range(1, n).forEach((i) => (reps[i].status = 'slow'));
  const writeAlreadyOk = w === 1;
  push({
    act: 2,
    msgs: [{ to: 0, kind: 'write' }, ...range(1, n).map((i) => ({ to: i, kind: 'write' as MsgKind }))],
    acked: [0],
    readSet: [],
    client: 'writer',
    outcome: writeAlreadyOk ? 'ok' : 'pending',
    result: writeAlreadyOk ? 'write OK' : `acks 1/${w}`,
    caption: `Act 2: a writer sends "C" (v3). It has reached ${name(0)} only; the copies to the other replicas are still in flight. ${writeAlreadyOk ? 'With W=1 the writer is already told OK.' : `The write is not yet acknowledged (1/${w}).`}`,
    predict: `Reader 1 now reads R=${r} replica${r > 1 ? 's' : ''} including ${name(0)}, and Reader 2 reads a moment later from ${names(range(n - r, n))}. Can Reader 2 see an OLDER value than Reader 1?`,
  });

  const rs1 = range(0, r);
  push({
    act: 2,
    msgs: rs1.map((i) => ({ to: i, kind: 'reply' as MsgKind })),
    acked: [0],
    readSet: rs1,
    client: 'reader 1',
    outcome: 'pending',
    result: 'sees "C" v3',
    caption: `Reader 1 asks ${names(rs1)}. ${name(0)} replies "C" v3, the newest, so Reader 1 will return "C".${repair === 'blocking' ? '' : ' Read repair is off, so it returns right away and fixes nothing first.'}`,
  });

  let holdersC = reps.filter((x) => x.ver === 3).length;
  if (repair === 'blocking') {
    // write the newest back until a write quorum holds it (ABD-style), then return
    const targets: number[] = [];
    for (let i = 0; i < n && holdersC < w; i++) {
      if (reps[i].ver < 3) {
        reps[i].val = 'C';
        reps[i].ver = 3;
        reps[i].status = 'up';
        targets.push(i);
        holdersC++;
      }
    }
    push({
      act: 2,
      msgs: targets.map((i) => ({ to: i, kind: 'repair' as MsgKind })),
      acked: reps.flatMap((x, i) => (x.ver === 3 ? [i] : [])),
      readSet: rs1,
      client: 'reader 1',
      outcome: 'fresh',
      result: 'returns "C"',
      caption: targets.length
        ? `Blocking read repair: before returning, Reader 1 writes "C" v3 to ${names(targets)} so that W=${w} replicas hold it. Only then does it return "C".`
        : `Blocking read repair: "C" is already on W=${w} replica${w > 1 ? 's' : ''}, so Reader 1 returns "C" at once.`,
    });
  }

  const rs2 = range(n - r, n);
  const seen2 = rs2.some((i) => reps[i].ver === 3);
  const holders = reps.flatMap((x, i) => (x.ver === 3 ? [i] : []));
  push({
    act: 2,
    msgs: rs2.map((i) => ({ to: i, kind: 'reply' as MsgKind })),
    acked: holders,
    readSet: rs2,
    client: 'reader 2',
    outcome: seen2 ? 'fresh' : 'stale',
    result: seen2 ? 'read → "C" v3' : 'read → "B" v2 (older!)',
    caption: seen2
      ? `Reader 2 asks ${names(rs2)} and gets "C" v3 from ${names(rs2.filter((i) => reps[i].ver === 3))}.${repair === 'blocking' && r + w > n ? ' The repaired write quorum overlaps every later read quorum, so once any reader returned "C", every later reader sees it (the ABD idea behind blocking read repair).' : ''}`
      : `Reader 2 asks ${names(rs2)} and gets "B" v2: it started after Reader 1 finished but saw an OLDER value. That new-then-old flip is not linearizable${r + w > n ? `, even with R + W > N. ${repair === 'off' ? 'Blocking read repair fixes it.' : ''}` : `, and R + W ≤ N cannot even promise overlap.`}`,
  });

  reps.forEach((x) => {
    x.val = 'C';
    x.ver = 3;
    x.status = 'up';
  });
  push({
    act: 2,
    msgs: range(1, n).map((i) => ({ to: i, kind: 'ack' as MsgKind })),
    acked: range(0, n),
    readSet: [],
    client: 'writer',
    outcome: 'ok',
    result: 'write OK',
    caption: `The delayed copies finally land and the writer gets OK. Every replica now holds "C" v3${seen2 ? ', and both readers agreed on the order.' : ', but the two readers already disagreed about the order of events.'}`,
    predict: `During a network partition, a sloppy quorum acks the next write on W stand-in nodes OUTSIDE k's home replicas (hinted handoff). Does R + W > N still guarantee a home-replica read sees it?`,
  });

  push({
    act: 2,
    msgs: [],
    acked: [],
    readSet: [],
    client: 'client',
    caption: `No. With sloppy quorums the write set is not among the N home replicas, so the overlap guarantee is gone until hints are handed back. Concurrent writes resolved by last-write-wins with skewed clocks break it too: R + W > N gives overlap, not linearizability.`,
  });

  return frames;
}
