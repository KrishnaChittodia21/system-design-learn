// Reference solution: logical clocks + a deterministic Raft leader-election simulator.

// ---------------------------------------------------------------------------
// Part 1: Lamport clocks
// ---------------------------------------------------------------------------

/**
 * Lamport clock rules:
 *  1. before any local event or send: time += 1
 *  2. a send carries the (already incremented) time
 *  3. on receive(t): time = max(time, t) + 1
 * Guarantees: a → b (happens-before) ⇒ L(a) < L(b). The converse does NOT hold.
 */
export class LamportClock {
  #time = 0;

  get time(): number {
    return this.#time;
  }

  /** A local event. Returns the new time. */
  tick(): number {
    return ++this.#time;
  }

  /** Timestamp to attach to an outgoing message (counts as an event). */
  send(): number {
    return this.tick();
  }

  /** Merge an incoming message's timestamp. Returns the new time. */
  receive(remote: number): number {
    this.#time = Math.max(this.#time, remote) + 1;
    return this.#time;
  }
}

// ---------------------------------------------------------------------------
// Part 2: vector clocks
// ---------------------------------------------------------------------------

/** node id → counter. Missing entries mean 0. */
export type VC = Readonly<Record<string, number>>;

export type Ordering = 'before' | 'after' | 'equal' | 'concurrent';

/** How `a` relates to `b`: before = a happened-before b (a ≤ b pointwise, a ≠ b). */
export function vcCompare(a: VC, b: VC): Ordering {
  let aLess = false;
  let bLess = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (x < y) aLess = true;
    else if (x > y) bLess = true;
  }
  if (aLess && bLess) return 'concurrent';
  if (aLess) return 'before';
  if (bLess) return 'after';
  return 'equal';
}

