// Pure, deterministic Raft simulation (5 nodes). No React here so it can be tested with Node.
// Time advances in ticks; every message takes exactly one tick to arrive. Only "interesting"
// ticks become frames (elections, votes, entries, commits, crashes, partitions).
import { rng, type BaseFrame } from '../../core';

export type Scenario = 'normal' | 'crash' | 'partition';
export type Role = 'follower' | 'candidate' | 'leader' | 'down';
export type MsgKind = 'RV' | 'RVR' | 'AE' | 'AER';

export interface Params {
  scenario: Scenario;
  seed: number;
  /** extra randomised ticks on top of the base election timeout */
  spread: number;
}

export interface Entry {
  term: number;
  cmd: string;
}

export interface NodeView {
  id: number;
  role: Role;
  term: number;
  votedFor: number | null;
  log: Entry[];
  commit: number;
  /** ticks left before this node's election timeout fires (followers/candidates) */
  timerLeft: number;
  timerLen: number;
  votes: number;
}

export interface MsgView {
  from: number;
  to: number;
  kind: MsgKind;
  /** RVR: vote granted; AER: append succeeded */
  ok?: boolean;
  /** AE: number of entries carried */
  n?: number;
  dropped?: boolean;
}

export interface Frame extends BaseFrame {
  tick: number;
  nodes: NodeView[];
  msgs: MsgView[];
  /** node groups that can talk to each other, or null when the network is whole */
  partition: number[][] | null;
}

export const N = 5;
export const MAJORITY = 3;
export const BASE_TIMEOUT = 8;
export const HEARTBEAT = 3;
const MAX_TICKS = 160;
const MAX_FRAMES = 40;

interface Msg {
  from: number;
  to: number;
  kind: MsgKind;
  term: number;
  // RV
  lastIndex?: number;
  lastTerm?: number;
  // RVR / AER
  ok?: boolean;
  match?: number;
  // AE
  prevIndex?: number;
  prevTerm?: number;
  entries?: Entry[];
  leaderCommit?: number;
}

interface Node {
  id: number;
  role: Role;
  term: number;
  votedFor: number | null;
  log: Entry[];
  commit: number;
  deadline: number;
  timerLen: number;
  votes: Set<number>;
  nextIndex: number[];
  matchIndex: number[];
  lastBeat: number;
}

const name = (i: number) => `S${i + 1}`;
const lastTerm = (log: Entry[]) => (log.length ? log[log.length - 1].term : 0);

