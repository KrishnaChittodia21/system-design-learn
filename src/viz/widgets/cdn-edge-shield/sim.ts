// Pure, deterministic simulation of a global CDN: users in four regions hit their nearest edge
// PoP; misses fill from an origin shield (in the origin's region) or straight from the origin.
// One step = 10 s of wall-clock time. Latencies are time-to-first-byte in ms over warm connections.
import type { BaseFrame } from '../../core';

export type RegionId = 'mum' | 'fra' | 'gru' | 'iad';
export type Event = 'deploy' | 'purge' | 'outage';
export type Outcome = 'hit' | 'stale' | 'shield' | 'origin' | 'error';

export interface Params {
  /** Cache-Control max-age in seconds */
  ttl: number;
  /** tiered caching: PoPs fill from the shield instead of the origin */
  shield: boolean;
  /** stale-while-revalidate=60 + stale-if-error */
  stale: boolean;
  /** what happens at t = EVENT_AT */
  event: Event;
}

export interface Region {
  id: RegionId;
  city: string;
  /** user ↔ edge PoP round trip */
  userRtt: number;
  /** PoP ↔ origin region (where the shield and origin live) round trip */
  longHaul: number;
  /** this region's users send a request every `every` seconds starting at `offset` */
  every: number;
  offset: number;
}

export const REGIONS: Region[] = [
  { id: 'mum', city: 'Mumbai', userRtt: 10, longHaul: 200, every: 10, offset: 0 },
  { id: 'fra', city: 'Frankfurt', userRtt: 8, longHaul: 90, every: 20, offset: 0 },
  { id: 'gru', city: 'São Paulo', userRtt: 12, longHaul: 120, every: 30, offset: 10 },
  { id: 'iad', city: 'Virginia', userRtt: 5, longHaul: 2, every: 20, offset: 10 },
];

export const STEP_S = 10;
export const STEPS = 16; // t = 0 … 150 s
export const EVENT_AT = 60;
export const OUTAGE_END = 110; // origin answers 5xx for 60 ≤ t < 110
export const SWR_WINDOW = 60;
export const SHIELD_TO_ORIGIN = 2;
export const ORIGIN_WORK = 80;
export const ERROR_MS = 5000; // the edge gives up on the origin and answers 502

export const EVENT_LABELS: Record<Event, string> = {
  deploy: 'deploy v2, no purge',
  purge: 'deploy v2 + purge',
  outage: 'origin outage',
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  hit: 'edge HIT',
  stale: 'served STALE',
  shield: 'edge MISS → shield HIT',
  origin: 'MISS → origin',
  error: '502 error',
};

/** A cached copy. `born` is when the origin generated it, so Age = t − born (the Age header). */
export interface Entry {
  version: number;
  born: number;
}

export interface Req {
  region: RegionId;
  outcome: Outcome;
  latency: number;
  version: number | null;
  /** Age of the copy served, in seconds */
  age: number | null;
  /** a background revalidation went upstream for this request */
  bgRefresh: boolean;
  /** this request caused an origin fetch (foreground or background) */
  originFetch: boolean;
}

export type CacheState = 'empty' | 'fresh' | 'stale' | 'expired';

export interface CacheView {
  version: number | null;
  age: number | null;
  state: CacheState;
}

export interface Frame extends BaseFrame {
  t: number | null;
  reqs: Req[];
  pops: Record<RegionId, CacheView>;
  shieldCache: CacheView;
  originVersion: number;
  originDown: boolean;
  originFetches: number;
  total: number;
  edgeHits: number;
  staleServed: number;
  oldVersionServed: number;
  errors: number;
  latencySum: Record<RegionId, number>;
  latencyCount: Record<RegionId, number>;
}

function view(e: Entry | null, t: number, ttl: number, stale: boolean): CacheView {
  if (!e) return { version: null, age: null, state: 'empty' };
  const age = t - e.born;
  const state: CacheState = age < ttl ? 'fresh' : stale && age < ttl + SWR_WINDOW ? 'stale' : 'expired';
  return { version: e.version, age, state };
}

export function requestsAt(t: number): RegionId[] {
  return REGIONS.filter((r) => t >= r.offset && (t - r.offset) % r.every === 0).map((r) => r.id);
}

