// Pure simulations for three consumer designs (no React here):
//   1. Flash sale: admission token at the CDN → bucketed Redis gate (check + record + decrement in
//      one script, probe two other buckets, optional tail-bucket sweeper) → Kafka → order workers
//      claiming finite unit rows with SKIP LOCKED. A Redis failover can resurrect decrements; the
//      unit rows turn that into apologies, never an oversell.
//   2. Price tracker: change detection with validation, thresholds as a sorted list (range scan),
//      ARMED → FIRED as the dedup, hysteresis re-arm, and the per-user notify gate.
//   3. Tinder: two right swipes racing on two partitions vs one pair key with HSETNX.
import { rng, type BaseFrame } from '../../core';

export type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'muted' | 'mag';

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  tone: Tone;
}

export interface FlowFrame extends BaseFrame {
  active: Record<string, Tone>;
  edges: FlowEdge[];
}

export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------
// 1. Flash sale
// ---------------------------------------------------------------------------------------------

export interface SaleParams {
  stock: number;
  buckets: number;
  failover: boolean;
  sweeper: boolean;
}

export const BOTS = 6;
export const WAVE = 4;
/** decrements the replica had not received when the primary failed */
export const LOST_ON_FAILOVER = 3;

export type GateResult = 'reserved' | 'retry-same' | 'sold-out' | 'flag' | 'no-token';

export interface BuyerResult {
  user: string;
  result: GateResult;
  bucket?: number;
  probes: number[];
}

export interface SaleTally {
  blockedAtCdn: number;
  reserved: number;
  soldOutRedis: number;
  soldOutFlag: number;
  /** told "sold out" while units still sat in other buckets */
  stranded: number;
  claimed: number;
  apologies: number;
  retriesDeduped: number;
}

export interface SaleFrame extends FlowFrame {
  buckets: number[];
  tail: number | null;
  /** per unit row: '' free, else the user holding it */
  units: string[];
  lastWave: BuyerResult[];
  tally: SaleTally;
  soldOutFlag: boolean;
  failedOver: boolean;
}

export function saleBuyers(stock: number) {
  return Math.round(stock * 1.5);
}

