import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { LamportClock, VectorClock, vcCompare, vcMerge, vcIncrement, VersionedStore, mulberry32, handleRequestVote, handleAppendEntries, RaftCluster } = mod;
type RaftNodeState = import('../solution/index.ts').RaftNodeState;
type RaftCluster = import('../solution/index.ts').RaftCluster;

const FIVE = ['n1', 'n2', 'n3', 'n4', 'n5'];

/** Advance in 10ms steps until a leader exists (or the budget runs out). Returns elapsed ms. */
function waitForLeader(c: RaftCluster, budgetMs = 3000): number {
  let t = 0;
  while (!c.leader() && t < budgetMs) { c.runFor(10); t += 10; }
  return t;
}

function follower(over: Partial<RaftNodeState> = {}): RaftNodeState {
  return { id: 'me', role: 'follower', currentTerm: 3, votedFor: null, lastLogIndex: 5, lastLogTerm: 2, leaderId: null, ...over };
}

function assertSafety(c: RaftCluster) {
  for (const [term, ls] of c.leadersByTerm()) assert.ok(ls.length <= 1, `term ${term} had leaders ${ls.join(',')}`);
}

// ---------------------------------------------------------------- Lamport

test('M1: Lamport clock — tick/send increment, receive takes max + 1', () => {
  const c = new LamportClock();
  assert.equal(c.time, 0);
  assert.equal(c.tick(), 1);
  assert.equal(c.send(), 2);
  assert.equal(c.receive(10), 11);
  assert.equal(c.receive(3), 12, 'a smaller remote time still advances the clock');
  assert.equal(c.time, 12);
});

test('M1: Lamport timestamps respect happens-before across a message chain', () => {
  const [a, b, c] = [new LamportClock(), new LamportClock(), new LamportClock()];
  a.tick(); a.tick();
  const m1 = a.send(); // a: 3
  b.tick(); // b: 1 — concurrent with a's events
  const r1 = b.receive(m1); // b: 4
  const m2 = b.send(); // b: 5
  const r2 = c.receive(m2); // c: 6
  assert.ok(m1 < r1 && r1 < m2 && m2 < r2);
  assert.deepEqual([m1, r1, m2, r2], [3, 4, 5, 6]);
});

// ---------------------------------------------------------------- vector clocks

test('M2: vcCompare distinguishes before / after / equal / concurrent (missing entries are 0)', () => {
  assert.equal(vcCompare({ a: 1 }, { a: 1, b: 1 }), 'before');
  assert.equal(vcCompare({ a: 2, b: 1 }, { a: 1 }), 'after');
  assert.equal(vcCompare({ a: 1, b: 0 }, { a: 1 }), 'equal');
  assert.equal(vcCompare({}, {}), 'equal');
  assert.equal(vcCompare({ a: 2, b: 1 }, { a: 1, b: 2 }), 'concurrent');
  assert.equal(vcCompare({ a: 1 }, { b: 1 }), 'concurrent');
});

test('M2: vcMerge is a pointwise max and vcIncrement bumps one entry, without mutating inputs', () => {
  const x = { a: 3, b: 1 };
  const y = { b: 4, c: 2 };
  assert.deepEqual(vcMerge(x, y), { a: 3, b: 4, c: 2 });
  assert.deepEqual(vcIncrement(x, 'c'), { a: 3, b: 1, c: 1 });
  assert.deepEqual(x, { a: 3, b: 1 });
  assert.deepEqual(y, { b: 4, c: 2 });
});

test('M2: VectorClock send/receive captures causality that Lamport clocks cannot', () => {
  const p = new VectorClock('p');
  const q = new VectorClock('q');
  const r = new VectorClock('r');
  const e1 = p.send(); // {p:1}
  const e2 = q.tick(); // {q:1} — concurrent with e1
  const e3 = q.receive(e1); // {p:1,q:2}
  const e4 = r.tick();
  assert.deepEqual(e3, { p: 1, q: 2 });
  assert.equal(vcCompare(e1, e2), 'concurrent');
  assert.equal(vcCompare(e1, e3), 'before');
  assert.equal(vcCompare(e2, e3), 'before');
  assert.equal(vcCompare(e3, e4), 'concurrent');
  const v = q.value;
  (v as Record<string, number>).q = 100;
  assert.equal(q.value.q, 2, 'value is a copy');
});

