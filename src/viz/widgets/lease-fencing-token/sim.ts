// Pure, deterministic timeline of a lease-based distributed lock and a stop-the-world GC pause.
// Client A takes the lock (token 33) and freezes before writing; if the pause outlives the lease,
// client B takes the lock (token 34) and writes. When A wakes it still believes it holds the lock.
// Only the storage can tell the two writes apart, and only if writes carry a fencing token.
import type { BaseFrame } from '../../core';

export type Mode = 'none' | 'check' | 'fence';
export type Who = 'A' | 'B';

export interface Params {
  /** lease TTL in seconds */
  ttl: number;
  /** length of A's GC pause in seconds */
  pause: number;
  mode: Mode;
}

export const MODE_LABELS: Record<Mode, string> = {
  none: 'no token (SET NX PX)',
  check: 'A re-checks its lease first',
  fence: 'fencing token checked by storage',
};

export const TOKEN: Record<Who, number> = { A: 33, B: 34 };
export const PAUSE_AT = 2;
export const CHECK_AT = 1.5;
export const B_TRIES_AT = 1;

export type EventKind =
  | 'start'
  | 'acquire'
  | 'b-blocked'
  | 'check'
  | 'pause'
  | 'expire'
  | 'write'
  | 'reject'
  | 'release'
  | 'release-noop'
  | 'wake'
  | 'end';

export interface Ev {
  t: number;
  kind: EventKind;
  who?: Who;
  caption: string;
}

export interface Frame extends BaseFrame {
  t: number;
  kind: EventKind;
  who?: Who;
  /** lock holder according to the lock service */
  holder: Who | null;
  /** lease windows actually granted [from, to) */
  leases: { who: Who; from: number; to: number }[];
  pauseFrom: number;
  pauseTo: number;
  /** completed writes on the storage */
  writes: { who: Who; t: number; accepted: boolean; token: number }[];
  storageValue: string;
  storageFence: number;
  /** clients that believe they hold the lock right now */
  believers: Who[];
  corrupted: boolean;
  horizon: number;
}

