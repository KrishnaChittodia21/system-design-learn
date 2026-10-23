// Pure model of the 45-minute system-design interview: a vague prompt becomes scope, numbers,
// an API, entities, a high-level design, a deep dive and a wrap-up. The breadth/depth split
// depends on the level you are interviewing for (mid ≈ 80/20, senior ≈ 60/40, staff ≈ 40/60).
import type { BaseFrame } from '../../core';

export type Level = 'mid' | 'senior' | 'staff';
export type Prompt = 'shortener' | 'tickets' | 'feed';
export type PhaseId = 'scope' | 'hld' | 'deep' | 'wrap';
export const PHASES: PhaseId[] = ['scope', 'hld', 'deep', 'wrap'];
export const PHASE_NAME: Record<PhaseId, string> = {
  scope: '1 · Scope & requirements',
  hld: '2 · High-level design',
  deep: '3 · Deep dive',
  wrap: '4 · Wrap up',
};
/** recommended range per phase in minutes (from the framework table) */
export const RANGE: Record<PhaseId, [number, number]> = { scope: [3, 10], hld: [10, 15], deep: [10, 25], wrap: [3, 5] };
export const TOTAL = 45;
export const WRAP_MIN = 5;
/** share of the breadth/depth minutes spent on breadth */
export const BREADTH: Record<Level, number> = { mid: 0.8, senior: 0.6, staff: 0.4 };
export const LEVEL_NAME: Record<Level, string> = { mid: 'Mid (80/20)', senior: 'Senior (60/40)', staff: 'Staff (40/60)' };

export interface Params {
  prompt: Prompt;
  level: Level;
}

export function budget(level: Level): Record<PhaseId, number> {
  const core = TOTAL - WRAP_MIN; // 40 minutes of breadth + depth
  const breadth = Math.round(core * BREADTH[level]);
  const scope = Math.round(breadth * 0.4);
  return { scope, hld: breadth - scope, deep: core - breadth, wrap: WRAP_MIN };
}

export function outOfRange(level: Level): PhaseId[] {
  const b = budget(level);
  return PHASES.filter((p) => b[p] < RANGE[p][0] || b[p] > RANGE[p][1]);
}

export type Kind = 'fr' | 'clarify' | 'nfr' | 'estimate' | 'api' | 'entities' | 'design' | 'checkin' | 'dive' | 'tradeoff' | 'wrapup' | 'next';
export const KIND_LABEL: Record<Kind, string> = {
  fr: 'Functional requirements',
  clarify: 'Clarifying question',
  nfr: 'Non-functional (SLOs)',
  estimate: 'Estimate',
  api: 'API',
  entities: 'Core entities',
  design: 'Read & write paths',
  checkin: 'Check-in',
  dive: 'Deep dive',
  tradeoff: 'Decision + trade-off',
  wrapup: 'Bottlenecks & failures',
  next: 'Monitoring & next 10×',
};
const PHASE_OF: Record<Kind, PhaseId> = {
  fr: 'scope',
  clarify: 'scope',
  nfr: 'scope',
  estimate: 'scope',
  api: 'hld',
  entities: 'hld',
  design: 'hld',
  checkin: 'hld',
  dive: 'deep',
  tradeoff: 'deep',
  wrapup: 'wrap',
  next: 'wrap',
};
export const KINDS = Object.keys(PHASE_OF) as Kind[];

export const PROMPT_NAME: Record<Prompt, string> = {
  shortener: 'Design a URL shortener',
  tickets: 'Design Ticketmaster',
  feed: 'Design a news feed',
};