export function simulateSale({ stock, buckets: n, failover, sweeper }: SaleParams): SaleFrame[] {
  const rand = rng(11);
  const per = Math.floor(stock / n);
  const buckets = Array.from({ length: n }, (_, i) => per + (i < stock - per * n ? 1 : 0));
  let tail: number | null = sweeper ? 0 : null;
  let swept = false;
  const reservations = new Map<string, number>(); // user → bucket (recorded by the gate script)
  const units: string[] = Array.from({ length: stock }, () => '');
  const tally: SaleTally = { blockedAtCdn: 0, reserved: 0, soldOutRedis: 0, soldOutFlag: 0, stranded: 0, claimed: 0, apologies: 0, retriesDeduped: 0 };
  let soldOutFlag = false;
  let failedOver = false;
  let lastWave: BuyerResult[] = [];
  const frames: SaleFrame[] = [];
  const recent: { user: string; bucket: number }[] = [];

  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, buckets: [...buckets], tail, units: [...units], lastWave: lastWave.map((b) => ({ ...b, probes: [...b.probes] })), tally: { ...tally }, soldOutFlag, failedOver });

  const total = () => buckets.reduce((a, b) => a + b, 0) + (tail ?? 0);

  /** the Lua script: one atomic step per bucket key */
  const gate = (user: string): BuyerResult => {
    if (soldOutFlag) {
      tally.soldOutFlag++;
      return { user, result: 'flag', probes: [] };
    }
    if (reservations.has(user)) {
      tally.retriesDeduped++;
      return { user, result: 'retry-same', bucket: reservations.get(user), probes: [] };
    }
    const home = fnv1a32(user) % n;
    const order = [home];
    const others = Array.from({ length: n }, (_, i) => i).filter((i) => i !== home);
    for (let k = 0; k < 2 && others.length; k++) order.push(others.splice(Math.floor(rand() * others.length), 1)[0]);
    const probes: number[] = [];
    for (const b of order) {
      probes.push(b);
      if (buckets[b] > 0) {
        buckets[b]--;
        reservations.set(user, b);
        recent.push({ user, bucket: b });
        tally.reserved++;
        return { user, result: 'reserved', bucket: b, probes };
      }
    }
    if (tail !== null) {
      probes.push(-1);
      if (tail > 0) {
        tail--;
        reservations.set(user, -1);
        recent.push({ user, bucket: -1 });
        tally.reserved++;
        return { user, result: 'reserved', bucket: -1, probes };
      }
    }
    tally.soldOutRedis++;
    if (total() > 0) tally.stranded++;
    return { user, result: 'sold-out', probes };
  };

  /** order workers: each new winner claims one FREE unit row, or gets an apology */
  const claim = (winners: string[]) => {
    for (const u of winners) {
      const free = units.indexOf('');
      if (free >= 0) {
        units[free] = u;
        tally.claimed++;
      } else tally.apologies++;
    }
  };

  snap(
    {},
    [],
    `${stock} phones, ${n} Redis bucket${n === 1 ? '' : 's'} of ~${per} on different shards, ${stock} unit rows in Postgres. ${saleBuyers(stock)} people and ${BOTS} scripts hit "buy" at T-0. Three filters, each cheaper than the next: CDN, Redis gate, database.`,
  );

  tally.blockedAtCdn = BOTS;
  snap(
    { browsers: 'bad', cdn: 'bad' },
    [{ from: 'browsers', to: 'cdn', label: `${BOTS} requests, no token`, tone: 'bad' }],
    `${BOTS} scripts call the reserve API directly without a signed admission token. The CDN/WAF rejects them with 403: they never reach an API pod, let alone Redis.`,
  );

  const humans = Array.from({ length: saleBuyers(stock) }, (_, i) => `u${i + 1}`);
  const queue = [...humans];
  // one impatient user retries with the same reservation id in wave 2
  queue.splice(WAVE + 1, 0, 'u2');
  let wave = 0;
  const failAt = Math.ceil(stock * 0.6);
  while (queue.length) {
    const batch = queue.splice(0, WAVE);
    wave++;
    lastWave = batch.map(gate);
    const winners = lastWave.filter((b) => b.result === 'reserved').map((b) => b.user);
    claim(winners);
    const parts = lastWave.map((b) => {
      const bn = (x: number) => (x === -1 ? 'tail' : `b${x}`);
      if (b.result === 'reserved') return `${b.user} → ${b.probes.map(bn).join('→')} ✓`;
      if (b.result === 'retry-same') return `${b.user} retried: same reservation, no 2nd unit`;
      if (b.result === 'flag') return `${b.user}: sold out (in-process flag)`;
      return `${b.user}: sold out after ${b.probes.map(bn).join(', ')}`;
    });
    const anyFlag = lastWave.some((b) => b.result === 'flag');
    snap(
      anyFlag ? { browsers: 'accent', cdn: 'good', api: 'warn' } : { browsers: 'accent', cdn: 'good', api: 'accent', redis: 'accent', kafka: winners.length ? 'accent' : 'muted', workers: winners.length ? 'good' : 'muted' },
      anyFlag
        ? [{ from: 'cdn', to: 'api', label: 'rejected in-process', tone: 'warn' }]
        : [
            { from: 'api', to: 'redis', label: 'Lua: check+record+DECR', tone: 'accent' },
            ...(winners.length ? [{ from: 'redis', to: 'kafka', label: `202 ×${winners.length}`, tone: 'accent' as Tone }, { from: 'workers', to: 'db', label: 'SKIP LOCKED', tone: 'good' as Tone }] : []),
          ],
      `Wave ${wave}: ${parts.join('; ')}.`,
      wave === 1 ? 'Each script checks a bucket, records the reservation and decrements in one step. Can two buyers ever take the same unit?' : undefined,
    );

    // sweeper consolidates the thin tail of stock
    if (sweeper && !swept && tail !== null && buckets.reduce((a, b) => a + b, 0) <= n * 2 && total() > 0) {
      swept = true;
      const moved = buckets.reduce((a, b) => a + b, 0);
      for (let i = 0; i < n; i++) buckets[i] = 0;
      tail += moved;
      snap({ redis: 'good' }, [], `Stock is thin (${moved} left across ${n} buckets), so a sweeper moves every remaining unit into one tail bucket that every request probes last. Nobody is told "sold out" while a unit sits in a bucket they did not probe.`);
    }

    // Redis primary fails over: the replica missed the last few decrements
    if (failover && !failedOver && tally.reserved >= failAt) {
      failedOver = true;
      const lost = recent.slice(-LOST_ON_FAILOVER);
      for (const r of lost) {
        if (r.bucket === -1) tail = (tail ?? 0) + 1;
        else buckets[r.bucket]++;
        reservations.delete(r.user);
      }
      snap(
        { redis: 'bad' },
        [],
        `The Redis primary dies and a replica is promoted. Replication is asynchronous, so the replica never saw the last ${lost.length} decrements (${lost.map((r) => r.user).join(', ')}). Those units are back in the buckets, even though their buyers already got 202 and their orders are in Kafka.`,
        'The gate will now admit more winners than there are phones. Will anyone be sold a phone that does not exist?',
      );
    }

    if (!soldOutFlag && total() === 0) {
      soldOutFlag = true;
      snap({ redis: 'warn', api: 'warn' }, [{ from: 'redis', to: 'api', label: 'sold-out flag (pub/sub)', tone: 'warn' }], 'Every bucket is at zero: a sold-out flag is published to all API pods and the cached SKU state. Later clicks are answered in-process without touching Redis.');
    }
  }

  const sold = units.filter(Boolean).length;
  snap(
    { db: 'good' },
    [],
    `Done. Units sold: ${sold} of ${stock} (oversold: ${Math.max(0, sold - stock)}). Gate winners: ${tally.reserved}${tally.apologies ? `; ${tally.apologies} late winner${tally.apologies === 1 ? '' : 's'} got an apology from the order worker, because the unit rows ran out` : ''}. ${
      tally.stranded ? `${tally.stranded} buyer${tally.stranded === 1 ? ' was' : 's were'} told "sold out" while units sat in buckets they did not probe (stranded stock).` : 'No stock was stranded.'
    } Redis is the bouncer; the unit rows are the tickets.`,
  );
  return frames;
}

