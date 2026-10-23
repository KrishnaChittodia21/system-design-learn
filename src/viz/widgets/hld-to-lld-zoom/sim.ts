// Pure frame builder for the HLD → LLD zoom: the topic's URL-shortener walk down the 8 rungs
// (requirements → API → entities → class diagram → interfaces → patterns → concurrency →
// extensibility), with the custom-alias race played message by message, either as a naive
// find-then-save or with the repository's atomic insertIfAbsent. No React here.
import type { BaseFrame } from '../../core';

export type AliasMode = 'naive' | 'atomic';
export interface Params {
  alias: AliasMode;
}

export type Rung = 'hld' | 'req' | 'api' | 'entities' | 'classes' | 'seams' | 'patterns' | 'race' | 'ext';

export const RUNGS: { id: Rung; n: number; label: string }[] = [
  { id: 'hld', n: 0, label: 'HLD' },
  { id: 'req', n: 1, label: 'Requirements' },
  { id: 'api', n: 2, label: 'API' },
  { id: 'entities', n: 3, label: 'Entities' },
  { id: 'classes', n: 4, label: 'Class diagram' },
  { id: 'seams', n: 5, label: 'Interfaces' },
  { id: 'patterns', n: 6, label: 'Patterns' },
  { id: 'race', n: 7, label: 'Concurrency' },
  { id: 'ext', n: 8, label: 'Extensibility' },
];

/** HLD components scored on the topic's selection heuristic */
export const CRITERIA = ['rules', 'state', 'varies', 'race', 'ours'] as const;
export const CANDIDATES: { name: string; score: boolean[]; why: string }[] = [
  { name: 'ShorteningService', score: [true, true, true, true, true], why: 'alias rules, expiry, 3 generators, alias race' },
  { name: 'RedirectSvc', score: [false, false, false, false, true], why: 'thin cache-aside read: mention it' },
  { name: 'Analytics pipeline', score: [false, false, true, false, true], why: 'async consumer of click events' },
  { name: 'KV LinkStore', score: [false, false, false, true, false], why: 'bought infra: an interface' },
  { name: 'API gateway', score: [false, false, false, false, false], why: 'plumbing' },
];

export interface Msg {
  from: 'A' | 'B' | 'svc' | 'repo';
  to: 'A' | 'B' | 'svc' | 'repo';
  label: string;
  tone: 'call' | 'ok' | 'bad';
}

export interface Frame extends BaseFrame {
  rung: Rung;
  /** concurrency rung: messages shown so far */
  msgs: Msg[];
  /** concurrency rung: stored row for alias 'sale' */
  stored: string | null;
}

