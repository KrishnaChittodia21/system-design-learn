import type { Topic } from '../../types';

const topic: Topic = {
  id: 'fund-estimation',
  phase: 'fundamentals',
  order: 2,
  title: 'Capacity, Storage, Bandwidth & Peak Estimation',
  subtitle:
    'Back-of-the-envelope maths that drives real design decisions: DAU → QPS → peak, storage over 5 years with replication, ingress/egress, cache memory, and server counts.',
  estimatedMinutes: 90,
  sources: [
    'Alex Xu — System Design Interview Vol 1, Ch 2 (Back-of-the-envelope Estimation)',
    'Alex Xu — System Design Interview Vol 2 (estimation sections of Ch 1, 2, 6, 10)',
    'Jeff Dean / Peter Norvig — Latency Numbers Every Programmer Should Know',
  ],
  tags: ['estimation', 'capacity-planning', 'qps', 'storage', 'bandwidth', 'latency-numbers', 'interview'],
  cheatSheet: [
    'Arithmetic: write numbers as a × 10^n. Multiply → multiply fronts, add exponents; divide → subtract. 1M × 1 KB = 1 GB, 1B × 1 KB = 1 TB, 1B × 1 MB = 1 PB. Year ≈ π × 10^7 s.',
    '1 day = 86,400 s ≈ 10^5 s (Alex Xu trick, ~16% high on QPS — fine for sizing). 1M/day ≈ 12 QPS; 1B/day ≈ 12K QPS.',
    'Average QPS = DAU × actions/user/day ÷ 86,400. Peak = avg × 2–3 (diurnal), × 5–10+ for launches/sales. Size for peak, not average.',
    'Powers of two: 2^10 ≈ 1K, 2^20 ≈ 1M, 2^30 ≈ 1G, 2^40 ≈ 1T. Signed INT32 max ≈ 2.1B, UINT32 ≈ 4.3B → use BIGINT for anything that grows.',
    'Latency ladder: memory 100 ns → SSD random read ~20–150 µs → same-DC RTT ~0.5 ms → HDD seek ~10 ms → cross-continent RTT ~150 ms.',
    'Storage = writes/day × bytes × 365 × years × (replication 3 or EC ~1.5) × (index/metadata 1.2–2) — and compound growth, not linear.',
    'Bandwidth: bytes/s × 8 = bits/s. 1 Gbps = 125 MB/s; 10 Gbps = 1.25 GB/s. NICs, CDNs and cloud bills talk bits; disks talk bytes.',
    'Cache (80/20): cache ~20% of the daily-read working set; add ~50–100 B Redis overhead per key, ×1.2–1.5 fragmentation, keep maxmemory ≤ 75% RAM, ×2 for replicas.',
    'Servers = peak QPS × CPU-seconds per request ÷ (cores × target utilization 0.5–0.7). Then check AZ-failure headroom (N+1 / 1.5× over 3 AZs).',
    'Little\'s Law L = λ × W: concurrency (connections, in-flight requests, threads) = arrival rate × time-in-system. 5K RPS × 40 ms = 200 in-flight.',
    'Always name the dominant term (media vs text, egress vs storage, network vs memory) — that is the number that changes the architecture.',
  ],
  sections: [
    {
      heading: 'Why estimate at all — and the rules of the game',
      body: `**Intuition:** an estimate is a *design filter*, not an accounting exercise. You are trying to learn, in two minutes, whether a design needs one Postgres box or a sharded cluster, whether media needs a CDN, whether a cache fits in one Redis node. Being within **2–5×** of reality is good enough; being off by **100×** is what fails interviews and production launches.

**Rules strong candidates follow:**

- **State assumptions out loud and write them down** (DAU, actions/user, object size, read:write ratio, retention). Interviewers grade the reasoning, and a written assumption can be corrected cheaply.
- **Round aggressively to powers of ten.** 86,400 s/day ≈ **10^5**. 365 days ≈ 400 (or keep 365 when multiplying by 5 years → ~1,800 days). 2,592,000 s/month ≈ 2.5 × 10^6.
- **Label units on every line** (QPS, MB/s, Gbps, TB/day). Most estimation disasters are unit bugs: bits vs bytes, 1000 vs 1024, per-second vs per-day.
- **Separate read and write paths.** They scale differently and lead to different components (read replicas / caches vs partitioned write stores / queues).
- **Finish with the implication.** "~50K peak reads/s of 2 KB → 100 MB/s → a single Redis primary is borderline on network; plan 3–4 shards." A number without a decision is wasted airtime.

**In interviews, say this:** "Let me do a quick envelope so we know which components are forced on us — I'll round to powers of ten and we can adjust the inputs if you have different numbers." Then spend **3–5 minutes max** — Alex Xu's framework puts estimation inside step 1 (scope) precisely so it informs the high-level design rather than replacing it.`,
      diagram: `  ASSUMPTIONS            DERIVED LOAD              DESIGN IMPLICATION
 +-------------+      +-------------------+      +-------------------------+
 | DAU         |----->| avg QPS (÷10^5)   |----->| #app servers, LB tier   |
 | actions/day |      | peak QPS (×2..10) |      | autoscaling / queueing  |
 | read:write  |----->| read QPS / write  |----->| cache? replicas? shard? |
 | object size |----->| bytes/day, 5y TB  |----->| DB vs object store, EC  |
 | resp. size  |----->| egress Gbps       |----->| CDN, cost, NIC limits   |
 | latency     |----->| in-flight (L=λW)  |----->| pools, threads, conns   |
 +-------------+      +-------------------+      +-------------------------+`,
      keyPoints: [
        'Target accuracy: within 2–5×; the goal is to pick components, not to invoice.',
        'Write assumptions down, label units, split read vs write.',
        'Every number must end in a design decision.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 2; Vol 2 Ch 1 (Proximity Service estimation)',
    },
    {
      heading: 'Estimation arithmetic toolkit — doing the maths in your head',
      body: `**Intuition:** interview estimation is not hard maths; it is *bookkeeping*. If you write every number as **a × 10^n** and keep one significant figure, any calculation becomes "multiply two small numbers, add two exponents". Nobody expects a calculator; they expect you not to lose a factor of 1,000.

**Step 1 — write everything in scientific notation (one significant figure).**

| Say | Write | Symbol |
|---|---|---|
| thousand | 10^3 | K |
| million | 10^6 | M |
| billion | 10^9 | B (or G) |
| trillion | 10^12 | T |
| quadrillion | 10^15 | P |
| quintillion | 10^18 | E |

So 300 million users = **3 × 10^8**, 86,400 s = **8.64 × 10^4 ≈ 10^5**, 2 KB = **2 × 10^3 B**.

**Step 2 — multiply: multiply the front numbers, ADD the exponents.**

- (5 × 10^7) × (2 × 10^3) = (5 × 2) × 10^(7+3) = 10 × 10^10 = **10^11**
- 300M users × 2 KB = (3 × 10^8) × (2 × 10^3) = 6 × 10^11 B = **600 GB**

**Step 3 — divide: divide the front numbers, SUBTRACT the exponents.**

- 1B requests/day ÷ 10^5 s = 10^9 ÷ 10^5 = **10^4 = 10K QPS**
- 6 × 10^11 B ÷ (2 × 10^9 B per node) = 3 × 10^2 = **300 nodes**
- If the front number drops below 1, borrow a power: 2 × 10^6 ÷ 8 × 10^2 = 0.25 × 10^4 = **2.5 × 10^3**

**Step 4 — the byte ladder is just exponents in steps of 3.** B → KB (10^3) → MB (10^6) → GB (10^9) → TB (10^12) → PB (10^15). Two shortcuts carry most interviews:

- **1M items × 1 KB = 1 GB** (10^6 × 10^3 = 10^9)
- **1B items × 1 KB = 1 TB**, **1B × 1 MB = 1 PB**

**Step 5 — time constants to memorise.**

| Period | Seconds | Use as |
|---|---|---|
| 1 hour | 3,600 | ≈ 4 × 10^3 |
| 1 day | 86,400 | ≈ 10^5 (Alex Xu) |
| 1 month | ~2.6 × 10^6 | ≈ 2.5 × 10^6 |
| 1 year | ~3.15 × 10^7 | ≈ π × 10^7 ≈ 3 × 10^7 |

Handy conversions: **1M/day ≈ 12/s**, **1B/day ≈ 12K/s**, **1B/month ≈ 400/s**, **1 req/s all day ≈ 86K/day ≈ 10^5**.

**Step 6 — rounding without drifting.** Round each factor to 1, 2, 3 or 5 × 10^n. If you round one factor up (86,400 → 10^5 is +16%), round another down when you can, so errors cancel. Keep a running note of the direction: "the ÷10^5 trick makes QPS ~15% low". Being within 2× is fine; the danger is dropping or doubling an exponent.

**Step 7 — sanity-check the order of magnitude.** Compare with known anchors: one Postgres primary handles ~10^3–10^4 writes/s; one Redis node ~10^5 ops/s; one 10 Gbps NIC ~10^9 B/s; one server ~10^2–10^3 concurrent heavy requests. If your answer says one box handles 10^7 writes/s, an exponent slipped.

**In interviews, say this:** "Let me write it as 3 × 10^8 users times 2 × 10^3 bytes, that's 6 × 10^11, so about 600 GB." Saying the exponents out loud lets the interviewer follow and correct you, and it shows you're in control of the numbers.`,
      diagram: `  WORKED EXAMPLE: 500M DAU x 20 reads/day x 5 KB per read -> egress?

  reads/day  = (5 x 10^8) x (2 x 10^1)          = 10 x 10^9  = 10^10
  reads/s    = 10^10 / 10^5                                 = 10^5  (100K QPS)
  bytes/s    = 10^5 x (5 x 10^3 B)               = 5 x 10^8 B/s (500 MB/s)
  bits/s     = 5 x 10^8 x 8                      = 4 x 10^9 b/s (4 Gbps avg)
  peak x3    = ~12 Gbps  -> more than one 10 Gbps NIC -> CDN / many edges
  per day    = 5 x 10^8 B/s x 10^5 s             = 5 x 10^13 B  (50 TB/day)`,
      code: [
        {
          language: 'typescript',
          title: 'estimate.ts: a tiny helper to check your mental maths',
          code: `// Format a raw number the way you'd say it in an interview (SI prefixes).
const SI = ['', 'K', 'M', 'G', 'T', 'P', 'E'];

export function human(n: number, unit = ''): string {
  if (n === 0) return '0' + unit;
  const exp3 = Math.min(SI.length - 1, Math.floor(Math.log10(Math.abs(n)) / 3));
  const scaled = n / 10 ** (exp3 * 3);
  // 2 significant figures, but never exponent notation (115.7 -> "116", 4.63 -> "4.6")
  const text = scaled >= 100 ? String(Math.round(scaled)) : String(Number(scaled.toPrecision(2)));
  return text + SI[exp3] + unit;
}

export function sci(n: number): string {
  const exp = Math.floor(Math.log10(Math.abs(n)));
  return (n / 10 ** exp).toFixed(1) + ' x 10^' + exp;
}

const SECONDS_PER_DAY = 86_400; // use 1e5 in your head, this for checking

export const perDayToPerSecond = (perDay: number) => perDay / SECONDS_PER_DAY;

// Example: 500M DAU x 20 reads x 5 KB
const readsPerSec = perDayToPerSecond(500e6 * 20); // ~115,741
const bytesPerSec = readsPerSec * 5e3;             // ~5.8e8
console.log(human(readsPerSec, ' QPS'));           // "116K QPS"
console.log(sci(bytesPerSec));                     // "5.8 x 10^8"
console.log(human(bytesPerSec * 8, 'bps'));        // "4.6Gbps"
// Mental answer was 10^5 QPS and 4 Gbps: ~14% low, the known cost of the 10^5 shortcut.`,
        },
      ],
      keyPoints: [
        'Write every number as a × 10^n with one significant figure.',
        'Multiply → multiply the fronts, add exponents. Divide → divide the fronts, subtract exponents.',
        '1M × 1 KB = 1 GB; 1B × 1 KB = 1 TB; 1B × 1 MB = 1 PB.',
        'Day ≈ 10^5 s, month ≈ 2.5 × 10^6 s, year ≈ π × 10^7 s.',
        'Sanity-check against anchors: Postgres ~10^3–10^4 writes/s, Redis ~10^5 ops/s, 10 Gbps NIC ~10^9 B/s.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 2 (Back-of-the-envelope estimation)',
    },
    {
      heading: 'Powers of two, data sizes and ID-space limits',
      body: `**Intuition:** you need a mental ruler for "how big is a thing". Storage and memory numbers come from multiplying *counts* by *sizes*, so you must know typical sizes cold.

| Power | Exact | Approx | Name |
|---|---|---|---|
| 2^10 | 1,024 | 10^3 | KB (kibibyte strictly) |
| 2^20 | 1,048,576 | 10^6 | MB |
| 2^30 | ~1.07 × 10^9 | 10^9 | GB |
| 2^40 | ~1.1 × 10^12 | 10^12 | TB |
| 2^50 | ~1.13 × 10^15 | 10^15 | PB |

The 1000-vs-1024 gap is only ~2.4% at KB and ~12.6% at PB — **ignore it in interviews**, but never mix bits and bytes (8×).

**Typical object sizes (rules of thumb):**

| Thing | Size |
|---|---|
| BIGINT / timestamp / double | 8 B |
| UUID (binary) | 16 B (36 B as text) |
| Short text row (tweet, chat message + metadata) | 200 B – 1 KB |
| JSON API response (product detail) | 1 – 10 KB |
| Compressed thumbnail | 10 – 50 KB |
| Phone photo (JPEG/HEIC) | 1 – 4 MB |
| 1 min of 1080p video (~5 Mbps) | ~37 MB |
| Log line / metric data point (with labels) | 100 B – 1 KB / ~16 B compressed in a TSDB |

**ID-space limits are estimation questions in disguise.** A signed 32-bit INT tops out at **2,147,483,647**. At 50M inserts/day that overflows in ~43 days. UINT32 ≈ 4.3B, BIGINT ≈ 9.2 × 10^18 (effectively infinite). IPv4 is 2^32 ≈ 4.3B addresses; a 7-character base62 short code gives 62^7 ≈ 3.5 × 10^12 keys.`,
      code: [
        {
          language: 'typescript',
          title: 'units.ts — one place for unit conversions (kills bits/bytes bugs)',
          code: `// Decimal units: what cloud bills, NICs and interviewers use.
export const KB = 1e3;
export const MB = 1e6;
export const GB = 1e9;
export const TB = 1e12;
export const PB = 1e15;

export const SECONDS_PER_DAY = 86_400; // ≈ 1e5 for mental maths
export const DAYS_PER_YEAR = 365;

/** bytes per second → gigabits per second (the unit NICs and CDNs quote) */
export const bytesPerSecToGbps = (bps: number): number => (bps * 8) / 1e9;

/** Human-readable bytes with decimal units. */
export function fmtBytes(bytes: number): string {
  const units: Array<[number, string]> = [[PB, 'PB'], [TB, 'TB'], [GB, 'GB'], [MB, 'MB'], [KB, 'KB']];
  for (const [size, label] of units) {
    if (bytes >= size) return (bytes / size).toFixed(1) + ' ' + label;
  }
  return bytes.toFixed(0) + ' B';
}

/** Days until an auto-increment column overflows. */
export function daysUntilOverflow(maxId: number, currentId: number, insertsPerDay: number): number {
  return (maxId - currentId) / insertsPerDay;
}

// Signed INT32: 2_147_483_647 / 50M per day ≈ 43 days of headroom from zero.
console.log(daysUntilOverflow(2_147_483_647, 0, 50_000_000).toFixed(0)); // "43"`,
        },
      ],
      keyPoints: [
        '1000 vs 1024 does not matter in an interview; bits vs bytes (8×) always does.',
        'Memorise typical sizes: row ~1 KB, photo ~2 MB, 1 min 1080p ~37 MB.',
        'ID-space exhaustion (INT32 at 2.1B) is a classic production outage — estimate it.',
      ],
    },
    {
      heading: 'Latency numbers every engineer should know (classic and 2020s)',
      body: `**Intuition:** each step down the ladder is roughly **10–100× slower**. Knowing the ladder lets you reject designs instantly: "50 sequential cross-region calls" is 3+ seconds before any work is done; "one extra in-memory hop" is noise.

| Operation | Classic (Dean/Norvig) | Modern rule of thumb |
|---|---|---|
| L1 cache reference | 0.5 ns | ~1 ns |
| Branch mispredict | 5 ns | ~3–5 ns |
| L2 cache reference | 7 ns | ~4 ns |
| Mutex lock/unlock (uncontended) | 25 ns | ~20 ns |
| Main memory reference | 100 ns | ~80–100 ns |
| Compress 1 KB (Snappy/LZ4) | 3 µs | ~1–3 µs |
| Send 1 KB over 1 Gbps | 10 µs | ~1 µs on 10 Gbps |
| SSD 4 KB random read | 150 µs | ~20–100 µs (NVMe) |
| Read 1 MB sequentially from memory | 250 µs | ~50–100 µs |
| Round trip within same datacenter | 500 µs | ~0.1–0.5 ms same AZ, ~0.5–2 ms cross-AZ |
| Read 1 MB sequentially from SSD | 1 ms | ~0.3 ms (NVMe at ~3 GB/s) |
| HDD seek | 10 ms | ~5–10 ms |
| Read 1 MB sequentially from HDD | 20 ms | ~5–10 ms |
| Round trip US East ↔ US West | — | ~60–70 ms |
| Round trip California ↔ Netherlands | 150 ms | ~140–150 ms (speed of light in fibre) |

**What to take away:**

- **Memory is ~1,000× faster than SSD random I/O and ~100,000× faster than an HDD seek** → hot data lives in RAM (Redis, buffer pool, page cache).
- **The network inside a DC is fast (sub-ms) but not free**: a request that fans out to 30 services sequentially burns ~10–15 ms in RTTs alone. Parallelise or batch.
- **Cross-region RTT is physics** (~5 µs/km in fibre, round trip ~1 ms per 100 km). No framework fixes it; only data placement does.
- **Compress before you send** over slow links: 1–3 µs per KB of CPU beats 10 µs+ per KB of network.

**Interview line:** "A Redis GET is ~0.2–0.5 ms including the network round trip, a well-indexed Postgres point read ~1–2 ms, a cross-region call ~70 ms — so within a 200 ms p99 budget I can afford maybe two sequential cross-region hops, and I'd rather have zero."`,
      diagram: `  log scale  (each tick ≈ 10x)
  1ns     10ns    100ns   1us    10us   100us   1ms    10ms   100ms
  |-------|-------|-------|------|------|-------|------|------|------|
  L1      L2      RAM     LZ4    1KB    NVMe    DC     HDD    x-cont
  0.5ns   7ns     100ns   1KB    @1Gbps 4KB rd  RTT    seek   RTT
                                                ~0.5ms ~10ms  ~150ms`,
      keyPoints: [
        'RAM ≫ SSD ≫ network hop ≫ HDD ≫ cross-region — each rung ~10–100×.',
        'Budget latency by counting sequential hops, not services.',
        'Cross-region RTT (~70–150 ms) is physics; fix it with data placement.',
      ],
      source: 'Jeff Dean — Latency Numbers Every Programmer Should Know; Alex Xu Vol 1 Ch 2',
    },
    {
      heading: 'DAU → average QPS → peak QPS',
      body: `**Intuition:** traffic is people times habits divided by time. Then you correct for the fact that people do not spread their habits evenly across the day.

**The formula:**

- **Average QPS** = DAU × actions per user per day ÷ 86,400 (≈ ÷ 10^5)
- **Peak QPS** = average × peak factor
- **Read QPS / Write QPS** = split by read:write ratio (social feeds 100:1+, chat ~1:1, metrics/logging ~1:100 read:write)

**Peak factors — choose deliberately:**

| Source of peak | Typical multiplier |
|---|---|
| Diurnal (evening peak in one dominant time zone) | 2–3× |
| Global product spread across time zones | 1.5–2× |
| Push notification blast / live event start | 5–20× for minutes |
| Flash sale / ticket drop / Black Friday | 10–100× vs normal peak |

Alex Xu's Vol 2 chapters use this exact pattern: **Ad click aggregation** — 1B clicks/day ÷ 10^5 = **10K QPS avg, peak 5× = 50K**; **Proximity service** — 100M DAU × 5 searches ÷ 10^5 = **5K QPS**; **Gaming leaderboard** — 5M DAU × 10 games ÷ 10^5 = **500 QPS avg, 2,500 peak**; **Nearby friends** — 10M concurrent users updating every 30 s ≈ **334K updates/s**.

**Two traps:**

1. **Concurrency ≠ DAU.** For connection-oriented systems use Little's Law: average concurrent users = DAU × minutes online per day ÷ 1,440. 20M DAU online 30 min/day ≈ **417K concurrent**, not 20M.
2. **A user action is not one request.** Opening a feed may fan out to 1 API call, 5 GraphQL resolvers, 20 image fetches and 3 analytics beacons. Estimate at the tier you are sizing.

**In production:** peak is measured, not guessed — take p99 of per-second RPS over the last 30 days from your metrics, then add the event multiplier for known launches.`,
      code: [
        {
          language: 'typescript',
          title: 'traffic.ts — DAU to per-tier peak load',
          code: `interface TrafficInputs {
  dau: number;
  actionsPerUserPerDay: number;
  readShare: number;           // 0.95 => 95% reads
  diurnalPeakFactor: number;   // 2-3 typical
  eventMultiplier?: number;    // flash sale, push blast
  requestsPerAction?: number;  // fan-out at the tier being sized
}

export function trafficProfile(t: TrafficInputs) {
  const perAction = t.requestsPerAction ?? 1;
  const avgQps = (t.dau * t.actionsPerUserPerDay * perAction) / 86_400;
  const peakQps = avgQps * t.diurnalPeakFactor * (t.eventMultiplier ?? 1);
  return {
    avgQps: Math.round(avgQps),
    peakQps: Math.round(peakQps),
    peakReadQps: Math.round(peakQps * t.readShare),
    peakWriteQps: Math.round(peakQps * (1 - t.readShare)),
  };
}

/** Little's Law: average concurrent sessions = arrival x time in system. */
export function concurrentUsers(dau: number, minutesOnlinePerDay: number): number {
  return Math.round((dau * minutesOnlinePerDay) / 1_440);
}

// 50M DAU x 20 actions, 95% reads, 3x diurnal:
// avg ~11.6K QPS, peak ~34.7K, reads ~33K, writes ~1.7K
console.log(trafficProfile({ dau: 50e6, actionsPerUserPerDay: 20, readShare: 0.95, diurnalPeakFactor: 3 }));
console.log(concurrentUsers(20e6, 30)); // ~416,667 concurrent, not 20M`,
        },
      ],
      keyPoints: [
        '÷ 10^5 for per-day → per-second; 1M/day ≈ 12 QPS.',
        'Pick a peak factor with a reason: 2–3× diurnal, 10×+ for events.',
        'Concurrent users come from Little\'s Law, not from DAU.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 1, 2, 6, 10 (estimation sections)',
    },
    {
      heading: 'Storage growth over 5 years — replication, overhead, compounding',
      body: `**Intuition:** raw data is the smallest number in the storage conversation. Replicas, indexes, metadata, derived copies (thumbnails, search index, analytics) and growth multiply it — often by **5–10×**.

**Full formula:**

Total = Σ over years (writes/day in that year × bytes/record × 365) × replication × overhead × (1 + derived copies) − expired data (retention/TTL)

**The multipliers:**

| Factor | Typical value | Notes |
|---|---|---|
| Replication (DB, Kafka, HDFS) | 3× | 1 primary + 2 replicas / RF=3 |
| Erasure coding (S3-class, 8+4, 6+3) | ~1.3–1.5× | Much cheaper than 3× for cold/large objects |
| Index + row/page overhead (B-tree RDBMS) | 1.3–2× | Postgres tuple header alone is ~24 B/row |
| LSM compaction headroom (Cassandra/RocksDB) | up to 2× free disk | size-tiered compaction needs free space |
| Derived copies | +0.3–1× | thumbnails, transcodes, search index |
| Target disk fill | ≤ 70–80% | leave room for compaction, rebalancing, growth |

**Compounding growth matters.** At 30% YoY growth, the 5-year total is **Σ 1.3^0..1.3^4 ≈ 9.04× year-1 volume** — versus 5× if you assume flat traffic and ~8× with naive linear growth. Underestimating by 45% means you re-shard in year 3 instead of year 5.

**Dominant term thinking:** in a Twitter-like system text is ~90 GB/day but media is ~30 TB/day — media is **>300×** larger, which is why text goes in a database and media goes in object storage behind a CDN. Say that sentence in interviews.

**In production:** retention policies (TTL, hot → warm → cold tiering, deleting originals after transcoding) are the biggest levers — storage spend is usually dominated by data nobody reads.`,
      code: [
        {
          language: 'typescript',
          title: 'storage.ts — 5-year forecast with compounding and overhead',
          code: `interface StorageInputs {
  year1WritesPerDay: number;
  bytesPerRecord: number;
  yoyGrowth: number;          // 0.3 => +30% per year
  years: number;
  replicationFactor: number;  // 3 for DB/Kafka, ~1.5 for erasure-coded blobs
  overheadFactor: number;     // indexes + metadata, 1.3-2 for OLTP
  retentionYears?: number;    // data older than this is deleted
  maxDiskFill?: number;       // provision so disks stay <= 75% full
}

export function forecastBytes(s: StorageInputs): { logicalBytes: number; provisionedBytes: number } {
  const perYear: number[] = [];
  for (let y = 0; y < s.years; y++) {
    // compounding: year 1 = base, year 2 = base * (1+g), ...
    perYear.push(s.year1WritesPerDay * Math.pow(1 + s.yoyGrowth, y) * s.bytesPerRecord * 365);
  }
  // with retention, only the most recent N years are kept
  const kept = s.retentionYears ? perYear.slice(-s.retentionYears) : perYear;
  const logicalBytes = kept.reduce((a, b) => a + b, 0);
  const physical = logicalBytes * s.replicationFactor * s.overheadFactor;
  return { logicalBytes, provisionedBytes: physical / (s.maxDiskFill ?? 0.75) };
}

// 10M rows/day x 1 KB, +30%/yr, 5 yrs, RF3, 1.5x index overhead
const r = forecastBytes({
  year1WritesPerDay: 10e6, bytesPerRecord: 1_000, yoyGrowth: 0.3,
  years: 5, replicationFactor: 3, overheadFactor: 1.5,
});
// logical ~33 TB, provisioned ~198 TB (vs 18 TB if you forget everything)
console.log((r.logicalBytes / 1e12).toFixed(0), (r.provisionedBytes / 1e12).toFixed(0));`,
        },
      ],
      keyPoints: [
        'Raw bytes × replication × index overhead × derived copies ÷ fill target.',
        '30% YoY over 5 years ≈ 9× year-1 volume, not 5×.',
        'Retention and tiering are the largest real-world storage levers.',
      ],
    },
    {
      heading: 'Bandwidth: ingress, egress, and the bits-vs-bytes trap',
      body: `**Intuition:** bandwidth = QPS × payload size. The only hard part is units: storage people count **bytes**, network people count **bits**, and the ×8 gets lost.

- **Ingress** (into your system) = write QPS × request size. Usually small except for uploads, logs and metrics.
- **Egress** (out of your system) = read QPS × response size. This is where money and NIC limits bite.

**Reference points:**

| Link | Throughput |
|---|---|
| 1 Gbps | 125 MB/s |
| 10 Gbps | 1.25 GB/s |
| 25 Gbps (common cloud instance) | ~3.1 GB/s |
| 100 Gbps | 12.5 GB/s |
| One 1080p stream | ~5 Mbps |
| One 4K stream | ~15–25 Mbps |

**Example:** 50K peak reads/s × 20 KB responses = 1 GB/s = **8 Gbps**. That saturates a 10 Gbps NIC at ~80% before any TCP/TLS overhead → you need multiple load balancer instances and should compress (gzip/brotli JSON typically 3–10×) or move bulk to a CDN.

**Egress is a cost item.** Cloud internet egress is roughly **$0.05–0.09/GB** at list price (cheaper with volume/CDN contracts). 1 PB/month ≈ **$50K–90K/month**. Estimating egress early is how you justify a CDN, image resizing, or better compression.

**CDN offload math:** origin egress = total egress × (1 − hit ratio). Moving hit ratio from **95% → 99%** cuts origin egress **5×** (5% → 1%), not 4%.

**Interview line:** "Peak egress is ~8 Gbps — that's fine for a fleet but would saturate a single 10 Gbps box, so I'd front static assets and media with a CDN and keep the API tier's payloads small and compressed."`,
      code: [
        {
          language: 'typescript',
          title: 'bandwidth.ts — egress, NIC saturation and CDN offload',
          code: `export interface BandwidthResult {
  egressGbps: number;
  originGbps: number;
  monthlyEgressTB: number;
  nicsAt70pct: number;
}

export function egress(
  peakReadQps: number,
  avgResponseBytes: number,
  cdnHitRatio: number,       // 0.95 => 95% served by CDN
  nicGbps = 10,
  avgToPeakRatio = 0.4,      // average traffic ≈ 40% of peak
): BandwidthResult {
  const peakBytesPerSec = peakReadQps * avgResponseBytes;
  const egressGbps = (peakBytesPerSec * 8) / 1e9;              // bytes -> bits!
  const originGbps = egressGbps * (1 - cdnHitRatio);
  const monthlyBytes = peakBytesPerSec * avgToPeakRatio * 86_400 * 30;
  return {
    egressGbps,
    originGbps,
    monthlyEgressTB: monthlyBytes / 1e12,
    nicsAt70pct: Math.ceil(originGbps / (nicGbps * 0.7)),        // never plan NICs at 100%
  };
}

// 50K peak reads/s x 20 KB, no CDN: 8 Gbps peak, ~1 PB/month, 2 NICs at origin
console.log(egress(50_000, 20_000, 0));
// same traffic, 95% CDN hit ratio: origin drops to 0.4 Gbps
console.log(egress(50_000, 20_000, 0.95));`,
        },
      ],
      keyPoints: [
        'Egress = read QPS × response bytes × 8 for bits.',
        '1 Gbps = 125 MB/s — plan NICs at ≤ 70%.',
        'CDN hit ratio 95% → 99% is a 5× origin reduction.',
      ],
    },
    {
      heading: 'Cache memory sizing — the 80/20 rule done properly',
      body: `**Intuition:** access patterns are skewed — a small fraction of keys serves most reads. If ~20% of items get ~80% of traffic, caching that 20% gives most of the benefit at a fraction of the memory.

**Naive estimate (Alex Xu style):** cache 20% of daily read volume. E.g. 100M unique items read per day × 20% × 1 KB = **20 GB**.

**Senior-level correction — what actually lands in RAM:**

| Component | Rule of thumb |
|---|---|
| Value bytes | serialized size (JSON is 2–5× bigger than protobuf/msgpack; compress large values) |
| Key bytes | 20–60 B typical ("product:v3:123456789") |
| Redis per-key overhead | ~50–100 B (dict entry, object header, SDS headers, expiry entry, allocator rounding) |
| Fragmentation ratio | 1.1–1.5 (check INFO memory mem_fragmentation_ratio) |
| maxmemory headroom | set maxmemory ~70–80% of RAM for fork/COW during RDB/AOF rewrite, buffers |
| Replicas | ×2 (one replica per primary) or ×3 |

For **tiny values** (IDs, counters, flags) overhead dominates: 10M keys × (8 B value + 30 B key + 70 B overhead) ≈ **1.1 GB**, not 80 MB. Redis hashes with small-encoding (listpack) can cut that several-fold by bucketing keys.

**Memory is rarely the only constraint.** Check:

- **Throughput per shard** — a Redis primary does ~100K–200K simple ops/s on one core (more with pipelining). 500K peak reads/s → 4–6 primaries regardless of memory.
- **Network per shard** — 100K ops/s × 5 KB values = 500 MB/s = **4 Gbps** per node. Large values saturate NICs before CPU.
- **Hot keys** — one celebrity key at 200K reads/s pins one shard; you need local in-process caching or key replication.

**Validate with data:** hit-ratio curves (hit rate vs cache size) from a sampled key trace beat any 80/20 assumption.`,
      code: [
        {
          language: 'typescript',
          title: 'cacheSizing.ts — memory AND throughput drive shard count',
          code: `interface CacheInputs {
  hotKeys: number;             // e.g. 20% of daily unique items
  avgValueBytes: number;
  avgKeyBytes: number;
  peakOpsPerSec: number;
  perKeyOverheadBytes?: number;  // Redis ~50-100 B per key
  fragmentation?: number;        // 1.1-1.5
  maxmemoryRatio?: number;       // usable share of node RAM
  nodeRamBytes: number;
  opsPerShard?: number;          // conservative per-primary throughput
  nicBytesPerSec?: number;       // 10 Gbps = 1.25e9 B/s
}

export function redisShards(c: CacheInputs) {
  const perKey = c.avgValueBytes + c.avgKeyBytes + (c.perKeyOverheadBytes ?? 80);
  const dataBytes = c.hotKeys * perKey * (c.fragmentation ?? 1.3);
  const usablePerNode = c.nodeRamBytes * (c.maxmemoryRatio ?? 0.75);

  const byMemory = Math.ceil(dataBytes / usablePerNode);
  const byOps = Math.ceil(c.peakOpsPerSec / (c.opsPerShard ?? 80_000));
  // keep each node's NIC under ~60% at peak
  const peakBytes = c.peakOpsPerSec * c.avgValueBytes;
  const byNetwork = Math.ceil(peakBytes / ((c.nicBytesPerSec ?? 1.25e9) * 0.6));

  const primaries = Math.max(byMemory, byOps, byNetwork);
  return { dataGB: dataBytes / 1e9, byMemory, byOps, byNetwork, primaries, totalNodesWithReplica: primaries * 2 };
}

// 10M hot products x 2 KB, 150K peak reads/s, 26 GB nodes
console.log(redisShards({
  hotKeys: 10e6, avgValueBytes: 2_000, avgKeyBytes: 40,
  peakOpsPerSec: 150_000, nodeRamBytes: 26e9,
}));`,
        },
      ],
      keyPoints: [
        'Hot set × (value + key + ~80 B overhead) × fragmentation ÷ 75% RAM.',
        'Shard count = max(memory, ops/s, network) — memory is often not the binding one.',
        'Tiny values: overhead dominates; use hash bucketing or compact encodings.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 2 (cache 20% of daily reads)',
    },
    {
      heading: 'Server count, cores and connections (Little\'s Law in practice)',
      body: `**Intuition:** a server's capacity is its CPU-seconds per second. If each request costs 10 ms of CPU, one core can do ~100 requests/s at 100% — and you never run at 100%.

**CPU-bound tier:** cores = peak QPS × CPU time per request ÷ target utilization.

- Target utilization **50–70%** leaves headroom for GC pauses, bursts and a failed AZ.
- **AZ resilience:** with 3 AZs, losing one pushes survivors to 1.5× load. If you plan at 60%, survivors land at 90% — tight but alive. If you plan at 80%, survivors go to 120% → cascading failure.
- **Node.js note:** one event loop uses ~one core; run one process per vCPU (cluster/PM2 or one small pod per vCPU).

**Rough throughput per unit (sane ranges, heavily workload-dependent):**

| Component | Typical capacity |
|---|---|
| Node/NestJS API pod, realistic endpoint (auth + DB + JSON) | 500–3K RPS per vCPU |
| nginx / Envoy proxying | 10K–50K+ RPS per core |
| Postgres primary, indexed point reads | 10K–50K QPS (bigger boxes more) |
| Postgres writes (small transactions) | ~5K–20K TPS before WAL/fsync tuning |
| Redis single primary | 100K–200K ops/s |
| Kafka broker | 100s of MB/s; ~1M small msgs/s per cluster is routine |

**Little's Law (L = λ × W)** turns rates into concurrency, which is what pools and limits are made of:

- In-flight requests = RPS × latency. 5K RPS × 40 ms = **200 in-flight**.
- DB connections actually needed = query rate × query time. 20K queries/s × 2 ms = **40 busy connections** — not the 40 pods × 20 pool = 800 you configured. That mismatch is why PgBouncer exists and why Postgres falls over at a few thousand connections (each backend is a process with several MB of RAM).

**Interview line:** "~70K peak QPS × 10 ms CPU ≈ 700 busy cores; at 60% target that's ~1,200 vCPU, ~600 two-vCPU pods across 3 AZs. The DB only needs ~200 active connections, so I'd put a pooler in front rather than letting 600 pods × 10 connections hit Postgres."`,
      code: [
        {
          language: 'typescript',
          title: 'fleet.ts — cores, pods and required DB connections',
          code: `interface FleetInputs {
  peakQps: number;
  cpuMsPerRequest: number;      // measured from profiling / load test
  dbMsPerRequest: number;       // time holding a DB connection per request
  targetUtilization: number;    // 0.6 typical
  vcpuPerPod: number;
  azs: number;                  // survive loss of one AZ
}

export function fleet(f: FleetInputs) {
  const busyCores = (f.peakQps * f.cpuMsPerRequest) / 1_000;
  const cores = busyCores / f.targetUtilization;
  let pods = Math.ceil(cores / f.vcpuPerPod);

  // After losing one AZ, survivors must stay below ~90% CPU.
  const utilAfterAzLoss = f.targetUtilization * (f.azs / (f.azs - 1));
  if (utilAfterAzLoss > 0.9) {
    pods = Math.ceil((pods * utilAfterAzLoss) / 0.9);
  }
  // Round up to a multiple of AZ count so pods spread evenly.
  pods = Math.ceil(pods / f.azs) * f.azs;

  // Little's Law: concurrent connections = arrival rate x hold time
  const dbConnectionsNeeded = Math.ceil((f.peakQps * f.dbMsPerRequest) / 1_000);
  return { busyCores, cores: Math.ceil(cores), pods, utilAfterAzLoss, dbConnectionsNeeded };
}

// 70K peak QPS, 10 ms CPU, 3 ms DB, 60% target, 2 vCPU pods, 3 AZs
// => 700 busy cores, ~1,167 vCPU, 585 pods, 90% after AZ loss, ~210 DB conns
console.log(fleet({ peakQps: 70_000, cpuMsPerRequest: 10, dbMsPerRequest: 3,
  targetUtilization: 0.6, vcpuPerPod: 2, azs: 3 }));`,
        },
      ],
      keyPoints: [
        'Cores = peak QPS × CPU-sec/request ÷ 0.5–0.7 utilization.',
        'Check the "lose one AZ" case: 60% planned → 90% on survivors.',
        'Little\'s Law sizes pools: needed connections = QPS × hold time.',
      ],
    },
    {
      heading: 'Presenting estimates in an interview — sanity checks and fragile assumptions',
      body: `**Intuition:** the interviewer is evaluating judgement, not arithmetic. Show the ladder of reasoning, sanity-check against known systems, and flag which assumption would change the design if it were wrong.

**A 3-minute script:**

1. "Assume 100M DAU, 10 reads and 1 write per user per day, 1 KB per write, 2 KB per read response."
2. "Writes: 100M ÷ 10^5 = 1K/s avg, ~3K peak. Reads: 10K avg, ~30K peak. Read-heavy 10:1 → caching and replicas are worth it."
3. "Storage: 100 GB/day raw → ~180 TB over 5 years raw, ×3 replication ≈ 550 TB + indexes → sharded store, not a single Postgres."
4. "Egress: 30K × 2 KB = 60 MB/s ≈ 0.5 Gbps — not a concern."
5. "So the forcing functions are write-path sharding and storage, not QPS."

**Sanity checks against the real world:**

- Whole of Twitter/X handles on the order of **~5–10K tweets/s average** with records of ~150K/s during events; if your "startup" estimate exceeds that, re-check.
- A single well-tuned Postgres handles **tens of thousands of simple QPS** — so 3K write QPS doesn't *by itself* force sharding; 500 TB does.
- Global internet video is ~65%+ of downstream traffic — a streaming service's egress will dwarf everything else in its estimate.

**Fragile assumptions to call out** (the ones that swing results 10×): fan-out per action (a feed read is 1 call or 50?), media share (5% or 50% of posts?), peak multiplier for events, retention (30 days vs forever), and payload size (JSON vs compressed).

**Common mistakes:** computing to three decimals, sizing for average, forgetting replicas, mixing bits/bytes, and never stating what the numbers imply.`,
      keyPoints: [
        'Narrate: assumptions → load → storage → bandwidth → "so the forcing function is X".',
        'Sanity-check against known scale (Twitter, single Postgres limits).',
        'Name the 10×-swing assumptions and how you would validate them.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 2 & Ch 3 (4-step framework)',
    },
  ],
  codeChallenges: [
    {
      id: 'fund-estimation-cc-1',
      title: 'Fix the team\'s capacity calculator',
      context:
        'Your platform team uses this helper in design docs to size new NestJS services. Two launches were under-provisioned last quarter and a third one got a surprisingly large egress bill. The function "looks right" and nobody has questioned it for a year.',
      task:
        'Find every estimation bug and smell, then rewrite the helper so it produces peak-aware QPS, correct egress in Gbps, a storage figure that reflects replication and overhead, and a server count with realistic headroom. Keep it a pure function with explicit, named inputs.',
      starter: {
        language: 'typescript',
        title: 'capacity.ts (starter)',
        code: `interface Inputs {
  dau: number;
  requestsPerUserPerDay: number;
  avgResponseBytes: number;
  writeRatio: number;       // fraction of requests that are writes
  avgWriteBytes: number;
}

export function estimate(i: Inputs) {
  const qps = (i.dau * i.requestsPerUserPerDay) / 86400;
  const writeQps = qps * i.writeRatio;

  // egress in Mbps
  const egressMbps = (qps * i.avgResponseBytes) / 1_000_000;

  // storage per year in GB
  const storagePerYearGB = (writeQps * i.avgWriteBytes * 86400 * 365) / 1024 ^ 3;

  // one node handles ~1K RPS
  const servers = Math.round(qps / 1000);

  return { qps, writeQps, egressMbps, storagePerYearGB, servers };
}`,
      },
      hints: [
        'Evaluate the storage expression by hand with operator precedence in mind — what does the caret do in JavaScript?',
        'Which of these numbers should be computed at peak rather than average, and what unit do NICs quote?',
        'What happens to "servers" for a small service, and what happens when one AZ disappears?',
      ],
      solution: {
        language: 'typescript',
        title: 'capacity.ts (solution)',
        code: `export interface CapacityInputs {
  dau: number;
  requestsPerUserPerDay: number;
  writeShare: number;            // 0..1
  avgResponseBytes: number;
  avgWriteBytes: number;
  peakFactor: number;            // 2-3 diurnal; more for events
  replicationFactor: number;     // e.g. 3
  storageOverhead: number;       // indexes/metadata, e.g. 1.5
  perServerRps: number;          // measured by load test, not guessed
  targetUtilization: number;     // e.g. 0.6
  azs: number;                   // e.g. 3
}

const SECONDS_PER_DAY = 86_400;
const GB = 1e9;

export function estimate(i: CapacityInputs) {
  if (i.writeShare < 0 || i.writeShare > 1) throw new RangeError('writeShare must be 0..1');

  const avgQps = (i.dau * i.requestsPerUserPerDay) / SECONDS_PER_DAY;
  const peakQps = avgQps * i.peakFactor;
  const peakReadQps = peakQps * (1 - i.writeShare);
  const avgWriteQps = avgQps * i.writeShare;

  // Egress sized at peak, bytes -> bits.
  const peakEgressGbps = (peakReadQps * i.avgResponseBytes * 8) / 1e9;

  // Storage uses AVERAGE write rate (volume), then replication + overhead.
  const rawPerYear = avgWriteQps * i.avgWriteBytes * SECONDS_PER_DAY * 365;
  const storagePerYearGB = (rawPerYear * i.replicationFactor * i.storageOverhead) / GB;

  // Servers sized at PEAK with utilization headroom, AZ-balanced, N+1 minimum.
  const needed = peakQps / (i.perServerRps * i.targetUtilization);
  const perAz = Math.max(1, Math.ceil(needed / (i.azs - 1))); // survive losing one AZ
  const servers = Math.max(2, perAz * i.azs);

  return {
    avgQps: Math.round(avgQps),
    peakQps: Math.round(peakQps),
    peakEgressGbps: Number(peakEgressGbps.toFixed(2)),
    storagePerYearGB: Math.round(storagePerYearGB),
    servers,
  };
}`,
      },
      explanation: `**Fixes, in order of blast radius:**

- **1024 ^ 3 is XOR, not exponentiation.** 1024 XOR 3 = 1027, so "GB" was really "KB-ish" — the storage figure was inflated ~1,000,000×, which is why nobody trusted it and people guessed instead. Use 1e9 (or 1024 ** 3) and a named constant.
- **Bits vs bytes:** bytes/s ÷ 10^6 is MB/s, not Mbps. Egress was under-reported **8×**, matching the surprise egress bill. Multiply by 8 and report Gbps.
- **No peak factor:** servers and egress were sized at the daily *average*. With a 3× evening peak the fleet ran at ~300% of plan. Size throughput at peak; size storage volume at average.
- **Egress counted writes too:** egress should use read QPS (responses), not total QPS.
- **Storage ignored replication and index overhead:** RF3 × 1.5 overhead is a 4.5× difference.
- **Server count:** Math.round can return 0 for small services and plans CPU at 100%. The fix divides by target utilization, guarantees N ≥ 2, and sizes so that losing one of 3 AZs still leaves enough capacity.
- **Magic numbers became inputs:** "1K RPS per node" must come from a load test of *this* service; writeShare is validated.`,
      followUps: [
        {
          "q": "How would you test this function so the next bug like `1024 ^ 3` can't hide for a year?",
          "a": "Write table-driven unit tests with hand-computed golden cases: e.g. 1M DAU × 100 requests/day → ~1,157 average QPS. Add property tests: doubling DAU doubles QPS, egress and storage; peakQps ≥ avgQps; servers ≥ 2 and divisible by azs. Add unit-sanity assertions, such as egress in Gbps for 1 Gbps worth of bytes being 1. Finally, run the calculator against an existing production service and compare with its real dashboards; a 10× mismatch flags a bug immediately."
        },
        {
          "q": "The service will run in two regions, active-active, with 70% of users in one. How does the function change?",
          "a": "Size each region separately: compute peak QPS per region from its share of DAU and its own diurnal peak (different time zones peak at different hours, so the global peak is lower than the sum of regional peaks). Then add failover capacity: if one region must absorb the other's traffic, each must handle the combined peak at the moment of failover, or you accept degraded service. Storage becomes per region × replication across regions, and egress includes cross-region replication traffic, which is billed."
        }
      ],
    },
    {
      id: 'fund-estimation-cc-2',
      title: '5-year storage forecast and Redis sizing that finance can trust',
      context:
        'A chat product is planning a 5-year storage budget and a Redis cluster for "recent messages". The current script predicted ~35 TB of disk for all five years and a single 16 GB Redis node. By the end of year 2 the cluster already needed ~50 TB of provisioned disk, and Redis started evicting hot keys at 60% of the predicted key count.',
      task:
        'Rewrite the forecast so it models compounding growth, retention, replication, index overhead and disk fill targets; and rewrite the Redis sizing so it accounts for key size, per-key overhead, fragmentation, maxmemory headroom, replicas, and a throughput-based shard count.',
      starter: {
        language: 'typescript',
        title: 'forecast.ts (starter)',
        code: `export function forecastBytes(dailyNewRecords: number, recordBytes: number, yoyGrowth: number, years: number) {
  let total = 0;
  for (let y = 1; y <= years; y++) {
    // growth: 30% more every year
    total += dailyNewRecords * recordBytes * 365 * (1 + yoyGrowth * y);
  }
  return total; // bytes on disk
}

export function redisNodes(hotKeys: number, valueBytes: number, nodeGB: number) {
  const gb = (hotKeys * valueBytes) / 1e9;
  return Math.ceil(gb / nodeGB);
}

// 10M msgs/day x 1 KB, 30% growth, 5 years
console.log(forecastBytes(10e6, 1_000, 0.3, 5) / 1e12, 'TB');
// 5M recent messages cached, 1 KB each, 16 GB nodes
console.log(redisNodes(5e6, 1_000, 16));`,
      },
      hints: [
        'Write out the per-year multiplier the loop uses for years 1..5 and compare with (1.3)^0..(1.3)^4. Which year does it start growing?',
        'The disk holds more than one copy of each byte and more than the row itself. What else lives on disk and how full can a disk safely get?',
        'For Redis, list everything that consumes memory per key besides the value, and ask whether memory is the only resource a shard can run out of.',
      ],
      solution: {
        language: 'typescript',
        title: 'forecast.ts (solution)',
        code: `export interface ForecastInputs {
  year1RecordsPerDay: number;
  recordBytes: number;
  yoyGrowth: number;          // 0.3 = +30%/yr, compounding
  years: number;
  retentionYears: number;     // older data is deleted/archived
  replicationFactor: number;  // 3
  indexOverhead: number;      // 1.5 = indexes + tuple headers + TOAST
  maxDiskFill: number;        // 0.75
}

export function forecast(f: ForecastInputs) {
  const perYear = Array.from({ length: f.years }, (_, y) =>
    f.year1RecordsPerDay * Math.pow(1 + f.yoyGrowth, y) * f.recordBytes * 365);
  const retained = perYear.slice(-f.retentionYears).reduce((a, b) => a + b, 0);
  const onDisk = retained * f.replicationFactor * f.indexOverhead;
  return { logicalTB: retained / 1e12, provisionTB: onDisk / f.maxDiskFill / 1e12 };
}

export interface RedisInputs {
  hotKeys: number; valueBytes: number; keyBytes: number;
  peakOpsPerSec: number; nodeRamGB: number;
  perKeyOverhead?: number; fragmentation?: number; maxmemoryRatio?: number;
  opsPerPrimary?: number; replicasPerPrimary?: number;
}

export function redisCluster(r: RedisInputs) {
  const bytesPerKey = r.valueBytes + r.keyBytes + (r.perKeyOverhead ?? 80);
  const dataGB = (r.hotKeys * bytesPerKey * (r.fragmentation ?? 1.3)) / 1e9;
  const usableGB = r.nodeRamGB * (r.maxmemoryRatio ?? 0.75); // fork/COW + buffers
  const byMemory = Math.ceil(dataGB / usableGB);
  const byOps = Math.ceil(r.peakOpsPerSec / (r.opsPerPrimary ?? 80_000));
  const primaries = Math.max(byMemory, byOps, 1);
  return { dataGB, primaries, totalNodes: primaries * (1 + (r.replicasPerPrimary ?? 1)) };
}

console.log(forecast({ year1RecordsPerDay: 10e6, recordBytes: 1_000, yoyGrowth: 0.3,
  years: 5, retentionYears: 5, replicationFactor: 3, indexOverhead: 1.5, maxDiskFill: 0.75 }));
// => ~33 TB logical, ~198 TB provisioned (the starter printed ~35 TB)
console.log(redisCluster({ hotKeys: 5e6, valueBytes: 1_000, keyBytes: 40,
  peakOpsPerSec: 120_000, nodeRamGB: 16 }));`,
      },
      explanation: `**Forecast fixes:**

- **Linear, off-by-one growth.** The starter multiplies year y by (1 + 0.3y), so year 1 is already +30% and growth is linear (1.3, 1.6, 1.9, 2.2, 2.5 → 9.5× total). Real compounding is 1, 1.3, 1.69, 2.20, 2.86 → **9.04×**. The two happen to land near each other at 5 years, but they diverge sharply for longer horizons or higher growth rates (at 60% YoY: linear 14× vs compounding ~15.8×; at 10 years and 30%: 26.5× vs ~42.6×). Use Math.pow(1 + g, y) with y starting at 0.
- **Single copy, no overhead:** disk holds RF3 copies plus indexes/tuple headers (~1.5×) — a **4.5×** miss, which is exactly why year 2 blew past budget.
- **Disk fill target:** provisioning to 100% leaves nothing for compaction, vacuum, rebalancing or growth spikes; divide by ~0.75.
- **Retention** is now explicit — for chat it is often the single largest lever.

**Redis fixes:**

- Each key costs value **+ key bytes + ~50–100 B of dict/object/expiry overhead**, then ×1.2–1.5 fragmentation. 5M × 1 KB "5 GB" is really ~7 GB.
- **maxmemory at ~75% of RAM** protects against fork copy-on-write during BGSAVE/AOF rewrite and client output buffers — evictions at "60% of predicted" were this.
- **Throughput sets a floor on primaries** (~80K safe ops/s each here) independent of memory, and replicas double the node count.`,
      followUps: [
        {
          "q": "Chat history is now retained for only 2 years. What does the fixed forecast output for year 5?",
          "a": "Only years 4 and 5 are retained: 10M × 1 KB × 365 ≈ 3.65 TB per year-1 unit, × (2.197 + 2.856) ≈ 18.4 TB logical. × 3 copies × 1.5 overhead ÷ 0.75 fill ≈ 111 TB provisioned instead of ~198 TB. Retention, therefore, cuts the bill nearly in half, and the gap grows each year. The function handles it via `perYear.slice(-retentionYears)`, which is why retention became an explicit input instead of a comment."
        },
        {
          "q": "Memory says one Redis node is enough, but one huge group chat's recent-messages key gets 40K reads/s. What do you do?",
          "a": "Shard count doesn't help a single hot key: all of its reads land on one primary, which may be near its ~80K ops/s ceiling alongside other traffic. Options: serve the hot key from replicas (read from replicas with client-side routing), add a short-lived in-process cache in the app pods (100–500 ms TTL collapses 40K reads/s into a few per pod), or split the key into N copies (`recent:{conv}:0..N`) and read a random copy. Detect hot keys with `redis-cli --hotkeys` or client metrics."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'fund-estimation-iq-01',
      difficulty: 'medium',
      question:
        'We\'re designing a Twitter-like home timeline. Before any boxes, walk me through your back-of-the-envelope estimate — and tell me which numbers actually change the design.',
      whatInterviewerLooksFor: [
        'States assumptions explicitly and quickly (DAU, tweets/day, reads/day, sizes, media share)',
        'Separates read and write paths and computes peak, not just average',
        'Identifies the dominant term (media storage/egress, timeline read fan-out)',
        'Translates numbers into component decisions within 3–5 minutes',
      ],
      modelAnswer: `**Assumptions (say them, write them):** 300M MAU, 50% daily → **150M DAU**; 2 tweets/user/day; 10% of tweets carry media averaging 1 MB; each user loads the timeline 10×/day; tweet text + metadata ≈ 300 B; retain 5 years.

**Write path:** 150M × 2 = 300M tweets/day ÷ 10^5 ≈ **3K QPS avg, ~6–10K peak** (2–3×). Modest — a partitioned write store handles this; not a forcing function by itself.

**Read path:** 150M × 10 = 1.5B timeline loads/day → **15K QPS avg, ~45K peak**. Each load reads ~20 tweets; if we assemble timelines on read (fan-out-on-read) that's ~900K tweet reads/s at peak. **This is the first forcing function**: precompute timelines (fan-out-on-write into a Redis timeline cache) for normal users, and merge celebrity tweets at read time.

**Storage:**
- Text: 300M × 300 B = **90 GB/day** → ~165 TB over 5 years raw, ~500 TB with RF3. Sharded DB territory, but manageable.
- Media: 30M × 1 MB = **30 TB/day** → ~55 PB over 5 years raw. **Second forcing function**: media is >300× the text volume → object storage (erasure-coded, ~1.5×) + CDN, never the database.

**Egress:** if each timeline load pulls ~2 images at 200 KB (resized), 45K × 400 KB = 18 GB/s ≈ **144 Gbps** at peak → must be CDN-served.

**Cache:** timelines for active users: 150M × 800 tweet IDs × 8 B ≈ 1 TB of IDs, before Redis overhead → a sizeable sharded Redis cluster; cap timeline length to bound it.

**So what:** writes are small; the design is driven by *read fan-out* (precomputed timelines + hybrid for celebrities) and *media* (object store + CDN).`,
      followUps: [
        {
          q: 'What if 50% of tweets had media instead of 10%?',
          a: 'Media storage goes from ~30 TB/day to ~150 TB/day (~275 PB over 5 years raw). It does not change the architecture shape, but it makes erasure coding, tiering old media to cold storage, and aggressive resizing/transcoding mandatory cost levers.',
        },
        {
          q: 'How big does the fan-out-on-write queue get if a user with 50M followers tweets?',
          a: 'One tweet → 50M timeline inserts. At ~1M inserts/s across the fleet that is ~50 s of work for one tweet, which is why celebrities are excluded from fan-out-on-write and merged at read time instead.',
        },
        {
          q: 'Your peak factor is 3×. When would you pick something else?',
          a: 'A global product flattens diurnal peaks (1.5–2×); live events (World Cup goal, elections) spike 5–20× for minutes. For those you pre-scale or shed/queue non-critical writes rather than size the whole fleet for the spike.',
        },
      ],
      pitfalls: [
        'Computing only average QPS and never mentioning peak',
        'Storing media sizes in the database estimate or ignoring media entirely',
        'Spending 10 minutes on precise arithmetic without drawing a conclusion',
        'Treating 3K write QPS as the hard problem while missing read fan-out',
      ],
    },
    {
      id: 'fund-estimation-iq-02',
      difficulty: 'hard',
      question:
        'Your estimate says 12K average QPS. The business then tells you Black Friday peaks at 20× normal traffic for about 40 minutes. How does that change your capacity plan?',
      context: 'E-commerce checkout + catalog platform on Kubernetes, Postgres primary with read replicas, Redis cache.',
      whatInterviewerLooksFor: [
        'Distinguishes sustained diurnal peak from short event spikes',
        'Knows autoscaling has lag and that stateful tiers do not autoscale quickly',
        'Proposes pre-scaling, load shedding, queueing and degradation per tier',
        'Checks every tier (LB, app, cache, DB, third parties) not just stateless pods',
      ],
      modelAnswer: `**Reframe the number:** 12K avg × 3 diurnal ≈ 36K normal peak. "20× normal" — clarify whether that is 20× *average* (240K) or 20× *peak* (720K). This single clarification swings the plan 3×. Assume **~240K QPS for ~40 minutes**.

**Tier by tier:**

- **Stateless app tier:** HPA reacts in ~30–60 s and new nodes take 2–5 min to join — too slow for a spike that starts at midnight sharp. **Pre-scale** to ~70% of expected peak capacity an hour before, let HPA cover the rest. At ~1K RPS per vCPU at 60% util → ~400 vCPU; fine, it's just money for a few hours.
- **Cache:** reads (catalog, product detail) should be ≥ 95% cache hits. 240K × 0.95 → ~230K Redis ops/s → 3–4 primaries minimum on throughput; **pre-warm** the hot set (sale SKUs) so a cold cache doesn't send the spike to Postgres.
- **Database:** does *not* scale 20× on demand. Writes are the real limit: if 5% of requests are writes → 12K writes/s. A single Postgres primary can do a few thousand to ~10–20K small transactions/s — borderline. Options: move order placement to a **queue** (accept order → async process), batch inventory decrements, use Redis for stock reservation with periodic reconciliation.
- **Protect the core:** rate-limit per user, a **virtual waiting room** for checkout, disable non-essential features (recommendations, reviews) via feature flags, and shed load with 503 + Retry-After rather than letting latency explode.
- **Third parties:** the payment gateway has its own limits — confirm quota; 12K checkouts/s may exceed it.

**Validate:** load test at 1.2× the target in a prod-like environment two weeks before, and game-day the failure of one AZ during the test.`,
      followUps: [
        {
          q: 'Why not just set HPA max replicas high and let it handle it?',
          a: 'HPA reacts to metrics with a lag, cluster autoscaler needs minutes to add nodes, cold pods have cold JIT/caches/connection pools, and the DB and cache are not behind the HPA at all. The spike would saturate stateful tiers before pods arrive.',
        },
        {
          q: 'How would you estimate the size of the waiting room queue?',
          a: 'Queue growth = arrival rate − admit rate. If 1M users arrive in the first 10 minutes (~1.7K/s) and checkout admits 1K/s, the backlog grows ~700/s to ~400K after 10 minutes, and the last arrival waits ~400K ÷ 1K/s ≈ 7 minutes. Pick the admit rate from what the DB and payment provider sustain, then use backlog ÷ admit rate to publish an honest wait time.',
        },
      ],
      pitfalls: [
        'Multiplying the whole fleet by 20× including the database',
        'Assuming autoscaling makes pre-planning unnecessary',
        'Ignoring write amplification at the DB and third-party limits',
      ],
    },
    {
      id: 'fund-estimation-iq-03',
      difficulty: 'hard',
      question:
        'You told me you\'d cache 20% of daily reads based on the 80/20 rule. Defend that. How would you actually size this cache in production?',
      whatInterviewerLooksFor: [
        'Knows 80/20 is a heuristic and access skew varies (Zipf)',
        'Uses hit-ratio curves from real traces / sampled keys',
        'Accounts for Redis overhead, fragmentation, replicas, headroom',
        'Considers throughput, hot keys and TTL/staleness, not only memory',
      ],
      modelAnswer: `**The heuristic is a starting point.** Real access follows a Zipf-like distribution; the skew parameter decides whether the top 20% of keys serve 60% or 95% of reads. For a product catalog it's often very skewed; for a user-profile service with uniform logins, much less so.

**How I'd size it properly:**

1. **Measure the working set:** log a 1% sample of read keys for a week (or use Redis keyspace hit/miss stats in an existing cache). Compute unique keys per day and the frequency distribution.
2. **Build a hit-ratio curve:** simulate LRU/LFU at 5%, 10%, 20%, 40% of the key space using the trace (tools like simulated miss-ratio curves or mimircache style). Choose the "knee" — e.g. 15% of keys gives 92% hit ratio; 30% only gets 95%.
3. **Convert to bytes honestly:** keys × (value + key + ~50–100 B overhead) × ~1.3 fragmentation ÷ 0.75 maxmemory ratio, × replicas. For 10M keys × 2 KB that's ~27 GB data → ~36 GB RAM per copy → ~72 GB with one replica.
4. **Check the other limits:** peak ops/s per shard (~100K), bytes/s per NIC (2 KB × 100K = 200 MB/s ≈ 1.6 Gbps), and hot keys (a single key at 200K reads/s needs a local in-process L1 cache).
5. **Tie it to the backend:** the value of the cache is *miss traffic the DB can survive*. At 50K peak reads, 90% hit ratio sends 5K QPS to Postgres; 98% sends 1K. Size the cache to the hit ratio the DB needs, plus margin for a cold start.

**Then iterate in prod:** watch hit ratio, evictions/s and memory fragmentation; adjust TTLs before adding memory.`,
      followUps: [
        {
          q: 'What happens if you undersize and the cache runs at 70% hit ratio instead of 95%?',
          a: 'Misses go from 5% to 30% — a 6× increase in DB load. That non-linearity is why a small hit-ratio drop (e.g. after a deploy that changes key format) can take down the database.',
        },
        {
          q: 'LRU or LFU for this workload?',
          a: 'For stable popularity (catalog, celebrities) LFU (Redis allkeys-lfu) resists scan pollution; for recency-driven workloads (recent messages, sessions) LRU fits. The hit-ratio simulation should compare both.',
        },
      ],
      pitfalls: [
        'Treating 80/20 as a law of nature',
        'Sizing memory as keys × value bytes only',
        'Ignoring that the cache exists to protect a DB with a specific miss budget',
      ],
    },
    {
      id: 'fund-estimation-iq-04',
      difficulty: 'expert',
      question:
        'We need a p99 of 200 ms for a product-page API that calls pricing, inventory, reviews, recommendations and a personalization service. Use latency numbers to build a latency budget and tell me what\'s feasible.',
      whatInterviewerLooksFor: [
        'Uses realistic per-hop numbers (same-AZ RTT, cache GET, DB read, cross-region)',
        'Understands sequential vs parallel composition and tail amplification from fan-out',
        'Allocates budget per dependency with timeouts and fallbacks',
        'Identifies data-placement constraints (no cross-region on the hot path)',
      ],
      modelAnswer: `**Start from physics, not frameworks.** Typical numbers: same-AZ RTT ~0.2–0.5 ms, Redis GET ~0.5 ms end-to-end, indexed Postgres read ~1–3 ms, service-to-service call with TLS + JSON ~2–10 ms p50, **cross-region ~70 ms+ RTT**.

**Budget (p99 = 200 ms):**

| Stage | Budget |
|---|---|
| Edge/CDN + LB + TLS termination | ~20 ms (client RTT excluded or included? clarify) |
| Gateway + auth (cached JWT keys) | ~5 ms |
| Parallel fan-out: pricing, inventory, reviews, recs, personalization | ~120 ms (slowest wins) |
| Composition + serialization | ~10 ms |
| Safety margin (GC, retries) | ~45 ms |

**Key insight — fan-out amplifies tails.** If each of 5 parallel calls independently has a 1% chance of exceeding 100 ms, the chance that *at least one* exceeds it is 1 − 0.99^5 ≈ **4.9%** — so the page's p95 is roughly each dependency's p99. To hit page p99, each dependency needs roughly its **p99.8** under budget.

**Design moves:**
- Run all five **in parallel** with per-call timeouts (e.g. 100 ms) — sequentially it would be the sum.
- Classify: pricing + inventory are **required**; reviews/recs/personalization are **optional** → on timeout render without them (degrade, don't fail).
- **Hedged requests** for idempotent reads after the p95 latency (~20 ms) cut tails at ~5% extra load.
- Keep every hop **in-region**; a single cross-region call burns 35–50% of the budget. Replicate pricing data to each region.
- Cache product/pricing snapshots in Redis (0.5 ms) with short TTLs rather than calling pricing on every view.

**Feasible:** yes, comfortably, if the hot path is in-region, parallel and has fallbacks. Not feasible if any required call is cross-region or if calls are chained.`,
      followUps: [
        {
          q: 'Inventory is in another region because of a legacy DB. Now what?',
          a: 'Serve an eventually consistent inventory snapshot replicated to the local region (CDC → local cache) for display, and only do the authoritative cross-region check at add-to-cart/checkout where a 70–150 ms hit is acceptable.',
        },
        {
          q: 'How does retry policy interact with the budget?',
          a: 'A retry after a 100 ms timeout blows the 200 ms p99. Use at most one hedge/retry with a tight deadline propagated from the caller (deadline budget), and never retry non-idempotent calls blindly.',
        },
      ],
      pitfalls: [
        'Adding service latencies as if calls are sequential without questioning it',
        'Using average latency to budget a p99 SLO',
        'Ignoring cross-region physics and assuming "it\'s just an HTTP call"',
      ],
    },
    {
      id: 'fund-estimation-iq-05',
      difficulty: 'hard',
      question:
        'Estimate storage for a WhatsApp-style chat service over 5 years. What dominates, and how does the estimate drive your storage architecture and tiering?',
      whatInterviewerLooksFor: [
        'Separates message text, metadata/indexes and media',
        'Applies replication, retention and growth correctly',
        'Recognises write-heavy access with recency skew → hot/cold tiering',
        'Chooses storage engines based on the numbers (wide-column/LSM, object store)',
      ],
      modelAnswer: `**Assumptions:** 500M DAU, 40 messages sent/user/day, text message ~100 B payload + ~150 B metadata (IDs, timestamps, status) ≈ **250 B**; 5% of messages carry media averaging 300 KB (compressed image/voice); server stores messages until delivered + a 30-day history (clarify — WhatsApp historically deleted after delivery; many chat apps keep history forever).

**Load:** 500M × 40 = 20B messages/day ÷ 10^5 = **200K msgs/s avg, ~500K+ peak** — write-heavy.

**Text storage (keep forever variant):** 20B × 250 B = **5 TB/day** → 1.8 PB/year → ~9 PB over 5 years (flat), ~16 PB with 30% YoY compounding (×1.8 vs flat). With RF3 on an LSM store (Cassandra/ScyllaDB/HBase): ~50 PB, plus compaction headroom.

**Media:** 1B media/day × 300 KB = **300 TB/day** → ~550 PB over 5 years flat. **Media dominates by ~60×.** Goes to an erasure-coded object store (~1.4×), CDN for downloads, dedup by content hash (forwarded memes are heavily duplicated — dedup can save 30%+).

**Architecture decisions driven by the numbers:**
- 200K–500K writes/s with append-mostly, per-conversation reads → **wide-column/LSM store partitioned by conversation_id**, clustering by message time. B-tree RDBMS would struggle with write amplification at this scale.
- **Recency skew:** >90% of reads touch the last few days → hot tier on NVMe (last 7–30 days), older partitions compacted to cheaper HDD/object storage.
- **Retention is the biggest lever:** "delete after delivery + 30 days" collapses text storage from ~50 PB to well under 1 PB. Get a product decision on this first.
- Index sizing: secondary indexes (search) multiply storage — offer search on-device or only over recent history.`,
      followUps: [
        {
          q: 'How would end-to-end encryption change the estimate?',
          a: 'Payload size barely changes, but server-side dedup of media becomes impossible (ciphertexts differ) and server-side search disappears — storage for media rises and search indexes vanish from the estimate.',
        },
        {
          q: 'Group chats with 1,000 members — store one copy or 1,000?',
          a: 'Store the message once per conversation and a small per-recipient delivery record (~30–50 B). Fan-out copies of a 250 B message would multiply text storage up to 1,000× for large groups.',
        },
      ],
      pitfalls: [
        'Forgetting media or lumping it into the message database',
        'Ignoring retention policy as the dominant lever',
        'Not accounting for replication/compaction overhead on LSM stores',
      ],
    },
    {
      id: 'fund-estimation-iq-06',
      difficulty: 'expert',
      question:
        'We launched the service last month and our capacity estimate was off by 10× — the database is at 90% CPU at a traffic level we sized for 10% utilisation. How would you find which assumption was wrong, and how do you make estimates self-correcting going forward?',
      whatInterviewerLooksFor: [
        'Decomposes the estimate into measurable factors and checks each against telemetry',
        'Suspects multiplicative factors (fan-out, N+1, amplification) first',
        'Uses per-request cost metrics (queries/request, CPU-ms/request) not just totals',
        'Proposes a capacity model tied to production metrics and load tests',
      ],
      modelAnswer: `**A 10× miss is almost never one wrong input — it's a missed multiplier.** The estimate was DB QPS = users × actions × requests/action × queries/request. I'd check each factor against real telemetry.

**Decompose and compare:**

| Factor | Estimated | Measure with |
|---|---|---|
| DAU / active users | 1M | product analytics |
| Actions per user | 20/day | API gateway logs per user |
| API calls per action | 1 | tracing: spans per user action |
| DB queries per API call | 2 | APM query count per request / pg_stat_statements calls ÷ RPS |
| Cost per query | 1 ms CPU | pg_stat_statements mean_exec_time, EXPLAIN |
| Peak factor | 3× | per-second RPS p99 vs daily avg |

**Usual culprits, in order:**
1. **Queries per request** — an ORM N+1 (GraphQL resolvers are notorious) turning 2 queries into 40 → 20× alone. pg_stat_statements calls ÷ request count exposes it immediately.
2. **Fan-out per action** — a mobile screen making 8 API calls, or polling every 5 s instead of on-demand.
3. **Cost per query** — a missing index turning 1 ms point reads into 50 ms scans; or plans flipping after data grew.
4. **Retries and background jobs** not in the estimate — retry storms, cron reconciliation, analytics queries on the primary.

**Immediate relief:** fix the top pg_stat_statements offender, add the index, add a cache or read replica, rate-limit the chattiest client.

**Make it self-correcting:**
- Track **unit-cost metrics** on dashboards: DB queries/request, CPU-ms/request, bytes/request per endpoint. A deploy that doubles queries/request is caught in CI or the first hour.
- Keep a **capacity model** (spreadsheet or code) whose inputs are these live metrics; re-forecast monthly.
- **Load test** each release at 1.5× forecast peak; include performance budgets (e.g. "≤ 5 queries per request") in code review or tests.`,
      followUps: [
        {
          q: 'Traffic matches the estimate and queries/request match, yet CPU is 10× higher. Where next?',
          a: 'Cost per query: check pg_stat_statements for mean time and rows scanned, look for sequential scans from missing/unused indexes, lock contention, bloat/vacuum debt, or a plan regression after statistics changed.',
        },
        {
          q: 'How would you test the estimate before launch next time?',
          a: 'Replay or synthesize realistic traffic (not a single endpoint hammer) against production-like data volumes, measure unit costs, and extrapolate. Data volume matters — a 10 GB staging DB hides plans that fail at 2 TB.',
        },
      ],
      pitfalls: [
        'Immediately scaling up the DB without finding the multiplier',
        'Blaming the DAU estimate without checking per-request costs',
        'Treating estimation as a one-time exercise rather than a monitored model',
      ],
    },
    {
      id: 'fund-estimation-iq-07',
      difficulty: 'expert',
      question:
        'Our video platform\'s egress bill is now the largest line item. Estimate the peak bandwidth for 20M DAU watching ~60 minutes a day and walk me through which levers move the bill the most.',
      whatInterviewerLooksFor: [
        'Uses concurrency (Little\'s Law) rather than DAU for peak streams',
        'Converts bitrate × concurrency into Tbps and monthly PB correctly',
        'Quantifies levers: CDN/ISP caching, codec efficiency, ABR ladder, hit ratio',
        'Understands cost structure of cloud egress vs CDN vs peering',
      ],
      modelAnswer: `**Concurrency:** average concurrent viewers = 20M × 60 min ÷ 1,440 ≈ **833K**. Evening peak ~2× → **~1.7M concurrent streams**.

**Peak bandwidth:** average delivered bitrate ~4 Mbps (mix of 1080p at ~5 Mbps on TVs and ~1.5–2 Mbps on mobile) → 1.7M × 4 Mbps ≈ **6.8 Tbps** at peak.

**Monthly volume:** 20M users × 1 h × 4 Mbps (= 0.5 MB/s → 1.8 GB/hour) = **36 PB/day** ≈ **1.1 EB/month**. At a blended $0.01–0.02/GB CDN price that's ~**$11–22M/month**; at cloud list prices it would be several times worse — which is why this is the top line item.

**Levers, by impact:**
1. **Codec efficiency:** moving from H.264 to HEVC/AV1 cuts bitrate ~30–50% at equal quality — directly 30–50% of the bill. Encoding cost is one-time per title; egress is per view.
2. **ABR ladder tuning / per-title encoding:** cartoons need far less bitrate than sports; per-title ladders save ~20%.
3. **Where bytes come from:** ISP-embedded caches / peering (Netflix Open Connect model) make marginal bytes nearly free versus paid transit/cloud egress. Origin offload: at 98% edge hit ratio origin serves 136 Gbps instead of 6.8 Tbps.
4. **Hit ratio:** 95% → 99% cuts origin egress 5×; long-tail catalogs benefit from tiered caches/origin shield.
5. **Product defaults:** "data saver" defaults on mobile, stop streaming when the app is backgrounded, autoplay previews at low bitrate.

**Capacity check:** a modern edge appliance serves ~100–400 Gbps; 6.8 Tbps needs ~70 boxes at 100 Gbps even if perfectly placed — realistically hundreds across PoPs for locality and redundancy.`,
      followUps: [
        {
          q: 'Why not compute peak bandwidth from DAU × bitrate directly?',
          a: 'DAU are not all watching at once. Using 20M × 4 Mbps gives 80 Tbps — ~12× too high. Concurrency comes from DAU × watch time ÷ day length, then a peak factor.',
        },
        {
          q: 'Is storage or egress the bigger cost here?',
          a: 'Egress by orders of magnitude. Even a 100K-title catalog × 10 renditions × 3 GB ≈ 3 PB is stored once, while ~36 PB is delivered every day.',
        },
      ],
      pitfalls: [
        'Using DAU as concurrent viewers',
        'Mixing Mbps and MB/s',
        'Proposing only "add a CDN" without quantifying codec and hit-ratio levers',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'fund-estimation-boe-1',
      question:
        'Proximity service ("restaurants near me"): estimate search QPS and the memory needed for the geospatial index. Does the index force sharding?',
      assumptions: [
        '100M DAU, 5 searches per user per day',
        '200M businesses worldwide',
        'Geo index entry = business_id (8 B) + geohash/cell key (8 B) + lat/lng (2 × 8 B) ≈ 32 B, ×2 for index structure overhead',
        'Business detail row ≈ 1 KB',
        'Peak factor 3× (lunch/dinner in dominant regions)',
        'One read replica serves ~5K geo searches/s comfortably',
      ],
      steps: [
        { label: 'Average search QPS', calc: '100M × 5 ÷ 10^5 = 5,000 QPS' },
        { label: 'Peak search QPS', calc: '5,000 × 3 = 15,000 QPS' },
        { label: 'Geo index memory', calc: '200M × 32 B × 2 overhead ≈ 12.8 GB' },
        { label: 'Business table size', calc: '200M × 1 KB = 200 GB (writes are rare: owners edit listings)' },
        { label: 'Replicas for peak reads', calc: '15,000 ÷ 5,000 = 3 replicas, +1–2 for headroom/AZ loss ≈ 5' },
      ],
      answer:
        '~5K average / ~15K peak search QPS. The whole geo index is ~13 GB — it fits in RAM on one commodity server, and the 200 GB business table fits on one database node.',
      insight:
        'The numbers say "read-heavy, small index": scale by replicating the index/DB to ~5 read replicas (per region) rather than sharding. Sharding would add cross-shard radius queries for no benefit — exactly the conclusion Alex Xu reaches in Vol 2 Ch 1. Cache popular cells\' results, since lunchtime queries cluster in a few dense cities.',
      followUps: [
        {
          "q": "DAU grows 10× to 1B and the product adds an 'open now' filter. Does the index finally force sharding?",
          "a": "QPS grows to ~57.9K average and ~174K peak. At ~5K searches/s per replica that's ~35 replicas plus headroom — but the index is still 200M businesses × 64 B ≈ 13 GB, so each replica holds the full index and sharding is still unnecessary. Spread replicas across regions near users. 'Open now' adds a per-business hours check that can be evaluated after the geo lookup on a few hundred candidates, so it costs CPU, not memory."
        },
        {
          "q": "Business owners update hours and location more than expected: every one of the 200M businesses changes once per day. What breaks?",
          "a": "200M ÷ 86,400 ≈ 2.3K writes/s — easy for one primary, so throughput isn't the issue. Replicas apply the same 2.3K writes/s, and in-memory geo indexes must update incrementally (delete and re-insert the cell entry) rather than rebuilding nightly. The real question is freshness: if replica lag or an index rebuilding hourly is acceptable, nothing breaks. If owners expect instant visibility, route their own reads to the primary (read-your-writes) instead of making the whole index strongly consistent."
        }
      ],
    },
    {
      id: 'fund-estimation-boe-2',
      question:
        'Photo-sharing app: estimate total object storage over 5 years, including renditions, 30% YoY growth and durability overhead. How much does compounding matter?',
      assumptions: [
        '100M DAU; 10% upload one photo per day → 10M photos/day in year 1',
        'Original ≈ 3 MB; generated renditions (thumbnail, feed, full-screen) ≈ 1 MB total',
        'Upload volume grows 30% year over year (compounding)',
        'Object store uses erasure coding at ~1.5× raw (vs 3× replication)',
        'Nothing is deleted',
      ],
      steps: [
        { label: 'Bytes per upload', calc: '3 MB + 1 MB = 4 MB' },
        { label: 'Year-1 daily ingest', calc: '10M × 4 MB = 40 TB/day' },
        { label: 'Year-1 total', calc: '40 TB × 365 ≈ 14.6 PB' },
        { label: 'Compounding multiplier', calc: '1 + 1.3 + 1.69 + 2.197 + 2.856 ≈ 9.04' },
        { label: '5-year logical', calc: '14.6 PB × 9.04 ≈ 132 PB (vs 73 PB assuming flat traffic)' },
        { label: 'Physical with EC', calc: '132 PB × 1.5 ≈ 198 PB ≈ 200 PB (3× replication would be ~400 PB)' },
        { label: 'Upload ingress (year 1 peak)', calc: '40 TB ÷ 86,400 s ≈ 463 MB/s avg × 3 peak ≈ 1.4 GB/s ≈ 11 Gbps' },
      ],
      answer:
        '~130 PB logical and ~200 PB physical after 5 years with erasure coding. Ignoring growth underestimates by ~45%; using 3× replication instead of EC doubles the bill.',
      insight:
        'Originals are 75% of bytes but are rarely read after the first weeks → lifecycle them to an infrequent-access/archive tier (often 5–20× cheaper per GB) after ~30–90 days while keeping renditions hot behind the CDN. Erasure coding over replication is a ~2× cost decision at this scale, and ingress of ~11 Gbps peak argues for direct-to-object-store uploads via pre-signed URLs rather than proxying through API servers.',
      followUps: [
        {
          "q": "Growth turns out to be 60% YoY instead of 30%. Redo the 5-year number.",
          "a": "The multiplier becomes 1 + 1.6 + 2.56 + 4.096 + 6.554 ≈ 15.8 instead of 9.04. 14.6 PB × 15.8 ≈ 231 PB logical, × 1.5 EC ≈ 346 PB physical — about 75% more than the 30% plan. Note that year 5 alone is ~6.5× year 1, so ingress bandwidth and object-store request rates must also be re-planned. Because growth rates are the least certain input, present the forecast as a range across growth scenarios and revisit it quarterly against actuals."
        },
        {
          "q": "Originals move to an archive tier after 90 days. In year 5, what fraction of stored bytes is still on the hot tier?",
          "a": "Year-5 daily ingest is 40 TB × 2.856 ≈ 114 TB/day. 90 days of that is ~10.3 PB, which is ~8% of the ~132 PB logical total — and even that overstates it, since only renditions need to stay hot. So >90% of bytes can sit on an archive class priced at a fraction of standard storage. The catch: archive tiers charge retrieval fees and take minutes to hours, so original downloads ('download full resolution') must be rare or served from a rendition."
        }
      ],
    },
    {
      id: 'fund-estimation-boe-3',
      question:
        'E-commerce product-detail cache: size the Redis cluster (memory, primaries, replicas) for the hot catalog at peak.',
      assumptions: [
        '50M SKUs; 20% are "hot" and serve ~80% of reads → 10M cached keys',
        'Serialized product JSON ≈ 2 KB; key ≈ 40 B ("pdp:v3:<sku>")',
        'Redis per-key overhead ≈ 80 B; fragmentation ratio ≈ 1.2',
        'Peak product-detail reads: 150K/s; ~95% hit ratio target',
        'Safe per-primary throughput with 2 KB values ≈ 50K ops/s; maxmemory = 75% of node RAM',
        '1 replica per primary',
      ],
      steps: [
        { label: 'Bytes per key', calc: '2,000 + 40 + 80 = 2,120 B' },
        { label: 'Data in RAM', calc: '10M × 2,120 B × 1.2 ≈ 25.4 GB' },
        { label: 'Primaries by throughput', calc: '150K ÷ 50K = 3 primaries' },
        { label: 'Network check', calc: '150K × 2 KB = 300 MB/s ≈ 2.4 Gbps total → ~0.8 Gbps per primary (fine on 10 Gbps)' },
        { label: 'Memory per primary', calc: '25.4 GB ÷ 3 ≈ 8.5 GB → RAM ≥ 8.5 ÷ 0.75 ≈ 11.3 GB → ~13 GB nodes' },
        { label: 'Total nodes', calc: '3 primaries + 3 replicas = 6 × ~13 GB nodes (~78 GB RAM)' },
        { label: 'DB miss load', calc: '150K × 5% = 7.5K QPS to the catalog DB at peak' },
      ],
      answer:
        '~25 GB of cached data → 3 primaries + 3 replicas on ~13 GB nodes. Throughput, not memory, sets the shard count; the DB must still absorb ~7.5K QPS of misses.',
      insight:
        'Memory alone would suggest 2 nodes; throughput says 3. Compressing values (zstd/snappy on JSON often gives 3–4×) shrinks both memory and network, and switching to msgpack/protobuf helps further. Because the DB depends on a 95% hit ratio, plan cache warm-up after deploys/failovers and guard against stampedes on sale SKUs.',
      followUps: [
        {
          "q": "You compress values with zstd at ~3.5×. Redo memory and network. Does the shard count change?",
          "a": "Values shrink to ~2,000 ÷ 3.5 ≈ 571 B, so each key is ~691 B with key and overhead. 10M × 691 B × 1.2 ≈ 8.3 GB of data — under one node's worth. Network falls to 150K × 571 B ≈ 86 MB/s ≈ 0.69 Gbps total. But throughput is unchanged at 150K ops/s, so you still need 3 primaries (and their replicas) — just smaller and cheaper nodes. The CPU cost of decompression moves to the app pods, which is usually cheaper than Redis RAM."
        },
        {
          "q": "One of the 3 primaries fails and its slots go cold before the replica is promoted. What hits the database?",
          "a": "A third of the hits turn into misses. DB load becomes 150K × (0.05 + 0.95 ÷ 3) ≈ 55K QPS instead of 7.5K — about 7× the planned miss load, which the catalog DB can't absorb. That's why replicas exist: automatic promotion keeps the slot warm in seconds. Also add request coalescing (single-flight per key) so concurrent misses for the same SKU make one DB call, and a rate limit or circuit breaker on DB fallback so the cache layer degrades by serving stale data rather than stampeding."
        }
      ],
    },
    {
      id: 'fund-estimation-boe-4',
      question:
        'NestJS API fleet: estimate vCPUs and pods at peak for 30M DAU, and how many Postgres connections the fleet actually needs versus what it will open.',
      assumptions: [
        '30M DAU × 50 API calls per user per day',
        'Peak factor 3×',
        'Measured CPU cost ≈ 8 ms per request (auth, validation, serialization)',
        'Target CPU utilization 60%; 2-vCPU pods (2 Node processes per pod); 3 AZs',
        'Each request runs 2 queries × 1.5 ms = 3 ms holding a DB connection',
        'Default pool size 10 per pod',
      ],
      steps: [
        { label: 'Average QPS', calc: '30M × 50 = 1.5B/day ÷ 86,400 ≈ 17.4K QPS' },
        { label: 'Peak QPS', calc: '17.4K × 3 ≈ 52K QPS' },
        { label: 'Busy cores at peak', calc: '52K × 0.008 s ≈ 416 cores' },
        { label: 'Provisioned vCPU', calc: '416 ÷ 0.6 ≈ 694 vCPU' },
        { label: 'Pods', calc: '694 ÷ 2 ≈ 347 → round to 348 (multiple of 3 AZs)' },
        { label: 'AZ-loss check', calc: '60% × 3/2 = 90% CPU on survivors → acceptable, no extra multiplier' },
        { label: 'DB connections needed (Little\'s Law)', calc: '52K × 0.003 s ≈ 156 concurrently busy connections' },
        { label: 'DB connections opened', calc: '348 pods × 10 = 3,480 connections' },
      ],
      answer:
        '~700 vCPU ≈ 348 two-vCPU pods at peak. The database needs only ~160 busy connections, but the fleet would open ~3,500.',
      insight:
        'Postgres backends are processes costing several MB each and contend on locks/snapshots; 3,500 connections degrade throughput long before CPU runs out. Put PgBouncer (transaction pooling) or RDS Proxy in front with ~200–300 server connections, shrink per-pod pools to 2–4, and tie HPA max replicas to the connection budget. Also: 8 ms CPU/request is the lever — halving it (caching auth, cheaper serialization) saves ~170 pods.',
      followUps: [
        {
          "q": "During a vacuum, average query time goes from 1.5 ms to 10 ms. What happens to connection demand at peak?",
          "a": "Each request holds a connection for 2 × 10 ms = 20 ms, so busy connections become 52K × 0.020 ≈ 1,040, up from ~156. With PgBouncer at ~300 server connections, ~740 requests' worth of work queue in the pooler, latency balloons, and pods' request queues fill. Pool sizing alone can't fix this. Bound queue waits (fail fast after ~100 ms), shed lower-priority traffic, and fix the cause: tune autovacuum to run more often in smaller chunks, so it never produces a 7× slowdown at peak."
        },
        {
          "q": "A 15-minute campaign pushes traffic to 10× average instead of 3×. How many pods, and is that realistic?",
          "a": "10 × 17.4K ≈ 174K QPS × 0.008 s ≈ 1,392 busy cores, ÷ 0.6 ≈ 2,320 vCPU ≈ 1,160 two-vCPU pods — over 3× the normal 348. HPA plus node autoscaling takes minutes, so for a scheduled campaign, pre-scale ahead of time. Even then, the database won't scale 3× on demand, so cache the hot campaign pages, use a waiting room or queue for writes, and keep pools small so 1,160 pods don't open 11,600 connections."
        }
      ],
    },
    {
      id: 'fund-estimation-boe-5',
      question:
        'Centralized logging for 2,000 pods: estimate ingress bandwidth, Kafka buffer storage, and the Elasticsearch hot tier. Which number drives cost?',
      assumptions: [
        '2,000 pods × 200 log lines/s each at ~500 B per structured JSON line',
        'Kafka buffer: 3-day retention, RF=3, zstd compression ~5×',
        'Elasticsearch hot tier: 7 days, 1 replica, on-disk size ≈ 1.1× raw after its own compression + indexing',
        'Archive to object storage for 1 year, compressed 5×',
        '~10 MB/s safe producer throughput per Kafka partition',
      ],
      steps: [
        { label: 'Lines per second', calc: '2,000 × 200 = 400K lines/s' },
        { label: 'Ingress bandwidth', calc: '400K × 500 B = 200 MB/s × 8 = 1.6 Gbps' },
        { label: 'Raw per day', calc: '200 MB/s × 86,400 ≈ 17.3 TB/day' },
        { label: 'Kafka storage', calc: '17.3 TB × 3 days × RF3 ÷ 5 compression ≈ 31 TB' },
        { label: 'Kafka partitions (minimum)', calc: '200 MB/s ÷ 10 MB/s = 20 → choose ~48–64 for consumer parallelism and growth' },
        { label: 'Elasticsearch hot tier', calc: '17.3 TB × 7 days × 2 copies × 1.1 ≈ 266 TB' },
        { label: '1-year archive', calc: '17.3 TB × 365 ÷ 5 ≈ 1.26 PB in object storage' },
      ],
      answer:
        '~1.6 Gbps ingress, ~31 TB of Kafka buffer, ~266 TB of Elasticsearch hot storage, ~1.3 PB/year archived.',
      insight:
        'The full-text-indexed hot tier (SSD, replicated) is by far the most expensive component — roughly 10× the Kafka footprint on premium disk. Levers: drop or sample DEBUG/INFO at the source (often 50–80% of volume), cut hot retention to 3 days, or use a label-indexed store on object storage (Loki-style) where only metadata is indexed. Ingress at 1.6 Gbps is easy; storage policy is the design decision.',
      followUps: [
        {
          "q": "An incident makes log volume spike 10× (to ~2 GB/s) for 30 minutes. You provisioned 64 partitions at ~10 MB/s each. What happens?",
          "a": "Ingress jumps to ~16 Gbps and the topic can take only ~640 MB/s, so producers back up: (2,000 − 640) MB/s × 1,800 s ≈ 2.4 TB that either buffers in shipper memory or disk, or is dropped. Shippers like Fluent Bit or Vector need disk buffers sized for this, and should drop or sample DEBUG first when the buffer passes a threshold. Error logs should go to a separate high-priority topic so the logs you need during the incident aren't lost behind the noise."
        },
        {
          "q": "You sample INFO/DEBUG down so that 70% of volume disappears before indexing. What does the hot tier cost now?",
          "a": "The hot tier scales linearly with indexed volume: 266 TB × 0.3 ≈ 80 TB, a cut of ~186 TB of replicated SSD. Kafka and archive shrink too if sampling happens at the shipper. The risk is losing the one log you need: keep 100% of ERROR/WARN, sample by trace ID (keep or drop entire traces consistently) rather than per line, and allow per-service overrides during debugging. Measure the cost per service so teams see the bill for their verbosity."
        }
      ],
    },
    {
      id: 'fund-estimation-boe-6',
      question:
        'Arithmetic drill: a video platform has 500M DAU watching 40 minutes a day at an average 3 Mbps. Estimate average and peak egress, and bytes delivered per day. Do it in scientific notation.',
      assumptions: [
        '500M DAU = 5 × 10^8; 40 min = 2.4 × 10^3 s of viewing per user per day',
        'Average bitrate 3 Mbps = 3 × 10^6 bits/s across devices',
        'Peak concurrency ≈ 2× average (evening prime time)',
        'Ignore protocol overhead (a few %)',
      ],
      steps: [
        { label: 'Viewing-seconds per day', calc: '(5 × 10^8) × (2.4 × 10^3) = 12 × 10^11 = 1.2 × 10^12 s' },
        { label: 'Average concurrent viewers', calc: '1.2 × 10^12 ÷ 8.64 × 10^4 ≈ 0.14 × 10^8 = 1.4 × 10^7 (14M)' },
        { label: 'Average egress', calc: '(1.4 × 10^7) × (3 × 10^6 bps) = 4.2 × 10^13 bps = 42 Tbps' },
        { label: 'Peak egress', calc: '42 Tbps × 2 ≈ 84 Tbps' },
        { label: 'Bytes per day', calc: '(1.2 × 10^12 s) × (3 × 10^6 b/s) ÷ 8 = 4.5 × 10^17 B = 450 PB/day' },
        { label: 'Servers at peak (NIC limit only)', calc: '84 × 10^12 ÷ 10^10 bps per 10 Gbps NIC = 8.4 × 10^3 ≈ 8,400 servers' },
      ],
      answer: '~42 Tbps average and ~84 Tbps at peak; about 450 PB delivered per day, needing ~8,400 fully loaded 10 Gbps servers at peak.',
      insight:
        'No central origin can push 84 Tbps; the only viable design is a CDN with caches embedded inside ISPs (Netflix Open Connect-style), with origin traffic limited to cache fills. The biggest lever is bitrate: a codec that is 30% more efficient (for example AV1 over H.264) removes ~25 Tbps at peak, which is worth more than any server optimisation.',
      followUps: [
        {
          "q": "Only 60% of viewing devices support the new codec that is 30% more efficient. How much peak egress do you actually save?",
          "a": "If the codec applied to all traffic, savings would be 84 × 0.3 ≈ 25 Tbps. With 60% of viewing on capable devices: 84 × 0.6 × 0.3 ≈ 15 Tbps. You also pay to store and encode a second set of renditions, so you'd encode AV1 only for the popular head of the catalogue, where most of the viewing happens. Over time, as device support grows, the saving approaches the full 25 Tbps."
        },
        {
          "q": "ISP-embedded caches serve 98% of bytes. How much traffic hits your origin at peak, and what sizes it?",
          "a": "2% of 84 Tbps ≈ 1.7 Tbps of origin and fill traffic at peak, still huge, which is why fills are scheduled off-peak: popular titles are pushed to caches overnight, so peak-time origin traffic is mostly long-tail misses. The origin is sized by the long-tail miss rate and the fill window, not by viewing. A 1% change in cache hit ratio is ~0.84 Tbps at peak, so catalogue placement (predicting what each cache should hold) matters more than origin server count."
        }
      ],
    },
    {
      id: 'fund-estimation-boe-7',
      question:
        'Arithmetic drill: a chat app stores 2B messages per day, about 100 B each, kept forever. Estimate write QPS, storage per year, and 10-year storage with metadata and replication.',
      assumptions: [
        '2B messages/day = 2 × 10^9; 100 B payload = 10^2 B',
        'Peak writes ≈ 3× average',
        'Indexes and metadata double the stored size (×2)',
        'Replication factor 3; 1 year ≈ 3.65 × 10^2 days',
      ],
      steps: [
        { label: 'Average writes/s', calc: '2 × 10^9 ÷ 10^5 = 2 × 10^4 = 20K/s (exact ÷86,400 ≈ 23K/s)' },
        { label: 'Peak writes/s', calc: '2 × 10^4 × 3 = 6 × 10^4 = 60K/s' },
        { label: 'Raw bytes per day', calc: '(2 × 10^9) × (10^2 B) = 2 × 10^11 B = 200 GB/day' },
        { label: 'Raw bytes per year', calc: '(2 × 10^11) × (3.65 × 10^2) ≈ 7.3 × 10^13 B = 73 TB/year' },
        { label: '10 years with metadata and RF3', calc: '7.3 × 10^13 × 10 × 2 × 3 ≈ 4.4 × 10^15 B = 4.4 PB' },
      ],
      answer: '~20–23K writes/s average and ~60K at peak; ~73 TB/year raw, and ~4.4 PB stored after 10 years with metadata and 3 replicas.',
      insight:
        '60K writes/s is beyond a single Postgres primary, so partition by conversation_id in a wide-column store (Cassandra/ScyllaDB, as Discord and Messenger do). Over time, storage, not throughput, decides the node count: 4.4 PB at ~5 TB usable per node is ~900 nodes. That makes tiering old conversations to object storage the real cost lever, and text is cheap next to the media that users attach.',
      followUps: [
        {
          "q": "5% of messages carry a 200 KB photo. How does that change the storage picture?",
          "a": "Media: 2B × 0.05 × 200 KB ≈ 20 TB/day ≈ 7.3 PB/year, versus ~73 TB/year of text — about 100× more. So media decides storage cost, and it belongs in object storage (content-addressed, deduplicated for forwarded media, erasure-coded rather than RF3), with the message row holding only a reference. Text can stay in the wide-column store. Media can be tiered by age as well, since old photos are rarely reopened."
        },
        {
          "q": "Messages older than 1 year move to object storage. How many 5 TB-usable database nodes do you need instead of ~900?",
          "a": "The database then holds about 1 year: 73 TB × 2 (metadata) × 3 (RF) ≈ 438 TB, ÷ 5 TB ≈ 88 nodes — about 10× fewer than ~880 for 10 years. Older messages go to compressed files in object storage, keyed by conversation and month. The cost is a slower 'scroll back to 2019' path, which can be served by fetching a whole month's file for that conversation on demand. Check the 60K peak writes/s still fit within 88 nodes."
        }
      ],
    },
    {
      id: 'fund-estimation-boe-8',
      question:
        'Arithmetic drill: a ride-hailing app has 5M drivers online, each sending a location ping every 4 s (~100 B). Estimate write rate, ingress bandwidth, daily history volume and the size of the "current location" state.',
      assumptions: [
        '5M drivers online = 5 × 10^6 (peak hour)',
        'One ping every 4 s, ~100 B including metadata',
        'Keep full history for analytics and disputes; keep only the latest ping for matching',
      ],
      steps: [
        { label: 'Pings per second', calc: '5 × 10^6 ÷ 4 = 1.25 × 10^6 writes/s' },
        { label: 'Ingress bandwidth', calc: '(1.25 × 10^6) × (10^2 B) = 1.25 × 10^8 B/s = 125 MB/s × 8 = 1 Gbps' },
        { label: 'Pings per day (if sustained)', calc: '(1.25 × 10^6) × (8.64 × 10^4) ≈ 1.1 × 10^11' },
        { label: 'History per day', calc: '(1.1 × 10^11) × (10^2 B) = 1.1 × 10^13 B ≈ 11 TB/day' },
        { label: 'Current-location state', calc: '(5 × 10^6) × (10^2 B) = 5 × 10^8 B = 500 MB' },
      ],
      answer: '~1.25M writes/s and ~1 Gbps of ingress; up to ~11 TB/day of history; but only ~500 MB of current-location state.',
      insight:
        'The numbers split the design in two. 1.25M writes/s would crush any transactional database, but the state matching needs is only 500 MB, small enough to keep in memory in a geo index (Redis GEO or H3 cells, sharded by city). The history goes to Kafka and then batch-compressed into object storage, never through the primary database. Bandwidth, at 1 Gbps, is the easy part.',
      followUps: [
        {
          "q": "Product wants a ping every 1 s instead of every 4 s for smoother maps. Redo the numbers.",
          "a": "Writes go 4× to 5M/s, ingress to 5M × 100 B = 500 MB/s ≈ 4 Gbps, and history to 5M × 86,400 × 100 B ≈ 43 TB/day if sustained. Current-location state is still ~500 MB, since it stores only the latest point. Cheaper alternatives: send at 1 s only during active trips and slower when idle, client-side dead reckoning to interpolate between pings on the rider's map, and downsampling history (e.g. keep every 4th point plus turns)."
        },
        {
          "q": "Current locations live in Redis GEO. At 1.25M updates/s, how do you shard it, and what goes wrong if you shard by driver ID?",
          "a": "At ~100K ops/s per shard you need at least ~13 shards. Sharding by driver ID spreads writes evenly, but a 'drivers near me' query must then hit every shard — 13× read fan-out on every match request. Shard by geography (city or H3 cell) instead, so a query hits one or two shards. The catch is hot cities: split dense ones into multiple cells and shards, and move a driver's entry between shards as they cross cell boundaries."
        }
      ],
    },
  ],
  test: [
    {
      id: 'fund-estimation-mcq-01',
      difficulty: 'medium',
      question:
        'A PM says the new API will serve "about a billion requests a day", mostly from one country. Which average and peak QPS is the most defensible first estimate?',
      options: [
        '~1.2K average, ~3.5K peak',
        '~12K average, ~30–35K peak',
        '~120K average, ~360K peak',
        '~12K average; peak ≈ average because traffic is spread over 24 h',
      ],
      correct: [1],
      explanation:
        '10^9 ÷ 86,400 ≈ 11.6K (≈ 10K using the 10^5 trick), and a single-country audience produces a pronounced evening peak of 2–3×, so ~30–35K. The 1.2K and 120K options are order-of-magnitude slips in the division. Assuming peak equals average ignores diurnal patterns — valid only for machine-to-machine traffic with flat load.',
      followUps: [
        {
          "q": "Each request does 3 database reads and the cache in front has a 90% hit ratio. What QPS does the database actually see at the ~35K peak?",
          "a": "35K requests/s × 3 reads = 105K read lookups/s, and only the 10% misses reach the database: ~10.5K QPS. That is well within a primary plus a couple of replicas. Now note the sensitivity: if the hit ratio drops to 80% after a deploy flushes the cache, DB load doubles to ~21K QPS, even though user traffic hasn't changed. That's why the hit ratio, not user QPS, belongs in the database capacity plan, and why cache warm-up after deploys matters."
        },
        {
          "q": "During a partial outage, clients retry each failed call up to 3 times with no backoff. What does the 35K peak become, and what do you change?",
          "a": "In the worst case every request is attempted 4 times, so the struggling backend sees up to ~140K QPS — 4× load exactly when it has the least capacity, which turns a blip into a sustained outage. Fixes: exponential backoff with jitter, a retry budget (e.g. retries ≤ 10% of requests, enforced per client), retrying only idempotent calls, and server-side load shedding returning 429/503 with Retry-After so clients slow down instead of hammering."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-02',
      difficulty: 'hard',
      question:
        'This script sizes a WebSocket gateway for a chat app. Users are online ~30 minutes/day on average. Roughly how many pods are actually needed at peak (before extra headroom)?',
      code: {
        language: 'typescript',
        code: `const dau = 20_000_000;
const avgMinutesOnlinePerDay = 30;
const peakFactor = 2;
const connsPerPod = 50_000; // measured max per gateway pod

const concurrent = dau * peakFactor;
const pods = Math.ceil(concurrent / connsPerPod);
console.log(pods); // 800`,
      },
      options: [
        '800 — the script is correct because every DAU holds a socket at peak',
        '~400 — the script only double-counts the peak factor',
        '~17 — concurrency is DAU × 30/1,440 ≈ 417K, ×2 peak ≈ 833K sockets',
        '~9 — peak factor should not be applied to long-lived connections',
      ],
      correct: [2],
      explanation:
        'By Little\'s Law, average concurrent users = 20M × 30 min ÷ 1,440 min ≈ 417K; with a 2× peak that is ~833K sockets ÷ 50K ≈ 17 pods (you would then add headroom for AZ loss and reconnect storms). The script treats DAU as concurrency — a 48× overestimate. Removing the peak factor (~9 pods) is wrong because evening concurrency really is higher than the daily average.',
      followUps: [
        {
          "q": "You roll a new gateway version across the 17 pods. Every client on a drained pod reconnects within ~30 s. What reconnect rate must the fleet absorb?",
          "a": "If all ~833K sockets cycle within a 30 s window during a fast rollout, that's ~27.8K handshakes/s fleet-wide, about 1.6K per pod — and TLS handshakes plus auth are far more CPU-expensive than holding an idle socket. Draining one pod at a time is gentler: 50K clients spread over 16 remaining pods is ~3.1K extra connections each. Clients should reconnect with jittered backoff, and pods should drain gradually (close connections over minutes, not instantly) so the handshake rate stays bounded."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-03',
      difficulty: 'expert',
      question:
        'You are forecasting 5-year provisioned disk for a Postgres-backed orders service. Select ALL factors that materially change the number.',
      options: [
        'Replication topology (primary + 2 streaming replicas each hold a full copy)',
        'B-tree secondary indexes plus per-row tuple headers',
        'The API\'s read:write ratio',
        'Year-over-year order growth compounding over the period',
        'The connection pool size configured on each application pod',
      ],
      correct: [0, 1, 3],
      explanation:
        'Each replica stores a full copy (3×), indexes and ~24 B tuple headers commonly add 30–100%, and compounding growth at 30% YoY makes 5 years ≈ 9× year-1 volume rather than 5×. The read:write ratio changes compute and caching needs, but reads do not add stored bytes — only the write volume does. Pool size affects DB memory and CPU, not disk.',
      followUps: [
        {
          "q": "Year-1 volume is 50M orders × 2 KB, growth is 30% YoY, indexes add 1.5×, 3 copies, disks ≤ 75% full. What do you provision for 5 years?",
          "a": "Year-1 raw is 50M × 2 KB = 100 GB. Compounding over 5 years multiplies year 1 by ~9.04, so ~904 GB logical. × 3 copies × 1.5 overhead ≈ 4.07 TB, ÷ 0.75 fill ≈ 5.4 TB of provisioned disk across the cluster (~1.8 TB per node). It is small enough that one Postgres primary with replicas handles storage comfortably — the forecast says sharding for disk is not needed, so the decision rests on write throughput instead."
        },
        {
          "q": "Legal says orders older than 2 years can move to an archive. How much does that change the provisioned disk at year 5?",
          "a": "Only years 4 and 5 stay hot: 100 GB × (2.197 + 2.856) ≈ 505 GB logical. × 3 copies × 1.5 ÷ 0.75 ≈ 3.0 TB instead of ~5.4 TB — about 44% less, and the saving grows every year because the hot set is bounded while the archive keeps growing. Implement it with monthly range partitions so archiving is a cheap DETACH + export to Parquet in object storage, rather than a massive DELETE that bloats the table and hammers vacuum."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-04',
      difficulty: 'hard',
      question:
        'An endpoint loops over 40 cart items and awaits a pricing call for each, one after another. Pricing moves from the same AZ (~2 ms per call) to another region (~70 ms RTT). Keep-alive and HTTP/2 are enabled. What happens to endpoint latency?',
      options: [
        'It rises to roughly 2.9 s, because every sequential call pays the cross-region round trip',
        'It rises to ~110 ms, because keep-alive means only the first call pays the RTT',
        'It rises to ~150 ms, because HTTP/2 multiplexes the 40 calls onto one connection',
        'It barely changes, because TLS session resumption removes the extra round trips',
      ],
      correct: [0],
      explanation:
        '40 sequential awaits × ~72 ms ≈ 2.9 s. Keep-alive and TLS resumption only avoid the TCP/TLS handshakes; every request still needs at least one round trip. HTTP/2 multiplexing helps only if the requests are issued concurrently — the code awaits each one serially. The fix is batching (one bulk pricing call), parallelism, or keeping pricing data in-region.',
      followUps: [
        {
          "q": "You parallelise the 40 calls, but the pricing service limits each client to 10 concurrent requests. What latency do you get now?",
          "a": "With 10 in flight at once, 40 calls run in 4 waves of ~72 ms each: ~288 ms — far better than 2.9 s but still bad for a cart page. The real fix is a bulk endpoint (one request with 40 SKUs, ~72 ms plus server time). If you can't change the pricing API, keep a regional cache of prices fed by change events (CDC) or a short TTL, so the cart reads locally in milliseconds and only cache misses cross regions."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-05',
      difficulty: 'expert',
      question:
        'You need a Redis cache for 100M session keys (~30 B key, ~100 B value) with one replica per primary. Which is the most realistic total RAM to provision across the cluster?',
      options: [
        '~13 GB — keys plus values is the working set',
        '~20 GB — add per-key overhead and you are done',
        '~64 GB — per-key overhead, fragmentation, maxmemory headroom and a replica',
        '~130 GB — Redis generally stores about 10× the raw payload',
      ],
      correct: [2],
      explanation:
        'Payload is 100M × 130 B = 13 GB, but small keys pay ~50–100 B of dict/object/expiry overhead → ~20 GB; ×~1.2 fragmentation ≈ 24 GB; keeping maxmemory at ~75% of RAM (fork/COW, buffers) → ~32 GB per copy; ×2 for the replica ≈ 64 GB. Stopping at 20 GB leaves no room for fragmentation or BGSAVE. "10× payload" is not a real rule — overhead is per key, so it depends on value size.',
      followUps: [
        {
          "q": "Product wants to store the full user profile (~1 KB) in each session instead of 100 B. Redo the sizing.",
          "a": "Per key: 30 B key + 1,000 B value + ~80 B overhead ≈ 1,110 B. 100M × 1,110 B ≈ 111 GB, × 1.2 fragmentation ≈ 133 GB, ÷ 0.75 maxmemory headroom ≈ 178 GB per copy, × 2 with a replica ≈ 355 GB — over 5× the original. That's a multi-shard cluster just to duplicate data that already lives in the user service. Better to keep sessions small (IDs and claims) and cache profiles separately, keyed by user, so 100M sessions don't hold 100M copies of profile data."
        },
        {
          "q": "Analytics shows only ~15% of the 100M sessions are touched in any 30-minute window. Does that change the size?",
          "a": "It changes the TTL decision. If sessions use a sliding 30-minute idle TTL, only ~15M are alive at once, so memory falls to roughly 15% of the estimate: ~64 GB × 0.15 ≈ 10 GB total with the replica. If the product needs 30-day 'remember me', keep a long-lived refresh token in a durable store and a short-lived session in Redis that's recreated on demand. Size Redis for the active set, not the total user base."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-06',
      difficulty: 'hard',
      question:
        'Average traffic is 5K QPS with a 2.5× evening peak. Marketing announces a flash sale at 20:00 that historically brings 10× the normal peak for about 5 minutes. What is the best capacity plan?',
      options: [
        'Permanently provision for ~125K QPS so the sale is safe',
        'Size for ~12.5K and let HPA scale on CPU when the sale starts',
        'Size for the 5K average; the sale is short and clients will retry',
        'Size for ~12.5K with headroom; pre-scale stateless tiers, pre-warm caches, and protect the DB with a queue or waiting room',
      ],
      correct: [3],
      explanation:
        'A known 5-minute 10× spike at a fixed time is handled by scheduled pre-scaling plus admission control, because HPA and node autoscaling lag by minutes and the database does not scale on demand. Permanent provisioning for 125K wastes ~10× capacity 99.9% of the time. Sizing for average ignores the daily peak, and client retries amplify overload rather than absorb it.',
      followUps: [
        {
          "q": "Your database can take at most 20K QPS and an active shopper generates ~10 queries per minute. How many shoppers can the waiting room admit concurrently?",
          "a": "20K queries/s × 60 s = 1.2M queries per minute of capacity. At 10 queries per shopper per minute, that's ~120K concurrent shoppers. Keep a margin (say admit ~100K) so the DB stays near 80% instead of at the cliff. The waiting room then admits new users only as sessions end or time out; with 5-minute average sessions it releases ~20K users per minute. Tune this using the DB's live latency, not just the static number."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-07',
      difficulty: 'expert',
      question:
        'A teammate sizes the Postgres pool for each pod with this code. What is the correct reading?',
      code: {
        language: 'typescript',
        code: `const rpsPerPod = 2_000;
const queriesPerRequest = 3;
const avgQueryMs = 5;

// "Little's Law"
const poolSize = rpsPerPod * queriesPerRequest * avgQueryMs;
console.log(poolSize); // 30000`,
      },
      options: [
        '30,000 is right; Little\'s Law says concurrency is rate times latency',
        'Only ~30 connections are busy on average — ms were not converted to seconds; ~40–50 with headroom is plenty',
        'About 6 connections; queries per request should not multiply the rate',
        'About 300 connections; Little\'s Law must use p99 latency, which is ~10× the average',
      ],
      correct: [1],
      explanation:
        'L = λ × W with consistent units: 6,000 queries/s × 0.005 s = 30 concurrently busy connections. The code multiplies by milliseconds, inflating the answer 1,000×. Queries per request do multiply the arrival rate at the DB. p99 latency is useful for headroom, but Little\'s Law uses the mean time in system; a modest buffer above 30 is the right call, not 10×.',
      followUps: [
        {
          "q": "With ~40 connections per pod and 20 pods, what does Postgres see, and what happens when average query time spikes to 50 ms during a vacuum?",
          "a": "Postgres sees 20 × 40 = 800 connections, more than typical max_connections and far more than it can run efficiently. When queries slow to 50 ms, each pod needs 6,000 × 0.05 = 300 busy connections, 10× the pool, so requests queue in the pool and then time out. Bigger pools would only overload the DB more. Put PgBouncer in transaction mode in front, keep pools small, set a short acquire timeout so requests fail fast, and shed load when the queue grows."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-08',
      difficulty: 'expert',
      question:
        'You are deciding where to serve a 1 MB blob from. Select ALL statements that are true.',
      options: [
        'A 1 MB sequential read from local NVMe (~0.3 ms) is in the same ballpark as fetching it from another server\'s RAM in the same AZ over 10 Gbps (~1 ms including RTT)',
        'A remote in-memory cache in the same DC will be ~100× faster than local NVMe, because RAM is ~1,000× faster than SSD',
        'A single random 4 KB read from a spinning disk (~10 ms seek) is slower than reading the whole 1 MB sequentially from local NVMe',
        'Compressing the blob with LZ4 before sending it across regions costs more time than it saves',
        'Across regions (~70 ms RTT), the round trips dominate — not the ~0.8 ms it takes to transmit 1 MB at 10 Gbps',
      ],
      correct: [0, 2, 4],
      explanation:
        'Transferring 1 MB at 10 Gbps takes ~0.8 ms plus a sub-ms RTT, comparable to an NVMe read — the RAM speed of the remote host is irrelevant once the network is in the path, so the "100× faster" claim is wrong. An HDD seek (~10 ms) costs more than 30 NVMe-sized 1 MB reads. LZ4 compresses at hundreds of MB/s to GB/s (~1–2 ms/MB), while cross-region flows achieve far less than line rate, so compression usually wins there. Cross-region fetches are RTT-bound (plus slow-start round trips).',
      followUps: [
        {
          "q": "One server must serve this 1 MB blob at 5,000 requests/s. Which resource saturates first?",
          "a": "Bandwidth: 5,000 × 1 MB = 5 GB/s = 40 Gbps, four times a 10 Gbps NIC, whereas NVMe can easily sustain several GB/s and the blob would sit in page cache anyway. So the server is NIC-bound at ~1,250 req/s. Options: put a CDN in front (the blob is a perfect cacheable object), compress it if it's compressible, or spread it over at least 4–5 servers at 10 Gbps, plus headroom. Always convert to bits per second before comparing with NIC speeds."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-09',
      difficulty: 'expert',
      question:
        'Peak is 30K QPS, each request costs 15 ms of CPU, nodes have 8 vCPU, and the fleet spans 3 AZs. The requirement: survive an AZ loss while staying ≤ 90% CPU. Which node count is most defensible?',
      options: [
        '~57 nodes — 450 busy cores ÷ 8 vCPU',
        '~30 nodes — assume each node does ~1K RPS',
        '~96 nodes — 750 vCPU at a 60% target, spread evenly over 3 AZs',
        '~141 nodes — the 60% target, then an extra ×1.5 for AZ loss',
      ],
      correct: [2],
      explanation:
        '30K × 0.015 s = 450 busy cores; at 60% utilization that is 750 vCPU ≈ 94 nodes, rounded to 96 for even AZ spread. Losing one AZ raises utilization by 3/2 to 90% — exactly the requirement, so the 60% target already contains the AZ headroom and multiplying by 1.5 again double-counts it. 57 nodes runs at 100% with no failure margin, and "1K RPS per node" ignores the measured 15 ms CPU cost.',
      followUps: [
        {
          "q": "A release regresses CPU cost from 15 ms to 25 ms per request. What happens to the 96-node fleet at peak, and what do you need?",
          "a": "Busy cores become 30K × 0.025 s = 750 against 768 vCPU: ~98% utilization with all three AZs up, and losing one AZ would need ~146% — an outage. To restore the same policy you'd need 750 ÷ 0.6 = 1,250 vCPU ≈ 157 nodes (159 for even AZ spread). That's why CPU-per-request should be a tracked metric with a regression gate in CI or canary analysis, rather than discovered at the evening peak."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-10',
      difficulty: 'hard',
      question:
        'An audit table receives 10M rows/day of ~1 KB, flat traffic, kept 5 years, on Postgres with 2 replicas (3 copies). Index + tuple overhead is ~1.5× and you keep disks ≤ 75% full. Approximately how much total disk should you provision across all copies?',
      options: [
        '~110 TB',
        '~18 TB',
        '~55 TB',
        '~330 TB',
      ],
      correct: [0],
      explanation:
        'Raw: 10M × 1 KB × 365 × 5 ≈ 18.25 TB. ×3 copies ≈ 55 TB, ×1.5 overhead ≈ 82 TB, ÷ 0.75 fill ≈ 110 TB. 18 TB is a single raw copy; 55 TB forgets indexes and free-space headroom; 330 TB applies replication twice. The number argues for partitioning by time and moving old partitions to cheaper storage.',
      followUps: [
        {
          "q": "You partition by month and move partitions older than 90 days to compressed Parquet in object storage (5× compression). Recompute the database disk.",
          "a": "Hot data in Postgres: 10M × 1 KB × 90 days = 900 GB raw, × 3 copies × 1.5 overhead ÷ 0.75 fill ≈ 5.4 TB instead of ~110 TB. The cold remainder is about 18.25 − 0.9 ≈ 17.35 TB raw, ÷ 5 compression ≈ 3.5 TB in object storage, which is already durable, so no ×3 copies are needed. Queries over old audit data go through Athena/Trino. The database becomes small enough that backups and replica rebuilds take hours, not days."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-11',
      difficulty: 'expert',
      question: 'Review this capacity section from a design doc. Select ALL genuine flaws.',
      code: {
        language: 'yaml',
        code: `service: order-api
dau: 8000000
requests_per_user_day: 25
avg_qps: 2300            # 8M * 25 / 86400
servers: 3               # each node does ~1000 RPS
egress: "2300 req/s * 40KB = 92 MB/s -> fits a 1 Gbps NIC"
redis_memory: "cache all 40M orders * 1KB = 40GB"
db: "single primary + 2 read replicas"`,
      },
      options: [
        'Servers are sized at average QPS with no peak factor, utilization target or failure headroom',
        '92 MB/s is ~740 Mbps at average; at a 2–3× peak it exceeds a 1 Gbps NIC',
        'avg_qps is miscalculated; 8M × 25 ÷ 86,400 is closer to 23K',
        'Redis sizing caches everything and ignores access skew, per-key overhead and fragmentation',
        'Two read replicas are a flaw because each replica doubles the write QPS the primary must execute',
      ],
      correct: [0, 1, 3],
      explanation:
        'Three 1K-RPS servers cover only the average (~2.3K) with no margin — the evening peak of ~6–7K overwhelms them. Bytes vs bits: 92 MB/s × 8 ≈ 736 Mbps, which saturates 1 Gbps at peak. Caching all 40M orders ignores that recent orders dominate reads and underestimates memory with overhead. The avg_qps arithmetic is actually correct (~2,315), and replicas replay WAL; they do not make the primary execute writes twice.',
      followUps: [
        {
          "q": "Rewrite the server and egress lines correctly, assuming a 3× peak, the measured 1K RPS per node, a 60% utilization target and 3 AZs.",
          "a": "Peak ≈ 2,315 × 3 ≈ 6.9K RPS. At 1K RPS per node and a 60% target, each node takes ~600 RPS, so you need 6.9K ÷ 600 ≈ 11.6 → 12 nodes, which is a multiple of 3. Losing an AZ pushes survivors to 90%, which is acceptable. Peak egress is 92 MB/s × 3 ≈ 276 MB/s ≈ 2.2 Gbps across the fleet, ~184 Mbps per node, so NICs are fine once spread. The '1K RPS' must come from a load test, not a guess."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-12',
      difficulty: 'hard',
      question:
        'Given the table below, current max(id) ≈ 1.4 billion and inserts run at ~25M/day. What happens, and roughly when?',
      code: {
        language: 'sql',
        code: `CREATE TABLE events (
  id         SERIAL PRIMARY KEY,   -- backed by a sequence
  user_id    BIGINT NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- SELECT max(id) FROM events;  -- ~1,400,000,000`,
      },
      options: [
        'In ~30 days inserts start failing: SERIAL is a signed 32-bit integer capped at ~2.147B',
        'In ~4 months inserts fail: SERIAL is unsigned, so the cap is ~4.3B',
        'Nothing breaks: Postgres promotes SERIAL columns to BIGINT automatically',
        'In about a year, the sequence wraps around and starts reusing ids of deleted rows',
      ],
      correct: [0],
      explanation:
        'SERIAL is INTEGER (signed 32-bit, max 2,147,483,647); (2.147B − 1.4B) ÷ 25M/day ≈ 30 days, and rolled-back inserts also burn sequence values, so it can come sooner. Postgres has no unsigned integers and never auto-promotes types; sequences error on reaching their max (no CYCLE by default) rather than silently reuse ids. Migrating to BIGINT on a 1.4B-row table needs planning (new column + backfill + swap), which is why this estimate matters weeks ahead.',
      followUps: [
        {
          "q": "You have ~30 days. How do you move `id` to BIGINT on a 1.4B-row table without a long lock?",
          "a": "`ALTER COLUMN TYPE bigint` rewrites the whole table under an ACCESS EXCLUSIVE lock — hours of downtime. Instead: add a nullable `id_new BIGINT`, set it on new rows with a trigger, backfill old rows in small batches, build a unique index CONCURRENTLY, then in a short transaction swap names, switch the sequence to bigint and make it the primary key using that index. Also update foreign keys that reference `id`. As a stopgap you can buy time by restarting the sequence at -2.1B and using negative IDs, if no code assumes positive IDs."
        },
        {
          "q": "After the move, a Node service that reads `id` starts showing wrong IDs for new rows. Why?",
          "a": "node-postgres returns BIGINT (int8) as a string by default, precisely because JavaScript numbers are only exact up to 2^53 ≈ 9.0 × 10^15. If someone configured the int8 parser to return `Number`, values stay correct for now (2.1B is far below 2^53), but the bug is usually elsewhere: code comparing `'2147483648' === 2147483648`, or JSON consumers in other languages truncating to int32. Treat 64-bit IDs as strings in APIs. BIGINT itself lasts ~1 billion years at 25M inserts/day."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-13',
      difficulty: 'medium',
      question:
        'Your CDN hit ratio for images improves from 95% to 99% while total image traffic stays constant. What happens to origin egress?',
      options: [
        'It drops by about 4%',
        'It drops by about half',
        'It drops by about 99%',
        'It drops about 5× (from 5% of traffic to 1%)',
      ],
      correct: [3],
      explanation:
        'Origin serves the misses: 5% of traffic before, 1% after — a 5× reduction in origin egress and origin load. "4%" confuses the change in hit ratio with the change in misses. The origin still serves 1% of traffic, so it does not drop by 99%. This non-linearity is why the last few points of hit ratio are worth engineering effort (origin shield, longer TTLs, normalized cache keys).',
      followUps: [
        {
          "q": "Someone purges the entire CDN cache during evening peak. What does the origin see, and how do you protect it?",
          "a": "The hit ratio drops to ~0% momentarily, so origin traffic jumps from 1% of image traffic to nearly 100% — a 100× spike that no origin is sized for. Protect it with an origin shield (a mid-tier cache that collapses requests from all edge POPs into one origin fetch per object), request coalescing at the edge, serve-stale-while-revalidate, and rate-limited or path-scoped purges. Purging by surrogate key or tag (just the changed objects) should replace 'purge all' in runbooks."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-14',
      difficulty: 'expert',
      question:
        'A wide-column cluster must hold 40 TB of logical data at RF=3 on nodes with 2 TB disks kept ≤ 70% full. Peak writes are 200K/s and each node safely absorbs 15K replica writes/s. Which constraint sets the node count?',
      options: [
        'Write throughput: 200K ÷ 15K ≈ 14 nodes',
        'Write throughput with RF=3 amplification: 600K ÷ 15K = 40 nodes',
        'Storage without replication: 40 TB ÷ 1.4 TB ≈ 29 nodes',
        'Storage with RF=3 and fill target: 120 TB ÷ 1.4 TB ≈ 86 nodes',
      ],
      correct: [3],
      explanation:
        'Storage needs 40 TB × 3 = 120 TB of data on 1.4 TB usable per node ≈ 86 nodes; writes need 200K × 3 replica writes ÷ 15K ≈ 40 nodes. Take the max: storage wins by 2×. The 14-node option ignores replication amplification and the 29-node option ignores replica copies. The implication: denser disks or compression (or tiering cold data) lowers cost more than faster nodes would.',
      followUps: [
        {
          "q": "You enable 3× compression on the stored data. Which constraint sets the node count now?",
          "a": "Storage becomes 40 TB ÷ 3 × 3 replicas = 40 TB on disk ÷ 1.4 TB usable ≈ 29 nodes, while writes still need 200K × 3 ÷ 15K = 40 nodes. Throughput is now the binding constraint, so you'd provision ~40 nodes; compression saved about 46 nodes. Compression also costs some CPU per write, which may lower the 15K writes/s per node figure, so re-benchmark. Another lever is to batch writes or reduce write amplification such as secondary indexes or materialized views."
        },
        {
          "q": "Finance suggests 8 TB disks instead of 2 TB to cut node count. What's the catch?",
          "a": "Storage-wise: 120 TB ÷ (8 TB × 0.7 = 5.6 TB) ≈ 22 nodes — but writes still need 40, so you can't go below 40 anyway. Dense nodes also mean slow recovery: rebuilding or streaming 5.6 TB to a replacement node at ~200 MB/s takes ~7.8 hours, during which that data has reduced redundancy and the cluster carries extra streaming load. Compaction on very large SSTable sets also needs more temporary space and IO. Dense nodes suit cold data; hot, write-heavy data prefers more, smaller nodes."
        }
      ],
    },
    {
      id: 'fund-estimation-mcq-15',
      difficulty: 'medium',
      question:
        'All four constants below appear in a team\'s estimation spreadsheet. Which one introduces by far the largest error?',
      code: {
        language: 'typescript',
        code: `const SECONDS_PER_DAY = 100_000;              // (a)
const KB = 1024;                               // (b)
const egressMbps = bytesPerSecond / 1e6;       // (c)
const DAYS_PER_YEAR = 360;                     // (d)`,
      },
      options: [
        '(a) — a ~16% error on every per-second figure',
        '(b) — a ~2.4% error that compounds at each unit step',
        '(c) — it reports MB/s as Mbps, an 8× understatement',
        '(d) — a ~1.4% error per year that compounds over 5 years',
      ],
      correct: [2],
      explanation:
        'Dividing bytes/s by 10^6 yields megabytes per second; network links are quoted in megabits, so the figure is 8× too small — enough to under-buy NICs or mis-budget egress by nearly an order of magnitude. The 10^5 approximation (~16%), 1024 vs 1000 (2.4% per step, ~7% at GB) and 360-day years (~1.4%, which does not compound — it is the same 1.4% each year) are all acceptable envelope rounding.',
      followUps: [
        {
          "q": "The spreadsheet says peak egress is 800 'Mbps', so the team buys 1 Gbps NICs. What actually happens, and how do you stop this class of bug?",
          "a": "800 is really MB/s, i.e. 6.4 Gbps, so the 1 Gbps NIC saturates at ~15% of peak traffic and latency jumps as packets queue and drop. Prevent it with units in variable names (`egressBytesPerSec`, `egressGbps`), a single conversion helper that multiplies by 8 and is unit-tested, and sanity checks against known reference points (e.g. 'a 1080p stream is ~5 Mbps'). Reviews should include a quick ratio check against an existing service's dashboards."
        }
      ],
    },
  ],
};

export default topic;
