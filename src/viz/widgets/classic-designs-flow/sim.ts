// Pure simulations for three classic designs (no React here):
//   1. URL shortener: code generation (counter → base62, scrambled counter, hash + collision retry)
//      and the redirect hot path (edge → Redis → DB, 301 vs 302, negative caching, async analytics).
//   2. Snowflake IDs: 41-bit ms | 5-bit datacenter | 5-bit worker | 12-bit sequence, including
//      sequence overflow inside one millisecond and the clock moving backwards.
//   3. Notification fan-out: outbox → API (idempotency claim, preferences) → per-channel queues →
//      workers → providers, with error classification, backoff + jitter, circuit-breaker failover, DLQ.
import { rng, type BaseFrame } from '../../core';

export type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'muted' | 'mag';

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  tone: Tone;
}

export interface Line {
  text: string;
  tone?: Tone;
}

export interface FlowFrame extends BaseFrame {
  /** highlighted components this step */
  active: Record<string, Tone>;
  /** arrows travelled this step */
  edges: FlowEdge[];
}

// ---------------------------------------------------------------------------------------------
// base62 + code generation
// ---------------------------------------------------------------------------------------------

export const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const CODE_LEN = 7;
/** 62^7 ≈ 3.5 trillion codes */
export const SPACE = 62n ** 7n;
/** Knuth's multiplicative constant: odd and not a multiple of 31, so it is invertible mod 62^7. */
export const SCRAMBLE_K = 2654435761n;

export function toBase62(n: bigint): string {
  if (n < 0n) throw new Error('negative');
  if (n === 0n) return '0';
  let s = '';
  let x = n;
  while (x > 0n) {
    s = BASE62[Number(x % 62n)] + s;
    x /= 62n;
  }
  return s;
}

export function fromBase62(s: string): bigint {
  let n = 0n;
  for (const c of s) {
    const d = BASE62.indexOf(c);
    if (d < 0) throw new Error(`not base62: ${c}`);
    n = n * 62n + BigInt(d);
  }
  return n;
}

export const pad7 = (s: string) => s.padStart(CODE_LEN, '0');

/** The repeated divide-by-62 that produces the digits (least significant first). */
export function base62Steps(n: bigint): { n: bigint; q: bigint; r: number; ch: string }[] {
  const out: { n: bigint; q: bigint; r: number; ch: string }[] = [];
  let x = n;
  do {
    const r = Number(x % 62n);
    out.push({ n: x, q: x / 62n, r, ch: BASE62[r] });
    x /= 62n;
  } while (x > 0n);
  return out;
}

/** Bijective scramble of a counter: consecutive ids map to unrelated-looking codes, still collision-free. */
export function scramble(id: bigint): bigint {
  return (id * SCRAMBLE_K) % SPACE;
}