test('M3: VersionedStore keeps concurrent writes as siblings and collapses them on a reconciling write', () => {
  const s = new VersionedStore<string>();
  const v1 = s.put('cart', 'milk', undefined, 'A');
  const read = s.get('cart')!;
  assert.deepEqual(read.values, ['milk']);
  // Two clients read the same context and write concurrently through different coordinators.
  s.put('cart', 'milk,eggs', read.context, 'A');
  s.put('cart', 'milk,bread', read.context, 'B');
  const conflicted = s.get('cart')!;
  assert.deepEqual(conflicted.values, ['milk,eggs', 'milk,bread']);
  assert.equal(vcCompare(s.versions('cart')[0].clock, s.versions('cart')[1].clock), 'concurrent');
  assert.equal(vcCompare(v1, conflicted.context), 'before');
  // The client merges siblings and writes back with the merged context.
  s.put('cart', 'milk,eggs,bread', conflicted.context, 'A');
  assert.deepEqual(s.get('cart')!.values, ['milk,eggs,bread']);
  assert.equal(s.get('nothing'), undefined);
});

test('M3: a write that descends from the current version simply replaces it; a stale-context write becomes a sibling', () => {
  const s = new VersionedStore<number>();
  let ctx = s.put('x', 1, undefined, 'A');
  ctx = s.put('x', 2, ctx, 'A');
  ctx = s.put('x', 3, ctx, 'B');
  assert.deepEqual(s.get('x')!.values, [3]);
  s.put('x', 99, { A: 1 }, 'C'); // based on an old read
  assert.deepEqual(s.get('x')!.values, [3, 99]);
});

// ---------------------------------------------------------------- Raft rules

test('M4: mulberry32 is deterministic per seed and returns floats in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.05);
});

test('M4: RequestVote — grant once per term, reject stale terms, step down on higher terms', () => {
  const n = follower();
  assert.deepEqual(handleRequestVote(n, { term: 2, candidateId: 'x', lastLogIndex: 9, lastLogTerm: 9 }), { term: 3, voteGranted: false });
  assert.deepEqual(handleRequestVote(n, { term: 3, candidateId: 'x', lastLogIndex: 5, lastLogTerm: 2 }), { term: 3, voteGranted: true });
  assert.equal(n.votedFor, 'x');
  assert.equal(handleRequestVote(n, { term: 3, candidateId: 'y', lastLogIndex: 5, lastLogTerm: 2 }).voteGranted, false, 'already voted this term');
  assert.equal(handleRequestVote(n, { term: 3, candidateId: 'x', lastLogIndex: 5, lastLogTerm: 2 }).voteGranted, true, 're-granting to the same candidate is idempotent');
  const leader = follower({ role: 'leader', votedFor: 'me' });
  assert.deepEqual(handleRequestVote(leader, { term: 7, candidateId: 'y', lastLogIndex: 5, lastLogTerm: 2 }), { term: 7, voteGranted: true });
  assert.equal(leader.role, 'follower');
  assert.equal(leader.currentTerm, 7);
});

test('M4: RequestVote — the election restriction rejects candidates with a less up-to-date log', () => {
  const behindTerm = follower();
  assert.equal(handleRequestVote(behindTerm, { term: 4, candidateId: 'c', lastLogIndex: 50, lastLogTerm: 1 }).voteGranted, false);
  assert.equal(behindTerm.currentTerm, 4, 'the higher term is still adopted');
  assert.equal(behindTerm.votedFor, null);
  const shorter = follower();
  assert.equal(handleRequestVote(shorter, { term: 3, candidateId: 'c', lastLogIndex: 4, lastLogTerm: 2 }).voteGranted, false);
  const newerTerm = follower();
  assert.equal(handleRequestVote(newerTerm, { term: 3, candidateId: 'c', lastLogIndex: 1, lastLogTerm: 3 }).voteGranted, true);
});

