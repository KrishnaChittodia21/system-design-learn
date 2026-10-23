// Pure simulations for two app designs (no React here):
//   1. Instagram post: presigned upload straight to object storage, a media job keyed by mediaId
//      (magic bytes, rotate then strip EXIF, renditions, perceptual hash, moderation), publish only
//      when every media item is READY, then hybrid fan-out (push for normal authors, pull for
//      celebrities) and rendition choice at the CDN.
//   2. Food delivery: a table-driven order state machine with conditional (versioned) updates,
//      a durable acceptance timer, cancel-vs-accept races, late/duplicate events, and just-in-time
//      dispatch with offers that carry an id and a TTL.
import type { BaseFrame } from '../../core';

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

// ---------------------------------------------------------------------------------------------
// 1. Instagram
// ---------------------------------------------------------------------------------------------

export type Author = 'normal' | 'celebrity';
export type Moderation = 'clean' | 'uncertain';

export interface InstaParams {
  author: Author;
  moderation: Moderation;
  crash: boolean;
}

export const FOLLOWERS: Record<Author, number> = { normal: 300, celebrity: 50_000_000 };
export const CELEB_THRESHOLD = 1_000_000;
export const ORIGINAL_KB = 3_200;
export const RENDITIONS: { w: number; kb: number }[] = [
  { w: 1080, kb: 210 },
  { w: 640, kb: 85 },
  { w: 320, kb: 24 },
  { w: 150, kb: 7 },
];

/** pick the smallest rendition at least as wide as the device needs (CSS px × DPR, capped) */
export function pickRendition(devicePx: number): { w: number; kb: number } {
  const sorted = [...RENDITIONS].sort((a, b) => a.w - b.w);
  return sorted.find((r) => r.w >= devicePx) ?? sorted[sorted.length - 1];
}

export interface InstaFrame extends FlowFrame {
  media: 'none' | 'UPLOADING' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'REVIEW';
  post: 'none' | 'PROCESSING' | 'PUBLISHED' | 'AUTHOR_ONLY';
  renditions: number[];
  exifStripped: boolean;
  timelineInserts: number;
  pulledAtRead: boolean;
  jobAttempts: number;
}