// ---------------------------------------------------------------------------------------------
// 2. Price tracker & alerts
// ---------------------------------------------------------------------------------------------

export interface PriceParams {
  hysteresis: boolean;
  validate: boolean;
}

export type AlertState = 'ARMED' | 'FIRED';

export interface Alert {
  id: string;
  user: string;
  rule: string;
  /** threshold in rupees: fire when price ≤ target */
  target: number;
  state: AlertState;
  /** price the alert must climb above before re-arming */
  rearmAbove: number;
  anyDrop?: boolean;
}

export type GateDecision = 'SEND' | 'COOLDOWN' | 'DIGEST' | 'DUP';

export interface PriceFrame extends FlowFrame {
  prices: { p: number; kind: 'ok' | 'same' | 'held' | 'bad' }[];
  alerts: Alert[];
  gate: { user: string; alert: string; decision: GateDecision }[];
  sent: number;
  scanned: number;
}

export const START_PRICE = 60_000;
export const REARM_PCT = 0.05;
export const DAILY_CAP = 5;

export function initialAlerts(): Alert[] {
  const mk = (id: string, user: string, rule: string, target: number, anyDrop = false): Alert => ({ id, user, rule, target, state: 'ARMED', rearmAbove: 0, anyDrop });
  return [
    mk('a1', 'Chen', 'any drop', START_PRICE - 1, true),
    mk('a2', 'Dev', '≤ ₹55,000', 55_000),
    mk('a3', 'Asha', '≤ ₹52,000', 52_000),
    mk('a4', 'Ben', '20% below ₹62,500', 50_000),
    mk('a5', 'Asha', '≤ ₹49,999', 49_999),
    mk('a6', 'Esha', '≤ ₹45,000', 45_000),
  ];
}

