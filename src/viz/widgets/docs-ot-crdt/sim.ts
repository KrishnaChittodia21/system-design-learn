// Pure model of two concurrent single-character edits on "abc" at rev 5 (no React, Node-testable).
//   naive: ops are replayed as-is everywhere (indices go stale).
//   ot   : a central server sequences ops (A's arrives first). An op based on an older revision is
//          transformed against every op committed since (TP1 only, thanks to the total order).
//          A client with an unacknowledged op transforms incoming ops against it the same way.
//          Insert/insert ties at one position are broken by site id (A before B) on both sides.
//   crdt : every character has an immutable id; an insert names its left neighbour's id (its
//          origin) and siblings with the same origin are ordered by (lamport desc, site asc). A
//          delete tombstones an id. Replicas merge in any order and converge.
import type { BaseFrame } from '../../core';

export type Strategy = 'naive' | 'ot' | 'crdt';
export type Scenario = 'ins-del' | 'ins-ins' | 'del-del';

export interface Params {
  strategy: Strategy;
  scenario: Scenario;
}

export const DEFAULT_PARAMS: Params = { strategy: 'ot', scenario: 'ins-del' };
export const BASE = 'abc';
export const BASE_REV = 5;

export type Op = { type: 'ins'; pos: number; ch: string; site: 'A' | 'B' } | { type: 'del'; pos: number; site: 'A' | 'B' } | { type: 'noop'; site: 'A' | 'B' };

export const SCENARIOS: Record<Scenario, { a: Op; b: Op; expect: string; label: string }> = {
  'ins-del': { a: { type: 'ins', pos: 1, ch: 'X', site: 'A' }, b: { type: 'del', pos: 2, site: 'B' }, expect: 'aXb', label: 'A inserts X at 1, B deletes "c" (index 2)' },
  'ins-ins': { a: { type: 'ins', pos: 1, ch: 'X', site: 'A' }, b: { type: 'ins', pos: 1, ch: 'Y', site: 'B' }, expect: 'aXYbc', label: 'A inserts X at 1, B inserts Y at 1' },
  'del-del': { a: { type: 'del', pos: 1, site: 'A' }, b: { type: 'del', pos: 1, site: 'B' }, expect: 'ac', label: 'both delete "b" (index 1)' },
};

export function apply(doc: string, op: Op): string {
  if (op.type === 'ins') return doc.slice(0, op.pos) + op.ch + doc.slice(op.pos);
  if (op.type === 'del') return op.pos < doc.length ? doc.slice(0, op.pos) + doc.slice(op.pos + 1) : doc;
  return doc;
}

/** transform `a` so it applies after `b` (both were generated on the same document) */
export function transform(a: Op, b: Op): Op {
  if (a.type === 'noop' || b.type === 'noop') return a;
  if (a.type === 'ins' && b.type === 'ins') return a.pos < b.pos || (a.pos === b.pos && a.site < b.site) ? a : { ...a, pos: a.pos + 1 };
  if (a.type === 'ins' && b.type === 'del') return a.pos <= b.pos ? a : { ...a, pos: a.pos - 1 };
  if (a.type === 'del' && b.type === 'ins') return a.pos < b.pos ? a : { ...a, pos: a.pos + 1 };
  // del vs del
  if (a.pos < b.pos) return a;
  if (a.pos > b.pos) return { ...a, pos: a.pos - 1 };
  return { type: 'noop', site: a.site };
}

export const opText = (op: Op) => (op.type === 'ins' ? `ins(${op.pos}, '${op.ch}')` : op.type === 'del' ? `del(${op.pos})` : 'no-op');

// ---------- CRDT (causal tree / RGA) ----------
export interface CChar {
  id: string;
  ch: string;
  origin: string | null;
  lamport: number;
  site: string;
  deleted: boolean;
}

export function crdtBase(): CChar[] {
  let prev: string | null = null;
  return [...BASE].map((ch, i) => {
    const c: CChar = { id: `o${i}`, ch, origin: prev, lamport: 0, site: 'O', deleted: false };
    prev = c.id;
    return c;
  });
}