test('M4: AppendEntries — reject stale leaders; a candidate of the same term steps down and follows', () => {
  const cand = follower({ role: 'candidate', votedFor: 'me' });
  assert.deepEqual(handleAppendEntries(cand, { term: 2, leaderId: 'old' }), { term: 3, success: false });
  assert.equal(cand.role, 'candidate');
  assert.deepEqual(handleAppendEntries(cand, { term: 3, leaderId: 'L' }), { term: 3, success: true });
  assert.equal(cand.role, 'follower');
  assert.equal(cand.leaderId, 'L');
  assert.equal(cand.votedFor, 'me', 'votedFor is unchanged within the same term');
});

// ---------------------------------------------------------------- simulation

test('M5: a 5-node cluster elects exactly one leader and everyone follows it', () => {
  const c = new RaftCluster({ nodeIds: FIVE, seed: 7 });
  const t = waitForLeader(c);
  assert.ok(t < 1000, `took ${t}ms`);
  c.runFor(200);
  const l = c.leader()!;
  assert.deepEqual(c.leaders(), [l]);
  const term = c.node(l).currentTerm;
  for (const id of FIVE) {
    assert.equal(c.node(id).currentTerm, term);
    assert.equal(c.node(id).leaderId, l);
    assert.equal(c.node(id).role, id === l ? 'leader' : 'follower');
  }
});

test('M5: the same seed replays the same election; different seeds pick different leaders', () => {
  const run = (seed: number) => {
    const c = new RaftCluster({ nodeIds: FIVE, seed });
    c.runFor(3000);
    return { leader: c.leader(), term: c.node(c.leader()!).currentTerm, history: [...c.leadersByTerm()] };
  };
  assert.deepEqual(run(11), run(11));
  const leaders = new Set(Array.from({ length: 12 }, (_, i) => run(i + 1).leader));
  assert.ok(leaders.size >= 3, `only ${[...leaders]} ever won — are timeouts randomized?`);
});

test('M5: heartbeats keep a healthy leader in place (no new terms for 10 virtual seconds)', () => {
  const c = new RaftCluster({ nodeIds: FIVE, seed: 3 });
  waitForLeader(c);
  const l = c.leader()!;
  const term = c.node(l).currentTerm;
  c.runFor(10_000);
  assert.equal(c.leader(), l);
  assert.equal(c.node(l).currentTerm, term);
  assert.equal(c.now >= 10_000, true);
});

test('M5: identical timeouts livelock in split votes; randomized timeouts fix it', () => {
  const fixed = new RaftCluster({ nodeIds: ['a', 'b', 'c'], seed: 1, electionTimeoutMin: 150, electionTimeoutMax: 150, networkDelayMin: 5, networkDelayMax: 5 });
  fixed.runFor(3000);
  assert.deepEqual(fixed.leaders(), []);
  assert.ok(fixed.node('a').currentTerm >= 10, 'candidates keep starting new terms');
  const randomized = new RaftCluster({ nodeIds: ['a', 'b', 'c'], seed: 1, networkDelayMin: 5, networkDelayMax: 5 });
  randomized.runFor(3000);
  assert.equal(randomized.leaders().length, 1);
});

test('M6: when the leader crashes the survivors elect a new one in a higher term; the old one rejoins as follower', () => {
  const c = new RaftCluster({ nodeIds: FIVE, seed: 5 });
  waitForLeader(c);
  const old = c.leader()!;
  const oldTerm = c.node(old).currentTerm;
  c.crash(old);
  assert.equal(c.leader(), undefined);
  const t = waitForLeader(c);
  assert.ok(t < 1500, `re-election took ${t}ms`);
  const fresh = c.leader()!;
  assert.notEqual(fresh, old);
  assert.ok(c.node(fresh).currentTerm > oldTerm);
  c.restart(old);
  c.runFor(500);
  assert.equal(c.node(old).role, 'follower');
  assert.equal(c.node(old).leaderId, fresh);
  assert.deepEqual(c.leaders(), [fresh]);
  assertSafety(c);
});