export function simulate(p: Params): Frame[] {
  const frames: Frame[] = [];
  const add = (rung: Rung, caption: string, extra: Partial<Frame> = {}, predict?: string) =>
    frames.push({ rung, msgs: [], stored: null, caption, predict, ...extra });

  add(
    'hld',
    'Start at the HLD. Five of the boxes are plumbing. Score each on rule density, state, variation, contention and ownership: ShorteningService wins, so that is the box to zoom into. Say why out loud.',
    {},
    'Which box would you go deep on, and which would you treat as an interface?',
  );
  add('req', 'Rung 1, requirements (3 minutes): functional, non-functional and an explicit out-of-scope list. Expiry and custom aliases are in; auth and custom domains are out.');
  add('api', 'Rung 2, API / use cases: each use case becomes a public method of the service class. Three operations are enough for this slice.');
  add('entities', 'Rung 3, entities: nouns become classes, verbs become methods. ShortLink has identity (its code); ShortCode, TargetUrl and ClickEvent are value objects validated on construction.');
  add('classes', 'Rung 4, class diagram: the service orchestrates; ShortLink owns its value objects (composition) and keeps behaviour with data, e.g. isExpired(now).');
  add('seams', 'Rung 5, interfaces at the seams: exactly where the HLD had arrows to other boxes (store, ID generator, analytics) and where tests need control (clock).');
  add('patterns', 'Rung 6, patterns only where something varies: Strategy for code generation, Repository for storage, Observer so analytics never blocks a redirect.');

  // rung 7: two users claim the custom alias "sale" at the same moment
  const msgs: Msg[] = [];
  const race = (m: Msg, caption: string, stored: string | null, predict?: string) => {
    msgs.push(m);
    add('race', caption, { msgs: [...msgs], stored }, predict);
  };
  if (p.alias === 'naive') {
    race({ from: 'A', to: 'svc', label: "shorten(url1, alias 'sale')", tone: 'call' }, 'Rung 7, concurrency: Ann and Bo both ask for the alias “sale” at the same moment.', null);
    race({ from: 'svc', to: 'repo', label: "findByCode('sale') [A]", tone: 'call' }, 'Naive check-then-act: the service first looks the alias up for Ann…', null);
    race({ from: 'repo', to: 'svc', label: 'null → free', tone: 'ok' }, '…it is free. But the save is behind an await, so the event loop can now run Bo’s request.', null, 'Bo’s request runs the same lookup now. What does it see?');
    race({ from: 'B', to: 'svc', label: "shorten(url2, alias 'sale')", tone: 'call' }, 'Bo’s request starts while Ann’s is suspended.', null);
    race({ from: 'svc', to: 'repo', label: "findByCode('sale') [B]", tone: 'call' }, 'Bo’s lookup runs before Ann’s save lands.', null);
    race({ from: 'repo', to: 'svc', label: 'null → free (stale)', tone: 'bad' }, 'Also free: both requests have passed the check.', null);
    race({ from: 'svc', to: 'repo', label: "save('sale' → url1)", tone: 'call' }, 'Ann’s save lands.', 'url1 (Ann)');
    race({ from: 'svc', to: 'repo', label: "save('sale' → url2)", tone: 'bad' }, 'Bo’s save overwrites it: last write wins.', 'url2 (Bo)');
    race({ from: 'svc', to: 'B', label: '201 /sale', tone: 'ok' }, 'Bo gets 201 Created…', 'url2 (Bo)');
    race(
      { from: 'svc', to: 'A', label: '201 /sale (now points to url2!)', tone: 'bad' },
      '…and so does Ann. Both got 201 Created, and Ann’s printed flyers now redirect to Bo’s page. The check and the write must be one atomic step.',
      'url2 (Bo)',
    );
  } else {
    race({ from: 'A', to: 'svc', label: "shorten(url1, alias 'sale')", tone: 'call' }, 'Rung 7, concurrency: Ann and Bo both ask for the alias “sale” at the same moment.', null);
    race(
      { from: 'svc', to: 'repo', label: "insertIfAbsent('sale' → url1)", tone: 'call' },
      'The repository contract has one atomic primitive, insertIfAbsent: in-process it is synchronous code with no await between check and set; in Postgres or DynamoDB it is a UNIQUE key or attribute_not_exists.',
      null,
      'Bo’s insertIfAbsent arrives a moment later. What does it return?',
    );
    race({ from: 'repo', to: 'svc', label: 'true (inserted)', tone: 'ok' }, 'Ann’s insert wins and the row exists.', 'url1 (Ann)');
    race({ from: 'B', to: 'svc', label: "shorten(url2, alias 'sale')", tone: 'call' }, 'Bo’s request runs.', 'url1 (Ann)');
    race({ from: 'svc', to: 'repo', label: "insertIfAbsent('sale' → url2)", tone: 'call' }, 'Same atomic call for Bo.', 'url1 (Ann)');
    race({ from: 'repo', to: 'svc', label: 'false (exists)', tone: 'bad' }, 'Returns false: no overwrite is possible.', 'url1 (Ann)');
    race(
      { from: 'svc', to: 'B', label: '409 AliasTakenError', tone: 'bad' },
      'Exactly one winner, and Bo gets a typed error he can act on. Same guarantee across pods, because the database enforces it.',
      'url1 (Ann)',
    );
  }

  add('ext', 'Rung 8, extensibility: rehearse follow-ups and show they are additive. Expiry uses the Clock already injected, analytics is one more listener, a new generator is one more strategy. Nothing existing is edited.');
  return frames;
}