export function simulate({ ttl, pause, mode }: Params): Frame[] {
  const wakeAt = PAUSE_AT + pause;
  const expires = wakeAt >= ttl; // the lease runs out while A is frozen
  // A's plan: wake, write, release half a second later
  const aWrite = wakeAt;
  const aRelease = wakeAt + 0.5;
  // B polls once a second; it gets the lock when it is free
  const bAcquire = expires ? Math.max(ttl, B_TRIES_AT) : Math.ceil(aRelease);
  const bWrite = bAcquire + 1;
  const bRelease = bAcquire + 2;
  const horizon = Math.max(aRelease, bRelease) + 1;

  const leases: Frame['leases'] = [{ who: 'A', from: 0, to: expires ? ttl : aRelease }, { who: 'B', from: bAcquire, to: bRelease }];

  // storage semantics
  let fence = 0;
  const writes: Frame['writes'] = [];
  const evs: Ev[] = [];

  evs.push({ t: 0, kind: 'acquire', who: 'A', caption: `t=0 s: A acquires the lock with a ${ttl} s lease${mode === 'fence' ? ` and fencing token ${TOKEN.A}` : ' (SET lock A NX PX)'}.` });
  evs.push({ t: B_TRIES_AT, kind: 'b-blocked', who: 'B', caption: `t=${B_TRIES_AT} s: B tries the lock, finds it held and retries every second.` });
  if (mode === 'check') evs.push({ t: CHECK_AT, kind: 'check', who: 'A', caption: `t=${CHECK_AT} s: A checks its lease before writing: ${ttl - CHECK_AT} s left, plenty. It proceeds to write…` });
  evs.push({
    t: PAUSE_AT,
    kind: 'pause',
    who: 'A',
    caption: `t=${PAUSE_AT} s: a stop-the-world GC pause freezes A for ${pause} s, just before its write${mode === 'check' ? ', and after its lease check' : ''}. A cannot notice: no code of its own runs.`,
  });
  if (expires) {
    evs.push({ t: ttl, kind: 'expire', caption: `t=${ttl} s: A's lease expires. The lock service cannot tell a paused client from a dead one, so it frees the lock and B acquires it${mode === 'fence' ? ` with token ${TOKEN.B}` : ''}.` });
  }

  type Pending = { t: number; who: Who; kind: 'write' | 'release' | 'wake' };
  const pend: Pending[] = [
    { t: aWrite, who: 'A', kind: 'write' },
    { t: aRelease, who: 'A', kind: 'release' },
    { t: bWrite, who: 'B', kind: 'write' },
    { t: bRelease, who: 'B', kind: 'release' },
  ];
  if (!expires) evs.push({ t: bAcquire, kind: 'acquire', who: 'B', caption: `t=${bAcquire} s: the lock is free again and B acquires it${mode === 'fence' ? ` with token ${TOKEN.B}` : ''}.` });
  pend.sort((a, b) => a.t - b.t || (a.who === 'A' ? -1 : 1));

  const writeEvs: Ev[] = [];
  for (const p of pend) {
    if (p.kind === 'write') {
      const token = TOKEN[p.who];
      const stale = mode === 'fence' && token < fence;
      if (stale) {
        writes.push({ who: p.who, t: p.t, accepted: false, token });
        writeEvs.push({
          t: p.t,
          kind: 'reject',
          who: p.who,
          caption: `t=${p.t} s: ${p.who === 'A' ? 'A wakes up, still believing it holds the lock, and' : 'B'} writes with token ${token}. The storage has already seen token ${fence}, so ${token} < ${fence}: REJECTED. The zombie write is harmless.`,
        });
      } else {
        const overwrites = writes.some((w) => w.accepted && w.who !== p.who && w.t < p.t) && p.who === 'A';
        writes.push({ who: p.who, t: p.t, accepted: true, token });
        if (mode === 'fence') fence = Math.max(fence, token);
        const aWakeNote = p.who === 'A' ? (expires ? 'A wakes up, unaware its lease expired, and ' : 'A wakes up, its lease still valid, and ') : 'B ';
        writeEvs.push({
          t: p.t,
          kind: 'write',
          who: p.who,
          caption: `t=${p.t} s: ${aWakeNote}writes its report${mode === 'fence' ? ` with token ${token} (≥ ${fence === token ? 'every token seen so far' : fence}, accepted)` : ''}.${
            overwrites ? ` It overwrites B's newer report: two clients both held "the" lock, and the older one won. Data is corrupted, and nothing raised an error.` : ''
          }`,
        });
      }
    } else {
      const own = p.who === 'A' ? !expires : true;
      writeEvs.push({
        t: p.t,
        kind: own ? 'release' : 'release-noop',
        who: p.who,
        caption: own
          ? `t=${p.t} s: ${p.who} releases the lock (compare-and-delete on its own value).`
          : `t=${p.t} s: A tries to release. The safe release script compares values: the key no longer holds A's value, so it deletes nothing${p.t < bRelease ? " and B's lock survives" : ''}.`,
      });
    }
  }
  evs.push(...writeEvs);
  evs.sort((a, b) => a.t - b.t);

  // frames
  const frames: Frame[] = [];
  const writesSoFar: Frame['writes'] = [];
  let curValue = 'v0 (empty report)';
  let curFence = 0;
  const holderAt = (t: number): Who | null => {
    for (const l of leases) if (t >= l.from && t < l.to) return l.who;
    return null;
  };
  const believersAt = (t: number): Who[] => {
    const b: Who[] = [];
    // A believes from acquire until its release attempt
    if (t >= 0 && t < aRelease) b.push('A');
    if (t >= bAcquire && t < bRelease) b.push('B');
    return b;
  };
  const base = (t: number, kind: EventKind, who: Who | undefined, caption: string): Frame => ({
    t,
    kind,
    who,
    holder: holderAt(t),
    leases,
    pauseFrom: PAUSE_AT,
    pauseTo: wakeAt,
    writes: writesSoFar.map((w) => ({ ...w })),
    storageValue: curValue,
    storageFence: curFence,
    believers: believersAt(t),
    corrupted: false,
    horizon,
    caption,
  });

  frames.push(
    base(
      0,
      'start',
      undefined,
      `A and B both want to rewrite the same report, and the lock should make them take turns. Lease TTL ${ttl} s, A's GC pause ${pause} s. Protection: ${MODE_LABELS[mode]}.`,
    ),
  );
  frames[0].believers = [];
  frames[0].holder = null;
  for (const e of evs) {
    if (e.kind === 'write' || e.kind === 'reject') {
      const w = writes.find((x) => x.t === e.t && x.who === e.who)!;
      writesSoFar.push(w);
      if (w.accepted) {
        curValue = `report by ${w.who}`;
        if (mode === 'fence') curFence = Math.max(curFence, w.token);
      }
    }
    frames.push(base(e.t, e.kind, e.who, e.caption));
  }
  // final verdict
  const lastAccepted = writes.filter((w) => w.accepted).sort((a, b) => a.t - b.t).at(-1)!;
  const corrupted = lastAccepted.who === 'A' && writes.some((w) => w.who === 'B' && w.accepted && w.t < lastAccepted.t);
  const overlap = expires && wakeAt > bAcquire;
  const last = frames[frames.length - 1];
  last.corrupted = corrupted;
  last.caption += ` Result: storage holds the ${curValue}${mode === 'fence' ? ` (fence ${curFence})` : ''}. ${
    corrupted
      ? mode === 'check'
        ? 'Checking the lease did not help: the pause struck between the check and the write. Only the resource can reject a stale holder.'
        : 'A stale holder overwrote newer data. TTL locks are fine for efficiency, not for correctness.'
      : !expires
        ? 'The pause was shorter than the lease, so the lock worked. Raise the pause above the TTL to see what a long GC or a VM migration does.'
        : mode === 'fence'
          ? `A and B both believed they held the lock${overlap ? ` between t=${bAcquire} s and t=${wakeAt} s` : ''}, but the storage only accepts increasing tokens, so the result is correct.`
          : 'A woke up before B wrote, so this time the newest write happened to win. Both still believed they held the lock at once; make the pause longer to see the overwrite.'
  }`;
  for (const f of frames) if (f.t >= lastAccepted.t) f.corrupted = corrupted;

  // predictions
  const expIdx = frames.findIndex((f) => f.kind === 'expire');
  if (expIdx > 0) frames[expIdx - 1].predict = `A is frozen and its ${ttl} s lease is about to run out. What does the lock service do, and what will A believe when it wakes?`;
  const aWriteIdx = frames.findIndex((f) => (f.kind === 'write' || f.kind === 'reject') && f.who === 'A');
  if (aWriteIdx > 0 && !frames[aWriteIdx - 1].predict && expires) frames[aWriteIdx - 1].predict = `A wakes up next and writes with ${mode === 'fence' ? `token ${TOKEN.A}` : 'no token'}. Does the storage accept it?`;
  return frames;
}