export function fnv1a32(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** hash(url + salt) → 64 bits → mod 62^7 → 7 base62 characters */
export function hashCode(url: string, salt = ''): string {
  const s = url + salt;
  const v = (BigInt(fnv1a32(s)) << 32n) | BigInt(fnv1a32(s, 0x9747b28c));
  return pad7(toBase62(v % SPACE));
}

// ---------------------------------------------------------------------------------------------
// 1. URL shortener
// ---------------------------------------------------------------------------------------------

export type CodeGen = 'counter' | 'scramble' | 'hash';
export type Redirect = '301' | '302';

export interface UrlParams {
  gen: CodeGen;
  redirect: Redirect;
}

export const LONG_URL = 'https://shop.example.com/sale/diwali-2026?ref=mail';
export const OTHER_URL = 'https://blog.example.org/2025/03/a-very-old-post';
/** first id of the range this API server leased (125 billion links already exist) */
export const RANGE_START = 125_000_000_000n;
export const RANGE_SIZE = 10_000n;
export const FIRST_ID = RANGE_START + 42n;

export interface UrlStats {
  /** clicks people actually made */
  clicks: number;
  /** requests that reached our edge */
  edgeHits: number;
  dbReads: number;
  cacheHits: number;
  cacheMisses: number;
  /** clicks that reached analytics */
  counted: number;
}

export interface UrlFrame extends FlowFrame {
  code: string;
  panelTitle: string;
  panel: Line[];
  stats: UrlStats;
  cache: { key: string; val: string; neg?: boolean }[];
  browserCached: boolean;
}

export function simulateUrl({ gen, redirect }: UrlParams): UrlFrame[] {
  const frames: UrlFrame[] = [];
  const stats: UrlStats = { clicks: 0, edgeHits: 0, dbReads: 0, cacheHits: 0, cacheMisses: 0, counted: 0 };
  const cache: { key: string; val: string; neg?: boolean }[] = [];
  let code = '';
  let browserCached = false;
  let panelTitle = 'Code generation';
  let panel: Line[] = [];

  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, code, panelTitle, panel: panel.map((l) => ({ ...l })), stats: { ...stats }, cache: cache.map((c) => ({ ...c })), browserCached });

  const genIntro: Record<CodeGen, string> = {
    counter: 'Codes come from a counter: each API server leases a block of 10,000 ids and writes each id in base62 (0-9, a-z, A-Z).',
    scramble: 'Codes come from a counter, but each id is multiplied by a large odd constant mod 62^7 first: still collision-free (a permutation), no longer guessable.',
    hash: 'Codes come from hashing the URL: take 64 bits of the hash, reduce mod 62^7 and keep 7 base62 characters. No coordination, but collisions must be caught.',
  };
  snap({}, [], `Two paths. Create is rare (~1.2K/s); redirect is the hot path (~100× more). ${genIntro[gen]}`);

  snap({ client: 'accent', api: 'accent' }, [{ from: 'client', to: 'api', label: 'POST /links', tone: 'accent' }], `A user shortens ${LONG_URL}. The API service checks the scheme, blocks known-bad domains and applies a per-API-key rate limit.`);

  if (gen === 'hash') {
    const c1 = hashCode(LONG_URL);
    panelTitle = 'hash + truncate';
    panel = [
      { text: `h = fnv64(url) = …` },
      { text: `h mod 62^7 → base62 → "${c1}"`, tone: 'accent' },
    ];
    code = c1;
    snap({ api: 'accent', idgen: 'accent' }, [{ from: 'api', to: 'idgen', label: 'hash(url)', tone: 'accent' }], `Hash the URL to 64 bits, reduce mod 62^7 (3.5 trillion codes) and encode: "${c1}". No counter and no coordinator needed.`);
    panel.push({ text: `INSERT "${c1}" ON CONFLICT → 0 rows (taken by another URL)`, tone: 'bad' });
    snap(
      { api: 'accent', db: 'bad' },
      [{ from: 'api', to: 'db', label: 'INSERT … ON CONFLICT', tone: 'bad' }],
      `INSERT … ON CONFLICT DO NOTHING inserts 0 rows: "${c1}" already maps to ${OTHER_URL}. (The demo store is seeded with that row; at 365B links in a 3.5T space, collisions are routine.)`,
      'The code is taken by a different URL. What should the API do: fail, overwrite, or something else?',
    );
    const c2 = hashCode(LONG_URL, '#1');
    code = c2;
    panel.push({ text: `retry: hash(url + "#1") → "${c2}"`, tone: 'accent' });
    snap({ api: 'accent', idgen: 'accent' }, [{ from: 'api', to: 'idgen', label: 'hash(url+"#1")', tone: 'accent' }], `Append a salt and rehash: "${c2}". The unique constraint is the source of truth; a check-then-insert would race with a concurrent writer.`);
    panel.push({ text: `INSERT "${c2}" ON CONFLICT → 1 row ✓`, tone: 'good' });
    snap({ api: 'accent', db: 'good' }, [{ from: 'api', to: 'db', label: 'INSERT ok', tone: 'good' }], `The second INSERT … ON CONFLICT DO NOTHING writes 1 row: "${c2}" → long URL is stored, on the shard that owns the code.`);
  } else {
    panelTitle = gen === 'counter' ? 'id → base62 (divide by 62, read remainders upward)' : 'id → scramble → base62';
    panel = [{ text: `leased range [${RANGE_START.toLocaleString('en-US')} … +${(RANGE_SIZE - 1n).toLocaleString('en-US')}]` }];
    snap(
      { api: 'accent', idgen: 'accent' },
      [{ from: 'api', to: 'idgen', label: 'lease 10K ids', tone: 'accent' }],
      `This server's previous block ran out, so it leases the next 10,000 ids with one round-trip (an UPDATE … RETURNING on a counter row). The next 10K links need no coordination at all.`,
    );
    const id = FIRST_ID;
    if (gen === 'counter') {
      code = toBase62(id);
      const steps = base62Steps(id);
      panel = [
        { text: `id = ${id.toLocaleString('en-US')}` },
        ...steps.map((s) => ({ text: `${s.n} ÷ 62 = ${s.q} r ${s.r} → '${s.ch}'` })),
        { text: `read upward → "${code}"  (next id → "${toBase62(id + 1n)}")`, tone: 'accent' as Tone },
      ];
      snap({ api: 'accent' }, [], `Take id ${id.toLocaleString('en-US')} from memory and divide by 62 repeatedly; the remainders, read bottom-up, are the digits: "${code}". 7 characters cover 62^7 ≈ 3.5 trillion links. Weakness: the next link is "${toBase62(id + 1n)}", so a scraper can walk every link.`);
    } else {
      const s = scramble(id);
      code = pad7(toBase62(s));
      const nextCode = pad7(toBase62(scramble(id + 1n)));
      panel = [
        { text: `id = ${id.toLocaleString('en-US')}` },
        { text: `id × ${SCRAMBLE_K} mod 62^7` },
        { text: `= ${s.toLocaleString('en-US')}` },
        { text: `base62 → "${code}"`, tone: 'accent' },
        { text: `id + 1 → "${nextCode}" (unrelated)`, tone: 'good' },
        { text: `plain base62 would give "${toBase62(id)}", "${toBase62(id + 1n)}"`, tone: 'muted' },
      ];
      snap({ api: 'accent' }, [], `Multiply id ${id.toLocaleString('en-US')} by ${SCRAMBLE_K} mod 62^7 and encode: "${code}". The constant is odd and not a multiple of 31, so the map is a permutation: no two ids collide, but id+1 gives "${nextCode}", nothing like it.`);
    }
    snap({ api: 'accent', db: 'good' }, [{ from: 'api', to: 'db', label: 'INSERT', tone: 'good' }], `INSERT "${code}" → long URL into the DB, sharded by code. Counter codes never collide, so there is no retry loop.`);
  }

  snap({ api: 'good', client: 'good' }, [{ from: 'api', to: 'client', label: `201 sho.rt/${code}`, tone: 'good' }], `201 Created: sho.rt/${code}. Now the link goes viral, and every click takes the redirect path below.`);

  // click 1: cold
  stats.clicks++;
  stats.edgeHits++;
  stats.counted++;
  snap({ client: 'accent', edge: 'accent' }, [{ from: 'client', to: 'edge', label: `GET /${code}`, tone: 'accent' }], `Click 1. The browser asks the edge for /${code}. The edge records a click event (country, user agent, referrer) without waiting on anything.`);
  stats.cacheMisses++;
  snap({ edge: 'accent', redirect: 'accent', redis: 'warn' }, [{ from: 'edge', to: 'redirect', tone: 'accent' }, { from: 'redirect', to: 'redis', label: 'GET: miss', tone: 'warn' }], `The redirect service asks Redis for "${code}": miss, the link is brand new.`);
  stats.dbReads++;
  cache.push({ key: code, val: 'shop.example.com/sale/…' });
  snap({ redirect: 'accent', db: 'accent', redis: 'good' }, [{ from: 'redirect', to: 'db', label: 'SELECT (replica)', tone: 'accent' }, { from: 'redirect', to: 'redis', label: 'SET ttl', tone: 'good' }], `Read it from a DB replica, then fill Redis. With Zipf-distributed clicks, caching the hottest ~20% of links serves 90%+ of redirects.`);
  if (redirect === '301') browserCached = true;
  snap(
    { redirect: 'good', client: 'good', kafka: 'mag' },
    [{ from: 'redirect', to: 'client', label: `${redirect} Location`, tone: 'good' }, { from: 'edge', to: 'kafka', label: 'click event', tone: 'mag' }],
    redirect === '301'
      ? '301 Moved Permanently with the long URL. The browser caches a 301 indefinitely. The click event goes to Kafka asynchronously; it never blocks the redirect.'
      : '302 Found with the long URL. A 302 is not cached by default, so the next click comes back to us. The click event goes to Kafka asynchronously.',
    `The same person clicks the link again tomorrow. Does that request reach your edge under ${redirect}?`,
  );

  // click 2: same browser
  stats.clicks++;
  if (redirect === '301') {
    snap({ client: 'warn' }, [], 'Click 2, same browser: the cached 301 sends it straight to the long URL. Zero load on us, and zero analytics: this click is invisible. You also can never change where this link points for this user.');
  } else {
    stats.edgeHits++;
    stats.cacheHits++;
    stats.counted++;
    snap(
      { client: 'accent', edge: 'accent', redirect: 'accent', redis: 'good', kafka: 'mag' },
      [{ from: 'client', to: 'edge', label: `GET /${code}`, tone: 'accent' }, { from: 'redirect', to: 'redis', label: 'GET: hit', tone: 'good' }, { from: 'edge', to: 'kafka', label: 'click', tone: 'mag' }],
      'Click 2, same browser: it comes back through the edge, Redis hits in ~1 ms, and the click is counted. The cost is one request per click, which is what the cache tier is for.',
    );
  }

  // click 3: someone else
  stats.clicks++;
  stats.edgeHits++;
  stats.cacheHits++;
  stats.counted++;
  snap(
    { client: 'accent', edge: 'accent', redirect: 'accent', redis: 'good', kafka: 'mag' },
    [{ from: 'client', to: 'edge', label: 'new visitor', tone: 'accent' }, { from: 'redirect', to: 'redis', label: 'GET: hit', tone: 'good' }, { from: 'edge', to: 'kafka', label: 'click', tone: 'mag' }],
    `Click 3, a different visitor: Redis hit, no DB read, ${redirect} returned, click counted.`,
  );

  // scanner
  stats.edgeHits++;
  stats.cacheMisses++;
  stats.dbReads++;
  cache.push({ key: 'zzzzzzz', val: '404 (60 s)', neg: true });
  snap(
    { client: 'bad', edge: 'accent', redirect: 'accent', redis: 'warn', db: 'bad' },
    [{ from: 'client', to: 'edge', label: 'GET /zzzzzzz', tone: 'bad' }, { from: 'redirect', to: 'db', label: 'not found', tone: 'bad' }, { from: 'redirect', to: 'redis', label: 'SET 404 ttl 60s', tone: 'warn' }],
    'A scanner probes /zzzzzzz. Redis misses, the DB has no row, so we return 404 and cache the negative result for 60 seconds.',
    'The scanner retries the same unknown code. Which tiers does the second request touch?',
  );
  stats.edgeHits++;
  stats.cacheHits++;
  snap({ client: 'bad', edge: 'accent', redirect: 'accent', redis: 'good' }, [{ from: 'client', to: 'edge', label: 'GET /zzzzzzz', tone: 'bad' }, { from: 'redirect', to: 'redis', label: 'negative hit', tone: 'good' }], 'Second probe: the negative cache answers 404 and the DB is never touched. Without it, scanners would turn every random code into a DB read (add per-IP limits too).');

  snap(
    { kafka: 'mag', ch: 'mag' },
    [{ from: 'kafka', to: 'ch', label: 'per-minute rollups', tone: 'mag' }],
    `Flink rolls click events up per (code, minute) into ClickHouse. Real clicks: ${stats.clicks}; counted: ${stats.counted}${
      redirect === '301' ? ' (the cached 301 click is lost). Choose 301 for cost, 302 (or 301 with a short max-age) when analytics is the product.' : '. 302 keeps analytics exact at the price of one edge request per click.'
    } DB reads: ${stats.dbReads} for ${stats.edgeHits} edge requests.`,
  );
  return frames;
}