/** Every rule is a number: the due alerts are a range scan "target ≥ new price" over ARMED rows. */
export function dueAlerts(alerts: Alert[], price: number): Alert[] {
  return alerts.filter((a) => a.state === 'ARMED' && a.target >= price).sort((a, b) => b.target - a.target);
}

export const OBSERVATIONS: { price: number; source: 'crawler' | 'extension' }[] = [
  { price: 60_000, source: 'crawler' },
  { price: 54_000, source: 'crawler' },
  { price: 1, source: 'extension' },
  { price: 49_990, source: 'crawler' },
  { price: 50_010, source: 'crawler' },
  { price: 49_990, source: 'crawler' },
];

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function simulatePrice({ hysteresis, validate }: PriceParams): PriceFrame[] {
  const alerts = initialAlerts();
  const prices: PriceFrame['prices'] = [{ p: START_PRICE, kind: 'ok' }];
  let gate: PriceFrame['gate'] = [];
  let sent = 0;
  let scanned = 0;
  let accepted = START_PRICE;
  let eventId = 100;
  const sentToday: Record<string, number> = { Ben: DAILY_CAP }; // Ben already got 5 alerts today on other products
  const lastToldAt: Record<string, number> = {};
  const frames: PriceFrame[] = [];
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, prices: prices.map((p) => ({ ...p })), alerts: alerts.map((a) => ({ ...a })), gate: gate.map((g) => ({ ...g })), sent, scanned });

  snap({}, [], `One phone at ${inr(START_PRICE)}, six alerts. Every rule was turned into an absolute threshold when it was created ("20% below ₹62,500" → ₹50,000, "any drop" → current − 1), so matching a price change is a range scan over a sorted list, not a loop over rules.`);

  const fire = (price: number, evt: number, step: number) => {
    const due = dueAlerts(alerts, price);
    scanned += due.length;
    gate = [];
    for (const a of due) {
      a.state = 'FIRED';
      a.rearmAbove = hysteresis ? Math.round(a.target * (1 + REARM_PCT)) : a.target;
      const key = `${a.user}`;
      let decision: GateDecision;
      if (lastToldAt[key] !== undefined && lastToldAt[key] >= step - 1) decision = 'COOLDOWN';
      else if ((sentToday[a.user] ?? 0) >= DAILY_CAP) decision = 'DIGEST';
      else {
        decision = 'SEND';
        sentToday[a.user] = (sentToday[a.user] ?? 0) + 1;
        lastToldAt[key] = step;
        sent++;
      }
      gate.push({ user: a.user, alert: `${a.id}:${evt}`, decision });
      if (a.anyDrop) {
        // "any drop" re-targets just below the new price and stays armed
        a.target = price - 1;
        a.state = 'ARMED';
      }
    }
    return due;
  };

  OBSERVATIONS.slice(1).forEach((obs, idx) => {
    const step = idx + 1;
    const { price } = obs;
    if (price === accepted) {
      prices.push({ p: price, kind: 'same' });
      gate = [];
      snap({ crawler: 'muted', detector: 'accent' }, [{ from: 'crawler', to: 'detector', label: inr(price), tone: 'accent' }], `Crawler sees ${inr(price)}: equal to the last accepted price, so only price_seen_at is touched. No event, no matching work.`);
      return;
    }
    const suspicious = price < accepted * 0.4;
    if (suspicious && validate) {
      prices.push({ p: price, kind: 'held' });
      gate = [];
      snap(
        { crawler: 'accent', detector: 'warn' },
        [{ from: 'crawler', to: 'detector', label: `extension: ${inr(price)}`, tone: 'warn' }],
        `A browser extension reports ${inr(price)}, a >60% drop. It is held as suspicious and re-fetched by a second crawler with a different parser: the real price is still ${inr(accepted)}. Discarded; nobody is notified.`,
      );
      return;
    }
    eventId++;
    accepted = price;
    prices.push({ p: price, kind: suspicious ? 'bad' : 'ok' });
    // re-arm check happens on every accepted event
    const rearmed: string[] = [];
    for (const a of alerts)
      if (a.state === 'FIRED' && price > a.rearmAbove) {
        a.state = 'ARMED';
        rearmed.push(a.id);
      }
    const due = fire(price, eventId, step);
    const dec = gate.map((g) => `${g.user} ${g.decision}`).join(', ');
    let caption: string;
    if (suspicious) caption = `Validation is off, so the extension's ${inr(price)} becomes event ${eventId}: the range scan fires ${due.length} alerts at once (${dec}). Users are told about a price that never existed; the extension is an attack surface.`;
    else if (due.length === 0)
      caption = `${inr(price)} → event ${eventId}. ${rearmed.length ? `It is above the re-arm level of ${rearmed.join(', ')}, so ${rearmed.length === 1 ? 'that alert is' : 'they are'} ARMED again.` : `Range scan "target ≥ ${inr(price)}" over ARMED rows: nothing due.${hysteresis && alerts.some((a) => a.state === 'FIRED' && a.target >= 49_000) ? ` Hysteresis: a fired alert re-arms only after the price climbs 5% above its target.` : ''}`}`;
    else
      caption = `${inr(price)} → event ${eventId}. One range scan returns ${due.length} due alert${due.length === 1 ? '' : 's'}; in one transaction they flip ARMED → FIRED and get outbox rows (the flip is the dedup). Gate: ${dec}.`;
    const predict =
      step === 4
        ? `The price bounces to ${inr(OBSERVATIONS[5].price)} next, just under Asha's ₹49,999 target again. With hysteresis ${hysteresis ? 'on' : 'off'}, does she get another alert?`
        : undefined;
    snap(
      { crawler: 'accent', detector: 'accent', matcher: due.length ? 'accent' : 'muted', gate: due.length ? 'good' : 'muted', send: sent ? 'good' : 'muted' },
      [{ from: 'crawler', to: 'detector', label: inr(price), tone: 'accent' }, ...(due.length ? [{ from: 'detector', to: 'matcher', label: `event ${eventId}`, tone: 'accent' as Tone }, { from: 'matcher', to: 'gate', label: `${due.length} fired`, tone: 'good' as Tone }] : [])],
      caption,
      predict,
    );

    // after the first real alert burst, show a redelivery (consumer crash) being swallowed
    if (step === 3 && due.length && validate) {
      const before = gate.length;
      gate = gate.map((g) => ({ ...g, decision: 'DUP' as GateDecision }));
      snap(
        { matcher: 'warn', gate: 'good' },
        [{ from: 'matcher', to: 'gate', label: `event ${eventId} again`, tone: 'warn' }],
        `The notify consumer crashed before committing its offset and event ${eventId} is redelivered. The matcher finds nothing ARMED, and the gate recognises all ${before} alertId:eventId keys: DUP, nothing is sent twice.`,
      );
    }
  });

  snap({ send: 'good' }, [], `Sent ${sent} notification${sent === 1 ? '' : 's'}. ${hysteresis ? 'With hysteresis, one real drop = one notification, even while the price oscillates around a target.' : 'Without hysteresis the oscillation re-armed and re-fired an alert: users get "price dropped!" on every wiggle.'} Ben was over his daily cap, so his alert rolled into the evening digest.`);
  return frames;
}

