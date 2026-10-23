// Pure, deterministic model of one Kafka partition replicated to three brokers (RF = 3).
//   • The leader appends; followers fetch from it like consumers.
//   • ISR = replicas caught up within replica.lag.time.max.ms. HW (high watermark) = the smallest
//     log end offset (LEO) across the ISR; a message is committed (and visible to consumers) below HW.
//   • acks=1: the leader acks as soon as it has written. acks=all: the leader acks once every ISR
//     member has the message (HW has passed it), and refuses the write with NotEnoughReplicas when
//     the ISR is smaller than min.insync.replicas (that setting is ignored for acks=1).
//   • unclean.leader.election.enable=false: only an ISR member may become leader.
//   • A restarted replica truncates any divergent tail back to the common prefix with the leader.
import type { BaseFrame } from '../../core';

export type Acks = '1' | 'all';

export interface Params {
  acks: Acks;
  minIsr: 1 | 2;
}

export const DEFAULT_PARAMS: Params = { acks: 'all', minIsr: 2 };

export const BROKERS = ['B1', 'B2', 'B3'] as const;

export interface ReplicaView {
  id: string;
  log: string[];
  alive: boolean;
  isr: boolean;
  leader: boolean;
}

export type EventKind = 'intro' | 'produce' | 'fetch' | 'shrink' | 'crash' | 'reject' | 'expand' | 'truncate' | 'summary';

export interface Frame extends BaseFrame {
  replicas: ReplicaView[];
  hw: number;
  acked: string[];
  /** acknowledged to the producer but no longer in the leader's log */
  lost: string[];
  /** written but waiting for the ISR (acks=all) */
  pending: string[];
  /** a write the broker refused in this step */
  refused: string | null;
  event: EventKind;
  /** replicas (by index) that just copied data from the leader */
  fetchers: number[];
  /** cells that changed in this step: [replica, offset] */
  fresh: [number, number][];
  /** cells removed by truncation in this step: [replica, label] */
  truncated: [number, string][];
}

interface Replica {
  log: string[];
  alive: boolean;
  isr: boolean;
}