// ---------------------------------------------------------------------------------------------
// 2. Snowflake IDs
// ---------------------------------------------------------------------------------------------

/** Twitter's custom epoch (2010-11-04T01:42:54.657Z) */
export const EPOCH = 1288834974657n;
export const T0 = 1792749600000n; // 2026-10-23T10:00:00.000Z
export const MAX_SEQ = 4095;

export type ClockJump = 'small' | 'large';

export interface SnowParams {
  dc: number;
  worker: number;
  jump: ClockJump;
}

export interface SnowId {
  ms: bigint; // wall-clock ms
  dc: number;
  worker: number;
  seq: number;
  id: bigint;
}

export function makeId(ms: bigint, dc: number, worker: number, seq: number): bigint {
  if (dc < 0 || dc > 31 || worker < 0 || worker > 31) throw new Error('dc/worker out of range');
  if (seq < 0 || seq > MAX_SEQ) throw new Error('sequence out of range');
  return ((ms - EPOCH) << 22n) | (BigInt(dc) << 17n) | (BigInt(worker) << 12n) | BigInt(seq);
}

export function decodeId(id: bigint): { ms: bigint; dc: number; worker: number; seq: number } {
  return { ms: (id >> 22n) + EPOCH, dc: Number((id >> 17n) & 31n), worker: Number((id >> 12n) & 31n), seq: Number(id & 4095n) };
}

