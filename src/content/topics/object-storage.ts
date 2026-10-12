import type { Topic } from '../../types';

const topic: Topic = {
  id: 'object-storage',
  phase: 'platform',
  order: 5,
  title: 'Object & File Storage',
  subtitle:
    'Block vs file vs object, S3 internals (data/metadata split, placement, erasure coding, checksums), multipart & presigned uploads, resumable uploads, dedup, lifecycle tiers, CDN delivery and video streaming.',
  estimatedMinutes: 120,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 9 S3-like Object Storage',
    'AWS S3 User Guide — multipart upload limits, lifecycle, presigned URLs',
    'tus.io — Resumable Upload Protocol 1.0',
    'Apple HLS Authoring Specification / MPEG-DASH (ISO/IEC 23009-1)',
  ],
  tags: [
    'object-storage',
    's3',
    'erasure-coding',
    'multipart-upload',
    'presigned-url',
    'tus',
    'cdn',
    'hls',
    'lifecycle',
    'durability',
  ],
  cheatSheet: [
    'Block = raw volumes (EBS, sub-ms, one host); File = POSIX hierarchy over network (NFS/EFS); Object = flat key → immutable blob + metadata over HTTP, near-infinite scale, cheapest per GB.',
    'S3 design = stateless API service + IAM + metadata store (name → object_id, sharded by hash(bucket, key)) + data store (routing service, Raft-backed placement service, data nodes).',
    'Data nodes pack small objects into multi-GB append-only files + per-node object_mapping (object_id → file, offset, size); avoids 4 KB block waste and inode exhaustion.',
    '3× replication ≈ 6 nines, 200% overhead, fast reads/repairs; 8+4 erasure coding ≈ 11 nines, 50% overhead, every read touches ≥8 nodes, CPU for parity. Hot/small → replicate, cold/large → EC.',
    'Checksum every object and every sealed file (MD5/CRC32C/SHA-256); verify on read and across every process boundary; background scrubbers catch bit rot before the last good copy is gone.',
    'Multipart: 5 MiB–5 GiB parts (last may be smaller), ≤10,000 parts, objects up to 50 TB (raised from 5 TB in Dec 2025); single PUT max 5 GB. Always add a lifecycle rule to abort incomplete uploads.',
    'Presigned URL = client uploads/downloads directly to the bucket; bytes never touch your pods. Use short expiry (5–15 min), server-chosen keys, POST-policy conditions (content-length-range, content-type).',
    'Resumable uploads: multipart + ListParts or tus (POST create → HEAD Upload-Offset → PATCH from offset). A failure at 90% resumes at 90%, not 0%.',
    'Cost levers: lifecycle to IA (30-day min, 128 KB min billable) / Glacier IR / Deep Archive, expire noncurrent versions, abort stale MPUs, dedup by content hash, CDN to cut egress.',
    'Video: upload original → queue → transcode to an ABR ladder (e.g. 1080p/720p/480p/360p) with aligned keyframes → 2–6 s HLS/DASH (CMAF) segments → CDN; manifests short TTL, segments immutable.',
  ],
  sections: [
    {
      heading: '1. Block vs File vs Object storage — pick the right abstraction',
      body: `**Intuition:** block storage is a raw hard disk you plug into one machine, file storage is a shared network drive with folders, and object storage is a giant valet parking lot: hand over a blob, get a ticket (the key), come back with the ticket later. You cannot edit a parked car in place — you replace it.

**Mechanics**

- **Block** (EBS, SAN, local NVMe): fixed-size blocks addressed by LBA; the OS puts a filesystem or a database on top. Lowest latency (NVMe ~100 µs, EBS gp3 ~sub-ms to 1 ms), attached to one host at a time (mostly). Great for databases and VMs.
- **File** (NFS, SMB, EFS, CephFS): POSIX semantics — directories, rename, byte-range writes, locks. Shared by many hosts. Metadata operations (ls, rename of a big directory) become the bottleneck at billions of files.
- **Object** (S3, GCS, Azure Blob, MinIO, Ceph RGW): flat namespace of *bucket + key* → immutable object + metadata, accessed over HTTP (PUT/GET/DELETE/LIST). No in-place update, no real rename (copy + delete). Scales to trillions of objects, 11 nines durability, cheapest per GB.

| | Block | File | Object |
|---|---|---|---|
| Unit | block (4 KB–1 MB) | file in a directory tree | whole object (0 B – 50 TB on S3) |
| Mutability | in-place writes | in-place writes, append | immutable; overwrite = new version |
| Access | kernel / iSCSI / NVMe-oF | NFS/SMB, POSIX | HTTP REST API |
| Latency | ~0.1–1 ms | ~1–10 ms | ~10–100 ms first byte |
| Scale | TBs per volume | PBs, billions of files strain metadata | EBs, trillions of objects |
| Cost (AWS-ish) | ~$0.08/GB-mo (gp3) | ~$0.30/GB-mo (EFS std) | ~$0.023/GB-mo (S3 Std) |
| Use for | DB data dirs, VM disks | shared config, legacy apps, ML scratch | media, backups, data lakes, logs, static assets |

**Trade-off in one line:** object storage trades POSIX semantics and latency for virtually unlimited scale, durability and price. That is why every modern design — images, video, backups, data lake — lands bytes in object storage and keeps only *pointers* in the database.

**Interview line:** "The DB stores the metadata and the object key; the bytes live in S3 and are served via a CDN. The app servers never proxy large payloads."`,
      keyPoints: [
        'Never store large blobs in Postgres rows — store the key, size, checksum and content type.',
        'Object storage has no rename: a "folder move" is N copies + N deletes. Design keys you never need to rename.',
        'File storage metadata servers are the scaling wall for billions of small files.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 9',
    },
    {
      heading: '2. S3 high-level architecture — separate metadata from data',
      body: `**Intuition:** a library has a card catalogue (small, frequently queried, needs indexes) and the stacks (huge, rarely reorganised). Object storage splits them the same way because they have opposite requirements.

**Components (Alex Xu Ch 9)**

1. **Load balancer + API service** — stateless; handles auth, request routing, orchestrates metadata and data calls. Scales horizontally.
2. **IAM / identity service** — authenticates the request signature (SigV4) and authorises the bucket/object action.
3. **Metadata store** — maps *(bucket, object_name, version)* → *object_id* plus size, ETag, content type, ACLs. Small per object (~1 KB) but billions of rows; needs strong consistency and indexes.
4. **Data store** — stores immutable bytes addressed only by *object_id* (a UUID). It knows nothing about names or buckets.

**Upload flow:** client PUT → API verifies WRITE permission → data store persists bytes and returns a UUID → API writes the metadata row (bucket, name, object_id). **Download:** API checks READ → metadata lookup name → UUID → fetch bytes from data store by UUID.

**Why the split matters**

- Data is *write once, read many*, huge and sequential — optimise for throughput and cost (HDDs, erasure coding).
- Metadata is small, random-access, and needs transactional updates (versioning, listing) — optimise for IOPS (SSD, sharded DB).
- Ordering: write data first, then metadata. A crash between the two leaves *orphan data* (garbage-collected later) — never a metadata row pointing to missing bytes.

Since December 2020 AWS S3 provides **strong read-after-write consistency** for PUTs, overwrites, deletes and LIST — the metadata layer is the part that makes that possible.`,
      diagram: `            HTTP PUT/GET
 client ───────────────▶ [ Load balancer ]
                                │
                         [ API service ] ──auth──▶ [ IAM ]
                           │         │
          name→object_id   │         │  bytes by object_id (UUID)
                           ▼         ▼
                 [ Metadata svc ]  [ Data routing svc ] ◀─▶ [ Placement svc ]
                 [ sharded DB   ]        │                  (Raft, 5-7 nodes)
                                         ▼                        ▲ heartbeats
                          [ Data node P ]──replicate──▶[ Node S1 ][ Node S2 ]`,
      keyPoints: [
        'Write bytes first, then metadata — crash leaves orphans (GC-able), never dangling pointers.',
        'Data store is addressed by UUID only; names, buckets and versions live in metadata.',
        'Both halves scale independently: add data nodes for capacity, add metadata shards for object count/QPS.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 9 (Figures 9.4–9.6)',
    },
    {
      heading: '3. Data store internals — routing, placement and data nodes',
      body: `**Intuition:** the placement service is air-traffic control: it knows every runway (disk) and decides where each plane (object) lands so no two copies share a failure domain.

**Data routing service** — stateless gRPC/REST tier. Asks the placement service which replication group should store a new object, streams bytes to the primary data node, and reads bytes back.

**Placement service** — keeps the **virtual cluster map** (datacenter → host → partition topology) so replicas are placed in different racks/AZs. Data nodes send heartbeats (disk count, bytes used); a node silent for a configurable grace period (the book uses 15 s) is marked down and its data re-replicated. It is critical, so run it as a 5- or 7-node Paxos/Raft cluster (7 nodes tolerate 3 failures). Object → replication group mapping must be deterministic and survive group changes — consistent hashing is the classic choice.

**Data node write path:** primary saves locally, replicates to two secondaries, then acks. Ack policy is a consistency/latency dial:

| Ack after | Consistency | Latency |
|---|---|---|
| all 3 replicas persist | strongest | highest (slowest replica) |
| primary + 1 secondary | medium | medium |
| primary only | weakest (acked write can be lost) | lowest |

**How bytes are laid out on disk** — storing each object as its own file fails at scale: a 1 KB object still consumes a 4 KB block, and billions of files exhaust inodes and thrash the dentry/inode cache. Instead, append many objects into a **read-write file** (like a WAL); when it hits a few GB it is **sealed read-only** and a new one opens. Appends to one file are serialised, so give each core its own read-write file.

To find an object, each node keeps a local **object_mapping** table (object_id → file_name, start_offset, object_size). The book picks **SQLite per node** over RocksDB because the pattern is write-once/read-many and B-tree reads beat LSM reads; the mapping is node-local so there is no need for a shared cluster. (Facebook Haystack uses the same "needle in a big volume file" idea for photos.)`,
      code: [
        {
          language: 'sql',
          title: 'Per-data-node object_mapping (SQLite) — lookup is one indexed read',
          code: `-- One SQLite DB per data node; never shared across nodes.
CREATE TABLE object_mapping (
  object_id    BLOB    PRIMARY KEY,   -- 16-byte UUID from the routing service
  file_name    TEXT    NOT NULL,      -- e.g. '/data/c' (the big append-only file)
  start_offset INTEGER NOT NULL,      -- byte offset inside file_name
  object_size  INTEGER NOT NULL,      -- bytes, excluding trailing checksum
  deleted      INTEGER NOT NULL DEFAULT 0  -- lazy delete; compaction reclaims space
) WITHOUT ROWID;                      -- clustered on object_id

-- Write path (inside one transaction with the append + fsync):
INSERT INTO object_mapping (object_id, file_name, start_offset, object_size)
VALUES (?, '/data/c', ?, ?);

-- Read path: one B-tree probe, then a single pread(file, size, offset).
SELECT file_name, start_offset, object_size
FROM object_mapping
WHERE object_id = ? AND deleted = 0;

-- Compaction (GC) moves live objects from sealed files into a new file,
-- then repoints them atomically.
BEGIN;
UPDATE object_mapping SET file_name = '/data/d', start_offset = ?
WHERE object_id = ?;
COMMIT;`,
        },
      ],
      keyPoints: [
        'Placement service = cluster map + heartbeats + Raft; it decides failure-domain-aware placement.',
        'Pack small objects into multi-GB append-only files; seal to read-only; one RW file per core.',
        'Acking on primary only is fast but can lose acknowledged writes — object stores normally wait for a quorum/all.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 9 (Data store, Figures 9.8–9.13)',
    },
    {
      heading: '4. Durability — replication vs erasure coding, failure domains, checksums',
      body: `**Intuition:** replication is keeping three photocopies of a document in three buildings. Erasure coding is tearing it into 8 strips, computing 4 "parity" strips, and scattering all 12 — any 8 of them rebuild the original.

**Replication math (book's rough estimate):** HDD annual failure rate ≈ 0.81%. Three independent copies: 1 − 0.0081³ ≈ 1 − 5.3×10⁻⁷ ≈ **0.999999 (6 nines)**. Real models factor in *repair time*: you only lose data if the other copies die *before re-replication finishes*, which is why fast repair (hours, not days) matters as much as copy count.

**Erasure coding (8+4):** split into 8 data chunks + 4 parity chunks (Reed–Solomon), all the same size, across 12 failure domains; survives any 4 losses. Backblaze-style modelling gives **~11 nines** at only **1.5× raw storage** (50% overhead) vs 3× (200% overhead) for replication.

| | 3× replication | 8+4 erasure coding |
|---|---|---|
| Durability | ~6 nines | ~11 nines |
| Storage overhead | 200% | 50% |
| Compute | none | parity encode on write, decode on degraded read |
| Write | parallel copies, simple | encode then write 12 chunks |
| Normal read | 1 node | ≥8 nodes (tail latency = slowest of 8) |
| Degraded read / repair | read any copy | reconstruct from 8 chunks (repair traffic ~8× chunk size) |
| Best for | hot, small, latency-sensitive | cold/warm, large, cost-dominated |

Real systems mix both: new/hot data replicated, then **background-converted to EC** once it cools (HDFS, Ceph, Azure LRC, S3 internally).

**Failure domains:** node < rack (shared ToR switch/power) < AZ (independent power/network). Spreading copies across AZs does not change the per-disk math but protects against correlated failures (power outage, fire, cooling).

**Correctness (silent corruption):** disks fail loudly, but memory bit-flips and firmware bugs corrupt silently. Compute a checksum per object (the book uses MD5; CRC32C/SHA-256 are common) and append it after the object; add a whole-file checksum when a file is sealed. On read: verify; if mismatch, fetch from another failure domain (or another chunk set for EC) and repair the bad copy. Verify at **every process boundary** (client → API → data node) and run background scrubbers.`,
      code: [
        {
          language: 'typescript',
          title: 'Checksum-verified read with fallback to another replica',
          code: `import { createHash } from 'node:crypto';

interface ReplicaClient {
  node: string;
  // returns raw bytes + the checksum stored next to the object on disk
  read(objectId: string): Promise<{ data: Buffer; storedMd5: string }>;
}

export async function readVerified(
  objectId: string,
  replicas: ReplicaClient[],          // ordered: nearest / healthiest first
  reportCorruption: (node: string, id: string) => void,
): Promise<Buffer> {
  for (const replica of replicas) {
    try {
      const { data, storedMd5 } = await replica.read(objectId);
      const actual = createHash('md5').update(data).digest('hex');
      if (actual === storedMd5) return data;         // error-free copy
      reportCorruption(replica.node, objectId);      // schedule repair from a good copy
    } catch {
      // node down or timed out: try next failure domain
    }
  }
  throw new Error('all replicas unavailable or corrupt for ' + objectId);
}`,
        },
      ],
      keyPoints: [
        '6 nines (3×, 200% overhead) vs ~11 nines (8+4 EC, 50% overhead).',
        'EC reads fan out to ≥8 nodes — tail latency and repair bandwidth are the hidden costs.',
        'Durability = f(copy count, failure-domain independence, repair speed, corruption detection).',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 9 (Durability, Erasure coding, Correctness verification)',
    },
    {
      heading: '5. Metadata DB design — schema, sharding, listing, versioning',
      body: `**Intuition:** metadata is a phone book with billions of entries that must answer three questions fast: "what is the object ID for this name?", "insert/delete this name", and "list everything starting with this prefix".

**Schema (two tables):** \`bucket(bucket_name, bucket_id, owner_id, enable_versioning)\` and \`object(bucket_name, object_name, object_version, object_id, ...)\`.

- **bucket table** is tiny: 1M customers × 10 buckets × 1 KB ≈ 10 GB — one primary plus read replicas.
- **object table** needs sharding. Options:
  - *by bucket_id* — a bucket can hold billions of objects → **hot shard**. Rejected.
  - *by object_id* — even, but lookups arrive by name (URI), so point queries become scatter-gather. Rejected.
  - *by hash(bucket_name, object_name)* — even and matches the URI-based access path. **Chosen.**

**Listing is the hard part.** Buckets are flat; "folders" are just **prefixes** + a **delimiter** ('/'), and the service rolls up keys into *CommonPrefixes*. With hash sharding, a prefix scan hits every shard, and paginating means tracking an offset per shard inside the cursor (hundreds of shards → hundreds of offsets). The book's pragmatic answer: **denormalise a listing table sharded by bucket_id** — listing is rarely latency-critical, and isolating it to one shard keeps the implementation simple. Prefer **keyset pagination** (WHERE object_name > last_key) over OFFSET, which gets slower page by page.

**Versioning:** with versioning on, a PUT *inserts* a new row with the same (bucket, name) and a new \`object_version\` (a TIMEUUID) instead of overwriting; the current version is the largest TIMEUUID. A DELETE without a version id inserts a **delete marker**, which becomes current; GET then returns 404 but all old versions (and their storage cost) remain until a lifecycle rule expires noncurrent versions.

**In production:** real systems keep metadata in a strongly consistent, range-partitioned KV/DB (S3 uses its own; others use FoundationDB, TiKV, CockroachDB, Cassandra with LWT) — range partitioning makes prefix listing efficient, with hot ranges split automatically. This is also why S3 publishes per-prefix limits (~3,500 writes/s and ~5,500 reads/s per partitioned prefix) and auto-splits hot prefixes.`,
      code: [
        {
          language: 'sql',
          title: 'Object metadata with versioning + keyset-paginated prefix listing',
          code: `CREATE TABLE object_meta (
  bucket_id      BIGINT      NOT NULL,
  object_name    TEXT        NOT NULL,          -- full key, e.g. 'CA/cities/la.txt'
  object_version UUID        NOT NULL,          -- time-ordered (TIMEUUID / UUIDv7)
  object_id      UUID,                          -- NULL => delete marker
  size_bytes     BIGINT      NOT NULL DEFAULT 0,
  etag           TEXT,
  content_type   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_id, object_name, object_version)
);
-- Shard key for point ops: hash(bucket_id, object_name).

-- GET current version (newest row; a delete marker means 404)
SELECT object_id, size_bytes, etag
FROM object_meta
WHERE bucket_id = $1 AND object_name = $2
ORDER BY object_version DESC
LIMIT 1;

-- LIST prefix 'CA/' page by page (listing table sharded by bucket_id).
-- Keyset pagination: the cursor is the last key returned, not an OFFSET.
SELECT DISTINCT ON (object_name) object_name, object_id, size_bytes
FROM object_meta
WHERE bucket_id = $1
  AND object_name LIKE 'CA/%'          -- needs text_pattern_ops / C collation index
  AND object_name > $2                 -- $2 = cursor ('' for first page)
ORDER BY object_name, object_version DESC
LIMIT 1000;                            -- caller drops rows whose object_id IS NULL`,
        },
      ],
      keyPoints: [
        'Shard object metadata by hash(bucket, key); never by bucket alone (hot shard).',
        'Listing = prefix + delimiter roll-up; use a bucket-sharded listing index and keyset cursors.',
        'Versioned DELETE = delete marker; storage is only freed by NoncurrentVersionExpiration.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 9 (Metadata data model, Listing, Versioning)',
    },
    {
      heading: '6. Multipart upload — how big files actually get in',
      body: `**Intuition:** don't carry a piano up the stairs in one go; take it apart, carry the pieces in parallel, and reassemble upstairs. If one piece drops, you only carry that piece again.

**Protocol (S3 / book Fig 9.25)**

1. **CreateMultipartUpload** → returns an \`UploadId\`.
2. **UploadPart**(UploadId, PartNumber 1..10,000, bytes) → returns an **ETag** (MD5 of the part for non-KMS encryption). Parts can be uploaded **in parallel, in any order, and retried individually**.
3. **CompleteMultipartUpload**(UploadId, [{PartNumber, ETag}] in ascending order) → the store stitches the parts into one object. Until this call the object is invisible.
4. **AbortMultipartUpload** frees parts. Parts of an incomplete upload are **billed and invisible to ListObjects** until aborted — always add a lifecycle \`AbortIncompleteMultipartUpload\` rule (e.g. 7 days).

**S3 limits worth memorising:** part size 5 MiB–5 GiB (last part may be smaller), max 10,000 parts, single PUT ≤ 5 GB, max object **50 TB** (raised from 5 TB in December 2025). The final ETag of a multipart object is **not** the MD5 of the whole file — it is MD5(concat(part MD5s)) + "-N" — so verify integrity with per-part checksums or the newer additional checksums (CRC32C, CRC64NVME, SHA-256).

**Choosing part size:** for a 10 GiB file, 64 MiB parts → 160 parts; with 8 parallel streams on a 200 Mbps uplink the upload takes ~7 minutes and a failed part costs ~2.7 s to redo. Too small (5 MiB) → per-request overhead and the 10,000-part cap (5 MiB × 10,000 ≈ 48.8 GiB max); too big → expensive retries on flaky networks. Mobile: 5–16 MiB; datacenter: 64–128 MiB.

**Where the bytes flow:** the backend creates the upload and **presigns each UploadPart URL**; the browser/mobile client PUTs parts straight to S3 and returns the ETags; the backend calls Complete. Your NestJS pods handle a few KB of JSON instead of 10 GB of bytes.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS service: create upload, presign part URLs, complete (AWS SDK v3)',
          code: `import { Injectable } from '@nestjs/common';
import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, ListPartsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const BUCKET = process.env.UPLOAD_BUCKET!;
const PART_SIZE = 64 * 1024 * 1024;            // 64 MiB: 10 GiB -> 160 parts

@Injectable()
export class MultipartService {
  private readonly s3 = new S3Client({});

  async start(userId: string, sizeBytes: number, contentType: string) {
    const key = 'uploads/' + userId + '/' + randomUUID();   // server-chosen key
    const { UploadId } = await this.s3.send(new CreateMultipartUploadCommand({
      Bucket: BUCKET, Key: key, ContentType: contentType, ChecksumAlgorithm: 'CRC32C',
    }));
    const partCount = Math.ceil(sizeBytes / PART_SIZE);
    if (partCount > 10_000) throw new Error('file too large for part size');
    const urls = await Promise.all(
      Array.from({ length: partCount }, (_, i) =>
        getSignedUrl(this.s3, new UploadPartCommand({
          Bucket: BUCKET, Key: key, UploadId, PartNumber: i + 1,
        }), { expiresIn: 3600 })),              // 1 h per part URL
    );
    return { key, uploadId: UploadId, partSize: PART_SIZE, urls };
  }

  // Trust S3's view of the parts, not the client's list of ETags.
  async complete(key: string, uploadId: string) {
    const { Parts = [] } = await this.s3.send(new ListPartsCommand({
      Bucket: BUCKET, Key: key, UploadId: uploadId,   // paginate if > 1,000 parts
    }));
    return this.s3.send(new CompleteMultipartUploadCommand({
      Bucket: BUCKET, Key: key, UploadId: uploadId,
      MultipartUpload: {
        Parts: Parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag, ChecksumCRC32C: p.ChecksumCRC32C })),
      },
    }));
  }
}`,
        },
      ],
      keyPoints: [
        '5 MiB–5 GiB parts, ≤10,000 parts, 50 TB max object, 5 GB max single PUT.',
        'Incomplete MPUs are billed and invisible — lifecycle AbortIncompleteMultipartUpload is mandatory.',
        'Multipart ETag ≠ MD5 of file; use part checksums or additional checksum algorithms.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 9 (Optimizing uploads of large files); AWS S3 multipart limits',
    },
    {
      heading: '7. Presigned URLs — let clients talk to the bucket directly',
      body: `**Intuition:** a presigned URL is a valet ticket you print for a guest: it lets exactly one action on exactly one key until a deadline, signed with your credentials, without giving the guest your keys.

**Mechanics:** the backend computes a SigV4 signature over (method, bucket, key, expiry, selected headers) using its credentials and returns a URL. Anyone holding the URL can perform that one operation until it expires. S3 validates the signature — your service is out of the data path.

- **Presigned PUT** — simple, but you cannot enforce a max size (the signature can pin Content-Type/Content-Length headers only if you sign them).
- **Presigned POST (POST policy)** — a signed policy document with **conditions**: \`content-length-range\`, \`starts-with $Content-Type image/\`, exact key or key prefix. Best for browser uploads of user content.
- **Presigned GET** — time-limited downloads of private objects. For many files behind a CDN prefer **CloudFront signed cookies/URLs** so the CDN can cache (see §10).

**Gotchas senior engineers know**

- Validity = **min(expiresIn, credential lifetime)**. SigV4 max is 7 days, but a URL signed by a pod's IRSA/STS role dies when that session token expires (often 1 h).
- Anyone with the URL can use it — keep expiry short (5–15 min for upload, minutes for downloads), never log full URLs.
- Always generate the **key on the server** (tenant prefix + UUID). Never trust a client filename as a key (overwrite and path confusion).
- The upload is not "done" when you return the URL: confirm via an **S3 event notification** (ObjectCreated → SQS/EventBridge) that then validates (magic bytes, virus scan), writes the DB row, and triggers thumbnails.
- CORS on the bucket must allow the browser origin and expose the ETag header for multipart.`,
      code: [
        {
          language: 'typescript',
          title: 'Presigned POST with size/type conditions + presigned GET',
          code: `import { Controller, Post, Get, Param, Body, Req } from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const s3 = new S3Client({});
const BUCKET = process.env.MEDIA_BUCKET!;

@Controller('media')
export class MediaController {
  @Post('upload-url')
  async uploadUrl(@Req() req: any, @Body() body: { contentType: string }) {
    if (!/^image\\/(jpeg|png|webp)$/.test(body.contentType)) throw new Error('unsupported type');
    const key = 'raw/' + req.user.tenantId + '/' + randomUUID();   // never a client filename
    const { url, fields } = await createPresignedPost(s3, {
      Bucket: BUCKET,
      Key: key,
      Conditions: [
        ['content-length-range', 1, 10 * 1024 * 1024],   // 1 B .. 10 MiB enforced by S3
        ['eq', '$Content-Type', body.contentType],
      ],
      Fields: { 'Content-Type': body.contentType },
      Expires: 300,                                       // 5 minutes
    });
    // DB row is created later by the ObjectCreated event consumer, after validation.
    return { url, fields, key };
  }

  @Get(':id/download-url')
  async downloadUrl(@Req() req: any, @Param('id') id: string) {
    const key = await this.authorizeAndResolveKey(req.user, id);   // ownership check first
    return { url: await getSignedUrl(s3, new GetObjectCommand({
      Bucket: BUCKET, Key: key,
      ResponseContentDisposition: 'attachment',          // don't render untrusted content inline
    }), { expiresIn: 120 }) };
  }

  private async authorizeAndResolveKey(user: any, id: string): Promise<string> {
    // look up media row, verify user.tenantId owns it, return its object key
    throw new Error('implement lookup for ' + user.id + ' / ' + id);
  }
}`,
        },
      ],
      keyPoints: [
        'Presigned POST can enforce content-length-range and content-type; presigned PUT cannot bound size by itself.',
        'Effective expiry = min(expiresIn, signer credential expiry).',
        'Finalize uploads asynchronously from S3 events, not from the client saying "done".',
      ],
      source: 'AWS S3 User Guide — presigned URLs and POST policy',
    },
    {
      heading: '8. Resumable & chunked uploads (tus) and content-addressed dedup',
      body: `**Intuition:** a resumable upload is a bookmark. When the train enters a tunnel at 90%, you reopen the book at the bookmark instead of page one.

**Why a single PUT fails at scale:** a 10 GB PUT over a 20 Mbps mobile uplink takes ~67 minutes; any network switch (Wi-Fi → LTE), app backgrounding or proxy idle timeout kills it and you restart from zero. Retrying with backoff does not help — the retry also has to survive 67 minutes.

**Two production patterns**

1. **Multipart + resume state** — the client persists \`{key, uploadId, partSize}\` locally (IndexedDB / SQLite). After a crash it calls **ListParts**, skips parts already stored, uploads the rest, then completes.
2. **tus protocol** (open standard, used by Vimeo, Cloudflare Stream, Supabase): \`POST\` creates an upload with \`Upload-Length\` and returns a \`Location\`; \`HEAD\` returns the server's \`Upload-Offset\`; \`PATCH\` sends bytes from that offset with \`Content-Type: application/offset+octet-stream\`. Every request carries \`Tus-Resumable: 1.0.0\`. Extensions add checksums, expiration, and concatenation (parallel partial uploads). A tus server (tusd, @tus/server for Node) usually writes to S3 via multipart under the hood.

**Content-addressed storage & dedup**

Name the blob by the hash of its content: key = sha256(bytes). Identical files → identical key → store once, reference count in metadata. Git, Docker registries (layer digests), Dropbox and backup systems do this.

- **Whole-file hashing** dedups exact copies (re-uploads of the same video/installer).
- **Fixed-size chunking** (e.g. 4 MiB blocks, Dropbox-style) dedups at block level and makes resume natural — upload only blocks the server lacks.
- **Content-defined chunking** (Rabin / FastCDC rolling hash) keeps chunk boundaries stable when bytes are inserted in the middle — best dedup ratio for backups.

**Security caveats:** client-side dedup ("I have hash X, skip upload?") is an **existence oracle** and, worse, lets someone who only knows a hash claim the file. Only dedup server-side after receiving bytes, or scope dedup per tenant; use SHA-256 (not MD5, which has practical collisions). Deletion needs **reference counting** + GC, never an immediate blob delete.`,
      code: [
        {
          language: 'bash',
          title: 'tus 1.0 resume flow with curl',
          code: `# 1) Create an upload of 10 GiB; server replies 201 + Location
curl -i -X POST https://upload.example.com/files \\
  -H 'Tus-Resumable: 1.0.0' \\
  -H 'Upload-Length: 10737418240' \\
  -H 'Upload-Metadata: filename dmFjYXRpb24ubXA0'   # base64("vacation.mp4")
# -> Location: https://upload.example.com/files/7f3c2a

# 2) After the connection dies, ask where the server got to
curl -I https://upload.example.com/files/7f3c2a -H 'Tus-Resumable: 1.0.0'
# -> Upload-Offset: 9663676416   (90% already persisted)

# 3) Resume from that exact offset (send only the remaining bytes)
tail -c +9663676417 vacation.mp4 | curl -X PATCH \\
  https://upload.example.com/files/7f3c2a \\
  -H 'Tus-Resumable: 1.0.0' \\
  -H 'Upload-Offset: 9663676416' \\
  -H 'Content-Type: application/offset+octet-stream' \\
  --data-binary @-
# -> 204 No Content, Upload-Offset: 10737418240 (complete)`,
        },
        {
          language: 'typescript',
          title: 'Fixed-size chunk hashing: upload only blocks the server does not have',
          code: `import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const CHUNK = 4 * 1024 * 1024; // 4 MiB blocks (Dropbox-style)

export async function chunkDigests(path: string): Promise<string[]> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const digests: string[] = [];
    const buf = Buffer.alloc(CHUNK);
    for (let offset = 0; offset < size; offset += CHUNK) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, offset);
      digests.push(createHash('sha256').update(buf.subarray(0, bytesRead)).digest('hex'));
    }
    return digests; // file manifest = ordered list of chunk hashes
  } finally {
    await fh.close();
  }
}

// Server: POST /manifests { digests } -> returns digests it is missing
// (scoped per tenant to avoid a cross-tenant existence oracle).
// Client uploads only those chunks; server verifies sha256 on receipt.`,
        },
      ],
      keyPoints: [
        'Resume = persist upload state client-side + ask the server for its offset/parts.',
        'tus: POST create, HEAD offset, PATCH from offset; Tus-Resumable header on every request.',
        'Content addressing gives dedup + integrity for free; dedup server-side or per tenant; refcount deletes.',
      ],
      source: 'tus.io Resumable Upload Protocol 1.0; Alex Xu Vol 2 Ch 9',
    },
    {
      heading: '9. Lifecycle policies, storage tiers and garbage collection',
      body: `**Intuition:** storage is a warehouse with a front shelf (expensive, instant), a back room (cheaper, slower) and an off-site vault (cheapest, hours to retrieve). Lifecycle rules are the robot that moves boxes back as they gather dust — and throws out what you no longer need.

**AWS S3 tiers (us-east-1 list prices, approximate):**

| Class | $/GB-month | Retrieval | Min duration / size | Use |
|---|---|---|---|---|
| Standard | ~0.023 | ms, free | — | hot data |
| Intelligent-Tiering | ~0.023 → auto lower | ms (frequent/infrequent/archive-instant) | objects < 128 KB not auto-tiered | unknown access patterns |
| Standard-IA / One Zone-IA | ~0.0125 / ~0.01 | ms, per-GB retrieval fee | 30 days, 128 KB billable min | backups, older media |
| Glacier Instant Retrieval | ~0.004 | ms, higher retrieval fee | 90 days | quarterly-access archives |
| Glacier Flexible Retrieval | ~0.0036 | minutes–12 h | 90 days | DR copies |
| Glacier Deep Archive | ~0.00099 | 12–48 h | 180 days | compliance (7-year retention) |

**Traps:** transitions are billed **per object** — moving 100 M tiny objects to Glacier can cost more than it saves (and Glacier adds ~40 KB of per-object metadata overhead). Early deletion before the minimum duration is charged for the full period. Egress (~$0.09/GB to the internet) often dwarfs storage cost for media — solve with a CDN.

**What silently grows a bill:** noncurrent versions in versioned buckets, incomplete multipart uploads, orphan objects whose DB rows were deleted, duplicated uploads, logs never expired, cross-region replication doubling everything. Use S3 Storage Lens / Inventory to find them.

**Garbage collection inside the store (book):** garbage comes from lazy deletes, orphan data (half-uploaded / abandoned multipart), and corrupted data. A GC process periodically **compacts** sealed files: copy live objects into a new file, skip deleted ones, update object_mapping in one transaction, then drop the old file. It waits until many read-only files qualify and merges them into a few large files to avoid creating small files. With replication it deletes on all replicas; with 8+4 EC on all 12 nodes.`,
      code: [
        {
          language: 'json',
          title: 'Lifecycle configuration (PutBucketLifecycleConfiguration)',
          code: `{
  "Rules": [
    {
      "ID": "media-tiering",
      "Filter": { "Prefix": "media/originals/" },
      "Status": "Enabled",
      "Transitions": [
        { "Days": 30, "StorageClass": "STANDARD_IA" },
        { "Days": 90, "StorageClass": "GLACIER_IR" },
        { "Days": 365, "StorageClass": "DEEP_ARCHIVE" }
      ],
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 }
    },
    {
      "ID": "tmp-and-logs",
      "Filter": { "Prefix": "tmp/" },
      "Status": "Enabled",
      "Expiration": { "Days": 7 }
    },
    {
      "ID": "abort-stale-multipart",
      "Filter": {},
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}`,
        },
      ],
      keyPoints: [
        'Standard → IA (30 d) → Glacier IR (90 d) → Deep Archive: ~23× cheaper at the bottom.',
        'Per-object transition fees and minimum sizes/durations make tiering tiny objects a loss.',
        'Expire noncurrent versions and abort stale MPUs — the two most common invisible cost leaks.',
      ],
      source: 'AWS S3 pricing & lifecycle docs; Alex Xu Vol 2 Ch 9 (Garbage collection)',
    },
    {
      heading: '10. CDN in front of object storage — global downloads without melting origin',
      body: `**Intuition:** instead of every customer driving to the central warehouse, you stock copies in neighbourhood shops. The warehouse (S3 origin) only restocks the shops.

**Architecture:** client → nearest CDN PoP (CloudFront / Fastly / Akamai / Cloudflare) → regional/**origin shield** tier → S3 bucket. The bucket stays **private**; the CDN reads it via **Origin Access Control (OAC)**. Only the CDN can hit the origin.

**Making it cache well**

- **Immutable, versioned keys** — \`/img/{contentHash}.webp\` with \`Cache-Control: public, max-age=31536000, immutable\`. Never overwrite a key; publish a new one and update the reference. No invalidations needed.
- **Cache key hygiene** — strip per-user query params, cookies and auth signatures from the cache key; otherwise every request is a miss.
- **Private content** — use **CDN signed cookies or signed URLs** (policy with wildcard resource + expiry), not S3 presigned URLs, so the edge can cache one copy and authorise many users.
- **Range requests** — CDNs cache byte ranges of large files (installers, video) so resumable downloads and seeking work at the edge.
- **Origin shield** collapses misses from hundreds of PoPs into one origin fetch per object — critical for a big launch (thundering herd on a new release).

**Numbers:** S3 first-byte latency from another continent: 150–300 ms+; CDN edge hit: 10–30 ms. Hit ratio 95%+ for static assets means origin sees ~5% of requests. Internet egress from S3 ~$0.09/GB vs CDN commit pricing often $0.01–0.05/GB at volume (and S3 → CloudFront transfer is free).

**Global uploads:** S3 Transfer Acceleration or uploading to the nearest regional bucket (then async replicate) cuts upload RTT for far-away users.`,
      code: [
        {
          language: 'typescript',
          title: 'CloudFront signed cookies for a private HLS video (one auth, many segments)',
          code: `import { getSignedCookies } from '@aws-sdk/cloudfront-signer';
import type { Response } from 'express';

const CDN = 'https://media.example.com';            // CloudFront alternate domain
const KEY_PAIR_ID = process.env.CF_KEY_PAIR_ID!;     // public key registered in a key group
const PRIVATE_KEY = process.env.CF_PRIVATE_KEY_PEM!;

export function grantVideoAccess(res: Response, videoId: string, ttlSec = 3600) {
  const expires = Math.floor(Date.now() / 1000) + ttlSec;
  // Custom policy with a wildcard: covers master.m3u8, variant playlists and every segment.
  const policy = JSON.stringify({
    Statement: [{
      Resource: CDN + '/videos/' + videoId + '/*',
      Condition: { DateLessThan: { 'AWS:EpochTime': expires } },
    }],
  });
  const cookies = getSignedCookies({ keyPairId: KEY_PAIR_ID, privateKey: PRIVATE_KEY, policy });
  for (const [name, value] of Object.entries(cookies)) {
    // CloudFront-Policy, CloudFront-Signature, CloudFront-Key-Pair-Id
    res.cookie(name, value as string, {
      domain: '.example.com', path: '/videos/' + videoId + '/',
      httpOnly: true, secure: true, sameSite: 'lax', maxAge: ttlSec * 1000,
    });
  }
  // Cookies are verified at the edge and are NOT part of the cache key,
  // so every viewer shares the same cached segments.
  return CDN + '/videos/' + videoId + '/master.m3u8';
}`,
        },
      ],
      keyPoints: [
        'Private bucket + OAC; CDN is the only reader.',
        'Content-hashed immutable keys + 1-year max-age = no invalidations, ~99% hit ratio.',
        'Signed cookies/URLs at the CDN keep caching intact; per-user S3 presigned URLs defeat it.',
      ],
      source: 'AWS CloudFront docs — OAC, signed cookies',
    },
    {
      heading: '11. Video streaming basics — transcoding pipeline, HLS/DASH, ABR',
      body: `**Intuition:** you don't ship a movie as one 4 GB file. You cut it into 2–6 second tiles, each available in several qualities, and a menu (manifest) lets the player pick the best quality its network can handle *right now*, tile by tile.

**Pipeline**

1. **Upload** original via multipart/tus → \`originals/\` (object storage).
2. ObjectCreated event → **queue** (SQS/Kafka) → **transcoding workers** (FFmpeg on autoscaled spot instances / MediaConvert). Split long videos into GOP-aligned chunks and transcode **in parallel**, then stitch — a 1-hour video finishes in minutes.
3. Produce an **ABR ladder**, e.g. 1080p@5 Mbps, 720p@3 Mbps, 480p@1.5 Mbps, 360p@0.8 Mbps (+ audio). Keyframes must be **aligned across renditions** (fixed GOP, scene-cut detection off) so the player can switch at any segment boundary.
4. **Package** into HLS (.m3u8 + .ts or fMP4) and/or DASH (.mpd); **CMAF** (fMP4) lets one set of segments serve both. Encrypt (AES-128 / SAMPLE-AES / Widevine/FairPlay DRM) if needed.
5. Write segments to \`renditions/{videoId}/...\`, mark video READY in DB, purge nothing — segments are immutable.
6. Serve via **CDN**: segments cached ~forever; VOD manifests long TTL; live manifests 1–2 s TTL.

**HLS vs DASH:** HLS (Apple) is required for native iOS Safari playback; DASH is codec-agnostic, ISO standard, widely used on Android/web with MSE players. Segment length trade-off: 6 s segments → fewer requests, better compression, but slower start/latency; 2 s → faster adaptation and lower live latency. Low-Latency HLS/DASH use partial segments (~200–500 ms parts) to get live latency to 2–5 s.

**Storage/cost insight:** renditions can exceed the original in total size; move originals to Glacier after transcoding, use per-title encoding, and drop high renditions for long-tail videos nobody watches.`,
      diagram: `upload ─▶ [S3 originals/] ─event─▶ [queue] ─▶ [transcode workers x N]
                                                    │ ffmpeg: split GOPs,
                                                    │ ladder 1080/720/480/360
                                                    ▼
             [S3 renditions/{id}/master.m3u8, 720p/seg_0001.m4s ...]
                                                    │ origin (OAC)
   player ◀── ABR: pick variant per segment ──[CDN edge + origin shield]
   (hls.js / AVPlayer / ExoPlayer)`,
      code: [
        {
          language: 'text',
          title: 'HLS master playlist (variants the player chooses between)',
          code: `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=5500000,AVERAGE-BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3300000,AVERAGE-BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1700000,AVERAGE-BANDWIDTH=1500000,RESOLUTION=854x480,CODECS="avc1.4d401e,mp4a.40.2"
480p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,AVERAGE-BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360p/index.m3u8`,
        },
        {
          language: 'bash',
          title: 'FFmpeg: one rendition with GOP-aligned 6 s HLS segments',
          code: `# 30 fps, keyframe every 60 frames (2 s), no scene-cut keyframes -> segments
# of exactly 6 s start on an IDR frame in EVERY rendition (switchable).
ffmpeg -i original.mp4 \\
  -vf scale=-2:720 -r 30 \\
  -c:v libx264 -preset medium -profile:v high \\
  -b:v 3000k -maxrate 3300k -bufsize 6000k \\
  -g 60 -keyint_min 60 -sc_threshold 0 \\
  -c:a aac -b:a 128k -ac 2 \\
  -f hls -hls_time 6 -hls_playlist_type vod \\
  -hls_segment_type fmp4 \\
  -hls_segment_filename 'out/720p/seg_%04d.m4s' \\
  out/720p/index.m3u8`,
        },
      ],
      keyPoints: [
        'ABR ladder + aligned keyframes = seamless quality switching at segment boundaries.',
        'CMAF fMP4 segments can serve both HLS and DASH — store once.',
        'Transcode in parallel chunks from a queue; segments immutable on CDN, live manifests short TTL.',
      ],
      source: 'Apple HLS Authoring Specification; MPEG-DASH; Alex Xu Vol 1 (YouTube design)',
    },
    {
      heading: '12. Scenario playbook — what to say when the interviewer throws these at you',
      body: `**Intuition:** almost every storage scenario resolves to the same three moves — get bytes off your app servers (presigned/direct), make transfers restartable (multipart/tus), and put a CDN + lifecycle policy around the bucket.

| Scenario | First move | Deep move | Watch out for |
|---|---|---|---|
| **Upload a 10 GB file** | Multipart with presigned part URLs, 64 MiB parts, 4–8 parallel | Transfer Acceleration / regional buckets for far users; CRC32C per part | 10,000-part cap; lifecycle abort of stale MPUs |
| **Upload fails at 90%** | Resume: persist uploadId, ListParts, re-send missing parts (or tus HEAD → PATCH) | Adaptive part size by network; background upload (iOS URLSession / Android WorkManager) | Don't just "retry with backoff" the whole PUT |
| **Millions of images** | Presigned POST → S3 → event → thumbnail workers → CDN | Content-hash keys (dedup + immutable caching), WebP/AVIF variants, on-the-fly resizer behind CDN | Key hot-spotting is mostly auto-handled now, but per-prefix limits still exist (~3.5K writes / 5.5K reads per s) |
| **Global downloads** | CDN with origin shield, immutable versioned keys, range requests | Multi-region replication for origin failover; signed cookies for private files | Cache keys polluted by query strings/cookies |
| **Video streaming** | Queue-driven transcode to ABR ladder, HLS/DASH (CMAF) segments, CDN | Parallel chunk transcoding, per-title encoding, DRM, LL-HLS for live | Unaligned GOPs break switching; don't serve MP4 progressive for long videos |
| **Storage costs rising** | Storage Lens/Inventory: find top prefixes, noncurrent versions, stale MPUs | Lifecycle tiering, dedup, expire tmp/logs, delete originals or move to Deep Archive, CDN for egress | Tiering tiny objects costs more; minimum durations; egress usually the real bill |

**The metadata/data split again:** in every answer say where the *pointer* lives (DB row with key, size, checksum, status = PENDING → READY) and how it transitions (event-driven), because that is where correctness bugs hide (orphan objects, rows pointing to missing files, double processing on event redelivery — make consumers idempotent by object key + ETag).`,
      keyPoints: [
        'Three moves: direct-to-bucket, restartable transfers, CDN + lifecycle.',
        'Track upload state in DB (PENDING → READY) driven by idempotent storage events.',
        'Egress, versions and stale MPUs are the usual cost culprits, not raw GB.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'object-storage-cc-1',
      title: 'Avatar upload endpoint that proxies bytes through the API',
      context:
        'A NestJS service lets users upload profile pictures. At launch of a marketing campaign pods started OOM-killing, p99 of unrelated endpoints hit 4 s, one user overwrote another user\'s avatar, and security flagged an uploaded SVG that ran JavaScript on the app domain.',
      task:
        'Redesign the upload flow so bytes never pass through the API pods, keys cannot collide or be chosen by clients, size/type are enforced, thumbnails are generated off the request path, and the DB only points at validated objects. Keep it idempotent under event redelivery.',
      starter: {
        language: 'typescript',
        code: `import { Controller, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { Pool } from 'pg';

const s3 = new S3Client({});
const pg = new Pool();
const BUCKET = 'acme-avatars';

@Controller('avatars')
export class AvatarController {
  @Post()
  @UseInterceptors(FileInterceptor('file'))          // multer memory storage, no limits
  async upload(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    const key = 'avatars/' + file.originalname;      // client-controlled key
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: file.buffer,
      ContentType: file.mimetype,                    // trusted from the client
      ACL: 'public-read',
    }));
    // resize on the event loop, inside the HTTP request
    const thumb = await sharp(file.buffer).resize(128, 128).toBuffer();
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key + '_thumb', Body: thumb, ACL: 'public-read' }));
    await pg.query('UPDATE users SET avatar_url = $1 WHERE id = $2',
      ['https://' + BUCKET + '.s3.amazonaws.com/' + key, req.user.id]);
    return { ok: true };
  }
}`,
      },
      hints: [
        'Who should carry the bytes: your pod, or S3 directly? What can a signed POST policy enforce that your code currently does not?',
        'Treat "upload finished" as an event from the bucket, not a claim from the client. What makes processing that event safe to run twice?',
        'Think about how the served URL interacts with CDN caching when a user changes their avatar.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Controller, Post, Req, BadRequestException } from '@nestjs/common';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Pool } from 'pg';

const s3 = new S3Client({});
const pg = new Pool();
const BUCKET = 'acme-avatars';                       // private bucket, ACLs disabled, CDN via OAC
const CDN = 'https://img.acme.com';
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);   // no SVG

@Controller('avatars')
export class AvatarController {
  @Post('upload-url')
  async uploadUrl(@Req() req: any) {
    const key = 'raw/' + req.user.id + '/' + randomUUID();          // server-chosen, unique
    await pg.query('INSERT INTO avatar_uploads (key, user_id, status) VALUES ($1, $2, $3)',
      [key, req.user.id, 'PENDING']);
    return createPresignedPost(s3, {
      Bucket: BUCKET, Key: key, Expires: 300,
      Conditions: [['content-length-range', 1, 5 * 1024 * 1024], ['starts-with', '$Content-Type', 'image/']],
    });                                                              // browser POSTs straight to S3
  }
}

// SQS consumer for s3:ObjectCreated:* on prefix raw/ (runs in a worker, not the API pod)
export async function onObjectCreated(key: string, etag: string): Promise<void> {
  const row = await pg.query(
    'UPDATE avatar_uploads SET status = $1 WHERE key = $2 AND status = $3 RETURNING user_id',
    ['PROCESSING', key, 'PENDING']);                                 // idempotent claim
  if (row.rowCount === 0) return;                                    // duplicate event or unknown key
  const userId: string = row.rows[0].user_id;
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const input = Buffer.from(await obj.Body!.transformToByteArray());
  const meta = await sharp(input).metadata();                        // sniff real format (magic bytes)
  if (!meta.format || !ALLOWED.has('image/' + meta.format)) {
    await pg.query('UPDATE avatar_uploads SET status = $1 WHERE key = $2', ['REJECTED', key]);
    return;
  }
  const thumb = await sharp(input).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  const outKey = 'avatars/' + userId + '/' + etag.replace(/"/g, '') + '.webp';   // content-versioned
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: outKey, Body: thumb, ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  await pg.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [CDN + '/' + outKey, userId]);
  await pg.query('UPDATE avatar_uploads SET status = $1 WHERE key = $2', ['READY', key]);
}`,
      },
      explanation: `- **Bytes bypass the API:** presigned POST sends the file straight to S3, so no multer buffers, no OOM, no event-loop blocking for other requests.
- **S3 enforces limits:** \`content-length-range\` (≤ 5 MiB) and a Content-Type condition are checked by S3 before storing.
- **Server-chosen keys:** \`raw/{userId}/{uuid}\` — no collisions, no client-controlled paths, no overwrites of other users.
- **Real type validation:** the worker sniffs the actual format and whitelists raster types; SVG/HTML never become servable, killing the stored-XSS vector. Output is re-encoded (strips EXIF/GPS too, rotate() applies orientation).
- **Off the request path:** thumbnailing runs in a queue consumer that can autoscale separately.
- **Idempotent:** a conditional \`PENDING → PROCESSING\` update means redelivered S3 events are no-ops (a production version would also handle PROCESSING rows stuck after a crash with a timeout).
- **No public ACLs:** new buckets have ACLs disabled (BucketOwnerEnforced) — \`ACL: 'public-read'\` would actually fail; content is served via CDN + OAC.
- **Cache-friendly URLs:** content-versioned keys + immutable Cache-Control mean a new avatar is a new URL; no CDN invalidation, 1-year edge caching.
- Add a lifecycle rule to expire \`raw/\` after a few days and to abort stale multipart uploads.`,
      followUps: [
        {
          "q": "The worker crashes after setting PROCESSING but before READY. How do you make sure the avatar still gets processed?",
          "a": "Add a lease. Record `processing_started_at` (or `lease_until = now() + 5 min`) in the claim UPDATE, and let the claim condition accept `status = 'PENDING' OR (status = 'PROCESSING' AND lease_until < now())`. A redelivered SQS message, or a sweeper job that re-enqueues expired leases every minute, then picks it up again. The rest of the pipeline is already safe to repeat: the output key is derived from the source ETag, so re-processing overwrites the same object with identical bytes, and the final UPDATEs are idempotent. Alert on rows stuck in PROCESSING longer than N minutes."
        },
        {
          "q": "How would you test this flow end to end in CI without touching real AWS?",
          "a": "Run LocalStack (or MinIO) in Docker for S3 and SQS, and Postgres in Testcontainers. Test 1: call `upload-url`, POST a real 200 KB JPEG to the returned URL and form fields, invoke `onObjectCreated` with the key and ETag, and assert the user's `avatar_url` points to a WebP with `Cache-Control: immutable`. Test 2: POST a 6 MB file and assert S3 rejects it (`EntityTooLarge`). Test 3: upload an SVG renamed `.jpg` and assert the status becomes REJECTED. Test 4: call `onObjectCreated` twice concurrently and assert one output object and one DB update."
        }
      ],
    },
    {
      id: 'object-storage-cc-2',
      title: 'Backup uploader that falls over on a 20 GB file',
      context:
        'A nightly Node job uploads Postgres base backups (15–40 GB) to S3. It crashed with "RangeError: File size is greater than 2 GiB", then after a "fix" got EntityTooSmall / InvalidArgument errors, and finance noticed hundreds of GB of invisible billed storage in the bucket.',
      task:
        'Rewrite the uploader so it streams from disk with bounded memory, chooses a valid part size for any file up to the service limits, uploads with bounded parallelism, retries individual parts, can resume a previous attempt, and never leaves unbounded orphan parts.',
      starter: {
        language: 'typescript',
        code: `import { readFile } from 'node:fs/promises';
import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export async function uploadBackup(path: string, bucket: string, key: string) {
  const data = await readFile(path);                     // entire file in memory
  const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }));
  const partSize = 1024 * 1024;                          // 1 MiB parts
  const uploads: Promise<{ PartNumber: number; ETag?: string }>[] = [];
  for (let i = 0; i * partSize < data.length; i++) {
    uploads.push(
      s3.send(new UploadPartCommand({
        Bucket: bucket, Key: key, UploadId, PartNumber: i,
        Body: data.subarray(i * partSize, (i + 1) * partSize),
      })).then((r) => ({ PartNumber: i, ETag: r.ETag })),
    );
  }
  const parts = await Promise.all(uploads);              // thousands of requests at once
  await s3.send(new CompleteMultipartUploadCommand({
    Bucket: bucket, Key: key, UploadId, MultipartUpload: { Parts: parts },
  }));
}`,
      },
      hints: [
        'Check S3 rules: valid PartNumber range, minimum part size, maximum part count. Derive part size from file size.',
        'Read each part with a positioned read from a FileHandle and cap how many parts are in flight.',
        'On restart, ask S3 which parts it already has (ListParts, paginated). What happens to parts if the job dies and nobody aborts?',
      ],
      solution: {
        language: 'typescript',
        code: `import { open } from 'node:fs/promises';
import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  ListPartsCommand, AbortMultipartUploadCommand, type CompletedPart,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({ maxAttempts: 1 });            // we own retries per part
const MIN_PART = 8 * 1024 * 1024, MAX_PARTS = 10_000, CONCURRENCY = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listUploaded(bucket: string, key: string, uploadId: string) {
  const done = new Map<number, CompletedPart>();
  let marker: string | undefined;
  do {                                                   // ListParts returns max 1,000 per page
    const res = await s3.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
    for (const p of res.Parts ?? []) done.set(p.PartNumber!, { PartNumber: p.PartNumber, ETag: p.ETag, ChecksumCRC32C: p.ChecksumCRC32C });
    marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
  } while (marker);
  return done;
}

export async function uploadBackup(path: string, bucket: string, key: string, resumeUploadId?: string) {
  const fh = await open(path, 'r');
  const { size } = await fh.stat();
  const partSize = Math.max(MIN_PART, Math.ceil(size / MAX_PARTS / 1048576) * 1048576);
  const partCount = Math.max(1, Math.ceil(size / partSize));
  const uploadId = resumeUploadId ?? (await s3.send(new CreateMultipartUploadCommand({
    Bucket: bucket, Key: key, ChecksumAlgorithm: 'CRC32C' }))).UploadId!;
  console.log('uploadId', uploadId);                     // persist this to resume later
  try {
    const done = resumeUploadId ? await listUploaded(bucket, key, uploadId) : new Map<number, CompletedPart>();
    let next = 1;
    const worker = async () => {
      const buf = Buffer.alloc(partSize);                // memory bounded: CONCURRENCY x partSize
      for (let n = next++; n <= partCount; n = next++) {
        if (done.has(n)) continue;
        const { bytesRead } = await fh.read(buf, 0, partSize, (n - 1) * partSize);
        for (let attempt = 1; ; attempt++) {
          try {
            const r = await s3.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId,
              PartNumber: n, Body: buf.subarray(0, bytesRead), ChecksumAlgorithm: 'CRC32C' }));
            done.set(n, { PartNumber: n, ETag: r.ETag, ChecksumCRC32C: r.ChecksumCRC32C });
            break;
          } catch (err) {
            if (attempt >= 5) throw err;
            await sleep(Math.random() * 200 * 2 ** attempt);   // full-jitter backoff
          }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const parts = [...done.values()].sort((a, b) => a.PartNumber! - b.PartNumber!);
    await s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchUpload') throw err;
    if (process.env.ABORT_ON_FAILURE === 'true') {       // otherwise keep parts for resume;
      await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    }                                                    // lifecycle rule aborts after 7 days
    throw err;
  } finally {
    await fh.close();
  }
}`,
      },
      explanation: `- **Bounded memory:** positioned \`fh.read\` into one reusable buffer per worker (8 × part size) instead of \`readFile\`, which cannot even load files over 2 GiB into a single Buffer.
- **Valid parts:** PartNumber is 1-based (0 is rejected); size is max(8 MiB, size/10,000 rounded up to MiB), so a 40 GB file gets ~4 MiB → bumped to 8 MiB → 4,769 parts, and any file up to the 10,000-part cap works. 1 MiB parts would fail with EntityTooSmall at completion and exceed 10,000 parts beyond ~10 GiB.
- **Bounded concurrency:** 8 workers instead of thousands of simultaneous requests (socket exhaustion, throttling, 503 SlowDown).
- **Per-part retries** with full-jitter exponential backoff; the SDK's own retries are disabled so attempts are not multiplied.
- **Resume:** with a saved uploadId, paginated ListParts tells us which parts S3 already has, so a crash at 90% resumes at 90%.
- **Integrity:** CRC32C checksums per part are validated by S3 and carried into Complete.
- **Ordered completion:** parts sorted ascending as Complete requires.
- **No infinite orphans:** optional explicit abort plus a bucket lifecycle \`AbortIncompleteMultipartUpload\` rule, because incomplete parts are billed and invisible in ListObjects.`,
      followUps: [
        {
          "q": "The backup host is on a 1 Gbps link and the 40 GB backup must finish within a 30-minute window. Does this design meet it, and what would you tune?",
          "a": "At 1 Gbps (about 125 MB/s) the theoretical minimum for 40 GB is 40,000 ÷ 125 = 320 s, about 5.3 minutes, so the link isn't the limit. A single S3 connection usually manages 50–100 MB/s, so 8 workers × 8 MiB parts can saturate the link. Measure, though: if `fh.read` from network storage is slow, disk is the bottleneck; if part latency is high (cross-region), raise concurrency to 16. Memory is 8 × 8 MiB = 64 MiB. Compressing with zstd before upload often halves the bytes for Postgres data."
        },
        {
          "q": "Two cron runs overlap and both upload to the same key. What breaks, and how do you prevent it?",
          "a": "Each run creates its own multipart upload ID, so the parts don't mix. The last CompleteMultipartUpload simply wins and overwrites the object, while the loser's parts are billed until aborted. The real danger is semantic: a partial or older backup could replace a newer one, or a later restore could pick the wrong file. Prevent it by keying backups by timestamp or LSN (`base/2026-10-07T02:00Z.tar.zst`), never one 'latest' key. Take a lock (a DynamoDB conditional put or a Postgres advisory lock) per database, and write a manifest only after Complete succeeds."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'object-storage-iq-01',
      difficulty: 'expert',
      question:
        'Design an S3-like object store: 100 PB, six nines of durability, PUT/GET/DELETE/LIST, versioning. Walk me through the architecture and the write path.',
      context: 'Classic Alex Xu Ch 9 prompt. The interviewer wants to see you split the problem before diving into disks.',
      whatInterviewerLooksFor: [
        'Separates metadata (name → object_id) from immutable data addressed by UUID',
        'Explains placement service, failure domains and the replication/ack trade-off',
        'Knows why small objects are packed into large files with a per-node index',
        'Shards metadata correctly and has a plan for LIST and versioning',
        'Quantifies: object count, metadata size, raw capacity',
      ],
      modelAnswer: `### Requirements & numbers
- 100 PB usable; assume object mix 20% small (~0.5 MB), 60% medium (~32 MB), 20% large (~200 MB) → mean ≈ 59 MB. At 40% target fill: 100 PB × 0.4 ÷ 59 MB ≈ **0.68 B objects** → ~1 KB metadata each ≈ **0.7 TB metadata** (small vs data, but billions of rows).

### Architecture
1. **Stateless API service** behind LBs: SigV4 auth via **IAM**, orchestration only.
2. **Metadata service**: \`bucket\` table (tiny, replicated) and \`object\` table sharded by **hash(bucket, key)**; strongly consistent so PUT-then-GET works.
3. **Data store**: stateless **data routing service**, **placement service** (5–7 node Raft cluster holding the virtual cluster map; heartbeats, marks nodes down after ~15 s), and **data nodes**.

### Write path
Client PUT → API authorises → routing asks placement for a replication group (consistent hashing on UUID) → streams to **primary**, which appends to its current read-write file, fsyncs, replicates to two secondaries in **different AZs**, and acks after all (or a quorum) persist → API writes metadata row → 200. Data first, metadata second, so crashes leave only orphans for GC.

### On-disk layout
Pack objects into multi-GB append-only files (one per core), seal when full; per-node SQLite \`object_mapping(object_id → file, offset, size)\`; checksum per object and per sealed file.

### Durability
3× replication across AZs ≈ 6 nines (1 − 0.0081³); for cost, convert cold data to **8+4 erasure coding** (~11 nines, 1.5× raw instead of 3×). Scrubbers verify checksums continuously.

### LIST and versioning
Prefix + delimiter listing from a **bucket-sharded listing index** with keyset cursors. Versioning inserts new rows with TIMEUUID versions; delete = delete marker; GC + compaction reclaim space.

### Large files
Multipart upload (≤10,000 parts), abort stale uploads via lifecycle.`,
      followUps: [
        {
          q: 'Why not store each object as its own file on ext4/XFS?',
          a: 'A 1 KB object still consumes a 4 KB block and one inode; billions of files exhaust inodes and blow the inode/dentry cache, making every lookup a disk seek. Packing into large files with an index keeps metadata in RAM and IO sequential (Haystack does the same).',
        },
        {
          q: 'The placement service is down. What still works?',
          a: 'Reads keep working if routing caches the cluster map and object → group mapping is deterministic (consistent hashing). New writes needing placement decisions and failure handling stall, which is why it is a Raft cluster of 5–7 nodes tolerating 2–3 failures.',
        },
        {
          q: 'How would you give strong read-after-write consistency on overwrite?',
          a: 'Make the metadata store linearisable per key (single leader per shard / Paxos) and only commit the new version row after data is durable; readers always resolve the name through that leader or a read-your-writes-safe path, never a lagging replica or stale cache.',
        },
      ],
      pitfalls: [
        'Putting bytes in the same database as metadata',
        'Sharding objects by bucket (hot shard for a billion-object bucket)',
        'Acking after the primary write only and calling it durable',
        'Ignoring LIST and pagination entirely',
      ],
    },
    {
      id: 'object-storage-iq-02',
      difficulty: 'hard',
      question:
        'Your storage team proposes moving everything from 3× replication to 8+4 erasure coding to halve hardware spend. Would you approve it? What breaks?',
      whatInterviewerLooksFor: [
        'Correct overhead and durability numbers (200% vs 50%, ~6 vs ~11 nines)',
        'Understands read fan-out, tail latency and degraded reads',
        'Understands repair bandwidth and CPU cost',
        'Proposes a tiered hybrid instead of all-or-nothing',
      ],
      modelAnswer: `### The win
- 3× replication stores 3 bytes per byte (200% overhead); 8+4 stores 1.5 (50% overhead). On 100 PB usable that is **300 PB → 150 PB raw** — roughly half the drives, racks and power.
- Durability improves too: 8+4 across 12 failure domains survives any 4 losses (~11 nines vs ~6 nines).

### What gets worse
- **Reads fan out:** a normal GET needs ≥8 chunks from 8 nodes. p99 becomes the slowest of 8 — small hot objects (thumbnails, API responses) will see visibly worse tail latency. Mitigate with hedged reads (request 9–10 chunks, use the first 8).
- **Degraded reads & repair:** losing a 20 TB disk means reconstructing each lost chunk from 8 others → ~8× the repair network traffic of replication. Repair time directly drives durability, so network capacity must be planned.
- **Writes:** parity encoding costs CPU (ISA-L makes Reed–Solomon a few GB/s per core, so it is manageable) and a write must reach 12 nodes before ack.
- **Small objects:** EC on a 4 KB object is absurd (12 tiny chunks, metadata heavier than data) — pack small objects into large sealed files/stripes first, then erasure-code the stripe.

### My recommendation
Hybrid, like HDFS/Ceph/S3: **replicate new and hot data**, then **background-transcode sealed, cooled files to 8+4** (say after 7–30 days or when the RW file is sealed). Keep latency-critical small-object buckets replicated. Validate with a durability model including realistic repair times and correlated failures, and roll out per storage class.`,
      followUps: [
        {
          q: 'Why do some systems use 6+3 or LRC (e.g. 12+2+2) instead of 8+4?',
          a: 'Wider stripes save space but increase repair fan-out. Local Reconstruction Codes add local parities so a single lost chunk is rebuilt from a small group (e.g. 6 chunks) instead of the whole stripe — cheaper repair, which is the common case.',
        },
        {
          q: 'How do you place the 12 chunks?',
          a: 'Each in a distinct failure domain (different racks; spread across 3 AZs as 4+4+4 so an AZ loss costs only 4 chunks, still recoverable). The placement service enforces this from the cluster map.',
        },
      ],
      pitfalls: [
        'Saying erasure coding is strictly better with no latency or repair cost',
        'Forgetting that small objects must be aggregated before encoding',
        'Treating durability as only a function of copy count, ignoring repair time',
      ],
    },
    {
      id: 'object-storage-iq-03',
      difficulty: 'hard',
      question:
        'Mobile users upload 2–10 GB videos. Support tickets say uploads "fail at 90% and start over". Fix it end to end.',
      context: 'Current implementation: the app does a single HTTP PUT to your API, which streams the body to S3.',
      whatInterviewerLooksFor: [
        'Removes the API from the byte path (presigned multipart / tus)',
        'Makes progress durable: resume from the last acknowledged part/offset',
        'Picks part size with numbers and respects S3 limits',
        'Covers OS background upload, integrity, cleanup and completion semantics',
      ],
      modelAnswer: `### Why it fails
A 10 GB single PUT at 20 Mbps takes ~67 min. Any Wi-Fi↔LTE handoff, app suspension, LB idle timeout or pod deploy during that hour kills it, and a single PUT has no notion of partial progress — retrying with backoff just restarts the hour.

### Fix
1. **Direct, chunked, resumable uploads.** API calls CreateMultipartUpload with a server-chosen key, returns uploadId + presigned UploadPart URLs (or run a **tus** endpoint backed by S3). Our pods only handle JSON.
2. **Part size for mobile:** 8–16 MiB → a 10 GB file is ~600–1,200 parts (well under 10,000); a failed part costs seconds, not minutes. Upload 3–4 parts in parallel; adapt size to measured throughput.
3. **Persist resume state on device** (uploadId, key, part size, completed parts). On restart call **ListParts** (paginated) or tus **HEAD** for Upload-Offset, and send only what's missing. Failure at 90% resumes at 90%.
4. **Survive backgrounding:** iOS background URLSession / Android WorkManager upload file-backed parts so the OS continues when the app is suspended.
5. **Integrity:** CRC32C/SHA-256 checksum per part verified by S3; Complete with the part list from ListParts.
6. **Completion:** client calls \`/complete\`; API completes MPU; the ObjectCreated event moves the DB row PENDING → UPLOADED and enqueues transcoding (idempotent by key + ETag).
7. **Cleanup:** lifecycle AbortIncompleteMultipartUpload after 3–7 days; refresh expired part URLs via an API call instead of failing.
8. **Far users:** S3 Transfer Acceleration or regional upload buckets.

### Metrics
Upload success rate, bytes re-sent ratio, parts retried, time-to-complete by network type.`,
      followUps: [
        {
          q: 'Presigned part URLs expire after 1 hour but the upload takes 3 hours. Now what?',
          a: 'Issue URLs lazily in batches (e.g. next 50 parts) or add a refresh endpoint; never presign all 1,000 up front with a multi-hour expiry. Also note URLs signed with role credentials die when the session token expires.',
        },
        {
          q: 'tus or native S3 multipart?',
          a: 'Multipart is zero extra infra and parallel by design; tus gives a standard, byte-granular resume protocol and client libraries across platforms but needs a tus server (tusd/@tus/server) in the path, which you must scale. Many teams use multipart for their own apps and tus when they need an open protocol or non-S3 backends.',
        },
      ],
      pitfalls: [
        'Increasing timeouts or adding retries to the single PUT',
        'Proxying multi-GB bodies through NestJS pods',
        'Forgetting stale multipart parts are billed forever without a lifecycle rule',
      ],
    },
    {
      id: 'object-storage-iq-04',
      difficulty: 'hard',
      question:
        'We are building an Instagram-like feature: 50 M image uploads per day, each shown in 4 sizes, read ~100× more than written. Design storage and delivery.',
      whatInterviewerLooksFor: [
        'Direct-to-bucket uploads and async processing pipeline',
        'Key design: content-hashed, immutable, tenant/user scoped',
        'CDN strategy with high hit ratio and private-content handling',
        'Numbers for storage growth and request rates',
        'Cost tiering and dedup',
      ],
      modelAnswer: `### Numbers
- 50 M/day ÷ 86,400 ≈ **580 uploads/s**, peak ~2K/s. Reads 100× → ~58K/s average, ~200K/s peak — must be CDN-served.
- Original ~2 MB + 4 variants (~400 KB total WebP/AVIF) ≈ 2.4 MB/image → **~120 TB/day, ~44 PB/year** before tiering.

### Upload path
1. App asks API for a **presigned POST** (key \`raw/{userId}/{uuid}\`, ≤20 MB, image/* only), DB row status PENDING.
2. Client uploads straight to S3.
3. ObjectCreated → SQS/Kafka → **image workers** (autoscaled on queue depth): validate magic bytes, strip EXIF/GPS, generate 4 variants, write to \`img/{sha256}/{size}.webp\`, mark READY. Idempotent on (key, ETag).

### Read path
- Serve only via **CDN** with OAC to a private bucket. Keys are content-hashed and never overwritten → \`Cache-Control: max-age=31536000, immutable\`, no invalidations, 95–99% hit ratio. Origin shield collapses misses.
- Optionally an on-the-fly resizer (Lambda@Edge / imgproxy) behind the CDN for new sizes; cache its output.
- Private posts: CDN signed cookies/URLs scoped to the user's session, not per-request S3 presigned URLs (which kill caching).

### Metadata
Posts table stores the hash key, dimensions, blurhash, status. The DB never stores bytes.

### Cost
- **Dedup** by sha256 (reshared memes) with refcounts, per tenant or server-side only.
- Lifecycle: originals → Standard-IA after 30 days, Glacier IR after 90 (variants stay hot); expire \`raw/\` staging objects.
- Egress is the real bill: 58K/s × ~100 KB ≈ 5.8 GB/s ≈ 500 TB/day — negotiate CDN commit pricing.`,
      followUps: [
        {
          q: 'A celebrity posts and the image gets 2M requests in a minute. Risks?',
          a: 'Only the first requests per PoP miss; origin shield ensures one origin fetch. Risk is if the post was served before the variant existed (404 cached) — use short negative-caching TTLs and only publish URLs after READY.',
        },
        {
          q: 'User deletes a photo — how do you honour it with dedup and CDN caching?',
          a: 'Decrement refcount; delete the blob only at zero (GC job). Invalidate the CDN paths (or rely on signed URLs expiring for private content); versioned buckets need the noncurrent version removed too for true deletion (GDPR).',
        },
      ],
      pitfalls: [
        'Generating thumbnails synchronously in the upload request',
        'Serving images directly from S3 or through app servers',
        'Overwriting the same key on edit and fighting CDN invalidation',
      ],
    },
    {
      id: 'object-storage-iq-05',
      difficulty: 'hard',
      question:
        'The S3 bill grew 40% quarter over quarter while stored data "only" grew 10%. You own it now. What do you do in the first week?',
      whatInterviewerLooksFor: [
        'Breaks the bill down (storage vs requests vs egress vs replication)',
        'Knows the invisible growth sources: versions, incomplete MPUs, duplicates',
        'Applies lifecycle tiers correctly with minimum size/duration caveats',
        'Measures before and after, avoids breaking consumers',
      ],
      modelAnswer: `### 1. Find where the money goes (days 1–2)
Cost Explorer by usage type: **storage GB-month vs requests vs data transfer vs replication**. "Stored data grew 10%" usually means *visible current objects* grew 10% — the bill grows from what you don't see. Turn on **S3 Storage Lens** and **S3 Inventory** (CSV/Parquet → Athena) and group by prefix, storage class, version state, age and size.

### 2. Usual culprits
- **Noncurrent versions** in versioned buckets: overwrites and deletes keep old bytes forever. Fix: \`NoncurrentVersionExpiration\` (e.g. 30 days) plus \`ExpiredObjectDeleteMarker\` cleanup.
- **Incomplete multipart uploads**: billed, invisible to ListObjects. Fix: \`AbortIncompleteMultipartUpload\` after 7 days.
- **Egress**: clients downloading directly from S3 at ~$0.09/GB. Fix: CloudFront (S3→CloudFront transfer is free, edge pricing lower, cache hits avoid origin requests).
- **Request costs**: chatty LIST/HEAD polling, tiny-object workloads (a billion PUTs ≈ $5K).
- **Replication**: CRR doubling everything, including logs nobody needs in DR.
- **Duplicates / orphans**: same file uploaded many times; objects whose DB rows were deleted. Fix: content-hash dedup, reconciliation job between DB and inventory.

### 3. Tiering (days 3–5)
Lifecycle by prefix: logs expire at 30–90 days; media originals → Standard-IA (30 d) → Glacier IR (90 d); compliance → Deep Archive (~$1/TB-month). Use **Intelligent-Tiering** where access is unknown. Guardrails: don't transition objects < 128 KB (IA minimum billable size, per-object transition fees); respect minimum durations (30/90/180 days) to avoid early-deletion charges; check retrieval fees for anything read monthly.

### 4. Governance
Tag buckets by team, budgets + anomaly alerts, lifecycle rules in Terraform as default for every new bucket. Report expected vs realised savings weekly.`,
      followUps: [
        {
          q: 'Someone proposes moving 800 M log objects averaging 12 KB to Glacier. Good idea?',
          a: 'No. Per-object transition fees and Glacier\'s ~40 KB per-object overhead (plus IA\'s 128 KB minimum) exceed the savings. Compact them first (e.g. hourly Parquet/gzip bundles of 100+ MB), then tier or expire.',
        },
        {
          q: 'How do you know deleting noncurrent versions is safe?',
          a: 'Check who relies on versioning (accidental-delete recovery, replication, Object Lock/compliance). Keep a window (e.g. 30 days, or last N versions with NewerNoncurrentVersions) rather than zero, and never touch Object Lock retention.',
        },
      ],
      pitfalls: [
        'Jumping straight to Glacier for everything',
        'Only looking at current object size, ignoring versions and MPUs',
        'Ignoring egress and request charges',
      ],
    },
    {
      id: 'object-storage-iq-06',
      difficulty: 'expert',
      question:
        'Design the storage and delivery side of a video platform: creators upload, viewers stream on phones and TVs worldwide with adaptive quality. Where does object storage fit, and what are the hard parts?',
      whatInterviewerLooksFor: [
        'Resumable upload → event → parallel transcoding pipeline',
        'ABR ladder, aligned keyframes, HLS/DASH/CMAF packaging',
        'CDN caching rules for manifests vs segments; signed access',
        'Storage/cost estimates and tiering of originals vs renditions',
        'Idempotency and failure handling in the pipeline',
      ],
      modelAnswer: `### Ingest
Creators upload originals via **multipart/tus** (resumable) straight to \`originals/{videoId}\`. ObjectCreated → queue → **orchestrator** (Step Functions / Temporal) tracks the job; DB status UPLOADED → TRANSCODING → READY.

### Transcode
- **Split** the original at GOP boundaries into ~10–60 s chunks; fan out to a worker pool (FFmpeg on spot/GPU or MediaConvert); **stitch** — a 1-hour video finishes in minutes instead of hours.
- **ABR ladder** e.g. 1080p 5 Mbps / 720p 3 / 480p 1.5 / 360p 0.8 / audio 128 kbps, ideally per-title (content-aware) to save 20–40% bits.
- **Fixed GOP** (e.g. 2 s keyframes, scene-cut off) so every rendition has IDR frames at identical timestamps — required for seamless switching.
- Package as **CMAF fMP4** segments (4–6 s VOD) with both HLS (.m3u8) and DASH (.mpd) manifests pointing at the same segments; DRM (FairPlay/Widevine) via CENC if premium.
- Workers are idempotent: outputs written to deterministic keys; a retried chunk simply overwrites the same key before the manifest is published.

### Delivery
- Private bucket + **CDN** (OAC, origin shield). Segments are immutable → long TTL; VOD manifests long TTL; **live** manifests 1–2 s TTL.
- **Signed cookies** with a wildcard policy on \`/videos/{id}/*\` so one authorisation covers hundreds of segment requests and the CDN still caches.
- Player (hls.js / AVPlayer / ExoPlayer) picks variant per segment from measured throughput and buffer.

### Storage & cost
Ladder often sums to more bytes than the source; keep originals in Glacier after transcoding, drop top renditions for long-tail videos, and track popularity to decide which titles stay on premium tiers. Egress dominates: CDN commit pricing and high hit ratios matter more than GB-month.

### Hard parts
Hot new releases (origin shield + pre-warming), live latency (LL-HLS partial segments → 2–5 s glass-to-glass), pipeline retries without duplicate work, and consistent manifests (publish the master playlist last).`,
      followUps: [
        {
          q: 'Why not just serve the MP4 with HTTP range requests?',
          a: 'Progressive MP4 has one quality, so bad networks stall and good ones waste nothing extra but get low quality; seeking works via ranges but there is no adaptation, no DRM-friendly segmenting and poor CDN efficiency for partial views. ABR segments solve all of that.',
        },
        {
          q: 'Segment length: 2 s vs 6 s?',
          a: '2 s: faster startup, quicker adaptation and lower live latency but 3× more requests and slightly worse compression. 6 s: fewer requests, better compression, higher latency. VOD commonly uses 4–6 s; live uses 2 s or LL-HLS parts.',
        },
      ],
      pitfalls: [
        'Transcoding the whole video serially on one machine',
        'Independent GOPs per rendition, breaking switching',
        'Per-segment presigned S3 URLs that destroy CDN caching',
      ],
    },
    {
      id: 'object-storage-iq-07',
      difficulty: 'expert',
      question:
        'In your object store, LIST on a bucket with 2 billion objects times out, and one metadata shard is at 90% CPU while others idle. Diagnose and redesign the metadata layer.',
      whatInterviewerLooksFor: [
        'Identifies sharding key problems (bucket-based hot shard vs hash scatter-gather)',
        'Explains prefix/delimiter listing and why OFFSET pagination degrades',
        'Proposes a split design: hash for point ops, ordered index for listing',
        'Mentions range partitioning with automatic splits and prefix limits',
      ],
      modelAnswer: `### Diagnosis
Two symptoms, two causes:
- **Hot shard:** metadata is (probably) sharded by \`bucket_id\`, so a 2-billion-object bucket lives on one shard. All its PUT/GET/LIST traffic hits one node.
- **LIST timeout:** listing uses \`LIKE 'prefix%' ORDER BY name OFFSET n LIMIT 1000\`. OFFSET must skip n rows each page, so page 10,000 scans 10M rows; with versioning, each key has many version rows; if the index is not in C/\`text_pattern_ops\` collation, LIKE cannot even use it.

### Redesign
1. **Point operations** (GET/PUT/DELETE/HEAD by name — 95%+ of traffic): shard by **hash(bucket, key)** → even load; one-shard lookups.
2. **Listing**: a separate, asynchronously maintained **listing index** ordered by (bucket, key). Either sharded by bucket (book's approach — acceptable because listing is rarely latency-critical) or, better at this scale, **range-partitioned** by (bucket, key) with automatic split of hot ranges (how S3 and FoundationDB/Spanner-like stores do it). Range partitions make "prefix scan from cursor" a contiguous read on one or a few partitions.
3. **Keyset pagination**: continuation token = last key returned (encrypted/opaque), query \`key > token\`. Constant cost per page. Delimiter roll-up: when you hit a common prefix, jump the cursor past \`prefix + '/' + 0xFF\` to skip the whole "folder".
4. **Versions**: keep a "current version" row/flag so LIST doesn't scan historical versions; ListObjectVersions uses a separate path.
5. **Consistency**: write the listing index in the same transaction (if co-located) or via an ordered change stream; if async, document eventual listing or read-repair from the primary index.

### Operational
Detect hot ranges from per-partition QPS, split automatically; publish per-prefix limits and advise clients to spread high-rate writes across prefixes.`,
      followUps: [
        {
          q: 'Why not just shard by object_id?',
          a: 'Load is even, but requests arrive by name, so every GET by URI would need a global name → id index (which is the same sharding problem again) or scatter-gather to all shards.',
        },
        {
          q: 'With hash sharding, how would you do LIST without a secondary index?',
          a: 'Scatter-gather to all shards, merge-sort results and encode a per-shard offset/last-key in the cursor. It works but costs O(shards) per page and the cursor grows with shard count — that is why a dedicated ordered listing index is preferred.',
        },
      ],
      pitfalls: [
        'Adding read replicas to fix a write-hot shard',
        'Using OFFSET pagination at billions of rows',
        'Assuming prefixes are real directories with their own storage',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'object-storage-boe-1',
      question:
        'You must store 100 PB of usable data. Compare the number of 20 TB HDDs and the drive capex for 3× replication vs 8+4 erasure coding.',
      assumptions: [
        '20 TB HDDs, filled to at most 80% (headroom for rebalancing and repair) → 16 TB usable per drive',
        'Drive cost ≈ $15 per TB raw (≈ $300 per drive)',
        '3× replication = 3.0× raw; 8+4 EC = 12/8 = 1.5× raw',
        'Ignore servers, racks, power (they scale roughly with drive count)',
      ],
      steps: [
        { label: 'Raw bytes, replication', calc: '100 PB × 3 = 300 PB raw' },
        { label: 'Raw bytes, 8+4 EC', calc: '100 PB × 1.5 = 150 PB raw' },
        { label: 'Drives, replication', calc: '300 PB ÷ 16 TB = 300,000 TB ÷ 16 ≈ 18,750 drives' },
        { label: 'Drives, EC', calc: '150,000 TB ÷ 16 ≈ 9,375 drives' },
        { label: 'Drive capex', calc: 'replication 18,750 × $300 ≈ $5.6M; EC 9,375 × $300 ≈ $2.8M' },
        { label: 'Annual drive failures (0.81% AFR)', calc: 'replication ≈ 152/yr (~3/week); EC ≈ 76/yr' },
        {
          label: 'Repair traffic per failed drive',
          calc: 'replication: copy 16 TB from surviving replicas; EC: read 8 chunks per lost chunk ≈ 8 × 16 TB = 128 TB of reads',
        },
      ],
      answer:
        'Replication needs ~18,750 drives (~$5.6M), 8+4 EC ~9,375 drives (~$2.8M) — EC halves hardware while raising durability from ~6 to ~11 nines, but each drive repair reads ~8× more data across the network.',
      insight:
        'The 2× hardware saving is why every hyperscale object store erasure-codes cold data. The cost moves to the network and CPU: you must provision repair bandwidth (a 128 TB rebuild at 10 Gbps aggregate is ~28 h), keep hot/small data replicated, and model durability with realistic repair times.',
      followUps: [
        {
          "q": "The procurement team switches to 30 TB drives (24 TB usable at 80%). What happens to drive count and to EC repair time?",
          "a": "EC drive count falls to 150,000 TB ÷ 24 TB = 6,250 drives (from 9,375), but each failed drive now needs 8 × 24 = 192 TB of repair reads. At the same 10 Gbps aggregate repair bandwidth that is 192 × 10^12 × 8 ÷ 10^10 ≈ 153,600 s ≈ 43 hours, up from about 28. A longer window of reduced redundancy lowers durability, and fewer, larger drives concentrate risk. So bigger drives require proportionally more repair bandwidth (spread repair across many nodes), or a code with cheaper repair such as LRC."
        },
        {
          "q": "Someone proposes 16+4 erasure coding to save more. Quantify the saving and what you give up.",
          "a": "16+4 has 1.25× overhead: 125 PB raw ÷ 16 TB ≈ 7,813 drives versus 9,375 for 8+4, saving about 1,560 drives (about $470K at $300 each). You give up: fault tolerance per stripe stays at 4 losses but is spread across 20 failure domains, so you need at least 20 racks or AZ-rack groups. Each repair reads 16 chunks (2× the 8+4 network traffic). A normal read fans out to 16 nodes, which worsens tail latency. Smaller chunks per object also raise per-chunk metadata. It is usually only worth it for very cold, large-object archives."
        }
      ],
    },
    {
      id: 'object-storage-boe-2',
      question:
        'A video platform ingests 500K uploads per day averaging 5 minutes each. Estimate daily storage growth (originals + ABR renditions) and the transcoding fleet size.',
      assumptions: [
        'Source bitrate ≈ 8 Mbps average',
        'ABR ladder: 1080p 5 + 720p 3 + 480p 1.5 + 360p 0.8 + 240p 0.4 Mbps + audio ≈ 10.8 Mbps total',
        'x264 "medium" encodes ~1× realtime per rendition per 4 vCPUs at 1080p; average across ladder ≈ 2 vCPU per realtime rendition',
        'Peak ingest = 2× average',
      ],
      steps: [
        { label: 'Original size per video', calc: '8 Mbps × 300 s = 2,400 Mb = 300 MB' },
        { label: 'Originals per day', calc: '500K × 300 MB = 150 TB/day' },
        { label: 'Renditions per video', calc: '10.8 Mbps × 300 s ÷ 8 ≈ 405 MB' },
        { label: 'Renditions per day', calc: '500K × 405 MB ≈ 200 TB/day' },
        { label: 'Total growth', calc: '≈ 350 TB/day ≈ 128 PB/year' },
        { label: 'Encode work', calc: '500K × 5 min × 5 renditions = 12.5M rendition-minutes/day' },
        { label: 'Steady vCPUs', calc: '12.5M min × 2 vCPU ÷ 1,440 min/day ≈ 17,400 vCPUs; peak ×2 ≈ 35K vCPUs' },
      ],
      answer:
        '~350 TB/day (~128 PB/year) of new storage, more than half of it renditions, and a transcoding fleet of ~17K vCPUs average (~35K at peak).',
      insight:
        'Renditions outweigh originals, so tier originals to Glacier/Deep Archive right after transcoding (300 MB × 500K at ~$1/TB-month instead of $23), use per-title encoding, and lazily generate top renditions for long-tail videos. The CPU number justifies spot instances with a queue-driven, chunk-parallel, idempotent pipeline (or GPU/ASIC encoders).',
      followUps: [
        {
          "q": "Finance asks what one year of originals costs if kept in S3 Standard versus moved to Deep Archive after transcoding.",
          "a": "One year of originals is 150 TB/day × 365 ≈ 54.75 PB. In Standard at about $23/TB-month that is roughly 54,750 × $23 ≈ $1.26M per month by year end; in Deep Archive at about $1/TB-month, about $55K per month, more than 20× cheaper. The catches: Deep Archive retrieval takes 12–48 hours and costs per GB, so re-transcoding (a new codec like AV1, or a creator's edit) becomes a planned batch job. Each object also carries about 40 KB of metadata overhead and a 180-day minimum, so only move the originals that are final."
        },
        {
          "q": "80% of videos get fewer than 10 views. How much storage do you save per day by generating the 1080p rendition lazily for those?",
          "a": "1080p is 5 of the 10.8 Mbps ladder, about 46% of rendition bytes. Skipping it for 80% of videos saves 200 TB × 0.8 × 5/10.8 ≈ 74 TB/day, cutting total growth from about 350 to about 276 TB/day. The encode saving is larger than the byte share, because 1080p costs about 4 vCPU per realtime minute against the 2 vCPU average. The trade-off: when a long-tail video suddenly goes viral, the first viewers get 720p while a priority transcode job runs. Trigger it on a view-count threshold (for example 50 views in an hour)."
        }
      ],
    },
    {
      id: 'object-storage-boe-3',
      question:
        'A 2 GB game patch ships to 10 M players within 48 hours of release. Estimate delivery bandwidth, origin load with a CDN, and egress cost direct-from-S3 vs CDN.',
      assumptions: [
        '10 M players download the full 2 GB once (plus ~10% retries/resumes via range requests)',
        'Traffic concentrated: peak hour carries 3× the 48-hour average',
        'CDN with origin shield; ~300 PoPs; edge hit ratio ~99% by bytes',
        'S3 internet egress ≈ $0.05/GB at this volume tier; negotiated CDN ≈ $0.01–0.02/GB',
      ],
      steps: [
        { label: 'Total bytes', calc: '10M × 2 GB × 1.1 ≈ 22 PB' },
        { label: 'Average throughput', calc: '22 × 10^15 B ÷ 172,800 s ≈ 127 GB/s ≈ 1.0 Tbps' },
        { label: 'Peak throughput', calc: '≈ 3 Tbps at the edge' },
        { label: 'Origin load with shield', calc: '~1% miss ≈ 30 Gbps peak worst case; ideally ≈ 300 PoPs × 2 GB ≈ 0.6 TB total fills' },
        { label: 'Egress direct from S3', calc: '22M GB × $0.05 ≈ $1.1M (and ~3 Tbps from one bucket/region is unrealistic)' },
        { label: 'Egress via CDN', calc: '22M GB × $0.015 ≈ $330K; S3 → CloudFront transfer free' },
      ],
      answer:
        '~22 PB over 48 h, ~1 Tbps average and ~3 Tbps peak. A CDN with origin shield reduces origin to tens of Gbps at worst (sub-TB of fills ideally) and cuts egress cost from ~$1.1M to ~$0.3M.',
      insight:
        'At launch-day scale the CDN is not an optimisation but the only feasible path: pre-warm/pre-position the patch, use immutable versioned keys, support range requests for resumable downloads, and consider delta patches (ship only changed chunks via content-defined chunking) — which can cut bytes by 5–10×.',
      followUps: [
        {
          "q": "The patch goes live before the CDN is pre-warmed, and the edge hit ratio is 90% for the first hour. Can the S3 origin survive?",
          "a": "At 3 Tbps peak, a 10% miss rate sends about 300 Gbps (37.5 GB/s) to origin. With 8 MB range requests that is about 4,700 GETs per second, close to S3's 5,500 GET/s per-prefix guidance, all on one object key. Expect 503 SlowDown and retries that make it worse. Mitigations: an origin shield so each PoP region misses only once; request collapsing at the shield (one origin fetch per range); replicate the patch to several prefixes or buckets and spread them; and pre-warm the CDN by fetching from each region before the release announcement."
        },
        {
          "q": "Engineering ships delta patches that cut average download size 5×. Redo the key numbers.",
          "a": "Total bytes fall from about 22 PB to 4.4 PB, the average from about 1.0 to about 0.2 Tbps, and the peak from about 3 to about 0.6 Tbps. CDN egress at $0.015/GB drops from about $330K to about $66K. The new costs: deltas depend on what version a client has, so you either serve many delta files (one per source version) or use content-defined chunks that clients diff locally. The cache key space grows and hit ratios for rare versions are lower. Keep a full-download fallback for clients that are too old or have a corrupt local state."
        }
      ],
    },
  ],
  test: [
    {
      id: 'object-storage-mcq-01',
      difficulty: 'hard',
      question:
        'After migrating a bucket of 20 KB product thumbnails from 3× replication to 8+4 erasure coding, average GET latency is unchanged but p99 doubled. What is the most likely cause?',
      options: [
        'Each GET now needs chunks from at least 8 nodes, so latency is the slowest of 8 parallel reads',
        'Parity computation on every read is CPU-bound and saturates the data nodes',
        'Erasure-coded objects cannot be cached by the CDN because their ETag changes',
        'The metadata shard for the bucket became hot because EC stores 12 metadata rows per object',
      ],
      correct: [0],
      explanation:
        'In normal operation EC reconstructs from 8 data chunks, so every read fans out and its tail is governed by the slowest of 8 nodes — a classic tail-latency amplification that hurts small hot objects most. Parity decoding is only needed on degraded reads and is cheap with ISA-L. ETags are logical and independent of the storage layout, and chunk locations live in data-node placement, not 12 user-visible metadata rows. Fixes: hedged reads or keep small hot objects replicated.',
      followUps: [
        {
          "q": "You add hedged reads: after the p95 latency, request a 9th chunk (a parity chunk) and use the first 8 that arrive. What does it cost and when does it stop helping?",
          "a": "Any 8 of the 12 chunks reconstruct the object, so racing a 9th chunk removes the slowest node from the critical path. Firing the hedge only after the p95 wait limits the extra load to about 5% more chunk reads, plus decode CPU (cheap with ISA-L) when a parity chunk wins. It stops helping when the slowness is shared, not per node: a congested top-of-rack switch, a hot AZ, or overloaded front ends. Then every chunk is slow and hedging adds load. Cap hedges with a token budget (say 10% of reads) so they can't amplify a broad brownout."
        },
        {
          "q": "Product insists these thumbnails stay erasure-coded for cost. What storage-layout change keeps EC but fixes small-object tail latency?",
          "a": "Pack small objects together before encoding. Batch many 20 KB thumbnails into a multi-MB append-only volume, then erasure-code the whole volume as stripes. A single thumbnail now usually lives inside one data chunk on one node, so a normal read is a single-node range read with no 8-way fan-out. Parity is only touched on degraded reads. This is the f4/Haystack-style approach. The costs: deletes become tombstones that need compaction, and recently written objects stay replicated until their volume seals and is encoded."
        }
      ],
    },
    {
      id: 'object-storage-mcq-02',
      difficulty: 'expert',
      question:
        'Finance finds 40 TB of billed storage in a bucket whose ListObjectsV2 total is 6 TB. Versioning is OFF. Select ALL that could explain the gap.',
      options: [
        'Incomplete multipart uploads whose parts are billed but not returned by ListObjects',
        'Objects in Glacier Flexible Retrieval that ListObjects hides until restored',
        'Tens of millions of small objects in Standard-IA billed at the 128 KB minimum object size',
        'Parts from abandoned uploads that S3 automatically discards after 24 hours',
        'Delete markers retaining previous object data',
      ],
      correct: [0, 2],
      explanation:
        'Parts of multipart uploads that were never completed or aborted are stored and billed but invisible to ListObjects (use ListMultipartUploads and an AbortIncompleteMultipartUpload lifecycle rule). Standard-IA bills each object as at least 128 KB, so millions of tiny objects inflate billed size far beyond their real bytes. Glacier objects still appear in listings, S3 never auto-discards parts without a lifecycle rule, and delete markers only exist with versioning enabled.',
      followUps: [
        {
          "q": "The bucket has 3 billion objects. How do you find and size each cause without calling ListObjects on everything?",
          "a": "Turn on S3 Inventory (daily Parquet) and query it with Athena: `GROUP BY storage_class` with a `size < 131072` filter shows how many IA objects pay the 128 KB minimum. CloudWatch `BucketSizeBytes` broken down by `StorageType` (StandardStorage, StandardIAStorage, StandardIASizeOverhead) shows the IA rounding overhead directly. For multipart, Storage Lens has an 'incomplete multipart upload bytes' metric, and `ListMultipartUploads` gives the upload IDs and initiation dates. Then fix both: an `AbortIncompleteMultipartUpload` rule (7 days) and compaction for tiny IA objects."
        }
      ],
    },
    {
      id: 'object-storage-mcq-03',
      difficulty: 'medium',
      question: 'This uploader runs against a 2 GiB file. What happens?',
      code: {
        language: 'typescript',
        code: `const PART = 1024 * 1024;                       // 1 MiB
const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket, Key }));
const parts = [];
for (let n = 1; (n - 1) * PART < size; n++) {
  const body = await readChunk(path, (n - 1) * PART, PART);
  const r = await s3.send(new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: n, Body: body }));
  parts.push({ PartNumber: n, ETag: r.ETag });
}
await s3.send(new CompleteMultipartUploadCommand({
  Bucket, Key, UploadId, MultipartUpload: { Parts: parts },
}));`,
      },
      options: [
        'The first UploadPart call is rejected because parts must be at least 5 MiB',
        'All 2,048 parts upload successfully, then CompleteMultipartUpload fails with EntityTooSmall',
        'The upload succeeds because only the total object size must exceed 5 MiB',
        'It fails at part 1,001 because a multipart upload is limited to 1,000 parts',
      ],
      correct: [1],
      explanation:
        'S3 accepts each UploadPart individually; the 5 MiB minimum (for every part except the last) is enforced when CompleteMultipartUpload assembles the object, which returns EntityTooSmall. 2,048 parts is within the 10,000-part limit — 1,000 is the page size of ListParts, not the part cap. The whole object size being large does not waive the per-part minimum.',
      followUps: [
        {
          "q": "You fix the part size to 8 MiB. What is now the largest file this uploader can handle, and how would you make it work for a 200 GiB file?",
          "a": "S3 allows at most 10,000 parts, so a fixed 8 MiB part caps the object at 8 MiB × 10,000 ≈ 78 GiB. Derive the part size from the file size instead: `partSize = max(8 MiB, ceil(size / 10,000))` rounded up to a MiB, which gives about 21 MiB parts for 200 GiB. Parts may be up to 5 GiB and objects up to 5 TiB. Memory in flight is roughly concurrency × part size, so 8 workers × 21 MiB ≈ 168 MiB. Pick the concurrency to fit the container's limit."
        }
      ],
    },
    {
      id: 'object-storage-mcq-04',
      difficulty: 'hard',
      question:
        'A NestJS pod on EKS (IRSA role, 1-hour session credentials) generates download links with the code below. Customers report links in emails "randomly" expire long before 7 days. Why?',
      code: {
        language: 'typescript',
        code: `const url = await getSignedUrl(
  s3,
  new GetObjectCommand({ Bucket: 'invoices', Key: key }),
  { expiresIn: 7 * 24 * 3600 },   // 7 days, the SigV4 maximum
);
await mailer.send(user.email, 'Your invoice', url);`,
      },
      options: [
        'Customers\' mail scanners pre-fetch the URL and presigned URLs are single-use',
        'The URL embeds temporary STS credentials, so it stops working when that session token expires, which is far earlier than 7 days',
        'CloudFront caches the 403 from the first click and serves it to later clicks',
        'SigV4 presigned URLs are capped at 12 hours regardless of expiresIn',
      ],
      correct: [1],
      explanation:
        'A presigned URL is only valid until the earlier of its expiry and the expiry of the credentials that signed it; role/STS credentials include a session token that typically lasts about an hour, so links die when it does. Presigned URLs are not single-use, there is no CloudFront in this path, and SigV4 does allow up to 7 days — but only with long-lived credentials. Fix: link to your app, which authorises and issues a fresh short-lived URL on click.',
      followUps: [
        {
          "q": "You switch to 'link to the app, presign on click'. Now the security team asks: what stops a customer forwarding that fresh URL to someone else?",
          "a": "Nothing, while it is valid: a presigned URL is a bearer token. Shrink the window instead: issue it with `expiresIn` of 60–300 seconds right after an authenticated click and redirect immediately, so a forwarded link usually dies before it is used. For higher sensitivity, stream through a CDN with signed cookies bound to the session and short TTLs, or add a `Content-Disposition: attachment` and watermark the content per user so leaks can be traced. Log `presign` events with user ID and key, and correlate them with S3 server access logs to spot one URL fetched from many IPs."
        }
      ],
    },
    {
      id: 'object-storage-mcq-05',
      difficulty: 'expert',
      question:
        'A team "deleted" 50 TB of old exports from a versioning-enabled bucket with aws s3 rm --recursive. GETs now return 404, but next month\'s bill is unchanged. What is the correct remediation?',
      options: [
        'Suspend versioning on the bucket, which purges existing noncurrent versions',
        'Add a lifecycle rule with NoncurrentVersionExpiration (and expired delete-marker cleanup) for that prefix',
        'Re-run the deletion with --force so S3 bypasses the delete markers',
        'Wait: S3 garbage-collects deleted objects after the 30-day retention window',
      ],
      correct: [1],
      explanation:
        'Deleting without a version id in a versioned bucket inserts a delete marker that becomes the current version (hence 404), while every previous version remains stored and billed. Removing them requires deleting specific version ids or a NoncurrentVersionExpiration lifecycle rule, plus ExpiredObjectDeleteMarker cleanup. Suspending versioning only stops creating new versions — it does not delete existing ones; there is no --force that bypasses markers and no automatic 30-day purge.',
      followUps: [
        {
          "q": "You add the lifecycle rule. Within a day, someone asks to restore a file from that prefix that was deleted by mistake. Is it still possible, and how do you prevent this tension next time?",
          "a": "Yes, until lifecycle runs: lifecycle rules apply asynchronously, usually within a day or two of becoming eligible. Delete the delete marker (a DELETE with the marker's version ID) and the previous version becomes current again. Next time, set `NoncurrentDays: 30` (or whatever the recovery window is) instead of 1, so mistaken deletes stay recoverable for a month and are then purged. Use `NewerNoncurrentVersions` to keep, for example, the last 3 versions. For critical data, add Object Lock or cross-account replication so an `rm --recursive` can't destroy everything."
        }
      ],
    },
    {
      id: 'object-storage-mcq-06',
      difficulty: 'expert',
      question:
        'Your object store shards the object-metadata table by hash(bucket_name, object_name). GET/PUT are fast, but LIST with a prefix is slow and pagination bugs keep appearing. What is the design most S3-like systems converge on?',
      options: [
        'Re-shard the object table by bucket_id so every listing is single-shard',
        'Keep hash sharding for point operations and maintain a separate listing index ordered by (bucket, key), paginated with a last-key cursor',
        'Cache every listing result in Redis for 24 hours keyed by prefix',
        'Switch to sharding by object_id (UUID) so load is perfectly even',
      ],
      correct: [1],
      explanation:
        'Point operations arrive by name, so hashing (bucket, key) spreads them evenly; listing needs ordered prefix scans, which a separate bucket-/range-partitioned listing index serves with constant-cost keyset cursors. Sharding everything by bucket recreates hot shards for billion-object buckets, a 24-hour listing cache breaks read-after-write expectations, and object_id sharding makes name lookups scatter-gather.',
      followUps: [
        {
          "q": "The listing index and the object table are separate stores. A PUT updates the object table but the node crashes before the listing index is updated. How do you keep them consistent?",
          "a": "Make the object table the source of truth and treat the listing index as derived. Write the object row and an outbox/change-log entry in one transaction on that shard; an asynchronous indexer applies the log to the listing index idempotently, keyed by (bucket, key, version), so replays are harmless. After a crash, the indexer resumes from its log offset. If LIST must be strongly consistent (S3 has been since 2020), the PUT is not acknowledged until the index entry is committed, which is effectively a two-shard write with a coordinator. A periodic reconciler compares the two and repairs drift."
        }
      ],
    },
    {
      id: 'object-storage-mcq-07',
      difficulty: 'expert',
      question: 'A file-sync product adds this "instant upload" optimisation. What is its most serious flaw?',
      code: {
        language: 'typescript',
        code: `// Client sends the hash first; if we already have the blob, skip the upload.
@Post('files/precheck')
async precheck(@Req() req, @Body() b: { sha256: string; name: string }) {
  const blob = await this.blobs.findByHash(b.sha256);        // global, all tenants
  if (blob) {
    await this.files.create({ owner: req.user.id, name: b.name, blobId: blob.id });
    return { uploaded: true };                               // user now owns the file
  }
  return { uploaded: false, uploadUrl: await this.presign(b.sha256) };
}`,
      },
      options: [
        'SHA-256 collisions will cause two different files to share a blob',
        'Anyone who learns a file\'s hash can obtain the full file, and the endpoint reveals whether any tenant stores a given file',
        'Dedup prevents the CDN from caching files because keys are hashes',
        'Hash computation on the client is too slow for large files, so uploads get slower',
      ],
      correct: [1],
      explanation:
        'Client-side, cross-tenant dedup trusts a hash as proof of possession: a hash leaked in a log or share link lets an attacker "upload" and then download the file, and the response is an existence oracle across tenants (Dropbox faced exactly this attack class). SHA-256 collisions are not practical, hash-named keys are ideal for CDN caching, and hashing speed is a UX cost, not a security flaw. Fix: dedup server-side after receiving bytes, or scope dedup per tenant, or require proof-of-ownership challenges.',
      followUps: [
        {
          "q": "Product won't give up the bandwidth savings of dedup. How do you keep dedup but close the hole?",
          "a": "Use proof of ownership: when a client claims hash H, the server picks random byte ranges (for example 3 × 64 KB at random offsets) and asks the client to send them, or their hashes with a server nonce. Only someone holding the actual file can answer. Combine this with scoping: dedup within a tenant without a challenge, and across tenants only after the challenge. To kill the existence oracle, return the same response and similar timing whether or not the blob exists, and let the client upload anyway. The server can drop duplicate bytes quietly on its side."
        }
      ],
    },
    {
      id: 'object-storage-mcq-08',
      difficulty: 'medium',
      question:
        'User avatars are served by a NestJS endpoint that streams them from S3. At 30K req/s, pods are CPU- and network-bound. What is the best fix?',
      options: [
        'Add an in-process LRU cache of avatar bytes in every pod',
        'Return 302 redirects to per-request presigned S3 GET URLs',
        'Serve through a CDN from a private bucket via OAC, using content-hashed immutable keys and year-long Cache-Control',
        'Move avatars into a Postgres bytea column with a read replica',
      ],
      correct: [2],
      explanation:
        'A CDN with immutable, content-versioned keys offloads ~99% of requests at the edge with ~10–30 ms latency and removes the pods from the byte path entirely. Per-pod LRUs still burn pod bandwidth and fragment the cache; per-request presigned URLs are unique so they cannot be cached and every hit goes to S3; storing blobs in Postgres makes the database the bottleneck.',
      followUps: [
        {
          "q": "A user updates their avatar but keeps seeing the old one for hours. With year-long immutable caching, how does the change ever show up?",
          "a": "The key changes, not the cached object. The new avatar gets a new content-hashed key (`avatars/{user}/{hash}.webp`), and the user's profile row points to the new URL. Every page that renders the avatar reads the URL from the API, so it fetches a new object and never has to invalidate the old one. If the user still sees the old one, the stale layer is whatever caches the *URL*: an API response cache, a client-side profile cache or an HTML page cache. Shorten that TTL or bust it on profile update, and never use mutable keys like `avatars/{user}.jpg` with long TTLs."
        }
      ],
    },
    {
      id: 'object-storage-mcq-09',
      difficulty: 'expert',
      question:
        'You protect premium HLS videos served through a CDN. Edge hit ratio is 3% and origin costs are exploding. Select ALL changes that fix it without weakening access control.',
      options: [
        'Replace per-segment S3 presigned URLs with CDN signed cookies using a wildcard policy on /videos/{id}/*',
        'Exclude auth query-string parameters and cookies from the CDN cache key while still validating them at the edge',
        'Set Cache-Control: no-store on segments so each viewer gets a fresh authorised copy',
        'Keep segments immutable with long TTLs and give only live manifests a short TTL',
        'Forward the viewer\'s Authorization header to the origin so S3 can authorise each segment',
      ],
      correct: [0, 1, 3],
      explanation:
        'Per-viewer signatures in the URL or forwarded auth headers make every request unique to the cache, so hit ratio collapses. Signed cookies/URLs validated at the edge authorise the viewer while the cache key stays the plain segment path; immutable segments with long TTLs (short TTL only for live manifests) maximise hits. no-store and forwarding Authorization to origin both force every request to origin.',
      followUps: [
        {
          "q": "A subscriber shares their signed cookie and 500 people watch on it. How do you detect and limit this while keeping the high hit ratio?",
          "a": "Keep cookies short-lived (for example 10 minutes) and refresh them from the player through an authenticated API. A shared cookie then dies quickly unless the sharer keeps refreshing it. At the refresh endpoint, enforce a concurrent-stream limit per account (say 4 active sessions, tracked in Redis with heartbeats). At the edge, log the cookie or session ID with client IPs and alert when one session is seen from many ASNs or countries. None of this touches the cache key: validation happens at the edge, and segments stay shared cache objects."
        }
      ],
    },
    {
      id: 'object-storage-mcq-10',
      difficulty: 'hard',
      question:
        'Mobile uploads of 3 GB videos via a single presigned PUT fail about 30% of the time, usually late in the transfer. Which change addresses the root cause?',
      options: [
        'Increase the presigned URL expiry and the client socket timeout to 2 hours',
        'Retry the PUT with exponential backoff and jitter up to 5 times',
        'Switch to multipart (or tus) with persisted resume state so the client re-sends only missing parts after a failure',
        'Gzip the video before upload to reduce transfer time',
      ],
      correct: [2],
      explanation:
        'The failure mode is a long transfer that has no durable partial progress, so any network interruption loses everything; chunked, resumable uploads make each failure cost one part. Longer timeouts and backoff retries still require an uninterrupted multi-minute transfer and restart from zero. Video is already compressed, so gzip barely reduces size and adds CPU.',
      followUps: [
        {
          "q": "iOS suspends the app 30 seconds after the user switches away, and most uploads happen in the background. How does the multipart design change?",
          "a": "In-process JavaScript loops stop when the app is suspended, so hand the transfers to the OS. Before going to the background, the app gets presigned URLs for all remaining parts and queues one background `URLSession` upload task per part, from files on disk (background sessions require file-based uploads). The OS runs them even while the app is suspended and relaunches the app to report results. On relaunch, the app records the ETags (or calls ListParts on the server) and then sends CompleteMultipartUpload through the API. Presign the URLs with a lifetime long enough to cover a slow background transfer, for example a few hours."
        }
      ],
    },
    {
      id: 'object-storage-mcq-11',
      difficulty: 'expert',
      question:
        'After a multipart upload (SSE-S3 encryption, no KMS), this integrity check always fails even though the file is intact. Why?',
      code: {
        language: 'typescript',
        code: `const localMd5 = createHash('md5').update(await readFileStream(path)).digest('hex');
const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
// head.ETag === '"9b2cf535f27731c974343645a3985328-160"'
if (head.ETag!.replace(/"/g, '') !== localMd5) {
  throw new Error('corrupted upload');
}`,
      },
      options: [
        'SSE-S3 encrypts the object, so the ETag is the MD5 of the ciphertext',
        'The multipart ETag is the MD5 of the concatenated binary part MD5s followed by -<partCount>, not the MD5 of the whole file',
        'HeadObject returns a weak ETag; only GetObject returns the real MD5',
        'The ETag is the MD5 of the last part uploaded, suffixed with the part count',
      ],
      correct: [1],
      explanation:
        'For multipart objects S3 computes MD5(md5(part1) || md5(part2) || ... ) and appends "-N" (here 160 parts), so it can never equal a whole-file MD5. For SSE-S3 single-part objects the ETag is the plaintext MD5, so encryption is not the cause here (SSE-KMS/SSE-C differ). HeadObject and GetObject return the same ETag. Verify by recomputing the multipart ETag with the same part size, or use per-part CRC32C/SHA-256 additional checksums.',
      followUps: [
        {
          "q": "You need end-to-end integrity: the bytes that land in S3 must equal the file on the backup host. Design it without relying on ETags.",
          "a": "Use S3's additional checksums. Create the multipart upload with `ChecksumAlgorithm: 'CRC32C'` (or SHA256), send each part's checksum with UploadPart, and S3 rejects any part whose bytes don't match. On Complete, S3 stores a composite checksum over the part checksums. Locally, compute the same per-part CRC32C while reading the file, build the composite value, and compare it with `GetObjectAttributes` (Checksum and ObjectParts). For a whole-file check that doesn't depend on the part layout, newer SDKs support full-object CRC64NVME. Store your own SHA-256 in object metadata for verification at restore time."
        }
      ],
    },
    {
      id: 'object-storage-mcq-12',
      difficulty: 'hard',
      question:
        'A self-built photo store writes each thumbnail (avg 6 KB) as its own file on XFS. At 3 billion files, writes stall and ls-style lookups are slow although disks are only 40% full. What is the underlying problem and standard fix?',
      options: [
        'Disk bandwidth is exhausted; switch to faster NVMe drives',
        'Per-file metadata (inodes, directory entries) no longer fits in memory and dominates IO; pack objects into large append-only volume files with an in-memory or per-node index',
        'XFS cannot address more than 2^32 files; migrate to ext4',
        'Thumbnails should be erasure-coded to reduce per-file overhead',
      ],
      correct: [1],
      explanation:
        'With billions of tiny files, inode/dentry metadata overwhelms the page cache, so each read or write costs extra seeks just to find the file, and small files waste partial blocks. Haystack and Alex Xu\'s data node design append many objects into multi-GB files and keep a compact (object_id → file, offset, size) index. Bandwidth is not the constraint at 40% utilisation, XFS has 64-bit inodes, and erasure-coding 6 KB files increases overhead.',
      followUps: [
        {
          "q": "With objects packed into volume files, users delete 20% of photos each year. How do you reclaim space, and what can go wrong during compaction?",
          "a": "A delete only writes a tombstone to the index; the bytes stay in the volume. A background compactor picks volumes with garbage above a threshold (for example 30%), copies the live needles into a new volume, atomically swaps the index entries to the new offsets, then deletes the old file. Risks: a read racing the swap must still find the old file, so keep it until in-flight reads drain; compaction IO competes with foreground traffic, so throttle it; and a crash mid-compaction must be safe to restart, so write the new volume and index fully before flipping a single pointer."
        }
      ],
    },
    {
      id: 'object-storage-mcq-13',
      difficulty: 'hard',
      question:
        'To cut write latency, a data node acks the client as soon as the primary persists the object, then replicates asynchronously. Which failure now loses data that the client was told is durable?',
      options: [
        'A secondary crashes while the primary is healthy',
        'The primary\'s disk fails after the ack but before replication to any secondary completes',
        'The placement service loses Raft quorum during the write',
        'The metadata row is written before the data node acks',
      ],
      correct: [1],
      explanation:
        'Acking after only the primary persists means, for a window, exactly one copy exists; losing that disk or node before async replication finishes loses an acknowledged write. A secondary crash is survivable because the primary still has the data and can re-replicate; a placement quorum loss blocks new placements rather than losing acked data; and the metadata ordering described is a different (dangling pointer) bug, not a consequence of the ack policy.',
      followUps: [
        {
          "q": "The team still wants lower PUT latency than synchronous 3-way replication. What durable middle ground can you offer?",
          "a": "Ack after 2 of 3 replicas have persisted (a write quorum), placed in different failure domains such as two AZs, and let the third replica catch up asynchronously. An acknowledged write then survives any single disk or node loss, and latency is the second-fastest replica rather than the slowest. Measure the gap: the p99 of the 2nd replica is often close to the 1st within a region. Add a repair scanner that finds objects below 3 copies and re-replicates them. Never ack from page cache: a replica counts only after fsync or a write to a battery-backed cache."
        }
      ],
    },
    {
      id: 'object-storage-mcq-14',
      difficulty: 'medium',
      question:
        'To save money, a team adds a lifecycle rule moving 400 M log objects (avg 8 KB) from Standard to Standard-IA after 30 days, explicitly overriding the default size filter with ObjectSizeGreaterThan: 1. What happens to the bill?',
      options: [
        'It drops roughly 45% because IA is about $0.0125/GB vs $0.023/GB',
        'It likely rises: each object is billed at the 128 KB IA minimum and every transition is a per-object request charge',
        'It is unchanged because IA and Standard charge the same per-GB rate for objects under 128 KB',
        'It drops but retrievals become impossible until objects are restored',
      ],
      correct: [1],
      explanation:
        '8 KB objects billed as 128 KB in IA cost ~16× more bytes at ~0.54× the rate — a net increase — and 400 M transitions incur per-request charges. (This is why S3 lifecycle now skips objects under 128 KB by default; the team overrode that safeguard.) There is no special same-price rule for small objects, and IA objects are readable in milliseconds, no restore needed. The right fix is to compact logs into large bundles, then tier or expire them.',
      followUps: [
        {
          "q": "How would you redesign the log pipeline so tiering actually saves money on these 400 M small objects?",
          "a": "Compact before tiering. A daily job reads each hour's 8 KB log objects and writes one compressed Parquet or gzip bundle per hour and source, typically 100 MB–1 GB, then deletes the originals. 400 M objects become tens of thousands, so the 128 KB minimum, per-object transition fees and per-object metadata overhead all disappear, and compression usually cuts bytes 5–10×. Then lifecycle the bundles: Standard → IA at 30 days → Glacier Instant/Deep Archive at 90 days, expire at the retention limit. Better still, have producers batch at write time (Firehose buffering) so small objects never exist."
        }
      ],
    },
    {
      id: 'object-storage-mcq-15',
      difficulty: 'expert',
      question: 'Given this HLS master playlist for a VOD title, select ALL statements that are true.',
      code: {
        language: 'text',
        code: `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=5500000,RESOLUTION=1920x1080
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3300000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360
360p/index.m3u8`,
      },
      options: [
        'The player chooses a variant from measured throughput/buffer and can switch between variants at segment boundaries',
        'Seamless switching requires keyframes aligned at the same timestamps across all renditions',
        'The CDN transcodes to the requested BANDWIDTH on the fly when the player asks for a variant',
        'Shorter segments (2 s vs 6 s) speed up startup and adaptation at the cost of more requests and slightly worse compression',
        'HLS keeps a persistent WebSocket open to push segments to the player',
      ],
      correct: [0, 1, 3],
      explanation:
        'HLS is pull-based HTTP: the player reads the master playlist, estimates bandwidth and buffer health, and fetches segments from the chosen variant playlist, switching at segment boundaries — which only works cleanly if every rendition has IDR frames at identical timestamps (INDEPENDENT-SEGMENTS). Segment length trades startup/adaptation speed against request count and compression efficiency. The CDN only caches pre-transcoded segments, and there is no WebSocket push in HLS.',
      followUps: [
        {
          "q": "Viewers on a 2 Mbps mobile link see frequent quality flips and rebuffers on this ladder. What do you change server-side?",
          "a": "Add or reshape rungs around the struggling bandwidth. If the ladder jumps from 0.8 to 3 Mbps, a 2 Mbps link sits between rungs and oscillates; add a 1.5–2 Mbps rendition (or use per-title encoding to pick rungs from content complexity). Ensure the `BANDWIDTH` attribute reflects peak, not average, segment bitrate, so the player doesn't overestimate fit. Constrain VBV (`maxrate`/`bufsize`) so segment sizes are predictable. Check CDN segment latency for that region too: slow time-to-first-byte looks like low bandwidth to the ABR algorithm."
        }
      ],
    },
  ],
};

export default topic;