export function simulate({ ttl, shield, stale, event }: Params): Frame[] {
  const pops: Record<RegionId, Entry | null> = { mum: null, fra: null, gru: null, iad: null };
  let shieldEntry: Entry | null = null;
  let originVersion = 1;
  let originFetches = 0;
  let total = 0;
  let edgeHits = 0;
  let staleServed = 0;
  let oldVersionServed = 0;
  let errors = 0;
  const latencySum: Record<RegionId, number> = { mum: 0, fra: 0, gru: 0, iad: 0 };
  const latencyCount: Record<RegionId, number> = { mum: 0, fra: 0, gru: 0, iad: 0 };
  const frames: Frame[] = [];

  const snapshot = (t: number | null, reqs: Req[], caption: string): Frame => {
    const at = t ?? 0;
    return {
      t,
      reqs,
      pops: {
        mum: view(pops.mum, at, ttl, stale),
        fra: view(pops.fra, at, ttl, stale),
        gru: view(pops.gru, at, ttl, stale),
        iad: view(pops.iad, at, ttl, stale),
      },
      shieldCache: view(shieldEntry, at, ttl, stale),
      originVersion,
      originDown: event === 'outage' && t !== null && t >= EVENT_AT && t < OUTAGE_END,
      originFetches,
      total,
      edgeHits,
      staleServed,
      oldVersionServed,
      errors,
      latencySum: { ...latencySum },
      latencyCount: { ...latencyCount },
      caption,
    };
  };

  frames.push(
    snapshot(
      null,
      [],
      `Cold caches. Every PoP is empty; the origin lives in Virginia and serves v1 with Cache-Control: max-age=${ttl}${stale ? `, stale-while-revalidate=${SWR_WINDOW}, stale-if-error` : ''}. ${shield ? 'PoPs fill from an origin shield next to the origin.' : 'No shield: every PoP fills straight from the origin.'}`,
    ),
  );

  for (let step = 0; step < STEPS; step++) {
    const t = step * STEP_S;
    const down = event === 'outage' && t >= EVENT_AT && t < OUTAGE_END;
    const notes: string[] = [];
    if (t === EVENT_AT && event !== 'outage') {
      originVersion = 2;
      if (event === 'purge') {
        pops.mum = pops.fra = pops.gru = pops.iad = null;
        shieldEntry = null;
        notes.push('The origin deploys v2 and purges the URL: every PoP and the shield drop their copy.');
      } else {
        notes.push(`The origin deploys v2. Nobody tells the caches: copies of v1 stay "fresh" until their max-age runs out.`);
      }
    }
    if (t === EVENT_AT && event === 'outage') notes.push(`The origin starts answering 5xx (until t=${OUTAGE_END}s).`);
    if (t === OUTAGE_END && event === 'outage') notes.push('The origin recovers.');

    /** Fetch from the origin. Returns null when it is down. */
    const fromOrigin = (): Entry | null => {
      originFetches++;
      return down ? null : { version: originVersion, born: t };
    };

    /** The PoP's upstream fetch: through the shield (tiered) or direct. */
    const upstream = (r: Region): { entry: Entry | null; outcome: Outcome; latency: number; origin: boolean } => {
      if (shield) {
        const sv = view(shieldEntry, t, ttl, stale);
        if (sv.state === 'fresh') return { entry: shieldEntry, outcome: 'shield', latency: r.longHaul, origin: false };
        const got = fromOrigin();
        if (got) {
          shieldEntry = got;
          return { entry: got, outcome: 'origin', latency: r.longHaul + SHIELD_TO_ORIGIN + ORIGIN_WORK, origin: true };
        }
        // origin down: the shield may still answer with its stale copy (stale-if-error)
        if (stale && shieldEntry) return { entry: shieldEntry, outcome: 'stale', latency: r.longHaul + SHIELD_TO_ORIGIN, origin: true };
        return { entry: null, outcome: 'error', latency: ERROR_MS, origin: true };
      }
      const got = fromOrigin();
      if (got) return { entry: got, outcome: 'origin', latency: r.longHaul + ORIGIN_WORK, origin: true };
      return { entry: null, outcome: 'error', latency: ERROR_MS, origin: true };
    };

    const reqs: Req[] = [];
    for (const id of requestsAt(t)) {
      const r = REGIONS.find((x) => x.id === id)!;
      const pv = view(pops[id], t, ttl, stale);
      let req: Req;
      if (pv.state === 'fresh') {
        req = { region: id, outcome: 'hit', latency: r.userRtt, version: pv.version, age: pv.age, bgRefresh: false, originFetch: false };
      } else if (pv.state === 'stale') {
        // serve the stale copy now; revalidate in the background (the user does not wait)
        const before = originFetches;
        const up = upstream(r);
        if (up.entry && up.outcome !== 'stale') pops[id] = up.entry;
        req = { region: id, outcome: 'stale', latency: r.userRtt, version: pv.version, age: pv.age, bgRefresh: true, originFetch: originFetches > before };
      } else {
        const before = originFetches;
        const up = upstream(r);
        if (up.entry) pops[id] = up.entry;
        let outcome = up.outcome;
        let entry = up.entry;
        let latency = r.userRtt + up.latency;
        if (!entry && stale && pops[id]) {
          // stale-if-error at the edge itself
          entry = pops[id];
          outcome = 'stale';
          latency = r.userRtt + r.longHaul;
        }
        req = {
          region: id,
          outcome,
          latency,
          version: entry ? entry.version : null,
          age: entry ? t - entry.born : null,
          bgRefresh: false,
          originFetch: originFetches > before,
        };
      }
      total++;
      if (req.outcome === 'hit') edgeHits++;
      if (req.outcome === 'stale') staleServed++;
      if (req.outcome === 'error') errors++;
      if (req.version !== null && req.version < originVersion) oldVersionServed++;
      latencySum[id] += req.latency;
      latencyCount[id]++;
      reqs.push(req);
    }

    const describe = (q: Req) => {
      const city = REGIONS.find((x) => x.id === q.region)!.city;
      const v = q.version === null ? '' : ` v${q.version}${q.version < originVersion ? ' (old!)' : ''}`;
      const age = q.age === null ? '' : `, Age ${q.age}s`;
      switch (q.outcome) {
        case 'hit':
          return `${city}: HIT${v}${age}, ${q.latency} ms`;
        case 'stale':
          return `${city}: STALE${v}${age} in ${q.latency} ms${q.bgRefresh ? (down ? ' (background refresh failed, origin down)' : ' + background refresh') : ' (stale-if-error)'}`;
        case 'shield':
          return `${city}: MISS → shield HIT${v}${age}, ${q.latency} ms`;
        case 'origin':
          return `${city}: MISS → ${shield ? 'shield MISS → ' : ''}origin${v}, ${q.latency} ms`;
        default:
          return `${city}: 502 after ${q.latency / 1000}s, no copy to fall back on`;
      }
    };
    const caption = `t=${t}s. ${notes.join(' ')}${notes.length ? ' ' : ''}${reqs.map(describe).join('; ')}. Origin fetches so far: ${originFetches}.`;
    frames.push(snapshot(t, reqs, caption));
  }

  // predictions
  const evFrameIdx = frames.findIndex((f) => f.t === EVENT_AT);
  if (evFrameIdx > 0) {
    frames[evFrameIdx - 1].predict =
      event === 'outage'
        ? `At t=${EVENT_AT}s the origin starts failing. ${stale ? 'Stale serving is on.' : 'Stale serving is off.'} What do users whose PoP copy has expired get?`
        : event === 'purge'
          ? `At t=${EVENT_AT}s the origin deploys v2 and purges. What happens to the next request in every region, and to the origin?`
          : `At t=${EVENT_AT}s the origin deploys v2 but does not purge. How long can a region keep seeing v1?`;
  }
  const firstShield = frames.findIndex((f) => f.reqs.some((q) => q.outcome === 'shield'));
  if (firstShield > 1 && !frames[firstShield - 1].predict && firstShield - 1 !== evFrameIdx - 1) {
    frames[firstShield - 1].predict = `A second region misses next. Does that cost another long trip to the origin?`;
  }

  const last = frames[frames.length - 1];
  const ratio = total ? Math.round((edgeHits / total) * 100) : 0;
  last.caption += ` Summary: ${total} requests, ${ratio}% edge hits, ${originFetches} origin fetches${staleServed ? `, ${staleServed} served stale` : ''}${oldVersionServed ? `, ${oldVersionServed} served the old version after the deploy` : ''}${errors ? `, ${errors} errors` : ''}.`;
  return frames;
}