/** 64-character binary string, most significant bit first */
export function bits64(id: bigint): string {
  return id.toString(2).padStart(64, '0');
}

/**
 * A Snowflake generator: same ms → bump the sequence; sequence exhausted → wait for the next ms;
 * clock behind the last timestamp → wait if the gap is small, refuse if it is large.
 */
export class Snowflake {
  last = -1n;
  seq = 0;
  readonly dc: number;
  readonly worker: number;
  readonly maxBackwardsMs: bigint;
  constructor(dc: number, worker: number, maxBackwardsMs = 5n) {
    this.dc = dc;
    this.worker = worker;
    this.maxBackwardsMs = maxBackwardsMs;
  }
  /** returns the id and the ms it was stamped with, or an error when the clock is far behind */
  next(now: bigint): { ok: true; id: bigint; ms: bigint; waited: bigint } | { ok: false; behindBy: bigint } {
    let t = now;
    let waited = 0n;
    if (t < this.last) {
      const behind = this.last - t;
      if (behind > this.maxBackwardsMs) return { ok: false, behindBy: behind };
      waited += behind;
      t = this.last; // wait it out
    }
    if (t === this.last) {
      if (this.seq >= MAX_SEQ) {
        t = this.last + 1n; // spin to the next millisecond
        waited += 1n;
        this.seq = 0;
      } else this.seq++;
    } else this.seq = 0;
    this.last = t;
    return { ok: true, id: makeId(t, this.dc, this.worker, this.seq), ms: t, waited };
  }
}

