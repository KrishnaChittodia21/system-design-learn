import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-social',
  phase: 'designs',
  order: 3,
  title: 'Social & Media: Chat/WhatsApp, News Feed (Twitter/Instagram) & YouTube/Netflix',
  subtitle:
    'Real-time messaging with ordering and receipts, feeds that survive celebrities, and video pipelines that transcode, stream and count at planetary scale.',
  estimatedMinutes: 160,
  sources: [
    'Alex Xu — System Design Interview Vol 1, Ch 11 (News Feed), Ch 12 (Chat System), Ch 14 (YouTube)',
    'Twitter Engineering — Timelines at Scale (Raffi Krikorian, QCon 2013)',
    'Discord Engineering — How Discord Stores Trillions of Messages (2023)',
    'Netflix Tech Blog — Open Connect; Per-Title/Per-Shot Encoding Optimization',
    'Signal — The Double Ratchet and X3DH specifications',
  ],
  tags: [
    'chat',
    'whatsapp',
    'websocket',
    'message-ordering',
    'delivery-receipts',
    'presence',
    'e2e-encryption',
    'news-feed',
    'fan-out',
    'celebrity-problem',
    'ranking',
    'youtube',
    'netflix',
    'transcoding',
    'adaptive-bitrate',
    'cdn',
  ],
  cheatSheet: [
    'Chat numbers: WhatsApp-scale ~100B msgs/day ≈ 1.2M msgs/s avg; one tuned gateway holds ~0.5–2M idle WebSocket connections (WhatsApp famously hit ~2M per Erlang box).',
    'Chat core: stateless-ish gateways hold sockets + session registry (user → gateway) in Redis; chat service assigns a per-conversation sequence number, persists, then routes to online devices or push (APNs/FCM) for offline.',
    'Ordering: total order per conversation (not global) via a monotonic seq from a single owner per conversation; client dedups by client_msg_id and renders by seq.',
    'Receipts: sent (server ack after persist) → delivered (device ack) → read (read cursor per member); store read cursors, not per-message flags, in groups.',
    'Offline sync: each device keeps last_seq per conversation (or a global inbox cursor); reconnect → "give me everything after cursor", paginated; multi-device via per-device cursors.',
    'Feed fan-out: on write (push to followers’ timelines; fast reads, write amplification) vs on read (pull at request; cheap writes, slow reads). Hybrid: push for normal users, pull + merge for celebrities (> ~10K–1M followers) and skip inactive followers.',
    'Timeline cache: Redis list/zset of ~800 post IDs per active user (Twitter-style), hydrate posts/users from separate caches; cursor pagination by (score, id), never OFFSET.',
    'YouTube numbers: 5M DAU × 5 views; 10% upload 1 × 300 MB → 150 TB/day raw; CDN at $0.02/GB ≈ $150K/day → CDN is the dominant cost.',
    'Video pipeline: resumable upload → split by GOP → transcoding DAG (video/audio/thumbnail/watermark tasks) in parallel → HLS/DASH renditions (e.g. 240p–4K, 2–6 s segments) → origin + CDN.',
    'Netflix Open Connect: appliances inside ISPs pre-filled off-peak with predicted-popular titles; control plane in AWS, bytes from the edge. View counts: Kafka → windowed aggregation → approximate, fraud-filtered counters.',
  ],
  sections: [
    {
      heading: 'Chat / WhatsApp (1/5): requirements, estimation & protocol choice',
      body: `**Intuition:** a chat system is a **post office with an always-open door to every recipient**: the hard parts are keeping hundreds of millions of doors (connections) open, delivering in order, and knowing who has read what.

**Functional:** 1:1 and group chat (groups up to ~1,000 members — WhatsApp raised its limit to 1,024 in 2022), text + media, delivery/read receipts, online presence / last seen, multi-device, push notifications for offline users, message history sync. Optional: E2E encryption.

**Non-functional:** low latency (< 200–500 ms send→deliver in-region), **no message loss** once the sender sees the single tick, per-conversation ordering, high availability, durable history (or ephemeral with E2E + device storage, WhatsApp-style).

**Estimation (WhatsApp-like):**
- ~2B users, ~500M–1B DAU; public figure ~**100B messages/day** → 100B ÷ 86,400 ≈ **1.16M msgs/s** avg, peak ~3M/s (New Year's Eve).
- Concurrent connections: say **300M**. At ~1M connections per gateway → ~300 gateways (+ headroom). WhatsApp famously ran ~2M connections per Erlang server.
- Storage if server-side history: 100B × 100 B ≈ **10 TB/day** text (media separately in object storage, often 10×+).

**Protocol choice:**

| Option | Direction | Fit |
|---|---|---|
| Short polling | Client pulls | Wasteful, high latency |
| Long polling | Server holds request | OK fallback, reconnect churn per message |
| **WebSocket** | Full-duplex over one TCP/TLS conn | Default for send + receive |
| MQTT (Facebook Messenger historically) | Pub/sub over TCP, tiny headers | Great on flaky mobile networks |
| SSE | Server → client only | Fine for receive-only |

Use WebSocket (or MQTT) for real-time traffic, plain HTTPS for everything else (login, profile, media upload via presigned URL, history pagination).`,
      keyPoints: [
        '~100B msgs/day ≈ 1.2M msgs/s; ~10^8 concurrent sockets → hundreds of gateways.',
        'Durability promise starts at the server ack (single tick).',
        'WebSocket/MQTT for real-time; HTTPS for the rest.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 12 (Design a Chat System)',
    },
    {
      heading: 'Chat (2/5): data model, message IDs & per-conversation ordering',
      body: `**Access pattern:** "fetch the latest N messages of conversation C, then page backwards" + "append a message to C". That's a **wide-column** pattern: partition by conversation, cluster by message ID descending. Cassandra/ScyllaDB (Discord), HBase (Facebook Messenger historically), or sharded MySQL (Slack via Vitess) all work.

**Partition size control:** a 10-year-old busy group would become one giant partition. Discord's schema uses \`PRIMARY KEY ((channel_id, bucket), message_id)\` where **bucket** is a fixed time window (10 days) — bounded partitions, and the client walks buckets backwards.

**Message IDs & ordering:**
- Wall-clock timestamps from many servers can't order messages (skew, same-ms ties).
- **Global order is unnecessary** — users only perceive order *within a conversation*.
- Give each conversation a **monotonic sequence number** from a single owner: route all writes for a conversation to one chat-service shard (consistent hash on conversation_id), which increments a counter (Redis \`INCR\` or an in-memory counter persisted with the message). Alternatively use Snowflake IDs (time-sortable) and accept rare same-ms reorderings.
- The **client_msg_id** (UUID generated on the sender device) is the idempotency key: a resend after a flaky network returns the already-assigned seq instead of duplicating.

**Tables:**
- \`messages ((conv_id, bucket), seq) → sender, client_msg_id, body/ciphertext, type, media_ref, created_at\`
- \`conversation_members (conv_id, user_id) → role, joined_seq, last_read_seq\` (read receipts as cursors)
- \`user_inbox (user_id, conv_id) → last_seq, unread_count\` for the conversation list
- Media: object storage + CDN; message holds a reference (and for E2E, an encrypted blob + key inside the encrypted message).`,
      code: [
        {
          language: 'sql',
          title: 'CQL schema (Cassandra/ScyllaDB): bucketed partitions, idempotent sends',
          code: `-- bucket = floor(created_at_epoch_days / 10): at most 10 days per partition
CREATE TABLE messages (
  conv_id        bigint,
  bucket         int,
  seq            bigint,          -- per-conversation monotonic sequence
  sender_id      bigint,
  client_msg_id  uuid,            -- idempotency key from the sender device
  kind           text,            -- text | image | video | system
  body           blob,            -- ciphertext when E2E is on
  media_ref      text,
  created_at     timestamp,
  PRIMARY KEY ((conv_id, bucket), seq)
) WITH CLUSTERING ORDER BY (seq DESC)
  AND compaction = { 'class': 'TimeWindowCompactionStrategy',
                     'compaction_window_unit': 'DAYS', 'compaction_window_size': 10 };

-- Dedup of retried sends: LWT only on this small table, not on messages
CREATE TABLE message_dedup (
  conv_id bigint, client_msg_id uuid, seq bigint,
  PRIMARY KEY ((conv_id, client_msg_id))
) WITH default_time_to_live = 604800;    -- 7 days is plenty for client retries

CREATE TABLE conversation_members (
  conv_id bigint, user_id bigint, role text, last_read_seq bigint, muted boolean,
  PRIMARY KEY (conv_id, user_id)
);

-- Page backwards: newest 50 in the current bucket, then walk older buckets
SELECT seq, sender_id, body, created_at FROM messages
WHERE conv_id = ? AND bucket = ? AND seq < ? LIMIT 50;`,
        },
      ],
      keyPoints: [
        'Partition by (conversation, time bucket), cluster by seq DESC.',
        'Order per conversation via a single-owner sequence; no global order needed.',
        'client_msg_id makes retried sends idempotent.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 12; Discord Engineering (2017, 2023)',
    },
    {
      heading: 'Chat (3/5): architecture — gateways, session registry, routing & offline push',
      body: `**Components:**
- **Gateway (WebSocket) servers:** terminate TLS + WebSocket, authenticate, keep connections, heartbeats. Deliberately *thin* — no business logic — so they're rarely redeployed (connection drops are expensive).
- **Session registry:** Redis \`sess:{userId}\` → set of {deviceId, gatewayId}, with TTL refreshed by heartbeats. Tells the router where each device is connected.
- **Chat service** (sharded by conversation_id): validate membership, dedup by client_msg_id, assign seq, persist, then **route**.
- **Router/fan-out:** for each recipient device — online → send to its gateway (via gateway-addressed queue, gRPC stream, or pub/sub topic per gateway); offline → push-notification service (APNs/FCM) and the message waits in history.
- **Group service** (membership), **presence service**, **media service** (presigned uploads + CDN), **push service**.

**Send flow (1:1):**
1. Sender device → gateway G1: \`{type:'send', convId, clientMsgId, body}\`.
2. G1 → chat service shard owning convId → dedup → seq = 1042 → write to messages table (quorum) → **ack to sender** (single tick) with seq.
3. Router looks up recipient sessions: device on G7 → push frame to G7 → recipient device → device ack → **delivered** receipt back to sender (double tick).
4. If recipient offline: push notification ("New message from Asha" — or a content-free wake-up for E2E) and recipient syncs on reconnect.

**Why ack after persist:** if you ack before durable write and the service crashes, the sender believes the message was sent but it's lost. Persist-then-ack + client retry with the same client_msg_id gives at-least-once with dedup = effectively exactly-once *display*.`,
      diagram: `  device A                                                   device B
     | ws                                                        ^ ws
     v                                                           |
 +----------+  send   +------------------+  persist  +--------------------+
 | Gateway1 |-------->| Chat svc shard   |---------->| Messages store     |
 | (TLS,WS, |<--ack---| (owns conv_id):  |           | (Cassandra/Scylla) |
 |  auth)   |  seq    | dedup, seq, route|           +--------------------+
 +----------+         +----+--------+----+
                           |        | lookup sessions
            online: deliver|        v
                           |  +--------------+
                           |  | Session reg. |  user -> [device@gateway]
                           |  | (Redis, TTL) |
                           v  +--------------+
                    +----------+           offline:
                    | Gateway7 |----> B    +-------------+     APNs/FCM
                    +----------+           | Push service|---> wake B
                                           +-------------+`,
      code: [
        {
          language: 'typescript',
          title: 'Chat service: dedup, sequence, persist-then-ack, route to devices',
          code: `import Redis from 'ioredis';

type Send = { convId: string; clientMsgId: string; senderId: string; body: Buffer };

export class ChatService {
  constructor(
    private redis: Redis,
    private store: { insert(m: object): Promise<void>; dedup(conv: string, cid: string, seq: number): Promise<number | null> },
    private members: (convId: string) => Promise<string[]>,
    private toGateway: (gatewayId: string, frame: object) => Promise<void>,
    private push: (userId: string, convId: string) => Promise<void>,
  ) {}

  async send(m: Send): Promise<{ seq: number }> {
    const recipients = await this.members(m.convId);
    if (!recipients.includes(m.senderId)) throw new Error('NOT_A_MEMBER');

    // This shard owns convId (consistent hashing), so INCR is the single sequencer.
    const seq = await this.redis.incr('seq:' + m.convId);
    // Insert-if-absent on (convId, clientMsgId) (LWT IF NOT EXISTS): returns the
    // ORIGINAL seq if this is a retry. The seq we just burned becomes a harmless
    // gap, so clients must never assume seqs are contiguous.
    const existing = await this.store.dedup(m.convId, m.clientMsgId, seq);
    if (existing !== null) return { seq: existing };        // retried send: no duplicate

    await this.store.insert({ ...m, seq, createdAt: Date.now() }); // durable (QUORUM)
    // Ack to sender happens when this promise resolves: persisted before ack.
    void this.fanOut(m, seq, recipients.filter((u) => u !== m.senderId));
    return { seq };
  }

  private async fanOut(m: Send, seq: number, users: string[]) {
    const frame = { type: 'msg', convId: m.convId, seq, from: m.senderId, body: m.body.toString('base64') };
    await Promise.all(users.map(async (u) => {
      const devices = await this.redis.hgetall('sess:' + u);  // deviceId -> gatewayId
      const entries = Object.entries(devices);
      if (entries.length === 0) return this.push(u, m.convId); // offline: wake via APNs/FCM
      await Promise.all(entries.map(([deviceId, gw]) =>
        this.toGateway(gw, { ...frame, deviceId }).catch(() => this.push(u, m.convId))));
    }));
  }
}`,
        },
      ],
      keyPoints: [
        'Thin gateways + session registry + conversation-sharded chat service.',
        'Persist, then ack (single tick); deliver, then device ack (double tick).',
        'Offline → push notification; history sync on reconnect.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 12',
    },
    {
      heading: 'Chat (4/5): receipts, offline sync, multi-device & group fan-out',
      body: `**Receipts as cursors, not flags:**
- **Sent** = server persisted (seq assigned).
- **Delivered** = recipient device acked frame with seq ≤ N → store \`delivered_seq\` per (conv, user/device).
- **Read** = user viewed up to seq N → update \`last_read_seq\` in conversation_members and emit a receipt event to the other members' devices.
Storing one cursor per member (instead of a flag per message per member) turns an O(messages × members) write storm into O(members) — critical for groups.

**Offline sync:** each device stores \`last_seq\` per conversation. On reconnect: fetch the inbox (\`user_inbox\` rows where last_seq > device cursor), then for each changed conversation pull messages after the cursor, paginated. For huge backlogs sync the conversation list first and lazily load content. Seqs can have harmless gaps (a sequence number burned by a deduplicated retry), so the client pages by \"after my highest seq\" and trusts the server rather than demanding contiguity; progress is persisted per page so a crash mid-sync resumes cleanly.

**Multi-device:** each device has its own connection, cursors and (for E2E) its own identity keys; senders encrypt per device. The session registry maps user → many devices.

**Group fan-out:**
- **Small/medium groups (≤ ~1K):** fan-out on write — one persisted message, then deliver to every online member's gateways; members' inbox rows updated (unread counts).
- **Very large channels** (Discord servers, Telegram channels with 100K+): don't push every message to every member. Store once, push only to members **currently viewing** the channel, and send lightweight "channel has unread" hints to others; clients pull on open. That's fan-out on read.
- Per-group ordering still comes from the group's single sequencer.

**Presence ("online / last seen"):**
- Heartbeat every ~30 s from the client; the presence service marks online with a TTL (~60–90 s) — tolerate brief disconnects without flapping.
- Fan-out presence changes only to users who *care right now* (open chats, contact list visible) — pushing every presence flip to every contact is O(friends) per flip and dominates traffic otherwise. Subscribe-on-view is the standard trick.

**E2E encryption (mention, don't over-design):** Signal protocol — X3DH key agreement using prekeys published to the server, then the **Double Ratchet** for forward secrecy per message. Groups use **Sender Keys** (each sender distributes a chain key to members via pairwise channels, then encrypts each message once). The server sees ciphertext + routing metadata only, so server-side search/moderation is impossible — a product trade-off.`,
      code: [
        {
          language: 'typescript',
          title: 'Reconnect sync: per-conversation cursors, gap detection, bounded pages',
          code: `type Msg = { convId: string; seq: number; body: string };

export async function syncOnReconnect(
  api: {
    inbox(since: number): Promise<{ convId: string; lastSeq: number; watermark: number }[]>;
    messages(convId: string, afterSeq: number, limit: number): Promise<Msg[]>;
  },
  local: {
    cursor(convId: string): number;               // highest seq stored on this device
    save(msgs: Msg[]): void;                      // upsert by (convId, seq): replays are safe
    setCursor(convId: string, seq: number): void;
    inboxWatermark: number;
    setInboxWatermark(w: number): void;
  },
  ackRead: (convId: string, seq: number) => Promise<void>,
) {
  const changed = await api.inbox(local.inboxWatermark);   // conversations with new activity
  for (const c of changed) {
    let after = local.cursor(c.convId);
    while (after < c.lastSeq) {
      const page = await api.messages(c.convId, after, 200); // bounded page, seq ascending
      if (page.length === 0) break;                        // rest deleted/expired
      local.save(page);
      after = page[page.length - 1].seq;                   // seqs may have gaps: follow server
      local.setCursor(c.convId, after);                    // persist progress per page
    }
    await ackRead(c.convId, after);                        // ONE delivered-cursor ack per conv
  }
  const newest = changed.reduce((w, c) => Math.max(w, c.watermark), local.inboxWatermark);
  local.setInboxWatermark(newest);                         // only after all convs synced
}`,
        },
      ],
      keyPoints: [
        'Receipts and read state are per-member cursors (O(members), not O(messages × members)).',
        'Sync by cursor, persisted per page; multi-device = per-device cursors and keys.',
        'Large channels switch to fan-out on read; presence is subscribe-on-view.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 12; Signal protocol specs',
    },
    {
      heading: 'Chat (5/5): scaling, failure modes & wrap-up',
      body: `**Gateway scaling & failures:**
- Service discovery (ZooKeeper/etcd/Consul) hands clients the best gateway by region/load at login.
- When a gateway dies, its ~1M clients reconnect elsewhere → **reconnect storm**: jittered backoff, admission control, cheap session resumption tokens.
- Session registry entries of dead gateways must expire (TTL) or be purged via gateway heartbeats, otherwise routers send frames into the void — on send failure, fall back to push notification.

**Chat service shard failure:** it owns sequences for its conversations. Persist the counter with the message (the new owner restarts at max(seq)+1 read from storage) or keep it in Redis with AOF; during failover, a brief write unavailability for those conversations is preferable to duplicate seqs.

**Hot conversations:** a 100K-member live-event channel concentrates writes on one shard. Rate-limit per channel ("slow mode"), batch fan-out, and use fan-out on read.

**Storage choice trade-offs:**

| Store | Why teams pick it | Watch out for |
|---|---|---|
| Cassandra/ScyllaDB | Write-heavy, time-ordered, linear scale | Large partitions, tombstones from deletes, GC pauses (Discord moved to ScyllaDB partly for this) |
| HBase | Strong consistency per row, big scans | Operational heaviness (HDFS/ZooKeeper) |
| MySQL + Vitess | Familiar, transactions, Slack uses it | Resharding ops, write scaling |

**Wrap-up statement:** *"I guarantee per-conversation order via single-owner sequencing, no loss via persist-then-ack plus idempotent client retries, and I scale connections with thin gateways. The weakest part is hot channels; for those I'd switch to fan-out on read and slow mode."*`,
      keyPoints: [
        'Thin gateways, TTL’d session registry, push fallback on routing failure.',
        'Sequencer failover: recover from max persisted seq; accept brief unavailability.',
        'Hot channels → slow mode + fan-out on read.',
      ],
    },
    {
      heading: 'News Feed (1/3): requirements, estimation, API & data model',
      body: `**Intuition:** a news feed is a **personalised, merged, sorted view** of posts from everyone you follow. The design question is *when* you do the merging: when a post is written (push) or when the feed is read (pull).

**Functional:** publish a post (text, images, video); see a feed of followed accounts' posts (reverse-chron or ranked); like/comment/share counts; pagination/infinite scroll; follow/unfollow.

**Non-functional:** feed load p99 < ~200–500 ms, highly available (stale is fine — eventual consistency: a new post appearing a few seconds late is acceptable), read-heavy (reads ≫ writes, often 100:1+).

**Estimation (Twitter-like):**
- 300M DAU; posts: 1 per 3 users/day → 100M posts/day ≈ **1.2K posts/s** (peak ~5–10K; Twitter's record events spiked to ~140K tweets/s in 2013).
- Feed reads: 300M × 10 opens/day ÷ 10^5 ≈ **30K feed reads/s** (Twitter 2013 served ~300K timeline QPS).
- Average followers ~200 → fan-out on write ≈ 1.2K × 200 = **240K timeline inserts/s** avg — but a user with 100M followers generates 100M inserts for one post.

**API:**
- \`POST /v1/posts {text, mediaIds[]}\` → 201 {postId}
- \`GET /v1/feed?cursor=&limit=20\` → {items: [{post, author, counts, viewerHasLiked}], nextCursor}
- \`POST /v1/users/{id}/follow\`, \`DELETE ...\`

**Data model:**
- **posts**: post_id (Snowflake, time-sortable), author_id, body, media refs, created_at — sharded by post_id or author_id.
- **follows**: (follower_id, followee_id) with both directions indexed (who I follow / who follows me) — a graph store or two tables sharded by each side.
- **timelines** (cache): \`feed:{userId}\` → ordered list of post IDs (not full posts).
- **counters**: likes/comments per post in a counter store (Redis + periodic flush, or sharded counters).
- Media in object storage + CDN.`,
      code: [
        {
          language: 'graphql',
          title: 'Feed API as GraphQL: cursor pagination, batched hydration via DataLoader',
          code: `type Post {
  id: ID!
  author: User!             # resolved via DataLoader: one batched user fetch per page
  text: String
  media: [Media!]!
  likeCount: Int!           # from counter cache, eventually consistent
  viewerHasLiked: Boolean!
  createdAt: DateTime!
}

type FeedEdge { cursor: String!, node: Post! }
type FeedConnection { edges: [FeedEdge!]!, pageInfo: PageInfo! }
type PageInfo { endCursor: String, hasNextPage: Boolean! }

type Query {
  # cursor = opaque base64 of (rankScore, postId): stable under inserts, no OFFSET
  feed(first: Int = 20, after: String): FeedConnection!
}

type Mutation {
  createPost(text: String, mediaIds: [ID!]): Post!
  follow(userId: ID!): Boolean!
}`,
        },
      ],
      keyPoints: [
        'Reads ≫ writes; staleness of seconds is acceptable.',
        'Timelines store post IDs; posts/users/counters hydrated from separate caches.',
        'Fan-out cost scales with follower count — the celebrity problem.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 11 (Design a News Feed System); Twitter Timelines at Scale (2013)',
    },
    {
      heading: 'News Feed (2/3): fan-out on write vs read, and the hybrid for celebrities',
      body: `| | Fan-out on write (push) | Fan-out on read (pull) |
|---|---|---|
| Write cost | O(followers) inserts per post | O(1) |
| Read cost | O(1): read precomputed list | O(followees): query & merge at read time |
| Feed latency | Very low | Higher; needs k-way merge |
| Celebrity (50M followers) | 50M inserts per post, delayed delivery | No problem |
| Inactive users | Wasted work for users who never log in | No waste |
| Freshness | Real-time for followers | Always fresh |

**Hybrid (what Twitter/Instagram-style systems do):**
- **Normal authors** (< a threshold like ~10K–100K followers): fan-out on write to followers' timeline caches.
- **Celebrity authors:** don't fan out. At read time, fetch the user's precomputed timeline + the recent posts of the (few) celebrities they follow, and **merge**.
- **Skip inactive followers:** only push into timelines of users active in the last N days; others get their feed rebuilt on demand (pull) when they return.
- Fan-out runs **asynchronously**: post service writes the post, publishes \`PostCreated\` to Kafka; fan-out workers page through the follower list (in batches of e.g. 1,000) and \`LPUSH\`/\`ZADD\` + trim into Redis timelines.

**Edge cases to volunteer:** unfollow (filter at read time — cheaper than purging timelines), deleted posts (tombstone check at hydration), blocked/muted users (filter at read), privacy changes, and backfill when you follow someone new (pull their last N posts into your timeline).

**Twitter's 2013 design:** each active user's home timeline was a Redis list of ~800 tweet IDs, replicated 3× across datacenters; fan-out was done by a dedicated service; celebrity tweets were merged at read time.`,
      code: [
        {
          language: 'typescript',
          title: 'Fan-out worker (kafkajs + ioredis): hybrid threshold, active-only, batched pipeline',
          code: `import { Kafka } from 'kafkajs';
import Redis from 'ioredis';

const CELEBRITY_THRESHOLD = 100_000;
const TIMELINE_MAX = 800;
const ACTIVE_WINDOW_DAYS = 30;

export async function runFanout(kafka: Kafka, redis: Redis, graph: {
  followerCount(userId: string): Promise<number>;
  followersPage(userId: string, cursor: string | null, n: number): Promise<{ ids: string[]; next: string | null }>;
  isActive(userIds: string[], days: number): Promise<boolean[]>;
}) {
  const consumer = kafka.consumer({ groupId: 'feed-fanout' });
  await consumer.connect();
  await consumer.subscribe({ topic: 'post-created' });
  await consumer.run({
    eachMessage: async ({ message }) => {
      const { postId, authorId, score } = JSON.parse(message.value!.toString());
      if ((await graph.followerCount(authorId)) >= CELEBRITY_THRESHOLD) {
        // Celebrity: no fan-out; readers merge from this per-author list
        await redis.zadd('recent:' + authorId, score, postId);
        await redis.zremrangebyrank('recent:' + authorId, 0, -201);  // keep 200
        return;
      }
      let cursor: string | null = null;
      do {
        const page: { ids: string[]; next: string | null } =
          await graph.followersPage(authorId, cursor, 1_000);
        const active = await graph.isActive(page.ids, ACTIVE_WINDOW_DAYS);
        const pipe = redis.pipeline();
        page.ids.forEach((f, i) => {
          if (!active[i]) return;                        // inactive: rebuilt on login
          pipe.zadd('feed:' + f, score, postId);           // idempotent on redelivery
          pipe.zremrangebyrank('feed:' + f, 0, -(TIMELINE_MAX + 1));
        });
        await pipe.exec();
        cursor = page.next;
      } while (cursor);
    },
  });
}`,
        },
      ],
      keyPoints: [
        'Push for normal authors, pull + merge for celebrities, skip inactive followers.',
        'Fan-out is async via Kafka; ZADD makes redelivery idempotent.',
        'Handle unfollow/delete/block at read time.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 11; Twitter Timelines at Scale (2013)',
    },
    {
      heading: 'News Feed (3/3): read path, ranking, caching layers & wrap-up',
      body: `**Read path:**
1. \`GET /feed\` → feed service reads \`feed:{me}\` (IDs + scores) from Redis.
2. Fetch celebrity followees' recent lists (\`recent:{celeb}\`) and **k-way merge** by score.
3. If the timeline is missing (inactive user returning, cache loss) → rebuild by pulling recent posts of followees (bounded), then cache.
4. **Hydrate**: batch-get posts (post cache), authors (user cache), counters (counter cache), viewer state (liked?) — one MGET per type, DataLoader-style.
5. Filter (deleted, blocked, muted), **rank**, return page + opaque cursor.

**Caching layers:** news-feed cache (IDs), content cache (hot posts), social-graph cache, action cache (liked/replied), counter cache. Separate caches because they have different sizes, TTLs and invalidation rules.

**Ranking:** reverse-chron is simple and predictable. Ranked feeds (Instagram since 2016, Facebook) use a two-stage pipeline: **candidate generation** (the ~500–1,000 posts from followees + recommendations) → **ML ranking** (predict P(like), P(comment), P(dwell), P(hide) → weighted score) → business rules (diversity, freshness, ads insertion). Ranking runs at read time, so candidate counts must stay bounded; heavy features are precomputed.

**Pagination:** cursors on (score, postId), never OFFSET — new posts inserted at the top would shift pages and cause duplicates/skips.

**Counters:** likes on a viral post at 50K/s can't be \`UPDATE posts SET likes = likes + 1\`. Use Redis INCR (sharded across N sub-keys for hot posts) and periodically persist; display approximate counts.

**Bottlenecks & trade-offs to close with:** celebrity threshold tuning, Redis memory (300M active users × 800 IDs × ~16 B in a zset with overhead is several TB — keep only active users, compress IDs), consistency (a user may not see their own post if the feed is eventually consistent → **read-your-writes**: merge the user's own recent posts at read time), and ranking latency budget.`,
      diagram: `  POST /posts                                    GET /feed
      |                                              |
      v                                              v
 +-----------+  PostCreated  +---------+     +----------------+
 | Post svc  |-------------->|  Kafka  |     |   Feed svc     |
 | (DB+cache)|               +----+----+     | 1 ids (feed:me)|
 +-----------+                    |          | 2 merge celebs |
                                  v          | 3 hydrate      |
                        +-------------------+| 4 filter+rank  |
                        | Fan-out workers   |+---+---+---+----+
                        | normal authors:   |    |   |   |
                        | ZADD feed:{f}     |    |   |   +--> ranking (ML)
                        | celebs: recent:{c}|    |   +--> post/user/count cache
                        +---------+---------+    |
                                  |              v
                                  +------> Redis timelines (feed:*, recent:*)
                 graph svc (followers) <-- fan-out reads follower pages`,
      keyPoints: [
        'Read = ids → merge celebrities → hydrate in batches → filter → rank.',
        'Cursor pagination; read-your-writes by merging own recent posts.',
        'Hot counters: sharded Redis counters with periodic persistence.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 11',
    },
    {
      heading: 'YouTube / Netflix (1/4): requirements, estimation & the cost model',
      body: `**Intuition:** a video platform is a **factory plus a delivery network**: the factory (upload + transcoding) turns one raw file into dozens of optimised versions; the delivery network (CDN) ships the right version to billions of screens. Almost all the money is spent on delivery.

**Functional:** upload videos (up to e.g. 1–10 GB), watch with smooth playback on any device/network, change quality, view counts/likes/comments, search and recommendations (touchpoint only). Netflix variant: curated catalogue, no user uploads, but extreme delivery optimisation.

**Non-functional:** fast upload with resumability, **smooth streaming** (low start-up time < ~2 s, minimal rebuffering), high availability, global low latency, cost efficiency.

**Estimation:**
- 5M DAU × 5 videos watched/day; 10% upload 1 video/day; avg video 300 MB.
- Storage: 5M × 10% × 300 MB = **150 TB/day** of raw uploads (renditions multiply this by several ×).
- CDN cost: 5M × 5 × 0.3 GB × $0.02/GB ≈ **$150,000/day** → ~$55M/year. CDN cost dominates.
- Real YouTube: **500+ hours of video uploaded per minute**; >1B hours watched per day.

**Cost-saving levers (volunteer these):**
- Serve **popular** videos from CDN, the long tail from cheaper origin/regional storage (views follow a power law).
- Don't encode every rendition for short/unpopular videos; encode on demand for rarely watched formats.
- Regional distribution for regional content; ISP partnerships (Netflix Open Connect, Google Global Cache).
- Better codecs (H.264 → VP9/HEVC → AV1) cut bitrate ~30–50% per generation at equal quality — at higher encode cost.

**API:** \`POST /v1/videos\` → uploadId + presigned (resumable) URLs; \`POST /v1/videos/{id}/complete\`; \`GET /v1/videos/{id}\` → metadata + manifest URL (\`.m3u8\`/\`.mpd\`); \`POST /v1/videos/{id}/views\` (batched events).`,
      keyPoints: [
        '150 TB/day raw uploads; CDN ≈ $150K/day in the book’s model → delivery dominates cost.',
        'Popular content on CDN, long tail on origin; codec upgrades cut bandwidth.',
        'Resumable upload + manifest-based playback APIs.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 14 (Design YouTube)',
    },
    {
      heading: 'YouTube / Netflix (2/4): upload & the transcoding DAG',
      body: `**Upload flow:**
1. Client requests upload → API creates a video row (UPLOADING) + returns resumable presigned multipart URLs for object storage (original-files bucket).
2. Client uploads parts in parallel, retrying individually; completes the upload.
3. Storage event → **transcoding pipeline**. Meanwhile, metadata (title, description, thumbnail choice) is saved via the API — in parallel with the upload.
4. When all renditions are ready → status READY, CDN warm for predicted-popular videos, notify the uploader.

**Why transcode:** raw uploads come in arbitrary containers/codecs/bitrates. Players need standard codecs at multiple resolutions/bitrates for **adaptive streaming**, and smaller files for mobile.

**The DAG (Facebook SVE-style):** a job is a **directed acyclic graph** of tasks configured per content type:
- *Preprocessor:* validate, probe (ffprobe), **split into GOP-aligned chunks** (Group of Pictures — independently decodable segments, a few seconds each) so chunks encode in parallel.
- *Video tasks:* encode each chunk × each rendition ladder rung (e.g. 240p/360p/480p/720p/1080p/4K × codec H.264/VP9/AV1).
- *Audio tasks:* encode AAC/Opus at a few bitrates.
- *Thumbnail, watermark, content-ID/copyright fingerprinting, safety classification* in parallel branches.
- *Merge/packager:* concatenate chunks per rendition, package into **HLS/DASH segments + manifests**, encrypt (DRM) if needed.
- **DAG scheduler** splits the graph into stages; a **resource manager** with task queues (priority by uploader tier/popularity) and worker queues assigns tasks to **task workers**; intermediate outputs in temp storage.

**Parallelism math:** a 10-minute 1080p video split into 2-s chunks = 300 chunks × 6 renditions = 1,800 encode tasks. With 300 workers it finishes in roughly the time to encode ~6 chunks — **minutes instead of hours**.

**Netflix twist:** per-title (and per-shot) encoding — an animated film needs far fewer bits than an action movie at the same quality, so the bitrate ladder is computed per title using VMAF quality scores.`,
      code: [
        {
          language: 'typescript',
          title: 'Declaring a transcoding DAG and deriving parallel stages (topological layers)',
          code: `type Task = { id: string; kind: string; deps: string[]; params?: Record<string, unknown> };

export function buildDag(videoId: string, chunks: number, ladder: string[]): Task[] {
  const tasks: Task[] = [{ id: 'split', kind: 'split-gop', deps: [], params: { videoId } }];
  for (let c = 0; c < chunks; c++) {
    for (const r of ladder) {                      // e.g. ['240p','480p','720p','1080p']
      tasks.push({ id: 'enc-' + r + '-' + c, kind: 'encode', deps: ['split'], params: { chunk: c, rendition: r } });
    }
  }
  tasks.push({ id: 'audio', kind: 'encode-audio', deps: ['split'] });
  tasks.push({ id: 'thumbs', kind: 'thumbnail', deps: ['split'] });
  tasks.push({ id: 'fingerprint', kind: 'content-id', deps: ['split'] });
  for (const r of ladder) {                        // merge all chunks of a rendition
    const encs = tasks.filter((t) => t.params?.rendition === r).map((t) => t.id);
    tasks.push({ id: 'merge-' + r, kind: 'merge', deps: [...encs, 'audio'] });
  }
  tasks.push({ id: 'package', kind: 'hls-dash-package', deps: ladder.map((r) => 'merge-' + r) });
  tasks.push({ id: 'publish', kind: 'publish', deps: ['package', 'thumbs', 'fingerprint'] });
  return tasks;
}

/** Kahn’s algorithm by layers: every task in a stage can run in parallel. */
export function stages(tasks: Task[]): string[][] {
  const indeg = new Map(tasks.map((t) => [t.id, t.deps.length]));
  const children = new Map<string, string[]>();
  tasks.forEach((t) => t.deps.forEach((d) => children.set(d, [...(children.get(d) ?? []), t.id])));
  let layer = tasks.filter((t) => t.deps.length === 0).map((t) => t.id);
  const out: string[][] = [];
  while (layer.length) {
    out.push(layer);
    const next: string[] = [];
    for (const id of layer) for (const ch of children.get(id) ?? []) {
      indeg.set(ch, indeg.get(ch)! - 1);
      if (indeg.get(ch) === 0) next.push(ch);
    }
    layer = next;
  }
  if (out.flat().length !== tasks.length) throw new Error('cycle in DAG');
  return out;
}`,
        },
      ],
      keyPoints: [
        'Split into GOP-aligned chunks → encode chunk × rendition in parallel → merge → package.',
        'DAG scheduler + resource manager + worker pool; priorities per job.',
        'Per-title encoding (Netflix) tailors the bitrate ladder to content complexity.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 14; Netflix Tech Blog — Per-Title Encode Optimization',
    },
    {
      heading: 'YouTube / Netflix (3/4): adaptive bitrate streaming, CDN & Netflix Open Connect',
      body: `**Adaptive bitrate (ABR):** the video is cut into short **segments** (typically 2–6 s; Apple recommends 6 s for HLS) at every rendition. A **manifest** (HLS \`.m3u8\` or MPEG-DASH \`.mpd\`) lists renditions and segment URLs. The player measures throughput and buffer level and picks the rendition for each next segment — dropping to 480p in a tunnel, climbing back to 1080p on Wi-Fi — without stopping playback.

- Throughput-based ABR: pick the highest bitrate below ~80% of measured bandwidth.
- Buffer-based (e.g. BOLA, Netflix's buffer-based approach): decide by buffer occupancy — more stable.
- Start-up: begin at a low/medium rung for fast first frame, then ramp.
- **Low-latency live**: LL-HLS / LL-DASH with partial segments (~200–500 ms parts) or WebRTC for sub-second.

**Why segments + HTTP:** segments are plain static files → any HTTP cache/CDN can serve them; no stateful streaming servers.

**CDN strategy:** popular videos pushed/pulled to edge PoPs; long-tail served from origin or regional mid-tier caches. Use tiered caching (edge → regional shield → origin) so a cache miss storm doesn't hit origin. Signed URLs/tokens for protected content; DRM (Widevine/FairPlay/PlayReady) for premium.

**Netflix Open Connect:**
- Netflix built its own CDN: **Open Connect Appliances (OCAs)** — storage-dense servers placed **inside ISP networks** and at internet exchange points, free to ISPs.
- The control plane (catalogue, auth, recommendations, *steering*) runs in AWS; when you press play, the steering service returns URLs of the best OCAs for your network.
- OCAs are **proactively filled during off-peak hours** with content predicted to be popular in that region the next day — Netflix knows its catalogue and demand, so it can pre-position rather than cache on miss.
- Result: virtually all Netflix video bytes are served from OCAs close to viewers, reducing ISP transit costs and latency.

**YouTube** similarly uses Google Global Cache nodes in ISPs plus Google's edge network; unlike Netflix, its long-tail user-generated catalogue makes pre-positioning harder, so it relies more on cache-on-demand + popularity prediction.`,
      diagram: `   Player                                   Control plane (AWS / origin DC)
     | 1 play(videoId) ------------------->  auth, entitlement, steering
     |<-- 2 manifest URL + ranked OCA/edge list
     |
     | 3 GET master.m3u8  ---------------->  +-----------------------+
     | 4 GET 1080p/seg_0001.ts ----------->  | OCA / edge cache in   |
     |   (measure throughput, buffer)        | ISP network           |
     | 5 GET 480p/seg_0002.ts  ----------->  | (filled off-peak with |
     |   (bandwidth dropped -> lower rung)   |  predicted titles)    |
     |                                       +-----------+-----------+
     |                                              miss | (rare)
     |                                                   v
     |                                      regional shield -> origin (S3)`,
      code: [
        {
          language: 'text',
          title: 'HLS master playlist: the player picks a rendition per segment',
          code: `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240,CODECS="avc1.4d4015,mp4a.40.2"
240p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480,CODECS="avc1.4d401e,mp4a.40.2"
480p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8

# 720p/index.m3u8 (media playlist) — 6-second segments, immutable URLs
#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:6.000,
seg_00000.ts
#EXTINF:6.000,
seg_00001.ts
#EXT-X-ENDLIST`,
        },
      ],
      keyPoints: [
        'ABR: short segments × renditions + manifest; player adapts per segment.',
        'Static segments over HTTP → CDN-friendly; tiered caching protects origin.',
        'Open Connect: ISP-embedded appliances pre-filled off-peak; steering from AWS.',
      ],
      source: 'Netflix Open Connect overview; Apple HLS Authoring Specification',
    },
    {
      heading: 'YouTube / Netflix (4/4): view counts, metadata, recommendations touchpoint & wrap-up',
      body: `**View counts at scale:** a viral video gets 100K+ views/s. Never \`UPDATE videos SET views = views + 1\` on a hot row.
- Player emits **view events** (with watch-time, a view counts only after N seconds) → Kafka.
- Stream job (Flink/Kafka Streams) **validates** (bot/fraud filters, dedup per session), aggregates per (video, minute) and updates a counter store; batch reconciliation recomputes authoritative counts from raw events. (This is the same pattern as ad-click aggregation.)
- Display approximate counts from cache; YouTube historically froze public counts (the famous "301+") while validating — correctness over freshness for monetised metrics.

**Metadata:** video rows (id, owner, title, status, durations, rendition list) in a sharded relational DB (YouTube used MySQL + **Vitess**, which was built at YouTube for exactly this). Hot metadata cached; thumbnails on CDN (lots of small files → Google used Bigtable-style storage for thumbnails).

**Recommendations touchpoint (don't design the ML, show where it plugs in):**
- Event logging (impressions, clicks, watch time, likes, skips) → Kafka → feature store + training pipelines.
- Serving: **candidate generation** (collaborative filtering / two-tower embeddings, ANN retrieval of a few hundred candidates) → **ranking** model (predict expected watch time) → re-ranking (diversity, freshness, policy).
- Home feed and "up next" call the rec service with a latency budget (~100 ms); fall back to popular/trending lists on timeout.

**Error handling:** recoverable errors (a chunk encode fails) → retry the task; non-recoverable (corrupt file/unsupported format) → fail the job, notify user. Upload API failures → client retries with resumable offset. CDN/edge failures → player falls back to the next URL in the steering list.

**Wrap-up trade-offs:** cost vs quality (codec choice, ladder size), encode latency vs thoroughness (fast low-res first, HD later), pre-positioning (Netflix) vs cache-on-demand (YouTube), approximate vs exact counts.`,
      code: [
        {
          language: 'typescript',
          title: 'View-event collector: validate minimum watch time, dedup per session, batch to Kafka',
          code: `import { Kafka, CompressionTypes } from 'kafkajs';
import Redis from 'ioredis';

const MIN_WATCH_SECONDS = 30;          // policy: a "view" needs meaningful watch time
const producer = new Kafka({ brokers: ['kafka:9092'] }).producer({ idempotent: true });
const redis = new Redis();
const buffer: { key: string; value: string }[] = [];

export async function onViewEvent(e: { videoId: string; sessionId: string; watchedSec: number; ip: string }) {
  if (e.watchedSec < MIN_WATCH_SECONDS) return;
  // One view per (session, video) per day; cheap first-line dedup before the stream job
  const first = await redis.set('v:' + e.sessionId + ':' + e.videoId, '1', 'EX', 86_400, 'NX');
  if (!first) return;
  buffer.push({ key: e.videoId, value: JSON.stringify({ ...e, ts: Date.now() }) }); // key = partition
  if (buffer.length >= 500) await flush();
}

export async function flush() {
  if (!buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  await producer.send({
    topic: 'video-views',
    compression: CompressionTypes.GZIP,
    messages: batch,                   // Flink aggregates per (videoId, minute) downstream
  });
}
setInterval(() => void flush().catch(() => {}), 1_000).unref();`,
        },
      ],
      keyPoints: [
        'View counts: events → Kafka → validated windowed aggregation → approximate display.',
        'Metadata in sharded MySQL (Vitess); thumbnails on CDN.',
        'Recs: log events → candidate generation → ranking → fallback to trending.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 14',
    },
    {
      heading: 'Bottlenecks, trade-offs & wrap-up across social & media designs',
      body: `| Design | Hardest part | Bottleneck | Key trade-off |
|---|---|---|---|
| Chat | Ordering + no loss + receipts across devices | Connection churn, hot group channels | Server-side history vs E2E device-only storage; fan-out on write vs read for big channels |
| News feed | Celebrity fan-out and ranking latency | Timeline cache memory, fan-out lag | Push vs pull vs hybrid; freshness vs cost; chronological vs ranked |
| YouTube/Netflix | Transcoding throughput and delivery cost | CDN egress, encode compute | Codec efficiency vs encode cost; pre-positioning vs caching on demand |

**Cross-cutting themes interviewers love:**
- **Fan-out** is the unifying concept: chat messages to group members, posts to followers, videos to edge caches. Always ask: *who pays the fan-out cost — the writer, the reader, or a background job?*
- **Idempotency** everywhere: client_msg_id for chat, ZADD for timelines, session-level dedup for views.
- **Approximation is a feature:** presence, counters and view counts can be eventually consistent; messages and payments cannot.
- **Hot keys:** celebrity posts, viral videos, 100K-member channels — replicate, shard counters, or switch to pull.

**Closing line:** *"If I had more time I'd deep-dive on the celebrity threshold with data (the distribution of follower counts) and on the reconnect-storm behaviour of the gateway tier — those are where these systems actually fall over."*`,
      keyPoints: [
        'Identify who pays the fan-out cost in every design.',
        'Idempotency and approximation are deliberate design tools.',
        'Hot keys appear in every social system — plan for them.',
      ],
    },
    {
      heading: 'Level bar: what mid, senior and staff answers include',
      body: `Calibration: **mid** is about 80% breadth / 20% depth: a working end-to-end design, with the interviewer steering into deep dives. **Senior** is about 60/40: you get through the HLD quickly, then go deep on ordering, fan-out or transcoding yourself, with numbers. **Staff** is about 40/60: you drive, and you raise deploys, cost, privacy and org boundaries without being asked.

**Chat / WhatsApp**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | 1:1, groups, online status | 500M DAU × 40 msgs ≈ 230K msgs/s (peak ~700K); groups ≤ 1,024; receipts; ordered within a conversation | E2E encryption limits (no server search or moderation), multi-device keys, data residency |
| High-level design | WS servers + chat service + DB | Gateways + session registry (user → gateway), message store partitioned by conversation, APNs/FCM for offline | Stateful connection tier split from stateless logic; a home region per user |
| Deep dives expected | Sending a message | Per-conversation sequence, acks/receipts, offline sync by device cursor | Large-group fan-out, multi-device consistency, ordering across reconnects |
| Trade-offs & failure handling | — | Server seq vs client timestamps; at-least-once + dedup | Store-and-delete after delivery vs server-side history (cost, privacy) |
| Ops/cost/evolution | — | Connections per gateway (~1M with epoll tuning) | Draining millions of sockets per deploy, reconnect storms, retention cost |

- Down-levelled: global ordering by client timestamps; clients polling for new messages; no answer to "the phone was offline for 3 days".

**News feed (Twitter / Instagram)**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | Post, follow, view feed | 300M DAU × 5 loads ≈ 17K read QPS (peak ~50K); 200 average followers, 100M for celebrities | Ranking freshness, ads slots, blocks/deletes that must propagate |
| High-level design | Post, graph and feed services | Kafka fan-out workers push post IDs into Redis feed lists (capped at ~800), hydration on read | Hybrid push/pull plus a ranking service, kept separate from candidate generation |
| Deep dives expected | Fan-out on write, when asked | Write vs read vs hybrid with a follower threshold | Inactive-user skip, backfill on login, unfollow/delete consistency |
| Trade-offs & failure handling | — | Feed lag vs read latency | Feed staleness SLO; degraded feed (chronological, cached) when ranking is down |
| Ops/cost/evolution | — | Fan-out queue lag | Redis memory: 300M × 800 × 8 B ≈ 1.9 TB before replicas |

- Down-levelled: a SQL join of follows and posts per request; pushing a celebrity post to 100M lists.

**YouTube / Netflix**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | Upload, watch | ~500 h uploaded/min, billions of views/day; reads overwhelmingly dominate; start-up < 2 s | Cost model (egress dominates), copyright matching, regional licensing |
| High-level design | Upload → storage → stream | Resumable upload to S3, transcoding DAG, HLS/DASH segments on CDN, metadata DB, view pipeline | ISP-embedded caches (Open Connect), popularity-driven placement |
| Deep dives expected | Transcoding exists | Chunked parallel transcoding, ABR ladder, CDN hit ratio | Per-title encoding, prefetch to edge off-peak, long-tail economics |
| Trade-offs & failure handling | — | Eager all renditions vs on-demand for the long tail | Origin shield to protect storage during cache misses on a viral video |
| Ops/cost/evolution | — | Transcode queue depth | Storage ≈ raw × 5–8 renditions; cold-tier the 80% rarely watched |

- Down-levelled: streaming from app servers; one transcoding job per video; view counts via \`UPDATE ... +1\`.`,
      keyPoints: [
        'Chat: the bar is ordering + offline sync, not just "use WebSockets".',
        'Feed: the bar is the celebrity problem with a numeric threshold.',
        'Video: the bar is CDN economics; staff talks about egress cost and ISP caches.',
      ],
      source: 'Hello Interview — problem breakdowns (levelling expectations)',
    },
    {
      heading: 'Deep-dive ladders: bad → good → great',
      body: `**Chat: ordering and guaranteed delivery**
- **Bad:** sort by client timestamps, and the server pushes and forgets. Phone clocks drift by minutes, so replies appear before questions, and anything pushed to a dead socket is lost.
- **Good:** the server assigns a per-conversation sequence (e.g. \`INCR conv:{id}:seq\`), and clients ack. A retry after a lost ack still creates a duplicate with a new seq.
- **Great:** the client generates a message UUID, used as an idempotency key, so a retry returns the same seq. Each device keeps a sync cursor (last seq it has seen per conversation), and on reconnect it pulls everything with seq > cursor before resuming live push. Delivered/read receipts are just more sequenced events. Cost: a hot seq allocator for very active groups (shard it by conversation), and one cursor row per device.

**Chat: large-group fan-out**
- **Bad:** for a 1,024-member group, write one message copy into every member's inbox: 1,024 writes per message.
- **Good:** store the message once per conversation and fan out only notifications to online members' gateways. Offline members pull by cursor.
- **Great:** above about 1K members (channels), switch to read-time pull plus a lightweight "new activity" ping, rate-limited per gateway. Cost: two delivery paths to test.

**News feed: the celebrity problem**
- **Bad:** pure fan-out on write. One post from a 100M-follower account means 100M Redis writes. At 1M writes/s that is 100 s of lag, and it starves everyone else's fan-out.
- **Good:** pure fan-out on read, merging every followee's recent posts per request. That is 17K QPS × 200 followees ≈ 3.4M reads/s, with p99 set by the slowest shard.
- **Great:** hybrid. Push for authors under about 10K–100K followers, and at read time merge in the few celebrities each user follows (usually < 20). Skip push to users inactive for 30 days and rebuild their feed on login. Cost: two code paths, plus a merge-and-rank step on every read.

**Video: transcoding throughput**
- **Bad:** one worker encodes a 2-hour 4K upload into 6 renditions sequentially. That takes hours, and a crash at 90% restarts from zero.
- **Good:** one job per rendition, running in parallel. Each job is still hours long, and still restarts on failure.
- **Great:** split at keyframes into 4–10 s GOP-aligned chunks and fan out a DAG: split → N chunks × M renditions → package HLS/DASH → publish manifest. Each chunk retries independently, so wall time ≈ time to encode one chunk. Popular creators get priority queues and per-title encoding. Cost: an orchestrator (DAG state), keyframe alignment across renditions, and storing the intermediate chunks.

**Video: view counts**
- **Bad:** \`UPDATE videos SET views = views + 1\`. A viral video means one hot row lock.
- **Good:** sharded Redis counters per video, summed on read. No bot filtering, and you lose data if Redis loses memory.
- **Great:** view events go to Kafka, then a stream job with dedup (user, video, window) and fraud filtering adds per-minute aggregates to the store. Display an approximate count; billing and creator payouts use the reconciled batch numbers. Cost: counts are minutes stale.`,
      keyPoints: [
        'Idempotency key + server sequence + device cursor is the core of chat correctness.',
        'Hybrid fan-out needs a stated threshold and an inactive-user policy.',
        'Chunked DAG transcoding turns hours into minutes and makes failures cheap.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'design-social-cc-1',
      title: 'Fix the chat send handler',
      context:
        'Users report duplicated messages after flaky-network retries, messages occasionally appear out of order in groups, and after a chat-service crash some messages the sender saw as "sent" never arrived.',
      task:
        'Rewrite handleSend so that retries never duplicate, order within a conversation is deterministic, the sender’s tick means the message is durable, and a slow recipient cannot block the sender.',
      starter: {
        language: 'typescript',
        code: `import type { WebSocket } from 'ws';
import { db } from './db';
import { sockets } from './local-sockets';   // Map<userId, WebSocket> on THIS server

export async function handleSend(ws: WebSocket, from: string, msg: { convId: string; text: string }) {
  ws.send(JSON.stringify({ type: 'ack' }));            // tell sender it's sent

  const members = await db.query('SELECT user_id FROM members WHERE conv_id=$1', [msg.convId]);
  for (const m of members.rows) {
    const s = sockets.get(m.user_id);
    if (s) {
      await new Promise((r) => s.send(JSON.stringify({ ...msg, from, ts: Date.now() }), r));
    }
  }
  await db.query(
    'INSERT INTO messages (conv_id, sender, text, created_at) VALUES ($1,$2,$3,now())',
    [msg.convId, from, msg.text]);
}`,
      },
      hints: [
        'In what order should "persist", "ack" and "deliver" happen for the tick to mean durability?',
        'What identifies a retried send as the same message? What orders messages from two servers in the same millisecond?',
        'Recipients connected to other gateway servers, or offline, never get the message here.',
      ],
      solution: {
        language: 'typescript',
        code: `import type { WebSocket } from 'ws';
import type { Pool } from 'pg';

type SendFrame = { convId: string; clientMsgId: string; text: string };

export function makeHandleSend(deps: {
  db: Pool;
  route: (userId: string, frame: object) => Promise<'delivered' | 'offline'>; // via session registry
  push: (userId: string, convId: string) => Promise<void>;
}) {
  return async function handleSend(ws: WebSocket, from: string, msg: SendFrame) {
    if (!msg.clientMsgId || msg.text.length > 65_536) throw new Error('BAD_FRAME');
    const client = await deps.db.connect();
    let seq: number, members: string[];
    try {
      await client.query('BEGIN');
      // Serialise writers per conversation and assign the next seq atomically
      const conv = await client.query(
        'UPDATE conversations SET last_seq = last_seq + 1 WHERE id = $1 AND $2 = ANY(member_ids) RETURNING last_seq, member_ids',
        [msg.convId, from]);
      if (conv.rowCount === 0) throw new Error('NOT_A_MEMBER');
      const ins = await client.query(
        'INSERT INTO messages (conv_id, seq, client_msg_id, sender, text) VALUES ($1,$2,$3,$4,$5) ' +
        'ON CONFLICT (conv_id, client_msg_id) DO NOTHING RETURNING seq',
        [msg.convId, conv.rows[0].last_seq, msg.clientMsgId, from, msg.text]);
      if (ins.rowCount === 0) {                            // retry of an already-stored send
        await client.query('ROLLBACK');                    // undo the seq bump
        const prev = await deps.db.query(
          'SELECT seq FROM messages WHERE conv_id=$1 AND client_msg_id=$2', [msg.convId, msg.clientMsgId]);
        ws.send(JSON.stringify({ type: 'ack', clientMsgId: msg.clientMsgId, seq: prev.rows[0].seq }));
        return;
      }
      await client.query('COMMIT');                        // durable BEFORE the ack
      seq = conv.rows[0].last_seq;
      members = conv.rows[0].member_ids;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    ws.send(JSON.stringify({ type: 'ack', clientMsgId: msg.clientMsgId, seq }));

    // Fan-out asynchronously; never block the sender on recipients
    const frame = { type: 'msg', convId: msg.convId, seq, from, text: msg.text };
    void Promise.allSettled(members.filter((u) => u !== from).map(async (u) => {
      const r = await deps.route(u, frame).catch(() => 'offline' as const);
      if (r === 'offline') await deps.push(u, msg.convId);
    }));
  };
}`,
      },
      explanation: `**Fixes:**
- **Ack before persist** meant a crash lost "sent" messages. Now the message commits first, then the sender gets the ack with its seq.
- **Duplicates on retry:** a client-generated \`clientMsgId\` with a unique constraint \`(conv_id, client_msg_id)\` makes resends idempotent; the retry gets the original seq back (and the seq bump is rolled back).
- **Ordering:** \`now()\` timestamps from different servers can't order messages. The row-level \`UPDATE ... last_seq + 1\` serialises writers per conversation and yields a gap-free monotonic seq; clients render by seq.
- **Membership check:** the same statement verifies the sender belongs to the conversation.
- **Local-only delivery:** the starter only reached sockets on the same server. Routing goes through the session registry to whichever gateway holds each device, and offline users get a push notification.
- **Head-of-line blocking:** awaiting each socket send serially let one slow recipient stall the sender; fan-out is now async with \`allSettled\`.
- At higher scale the Postgres row counter would be replaced by a conversation-sharded sequencer (as in the section), but the invariants are the same.`,
      followUps: [
        {
          "q": "The conversations row is now the per-group bottleneck: a 100K-member broadcast channel gets 2K messages/s. What do you change?",
          "a": "A single-row UPDATE caps per-conversation throughput at a few thousand per second and holds a row lock for the whole transaction. Move sequencing out of the DB: route each conversation to one owner process (consistent hashing with leases) that assigns seq in memory and appends to a partitioned log keyed by convId, batching many messages per write. For broadcast channels, fan-out is the bigger cost: store once, notify subscribers with 'channel has new seq N' and let clients pull."
        },
        {
          "q": "How would you test that retries never duplicate and order is deterministic?",
          "a": "Property-based/integration tests: N concurrent clients send to one conversation through multiple handler instances, with injected faults — drop the ack, kill the handler between COMMIT and ack, duplicate frames. Assert: every clientMsgId appears exactly once, seqs are strictly increasing per conversation, and each client's own messages appear in its send order. Run it under a real Postgres with randomized delays (or Jepsen-style). In production, monitor duplicate-retry hits and seq gaps per conversation."
        }
      ],
    },
    {
      id: 'design-social-cc-2',
      title: 'Stop the feed endpoint from melting down',
      context:
        'The home-feed resolver is p99 3.8 s. Traces show hundreds of DB queries per request, users see duplicate posts while scrolling, and a celebrity with 40M followers has an empty "recent posts" section for most fans.',
      task:
        'Refactor getFeed to use precomputed timelines, merge celebrity posts at read time, hydrate in batches, and paginate stably.',
      starter: {
        language: 'typescript',
        code: `import { db } from './db';

export async function getFeed(userId: string, page: number) {
  const following = await db.query('SELECT followee_id FROM follows WHERE follower_id=$1', [userId]);
  const posts: any[] = [];
  for (const f of following.rows) {
    const r = await db.query(
      'SELECT * FROM posts WHERE author_id=$1 ORDER BY created_at DESC LIMIT 50', [f.followee_id]);
    posts.push(...r.rows);
  }
  posts.sort((a, b) => b.created_at - a.created_at);
  const pageItems = posts.slice(page * 20, page * 20 + 20);
  for (const p of pageItems) {
    p.author = (await db.query('SELECT * FROM users WHERE id=$1', [p.author_id])).rows[0];
    p.likes = (await db.query('SELECT count(*) FROM likes WHERE post_id=$1', [p.id])).rows[0].count;
  }
  return pageItems;
}`,
      },
      hints: [
        'Count the queries for a user following 500 accounts. Which of them can be precomputed at write time?',
        'Offset pages shift when new posts arrive at the top. What stable key can a cursor encode?',
        'Where do celebrity posts come from if they are not fanned out?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';

type Cursor = { score: number; id: string } | null;
const PAGE = 20;

export async function getFeed(
  redis: Redis, userId: string, cursorB64: string | null,
  deps: {
    celebritiesFollowed(userId: string): Promise<string[]>;       // cached, small list
    rebuildTimeline(userId: string): Promise<void>;               // pull-based fallback
    hydratePosts(ids: string[]): Promise<Map<string, { id: string; authorId: string; deleted: boolean }>>;
    hydrateUsers(ids: string[]): Promise<Map<string, object>>;
    likeCounts(ids: string[]): Promise<Map<string, number>>;      // counter cache
    isHidden(viewer: string, authorIds: string[]): Promise<Set<string>>; // blocked/muted
  },
) {
  const cur: Cursor = cursorB64 ? JSON.parse(Buffer.from(cursorB64, 'base64url').toString()) : null;
  const max = cur ? '(' + cur.score : '+inf';                     // exclusive upper bound
  if (!(await redis.exists('feed:' + userId))) await deps.rebuildTimeline(userId);

  const celebs = await deps.celebritiesFollowed(userId);
  const pipe = redis.pipeline();
  pipe.zrevrangebyscore('feed:' + userId, max, '-inf', 'WITHSCORES', 'LIMIT', 0, PAGE * 2);
  celebs.forEach((c) => pipe.zrevrangebyscore('recent:' + c, max, '-inf', 'WITHSCORES', 'LIMIT', 0, PAGE));
  const lists = ((await pipe.exec()) ?? []).map(([, v]) => v as string[]);

  const merged = new Map<string, number>();                        // dedup across sources
  for (const l of lists) for (let i = 0; i < l.length; i += 2) merged.set(l[i], Number(l[i + 1]));
  const ordered = [...merged.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))       // (score, id) total order
    .slice(0, PAGE * 2);

  const posts = await deps.hydratePosts(ordered.map(([id]) => id)); // ONE batched call
  const authorIds = [...new Set([...posts.values()].map((p) => p.authorId))];
  const [users, likes, hidden] = await Promise.all([
    deps.hydrateUsers(authorIds), deps.likeCounts(ordered.map(([id]) => id)), deps.isHidden(userId, authorIds),
  ]);
  const items = ordered
    .filter(([id]) => { const p = posts.get(id); return p && !p.deleted && !hidden.has(p.authorId); })
    .slice(0, PAGE)
    .map(([id, score]) => ({ ...posts.get(id)!, score, author: users.get(posts.get(id)!.authorId), likes: likes.get(id) ?? 0 }));

  const last = items[items.length - 1];
  const nextCursor = last ? Buffer.from(JSON.stringify({ score: last.score, id: last.id })).toString('base64url') : null;
  return { items, nextCursor };
}`,
      },
      explanation: `**Fixes:**
- **N+1 explosion:** 1 + followees + 2 × page queries (≈ 540 for 500 followees). Now: one pipelined Redis call for timeline + celebrity lists, and three batched hydration calls.
- **Precomputation:** normal authors are fanned out on write into \`feed:{user}\`; the read path no longer scans every followee's posts. Missing timelines (inactive users) are rebuilt on demand.
- **Celebrities:** their posts aren't fanned out, so they are merged from \`recent:{celeb}\` at read time — fixing the empty section.
- **Stable pagination:** OFFSET-style pages shift as new posts arrive (duplicates/skips). The cursor encodes (score, id) and the query uses an exclusive score bound. (Ties at the exact same score can be handled by also comparing id, as the sort does.)
- **Filtering at read time:** deleted posts and blocked/muted authors are removed after hydration, which is cheaper than purging timelines.
- **Counts:** likes come from a counter cache instead of \`COUNT(*)\` per post.`,
      followUps: [
        {
          "q": "The cursor uses an exclusive score bound `(score`. Two posts share the same millisecond score and the page boundary falls between them. What happens, and how do you fix it?",
          "a": "The second post has the same score as the cursor, so `(score` excludes it and it's skipped forever. Make the bound inclusive (`score`) and drop entries with score == cursor.score and id >= cursor.id (given the descending (score, id) order) client- or server-side. Better: make scores unique by using Snowflake IDs as the score, since they're time-ordered and unique, so the exclusive bound becomes exact. Add a test with tied scores across a page boundary."
        },
        {
          "q": "A user who's been inactive for a month opens the app and `rebuildTimeline` runs on the request path. They follow 2,000 accounts. How do you keep this fast?",
          "a": "Don't fan-in 2,000 queries synchronously. Serve a first page immediately from a cheap source: merge the `recent:` lists of the top ~50 most-engaged followees in one pipelined call, then trigger a background rebuild that fills `feed:{user}` from all followees. Alternatively, keep timelines warm for users predicted to return (push notification recipients). Track the rebuild rate and its p99; if it's high, the 'active user' threshold for keeping timelines is too aggressive."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-social-iq-01',
      difficulty: 'expert',
      question: 'Design WhatsApp: 1:1 and group messaging for 2B users with delivery/read receipts, multi-device and offline delivery.',
      whatInterviewerLooksFor: [
        'Numbers: ~1M+ msgs/s, ~10^8 concurrent connections',
        'Gateway + session registry + conversation-sharded sequencing',
        'Persist-then-ack, idempotent client retries, per-conversation order',
        'Receipts as cursors, offline sync, push fallback, group fan-out',
        'E2E encryption implications',
      ],
      modelAnswer: `### Numbers
- ~100B msgs/day ≈ **1.2M/s** avg, ~3M/s peak; ~300M concurrent connections → ~300+ gateways at ~1M each.

### Architecture
- **Gateways** (thin; TLS + WebSocket/MQTT, auth, heartbeats). **Session registry** in Redis: user → [device@gateway], TTL refreshed by heartbeat.
- **Chat service** sharded by conversation_id: membership check, dedup by client_msg_id, assign **per-conversation seq**, persist (Cassandra/Scylla, partition (conv, bucket), cluster by seq), ack sender.
- **Router**: deliver to each recipient device's gateway; offline → APNs/FCM push; message waits in storage.
- **Media**: presigned uploads to object storage, CDN download; message carries the reference (and the media key, when E2E).

### Guarantees
- **No loss**: persist → ack (✓). Client retries with same client_msg_id → dedup.
- **Order**: per conversation via single sequencer; client renders by seq.
- **Receipts**: delivered/read **cursors** per member (✓✓, blue ✓✓) — O(members) writes.
- **Offline sync**: device cursors per conversation; "give me after seq N", paginated.
- **Multi-device**: per-device sessions, cursors and keys.

### Groups
- ≤ 1,024 members → fan-out on write to online devices. Presence subscribe-on-view.

### E2E
- Signal protocol (X3DH + Double Ratchet); groups via Sender Keys; server stores ciphertext only — WhatsApp deletes messages from servers after delivery, so history lives on devices (backups encrypted separately).

### Failure modes
- Gateway death → reconnect storm (jittered backoff, resumption tokens). Sequencer shard failover → resume from max persisted seq.`,
      followUps: [
        { q: 'How does "last seen" scale when a user has 2,000 contacts?', a: 'Don’t push presence to all contacts: clients subscribe to presence only for chats currently open or visible; others fetch lazily. Heartbeats with a TTL avoid flapping.' },
        { q: 'A message is sent to a user with 3 devices, one offline for a week.', a: 'Online devices receive it immediately; the offline device syncs from its cursor on reconnect. With E2E, the sender encrypted a copy per device; server keeps the offline device’s copy until delivered or a retention limit (e.g. 30 days).' },
        { q: 'Why not use Kafka topics per user?', a: 'Hundreds of millions of topics/partitions are infeasible; Kafka is great for the internal event bus (receipts, analytics), not per-user mailboxes.' },
      ],
      pitfalls: [
        'Global ordering via timestamps.',
        'Acking before persisting.',
        'Per-message read flags for every group member.',
        'Pushing presence changes to every contact.',
      ],
    },
    {
      id: 'design-social-iq-02',
      difficulty: 'hard',
      question: 'Design the home timeline for Twitter/X: 300M DAU, reverse-chronological first, then ranked.',
      whatInterviewerLooksFor: [
        'Estimates for posts/s, feed reads/s and fan-out inserts/s',
        'Fan-out on write vs read comparison and a hybrid',
        'Timeline cache design and hydration',
        'Cursor pagination and read-your-writes',
        'Ranking pipeline placement',
      ],
      modelAnswer: `### Numbers
- ~100M posts/day ≈ 1.2K/s (peak 10×); ~30K feed reads/s; avg ~200 followers → ~240K timeline inserts/s — skewed by celebrities.

### Write path
- Post service stores post (Snowflake ID) → \`PostCreated\` to Kafka → **fan-out workers**: page followers in batches of 1K, skip inactive (> 30 days), \`ZADD feed:{f}\` + trim to ~800.
- **Celebrities** (> ~100K followers): no fan-out; post goes to \`recent:{author}\`.

### Read path
- \`feed:{me}\` IDs + merge celebrity lists + **my own recent posts** (read-your-writes) → batch hydrate posts, authors, counters, viewer state → filter deleted/blocked → page with a (score, id) cursor.
- Missing timeline → rebuild via pull.

### Ranking
- Candidate set: ~500–1,000 IDs from the above + out-of-network recommendations → ML ranker (engagement predictions) → rules (diversity, ads). Keep a strict latency budget (~100 ms); fall back to chronological.

### Storage
- Posts in a sharded store (by post_id) with cache; follow graph in a graph service with both directions; timelines in Redis replicated across AZs (can be rebuilt, so no durable storage needed).

### Trade-offs
- Push gives fast reads but write amplification and lag for large fan-outs; pull is cheap to write but slow to read. Hybrid bounds both; the threshold is tuned from the follower distribution.`,
      followUps: [
        { q: 'A user follows 5,000 accounts, including 300 celebrities. Does the hybrid still work?', a: 'The celebrity merge becomes 300 list reads per request. Mitigate by caching a precomputed "celebrity mix" per user for a short TTL, or treat mid-tier celebrities as fan-out authors (raise threshold), keeping pull only for the top accounts.' },
        { q: 'How do you handle an unfollow?', a: 'Filter at read time against the current follow set (cached); optionally lazy-purge that author’s IDs from the timeline in the background.' },
      ],
      pitfalls: [
        'Pure fan-out on write for every author.',
        'Offset pagination.',
        'Storing full post bodies in every timeline.',
      ],
    },
    {
      id: 'design-social-iq-03',
      difficulty: 'expert',
      question: 'Design YouTube: upload, transcoding, and streaming to billions of devices with minimal buffering.',
      whatInterviewerLooksFor: [
        'Estimates: storage/day and CDN cost as the dominant cost',
        'Resumable direct-to-storage upload',
        'Transcoding DAG with GOP chunking and parallelism',
        'ABR with HLS/DASH, CDN tiering, cost optimisations',
        'Error handling and view counting',
      ],
      modelAnswer: `### Numbers (book model)
- 5M DAU × 5 views; 10% upload 300 MB → **150 TB/day** raw; CDN ≈ 5M × 5 × 0.3 GB × $0.02 ≈ **$150K/day**. Delivery dominates cost.

### Upload
- API returns resumable multipart presigned URLs; parts retried independently; metadata saved in parallel. Storage event → transcoding job.

### Transcoding
- **Preprocess**: probe, split into **GOP-aligned chunks**, build a **DAG** per content type: encode chunk × rendition (240p–4K, H.264 + VP9/AV1), audio, thumbnails, content-ID fingerprinting, safety classifiers → merge → package HLS/DASH → DRM → publish.
- **DAG scheduler + resource manager + worker pool**, priority queues (popular creators first), temp storage for intermediates. 10-min video → ~1,800 parallel tasks → minutes.

### Streaming
- Manifest + 2–6 s segments per rendition; player ABR by throughput/buffer.
- CDN edge → regional shield → origin; popular videos on CDN, long tail from origin/cheaper regional storage; ISP caches (Google Global Cache).

### Metadata & counts
- Sharded MySQL via Vitess + caches; view events → Kafka → validated windowed aggregation → approximate counters; batch reconciliation.

### Cost levers
- Encode rarely watched videos in fewer renditions (or on demand), modern codecs for popular ones, regional placement.

### Errors
- Retry failed chunk tasks; fail fast on corrupt input; players fail over to the next CDN URL.`,
      followUps: [
        { q: 'A creator with 50M subscribers uploads; millions will watch within minutes. What do you change?', a: 'Prioritise the job, publish a fast low/medium rendition first and add higher rungs as they finish, and pre-warm CDN edges with the first segments of each rendition.' },
        { q: 'How would you support live streaming?', a: 'Ingest via RTMP/SRT to an ingest cluster, transcode in real time to a ladder, package LL-HLS/DASH with short parts, push to CDN; latency target 2–5 s (or WebRTC for sub-second interactivity).' },
      ],
      pitfalls: [
        'Proxying uploads through API servers.',
        'Transcoding whole files sequentially.',
        'Ignoring CDN cost in the design.',
      ],
    },
    {
      id: 'design-social-iq-04',
      difficulty: 'hard',
      question: 'Design Netflix’s video delivery. How is it different from YouTube and why did Netflix build Open Connect?',
      whatInterviewerLooksFor: [
        'Control plane vs data plane separation',
        'Open Connect: ISP-embedded appliances and proactive fill',
        'Steering and ABR at the client',
        'Per-title encoding and catalogue predictability',
      ],
      modelAnswer: `### What's different
- Curated catalogue (tens of thousands of titles), no user uploads, predictable demand, very long viewing sessions, peak-hour concentration (evenings), premium quality (4K HDR). At peak, Netflix has historically been a double-digit share of downstream internet traffic in North America.

### Control plane (AWS)
- Sign-in, profiles, catalogue, recommendations, playback authorisation/DRM licences and **steering**: picks the best Open Connect Appliances for the client's network and returns ranked URLs.

### Data plane (Open Connect)
- **OCAs** placed inside ISPs and at IXPs (free to ISPs — they save transit costs).
- **Proactive fill** during off-peak windows based on predicted regional popularity — no cache-miss storms at 9 pm; OCAs peer-fill from each other.
- Client streams segments over HTTPS from OCAs; ABR selects rungs by throughput/buffer; on OCA failure, fails over to the next steered URL.

### Encoding
- **Per-title / per-shot** encoding with VMAF-guided ladders; multiple codecs (H.264, HEVC, VP9, AV1) chosen per device capability. Encoding is massively parallel on EC2, chunked like YouTube.

### Why build it
- Cost (transit/CDN at Netflix scale), quality (being inside the ISP means fewer congested hops), and control (custom hardware tuned for serving tens of Gbps per box, predictable fill).

### YouTube contrast
- Long-tail UGC with unpredictable popularity → more cache-on-demand, popularity prediction and faster ingest-to-publish paths.`,
      followUps: [
        { q: 'A new season of a hit show launches globally at midnight. What happens?', a: 'It is pre-positioned on OCAs days before via fill; steering spreads load across OCAs; the control plane scales for play-start spikes (auth, licences).' },
        { q: 'What metrics would you watch for streaming quality?', a: 'Play-start time, rebuffer ratio, average bitrate / VMAF, playback failures by ISP/OCA, and fallbacks to lower rungs.' },
      ],
      pitfalls: [
        'Describing Netflix as serving video from AWS directly.',
        'Ignoring the steering service.',
        'Treating Netflix and YouTube caching strategies as identical.',
      ],
    },
    {
      id: 'design-social-iq-05',
      difficulty: 'expert',
      question: 'Deep-dive probe: in your chat design, how exactly do you guarantee per-conversation ordering when senders are on different gateways and the chat service autoscales?',
      context: 'Interviewer pushes: "Two users in the same group send at the same millisecond from different continents."',
      whatInterviewerLooksFor: [
        'Rejects wall-clock ordering; defines order as server-assigned per-conversation seq',
        'Single owner per conversation via consistent hashing / leases',
        'Handles ownership changes during scaling (fencing)',
        'Client rendering rules and optimistic local display',
      ],
      modelAnswer: `### Define the order
- The order is **the order in which the conversation's sequencer accepted messages** — not client clocks, not arrival at gateways. Both users see the same order because both render by seq.

### Single owner per conversation
- Consistent-hash conversation_id → chat-service shard. Ownership is held via a **lease** (etcd/ZooKeeper) with a **fencing token** (epoch).
- The owner assigns \`seq = last_seq + 1\` and persists (conv, seq) with a conditional write keyed on the epoch; a stale owner (after a GC pause or partition) is rejected by storage because its epoch is old.

### Autoscaling / rebalancing
- When a conversation moves: old owner stops accepting (drain), new owner acquires the lease with epoch+1, reads max(seq) from storage, continues. Gateways that hit the old owner get a redirect/retry. A brief pause (~100s of ms) for moved conversations is the price.

### Cross-continent
- One home region per conversation (usually where most members are); remote senders pay one cross-region RTT (~100–200 ms) — acceptable for chat. Multi-leader sequencing would need merge rules and is not worth it.

### Client
- Sender shows the message optimistically ("clock" icon) under its client_msg_id, then **re-sorts** once the server seq arrives. Receivers insert by seq; seq gaps are fine (burned numbers).

### Alternatives
- Snowflake IDs per message give near-order without a single owner but can invert same-ms messages across servers; Lamport/hybrid logical clocks give causality, not a single agreed total order.`,
      followUps: [
        { q: 'What if the owner crashes after persisting seq 1043 but before acking?', a: 'The client retries with the same client_msg_id; the new owner’s dedup lookup finds seq 1043 and acks it — no duplicate, no reorder.' },
        { q: 'Is a Redis INCR sequencer enough?', a: 'Only if exactly one writer per conversation uses it and Redis durability/failover can’t roll back the counter (async replication can lose increments → duplicate seqs). Persisting seq with the message and recovering from max(seq) is safer.' },
      ],
      pitfalls: [
        'Ordering by client or server timestamps.',
        'Assuming Kafka partition order solves it without discussing ownership changes.',
        'Ignoring zombie owners (no fencing).',
      ],
    },
    {
      id: 'design-social-iq-06',
      difficulty: 'hard',
      question: 'Deep-dive probe: a celebrity with 80M followers posts, and followers see it 6–9 minutes late while fan-out workers are pegged. Fix it.',
      whatInterviewerLooksFor: [
        'Diagnoses write amplification of fan-out on write',
        'Hybrid pull for celebrities with read-time merge',
        'Skipping inactive users; prioritising queues',
        'Measures and tunes the threshold',
      ],
      modelAnswer: `### Diagnosis
- One post → 80M \`ZADD\`s. At ~1M inserts/s across the worker fleet, that's ~80 s of *exclusive* capacity — but the queue also carries everyone else's posts, and the backlog pushes all fan-out behind it: **minutes of lag for everyone**, not just the celebrity's followers.

### Fix
1. **Hybrid**: authors above a follower threshold (say 1M, tuned from data) skip fan-out. Their posts go to \`recent:{author}\`; the feed service merges followed celebrities at read time (a handful of extra sorted-set reads per request, pipelined).
2. **Active-only fan-out** for everyone: push only to users active in the last 7–30 days (often < 30–50% of followers); others rebuild on login.
3. **Priority lanes**: separate Kafka topics for fan-out jobs by author size so a big (but sub-threshold) author doesn't block small ones; partition by author to preserve per-author order.
4. **Batch & pipeline** Redis writes (1K followers per pipeline), shard timelines across Redis Cluster.

### Read-time cost check
- 30K feed reads/s × ~5 followed celebrities = 150K extra Redis reads/s — cheap relative to 80M writes per celebrity post.

### Measure
- Fan-out lag p99 (post created → last timeline updated), queue depth by lane, read-path latency added by merging. Tune the threshold where read-merge cost ≈ fan-out cost.`,
      followUps: [
        { q: 'What about users who follow 2,000 celebrities?', a: 'Cap per-request celebrity merges (top N by affinity), cache the merged celebrity mix per user briefly, or push mid-tier celebrities.' },
        { q: 'How do you avoid a notification storm at the same time?', a: 'Push notifications for a celebrity post are a separate, rate-limited campaign-style pipeline, sampled or throttled per user preference.' },
      ],
      pitfalls: [
        'Just adding more fan-out workers.',
        'Making every user pull (destroys read latency).',
        'Not noticing that the backlog delays everyone’s posts.',
      ],
    },
    {
      id: 'design-social-iq-07',
      difficulty: 'hard',
      question: 'Design the view counter and "trending videos" list for a video platform where a viral video can receive 200K views per second.',
      whatInterviewerLooksFor: [
        'Avoids hot-row updates; streams events',
        'Validation/fraud filtering and dedup semantics of a "view"',
        'Windowed aggregation and top-K for trending',
        'Approximate display vs authoritative reconciliation',
      ],
      modelAnswer: `### Define a view
- A view = ≥ 30 s watched (or full watch for shorts) per (viewer/session, video) per time window, excluding bots. This definition drives dedup keys and fraud rules.

### Ingestion
- Players send heartbeat/view events → collectors (validate, first-line dedup by session in Redis SET NX) → **Kafka** keyed by video_id.

### Aggregation
- **Flink**: event-time tumbling windows of 1 min per video, watermarks allowing ~1–2 min lateness, exactly-once sinks (checkpointed) → counter store (Redis for display, Cassandra/ClickHouse for per-minute history).
- Hot key: a single video at 200K events/s concentrates on one partition → **pre-aggregate** in collectors (local counts flushed every second) or **salt** the key (video_id#0..15) and sum in a second stage.

### Trending
- Per region, per 1-hour sliding window, compute **top-K** by velocity (views in last hour vs baseline) using per-partition heaps merged into a global top-K (Count-Min Sketch + heap for approximate heavy hitters at huge cardinality). Refresh every minute; cache.

### Correctness
- Display counts are approximate and eventually consistent; a nightly/batch job recomputes from raw events in S3 (fraud models with more signal), and monetised counts use the reconciled number — the lambda/kappa trade-off.

### Numbers
- 200K events/s × 200 B = 40 MB/s for one video — fine for Kafka if salted over ~16 partitions.`,
      followUps: [
        { q: 'Why not Redis INCR per view directly?', a: 'It works for moderate rates, but a single key on one Redis shard caps around ~100K ops/s and offers no fraud filtering or replay; pre-aggregation + streaming scales and is auditable.' },
        { q: 'How do you handle late mobile events uploaded hours later?', a: 'Accept within allowed lateness into windows; beyond that, route to a correction path that updates historical aggregates via batch reconciliation.' },
      ],
      pitfalls: [
        'UPDATE videos SET views = views + 1.',
        'Counting every play request as a view.',
        'Ignoring hot partitions for viral videos.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-social-boe-1',
      question: 'How many WebSocket gateway servers and how much session-registry memory does a WhatsApp-scale chat need?',
      assumptions: [
        '300M concurrent connections at peak',
        'Each gateway: 64 GB RAM, ~20 KB per idle TLS+WebSocket connection (kernel buffers + app state), CPU sized for heartbeats every 30 s',
        'Target 60% utilisation to absorb a gateway-zone failure',
        'Session registry entry ≈ 150 B per device',
      ],
      steps: [
        { label: 'Memory-bound connections per box', calc: '64 GB × 0.8 usable ÷ 20 KB ≈ 2.6M connections' },
        { label: 'Planned per box (60%)', calc: '~1M connections per gateway (CPU/TLS handshakes and failure headroom bind first)' },
        { label: 'Gateways', calc: '300M ÷ 1M = 300 gateways; + zone-failure headroom (~33%) ≈ 400' },
        { label: 'Heartbeat load', calc: '300M ÷ 30 s = 10M heartbeats/s ≈ 25K per gateway' },
        { label: 'Session registry', calc: '300M × 150 B ≈ 45 GB → Redis Cluster ~6 shards × 3 replicas' },
      ],
      answer: '~300–400 gateways at ~1M connections each, handling ~10M heartbeats/s, plus a ~45 GB Redis session registry.',
      insight: 'Connections are cheap in memory but expensive to re-establish (TLS + auth + sync), so the real sizing constraint is the reconnect storm when a gateway or zone fails — headroom and resumption tokens matter more than raw capacity. Heartbeat TTL writes (10M/s) must not hit Redis individually: batch them or keep liveness at the gateway and only write the registry on connect/disconnect.',
      followUps: [
        {
          "q": "A whole availability zone holding a third of the gateways fails. What does the reconnect storm look like, and how do you survive it?",
          "a": "~100M devices reconnect at once. Each reconnect is a TLS handshake + auth + sync. If clients retry immediately, the remaining ~267 gateways face ~100M handshakes within seconds — far beyond the maybe 10–20K handshakes/s each can do, so it takes 100M ÷ (267 × 15K) ≈ 25 s at best and cascades at worst. Survive with client-side exponential backoff with jitter spread over minutes, TLS session resumption tickets to skip full handshakes, admission control at the LB, and lazy sync (fetch history only when a chat opens)."
        },
        {
          "q": "Mobile OS restrictions push heartbeats from every 30 s to every 4 minutes. What changes in the sizing?",
          "a": "Heartbeat load drops 8×: 300M ÷ 240 s = 1.25M/s, ~3K per gateway — CPU largely frees up. But dead-connection detection now takes up to ~4–8 minutes, so the session registry holds stale routes longer and messages are sent into dead sockets. Compensate with delivery acks per message (re-route via push if no ack within seconds) and TCP keepalive at the server. Memory per box is unchanged, so gateway count stays ~300–400; the trade is freshness of presence and routing."
        }
      ],
    },
    {
      id: 'design-social-boe-2',
      question: 'Estimate the Redis memory for precomputed home timelines and the fan-out insert rate for a 300M-DAU social network.',
      assumptions: [
        '300M DAU (only these get timelines); 800 post IDs per timeline',
        'Sorted set member (8-byte ID stored as string ~19 chars) + score + skiplist/dict overhead ≈ 80 B per entry',
        '100M posts/day, average 200 followers, 40% of followers active',
        'Celebrities (≥1M followers) excluded from fan-out, ~20% of follow edges',
      ],
      steps: [
        { label: 'Timeline entries', calc: '300M × 800 = 2.4 × 10^11 entries' },
        { label: 'Memory', calc: '2.4 × 10^11 × 80 B ≈ 19 TB (+ replication ×2 ≈ 38 TB)' },
        { label: 'Compact encoding', calc: 'Store 8-byte binary IDs in a capped list or custom structure ≈ 16 B/entry → ~4 TB' },
        { label: 'Fan-out inserts', calc: '100M × 200 × 0.8 (non-celebrity) × 0.4 (active) ÷ 86,400 ≈ 74K inserts/s avg; peak ×5 ≈ 370K/s' },
      ],
      answer: '~19 TB (naive zsets) down to ~4 TB with compact encodings, and ~75K timeline inserts/s average (~370K/s peak).',
      insight: 'Memory, not QPS, is the pain: this pushes towards shorter timelines (e.g. 300–800 IDs), compact binary storage, only materialising timelines for active users, and treating the cache as rebuildable (no durable storage needed). The insert rate is easily handled by a sharded Redis fleet with pipelining.',
      followUps: [
        {
          "q": "DAU grows to 1B and you can't triple the Redis budget. Which assumption do you attack first?",
          "a": "Materialise timelines only for users active in the last ~7 days rather than all DAU-equivalents, and shrink entries. At 1B × 800 × 16 B (compact binary) ≈ 12.8 TB, versus 64 TB for naive zsets. Cutting the cached length to 300 IDs (most sessions never scroll past ~100 items) gives 1B × 300 × 16 B ≈ 4.8 TB — about today's compact footprint. Deeper scrolls fall back to a pull-based merge from post storage, which is rare and slower but acceptable."
        },
        {
          "q": "Average fan-out is fine, but a 5M-follower account sits just below the celebrity cutoff. What happens when it posts, and how do you smooth it?",
          "a": "One post creates 5M × 0.4 active ≈ 2M inserts, about 27 seconds of the entire average fan-out capacity (74K/s), so normal users' posts queue behind it. Lower the celebrity threshold, or make it dynamic based on active followers. Isolate large fan-outs in a separate queue/worker pool so small accounts keep low latency, and split big fan-outs into chunks of ~10K followers processed in parallel. Prioritise recently active followers first so the people likely to look see the post soonest."
        }
      ],
    },
    {
      id: 'design-social-boe-3',
      question: 'For a video platform, estimate daily transcoding compute and storage for renditions, given 500 hours of uploads per minute.',
      assumptions: [
        '500 hours/min uploaded = 720K hours/day',
        'Rendition ladder: 6 H.264 rungs; encode speed ~1× realtime per rung per 8-vCPU worker for 1080p-ish averages',
        'Total bitrate across all rungs ≈ 10 Mbps of video per content-second',
        'Only 20% of uploads get the full ladder + VP9/AV1; the long tail gets 3 rungs',
      ],
      steps: [
        { label: 'Content seconds/day', calc: '720K h × 3,600 ≈ 2.6 × 10^9 s' },
        { label: 'Encode-seconds (weighted)', calc: '2.6e9 × (0.2 × 6 + 0.8 × 3) = 2.6e9 × 3.6 ≈ 9.3 × 10^9 worker-seconds/day' },
        { label: 'Workers needed', calc: '9.3e9 ÷ 86,400 ≈ 108K workers (8 vCPU) ≈ 860K vCPUs continuously (+ AV1 for popular titles adds more)' },
        { label: 'Rendition storage', calc: '2.6e9 s × 10 Mbps ÷ 8 ≈ 3.25 × 10^9 MB ≈ 3.25 PB/day (full-ladder upper bound)' },
        { label: 'With long-tail savings', calc: '≈ 0.2 × 3.25 + 0.8 × 3.25 × 0.4 ≈ 1.7 PB/day' },
      ],
      answer: 'Order of ~100K encode workers (~1M vCPUs) running continuously and ~1.5–3 PB/day of rendition storage.',
      insight: 'Transcoding and storage costs scale with uploads, while value scales with views — so tiering by popularity (fewer rungs and cheaper codecs for the long tail, AV1 only for heavily watched videos, custom encode hardware like YouTube’s Argos VCU) is where the money is.',
      followUps: [
        {
          "q": "Uploads double during a viral trend, but you can't double the encode fleet within a day. What do you do?",
          "a": "Degrade the ladder, not the publish: encode only 2–3 rungs (360p, 720p) up front, which cuts encode-seconds per upload by roughly a third versus the weighted 3.6 rungs, and queue the remaining rungs and VP9/AV1 for later. Prioritise by predicted popularity (channel size, early views), and burst onto spot/preemptible instances since chunks are retryable. Videos that later become popular get the full ladder backfilled. Watch time-to-publish per tier as the SLO."
        },
        {
          "q": "Storage grows ~1.7 PB/day forever. What retention or tiering policy keeps that sustainable?",
          "a": "Views follow a power law and decay with age, so tier by recent views: hot renditions on standard object storage, cold videos to infrequent-access/archive classes at a fraction of the cost. For videos with no views in a year, delete the high rungs and keep the mezzanine/original in archive storage plus one low rung, re-transcoding on demand if they revive. 1.7 PB/day is ~620 PB/year, so even moving 80% to archive tiers is worth tens of millions per year."
        }
      ],
    },
  ],
  test: [
    {
      id: 'design-social-mcq-01',
      difficulty: 'hard',
      question: 'A chat server acks the sender ("✓") immediately on receipt, then writes to Cassandra asynchronously. What is the most serious consequence?',
      options: [
        'Messages the sender believes were sent can be lost if the server crashes before the write',
        'Higher latency for the sender',
        'Messages will be delivered out of order to recipients',
        'Read receipts stop working for group chats',
      ],
      correct: [0],
      explanation: 'The ack is the durability promise; acking before persisting means a crash between the ack and the write loses the message silently — the client won’t retry because it believes it succeeded. Latency actually improves. Ordering and receipts are separate concerns governed by sequencing and cursors.',
      followUps: [
        {
          "q": "Product pushes back: persisting to a quorum before acking adds ~15 ms. Is there a way to ack fast and still never lose a message?",
          "a": "Make the client the durability anchor: the client keeps every unacked message in a local outbox with its `clientMsgId` and retries until it gets a server ack carrying a seq. The server may only ack after a durable write, but that write can be cheap: an append to a replicated commit log (Kafka with acks=all, ~2–5 ms in-zone) rather than a Cassandra quorum write, with the Cassandra write done asynchronously from the log. The tick then means 'replicated in the log', which survives a chat-server crash."
        }
      ],
    },
    {
      id: 'design-social-mcq-02',
      difficulty: 'expert',
      question: 'Two gateways forward messages for the same group to two different chat-service instances, each assigning order using Date.now(). Which problems can occur? Select ALL that apply.',
      options: [
        'Members can see different orders if clients sort by arrival instead of a server-assigned key',
        'Two messages in the same millisecond have no deterministic order',
        'Clock skew between instances can place a reply before the message it answers',
        'Cassandra will reject the second write because the timestamp already exists',
      ],
      correct: [0, 1, 2],
      explanation: 'Wall-clock ordering from multiple writers breaks under same-ms ties and skew (a reply can sort before its parent), and arrival order differs per client. Cassandra doesn’t reject duplicate timestamps — with the same primary key it silently overwrites (last-write-wins), which is arguably worse. The fix is a single sequencer per conversation.',
      followUps: [
        {
          "q": "You route each group to a single sequencer owner. That owner's node dies mid-burst. How do you avoid duplicate or reused sequence numbers on failover?",
          "a": "Ownership must be leased with an epoch (e.g. via etcd/ZooKeeper or a shard map). The new owner takes the lease with epoch+1, reads the last persisted seq from storage and continues from there. Writes are conditioned on the epoch, so a zombie old owner that resumes after a GC pause has its writes rejected. Seqs the old owner handed out but never persisted become gaps; clients must tolerate gaps (they only need monotonic order), and sender retries with the same clientMsgId get re-assigned once."
        }
      ],
    },
    {
      id: 'design-social-mcq-03',
      difficulty: 'hard',
      question: 'Read receipts for groups are implemented like this. What is the scaling problem?',
      code: {
        language: 'sql',
        code: `-- on every message view, for every message on screen:
INSERT INTO message_reads (conv_id, seq, user_id, read_at)
VALUES ($1, $2, $3, now());
-- "seen by" = SELECT count(*) FROM message_reads WHERE conv_id=$1 AND seq=$2`,
      },
      options: [
        'None — one row per read is the normalised design',
        'The count(*) must use an index on read_at',
        'Writes grow as messages × members (a 500-member group with 1,000 messages/day = 500K rows/day per group); a per-member last_read_seq cursor gives the same information with O(members) state',
        'It breaks E2E encryption because read_at is plaintext',
      ],
      correct: [2],
      explanation: 'Per-message read rows explode for groups. Because reading is monotonic within a conversation, one cursor per member (last_read_seq) encodes "read everything up to N"; "seen by" for message N is the count of members with cursor ≥ N. Indexing read_at doesn’t fix the write volume, and receipt metadata is not the E2E concern here.',
      followUps: [
        {
          "q": "With per-member `last_read_seq` cursors, the sender wants 'Read by 3 of 499' to update live in a 500-member group. How do you avoid broadcasting every cursor move to all members?",
          "a": "Only the message's author cares about read counts for their messages, and only while viewing. So send cursor updates to the conversation's owner/sequencer, which coalesces them (e.g. every 1–2 s) and pushes an aggregate 'read count up to seq N' only to members currently subscribed with the chat open. Many apps also cap detailed receipts to small groups (WhatsApp shows per-person info on demand) and show aggregate counts for big groups, computed on request from the cursor table."
        }
      ],
    },
    {
      id: 'design-social-mcq-04',
      difficulty: 'medium',
      question: 'Which protocol choice is most appropriate for a mobile chat app’s real-time send/receive path?',
      options: [
        'Short polling every 2 seconds over HTTPS',
        'Server-Sent Events for both sending and receiving',
        'Mobile push notifications (APNs/FCM) as the only delivery channel',
        'A persistent WebSocket (or MQTT) connection with heartbeats, plus HTTPS for non-real-time APIs',
      ],
      correct: [3],
      explanation: 'A persistent full-duplex connection gives low latency both ways with minimal overhead; HTTPS remains for login, history and uploads. Short polling wastes battery and adds latency. SSE is server→client only. Push notifications are best-effort wake-ups with payload limits, used for offline users, not as the main channel.',
      followUps: [
        {
          "q": "The app is backgrounded on iOS and the OS kills the WebSocket after ~30 s. How does a new message still reach the user, and how does the app catch up when reopened?",
          "a": "When the gateway reports the device offline, the chat service sends an APNs/FCM push — a wake-up with the sender name or an encrypted preview, not the full payload. On reopen, the client reconnects and sends its last received seq per conversation (or a global sync cursor); the server returns everything after it from storage, paginated. The push is best-effort and may be dropped or coalesced, so correctness lives in the sync-on-connect protocol, never in push delivery."
        }
      ],
    },
    {
      id: 'design-social-mcq-05',
      difficulty: 'expert',
      question: 'This presence implementation pushes a status change to every contact. A user with 3,000 contacts toggles network 10 times a minute. What is the best redesign?',
      code: {
        language: 'typescript',
        code: `async function onStatusChange(userId: string, online: boolean) {
  const contacts = await graph.contacts(userId);           // ~3,000
  await Promise.all(contacts.map((c) => router.send(c, { type: 'presence', userId, online })));
}`,
      },
      options: [
        'Batch the 3,000 sends into one Kafka message',
        'Debounce with a TTL-based online flag (tolerate brief disconnects) and push presence only to users who currently have this user’s chat/contact list open (subscribe-on-view)',
        'Store presence in Postgres and let clients poll every second',
        'Send presence only via push notifications',
      ],
      correct: [1],
      explanation: 'Presence changes are high-frequency and low-value to most contacts. A heartbeat/TTL flag stops flapping, and subscribe-on-view limits fan-out to the few users actually looking. Batching into Kafka doesn’t reduce delivery work; polling moves the load to the DB; push notifications for presence would be absurd.',
      followUps: [
        {
          "q": "With subscribe-on-view, a user opens a chat list showing 40 contacts. How do they get initial presence, and what happens when 5M users open the app at 9 a.m.?",
          "a": "On open the client sends one batched subscribe for the 40 visible contacts; the presence service answers with a bulk read (Redis MGET of TTL keys) and then streams deltas. The 9 a.m. burst is 5M × 40 = 200M key reads in a few minutes, so shard presence keys, serve batch reads from replicas, and coarsen what you show ('last seen recently') so cached values are acceptable. Unsubscribe on screen exit or connection drop, or the subscription tables leak."
        }
      ],
    },
    {
      id: 'design-social-mcq-06',
      difficulty: 'expert',
      question: 'Fan-out on write with ZADD to followers’ timelines is being redelivered by Kafka after a consumer crash. What happens?',
      code: {
        language: 'typescript',
        code: `pipe.zadd('feed:' + followerId, createdAtMs, postId);
pipe.zremrangebyrank('feed:' + followerId, 0, -801);`,
      },
      options: [
        'Duplicate entries appear in timelines',
        'The trim deletes the newest 800 entries',
        'The replay is idempotent: ZADD with the same member just updates its score, so no duplicates',
        'Redis rejects the second ZADD with an error',
      ],
      correct: [2],
      explanation: 'Sorted-set members are unique; re-adding the same postId with the same score is a no-op, so redelivery is safe (unlike LPUSH onto a list, which would duplicate). ZREMRANGEBYRANK 0..-801 removes the lowest-scored (oldest) entries beyond the newest 800, not the newest.',
      followUps: [
        {
          "q": "Redelivery is idempotent, but the author deletes a post while fan-out to 50K followers is still running. What do followers see, and how do you handle it?",
          "a": "Fan-out workers may insert the post ID into some timelines after the delete. Don't chase it: the read path hydrates posts and drops ones marked deleted, so stale IDs are invisible. Optionally, workers check a deleted-post bloom/set before inserting to save space, and a lazy cleanup removes dead IDs when a timeline is read. Hard purge is only needed for legal takedowns, where a separate job scans and ZREMs the ID by follower list."
        }
      ],
    },
    {
      id: 'design-social-mcq-07',
      difficulty: 'expert',
      question: 'You run a hybrid feed: fan-out on write for normal users, pull for celebrities. Which of these still need handling at read time? Select ALL that apply.',
      options: [
        'Merging recent posts of followed celebrities',
        'Showing the viewer’s own just-created post (read-your-writes) before fan-out completes',
        'Filtering posts from accounts the viewer unfollowed or blocked after fan-out',
        'Assigning Snowflake IDs to posts',
      ],
      correct: [0, 1, 2],
      explanation: 'Celebrity posts are never in the timeline so must be merged; the author’s own post may not yet be fanned out, so merge the author’s recent posts; and unfollow/block after fan-out leaves stale IDs that are cheaper to filter than to purge. ID assignment happens at write time in the post service.',
      followUps: [
        {
          "q": "The read path now merges 300 followed celebrities' recent lists. p99 climbs to 400 ms. How do you bound the merge cost?",
          "a": "Don't fetch all 300 per request. Cache each celebrity's recent list (it's shared by millions of followers, so it's hot and cheap), fetch only posts newer than the viewer's last-seen cursor, and cap the merge to the K celebrities with the most recent activity using a per-user 'celebs with new posts since T' check. Or pre-merge: a periodic job materialises a per-user celebrity slice for heavy users. The core idea: merge cost should scale with new celebrity posts, not with celebrities followed."
        }
      ],
    },
    {
      id: 'design-social-mcq-08',
      difficulty: 'hard',
      question: 'A feed API uses ?page=N with OFFSET. Users scrolling during a busy event report seeing the same post twice. Why, and what fixes it?',
      options: [
        'New posts inserted at the top shift every item down, so page N+1 repeats items from page N; use a cursor on (score, id) with an exclusive bound',
        'Caching bug; disable the CDN for the feed',
        'Replication lag between replicas; read from the primary',
        'Ranking is non-deterministic; seed the ranker',
      ],
      correct: [0],
      explanation: 'OFFSET is relative to the current head; inserts at the top shift the window, causing duplicates (or skips on deletes). A keyset cursor anchored on the last seen (score, id) is stable. Replication lag and caching can cause staleness but not systematic duplicates on scroll. Non-deterministic ranking is a separate issue solved by caching the ranked candidate list per session.',
      followUps: [
        {
          "q": "The feed is ranked, not chronological, and scores change between requests. How does a cursor stay stable?",
          "a": "Freeze the candidate list per session: on the first request, rank a candidate set (e.g. 500 items) and cache the ordered IDs under a session key with a TTL of ~30 min. The cursor is simply a position in that snapshot. New posts appear only via a 'new posts' pill or on refresh, which starts a new snapshot. Re-ranking on every page would reshuffle items and cause the same duplicates/skips as OFFSET."
        }
      ],
    },
    {
      id: 'design-social-mcq-09',
      difficulty: 'medium',
      question: 'Why do video platforms split an upload into GOP-aligned chunks before encoding?',
      options: [
        'Because CDNs can only cache files under 10 MB',
        'To encrypt each chunk with a different DRM key',
        'Because HLS requires every segment to be exactly one GOP',
        'Each chunk starts with a keyframe and can be decoded/encoded independently, enabling massive parallel encoding and per-chunk retries',
      ],
      correct: [3],
      explanation: 'A GOP begins with an I-frame, so chunks split at GOP boundaries don’t depend on each other, letting thousands of workers encode in parallel and retry failed chunks independently. CDNs cache large files fine; DRM keys rotate on a different basis; HLS segments must start with keyframes but may contain multiple GOPs.',
      followUps: [
        {
          "q": "Your chunked encode job has 2,000 chunks; three fail repeatedly on one worker type. How do you keep the video's publish time bounded?",
          "a": "Retry each failed chunk independently with backoff on a different worker/instance type, and cap retries; a deterministic failure (corrupt input frames) should be diagnosed, not retried forever. Publish progressively: make lower rungs available once all their chunks finish, so the video goes live at 360p/480p while higher rungs complete. Track per-chunk state in the job DAG and alert on stuck chunks. Stitching validates timestamps across chunk boundaries so a re-encoded chunk splices cleanly."
        }
      ],
    },
    {
      id: 'design-social-mcq-10',
      difficulty: 'hard',
      question: 'A player’s throughput estimate drops from 6 Mbps to 1.8 Mbps mid-stream. Given the ladder below, what should a throughput-based ABR do for the next segment?',
      code: {
        language: 'text',
        code: `240p  400 kbps
480p  1400 kbps
720p  2800 kbps
1080p 5000 kbps
(safety factor: use <= 80% of measured throughput)`,
      },
      options: [
        'Stay on 1080p until the buffer is empty to avoid quality flicker',
        'Switch to 480p (1.4 Mbps ≤ 0.8 × 1.8 = 1.44 Mbps)',
        'Switch to 720p because 2.8 Mbps is closest to 1.8 Mbps',
        'Pause playback and rebuffer at 1080p',
      ],
      correct: [1],
      explanation: '80% of 1.8 Mbps is 1.44 Mbps, so the highest rung that fits is 480p at 1.4 Mbps. Choosing 720p exceeds available bandwidth and drains the buffer. Staying at 1080p guarantees a stall. Buffer-based algorithms might delay the down-switch while the buffer is full, but not indefinitely at 1080p.',
      followUps: [
        {
          "q": "The throughput estimate oscillates between 1.5 and 3.5 Mbps every few seconds on a train. What does a pure throughput rule do, and what do production players add?",
          "a": "It flips between 480p and 720p every segment — visible quality flicker and wasted downloads. Players smooth with an EWMA or harmonic mean of recent throughput, add hysteresis (switch up only after sustained headroom, switch down quickly), and use buffer-based control (BOLA-style): with a 30 s buffer you can ride out dips without down-switching, while a near-empty buffer forces the lowest safe rung. Measure rebuffer ratio and switch frequency per session to tune it."
        }
      ],
    },
    {
      id: 'design-social-mcq-11',
      difficulty: 'expert',
      question: 'Which statements about Netflix Open Connect are accurate? Select ALL that apply.',
      options: [
        'Appliances are placed inside ISP networks and at internet exchange points',
        'Popular content is proactively pushed to appliances during off-peak fill windows',
        'Video segments are streamed from AWS S3 via CloudFront for most plays',
        'The control plane in AWS steers each client to specific appliances',
      ],
      correct: [0, 1, 3],
      explanation: 'Open Connect embeds OCAs in ISPs/IXPs, pre-fills them off-peak based on predicted demand, and AWS-hosted services (including steering) direct clients to the best OCAs. Video bytes are served from OCAs, not from S3/CloudFront, for essentially all playback.',
      followUps: [
        {
          "q": "An ISP's embedded appliance cluster fails during prime time. What happens to those subscribers' streams?",
          "a": "The steering service in AWS stops sending clients to the failed appliances based on health reports, and players already fetching segments fail over to the alternate URLs in their manifest — typically appliances at a nearby IXP. Bytes now cross the ISP's peering links instead of staying internal, so the ISP's interconnect capacity becomes the constraint; if it saturates, players downshift bitrate. Netflix capacity-plans such failures by placing popular titles on multiple sites and keeping peering headroom."
        }
      ],
    },
    {
      id: 'design-social-mcq-12',
      difficulty: 'expert',
      question: 'This view counter is used for a viral video. What breaks first?',
      code: {
        language: 'sql',
        code: `UPDATE videos SET view_count = view_count + 1 WHERE id = $1;
-- called once per play start, ~150,000 times/second for one video`,
      },
      options: [
        'Row-lock contention on one hot row serialises all updates (and each creates a new tuple version + WAL), capping throughput far below 150K/s',
        'Nothing — Postgres handles 150K updates/s on one row with SSDs',
        'Integer overflow of view_count',
        'The index on id becomes unbalanced',
      ],
      correct: [0],
      explanation: 'Every update takes the same row lock, so they serialise; MVCC creates a new tuple per update, bloating the table and WAL. Single-row throughput is typically in the low thousands per second. bigint overflow is not a concern, and B-tree balance is unaffected. Stream events and aggregate instead.',
      followUps: [
        {
          "q": "You move to streamed events aggregated in a stream processor. The creator wants to see the count tick up live. How fresh can it be, and what do you show?",
          "a": "Aggregate per video per few seconds in the stream job (salted keys for viral videos, then a second-stage sum), and write the running total to a cache like Redis every 1–5 s. Clients poll or subscribe at that cadence, so the count is seconds stale — acceptable for display. The authoritative count (after bot/fraud filtering and dedup) is computed later and may be lower, which is why platforms sometimes freeze or delay counts around thresholds while validation catches up."
        }
      ],
    },
    {
      id: 'design-social-mcq-13',
      difficulty: 'expert',
      question: 'Your Cassandra messages table uses PRIMARY KEY (conv_id, seq). A 6-year-old company-wide group chat now has read latency spikes and GC pauses. What is the most likely cause and fix?',
      options: [
        'Too many conversations; add nodes',
        'Missing secondary index on seq',
        'One unbounded partition holding millions of messages; add a time bucket to the partition key, e.g. ((conv_id, bucket), seq)',
        'Consistency level too high; use ONE',
      ],
      correct: [2],
      explanation: 'Partitioning only by conv_id lets a busy conversation grow into a multi-GB partition, which hurts compaction, repair, caching and heap. Bucketing by time bounds partition size (Discord’s approach). More nodes don’t split a single partition; seq is already a clustering column; lower consistency doesn’t fix partition size.',
      followUps: [
        {
          "q": "You add a monthly bucket to the partition key. How does the client load 'the latest 50 messages' if the last message was 4 months ago?",
          "a": "The reader doesn't know which buckets are non-empty, so walking backwards month by month could hit many empty partitions. Store the conversation's latest bucket (and ideally a list of non-empty buckets) in the conversation metadata row, which is updated on every write. Read the newest bucket, and if it has fewer than 50 messages, continue to the previous non-empty one. Choose the bucket size based on message rate so partitions stay ~10–100 MB."
        }
      ],
    },
    {
      id: 'design-social-mcq-14',
      difficulty: 'medium',
      question: 'An interviewer asks where the money goes in a YouTube-like system. Which answer is best supported by the numbers?',
      options: [
        'Metadata database licences',
        'Kafka clusters for view events',
        'API servers for upload endpoints',
        'CDN/egress bandwidth for serving video, followed by transcoding compute and storage',
      ],
      correct: [3],
      explanation: 'With ~150 TB/day uploads and billions of views, serving bytes dominates: the book’s model gives ~$150K/day for CDN alone. Transcoding and rendition storage come next. Metadata, Kafka and API servers are comparatively small line items.',
      followUps: [
        {
          "q": "Finance asks you to cut CDN egress 30% without hurting quality. What levers do you pull?",
          "a": "Better codecs for popular content: AV1/VP9 save ~30–50% bits vs H.264 at equal quality, and since a small share of videos gets most views, re-encoding only the head is cheap. Per-title/per-shot encoding ladders avoid wasting bits on simple content. Cap default resolution on small screens and on cellular. Push more traffic to ISP-embedded caches (cheaper settlement-free peering versus transit). Measure via bytes per view-hour and quality metrics (VMAF, rebuffer ratio) to prove no regression."
        }
      ],
    },
    {
      id: 'design-social-mcq-15',
      difficulty: 'hard',
      question: 'You enable E2E encryption (Signal protocol) in your chat app. Which capabilities become impossible or must move to the client? Select ALL that apply.',
      options: [
        'Server-side full-text search over message content',
        'Server-side spam/abuse classification of message text',
        'Routing messages to the recipient’s devices',
        'Server-generated link previews from message URLs',
      ],
      correct: [0, 1, 3],
      explanation: 'With E2E the server only sees ciphertext and routing metadata, so content search, content-based moderation and server-fetched link previews must be done on devices (or dropped, or rely on user reports/metadata signals). Routing needs only metadata (recipient, device), which the server still has.',
      followUps: [
        {
          "q": "Trust & Safety still needs to fight spam in an E2E-encrypted app. What can the server use, and what can't it?",
          "a": "It can use metadata: send rate, new account age, number of distinct recipients, fan-out to non-contacts, reports, block rate and phone-number reputation — enough to rate-limit or ban spammers. It can't read content, so content signals come from user reports (which include the reported messages, decrypted on the reporter's device and voluntarily forwarded) and optional on-device classifiers. Forwarding limits (e.g. 'forwarded many times' labels and caps) slow viral misinformation without reading text."
        }
      ],
    },
  ],
};

export default topic;