export function simulateInsta({ author, moderation, crash }: InstaParams): InstaFrame[] {
  const frames: InstaFrame[] = [];
  let media: InstaFrame['media'] = 'none';
  let post: InstaFrame['post'] = 'none';
  const renditions: number[] = [];
  let exifStripped = false;
  let timelineInserts = 0;
  let pulledAtRead = false;
  let jobAttempts = 0;
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, media, post, renditions: [...renditions], exifStripped, timelineInserts, pulledAtRead, jobAttempts });
  const followers = FOLLOWERS[author];

  snap({}, [], `${author === 'celebrity' ? 'A celebrity with 50M followers' : 'A user with 300 followers'} posts a 3.2 MB phone photo. The photo factory turns it into web-ready copies; the newspaper decides who sees it. Bytes must never flow through the API servers.`);
  media = 'UPLOADING';
  snap({ app: 'accent', api: 'accent' }, [{ from: 'app', to: 'api', label: 'POST /uploads', tone: 'accent' }], 'POST /uploads {type: image, size: 3.2 MB}: the upload service checks quota and the 8 MB photo limit, creates media(id=m42, status=UPLOADING) and returns a presigned PUT URL valid for 15 minutes.');
  media = 'UPLOADED';
  snap({ app: 'accent', store: 'good' }, [{ from: 'app', to: 'store', label: 'PUT 3.2 MB (presigned)', tone: 'good' }], 'The phone uploads straight to the object store with the signed URL. The API only signed and recorded state; a 4 GB video would take the same path as multipart parts.');
  post = 'PROCESSING';
  snap({ app: 'accent', api: 'accent', posts: 'accent' }, [{ from: 'app', to: 'api', label: 'POST /posts', tone: 'accent' }, { from: 'api', to: 'posts', label: 'PROCESSING', tone: 'accent' }], 'POST /posts {mediaIds: [m42], caption} creates the post as PROCESSING. The author sees it at once, rendered from the local file and their own-posts cache (read-your-writes); nobody else does yet.');
  media = 'PROCESSING';
  jobAttempts = 1;
  snap({ store: 'accent', queue: 'accent', worker: 'accent' }, [{ from: 'store', to: 'queue', label: 'ObjectCreated', tone: 'accent' }, { from: 'queue', to: 'worker', label: 'job key = m42', tone: 'accent' }], 'The ObjectCreated event enqueues a job keyed by mediaId, so a duplicate event cannot create a second job. A worker inspects the object: magic bytes FF D8 FF say JPEG, whatever the client claimed; 4032 × 3024.');
  exifStripped = true;
  snap({ worker: 'accent' }, [], 'Apply the EXIF orientation first (the phone was held sideways), then strip all metadata: the GPS tag 12.97° N, 77.59° E would reveal where the author lives. Order matters: strip first and the photo appears rotated.');
  renditions.push(1080, 640);
  snap({ worker: 'accent', rend: 'accent' }, [{ from: 'worker', to: 'rend', label: '/m/m42/1080.webp, 640', tone: 'accent' }], 'Resize into renditions, WebP/AVIF with JPEG fallback: 1080 px (210 KB) and 640 px (85 KB) written under immutable keys.');
  if (crash) {
    snap({ worker: 'bad' }, [], 'The worker is OOM-killed after two of four renditions. The job was never acknowledged, so its visibility timeout expires and it is redelivered.', 'The retry starts from the beginning. Does it duplicate the renditions or the post?');
    jobAttempts = 2;
    snap({ queue: 'warn', worker: 'accent', rend: 'accent' }, [{ from: 'queue', to: 'worker', label: 'retry m42 (attempt 2)', tone: 'warn' }, { from: 'worker', to: 'rend', label: 'same keys, overwrite', tone: 'accent' }], 'Attempt 2 redoes everything. Rendition keys are derived from (mediaId, width), so rewriting 1080 and 640 just overwrites identical objects; nothing is duplicated and nothing downstream has happened yet.');
  }
  renditions.splice(0, renditions.length, 1080, 640, 320, 150);
  snap({ worker: 'accent', rend: 'good' }, [{ from: 'worker', to: 'rend', label: '320, 150', tone: 'good' }], 'All four renditions exist (320 px = 24 KB, 150 px thumbnail = 7 KB). A perceptual hash (PDQ) is computed and checked against known-abuse lists; a SHA-256 would only catch byte-identical copies.');
  if (moderation === 'uncertain') {
    media = 'REVIEW';
    post = 'AUTHOR_ONLY';
    snap(
      { worker: 'warn', posts: 'warn' },
      [{ from: 'worker', to: 'posts', label: 'moderation: uncertain', tone: 'warn' }],
      'The moderation classifier is unsure. The media goes to a human review queue and the post stays visible only to its author. No PostPublished event, so no fan-out, no notifications, no search indexing until a reviewer decides.',
    );
    return frames;
  }
  media = 'READY';
  post = 'PUBLISHED';
  snap(
    { worker: 'good', posts: 'good', kafka: 'accent' },
    [{ from: 'worker', to: 'posts', label: 'm42 READY', tone: 'good' }, { from: 'posts', to: 'kafka', label: 'outbox: PostPublished', tone: 'accent' }],
    'Moderation is clean: media m42 → READY. Every media item of the post is ready, so the post flips to PUBLISHED and the outbox emits PostPublished. A carousel publishes only when its last photo is done.',
    `Fan-out next. The author has ${followers.toLocaleString('en-US')} followers. How many timeline writes will this one post cost?`,
  );
  if (followers < CELEB_THRESHOLD) {
    timelineInserts = followers;
    snap({ kafka: 'accent', fanout: 'accent', redis: 'good' }, [{ from: 'kafka', to: 'fanout', tone: 'accent' }, { from: 'fanout', to: 'redis', label: `+${followers} inserts`, tone: 'good' }], `Fan-out on write: the post id is prepended to ${followers} follower timelines in Redis (capped lists). Cheap, and every follower's next feed read is one lookup.`);
    snap({ follower: 'good', redis: 'good' }, [{ from: 'redis', to: 'follower', label: 'timeline hit', tone: 'good' }], 'A follower opens the app: the post id is already in their precomputed timeline. Candidates then go through filtering (seen, blocked), ranking and ad blending.');
  } else {
    snap({ kafka: 'accent', fanout: 'warn' }, [{ from: 'kafka', to: 'fanout', tone: 'accent' }], `The author has ${(followers / 1e6).toFixed(0)}M followers, above the ${(CELEB_THRESHOLD / 1e6).toFixed(0)}M threshold: no fan-out. Pushing would mean 50M inserts (and minutes of lag) for one post. It is only added to the author's recent-posts list.`);
    pulledAtRead = true;
    snap({ follower: 'good', redis: 'warn' }, [{ from: 'redis', to: 'follower', label: 'timeline ∪ celeb recent', tone: 'warn' }], 'A follower opens the app: their precomputed timeline plus the recent posts of the few celebrities they follow, merged at read time. Pull for the rare huge accounts, push for everyone else.');
  }
  const r = pickRendition(390 * 2);
  snap({ cdn: 'good', follower: 'good', rend: 'accent' }, [{ from: 'rend', to: 'cdn', tone: 'accent' }, { from: 'cdn', to: 'follower', label: `${r.w}.webp ${r.kb} KB`, tone: 'good' }], `The phone is 390 CSS px wide at 2× density, so it asks for /m/m42/${r.w}.webp: ${r.kb} KB instead of the ${ORIGINAL_KB.toLocaleString('en-US')} KB original (${Math.round(ORIGINAL_KB / r.kb)}× less egress). The CDN caches it forever: an edit makes a new key.`);
  return frames;
}