export interface SnowFrame extends FlowFrame {
  cur: SnowId | null;
  clock: bigint;
  last: bigint;
  log: { id: bigint; note: string; tone: Tone }[];
  refused: boolean;
}

const iso = (ms: bigint) => new Date(Number(ms)).toISOString().replace('T', ' ').replace('Z', '');

export function simulateSnowflake({ dc, worker, jump }: SnowParams): SnowFrame[] {
  const g = new Snowflake(dc, worker);
  const frames: SnowFrame[] = [];
  const log: { id: bigint; note: string; tone: Tone }[] = [];
  let cur: SnowId | null = null;
  let clock = T0;
  let refused = false;
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, cur: cur && { ...cur }, clock, last: g.last, log: log.slice(-6).map((l) => ({ ...l })), refused });
  const gen = (now: bigint, note: string, tone: Tone = 'accent') => {
    clock = now;
    const r = g.next(now);
    if (!r.ok) return r;
    cur = { ms: r.ms, dc, worker, seq: decodeId(r.id).seq, id: r.id };
    log.push({ id: r.id, note, tone });
    return r;
  };

  snap({}, [], `A Snowflake id is 64 bits: 1 unused sign bit, 41 bits of milliseconds since a custom epoch (2010-11-04, good for ~69.7 years), 5 bits datacenter, 5 bits worker and a 12-bit sequence. This worker is datacenter ${dc}, worker ${worker}: no other machine can produce its ids.`);

  gen(T0, 'first id in this ms');
  snap({ gen: 'accent' }, [{ from: 'app', to: 'gen', label: 'next()', tone: 'accent' }], `At ${iso(T0)} UTC the first request gets sequence 0. The id is (ms − epoch) << 22 | dc << 17 | worker << 12 | seq = ${cur!.id}.`);
  gen(T0, 'same ms, seq 1');
  snap({ gen: 'accent' }, [{ from: 'app', to: 'gen', label: 'next()', tone: 'accent' }], 'Same millisecond again: the timestamp bits are identical, so only the sequence moves (1). Still unique, and still larger than the previous id.');
  gen(T0, 'same ms, seq 2');
  snap({ gen: 'accent' }, [{ from: 'app', to: 'gen', label: 'next()', tone: 'accent' }], 'Sequence 2. Up to 4,096 ids fit in one millisecond on one worker (≈ 4M ids/s per worker).');
  gen(T0 + 1n, 'next ms, seq resets');
  snap({ gen: 'good' }, [{ from: 'app', to: 'gen', label: 'next()', tone: 'good' }], 'The clock ticks to the next millisecond: the sequence resets to 0 and the timestamp field grows by 1, which adds 2^22 = 4,194,304 to the id. Ids sort by time.');

  // burst that exhausts the sequence
  clock = T0 + 2n;
  for (let i = 0; i <= MAX_SEQ; i++) g.next(T0 + 2n);
  cur = { ms: T0 + 2n, dc, worker, seq: MAX_SEQ, id: makeId(T0 + 2n, dc, worker, MAX_SEQ) };
  log.push({ id: cur.id, note: 'burst: seq 0…4095 used', tone: 'warn' });
  snap(
    { gen: 'warn' },
    [{ from: 'app', to: 'gen', label: '4,096 × next()', tone: 'warn' }],
    'A burst of 4,096 requests lands inside one millisecond: sequences 0 … 4,095 are used. All 12 sequence bits are now 1.',
    'A 4,097th request arrives in the same millisecond. The sequence cannot go to 4,096. What does the generator do?',
  );
  const r = gen(T0 + 2n, 'waited 1 ms (overflow)', 'good');
  snap({ gen: 'good' }, [{ from: 'app', to: 'gen', label: 'next()', tone: 'good' }], `Wrapping to 0 would repeat the first id of this millisecond, so the generator spins until the clock reads the next ms (waited ${r.ok ? r.waited : 0n} ms) and issues sequence 0 there.`);

  // clock jumps backwards
  const behind = jump === 'small' ? 3n : 20n;
  const now = g.last - behind;
  clock = now;
  snap(
    { gen: 'bad', ntp: 'bad' },
    [{ from: 'ntp', to: 'gen', label: `clock −${behind} ms`, tone: 'bad' }],
    `NTP steps the system clock back ${behind} ms (or the VM is live-migrated). The clock now reads earlier than the last timestamp this worker used.`,
    'Using the current clock would stamp ids that already exist. What should the generator do?',
  );
  const r2 = gen(now, 'clock was behind: waited', 'good');
  if (r2.ok) {
    snap({ gen: 'good' }, [{ from: 'app', to: 'gen', label: 'next()', tone: 'good' }], `The gap (${behind} ms) is under the 5 ms tolerance, so it waits ${r2.waited} ms until the clock catches up with the last timestamp and continues that ms's sequence. Never stamp a time ≤ one already used with a reset sequence.`);
  } else {
    refused = true;
    snap(
      { gen: 'bad', app: 'warn' },
      [{ from: 'gen', to: 'app', label: 'refuse + alert', tone: 'bad' }],
      `The clock is ${r2.behindBy} ms behind, over the 5 ms tolerance: the generator refuses to issue ids and alerts. Callers retry on another worker. Run chrony with slewing (no steps) to make this rare.`,
    );
  }
  // decode
  const d = decodeId(cur!.id);
  snap({ gen: 'accent' }, [], `Decoding needs no lookup: shift right 22 → ${iso(d.ms)} UTC; next 5 bits → datacenter ${d.dc}; next 5 → worker ${d.worker}; low 12 → sequence ${d.seq}. Downside: ids leak creation time and rough volume, so do not use them for invoice numbers.`);
  snap({ gen: 'accent', zk: 'accent' }, [{ from: 'zk', to: 'gen', label: `lease worker ${worker}`, tone: 'accent' }], `Uniqueness rests on (datacenter, worker) never being used by two live pods. In Kubernetes, lease the worker id from etcd/ZooKeeper with a TTL and stop generating if the lease is lost. 41 bits of ms from a 2010 epoch overflow around 2080.`);
  return frames;
}

