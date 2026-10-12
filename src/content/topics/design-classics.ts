import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-classics',
  phase: 'designs',
  order: 1,
  title: 'Classic Designs: URL Shortener, Pastebin, KV Store, Unique IDs & Notifications',
  subtitle:
    'The warm-up designs every interviewer reaches for — walked end-to-end with the 4-step framework, real numbers, and the deep dives that separate senior from mid-level.',
  estimatedMinutes: 150,
  sources: [
    'Alex Xu — System Design Interview Vol 1, Ch 6 (Key-Value Store), Ch 7 (Unique ID Generator), Ch 8 (URL Shortener), Ch 10 (Notification System)',
    'DeCandia et al. — Dynamo: Amazon’s Highly Available Key-value Store (SOSP 2007)',
    'RFC 9562 — Universally Unique IDentifiers (UUIDv7)',
    'Twitter Engineering — Announcing Snowflake (2010); Flickr — Ticket Servers (2010)',
  ],
  tags: [
    'url-shortener',
    'base62',
    'pastebin',
    'key-value-store',
    'dynamo',
    'consistent-hashing',
    'quorum',
    'vector-clocks',
    'lsm-tree',
    'snowflake',
    'uuidv7',
    'notifications',
    'file-upload',
  ],
  cheatSheet: [
    'Framework (45 min): 5–8 min requirements + estimation → 8–10 min API + data model → 10 min high-level diagram → 15 min deep dives → 3–5 min bottlenecks/wrap-up. Never skip the numbers.',
    'URL shortener: 100M writes/day ≈ 1.2K WPS, 10:1 reads ≈ 12K RPS; 7 base62 chars = 62^7 ≈ 3.5 trillion codes; 10 yrs ≈ 365B rows × ~100 B ≈ 36 TB.',
    'ID strategy: counter/Snowflake → base62 = no collisions but enumerable (scramble it); hash (MD5/CRC32 → 7 chars) = collisions → check + re-salt, use a Bloom filter to skip DB lookups.',
    '301 = browser caches, lowest load, analytics blind; 302/307 = every hit reaches you, analytics works. Most commercial shorteners use 301 + edge logging or 302 when analytics matter.',
    'Pastebin: blob in object storage (S3), metadata row in DB (key, owner, expires_at, size, s3_key); expiry via lazy check on read + background sweeper or S3 lifecycle rules.',
    'Dynamo KV: consistent hashing + virtual nodes, N=3 replicas on the preference list, R+W>N for read-your-writes when no sloppy quorum; vector clocks for conflicts, gossip for membership, hinted handoff for temporary failure, Merkle trees for anti-entropy.',
    'LSM path: write → commit log (fsync) → memtable → flush to immutable SSTable; read → memtable → Bloom filter per SSTable → sparse index → block. Compaction trades write amplification for read amplification.',
    'Snowflake 64-bit: 1 sign | 41 ms timestamp (~69 yrs) | 5 DC | 5 worker | 12 sequence = 4,096 IDs/ms/worker. Must handle clock moving backwards (wait or fail) and sequence overflow (spin to next ms).',
    'UUIDv7 (RFC 9562): 48-bit Unix-ms prefix + random → time-ordered, B-tree friendly, 128 bits, no coordination; UUIDv4 random inserts cause page splits and poor index locality.',
    'Notifications: API → validate + prefs + dedup → per-channel queues (push/SMS/email) → workers → providers (APNs, FCM, Twilio, SES). Retry with backoff + jitter, idempotency key per (user, event, channel), per-user and per-provider rate limits, DLQ.',
  ],
  sections: [
    {
      heading: 'How to run a classic design in 45 minutes',
      body: `Think of the classics as **scales practice for a musician**: interviewers pick them because the problem is small enough to finish, so the signal comes entirely from *how* you structure it and *which* hard parts you volunteer.

**The 4-step framework** (Alex Xu) applied to every design in this topic:

| Step | Time | Output you must produce |
|---|---|---|
| 1. Scope | 5–8 min | Functional list (3–5 bullets), non-functional (latency, availability, consistency, durability), explicit **out of scope**, and an envelope calc (QPS, storage, bandwidth) |
| 2. API + data model | 8–10 min | 2–4 endpoints with request/response shape, primary tables/keys, and the access pattern that drives the key choice |
| 3. High-level design | ~10 min | A box diagram that satisfies every functional requirement end-to-end — even if naive |
| 4. Deep dives + wrap-up | 15–20 min | 2–3 hard parts in depth (with code/algorithms), then bottlenecks, failure modes, trade-offs, and "what I would do next" |

**Senior-level habits that interviewers score:**
- State the **read/write ratio** early — it decides caching, replication and which store you pick.
- Always convert DAU into **peak** QPS (×2–5 of average), not just average.
- For every component in your diagram, be ready to answer: *what happens when it dies?* and *what happens at 10× load?*
- Name the trade-off you are making ("I'm choosing AP here, so a read after a partition may be stale by up to a few seconds — acceptable for a view counter, not for a balance").

**Handy constants:** 1 day ≈ 86,400 s ≈ 10^5 s; 1M req/day ≈ 12 req/s; 1B req/day ≈ 12K req/s. Redis ≈ 100K+ simple ops/s per node; a tuned Postgres primary ≈ 5–20K write TPS; Kafka ≈ 100 MB/s+ per broker; a 7200-rpm disk seek ≈ 10 ms, SSD random read ≈ 100 µs, intra-DC round trip ≈ 0.5 ms.`,
      keyPoints: [
        'Spend the first 5–8 minutes on scope and numbers — they justify every later decision.',
        'Draw a naive but complete design first; then deepen it.',
        'Volunteer the hard parts; do not wait to be asked about failure modes.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 3 (A Framework for System Design Interviews)',
    },
    {
      heading: 'URL Shortener (1/3): requirements, estimation, API & data model',
      body: `**Intuition:** a URL shortener is a giant, globally replicated hash map from a 7-character key to a long URL, with a very lopsided read/write ratio.

**Functional requirements**
- \`POST /api/v1/urls\` shortens a long URL, optionally with a **custom alias** and **expiry**.
- \`GET /{code}\` redirects to the long URL.
- (Often) click **analytics**: counts by day, referrer, country, device.
- Out of scope unless asked: user accounts/billing, link editing, spam scanning pipeline (mention it).

**Non-functional**: redirect p99 < 50 ms at the edge, 99.99% availability for redirects (a dead link is a broken ad campaign), short codes must be **unguessable-ish** (not sequentially enumerable), durability — a created link must never disappear.

**Estimation** (Alex Xu Vol 1 numbers):
- Writes: 100M new URLs/day ÷ 10^5 ≈ **1,160 WPS** (peak ~3K).
- Reads at 10:1 ≈ **11,600 RPS** (peak ~30–50K; viral links are much spikier).
- 10 years: 100M × 365 × 10 = **365 billion** records × ~100 bytes ≈ **36.5 TB** (plus indexes/replicas → ~100+ TB raw).
- Code length: 62^6 ≈ 56.8B (not enough for 365B), **62^7 ≈ 3.52 trillion** → 7 chars.

**Data model** — the access pattern is a single-key lookup, so any KV-capable store works:

| Column | Type | Notes |
|---|---|---|
| code | varchar(16) PK | the short key (also custom aliases) |
| long_url | text | normalized; max ~2 KB |
| owner_id | bigint null | for management/quotas |
| created_at / expires_at | timestamptz | expiry enforced lazily on read + sweeper |

A **secondary index on a hash of long_url** is optional: it lets you return the same code for the same URL (dedup), but that leaks link existence across users and complicates per-user analytics — most products *do not* dedup across users.

**Store choice:** 36 TB of simple KV rows at 12K RPS reads → DynamoDB/Cassandra (partition key = code) or sharded MySQL/Postgres. Redirect reads are 95%+ cache hits anyway, so the DB mostly handles writes and cold reads.`,
      code: [
        {
          language: 'sql',
          title: 'Postgres schema (sharded by code) + analytics rollup table',
          code: `CREATE TABLE short_urls (
  code        varchar(16) PRIMARY KEY,          -- base62 code or custom alias
  long_url    text        NOT NULL,
  owner_id    bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,                      -- NULL = never expires
  CONSTRAINT long_url_len CHECK (length(long_url) <= 2048)
);

-- Sweeper uses this; partial index keeps it tiny (most links never expire)
CREATE INDEX short_urls_expiry_idx
  ON short_urls (expires_at) WHERE expires_at IS NOT NULL;

-- Analytics is NOT written per click into this DB: clicks go to Kafka,
-- a stream job rolls them up per (code, day, country) into a column store.
CREATE TABLE click_rollup_daily (
  code     varchar(16) NOT NULL,
  day      date        NOT NULL,
  country  char(2)     NOT NULL,
  clicks   bigint      NOT NULL,
  PRIMARY KEY (code, day, country)
);`,
        },
      ],
      keyPoints: [
        '100M/day writes ≈ 1.2K WPS; 10:1 reads ≈ 12K RPS; 7 base62 chars ≈ 3.5T codes.',
        'Single-key access pattern → KV store or sharded RDBMS keyed by code.',
        'Never write analytics synchronously on the redirect path.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 8 (Design a URL Shortener)',
    },
    {
      heading: 'URL Shortener (2/3): generating the short code — base62 vs hash + collision',
      body: `**Intuition:** you either *count* (every link gets the next number, written in base 62) or you *hash* (derive the code from the URL and deal with collisions). Counting is collision-free; hashing is coordination-free.

| Approach | How | Pros | Cons |
|---|---|---|---|
| **Counter → base62** | Global ID (Snowflake, ticket server, or pre-allocated ranges) encoded in [0-9a-zA-Z] | Zero collisions, O(1) write, short codes | Sequential codes are **enumerable** (scrapers walk your whole DB); needs an ID service |
| **Hash + truncate** | MD5/SHA-256/CRC32 of (url + salt) → take first 7 base62 chars | Stateless, same URL can map to same code | Collisions grow with the birthday bound — at 365B codes in a 3.5T space, collisions are routine; each needs a DB check + retry |
| **Pre-generated key pool (KGS)** | Offline service generates random unused codes into a "free keys" table; app servers grab batches of 1,000 into memory | Random + collision-free, fast | Extra service; keys held by a crashed server are lost (fine — the space is huge) |

**Making counters unguessable:** run the counter through a **bijective scramble** before base62-encoding — e.g., a small Feistel network or multiply by a large odd constant modulo 62^7. It stays collision-free (a permutation) but consecutive IDs produce unrelated-looking codes.

**Collision handling for hashing:** insert with a unique constraint (\`INSERT ... ON CONFLICT DO NOTHING\`); if 0 rows inserted and the stored URL differs, append a salt/counter and rehash. A **Bloom filter** of existing codes (365B keys at 1% FPR ≈ 9.6 bits/key ≈ 440 GB — so realistically per-shard filters) lets you skip most DB existence checks — but the unique constraint is still the source of truth.

**Custom aliases** share the same keyspace, so they must be validated (charset, length, reserved words like "api", "admin") and inserted with the **same unique constraint** — never "SELECT then INSERT", which races.

**Range allocation** is the production favourite: each app server leases a block of 10,000 IDs from a coordinator (ZooKeeper/etcd or a DB row with \`UPDATE ... RETURNING\`), hands them out from memory, scrambles and encodes. One coordinator round-trip per 10K links.`,
      code: [
        {
          language: 'typescript',
          title: 'Base62 encoding + a bijective scramble so codes are not sequential',
          code: `const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = 62n;
const SPACE = 62n ** 7n;            // 3,521,614,606,208 codes of length 7

// Multiplicative scramble: x -> (x * P) mod SPACE is a bijection when
// gcd(P, SPACE) = 1. SPACE = 2^7 * 31^7, so P must be odd and not divisible by 31.
const P = 1_580_030_173n;
const P_INV = modInverse(P, SPACE); // lets you decode back to the ID if needed

export function encodeId(id: bigint): string {
  if (id < 0n || id >= SPACE) throw new RangeError('id outside 7-char space');
  let x = (id * P) % SPACE;          // scramble: consecutive ids look random
  let out = '';
  for (let i = 0; i < 7; i++) {      // fixed width: always 7 chars
    out = ALPHABET[Number(x % BASE)] + out;
    x /= BASE;
  }
  return out;
}

export function decodeCode(code: string): bigint {
  let x = 0n;
  for (const ch of code) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('invalid char');
    x = x * BASE + BigInt(v);
  }
  return (x * P_INV) % SPACE;        // unscramble
}

function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a % m, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {                 // extended Euclid
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return ((oldS % m) + m) % m;
}`,
        },
      ],
      keyPoints: [
        'Counter + scramble + base62 = collision-free AND non-enumerable.',
        'Hashing needs a unique constraint + retry; Bloom filters only reduce lookups.',
        'Custom aliases use the same unique constraint — never check-then-insert.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 8',
    },
    {
      heading: 'URL Shortener (3/3): architecture, 301 vs 302, caching, analytics & wrap-up',
      body: `**Redirect path (the hot path):** CDN/edge → redirect service → Redis (code → long_url) → DB on miss. With a Zipfian distribution, caching the hottest ~20% of links typically gives a 90%+ hit ratio. Cache *negative* results too (a short TTL for unknown codes) or scanners will hammer the DB.

**301 vs 302 — the classic probe:**

| | 301 Moved Permanently | 302 Found / 307 Temporary |
|---|---|---|
| Browser caching | Cached indefinitely by browser | Not cached by default |
| Server load | Lowest — repeat clicks never reach you | Every click hits your edge |
| Analytics | Lost for repeat visitors | Accurate |
| Change destination later | Effectively impossible for users who cached it | Possible |

Bitly-style products that sell analytics lean toward 301 with **edge logging** before the redirect, or 302 with \`Cache-Control: private, max-age=...\`. In the interview: *"If analytics is a requirement, I use 302 (or 301 with short max-age) and log at the edge; if pure cost/latency, 301."*

**Analytics pipeline:** the redirect service fires a click event (code, ts, ip-derived country, UA, referrer) into Kafka **asynchronously** (fire-and-forget buffer, never blocking the redirect). A stream job (Flink/Kafka Streams) aggregates per (code, minute) and writes rollups to ClickHouse/Druid. Raw events land in S3 for reprocessing. Unique visitors use HyperLogLog (~12 KB per counter in Redis, ~0.81% error).

**Bottlenecks & trade-offs to volunteer:**
- **Hot links** (a Super Bowl ad): replicate hot keys across cache nodes or serve from edge KV (Cloudflare Workers KV / CloudFront + Lambda@Edge).
- **Abuse:** phishing/malware links — async scanning (Safe Browsing API), rate limit creation per API key/IP, interstitial warning pages.
- **Multi-region:** writes to a home region, async replication; reads anywhere. A just-created link read in another region may miss → fall back to home region on miss (read-repair).
- **Expiry:** check \`expires_at\` on read (return 410 Gone), background sweeper deletes; cache TTL must be ≤ remaining lifetime.`,
      diagram: `            create                               redirect
 client ----------+              client -------> CDN / edge (logs click)
                  v                                  |
          +---------------+                          v
          |  API service  |                 +-----------------+
          | validate,rate |                 | redirect service|
          | limit, alias  |                 +--------+--------+
          +---+-------+---+                   hit |  | miss
     lease    |       | INSERT ... ON CONFLICT    v  v
   ID range   v       v                    +-------+ +---------+
     +-------------+  +-----------------+  | Redis | |  DB     |
     | ID/range    |  | DB (sharded by  |<-+ cache | | replica |
     | coordinator |  | code; replicas) |  +-------+ +---------+
     +-------------+  +-----------------+
                                        click events (async)
            redirect service ---------> Kafka --> Flink --> ClickHouse
                                          +--> S3 (raw, replayable)`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS redirect controller: cache-aside, negative caching, async click event',
          code: `import { Controller, Get, Param, Res, NotFoundException, GoneException } from '@nestjs/common';
import type { Response } from 'express';
import Redis from 'ioredis';
import { ClickProducer } from './click.producer';
import { UrlRepository } from './url.repository';

@Controller()
export class RedirectController {
  constructor(private redis: Redis, private repo: UrlRepository, private clicks: ClickProducer) {}

  @Get(':code')
  async redirect(@Param('code') code: string, @Res() res: Response) {
    if (!/^[0-9a-zA-Z_-]{4,16}$/.test(code)) throw new NotFoundException();
    let target = await this.redis.get('u:' + code);
    if (target === null) {
      const row = await this.repo.findByCode(code);        // replica read
      if (!row) {
        await this.redis.set('u:' + code, '', 'EX', 60);   // negative cache
        throw new NotFoundException();
      }
      if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw new GoneException();
      const ttl = row.expiresAt
        ? Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000))
        : 86_400;
      target = row.longUrl;
      await this.redis.set('u:' + code, target, 'EX', Math.min(ttl, 86_400));
    }
    if (target === '') throw new NotFoundException();
    this.clicks.enqueue({ code, ts: Date.now(), ua: res.req.headers['user-agent'] ?? '' });
    res.setHeader('Cache-Control', 'private, max-age=300'); // limited browser caching
    return res.redirect(302, target);   // 302 so analytics sees repeat clicks
  }
}`,
        },
      ],
      keyPoints: [
        'Redirect path = edge → cache → DB; analytics is async via Kafka.',
        '301 saves load but blinds analytics; 302 (or short max-age) keeps it.',
        'Negative caching and per-IP limits protect the DB from scanners.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 8',
    },
    {
      heading: 'Pastebin: object storage + metadata, expiry and read scaling',
      body: `**Intuition:** Pastebin is a URL shortener whose "value" is a blob of up to a few MB. The trick is to **separate the blob from the metadata** — put bytes in object storage, keep a small row in a database.

**Requirements:** create paste (text up to 10 MB, optional expiry: 10 min / 1 day / never, visibility public/unlisted/private, optional syntax language), read by key, optional burn-after-read. Non-functional: reads ≫ writes (~5:1 to 10:1), durable, low read latency.

**Estimation:** 1M pastes/day ≈ 12 WPS; avg 10 KB → 10 GB/day → ~3.6 TB/year blob; metadata ~200 B/row → 73 GB/year. Reads 5–10M/day ≈ 60–120 RPS (peak spikes when a paste goes viral).

**Why not store text in the DB?** You can for small pastes (≤ 64 KB) — it's simpler. But blobs in the DB bloat buffer caches, make backups/replication heavier, and cap you at DB storage costs (~10× S3). A common hybrid: **inline small pastes in the row, S3 for large ones**.

**Write flow:** API validates size → generates key (same base62/KGS approach as the shortener, 8 chars) → uploads blob to \`s3://pastes/{key}\` (or returns a presigned PUT URL for big pastes so bytes skip your servers) → inserts metadata row. Order matters: **blob first, metadata second** — a metadata row pointing to a missing blob is a user-visible 500; an orphan blob is just garbage for a sweeper.

**Read flow:** CDN in front of \`GET /p/{key}/raw\` for public pastes (content is immutable → cache forever); metadata from Redis/DB checks visibility and expiry.

**Expiry — three layers:**
1. **Lazy check on read**: if \`expires_at < now()\` return 404/410 immediately (correctness).
2. **Background sweeper**: batch-delete expired rows by the partial index, delete blobs (cost).
3. **S3 lifecycle rules**: tag or prefix blobs by expiry bucket (e.g. \`exp=1d/\`) so S3 deletes them itself. CDN TTL must never exceed remaining lifetime.

**Burn-after-read** needs an atomic claim: \`DELETE ... RETURNING\` or a Redis \`GETDEL\` — two concurrent readers must not both see it.`,
      code: [
        {
          language: 'typescript',
          title: 'Create paste: presigned upload for large content, blob-first ordering',
          code: `import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Pool } from 'pg';

const INLINE_LIMIT = 64 * 1024;           // <= 64 KB stored inline in Postgres
const MAX_SIZE = 10 * 1024 * 1024;        // 10 MB hard limit

export async function createPaste(
  s3: S3Client, db: Pool, key: string,
  input: { content?: string; size: number; ttlSeconds?: number; ownerId?: string },
) {
  if (input.size > MAX_SIZE) throw new Error('PAYLOAD_TOO_LARGE');
  const expiresAt = input.ttlSeconds ? new Date(Date.now() + input.ttlSeconds * 1000) : null;

  if (input.content !== undefined && input.size <= INLINE_LIMIT) {
    await db.query(
      'INSERT INTO pastes (key, owner_id, inline_body, size, expires_at) VALUES ($1,$2,$3,$4,$5)',
      [key, input.ownerId ?? null, input.content, input.size, expiresAt],
    );
    return { key };
  }
  // Large paste: client uploads directly to S3; row is created as PENDING and
  // flipped to READY by an S3 ObjectCreated event, so readers never see a
  // row whose blob does not exist yet.
  const s3Key = 'pastes/' + key;
  await db.query(
    "INSERT INTO pastes (key, owner_id, s3_key, size, expires_at, status) VALUES ($1,$2,$3,$4,$5,'PENDING')",
    [key, input.ownerId ?? null, s3Key, input.size, expiresAt],
  );
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: 'pastes', Key: s3Key, ContentLength: input.size }),
    { expiresIn: 300 },                   // 5-minute upload window
  );
  return { key, uploadUrl };
}`,
        },
      ],
      keyPoints: [
        'Blob in S3, metadata in DB; inline tiny pastes for simplicity.',
        'Write blob before (or confirm blob before exposing) metadata.',
        'Expiry = lazy read check + sweeper + S3 lifecycle; CDN TTL ≤ remaining life.',
      ],
      source: 'Grokking the System Design Interview — Pastebin; AWS S3 docs (lifecycle, presigned URLs)',
    },
    {
      heading: 'Distributed KV Store (1/4): requirements, CAP choice, partitioning with consistent hashing',
      body: `**Intuition:** a Dynamo-style store is "a hash map spread over a ring of machines, where every key lives on N neighbours so any single machine can die."

**Requirements** (Alex Xu Vol 1 Ch 6 / Dynamo): \`put(key, value)\` and \`get(key)\`; small values (< 10 KB); store huge data sets; **high availability** even during partitions; automatic scaling (add/remove nodes); **tunable consistency**; low latency (single-digit ms p99 in-DC).

**CAP choice:** in a network partition you must pick consistency or availability. A shopping-cart-style store picks **AP**: always accept writes, reconcile later (Dynamo, Cassandra, Riak). A config/lock store picks **CP** (etcd, ZooKeeper — covered in consensus topics). Say which you are building and why.

**Partitioning with consistent hashing:** hash each node (and each key) onto a ring of 2^128 (MD5) or 2^64 positions; a key belongs to the first node clockwise. Adding/removing a node only moves ~1/N of keys (vs ~all keys with \`hash % N\`).

**Virtual nodes (vnodes):** each physical node owns many positions (Cassandra historically defaulted to 256 tokens per node; newer versions recommend 16 with a smarter allocator). Benefits: smoother load distribution, heterogeneous capacity (a bigger box gets more vnodes), and when a node dies its load spreads across *many* peers instead of one neighbour.

**Replication:** the key is stored on the first **N distinct physical nodes** clockwise — the *preference list*. Skip vnodes that belong to a physical node already chosen, and for DC/rack awareness place replicas in different racks/AZs.`,
      code: [
        {
          language: 'typescript',
          title: 'Consistent hash ring with virtual nodes and a distinct-node preference list',
          code: `import { createHash } from 'node:crypto';

function h(s: string): bigint {                // 64-bit position from MD5
  return createHash('md5').update(s).digest().readBigUInt64BE(0);
}

export class HashRing {
  private points: { pos: bigint; node: string }[] = [];

  constructor(nodes: string[], private vnodes = 128) {
    nodes.forEach((n) => this.add(n));
  }

  add(node: string) {
    for (let i = 0; i < this.vnodes; i++) this.points.push({ pos: h(node + '#' + i), node });
    this.points.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0));
  }

  remove(node: string) {
    this.points = this.points.filter((p) => p.node !== node);
  }

  /** First N DISTINCT physical nodes clockwise from the key: the preference list. */
  preferenceList(key: string, n = 3): string[] {
    const k = h(key);
    let lo = 0, hi = this.points.length;       // binary search first pos >= k
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid].pos < k) lo = mid + 1; else hi = mid;
    }
    const out: string[] = [];
    for (let i = 0; i < this.points.length && out.length < n; i++) {
      const node = this.points[(lo + i) % this.points.length].node; // wrap around
      if (!out.includes(node)) out.push(node);  // skip vnodes of chosen hosts
    }
    return out;
  }
}`,
        },
      ],
      keyPoints: [
        'AP store (Dynamo/Cassandra) vs CP store (etcd): decide explicitly.',
        'Consistent hashing moves ~1/N keys on membership change; vnodes smooth load.',
        'Preference list = first N distinct physical nodes, rack/AZ-aware.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 5 & 6; Dynamo paper §4.2–4.3',
    },
    {
      heading: 'Distributed KV Store (2/4): quorum reads/writes and vector-clock conflict resolution',
      body: `**Intuition:** with 3 copies, you don't wait for everyone — you wait for "enough". If the set of nodes you wrote to and the set you read from must overlap, you'll see the latest write.

**Quorum:** N replicas, a write succeeds after **W** acks, a read returns after **R** responses. If **R + W > N**, read and write sets intersect in at least one node.

| Config (N=3) | Behaviour |
|---|---|
| W=1, R=3 | Fast writes, slow reads |
| W=3, R=1 | Fast reads, writes fail if any replica is down |
| W=2, R=2 | Balanced, tolerates 1 failure — the usual default |
| W=1, R=1 | Fastest, eventual consistency only |

**Caveats a senior mentions:** R+W>N is *not* linearizability. Sloppy quorums (hinted handoff to non-preference nodes), concurrent writes, and last-write-wins clock skew can all return stale or lost data. Cassandra's LOCAL_QUORUM + LWW timestamps is "strong-ish" but not linearizable without Paxos-based lightweight transactions.

**Conflicts:** with W < N and concurrent writers, replicas diverge. Two strategies:
1. **Last-write-wins (LWW)** by timestamp — simple, used by Cassandra, but silently **drops** a concurrent write and depends on clocks.
2. **Vector clocks** (Dynamo): each version carries \`{node: counter}\`. Version A *descends* from B if every counter in A ≥ B's. If neither descends from the other they are **siblings** (concurrent) — return both to the client for semantic merge (e.g., union of cart items), then write back the merged value with a clock that dominates both.

Vector clocks grow with the number of coordinators; Dynamo truncates the oldest entries past a threshold (~10), accepting rare false conflicts. Riak moved to **dotted version vectors** to fix sibling explosion. CRDTs (G-counters, OR-sets) are the modern alternative when the merge can be defined by data type.`,
      code: [
        {
          language: 'typescript',
          title: 'Vector clock compare + sibling reconciliation on read',
          code: `export type VClock = Record<string, number>;
export type Order = 'BEFORE' | 'AFTER' | 'EQUAL' | 'CONCURRENT';

export function compare(a: VClock, b: VClock): Order {
  let aBigger = false, bBigger = false;
  for (const node of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[node] ?? 0, y = b[node] ?? 0;
    if (x > y) aBigger = true;
    if (y > x) bBigger = true;
  }
  if (aBigger && bBigger) return 'CONCURRENT';  // neither descends: siblings
  if (aBigger) return 'AFTER';
  if (bBigger) return 'BEFORE';
  return 'EQUAL';
}

export function increment(c: VClock, coordinator: string): VClock {
  return { ...c, [coordinator]: (c[coordinator] ?? 0) + 1 };
}

export function merge(a: VClock, b: VClock): VClock {
  const out: VClock = { ...a };
  for (const [n, v] of Object.entries(b)) out[n] = Math.max(out[n] ?? 0, v);
  return out;
}

/** Keep only versions not dominated by another: the sibling set returned to clients. */
export function reconcile<T>(versions: { value: T; clock: VClock }[]) {
  return versions.filter((v, i) =>
    !versions.some((w, j) => j !== i &&
      (compare(w.clock, v.clock) === 'AFTER' ||
       (compare(w.clock, v.clock) === 'EQUAL' && j < i))));   // dedupe equals
}`,
        },
      ],
      keyPoints: [
        'R + W > N gives overlapping quorums, not linearizability.',
        'LWW silently drops concurrent writes; vector clocks surface them as siblings.',
        'Client (or CRDT) merges siblings and writes back a dominating clock.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 6; Dynamo paper §4.4',
    },
    {
      heading: 'Distributed KV Store (3/4): failure detection with gossip, hinted handoff & Merkle-tree anti-entropy',
      body: `**Intuition:** nodes gossip like office colleagues ("have you heard from Bob lately?"); when Bob is out sick, a colleague takes his mail and hands it over when he returns; once a week everyone compares ledgers to fix anything missed.

**1. Failure detection — gossip protocol.** A central heartbeat server is a SPOF; all-to-all heartbeats are O(n²). Instead each node keeps a membership list of \`(node, heartbeatCounter, lastUpdatedLocalTime)\`, increments its own counter every ~1 s, and sends its list to a few random peers. Peers merge by taking the max counter. If a node's counter has not increased for T seconds (e.g. 10–30 s), it is *suspected*, and after more peers agree, marked down. Cassandra uses a **phi-accrual** detector: instead of a fixed timeout, it computes a suspicion level φ from the inter-arrival distribution of heartbeats (default \`phi_convict_threshold\` = 8), adapting to noisy networks.

**2. Temporary failures — sloppy quorum + hinted handoff.** If a preference-list node is down, the coordinator writes to the next healthy node on the ring with a **hint** ("this belongs to node C"). When C returns, the hint is replayed to it. This keeps writes available (W acks achieved) during outages — but reads with R from the "real" replicas may miss the write until handoff completes. That's why sloppy quorum breaks the R+W>N guarantee.

**3. Permanent failures / drift — anti-entropy with Merkle trees.** Hints can be lost (the hint-holder dies too) and hints have a window (Cassandra \`max_hint_window\`, default 3 h). Replicas periodically compare data using a **Merkle tree** per key range: leaves hash buckets of keys, parents hash their children. Two replicas compare root hashes; if they differ they recurse only into differing subtrees — so syncing costs are proportional to the *differences*, not the data set size. Cassandra calls this *repair* (\`nodetool repair\`), and you must run it within \`gc_grace_seconds\` (default 10 days) or deleted data can **resurrect** (tombstones get purged on one replica while another still holds the old value).

**4. Read repair.** On a read with R=2, if the coordinator sees differing versions it writes the newest back to stale replicas — cheap, opportunistic healing of hot keys.

**5. Data-center outage.** Replicate across ≥ 2–3 DCs (Cassandra NetworkTopologyStrategy, e.g. RF=3 per DC) and use LOCAL_QUORUM so a DC loss doesn't block writes.`,
      diagram: `  Merkle anti-entropy between replica A and replica B (key range 1..12)

          A: root h(1-12)=9f3            B: root h(1-12)=4c1   <- differ
               /        \\                      /        \\
        h(1-6)=aa1   h(7-12)=77e         h(1-6)=aa1   h(7-12)=e02
         (equal -> skip)  |                 (skip)        |
                      +---+---+                       +---+---+
                   h(7-9) h(10-12)                 h(7-9) h(10-12)
                    =31c   =b90                     =31c   =5d4  <- differ
                                                             |
                                    only keys 10..12 are exchanged`,
      keyPoints: [
        'Gossip + phi-accrual: decentralized, adaptive failure detection.',
        'Hinted handoff keeps writes available but breaks strict quorum overlap.',
        'Merkle trees make repair cost proportional to divergence; repair within gc_grace to avoid zombie data.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 6; Dynamo paper §4.6–4.8; Cassandra docs',
    },
    {
      heading: 'Distributed KV Store (4/4): the storage engine — LSM write path, read path & compaction',
      body: `**Intuition:** an LSM tree is a notebook you only ever append to; periodically you rewrite old pages into a tidy, sorted binder. Writes are always sequential (fast), reads may have to check several binders (so you add indexes and Bloom filters).

**Write path (Cassandra/RocksDB/Bigtable):**
1. Append to the **commit log / WAL** (sequential; fsync per batch — Cassandra's default \`commitlog_sync: periodic\` every 10 s trades a small durability window for throughput; \`batch\` mode fsyncs before ack).
2. Insert into the **memtable** (in-memory sorted structure — skip list).
3. When the memtable reaches its threshold (tens to hundreds of MB), flush it as an immutable, sorted **SSTable** to disk and discard the corresponding commit-log segment.

**Read path:**
1. Check the memtable (latest data).
2. For each SSTable, newest to oldest: consult its **Bloom filter** (1% FPR ≈ 9.6 bits/key) — skip SSTables that definitely don't have the key.
3. For candidate SSTables, use the **sparse index/summary** to jump to the right block, read the block (often from the OS page cache or a block cache), and merge versions by timestamp; tombstones hide deleted values.

**Compaction** merges SSTables, drops overwritten values and expired tombstones:

| Strategy | Good for | Cost |
|---|---|---|
| **Size-tiered (STCS)** | Write-heavy | Up to ~50% free-space headroom, more SSTables per read |
| **Leveled (LCS)** | Read-heavy, updates | ~10× write amplification, ~1 SSTable per level per read |
| **Time-window (TWCS)** | Time-series with TTL | Whole windows drop at once; bad if out-of-order writes |

**B-tree vs LSM** in one line: B-trees (Postgres/InnoDB) update in place → better reads and predictable latency; LSMs turn random writes into sequential ones → 5–10× higher write throughput, at the cost of read and space amplification and compaction-induced latency spikes.`,
      diagram: `   WRITE                                  READ get(k)
     |                                      |
     v                                      v
 +-----------+   +-------------+       +----------+  hit -> return
 | commit log|   |  memtable   |<------| memtable |
 | (append,  |   | (skip list) |       +----------+
 |  fsync)   |   +------+------+            | miss
 +-----------+          | flush when full   v
                        v              for each SSTable (newest first):
         +---------+ +---------+        Bloom filter says "maybe"?
  L0     | SST 7   | | SST 6   |          no  -> skip
         +---------+ +---------+          yes -> index -> read block
  L1   +-----------------------+
       | SST 3 (compacted)     |      merge versions, newest timestamp
  L2   +-----------------------+      wins; tombstone => not found
       | SST 1 ... (sorted)    |
       +-----------------------+`,
      keyPoints: [
        'Write = WAL append + memtable insert; flush to immutable SSTables.',
        'Read = memtable → Bloom filters → sparse index → block; merge by timestamp.',
        'Pick compaction by workload: STCS write-heavy, LCS read-heavy, TWCS time-series.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 6; Kleppmann — DDIA Ch 3',
    },
    {
      heading: 'Unique ID Generator: Snowflake, UUIDv7, ticket servers & clock problems',
      body: `**Intuition:** you want IDs that are unique without a meeting — every machine stamps "time + who I am + a counter", so no two machines can ever produce the same stamp.

**Requirements** (Alex Xu Vol 1 Ch 7): unique, numeric, fits in 64 bits, roughly ordered by time, ≥ 10,000 IDs/s across the fleet, highly available.

| Option | Size | Sortable | Coordination | Notes |
|---|---|---|---|---|
| DB auto-increment (single) | 64 | Yes | Central | SPOF, write bottleneck |
| Multi-master auto-increment (step k) | 64 | Per-server only | Config | Hard to add servers; not time-ordered across servers |
| **Ticket server** (Flickr) | 64 | Yes | Central DB | \`REPLACE INTO tickets (stub) VALUES ('a'); SELECT LAST_INSERT_ID();\` — two servers with offsets 1/2 and increment 2 for HA |
| UUIDv4 | 128 | No | None | Random → B-tree page splits, 16 bytes per key, poor locality |
| **UUIDv7** (RFC 9562, 2024) | 128 | Yes (ms) | None | 48-bit Unix ms + 74 random bits; drop-in for UUID columns |
| **Snowflake** | 64 | Yes (ms) | Worker-ID assignment only | 41-bit ms + 10-bit machine + 12-bit sequence |
| ULID | 128 | Yes | None | 48-bit ms + 80 random, Crockford base32 string |

**Snowflake layout:** 1 unused sign bit | **41 bits** ms since a custom epoch (2^41 ms ≈ **69.7 years**) | 5 bits datacenter | 5 bits worker (1,024 machines total) | **12 bits sequence** (4,096 IDs per ms per worker ≈ 4M/s per worker).

**The hard parts:**
- **Worker-ID assignment:** static config breaks in Kubernetes where pods churn. Lease a worker ID from etcd/ZooKeeper/Redis with a TTL, renew it, and stop generating if the lease is lost (else two pods share an ID).
- **Clock moving backwards** (NTP step, VM migration): never generate with a timestamp ≤ the last one. If the skew is small (< ~5 ms) wait it out; if large, refuse and alert. Run chrony with slewing, not stepping.
- **Sequence overflow** within one ms: spin until the next millisecond.
- **Leaking information:** Snowflake IDs reveal creation time and roughly volume — fine for tweets, not for invoice numbers you want unguessable.

**Interview line:** *"Snowflake if I need 64-bit numeric sortable IDs for a sharded store; UUIDv7 if 128 bits is fine and I want zero coordination; ticket server/range leasing if I need dense, strictly increasing numbers."*`,
      code: [
        {
          language: 'typescript',
          title: 'Snowflake generator with clock-rollback and sequence-overflow handling',
          code: `const EPOCH = 1_704_067_200_000n;            // 2024-01-01T00:00:00Z custom epoch
const WORKER_BITS = 10n, SEQ_BITS = 12n;
const MAX_SEQ = (1n << SEQ_BITS) - 1n;         // 4095
const MAX_BACKWARD_WAIT_MS = 5n;

export class Snowflake {
  private lastTs = -1n;
  private seq = 0n;

  constructor(private readonly workerId: bigint) {   // leased from etcd, 0..1023
    if (workerId < 0n || workerId >= 1n << WORKER_BITS) throw new RangeError('workerId');
  }

  next(): bigint {
    let ts = BigInt(Date.now());
    if (ts < this.lastTs) {                     // clock went backwards (NTP step)
      const drift = this.lastTs - ts;
      if (drift > MAX_BACKWARD_WAIT_MS) throw new Error('CLOCK_BACKWARDS_' + drift + 'ms');
      ts = this.waitUntil(this.lastTs);         // small drift: wait it out
    }
    if (ts === this.lastTs) {
      this.seq = (this.seq + 1n) & MAX_SEQ;
      if (this.seq === 0n) ts = this.waitUntil(this.lastTs + 1n); // 4096 used: next ms
    } else {
      this.seq = 0n;
    }
    this.lastTs = ts;
    return ((ts - EPOCH) << (WORKER_BITS + SEQ_BITS)) | (this.workerId << SEQ_BITS) | this.seq;
  }

  private waitUntil(target: bigint): bigint {
    let now = BigInt(Date.now());
    while (now < target) now = BigInt(Date.now());  // busy-wait: sub-ms at most
    return now;
  }
}

// Decode for debugging: which ms and worker produced an id?
export const decode = (id: bigint) => ({
  ms: Number((id >> 22n) + EPOCH),
  worker: Number((id >> 12n) & 1023n),
  seq: Number(id & 4095n),
});`,
        },
      ],
      keyPoints: [
        'Snowflake: 41-bit ms (~69 yrs), 10-bit worker, 12-bit seq = 4,096/ms/worker.',
        'Lease worker IDs dynamically in k8s; never reuse one concurrently.',
        'UUIDv7 = sortable, coordination-free, 128-bit; UUIDv4 hurts B-tree locality.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 7; RFC 9562; Twitter Snowflake',
    },
    {
      heading: 'Notification Service (1/2): requirements, estimation & architecture',
      body: `**Intuition:** a notification system is a **post office**: senders drop letters at the counter, sorters route them by delivery method, and couriers (APNs, FCM, Twilio, SES) actually deliver. The post office never delivers itself — it owns routing, reliability and politeness.

**Functional:** send push (iOS/Android/web), SMS and email; triggered by services (order shipped) or scheduled/campaign jobs (marketing); templates with localisation; user **preferences/opt-outs** per channel and category; delivery status tracking.

**Non-functional:** soft real-time (transactional within seconds; marketing can lag minutes), **at-least-once** delivery with dedup (no double OTP SMS), never violate opt-out (legal: TCPA, CAN-SPAM, GDPR), horizontally scalable for campaign bursts, provider-failure tolerant.

**Estimation** (Alex Xu Vol 1): 10M push + 1M SMS + 5M email/day ≈ 16M/day ≈ **185/s average** — trivial on average; the real load is **campaigns**: "send to 50M users in 10 minutes" ≈ **83K/s** burst. SMS costs money (~$0.0079 per US SMS on Twilio; far more internationally) → SMS paths need strict dedup and rate limits.

**Architecture:**
1. **Notification API** (internal, authN via service identity): validates payload, resolves template, checks **preferences** and **dedup key**, writes a notification record, publishes to a **per-channel queue**.
2. **Per-channel queues** (Kafka topics / SQS): isolation — an SES outage must not back up push. Separate *transactional* and *bulk/marketing* priority lanes so a 50M campaign doesn't delay OTPs.
3. **Channel workers**: fetch device tokens / phone / email, render template, call provider with timeouts, record result, retry with backoff, route to DLQ.
4. **Providers:** APNs (HTTP/2, token-based JWT auth), FCM HTTP v1 API, Twilio/MSG91 for SMS, SES/SendGrid for email. Keep **≥ 2 providers** for SMS/email for failover.
5. **Tracking:** provider callbacks (delivered, bounced, opened, clicked) → events → analytics; hard bounces and invalid tokens (APNs 410 Unregistered, FCM UNREGISTERED) prune contact data.`,
      diagram: `  services / campaign scheduler
            |  POST /notifications  {userId, type, data, idempotencyKey}
            v
   +-------------------+   prefs +   +--------------------+
   | Notification API  |---------->| user prefs / contact|  (cache: Redis)
   | validate, dedup,  |  lookups  | devices, templates  |
   | template, persist |           +--------------------+
   +---------+---------+
             | publish by channel + priority
     +-------+---------+------------------+
     v                 v                  v
 [push.tx|push.bulk] [sms.tx|sms.bulk] [email.tx|email.bulk]   (Kafka/SQS)
     |                 |                  |
     v                 v                  v
 push workers      sms workers        email workers  -- retry/backoff --> DLQ
     |                 |                  |
   APNs / FCM     Twilio | MSG91      SES | SendGrid   (2 providers, failover)
     |                 |                  |
     +----- delivery callbacks / webhooks ----> status events -> analytics`,
      keyPoints: [
        'Average load is tiny; design for campaign bursts (~10^5/s).',
        'Per-channel + per-priority queues isolate failures and protect OTPs.',
        'Prune invalid tokens and hard bounces from provider feedback.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 10 (Design a Notification System)',
    },
    {
      heading: 'Notification Service (2/2): dedup, retries, rate limits, preferences & templates',
      body: `**Reliability contract:** exactly-once delivery to a phone is impossible (a provider can accept and then time out on the ack). You build **at-least-once + idempotency**:

- **Idempotency key** per logical notification: \`(eventId, userId, channel)\`. Before calling the provider, the worker atomically claims it (\`SET key NX EX 86400\` in Redis or a unique row). On retry after a crash the claim exists → check the stored status instead of resending. For SMS/OTP this is money and user trust.
- **Transactional outbox** in the calling service: write the business change and the "notification requested" event in one DB transaction; a relay publishes it. Otherwise "order committed but notification lost" (or vice versa) happens on every crash.
- **Retries:** exponential backoff with jitter (e.g. 1 s, 4 s, 16 s, 64 s ± 20%), max ~5–8 attempts; classify errors — 4xx invalid token → **don't retry**, prune; 429/5xx/timeouts → retry; after max → DLQ + alert.
- **Provider failover:** circuit breaker per provider; on open, route SMS to the secondary.

**Rate limits (three kinds):**
1. **Per-user frequency caps** ("max 3 marketing pushes/day") — user experience; enforced before enqueue via a Redis counter per user/category/day.
2. **Per-provider throughput** (APNs/FCM have quotas, SES has a per-account send rate, SMS short codes ~100 msg/s) — token bucket in the worker pool.
3. **Quiet hours / time zones** — marketing messages delayed to the user's local daytime (a delay queue).

**Preferences:** \`(user_id, channel, category) → opted_in\` with category granularity (security alerts can't be disabled; marketing can). Check at enqueue **and** at send time (user may unsubscribe between). Email needs one-click List-Unsubscribe headers (Gmail/Yahoo bulk-sender rules since 2024).

**Templates:** versioned, per-locale, rendered in workers with a safe engine (Handlebars with escaping); push payload limit is **4 KB** for APNs and FCM.`,
      code: [
        {
          language: 'typescript',
          title: 'SMS worker: idempotent claim, error classification, bounded retry',
          code: `import Redis from 'ioredis';

type Job = { id: string; eventId: string; userId: string; phone: string; body: string; attempt: number };
type ProviderResult = { ok: true; providerMsgId: string } | { ok: false; status: number };

export async function handleSms(
  job: Job, redis: Redis,
  send: (phone: string, body: string, signal: AbortSignal) => Promise<ProviderResult>,
  retryLater: (job: Job, delayMs: number) => Promise<void>,
  deadLetter: (job: Job, reason: string) => Promise<void>,
) {
  const key = 'notif:sms:' + job.eventId + ':' + job.userId;
  // Claim: only one worker (or one retry) may send this logical message
  const claimed = await redis.set(key, 'SENDING', 'EX', 86_400, 'NX');
  if (!claimed) {
    const state = await redis.get(key);
    if (state !== 'RETRY') return;        // SENT/FAILED/in-flight: duplicate job
    await redis.set(key, 'SENDING', 'EX', 86_400);  // our scheduled retry owns it
  }
  const res = await send(job.phone, job.body, AbortSignal.timeout(5_000)).catch(
    (): ProviderResult => ({ ok: false, status: 599 }),     // timeout / network
  );
  if (res.ok) {
    await redis.set(key, 'SENT', 'EX', 86_400);
    return;
  }
  const retryable = res.status === 429 || res.status >= 500;
  if (!retryable) {                                          // bad number, opted out
    await redis.set(key, 'FAILED', 'EX', 86_400);
    return deadLetter(job, 'provider_' + res.status);
  }
  if (job.attempt >= 6) return deadLetter(job, 'max_attempts');
  // 599 is ambiguous (provider may have sent it): keep SENDING only if the
  // provider supports idempotent client reference; here we release to retry.
  await redis.set(key, 'RETRY', 'EX', 86_400);
  const base = 1000 * 4 ** job.attempt;                      // 1s, 4s, 16s, 64s...
  const delay = Math.min(base, 15 * 60_000) * (0.8 + Math.random() * 0.4);
  await retryLater({ ...job, attempt: job.attempt + 1 }, delay);
}`,
        },
      ],
      keyPoints: [
        'At-least-once + idempotency key per (event, user, channel).',
        'Classify errors: never retry 4xx-invalid; backoff+jitter on 429/5xx; DLQ after N.',
        'Three rate limits: per-user caps, per-provider throughput, quiet hours.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 10',
    },
    {
      heading: 'File Upload Service (brief): presigned multipart, resumable uploads & post-processing',
      body: `**Intuition:** never let multi-GB bytes flow through your API pods — give the client a signed "permission slip" and let it upload straight to object storage in chunks.

**Flow:**
1. \`POST /uploads\` {filename, size, contentType, sha256?} → server checks quota/type, creates an \`uploads\` row (PENDING), calls S3 **CreateMultipartUpload**, returns uploadId + presigned URLs for parts (5 MB–5 GB each, max 10,000 parts, object ≤ 5 TB).
2. Client uploads parts **in parallel** (4–8 concurrent), retrying individual failed parts; records ETags. A 5 GB file on flaky mobile resumes from the last completed part — ask the server \`ListParts\` to recover state.
3. \`POST /uploads/{id}/complete\` with part ETags → server calls **CompleteMultipartUpload**, marks the row UPLOADED.
4. S3 event → queue → **post-processing workers**: virus scan (ClamAV), content-type sniffing (don't trust the client), thumbnails/transcoding, checksum verification → status READY. Only READY files are downloadable.

**Details seniors mention:** an S3 lifecycle rule to **abort incomplete multipart uploads** after N days (orphan parts are billed); presigned URL expiry of minutes; \`Content-Length\`/content-type conditions in the signature; download via CDN with signed URLs/cookies; dedup by content hash (per-user, to avoid leaking existence); and resumable protocols like **tus** when you need browser-level resume.`,
      keyPoints: [
        'Presigned multipart: bytes bypass your servers; parts retried individually.',
        'Post-process asynchronously; expose files only after scan → READY.',
        'Lifecycle rule to abort incomplete multipart uploads.',
      ],
      source: 'AWS S3 docs — Multipart upload limits; tus.io resumable upload protocol',
    },
    {
      heading: 'Short classics: rate limiter and parking lot (OOD) in five minutes each',
      body: `These sometimes appear as a 20-minute sub-question. (The full rate-limiting deep dive lives in the Reliability phase — here is the interview-shaped version.)

**Rate limiter design (Alex Xu Vol 1 Ch 4) — the 4 steps compressed:**
- *Scope:* server-side, per API key/user/IP, multiple rules ("100 req/min per user, 10 logins/min per IP"), distributed across N gateway pods, low added latency (< 1–2 ms), fail-open if the limiter store is down (usually).
- *Algorithm:* **token bucket** (allows bursts, 2 numbers per key) or **sliding-window counter** (weighted previous + current window, ~0.003% error in Cloudflare's measurements). Fixed window allows 2× bursts at boundaries.
- *Architecture:* middleware in the gateway → Redis with an **atomic Lua script** (read-modify-write in one round trip; INCR+EXPIRE separately races). Rules from config, cached locally. Response: **429** + \`Retry-After\`, \`X-RateLimit-Remaining\`.
- *Deep dives:* Redis Cluster hot keys, multi-region (local limits + async sync, accept slight over-admission), shadow mode before enforcing.

**Parking lot — object-oriented design:** interviewers look for clean entities, extensibility and concurrency on spot allocation, not a distributed system.
- Entities: \`ParkingLot\` → \`Level[]\` → \`Spot\` (type: COMPACT/REGULAR/LARGE/EV/HANDICAPPED); \`Vehicle\` (Motorcycle/Car/Truck) with \`canFitIn(spot)\`; \`Ticket\` (entry time, spot, vehicle); \`PricingStrategy\` (hourly, flat, dynamic — Strategy pattern); \`Gate\` (entry/exit), \`Payment\`.
- **Concurrency:** two entry gates must not assign the same spot — use a per-type free-spot queue with atomic poll, or in a DB \`UPDATE spots SET ticket_id=$1 WHERE id=(SELECT id FROM spots WHERE type=$2 AND ticket_id IS NULL LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id\`.
- Extensibility: new vehicle/spot types without changing allocation logic (open/closed), pluggable pricing, display boards subscribed to spot events (Observer).`,
      code: [
        {
          language: 'typescript',
          title: 'Parking lot core: typed spots, strategy pricing, atomic allocation',
          code: `type SpotType = 'COMPACT' | 'REGULAR' | 'LARGE';
type VehicleType = 'MOTORCYCLE' | 'CAR' | 'TRUCK';

const FITS: Record<VehicleType, SpotType[]> = {       // smallest spot first
  MOTORCYCLE: ['COMPACT', 'REGULAR', 'LARGE'],
  CAR: ['REGULAR', 'LARGE'],
  TRUCK: ['LARGE'],
};

interface PricingStrategy { price(entry: Date, exit: Date, spot: SpotType): number }

export class HourlyPricing implements PricingStrategy {
  constructor(private rates: Record<SpotType, number>) {}
  price(entry: Date, exit: Date, spot: SpotType) {
    const hours = Math.ceil((exit.getTime() - entry.getTime()) / 3_600_000);
    return Math.max(1, hours) * this.rates[spot];
  }
}

export class ParkingLot {
  // One free list per type; Node is single-threaded, so shift() is atomic here.
  // In a multi-process deployment this becomes FOR UPDATE SKIP LOCKED in SQL.
  private free = new Map<SpotType, string[]>();
  private tickets = new Map<string, { spotId: string; type: SpotType; entry: Date }>();

  constructor(spots: { id: string; type: SpotType }[], private pricing: PricingStrategy) {
    for (const s of spots) this.free.set(s.type, [...(this.free.get(s.type) ?? []), s.id]);
  }

  park(vehicle: VehicleType, ticketId: string) {
    for (const type of FITS[vehicle]) {
      const spotId = this.free.get(type)?.shift();
      if (spotId) {
        this.tickets.set(ticketId, { spotId, type, entry: new Date() });
        return spotId;
      }
    }
    throw new Error('LOT_FULL');
  }

  leave(ticketId: string, exit = new Date()) {
    const t = this.tickets.get(ticketId);
    if (!t) throw new Error('UNKNOWN_TICKET');
    this.tickets.delete(ticketId);
    this.free.get(t.type)!.push(t.spotId);
    return this.pricing.price(t.entry, exit, t.type);
  }
}`,
        },
      ],
      keyPoints: [
        'Rate limiter: token bucket/sliding window + atomic Redis Lua + 429 with Retry-After.',
        'Parking lot: entities, Strategy for pricing, atomic spot allocation.',
        'OOD rounds reward extensibility and concurrency awareness, not scale.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 4 (Rate Limiter)',
    },
    {
      heading: 'Bottlenecks, trade-offs & wrap-up across the classics',
      body: `Use this as your **closing 3–5 minutes** template. For each design, name the bottleneck, the failure mode and the trade-off you consciously made.

| Design | Primary bottleneck | Key trade-off | What I'd do next |
|---|---|---|---|
| URL shortener | Hot-key reads, DB size (36+ TB) | 301 (cheap) vs 302 (analytics); counter (collision-free) vs hash (stateless) | Edge KV for redirects, abuse scanning, multi-region read replicas |
| Pastebin | Blob egress, expiry cleanup | Inline vs S3 blobs; lazy vs eager deletion | CDN for public raw pastes, lifecycle rules, per-IP creation limits |
| KV store | Compaction / hot partitions / repair | AP + tunable quorum vs linearizable CP; LWW vs vector clocks | Per-table compaction strategy, automated repair, LOCAL_QUORUM multi-DC |
| ID generator | Worker-ID coordination, clock skew | 64-bit Snowflake vs 128-bit UUIDv7 vs dense ticket IDs | Lease-based worker IDs, clock monitoring, fail closed on big skew |
| Notifications | Campaign bursts, provider quotas | At-least-once + dedup vs lost messages; cost of SMS vs reach | Priority lanes, provider failover, per-user frequency caps, analytics loop |
| File upload | Large-object transfer, orphan parts | Direct-to-S3 vs proxying (control vs cost) | Content scanning pipeline, resumable (tus), CDN signed downloads |

**Cross-cutting checklist:** observability (RED metrics per endpoint, queue lag), security (authN on create APIs, signed URLs, abuse controls), cost (egress, SMS), data lifecycle (retention/GDPR delete), and the **one thing you'd change at 10×** (e.g., "at 10× I'd move redirects to edge compute and make the DB write-only from the edge's perspective").

**Interview phrasing:** *"The part I'm least comfortable with is X; given more time I'd validate it with a load test at 3× peak and a game-day killing a cache node."* — owning uncertainty is a senior signal.`,
      keyPoints: [
        'Close with bottleneck → failure mode → trade-off → next step.',
        'Always mention observability, abuse and cost.',
        'State what changes at 10× scale.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'design-classics-cc-1',
      title: 'Harden the URL-shortener create endpoint',
      context:
        'A teammate shipped the create-link service. Under load testing, two users occasionally got the same custom alias, some requests hung forever, and the DB CPU spiked during a spam burst. Codes are also trivially enumerable (aaaaaab, aaaaaac...).',
      task:
        'Refactor createShortUrl so that alias claims are race-free, generated codes are collision-free and non-sequential, the DB is protected from abuse, and the handler cannot hang or loop forever.',
      starter: {
        language: 'typescript',
        code: `import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

let counter = 0;   // in-memory counter per pod

export async function createShortUrl(db: Pool, longUrl: string, alias?: string) {
  if (alias) {
    const existing = await db.query('SELECT 1 FROM short_urls WHERE code = $1', [alias]);
    if (existing.rowCount) throw new Error('ALIAS_TAKEN');
    await db.query('INSERT INTO short_urls (code, long_url) VALUES ($1, $2)', [alias, longUrl]);
    return alias;
  }
  // Try hashing first, fall back to counter
  let code = createHash('md5').update(longUrl).digest('base64').slice(0, 7);
  while (true) {
    const r = await db.query('SELECT long_url FROM short_urls WHERE code = $1', [code]);
    if (!r.rowCount) break;
    if (r.rows[0].long_url === longUrl) return code;
    code = createHash('md5').update(code).digest('base64').slice(0, 7);
  }
  if (!code) code = (counter++).toString(36);
  await db.query('INSERT INTO short_urls (code, long_url) VALUES ($1, $2)', [code, longUrl]);
  return code;
}`,
      },
      hints: [
        'What happens between the SELECT and the INSERT when two requests race for the same alias?',
        'base64 output contains "+" and "/" — are those URL-safe? Is the while loop bounded? Is the per-pod counter unique across pods?',
        'Consider leasing ID ranges and scrambling them, and validating URL/alias input before touching the DB.',
      ],
      solution: {
        language: 'typescript',
        code: `import type { Pool } from 'pg';
import { encodeId } from './base62';          // scramble + fixed-width base62
import { IdRangeLease } from './id-range';    // leases 10k-id blocks from a coordinator

const RESERVED = new Set(['api', 'admin', 'login', 'static', 'health']);
const ALIAS_RE = /^[0-9a-zA-Z_-]{4,32}$/;

export class ShortUrlService {
  constructor(private db: Pool, private ids: IdRangeLease) {}

  async create(longUrl: string, ownerId: string, alias?: string): Promise<string> {
    const url = normalizeUrl(longUrl);                  // throws on bad input
    if (alias !== undefined) {
      if (!ALIAS_RE.test(alias) || RESERVED.has(alias.toLowerCase())) throw new Error('INVALID_ALIAS');
      const ok = await this.insert(alias, url, ownerId);
      if (!ok) throw new Error('ALIAS_TAKEN');          // unique constraint decided
      return alias;
    }
    // Leased IDs are globally unique, so a collision means a bug or an alias
    // squatting on a generated code: retry a bounded number of times.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = encodeId(await this.ids.next());     // non-sequential, 7 chars
      if (await this.insert(code, url, ownerId)) return code;
    }
    throw new Error('CODE_ALLOCATION_FAILED');
  }

  private async insert(code: string, url: string, ownerId: string): Promise<boolean> {
    const r = await this.db.query({
      text: 'INSERT INTO short_urls (code, long_url, owner_id) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING',
      values: [code, url, ownerId],
      // statement_timeout is set per-role in Postgres; client timeout guards the pool
    });
    return r.rowCount === 1;
  }
}

function normalizeUrl(raw: string): string {
  if (raw.length > 2048) throw new Error('URL_TOO_LONG');
  const u = new URL(raw);                                // throws on garbage
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('BAD_SCHEME');
  return u.toString();
}`,
      },
      explanation: `**Fixes:**
- **Race on alias:** SELECT-then-INSERT is a TOCTOU race; two requests both see "free". The unique constraint with \`ON CONFLICT DO NOTHING\` makes the database the arbiter — \`rowCount === 1\` means you won.
- **Unbounded loop:** the rehash loop could spin forever (and hammers the DB with one query per iteration). Replaced with a bounded (3) retry over collision-free IDs.
- **Unsafe alphabet:** base64 emits \`+\` and \`/\`, which break URLs. Use a base62 alphabet.
- **Per-pod counter:** \`counter++\` in memory collides across pods and resets on restart. Leasing ranges from a coordinator gives global uniqueness with one round trip per 10K IDs.
- **Enumerability:** raw sequential codes let scrapers walk every link; the multiplicative scramble in \`encodeId\` is a bijection so it stays collision-free.
- **Input validation & abuse:** validate the URL scheme/length and alias charset/reserved words before any DB work; pair with a per-API-key rate limiter at the gateway (not shown) to protect the DB during spam bursts.
- **Dedup by URL removed:** returning an existing code for the same URL leaked other users' links and broke per-owner analytics.`,
      followUps: [
        {
          "q": "`encodeId` scrambles a leased counter with a multiplicative bijection. How do you test that it never produces duplicates, and how hard is it for a scraper to reverse?",
          "a": "Test bijectivity directly: the multiplier must be coprime with the modulus (62^7), so assert gcd = 1 and check that decode(encode(x)) == x for random samples and edge values (0, max). A property test over a few million consecutive IDs that inserts outputs into a Set confirms there are no collisions in practice. As for reversal, multiplicative scrambling is obfuscation, not encryption: with a few known pairs an attacker can solve for the multiplier. If enumeration resistance matters, use a keyed format-preserving cipher (e.g. FF1 or a Feistel network) over the ID space."
        },
        {
          "q": "The ID-range coordinator is unreachable for 10 minutes. How long can creation continue, and what's the trade-off in the block size?",
          "a": "Each pod keeps creating codes until its current 10K block runs out. At 3.5K writes/s peak across, say, 10 pods, each pod uses ~350 IDs/s, so a block lasts about 30 s, not 10 minutes. Larger blocks (e.g. 1M) or prefetching the next block when the current one is half used keep pods running for much longer. The cost is wasted IDs when a pod dies mid-block, which is acceptable in a 3.5-trillion space, and slightly less ordered codes across pods."
        }
      ],
    },
    {
      id: 'design-classics-cc-2',
      title: 'Fix the campaign notification fan-out worker',
      context:
        'Marketing launched a 20M-user push campaign. Users received the same push 2–4 times, some users who unsubscribed yesterday still got it, the OTP queue stalled for 25 minutes, and APNs started returning 429s. This is the worker consuming the campaign Kafka topic.',
      task:
        'Rewrite the consumer so each user gets at most one push per campaign, preferences are honoured at send time, provider quotas are respected, invalid tokens are pruned, and transactional traffic is not starved.',
      starter: {
        language: 'typescript',
        code: `import { Kafka } from 'kafkajs';
import { sendPush } from './apns';
import { db } from './db';

const kafka = new Kafka({ brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'notifications' });

export async function run() {
  await consumer.connect();
  // campaigns and OTPs share one topic
  await consumer.subscribe({ topic: 'notifications' });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const evt = JSON.parse(message.value!.toString());
      const tokens = await db.query('SELECT token FROM devices WHERE user_id = $1', [evt.userId]);
      await Promise.all(
        tokens.rows.map(async (t: { token: string }) => {
          try {
            await sendPush(t.token, evt.title, evt.body);
          } catch (e) {
            // retry immediately until it works
            while (true) {
              try { await sendPush(t.token, evt.title, evt.body); break; } catch {}
            }
          }
        }),
      );
    },
  });
}`,
      },
      hints: [
        'Kafka is at-least-once: what happens on a rebalance after sending but before the offset commits?',
        'Which APNs errors mean "never retry"? What does the infinite retry loop do to the partition and to APNs quotas?',
        'Think about separate topics/consumer groups per priority and a shared token bucket per provider.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Kafka } from 'kafkajs';
import Redis from 'ioredis';
import { sendPush, PushError } from './apns';
import { db, prefs } from './db';
import { TokenBucket } from './token-bucket';   // Redis-backed, shared by all pods

const kafka = new Kafka({ brokers: ['kafka:9092'] });
const redis = new Redis();
const apnsBucket = new TokenBucket(redis, 'rl:apns:bulk', { ratePerSec: 5_000, burst: 10_000 });

// Bulk lane only; OTP/transactional traffic has its own topic + consumer group.
const consumer = kafka.consumer({ groupId: 'push-bulk' });

export async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'push.bulk' });
  await consumer.run({
    partitionsConsumedConcurrently: 8,
    eachMessage: async ({ message }) => {
      const evt = JSON.parse(message.value!.toString()) as { campaignId: string; userId: string; title: string; body: string };
      const dedupKey = 'push:' + evt.campaignId + ':' + evt.userId;
      // At-least-once consumption -> claim before sending; 7-day TTL covers replays
      if (!(await redis.set(dedupKey, '1', 'EX', 7 * 86_400, 'NX'))) return;

      if (!(await prefs.isOptedIn(evt.userId, 'push', 'marketing'))) return; // send-time check

      const { rows } = await db.query('SELECT token FROM devices WHERE user_id = $1 AND active', [evt.userId]);
      for (const { token } of rows as { token: string }[]) {
        await apnsBucket.take();                         // respect provider quota
        try {
          await sendPush(token, evt.title, evt.body, { timeoutMs: 3_000, collapseId: evt.campaignId });
        } catch (e) {
          const err = e as PushError;
          if (err.status === 410 || err.reason === 'BadDeviceToken') {
            await db.query('UPDATE devices SET active = false WHERE token = $1', [token]); // prune
          } else if (err.status === 429 || err.status >= 500) {
            await redis.del(dedupKey);                   // allow the retry path to resend
            throw err;                                   // offset not committed; retry via
          }                                              // kafkajs backoff, then DLQ topic
        }
      }
    },
  });
}`,
      },
      explanation: `**Fixes:**
- **Duplicates:** Kafka redelivers on rebalance/crash, and the starter had no idempotency. A Redis \`SET NX\` claim on \`(campaignId, userId)\` makes redelivery a no-op.
- **Stale preferences:** preferences are checked at **send time**, not only when the campaign was enqueued hours earlier.
- **OTP starvation:** campaigns and OTPs shared one topic/consumer group, so 20M marketing messages sat in front of OTPs. Separate topics (\`push.tx\`, \`push.bulk\`) with independent consumer groups and capacity.
- **Infinite hot retry:** \`while(true)\` blocked the partition forever and amplified the APNs 429 storm. Now errors are classified: 410/BadDeviceToken → prune token, no retry; 429/5xx → release the claim and throw so the consumer's bounded backoff (and eventually a DLQ) handles it.
- **Provider quota:** a Redis-backed token bucket shared across pods caps the send rate; \`collapseId\` lets APNs collapse duplicates on the device as a last line of defence.
- **Timeouts:** each provider call has a timeout so one slow connection can't pin a worker.`,
      followUps: [
        {
          "q": "The worker sets the dedup key, then crashes before calling APNs. What happens to that user, and how would you fix it?",
          "a": "The user never receives the push: on redelivery the `SET NX` fails and the message is skipped. Fix it with two states: claim as `sending` with a short TTL (e.g. 5 minutes), and only after APNs accepts the push, overwrite it with `sent` and a 7-day TTL. A redelivered message that finds `sending` older than its TTL can take over. That moves the risk from 'lost' to 'rare duplicate', which collapseId handles on the device. For marketing pushes, a small loss may be acceptable, but you should choose that knowingly."
        },
        {
          "q": "How would you load-test this worker before the next 20M campaign without spamming real users?",
          "a": "Point the worker at a fake APNs server that accepts HTTP/2, adds realistic latency (80–300 ms), and returns a configurable mix of 200s, 410s and 429s. Produce 20M synthetic events into a staging `push.bulk` topic with test user IDs whose preferences you control. Assert: exactly one accepted send per user (count at the fake server), opted-out users never appear, the token bucket keeps the rate at or below 5K/s, and the OTP lane's latency stays flat while bulk runs. Kill pods during the run to exercise rebalances and redelivery."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-classics-iq-01',
      difficulty: 'hard',
      question: 'Design a URL shortener like bit.ly that handles 100M new links per day and supports click analytics.',
      context: 'Interviewer at a large consumer company. They want the full 4-step walkthrough and will then probe code generation and the redirect path.',
      whatInterviewerLooksFor: [
        'Quantified scope: ~1.2K WPS, ~12K RPS, 7-char base62, ~36 TB over 10 years',
        'A collision-free, non-enumerable code strategy with reasoning',
        'A redirect path that is cache-first and keeps analytics off the critical path',
        'Clear 301 vs 302 decision tied to the analytics requirement',
        'Abuse, hot keys and multi-region thinking',
      ],
      modelAnswer: `### Scope & numbers
- Create (long URL, optional alias/expiry), redirect, analytics per link. 100M/day → **~1.2K WPS**, 10:1 reads → **~12K RPS**, peak 3–5×. 10 years ≈ **365B** rows × 100 B ≈ **36 TB**. 62^7 ≈ **3.5T** codes → 7 chars.

### API
- \`POST /v1/urls {longUrl, alias?, expiresAt?}\` → \`{code, shortUrl}\` (auth via API key; rate limited).
- \`GET /{code}\` → 302 + \`Location\`.
- \`GET /v1/urls/{code}/stats?from&to&groupBy=country\`.

### Data & code generation
- \`short_urls(code PK, long_url, owner_id, created_at, expires_at)\` in DynamoDB/Cassandra or sharded Postgres keyed by code.
- App servers **lease ID ranges** (10K at a time) from a coordinator, pass each ID through a **bijective scramble**, base62-encode to 7 chars. Collision-free by construction, not enumerable, one coordinator call per 10K links. Custom aliases go through the same unique constraint (\`ON CONFLICT DO NOTHING\`).

### Redirect path
- CDN/edge → redirect service → Redis (hot 20% of links gives 90%+ hit ratio) → DB replica on miss. Negative caching for unknown codes.
- **302** because analytics is a requirement (301 would let browsers skip us); add \`Cache-Control: private, max-age=300\` as a compromise if cost matters.

### Analytics
- Redirect service emits click events asynchronously to **Kafka** (never blocks). Flink aggregates per (code, minute, country) into ClickHouse; raw events to S3 for replay. Unique visitors via HyperLogLog.

### Bottlenecks & trade-offs
- Viral hot keys → replicate across cache shards / edge KV.
- Multi-region: write home region, async replicate, fall back to home on miss.
- Abuse: Safe Browsing scan async, per-key limits, interstitials.
- Trade-off: I give up URL-level dedup (privacy + per-owner stats) and accept a coordinator dependency — mitigated because each pod holds a 10K buffer.`,
      followUps: [
        { q: 'Why not just hash the URL with MD5 and take 7 characters?', a: 'Truncating to 42 bits means birthday collisions become common well before 365B rows (the birthday bound puts a 50% chance of at least one collision at only ~2.2M codes, about 1.18 × sqrt(3.5T)), so every insert needs a check-and-retry. It also makes the same URL from different users share one code unless salted.' },
        { q: 'The coordinator is down — can you still create links?', a: 'Yes for a while: each pod holds its leased range (10K IDs ≈ minutes at per-pod rates). Run the coordinator as a replicated etcd/DB row; if it stays down, fail creates (not redirects), since redirects never touch it.' },
        { q: 'How do you support link deletion or editing with a CDN in front?', a: 'Use 302 with short max-age at the CDN, or purge the CDN key on update. With 301 you cannot recall cached browser redirects, which is another reason to avoid it for editable links.' },
      ],
      pitfalls: [
        'Writing a click row synchronously to the main DB on every redirect.',
        'Choosing 301 while also promising accurate analytics.',
        'Using check-then-insert for custom aliases.',
        'Forgetting that sequential codes let anyone enumerate all links.',
      ],
    },
    {
      id: 'design-classics-iq-02',
      difficulty: 'hard',
      question: 'Design Pastebin. Pastes can be up to 10 MB, can expire after 10 minutes, 1 day or never, and can be "burn after reading".',
      whatInterviewerLooksFor: [
        'Separation of blob storage from metadata with a justified size threshold',
        'A write ordering that never exposes metadata without a blob',
        'Multi-layer expiry (lazy read check + sweeper + lifecycle) and CDN TTL correctness',
        'Atomic burn-after-read semantics',
      ],
      modelAnswer: `### Scope & numbers
- 1M pastes/day (~12 WPS), avg 10 KB → ~10 GB/day, ~3.6 TB/year; reads 5–10× writes (~100 RPS, spiky when a paste goes viral).

### API
- \`POST /v1/pastes {content | size, ttl, visibility, burnAfterRead}\` → \`{key, url, uploadUrl?}\`
- \`GET /p/{key}\` (HTML), \`GET /p/{key}/raw\`, \`DELETE /v1/pastes/{key}\` (owner).

### Storage
- **Metadata** in Postgres/DynamoDB: key (8-char base62 from a pre-generated key pool), owner, size, visibility, expires_at, status, s3_key or inline_body.
- **Blobs**: ≤ 64 KB inline in the row (simpler, one read); larger in **S3** via a presigned PUT so bytes skip the API. Row starts PENDING and flips READY on the S3 ObjectCreated event — readers never see a row without a blob. Orphaned blobs get swept.

### Read path
- Public pastes: CDN in front of \`/raw\`, content immutable → long TTL, **capped at remaining lifetime**. Metadata cached in Redis.

### Expiry
1. Read-time check \`expires_at < now()\` → 404 (correctness).
2. Sweeper on a partial index deletes rows then blobs in batches (cost).
3. S3 lifecycle on an expiry prefix (\`exp-1d/\`) as a safety net.

### Burn after read
- Must be atomic: \`DELETE FROM pastes WHERE key=$1 AND burn=true RETURNING *\` (or Redis \`GETDEL\`); only the winner gets the content. **Not cacheable** at CDN — mark \`Cache-Control: no-store\`. Beware link-preview bots (Slack/iMessage unfurlers) "reading" it — require a click-through interstitial.

### Trade-offs
- Inline vs S3: operational simplicity vs DB bloat. Lazy vs eager expiry: correctness always from the read check; storage reclamation eventually.`,
      followUps: [
        { q: 'A paste goes viral: 50K RPS on one key. What breaks?', a: 'Nothing if it is public and CDN-cached — origin sees near-zero. If private (auth required), cache the blob in Redis/in-process LRU and use request coalescing so only one origin fetch per key happens.' },
        { q: 'How would you do full-text search over public pastes?', a: 'Async index pipeline: ObjectCreated → queue → indexer → Elasticsearch/OpenSearch, with deletion events on expiry. Keep it out of the write path.' },
      ],
      pitfalls: [
        'Storing 10 MB blobs in the relational DB without discussion.',
        'Relying only on a cron job for expiry, so expired pastes remain readable.',
        'Caching burn-after-read pastes at the CDN.',
      ],
    },
    {
      id: 'design-classics-iq-03',
      difficulty: 'expert',
      question: 'Design a distributed key-value store like Dynamo that stays writable during network partitions.',
      context: 'Values ≤ 10 KB, hundreds of TB total, single-digit-ms p99 in-DC, multi-DC. The interviewer is a storage engineer.',
      whatInterviewerLooksFor: [
        'Explicit AP choice and what that costs',
        'Consistent hashing with vnodes and a rack-aware preference list',
        'Quorum math and why it is not linearizable (sloppy quorum, LWW)',
        'Full failure handling toolkit: gossip, hinted handoff, read repair, Merkle anti-entropy',
        'Storage engine choice (LSM) with write and read paths',
      ],
      modelAnswer: `### Scope & CAP
- \`get/put\`, tunable consistency, always-writable → **AP**. Cost: clients may see stale reads or concurrent siblings.

### Partitioning & replication
- Consistent hash ring, **vnodes** (e.g. 16–256 per host) for even load and fast rebalancing. Key stored on the first **N=3 distinct hosts** clockwise, spread across racks/AZs; RF=3 per DC for multi-DC.

### Request path
- Any node can coordinate (or a partition-aware client picks one). Writes succeed after **W** acks, reads after **R**. Default N=3, W=2, R=2 tolerates one replica down while keeping R+W>N.
- **Caveat:** with sloppy quorum, hinted handoff and LWW, overlap is not guaranteed → not linearizable. Offer a Paxos-based CAS for the rare strongly-consistent op.

### Conflicts
- Option A: **LWW** timestamps (Cassandra) — simple, drops concurrent writes, clock-dependent.
- Option B: **vector clocks** (Dynamo) — detect concurrency, return siblings, client merges (cart union), writes back dominating clock; truncate clocks at ~10 entries. CRDTs where the type allows.

### Failure handling
- **Gossip** membership with phi-accrual detection.
- **Sloppy quorum + hinted handoff** for temporary failures (hint window ~3 h).
- **Read repair** for hot keys; **Merkle-tree anti-entropy** per range for everything else — repair within gc_grace (10 days) or deleted data resurrects.
- DC loss: LOCAL_QUORUM writes keep the surviving DC available.

### Storage engine
- **LSM**: commit log → memtable → SSTables; Bloom filters (1% FPR ≈ 10 bits/key) + sparse index for reads; compaction strategy per table (leveled for read-heavy, size-tiered for write-heavy, time-window for TTL data).

### Bottlenecks
- Hot partitions (salt/split keys), compaction stalls (throttle, separate disks), large partitions (> ~100 MB hurts), repair load (incremental repair).`,
      followUps: [
        { q: 'A customer says "I wrote with W=2 and read with R=2 and got the old value." How?', a: 'Sloppy quorum: during a failure the write went to a hinted node outside the preference list, so the R=2 read of the real replicas missed it. Or LWW: a concurrent write with a skewed clock "won". Or the read raced the write before W acks completed.' },
        { q: 'How do you add a node without downtime?', a: 'It takes vnode tokens; the previous owners stream the affected ranges to it while still serving; once streaming completes, ownership flips via gossip. Throttle streaming so it does not saturate disks/network.' },
        { q: 'Why not B-trees?', a: 'Write-heavy workloads benefit from LSM turning random writes into sequential appends (5–10× write throughput); B-trees give better, more predictable reads. For a read-heavy, update-in-place workload a B-tree engine can be the right call.' },
      ],
      pitfalls: [
        'Claiming R+W>N means strong consistency.',
        'Using hash(key) % N placement.',
        'Ignoring tombstones and gc_grace when discussing repair.',
        'Using wall-clock LWW without mentioning dropped writes.',
      ],
    },
    {
      id: 'design-classics-iq-04',
      difficulty: 'hard',
      question: 'Design a unique ID generator for a sharded order system: 64-bit, time-sortable, 50K IDs/s across 300 Kubernetes pods.',
      whatInterviewerLooksFor: [
        'Compares Snowflake, UUIDv7, ticket servers with the 64-bit constraint in mind',
        'Solves worker-ID assignment for ephemeral pods',
        'Handles clock rollback and sequence exhaustion correctly',
        'Understands information leakage and ordering guarantees',
      ],
      modelAnswer: `### Options
- **UUIDv7**: coordination-free and sortable but **128-bit** — violates the constraint.
- **Ticket server / DB sequences**: central write bottleneck and SPOF; range leasing helps but IDs from different pods interleave, not strictly time-ordered.
- **Snowflake** fits: 41-bit ms (~69 years from a custom epoch), 10-bit worker (1,024 workers), 12-bit sequence (4,096/ms/worker).

### Capacity check
- 50K/s ÷ 300 pods ≈ 167/s per pod — far below 4.096M/s per worker. Could even reallocate bits (e.g. 8-bit sequence, 14-bit worker) if pod counts grow.

### Worker-ID assignment (the real problem)
- Pods lease an ID from **etcd** (or Redis \`SET NX\` with TTL) at startup: try IDs 0..1023, keep a lease with 10 s TTL, renew every 3 s. If renewal fails, **stop issuing** (fence) — otherwise two pods could share an ID after a partition. On shutdown, release.

### Clock safety
- Track \`lastTs\`. If \`now < lastTs\`: wait if drift ≤ 5 ms, else refuse and alert. Use chrony with slew mode; alert on offset > 1 ms. Sequence overflow in a ms → spin to next ms.

### Properties to state
- IDs are **k-sortable** (ordered by ms across pods, not strictly monotonic globally).
- They leak creation time and approximate volume — use a separate random public identifier for customer-facing order numbers if that matters.
- Shard key: don't shard by raw ID range (all writes hit the newest shard); hash the ID or shard by customer.`,
      followUps: [
        { q: 'You must also run in two regions. What changes?', a: 'Encode region in the worker bits (e.g. 2 bits region + 8 bits worker) and lease from a per-region etcd, so no cross-region coordination on the hot path.' },
        { q: 'Why is a UUIDv4 primary key bad in InnoDB/Postgres?', a: 'Random inserts land on random B-tree pages → page splits, poor cache locality, higher write amplification; time-ordered IDs append to the right edge of the index.' },
      ],
      pitfalls: [
        'Static worker IDs in config for autoscaling pods.',
        'Ignoring clock rollback from NTP steps.',
        'Sharding by ID range and creating a hot shard.',
      ],
    },
    {
      id: 'design-classics-iq-05',
      difficulty: 'expert',
      question: 'Design a notification service (push, SMS, email) for an e-commerce platform with 100M users that also runs 50M-user marketing campaigns.',
      context: 'Past incidents: duplicate OTP SMS costing money, OTPs delayed during campaigns, and users complaining about notifications after unsubscribing.',
      whatInterviewerLooksFor: [
        'Numbers: low average, huge burst; cost awareness for SMS',
        'Channel and priority isolation',
        'At-least-once + idempotency; outbox from producers',
        'Preferences, frequency caps, quiet hours, legal compliance',
        'Provider failover, token pruning, delivery tracking',
      ],
      modelAnswer: `### Numbers
- Transactional ~20M/day ≈ 230/s avg. Campaign: 50M in 10 min ≈ **83K/s**. SMS at ~$0.01 each → a duplicate-send bug on 1M OTPs costs ~$10K.

### Architecture
- Producers (order, auth services) write a **transactional outbox**; relay publishes \`NotificationRequested\`.
- **Notification API/router**: validate, resolve template + locale, check **preferences** (category-level; security alerts non-disableable), **frequency caps**, **dedup key** \`(eventId, userId, channel)\`, persist record, publish to **per-channel, per-priority topics** (\`sms.tx\`, \`sms.bulk\`, \`push.tx\`...).
- **Campaign service** expands audiences in batches (segment → user IDs) at a controlled rate into bulk topics, never the transactional ones.
- **Channel workers**: claim idempotency key, re-check preference at send time, render, call provider with timeout, classify errors, retry with exponential backoff + jitter, DLQ after ~6 attempts.
- **Providers**: APNs/FCM; SMS via two providers with circuit breakers; SES/SendGrid with List-Unsubscribe.

### Rate limits
- Per-provider token buckets (shared in Redis), per-user caps, quiet hours via delay queue in the user's time zone.

### Tracking
- Provider webhooks → status events → analytics; prune tokens on APNs 410 / FCM UNREGISTERED, suppress hard-bounced emails.

### Trade-offs
- At-least-once + dedup instead of impossible exactly-once; ambiguous timeouts (provider may have sent) → for OTP prefer *not* resending automatically (user taps "resend").
- Separate lanes cost more infra but make OTP p99 independent of campaigns.`,
      followUps: [
        { q: 'How do you guarantee the unsubscribe is honoured if the user unsubscribes mid-campaign?', a: 'Check preferences at send time in the worker (cached with a short TTL or invalidated via a preference-change event), not only at audience expansion.' },
        { q: 'APNs returns 429 during the campaign. What do you do?', a: 'Back off the bulk lane via the shared token bucket (lower rate), keep transactional lane rate reserved, retry with jitter; campaigns can stretch from 10 to 30 minutes.' },
        { q: 'How do you measure success?', a: 'End-to-end latency percentiles per lane (enqueue→provider ack), delivery/open rates from callbacks, DLQ size, duplicate-send rate, and opt-out rate per campaign.' },
      ],
      pitfalls: [
        'One shared queue for OTPs and campaigns.',
        'Promising exactly-once delivery.',
        'Retrying invalid-token errors forever.',
        'Checking preferences only at enqueue time.',
      ],
    },
    {
      id: 'design-classics-iq-06',
      difficulty: 'hard',
      question: 'Design a file upload service that lets mobile users upload videos up to 5 GB over unreliable networks, with virus scanning before files are shareable.',
      whatInterviewerLooksFor: [
        'Direct-to-object-storage uploads via presigned multipart',
        'Resumability and part-level retry',
        'Asynchronous post-processing state machine',
        'Cleanup of incomplete uploads and security of URLs',
      ],
      modelAnswer: `### Flow
1. \`POST /uploads {name, size, type}\` → quota/type check, row \`PENDING\`, S3 **CreateMultipartUpload**, return \`uploadId\` + presigned part URLs (e.g. 16 MB parts → 320 parts for 5 GB; limits: 5 MB–5 GB per part, 10,000 parts).
2. Client uploads 4–8 parts concurrently; each part retried independently. App persists completed part numbers + ETags locally; on app restart it asks \`GET /uploads/{id}\` (server calls **ListParts**) and resumes.
3. \`POST /uploads/{id}/complete\` → **CompleteMultipartUpload** → \`UPLOADED\`.
4. S3 event → queue → workers: checksum verify, **magic-byte type sniffing**, ClamAV/commercial scan, transcode/thumbnail → \`READY\` or \`QUARANTINED\`.
5. Downloads only for \`READY\`, via CDN signed URLs (minutes of validity).

### Why this shape
- API pods never proxy 5 GB streams (memory, timeouts, egress cost).
- Part-level retry turns a flaky 5 GB transfer into many small retriable ones.

### Hygiene
- Lifecycle rule: **AbortIncompleteMultipartUpload after 1–7 days** (orphan parts are billed).
- Presigned URLs short-lived and scoped to exact key + content length.
- Per-user quotas and concurrent-upload limits; dedup via content hash per user.

### Numbers
- 100K uploads/day × 500 MB avg = 50 TB/day ingress → S3 handles it; bottleneck is the scanning/transcoding worker fleet, which autoscale on queue depth.`,
      followUps: [
        { q: 'How would you support browser uploads that survive a tab refresh?', a: 'Persist uploadId/part state in IndexedDB or use the tus protocol with a tus server in front of S3.' },
        { q: 'How do you stop someone uploading malware and sharing the link before scan completes?', a: 'Files are not downloadable until READY; the share link resolves through the API which checks status before issuing a signed CDN URL.' },
      ],
      pitfalls: [
        'Streaming multi-GB bodies through API servers.',
        'Trusting client-provided content-type.',
        'Forgetting incomplete multipart cleanup.',
      ],
    },
    {
      id: 'design-classics-iq-07',
      difficulty: 'expert',
      question: 'Deep-dive probe: in your KV store, a node was down for 5 hours and has now rejoined. Walk me through exactly how it catches up, and what can go wrong.',
      context: 'Cassandra-like cluster, RF=3, QUORUM reads/writes, max hint window 3 hours, gc_grace_seconds 10 days.',
      whatInterviewerLooksFor: [
        'Knows hints cover only the first 3 hours',
        'Explains read repair vs anti-entropy repair',
        'Explains Merkle-tree comparison and streaming',
        'Identifies tombstone resurrection and consistency risks',
      ],
      modelAnswer: `### What happened while it was down
- QUORUM (2 of 3) writes still succeeded on the two healthy replicas. Coordinators stored **hints** for the dead node — but only for the first **3 hours** (max hint window). Writes in hours 3–5 have **no hints**.

### Catch-up sequence
1. **Gossip** marks it UP; it begins serving (it does not wait for data catch-up — the dangerous part).
2. **Hinted handoff**: coordinators replay stored hints (throttled) → hours 0–3 recovered.
3. **Read repair**: QUORUM reads that touch it and see an older version write back the newest — only fixes keys that happen to be read.
4. **Anti-entropy repair** (\`nodetool repair\`, ideally automated via Reaper): for each token range, replicas build **Merkle trees**, compare root → children, and stream only differing ranges. This fixes hours 3–5.

### What can go wrong
- **Stale reads meanwhile**: with QUORUM, one of two responders may be the stale node, but the other replica has the value and the coordinator picks the newest timestamp → still correct. With **ONE/LOCAL_ONE** reads, clients can see old data until repair.
- **Tombstone resurrection**: if a delete happened during the outage and the node stays unrepaired past **gc_grace (10 days)**, other replicas purge the tombstone during compaction; the rejoined node's old value then propagates back as live data — "zombie" rows.
- **Repair load**: Merkle comparison is coarse (each leaf covers many partitions), so streaming can move far more than the actual delta; throttle streaming and use incremental/subrange repair.
- **Hint storms**: many coordinators replaying at once can overwhelm the returning node — hints are throttled per node.

### Operational answer
- If downtime > hint window: run a full repair on that node **before** relying on ONE-level reads; if downtime approaches gc_grace, **replace** the node (wipe and bootstrap) instead of rejoining.`,
      followUps: [
        { q: 'Why not just increase the hint window to 24 hours?', a: 'Hints accumulate on coordinators (disk + replay load), and replay of a huge backlog can itself cause an outage; repair is the scalable mechanism, hints are an optimisation.' },
        { q: 'How does a Merkle tree keep the comparison cheap?', a: 'Only hashes are exchanged top-down; matching subtrees are skipped, so network cost is proportional to the number of divergent ranges, not data size.' },
      ],
      pitfalls: [
        'Assuming hinted handoff alone makes the node consistent.',
        'Not knowing about gc_grace and zombie data.',
        'Believing the node refuses traffic until it is caught up.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-classics-boe-1',
      question: 'Size the storage, cache and read fleet for a URL shortener creating 100M links/day with a 10:1 read ratio, retained for 10 years.',
      assumptions: [
        'Row ≈ 100 B payload + ~150 B overhead/index ≈ 250 B stored per replica',
        'Replication factor 3',
        '80/20 access: caching 20% of daily-active links serves ~90% of reads',
        'One redirect pod handles ~5K RPS (mostly cache hits)',
        'Peak = 3× average',
      ],
      steps: [
        { label: 'Write QPS', calc: '100M ÷ 86,400 ≈ 1,160 WPS; peak ×3 ≈ 3.5K WPS' },
        { label: 'Read QPS', calc: '1,160 × 10 ≈ 11.6K RPS; peak ≈ 35K RPS' },
        { label: 'Rows over 10 years', calc: '100M × 365 × 10 = 365B rows' },
        { label: 'Stored bytes', calc: '365B × 250 B ≈ 91 TB per replica × 3 ≈ 274 TB' },
        { label: 'Cache for daily hot set', calc: 'Reads/day ≈ 1B; assume 100M distinct links read/day; 20% = 20M × ~300 B (key+value+overhead) ≈ 6 GB' },
        { label: 'DB read load after cache', calc: '35K peak × 10% miss ≈ 3.5K RPS to DB replicas' },
        { label: 'Redirect pods', calc: '35K ÷ 5K ≈ 7 pods; ×2 for AZ failure headroom ≈ 14 pods' },
      ],
      answer: '~275 TB replicated storage over 10 years, a ~6–10 GB Redis hot cache (one small cluster with replicas), ~3.5K RPS reaching DB replicas at peak, and ~14 redirect pods.',
      insight: 'Storage, not QPS, is the long-term cost driver — so pick a horizontally scalable KV store (or plan sharding from day one) and consider TTL/archival for dead links. The cache is tiny relative to the value it adds, so it is a no-brainer.',
      followUps: [
        {
          "q": "Read ratio turns out to be 100:1 instead of 10:1 because links go viral on social media. What changes in the design?",
          "a": "Peak reads go from ~35K to roughly 1,160 × 100 × 3 ≈ 347K RPS, about 70 redirect pods (140 with AZ headroom) at 5K RPS each. The bigger change is skew: viral links are a handful of keys taking tens of thousands of RPS each, which a single Redis shard can't absorb. Push redirects to the CDN edge with a short TTL (302 with `s-maxage`), and add an in-process L1 cache on redirect pods. Storage doesn't change, because it depends only on writes."
        },
        {
          "q": "Retention changes from 10 years to 'forever'. Which assumption do you attack to keep storage affordable?",
          "a": "At 100M/day, 30 years means about 1.1 trillion rows and ~820 TB replicated, growing without limit. Most links are never clicked after their first weeks, so attack the assumption that all rows need hot storage: tier links with no clicks in 12 months to cheap object storage (Parquet files keyed by code range) and keep a Bloom filter or a small index to route lookups. A miss on hot storage then costs one extra lookup for a rare old link. Also offer expiry on anonymous links, since many are spam."
        }
      ],
    },
    {
      id: 'design-classics-boe-2',
      question: 'How many nodes does a Dynamo-style KV cluster need for 200 TB of logical data, 400K reads/s and 150K writes/s, with N=3 and QUORUM (R=W=2)?',
      assumptions: [
        'Usable disk per node 4 TB (leave ~50% headroom for compaction → 2 TB effective data)',
        'Each node sustains ~15K reads/s and ~20K replica-writes/s on NVMe (LSM)',
        'QUORUM read touches 2 replicas; each write lands on all 3 replicas (W=2 only affects ack latency)',
      ],
      steps: [
        { label: 'Physical data', calc: '200 TB × 3 = 600 TB' },
        { label: 'Nodes for storage', calc: '600 TB ÷ 2 TB effective ≈ 300 nodes' },
        { label: 'Replica reads', calc: '400K × 2 = 800K replica reads/s ÷ 15K ≈ 54 nodes' },
        { label: 'Replica writes', calc: '150K × 3 = 450K replica writes/s ÷ 20K ≈ 23 nodes' },
        { label: 'Binding constraint', calc: 'max(300, 54, 23) = 300 nodes; +10% for failure/rebalance ≈ 330' },
      ],
      answer: 'About 300–330 nodes — storage-bound, not throughput-bound.',
      insight: 'When storage dominates, throughput headroom is huge: you can raise R/W or use denser nodes. Bigger disks per node (e.g. 8–16 TB) cut node count but make repair/bootstrap streaming slower (hours per node) — a classic density vs recovery-time trade-off.',
      followUps: [
        {
          "q": "Ops wants 16 TB disks (8 TB effective) to cut the node count. What does that buy, and what does it cost on failure?",
          "a": "Storage-bound node count drops from 300 to 600 TB ÷ 8 TB = 75 nodes, which still covers the 54 needed for reads but leaves much less headroom. The cost is recovery time: replacing a dead node means streaming its 8 TB, which at about 200 MB/s takes roughly 11 hours versus under 3 hours for 2 TB, and during that window those ranges run at reduced replication. Compaction on bigger nodes also takes longer. A middle option, around 4 TB effective, keeps recovery to about 5–6 hours."
        },
        {
          "q": "Compliance requires RF=5 for this data. Recompute the binding constraint.",
          "a": "Physical data becomes 200 TB × 5 = 1 PB, so storage needs 1,000 TB ÷ 2 TB = 500 nodes. Replica writes go to 150K × 5 = 750K/s, or about 38 nodes' worth, and QUORUM reads with RF=5 touch 3 replicas: 1.2M replica reads/s ÷ 15K = 80 nodes. Storage still dominates by far, at about 550 nodes with headroom. You might also use QUORUM=3 of 5 to survive two replica failures, so the extra cost buys real durability and availability."
        }
      ],
    },
    {
      id: 'design-classics-boe-3',
      question: 'A 50M-user push campaign must finish in 10 minutes. Estimate worker concurrency, Kafka partitions, and the dedup-store size.',
      assumptions: [
        '1.3 devices per user on average',
        'APNs/FCM call latency ~80 ms over HTTP/2; each worker process keeps ~200 in-flight streams',
        'One consumer partition processes ~5K msgs/s',
        'Dedup key ≈ 60 B + Redis overhead ≈ 100 B, TTL 7 days',
      ],
      steps: [
        { label: 'Messages', calc: '50M users × 1.3 ≈ 65M pushes' },
        { label: 'Required rate', calc: '65M ÷ 600 s ≈ 108K pushes/s' },
        { label: 'In-flight needed (Little’s law)', calc: '108K/s × 0.08 s ≈ 8.7K concurrent requests' },
        { label: 'Worker processes', calc: '8.7K ÷ 200 ≈ 44 processes; ×1.5 headroom ≈ 65' },
        { label: 'Kafka partitions', calc: 'User-level messages 50M ÷ 600 ≈ 83K/s ÷ 5K ≈ 17 → use 64 for parallelism headroom' },
        { label: 'Dedup memory', calc: '50M keys × 100 B ≈ 5 GB per campaign; a few concurrent campaigns ≈ 15–20 GB' },
      ],
      answer: '~65 worker processes with ~200 streams each, a 64-partition bulk topic, and ~5 GB of Redis per active campaign for dedup keys.',
      insight: 'Little’s law shows concurrency (in-flight HTTP/2 streams) matters more than pod count. Dedup state is non-trivial at campaign scale — consider a per-campaign Bloom filter or bitmap by user-ID (50M bits ≈ 6 MB) instead of per-user string keys.',
      followUps: [
        {
          "q": "Marketing wants the campaign done in 5 minutes, and APNs latency rises to 300 ms under load. What breaks first?",
          "a": "The rate doubles to 65M ÷ 300 s ≈ 217K pushes/s. With 300 ms latency, Little's law needs 217K × 0.3 ≈ 65K in-flight requests, about 325 processes at 200 streams each, versus 44 originally. Long before that, APNs throttling will start returning 429s, since providers limit per-connection and per-app throughput. So the provider quota breaks first, not your fleet. Push back: a 10-minute target is already fast, and collapse IDs plus send-time preference checks matter more than shaving minutes."
        },
        {
          "q": "You replace per-user Redis dedup keys with a bitmap. How big is it, and what does it require of user IDs?",
          "a": "A bitmap per campaign takes one bit per user ID, so 50M users need about 6.25 MB if IDs are dense integers from 0 to 50M. `SETBIT` returns the old bit, which gives an atomic claim. The catch is that IDs must be dense: with sparse 64-bit IDs or UUIDs you'd need a mapping table, or a Roaring bitmap that compresses sparse ranges. For a 32-bit sparse range a raw bitmap would be ~537 MB, so check the ID distribution first."
        }
      ],
    },
  ],
  test: [
    {
      id: 'design-classics-mcq-01',
      difficulty: 'hard',
      question: 'Your URL shortener sells click analytics to marketers. Product wants to switch redirects from 302 to 301 to cut CDN/origin cost by ~60%. What is the most accurate consequence?',
      options: [
        'Repeat clicks from the same browser will often never reach the CDN or origin, so per-click analytics undercounts',
        'Analytics stays accurate because the CDN still logs every request for a 301',
        'Search engines will stop following the links because 301 is not crawlable',
        'Nothing changes because browsers treat 301 and 302 identically unless Cache-Control is set',
      ],
      correct: [0],
      explanation: 'Browsers cache 301 responses (often indefinitely), so repeat clicks are served locally and never reach your edge — analytics undercounts. The CDN only logs requests that reach it, so it cannot see clicks served from the browser cache. Search engines follow 301s fine (they pass link equity). And browsers treat 301 as cacheable by default even without Cache-Control, so the two codes are not interchangeable.',
      followUps: [
        {
          "q": "Product still wants most of the cost saving and accurate analytics. Is there a middle ground between 301 and 302?",
          "a": "Keep 302 (or 307) but let the CDN cache it at the edge with `Cache-Control: private, max-age=0` for browsers and `s-maxage=300` (or a CDN-specific TTL) for the edge. Browsers then always come back to the edge, so every click is still logged in the CDN access logs, while the origin is hit only once per edge per 5 minutes. Analytics move from origin logs to streamed CDN logs. You keep most of the origin saving, accept edge request costs, and can still change or disable a link within the edge TTL."
        },
        {
          "q": "A link has been served as 301 for a year and now must be taken down for malware. What can you actually do?",
          "a": "Very little for browsers that cached it: a 301 without an expiry may be kept indefinitely, and you cannot send a revocation to a browser cache. You can purge the CDN, so new visitors and cleared caches get the takedown page, and you can report the destination to Safe Browsing lists, which browsers check independently of your redirect. This is the strongest argument for never issuing permanent redirects for user-generated links: always set an explicit `max-age` so you keep the ability to change your mind."
        }
      ],
    },
    {
      id: 'design-classics-mcq-02',
      difficulty: 'expert',
      question: 'You generate 7-char codes by taking the first 42 bits of MD5(url) in base62. At roughly how many stored links does the probability that *some* pair collides reach ~50%?',
      options: [
        'About 1.75 trillion (half the 62^7 space)',
        'About 3.5 billion',
        'About 2 million',
        'About 60 thousand',
      ],
      correct: [2],
      explanation: 'The birthday bound: collisions become likely around sqrt(space). 62^7 ≈ 3.5 × 10^12, sqrt ≈ 1.9 × 10^6, and the 50% point is ~1.18 × sqrt ≈ 2.2M. Half the space is the naive "pigeonhole" intuition and is way off; 3.5B is sqrt of a much larger space. This is why hash-truncation designs must check-and-retry on every insert.',
      followUps: [
        {
          "q": "You move to 8-character codes. Where does the 50% collision point land, and does that let you skip the collision check?",
          "a": "62^8 ≈ 2.2 × 10^14, so the 50% point is about 1.18 × sqrt ≈ 17M links. At 100M links per day you pass it within hours, so you still need a check on every insert. Longer codes only push the problem back a bit, since the birthday bound grows with the square root of the space. If you want no check at all, the code has to come from something unique by construction, such as a counter or range lease passed through a bijective scramble, not from a hash."
        },
        {
          "q": "You keep hashing but now handle collisions. What is the cheapest correct way to detect one at insert time?",
          "a": "Let the database decide: `INSERT ... ON CONFLICT (code) DO NOTHING` and check `rowCount`. If it is 0, read the existing row: if it is the same long URL (and you allow dedup), return the code; otherwise rehash with a salt (e.g. append an attempt counter) and try again, up to a small bound. That is one round trip in the common case. A Bloom filter in front can skip the DB on most fresh codes, but it only says 'maybe present', so the unique constraint must remain the source of truth."
        }
      ],
    },
    {
      id: 'design-classics-mcq-03',
      difficulty: 'expert',
      question: 'Two requests race to create custom alias "sale". What does this code do under concurrency?',
      code: {
        language: 'typescript',
        code: `const r = await db.query('SELECT 1 FROM short_urls WHERE code=$1', [alias]);
if (r.rowCount) throw new Error('TAKEN');
await db.query('INSERT INTO short_urls(code,long_url) VALUES($1,$2)', [alias, url]);
// code is the PRIMARY KEY`,
      },
      options: [
        'Both succeed and the second silently overwrites the first link',
        'Both SELECTs block until the first transaction commits, so it is safe',
        'Postgres serializes the two statements automatically because they touch the same key',
        'One INSERT fails with a unique-violation error that surfaces as a 500 unless handled',
      ],
      correct: [3],
      explanation: 'Both SELECTs can see "no row", then both INSERT; the primary key rejects the second with a unique violation (23505), which bubbles up as a 500 unless caught. There is no overwrite because INSERT does not upsert. Plain SELECTs under READ COMMITTED do not block or take locks on non-existent rows. The fix is INSERT ... ON CONFLICT DO NOTHING and checking rowCount.',
      followUps: [
        {
          "q": "You switch to `INSERT ... ON CONFLICT DO NOTHING`. The table is now sharded across 16 Postgres instances by hash(code). Does the fix still hold?",
          "a": "Yes, as long as the shard is chosen by `code` itself: both racing requests for 'sale' are routed to the same shard, where the primary key on that shard decides. It breaks if you shard by something else, such as owner_id, because the two inserts would land on different shards and both succeed. In that case you need a separate global uniqueness table sharded by code, or a reservation step against it before inserting the owner-side row."
        },
        {
          "q": "The user who loses the race gets ALIAS_TAKEN. How should the API respond, and how do you avoid the loser retrying forever?",
          "a": "Return 409 Conflict with a clear error code and, ideally, a few available suggestions (e.g. 'sale-24', 'sale2026'), checked by a cheap existence lookup. A conflict is a final answer, not a transient error, so the client must not retry automatically: document that 409 is non-retryable, and keep retries only for 5xx and timeouts. If the original request timed out and the client resends, an idempotency key lets you recognise that the same user already owns 'sale' and return 200 instead of 409."
        }
      ],
    },
    {
      id: 'design-classics-mcq-04',
      difficulty: 'expert',
      question: 'In a Dynamo-style store with N=3, W=2, R=2 and sloppy quorum enabled, which scenarios can still return a stale value to a read that starts after a successful write? Select ALL that apply.',
      options: [
        'The write was acked by one preference-list replica plus one hinted (non-preference) node, and the read contacts the two other preference-list replicas',
        'Two concurrent writes with LWW, where the "later" write carries a skewed-back timestamp',
        'All three preference-list replicas are healthy and the write was acked by two of them',
        'A read at consistency ONE that hits the lagging replica',
      ],
      correct: [0, 1, 3],
      explanation: 'With sloppy quorum the hinted node is outside the preference list, so the read set may not intersect the write set. LWW with clock skew can make the actual latest write lose. Reading at ONE drops the overlap guarantee entirely. A write acked by two healthy preference-list replicas is the only case where strict quorum overlap holds: the R=2 read must include at least one of the two replicas that acknowledged the write.',
      followUps: [
        {
          "q": "The application needs read-your-writes for a user's profile but you want to keep sloppy quorum for availability. What do you do?",
          "a": "Make the client sticky to the newest version it has seen. The write returns a version (vector clock or timestamp), the client sends it back on reads, and the coordinator keeps querying replicas until it finds that version or newer, falling back to a read repair if needed. Alternatively, route the user's reads to the same coordinator that took the write, which knows where hints were stored. A third option is to disable sloppy quorum only for that table and accept rejected writes during partitions."
        },
        {
          "q": "How would you measure how often stale reads actually happen in production?",
          "a": "Use probabilistically bounded staleness measurements: a canary writer writes a known key with an increasing counter every second, and readers in each zone read it with the production consistency level and record the lag between the latest written value and the value seen. That gives you a distribution such as '99.9% of reads are fresh within 50 ms'. Also count read-repair events and digest mismatches per table from the coordinator metrics, since every mismatch is a read that would have been stale at R=1."
        }
      ],
    },
    {
      id: 'design-classics-mcq-05',
      difficulty: 'hard',
      question: 'Given these vector clocks for the same key, which statement is correct?',
      code: {
        language: 'text',
        code: `v1 = { A: 2, B: 1 }
v2 = { A: 2, B: 1, C: 1 }
v3 = { A: 3, B: 0 }`,
      },
      options: [
        'v3 is the newest because it has the highest counter for A',
        'v2 descends from v1; v3 is concurrent with both v1 and v2',
        'v1 and v2 are concurrent because v2 contains a node that v1 lacks',
        'v3 descends from v1 because A advanced from 2 to 3',
      ],
      correct: [1],
      explanation: 'v2 ≥ v1 on every node (missing entries count as 0) and is strictly greater on C, so v2 descends from v1. v3 has A=3 > 2 but B=0 < 1, so it is concurrent with v1 and v2 — neither dominates. "Highest counter wins" is the LWW-style misconception; a missing node entry in v1 just means 0, not concurrency.',
      followUps: [
        {
          "q": "A read returns both v2 and v3 as siblings. Your app stores a shopping cart. How do you merge them, and what does the merged write's clock look like?",
          "a": "Merge at the application level: for a cart, take the union of items, and use per-item add/remove markers (an OR-set) so deletions are not resurrected. The client writes the merged value with a clock that is the element-wise max of both siblings, here {A: 3, B: 1, C: 1}, and the coordinator then increments its own entry. Because the new clock dominates both v2 and v3, replicas discard both siblings. This is Dynamo's original cart design, and why deleted items sometimes reappeared."
        },
        {
          "q": "Vector clocks grow with every coordinator that ever wrote the key. How do you bound their size, and what does that cost?",
          "a": "Dynamo truncates: each entry also stores a timestamp, and once the clock passes a threshold (around 10 entries) the oldest entry is dropped. The cost is that two versions which were actually ordered may now look concurrent, causing a spurious sibling the app must merge, which is harmless but annoying. Riak later moved to dotted version vectors keyed by replica (not client or coordinator), which keeps the clock size bounded by N while still detecting true concurrency correctly."
        }
      ],
    },
    {
      id: 'design-classics-mcq-06',
      difficulty: 'expert',
      question: 'A Cassandra node was offline for 12 days (gc_grace_seconds = 10 days). The team restarts it and runs repair afterwards. What is the most serious risk?',
      options: [
        'Hinted handoff will replay 12 days of hints and overload the node',
        'The node will refuse to join because its schema version is too old',
        'Rows deleted during the outage can reappear, because peers already purged the tombstones and the returning node still holds the old live values',
        'Merkle trees cannot be built for data older than gc_grace, so repair silently skips those ranges',
      ],
      correct: [2],
      explanation: 'After gc_grace, compaction on healthy replicas may drop tombstones; the stale node still has the pre-delete value, and repair propagates it back as live data ("zombie" rows). Hints are only kept for the hint window (default 3 h), so there is no 12-day hint flood. Joining is not blocked by schema age, and Merkle trees are built over current data regardless of age. The correct procedure is to replace (re-bootstrap) the node.',
      followUps: [
        {
          "q": "You can't re-bootstrap right now because streaming the data would take 10 hours. Is there a safe way to bring the node back?",
          "a": "Not as-is with its old data. One option is to wipe its data directory and start it with `replace_address` of itself, which streams fresh data from peers but takes those 10 hours. If capacity is tight, leave it down (peers still serve its ranges at reduced replica count), increase streaming throughput limits, and bootstrap during low traffic. The unsafe thing is to start it with stale SSTables and repair, because the zombie data then spreads to healthy replicas and can't be told apart from real data."
        },
        {
          "q": "How would you prevent this class of incident operationally?",
          "a": "Make 'node down longer than gc_grace' impossible to miss: alert when any node has been down more than, say, half of gc_grace, and add an automation guard that refuses to start a node whose last-seen time is older than gc_grace, forcing a replace instead. Run full repairs on every range more often than gc_grace (e.g. weekly with a 10-day grace), with Reaper tracking completion, since the rule only works if repair actually finishes. Some teams also lower gc_grace for tables with no deletes and raise it for delete-heavy ones."
        }
      ],
    },
    {
      id: 'design-classics-mcq-07',
      difficulty: 'medium',
      question: 'Your LSM-based store has read p99 regressing as write volume grows. Metrics show ~40 SSTables consulted per read on a size-tiered table with frequent updates to the same keys. What is the best first change?',
      options: [
        'Switch the table to leveled compaction, accepting higher write amplification to bound SSTables per read',
        'Increase the memtable size so fewer SSTables are flushed',
        'Disable Bloom filters to save memory for the block cache',
        'Switch to time-window compaction since the data is updated frequently',
      ],
      correct: [0],
      explanation: 'Leveled compaction guarantees roughly one SSTable per level per read, fixing read amplification for update-heavy tables at the cost of ~10× write amplification. A bigger memtable helps a little but doesn’t fix fragmentation across tiers. Disabling Bloom filters makes reads far worse. TWCS is for append-only time-series with TTL; updates across windows are its worst case.',
      followUps: [
        {
          "q": "After switching to leveled compaction, disk write throughput triples and compaction falls behind during the day. What now?",
          "a": "Compaction debt shows as a growing L0 count and pending-tasks metric, and once L0 exceeds its limit, writes are throttled. Options: increase compaction throughput and concurrent compactors if disk bandwidth allows; increase the SSTable size so there are fewer, larger compactions; or split the workload, using leveled for the update-heavy table and size-tiered for append-heavy ones. If the hot update pattern is a small key set, a write-back cache that coalesces updates before they reach the store cuts the amplification at the source."
        },
        {
          "q": "How would you confirm the fix worked rather than just watching p99?",
          "a": "Watch the per-read SSTables histogram (`nodetool tablehistograms`): the p99 should drop from about 40 to around the number of levels, roughly 5. Also check the Bloom filter false positive rate, the partition size distribution, and the tombstones scanned per read, because a large partition or many tombstones can keep p99 high even with few SSTables. Compare the write-amplification cost: bytes written by compaction divided by bytes flushed. Rolling out to one node first and comparing its histograms against its neighbours gives you a clean A/B."
        }
      ],
    },
    {
      id: 'design-classics-mcq-08',
      difficulty: 'hard',
      question: 'What happens when this Snowflake generator runs on a VM whose clock is stepped back by 2 seconds by NTP?',
      code: {
        language: 'typescript',
        code: `next(): bigint {
  const ts = BigInt(Date.now());
  if (ts === this.lastTs) this.seq = (this.seq + 1n) & 4095n;
  else this.seq = 0n;
  this.lastTs = ts;
  return ((ts - EPOCH) << 22n) | (this.worker << 12n) | this.seq;
}`,
      },
      options: [
        'It throws because the timestamp is lower than lastTs',
        'IDs stay unique but become non-monotonic only for 1 ms',
        'It is safe because the sequence resets to 0 on every new timestamp',
        'It can emit IDs identical to ones it issued during the previous 2 seconds',
      ],
      correct: [3],
      explanation: 'There is no check for ts < lastTs, so the generator replays the same millisecond values it already used; with the sequence restarting at 0 it reproduces exactly the same (ts, worker, seq) triples — duplicate IDs. It does not throw (no guard exists), and the damage spans the full 2 seconds, not 1 ms. The sequence reset is precisely what causes the duplicates. Also note the missing overflow handling: when seq wraps to 0 within the same ms it duplicates too.',
      followUps: [
        {
          "q": "You add a guard for `ts < lastTs`. Should the generator wait, throw, or keep using lastTs? What does each cost?",
          "a": "Waiting until the clock catches up is safest for small skews (a few ms) but blocks callers for the whole 2 s in this case. Throwing makes the problem visible but turns a clock event into a 2 s outage for writes on that pod. Continuing with lastTs and only incrementing the sequence keeps IDs unique and monotonic, but at 4,096 IDs per ms the sequence overflows quickly, so then you must borrow the next millisecond logically. A common policy: wait if the regression is under 5 ms, otherwise stop issuing, alert and remove the pod from rotation."
        },
        {
          "q": "How do you stop NTP from stepping the clock backwards on ID-generator hosts in the first place?",
          "a": "Configure chrony or ntpd to slew rather than step after boot: chrony's `makestep` should allow steps only in the first few updates at startup, after which corrections are applied by speeding up or slowing the clock gradually (up to about 500 ppm). Use a monotonic source for intervals, and persist the last issued timestamp to disk so a restart with a wrong clock can be detected. Monitoring clock offset per host and alerting above a few ms catches drift before it matters."
        }
      ],
    },
    {
      id: 'design-classics-mcq-09',
      difficulty: 'medium',
      question: 'An orders table uses a UUIDv4 primary key in Postgres. Insert throughput drops and WAL volume balloons as the table grows past RAM. Which change most directly helps while keeping 128-bit coordination-free IDs?',
      options: [
        'Store the UUID as text instead of the uuid type',
        'Switch to UUIDv7 so new keys append near the right edge of the B-tree',
        'Add a hash index on the UUID column',
        'Increase fillfactor to 100 on the primary key index',
      ],
      correct: [1],
      explanation: 'UUIDv7 is time-ordered (48-bit ms prefix), so inserts hit a small set of hot, cached right-most pages instead of random pages — fewer page splits and full-page writes into WAL. Text storage makes keys bigger and slower. A hash index does not replace the primary-key B-tree. Fillfactor 100 makes random-insert page splits even more frequent.',
      followUps: [
        {
          "q": "Security says UUIDv7 leaks when each order was created. Does it, and what would you do about it?",
          "a": "Yes: the first 48 bits are a Unix millisecond timestamp, so anyone who sees an order ID knows its creation time, and by sampling IDs over time they can estimate order volume. If that matters, keep UUIDv7 as the internal primary key for index locality and expose a different public identifier, either a random UUIDv4 stored in a unique column or an encrypted form of the internal ID (e.g. a format-preserving cipher). The cost is one extra index for lookups by public ID."
        },
        {
          "q": "With UUIDv7 all inserts now hit the right-most B-tree page. At 30K inserts/s, could that page become a contention point?",
          "a": "Yes, it's the classic 'right-edge hotspot': every insert needs a latch on the same leaf page, so at very high concurrency you see buffer lock waits. Postgres handles a moderate rate fine because latches are held very briefly, and the random part of UUIDv7 spreads inserts within the same millisecond slightly. If waits appear, options are hash-partitioning the table (e.g. 8 partitions, each with its own right edge), or using a sharded ID with a small shard prefix ahead of the time part, accepting some locality loss."
        }
      ],
    },
    {
      id: 'design-classics-mcq-10',
      difficulty: 'hard',
      question: 'You run Snowflake ID generators as a Kubernetes Deployment that autoscales 20–400 pods. Which worker-ID strategies are safe? Select ALL that apply.',
      options: [
        'Lease a worker ID from etcd with a TTL, renew it, and stop issuing IDs if renewal fails',
        'Derive worker ID from the last 10 bits of the pod IP address',
        'Use a StatefulSet ordinal (pod-0..pod-N) as the worker ID with no two pods sharing an ordinal',
        'Pick a random 10-bit worker ID at startup and rely on low collision probability',
      ],
      correct: [0, 2],
      explanation: 'An etcd lease with fencing guarantees exclusive ownership, and StatefulSet ordinals are unique by construction (as long as you stay under 1,024 replicas). IP low bits can collide across subnets/nodes and IPs get reused. Random 10-bit IDs with ~100 pods have a >99% chance of at least one collision (birthday bound on 1,024 values).',
      followUps: [
        {
          "q": "You use etcd leases. A pod pauses for 40 s in a long GC, its lease expires, another pod takes the same worker ID, then the first pod resumes. What prevents duplicates?",
          "a": "The generator must check its lease before issuing, not only at renewal. Track the lease's local expiry with a monotonic clock and stop issuing as soon as `now > expiry − safetyMargin`, even without hearing from etcd. After a pause, the first check sees the lease is past expiry and refuses until it gets a fresh lease (likely a new worker ID). Make the TTL comfortably longer than the renewal interval (e.g. TTL 30 s, renew every 5 s), so normal hiccups don't trigger reassignment."
        },
        {
          "q": "The service grows past 1,024 concurrent generators. What are your options within 64 bits?",
          "a": "Re-split the bits: Snowflake uses 41 bits of time, 10 of worker and 12 of sequence. Moving to 12 worker bits and 10 sequence bits gives 4,096 workers at 1,024 IDs per ms each, which is still about 1M/s per worker. Alternatively, stop making every pod a generator: run a smaller dedicated ID service or hand out ID blocks to pods. Changing the bit layout is safe only if consumers treat IDs as opaque; if anything decodes worker or time fields, version the format first."
        }
      ],
    },
    {
      id: 'design-classics-mcq-11',
      difficulty: 'expert',
      question: 'During a 30M-user campaign, OTP SMS latency went from 3 s to 20 minutes. Both share an "sms" Kafka topic with 24 partitions and one consumer group. Which change fixes the root cause rather than the symptom?',
      options: [
        'Split into separate transactional and bulk topics with independent consumer groups and reserved provider capacity',
        'Add more partitions and consumers to the "sms" topic',
        'Give OTPs a Kafka header "priority=high" and let consumers skip ahead',
        'Lower the campaign batch size so messages interleave with OTPs',
      ],
      correct: [0],
      explanation: 'The root cause is head-of-line blocking: OTPs queue behind millions of campaign messages in the same partitions, and they compete for the same provider quota. Separate lanes with reserved capacity isolate them. More partitions only helps if the provider can absorb it — the quota is still shared. Kafka consumers cannot "skip ahead" within a partition without breaking offset semantics. Smaller batches still share the same queue.',
      followUps: [
        {
          "q": "After splitting topics, both lanes still share one SMS provider account with a 1,000 msg/s limit. How do you guarantee OTPs get through during a campaign?",
          "a": "Reserve capacity explicitly: put a shared rate limiter in front of the provider, with a hierarchical bucket where the transactional lane is guaranteed, say, 300 msg/s and can borrow the whole 1,000, while the bulk lane gets only what is left. Bulk consumers then slow down instead of OTPs waiting. Even better, use a separate provider account or a second provider for transactional traffic, so a campaign can never exhaust the OTP quota and a provider outage can fail over independently."
        },
        {
          "q": "How would you have caught the 20-minute OTP delay within a minute, instead of from customer complaints?",
          "a": "Measure end-to-end age, not queue depth: stamp each OTP with its creation time and emit 'enqueue to provider-accepted' latency per lane, and alert when p95 OTP age exceeds 10 s. Consumer lag in messages is misleading, since a lag of 1M is fine for bulk but a lag of 1,000 OTPs is an outage. Also run a synthetic OTP every 30 s to a test number via each provider and track delivery receipts, which catches provider-side delays that your own metrics cannot see."
        }
      ],
    },
    {
      id: 'design-classics-mcq-12',
      difficulty: 'expert',
      question: 'A push worker calls the provider, the provider times out after 5 s, and the worker cannot tell whether the message was delivered. For which notification types is automatically resending the right default? Select ALL that apply.',
      options: [
        'A "your order has shipped" push that the device collapses by collapse-id/tag',
        'A one-time password SMS where each resend is billed and the user can tap "resend"',
        'A marketing email where the provider supports an idempotency/message-dedup key',
        'A payment-due SMS reminder with no provider-side dedup',
      ],
      correct: [0, 2],
      explanation: 'Resending is safe when duplicates are harmless or deduplicated downstream: APNs/FCM collapse identifiers make the device show one notification, and a provider-side idempotency key dedups the email. For OTP SMS, duplicates cost money and confuse users; the user-driven resend is the better recovery. A reminder SMS without dedup risks double-sending; prefer checking status via the provider’s API/webhook first.',
      followUps: [
        {
          "q": "For the payment-due SMS, you decide not to resend blindly. What exactly does the worker do after the 5 s timeout?",
          "a": "Record the attempt as UNKNOWN with the provider message id if one was returned, or with your own client reference otherwise. Then reconcile: wait for the provider's delivery webhook, or query the status API after a short delay. If the provider shows it as accepted, mark it SENT; if it has no record of your reference, resend. Pass your own reference (most SMS APIs accept a client reference) so the status query is possible. Messages stuck in UNKNOWN past a deadline go to a dashboard, not an automatic retry."
        },
        {
          "q": "The OTP's resend button gets tapped 5 times in 10 seconds by an impatient user. What do you change?",
          "a": "Rate-limit resends per phone number (e.g. one per 30 s, at most 5 per hour) and show a countdown in the UI. Reuse the same code for resends within its validity window instead of generating a new one, so whichever SMS arrives first works and earlier codes aren't invalidated. Rate limiting also protects against SMS pumping fraud, where attackers trigger OTPs to premium numbers and you pay per message, so add per-IP and per-country limits and an alert on spikes."
        }
      ],
    },
    {
      id: 'design-classics-mcq-13',
      difficulty: 'expert',
      question: 'Pastebin creates the metadata row first and then uploads the blob to S3. Occasionally users open a fresh link and get a 500. What is the best fix?',
      options: [
        'Retry the S3 GET three times on the read path',
        'Use S3 strong read-after-write consistency, which removes the problem entirely',
        'Create the row in a PENDING state and flip it to READY only after the S3 ObjectCreated event (or a verified HEAD), filtering PENDING rows on read',
        'Put the metadata in the same S3 object as user metadata headers',
      ],
      correct: [2],
      explanation: 'The race is the reader arriving between the row insert and the blob upload (or the upload failing). A PENDING→READY state machine means readers never see a row without a blob. S3 has been strongly consistent since Dec 2020, but that doesn’t help when the object literally hasn’t been written yet. Read-path retries only mask the race and fail permanently when uploads fail. S3 metadata headers don’t support listing, TTL queries or ownership lookups.',
      followUps: [
        {
          "q": "With PENDING→READY, the upload sometimes never completes and PENDING rows pile up. How do you clean them up safely?",
          "a": "Give each PENDING row an upload deadline (e.g. presigned URL expiry plus a margin, say 1 hour). A sweeper job finds PENDING rows past their deadline, issues a HEAD on the object, and either flips the row to READY if the object did land (a lost event) or deletes the row and any partial object. Configure an S3 lifecycle rule to abort incomplete multipart uploads after a day, since those parts cost storage but are invisible in normal listings."
        },
        {
          "q": "You rely on the S3 ObjectCreated event to flip READY. What happens if that event is delayed or lost, and how do you cover it?",
          "a": "S3 event notifications are at-least-once and usually arrive within seconds, but they can be delayed and, rarely, missed. A paste would then stay PENDING and look broken to its author. Cover it two ways: have the client call a `complete` endpoint after upload that does a HEAD and flips the row, so the event is just a backup; and have the sweeper verify old PENDING rows. Make the flip idempotent (`UPDATE ... SET state='READY' WHERE id=$1 AND state='PENDING'`) so duplicate events are harmless."
        }
      ],
    },
    {
      id: 'design-classics-mcq-14',
      difficulty: 'medium',
      question: 'Consistent hashing with 1 token per node: a node with 10% of the ring dies. Where does its load go, and why do vnodes change that?',
      options: [
        'Evenly to all remaining nodes in both cases; vnodes only reduce memory',
        'To the node with the least load, chosen by the coordinator; vnodes make that choice faster',
        'It is rehashed with hash(key) % (N-1); vnodes avoid the rehash',
        'Entirely to its clockwise successor; with vnodes, its many small ranges are spread across many successors',
      ],
      correct: [3],
      explanation: 'With one token per node, the dead node’s whole range falls to the next node clockwise, which can double that neighbour’s load. With vnodes, the dead node owned many small ranges scattered around the ring, each taken by a different successor, spreading the load. Consistent hashing never uses modulo rehashing, and placement is not load-aware at request time.',
      followUps: [
        {
          "q": "You use 256 vnodes per node. A new node bootstraps. Where does its data stream from, and what is the downside of many vnodes here?",
          "a": "It takes 256 small ranges scattered around the ring, so it streams a little from almost every existing node in parallel, which is fast and spreads the load. The downside is availability math: with many vnodes and RF=3, nearly every pair or triple of nodes shares some range, so losing any two nodes at once makes some data unavailable at QUORUM. Repairs also have many more ranges to handle. That is why Cassandra 4 lowered the default to 16 vnodes with a token allocation algorithm that keeps balance good."
        },
        {
          "q": "One customer's keys are hot and all land in the successor's range after the failure. How would you notice and respond?",
          "a": "Look at per-node request rate and p99, and per-partition metrics (top partitions by reads/writes, which Cassandra exposes via `nodetool toppartitions`). A single node at 2× its peers' load, coinciding with the failure, is the signal. Short term, replace the dead node quickly so its range moves back, and add a read cache for the hot partitions. Long term, add more vnodes (or replicas) so one failure spreads, and split the hot customer's keys with a bucket suffix so they span several ranges."
        }
      ],
    },
    {
      id: 'design-classics-mcq-15',
      difficulty: 'hard',
      question: 'This Redis-based per-user rate check for "max 3 marketing pushes per day" is used by 50 worker pods. What is wrong?',
      code: {
        language: 'typescript',
        code: `const key = 'cap:' + userId + ':' + today;
const count = Number(await redis.get(key) ?? 0);
if (count >= 3) return skip();
await redis.incr(key);
await redis.expire(key, 86_400);
await send();`,
      },
      options: [
        'Nothing — Redis is single-threaded so each command is atomic',
        'GET and INCR are separate round trips, so concurrent workers can all read 2 and send, exceeding the cap',
        'EXPIRE resets the TTL on every call, so the key never expires',
        'INCR on a missing key throws, so the first push always fails',
      ],
      correct: [1],
      explanation: 'Each command is atomic, but the check-then-increment sequence is not — several workers can read count=2 simultaneously and all send. Use INCR first and compare the returned value (or a Lua script doing INCR + EXPIRE NX atomically). EXPIRE resetting the TTL is a minor smell (the key still expires ~24 h after the last push, so it drifts rather than never expiring). INCR on a missing key initialises it to 1; it does not throw.',
      followUps: [
        {
          "q": "You switch to INCR-first plus a Lua EXPIRE NX. A push send fails after the INCR. Does the user now lose one of their 3 daily slots?",
          "a": "Yes: the counter counts attempts, not deliveries, so a failed send still uses a slot. Two fixes: DECR on a definite failure (e.g. invalid token or a 4xx before sending), accepting that ambiguous timeouts keep the slot; or reserve-then-confirm, where a reservation counts temporarily and expires if not confirmed. For a marketing cap, under-sending is the safer side, so most teams accept losing a slot on failures and only refund on clear pre-send errors."
        },
        {
          "q": "The cap must apply per user's local day, not UTC, and users span 40 time zones. What changes?",
          "a": "Compute `today` from the user's time zone (stored on the profile), so the key becomes `cap:{userId}:{localDate}`, and set the expiry to the end of that local day plus a margin, rather than 86,400 s from the first push. A user who changes time zones mid-day might get a new key early, which is acceptable for a soft cap. Campaign scheduling also needs it: sending at '10 am local' means batches per time zone, which conveniently spreads the 50M sends across 24+ hours."
        }
      ],
    },
  ],
};

export default topic;
