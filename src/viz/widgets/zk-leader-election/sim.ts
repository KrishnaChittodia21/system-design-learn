// Pure, scripted model of ZooKeeper leader election with EPHEMERAL_SEQUENTIAL znodes.
// 'crash': the leader's process stalls, its session expires, the ephemeral node is deleted, the
//          watch fires (only on the successor, or on everyone = herd), the next node leads, and
//          a fencing token rejects the old leader when it wakes up.
// 'ghost-naive' / 'ghost-protected': a create succeeds on the server but the reply is lost
//          (CONNECTIONLOSS). A blind retry leaves a ghost node owned by a live session; Curator's
//          protection mode (GUID in the name, list children before retrying) finds it.
import type { BaseFrame } from '../../core';

export type Scenario = 'crash' | 'ghost-naive' | 'ghost-protected';
export type WatchMode = 'predecessor' | 'parent';

export interface Params {
  clients: number;
  watch: WatchMode;
  scenario: Scenario;
}

export interface ZNode {
  seq: number;
  owner: number;
  /** created by a request whose reply the owner never saw */
  ghost: boolean;
  guid: string | null;
}

export type ClientState = 'idle' | 'leader' | 'waiting' | 'stalled' | 'expired' | 'confused';

export interface ClientView {
  id: number;
  state: ClientState;
  /** seq of the znode this client believes is its own */
  mine: number | null;
  /** seq it watches, -1 = watches the parent's children, null = none */
  watching: number | null;
}

export interface Frame extends BaseFrame {
  znodes: ZNode[];
  clients: ClientView[];
  /** clients that received a watch event in this step */
  notified: number[];
  /** getChildren reads caused by this step */
  reads: number;
  zxid: number;
  /** fencing token of the current leader (its znode seq), and a stale write being rejected */
  fence: { leaderToken: number | null; rejected: number | null };
  sessionNote: string | null;
}

export const seqName = (s: number) => `n_${String(s).padStart(10, '0')}`;
export const cname = (c: number) => `C${c + 1}`;

/** arrival order of create requests (deterministic, not by client id) */
export function arrival(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  // rotate so C2 arrives first: client ids and sequence numbers are unrelated
  return [...order.slice(1), order[0]];
}

export function lowest(znodes: ZNode[]): ZNode | undefined {
  return [...znodes].sort((a, b) => a.seq - b.seq)[0];
}
export function predecessorOf(znodes: ZNode[], seq: number): ZNode | undefined {
  return [...znodes].filter((z) => z.seq < seq).sort((a, b) => b.seq - a.seq)[0];
}