// ---------------------------------------------------------------------------------------------
// 3. Notification fan-out
// ---------------------------------------------------------------------------------------------

export type SmsProvider = 'healthy' | 'flaky' | 'outage' | 'invalid';

export interface NotifyParams {
  sms: SmsProvider;
  maxAttempts: number;
  secondary: boolean;
}

/** base backoff schedule in seconds: 1, 4, 16, 64 … (×4), then ±20% jitter */
export function backoffSeconds(attempt: number, rand: () => number): number {
  const base = 4 ** (attempt - 1);
  return +(base * (0.8 + 0.4 * rand())).toFixed(1);
}

export const BREAKER_AFTER = 3;

export interface Attempt {
  n: number;
  at: number; // seconds after first send
  provider: 'Twilio' | 'MSG91';
  result: string;
  tone: Tone;
}

export interface NotifyFrame extends FlowFrame {
  claims: { key: string; state: string; tone: Tone }[];
  queues: { name: string; items: string[] }[];
  attempts: Attempt[];
  sent: { push: number; sms: number; email: number };
  dlq: string[];
  breaker: 'closed' | 'open';
}

export interface NotifyOutcome {
  smsDelivered: boolean;
  smsCalls: number;
  dlq: boolean;
  attempts: Attempt[];
}

/** The SMS delivery decision alone: used by the simulation and the unit tests. */
export function smsOutcome({ sms, maxAttempts, secondary }: NotifyParams, seed = 7): NotifyOutcome {
  const rand = rng(seed);
  const attempts: Attempt[] = [];
  let t = 0;
  let failures = 0;
  let provider: 'Twilio' | 'MSG91' = 'Twilio';
  for (let n = 1; n <= maxAttempts; n++) {
    if (n > 1) t = +(t + backoffSeconds(n - 1, rand)).toFixed(1);
    if (sms === 'invalid') {
      attempts.push({ n, at: t, provider, result: '400 invalid number: do not retry', tone: 'bad' });
      return { smsDelivered: false, smsCalls: n, dlq: false, attempts };
    }
    const fails = provider === 'Twilio' && (sms === 'outage' || (sms === 'flaky' && n <= 2));
    if (!fails) {
      attempts.push({ n, at: t, provider, result: '200 accepted', tone: 'good' });
      return { smsDelivered: true, smsCalls: n, dlq: false, attempts };
    }
    failures++;
    attempts.push({ n, at: t, provider, result: sms === 'outage' ? 'timeout' : '503', tone: 'warn' });
    if (failures >= BREAKER_AFTER && secondary && provider === 'Twilio') provider = 'MSG91';
  }
  return { smsDelivered: false, smsCalls: maxAttempts, dlq: true, attempts };
}

