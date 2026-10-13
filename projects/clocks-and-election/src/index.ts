// STARTER — logical clocks + a deterministic Raft leader-election simulator.
// Implement every function/method below. Run the judge with:  npm run project -- clocks-and-election
// Keep the exported names and signatures: the tests import them.

// ---------------------------------------------------------------------------
// Part 1: Lamport clocks
// ---------------------------------------------------------------------------

/**
 * Lamport clock rules:
 *  1. before any local event or send: time += 1
 *  2. a send carries the (already incremented) time
 *  3. on receive(t): time = max(time, t) + 1
 * Guarantee: a → b (happens-before) ⇒ L(a) < L(b). The converse does NOT hold.
 */
export class LamportClock {
  /** Current time; starts at 0. */
  get time(): number {
    throw new Error('Not implemented: LamportClock.time');
  }

  /** A local event. Returns the new time. */
  tick(): number {
    throw new Error('Not implemented: LamportClock.tick');
  }

  /** Timestamp to attach to an outgoing message (counts as an event). */
  send(): number {
    throw new Error('Not implemented: LamportClock.send');
  }

  /** Merge an incoming message's timestamp. Returns the new time. */
  receive(remote: number): number {
    throw new Error('Not implemented: LamportClock.receive');
  }
}

// ---------------------------------------------------------------------------
// Part 2: vector clocks
// ---------------------------------------------------------------------------

/** node id → counter. Missing entries mean 0. */
export type VC = Readonly<Record<string, number>>;

export type Ordering = 'before' | 'after' | 'equal' | 'concurrent';

/** How `a` relates to `b`: 'before' = a ≤ b pointwise and a ≠ b; 'concurrent' = neither dominates. */
export function vcCompare(a: VC, b: VC): Ordering {
  throw new Error('Not implemented: vcCompare');
}

/** Pointwise max. Returns a new object; inputs are not mutated. */
export function vcMerge(a: VC, b: VC): VC {
  throw new Error('Not implemented: vcMerge');
}

/** Copy of `vc` with `node`'s counter incremented. */
export function vcIncrement(vc: VC, node: string): VC {
  throw new Error('Not implemented: vcIncrement');
}

/** A process's vector clock. */
export class VectorClock {
  constructor(nodeId: string, initial: VC = {}) {
    throw new Error('Not implemented: VectorClock.constructor');
  }

  /** A COPY of the current clock. */
  get value(): VC {
    throw new Error('Not implemented: VectorClock.value');
  }

  /** Local event: increment own entry; returns a copy. */
  tick(): VC {
    throw new Error('Not implemented: VectorClock.tick');
  }

  /** Increment and return the clock to attach to a message. */
  send(): VC {
    throw new Error('Not implemented: VectorClock.send');
  }

  /** Merge the remote clock, then increment own entry; returns a copy. */
  receive(remote: VC): VC {
    throw new Error('Not implemented: VectorClock.receive');
  }
}

export interface Version<V> {
  value: V;
  clock: VC;
}

/**
 * Dynamo-style multi-version store. A put carries the context (clock) the client last
 * read. The new version's clock = vcIncrement(context ?? {}, coordinator). It replaces every
 * stored version whose clock is 'before' or 'equal' to it; 'concurrent' versions are kept
 * as SIBLINGS (in write order) for the client to reconcile on its next write.
 */
export class VersionedStore<V> {
  /** Write `value` with the read context (undefined = blind write). Returns the new version's clock. */
  put(key: string, value: V, context: VC | undefined, coordinator: string): VC {
    throw new Error('Not implemented: VersionedStore.put');
  }

  /** All sibling values (write order) plus a context = merge of all their clocks; undefined if none. */
  get(key: string): { values: V[]; context: VC } | undefined {
    throw new Error('Not implemented: VersionedStore.get');
  }

  /** Raw versions (copies), [] if none. */
  versions(key: string): Version<V>[] {
    throw new Error('Not implemented: VersionedStore.versions');
  }
}

// ---------------------------------------------------------------------------
// Part 3: Raft leader election (no log replication)
// ---------------------------------------------------------------------------

/**
 * Deterministic PRNG (mulberry32). Returns floats in [0, 1).
 *   a = (a + 0x6d2b79f5) >>> 0; t = a;
 *   t = Math.imul(t ^ (t >>> 15), t | 1);
 *   t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
 *   return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 */
