import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-commerce',
  phase: 'designs',
  order: 5,
  title: 'Commerce & Money: Hotel/Ticket Booking, E-commerce, Payment System & Digital Wallet',
  subtitle:
    'Five end-to-end case studies where a wrong answer costs real money: inventory that must never oversell, seats held under flash-sale load, carts that turn into orders, payments that must happen exactly once, and wallets that must balance to the paisa.',
  estimatedMinutes: 150,
  sources: [
    'Alex Xu & Sahn Lam — System Design Interview Vol 2, Ch 7 Hotel Reservation System',
    'Alex Xu & Sahn Lam — System Design Interview Vol 2, Ch 11 Payment System',
    'Alex Xu & Sahn Lam — System Design Interview Vol 2, Ch 12 Digital Wallet',
    'Stripe Engineering — Designing robust and predictable APIs with idempotency',
    'Queue-it / Ticketmaster engineering talks — virtual waiting rooms',
  ],
  tags: [
    'hotel-reservation',
    'ticket-booking',
    'e-commerce',
    'inventory',
    'payments',
    'ledger',
    'idempotency',
    'reconciliation',
    'digital-wallet',
    'event-sourcing',
    'saga',
  ],
  cheatSheet: [
    'Money/inventory systems: correctness > availability. Say it up front, then pick CP storage (Postgres/MySQL with ACID) for the source of truth and cache only the read path.',
    'Hotel inventory = one row per (hotel_id, room_type_id, date) with total_inventory + total_reserved; guard with a CHECK constraint or optimistic version, not a read-then-write in app code.',
    'Double-click / retry safety: client generates reservation_id / idempotency key; server makes it the PRIMARY KEY or UNIQUE so a replay is a no-op that returns the original result.',
    'Seat holds: Redis SET seat:{show}:{seat} userId NX PX 600000 (atomic multi-seat via Lua); durable booking only after payment, TTL auto-releases abandoned holds.',
    'Flash sale: put a virtual waiting room in front (signed admission token, drip N users/sec) so the booking core sees a controlled rate instead of a 50x spike.',
    'Checkout = saga: reserve inventory (TTL) → authorize payment → confirm order → capture; every step has a compensating action and runs off a durable state machine.',
    'Payment system: pay-in via PSP hosted page (keeps you out of most PCI scope), ledger is double-entry & append-only, every movement debits one account and credits another for the same amount.',
    'Exactly-once payments = at-least-once retries + idempotency keys at every hop (client→you, you→PSP) + nightly reconciliation against PSP settlement files.',
    'Wallet at 1M TPS: shard balances, avoid 2PC in the hot path; use TC/C or Saga for cross-shard transfers, or event sourcing + Raft-replicated state machines for reproducibility.',
    'Event sourcing = commands validated → immutable events appended → state derived by replay; CQRS serves reads from projections; snapshots bound replay time.',
  ],
  sections: [
    {
      heading: 'Why commerce designs are different: correctness is the product',
      body: `**Intuition:** in a social feed, showing a stale like-count for 2 seconds is fine. In a booking or payment system, selling the same seat twice or charging a card twice is a customer-support ticket, a chargeback and sometimes a regulatory issue. So the interviewer is really testing whether you can keep **invariants** under concurrency, retries and partial failure.

The invariants you should state out loud in the first five minutes:

| Design | Invariant that must never break | Typical traffic |
|---|---|---|
| Hotel reservation | reserved(room_type, date) ≤ total × overbooking_ratio | low QPS (≈3 TPS writes), read-heavy search |
| Ticket booking | one seat → at most one confirmed booking | extreme spikes (1M users for 50K seats) |
| E-commerce checkout | sold units ≤ physical stock (or allowed backorder) | 10–100x spikes on sale days |
| Payment system | every rupee in = every rupee out (ledger balances); charge happens once | modest TPS, huge correctness bar |
| Digital wallet | sum of all balances is conserved across transfers | can be very high TPS (1M TPS in Ch 12) |

**The recurring toolbox** (you will reuse these in every design below):

- **ACID source of truth** (Postgres/MySQL) for inventory, orders and ledger. Scale it by sharding on the natural key (hotel_id, event_id, merchant_id, account_id), not by giving up transactions.
- **Idempotency keys** so that retries — from the client, the gateway, or your own workers — are safe.
- **Short-lived holds with TTL** so abandoned carts/seats return to the pool without a cron cleanup bug.
- **State machines + outbox** so a multi-step flow (reserve → pay → confirm) survives crashes at any step.
- **Reconciliation** as the final safety net: assume something will diverge and detect it.

**In interviews say this:** "I'll optimise for correctness first — the source of truth is a relational DB with constraints, and every write path is idempotent. Then I'll scale reads with caches and scale writes by sharding on the entity that contention naturally groups around."`,
      keyPoints: [
        'Name the invariant before designing anything.',
        'Correctness levers: DB constraints, idempotency keys, TTL holds, state machines, reconciliation.',
        'Write QPS in commerce is usually small; the hard part is contention and failure handling.',
      ],
      source: 'Alex Xu Vol 2 — Ch 7, Ch 11, Ch 12 (framing)',
    },
    {
      heading: 'Hotel reservation (1/3): requirements, estimation, API and data model',
      body: `**Scope (Ch 7):** a hotel chain with **5,000 hotels and 1M rooms**. Users search, view a hotel/room type, reserve a *room type* (not a specific room number — the room is assigned at check-in), pay, and cancel. Admins manage hotels, room types and prices. Allow **10% overbooking**, as real hotels do to offset cancellations. Prices vary per date.

**Estimation:**
- Assume 70% occupancy, average stay 3 nights → reservations/day = 1M × 0.7 ÷ 3 ≈ **240K/day** → ≈ **3 TPS** of bookings.
- Funnel: if ~10% of order-page visitors complete and ~10% of detail-page viewers reach the order page, then detail views ≈ 300 QPS and order-page views ≈ 30 QPS. Search is the read hotspot, and it can be served from a cache/search index.

**API (REST):**

| Method & path | Purpose |
|---|---|
| GET /v1/hotels/:id | hotel details |
| GET /v1/hotels/:id/availability?roomType=&from=&to= | availability per date |
| POST /v1/reservations | body: { reservationId, hotelId, roomTypeId, startDate, endDate } |
| GET /v1/reservations/:id | status |
| DELETE /v1/reservations/:id | cancel |

The **reservationId is generated by the client** (or by the server when rendering the order page) so a double-click or network retry re-sends the *same* id — the key trick of this chapter.

**Data model:** because we reserve room types, availability is tracked per date in \`room_type_inventory\`. Rows are pre-generated for, say, the next 2 years by a daily job: 5,000 hotels × ~20 room types × 730 days ≈ **73M rows** — small enough for one well-indexed relational DB, and trivially shardable by hotel_id later.`,
      code: [
        {
          language: 'sql',
          title: 'Core tables (Postgres)',
          code: `CREATE TABLE room_type_inventory (
  hotel_id        BIGINT  NOT NULL,
  room_type_id    BIGINT  NOT NULL,
  date            DATE    NOT NULL,
  total_inventory INT     NOT NULL,
  total_reserved  INT     NOT NULL DEFAULT 0,
  version         BIGINT  NOT NULL DEFAULT 0,          -- for optimistic locking
  PRIMARY KEY (hotel_id, room_type_id, date),
  -- 10% overbooking is enforced by the DB, not by application code
  CONSTRAINT no_oversell CHECK (total_reserved <= FLOOR(total_inventory * 1.1))
);

CREATE TABLE reservation (
  reservation_id UUID PRIMARY KEY,                     -- client-supplied => idempotent
  hotel_id       BIGINT NOT NULL,
  room_type_id   BIGINT NOT NULL,
  guest_id       BIGINT NOT NULL,
  start_date     DATE   NOT NULL,
  end_date       DATE   NOT NULL,                      -- exclusive
  status         TEXT   NOT NULL CHECK (status IN
                   ('pending','paid','refunded','canceled','rejected')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON reservation (guest_id, created_at DESC);`,
        },
      ],
      keyPoints: [
        '240K bookings/day ≈ 3 TPS: this is a correctness problem, not a throughput problem.',
        'Reserve room TYPES per date; specific rooms are assigned at check-in.',
        'Client-generated reservation_id as PK makes POST /reservations idempotent.',
      ],
      source: 'Alex Xu Vol 2 — Ch 7 Hotel Reservation System',
    },
    {
      heading: 'Hotel reservation (2/3): architecture and the double-booking problem',
      body: `**High-level design:** microservices behind an API gateway — Hotel service (static data, heavily cached), Rate service (price per date), Reservation service (owns inventory + reservations), Payment service, and an admin Hotel-management service. Ch 7 makes a pragmatic call: **keep reservation and inventory tables in the same database** so a booking is one local ACID transaction instead of a distributed one.

Two concurrency bugs to address:

1. **Same user double-clicks** → solved by the idempotent reservationId (a second INSERT hits the PK and is a no-op).
2. **Two users race for the last room.** Both read total_reserved = 99 of 100, both write 100 → oversold. Options:

| Approach | How | When it fits |
|---|---|---|
| Pessimistic lock | SELECT … FOR UPDATE on the inventory rows | Simple, but holds row locks across the txn; deadlock risk when a multi-night stay locks several date rows in different orders (always lock in date order) |
| Optimistic lock | version column; UPDATE … WHERE version = :v; retry on 0 rows | **Best default** for hotels: contention is low (3 TPS) so retries are rare |
| DB constraint | single conditional UPDATE guarded by CHECK / WHERE total_reserved + n <= limit | Simplest and atomic; the DB rejects the oversell. Constraint logic lives in the schema (harder to version) |

The conditional-update variant below does the check and the increment in one statement, so there is no read-modify-write window at all. For a 3-night stay we update 3 rows in one transaction and require that exactly 3 rows changed.`,
      diagram: `Client ──► CDN (static) ──► API Gateway (auth, rate limit)
                               │
   ┌──────────────┬────────────┼──────────────┬───────────────┐
   ▼              ▼            ▼              ▼               ▼
Hotel svc     Rate svc   Reservation svc  Payment svc   Hotel-mgmt svc
(cached)    (price/day)       │                │           (admin)
   │              │           ▼                ▼
Hotel DB     Rate DB   ┌──────────────┐      PSP
                       │ Reservation  │
                       │ DB: reservation + room_type_inventory
                       │ (same DB => local ACID txn)│
                       └──────────────┘`,
      code: [
        {
          language: 'typescript',
          title: 'Reserve a multi-night stay atomically (pg)',
          code: `import { Pool } from 'pg';
const pool = new Pool({ max: 20, statement_timeout: 2000 });

export async function reserve(r: {
  reservationId: string; hotelId: number; roomTypeId: number;
  guestId: number; start: string; end: string; nights: number;
}): Promise<'created' | 'duplicate' | 'sold_out'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 1) Idempotency: PK conflict => this reservation already exists
    const ins = await client.query(
      'INSERT INTO reservation (reservation_id, hotel_id, room_type_id, guest_id, start_date, end_date, status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (reservation_id) DO NOTHING',
      [r.reservationId, r.hotelId, r.roomTypeId, r.guestId, r.start, r.end, 'pending']);
    if (ins.rowCount === 0) { await client.query('ROLLBACK'); return 'duplicate'; }

    // 2) Check-and-increment in ONE statement per date; rows are touched in date order
    const upd = await client.query(
      'UPDATE room_type_inventory SET total_reserved = total_reserved + 1, version = version + 1 WHERE hotel_id = $1 AND room_type_id = $2 AND date >= $3 AND date < $4 AND total_reserved + 1 <= FLOOR(total_inventory * 1.1)',
      [r.hotelId, r.roomTypeId, r.start, r.end]);
    if (upd.rowCount !== r.nights) {             // at least one night is full
      await client.query('ROLLBACK');
      return 'sold_out';
    }
    await client.query('COMMIT');
    return 'created';
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}`,
        },
      ],
      keyPoints: [
        'Keep reservation + inventory in one DB so booking is a local transaction.',
        'A conditional UPDATE (check + increment in one statement) removes the race window.',
        'Multi-night stays: require rowCount === nights; touch rows in a consistent order.',
      ],
      source: 'Alex Xu Vol 2 — Ch 7 (concurrency issues)',
    },
    {
      heading: 'Hotel reservation (3/3): scaling, caching and cross-service consistency',
      body: `**If the interviewer 10x's it** (e.g. "this is Booking.com, not one chain" — 1,000x the load):

- **Shard by hotel_id.** All rows for one hotel's inventory and reservations live on one shard, so the booking transaction stays local. 16 shards at 30K QPS peak ≈ 1.9K QPS each — fine for Postgres.
- **Cache availability in Redis** keyed \`inv:{hotelId}:{roomTypeId}:{date}\` → remaining count. The cache is **only for the read path** (search and the "only 2 rooms left" badge). The DB constraint remains the final arbiter; a stale cache just means a user occasionally sees "available" and then gets "sold out" at submit — acceptable and honest.
- Keep the cache fresh via **CDC** (Debezium on the inventory table → Kafka → cache updater) instead of dual writes from the service, which can diverge on partial failure.

**Cross-service consistency:** if you insist on a pure microservice split (reservation DB separate from inventory DB, or payment in another service), you are into distributed transactions. Ch 7's honest take: 2PC blocks and couples services; Saga gives eventual consistency with compensations. Most real booking systems keep inventory+reservation co-located and use a saga only for the payment step:

1. Create reservation (pending) + decrement inventory — one local txn.
2. Call payment. On success → status = paid. On failure or 15-minute timeout → compensate: status = canceled and give inventory back.

**Overbooking** is a business policy expressed as data (the 1.1 factor), and can be per hotel/room type in a config column.

**Trade-offs to state:** optimistic locking is ideal at 3 TPS; under a hot promotion (one hotel, one date, thousands of buyers) optimistic retries spin, and you would switch to the conditional-update form (no retries needed) or to a queue per hot key.`,
      keyPoints: [
        'Shard by hotel_id to keep booking transactions single-shard.',
        'Redis inventory cache serves reads; DB constraint stays authoritative.',
        'Update caches via CDC, not dual writes.',
        'Saga only around payment; compensation returns inventory.',
      ],
      source: 'Alex Xu Vol 2 — Ch 7 (scalability, data consistency among microservices)',
    },
    {
      heading: 'Ticket booking (1/2): BookMyShow/Ticketmaster seat holds with TTL',
      body: `**Intuition:** a movie hall or stadium sells *specific* seats. When you tap seats, they turn grey for everyone else for ~10 minutes while you pay. That grey state is a **hold** — a lease with an expiry, not a booking.

**Requirements:** browse events/shows, view a live seat map, select up to N (say 10) seats, hold them for 10 minutes, pay, get a ticket. No seat can be confirmed twice. Non-functional: seat-map reads are huge during an on-sale; holds must be atomic across all selected seats (all-or-nothing); p99 hold latency < 200 ms.

**Estimation (IPL final / big concert):** 50K seats, 2M users arriving in the first 10 minutes. If each user makes ~20 seat-map refreshes and ~3 hold attempts: seat-map reads ≈ 2M × 20 ÷ 600 s ≈ **67K QPS**; hold attempts ≈ 2M × 3 ÷ 600 ≈ **10K QPS**, nearly all fighting over the best 5K seats. This is the opposite of the hotel problem: **extreme contention on a small keyspace**.

**Data model:**
- Durable (Postgres): \`show_seat(show_id, seat_id, status, booking_id, version)\` with status AVAILABLE/BOOKED, and \`booking(booking_id PK, user_id, show_id, seat_ids[], status, hold_expires_at)\`.
- Ephemeral holds (Redis): \`hold:{showId}:{seatId}\` → holdId, with PX 600000. Redis is single-threaded per shard, so a Lua script checking and setting all N seats is atomic. Hash-tag the key by show (\`{showId}\`) so all seats of one show land in the same Redis Cluster slot, which is required for a multi-key script.

**Flow:** hold (Redis Lua) → create booking row PENDING with hold_expires_at → payment → on success, a transaction flips show_seat rows to BOOKED \`WHERE status = 'AVAILABLE'\` (the DB is still the final guard) → delete Redis holds. If payment never returns, the TTL releases seats automatically; a sweeper marks the PENDING booking EXPIRED.

**Why not only the DB?** You can do holds with \`UPDATE show_seat SET status='HELD', held_until = now()+10min WHERE status='AVAILABLE' OR held_until < now()\`. It is correct, but at 10K contended writes/s on a few thousand rows you get lock queues on hot rows; Redis handles ~100K simple ops/s per shard with microsecond ops.`,
      code: [
        {
          language: 'lua',
          title: 'All-or-nothing multi-seat hold (Redis Lua)',
          code: `-- KEYS = hold keys, e.g. hold:{show42}:A10, hold:{show42}:A11 (same hash tag)
-- ARGV[1] = holdId, ARGV[2] = ttl in ms
for i = 1, #KEYS do
  local owner = redis.call('GET', KEYS[i])
  if owner and owner ~= ARGV[1] then
    return {0, KEYS[i]}                  -- someone else holds this seat: abort, nothing written
  end
end
for i = 1, #KEYS do
  redis.call('SET', KEYS[i], ARGV[1], 'PX', ARGV[2])   -- same holdId re-hold = extend (idempotent)
end
return {1, ''}`,
        },
        {
          language: 'lua',
          title: 'Release only if we still own the hold',
          code: `-- Prevents user A's late "release" from deleting user B's newer hold after A's TTL expired
for i = 1, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
  end
end
return 1`,
        },
      ],
      keyPoints: [
        'Hold = lease with TTL; booking = durable record after payment.',
        'Multi-seat holds must be atomic: Lua script with keys in one hash slot.',
        'DB conditional update on BOOKED is the last line of defence.',
        'Compare-and-delete on release to avoid deleting someone else’s hold.',
      ],
    },
    {
      heading: 'Ticket booking (2/2): the virtual waiting room for flash sales',
      body: `**Intuition:** a nightclub bouncer. Instead of letting 2M people crush the door, you give everyone a numbered token and let people in at the rate the room can handle. Users see "You are #183,402 — about 9 minutes".

**Why it's needed:** autoscaling does not help when the constraint is 50K *seats*, not CPU. Without admission control, 2M users hammer the seat map, get constant "seat taken" errors, retry harder and melt your API and DB. With a waiting room, the booking core sees a **steady, configured rate** (e.g. 2,000 admitted users/minute), and the experience becomes fair (FIFO or randomised at T0 to defeat bots that arrive a millisecond early).

**Mechanics:**
1. Before on-sale, everyone lands on a lightweight, CDN-cacheable waiting page. At T0, each visitor gets a position: \`INCR queue:{eventId}\` (or a random position for everyone who arrived before T0).
2. An **admission controller** advances a pointer \`admitted:{eventId}\` by N every second, based on live health (booking-service latency, seats remaining).
3. Clients poll (or hold an SSE connection) with their position; when \`position ≤ admitted\`, the server issues a **signed admission token** (JWT/HMAC, 10–15 min TTL, bound to user + event).
4. The booking API gateway **rejects any request without a valid token** — the queue can't be bypassed by calling the API directly.
5. When seats sell out, stop admitting and tell the rest immediately (don't make them wait for nothing).

**Anti-bot:** per-account and per-device limits, CAPTCHA at queue entry, one token per verified phone number, and a max of N seats per order.

**In interviews say this:** "The waiting room converts an unbounded spike into a bounded, tunable arrival rate. It is the single biggest reliability lever for flash sales — more than any cache."`,
      diagram: ` 2M users at T0
      │
      ▼
┌─────────────┐   INCR position    ┌──────────────────────┐
│ Waiting room│ ─────────────────► │ Redis: queue counter │
│ (CDN + edge)│ ◄── poll/SSE ────  │ admitted pointer     │
└─────┬───────┘                    └─────────▲────────────┘
      │ signed admission token               │ +N/sec
      ▼                                      │
┌─────────────┐  verify token   ┌────────────┴─────────┐
│ API gateway │ ──────────────► │ Admission controller │
└─────┬───────┘                 │ (watches p99, seats) │
      ▼                         └──────────────────────┘
Booking core (seat map, holds, payment) at a steady rate`,
      code: [
        {
          language: 'typescript',
          title: 'Admission check + token issue (NestJS-style service)',
          code: `import Redis from 'ioredis';
import { createHmac, timingSafeEqual } from 'node:crypto';

const redis = new Redis(process.env.REDIS_URL!);
const SECRET = process.env.ADMISSION_SECRET!;
const sign = (p: string) => createHmac('sha256', SECRET).update(p).digest('base64url');

export async function joinQueue(eventId: string, userId: string): Promise<number> {
  // SET NX so a refresh keeps the same place in line (idempotent join)
  const key = 'pos:' + eventId + ':' + userId;
  const existing = await redis.get(key);
  if (existing) return Number(existing);
  const pos = await redis.incr('queue:' + eventId);
  const ok = await redis.set(key, pos, 'EX', 7200, 'NX');
  return ok ? pos : Number(await redis.get(key));
}

export async function pollAdmission(eventId: string, userId: string) {
  const pos = Number(await redis.get('pos:' + eventId + ':' + userId));
  const admitted = Number((await redis.get('admitted:' + eventId)) ?? 0);
  if (!pos || pos > admitted) return { admitted: false, ahead: pos - admitted };
  const exp = Math.floor(Date.now() / 1000) + 900;          // 15-minute window
  const payload = eventId + '.' + userId + '.' + exp;
  return { admitted: true, token: payload + '.' + sign(payload) };
}

export function verifyToken(token: string, eventId: string, userId: string): boolean {
  const [ev, uid, exp, mac] = token.split('.');
  if (ev !== eventId || uid !== userId || Number(exp) < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(ev + '.' + uid + '.' + exp));
  const got = Buffer.from(mac ?? '');
  return got.length === expected.length && timingSafeEqual(got, expected);
}`,
        },
      ],
      keyPoints: [
        'The constraint is seats, not servers: control the arrival rate.',
        'Signed, user-bound admission tokens enforced at the gateway.',
        'Admission rate adapts to downstream health and remaining inventory.',
      ],
    },
    {
      heading: 'E-commerce (1/2): cart, checkout API and order data model',
      body: `**Scope:** an Amazon/Flipkart-style store. Functional: add/remove cart items (guest and logged-in), view cart with live prices, checkout (address, delivery promise, payment), order history, cancel/return. Non-functional: cart must never be lost (it's revenue), checkout p99 < 1 s excluding payment, **never oversell** unless the SKU allows backorders, and survive 10–20x traffic on sale days.

**Estimation:** 50M DAU, 5% place an order → 2.5M orders/day ≈ 30 orders/s average; sale-day peak 20x → **~600 orders/s**, each touching ~3 SKUs → ~1,800 inventory decrements/s, heavily skewed to a few hundred "deal" SKUs. Cart ops ≈ 10× orders.

**Cart storage:** carts are high-write, per-user, loosely consistent — a key-value model. Store in **Redis (hot) backed by DynamoDB/Cassandra** keyed by cart_id (user_id or guest cookie id). Guest cart merges into the user cart at login (union, keep max quantity). **The cart does not reserve stock** — reserving on add-to-cart lets hoarders lock inventory for days.

**Prices** are snapshotted into the order at checkout (\`unit_price\`, \`tax\`, \`discount\` on each order_item). An order must be reproducible months later even if the catalog price changed.

**Checkout API:**

| Endpoint | Notes |
|---|---|
| POST /v1/checkout/sessions | validates cart, prices, serviceability; returns sessionId + totals |
| POST /v1/orders | header Idempotency-Key; body { sessionId, paymentMethod } → 202 { orderId, status: 'PENDING_PAYMENT' } |
| GET /v1/orders/:id | poll status (or push via websocket/notification) |

**Order tables:** \`orders(order_id PK, user_id, status, total_amount, currency, idempotency_key UNIQUE, created_at)\`, \`order_item(order_id, sku_id, qty, unit_price)\`, \`inventory(sku_id, warehouse_id, on_hand, reserved)\`, \`inventory_reservation(reservation_id PK, order_id, sku_id, warehouse_id, qty, expires_at, status)\`. Shard orders by user_id (order history is per user), inventory by sku_id.`,
      keyPoints: [
        'Cart = KV store keyed by user/guest id; never reserve stock on add-to-cart.',
        'Snapshot price/tax/discount into order_item at checkout.',
        'POST /orders is idempotent via Idempotency-Key with a UNIQUE constraint.',
        'Available-to-promise = on_hand − reserved.',
      ],
    },
    {
      heading: 'E-commerce (2/2): inventory reservation and the checkout saga',
      body: `**Intuition:** checkout is a relay race across services that don't share a database — Inventory, Payment, Order, Fulfilment. If a runner drops the baton, somebody must *undo* the previous legs. That's a **saga**: a sequence of local transactions, each with a compensating action.

**Orchestrated checkout saga:**

1. **Order svc**: create order PENDING (local txn + outbox event).
2. **Inventory svc**: reserve qty per SKU with a TTL (15 min). Atomic conditional update: \`UPDATE inventory SET reserved = reserved + :q WHERE sku_id = :s AND on_hand - reserved >= :q\`. 0 rows → out of stock → compensate: cancel order.
3. **Payment svc**: authorize (hold funds) via PSP. Failure → compensate: release reservation, cancel order.
4. **Order svc**: mark CONFIRMED; **Inventory** converts reservation → committed (\`on_hand -= q, reserved -= q\`) when the warehouse picks.
5. **Capture** payment at shipment (card) or immediately (UPI/wallets, which don't support long auth holds the same way).

A **reservation expiry sweeper** (or a delayed message at TTL) releases reservations whose order never reached CONFIRMED — the saga's safety net if the orchestrator dies mid-flight.

**Hot SKU (a ₹1 deal on 1,000 phones, 500K buyers):** row-lock contention on one inventory row caps you at a few hundred to low thousands of updates/s. Options:
- **Pre-split stock into buckets** (\`sku_id, bucket 0..15\`, 1,000 units spread), pick a random bucket, fall back to others → 16x less contention.
- **Redis DECRBY gate** in front: \`DECRBY stock:sku n\`; if the result < 0, INCRBY back and reject. Only winners proceed to the DB reservation. Redis becomes a token pool; the DB remains the ledger.
- A **waiting room** (previous section) for the sale page.

**Orchestration vs choreography:** orchestration (a Temporal/Step Functions-style workflow or your own state machine table) makes the flow visible and timeouts explicit; choreography (services reacting to events) is looser but hard to reason about beyond 3–4 steps. For checkout, prefer orchestration.`,
      diagram: `      POST /orders (Idempotency-Key)
               │
               ▼
 ┌──────────────────────────┐  outbox/Kafka
 │ Checkout orchestrator    │──────────────────────────────┐
 │ state: PENDING→RESERVED→ │                              │
 │ AUTHORIZED→CONFIRMED     │                              ▼
 └──┬──────────┬────────────┘                   Notifications, analytics
    │ 1.reserve│ 2.authorize          compensations (on failure/timeout)
    ▼          ▼                      ─────────────────────────────────
Inventory   Payment ──► PSP           authorize fails → release stock
(TTL rsv)   (idempotent)              reserve fails   → cancel order
    │                                 TTL expires     → sweeper releases
    ▼
Fulfilment (commit on pick)`,
      code: [
        {
          language: 'typescript',
          title: 'Checkout orchestrator step with compensation',
          code: `type OrderState = 'PENDING' | 'RESERVED' | 'AUTHORIZED' | 'CONFIRMED' | 'CANCELLED';

interface Deps {
  orders: { transition(id: string, from: OrderState, to: OrderState): Promise<boolean> };
  inventory: { reserve(orderId: string, items: { sku: string; qty: number }[], ttlSec: number): Promise<'ok' | 'oos'>;
               release(orderId: string): Promise<void> };
  payments: { authorize(orderId: string, amountPaise: number, idemKey: string): Promise<'ok' | 'declined'> };
}

export async function runCheckout(d: Deps, orderId: string, items: { sku: string; qty: number }[], amountPaise: number) {
  // Each step is keyed by orderId, so re-running the saga after a crash is safe
  if ((await d.inventory.reserve(orderId, items, 900)) === 'oos') {
    await d.orders.transition(orderId, 'PENDING', 'CANCELLED');
    return 'OUT_OF_STOCK';
  }
  await d.orders.transition(orderId, 'PENDING', 'RESERVED');

  const auth = await d.payments.authorize(orderId, amountPaise, 'auth:' + orderId);
  if (auth === 'declined') {
    await d.inventory.release(orderId);                     // compensation
    await d.orders.transition(orderId, 'RESERVED', 'CANCELLED');
    return 'PAYMENT_DECLINED';
  }
  await d.orders.transition(orderId, 'RESERVED', 'AUTHORIZED');
  // CAS on state: if the TTL sweeper already cancelled us, this returns false
  if (!(await d.orders.transition(orderId, 'AUTHORIZED', 'CONFIRMED'))) {
    return 'NEEDS_VOID';                                    // void the auth asynchronously
  }
  return 'CONFIRMED';
}`,
        },
      ],
      keyPoints: [
        'Reserve with TTL at checkout, commit at fulfilment, release on failure/expiry.',
        'Every saga step idempotent and keyed by orderId; state transitions are CAS.',
        'Hot SKUs: bucketed stock rows or a Redis DECRBY gate in front of the DB.',
        'Prefer orchestration for checkout; choreography gets opaque past a few steps.',
      ],
    },
    {
      heading: 'Payment system (1/3): requirements, estimation and the pay-in flow',
      body: `**Scope (Ch 11):** the backend of an e-commerce site like Amazon. **Pay-in** (customer → platform, via a Payment Service Provider) and **pay-out** (platform → sellers, via a payout provider). Card data is handled by the PSP; we never store raw PANs. Non-functional: **reliability and correctness over speed**, full reconciliation, and a scale of **1M transactions/day ≈ 10 TPS** — the book stresses that 10 TPS is trivial for a DB, so the design is about *correct handling of failures*, not throughput.

**Components of the pay-in flow:**
1. **Payment service** receives the payment event (a checkout may contain several orders — one per seller — so one *payment event* has multiple *payment orders*). It runs a **risk check** (AML/fraud, usually third-party).
2. **Payment executor** executes each payment order through a **PSP** (Stripe, Razorpay, Adyen, Braintree).
3. On success, the payment service updates the **wallet** (seller balances) and the **ledger** (double-entry record).

**Hosted payment page:** the client asks our backend to *register* a payment with the PSP, passing our unique **payment_order_id as the PSP idempotency key**; the PSP returns a token; the client renders the PSP-hosted page/SDK (card data goes straight to the PSP, keeping us largely out of PCI-DSS scope); the PSP redirects back and also calls our **webhook** with the final status.

**Data model:**
- \`payment_event(checkout_id PK, buyer_info, seller_info, credit_card_info(token), is_payment_done)\`
- \`payment_order(payment_order_id PK, buyer_account, amount, currency, checkout_id, payment_order_status, ledger_updated, wallet_updated)\`
- Status enum: NOT_STARTED → EXECUTING → SUCCESS | FAILED. **Store amount as a string/decimal, never a float** — and in practice as integer minor units (paise/cents) with a currency code.

**Why an RDBMS (and not the latest NoSQL):** mature transactions, years of operational tooling, and DBAs who know it. Payments favour boring technology.`,
      diagram: `Buyer ──checkout──► Payment Service ──► Risk check (3rd party)
                       │   │
                       │   └─► payment_event / payment_order DB
                       ▼
                 Payment Executor ──register(idem=payment_order_id)──► PSP
                       │                                                │
Buyer ◄── PSP hosted payment page (card data never touches us) ◄───────┘
                       │                                                │
                       │ ◄──────────── webhook (status) ───────────────┘
                       ▼
             ┌─────────┴─────────┐
             ▼                   ▼
        Wallet svc          Ledger svc (double-entry, append-only)
                                 │
                  nightly ◄── Reconciliation ◄── PSP settlement file`,
      keyPoints: [
        '1M tx/day ≈ 10 TPS: the challenge is correctness, not scale.',
        'Payment event (checkout) fans out into payment orders (per seller).',
        'Hosted payment page keeps raw card data out of your systems.',
        'payment_order_id doubles as the PSP idempotency key.',
      ],
      source: 'Alex Xu Vol 2 — Ch 11 Payment System',
    },
    {
      heading: 'Payment system (2/3): the double-entry ledger',
      body: `**Intuition:** money is never created or destroyed inside your system — it only moves between accounts. Double-entry bookkeeping writes every movement **twice**: a debit on one account and an equal credit on another, so the sum of all entries is always zero. If it isn't, you have a bug, and you can find it.

**Example — buyer pays ₹1,000 for an order, platform fee 2%:**

| txn_id | account | debit | credit |
|---|---|---|---|
| t1 | buyer_psp_receivable | 1000 | |
| t1 | seller_42_payable | | 980 |
| t1 | platform_fee_revenue | | 20 |

Sum of debits = sum of credits = 1,000.

**Rules that interviewers probe:**
- **Append-only.** Never UPDATE or DELETE a ledger row. A refund or correction is a *new* reversing transaction. This gives an audit trail regulators and finance teams accept.
- **Balances are derived** (SUM of entries), optionally materialised in an \`account_balance\` table updated in the **same DB transaction** as the entries, with a version for optimistic concurrency.
- **Integer minor units + currency.** Multi-currency transactions go through an FX account; never add rupees to dollars.
- **Idempotent posting:** each ledger transaction has a unique external reference (payment_order_id + event type) so replaying a Kafka message cannot double-post.

**Ch 11 notes** the ledger is key for post-payment analysis (revenue, forecasting) and that wallet and ledger updates happen after the PSP confirms. In a larger org these are separate services consuming a "payment succeeded" event — which makes idempotent consumption mandatory.

**Scale:** ledgers grow forever; partition entries by time (monthly), keep hot balances in the primary, archive cold partitions to cheaper storage, and run the sum-to-zero check per partition.`,
      code: [
        {
          language: 'sql',
          title: 'Ledger schema with balanced-transaction enforcement',
          code: `CREATE TABLE ledger_txn (
  txn_id       UUID PRIMARY KEY,
  external_ref TEXT NOT NULL UNIQUE,         -- e.g. 'po_123:captured' => idempotent posting
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entry (
  entry_id   BIGSERIAL PRIMARY KEY,
  txn_id     UUID    NOT NULL REFERENCES ledger_txn(txn_id),
  account_id TEXT    NOT NULL,
  currency   CHAR(3) NOT NULL,
  amount     BIGINT  NOT NULL CHECK (amount <> 0)  -- minor units; +debit / -credit
);

-- Deferred constraint trigger: every txn must net to zero per currency at COMMIT
CREATE FUNCTION assert_balanced() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ledger_entry WHERE txn_id = NEW.txn_id
             GROUP BY currency HAVING SUM(amount) <> 0) THEN
    RAISE EXCEPTION 'unbalanced ledger txn %', NEW.txn_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER balanced AFTER INSERT ON ledger_entry
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_balanced();

-- Ledger is append-only: the application role may only INSERT and SELECT
GRANT SELECT, INSERT ON ledger_entry, ledger_txn TO payments_app;`,
        },
      ],
      keyPoints: [
        'Every txn: debits = credits; sum of all entries is zero.',
        'Append-only; corrections are reversing entries.',
        'Unique external_ref makes posting idempotent.',
        'Integer minor units + currency code, never floats.',
      ],
      source: 'Alex Xu Vol 2 — Ch 11 (double-entry ledger system)',
    },
    {
      heading: 'Payment system (3/3): idempotency, retries, webhooks and reconciliation',
      body: `**Exactly-once is built from two halves (Ch 11):** *at-least-once* execution via retries, plus *at-most-once* effect via idempotency. Together the observable effect is exactly once.

**Retry strategy:** immediate retry for connection resets, then **exponential backoff with jitter** for timeouts and 5xx, capped (e.g. 5 attempts over ~10 minutes). Non-retryable errors (card declined, invalid amount) go straight to FAILED. Poison messages go to a **dead-letter queue** for investigation; transient failures cycle through a **retry queue**.

**Idempotency at each hop:**
- **Client → us:** the client sends an \`Idempotency-Key\` header (UUID per checkout attempt). We insert it with a UNIQUE constraint *before* doing work. A duplicate returns the stored response; a concurrent duplicate (still in-flight) gets 409 so it can retry later.
- **Us → PSP:** pass payment_order_id as the PSP idempotency key/nonce so a retry after a timeout never double-charges. **A timeout is not a failure** — the charge may have succeeded. Query status or retry with the same key; never create a new payment order.
- **PSP → us (webhooks):** delivered at-least-once, possibly out of order. Verify the signature, dedupe on the PSP event id, and apply only **forward state transitions** (a late "processing" must not overwrite "succeeded").

**Reconciliation — the safety net:** every night the PSP sends a **settlement file**. A reconciliation job compares it with our ledger and payment orders. Mismatches are classified: (1) auto-fixable (we missed a webhook → mark succeeded and post ledger entry), (2) fixable by finance ops via a manual queue, (3) unexplained → escalate. Ch 11 also mentions internal reconciliation between ledger and wallet.

**Handling "payment processing" (async):** some methods (UPI collect, net banking, 3DS) stay pending for minutes. Show "processing", rely on webhooks, and run a **status poller** for orders stuck > N minutes.

**Consistency across services:** use the **outbox pattern** — write the state change and an outbox row in one transaction; a relay publishes to Kafka. This avoids "DB updated but event lost" (or the reverse).`,
      code: [
        {
          language: 'typescript',
          title: 'Idempotency-Key interceptor (NestJS, pg)',
          code: `import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Pool } from 'pg';
import { from, of, switchMap, tap } from 'rxjs';
import { createHash } from 'node:crypto';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly pool: Pool) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const key: string | undefined = req.headers['idempotency-key'];
    if (!key) return next.handle();
    // Fingerprint the body: same key + different payload is a client bug
    const fp = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    const scope = req.user.merchantId + ':' + key;          // keys are scoped per merchant

    return from(this.pool.query(
      'INSERT INTO idempotency (scope_key, fingerprint, status) VALUES ($1,$2,$3) ON CONFLICT (scope_key) DO NOTHING',
      [scope, fp, 'IN_PROGRESS'])).pipe(
      switchMap(async (ins) => {
        if (ins.rowCount === 1) return null;                    // first time: proceed
        const { rows } = await this.pool.query('SELECT * FROM idempotency WHERE scope_key = $1', [scope]);
        if (rows[0].fingerprint !== fp) throw new ConflictException('Idempotency-Key reused with different body');
        if (rows[0].status === 'IN_PROGRESS') throw new ConflictException('Request in progress, retry later');
        return rows[0].response_body;                            // replay stored response
      }),
      switchMap((cached) => cached !== null ? of(cached) : next.handle().pipe(
        tap((body) => this.pool.query(
          'UPDATE idempotency SET status = $2, response_body = $3 WHERE scope_key = $1',
          [scope, 'DONE', JSON.stringify(body)])),
      )),
    );
  }
}`,
        },
      ],
      keyPoints: [
        'Exactly-once effect = at-least-once retries + idempotency.',
        'A PSP timeout is "unknown", not "failed": retry with the same key or query status.',
        'Webhooks: verify signature, dedupe on event id, forward-only state transitions.',
        'Nightly reconciliation against settlement files is mandatory.',
      ],
      source: 'Alex Xu Vol 2 — Ch 11 (retry, idempotency, reconciliation)',
    },
    {
      heading: 'Digital wallet (1/2): 1M TPS, in-memory vs DB, and distributed transactions',
      body: `**Scope (Ch 12):** a PayPal/Paytm-style wallet supporting **balance transfers between two wallets at 1,000,000 TPS**, 99.99% reliability, transactional guarantees, and **reproducibility** — the ability to reconstruct any historical balance by replaying data.

**Estimation:** each transfer is two operations (debit + credit) → 2M ops/s. If one relational node does ~1,000 TPS of such transactions, you need **~2,000 nodes**; at 10,000 TPS per node (NVMe, tuned) ~200 nodes. That drives the rest of the design: **sharding is mandatory**, and most transfers become **cross-shard**.

**Step 1 — in-memory (Redis):** shard balances by account (partition = hash(account) % N), with a partition map in ZooKeeper. Fast, but a transfer that debits on shard A and credits on shard B isn't atomic — a crash in between loses or creates money. Not durable enough either.

**Step 2 — distributed transactions over sharded RDBMS:**

| Protocol | How it works | Pros | Cons |
|---|---|---|---|
| **2PC** | coordinator: prepare (locks held) → commit | atomic, simple for the app | blocking; locks held across the network; coordinator is a SPOF |
| **Try-Confirm/Cancel (TC/C)** | Try: debit A (reserve) → Confirm: credit B, or Cancel: refund A; each phase is its own local txn | no long-held locks; DB-agnostic | app writes compensation logic; a Cancel arriving before its Try must be handled; needs a phase status table |
| **Saga** | linear sequence of local txns, compensate in reverse on failure | simple mental model; great with an orchestrator | intermediate states visible (A debited, B not yet credited) |

Ch 12 picks between TC/C and Saga on latency: TC/C can run the "try" steps in parallel; a Saga is linear. For money, **debit first, credit second**, so an intermediate visible state is "money in flight" (held in a system-owned account), never "money created".

**The weakness of both:** they tell you *what* the balance is, but not *why* it became that — reproducibility and debugging are hard. That leads to event sourcing.`,
      code: [
        {
          language: 'typescript',
          title: 'TC/C transfer with a phase-status table (idempotent phases)',
          code: `type Phase = 'TRY_DONE' | 'CONFIRMED' | 'CANCELLED';

interface Shard {
  // Each call is ONE local ACID txn on that shard, keyed by txnId (idempotent)
  tryDebit(txnId: string, account: string, amount: bigint): Promise<'ok' | 'insufficient'>;
  confirmCredit(txnId: string, account: string, amount: bigint): Promise<void>;
  cancelDebit(txnId: string, account: string, amount: bigint): Promise<void>; // no-op if Try never ran
}
interface PhaseStore { set(txnId: string, p: Phase): Promise<void> }

export async function transfer(
  txnId: string, from: { shard: Shard; acct: string }, to: { shard: Shard; acct: string },
  amount: bigint, phases: PhaseStore,
): Promise<'done' | 'insufficient'> {
  // Try: move funds from A into a frozen/in-flight bucket on A's shard
  if ((await from.shard.tryDebit(txnId, from.acct, amount)) === 'insufficient') {
    await from.shard.cancelDebit(txnId, from.acct, amount);   // records "cancelled" so a late Try is rejected
    await phases.set(txnId, 'CANCELLED');
    return 'insufficient';
  }
  await phases.set(txnId, 'TRY_DONE');     // durable: a recovery job resumes from here after a crash
  await to.shard.confirmCredit(txnId, to.acct, amount);   // retried until success; idempotent by txnId
  await phases.set(txnId, 'CONFIRMED');
  return 'done';
}`,
        },
      ],
      keyPoints: [
        '1M TPS × 2 ops ≈ 2M ops/s → hundreds to thousands of shards.',
        '2PC holds locks across the network; TC/C and Saga use local txns + compensation.',
        'Debit first, credit second; in-flight money sits in a system account.',
        'A phase status table enables crash recovery; phases must be idempotent.',
      ],
      source: 'Alex Xu Vol 2 — Ch 12 Digital Wallet (distributed transactions)',
    },
    {
      heading: 'Digital wallet (2/2): event sourcing, CQRS and Raft-replicated state',
      body: `**Intuition:** a bank statement, not a balance field. Store every fact that happened (events) and compute balances from them. You can then answer "what was A's balance at 10:32 yesterday?" by replaying up to that point — that's **reproducibility**, which auditors love.

**Event sourcing vocabulary (Ch 12):**
- **Command** — an intent: "transfer ₹100 from A to C". May be invalid.
- **Event** — a validated fact: "A debited ₹100", "C credited ₹100". Immutable, ordered.
- **State** — balances, derived by applying events.
- **State machine** — the deterministic function: validate command → emit events; apply event → new state. Determinism is essential: **no randomness, no wall-clock reads, no I/O** inside apply, or replay diverges.

**Making it fast:** commands and events go to an append-only log (Kafka or, in Ch 12's optimised version, a local **mmap'd file** on SSD), and state lives in a **local embedded store (RocksDB)** instead of a remote DB — removing network hops. Periodic **snapshots** bound replay time.

**CQRS:** the write side publishes events; read-only projections build query views (transaction history, balances per user), possibly lagging slightly. Clients that must see their own write can poll, or the API can return the new balance from the write side.

**Reliability with Raft:** a single event-sourced node is a SPOF. Replicate the **event log** (not the state) with **Raft** across 3 or 5 nodes; the leader accepts commands, followers replay the same log and therefore hold identical state. Losing a minority of nodes loses nothing. Ch 12 composes many such Raft groups (one per partition of accounts) and uses **TC/C or Saga orchestrated across partitions** for cross-partition transfers — with the coordinator itself event-sourced.

**Pull vs push:** clients submitting a transfer get "accepted"; a reverse proxy or push channel notifies completion.`,
      diagram: `Command: transfer(A→C, 100)
      │
      ▼
┌───────────────── Raft group (partition P1) ────────────────┐
│  Leader                        Followers (x2 or x4)        │
│  validate cmd ─► append EVENTS ─► replicate log (majority) │
│        │                                                   │
│        ▼  apply (deterministic)                            │
│  State: RocksDB balances   ──► snapshot every N events     │
└────────┬───────────────────────────────────────────────────┘
         │ events (CQRS)
         ▼
 Read projections: history, balance views, analytics
 Cross-partition transfer = Saga/TC-C coordinator (also event-sourced)`,
      code: [
        {
          language: 'typescript',
          title: 'Deterministic event-sourced wallet state machine',
          code: `type Cmd = { kind: 'Transfer'; id: string; from: string; to: string; amount: bigint; ts: number };
type Evt =
  | { kind: 'Debited'; cmdId: string; acct: string; amount: bigint; ts: number }
  | { kind: 'Credited'; cmdId: string; acct: string; amount: bigint; ts: number }
  | { kind: 'Rejected'; cmdId: string; reason: string; ts: number };

export class WalletStateMachine {
  private balances = new Map<string, bigint>();
  private seen = new Set<string>();           // dedupe replayed/retried commands

  // Validation reads state only; timestamp comes FROM the command, never Date.now()
  decide(c: Cmd): Evt[] {
    if (this.seen.has(c.id)) return [];
    const bal = this.balances.get(c.from) ?? 0n;
    if (c.amount <= 0n || bal < c.amount) return [{ kind: 'Rejected', cmdId: c.id, reason: 'insufficient', ts: c.ts }];
    return [
      { kind: 'Debited', cmdId: c.id, acct: c.from, amount: c.amount, ts: c.ts },
      { kind: 'Credited', cmdId: c.id, acct: c.to, amount: c.amount, ts: c.ts },
    ];
  }

  // apply() must be pure and deterministic so every Raft replica converges
  apply(e: Evt): void {
    this.seen.add(e.cmdId);
    if (e.kind === 'Debited') this.balances.set(e.acct, (this.balances.get(e.acct) ?? 0n) - e.amount);
    if (e.kind === 'Credited') this.balances.set(e.acct, (this.balances.get(e.acct) ?? 0n) + e.amount);
  }

  balanceOf(acct: string): bigint { return this.balances.get(acct) ?? 0n; }
}`,
        },
      ],
      keyPoints: [
        'Command → validated events → state; replay gives reproducibility.',
        'apply() must be deterministic: no clock, randomness or I/O.',
        'Replicate the event log with Raft; state follows.',
        'Snapshots bound recovery; CQRS projections serve reads.',
      ],
      source: 'Alex Xu Vol 2 — Ch 12 (event sourcing, CQRS, Raft)',
    },
    {
      heading: 'Wrap-up: trade-offs across the five designs',
      body: `**How to close any of these interviews in the last 5 minutes:** summarise the invariant, the mechanism guarding it, and the failure you planned for.

| Design | Source of truth | Contention guard | Failure safety net | Scale lever |
|---|---|---|---|---|
| Hotel | Postgres (inventory + reservation co-located) | conditional UPDATE / optimistic version | idempotent reservation_id; saga around payment | shard by hotel_id; Redis read cache via CDC |
| Tickets | Postgres show_seat | Redis Lua multi-seat hold with TTL | TTL auto-release; DB guard on BOOKED | virtual waiting room; hash-tag keys per show |
| E-commerce | Postgres/MySQL orders + inventory | conditional decrement; bucketed hot SKUs | checkout saga with compensations + TTL sweeper | shard orders by user, inventory by SKU |
| Payments | RDBMS + append-only ledger | idempotency keys at every hop | retries + DLQ + nightly reconciliation | modest TPS; partition ledger by time |
| Wallet | event log (Raft-replicated) | single-writer state machine per partition | deterministic replay + snapshots | partition accounts; TC/C/Saga cross-partition |

**Recurring interview traps:**
- "Use a distributed lock" for inventory — a DB constraint or atomic conditional update is simpler and correct; locks with TTLs can expire mid-operation.
- "Kafka gives exactly-once, so payments are exactly-once" — Kafka EOS covers Kafka-to-Kafka; your PSP call is an external side effect that needs its own idempotency key.
- "Cache the inventory and decrement in cache" as the source of truth — fine as a gate, never as the ledger.
- Floats for money; mutable ledger rows; treating PSP timeouts as failures.

**India-specific depth (Flipkart/Razorpay/PhonePe interviews):** UPI payments carry a pending state and bank-side timeouts, so you need status-check APIs and reconciliation with NPCI/bank files. Card payments usually need 3DS/OTP (RBI additional-factor mandate), making "authorize" asynchronous. RBI card-on-file tokenisation means merchants store network tokens, not card numbers.`,
      keyPoints: [
        'Close with invariant → guard → safety net → scale lever.',
        'Locks and caches are helpers; the DB/ledger is the arbiter.',
        'External side effects need their own idempotency.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'design-commerce-cc-1',
      title: 'Fix the seat-hold endpoint that double-sells during an on-sale',
      context:
        'A BookMyShow-style service holds seats in Redis while users pay. During a big on-sale, support found 212 seats sold to two people, and some users lost seats they were still paying for after another user\'s "release" call.',
      task:
        'Rewrite holdSeats and releaseSeats so that a hold on N seats is all-or-nothing and atomic under concurrency, holds expire on their own, re-trying a hold is idempotent, and a release can never delete someone else\'s hold. Keep it Redis Cluster compatible.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL!);

export async function holdSeats(showId: string, seatIds: string[], userId: string) {
  // check all seats first
  for (const s of seatIds) {
    const owner = await redis.get('hold:' + showId + ':' + s);
    if (owner) return { ok: false, seat: s };
  }
  // then take them
  for (const s of seatIds) {
    await redis.set('hold:' + showId + ':' + s, userId);
    await redis.expire('hold:' + showId + ':' + s, 600);
  }
  return { ok: true };
}

export async function releaseSeats(showId: string, seatIds: string[]) {
  for (const s of seatIds) {
    await redis.del('hold:' + showId + ':' + s);
  }
}`,
      },
      hints: [
        'Between the GET loop and the SET loop, another request can take the same seat. What makes a multi-key check-and-set atomic in Redis?',
        'SET followed by EXPIRE is two commands. What happens if the process dies in between?',
        'For Redis Cluster, which keys may a single script touch, and how do you force them into one slot?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
const redis = new Redis(process.env.REDIS_URL!);

const HOLD_LUA = \`
for i = 1, #KEYS do
  local v = redis.call('GET', KEYS[i])
  if v and v ~= ARGV[1] then return {0, KEYS[i]} end
end
for i = 1, #KEYS do
  redis.call('SET', KEYS[i], ARGV[1], 'PX', ARGV[2])
end
return {1, ''}\`;

const RELEASE_LUA = \`
local n = 0
for i = 1, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then redis.call('DEL', KEYS[i]); n = n + 1 end
end
return n\`;

redis.defineCommand('holdSeats', { lua: HOLD_LUA });
redis.defineCommand('releaseSeats', { lua: RELEASE_LUA });

// {showId} hash tag => every seat key of a show lives in the same cluster slot
const key = (showId: string, seat: string) => 'hold:{' + showId + '}:' + seat;
const MAX_SEATS = 10;

export async function holdSeats(showId: string, seatIds: string[], holdId: string = randomUUID()) {
  const seats = [...new Set(seatIds)].sort();                     // dedupe, stable order
  if (seats.length === 0 || seats.length > MAX_SEATS) throw new Error('invalid seat count');
  const keys = seats.map((s) => key(showId, s));
  // holdId is per checkout attempt; retrying with the same holdId just extends the hold
  const [ok, seat] = (await (redis as any).holdSeats(keys.length, ...keys, holdId, 600_000)) as [number, string];
  return ok === 1 ? { ok: true as const, holdId, expiresInMs: 600_000 } : { ok: false as const, conflict: seat };
}

export async function releaseSeats(showId: string, seatIds: string[], holdId: string) {
  const keys = [...new Set(seatIds)].map((s) => key(showId, s));
  // Only deletes keys still owned by this holdId
  return (await (redis as any).releaseSeats(keys.length, ...keys, holdId)) as number;
}`,
      },
      explanation: `**Fixes:**
1. **Check-then-act race removed.** The Lua script runs atomically on the Redis shard, so no other client can interleave between checking and setting all N seats. It is all-or-nothing: if any seat is held by someone else, nothing is written.
2. **Atomic TTL.** \`SET key val PX ttl\` sets value and expiry together; the old SET + EXPIRE could leave a hold that never expires if the process crashed in between (a permanently "grey" seat).
3. **Ownership-checked release.** Holds store a per-attempt holdId; release deletes only keys whose value still equals it. The old code let user A's late release (after A's TTL expired and B re-held) delete B's hold, which then allowed a third user to take B's seat.
4. **Idempotent retries.** Re-running hold with the same holdId passes the ownership check and simply refreshes the TTL.
5. **Cluster-safe.** The \`{showId}\` hash tag puts all seat keys of a show in one slot, which multi-key scripts require (otherwise CROSSSLOT error).
6. **Input hygiene.** Dedupe/sort seats and cap seats per order (anti-hoarding).

Remember the DB is still the final guard: the confirm step flips \`show_seat\` to BOOKED only \`WHERE status = 'AVAILABLE'\`.`,
      followUps: [
        {
          "q": "The Redis primary for this show fails over to a replica mid on-sale, and the last few hundred holds weren't replicated. What can go wrong and how bad is it?",
          "a": "Redis replication is asynchronous, so holds acknowledged just before the failover can vanish. Another user can then hold the same seat, and two people reach payment for it. This is why the DB confirm step, `UPDATE show_seat SET status='BOOKED' WHERE ... AND status='AVAILABLE'`, is the real guard: only one wins, and the loser's payment must be voided or refunded with an apology. You can shrink the window with `WAIT 1 50` after the hold script, which blocks until one replica has the write, at a latency cost. Redis gives fast, mostly correct holds; the DB gives correctness. Monitor the count of confirm-time conflicts to spot failovers."
        },
        {
          "q": "How do you test the hold and release scripts for correctness under concurrency?",
          "a": "Run against a real Redis Cluster in Docker so CROSSSLOT and hash-tag behaviour is exercised. Tests: (1) 100 concurrent holdSeats calls for overlapping seat sets; assert every seat has exactly one owner and every successful caller owns all of its seats, none partially. (2) Hold with a 200 ms TTL, wait, then hold as a different user, then run the first user's release; assert the second hold survives. (3) Call hold twice with the same holdId; assert success and a refreshed TTL. (4) Kill the client between calls; assert keys still carry a PX TTL (`PTTL > 0`). Add a property-based test generating random hold and release sequences against a simple in-memory model."
        }
      ],
    },
    {
      id: 'design-commerce-cc-2',
      title: 'Harden a PSP webhook handler that double-credits sellers',
      context:
        'Your payment service receives "payment.succeeded" and "payment.failed" webhooks from the PSP. Finance found sellers credited twice, a few orders marked failed although the customer was charged, and a spoofed webhook from a pen-test was accepted.',
      task:
        'Rewrite the handler so it authenticates the webhook, is idempotent under at-least-once delivery, is safe against out-of-order events, and never leaves order state, ledger and outgoing events inconsistent with each other.',
      starter: {
        language: 'typescript',
        code: `import express from 'express';
import { Pool } from 'pg';
import { Kafka } from 'kafkajs';

const pool = new Pool();
const producer = new Kafka({ brokers: ['kafka:9092'] }).producer();
const app = express();
app.use(express.json());

app.post('/webhooks/psp', async (req, res) => {
  const evt = req.body;
  const orderId = evt.data.metadata.payment_order_id;
  if (evt.type === 'payment.succeeded') {
    await pool.query('UPDATE payment_order SET status = $1 WHERE id = $2', ['SUCCESS', orderId]);
    await pool.query('UPDATE wallet SET balance = balance + $1 WHERE seller_id = $2',
      [evt.data.amount, evt.data.metadata.seller_id]);
    await producer.send({ topic: 'payments', messages: [{ value: JSON.stringify(evt) }] });
  } else if (evt.type === 'payment.failed') {
    await pool.query('UPDATE payment_order SET status = $1 WHERE id = $2', ['FAILED', orderId]);
  }
  res.sendStatus(200);
});`,
      },
      hints: [
        'Where does the handler prove the request came from the PSP? What does signature verification need that express.json() throws away?',
        'The PSP will redeliver on any non-2xx or timeout. What makes the second delivery a no-op?',
        'If "failed" for an earlier attempt arrives after "succeeded", what should happen? And what if Kafka send fails after the DB commit?',
      ],
      solution: {
        language: 'typescript',
        code: `import express from 'express';
import { Pool } from 'pg';
import { createHmac, timingSafeEqual } from 'node:crypto';

const pool = new Pool({ max: 20 });
const app = express();
const SECRET = process.env.PSP_WEBHOOK_SECRET!;

function verify(raw: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const [tPart, sPart] = header.split(',');            // format: t=<unix>,v1=<hex>
  const t = Number(tPart?.split('=')[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;   // replay window
  const expected = createHmac('sha256', SECRET).update(t + '.' + raw.toString('utf8')).digest('hex');
  const got = sPart?.split('=')[1] ?? '';
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

app.post('/webhooks/psp', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verify(req.body, req.header('psp-signature'))) return res.sendStatus(400);
  const evt = JSON.parse(req.body.toString('utf8'));
  const orderId: string = evt.data.metadata.payment_order_id;
  const target = evt.type === 'payment.succeeded' ? 'SUCCESS' : evt.type === 'payment.failed' ? 'FAILED' : null;
  if (!target) return res.sendStatus(200);                       // ack events we don't handle

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // 1) Dedupe on the PSP event id (at-least-once delivery)
    const d = await c.query('INSERT INTO processed_webhook (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [evt.id]);
    if (d.rowCount === 0) { await c.query('ROLLBACK'); return res.sendStatus(200); }
    // 2) Forward-only transition: terminal states are never overwritten
    const u = await c.query(
      "UPDATE payment_order SET status = $1 WHERE id = $2 AND status IN ('NOT_STARTED','EXECUTING') RETURNING seller_id, amount",
      [target, orderId]);
    if (u.rowCount === 1 && target === 'SUCCESS') {
      const { seller_id, amount } = u.rows[0];                  // amount from OUR record, not the payload
      // 3) Double-entry ledger post, idempotent by external_ref
      await c.query('SELECT post_ledger_txn($1, $2, $3)', [orderId + ':captured', seller_id, amount]);
      // 4) Outbox row in the same txn; a relay publishes it to Kafka
      await c.query('INSERT INTO outbox (aggregate_id, type, payload) VALUES ($1, $2, $3)',
        [orderId, 'PaymentSucceeded', JSON.stringify({ orderId, sellerId: seller_id, amount })]);
    }
    await c.query('COMMIT');
    res.sendStatus(200);
  } catch (e) {
    await c.query('ROLLBACK');
    res.sendStatus(500);                                        // PSP will retry
  } finally {
    c.release();
  }
});`,
      },
      explanation: `**Fixes:**
1. **Authentication:** HMAC signature over the *raw* body plus a timestamp window blocks spoofed and replayed webhooks. express.json() discards the raw bytes, so the route uses express.raw(); comparison uses timingSafeEqual.
2. **Idempotency:** a \`processed_webhook\` row keyed by the PSP event id, inserted in the same transaction, turns redeliveries into no-ops.
3. **Out-of-order safety:** the UPDATE only moves from non-terminal states. A late "failed" (for example from an earlier attempt) cannot overwrite SUCCESS.
4. **Atomicity:** status change, ledger posting and the outbox event commit together. The old code could credit a wallet, crash before Kafka send, or send to Kafka while the DB update had failed.
5. **Ledger instead of mutable balance:** credits are a double-entry posting with a unique external_ref rather than \`balance = balance + x\`, which is non-idempotent and leaves no audit trail.
6. **Trust boundaries:** amount and seller come from our payment_order record, not from the webhook payload.
7. **Correct status codes:** 500 on failure so the PSP retries; 200 for duplicates and unknown types so the PSP stops retrying.`,
      followUps: [
        {
          "q": "The `processed_webhook` table grows by millions of rows a month. How do you keep it bounded without breaking idempotency?",
          "a": "Idempotency only needs to cover the PSP's redelivery window, which is typically up to 3 days of retries. Add a `received_at` column and partition the table by day (Postgres declarative partitioning), then drop partitions older than about 30 days, a generous multiple of the retry window. Dropping a partition is instant and avoids vacuum-heavy DELETEs. Beyond that window the forward-only status guard and the ledger's unique external_ref still prevent double effects, so a very late duplicate is harmless. Document the retention as tied to the PSP's retry policy so nobody shortens it blindly."
        },
        {
          "q": "The outbox relay publishes PaymentSucceeded to Kafka. What delivery guarantee do consumers get, and what must they do?",
          "a": "At-least-once. The relay reads unpublished outbox rows, sends them, then marks them sent; if it crashes between send and mark, the event is sent again. Consumers (fulfilment, notifications, seller payouts) must dedupe by a stable event id, the outbox row id or `orderId:PaymentSucceeded`, stored in their own DB in the same transaction as their side effect. Use orderId as the Kafka key so events for one order stay ordered within a partition. Monitor outbox lag (oldest unsent row age); if the relay stalls, payments succeed but nothing downstream happens, which is a silent failure worth paging on."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-commerce-iq-1',
      difficulty: 'hard',
      question:
        'Design the reservation backend for a hotel chain with 5,000 hotels and 1M rooms. Walk me through how you guarantee we never sell more rooms than we allow, including overbooking.',
      whatInterviewerLooksFor: [
        'Estimates write TPS and realises contention, not throughput, is the problem',
        'Models inventory per (hotel, room type, date) instead of per room',
        'Uses an atomic DB guard (constraint / conditional update / optimistic lock) rather than app-level check-then-write',
        'Makes the reservation API idempotent with a client-generated id',
        'Addresses multi-night stays and co-locating inventory with reservations',
      ],
      modelAnswer: `### Requirements and scale
Reserve room *types* for date ranges, cancel, pay; allow 10% overbooking. With 1M rooms, 70% occupancy and 3-night average stays, that's ≈ 240K reservations/day ≈ **3 TPS**. Search and detail pages are 100x more, served from cache.

### Data model
- \`room_type_inventory(hotel_id, room_type_id, date, total_inventory, total_reserved)\`, PK on all three keys, pre-populated about 2 years ahead (≈ 73M rows).
- \`reservation(reservation_id PK, …, status)\` where **reservation_id is generated when the order page renders**, so double-clicks and retries resend the same id.

### Guarding the invariant
In one transaction:
1. \`INSERT reservation … ON CONFLICT DO NOTHING\`. If 0 rows, it's a duplicate: return the existing one.
2. \`UPDATE room_type_inventory SET total_reserved = total_reserved + 1 WHERE hotel_id=… AND room_type_id=… AND date >= :in AND date < :out AND total_reserved + 1 <= floor(total_inventory * 1.1)\`.
3. If rowCount ≠ nights, roll back and return sold out.

The check and the increment happen in one statement under the row lock, so there's no race window. Optimistic locking with a version column also works well at 3 TPS; pessimistic SELECT FOR UPDATE works too but must lock dates in a consistent order to avoid deadlocks.

### Architecture
Hotel/Rate services are cache-heavy. The Reservation service **owns both tables in one DB**, so booking is a local ACID transaction, not 2PC. Payment is a saga step: pending → paid, or a timeout releases the inventory.

### Scale-out
Shard by hotel_id (a booking never crosses hotels). A Redis availability cache fed by CDC serves search. It may be stale, but the DB decides.`,
      followUps: [
        {
          q: 'A single luxury hotel launches a ₹1 promo for one night; 50K people try in a minute. What breaks?',
          a: 'One inventory row becomes the bottleneck. Optimistic retries spin, so use the conditional UPDATE (no retries), put a Redis DECR gate or waiting room in front, and cap requests per user. Most requests should fail fast before touching the DB.',
        },
        {
          q: 'How do you handle a guest changing dates on an existing reservation?',
          a: 'In one transaction, increment inventory for the new dates (conditional) and decrement for the old ones. If the new dates are full, the whole change rolls back and the original booking stands.',
        },
        {
          q: 'Why not use a distributed lock on (hotel, roomType)?',
          a: 'It adds a dependency and TTL-expiry hazards (the lock expires during a GC pause) while the DB already provides atomicity. The lock also doesn\'t make the write itself correct.',
        },
      ],
      pitfalls: [
        'Modelling one row per physical room and searching for a free one under lock',
        'Reading availability, checking in app code, then writing (a classic race)',
        'Proposing 2PC between a separate inventory service and reservation service',
        'Ignoring idempotency for double-clicks',
      ],
    },
    {
      id: 'design-commerce-iq-2',
      difficulty: 'expert',
      question:
        'Tickets for a stadium concert (60K seats) go on sale at 12:00; we expect 3M users. Design seat selection and booking so the site stays up and no seat is sold twice.',
      context: 'Interviewer at a Ticketmaster/BookMyShow-style company; they will push on the flash-crowd and bots.',
      whatInterviewerLooksFor: [
        'Recognises the constraint is seats (inventory), not compute — admission control over autoscaling',
        'Virtual waiting room with signed, gateway-enforced tokens',
        'Atomic multi-seat hold with TTL (Redis Lua or DB conditional update)',
        'DB as final arbiter on confirm; idempotent payment flow',
        'Bot mitigation and fairness',
      ],
      modelAnswer: `### Shape of the load
3M users × ~20 seat-map refreshes over 10 minutes ≈ 100K QPS of reads; hold attempts ≈ 15K/s, concentrated on the best seats. The system *cannot* satisfy most users — so the goal is to fail them **fast and fairly**, not to scale the booking core to 3M.

### 1. Virtual waiting room
- Pre-sale landing on a CDN-served page. At 12:00 each user gets a random position among early arrivals (defeats millisecond bots), then FIFO.
- An admission controller advances an \`admitted\` pointer by N/s based on booking-service p99 and remaining seats.
- Admitted users receive an **HMAC/JWT token** bound to user+event (15-min TTL). The gateway rejects booking calls without it.
- Stop admitting (and tell the queue) once available + held seats reach zero.

### 2. Seat map
Served from a Redis bitmap/hash per section, pushed via SSE or polled every 2–3 s. Staleness is acceptable because holds are checked atomically.

### 3. Holds
Lua script over \`hold:{event}:{seat}\` keys (one hash slot per event, or per section for big venues): all-or-nothing \`SET … PX 600000\` with a holdId. Release is compare-and-delete. Max 6 seats per user.

### 4. Confirm
Payment with an idempotency key = bookingId. On success, in one DB txn: \`UPDATE show_seat SET status='BOOKED', booking_id=… WHERE seat_id IN (…) AND status='AVAILABLE'\`; require rowCount = N. Otherwise refund. A late payment after hold expiry goes through the same check.

### 5. Abuse
One active hold per account, phone-verified accounts, CAPTCHA at queue entry, device fingerprinting.

### Trade-offs
Redis holds are fast but not durable. If a Redis shard fails, holds are lost (users re-select); the DB still prevents double sale.`,
      followUps: [
        {
          q: 'A single hash slot per event means one Redis shard takes all 15K holds/s. Is that OK?',
          a: 'One Redis shard does ~100K simple ops/s, so the Lua scripts (a few ops each) fit. For bigger venues, hash-tag per section so the load spreads, and limit a hold to one section.',
        },
        {
          q: 'How do you show "3,000 seats left" accurately?',
          a: 'Keep a counter decremented on booking confirm (and optionally on holds) and publish it periodically. It is approximate by design; exact counts at 100K QPS are not worth the cost.',
        },
        {
          q: 'Payment succeeds but the seat was already booked because the hold expired. Now what?',
          a: 'The confirm txn fails the AVAILABLE check, so auto-refund or void the auth, and offer alternatives. That\'s why the hold TTL should exceed the payment timeout plus a margin.',
        },
      ],
      pitfalls: [
        'Autoscaling as the answer to a flash crowd',
        'Holding seats in the DB with SELECT FOR UPDATE for 10 minutes',
        'Waiting room that is only UI (the API is still callable directly)',
        'Separate GET-then-SET per seat',
      ],
    },
    {
      id: 'design-commerce-iq-3',
      difficulty: 'hard',
      question:
        'Design checkout for an e-commerce marketplace. When exactly do you reserve inventory, and what happens if payment fails or the user just closes the tab?',
      whatInterviewerLooksFor: [
        'Does not reserve on add-to-cart; reserves at checkout with TTL',
        'Orchestrated saga with explicit compensations and state machine',
        'Idempotent order creation and payment authorization',
        'Handles orphaned reservations (sweeper / delayed message)',
        'Hot SKU contention strategy',
      ],
      modelAnswer: `### Principles
The cart is a wish list: it doesn't reserve stock, because hoarding would kill conversion for everyone else. Inventory is **reserved at "Place order"** with a TTL (~15 min) and **committed at fulfilment**.

### Flow (orchestrated saga)
1. \`POST /orders\` with an Idempotency-Key → create order PENDING plus an outbox event, snapshotting prices.
2. **Reserve:** per SKU, \`UPDATE inventory SET reserved = reserved + q WHERE sku = s AND on_hand - reserved >= q\` and insert \`inventory_reservation(order_id, sku, qty, expires_at)\`. Any SKU fails → release the others and cancel.
3. **Authorize payment** with key = orderId. Declined → release reservation, cancel. Timeout → status unknown, so query the PSP. Don't cancel blindly.
4. **Confirm:** CAS the order from AUTHORIZED to CONFIRMED. Capture on shipment for cards; UPI is captured immediately and refunded on cancellation.

### User closes the tab
Nothing is lost: the orchestrator keeps driving the state machine server-side. If payment never completes, a **delayed message at expires_at** (or a sweeper scanning \`expires_at < now() AND status='ACTIVE'\`) releases stock and cancels the order. The CAS prevents a late payment success from confirming a cancelled order; that case triggers an auto-refund.

### Hot SKUs
For lightning deals, split stock across 10–20 bucket rows or gate with Redis DECRBY so losers are rejected before reaching the DB; add a waiting room for the deal page.

### Numbers
600 orders/s at peak × 3 SKUs = 1.8K reservations/s. That's fine for a sharded DB as long as no single row is hot.`,
      followUps: [
        {
          q: 'Why orchestration instead of choreography here?',
          a: 'Checkout has timeouts, compensations and a user waiting. An orchestrator makes the state explicit and debuggable. Choreographed events spread that logic across services and make "where is order X stuck?" hard.',
        },
        {
          q: 'Multi-seller order: seller A has stock, seller B doesn\'t. What do you do?',
          a: 'It\'s a product decision. Either fail the whole order, or split into per-seller sub-orders (Ch 11: one payment event, multiple payment orders) and let the user proceed with partial fulfilment.',
        },
        {
          q: 'How do you make the reservation step idempotent?',
          a: 'Use a unique (order_id, sku) on inventory_reservation. A retried reserve finds the existing row and returns success without incrementing reserved again.',
        },
      ],
      pitfalls: [
        'Reserving stock on add-to-cart',
        'Decrementing on_hand directly at checkout (no way to release cleanly)',
        'Treating a payment timeout as a failure and releasing stock',
        'No mechanism for abandoned checkouts',
      ],
    },
    {
      id: 'design-commerce-iq-4',
      difficulty: 'expert',
      question:
        'Your payment service called the PSP to charge ₹4,999, and the call timed out after 10 seconds. What does your system do next, and how do you guarantee the customer is charged exactly once?',
      whatInterviewerLooksFor: [
        'Treats a timeout as unknown, not failed',
        'Idempotency key passed to PSP; retries reuse it',
        'Status query / webhook reconciliation',
        'Retry policy with backoff, jitter, cap and DLQ',
        'Nightly reconciliation as the final net',
      ],
      modelAnswer: `### Principle
A timeout means **"unknown"**. The PSP may have charged the card. Exactly-once is *at-least-once attempts* plus *idempotent effect*.

### What happens
1. Before calling the PSP we persisted \`payment_order(id, status=EXECUTING)\`. The call carries **payment_order_id as the PSP idempotency key**.
2. On timeout, keep the order EXECUTING and schedule a retry with exponential backoff and jitter (1s, 2s, 4s… cap ~5 attempts). Each retry uses the **same key**, so the PSP returns the original outcome instead of charging again.
3. In parallel we may call the PSP's *retrieve payment* API by our reference. Many PSPs support lookup by merchant order id.
4. The PSP's **webhook** will also arrive (at-least-once). We dedupe on event id and apply forward-only transitions.
5. Terminal outcome → update payment_order, post the **double-entry ledger** transaction (unique external_ref), credit the seller wallet, and emit an outbox event. All in one DB transaction.
6. Still unknown after the retry budget → park it in a "needs attention" queue. **Don't** mark it failed and let the user pay again with a new order id (that's the classic double charge).

### The client side
The browser/app also sends an Idempotency-Key per checkout attempt, so a user double-tapping "Pay" hits the same payment_order.

### Final net
The nightly **reconciliation** compares the PSP settlement file with the ledger. It catches missed webhooks (auto-fix), amount mismatches (finance queue) and orphan charges (refund).

### Numbers
At 10 TPS and 0.1% timeouts, that's ~860 unknowns/day. Almost all resolve via retry or webhook within minutes.`,
      followUps: [
        {
          q: 'The PSP does not support idempotency keys. Now what?',
          a: 'Before retrying, query by our unique order reference. If the PSP can\'t do that either, don\'t auto-retry. Wait for the webhook or reconciliation, then refund duplicates. You could also route traffic to a PSP that supports keys.',
        },
        {
          q: 'How long do you keep idempotency keys?',
          a: 'At least as long as clients or PSPs may retry, typically 24h to 7 days for API keys. Payment order ids are permanent anyway.',
        },
      ],
      pitfalls: [
        'Marking the payment failed on timeout',
        'Generating a new idempotency key per retry',
        'Relying on Kafka exactly-once for an external HTTP side effect',
        'No reconciliation',
      ],
    },
    {
      id: 'design-commerce-iq-5',
      difficulty: 'hard',
      question:
        'Design the ledger for a marketplace\'s payment platform. Finance says the numbers must always reconcile. How do you store money movements, and how would you detect a bug that silently creates money?',
      whatInterviewerLooksFor: [
        'Double-entry, append-only, integer minor units',
        'Balanced-transaction enforcement at write time',
        'Derived vs materialised balances and their consistency',
        'Idempotent posting and reversals for corrections',
        'Internal and external reconciliation checks',
      ],
      modelAnswer: `### Model
- \`ledger_txn(txn_id, external_ref UNIQUE, created_at)\` and \`ledger_entry(txn_id, account_id, currency, amount)\` with signed integer minor units (+debit / −credit).
- **Invariant:** for every txn and currency, SUM(amount) = 0. It's enforced by a deferred constraint trigger (or by the posting service building balanced entries and verifying before commit).
- **Append-only:** the app role has INSERT/SELECT only. Refunds, chargebacks and corrections are **reversing transactions** referencing the original.

### Accounts
Buyer receivable at PSP, seller payable, platform fee revenue, PSP fees expense, refunds, FX clearing. Example capture: debit psp_receivable 1000, credit seller_payable 980, credit fee_revenue 20.

### Balances
Derived by SUM, materialised in \`account_balance(account_id, balance, version)\`, updated **in the same transaction** as the entries. Paginated statements come from entries.

### Idempotency
external_ref = \`payment_order_id:event\`, so Kafka redeliveries or retries can't double-post.

### Detecting "created money"
1. **Global zero check:** SUM(amount) over all entries must equal 0 (run it per partition and day).
2. **Materialised vs derived:** recompute balances from entries nightly and diff against account_balance.
3. **External reconciliation:** the PSP settlement file vs psp_receivable movements; bank statement vs payout accounts.
4. **Alerting** on any non-zero result, with drill-down by txn.

### Scale
Partition entries by month. With 1M txns/day × ~3 entries, that's ~1B rows/year, which is manageable in Postgres with partitioning; archive old partitions.`,
      followUps: [
        {
          q: 'Why integer minor units instead of DECIMAL?',
          a: 'Both work. Integers avoid rounding surprises in application code and are fast. You must know each currency\'s exponent (JPY 0, INR 2, KWD 3). Never use floats.',
        },
        {
          q: 'Would you use a specialised ledger DB (e.g. TigerBeetle) instead?',
          a: 'It\'s worth it at very high TPS with simple debit/credit semantics. For 10–1,000 TPS, Postgres gives flexibility and tooling. Mention it as a scale path.',
        },
      ],
      pitfalls: [
        'Single-entry "balance += amount" updates',
        'Allowing UPDATE of ledger rows to fix mistakes',
        'Floats for money',
        'Balances maintained outside the entry-writing transaction',
      ],
    },
    {
      id: 'design-commerce-iq-6',
      difficulty: 'expert',
      question:
        'Design a digital wallet (Paytm/PayPal balance) that supports 1M peer-to-peer transfers per second with no money lost or created, and the ability to reconstruct any account\'s balance at any past time.',
      whatInterviewerLooksFor: [
        'Estimates node count and concludes sharding + cross-shard transfers are inevitable',
        'Compares 2PC, TC/C and Saga with concrete failure behaviour',
        'Proposes event sourcing for reproducibility, with deterministic state machines',
        'Replicates the log with Raft; snapshots; CQRS reads',
        'Ordering and idempotency of commands',
      ],
      modelAnswer: `### Sizing
1M transfers/s × 2 balance updates = 2M ops/s. A relational node doing ~1–10K such txns/s means **200–2,000 shards**, so nearly every transfer is cross-shard.

### Option A: sharded RDBMS + distributed txn
- **2PC:** atomic, but locks are held through two network round-trips, and a coordinator failure blocks participants. Latency and availability suffer at this scale.
- **TC/C:** Try = debit A into a frozen bucket (local txn), Confirm = credit B, Cancel = unfreeze A. No cross-shard locks; phases are idempotent by txnId and tracked in a phase table for recovery. You have to handle a Cancel that arrives before its Try (an "empty rollback").
- **Saga:** debit A, then credit B; the compensation re-credits A. It's simple and linear. The in-flight state is visible, so debit first.

### Option B: event sourcing (Ch 12)
- Commands (transfer requests) are validated by a **deterministic state machine** into events (Debited/Credited). Events are appended to an immutable log, and state (balances) is derived.
- **Reproducibility:** replay events to any timestamp. That's exactly the audit requirement.
- **Performance:** log on local SSD (mmap), state in local RocksDB, periodic snapshots. That's ~100K+ events/s per partition.
- **Reliability:** each partition is a **Raft group** (3–5 nodes) replicating the event log, and followers apply the same events to get identical state.
- **Cross-partition transfers:** a TC/C or Saga coordinator, itself event-sourced, sends debit and credit commands to the two partitions.
- **Reads:** CQRS projections (history, balance views) fed by the events.

### Guarantees
Command ids dedupe retries, a single leader per partition orders commands, and determinism (no clock or randomness inside apply) keeps replicas and replays identical.

### Trade-off
This design is more complex and needs event versioning and replay tooling. For 10K TPS a sharded Postgres with Sagas is the pragmatic answer.`,
      followUps: [
        {
          q: 'A Raft leader crashes after appending a debit but before replicating. Is money lost?',
          a: 'An entry is committed only once a majority has it. An uncommitted entry is dropped by the new leader, and the client (who never got success) retries with the same command id. Dedupe makes the retry safe.',
        },
        {
          q: 'How do you evolve the event schema over 5 years?',
          a: 'Version events, write upcasters that transform old versions on read, never mutate stored events, and keep the replay tests.',
        },
        {
          q: 'How does a client learn its transfer completed?',
          a: 'The API accepts asynchronously and returns a txnId. The client polls status or receives a push. The API can also block until the Raft commit for single-partition transfers.',
        },
      ],
      pitfalls: [
        'Redis as the source of truth for balances',
        '2PC across hundreds of shards at 1M TPS without discussing blocking',
        'Non-deterministic apply functions (Date.now, random ids)',
        'Crediting before debiting in a saga',
      ],
    },
    {
      id: 'design-commerce-iq-7',
      difficulty: 'medium',
      question:
        'After a deploy, finance reports that about 0.2% of UPI payments are marked FAILED in our system but show as successful in the bank settlement file. Customers are being asked to pay again. How do you investigate and fix this, short and long term?',
      context: 'Production incident framing, common in Razorpay/PhonePe/Paytm rounds.',
      whatInterviewerLooksFor: [
        'Hypothesises timeout-as-failure or out-of-order webhook bugs',
        'Immediate mitigation: stop marking FAILED on timeout, refund or reconcile duplicates',
        'Forward-only state machine, status polling, reconciliation',
        'Monitoring and alerting on mismatch rate',
      ],
      modelAnswer: `### Likely root causes
1. **Timeout treated as failure:** the deploy lowered a client timeout (e.g. 30s → 5s), and UPI calls that are still pending at the bank or NPCI get marked FAILED.
2. **Out-of-order events:** a "PENDING/FAILED" callback arriving after "SUCCESS" overwrites it because the update isn't forward-only.
3. **Webhook handler errors** after the deploy (a signature or parse change) → callbacks dropped, and a fallback job marks stale orders FAILED.

### Investigate
Correlate the mismatched payment ids with gateway logs: request latency, callback receipt, status history. Check the deploy diff for timeouts and the state-transition code. Plot the mismatch rate before and after the deploy.

### Short term
- Roll back or hotfix. Treat timeouts as **PENDING** and use a status-check API with backoff.
- Run reconciliation now: for mismatched orders, mark them SUCCESS, post the ledger entries, fulfil the orders, and **auto-refund the second payment** where customers paid twice.
- Communicate with the affected customers.

### Long term
- Payment state machine with **forward-only transitions**: PENDING → SUCCESS/FAILED, and FAILED can't be set if a success callback has been seen. Late success after FAILED raises a "late success" flow (auto-refund or revive).
- Don't allow re-payment for an order while a previous attempt is PENDING; show "processing".
- Reconciliation multiple times a day (not only nightly) for UPI, plus **alerts** when the mismatch rate goes above 0.01%.
- Contract tests for the webhook handler; canary deploys with a mismatch-rate SLO as a guardrail.`,
      followUps: [
        {
          q: 'Why is UPI especially prone to this?',
          a: 'It\'s a multi-party flow (PSP app, NPCI, remitter bank, beneficiary bank) with asynchronous callbacks and "deemed" or pending states that can resolve minutes later, so intermediate timeouts are common.',
        },
        {
          q: 'How do you prevent the customer from paying twice while status is unknown?',
          a: 'Lock the order to one active attempt, show a processing screen with polling, and only allow a new attempt after a terminal failure confirmed by a status check.',
        },
      ],
      pitfalls: [
        'Blaming the bank without evidence',
        'Manual fixes without a repeatable reconciliation job',
        'Not refunding double payments proactively',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-commerce-boe-1',
      question:
        'Estimate the storage and write QPS for the room_type_inventory and reservation tables of a hotel platform with 50,000 hotels (not the 5,000 in the book), and decide whether you need sharding.',
      assumptions: [
        '50,000 hotels × 20 room types on average',
        'Inventory rows pre-created for 2 years (730 days)',
        'Row size ≈ 60 bytes of data + ~40 bytes overhead/index ≈ 100 bytes',
        '10M rooms total, 70% occupancy, 3-night average stay',
        'Reservation row ≈ 300 bytes; keep 5 years',
        'Peak = 5× average',
      ],
      steps: [
        { label: 'Inventory rows', calc: '50,000 × 20 × 730 = 730M rows' },
        { label: 'Inventory size', calc: '730M × 100 B ≈ 73 GB (+ indexes ≈ 100–150 GB)' },
        { label: 'Reservations per day', calc: '10M × 0.7 ÷ 3 ≈ 2.33M/day' },
        { label: 'Booking TPS', calc: '2.33M ÷ 86,400 ≈ 27 TPS avg; peak ×5 ≈ 135 TPS; each touches ~3 inventory rows → ~400 row updates/s' },
        { label: 'Reservation storage', calc: '2.33M × 365 × 5 × 300 B ≈ 1.3 TB over 5 years' },
      ],
      answer:
        'About 100–150 GB of inventory and ~1.3 TB of reservations over 5 years, with ~135 booking TPS at peak. One well-provisioned Postgres primary can handle the write rate. Sharding by hotel_id (e.g. 8 shards) is justified for storage growth, failure isolation and read replicas per shard rather than raw TPS.',
      insight:
        'Commerce write rates are small. Shard for data size and blast radius, and pick the shard key (hotel_id) so each booking stays a single-shard ACID transaction. Put effort into search caching, which is 100–1,000× the booking rate.',
      followUps: [
        {
          "q": "Product wants room-level inventory (specific room numbers) instead of per room type. Redo the storage estimate.",
          "a": "Rows grow from hotel × room type × date to room × date: 10M rooms × 730 days = 7.3B rows. At 100 bytes that is about 730 GB before indexes, roughly 1–1.5 TB with them, 10× the room-type model. Write rates do not grow much, since a booking still touches about 3 rows, but searches now have to find any free room of a type across many rows. That is a strong reason to keep room-type counters for availability and assign specific rooms late (at check-in or a day before), which is what most hotel systems do. If room-level is mandatory, sharding by hotel_id moves from optional to required."
        },
        {
          "q": "Search traffic is 1,000× the booking peak. What does that mean for the read path?",
          "a": "1,000 × 135 TPS = 135K search QPS, far beyond one Postgres. Do not serve search from room_type_inventory. Precompute an availability index per (city, date range) in Elasticsearch or a Redis cache, updated from inventory change events (CDC), and accept seconds of staleness; the booking transaction re-checks availability on the primary anyway, so a stale \"available\" only causes an occasional \"sorry, just sold out\". Cache hotel detail pages at the CDN. Size the cache by hot data: the next 90 days for popular cities covers most queries. The write store stays small and simple while the read side scales horizontally."
        }
      ],
    },
    {
      id: 'design-commerce-boe-2',
      question:
        'A cricket final on-sale: 80,000 seats, 4M users arrive in the first 5 minutes. Size the virtual waiting room admission rate and the Redis hold capacity.',
      assumptions: [
        'Each admitted user spends ~4 minutes selecting and paying',
        'Average 3 seats per booking; 70% of admitted users complete a booking',
        'Booking core comfortably handles 3,000 concurrent shoppers (from load test)',
        'Each shopper makes ~1 hold attempt per 20 s and ~1 seat-map refresh per 5 s',
        'Waiting page polls every 10 s',
      ],
      steps: [
        { label: 'Bookings needed to sell out', calc: '80,000 ÷ 3 ≈ 26,700 bookings' },
        { label: 'Admissions needed', calc: '26,700 ÷ 0.7 ≈ 38,000 admitted users' },
        { label: 'Admission rate (Little\'s law)', calc: 'concurrency 3,000 ÷ 4 min per user = 750 users/min ≈ 12.5/s' },
        { label: 'Time to sell out', calc: '38,000 ÷ 750 ≈ 51 minutes' },
        { label: 'Hold QPS at the core', calc: '3,000 ÷ 20 s = 150 hold scripts/s; seat-map reads 3,000 ÷ 5 = 600 QPS' },
        { label: 'Waiting-room polling', calc: '4M ÷ 10 s = 400K QPS → must be CDN/edge-served or SSE, not the origin' },
      ],
      answer:
        'Admit ~12–13 users/s (750/min) to keep 3,000 concurrent shoppers. The core then sees only ~150 hold ops/s and ~600 seat-map QPS, which one Redis shard and a small service fleet handle easily. The waiting room itself must absorb ~400K QPS of polling at the edge. The event sells out in ~50 minutes, so ~3.96M users should be told early that it is sold out.',
      insight:
        'The waiting room shrinks the core problem by more than 1,000×. The real engineering is at the edge (polling, token issue), and the admission rate is a single tunable driven by core concurrency. Raising concurrency (more admitted users) sells out faster but needs the core load-tested at that level.',
      followUps: [
        {
          "q": "After a load test the core handles 6,000 concurrent shoppers. What changes in the plan, and what new risk appears?",
          "a": "By Little's law admission doubles to 6,000 ÷ 4 min = 1,500 users/min (25/s), and sell-out time halves to about 38,000 ÷ 1,500 ≈ 25 minutes. Core load doubles to about 300 hold ops/s and 1,200 seat-map QPS, still trivial for Redis. The new risk is contention, not capacity: twice as many people pick from a shrinking pool, so hold conflicts rise sharply near the end, and users see \"seat taken\" repeatedly. Mitigate with best-available auto-assignment, seat-map refresh after conflicts, and lowering admission once remaining inventory drops below a threshold."
        },
        {
          "q": "The CDN bill for 400K polling QPS is a concern. How would you reduce it?",
          "a": "Poll less and smarter. Positions far back in the queue cannot change much, so make the poll interval proportional to position: 60 s for someone 2M places back, 5 s for the next 10K. At a uniform 60 s, 4M users generate 4M ÷ 60 ≈ 67K QPS instead of 400K. Serve a small, cacheable \"current admitted cursor\" JSON from the edge with a 1–2 s TTL so every client computes its own status locally from its signed position. Alternatively use SSE from edge workers for the head of the queue. Once sold out, publish a single \"sold out\" flag that ends polling for everyone."
        }
      ],
    },
    {
      id: 'design-commerce-boe-3',
      question:
        'For a digital wallet targeting 1M transfers/s, estimate the number of partitions (Raft groups) and servers for an event-sourced design, and the event log storage per day.',
      assumptions: [
        'Each transfer produces 2 events (debit, credit) ≈ 200 bytes each incl. metadata',
        '80% of transfers are cross-partition, needing an extra ~2 coordinator events',
        'One partition leader sustains ~50K events/s (mmap log + RocksDB, batched Raft)',
        'Raft groups have 3 replicas; ~4 partition replicas co-hosted per server',
      ],
      steps: [
        { label: 'Events per second', calc: '1M × 2 = 2M account events/s + 0.8M × 2 = 1.6M coordinator events/s ≈ 3.6M events/s' },
        { label: 'Partitions', calc: '3.6M ÷ 50K ≈ 72 → round to 128 partitions for headroom and hot accounts' },
        { label: 'Replicas / servers', calc: '128 × 3 = 384 replicas ÷ 4 per server ≈ 96 servers (~100)' },
        { label: 'Log bytes per second', calc: '3.6M × 200 B ≈ 720 MB/s primary; ×3 replication ≈ 2.2 GB/s cluster-wide' },
        { label: 'Log per day', calc: '720 MB/s × 86,400 ≈ 62 TB/day (186 TB with replicas) → snapshot + tier to object storage' },
      ],
      answer:
        'Around 128 partitions on ~100 servers, generating ~62 TB/day of events (186 TB replicated). That is why snapshots and moving older log segments to object storage are part of the design, not an afterthought.',
      insight:
        'At this scale the event log storage growth, not CPU, drives cost and operations. Also, cross-partition transfers nearly double event volume, so partitioning accounts to keep frequent counterparties together (e.g. merchant-heavy flows) has real value.',
      followUps: [
        {
          "q": "Ops wants 7 days of the event log on local disk for fast recovery, with 4× compression. How much disk per server?",
          "a": "Primary log is about 62 TB/day; at 4× compression that is 15.5 TB/day, so 7 days is about 108 TB, and with 3 replicas about 326 TB. Spread across ~100 servers, that is roughly 3.3 TB per server, which fits on local NVMe with room for RocksDB state and snapshots. Older segments go to object storage. Recovery then needs only the latest snapshot plus the tail of the log since that snapshot, so snapshot frequency (e.g. every few minutes) decides recovery time more than retention does."
        },
        {
          "q": "A large merchant receives 5% of all transfers. What happens to its partition, and how do you fix it?",
          "a": "5% of 1M transfers/s is 50K credit events/s to one account, which alone saturates a partition leader rated at ~50K events/s and starves every other account co-located there. Split the merchant into N sub-accounts (e.g. 16, about 3.1K events/s each) spread across partitions, route each incoming transfer to a sub-account by hashing the payer, and compute the merchant's balance as the sum of the sub-accounts. Credits never need a balance check, so this split is safe. Debits (payouts) need a sweep that consolidates sub-accounts first. Detect hot accounts automatically from per-account event rates."
        }
      ],
    },
  ],
  test: [
    {
      id: 'design-commerce-mcq-01',
      difficulty: 'expert',
      question:
        'Two users book the last room for the same night at the same time using this optimistic-locking code under READ COMMITTED. What is the outcome?',
      code: {
        language: 'typescript',
        code: `const { rows: [inv] } = await db.query(
  'SELECT total_reserved, total_inventory, version FROM room_type_inventory WHERE hotel_id=$1 AND room_type_id=$2 AND date=$3',
  [h, rt, d]);
if (inv.total_reserved + 1 > inv.total_inventory) throw new SoldOut();
const r = await db.query(
  'UPDATE room_type_inventory SET total_reserved = total_reserved + 1, version = version + 1 WHERE hotel_id=$1 AND room_type_id=$2 AND date=$3 AND version=$4',
  [h, rt, d, inv.version]);
if (r.rowCount === 0) throw new RetryableConflict();`,
      },
      options: [
        'One UPDATE succeeds; the second blocks on the row lock, re-evaluates version = 7 against the new version 8, matches 0 rows and gets RetryableConflict. On retry it sees the room is full and throws SoldOut',
        'Both succeed, because READ COMMITTED lets both SELECTs see version 7 and both UPDATEs commit',
        'Both fail with a serialization error, because optimistic locking needs SERIALIZABLE',
        'The second UPDATE deadlocks with the first because both read the row before writing',
      ],
      correct: [0],
      explanation:
        'In Postgres READ COMMITTED, the second UPDATE waits for the first transaction\'s row lock, then re-checks its WHERE clause against the newly committed row version. version is now 8, so 0 rows are updated. The app retries, re-reads, and hits SoldOut. Both cannot succeed, because the version predicate is re-evaluated. No SERIALIZABLE is needed, since the version check is the guard. Plain SELECTs take no locks, so there is no deadlock.',
      followUps: [
        {
          "q": "Now it's New Year's Eve and 500 users hit the same (hotel, room type, date) row at once. What happens to this optimistic-locking loop, and what would you change?",
          "a": "Optimistic locking degrades badly under high contention: every round only one UPDATE wins and the other 499 get RetryableConflict, re-read and collide again, so you burn O(n²) queries and p99 explodes. Replace read-then-CAS with a single conditional UPDATE: `SET total_reserved = total_reserved + 1 WHERE ... AND total_reserved + 1 <= total_inventory`. Each request then queues on the row lock once and either succeeds or fails cleanly with rowCount = 0, without any retry loop. Cap retries (e.g. 3 with jitter) wherever you keep CAS, and put admission control in front of truly hot rows."
        },
        {
          "q": "How would you prove in a test that this code never oversells?",
          "a": "Write a concurrency test against a real Postgres (Testcontainers), not a mock. Seed total_inventory = 10, fire 200 parallel booking calls with `Promise.all` across a pool of at least 20 connections, then assert three things: exactly 10 successes, 190 SoldOut or exhausted-retry results, and `total_reserved = 10` in the row, matching the count of reservation rows. Run it in a loop of 50–100 iterations, because races are probabilistic. Add a variant that injects a delay between the SELECT and the UPDATE so the race window is forced open. In production, a nightly invariant check that compares `total_reserved` with COUNT(reservations) per row catches drift."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-02',
      difficulty: 'hard',
      question:
        'A 3-night stay (dates D1–D3) runs a single conditional UPDATE over the date range. D2 is full. The UPDATE reports rowCount = 2. What should the service do?',
      code: {
        language: 'sql',
        code: `UPDATE room_type_inventory
SET total_reserved = total_reserved + 1
WHERE hotel_id = $1 AND room_type_id = $2
  AND date >= $3 AND date < $4               -- 3 nights
  AND total_reserved + 1 <= FLOOR(total_inventory * 1.1);`,
      },
      options: [
        'Commit, and mark the reservation as partially confirmed for D1 and D3',
        'Commit, then run a compensating UPDATE decrementing D1 and D3',
        'Roll back the whole transaction and return sold out, because rowCount must equal the number of nights',
        'Retry the same UPDATE until rowCount = 3, because D2 will free up when other pending reservations expire',
      ],
      correct: [2],
      explanation:
        'The UPDATE incremented D1 and D3 but skipped D2, so the booking is invalid. Rolling back undoes both increments atomically. Committing a partial stay is not a valid product state. Committing and then compensating opens a window where D1 and D3 are wrongly unavailable, and it adds a crash risk. Blind retries re-increment D1 and D3 each time the transaction is retried, and the capacity may never free up.',
      followUps: [
        {
          "q": "Product now wants to offer \"book D1 and D3 and waitlist D2\" instead of failing. How does that change the data model and this transaction?",
          "a": "A partial stay becomes a first-class product state, so model it explicitly. Split the reservation into reservation_night rows with a per-night status (CONFIRMED or WAITLISTED). In one transaction, run the conditional UPDATE per night, or use `RETURNING date` to learn which nights succeeded. Insert CONFIRMED rows for those nights and WAITLISTED rows (with a queue position) for the rest. Pricing and cancellation policy must handle the split, and a waitlist promoter consumes cancellation events for D2 and does the same conditional UPDATE when a room frees up. The overall reservation stays PENDING until every night is confirmed or the guest accepts the partial stay."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-03',
      difficulty: 'medium',
      question:
        'Months after launch, some seats in the ticketing app show as permanently held even though nobody is buying them. Given this hold code, what is the most likely cause?',
      code: {
        language: 'typescript',
        code: `const ok = await redis.setnx('hold:' + show + ':' + seat, userId);
if (ok) {
  await redis.expire('hold:' + show + ':' + seat, 600);
}`,
      },
      options: [
        'SETNX is not atomic, so two users both got the hold and the second overwrote the TTL',
        'Redis evicts TTL keys first under memory pressure, leaving only non-expiring keys',
        'EXPIRE resets on every GET, so frequent seat-map reads keep extending the hold forever',
        'A crash or timeout between SETNX and EXPIRE leaves a key with no TTL, which is never released',
      ],
      correct: [3],
      explanation:
        'SETNX and EXPIRE are separate commands. If the process dies, is redeployed or times out between them, the key exists with no TTL and blocks the seat forever. The fix is a single SET key val NX PX ttl (or a Lua script). SETNX itself is atomic, so two users cannot both win. volatile-* eviction policies do not explain permanently held seats. GET does not reset TTLs in Redis.',
      followUps: [
        {
          "q": "You've fixed the code, but thousands of TTL-less hold keys already exist in production. How do you clean them up safely during live sales?",
          "a": "Scan, never use KEYS: `SCAN 0 MATCH hold:* COUNT 1000` on each primary, and check `TTL key` for each hit. A result of -1 means no expiry. Do not delete blindly, because a seat might actually be mid-payment. Cross-check the show_seat table: if the seat is BOOKED or the hold has no matching live checkout, set `EXPIRE key 600` instead of DEL, so any genuine buyer still gets their window and the key then dies by itself. Rate-limit the script, run it per shard, and log every key touched. Add a metric and alert for hold keys with TTL = -1 so a regression is caught within minutes."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-04',
      difficulty: 'hard',
      question:
        'On Redis Cluster, this multi-seat hold script fails in production with CROSSSLOT errors but worked on a single-node dev Redis. What is the right fix?',
      code: {
        language: 'typescript',
        code: `const keys = seats.map((s) => 'hold:' + showId + ':' + s);
await redis.eval(HOLD_LUA, keys.length, ...keys, holdId, 600000);`,
      },
      options: [
        'Switch from EVAL to MULTI/EXEC, which is allowed across slots in cluster mode',
        'Use a hash tag, e.g. hold:{showId}:A10, so all keys of the show map to the same slot',
        'Enable cluster-allow-reads-when-down so scripts can span shards',
        'Loop over the seats and call the script once per key',
      ],
      correct: [1],
      explanation:
        'Redis Cluster only allows multi-key commands and scripts on keys in the same hash slot. A {hash tag} makes the slot depend only on the tagged part, so all seats of a show co-locate. MULTI/EXEC has the same same-slot restriction. That cluster setting is about reads during failures and is unrelated. Per-key calls lose the all-or-nothing atomicity, which was the reason for using a script.',
      followUps: [
        {
          "q": "With the hash tag, all 60K seats of a mega-event sit on one slot and therefore one shard. When does that become a problem, and what do you do then?",
          "a": "One Redis primary does roughly 100K simple ops/s; a Lua script touching 4–6 keys costs several times more, so expect a ceiling of about 20–40K holds/s. That is fine behind a waiting room, but it fails if admission is uncapped. If it becomes the bottleneck, tag by section rather than by show, e.g. `hold:{show:sectionB}:B12`, and require that one order picks seats in a single section, which is a reasonable UX rule anyway. That spreads one show across many slots and shards while keeping each multi-seat hold atomic within a slot. Monitor per-shard CPU, since Redis executes scripts on a single thread."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-05',
      difficulty: 'expert',
      question:
        'You add a virtual waiting room in front of a flash-sale booking API. Select ALL design choices that are necessary for it to actually protect the booking core.',
      options: [
        'The booking API gateway rejects requests that lack a valid, signed, user-bound admission token',
        'Admission tokens expire (e.g. 15 min) and are bound to the event and user',
        'The waiting page is served from the same origin cluster as the booking core so they scale together',
        'The admission rate is tied to downstream health and remaining inventory',
        'Queue positions are stored in the browser\'s localStorage so a refresh keeps its place',
      ],
      correct: [0, 1, 3],
      explanation:
        'Without gateway enforcement, bots call the API directly and bypass the queue. Unexpiring or unbound tokens get shared or resold. Adaptive admission keeps the core within capacity and stops admitting once sold out. Serving the waiting page from the core origin defeats the purpose; it should be at the edge/CDN. Client-side positions are forgeable; positions must live server-side (keyed by user).',
      followUps: [
        {
          "q": "Bots are now acquiring admission tokens legitimately by flooding the queue with thousands of accounts. What do you add?",
          "a": "Make joining the queue costly and fair, not first-come. Require a logged-in, verified account (phone OTP or payment instrument on file) and allow one queue position per account and per device fingerprint. Randomise order for everyone who arrives before the on-sale time, so arriving 50 ms early with 1,000 bots gives no advantage. Put a bot-management challenge (Turnstile or reCAPTCHA, behavioural scoring) at queue entry, not at checkout. Cap tickets per account and per payment card in the booking core. After the sale, cluster accounts by shared card, address or IP for cancellation. Each layer raises the cost of a bot account rather than trying to block bots perfectly."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-06',
      difficulty: 'medium',
      question:
        'A PM proposes reserving inventory as soon as a user adds an item to the cart ("so they never see out-of-stock at checkout"). What is the strongest argument against it?',
      options: [
        'Cart writes are too frequent for the inventory database to handle',
        'It breaks idempotency because add-to-cart has no idempotency key',
        'Carts live for days, so reservations would lock stock for users who never buy and depress conversion for everyone else, especially on limited-stock deals',
        'Reservations need a saga, and carts cannot participate in sagas',
      ],
      correct: [2],
      explanation:
        'Most carts are abandoned. Reserving on add-to-cart turns the cart into a hoarding mechanism, so stock appears sold out while buyers are waiting. Reserving at checkout with a short TTL balances this. Write volume could be engineered around and is not the core problem. Idempotency keys can be added to any endpoint. Sagas are about multi-step flows and are unrelated to where reservation happens.',
      followUps: [
        {
          "q": "The PM accepts but still wants to reduce out-of-stock surprises at checkout. What can you offer that doesn't hoard stock?",
          "a": "Show availability signals instead of reserving. Run a live stock check on cart view and on each checkout step, and display \"only 3 left\" or \"selling fast\" from a near-real-time counter cache. Send a push or email when a carted item drops below a threshold. Reserve only at \"Place order\" with a short TTL (10–15 minutes). For flash deals, a time-boxed explicit hold (\"held for you for 5 minutes\") can be offered as a product feature with a strict per-user cap. Measure success with the checkout-time OOS rate and conversion, so the PM sees whether the signals actually work."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-07',
      difficulty: 'hard',
      question:
        'A ₹1 lightning deal has 1,000 units of one SKU and 400K buyers in the first minute. The single inventory row is a lock hotspot. Select ALL effective mitigations.',
      options: [
        'Split stock into 16 bucket rows and have each request decrement a random bucket, falling back to others',
        'Gate requests with Redis DECRBY on a stock counter and only let winners reach the DB reservation',
        'Switch the inventory table to SERIALIZABLE isolation',
        'Put the deal page behind a waiting room or rate-limited admission',
        'Add read replicas for the inventory database',
      ],
      correct: [0, 1, 3],
      explanation:
        'Buckets divide contention by the bucket count. A Redis gate rejects ~399K losers in microseconds, before they reach the DB. A waiting room bounds the arrival rate. SERIALIZABLE increases aborts and does nothing for a write hotspot. Read replicas do not help writes, and stock checks must read the primary anyway.',
      followUps: [
        {
          "q": "You use the Redis DECRBY gate. Redis says a buyer won, but the DB reservation then fails or the app crashes. How do you avoid losing or overselling units?",
          "a": "Treat the Redis counter as a token gate and the DB as the source of truth. On DB failure, INCRBY the counter back (compensation). To survive crashes, record the winner in a Redis set or stream with a timestamp atomically with the DECR (one Lua script), and run a reconciler every few seconds that compares winners without a DB reservation after N seconds and returns their units. Because the DB conditional UPDATE still guards stock, Redis can never cause oversell; the worst case is temporary undersell. At the end of the deal, reconcile the counter with DB stock and release any stranded units."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-08',
      difficulty: 'expert',
      question:
        'In a checkout saga, the reservation TTL sweeper cancels order O (payment still pending) and releases its stock. Two seconds later the PSP reports that authorization for O succeeded. With CAS-based state transitions, what should happen?',
      options: [
        'The AUTHORIZED→CONFIRMED CAS fails because the state is CANCELLED, so the orchestrator voids or refunds the authorization and notifies the user',
        'The orchestrator re-reserves inventory and confirms the order, since the customer has paid',
        'The order goes to CONFIRMED because payment events always take priority over timeouts',
        'Nothing; the authorization expires by itself, so no action is needed',
      ],
      correct: [0],
      explanation:
        'CAS transitions make the cancelled state terminal. A late success must be compensated (void the auth or refund the capture) and communicated. Re-reserving can oversell, because the released units may already be sold. Letting payments override timeouts breaks the inventory invariant. Relying on authorization expiry leaves funds blocked on the customer\'s card for days, and UPI has no auth hold at all, so money was actually debited.',
      followUps: [
        {
          "q": "These late-success refunds now happen hundreds of times a day. What do you change so the race becomes rare instead of just handled?",
          "a": "Measure first: plot the payment-confirmation latency distribution against the TTL. If p99 is 90 s and the TTL is 10 min, races come from webhooks lost or delayed. Then fix the sweeper: before cancelling a PAYMENT_PENDING order, query the PSP for the payment status and extend the hold if it is still processing. Give a grace period beyond the user-visible TTL, e.g. hide the timer at 10 minutes but keep stock until 12. For UPI and similar slow methods, use a longer method-specific TTL. Track \"late success after cancel\" as an SLO metric with an alert, since each one costs a refund and a frustrated customer."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-09',
      difficulty: 'expert',
      question:
        'Your payment executor calls the PSP with idempotency key = payment_order_id. The call times out. Which next step preserves exactly-once charging?',
      options: [
        'Mark the payment order FAILED and let the user retry checkout, which creates a new payment_order_id',
        'Retry with a fresh UUID idempotency key, because the old key may be poisoned by the timeout',
        'Wait for the nightly reconciliation file before telling the customer anything',
        'Keep the order EXECUTING, retry with backoff using the same key and/or query the PSP by reference, and apply the webhook result when it arrives',
      ],
      correct: [3],
      explanation:
        'A timeout is an unknown outcome. Retrying with the same key makes the PSP return the original result instead of charging twice, and status queries or webhooks resolve it quickly. A new payment_order_id or a fresh key per retry are exactly how double charges happen. Reconciliation is a safety net, not the primary path; waiting a day ruins the user experience.',
      followUps: [
        {
          "q": "Retries with the same key keep timing out for 20 minutes because the PSP is degraded. What does the user see and what does the system do?",
          "a": "Stop blocking the user: after about 30 s show \"payment processing, we'll notify you\" and keep the order in EXECUTING with inventory held beyond the normal TTL. A circuit breaker on that PSP stops new attempts after an error-rate threshold, and routing switches new checkouts to a secondary PSP, but never retries this order on another PSP, since the first might still capture. A status poller queries the original PSP with exponential backoff, and the webhook or the settlement file eventually decides. If the PSP later reports success after the user abandoned, either fulfil or refund according to policy. Page on-call once the count of EXECUTING orders older than X minutes crosses a threshold."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-10',
      difficulty: 'expert',
      question:
        'The PSP sends "payment.succeeded" (event e2) and then redelivers an older "payment.processing" (event e1) that was delayed. Given this handler, what goes wrong?',
      code: {
        language: 'typescript',
        code: `async function onWebhook(evt: PspEvent) {
  if (await seen(evt.id)) return;              // dedupe by event id
  await markSeen(evt.id);
  const status = evt.type === 'payment.succeeded' ? 'SUCCESS'
               : evt.type === 'payment.processing' ? 'EXECUTING' : 'FAILED';
  await db.query('UPDATE payment_order SET status = $1 WHERE id = $2', [status, evt.orderId]);
}`,
      },
      options: [
        'Nothing; dedupe by event id already handles redelivery',
        'e1 has a different event id, so it passes dedupe and moves the order from SUCCESS back to EXECUTING; the status poller may then retry the charge or show a stuck state',
        'e2 is dropped because markSeen runs before the update',
        'The update deadlocks because two webhooks for the same order run concurrently',
      ],
      correct: [1],
      explanation:
        'Dedupe by event id stops exact redeliveries but not out-of-order different events. Without a forward-only guard (WHERE status IN non-terminal states) the late e1 regresses the state. The code also has a separate bug: markSeen before a failed update loses the event. That is a real issue but not what this ordering scenario triggers. A single-row UPDATE does not deadlock on its own.',
      followUps: [
        {
          "q": "Besides the forward-only guard, what does the PSP's event payload usually give you to order events correctly, and when isn't that enough?",
          "a": "PSPs include a `created` timestamp and often a sequence or object version (e.g. the payment object's status plus an updated time). You can store the last applied version per order and ignore anything older. Timestamps are not enough on their own: two events can share a second, and clocks on the PSP's own nodes can disagree. The most robust approach is to not trust the event body at all: on any webhook, fetch the current payment object from the PSP API and apply that state. The webhook becomes only a \"something changed\" signal, which removes ordering issues at the cost of one extra API call per event."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-11',
      difficulty: 'hard',
      question:
        'Select ALL properties a payment ledger should have to satisfy auditors and support reconciliation.',
      options: [
        'Every transaction\'s entries sum to zero per currency (double-entry)',
        'Corrections are made by updating the original entry\'s amount so reports stay simple',
        'Entries are append-only, with reversals recorded as new transactions',
        'Each ledger transaction carries a unique external reference, so reposting the same business event is a no-op',
        'Amounts are stored as IEEE-754 doubles for fast aggregation',
      ],
      correct: [0, 2, 3],
      explanation:
        'Double-entry balance, immutability with reversals, and idempotent posting via a unique external_ref are the core ledger properties. Updating entries destroys the audit trail and hides errors. Doubles introduce rounding errors (0.1 + 0.2 ≠ 0.3); use integer minor units or exact decimals.',
      followUps: [
        {
          "q": "A bug posted 2,000 transactions crediting sellers twice yesterday, and some sellers already withdrew. How do you correct the ledger?",
          "a": "Never edit or delete the bad entries. Identify them via their external_ref pattern, then post one reversal transaction per duplicate with a new external_ref like `<ref>:reversal:INC-123`, debiting the seller account and crediting the original source. The audit trail now shows the error and its fix. For sellers who already withdrew, the reversal drives their balance negative, so the ledger records a receivable, and policy decides recovery by netting against future payouts. Run the reconciliation job afterwards to confirm the trial balance is zero per currency, and add the missing uniqueness constraint that let the duplicates through."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-12',
      difficulty: 'medium',
      question:
        'Select ALL discrepancies that a nightly reconciliation between the PSP settlement file and the internal ledger is designed to catch.',
      options: [
        'A payment the PSP captured but for which our webhook was never processed (internally still EXECUTING)',
        'A payment recorded as SUCCESS internally that the PSP never settled',
        'An amount mismatch due to currency conversion or fee differences',
        'A user who abandoned the checkout page before choosing a payment method',
      ],
      correct: [0, 1, 2],
      explanation:
        'Reconciliation compares money movements on both sides. Missed webhooks, phantom successes and amount or fee mismatches all show up as diffs. An abandoned checkout never reached the PSP, so there is nothing in the settlement file to compare; that is funnel analytics, not reconciliation.',
      followUps: [
        {
          "q": "Reconciliation finds 300 payments the PSP captured that are still EXECUTING internally. What does the job do with them automatically, and what needs a human?",
          "a": "Auto-heal the clear cases: for each, fetch the PSP's payment object to confirm the capture and amount, then drive the same state transition the webhook would (EXECUTING to SUCCESS, ledger post, outbox event). This works because that path is idempotent. If the order was already cancelled and stock released, route it to automatic refund. Amount mismatches, currency differences, or captures with no matching order go to a finance review queue with SLAs. Track the count per day; a jump from 3 to 300 almost always means a broken webhook endpoint or deploy, so alert on the trend, not only on individual items."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-13',
      difficulty: 'expert',
      question:
        'A wallet uses 2PC across account shards. The coordinator crashes after all participants voted YES (prepared) but before sending COMMIT. What is the consequence, and how does TC/C differ?',
      options: [
        'Prepared participants are blocked holding locks on the accounts until the coordinator recovers. In TC/C each phase is an already-committed local txn, so nothing is locked; recovery just retries Confirm or Cancel from the phase table',
        'Participants time out and commit on their own, so there is no difference from TC/C',
        'Participants time out and abort on their own; TC/C would have committed instead',
        'The transaction is lost and money disappears in 2PC, while TC/C guarantees atomic isolation',
      ],
      correct: [0],
      explanation:
        'After voting YES, a 2PC participant cannot decide unilaterally (the coordinator might have told others to commit), so it blocks while holding locks. That is 2PC\'s classic weakness. TC/C commits each phase locally and uses compensation, so there are no cross-network locks and recovery replays idempotent phases. TC/C does not provide isolation, because intermediate states are visible. 2PC does not lose money; it blocks.',
      followUps: [
        {
          "q": "With TC/C, the Try phase debits A's available balance, but Confirm for the credit to B keeps failing because B's shard is down for an hour. What does the user see and what are the risks?",
          "a": "The money is \"in flight\": A sees the balance reduced with the transfer shown as pending, and B sees nothing yet. The coordinator retries Confirm idempotently with backoff from its phase table. Since Try already reserved funds on A, nothing can be double-spent. The risk is a business one: a long pending state, support tickets, and pressure to cancel. Set a policy deadline: if Confirm cannot complete in N minutes, run Cancel on all phases that succeeded (release A's reservation) and mark the transfer failed. Cancel must also be idempotent and must handle an \"empty cancel\" for a Try that never arrived, which is a classic TC/C edge case."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-14',
      difficulty: 'expert',
      question:
        'An event-sourced wallet runs on a 3-node Raft group. After a leader failover, two replicas report different balances for the same account. Given this apply function, what is the bug?',
      code: {
        language: 'typescript',
        code: `apply(e: Evt) {
  if (e.kind === 'Credited') {
    const bonus = Date.now() < PROMO_END ? e.amount / 100n : 0n;   // 1% cashback promo
    this.balances.set(e.acct, (this.balances.get(e.acct) ?? 0n) + e.amount + bonus);
  }
}`,
      },
      options: [
        'bigint division truncates, so replicas round differently',
        'Raft does not guarantee the same event order on followers, so credits are applied in different orders',
        'apply() reads the wall clock, so replicas (or a later replay) applying the same event at different times compute different bonuses; the bonus must be decided in the command handler and recorded in the event',
        'Map iteration order differs between Node.js processes',
      ],
      correct: [2],
      explanation:
        'State machines in event sourcing and Raft must be deterministic. Reading Date.now() inside apply makes the result depend on when a replica applies the event, which differs across replicas and replays near PROMO_END. The fix is to decide the cashback when validating the command and emit an explicit CashbackCredited event. bigint division is deterministic. Raft guarantees identical log order on committed entries. The code does not iterate the Map.',
      followUps: [
        {
          "q": "How would you catch this class of non-determinism bug in CI before it reaches production?",
          "a": "Build a replay determinism test: take a recorded event log (production sample or synthetic), apply it in two fresh state machines under different conditions (mocked clock set to different times, different process, shuffled Map insertion), and assert identical state hashes after each event. Run it with the clock set just before and just after PROMO_END. Add a lint rule banning `Date.now`, `Math.random`, `crypto.randomUUID` and I/O inside apply and reducer modules. In production, have replicas publish a periodic state checksum at a given log index and alert on any mismatch; that is how you detect divergence before balances are wrong."
        }
      ],
    },
    {
      id: 'design-commerce-mcq-15',
      difficulty: 'hard',
      question:
        'In a Raft-replicated wallet partition, the leader appends a Debited event locally, sends it to followers, then crashes before any follower acknowledges. A new leader is elected. What happens to that debit?',
      options: [
        'It is applied, because the old leader wrote it to its durable log before crashing',
        'The new leader must fetch the entry from the old leader\'s disk before accepting writes',
        'Both the debit and a compensating credit are appended to preserve the audit trail',
        'It was never committed (no majority), so the new leader\'s log wins; the old leader\'s entry is truncated when it rejoins, and the client, which got no success, retries with the same command id',
      ],
      correct: [3],
      explanation:
        'Raft commits an entry only after a majority has stored it, and only committed entries are applied and acknowledged. An uncommitted entry on a failed leader is overwritten when that node rejoins as a follower. Since the client never got a success, it retries, and command-id dedupe keeps that safe. A local write alone does not commit. The new leader never needs the dead leader\'s disk. No compensation is needed, because nothing was ever applied.',
      followUps: [
        {
          "q": "Now the leader appended the debit, replicated it to one follower (a majority of 3), committed, but crashed before replying to the client. What happens on the client's retry?",
          "a": "This time the entry is committed and will survive: Raft's election rule guarantees the new leader has every committed entry, so the debit is applied on all replicas. The client saw a timeout, so it retries with the same command id. The new leader's state machine keeps a dedupe table of command ids (part of the replicated state, rebuilt on replay), finds this id already applied, and returns the original result without debiting again. That is why the dedupe table must be in the state machine, not in leader memory, and why its retention must exceed the client's retry window."
        }
      ],
    },
  ],
};

export default topic;