export function simulateNotify(params: NotifyParams): NotifyFrame[] {
  const frames: NotifyFrame[] = [];
  const out = smsOutcome(params);
  const claims: { key: string; state: string; tone: Tone }[] = [];
  const queues = [
    { name: 'push.tx', items: [] as string[] },
    { name: 'sms.tx', items: [] as string[] },
    { name: 'email.tx', items: [] as string[] },
    { name: 'push.bulk', items: ['campaign ×50M'] },
  ];
  const attempts: Attempt[] = [];
  const sent = { push: 0, sms: 0, email: 0 };
  const dlq: string[] = [];
  let breaker: 'closed' | 'open' = 'closed';
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({
      active,
      edges,
      caption,
      predict,
      claims: claims.map((c) => ({ ...c })),
      queues: queues.map((q) => ({ name: q.name, items: [...q.items] })),
      attempts: attempts.map((a) => ({ ...a })),
      sent: { ...sent },
      dlq: [...dlq],
      breaker,
    });

  snap({}, [], 'The order service ships order #981 for user u42. The notification system is a post office: it routes, retries and respects preferences; Apple, Google, Twilio and SES do the actual delivery. A 50M-user marketing campaign is draining in the bulk lane at the same time.');
  snap({ svc: 'accent', api: 'accent' }, [{ from: 'svc', to: 'api', label: 'outbox → order.shipped', tone: 'accent' }], 'The order row and an outbox row were committed in one transaction; a relay publishes "order.shipped" (event e-981). Without the outbox a crash between the two would lose the notification or send one for an order that never committed.');
  claims.push({ key: 'e-981:u42:push', state: 'claimed', tone: 'accent' }, { key: 'e-981:u42:sms', state: 'claimed', tone: 'accent' });
  snap(
    { api: 'accent', prefs: 'accent' },
    [{ from: 'api', to: 'prefs', label: 'SET NX + prefs', tone: 'accent' }],
    'The API claims an idempotency key per (event, user, channel) with SET NX EX 86400, and reads preferences: push on, SMS on (transactional), email opted out. Email is skipped; opt-outs are never violated.',
  );
  queues[0].items.push('e-981');
  queues[1].items.push('e-981');
  snap(
    { api: 'accent', queues: 'accent' },
    [{ from: 'api', to: 'queues', label: 'publish push.tx, sms.tx', tone: 'accent' }],
    'It publishes to the transactional lane of each channel. Per-channel queues isolate an SES outage from push; separate tx and bulk lanes stop the 50M campaign from delaying this message (or an OTP).',
  );
  queues[0].items.shift();
  sent.push++;
  snap({ queues: 'accent', pushw: 'good', apns: 'good' }, [{ from: 'queues', to: 'pushw', tone: 'accent' }, { from: 'pushw', to: 'apns', label: '200', tone: 'good' }], 'The push worker renders the template (≤ 4 KB payload), looks up u42\'s device tokens and calls APNs/FCM: 200. Push delivered; claim marked sent.');
  claims[0] = { key: 'e-981:u42:push', state: 'sent', tone: 'good' };

  queues[1].items.shift();
  let calls = 0;
  for (const a of out.attempts) {
    calls++;
    attempts.push(a);
    const provNode = a.provider === 'Twilio' ? 'twilio' : 'msg91';
    if (a.tone === 'good') {
      sent.sms++;
      claims[1] = { key: 'e-981:u42:sms', state: 'sent', tone: 'good' };
      snap({ smsw: 'good', [provNode]: 'good' }, [{ from: 'smsw', to: provNode, label: `attempt ${a.n}: 200`, tone: 'good' }], `Attempt ${a.n} at t=${a.at}s via ${a.provider}: accepted. SMS delivered after ${calls} provider call${calls === 1 ? '' : 's'} (and paid for once).`);
    } else if (a.tone === 'bad') {
      claims[1] = { key: 'e-981:u42:sms', state: 'invalid', tone: 'bad' };
      snap({ smsw: 'bad', [provNode]: 'bad' }, [{ from: 'smsw', to: provNode, label: '400 invalid', tone: 'bad' }], `${a.provider} answers 400: the number is invalid. A 4xx like this will never succeed, so the worker does not retry; it marks the contact invalid (APNs 410 Unregistered tokens are pruned the same way).`);
    } else {
      const next = out.attempts[a.n];
      const switching = next && next.provider !== a.provider;
      if (switching) breaker = 'open';
      const tail = next
        ? switching
          ? ` That is ${BREAKER_AFTER} failures in a row: the circuit breaker on ${a.provider} opens and the retry goes to the secondary, ${next.provider}, at t=${next.at}s.`
          : ` Retryable (429/5xx/timeout): back off and retry at t=${next.at}s (1 s, 4 s, 16 s … ±20% jitter so retries do not synchronise).`
        : '';
      snap(
        { smsw: 'warn', [provNode]: 'bad' },
        [{ from: 'smsw', to: provNode, label: `attempt ${a.n}: ${a.result}`, tone: 'bad' }],
        `Attempt ${a.n} at t=${a.at}s via ${a.provider}: ${a.result}.${tail}`,
        a.n === 1 ? 'The provider failed. Should the worker retry immediately, and how many times?' : undefined,
      );
    }
  }
  if (out.dlq) {
    dlq.push('e-981:u42:sms');
    claims[1] = { key: 'e-981:u42:sms', state: 'dead', tone: 'bad' };
    snap({ smsw: 'bad', dlq: 'bad' }, [{ from: 'smsw', to: 'dlq', label: `after ${params.maxAttempts} attempts`, tone: 'bad' }], `${params.maxAttempts} attempts used${params.secondary ? '' : ' and no secondary provider to fail over to'}: the message goes to the dead-letter queue and on-call is alerted. It is parked, not lost; it can be replayed once SMS recovers.`);
  }

  // duplicate delivery of the same event
  snap(
    { svc: 'warn', api: 'warn' },
    [{ from: 'svc', to: 'api', label: 'e-981 again', tone: 'warn' }],
    'The relay crashed before recording its offset, so it publishes e-981 again: at-least-once delivery means duplicates are normal.',
    'The same event arrives twice. Does the user get a second SMS?',
  );
  snap(
    { api: 'good', prefs: 'good' },
    [{ from: 'api', to: 'prefs', label: 'SET NX → exists', tone: 'good' }],
    `SET NX fails for both keys: they are already claimed (push: sent, SMS: ${claims[1].state}). The API checks the stored status instead of resending. No second SMS: exactly-once is impossible, at-least-once + an idempotency key is the contract.`,
  );
  snap(
    {},
    [],
    `Result: push delivered, email skipped by preference, SMS ${out.smsDelivered ? `delivered after ${out.smsCalls} call${out.smsCalls === 1 ? '' : 's'}` : out.dlq ? 'in the DLQ' : 'not sent (invalid number)'}; the duplicate event sent nothing. Rate limits also sit here: per-user caps, per-provider token buckets and quiet hours for marketing.`,
  );
  return frames;
}