const CONTENT: Record<Prompt, Record<Kind, string>> = {
  shortener: {
    fr: 'Create a short link for a long URL · redirect short → long · optional custom alias and expiry. Out of scope: analytics dashboards, accounts.',
    clarify: '“Can a link’s target ever change?” No → redirects are cacheable forever at the edge.',
    nfr: 'Redirect p99 < 50 ms · 99.99% available for redirects · codes never collide · 100:1 reads to writes.',
    estimate: '100M new links/month ≈ 40 writes/s · ≈ 4K redirects/s, ~20K at peak · 100M × 500 B × 60 months ≈ 3 TB.',
    api: 'POST /urls {longUrl, alias?, expiresAt?} → 201 {code} · GET /{code} → 302 Location.',
    entities: 'Link(code PK, longUrl, ownerId, createdAt, expiresAt).',
    design: 'Write: API → code generator → KV store. Read: CDN → Redis → KV store, 302 back to the browser.',
    checkin: '“Does this look reasonable before I go deeper on code generation?”',
    dive: 'Generating unique codes: hash + collision check vs random + retry vs pre-allocated counter ranges per server.',
    tradeoff: 'Counter ranges, base62-encoded: no coordination per write; shuffle the bits so codes are not guessable. 302 not 301 if click analytics ever matter.',
    wrapup: 'A viral link is a hot key → edge cache. If Redis dies, 20K/s lands on the store: keep it sized for that.',
    next: 'Alert on redirect p99 and 404 rate. At 10×: shard the KV store by code.',
  },
  tickets: {
    fr: 'Browse events and seat maps · hold seats for 10 min · book (pay for) held seats. Out of scope: resale, dynamic pricing.',
    clarify: '“Can two people ever hold the same seat?” Never → seat holds need strong consistency.',
    nfr: 'Zero double-booking · seat map p99 < 200 ms · survive 50K hold attempts/s on one event · 99.9% browse availability.',
    estimate: 'Hot on-sale: 50K holds/s against 50K seats, contention concentrated on a few hundred rows; browse reads 100× that but cacheable.',
    api: 'GET /events/{id}/seats · POST /holds {eventId, seatIds} → {holdId, expiresAt} · POST /bookings {holdId} + Idempotency-Key.',
    entities: 'Event · Seat(eventId, seatId, status, holdId, version) · Hold(id, userId, expiresAt) · Booking.',
    design: 'Read: CDN-cached seat map + availability cache. Write: hold service → conditional update on Seat → payments.',
    checkin: '“Before going deeper: I’d like to spend the dive on seat contention. Or is there an area you prefer?”',
    dive: 'Seat contention: UPDATE … WHERE status = free (optimistic) vs Redis SETNX holds with TTL vs a virtual waiting room.',
    tradeoff: 'Waiting room meters admits; conditional update in Postgres is the source of truth, Redis only a fast pre-check. Would flip to Redis-first if the DB could not take the admit rate.',
    wrapup: 'Hot event row is the bottleneck. Payment timeout → hold expiry releases the seat. Oversell count must stay 0.',
    next: 'Watch hold success rate and waiting-room depth. At 10×: partition seats by event section.',
  },
  feed: {
    fr: 'Post · follow · read a reverse-chronological home feed. Out of scope: ads ranking, stories.',
    clarify: '“Are there accounts with 10M+ followers?” Yes → pure fan-out-on-write will not work for them.',
    nfr: 'Feed p99 < 300 ms · a post visible to followers within 5 s (eventual is fine) · 99.95% for reads.',
    estimate: '100M DAU × 10 feed reads ÷ 10⁵ ≈ 10K QPS, ~30K peak · 100M × 0.5 posts ÷ 10⁵ ≈ 500 posts/s.',
    api: 'POST /posts · GET /feed?cursor=…&limit=20 · POST /follows/{userId}.',
    entities: 'User · Post(id, authorId, body, createdAt) · Follow(follower, followee) · FeedItem(userId, postId, ts).',
    design: 'Write: post service → posts DB → queue → fan-out workers → per-user feed cache. Read: feed service → feed cache → hydrate posts.',
    checkin: '“That’s the skeleton. I’d go deep on fan-out next. Sound right?”',
    dive: 'Fan-out on write (fast reads, write amplification) vs on read (cheap writes, slow reads) for a 10M-follower account.',
    tradeoff: 'Hybrid: push for normal accounts, pull-and-merge for celebrities at read time. The threshold (~100K followers) is the knob.',
    wrapup: 'Fan-out queue lag is the bottleneck during celebrity posts. Feed cache down → rebuild from the follow graph, degrade to recent posts.',
    next: 'Alert on fan-out lag and feed p99. At 10×: shard feed cache by user, move ranking offline.',
  },
};

export interface Item {
  kind: Kind;
  phase: PhaseId;
  /** minute it starts */
  at: number;
  text: string;
}

export interface Frame extends BaseFrame {
  /** minutes elapsed */
  clock: number;
  /** items revealed so far */
  shown: number;
  items: Item[];
  budget: Record<PhaseId, number>;
}

export function schedule(p: Params): Item[] {
  const b = budget(p.level);
  const items: Item[] = [];
  let start = 0;
  for (const ph of PHASES) {
    const ks = KINDS.filter((k) => PHASE_OF[k] === ph);
    ks.forEach((k, i) => items.push({ kind: k, phase: ph, at: Math.round((start + (b[ph] * i) / ks.length) * 10) / 10, text: CONTENT[p.prompt][k] }));
    start += b[ph];
  }
  return items;
}

const mm = (m: number) => `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, '0')}`;

export function simulate(p: Params): Frame[] {
  const b = budget(p.level);
  const items = schedule(p);
  const off = outOfRange(p.level);
  const frames: Frame[] = [
    {
      clock: 0,
      shown: 0,
      items,
      budget: b,
      caption: `Minute 0: “${PROMPT_NAME[p.prompt]}.” That is all you get. At ${LEVEL_NAME[p.level]} you plan ${b.scope} min of scope, ${b.hld} of high-level design, ${b.deep} of deep dive and ${b.wrap} to wrap up.${off.length ? ` ${off.map((x) => PHASE_NAME[x].slice(4)).join(' and ')} fall${off.length === 1 ? 's' : ''} outside the recommended range.` : ''}`,
      predict: 'What do you write on the board before drawing a single box?',
    },
  ];
  items.forEach((it, i) => {
    let caption = `${mm(it.at)} · ${KIND_LABEL[it.kind]}: ${it.text}`;
    let predict: string | undefined;
    if (it.kind === 'estimate') caption += ' Estimate only as far as it changes a decision.';
    if (it.kind === 'checkin') {
      caption += ` Buy-in is cheap at minute ${Math.round(it.at)} and expensive at minute 35.`;
      predict = 'Which component deserves the deep dive, given the NFRs you wrote down?';
    }
    if (it.kind === 'dive') {
      caption += b.deep < RANGE.deep[0] ? ` Only ${b.deep} minutes left for depth: not enough to defend a trade-off with numbers, and the interviewer will have to steer. That is the down-level signal.` : ` ${b.deep} minutes for depth: enough to defend a trade-off with numbers.`;
    }
    if (it.kind === 'tradeoff') caption += ' Decide, then say what would flip the decision.';
    frames.push({ clock: it.at, shown: i + 1, items, budget: b, caption, predict });
  });
  frames.push({
    clock: TOTAL,
    shown: items.length,
    items,
    budget: b,
    caption: `45:00. The same four steps at every level; what changes is who drives and where the minutes go. ${p.level === 'staff' ? 'Staff: scope proposed in minute 5, the crux named early, most of the time spent defending one hard decision.' : p.level === 'senior' ? 'Senior: a complete design with one solid deep dive.' : 'Mid: a broad, correct design; the depth is where the next level is won.'}`,
  });
  return frames;
}