export function simulate({ clients: N, watch, scenario }: Params): Frame[] {
  const frames: Frame[] = [];
  const znodes: ZNode[] = [];
  const clients: ClientView[] = Array.from({ length: N }, (_, id) => ({ id, state: 'idle', mine: null, watching: null }));
  let zxid = 0x700000000 + 0x1f0;
  let nextSeq = 0;
  let leaderToken: number | null = null;
  const push = (caption: string, extra: Partial<Frame> = {}) =>
    frames.push({
      caption,
      znodes: znodes.map((z) => ({ ...z })),
      clients: clients.map((c) => ({ ...c })),
      notified: [],
      reads: 0,
      zxid,
      fence: { leaderToken, rejected: null },
      sessionNote: null,
      ...extra,
    });
  const create = (owner: number, ghost = false, guid: string | null = null) => {
    const z = { seq: nextSeq++, owner, ghost, guid };
    znodes.push(z);
    zxid++;
    return z;
  };
  /** every live client re-reads children and decides: lowest → leader, else watch */
  const decide = (who: number[]) => {
    const low = lowest(znodes);
    for (const id of who) {
      const c = clients[id];
      if (c.mine === null || c.state === 'stalled' || c.state === 'expired') continue;
      if (low && low.seq === c.mine) {
        c.state = 'leader';
        c.watching = null;
        leaderToken = c.mine;
      } else {
        c.state = c.state === 'confused' ? 'confused' : 'waiting';
        c.watching = watch === 'parent' ? -1 : (predecessorOf(znodes, c.mine)?.seq ?? null);
      }
    }
  };

  push(`An ensemble holds the persistent node /election. ${N} clients want to elect one leader. Every write (create, delete) goes through the ZAB leader and gets the next zxid.`, {
    predict: 'How should the clients agree on a leader without talking to each other?',
  });

  const order = arrival(N);
  const ghostClient = order[0]; // the first arrival suffers CONNECTIONLOSS
  let ghostSeq = -1;
  const ghostMode = scenario !== 'crash';
  for (const id of order) {
    if (ghostMode && id === ghostClient) {
      const guid = scenario === 'ghost-protected' ? 'a1f3' : null;
      ghostSeq = create(id, true, guid).seq;
    } else {
      clients[id].mine = create(id).seq;
    }
  }
  if (!ghostMode) {
    push(
      `Each client creates /election/n_ as EPHEMERAL_SEQUENTIAL. The server appends a counter, so arrival order (${order.map(cname).join(', ')}) decides the numbers, not client ids. Ephemeral = deleted automatically when the owner's session ends.`,
    );
  } else {
    push(
      `Each client creates /election/${scenario === 'ghost-protected' ? '_c_<guid>-' : ''}n_ as EPHEMERAL_SEQUENTIAL. ${cname(ghostClient)}'s create SUCCEEDS on the server as ${seqName(ghostSeq)}, but the reply is lost: the client sees CONNECTIONLOSS and does not know whether the node exists.`,
      { sessionNote: `${cname(ghostClient)}: CONNECTIONLOSS (session still alive)` },
    );
    const g = clients[ghostClient];
    if (scenario === 'ghost-naive') {
      g.mine = create(ghostClient).seq;
      g.state = 'confused';
      push(
        `Naive retry: ${cname(ghostClient)} simply creates again and gets ${seqName(g.mine)}. Now it owns TWO nodes but only knows about the second. The first, ${seqName(ghostSeq)}, is a ghost: ephemeral, but its session is alive, so it is never deleted.`,
      );
    } else {
      g.mine = ghostSeq;
      znodes.find((z) => z.seq === ghostSeq)!.ghost = false;
      push(
        `Curator protection mode: the name carries ${cname(ghostClient)}'s GUID (_c_a1f3-). After CONNECTIONLOSS it lists /election's children, finds _c_a1f3-${seqName(ghostSeq)}, and adopts it instead of creating a duplicate.`,
        { reads: 1 },
      );
    }
  }

  decide(order);
  const leader = clients.find((c) => c.state === 'leader');
  const low = lowest(znodes)!;
  const ghostLowestOwnerless = ghostMode && scenario === 'ghost-naive' && low.ghost;
  push(
    (leader ? `getChildren + sort: ${seqName(low.seq)} is lowest → ${cname(leader.id)} is LEADER (fencing token ${low.seq}). ` : '') +
      (ghostLowestOwnerless
        ? `getChildren + sort: the lowest node is the ghost ${seqName(low.seq)}. Its owner ${cname(ghostClient)} thinks its node is ${seqName(clients[ghostClient].mine!)} and waits. Nobody is leader until ${cname(ghostClient)}'s session ends, maybe never. `
        : '') +
      (watch === 'predecessor'
        ? 'Every other client sets ONE watch on the node just before its own (exists + watch). No herd.'
        : 'Every other client watches the whole /election children list: simple, but every change will wake all of them.'),
    { reads: clients.filter((c) => c.mine !== null).length },
  );

  if (ghostMode) {
    if (scenario === 'ghost-naive') {
      push(
        `Stuck. The lowest node belongs to a live, healthy session whose owner ignores it, and every other client waits behind it. An ephemeral node lives exactly as long as the session that created it. Fix: Curator protection mode, or close the session (deleting both nodes) and start over.`,
      );
    } else {
      push(`One node per client, no ghost. Protection mode costs one extra getChildren after a connection loss and removes a whole class of stuck elections.`);
    }
    return frames;
  }

  // crash scenario: the leader stalls (long GC pause / network partition)
  const L = leader!;
  L.state = 'stalled';
  push(
    `${cname(L.id)} (leader) stalls: a 20 s GC pause. Its connection drops, but connection loss is not session expiry: its ephemeral node ${seqName(L.mine!)} still exists and nobody is notified yet.`,
    { sessionNote: `session timeout 10 s (tickTime 2 s): ${cname(L.id)} has ~10 s left` },
  );
  // session expires → delete
  const gone = L.mine!;
  znodes.splice(
    znodes.findIndex((z) => z.seq === gone),
    1,
  );
  zxid++;
  L.state = 'expired';
  const watchers =
    watch === 'parent'
      ? clients.filter((c) => c.state === 'waiting').map((c) => c.id)
      : clients.filter((c) => c.state === 'waiting' && c.watching === gone).map((c) => c.id);
  for (const id of watchers) clients[id].watching = null; // one-shot: the watch is consumed by the event
  push(
    `10 s later the ENSEMBLE expires ${cname(L.id)}'s session and deletes ${seqName(gone)} (zxid +1). Watch events fire: ${watchers.map(cname).join(', ')} ${watchers.length === 1 ? 'is' : 'are'} notified` +
      (watch === 'parent' ? `: all ${watchers.length} waiters wake up and each issues getChildren: a thundering herd that grows with N.` : `: only the successor, one event, one read.`) +
      ' Watches are one-shot: each must re-read to re-register.',
    { notified: watchers, reads: watchers.length, sessionNote: `${cname(L.id)}: session expired` },
  );
  decide(watchers);
  const nl = clients.find((c) => c.state === 'leader')!;
  push(
    `${cname(nl.id)} re-reads the children: its ${seqName(nl.mine!)} is now lowest → new LEADER with fencing token ${nl.mine} (> ${gone}).` +
      (watch === 'parent' ? ` The other ${watchers.length - 1} woke up for nothing and re-registered their watches.` : ' The other waiters never noticed.'),
  );
  push(
    `${cname(L.id)} wakes from its pause still believing it leads, and writes to storage with token ${gone}. Storage has already seen token ${nl.mine}, so it rejects ${gone}. The lock alone cannot stop a paused ex-leader; the fencing token does.`,
    { fence: { leaderToken: nl.mine!, rejected: gone }, sessionNote: `${cname(L.id)}: woke up, session already gone` },
  );
  return frames;
}
