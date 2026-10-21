import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-consumer',
  phase: 'designs',
  order: 10,
  title: 'Consumer & Marketplace: Flash Sale (Big Billion Days), Price Tracker & Alerts (CamelCamelCamel), Tinder, News Aggregator (Google News) & Strava',
  subtitle:
    'Five consumer designs that each hide one hard problem: selling 50K units to 5M people in a minute without overselling or rewarding bots, matching millions of price rules without spamming anyone, detecting a mutual like exactly once, turning 3M articles a day into a few hundred stories, and timing an athlete over a GPS trace that never lies on the segment.',
  estimatedMinutes: 200,
  sources: [
    'Hello Interview — problem breakdowns: Tinder, Strava, News Aggregator (Google News), Price Tracking Service (CamelCamelCamel) (2025)',
    'Hello Interview community question reports — "Design a Price Drop Tracker like CamelCamelCamel" (asked at Meta); "Design a Dating App Like Tinder" (asked at Uber)',
    'Tinder Engineering — Geosharded Recommendations (S2 cells, Elasticsearch per-shard indices); ByteByteGo — How Tinder recommends to 75 million users',
    'Strava — US Patent 9,116,922 "Defining and matching segments" (R-tree of segment MBRs, loose/tight match thresholds, virtual start/finish lines); Strava Support — Segment matching issues',
    'Google — US Patent 8,832,105 "System for incrementally clustering news stories"; PracHub — Design a news aggregation system (Google News style)',
    'Software Engineering Daily — CamelCamelCamel: Amazon Price Tracker with Daniel Green (2019)',
    'DesignGurus — Grokking the System Design Interview Vol II: Design a global news aggregator; AlgoMaster — Design a flash sale / news aggregator (2025)',
    'Flipkart Big Billion Days engineering write-ups (dev.to summary, 2025): 6–7× normal traffic, Kafka-queued order processing, NRT inventory store',
    'Redis documentation — EVAL/Lua atomicity, ZADD GT/LT flags, hash tags in Redis Cluster; PostgreSQL docs — SELECT … FOR UPDATE SKIP LOCKED',
    'Broder — On the resemblance and containment of documents (MinHash, 1997)',
  ],
  tags: [
    'flash-sale',
    'inventory',
    'hot-row',
    'bot-defence',
    'fairness',
    'price-alerts',
    'rule-matching',
    'notification-throttling',
    'tinder',
    'match-detection',
    'geosharding',
    'bloom-filter',
    'news-aggregator',
    'story-clustering',
    'ranking',
    'strava',
    'gps',
    'segment-matching',
    'leaderboard',
  ],
  cheatSheet: [
    'Flash sale = admission → gate → durable claim → pay. Waiting room or pre-registered purchase tokens bound arrivals; a Redis Lua gate (per-SKU stock split into N buckets on different shards) rejects the 99% of losers in < 1 ms; winners go through Kafka to order workers that claim a pre-generated unit row with FOR UPDATE SKIP LOCKED. Units are finite rows, so the DB can never oversell even if Redis lies.',
    'Hot-row ladder: single row (~500–1K updates/s) → Redis Lua key (~50–100K ops/s per shard) → N bucketed keys across shards (×N, with stranded-stock sweeps) → per-pod local leases (zero network per buy, return leases on shutdown) → one Kafka partition per SKU (strict order, async answer).',
    'Flash-sale fairness: FCFS at T-0 rewards the lowest latency, which means bots. Pre-register with verified phone/KYC, then run a lottery or randomised queue position among registrants; limit per account, device, address and payment instrument; challenge at registration, not at the buy click.',
    'Price alerts: normalise every rule type (target price, % drop, "lowest in 90 days") into either a (product, threshold) row or a (product, event-flag) subscription, so a price change is an index range scan on (product_id, state, target), never a scan of all alerts.',
    'Alert hygiene: fire only on a real change (old ≠ new), flip ARMED → FIRED in the same statement that enqueues (outbox), re-arm only after the price rises a margin above target (hysteresis), idempotency key alertId:priceEventId, per-user per-product cooldown and a daily cap that rolls extras into a digest.',
    'Tinder: 20M DAU × 100 swipes ≈ 2B/day ≈ 23K/s. Match = both sides liked: store each unordered pair in one Redis hash (hash tag on the pair) and run SET-mine + CHECK-other in one Lua script, with HSETNX on a "matched" field so exactly one MATCH is emitted; Cassandra holds the durable swipe log.',
    'Tinder stack: geoshards (S2 level 7–8 cells grouped into roughly equal-load shards, one Elasticsearch index each) → filter by distance, age, gender and mutual preference → exclude already-swiped via a per-user Bloom filter (~1% FP, ~10 bits per swipe) → rank → cache 100–200 cards, client prefetches 20.',
    'News aggregator: poll RSS/sitemaps with adaptive per-source cadence (+ WebSub push) → canonical URL + content hash dedup → near-dup (MinHash/SimHash for syndicated wire copy) → incremental clustering into stories (entity-gated candidates, cosine to centroid ≥ τ within 48 h) → story score = velocity × source authority × freshness decay → per-edition precomputed lists + a personal re-rank.',
    'Strava: record offline on device → upload FIT/GPX to a presigned URL → Kafka → parse, clean, stats → segment matching (R-tree/geohash candidates by bounding box, then start/finish crossing + ≥ 80% coverage) → efforts → leaderboards (one sorted set per segment, ZADD LT keeps personal best) → feed fan-out with privacy zones applied before anything leaves the pipeline.',
    'Recurring trick across all five: separate the fast, lossy filter (Redis gate, Bloom filter, entity candidates, bounding-box query) from the slow, exact authority (unit rows, swipe log, centroid similarity, full geometric match).',
  ],
  sections: [
    // ------------------------------------------------------------ FLASH SALE
    {
      heading: 'Flash sale (1/3): requirements, estimation, API & data model',
      body: `**Intuition:** a flash sale is **a stadium with 50,000 seats and 5 million people at one gate at exactly 8:00 pm**. The stadium is not the problem; the gate is. Your job is to decide who reaches a seat, fast, fairly and without ever selling seat 50,001.

**How it differs from normal checkout** (covered in the e-commerce design): a normal cart has thousands of SKUs and low contention per SKU. A flash sale has **a few hundred deal SKUs, each with fixed stock, and almost all demand arriving in the first 60 seconds**. Contention per SKU, bots and fairness dominate; catalogue, search and recommendations do not.

**Clarify first:** how many deal SKUs and units (50 hot SKUs, 200K units total)? Per-user limit (1 per SKU)? Must the user pay inside a window (10 min) or is stock released? FCFS or lottery? Is pre-registration allowed? Can we show "you are in the queue" or must buy be instant?

**Functional:** browse deal page with live "x% claimed"; buy-now (no cart) for one unit; reservation with a payment window; release on payment failure or timeout; order confirmation. **Non-functional:** never oversell (hard), never lose a confirmed order, p99 answer < 1 s for the buy click (even if the answer is "sold out"), survive 50–100× normal traffic, resist bots, and be fair enough that customers do not riot on social media.

**Estimation (Big-Billion-Days-style 8 pm drop):**

| Quantity | Calculation | Result |
|---|---|---|
| Deal page viewers | 10M users open the page at 7:59 | static, CDN-served |
| Buy clicks | 5M clicks in the first 60 s | ≈ 83K/s average, 150–200K/s in the first 5 s |
| Units | 50 hot SKUs, 200K units | ≥ 96% of clicks must be told "sold out" |
| Successful reservations | 200K over ~2 min | ≈ 1.7K/s orders written to the DB |
| Status polls | 200K winners polling every 2 s for 30 s | ≈ 100K/s cheap reads (or SSE) |

The number that drives the design: **83K/s of decisions against 50 SKUs**, i.e. about 1.7K/s per SKU on average and far more on the 3–4 headline phones. A single Postgres row handles ~500–1K locked updates per second, so the authority cannot sit in the request path for every click.

**API:**
- \`POST /sales/{saleId}/register\` → verifies phone/KYC, solves a challenge, returns a registration id (opens days before).
- \`GET /sales/{saleId}/state\` → CDN-cached for 1 s: per-SKU \`AVAILABLE | LOW | SOLD_OUT\`.
- \`POST /sales/{saleId}/skus/{sku}/reserve\` with \`Idempotency-Key\` and an admission token → \`202 {reservationId}\` or \`409 SOLD_OUT\`.
- \`GET /reservations/{id}\` (or SSE) → \`PENDING | RESERVED(payBy) | FAILED\`.
- \`POST /reservations/{id}/pay\` → hands off to the normal payment flow.

**Data model:**
- \`sale_units(sale_id, sku, unit_no, status FREE|RESERVED|SOLD, user_id, reservation_id, reserved_at)\`, PK \`(sale_id, sku, unit_no)\`. **One row per sellable unit**, generated before the sale.
- Partial unique index \`(sale_id, sku, user_id) WHERE status <> 'FREE'\`: the per-user limit enforced by the database.
- \`reservations(reservation_id PK, sale_id, sku, user_id, status, pay_by, created_at)\`.
- Redis: \`stock:{sale:sku:bNN}\` counters and \`resv:{sale:sku:bNN}\` hashes, one pair per bucket.`,
      keyPoints: [
        'The hard number is decisions per second per SKU, not total traffic: 83K/s against 50 SKUs.',
        'Pre-generated unit rows turn "do not oversell" into "you cannot reserve a row that does not exist".',
        'Ask about payment window, per-user limit and FCFS vs lottery up front: each changes the design.',
      ],
      source: 'AlgoMaster — Design a Flash Sale (2025); Flipkart Big Billion Days engineering summaries',
    },
    {
      heading: 'Flash sale (2/3): architecture — admission, bucketed Redis gate & async orders',
      body: `**Intuition:** three filters, each cheaper than the next is expensive. The **CDN** absorbs page views, the **gate** answers "is there a unit for you?" in memory, and only winners reach the **database**, at a rate it can absorb.

**Request path:**
1. **Static deal page** from the CDN, with SKU state refreshed from a 1-second cached endpoint. Never render the deal page from the origin.
2. **Admission:** the buy button calls \`reserve\` with a short-lived signed admission token (issued by a waiting room or to pre-registered users at T-0). The edge rejects requests without a valid token, so scripts hammering the API directly die at the CDN/WAF.
3. **Gate (Redis Lua):** the SKU's stock is **split into N buckets** (for a 10K-unit phone, 20 buckets of 500), each a separate key on a different cluster shard. A user is hashed to a home bucket; if it is empty, the service tries two random buckets, then declares sold out. One script atomically checks the bucket, records the reservation and decrements, so a retry with the same reservation id never takes a second unit.
4. **Async order:** the API returns \`202 {reservationId}\` immediately and publishes to Kafka (keyed by sku). Order workers claim a **unit row** with \`FOR UPDATE SKIP LOCKED\`, create the reservation with a 10-minute pay-by, and push the result to the client via SSE or a poll.
5. **Sold-out broadcast:** when every bucket of a SKU hits zero, a flag is published to all API pods (pub/sub) and to the cached state endpoint, so subsequent clicks are rejected in-process without touching Redis at all.

**Hot-row strategies, compared:**

| Strategy | Throughput per SKU | Weakness |
|---|---|---|
| Single DB row, conditional UPDATE | ~0.5–1K/s | Lock queue, pool exhaustion |
| Single Redis key + Lua | ~50–100K/s (one shard, one core) | One shard is the ceiling and the blast radius |
| N bucketed keys on N shards | ~N × 50K/s | Stranded units when buckets drain unevenly |
| Per-pod local lease (pod pulls 50 units at a time) | in-process, ~1M/s | Units stuck on a dead pod until its lease expires |
| One Kafka partition per SKU, single consumer | ~10–50K/s, strict FIFO | User waits for an async answer |

**Stranded stock:** with buckets, the last few units are spread thin: bucket 7 has 3 left while users hashed to empty buckets see sold out after probing only three. Fix it with a **sweeper**: once total stock falls below N × 10, move remaining units into one "tail" bucket that every request probes last. Report "sold out" only when the tail is also empty.`,
      diagram: `   10M browsers
        |  deal page + 1 s cached SKU state
        v
  +-----------+   no/invalid admission token   +---------+
  | CDN / WAF |------------------------------->| 403/429 |
  +-----+-----+                                +---------+
        | POST reserve (token, Idempotency-Key)
        v
  +-----------+  sold-out flag (pub/sub)  +-------------------------+
  | API pods  |<--------------------------| Redis Cluster           |
  | local     |   Lua: check+record+DECR  | stock:{s:sku:b00..b19}  |
  | sold-out  |-------------------------->| resv:{s:sku:b00..b19}   |
  | cache     |                           +-------------------------+
  +-----+-----+
        | 202 {reservationId}; publish (key = sku)
        v
  +-----------+     +-------------------+     +-------------------+
  |  Kafka    |---->| order workers     |---->| Postgres          |
  | reserve.  |     | claim unit row    |     | sale_units (one   |
  | requests  |     | SKIP LOCKED       |     | row per unit),    |
  +-----------+     +---------+---------+     | reservations      |
                              |               +-------------------+
                              v
                   SSE / poll: RESERVED(payBy) -> payment flow`,
      code: [
        {
          language: 'lua',
          title: 'Bucket gate: check, record the reservation, decrement (one atomic script)',
          code: `-- KEYS[1] = stock:{s1:sku9:b03}   KEYS[2] = resv:{s1:sku9:b03}
-- Both keys share the hash tag {s1:sku9:b03}, so they live on one cluster slot.
-- ARGV[1] = reservationId, ARGV[2] = userId, ARGV[3] = nowMs
local existing = redis.call('HGET', KEYS[2], ARGV[1])
if existing then return -2 end                -- retry of a reservation we already hold
local left = tonumber(redis.call('GET', KEYS[1]) or '0')
if left <= 0 then return -1 end               -- this bucket is empty
-- record first: a crash after this line leaves a recoverable reservation,
-- never an anonymous decrement
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2] .. '|' .. ARGV[3])
return redis.call('DECR', KEYS[1])            -- units left in this bucket`,
        },
        {
          language: 'typescript',
          title: 'Reserve: per-user claim, home bucket, two random probes, tail bucket',
          code: `import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const BUCKETS = 20;
const soldOut = new Set<string>(); // filled by a pub/sub listener

export async function reserve(redis: Redis.Cluster, gateSha: string,
                              sale: string, sku: string, userId: string, idemKey: string) {
  if (soldOut.has(sku)) return { status: 'SOLD_OUT' as const };
  // one attempt per user per SKU; the idempotency key makes client retries safe
  const claimKey = 'claim:' + sale + ':' + sku + ':' + userId;
  const resId = idemKey || randomUUID();
  const ok = await redis.set(claimKey, resId, 'EX', 900, 'NX');
  if (!ok && (await redis.get(claimKey)) !== resId) return { status: 'LIMIT_REACHED' as const };

  const home = hash(userId) % BUCKETS;
  const probes = [home, rnd(BUCKETS), rnd(BUCKETS), 'tail'];
  for (const b of probes) {
    const tag = '{' + sale + ':' + sku + ':b' + b + '}';
    const r = Number(await redis.evalsha(gateSha, 2, 'stock:' + tag, 'resv:' + tag,
                                          resId, userId, Date.now()));
    if (r >= 0 || r === -2) return { status: 'ACCEPTED' as const, reservationId: resId, bucket: b };
  }
  await redis.del(claimKey); // nothing taken: let the user try again if stock is returned
  return { status: 'SOLD_OUT' as const };
}

const rnd = (n: number) => Math.floor(Math.random() * n);
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }`,
        },
      ],
      keyPoints: [
        'Reject at the cheapest layer that can decide: CDN (no token), in-process flag (sold out), Redis (bucket empty).',
        'Record the reservation inside the same Lua script as the decrement, so no unit is ever taken anonymously.',
        'Buckets multiply throughput but strand the tail; consolidate into a tail bucket near the end.',
      ],
      source: 'Redis documentation — EVAL and hash tags; Hello Interview — Ticketmaster deep dives',
    },
    {
      heading: 'Flash sale (3/3): durable claim, oversell under failover, fairness & bots',
      body: `**Intuition:** Redis is the **bouncer**, the database is the **ticket stub**. The bouncer may occasionally let one extra person into the corridor, but there are only 10,000 stubs, so nobody extra gets a seat.

**Why Redis alone cannot be the ledger.** Redis replication is asynchronous. If the primary fails over 2 s into the sale, the replica may not have seen the last few thousand decrements; it now believes more stock exists and the gate admits extra winners. Defences, from strongest:
1. **Units are rows.** Order workers claim a concrete \`FREE\` unit row. When rows run out, the late winners get "sorry, sold out" from the worker, an apology rather than an oversell.
2. **\`WAIT 1 50\`** after the script raises durability at the cost of ~1 ms per call; it narrows the window but does not close it.
3. **Reconciliation:** every few seconds compare \`Σ bucket stock + reserved\` with the count of FREE rows; the DB wins.

**Why SKIP LOCKED instead of a counter row.** Ten thousand unit rows mean ten thousand independent locks: each worker grabs the first free row that nobody else has locked, so claims run in parallel and the only contention is at the index page. At 1.7K claims/s that is comfortable for one Postgres primary.

**Payment window and returns.** A reservation lives 10 minutes. A sweeper flips expired \`RESERVED\` rows back to \`FREE\` and returns the unit to the Redis tail bucket. Expect 10–30% of flash-sale reservations to lapse (payment failures, second thoughts), so returned stock is significant; offer it first to a **waitlist** of users who got "sold out", in order, instead of letting the next refresh-spammer grab it.

**Fairness.** Pure FCFS at T-0 rewards the shortest network path and the fastest script. Options:
- **Randomised admission:** everyone who arrives in the first 30 s gets a random queue position (design-commerce's waiting room uses arrival order; randomising within a window removes the incentive to hammer).
- **Lottery with pre-registration:** registrants get a purchase token with probability ≈ units × 1.3 ÷ registrants (over-issue to cover no-shows); tokens are signed and bound to user and SKU.
- **Per-identity limits** beyond the account: phone, device fingerprint, delivery address (normalised), and payment instrument (card hash, UPI VPA).

**Bot defence in layers:** challenge (CAPTCHA, proof-of-work) at **registration**, when there is time, never at the buy click; behavioural signals (no deal-page view before buy, sub-100 ms click after page load); WAF rate limits per IP/ASN; and a **post-sale audit** that cancels clusters of orders to one address before dispatch. Bots adapt; the last layer is the one they cannot see.`,
      code: [
        {
          language: 'sql',
          title: 'Order worker: claim one concrete unit (parallel, no hot row, per-user limit in the index)',
          code: `-- one row per sellable unit, generated before the sale
CREATE TABLE sale_units (
  sale_id        text    NOT NULL,
  sku            text    NOT NULL,
  unit_no        int     NOT NULL,
  status         text    NOT NULL DEFAULT 'FREE',  -- FREE | RESERVED | SOLD
  user_id        bigint,
  reservation_id uuid    UNIQUE,                   -- idempotent re-delivery from Kafka
  reserved_at    timestamptz,
  PRIMARY KEY (sale_id, sku, unit_no)
);
-- the per-user limit, enforced by the database rather than by hope
CREATE UNIQUE INDEX one_unit_per_user ON sale_units (sale_id, sku, user_id)
  WHERE status <> 'FREE';

-- $1 sale, $2 sku, $3 user, $4 reservation id (from the Redis gate)
UPDATE sale_units u
   SET status = 'RESERVED', user_id = $3, reservation_id = $4, reserved_at = now()
 WHERE (u.sale_id, u.sku, u.unit_no) = (
         SELECT sale_id, sku, unit_no FROM sale_units
          WHERE sale_id = $1 AND sku = $2 AND status = 'FREE'
          LIMIT 1
          FOR UPDATE SKIP LOCKED)          -- skip rows other workers are claiming
RETURNING unit_no;
-- 0 rows  => truly sold out: tell the user, and INCR nothing back
-- unique violation on reservation_id => duplicate delivery: read the existing row`,
        },
      ],
      keyPoints: [
        'Redis failover can re-create decremented stock; finite unit rows make that an apology, not an oversell.',
        'Returned stock (10–30% lapsed payments) goes to a waitlist in order, not to whoever refreshes fastest.',
        'Put the expensive bot checks at registration; at T-0 every millisecond of friction punishes humans.',
      ],
      source: 'PostgreSQL docs — SELECT … FOR UPDATE SKIP LOCKED; Redis docs — replication and WAIT',
    },
    // ------------------------------------------------------------ PRICE TRACKER & ALERTS
    {
      heading: 'Price tracker & alerts (1/3): requirements, estimation, API & data model',
      body: `**Intuition:** the crawler is the **thermometer**; the alerting system is the **thermostat for 60 million rooms**. Each person sets their own trigger temperature, and the hard part is checking all of them every time the reading changes, without ringing anyone's alarm twice.

**Scope:** the web-crawler design (design-more) already covers fetching prices: frontier, politeness and re-crawl cadence. Here we take the stream of **price observations** as input and design the half that users actually feel: **rules, matching, notifications**. Name the boundary explicitly in the interview; it shows you can split a problem.

**Functional:**
- Create an alert on a product: **target price** ("tell me under ₹49,999"), **percentage drop** ("20% below today"), **any drop**, or **"lowest price in 90 days"**.
- Show price history charts (7d, 30d, 1y) and current price.
- Notify by email and push; manage, pause and delete alerts; one-click unsubscribe.
- Accept price reports from a browser extension (1M users) as an extra, untrusted signal.

**Non-functional:** notify within 1 hour of a real change (a common interview SLA; for a deal the sooner the better), **never notify twice for the same drop**, never notify on a parsing glitch (₹1,299 parsed as ₹1.299), eventual consistency is fine, and survive Prime Day / Big Billion Days when thousands of popular products drop at the same minute.

**Estimation:**

| Quantity | Calculation | Result |
|---|---|---|
| Tracked products | given | 500M |
| Active alerts | 20M users × 3 alerts | 60M alerts on ~25M distinct products |
| Price observations | crawler + extension | 200M/day ≈ 2.3K/s, 5× on sale days |
| Real changes | ~15% of observations | ≈ 350/s average, bursts of 20K in a minute |
| Alert storage | 60M × ~100 B (row) ×2 (index) | ≈ 12 GB: one Postgres primary, or 4 shards for headroom |
| Hot product | PS5 or iPhone during a sale | 300–500K alerts on one product |
| Notifications | ~3M/day; sale-day peak | 50–100/s average, 5K/s bursts |

Two things to notice: the matching load is tiny **if** each change touches only the alerts of that product, and the fan-out for one hot product is huge. The design is about the index shape and about the hot-product burst.

**API:**
- \`POST /alerts {productId, type: TARGET|PCT_DROP|ANY_DROP|LOW_90D, value?, channels}\` → \`201 {alertId}\`.
- \`GET /products/{id}/history?range=1y\` → downsampled series (daily min/max for 1y, hourly for 7d).
- \`POST /observations\` (extension) → \`202\`; untrusted until corroborated.

**Data model:**
- \`products(id, price_paise, price_seen_at, low_90d_paise, currency, seller_type)\`. Store money as **integer paise**, never floats.
- \`price_alerts(alert_id, user_id, product_id, type, target_paise, state ARMED|FIRED|PAUSED, fired_event_id, fired_at)\`, index \`(product_id, state, target_paise)\`.
- \`price_history\` in a time-series store (TimescaleDB/ClickHouse) partitioned by time, keyed by product.
- \`notify_outbox(idem_key PK, user_id, alert_id, product_id, price_paise)\`.`,
      keyPoints: [
        'Draw the boundary: crawling produces observations; alerting consumes changes.',
        'Matching is cheap per change if indexed by product; the hot product with 500K alerts is the real burst.',
        'Money in integer minor units; a float comparison at the threshold is a real bug source.',
      ],
      source: 'Hello Interview — Price Tracking Service (CamelCamelCamel) breakdown; Software Engineering Daily — CamelCamelCamel (2019)',
    },
    {
      heading: 'Price tracker & alerts (2/3): change detection & rule matching at scale',
      body: `**Intuition:** turn every kind of rule into **"a number on a sorted list"**. When the price moves, you do not ask each rule whether it cares; you ask the list "which thresholds are now above the price?", which is a range scan.

**Step 1 — change detection (before any matching):**
- Compare with the **last accepted price**, not the last observation. Equal price → update \`price_seen_at\` only, no event.
- **Validate:** a drop of more than ~60% versus the 30-day median is held as *suspicious* and re-fetched from a second crawler (different IP, different parser) before it becomes an event. Extension reports become events only when corroborated by the crawler or by 2+ unrelated users (the extension is an attack surface: anyone can post "₹1").
- Normalise: same seller type (first-party vs marketplace), in-stock only, coupons excluded unless the rule asks.
- Emit a **price event** with a monotonically increasing \`event_id\` (sequence), the old price, the new price, and flags such as \`NEW_90D_LOW\` (computed from 90 daily minimums kept per product).

**Step 2 — normalise rule types at creation time:**

| User rule | Stored as |
|---|---|
| Target ₹49,999 | \`target_paise = 4999900\` |
| 20% below today's ₹60,000 | \`target_paise = 4800000\` (computed once) |
| Any drop | \`target_paise = current − 1\`, moved down after each firing |
| Lowest in 90 days | subscription to flag \`NEW_90D_LOW\` on the product |

Now every threshold rule is a row in \`(product_id, state, target_paise)\` and every flag rule is a row in \`(product_id, flag)\`. A change event is answered with one index range scan per product.

**Step 3 — fire atomically.** One statement selects due alerts, flips them \`ARMED → FIRED\` and writes outbox rows. The state flip **is** the dedup: a redelivered event finds nothing \`ARMED\`, and the outbox's primary key \`alertId:eventId\` swallows any replay. For a hot product, loop in batches of 5,000 with \`SKIP LOCKED\` so several workers can drain a 500K-alert product in parallel.

**Step 4 — re-arm with hysteresis.** If the price bounces ₹49,990 → ₹50,010 → ₹49,990 every crawl, a naive "price ≤ target" rule fires on every dip. Re-arm only after the price climbs **5% above** the target (or after 24 h), so one real drop = one notification.

**Alternative for the matcher:** partition events by \`product_id\` in Kafka and hold each partition's alerts **in memory** as a sorted array of thresholds (60M × ~40 B ≈ 2.4 GB across the cluster). A binary search returns all due alerts in microseconds, but you must rebuild state on rebalance and still persist the FIRED state for dedup. The SQL version is simpler and fast enough at 350 changes/s; the in-memory version wins if changes reach tens of thousands per second.`,
      diagram: `crawler / extension observations (2.3K/s)
            |
            v
  +--------------------+  same price: touch seen_at only
  | change detector    |  suspicious drop: re-fetch first
  | (keyed by product) |
  +---------+----------+
            | price_event(event_id, product, old, new, flags)
            v
  +--------------------+    range scan (product_id, ARMED,
  | matcher workers    |--> target >= new) in 5K batches;
  | (Kafka, key=prod)  |    flip to FIRED + outbox, one txn
  +---------+----------+
            | outbox -> CDC -> Kafka "notify" (key = user_id)
            v
  +--------------------+   SEND / COOLDOWN / DIGEST / DUP
  | notify gate (Lua)  |------------------------------+
  +---------+----------+                              |
            | SEND                                    v
            v                               daily digest builder
  email (SES) / push (FCM, APNs) workers`,
      code: [
        {
          language: 'sql',
          title: 'Change detection, atomic fire-with-outbox, and hysteresis re-arm (Postgres)',
          code: `-- 1. Accept the observation only if the price really changed (returns the old price)
UPDATE products p SET price_paise = $2, price_seen_at = $3
  FROM (SELECT id, price_paise FROM products WHERE id = $1 FOR UPDATE) old
 WHERE p.id = old.id AND p.price_paise IS DISTINCT FROM $2 AND p.price_seen_at < $3
RETURNING old.price_paise AS old_price, nextval('price_event_seq') AS event_id;

-- 2. Fire due alerts in batches; the state flip and the outbox row commit together
WITH due AS (
  SELECT alert_id FROM price_alerts
   WHERE product_id = $1 AND state = 'ARMED' AND target_paise >= $2
   ORDER BY alert_id LIMIT 5000
   FOR UPDATE SKIP LOCKED),               -- parallel workers drain a hot product
fired AS (
  UPDATE price_alerts a SET state = 'FIRED', fired_event_id = $3, fired_at = now()
    FROM due WHERE a.alert_id = due.alert_id
  RETURNING a.alert_id, a.user_id)
INSERT INTO notify_outbox (idem_key, user_id, alert_id, product_id, price_paise)
SELECT fired.alert_id || ':' || $3, fired.user_id, fired.alert_id, $1, $2 FROM fired
ON CONFLICT (idem_key) DO NOTHING;        -- replayed event: no second notification
-- repeat while rowCount = 5000

-- 3. Re-arm only when the price is 5% above the target (integer maths, no floats)
UPDATE price_alerts SET state = 'ARMED'
 WHERE product_id = $1 AND state = 'FIRED' AND target_paise * 105 < $2 * 100;`,
        },
      ],
      keyPoints: [
        'Convert % drop and "any drop" into absolute thresholds at creation, so matching is a range scan.',
        'The ARMED → FIRED flip plus an outbox row in one transaction is both the dedup and the delivery guarantee.',
        'Hysteresis (re-arm 5% above target) stops a price oscillating around the threshold from spamming users.',
      ],
      source: 'Hello Interview — CamelCamelCamel deep dives (alert matching, validating extension updates)',
    },
    {
      heading: 'Price tracker & alerts (3/3): fan-out, throttling, digests & trade-offs',
      body: `**Intuition:** a notification is a **promise that this is worth interrupting someone**. Each extra one spends trust; after the third useless email, users unsubscribe from everything.

**Fan-out path:** the outbox is published via CDC to a Kafka \`notify\` topic **keyed by user_id**, so all of one user's notifications land on one partition and per-user decisions are local and ordered. A gate decides per message:
- **DUP:** this exact \`alertId:eventId\` was handled (redelivery after a consumer crash).
- **COOLDOWN:** the user was told about this product in the last 6–24 h (multiple alerts on one product, or a re-armed alert firing again).
- **DIGEST:** the user already got their daily cap (e.g. 5); the rest roll into one evening digest email.
- **SEND:** deliver now.

**Freshness check before sending:** if a message has waited more than ~30 min (sale-day backlog), re-read the current price. If it bounced back above the target, drop the alert, re-arm it and say nothing. A "price dropped!" email for a price that no longer exists is worse than silence.

**The hot-product burst:** iPhone drops at midnight with 400K alerts. Matching drains in about 80 batches of 5K in seconds; the bottleneck is the **providers**: SES or an Indian SMS/WhatsApp gateway may accept 1–5K/s per account, and FCM throttles per project. Use a per-channel token bucket in the workers, prioritise push (cheap, instant) over email, and send in random user order so one region's mail server is not hammered in sequence. At 3K/s, 400K messages take about 2.2 minutes, comfortably inside the 1-hour SLA.

**Trade-offs to state:**

| Decision | Choice | Cost |
|---|---|---|
| Matching store | Postgres range scan | Simple, durable; needs batching for hot products |
| | In-memory sorted thresholds per partition | µs matching; rebuild on rebalance |
| Dedup | state flip + outbox PK + gate key | Three layers, because each catches a different replay |
| Freshness vs cost | re-check price before late sends | Extra read per delayed message |
| Throttling | cooldown + daily cap + digest | Some alerts arrive hours later by design |

**Interview line:** "The matching is a range scan; the product decisions are dedup, hysteresis and throttling, because the failure users notice is spam, not latency."`,
      code: [
        {
          language: 'lua',
          title: 'Notify gate: idempotency, per-product cooldown, daily cap (one cluster slot per user)',
          code: `-- All keys share the hash tag {u:<userId>} so they live on one cluster slot
-- KEYS[1] = idem:{u:42}:<alertId>:<priceEventId>
-- KEYS[2] = cool:{u:42}:<productId>
-- KEYS[3] = day:{u:42}:<yyyymmdd>
-- ARGV[1] = cooldownSec, ARGV[2] = dailyCap, ARGV[3] = idemTtlSec
if not redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[3]) then
  return 'DUP'                                   -- this exact event was already handled
end
if redis.call('EXISTS', KEYS[2]) == 1 then return 'COOLDOWN' end
local n = redis.call('INCR', KEYS[3])
if n == 1 then redis.call('EXPIRE', KEYS[3], 172800) end
if n > tonumber(ARGV[2]) then return 'DIGEST' end  -- over the cap: roll into the digest
redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
return 'SEND'`,
        },
      ],
      keyPoints: [
        'Key the notify topic by user_id so throttling and ordering are per-partition decisions.',
        'Re-check the price before sending anything that waited in a backlog; stale deals destroy trust.',
        'Provider rate limits, not matching, bound how fast a hot-product burst drains.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 10 (notification system); Hello Interview — CamelCamelCamel',
    },
    // ------------------------------------------------------------ TINDER
    {
      heading: 'Tinder (1/3): requirements, estimation, API & data model',
      body: `**Intuition:** Tinder is **two systems glued together**. One is a write-heavy ledger of yes/no decisions where a pair of yeses must turn into exactly one match. The other is a geo-filtered search engine that must never show you someone you already judged.

**Functional:** create a profile with preferences (age range, distance, genders); get a **stack** of nearby candidates; swipe left (pass) or right (like), plus super-like; get notified on a mutual like; list matches and chat (chat is the WhatsApp design, out of scope). **Never re-show** a profile already swiped on.

**Non-functional:** swipe acknowledgement p99 < 200 ms and it must feel instant (the client does not wait for it); **match creation is exactly-once and strongly consistent** for the pair, even when both swipe at the same moment; stack generation < 300 ms; availability over consistency for the stack (a slightly stale stack is fine).

**Estimation:**

| Quantity | Calculation | Result |
|---|---|---|
| Users | 75M MAU, 20M DAU | |
| Swipes | 20M × 100/day = 2B/day | ≈ 23K/s average, ~70K/s at the 9–11 pm peak |
| Likes | ~30% of swipes | ≈ 600M/day |
| Swipe log | 2B × ~100 B (with overhead) | ≈ 200 GB/day before replication |
| Hot pair state in Redis | 600M likes/day × 7 days × ~90 B | ≈ 380 GB → ~40 shards of 10 GB |
| Stack requests | 20M × ~10 refills/day | ≈ 2.3K/s, cacheable |

**API:**
- \`GET /stack?limit=20\` → candidate profiles (the client keeps 20 ahead and refills at 5 left).
- \`POST /swipes {targetId, decision: L|R|S, clientSwipeId}\` → \`202 {match?: matchId}\`.
- \`GET /matches?cursor=\`; \`DELETE /matches/{id}\` (unmatch blocks both ways forever).
- Push or WebSocket event \`match.created\` to both users.

**Data model:**
- \`profiles\` (Postgres, by user_id) and a **search index** per geoshard (Elasticsearch): location (S2 cell + lat/lng), age, gender, preferences, last active, ranking features.
- \`swipes_by_swiper(swiper_id, target_id, decision, ts)\` in Cassandra, partition = swiper: rebuilds the "already swiped" filter.
- \`likes_received(target_id, liker_id, ts)\`: powers "Likes You" and the fallback match check for old likes.
- \`matches(user_id, match_id, other_id, created_at)\` written for **both** users.
- Redis: one hash per unordered pair \`sw:{lowId:highId}\` with fields \`lo\`, \`hi\`, \`m\`, TTL 7 days.`,
      keyPoints: [
        '2B swipes/day ≈ 23K/s average and ~70K/s peak; the swipe log is ~200 GB/day before replication.',
        'Keep only recent likes in Redis for match detection; older likes fall back to the durable log.',
        'Write matches for both users so each side reads their match list from one partition.',
      ],
      source: 'Hello Interview — Tinder breakdown; ByteByteGo — How Tinder recommends to 75 million users',
    },
    {
      heading: 'Tinder (2/3): swipes & exactly-once match detection',
      body: `**Intuition:** a match is **two keys turning in one lock**. If each side's key is stored in a different place, two people turning at the same instant can each look at the other's empty slot and walk away. Put both slots in **one** place and turn them under one lock.

**The race:** A and B swipe right on each other within 10 ms. With a "write my like, then read theirs" design on two partitions (\`likes_by_swiper\`), A writes A→B and reads B→A (not there yet); B writes B→A and reads A→B (not there yet either, if replication is slow) → **no match ever**. Or both see the other → **two matches** and two "It's a match!" pushes. Cassandra lightweight transactions only help within one partition, and A's and B's likes live in different ones.

**Fix: co-locate the pair.** Key the state by the **unordered pair** \`(min(A,B), max(A,B))\` with a Redis Cluster hash tag so the whole pair lives in one slot. One Lua script records my decision, reads the other side and, if both are \`R\`, sets a \`m\` field with \`HSETNX\`. Only the script that wins \`HSETNX\` returns \`MATCH\`, so exactly one match event is emitted no matter how the two swipes interleave or how often the client retries.

**Flow for a right swipe:**
1. API → Lua script on \`sw:{lo:hi}\`. Left swipes skip Redis entirely (they cannot create a match) and go straight to the log.
2. Every swipe is appended to Kafka (key = swiper_id) → Cassandra \`swipes_by_swiper\` and \`likes_received\`, and the swiper's Bloom filter is updated.
3. On \`MATCH\`: write \`matches\` rows for both users idempotently (match_id = hash of the pair), then push \`match.created\` to both through the notification and WebSocket gateways.
4. **Old likes:** the pair hash expires after 7 days. If B liked A 3 months ago and A swipes right today, the script finds no \`hi\` field. When the script reports a freshly created pair, the service also checks \`likes_received(A, B)\` in Cassandra; a like that old cannot be racing, so the extra read is safe, and the match is created through the same \`HSETNX\` path.

**Why not just a database?** A Postgres table with a unique constraint on the pair and \`INSERT … ON CONFLICT\` also gives exactly-once matches, but 70K/s peak swipes on one row-per-pair table needs sharding by pair anyway. Redis gives ~1 ms decisions; durability comes from the Kafka log, and the worst case after a Redis failover is a missed match for a few hundred pairs, repaired by a nightly join over \`likes_received\`.

**Undo ("rewind") and unmatch:** rewind is allowed only for the last swipe and only if it did not create a match (delete the field, append a compensating event). Unmatch writes a **block** for both directions so neither profile is ever recommended again.`,
      code: [
        {
          language: 'lua',
          title: 'Match detection on the unordered pair: idempotent, exactly one MATCH',
          code: `-- KEYS[1] = sw:{<lowId>:<highId>}   one hash per unordered pair (single slot)
-- ARGV[1] = 'lo' | 'hi' (which side is swiping), ARGV[2] = 'L' | 'R', ARGV[3] = ttlSec
local me = ARGV[1]
local other = (me == 'lo') and 'hi' or 'lo'
local prev = redis.call('HGET', KEYS[1], me)
if prev then return {'DUP', prev} end           -- first decision wins; retries are no-ops
redis.call('HSET', KEYS[1], me, ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
if ARGV[2] == 'R' and redis.call('HGET', KEYS[1], other) == 'R' then
  -- both liked: only the caller that creates the 'm' field announces the match
  if redis.call('HSETNX', KEYS[1], 'm', '1') == 1 then return {'MATCH', 'R'} end
end
return {'OK', ARGV[2]}`,
        },
      ],
      keyPoints: [
        'Two likes stored on two partitions can race into zero or two matches; co-locate the pair.',
        'HSETNX on a "matched" field makes the match announcement exactly-once under retries.',
        'Expire hot pair state; check the durable likes log only when the pair was not in Redis.',
      ],
      source: 'Hello Interview — Tinder (consistency of match creation); Redis docs — Lua scripting and hash tags',
    },
    {
      heading: 'Tinder (3/3): geosharded recommendations & never re-showing a profile',
      body: `**Intuition:** the stack is **a search query with a memory**: "people near me who match my filters and would also want me", minus everyone I have already judged.

**Geosharding (what Tinder published):** the world is divided with Google's **S2** library (Hilbert-curve cells keep nearby places close). Sparse regions use larger level-7 cells (~45 miles), dense cities level-8 (~22 miles). Neighbouring cells are grouped into **geoshards of roughly equal activity**, each its own Elasticsearch index; busy shards get more replicas. A query covers the shards that intersect the user's search circle, usually one or two. Profile updates flow through Kafka keyed by user so updates apply in order, and a user who moves to another city is re-indexed into the new shard.

**Stack pipeline:**
1. **Candidate generation (Elasticsearch):** filter by distance, age range, gender, **mutual preference** (my age is inside their range), not blocked, active in the last 7 days. Return ~500.
2. **Exclusion:** drop anyone in my swiped filter (below).
3. **Ranking:** a model or plugin scores likelihood of a mutual like; **people who already liked me** get boosted, because showing them creates matches.
4. **Exposure control:** cap how often very popular profiles are shown per hour; otherwise the top 1% absorb most impressions and everyone else gets no matches.
5. **Cache** 100–200 ranked cards per user (TTL ~1 h). The client prefetches 20 and refills at 5 left, so swipes feel instant.

**Never re-show a profile:**
- **Exact set** (Cassandra \`swipes_by_swiper\`) is the truth but is too slow to check 500 candidates per stack build for heavy swipers.
- **Bloom filter per user**: ~10 bits per swiped profile at a 1% false-positive rate, 7 hash functions. 5K lifetime swipes ≈ 6 KB, a 50K-swipe power user ≈ 59 KB. A false positive only hides one candidate; a false negative (re-showing) **cannot happen**.
- Store the bit array in Redis, load it when building the stack, and add swipes as they happen. Rebuild it from Cassandra if lost, and resize it (rebuild at 2× capacity) when the user exceeds the planned count, because a full filter's false-positive rate climbs fast.
- **Client side:** the client also skips ids it has swiped in this session, covering swipes not yet reflected in the server filter.

**Trade-offs:** a precomputed stack is fast but goes stale (people move, people match elsewhere), so keep the TTL short and re-filter cached cards against the Bloom filter at serve time. Purely on-demand ES queries are always fresh but cost ~50–100 ms each.`,
      code: [
        {
          language: 'typescript',
          title: 'Per-user swiped filter (Bloom filter, double hashing, no false negatives)',
          code: `import { createHash } from 'node:crypto';

/** Per-user "already swiped" filter: no false negatives, ~1% false positives. */
export class SwipedFilter {
  readonly bits: Uint8Array;
  readonly m: number; // number of bits
  readonly k: number; // number of hash functions

  constructor(expectedSwipes: number, fpRate = 0.01, bits?: Uint8Array) {
    this.m = Math.ceil((-expectedSwipes * Math.log(fpRate)) / Math.LN2 ** 2);
    this.k = Math.max(1, Math.round((this.m / expectedSwipes) * Math.LN2));
    this.bits = bits ?? new Uint8Array(Math.ceil(this.m / 8)); // bytes loaded from Redis
  }

  // Kirsch–Mitzenmacher: k indexes from two 32-bit hashes of one digest
  private *indexes(profileId: string) {
    const d = createHash('sha256').update(profileId).digest();
    const h1 = d.readUInt32BE(0);
    const h2 = (d.readUInt32BE(4) | 1) >>> 0; // odd and unsigned: '|' alone yields a negative int32
    for (let i = 0; i < this.k; i++) yield (h1 + i * h2) % this.m;
  }

  add(profileId: string) {
    for (const i of this.indexes(profileId)) this.bits[i >> 3] |= 1 << (i & 7);
  }

  mightContain(profileId: string): boolean {
    for (const i of this.indexes(profileId)) if (!(this.bits[i >> 3] & (1 << (i & 7)))) return false;
    return true; // probably swiped: skip the card (a false positive hides one profile)
  }
}
// new SwipedFilter(5000): m = 47,926 bits (≈ 6 KB), k = 7; measured FP ≈ 1.0%`,
        },
      ],
      keyPoints: [
        'Geoshards of equal load (S2 cells grouped), one search index each; a query touches one or two shards.',
        'Filter on mutual preference and boost people who already liked you: the goal is matches, not views.',
        'A Bloom filter can only err towards hiding a profile, which is the safe direction for this product.',
      ],
      source: 'Tinder Engineering — Geosharded Recommendations; ByteByteGo — How Tinder recommends to 75M users',
    },
    // ------------------------------------------------------------ NEWS AGGREGATOR
    {
      heading: 'News aggregator (1/3): requirements, estimation & the ingestion pipeline',
      body: `**Intuition:** Google News is **an editor who reads 3 million articles a day, staples together the ones about the same event, and puts the most important bundles on the front page**, then reshuffles that page every minute.

**Functional:** ingest articles from ~100K publishers (RSS/Atom, sitemaps, publisher APIs, raw HTML); group articles about the same event into **stories**; show a ranked feed per **edition** (country × language) with Top Stories, local news and topic sections; personalise "For you"; infinite scroll; clicking opens the publisher's page (we store metadata, snippet and thumbnail, never full text).

**Non-functional:** a new article from a major publisher appears within minutes (30 minutes is a common bar; aim for under 5 for top sources); feed p99 < 200 ms; availability over consistency (a feed one minute old is fine); survive breaking-news surges of 5–10× on both ingestion and reads; be polite to publishers.

**Estimation:**

| Quantity | Calculation | Result |
|---|---|---|
| New articles | 3M/day | ≈ 35/s average, ~350/s during breaking news |
| Feed polls | 100K feeds, adaptive cadence | ≈ 150 fetches/s, most answered 304 Not Modified |
| Readers | 100M DAU × 10 feed loads | 1B/day ≈ 11.6K QPS, ~60K QPS during a big event |
| Metadata | 3M × ~5 KB (incl. a 384-dim embedding ≈ 1.5 KB) | ≈ 15 GB/day, ~450 GB for a 30-day hot window |
| Editions | ~70 countries × languages | ~150 precomputed edition lists |

Ingestion is small; **reads dominate** (a classic "scale the reads" problem), and the intellectual core is dedup and clustering.

**Ingestion pipeline:**
1. **Source registry:** per feed, tier (wire service, national daily, blog), language, region, crawl politeness and the **observed publishing rate**.
2. **Adaptive polling:** poll each feed about twice per expected new item (a wire service every minute, a weekly blog every few hours), with conditional GET (\`ETag\`, \`If-Modified-Since\`). Use **WebSub** push where publishers support it.
3. **Fetch & extract:** fetch new article URLs, extract title, author, published time, lead paragraph, image, language; resolve the **canonical URL** (\`rel=canonical\`, strip \`utm_*\`, AMP → canonical).
4. **Exact dedup:** canonical URL and a hash of normalised body text.
5. **Enrich:** language detection, named entities (people, organisations, places), embedding, topic classification, location.
6. **Near-dup and clustering** (next section), then indexing and edition ranking.`,
      diagram: `  100K feeds (RSS, sitemaps, APIs, WebSub push)
        |  adaptive polling, conditional GET
        v
  +-----------+   new URLs   +---------+   +--------------------+
  | scheduler |------------->|  Kafka  |-->| fetch + extract    |
  | (registry)|              | urls    |   | canonical URL,     |
  +-----------+              +---------+   | exact dedup        |
                                           +---------+----------+
                                                     v
  +------------------+   +--------------------+   +------------------+
  | edition ranker   |<--| story clusterer    |<--| enrich: entities,|
  | every 60 s per   |   | near-dup (MinHash) |   | embedding, topic |
  | country/language |   | + story assignment |   +------------------+
  +--------+---------+   +---------+----------+
           |                       v
           v                 article + story store (KV / Bigtable-like)
  Redis / CDN: edition lists        |
           |                       v
           v                 search index (topics, entities)
  feed API (+ personal re-rank) <-- user affinity store`,
      code: [
        {
          language: 'typescript',
          title: 'Adaptive per-feed polling: about twice per expected item, faster for top publishers',
          code: `type FeedState = { ewmaGapMs: number; lastPollAt: number; tier: 1 | 2 | 3 };
const MIN_MS = 60_000;          // never poll one feed more than once a minute
const MAX_MS = 6 * 3_600_000;   // and never let a feed go unchecked for more than 6 h

export function schedule(s: FeedState, newItems: number, now: number) {
  const elapsed = now - s.lastPollAt;
  // gap between items seen in this window; an empty poll means the feed is quieter than we thought
  const observed = newItems > 0 ? elapsed / newItems : Math.max(elapsed, s.ewmaGapMs) * 1.5;
  const ewmaGapMs = 0.3 * observed + 0.7 * s.ewmaGapMs;            // smooth out bursts
  const base = ewmaGapMs / 2 / (4 - s.tier);                        // tier 1 polls 3x as often as tier 3
  const jittered = base * (0.9 + Math.random() * 0.2);              // avoid synchronized polls
  const delay = Math.min(MAX_MS, Math.max(MIN_MS, jittered));
  return { state: { ...s, ewmaGapMs, lastPollAt: now }, nextPollAt: now + delay };
}`,
        },
      ],
      keyPoints: [
        'Ingestion is ~35 articles/s; reads at 11.6K–60K QPS dominate, so precompute and cache feeds.',
        'Poll adaptively from each feed\'s observed rate, use conditional GET, and prefer WebSub push.',
        'Store metadata and snippets only; the click goes to the publisher.',
      ],
      source: 'Hello Interview — News Aggregator breakdown; DesignGurus — Design a global news aggregator',
    },
    {
      heading: 'News aggregator (2/3): near-duplicate detection & story clustering',
      body: `**Intuition:** there are **three different kinds of "same"**. The same URL twice (exact duplicate), the same PTI wire copy republished by 40 newspapers (near-duplicate), and 40 *different* articles about the same Budget speech (same story). Each needs a different tool.

**1. Exact duplicates:** canonical URL + hash of normalised text. Cheap and catches re-polls and redirects.

**2. Near-duplicates (syndication):** wire copy appears with different headers, bylines and a changed first line. Use **MinHash** on 5-word shingles: a 100-value signature per article, split into **20 bands of 5 rows** for locality-sensitive hashing. Two articles become candidates if any band matches; the probability is \`1 − (1 − s⁵)²⁰\`: about **99.96%** at Jaccard 0.8, **47%** at 0.5 and **5%** at 0.3. Verify candidates against the full signature (estimated Jaccard ≥ 0.8). Keep one representative, preferring the original wire or the most authoritative source, and store the rest as alternates. (SimHash, used for web-crawl dedup, works too; MinHash gives a tunable similarity threshold.)

**3. Story clustering (different articles, same event):** online, incremental, because stories form in minutes.
- **Candidates:** stories active in the last 48 h that share a salient named entity with the article (inverted index entity → story ids), plus an approximate-nearest-neighbour lookup on embeddings as a fallback for entity-poor articles.
- **Assign:** cosine similarity between the article embedding and each candidate's **centroid**; join the best if ≥ τ (tuned on labelled pairs, e.g. 0.78), else start a new story. Update the centroid as a running mean.
- **Repair offline:** every 10–15 minutes re-cluster the last 24 h with a batch algorithm (agglomerative/HDBSCAN) to **merge** stories that started separately ("Earthquake in Nepal" + "Tremors felt in Delhi") and **split** chained ones. Keep **story ids stable** by mapping each new cluster to the old story with the largest article overlap, otherwise shared links and push notifications break.

**Failure modes to name:** *chaining* (a centroid drifts as tangential articles join, until "Budget 2026" swallows all economy news; cap the window and require entity overlap); *granularity* (is a cricket match one story or ball-by-ball updates? product decision, enforced via τ per topic); *multilingual* stories (use multilingual embeddings so the Hindi and English coverage cluster together, but display per edition).`,
      code: [
        {
          language: 'typescript',
          title: 'Incremental story clustering: entity-gated candidates, centroid cosine, running mean',
          code: `type Article = { id: string; vec: number[]; entities: string[]; publishedAt: number };
type Story = { id: string; centroid: number[]; size: number; lastAt: number };

const WINDOW_MS = 48 * 3_600_000; // only join stories active in the last 48 h
const JOIN_SIM = 0.78;            // cosine threshold, tuned offline on labelled pairs

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const cosine = (a: number[], b: number[]) => dot(a, b) / (Math.sqrt(dot(a, a) * dot(b, b)) || 1);

export class StoryClusterer {
  private stories = new Map<string, Story>();
  private byEntity = new Map<string, Set<string>>(); // entity -> story ids (inverted index)
  private seq = 0;

  assign(a: Article): string {
    const cand = new Set<string>();
    for (const e of a.entities) for (const sid of this.byEntity.get(e) ?? []) cand.add(sid);
    let best: Story | undefined;
    let bestSim = 0;
    for (const sid of cand) {
      const s = this.stories.get(sid)!;
      if (a.publishedAt - s.lastAt > WINDOW_MS) continue;  // story has gone cold
      const sim = cosine(a.vec, s.centroid);
      if (sim > bestSim) { best = s; bestSim = sim; }
    }
    let s: Story;
    if (best && bestSim >= JOIN_SIM) {
      s = best;
      s.centroid = s.centroid.map((c, i) => c + (a.vec[i] - c) / (s.size + 1)); // running mean
      s.size++;
      s.lastAt = Math.max(s.lastAt, a.publishedAt);
    } else {
      s = { id: 'st-' + ++this.seq, centroid: [...a.vec], size: 1, lastAt: a.publishedAt };
      this.stories.set(s.id, s);
    }
    for (const e of a.entities) {
      if (!this.byEntity.has(e)) this.byEntity.set(e, new Set());
      this.byEntity.get(e)!.add(s.id);
    }
    return s.id;
  }
}`,
        },
      ],
      keyPoints: [
        'Exact dup (URL/hash), near-dup (MinHash LSH, 20×5 bands ≈ 0.55 threshold) and same-story clustering are three separate stages.',
        'Online assignment for freshness, periodic batch re-clustering for quality, with stable story ids.',
        'Entity gating keeps candidate sets small and limits centroid chaining; add ANN for entity-poor articles.',
      ],
      source: 'Google — US Patent 8,832,105 (incrementally clustering news stories); Broder — MinHash (1997)',
    },
    {
      heading: 'News aggregator (3/3): ranking, personalisation, freshness & serving',
      body: `**Intuition:** rank **stories, not articles**, and let the front page **decay** like a newspaper that reprints itself every minute: a story must keep earning its place.

**Story score** (recomputed per edition every ~60 s for stories active in the last 48 h):
- **Breadth:** \`log(1 + distinct sources in the last 2 h)\`. Forty outlets covering it matters, but not 40× more than one.
- **Velocity:** articles in the last hour relative to the story's own baseline, so a fast-growing story beats a large, stale one.
- **Quality:** source authority (historical reliability, original reporting) with a boost when the cluster contains original reporting rather than only rewrites.
- **Freshness decay:** multiply by \`0.5^(age / 6 h)\`, so an unchanging story halves its score every six hours.
- **Locality:** stories whose entities or publishers are local to the edition get an edition-specific boost.

**Personalisation:** maintain a per-user affinity vector over topics and entities from clicks and dwell time (exponentially decayed, e.g. 14-day half-life). "For you" = candidates from the edition's top 500 stories + followed topics + local stories, re-ranked by \`score × (1 + α · affinity)\`. Keep **Top Stories unpersonalised** (editorial integrity, filter-bubble concerns), and enforce diversity: one card per story, max 2 consecutive cards on one topic, 3–5 sources per card with different outlets.

**Serving reads at 60K QPS:**
- The ranker writes each edition's ordered list to Redis with a **version** every 60 s; the API and CDN serve it with \`max-age=30, stale-while-revalidate=60\`. Logged-out traffic (most of it) is pure CDN.
- Logged-in "For you" = cached edition list + user affinity (one KV read) → re-rank in-process in a few ms → hydrate cards from the story cache.
- **Pagination over a moving list:** the cursor carries \`(feedVersion, offset)\`. Page 2 is read from the same version (kept for 10 minutes), so items do not repeat or vanish when the ranking changes between scrolls. When that version expires, fall back to the newest version, skipping story ids already seen.
- **Breaking-news surge:** reads hit the CDN, so origin load barely moves. Ingestion of the hot story bumps the cluster's velocity, and a breaking-news push goes to the edition's subscribers via the notification service with a strict per-user daily cap.

**Trade-offs to state:** online clustering (fresh, sometimes wrong) vs batch (correct, minutes late), so do both. Global precompute (cheap, identical for all) vs per-user ranking (relevant, costly), so precompute per edition and re-rank per user. Freshness decay half-life: short favours breaking news, long favours depth; tune per section.`,
      code: [
        {
          language: 'typescript',
          title: 'Story score and the personal re-rank',
          code: `type StoryStats = {
  firstSeenAt: number;
  sources2h: number;          // distinct publishers in the last 2 h
  articles1h: number;         // articles added in the last hour
  baselinePerHour: number;    // this story's own average rate so far
  authority: number;          // 0..1, mean reliability of its sources
  originalReporting: boolean; // at least one non-rewrite article
};
const HALF_LIFE_H = 6;

export function storyScore(s: StoryStats, now: number): number {
  const ageH = (now - s.firstSeenAt) / 3_600_000;
  const breadth = Math.log1p(s.sources2h);
  const velocity = Math.log1p(s.articles1h / Math.max(1, s.baselinePerHour));
  const quality = 0.5 + s.authority + (s.originalReporting ? 0.3 : 0);
  const freshness = Math.pow(0.5, ageH / HALF_LIFE_H);   // halves every 6 h
  return (breadth + velocity) * quality * freshness;
}

// "For you": boost by the user's affinity (0..1) to the story's topics, never filter
export const personalScore = (score: number, affinity: number, alpha = 0.6) =>
  score * (1 + alpha * affinity);`,
        },
      ],
      keyPoints: [
        'Rank stories with breadth, velocity, authority and exponential freshness decay.',
        'Precompute per edition every minute; personalise by re-ranking a cached candidate list.',
        'Version the ranked list and paginate within a version, or infinite scroll repeats and skips items.',
      ],
      source: 'Hello Interview — News Aggregator deep dives (pagination, freshness, surges)',
    },
    // ------------------------------------------------------------ STRAVA
    {
      heading: 'Strava (1/3): requirements, estimation & activity ingestion',
      body: `**Intuition:** the phone or watch is the **flight recorder**; the server is the **post-flight analyst**. Recording happens entirely on the device, offline if needed, and the backend's job is to process a finished file: clean it, measure it, time it over every known segment and tell your friends.

**Functional:** record runs and rides (start, pause, stop, save) with live stats on the device; upload the activity; see route, distance, pace, elevation, splits; **segments** (named stretches of road) with per-segment times and **leaderboards** (overall, by age/weight, this year, friends); a feed of friends' activities with kudos and comments; privacy controls.

**Non-functional:** recording works **without connectivity** (mountain passes); no recorded data is ever lost; processing finishes within ~1 minute of upload; feeds and leaderboards may lag seconds; **privacy rules must never fail open** (a hidden home location must never leak in a map, a stream or an API).

**Estimation (assumptions stated):**

| Quantity | Calculation | Result |
|---|---|---|
| Uploads | assume 5M activities/day | ≈ 58/s average; Sunday morning + device sync bursts ≈ 10× → ~600/s |
| Points per activity | 1 h at 1 Hz | 3,600 points |
| Raw stream size | 3,600 × ~40 B (lat, lng, alt, t, HR, cadence, power) | ≈ 144 KB |
| Raw storage | 5M × 144 KB | ≈ 720 GB/day; delta + varint encoding ~5× → ~150 GB/day (~55 TB/year) |
| Live sharing | 5% of 10M concurrent recorders send a point every 15 s | ≈ 33K/s small writes |

The design consequence: because recording is local, **10M concurrent athletes do not mean 10M concurrent streams to the server**; the server sees ~600 uploads/s at peak plus an optional live-sharing trickle.

**Ingestion:**
1. Client finishes and calls \`POST /uploads\` → gets a presigned S3 URL and an \`uploadId\`; uploads the FIT/GPX file (resumable for large files). Third-party devices (Garmin) deliver via webhooks into the same path.
2. S3 event → Kafka \`activity.uploaded\` (key = athlete_id).
3. **Dedup:** the same ride from watch and phone → reject on (athlete, start time ± 60 s, overlapping route) or identical file hash.
4. **Parse & clean:** drop GPS spikes (implied speed > 100 km/h on a run), compute moving time (auto-pause below a speed threshold), smooth elevation against a terrain model.
5. **Store:** summary row in the activity DB; streams as a **columnar object** in S3 (arrays of lat, lng, t, …) so a chart reads only the columns it needs.
6. Emit \`activity.processed\` → segment matcher, stats/achievements, feed fan-out, notifications. Each consumer is idempotent by activity id, so a replay is safe.`,
      diagram: `  device (records offline, FIT/GPX)
        | 1. POST /uploads -> presigned URL       live beacon (opt-in)
        | 2. PUT file (resumable)                 point / 15 s ---> live svc
        v                                                         (Redis TTL)
  +-----------+  S3 event  +--------------------+
  |    S3     |----------->| Kafka              |
  |  raw file |            | activity.uploaded  |
  +-----------+            +---------+----------+
                                     v
                  +-------------------------------------+
                  | parse -> dedup -> clean -> stats    |
                  | streams -> S3 (columnar per field)  |
                  | summary -> activity DB              |
                  +------------------+------------------+
                                     | activity.processed
          +--------------------------+-------------------------+
          v                          v                         v
  segment matcher           feed fan-out (privacy         achievements,
  (R-tree candidates,       applied, followers'           notifications
   geometric match)         timelines)                    ("new PR")
          |
          v
  segment_efforts -> best_efforts -> leaderboards (Redis ZSET per segment)`,
      keyPoints: [
        'Offline-first recording turns "10M concurrent users" into ~600 uploads/s at peak.',
        'Presigned upload + S3 event + Kafka makes ingestion durable before any processing runs.',
        'Store streams column by column; most screens need two or three of the fields.',
      ],
      source: 'Hello Interview — Strava breakdown (offline support, 10M concurrent activities, real-time sharing, leaderboards)',
    },
    {
      heading: 'Strava (2/3): segment matching — finding every segment a GPS trace rode',
      body: `**Intuition:** a segment is **a stretch of road with a start line and a finish line**. An activity "did" the segment if it crossed the start, followed the road (not a shortcut), and later crossed the finish; the effort time is the time between those crossings.

**Why it is hard:** GPS points are 3–10 m noisy and 1–5 s apart, so no point lies exactly on the start line; popular urban areas have thousands of overlapping segments; a ride can do the same climb three times (three efforts); and a shortcut through a park must not count.

**Step 1 — candidates (spatial index):** Strava's patent describes converting the trace into a set of **minimum bounding rectangles** and querying an **R-tree of segment rectangles**; PostGIS with a GiST index does the same thing. Simplify the trace first (Douglas–Peucker to ~10 m), cover it with ~1 km MBRs, and fetch segments whose rectangles intersect, then keep those whose start point lies near the route. A 2-hour city ride typically yields 50–300 candidates.

**Step 2 — geometric match per candidate:**
- Find a **pass** near the start (route points within ~25 m) and take the closest point in that pass; then the first later pass near the finish.
- **Coverage:** at least ~80% of the segment's points must lie within ~30 m of the route between those two points. That rejects shortcuts and parallel roads. (The patent describes a "loose" match at ~65% coverage and a "tight" match at ~80% that also crosses the start and finish lines.)
- Effort time = time at finish − time at start, interpolated between the two GPS points that straddle each line for sub-second accuracy.
- Continue searching after the finish for **repeat efforts** (laps).

**Cost:** 600 uploads/s × ~100 candidates × an O(segment × window) check with sampled points is about 60K candidate checks per second at ~0.5 ms each, roughly 30 cores of pure geometry and ~100 with parsing and I/O overhead: an autoscaled consumer group partitioned by athlete. Matching is embarrassingly parallel per activity.

**New segments and corrections:** when a user creates a segment, existing activities are not instantly re-timed. A **backfill job** (bounding-box query over historical activity summaries, then geometric match) re-matches lazily, popular segments first. When a segment is edited, its efforts are recomputed and leaderboards rebuilt from the effort table, which is why efforts, not leaderboards, are the source of truth.`,
      code: [
        {
          language: 'typescript',
          title: 'Match one segment against a GPS trace: start pass → finish pass → coverage, repeats included',
          code: `type LatLng = { lat: number; lng: number };
type Pt = LatLng & { t: number }; // t = epoch seconds
type Effort = { startIdx: number; endIdx: number; elapsedS: number };

const M_PER_DEG = 111_320;
// Equirectangular distance: accurate to well under 1% at segment scale (a few km)
function distM(a: LatLng, b: LatLng): number {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(x, b.lat - a.lat) * M_PER_DEG;
}

// Closest route point inside the next "pass" within radius of target, searching from index 'from'
function closestPass(route: Pt[], target: LatLng, from: number, radius: number): number {
  let i = from;
  while (i < route.length && distM(route[i], target) > radius) i++;
  if (i === route.length) return -1;
  let best = i;
  for (; i < route.length && distM(route[i], target) <= radius; i++)
    if (distM(route[i], target) < distM(route[best], target)) best = i;
  return best;
}

export function matchSegment(route: Pt[], seg: LatLng[], startR = 25, followR = 30, minCover = 0.8): Effort[] {
  const efforts: Effort[] = [];
  const start = seg[0], end = seg[seg.length - 1];
  for (let from = 0; ; ) {
    const s = closestPass(route, start, from, startR);
    if (s < 0) break;
    const e = closestPass(route, end, s + 1, startR);
    if (e < 0) break;
    // did the athlete follow the segment between s and e, or take a shortcut?
    const window = route.slice(s, e + 1);
    const covered = seg.filter((p) => window.some((q) => distM(p, q) <= followR)).length;
    if (covered / seg.length >= minCover)
      efforts.push({ startIdx: s, endIdx: e, elapsedS: route[e].t - route[s].t });
    from = e + 1; // keep looking: laps produce repeat efforts
  }
  return efforts;
}`,
        },
      ],
      keyPoints: [
        'Two phases: a cheap bounding-box query for candidates, then an exact geometric check per candidate.',
        'Start pass, finish pass and ≥ 80% coverage reject both GPS noise and shortcuts.',
        'Efforts are the source of truth; leaderboards are derived and can be rebuilt.',
      ],
      source: 'Strava — US Patent 9,116,922 (Defining and matching segments); Strava Support — segment matching issues',
    },
    {
      heading: 'Strava (3/3): leaderboards, the activity feed, privacy & trade-offs',
      body: `**Intuition:** a leaderboard is **one best time per athlete per segment, sorted**. Every other view (women 35–44, this year, my friends) is a filter over that same set of personal bests.

**Personal bests:** \`best_efforts(segment_id, athlete_id) → (elapsed_s, effort_id)\`, updated with an upsert that only replaces a slower time. Both the SQL row and the Redis sorted set use "only if better" semantics, so out-of-order or replayed efforts can never make someone slower.

**Leaderboard storage:**
- **Overall:** one Redis sorted set per segment, member = athlete, score = elapsed seconds, written with \`ZADD … LT\` (only lowers a score). Top 10 = \`ZRANGE 0 9\`; "your rank" = \`ZRANK\`, O(log n). A 2M-athlete segment is roughly 100–200 MB in one key, so keep only segments above a size threshold in Redis and serve the long tail from Postgres with an index on \`(segment_id, elapsed_s)\`.
- **Filtered boards** (age group, weight class, gender, this year): a sorted set per (segment, filter) for popular segments, maintained by the same consumer; yearly boards are new keys each January.
- **Friends:** computed at read time: fetch the friends' personal bests (\`segment_id = ? AND athlete_id IN (…)\`, at most a few hundred rows) and sort. Precomputing per-user friend boards would multiply writes by the follower count.
- **Integrity:** flag implausible efforts (a cycling speed of 100 km/h, a "run" at 30 km/h means a car), let athletes flag, and keep e-bikes and virtual rides off the main boards.

**Feed:** fan-out on write to followers' timelines for normal athletes (median followers in the tens), fan-out on read for pros with 1M followers: the news-feed hybrid. Activities are immutable after processing, so feed items cache well. Kudos and comments are counters and lists keyed by activity id.

**Privacy must never fail open:**
- **Privacy zones:** hide the first and last ~200 m–1 km of any activity that starts or ends near a saved address. Apply it in the **processing pipeline** when producing the public stream and map polyline; never rely on the client to crop.
- **Visibility** (everyone / followers / only me) is enforced at fan-out **and** re-checked at read, because the setting can change after fan-out.
- Exclude hidden portions from segment matching on public boards, or a segment starting outside someone's house would reveal it through the leaderboard. Aggregated data (heatmaps) needs the same care: the 2018 heatmap revealed military base layouts from aggregated runs.

**Trade-offs:** synchronous matching would make the upload slow, so it runs async and the athlete sees "processing" for seconds; Redis boards are fast but need a rebuild path from \`best_efforts\`; storing every raw stream forever is expensive, so keep the original file in cold storage and derived columns hot.`,
      code: [
        {
          language: 'sql',
          title: 'Personal best upsert that can only get faster (Postgres), mirrored to Redis with ZADD LT',
          code: `CREATE TABLE best_efforts (
  segment_id  bigint      NOT NULL,
  athlete_id  bigint      NOT NULL,
  elapsed_s   int         NOT NULL,
  effort_id   bigint      NOT NULL,
  achieved_at timestamptz NOT NULL,
  PRIMARY KEY (segment_id, athlete_id)
);
CREATE INDEX best_by_time ON best_efforts (segment_id, elapsed_s);  -- long-tail leaderboards

-- Replays and out-of-order efforts are harmless: a slower time never overwrites
INSERT INTO best_efforts (segment_id, athlete_id, elapsed_s, effort_id, achieved_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (segment_id, athlete_id) DO UPDATE
   SET elapsed_s = EXCLUDED.elapsed_s, effort_id = EXCLUDED.effort_id,
       achieved_at = EXCLUDED.achieved_at
 WHERE EXCLUDED.elapsed_s < best_efforts.elapsed_s
RETURNING effort_id;   -- a row back = new PR: update Redis and notify

-- Redis (hot segments): ZADD lb:seg:{segmentId} LT <elapsed_s> <athleteId>
-- LT only lowers an existing score; new athletes are still added.
-- Rank for the athlete: ZRANK lb:seg:{segmentId} <athleteId>  (0-based)`,
        },
      ],
      keyPoints: [
        'One personal best per athlete per segment; every board is a filter over that set.',
        'Friends boards are computed at read from a few hundred PB rows; global boards are precomputed.',
        'Privacy zones are applied server-side in the pipeline and also to segment matching and heatmaps.',
      ],
      source: 'Hello Interview — Strava (leaderboards, real-time sharing); Redis docs — ZADD GT/LT',
    },
    {
      heading: 'Level bar: what mid, senior and staff answers include',
      body: `**Intuition:** these are product designs, so the level gap shows in whether you protect the user-visible promise: no oversell, no stale alert, exactly one match, no duplicate story, a correct leaderboard. Mid (≈80% breadth / 20% depth) gets a working flow while the interviewer steers. Senior (≈60/40) moves fast to the hard part and names trade-offs. Staff (≈40/60) drives, and adds abuse, cost, reconciliation and rollout without being asked.

**Flash sale**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | buy limited stock | per-user limit, payment window, FCFS vs lottery | fairness policy, bot strategy, business tolerance for "sorry" |
| High-level design | API → DB decrement | CDN token gate → bucketed Redis Lua gate → async orders | pre-generated unit rows as the hard ceiling |
| Deep dives expected | race on stock | reservation in the same Lua script as the decrement | oversell under Redis failover; tail-bucket consolidation |
| Trade-offs & failure handling | none | buckets vs stranded tail | lapsed-payment stock to a waitlist |
| Ops/cost/evolution | none | 83K decisions/s per 50 SKUs | load test at 2–3×, kill switch, bot checks at registration |

*Down-levelled by:* SELECT then UPDATE stock; one Redis key for 83K/s.

**Price tracker & alerts**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | watch a price, alert on drop | freshness per product tier, alert types | provider limits, trust (never send stale deals) |
| High-level design | cron scrapes, checks every alert | crawl → change events → matcher indexed by product | outbox-driven notify topic keyed by user |
| Deep dives expected | polling | thresholds precomputed, range-scan matching | hot product with 500K alerts; hysteresis |
| Trade-offs & failure handling | none | ARMED → FIRED flip dedups | re-check price before a backlogged send |
| Ops/cost/evolution | none | crawl cost per product tier | provider quotas set drain rate; digests |

*Down-levelled by:* scanning every alert per price change; float money comparisons.

**Tinder**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | swipe, match, chat out of scope | 2B swipes/day, never re-show, geo | safety, fake profiles, match quality goal |
| High-level design | swipes table | swipe log + Redis recent likes + geosharded index | equal-load S2 shards, mutual-preference filters |
| Deep dives expected | detect match | co-locate the pair; HSETNX exactly-once | Bloom "seen" filter erring towards hiding |
| Trade-offs & failure handling | none | two partitions race into 0 or 2 matches | Redis loss → durable log fallback |
| Ops/cost/evolution | none | ~200 GB/day of swipes | shard rebalancing as cities grow |

*Down-levelled by:* checking for a match with two independent reads; re-showing swiped profiles.

**News aggregator**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | ingest feeds, show news | freshness, editions, personalisation | publisher terms (snippets only), trust/safety |
| High-level design | poll RSS → DB → feed | adaptive polling + WebSub, dedup → cluster → rank | precomputed edition lists + per-user re-rank |
| Deep dives expected | exact dedup | MinHash LSH near-dup, story clustering | stable story ids under re-clustering |
| Trade-offs & failure handling | none | online vs batch clustering | versioned lists so scroll never repeats |
| Ops/cost/evolution | none | reads 11.6K–60K QPS dominate | cost of per-user ranking vs cached candidates |

*Down-levelled by:* one dedup stage for all three problems; ranking at read time per request.

**Strava**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | upload activity, feed | offline recording, segments, leaderboards | privacy zones as a hard requirement |
| High-level design | upload to API | presigned upload → S3 event → Kafka pipeline | columnar streams, efforts as truth |
| Deep dives expected | storing GPS | bbox candidates → exact geometric match | rebuildable boards; friends boards at read time |
| Trade-offs & failure handling | none | GPS noise vs shortcut rejection | reprocessing when the matcher changes |
| Ops/cost/evolution | none | ~600 uploads/s peak | heatmap privacy, backfill cost |

*Down-levelled by:* matching every segment against every trace; privacy applied only in the UI.`,
      keyPoints: [
        'The level gap is protecting the product promise under load, not drawing more boxes.',
        'Staff names abuse (bots, fakes), trust (stale deals, privacy) and reconciliation unprompted.',
      ],
      source: 'Hello Interview — problem breakdowns, "What is expected at each level"',
    },
    {
      heading: 'Deep-dive ladders: bad → good → great',
      body: `**Intuition:** every rung answers "what breaks at T+0, under retry, or when a node fails?"

**Flash sale — never oversell 10K units at 83K req/s**
- **Bad:** SELECT stock, then UPDATE. Read-then-write races oversell, and a row lock caps throughput at a few K/s.
- **Good:** a single Redis Lua DECR plus an async order write. It is fast, but one key is a hot shard, and a failover to a replica that lags can re-create decremented stock.
- **Great:** the CDN rejects requests without a token, an in-process flag rejects once sold out, and only then do bucketed Redis keys decide, with the reservation recorded inside the same Lua script. Pre-generated unit rows in the DB are the hard ceiling: a failover becomes an apology, never an oversell. Buckets consolidate into a tail bucket near the end.

**Flash sale — fairness and bots**
- **Bad:** CAPTCHA at T-0, which punishes humans. **Good:** a waiting room with signed tokens. **Great:** expensive checks at registration, per-account limits enforced in the gate, and lapsed-payment stock (10–30%) released to a waitlist in order.

**Price tracker — a hot product with 500K alerts**
- **Bad:** for each price change, scan every alert.
- **Good:** convert % and "any drop" rules into absolute thresholds at creation and index them by (product, threshold), so a change becomes a range scan.
- **Great:** the ARMED → FIRED flip and an outbox row happen in one transaction (dedup and delivery). The notify topic is keyed by user for throttling and digests. Hysteresis re-arms at 5% above target, and the price is re-checked before any send that waited in a backlog. Provider limits set the drain time, so say it: 500K ÷ 2K/s ≈ 4 minutes.

**Tinder — exactly one match when both swipe right at the same instant**
- **Bad:** each like checks "did they like me?" by reading another partition. Two concurrent likes produce zero or two matches.
- **Good:** co-locate the pair under a canonical key (min_id, max_id), so both likes hit one partition.
- **Great:** HSETNX on a "matched" field makes the announcement exactly-once under retries. The match row is written for both users, Redis pair state expires, and the durable likes log is checked only on a Redis miss.

**News aggregator — 50 outlets publish the same story**
- **Bad:** URL dedup only, so the front page shows 50 copies. **Good:** MinHash LSH (20 × 5 bands ≈ 0.55 threshold) drops near-duplicates. **Great:** a separate clustering stage gated by shared entities assigns articles online to stories with stable ids. Batch re-clustering repairs quality, and ranking uses breadth, velocity, authority and freshness decay over precomputed edition lists.

**Strava — matching 600 uploads/s against millions of segments**
- **Bad:** test every segment against every trace.
- **Good:** a bounding-box index query for candidates, then an exact check per candidate.
- **Great:** the exact check requires a start pass, a finish pass and ≥ 80% coverage to reject GPS noise and shortcuts. Efforts are the source of truth, so leaderboards are rebuildable. Privacy zones are applied in the pipeline before matching and heatmaps, and a matcher change triggers a metered backfill.`,
      keyPoints: [
        'Finite unit rows turn a Redis failover into an apology, not an oversell.',
        'Precompute thresholds; flip state + outbox atomically; re-check before send.',
        'Co-locate the like pair; HSETNX for exactly-once match.',
        'Dedup, near-dup and clustering are three separate stages.',
      ],
      source: 'Hello Interview — problem breakdowns (Bad / Good / Great deep dives)',
    },
  ],
  codeChallenges: [
    {
      id: 'design-consumer-cc-1',
      title: 'Fix the flash-sale buy endpoint that oversold, double-ordered and took the DB down',
      context:
        'This NestJS endpoint served the last 8 pm deal drop. Post-mortem: the headline phone (10,000 units) produced 11,800 orders, some users got two orders from a double tap, the Postgres pool was exhausted within 4 seconds, and the PSP\'s 3-second latency spike froze every pod. Traffic: ~80K clicks/s for one minute across 50 SKUs.',
      task:
        'Rewrite the request path so that it can never hand out more units than exist, gives each user at most one unit per SKU even under retries and double taps, answers within ~50 ms whether or not stock is left, and keeps the database and the PSP out of the click path. You may assume the order worker that claims unit rows (FOR UPDATE SKIP LOCKED) already exists and consumes a Kafka topic.',
      starter: {
        language: 'typescript',
        code: `@Controller('sales')
export class BuyController {
  constructor(private redis: Redis.Cluster, private db: Pool, private payments: PaymentsClient) {}

  @Post(':saleId/skus/:sku/buy')
  async buy(@Param('saleId') saleId: string, @Param('sku') sku: string, @Req() req: AuthedRequest) {
    const userId = req.user.id;

    const stock = Number(await this.redis.get('stock:' + sku));      // read...
    if (stock <= 0) throw new ConflictException('SOLD_OUT');
    await this.redis.decr('stock:' + sku);                           // ...then write

    const prior = await this.db.query(
      'SELECT 1 FROM orders WHERE user_id = $1 AND sku = $2', [userId, sku]);
    if (prior.rowCount) throw new ConflictException('LIMIT_REACHED');

    const order = await this.db.query(
      'INSERT INTO orders (user_id, sku, sale_id, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, sku, saleId, 'PENDING_PAYMENT']);

    const intent = await this.payments.createIntent(order.rows[0].id); // PSP call per click
    return { orderId: order.rows[0].id, paymentUrl: intent.url };
  }
}`,
      },
      hints: [
        'Between the GET and the DECR, how many other pods can read the same "1 unit left"? What does nothing ever check after the DECR?',
        'The per-user check runs after the unit was taken and is itself a read-then-write; where should "one per user" live, and what happens to the unit when it fails?',
        'Which work truly has to happen before you answer the user, and which can a consumer do at 2K/s afterwards?',
      ],
      solution: {
        language: 'typescript',
        code: `const BUCKETS = 20;

@Controller('sales')
export class BuyController {
  private soldOut = new Set<string>(); // fed by a pub/sub 'sold-out' listener

  constructor(private redis: Redis.Cluster, private kafka: Producer, // idempotent producer, acks=all
              private tokens: AdmissionTokens, private gateSha: string, private undoSha: string) {}

  @Post(':saleId/skus/:sku/reserve')
  @HttpCode(202)
  async reserve(@Param('saleId') saleId: string, @Param('sku') sku: string,
                @Headers('idempotency-key') idemKey: string, @Req() req: AuthedRequest) {
    const userId = req.user.id;
    if (!idemKey) throw new BadRequestException('Idempotency-Key required');
    this.tokens.verify(req.headers['x-admission'], { userId, saleId, sku }); // signed, short TTL
    if (this.soldOut.has(saleId + ':' + sku)) throw new ConflictException('SOLD_OUT');

    // one attempt per user per SKU; a double tap reuses the same key and gets the same answer
    const claimKey = 'claim:{' + saleId + ':' + sku + '}:' + userId;
    const claimed = await this.redis.set(claimKey, idemKey, 'EX', 900, 'NX');
    if (!claimed && (await this.redis.get(claimKey)) !== idemKey)
      throw new ConflictException('LIMIT_REACHED');

    const home = fnv(userId) % BUCKETS;
    for (const b of [home, rnd(BUCKETS), rnd(BUCKETS), 'tail']) {
      const tag = '{' + saleId + ':' + sku + ':b' + b + '}';     // one slot per bucket
      const r = Number(await this.redis.evalsha(this.gateSha, 2, 'stock:' + tag, 'resv:' + tag,
                                                 idemKey, userId, Date.now()));
      if (r === -1) continue;                                     // bucket empty: probe next
      try {
        // durable hand-off before we say yes; the worker claims a unit row and starts payment
        await this.kafka.send({ topic: 'reserve.requests',
          messages: [{ key: sku, value: JSON.stringify({ saleId, sku, userId, reservationId: idemKey, bucket: b }) }] });
      } catch (e) {
        // undo atomically: HDEL the reservation and INCR the bucket only if HDEL removed it
        await this.redis.evalsha(this.undoSha, 2, 'stock:' + tag, 'resv:' + tag, idemKey);
        await this.redis.del(claimKey);
        throw new ServiceUnavailableException('retry with the same Idempotency-Key');
      }
      return { reservationId: idemKey, status: 'PENDING' };      // client polls / SSE for RESERVED
    }
    await this.redis.del(claimKey);                               // nothing taken; may retry later
    throw new ConflictException('SOLD_OUT');
  }
}

const rnd = (n: number) => Math.floor(Math.random() * n);
const fnv = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };`,
      },
      explanation: `**What was wrong and how each fix addresses it:**

1. **GET then DECR race → oversell.** 40 pods read "1 left" simultaneously and all decrement; nobody checks the DECR result. Fixed with the atomic Lua gate (check + record reservation + decrement in one script), and the real guarantee moves to the order worker that claims **finite unit rows**, so even a Redis failover cannot oversell.
2. **Per-user limit after taking the unit, and racy.** Two taps both pass the SELECT; a rejected user has already burnt a unit. Fixed with \`SET NX\` on a claim key **before** touching stock, keyed by the client's \`Idempotency-Key\`, so a double tap returns the same answer instead of a second unit. The database's partial unique index \`(sale, sku, user)\` is the backstop.
3. **Synchronous DB insert per click.** 80K/s inserts and SELECTs exhausted the pool, although only 10K could succeed. Now only winners produce a Kafka message, and workers write ~2K rows/s.
4. **PSP call in the hot path with no timeout.** One slow dependency froze every pod. Payment intent creation moves to the worker after the unit row is claimed.
5. **One hot key on one shard.** Stock is split into 20 buckets on different slots plus a tail bucket for stranded units.
6. **No admission or sold-out short-circuit.** Signed admission tokens stop scripted direct calls; an in-process sold-out flag answers most late clicks without any network hop.
7. **Lost hand-off.** If Kafka is unavailable, the reservation is undone atomically and the client retries with the same key; nothing is taken anonymously.`,
      followUps: [
        {
          q: 'The Kafka send succeeds but the pod crashes before replying, so the client times out and retries with the same Idempotency-Key. Walk through what happens.',
          a: 'The claim key already holds that idempotency key, so the retry passes the limit check. Its home bucket\'s Lua script finds the reservation id in the \`resv\` hash and returns -2, which the code treats as success without decrementing again. The service publishes again; the worker\'s UNIQUE \`reservation_id\` on the unit row turns the duplicate into a no-op read of the existing reservation. The user gets one unit and the same reservation id. (If the retry probes a random bucket first, the tail/home lookup should use the bucket stored in the claim value; store \`idemKey|bucket\` in the claim to make that deterministic.)',
        },
        {
          q: 'How would you load-test this before the real sale, and what would you assert?',
          a: 'Replay a synthetic 8 pm curve (ramp to 150K/s in 5 s, 80K/s for a minute) against a production-sized staging cluster with real Redis Cluster topology and Kafka. Include double taps (same key twice within 50 ms), retries after induced timeouts, a Redis primary failover at t+10 s, and Kafka broker loss. Assert: reserved unit rows ≤ stock for every SKU, at most one non-FREE row per (sale, sku, user), p99 answer < 100 ms, zero stuck reservations after the sweeper runs, and Σ bucket stock + reserved = initial stock in reconciliation.',
        },
      ],
    },
    {
      id: 'design-consumer-cc-2',
      title: 'Turn a spammy price-alert consumer into a correct, scalable matcher',
      context:
        'A price tracker consumes ~2.3K price observations per second (crawler + browser extension) from Kafka. There are 60M active alerts. Users report the same "price drop!" email every 15 minutes, a ₹99 TV alert caused by a parsing glitch, and after a deploy everyone who had already been emailed got the email again. The DB CPU is pinned at 100%.',
      task:
        'Rewrite the consumer so that a price change touches only the relevant alerts, each real drop notifies each alert at most once even across crashes and redeliveries, oscillation around the target does not spam, suspicious drops are confirmed before anyone is told, and sending email is no longer inside the consumer.',
      starter: {
        language: 'typescript',
        code: `// Kafka consumer for topic 'price-observations' (~2.3K msgs/s)
export async function handleObservation(obs: { productId: string; price: number }) {
  const { rows: alerts } = await pg.query('SELECT * FROM price_alerts WHERE active = true');

  for (const a of alerts) {
    if (a.product_id === obs.productId && obs.price <= a.target_price) {
      await mailer.send(a.email, 'Price drop!',
        a.product_name + ' is now Rs ' + obs.price);    // synchronous, one by one
    }
  }

  await pg.query('UPDATE products SET price = $1 WHERE id = $2', [obs.price, obs.productId]);
}`,
      },
      hints: [
        'How many rows does the first query read per message, and how many of them can possibly matter?',
        'What distinguishes an observation from a change? And what record would let a redelivered message know "these alerts were already handled"?',
        'If a price bounces 1 rupee around the target every crawl, when should an alert become eligible to fire again?',
      ],
      solution: {
        language: 'typescript',
        code: `const BATCH = 5000;

export async function handleObservation(obs: { productId: string; pricePaise: number;
                                               observedAt: Date; source: 'crawler' | 'extension' }) {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    // 1. Change detection: act only if the accepted price changed; get the old price + an event id
    const chg = await client.query(
      'UPDATE products p SET price_paise = $2, price_seen_at = $3 ' +
      '  FROM (SELECT id, price_paise, median_30d_paise FROM products WHERE id = $1 FOR UPDATE) old ' +
      ' WHERE p.id = old.id AND p.price_paise IS DISTINCT FROM $2 AND p.price_seen_at < $3 ' +
      'RETURNING old.price_paise AS old_price, old.median_30d_paise AS median, ' +
      "          nextval('price_event_seq') AS event_id",
      [obs.productId, obs.pricePaise, obs.observedAt]);
    if (chg.rowCount === 0) { await client.query('COMMIT'); return; }   // same price or stale
    const { median, event_id: eventId } = chg.rows[0];

    // 2. Suspicious drop (> 60% below the 30-day median) or unverified extension report:
    //    do not notify yet; schedule a confirming fetch from an independent crawler
    if (obs.source === 'extension' || obs.pricePaise * 10 < median * 4) {
      await client.query('INSERT INTO recheck_queue (product_id, event_id) VALUES ($1, $2)',
                         [obs.productId, eventId]);
      await client.query('COMMIT'); return;
    }

    // 3. Fire due alerts in batches: state flip + outbox row commit together (dedup + delivery)
    for (;;) {
      const r = await client.query(
        "WITH due AS (SELECT alert_id FROM price_alerts WHERE product_id = $1 AND state = 'ARMED' " +
        '              AND target_paise >= $2 ORDER BY alert_id LIMIT ' + BATCH + ' FOR UPDATE SKIP LOCKED), ' +
        "fired AS (UPDATE price_alerts a SET state = 'FIRED', fired_event_id = $3, fired_at = now() " +
        '          FROM due WHERE a.alert_id = due.alert_id RETURNING a.alert_id, a.user_id) ' +
        'INSERT INTO notify_outbox (idem_key, user_id, alert_id, product_id, price_paise) ' +
        "SELECT fired.alert_id || ':' || $3, fired.user_id, fired.alert_id, $1, $2 FROM fired " +
        'ON CONFLICT (idem_key) DO NOTHING',
        [obs.productId, obs.pricePaise, eventId]);
      if ((r.rowCount ?? 0) < BATCH) break;
    }

    // 4. Hysteresis: re-arm only once the price is 5% above the target
    await client.query(
      "UPDATE price_alerts SET state = 'ARMED' WHERE product_id = $1 AND state = 'FIRED' " +
      '   AND target_paise * 105 < $2 * 100', [obs.productId, obs.pricePaise]);
    await client.query('COMMIT');
    // email/push: a CDC relay publishes notify_outbox to Kafka (key = user_id) -> gate -> senders
  } catch (e) {
    await client.query('ROLLBACK'); throw e;   // Kafka redelivers; every step above is idempotent
  } finally {
    client.release();
  }
}
// index: CREATE INDEX ON price_alerts (product_id, state, target_paise);`,
      },
      explanation: `**Fixes, one per bug:**

1. **Full scan of 60M alerts per message** (×2.3K/s) → one index range scan on \`(product_id, state, target_paise)\` per real change.
2. **Fires on every observation, not on a change** → the conditional UPDATE returns a row only when the accepted price changed (and the observation is newer), so identical re-crawls cost one cheap UPDATE and no matching.
3. **No memory of having fired** → \`ARMED → FIRED\` flip plus an outbox row in the same transaction. A crash before COMMIT rolls back both, and Kafka redelivery redoes the work; a redelivery after COMMIT finds nothing ARMED, and the outbox key \`alertId:eventId\` swallows any replay.
4. **Oscillation spam** → re-arm only when the price rises 5% above target (integer arithmetic on paise).
5. **Glitch prices and untrusted extension data** → drops of more than 60% versus the 30-day median, and all extension reports, go to a recheck queue and become events only when an independent fetch confirms them.
6. **Email inside the consumer, one by one** → removed. A slow SMTP call no longer blocks the partition, and delivery, throttling and digests are handled downstream from the outbox.
7. **Float rupees** → integer paise; **product updated after notifying** → change detection is the first statement of the same transaction.
8. **Hot products** → batches of 5,000 with SKIP LOCKED, so a 400K-alert product never runs as one giant statement.`,
      followUps: [
        {
          q: 'A product with 400K alerts drops. This transaction now holds row locks on the product and many alert batches for a long time. What would you change?',
          a: 'Split it: commit the change detection with the price event first, then publish a \`price_event\` to Kafka. Matcher workers then fire alerts in independent 5K-row transactions, each flipping state and writing outbox rows atomically, and several workers drain one product in parallel through SKIP LOCKED. Each batch is idempotent because only ARMED rows are selected. The product row lock is held for milliseconds, and a crash mid-drain only leaves some batches to be redone on redelivery. Re-arm runs as its own statement on the next price event.',
        },
        {
          q: 'How do you test that a redelivered message never produces a second email?',
          a: 'Write an integration test with real Postgres: seed alerts, process an observation, then process the identical message again and a third time with a simulated crash (throw after the fire loop, before COMMIT) followed by a successful retry. Assert the outbox has exactly one row per (alert, event), alert states are FIRED once, and the gate returns DUP for any replayed outbox message. Add a property test that interleaves random price sequences around targets and checks at most one notification per armed period per alert.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-consumer-iq-01',
      difficulty: 'hard',
      question:
        'Design the deal engine for an 8 pm Big-Billion-Days-style drop: 50 headline SKUs, 200K units in total, about 5M buy clicks in the first minute. Users must get an answer within a second, nobody may receive a unit that does not exist, and the order database must not melt.',
      context: 'Flipkart/Amazon-style e-commerce loop. Assume a normal checkout and payment system already exist; you own everything from the deal page to a reserved unit.',
      whatInterviewerLooksFor: [
        'Quantifies decisions per second per SKU and compares with a single row\'s ceiling',
        'Layers rejection: CDN, admission, in-memory gate, durable claim',
        'Separates the fast gate from the source of truth so failover cannot oversell',
        'Handles payment-window expiry and returned stock',
        'Mentions idempotency for double taps and retries',
      ],
      modelAnswer: `**Numbers first.** 5M clicks in 60 s ≈ 83K/s, 150K/s+ in the first seconds, against 50 SKUs. Only 200K succeed, so ≥ 96% of answers are "sold out". A Postgres row does ~0.5–1K locked updates/s, so the DB cannot be in every click's path; winners are ~1.7K/s, which it can absorb.

**Layer 1 — CDN:** the deal page is static; SKU state (\`AVAILABLE/LOW/SOLD_OUT\`) is a 1-second cached endpoint. 10M page views never touch origin.

**Layer 2 — admission:** the buy call needs a short-lived signed token (from a waiting room or pre-registration). The WAF drops tokenless calls, which kills most scripts.

**Layer 3 — gate:** per-user claim via \`SET NX\` keyed by the Idempotency-Key, then a Lua script on a stock **bucket** (each SKU split into ~20 buckets on different Redis shards) that checks, records the reservation id and decrements atomically. Users hash to a home bucket, probe two random ones, then a tail bucket for stragglers. When everything is empty, a pub/sub sold-out flag lets pods reject in-process.

**Layer 4 — durable claim:** the API returns \`202 {reservationId}\` after publishing to Kafka. Order workers claim a **pre-generated unit row** with \`FOR UPDATE SKIP LOCKED\`; a partial unique index enforces one unit per user. Rows are finite, so oversell is impossible even if Redis is wrong.

**Lifecycle:** reservation with a 10-minute pay-by; the sweeper returns lapsed units (often 10–30%) to a waitlist of users who got sold out, in order. Reconciliation every few seconds: Redis stock + reserved vs FREE rows, DB wins.

**Trade-offs:** async answer (users poll or get SSE for ~1–2 s) in exchange for a DB that sees 1.7K/s instead of 83K/s; buckets multiply throughput but strand the tail, hence the tail bucket.`,
      followUps: [
        {
          q: 'Why not just put all 50 SKUs in one Redis key per SKU and skip buckets?',
          a: 'For most SKUs that is fine: 1–2K/s per SKU is far below a shard\'s ~50–100K ops/s. Buckets matter for the 3–4 headline SKUs that take 40% of clicks (~35K/s each, 60K+/s in the first seconds), close to one core\'s Lua ceiling and a single blast radius. Use buckets only for SKUs whose expected rate exceeds ~20% of a shard\'s capacity; that keeps the design simple for the long tail.',
        },
        {
          q: 'The product manager wants a synchronous "You got it!" instead of polling. Can you give it?',
          a: 'Mostly. The Lua gate\'s yes is a strong signal: the unit row claim fails only after a Redis data loss. You can answer "Reserved, complete payment in 10 minutes" right after the gate plus Kafka ack, and in the rare failover case send an apology with a coupon. Alternatively, wait for the worker\'s result for up to ~1 s via a reply channel keyed by reservation id, falling back to "processing" on timeout. Both keep the DB out of the synchronous path.',
        },
        {
          q: 'How do you pre-warm for 8:00:00?',
          a: 'Generate unit rows and Redis buckets an hour before, preload SKU data into pod memory, scale pods and Redis to target capacity in advance (autoscaling reacts in minutes; the spike lasts seconds), warm connection pools and JIT, pre-fill CDN caches for the deal page, and run a dress rehearsal with synthetic load the day before. Also freeze deploys during the window.',
        },
      ],
      pitfalls: [
        'Putting a synchronous DB transaction or PSP call in every click',
        'Treating the Redis counter as the ledger with no durable authority behind it',
        'Ignoring returned stock from lapsed payments',
        'Forgetting idempotency, so a double tap buys two units',
      ],
    },
    {
      id: 'design-consumer-iq-02',
      difficulty: 'expert',
      question:
        'After your last sale, resellers posted screenshots of 40 phones each, and real customers saw "sold out" 300 ms after 8:00:00. Leadership asks you to make the next drop fair. What do you change, and what does each change cost?',
      whatInterviewerLooksFor: [
        'Recognises that FCFS at a single instant rewards latency and automation',
        'Moves identity checks and challenges earlier, away from the buy click',
        'Limits per real identity, not per account',
        'Weighs lottery/randomisation against user expectations',
        'Adds after-the-fact detection, not only prevention',
      ],
      modelAnswer: `**Diagnosis:** 300 ms sell-out means the contest was decided by network latency and scripts. 40 phones per reseller means the per-account limit was trivially bypassed with 40 accounts.

**1. Pre-registration window (days before).** Users register for the deal with a verified phone (OTP), an address and optionally a saved payment instrument. Run CAPTCHA/proof-of-work and device checks **here**, where seconds of friction are acceptable. Cost: an extra step reduces casual participation; good for fairness, bad for impulse buys.

**2. Randomise instead of racing.** Either a **lottery** (issue purchase tokens to ~1.3× units among registrants, since some will not pay) or **randomised queue positions** for everyone arriving in the first 30 s. Arriving at 7:59:59.999 no longer helps, so the incentive to hammer disappears. Cost: some users feel lotteries are less transparent; publish the rules and the draw.

**3. Limits per real identity.** One unit per normalised phone, device fingerprint, delivery address (normalise "Flat 4B, 2nd floor" variants), and payment instrument hash (card fingerprint, UPI VPA). Enforce at token issue and again with a DB unique index at claim. Cost: households sharing an address are limited; allow appeals.

**4. Behavioural signals at T-0** (cheap and invisible): no prior page view, click within 50 ms of page load, identical device fingerprints across accounts, datacentre ASNs. Score, and silently route high-risk sessions to the back of the queue rather than blocking (blocking teaches bots what you detect).

**5. Post-sale audit before dispatch.** Cluster orders by address, device, payment and IP; cancel clusters over the limit and release units to the waitlist. This is the layer bots cannot probe in real time.

**Measure:** unique households per unit, share of orders from flagged clusters, complaint volume, and the time to sell out (a fair sale should take longer than 300 ms).`,
      followUps: [
        {
          q: 'Resellers respond by buying 40 real SIM cards and using 40 relatives\' addresses. What now?',
          a: 'You cannot stop determined humans, only raise their cost. Tie eligibility to account age and purchase history (accounts with prior genuine orders get priority), require the registered payment instrument to be in the account holder\'s name, and limit per payment instrument plus per device. Make resale less attractive: name-on-invoice, delayed delivery to new addresses, and no cash-on-delivery for deal units. Accept a small residual rate and measure it.',
        },
        {
          q: 'Doesn\'t a lottery break the "answer within a second" requirement?',
          a: 'It changes when the answer arrives, not how fast the request returns. Run the draw at 8:00 among registrants and notify winners with a token valid for 30 minutes; winners then buy through the same gate with almost no contention, because tokens ≈ units. The click-time load falls from millions of requests per second to a few thousand, which also makes the infrastructure cheaper and safer.',
        },
      ],
      pitfalls: [
        'Adding a CAPTCHA to the buy click at T-0, which mostly punishes humans',
        'Limiting per account only',
        'Hard-blocking detected bots in real time, which teaches them the rules',
      ],
    },
    {
      id: 'design-consumer-iq-03',
      difficulty: 'expert',
      question:
        'Ten seconds into the sale, the Redis primary holding three of your stock buckets fails over. Afterwards finance finds 1,140 more "accepted" reservations than units. Walk me through exactly how that happened and how the design should have absorbed it.',
      whatInterviewerLooksFor: [
        'Explains asynchronous replication and the lost-acknowledged-writes window',
        'Knows that WAIT narrows but does not remove the window',
        'Puts the oversell guarantee in a durable, finite authority',
        'Designs the user-facing apology path and reconciliation',
      ],
      modelAnswer: `**What happened.** Redis replicates asynchronously. The primary acknowledged decrements (and reservation records) that had not reached the replica when it died. The promoted replica had higher stock counters for those three buckets, so the gate handed out those units a second time. With ~35K/s on a headline SKU spread across 20 buckets, three buckets see ~5K/s; a replication lag of a few hundred milliseconds plus failover detection loses on the order of 1K decrements. That matches 1,140.

**Why it became an oversell:** the design treated "Redis said yes" as the sale. If order workers simply inserted an order per accepted message, every duplicate yes became a real order.

**How the design should absorb it:**
1. **Finite authority.** Workers claim a concrete \`FREE\` row from \`sale_units\` (one row per unit, \`FOR UPDATE SKIP LOCKED\`). The 1,140 extra yeses find no free rows and fail. That is an *apology*, not an oversell.
2. **Apology path:** those users get "sorry, sold out" within seconds plus a goodwill coupon; they also go to the head of the waitlist for returned units.
3. **Narrow the window:** \`WAIT 1 20\` after each gate script makes the primary wait for one replica ack (~1 ms extra). Failover can still lose writes, but far fewer.
4. **Fast reconciliation:** after any failover event, freeze the affected buckets for ~1 s, recompute their stock as \`allocated − reserved rows in DB − in-flight Kafka messages\`, and reload.
5. **Alternatives:** Redis with AOF \`appendfsync always\` on a primary is still not replicated synchronously; a Raft-based store (e.g. etcd-like, or a Kafka partition per SKU as the serialisation point) avoids the loss at lower throughput.

**Interview line:** "Redis is the bouncer, the unit rows are the tickets. A bouncer's mistake costs an apology, never a seat that does not exist."`,
      followUps: [
        {
          q: 'Could the failover also cause undersell, units that are never sold?',
          a: 'Yes. Reservation records written to the old primary may be lost while their Kafka messages were sent; or a decrement replicated but the reservation hash write did not (they are in one script, so they replicate together in practice, but the Kafka publish can fail after the gate). Units then sit decremented with nobody claiming them. The reconciliation job catches it: FREE rows in the DB with no live reservation after N seconds are added back to the tail bucket.',
        },
        {
          q: 'Why not make the database the gate with sharded counter rows instead of Redis?',
          a: 'You can: split stock into 50 counter rows and decrement a random one with a conditional UPDATE. 50 rows × ~1K updates/s = 50K/s, enough for one headline SKU. But each click becomes a DB transaction and connection; 83K/s across SKUs means thousands of concurrent connections and WAL writes for mostly-failing requests. A memory gate in front filters losers for ~1 ms each, which is why most designs keep the DB for winners only.',
        },
      ],
      pitfalls: [
        'Claiming Redis Lua atomicity also gives durability across failover',
        'Saying WAIT makes Redis strongly consistent',
        'No plan for the users who were told yes and then cannot be served',
      ],
    },
    {
      id: 'design-consumer-iq-04',
      difficulty: 'hard',
      question:
        'Design a price-drop tracker like CamelCamelCamel: users set target prices on Amazon products and get notified when the price falls below their target. Focus on the alerting side: rule matching, fan-out and not spamming users.',
      context:
        'Reported in Meta system design interviews (community-reported question: "Design a Price Drop Tracker like CamelCamelCamel"). Assume a crawler already produces price observations.',
      whatInterviewerLooksFor: [
        'Draws the crawler/alerting boundary and focuses on changes, not observations',
        'Indexes alerts so a change is a range scan per product',
        'Normalises rule types at creation time',
        'Dedup, hysteresis and throttling for notifications',
        'Handles the hot product with hundreds of thousands of alerts',
      ],
      modelAnswer: `**Scale:** 60M alerts on ~25M products; ~2.3K observations/s of which ~15% are real changes (~350/s); a hot product can carry 400K alerts; SLA ~1 hour, ideally minutes.

**Pipeline:** observations (Kafka, key = product_id) → **change detector** (accepted price changed? suspicious drop? → emits \`price_event\` with sequence id) → **matcher** → outbox → **notify gate** → channel senders.

**Rules:** convert everything into either \`(product_id, target_paise)\` or \`(product_id, flag)\` at creation. A % drop becomes an absolute target; "any drop" is current − 1 and moves down after firing; "lowest in 90 days" subscribes to the \`NEW_90D_LOW\` flag emitted by the detector from 90 daily minimums.

**Matching:** index \`(product_id, state, target_paise)\`. One statement selects \`ARMED\` alerts with \`target ≥ new price\` in batches of 5K (\`SKIP LOCKED\`), flips them to \`FIRED\` and inserts outbox rows keyed \`alertId:eventId\`. The state flip is the dedup; the outbox key absorbs replays. At 350 changes/s this is trivial for Postgres; above tens of thousands per second, hold sorted thresholds in memory per Kafka partition.

**Not spamming:** re-arm only after the price rises 5% above target (hysteresis); a Lua gate per user (Kafka key = user_id) returns DUP / COOLDOWN (same product within 12 h) / DIGEST (over 5 a day) / SEND; before sending anything that waited > 30 min, re-check the price and drop stale alerts.

**Hot product:** 400K alerts drain in ~80 batches in seconds; providers are the bottleneck (~2–5K/s), so push first, then email, in shuffled order.

**Trust:** browser-extension prices are untrusted until corroborated; drops > 60% below the 30-day median are re-fetched before firing.`,
      followUps: [
        {
          q: 'Product wants "notify me when it is the lowest price in a year" too. What changes?',
          a: 'Keep 365 daily minimums per product (or a segment tree / rolling window over daily mins) in the change detector, and emit a \`NEW_365D_LOW\` flag when the new price is below the minimum of the window excluding today. Subscribers are rows in \`(product_id, flag)\`. The cost is per product, not per alert, so it stays cheap. Watch out for first-year products: suppress the flag until the product has enough history.',
        },
        {
          q: 'Your Postgres alert table must grow to 2B alerts. How do you shard it?',
          a: 'Shard by product_id, so a price change is answered by one shard with one range scan, and partition the Kafka price-events topic by the same key so a matcher owns a set of products. User-centric queries ("list my alerts") then become scatter-gather, so keep a small secondary table keyed by user_id (alert ids only) or serve it from a search/KV store. Hot products stay on one shard; their batch firing is bounded and parallelised with SKIP LOCKED.',
        },
        {
          q: 'How would you show the price history chart fast for a 10-year-old product?',
          a: 'Store raw observations in a time-series store partitioned by time, plus pre-aggregated rollups: hourly min/max for 30 days, daily min/max/close forever. A 10-year chart reads ~3,650 daily points (~40 KB), cached per product with a short TTL and invalidated on new daily rollup. Never compute it from raw observations at request time.',
        },
      ],
      pitfalls: [
        'Scanning all alerts on each price update',
        'Firing on every observation below target instead of once per drop',
        'No idempotency, so consumer redeliveries resend emails',
      ],
    },
    {
      id: 'design-consumer-iq-05',
      difficulty: 'hard',
      question:
        'Users complain they got 14 "price dropped" emails for the same headphones in one day, and one got an alert for a ₹99 TV that turned out to be a parsing glitch. Diagnose and fix both.',
      whatInterviewerLooksFor: [
        'Lists several independent causes of repeat notifications, not one',
        'Introduces state, hysteresis and idempotency with clear semantics',
        'Treats data validation as part of the alerting pipeline',
        'Adds monitoring that would have caught it',
      ],
      modelAnswer: `**The 14 emails — likely causes (check each):**
1. **Firing on observations, not changes:** every crawl that sees "below target" fires. 14 crawls below target = 14 emails.
2. **Oscillation:** price toggles ₹2,999 / ₹3,001 around a ₹3,000 target; a rule that re-arms whenever price > target fires on every dip.
3. **Multiple alerts on one product** (user set target and % drop), each firing independently.
4. **Redelivery:** the consumer crashed after sending part of a batch and Kafka replayed it, with no idempotency key.

**Fixes:** act only on accepted price changes; state machine \`ARMED → FIRED\` flipped atomically with an outbox insert; re-arm only when the price is ≥ 5% above target or after 24 h; idempotency key \`alertId:priceEventId\` in both the outbox and the gate; a per-user per-product cooldown of 12–24 h that collapses multiple alerts into one message ("now ₹2,899, below 2 of your alerts").

**The ₹99 TV — validation:**
- Parse prices into integer paise with locale-aware parsing (₹1,299.00 vs 1.299,00); reject when the parser confidence is low or the currency changes.
- Plausibility: a drop of more than ~60% versus the 30-day median is held as *suspicious* and re-fetched by an independent crawler (different IP and parser version) before it becomes an event.
- Distinguish seller types (a ₹99 marketplace accessory listing vs the first-party TV price) and out-of-stock pages that show a placeholder price.
- Extension reports need corroboration.

**Monitoring:** notifications per user per day (p99 and max), share of alerts firing more than once per week, suspicious-drop rate per parser version (a spike right after a deploy points to the parser), and unsubscribe rate after alerts.`,
      followUps: [
        {
          q: 'The legitimate "lightning deal" price is genuinely 70% off for 20 minutes. Your suspicious-drop hold delays it. How do you avoid missing it?',
          a: 'Make confirmation fast, not slow: the recheck runs within 1–2 minutes from an independent fetcher, so a real 20-minute deal is confirmed with plenty of time. Use extra signals to skip the hold: the page shows a deal badge or countdown, several unrelated sources see the same price, or the product is in a known sale event. Only unconfirmable drops wait longer, and those are exactly the ones you should not send.',
        },
        {
          q: 'A parser deploy breaks prices for 2M products for 15 minutes. How do you prevent a mass mis-alert?',
          a: 'Add a circuit breaker on the change detector: if the suspicious-drop rate or the fraction of products changing in a minute exceeds a baseline by several times (and correlates with a parser version), pause event emission for that parser and route its observations to quarantine. Canary parser deploys on a small share of crawls and compare their outputs with the previous version before full rollout. Notifications should never be one bad deploy away from 2M emails.',
        },
      ],
      pitfalls: [
        'Fixing only the symptom with a daily cap while alerts still re-fire every crawl',
        'Treating parsing and validation as the crawler\'s problem, not the alerting system\'s',
        'Using float rupees in threshold comparisons',
      ],
    },
    {
      id: 'design-consumer-iq-06',
      difficulty: 'hard',
      question:
        'Design a dating app like Tinder: nearby profiles in a swipeable stack, likes and passes, and an instant notification when two people like each other.',
      context:
        'Reported in Uber interviews (community-reported question: "Design a Dating App Like Tinder"). Chat after the match is out of scope.',
      whatInterviewerLooksFor: [
        'Estimates swipe throughput and storage',
        'Gets match detection exactly-once under concurrent swipes',
        'Geo-partitioned candidate search with mutual-preference filters',
        'A concrete strategy to never re-show swiped profiles',
        'Client prefetching so swipes feel instant',
      ],
      modelAnswer: `**Numbers:** 20M DAU × 100 swipes = 2B/day ≈ 23K/s, ~70K/s at night peaks; ~30% are likes. Swipe log ≈ 200 GB/day before replication.

**Swipe path:** \`POST /swipes\` returns immediately; the client never waits. Left swipes go to Kafka → Cassandra \`swipes_by_swiper\` and the user's Bloom filter. Right swipes also run a **Lua script on the unordered pair key** \`sw:{lo:hi}\` (hash tag → one slot): record my side; if the other side is R, \`HSETNX m\` and return MATCH. Only one caller can win HSETNX, so exactly one match even if both swipe within the same millisecond or the client retries. Pair hashes expire after 7 days; for a fresh pair the service also checks \`likes_received\` in Cassandra for an older like.

**Match:** write \`matches\` rows for both users with match_id = hash(pair) (idempotent), then push \`match.created\` to both via WebSocket if online and APNs/FCM otherwise.

**Stack:** geoshards (S2 cells grouped into equal-load shards, one Elasticsearch index each). Query: within distance, age range, gender, **mutual preference**, active recently, not blocked → ~500 candidates → remove anyone in my swiped Bloom filter → rank (likelihood of mutual like; boost people who already liked me; cap exposure of very popular profiles) → cache 200, client prefetches 20 and refills at 5.

**Never re-show:** Bloom filter (~1% FP, ~6 KB for 5K swipes) in Redis, rebuilt from Cassandra if lost; client also skips locally swiped ids.

**Trade-offs:** cached stacks are fast but stale (re-filter at serve time, TTL ~1 h); Redis match state is fast but must have a repair path (nightly join over likes_received for missed matches).`,
      followUps: [
        {
          q: 'A user changes their distance filter from 10 km to 100 km. What happens to their cached stack?',
          a: 'The cache key includes a preference version; changing filters bumps it, so the next \`GET /stack\` misses and rebuilds against the larger radius, which may now span several geoshards (query them in parallel and merge). The client discards prefetched cards that no longer match. Cost: one more expensive query; rate-limit filter changes so toggling repeatedly does not hammer the search cluster.',
        },
        {
          q: 'How do you handle a user who travels from Bengaluru to Mumbai?',
          a: 'Location updates on app open (not continuously) flow through Kafka keyed by user id; when the S2 cell maps to a different geoshard, the indexer deletes the document from the old index and adds it to the new one, in order. The user\'s own stack is rebuilt for the new location. Their swiped Bloom filter is global, so they still never see the same people. Hide very stale locations (not opened for 7 days) from others\' stacks.',
        },
        {
          q: 'What happens if Redis loses a shard of pair hashes?',
          a: 'Likes in those pairs are still in Cassandra. Some pending matches would not be detected in real time: if A liked B before the loss and B likes A afterwards, the script sees a fresh pair, so the fallback check on likes_received finds A\'s like and creates the match. The only true miss is two concurrent likes during the loss window, repaired by the nightly reconciliation job.',
        },
      ],
      pitfalls: [
        'Checking the other user\'s like in a different partition without atomicity',
        'Querying the full swipe history per candidate on every stack build',
        'A single global geo index with no sharding',
      ],
    },
    {
      id: 'design-consumer-iq-07',
      difficulty: 'expert',
      question:
        'Power users with 60K lifetime swipes say they keep seeing the same profiles, while a new city launch shows empty stacks after 20 swipes. How do you diagnose and fix both ends of this?',
      whatInterviewerLooksFor: [
        'Understands Bloom filter saturation and false-negative impossibility',
        'Considers the other re-show paths (cache staleness, client lag, multi-device)',
        'Treats supply scarcity as a product and ranking problem',
        'Proposes concrete metrics',
      ],
      modelAnswer: `**Power users seeing repeats — candidate causes:**
1. **Bloom filter sized for 5K swipes but holding 60K.** It does not cause repeats (a Bloom filter has no false negatives) but its false-positive rate approaches 100%, hiding almost everyone, so if the system falls back to "show something" when the filtered stack is empty, it may skip the filter. Fix: track insert count; rebuild at 2× capacity when it exceeds the plan (60K at 1% ≈ 72 KB).
2. **A buggy filter producing false negatives** (e.g. a negative index from a signed hash) or a filter lost and rebuilt from incomplete data. Verify with a canary test: re-check the last 1K swiped ids against the filter.
3. **Stale cached stacks:** 200 cards cached for an hour while the user swiped through them on another device. Fix: re-filter cached cards against the current filter at serve time.
4. **Async lag:** swipes reach the filter via Kafka; a fast swiper refills before the last swipes are applied. Fix: the client sends the ids it swiped since its last refill; the server excludes them.
Measure: re-show rate = cards served that already exist in \`swipes_by_swiper\` (sampled exact check).

**New city — empty stacks:** supply is genuinely small (a few thousand profiles), and filters (age range, distance, mutual preference) cut it to 20. Fixes: widen the radius progressively with a clear UI hint; relax mutual preference slightly at low supply; let **left swipes expire** (a pass from 6 months ago may be re-shown, a common product choice) while likes and blocks never expire; seed with people who already liked the user; launch with marketing to build supply before opening.

**Trade-off:** allowing old passes to reappear conflicts with "never re-show"; make it explicit and configurable per market.`,
      followUps: [
        {
          q: 'How would you implement "left swipes expire after 180 days" with a Bloom filter that cannot delete?',
          a: 'Use time-partitioned filters: one Bloom filter per quarter. Check the last two quarters\' filters for left swipes, and keep an all-time filter (or exact set) for likes and blocks, which never expire. Dropping a quarter\'s filter expires its passes in bulk. Alternatively a counting Bloom filter or a cuckoo filter supports deletion, at 2–4× the memory.',
        },
        {
          q: 'Instead of Bloom filters, could Elasticsearch exclude swiped ids in the query?',
          a: 'A \`must_not terms\` query with tens of thousands of ids per request is heavy: large payloads and slow filter construction on every shard, and Elasticsearch caps terms lookups (65K by default). It works for light users. For heavy users, post-filtering ~500 candidates against an in-memory Bloom filter costs microseconds, so the hybrid is: exclude the last few hundred ids in the query, Bloom-filter the rest.',
        },
      ],
      pitfalls: [
        'Blaming Bloom filter false negatives without understanding they cannot occur in a correct implementation',
        'Ignoring cache staleness and async lag as sources of repeats',
        'Treating the empty new city as a pure infrastructure bug',
      ],
    },
    {
      id: 'design-consumer-iq-08',
      difficulty: 'hard',
      question:
        'Design Google News: ingest articles from 100K publishers, group coverage of the same event into stories, and serve a ranked, fresh front page per country.',
      whatInterviewerLooksFor: [
        'Notices ingestion is small and reads dominate',
        'Polite, adaptive ingestion with canonicalisation and exact dedup',
        'Distinguishes near-duplicate detection from story clustering',
        'A ranking signal set including freshness decay',
        'Precomputed edition feeds, CDN, and stable pagination',
      ],
      modelAnswer: `**Numbers:** 3M articles/day ≈ 35/s (350/s during breaking news); reads 100M DAU × 10 ≈ 11.6K QPS, ~60K during big events. So ingestion is a modest pipeline; serving is a caching problem.

**Ingestion:** source registry with tier and observed publishing rate; adaptive polling (about twice per expected item, 1 min to 6 h), conditional GET, WebSub where available; Kafka between discovery and extraction. Extract title, time, lead, image, language; canonical URL; exact dedup by URL and content hash.

**Enrichment:** entities, multilingual embedding, topic, locality.

**Near-duplicates:** MinHash signatures on shingles with LSH bands to fold syndicated wire copy into one representative with alternates.

**Story clustering:** online assignment: candidate stories that share an entity (plus ANN on embeddings) within 48 h; join if cosine to centroid ≥ τ, else new story. Every 10–15 min a batch re-cluster of the last 24 h merges and splits, keeping story ids stable by maximum overlap.

**Ranking (per edition, every ~60 s):** breadth (distinct sources, log-scaled), velocity relative to the story's baseline, source authority and original reporting, locality, times a freshness decay (half-life ~6 h). Diversity rules: one card per story, varied sources.

**Serving:** edition lists versioned in Redis and on the CDN (\`max-age=30, stale-while-revalidate\`); "For you" re-ranks the cached top 500 with the user's topic affinities in a few ms. Cursor = (feed version, offset) so infinite scroll is stable.

**Storage:** article metadata in a wide-column store keyed by article id (~15 GB/day), story membership by story id, search index for topics and entities; full text is not stored, users click through to publishers.`,
      followUps: [
        {
          q: 'A publisher edits the headline of an article 20 minutes after publishing. How does that flow through?',
          a: 'Polling picks up the same canonical URL with a new content hash or \`dateModified\`. Treat it as an update, not a new article: update metadata in place, recompute the embedding, and re-evaluate its story assignment (it may move clusters, rarely). Bump the story\'s version so caches refresh. Exact dedup must be on canonical URL first and content hash second, otherwise every edit becomes a "new" duplicate article.',
        },
        {
          q: 'How do you rank a story that is huge globally but irrelevant in India\'s edition?',
          a: 'Rank per edition: compute locality from the story\'s entities (places, people) and the share of coverage from that edition\'s publishers. A US-only story with no Indian coverage gets a low locality factor in the India edition, unless its breadth is extreme (world events). This also tells you which stories go into "World" rather than "Top Stories" for a given edition.',
        },
      ],
      pitfalls: [
        'Crawling every source on a fixed schedule',
        'Using one similarity threshold for both syndication dedup and story clustering',
        'Rendering every feed request from the database',
      ],
    },
    {
      id: 'design-consumer-iq-09',
      difficulty: 'expert',
      question:
        'A major earthquake hits. Within ten minutes you have 4,000 articles, your front page shows the same event as five separate stories, and reads jump 6×. What breaks, and how do you design for it?',
      whatInterviewerLooksFor: [
        'Explains why online clustering fragments a fast-forming story',
        'Proposes fast merge mechanisms and stable ids',
        'Protects ingestion and serving separately from the surge',
        'Considers ranking and notification behaviour during breaking news',
      ],
      modelAnswer: `**Why five stories:** the first articles arrive before the event has consistent vocabulary ("tremors in Delhi", "7.8 quake in Nepal", "Kathmandu buildings collapse"). Their entities and embeddings differ, each starts its own story, and later articles join whichever centroid they are closest to. Online clustering is greedy and never revisits early decisions.

**Fixes for clustering:**
- **Fast merge pass:** besides the 15-minute batch, run a *story-to-story* similarity check every minute for stories younger than 1 hour (centroid cosine + entity overlap + time proximity). Merge into the oldest id, redirect the others, and record the alias so links and pushes keep working.
- **Event-type signals:** a spike detector on entity co-occurrence (Nepal + earthquake + magnitude) can create an "event" anchor that new articles test against first.
- **Display-level grouping:** even before a merge, the front page can collapse stories whose centroids are close into one card.

**Ingestion surge (35/s → ~350/s):** Kafka absorbs it; extraction and enrichment autoscale on lag. Prioritise tier-1 publishers' feeds and new articles over re-polls, and shed expensive steps (full embedding of long bodies) under backpressure, using the title and lead first.

**Read surge (6×):** logged-out traffic is CDN-cached edition lists, so origin barely moves; ensure \`stale-while-revalidate\` and origin shielding so a cache expiry does not stampede. The personal re-rank uses cached candidates; if the affinity store is slow, serve the edition list unpersonalised (graceful degradation).

**Ranking:** velocity spikes push the story to the top quickly, which is desired. Increase the update frequency of the edition list (every 15–30 s during detected breaking events) and pin a "developing story" card with a live timeline of the latest articles.

**Notifications:** a breaking-news push per edition, once, with strict per-user caps; do not push each fragment.`,
      followUps: [
        {
          q: 'After merging, users who shared a link to one of the four absorbed story ids get a 404. How do you prevent that?',
          a: 'Never delete story ids: keep an alias table \`absorbed_id → surviving_id\` and resolve it at the API (301 to the surviving story page). Apply the same alias in notification deep links and analytics. Choose the surviving id deterministically (oldest, or largest) so concurrent merges converge, and make merges idempotent operations in a log, so replays produce the same result.',
        },
        {
          q: 'Would lowering the similarity threshold during breaking events help?',
          a: 'It reduces fragmentation but increases wrong merges: an earthquake story could absorb an unrelated story about a dam in Nepal. A safer approach is to keep the article-to-story threshold and add the story-to-story merge pass, which compares richer centroids built from many articles, so it is more reliable than a single early article.',
        },
      ],
      pitfalls: [
        'Assuming more compute fixes fragmentation; it is an algorithmic, greedy-decision problem',
        'Merging stories by renumbering ids',
        'Letting the read surge reach the database',
      ],
    },
    {
      id: 'design-consumer-iq-10',
      difficulty: 'hard',
      question:
        'Design Strava: athletes record runs and rides, upload them, see their times on segments with leaderboards, and see friends\' activities.',
      whatInterviewerLooksFor: [
        'Offline-first recording and what that means for server load',
        'A durable, idempotent upload and processing pipeline',
        'A two-phase segment-matching approach (spatial index, then geometry)',
        'Leaderboards derived from personal bests',
        'Privacy treated as a hard requirement',
      ],
      modelAnswer: `**Shape of the load:** devices record locally (GPS at ~1 Hz), even offline. The server sees finished uploads: assume 5M/day ≈ 58/s, ~600/s at Sunday-morning peaks. Each 1-hour activity is ~3,600 points, ~144 KB raw, ~30 KB encoded: ~150 GB/day.

**Upload:** \`POST /uploads\` → presigned S3 URL; device uploads FIT/GPX (resumable); S3 event → Kafka (key = athlete). Dedup duplicates from watch + phone by start time and route overlap, or file hash.

**Processing (idempotent per activity id):** parse → clean (GPS spikes, auto-pause, elevation smoothing) → summary stats → streams stored columnar in S3, summary in a sharded SQL/KV store → \`activity.processed\` event.

**Segment matching:** simplify the trace, cover it with bounding boxes, query an R-tree/PostGIS index of segment rectangles for candidates (50–300 in a city). For each, find a pass near the start, a later pass near the finish, and require ≥ 80% of segment points within ~30 m of the route in between; interpolate crossing times; continue for repeat laps. Write \`segment_efforts\`.

**Leaderboards:** \`best_efforts(segment, athlete)\` upserted only if faster; Redis sorted set per popular segment with \`ZADD LT\`; filtered boards for popular filters; friends boards computed at read from a few hundred PB rows.

**Feed:** fan-out on write for typical athletes, on read for pros; kudos and comments keyed by activity.

**Privacy:** privacy zones crop start and end around saved addresses in the pipeline before any public stream, map, segment effort or heatmap is produced; visibility checked at fan-out and at read.

**Live sharing (optional):** beacon points every 15 s to a small live service with TTL'd state, separate from the upload pipeline.`,
      followUps: [
        {
          q: 'The phone was offline for a 6-hour mountain ride and the battery died at the end. What guarantees no data loss?',
          a: 'The app writes points to a local append-only file every few seconds (fsync periodically) and checkpoints activity state, so a crash or dead battery resumes or recovers the partial activity on next launch. Upload is resumable (multipart or tus-style) with the activity\'s client-generated id as the idempotency key, so retries across days create one activity. The server acks only after the object is durably in S3.',
        },
        {
          q: 'Which parts of processing must finish before the athlete sees their activity?',
          a: 'Only parse, clean and summary stats (a second or two), so the activity page shows distance, time and map quickly. Segment matching, achievements, leaderboard updates and feed fan-out are separate consumers that fill in over the next seconds. The UI shows "analysing segments" until the segment consumer publishes its completion event.',
        },
      ],
      pitfalls: [
        'Streaming every GPS point to the server in real time as the core design',
        'Matching segments by scanning all segments or doing pure geometry without a spatial index',
        'Treating leaderboards as the source of truth instead of efforts',
      ],
    },
    {
      id: 'design-consumer-iq-11',
      difficulty: 'expert',
      question:
        'A popular climb has 2M athletes on its leaderboard. Product wants a live "you just moved to rank 1,234" after upload, filtered boards (age group, weight class, this year, friends), and protection against cheating. Design the leaderboard layer.',
      whatInterviewerLooksFor: [
        'One personal best per athlete as the base set',
        'Monotonic updates that tolerate replays and reordering',
        'Different strategies per filter based on cardinality',
        'Integrity checks and a rebuild path',
      ],
      modelAnswer: `**Base set:** \`best_efforts(segment_id, athlete_id) → elapsed_s, effort_id\`, upserted only when faster (\`ON CONFLICT … WHERE excluded.elapsed_s < best_efforts.elapsed_s\`). Efforts are the source of truth; everything else can be rebuilt.

**Overall board (2M members):** a Redis sorted set \`lb:seg:{id}\` written with \`ZADD LT\`, so replays or out-of-order efforts never slow anyone. \`ZRANK\` gives rank in O(log n) for the "you moved to 1,234" message, computed by the consumer right after the upsert returns a new PB. Ties: use a composite score (elapsed × 10⁶ + seconds since a fixed epoch of achievement, or sort by effort id) so the earlier achiever ranks higher. Memory ≈ 100–200 MB for this key; fine for the few thousand largest segments, while the long tail is served from Postgres with an index on \`(segment_id, elapsed_s)\` and \`COUNT(*) WHERE elapsed_s < x\` for ranks.

**Filtered boards:**
- **Age group / weight class / gender:** low cardinality (~10–20 buckets), so maintain a sorted set per (segment, bucket) for big segments; the same consumer writes the overall and the athlete's buckets. The athlete's bucket is evaluated at effort time (age on that date).
- **This year:** a key per (segment, year); reset happens naturally on 1 January.
- **Friends:** compute at read: \`SELECT … FROM best_efforts WHERE segment_id = ? AND athlete_id = ANY(friend_ids)\` (hundreds of rows) and sort. Precomputing per user would multiply writes by follower counts.

**Cheating and errors:** flag implausible speeds and power-to-weight for the sport, accelerometer/cadence absence on a fast run (a car), GPS teleports; hold suspicious efforts off public boards pending review; exclude e-bike and virtual rides; let users flag. Removing an effort = delete it, recompute that athlete's PB from remaining efforts, re-ZADD with the plain (non-LT) command.

**Rebuild:** a batch job regenerates any board from \`best_efforts\` into a new key and swaps with \`RENAME\`, used after segment edits or Redis loss.`,
      followUps: [
        {
          q: 'Why can\'t you use ZADD LT when a flagged effort is removed?',
          a: 'LT only lowers scores, but removing the athlete\'s fastest effort usually makes their best time slower (higher). The removal path must recompute the athlete\'s new best from the remaining efforts and write it with a plain ZADD (or ZREM if no efforts remain), and do the same in every filtered board the athlete belongs to. Run it through the same per-segment consumer to avoid racing with a concurrent new PB.',
        },
        {
          q: 'Rank 1,234 shown after upload says 1,240 a minute later without the athlete doing anything. Is that a bug?',
          a: 'Not necessarily: six other athletes may have posted faster times in that minute on a popular segment. If ranks also shift because of deletions or reprocessing, that is expected too. Show the rank with a timestamp ("rank at upload"), and compute it from the same store the leaderboard page reads, so the two never disagree at the same moment.',
        },
      ],
      pitfalls: [
        'Storing every effort in the sorted set instead of one PB per athlete',
        'Precomputing a friends board for every user',
        'No way to remove a cheated effort correctly',
      ],
    },
    {
      id: 'design-consumer-iq-12',
      difficulty: 'expert',
      question:
        'A journalist shows that by combining public segment leaderboards and activity maps she can find where specific athletes live, despite privacy zones. How do you respond architecturally?',
      whatInterviewerLooksFor: [
        'Identifies inference channels beyond the cropped map',
        'Applies privacy at data production, not presentation',
        'Thinks about aggregation and side channels',
        'Proposes verification and regression testing for privacy',
      ],
      modelAnswer: `**How the leak happens even with cropped maps:**
- A segment that **starts or ends inside** someone's privacy zone (e.g. "Climb out of Koramangala 5th Block") lists the athlete's effort with a start time; the segment's geometry pinpoints the street.
- The cropped polyline still **points** at the home: the last visible point and heading converge after a few activities; the centroid of many cropped starts reveals the zone centre.
- **Fixed zone radius** around the exact address: the visible start is always ~200 m from the same point, so the circle's centre is computable.
- Other channels: stream APIs, exports, photos' EXIF, heatmaps, flyby or "who you ran with" features.

**Architectural response:**
1. **Privacy at production time:** the processing pipeline produces a *public* version of every derived artefact (polyline, streams, efforts, heatmap contributions), with hidden regions removed. Every downstream consumer reads only the public version. The raw version is accessible only to the owner.
2. **Segment matching excludes hidden portions** for public boards: efforts whose start or finish lies inside any privacy zone are visible only to the owner.
3. **Randomise the zone:** offset the zone's centre randomly (and stably) from the address and vary the effective crop distance per activity, so averaging attacks do not converge.
4. **Aggregates:** heatmaps require k-anonymity (a cell appears only with ≥ k distinct athletes) and exclude private and hidden data.
5. **One policy engine:** visibility is evaluated by a shared library at fan-out, API read, export and search, never reimplemented per service.
6. **Testing:** a privacy regression suite with synthetic athletes and known homes runs attacks (centroid of crops, segment start lookup) against each release; findings block deploys.

**Communication:** change the default to on for new users with a home address saved, and notify affected users.`,
      followUps: [
        {
          q: 'Applying privacy zones retroactively to 5 years of activities is a large backfill. How do you run it?',
          a: 'Activities are immutable inputs, so regenerate public artefacts from raw streams with the new policy as a batch job partitioned by athlete, prioritising athletes with public profiles and many followers. Write new versions alongside old ones and flip a pointer per activity once done, so readers never see a half-processed state. Invalidate CDN-cached maps and recompute affected segment boards from the efforts table.',
        },
        {
          q: 'Is it enough to crop on the client before upload?',
          a: 'No. Third-party devices upload raw files, older app versions do not crop, and the owner needs the full data for their own stats. More importantly, privacy enforced by clients can be bypassed or forgotten by any new server feature. The server must hold the raw data under owner-only access and produce public artefacts itself; client cropping can be an extra layer, never the guarantee.',
        },
      ],
      pitfalls: [
        'Treating privacy as hiding the map tile only',
        'Using a fixed radius centred on the exact address',
        'Enforcing visibility in each service separately',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-consumer-boe-1',
      question:
        'Size the flash-sale gate: 5M buy clicks arrive in 60 seconds, and one headline phone with 20K units attracts 40% of them. How many Redis buckets and shards, how fast do winners reach the database, and how long does a winner wait?',
      assumptions: [
        'Clicks are front-loaded: the first 5 seconds run at 2× the minute\'s average',
        'One Redis shard runs ~50K Lua evaluations/s; plan for 50% utilisation (25K/s)',
        'Near sell-out each request probes up to 4 buckets (home, 2 random, tail); assume 3 on average at peak',
        'Order workers claim unit rows at ~3K/s for one SKU (16 workers, ~5 ms per claim transaction)',
      ],
      steps: [
        { label: 'Average click rate', calc: '5M ÷ 60 s ≈ 83K/s; first-5-s peak ×2 ≈ 167K/s' },
        { label: 'Headline phone', calc: '40% × 83K ≈ 33K/s average; 40% × 167K ≈ 67K/s peak' },
        { label: 'Gate evaluations', calc: '67K/s × 3 probes ≈ 200K Lua evals/s for this SKU' },
        { label: 'Shards needed', calc: '200K ÷ 25K per shard = 8 shards → 20 buckets spread over 10 shards (2 per shard) for headroom' },
        { label: 'Units per bucket', calc: '20K units ÷ 20 buckets = 1,000 units per bucket' },
        { label: 'Time to sell out', calc: '20K units ÷ 67K clicks/s ≈ 0.3 s: the phone is gone in under a second' },
        { label: 'DB claim drain', calc: '20K winners ÷ 3K claims/s ≈ 7 s for the last winner to get RESERVED' },
      ],
      answer:
        'About 20 buckets over 10 Redis shards for the headline phone (other SKUs need 1–2 buckets). The phone sells out in ~0.3 s; Kafka absorbs the 20K winners and workers drain them in ~7 s, so the slowest winner sees "processing" for several seconds.',
      insight:
        'The gate must answer fast because almost every request is a loser, while winners can wait seconds. That asymmetry is why the design is "synchronous no, asynchronous yes": buckets size the gate for the loser flood, and Kafka plus SKIP LOCKED size the DB for the winners only. It also shows FCFS fairness is meaningless at this scale: a 0.3 s sell-out is decided by latency.',
      followUps: [
        {
          q: 'Peak is 5× the average instead of 2×. What breaks first?',
          a: 'The gate: 5 × 83K × 40% ≈ 167K/s × 3 probes ≈ 500K evals/s for one SKU, i.e. 20 shards at the 25K/s planning rate. Before that, the in-process sold-out flag helps most: after 0.1–0.3 s every pod answers locally, so the true Redis load is a short spike. Add an admission layer (waiting room or lottery tokens) so that peak arrivals at the gate are bounded by issued tokens rather than by raw demand.',
        },
        {
          q: 'Winners must see RESERVED within 2 seconds. What changes?',
          a: 'At 20K winners you need ≥ 10K claims/s for one SKU: more workers (~50) with shorter transactions, or pre-assign units to buckets so each Redis bucket maps to a fixed range of unit rows and claims become direct primary-key updates (no SKIP LOCKED search). Kafka partitions keyed by sku+bucket instead of sku spread the work across 20 partitions and consumers.',
        },
      ],
    },
    {
      id: 'design-consumer-boe-2',
      question:
        'Sale day: 25K popular products drop in price within 10 minutes, and together they carry 9M armed alerts. Email and push providers accept 2K messages per second in total. How long does it take to notify everyone, how hard is the alert database hit, and what do you change?',
      assumptions: [
        'Cooldowns and digests collapse ~30% of notifications (users watching several dropping products)',
        'Each fired alert costs 2 row writes (state flip + outbox row)',
        'SLA: notify within 1 hour of the price change',
      ],
      steps: [
        { label: 'Price events', calc: '25K events ÷ 600 s ≈ 42 events/s (trivial)' },
        { label: 'Fired alerts', calc: '9M alerts ÷ 600 s = 15K alerts/s' },
        { label: 'DB write rate', calc: '15K × 2 = 30K row writes/s for 10 minutes' },
        { label: 'Messages after collapsing', calc: '9M × 0.7 ≈ 6.3M messages' },
        { label: 'Drain time at 2K/s', calc: '6.3M ÷ 2K/s = 3,150 s ≈ 52.5 min' },
        { label: 'Drain time at 5K/s', calc: '6.3M ÷ 5K/s = 1,260 s = 21 min' },
      ],
      answer:
        '~52 minutes at 2K/s, dangerously close to the 1-hour SLA for the last users; the alert DB sees ~30K row writes/s for 10 minutes. Raise provider throughput to ~5K/s (pre-arranged limits, several provider accounts, push before email) to finish in ~21 minutes, and spread alert writes over 4 shards.',
      insight:
        'Matching is cheap; delivery capacity and write amplification are the constraints. This pushes three design choices: digest aggressively on sale days, prioritise the cheap fast channel (push), and re-check prices for messages that waited long, since some deals will have ended before the backlog drains.',
      followUps: [
        {
          q: 'Storage costs must halve. Which assumption do you attack?',
          a: 'The per-alert write amplification and history. Expire outbox rows after delivery plus a short dedup window (7 days) instead of keeping them, keep FIRED state on the alert row rather than a separate history table, and downsample price history: raw observations for 30 days, daily min/max beyond. Alerts themselves (60M × ~200 B with index) are small; observation history is usually the real storage bill.',
        },
      ],
    },
    {
      id: 'design-consumer-boe-3',
      question:
        'For a Tinder-scale app (75M MAU, 20M DAU, 100 swipes per user per day, ~30% likes), estimate the yearly swipe-log storage, the Redis memory for match-detection pair state, and the memory for "already swiped" Bloom filters.',
      assumptions: [
        'Swipe log row ≈ 100 B on disk including overhead; replication factor 3',
        'Pair state kept in Redis for 7 days only; ~90 B per pair hash including the key',
        'Average active user has 5K lifetime swipes; filters sized at 1% false positives (~9.6 bits per swipe)',
      ],
      steps: [
        { label: 'Swipes per day', calc: '20M × 100 = 2B/day ≈ 23K/s average' },
        { label: 'Swipe log per day', calc: '2B × 100 B = 200 GB; × RF 3 = 600 GB/day' },
        { label: 'Swipe log per year', calc: '600 GB × 365 ≈ 219 TB' },
        { label: 'Likes in Redis', calc: '2B × 30% = 600M likes/day × 7 days = 4.2B pairs' },
        { label: 'Redis pair memory', calc: '4.2B × 90 B ≈ 378 GB → ~40 shards of 10 GB' },
        { label: 'Bloom filter per user', calc: '5K × 9.6 bits ≈ 48K bits ≈ 6 KB' },
        { label: 'Bloom filters', calc: 'DAU in Redis: 20M × 6 KB = 120 GB; all MAU: 75M × 6 KB = 450 GB' },
      ],
      answer:
        'Roughly 219 TB/year of swipe log (with RF 3), ~380 GB of Redis for 7 days of pair state, and ~120 GB of Bloom filters for daily actives in memory (450 GB if every monthly user were kept hot).',
      insight:
        'The swipe log is the big cost and is mostly left swipes, which only serve "never re-show"; that justifies expiring left swipes (or compacting them into the Bloom filter) while keeping likes forever. Pair state is bounded only because of the 7-day TTL plus the durable fallback, and Bloom filters should live in Redis for DAU and be loaded lazily from disk for everyone else.',
      followUps: [
        {
          q: 'Product wants passes to expire after 180 days. How much does the swipe log shrink?',
          a: 'Left swipes are ~70% of 600 GB/day ≈ 420 GB/day; with a 180-day TTL they cap at 420 GB × 180 ≈ 76 TB, while likes accumulate at 180 GB/day ≈ 66 TB/year. So steady state after a year is ~142 TB instead of 219 TB and grows only by likes (about 35% less after year one, and the gap widens every year). Use Cassandra TTLs on left-swipe writes so expiry costs no deletes, and TimeWindowCompactionStrategy so expired data drops whole SSTables.',
        },
      ],
    },
    {
      id: 'design-consumer-boe-4',
      question:
        'Estimate Strava\'s yearly storage for GPS streams and the compute needed for segment matching at the Sunday-morning peak, assuming 5M uploads per day of ~1-hour activities.',
      assumptions: [
        '1 Hz recording: 3,600 points per activity, ~40 B per point raw (lat, lng, alt, time, HR, cadence, power)',
        'Delta + varint columnar encoding compresses ~5×',
        'Peak upload rate is 10× the daily average',
        '~100 candidate segments per activity after the spatial query; ~0.5 ms of geometry per candidate',
      ],
      steps: [
        { label: 'Upload rate', calc: '5M ÷ 86,400 ≈ 58/s; peak ×10 ≈ 600/s' },
        { label: 'Raw size per activity', calc: '3,600 × 40 B ≈ 144 KB' },
        { label: 'Raw per day / year', calc: '5M × 144 KB = 720 GB/day → ≈ 263 TB/year (originals, cold storage)' },
        { label: 'Encoded streams', calc: '720 GB ÷ 5 ≈ 150 GB/day → ≈ 55 TB/year hot' },
        { label: 'Candidate checks at peak', calc: '600/s × 100 = 60K checks/s' },
        { label: 'Geometry CPU', calc: '60K × 0.5 ms = 30 CPU-seconds per second ≈ 30 cores; ×3 for parsing, I/O, writes ≈ 100 cores' },
      ],
      answer:
        '~55 TB/year of hot encoded streams plus ~263 TB/year of original files in cold storage; segment matching needs about 30 cores of pure geometry at peak, ~100 cores including overhead, in an autoscaled consumer group.',
      insight:
        'Compute is modest and elastic because matching is async and parallel per activity; storage is the long-term cost. That argues for keeping originals in cheap archival tiers, serving charts from compact columnar streams, and spending engineering effort on candidate pruning, since the number of candidates multiplies everything.',
      followUps: [
        {
          q: 'A new feature re-matches every historical activity against 1M newly imported segments. How long does that take on 100 cores?',
          a: 'Suppose 3B historical activities with ~1 new candidate each after the spatial filter (the new segments are spread out): 3B × 0.5 ms = 1.5M CPU-seconds ≈ 17 core-days, about 4 hours on 100 cores. If each activity hits ~20 new candidates it is ~80 hours, so run it as a throttled backfill on spare capacity, popular segments first, never competing with live uploads.',
        },
        {
          q: 'GPS sampling moves from 1 Hz to 10 Hz for new devices. What changes?',
          a: 'Raw storage grows ~10× for those activities (1.44 MB per hour), and naive matching cost grows with the route length. Downsample for matching (simplify to ~10 m spacing, which loses no segment accuracy) and for display, and keep full-rate data only in the original file. Encoded storage grows less than 10× because deltas between 10 Hz points are tiny and compress well.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'design-consumer-mcq-01',
      difficulty: 'hard',
      question:
        'After a flash sale, 2.1% of the phone\'s units were never sold, although every reservation that reached the database was paid and the gate reported "sold out". Client logs show many automatic retries after timeouts. Given this gate script, what is the most likely cause?',
      code: {
        language: 'lua',
        code: `-- KEYS[1] = stock:{s1:sku9:b03}, KEYS[2] = resv:{s1:sku9:b03}
-- ARGV[1] = reservationId, ARGV[2] = userId
local left = redis.call('DECR', KEYS[1])
if left < 0 then
  redis.call('INCR', KEYS[1])
  return -1                              -- empty
end
if redis.call('HSETNX', KEYS[2], ARGV[1], ARGV[2]) == 0 then
  return -2                              -- duplicate retry, already reserved
end
return left`,
      },
      options: [
        'DECR followed by INCR lets the counter go negative briefly, so concurrent callers oversell and the DB rejects them',
        'HSETNX and DECR are on different slots in Redis Cluster, so the reservation write sometimes fails silently',
        'The duplicate-retry branch returns without restoring the decrement, so every retry of an existing reservation burns one unit',
        'When two callers race at zero, both INCRs run and the counter ends one higher than the real stock',
      ],
      correct: [2],
      explanation:
        'A retry with the same reservation id decrements first and then finds the reservation already recorded, returning -2 without an INCR: one unit disappears per retry, which matches undersell correlated with retries. Checking the reservation before decrementing (or INCR in that branch) fixes it. The negative dip is undone inside the same atomic script, so no other caller observes it. Both keys share the hash tag, so they are on one slot. Each racing caller INCRs only its own failed DECR, so the counter returns to zero, not above it.',
      followUps: [
        {
          q: 'How would reconciliation have caught this during the sale rather than after it?',
          a: 'Every few seconds compute, per SKU, initial stock − Σ bucket counters − reservations recorded in the resv hashes. With a correct gate the difference is zero; here it grows with each retry. Alert when it exceeds a small threshold, and let the reconciler return the difference to the tail bucket so the units are sold within the sale rather than discovered in the post-mortem.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-02',
      difficulty: 'expert',
      question:
        'A SKU\'s stock is split into 20 Redis buckets. Users hash to a home bucket and probe two random buckets before being told "sold out". Near the end, 37 units remain spread across 6 buckets, yet most users see "sold out". Select ALL changes that fix this stranded stock.',
      options: [
        'Increase the number of buckets to 100 so each bucket holds fewer units',
        'When total remaining stock drops below a threshold, move what is left into a single tail bucket that every request probes last',
        'Let the reconciler periodically rebalance units from buckets with stock into the user\'s home bucket on demand',
        'Track total remaining stock in a separate counter and only report "sold out" when it reaches zero, probing non-empty buckets from a maintained set',
        'Hash users to buckets with consistent hashing instead of modulo',
      ],
      correct: [1, 3],
      explanation:
        'A consolidated tail bucket and a "non-empty buckets" set both ensure that a request finds any remaining unit before answering sold out. More buckets make stranding worse, because units are spread thinner. Rebalancing into the requester\'s home bucket on demand adds a slow, racy multi-bucket transfer in the request path. Consistent vs modulo hashing only changes which bucket a user lands in, not whether the remaining units are reachable.',
      followUps: [
        {
          q: 'The tail bucket becomes a hot key at the end of the sale. Is that a problem?',
          a: 'Briefly. By then stock is a few hundred units at most, so the tail bucket sees the same flood as a single key, but only for the fraction of a second until it is empty, after which the sold-out flag short-circuits everyone in-process. If it matters, consolidate into 2–3 tail buckets on different shards; the point is to make every remaining unit reachable, not to have exactly one bucket.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-03',
      difficulty: 'expert',
      question:
        'Ten seconds into a sale, a Redis primary holding stock buckets fails over and the promoted replica had not received the last ~1,000 decrements. The gate then accepts ~1,000 more reservations than there are units. In the reference design, what guarantees no unit is sold twice?',
      options: [
        'Redis Lua scripts are atomic, so the replica replays the script results consistently after failover',
        'Calling WAIT 1 after each script ensures acknowledged decrements survive any failover',
        'The Kafka topic keyed by SKU serialises reservations, so duplicates are rejected by offset order',
        'Order workers claim a concrete FREE row from a table with exactly one row per unit; once rows run out, extra reservations fail',
      ],
      correct: [3],
      explanation:
        'Finite unit rows are the authority: a reservation without a free row becomes an apology, not an oversell. Lua atomicity concerns concurrent execution, not replication durability. WAIT narrows the window, but a replica that acknowledged can still lose the write, and failover can promote a replica that did not. Kafka ordering by key orders messages; it does not know how many units exist.',
      followUps: [
        {
          q: 'How do you reduce the number of users who get "yes" from the gate and then an apology?',
          a: 'Shrink the window and react fast: WAIT 1 with a short timeout after the script, Sentinel/Cluster failover detection in ~1–2 s, and on failover freeze the affected buckets and recompute their stock from DB truth (allocated − reserved rows − in-flight messages) before reopening. Also over-provision buckets on more shards so one failover affects a smaller fraction of stock.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-04',
      difficulty: 'hard',
      question:
        'Bots send thousands of requests at 7:59:59.999 for an 8 pm drop, and humans lose to them by milliseconds. Which admission design most directly removes the incentive to race the clock?',
      options: [
        'Give every request arriving in the first 30 seconds a random queue position, with one entry per verified identity',
        'Admit users strictly in arrival order through a virtual waiting room',
        'Add a CAPTCHA to the buy button so each click proves a human made it',
        'Rate-limit each IP address to 5 requests per second at the WAF',
      ],
      correct: [0],
      explanation:
        'Randomising positions within an arrival window makes arriving first worthless, and one entry per identity makes extra requests worthless. A CAPTCHA at T-0 slows humans and is solved by CAPTCHA farms. Per-IP limits are bypassed with residential proxy pools. A strict-arrival-order waiting room still rewards the fastest arrival, which is the original problem.',
      followUps: [
        {
          q: 'Users argue randomisation is unfair to people who were "on time". How do you answer?',
          a: 'Being on time still matters: anyone who joins within the 30-second window has the same chance, and late arrivals queue after that cohort. What no longer matters is shaving milliseconds, which humans cannot do anyway. Publish the rule in advance and show each user their position, so the process is transparent; that is usually perceived as fairer than a sell-out in 300 ms.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-05',
      difficulty: 'hard',
      question:
        'This price-alert worker processes a price event. The pod is killed after sending about half the emails, and Kafka redelivers the event. What happens?',
      code: {
        language: 'typescript',
        code: `async function onPriceEvent(ev: { productId: string; pricePaise: number; eventId: number }) {
  const { rows } = await pg.query(
    "SELECT alert_id, email FROM price_alerts " +
    " WHERE product_id = $1 AND state = 'ARMED' AND target_paise >= $2",
    [ev.productId, ev.pricePaise]);
  for (const a of rows) await mailer.send(a.email, 'Price drop!');
  await pg.query(
    "UPDATE price_alerts SET state = 'FIRED' WHERE product_id = $1 AND state = 'ARMED' AND target_paise >= $2",
    [ev.productId, ev.pricePaise]);
}`,
      },
      options: [
        'The second half never get an email, because the UPDATE already ran for them',
        'Postgres rejects the redelivery because the event id was already used',
        'The first half of users get a second email, because state is only flipped after all sends complete',
        'No one gets a duplicate, because the SELECT filters on state = ARMED',
      ],
      correct: [2],
      explanation:
        'The UPDATE never ran, so every alert is still ARMED and the replay emails everyone again, including those already emailed. The ARMED filter only helps if the flip happened before the crash. The UPDATE comes after the loop, so it did not run for anyone. Nothing in this code records or checks the event id. The fix is to flip state and write outbox rows atomically first, and send from the outbox with an idempotency key.',
      followUps: [
        {
          q: 'If you move the UPDATE before the loop (flip, then send), what failure mode do you trade for?',
          a: 'At-most-once: if the pod dies after the flip and before sending, those alerts are FIRED but nobody was told, and the replay finds nothing ARMED. That is why the flip must commit together with an outbox row in one transaction; a separate relay then sends from the outbox with retries and an idempotency key, giving effectively-once delivery.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-06',
      difficulty: 'medium',
      question:
        'A product is crawled every 15 minutes and its price alternates between ₹49,990 and ₹50,010 on each crawl. A user\'s target is ₹50,000, and the alert re-arms whenever the price is above the target. Roughly how many notifications does the user get per day, and what is the best fix?',
      options: [
        'Exactly 1; the ARMED to FIRED transition already prevents repeats',
        'About 96; only fire when the price is at least 1% below the target',
        'About 48; crawl the product less often so it changes less frequently',
        'About 48; re-arm only after the price rises a margin (e.g. 5%) above the target or after a cooldown period',
      ],
      correct: [3],
      explanation:
        '96 crawls a day alternate below/above, so the alert fires on each of ~48 dips and re-arms on each rise. Hysteresis (re-arm 5% above target) or a cooldown makes one real drop one notification. Only 48 of the 96 crawls are below target, and a 1% firing margin just moves the oscillation problem to a different threshold. Crawling less often hides real drops. The FIRED state prevents repeats only until the naive re-arm rule resets it.',
      followUps: [
        {
          q: 'The user explicitly wants every new drop below their target, even small ones. How do you honour that without spam?',
          a: 'Change the semantics to "new low below target": after firing, set the alert\'s internal threshold to the fired price minus a minimum step (e.g. 1% or ₹100), so it fires again only on a genuinely lower price, not on the same price returning. Combine with a per-product daily cap and a digest for subsequent drops.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-07',
      difficulty: 'expert',
      question:
        'You support four alert types: target price, "20% below the price when I subscribed", "any drop below today\'s price", and "lowest price in 90 days". Select ALL representations that keep matching a price change an index lookup on the product instead of evaluating each rule.',
      options: [
        'Store the % rule as an absolute target computed once at subscription time',
        'Store the % rule as a percentage and compute (old − new) ÷ old for each alert when the price changes',
        'Store "any drop" as target = current price − 1 paisa, lowering it after each firing',
        'Store "lowest in 90 days" per alert and query the price history for each alert when the price changes',
        'Store "lowest in 90 days" as a subscription to a NEW_90D_LOW flag that the change detector emits per product',
      ],
      correct: [0, 2, 4],
      explanation:
        'Converting % and "any drop" to absolute thresholds makes them rows in the same (product, state, target) index, and the 90-day low is computed once per product and fanned out via a flag subscription. Storing percentages relative to the subscription price would need evaluating each alert. Querying history per alert multiplies the per-change cost by the number of alerts; with 400K alerts on a hot product that is 400K history scans per change.',
      followUps: [
        {
          q: 'What about "notify me if the price drops 20% within a week", relative to a moving baseline?',
          a: 'That is a property of the product\'s price series, not of the user: compute per product, in the change detector, the max of the last 7 days and emit flags such as DROP_20PCT_7D when the new price crosses those levels (a small fixed set like 10/20/30%). Users subscribe to a flag. If users can pick arbitrary percentages, round to supported buckets; arbitrary per-user moving baselines do not index.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-08',
      difficulty: 'hard',
      question:
        'On sale day the notification queue has a 40-minute backlog. A message says "Headphones now ₹2,999, below your ₹3,000 target", but the current price is back at ₹3,499. What should the sender do?',
      options: [
        'Send it as is, because the drop really happened and the event is immutable',
        'Re-check the current price before sending; since it is above the target, drop the message and re-arm the alert',
        'Hold it until the price drops again, then send the original message',
        'Send it with the current price ₹3,499 instead, since the user wants accurate information',
      ],
      correct: [1],
      explanation:
        'A deal alert is useful only if the deal still exists; checking freshness for delayed messages and re-arming keeps the alert ready for the next real drop. Sending a stale price misleads users and erodes trust. Sending ₹3,499 notifies about a price that does not meet the user\'s condition. Holding stale messages builds an unbounded backlog of meaningless alerts.',
      followUps: [
        {
          q: 'The re-check adds a price read per delayed message: 6M reads during the backlog. Is that acceptable?',
          a: 'Yes, if you only re-check messages older than a threshold (e.g. 30 minutes) and read the current price from a cache keyed by product: 6M messages are spread across ~25K products, so a per-product cache with a 1-minute TTL serves almost all checks from memory. It costs far less than the support load and unsubscribes caused by stale alerts.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-09',
      difficulty: 'expert',
      question:
        'After a deploy, some users report seeing profiles they have already swiped on. The team moved to this Bloom filter for "already swiped". Which line causes previously swiped profiles to reappear?',
      code: {
        language: 'typescript',
        code: `private *indexes(profileId: string) {
  const d = createHash('sha256').update(profileId).digest();
  const h1 = d.readUInt32BE(0);                       // line A
  const h2 = d.readUInt32BE(4) | 1;                   // line B: make it odd
  for (let i = 0; i < this.k; i++)
    yield (h1 + i * h2) % this.m;                     // line C
}
mightContain(id: string) {
  for (const i of this.indexes(id))
    if (!(this.bits[i >> 3] & (1 << (i & 7)))) return false;   // line D
  return true;
}`,
      },
      options: [
        'Line C: the modulo makes two different profiles map to the same bit, which causes false negatives',
        'Line A: readUInt32BE returns a value larger than m, so the index overflows the array',
        'Line B: the bitwise OR yields a signed 32-bit value, so h2 can be negative, giving negative indexes that read and write outside the bit array',
        'Line D: the shift 1 << (i & 7) should be 1 << (i % 8), which differs for large i',
      ],
      correct: [2],
      explanation:
        'In JavaScript, x | 1 converts to a signed int32, so about half of all h2 values are negative; (h1 + i·h2) % m can then be negative, and writes to bits[negative] are silently ignored, so later lookups miss and profiles reappear. Fix: (d.readUInt32BE(4) | 1) >>> 0. Line A is fine because the modulo in line C bounds it. Shared bits cause false positives, not false negatives. For non-negative i, i & 7 equals i % 8.',
      followUps: [
        {
          q: 'How would a test have caught this before production?',
          a: 'A property test: insert 5K random ids, then assert mightContain is true for all of them (zero false negatives allowed) and that the measured false-positive rate on 100K unseen ids is near the configured 1%. With the bug, roughly half the inserted ids fail the first assertion. Run it as a unit test, not just a benchmark: Bloom filter bugs are silent in production.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-10',
      difficulty: 'hard',
      question:
        'Likes are stored in Cassandra partitioned by swiper id. On a right swipe, the service writes the like to the swiper\'s partition and then reads the other user\'s partition to check for a reciprocal like. A and B swipe right on each other 10 ms apart. Select ALL outcomes this design allows.',
      options: [
        'Exactly one match, guaranteed, because Cassandra serialises writes per partition',
        'No match is ever created, because each read happened before the other\'s write was visible',
        'A match is created for A but the reciprocal like from B is lost',
        'Two matches are created and both users get two "It\'s a match" notifications',
      ],
      correct: [1, 3],
      explanation:
        'With the write and the read on different partitions and no atomicity, both reads can miss (no match) or both can see the other (double match). Per-partition serialisation does not coordinate two different partitions, so "exactly one" is not guaranteed. The likes themselves are durably written, so nothing is lost; the problem is the match decision. Co-locating the pair in one key with an atomic check-and-set fixes it.',
      followUps: [
        {
          q: 'Could a Cassandra lightweight transaction solve it without Redis?',
          a: 'Yes, if you key a table by the unordered pair: \`UPDATE pair_state SET hi = \'R\' WHERE pair = ? IF lo = \'R\'\` style LWTs run Paxos on one partition, so the pair becomes a single serialisation point. The cost is latency (4 round trips, ~5–10 ms) and throughput under contention, acceptable at 7K likes/s spread across billions of pairs because pairs rarely contend. Redis is faster; LWT keeps everything in one durable store.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-11',
      difficulty: 'expert',
      question:
        'Match detection uses a Redis hash per unordered pair with a 7-day TTL. B liked A 90 days ago. Today A swipes right on B, and the pair script returns OK (no match), because the hash had expired. What is the right fix?',
      options: [
        'Extend the TTL to 90 days so most such cases are covered',
        'Run a nightly batch job that finds reciprocal likes and creates matches, and nothing else',
        'Remove the TTL so every like stays in Redis forever',
        'When the script finds a freshly created pair, also check the durable likes_received log for the other side; an old like cannot be racing, so a plain read is safe',
      ],
      correct: [3],
      explanation:
        'The fallback read covers old likes exactly when needed, and because an expired like is at least 7 days old, it cannot race with the current swipe; the match is then created through the same HSETNX path. Removing the TTL means thousands of gigabytes of Redis for likes that rarely reciprocate. A nightly job alone delays the match by up to a day, when the user expects it instantly. A longer TTL multiplies memory roughly 13× and still misses older likes.',
      followUps: [
        {
          q: 'How does the script tell the caller that the pair was freshly created?',
          a: 'Check \`EXISTS\` on the key before writing, or test whether the other field is absent and the key had no TTL set (a brand-new hash). Return a distinct status such as \`{\'OK_NEW\', \'R\'}\`. The service then reads likes_received(A, B); if found, it writes the other side into the hash and repeats the HSETNX step via a second script call, so the single exactly-once path is reused.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-12',
      difficulty: 'medium',
      question:
        'Why does a dating app group S2 cells into geoshards of roughly equal activity, instead of mapping each fixed-size cell to its own shard?',
      options: [
        'S2 cells cannot be used directly as Elasticsearch index names',
        'Activity is extremely uneven: one Mumbai cell can hold more active users than an entire rural state, so fixed cells create hot and idle shards',
        'Grouping cells lets one query always hit exactly one shard, whatever the search radius',
        'Equal-activity shards guarantee that every user sees the same number of candidates',
      ],
      correct: [1],
      explanation:
        'Load balancing is the reason: fixed cells produce a few overloaded shards in dense cities and many nearly empty ones elsewhere. Index naming is not a constraint. A search circle near a shard boundary still spans multiple shards. Candidate counts depend on local supply and filters, not on shard sizing.',
      followUps: [
        {
          q: 'A cricket final in Ahmedabad briefly makes one geoshard 5× busier. What do you do?',
          a: 'Geoshard boundaries change slowly (rebalancing moves documents), so react with replicas: add read replicas to that shard\'s index temporarily and lean on cached stacks for users in the area. Tinder described adjusting replica counts per geoshard by traffic. Re-drawing shard boundaries is for sustained shifts, not one evening.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-13',
      difficulty: 'hard',
      question:
        'Your near-duplicate detector uses MinHash LSH with 20 bands of 5 rows. Article pairs with Jaccard 0.5 become candidates ~47% of the time, flooding verification. You must keep catching syndicated copies (Jaccard ≈ 0.85). Which change works best?',
      code: {
        language: 'typescript',
        code: `// probability a pair with Jaccard s becomes a candidate
const p = (s: number, rows: number, bands: number) => 1 - (1 - s ** rows) ** bands;
p(0.85, 5, 20);  // 0.99999
p(0.50, 5, 20);  // 0.47`,
      },
      options: [
        'Keep 20 × 5 and raise the verification threshold from 0.8 to 0.9',
        '10 bands of 10 rows (100 hashes): p(0.85) ≈ 0.89, p(0.5) ≈ 0.01',
        '20 bands of 8 rows (160 hashes): p(0.85) ≈ 0.998, p(0.5) ≈ 0.075',
        '25 bands of 4 rows (100 hashes): p(0.85) ≈ 1.0, p(0.5) ≈ 0.80',
      ],
      correct: [2],
      explanation:
        'More rows per band steepen the S-curve and push its threshold (≈ (1/b)^(1/r) ≈ 0.69) above 0.5 while 20 bands still catch 0.85 pairs 99.8% of the time. 25 × 4 lowers the threshold and makes the flood worse. 10 × 10 nearly eliminates 0.5 pairs but misses ~11% of syndicated copies. Raising the verification threshold reduces accepted matches but not the number of candidates to verify, which is the load problem.',
      followUps: [
        {
          q: 'What does moving from 100 to 160 hash functions cost?',
          a: 'Signature computation grows 1.6× (one hash per shingle per function, so a 600-word article costs ~1K shingles × 160 hashes), and each signature grows from 400 B to 640 B with 32-bit values; at 3M articles/day that is ~2 GB/day of signatures, trivial. The 20 band tables are unchanged in count. It is a cheap trade for an order-of-magnitude cut in false candidates.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-14',
      difficulty: 'expert',
      question:
        'The "For you" feed is re-ranked every minute. Users scrolling with offset-based pagination see some stories twice and never see others. Select ALL approaches that fix this.',
      options: [
        'Switch from offset to a cursor on the last story\'s score, without versioning',
        'When a version has expired, page from the newest version while skipping story ids the client has already seen',
        'Rank once per day so the list never changes during a session',
        'Version each ranked list and put (version, offset) in the cursor, keeping old versions for ~10 minutes',
        'Increase the page size so users need fewer requests',
      ],
      correct: [1, 3],
      explanation:
        'Paging within a stable snapshot removes shifting, and the seen-ids fallback handles expired snapshots without duplicates. A score cursor still breaks because scores themselves change between minutes (decay and velocity), so stories jump across the cursor. Bigger pages reduce frequency but not the inconsistency. Daily ranking destroys freshness, the main product requirement.',
      followUps: [
        {
          q: 'Storing a snapshot per user is expensive. How do you keep it cheap?',
          a: 'Do not store per-user snapshots: store per-edition ranked lists by version (about 150 editions × 1 list per minute × 10 minutes = 1,500 small lists). The personal re-rank is deterministic given the edition version and the user\'s affinity vector at that time, so the server can recompute page N from (version, affinity snapshot id, offset). Only the affinity version id travels in the cursor.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-15',
      difficulty: 'expert',
      question:
        'A "Union Budget" story cluster grows to 3,000 articles over two days, gradually absorbing unrelated stock-market and fuel-price stories, because each new article is compared with the cluster centroid. Which change most directly addresses this?',
      options: [
        'Require entity overlap with the story\'s core entities and limit joins to articles close in time to the story\'s recent articles, with periodic batch splitting',
        'Switch to a larger embedding model to compute the centroid more accurately',
        'Lower the cosine threshold so that unrelated articles form their own stories more easily',
        'Cap every story at 500 articles and start a new story after that',
      ],
      correct: [0],
      explanation:
        'This is centroid chaining: as tangential articles join, the centroid drifts toward them and attracts more. Requiring overlap with core entities and recency, plus offline splitting, stops the drift. Lowering the threshold makes joining easier, which worsens chaining. A better embedding does not fix a drifting centroid. A size cap splits a legitimately big story arbitrarily and leaves the contamination in place.',
      followUps: [
        {
          q: 'How would you detect chaining automatically?',
          a: 'Track per story the spread of member similarity to the centroid and the entity distribution over time: chaining shows up as falling average similarity, a widening spread and new dominant entities that were absent early on. When thresholds are crossed, trigger a batch re-cluster of that story\'s members, keeping the original id for the largest sub-cluster.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-16',
      difficulty: 'hard',
      question:
        'On out-and-back routes (the segment\'s finish is near the route\'s start), the matcher sometimes reports negative or wildly short elapsed times. Which change in this variant of the matcher causes it?',
      code: {
        language: 'typescript',
        code: `for (let from = 0; ; ) {
  const s = closestPass(route, start, from, 25);
  if (s < 0) break;
  const e = closestPass(route, end, 0, 25);          // search for the finish
  if (e < 0) break;
  const window = route.slice(s, e + 1);
  const covered = seg.filter((p) => window.some((q) => distM(p, q) <= 30)).length;
  if (covered / seg.length >= 0.8)
    efforts.push({ startIdx: s, endIdx: e, elapsedS: route[e].t - route[s].t });
  from = e + 1;
}`,
      },
      options: [
        'The coverage threshold of 0.8 is too low for out-and-back routes',
        'Using a 25 m radius for both start and finish makes them indistinguishable',
        'route.slice(s, e + 1) excludes the finish point, shortening the effort',
        'The finish search starts at index 0 instead of s + 1, so it can pick a pass near the finish that happened before the start',
      ],
      correct: [3],
      explanation:
        'Searching for the finish from index 0 can find an earlier pass near the finish point, before the start, giving e < s: elapsed is negative, and route.slice(s, e + 1) is empty. With s + 1, the finish must come after the start. The coverage threshold controls shortcuts, not ordering. slice\'s end is exclusive, so e + 1 includes the finish point. Equal radii are standard; start and finish are different points.',
      followUps: [
        {
          q: 'GPS points are 5 s apart at 40 km/h on a descent (~55 m between points). What else goes wrong and how do you fix it?',
          a: 'No point may fall within 25 m of the start or finish, so the effort is missed, and when it is found the timing error is up to ±5 s at each end. Test crossing of the start/finish line by segments between consecutive points (line-segment intersection, as in Strava\'s patent with virtual start and finish lines) and interpolate the crossing time linearly along that segment.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-17',
      difficulty: 'expert',
      question:
        'An athlete sets a privacy zone around their home. Select ALL places where the hidden portion must be removed or excluded so the home location cannot be inferred.',
      options: [
        'The athlete\'s own activity view and personal stats',
        'The public map polyline and downloadable streams produced by the processing pipeline',
        'Contributions to the global aggregated heatmap',
        'Only the client\'s map rendering, since the server must keep raw data intact',
        'Public segment efforts whose start or finish lies inside the zone',
      ],
      correct: [1, 2, 4],
      explanation:
        'Polylines and streams leak directly, segment leaderboards leak through a segment\'s known geometry, and heatmaps leak by aggregation (a lone track ending in a cul-de-sac). The owner may see their own full data, so cropping their personal view is unnecessary. Client-only cropping is bypassed by APIs, exports and third-party clients; the server must produce cropped public artefacts while keeping raw data owner-only.',
      followUps: [
        {
          q: 'Cropping a fixed 500 m circle centred on the address still leaks the address. Why, and what fixes it?',
          a: 'Over many activities, the visible start points lie on a circle of radius ~500 m around the same centre, which anyone can fit geometrically. Offset the zone centre by a random but stable vector (up to the radius) and vary the effective crop distance per activity, so the centre of the visible circle is not the home and repeated activities do not converge on it.',
        },
      ],
    },
    {
      id: 'design-consumer-mcq-18',
      difficulty: 'medium',
      question:
        'Product wants a "friends" leaderboard on every segment. Athletes follow ~150 people on average, a few follow 5,000, and a popular segment has 2M personal bests. How should it be served?',
      options: [
        'Store a friends leaderboard per user in the activity feed and rebuild it nightly',
        'Compute at read: fetch the friends\' personal bests on that segment by (segment_id, athlete_id) and sort the few hundred rows',
        'Precompute a sorted set per (segment, user) and update it whenever any followed athlete sets a PB',
        'Read the 2M-member global sorted set and filter it down to friends in the application',
      ],
      correct: [1],
      explanation:
        'A read of at most a few thousand primary-key rows is cheap and always fresh. Precomputing per (segment, user) multiplies every PB write by the athlete\'s follower count and creates billions of keys. Scanning a 2M-member sorted set to find 150 friends is wasteful. A nightly rebuild is stale and still expensive.',
      followUps: [
        {
          q: 'The friends board must also show the athlete\'s friends ranked among the global top 10. How do you add that cheaply?',
          a: 'Read the global top 10 with one ZRANGE, and for each friend\'s PB use ZRANK on the global sorted set (or ZMSCORE plus ZCOUNT) in one pipelined call to annotate global ranks. With 150 friends that is one round trip of 150 O(log n) operations, about a millisecond, without precomputing anything.',
        },
      ],
    },
  ],
};

export default topic;
