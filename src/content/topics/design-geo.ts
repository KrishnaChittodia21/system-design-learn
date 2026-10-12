import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-geo',
  phase: 'designs',
  order: 2,
  title: 'Location Systems: Proximity Service, Nearby Friends, Google Maps & Uber',
  subtitle:
    'Geospatial indexing, real-time location fan-out, map tiles and routing, and ride-hailing dispatch — the designs where "where is it?" meets "how fast can I answer?".',
  estimatedMinutes: 160,
  sources: [
    'Alex Xu & Sahn Lam — System Design Interview Vol 2, Ch 1 (Proximity Service), Ch 2 (Nearby Friends), Ch 3 (Google Maps)',
    'Uber Engineering — H3: Uber’s Hexagonal Hierarchical Spatial Index (2018)',
    'Uber Engineering — Scaling Uber’s Real-time Market Platform / Ringpop talks',
    'Geiger et al. — Contraction Hierarchies (2008); OpenStreetMap slippy map tile spec',
  ],
  tags: [
    'geohash',
    'quadtree',
    'google-s2',
    'h3',
    'proximity',
    'websocket',
    'redis-pubsub',
    'map-tiles',
    'routing',
    'eta',
    'ride-hailing',
    'dispatch',
    'surge-pricing',
    'food-delivery',
  ],
  cheatSheet: [
    'Proximity (Yelp): 100M DAU × 5 searches ÷ 10^5 s ≈ 5K QPS, 200M businesses; read-heavy → replicated (not sharded) geo index + cached geohash → business IDs.',
    'Geohash: interleave lng/lat bits, base32; precision 4 ≈ 39×19.5 km, 5 ≈ 4.9×4.9 km, 6 ≈ 1.2 km×609 m. Always query the cell + 8 neighbours (boundary problem); shared prefix ≠ always nearby.',
    'Quadtree: split a cell into 4 when it holds > ~100 items; 200M businesses → ~2M leaves, ~1.7 GB in memory; rebuild takes minutes, so roll out servers gradually. S2 (Hilbert curve, cells on a cube) and H3 (hexagons, uniform neighbour distance) are the production-grade alternatives.',
    'Nearby Friends: 10M concurrent users × 1 update/30 s ≈ 334K updates/s; × 400 friends × 10% online ≈ 14M forwards/s → Redis pub/sub channel per user, WebSocket servers filter by distance.',
    'Location cache: Redis key per user with TTL (e.g. 10 min) — inactive users expire automatically; location history goes to Cassandra (write-heavy, time-ordered).',
    'Stateful WebSocket tier: scale by draining (mark node draining, stop new conns, let clients reconnect elsewhere); pub/sub tier sharded by consistent hashing with the ring in etcd/ZooKeeper.',
    'Google Maps: ~1B DAU; map served as pre-rendered tiles (256×256 px, 4^z tiles at zoom z; z21 ≈ 4.4T tiles, order of 100 PB) from CDN; tile URL computed client-side from lat/lng/zoom.',
    'Routing: road graph split into routing tiles at multiple hierarchy levels (local → arterial → highway); A*/contraction hierarchies; ETA = graph time + ML on live traffic; location updates batched every ~15 s → ~200K QPS (peak ~1M) into Kafka.',
    'Uber: drivers ping every ~4 s; in-memory geo index by H3 cell (res 8–9); matching = gridDisk(k) candidates → ETA-rank → offer with 10–15 s timeout → atomic driver lock; trip is an explicit state machine with idempotent transitions.',
    'Surge: per-H3-cell demand/supply ratio over a short window, smoothed across neighbouring cells and time; food delivery adds restaurant prep time + order batching to the matching problem.',
  ],
  sections: [
    {
      heading: 'Proximity Service (1/3): requirements, estimation, API & data model',
      body: `**Intuition:** "find restaurants within 2 km of me" is a *range query in two dimensions*. Databases are brilliant at 1-D range queries on a B-tree; the whole design is about turning 2-D into 1-D.

**Functional:** given (lat, lng, radius ≤ 20 km), return nearby businesses (paginated); business owners add/update/delete businesses — **changes need not be real-time** (visible next day is acceptable); view business details.

**Non-functional:** search p99 < ~100–200 ms, high availability, read-heavy with peak spikes in dense areas at lunch time, privacy (user location is sensitive — don't log it raw).

**Estimation** (Alex Xu Vol 2): 100M DAU, 200M businesses, 5 searches/user/day → 100M × 5 ÷ 10^5 ≈ **5,000 QPS** (peak ~×3–5). Business writes are negligible.

**API:**
- \`GET /v1/search/nearby?latitude=&longitude=&radius=5000\` → \`{total, businesses: [...] }\` (summary objects; paginate with a cursor)
- \`GET/POST/PUT/DELETE /v1/businesses/:id\`

**Data model:**
- **business** table: business_id PK, name, address, city, lat, lng, category, rating... (~1 KB/row → 200 GB).
- **geo index** table: \`(geohash, business_id)\` with a compound primary key so adds/removes are single-row operations. Querying is \`WHERE geohash LIKE '9q9hv%'\` (prefix = range scan on the B-tree) or exact match on a stored fixed-precision column.

Read-heavy + modest data volume → a **relational DB with read replicas** (MySQL/Postgres) is a fine fit. The geo index for 200M rows is only a few GB, so it fits comfortably on one server — **replicate, don't shard**.`,
      code: [
        {
          language: 'sql',
          title: 'Geo index table: one row per (precision-bucket, business)',
          code: `CREATE TABLE business (
  business_id  bigint PRIMARY KEY,
  name         text NOT NULL,
  category     text NOT NULL,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  rating       numeric(2,1),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Store geohash at several precisions so any radius maps to an equality lookup
CREATE TABLE geo_index (
  precision    smallint NOT NULL,          -- 4, 5 or 6
  geohash      varchar(12) NOT NULL,
  business_id  bigint NOT NULL REFERENCES business(business_id),
  PRIMARY KEY (precision, geohash, business_id)  -- compound PK: cheap add/remove
);

-- 2 km radius -> precision 5: query the cell and its 8 neighbours
SELECT business_id
FROM geo_index
WHERE precision = 5
  AND geohash = ANY($1::varchar[]);        -- 9 geohashes computed in the app

-- The same query with PostGIS (fine at this scale, too):
-- SELECT id FROM business
-- WHERE ST_DWithin(geom::geography, ST_MakePoint($lng,$lat)::geography, 2000);`,
        },
      ],
      keyPoints: [
        '5K QPS search, 200M businesses, writes rare and not real-time.',
        'Turn 2-D proximity into 1-D keys (geohash/quadtree/S2) that a B-tree can range-scan.',
        'Geo index is small: replicate for read scale instead of sharding.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 1 (Proximity Service)',
    },
    {
      heading: 'Proximity Service (2/3): geospatial indexes — grid, geohash, quadtree, S2 & H3',
      body: `**Naive 2-D search:** \`WHERE lat BETWEEN ... AND lng BETWEEN ...\` — two separate 1-D indexes each return a huge band; intersecting them is slow. We need one key that preserves locality.

**Evenly divided grid:** fixed-size cells — but density is wildly uneven (Manhattan vs Sahara), so some cells are empty and others hold 100K businesses.

**Geohash:** recursively halve longitude then latitude, emitting a bit each time (0 = lower half, 1 = upper half), interleave bits, encode 5 bits per base32 char. Longer shared prefix ⇒ same cell. Precision guide:

| Length | Cell size | Radius it serves |
|---|---|---|
| 4 | 39.1 km × 19.5 km | 5–20 km |
| 5 | 4.9 km × 4.9 km | 1–2 km |
| 6 | 1.2 km × 609 m | 0.5 km |
| 7 | 153 m × 152 m | ~100 m |

**Boundary issues:** (1) two points can be metres apart but in different cells with **no common prefix** (e.g. across the equator/prime meridian); (2) a point near a cell edge has close neighbours in adjacent cells. **Fix: always search the cell + its 8 neighbours**, then filter by exact distance. If too few results, drop one precision level (bigger cells) and repeat.

**Quadtree:** an in-memory tree; recursively split a cell into 4 quadrants until each leaf has ≤ ~100 businesses. Adapts to density. 200M businesses → ~2M leaves (100 IDs × 8 B + coords ≈ 832 B each) + ~0.67M internal nodes ≈ **1.7 GB**. Built at server start (a few minutes for 200M), so deploy gradually and keep old servers serving. Updates need locking or rebuilds; kNN ("nearest 10") is natural — walk up until you have k.

**Google S2:** maps the sphere onto 6 cube faces and orders cells with a **Hilbert curve** (better locality than Z-order); 31 levels; excellent **region covering** (cover any polygon with a set of cells) → geofencing. Used by Google Maps, Tinder, and others.

**Uber H3:** **hexagonal** hierarchical grid (16 resolutions). Every neighbour of a hexagon is equidistant from its centre — great for smoothing demand/supply and for "k-ring" neighbourhood queries; parent/child containment is approximate (7 children, not exact).

| Index | Structure | Strength | Weakness |
|---|---|---|---|
| Geohash | String prefix | Trivial to store in any DB/Redis, easy updates | Edge effects, uneven cell shapes near poles |
| Quadtree | In-memory tree | Adapts to density, kNN | Rebuild/update complexity, memory per server |
| S2 | Hilbert-curve cell IDs (64-bit) | Region covering, geofencing | Conceptually heavier |
| H3 | Hexagon IDs (64-bit) | Uniform neighbours, analytics/surge | Approximate hierarchy |`,
      code: [
        {
          language: 'typescript',
          title: 'Geohash encode + 8-neighbour search set (bit interleaving)',
          code: `const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';   // geohash alphabet (no a, i, l, o)

export function encode(lat: number, lng: number, precision = 6): string {
  let latLo = -90, latHi = 90, lngLo = -180, lngHi = 180;
  let hash = '', bit = 0, ch = 0, evenBit = true;        // even bits = longitude
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngLo = mid; } else { ch <<= 1; lngHi = mid; }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latLo = mid; } else { ch <<= 1; latHi = mid; }
    }
    evenBit = !evenBit;
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0; } // 5 bits per char
  }
  return hash;
}

/** Cell size in degrees for a precision, used to step into neighbour cells. */
function cellSize(precision: number) {
  const bits = precision * 5;
  const lngBits = Math.ceil(bits / 2), latBits = Math.floor(bits / 2);
  return { dLat: 180 / 2 ** latBits, dLng: 360 / 2 ** lngBits };
}

/** The cell plus its 8 neighbours: the set you must query to avoid edge misses. */
export function searchCells(lat: number, lng: number, precision: number): string[] {
  const { dLat, dLng } = cellSize(precision);
  const out = new Set<string>();
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      const la = Math.max(-89.999999, Math.min(89.999999, lat + dy * dLat));
      const ln = ((lng + dx * dLng + 540) % 360) - 180;   // wrap the antimeridian
      out.add(encode(la, ln, precision));
    }
  }
  return [...out];
}`,
        },
      ],
      keyPoints: [
        'Geohash = interleaved lng/lat bits in base32; prefix length = cell size.',
        'Always query cell + 8 neighbours, then filter by true distance.',
        'Quadtree adapts to density (~1.7 GB for 200M); S2 excels at region covering; H3 at uniform neighbourhoods.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 1; Uber H3 docs; Google S2 docs',
    },
    {
      heading: 'Proximity Service (3/3): architecture, scaling, caching & wrap-up',
      body: `**Components:**
- **Location-Based Service (LBS)**: stateless, read-only; computes the 9 geohashes for the radius, fetches business IDs, hydrates business objects, filters by exact distance (haversine), ranks (distance, rating, open-now), paginates.
- **Business service**: CRUD for owners; writes to the primary DB. A **nightly job** (or CDC stream) rebuilds geo index/caches — acceptable because updates need not be real-time.
- **DB cluster**: primary for writes, many replicas for reads.

**Caching strategy (Alex Xu):**
1. **Geohash → [business_id]** in Redis, per precision (4, 5, 6): 200M businesses × 8 B × 3 precisions ≈ **~5 GB** → fits one Redis node; replicate it to every region for read scale.
2. **business_id → business object** in Redis for hydration.

Why not cache the raw (lat, lng) query? The user's coordinates change constantly and are almost never repeated — **cache by cell, not by query**.

**Regions & availability:** deploy LBS + Redis in multiple regions close to users; users are routed by geo-DNS. This also helps data-residency rules (keep EU user queries in the EU).

**Filtering:** time-based (open now), category — apply after fetching IDs since a 9-cell search returns at most a few thousand candidates.

**Alternative: Redis GEO / Elasticsearch geo_distance.** Redis \`GEOSEARCH\` stores a 52-bit geohash as a sorted-set score — great for moderate data sets and real-time updates; Elasticsearch gives geo + full-text + filters in one query (Yelp-like "sushi near me, open now").

**Bottlenecks & trade-offs:** dense-city hot cells (paginate + rank, cache results per cell+category), stale data after edits (acceptable per requirements; add an "owner preview" path), and the choice of **replicating** the index everywhere vs **sharding** by region — replication wins because the index is small and every query touches arbitrary cells.`,
      diagram: `                      client (lat,lng,radius)
                              |
                         geo-DNS / LB
                  /search/nearby   |    /businesses/{id}
                 v                 |               v
     +-----------------------+     |     +-------------------+
     | LBS (stateless, RO)   |     |     | Business service  |
     | 1. 9 geohashes        |     |     | CRUD (low QPS)    |
     | 2. ids from cache     |     |     +---------+---------+
     | 3. hydrate + filter   |     |               | writes
     +-----+-----------+-----+     |               v
           |           |           |       +--------------+
           v           v           |       |  DB primary  |
  +----------------+ +-----------+ |       +------+-------+
  | Redis: geohash | | Redis:    | |              | replication
  | -> [biz ids]   | | biz objs  | |    +---------+---------+
  +----------------+ +-----------+ |    v         v         v
           ^  nightly rebuild / CDC     replica   replica   replica
           +--------------------------------------+`,
      code: [
        {
          language: 'typescript',
          title: 'LBS query: 9-cell lookup, exact-distance filter, radius-driven precision',
          code: `import Redis from 'ioredis';
import { searchCells } from './geohash';

const PRECISION_FOR_RADIUS: [number, number][] = [[500, 6], [2_000, 5], [20_000, 4]];

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function nearby(redis: Redis, lat: number, lng: number, radius: number, limit = 20) {
  const precision = PRECISION_FOR_RADIUS.find(([r]) => radius <= r)?.[1] ?? 4;
  const cells = searchCells(lat, lng, precision);
  const pipe = redis.pipeline();
  cells.forEach((c) => pipe.smembers('geo:' + precision + ':' + c)); // one round trip
  const ids = [...new Set(((await pipe.exec()) ?? []).flatMap(([, v]) => v as string[]))];
  if (!ids.length) return [];

  const raw = await redis.mget(ids.map((id) => 'biz:' + id));      // hydrate from cache
  return raw
    .filter((s): s is string => s !== null)
    .map((s) => JSON.parse(s) as { id: string; lat: number; lng: number; rating: number })
    .map((b) => ({ ...b, distance: haversineMeters(lat, lng, b.lat, b.lng) }))
    .filter((b) => b.distance <= radius)                             // cells overshoot radius
    .sort((a, b) => a.distance - b.distance || b.rating - a.rating)
    .slice(0, limit);
}`,
        },
      ],
      keyPoints: [
        'Cache by geohash cell, not by raw coordinates.',
        '~5 GB geohash cache replicated per region; business objects cached separately.',
        'Exact-distance filter after the 9-cell fetch; nightly/CDC index refresh.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 1',
    },
    {
      heading: 'Nearby Friends (1/3): requirements & the fan-out math',
      body: `**Intuition:** unlike Yelp, *everything moves*. Businesses are static; friends are moving points, and each location update must be pushed to the friends who care — a **real-time pub/sub** problem, not a search problem.

**Functional:** users see opted-in friends within 5 miles with distance and "last updated" timestamp; list refreshes every few seconds; location history stored (for ML/analytics); inactive friends (no update for 10 min) disappear.

**Non-functional:** low latency (a few seconds end-to-end), reliability "good enough" (occasional lost update is fine — the next arrives in 30 s), **eventual consistency** for the location store, privacy (opt-in, don't leak exact positions to non-friends).

**Estimation (Alex Xu Vol 2):**
- 1B users, 10% use the feature → **100M DAU**; 10% concurrently online → **10M concurrent users**.
- Each reports location every **30 s** → 10M ÷ 30 ≈ **334K location updates/s**.
- Average 400 friends; ~10% of them online and nearby → each update fans out to ~40 friends → 334K × 40 ≈ **14M forwarded updates/s**.

The 14M/s fan-out, not the 334K writes, drives the design. Friends distance filtering must be cheap and close to the connection.

**Why WebSocket:** bidirectional, persistent — client pushes updates and receives friends' updates on the same connection; HTTP polling at this rate wastes headers and battery. (A REST API still handles profile, friend management, etc.)`,
      keyPoints: [
        '10M concurrent × 1/30 s ≈ 334K writes/s; × ~40 interested friends ≈ 14M pushes/s.',
        'Occasional loss is acceptable — the next update supersedes it.',
        'Persistent bidirectional connections (WebSocket) for the real-time path.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 2 (Nearby Friends)',
    },
    {
      heading: 'Nearby Friends (2/3): architecture — WebSocket servers, location cache & Redis pub/sub',
      body: `**Components:**
- **WebSocket servers (stateful):** hold client connections; for each connection subscribe to the channels of that user's friends; on a friend's update compute distance and push only if within radius.
- **Location cache (Redis):** \`location:{userId}\` → {lat, lng, ts} with a **TTL** (e.g. 10 min, refreshed on every update). Users who go quiet expire automatically — no cleanup job. Only the *latest* location matters, so no durability needed.
- **Location history DB (Cassandra):** append-only (user_id, ts) → lat/lng; write-heavy, horizontally scalable.
- **Redis pub/sub:** one lightweight channel **per user**. On update, publish to \`ch:{userId}\`; every friend's WebSocket handler that subscribed receives it. Channels are cheap (a hash table entry + subscriber list), idle channels cost almost nothing.
- **User DB** (profiles, friendships) and API servers for everything non-real-time.

**Periodic update flow:**
1. Client sends location over WebSocket → the server that holds the connection.
2. Server writes history (async to Cassandra via Kafka or directly), sets \`location:{me}\` in cache with TTL, publishes to \`ch:{me}\`.
3. Redis pub/sub delivers to every subscriber (friends' connection handlers, which may be on other WS servers).
4. Each subscriber computes distance(friend, me); if ≤ 5 miles, push {userId, lat, lng, ts} to its client; otherwise drop.

**Client init:** on connect, the server loads the friend list, batch-reads their cached locations (MGET), pushes the nearby ones, and subscribes to all friends' channels (even far-away ones — they may come closer).

**Why not a message queue like Kafka for fan-out?** Kafka is optimised for durable, replayable logs with consumer groups; here we want **ephemeral, per-user, low-latency** broadcast with millions of tiny channels — Redis pub/sub fits (fire-and-forget; missed messages are fine).`,
      diagram: `  mobile ==WebSocket==> +------------------+   publish ch:A    +---------------+
  (user A)              |  WS server 1     |------------------>| Redis pub/sub |
                        | conn(A), subs:   |                   |  channel per  |
                        | ch:B, ch:C ...   |<------------------|  user (shard  |
                        +---+---------+----+  msg from ch:B    |  by user id)  |
                            |         |                        +-------+-------+
            SET loc:A EX 600|         | history (async)                | ch:A
                            v         v                                v
                   +-------------+ +-----------+           +------------------+
                   | Redis loc   | | Kafka ->  |           | WS server 2      |
                   | cache (TTL) | | Cassandra |           | conn(B) subs ch:A|
                   +-------------+ +-----------+           | dist(A,B)<=5mi ? |
                                                           |   push to B      |
                                                           +------------------+`,
      code: [
        {
          language: 'typescript',
          title: 'WebSocket handler: update, cache with TTL, publish, distance-filtered fan-in',
          code: `import Redis from 'ioredis';
import type { WebSocket } from 'ws';
import { haversineMeters } from './geo';

const RADIUS_M = 8_047;                    // 5 miles
const pub = new Redis();                   // publisher / cache connection
const sub = new Redis();                   // dedicated subscriber connection (one per server)
const listeners = new Map<string, Set<(m: Loc) => void>>(); // channel -> local handlers
type Loc = { userId: string; lat: number; lng: number; ts: number };

sub.on('message', (channel, raw) => {
  const msg = JSON.parse(raw) as Loc;
  listeners.get(channel)?.forEach((fn) => fn(msg));
});

export async function onConnect(ws: WebSocket, me: string, friends: string[]) {
  let myLoc: Loc | null = null;
  const handler = (f: Loc) => {                        // friend moved
    if (myLoc && haversineMeters(myLoc.lat, myLoc.lng, f.lat, f.lng) <= RADIUS_M) {
      ws.send(JSON.stringify({ type: 'friend', ...f }));
    }
  };
  for (const f of friends) {
    const ch = 'ch:' + f;
    if (!listeners.has(ch)) { listeners.set(ch, new Set()); await sub.subscribe(ch); }
    listeners.get(ch)!.add(handler);
  }
  ws.on('message', async (raw) => {
    const { lat, lng } = JSON.parse(raw.toString()) as { lat: number; lng: number };
    myLoc = { userId: me, lat, lng, ts: Date.now() };
    const payload = JSON.stringify(myLoc);
    await pub.multi()
      .set('loc:' + me, payload, 'EX', 600)            // inactive users vanish after 10 min
      .publish('ch:' + me, payload)
      .exec();
  });
  ws.on('close', async () => {
    for (const f of friends) {
      const ch = 'ch:' + f, set = listeners.get(ch);
      set?.delete(handler);
      if (set && set.size === 0) { listeners.delete(ch); await sub.unsubscribe(ch); }
    }
  });
}`,
        },
      ],
      keyPoints: [
        'Stateful WebSocket tier + stateless API tier.',
        'Location cache with TTL = automatic inactivity; history in Cassandra.',
        'Per-user Redis pub/sub channels; distance filter at the subscriber.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 2',
    },
    {
      heading: 'Nearby Friends (3/3): scaling the WebSocket and pub/sub tiers',
      body: `**Scaling WebSocket servers:** they're stateful, so autoscaling needs care. To remove a node, mark it **draining** at the load balancer (no new connections), let existing connections close or ask clients to reconnect gradually (jittered), then terminate. Deploys follow the same pattern — a rolling restart that drops 1M connections at once causes a **reconnect storm** (thundering herd on auth + friend-list loading). Clients should reconnect with exponential backoff + jitter.

**Sizing the Redis pub/sub cluster (Alex Xu):**
- **Memory:** 100M channels (one per feature user) × 100 subscribers × ~20 B per subscriber pointer ≈ **200 GB** → a couple of large nodes by memory alone.
- **CPU:** 14M pushes/s; assume a Redis node handles ~100K subscriber pushes/s → **~140 nodes**. CPU, not memory, is the bottleneck.
- Distribute channels across nodes with **consistent hashing**; keep the hash ring in a service-discovery store (etcd/ZooKeeper). WebSocket servers cache the ring and subscribe/publish to the right node.
- **Resizing is disruptive:** moving a channel means every subscriber must re-subscribe on the new node, and updates may be lost in between (acceptable per requirements). Over-provision and resize at low-traffic hours.
- Treat pub/sub nodes as **stateful**: when one dies, a replacement takes its ring slot and WS servers re-subscribe the affected channels.

**Redis Cluster sharded pub/sub note:** classic Redis Cluster broadcasts PUBLISH to *every* node (bus traffic grows with cluster size); Redis 7's **sharded pub/sub** (\`SPUBLISH\`/\`SSUBSCRIBE\`) routes by slot and fixes that — mention it if you propose Redis Cluster rather than client-side hashing.

**Adding "nearby random people" (opt-in):** create a pub/sub channel **per geohash cell** (precision ~4–5); users publish to their cell's channel and subscribe to their cell + neighbours, and the same distance filter applies.

**Alternatives:** Erlang/Elixir (Phoenix PubSub, millions of lightweight processes — WhatsApp-style) can replace the Redis tier; a friend graph with users having 5,000 friends (celebrity) should be capped or handled by throttling updates.`,
      code: [
        {
          language: 'typescript',
          title: 'Client reconnect with capped exponential backoff + full jitter (avoid reconnect storms)',
          code: `export function connectWithBackoff(url: string, onOpen: (ws: WebSocket) => void) {
  let attempt = 0;
  const BASE_MS = 500, CAP_MS = 60_000;

  const open = () => {
    const ws = new WebSocket(url);
    ws.onopen = () => { attempt = 0; onOpen(ws); };
    ws.onclose = (ev) => {
      // 4001 = server asked us to move (draining); reconnect soon but still jittered
      const cap = ev.code === 4001 ? 5_000 : Math.min(CAP_MS, BASE_MS * 2 ** attempt);
      const delay = Math.random() * cap;            // full jitter spreads 1M clients
      attempt++;
      setTimeout(open, delay);
    };
  };
  open();
}`,
        },
      ],
      keyPoints: [
        'Drain stateful nodes; clients reconnect with jitter to avoid storms.',
        'Pub/sub tier is CPU-bound (~14M pushes/s → ~140 nodes), not memory-bound (~200 GB).',
        'Consistent-hash channels with the ring in etcd/ZooKeeper; Redis 7 sharded pub/sub for Cluster.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 2',
    },
    {
      heading: 'Google Maps (1/3): requirements, estimation & map tiles',
      body: `**Intuition:** Google Maps is three systems glued together — a **picture service** (map tiles, served like static images from a CDN), a **position service** (ingesting billions of GPS points), and a **routing brain** (shortest paths on a road graph adjusted by live traffic).

**Functional (Alex Xu Vol 2 scope):** user location updates, navigation with ETA, map rendering. Out of scope: Street View, multi-stop, business search.
**Non-functional:** accuracy (no wrong turns), smooth rendering, **low data and battery usage** on mobile, availability and scalability.

**Estimation:**
- **Tiles:** at zoom 21 there are 4^21 ≈ **4.4 trillion** tiles; at ~100 KB each ≈ 440 PB. ~90% of the world is ocean/uninhabited and compresses extremely well → ~44–88 PB; call it **~50 PB**. Each lower zoom has 4× fewer tiles: 50 × (1 + 1/4 + 1/16 + ...) ≈ 67 PB → **order of 100 PB** total.
- **Location updates:** 1B DAU × 35 min navigation/week ≈ **5B minutes/day**. GPS every second → 5B × 60 ÷ 10^5 ≈ **3M QPS**; batch client-side every **15 s** → **~200K QPS**, peak ~5× ≈ **1M QPS**.
- **Server throughput for tiles** is mostly CDN: a user at 30 km/h pans through a handful of 100-KB tiles per minute.

**Map tiles:** the world is pre-rendered per zoom level into 256×256 px tiles addressed by (z, x, y) — the Web-Mercator "slippy map" scheme. Tiles are **static** → pre-generate, store in object storage, serve through a **CDN**; clients compute which tiles they need from lat/lng/zoom and fetch URLs directly (or a map-tile service maps location → tile URLs so the encoding can change without app updates — Alex Xu uses geohash-keyed tile URLs).

**Vector tiles** (modern): send road/label geometry (e.g. Mapbox Vector Tile protobuf) and render on the device — much smaller over the wire, crisp at fractional zooms, rotatable, styleable. Raster tiles are simpler for the server and old clients.

**Mobile data budget:** the app caches tiles on device, prefetches along the planned route, and uses lower zoom tiles while moving fast.`,
      code: [
        {
          language: 'typescript',
          title: 'Slippy-map tile math: which tiles cover the viewport?',
          code: `/** Web Mercator tile coordinates for a lat/lng at zoom z (OSM/Google scheme). */
export function tileFor(lat: number, lng: number, z: number) {
  const n = 2 ** z;                                   // n x n tiles at zoom z (4^z total)
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** Tiles for a viewport (plus a 1-tile margin to prefetch while panning). */
export function tilesForViewport(
  north: number, south: number, east: number, west: number, z: number,
): string[] {
  const nw = tileFor(north, west, z), se = tileFor(south, east, z);
  const urls: string[] = [];
  for (let x = nw.x - 1; x <= se.x + 1; x++) {
    for (let y = nw.y - 1; y <= se.y + 1; y++) {
      const n = 2 ** z;
      if (y < 0 || y >= n) continue;                   // no wrap vertically
      const wx = ((x % n) + n) % n;                     // wrap horizontally
      urls.push('https://tiles.example-cdn.com/v3/' + z + '/' + wx + '/' + y + '.mvt');
    }
  }
  return urls;                                          // immutable URLs: cache forever
}`,
        },
      ],
      keyPoints: [
        'Tiles: 4^z per zoom, ~100 PB order of magnitude, served as static CDN objects.',
        'Location updates batched every ~15 s: ~200K QPS avg, ~1M peak.',
        'Vector tiles cut bandwidth and render client-side; clients prefetch along route.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 3 (Google Maps)',
    },
    {
      heading: 'Google Maps (2/3): road graph, routing tiles, shortest path & ETA',
      body: `**Intuition:** the world's roads are a graph (intersections = nodes, road segments = edges weighted by travel time). You can't hold the whole planet's graph in one Dijkstra run, so you cut it into **tiles** and add **highway shortcuts** so long trips don't expand every side street.

**Routing tiles (Alex Xu):** the road graph is partitioned into grid tiles; each tile is a small adjacency list serialized to binary and stored in **object storage** (S3), cached aggressively by the shortest-path service. Tiles reference neighbouring tiles at their edges, so the algorithm loads tiles lazily as the search expands.

**Hierarchy:** three levels —
- **Local** tiles (small area, all roads),
- **Arterial** tiles (larger, only arterial roads connecting districts),
- **Highway** tiles (largest, only highways between cities).
Edges connect levels (e.g. an on-ramp). A cross-country route uses local tiles near origin/destination and highway tiles in between.

**Algorithms:** A* with a geographic heuristic on the tile graph; production systems use preprocessing techniques like **contraction hierarchies** (add shortcut edges by contracting unimportant nodes; queries run a bidirectional search in milliseconds on continental graphs) or customizable route planning (CRP, Microsoft/Bing) which re-weights quickly when traffic changes.

**Navigation service pipeline:**
1. **Geocoding** (address → lat/lng, via a geocoding DB/Redis).
2. **Route planner** → **shortest-path service** returns top-k routes on the static graph (ignoring traffic).
3. **ETA service** predicts time per route using live + historical traffic (ML models — Google/DeepMind use graph neural networks over "supersegments").
4. **Ranker** applies user filters (avoid tolls/highways) and returns the best.
5. **Updater services**: *routing tile processing* rebuilds tiles from new road data; *traffic update service* extracts live speeds from the location stream into the traffic DB.

**Why ETA is ML, not physics:** speed on a segment depends on time-of-day, weather, events, and upcoming traffic lights; historical patterns plus live signal outperform "distance ÷ speed limit" by large margins.`,
      code: [
        {
          language: 'typescript',
          title: 'A* over lazily loaded routing tiles (simplified)',
          code: `type NodeId = string;
type Edge = { to: NodeId; seconds: number };
type Tile = { nodes: Map<NodeId, { lat: number; lng: number; edges: Edge[] }> };

export async function route(
  src: NodeId, dst: NodeId,
  tileOf: (n: NodeId) => string,                          // node -> routing tile id
  loadTile: (id: string) => Promise<Tile>,                // S3 + LRU cache
  coord: (n: NodeId) => { lat: number; lng: number },
  maxSpeedMps = 36,                                       // ~130 km/h keeps heuristic admissible
) {
  const tiles = new Map<string, Tile>();
  const getNode = async (n: NodeId) => {
    const t = tileOf(n);
    if (!tiles.has(t)) tiles.set(t, await loadTile(t));   // expand tiles lazily
    return tiles.get(t)!.nodes.get(n)!;
  };
  const h = (n: NodeId) => straightLineMeters(coord(n), coord(dst)) / maxSpeedMps;
  const g = new Map<NodeId, number>([[src, 0]]);
  const prev = new Map<NodeId, NodeId>();
  const open = new MinHeap<NodeId>();                     // keyed by g + h
  open.push(src, h(src));
  while (open.size) {
    const u = open.pop()!;
    if (u === dst) return { seconds: g.get(u)!, path: unwind(prev, u) };
    for (const e of (await getNode(u)).edges) {
      const cand = g.get(u)! + e.seconds;                 // edge weight = live travel time
      if (cand < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, cand); prev.set(e.to, u);
        open.push(e.to, cand + h(e.to));
      }
    }
  }
  return null;                                            // unreachable
}
declare class MinHeap<T> { size: number; push(v: T, k: number): void; pop(): T | undefined }
declare function straightLineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number;
declare function unwind(prev: Map<string, string>, end: string): string[];`,
        },
      ],
      keyPoints: [
        'Road graph partitioned into routing tiles stored in object storage, loaded lazily.',
        'Three-level hierarchy (local/arterial/highway) keeps long searches small.',
        'Shortest path on static graph → ETA via ML on live+historical traffic → ranker.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 3',
    },
    {
      heading: 'Google Maps (3/3): location ingestion, adaptive ETA & rerouting, wrap-up',
      body: `**Location service:** clients batch GPS points (every 15 s) and send them to the location service, which writes to **Cassandra** (user_id, timestamp) → lat/lng — a write-heavy, time-ordered, horizontally scalable store — and publishes to **Kafka**. Kafka consumers include: the **traffic update service** (compute live segment speeds), **ML personalization**, **routing-tile updater** (detect new/closed roads from traces), and analytics.

Why HTTP for batched uploads rather than WebSocket? Updates are periodic, client-initiated and batched; plain HTTP/2 (with keep-alive) is simpler and friendlier to mobile radios. The **navigation** session, however, needs server push for reroutes.

**Adaptive ETA and rerouting (the hard deep dive):**
- Track **active navigation users** and the routing tiles their route crosses.
- When traffic changes in a tile, we need "which navigating users are affected?" — a naive scan of all users' tile lists is O(users × tiles).
- Alex Xu's trick: for each user store the tile of their current location plus the chain of **increasingly larger (higher-level) tiles** containing it until the destination is included — e.g. user_1: r1 ⊂ super(r1) ⊂ super(super(r1)). A traffic incident in tile X affects a user if X lies within the user's largest tile that contains both current location and destination, making the check cheap.
- Recompute ETA for affected users; if a significantly better route exists, **push** it via a WebSocket/long-lived connection (the book chooses WebSocket over mobile push notifications, which have payload limits and less control).

**Delivery protocol choices:** mobile push notifications (limited payload ~4 KB, no web support), long polling, WebSocket (bidirectional, small footprint), SSE. WebSocket wins for navigation sessions.

**Bottlenecks & trade-offs:**
- 1M peak QPS of location writes → Cassandra with a partition key of (user_id, day) to bound partition size.
- Tile CDN cost dominates bandwidth → vector tiles + on-device cache.
- ETA freshness vs compute cost: recompute on traffic change events, not on a timer for every user.
- Privacy: location history retention and opt-out; anonymise traces before traffic modelling.`,
      diagram: `  mobile -- batched GPS (15 s) --> Location svc --> Cassandra (user_id, ts)
    |                                    |
    |  tiles                             v
    |<------ CDN <-- tiles (S3)        Kafka --+--> traffic update -> traffic DB
    |                                    |     +--> routing-tile updater -> S3
    |  route / reroute (WebSocket)       +--------> ML / analytics
    v
  Navigation svc: geocode -> route planner -> shortest-path (routing tiles)
                                 |
                                 v
                   ETA svc (ML + traffic DB) -> ranker (filters) -> client
                                 ^
     Adaptive ETA svc: active nav sessions x affected tiles -> push reroute`,
      keyPoints: [
        'Location: batched HTTP → Cassandra + Kafka fan-out to traffic/ML consumers.',
        'Adaptive ETA: index active navigations by tile hierarchy; push reroutes via WebSocket.',
        'Cost drivers: tile egress (CDN, vector tiles) and ETA recomputation.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 3',
    },
    {
      heading: 'Uber (1/3): requirements, estimation & driver location ingestion',
      body: `**Intuition:** Uber is Nearby Friends where the "friends" are drivers, plus a **marketplace**: every rider request is an auction for the nearest good driver, cleared in seconds.

**Functional:** riders see nearby cars and a price/ETA quote; request a ride; get matched to a driver; both track each other live; trip lifecycle (pickup, in progress, complete); payment; ratings. Drivers go online/offline and accept/decline offers.

**Non-functional:** match within seconds (p99 < ~5–10 s including driver accept), **no double assignment** of a driver, high availability per city, location freshness of a few seconds, consistency for payments and trip state (strong), eventual for the map of nearby cars.

**Estimation (assumptions, not Uber's official figures):**
- 5M drivers online at global peak, pinging every **4 s** → **1.25M location writes/s** (drivers typically send location every few seconds).
- 20M trips/day → ~230 requests/s average, peak ×5 ≈ 1.2K/s matches; each match queries nearby drivers and computes several ETAs.
- Location payload ~100 B → 125 MB/s ingress; keep only **latest** position hot (5M × ~200 B ≈ 1 GB) — trivially fits in memory; history goes to Kafka → data lake.

**Location ingestion path:**
- Driver app → edge/gateway (long-lived connection, HTTP/2 or WebSocket) → **location service** → update in-memory geo index keyed by **H3 cell** (resolution ~8–9: ~0.7 km² / ~0.1 km² hexagons) and publish to Kafka for trip tracking, ETA models, surge, fraud.
- Shard the in-memory index **by city/region and cell**, not by driver ID — matching queries are spatial. Uber historically used **Ringpop** (consistent hashing + SWIM gossip) to shard stateful services; today one would use a consistent-hash layer or partition by city.
- **Staleness guard:** each driver entry carries last-seen ts; entries older than ~30 s are ignored (driver lost connectivity) and evicted.`,
      code: [
        {
          language: 'typescript',
          title: 'In-memory driver index keyed by H3 cell (h3-js v4)',
          code: `import { latLngToCell, gridDisk } from 'h3-js';

const RES = 9;                       // ~0.1 km^2 hexagons (edge ~200 m)
const STALE_MS = 30_000;

type Driver = { id: string; lat: number; lng: number; cell: string; ts: number; status: 'IDLE' | 'OFFERED' | 'ON_TRIP' };

export class DriverIndex {
  private byCell = new Map<string, Set<string>>();
  private drivers = new Map<string, Driver>();

  upsert(id: string, lat: number, lng: number, status: Driver['status']) {
    const cell = latLngToCell(lat, lng, RES);
    const prev = this.drivers.get(id);
    if (prev && prev.cell !== cell) this.byCell.get(prev.cell)?.delete(id); // moved cells
    if (!this.byCell.has(cell)) this.byCell.set(cell, new Set());
    this.byCell.get(cell)!.add(id);
    this.drivers.set(id, { id, lat, lng, cell, ts: Date.now(), status });
  }

  /** Idle, fresh drivers within k rings of the rider's cell, expanding until enough. */
  candidates(lat: number, lng: number, want = 10, maxK = 6): Driver[] {
    const origin = latLngToCell(lat, lng, RES);
    const now = Date.now();
    for (let k = 1; k <= maxK; k++) {
      const found: Driver[] = [];
      for (const cell of gridDisk(origin, k)) {          // hexagon rings: uniform distance
        for (const id of this.byCell.get(cell) ?? []) {
          const d = this.drivers.get(id)!;
          if (d.status === 'IDLE' && now - d.ts < STALE_MS) found.push(d);
        }
      }
      if (found.length >= want || k === maxK) return found;
    }
    return [];
  }
}`,
        },
      ],
      keyPoints: [
        'Driver pings every ~4 s → ~10^6 writes/s globally, but only latest position is hot (~1 GB).',
        'Index by H3 cell; shard by city/region; ignore stale drivers.',
        'Kafka fan-out of the location stream feeds tracking, ETA, surge and fraud.',
      ],
      source: 'Uber Engineering — H3; Ringpop; general ride-hailing design practice',
    },
    {
      heading: 'Uber (2/3): matching & dispatch without double-booking drivers',
      body: `**Matching pipeline:**
1. Rider requests → **trip created** (state REQUESTED) with an idempotency key (retries of the request button must not create two trips).
2. **Candidate generation:** gridDisk around the pickup cell for idle, fresh drivers (expanding rings until ~10 candidates).
3. **Ranking by ETA, not straight-line distance** — a driver 300 m away across a river/highway can be 10 min away. Call the routing/ETA service for the top N (batch request).
4. **Offer** to the best driver: atomically move the driver IDLE → OFFERED(tripId) with a **timeout** (10–15 s). If declined/expired, release and offer to the next.
5. On accept: driver OFFERED → ON_TRIP and trip MATCHING → DRIVER_ASSIGNED, in a way that can't race with another trip.

**The double-assignment race:** two riders near the same driver → two dispatchers pick the same driver concurrently. Solutions:
- **Partition matching by geography** so one dispatcher owns a cell/city region (single-writer) — simplest to reason about, but cells at borders need coordination.
- **Atomic compare-and-set on driver state** (Redis Lua, or a DB conditional update \`UPDATE drivers SET state='OFFERED', trip_id=$1 WHERE id=$2 AND state='IDLE'\`) — the loser picks the next candidate.

**Batched matching:** instead of greedily matching each request as it arrives, collect requests for ~1–2 s in an area and solve a bipartite assignment (minimise total ETA). Greedy can give rider A the driver that was the only good option for rider B. Uber, Lyft and DiDi all use batching variants.

**Offer timeout & retries:** the timeout must be enforced server-side (a delayed-job or TTL on the OFFERED lock), otherwise a driver whose phone died stays OFFERED forever. The Lua lock below uses a TTL key for exactly that.`,
      code: [
        {
          language: 'lua',
          title: 'Redis Lua: atomically offer a trip to a driver only if still idle (with TTL)',
          code: `-- KEYS[1] = driver:{id}:state   KEYS[2] = driver:{id}:offer
-- ARGV[1] = tripId  ARGV[2] = offer TTL seconds
local state = redis.call('GET', KEYS[1])
if state ~= 'IDLE' then
  return 0                                  -- someone else got this driver
end
redis.call('SET', KEYS[1], 'OFFERED')
-- the offer key expires on its own: a keyspace-notification/sweeper
-- flips the driver back to IDLE if nobody accepted in time
redis.call('SET', KEYS[2], ARGV[1], 'EX', tonumber(ARGV[2]))
return 1

-- accept.lua: KEYS same, ARGV[1] = tripId
-- local offered = redis.call('GET', KEYS[2])
-- if offered ~= ARGV[1] then return 0 end    -- expired or offered elsewhere
-- redis.call('SET', KEYS[1], 'ON_TRIP')
-- redis.call('DEL', KEYS[2])
-- return 1`,
        },
      ],
      keyPoints: [
        'Rank candidates by road ETA, not straight-line distance.',
        'Prevent double-booking with geo-partitioned single writers or atomic CAS on driver state.',
        'Batch requests for 1–2 s and solve assignment for better global outcomes.',
      ],
      source: 'Uber/Lyft engineering talks on dispatch; general marketplace design',
    },
    {
      heading: 'Uber (3/3): trip state machine, surge pricing, tracking & payments',
      body: `**Trip state machine:** make every transition explicit and **idempotent**, persisted with an optimistic version check. Clients retry, drivers lose signal, and duplicate "complete trip" calls must not double-charge.

States: REQUESTED → MATCHING → DRIVER_ASSIGNED → DRIVER_ARRIVED → IN_PROGRESS → COMPLETED → (payment) PAID; CANCELLED reachable from REQUESTED/MATCHING/DRIVER_ASSIGNED/DRIVER_ARRIVED (with cancellation fee rules); NO_DRIVERS_FOUND from MATCHING.

Store trips in a strongly consistent, sharded DB (Uber built Schemaless/Docstore on MySQL; Postgres/Spanner/CockroachDB are alternatives), sharded by trip_id or city. Emit every transition as an event (outbox → Kafka) for billing, notifications, analytics.

**Live tracking:** the rider subscribes (WebSocket) to the assigned driver's location channel — the Nearby Friends pattern with exactly one publisher and one subscriber.

**Surge pricing:**
- Per H3 cell (res ~7–8) compute **demand** (requests + app opens with destination) vs **supply** (idle drivers) over a short sliding window (1–5 min) from the Kafka streams.
- Multiplier = f(demand/supply), **smoothed** across neighbouring cells (gridDisk) and over time to avoid flicker and gaming (drivers going offline to trigger surge).
- The quoted price is **locked** with the fare quote ID for a few minutes; the trip references the quote so price can't change after the rider accepts.

**Payments:** authorise (hold) at request, capture at completion via a payment service with idempotency keys; payout to drivers in batches. Money never rides on eventual consistency.

**Wrap-up trade-offs:** in-memory geo index (fast, rebuilt from pings within seconds after a crash) vs persistence; greedy vs batched matching (latency vs efficiency); per-city isolation (a Mumbai outage doesn't affect São Paulo) vs global optimisation.`,
      code: [
        {
          language: 'typescript',
          title: 'Idempotent trip transitions with optimistic concurrency (pg)',
          code: `import type { Pool } from 'pg';

type TripState = 'REQUESTED' | 'MATCHING' | 'DRIVER_ASSIGNED' | 'DRIVER_ARRIVED'
  | 'IN_PROGRESS' | 'COMPLETED' | 'PAID' | 'CANCELLED' | 'NO_DRIVERS_FOUND';

const ALLOWED: Record<TripState, TripState[]> = {
  REQUESTED: ['MATCHING', 'CANCELLED'],
  MATCHING: ['DRIVER_ASSIGNED', 'NO_DRIVERS_FOUND', 'CANCELLED'],
  DRIVER_ASSIGNED: ['DRIVER_ARRIVED', 'MATCHING', 'CANCELLED'],   // MATCHING = driver dropped
  DRIVER_ARRIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: ['PAID'],
  PAID: [], CANCELLED: [], NO_DRIVERS_FOUND: [],
};

export async function transition(db: Pool, tripId: string, to: TripState, eventId: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Idempotency: the same client event applied twice is a no-op
    const dup = await client.query(
      'INSERT INTO trip_events (event_id, trip_id, to_state) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [eventId, tripId, to]);
    if (dup.rowCount === 0) { await client.query('ROLLBACK'); return 'DUPLICATE'; }

    const { rows } = await client.query('SELECT state, version FROM trips WHERE id=$1 FOR UPDATE', [tripId]);
    const cur = rows[0] as { state: TripState; version: number } | undefined;
    if (!cur) throw new Error('TRIP_NOT_FOUND');
    if (!ALLOWED[cur.state].includes(to)) throw new Error('ILLEGAL ' + cur.state + '->' + to);

    await client.query('UPDATE trips SET state=$1, version=version+1, updated_at=now() WHERE id=$2', [to, tripId]);
    await client.query(                                   // outbox: published by a relay
      "INSERT INTO outbox (topic, key, payload) VALUES ('trip-events', $1, $2)",
      [tripId, JSON.stringify({ tripId, from: cur.state, to, eventId })]);
    await client.query('COMMIT');
    return 'OK';
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
        'Explicit state machine; idempotent, versioned transitions; outbox events.',
        'Surge = smoothed demand/supply per H3 cell; price locked via quote ID.',
        'Payments: authorise at request, capture at completion, idempotency keys.',
      ],
      source: 'Uber Engineering — H3, Schemaless/Docstore; general marketplace design',
    },
    {
      heading: 'Food delivery (Swiggy / Zomato / DoorDash) — the three-sided variant',
      body: `**Intuition:** Uber with a kitchen in the middle. The rider (delivery partner) should arrive **exactly when the food is ready** — too early wastes their time, too late makes food cold.

**What changes versus ride-hailing:**
- **Three parties:** customer, restaurant, delivery partner. The order has its own state machine (PLACED → ACCEPTED_BY_RESTAURANT → PREPARING → READY → PICKED_UP → DELIVERED) alongside the partner assignment.
- **ETA = max(prep time, partner travel to restaurant) + restaurant→customer travel + handoff buffers.** Prep time is predicted per restaurant/dish/time-of-day with ML (kitchen load matters).
- **Assignment timing:** don't assign at order time; assign so partner arrival ≈ predicted ready time. Swiggy/DoorDash use batched assignment over a few seconds with cost functions combining partner idle time, food wait time and customer ETA.
- **Batching (stacking) orders:** one partner picks up two orders from the same/nearby restaurants going in similar directions — a vehicle-routing-with-time-windows problem solved heuristically.
- **Search & discovery:** restaurant listing is a *proximity service with a serviceability polygon* — each restaurant delivers to a polygon (not a radius) that shrinks dynamically when partners are scarce or rain hits. Precompute H3 cells covering each polygon → \`cell → restaurants\` index.
- **Peaks:** lunch/dinner spikes of 5–10×; rain surge; festival days (e.g., Diwali, IPL finals) — pre-scale, degrade gracefully (hide far restaurants, widen ETAs).

**Interview line:** *"I'll reuse the Uber dispatch core, but the objective function changes: minimise food wait + partner idle time, subject to predicted prep time, with batching as a first-class optimisation."*`,
      keyPoints: [
        'ETA combines ML prep time + two travel legs; assign so arrival ≈ ready time.',
        'Serviceability is a dynamic polygon → precomputed H3 cell covering.',
        'Order batching/stacking is the efficiency lever unique to delivery.',
      ],
      source: 'Swiggy/DoorDash engineering blogs (dispatch, prep-time prediction)',
    },
    {
      heading: 'Bottlenecks, trade-offs & wrap-up across location systems',
      body: `| Design | Read/write shape | Core structure | Main bottleneck | Key trade-off |
|---|---|---|---|---|
| Proximity (Yelp) | Read-heavy, static points | Geohash/quadtree/S2 index, replicated | Dense-cell hot spots, ranking | Replicate small index vs shard; stale edits acceptable |
| Nearby Friends | Write + fan-out heavy, moving points | Per-user pub/sub channels + TTL cache | Pub/sub CPU (14M/s), reconnect storms | Lossy real-time vs guaranteed delivery |
| Google Maps | Static tiles + 1M QPS location writes | Tiles on CDN, routing tiles, ML ETA | Tile egress, reroute computation | Raster vs vector tiles; ETA freshness vs cost |
| Uber | 10^6 driver pings/s, seconds-level matching | In-memory H3 index, dispatch, state machine | Double-assignment races, city hot spots | Greedy vs batched matching; in-memory vs durable index |
| Food delivery | Three-sided, peaky | Uber core + prep-time ML + batching | Meal-time peaks, weather | Partner utilisation vs food freshness |

**Common geo pitfalls to volunteer:**
- **Cell boundaries** — always search neighbours.
- **Distance ≠ travel time** — rank by ETA when the user will travel.
- **Location data is PII** — minimise retention, coarsen for analytics, encrypt at rest, strict access control.
- **Hot cells** — Times Square, stadium exits: split cells to finer resolution, cap candidates, cache per cell.
- **Staleness** — every location needs a timestamp and a TTL.

**Closing line:** *"At 10× I'd push geo-partitioning further (city-level cells as the unit of sharding and failure isolation), move ETA to pre-computed per-cell matrices refreshed every minute, and invest in batched matching."*`,
      keyPoints: [
        'Pick the index by data dynamics: static → replicated index; moving → in-memory cells + pub/sub.',
        'ETA, not distance, drives ranking when people travel.',
        'Timestamps + TTLs on every location; treat it as PII.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'design-geo-cc-1',
      title: 'Fix the "restaurants near me" endpoint',
      context:
        'Users near cell edges complain that a restaurant across the street is missing; the Redis hit ratio is 0.3%; and a query in central Mumbai returned 40,000 rows and timed out.',
      task:
        'Rewrite nearbyRestaurants so results near cell boundaries are correct, distances are real, the cache is actually reusable, and the response size is bounded.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { encode } from './geohash';
import { db } from './db';

export async function nearbyRestaurants(redis: Redis, lat: number, lng: number, radiusKm: number) {
  const cacheKey = 'near:' + lat + ':' + lng + ':' + radiusKm;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const cell = encode(lat, lng, 6);                  // always precision 6
  const { rows } = await db.query(
    'SELECT * FROM restaurants WHERE geohash LIKE $1', [cell + '%']);

  const result = rows.filter((r: any) => {
    const d = Math.sqrt((r.lat - lat) ** 2 + (r.lng - lng) ** 2);   // "km"
    return d <= radiusKm;
  });
  await redis.set(cacheKey, JSON.stringify(result));
  return result;
}`,
      },
      hints: [
        'What happens to a restaurant 20 m away but in the adjacent geohash cell? And a 5 km radius with a 1.2 km cell?',
        'How often will two users send the exact same floating-point lat/lng? Does the cache entry ever expire?',
        'Degrees are not kilometres — and one degree of longitude shrinks with latitude.',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { searchCells } from './geohash';
import { db } from './db';
import { haversineMeters } from './geo';

const PRECISION: [number, number][] = [[0.5, 6], [2, 5], [20, 4]];  // radius km -> len
const MAX_RESULTS = 50;

type R = { id: string; lat: number; lng: number; rating: number };

async function idsForCell(redis: Redis, precision: number, cell: string): Promise<R[]> {
  const key = 'cell:' + precision + ':' + cell;        // cache by CELL, reusable by everyone
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit) as R[];
  const { rows } = await db.query(
    'SELECT id, lat, lng, rating FROM restaurants WHERE geohash' + precision + ' = $1', [cell]);
  await redis.set(key, JSON.stringify(rows), 'EX', 3_600);   // listings change slowly
  return rows as R[];
}

export async function nearbyRestaurants(redis: Redis, lat: number, lng: number, radiusKm: number, cursor = 0) {
  if (radiusKm <= 0 || radiusKm > 20) throw new Error('INVALID_RADIUS');
  const precision = PRECISION.find(([r]) => radiusKm <= r)![1];
  const cells = searchCells(lat, lng, precision);      // cell + 8 neighbours
  const perCell = await Promise.all(cells.map((c) => idsForCell(redis, precision, c)));

  const within = perCell.flat()
    .map((r) => ({ ...r, distanceM: haversineMeters(lat, lng, r.lat, r.lng) }))
    .filter((r) => r.distanceM <= radiusKm * 1000)
    .sort((a, b) => a.distanceM - b.distanceM || b.rating - a.rating);

  return {
    total: within.length,
    items: within.slice(cursor, cursor + MAX_RESULTS),    // bounded page
    nextCursor: cursor + MAX_RESULTS < within.length ? cursor + MAX_RESULTS : null,
  };
}`,
      },
      explanation: `**Fixes:**
- **Boundary misses:** querying one cell drops neighbours across the edge. \`searchCells\` returns the cell + 8 neighbours.
- **Radius vs precision:** a fixed precision-6 cell (1.2 km × 609 m) can't serve a 5 km radius. Precision is now chosen from the radius (6 / 5 / 4).
- **Useless cache:** keys on raw float coordinates never repeat and never expired (memory leak). Caching **per cell** is shared by every user in that area and has a TTL.
- **Fake distance:** Euclidean distance on degrees is not km, and longitude degrees shrink with latitude. Haversine gives metres.
- **Unbounded response:** \`SELECT *\` over a dense area returned 40K wide rows. Select only needed columns, filter, rank, and paginate with a cursor (hydrate details for the page only).
- **Index-friendly query:** equality on a stored fixed-precision geohash column instead of a LIKE prefix, and input validation on radius.`,
      followUps: [
        {
          "q": "A restaurant changes location or closes. Your per-cell cache has a 1-hour TTL. How do you invalidate it, and what's the race?",
          "a": "On a write, the business service publishes a change event (via an outbox or CDC). An invalidator deletes `cell:<p>:<cell>` for each precision (6, 5 and 4) and for both the old and the new cell if the location moved. The race: a reader misses, loads the old rows from the DB, the writer commits and deletes the key, then the reader writes its stale result back, which lives for an hour. Mitigate with a short delayed second delete (about 1 s later), or version the key with a per-cell version counter that the writer bumps, so stale fills land on an old key nobody reads. The TTL bounds any remaining staleness."
        },
        {
          "q": "In central Mumbai one precision-6 cell holds 4,000 restaurants and the cell JSON is huge. How would you adapt the code?",
          "a": "Fetching nine large blobs and computing haversine for 30K rows per request wastes bandwidth and CPU. Options: pick precision adaptively by density rather than only by radius, so dense areas use precision 7 (about 153 m × 153 m) and more cells. Cache only compact tuples `[id, lat, lng, rating]`, about 30 bytes each, instead of full objects. Or use Redis GEOSEARCH with BYRADIUS and COUNT, which does the radius filter and sort server-side and returns only the top N. Track the cell-size distribution so the hot cells are known, and keep a separate prefiltered list per cell for common filters like \"open now\"."
        }
      ],
    },
    {
      id: 'design-geo-cc-2',
      title: 'Make the dispatch loop safe',
      context:
        'Ops reports that a single driver sometimes receives two trip offers at once, riders wait forever when a driver ignores an offer, and riders are matched to drivers "300 m away" who are actually on the other side of a river.',
      task:
        'Fix dispatchTrip so a driver can never be double-offered, offers expire, candidates are ranked by what riders actually experience, and the loop terminates.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { index } from './driver-index';
import { sendOffer, waitForAnswer } from './driver-gateway';

export async function dispatchTrip(redis: Redis, tripId: string, lat: number, lng: number) {
  while (true) {
    const drivers = index.candidates(lat, lng, 10);
    drivers.sort((a, b) =>
      Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng));
    for (const d of drivers) {
      const state = await redis.get('driver:' + d.id + ':state');
      if (state !== 'IDLE') continue;
      await redis.set('driver:' + d.id + ':state', 'OFFERED');
      await sendOffer(d.id, tripId);
      const accepted = await waitForAnswer(d.id, tripId);   // resolves when driver taps
      if (accepted) {
        await redis.set('driver:' + d.id + ':state', 'ON_TRIP');
        return d.id;
      }
    }
  }
}`,
      },
      hints: [
        'Two dispatchers can run GET → SET for the same driver concurrently. What primitive makes that atomic?',
        'waitForAnswer has no deadline; what if the phone is dead? And what state is the driver left in after a decline?',
        'Straight-line distance vs road ETA — and how many rounds should a search run before giving up?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { index } from './driver-index';
import { sendOffer, waitForAnswer } from './driver-gateway';
import { etaSeconds } from './routing';       // batched road-network ETA
import { transition } from './trips';

const OFFER_TTL_S = 15;
const MAX_ROUNDS = 4;

const TRY_OFFER = [
  "if redis.call('GET', KEYS[1]) ~= 'IDLE' then return 0 end",
  "redis.call('SET', KEYS[1], 'OFFERED')",
  "redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])",
  'return 1',
].join('\\n');

const RELEASE = [                            // only release if the offer is still ours
  "if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end",
  "redis.call('DEL', KEYS[2])",
  "redis.call('SET', KEYS[1], 'IDLE')",
  'return 1',
].join('\\n');

export async function dispatchTrip(redis: Redis, tripId: string, lat: number, lng: number) {
  const tried = new Set<string>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const cands = index.candidates(lat, lng, 10, 2 + round)   // widen rings each round
      .filter((d) => !tried.has(d.id));
    const etas = await etaSeconds(cands.map((d) => ({ lat: d.lat, lng: d.lng })), { lat, lng });
    const ranked = cands.map((d, i) => ({ d, eta: etas[i] }))
      .filter((x) => x.eta < 20 * 60)                          // road ETA, not distance
      .sort((a, b) => a.eta - b.eta);

    for (const { d } of ranked) {
      tried.add(d.id);
      const stateKey = 'driver:' + d.id + ':state', offerKey = 'driver:' + d.id + ':offer';
      const ok = await redis.eval(TRY_OFFER, 2, stateKey, offerKey, tripId, OFFER_TTL_S);
      if (ok !== 1) continue;                                  // lost the race: next driver
      await sendOffer(d.id, tripId);
      const accepted = await waitForAnswer(d.id, tripId, AbortSignal.timeout(OFFER_TTL_S * 1000))
        .catch(() => false);
      if (accepted && (await transition(tripId, 'DRIVER_ASSIGNED', d.id)) === 'OK') {
        await redis.set(stateKey, 'ON_TRIP');
        await redis.del(offerKey);
        return d.id;
      }
      await redis.eval(RELEASE, 2, stateKey, offerKey, tripId); // decline/timeout -> IDLE
    }
  }
  await transition(tripId, 'NO_DRIVERS_FOUND', null);
  return null;
}`,
      },
      explanation: `**Fixes:**
- **Double offers:** GET-then-SET is a race across dispatcher instances. A Lua script checks IDLE and sets OFFERED atomically; the loser moves on.
- **Stuck offers:** the offer key has a TTL and \`waitForAnswer\` has a deadline, so a dead phone can't pin the driver or the rider. A sweeper/keyspace notification also resets drivers whose offer key expired (not shown).
- **Leaked OFFERED state:** declines/timeouts now release the driver back to IDLE — but only if the offer still belongs to this trip (compare-and-release).
- **Wrong ranking:** candidates are ranked by **road ETA** from the routing service, with a max ETA cutoff.
- **Infinite loop:** bounded rounds, widening the search ring each round, never re-offering the same driver; ends in NO_DRIVERS_FOUND.
- **Trip consistency:** the trip transition is the source of truth (idempotent, versioned); the driver state is set ON_TRIP only after the trip accepts the assignment.`,
      followUps: [
        {
          "q": "This dispatches one trip at a time. At peak in a dense area, greedy per-request matching produces poor global results. How would you change the design?",
          "a": "Switch to batched matching: collect ride requests in a city zone for a short window (2–5 s), build a bipartite graph of riders and nearby idle drivers with road-ETA edge costs, and solve an assignment problem (the Hungarian algorithm, or min-cost flow for larger batches) that minimises total ETA. Greedy takes the closest driver for rider A even if that driver was the only good option for rider B. The trade-off is a few seconds of added latency for every request, so batch only when demand is dense and use greedy when it is sparse. The offer, TTL and release logic from this code still applies per assignment."
        },
        {
          "q": "How would you test the timeout and release logic deterministically?",
          "a": "Inject the clock and the gateway. Use a real Redis (Testcontainers) for the Lua scripts, a fake `sendOffer` and `waitForAnswer` whose outcomes the test controls, and fake timers (or a short OFFER_TTL in tests) for timeouts. Cases: a driver never answers, so after the deadline it is IDLE and the next driver gets the offer; the driver declines, so it is released immediately; the offer key expires, then a late accept arrives, so the trip transition rejects it; two concurrent dispatchTrip calls on the same candidate list, so each driver receives at most one offer; and no drivers at all, so the loop ends after MAX_ROUNDS with NO_DRIVERS_FOUND. Assert final Redis state, not just return values."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-geo-iq-01',
      difficulty: 'hard',
      question: 'Design a proximity service like Yelp: find businesses within a radius of the user, for 100M DAU and 200M businesses.',
      whatInterviewerLooksFor: [
        'Quantified read-heavy workload (~5K QPS) and relaxed write freshness',
        'Clear comparison of geo-index options and a justified choice',
        'Boundary handling (neighbour cells) and precision selection',
        'Replication over sharding with reasoning; caching by cell',
      ],
      modelAnswer: `### Scope & numbers
- Search by (lat, lng, radius ≤ 20 km), business CRUD (visible next day), details page. 100M DAU × 5 searches ÷ 10^5 ≈ **5K QPS**, peak ~15–25K. 200M businesses × ~1 KB ≈ 200 GB.

### API
- \`GET /v1/search/nearby?lat&lng&radius&cursor\`, \`GET/POST/PUT/DELETE /v1/businesses/:id\`.

### Index choice
- **Geohash** stored at precisions 4/5/6 in a \`geo_index(precision, geohash, business_id)\` table — simple, works in any DB and Redis, cheap updates.
- Alternative **quadtree** (in-memory, adapts to density, ~1.7 GB for 200M, minutes to build) if we need kNN; **S2** if we need polygons/geofences.
- Always query **cell + 8 neighbours**, choose precision from radius (0.5 km→6, 1–2 km→5, 5–20 km→4), filter with haversine, expand precision if too few results.

### Architecture
- Stateless **LBS** (read-only) + **business service** (writes). MySQL/Postgres primary + many read replicas.
- Redis caches: \`geohash → [ids]\` (~5 GB across 3 precisions) and \`id → business\`. **Replicate per region** — the index is small, every query touches arbitrary cells, so sharding buys nothing.
- Nightly job (or CDC) refreshes caches since edits needn't be real-time.

### Deep dives
- Dense cells: rank (distance, rating, open-now), paginate, cache per cell+category.
- Multi-region with geo-DNS; data residency.

### Trade-offs
- Geohash's edge effects vs quadtree's operational complexity; replication cost vs simplicity; eventual freshness of listings.`,
      followUps: [
        { q: 'Now business owners want edits visible within 5 seconds.', a: 'Switch from nightly rebuild to CDC (Debezium) → update geohash sets in Redis and invalidate the business object; with a quadtree, you would need locking per node or periodic rebuilds, which is why geohash is easier here.' },
        { q: 'Users want "the 10 nearest", regardless of radius.', a: 'Start with a fine precision and widen (drop a char) until ≥10 candidates, then sort by distance; quadtree or Redis GEOSEARCH with COUNT handles kNN more naturally.' },
      ],
      pitfalls: [
        'Sharding a 5 GB index by geography and creating cross-shard queries.',
        'Querying only the user’s own geohash cell.',
        'Caching by raw lat/lng.',
      ],
    },
    {
      id: 'design-geo-iq-02',
      difficulty: 'hard',
      question: 'Design Nearby Friends: opted-in users see friends within 5 miles, updated every ~30 seconds.',
      whatInterviewerLooksFor: [
        'Fan-out math: ~334K updates/s → ~14M forwards/s',
        'WebSocket + per-user pub/sub channels + TTL location cache',
        'Scaling a stateful tier: draining, reconnect storms, consistent hashing for pub/sub',
        'Understands why lossy delivery is acceptable',
      ],
      modelAnswer: `### Numbers
- 100M DAU, 10M concurrent; update every 30 s → **~334K updates/s**. 400 friends, ~10% online-nearby → **~14M forwards/s**.

### Architecture
- **WebSocket servers** (stateful) hold connections; **API servers** for friends/profile.
- **Location cache** (Redis): \`loc:{user}\` with TTL 10 min — inactivity handled by expiry.
- **Location history**: Kafka → Cassandra (write-heavy, time-ordered).
- **Redis pub/sub**: channel per user. On update: set cache, publish to \`ch:{me}\`. Each friend's WS handler (subscribed at connect time) receives it, computes distance, pushes if ≤ 5 mi.
- On connect: load friends, MGET their cached locations, push nearby ones, subscribe to all friends' channels.

### Scaling
- Pub/sub: ~200 GB of subscriber pointers but **~140 nodes for CPU** at 100K pushes/s each; distribute channels by consistent hashing, ring stored in etcd/ZooKeeper, over-provision because resharding forces re-subscribe.
- WS tier: drain before removal; clients reconnect with jittered backoff; deploy in waves.

### Why these choices
- Lossy is fine: the next update arrives in 30 s — so no durable queue on the hot path.
- Distance filtering at the subscriber side keeps publishers simple (they don't know who's near).

### Extensions
- Random nearby people: channel per geohash cell. Celebrities with 5K friends: cap subscribers or reduce frequency.`,
      followUps: [
        { q: 'Why not compute nearby friends with a geo query on every update?', a: '334K geo queries/s over a constantly changing index is far more expensive than fan-out along the friend graph; the friend list bounds the candidates to ~400 per user.' },
        { q: 'A pub/sub node dies. What do users see?', a: 'Updates on channels mapped to it stop until a replacement takes its slot and WS servers re-subscribe (seconds). Friends appear stale briefly; the cache still returns last-known locations until TTL.' },
        { q: 'How would you reduce battery usage?', a: 'Adaptive update frequency (less when stationary, via motion sensors), batch updates, and only send when the app is foregrounded or the feature active.' },
      ],
      pitfalls: [
        'Using Kafka topics per user or durable queues for ephemeral updates.',
        'Ignoring reconnect storms when deploying the WebSocket tier.',
        'Sizing pub/sub only by memory.',
      ],
    },
    {
      id: 'design-geo-iq-03',
      difficulty: 'expert',
      question: 'Design Google Maps: map rendering, location updates and turn-by-turn navigation with live ETA for 1B DAU.',
      whatInterviewerLooksFor: [
        'Separates tiles (static CDN), location ingestion, and routing',
        'Estimates: ~100 PB tiles order of magnitude, ~200K–1M QPS location writes',
        'Routing tiles + hierarchy + A*/contraction hierarchies',
        'Adaptive ETA/rerouting design and push channel choice',
      ],
      modelAnswer: `### Numbers
- Tiles: 4^21 ≈ 4.4T at max zoom, ~100 KB each, most compress to near nothing → ~50 PB at z21, ~67–100 PB all zooms. Static → object storage + CDN.
- Location: 1B DAU × 35 min/week ≈ 5B min/day; 1 Hz GPS → 3M QPS, **batched every 15 s → ~200K QPS, ~1M peak**.

### Map rendering
- Pre-rendered raster or **vector tiles** addressed by (z, x, y); client computes tile URLs; CDN with immutable URLs; on-device cache and prefetch along route.

### Location service
- Batched HTTP uploads → Cassandra \`((user_id, day), ts)\` + Kafka. Consumers: traffic update service (live segment speeds), routing-tile updater (new roads), ML/personalisation.

### Navigation
- Geocode → route planner → **shortest-path service** on **routing tiles** (adjacency lists in S3, cached), three-level hierarchy (local/arterial/highway), A* or contraction hierarchies → **ETA service** (ML on live + historical traffic) → **ranker** (avoid tolls etc.).

### Adaptive ETA & reroute
- Keep active navigation sessions with the routing tiles they traverse; index by tile hierarchy so a traffic change in tile X quickly finds affected sessions; recompute ETA; if a better route beats the current by a threshold, push over the session's **WebSocket**.

### Trade-offs
- Raster (simple server) vs vector (bandwidth, client CPU).
- Recompute on events vs periodic.
- Privacy: retention limits and anonymised traces for traffic.`,
      followUps: [
        { q: 'How do you detect a road closure without an official data feed?', a: 'From the location stream: a segment with historic flow suddenly has zero traversals while nearby detours spike; confirm with multiple signals before updating routing tiles.' },
        { q: 'Why not stream location over WebSocket too?', a: 'Batched periodic uploads are client-initiated and tolerate delay — HTTP is simpler, stateless on the server, and radio-friendly. WebSocket is reserved for server push during navigation.' },
      ],
      pitfalls: [
        'Running Dijkstra over a single planetary graph at request time.',
        'Serving tiles from application servers instead of CDN.',
        'Forgetting mobile data/battery as a non-functional requirement.',
      ],
    },
    {
      id: 'design-geo-iq-04',
      difficulty: 'expert',
      question: 'Design Uber’s ride-matching system. Riders must be matched to a driver within seconds and no driver may be assigned two trips.',
      context: 'Interviewer from a ride-hailing company; expect probes on geo index, dispatch races, surge and failure handling.',
      whatInterviewerLooksFor: [
        'Location ingestion at ~10^6 writes/s with in-memory latest-position index',
        'H3/S2 geo index and geo-sharding',
        'Atomic driver reservation with offer timeout',
        'ETA-based ranking, batched matching, trip state machine',
        'Surge and failure modes per city',
      ],
      modelAnswer: `### Numbers
- 5M online drivers at peak × 1 ping/4 s ≈ **1.25M writes/s**; latest positions ≈ 1 GB in memory. Matches ~1–2K/s peak.

### Ingestion
- Driver app keeps a long-lived connection to the edge; **location service** updates an in-memory **H3 (res 9)** index sharded by city/cell and publishes to Kafka (tracking, ETA models, surge, fraud). Entries older than 30 s are ignored.

### Matching
1. Trip REQUESTED (idempotency key) → MATCHING.
2. Candidates: \`gridDisk(pickupCell, k)\` idle drivers, widening k.
3. Rank by **road ETA** (batched routing call), not distance.
4. Reserve: atomic CAS IDLE → OFFERED(trip) with TTL 15 s (Lua or conditional update). Loser moves on.
5. Accept → trip DRIVER_ASSIGNED (versioned transition), driver ON_TRIP; decline/timeout → compare-and-release to IDLE, next candidate.
- **Batched matching** every 1–2 s per area to optimise total ETA; single-writer dispatcher per geo partition simplifies races.

### Trip & payments
- Trip state machine in a strongly consistent sharded store with an outbox; payment authorise at request, capture on completion, idempotent.

### Surge
- Demand/supply per H3 res-7/8 cell over 1–5 min windows, smoothed over neighbours/time; quote ID locks price.

### Failures
- Dispatcher crash: in-memory index rebuilds from pings within seconds; in-flight offers expire via TTL.
- Per-city isolation (cell-based architecture) limits blast radius.`,
      followUps: [
        { q: 'Two cities share a border and a rider is on the border. Which dispatcher owns it?', a: 'Partition by cell sets with overlap handling: the owning partition is the pickup cell’s; candidate search may read neighbouring partitions’ indexes, but reservation still goes through the atomic CAS on the driver, which is the true arbiter.' },
        { q: 'How do you prevent drivers gaming surge by going offline together?', a: 'Smooth surge over time and space, weight app-open demand signals, detect coordinated offline events, and cap multiplier change rate.' },
        { q: 'A driver’s phone reports stale GPS or teleports (spoofing).', a: 'Validate speed between pings (reject > physical limits), snap to road network, and flag mock-location apps; ignore entries older than the staleness threshold.' },
      ],
      pitfalls: [
        'Sorting candidates by straight-line distance.',
        'Read-then-write driver reservation.',
        'No timeout on offers.',
        'Persisting every ping synchronously to a relational DB.',
      ],
    },
    {
      id: 'design-geo-iq-05',
      difficulty: 'hard',
      question: 'Design a food-delivery platform like Swiggy or Zomato: restaurant discovery, order placement, delivery-partner assignment and live tracking.',
      whatInterviewerLooksFor: [
        'Recognises three-sided marketplace and two state machines (order, partner)',
        'Serviceability polygons indexed by cells',
        'ETA decomposition with prep-time prediction and assignment timing',
        'Order batching and peak-hour strategy',
      ],
      modelAnswer: `### Scope
- Discovery (restaurants serviceable to my address, search, menu), cart & checkout, restaurant order management, partner assignment, live tracking, payments. Peak 5–10× at lunch/dinner.

### Discovery
- Each restaurant has a **serviceability polygon** (not a radius) that shrinks when partners are scarce or it rains. Precompute H3 res-8 cells covering each polygon → \`cell → [restaurant ids]\` in Redis; user's address → cell → candidates → filter open/online → rank (ETA, rating, personalization) → Elasticsearch for text search ("biryani").

### Order flow
- Order state machine: PLACED → ACCEPTED → PREPARING → READY → PICKED_UP → DELIVERED (+ CANCELLED/REJECTED). Payment authorised at checkout, captured on delivery. Outbox events notify restaurant tablet, customer, partner app.

### Assignment
- **ETA = max(predicted prep, partner→restaurant) + restaurant→customer + buffers.** Prep time ML per restaurant/dish/load.
- Assign so partner arrival ≈ ready time: a batched optimiser runs every few seconds per zone, cost = partner idle + food wait + customer delay; supports **stacking** two compatible orders.
- Reservation of a partner uses the same atomic CAS + offer TTL as ride-hailing.

### Tracking
- Partner pings every ~5 s → location service → Kafka + latest-position cache; customer subscribes via WebSocket/SSE after pickup.

### Peaks & degradation
- Pre-scale before meal times; shrink polygons and widen ETAs under shortage; queue-based admission for checkout during mega-sales.`,
      followUps: [
        { q: 'Restaurant tablet is offline when an order is placed.', a: 'Order stays PLACED with an acceptance timeout; escalate via IVR call to the restaurant; auto-cancel and refund if not accepted in N minutes.' },
        { q: 'How do you decide to stack two orders?', a: 'Same or nearby restaurants, ready times within a few minutes, and drop-offs in similar directions such that the second customer’s ETA degrades less than a threshold.' },
      ],
      pitfalls: [
        'Assigning a partner immediately at order time regardless of prep time.',
        'Using a fixed radius for serviceability.',
        'Ignoring the restaurant as an unreliable participant.',
      ],
    },
    {
      id: 'design-geo-iq-06',
      difficulty: 'expert',
      question: 'Deep-dive probe: geohash vs quadtree vs S2/H3 — you are building a geofencing feature ("notify me when I enter this airport polygon") for 50M users. Which index and why?',
      whatInterviewerLooksFor: [
        'Recognises the query is point-in-polygon, not radius search',
        'Knows region covering (S2) / polyfill (H3)',
        'Two-phase filter: coarse cell match then exact polygon test',
        'Scale of evaluation: per location update',
      ],
      modelAnswer: `### Reframe the query
- It's the inverse of proximity search: for each **location update**, which of the stored **polygons** contain the point? Millions of users × periodic updates, and thousands to millions of fences.

### Index choice: S2 (or H3 polyfill)
- **S2 region covering**: represent each polygon as a small set of S2 cells at mixed levels (e.g., ≤ 20–50 cells), split into **interior** cells (definitely inside) and **boundary** cells.
- Build an index \`cellId → [fenceIds]\`. For a user point, compute its leaf cell and walk up its ancestors (≤ 30 levels) → lookup → candidate fences.
- Interior hit → inside; boundary hit → exact point-in-polygon test (ray casting). Most points resolve with zero geometry math.
- H3 alternative: polyfill polygons at a fixed resolution (+ compact), lookup the point's cell at that res; boundary cells need exact testing too.

### Why not geohash / quadtree
- Geohash cells are rectangles that fit polygons poorly (lots of boundary cells) and have weird adjacency across prefix boundaries. Quadtrees index points, not polygons, and need rebuilds.

### Evaluating at scale
- 50M users × 1 update/min ≈ 830K evaluations/s → stateless evaluators with the (small) fence index in memory, partitioned by region; keep per-user "currently inside" state to emit **enter/exit transitions** only (dedup, hysteresis to avoid flapping at the edge).

### Mobile optimisation
- Push nearby fences to the device and use OS geofencing APIs (iOS limits ~20 regions per app) to wake the app — server evaluation as fallback.`,
      followUps: [
        { q: 'A user sits right on the boundary and flaps in/out every update.', a: 'Hysteresis: require N consecutive readings or a minimum distance inside/outside before emitting a transition; also use GPS accuracy radius.' },
        { q: 'Fences change hourly. How do you update the index?', a: 'Recompute the covering for the changed fence and swap cell entries atomically (versioned index snapshot); evaluators hot-reload snapshots.' },
      ],
      pitfalls: [
        'Treating it as a radius search around the user.',
        'Running exact polygon tests against every fence.',
        'Emitting an event on every update instead of transitions.',
      ],
    },
    {
      id: 'design-geo-iq-07',
      difficulty: 'hard',
      question: 'Your WebSocket tier for live locations holds 10M connections across 200 servers. A routine deploy just caused a 20-minute outage. What happened and how do you redesign deploys and reconnections?',
      context: 'Postmortem: during a rolling restart, auth service CPU went to 100%, friend-list DB hit max connections, and reconnect attempts snowballed.',
      whatInterviewerLooksFor: [
        'Identifies reconnect storm / thundering herd',
        'Connection draining and graceful migration',
        'Client backoff with jitter and server-side admission control',
        'Caching the expensive per-connection init work',
      ],
      modelAnswer: `### What happened
- Restarting servers dropped ~50K connections each at once; clients reconnected **immediately and in sync**, each reconnect doing JWT validation + friend-list DB load + N subscribes. Auth and DB saturated → timeouts → clients retried faster → **metastable failure** that persisted after the deploy finished.

### Fix the deploy
- **Drain**: mark the node draining at the LB, stop accepting new connections, then ask clients to migrate in small batches (close code "please reconnect" spread over minutes), then terminate.
- Smaller waves (e.g., 2% of the fleet at a time) and **surge capacity** before deploying.
- Longer-lived nodes: separate the connection-holding layer from business logic so most deploys don't touch the WS tier.

### Fix the clients
- Exponential backoff with **full jitter**, cap ~60 s; honour a server-provided \`retry-after\`; resume tokens.

### Fix the servers
- **Admission control**: token bucket on new connections per server; reject fast with retry-after rather than accepting and timing out.
- **Cheaper init**: session resumption token (skip full auth), cache friend lists in Redis, batch subscribes, lazily load far-away friends.
- Load shedding on auth and DB with circuit breakers; connection pools sized with headroom.

### Verify
- Game-day: kill 10% of WS servers and watch reconnect rate, auth p99 and DB connections; alert on reconnect rate spikes.`,
      followUps: [
        { q: 'Why is this called metastable?', a: 'The trigger (deploy) ends but the system stays down because retries sustain the overload; recovery needs load reduction (shedding/backoff), not just removing the trigger.' },
        { q: 'Could you avoid dropping connections at all?', a: 'Only partially: some proxies (Envoy) support hot restart for the proxy layer, but application restarts still need migration; putting a thin, rarely-deployed connection gateway in front is the common pattern.' },
      ],
      pitfalls: [
        'Adding more servers without fixing synchronized retries.',
        'Fixed-interval reconnects without jitter.',
        'Doing full auth + DB loads on every reconnect.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-geo-boe-1',
      question: 'Size the Redis pub/sub tier for Nearby Friends with 100M feature users, 10M concurrent, updates every 30 s.',
      assumptions: [
        'Each user has ~100 friends who are feature users (channel subscribers), ~20 B per subscriber pointer',
        '~40 of a user’s friends are online and receive each update',
        'One Redis node sustains ~100K subscriber pushes/s',
        'Nodes have ~100 GB usable memory',
      ],
      steps: [
        { label: 'Update rate', calc: '10M ÷ 30 s ≈ 334K publishes/s' },
        { label: 'Fan-out', calc: '334K × 40 ≈ 13.4M ≈ 14M pushes/s' },
        { label: 'Memory', calc: '100M channels × 100 subs × 20 B = 200 GB → 2 nodes by memory' },
        { label: 'CPU', calc: '14M ÷ 100K ≈ 140 nodes' },
        { label: 'Headroom', calc: '140 × 1.3 ≈ 180 nodes (resharding is disruptive, so over-provision)' },
      ],
      answer: '~140–180 Redis pub/sub nodes — CPU-bound; memory alone would suggest only 2.',
      insight: 'The binding constraint is message fan-out CPU, not storage. That pushes you to (a) filter as early as possible, (b) reduce update frequency adaptively, and (c) consider alternatives like Erlang-based pub/sub. It also means channel placement via consistent hashing must be planned upfront.',
      followUps: [
        {
          "q": "Product lets stationary users update every 120 s instead of 30 s. 60% of concurrent users are stationary. Redo the node count.",
          "a": "Publishes per second become 10M × (0.4 ÷ 30 + 0.6 ÷ 120) ≈ 133K + 50K ≈ 183K, down from 334K. Fan-out at 40 online friends is about 7.3M pushes/s, which needs about 73 nodes at 100K pushes/s, or about 95 with 30% headroom: nearly half the original fleet. Stationary detection is done on the client (accelerometer, no significant GPS change), which also saves battery. The trade-off is that a stationary user who starts moving appears late by up to 120 s unless the client sends an immediate update on a motion event, which it should."
        },
        {
          "q": "With ~180 nodes, one pub/sub node dies. How many users are affected and for how long?",
          "a": "With consistent hashing, about 1/180 of the 100M channels live on the node, roughly 556K channels. Every subscriber of those channels stops getting that friend's updates, so nearly every online user loses some friends' updates, not just a few users losing all of them. Recovery time is detection plus remap plus re-subscribe plus one update interval: say 10 s for health checks, a few seconds for re-subscription with jitter, and up to 30 s until the next location publish, so under a minute of frozen markers for the affected friends. No data restore is needed because pub/sub holds no state."
        }
      ],
    },
    {
      id: 'design-geo-boe-2',
      question: 'Estimate Google Maps location-ingestion QPS and one year of location-history storage.',
      assumptions: [
        '1B DAU, 35 minutes of navigation per user per week',
        'GPS sampled every 1 s, uploaded in 15-s batches',
        'Each GPS point ≈ 30 B compressed (lat, lng, ts, speed, heading)',
        'Peak = 5× average; replication factor 3',
      ],
      steps: [
        { label: 'Navigation minutes/day', calc: '1B × 35 ÷ 7 = 5B minutes/day' },
        { label: 'Points/day', calc: '5B × 60 = 3 × 10^11 points/day' },
        { label: 'Raw QPS (per point)', calc: '3 × 10^11 ÷ 10^5 ≈ 3M points/s' },
        { label: 'Batched request QPS', calc: '3M ÷ 15 ≈ 200K req/s; peak ×5 ≈ 1M req/s' },
        { label: 'Storage/day', calc: '3 × 10^11 × 30 B ≈ 9 TB/day' },
        { label: 'Storage/year', calc: '9 TB × 365 ≈ 3.3 PB × RF3 ≈ 10 PB' },
      ],
      answer: '~200K requests/s average (~1M peak) carrying ~3M points/s, and ~10 PB/year of replicated history.',
      insight: 'Batching cuts request rate 15× but not data volume — so the storage tier (Cassandra/Bigtable) must handle ~3M rows/s, and retention/down-sampling policy (keep raw 30 days, aggregate after) is a major cost lever.',
      followUps: [
        {
          "q": "Finance wants storage cut sharply. Keep raw points for 30 days and down-sample to one point per 15 s afterwards. What's the yearly replicated footprint?",
          "a": "Raw retention: 9 TB/day × 30 days × RF3 ≈ 810 TB. Down-sampled for the remaining 335 days: 9 TB ÷ 15 = 0.6 TB/day × 335 ≈ 201 TB, × 3 ≈ 603 TB. Total about 1.4 PB per year instead of about 10 PB, a 7× reduction. You lose fine-grained traces for old data, which matters for map-matching new roads but little for traffic history; those uses can be served by aggregated speed-per-segment tables, which are far smaller still. Erasure coding instead of 3× replication in the cold tier cuts the archive cost about another 2×."
        },
        {
          "q": "Battery complaints lead to batching every 60 s instead of 15 s. What improves and what gets worse?",
          "a": "Requests drop 4×: 3M points/s ÷ 60 is about 50K req/s average and about 250K at peak, and the radio wakes a quarter as often, which is the real battery win. Data volume is unchanged. The cost is freshness: live traffic now sees each car's points up to 60 s late, so congestion detection lags by about a minute, and server-side checks for whether the user has left the route take longer. Navigation itself is unaffected because rerouting is driven by on-device GPS against the downloaded route. A good compromise is adaptive batching: 60 s on highways at steady speed, shorter in dense city traffic."
        }
      ],
    },
    {
      id: 'design-geo-boe-3',
      question: 'Uber: estimate driver location write throughput, in-memory index size, and Kafka partitions for the location stream.',
      assumptions: [
        '5M drivers online at global peak, one ping every 4 s',
        'Ping payload ≈ 150 B on the wire, 200 B per driver entry in memory (id, lat, lng, cell, ts, status)',
        'A Kafka partition comfortably handles ~10 MB/s',
      ],
      steps: [
        { label: 'Writes/s', calc: '5M ÷ 4 = 1.25M pings/s' },
        { label: 'Ingress bandwidth', calc: '1.25M × 150 B ≈ 190 MB/s' },
        { label: 'Hot index memory', calc: '5M × 200 B = 1 GB (+ cell sets ~2×) ≈ 2–3 GB' },
        { label: 'Kafka partitions', calc: '190 MB/s ÷ 10 MB/s ≈ 19 → 64 partitions for headroom and consumer parallelism' },
        { label: 'Per-city shard', calc: 'Largest city ~5% of drivers ≈ 62K pings/s — one or two index shards per large city' },
      ],
      answer: '~1.25M writes/s (~190 MB/s), a 2–3 GB in-memory index globally, and ~64 Kafka partitions for the raw stream.',
      insight: 'The latest-position index is tiny — so keep it in memory and rebuild from pings after a crash instead of persisting every ping to a database. Throughput, not size, dictates sharding, and partitioning by city gives both load spreading and failure isolation.',
      followUps: [
        {
          "q": "Product wants pings every 1 s for smoother car animation on the rider's map. What changes?",
          "a": "Writes go 4× to 5M pings/s and ingress to 5M × 150 B = 750 MB/s, which needs at least 75 Kafka partitions at 10 MB/s, so plan for about 128. Index memory doesn't change, since it stores the latest position per driver. The largest city goes to about 250K pings/s, needing several index shards. Driver battery and mobile data also go up 4×. A cheaper alternative: keep 4 s pings and have the rider's app interpolate the car along the matched road path between points, which looks smooth. Increase frequency only for the one driver assigned to an active trip."
        },
        {
          "q": "An in-memory index shard for a big city crashes. How long until dispatch there works again, given you don't persist pings to a database?",
          "a": "Very quickly. A replacement instance subscribes to that city's Kafka partitions starting a few seconds back (or from the latest offset). Since every online driver pings every 4 s, the full latest-position set for the city is rebuilt within about one ping interval, roughly 4–8 s including startup. During that window dispatch for the city either waits or uses a hot standby replica that consumes the same partitions. That's the payoff of treating the index as a disposable cache over the stream: no snapshot or database restore. Make sure entries carry driver status from the trip service too, not only position."
        }
      ],
    },
  ],
  test: [
    {
      id: 'design-geo-mcq-01',
      difficulty: 'hard',
      question: 'A user at the geohash boundary between cells "9q8zz" and "9q9p0" searches with a 1 km radius. The service queries only geohashes with the user’s 5-char prefix. What is the most likely symptom?',
      options: [
        'Businesses a few metres away in the adjacent cell are missing, even though they are well inside the radius',
        'Results are correct but slower because precision 5 is too coarse',
        'Duplicate businesses appear because both cells contain them',
        'The query returns businesses across the whole planet because the prefixes share "9q"',
      ],
      correct: [0],
      explanation: 'Adjacent cells can have very different suffixes (and even different prefixes at higher levels), so a single-cell lookup misses nearby businesses across the edge. Each business lives in exactly one cell per precision, so duplicates don’t come from this. The "9q" shared prefix is only relevant if you queried at length 2. The fix is to include the 8 neighbouring cells.',
      followUps: [
        {
          "q": "You now query the cell plus its 8 neighbours. Is that always enough for a 1 km radius at precision 5, and what about the opposite case of a tiny radius?",
          "a": "Precision 5 cells are about 4.9 km × 4.9 km, so a 1 km circle centred anywhere in the middle cell always fits inside the 3×3 block: the minimum distance from the centre cell to the block's outer edge is one full cell width. The rule is that the cell's shortest side must be at least the radius. If the radius exceeds the cell size, 9 cells miss results, so drop to a shorter precision. The opposite failure is a tiny radius (100 m) at precision 5: correct but wasteful, scanning about 216 km² and filtering almost everything. Choose precision from the radius."
        },
        {
          "q": "The user is near the poles or the antimeridian. Does the neighbour approach still work?",
          "a": "At the antimeridian (±180°) the geohash neighbours of a cell on the eastern edge are on the western edge with completely different prefixes; a correct neighbour function wraps longitude, but naive implementations that just bump a coordinate and re-encode can return invalid cells or nothing. Near the poles, cells become extremely narrow in ground distance because longitude degrees shrink with cos(latitude), so the 3×3 block may not cover the radius east-west. In practice it barely matters for a restaurant app, but test the edge cases explicitly or use S2 or H3, which handle the sphere without these seams."
        }
      ],
    },
    {
      id: 'design-geo-mcq-02',
      difficulty: 'medium',
      question: 'Your proximity service has 200M businesses and 5K QPS of searches; the geohash index is ~5 GB. Traffic doubles every year. What is the best way to scale the geo index?',
      options: [
        'Shard the index by geohash prefix so each shard owns a region',
        'Move the index to Kafka and let consumers compute results',
        'Replicate the full index to more read replicas / cache nodes per region',
        'Shard by business_id with a scatter-gather query',
      ],
      correct: [2],
      explanation: 'A 5 GB index fits in memory on a single node, so the bottleneck is read throughput — replication scales that linearly with no cross-shard complexity. Sharding by region creates hot shards (dense cities) and cross-shard queries at boundaries. Sharding by business_id forces scatter-gather on every query. Kafka is not a query engine.',
      followUps: [
        {
          "q": "Five years later the index is 80 GB and traffic is 32× higher. Does your answer still hold?",
          "a": "Partly. 32× read traffic is still a replication problem: add replicas per region. But 80 GB no longer fits comfortably in each node's memory alongside everything else, and rebuilding or warming a replica takes much longer. At that point you shard, but by geography with care: split by geohash prefix using density-aware boundaries (dense cities get more, smaller shards), and query neighbouring shards only when the search area crosses a shard edge. Alternatively, trim the index: store only id, geohash and a few ranking fields (about 30 bytes per business) and fetch details elsewhere, which may keep it unsharded for years."
        }
      ],
    },
    {
      id: 'design-geo-mcq-03',
      difficulty: 'hard',
      question: 'What is wrong with this "nearest drivers" ranking in a ride-hailing app?',
      code: {
        language: 'typescript',
        code: `const candidates = index.candidates(lat, lng, 20);
candidates.sort((a, b) =>
  Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng));
return candidates[0];`,
      },
      options: [
        'Only a performance issue: Math.hypot is slow for 20 elements',
        'It is correct as long as the H3 resolution is fine enough',
        'It fails only near the antimeridian (±180° longitude)',
        'It ranks by straight-line degrees, ignoring road network (rivers, one-ways) and that longitude degrees shrink with latitude',
      ],
      correct: [3],
      explanation: 'Riders experience road ETA, not crow-flies distance; a driver across a river may be much farther by road. Additionally, Euclidean distance on raw degrees is distorted because a degree of longitude spans cos(latitude) × 111 km. The antimeridian is a real but narrow edge case, and a finer H3 resolution does not fix either problem. Rank by routing-engine ETA.',
      followUps: [
        {
          "q": "Calling the routing engine for every ride request adds load and latency. How do you rank 20 candidates by ETA within a 200 ms budget?",
          "a": "Do one batched one-to-many (or many-to-one) matrix call rather than 20 point-to-point routes: engines with contraction hierarchies answer a 20×1 matrix in a few milliseconds because they share the backward search from the rider. Pre-filter with cheap haversine distance to the nearest 20–30, then get road ETAs for those only. Cache short-range ETAs per (H3 cell pair, time-of-day bucket) for a few minutes, since many requests in the same area need the same answers. If the router times out, fall back to haversine scaled by a typical city speed so dispatch never blocks completely."
        }
      ],
    },
    {
      id: 'design-geo-mcq-04',
      difficulty: 'expert',
      question: 'Two dispatcher instances run this for different riders at the same moment. What can happen?',
      code: {
        language: 'typescript',
        code: `const s = await redis.get('driver:42:state');
if (s === 'IDLE') {
  await redis.set('driver:42:state', 'OFFERED');
  await sendOffer('42', tripId);
}`,
      },
      options: [
        'Nothing: Redis executes commands one at a time so the second GET sees OFFERED',
        'Both can read IDLE before either SET runs, so driver 42 receives two offers',
        'The second SET fails because the key already exists',
        'Redis WATCH is applied implicitly to GET-then-SET sequences',
      ],
      correct: [1],
      explanation: 'Individual commands are atomic, but the GET-then-SET sequence spans two round trips; both instances can observe IDLE before either writes. SET overwrites unconditionally unless NX is given, and WATCH is never implicit. Use a Lua script (or SET with a compare via WATCH/MULTI, or a DB conditional UPDATE) to make check-and-reserve atomic.',
      followUps: [
        {
          "q": "You fix it with a Lua script, but the Redis primary fails over and the OFFERED write is lost. What happens, and does it matter?",
          "a": "With asynchronous replication, the new primary may still show driver 42 as IDLE, so another dispatcher can offer the same driver a second trip while the first offer is live on the phone. This is a recoverable inconsistency, not a disaster, if the trip service is the source of truth: accepting an offer runs a conditional update that assigns the driver only if they hold no active trip, so the second accept fails and that rider is re-dispatched. The driver app can also reject a second offer while one is showing. Redis is an optimisation for fast exclusion; the durable store enforces the invariant. Alert on accept-conflict rates to detect failovers."
        }
      ],
    },
    {
      id: 'design-geo-mcq-05',
      difficulty: 'hard',
      question: 'In Nearby Friends, why does the location cache use a TTL on each user’s entry? Select ALL that apply.',
      options: [
        'Users who stop sending updates automatically drop out of "nearby" without a cleanup job',
        'It bounds memory to roughly the set of recently active users',
        'It guarantees that friends never see a location older than the TTL on the WebSocket stream',
        'It removes the need for location history storage',
      ],
      correct: [0, 1],
      explanation: 'The TTL makes inactivity self-cleaning and keeps memory proportional to active users. It does not bound staleness on the push stream — a pushed update can still be displayed after the TTL unless the client also ages entries. History storage is a separate requirement (analytics/ML) served by Cassandra, unaffected by the cache TTL.',
      followUps: [
        {
          "q": "How should the client handle staleness, given the TTL doesn't bound it on the stream?",
          "a": "Every pushed location carries the sender's timestamp. The client ages each friend entry locally: fade the marker or show \"5 min ago\" after 2–3 missed update intervals (60–90 s at a 30 s cadence), and remove it entirely after the TTL. When the app returns from background, it should fetch a fresh snapshot of nearby friends from the cache rather than trust the stale in-memory list. The server can also send an explicit \"went offline\" event when a friend's WebSocket closes, so markers disappear promptly rather than waiting for timeouts. Use the server receive time for ordering, since device clocks can be wrong."
        }
      ],
    },
    {
      id: 'design-geo-mcq-06',
      difficulty: 'expert',
      question: 'You add pub/sub nodes to the Nearby Friends consistent-hash ring during peak. Which consequences should you expect? Select ALL that apply.',
      options: [
        'Channels that move to the new node lose messages until subscribers re-subscribe there',
        'WebSocket servers must refresh the ring from service discovery and re-subscribe moved channels',
        'All channels in the cluster must move, as with modulo hashing',
        'A burst of SUBSCRIBE traffic hits the new nodes',
      ],
      correct: [0, 1, 3],
      explanation: 'Only ~1/N of channels move with consistent hashing (so not "all channels"), but every moved channel needs its subscribers to re-subscribe on the new node, which causes a burst of SUBSCRIBE commands and a window of lost updates. This is why the book recommends over-provisioning and resizing at low-traffic hours.',
      followUps: [
        {
          "q": "How would you implement the re-subscribe so the burst doesn't overload the new node and updates aren't missed?",
          "a": "Do a make-before-break move. Publish the new ring version through service discovery. WebSocket servers first SUBSCRIBE moved channels on the new node while still subscribed on the old one, deduping messages by (user, sequence) for a short overlap. Publishers then switch to the new node, and finally subscribers unsubscribe from the old node. Spread the re-subscribes with jitter over 30–60 s and rate-limit them per WebSocket server. Since location updates repeat every 30 s, a missed update self-heals at the next one, so a short gap is acceptable, but the overlap avoids even that. Schedule ring changes at low traffic."
        }
      ],
    },
    {
      id: 'design-geo-mcq-07',
      difficulty: 'medium',
      question: 'Why does a quadtree-based proximity server take several minutes to become ready after a restart, and what does that imply for deployments?',
      options: [
        'It must replay the Kafka topic of all business edits; use log compaction',
        'It waits for DNS TTL expiry; lower the TTL',
        'It builds the tree in memory from ~200M businesses at startup; deploy gradually and keep old instances serving until new ones are warm',
        'Quadtrees need a leader election on start; use Raft',
      ],
      correct: [2],
      explanation: 'The quadtree is built from the business table at startup (minutes for ~200M rows), so a new server cannot serve immediately. Roll out incrementally and gate readiness probes on build completion. Replay/compaction, DNS and consensus are unrelated to why the index takes time to build.',
      followUps: [
        {
          "q": "Can you cut startup time from minutes to seconds instead of just working around it?",
          "a": "Yes: stop building from the source table on every boot. A builder job periodically constructs the quadtree (or a sorted geohash array) and serialises it as a compact snapshot to object storage, tagged with the business-table version or CDC offset. New servers download the snapshot (a few GB in seconds over a fast network), memory-map or deserialise it, then replay only the change stream since that offset. Using a flat, pointer-free layout such as arrays of node offsets makes loading close to a straight read. Readiness then gates on \"snapshot loaded and caught up\", which is seconds rather than minutes."
        }
      ],
    },
    {
      id: 'design-geo-mcq-08',
      difficulty: 'hard',
      question: 'Given this tile-math function, what is true about tile counts and caching?',
      code: {
        language: 'typescript',
        code: `function tileFor(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return { z, x, y };
}`,
      },
      options: [
        'Zoom z has 4^z tiles; because (z, x, y) addresses never change content between map releases, tile URLs can be cached immutably at the CDN',
        'Zoom z has 2^z tiles, so zoom 21 has ~2 million tiles that fit in memory',
        'Tiles near the poles are smaller in pixels, so the CDN should compress them more',
        'y is computed linearly from latitude, so tiles are equal-area',
      ],
      correct: [0],
      explanation: 'The grid is n × n = 4^z tiles (z21 ≈ 4.4 trillion). Tiles are pre-rendered per map version, so versioned URLs are immutable and CDN-cacheable. The Mercator y formula is non-linear, which is why tiles are not equal-area (high-latitude tiles cover less ground) but all tiles are still 256×256 px.',
      followUps: [
        {
          "q": "At zoom 21 there are trillions of possible tiles. Do you pre-render them all? How do you decide what to store?",
          "a": "No. Most tiles at high zoom are ocean, desert or empty, and almost nobody views them. Pre-render low zooms fully (z0–z12 is about 22 million tiles in total, cheap) and populated areas at higher zooms. Render the rest on demand on a cache miss and store the result. Many identical tiles (solid ocean, solid land) dedupe to one blob by content hash. Modern clients use vector tiles: the server sends geometry up to about z14–16 and the client renders higher zooms by over-zooming, so the high-zoom raster explosion disappears entirely."
        }
      ],
    },
    {
      id: 'design-geo-mcq-09',
      difficulty: 'expert',
      question: 'Your routing service runs plain Dijkstra over a continental road graph at request time, and p99 is 9 s for long trips. Which changes address the root cause? Select ALL that apply.',
      options: [
        'Hierarchical routing tiles (local/arterial/highway) so long routes mostly expand highway tiles',
        'Preprocessing with contraction hierarchies (shortcut edges) plus bidirectional search',
        'Caching the final route per (origin, destination) lat/lng pair',
        'A* with an admissible straight-line/max-speed heuristic',
      ],
      correct: [0, 1, 3],
      explanation: 'Hierarchy, contraction hierarchies and A* all shrink the search space for long queries. Caching per exact coordinate pair has near-zero hit rate (coordinates rarely repeat) and goes stale with traffic. Contraction hierarchies are what make continental queries run in milliseconds after preprocessing.',
      followUps: [
        {
          "q": "Contraction hierarchies are precomputed. A road closes and live traffic changes edge weights every minute. How do you keep routes fast and correct?",
          "a": "Plain CH needs a full re-preprocess (minutes to hours) when weights change, which is too slow. Use customizable contraction hierarchies (CCH) or multi-level Dijkstra: the topology-dependent ordering is computed once, and a fast customization phase applies new edge weights in seconds across the whole graph or per partition, so live traffic can be folded in every minute or so. A closure is a weight of infinity. Between customizations, apply very recent incidents by re-checking the returned route's edges against a live-incident set and rerouting locally around them. Accuracy then comes from the ETA model on top of the route."
        }
      ],
    },
    {
      id: 'design-geo-mcq-10',
      difficulty: 'expert',
      question: 'For Google Maps location uploads, the team proposes a persistent WebSocket per navigating user instead of batched HTTP every 15 s. What is the strongest argument against it for *uploads*?',
      options: [
        'WebSocket cannot carry binary payloads',
        'WebSocket messages are not encrypted',
        'HTTP guarantees exactly-once delivery of each batch',
        'Uploads are periodic, client-initiated and delay-tolerant; stateless batched HTTP is simpler to scale and friendlier to mobile radios, while server push is only needed for reroutes',
      ],
      correct: [3],
      explanation: 'The upload direction does not need a persistent stateful connection; batched stateless requests scale behind any LB and let the radio sleep between batches. WebSocket supports binary and TLS (wss). HTTP gives no exactly-once guarantee either — uploads should be idempotent by (user, batch sequence). WebSocket is still the right choice for pushing reroutes.',
      followUps: [
        {
          "q": "The device goes through a tunnel for 3 minutes. What should the upload protocol do, and what about the server side?",
          "a": "The client keeps sampling into a local buffer and, on reconnection, uploads the backlog in batches marked with their original timestamps and a per-session sequence number. The server makes ingestion idempotent on (user, session, sequence) so retried batches don't duplicate points. Navigation logic must treat late points as history, not \"current position\": the client's own dead-reckoning (speed and heading along the route) handles the tunnel, and the server shouldn't trigger reroutes from stale data. Traffic aggregation should either drop points older than a minute or attribute them to the correct time window."
        }
      ],
    },
    {
      id: 'design-geo-mcq-11',
      difficulty: 'expert',
      question: 'Surge multipliers are computed per H3 res-9 cell every 10 s from raw demand/supply. Drivers complain the map "flickers" and riders see prices jump between adjacent streets. What is the best fix?',
      options: [
        'Switch to geohash cells so cell boundaries align with streets',
        'Use coarser cells and smooth demand/supply over neighbouring cells (gridDisk) and over a longer time window, with a cap on multiplier change rate',
        'Compute surge per driver instead of per cell',
        'Recompute every 1 s to make changes smaller',
      ],
      correct: [1],
      explanation: 'Tiny cells have noisy counts, and independent per-cell computation creates sharp spatial and temporal discontinuities. Coarser cells plus spatial smoothing (hexagon neighbours are equidistant, ideal for this) and temporal smoothing/rate caps give stable prices. Geohash does not align with streets; per-driver surge is not a demand metric; faster recomputation amplifies noise.',
      followUps: [
        {
          "q": "How would you validate a new surge smoothing configuration before rolling it out to all cities?",
          "a": "First replay it offline against recorded demand and supply streams for several cities and compare metrics: frequency of multiplier changes per cell per hour, maximum step between adjacent cells, and how quickly it reacts to a real spike (a concert ending). Then run a switchback experiment, alternating old and new config by city and time window, because per-rider A/B tests contaminate a shared marketplace. Measure rider conversion, driver repositioning, ETA, and completed trips. Guardrails abort automatically if wait times or unfulfilled requests rise beyond thresholds."
        }
      ],
    },
    {
      id: 'design-geo-mcq-12',
      difficulty: 'expert',
      question: 'This transition handler is called by both the driver app and a retrying mobile gateway. What bug remains?',
      code: {
        language: 'typescript',
        code: `async function completeTrip(tripId: string) {
  const trip = await trips.get(tripId);
  if (trip.state !== 'IN_PROGRESS') throw new Error('bad state');
  await payments.capture(trip.paymentIntentId, trip.fare);
  await trips.update(tripId, { state: 'COMPLETED' });
}`,
      },
      options: [
        'Two concurrent calls can both pass the state check and both capture payment; the capture also is not tied to an idempotency key',
        'None, because the state check rejects the second call',
        'The fare should be read after capture, not before',
        'The update should happen before the state check',
      ],
      correct: [0],
      explanation: 'The read-check-write isn’t atomic: two concurrent calls both see IN_PROGRESS and both capture. Fix with a conditional/versioned update (UPDATE ... WHERE state = IN_PROGRESS) or SELECT FOR UPDATE, move capture after the state transition via an outbox, and pass an idempotency key (e.g. tripId) to the payment provider. Reordering the fare read or the update alone does not remove the race.',
      followUps: [
        {
          "q": "You moved capture to an outbox after a conditional UPDATE. The capture itself fails: the card is declined at trip end. What happens to the trip?",
          "a": "The trip stays COMPLETED; the ride physically happened, so the trip state must not roll back. Payment becomes its own state machine: CAPTURE_PENDING to CAPTURE_FAILED. The outbox consumer retries transient errors with the same idempotency key, and on a hard decline it tries the rider's backup payment method, flags the account as having an outstanding balance, and blocks new rides until it is settled. The driver is paid according to policy regardless, which makes the platform the one carrying the credit risk. This is why most apps pre-authorize an estimated fare at request time, so capture rarely fails."
        }
      ],
    },
    {
      id: 'design-geo-mcq-13',
      difficulty: 'hard',
      question: 'A geofencing service must answer "which of 2M polygons contain this point?" for 800K location updates/s. Which approach scales best?',
      options: [
        'For each update, run point-in-polygon against every polygon in parallel',
        'Store polygons in Postgres and use ST_Contains per update with a GiST index on a single primary',
        'Precompute S2/H3 cell coverings per polygon (interior vs boundary cells), index cell → polygons, test exact geometry only for boundary-cell hits',
        'Use geohash-6 of each polygon’s centroid and compare to the user’s geohash',
      ],
      correct: [2],
      explanation: 'Cell coverings turn the problem into hash lookups; interior cells resolve instantly and only boundary cases need geometry. Brute force is O(polygons) per update. PostGIS with GiST is correct but a single primary won’t sustain ~800K queries/s. Centroid geohash ignores polygon extent entirely.',
      followUps: [
        {
          "q": "Users want \"enter\" and \"exit\" notifications, not just containment. What state do you add and where does it live?",
          "a": "Enter and exit are transitions, so you need each user's previous set of containing fences. Store it in a per-user state keyed by user id, for example in Redis or a stream processor's keyed state (Flink), partitioned so all updates for one user go to one worker in order. On each update, compute the current set, diff it with the previous one, emit enter events for additions and exit events for removals, then store the new set. Out-of-order updates must be dropped by timestamp, otherwise a late point produces a spurious exit followed by re-entry. Expire state for users inactive for hours."
        }
      ],
    },
    {
      id: 'design-geo-mcq-14',
      difficulty: 'medium',
      question: 'A food-delivery app assigns a delivery partner the instant an order is placed. Restaurants average 18 min prep; partners are 6 min away. What is the main inefficiency and fix?',
      options: [
        'Food gets cold because partners arrive late; assign even earlier',
        'The restaurant cannot see the partner; add live tracking for restaurants',
        'Customers see incorrect ETAs; show only prep time',
        'Partners arrive ~12 min early and idle at the restaurant; delay assignment so predicted arrival ≈ predicted ready time, and batch assignments',
      ],
      correct: [3],
      explanation: 'Immediate assignment wastes ~12 minutes of partner time per order, reducing fleet capacity during peaks. Using a prep-time model and assigning later (plus batched optimisation and stacking) improves utilisation without hurting food freshness. Assigning earlier worsens idling; the other options don’t address utilisation.',
      followUps: [
        {
          "q": "Your prep-time model is wrong by ±8 minutes for some restaurants. How does delayed assignment behave, and how do you make it robust?",
          "a": "If prep is underestimated, the partner arrives late and food sits; if overestimated, you are back to idling. Robustness comes from feedback rather than a perfect model: use per-restaurant and per-dish models with time-of-day and current load (open orders in the kitchen), and learn from signals such as the restaurant's \"food ready\" button and the partner's actual wait. Assign with a safety margin weighted by the model's uncertainty for that restaurant (wider margin where variance is high). Let restaurants push a status update (\"delayed 10 min\") that reschedules assignment. Track partner wait time and food wait time as twin metrics."
        }
      ],
    },
    {
      id: 'design-geo-mcq-15',
      difficulty: 'expert',
      question: 'Your Redis Cluster (60 shards) is used for Nearby Friends with classic PUBLISH/SUBSCRIBE. Cluster bus bandwidth is saturating as you add shards. Which options address this? Select ALL that apply.',
      options: [
        'Use Redis 7 sharded pub/sub (SPUBLISH/SSUBSCRIBE) so messages route only to the shard owning the channel’s slot',
        'Use client-side consistent hashing over independent (non-cluster) Redis nodes for pub/sub',
        'Add more shards to the same cluster so each broadcasts less',
        'Switch from PUBLISH to LPUSH on a list per user to make delivery durable',
      ],
      correct: [0, 1],
      explanation: 'In Redis Cluster, classic PUBLISH is propagated to every node over the cluster bus, so bus traffic grows with shard count. Sharded pub/sub (Redis 7+) or client-side hashing over standalone nodes keeps each message on one node. Adding shards makes broadcast worse. Lists change semantics (durable queues, polling) and add memory and consumer complexity that the lossy use case doesn’t need.',
      followUps: [
        {
          "q": "With client-side consistent hashing over standalone Redis nodes, one node dies. What do users see and how do you recover?",
          "a": "Channels hashed to that node stop delivering, so roughly 1/N of users' friends freeze on the map. Pub/sub is lossy and stateless, so nothing needs restoring: health checks remove the node from the ring in service discovery, those channels remap to the next nodes on the ring, and WebSocket servers re-subscribe the affected channels there. Publishers start publishing to the new owners immediately. Because users send a fresh location every 30 s, maps fill back in within one update interval after the re-subscribe. Use a standby replica for faster promotion if needed, but replication isn't required for correctness here."
        }
      ],
    },
  ],
};

export default topic;
