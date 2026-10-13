import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-storage',
  phase: 'designs',
  order: 6,
  title: 'Storage Systems: Dropbox/Google Drive, Distributed Email & Distributed File System',
  subtitle:
    'Three case studies about keeping user bytes safe at petabyte scale: file sync with block-level dedup and delta sync, a Gmail-scale email service, and a GFS/HDFS-style distributed file system with leases and replication.',
  estimatedMinutes: 140,
  sources: [
    'Alex Xu — System Design Interview Vol 1, Ch 15 Design Google Drive',
    'Alex Xu & Sahn Lam — System Design Interview Vol 2, Ch 8 Distributed Email Service',
    'Alex Xu & Sahn Lam — System Design Interview Vol 2, Ch 9 S3-like Object Storage (for comparison)',
    'Ghemawat, Gobioff, Leung — The Google File System (SOSP 2003)',
    'Apache Hadoop HDFS Architecture Guide',
    'Dropbox Tech Blog — Streaming file synchronization; Magic Pocket',
  ],
  tags: ['dropbox', 'google-drive', 'file-sync', 'chunking', 'dedup', 'email', 'smtp', 'imap', 'gfs', 'hdfs', 'replication', 'leases'],
  cheatSheet: [
    'File sync = metadata service (strongly consistent RDBMS) + block store (S3-like, immutable content-addressed blocks) + notification service (long poll/WebSocket).',
    'Split files into ~4 MB blocks, name each block by SHA-256; upload only blocks the server lacks (dedup), and after an edit only changed blocks (delta sync). Content-defined chunking survives inserts.',
    'Commit a new file version with optimistic concurrency (base_version); on mismatch, keep both copies as a "conflicted copy" rather than silently losing data.',
    'Clients learn about changes via long polling on a cursor, then pull the delta list from the metadata API; the notification channel carries no file data.',
    'Email: SMTP to send/receive between servers, IMAP/POP (or HTTP/JSON for webmail) to read. Ch 8 sizing: 1B users → ~100K send QPS, ~730 PB/yr metadata, ~1,460 PB/yr attachments.',
    'Email metadata lives in a wide-column store partitioned by user_id (all of a mailbox on one partition), with denormalised tables per folder and read/unread; attachments go to object storage.',
    'Email favours consistency over availability for a mailbox (single primary per mailbox); deliverability needs SPF, DKIM, DMARC, IP warm-up and bounce/complaint handling.',
    'GFS/HDFS: one master/NameNode holds all metadata in RAM (~64–150 bytes per chunk/block/file); chunkservers/DataNodes store 64/128 MB chunks with 3× rack-aware replication.',
    'GFS writes: the master grants a 60 s lease to a primary replica, which orders mutations; data is pipelined along a chain of replicas, and control flow is separate from data flow.',
    'DFS resilience: heartbeats, prioritised re-replication, per-block checksums, erasure coding (RS 6+3 ≈ 1.5× overhead vs 3×) for cold data, NameNode HA via shared edit log (QJM) + ZKFC failover.',
  ],
  sections: [
    {
      heading: 'Three storage designs and how they differ',
      body: `**Intuition:** all three designs store user bytes durably, but their shape differs. Dropbox syncs *mutable files* across many devices. Email stores *immutable messages* and needs rich per-user queries. A distributed file system (GFS/HDFS) streams *huge files* to batch jobs at high throughput.

| | Dropbox / Google Drive | Distributed email (Gmail) | GFS / HDFS |
|---|---|---|---|
| Unit of data | file (split into ~4 MB blocks) | message + attachments | file split into 64/128 MB chunks |
| Mutation pattern | edits, renames, moves, conflicts across devices | write-once, then flags (read, labels, folder) | append-mostly, write-once-read-many |
| Hard problem | sync + dedup + conflicts | metadata at 1B users, search, deliverability | metadata scale, replication, failure recovery |
| Consistency need | strong for metadata (file tree), blocks immutable | strong per mailbox | relaxed for concurrent appends (GFS), single-writer (HDFS) |
| Typical access | many small reads/writes from end devices | recent emails first, per-user search | large sequential reads by MapReduce/Spark |
| Where bytes live | object store (S3 or Dropbox's Magic Pocket) | object store for attachments, wide-column for metadata | chunkservers' local disks |

**A shared pattern:** separate **metadata** (small, queried, strongly consistent) from **data** (huge, immutable or append-only, content-addressed or chunked). Every design below follows it. Object storage internals (S3's data nodes, placement, erasure coding and multipart upload) are covered in the *object-storage* topic. Here we treat S3 as a building block and focus on what sits above or beside it.

**In interviews say this:** "I'll separate the metadata path from the data path. Metadata goes in a strongly consistent store sized for QPS. Bytes go in a durable blob or chunk layer sized for capacity and throughput, and clients move bytes directly to it."`,
      keyPoints: [
        'Split metadata (small, consistent) from data (large, immutable/appended).',
        'Mutation pattern drives the design: sync conflicts vs write-once vs append.',
        'S3 internals are a building block here; see the object-storage topic.',
      ],
    },
    {
      heading: 'Dropbox / Google Drive (1/4): requirements, estimation, API and data model',
      body: `**Functional:** upload/download files, sync across devices, file revisions (e.g. 30 days), sharing with permissions, change notifications. Out of scope unless asked: real-time co-editing (that's Google Docs, a different design), full-text search.

**Non-functional:** **never lose or corrupt data** (durability 11 nines at the blob layer), fast sync, low bandwidth use (mobile), and scale to hundreds of millions of users.

**Estimation (Vol 1 Ch 15):**
- 50M signed-up users, 10M DAU, 10 GB free each → **500 PB allocated** (actual usage is far lower; dedup and compression reduce it further).
- 2 uploads/user/day, 500 KB average → 10M × 2 ÷ 86,400 ≈ **240 uploads/s**, peak ≈ 480/s.
- Read:write ≈ 1:1 for sync (each write is fetched by the user's other devices).

**API (all over HTTPS):**

| Endpoint | Purpose |
|---|---|
| POST /v1/files/upload-session | { path, size, blockHashes[] } → which hashes are missing + presigned URLs for them |
| PUT {presignedUrl} | client uploads a missing block directly to the block store |
| POST /v1/files/commit | { path, blockHashes[], baseVersion } → new version or 409 conflict |
| GET /v1/delta?cursor=… | changes since cursor (for sync) |
| GET /v1/notify?cursor=… | long poll: returns when something changed |
| GET /v1/files/:id/revisions | version history |

**Data model (metadata in sharded MySQL/Postgres):**
- \`namespace(ns_id, owner_id)\`: a user's root or a shared folder. **Shard by ns_id**, so one folder tree is on one shard and moves/renames stay transactional.
- \`file(ns_id, file_id, path, latest_version, is_deleted)\`
- \`file_version(file_id, version, block_list[], size, created_by_device, created_at)\`: the block list is an ordered array of SHA-256 hashes.
- \`block(hash PK, size, storage_key, refcount)\`: global, deduplicated.
- \`journal(ns_id, seq, file_id, op)\`: monotonically increasing per namespace. The **cursor** clients sync from is (ns_id, seq).`,
      code: [
        {
          language: 'sql',
          title: 'Metadata schema (per-namespace shard)',
          code: `CREATE TABLE file (
  ns_id          BIGINT NOT NULL,
  file_id        BIGINT NOT NULL,
  path           TEXT   NOT NULL,
  latest_version INT    NOT NULL DEFAULT 0,
  is_deleted     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (ns_id, file_id),
  UNIQUE (ns_id, path)                       -- one live entry per path
);

CREATE TABLE file_version (
  file_id    BIGINT NOT NULL,
  version    INT    NOT NULL,
  block_list BYTEA[] NOT NULL,               -- ordered SHA-256 hashes (32 B each)
  size_bytes BIGINT NOT NULL,
  device_id  TEXT   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, version)
);

-- Per-namespace change journal: the sync cursor is (ns_id, seq)
CREATE TABLE journal (
  ns_id   BIGINT NOT NULL,
  seq     BIGINT NOT NULL,
  file_id BIGINT NOT NULL,
  op      TEXT   NOT NULL CHECK (op IN ('add','edit','delete','move')),
  PRIMARY KEY (ns_id, seq)
);`,
        },
      ],
      keyPoints: [
        '240 uploads/s average: the metadata DB is modest; the blob layer is huge.',
        'Shard metadata by namespace (user root or shared folder).',
        'A file version is an ordered list of content hashes.',
        'The per-namespace journal seq is the sync cursor.',
      ],
      source: 'Alex Xu Vol 1 — Ch 15 Design Google Drive',
    },
    {
      heading: 'Dropbox / Google Drive (2/4): high-level architecture and the upload/download flow',
      body: `**Components:**
- **Block servers / upload service:** tells clients which blocks are missing and issues presigned URLs. Clients (or block servers, in Xu's design) upload blocks to the **block store**: S3 or Dropbox's own Magic Pocket, which is erasure-coded and multi-region.
- **Metadata API + metadata DB:** file tree, versions, block lists, sharing ACLs. Strong consistency, so it's a relational DB sharded by namespace, with a cache in front.
- **Notification service:** holds long-poll (or WebSocket) connections, one per device, and wakes devices when their namespace journal advances.
- **Offline backup queue:** changes for devices that are offline are simply journal entries. When a device reconnects, it pulls \`/delta\` from its last cursor, so nothing extra is needed beyond retaining the journal.
- **Cold storage:** old revisions and inactive users' blocks tier to cheaper storage (S3 Glacier-like).

**Upload flow (edit of an existing 20 MB file):**
1. The client splits the file into 5 blocks and hashes each one. Only block 3 changed.
2. \`POST upload-session\` with the 5 hashes. The server replies that hash #3 is missing, with a presigned URL.
3. The client PUTs block 3 (4 MB) straight to the block store. Only 4 MB moves, not 20 MB. That's **delta sync**.
4. \`POST commit {blockHashes, baseVersion: 7}\`. In one metadata transaction the server checks that latest_version is 7, inserts version 8, bumps block refcounts and appends a journal entry.
5. The notification service wakes the user's other devices. They call \`/delta\`, see the new block list, and download only block 3.

**Download** is the mirror image: fetch the block list, then GET only the blocks not already in the local block cache, in parallel, from a CDN or presigned URLs.

**Why commit after upload?** Blocks are immutable and content-addressed, so uploading them first is harmless. An unreferenced block is garbage-collected later. The file becomes visible atomically at commit, and readers never see half a file.`,
      diagram: ` Device A                                   Device B
    │ 1.hash blocks                              ▲ 6.long-poll returns
    │ 2.upload-session (hashes)                  │ 7.GET /delta, fetch blocks
    ▼                                            │
┌────────────┐ missing+URLs ┌──────────────┐  ┌──┴─────────────────┐
│ API / LB   │─────────────►│ Block service│  │ Notification svc   │
└──┬───────┬─┘              └──────┬───────┘  │ (long poll/WS,     │
   │       │ 5.commit              │ presign  │  per-namespace)    │
   │       ▼                       ▼          └──▲─────────────────┘
   │  ┌──────────────┐     ┌──────────────────┐  │ journal advanced
   │  │ Metadata svc │────►│ Metadata DB      │──┘
   │  │ (+ cache)    │     │ sharded by ns_id │
   │  └──────────────┘     └──────────────────┘
   │ 3.PUT block (presigned, direct)
   ▼
┌─────────────────────────────┐   lifecycle   ┌───────────────┐
│ Block store (S3/Magic Pocket│──────────────►│ Cold storage  │
│ content-addressed, EC)      │               └───────────────┘
└─────────────────────────────┘`,
      keyPoints: [
        'Bytes go device ↔ block store directly (presigned URLs); metadata goes through the API.',
        'Upload blocks first, commit metadata atomically last.',
        'Offline devices catch up by replaying the journal from their cursor.',
        'Unreferenced blocks are garbage-collected by refcount or mark-sweep.',
      ],
    },
    {
      heading: 'Dropbox / Google Drive (3/4): chunking, dedup and delta sync',
      body: `**Fixed-size chunking** (4 MB, as in Dropbox's original design) is simple and parallelisable, and it works well when edits overwrite bytes in place (databases, VM images). Its weakness is that **inserting one byte at the start shifts every boundary**, so every block hash changes and the whole file re-uploads.

**Content-defined chunking (CDC)** picks boundaries where a rolling hash over a sliding window (Rabin fingerprint, Gear/FastCDC) matches a pattern, e.g. \`(hash & mask) === 0\`. Boundaries follow the content, so an insert only changes the chunk it lands in and the rest re-align. Set min/avg/max sizes (e.g. 1/4/8 MB) to bound variance. Backup tools such as restic and borg, and LBFS, use CDC. Dropbox uses fixed blocks, plus rsync-style binary diff in some paths.

**Dedup scope:**
- **Per-user dedup** is safe and gets most of the win (the same file in two folders, re-uploads).
- **Global cross-user dedup** saves more (popular files), but a "do you have hash X?" answer is a **side channel**: an attacker can probe whether someone else has a specific file. Mitigations: dedup only within an account or team, or always require the upload for small or unique-looking files. Client-side encryption with per-user keys defeats global dedup entirely. That's a product trade-off.

**Compression:** compress blocks (zstd/LZ4) before upload, except already-compressed types (JPEG, MP4, ZIP).

**Integrity:** the block hash is also a checksum. The server recomputes SHA-256 on receipt and rejects mismatches, so corruption can't be committed.

**Bandwidth math:** editing one paragraph in a 100 MB PowerPoint with 4 MB fixed blocks uploads about 4–8 MB (1–2 blocks) instead of 100 MB, a 12–25× saving. With CDC and an insert near the start, fixed blocks would resend ~100 MB while CDC resends ~4 MB.`,
      code: [
        {
          language: 'typescript',
          title: 'Streaming fixed-size chunking + hash, uploading only missing blocks',
          code: `import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

const BLOCK = 4 * 1024 * 1024;

// Stream the file, never holding more than one block in memory
async function* blocks(path: string): AsyncGenerator<{ hash: string; data: Buffer }> {
  let buf = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) {
    buf = Buffer.concat([buf, chunk as Buffer]);
    while (buf.length >= BLOCK) {
      const data = buf.subarray(0, BLOCK);
      buf = buf.subarray(BLOCK);
      yield { hash: createHash('sha256').update(data).digest('hex'), data: Buffer.from(data) };
    }
  }
  if (buf.length) yield { hash: createHash('sha256').update(buf).digest('hex'), data: buf };
}

export async function syncFile(api: SyncApi, path: string, remotePath: string, baseVersion: number) {
  const list: { hash: string; data: Buffer }[] = [];
  for await (const b of blocks(path)) list.push(b);   // for huge files, spill data to a temp dir
  const hashes = list.map((b) => b.hash);

  const { missing } = await api.uploadSession(remotePath, hashes);   // { hash: presignedUrl }
  // Upload only missing blocks, 4 at a time; PUT of a content-addressed block is idempotent
  const todo = list.filter((b) => missing[b.hash]);
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map((b) => api.putBlock(missing[b.hash], b.data, b.hash)));
  }
  return api.commit(remotePath, hashes, baseVersion);   // 409 => conflict handling
}

interface SyncApi {
  uploadSession(path: string, hashes: string[]): Promise<{ missing: Record<string, string> }>;
  putBlock(url: string, data: Buffer, sha256: string): Promise<void>;
  commit(path: string, hashes: string[], baseVersion: number): Promise<{ version: number }>;
}`,
        },
      ],
      keyPoints: [
        'Fixed chunks: simple, but a single inserted byte shifts every later boundary.',
        'CDC (rolling hash) re-aligns after inserts; bound chunk size min/avg/max.',
        'Global dedup leaks file existence; scope dedup per user/team.',
        'The block hash doubles as the integrity check.',
      ],
    },
    {
      heading: 'Dropbox / Google Drive (4/4): conflicts, notifications, versioning and trade-offs',
      body: `**Conflict resolution.** Two offline laptops edit report.docx at base version 7. Laptop A commits version 8 first. Laptop B's commit has baseVersion 7 while latest is 8, so it gets **409**. Options:
- **Last-writer-wins:** simple, but it silently loses A's work, which is unacceptable for files.
- **Conflicted copy (Dropbox's approach):** keep A's version as the file, and save B's as "report (Laptop B's conflicted copy 2026-09-28).docx". No data is lost, and the user merges.
- **Automatic merge:** only for types with semantics (plain text via 3-way merge; Docs uses OT/CRDT).

Directory operations (move/rename) are metadata transactions on the namespace shard. A move across namespaces (into a shared folder) is a copy of the block list plus a delete, since blocks are shared by hash.

**Notification service.** 10M DAU with ~2 devices each is ~20M open connections. **Long polling** (Dropbox's choice): the client calls \`/notify?cursor=…\`, the server holds it for up to ~60–90 s and returns "changed" or "timeout". The client then calls \`/delta\`. It's simple, works through proxies, and data flow is only server→client. WebSockets are fine too but add connection-state complexity. With ~100K idle connections per event-loop node, 20M connections need ~200 nodes. Route by ns_id so a journal event only fans out to the nodes holding watchers of that namespace (via pub/sub such as Redis or Kafka).

**Versioning and GC.** Every commit creates a version, and old versions keep their block lists. A retention policy (30 days, or N versions) drops old versions and decrements block refcounts. Blocks at refcount 0 are deleted after a grace period, or found by a periodic mark-and-sweep, which is safer against refcount drift.

**Consistency.** Metadata must be strongly consistent (read-your-writes across devices): a relational DB with transactions, and caches invalidated on commit. Blocks are immutable, so they're trivially cacheable at the CDN or on the device.

**Failure handling:** block-store failure means the client retries the idempotent PUT. A metadata shard failover goes to a synchronous replica. A notification node crash makes clients reconnect and re-poll from their cursor, and no events are lost because the journal is the truth.`,
      code: [
        {
          language: 'typescript',
          title: 'Long-poll endpoint backed by Redis pub/sub (NestJS-style)',
          code: `import Redis from 'ioredis';
import type { Request, Response } from 'express';

const sub = new Redis(process.env.REDIS_URL!);        // dedicated subscriber connection
const db = new Redis(process.env.REDIS_URL!);         // latest seq per namespace: ns:{id}:seq
const waiters = new Map<string, Set<() => void>>();   // ns_id -> pending responses

sub.on('message', (channel) => {
  const ns = channel.slice('ns-changed:'.length);
  for (const wake of waiters.get(ns) ?? []) wake();
});

export async function notify(req: Request, res: Response) {
  const ns = String(req.query.ns);
  const cursor = Number(req.query.cursor);

  if (!waiters.has(ns)) { waiters.set(ns, new Set()); await sub.subscribe('ns-changed:' + ns); }
  const set = waiters.get(ns)!;
  const done = (changed: boolean) => {
    clearTimeout(timer); set.delete(wake);
    if (set.size === 0) { waiters.delete(ns); void sub.unsubscribe('ns-changed:' + ns); }
    if (!res.headersSent) res.json({ changed });
  };
  const wake = () => done(true);
  // Jittered timeout avoids synchronized reconnect storms
  const timer = setTimeout(() => done(false), 60_000 + Math.random() * 30_000);
  set.add(wake);
  req.on('close', () => done(false));
  // Subscribe FIRST, then check: a change landing in between still wakes us (no lost wakeup)
  if (Number(await db.get('ns:' + ns + ':seq')) > cursor) done(true);
}`,
        },
      ],
      keyPoints: [
        'Conflicts: optimistic base_version on commit, then a conflicted copy; never silent LWW.',
        'Long poll carries only a "changed" signal; data comes via /delta.',
        'Register the waiter, then check the cursor, to avoid a lost-wakeup race.',
        'Version retention + refcount/mark-sweep GC for blocks.',
      ],
      source: 'Alex Xu Vol 1 — Ch 15; Dropbox Tech Blog',
    },
    {
      heading: 'Distributed email (1/3): requirements, estimation and protocols',
      body: `**Scope (Ch 8):** a Gmail/Outlook-scale service. Send and receive email, fetch all emails, filter by read/unread, search by subject, sender and body, anti-spam and anti-virus. **1 billion users.**

**Estimation (Ch 8):**
- Send QPS: 1B users × 10 emails/day ÷ 10^5 s ≈ **100,000 QPS**.
- Receive: 40 emails/user/day, 50 KB average metadata. 1B × 40 × 365 × 50 KB ≈ **730 PB/year** of metadata.
- Attachments: 20% of emails, 500 KB average. 1B × 40 × 365 × 0.2 × 500 KB ≈ **1,460 PB/year**.
→ This is a **storage** problem first: a distributed DB for metadata and object storage for attachments.

**Protocols:**

| Protocol | Role | Notes |
|---|---|---|
| **SMTP** (25 server-to-server, 587 submission) | sending between mail servers | push-based, store-and-forward, retries for days |
| **POP3** | download-and-delete to one client | poor fit for multi-device |
| **IMAP** | server-side mailbox, folders, flags, partial fetch | stateful, chatty long-lived connections |
| **HTTPS/JSON (+ WebSocket)** | webmail and mobile apps | what Gmail's web and mobile clients actually use; lets you design your own API |

**DNS MX records** tell other servers where to deliver mail for a domain (\`gmail.com MX → gmail-smtp-in.l.google.com\`).

**Why the traditional design fails:** a traditional mail server stores mail as files in per-user directories (Maildir). That works for thousands of users, but not for a billion: disk I/O bottlenecks, no replication, and file-system limits on the number of files. Ch 8 moves to a distributed architecture with separate web servers, real-time servers, a metadata DB, attachment storage, a cache and a search store.`,
      keyPoints: [
        '100K send QPS; ~730 PB/yr metadata; ~1,460 PB/yr attachments (Ch 8).',
        'SMTP between servers; IMAP/POP or HTTP APIs for clients.',
        'Maildir-style local storage does not scale or replicate.',
      ],
      source: 'Alex Xu Vol 2 — Ch 8 Distributed Email Service',
    },
    {
      heading: 'Distributed email (2/3): architecture, send flow and receive flow',
      body: `**Components (Ch 8):** webmail clients (HTTPS); **web servers** (stateless APIs: send, list folders, fetch, search); **real-time servers** (WebSocket, with long-poll fallback, to push new mail); the **metadata DB**; **attachment store** (S3); a **distributed cache** (Redis) for recent emails; and the **search store** (inverted index).

**Send flow:**
1. The client POSTs /v1/messages to a web server, which validates it (size limits, recipient count) and runs outbound spam and virus checks.
2. If the recipient is internal (same domain), deliver directly. Otherwise, put it on the **outgoing queue** (Kafka).
3. **SMTP outgoing workers** pull from the queue, look up the recipient's MX, and deliver with DKIM signing. They retry with backoff on 4xx and generate a bounce on 5xx. The queue decouples senders from slow remote servers, and a growing queue signals a problem (a remote server blocking us, or our IP being blacklisted).
4. The sent copy is stored in the sender's "Sent" folder (metadata DB + attachments in S3).

**Receive flow:**
1. A remote server connects to our **SMTP load balancer → SMTP servers**. We run checks at connection time: SPF/DKIM/DMARC, IP reputation, rate limits. Reject early to save resources.
2. Big attachments go to object storage first. The message goes onto the **incoming queue**.
3. **Mail processing workers** run spam and virus filtering, apply user filters and labels, write metadata to the DB and cache, and update the search index asynchronously.
4. If the recipient is online, the **real-time server** pushes the email. Otherwise it's fetched on next login via the API.

**Idempotency:** SMTP senders retry if our 250 OK is lost, so dedupe on (Message-ID, recipient) in the processing workers. It's also why we should acknowledge only *after* the message is durably queued.`,
      diagram: `          Sending side                         Receiving side
Webmail ──HTTPS──► Web servers        Internet MTAs ──SMTP──► SMTP LB
                     │  │ spam/virus                            │
      internal rcpt ◄┘  ▼                             SMTP servers (SPF/
                   Outgoing queue                     DKIM/DMARC, rate
                        │                             limit, early reject)
                        ▼                                       │
                 SMTP out workers ──► remote MX       Incoming queue
                                                                │
                                                                ▼
 Real-time svc ◄────────────────── Mail processing workers (spam, filters)
 (WebSocket push)                        │          │           │
                                         ▼          ▼           ▼
                                 Metadata DB   Attachments   Search index
                                 (+Redis)      (S3)          (async)`,
      keyPoints: [
        'Queues on both sides decouple SMTP from processing; queue depth is a health signal.',
        'Reject spam at SMTP connection time when possible.',
        'Ack SMTP only after durable enqueue; dedupe on Message-ID + recipient.',
        'Real-time push via WebSocket; stateless web servers for APIs.',
      ],
      source: 'Alex Xu Vol 2 — Ch 8 (high-level design, email sending/receiving flow)',
    },
    {
      heading: 'Distributed email (3/3): metadata data model, search, consistency and deliverability',
      body: `**Access patterns shape the store (Ch 8):** headers are small and frequently read, bodies are large and rarely re-read, most reads hit recent emails, and **data belongs to a single user**. A relational DB struggles with the size. Gmail uses **Bigtable**, and Ch 8 models the data in a Cassandra-like wide-column store **partitioned by user_id**, so each mailbox is one partition (or a few).

**Tables (denormalise per query):**
- \`folders_by_user(user_id, folder_id, folder_name)\`
- \`emails_by_folder((user_id, folder_id), email_id DESC, from, subject, preview, is_read)\`, where email_id is a TIMEUUID so newest sorts first.
- \`emails_by_user(user_id, email_id, …)\`: the full metadata row keyed for fetch.
- Filtering by read/unread: wide-column stores cannot filter on non-key columns efficiently, so keep **separate \`read_emails\` and \`unread_emails\` tables** keyed like emails_by_folder. Marking an email read deletes it from one and inserts it into the other (a batch). The unread count is kept as a separate counter or computed per page.
- **Threads:** group with Message-ID, In-Reply-To and References headers (the JWZ threading algorithm).

**Consistency:** Ch 8 chooses **consistency over availability**: each mailbox has a single primary. During failover the mailbox is briefly unavailable for writes, rather than risking lost or duplicated flags.

**Search:**

| | Elasticsearch | Custom (Gmail-style) |
|---|---|---|
| Effort | integrate; index async via Kafka | build an LSM-based inverted index per user |
| Fit | good up to large scale | write-heavy (every email indexed); per-user partitioning |
| Downside | two systems to keep in sync; reindex cost | huge engineering investment |

Partition the index by user_id, since users only search their own mail.

**Deliverability (outbound mail landing in inboxes):**
- Dedicated IPs, **warmed up** gradually; separate IPs for marketing vs transactional mail.
- **SPF** (which IPs may send for the domain), **DKIM** (signature over headers and body), **DMARC** (policy + reports when SPF/DKIM fail alignment).
- Handle **feedback loops**: hard bounces (stop sending), soft bounces (retry), complaints (unsubscribe). Ban spammer accounts quickly to protect IP reputation.`,
      code: [
        {
          language: 'sql',
          title: 'Cassandra CQL for mailbox metadata',
          code: `-- One partition per (user, folder); newest first via TIMEUUID clustering
CREATE TABLE emails_by_folder (
  user_id   UUID,
  folder_id TEXT,
  email_id  TIMEUUID,
  from_addr TEXT,
  subject   TEXT,
  preview   TEXT,
  has_attachment BOOLEAN,
  PRIMARY KEY ((user_id, folder_id), email_id)
) WITH CLUSTERING ORDER BY (email_id DESC);

-- Separate table for unread, because filtering on a non-key column is not efficient
CREATE TABLE unread_emails (
  user_id   UUID,
  folder_id TEXT,
  email_id  TIMEUUID,
  from_addr TEXT,
  subject   TEXT,
  PRIMARY KEY ((user_id, folder_id), email_id)
) WITH CLUSTERING ORDER BY (email_id DESC);

-- Mark as read: move between tables in one logged batch (same partition key => cheap)
BEGIN BATCH
  DELETE FROM unread_emails WHERE user_id = ? AND folder_id = 'inbox' AND email_id = ?;
  INSERT INTO read_emails (user_id, folder_id, email_id, from_addr, subject)
    VALUES (?, 'inbox', ?, ?, ?);
APPLY BATCH;

-- Page 2 of the inbox: token-style pagination by clustering key
SELECT * FROM emails_by_folder
 WHERE user_id = ? AND folder_id = 'inbox' AND email_id < ? LIMIT 50;`,
        },
      ],
      keyPoints: [
        'Partition by user_id; denormalise one table per query.',
        'Read/unread as separate tables because wide-column stores cannot filter non-key columns.',
        'Consistency over availability per mailbox (single primary).',
        'Search index partitioned by user; ES vs custom LSM trade-off.',
        'SPF + DKIM + DMARC + IP warm-up + bounce/complaint handling.',
      ],
      source: 'Alex Xu Vol 2 — Ch 8 (metadata DB, search, deliverability)',
    },
    {
      heading: 'Distributed file system (1/3): GFS/HDFS architecture and master metadata',
      body: `**Intuition:** one librarian (the master) knows which shelf holds every chapter of every book, and hundreds of shelves (chunkservers) hold the chapters. Readers ask the librarian once where a chapter is, then go straight to the shelf, so the librarian never carries books.

**Assumptions GFS was built on (2003):** commodity machines fail constantly; files are huge (multi-GB); workloads are **large streaming reads** and **appends** (logs, crawl output, MapReduce); throughput matters more than latency.

**Architecture:**
- **Master** (HDFS: NameNode) keeps all metadata **in memory**: the namespace (the directory tree), file → chunk handles, and chunk → replica locations. Locations are *not* persisted. They're rebuilt from chunkserver reports at startup and via heartbeats, since the chunkserver is the authority on what it has.
- **Chunkservers** (HDFS: DataNodes) store **64 MB chunks** (HDFS: 128 MB blocks) as local Linux files, replicated **3×** by default.
- **Clients** ask the master for chunk locations (and cache them), then read and write data **directly** with chunkservers.

**Why big chunks?** Fewer chunks means less master metadata and fewer client↔master round-trips, and clients keep a persistent TCP connection to one chunkserver for sequential reads. The downside is that small files get one chunk each and can become hotspots (GFS saw this with executables read by many clients, and fixed it with higher replication).

**Master memory:** GFS used < 64 bytes of metadata per 64 MB chunk. In HDFS the rule of thumb is ~150 bytes per file, directory or block object. 100M files × ~1.5 blocks ≈ 250M objects × 150 B ≈ **~37 GB of heap**. The **small-files problem** is metadata count, not bytes.

**Durability of metadata:** every namespace mutation goes to an **operation log** (HDFS: EditLog), which is replicated before the client is acked. It's periodically compacted into a **checkpoint** (HDFS: FsImage) so restarts replay only a short log tail.`,
      diagram: `            (1) open(file, chunk index)
 Client ─────────────────────────────► Master / NameNode
   │   ◄──── chunk handle + replica    │ namespace, file→chunks,
   │         locations (cached)        │ chunk→locations (RAM)
   │                                   │ op log + checkpoints
   │                                   │   (replicated)
   │ (2) read/write data directly      │ heartbeats, leases,
   ▼                                   │ re-replication orders
┌──────────┐  ┌──────────┐  ┌──────────┐
│ChunkSrv 1│  │ChunkSrv 2│  │ChunkSrv 3│ ... hundreds
│ rack A   │  │ rack A   │  │ rack B   │
│ c17 c42  │  │ c17 c91  │  │ c17 c42  │  64 MB chunks, 3 replicas
└──────────┘  └──────────┘  └──────────┘`,
      keyPoints: [
        'Master holds all metadata in RAM; data never flows through it.',
        '64/128 MB chunks keep metadata small and favour streaming.',
        'Chunk locations are rebuilt from chunkserver reports, not persisted.',
        'NameNode heap ≈ 150 B per object; small files exhaust it.',
      ],
      source: 'The Google File System (SOSP 2003); HDFS Architecture Guide',
    },
    {
      heading: 'Distributed file system (2/3): leases, the write pipeline and consistency',
      body: `**Leases (GFS):** for each chunk being mutated, the master grants a **lease** (initially 60 s, renewable via heartbeats) to one replica, the **primary**. The primary picks a **serial order** for all mutations to that chunk, and the secondaries apply them in that order. This moves per-mutation ordering off the master. If the primary becomes unreachable, the master waits for the lease to expire before granting a new one, so two primaries can never exist at once.

**Write flow (GFS paper, Figure 2):**
1. The client asks the master for the primary and secondaries, and caches them.
2. The client **pushes data** to all replicas along a **chain** (to the nearest, which forwards to the next) using pipelined TCP. Data flow is decoupled from control flow, so each machine's full outbound bandwidth is used. Ideal time to push B bytes to R replicas ≈ B/T + R·L.
3. Once all replicas have buffered the data, the client sends the **write request to the primary**.
4. The primary assigns a serial number, applies the write locally, and forwards the order to the secondaries.
5. The secondaries apply and ack, and the primary acks the client. On any failure the client retries, which can leave replicas inconsistent in that region (see below).

**Record append:** the client gives only the data, and the primary picks the offset. It's **at-least-once**: a retry can duplicate a record, and some regions may hold padding or partial data. Applications use checksums and unique record ids to skip junk and duplicates. This is how many producers can append to one file concurrently without locks.

**Consistency model (GFS):** a region is *defined* if all replicas are identical and it reflects one mutation in full. Concurrent successful writes can leave it *consistent but undefined* (mingled fragments), and a failed mutation leaves it *inconsistent*. **HDFS** simplifies this with **single-writer** files (a lease per file, held by the writing client) and append-only semantics, which avoids most of these states.

**HDFS write pipeline:** the client streams **64 KB packets** through DataNode1 → DN2 → DN3, and acks flow back in reverse. If a DataNode in the pipeline fails, the pipeline is rebuilt with the remaining nodes, the block gets a new generation stamp (so the stale replica is discarded), and the NameNode re-replicates later.`,
      code: [
        {
          language: 'typescript',
          title: 'Primary replica: lease check + serial ordering of mutations',
          code: `interface Mutation { clientId: string; reqId: string; offset: number; data: Buffer }

export class ChunkPrimary {
  private serial = 0;
  private applied = new Map<string, number>();   // reqId -> serial (dedupe client retries)

  constructor(
    private readonly chunkId: string,
    private leaseExpiresAt: number,               // granted by master, extended via heartbeat
    private readonly secondaries: { apply(chunk: string, serial: number, m: Mutation): Promise<void> }[],
    private readonly local: { write(offset: number, data: Buffer): Promise<void> },
  ) {}

  renewLease(untilMs: number) { this.leaseExpiresAt = Math.max(this.leaseExpiresAt, untilMs); }

  async write(m: Mutation): Promise<{ serial: number }> {
    // Refuse writes once the lease may have been handed to another replica
    // (small safety margin for clock drift between master and chunkserver)
    if (Date.now() > this.leaseExpiresAt - 1_000) throw new Error('LEASE_EXPIRED');
    const prev = this.applied.get(m.reqId);
    if (prev !== undefined) return { serial: prev };            // retry of an applied mutation

    const serial = ++this.serial;                              // primary alone decides the order
    await this.local.write(m.offset, m.data);
    // Secondaries apply in serial order; data was already pushed via the pipeline
    await Promise.all(this.secondaries.map((s) => s.apply(this.chunkId, serial, m)));
    this.applied.set(m.reqId, serial);
    return { serial };
  }
}`,
        },
      ],
      keyPoints: [
        'Lease → one primary per chunk orders mutations; the master waits for expiry before re-granting.',
        'Data is pushed along a replica chain; the control message goes to the primary.',
        'Record append is at-least-once; apps dedupe with record ids and checksums.',
        'HDFS: single writer per file, 64 KB packet pipeline, generation stamps on recovery.',
      ],
      source: 'The Google File System (SOSP 2003) §3; HDFS Architecture Guide',
    },
    {
      heading: 'Distributed file system (3/3): failure recovery, placement, erasure coding and master HA',
      body: `**Failure detection:** chunkservers send **heartbeats** (HDFS: every 3 s; a node is declared dead after ~10.5 min by default) and periodic **block reports**. When a node dies, the master finds under-replicated chunks and schedules **re-replication by priority**: chunks with 1 live replica before chunks with 2, and chunks blocking a client first. It throttles clone bandwidth so recovery doesn't starve foreground traffic.

**Placement (HDFS default for 3 replicas):** the first replica goes on the writer's node (or a random one), the second on a node in a **different rack**, and the third on another node in that same remote rack. This survives a whole-rack failure while crossing the rack boundary only once per write. The master also balances placement by disk utilisation and recent creations (to avoid hotspots on new nodes).

**Integrity:** each chunkserver checksums data in 64 KB blocks (32-bit CRC in GFS, CRC32C per 512 bytes in HDFS) and verifies on read. A corrupt replica is reported, deleted and re-cloned from a healthy one. Idle-time **scrubbing** catches silent bit rot on cold data.

**Stale replicas:** a **chunk version number** (HDFS: generation stamp) increments on each new lease. A replica that was down during a mutation reports an old version and is garbage-collected. Deleted files are renamed to a hidden name and reclaimed lazily (GFS keeps them 3 days), which is simple and forgiving of mistakes.

**Erasure coding (HDFS 3.x):** Reed-Solomon **RS(6,3)** splits a block group into 6 data + 3 parity cells. It tolerates the loss of any 3 at **1.5× storage** instead of 3×. The cost is CPU, network-heavy reconstruction, and worse small-file behaviour, so it's typically used for warm and cold data while hot data stays 3× replicated. (S3-like stores use the same idea; see the object-storage topic.)

**Master HA and scale:**
- GFS: replicated operation log, plus **shadow masters** for read-only access.
- HDFS: an Active + Standby NameNode sharing the EditLog through a **Quorum Journal Manager** (3 or 5 JournalNodes, majority writes). **ZKFC** with ZooKeeper handles failover and **fencing**, so the old active can't write.
- Metadata scale: **HDFS Federation** (multiple independent NameNodes, each owning a namespace volume) or **ViewFS/Router-based federation**. GFS's successor, **Colossus**, moved metadata into Bigtable, removing the single-master memory limit.

**GFS/HDFS vs S3-style object storage:** a DFS gives a hierarchical namespace, appends and data locality (compute runs next to the data), but it's single-cluster and bounded by master metadata. Object stores give a flat key space, immutable objects, HTTP APIs and near-infinite scale with no locality. That's why modern data lakes put Spark on S3, with table formats (Iceberg/Delta) layered on top.`,
      keyPoints: [
        'Heartbeats + block reports → prioritised, throttled re-replication.',
        'Rack-aware placement: 1 local, 2 on one remote rack.',
        'Checksums per 64 KB/512 B, scrubbing, version numbers for stale replicas.',
        'RS(6,3) erasure coding = 1.5× overhead, tolerates 3 losses; best for cold data.',
        'NameNode HA via QJM + ZKFC fencing; federation or Colossus-style metadata for scale.',
      ],
      source: 'GFS paper §4–5; HDFS Architecture & HDFS Erasure Coding docs',
    },
    {
      heading: 'Wrap-up: trade-offs and how to close each design',
      body: `| Decision | Dropbox / Drive | Email | DFS |
|---|---|---|---|
| Metadata store | sharded RDBMS by namespace (transactions for the tree) | wide-column by user_id (Bigtable/Cassandra) | single in-memory master + replicated op log (or federated) |
| Data store | content-addressed blocks in object storage | attachments in object storage; bodies in the DB or blob | local disks on chunkservers, 3× or EC |
| Unit | 4 MB block (fixed or CDC) | message | 64/128 MB chunk |
| Concurrency control | optimistic base_version, conflicted copies | single primary per mailbox | lease → primary orders mutations (GFS); single writer (HDFS) |
| Change propagation | journal + cursor + long poll | real-time server via WebSocket | not needed (batch clients) |
| Main scaling pain | notification fan-out, metadata hot namespaces (huge shared folders) | petabytes of metadata, search indexing | master memory (small files), recovery bandwidth |

**Closing lines interviewers like:**
- Dropbox: "Delta sync and dedup save bandwidth. The metadata DB with a per-namespace journal gives correctness. Conflicted copies guarantee we never silently lose a user's edit."
- Email: "It's a storage problem: partition by user, denormalise per query, keep attachments in object storage, and treat deliverability (SPF/DKIM/DMARC, IP reputation) as a first-class requirement."
- DFS: "The master only handles metadata. Leases let one primary order writes, replicas are rack-aware, and recovery is automatic and prioritised. The limit is metadata count, which is why federation and Colossus exist."

**Common traps:** routing file bytes through app servers; LWW for file conflicts; a relational DB for 700 PB/year of email metadata; claiming GFS is strongly consistent for concurrent appends; forgetting that a NameNode failover needs fencing.`,
      keyPoints: [
        'Close each design with correctness + scaling-pain + mitigation.',
        'Know the DFS vs object-store trade-off (locality/appends vs scale/flat keys).',
      ],
    },
    {
      heading: 'Level bar: what mid, senior and staff answers include',
      body: `Calibration: **mid** is about 80% breadth / 20% depth, with the interviewer steering. **Senior** is about 60/40: a quick HLD, then deep dives you start yourself on chunking, consistency and failure, backed by numbers. **Staff** is about 40/60: you drive, and you raise durability math, cost per PB, migration and abuse without being asked.

**Dropbox / Google Drive**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | Upload, download, sync, share | 50M DAU, 10 GB each ≈ 500 PB logical; files up to 50 GB; sync latency of seconds | Dedup privacy, legal holds, enterprise retention |
| High-level design | API + S3 + metadata DB | Block server, presigned chunk uploads, metadata DB (sharded by namespace), notification long-poll | Separate sync engine (journal + cursor) from storage; cold-tier blocks |
| Deep dives expected | Chunking, when asked | Content-defined chunking, dedup by hash, delta sync | Conflict model, cross-tenant dedup risk, migrating storage backends |
| Trade-offs & failure handling | — | Fixed vs content-defined chunks; LWW vs conflicted copy | Resumable uploads; consistency of metadata commit vs blob upload |
| Ops/cost/evolution | — | Dedup ratio, sync lag | Moving off S3 (Magic Pocket-style) when cost per PB justifies it |

- Down-levelled: re-uploading the whole file on every edit; silent last-write-wins.

**Distributed email (Gmail-scale)**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | Send, receive, list, search | 1B users × 40 mails/day; ~50 KB average with attachments in blobs | Spam/abuse, deliverability (SPF/DKIM/DMARC), legal retention |
| High-level design | SMTP + DB | SMTP in/out, queues, metadata in a wide-column store keyed by user, blobs in object storage, search index | Per-user locality: mailbox, index and cache together |
| Deep dives expected | — | Metadata data model (labels, threads), search | Per-user inverted index, IP-reputation management |
| Trade-offs & failure handling | — | Shared search cluster vs per-user index | Bounce storms, outbound IP warm-up, retry queues |
| Ops/cost/evolution | — | Inbound queue depth | Attachment dedup, tiering old mail |

- Down-levelled: a relational table with \`LIKE '%term%'\` search; no answer on spam or deliverability.

**Distributed file system (GFS / HDFS)**

| Area | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | Store huge files | 64–128 MB chunks, append-heavy, throughput over latency | Durability target (11 nines), multi-tenant quotas |
| High-level design | Master + chunk servers | In-memory namespace, op log + checkpoints, 3 replicas, client caches locations | Master HA (Raft/QJM), federation for namespace scale |
| Deep dives expected | Replication | Leases for a primary, write pipeline, re-replication | Erasure coding for cold data, rack-aware placement |
| Trade-offs & failure handling | — | Relaxed consistency of record append | Re-replication storms after a rack failure; throttling |
| Ops/cost/evolution | — | Under-replicated chunk count | 3× vs RS(6,3) at 1.5×; master memory ceiling |

- Down-levelled: one master with no HA story; small-file workloads not called out as an anti-pattern.`,
      keyPoints: [
        'Storage designs are judged on durability, chunking and consistency between metadata and bytes.',
        'Staff candidates bring cost per PB and backend migration without being asked.',
        'Name the conflict model explicitly; silent overwrites are a down-level.',
      ],
      source: 'Hello Interview — problem breakdowns (levelling expectations)',
    },
    {
      heading: 'Deep-dive ladders: bad → good → great',
      body: `**Dropbox: uploading and syncing big files**
- **Bad:** send the whole file through app servers on every save. Changing 1 byte of a 1 GB file re-uploads 1 GB, and the app tier pays for all of that bandwidth.
- **Good:** fixed 4 MB chunks, SHA-256 each, ask the server which hashes are missing, and upload only those straight to S3 with presigned URLs. But inserting bytes near the start shifts every boundary, so every chunk changes.
- **Great:** content-defined chunking (FastCDC/rolling hash, ~4 MB average), where boundaries follow the content and an insert changes only 1–2 chunks. Dedup within a user or tenant (cross-user dedup lets anyone probe whether a file exists). Commit metadata only after all chunks have arrived, so readers never see half a file. Cost: client CPU, plus garbage collection of unreferenced chunks.

**Dropbox: two devices edit offline**
- **Bad:** last write wins on the server. One user's edits vanish without any notice.
- **Good:** each commit carries the parent revision. If the parent is not the current head, the server rejects it and the client retries.
- **Great:** on a rejected commit the client saves a "conflicted copy", and all changes go into a per-namespace journal that devices read from their own cursor (long-poll wakes them). Cost: users must resolve the conflicts by hand.

**Email: search across a 15-year mailbox**
- **Bad:** \`LIKE '%invoice%'\` in a shared relational table, which means a full scan per query.
- **Good:** a shared Elasticsearch cluster indexed asynchronously. Re-index cost and noisy tenants remain, and results can be seconds stale.
- **Great:** a per-user inverted index co-located with the mailbox shard, updated from the write log, with small user indexes merged LSM-style. Queries never fan out beyond one shard. Cost: custom index infrastructure and index storage of about 30–50% of the mail size.

**DFS: the master is a single point of failure**
- **Bad:** one master writing metadata to local disk. Losing that disk loses the namespace.
- **Good:** an in-memory namespace with an op log flushed to remote replicas, plus periodic checkpoints. Failover is manual and replaying the log takes minutes.
- **Great:** a hot standby tailing a quorum-replicated edit log (QJM or Raft) with automatic failover in seconds, plus fencing so the old master cannot keep writing. Namespace federation lets you scale beyond one master's RAM (~150 bytes per object). Cost: more moving parts and a split-brain risk if fencing is wrong.

**DFS: durability vs cost for cold data**
- **Bad:** 3 replicas forever, which is 3× raw storage on PBs of cold data.
- **Good:** RS(6,3) erasure coding at 1.5×, which survives 3 failures.
- **Great:** 3× while hot, re-encode to EC once cold, with rack- and zone-aware placement and throttled reconstruction. Cost: rebuilds read 6 blocks per lost block, and degraded reads are slower.`,
      keyPoints: [
        'Chunking: whole file → fixed chunks → content-defined chunks + per-tenant dedup.',
        'Conflicts: LWW → parent-revision check → conflicted copy + journal cursors.',
        'Master HA needs a replicated edit log AND fencing.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'design-storage-cc-1',
      title: 'Make the file-sync commit endpoint safe against lost updates and partial uploads',
      context:
        'Your Drive-like service lets desktop clients commit a new version of a file after uploading its blocks. Users report that edits made on a laptop sometimes vanish after a phone syncs, and a few files became unreadable after flaky uploads.',
      task:
        'Rewrite commitFile so concurrent edits from two devices never silently overwrite each other, a version can only reference blocks that actually exist and match their hashes, retries of the same commit are safe, and other devices get notified reliably.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
const pool = new Pool();

export async function commitFile(nsId: number, path: string, blockHashes: string[], deviceId: string) {
  const { rows } = await pool.query('SELECT file_id, latest_version FROM file WHERE ns_id=$1 AND path=$2', [nsId, path]);
  const fileId = rows[0].file_id;
  const next = rows[0].latest_version + 1;
  await pool.query('INSERT INTO file_version (file_id, version, block_list, device_id) VALUES ($1,$2,$3,$4)',
    [fileId, next, blockHashes, deviceId]);
  await pool.query('UPDATE file SET latest_version=$1 WHERE file_id=$2', [next, fileId]);
  await notifyDevices(nsId);   // publish to Redis
  return { version: next };
}
declare function notifyDevices(nsId: number): Promise<void>;`,
      },
      hints: [
        'Two devices both read latest_version = 7. What does each one write, and whose edit survives?',
        'What proves that every hash in blockHashes was uploaded and verified?',
        'If notifyDevices fails after the DB writes, how would other devices ever find out? What already acts as a durable change log?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
const pool = new Pool({ max: 20, statement_timeout: 3000 });

type CommitResult =
  | { status: 'committed'; version: number }
  | { status: 'conflict'; latestVersion: number }
  | { status: 'missing_blocks'; missing: string[] };

export async function commitFile(
  nsId: number, path: string, blockHashes: string[], baseVersion: number, deviceId: string, commitId: string,
): Promise<CommitResult> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Idempotent retry: this exact commit already happened
    const dup = await c.query('SELECT version FROM file_version WHERE commit_id = $1', [commitId]);
    if (dup.rowCount) { await c.query('ROLLBACK'); return { status: 'committed', version: dup.rows[0].version }; }

    // Every referenced block must exist and have passed server-side hash verification
    const { rows: present } = await c.query(
      'SELECT hash FROM block WHERE hash = ANY($1) AND verified = true', [blockHashes]);
    const have = new Set(present.map((r) => r.hash));
    const missing = [...new Set(blockHashes)].filter((h) => !have.has(h));
    if (missing.length) { await c.query('ROLLBACK'); return { status: 'missing_blocks', missing }; }

    // Optimistic concurrency: only advance if nobody committed since the client's base version
    const upd = await c.query(
      'UPDATE file SET latest_version = latest_version + 1 WHERE ns_id = $1 AND path = $2 AND latest_version = $3 RETURNING file_id, latest_version',
      [nsId, path, baseVersion]);
    if (upd.rowCount === 0) {
      const cur = await c.query('SELECT latest_version FROM file WHERE ns_id = $1 AND path = $2', [nsId, path]);
      await c.query('ROLLBACK');
      return { status: 'conflict', latestVersion: cur.rows[0]?.latest_version ?? 0 };  // client saves a conflicted copy
    }
    const { file_id, latest_version } = upd.rows[0];
    await c.query(
      'INSERT INTO file_version (file_id, version, block_list, device_id, commit_id) VALUES ($1,$2,$3,$4,$5)',
      [file_id, latest_version, blockHashes, deviceId, commitId]);
    await c.query('UPDATE block SET refcount = refcount + 1 WHERE hash = ANY($1)', [blockHashes]);
    // Journal row is the durable change feed; seq from a per-namespace counter row
    await c.query(
      "INSERT INTO journal (ns_id, seq, file_id, op) SELECT $1, next_seq, $2, 'edit' FROM ns_counter WHERE ns_id = $1",
      [nsId, file_id]);
    await c.query('UPDATE ns_counter SET next_seq = next_seq + 1 WHERE ns_id = $1', [nsId]);
    await c.query('COMMIT');
    // Best effort: devices that miss this wake-up still see the journal on their next poll
    notifyDevices(nsId).catch(() => undefined);
    return { status: 'committed', version: latest_version };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
declare function notifyDevices(nsId: number): Promise<void>;`,
      },
      explanation: `**Fixes:**
1. **Lost update → optimistic concurrency.** The client sends baseVersion, and the conditional UPDATE advances latest_version only if it still equals baseVersion. The loser gets \`conflict\` and creates a "conflicted copy" instead of silently overwriting the other device's edit.
2. **Atomicity.** The version insert, pointer bump, refcount increment and journal entry are one transaction. The old code could insert a version and crash before updating latest_version.
3. **Referential integrity for blocks.** The commit is refused unless every hash exists *and* was verified server-side. That prevents versions pointing at missing or corrupt blocks, which is what made files unreadable.
4. **Idempotent retries.** commitId (a client-generated UUID) makes a retried commit return the original version instead of creating a duplicate one.
5. **Reliable propagation.** The journal row is the durable change feed that clients sync from via cursor, and the pub/sub notification is only a latency optimisation. Its failure no longer loses changes.
6. **Timeouts/pooling:** statement_timeout and a bounded pool. The ns_counter row also serialises commits per namespace, giving a gap-free journal order for cursors.`,
      followUps: [
        {
          "q": "The `ns_counter` row serialises every commit in a namespace. A shared company folder sees 500 commits/s. What happens, and how would you scale it?",
          "a": "Every commit locks the same row until COMMIT, so throughput is bounded by transaction latency: at ~5 ms per transaction, ~200 commits/s, and the rest queue up and hit `statement_timeout`. Options: allocate journal seqs from a sequence (gaps are fine if clients treat the cursor as 'greater than'), or shard the journal by sub-folder with per-shard cursors. Postgres sequences are non-transactional and don't block, so `nextval` removes the hot row while keeping order per namespace approximately monotonic by commit time."
        },
        {
          "q": "How would you test that concurrent commits never lose an edit?",
          "a": "An integration test against real Postgres: spawn N concurrent commitFile calls for the same file with the same baseVersion and distinct commitIds; assert exactly one returns `committed`, the rest return `conflict`, and file_version has exactly one new row. Also retry the winning commitId and assert the same version comes back. Randomize scheduling with delays injected between statements, and add a fault test that kills the connection mid-transaction and checks nothing partial is visible."
        }
      ],
    },
    {
      id: 'design-storage-cc-2',
      title: 'Fix the inbound mail processor that duplicates emails and bloats the database',
      context:
        'Mail processing workers consume the incoming SMTP queue (Kafka, at-least-once) and store messages for a Gmail-like service. Users see duplicate emails after broker rebalances, the metadata DB grew by 40 TB in a month, and unread counts drift.',
      task:
        'Rewrite processInbound so that redelivered or retried messages are stored once, large attachments are not stored in the metadata DB, and the unread count stays consistent with the stored emails.',
      starter: {
        language: 'typescript',
        code: `import { Client } from 'cassandra-driver';
import { simpleParser } from 'mailparser';
import { v1 as timeuuid } from 'uuid';

const db = new Client({ contactPoints: ['cass'], localDataCenter: 'dc1', keyspace: 'mail' });

export async function processInbound(raw: Buffer, recipientId: string) {
  const mail = await simpleParser(raw);
  const emailId = timeuuid();
  await db.execute(
    'INSERT INTO emails_by_user (user_id, email_id, subject, from_addr, body, attachments) VALUES (?,?,?,?,?,?)',
    [recipientId, emailId, mail.subject, mail.from?.text, mail.html || mail.text,
     mail.attachments.map((a) => a.content)], { prepare: true });
  await db.execute('INSERT INTO unread_emails (user_id, folder_id, email_id, subject) VALUES (?,?,?,?)',
    [recipientId, 'inbox', emailId, mail.subject], { prepare: true });
  const r = await db.execute('SELECT unread FROM mailbox_stats WHERE user_id = ?', [recipientId], { prepare: true });
  const n = (r.first()?.unread ?? 0) + 1;
  await db.execute('UPDATE mailbox_stats SET unread = ? WHERE user_id = ?', [n, recipientId], { prepare: true });
}`,
      },
      hints: [
        'A redelivered Kafka message generates a new random timeuuid. What stable identity does the email itself carry?',
        'Where should multi-megabyte attachment bytes live, and what should the metadata row hold instead?',
        'Read-then-write of the unread count from two workers at once: what happens? Can you avoid storing a counter at all, or make the increment idempotent?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Client, types } from 'cassandra-driver';
import { simpleParser } from 'mailparser';
import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const db = new Client({ contactPoints: ['cass'], localDataCenter: 'dc1', keyspace: 'mail' });
const s3 = new S3Client({});
const BUCKET = process.env.ATTACHMENT_BUCKET!;

export async function processInbound(raw: Buffer, recipientId: string) {
  const mail = await simpleParser(raw);
  // Stable dedupe key: Message-ID (or a hash of raw bytes if absent) + recipient
  const msgKey = mail.messageId ?? createHash('sha256').update(raw).digest('hex');

  // 1) Claim (recipient, message) once with a lightweight transaction.
  //    If it already exists, Cassandra returns the existing row => reuse its email_id.
  const candidate = types.TimeUuid.now();
  const claim = await db.execute(
    'INSERT INTO inbound_dedupe (user_id, msg_key, email_id) VALUES (?, ?, ?) IF NOT EXISTS',
    [recipientId, msgKey, candidate], { prepare: true });
  const row = claim.first();
  const emailId = row['[applied]'] ? candidate : row['email_id'];

  // 2) Bytes -> object storage BEFORE metadata, so a visible email always has its body
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'body/' + recipientId + '/' + emailId, Body: raw }));
  const attachmentRefs = await Promise.all(mail.attachments.map(async (a) => {
    const key = 'att/' + createHash('sha256').update(a.content).digest('hex');   // content-addressed
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: a.content, ContentType: a.contentType }));
    return { key, filename: a.filename ?? 'attachment', size: a.size };
  }));

  // 3) Metadata upserts keyed by the same emailId => a retry rewrites identical rows
  const from = mail.from?.text ?? '';
  const subject = mail.subject ?? '';
  await db.batch([
    { query: 'INSERT INTO emails_by_user (user_id, email_id, subject, from_addr, preview, attachments) VALUES (?,?,?,?,?,?)',
      params: [recipientId, emailId, subject, from, (mail.text ?? '').slice(0, 200), JSON.stringify(attachmentRefs)] },
    { query: 'INSERT INTO emails_by_folder (user_id, folder_id, email_id, from_addr, subject) VALUES (?,?,?,?,?)',
      params: [recipientId, 'inbox', emailId, from, subject] },
    { query: 'INSERT INTO unread_emails (user_id, folder_id, email_id, from_addr, subject) VALUES (?,?,?,?,?)',
      params: [recipientId, 'inbox', emailId, from, subject] },
  ], { prepare: true, logged: true });
  // No read-modify-write counter: unread count is derived from unread_emails
  // (bounded per folder partition) and cached with a short TTL.
  return emailId;
}`,
      },
      explanation: `**Fixes:**