test('M6: without a majority alive nobody can become leader', () => {
  const c = new RaftCluster({ nodeIds: FIVE, seed: 9 });
  waitForLeader(c);
  const l = c.leader()!;
  const others = FIVE.filter((id) => id !== l);
  c.crash(l); c.crash(others[0]); c.crash(others[1]);
  c.runFor(4000);
  assert.deepEqual(c.leaders(), []);
  c.restart(others[0]);
  assert.ok(waitForLeader(c) < 3000, 'a majority is back, so a leader appears');
});

test('M6: restart keeps votedFor, so a node cannot vote twice in one term after a crash', () => {
  const c = new RaftCluster({ nodeIds: FIVE, seed: 21 });
  waitForLeader(c);
  for (const id of FIVE) {
    const before = c.node(id);
    c.crash(id);
    c.restart(id);
    const after = c.node(id);
    assert.equal(after.currentTerm, before.currentTerm);
    assert.equal(after.votedFor, before.votedFor);
    assert.equal(after.role, 'follower');
  }
});

test('M7: a partitioned-away leader keeps a stale term while the majority elects a newer leader; healing resolves it', () => {
  const c = new RaftCluster({ nodeIds: FIVE, seed: 13 });
  waitForLeader(c);
  const old = c.leader()!;
  const rest = FIVE.filter((id) => id !== old);
  c.partition([[old, rest[0]], rest.slice(1)]);
  c.runFor(2000);
  const fresh = c.leader()!;
  assert.ok(rest.slice(1).includes(fresh), 'the new leader comes from the majority side');
  assert.equal(c.node(old).role, 'leader', 'the minority leader does not know it was deposed');
  assert.ok(c.node(fresh).currentTerm > c.node(old).currentTerm);
  assert.equal(c.leaders().length, 2, 'two leaders, but in different terms');
  c.heal();
  c.runFor(1000);
  assert.deepEqual(c.leaders(), [fresh]);
  assert.equal(c.node(old).leaderId, fresh);
  assertSafety(c);
});

test('M7: a minority that keeps electing inflates its term and disrupts the leader on heal (why Pre-Vote exists)', () => {
  const c = new RaftCluster({ nodeIds: FIVE, seed: 17 });
  waitForLeader(c);
  const l = c.leader()!;
  const isolated = FIVE.find((id) => id !== l)!;
  const term = c.node(l).currentTerm;
  c.partition([[isolated], FIVE.filter((id) => id !== isolated)]);
  c.runFor(3000);
  assert.equal(c.leader(), l, 'the majority side is undisturbed');
  assert.ok(c.node(isolated).currentTerm > term + 3, 'the isolated node keeps starting elections');
  const inflated = c.node(isolated).currentTerm;
  c.heal();
  c.runFor(2000);
  const after = c.leader()!;
  assert.ok(c.node(after).currentTerm >= inflated, 'the healthy leader was deposed: the cluster moved to the inflated term');
  assert.equal(c.leaders().length, 1);
});

test('M7: safety under chaos — over 25 seeds of random crashes, restarts and partitions, at most one leader per term', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const c = new RaftCluster({ nodeIds: FIVE, seed });
    const chaos = mulberry32(seed * 7919);
    for (let step = 0; step < 20; step++) {
      const r = chaos();
      const id = FIVE[Math.floor(chaos() * FIVE.length)];
      if (r < 0.3) c.crash(id);
      else if (r < 0.6) c.restart(id);
      else if (r < 0.8) {
        const cut = 1 + Math.floor(chaos() * 4);
        c.partition([FIVE.slice(0, cut), FIVE.slice(cut)]);
      } else c.heal();
      c.runFor(150 + Math.floor(chaos() * 300));
      assertSafety(c);
    }
    // Recover everything: the cluster must converge to a single leader.
    c.heal();
    for (const id of FIVE) c.restart(id);
    c.runFor(3000);
    assert.equal(c.leaders().length, 1, `seed ${seed} did not converge`);
    const term = c.node(c.leader()!).currentTerm;
    for (const id of FIVE) assert.equal(c.node(id).currentTerm, term, `seed ${seed}: ${id} has a different term`);
    assertSafety(c);
  }
});
