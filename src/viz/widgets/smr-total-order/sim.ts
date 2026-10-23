// Pure, deterministic message-passing simulation of state machine replication.
// Three replicas each hold a "username → owner" map. Two users concurrently claim the name "ana"
// at different replicas. How the replicas order the two claims decides whether they agree:
//  - none:    apply each claim when it arrives (every replica sees a different order)
//  - lamport: Lamport timestamps + "wait until you have heard a later timestamp from every node"
//  - tob:     total order broadcast via a sequencer (R1) that numbers every claim
// One tick = one unit of network time. Link latencies are fixed so the run is reproducible.
import type { BaseFrame } from '../../core';

export type Mode = 'none' | 'lamport' | 'tob';
export type NodeId = 'R1' | 'R2' | 'R3';
export type ClaimId = 'm1' | 'm2';

export interface Params {
  mode: Mode;
  /** R2 is down for the whole run */
  crash: boolean;
}

export const NODES: NodeId[] = ['R1', 'R2', 'R3'];
const IDX: Record<NodeId, number> = { R1: 1, R2: 2, R3: 3 };
const LAT: Record<string, number> = { 'R1-R2': 2, 'R2-R3': 2, 'R1-R3': 4 };
export const latency = (a: NodeId, b: NodeId) => LAT[[a, b].sort().join('-')];

export const CLAIMS: Record<ClaimId, { user: string; origin: NodeId; at: number }> = {
  m1: { user: 'u1', origin: 'R1', at: 0 },
  m2: { user: 'u2', origin: 'R3', at: 1 },
};
export const LEADER: NodeId = 'R1';
export const MAX_T = 14;

export const MODE_LABELS: Record<Mode, string> = {
  none: 'apply on arrival',
  lamport: 'Lamport timestamps',
  tob: 'total order broadcast',
};

export type MsgKind = 'claim' | 'ack' | 'seq';

export interface Msg {
  id: number;
  from: NodeId;
  to: NodeId;
  sendT: number;
  arriveT: number;
  kind: MsgKind;
  claim?: ClaimId;
  /** Lamport timestamp carried by the message */
  ts?: number;
  /** sequence number assigned by the sequencer */
  seq?: number;
  /** dropped: the receiver is down */
  dropped: boolean;
}

export interface Ev {
  t: number;
  node: NodeId;
  kind: 'issue' | 'apply';
  claim: ClaimId;
  /** for apply: did this claim win the name on this replica */
  won?: boolean;
  /** Lamport timestamp of the event (lamport mode) */
  ts?: number;
  seq?: number;
}

export interface NodeView {
  id: NodeId;
  up: boolean;
  clock: number;
  owner: string | null;
  /** claims received but not yet applied, in the order the node will apply them */
  pending: string[];
  applied: ClaimId[];
}

export interface Frame extends BaseFrame {
  t: number;
  msgs: Msg[];
  events: Ev[];
  nodes: Record<NodeId, NodeView>;
  /** what each user was told */
  answers: Partial<Record<ClaimId, { t: number; granted: boolean }>>;
  diverged: boolean;
  stuck: boolean;
}

interface NodeState {
  clock: number;
  owner: string | null;
  applied: ClaimId[];
  /** lamport: pending claims with their timestamps */
  queue: { claim: ClaimId; ts: number; origin: NodeId }[];
  /** lamport: highest (ts, sender) heard from each node */
  heard: Partial<Record<NodeId, number>>;
  /** tob: next sequence number to apply, buffered out-of-order entries */
  nextSeq: number;
  buffer: Map<number, ClaimId>;
}

const lt = (a: [number, NodeId], b: [number, NodeId]) => a[0] < b[0] || (a[0] === b[0] && IDX[a[1]] < IDX[b[1]]);