1. **Duplicates.** The old code minted a fresh timeuuid per delivery, so every Kafka redelivery created a new email. Now \`(user_id, Message-ID)\` is claimed with \`IF NOT EXISTS\` (a Paxos LWT, used once per email), and all later writes reuse the claimed email_id, so they're idempotent upserts.
2. **Database bloat.** Attachment bytes and full bodies were written into Cassandra rows, and multi-MB cells hurt compaction and repair. Now attachments go to object storage, content-addressed so identical attachments dedupe and retries overwrite the same key. The metadata keeps only refs, a preview and the headers, matching Ch 8's split.
3. **Unread count drift.** A read-modify-write counter races across workers, and it double-counts on retries. The count is now derived from the \`unread_emails\` partition (bounded per folder, and cacheable), or kept in a cache that's periodically reconciled. Cassandra counters aren't idempotent either, so blind \`+1\` on retry would still drift.
4. **Consistency of the views.** emails_by_folder and unread_emails are written in one logged batch on the same partition, so the list and the unread view don't diverge.`,
      followUps: [
        {
          "q": "The S3 write succeeds, then the worker crashes before the Cassandra batch. On redelivery a different S3 object or claim could be created. Is the code safe?",
          "a": "Yes: the dedupe claim fixes `emailId` on the first attempt, so the redelivery reuses the same emailId and overwrites the same body key, and attachments are content-addressed. The leftover risk is the opposite failure: the claim row exists but the message is permanently dropped (e.g. poison message sent to a DLQ), leaving an orphaned claim and S3 object. A periodic sweeper finds claims with no emails_by_user row older than a threshold and either reprocesses from the DLQ or cleans up."
        },
        {
          "q": "A user has 80K unread emails in their inbox. Deriving the unread count from `unread_emails` on every page load is slow. What do you do?",
          "a": "Counting 80K rows per page load is too expensive. Keep a maintained counter but make updates idempotent: store per-email unread state transitions in the same batch, and compute the counter asynchronously from a change stream with dedup by (emailId, transition), or keep the count in a cache that's reconciled by a periodic full count. For display, cap it — '9,999+' needs only a bounded count with LIMIT 10,000. Exact counts matter less than consistency between list and badge."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-storage-iq-1',
      difficulty: 'hard',
      question:
        'Design Dropbox. Focus on how a 2 GB file edited on one laptop gets to the user\'s other three devices quickly and cheaply.',
      whatInterviewerLooksFor: [
        'Separates metadata service from block storage; bytes bypass app servers',
        'Block-level chunking with content hashes; dedup and delta sync',
        'Change journal + cursor + notification (long poll) for propagation',
        'Strongly consistent metadata; atomic commit after block upload',
        'Numbers for bandwidth saved and connection counts',
      ],
      modelAnswer: `### Components
- **Metadata service:** a sharded relational DB keyed by namespace, holding files, versions (ordered block-hash lists), sharing, and a per-namespace **journal** (seq).
- **Block store:** S3 or an in-house erasure-coded store, holding immutable 4 MB blocks named by SHA-256.
- **Notification service:** a long-poll per device, woken when its namespaces' journal advances.

### Edit flow for the 2 GB file
1. The desktop client watches the file system, re-chunks the changed file, and hashes the blocks (2 GB = 512 fixed blocks, or CDC chunks).
2. \`upload-session\` with 512 hashes. The server says, for example, that 3 are missing. Dedup plus delta means **~12 MB uploaded instead of 2 GB**.
3. The client PUTs the 3 blocks directly to the block store via presigned URLs, in parallel and with retries. PUT is idempotent by hash.
4. \`commit(blockList, baseVersion)\` is one transaction: new version, refcounts, journal append. A stale base means a conflicted copy.
5. The notification service wakes the other 3 devices. Each calls \`/delta?cursor\`, gets the new block list, and downloads only the 3 blocks it lacks. They're immutable, so they can come from a CDN or the LAN (Dropbox's LAN sync).

### Why it's fast and cheap
Bandwidth scales with the *change*, not the file. Metadata operations are tiny. Commits are ~240/s at 10M DAU, so a modest sharded DB is enough.

### Scale
10M DAU × 2 devices is ~20M long-poll connections, about 200 notification nodes at ~100K connections each. Pub/sub is keyed by namespace so a wake-up only reaches the right nodes.

### Reliability
The journal is the source of truth, so a missed notification just means the device syncs on its next poll or timeout. An offline device replays from its cursor. Block GC is refcount plus mark-sweep with a grace period.`,
      followUps: [
        {
          q: 'A user inserts 1 KB at the start of the 2 GB file. What happens with fixed 4 MB blocks?',
          a: 'Every boundary shifts, all 512 hashes change, and the full 2 GB re-uploads. Content-defined chunking (rolling hash) re-aligns after the insert, so only ~1 chunk changes.',
        },
        {
          q: 'A shared folder has 50K members and changes every second. What breaks?',
          a: 'Notification fan-out. Coalesce wake-ups per namespace (at most 1 per few seconds), and let clients fetch the delta lazily. The namespace shard can also become hot, so give huge team namespaces their own shard.',
        },
        {
          q: 'How would you support end-to-end encryption?',
          a: 'Encrypt blocks client-side with per-file keys wrapped by user or team keys. Server-side cross-user dedup is lost (hashes of ciphertext differ), and previews and search need to run client-side.',
        },
      ],
      pitfalls: [
        'Uploading the whole file through app servers on every change',
        'Polling the metadata DB from every device every few seconds',
        'Last-writer-wins on conflicts',
        'Global dedup without mentioning the privacy side channel',
      ],
    },
    {
      id: 'design-storage-iq-2',
      difficulty: 'expert',
      question:
        'Two users edit the same file in a shared Google Drive folder while one of them is on a flight with no connectivity. When she lands, both edits exist. Walk me through exactly what your system does, and how the design guarantees no data loss.',
      whatInterviewerLooksFor: [
        'Versioned metadata with optimistic concurrency (base version)',
        'Deterministic conflict policy: conflicted copy, never silent overwrite',
        'Offline queue on the client; journal replay on reconnect',
        'Handling of deletes/moves vs edits conflicts',
        'Awareness of when auto-merge is possible (text, CRDT) vs not (binary)',
      ],
      modelAnswer: `### State before the flight
The file is at version 7. Both clients recorded base = 7 in their local sync database.

### While offline
Alice edits locally. Her client records the pending change (new block list, base 7) in a **local outbox**. Bob, online, commits version 8. The server journal gets seq 1051 for "edit file F → v8".

### Landing
1. Alice's client first **pulls** \`/delta\` from her last cursor and learns that F is now at v8, which is newer than her base 7.
2. It tries to commit her edit with base 7. The server's conditional update fails and returns **409 {latest: 8}**.
3. Policy: **conflicted copy.** Alice's client downloads v8 as the canonical file and uploads her version as \`F (Alice's conflicted copy 2026-09-28)\`. It's a new file, and its blocks mostly dedupe. Both are visible to both users, so nothing is lost.
4. Both commits are journaled, and Bob's devices get notified of the new file.

### Other conflict types
- **Edit vs delete:** the edit wins and the file is restored (safer), or it's recreated as a conflicted copy.
- **Move vs edit:** metadata ops use file_id, not path, so both apply cleanly.
- **Both rename to the same name:** the second gets a " (1)" suffix.

### Could we merge automatically?
Only for mergeable formats: plain text via 3-way merge using v7 as the base, or native Docs through OT/CRDT with real-time collaboration. For binary Office files a merge is unsafe, so we copy.

### Guarantees
Versions are immutable and the server never overwrites one, so every committed state is recoverable from history (30-day retention). Base-version checks make overwrites explicit, and the client outbox survives restarts.`,
      followUps: [
        {
          q: 'Why not use vector clocks instead of a server version number?',
          a: 'With one strongly consistent metadata authority per namespace, a single monotonic version is enough and simpler. Vector clocks are for multi-master replicas that accept writes independently.',
        },
        {
          q: 'Alice\'s client crashes halfway through uploading her blocks after landing. What then?',
          a: 'Blocks are idempotent and content-addressed, so on restart the client re-runs upload-session, uploads whatever is still missing, and commits. Orphan blocks from the crash are garbage-collected.',
        },
      ],
      pitfalls: [
        'Timestamp-based last-writer-wins (and trusting device clocks)',
        'Merging binary files',
        'Using paths as identity so moves look like delete + create',
      ],
    },
    {
      id: 'design-storage-iq-3',
      difficulty: 'hard',
      question:
        'Design the backend of a Gmail-scale email service for 1 billion users. Start with the numbers and let them drive your storage choices.',
      whatInterviewerLooksFor: [
        'Ch 8 estimates: ~100K send QPS, ~730 PB/yr metadata, ~1.5 EB/yr attachments',
        'Distributed metadata store partitioned by user; object storage for attachments',
        'Queued send/receive flows with SMTP workers',
        'Real-time delivery via WebSocket; stateless web tier',
        'Consistency choice per mailbox and deliverability concerns',
      ],
      modelAnswer: `### Numbers
- Send: 1B × 10/day ÷ 10^5 s ≈ **100K QPS**.
- Receive: 40 emails/day × 50 KB of metadata → 1B × 40 × 365 × 50 KB ≈ **730 PB/year**.
- Attachments: 20% × 500 KB → **~1,460 PB/year**.
So it's an exabyte-scale storage problem with modest per-user QPS. Every query is scoped to one user.

### Storage
- **Metadata** (headers, folders, flags, preview): a wide-column store (Bigtable/Cassandra) **partitioned by user_id**, with tables per access pattern (emails_by_folder ordered by timeuuid DESC, read and unread tables, threads). Hot recent mail is cached in Redis.
- **Bodies and attachments:** object storage, with erasure coding and tiering to cold storage for mail older than a year. Dedup attachments by hash, because newsletters and PDFs repeat a lot.
- **Search:** an inverted index partitioned by user, updated asynchronously from the processing pipeline.

### Flows
- **Send:** web server → spam/virus checks → internal delivery or the **outgoing queue** → SMTP workers (MX lookup, DKIM signing, retries/backoff, bounces).
- **Receive:** SMTP LB → SMTP servers (SPF/DKIM/DMARC, reputation, early reject) → attachments to S3 → **incoming queue** → processing workers (spam, filters) → metadata DB + search index → **real-time servers** push to connected clients over WebSocket.

### Consistency and availability
One primary per mailbox, favouring consistency (Ch 8). During failover the mailbox is briefly read-only rather than risking lost flags. We use multiple data centres, with users homed to a region and replicated to another.

### Deliverability
IP warm-up, separate IP pools, SPF/DKIM/DMARC, bounce and complaint handling, and quick suspension of spammer accounts.

### Trade-off
A relational DB is out on volume. A custom store like Gmail's is the endgame, while Cassandra/Bigtable with denormalised tables is the interview answer.`,
      followUps: [
        {
          q: 'How do you render "unread count" for 50 folders instantly?',
          a: 'Keep per-folder counters in a cache, updated by the processing pipeline and periodically reconciled against the unread tables, since exact recomputation on every page load is too costly.',
        },
        {
          q: 'A user has 2M emails in their inbox. Does partition by user_id still work?',
          a: 'Make the partition (user, folder, time bucket such as month) to cap partition size, and page by clustering key. The query layer walks buckets newest-first.',
        },
        {
          q: 'How do you migrate a user between regions?',
          a: 'Copy their partitions and blobs in the background, catch up with the change stream, briefly freeze writes to that mailbox, flip the home region, and resume.',
        },
      ],
      pitfalls: [
        'Postgres for everything without sizing',
        'Storing attachments in the metadata DB',
        'Ignoring SMTP retry semantics and duplicate delivery',
        'No mention of spam/deliverability',
      ],
    },
    {
      id: 'design-storage-iq-4',
      difficulty: 'expert',
      question:
        'Users complain that search in our email product is slow and misses recent emails. Today we index into one big Elasticsearch cluster. How would you redesign email search?',
      context: 'The interviewer will push on write amplification and per-user partitioning.',
      whatInterviewerLooksFor: [
        'Recognises the write-heavy nature (every email indexed, few searched)',
        'Partitions index by user; routing to one shard per query',
        'Async indexing pipeline with freshness SLO and backpressure',
        'Hot/cold tiering and index lifecycle',
        'Awareness of Gmail-style custom LSM index trade-off',
      ],
      modelAnswer: `### Why it's slow and stale
Email search is **write-heavy and read-light**: every incoming email (~40/user/day, so about 40B/day globally) is indexed, but a user searches maybe a few times a week. A monolithic ES cluster with default hashing spreads each user across all shards, so **every query fans out** to hundreds of shards (tail latency). Bulk indexing competes with queries, refresh intervals and backlog cause staleness, and heavy users create hot shards.

### Redesign
1. **Route by user:** use ES custom routing (\`routing=user_id\`) or index-per-tenant-group, so a user's documents sit on one shard and a query hits exactly one shard. Latency then depends on the user's mailbox size, not the cluster.
2. **Indexing pipeline:** the processing workers emit an "email stored" event to Kafka, partitioned by user_id so updates for one user stay ordered. Indexers bulk-write with a freshness SLO (e.g. p99 < 5 s). Monitor consumer lag and autoscale indexers on it.
3. **Read-your-writes for fresh mail:** at query time, union the index results with a scan of the user's last N minutes of metadata from the primary DB or cache. That covers emails not yet indexed.
4. **Tiering:** recent (hot) indices on SSD with more replicas, and old mail in a cold tier. Most searches target the last few months.
5. **Mapping hygiene:** index the subject, from/to, body text (truncated to ~100 KB) and attachment names. Extract attachment text asynchronously in a separate, lower-priority lane.

### Endgame
At Gmail scale a **custom per-user inverted index** built on LSM trees (write-optimised, co-located with mailbox data) avoids running a second massive system and its sync problems. That's high effort, and Ch 8 notes the trade-off explicitly.

### Numbers
~460K emails/s being indexed globally. At ~2 KB of index per email that's ~80 TB/day before replication, which is why tiering and per-user routing matter.`,
      followUps: [
        {
          q: 'How do you handle deletions and label changes in the index?',
          a: 'Emit update or delete events through the same user-partitioned Kafka topic so they apply in order. Labels are small fields updated via partial docs, and deletes are tombstones merged at segment merge.',
        },
        {
          q: 'How do you reindex after a mapping change?',
          a: 'Build a new index in the background from the metadata DB or blob store, dual-write during catch-up, switch an alias, then drop the old index.',
        },
      ],
      pitfalls: [
        'Adding more ES nodes without fixing fan-out',
        'Synchronous indexing in the receive path',
        'Ignoring freshness for just-received emails',
      ],
    },
    {
      id: 'design-storage-iq-5',
      difficulty: 'hard',
      question:
        'Design a GFS/HDFS-style distributed file system for a 5,000-node analytics cluster. Explain how a client writes a 10 GB file and what happens if a node in the write pipeline dies halfway.',
      whatInterviewerLooksFor: [
        'Master metadata vs chunkserver data separation',
        'Large chunks, 3× rack-aware replication',
        'Lease/primary ordering (GFS) or single-writer pipeline (HDFS)',
        'Pipeline recovery with generation stamps; re-replication later',
        'Checksums and heartbeats',
      ],
      modelAnswer: `### Architecture
A NameNode/master holds the namespace, file → blocks mapping and block locations in RAM, with the edit log replicated to JournalNodes. DataNodes/chunkservers store 128 MB blocks on local disks and send heartbeats every 3 s plus periodic block reports. Clients do all data I/O directly with DataNodes.

### Writing 10 GB (HDFS flavour)
1. \`create(path)\`: the NameNode checks permissions, records the file in the EditLog, and grants the client a **write lease** on the file (single writer).
2. The file is split into 80 blocks of 128 MB. For each block the client asks for a new block ID and gets 3 DataNodes, chosen rack-aware: local, then two on one remote rack.
3. The client streams **64 KB packets** down the pipeline DN1 → DN2 → DN3, with acks returning in reverse. Each DataNode checksums the data (CRC32C per 512 B) and writes to disk.
4. When a block completes, the DataNodes report it and the client moves to the next block. \`close()\` finalises the file once the minimum replication is reached.

### DN2 dies mid-block
- The pipeline stalls on acks. The client stops, moves un-acked packets back to its send queue, and removes DN2 from the pipeline.
- The NameNode issues a **new generation stamp** for the block. DN1 and DN3 sync to the last acked length, and the client resumes streaming to [DN1, DN3], optionally adding a replacement DataNode (policy dependent).
- DN2's partial replica carries the old stamp, so if it comes back it's recognised as stale and deleted.
- The block is under-replicated (2/3), so the NameNode's re-replication queue copies it to a third node asynchronously, prioritised below blocks that have only 1 replica.

### GFS difference
GFS uses per-chunk **leases** to a primary replica that orders concurrent mutations, supporting multi-writer **record append** (at-least-once) instead of a single writer.

### Throughput
With a pipelined chain, writing 10 GB at ~100 MB/s per stream takes ~100 s, and many clients write in parallel across 5,000 nodes.`,
      followUps: [
        {
          q: 'Why not have the client write to all 3 replicas in parallel instead of a chain?',
          a: 'The client\'s NIC would carry 3× the data. A chain uses each node\'s outbound link once and crosses the rack boundary once, so throughput is limited by a single link, not a third of the client\'s link.',
        },
        {
          q: 'How does a reader choose a replica?',
          a: 'The NameNode returns locations sorted by network distance (same node, then same rack, then remote). The client reads from the closest, verifies checksums, and falls back on error, reporting corrupt replicas.',
        },
      ],
      pitfalls: [
        'Sending data through the master',
        'Forgetting that stale replicas must be detected (generation stamp/version)',
        'All replicas in one rack',
      ],
    },
    {
      id: 'design-storage-iq-6',
      difficulty: 'expert',
      question:
        'Your HDFS NameNode heap is at 180 GB and GC pauses are causing cluster-wide stalls. The data team keeps writing millions of tiny Parquet files. How do you fix this short term and long term?',
      context: 'Production framing: the cluster holds 400M files averaging 2 MB.',
      whatInterviewerLooksFor: [
        'Understands per-object NameNode memory (~150 B/object) and object count math',
        'Short-term: compaction of small files, quotas, GC tuning',
        'Long-term: federation / router-based federation, or object storage + table formats',
        'Root-cause fix in the producing jobs',
      ],
      modelAnswer: `### Diagnose with numbers
400M files, each with ≥1 block, gives ~800M+ namespace objects (files plus blocks, plus directories). At ~150 B each that's ~120 GB of live metadata, and with Java object overhead and headroom, 180 GB heaps are expected. A 2 MB average means blocks are ~1.5% full: **the NameNode is sized by object count, not bytes**. Large heaps mean long GC pauses, and during a full GC the NameNode is unresponsive, so every client stalls. Block reports from DataNodes and failover times also balloon.

### Short term
1. **Compact small files:** run Spark compaction jobs that rewrite partitions into 256 MB–1 GB files, and delete the originals. Target the worst directories first (the top-N by file count).
2. **Namespace quotas** per team directory to stop the bleeding.
3. **GC tuning:** G1 with pause targets, or move to a JVM/collector that handles big heaps better. Raise NameNode handler counts. Make sure the Standby NameNode is doing checkpoints so the active isn't.
4. **HAR files or SequenceFiles** for archival small files.

### Fix the producers
Stop streaming jobs from writing a file per micro-batch per partition: coalesce output, use larger trigger intervals, and let table formats (Iceberg/Delta/Hudi) run compaction automatically.

### Long term
- **Federation:** split the namespace across several NameNodes (/warehouse, /logs, /ml), each with its own heap, fronted by **router-based federation** so clients see one namespace.
- Or **move the data lake to object storage** (S3/Ozone) with Iceberg. Metadata then scales horizontally and compute/storage separate, at the cost of data locality and needing a table format for atomic commits and listings.
- Ozone and Colossus show the pattern: metadata in a scalable KV store (Ozone's OM/SCM on RocksDB, Colossus on Bigtable) instead of one JVM heap.`,
      followUps: [
        {
          q: 'Would erasure coding help the NameNode memory problem?',
          a: 'No, it can make it worse. EC block groups add metadata, and EC is inefficient for small files. EC saves disk, not namespace objects.',
        },
        {
          q: 'How do you compact without breaking running readers?',
          a: 'Write compacted files to a new location and swap the partition atomically: through the table format\'s commit, or by a rename and then a metastore update. Delete old files after a grace period.',
        },
      ],
      pitfalls: [
        'Just adding DataNodes (they don\'t hold the metadata)',
        'Throwing more heap at it indefinitely',
        'Ignoring the upstream job pattern creating tiny files',
      ],
    },
    {
      id: 'design-storage-iq-7',
      difficulty: 'medium',
      question:
        'For a Drive-like product, would you build your own block storage or put blocks in S3? Dropbox famously moved off S3 to Magic Pocket. When is that the right call?',
      whatInterviewerLooksFor: [
        'Frames it as a cost/scale/control trade-off with numbers',
        'Knows what building durable storage entails (EC, repair, multi-region, ops)',
        'Mentions hybrid and staged approaches',
        'Connects to access patterns (immutable blocks, hot/cold)',
      ],
      modelAnswer: `### Default: S3 (or GCS/Azure Blob)
It offers 11 nines of durability, no ops burden, lifecycle tiering (Standard → IA → Glacier), and presigned URLs for direct client upload. Immutable, content-addressed blocks are a perfect fit. At ~$21–23/TB-month for standard storage, 10 PB costs roughly **$2.5–2.8M/year** before request and egress costs, and egress often dominates for sync products.

### When building your own pays off
Dropbox moved hundreds of petabytes to Magic Pocket around 2015–2016 because:
- At **exabyte scale**, owned hardware with erasure coding (~1.3–1.5× overhead) costs a fraction of cloud list price, and they could negotiate hardware, power and network.
- **Workload specialisation:** immutable 4 MB blocks, a known read/write mix and a cold long tail allow SMR drives, custom repair and custom placement.
- **Egress and network control:** with their own backbone and peering, they avoid per-GB egress.

### What you sign up for
Multi-zone erasure coding, background repair and scrubbing, disk-failure handling (thousands of disks fail per year), capacity planning, a verifier that checks every block, and a team of storage engineers running it for years. Migration itself took Dropbox around two years with dual-write and verification.

### Recommendation
Start on S3 and design the block layer behind an interface (put/get/delete by hash), so moving later is a backend swap. Revisit when storage plus egress spend exceeds the loaded cost of a storage team plus hardware, which is typically tens of petabytes or more. A hybrid is also possible: cold data in your own store, hot data cached at a CDN.`,
      followUps: [
        {
          q: 'How would you migrate 100 PB off S3 safely?',
          a: 'Dual-write new blocks, backfill old blocks in rate-limited batches, verify each block\'s hash after copying, switch reads per cohort with a fallback to S3 on a miss, and delete from S3 only after a verification period.',
        },
        {
          q: 'What durability target would you set for your own store, and how do you verify it?',
          a: 'Aim for 11+ nines from the erasure-coding math and repair-time modelling. Verify with continuous scrubbing and an independent verifier that re-reads samples and all metadata-referenced blocks.',
        },
      ],
      pitfalls: [
        'Assuming building storage is cheaper at any scale',
        'Ignoring egress and request costs',
        'No abstraction layer, which locks you into one backend',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-storage-boe-1',
      question:
        'Estimate the physical storage and daily upload bandwidth for a Drive-like service with 100M users, and how much block-level dedup and delta sync save.',
      assumptions: [
        '100M users, average 8 GB actually used (not quota)',
        '20% of bytes are duplicates across a user\'s own files/devices; 10% more across users (if global dedup is allowed)',
        'Storage layer uses erasure coding at 1.5× overhead',
        '20M DAU, each modifying 5 files/day averaging 20 MB, with ~10% of blocks changed per edit',
      ],
      steps: [
        { label: 'Logical data', calc: '100M × 8 GB = 800 PB' },
        { label: 'After per-user dedup', calc: '800 PB × 0.8 = 640 PB' },
        { label: 'After global dedup (optional)', calc: '640 PB × 0.9 ≈ 576 PB' },
        { label: 'Physical with EC', calc: '576 PB × 1.5 ≈ 864 PB (vs 1,728 PB with 3× replication)' },
        { label: 'Upload without delta sync', calc: '20M × 5 × 20 MB = 2 PB/day ≈ 23 GB/s' },
        { label: 'Upload with delta sync', calc: '2 PB × 10% = 200 TB/day ≈ 2.3 GB/s (≈ 18.5 Gbps)' },
      ],
      answer:
        'Roughly 860 PB physical with erasure coding (about 1.7 EB if 3× replicated), and ~200 TB/day of upload traffic with delta sync versus ~2 PB/day without it.',
      insight:
        'Delta sync cuts ingest bandwidth by ~10×, and EC versus replication halves the hardware bill. At this scale those two choices matter more than any metadata optimisation. Global dedup adds only ~10% here and carries a privacy cost, so per-user dedup is the sensible default.',
      followUps: [
        {
          "q": "40% of edited bytes turn out to be compressed or encrypted formats (zip, video, .docx) where a small edit changes most chunks. Redo the upload estimate.",
          "a": "Delta sync only helps the other 60%. Upload = 2 PB × (0.6 × 0.1 + 0.4 × 1.0) = 2 PB × 0.46 ≈ 920 TB/day ≈ 10.6 GB/s — about 4.6× the 200 TB/day estimate. The 'delta sync saves 10×' assumption is the fragile one. Mitigations: format-aware chunking (unzip Office docs and chunk the inner XML parts), smaller chunks for media containers, and LAN sync between a user's own devices so cross-device updates skip the server entirely."
        },
        {
          "q": "Finance wants to move from 1.5× EC to 1.2× (e.g. RS(10,2)). What do you give up?",
          "a": "Storage drops from ~864 PB to ~691 PB — about 173 PB saved. But RS(10,2) survives only 2 lost fragments instead of 3 (for RS(6,3)), so durability depends on repairing faster than correlated failures happen, and each repair reads 10 fragments instead of 6, increasing repair traffic. Wider stripes also mean more nodes touched per read, so tail latency is worse. A common compromise is wide, low-overhead codes for cold data and more redundancy for recent, hot data."
        }
      ],
    },
    {
      id: 'design-storage-boe-2',
      question:
        'Size the metadata store for an email service with 1B users (Ch 8 assumptions) and estimate how many Cassandra nodes you need for one year of metadata.',
      assumptions: [
        '1B users receive 40 emails/day; 50 KB metadata per email (Ch 8, includes header + body text)',
        'Replication factor 3; Cassandra node comfortably holds ~4 TB of data (compaction headroom)',
        'Compression ratio 2× on text',
        'Denormalised views (folder, unread) add ~20% on top of the main table',
      ],
      steps: [
        { label: 'Raw metadata per year', calc: '1B × 40 × 365 × 50 KB = 730 PB' },
        { label: 'With denormalised views', calc: '730 PB × 1.2 ≈ 876 PB' },
        { label: 'After compression', calc: '876 PB ÷ 2 ≈ 438 PB' },
        { label: 'With RF=3', calc: '438 PB × 3 ≈ 1.3 EB' },
        { label: 'Nodes', calc: '1.3 EB ÷ 4 TB ≈ 330,000 nodes' },
        { label: 'Receive write QPS', calc: '1B × 40 ÷ 86,400 ≈ 463K emails/s → ~1.4M row writes/s with views, ~4.2M replica writes/s' },
      ],
      answer:
        'About 1.3 EB of replicated metadata per year, which would mean ~330K Cassandra nodes. That is an absurd number, and it shows why real systems keep only headers and a preview in the database.',
      insight:
        'The number forces a design change: move bodies (the bulk of the 50 KB) into erasure-coded object or blob storage, keep only headers, flags and a preview (~2 KB) in the wide-column store, and tier old mail. That cuts DB size by ~25× and replicated storage by ~2×. It is also why Gmail built on Bigtable/Colossus rather than a generic cluster.',
      followUps: [
        {
          "q": "You keep only headers, flags and a 2 KB preview in Cassandra and move bodies to object storage. Re-run the node count.",
          "a": "DB: 1B × 40 × 365 × 2 KB ≈ 29.2 PB/year raw; ×1.2 views ÷ 2 compression × RF3 ≈ 52.6 PB, which at 4 TB/node is ~13K nodes — 25× fewer than 330K. Bodies (~48 KB each) go to erasure-coded blob storage: ~700 PB raw, ~525 PB after 2× compression and 1.5× EC. Total bytes are still large, but they land on cheap dense storage instead of replicated SSD database nodes."
        },
        {
          "q": "Most of the 40 emails/day are newsletters and notifications sent to millions of recipients. Can you exploit that?",
          "a": "Yes: dedupe bodies across recipients. A newsletter sent to 5M users has an identical body (minus per-recipient tracking links); store it once, content-addressed, and give each recipient a metadata row pointing at it. Per-recipient personalisation can be stored as a small diff. If bulk mail is, say, half of volume with large fan-out, blob storage shrinks substantially. The caveats: deletion becomes reference-counted, and privacy rules require that a user's deletion removes their access (and, if last reference, the content)."
        }
      ],
    },
    {
      id: 'design-storage-boe-3',
      question:
        'An HDFS cluster must store 60 PB of data. Estimate NameNode heap for (a) 256 MB average files and (b) 1 MB average files, and the re-replication time after a DataNode with 48 TB fails.',
      assumptions: [
        '~150 bytes of NameNode heap per file object and per block object (rule of thumb)',
        '128 MB block size; files ≤ 128 MB occupy 1 block',
        '3× replication; 2,000 DataNodes, each can spend 50 MB/s on re-replication traffic',
        'Heap headroom factor 2× for GC',
      ],
      steps: [
        { label: '(a) Files and blocks', calc: '60 PB ÷ 256 MB ≈ 234M files × 2 blocks = 469M blocks → ~703M objects' },
        { label: '(a) Heap', calc: '703M × 150 B ≈ 105 GB × 2 headroom ≈ 210 GB → too big for comfort; federate into 2–3 namespaces' },
        { label: '(b) Files and blocks', calc: '60 PB ÷ 1 MB = 60B files, each 1 block → 120B objects' },
        { label: '(b) Heap', calc: '120B × 150 B = 18 TB of heap → impossible on one NameNode' },
        { label: 'Re-replication after one DN failure', calc: '48 TB spread across ~2,000 peers × 50 MB/s = 100 GB/s → 48 TB ÷ 100 GB/s ≈ 8 minutes' },
      ],
      answer:
        '(a) ~100 GB of live metadata (~200 GB heap): workable only with federation. (b) ~18 TB of heap: impossible, so small files must be compacted or moved to object storage. Re-replicating a failed 48 TB node takes only ~8 minutes, because every DataNode participates.',
      insight:
        'Metadata count, not bytes, caps a single-master DFS, so file size policy (compaction, table formats) is an architecture decision. Wide replica scatter is what makes recovery fast: if a node\'s blocks were mirrored to only one peer, recovery would take 48 TB ÷ 50 MB/s ≈ 11 days.',
      followUps: [
        {
          "q": "Case (a) becomes 64 MB average files because a new pipeline writes hourly. What happens to the heap, and what do you do?",
          "a": "60 PB ÷ 64 MB ≈ 937.5M files, each one block: ~1.9B objects × 150 B ≈ 281 GB of metadata, ~560 GB with 2× GC headroom — beyond any practical single NameNode. Options: compact hourly outputs into daily files, use HDFS federation (split namespaces by directory, e.g. /warehouse vs /logs across NameNodes), or adopt a table format that compacts automatically. Router-based federation hides the split behind one mount table for clients."
        },
        {
          "q": "Two DataNodes fail 3 minutes apart. Given the ~8-minute re-replication window, should you worry about data loss?",
          "a": "Loss requires all 3 replicas of a block gone. After the first failure, its blocks are at 2 replicas for up to ~8 minutes; the second failure only loses data if it also had one of those replicas and a third replica is also lost before repair. With replicas scattered across 2,000 nodes, the overlap between any two nodes is small, so two failures cause many blocks at 1 replica but no loss. Three near-simultaneous failures (a rack or power event) are the real risk, which rack-aware placement addresses."
        }
      ],
    },
  ],
  test: [
    {
      id: 'design-storage-mcq-01',
      difficulty: 'expert',
      question:
        'A 400 MB file is synced with 4 MB fixed-size blocks. The user inserts a 10-byte header at the very beginning and saves. Roughly how many blocks must be uploaded, and what change would fix it?',
      code: {
        language: 'typescript',
        code: `// client chunker
for (let off = 0; off < file.length; off += 4 * 1024 * 1024) {
  const block = file.subarray(off, off + 4 * 1024 * 1024);
  hashes.push(sha256(block));
}`,
      },
      options: [
        'About 100 blocks (the whole file), because every boundary shifts by 10 bytes; content-defined chunking with a rolling hash would limit it to ~1 chunk',
        '1 block, because only the first block\'s contents changed',
        '2 blocks (the first and the last), because the file grew by 10 bytes; switching to 1 MB blocks would fix it',
        'About 100 blocks, and the only fix is binary diffing the whole file on the server',
      ],
      correct: [0],
      explanation:
        'With fixed offsets, a prefix insert shifts every byte, so all ~100 block hashes change and the whole file re-uploads. Content-defined chunking places boundaries based on content, so boundaries after the insert re-align and only the chunk containing the insert changes. Smaller fixed blocks shift just as badly. Server-side binary diff (rsync-style) can help, but it is not the only fix and it costs CPU.',
      followUps: [
        {
          "q": "You switch to content-defined chunking with a 4 MB average. A user's 400 MB file gives you chunks ranging from 2 KB to 60 MB. What went wrong, and how do you bound it?",
          "a": "A pure rolling-hash cut point gives a geometric size distribution: some boundaries come very early and some content (long runs of zeros, repetitive data) never triggers one. Production chunkers (FastCDC, Rabin with limits) enforce a minimum (e.g. 1 MB, skipping the hash check before it) and a hard maximum (e.g. 16 MB, forced cut), and use normalized chunking to tighten the distribution around the target. The minimum also saves CPU because the rolling hash is skipped for the first bytes of each chunk."
        },
        {
          "q": "Chunking a 2 GB file with a rolling hash on a low-end laptop takes too long and drains battery. How do you avoid re-chunking the whole file on every save?",
          "a": "Use the OS change information: the file watcher tells you the file changed, and comparing the old chunk index (offsets + hashes) to the new file lets you re-hash only from the first modified region forward until boundaries re-align with known chunks, then reuse the rest. Many clients also use cheap gear-based hashing (FastCDC is several times faster than Rabin) and hash with SHA-256 only the chunks that changed. Throttle background hashing when on battery."
        }
      ],
    },
    {
      id: 'design-storage-mcq-02',
      difficulty: 'hard',
      question:
        'Your upload-session API tells clients "the server already has block X, skip it" using global cross-user dedup. What is the most serious risk?',
      options: [
        'Hash collisions in SHA-256 will corrupt user files',
        'Dedup makes the metadata DB the bottleneck',
        'It is a side channel: an attacker can learn whether any user has a specific file (such as a leaked document) by probing its hashes',
        'It breaks delta sync, because blocks can no longer be addressed by hash',
      ],
      correct: [2],
      explanation:
        'A dedup "hit" reveals that the content exists somewhere in the system, which enables confirmation-of-file attacks. It also lets an attacker who knows only a hash claim the content, as in the historical Dropship issue. Mitigations are per-user or per-team dedup, or proof-of-ownership protocols. SHA-256 collisions are not a practical concern. Dedup does not make metadata the bottleneck and is fully compatible with content addressing.',
      followUps: [
        {
          "q": "Security says global dedup must go, but storage wants the savings. Can you keep cross-user dedup without the side channel?",
          "a": "Partially. Always make the client upload the bytes (no 'skip, we have it' response) and dedup server-side after receipt — the server still saves storage, but the client learns nothing; you lose the bandwidth savings, not the storage savings. For proof that a claimer actually owns content, use proof-of-ownership challenges (hash of random byte ranges). Convergent encryption allows dedup on encrypted data but is still vulnerable to confirmation-of-file attacks, so restrict dedup to within a team."
        }
      ],
    },
    {
      id: 'design-storage-mcq-03',
      difficulty: 'expert',
      question:
        'Two devices commit edits to the same file at nearly the same time. Given this handler (Postgres, READ COMMITTED), what is the outcome?',
      code: {
        language: 'sql',
        code: `-- executed by each device's commit
BEGIN;
SELECT latest_version FROM file WHERE file_id = 42;         -- both read 7
INSERT INTO file_version (file_id, version, block_list) VALUES (42, 8, $1);
UPDATE file SET latest_version = 8 WHERE file_id = 42;
COMMIT;`,
      },
      options: [
        'Both commit and the file has two version-8 rows; the latest pointer is 8, so the user sees whichever was inserted last',
        'Postgres detects the read-then-write conflict and aborts one transaction with a serialization failure',
        'Both succeed and the second overwrites the first\'s block_list in place',
        'The second transaction fails on the file_version primary key (file_id, version) = (42, 8), so one edit is rejected, but only by accident of the PK; with a different schema it would be silently lost',
      ],
      correct: [3],
      explanation:
        'Under READ COMMITTED both transactions read 7 and both try to insert version 8. The PK on (file_id, version) makes the second INSERT fail, so the conflict is caught by accident. Without that constraint (for example, a surrogate id), both would commit and one edit would effectively disappear. READ COMMITTED does not raise serialization failures; only SERIALIZABLE (SSI) would. The robust fix is a conditional UPDATE ... WHERE latest_version = :base and an explicit conflict response.',
      followUps: [
        {
          "q": "You add the conditional UPDATE. The losing device gets a conflict. What should the client actually do with the user's edit, and what does the user see?",
          "a": "Never discard it. The client uploads its version as a new file, typically named 'report (Alice's conflicted copy 2026-10-07).docx', in the same folder, then syncs the winner as the main file. The user resolves manually. For formats the server understands (plain text, or structured docs) you could attempt a three-way merge using the shared base version, but for opaque binaries a conflicted copy is the only safe choice. Log conflict rate per folder to spot sync bugs."
        }
      ],
    },
    {
      id: 'design-storage-mcq-04',
      difficulty: 'medium',
      question:
        'You need to tell ~20M idle desktop clients "something in your folder changed" within a few seconds. Why is long polling a reasonable choice here, as Dropbox did?',
      options: [
        'Long polling delivers file bytes faster than WebSockets',
        'The channel is one-way and low-rate (just "changed"), long polling works through proxies and firewalls with plain HTTP, and clients then fetch the delta via the normal API',
        'Long polling needs no server-side state, so 20M clients cost nothing',
        'Long polling guarantees exactly-once delivery of every change event',
      ],
      correct: [1],
      explanation:
        'The notification only has to say "go sync". Data flows through the regular delta API, so bidirectional WebSockets bring little benefit, and plain HTTP long polls traverse corporate proxies easily. Long polls still hold a connection and some state per client, so they are not free. Neither transport delivers file bytes faster. Correctness comes from the journal cursor, not exactly-once notifications; a missed wake-up is fixed on the next poll.',
      followUps: [
        {
          "q": "A notification server holding 2M long-poll connections crashes. What do those clients miss, and how does the design recover?",
          "a": "They miss nothing permanent: the long poll only said 'something changed'. Clients see the connection drop, reconnect with jitter to another server, and the first thing they do is call the delta API with their stored journal cursor, which returns everything since. The cost is a reconnect spike of 2M requests; jittered backoff spreads it over tens of seconds, and the delta API must be cheap for 'no changes since cursor' responses (served from cache of latest seq per namespace)."
        }
      ],
    },
    {
      id: 'design-storage-mcq-05',
      difficulty: 'hard',
      question:
        'In a content-addressed block store shared by all file versions, select ALL conditions that should hold before a block is physically deleted.',
      options: [
        'No retained file version (including revision history within the retention window) references its hash',
        'A grace period has passed since the reference count reached zero, so in-flight uploads and commits that will reference it can finish',
        'The block is older than 24 hours',
        'A periodic mark-and-sweep confirms it is unreferenced, guarding against refcount drift',
        'The user who first uploaded the block has deleted their account',
      ],
      correct: [0, 1, 3],
      explanation:
        'Blocks are shared across versions and users, so deletion needs zero references across retained history, and a grace period to cover the upload-before-commit window (a client may have just been told "you have it, skip"). Mark-and-sweep catches counter bugs. Age alone says nothing about references. The first uploader is irrelevant, because other users or versions may reference the same content.',
      followUps: [
        {
          "q": "Mark-and-sweep must scan references across billions of file versions. How do you run it without stopping commits?",
          "a": "Use generations: record the sweep start time T, scan all live version manifests (in parallel, from a snapshot or replica) to build the reachable set, and only delete blocks that are unreferenced AND were created before T minus the grace period. Blocks uploaded or referenced during the scan are protected by the timestamp rule. Do deletion as a soft-delete first (move to a trash tier for days), so a bug in the sweep is recoverable — the single most important safety net in any GC."
        }
      ],
    },
    {
      id: 'design-storage-mcq-06',
      difficulty: 'expert',
      question:
        'An engineer proposes this Cassandra schema and query for the "Unread" filter of the inbox. What will happen at scale, and what does Ch 8 recommend instead?',
      code: {
        language: 'sql',
        code: `CREATE TABLE emails_by_folder (
  user_id UUID, folder_id TEXT, email_id TIMEUUID, subject TEXT, is_read BOOLEAN,
  PRIMARY KEY ((user_id, folder_id), email_id)
) WITH CLUSTERING ORDER BY (email_id DESC);

SELECT * FROM emails_by_folder
 WHERE user_id = ? AND folder_id = 'inbox' AND is_read = false
 ALLOW FILTERING;`,
      },
      options: [
        'It is efficient, because the partition key is fully specified and ALLOW FILTERING only applies within the partition',
        'Cassandra rejects the query, because boolean columns cannot be filtered',
        'It scans the whole partition and filters server-side; for large inboxes with few unread emails it reads far more data than it returns. Ch 8 denormalises into separate read_emails / unread_emails tables',
        'Add a secondary index on is_read; low-cardinality secondary indexes are Cassandra\'s intended solution',
      ],
      correct: [2],
      explanation:
        'With the partition key given, ALLOW FILTERING scans that partition\'s rows, so cost is proportional to inbox size, not to result size. A user with 100K emails and 3 unread reads 100K rows. Wide-column stores favour one table per query pattern, so Ch 8 keeps unread and read emails in separate tables and moves rows on state change. Boolean filtering is allowed. Low-cardinality secondary indexes are a known Cassandra anti-pattern.',
      followUps: [
        {
          "q": "With separate read_emails and unread_emails tables, marking an email read is a delete + insert. The worker crashes between them. What does the user see, and how do you make it safe?",
          "a": "If it crashed after delete and before insert, the email vanishes from both views; in the other order, it shows in both. Put both mutations in a Cassandra logged batch: the batchlog guarantees all statements eventually apply (not isolation, so a reader may briefly see the intermediate state). Make operations idempotent so client retries are harmless, and keep the canonical is_read flag in the main email row so a repair job can rebuild views if they drift."
        }
      ],
    },
    {
      id: 'design-storage-mcq-07',
      difficulty: 'hard',
      question:
        'Your inbound SMTP server replies 250 OK before the message is written anywhere durable, then pushes it to Kafka asynchronously. What failure does this cause, and why?',
      code: {
        language: 'typescript',
        code: `smtp.onData(async (stream, session, callback) => {
  const raw = await readAll(stream);
  callback();                                   // 250 OK sent to remote MTA
  producer.send({ topic: 'inbound', messages: [{ value: raw }] }).catch(log);
});`,
      },
      options: [
        'Silent email loss: once 250 is sent the remote MTA deletes its copy, so a crash or Kafka error before the send completes loses the email forever',
        'Duplicates, because the remote MTA will retry after 250 OK',
        'Spam increases, because SPF checks are skipped when the callback runs early',
        'No problem; SMTP guarantees end-to-end delivery through DSNs',
      ],
      correct: [0],
      explanation:
        'In SMTP, 250 after DATA transfers responsibility for the message to the receiver. The sender stops retrying and discards it. Acknowledging before durable enqueue means any crash or produce error loses mail silently. The correct order is durable write (Kafka acks=all, or disk), then 250. The opposite ordering risks duplicates on retry, which are handled with Message-ID dedupe. SPF happens at MAIL FROM time and is unaffected. DSNs are generated only by servers that know delivery failed.',
      followUps: [
        {
          "q": "You now write to Kafka with acks=all before replying 250. Kafka has an outage. What should the SMTP server do?",
          "a": "Reply with a 4xx temporary failure (e.g. 451). The sending MTA keeps the message and retries with backoff for days, so mail is delayed but not lost — SMTP's store-and-forward is your buffer. Optionally spool to local disk with fsync and reply 250, but then the spool's durability (single disk) is your guarantee, and you need a replay process. Never reply 5xx, which bounces the mail permanently. Alert on 4xx rate since senders' retry queues hide the outage from users."
        }
      ],
    },
    {
      id: 'design-storage-mcq-08',
      difficulty: 'medium',
      question:
        'You launch outbound email from a brand-new dedicated IP range and immediately send 5M messages/day. Gmail and Outlook start routing most of them to spam, even though SPF, DKIM and DMARC all pass. What is the most likely cause?',
      options: [
        'DKIM keys shorter than 4096 bits are treated as spam',
        'DMARC policy p=reject makes receivers junk the mail',
        'SPF records only allow 10 DNS lookups, so large senders always fail',
        'The IPs have no sending reputation; volume must be ramped gradually (IP warm-up) while bounce and complaint rates stay low',
      ],
      correct: [3],
      explanation:
        'Authentication proves who you are, but receivers also score reputation, and new IPs have none. Sudden high volume from a fresh IP looks like a spam burst. Warm-up (gradually increasing daily volume) and good list hygiene build reputation. 2048-bit DKIM is standard. p=reject affects failing mail, not passing mail. The SPF 10-lookup limit is real but causes SPF failures, which the question rules out.',
      followUps: [
        {
          "q": "Design the warm-up plan: how fast can you ramp, and what metrics gate each step?",
          "a": "Start with a few thousand messages/day per IP to your most engaged recipients, then roughly double daily over 4–8 weeks toward the 5M target, spread across IPs. Gate each step on mailbox-provider feedback: bounce rate under ~2%, spam complaint rate under ~0.1% (Gmail Postmaster Tools, Outlook SNDS), and inbox placement from seed tests. If a metric trips, hold or step back. Meanwhile route the remaining volume through established IPs or a provider's shared pool so business mail still flows."
        }
      ],
    },
    {
      id: 'design-storage-mcq-09',
      difficulty: 'expert',
      question:
        'Select ALL choices that improve search latency and freshness for a billion-user email product.',
      options: [
        'Route each user\'s documents to one index shard (routing by user_id) so a query touches one shard',
        'Index synchronously inside the SMTP receive path so search is always fresh',
        'Feed indexers from a Kafka topic partitioned by user_id, with a freshness SLO on consumer lag',
        'At query time, union index results with the user\'s last few minutes of emails read from the metadata store',
        'Use a single global index without routing and add replicas until p99 is acceptable',
      ],
      correct: [0, 2, 3],
      explanation:
        'Per-user routing removes scatter-gather. User-partitioned Kafka keeps per-user ordering and lets you monitor and autoscale indexing lag. A query-time union covers the not-yet-indexed window. Synchronous indexing couples mail acceptance to search-cluster health and slows receiving. More replicas do not remove the fan-out to every shard, so tail latency stays high.',
      followUps: [
        {
          "q": "A handful of enterprise users have 20M emails each, so their single routed shard is huge and slow. How do you handle them without losing single-shard routing for everyone else?",
          "a": "Use custom routing with partitioned routing for large users: route by `user_id` plus a sub-key (e.g. year or hash bucket) only for users above a size threshold, so their data spreads over K shards and their queries fan out only to those K. Elasticsearch supports this via `index.routing_partition_size`. Alternatively give very large tenants a dedicated index. Most queries also add a recency filter, so time-based sub-routing lets recent searches hit one shard."
        }
      ],
    },
    {
      id: 'design-storage-mcq-10',
      difficulty: 'expert',
      question:
        'The GFS master loses contact with the primary replica of chunk C (lease granted 20 s ago, 60 s duration). A client needs to write to C now. What does the master do, and why?',
      options: [
        'Immediately grant the lease to another replica, because the old primary is presumed dead',
        'Wait until the old lease expires (about 40 more seconds) before granting a new lease, so two primaries can never order mutations concurrently if the old one is merely partitioned',
        'Ask the client to write to all replicas directly, bypassing the primary',
        'Revoke the lease by incrementing the chunk version and proceed without a primary',
      ],
      correct: [1],
      explanation:
        'Unreachable does not mean dead. The old primary may still be serving clients across a partition. Waiting for the lease to expire guarantees a single primary (a time-based fence; the GFS master can also try to revoke explicitly). Granting early risks two primaries assigning conflicting serial orders. Bypassing the primary breaks mutation ordering. Version numbers detect stale replicas but do not stop a live partitioned primary before its lease ends.',
      followUps: [
        {
          "q": "Waiting out the 60 s lease means writes to chunk C stall for up to a minute. How would you shorten that without risking two primaries?",
          "a": "Use shorter leases (e.g. 10 s) renewed via piggybacked heartbeats, so the worst-case wait shrinks proportionally, at the cost of more heartbeat traffic and more spurious expiries during GC pauses. The holder must stop serving a bit before expiry to account for clock drift (bounded drift, not synchronized clocks). Adding a chunk version bump on new lease grants lets replicas reject mutations from the stale primary even if it ignored its own expiry."
        }
      ],
    },
    {
      id: 'design-storage-mcq-11',
      difficulty: 'hard',
      question:
        'A team stores 2 PB in HDFS as 20 KB JSON files. Using ~150 bytes of NameNode heap per object (file or block), roughly how much live metadata does this need?',
      code: {
        language: 'text',
        code: `files  = 2 PB / 20 KB          (decimal units)
blocks = 1 per file (each < 128 MB)
heap   = (files + blocks) x 150 B`,
      },
      options: [
        '~30 TB, orders of magnitude beyond any single NameNode heap, so the files must be compacted or moved',
        '~30 GB, which is fine for a single NameNode',
        '~300 MB, because many small files are packed into each 128 MB block',
        '~90 TB, because the NameNode keeps a separate object per replica',
      ],
      correct: [0],
      explanation:
        '2x10^15 B / 2x10^4 B = 10^11 files (100 billion), each with one block, giving 2x10^11 objects x 150 B = 3x10^13 B = ~30 TB of heap. The ~30 GB option is off by 1,000x. HDFS does not pack small files into shared blocks; each file gets its own (partially filled) block. Replicas do not create extra namespace objects; a block just carries a short list of replica locations.',
      followUps: [
        {
          "q": "The team compacts the 20 KB files into 256 MB Parquet files. What does the NameNode need now, and what new problem must the ingestion pipeline handle?",
          "a": "2 PB ÷ 256 MB ≈ 7.8M files, each spanning 2 blocks at 128 MB: ~23M objects × 150 B ≈ 3.5 GB of heap — trivially fine. The new problem is latency: producers emit small records continuously, so you need a staging area (Kafka, or a small-file landing zone) and a compaction job that rolls them into large files atomically, plus a table format (Iceberg/Hudi/Delta) so readers see consistent snapshots and never a half-written file."
        }
      ],
    },
    {
      id: 'design-storage-mcq-12',
      difficulty: 'expert',
      question:
        'Hundreds of MapReduce tasks use GFS record append to write to one shared output file. A reader later finds a few duplicate records and some padding regions. What is the correct interpretation?',
      options: [
        'The file is corrupted and should be restored from the previous checkpoint',
        'A bug in lease handling let two primaries write the chunk',
        'Expected: record append is at-least-once, so client retries after partial failures can duplicate records and leave padding. Readers should skip padding using checksums and drop duplicates using unique record ids',
        'The appends exceeded the 64 MB chunk size, which GFS does not support',
      ],
      correct: [2],
      explanation:
        'GFS guarantees that each successful record append is written atomically at least once at an offset the primary chooses. Retries after a failure on some replicas can leave duplicates and inconsistent or padded regions, and applications are expected to use self-validating, self-identifying records. It is not corruption, and restoring would lose data. Lease bugs are not needed to explain this. When an append would cross a chunk boundary, GFS pads the chunk and retries in the next chunk, which is where some padding comes from.',
      followUps: [
        {
          "q": "The downstream job must produce exact counts from this output file. How do readers make at-least-once appends exactly-once in effect?",
          "a": "Each writer embeds a unique record ID (e.g. task ID + attempt + sequence number) and a checksum in every record. Readers validate checksums to skip padding and fragments, and dedupe by record ID — in a MapReduce follow-up job this is a group-by on record ID. If dedup state is too large, partition by record ID hash so each reducer dedupes a slice. Writers should use the task ID, not the attempt ID, for the record key so a retried task's output collides with the original attempt's."
        }
      ],
    },
    {
      id: 'design-storage-mcq-13',
      difficulty: 'hard',
      question:
        'HDFS places 3 replicas as: writer\'s node (rack A), then two nodes on one remote rack (rack B). Select ALL statements that are true.',
      options: [
        'The block survives the loss of an entire rack',
        'Write traffic crosses the inter-rack link only once per block',
        'Placing all 3 replicas on 3 different racks would give better write throughput',
        'Read bandwidth for the block can come from two racks',
        'The layout survives simultaneous failure of rack B and the writer\'s node in rack A',
      ],
      correct: [0, 1, 3],
      explanation:
        'Losing rack A leaves two replicas on B, and losing rack B leaves one on A. The pipeline crosses racks once (A→B), then stays inside B. Replicas sit on two racks, so reads can be served from either. If rack B and the writer\'s node both fail, all three replicas are gone, which is the price of putting two replicas in one rack. Three racks would increase cross-rack write traffic (two crossings) and lower write throughput, trading it for slightly better rack-failure tolerance.',
      followUps: [
        {
          "q": "An entire rack of 40 DataNodes, each 48 TB, loses power permanently. How long until all blocks are back to 3 replicas, and what does the NameNode prioritise?",
          "a": "About 40 × 48 TB = 1.92 PB of replica data must be recreated. With the remaining ~1,960 nodes contributing ~50 MB/s each (~98 GB/s), that's roughly 5.4 hours. The NameNode prioritises by risk: blocks down to a single replica (those that had 2 replicas on the failed rack) are queued first, then blocks at 2 replicas. Re-replication is throttled so it doesn't starve production jobs; in practice operators raise the limit temporarily during a rack loss."
        }
      ],
    },
    {
      id: 'design-storage-mcq-14',
      difficulty: 'expert',
      question:
        'During an HDFS NameNode HA failover, the old active NameNode is not dead but stalled in a long GC pause. What prevents it from corrupting the namespace when it wakes up?',
      options: [
        'DataNodes only accept commands from the NameNode with the lowest IP address',
        'HDFS clients detect the stale NameNode by its clock skew',
        'Nothing; operators must manually shut down the old active before failover',
        'The Quorum Journal Manager fences it: JournalNodes accept edits only from the writer with the highest epoch, so the old active\'s writes are rejected, and ZKFC fencing can additionally kill it',
      ],
      correct: [3],
      explanation:
        'On failover the new active obtains a higher epoch number from a majority of JournalNodes, which then reject edits from any lower-epoch writer. This is storage-level fencing that prevents split-brain edits. ZKFC can additionally fence via SSH or a shell script. DataNodes accept commands from both NameNodes but follow the active based on HA state and transaction ids, not IP address. Clients do not detect staleness by clock skew. Automatic failover with QJM is designed to avoid a manual step.',
      followUps: [
        {
          "q": "Fencing protects the edit log, but could the stalled old active still serve stale reads to clients? How does HDFS handle that?",
          "a": "Yes, an old active that wakes up could answer reads from its in-memory namespace before realising it was demoted. That's why ZKFC fencing kills or isolates it (sshfence or a shell fence) and why clients follow the failover proxy provider to the new active. The old active also discovers its demotion on its next attempt to write to the JournalNodes, which reject it, and it then shuts down. Reads served in that window can be stale but no namespace corruption occurs."
        }
      ],
    },
    {
      id: 'design-storage-mcq-15',
      difficulty: 'medium',
      question:
        'You switch a cold-data HDFS directory from 3× replication to Reed-Solomon RS(6,3) erasure coding. Which statement is correct?',
      options: [
        'Storage overhead drops to 1.33×, and it tolerates only 1 failure',
        'Storage overhead drops from 3× to 1.5×, and it tolerates the loss of any 3 of the 9 cells in a block group; reconstruction costs more network and CPU, so it suits cold data',
        'Reads get faster, because data is striped across 9 nodes and never needs decoding',
        'Small files benefit the most, because EC packs them into shared stripes',
      ],
      correct: [1],
      explanation:
        'RS(6,3) stores 9 cells for 6 data cells (1.5×) and survives any 3 losses, versus 3× replication, which survives 2. Repairing a lost cell requires reading 6 others, which is network-heavy, and decoding costs CPU, so hot data often stays replicated. 1.33× corresponds to schemes like RS(9,3) or RS(12,4). Degraded reads require decoding. Small files are the worst case for EC, because a small file still allocates a partial block group with parity.',
      followUps: [
        {
          "q": "A node holding cells for 1M EC block groups dies. Why is repair much more expensive than with replication, and how do you limit the impact?",
          "a": "With 3× replication, a lost block is repaired by copying one surviving replica (read 1× the block). With RS(6,3), each lost cell needs 6 surviving cells read across the network and decoded: about 6× the network traffic per byte repaired, plus CPU. Limit impact by throttling reconstruction bandwidth, prioritising block groups that have lost the most cells, spreading cells across racks so failures are independent, and using hardware-accelerated codecs (ISA-L). Keep recently written, hot data replicated and EC-convert it once it cools."
        }
      ],
    },
  ],
};

export default topic;