export function simulate({ acks, minIsr }: Params): Frame[] {
  const reps: Replica[] = BROKERS.map(() => ({ log: [], alive: true, isr: true }));
  let leader = 0;
  let hw = 0;
  const acked: string[] = [];
  let pending: { msg: string; offset: number }[] = [];
  let retry: string | null = null;
  let next = 0;
  const frames: Frame[] = [];
  const all = acks === 'all';

  const recomputeHw = () => {
    const isr = reps.filter((r) => r.alive && r.isr);
    hw = Math.min(...isr.map((r) => r.log.length));
    // acks=all: everything below HW is now on every ISR member → acknowledge
    const done = pending.filter((p) => p.offset < hw);
    for (const p of done) acked.push(p.msg);
    pending = pending.filter((p) => p.offset >= hw);
    return done.map((p) => p.msg);
  };

  const lostNow = () => acked.filter((m) => !reps[leader].log.includes(m));

  const push = (
    event: EventKind,
    caption: string,
    extra: { fetchers?: number[]; fresh?: [number, number][]; truncated?: [number, string][]; refused?: string | null; predict?: string } = {},
  ) => {
    frames.push({
      caption,
      predict: extra.predict,
      replicas: reps.map((r, i) => ({ id: BROKERS[i], log: [...r.log], alive: r.alive, isr: r.isr, leader: i === leader })),
      hw,
      acked: [...acked],
      lost: lostNow(),
      pending: pending.map((p) => p.msg),
      refused: extra.refused ?? null,
      event,
      fetchers: extra.fetchers ?? [],
      fresh: extra.fresh ?? [],
      truncated: extra.truncated ?? [],
    });
  };

  /** returns the offset written, or null when refused */
  const produce = (msg: string): number | null => {
    const isrSize = reps.filter((r) => r.alive && r.isr).length;
    if (all && isrSize < minIsr) return null;
    const log = reps[leader].log;
    log.push(msg);
    const offset = log.length - 1;
    if (all) pending.push({ msg, offset });
    else acked.push(msg);
    // an ISR of just the leader commits immediately
    recomputeHw();
    return offset;
  };

  const fetch = (i: number): [number, number][] => {
    const src = reps[leader].log;
    const dst = reps[i].log;
    const fresh: [number, number][] = [];
    for (let o = dst.length; o < src.length; o++) {
      dst.push(src[o]);
      fresh.push([i, o]);
    }
    return fresh;
  };

  const ackWord = all ? 'acks=all' : 'acks=1';

  push(
    'intro',
    `Partition 0 has RF = 3: leader B1, followers B2 and B3, all in the ISR. The producer uses ${ackWord}${all ? ` with min.insync.replicas = ${minIsr}` : ''}. Consumers may only read below the high watermark (HW).`,
  );

  // 1. produce m0, m1
  const m0 = `m${next++}`;
  const m1 = `m${next++}`;
  produce(m0);
  produce(m1);
  push(
    'produce',
    all
      ? `The producer sends ${m0} and ${m1}. Only the leader has them, so with acks=all it holds the acks until every ISR member copies them.`
      : `The producer sends ${m0} and ${m1}. With acks=1 the leader acknowledges as soon as it has written them, before any follower has a copy.`,
    { fresh: [[0, 0], [0, 1]] },
  );

  // 2. followers fetch
  const f2 = [...fetch(1), ...fetch(2)];
  const done2 = recomputeHw();
  push(
    'fetch',
    `B2 and B3 fetch from the leader. Every ISR member now has offsets 0–1, so HW moves to ${hw}: ${m0} and ${m1} are committed and consumers can read them.${done2.length ? ` The leader now sends the acks for ${done2.join(', ')}.` : ''}`,
    { fetchers: [1, 2], fresh: f2 },
  );

  // 3. B3 falls behind
  const m2 = `m${next++}`;
  produce(m2);
  const f3 = fetch(1);
  recomputeHw();
  push(
    'fetch',
    `B3's network slows down. The producer sends ${m2}; B2 copies it but B3 does not. B3 is still in the ISR, so HW stays at ${hw}${all ? ` and the ack for ${m2} waits` : ''}: one slow ISR member holds back commits.`,
    {
      fetchers: [1],
      fresh: [[0, 2], ...f3],
      predict: 'B3 stays behind for longer than replica.lag.time.max.ms (30 s by default). What does the leader do?',
    },
  );

  // 4. shrink ISR
  reps[2].isr = false;
  const done4 = recomputeHw();
  push(
    'shrink',
    `B3 has lagged longer than replica.lag.time.max.ms, so the leader removes it from the ISR. The ISR is now {B1, B2} and HW jumps to ${hw}.${done4.length ? ` ${done4.join(', ')} is committed and acknowledged.` : ` ${m2} is committed.`}`,
  );

  // 5. produce m3, B2 fetches
  const m3 = `m${next++}`;
  produce(m3);
  const f5 = fetch(1);
  const done5 = recomputeHw();
  push(
    'fetch',
    `${m3} is written by the leader and copied by B2, so the whole ISR has it: HW = ${hw}.${done5.length ? ` Ack sent for ${done5.join(', ')}.` : ''}`,
    { fetchers: [1], fresh: [[0, 3], ...f5] },
  );

  // 6. produce m4 on the leader only
  const m4 = `m${next++}`;
  produce(m4);
  push(
    'produce',
    all
      ? `The producer sends ${m4}. The leader writes it at offset 4, but B2 has not fetched yet, so with acks=all there is no ack yet.`
      : `The producer sends ${m4}. The leader writes it at offset 4 and, with acks=1, acknowledges it immediately. The producer now believes ${m4} is safe.`,
    { fresh: [[0, 4]], predict: `The leader B1 crashes before B2 fetches ${m4}. Is ${m4} lost?` },
  );

  // 7. leader crash + election
  reps[0].alive = false;
  reps[0].isr = false;
  leader = 1;
  const orphaned = pending.map((p) => p.msg);
  pending = [];
  recomputeHw();
  const lost7 = lostNow();
  push(
    'crash',
    all
      ? `B1 crashes. The controller elects B2, the only live ISR member (B3 is out of sync and unclean leader election is off). B2's log ends at offset 3, so ${orphaned.join(', ') || m4} was never committed. It was also never acknowledged, so the producer times out and will retry it. No acked data is lost.`
      : `B1 crashes. The controller elects B2, the only live ISR member (B3 is out of sync and unclean leader election is off). B2's log ends at offset 3, so ${lost7.join(', ')} is gone even though the producer got an ack for it: acks=1 lost an acknowledged write.`,
    { predict: all ? `The ISR is now just {B2}. Will B2 accept the producer's retry of ${m4}?` : undefined },
  );

  // 8. first write after failover
  if (all) {
    retry = m4;
    const isrSize = reps.filter((r) => r.alive && r.isr).length;
    const off = produce(m4);
    if (off === null) {
      push(
        'reject',
        `The producer retries ${m4} on B2. The ISR has ${isrSize} member but min.insync.replicas = ${minIsr}, so B2 answers NotEnoughReplicas and writes nothing. The partition loses write availability instead of risking an acked write that exists on only one disk.`,
        { refused: m4 },
      );
    } else {
      retry = null;
      push(
        'produce',
        `The producer retries ${m4} on B2. min.insync.replicas = 1 and the ISR is {B2}, so the write is accepted and HW moves to ${hw} at once: ${m4} is acknowledged with a single copy. If B2 dies now, that ack is lost.`,
        { fresh: [[1, off]] },
      );
    }
  } else {
    const m5 = `m${next++}`;
    const off = produce(m5)!;
    push(
      'produce',
      `The producer moves on and sends ${m5} to the new leader B2. With acks=1 min.insync.replicas does not apply, so B2 accepts it at offset ${off} (the offset that ${m4} had on the old leader).`,
      { fresh: [[1, off]] },
    );
  }

  // 9. B3 catches up and rejoins
  const f9 = fetch(2);
  reps[2].isr = true;
  const done9 = recomputeHw();
  push(
    'expand',
    `B3's network recovers. It fetches from the new leader B2, reaches B2's log end and rejoins the ISR {B2, B3}. HW = ${hw}.${done9.length ? ` Ack sent for ${done9.join(', ')}.` : ''}`,
    { fetchers: [2], fresh: f9 },
  );

  // 10. B1 restarts: truncate divergent tail, catch up, rejoin
  const old = reps[0].log;
  const lead = reps[leader].log;
  let common = 0;
  while (common < old.length && common < lead.length && old[common] === lead[common]) common++;
  const cut: [number, string][] = old.slice(common).map((m) => [0, m]);
  reps[0].log = old.slice(0, common);
  reps[0].alive = true;
  const f10 = fetch(0);
  reps[0].isr = true;
  recomputeHw();
  push(
    'truncate',
    cut.length
      ? `B1 restarts as a follower. Its offset ${common} holds ${cut.map((c) => c[1]).join(', ')}, which the new leader never had, so B1 truncates that divergent tail, fetches from B2 and rejoins the ISR.`
      : `B1 restarts as a follower, fetches what it missed from B2 and rejoins the ISR.`,
    { fetchers: [0], fresh: f10, truncated: cut },
  );

  // 11. retry (if still pending) or a normal write, fully replicated
  const msg = retry ?? `m${next++}`;
  const off = produce(msg)!;
  const f11 = [...fetch(0), ...fetch(2)];
  const done11 = recomputeHw();
  push(
    'fetch',
    retry
      ? `With three replicas back in the ISR, the producer's retry of ${msg} is accepted, copied by B1 and B3, and acknowledged once HW passes offset ${off}. The idempotent producer's sequence number means a duplicate retry would be dropped.`
      : `Normal service: ${msg} is written by B2, fetched by B1 and B3, and committed at HW = ${hw}.${done11.length ? ` Ack sent for ${done11.join(', ')}.` : ''}`,
    { fetchers: [0, 2], fresh: [[1, off], ...f11] },
  );
  retry = null;

  const lostFinal = lostNow();
  push(
    'summary',
    lostFinal.length
      ? `Result: ${acked.length} acks were sent and ${lostFinal.length} of them (${lostFinal.join(', ')}) is missing from the log. acks=1 trades durability for latency. Use acks=all with min.insync.replicas = 2 when acked data must survive a broker loss.`
      : all && minIsr === 1
        ? `Result: no acked write was lost this time, but one was acknowledged while only B2 had it. min.insync.replicas = 1 keeps the partition writable at the cost of that risk. RF=3, acks=all and min ISR 2 is the usual safe setting.`
        : `Result: every acknowledged message survived the leader crash. The price was one refused write while the ISR was too small. RF=3, acks=all and min.insync.replicas = 2 survive one broker loss without losing acked data.`,
  );

  return frames;
}
