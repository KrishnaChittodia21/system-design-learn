import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-apps',
  phase: 'designs',
  order: 12,
  title: 'Instagram & Food Delivery (Swiggy / Zomato / DoorDash)',
  subtitle:
    'Two of the most-asked product designs, taken past the generic building blocks: Instagram\'s media pipeline, ranked feed, Stories, Explore and celebrity-scale engagement; and a three-sided food-delivery marketplace with serviceability, an idempotent order state machine, dispatch with batching, ETA promises, delivery fees and peak-hour failure handling.',
  estimatedMinutes: 170,
  sources: [
    'PracHub — ranking of the 30 most-asked system design questions across 12 public banks (June 2026): Instagram #12, Food delivery (DoorDash) #22',
    'Hello Interview — Design Instagram problem breakdown (500M DAU, 100M posts/day, photos ≤ 8 MB, videos ≤ 4 GB; scaling reads, large blobs, long-running tasks)',
    'Meta Engineering — Scaling the Instagram Explore recommendations system (Aug 2023): retrieval → first-stage → second-stage → final reranking, Two Towers, MTML',
    'Instagram Engineering — Sharding & IDs at Instagram (64-bit IDs: 41-bit time, 13-bit logical shard, 10-bit sequence)',
    'Meta / Mark Zuckerberg — Instagram reaches 3 billion monthly active users (Sept 2025)',
    'DesignGurus — How to design Instagram; What to expect in the Swiggy system design interview (candidate-reported questions: order lifecycle, partner assignment, tracking, catalog)',
    'AlgoMaster — Design Instagram (system design interview)',
    'DoorDash Engineering — Using ML and Optimization to Solve DoorDash\'s Dispatch Problem (DeepRed, Aug 2021)',
    'Swiggy Bytes — The Swiggy Delivery Challenge (delivery time = assignment delay, first mile, prep time, last mile; the "Goldilocks" ETA); Just-in-Time assignment, Next Order Assignment and batching',
    'Akka customer story — Swiggy data-science platform (city-wide order–partner scoring within a minute; P99 144 ms → 71 ms)',
    'Zomato / Eternal FY25 annual report via MediaNama (Jul 2025): 853M food-delivery orders, AOV ₹453, 20.6M avg monthly transacting customers, 4.73 lakh delivery partners',
    'Swiggy — How India Swiggy\'d 2025 (dinner orders ~32% higher than lunch)',
    'Business Today / Inc42 (2025–2026) — Zomato & Swiggy rain surge fee for subscribers, long-distance fee beyond 4 km, platform-fee changes',
    'ZenML LLMOps/MLOps database — Zomato ML runtime platform (Flink/Spark features, Redis + DynamoDB feature store, food-prep-time model)',
    'PracHub — DoorDash system design question reports (2025–2026): refund workflow as a DAG with timeout refunds, Dasher payment reliability, restaurant search',
    'Alex Xu — System Design Interview Vol 1, Ch 11 (News Feed) and Vol 2, Ch 1 (Proximity Service)',
  ],
  tags: [
    'instagram',
    'media-pipeline',
    'presigned-upload',
    'feed-ranking',
    'cursor-pagination',
    'stories',
    'explore',
    'hashtag-search',
    'notifications',
    'food-delivery',
    'serviceability',
    'order-state-machine',
    'dispatch',
    'order-batching',
    'eta',
    'surge-pricing',
    'refunds',
  ],
  cheatSheet: [
    'Instagram scale to quote: Meta reported 3B MAU (Sept 2025); a common interview framing is 500M DAU and 100M posts/day ≈ 1.2K posts/s avg, ~3.5K/s peak, while feed reads run ~46K QPS avg. It is read-heavy by ~40×, so spend the design budget on the read path and the CDN.',
    'Upload: client asks for a presigned URL (multipart for video), uploads straight to object storage, then calls /complete. A worker verifies the object, fixes orientation, strips EXIF (GPS), builds renditions (e.g. 1080/640/320/150 px WebP/AVIF), runs moderation and perceptual-hash dedup, and only then flips the post to PUBLISHED and emits PostPublished.',
    'IDs: 64-bit, time-sortable, minted in the shard (41 bits ms since a custom epoch ≈ 69.7 years, 13 bits logical shard = 8,192 shards, 10 bits sequence = 1,024 IDs/ms/shard). The shard is recoverable from the ID, so no lookup table is needed.',
    'Feed beyond fan-out: candidates (followees + suggested) → light ranker → heavy multi-task ranker (P(like), P(comment), P(dwell), P(hide)) → rules (diversity, seen filter, ads every N slots with spacing). Paginate over a per-session ranked snapshot with an opaque cursor, never OFFSET.',
    'Stories: a per-author active-story ZSET scored by expiresAt + a per-viewer "last seen story per author" map gives tray order (unseen first, then affinity). Viewer lists are write-heavy and short-lived: partition by story_id, dedupe per viewer, fixed absolute expiry (EXPIREAT / TTL from creation), never a sliding TTL.',
    'Explore (Meta 2023): retrieval (Two Towers + ANN, up to ~1,500 candidates) → first-stage ranker → second-stage MTML on ~100 → final rerank for integrity and diversity. Embeddings are cached; heavy features run only on the shortlist.',
    'Food-delivery scale (Zomato FY25): 853M orders ≈ 2.34M/day, AOV ₹453, 4.73 lakh delivery partners. Even at a dinner peak that is only ~100–200 orders/s; the heavy paths are discovery reads (~25K QPS) and partner location pings (~50K/s), not order writes.',
    'Serviceability = restaurant open AND address inside its (dynamic) delivery polygon AND predicted prep load acceptable AND enough partners nearby (stress score). Shrink radius, add rain/long-distance fees and widen ETAs before you let orders queue with no partner.',
    'Order state machine: PAYMENT_PENDING → PLACED → ACCEPTED → PREPARING → READY → PICKED_UP → DELIVERED, with CANCELLED/REFUNDED branches. Every transition is a conditional UPDATE (WHERE status = expected AND version = v) + outbox row in one transaction; consumers dedupe by event ID; restaurant non-acceptance is a durable timer → IVR call → auto-cancel + refund.',
    'Dispatch: assign just in time (partner arrives ≈ food ready), solve in batches per city zone every ~10–60 s over a pruned candidate graph (k nearest partners), allow stacking only within a max added delay, then offer → accept with a fenced offer ID → timeout and re-offer. ETA = max(assignment delay + first mile, prep time) + last mile, shown as a quantile, not a mean.',
  ],
  sections: [
    {
      heading: 'Instagram (1/7): requirements, scale estimation & architecture',
      body: `**Intuition:** Instagram is a *photo factory feeding a newspaper*. The factory (upload pipeline) turns one phone photo into many web-ready copies; the newspaper (feed) decides, for 500M people every few minutes, which of those photos to put on the front page. The design-social topic already covers generic fan-out; here we spend time on what is **specific** to Instagram.

**Functional scope (agree on this in the first 5 minutes):**
- Post photos/videos with a caption; follow users; home feed of followees (ranked) plus suggested posts.
- Stories (24 h), Explore and hashtag search, likes/comments, notifications.
- Out of scope unless asked: DMs (see design-social chat), Reels transcoding (see YouTube), Live.

**Non-functional:** feed p99 < 500 ms; upload acknowledged fast with processing allowed to take seconds; high availability over strong consistency for feeds and counts (eventual is fine), **but** a user must see their own post at once (read-your-writes); media durability 11 nines (object storage); privacy (private accounts, blocks, EXIF GPS stripped).

**Estimation (common interview framing; Meta reported 3B MAU in Sept 2025):**

| Quantity | Calculation | Result |
|---|---|---|
| Post writes | 100M ÷ 86,400 | ≈ 1.2K/s avg, ~3.5K/s peak |
| Feed reads | 500M DAU × 8 fetches ÷ 86,400 | ≈ 46K QPS avg, ~140K peak |
| Media written/day | 90M photos × 2.5 MB + 10M videos × 60 MB | ≈ 225 TB + 600 TB ≈ 0.8 PB/day |
| Image egress | 500M × 100 images × 150 KB | 7.5 PB/day ≈ 0.7 Tbps avg |

Two conclusions drive the design: **egress dominates cost** (so the CDN, rendition sizes and modern codecs matter more than DB choice), and **reads outnumber writes ~40×** (so precompute feeds, cache aggressively, and keep processing off the request path).

**Interview line:** *"Writes are small and bursty, reads are huge and latency-sensitive, and the bytes live in object storage behind a CDN. I'll design the media pipeline, the data model and the feed read path, then go deep on whichever you prefer: Stories, Explore or celebrity scale."*`,
      diagram: `  Mobile app
    |  1 POST /uploads (get presigned URL)   5 GET /feed, /stories
    v                                          |
 +--------------+   presigned PUT/multipart    |      +-----------+
 | API gateway  |-----------------------+      +----->|  CDN      |<-- images
 +--+---+---+---+                       v             +-----+-----+    video
    |   |   |                 +-------------------+         | miss
    |   |   +--> Upload svc ->| Object store (raw)|---------+ v
    |   |        (sign URLs)  +---------+---------+   +-------------+
    |   |                               | ObjectCreated| renditions |
    |   |                               v              | bucket     |
    |   |              +---------------------------+   +------^------+
    |   |              | Media workers (queue)     |----------+
    |   |              | verify, rotate, strip EXIF|
    |   |              | resize, moderate, dedup   |
    |   |              +-------------+-------------+
    |   |                            | PostPublished (Kafka)
    |   +--> Post svc (sharded PG) <-+--> fan-out / feed svc --> Redis
    |                                 \\-> search indexer, notifs
    +--> Graph svc (follows), Story svc, Engagement svc (counters)`,
      keyPoints: [
        'Read-heavy (~40×) and egress-dominated: CDN, renditions and codecs are first-class design topics.',
        'Read-your-writes for your own post; eventual consistency everywhere else.',
        'Name the deep-dive menu early: media pipeline, feed specifics, Stories, Explore, celebrity scale.',
      ],
      source: 'Hello Interview — Design Instagram; Meta (Sept 2025) 3B MAU announcement',
    },
    {
      heading: 'Instagram (2/7): the upload & media-processing pipeline',
      body: `**Intuition:** never let a 4 GB video flow through your API servers. Hand the client a time-limited "key" to the storage bucket, let it upload directly, and treat processing as a **background job with a state**.

**Flow:**
1. \`POST /uploads {type, size, sha256?}\` → Upload service validates quota and size limits (photos ≤ 8 MB, videos ≤ 4 GB in the common interview framing), creates \`media(id, owner, status='UPLOADING')\`, returns a presigned PUT (photo) or a multipart upload ID + part URLs (video). Mechanics of presigning and multipart are in the object-storage topic.
2. Client uploads; on success calls \`POST /posts {mediaIds, caption}\` → post row with \`status='PROCESSING'\`. The **author** sees it immediately (from the local file + own-posts cache).
3. \`ObjectCreated\` event (or the /posts call) enqueues a job keyed by \`mediaId\` (idempotent).
4. **Worker steps:** HEAD/inspect the object (real MIME by magic bytes, not the client header; size; dimensions) → apply EXIF orientation, then **strip metadata** (GPS location is a privacy leak) → resize into renditions (e.g. 1080, 640, 320, 150 px) in WebP/AVIF with JPEG fallback → compute a **perceptual hash** (pHash/PDQ) for near-duplicate and known-abuse matching (a SHA-256 only catches byte-identical copies) → moderation classifier (nudity/violence) → store renditions under content-addressed keys.
5. Mark \`media.status='READY'\`; when every media item of the post is ready, set \`post.status='PUBLISHED'\` and emit \`PostPublished\` (outbox) → fan-out, search indexing, notifications.

**Failure handling:** jobs are retried with back-off and a DLQ; a sweeper finds posts stuck in PROCESSING > 10 min; abandoned multipart uploads are aborted by a bucket lifecycle rule; moderation "uncertain" goes to a human queue while the post stays visible only to the author.

**Serving:** clients request \`/m/{mediaId}/{w}.webp\`; the CDN caches by immutable key (cache forever, since a new edit means a new key). Picking the rendition by device width and network quality is the cheapest egress win available: a 320 px thumbnail is ~10× smaller than the 1080 px image.`,
      code: [
        {
          language: 'typescript',
          title: 'Media worker: idempotent, orientation-safe, metadata-stripping rendition builder (sharp + S3)',
          code: `import sharp from 'sharp';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const WIDTHS = [1080, 640, 320, 150] as const;

export async function processPhoto(job: { mediaId: string; rawKey: string }, db: Db) {
  // idempotency: a redelivered job for a READY media item is a no-op
  const media = await db.media.findForUpdate(job.mediaId);
  if (!media || media.status === 'READY' || media.status === 'REJECTED') return;

  const obj = await s3.send(new GetObjectCommand({ Bucket: 'ig-raw', Key: job.rawKey }));
  const input = Buffer.from(await obj.Body!.transformToByteArray());

  const meta = await sharp(input).metadata();            // trusts bytes, not client MIME
  if (!meta.format || !['jpeg', 'png', 'heif', 'webp'].includes(meta.format)) {
    return db.media.markRejected(job.mediaId, 'unsupported_format');
  }

  // rotate() bakes EXIF orientation into pixels; sharp drops EXIF/GPS on output
  // unless withMetadata() is called, so the order rotate -> resize -> encode is safe
  const base = sharp(input).rotate();
  const keys: Record<number, string> = {};
  for (const w of WIDTHS) {
    const out = await base.clone()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const key = \`r/\${job.mediaId}/\${w}.webp\`;             // immutable, CDN-cacheable key
    await s3.send(new PutObjectCommand({
      Bucket: 'ig-renditions', Key: key, Body: out,
      ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable',
    }));
    keys[w] = key;
  }

  const phash = await perceptualHash(input);              // near-dup + known-abuse lookup
  const verdict = await moderation.classify(keys[640]);   // uses a small rendition
  await db.media.markReady(job.mediaId, { keys, phash, verdict }); // also publishes post if all media READY
}`,
        },
      ],
      keyPoints: [
        'Bytes go client → bucket directly; the API only signs and records state.',
        'Rotate before stripping EXIF, decide MIME from magic bytes, and use immutable rendition keys.',
        'Publish (fan-out) only after every media item of the post is READY; the author sees it earlier.',
      ],
      source: 'Hello Interview — Design Instagram (large blobs, long-running tasks); AWS S3 presigned/multipart docs',
    },
    {
      heading: 'Instagram (3/7): data model, IDs & the follow graph',
      body: `**Intuition:** almost every query is "things owned by one user" or "things about one post", so **shard by user** and make the post ID itself tell you where it lives.

**IDs (Instagram's published scheme):** 64 bits = **41 bits** milliseconds since a custom epoch (≈ 69.7 years of range) + **13 bits** logical shard ID (8,192 logical shards) + **10 bits** per-shard sequence (1,024 IDs per ms per shard). Generated inside PostgreSQL by a PL/pgSQL function per logical shard, so no central ID service; IDs are time-sortable (newest-first queries need no extra index), and \`(id >> 10) & 8191\` recovers the shard. Logical shards are schemas mapped onto far fewer physical hosts, so rebalancing moves schemas rather than re-hashing rows.

**Tables (per logical shard, co-located by owner):**
- \`users(id, username UNIQUE, is_private, ...)\` with a global username → id lookup table.
- \`posts(id, owner_id, caption, status, media_ids[], created_at)\` → sharded by \`owner_id\`, so "profile grid" is one shard and one index range.
- \`media(id, post_id, kind, rendition_keys jsonb, phash, status)\`.
- **Follows need both directions:** \`following(follower_id, followee_id)\` sharded by follower (who do I follow? for feed pull), and \`followers(followee_id, follower_id)\` sharded by followee (who follows me? for fan-out and notifications). Write both through an outbox so they converge; a celebrity's follower list is paginated by \`follower_id\` cursor for fan-out workers.
- Counts (followers, likes) are **not** \`COUNT(*)\`: keep counter rows/sharded counters (see design-more Distributed Counters).

**Store choices:** sharded Postgres for users/posts/graph (Instagram's historical choice) or a wide-column store for very high write rates (likes, story views, activity); Redis for timelines, story trays and hot counts; object storage + CDN for media; Elasticsearch-style index for users/hashtags/places.`,
      code: [
        {
          language: 'sql',
          title: 'Per-shard ID generator and the core tables (PostgreSQL)',
          code: `-- one schema per logical shard, e.g. insta_5 for shard 5
CREATE SEQUENCE insta_5.table_id_seq;

CREATE OR REPLACE FUNCTION insta_5.next_id(OUT result bigint) AS $$
DECLARE
  our_epoch  bigint := 1314220021721;  -- custom epoch (ms)
  seq_id     bigint;
  now_ms     bigint;
  shard_id   int := 5;
BEGIN
  SELECT nextval('insta_5.table_id_seq') % 1024 INTO seq_id;
  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000);
  result := (now_ms - our_epoch) << 23;  -- 41 bits of time
  result := result | (shard_id << 10);   -- 13 bits of logical shard
  result := result | seq_id;             -- 10 bits of sequence
END;
$$ LANGUAGE plpgsql;

CREATE TABLE insta_5.posts (
  id         bigint PRIMARY KEY DEFAULT insta_5.next_id(),
  owner_id   bigint NOT NULL,
  caption    text,
  status     text NOT NULL DEFAULT 'PROCESSING',   -- PROCESSING | PUBLISHED | REMOVED
  created_at timestamptz NOT NULL DEFAULT now()
);
-- profile grid: newest first, published only; id order == time order
CREATE INDEX ON insta_5.posts (owner_id, id DESC) WHERE status = 'PUBLISHED';

CREATE TABLE insta_5.followers (           -- sharded by followee
  followee_id bigint, follower_id bigint, created_at timestamptz DEFAULT now(),
  PRIMARY KEY (followee_id, follower_id)
);`,
        },
      ],
      keyPoints: [
        '41/13/10-bit IDs: time-sortable, shard-embedded, minted without a central service.',
        'Shard posts by owner; store the follow edge twice (by follower and by followee).',
        'Logical shards (thousands) on few physical hosts make rebalancing a schema move.',
      ],
      source: 'Instagram Engineering — Sharding & IDs at Instagram',
    },
    {
      heading: 'Instagram (4/7): home feed specifics — ranking, cursors, seen-state & ads',
      body: `**Intuition:** fan-out (push, pull, hybrid for celebrities) only decides *which candidate IDs are cheap to fetch*; this is covered in design-social News Feed. What makes Instagram's feed hard is **what happens after the candidate list**: ranking, stable pagination while the ranking changes, not repeating what you have seen, and slotting ads in.

**Pipeline per feed session:**
1. **Candidates (~500–1,500):** precomputed timeline IDs (fan-out on write) ∪ recent posts of followed celebrities (pull) ∪ "suggested posts" from the recommendation retrieval stage, once followee content runs out.
2. **Filter:** blocked/muted authors, removed posts, already-**seen** posts (seen-state store: per-user set of recent impressions, e.g. a Bloom filter or a capped ZSET in Redis; clients batch impression events every few seconds).
3. **Rank:** a cheap first-stage model trims to ~100–200, then a multi-task model predicts P(like), P(comment), P(share), P(dwell > n s), P(hide); a weighted sum (weights are a product decision) gives the score. Features: author affinity, post age, media type, the viewer's recent behaviour.
4. **Rules:** diversity (≤ 2 consecutive posts from one author, mix of media types), freshness boost, "you're all caught up" marker after the last unseen followee post.
5. **Ads:** organic ranking is done first; a blender then fills ad slots (e.g. one every 4–6 positions, never adjacent, fewer for new users) using a separate ad auction per slot (bid × predicted engagement, budget pacing).

**Pagination:** the ranked list for this session is **snapshotted** (say 300 IDs in Redis under \`feedsess:{user}:{sessionId}\`, TTL 30 min). The cursor encodes \`{sessionId, offsetInSnapshot}\`, signed so clients cannot tamper. Pull-to-refresh creates a *new* session, re-ranks, and filters out what was already seen, so items neither repeat nor vanish mid-scroll. Without a snapshot, a re-rank between page 1 and page 2 duplicates and skips posts (the OFFSET problem in disguise).

**Read-your-writes:** the author's own last posts are merged at the top of their own feed for a few minutes, independent of fan-out lag.`,
      code: [
        {
          language: 'typescript',
          title: 'Feed page from a per-session ranked snapshot, with seen filtering and ad slotting',
          code: `type Cursor = { s: string; o: number };          // sessionId, offset into snapshot
const PAGE = 12, AD_EVERY = 5, SNAP_TTL = 1800;

export async function getFeedPage(userId: string, rawCursor?: string): Promise<FeedPage> {
  let cur: Cursor;
  if (rawCursor) cur = verifyCursor(rawCursor);      // HMAC-signed, rejects tampering
  else {
    // new session: build candidates, rank once, freeze the order
    const ranked = await rankCandidates(userId);     // ~300 post IDs, best first
    cur = { s: crypto.randomUUID(), o: 0 };
    await redis.multi()
      .rpush(\`feedsess:\${userId}:\${cur.s}\`, ...ranked)
      .expire(\`feedsess:\${userId}:\${cur.s}\`, SNAP_TTL)
      .exec();
  }

  // read a little extra because some items will be filtered out
  const ids = await redis.lrange(\`feedsess:\${userId}:\${cur.s}\`, cur.o, cur.o + PAGE * 2 - 1);
  const seen = await seenStore.mightContain(userId, ids);   // impressions from other devices
  const fresh: string[] = [];
  let consumed = 0;
  for (const id of ids) {
    consumed++;
    if (!seen.has(id)) fresh.push(id);
    if (fresh.length === PAGE) break;
  }

  const posts = await hydrate(fresh, userId);       // batched: posts, authors, counts, liked?
  const items: FeedItem[] = [];
  posts.forEach((p, i) => {
    items.push({ kind: 'post', post: p });
    // ad slot after every AD_EVERY organic items; the ad server enforces spacing and pacing
    if ((cur.o + i + 1) % AD_EVERY === 0) items.push({ kind: 'ad_slot', slot: cur.o + i + 1 });
  });

  const next = consumed < ids.length || ids.length === PAGE * 2
    ? signCursor({ s: cur.s, o: cur.o + consumed }) : null;
  return { items: await fillAdSlots(userId, items), nextCursor: next };
}`,
        },
      ],
      keyPoints: [
        'Fan-out is only candidate generation; ranking, seen-filtering and ad blending are the Instagram-specific parts.',
        'Snapshot the ranked list per session; the cursor is a signed (session, offset).',
        'Ads are blended after organic ranking with spacing rules and a per-slot auction.',
      ],
      source: 'Meta Engineering — Instagram ranking/Explore posts; Alex Xu Vol 1 Ch 11',
    },
    {
      heading: 'Instagram (5/7): Stories — 24-hour TTL, tray ordering & viewer lists',
      body: `**Intuition:** a Story is a post with a **built-in expiry** and an **audience list the author cares about**. That flips two defaults: you never need to keep it for long, and you write one record per viewer.

**Write path:** same media pipeline (vertical 9:16 renditions; short video segments). \`stories(id, author_id, media_key, created_at, expires_at = created_at + 24h, audience='all'|'close_friends')\`. Add the ID to \`active:{author}\` (ZSET, score = expires_at) and \`ZREMRANGEBYSCORE active:{author} -inf now\` on every read to drop expired items lazily.

**Tray (the row of circles):** computing it is a **pull at read time**: for the viewer's followees, which have a non-empty \`active:{author}\`? Doing that for 1,000 followees on every app open is too slow, so keep a per-viewer **tray cache** refreshed by fan-out of a small "author X has a new story" signal (one per author per update, not per story), with celebrities pulled on read as in the hybrid feed. Ordering: unseen authors first (compare the author's latest story ID with the viewer's \`lastSeen:{viewer}\` hash entry for that author), then by affinity (DMs, profile visits, likes), then recency. Live and close-friends rings are UI flags.

**Viewer lists:** each view writes \`(story_id, viewer_id, viewed_at)\`. It is write-heavy, append-only and short-lived, so use a wide-column table partitioned by \`story_id\` and clustered by \`viewed_at\` (with a column TTL), or Redis for the hot window. Deduplicate repeat views (the count is of *unique* viewers). The list must remain readable to the author for a while after the story expires (creator guides describe ~48 hours from posting), so the TTL is an **absolute** time from creation, never refreshed by later views. For mega-celebrities, show the first N pages exactly and an approximate unique count (HyperLogLog) beyond.

**Expiry is a contract, not a cron job:** readers must never show an item where \`expires_at < now\`, even if the cleanup job is late. Physical deletion (media from the bucket, rows) can lag; archives (opt-in "Story archive", Highlights) copy the story into a permanent collection before expiry.`,
      code: [
        {
          language: 'lua',
          title: 'Record a unique story view with an absolute expiry (Redis Lua, Redis 7+)',
          code: `-- KEYS[1] = views:{storyId}   (ZSET viewerId -> first viewed_at)
-- KEYS[2] = vcount:{storyId}  (HyperLogLog for very large audiences)
-- ARGV[1] = viewerId, ARGV[2] = now_ms, ARGV[3] = story_created_ms
-- ARGV[4] = exact_cap (e.g. 50000)

local retainUntilSec = math.floor((tonumber(ARGV[3]) + 48 * 3600 * 1000) / 1000)

-- NX on ZADD: a repeat view keeps the FIRST timestamp and returns 0
local added = 0
if redis.call('ZCARD', KEYS[1]) < tonumber(ARGV[4]) then
  added = redis.call('ZADD', KEYS[1], 'NX', ARGV[2], ARGV[1])
end
redis.call('PFADD', KEYS[2], ARGV[1])

-- absolute expiry from creation time; re-setting the same EXPIREAT is harmless,
-- unlike EXPIRE <48h> which would slide the deadline on every view
redis.call('EXPIREAT', KEYS[1], retainUntilSec)
redis.call('EXPIREAT', KEYS[2], retainUntilSec)
return added`,
        },
      ],
      keyPoints: [
        'Expiry is enforced on read (expires_at < now ⇒ invisible); deletion can lag.',
        'Tray = pull of followees with active stories, cached per viewer, ordered unseen → affinity → recency.',
        'Viewer lists: partition by story, dedupe per viewer, absolute TTL; HLL beyond an exact cap.',
      ],
      source: 'Creator guides on Instagram story viewers (viewer list readable ~48 h after posting); system-design write-ups on Stories (2025)',
    },
    {
      heading: 'Instagram (6/7): Explore & hashtag search',
      body: `**Intuition:** the feed answers "what did people I follow post?"; Explore answers "what would I like from the **billions** of posts I don't follow?". That is a recommendation funnel, not a database query. Hashtag pages sit in between: an inverted index with a ranking twist.

**Explore funnel (Meta Engineering, 2023):**
| Stage | Input → output | Model | Why it is cheap enough |
|---|---|---|---|
| Retrieval | billions → up to ~1,500 | Two Towers embeddings + ANN, item CF, personalised PageRank | item embeddings precomputed (daily) in an ANN index; the user embedding is computed once per request |
| First-stage ranking | ~1,500 → a few hundred | light Two-Tower ranker distilled from the heavy one | dot products over cached embeddings |
| Second-stage ranking | → ~100 | Multi-Task Multi-Label (P(click), P(like), P(see less)...) | heavy features only for the shortlist |
| Final rerank | → page | integrity filters, diversity, business rules | rules, no model |

Peak-hour trick: precompute recommendations for some users offline and blend them in when online capacity is tight.

**Hashtag search:**
- Parse hashtags at publish time (the PostPublished consumer); write \`(tag, post_id, created_at, quality_score)\` into a search index partitioned by **tag** (all posts of a tag on one shard → single-shard queries).
- Two views: **Recent** = newest-first postings (post IDs are time-sortable), **Top** = periodically recomputed (every few minutes) by engagement velocity × quality, cached per tag.
- **Hot tags** (#ipl during a final): one tag's posting list receives tens of thousands of posts per minute and becomes a hot shard. Split the posting list by **(tag, time bucket, salt)**; Recent reads only the newest buckets; Top reads its precomputed list, so read fan-out stays bounded.
- Typeahead for users/tags/places is a separate prefix index (see design-advanced typeahead), ranked by the viewer's graph (people you follow first).
- Moderation applies here too: banned or "limited" tags return nothing or only Top.`,
      keyPoints: [
        'Explore = retrieval (~1,500) → light ranker → heavy MTML (~100) → rules.',
        'Partition hashtags by tag; split hot tags by time bucket + salt.',
        'Top is precomputed per tag; Recent is a time-ordered scan of the newest buckets.',
      ],
      source: 'Meta Engineering — Scaling the Instagram Explore recommendations system (2023)',
    },
    {
      heading: 'Instagram (7/7): likes, comments & notifications at celebrity scale; bottlenecks',
      body: `**Intuition:** the post is the hot key. When a celebrity with 600M followers posts, millions of people act on **one row** within minutes, and every one of those actions also wants to notify **one person**.

**Likes:** two separate questions: "did *I* like it?" (per-user, exact: \`likes(post_id, user_id)\` partitioned by post, plus a per-user recent-likes cache for rendering hearts) and "how many?" (approximate is fine: sharded counters with write coalescing, flushed every few seconds; see design-more Distributed Counters for the full write/read path). Never \`UPDATE posts SET likes = likes + 1\` on the hot row.

**Comments:** \`comments(post_id, bucket, comment_id, author_id, text)\`, where \`bucket = comment_id time window\` keeps a viral post's partition from growing without bound. Reads: top comments ranked (author follows you, likes on comment, recency), paginated with a cursor; writes go through spam/abuse classifiers asynchronously, and the author sees their own comment at once.

**Notifications (the celebrity problem):** 2M likes in ten minutes cannot become 2M pushes to one phone.
- Events → Kafka keyed by **recipient** → aggregator holds a short window per \`(recipient, post, type)\` and emits "*alice and 1,203 others liked your post*".
- Per-recipient rate limits and quiet hours; collapse keys (APNs \`apns-collapse-id\`, FCM \`collapse_key\`) so the OS replaces the previous notification instead of stacking.
- The in-app activity feed is a per-user list of **aggregated** rows, updated in place.
- Followers of a celebrity are notified of new posts only for a sampled/high-affinity subset, and sends are spread over minutes to avoid a thundering herd on the CDN and the API.

**Bottlenecks & trade-offs to close with:**
| Area | Bottleneck | Mitigation / trade-off |
|---|---|---|
| Media egress | PB/day | renditions, AVIF/WebP, CDN hit ratio > 95%, device-aware sizes |
| Feed read | ranking latency | candidate caps, cached embeddings, snapshot per session |
| Celebrity post | hot rows/keys | pull for celebs, sharded counters, aggregated notifications |
| Stories | write-heavy views | partition per story, absolute TTL, HLL beyond cap |
| Hashtags | hot tag shard | time-bucket + salt split, precomputed Top |
| Consistency | stale counts, fan-out lag | eventual, but read-your-writes for the author |`,
      keyPoints: [
        '"Did I like it" is exact and per-user; "how many" is approximate via sharded counters.',
        'Bucket comment partitions by time on viral posts.',
        'Notifications are keyed by recipient and aggregated per (recipient, post, type) window.',
      ],
      source: 'design-more Distributed Counters; APNs/FCM collapse-key documentation',
    },
    {
      heading: 'Food delivery (1/7): requirements, India-scale estimation & architecture',
      body: `**Intuition:** a food-delivery app is **three apps sharing one order**: the customer app (browse, pay, track), the restaurant app (accept, prepare, mark ready) and the delivery-partner app (accept offers, navigate, hand over). The design-geo topic covers the proximity index and an Uber-style matcher; here the angle is the **marketplace around the kitchen**: what is serviceable right now, the order's money-and-state lifecycle, and dispatch whose clock is the restaurant's prep time.

**Functional:** discover restaurants that can deliver *to this address now*, browse menus with live availability, cart → pay → order; restaurant accept/reject; assign a partner; live tracking with ETA; cancellations and refunds; ratings. **Non-functional:** order placement must never double-charge or lose a paid order (strong consistency and idempotency on the money path); discovery and tracking may be eventually consistent; survive 2–3× surges at dinner, on rainy evenings and on cricket-final nights; p99 listing < 300 ms.

**Scale (cite only what is published):** Zomato's FY25 report gives **853M** food orders (≈ **2.34M/day**), AOV **₹453**, **20.6M** average monthly transacting customers and **4.73 lakh** delivery partners. Swiggy's 2025 trends report says dinner orders run about **32% above lunch**.

| Path | Assumption | Result |
|---|---|---|
| Order writes, dinner | 30% of 2.34M in a 2-hour window | ≈ 97 orders/s avg, ~200/s at the peak minute |
| Discovery reads | ~125 listing/menu calls per order placed | ≈ 25K QPS at the dinner peak |
| Partner pings | 40% of 4.73 lakh online, 1 ping / 4 s | ≈ 47K writes/s |

The lesson: **order writes are small**, so one well-sharded relational cluster (by city or order ID) is enough. The load sits in **discovery reads**, **location ingestion** and the **dispatch optimiser's CPU**, and all three are naturally partitioned **by city/zone**, which is also the failure-isolation boundary.`,
      diagram: ` Customer app        Restaurant app (tablet/POS)     Partner app
      |                     |  accept / ready             |  pings, accept
      v                     v                             v
 +-----------------------------------------------------------------+
 |          API gateway / BFFs (customer, restaurant, partner)     |
 +--+-----------+------------+-------------+-------------+---------+
    |           |            |             |             |
    v           v            v             v             v
 Discovery   Cart &      Order svc     Dispatch       Location svc
 (geo +      pricing     (state        (per-city      (ingest ->
 serviceab.) (fees,      machine,      batch          Redis geo,
    |         offers)    outbox) --+   optimiser)<--- H3 cells)
    v           |          |       |      |  ^            |
 Search idx  Payments <----+       |      |  | ETA/prep    v
 + menu      (PSP/UPI,             |      |  | models   Tracking
 cache       refunds,              v      v  |          (WS/SSE to
 (CDC from   ledger)            Kafka: order, offer     customer)
 catalog DB)                    events per city
                                   |
                     notifications, analytics, timers (accept SLA)`,
      keyPoints: [
        'Three apps, one order; the order is the source of truth.',
        'Order writes are ~100–200/s even at Indian peak; reads, pings and dispatch CPU are the load.',
        'City/zone is the unit of sharding, scaling and failure isolation.',
      ],
      source: 'Eternal (Zomato) FY25 annual report via MediaNama; Swiggy "How India Swiggy\'d 2025"',
    },
    {
      heading: 'Food delivery (2/7): restaurant discovery, serviceability & the menu catalog',
      body: `**Intuition:** "restaurants near me" is the proximity-service problem; "restaurants that **can deliver to me in 35 minutes right now**" is a live supply-and-demand question. That second question is **serviceability**, and it changes minute by minute.

**Serviceability check (per restaurant, per address):**
1. **Open** now (schedule, holiday, a restaurant-side pause toggle, kitchen not overloaded).
2. **Inside the delivery area**: a polygon per restaurant (or per zone) precomputed into H3 cells; \`cell → restaurant IDs\` is the candidate index (mechanics are in design-geo).
3. **Prep load**: the predicted prep time given current open orders in that kitchen (ML: restaurant, items, time of day, queue length). Zomato's ML platform serves exactly such a food-prep-time model from a Redis/DynamoDB feature store fed by Flink.
4. **Partner availability ("stress")**: per zone, open orders ÷ available partners over the next 15 minutes. As stress rises, **shrink the radius** (far restaurants disappear first), raise the delivery fee, widen the promised ETA, and finally switch the zone to "not serviceable" before you let unassignable orders pile up.
5. **ETA estimate** for the listing card (see Food 6/7).

The listing service fetches candidates by cell, joins live state (open/paused, stress, prep estimate) from Redis, filters, ranks (relevance, rating, ETA, ads) and returns a page. Live state is **pushed** by the restaurant and zone-stress services; never compute stress inside the listing request.

**Menu catalog:** large and slow-changing (items, variants, add-on groups, images, prices) vs **availability**, which is small and fast-changing (an item runs out at 8:40 p.m.). Keep them apart:
- Menu documents are versioned and cached (app + CDN, keyed by \`restaurantId:menuVersion\`), with CDC from the catalog DB bumping the version.
- Availability is a tiny per-restaurant bitmap/hash in Redis that the app fetches separately with a short TTL and that the restaurant toggle updates immediately.
- **Checkout re-validates** items, prices and availability against the source of truth, since a cache can always be stale; on mismatch the cart shows "item no longer available" rather than failing after payment.`,
      code: [
        {
          language: 'typescript',
          title: 'Serviceability filter for a listing request (live state from Redis, candidates from H3 cells)',
          code: `const MAX_PROMISE_MIN = 45;

export async function serviceableRestaurants(lat: number, lng: number): Promise<Card[]> {
  const cell = latLngToCell(lat, lng, 9);                 // h3-js, ~0.1 km² cells
  const zoneId = await zoneOf(cell);
  const candidates = await redis.smembers(\`svc:cell:\${cell}\`);   // precomputed polygons -> cells

  const [zone, states] = await Promise.all([
    redis.hgetall(\`zone:\${zoneId}\`),                     // { stress, maxRadiusM, feeTier }
    redis.mget(...candidates.map((id) => \`rest:live:\${id}\`)), // JSON: open, paused, prepMin, lat, lng
  ]);
  const stress = Number(zone.stress ?? 0);                // open orders / free partners (15 min)
  if (stress > 3) return [];                              // zone switched off: say so in the UI

  const radiusM = Number(zone.maxRadiusM ?? 7000);        // shrinks automatically as stress rises
  const out: Card[] = [];
  candidates.forEach((id, i) => {
    const raw = states[i];
    if (!raw) return;                                     // no live state -> treat as closed
    const s = JSON.parse(raw);
    if (!s.open || s.paused) return;
    const distM = haversineM(lat, lng, s.lat, s.lng);
    if (distM > radiusM) return;
    const etaMin = estimateEtaMin({ prepMin: s.prepMin, distM, stress });
    if (etaMin > MAX_PROMISE_MIN) return;                 // never list what we cannot promise
    out.push({ id, etaMin, feeTier: zone.feeTier, distM });
  });
  return rank(out);                                       // relevance, rating, ETA, sponsored
}`,
        },
      ],
      keyPoints: [
        'Serviceability = open ∧ in polygon ∧ prep load OK ∧ partner stress OK ∧ ETA within promise.',
        'Shrink radius → raise fee → widen ETA → switch zone off, in that order, as stress rises.',
        'Separate the menu (versioned, CDN-cached) from availability (tiny, live); re-validate at checkout.',
      ],
      source: 'DesignGurus — Swiggy interview (catalog/menu, serviceability); ZenML — Zomato ML runtime platform',
    },
    {
      heading: 'Food delivery (3/7): cart → order → payment without double charges',
      body: `**Intuition:** the cart is a draft, the order is a contract, and the payment is someone else's system that may answer late, twice or never. Design so that every step can be **retried safely**.

**Cart:** server-side (Redis, keyed by user, TTL of a few hours), single-restaurant. Pricing is computed by a pricing service: item prices + taxes + packaging + delivery fee (distance, surge, rain) + platform fee − offers. The checkout response includes a **quote ID** that freezes the price for ~10 minutes, so the amount charged equals the amount shown.

**Place order (\`POST /orders\` with an \`Idempotency-Key\`):**
1. Insert \`orders(status='PAYMENT_PENDING', quote_id, amount, idempotency_key UNIQUE)\`; a retry with the same key returns the same order.
2. Create a payment intent with the PSP using the **order ID as the merchant reference** (the PSP dedupes on it).
3. The client completes payment (UPI intent/collect, card 3-DS, wallet). In India **UPI is asynchronous**: success arrives by webhook and the user may close the app first.
4. Webhook (signature verified, deduped by PSP event ID) → \`PAYMENT_PENDING → PLACED\` as a conditional update + outbox event → the restaurant is notified.
5. **Reconciliation:** a job polls the PSP for orders stuck in PAYMENT_PENDING (e.g. at 2, 5 and 15 minutes). If paid, place the order (or, if the restaurant has since closed, refund automatically); if failed or expired, mark it PAYMENT_FAILED. A lost webhook must never mean "money taken, no food".

**Money model:** a double-entry ledger (customer → platform escrow → restaurant payout, partner earnings, tax) rather than mutable balance columns, so refunds and partial refunds are new entries, never edits. Settlement to restaurants is a daily/weekly batch built on that ledger (see design-commerce Payment System for the PSP-side details).

**Cash on delivery** skips payment but needs a fraud/limit check, and the partner's cash-in-hand becomes a balance to settle.`,
      code: [
        {
          language: 'sql',
          title: 'Orders with idempotent placement and a reconciliation queue (PostgreSQL)',
          code: `CREATE TABLE orders (
  id               bigint PRIMARY KEY,
  customer_id      bigint NOT NULL,
  restaurant_id    bigint NOT NULL,
  city_id          int    NOT NULL,
  status           text   NOT NULL,      -- PAYMENT_PENDING, PLACED, ACCEPTED, ...
  version          int    NOT NULL DEFAULT 0,
  amount_paise     bigint NOT NULL,      -- integer money, never float
  quote_id         uuid   NOT NULL,
  idempotency_key  text   NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, idempotency_key) -- retries of POST /orders hit this
);

-- idempotent create: a retry returns the existing row instead of a second order
INSERT INTO orders (id, customer_id, restaurant_id, city_id, status,
                    amount_paise, quote_id, idempotency_key)
VALUES ($1, $2, $3, $4, 'PAYMENT_PENDING', $5, $6, $7)
ON CONFLICT (customer_id, idempotency_key) DO NOTHING
RETURNING id;   -- no row returned => SELECT the existing order by the key

-- reconciliation sweep: claim stuck payments without double-processing across workers
SELECT id FROM orders
WHERE status = 'PAYMENT_PENDING' AND created_at < now() - interval '2 minutes'
ORDER BY created_at
LIMIT 100
FOR UPDATE SKIP LOCKED;`,
        },
      ],
      keyPoints: [
        'Quote ID freezes the price; the Idempotency-Key + UNIQUE constraint prevent duplicate orders.',
        'UPI is async: webhooks + polling reconciliation; a lost webhook must not lose a paid order.',
        'Ledger entries for refunds and payouts; never mutate balances in place.',
      ],
      source: 'Razorpay/Stripe idempotency & webhook docs; design-commerce Payment System',
    },
    {
      heading: 'Food delivery (4/7): the order lifecycle state machine & restaurant acceptance timeouts',
      body: `**Intuition:** the order is a **ticket that moves forward through stations**, and each station is a different actor (PSP, restaurant tablet, dispatcher, partner app). Events arrive late, duplicated and out of order; the state machine is what keeps the ticket honest.

| From | Event (actor) | To | Side effects (via outbox) |
|---|---|---|---|
| PAYMENT_PENDING | payment.succeeded (PSP) | PLACED | notify restaurant, start accept timer |
| PLACED | restaurant.accepted | ACCEPTED | prep estimate → dispatch planning |
| PLACED | accept timer fired / rejected | CANCELLED | full refund, apologise, maybe suggest alternatives |
| ACCEPTED | kitchen started | PREPARING | (often implicit) |
| ACCEPTED / PREPARING | food.ready | READY | partner nudged |
| READY / PREPARING | partner.picked_up (OTP/geo-verified) | PICKED_UP | live tracking to customer |
| PICKED_UP | partner.delivered (OTP / geofence) | DELIVERED | payouts, rating prompt |
| PLACED, ACCEPTED | customer.cancel | CANCELLED | refund minus policy fee |
| any non-terminal | ops.cancel | CANCELLED | refund per reason code |

**Rules that make it robust:**
- **Transitions are data, not if-statements:** a table of \`from → event → to\` checked by one function. Illegal transitions are rejected and logged (a late "ready" after "cancelled" is normal, not an error).
- **Conditional update:** \`UPDATE orders SET status=:to, version=version+1 WHERE id=:id AND status = ANY(:allowedFrom) AND version=:v\`. 0 rows ⇒ someone else moved it; reload and re-decide. This settles races such as *customer cancels* vs *restaurant accepts* arriving 50 ms apart.
- **Outbox in the same transaction** for side effects; consumers dedupe by event ID (processed_events table or idempotent upserts).
- **Monotonic partner events:** location/status events carry a sequence number; an older event cannot move the order backwards.

**Restaurant acceptance timeout:** restaurants on tablets miss orders (noise, network, a sleeping device). A **durable timer** (a DB row with \`fire_at\` polled with SKIP LOCKED, a delay queue, or a workflow engine such as Temporal) fires after ~60–90 s: first escalate (loud alert, automated IVR call, account manager), then at the hard deadline cancel with a full refund. The timer handler is itself a conditional transition (\`only if still PLACED\`), so a late accept and the timeout cannot both win. Never use an in-process \`setTimeout\` in an API pod: a deploy or crash silently loses it.`,
      code: [
        {
          language: 'typescript',
          title: 'Table-driven, idempotent order transitions with outbox and dedup (pg)',
          code: `type Status = 'PAYMENT_PENDING' | 'PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY'
  | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';
type Ev = 'PAID' | 'ACCEPT' | 'ACCEPT_TIMEOUT' | 'REJECT' | 'START' | 'READY'
  | 'PICKUP' | 'DELIVER' | 'CUSTOMER_CANCEL';

const T: Record<Ev, { from: Status[]; to: Status }> = {
  PAID:            { from: ['PAYMENT_PENDING'], to: 'PLACED' },
  ACCEPT:          { from: ['PLACED'], to: 'ACCEPTED' },
  ACCEPT_TIMEOUT:  { from: ['PLACED'], to: 'CANCELLED' },
  REJECT:          { from: ['PLACED'], to: 'CANCELLED' },
  START:           { from: ['ACCEPTED'], to: 'PREPARING' },
  READY:           { from: ['ACCEPTED', 'PREPARING'], to: 'READY' },
  PICKUP:          { from: ['PREPARING', 'READY'], to: 'PICKED_UP' },
  DELIVER:         { from: ['PICKED_UP'], to: 'DELIVERED' },
  CUSTOMER_CANCEL: { from: ['PLACED', 'ACCEPTED'], to: 'CANCELLED' },
};

export async function apply(pool: Pool, orderId: string, ev: Ev, eventId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // dedup: the same event delivered twice is a no-op
    const dup = await client.query(
      'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [eventId]);
    if (dup.rowCount === 0) { await client.query('ROLLBACK'); return 'duplicate'; }

    const { from, to } = T[ev];
    const res = await client.query(
      \`UPDATE orders SET status = $2, version = version + 1, updated_at = now()
        WHERE id = $1 AND status = ANY($3::text[])
        RETURNING version\`, [orderId, to, from]);
    if (res.rowCount === 0) {                 // lost a race or illegal from current state
      await client.query('COMMIT');           // keep the dedup row: the outcome is final
      return 'rejected';
    }
    await client.query(
      'INSERT INTO outbox (aggregate_id, type, payload) VALUES ($1, $2, $3)',
      [orderId, \`order.\${to.toLowerCase()}\`, { orderId, ev, version: res.rows[0].version }]);
    await client.query('COMMIT');
    return 'applied';
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}`,
        },
      ],
      keyPoints: [
        'Transitions as a table; conditional UPDATE on allowed-from states decides races.',
        'Outbox + consumer dedup give exactly-once effects on top of at-least-once delivery.',
        'Acceptance SLA = durable timer → escalate (IVR) → conditional auto-cancel + refund.',
      ],
      source: 'DesignGurus — Swiggy order-lifecycle question; Temporal/outbox patterns',
    },
    {
      heading: 'Food delivery (5/7): dispatch — just-in-time assignment, batching & offer/accept',
      body: `**Intuition:** in ride-hailing the rider is waiting, so you match the nearest driver now. In food delivery **the food is not ready yet**, so the best partner is the one who will arrive **just as the food is packed**. Arriving early wastes partner time (Swiggy's "Just-in-Time assignment" targets exactly this); arriving late makes food cold and the customer angry.

**Inputs per order:** predicted ready time (prep model + kitchen queue), restaurant location, drop location, promised ETA. **Per partner:** location, state (idle / heading to pickup / carrying orders), vehicle, current route, shift end, acceptance history.

**Batch optimisation instead of greedy:** every 10–60 s, per city zone, the dispatcher takes all unassigned orders whose "should assign by" time is near and all partners who are idle or finishing soon (Swiggy's Next Order Assignment considers partners about to complete a drop), builds a **sparse** cost graph (only the k nearest partners per order, from H3 rings) and solves an assignment (min-cost matching / MIP). DoorDash's DeepRed combines ML predictions (ready time, travel time, acceptance probability) with a MIP solver, and it may deliberately leave an order **unassigned this round** if a better partner will become free soon. Cost terms:
- partner idle wait at restaurant (arrival − ready, if positive),
- food wait / lateness (ready → pickup, and delivery vs promise, weighted heavily when late),
- partner travel (cost and fairness of earnings),
- predicted decline probability.

**Batching (stacking):** one partner carries 2–3 orders when the pickups are close (same restaurant or cluster) and the drops are in the same direction. It raises partner utilisation but delays the first customer, so cap the **max added delay** per order (e.g. ≤ 5–8 minutes and within its promise) and the batch size.

**Offer → accept → timeout:** the solver produces *offers*, not assignments. Each offer has an ID and a TTL (~15–30 s). The partner is soft-locked while the offer is open; acceptance is a compare-and-set on \`(orderId, offerId)\` so a late tap on an expired offer cannot double-assign. Timeout or decline returns the order to the next round with that partner excluded; repeated declines escalate the incentive or the radius. Gig partners are independent: acceptance rates are an input to the model, not something to force.`,
      code: [
        {
          language: 'lua',
          title: 'Fenced accept: only the live offer can turn into an assignment (Redis Lua)',
          code: `-- KEYS[1] = offer:{orderId}        hash: offerId, partnerId (TTL = offer window)
-- KEYS[2] = partner:busy:{partnerId} string: orderId currently held
-- KEYS[3] = assign:{orderId}       string: partnerId once assigned
-- ARGV[1] = offerId the partner app is accepting, ARGV[2] = partnerId

if redis.call('EXISTS', KEYS[3]) == 1 then
  return {0, 'already_assigned'}
end
local live = redis.call('HMGET', KEYS[1], 'offerId', 'partnerId')
if not live[1] then
  return {0, 'offer_expired'}            -- TTL elapsed; order went back to the pool
end
if live[1] ~= ARGV[1] or live[2] ~= ARGV[2] then
  return {0, 'stale_offer'}              -- a newer offer replaced this one
end
redis.call('SET', KEYS[3], ARGV[2])      -- assignment is final
redis.call('SET', KEYS[2], 'order:' .. ARGV[1])
redis.call('DEL', KEYS[1])
return {1, 'assigned'}
-- the caller then writes the assignment to the order DB (conditional update)
-- and emits order.assigned; Redis is the fast gate, the DB is the record`,
        },
      ],
      keyPoints: [
        'Assign so arrival ≈ ready time; idle-at-restaurant and cold food are both costs.',
        'Batch per zone over a pruned graph; it is fine to defer an order one round.',
        'Offers carry an ID + TTL; accept is a compare-and-set on that ID.',
      ],
      source: 'DoorDash Engineering — DeepRed dispatch (2021); Swiggy JIT assignment, NOA & batching',
    },
    {
      heading: 'Food delivery (6/7): live tracking, ETA promises, delivery fees, cancellations & refunds',
      body: `**Live tracking:** partner apps send a location every ~3–5 s (more often near pickup/drop, less when stationary) to an ingestion tier → Redis (latest location per partner + geo index for dispatch) and Kafka (history for ETA training and dispute resolution). The customer's tracking screen subscribes via WebSocket/SSE to \`order:{id}\` and gets **smoothed** positions (snap to road, interpolate) every few seconds; it does not need every ping. Fallback to polling when sockets drop in the background (iOS).

**ETA = a sum of predictable pieces** (Swiggy's own decomposition): *assignment delay*, *first mile* (partner → restaurant), *prep time*, *last mile* (restaurant → customer), plus handover buffers. Since the partner and the kitchen work in parallel: **ETA ≈ max(assignment delay + first mile, prep time) + last mile + buffers**. Each piece has its own model (prep: restaurant/items/hour/queue; travel: road graph + live traffic per H3 cell + rain flag). Show a **quantile** (e.g. P70–P80), not the mean: a mean ETA is missed half the time, while an inflated ETA loses the order. Swiggy calls finding that balance the "Goldilocks" value. Recompute at every milestone (accepted, assigned, picked up) and only move the shown ETA in small, explainable steps.

**Delivery fee and surge:** fee = base (distance band) + **surge** (zone stress, i.e. demand ÷ available partners) + weather (rain fee) + small-cart fee − subscription benefits. Indian platforms publicly charge rain surge fees (applied even to Zomato Gold / Swiggy One subscribers since 2025), a long-distance fee beyond ~4 km, and a per-order platform fee. Design: compute surge per zone every minute with **hysteresis and smoothing** (no flicker between adjacent streets), cap the multiplier, lock the quoted fee into the quote ID, and pass part of it to partners as an incentive, since raising partner supply is the point of surge.

**Cancellations & refunds:**
- Cancellation policy depends on state: free before the restaurant accepts; after acceptance the customer may pay a fee (food is being made); after pickup, usually no refund unless the platform failed.
- Platform-caused failures (no partner found, restaurant rejected, timeout) → automatic **full** refund to the source (UPI/card) or instant wallet credit, chosen by the user.
- Refunds are **idempotent**: one refund per \`(orderId, reason)\` or per item for partial refunds, with a PSP refund reference; retries reuse the same refund ID. Ledger entries reverse the restaurant payout or charge the restaurant, depending on fault.
- Partner compensation for cancelled-after-pickup orders is its own ledger entry.`,
      keyPoints: [
        'ETA ≈ max(assignment delay + first mile, prep) + last mile; show a quantile, update at milestones.',
        'Surge per zone with hysteresis, caps and a locked quote; the purpose is partner supply.',
        'Refunds are idempotent per (order, reason/item) and recorded as ledger reversals.',
      ],
      source: 'Swiggy Bytes — The Swiggy Delivery Challenge; Business Today / Inc42 reports on rain and long-distance fees (2025–2026)',
    },
    {
      heading: 'Food delivery (7/7): failure handling at peak; bottlenecks & trade-offs across both designs',
      body: `**Peak is predictable: plan capacity for it, don't react to it.** Dinner (≈ 32% above lunch on Swiggy), weekends, festivals, rain and cricket finals. Pre-scale by forecast (per city, per 15-minute slot) and run load tests at 2–3× the last peak.

**What fails first and the graceful answer:**
| Failure | Symptom | Response |
|---|---|---|
| Partner shortage (rain) | assignment delay climbs, stress > threshold | shrink radius, rain fee + partner incentives, widen ETA, pause zone |
| Restaurant tablet offline | orders sit in PLACED | accept timer → IVR call → auto-cancel + refund; mark restaurant paused after N misses |
| PSP / UPI degraded | success rate drops, PAYMENT_PENDING piles up | route to a healthier PSP, hide failing methods, reconcile by polling, never auto-retry a debit |
| Dispatch solver slow | round exceeds its time budget | smaller zones, smaller k, warm-start from last solution, greedy fallback for overflow |
| Location ingestion lag | stale positions, bad ETAs | drop/merge pings under load (latest wins), keep dispatch on the last known position plus its age |
| Discovery overload | listing p99 high | serve cached listing per H3 cell (30–60 s), skip personalisation, shed non-critical calls first |

**Shed in priority order:** keep order placement, payment callbacks, partner app and tracking alive; degrade recommendations, ratings, offers carousels and analytics first. Each city is a bulkhead: one city's solver or Kafka partition backlog must not slow others.

**Bottlenecks & trade-offs across both designs:**
| | Instagram | Food delivery |
|---|---|---|
| Dominant load | media egress, feed reads | discovery reads, location pings, solver CPU |
| Hot spot | celebrity post / hashtag | one zone at dinner in the rain |
| Consistency need | eventual (except own posts) | strong for money + order state, eventual for tracking/listing |
| Key async job | media processing → publish | timers, reconciliation, dispatch rounds |
| Core trade-off | ranking quality vs latency | partner utilisation (batching) vs food freshness/ETA |
| Partition key | user (posts/graph), post (likes/comments) | city/zone (dispatch, pings), order ID (orders) |

**Closing line:** *"At 10× I would keep the same shapes: more logical shards for Instagram and more zones for delivery. I'd invest in prediction (prep, travel, engagement), because both products win by guessing the future a few minutes ahead."*`,
      keyPoints: [
        'Forecast and pre-scale per city per slot; load-test at 2–3× last peak.',
        'Protect order, payment callback, partner and tracking paths; shed recommendations first.',
        'City/zone bulkheads for delivery; user/post sharding for Instagram.',
      ],
    },
    {
      heading: 'Level bar: what mid, senior and staff answers include',
      body: `**Intuition:** Instagram and food delivery are the two most common "product" prompts, so interviewers have sharp calibration for them. Mid (≈80% breadth / 20% depth) needs a complete, working design while the interviewer steers. Senior (≈60/40) gets through the HLD in about 10 minutes, picks the hard deep dives itself and names trade-offs with numbers. Staff (≈40/60) drives the whole session, and the interviewer only narrows focus. Staff answers bring in experience from related systems and raise cost, failure isolation, migration and team boundaries without being asked.

**Instagram**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | post photo, follow, home feed | ~40× read-heavy, read-your-writes for own posts, Stories in or out | which surfaces are ranked vs chronological; ads and integrity owners |
| High-level design | API → DB → object store, CDN | presigned upload, async renditions, fan-out-on-write + celebrity pull | sharded IDs (41/13/10), logical shards, per-surface services |
| Deep dives expected | feed generation | hybrid fan-out, cursor snapshots, sharded like counters | ranking funnel and seen-state; Explore retrieval → MTML |
| Trade-offs & failure handling | push vs pull named | publish only when every media item is READY; eventual counts | celebrity spikes on likes/comments/notifications; degraded feed |
| Ops/cost/evolution | none | CDN egress dominates cost | codec choice (AVIF/HEVC) as a cost lever; resharding without downtime |

*Down-levelled by:* uploading bytes through the API servers; one fan-out strategy for celebrities and everyone else; no CDN or egress discussion.

**Food delivery (Swiggy/Zomato-style)**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | browse, order, pay, track | three apps, one order as truth; ETA promise; UPI async | city/zone as the unit of scaling and failure; refunds policy |
| High-level design | services + order DB | serviceability, versioned menu vs live availability, order state machine | per-city bulkheads, dispatch per zone, ledger for money |
| Deep dives expected | placing an order | idempotent checkout (quote id + Idempotency-Key), acceptance timeouts | batched dispatch timed to food ready; surge with hysteresis |
| Trade-offs & failure handling | retry payment | lost UPI webhook → polling reconciliation | stress ladder: shrink radius → raise fee → widen ETA → close zone |
| Ops/cost/evolution | none | order writes only ~100–200/s; pings dominate | forecast and pre-scale per city per slot; load-test 2–3× peak |

*Down-levelled by:* synchronous payment in the order transaction; nearest-idle-rider dispatch with no batching; no story for a lost webhook.`,
      keyPoints: [
        'Mid: complete and working; senior: fast HLD and self-chosen deep dives with numbers; staff: drives, and covers cost, bulkheads and migration.',
        'Instagram traps: bytes through the API, one fan-out mode, no egress.',
        'Food delivery traps: synchronous payment, greedy dispatch, lost webhooks.',
      ],
      source: 'Hello Interview — problem breakdowns, "What is expected at each level"',
    },
    {
      heading: 'Deep-dive ladders: bad → good → great',
      body: `**Intuition:** both apps fail in the same two places: the write that fans out (feeds, dispatch) and the write that touches money or durable promises (publishing, payment). Climb each ladder by naming the failure first.

**Instagram — home feed with celebrities (500M DAU, some accounts with 300M followers)**
- **Bad:** pure fan-out-on-read. Every feed open queries ~200 followees' recent posts and merges them, which costs 200 reads × ~60K feed QPS, and p99 blows past 500 ms.
- **Good:** fan-out-on-write into a per-user Redis list of ~500 post ids. Reads are O(1), but one celebrity post means 300M inserts and minutes of lag, plus wasted writes for inactive followers.
- **Great:** hybrid. Push for normal authors and only to recently active followers. Pull celebrity posts at read time and merge them in. Fan-out is just candidate generation: a ranker scores ~500 candidates, seen-state filters them, and ads blend in with spacing rules. The ranked list is snapshotted per session behind a signed cursor (session, offset), so scrolling never repeats or skips.

**Instagram — upload and publish**
- **Bad:** upload bytes through the API servers, then process synchronously. Tying up threads on 5 MB uploads over 3G caps throughput, and a crash loses the post.
- **Good:** presigned upload straight to the bucket, an event triggers async renditions, and the API records state only.
- **Great:** decide the MIME type from magic bytes, rotate before stripping EXIF, and write renditions to immutable keys (CDN-friendly). The post publishes, and fan-out starts, only when every media item is READY, while the author sees it immediately (read-your-writes).

**Food delivery — checkout without double charges**
- **Bad:** create the order and call the PSP synchronously in one request. A client retry on timeout creates two orders and two charges, and a lost UPI webhook leaves a paid order stuck in PENDING.
- **Good:** an Idempotency-Key plus a UNIQUE constraint makes the order create happen once, and a quote id freezes the price.
- **Great:** payment is a state machine (CREATED → PENDING → PAID). Webhooks and a polling reconciler both drive the same conditional UPDATE, and an outbox emits OrderPaid exactly once in effect. Refunds are ledger reversals, idempotent per (order, reason), and balances are never mutated in place.

**Food delivery — dispatch at 8 pm peak**
- **Bad:** assign the nearest idle rider the moment the order is placed. Riders wait 15 minutes at the restaurant, food goes cold elsewhere, and two orders race for one rider.
- **Good:** offers carry an id + TTL, and accept is a compare-and-set, which ends double assignment.
- **Great:** just-in-time batched assignment per zone, every few seconds over a pruned rider–order graph, timed so that arrival ≈ food-ready. It is fine to defer an order a round. Under stress, follow the ladder: shrink the radius → raise the fee → widen the ETA → switch the zone off. The ETA shown is a quantile and updates at milestones.`,
      keyPoints: [
        'Feeds: hybrid fan-out, then rank, seen-filter, ads, and session-snapshot cursors.',
        'Publish only when all media is READY; bytes never touch API servers.',
        'Money: idempotent create, state machine driven by webhook + reconciler, ledger reversals.',
        'Dispatch: batched, just-in-time, CAS-accepted offers, and a stress ladder.',
      ],
      source: 'Hello Interview — problem breakdowns (Bad / Good / Great deep dives)',
    },
  ],
  codeChallenges: [
    {
      id: 'design-apps-cc-1',
      title: 'Restaurant acceptance timeout that cancels accepted orders and refunds twice',
      context:
        'A food-delivery order service (NestJS, Postgres, 12 pods behind a load balancer) gives restaurants 90 seconds to accept a paid order; otherwise the order is cancelled and refunded. Ops reports three problems from last Friday\'s dinner peak: (1) some orders were never cancelled even though the restaurant never responded; (2) a handful of orders were cancelled and refunded even though the restaurant had accepted and cooked them; (3) about 40 customers received two refunds for one order.',
      task: 'Rewrite the acceptance-timeout flow so that the timeout survives deploys and crashes, cannot override a restaurant acceptance that wins the race, and issues at most one refund per order, even when handlers are retried or run on several pods.',
      starter: {
        language: 'typescript',
        code: `@Injectable()
export class OrderPlacedHandler {
  constructor(private db: Pool, private psp: PaymentGateway, private notify: Notifier) {}

  // called by the payment webhook once payment succeeds
  async onPaid(orderId: string) {
    await this.db.query("UPDATE orders SET status = 'PLACED' WHERE id = $1", [orderId]);
    await this.notify.restaurant(orderId);

    setTimeout(async () => {
      const { rows } = await this.db.query('SELECT status, amount_paise FROM orders WHERE id = $1', [orderId]);
      if (rows[0].status !== 'ACCEPTED') {
        await this.db.query("UPDATE orders SET status = 'CANCELLED' WHERE id = $1", [orderId]);
        await this.psp.refund({ orderId, amount: rows[0].amount_paise });
        await this.notify.customer(orderId, 'Restaurant could not accept your order');
      }
    }, 90_000);
  }

  async onRestaurantAccepted(orderId: string) {
    await this.db.query("UPDATE orders SET status = 'ACCEPTED' WHERE id = $1", [orderId]);
  }
}`,
      },
      hints: [
        'Where does the 90-second timer live, and what happens to it when the pod is redeployed at minute 1?',
        'Between the SELECT and the UPDATE in the timer, the restaurant can accept. What does the UPDATE assume about the current status?',
        'The webhook can be delivered twice. How many timers and refunds does that create, and what would make the refund call safe to repeat?',
      ],
      solution: {
        language: 'typescript',
        code: `// 1) the timer is a row, written in the same transaction as the transition
async onPaid(orderId: string, pspEventId: string) {
  await tx(this.db, async (c) => {
    const ins = await c.query(
      'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [pspEventId]);
    if (ins.rowCount === 0) return;                      // duplicate webhook: no second timer
    const r = await c.query(
      "UPDATE orders SET status = 'PLACED', version = version + 1 WHERE id = $1 AND status = 'PAYMENT_PENDING'",
      [orderId]);
    if (r.rowCount === 0) return;                        // already placed/cancelled
    await c.query(
      "INSERT INTO timers (order_id, kind, fire_at) VALUES ($1, 'ACCEPT_SLA', now() + interval '90 seconds') ON CONFLICT DO NOTHING",
      [orderId]);
    await c.query("INSERT INTO outbox (aggregate_id, type) VALUES ($1, 'order.placed')", [orderId]);
  });
}

async onRestaurantAccepted(orderId: string) {
  const r = await this.db.query(
    "UPDATE orders SET status = 'ACCEPTED', version = version + 1 WHERE id = $1 AND status = 'PLACED'", [orderId]);
  if (r.rowCount === 0) throw new ConflictException('order no longer awaiting acceptance'); // tablet shows "cancelled"
}

// 2) any pod may run the sweeper; SKIP LOCKED gives each due timer to one worker
@Cron('*/5 * * * * *')
async fireDueTimers() {
  await tx(this.db, async (c) => {
    const { rows } = await c.query(
      "SELECT order_id FROM timers WHERE kind = 'ACCEPT_SLA' AND fire_at <= now() ORDER BY fire_at LIMIT 50 FOR UPDATE SKIP LOCKED");
    for (const { order_id } of rows) {
      // conditional: an acceptance that committed first makes this a no-op
      const r = await c.query(
        "UPDATE orders SET status = 'CANCELLED', cancel_reason = 'ACCEPT_TIMEOUT', version = version + 1 WHERE id = $1 AND status = 'PLACED' RETURNING amount_paise",
        [order_id]);
      if (r.rowCount === 1) {
        // one refund per (order, reason), enforced by a UNIQUE constraint
        await c.query(
          "INSERT INTO refunds (order_id, reason, amount_paise, status) VALUES ($1, 'ACCEPT_TIMEOUT', $2, 'PENDING') ON CONFLICT (order_id, reason) DO NOTHING",
          [order_id, r.rows[0].amount_paise]);
        await c.query("INSERT INTO outbox (aggregate_id, type) VALUES ($1, 'order.cancelled')", [order_id]);
      }
      await c.query("DELETE FROM timers WHERE order_id = $1 AND kind = 'ACCEPT_SLA'", [order_id]);
    }
  });
}

// 3) refund worker: the refund row's id is the PSP idempotency key, so retries are safe
async processRefund(refund: { id: string; orderId: string; amount: number }) {
  const res = await this.psp.refund({ orderId: refund.orderId, amount: refund.amount }, { idempotencyKey: refund.id });
  await this.db.query("UPDATE refunds SET status = 'SUCCEEDED', psp_ref = $2 WHERE id = $1", [refund.id, res.id]);
}`,
      },
      explanation: `**Fixes:**
- **Durable timer:** \`setTimeout\` lives in one pod's memory; a deploy, OOM or crash loses it (problem 1). The timer is now a \`timers\` row written in the same transaction as \`PLACED\`, and a sweeper on every pod claims due rows with \`FOR UPDATE SKIP LOCKED\`, so each fires exactly once.
- **Conditional transitions:** the old timer did read-then-write with an unconditional \`UPDATE\`, so an acceptance that landed in between was overwritten (problem 2). Both the accept and the timeout now use \`WHERE status = 'PLACED'\`; whichever commits first wins and the other updates 0 rows. The restaurant gets an explicit conflict instead of silently cooking a cancelled order.
- **Webhook dedup:** a duplicate payment webhook used to start a second timer, and with it a second refund (problem 3). \`processed_events\` plus the \`PAYMENT_PENDING\` guard make \`onPaid\` idempotent.
- **Idempotent refunds:** \`UNIQUE (order_id, reason)\` allows one refund intent per reason. The PSP call is made outside the DB transaction by a worker that passes the refund row ID as the idempotency key, so retries never pay twice.
- **Side effects via outbox:** notifications are sent after commit, never for a transition that lost the race.`,
      followUps: [
        {
          q: 'Product now wants an escalation: at 45 s an automated IVR call to the restaurant, at 90 s the cancel. How do you extend this without a second timer system?',
          a: 'Make the timer generic: \`timers(order_id, kind, fire_at)\` with kinds \`ACCEPT_NUDGE\` (45 s) and \`ACCEPT_SLA\` (90 s), both inserted at PLACED. The sweeper dispatches by kind. The nudge handler checks \`status = \'PLACED\'\` and enqueues an IVR call (itself idempotent per order + kind). Acceptance deletes the pending timers for the order in its own transaction, which is an optimisation; correctness still comes from the conditional updates. For multi-step flows with branching, a workflow engine (Temporal) gives the same guarantees with less plumbing.',
        },
        {
          q: 'At peak, 5,000 timers come due in the same second after a 30-second Postgres failover. Does the sweeper keep up, and how do you test this?',
          a: 'The batch of 50 every 5 s on one pod is too slow (10/s). Run the sweeper on all 12 pods and loop while rows are returned (SKIP LOCKED spreads them), with a batch of ~200 → thousands per second, and keep the \`(kind, fire_at)\` index small by deleting fired rows. Accept that some timeouts fire 30–60 s late after an outage; that is tolerable because the action is conditional. Test with a load script that inserts 5,000 due timers plus concurrent accept calls for half of them, then assert: no order is both ACCEPTED and CANCELLED, refunds count = cancelled count, and the backlog drains within the SLO.',
        },
      ],
    },
    {
      id: 'design-apps-cc-2',
      title: 'Create-post endpoint that blocks on image processing and fans out broken posts',
      context:
        'An Instagram-like service lets clients upload photos with a presigned URL and then call `POST /posts`. During an evening spike, p99 for `POST /posts` hit 14 s, API pods ran out of memory, followers saw posts with missing images, some users found the same post twice on their profile, and a security review found that users can attach other people\'s media IDs and that location metadata leaks in served images.',
      task: 'Redesign the create-post handler (and what it hands off) so that it returns quickly, never publishes a post before its renditions exist, is safe to retry, enforces media ownership and strips private metadata. Keep the presigned-upload flow.',
      starter: {
        language: 'typescript',
        code: `@Post('posts')
async create(@User() user: AuthUser, @Body() dto: { mediaIds: string[]; caption: string }) {
  const post = await this.posts.insert({ ownerId: user.id, caption: dto.caption, status: 'PUBLISHED' });

  for (const mediaId of dto.mediaIds) {
    const obj = await this.s3.getObject({ Bucket: 'raw', Key: mediaId });     // whole file in memory
    const buf = await obj.Body.transformToByteArray();
    for (const w of [1080, 640, 320]) {
      const out = await sharp(buf).resize(w).jpeg().withMetadata().toBuffer();   // keeps EXIF
      await this.s3.putObject({ Bucket: 'public', Key: mediaId + '_' + w, Body: out,
                                ContentType: obj.ContentType });                // client-supplied type
    }
    await this.media.attach(mediaId, post.id);
  }

  // fan-out to followers inline
  const followers = await this.graph.followersOf(user.id);       // can be 50M rows
  for (const f of followers) await this.redis.zadd('feed:' + f, Date.now(), post.id);

  return post;
}`,
      },
      hints: [
        'Which of these steps must happen before the response, and which only before followers can see the post?',
        'What does the API know about who uploaded each media ID, and what happens if the mobile client retries after a timeout?',
        'Look at the sharp chain: what does withMetadata() keep, and what about EXIF orientation?',
      ],
      solution: {
        language: 'typescript',
        code: `@Post('posts')
@HttpCode(202)
async create(
  @User() user: AuthUser,
  @Headers('idempotency-key') idemKey: string,
  @Body() dto: { mediaIds: string[]; caption: string },
) {
  if (!idemKey) throw new BadRequestException('Idempotency-Key required');
  if (dto.mediaIds.length < 1 || dto.mediaIds.length > 10) throw new BadRequestException('1-10 media');

  return this.db.tx(async (t) => {
    // a retry of the same request returns the same post instead of creating a duplicate
    const existing = await t.posts.findByIdempotencyKey(user.id, idemKey);
    if (existing) return existing;

    // ownership + state: every media item must be uploaded by this user and not yet attached
    const media = await t.media.lockMany(dto.mediaIds);   // SELECT ... FOR UPDATE
    if (media.length !== dto.mediaIds.length ||
        media.some((m) => m.ownerId !== user.id || m.postId !== null || m.status === 'UPLOADING')) {
      throw new ForbiddenException('invalid media');
    }

    const post = await t.posts.insert({
      ownerId: user.id, caption: dto.caption, status: 'PROCESSING', idempotencyKey: idemKey,
    });
    await t.media.attach(dto.mediaIds, post.id);
    // one job per media item, keyed by mediaId so redelivery is a no-op (see worker)
    await t.outbox.insertMany(dto.mediaIds.map((id) => ({ type: 'media.process', key: id, payload: { mediaId: id } })));
    return post;   // author's client renders it from local files + own-posts cache
  });
}

// worker side (summary): verify magic bytes, sharp(buf).rotate().resize(...).webp() with no
// withMetadata(), so EXIF/GPS is dropped and orientation is baked in; immutable keys
// r/{mediaId}/{w}.webp; then:
async onMediaReady(mediaId: string) {
  await this.db.tx(async (t) => {
    const postId = await t.media.markReady(mediaId);
    // publish exactly once, only when ALL media of the post are READY
    const published = await t.posts.publishIfAllMediaReady(postId);   // UPDATE ... WHERE status='PROCESSING' AND NOT EXISTS (non-ready media)
    if (published) await t.outbox.insert({ type: 'post.published', key: postId, payload: { postId } });
  });
}
// post.published -> fan-out workers page through followers in batches of 1K
// (celebrities skipped: their posts are pulled at read time), search indexer, notifications`,
      },
      explanation: `**Fixes:**
- **Off the request path:** resizing and fan-out ran inline (14 s p99, OOM on large files, 50M ZADDs in one request). The handler now only validates and records state, returning **202**; processing and fan-out are queued through the outbox.
- **Publish gate:** the post used to be PUBLISHED before any rendition existed, so followers got broken images. It now starts as \`PROCESSING\` and flips to \`PUBLISHED\` exactly once, through a conditional update when the last media item is READY; only then is \`post.published\` emitted.
- **Idempotency:** mobile retries created duplicate posts. The required \`Idempotency-Key\` is stored on the post, and the outbox jobs are keyed by mediaId.
- **Ownership:** media IDs were trusted blindly (IDOR). Rows are locked and checked for owner, unattached and uploaded.
- **Privacy & correctness:** \`withMetadata()\` kept EXIF (GPS) and the client's Content-Type was copied to public objects. The worker uses \`rotate()\` (orientation baked in) and no metadata, decides the type from magic bytes, and writes immutable WebP renditions.
- **Celebrity fan-out:** inline per-follower writes are replaced by batched fan-out workers, skipping celebrities whose posts are pulled at read time (design-social hybrid).`,
      followUps: [
        {
          q: 'The moderation model needs 4 s per image on GPU and the queue backs up to 20 minutes during a festival. What do you change without letting unmoderated content reach followers?',
          a: 'Split moderation into tiers: a cheap hash match (PDQ/pHash against known-bad lists) and a small CPU classifier run inline in the worker (tens of ms). Only uncertain scores go to the GPU model, with priority by audience size (a 50M-follower account first, a private account with 30 followers later). Publish to followers once the cheap tiers pass and the account is in good standing, and retroactively remove if the heavy model flags it later. Autoscale GPU workers on queue age, not CPU.',
        },
        {
          q: 'A user deletes a post 3 seconds after creating it, while its media jobs are still running. What can go wrong and how does your design handle it?',
          a: 'Race: a worker finishes later and \`publishIfAllMediaReady\` would publish a deleted post, or renditions are orphaned. Make deletion a state (\`REMOVED\`) and have publish require \`status = \'PROCESSING\'\`, so it becomes a no-op. Workers check post status before heavy work and abort if removed. A cleanup job deletes renditions of REMOVED posts, and CDN objects are purged or simply expire, since the keys become unreachable. If it was already fanned out, emit \`post.removed\` so feed reads filter it (removal is checked at hydrate time anyway).',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-apps-iq-01',
      difficulty: 'hard',
      question:
        'Design Instagram for 500M daily users: photo and video posts, follows, and a ranked home feed. Spend your deep dive on what is different from a generic text feed.',
      context:
        'Commonly listed in 2025–2026 question banks (PracHub ranks Instagram #12 of the 30 most-asked designs). The interviewer has seen the fan-out lecture many times and wants the media and ranking specifics.',
      whatInterviewerLooksFor: [
        'Numbers that show the workload is read-heavy and egress-dominated, and design choices that follow from them',
        'A direct-to-storage upload with asynchronous processing and an explicit publish gate',
        'A data model sharded by user, with time-sortable IDs and the follow edge stored in both directions',
        'Feed pipeline beyond fan-out: candidate sources, ranking stages, seen filtering, stable pagination',
        'Clear consistency choices (read-your-writes for the author, eventual elsewhere)',
      ],
      modelAnswer: `**Scope & numbers.** Posts with 1–10 media, follow, ranked feed; Stories/Explore as later deep dives. 100M posts/day ≈ 1.2K/s (peak ~3.5K/s); 500M DAU × 8 feed loads ≈ 46K QPS (peak ~140K). Images: 500M users × ~100 images × 150 KB ≈ 7.5 PB/day of egress, so **the CDN and rendition sizes are the cost centre**.

**Write path.** \`POST /uploads\` returns a presigned PUT (multipart for video). The client uploads directly, then \`POST /posts\` (idempotency key) creates the post in PROCESSING. Workers verify bytes, rotate, strip EXIF, build 4 renditions in WebP/AVIF, pHash for dedup/abuse, run moderation, then flip to PUBLISHED and emit \`PostPublished\` through an outbox.

**Data.** Sharded Postgres by owner: posts, media, \`following\` (by follower) and \`followers\` (by followee). 64-bit IDs (41 bits time, 13 bits logical shard, 10 bits sequence), so IDs sort by time and encode their shard. Counters are sharded and approximate.

**Feed.** Candidate generation = hybrid fan-out (push for normal authors into a Redis list, pull for celebrities) plus suggested posts. Filter blocked and seen items (impression store). Rank in two stages: a light model down to ~150, then a multi-task model predicting like/comment/dwell/hide, combined with product weights. Then rules: diversity, ad slots every ~5 posts. Snapshot the ranked list per session and paginate with a signed (session, offset) cursor; refresh starts a new session.

**Serving media.** Immutable rendition keys, \`Cache-Control: immutable\`, device-appropriate widths; a CDN hit ratio > 95% keeps origin at a few tens of Gbps.

**Consistency.** The author sees their post at once (own-posts merge); followers within seconds. Counts are eventually consistent.

**Bottlenecks.** Celebrity posts (pull + sharded counters + aggregated notifications), ranking latency (cap candidates, cache embeddings), egress (codecs, CDN tiers).`,
      followUps: [
        {
          q: 'You have only 10 minutes left. Which single deep dive do you pick and why?',
          a: 'The media pipeline with the publish gate, or the feed read path, depending on the interviewer\'s hints. With no hint, I pick the feed read path: it carries ~40× the traffic of writes and has the subtle bugs (pagination over a changing ranking, seen-state across devices, celebrity merge). I state the upload flow in two sentences, presigned direct upload plus async processing that publishes when ready, so the interviewer knows I have it covered.',
        },
        {
          q: 'Your followers-by-followee table for a 600M-follower account is a single partition. Does that break fan-out?',
          a: 'Celebrities are not fanned out on write at all; their posts are pulled at read time, so the large partition is read only for notifications and analytics. Still, a single 600M-row partition hurts compaction and repair, so bucket it: key \`(followee_id, bucket)\` with \`bucket = hash(follower_id) % 256\`. Workers page each bucket with a follower-ID cursor, and the buckets can be processed in parallel.',
        },
        {
          q: 'Legal requires that a deleted post disappears from every feed within 60 seconds. What changes?',
          a: 'Precomputed timelines still hold the ID, so filtering must happen at read time: hydrate checks post status (from the post cache, invalidated on delete) and drops REMOVED posts. Feed snapshots are at most 30 minutes old but are hydrated per page, so they are also filtered. CDN media keys are purged (or are signed URLs with short expiry), so the image cannot be fetched directly even from a cached client URL.',
        },
      ],
      pitfalls: [
        'Re-teaching push vs pull for 20 minutes and never reaching media, ranking or pagination',
        'Streaming uploads through the API servers or resizing images inside the request',
        'OFFSET pagination over a ranked feed',
        'Ignoring egress cost: no renditions, no CDN cache policy',
      ],
    },
    {
      id: 'design-apps-iq-02',
      difficulty: 'hard',
      question:
        'After a launch, users report that new posts sometimes show grey boxes in followers\' feeds for up to 20 seconds, and a few photos appear rotated 90°. A privacy researcher also extracted home coordinates from downloaded images. Walk me through the media pipeline you would build to fix all three.',
      whatInterviewerLooksFor: [
        'Diagnoses the root causes: publishing before renditions exist, EXIF orientation dropped, metadata served',
        'An asynchronous pipeline with explicit media and post states and a publish gate',
        'Correct ordering of orientation and metadata stripping, and type detection by magic bytes',
        'Idempotent, retryable jobs and handling of stuck or abandoned uploads',
      ],
      modelAnswer: `**Root causes.**
1. *Grey boxes:* the post is visible (fanned out) before its renditions are written; the CDN misses and the client shows a placeholder until the worker catches up.
2. *Rotation:* phone cameras store pixels in sensor orientation plus an EXIF orientation tag. Our resizer dropped metadata without first applying the tag.
3. *Location leak:* originals or renditions are served with EXIF intact, including GPS.

**Pipeline.**
- \`media.status\`: UPLOADING → UPLOADED → PROCESSING → READY | REJECTED. \`post.status\`: PROCESSING → PUBLISHED | REMOVED.
- Upload goes directly to a **private raw bucket** (presigned, size-capped). Raw objects are never served publicly.
- Job per mediaId (idempotent): read the bytes and detect the type from magic bytes → **apply orientation (rotate)** → resize to 1080/640/320/150 → encode WebP/AVIF without metadata → write immutable keys to the renditions bucket → perceptual hash → moderation.
- **Publish gate:** in one transaction, mark the media READY and, if every media item of the post is READY, set the post PUBLISHED and write \`post.published\` to the outbox. Fan-out, notifications and search consume only that event.
- The author sees the post immediately from local files, so perceived latency stays near zero.

**Operations.** Queue-age autoscaling (processing p95 < 5 s for photos); retries with back-off and a DLQ; a sweeper re-enqueues PROCESSING older than 10 min; lifecycle rules abort incomplete multipart uploads after 24 h and delete raw originals after a retention window (or keep them in a cold tier, if re-encoding later matters).

**Verification.** A synthetic upload every minute per region asserts that renditions exist before the published event fires; an EXIF scanner samples served images and alerts on any GPS tag.`,
      followUps: [
        {
          q: 'Video takes 30–90 s to transcode. Do you hold the whole post until the last rendition is done?',
          a: 'No. Gate on a **minimum playable set**: a poster frame plus one low/medium HLS rendition (e.g. 480p) is enough to publish; higher bitrates are added to the manifest as they finish, and the player\'s ABR picks them up. For a carousel with photos and a video, publish when all photos and the minimum video set are ready. Track this as \`media.playable=true\` separately from \`media.complete\`.',
        },
        {
          q: 'Should you keep the original upload after processing?',
          a: 'Keep it, but private and in a cheaper tier. Originals let you re-encode when a better codec ships (moving JPEG to AVIF can save ~30–50% egress), redo moderation with a new model, and serve legal holds. Store them in infrequent-access or archive storage after 30 days, with GPS stripped on any copy that is ever served. The cost is real (originals are ~4–5× the renditions), so some products keep only a high-quality master rendition instead.',
        },
      ],
      pitfalls: [
        'Fixing the grey boxes with a longer client retry instead of a publish gate',
        'Stripping EXIF before applying orientation',
        'Trusting the client-supplied Content-Type or file extension',
      ],
    },
    {
      id: 'design-apps-iq-03',
      difficulty: 'expert',
      question:
        'Our ranked Instagram home feed has three complaints: people see the same post again after scrolling a while, posts they already saw on the iPad reappear on the phone, and the ads team wants one ad every five posts but never two ads from the same advertiser within 20 posts. Design the feed session, cursor and blending logic.',
      whatInterviewerLooksFor: [
        'Recognises that re-ranking between pages breaks naive cursors',
        'A server-side session snapshot with a signed cursor, and a clear refresh semantics',
        'A cross-device seen-state store with a bounded size and an explicit consistency trade-off',
        'Ads blended after organic ranking with spacing constraints and per-slot auctions',
      ],
      modelAnswer: `**Why duplicates happen.** The ranker runs per request. Page 2 is computed against a *new* ranking, in which items shift up or down, so an OFFSET/score cursor repeats some posts and skips others.

**Session snapshot.** On a cold open or pull-to-refresh: generate candidates (~1,000), filter, rank, and store the top ~300 IDs in Redis \`feedsess:{user}:{sid}\` (TTL 30 min). The cursor is \`HMAC(sid, offset)\`. Pages read sequential slices, so they are stable by construction. If the snapshot expires, build a new one and filter the seen items, which gives no duplicates and at worst a slightly different order. New posts arriving mid-session go to a "New posts" pill, not into the snapshot.

**Cross-device seen-state.** Clients send impression events (post visible ≥ 50% for ≥ 1 s) in batches every ~5 s → Kafka → a per-user store: a capped ZSET of the last ~2,000 impressions (postId → time) or a rolling Bloom filter (~2.4 KB per user for 2K items at 1% FPR: 9.6 bits × 2,000). The ranker filters candidates against it (or demotes them: a post seen once might still be shown again if it is highly engaging, which is a product choice). It is eventually consistent: a phone opened within seconds of the iPad scroll may still show a few duplicates. Accept that rather than synchronous writes on scroll.

**Ad blending.** The organic list is final first. A blender walks positions; at every 5th slot it requests an ad from the ad server with constraints \`{excludeAdvertisers: last 20 positions, userAdLoad, position}\`. The ad server runs a per-slot auction (bid × pCTR × quality) with budget pacing. If no eligible ad wins, the slot stays organic, so ad load is a cap, not a guarantee. Ad decisions are made per page (not snapshotted), because budgets and pacing change by the minute. Spacing state (advertisers already shown) travels in the session.

**Metrics.** Duplicate-impression rate per session, ad spacing violations (should be 0), feed p99 with the blender (~30 ms budget).`,
      followUps: [
        {
          q: 'The seen store is a Bloom filter and a false positive hides a post the user never saw. How bad is that, and can you avoid it?',
          a: 'At 1% FPR, about 1 in 100 unseen candidates is wrongly filtered. For followee posts that matters (a friend\'s wedding photo can vanish), less so for suggestions. Use exact storage for followee posts (a capped ZSET of IDs, ~2,000 × 8–16 bytes) and the Bloom filter only for the recommendation pool, or demote instead of drop on a hit. Rotate filters daily (two generations) so FPR does not climb as the filter fills.',
        },
        {
          q: 'Snapshots for 100M concurrent sessions: how much Redis is that, and is it worth it?',
          a: '300 IDs × 8 bytes ≈ 2.4 KB of payload; with list overhead, call it ~4 KB per session → 100M × 4 KB ≈ 400 GB across the cluster. That is acceptable (tens of nodes), and it saves re-ranking on every page, which costs far more in CPU. Reduce it by storing 150 IDs and extending on demand, compressing deltas, and expiring idle sessions after 10 minutes.',
        },
      ],
      pitfalls: [
        'Using created_at or score as the cursor for a ranked, changing list',
        'Synchronously writing seen-state on every scroll event',
        'Baking ads into precomputed timelines at fan-out time',
      ],
    },
    {
      id: 'design-apps-iq-04',
      difficulty: 'hard',
      question:
        'Design Instagram Stories: posting, the tray of circles at the top, 24-hour expiry, and the "seen by" list. A cricketer with 250M followers posts 15 stories during a match.',
      whatInterviewerLooksFor: [
        'Expiry enforced on read; physical deletion decoupled',
        'A tray strategy that does not scan all followees on every app open, with celebrity handling',
        'A viewer-list design for write-heavy, unique, short-lived data',
        'Numbers for the celebrity case and approximate counting beyond a cap',
      ],
      modelAnswer: `**Model.** \`stories(id, author_id, media_key, created_at, expires_at, audience)\` and \`active:{author}\` ZSET (score = expires_at). Reads always apply \`expires_at > now\`; a background job deletes media and rows later, so a late cleanup never shows stale content.

**Tray.** On open we need "followees with active stories, unseen first". Two parts:
- Normal authors: posting writes a small signal \`trayIn:{follower} ← author\` (one per author per update, deduped), so the tray cache is fan-out on write of *authors*, not of stories.
- Celebrities (> ~1M followers): no fan-out. At read time, intersect my followed celebrities (usually a short list) with a global \`celebActive\` set.
- Ordering: for each author compare \`latestStoryId(author)\` with \`lastSeen:{me}[author]\`. Unseen first, then an affinity score (DMs, likes, profile visits), then recency. Cache the computed tray per viewer for ~60 s.

**Viewing.** The client prefetches the first segment of the first few unseen authors' stories from the CDN. 15 stories × 250M potential viewers is CDN-scale egress, not database load.

**Seen-by list.** Each view writes (story, viewer, ts). For the cricketer: say 60M unique viewers per story × 15 stories ≈ 900M view records in a few hours, peaking at hundreds of thousands per second. Store them in a wide-column table partitioned by \`(story_id, bucket)\` (e.g. 64 buckets by viewer hash) with a TTL measured from creation. Dedupe with an upsert on (story, viewer). Exact counts beyond ~1M are pointless in the UI: show HyperLogLog totals and an exact, paginated list of the first pages ordered by follower relevance.

**Expiry vs list retention.** The list stays readable to the author for a while after the story expires (creator guides describe ~48 h from posting), so the TTL is absolute from \`created_at\`, never refreshed by views.

**Highlights/archive** copy the story into a permanent collection before expiry.`,
      followUps: [
        {
          q: 'The author opens the viewers list during the match and it is the most expensive query you have. How do you serve it?',
          a: 'Precompute: a stream job keeps per-story top-N "relevant viewers" (people the author follows, frequent interactors) in Redis, updated as views arrive, and an HLL count. The first page reads only that. Deeper pages scan one bucket at a time with a cursor (bucket, last viewer ID), so no query touches all 900M rows. The author\'s list view is rate-limited and cached for ~10 s.',
        },
        {
          q: 'What breaks if your story IDs come from a clock-skewed node and you use them for "unseen" comparison?',
          a: 'If a new story has a lower ID than the viewer\'s lastSeen marker (due to skew), the tray shows the author as seen and the viewer misses it. Avoid comparing raw IDs across nodes: compare per-author sequence numbers (assigned by the author\'s shard, monotonic) or keep a per-author "seen set" of the active story IDs (at most ~100 per author in 24 h). Snowflake-style IDs from different generators are only roughly time-ordered.',
        },
      ],
      pitfalls: [
        'Relying on a cron job for expiry without filtering by expires_at on read',
        'Fanning out every story ID to 250M followers',
        'Sliding TTLs on the viewer list',
      ],
    },
    {
      id: 'design-apps-iq-05',
      difficulty: 'expert',
      question:
        'During the IPL final, #ipl2026 receives about 40K new posts per minute and its hashtag page is opened 300K times per minute. Your search index is partitioned by hashtag. What breaks, and how do you redesign hashtag pages for this?',
      whatInterviewerLooksFor: [
        'Identifies the single hot shard for both writes and reads',
        'Separates the Recent and Top views and treats them differently',
        'Splits hot posting lists by time bucket and salt while keeping reads bounded',
        'Moderation and quality ranking at this volume',
      ],
      modelAnswer: `**What breaks.** Partitioning by tag puts every #ipl2026 posting (≈ 670 writes/s) and every page read (≈ 5K reads/s) on one shard and its replicas. Index refreshes slow, merges pile up, and reads time out, while the rest of the cluster idles.

**Two different products.**
- **Recent:** newest-first, freshness matters, quality matters less.
- **Top:** a few hundred high-quality posts, which can be seconds to minutes stale.

**Redesign.**
1. **Hot-tag detection:** a streaming counter (Count-Min Sketch over a 1-minute window) flags tags above a threshold (e.g. > 50 posts/s) and marks them "split".
2. **Write path for split tags:** key postings by \`(tag, minuteBucket, salt 0..15)\`, so writes spread over 16 partitions per minute and older buckets become immutable (good for caching).
3. **Recent read:** read the latest 1–2 minute buckets across 16 salts (32 small queries, or a materialised "latest 500" list maintained by a consumer) and merge by post ID, which is time-sortable. Serve the first page from a cache refreshed every 2–5 s: 300K opens/min collapse to a few refreshes per second.
4. **Top read:** a stream job maintains top-K by engagement velocity × author quality × integrity score, recomputed every minute, cached per tag/region, CDN-cacheable for logged-out views.
5. **Quality and safety:** spam bursts love trending tags. Rate-limit tag usage per new account, drop low-quality accounts from Top, and run the cheap classifier inline before a post enters even Recent.

**Unsplitting:** when the rate falls, new postings go back to the normal single partition, and old buckets stay readable until they age out.

**Why not document partitioning everywhere?** It spreads writes but makes every tag query scatter-gather across all shards: wasteful for the millions of cold tags that fit on one shard.`,
      followUps: [
        {
          q: 'The page shows "4.2M posts" next to the tag. How do you keep that number cheap?',
          a: 'Never count postings. Keep a per-tag counter updated asynchronously by the indexer, sharded for hot tags (16 sub-counters summed on read and cached for a few seconds), and display it rounded ("4.2M"). Minor drift from deletions is reconciled by a nightly recount from the index. HyperLogLog is unnecessary because each post adds the tag once.',
        },
        {
          q: 'A coordinated campaign floods #ipl2026 with copies of the same image. What in your existing pipeline helps?',
          a: 'The perceptual hash from the media pipeline: cluster postings by pHash/PDQ within the tag and show at most one per cluster in Top (and collapse it in Recent). Combine with account-age and velocity rules: 500 new accounts posting near-identical images within minutes is a strong signal. Matching against known-abuse hash lists happens before indexing.',
        },
      ],
      pitfalls: [
        'Adding replicas only: writes still hit one primary shard',
        'Treating Top and Recent as the same query with a different sort',
        'Proposing global scatter-gather for every hashtag',
      ],
    },
    {
      id: 'design-apps-iq-06',
      difficulty: 'hard',
      question:
        'A global celebrity posts and receives 2 million likes and 150K comments in the first ten minutes. Their phone receives a storm of notifications, the like count on the post jumps around, and the comments section is slow for everyone. Fix the engagement and notification paths.',
      whatInterviewerLooksFor: [
        'Separates per-user like state from the aggregate count',
        'Avoids hot rows and partitions for comments on a single post',
        'Notification aggregation keyed by recipient, with OS-level collapse',
        'Monotonic display of counts',
      ],
      modelAnswer: `**Likes.**
- *Per-user state* ("did I like this?"): \`likes(post_id, user_id)\` partitioned by post with buckets for hot posts, plus a per-user recent-likes cache for rendering hearts. A like is an idempotent upsert, so double taps are harmless.
- *Aggregate:* sharded counters (N sub-keys for a hot post, chosen at random), coalesced in memory for ~1 s per process and flushed (details in design-more Distributed Counters). Reads sum the shards, cached for 1–2 s.
- *Jumping count:* different replicas and caches return different sums. Make the display **monotonic** per client (never show less than the last value) and round it ("2.1M").

**Comments.**
- \`comments(post_id, bucket, comment_id, ...)\`, with buckets by time window so a viral post's partition stays bounded.
- Write path: accept, show it to the author immediately, run the spam/toxicity classifier asynchronously, then make it visible to others.
- Read path: viewers mostly want *ranked* top comments, not all 150K. Maintain a precomputed top-50 per post (likes on the comment, author relationship, recency), refreshed every few seconds and cached. "View all" paginates by cursor within buckets.

**Notifications.**
- Events → Kafka keyed by **recipient**. An aggregator keeps a window per (recipient, post, type) (start ~1 minute, growing to 10–30 minutes while the burst continues) and emits a single "*X and 1.9M others liked your post*".
- Per-recipient caps (e.g. ≤ 1 push per post per 10 minutes), quiet hours, and a collapse ID so the OS replaces rather than stacks.
- The in-app activity row is updated in place; it does not create 2M rows.

**Protecting everyone else.** Engagement writes go through a queue, so a burst on one post cannot exhaust DB connections for the rest of the product.`,
      followUps: [
        {
          q: 'The celebrity likes a fan\'s comment. Is that one notification or part of an aggregate?',
          a: 'One immediate notification: the recipient is the fan, whose window is empty, and the actor\'s importance (verified, followed by the fan) is a priority signal. Aggregation keys on the recipient, so the celebrity\'s burst does not delay the fan\'s notification. Ranking notifications by actor affinity is also why a user sees "your friend liked" ahead of "1,000 others".',
        },
        {
          q: 'Unlike events arrive before the matching like events because of partition lag. What does the counter do?',
          a: 'Key like/unlike events by (post, user) so they stay ordered in one partition, or make the operation state-based: the per-user row stores \`liked=true/false\` with a version, and the counter changes only when the row actually flips (upsert returns the previous state). An unlike for a row that does not exist is a no-op, and the later like applies once. Reconciliation recounts hot posts from the per-user table periodically.',
        },
      ],
      pitfalls: [
        'UPDATE posts SET likes = likes + 1 on the hot row',
        'Sending one push per like',
        'Loading all 150K comments to compute the top ones',
      ],
    },
    {
      id: 'design-apps-iq-07',
      difficulty: 'hard',
      question:
        'Design the path from cart to a delivered order for a food-delivery app, concentrating on payment, restaurant acceptance, cancellations and refunds. I care less about maps.',
      context:
        'Reported for Swiggy system design rounds (candidate reports compiled by DesignGurus, 2025–26): "the hard parts are payment, restaurant acceptance, cancellation and refunds, so a state machine is the usual answer".',
      whatInterviewerLooksFor: [
        'A price quote frozen at checkout and idempotent order creation',
        'Asynchronous payments (UPI) with webhooks plus reconciliation',
        'An explicit state machine with conditional transitions and an outbox',
        'A durable restaurant-acceptance timeout with escalation',
        'Idempotent refunds recorded in a ledger',
      ],
      modelAnswer: `**Cart & quote.** A server-side cart in Redis (single restaurant). Checkout calls pricing: items + taxes + packaging + delivery fee (distance, surge, rain) + platform fee − offers. It returns a \`quoteId\` valid ~10 minutes, so the charged amount equals the displayed one.

**Place.** \`POST /orders\` with an Idempotency-Key → \`orders(PAYMENT_PENDING)\` with \`UNIQUE(customer_id, idempotency_key)\`. A payment intent is created with the order ID as the PSP reference.

**Pay.** UPI is asynchronous. The webhook (signature checked, deduped by PSP event ID) moves \`PAYMENT_PENDING → PLACED\` via a conditional update plus an outbox event. A reconciler polls the PSP at 2/5/15 minutes for stuck orders. Paid but late (restaurant now closed) → automatic refund; failed → PAYMENT_FAILED.

**State machine.** PLACED → ACCEPTED → PREPARING → READY → PICKED_UP → DELIVERED, with CANCELLED as a branch. Transitions are a table, and each is \`UPDATE ... WHERE status = ANY(allowed) AND version = v\`. Events are deduped by ID, and side effects (notify, dispatch, payout) go out through the outbox.

**Restaurant acceptance.** A durable timer row at PLACED. At ~45 s: loud tablet alert plus an IVR call. At ~90 s: a conditional transition PLACED → CANCELLED (reason ACCEPT_TIMEOUT) and a full refund. A late accept loses the race cleanly and the tablet shows "cancelled". Restaurants with repeated misses are auto-paused from listings.

**Cancellations.** State-dependent policy: free before acceptance; a fee after acceptance (food is in progress, and the restaurant may be compensated); after pickup, refunds only for platform-caused failures. Every cancel records a reason code, because it drives who pays.

**Refunds.** \`refunds(order_id, reason | item_id)\` UNIQUE, so one refund per cause. The PSP call carries the refund row ID as its idempotency key. The source is chosen by the user (instant wallet credit vs bank in 5–7 days). Ledger entries reverse the restaurant payout or debit the restaurant when it was at fault.

**Consistency.** Order and money are strongly consistent in one relational cluster (orders are ~100–200/s even at peak); tracking and listing are eventual.`,
      followUps: [
        {
          q: 'The restaurant accepts, then 10 minutes later says an item is out of stock. What does the flow look like?',
          a: 'A new event \`ITEM_UNAVAILABLE(itemIds)\` from the restaurant in ACCEPTED/PREPARING. The order goes to a sub-state \`AWAITING_CUSTOMER\` with a short timer (~3 min): the customer can accept a partial order (partial refund per item, idempotent per item ID) or cancel for free (full refund, restaurant charged per policy). If the timer expires, apply the default (usually proceed with the remaining items if they are above a value threshold). Dispatch is told to hold or adjust the pickup time.',
        },
        {
          q: 'Why not let the payment service own the order status, since it already knows when money arrived?',
          a: 'Single writer per aggregate. If payments and orders both write \`orders.status\`, you get lost updates and two places to reason about. The payment service owns payment state (intent, captured, refunded) and emits events; the order service alone applies the transition \`PAYMENT_PENDING → PLACED\`. This also makes it possible to swap PSPs or route across several without touching order logic.',
        },
        {
          q: 'How do you prove to finance that no paid order was lost last month?',
          a: 'Daily three-way reconciliation: the PSP settlement report (every captured payment) against our payments table against orders. Every captured payment must map to an order that is DELIVERED, or CANCELLED with a matching refund. Mismatches go to an exception queue (auto-refund if older than N hours and no order). The double-entry ledger must balance to zero per order. Track "captured without order" as a paging metric, not a monthly surprise.',
        },
      ],
      pitfalls: [
        'Calling the PSP inside the DB transaction',
        'Treating the payment callback as reliable and synchronous',
        'An in-memory setTimeout for the acceptance SLA',
        'Updating status unconditionally, so a late event moves an order backwards',
      ],
    },
    {
      id: 'design-apps-iq-08',
      difficulty: 'expert',
      question:
        'Design delivery-partner assignment: find a partner near the restaurant, offer the order, and handle declines and timeouts. Then tell me how you would make it smarter than "nearest available partner".',
      context:
        'Reported for Swiggy design rounds and described in candidate compilations (DesignGurus, 2025–26) as the signature Swiggy question; DoorDash\'s DeepRed and Swiggy\'s Just-in-Time assignment are the public reference points.',
      whatInterviewerLooksFor: [
        'A correct offer/accept protocol with no double assignment',
        'Assignment timed to the predicted food-ready time, not the order time',
        'Batch optimisation per zone with a cost function, and pruning to make it tractable',
        'Batching/stacking with an explicit cap on added delay',
        'Handling declines, timeouts and supply shortage',
      ],
      modelAnswer: `**Baseline protocol.**
1. Order ACCEPTED → the dispatcher knows the predicted ready time \`R\`.
2. Candidates: idle partners or partners finishing soon within k rings of H3 cells around the restaurant (latest location from Redis, age < 30 s).
3. Offer to the best candidate: \`offer:{orderId}\` = {offerId, partnerId}, TTL 20 s; the partner is soft-locked.
4. Accept = a Lua compare-and-set: the offer exists, the offerId matches, and the order is not yet assigned → set the assignment; then a conditional DB update. A late tap after the TTL gets "offer expired".
5. Decline/timeout → exclude that partner and re-offer. After 3 failures, widen the radius or add an incentive; after N minutes, alert ops and update the customer's ETA.

**Smarter: just in time.** The nearest partner now is wrong if food is ready in 18 minutes and the partner is 4 minutes away: they would wait 14 minutes at the restaurant (Swiggy built JIT assignment to remove this). Plan an assignment time \`R − travelTime(partner → restaurant)\`.

**Smarter: batch optimisation.** Every ~30 s per zone, collect orders due for assignment and partners (idle, plus about to finish a drop: Swiggy's Next Order Assignment). Build a sparse bipartite graph (k ≈ 20–30 nearest partners per order). Edge cost = α·partner wait + β·food wait + γ·lateness vs promise + δ·travel + ε·P(decline). Solve min-cost matching (Hungarian on small zones, MIP as in DoorDash's DeepRed). Some orders may be left for the next round if a better partner becomes free soon.

**Stacking.** Add "bundle" nodes: 2 orders from the same or nearby restaurants with compatible drop directions, allowed only if each order's added delay ≤ ~5–8 minutes and stays within its promise.

**Shortage.** When zone stress is high: raise partner incentives, widen ETAs, shrink serviceability for new orders, and prioritise already-accepted orders over new ones.

**Scale.** Dispatch is sharded by city and zone (one leader per zone, state in Redis), and each round has a time budget with a greedy fallback.`,
      followUps: [
        {
          q: 'Partners in one area keep declining long-distance orders, so those orders wait 15 minutes. What do you change?',
          a: 'Make acceptance part of the model and the price: predict P(accept | distance, payout, partner history) and include it in edge costs, so the solver stops offering those orders to partners who will predictably decline. For hard orders, attach a dynamic incentive (a long-distance bonus funded by the long-distance fee), offer to several partners at once only as a last resort (first accept wins via CAS), and show customers a realistic ETA at checkout. Track decline reasons from the app.',
        },
        {
          q: 'How do you evaluate a new cost function before rolling it out to a city?',
          a: 'Replay first: a simulator fed with recorded order/partner traces for a week (including prep-time and travel predictions vs actuals), comparing delivery time, partner idle time, lateness and cost per order. Then A/B by **switchback** (alternate the algorithm by zone and time slot), because orders and partners in one zone interact, so per-user randomisation leaks between groups. DoorDash describes this simulation-plus-switchback approach for dispatch.',
        },
      ],
      pitfalls: [
        'Assigning the nearest partner at order time',
        'Assignment without a fenced offer ID, so late accepts double-assign',
        'A dense all-pairs matrix for the whole city every round',
      ],
    },
    {
      id: 'design-apps-iq-09',
      difficulty: 'hard',
      question:
        'On rainy weekday evenings in Bengaluru, our app shows "30 min" but the median actual delivery takes 41 minutes, and cancellations double. Diagnose and redesign how ETA is predicted, shown and updated.',
      whatInterviewerLooksFor: [
        'Decomposes ETA into components and finds which ones are biased in rain',
        'Uses quantiles and a calibration target, not the mean',
        'Updates ETA at milestones with bounded changes',
        'Connects ETA to serviceability and fees (do not take orders you cannot serve)',
      ],
      modelAnswer: `**Decompose (Swiggy's formulation).** Delivery time = max(assignment delay + first mile, prep time) + last mile + handover buffers. Log each component's predicted vs actual per order and slice by weather, zone and hour. In rain, typically:
- *Assignment delay* explodes: fewer partners online and slower trips → no free partner.
- *First and last mile* slow down: travel speed drops, and the traffic model may not know it is raining.
- *Prep* is usually stable, though dinner peak load can raise it.

**Fix the models.**
- Add weather (live rain intensity per H3 cell) and zone stress as features for travel and assignment delay; predict assignment delay explicitly from the open-orders ÷ free-partners ratio.
- Predict **quantiles** (P50 and P80 via quantile regression or gradient boosting with a quantile loss) and show P75–P80, so we are late ~20–25% of the time by design. Swiggy describes the trade-off as the "Goldilocks" value: too low breaks trust, too high loses orders.
- Calibrate continuously: monitor the fraction delivered within the shown ETA per city/hour; retrain or adjust offsets automatically when it drifts.

**Act upstream.** If the predicted P80 exceeds the product limit (say 50 minutes), the restaurant should not be listed as serviceable for that address: shrink the radius, add the rain fee (which funds partner incentives), and stop listing far restaurants.

**Update and communicate.** Recompute at milestones (accepted, partner assigned, picked up) and on drift (traffic). Smooth the display (change only by ≥ 3 minutes, never yo-yo) and explain it ("heavy rain in your area"). Proactive compensation (a coupon) when the delay is the platform's fault reduces cancellations.

**Measure.** Calibration (% on time), mean absolute error, cancellation rate after ETA changes, and conversion at the listing, since a too-pessimistic ETA also costs orders.`,
      followUps: [
        {
          q: 'Should the ETA promised at checkout be personalised, for example longer for a customer with a history of hard-to-find addresses?',
          a: 'Yes for the last-mile buffer: address-level features (gated community, high-floor apartment, past handover time at this address) improve accuracy and are legitimate. Be careful with fairness and transparency: features must be about the delivery location, not about the person, and never a proxy for neighbourhood income. Cache per-address handover-time estimates; new addresses fall back to cell-level averages.',
        },
        {
          q: 'Restaurants game "food ready" by tapping it early to look fast. How does that corrupt ETA, and what do you do?',
          a: 'The prep-time labels become wrong (too short), so the model learns to under-predict prep, partners arrive early and wait, and ETAs are optimistic. Derive the true ready time from partner signals instead (time between arrival in the restaurant geofence and pickup, minus queueing), weight restaurant taps by a per-restaurant reliability score, and flag outliers. Use the corrected label for training.',
        },
      ],
      pitfalls: [
        'Showing the mean ETA and calling the model accurate',
        'Treating ETA purely as a maps/travel-time problem',
        'Changing the shown ETA on every location ping',
      ],
    },
    {
      id: 'design-apps-iq-10',
      difficulty: 'medium',
      question:
        'Restaurants change items, prices and availability all day, especially "out of stock" toggles during dinner. Customers keep adding items that are no longer available and fail at checkout. Design the menu catalog and availability system for about 3 lakh restaurants.',
      context:
        'Candidates report catalog/menu design (items, variants, add-on groups) in Swiggy rounds (DesignGurus compilation, 2025–26).',
      whatInterviewerLooksFor: [
        'Separation of the slow-changing menu from fast-changing availability',
        'Versioned, cacheable menu documents with CDC-driven invalidation',
        'A schema that handles variants and add-on groups with constraints',
        'Validation at checkout as the source of truth',
      ],
      modelAnswer: `**Data model.** \`restaurant → categories → items\`; \`item → variant groups\` (size: small/medium/large, pick exactly 1) and \`add-on groups\` (toppings: pick 0–3), each option with a price delta. Constraints such as min/max per group are stored with the group and validated server-side. Prices are integers in paise with a tax class.

**Write path.** The restaurant portal/POS writes to a catalog DB (Postgres, sharded by restaurant). Each change bumps \`menu_version\`. CDC (Debezium → Kafka) rebuilds a denormalised **menu document** per restaurant (JSON, ~50–200 KB) into a document store or object storage.

**Read path.** \`GET /menu/{rid}\` returns the document by version, cached in the app and at the CDN with key \`rid:version\`; the listing response carries the current version, so clients fetch a new menu only when it changed. That serves millions of menu views at dinner with near-zero DB load.

**Availability is separate.** A tiny structure per restaurant: \`avail:{rid}\` as a hash or bitmap of unavailable item/option IDs plus the restaurant's open/paused flag, in Redis. Toggles write there directly (and to the DB for audit). The app fetches it with the menu and refreshes it on cart open and every ~30–60 s while browsing; a push channel can invalidate it for an open menu.

**Checkout validation.** The cart → quote call re-validates every item, option, price and availability against the source of truth. Mismatches return a structured diff ("Paneer tikka is now unavailable", "price changed from ₹249 to ₹269") so the UI fixes the cart before payment, never after.

**Bulk updates** (a chain changes prices across 2,000 outlets) are a job that writes in batches and bumps versions gradually, to avoid a cache-miss storm.

**Scale.** 3 lakh restaurants × 150 KB ≈ 45 GB of documents: trivially cacheable. Availability for all of them fits in a few GB of Redis.`,
      followUps: [
        {
          q: 'A restaurant toggles 40 items off and on every few minutes during peak, and each toggle bumps the menu version and invalidates caches. What do you change?',
          a: 'Toggles must not bump \`menu_version\` at all; they write only to the availability structure. If a restaurant toggles excessively, debounce (coalesce changes within 5 s) and consider auto-pausing items predicted to run out. Only structural changes (new item, price, description) bump the version.',
        },
        {
          q: 'Should prices in the cached menu be trusted for the payment amount?',
          a: 'No. The cached menu is for display; the pricing service computes the payable amount from the catalog DB (or a strongly consistent cache keyed by version) at quote time, and the quote ID freezes it. That makes stale caches a UX issue (the cart shows a price change) rather than a revenue or fraud issue (a client tampering with prices).',
        },
      ],
      pitfalls: [
        'Putting availability inside the cached menu document',
        'Relying on the cache at checkout',
        'Modelling variants as separate items, which breaks add-on rules and reporting',
      ],
    },
    {
      id: 'design-apps-iq-11',
      difficulty: 'expert',
      question:
        'It is 8:30 p.m. on a cricket-final night. UPI success rates at your primary payment gateway drop from 97% to 70%, thousands of orders sit in PAYMENT_PENDING, and customers retry, some getting charged twice. What do you do in the next 30 minutes, and what should the system have done automatically?',
      whatInterviewerLooksFor: [
        'Stops the bleeding: routing away, hiding failing methods, preventing duplicate charges',
        'A reconciliation design for pending payments and automatic refunds',
        'Idempotency across retries and multiple PSPs',
        'Clear customer communication and protection of the restaurant side',
      ],
      modelAnswer: `**Next 30 minutes (incident).**
1. **Route away:** a payment router with per-PSP, per-method success-rate SLOs (5-minute window) shifts UPI traffic to the secondary PSP. If both degrade, hide UPI collect, keep intent/cards/wallets, and show a banner.
2. **Stop double charges:** the client must reuse the same order (and Idempotency-Key) on "retry payment"; the server returns the existing PAYMENT_PENDING order and **checks its status at the PSP first** before creating a new intent. A new intent for the same order is allowed only after the previous one is confirmed failed or expired.
3. **Drain pending:** run the reconciler aggressively: query each PSP for every pending order older than 2 minutes. Paid → PLACED (if the restaurant is still open and the ETA acceptable) or an automatic refund; failed → PAYMENT_FAILED with a clear message.
4. **Refund duplicates:** for orders with two captured payments, automatically refund the later one (idempotent per payment ID) and notify the user.
5. **Protect restaurants:** an order is never sent to the kitchen before PLACED, so restaurants see none of this.

**What should be automatic.**
- Circuit breaker plus smart routing per PSP/method/bank (UPI failures are often bank-specific).
- Every payment intent stores \`(orderId, attempt, pspRef)\`; at most one *live* intent per order; payments are captured only if the order is still placeable, otherwise auto-refunded.
- Webhooks deduped by PSP event ID; polling at 2/5/15/60 minutes; a hard deadline after which a pending payment becomes "expire and refund if captured later".
- Daily three-way reconciliation (PSP settlement ↔ payments ↔ orders), plus a real-time metric for "captured without order" that pages.
- Load shedding that protects the payment-callback endpoint above everything else at peak.

**Customer communication.** "Payment pending: we will confirm in 2 minutes; if money was deducted without an order, it is refunded automatically". This reduces panic retries, which drive most duplicates.`,
      followUps: [
        {
          q: 'The secondary PSP has a lower rate limit (500 TPS) than the traffic you want to shift (900 TPS). How do you route?',
          a: 'Weighted routing up to the secondary\'s safe capacity (say 450 TPS with headroom), the rest stays on the primary (70% success is better than 0%). Prioritise new orders with higher AOV or repeat customers on the healthier route, and push cards/wallets in the UI to reduce UPI share. Use a token bucket per PSP in the router; never let retries amplify load on the degraded PSP (retry budget, no immediate client re-submit).',
        },
        {
          q: 'A webhook says "success" for an order you already auto-cancelled and refunded after the deadline. Now what?',
          a: 'The order stays CANCELLED (terminal states do not reopen). The payment service sees a capture for an order that is not placeable and issues a refund for that payment ID, idempotent so a second webhook does nothing. Ledger: capture entry + refund entry. Notify the customer. Measure how often late captures happen per PSP; if frequent, extend the deadline for that PSP.',
        },
      ],
      pitfalls: [
        'Asking customers to retry, which creates new orders and new intents',
        'Retrying a debit automatically',
        'Sending orders to restaurants before payment is confirmed',
      ],
    },
    {
      id: 'design-apps-iq-12',
      difficulty: 'hard',
      question:
        'Model order fulfilment as a set of dependent steps (charge, notify restaurant, assign partner, pick up, deliver) where any step that misses its deadline triggers a compensating refund. Design the workflow engine and the refund logic so that no customer is refunded twice and no completed step is undone incorrectly.',
      context:
        'PracHub lists DoorDash system design reports in 2025–2026 that frame order processing as a DAG with completion and timeout refunds (e.g. "Process Orders Through a DAG with Completion and Timeout Refunds", "Design a Refund Workflow as a Directed Acyclic Graph").',
      whatInterviewerLooksFor: [
        'Persisted workflow state with per-step status and deadlines',
        'Durable timers and idempotent step execution',
        'Compensation semantics: what can be undone and in which order',
        'Exactly-one refund per cause, and races between completion and timeout',
      ],
      modelAnswer: `**Model.** A workflow definition is a DAG: \`charge → notifyRestaurant → {assignPartner ∥ prepare} → pickup → deliver\`. Each node has a handler, a deadline (relative to its start or to the order), a retry policy and an optional compensation (\`charge\` ↔ \`refund\`, \`assignPartner\` ↔ \`releasePartner + pay cancellation fee\`).

**State.** \`workflow(order_id, status, version)\` and \`step(order_id, name, status: PENDING|RUNNING|DONE|FAILED|TIMED_OUT|COMPENSATED, attempt, deadline_at)\`. A step becomes runnable when all its parents are DONE; the engine enqueues it (outbox → queue) with key \`orderId:step:attempt\`.

**Execution.** Workers are idempotent: each handler passes a deterministic idempotency key to external systems (PSP, partner service). Completion is a conditional update: \`UPDATE step SET status='DONE' WHERE ... AND status='RUNNING'\`.

**Timeouts.** Durable timers on \`deadline_at\` (DB polling with SKIP LOCKED, or a workflow engine such as Temporal). The timer handler does \`UPDATE step SET status='TIMED_OUT' WHERE status IN ('PENDING','RUNNING')\`. If a late completion already set DONE, the timeout is a no-op, and vice versa: exactly one of them wins.

**Compensation.** On a terminal failure, mark the workflow COMPENSATING and run compensations for DONE steps in **reverse topological order**. Refund is the compensation of \`charge\`; it creates \`refunds(order_id, cause)\` with a UNIQUE constraint and calls the PSP with the refund ID as the idempotency key. Partial refunds (one item missing) are keyed per item. Some steps are not compensatable (food already cooked), so the policy decides who absorbs the cost (restaurant paid, customer refunded, platform loss recorded in the ledger).

**Safety nets.** A reconciler compares workflows stuck beyond their final deadline against PSP state. Metrics: refunds per order (must be ≤ 1 per cause), compensation failures and DLQ depth.`,
      followUps: [
        {
          q: 'Pickup happened (the partner scanned the bag) but the event reached you after "pickup" had already timed out and compensation started. What now?',
          a: 'Physical reality wins over the timer. The pickup event is evidence; the engine should treat a DONE-after-TIMED_OUT as a conflict that pauses compensation for human or rule review rather than refunding blindly. To prevent it, make deadlines for physical steps soft: on timeout, first query the partner app/location state (is the partner at the restaurant? has the bag been scanned?) before declaring failure.',
        },
        {
          q: 'Would you build this engine or use Temporal/Cadence/Step Functions?',
          a: 'Use one unless there is a strong reason not to: durable timers, retries, history and versioning are subtle to get right. The trade-offs are operational (running the Temporal cluster, or AWS lock-in with Step Functions), workflow-code determinism constraints, and cost per state transition at millions of orders a day. Keep business state (orders, refunds, ledger) in your own DB either way; the engine orchestrates and is not the system of record.',
        },
      ],
      pitfalls: [
        'Refunding inside the timeout handler without checking whether the step completed',
        'Compensating in forward order or compensating steps that never ran',
        'Treating every step as reversible',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-apps-boe-1',
      question:
        'Estimate Instagram\'s daily image egress and the peak bandwidth that must reach origin storage behind the CDN, for 500M DAU.',
      assumptions: [
        '500M DAU; each views ~100 images per day (feed, profiles, Explore thumbnails)',
        'Average served rendition ≈ 150 KB (mix of 1080 px feed images and small thumbnails, WebP)',
        'Peak hour runs at 2× the daily average rate',
        'CDN hit ratio 95% (immutable rendition keys, long TTLs)',
      ],
      steps: [
        { label: 'Daily egress', calc: '500M × 100 × 150 KB = 7.5 × 10^15 B ≈ 7.5 PB/day' },
        { label: 'Average bandwidth', calc: '7.5 × 10^15 B × 8 ÷ 86,400 s ≈ 6.9 × 10^11 bit/s ≈ 694 Gbps' },
        { label: 'Peak bandwidth at the edge', calc: '694 Gbps × 2 ≈ 1.4 Tbps' },
        { label: 'Origin (miss) traffic', calc: '5% × 694 Gbps ≈ 35 Gbps avg; 5% × 1.4 Tbps ≈ 70 Gbps at peak' },
      ],
      answer:
        '≈ 7.5 PB/day of image egress (~0.7 Tbps average, ~1.4 Tbps at peak), of which only ~35–70 Gbps should reach the renditions bucket if the CDN hit ratio holds at 95%.',
      insight:
        'Egress, not the database, is the cost and capacity driver. Every lever that shrinks bytes (renditions sized to the device, WebP/AVIF, never serving originals) or raises the hit ratio (immutable keys, an origin shield tier) is worth more than any DB optimisation. A drop in hit ratio from 95% to 90% doubles origin load, so watch it as a first-class SLO.',
      followUps: [
        {
          q: 'A client bug starts requesting the 1080 px rendition (avg 300 KB) for every thumbnail as well. What changes?',
          a: 'If thumbnails were roughly half the image views, the average served size rises from ~150 KB to ~225–300 KB, so egress goes from 7.5 to ~11–15 PB/day, ~1.0–1.4 Tbps average. Origin traffic barely changes (the 1080 renditions are already cached), but the CDN bill grows ~1.5–2× and mobile users on slow networks see slower feeds. That is why the rendition choice is server-driven (the API returns the URL to use), so a bad client cannot pick oversized images.',
        },
        {
          q: 'Finance asks you to cut image egress cost by 30% without hurting quality. Which assumption do you attack?',
          a: 'The 150 KB average: moving from WebP to AVIF typically saves ~20–30% at equal perceived quality, and device-aware widths (a 720 px-wide phone does not need 1080 px) save more. Second, the 100 images/day assumption: lazy-loading and not prefetching items below the fold cuts wasted downloads. The hit ratio affects origin, not CDN egress billing, so it matters less here.',
        },
      ],
    },
    {
      id: 'design-apps-boe-2',
      question:
        'Size the storage and write throughput for Stories "seen by" records, which must stay readable for 48 hours after a story is posted.',
      assumptions: [
        '250M daily Stories viewers, each watching ~30 stories per day',
        'Peak write rate 3× average (evening, live events)',
        '~50 bytes per view record on disk (story ID, viewer ID, timestamp, overhead), after deduplication',
        'Retention 48 h from posting; replication factor 3',
      ],
      steps: [
        { label: 'View records per day', calc: '250M × 30 = 7.5 × 10^9 views/day' },
        { label: 'Average write rate', calc: '7.5 × 10^9 ÷ 86,400 ≈ 86.8K writes/s' },
        { label: 'Peak write rate', calc: '86.8K × 3 ≈ 260K writes/s' },
        { label: 'Bytes per day', calc: '7.5 × 10^9 × 50 B = 375 GB/day' },
        { label: 'Hot data retained', calc: '48 h ⇒ 2 days × 375 GB = 750 GB; × RF 3 ≈ 2.25 TB' },
      ],
      answer:
        '~87K view writes/s on average and ~260K/s at peak, but only ~750 GB of live data (~2.25 TB with replication), because everything expires after 48 hours.',
      insight:
        'This is a write-throughput problem with a tiny, rolling dataset: an LSM/wide-column store partitioned by story with TTL'
        + ' (cheap expiry via compaction), or Redis for the hottest window, fits; a B-tree OLTP table with DELETE-based cleanup would'
        + ' suffer at 260K writes/s and constant deletes. Since storage is small, spend effort on partitioning hot stories (celebrity'
        + ' buckets) rather than on capacity.',
      followUps: [
        {
          q: 'Product extends viewer-list retention to 30 days for creator analytics. What breaks first?',
          a: 'Storage grows 15× (30 days ÷ 2 days): 375 GB × 30 ≈ 11.3 TB, ~34 TB with RF 3. Still modest, but celebrity partitions now hold a month of views and reads over them become expensive. Better: keep the raw list at 48 h and roll up into per-story aggregates (unique viewers via HLL, demographics, follower/non-follower splits) for the 30-day analytics, which are a few KB per story.',
        },
      ],
    },
    {
      id: 'design-apps-boe-3',
      question:
        'Using Zomato\'s published FY25 numbers, estimate peak-hour order writes, discovery reads and partner location pings for an Indian food-delivery platform, and decide what needs sharding.',
      assumptions: [
        '853M food orders in FY25 (Zomato annual report) ⇒ daily average',
        'Dinner window of 2 hours carries ~30% of daily orders; the peak minute is ~2× the window average',
        '~125 listing/menu/search API calls per order placed (browsing without ordering included)',
        '4.73 lakh delivery partners; ~40% online at dinner; one ping every 4 s',
      ],
      steps: [
        { label: 'Orders per day', calc: '853M ÷ 365 ≈ 2.34M orders/day' },
        { label: 'Dinner order rate', calc: '2.34M × 0.30 ÷ 7,200 s ≈ 97 orders/s; peak minute ≈ 2 × 97 ≈ 195/s' },
        { label: 'Discovery reads at peak', calc: '195 orders/s × 125 ≈ 24K QPS' },
        { label: 'Online partners', calc: '4.73 lakh × 0.40 ≈ 1.9 lakh (189K)' },
        { label: 'Location pings', calc: '189K ÷ 4 s ≈ 47K writes/s' },
      ],
      answer:
        'Orders: ~100 per second on average at dinner and ~200 at the peak minute; discovery: ~24K read QPS; partner pings: ~47K writes/s.',
      insight:
        'The money path is tiny, so keep orders and payments in one strongly consistent relational cluster (sharded by order ID or'
        + ' city only for headroom) and spend effort on correctness. The volume is in reads (cache listings per H3 cell, menus by'
        + ' version on the CDN) and pings (in-memory latest-location store sharded by city, history to Kafka). Dispatch CPU scales'
        + ' with partners × orders per zone, so city/zone is the natural shard and bulkhead.',
      followUps: [
        {
          q: 'A cricket-final night produces 3× normal dinner orders in a 30-minute window. What breaks first?',
          a: 'Orders: 2.34M × 0.30 × 3 compressed into 30 min ≈ 2.1M orders ÷ 1,800 s ≈ 1,170/s, about 6× the normal peak minute, which is still manageable for a sized OLTP cluster. What breaks first is **partner supply**: online partners do not triple, so assignment delay and ETAs explode. Serviceability must throttle (shrink radius, raise fees, pause zones) before orders are accepted that cannot be delivered; the second pressure point is the dispatch solver round time.',
        },
      ],
    },
    {
      id: 'design-apps-boe-4',
      question:
        'A dispatcher solves one assignment round for a whole metro every 30 seconds. At dinner peak there are 1,500 orders waiting for assignment and 2,500 candidate partners. Estimate the cost of a dense optimal assignment and design a round that fits the time budget.',
      assumptions: [
        'Hungarian algorithm is O(n³) on an n × n matrix; ~10^9 simple operations per second on one core',
        'Round budget: ≤ 5 s of solve time (the rest is data fetching, offers and slack)',
        'Travel times come from a precomputed H3 cell-to-cell matrix (≈ 1 µs per lookup)',
        'Pruning: keep only the k = 25 nearest partners per order; split the city into 10 zones of ~150 orders × 250 partners',
      ],
      steps: [
        { label: 'Dense cost matrix', calc: '1,500 × 2,500 = 3.75M pairs; lookups ≈ 3.75M × 1 µs ≈ 3.75 s just to build it' },
        { label: 'Dense Hungarian', calc: 'n = 2,500 (padded square): 2,500³ ≈ 1.56 × 10^10 ops ≈ 15.6 s > 5 s budget' },
        { label: 'Pruned graph', calc: '1,500 × 25 = 37,500 edges ⇒ ~1% of the dense matrix, built in ~40 ms' },
        { label: 'Zone-partitioned solve', calc: '10 zones × 250³ = 10 × 1.56 × 10^7 ≈ 1.56 × 10^8 ops ≈ 0.16 s (parallel across zones: ~16 ms each)' },
      ],
      answer:
        'A dense city-wide optimum costs ~15 s of solve time plus ~4 s of matrix building, which blows the 30-second cadence once fetching and offers are included. Pruning to k = 25 and solving 10 zones independently brings it to well under a second.',
      insight:
        'Optimal over the whole city is the wrong goal: partners more than a few km away are never good candidates, so the graph is naturally sparse and local. Partition by zone (with overlapping borders, or a second pass for border orders), prune by k-nearest, and use a sparse min-cost-flow or MIP solver per zone with a greedy fallback when a round overruns. That is also how dispatch scales horizontally: one worker per zone.',
      followUps: [
        {
          q: 'Batching is enabled: every pair of compatible orders becomes a "bundle" node. How does the problem size change?',
          a: 'Naively, bundles grow quadratically: 150 orders per zone ⇒ 150 × 149 ÷ 2 ≈ 11K pairs. Restrict them to the same restaurant or a pickup cluster within ~500 m and drops within a small heading angle, which typically leaves tens to a few hundred bundles per zone. The bundle and single-order choice then becomes a set-partitioning MIP (each order in exactly one chosen option), which is why DoorDash uses a MIP solver rather than plain matching; give it a time limit and accept the best feasible solution.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'design-apps-mcq-01',
      difficulty: 'hard',
      question:
        'This endpoint hands mobile clients a presigned URL for photo uploads to the bucket that the media workers read from. Which issue is the most serious?',
      code: {
        language: 'typescript',
        code: `@Post('uploads')
async sign(@User() u: AuthUser, @Body() b: { filename: string; contentType: string }) {
  const key = \`uploads/\${b.filename}\`;           // e.g. uploads/IMG_2041.jpg
  const url = await getSignedUrl(s3, new PutObjectCommand({
    Bucket: 'ig-raw', Key: key, ContentType: b.contentType,
  }), { expiresIn: 3600 });
  await this.media.insert({ ownerId: u.id, key, status: 'UPLOADING' });
  return { url, key };
}`,
      },
      options: [
        'A one-hour expiry is too long; presigned URLs should expire within 60 seconds of signing',
        'The client-chosen filename becomes the object key, so any user can overwrite another user\'s pending or processed upload',
        'ContentType is taken from the client, so the bucket will store JPEGs with the wrong MIME type for the CDN',
        'Signing on the API pod adds a network round trip to S3 for every upload, which will bottleneck at peak',
      ],
      correct: [1],
      explanation:
        'Keys like uploads/IMG_2041.jpg collide across users (phones reuse names), and a malicious client can deliberately overwrite someone else\'s object before or after processing. Keys must be server-generated (e.g. uploads/{userId}/{mediaId}) and ideally constrained by a size limit too. A shorter expiry reduces replay risk but does not stop overwrites. The client Content-Type is a concern, but workers should sniff magic bytes anyway and never serve raw objects. Presigning is a local HMAC computation with no S3 round trip.',
      followUps: [
        {
          q: 'How do you also cap the upload at 8 MB, given that a presigned PUT does not enforce Content-Length by itself?',
          a: 'Use a presigned POST with a policy containing a \`content-length-range\` condition (0 to 8 MB), which S3 enforces at upload time. Alternatively sign the PUT with a fixed Content-Length header the client must send. Either way, the worker re-checks the size with HEAD before downloading and rejects oversize objects, and a lifecycle rule deletes unreferenced raw objects after 24 h.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-02',
      difficulty: 'expert',
      question:
        'You are designing the image-processing worker for an Instagram-like app. Select ALL statements that are correct.',
      options: [
        'Apply the EXIF orientation to the pixels before stripping metadata; otherwise some portrait photos are served sideways',
        'A SHA-256 of the uploaded file detects re-uploads of the same photo even after it has been screenshotted or recompressed',
        'Stripping metadata from served renditions removes GPS coordinates that could reveal where a user lives',
        'A perceptual hash (pHash/PDQ) lets you match near-duplicates and known-abuse images that differ at the byte level',
        'Because the raw bucket is private, it is safe to let the CDN serve the original upload whenever a rendition is missing',
      ],
      correct: [0, 2, 3],
      explanation:
        'Phones often store pixels in sensor orientation with an EXIF tag; dropping the tag without rotating produces sideways images. Served images must not carry GPS. Perceptual hashes survive resizing and recompression, which is why they are used for near-duplicate and abuse matching. A cryptographic hash changes completely with any byte difference, so screenshots and recompressed copies do not match. Falling back to the original would serve full-size files with EXIF intact, defeating both privacy and egress goals.',
      followUps: [
        {
          q: 'Perceptual-hash matching across 100M uploads a day: how do you look up "within Hamming distance 8" efficiently?',
          a: 'Do not compare against every stored hash. Split the 64- or 256-bit hash into bands (e.g. 8 bands); by the pigeonhole principle, two hashes within distance d < number of bands share at least one identical band. Index each band in a KV store, look up candidates by exact band match, then compute the exact Hamming distance only on that small candidate set. This is the multi-index hashing approach; a vector index (FAISS with binary codes) is another option.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-03',
      difficulty: 'expert',
      question:
        'Post IDs are generated per logical shard as shown. A migration job inserts 3,000 posts into logical shard 5 inside the same millisecond. What happens?',
      code: {
        language: 'typescript',
        code: `const EPOCH = 1314220021721n;
// seq comes from a per-shard Postgres sequence (nextval), monotonically increasing
function makeId(nowMs: bigint, shard: bigint, seq: bigint): bigint {
  return ((nowMs - EPOCH) << 23n) | (shard << 10n) | (seq % 1024n);
}`,
      },
      options: [
        'The IDs remain unique because the Postgres sequence never repeats, and only the 41-bit time component can collide',
        'The shard bits overflow into the time bits once the sequence exceeds 1,024, so later IDs appear to belong to the future',
        'Insertions block until the next millisecond, because the database refuses to hand out more than 1,024 sequence values per millisecond',
        'Sequence values n and n + 1024 produce identical IDs in that millisecond, so inserts start failing on the primary key (or IDs collide silently elsewhere)',
      ],
      correct: [3],
      explanation:
        'Only the low 10 bits of the sequence are kept (seq % 1024), so within one millisecond and one shard at most 1,024 distinct IDs exist; the 1,025th wraps to the same low bits as the 1st. The sequence itself is unique, but the modulo throws that away. The bitwise OR with the modulo cannot overflow into the shard or time bits. Postgres sequences have no per-millisecond limit, so nothing blocks. Normal traffic never hits this (1,024 posts/ms per shard is ~1M/s), but bulk jobs can.',
      followUps: [
        {
          q: 'How do you make the generator safe for bulk jobs without changing the 64-bit layout?',
          a: 'Snowflake-style: track the last millisecond and a per-ms counter in the generator; when the counter reaches 1,024, spin or sleep until the next millisecond. In the PL/pgSQL version, use a per-shard advisory lock (or a single-row table) to serialise the bulk path, or spread the bulk load across many logical shards. Also guard against the clock moving backwards (refuse or wait), which produces the same kind of collision.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-04',
      difficulty: 'hard',
      question:
        'The home feed is re-ranked by an ML model on every request. Paging uses ?cursor=<score of last item>. Users report duplicates and missing posts when scrolling for a few minutes. Which fix addresses the root cause?',
      options: [
        'Switch the cursor to (created_at, post_id), so that the pages are ordered by a field that never changes',
        'Lower the page size from 20 to 10 so that the ranking changes less between two consecutive requests',
        'Freeze the ranked list per feed session (e.g. top ~300 IDs in Redis) and page through it with a signed (session, offset) cursor; refresh starts a new session',
        'Deduplicate on the client by remembering every post ID shown, and request extra pages when duplicates are dropped',
      ],
      correct: [2],
      explanation:
        'Scores change between requests (new engagement, new candidates, model features), so any cursor into a live ranking repeats and skips items. A per-session snapshot makes pages slices of one fixed order. A time-based cursor is stable, but it abandons ranking altogether. Smaller pages reduce the drift without removing it. Client-side dedupe hides duplicates but cannot recover skipped posts.',
      followUps: [
        {
          q: 'The user scrolls for 45 minutes and the 30-minute snapshot expires mid-scroll. What should happen?',
          a: 'Transparently build a new snapshot: re-run candidates and ranking, filter out everything in the seen-state store (including the posts from the expired session), and continue from offset 0 of the new list with a new session ID in the cursor. The user may notice a slight topic change but no duplicates. Alternatively, extend the TTL on each page read (sliding) while the session is active, bounded at a maximum length.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-05',
      difficulty: 'medium',
      question:
        'The ads team wants one ad roughly every 5 posts in the home feed, never two ads from the same advertiser within 20 positions, and budgets that pace across the day. Where should ad insertion happen?',
      options: [
        'In a blending step after organic ranking, which calls the ad server per slot with spacing constraints and the current budget state',
        'At fan-out time, by writing sponsored post IDs into followers\' precomputed timelines alongside organic posts',
        'Inside the organic ranking model, by adding ads as candidates and letting the model decide their positions',
        'On the client, which fetches a batch of ads at startup and inserts them every fifth item while scrolling',
      ],
      correct: [0],
      explanation:
        'Ads need fresh decisions (auction, budget pacing, frequency caps) and hard constraints (spacing, ad load), so they are filled into slots after the organic list is final. Writing ads at fan-out freezes stale decisions into millions of timelines and cannot pace budgets. Letting the organic model place ads cannot enforce hard spacing rules or auction economics. Client-side insertion cannot enforce frequency caps across devices and is easy to tamper with.',
      followUps: [
        {
          q: 'A new user has seen only 8 posts in their first session. Should they see ads at the same rate?',
          a: 'Usually not: ad load is a per-user parameter. New or at-risk users get lower ad load (e.g. first ad after position 10, then every 8), because early retention is worth more than a few impressions. The blender reads the user\'s ad-load tier from a feature store, and experiments tune it. The ad server also enforces global frequency caps per user per advertiser.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-06',
      difficulty: 'expert',
      question:
        'This Lua script records a Stories view. A story is posted at 10:00 on Monday, and people keep viewing it until it expires at 10:00 on Tuesday. Until when does the viewer list for that story survive, and why does it matter?',
      code: {
        language: 'lua',
        code: `-- KEYS[1] = views:{storyId}; ARGV[1] = viewerId; ARGV[2] = now_ms
redis.call('ZADD', KEYS[1], 'NX', ARGV[2], ARGV[1])
redis.call('EXPIRE', KEYS[1], 172800)   -- keep the list for 48 hours
return redis.call('ZCARD', KEYS[1])`,
      },
      options: [
        'Until 10:00 Wednesday, 48 hours after posting, because Redis keeps the first EXPIRE set on a key',
        'Until about 10:00 Thursday: each view resets the TTL, so the list lives 48 h after the last view, which breaks the retention promise and inflates memory',
        'Until 10:00 Tuesday, because Redis deletes keys of expired stories when the story itself expires',
        'Forever, because ZADD with NX clears the TTL on the key whenever a new member is added',
      ],
      correct: [1],
      explanation:
        'EXPIRE overwrites the TTL on every call, so a view just before expiry pushes deletion to ~48 h after that view (Monday 10:00 + ~24 h + 48 h ≈ Thursday 10:00). That violates an absolute retention rule (48 h from posting) and keeps ~1.5× more data in memory. Redis does not keep the first TTL, knows nothing about the story\'s own expiry, and ZADD does not clear a TTL (only commands that overwrite the key, such as SET, do).',
      followUps: [
        {
          q: 'Give two fixes and say which you prefer.',
          a: 'Either compute an absolute deadline from the story\'s created_at and call \`EXPIREAT key created+48h\` (idempotent, the same value every time), or use \`EXPIRE key 172800 NX\` (Redis 7+), which sets the TTL only if none exists, so it is anchored to the first view, not to the post. EXPIREAT from created_at is preferable: it matches the product rule exactly even if the first view comes hours after posting.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-07',
      difficulty: 'hard',
      question:
        'You must render the Stories tray (followees with active stories, unseen first) in < 100 ms for users following up to 7,500 accounts, including celebrities. Select ALL designs that help.',
      options: [
        'On each new story, append the author (not the story) to a per-follower tray signal list for non-celebrity authors, deduped per author',
        'Fan out each new story ID to every follower\'s tray list, including celebrities with hundreds of millions of followers',
        'Keep a per-author active-story ZSET scored by expiry and trim expired members on read',
        'On every app open, run SELECT ... WHERE author_id IN (all followees) AND created_at > now() - 24h on the stories table',
        'Store per viewer the latest story ID seen per author, and order authors with newer stories first',
      ],
      correct: [0, 2, 4],
      explanation:
        'Signalling the author (not each story) keeps fan-out small and bounded, and celebrity authors are pulled at read time. A per-author ZSET with expiry scores makes "is X active?" a cheap check and enforces expiry on read. A per-viewer last-seen map gives the unseen-first ordering. Fanning out every story ID to celebrity audiences is exactly the hot-write problem that hybrid feeds avoid. A 7,500-key IN query against the story table on every open is too expensive at hundreds of millions of opens per day.',
      followUps: [
        {
          q: 'How do celebrities appear in the tray if you never fan out their stories?',
          a: 'At read time, intersect the viewer\'s followed celebrities (a short, cached list, since most users follow few of the ~tens of thousands of celebrity accounts) with a global celebActive set (or check each celebrity\'s active ZSET). That is a few dozen Redis lookups, pipelined, merged with the precomputed signals, then sorted by unseen state and affinity.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-08',
      difficulty: 'expert',
      question:
        'Your hashtag index is partitioned by tag. During a cricket final, one tag takes ~700 new posts/s and ~5K page loads/s, and its shard falls over while others idle. Which redesign is best?',
      options: [
        'Partition the whole index by post ID, so that every hashtag query fans out to all shards and the load spreads evenly',
        'Add five more read replicas for the hot shard and route all hashtag reads to them',
        'Detect hot tags and split their postings by (tag, time bucket, salt); serve Recent from cached newest buckets and Top from a precomputed per-tag list',
        'Rate-limit posting with that hashtag to 100 posts/s globally and return an error to the rest',
      ],
      correct: [2],
      explanation:
        'Splitting only hot tags spreads their writes across partitions while keeping cold tags single-shard. Recent then reads a bounded number of newest buckets, cached for a few seconds, and Top is precomputed, so reads collapse too. Document partitioning makes every query for millions of cold tags scatter-gather: an expensive fix for a rare problem. Replicas help reads but leave all 700 writes/s on one primary, and index refresh on replicas still suffers. Rejecting legitimate posts during the biggest event of the year is a product failure.',
      followUps: [
        {
          q: 'How do you detect a hot tag quickly without counting every tag exactly?',
          a: 'A streaming job over the post-published topic maintains a Count-Min Sketch (or Space-Saving top-K) per 1-minute window. Any tag whose estimated rate crosses a threshold (e.g. 50 posts/s) is written to a "split tags" config that the indexer reads, with hysteresis so tags do not flap between split and unsplit. The same top-K feed powers "trending" UI.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-09',
      difficulty: 'hard',
      question:
        'A celebrity\'s post gets 2M likes in ten minutes. The notification service sends one push per like event and the celebrity\'s phone becomes unusable. What is the best redesign?',
      options: [
        'Key events by recipient, aggregate per (recipient, post, type) over a growing time window, emit "X and N others", cap pushes per recipient and use a collapse ID',
        'Drop like notifications for any account with more than 1M followers and send nothing for likes',
        'Sample 1% of like events and send a push for each sampled event',
        'Batch all notifications globally and send them every 10 minutes to every user',
      ],
      correct: [0],
      explanation:
        'Aggregating per recipient and post turns millions of events into a handful of updates, the cap protects the device, and the collapse ID makes the OS replace rather than stack. Silencing big accounts loses useful signals (e.g. when a close friend likes the post). Sampling still sends ~20K pushes and the count is wrong. Global batching delays every user\'s notifications, including the small accounts for which a single like is the event.',
      followUps: [
        {
          q: 'The aggregator crashes mid-window. Do you lose or duplicate notifications?',
          a: 'Keep window state in a durable store (Kafka Streams state store with a changelog, or Redis with AOF) and commit consumer offsets only after the state is updated. On restart, the window is restored and may re-emit once, so the push uses a deterministic notification ID (recipient + post + type + window) and the in-app activity row is upserted by that ID. Duplicates collapse on the device via the collapse ID.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-10',
      difficulty: 'medium',
      question:
        'Explore must pick ~25 posts for a user from billions within ~300 ms. Why is a Two-Tower model used for retrieval and early ranking, with the heavy multi-task model applied only to ~100 candidates?',
      options: [
        'Two-Tower models are more accurate than multi-task models, so they are used where accuracy matters most',
        'Item embeddings can be precomputed and indexed for nearest-neighbour search, so scoring millions of items is cheap; the heavy model uses costly user × item interaction features affordable only on a shortlist',
        'The heavy model needs GPUs, which are reserved for training, so inference on it must be limited to a small batch',
        'Two-Tower models avoid the need for any user features, which makes them privacy-preserving at the retrieval stage',
      ],
      correct: [1],
      explanation:
        'In a Two-Tower model, user and item towers are independent, so item embeddings are computed offline and searched with ANN, and a request only computes one user embedding. The second-stage model (MTML) uses cross features between the user and each item, which cannot be precomputed, so it runs on ~100 items. Two-Tower models are less accurate (that is why the heavy stage exists); GPU inference is common; and the user tower does use user features.',
      followUps: [
        {
          q: 'At peak, the second-stage ranker\'s latency doubles. What can you degrade first?',
          a: 'Shrink the shortlist sent to the heavy model (100 → 50), rely more on the distilled first-stage score, and blend in precomputed recommendations generated offline for heavy users (Meta describes using precomputed results during peak). Keep integrity filters in the final rerank untouched, since quality and safety are not the place to save milliseconds.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-11',
      difficulty: 'hard',
      question:
        'This consumer applies delivery events to the order. Customers occasionally see "Picked up" after "Delivered", and some delivered orders show as in transit in the restaurant dashboard. What is the core fix?',
      code: {
        language: 'typescript',
        code: `// consumer of topic partner-events (at-least-once, retries enabled)
async function onPartnerEvent(e: { orderId: string; type: 'PICKED_UP' | 'DELIVERED'; at: string }) {
  await db.query('UPDATE orders SET status = $2, updated_at = $3 WHERE id = $1',
    [e.orderId, e.type, e.at]);
  await pushToCustomer(e.orderId, e.type);
}`,
      },
      options: [
        'Make each transition conditional on allowed source states (PICKED_UP only from PREPARING/READY, DELIVERED only from PICKED_UP), and skip pushes when 0 rows change',
        'Increase the partition count of partner-events so that each order\'s events are processed faster',
        'Compare the at timestamps and apply an event only if it is newer than updated_at, which guarantees the correct order',
        'Switch the consumer to exactly-once delivery so that retries cannot re-deliver an older PICKED_UP event',
      ],
      correct: [0],
      explanation:
        'A retried or late PICKED_UP overwrites DELIVERED because the update is unconditional. A state-machine guard (WHERE status = ANY(allowed from)) makes late events no-ops and also stops the duplicate push. More partitions do nothing for ordering within an order. Timestamps from phones are skewed and can tie, so they are a weaker guard than legal transitions (they can complement them). Broker-level exactly-once does not cover the DB write and push, and a late event can still arrive out of order from the producer.',
      followUps: [
        {
          q: 'The partner app was offline and uploads PICKED_UP and DELIVERED together, DELIVERED first. With your guard, DELIVERED is rejected (status is READY). Now what?',
          a: 'Allow a direct READY → DELIVERED transition when the event carries evidence (OTP or geofence proof), or have the app send a per-order sequence number and buffer out-of-order events briefly so the consumer applies 1 then 2. Simplest robust choice: the partner app queues events locally and uploads them in order with sequence numbers, and the server rejects gaps and asks for a resync.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-12',
      difficulty: 'expert',
      question:
        'Restaurants must accept a paid order within 90 seconds, or it is cancelled and refunded. Select ALL implementations that are correct under pod crashes, deploys and retries.',
      options: [
        'Write a timer row (order_id, fire_at) in the same transaction that moves the order to PLACED; sweepers on all pods claim due rows with FOR UPDATE SKIP LOCKED',
        'Call setTimeout(90_000) in the pod that processed the payment webhook, and cancel the order when it fires',
        'Make the timeout handler a conditional update (… WHERE status = \'PLACED\'), so that an acceptance that committed first wins',
        'On timeout, issue the refund first and then try to update the order to CANCELLED, so the customer is never left without money',
        'Model the SLA as a durable timer in a workflow engine (e.g. Temporal) that escalates with an IVR call before cancelling',
      ],
      correct: [0, 2, 4],
      explanation:
        'Durable timers (DB rows with SKIP LOCKED, or a workflow engine) survive crashes and deploys, and conditional updates resolve the accept-vs-timeout race. An in-memory setTimeout is lost whenever its pod restarts, and webhook retries can create several. Refunding before the conditional transition can refund an order the restaurant accepted a moment earlier. The cancel must win first, and the refund follows (idempotently).',
      followUps: [
        {
          q: 'After the cancel committed, the tablet (which was offline) sends ACCEPT 20 s later. What should the restaurant see?',
          a: 'The accept is a conditional update that touches 0 rows, so the API returns a conflict with the current state, and the tablet shows "Order cancelled: not accepted in time, do not prepare". Because orders reach the tablet through a push plus a poll, the cancel event also arrives when it reconnects. Repeated misses feed a restaurant reliability score that can auto-pause it from listings at peak.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-13',
      difficulty: 'medium',
      question:
        'Heavy rain starts at 7:45 p.m. in one zone; online partners drop 40% while orders rise. Assignment delay climbs from 3 to 19 minutes. Which response should the platform automate first?',
      options: [
        'Scale out the order service and dispatcher pods 3× so that assignment rounds complete faster',
        'Keep accepting orders as usual but let them queue; partners will pick them up as the rain eases',
        'Switch dispatch from batched optimisation to greedy nearest-partner, which assigns faster',
        'Raise the zone\'s stress level: shrink serviceable radius, add a rain fee that funds partner incentives, widen shown ETAs, and pause the zone if stress keeps rising',
      ],
      correct: [3],
      explanation:
        'The constraint is physical partner supply, not compute, so the fix is to reduce and reshape demand (fewer far orders, honest ETAs) and to increase supply (incentives funded by the rain fee). Scaling pods does not create partners. Letting orders queue produces cold food, cancellations and refunds. Greedy dispatch assigns no faster when no partner is free, and it wastes the scarce supply that remains.',
      followUps: [
        {
          q: 'How do you avoid the rain fee flickering on and off for addresses on the edge of the zone as the stress number moves?',
          a: 'Use hysteresis (turn on at stress ≥ 2.0, off only at ≤ 1.5), smooth stress over a few minutes, set the fee per zone rather than per street (with neighbouring zones blended at the borders), and lock the fee into the checkout quote ID so it cannot change between cart and payment. Log every fee decision with its inputs for support and regulatory questions.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-14',
      difficulty: 'expert',
      question:
        'This accept endpoint turns a delivery offer into an assignment. Offers expire after 20 s and are re-offered to another partner. Which bug does it have under load?',
      code: {
        language: 'typescript',
        code: `@Post('offers/:orderId/accept')
async accept(@Param('orderId') orderId: string, @User() p: Partner) {
  const offer = await redis.hgetall(\`offer:\${orderId}\`);   // { offerId, partnerId }
  if (!offer.offerId) throw new GoneException('offer expired');
  await db.query(
    'UPDATE orders SET partner_id = $2, status = $3 WHERE id = $1',
    [orderId, p.id, 'ASSIGNED']);
  await redis.del(\`offer:\${orderId}\`);
  return { ok: true };
}`,
      },
      options: [
        'HGETALL on a missing key throws, so expired offers produce 500 errors instead of 410 responses',
        'Deleting the offer after the DB write leaks Redis memory when the DB update fails',
        'Using the partner ID from the auth token is insecure; the partner ID should be read from the offer hash',
        'It never checks that the live offer belongs to this partner (or is the same offer they saw), and check-then-write is not atomic, so a stale tap can steal or double-assign an order re-offered to someone else',
      ],
      correct: [3],
      explanation:
        'Partner A taps at 19.9 s; meanwhile the offer expired and was re-offered to B. A\'s request sees a live offer (B\'s) and assigns A, or both A and B pass the check concurrently and the last write wins while both think they have the order. The check must be an atomic compare-and-set on (offerId, partnerId) plus "not already assigned", e.g. in Lua, followed by a conditional DB update. HGETALL on a missing key returns an empty hash, not an error. The token\'s partner ID is the right identity; it must be compared with the offer, not replaced by it. The DEL ordering is a minor concern.',
      followUps: [
        {
          q: 'Redis says "assigned" but the subsequent DB update fails. How do you keep Redis and the DB consistent?',
          a: 'Treat Redis as the fast gate and the DB as the record. The DB update is conditional (\`WHERE id = $1 AND partner_id IS NULL\`) and retried; if it ultimately fails, a compensating step releases the Redis assignment and re-queues the order. A reconciler compares Redis assignments older than ~30 s with the DB and repairs either side. Alternatively, do the CAS directly in the DB (single conditional UPDATE) and use Redis only for offer TTLs: the DB load (~200 accepts/s at peak) easily allows that.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-15',
      difficulty: 'expert',
      question:
        'Partner P is 5 min from a restaurant. Order A is ready at t = 12 min, and its drop is 12 min from the restaurant. Order B from the same restaurant is ready at t = 16, and its drop is 15 min away, 5 min beyond A on the same road (handover 1 min). Batching rule: no order may get more than 5 min later than its solo plan (solo: P takes A at 12; B goes with another partner at 16). Should the dispatcher stack A and B on P?',
      options: [
        'No: A would wait 4 min at the restaurant, and any food wait is forbidden by the batching rule',
        'Yes: P picks up both at 16; A arrives at 28 (+4 vs 24) and B at 34 (+3 vs 31), both within 5 min, and a second partner is freed',
        'Yes, but deliver B first since it was ready last, so that its food stays freshest',
        'No: B arrives at 34 instead of 31, which is +8 min once A\'s handover is counted, and that breaks the 5-minute rule',
      ],
      correct: [1],
      explanation:
        'Solo: A is delivered at 12 + 12 = 24 and B at 16 + 15 = 31. Stacked: P waits until 16, so A arrives at 16 + 12 = 28 (+4) and B at 28 + 1 + 5 = 34 (+3). Both are within the 5-minute cap, and one partner trip is saved. The rule limits added delay, not any food wait. Delivering B first means driving past A\'s drop and coming back, making A much later. Option D double-counts: the +3 already includes the handover minute.',
      followUps: [
        {
          q: 'B\'s ready time is a prediction with a P80 of 20 minutes, not 16. Does your answer change?',
          a: 'Plan on the risk-adjusted value. With B at 20, A arrives at 32 (+8), which breaks the cap, so either do not stack, or stack conditionally: P picks up A at 12 and the system re-evaluates at pickup, only adding B if it is actually ready by about 16. Production dispatchers re-solve every round, so a conditional stack is cheap; the prep-time quantile, not the mean, should drive the decision.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-16',
      difficulty: 'hard',
      question:
        'Your ETA model predicts the mean delivery time well (MAE 4 min), yet "late vs promised" complaints are high and conversion drops when you add a fixed +10 min buffer. Select ALL changes that address this.',
      options: [
        'Predict quantiles (e.g. P50 and P80) and show a value near P75–P80, so the promise is met most of the time by design',
        'Decompose ETA into assignment delay, first mile, prep and last mile, so that the condition-specific error in each part (e.g. rain) can be fixed',
        'Recompute the ETA at each milestone (accepted, assigned, picked up) and change the displayed value only in small, explained steps',
        'Replace the ML model with straight-line distance ÷ average speed, which is easier to explain to customers',
        'Show the mean ETA but hide it after the order is placed, so that customers cannot compare it with the actual time',
      ],
      correct: [0, 1, 2],
      explanation:
        'A mean is missed about half the time; a quantile sets the promise rate explicitly, and per-condition variance is captured instead of a flat buffer that is too much on calm days and too little in rain. Decomposition shows which part drifts (assignment delay in rain, prep at peak). Milestone updates with smoothing keep trust. A straight-line estimate is less accurate. Hiding the ETA after ordering increases support contacts and cancellations.',
      followUps: [
        {
          q: 'How do you know the P80 you show is really a P80?',
          a: 'Monitor calibration: the share of orders delivered within the shown ETA should be ~80% overall and per segment (city, hour, weather, restaurant tier). Use reliability plots by bucket; if rainy evenings run at 60%, that segment is under-predicted, so retrain with the missing features or apply a per-segment conformal correction. Alert when calibration drifts by more than a few points for an hour.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-17',
      difficulty: 'expert',
      question:
        'A customer paid via UPI, the app showed "payment processing" and the user closed it. Your webhook never arrived. Twenty minutes later the order is still PAYMENT_PENDING. What should the system have done?',
      options: [
        'Created a new payment intent and charged the customer again when they reopened the app, since the first payment cannot be confirmed',
        'Marked the order failed after 5 minutes without webhook and ignored any later capture, because UPI payments settle instantly',
        'Polled the PSP for the payment status on a schedule (e.g. 2/5/15 min); if captured, placed the order if still serviceable or auto-refunded it, and otherwise marked it failed',
        'Sent the order to the restaurant immediately at checkout, since most UPI payments succeed, and reconciled the money afterwards',
      ],
      correct: [2],
      explanation:
        'Webhooks are best-effort; a reconciler that actively queries the PSP is what guarantees that a captured payment always ends as an order or a refund. Charging again risks a double debit. Ignoring a late capture keeps the customer\'s money with no food. Sending unpaid orders to restaurants creates cooked-but-unpaid food and fraud exposure at peak, when failure rates are highest.',
      followUps: [
        {
          q: 'The PSP\'s status API is rate-limited to 50 requests/s, and 30,000 orders are pending after an outage. How do you drain them?',
          a: 'Prioritise: newest pending orders first (most likely to still be placeable), then older ones for refund decisions. Use a token bucket at ~40 req/s to leave headroom: 30,000 ÷ 40 ≈ 750 s ≈ 12.5 min. Better still, request the PSP\'s settlement/report API (bulk status by time range) or re-trigger webhook delivery from their dashboard, which resolves thousands of orders in one call. Show affected customers a clear "confirming payment" state meanwhile.',
        },
      ],
    },
    {
      id: 'design-apps-mcq-18',
      difficulty: 'hard',
      question:
        'Ops sees customers getting two full refunds for one order (once from "no partner found", once from a customer cancel retry). A partial refund for a missing item must still be allowed before a later full cancellation. Which schema change is right?',
      code: {
        language: 'sql',
        code: `CREATE TABLE refunds (
  id            bigserial PRIMARY KEY,
  order_id      bigint NOT NULL,
  amount_paise  bigint NOT NULL,
  reason        text   NOT NULL,     -- NO_PARTNER, CUSTOMER_CANCEL, ITEM_MISSING ...
  status        text   NOT NULL      -- PENDING, SUCCEEDED, FAILED
);
-- each handler does:
-- INSERT INTO refunds (order_id, amount_paise, reason, status) VALUES ($1, $2, $3, 'PENDING');`,
      },
      options: [
        'Add UNIQUE (order_id), so that every order can be refunded at most once',
        'Before inserting, SELECT existing refunds for the order and skip the insert if any full refund exists',
        'Add a cause key (reason or item ID) with UNIQUE (order_id, cause_key), and in the same transaction lock the order row and reject refunds whose total would exceed the amount paid',
        'Rely on the PSP to reject a second refund for the same order ID, since PSPs dedupe refunds automatically',
      ],
      correct: [2],
      explanation:
        'A unique cause key makes each reason or item refundable once (handlers become idempotent), and the locked running total prevents two different causes from together exceeding what was paid: here NO_PARTNER and CUSTOMER_CANCEL are both "full" refunds, and the second would breach the cap. UNIQUE (order_id) blocks legitimate partial-then-full flows. A SELECT-then-INSERT without a lock races. PSPs typically allow multiple refunds up to the captured amount and dedupe only on an idempotency key you send.',
      followUps: [
        {
          q: 'The refund row is inserted but the PSP call times out. Is it safe to call again?',
          a: 'Yes, if the PSP request carries an idempotency key derived from the refund row ID: a retry returns the original result instead of refunding twice. The worker keeps the row PENDING, retries with back-off, and if the outcome is unknown, queries the PSP by that key before retrying. Only on a confirmed failure does it mark the refund FAILED and alert, with a fallback to wallet credit if the user agreed.',
        },
      ],
    },
  ],
};

export default topic;