/** Pointwise max. Returns a new object; inputs are not mutated. */
export function vcMerge(a: VC, b: VC): VC {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

/** Copy of `vc` with `node`'s counter incremented. */
export function vcIncrement(vc: VC, node: string): VC {
  return { ...vc, [node]: (vc[node] ?? 0) + 1 };
}

/** A process's vector clock. */
export class VectorClock {
  #node: string;
  #vc: VC;

  constructor(nodeId: string, initial: VC = {}) {
    this.#node = nodeId;
    this.#vc = { ...initial };
  }

  /** A copy of the current clock. */
  get value(): VC {
    return { ...this.#vc };
  }

  /** Local event: increment own entry. */
  tick(): VC {
    this.#vc = vcIncrement(this.#vc, this.#node);
    return this.value;
  }

  /** Increment and return the clock to attach to a message. */
  send(): VC {
    return this.tick();
  }

  /** Merge the remote clock, then increment own entry. */
  receive(remote: VC): VC {
    this.#vc = vcIncrement(vcMerge(this.#vc, remote), this.#node);
    return this.value;
  }
}

export interface Version<V> {
  value: V;
  clock: VC;
}

/**
 * Dynamo-style multi-version register store. A put carries the context (clock) the
 * client last read. The new version's clock is merge(context) incremented at the
 * coordinator; it replaces every version it dominates. Concurrent versions are kept as
 * **siblings** for the client to reconcile on its next write.
 */
export class VersionedStore<V> {
  #data = new Map<string, Version<V>[]>();

  /** Write `value` with the read context (undefined = blind write). Returns the new version's clock. */
  put(key: string, value: V, context: VC | undefined, coordinator: string): VC {
    const clock = vcIncrement(context ?? {}, coordinator);
    const existing = this.#data.get(key) ?? [];
    // Keep only versions NOT dominated by (before or equal to) the new clock.
    const survivors = existing.filter((v) => {
      const o = vcCompare(v.clock, clock);
      return o === 'concurrent' || o === 'after';
    });
    survivors.push({ value, clock });
    this.#data.set(key, survivors);
    return clock;
  }

  /** All sibling values (in write order) plus a context that dominates all of them. */
  get(key: string): { values: V[]; context: VC } | undefined {
    const versions = this.#data.get(key);
    if (!versions || versions.length === 0) return undefined;
    return { values: versions.map((v) => v.value), context: versions.reduce<VC>((acc, v) => vcMerge(acc, v.clock), {}) };
  }

  /** Raw versions (copies). */
  versions(key: string): Version<V>[] {
    return (this.#data.get(key) ?? []).map((v) => ({ value: v.value, clock: { ...v.clock } }));
  }
}

// ---------------------------------------------------------------------------
// Part 3: Raft leader election (no log replication)
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Role = 'follower' | 'candidate' | 'leader';

/** The per-node state the RPC handlers read and mutate. */
export interface RaftNodeState {
  id: string;
  role: Role;
  /** persistent */
  currentTerm: number;
  /** persistent: candidate voted for in currentTerm, or null */
  votedFor: string | null;
  /** last log entry (no replication here, but the election restriction still applies) */
  lastLogIndex: number;
  lastLogTerm: number;
  /** leader this node currently follows, if known */
  leaderId: string | null;
}

export interface RequestVote {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface VoteReply {
  term: number;
  voteGranted: boolean;
}

export interface AppendEntries {
  term: number;
  leaderId: string;
}

export interface AppendReply {
  term: number;
  success: boolean;
}

/** Any RPC with a higher term makes the receiver adopt it and become a follower. */
function observeTerm(node: RaftNodeState, term: number): void {
  if (term > node.currentTerm) {
    node.currentTerm = term;
    node.votedFor = null;
    node.role = 'follower';
    node.leaderId = null;
  }
}

/**
 * Raft §5.2 / §5.4.1 RequestVote receiver. Mutates `node`.
 * Grant iff req.term ≥ currentTerm (after adopting a higher term), we have not voted for
 * someone else this term, and the candidate's log is at least as up-to-date as ours.
 */
export function handleRequestVote(node: RaftNodeState, req: RequestVote): VoteReply {
  observeTerm(node, req.term);
  if (req.term < node.currentTerm) return { term: node.currentTerm, voteGranted: false };
  const upToDate = req.lastLogTerm > node.lastLogTerm || (req.lastLogTerm === node.lastLogTerm && req.lastLogIndex >= node.lastLogIndex);
  const canVote = node.votedFor === null || node.votedFor === req.candidateId;
  if (canVote && upToDate) {
    node.votedFor = req.candidateId;
    return { term: node.currentTerm, voteGranted: true };
  }
  return { term: node.currentTerm, voteGranted: false };
}

/**
 * AppendEntries (heartbeat) receiver. Mutates `node`.
 * Reject a stale term. Otherwise the sender is the leader of this term: become/stay a
 * follower (a candidate of the same term steps down) and remember the leader.
 */
export function handleAppendEntries(node: RaftNodeState, req: AppendEntries): AppendReply {
  observeTerm(node, req.term);
  if (req.term < node.currentTerm) return { term: node.currentTerm, success: false };
  node.role = 'follower';
  node.leaderId = req.leaderId;
  return { term: node.currentTerm, success: true };
}

export interface ClusterConfig {
  nodeIds: string[];
  seed: number;
  /** election timeout is uniform in [min, max] ms, re-drawn every time the timer is reset */
  electionTimeoutMin?: number;
  electionTimeoutMax?: number;
  heartbeatInterval?: number;
  /** one-way message delay is uniform in [min, max] ms */
  networkDelayMin?: number;
  networkDelayMax?: number;
}

export interface NodeSnapshot extends RaftNodeState {
  alive: boolean;
}

type Msg =
  | { type: 'vote'; from: string; to: string; body: RequestVote }
  | { type: 'voteReply'; from: string; to: string; body: VoteReply }
  | { type: 'append'; from: string; to: string; body: AppendEntries }
  | { type: 'appendReply'; from: string; to: string; body: AppendReply };

type SimEvent =
  | { time: number; seq: number; kind: 'election'; node: string; token: number }
  | { time: number; seq: number; kind: 'heartbeat'; node: string; token: number }
  | { time: number; seq: number; kind: 'deliver'; msg: Msg };

/** SimEvent without `seq` (distributes over the union). */
type Unsequenced = SimEvent extends infer E ? (E extends SimEvent ? Omit<E, 'seq'> : never) : never;

interface SimNode extends RaftNodeState {
  alive: boolean;
  votes: Set<string>;
  electionToken: number;
  heartbeatToken: number;
}

/** Binary min-heap on (time, seq) so simultaneous events run in scheduling order. */
class EventQueue {
  #h: SimEvent[] = [];
  get size(): number {
    return this.#h.length;
  }
  peek(): SimEvent | undefined {
    return this.#h[0];
  }
  push(e: SimEvent): void {
    const h = this.#h;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  pop(): SimEvent | undefined {
    const h = this.#h;
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.#less(h[l], h[m])) m = l;
        if (r < h.length && this.#less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
  #less(a: SimEvent, b: SimEvent): boolean {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }
}

/**
 * Discrete-event simulation of Raft leader election. All time is virtual; all randomness
 * comes from the seeded RNG, so a seed fully determines the run.
 */
export class RaftCluster {
  #nodes = new Map<string, SimNode>();
  #ids: string[];
  #rng: () => number;
  #q = new EventQueue();
  #seq = 0;
  #now = 0;
  #cfg: Required<ClusterConfig>;
  /** node id → partition group index; nodes in different groups cannot talk */
  #group = new Map<string, number>();
  #leadersByTerm = new Map<number, Set<string>>();

  constructor(cfg: ClusterConfig) {
    this.#cfg = {
      electionTimeoutMin: 150,
      electionTimeoutMax: 300,
      heartbeatInterval: 50,
      networkDelayMin: 1,
      networkDelayMax: 10,
      ...cfg,
    };
    this.#ids = [...cfg.nodeIds];
    this.#rng = mulberry32(cfg.seed);
    for (const id of this.#ids) {
      this.#nodes.set(id, {
        id,
        role: 'follower',
        currentTerm: 0,
        votedFor: null,
        lastLogIndex: 0,
        lastLogTerm: 0,
        leaderId: null,
        alive: true,
        votes: new Set(),
        electionToken: 0,
        heartbeatToken: 0,
      });
    }
    for (const id of this.#ids) this.#resetElectionTimer(this.#nodes.get(id)!);
  }

  get now(): number {
    return this.#now;
  }

  /** Process every event with time ≤ t, then set now = t. */
  runUntil(t: number): void {
    for (;;) {
      const next = this.#q.peek();
      if (!next || next.time > t) break;
      this.#q.pop();
      this.#now = next.time;
      this.#handle(next);
    }
    this.#now = t;
  }

  runFor(ms: number): void {
    this.runUntil(this.#now + ms);
  }

  node(id: string): NodeSnapshot {
    const n = this.#mustNode(id);
    return { id: n.id, role: n.role, currentTerm: n.currentTerm, votedFor: n.votedFor, lastLogIndex: n.lastLogIndex, lastLogTerm: n.lastLogTerm, leaderId: n.leaderId, alive: n.alive };
  }

  /** Ids of live nodes that currently believe they are leader (sorted). */
  leaders(): string[] {
    return this.#ids.filter((id) => {
      const n = this.#nodes.get(id)!;
      return n.alive && n.role === 'leader';
    }).sort();
  }

  /** The live leader with the highest term, or undefined. */
  leader(): string | undefined {
    let best: SimNode | undefined;
    for (const id of this.leaders()) {
      const n = this.#nodes.get(id)!;
      if (!best || n.currentTerm > best.currentTerm) best = n;
    }
    return best?.id;
  }

  /** History: term → every node that ever became leader in that term. Safety: length ≤ 1. */
  leadersByTerm(): Map<number, string[]> {
    return new Map([...this.#leadersByTerm].map(([t, s]) => [t, [...s].sort()]));
  }

  /** Stop a node: it handles no events and receives no messages. */
  crash(id: string): void {
    const n = this.#mustNode(id);
    n.alive = false;
    n.electionToken++;
    n.heartbeatToken++;
  }

  /** Restart a crashed node as a follower. currentTerm and votedFor survive (they are persisted). */
  restart(id: string): void {
    const n = this.#mustNode(id);
    if (n.alive) return;
    n.alive = true;
    n.role = 'follower';
    n.leaderId = null;
    n.votes = new Set();
    this.#resetElectionTimer(n);
  }

  /** Split the network: nodes can only talk inside their group. Unlisted nodes are isolated. */
  partition(groups: string[][]): void {
    this.#group.clear();
    let next = 0;
    groups.forEach((g) => {
      const idx = next++;
      for (const id of g) this.#group.set(id, idx);
    });
    for (const id of this.#ids) if (!this.#group.has(id)) this.#group.set(id, next++);
  }

  /** Remove all partitions. */
  heal(): void {
    this.#group.clear();
  }

  // ---------------------------------------------------------------- internals

  #mustNode(id: string): SimNode {
    const n = this.#nodes.get(id);
    if (!n) throw new Error(`unknown node ${id}`);
    return n;
  }

  #schedule(e: Unsequenced): void {
    this.#q.push({ ...e, seq: this.#seq++ } as SimEvent);
  }

  #uniform(min: number, max: number): number {
    return min + Math.floor(this.#rng() * (max - min + 1));
  }

  #resetElectionTimer(n: SimNode): void {
    const token = ++n.electionToken;
    const delay = this.#uniform(this.#cfg.electionTimeoutMin, this.#cfg.electionTimeoutMax);
    this.#schedule({ time: this.#now + delay, kind: 'election', node: n.id, token });
  }

  #connected(a: string, b: string): boolean {
    if (this.#group.size === 0) return true;
    return this.#group.get(a) === this.#group.get(b);
  }

  #send(msg: Msg): void {
    const delay = this.#uniform(this.#cfg.networkDelayMin, this.#cfg.networkDelayMax);
    this.#schedule({ time: this.#now + delay, kind: 'deliver', msg });
  }

  #handle(e: SimEvent): void {
    if (e.kind === 'deliver') {
      const to = this.#nodes.get(e.msg.to)!;
      // Dropped if the receiver is down or the link is cut at delivery time.
      if (!to.alive || !this.#connected(e.msg.from, e.msg.to)) return;
      this.#receive(to, e.msg);
      return;
    }
    const n = this.#nodes.get(e.node)!;
    if (!n.alive) return;
    if (e.kind === 'election') {
      if (e.token !== n.electionToken || n.role === 'leader') return;
      this.#startElection(n);
    } else {
      if (e.token !== n.heartbeatToken || n.role !== 'leader') return;
      this.#broadcastHeartbeat(n);
    }
  }

  #startElection(n: SimNode): void {
    n.role = 'candidate';
    n.currentTerm++;
    n.votedFor = n.id;
    n.leaderId = null;
    n.votes = new Set([n.id]);
    this.#resetElectionTimer(n); // if this election splits, try again later
    if (this.#isMajority(n.votes.size)) return this.#becomeLeader(n);
    for (const peer of this.#ids) {
      if (peer === n.id) continue;
      this.#send({ type: 'vote', from: n.id, to: peer, body: { term: n.currentTerm, candidateId: n.id, lastLogIndex: n.lastLogIndex, lastLogTerm: n.lastLogTerm } });
    }
  }

  #isMajority(count: number): boolean {
    return count > this.#ids.length / 2;
  }

  #becomeLeader(n: SimNode): void {
    n.role = 'leader';
    n.leaderId = n.id;
    n.electionToken++; // leaders don't time out
    let set = this.#leadersByTerm.get(n.currentTerm);
    if (!set) this.#leadersByTerm.set(n.currentTerm, (set = new Set()));
    set.add(n.id);
    n.heartbeatToken++;
    this.#broadcastHeartbeat(n);
  }

  #broadcastHeartbeat(n: SimNode): void {
    for (const peer of this.#ids) {
      if (peer !== n.id) this.#send({ type: 'append', from: n.id, to: peer, body: { term: n.currentTerm, leaderId: n.id } });
    }
    this.#schedule({ time: this.#now + this.#cfg.heartbeatInterval, kind: 'heartbeat', node: n.id, token: n.heartbeatToken });
  }

  /** Step down from leader/candidate to follower after seeing a higher term; restart the election timer if we were leader. */
  #afterTermObserved(n: SimNode, wasLeader: boolean): void {
    if (wasLeader && n.role !== 'leader') {
      n.heartbeatToken++;
      this.#resetElectionTimer(n);
    }
  }

  #receive(n: SimNode, msg: Msg): void {
    const wasLeader = n.role === 'leader';
    switch (msg.type) {
      case 'vote': {
        const reply = handleRequestVote(n, msg.body);
        this.#afterTermObserved(n, wasLeader);
        if (reply.voteGranted) this.#resetElectionTimer(n);
        this.#send({ type: 'voteReply', from: n.id, to: msg.from, body: reply });
        break;
      }
      case 'voteReply': {
        observeTerm(n, msg.body.term);
        this.#afterTermObserved(n, wasLeader);
        if (n.role === 'candidate' && msg.body.term === n.currentTerm && msg.body.voteGranted) {
          n.votes.add(msg.from);
          if (this.#isMajority(n.votes.size)) this.#becomeLeader(n);
        }
        break;
      }
      case 'append': {
        const reply = handleAppendEntries(n, msg.body);
        if (wasLeader && n.role !== 'leader') n.heartbeatToken++;
        if (reply.success) this.#resetElectionTimer(n);
        else this.#afterTermObserved(n, wasLeader);
        this.#send({ type: 'appendReply', from: n.id, to: msg.from, body: reply });
        break;
      }
      case 'appendReply': {
        observeTerm(n, msg.body.term);
        this.#afterTermObserved(n, wasLeader);
        break;
      }
    }
  }
}