/** linearise: DFS from the virtual root, siblings by (lamport desc, site asc) */
export function crdtOrder(chars: CChar[]): CChar[] {
  const kids = new Map<string | null, CChar[]>();
  for (const c of chars) kids.set(c.origin, [...(kids.get(c.origin) ?? []), c]);
  for (const list of kids.values()) list.sort((x, y) => y.lamport - x.lamport || (x.site < y.site ? -1 : x.site > y.site ? 1 : 0));
  const out: CChar[] = [];
  const walk = (id: string | null) => {
    for (const c of kids.get(id) ?? []) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(null);
  return out;
}
export const crdtText = (chars: CChar[]) =>
  crdtOrder(chars)
    .filter((c) => !c.deleted)
    .map((c) => c.ch)
    .join('');

/** turn an index-based op into a CRDT op on this replica */
export function crdtLocal(chars: CChar[], op: Op, lamport: number): { kind: 'ins'; char: CChar } | { kind: 'del'; id: string } | null {
  const visible = crdtOrder(chars).filter((c) => !c.deleted);
  if (op.type === 'ins') {
    const left = op.pos === 0 ? null : visible[op.pos - 1].id;
    return { kind: 'ins', char: { id: `${op.site}${lamport}`, ch: op.ch, origin: left, lamport, site: op.site, deleted: false } };
  }
  if (op.type === 'del') return { kind: 'del', id: visible[op.pos].id };
  return null;
}
export function crdtApply(chars: CChar[], cop: ReturnType<typeof crdtLocal>): CChar[] {
  if (!cop) return chars;
  if (cop.kind === 'ins') return chars.some((c) => c.id === cop.char.id) ? chars : [...chars, { ...cop.char }];
  return chars.map((c) => (c.id === cop.id ? { ...c, deleted: true } : c));
}

// ---------- frames ----------
export interface DocView {
  text: string;
  rev: number | null;
  /** CRDT only: chars in order with tombstones */
  chars?: { ch: string; id: string; deleted: boolean; fresh: boolean }[];
  pending?: string;
}

export type Arrow = { from: 'A' | 'B' | 'S'; to: 'A' | 'B' | 'S'; label: string; tone: 'accent' | 'warn' | 'good' | 'bad' };

export interface Frame extends BaseFrame {
  A: DocView;
  B: DocView;
  S: DocView | null;
  arrows: Arrow[];
  note: string;
  status: { text: string; tone: 'good' | 'bad' | 'warn' } | null;
}

export function simulate({ strategy, scenario }: Params): Frame[] {
  const sc = SCENARIOS[scenario];
  const frames: Frame[] = [];
  const intro = `Both editors start from "${BASE}" at rev ${BASE_REV}. ${sc.label}, at the same moment. The intended result is "${sc.expect}".`;

  if (strategy === 'crdt') {
    let a = crdtBase();
    let b = crdtBase();
    const fresh = new Set<string>();
    const view = (chars: CChar[]): DocView => ({
      text: crdtText(chars),
      rev: null,
      chars: crdtOrder(chars).map((c) => ({ ch: c.ch, id: c.id, deleted: c.deleted, fresh: fresh.has(c.id) })),
    });
    frames.push({ caption: `${intro} In the CRDT every character carries an id (o0, o1, o2), and edits refer to ids, not indexes.`, A: view(a), B: view(b), S: null, arrows: [], note: 'ids: a=o0 b=o1 c=o2', status: null });
    const ca = crdtLocal(a, sc.a, 1);
    const cb = crdtLocal(b, sc.b, 1);
    a = crdtApply(a, ca);
    b = crdtApply(b, cb);
    const desc = (c: typeof ca) => (!c ? 'nothing' : c.kind === 'ins' ? `insert ${c.char.id} '${c.char.ch}' after ${c.char.origin ?? 'start'}` : `tombstone ${c.id}`);
    if (ca?.kind === 'ins') fresh.add(ca.char.id);
    if (cb?.kind === 'ins') fresh.add(cb.char.id);
    frames.push({
      caption: `Each side applies its own edit locally at once. A's op is "${desc(ca)}"; B's op is "${desc(cb)}". A delete only marks a tombstone, so the id stays available for anyone who refers to it.`,
      A: view(a),
      B: view(b),
      S: null,
      arrows: [],
      note: `A: ${desc(ca)} · B: ${desc(cb)}`,
      status: null,
      predict: 'The two ops are exchanged in opposite orders on each side. Will the replicas agree?',
    });
    b = crdtApply(b, ca);
    frames.push({
      caption: `B receives A's op (via any relay; order does not matter) and integrates it by id: ${desc(ca)}. B now reads "${crdtText(b)}".`,
      A: view(a),
      B: view(b),
      S: null,
      arrows: [{ from: 'A', to: 'B', label: desc(ca), tone: 'accent' }],
      note: 'same-origin siblings: lamport desc, then site asc',
      status: null,
    });
    a = crdtApply(a, cb);
    const ok = crdtText(a) === crdtText(b);
    frames.push({
      caption: `A receives B's op and integrates it: ${desc(cb)}. A reads "${crdtText(a)}". ${ok ? `Both replicas converge on "${crdtText(a)}" without any server ordering.` : 'The replicas differ!'}`,
      A: view(a),
      B: view(b),
      S: null,
      arrows: [{ from: 'B', to: 'A', label: desc(cb), tone: 'accent' }],
      note: 'merge = union of chars + tombstones (commutative)',
      status: ok ? { text: `converged: "${crdtText(a)}"`, tone: 'good' } : { text: 'diverged', tone: 'bad' },
    });
    const tomb = crdtOrder(a).filter((c) => c.deleted).length;
    frames.push({
      caption: `Result: "${crdtText(a)}"${crdtText(a) === sc.expect ? ', exactly the intended text' : ''}. The price is metadata: an id per character and ${tomb} tombstone${tomb === 1 ? '' : 's'} that must be garbage-collected later. CRDTs suit offline-first and peer-to-peer editing.`,
      A: view(a),
      B: view(b),
      S: null,
      arrows: [],
      note: `${crdtOrder(a).length} stored characters for ${crdtText(a).length} visible`,
      status: { text: `converged: "${crdtText(a)}"`, tone: 'good' },
    });
    return frames;
  }

  // naive / OT with a central sequencer; A's op reaches the server first
  let aDoc = apply(BASE, sc.a);
  let bDoc = apply(BASE, sc.b);
  let sDoc = BASE;
  const ot = strategy === 'ot';
  frames.push({
    caption: `${intro} A central server orders every op for the doc.`,
    A: { text: BASE, rev: BASE_REV },
    B: { text: BASE, rev: BASE_REV },
    S: { text: BASE, rev: BASE_REV },
    arrows: [],
    note: '',
    status: null,
  });
  frames.push({
    caption: `Both apply their own op locally right away (no waiting for the network): A has "${aDoc}", B has "${bDoc}". Each sends its op tagged baseRev ${BASE_REV}.`,
    A: { text: aDoc, rev: BASE_REV, pending: opText(sc.a) },
    B: { text: bDoc, rev: BASE_REV, pending: opText(sc.b) },
    S: { text: sDoc, rev: BASE_REV },
    arrows: [
      { from: 'A', to: 'S', label: `${opText(sc.a)} @${BASE_REV}`, tone: 'accent' },
      { from: 'B', to: 'S', label: `${opText(sc.b)} @${BASE_REV}`, tone: 'accent' },
    ],
    note: '',
    status: null,
  });
  sDoc = apply(sDoc, sc.a);
  frames.push({
    caption: `A's op arrives first. Its base rev ${BASE_REV} is the latest, so the server applies it as-is: rev ${BASE_REV + 1} = "${sDoc}". It acks A and forwards the op to B.`,
    A: { text: aDoc, rev: BASE_REV + 1 },
    B: { text: bDoc, rev: BASE_REV, pending: opText(sc.b) },
    S: { text: sDoc, rev: BASE_REV + 1 },
    arrows: [
      { from: 'S', to: 'A', label: 'ack rev 6', tone: 'good' },
      { from: 'S', to: 'B', label: `${opText(sc.a)} (rev 6)`, tone: 'accent' },
    ],
    note: '',
    status: null,
    predict: `B's op ${opText(sc.b)} was written against rev ${BASE_REV}, but the doc is now rev ${BASE_REV + 1}. Can the server apply it unchanged?`,
  });
  const bPrime = ot ? transform(sc.b, sc.a) : sc.b;
  sDoc = apply(sDoc, bPrime);
  frames.push({
    caption: ot
      ? `B's op arrives with base rev ${BASE_REV}. The server transforms it against A's op (rev 6): ${opText(sc.b)} → ${opText(bPrime)}${
          bPrime.type === 'noop' ? ' (the character is already gone)' : sc.b.type === 'ins' && sc.a.type === 'ins' ? ' (same position: the tie goes to site A, so B shifts right)' : ''
        }, then commits rev 7 = "${sDoc}" and forwards ${opText(bPrime)} to A.`
      : `B's op arrives and the naive server applies ${opText(sc.b)} unchanged to "${apply(BASE, sc.a)}": rev 7 = "${sDoc}". Index ${sc.b.type === 'noop' ? '' : sc.b.pos} now points at a different character.`,
    A: { text: aDoc, rev: BASE_REV + 1 },
    B: { text: bDoc, rev: BASE_REV, pending: opText(sc.b) },
    S: { text: sDoc, rev: BASE_REV + 2 },
    arrows: [{ from: 'S', to: 'A', label: `${opText(bPrime)} (rev 7)`, tone: ot ? 'warn' : 'bad' }],
    note: ot ? `T(${opText(sc.b)}, ${opText(sc.a)}) = ${opText(bPrime)}` : 'no transform',
    status: null,
  });
  aDoc = apply(aDoc, bPrime);
  const aPrime = ot ? transform(sc.a, sc.b) : sc.a;
  bDoc = apply(bDoc, aPrime);
  const conv = aDoc === bDoc && bDoc === sDoc;
  frames.push({
    caption: ot
      ? `A applies ${opText(bPrime)} → "${aDoc}". B still has its own op unacknowledged, so it transforms the incoming ${opText(sc.a)} against it the same way → ${opText(aPrime)}, and applies it → "${bDoc}". ${conv ? 'Everyone converges.' : 'They differ!'}`
      : `A applies ${opText(bPrime)} → "${aDoc}"; B applies ${opText(sc.a)} → "${bDoc}". ${conv ? `Everyone shows "${aDoc}"` : 'The replicas now disagree'}${conv && aDoc !== sc.expect ? `, but that is not what anyone typed: the intended result was "${sc.expect}"` : ''}.`,
    A: { text: aDoc, rev: BASE_REV + 2 },
    B: { text: bDoc, rev: BASE_REV + 2 },
    S: { text: sDoc, rev: BASE_REV + 2 },
    arrows: [{ from: 'S', to: 'B', label: 'ack rev 7', tone: 'good' }],
    note: ot ? `client B: T(${opText(sc.a)}, ${opText(sc.b)}) = ${opText(aPrime)}` : '',
    status: conv ? (aDoc === sc.expect ? { text: `converged: "${aDoc}"`, tone: 'good' } : { text: `same text, wrong text: "${aDoc}"`, tone: 'warn' }) : { text: `diverged: A "${aDoc}" · S "${sDoc}" · B "${bDoc}"`, tone: 'bad' },
  });
  frames.push({
    caption: ot
      ? `Result: all three show "${aDoc}". Because the server imposes one total order, only TP1 is needed: applying a then T(b, a) equals b then T(a, b). Tie-breaks must be deterministic and identical on server and clients.`
      : conv
        ? `Result: the replicas happen to agree, but on "${aDoc}" instead of "${sc.expect}": a stale index deleted the wrong character. Replaying index-based ops without transforming them breaks intent.`
        : `Result: the replicas diverged and will stay different forever. Index-based ops must be transformed (OT) or replaced by id-based ops (CRDT).`,
    A: { text: aDoc, rev: BASE_REV + 2 },
    B: { text: bDoc, rev: BASE_REV + 2 },
    S: { text: sDoc, rev: BASE_REV + 2 },
    arrows: [],
    note: '',
    status: frames[frames.length - 1].status,
  });
  return frames;
}