// ---------------------------------------------------------------------------------------------
// 2. Food delivery
// ---------------------------------------------------------------------------------------------

export type OrderStatus = 'PAYMENT_PENDING' | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';
export type OrderEvent =
  | 'payment.succeeded'
  | 'restaurant.accepted'
  | 'restaurant.rejected'
  | 'accept.timeout'
  | 'kitchen.started'
  | 'food.ready'
  | 'partner.picked_up'
  | 'partner.delivered'
  | 'customer.cancel';

/** The transition table: data, not if-statements. */
export const TRANSITIONS: { from: OrderStatus[]; event: OrderEvent; to: OrderStatus }[] = [
  { from: ['PAYMENT_PENDING'], event: 'payment.succeeded', to: 'PLACED' },
  { from: ['PLACED'], event: 'restaurant.accepted', to: 'ACCEPTED' },
  { from: ['PLACED'], event: 'restaurant.rejected', to: 'CANCELLED' },
  { from: ['PLACED'], event: 'accept.timeout', to: 'CANCELLED' },
  { from: ['ACCEPTED'], event: 'kitchen.started', to: 'PREPARING' },
  { from: ['ACCEPTED', 'PREPARING'], event: 'food.ready', to: 'READY' },
  { from: ['READY', 'PREPARING'], event: 'partner.picked_up', to: 'PICKED_UP' },
  { from: ['PICKED_UP'], event: 'partner.delivered', to: 'DELIVERED' },
  { from: ['PLACED', 'ACCEPTED'], event: 'customer.cancel', to: 'CANCELLED' },
];

export interface Order {
  status: OrderStatus;
  version: number;
}

export type ApplyResult = { ok: true; order: Order } | { ok: false; reason: 'illegal' | 'stale' | 'duplicate' };

/**
 * Conditional update: UPDATE orders SET status=:to, version=version+1
 * WHERE status = ANY(:allowedFrom) AND version = :expected. Duplicate event ids are dropped first.
 */
export function apply(order: Order, event: OrderEvent, expectedVersion: number, eventId: string, processed: Set<string>): ApplyResult {
  if (processed.has(eventId)) return { ok: false, reason: 'duplicate' };
  const t = TRANSITIONS.find((x) => x.event === event && x.from.includes(order.status));
  if (!t) {
    processed.add(eventId);
    return { ok: false, reason: 'illegal' };
  }
  if (order.version !== expectedVersion) return { ok: false, reason: 'stale' };
  processed.add(eventId);
  return { ok: true, order: { status: t.to, version: order.version + 1 } };
}

export type FoodScenario = 'happy' | 'timeout' | 'race' | 'late';

export interface FoodParams {
  scenario: FoodScenario;
  offerExpires: boolean;
}

export interface Partner {
  id: string;
  /** minutes to reach the restaurant */
  eta: number;
}

export const READY_IN = 18;
export const PARTNERS: Partner[] = [
  { id: 'P1', eta: 4 },
  { id: 'P2', eta: 17 },
  { id: 'P3', eta: 26 },
];

/** JIT cost: idle wait at the restaurant plus (heavily weighted) food waiting / lateness. */
export function dispatchCost(p: Partner, readyIn = READY_IN): number {
  const idle = Math.max(0, readyIn - p.eta);
  const late = Math.max(0, p.eta - readyIn);
  return idle + 3 * late;
}

export interface LogRow {
  actor: string;
  event: string;
  result: string;
  tone: Tone;
}

export interface FoodFrame extends FlowFrame {
  status: OrderStatus;
  version: number;
  log: LogRow[];
  partners: (Partner & { cost: number; offer: 'none' | 'offered' | 'expired' | 'accepted' | 'rejected-late' })[];
  refund: string;
}