export function simulate({ scenario, seed, spread }: Params): Frame[] {
  const rand = rng(seed * 7919 + 17);
  const draw = () => BASE_TIMEOUT + Math.floor(rand() * (spread + 1));

  const nodes: Node[] = Array.from({ length: N }, (_, id) => ({
    id,
    role: 'follower' as Role,
    term: 0,
    votedFor: null,
    log: [],
    commit: 0,
    deadline: 0,
    timerLen: 0,
    votes: new Set<number>(),
    nextIndex: Array(N).fill(1),
    matchIndex: Array(N).fill(0),
    lastBeat: 0,
  }));
  const resetTimer = (n: Node, t: number) => {
    n.timerLen = draw();
    n.deadline = t + n.timerLen;
  };

  let partition: number[][] | null = null;
  const canTalk = (a: number, b: number) => !partition || partition.some((g) => g.includes(a) && g.includes(b));

  let inflight: Msg[] = [];
  const frames: Frame[] = [];

  // ---------- scenario setup ----------
  let introCaption = '';
  let introPredict: string | undefined;
  if (scenario === 'normal') {
    nodes.forEach((n) => resetTimer(n, 0));
    introCaption = `Term 0, no leader yet. Every follower runs its own election timer, randomised between ${BASE_TIMEOUT} and ${BASE_TIMEOUT + spread} ticks; heartbeats would reset it, but nobody is sending any.`;
    introPredict =
      spread === 0
        ? 'Every timer is identical (spread 0). What happens when they all fire at once?'
        : 'Which node becomes a candidate first, and what does it need to become leader?';
  } else {
    // S1 has been leader of term 1 for a while
    const x: Entry = { term: 1, cmd: 'x=1' };
    const y: Entry = { term: 1, cmd: 'y=2' };
    const z: Entry = { term: 1, cmd: 'z=3' };
    nodes.forEach((n) => {
      n.term = 1;
      n.votedFor = 0;
    });
    nodes[0].role = 'leader';
    if (scenario === 'crash') {
      const logs = [[x, y, z], [x, y, z], [x, y], [x], [x]];
      const commits = [2, 2, 2, 1, 1];
      nodes.forEach((n, i) => {
        n.log = logs[i].map((e) => ({ ...e }));
        n.commit = commits[i];
      });
      nodes[0].matchIndex = [3, 3, 2, 1, 1];
      nodes[0].nextIndex = [4, 4, 3, 2, 2];
      nodes.forEach((n) => resetTimer(n, 0));
      // script: S4 (a lagging follower) happens to time out first
      const others = [1, 2, 4].map((i) => nodes[i].deadline);
      nodes[3].deadline = Math.max(2, Math.min(...others) - 1);
      nodes[3].timerLen = nodes[3].deadline;
      introCaption =
        'S1 leads term 1. Entries 1–2 are committed (on a majority); z=3 (index 3) reached only S1 and S2, so it is NOT committed. S4 and S5 lag behind.';
    } else {
      nodes.forEach((n) => {
        n.log = [{ ...x }];
        n.commit = 1;
      });
      nodes[0].matchIndex = [1, 1, 1, 1, 1];
      nodes[0].nextIndex = [2, 2, 2, 2, 2];
      nodes.forEach((n) => resetTimer(n, 0));
      introCaption = 'S1 leads term 1 and x=1 is committed on all five nodes. Heartbeats keep every follower’s election timer from firing.';
    }
    nodes[0].lastBeat = 0;
  }

  // ---------- helpers ----------
  const events: string[] = [];
  // per-tick aggregation for readable captions
  const grants = new Map<number, number[]>();
  const appended = new Map<number, number[]>(); // follower -> new last index
  const learned: number[] = []; // followers whose commitIndex advanced
  const acked = new Map<number, number[]>(); // leader -> followers whose matchIndex advanced
  const ballots = new Set<number>(); // candidates that counted vote replies this tick
  let notable = false;
  let predict: string | undefined;
  let sentThisTick: MsgView[] = [];

  /** queue a message; it arrives next tick unless the target is down or across a partition */
  const send = (m: Msg) => {
    const dropped = nodes[m.to].role === 'down' || !canTalk(m.from, m.to);
    const show =
      m.kind === 'RV' ||
      m.kind === 'RVR' ||
      (m.kind === 'AE' && ((m.entries?.length ?? 0) > 0 || (m.leaderCommit ?? 0) > nodes[m.to].commit)) ||
      (m.kind === 'AER' && (!m.ok || (m.match ?? 0) > nodes[m.to].matchIndex[m.from]));
    if (show && nodes[m.to].role !== 'down') sentThisTick.push({ from: m.from, to: m.to, kind: m.kind, ok: m.ok, n: m.entries?.length, dropped });
    if (!dropped) inflight.push(m);
  };

  const sendAppend = (L: Node, f: number) => {
    const prevIndex = L.nextIndex[f] - 1;
    send({
      from: L.id,
      to: f,
      kind: 'AE',
      term: L.term,
      prevIndex,
      prevTerm: prevIndex > 0 ? L.log[prevIndex - 1].term : 0,
      entries: L.log.slice(prevIndex).map((e) => ({ ...e })),
      leaderCommit: L.commit,
    });
  };
  const broadcastAppend = (L: Node, t: number) => {
    L.lastBeat = t;
    for (let f = 0; f < N; f++) if (f !== L.id) sendAppend(L, f);
  };

  const stepDown = (n: Node, term: number, t: number) => {
    const was = n.role;
    if (term > n.term) {
      n.term = term;
      n.votedFor = null;
    }
    if (was === 'leader' || was === 'candidate') {
      n.role = 'follower';
      resetTimer(n, t);
      events.push(`${name(n.id)} sees term ${term} and steps down from ${was} to follower.`);
      notable = true;
    }
  };

  const advanceCommit = (L: Node) => {
    for (let idx = L.log.length; idx > L.commit; idx--) {
      if (L.log[idx - 1].term !== L.term) continue; // Figure 8: only count current-term entries
      const count = L.matchIndex.filter((m) => m >= idx).length;
      if (count >= MAJORITY) {
        const old = L.commit;
        L.commit = idx;
        const older = L.log.slice(old, idx - 1).filter((e) => e.term !== L.term);
        events.push(
          `${name(L.id)} has index ${idx} (term ${L.term}) on ${count}/5 nodes, a majority, so commitIndex → ${idx}.` +
            (older.length
              ? ` ${older.map((e) => e.cmd).join(', ')} (term ${older[0].term}) commits indirectly with it: a leader never commits an old-term entry by counting its replicas.`
              : ''),
        );
        notable = true;
        return;
      }
    }
  };

  const becomeLeader = (c: Node, t: number) => {
    c.role = 'leader';
    c.log.push({ term: c.term, cmd: 'no-op' });
    c.nextIndex = Array(N).fill(c.log.length); // optimistic: next = old last + 1
    c.matchIndex = Array(N).fill(0);
    c.matchIndex[c.id] = c.log.length;
    events.push(
      `${name(c.id)} has ${c.votes.size}/5 votes, a majority, so it is LEADER of term ${c.term}. It appends a no-op from its own term and sends AppendEntries.`,
    );
    notable = true;
    broadcastAppend(c, t);
  };

  const handle = (m: Msg, t: number) => {
    const r = nodes[m.to];
    if (r.role === 'down') return;
    if (m.term > r.term) stepDown(r, m.term, t);
    switch (m.kind) {
      case 'RV': {
        const myLastT = lastTerm(r.log);
        const upToDate = m.lastTerm! > myLastT || (m.lastTerm === myLastT && m.lastIndex! >= r.log.length);
        const freeVote = r.votedFor === null || r.votedFor === m.from;
        const grant = m.term === r.term && freeVote && upToDate;
        if (grant) {
          r.votedFor = m.from;
          resetTimer(r, t);
          grants.set(m.from, [...(grants.get(m.from) ?? []), r.id]);
        }
        if (!grant && m.term === r.term) {
          if (!upToDate)
            events.push(
              `${name(r.id)} refuses ${name(m.from)}: its own log (last term ${myLastT}, index ${r.log.length}) is more up to date than the candidate’s (term ${m.lastTerm}, index ${m.lastIndex}).`,
            );
          else events.push(`${name(r.id)} refuses ${name(m.from)}: it already voted for ${name(r.votedFor!)} in term ${r.term}.`);
        }
        send({ from: r.id, to: m.from, kind: 'RVR', term: r.term, ok: grant });
        notable = true;
        break;
      }
      case 'RVR': {
        if (r.role === 'candidate' && m.term === r.term) {
          ballots.add(r.id);
          if (m.ok) r.votes.add(m.from);
          if (r.votes.size >= MAJORITY) becomeLeader(r, t);
        }
        notable = true;
        break;
      }
      case 'AE': {
        if (m.term < r.term) {
          send({ from: r.id, to: m.from, kind: 'AER', term: r.term, ok: false, match: 0 });
          break;
        }
        if (r.role === 'candidate') stepDown(r, m.term, t);
        resetTimer(r, t);
        const prev = m.prevIndex!;
        if (prev > r.log.length || (prev > 0 && r.log[prev - 1].term !== m.prevTerm)) {
          events.push(`${name(r.id)} rejects AppendEntries: it has no entry (index ${prev}, term ${m.prevTerm}) to attach to.`);
          notable = true;
          send({ from: r.id, to: m.from, kind: 'AER', term: r.term, ok: false, match: 0 });
          break;
        }
        const ents = m.entries!;
        let changed = false;
        ents.forEach((e, k) => {
          const idx = prev + 1 + k;
          const mine = r.log[idx - 1];
          if (mine && mine.term !== e.term) {
            const gone = r.log.slice(idx - 1).map((x) => x.cmd);
            events.push(`${name(r.id)} overwrites conflicting uncommitted ${gone.join(', ')} from index ${idx} with the leader’s entries.`);
            r.log = r.log.slice(0, idx - 1);
          }
          if (!r.log[idx - 1]) {
            r.log.push({ ...e });
            changed = true;
          }
        });
        if (changed) {
          notable = true;
          appended.set(r.id, [prev + ents.length]);
        }
        const lastNew = prev + ents.length;
        if (m.leaderCommit! > r.commit) {
          const nc = Math.min(m.leaderCommit!, lastNew);
          if (nc > r.commit) {
            r.commit = nc;
            notable = true;
            learned.push(r.id);
          }
        }
        send({ from: r.id, to: m.from, kind: 'AER', term: r.term, ok: true, match: lastNew });
        break;
      }
      case 'AER': {
        if (r.role !== 'leader' || m.term !== r.term) break;
        if (m.ok) {
          if (m.match! > r.matchIndex[m.from]) {
            r.matchIndex[m.from] = m.match!;
            notable = true;
            acked.set(r.id, [...(acked.get(r.id) ?? []), m.from]);
          }
          r.nextIndex[m.from] = Math.max(r.nextIndex[m.from], m.match! + 1);
          advanceCommit(r);
        } else {
          r.nextIndex[m.from] = Math.max(1, r.nextIndex[m.from] - 1);
          events.push(`${name(r.id)} backs nextIndex for ${name(m.from)} up to ${r.nextIndex[m.from]} and retries.`);
          notable = true;
          sendAppend(r, m.from);
        }
        break;
      }
    }
  };

  const view = (t: number): NodeView[] =>
    nodes.map((n) => ({
      id: n.id,
      role: n.role,
      term: n.term,
      votedFor: n.votedFor,
      log: n.log.map((e) => ({ ...e })),
      commit: n.commit,
      timerLeft: n.role === 'follower' || n.role === 'candidate' ? Math.max(0, n.deadline - t) : 0,
      timerLen: n.timerLen,
      votes: n.role === 'candidate' ? n.votes.size : 0,
    }));

  frames.push({ tick: 0, nodes: view(0), msgs: [], partition, caption: introCaption, predict: introPredict });

  // ---------- script state ----------
  let wrote1 = false;
  let wrote2 = false;
  let crashed = false;
  let restarted = false;
  let healed = false;
  let partitioned = false;
  let doneTick = -1;
  let winnerPredictDone = false;

  // the leader with the highest term (a deposed leader in a minority partition may not know it yet)
  const leaderNode = () =>
    nodes.filter((n) => n.role === 'leader').sort((a, b) => b.term - a.term)[0] as Node | undefined;
  const allSynced = () => {
    const L = leaderNode();
    if (!L) return false;
    return nodes.every((n) => n.role === 'down' || (n.log.length === L.log.length && n.commit === L.commit && L.commit === L.log.length));
  };

  for (let t = 1; t <= MAX_TICKS && frames.length < MAX_FRAMES - 1; t++) {
    events.length = 0;
    notable = false;
    predict = undefined;
    sentThisTick = [];
    const scriptEvents: string[] = [];

    // messages sent last tick arrive this tick; anything sent from now on arrives next tick
    const due = inflight;
    inflight = [];

    // ---------- scripted events ----------
    if (scenario === 'crash' && !crashed && t === 1) {
      crashed = true;
      nodes[0].role = 'down';
      inflight = inflight.filter((m) => m.from !== 0 && m.to !== 0);
      scriptEvents.push('S1, the leader, CRASHES. No more heartbeats: the followers’ election timers keep running down.');
      predict = 'S4’s timer fires first. S4’s log stops at index 1. Can S4 win the election?';
      notable = true;
    }
    if (scenario === 'partition' && !partitioned && t === 1) {
      partitioned = true;
      partition = [
        [0, 1],
        [2, 3, 4],
      ];
      scriptEvents.push('The network PARTITIONS: {S1, S2} can no longer reach {S3, S4, S5}. S1 still believes it is leader.');
      notable = true;
    }
    const L0 = leaderNode();
    const write = (L: Node, cmd: string) => {
      L.log.push({ term: L.term, cmd });
      L.matchIndex[L.id] = L.log.length;
      broadcastAppend(L, t);
      notable = true;
    };
    const settled = (L: Node) => L.commit === L.log.length;
    if (scenario === 'partition' && partitioned && !wrote1 && t === 2 && L0 && L0.id === 0) {
      wrote1 = true;
      write(L0, 'y=2');
      scriptEvents.push('A client sends y=2 to S1. S1 appends it at index 2 (term 1) and replicates, but only S2 is reachable.');
      predict = 'y=2 can reach S2 at most: 2 of 5 nodes. Will S1 ever commit it while partitioned?';
    }
    if (scenario === 'normal' && L0 && settled(L0)) {
      if (!wrote1) {
        wrote1 = true;
        write(L0, 'x=1');
        scriptEvents.push(`A client sends x=1 to ${name(L0.id)}. It appends it at index ${L0.log.length} (term ${L0.term}), uncommitted for now.`);
        predict = `How many of the five nodes must store x=1 before ${name(L0.id)} may commit it?`;
      } else if (!wrote2) {
        wrote2 = true;
        write(L0, 'y=2');
        scriptEvents.push(`A client sends y=2 to ${name(L0.id)}, which appends it at index ${L0.log.length} and replicates it.`);
      }
    }
    if (scenario === 'partition' && L0 && L0.term > 1 && settled(L0) && !wrote2) {
      wrote2 = true;
      write(L0, 'z=9');
      scriptEvents.push(`Another client sends z=9 to ${name(L0.id)}, the term-${L0.term} leader of the majority side. It appends it at index ${L0.log.length}.`);
    }
    if (scenario === 'partition' && wrote2 && !healed && L0 && L0.id !== 0 && L0.commit === L0.log.length) {
      healed = true;
      partition = null;
      scriptEvents.push('The partition HEALS. S1 (term 1) and the new leader (term ' + L0.term + ') can now hear each other.');
      predict = 'What happens to y=2, the write S1 accepted while it was cut off?';
      notable = true;
    }
    if (scenario === 'crash' && crashed && !restarted && L0 && L0.term > 1 && allSynced()) {
      restarted = true;
      const s1 = nodes[0];
      s1.role = 'follower';
      s1.commit = 0; // commitIndex is volatile; term, vote and log were persisted
      resetTimer(s1, t);
      scriptEvents.push(`S1 restarts with its persisted log and term 1. ${name(L0.id)}’s next heartbeat (term ${L0.term}) will reach it.`);
      notable = true;
    }

    // ---------- deliver messages sent last tick ----------
    // deterministic shuffle so simultaneous requests race fairly
    for (let i = due.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [due[i], due[j]] = [due[j], due[i]];
    }
    due.forEach((m) => handle(m, t));
    grants.forEach((voters, c) =>
      events.unshift(
        `${voters.map(name).join(', ')} grant${voters.length === 1 ? 's' : ''} ${name(c)} ${voters.length === 1 ? 'its' : 'their'} vote for term ${nodes[c].term} (no other vote this term, candidate log at least as up to date).`,
      ),
    );
    if (appended.size)
      events.push(
        appended.size === 1
          ? `${name([...appended.keys()][0])} passes the prevLogIndex/prevLogTerm check, appends the new entries and acks.`
          : `${[...appended.keys()].map(name).join(', ')} pass the prevLogIndex/prevLogTerm check, append the new entries and ack.`,
      );
    acked.forEach((fs, l) => {
      const L = nodes[l];
      if (L.role !== 'leader') return;
      const top = L.log.length;
      const have = L.matchIndex.filter((m) => m >= top).length;
      if (L.commit < top)
        events.push(
          `${name(l)} records the ack${fs.length > 1 ? 's' : ''} from ${fs.map(name).join(', ')}: index ${top} is on ${have}/5 nodes, short of a majority (3), so commitIndex stays ${L.commit}.`,
        );
    });
    ballots.forEach((c) => {
      const C = nodes[c];
      if (C.role === 'candidate')
        events.push(`${name(c)} has only ${C.votes.size}/5 votes for term ${C.term}: no majority, so no leader. It waits for its timeout and tries again with a higher term.`);
    });
    if (learned.length)
      events.push(
        `${learned.map(name).join(', ')} learn${learned.length === 1 ? 's' : ''} the leader’s commitIndex from AppendEntries and appl${learned.length === 1 ? 'ies' : 'y'} the newly committed entries.`,
      );
    grants.clear();
    appended.clear();
    acked.clear();
    ballots.clear();
    learned.length = 0;

    // ---------- timers ----------
    for (const n of nodes) {
      if (n.role === 'down') continue;
      if (n.role === 'leader') {
        if (t - n.lastBeat >= HEARTBEAT) broadcastAppend(n, t);
        continue;
      }
      if (t >= n.deadline) {
        n.term += 1;
        n.role = 'candidate';
        n.votedFor = n.id;
        n.votes = new Set([n.id]);
        resetTimer(n, t);
        events.push(
          `${name(n.id)}’s election timeout fires: it becomes CANDIDATE for term ${n.term}, votes for itself and sends RequestVote (last log index ${n.log.length}, term ${lastTerm(n.log)}).`,
        );
        notable = true;
        for (let f = 0; f < N; f++)
          if (f !== n.id) send({ from: n.id, to: f, kind: 'RV', term: n.term, lastIndex: n.log.length, lastTerm: lastTerm(n.log) });
      }
    }

    // ---------- predictions that depend on outcomes ----------
    const L1 = leaderNode();
    if (scenario === 'crash' && L1 && L1.term > 1 && !winnerPredictDone) {
      winnerPredictDone = true;
      const hasZ = L1.log.some((e) => e.cmd === 'z=3');
      predict = hasZ
        ? `${name(L1.id)} holds the uncommitted z=3 from term 1. Will it commit z=3 as soon as a majority stores it?`
        : `${name(L1.id)} never received z=3, but S2 still holds it at index 3. What happens to S2’s copy?`;
    }
    if (scenario === 'normal' && L1 && wrote1 && wrote2 && allSynced() && doneTick < 0) doneTick = t;
    if (scenario === 'partition' && healed && allSynced() && doneTick < 0) doneTick = t;
    if (scenario === 'crash' && restarted && allSynced() && doneTick < 0) doneTick = t;

    if (notable) {
      const all = [...scriptEvents, ...events];
      let caption = all.slice(0, 2).join(' ') || 'Heartbeats keep every follower’s election timer from firing.';
      if (all.length > 2) caption += ` (+${all.length - 2} more)`;
      frames.push({ tick: t, nodes: view(t), msgs: sentThisTick, partition, caption: `t=${t}: ${caption}`, predict });
    }
    if (doneTick > 0) {
      const L = leaderNode()!;
      const caption =
        scenario === 'partition'
          ? `Healed: S1 stepped down, its uncommitted y=2 was overwritten, and all five logs now match ${name(L.id)}’s (term ${L.term}). Two leaders existed at once, but never two in the same term.`
          : scenario === 'crash'
            ? `Done: every log matches leader ${name(L.id)} (term ${L.term}) up to commit index ${L.commit}. Each term had at most one leader, and no committed entry was lost.`
            : `All five nodes hold the same log, committed up to index ${L.commit}. A commit needed only a majority (3/5), so the two slowest nodes never delay a write.`;
      frames.push({ tick: t, nodes: view(t), msgs: [], partition, caption });
    }
    if (doneTick > 0) break;
  }
  if (doneTick < 0) {
    const last = frames[frames.length - 1];
    if (spread === 0) {
      last.caption +=
        ' With zero spread every timer fires together, every node votes for itself, and the split vote repeats forever. Randomised timeouts are what break the tie.';
    }
  }
  return frames;
}