export function mulberry32(seed: number): () => number {
  throw new Error('Not implemented: mulberry32');
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

/**
 * RequestVote receiver (Raft §5.2, §5.4.1). Mutates `node`.
 * 1. req.term > currentTerm → adopt it: currentTerm = req.term, votedFor = null, role = follower, leaderId = null.
 * 2. req.term < currentTerm → reject.
 * 3. Grant iff (votedFor is null or the same candidate) AND the candidate's log is at least as
 *    up-to-date: lastLogTerm greater, or equal with lastLogIndex ≥ ours. Record votedFor.
 * Reply with the (possibly updated) currentTerm.
 */
export function handleRequestVote(node: RaftNodeState, req: RequestVote): VoteReply {
  throw new Error('Not implemented: handleRequestVote');
}

/**
 * AppendEntries (heartbeat) receiver. Mutates `node`.
 * Adopt a higher term (as above). Reject a stale term. Otherwise become/stay follower
 * (a same-term candidate steps down), set leaderId, success. votedFor is untouched.
 */
export function handleAppendEntries(node: RaftNodeState, req: AppendEntries): AppendReply {
  throw new Error('Not implemented: handleAppendEntries');
}

export interface ClusterConfig {
  nodeIds: string[];
  seed: number;
  /** election timeout is a random integer in [min, max] ms (default 150..300), re-drawn on every reset */
  electionTimeoutMin?: number;
  electionTimeoutMax?: number;
  /** leader heartbeat period, ms (default 50) */
  heartbeatInterval?: number;
  /** one-way message delay is a random integer in [min, max] ms (default 1..10) */
  networkDelayMin?: number;
  networkDelayMax?: number;
}

export interface NodeSnapshot extends RaftNodeState {
  alive: boolean;
}

/**
 * Discrete-event simulation of Raft leader election. All time is virtual (starts at 0) and
 * all randomness comes from mulberry32(seed), so a seed fully determines the run.
 *
 * You need: a priority queue of events ordered by (time, insertion seq); per-node election
 * timers (use a token/generation number so a reset timer's old event is ignored); leader
 * heartbeat timers; message-delivery events. Behaviour:
 * - Every node starts as a follower in term 0 with a random election timer.
 * - Election timeout (follower or candidate): become candidate, term += 1, vote for self,
 *   reset the timer, send RequestVote to every peer. A majority (> n/2) of granted votes for the
 *   current term → leader: send heartbeats immediately and every heartbeatInterval.
 * - Granting a vote or accepting a heartbeat resets the receiver's election timer.
 * - Any message carrying a higher term makes the receiver a follower in that term; a leader
 *   that steps down stops heartbeating and starts an election timer.
 * - Messages are dropped if, at delivery time, the receiver is crashed or on the other side
 *   of a partition. Crashed nodes process nothing.
 * Do NOT implement Pre-Vote or CheckQuorum (one test shows the problem they solve).
 */
export class RaftCluster {
  constructor(cfg: ClusterConfig) {
    throw new Error('Not implemented: RaftCluster.constructor');
  }

  /** Current virtual time (ms). */
  get now(): number {
    throw new Error('Not implemented: RaftCluster.now');
  }

  /** Process every event with time ≤ t (in order), then set now = t. */
  runUntil(t: number): void {
    throw new Error('Not implemented: RaftCluster.runUntil');
  }

  /** runUntil(now + ms). */
  runFor(ms: number): void {
    throw new Error('Not implemented: RaftCluster.runFor');
  }

  /** A copy of the node's state. Unknown id throws. */
  node(id: string): NodeSnapshot {
    throw new Error('Not implemented: RaftCluster.node');
  }

  /** Ids of live nodes whose role is 'leader', sorted. */
  leaders(): string[] {
    throw new Error('Not implemented: RaftCluster.leaders');
  }

  /** The live leader with the highest term, or undefined. */
  leader(): string | undefined {
    throw new Error('Not implemented: RaftCluster.leader');
  }

  /** History: term → sorted ids of every node that ever became leader in that term. Safety means length ≤ 1. */
  leadersByTerm(): Map<number, string[]> {
    throw new Error('Not implemented: RaftCluster.leadersByTerm');
  }

  /** Stop a node: it handles no timers and receives no messages. */
  crash(id: string): void {
    throw new Error('Not implemented: RaftCluster.crash');
  }

  /** Restart a crashed node as a follower with a fresh election timer. currentTerm and votedFor survive (persisted). No-op if alive. */
  restart(id: string): void {
    throw new Error('Not implemented: RaftCluster.restart');
  }

  /** Split the network: nodes can only talk inside their group. Unlisted nodes are isolated. Replaces any previous partition. */
  partition(groups: string[][]): void {
    throw new Error('Not implemented: RaftCluster.partition');
  }

  /** Remove all partitions. */
  heal(): void {
    throw new Error('Not implemented: RaftCluster.heal');
  }
}