// ---------------------------------------------------------------------------------------------
// 3. Tinder: exactly-once match detection
// ---------------------------------------------------------------------------------------------

export type MatchDesign = 'partitions' | 'pair';

export interface MatchParams {
  design: MatchDesign;
  lag: boolean;
  retry: boolean;
}

export interface Op {
  who: 'A' | 'B';
  at: number; // ms
  text: string;
  tone: Tone;
}

export interface MatchFrame extends FlowFrame {
  ops: Op[];
  /** storage contents to draw */
  store: { key: string; fields: string[] }[];
  matches: number;
  pushes: number;
}

export function simulateMatch({ design, lag, retry }: MatchParams): MatchFrame[] {
  const frames: MatchFrame[] = [];
  const ops: Op[] = [];
  let matches = 0;
  let pushes = 0;
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], store: MatchFrame['store'], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, ops: ops.map((o) => ({ ...o })), store: store.map((s) => ({ key: s.key, fields: [...s.fields] })), matches, pushes });

  if (design === 'partitions') {
    // likes_by_swiper: A's likes on partition pA, B's on pB, read through replicas
    const pA: string[] = [];
    const pB: string[] = [];
    const visibleA = () => (lag ? [] : [...pA]);
    const visibleB = () => (lag ? [] : [...pB]);
    const store = () => [
      { key: 'likes:A (partition 1)', fields: [...pA] },
      { key: 'likes:B (partition 2)', fields: [...pB] },
    ];
    snap({}, [], store(), `Alice (A) and Bob (B) swipe right on each other within 10 ms. Each like is stored under its swiper, so A's and B's likes live on different partitions. The service does "write my like, then read theirs".`);
    pA.push('A→B');
    ops.push({ who: 'A', at: 0, text: 'write A→B (partition 1)', tone: 'accent' });
    snap({ a: 'accent', api: 'accent', p1: 'accent' }, [{ from: 'a', to: 'api', label: 'swipe right', tone: 'accent' }, { from: 'api', to: 'p1', label: 'write A→B', tone: 'accent' }], store(), 't=0 ms: A\'s like is written to partition 1.');
    pB.push('B→A');
    ops.push({ who: 'B', at: 2, text: 'write B→A (partition 2)', tone: 'accent' });
    snap({ b: 'accent', api: 'accent', p2: 'accent' }, [{ from: 'b', to: 'api', label: 'swipe right', tone: 'accent' }, { from: 'api', to: 'p2', label: 'write B→A', tone: 'accent' }], store(), 't=2 ms: B\'s like is written to partition 2.', 'Now each request reads the other side\'s like. What will each of them see?');
    const aSees = visibleB().includes('B→A');
    ops.push({ who: 'A', at: 5, text: `read B→A → ${aSees ? 'found: MATCH' : 'not there'}`, tone: aSees ? 'warn' : 'bad' });
    if (aSees) {
      matches++;
      pushes += 2;
    }
    snap(
      { api: 'accent', p2: aSees ? 'warn' : 'bad' },
      [{ from: 'api', to: 'p2', label: `read B→A: ${aSees ? 'found' : 'missing'}`, tone: aSees ? 'warn' : 'bad' }],
      store(),
      aSees ? 't=5 ms: A\'s request reads B→A and finds it: create a match and push "It\'s a match!" to both.' : 't=5 ms: A\'s request reads B→A from a replica of partition 2, but replication has not caught up: nothing there, no match.',
    );
    const bSees = visibleA().includes('A→B');
    ops.push({ who: 'B', at: 7, text: `read A→B → ${bSees ? 'found: MATCH' : 'not there'}`, tone: bSees ? 'warn' : 'bad' });
    if (bSees) {
      matches++;
      pushes += 2;
    }
    snap(
      { api: 'accent', p1: bSees ? 'warn' : 'bad' },
      [{ from: 'api', to: 'p1', label: `read A→B: ${bSees ? 'found' : 'missing'}`, tone: bSees ? 'warn' : 'bad' }],
      store(),
      bSees ? 't=7 ms: B\'s request reads A→B and also finds it: a SECOND match row and two more pushes.' : 't=7 ms: B\'s request reads A→B from a lagging replica of partition 1: also missing. Neither request created a match.',
    );
    snap(
      { a: matches ? 'warn' : 'bad', b: matches ? 'warn' : 'bad' },
      [],
      store(),
      matches === 0
        ? 'Result: 0 matches. Two people who like each other never find out (until a nightly repair job, if one exists). Two keys turning in two different locks can both see an empty slot.'
        : `Result: ${matches} matches and ${pushes} "It's a match!" pushes for one pair. Without replication lag both sides see each other, so both create the match. Cross-partition reads cannot give exactly-once.`,
    );
    return frames;
  }

  // one pair key {lo:hi} in one Redis Cluster slot; one Lua script per swipe
  const pair: string[] = [];
  const store = () => [{ key: 'sw:{A:B} (one slot)', fields: [...pair] }];
  const script = (who: 'A' | 'B', at: number, isRetry = false) => {
    const other = who === 'A' ? 'B' : 'A';
    if (!pair.includes(`${who}=R`)) pair.push(`${who}=R`);
    const otherLikes = pair.includes(`${other}=R`);
    let res: 'NONE' | 'MATCH' | 'ALREADY' = 'NONE';
    if (otherLikes) {
      if (!pair.includes('m=1')) {
        pair.push('m=1'); // HSETNX succeeded
        res = 'MATCH';
      } else res = 'ALREADY';
    }
    ops.push({ who, at, text: `${isRetry ? 'retry: ' : ''}HSET ${who}=R; HGET ${other} → ${otherLikes ? 'R' : 'nil'}${otherLikes ? `; HSETNX m → ${res === 'MATCH' ? 1 : 0}` : ''} ⇒ ${res}`, tone: res === 'MATCH' ? 'good' : res === 'ALREADY' ? 'warn' : 'accent' });
    if (res === 'MATCH') {
      matches++;
      pushes += 2;
    }
    return res;
  };
  snap({}, [], store(), 'Same race, different storage: the swipe state is keyed by the unordered pair (min, max) with a hash tag, so both sides live in one Redis slot. One Lua script per right swipe records my decision, reads theirs and, if both are R, sets m with HSETNX. Scripts on one slot run one at a time.');
  const r1 = script('A', 0);
  snap({ a: 'accent', api: 'accent', pair: 'accent' }, [{ from: 'a', to: 'api', label: 'swipe right', tone: 'accent' }, { from: 'api', to: 'pair', label: 'EVAL swipe.lua', tone: 'accent' }], store(), `t=0 ms: A's script runs alone on the slot: A=R, B not there yet ⇒ ${r1}. The swipe is also appended to Kafka for the durable log.`, 'B\'s script runs 2 ms later on the same key. What does it see?');
  const r2 = script('B', 2);
  snap({ b: 'good', api: 'good', pair: 'good' }, [{ from: 'b', to: 'api', label: 'swipe right', tone: 'accent' }, { from: 'api', to: 'pair', label: `EVAL ⇒ ${r2}`, tone: 'good' }], store(), `t=2 ms: B's script sees A=R and wins HSETNX m (returns 1) ⇒ ${r2}. Exactly one script can ever win that HSETNX, so exactly one match.created event is emitted; both users get one push.`);
  if (retry) {
    const r3 = script('B', 900, true);
    snap({ b: 'warn', api: 'accent', pair: 'warn' }, [{ from: 'b', to: 'api', label: 'retry (timeout)', tone: 'warn' }, { from: 'api', to: 'pair', label: `EVAL ⇒ ${r3}`, tone: 'warn' }], store(), `B's phone timed out waiting for the reply and retries the swipe. The script runs again: HSETNX m returns 0 ⇒ ${r3}. The service returns the existing match; no second event, no duplicate push.`);
  }
  snap(
    { a: 'good', b: 'good' },
    [],
    store(),
    `Result: ${matches} match, ${pushes} pushes, however the swipes interleave${retry ? ' and however often the client retries' : ''}. The match rows for both users are written idempotently (match_id = hash of the pair); the hot pair key expires after 7 days and older likes are checked in Cassandra.`,
  );
  return frames;
}