export function simulateFood({ scenario, offerExpires }: FoodParams): FoodFrame[] {
  const frames: FoodFrame[] = [];
  let order: Order = { status: 'PAYMENT_PENDING', version: 1 };
  const processed = new Set<string>();
  const log: LogRow[] = [];
  let refund = '';
  const partners: FoodFrame['partners'] = PARTNERS.map((p) => ({ ...p, cost: dispatchCost(p), offer: 'none' }));
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, status: order.status, version: order.version, log: log.map((l) => ({ ...l })), partners: partners.map((p) => ({ ...p })), refund });
  let n = 0;
  const ev = (actor: string, event: OrderEvent, expected = order.version, id = `e${++n}`) => {
    const r = apply(order, event, expected, id, processed);
    if (r.ok) {
      const from = order.status;
      order = r.order;
      log.push({ actor, event, result: `${from} → ${order.status} (v${order.version})`, tone: 'good' });
    } else log.push({ actor, event, result: r.reason === 'stale' ? '0 rows (version moved)' : r.reason === 'duplicate' ? 'duplicate event id: skipped' : `illegal from ${order.status}: rejected + logged`, tone: r.reason === 'illegal' ? 'warn' : 'bad' });
    return r;
  };

  snap({}, [], 'An order is a ticket moving through stations, each owned by a different actor: the payment provider, the restaurant tablet, the dispatcher, the partner app. Events arrive late, twice and out of order; one transition table and a versioned conditional UPDATE keep the ticket honest.');
  ev('PSP', 'payment.succeeded');
  snap({ psp: 'accent', orders: 'good' }, [{ from: 'psp', to: 'orders', label: 'payment.succeeded', tone: 'accent' }], 'The payment provider confirms: PAYMENT_PENDING → PLACED. In the same transaction an outbox row notifies the restaurant and a durable accept timer is stored (fire_at = now + 90 s).');

  if (scenario === 'timeout') {
    log.push({ actor: 'timer', event: 'escalate @60s', result: 'IVR call to restaurant', tone: 'warn' });
    snap({ timer: 'warn', resto: 'warn' }, [{ from: 'timer', to: 'resto', label: '60 s: loud alert + IVR', tone: 'warn' }], 'The tablet is silent (noise, dead Wi-Fi, a sleeping device). At 60 s the timer escalates first: a loud alert, then an automated phone call.', 'Still no answer at 90 s. What must the timer handler check before cancelling?');
    ev('timer', 'accept.timeout');
    refund = 'full refund';
    snap({ timer: 'bad', orders: 'bad' }, [{ from: 'timer', to: 'orders', label: 'cancel if still PLACED', tone: 'bad' }], 'At the hard deadline the timer fires a conditional transition: only if still PLACED. It is: PLACED → CANCELLED, full refund, an apology and alternative restaurants. Had the restaurant accepted at 89 s, the same UPDATE would have matched 0 rows and done nothing.');
    return frames;
  }

  if (scenario === 'race') {
    const v = order.version;
    snap({ cust: 'warn', resto: 'accent' }, [{ from: 'cust', to: 'orders', label: 'cancel (read v2)', tone: 'warn' }, { from: 'resto', to: 'orders', label: 'accept (read v2)', tone: 'accent' }], 'The customer taps "cancel" and the restaurant taps "accept" 50 ms apart. Both requests read the order as PLACED, version 2.', 'Both will run UPDATE … WHERE version = 2. What happens to the second one?');
    ev('restaurant', 'restaurant.accepted', v);
    snap({ resto: 'good', orders: 'good' }, [{ from: 'resto', to: 'orders', label: 'UPDATE … v=2 → 1 row', tone: 'good' }], 'The accept commits first: PLACED → ACCEPTED, version 3.');
    ev('customer', 'customer.cancel', v);
    snap({ cust: 'bad', orders: 'warn' }, [{ from: 'cust', to: 'orders', label: 'UPDATE … v=2 → 0 rows', tone: 'bad' }], 'The cancel\'s UPDATE … WHERE status IN (PLACED, ACCEPTED) AND version = 2 matches 0 rows: someone else moved the order. No lost update, no silent overwrite.');
    ev('customer', 'customer.cancel');
    refund = 'refund minus cancellation fee';
    snap({ cust: 'accent', orders: 'good' }, [{ from: 'cust', to: 'orders', label: 'reload v3, re-decide', tone: 'accent' }], 'The service reloads (ACCEPTED, v3) and re-decides: the table allows cancel from ACCEPTED, with the policy fee because the kitchen has the order. ACCEPTED → CANCELLED; the outbox tells the restaurant to stop.');
    return frames;
  }

  ev('restaurant', 'restaurant.accepted');
  snap({ resto: 'good', orders: 'good' }, [{ from: 'resto', to: 'orders', label: 'accepted', tone: 'good' }], `The restaurant accepts and the prep model predicts the food will be ready in ${READY_IN} minutes. The accept timer handler will find the order no longer PLACED and do nothing.`);
  ev('kitchen', 'kitchen.started');
  snap({ resto: 'accent', orders: 'good', dispatch: 'accent' }, [{ from: 'orders', to: 'dispatch', label: `ready in ${READY_IN} min`, tone: 'accent' }], `PREPARING. The dispatcher does not grab the nearest partner: it wants one who arrives just as the food is packed. Cost = idle wait at the restaurant + 3 × minutes the food waits. P1 (4 min away) would idle ${READY_IN - 4} min; P2 (17 min) fits; P3 (26 min) makes the food wait.`);

  const best = [...partners].sort((a, b) => a.cost - b.cost);
  best[0].offer = 'offered';
  snap({ dispatch: 'accent', p: 'accent' }, [{ from: 'dispatch', to: 'p', label: `offer o-1 → ${best[0].id} (TTL 20 s)`, tone: 'accent' }], `Offer o-1 to ${best[0].id} (cost ${best[0].cost}), with an id and a 20 s TTL. ${best[0].id} is soft-locked meanwhile so no other order offers to them.`, offerExpires ? `${best[0].id} does not answer within 20 s. What happens if they tap "accept" at 25 s?` : undefined);
  let winner = best[0];
  if (offerExpires) {
    best[0].offer = 'expired';
    best[1].offer = 'offered';
    snap({ dispatch: 'warn', p: 'warn' }, [{ from: 'dispatch', to: 'p', label: `o-1 expired → o-2 to ${best[1].id}`, tone: 'warn' }], `o-1 expires unanswered. The order goes back into the next round with ${best[0].id} excluded, and o-2 goes to ${best[1].id} (cost ${best[1].cost}).`);
    best[0].offer = 'rejected-late';
    log.push({ actor: best[0].id, event: 'accept o-1 @25s', result: 'CAS on (order, offerId) failed', tone: 'bad' });
    snap({ p: 'bad', dispatch: 'good' }, [{ from: 'p', to: 'dispatch', label: `${best[0].id}: accept o-1 (late)`, tone: 'bad' }], `${best[0].id}'s late tap on o-1 arrives. Acceptance is a compare-and-set on (orderId, offerId = o-2 now): it fails, so the order can never be double-assigned.`);
    winner = best[1];
  }
  winner.offer = 'accepted';
  log.push({ actor: winner.id, event: `accept ${offerExpires ? 'o-2' : 'o-1'}`, result: 'assigned', tone: 'good' });
  snap({ p: 'good', dispatch: 'good' }, [{ from: 'p', to: 'dispatch', label: `${winner.id} accepts`, tone: 'good' }], `${winner.id} accepts within the TTL: the CAS succeeds and ${winner.id} heads to the restaurant, arriving in ~${winner.eta} min.`);
  ev('kitchen', 'food.ready');
  snap({ resto: 'good', orders: 'good' }, [{ from: 'resto', to: 'orders', label: 'food.ready', tone: 'good' }], 'Food is packed: PREPARING → READY.');
  const pickedId = `e${++n}`;
  ev(winner.id, 'partner.picked_up', order.version, pickedId);
  snap({ p: 'good', orders: 'good' }, [{ from: 'p', to: 'orders', label: 'picked up (OTP)', tone: 'good' }], 'Pickup verified by OTP and geofence: READY → PICKED_UP. Live tracking starts for the customer.');
  if (scenario === 'late') {
    ev('partner app', 'partner.picked_up', order.version, pickedId);
    ev('kitchen', 'food.ready');
    snap(
      { p: 'warn', resto: 'warn', orders: 'good' },
      [{ from: 'p', to: 'orders', label: 'picked_up again', tone: 'warn' }, { from: 'resto', to: 'orders', label: 'late food.ready', tone: 'warn' }],
      'Two stragglers: the partner app retries picked_up with the same event id (skipped by the processed-events check), and the tablet\'s food.ready arrives late. From PICKED_UP that transition is not in the table, so it is rejected and logged. Late events are normal, not errors, and they can never move the order backwards.',
    );
  }
  ev(winner.id, 'partner.delivered');
  snap({ p: 'good', orders: 'good', cust: 'good' }, [{ from: 'p', to: 'orders', label: 'delivered', tone: 'good' }], `PICKED_UP → DELIVERED (v${order.version}). The outbox triggers payouts and the rating prompt; consumers dedupe by event id, so at-least-once delivery gives exactly-once effects.`);
  return frames;
}