export function simulate({ mode, crash }: Params): Frame[] {
  const up = (n: NodeId) => !(crash && n === 'R2');
  const fresh = (): NodeState => ({ clock: 0, owner: null, applied: [], queue: [], heard: {}, nextSeq: 1, buffer: new Map() });
  const st: Record<NodeId, NodeState> = { R1: fresh(), R2: fresh(), R3: fresh() };
  const msgs: Msg[] = [];
  const events: Ev[] = [];
  const answers: Frame['answers'] = {};
  let nextId = 1;
  let seqCounter = 0;
  const frames: Frame[] = [];

  const send = (from: NodeId, to: NodeId, t: number, m: Omit<Msg, 'id' | 'from' | 'to' | 'sendT' | 'arriveT' | 'dropped'>) =>
    msgs.push({ id: nextId++, from, to, sendT: t, arriveT: t + latency(from, to), dropped: !up(to), ...m });
  const broadcast = (from: NodeId, t: number, m: Omit<Msg, 'id' | 'from' | 'to' | 'sendT' | 'arriveT' | 'dropped'>) =>
    NODES.filter((n) => n !== from).forEach((n) => send(from, n, t, m));

  const apply = (node: NodeId, claim: ClaimId, t: number, extra: Partial<Ev> = {}) => {
    const s = st[node];
    const user = CLAIMS[claim].user;
    const won = s.owner === null;
    if (won) s.owner = user;
    s.applied.push(claim);
    events.push({ t, node, kind: 'apply', claim, won, ...extra });
    if (CLAIMS[claim].origin === node && !answers[claim]) answers[claim] = { t, granted: s.owner === user };
    return won;
  };

  const notes: string[] = [];
  const tryDeliverLamport = (node: NodeId, t: number) => {
    const s = st[node];
    s.queue.sort((a, b) => (lt([a.ts, a.origin], [b.ts, b.origin]) ? -1 : 1));
    while (s.queue.length) {
      const head = s.queue[0];
      const others = NODES.filter((n) => n !== node);
      // FIFO links + Lamport order: once a node has sent anything stamped later than the head,
      // it can never send an earlier claim, so the head is safe to apply.
      const ready = others.every((n) => s.heard[n] !== undefined && lt([head.ts, head.origin], [s.heard[n]!, n]));
      if (!ready) break;
      s.queue.shift();
      const won = apply(node, head.claim, t, { ts: head.ts });
      notes.push(`${node} applies ${CLAIMS[head.claim].user}'s claim (ts ${head.ts}.${IDX[head.origin]}): ${won ? `"ana" → ${CLAIMS[head.claim].user}` : 'name already taken'}.`);
    }
  };

  frames.push({
    t: -1,
    msgs: [],
    events: [],
    nodes: view(),
    answers: {},
    diverged: false,
    stuck: false,
    caption: `Three replicas of a username registry. u1 claims "ana" at R1 at t=0 and u2 claims it at R3 at t=1, before either has heard of the other: the claims are concurrent. Ordering: ${MODE_LABELS[mode]}.${crash ? ' R2 is down.' : ''} Latency: R1–R2 2, R2–R3 2, R1–R3 4 ticks.`,
  });

  function view(): Record<NodeId, NodeView> {
    return Object.fromEntries(
      NODES.map((n) => {
        const s = st[n];
        const pending =
          mode === 'lamport'
            ? [...s.queue].sort((a, b) => (lt([a.ts, a.origin], [b.ts, b.origin]) ? -1 : 1)).map((q) => CLAIMS[q.claim].user)
            : mode === 'tob'
              ? [...s.buffer.entries()].sort((a, b) => a[0] - b[0]).map(([k]) => `#${k}`)
              : [];
        return [n, { id: n, up: up(n), clock: s.clock, owner: s.owner, pending, applied: [...s.applied] }];
      }),
    ) as Record<NodeId, NodeView>;
  }

  for (let t = 0; t <= MAX_T; t++) {
    notes.length = 0;
    // 1. clients issue their claims
    for (const c of Object.keys(CLAIMS) as ClaimId[]) {
      const cl = CLAIMS[c];
      if (cl.at !== t) continue;
      const node = cl.origin;
      const s = st[node];
      if (mode === 'none') {
        events.push({ t, node, kind: 'issue', claim: c });
        const won = apply(node, c, t);
        broadcast(node, t, { kind: 'claim', claim: c });
        notes.push(`${cl.user} claims "ana" at ${node}, which applies it locally (${won ? 'granted' : 'taken'}) and forwards it.`);
      } else if (mode === 'lamport') {
        s.clock++;
        events.push({ t, node, kind: 'issue', claim: c, ts: s.clock });
        s.queue.push({ claim: c, ts: s.clock, origin: node });
        broadcast(node, t, { kind: 'claim', claim: c, ts: s.clock });
        notes.push(`${cl.user} claims "ana" at ${node}: ${node}'s clock becomes ${s.clock}, the claim is stamped ${s.clock}.${IDX[node]} and broadcast. ${node} may not apply it until it has heard a later timestamp from every other node.`);
      } else {
        events.push({ t, node, kind: 'issue', claim: c });
        if (node === LEADER) {
          const seq = ++seqCounter;
          st[node].buffer.set(seq, c);
          broadcast(node, t, { kind: 'seq', claim: c, seq });
          notes.push(`${cl.user} claims "ana" at ${node}, the sequencer, which numbers it #${seq} and broadcasts it.`);
        } else {
          send(node, LEADER, t, { kind: 'claim', claim: c });
          notes.push(`${cl.user} claims "ana" at ${node}, which forwards it to the sequencer ${LEADER} instead of applying it.`);
        }
      }
    }

    // 2. deliver messages arriving now
    const arriving = msgs.filter((m) => m.arriveT === t && !m.dropped).sort((a, b) => a.sendT - b.sendT || a.id - b.id);
    for (const m of arriving) {
      const s = st[m.to];
      if (mode === 'none') {
        const won = apply(m.to, m.claim!, t);
        notes.push(`${m.to} receives ${CLAIMS[m.claim!].user}'s claim and applies it: ${won ? `"ana" → ${CLAIMS[m.claim!].user}` : 'already taken'}.`);
      } else if (mode === 'lamport') {
        s.clock = Math.max(s.clock, m.ts!) + 1;
        s.heard[m.from] = Math.max(s.heard[m.from] ?? -1, m.ts!);
        if (m.kind === 'claim') {
          s.queue.push({ claim: m.claim!, ts: m.ts!, origin: m.from });
          s.clock++;
          broadcast(m.to, t, { kind: 'ack', ts: s.clock });
          notes.push(`${m.to} receives ${CLAIMS[m.claim!].user}'s claim (ts ${m.ts}.${IDX[m.from]}), sets its clock to max(…, ${m.ts}) + 1 and broadcasts an ack stamped ${s.clock}.`);
        } else {
          notes.push(`${m.to} hears ack ${m.ts} from ${m.from} (clock → ${s.clock}).`);
        }
      } else {
        if (m.kind === 'claim' && m.to === LEADER) {
          const seq = ++seqCounter;
          s.buffer.set(seq, m.claim!);
          broadcast(m.to, t, { kind: 'seq', claim: m.claim, seq });
          notes.push(`Sequencer ${LEADER} receives ${CLAIMS[m.claim!].user}'s claim, numbers it #${seq} and broadcasts it.`);
        } else if (m.kind === 'seq') {
          s.buffer.set(m.seq!, m.claim!);
          notes.push(`${m.to} receives entry #${m.seq} (${CLAIMS[m.claim!].user}).`);
        }
      }
    }

    // 3. apply whatever is now deliverable
    for (const n of NODES) {
      if (!up(n)) continue;
      if (mode === 'lamport') tryDeliverLamport(n, t);
      if (mode === 'tob') {
        const s = st[n];
        while (s.buffer.has(s.nextSeq)) {
          const c = s.buffer.get(s.nextSeq)!;
          s.buffer.delete(s.nextSeq);
          const won = apply(n, c, t, { seq: s.nextSeq });
          notes.push(`${n} applies #${s.nextSeq} (${CLAIMS[c].user}): ${won ? `"ana" → ${CLAIMS[c].user}` : 'already taken'}.`);
          s.nextSeq++;
        }
      }
    }

    const live = NODES.filter(up);
    const owners = live.map((n) => st[n].owner).filter(Boolean);
    const diverged = new Set(owners).size > 1;
    const inFlight = msgs.some((m) => m.arriveT > t && !m.dropped);
    const pendingWork = live.some((n) => st[n].queue.length > 0 || st[n].buffer.size > 0);
    const stuck = !inFlight && pendingWork && t >= 2;
    frames.push({
      t,
      msgs: msgs.filter((m) => m.sendT <= t).map((m) => ({ ...m })),
      events: events.map((e) => ({ ...e })),
      nodes: view(),
      answers: { ...answers },
      diverged,
      stuck,
      caption: `t=${t}: ${notes.join(' ') || 'messages in flight.'}`,
    });
    const allApplied = live.every((n) => st[n].applied.length === 2);
    if ((allApplied && !inFlight) || stuck) break;
  }

  const last = frames[frames.length - 1];
  const live = NODES.filter(up);
  const ownerList = live.map((n) => `${n}: ${st[n].owner ?? '—'}`).join(', ');
  const both = answers.m1?.granted && answers.m2?.granted;
  last.caption += ` Result: ${ownerList}. ${
    last.stuck
      ? `Stuck: ${live.join(' and ')} hold claims they can never apply, because they will never hear a later timestamp from R2. Lamport ordering needs every node, so one crash stops it.`
      : last.diverged
        ? `The replicas disagree, and ${both ? 'BOTH users were told the name is theirs' : 'the users got contradictory answers'}. Each replica applied the claims in arrival order, and arrival order differs per replica.`
        : mode === 'lamport'
          ? `All replicas agree, and u${answers.m1?.granted ? '1' : '2'} won because ${answers.m1?.granted ? '1.1 < 1.3' : 'its timestamp is lower'}. But nobody could answer until it had heard from every node.`
          : `All replicas agree: every replica applied #1 then #2${crash ? ', even with R2 down (a real TOB makes the sequencer fault-tolerant with consensus, which needs only a majority)' : ''}. The first claim to reach the sequencer wins, decided as messages are delivered.`
  }`;

  // predictions
  const firstApplyRemote =
    mode === 'lamport'
      ? frames.findIndex((f) => f.events.some((e) => e.kind === 'apply'))
      : frames.findIndex((f) => f.t >= 1 && f.events.some((e) => e.kind === 'apply' && e.node !== CLAIMS[e.claim].origin));
  if (firstApplyRemote > 1) {
    frames[firstApplyRemote - 1].predict =
      mode === 'none'
        ? 'Each replica will apply both claims, in whatever order they arrive. Will all three end up with the same owner?'
        : mode === 'lamport'
          ? `R1 holds u1's claim stamped 1.1. What must R1 hear before it is allowed to apply it?`
          : 'Entries #1 and #2 reach R3 in order. Can R3 end up with a different owner than R1?';
  }
  if (mode === 'lamport' && crash && frames.length > 3 && !frames[2].predict) frames[2].predict = 'R2 is down and will never send anything. Can any replica ever apply a claim?';
  return frames;
}
