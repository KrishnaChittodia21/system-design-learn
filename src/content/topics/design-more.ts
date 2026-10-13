import type { Topic } from '../../types';

const topic: Topic = {
  id: 'design-more',
  phase: 'designs',
  order: 9,
  title: 'More Classics: Web Crawler, Top-K / Trending, Distributed Counters (Likes & Views), Online Judge (LeetCode) & Online Auction (eBay)',
  subtitle:
    'Five designs that interviewers keep asking and that test different muscles: politeness and dedup at web scale, streaming heavy hitters with sketches, counting under extreme write contention, running untrusted code safely during a contest spike, and strongly consistent bidding against a deadline.',
  estimatedMinutes: 180,
  sources: [
    'Alex Xu — System Design Interview Vol 1, Ch 9 (Design a Web Crawler)',
    'Heydon & Najork — Mercator: A Scalable, Extensible Web Crawler (1999); Najork & Heydon — High-Performance Web Crawling (2002)',
    'Manku, Jain & Das Sarma — Detecting Near-Duplicates for Web Crawling (WWW 2007, SimHash at Google)',
    'Cho & Garcia-Molina — Effective Page Refresh Policies for Web Crawlers (ACM TODS 2003)',
    'Cormode & Muthukrishnan — An Improved Data Stream Summary: The Count-Min Sketch (2005); Metwally et al. — Space-Saving (2005)',
    'Flajolet et al. — HyperLogLog (2007); Redis documentation (PFADD/PFCOUNT/PFMERGE)',
    'Hello Interview — problem breakdowns: Web Crawler, YouTube Top K, LeetCode, Online Auction (2025)',
    'Hello Interview community question reports (Top-K reported at Meta, Amazon, Microsoft); Glassdoor Meta interview reviews (web crawler, 2025)',
    'interviewing.io — Facebook system design mock: Design an Online Judge; Taro — Meta senior SWE interview experience, Feb 2025 (online auction)',
    'Educative / AlgoMaster — Sharded Counters and Distributed Counter designs; Google Cloud Firestore docs (distributed counters)',
    'gVisor and Firecracker documentation; Docker run reference (cgroups, seccomp, pids-limit)',
    'eBay help — automatic (proxy) bidding and bid increments',
  ],
  tags: [
    'web-crawler',
    'url-frontier',
    'politeness',
    'simhash',
    'bloom-filter',
    'top-k',
    'heavy-hitters',
    'count-min-sketch',
    'sliding-window',
    'distributed-counter',
    'write-coalescing',
    'hyperloglog',
    'online-judge',
    'sandboxing',
    'auction',
    'anti-sniping',
    'proxy-bidding',
  ],
  cheatSheet: [
    'Crawler: seed → URL frontier (front queues = priority, back queues = one per host, heap keyed by next-allowed time) → DNS cache → fetcher → parser → canonicalize → seen-URL check → frontier; content dedup by SimHash (64-bit, near-dup if Hamming ≤ 3).',
    'Crawler numbers: 5B pages / 30 days ≈ 2K pages/s, ~25 KB compressed each ≈ 50 MB/s and ~125 TB per snapshot. The global rate is easy; a 50M-page host at 1 req/s needs 579 days, so per-host rate and host interleaving are the real constraints.',
    'Crawler safety: robots.txt cached per host (~24 h), adaptive per-host delay (back off on 429/503 and slow responses), max depth / max URLs per host against traps, re-check robots and the seen set after every redirect.',
    'Re-crawl: freshness under a fixed fetch budget. Estimate each page\'s change rate from history and weight by importance; do not chase pages that change faster than you can revisit them (Cho & Garcia-Molina: proportional-to-change-rate loses to smarter allocation).',
    'Top-K: exact = hash map + min-heap (O(n log k)), but memory grows with distinct keys. Count-Min Sketch: width e/ε, depth ln(1/δ); never underestimates, overestimates by ≤ εN with probability 1−δ; it answers "how many", so pair it with a candidate heap for "which".',
    'Top-K pipeline: partition events by key (so each key is counted in one place) → per-partition windowed counts → local top-K → merge. Merging only local top-K lists from shards that split the same key is wrong; send counts for a candidate set instead.',
    'Trending ≠ popular: rank by velocity against a baseline (current window ÷ smoothed history, or a z-score) with a minimum volume threshold and per-user dedup, otherwise "always popular" items and bot bursts win.',
    'Counters: a like is a set membership (post_id, user_id) first and a number second. Store the edge idempotently, derive the count from inserted rows only, coalesce deltas per post (Kafka keyed by post_id → aggregator → batched UPDATE), and serve the count from cache. Unique viewers: HyperLogLog (12 KB, ~0.81% error, mergeable with PFMERGE).',
    'Online judge: POST /submissions → 202 + id → queue (contest priority, one in-flight per user) → warm sandbox pool (container + seccomp + cgroups + no network, or gVisor/Firecracker) → per-test CPU-time limit, memory and output caps → verdict written idempotently by submission id → client polls/SSE; leaderboard in a Redis sorted set with a composite score.',
    'Auction: accept a bid with one conditional write (amount ≥ current + increment AND now() < ends_at, using DB time) or a single writer per auction; proxy bidding means price = second-highest max + increment; soft close extends ends_at on late bids; fan out price updates through pub/sub, coalesced to a few per second.',
  ],
  sections: [
    // ------------------------------------------------------------ WEB CRAWLER
    {
      heading: 'Web Crawler (1/3): requirements, estimation & high-level design',
      body: `**Intuition:** a crawler is a **librarian with a to-read list that grows faster than they can read**. They must decide what to read next, never read the same book twice, and never visit one bookshop so often that the owner calls the police.

**Clarify first.** Purpose (search index, LLM training corpus, price monitoring?), scale (pages and refresh period), content types (HTML only? PDFs? JS-rendered pages?), politeness rules, freshness expectations, and whether it is one-shot or continuous. Each answer changes the design: an LLM corpus is a one-shot bulk crawl that values breadth, while a search index is continuous and values freshness of important pages.

**Functional:** start from seed URLs, fetch pages, extract links and text, store content plus metadata, and keep crawling discovered URLs. **Non-functional:** politeness (robots.txt, per-host rate), robustness (traps, malformed HTML, slow servers), scalability (horizontal fetchers), extensibility (new content types), and resumability (a crash must not restart a 30-day crawl).

**Estimation (continuous search crawl):**

| Quantity | Calculation | Result |
|---|---|---|
| Fetch rate | 5B pages ÷ 30 days (2.59M s) | ≈ 1.9K pages/s, plan for 4K/s peak |
| Bandwidth | 2K/s × 25 KB (gzip HTML) | ≈ 50 MB/s ≈ 400 Mbps |
| Raw storage | 5B × 25 KB | ≈ 125 TB per snapshot (×1.5 with erasure coding) |
| In-flight fetches | 2K/s × ~1 s average fetch | ≈ 2K concurrent sockets |
| Seen-URL set | 15B known URLs × 8 B fingerprint | ≈ 120 GB (sharded KV or Bloom filter) |

**Data model:** \`url_state(url_hash PK, url, host, last_fetched_at, last_status, content_hash, simhash, change_rate, priority, next_fetch_at)\`, a **robots cache** per host, a **host table** (crawl delay, IP, error rate), and the **content store** (WARC-style files in S3/HDFS keyed by url_hash + fetch time). Nothing here needs joins, so a wide-column or sharded KV store keyed by url_hash fits.

**The interview flow** is the pipeline below. Spend most of the time on the frontier (politeness and priority) and dedup, because that is where the senior signals are.`,
      diagram: `  seeds
    |
    v
 +-----------------+   next URL   +---------+   +----------+   +--------+
 |  URL FRONTIER   |------------->| DNS     |-->| FETCHER  |-->| PARSER |
 | priority queues |              | cache   |   | pool     |   | links, |
 | + per-host      |              +---------+   | robots   |   | text   |
 |   back queues   |                            | check    |   +---+----+
 +--------^--------+                            +----+-----+       |
          |                                          |             v
          |  new, unseen URLs                        v      +-------------+
 +--------+--------+   +------------------+   +-----------+ | content     |
 | URL filter:     |<--| canonicalize,    |<--| link      | | dedup       |
 | seen set, depth,|   | drop tracking    |   | extractor | | (SimHash)   |
 | per-host caps   |   | params           |   +-----------+ +------+------+
 +-----------------+   +------------------+                        |
                                                                   v
                         url_state (KV)   <----------------  content store
                         robots cache                         (S3 / WARC)`,
      keyPoints: [
        'Ask what the crawl is for: search index (continuous, freshness) vs LLM corpus (one-shot, breadth) vs price monitor (narrow, frequent).',
        '5B pages per 30 days is only ~2K pages/s; bandwidth and the global rate are not the hard part.',
        'Everything is keyed by a URL hash, so a sharded KV store is enough; checkpoint the frontier so a crash resumes instead of restarting.',
      ],
      source: 'Alex Xu — System Design Interview Vol 1, Ch 9; Hello Interview — Web Crawler breakdown',
    },
    {
      heading: 'Web Crawler (2/3): the URL frontier — priority, politeness & DNS',
      body: `**Intuition:** the frontier is **two sets of queues**. The front set answers "what matters most?" and the back set answers "who may I hit right now without being rude?".

**Mercator-style frontier:**
- **Front queues (priority):** a prioritizer scores each URL by PageRank or host importance, change rate and depth, then places it in one of F priority queues. A biased selector pulls more often from high-priority queues.
- **Back queues (politeness):** each back queue holds URLs for **one host only**. A **min-heap keyed by \`nextAllowedAt\`** says which host can be contacted next. A fetcher pops the earliest host, takes one URL, and pushes the host back with \`now + delay\`. Many hosts are therefore interleaved, and no host gets two concurrent requests.
- **Host affinity:** shard the frontier by host hash so that one frontier node owns all URLs of a host. Politeness then stays local, with no distributed lock per host.

**Politeness rules:** fetch \`/robots.txt\` once per host and cache it for about 24 h (treat a 5xx as "disallow all" for a while; a 404 means everything is allowed). Respect \`Crawl-delay\`. Set the delay **adaptively**: if a fetch took 400 ms, waiting about 10× that keeps you under ~10% of that server's capacity. Back off exponentially on 429/503. Also key politeness by **IP**, not only hostname, because 30K small blogs on one shared-hosting IP are one server to the operator.

**DNS is a hidden bottleneck.** Resolvers add 10–200 ms per lookup, and Node's \`dns.lookup\` runs \`getaddrinfo\` on the libuv threadpool (4 threads by default). Cache host → IP in the crawler with the record's TTL, resolve ahead of time when a host enters the frontier, and use \`dns.resolve*\` (c-ares, non-blocking) or a local caching resolver.

**Scale-out:** frontier nodes keep the hot head of each queue in memory and spill the tail to disk (RocksDB), so billions of pending URLs do not need RAM. Fetchers are stateless async workers (one Node process can keep ~500–1,000 sockets in flight). Parsing is CPU-bound, so run it in a separate autoscaled pool.`,
      code: [
        {
          language: 'typescript',
          title: 'Politeness scheduler: per-host back queues + min-heap on next-allowed time',
          code: `type HostQueue = { host: string; urls: string[]; nextAllowedAt: number; delayMs: number };

/** Binary min-heap of host queues keyed by the earliest time each host may be hit again. */
class HostHeap {
  private a: HostQueue[] = [];
  peek() { return this.a[0]; }
  push(q: HostQueue) {
    this.a.push(q);
    for (let i = this.a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (this.a[p].nextAllowedAt <= q.nextAllowedAt) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]]; i = p;
    }
  }
  pop(): HostQueue | undefined {
    const top = this.a[0], last = this.a.pop();
    if (this.a.length && last) {
      this.a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < this.a.length && this.a[l].nextAllowedAt < this.a[m].nextAllowedAt) m = l;
        if (r < this.a.length && this.a[r].nextAllowedAt < this.a[m].nextAllowedAt) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]]; i = m;
      }
    }
    return top;
  }
}

export class PoliteFrontier {
  private byHost = new Map<string, HostQueue>();
  private ready = new HostHeap();                 // only hosts that have queued URLs

  enqueue(url: string, crawlDelayMs = 1000): void {
    const host = new URL(url).host;
    let q = this.byHost.get(host);
    if (!q) { q = { host, urls: [], nextAllowedAt: 0, delayMs: crawlDelayMs }; this.byHost.set(host, q); }
    q.urls.push(url);
    if (q.urls.length === 1) this.ready.push(q);  // host (re)enters the heap
  }

  /** The next URL that may be fetched now, or how long to wait. */
  next(now: number): { url: string } | { waitMs: number } | null {
    const q = this.ready.peek();
    if (!q) return null;
    if (q.nextAllowedAt > now) return { waitMs: q.nextAllowedAt - now };
    this.ready.pop();
    const url = q.urls.shift()!;
    q.nextAllowedAt = now + q.delayMs;            // the politeness gap starts now
    if (q.urls.length) this.ready.push(q);
    return { url };
  }

  /** Adaptive politeness: back off on 429/503, stay under ~10% of a slow server. */
  feedback(host: string, latencyMs: number, status: number): void {
    const q = this.byHost.get(host);
    if (!q) return;
    if (status === 429 || status === 503) q.delayMs = Math.min(q.delayMs * 2, 60_000);
    else q.delayMs = Math.max(q.delayMs, latencyMs * 10);
  }
}`,
        },
      ],
      keyPoints: [
        'Front queues decide importance; back queues (one per host) plus a heap on nextAllowedAt enforce politeness.',
        'Shard the frontier by host so that politeness never needs a distributed lock.',
        'Cache DNS inside the crawler and avoid threadpool-bound getaddrinfo at thousands of lookups per second.',
      ],
      source: 'Heydon & Najork — Mercator (1999); Alex Xu Vol 1, Ch 9',
    },
    {
      heading: 'Web Crawler (3/3): dedup, traps, re-crawl policy & bottlenecks',
      body: `**Two kinds of duplicate.**
1. **Same URL, different spelling.** \`HTTP://Shop.com:80/p?id=1&utm_source=x#top\` and \`http://shop.com/p?id=1\` are one page. **Canonicalize** before the seen check: lowercase the host, drop default ports and fragments, sort query parameters, strip tracking parameters, and honour \`<link rel="canonical">\` after fetching. The seen set holds a 64-bit hash of the canonical URL, either in a sharded KV store (exact, ~120 GB for 15B URLs) or a **Bloom filter** (~1.2 GB per 1B URLs at 1% false positives). A Bloom false positive means a new URL is **silently never crawled**, so use it as a fast pre-filter in front of the exact store, or accept the loss knowingly.
2. **Different URL, same or almost the same content.** Mirrors, printer-friendly pages, and session IDs in paths. An exact hash (SHA-256 of the normalized text) catches identical copies. **SimHash** catches near-duplicates: pages that differ only in a footer or timestamp have 64-bit fingerprints within Hamming distance ≤ 3. Google used this at web scale (Manku et al., 2007), with permuted-table lookups to find all fingerprints within distance k.

**Traps and junk:** infinite calendars (\`/2026/10/08\` → next day → …), session IDs that create unbounded URLs, and soft-404 pages. Defend with a max depth from the seed (15–20), a per-host URL budget, URL-pattern detectors (a host whose URL count explodes while its distinct SimHash count stays flat), max URL length, and a cap on redirect hops (≤ 5). **Re-check robots.txt and the seen set after every redirect**, because the redirect target can be another host or an already-crawled page.

**Re-crawl (freshness):** with a fixed budget of fetches, decide when to revisit each page. Track a per-page change rate λ (changes ÷ observed interval, smoothed) and importance, then schedule \`next_fetch_at\`. Cho & Garcia-Molina showed a counter-intuitive result: revisiting **in proportion to change rate** is worse than uniform, because the pages that change most often are stale again almost immediately. A good policy spends the budget on important pages whose change rate it can keep up with. Use conditional GETs (\`If-Modified-Since\` / ETag → 304) and sitemaps' \`lastmod\` to make revisits cheap.

**Bottlenecks and trade-offs:**

| Pressure | Mitigation |
|---|---|
| Hot hosts (a 50M-page site) | Negotiate or adapt a higher per-host rate, use parallel connections only when the host permits it, and spread the host's queue over time |
| Frontier memory | Keep the head in memory and the tail in RocksDB, and checkpoint it for crash recovery |
| JS-rendered pages | A separate, ~10–50× more expensive headless-browser pool, used only for hosts that need it |
| Storage | Store compressed WARC files and dedup content before storing it |
| Fault tolerance | Re-enqueue in-flight URLs on lease expiry; fetches are idempotent GETs, so at-least-once is fine |`,
      code: [
        {
          language: 'typescript',
          title: 'URL canonicalization + 64-bit SimHash for near-duplicate pages',
          code: `import { createHash } from 'node:crypto';

const TRACKING = /^(utm_[a-z]+|gclid|fbclid|sessionid|sid|ref)$/i;

/** Canonical form used as the seen-set key: same page => same string. */
export function canonicalize(raw: string, base?: string): string | null {
  let u: URL;
  try { u = new URL(raw, base); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;   // mailto:, javascript:
  u.hash = '';                                     // fragments never reach the server
  u.hostname = u.hostname.toLowerCase().replace(/\\.$/, '');
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = new URLSearchParams(params).toString();
  u.pathname = u.pathname.replace(/\\/{2,}/g, '/'); // collapse //; URL() already resolves ./ and ../
  return u.toString();
}

/** 64-bit SimHash over word 3-shingles: near-identical pages differ in only a few bits. */
export function simhash64(text: string): bigint {
  const words = text.toLowerCase().match(/[\\p{L}\\p{N}]+/gu) ?? [];
  const v = new Array<number>(64).fill(0);
  for (let i = 0; i + 3 <= words.length; i++) {
    const h = createHash('md5').update(words.slice(i, i + 3).join(' ')).digest().readBigUInt64LE(0);
    for (let b = 0; b < 64; b++) v[b] += (h >> BigInt(b)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (v[b] > 0) out |= 1n << BigInt(b);
  return out;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b, n = 0;
  while (x) { x &= x - 1n; n++; }                  // clear the lowest set bit
  return n;                                        // <= 3 of 64 bits: treat as near-duplicate
}`,
        },
      ],
      keyPoints: [
        'Canonicalize before the seen check; a Bloom false positive silently drops a new URL.',
        'SimHash with a Hamming distance of 3 or less finds near-duplicate content; an exact hash only finds identical copies.',
        'Re-crawl by importance and achievable freshness, not raw change rate; use conditional GETs for cheap revisits.',
      ],
      source: 'Manku et al. — Detecting Near-Duplicates for Web Crawling (2007); Cho & Garcia-Molina (2003)',
    },
    // ------------------------------------------------------------ TOP-K
    {
      heading: 'Top-K / Trending (1/3): requirements, estimation & the exact baseline',
      body: `**Intuition:** "top K" is a **scoreboard for a never-ending stream**. Counting is easy. The hard parts are counting **hundreds of thousands of events per second over many windows**, keeping memory bounded when there are hundreds of millions of distinct items, and answering in milliseconds.

**Clarify:** what is counted (views, plays, hashtags, searches)? Which windows (last 1 h sliding, today, all-time)? What K (10, 100, 1,000)? Do results need to be **exact** (charts, royalties, billing) or is approximate fine (a "trending now" shelf)? How fresh (≤ 1 min delay)? Per region or category? These answers decide between an exact pipeline and a sketch.

**Estimation (video platform):**
- 500K view events/s on average (≈ 43B per day); peaks at 2–3×.
- ~100M distinct videos viewed per day; K = 100 per region × 50 regions × 3 windows = 15K ranked rows to serve.
- Reads: a home shelf reads "top 100 in IN, last hour" maybe 50K times/s. It is a tiny, cacheable result, so the read side is easy once precomputed.

**API:** \`GET /v1/top?window=1h&region=IN&k=100\` → \`[{ id, count, rank }]\` plus a \`computedAt\` timestamp. The counts are a snapshot, refreshed every minute.

**Exact baseline:** keep \`Map<id, count>\` per window and pick the top K with a **size-K min-heap**: O(n log K) time and O(n) memory for n distinct keys. Sorting all keys is O(n log n) and wasteful when K ≪ n. At 100M distinct keys and ~50 B per map entry, that is ~5 GB per window per region slice. It is feasible when sharded by key, but sliding windows multiply it (one map per minute bucket), which is the motivation for sketches in the next section.

**Batch + stream (lambda) is legitimate here.** The streaming layer gives approximate top-K within a minute. A nightly batch job (Spark over the raw event log in S3) gives exact daily or all-time charts and corrects the stream. Say this when the interviewer insists on "exact".`,
      code: [
        {
          language: 'typescript',
          title: 'Exact top-K with a size-K min-heap (O(n log K))',
          code: `/** Return the K largest [key, count] pairs without sorting all n keys. */
export function topK(counts: Map<string, number>, k: number): [string, number][] {
  const heap: [string, number][] = [];               // min-heap on count, size <= k
  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][1] <= heap[i][1]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < heap.length && heap[l][1] < heap[m][1]) m = l;
      if (r < heap.length && heap[r][1] < heap[m][1]) m = r;
      if (m === i) return;
      [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
    }
  };
  for (const entry of counts) {
    if (heap.length < k) { heap.push(entry); up(heap.length - 1); }
    else if (entry[1] > heap[0][1]) { heap[0] = entry; down(0); }   // evict the current minimum
  }
  return heap.sort((a, b) => b[1] - a[1]);           // only K items to sort
}`,
        },
      ],
      keyPoints: [
        'Ask exact vs approximate, the windows, K, freshness and region; they drive everything else.',
        'A size-K min-heap gives O(n log K); memory O(distinct keys) is the real limit.',
        'Stream for fresh approximate results, batch over the raw log for exact charts (lambda).',
      ],
      source: 'Hello Interview — YouTube Top K breakdown; Alex Xu Vol 2, Ch 6 (top-N clicked ads)',
    },
    {
      heading: 'Top-K / Trending (2/3): Count-Min Sketch, Space-Saving & mergeability',
      body: `**Intuition:** a **Count-Min Sketch (CMS)** is a small grid of counters. Each item increments one counter per row, chosen by that row's hash. Collisions only **add** to a counter, so the **minimum** across the rows is the least-polluted estimate.

**Guarantees.** With width \`w = ⌈e/ε⌉\` and depth \`d = ⌈ln(1/δ)⌉\`, the estimate is never below the true count and exceeds it by at most **ε·N** (N = total events) with probability 1−δ. For ε = 10⁻⁶ and δ = 1%, that is w ≈ 2.72M and d = 5, or 13.6M counters ≈ 54 MB, whatever the number of distinct keys. The error is **additive in N**: excellent for heavy hitters (millions of views) and useless for the long tail (an item with 50 views may show 40K).

**A sketch answers "how many?", not "which?".** It does not store keys, so pair it with a **candidate heap**: after each update, if the item's estimate beats the heap minimum, it enters the top K. **Conservative update** (only raise counters that are below the new estimate) cuts overestimation noticeably, but it does not support decrements.

**Space-Saving / Misra-Gries** keep exactly m counters (keys included). When a new key arrives and the table is full, it replaces the minimum key and inherits its count + 1. Any item with frequency > N/m is guaranteed to be in the table. This is often simpler than CMS + heap when K is small.

**Mergeability is the distributed superpower.** Two CMS with the same hash seeds and dimensions merge by **adding cell by cell**. Shards (or minute buckets) can therefore each keep a sketch, and the aggregator sums them. A sliding hour is 60 one-minute sketches summed, and the oldest is dropped as the window slides. Exact local top-K lists do **not** merge correctly (see the bottlenecks section).

| | Exact map + heap | CMS + heap | Space-Saving |
|---|---|---|---|
| Memory | O(distinct keys) | O(1/ε · log 1/δ) fixed | O(m) fixed |
| Error | 0 | +ε·N, never under | bounded, ≤ N/m over |
| Merge across shards | Sum maps (big) | Cell-wise add | Approximate merge |
| Deletes / sliding | Easy | Window of sketches | Hard |`,
      code: [
        {
          language: 'typescript',
          title: 'Count-Min Sketch with conservative update + top-K candidates',
          code: `import { createHash } from 'node:crypto';

export class CountMinTopK {
  private readonly table: Uint32Array[];
  private readonly top = new Map<string, number>();   // candidate -> estimate
  constructor(private readonly width: number, private readonly depth: number, private readonly k: number) {
    this.table = Array.from({ length: depth }, () => new Uint32Array(width));
  }

  // d hashes from one digest (Kirsch-Mitzenmacher: h1 + i*h2)
  private cols(key: string): number[] {
    const h = createHash('md5').update(key).digest();
    const h1 = h.readUInt32LE(0);
    const h2 = (h.readUInt32LE(4) | 1) >>> 0;          // odd; '>>> 0' keeps it unsigned
    return Array.from({ length: this.depth }, (_, i) => (h1 + i * h2) % this.width);
  }

  add(key: string, n = 1): number {
    const cols = this.cols(key);
    const est = Math.min(...cols.map((c, i) => this.table[i][c]));
    // Conservative update: only raise counters that are below est + n
    cols.forEach((c, i) => { this.table[i][c] = Math.max(this.table[i][c], est + n); });
    this.offer(key, est + n);
    return est + n;
  }

  estimate(key: string): number {                     // >= true count, <= true + eps*N w.h.p.
    return Math.min(...this.cols(key).map((c, i) => this.table[i][c]));
  }

  private offer(key: string, est: number): void {
    if (this.top.has(key) || this.top.size < this.k) { this.top.set(key, est); return; }
    let minKey = '', minVal = Infinity;               // O(k) scan; use an indexed heap for large k
    for (const [k2, v] of this.top) if (v < minVal) { minVal = v; minKey = k2; }
    if (est > minVal) { this.top.delete(minKey); this.top.set(key, est); }
  }

  topK(): [string, number][] {
    return [...this.top.entries()].sort((a, b) => b[1] - a[1]);
  }
}`,
        },
      ],
      keyPoints: [
        'CMS: w = e/ε, d = ln(1/δ); never underestimates; error is additive ε·N, so it only suits heavy hitters.',
        'A sketch has no keys, so keep a candidate heap beside it.',
        'Sketches merge by cell-wise addition: per-shard and per-minute sketches sum into windows.',
      ],
      source: 'Cormode & Muthukrishnan — Count-Min Sketch (2005); Metwally et al. — Space-Saving (2005)',
    },
    {
      heading: 'Top-K / Trending (3/3): streaming architecture, windows, trending score & bottlenecks',
      body: `**Pipeline.** Clients → view events → **Kafka keyed by item_id** (so all events of one item land on one partition) → a stream job (Flink) with **pre-aggregation** (count per item per second in memory before emitting) → **per-minute tumbling counts** per item and region → a **windowing stage** that keeps 60 one-minute buckets (sliding hour) and 24 one-hour buckets (sliding day) → a **top-K stage** per partition → a **single merger** that combines the partitions' top-K lists into the global top-K → **Redis / KV** holding \`top:{window}:{region}\` as a precomputed list with \`computedAt\`. The read API is a cache lookup.

**Why keying by item matters:** every item is counted completely in exactly one partition, so a **partition's local top-K is exact for its items**, and the global top-K is just the top K of all partitions' lists. If events for one item were spread across shards (random partitioning for load balance), local top-K lists would be **wrong to merge**: an item ranked #11 on every shard can be #1 globally. In that case send counts for a candidate set, or use a two-round threshold algorithm.

**Hot items:** one viral video concentrates load on one partition. Pre-aggregate before the shuffle (each producer or edge node sends \`(id, count)\` once per second, not one event per view). 500K raw events/s then become roughly one message per distinct item per second per producer.

**Sliding windows cheaply:** maintain a running total per item. Each minute, **add the newest bucket and subtract the bucket that fell out**, instead of re-summing 60 buckets. In Redis: \`ZINCRBY\` the new minute's counts into a running sorted set and \`ZINCRBY\` negative counts for the expired minute, then prune members ≤ 0.

**Trending ≠ most viewed.** "Top by count" always returns the same blockbusters. Trending measures **acceleration**: \`score = (current + α) / (baseline + β)\`, where the baseline is the same item's smoothed rate over the past days (an EWMA), or a z-score against its own history. Also apply a **minimum volume** (ignore items under, say, 500 views in the window), **per-user dedup** (one user replaying 200 times counts once), bot filtering, and a decay factor so items fade. Twitter-style trends also cluster related terms ("#IPLFinal", "IPL final") before ranking.

**Bottlenecks and trade-offs:**
- **Late events:** use event time with watermarks (for example, 30 s allowed lateness). Later events go to the batch correction path.
- **Exactness:** the stream gives ≤ 1 min freshness; nightly batch over S3 gives exact charts. Report which one a number came from.
- **Restarts:** Flink checkpoints state (the bucket maps or sketches) to S3 and replays Kafka from the checkpointed offsets, giving exactly-once state.
- **Cardinality:** the long tail of items seen once dominates memory. Sketch the tail and keep exact counts only for candidates.`,
      diagram: `  clients --> ingest --> Kafka "views" (key = item_id, 64 partitions)
                               |
             +-----------------+-----------------+
             v                 v                 v
       [Flink task p0]   [Flink task p1]  ... [Flink task p63]
        pre-aggregate     per-minute counts per (item, region)
        60 x 1-min buckets  -> running 1h total (+new, -expired)
        local top-K per window/region (exact for owned items)
             |                 |                 |
             +--------+--------+--------+--------+
                      v                 v
              [merger: K-way merge]   [raw events -> S3]
                      |                       |
                      v                       v
          Redis top:{1h|1d}:{region}    nightly Spark: exact charts,
          (precomputed, computedAt)     corrects the stream
                      |
               GET /v1/top  (cache hit, ~ms)`,
      code: [
        {
          language: 'typescript',
          title: 'Trending score: velocity vs own baseline, with volume floor and smoothing',
          code: `type Stat = { id: string; lastHour: number; baselinePerHour: number; uniqueViewers: number };

const MIN_VOLUME = 500;      // ignore tiny items: 3 views vs a baseline of 0.1 is not "trending"
const ALPHA = 50;            // additive smoothing on the numerator
const BETA = 100;            // additive smoothing on the denominator (new items have no history)

export function trendingScore(s: Stat): number {
  if (s.lastHour < MIN_VOLUME) return 0;
  // Count people, not plays: cap the effective count by unique viewers x 2
  const effective = Math.min(s.lastHour, s.uniqueViewers * 2);
  return (effective + ALPHA) / (s.baselinePerHour + BETA);
}

/** Baseline = EWMA of hourly counts over the past days; updated once per hour. */
export function updateBaseline(prev: number, hourCount: number, alpha = 0.05): number {
  return alpha * hourCount + (1 - alpha) * prev;
}`,
        },
      ],
      keyPoints: [
        'Key the stream by item: local top-K is then exact, and merging partition lists is correct.',
        'Pre-aggregate at the edge or producer to tame hot items; slide windows by adding the new bucket and subtracting the expired one.',
        'Trending = velocity vs the item\'s own baseline, with a volume floor, unique-user dedup and decay.',
      ],
      source: 'Hello Interview — YouTube Top K; Alex Xu Vol 2, Ch 6; Apache Flink docs (windows, checkpoints)',
    },
    // ------------------------------------------------------------ COUNTERS
    {
      heading: 'Distributed Counters (1/2): likes & views — requirements, data model & the write path',
      body: `**Intuition:** a like counter looks like \`count++\`, but at scale it is two different problems. **Who liked** is a set (needed for "liked by you", unlike, and idempotency). **How many** is a number that only needs to be roughly current. Treat the set as the source of truth and the number as a derived, cached view.

**Clarify:** can users unlike (so counts go down)? Must the count shown be exact or roughly current (Instagram shows "1.2M")? Do we need unique viewers or raw views? Is the system multi-region? What is the peak on one post? A celebrity post can take 100K+ likes/s.

**Requirements:** like/unlike is idempotent per (user, post); "liked by me" is exact for that user (read-your-writes); the count converges within seconds; no lost or double-counted likes over time; reads ≫ writes (a feed renders 20 counts per page).

**Data model:**
- \`post_likes(post_id, user_id, created_at, PRIMARY KEY (post_id, user_id))\`, sharded by post_id (Cassandra/ScyllaDB or sharded MySQL). For "posts I liked", keep a second table keyed by user_id.
- \`post_counters(post_id PK, likes BIGINT, views BIGINT, updated_at)\`, a separate small row, never updated inline per click.

**The write path that does not melt:**
1. \`INSERT ... ON CONFLICT DO NOTHING\` the edge. **Only if a row was inserted** emit \`+1\` (and \`-1\` only if an unlike deleted a row). Double-clicks and retries therefore never double count.
2. Publish the delta to **Kafka keyed by post_id** (or capture it with CDC from the edge table).
3. A **counter aggregator** consumes, **coalesces deltas per post** for ~1 s, and writes one batched \`UPDATE ... + delta\` for many posts. 100K likes/s on one post becomes **one** row update per second.
4. Update the cached count (\`HINCRBY\` or set the new value). The client optimistically shows +1 locally.

**Sharded counters** are the alternative when there is no stream: split a hot counter into N rows (\`counter_shards(post_id, shard, value)\`) and increment a random shard. Writes scale N×, but reads must sum N rows, so shard only hot keys (dynamic N) and cache the sum. Coalescing via a keyed stream usually beats it, because write cost becomes proportional to distinct posts rather than to clicks.`,
      code: [
        {
          language: 'sql',
          title: 'Idempotent like edge: emit a delta only when a row actually changed',
          code: `-- Like: returns a row only if this user had not liked the post before
INSERT INTO post_likes (post_id, user_id, created_at)
VALUES ($1, $2, now())
ON CONFLICT (post_id, user_id) DO NOTHING
RETURNING post_id;            -- 1 row => emit +1; 0 rows => duplicate click, emit nothing

-- Unlike: returns a row only if a like existed
DELETE FROM post_likes
WHERE post_id = $1 AND user_id = $2
RETURNING post_id;            -- 1 row => emit -1

-- Aggregator: one statement applies a whole second of coalesced deltas
UPDATE post_counters AS c
SET likes = c.likes + v.delta, updated_at = now()
FROM (SELECT unnest($1::bigint[]) AS post_id, unnest($2::int[]) AS delta) AS v
WHERE c.post_id = v.post_id;`,
        },
        {
          language: 'typescript',
          title: 'Counter aggregator: coalesce per post, flush in batches (kafkajs + pg)',
          code: `import { Kafka } from 'kafkajs';
import { Pool } from 'pg';

const pool = new Pool({ max: 10 });
const consumer = new Kafka({ brokers: ['kafka:9092'] }).consumer({ groupId: 'like-counter' });
const pending = new Map<string, number>();            // post_id -> summed delta

async function flush(): Promise<void> {
  if (pending.size === 0) return;
  const ids = [...pending.keys()], deltas = [...pending.values()];
  pending.clear();
  await pool.query(
    \`UPDATE post_counters AS c SET likes = c.likes + v.delta, updated_at = now()
     FROM (SELECT unnest($1::bigint[]) AS post_id, unnest($2::int[]) AS delta) v
     WHERE c.post_id = v.post_id\`, [ids, deltas]);
}

export async function run(): Promise<void> {
  await consumer.subscribe({ topic: 'like-deltas' });   // keyed by post_id
  await consumer.run({
    autoCommit: false,
    eachBatch: async ({ batch, resolveOffset, commitOffsetsIfNecessary }) => {
      for (const m of batch.messages) {
        const id = m.key!.toString();
        pending.set(id, (pending.get(id) ?? 0) + Number(m.value!.toString()));
        resolveOffset(m.offset);
      }
      await flush();                     // DB first, then offsets: a crash replays, never loses
      await commitOffsetsIfNecessary();
    },
  });
}
// Replays after a crash can apply a batch twice; the nightly COUNT(*) reconcile
// (or a per-partition applied-offset column updated in the same transaction) bounds that drift.`,
        },
      ],
      keyPoints: [
        'The like edge (post_id, user_id) is the source of truth; the count is derived from rows actually inserted or deleted.',
        'Key deltas by post_id and coalesce, so write cost is proportional to distinct posts, not clicks.',
        'Sharded counters trade read cost for write scale; use them only for hot keys.',
      ],
      source: 'Educative — Sharded Counters; Google Cloud Firestore docs (distributed counters)',
    },
    {
      heading: 'Distributed Counters (2/2): read path, unique counts, multi-region & reconciliation',
      body: `**Read path.** Counts are read 10–100× more than they are written. Serve them from Redis (\`HGET counters:{post_id} likes\`) or batch-fetch them for a feed page with \`MGET\`/pipeline. Cache in-process for hot posts (a celebrity post read 1M times/s needs an L1 cache with a 1–2 s TTL, because one Redis key is one shard). Show **rounded** numbers ("1.2M") and the display hides small lag. "Liked by you" comes from the edge table (or a per-user Bloom/bitmap cache), never from the count.

**Exact vs approximate.**

| Need | Technique | Cost |
|---|---|---|
| Likes (user-visible, can decrease) | Edge table + coalesced counter | Exact over time, ~1–5 s lag |
| Raw views (append-only, huge) | Pre-aggregated deltas, no per-view row | Exact-ish; at-least-once replays can over-count slightly |
| Unique viewers per day | **HyperLogLog**: Redis \`PFADD\` / \`PFCOUNT\` | 12 KB per key, ~0.81% standard error, any cardinality |
| Billing / creator payouts | Batch recount from the raw event log | Exact, hours of delay |

**HLL merges like a set union:** \`PFMERGE\` of per-region or per-hour HLLs gives the union's cardinality with no double counting. **Adding** per-region PFCOUNTs double counts users seen in both. That is the classic mistake.

**Multi-region.** A counter written in two regions can be modelled as a **CRDT G-Counter / PN-Counter**: each region keeps its own increments (P) and decrements (N) slot, and merge takes the per-slot max, so concurrent increments never get lost and replication can be asynchronous. In practice it is simpler to keep per-region counters (\`likes_in\`, \`likes_us\`) and show their sum. Never run a cross-region synchronous increment on the hot path.

**Reconciliation.** Derived counters drift (replays, bugs, manual deletes of spam accounts). Run a periodic job that recomputes \`COUNT(*)\` per post from the edge table, for recently active posts daily and for everything weekly, and corrects the counter with an explicit adjustment event, not a silent overwrite racing live deltas. Spam-account deletion should emit the same \`-1\` deltas as unlikes.

**Bottlenecks:** a hot partition in Kafka for a viral post (coalesce at the producer too); the edge table write rate (every like is still a row: 2M likes/s needs ~100 shards at 20K writes/s each); and cache stampede when a hot counter key expires (never expire hot counters, update them in place).`,
      code: [
        {
          language: 'typescript',
          title: 'Unique viewers with HyperLogLog (ioredis): count per region, merge globally',
          code: `import Redis from 'ioredis';
const redis = new Redis();

const day = () => new Date().toISOString().slice(0, 10);             // e.g. 2026-10-08

export async function recordView(videoId: string, viewerId: string, region: string) {
  const key = \`uv:\${videoId}:\${region}:\${day()}\`;
  await redis.pfadd(key, viewerId);                    // 12 KB max per key, whatever the count
  await redis.expire(key, 3 * 86_400);
}

export async function uniqueViewers(videoId: string, regions: string[]): Promise<number> {
  const keys = regions.map((r) => \`uv:\${videoId}:\${r}:\${day()}\`);
  // WRONG: sum of PFCOUNT per region double counts travellers and VPN users.
  // RIGHT: PFCOUNT over several keys counts the union of all of them.
  return redis.pfcount(...keys);
}

// Weekly uniques: merge the daily HLLs once (PFMERGE dest src...), then PFCOUNT dest.
// In Redis Cluster all keys of one PFCOUNT/PFMERGE must share a hash slot: use {videoId} tags.`,
        },
      ],
      keyPoints: [
        'Serve counts from cache with rounding; "liked by you" comes from the edge, not the count.',
        'HyperLogLog: 12 KB, ~0.81% error; union with PFMERGE or multi-key PFCOUNT, never by summing.',
        'Reconcile derived counters from the source of truth with explicit adjustment events.',
      ],
      source: 'Flajolet et al. — HyperLogLog (2007); Redis docs; Shapiro et al. — CRDTs (2011)',
    },
    // ------------------------------------------------------------ ONLINE JUDGE
    {
      heading: 'Online Judge / LeetCode (1/3): requirements, estimation, API & data model',
      body: `**Intuition:** an online judge is a **job queue that runs strangers' code**. The submission flow is a classic async pipeline. What makes it interesting is that the jobs are **hostile** (fork bombs, infinite loops, attempts to read other users' test data) and the load is **spiky** (a contest starts and 50K people press Submit within minutes).

**Clarify:** languages (C++, Java, Python, JS, Go)? Contests with live leaderboards, or practice only? Verdict latency target? How many concurrent contestants? Are custom "Run" tests (user-provided input) in scope? Is plagiarism detection needed?

**Functional:** browse problems; get a problem with a code stub per language; **run** against sample tests; **submit** against hidden tests and get a verdict (Accepted, Wrong Answer, Time Limit Exceeded, Memory Limit Exceeded, Runtime Error, Compile Error); contests with a live leaderboard.

**Non-functional:** **security isolation** above everything; verdict within ~5 s for practice and bounded under contest load; **fair, reproducible timing** (the same code gets the same verdict); and availability over strict consistency for the leaderboard (a few seconds stale is fine).

**Estimation:**
- Practice: 2M submissions/day ≈ 23/s on average.
- Contest: 100K contestants × ~8 submissions over 90 min ≈ 800K submissions. About 25% land in the last 10 minutes ≈ **333/s**.
- Cost per submission: ~1 s to compile (C++/Java) + 100 tests × ~20 ms CPU ≈ **3 CPU-seconds** → ~1,000 busy cores at the contest peak.
- Test data: 4K problems × ~50 MB average ≈ 200 GB in S3, cached on judge nodes.

**API:**
- \`POST /v1/problems/{id}/submissions\` \`{ language, code, contestId? }\` → **202** \`{ submissionId }\` with an idempotency key so a double-click does not judge twice.
- \`GET /v1/submissions/{id}\` → \`{ status: QUEUED|RUNNING|DONE, verdict?, runtimeMs?, memoryKb?, failedTest? }\`. Clients poll every 1 s or subscribe via SSE.
- \`GET /v1/contests/{id}/leaderboard?page=\`.

**Data model:** \`problems(id, title, statement, limits_json, test_bundle_uri, version)\`; \`submissions(id, user_id, problem_id, contest_id, language, code_uri, status, verdict, runtime_ms, memory_kb, created_at, judged_at, test_version)\`, partitioned by created_at and indexed by (user_id, problem_id); code blobs in S3; \`contest_scores\` in Redis plus a durable table.`,
      diagram: `  browser --POST--> API --> submissions (PG) + code (S3)
     ^                  |
     | poll / SSE       v
     |          +---------------------+
     |          | queues              |
     |          |  contest  (high)    |
     |          |  practice (normal)  |
     |          |  rejudge  (low)     |
     |          +----------+----------+
     |                     | pull (lease / visibility timeout)
     |       +-------------+-------------+
     |       v             v             v
     |   [judge node]  [judge node]  [judge node]   autoscaled pool
     |    warm sandboxes per language; test data cached from S3
     |       |  verdict (idempotent by submission id)
     |       v
     +-- result service --> submissions.verdict --> leaderboard (Redis ZSET)`,
      keyPoints: [
        'Async pipeline: 202 + submissionId, a queue, a worker pool, then poll or SSE for the verdict.',
        'A contest peak (~333 submissions/s × 3 CPU-s ≈ 1,000 cores) sizes the fleet, not the daily average.',
        'Store test_version with each verdict so a later test fix can trigger a targeted rejudge.',
      ],
      source: 'Hello Interview — LeetCode breakdown; interviewing.io — Design an Online Judge (Facebook mock)',
    },
    {
      heading: 'Online Judge (2/3): sandboxing untrusted code & fair verdicts',
      body: `**Intuition:** treat every submission as malware that happens to print numbers. Use **defence in depth**: no single layer is trusted.

**Isolation layers (outside → inside):**
1. **Dedicated judge nodes**, in a separate VPC/account with no credentials, no metadata-service access and no route to internal services.
2. **A strong sandbox boundary:** plain containers share the host kernel, so a kernel exploit escapes them. For hostile code, prefer **gVisor** (a user-space kernel that intercepts syscalls) or **Firecracker microVMs** (~125 ms boot, ~5 MB overhead; AWS Lambda uses them). Containers with a strict seccomp profile are acceptable in an interview if you name the risk.
3. **Resource limits** (cgroups): CPU quota, memory limit with swap disabled (a memory overrun is then MLE, not slowness), \`pids-limit\` against fork bombs, an output size cap, and file-size limits (\`ulimit -f\`).
4. **Least privilege:** \`--network none\`, read-only root filesystem, small \`tmpfs\` for scratch, a non-root user, \`--cap-drop ALL\`, \`no-new-privileges\`, and a seccomp allow-list (no \`ptrace\`, \`mount\`, raw sockets).
5. **Test data isolation:** mount only the current problem's inputs read-only. **Expected outputs never enter the sandbox.** The checker compares outside the sandbox, so code cannot read answers.

**Fair timing.** Wall-clock time on a shared node varies with noisy neighbours, which makes verdicts flaky. Measure **CPU time** of the process tree (cgroup \`cpu.stat\`) against the limit, pin each sandbox to a dedicated core, run one judge slot per core, and keep a generous **wall-clock** limit (for example 3× CPU) only to kill processes that sleep or block. Use **per-language multipliers** (Java ×2, Python ×3–5) or per-language limits, warm the JVM before timing if the platform promises it, and calibrate limits by running reference solutions on the same hardware class.

**Verdict logic:** compile in the sandbox with its own time and memory limit (Compile Error). Run tests in order and stop at the first failure (saves ~50% of runtime because most submissions fail early). Compare with a whitespace-tolerant diff, or a **special checker** for problems with many valid answers or floating-point tolerance.`,
      code: [
        {
          language: 'bash',
          title: 'One test run inside a locked-down container (gVisor runtime)',
          code: `# Mount: compiled binary + this test's input only; expected output stays outside.
docker run --rm \\
  --runtime=runsc \\
  --network none \\
  --read-only --tmpfs /tmp:rw,size=16m,noexec \\
  --user 65534:65534 \\
  --cap-drop ALL --security-opt no-new-privileges \\
  --security-opt seccomp=/etc/judge/seccomp-strict.json \\
  --cpus 1 --cpuset-cpus "$CORE" \\
  --memory 256m --memory-swap 256m \\
  --pids-limit 64 \\
  --ulimit fsize=10485760:10485760 \\
  --ulimit nofile=64:64 \\
  -v "$WORK/bin:/sandbox/bin:ro" \\
  -v "$WORK/in/$TEST.txt:/sandbox/input.txt:ro" \\
  judge-runner:cpp20 \\
  timeout --signal=KILL 6s /sandbox/bin/solution < /sandbox/input.txt \\
  | head -c 10485760 > "$WORK/out/$TEST.txt"     # cap output at 10 MB
# The runner then reads the cgroup cpu.stat usage_usec and memory.peak:
#   cpu > limit -> TLE; OOM kill -> MLE; non-zero exit -> RE; else diff vs expected.
# In production keep a warm container per slot and exec each test inside it;
# starting a fresh container per test adds 100s of ms.`,
        },
      ],
      keyPoints: [
        'Containers share the kernel; gVisor or Firecracker give a stronger boundary for hostile code.',
        'Use no network, read-only root, a non-root user, cap-drop ALL, seccomp, pids-limit, and memory with swap disabled.',
        'Judge on CPU time with pinned cores; wall time is only a backstop. Expected outputs never enter the sandbox.',
      ],
      source: 'gVisor & Firecracker docs; Docker run reference; Hello Interview — LeetCode',
    },
    {
      heading: 'Online Judge (3/3): queueing, contest spikes, leaderboard & bottlenecks',
      body: `**Queueing.** Use separate queues (or one priority queue) for **contest > practice > rejudge**, so a 50K-submission rejudge after a test fix never delays a live contest. Workers pull with a **lease** (SQS visibility timeout or a Redis stream consumer group): if a node dies mid-run, the job reappears after the lease, and the verdict write is **idempotent by submission_id** (\`UPDATE ... WHERE id = $1 AND status <> 'DONE'\`). Extend the lease with heartbeats for long runs.

**Fairness:** cap **one in-flight submission per user** (and rate-limit "Run" separately), so a contestant spamming Submit cannot occupy 50 slots. Submissions within a contest are judged FIFO per user, which also keeps "first accepted" timestamps meaningful.

**Contest spikes.** VMs take 60–120 s to boot and pull images, which is too slow for a spike that starts at T+0. Therefore:
- **Pre-scale on the contest calendar** (you know when contests start) to the forecast peak, then let queue-depth autoscaling handle the rest.
- Keep **warm sandbox pools** per language on every node and **pre-fetch test bundles** for the contest's problems to local SSD before it starts.
- **Degrade gracefully:** during the peak, run only hidden tests for Submit, queue "Run" with lower priority, and show queue position instead of timing out.
- The verdict timestamp used for scoring is the **submission time**, not the judging time, so queueing delay never costs a contestant penalty minutes.

**Leaderboard.** LeetCode-style ranking is points descending, then finish time (the last accepted submission plus 5 minutes per wrong attempt) ascending. Encode it as one Redis sorted-set score: \`points × 10⁷ + (10⁷ − 1 − penaltySeconds)\`, which stays well below 2⁵³. \`ZREVRANGE\` gives a page and \`ZREVRANK\` gives "my rank". Clients poll every 5–10 s, and the top page is cached for 1–2 s. Persist the scores in Postgres as the durable record; Redis can be rebuilt from it.

**Bottlenecks and trade-offs:**

| Pressure | Mitigation |
|---|---|
| Judge capacity at peak | Calendar pre-scaling, warm pools, early exit on the first failed test, priority queues |
| Huge test data | Content-addressed bundles cached on node SSD, fetched once per problem version |
| Leaderboard reads | Redis ZSET plus a short CDN or app cache for the top pages |
| Rejudges | Separate low-priority queue; recompute scores deterministically from verdicts |
| Cheating | Plagiarism checks (token- or AST-based similarity, e.g. MOSS) after the contest, not inline |`,
      code: [
        {
          language: 'typescript',
          title: 'Contest scoring in one Redis sorted-set score (ioredis)',
          code: `import Redis from 'ioredis';
const redis = new Redis();

const SCALE = 10_000_000;                  // penalty seconds always < 10^7 (a 90-min contest ~ 5.4K s)

/** Higher is better: points dominate, then lower penalty wins. */
export function compositeScore(points: number, penaltySeconds: number): number {
  if (penaltySeconds >= SCALE) throw new Error('penalty out of range');
  return points * SCALE + (SCALE - 1 - penaltySeconds);    // max ~ 30 points * 1e7 << 2^53
}

/** Called once per first-time Accepted (idempotent by user+problem via the SADD guard). */
export async function onAccepted(contestId: string, userId: string, problemId: string,
                                 problemPoints: number, solvedAtSec: number, wrongBefore: number) {
  const solvedKey = \`contest:\${contestId}:solved:\${userId}\`;
  if ((await redis.sadd(solvedKey, problemId)) === 0) return;         // already counted
  const stateKey = \`contest:\${contestId}:state:\${userId}\`;
  const points = await redis.hincrby(stateKey, 'points', problemPoints);
  // finish time = last accepted time + 300 s per wrong attempt on accepted problems
  const penaltyAdd = wrongBefore * 300;
  const wrongTotal = await redis.hincrby(stateKey, 'wrongPenalty', penaltyAdd);
  // verdicts can arrive out of submission order: finish time is the LATEST accepted submit
  const prev = Number((await redis.hget(stateKey, 'lastAccepted')) ?? 0);
  const last = Math.max(prev, solvedAtSec);
  await redis.hset(stateKey, 'lastAccepted', last);
  const penalty = last + wrongTotal;
  await redis.zadd(\`contest:\${contestId}:board\`, compositeScore(points, penalty), userId);
}
// Production: wrap these steps in one Lua script (or MULTI) so the SADD guard and
// the score update are atomic, and write the same event to Postgres for durability.`,
        },
      ],
      keyPoints: [
        'Priority queues: contest > practice > rejudge; one in-flight submission per user.',
        'Pre-scale from the contest calendar; reactive autoscaling is too slow for a T+0 spike.',
        'Score by submission time, not judging time; encode (points, penalty) in one ZSET score.',
      ],
      source: 'Hello Interview — LeetCode; Redis sorted sets docs',
    },
    // ------------------------------------------------------------ AUCTION
    {
      heading: 'Online Auction / eBay (1/3): requirements, estimation, API & data model',
      body: `**Intuition:** an auction is a **tiny, fiercely contested shared variable** (the current highest bid) with a **deadline**. Millions of auctions are quiet; a handful are on fire in their final minute. The design must be strongly consistent per auction and cheap for the quiet majority.

**Clarify:** English auction (ascending, highest wins) or sealed bid? Proxy or automatic bidding (eBay-style max bids)? Fixed end time or soft close (anti-sniping)? Reserve price? Buy-it-now? Real-time updates to watchers? Scale: concurrent auctions and peak bids/s on one auction?

**Functional:** create an auction (item, start price, reserve, start/end time); place a bid (accepted only if ≥ current price + increment and before the end); view current price, leader and bid history; get outbid notifications; at close, determine the winner and create an order.

**Non-functional:** **strong consistency per auction** (two users must never both be told they lead at the same price); bids durable once acknowledged; bid latency < 200 ms p99; real-time price updates to watchers within ~1 s; a correct close even with clock skew; high availability for browsing.

**Estimation:**
- 10M concurrent active auctions, average lifetime 7 days → ~1.4M new auctions/day.
- Average 10 bids per auction → ~14M bids/day ≈ 160 bids/s average. That is tiny.
- The hard number is **the skew**: a celebrity item can see thousands of bid attempts in its final 10 seconds, and 200K watchers expecting live updates.
- Storage: 14M bids/day × ~200 B ≈ 2.8 GB/day of bids. Trivial.

**API:** \`POST /v1/auctions/{id}/bids { amount | maxAmount, idempotencyKey }\` → \`201 { accepted, currentPrice, leader, endsAt }\` or \`409 { reason: OUTBID|TOO_LOW|CLOSED, currentPrice }\`; \`GET /v1/auctions/{id}\`; \`GET /v1/auctions/{id}/stream\` (SSE/WebSocket).

**Data model:** \`auctions(id, seller_id, status, start_price, reserve_price, min_increment, current_price, leader_id, leader_max, bid_count, ends_at, version)\` is the hot row. \`bids(id, auction_id, bidder_id, amount, max_amount, accepted, created_at)\` is an **append-only** audit log (keep rejected bids too: disputes and fraud analysis need them). Shard both by auction_id so a bid touches exactly one shard.`,
      diagram: `  bidders --> API (idempotency key) --> Bid service
                                          |  one conditional write per bid
                                          v
                              shard(auction_id): auctions row + bids log
                                          | outbox / CDC
                       +------------------+--------------------+
                       v                  v                    v
               pub/sub auction:{id}   notifications       close scheduler
               (Redis / Kafka)        ("you were outbid")  (timer on ends_at)
                       |                                       |
                       v                                       v
          WebSocket / SSE gateways --> 200K watchers     settle: winner -> order,
          (coalesced to ~4 updates/s)                    payment, seller notice`,
      keyPoints: [
        'Average load is tiny (~160 bids/s); design for per-auction contention and the final-minute skew.',
        'Keep the bid log append-only, including rejected bids, for disputes and fraud analysis.',
        'Shard by auction_id so each bid is a single-shard operation.',
      ],
      source: 'Hello Interview — Online Auction breakdown; Taro — Meta senior SWE interview experience (Feb 2025)',
    },
    {
      heading: 'Online Auction (2/3): bid consistency, proxy bidding & ordering',
      body: `**Three ways to accept a bid correctly:**

| Approach | How | Good for | Watch out |
|---|---|---|---|
| **Conditional write** | One \`UPDATE auctions SET ... WHERE id=$1 AND current_price + min_increment <= $2 AND now() < ends_at\` + insert the bid, in one transaction | Default; simple; the DB row lock serializes bids | One hot row, roughly 1–5K updates/s per auction before lock queueing hurts |
| **Optimistic version** | Read \`version\`, validate in app, \`UPDATE ... WHERE version = $v\` | Rich validation in code | Retry storms under heavy contention |
| **Single writer per auction** | Kafka partition or actor keyed by auction_id; one consumer applies bids sequentially in memory, then persists | Extreme hot auctions; sub-ms decisions | Failover must fence the old writer; dedupe bids by id after a rebalance; async ack |

**Use database time, not client or app time.** "Before the end" is decided by the serializing authority's clock (\`now()\` inside the conditional write, or the single writer's clock). Client timestamps are untrusted, and app servers' clocks skew. The bid that reaches the authority first wins; equal amounts are resolved by arrival order.

**Proxy (automatic) bidding.** eBay lets a bidder enter a **maximum**. The system bids on their behalf only as much as needed. The visible price is therefore **the second-highest maximum + one increment** (capped at the leader's max), which makes this a Vickrey-like second-price auction. Only the leader's max is secret state. Rules: a challenger whose max exceeds the leader's max takes the lead at \`min(challengerMax, leaderMax + inc)\`. Otherwise the leader's proxy defends and the price rises to \`min(leaderMax, challengerMax + inc)\`. **Ties go to the earlier bid.** One state transition per incoming bid is easy to do inside the conditional write or the single writer.

**Increments** grow with price (e.g. ₹10 below ₹1,000, ₹50 up to ₹5,000, …). Store the table with the auction so the rules cannot change mid-auction.

**Idempotency:** the client sends an idempotency key per bid attempt. A retried request returns the original outcome instead of placing a second bid, which matters most when the retried bid would now be "outbid by yourself".`,
      code: [
        {
          language: 'typescript',
          title: 'Proxy bidding state transition (pure function, applied under the row lock)',
          code: `export type AuctionState = { leaderId: string | null; leaderMax: number; price: number };

/** Apply one max-bid. Throws on invalid bids; returns the new visible state. */
export function placeMaxBid(s: AuctionState, bidder: string, maxBid: number,
                            inc: number, startPrice: number): AuctionState {
  if (s.leaderId === null) {
    if (maxBid < startPrice) throw new Error('BELOW_START');
    return { leaderId: bidder, leaderMax: maxBid, price: startPrice };
  }
  if (bidder === s.leaderId) {                // leader raises their own ceiling: price unchanged
    return maxBid > s.leaderMax ? { ...s, leaderMax: maxBid } : s;
  }
  if (maxBid < s.price + inc) throw new Error('BELOW_MIN_INCREMENT');
  if (maxBid > s.leaderMax) {                 // challenger takes the lead
    return { leaderId: bidder, leaderMax: maxBid, price: Math.min(maxBid, s.leaderMax + inc) };
  }
  // the leader's proxy defends; a tie goes to the earlier bid (the current leader)
  return { ...s, price: Math.min(s.leaderMax, maxBid + inc) };
}

// Example (inc 5, start 50): A max 100 -> A leads @50
//   B max 80  -> A leads @85      (B's 80 + 5)
//   C max 130 -> C leads @105     (A's 100 + 5)
//   B max 130 -> C leads @130     (tie: earlier bid keeps the lead, price = 130)`,
        },
      ],
      keyPoints: [
        'Serialize per auction: conditional write by default, single writer for extreme hot auctions.',
        'The authority\'s clock decides "on time"; client timestamps never do.',
        'Proxy bidding gives price = second-highest max + increment; ties go to the earlier bidder.',
      ],
      source: 'eBay help — automatic bidding & bid increments; Hello Interview — Online Auction',
    },
    {
      heading: 'Online Auction (3/3): anti-sniping, closing at scale, real-time fan-out & bottlenecks',
      body: `**Sniping and soft close.** With a hard close, rational bidders wait until the last second, and whoever's packet arrives first wins. That is unfair and spikes load. A **soft close** (used by many auction houses; eBay keeps a hard close) extends the end: any accepted bid within the last T minutes moves \`ends_at\` to \`bid_time + T\`. Put the extension inside **the same conditional write** that accepts the bid. A separate "extend" step races with the closer.

**Closing correctly.** Bids are accepted only while \`now() < ends_at\` at the authority. The closer is a scheduled job (a timer wheel or delayed queue keyed on ends_at, which the job-scheduler design covers). It runs \`UPDATE auctions SET status='CLOSED' WHERE id=$1 AND status='OPEN' AND now() >= ends_at RETURNING ...\`. Because the bid path checks the same \`ends_at\` under the same row lock, a bid and the close **cannot both win**. If ends_at was extended, the close update matches zero rows and the closer re-schedules. Settlement then runs as a saga: check the reserve price, create the order, charge or notify the winner, and fall back to the second-highest bidder if the winner does not pay.

**Real-time fan-out.** After commit, an outbox/CDC event publishes \`{ auctionId, price, leader, endsAt, seq }\` to a **pub/sub channel per auction** (Redis pub/sub, or Kafka → gateway). WebSocket/SSE gateways subscribe only to channels their clients watch. For a hot auction with 200K watchers, **coalesce** to about 4 updates/s per auction (send the latest state and drop intermediate ones; clients only need the newest price). Include a monotonically increasing \`seq\` so clients ignore out-of-order messages, and re-fetch state on reconnect. The server always re-validates on bid, so a stale UI can never cause a wrong acceptance.

**Bottlenecks and trade-offs:**
- **Hot row in the final seconds:** batch-reject obviously losing bids before they reach the row (a cached "current price" check at the API layer, which may only reject, never accept), or move that auction to a single-writer actor.
- **Thundering close:** many auctions end at "round" times. Spread scheduled end times by a few seconds of jitter at creation.
- **Notifications:** "you were outbid" is async and at-least-once; dedupe by (auction, user, seq).
- **Fraud and shill bidding:** the append-only bid log feeds offline detection (seller-linked accounts bidding up their own items).
- **Read scale:** auction pages are cacheable except the price, which the live channel delivers. Search uses a separate index (Elasticsearch) fed by CDC.`,
      code: [
        {
          language: 'sql',
          title: 'Accept a bid, extend a soft close, and log it in one transaction (Postgres)',
          code: `-- $1 auction_id, $2 amount, $3 bidder_id, $4 bid_id (client idempotency key).
-- The API first looks up bids.id = $4 and replays the stored outcome on a retry.
-- One statement: data-modifying CTEs share a snapshot and commit atomically.
WITH accepted AS (
  UPDATE auctions
  SET current_price = $2,
      leader_id     = $3,
      bid_count     = bid_count + 1,
      version       = version + 1,
      -- soft close: a bid in the last 2 minutes pushes the end to now() + 2 minutes
      ends_at = CASE WHEN ends_at - now() < interval '2 minutes'
                     THEN now() + interval '2 minutes' ELSE ends_at END
  WHERE id = $1
    AND status = 'OPEN'
    AND now() < ends_at                          -- DB clock decides "on time"
    AND $2 >= current_price + min_increment      -- validated under the row lock
    AND leader_id IS DISTINCT FROM $3            -- no bidding against yourself
  RETURNING id, current_price, ends_at, version
),
logged AS (                                      -- rejected bids are logged too
  INSERT INTO bids (id, auction_id, bidder_id, amount, accepted, created_at)
  SELECT $4, $1, $3, $2, EXISTS (SELECT 1 FROM accepted), now()
  ON CONFLICT (id) DO NOTHING
  RETURNING accepted
)
-- Outbox row only for an accepted bid -> CDC -> pub/sub "auction:{id}"
INSERT INTO outbox (aggregate_id, type, payload)
SELECT a.id, 'BID_ACCEPTED',
       json_build_object('price', a.current_price, 'endsAt', a.ends_at, 'seq', a.version)
FROM accepted a;`,
        },
      ],
      keyPoints: [
        'Extend the soft close in the same write that accepts the bid; the closer uses the same predicate, so they cannot both win.',
        'Fan out through per-auction pub/sub, coalesced to a few updates per second, with seq numbers for ordering.',
        'The cached price may only reject bids early; acceptance always goes through the authority.',
      ],
      source: 'Hello Interview — Online Auction; Alex Xu Vol 2 (job scheduler patterns for timers)',
    },
    {
      heading: 'Level bar: what mid, senior and staff answers include',
      body: `**Intuition:** mid (≈80% breadth / 20% depth) draws a pipeline that works while the interviewer steers. Senior (≈60/40) gets through the HLD in about 10 minutes, then deep-dives the contention point it found itself and names the trade-off. Staff (≈40/60) drives, cuts what isn't needed, and raises cost, abuse, reconciliation and rollout without being asked.

**Web crawler**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | fetch, parse, store pages | purpose (search vs LLM corpus), 5B pages/30 days, freshness | politeness as a legal and reputational limit; robots and opt-out policy |
| High-level design | queue → fetchers → storage | front/back-queue frontier sharded by host, DNS cache | checkpointed frontier, per-host budgets, re-crawl scheduler |
| Deep dives expected | URL dedup | politeness heap on nextAllowedAt, SimHash near-dup | traps, re-crawl by importance, conditional GETs |
| Trade-offs & failure handling | none | Bloom false positive drops a URL | crash resume without re-crawling; bad-host quarantine |
| Ops/cost/evolution | none | bandwidth is not the hard part (~2K pages/s) | egress and storage cost, abuse complaints workflow |

*Down-levelled by:* a distributed lock for politeness; no canonicalisation; restart-from-scratch on crash.

**Top-K / trending**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | top 10 items | exact vs approximate, windows, K, freshness | trending ≠ popular; abuse and dedup by user |
| High-level design | count + heap | stream keyed by item, per-window aggregation | lambda: stream for fresh, batch for exact charts |
| Deep dives expected | min-heap of size K | Count-Min + candidate heap, mergeable sketches | hot-item pre-aggregation, sliding windows, velocity score |
| Trade-offs & failure handling | none | CMS error ε·N only suits heavy hitters | late events, replay, reconciliation with batch |
| Ops/cost/evolution | none | memory per window | when exact is worth the batch job's cost |

*Down-levelled by:* summing per-shard top-K lists keyed by anything other than item; no window definition.

**Distributed counters (likes/views)**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | like/unlike, show count | exact edge vs approximate count, unique views | which counts are money (creator payouts) vs vanity |
| High-level design | UPDATE count+1 | edge table as truth, coalesced deltas keyed by post | sharded counters for hot keys only; HLL for uniques |
| Deep dives expected | idempotency | write coalescing, cached reads | multi-region merge, reconciliation jobs |
| Trade-offs & failure handling | none | sharding trades read cost for write scale | drift repair with adjustment events |
| Ops/cost/evolution | none | none | cost of exactness per counter class |

*Down-levelled by:* incrementing one row per click; summing HLLs.

**Online judge**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | submit, get verdict | languages, limits, contest peak | hostile code threat model, rejudge policy |
| High-level design | API runs code | 202 + queue + worker pool + SSE | priority queues, test_version on verdicts |
| Deep dives expected | Docker | seccomp, no network, cgroups, CPU-time judging | gVisor/Firecracker, pre-scaling from the contest calendar |
| Trade-offs & failure handling | none | container vs microVM | worker crash → requeue with no double verdict |
| Ops/cost/evolution | none | ~1,000 cores at peak | idle fleet cost vs T+0 spike; rejudge cost |

*Down-levelled by:* running code in the API process; judging on wall time.

**Online auction**

| | Mid | Senior | Staff |
|---|---|---|---|
| Requirements & scope | bid, see highest bid | proxy bidding, soft close, ordering | dispute evidence, fraud, shill bidding |
| High-level design | bids table | shard by auction, conditional write | single-writer actor for hot auctions |
| Deep dives expected | race on highest bid | proxy price = second max + increment | anti-sniping extension in the same write as the closer |
| Trade-offs & failure handling | none | authority clock, not client time | close vs late bid race provably single-winner |
| Ops/cost/evolution | none | none | append-only bid log for audits; hot-auction fan-out cost |

*Down-levelled by:* trusting client timestamps; accepting bids from a cached price.`,
      keyPoints: [
        'Senior finds the contention point itself: the frontier, the hot item, the hot counter, the contest spike, the final-minute bid.',
        'Staff adds a source of truth, reconciliation and cost of exactness.',
        'Classic traps: politeness locks, summing HLLs, wall-time judging, client timestamps.',
      ],
      source: 'Hello Interview — problem breakdowns, "What is expected at each level"',
    },
    {
      heading: 'Deep-dive ladders: bad → good → great',
      body: `**Intuition:** each rung fixes the failure the previous rung shows at peak. Name the failure with a number, then climb.

**Crawler — politeness at 2K pages/s across 100M hosts**
- **Bad:** a global queue plus a distributed lock per host. Lock traffic dominates, fetchers block, and one slow host stalls a worker.
- **Good:** a per-host back queue with a fixed delay. That is polite, but importance is ignored and hot hosts starve the rest.
- **Great:** front queues ordered by priority feed back queues, one per host. A min-heap on nextAllowedAt (from robots crawl-delay and observed latency) decides what goes next. The frontier is sharded by host hash, so no lock is ever needed, and it is checkpointed so a crash resumes.

**Crawler — traps and duplicates**
- **Bad:** exact-URL dedup only, so calendar and session-id traps generate infinite URLs. **Good:** canonicalisation plus depth and per-host page caps. **Great:** add SimHash (Hamming ≤ 3) to drop near-duplicate content, and track per-host novelty so low-yield hosts are quarantined automatically.

**Top-K — trending over 1B events/day**
- **Bad:** an exact hash map of every key per window. Memory is O(distinct keys), and the merge across shards is wrong if the stream isn't keyed by item.
- **Good:** key the stream by item, so each partition's local top-K is exact and the merge is correct. Hot items still overload one partition.
- **Great:** pre-aggregate at the producer to tame hot keys. Use Count-Min (w = e/ε, d = ln 1/δ) beside a candidate heap, and keep per-minute sketches that merge by addition into sliding windows. Rank by velocity against the item's own baseline, with a volume floor. A batch job keeps exact charts.

**Counters — a viral post at 50K likes/s**
- **Bad:** UPDATE posts SET likes = likes + 1. One row lock serialises everything at ~1–5K/s.
- **Good:** the edge (post_id, user_id) is the truth, and deltas are coalesced per post in a stream. Write cost is proportional to distinct posts, not clicks.
- **Great:** sharded counters only for detected hot keys. Reads come from cache with rounding ("1.2M"). "Liked by you" comes from the edge, and a periodic reconciliation emits adjustment events instead of silent overwrites.

**Online judge — hostile code**
- **Bad:** run code in a plain container with the network on. Fork bombs, crypto miners and reading the expected outputs are all possible.
- **Good:** no network, read-only root, a non-root user, cap-drop ALL, seccomp, a pids limit, and memory without swap.
- **Great:** gVisor or Firecracker for a boundary that doesn't share the kernel. Judge on CPU time with pinned cores, keep expected outputs outside the sandbox, and destroy the VM after each run.

**Online judge — the contest spike (~333 submissions/s × 3 CPU-s ≈ 1,000 cores)**
- **Bad:** reactive autoscaling takes minutes, by which time the contest is ruined. **Good:** priority queues (contest > practice > rejudge), one in-flight submission per user. **Great:** pre-scale from the contest calendar, rank by submission time rather than judging time, and keep a warm pool sized to the peak.

**Auction — the last 10 seconds**
- **Bad:** read the highest bid, then write. Two bids both "win", and the client's clock decides lateness.
- **Good:** a conditional write (amount > current AND now < end_at) on the auction's shard, using the server clock.
- **Great:** a single-writer actor per hot auction. The soft-close extension happens in the same write that accepts the bid, and the closer uses the same predicate, so the bid and the close cannot both win. Fan-out is coalesced to a few updates/s with sequence numbers.`,
      keyPoints: [
        'Shard the frontier by host so politeness never needs a lock.',
        'Key streams by item; sketches merge by addition.',
        'Edge is truth, counts are derived and reconciled.',
        'MicroVM sandboxes + calendar pre-scaling; same-write soft close.',
      ],
      source: 'Hello Interview — problem breakdowns (Bad / Good / Great deep dives)',
    },
    // ------------------------------------------------------------ APPENDED: NETFLIX COUNTER + STREAMING STRUCTURES
    {
      heading: 'Netflix\'s Distributed Counter Abstraction: event log, time buckets and rollups',
      body: `**Intuition:** don't keep one number and make every writer fight over it. Keep a **ledger** of every +n and −n, as a bank statement does, and every so often **close the books** for a period that can no longer change. The balance you show is the last closing balance. Netflix published this design in November 2024 (Shringi, Tkachuk and Sathyanarayanan). It runs on their TimeSeries Abstraction over Cassandra and is deployed through the Data Gateway control plane.

**Why the simpler designs fail** (Netflix rejects four of them before choosing):

| Approach | What breaks |
|---|---|
| One row per counter, CAS or transaction | No idempotency key, so retries over-count. Hot keys contend. Static sub-buckets still leave hot keys, and dynamic ones are hard across millions of counters |
| Each instance aggregates in memory and flushes | A crash or deploy loses the in-memory deltas. Instances can't agree on when a reset happened. Still not idempotent |
| Kafka keyed by counter + windowed stream aggregation | Lag piles up on a hot partition, and partitions need rebalancing as cardinality grows. Pre-aggregation discards the individual increments, so you can neither **audit** nor **recount** |
| Raw event log, summed on every read | Reads scan every increment, readers repeat the same work, partitions grow too wide, and storage keeps growing |

Netflix's answer combines the last two: **log every increment, roll it up in the background over a lagged time window, and bucket the log so no partition gets too wide.**

**Three counter types, chosen per namespace** (each namespace also sets TTL and expected cardinality):

| Type | Built on | Guarantees | Fits |
|---|---|---|---|
| **Best-effort regional** | EVCache (Memcached) \`incr\`/\`decr\` with TTL | Very fast and cheap. No cross-region replication of increments, no consistency guarantee, no idempotency (so retries are unsafe) | Short-lived A/B experiment counts |
| **Eventually consistent global** | TimeSeries event log + rollup store + EVCache | Durable, idempotent, converges within seconds | Durable product and business counts |
| **Accurate** (experimental) | Same, plus a live delta on read | \`lastRollupCount + delta since lastRollupTs\` | Fresher reads, costlier when the delta is large |

**API** (shaped like Java's \`AtomicInteger\`): \`AddCount\` / \`AddAndGetCount\` take \`namespace\`, \`counter_name\`, a signed \`delta\` and an \`idempotency_token { token, generation_time }\`. \`GetCount\` takes the namespace and counter name. \`ClearCount\` resets to 0 and also carries a token. Because of the token, clients can **retry and hedge** requests safely (send a duplicate to a second server when the first is slow, as in "The Tail at Scale").

**Write path, step by step**
1. The gateway durably writes an **event** to TimeSeries. The partition key is \`(counter, time_bucket, event_bucket)\`. In Netflix's sample config each time bucket is **600 s** and each counter is split into **4** event buckets per time bucket, which keeps one hot counter from forming a wide Cassandra partition.
2. \`(event_time, event_id, event_item_key)\` is the idempotency key, so a retried write lands on the same row and does not count twice.
3. The **last-write timestamp** for the counter is updated in the rollup table with Cassandra \`USING TIMESTAMP\` (set to the event time), so last-write-wins applies predictably.
4. Once the write is durable, a **fire-and-forget rollup event** \`{namespace, counter}\` goes to a rollup server. It carries **no delta**. It only says "this counter is dirty", so the rollup never has to scan the whole dataset to find what changed.

**Rollup pipeline, step by step**
1. **XXHash(counter)** picks one of the server's **in-memory queues** (8 in the sample config), so the same counter always lands on the same queue.
2. The queue is drained into a **Set**, so 10,000 events for one counter cause **one** rollup per window.
3. Consumers roll up batches of counters (\`rollup_batch_count\` 32 in the sample) with parallel range scans. They shrink the batch when counters touch many time partitions (**dynamic batching**) and wait longer between batches when the last batch was slow (**adaptive back-pressure**).
4. **The immutable window.** TimeSeries **rejects** events whose timestamp is older than \`acceptLimit\` (5 s in the sample). A window that ends at \`now − acceptLimit − skew margin\` can therefore never receive another event. The rollup sums events in \`[lastRollupTs, windowEnd)\` onto \`lastRollupCount\` and checkpoints the pair.
5. The checkpoint goes to a Cassandra **rollup table** (one per dataset) and to **EVCache as one combined value** \`{count, lastRollupTs}\`, so a reader never pairs a count with the wrong timestamp.
6. **No locks.** Two rollup servers (or old and new instances during a deploy) may both roll up the same counter. Each sums the same immutable window, so overwrites are safe. Values can briefly fluctuate because each thread has a slightly different now(), but they converge.
7. **Convergence.** Low-cardinality counters stay in rollup circulation. High-cardinality counters are re-queued only while \`lastWriteTs > lastRollupTs\`.

**Read path.** \`GetCount\` is a point read of the cached rollup, a few seconds stale. It also **triggers a rollup**, which self-heals a counter whose earlier rollup was lost. The **accurate** type adds the delta since \`lastRollupTs\`, scanned at read time. That is cheap when the counter is read often (the gap stays narrow) and expensive when it is not.

**Numbers and retention.** At publication the service handled about **75K count requests/s globally** with **single-digit-millisecond** latency on every endpoint. In the sample config, events close after 6 days (518,400 s) and are deleted after 7 days (604,800 s). Once aggregated, events can move to cheaper storage for audits.

**Trade-offs to say out loud**
- Counts lag by seconds (\`acceptLimit\` plus the skew margin plus rollup delay). That is the price of a lock-free, exact window.
- The idempotency window is bounded: a retry whose \`generation_time\` is older than \`acceptLimit\` is **rejected**, not deduplicated. Clients must mint a new token and accept the risk, or give up.
- Rollup queues live in memory, so a crash drops "dirty" signals. Rarely read counters stay stale until their next read triggers a rollup. Netflix lists durable queues and rollup handoffs as future work.
- Cross-region replication delay can let an event arrive after its window has closed, so it is missed. The planned fix is per-region rollups tallied into a global rollup table, where propagating a ClearCount across regions is the hard part.
- Netflix chose not to use HLL or Count-Min: HLL counts distinct items and can't apply +n/−n to a key, and neither sketch natively supports per-key reset or TTL. They also preferred stores they already operate.`,
      diagram: `  client: AddCount(ns, counter, delta, token{id, genTime})
     |
     v
  Data Gateway / Counter API
     | 1. durable write                     | 2. lastWriteTs (USING TIMESTAMP)
     v                                      v
  TimeSeries event store (Cassandra)      Rollup store (Cassandra, per dataset)
  PK (counter, time_bucket=600s,          counter -> {count, lastRollupTs,
      event_bucket 0..3)                              lastWriteTs}
  rows: event_time, event_id, delta            ^                 |
     ^                                         | 6. checkpoint   v
     | 5. range scan [lastRollupTs, windowEnd) |     EVCache {count, rollupTs}
     |                                         |                 ^
  +--+-----------------------------------------+--+              |
  | Rollup server: XXHash(counter) -> queue 0..7  |   7. GetCount: cached count
  |  drain to Set -> batch of 32 -> parallel scan |      (+ live delta if the
  |  -> adaptive wait before the next batch       |       type is Accurate)
  +-----------------------------------------------+
     ^ 3/4. fire-and-forget {ns, counter} after the ack (and on every read)

  time -------------------------------------------------------------------> now
  | rolled up |   immutable window: aggregate   | skew  |  acceptLimit 5s  |
           lastRollupTs                     windowEnd         (writes land)`,
      code: [
        {
          language: 'typescript',
          title: 'Event-log counter (1/2): bucketed, idempotent writes and the rollup trigger',
          code: `import { createHash } from 'node:crypto';

type IdempotencyToken = { token: string; generationTime: number };   // epoch ms
type CountEvent = { eventTime: number; eventId: string; delta: number; clear: boolean };
type Rollup = { count: number; lastRollupTs: number };   // cached as ONE value

const SECONDS_PER_BUCKET = 600;      // time_bucket width (Netflix sample: 600 s)
const BUCKETS_PER_ID = 4;            // event_bucket fan-out per time bucket
const ACCEPT_LIMIT_MS = 5_000;       // reject events stamped older than now - 5 s
const SKEW_MS = 2_000;               // extra margin for clock skew between writers

const h32 = (s: string) => createHash('md5').update(s).digest().readUInt32LE(0);

export class EventLogCounter {
  private readonly store = new Map<string, Map<string, CountEvent>>(); // partition -> rows
  readonly rollups = new Map<string, Rollup>();                         // rollup store + cache
  readonly rollupQueue = new Set<string>();                             // dedups triggers
  private readonly now: () => number;
  constructor(now: () => number) { this.now = now; }

  private partition(counter: string, t: number, eventId: string): string {
    const timeBucket = Math.floor(t / (SECONDS_PER_BUCKET * 1000));
    const eventBucket = h32(eventId) % BUCKETS_PER_ID;  // splits one hot counter 4 ways
    return \`\${counter}|\${timeBucket}|\${eventBucket}\`;
  }

  private write(counter: string, tok: IdempotencyToken, delta: number, clear: boolean): void {
    if (tok.generationTime < this.now() - ACCEPT_LIMIT_MS) throw new Error('outside acceptLimit');
    const pk = this.partition(counter, tok.generationTime, tok.token);
    const rows = this.store.get(pk) ?? new Map<string, CountEvent>();
    this.store.set(pk, rows);
    const idemKey = \`\${tok.generationTime}:\${tok.token}\`;   // (event_time, event_id)
    if (!rows.has(idemKey)) rows.set(idemKey, { eventTime: tok.generationTime, eventId: tok.token, delta, clear });
    this.rollupQueue.add(counter);   // fire-and-forget "this counter is dirty"
  }

  addCount(counter: string, delta: number, tok: IdempotencyToken): void { this.write(counter, tok, delta, false); }
  clearCount(counter: string, tok: IdempotencyToken): void { this.write(counter, tok, 0, true); }`,
        },
        {
          language: 'typescript',
          title: 'Event-log counter (2/2): rollup over the immutable window, eventual and accurate reads',
          code: `  /** Sum events in [from, to) by scanning only the time buckets that overlap the range. */
  private scan(counter: string, from: number, to: number, base: number): number {
    const width = SECONDS_PER_BUCKET * 1000;
    const events: CountEvent[] = [];
    for (let tb = Math.floor(from / width); tb <= Math.floor((to - 1) / width); tb++) {
      for (let eb = 0; eb < BUCKETS_PER_ID; eb++) {
        for (const e of this.store.get(\`\${counter}|\${tb}|\${eb}\`)?.values() ?? []) {
          if (e.eventTime >= from && e.eventTime < to) events.push(e);
        }
      }
    }
    events.sort((a, b) => a.eventTime - b.eventTime || a.eventId.localeCompare(b.eventId));
    return events.reduce((n, e) => (e.clear ? 0 : n + e.delta), base);   // a clear resets
  }

  /** Background rollup: aggregate only the immutable window, then checkpoint. */
  rollup(counter: string): Rollup {
    const prev = this.rollups.get(counter) ?? { count: 0, lastRollupTs: 0 };
    const windowEnd = this.now() - ACCEPT_LIMIT_MS - SKEW_MS;  // no new event can land below this
    if (windowEnd <= prev.lastRollupTs) return prev;
    const next = { count: this.scan(counter, prev.lastRollupTs, windowEnd, prev.count), lastRollupTs: windowEnd };
    this.rollups.set(counter, next);     // overwrite is safe: same window => same answer
    return next;
  }

  /** Eventually consistent read: cached checkpoint, plus a trigger to catch up. */
  getCount(counter: string): number {
    this.rollupQueue.add(counter);
    return this.rollups.get(counter)?.count ?? 0;
  }

  /** "Accurate" (experimental at Netflix): checkpoint + live delta since lastRollupTs. */
  getAccurateCount(counter: string): number {
    const r = this.rollups.get(counter) ?? { count: 0, lastRollupTs: 0 };
    return this.scan(counter, r.lastRollupTs, this.now() + 1, r.count);
  }
}`,
        },
      ],
      keyPoints: [
        'Log every increment with (event_time, event_id) as the idempotency key, and bucket partitions by time and event bucket so hot counters never form wide partitions.',
        'Roll up only an immutable window that ends before now − acceptLimit − skew. Racing rollup servers then compute the same answer, so no locks are needed.',
        'The rollup trigger carries no delta: it marks the counter dirty, and a Set collapses many triggers into one rollup.',
        'GetCount returns the cached {count, lastRollupTs} and triggers a rollup. The accurate variant adds a live delta scan.',
        'Costs: seconds of lag, idempotency only inside acceptLimit, lost in-memory triggers, and cross-region events that miss their window.',
      ],
      source: 'Netflix TechBlog — Netflix\'s Distributed Counter Abstraction (Shringi, Tkachuk, Sathyanarayanan, Nov 2024); ByteByteGo — How Netflix Built a Distributed Counter (2025)',
    },
    {
      heading: 'More streaming & probabilistic structures: lossy counting and cuckoo filters',
      body: `Two more structures that keep turning up in interview algorithm lists (ByteByteGo's "12 algorithms" and "6 data structures to save storage"). Each fixes a specific weakness of a structure taught earlier: **lossy counting** keeps the keys and errs downwards, while Count-Min errs upwards and stores no keys. A **cuckoo filter** supports deletes, which a Bloom filter cannot.

### Lossy counting (Manku & Motwani, VLDB 2002)

**Intuition:** you are counting with a notebook that has limited pages. Every w items you cross out anyone who hasn't earned their place. A newcomer gets credit for the counts they might have missed earlier, so a genuinely frequent item is never crossed out.

**Mechanics**, for error parameter **ε**:
1. Split the stream into buckets of width **w = ⌈1/ε⌉**. After N items the current bucket is **b = ⌈N/w⌉**.
2. Keep entries **(item, f, Δ)**, where f is the count since the entry was created and Δ is the most it could have missed before that.
3. On an arrival: if the item has an entry, \`f++\`. Otherwise insert \`(item, 1, b − 1)\`.
4. At each bucket boundary (N mod w = 0), delete every entry with **f + Δ ≤ b**.
5. To get items above support **s**, output the entries with **f ≥ (s − ε)·N**.

**Guarantees** (deterministic, no randomness):
- **No false negatives:** every item with true frequency > s·N is output.
- No item with true frequency < (s − ε)·N is output.
- **f ≤ true ≤ f + ε·N.** The estimate never overstates.
- At most **(1/ε)·log(ε·N)** entries in the worst case, and far fewer on skewed streams.

**Worked example:** ε = 0.1%, s = 1%, N = 1M. Then w = 1,000, and items are reported at f ≥ 9,000. In a simulation of the code below on a Zipf(1.1) stream over 50K keys (about 4K distinct seen), the table peaked at **524 entries**. All 10 items above 10,000 were reported, plus 2 borderline ones, and the reported counts were exact because heavy items enter early.

| | Lossy counting | Count-Min Sketch | Space-Saving |
|---|---|---|---|
| Error direction | **Under**, by ≤ εN | **Over**, by ≤ εN w.p. 1−δ | Over, by ≤ N/m |
| Stores keys | Yes | No (needs a heap beside it) | Yes |
| Memory | Grows like (1/ε)·log(εN) | Fixed: e/ε × ln(1/δ) | Fixed: m counters |
| Randomness | None | Hash functions | None |
| Merge shards | Approximate | Exact, cell-wise add | Approximate |
| Typical use | Heavy hitters in network traffic and web analytics | Frequency of any key, sliding windows of sketches | Top-K with a fixed budget |

**Interview line:** "If the business must never *overstate* a count (abuse thresholds, quota warnings), lossy counting's one-sided downward error is easier to reason about than Count-Min's."

### Cuckoo filter (Fan, Andersen, Kaminsky & Mitzenmacher, CoNEXT 2014)

**Intuition:** a hotel where every guest has exactly two possible rooms. If both are full, the newcomer evicts a resident, who moves to their *other* room, possibly evicting someone else.

**Mechanics:**
- Store only a short **fingerprint** of each item (f bits) in a table of buckets with **b = 4 slots** each.
- Two candidate buckets: **i1 = hash(x)** and **i2 = i1 XOR hash(fingerprint)**. This is **partial-key cuckoo hashing**: the alternate bucket is computed from the fingerprint alone, so a fingerprint can be kicked out and relocated without the original key. Because XOR undoes itself, \`alt(alt(i)) = i\`. The bucket count must therefore be a power of two.
- **Lookup:** read 2 buckets (2 cache lines) and compare fingerprints.
- **Insert:** use a free slot in either bucket. Otherwise swap with a random resident and move it to its alternate bucket, up to **500 kicks**. If that fails, the filter is full: rebuild it larger.
- **Delete:** remove one matching fingerprint from either bucket. This is safe **only for items that were really inserted**. Deleting a never-inserted item can remove another item's identical fingerprint and create a false negative. Inserting the same key twice stores two copies, and one key can have at most 2b = 8 copies.
- **False-positive rate** ≤ 2b / 2^f. With b = 4 and f = 12 that is ≤ 0.2%. A 100K-item simulation of the code below measured 0.16% at 76% load, and inserts only started failing at about 96% load (the paper reports ~95% for b = 4).

**Space vs Bloom.** An optimal Bloom filter needs 1.44·log2(1/ε) bits per item: 9.6 bits at 1%, 14.4 at 0.1%. A cuckoo filter needs about (log2(1/ε) + 3)/α bits, where α is the load factor: 10.1 bits at 1% and 13.7 at 0.1% when α = 0.95. The paper's semi-sorted bucket variant saves another bit per item, which is why the authors report cuckoo filters winning below roughly **3%** FPR. The plain version wins only below about 0.4%.

| | Bloom filter | Cuckoo filter |
|---|---|---|
| Delete | No (needs a counting Bloom filter, about 4× the space) | Yes, for inserted items |
| Memory reads per lookup | k random bits (about 7 at 1%) | 2 buckets |
| As it fills | FPR rises gradually, inserts never fail | Inserts slow down sharply, then fail near 95% |
| Union of two filters | Bitwise OR | Not supported |
| Redis | \`BF.ADD\` / \`BF.EXISTS\` | \`CF.ADD\` / \`CF.DEL\` / \`CF.EXISTS\` |

**Use a cuckoo filter when membership must shrink:** revoked tokens that expire, "already notified" sets with unsubscribes, cache admission where entries get evicted.

**Also on those lists, in one line each:** **MinHash** keeps the k minimum hashes of a set. The chance that two sets share a minimum equals their Jaccard similarity, which makes it useful for near-duplicate detection beside SimHash. A **skip list** is a probabilistic multi-level linked list with O(log n) search; Redis sorted sets use one. **Ray casting** tests whether a point lies inside a polygon by counting edge crossings (odd means inside), which is how a geofence check works.`,
      code: [
        {
          language: 'typescript',
          title: 'Lossy counting: deterministic heavy hitters with one-sided error',
          code: `/** Manku & Motwani lossy counting: frequencies within epsilon*N, using O((1/eps) log(eps*N)) entries. */
export class LossyCounter {
  private readonly width: number;                 // bucket width w = ceil(1/eps)
  private readonly eps: number;
  private n = 0;                                  // items seen so far
  private readonly table = new Map<string, { f: number; delta: number }>();

  constructor(eps: number) {
    this.eps = eps;
    this.width = Math.ceil(1 / eps);
  }

  add(item: string): void {
    this.n++;
    const bucket = Math.ceil(this.n / this.width);          // current bucket id, 1-based
    const e = this.table.get(item);
    if (e) e.f++;
    else this.table.set(item, { f: 1, delta: bucket - 1 }); // could have been missed in buckets 1..b-1
    if (this.n % this.width === 0) {                        // bucket boundary: prune
      for (const [k, v] of this.table) if (v.f + v.delta <= bucket) this.table.delete(k);
    }
  }

  /** Items whose true frequency may exceed s*N. No false negatives; f underestimates by <= eps*N. */
  frequent(s: number): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const [k, v] of this.table) if (v.f >= (s - this.eps) * this.n) out.push([k, v.f]);
    return out.sort((a, b) => b[1] - a[1]);
  }

  get entries(): number { return this.table.size; }
  get total(): number { return this.n; }
}`,
        },
        {
          language: 'typescript',
          title: 'Cuckoo filter: fingerprints, two buckets, bounded kicks and deletes',
          code: `import { createHash } from 'node:crypto';

const SLOTS = 4;                     // b = 4 fingerprints per bucket -> ~95% achievable load
const FP_BITS = 12;                  // f = 12 bits -> FPR <= 2b / 2^f = 8 / 4096 ~ 0.2%
const MAX_KICKS = 500;               // the paper's MaxNumKicks

export class CuckooFilter {
  private readonly slots: Uint16Array;               // 0 marks an empty slot
  private readonly mask: number;                     // bucket count is a power of two
  private victim: { i: number; fp: number } | null = null; // parked when a kick chain fails

  constructor(capacity: number) {
    const buckets = 2 ** Math.ceil(Math.log2(Math.max(1, capacity / SLOTS / 0.95)));
    this.slots = new Uint16Array(buckets * SLOTS);
    this.mask = buckets - 1;
  }

  private locate(item: string): { fp: number; i1: number; i2: number } {
    const d = createHash('sha256').update(item).digest();
    const fp = (d.readUInt16LE(0) % ((1 << FP_BITS) - 1)) + 1;      // never 0
    const i1 = d.readUInt32LE(4) & this.mask;
    return { fp, i1, i2: this.alt(i1, fp) };
  }
  // Partial-key cuckoo hashing: the other bucket is derived from the fingerprint alone,
  // so a kicked-out fingerprint can move without knowing its original key. XOR is an involution.
  private alt(i: number, fp: number): number { return (i ^ Math.imul(fp, 0x5bd1e995)) & this.mask; }
  private find(i: number, fp: number): number {      // slot index holding fp (fp = 0 finds a hole)
    for (let s = i * SLOTS; s < (i + 1) * SLOTS; s++) if (this.slots[s] === fp) return s;
    return -1;
  }

  add(item: string): boolean {
    if (this.victim) return false;                   // full: rebuild bigger
    let { fp, i1: i, i2 } = this.locate(item);
    for (const b of [i, i2]) { const s = this.find(b, 0); if (s >= 0) { this.slots[s] = fp; return true; } }
    if (Math.random() < 0.5) i = i2;
    for (let n = 0; n < MAX_KICKS; n++) {            // evict a random resident to ITS other bucket
      const s = i * SLOTS + Math.floor(Math.random() * SLOTS);
      [fp, this.slots[s]] = [this.slots[s], fp];
      i = this.alt(i, fp);
      const hole = this.find(i, 0);
      if (hole >= 0) { this.slots[hole] = fp; return true; }
    }
    this.victim = { i, fp };                         // keep the homeless fp: no false negative
    return true;
  }

  has(item: string): boolean {                       // touches at most 2 buckets
    const { fp, i1, i2 } = this.locate(item);
    if (this.victim?.fp === fp && (this.victim.i === i1 || this.victim.i === i2)) return true;
    return this.find(i1, fp) >= 0 || this.find(i2, fp) >= 0;
  }

  delete(item: string): boolean {                    // ONLY for items you know were added
    const { fp, i1, i2 } = this.locate(item);
    const s = this.find(i1, fp) >= 0 ? this.find(i1, fp) : this.find(i2, fp);
    if (s < 0) return false;
    this.slots[s] = 0;
    return true;
  }
}`,
        },
      ],
      keyPoints: [
        'Lossy counting: w = ⌈1/ε⌉, prune entries with f + Δ ≤ b at each bucket boundary, report f ≥ (s − ε)N. No false negatives, and estimates are under by at most εN.',
        'Count-Min overestimates and stores no keys. Lossy counting underestimates and stores keys, but its memory grows like (1/ε)·log(εN).',
        'Cuckoo filter: i2 = i1 XOR hash(fp) lets fingerprints move without their keys. Lookups read 2 buckets, b = 4 reaches ~95% load, and FPR ≤ 2b/2^f.',
        'Cuckoo deletes are only safe for items that were inserted. The filter fails inserts near capacity, where a Bloom filter degrades gradually instead.',
      ],
      source: 'Manku & Motwani — Approximate Frequency Counts over Data Streams (VLDB 2002); Fan, Andersen, Kaminsky & Mitzenmacher — Cuckoo Filter: Practically Better Than Bloom (CoNEXT 2014); ByteByteGo — 12 Algorithms for System Design Interviews; 6 Data Structures to Save Storage (2025)',
    },
  ],
  codeChallenges: [
    {
      id: 'design-more-cc-1',
      title: 'Turn a recursive "crawl everything" script into a polite, bounded fetch worker',
      context:
        'A team built a price-monitoring crawler by scaling up a weekend script to 20 pods. Within a day, three retailers blocked the crawler\'s IP range, one pod ran out of memory on a 2 GB "page", the job never finished because it kept re-crawling the same products via tracking links, and every restart began again from the seeds.',
      task: 'Rewrite the fetch path as a worker that takes one URL at a time from a shared frontier and is polite, bounded in time and memory, safe across redirects, resumable after a crash, and does not re-crawl the same page under different spellings. Assume frontier, robots cache, seen store and blob store services exist; define their interfaces.',
      starter: {
        language: 'typescript',
        code: `import { Pool } from 'pg';

const db = new Pool();
const seen = new Set<string>();

export async function crawl(urls: string[]): Promise<void> {
  await Promise.all(urls.map(async (url) => {
    if (seen.has(url)) return;
    seen.add(url);
    const res = await fetch(url);                       // follows redirects automatically
    const html = await res.text();
    await db.query('INSERT INTO pages (url, html) VALUES ($1, $2)', [url, html]);
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    await crawl(links);                                 // recurse into everything we found
  }));
}`,
      },
      hints: [
        'List what is unbounded here: concurrency, recursion depth, response time, response size, redirect hops, and the seen set itself. Then ask what survives a pod restart.',
        'Politeness is impossible inside Promise.all. A frontier must decide which host may be fetched now; the worker only takes one leased URL and acks it.',
        'Redirects change the URL: robots.txt, the seen check and the host rate limit all apply to the target too. Relative links must be resolved against the final URL, then canonicalized.',
      ],
      solution: {
        language: 'typescript',
        code: `import { canonicalize } from './canonicalize';           // lowercase host, sort params, drop utm_*, #

interface Lease { url: string; depth: number; leaseId: string }
interface Frontier {
  lease(): Promise<Lease | null>;                        // host-polite: only hosts whose delay elapsed
  ack(leaseId: string, feedback: { host: string; latencyMs: number; status: number }): Promise<void>;
  enqueue(urls: { url: string; depth: number }[]): Promise<void>;
}
interface Robots { allowed(url: string): Promise<boolean> }        // cached per host ~24 h
interface SeenStore { addNew(keys: string[]): Promise<string[]> }  // shared, durable; returns unseen
interface Blobs { put(url: string, body: Buffer, meta: object): Promise<void> }

const MAX_BYTES = 5 * 1024 * 1024, MAX_REDIRECTS = 5, MAX_DEPTH = 15, TIMEOUT_MS = 10_000;

async function readCapped(res: Response): Promise<Buffer | null> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_BYTES) return null;                   // stop reading; abandon the body
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function workerLoop(f: Frontier, robots: Robots, seen: SeenStore, blobs: Blobs) {
  for (;;) {
    const lease = await f.lease();
    if (!lease) { await new Promise((r) => setTimeout(r, 200)); continue; }
    let url = lease.url, status = 0; const started = Date.now();
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!(await robots.allowed(url))) { status = -1; break; }
        const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { 'user-agent': 'PriceBot/1.0 (+https://example.com/bot)' } });
        status = res.status;
        if (status >= 300 && status < 400 && res.headers.get('location')) {
          const next = canonicalize(res.headers.get('location')!, url);
          if (!next || (await seen.addNew([next])).length === 0) break;   // target already crawled
          url = next; continue;                          // re-check robots for the new host
        }
        const type = res.headers.get('content-type') ?? '';
        if (status !== 200 || !type.includes('text/html')) break;
        const body = await readCapped(res);
        if (!body) break;
        await blobs.put(url, body, { fetchedAt: Date.now(), status });
        if (lease.depth < MAX_DEPTH) {
          const links = [...body.toString('utf8').matchAll(/href="([^"#]+)"/g)]
            .map((m) => canonicalize(m[1], url)).filter((u): u is string => !!u);
          const fresh = await seen.addNew([...new Set(links)]);
          await f.enqueue(fresh.map((u) => ({ url: u, depth: lease.depth + 1 })));
        }
        break;
      }
    } catch { status = 599; }                            // timeout / reset: the frontier backs off
    // Ack last: a crash before this line lets the lease expire and the URL is retried (GET is idempotent)
    await f.ack(lease.leaseId, { host: new URL(lease.url).host, latencyMs: Date.now() - started, status });
  }
}`,
      },
      explanation: `**What was fixed:**
- **Unbounded fan-out → a leased frontier.** \`Promise.all\` + recursion opened thousands of sockets to the same retailer and grew the call stack without limit. The worker now takes one URL at a time from a host-polite frontier, so the frontier controls both concurrency and the per-host rate.
- **Politeness:** robots.txt is checked before every fetch, including every redirect target. A descriptive user agent with a contact URL is sent, and latency and status are fed back so the frontier can back off on 429/503.
- **Time and memory bounds:** \`AbortSignal.timeout\` limits slow servers; the body is streamed with a 5 MB cap, so the 2 GB "page" can no longer crash a pod; non-HTML responses are skipped.
- **Redirects handled explicitly:** \`redirect: 'manual'\` with a hop limit, canonicalization of each target, and a seen check, so redirect chains cannot loop or bypass dedup.
- **Dedup across spellings and pods:** links are resolved against the final URL and canonicalized (tracking parameters and fragments dropped). The seen set is a shared durable store with an atomic "add and tell me which were new" operation, not a per-pod in-memory \`Set\`.
- **Resumability:** state lives in the frontier and seen store, and the URL is acked only after the page is stored, so a crash means a retry, not a restart from the seeds. A depth limit stops crawler traps.`,
      followUps: [
        {
          q: 'Two pods lease URLs from the same retailer\'s host at the same moment. How does your design stop them both fetching at once?',
          a: 'The frontier, not the worker, owns politeness. It is sharded by host hash, so one frontier shard owns all of a host\'s URLs and hands out at most one lease per host at a time. The next lease waits until `nextAllowedAt`. A worker never decides on its own to fetch a host. If the frontier must be replicated, the host-to-shard mapping uses leases with fencing, so a failover cannot produce two owners of the same host.',
        },
        {
          q: 'How would you test this worker without hitting real websites?',
          a: 'Inject the four interfaces with in-memory fakes and point `fetch` at a local HTTP server (or `undici` MockAgent) that serves scripted cases: a 301 chain of length 6 (expect a stop at 5), a redirect to a robots-disallowed host, a 20 MB response (expect abandonment at 5 MB), a server that never responds (expect a timeout and status 599), and links with `utm_` parameters and fragments (expect one canonical enqueue). Assert that `ack` is called exactly once per lease, after `blobs.put`.',
        },
      ],
    },
    {
      id: 'design-more-cc-2',
      title: 'Fix a bid endpoint that lets a lower bid win and extends auctions forever',
      context:
        'An auction site\'s bid handler passed QA but failed during a sneaker drop. Two users both got "You are the highest bidder"; the final price was lower than a bid in the log; one auction ended 40 minutes late; and watchers saw a price that was later rolled back. Money is stored as floating-point rupees.',
      task: 'Rewrite `placeBid` to support proxy (max) bids with correct serialization per auction, server-side deadline checks, a correct soft close (2 minutes), idempotent retries, and price updates published only for committed bids. Use Postgres via `pg`. A pure `placeMaxBid(state, bidder, max, inc, start)` function already exists.',
      starter: {
        language: 'typescript',
        code: `export async function placeBid(auctionId: string, userId: string, amount: number, clientTime: number) {
  const { rows: [a] } = await db.query('SELECT * FROM auctions WHERE id = $1', [auctionId]);
  if (clientTime > a.ends_at.getTime()) throw new BadRequestException('Auction closed');
  if (amount <= a.current_price) throw new BadRequestException('Bid too low');

  await db.query('UPDATE auctions SET current_price = $2, leader_id = $3 WHERE id = $1',
    [auctionId, amount, userId]);
  await db.query('INSERT INTO bids (auction_id, bidder_id, amount) VALUES ($1, $2, $3)',
    [auctionId, userId, amount]);

  if (a.ends_at.getTime() - Date.now() < 120_000) {    // anti-sniping
    await db.query("UPDATE auctions SET ends_at = ends_at + interval '2 minutes' WHERE id = $1",
      [auctionId]);
  }
  await redis.publish('auction:' + auctionId, JSON.stringify({ price: amount, leader: userId }));
  return { accepted: true, leading: true };
}`,
      },
      hints: [
        'Replay two concurrent requests (₹5,000 and ₹4,800) through the SELECT → check → UPDATE sequence. Which one can land last? Where must the check happen relative to the write?',
        'Whose clock decides "before the end"? What does adding 2 minutes to ends_at do when 30 late bids arrive?',
        'What happens to subscribers if the process dies after publish but before the bid row commits? Where should the event come from instead?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Pool } from 'pg';
import { placeMaxBid } from './proxy-bidding';

type Outcome = { accepted: boolean; leading: boolean; pricePaise: number; reason?: string; endsAt?: string };
const SOFT_CLOSE_MS = 120_000;

export async function placeBid(pool: Pool, cmd: { bidId: string; auctionId: string;
                                                  bidderId: string; maxPaise: number }): Promise<Outcome> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // 1. Serialize all bids of this auction on its row; read the DB clock in the same statement
    const { rows: [a] } = await c.query(
      \`SELECT status, leader_id, leader_max, current_price, min_increment, start_price,
              ends_at, now() AS db_now
       FROM auctions WHERE id = $1 FOR UPDATE\`, [cmd.auctionId]);
    if (!a) throw new Error('NOT_FOUND');
    // 2. Idempotency check AFTER taking the lock: a concurrent retry has committed by now
    const dup = await c.query('SELECT outcome FROM bids WHERE id = $1', [cmd.bidId]);
    if (dup.rowCount) { await c.query('ROLLBACK'); return dup.rows[0].outcome; }

    const now: Date = a.db_now, endsAt: Date = a.ends_at;
    let outcome: Outcome;
    if (a.status !== 'OPEN' || now >= endsAt) {
      outcome = { accepted: false, leading: false, pricePaise: Number(a.current_price), reason: 'CLOSED' };
    } else {
      try {
        const next = placeMaxBid(
          { leaderId: a.leader_id, leaderMax: Number(a.leader_max), price: Number(a.current_price) },
          cmd.bidderId, cmd.maxPaise, Number(a.min_increment), Number(a.start_price));
        // 3. Soft close relative to the DB clock: never cumulative, never in a separate step
        const newEnds = endsAt.getTime() - now.getTime() < SOFT_CLOSE_MS
          ? new Date(now.getTime() + SOFT_CLOSE_MS) : endsAt;
        await c.query(
          \`UPDATE auctions SET leader_id = $2, leader_max = $3, current_price = $4, ends_at = $5,
                  bid_count = bid_count + 1, version = version + 1 WHERE id = $1\`,
          [cmd.auctionId, next.leaderId, next.leaderMax, next.price, newEnds]);
        outcome = { accepted: true, leading: next.leaderId === cmd.bidderId,
                    pricePaise: next.price, endsAt: newEnds.toISOString() };
        // 4. Transactional outbox: published by CDC only if this commits
        await c.query(\`INSERT INTO outbox (aggregate_id, type, payload) VALUES ($1, 'PRICE_CHANGED', $2)\`,
          [cmd.auctionId, { price: next.price, leader: next.leaderId, endsAt: newEnds }]);
      } catch (e) {
        outcome = { accepted: false, leading: false, pricePaise: Number(a.current_price),
                    reason: (e as Error).message };          // BELOW_MIN_INCREMENT / BELOW_START
      }
    }
    // 5. Every attempt is logged (audit + idempotent replay); money is BIGINT paise
    await c.query(\`INSERT INTO bids (id, auction_id, bidder_id, max_amount, accepted, outcome, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, now())\`,
      [cmd.bidId, cmd.auctionId, cmd.bidderId, cmd.maxPaise, outcome.accepted, outcome]);
    await c.query('COMMIT');
    return outcome;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}`,
      },
      explanation: `**Bugs in the starter and the fixes:**
- **Lost update / two winners:** \`SELECT\` → check → \`UPDATE\` without a lock lets a ₹4,800 bid overwrite a ₹5,000 bid that committed in between. The fix is \`SELECT ... FOR UPDATE\`, which serializes bids per auction, so validation and write see the same state.
- **Client clock trusted:** \`clientTime\` can be forged or skewed. "On time" is now decided by \`now()\` read under the lock, the same clock the closer uses.
- **No increment and float money:** the old check allowed a bid of ₹4,999.999. The pure \`placeMaxBid\` enforces the increment and proxy rules, and amounts are integer paise (BIGINT).
- **Cumulative, racy extension:** \`ends_at + 2 minutes\` per late bid let 20 bids add 40 minutes, and it ran outside any transaction, racing the closer. The new end is \`max(ends_at, now + 2 min)\` and is written in the same update as the bid.
- **Non-atomic writes:** three separate auto-committed statements could leave a new price with no bid row. Everything now happens in one transaction.
- **Phantom updates to watchers:** publishing directly to Redis could announce a bid that later failed. A transactional outbox (relayed by CDC) publishes only committed state.
- **Retries:** the idempotency check runs **after** the row lock, so two concurrent retries of the same bidId cannot both apply. Rejected attempts are logged too, for audits and replay.`,
      followUps: [
        {
          q: 'In the final 10 seconds of a hot auction, 3,000 bid attempts per second queue on that one row lock and p99 goes to 4 s. What do you change?',
          a: 'First, shed bids that cannot win: the API reads a cached current price (refreshed by the outbox stream) and rejects bids below `price + increment` without touching the DB. The cache may only reject, never accept. Second, move that auction to a single-writer path: route its bids through a Kafka partition or an in-memory actor keyed by auction_id, which applies `placeMaxBid` sequentially in microseconds and persists in small batches. Fence the writer with an epoch so a failover cannot produce two writers.',
        },
        {
          q: 'How would you prove there is no double-winner bug before the next sneaker drop?',
          a: 'Write a concurrency test against a real Postgres: fire 500 parallel bids with random amounts and duplicate bidIds at one auction, then check invariants. `current_price` must equal the price implied by replaying the accepted bids in commit order through `placeMaxBid`. There must be exactly one leader. Each bidId may appear once. `ends_at` must never exceed max(original end, last accepted bid time + 2 min). Add a soak test that runs the closer concurrently to show that no bid is accepted after status=CLOSED.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'design-more-iq-01',
      difficulty: 'hard',
      question: 'Design a crawler that refreshes product pages and prices from about 50,000 e-commerce sites every day, so our comparison app never shows a price more than a day old.',
      context: 'Reported in Meta system design loops (Glassdoor reviews, 2025) as "design a web crawler for e-commerce sites". Roughly 400M product URLs in total; some retailers have 20M products and block aggressive bots.',
      whatInterviewerLooksFor: [
        'Turns "every day" into a fetch rate and immediately spots the per-host ceiling as the binding constraint',
        'A host-sharded frontier with per-host politeness and adaptive back-off',
        'Uses cheap change signals (sitemaps lastmod, ETag/304, product feeds) before full fetches',
        'Separates fetching from extraction and handles JS-rendered pages selectively',
        'Thinks about blocking, robots.txt and legal/ToS constraints like a senior engineer',
      ],
      modelAnswer: `**Numbers first.** 400M URLs per day ÷ 86,400 ≈ **4.6K fetches/s**, which is easy for a fleet. The real constraint is per host: a 20M-product retailer at a polite 2 req/s gives only 173K pages per day, so **daily full refresh of big sites is impossible by brute force**.

**So refresh smart, not hard:**
1. **Cheap change detection first.** Read sitemaps (\`lastmod\`) and category listing pages, which show 50–100 prices each. Send conditional GETs (\`If-None-Match\` → 304 costs ~1 KB), and use official product feeds or affiliate APIs where retailers offer them. One listing page can confirm 100 prices.
2. **Prioritize by value:** popular products (our search and click data), volatile categories (electronics during sales), and products with active price alerts get revisited hourly. The long tail is checked every few days via listings.

**Architecture:** seeds and sitemaps → **frontier sharded by registered domain** (front queues by priority, back queues per host, heap on next-allowed time) → DNS cache → async fetchers (\`redirect: manual\`, timeouts, size caps) → raw HTML to S3 → **extraction workers** (per-site parsers plus schema.org \`Product\`/\`Offer\` JSON-LD, which most retailers embed) → price events to Kafka → price store (\`product_id, seller, price, currency, seen_at\`) → alerts and comparison service.

**Politeness and blocking:** respect robots.txt and crawl-delay. Set per-host rates adaptively, halving on 429/503 and on rising latency. Use an identifiable user agent and an opt-out contact. Keep per-retailer configuration (rate, render-JS flag, parser version). Use the headless-browser pool (10–50× costlier) only for sites whose price is rendered client-side.

**Correctness:** validate extracted prices (currency, a sudden 90% drop → re-fetch before publishing), dedupe product variants by canonical URL plus SKU, and record \`seen_at\` so the UI can say "price as of 3 h ago".

**Freshness SLO:** measure the age of the displayed price per product tier, not crawl throughput.`,
      followUps: [
        {
          q: 'A large retailer starts returning a CAPTCHA page with HTTP 200 to your crawler. What breaks and how do you notice?',
          a: 'The extractor finds no price, or worse, a wrong number from the block page, so prices silently go stale while fetch metrics look healthy (200 OK). Detect it by monitoring **per-site extraction success rate** and SimHash similarity: thousands of different URLs returning near-identical content is a block page. Alert on that, stop crawling the host (do not escalate evasion), mark its prices as stale in the UI, and pursue a feed or partnership.',
        },
        {
          q: 'How do you prioritize when the daily budget for a 20M-product site is 170K fetches?',
          a: 'Rank products by expected value of a refresh: popularity × probability the price changed since the last fetch (estimated from its history and category seasonality) × whether users have alerts on it. Fetch listing pages first, because each covers ~50 products and updates many prices for one request. Spend the remainder on the top-ranked product pages. The long tail rotates through over about a week.',
        },
        {
          q: 'Product pages render the price with JavaScript. Do you run headless Chrome for everything?',
          a: 'No. A headless render costs ~1–2 CPU-seconds and hundreds of MB of memory against ~10 ms to parse HTML, so it would multiply the fleet 50×. First check for JSON-LD or an embedded state blob (`__NEXT_DATA__`) and the XHR API the page calls; often the price is in the HTML anyway. Keep a per-site `needsRender` flag set by a sampled comparison, and route only those sites to a separate, autoscaled render pool.',
        },
      ],
      pitfalls: [
        'Computing 4.6K fetches/s and declaring victory without noticing the per-host ceiling on large retailers',
        'Fetching every product page daily instead of using listings, sitemaps and conditional GETs',
        'Treating anti-bot measures as something to evade rather than a signal to slow down or partner',
      ],
    },
    {
      id: 'design-more-iq-02',
      difficulty: 'expert',
      question: 'Our search crawler has a fixed budget of 2,000 fetches per second for an index of 5 billion pages. How do you decide which pages to revisit, and how do you prove the policy is better than "round robin"?',
      whatInterviewerLooksFor: [
        'Defines a measurable objective: importance-weighted freshness or age',
        'Estimates per-page change rates from observed history, handling censored observations',
        'Knows the counter-intuitive result that proportional-to-change-rate revisits can be worse than uniform',
        'Uses cheap signals (sitemaps, 304s, push protocols like IndexNow) to stretch the budget',
        'Proposes an offline simulation plus an online A/B on a slice of the index',
      ],
      modelAnswer: `**Budget:** 2,000/s × 86,400 ≈ 173M fetches/day, so on average each page gets a visit every ~29 days. Round robin gives exactly that to every page.

**Objective.** Maximize **importance-weighted freshness**: Σ wᵢ × P(page i is up to date when a user sees it), where wᵢ comes from query or click traffic and link authority. Freshness of a page nobody searches for is worth nothing.

**Estimate change rates.** Model changes per page as Poisson with rate λᵢ. Each revisit only tells us "changed or not since last time", so the observations are censored: if a page changed on 6 of 10 weekly visits, λ is higher than 6/70 days. Use the standard estimator \`λ ≈ −ln(1 − X/n) / interval\` (X changes in n visits) with smoothing, and borrow priors from the site and template for new pages. Ignore trivial changes (ads, timestamps): define "changed" as a SimHash distance above a threshold on the main content.

**Allocate revisits.** For a page visited every Iᵢ days, expected freshness is \`(1 − e^(−λᵢIᵢ)) / (λᵢIᵢ)\`. Maximize Σ wᵢ × freshnessᵢ subject to Σ 1/Iᵢ = budget. The optimum (Cho & Garcia-Molina) **gives up on pages that change far faster than we can afford** (a ticker page changing every minute is stale again almost at once) and spends the budget on important pages with moderate change rates. Proportional allocation is worse than uniform because it wastes fetches on hopeless pages.

**Stretch the budget:** conditional GETs (a 304 is cheap for both sides), sitemap \`lastmod\` and IndexNow pings from cooperating sites, and RSS feeds for news. Route breaking-news hosts to a separate high-frequency lane.

**Prove it.** First replay a historical fetch log in a simulator to compare weighted freshness under both policies. Then run an online A/B: split hosts (not pages, to avoid politeness interference) into control and treatment, and measure stale-result clicks (users clicking a result whose content no longer matches the snippet) and 404s served in results.`,
      followUps: [
        {
          q: 'A page changes every few minutes but is the homepage of a top news site. Doesn\'t your policy abandon it?',
          a: 'Only if its weight is low. A top news homepage has a huge wᵢ, and its value is its links: new articles. Treat it as a **discovery source** in a separate lane with a fixed per-host cadence (every 1–2 min within politeness), and judge it by how quickly new article URLs are discovered, not by snapshot freshness. The general optimizer covers the long tail; known hubs and feeds get explicit lanes.',
        },
        {
          q: 'A new page has no history. What interval do you give it?',
          a: 'Use a hierarchical prior: the site\'s and URL template\'s average change rate (product pages on site X change about weekly, blog posts rarely after day 3), adjusted by age, since new pages change most in their first days. Schedule a few early revisits (e.g. 1 day, 3 days, 7 days) to learn λ fast, then hand the page to the optimizer.',
        },
      ],
      pitfalls: [
        'Revisiting pages proportional to how often they change, which wastes budget on pages that are stale again within minutes',
        'Counting any byte difference (ads, CSRF tokens, timestamps) as a change, so every page looks volatile',
        'Not defining how success is measured, or measuring crawl throughput instead of freshness of what users see',
      ],
    },
    {
      id: 'design-more-iq-03',
      difficulty: 'hard',
      question: 'Yesterday 40% of the crawl budget went to a single site whose URLs look like /events?date=2026-10-08&view=week&sort=asc&sid=8f3a… and the crawler is still finding "new" URLs there. Walk me through diagnosing it and changing the design so it cannot happen again.',
      whatInterviewerLooksFor: [
        'Recognizes a crawler trap (infinite calendar plus session IDs and parameter permutations)',
        'Uses content signals (SimHash, extraction yield) rather than URL counts alone',
        'Fixes at several layers: canonicalization, per-host budgets, depth, pattern learning',
        'Keeps politeness intact: the site was also hammered',
      ],
      modelAnswer: `**Diagnose.** Look at the host's stats: URLs discovered vs fetched, distinct SimHash fingerprints, and distinct normalized URL templates. A trap shows **URLs growing without bound while distinct content stays flat**. Group the URLs by pattern: \`date\` keeps incrementing (an infinite calendar: every page links to the next day or week), \`sid\` changes per response (a session ID makes every link unique), and \`view\`/\`sort\` multiply the variants. Each page is "new" only by spelling.

**Immediate fix:** cap the host's budget (pause its back queue), and drop the queued URLs matching the pattern from the frontier.

**Design changes:**
1. **Canonicalization learns parameters.** Strip known session parameters (\`sid\`, \`sessionid\`, \`jsessionid\`). For unknown ones, test per site: fetch a sample with and without the parameter; if the SimHash is within distance 3, mark it **irrelevant** for that host and drop it before the seen check. Sort the remaining parameters.
2. **Per-host URL and fetch budgets** proportional to the host's importance (for example, links pointing into it from other sites), so no single host can consume 40% of the budget.
3. **Depth limits** from the seed and **path-pattern limits**: at most N URLs per template like \`/events?date=*\` per host per cycle.
4. **Yield-based throttling:** if the last 1,000 fetches from a host produced less than 5% new content, cut its rate and alert.
5. Honour \`rel=canonical\` and \`noindex, nofollow\`. Calendars often mark later pages that way.

**Politeness:** the site also served 40% of our traffic. The per-host rate limiter should have prevented abuse whatever the URL count, so check why the adaptive delay did not kick in (for example, the host had fast responses, so latency-based back-off never triggered).`,
      followUps: [
        {
          q: 'Your parameter-irrelevance test fetches extra variants. Isn\'t that itself wasteful?',
          a: 'It is a one-off, sampled cost per (host, parameter name): a few dozen extra fetches to save potentially millions. Run it only when a parameter appears on more than N URLs of a host, cache the verdict for weeks, and re-test occasionally because sites change. Compared with crawling every permutation, the test pays for itself within minutes.',
        },
        {
          q: 'How would you catch a trap that uses clean paths, like /a/b/a/b/a/b/…?',
          a: 'Path-based traps evade parameter rules, so use structure signals: repeated path segments (a regex for a repeating suffix), URL length over ~256 characters, depth from the seed beyond ~15, and the same SimHash yield test (new URLs, no new content). Symlink loops and relative-link bugs produce exactly this shape; a per-host "distinct content per 1,000 fetches" metric catches all variants.',
        },
      ],
      pitfalls: [
        'Only adding the specific parameter to a blocklist, which fixes this site and not the next',
        'Relying on URL dedup alone; every trap URL is unique by spelling',
        'Ignoring that the trap also violated politeness toward the site',
      ],
    },
    {
      id: 'design-more-iq-04',
      difficulty: 'hard',
      question: 'Design a service that shows the 100 most-played songs per country for "last 24 hours" (updated every minute), and also produces the official weekly chart that drives royalty payouts.',
      context: 'Reported as a "Top-K system" question at Meta, Amazon and Microsoft (Hello Interview community reports, 2025). Assume 1.2M play events/s globally at peak, 80M distinct tracks, 60 countries.',
      whatInterviewerLooksFor: [
        'Separates the approximate, fresh path from the exact, auditable path',
        'Keys the stream so local top-K lists merge correctly',
        'A sliding 24 h window without re-summing everything every minute',
        'Defines what counts as a "play" (≥ 30 s, dedup, fraud) before counting',
        'Serves reads from precomputed results',
      ],
      modelAnswer: `**Define the event first.** A play counts after 30 s of listening, at most a few times per user per track per hour, and excludes flagged bot accounts. The client sends play events with an event id, so duplicates are removed by id.

**Fresh path (every minute, approximate allowed).**
- Kafka \`plays\` keyed by **(country, track_id)**, 128 partitions. Each partition owns its keys completely, so local results are exact for those keys.
- Flink pre-aggregates per second, then keeps **per-minute buckets** per (country, track). A running 24 h total per key is maintained by adding the newest minute and subtracting the minute that just fell out (1,440 buckets of sparse maps; most tracks are absent from most minutes).
- Each task emits its local top 100 per country every minute; a merger takes the top 100 of the union (correct, because no key is split across tasks) and writes \`chart:{country}:24h\` to Redis with \`computedAt\`. Reads (~100K/s from home screens) are cache hits.
- **Memory:** about 80M tracks, but per country per day only a few million have plays. Exact sparse maps fit. If they did not, track the long tail with a Count-Min Sketch and keep exact counters only for candidates above a threshold.

**Exact path (weekly royalty chart).** Raw events land in S3/Iceberg partitioned by hour. A batch job (Spark) recomputes with full dedup, fraud rules and late events (accepted up to 72 h), and produces the official chart with lineage. Royalties come only from this path. The stream is for display.

**Hot keys:** a new Taylor Swift album makes one (country, track) key very hot. Pre-aggregation means each producer emits one count per key per second, so hot keys cost little.

**Failure handling:** Flink checkpoints to S3 every minute; on restart it replays Kafka from the checkpoint, so no plays are lost or double counted in state.`,
      followUps: [
        {
          q: 'Why not key the stream by track_id only and compute every country\'s chart in one task?',
          a: 'It works and is also exact, since all of a track\'s plays then live in one task. But one hot global track then sends all its countries\' traffic to one task, and each task keeps state for all 60 countries of its tracks. Keying by (country, track) spreads hot tracks across tasks and makes per-country top-K local. Either way, the rule is that a key\'s count must never be split across tasks, or merging local top-K lists becomes wrong.',
        },
        {
          q: 'The streaming chart and the weekly chart disagree on the #1 song. Which do you show, and how do you explain it?',
          a: 'Show the streaming chart labelled "live, last 24 h" and the batch chart labelled "official weekly". They answer different questions: different windows, and the batch path applies late events and fraud rules the stream never sees. Publish the official chart\'s methodology. If the gap is systematically large (e.g. bots), move the fraud rules upstream into the stream so the display is closer to the official result.',
        },
        {
          q: 'What does "subtract the minute that fell out" cost if the job restarts?',
          a: 'The running total and all 1,440 minute buckets are Flink keyed state, checkpointed together with Kafka offsets, so a restart restores a consistent snapshot and replays from there. Without the buckets in state you could not subtract correctly after a restart. That is why the "running total only" shortcut is wrong unless you can recompute expired buckets from the log.',
        },
      ],
      pitfalls: [
        'Using a Count-Min Sketch for the royalty chart, which must be exact and auditable',
        'Random partitioning and then merging local top-100 lists',
        'Re-summing 1,440 buckets for every key every minute instead of maintaining an incremental total',
      ],
    },
    {
      id: 'design-more-iq-05',
      difficulty: 'expert',
      question: 'Product says "Trending in India" on our short-video app shows the same blockbuster videos every day, and last week a bot farm pushed a scam video into the top 10 for six hours. Redesign how trending is computed.',
      whatInterviewerLooksFor: [
        'Distinguishes trending (acceleration) from popular (volume)',
        'A scoring formula with a baseline, smoothing and a volume floor',
        'Counts unique, trustworthy users rather than raw events',
        'Adds abuse defences and a human or policy gate for the top slots',
        'Keeps the pipeline incremental and explains the trade-offs of the parameters',
      ],
      modelAnswer: `**Why it's broken.** Ranking by raw views in a window is a popularity chart. Blockbusters win every day. Raw views are also cheap to fake: a bot farm only needs volume.

**Score velocity against the item's own baseline:**
- For each video, keep the views in the last hour **H** and a baseline **B**: an EWMA of its hourly views over past days. For new videos, use a creator- or category-level prior.
- \`score = (H_eff + α) / (B + β)\`. The smoothing constants stop "3 views vs a baseline of 0.1" from looking explosive, and a **minimum volume** (e.g. 500 effective views in the hour) is required to qualify.
- Or use a z-score: \`(H − μ) / σ\` against the item's hourly history. Both mean "unusual for this item".
- Add **time decay** so items fade after the spike, and **diversity** rules (max 2 from the same creator, cluster near-duplicates of the same meme).

**Count people, not events.** \`H_eff\` counts **unique viewers** (HyperLogLog per video per hour, merged for the window) weighted by trust: account age, prior behaviour, device and IP diversity. 10,000 views from 300 accounts on 12 IP blocks is worth very little. Cap each viewer's contribution, and down-weight traffic from a single referrer or a single ASN.

**Abuse defences:** an anomaly detector on the ratio of unique viewers to views and on the account-age distribution; a **quarantine** where candidates for the top 10 must stay above threshold for, say, 15 minutes before display; content-safety classification before promotion; and a kill switch for trust and safety.

**Pipeline:** Kafka views keyed by video_id → Flink: per-minute counts plus per-hour HLL and a trust-weighted sum → hourly baselines updated in state → score per video every minute → per-region top-K → a safety filter → Redis \`trending:IN\`. The scam case would have failed the unique-trusted-viewer threshold and the quarantine.

**Trade-offs:** higher smoothing and quarantine reduce noise but make trending lag by minutes; tune per surface.`,
      followUps: [
        {
          q: 'How do you choose α, β and the minimum volume without guessing?',
          a: 'Backtest on historical data. Replay a few weeks of events, compute candidate trending lists under different parameters, and score them against outcomes: did the item keep growing over the next 24 h (true trend), and how many items were later removed for abuse (false trends)? Pick the Pareto point, then A/B on engagement with the trending shelf. Parameters often differ per region size, since a small country needs a lower floor.',
        },
        {
          q: 'A real breaking-news clip has no baseline and gets 50K views in 10 minutes. Does your quarantine delay it too much?',
          a: 'Make the quarantine adaptive. Items whose viewers are high-trust and diverse (many ASNs, old accounts, organic referrers) clear it after a few minutes; suspicious mixes wait longer. Verified news publishers can get a fast lane. The cost of a 5-minute delay on a real trend is small compared with six hours of a scam at #3.',
        },
      ],
      pitfalls: [
        'Ranking by views in the last hour and calling it trending',
        'Counting events instead of distinct trusted users, which is exactly what bot farms exploit',
        'No safety gate between "the algorithm picked it" and "it is shown to millions"',
      ],
    },
    {
      id: 'design-more-iq-06',
      difficulty: 'hard',
      question: 'Design the like button for a photo app: users like and unlike, see "liked by you" instantly, and see a like count on every post in their feed. A celebrity post can take 150K likes per second for a few minutes.',
      whatInterviewerLooksFor: [
        'Separates the edge (who liked) from the count (how many)',
        'Idempotent like and unlike that emit count deltas only on real changes',
        'Keyed coalescing so a hot post becomes one counter write per second',
        'A read path for 20 counts per feed page from cache, with read-your-writes for the liker',
        'Reconciliation and explicit consistency choices',
      ],
      modelAnswer: `**Two data structures.**
- **Edge store** \`post_likes(post_id, user_id, ts)\`, PK (post_id, user_id), in a write-scalable store (Cassandra/ScyllaDB or sharded MySQL) sharded by post_id. A reverse table \`user_likes(user_id, post_id)\` serves "liked by you" when rendering a feed. Both are written via the same event.
- **Count** \`post_counters(post_id, likes)\` is a derived number served from Redis.

**Write path:**
1. \`LIKE\` → insert the edge with "if not exists" (Cassandra LWT is costly; a plain upsert plus a check against a per-user cache is cheaper, or a MySQL \`INSERT IGNORE\` with affected rows). **Only a real insert** emits \`+1\`; unlike emits \`−1\` only if a row was deleted. Double taps and retries change nothing.
2. The delta goes to Kafka keyed by post_id. A counter aggregator sums deltas per post for ~1 s and writes one \`INCRBY\`/\`UPDATE\` per post. **150K likes/s on one post becomes one counter write per second.**
3. The client flips the heart and +1 optimistically. The liker's own state is read from the edge (or a per-user recent-likes cache), so "liked by you" is consistent for them even though the count lags.

**The edge store is the real cost.** 150K inserts/s on one post_id lands on one partition. Cassandra handles ~10–20K writes/s per node per partition before latency suffers, so for mega-posts **split the partition key**: \`(post_id, bucket = hash(user_id) % 16)\`. A "did I like it" check still touches one bucket.

**Read path:** a feed page needs 20 counts plus 20 "liked by me" flags, as one Redis pipeline (\`HMGET\`) plus one lookup in the user's recent-likes set. Counts for hot posts are cached in-process for 1–2 s. Display rounded numbers ("1.2M").

**Consistency:** counts are eventually consistent (seconds); the edge is the truth. A nightly reconcile for recently active posts recomputes the count from the edge and emits a correction delta. Deleting a spam account emits \`−1\` for each of its likes through the same pipeline.`,
      followUps: [
        {
          q: 'A user likes, unlikes and likes again within 200 ms, and the requests arrive out of order. What does your system end up with?',
          a: 'If like and unlike are processed independently, the final state depends on arrival order and can end with "unliked" although the last tap was "like". Fix it by having the client send a monotonically increasing per-(user, post) sequence or timestamp and storing it on the edge: the server applies a request only if its seq is higher than the stored one (last-writer-wins by client seq). The client also debounces taps for about 300 ms and sends only the final state.',
        },
        {
          q: 'The aggregator crashes after writing the counter but before committing Kafka offsets. Now what?',
          a: 'On restart it replays that batch and adds the deltas twice, so the count drifts upward. Options: store the last applied offset per partition in the same transaction as the counter update (exactly-once into Postgres), or accept the small drift and let the reconcile job correct it. For likes the reconcile is usually enough; for anything billed, use the transactional offset approach.',
        },
        {
          q: 'Why not just INCR a Redis key on every like?',
          a: 'Three reasons. It is not idempotent, so retries and double taps over-count, and unlike can drive it negative. A single hot key lives on one Redis shard (about 100K ops/s), which a celebrity post exceeds. And Redis alone is not the durable record, so a failover can lose recent increments. Redis is fine as the cache of a derived count, fed by coalesced deltas from an idempotent edge store.',
        },
      ],
      pitfalls: [
        'Modelling a like as only a counter, which leaves no way to unlike correctly or show "liked by you"',
        'Writing the counter row synchronously on each click, putting row-lock contention on the request path',
        'Forgetting that the edge table itself is the dominant write load for a hot post',
      ],
    },
    {
      id: 'design-more-iq-07',
      difficulty: 'expert',
      question: 'Creators get a "unique viewers" number per video per day and per week, across 3 regions, at 2M view events per second. Finance says exact is required because it is in creator contracts. How do you design this, and what do you push back on?',
      whatInterviewerLooksFor: [
        'Quantifies the cost of exact distinct counting at this scale',
        'Knows HyperLogLog\'s memory, error and union semantics',
        'Proposes an approximate live number plus an exact batch number for contracts',
        'Handles cross-region union without double counting',
      ],
      modelAnswer: `**Cost of exact.** Exact uniques need the set of viewer ids per video per window. For a video with 50M unique daily viewers that is 50M × 8 B = 400 MB for one key, and weekly uniques cannot be summed from daily ones (the same person on Monday and Tuesday). Across millions of videos, keeping exact sets in memory for live display is unaffordable.

**HyperLogLog for live numbers.** Per (video, region, day), use a Redis HLL: \`PFADD\` on each view, **12 KB per key** whatever the cardinality, standard error ≈ **0.81%**. HLLs are **mergeable**: weekly = \`PFMERGE\` of 7 dailies; global = merge of 3 regions. Union semantics, so no double counting. **Summing** per-region counts would over-count travellers and VPN users. Write load: pre-aggregate views per (video, viewer) in the stream for a few seconds so repeat views of the same user are collapsed before \`PFADD\`. Keys use a hash tag \`{videoId}\` so merges stay on one Redis Cluster slot.

**Exact for contracts (batch).** Raw view events go to the data lake. A daily Spark job computes \`COUNT(DISTINCT viewer_id)\` per video per day and week, with fraud filtering, late events and dedup. That is cheap in batch (a shuffle by video_id), auditable and reproducible. Contracts and payouts reference **this** number, published with a 24–48 h delay.

**Pushback to finance:** "exact" must be defined: which views count (≥ 30 s?), logged-out viewers (cookie ≠ person), bot removal, and the timezone of a day. Two exact pipelines with different rules disagree more than HLL's 0.8%. Agree on one batch definition as the contractual number, and label the live dashboard "estimated".

**Region design:** each region keeps local HLLs; a merger reads all three (they are 12 KB each) and stores the global value. No synchronous cross-region traffic on the hot path.`,
      followUps: [
        {
          q: 'A creator\'s live dashboard says 1,004,200 uniques and the contract report says 997,100. They file a complaint. What do you tell them?',
          a: 'The live number is a HyperLogLog estimate (±0.8% at one standard error, ≈ ±8K here) and also includes views that the batch job later removes as invalid (bots, under 30 s, duplicates). The contract number is the exact, audited count under the published definition. Show both with labels in the UI, publish the methodology, and provide a per-day breakdown of removed views so the gap can be explained, not just asserted.',
        },
        {
          q: 'Why not use a Redis SET per video per day, at least for small videos?',
          a: 'You can, as a hybrid. Redis HLL itself uses a sparse representation for small cardinalities, which is already very compact. An exact SET is only worth it if small creators need exact live numbers. Cost grows linearly (~50–70 B per member in a Redis set), and weekly unions need `SUNIONSTORE` over large sets. Most systems use HLL everywhere live and exact sets only in batch.',
        },
      ],
      pitfalls: [
        'Adding up per-region or per-day unique counts',
        'Promising exact live distinct counts without costing the memory',
        'Not challenging what "exact" means when bots and logged-out users are involved',
      ],
    },
    {
      id: 'design-more-iq-08',
      difficulty: 'hard',
      question: 'Design an online judge like LeetCode, including weekly contests with up to 100K participants and a live leaderboard.',
      context: 'Reported at Meta (interviewing.io lists "Design an Online Judge" as a Facebook system design mock; LeetCode Discuss Meta E4 onsite reports). The interviewer expects you to drive the deep dives on execution and contest load.',
      whatInterviewerLooksFor: [
        'An async submission pipeline with idempotent submit and polling or SSE',
        'Capacity math for the contest peak and a plan for pre-scaling',
        'Sandbox isolation layers and fair, reproducible timing',
        'Queue priorities and per-user fairness',
        'A leaderboard design with a correct ranking key and caching',
      ],
      modelAnswer: `**Scope:** problems with stubs per language; Run (sample tests) and Submit (hidden tests); verdicts; contests with a live leaderboard. Out of scope: discussions, editorial.

**Flow:** \`POST /submissions\` (idempotency key) → store code in S3 and a row with status QUEUED → enqueue → **202 {submissionId}**. Judge workers pull from the queue, compile and run in a sandbox, then write the verdict idempotently. The client polls \`GET /submissions/{id}\` every second or holds an SSE stream. Never hold an HTTP request open for judging.

**Capacity:** 100K contestants × ~8 submits ≈ 800K per contest; ~25% in the last 10 minutes ≈ 333/s; ~3 CPU-s each (compile + 100 tests) ≈ **1,000 cores**, or ~180 eight-core nodes at 70% utilization. VMs boot too slowly to react, so **pre-scale from the contest calendar** 15 minutes before the start, pre-pull images and **pre-cache test bundles** for the 4 contest problems on every node.

**Execution:** one judge slot per core, pinned. Warm sandbox per language (gVisor or Firecracker, or a container with seccomp, no network, read-only root, pids, memory and output limits). Measure CPU time per test against the problem limit; stop at the first failing test; compare outside the sandbox, and use a special checker where answers can vary.

**Queues:** contest > practice > rejudge, plus **one in-flight submission per user**. Leases with a visibility timeout and heartbeats; verdict writes are conditional on status not yet DONE.

**Leaderboard:** score = points, then penalty time. Encode it in one Redis ZSET score (\`points × 10⁷ + (10⁷ − 1 − penalty)\`), updated on each first Accepted, using **submission time** (not judging time) for penalty. Top pages are cached for ~2 s; "my rank" uses \`ZREVRANK\`. Persist to Postgres; Redis is rebuildable.

**Integrity:** submission time stamped server-side; the leaderboard freezes in the last N minutes if desired; post-contest plagiarism checks.`,
      followUps: [
        {
          q: 'Contest problem 3 had a wrong expected output, discovered 40 minutes in. 30K submissions were judged against it. What happens now?',
          a: 'Fix the test bundle as a new version and enqueue rejudges for all problem-3 submissions in a **separate rejudge queue** that runs only on spare capacity (or after the contest), so live judging is not delayed. Verdicts are recorded with `test_version`, and scores are recomputed deterministically from the latest verdicts, using original submission times so penalties are unaffected. Announce it, and optionally make problem 3 unrated if rejudging cannot finish before results are published.',
        },
        {
          q: 'Why not just run each submission in AWS Lambda and let it scale?',
          a: 'Lambda (Firecracker underneath) gives strong isolation and elastic scale, which is attractive. The issues: cold starts and per-account concurrency limits at a T+0 spike, noisy CPU timing (fractional vCPU allocation makes TLE verdicts less reproducible), limited control over compilers and seccomp, and cost at sustained load. It can work for practice traffic; contests usually want a dedicated, pre-warmed fleet with pinned cores.',
        },
        {
          q: 'A contestant claims their solution passed locally in 0.8 s but got TLE with a 1 s limit. How do you make verdicts defensible?',
          a: 'Judge on CPU time from cgroup accounting, on pinned dedicated cores of a fixed instance type, and calibrate limits by running the reference solutions on that hardware (limit ≈ 2–3× the reference). Record the measured CPU time and memory per test with the verdict. For borderline TLEs (within 10%), automatically re-run once on another node and take the minimum. Publish the judge hardware and compiler flags.',
        },
      ],
      pitfalls: [
        'Running user code synchronously inside the API request',
        'Sizing for the daily average and relying on reactive autoscaling at contest start',
        'Using judging completion time for penalties, which punishes contestants for queue delay',
      ],
    },
    {
      id: 'design-more-iq-09',
      difficulty: 'expert',
      question: 'A security researcher reports that a submission on our judge could list /data/tests and print other problems\' expected outputs, and another submission took down a judge node with a fork bomb. Walk me through your sandbox, layer by layer, and what you would change.',
      whatInterviewerLooksFor: [
        'Defence in depth: node, kernel boundary, resource limits, privileges, data exposure',
        'Knows why containers alone are a weak boundary for hostile code',
        'Concrete controls: pids-limit, memory without swap, seccomp, no network, read-only mounts',
        'Keeps expected outputs outside the sandbox entirely',
        'Adds detection and blast-radius limits, not only prevention',
      ],
      modelAnswer: `**Root causes:** (1) the whole test directory was mounted into the sandbox, including expected outputs. Data exposure is a mount bug, not an exploit. (2) There was no process limit, so a fork bomb exhausted the node's PID table and took down every slot.

**Layer by layer, outside in:**
1. **Node and network:** judge nodes in an isolated VPC/account, no IAM role, metadata endpoint blocked, no egress. Nodes are disposable; recycle them every few hours or after anomalies.
2. **Kernel boundary:** containers share the host kernel, so one kernel bug escapes them. Run untrusted code under **gVisor** (syscalls handled by a user-space kernel) or **Firecracker microVMs** (hardware virtualization, ~125 ms boot). Keep warm pools so boot time stays off the critical path.
3. **Resources (cgroups v2):** \`pids.max\` ≈ 64 (no fork bomb), \`memory.max\` with swap 0 (OOM → MLE), CPU quota with a pinned core, file size and output caps, a wall-clock kill timer.
4. **Privileges:** a non-root user, \`cap-drop ALL\`, \`no-new-privileges\`, a seccomp **allow-list** (block \`ptrace\`, \`mount\`, \`bpf\`, \`socket\` for most languages), read-only root, a small noexec tmpfs.
5. **Data exposure:** mount **only the current test's input file**, read-only, into a per-run directory. Expected outputs and other problems' data never enter the sandbox; the comparator runs in the trusted runner process outside.
6. **Per-run cleanup:** a fresh filesystem layer per submission, so no state leaks between users (one user's code cannot leave files for the next).

**Detection:** log seccomp violations and OOM/pids events per submission, alert on spikes, and auto-flag the account. Run the judge as its own blast-radius unit: one slot crashing must not affect others, and the scheduler re-queues work from a dead node.

**Process:** a bug bounty scope for the judge, a regression suite of known-malicious submissions (fork bomb, \`/proc\` reads, network calls, huge output) run on every image change.`,
      followUps: [
        {
          q: 'Python submissions need to import numpy, and Java needs a JIT that spawns threads. Doesn\'t a strict seccomp profile and pids-limit break them?',
          a: 'Yes, if you use one profile for everything. Keep **per-language profiles** built by tracing reference programs (allow `clone` for threads but with pids.max large enough for JVM threads, e.g. 64–128), pre-install libraries in the read-only image, and test each profile against a corpus of accepted solutions. The limit stops unbounded forking, not normal threads.',
        },
        {
          q: 'gVisor adds syscall overhead. Doesn\'t that make timings unfair across languages?',
          a: 'The overhead mostly affects syscall-heavy code (heavy I/O). Compute-bound solutions run at near-native speed. Since every submission for a problem runs under the same runtime on the same hardware, it is fair relative to other contestants. Calibrate time limits by running reference solutions under the same sandbox, not on a bare laptop.',
        },
      ],
      pitfalls: [
        'Saying "we run it in Docker" as if a default container were a security boundary for hostile code',
        'Mounting test directories wholesale and relying on file permissions',
        'Only adding prevention, with no detection or regression suite of malicious samples',
      ],
    },
    {
      id: 'design-more-iq-10',
      difficulty: 'hard',
      question: 'Design an online auction system like eBay. Bids must be strictly ordered and never lost, the UI must update in real time as bids come in, and auctions must stay fast as they approach their deadline with many bidders and watchers.',
      context: 'Reported in a Meta senior software engineer onsite (Taro interview experience, Feb 2025), including real-time UI updates and how to shard data and processing near the deadline.',
      whatInterviewerLooksFor: [
        'Strong consistency per auction with a clear serialization point',
        'Correct handling of the deadline using the authority\'s clock',
        'Scalable real-time fan-out decoupled from the bid path',
        'Sharding by auction and a plan for the few hot auctions',
        'Reliable close and settlement',
      ],
      modelAnswer: `**Scale:** 10M active auctions and ~160 bids/s on average, which is trivial. The challenge is **skew**: a hot auction can take thousands of bid attempts per second in its last seconds, with 100K+ watchers.

**Serialization point per auction.** Shard auctions and bids by auction_id (Postgres/Vitess or DynamoDB). Accept a bid with **one conditional write** under the row lock: \`amount ≥ current_price + increment\`, \`status = OPEN\`, \`now() < ends_at\`, plus the bid row and an outbox row in the same transaction. The DB clock decides "on time". Two users can never both be told they lead: the second conditional write sees the first's price.

**Proxy bidding:** store \`leader_max\` and compute the visible price as second-highest max + increment inside the same transaction.

**Hot auctions:** (1) the API rejects obviously losing bids using the cached current price (cache can only reject); (2) for marquee auctions, route bids to a **single-writer actor** keyed by auction_id (Kafka partition or an in-memory actor with an epoch-fenced lease) that applies bids sequentially in memory and persists in micro-batches before acking. That gives ~100K decisions/s on one auction, with a slightly longer ack.

**Real-time updates:** outbox → CDC → Kafka → a fan-out service that publishes to a **per-auction channel** (Redis pub/sub). WebSocket/SSE gateways subscribe only to channels their clients watch. For hot auctions, **coalesce** to about 4 updates/s (latest state wins) with a \`seq\` for ordering. Clients re-fetch on reconnect.

**Deadline:** soft close (a late bid extends to now + 2 min) in the same write; the closer runs \`UPDATE ... SET status='CLOSED' WHERE now() >= ends_at AND status='OPEN'\` and simply re-schedules if ends_at moved. Jitter round end times at creation to avoid thundering closes.

**Settlement:** a saga creates the order and payment, notifies winner and seller, and offers the item to the runner-up if payment fails within 48 h.`,
      followUps: [
        {
          q: 'Your single-writer actor for a hot auction dies after accepting a bid in memory but before persisting it. Was the bid lost?',
          a: 'Only if you acked before persisting. The actor must append each decision (or each micro-batch) to a durable log, such as the Kafka topic itself or a DB write, before replying "accepted". On failover the new writer (higher epoch) rebuilds state from the persisted log, and the old writer\'s late writes are rejected by the epoch fence. Clients whose requests timed out retry with the same idempotency key and get the recorded outcome.',
        },
        {
          q: 'How would you shard if one seller runs 50,000 one-cent-start auctions ending at the same minute?',
          a: 'Sharding by auction_id (hashed) already spreads them across shards; sharding by seller would concentrate them, which is why the seller is not the key. The real risk is the close burst: 50K closes in one minute. Add jitter to end times at creation, run closers as partitioned workers reading a time-bucketed index, and make settlement asynchronous through a queue so the payment provider sees a smooth rate.',
        },
        {
          q: 'Could you use a Redis Lua script as the serialization point instead of the database?',
          a: 'Yes. A Lua script per auction key is atomic and fast (~100K ops/s per shard). But Redis is not the durable record by default, and an async-replicated failover can lose the last acknowledged bids, which violates "never lost". If you use it, persist each accepted bid durably before acking (AOF with fsync always, or write-through to the DB). Many teams keep the DB conditional write as the authority and use Redis only for reads and pre-rejection.',
        },
      ],
      pitfalls: [
        'Read-then-write bid checks in application code without a lock or a conditional write',
        'Deciding the deadline with client or app-server timestamps',
        'Pushing every bid synchronously to 100K WebSockets from the bid request path',
      ],
    },
    {
      id: 'design-more-iq-11',
      difficulty: 'expert',
      question: 'Sellers complain that auctions are "won by bots in the last second". Product proposes a soft close. Walk me through the exact rules, what changes in the data path, and the second-order effects you would watch.',
      whatInterviewerLooksFor: [
        'Precise extension rule tied to the authority\'s clock and the accepting write',
        'Understands interaction with the closer and with proxy bidding',
        'Considers load shape, fairness and gaming of the new rule',
        'Defines metrics to judge success',
      ],
      modelAnswer: `**Why sniping works under a hard close:** bidders wait until the last second so others cannot react, and the winner is whoever's request reaches the authority first. That rewards bots and network latency, and often under-prices the item (no time for counter-bids).

**Rule:** "If a bid is **accepted** when less than T (e.g. 2 min) remains, \`ends_at = max(ends_at, accept_time + T)\`." Only accepted bids extend (otherwise bots extend forever with invalid bids). \`accept_time\` is the authority's clock, and the extension is computed **in the same conditional update** that accepts the bid. Set it as \`now + T\`, never \`ends_at + T\`, so it cannot accumulate. Optionally cap total extension (e.g. 30 minutes) to bound worst-case length.

**Data path changes:**
- The closer must use the same predicate (\`now() >= ends_at\`) under the same row lock and re-schedule when ends_at moved. A timer wheel entry for the old time simply finds nothing to close.
- Live updates must carry \`endsAt\` so watchers see the countdown reset. Clients render from the server time offset, not their local clock.
- Proxy bidding interacts well: a challenger's max bid that the leader's proxy defends still counts as accepted and still extends, which is correct, because the price changed.

**Second-order effects to watch:**
- **Load shape:** instead of one spike at the end, there is a tail of smaller spikes. Better for the hot row, but auctions last longer, so capacity for "active auctions" goes up slightly.
- **Gaming:** bots switch to bidding at T − 1 s repeatedly. Fine: every bid now gives humans a 2-minute window, which is the goal.
- **Seller and buyer UX:** "ends in 2:00" that keeps resetting can frustrate people. Show "extended because of a late bid".
- **Notifications:** outbid alerts now matter a lot; they must arrive within seconds to be useful.

**Metrics:** share of final bids placed in the last 10 s, final price relative to similar items (it should rise), the number of distinct bidders in the final phase, auction duration distribution, and complaint rate. A/B by category before a full rollout.`,
      followUps: [
        {
          q: 'eBay famously keeps a hard close and relies on proxy bidding instead. Why could that be reasonable?',
          a: 'With proxy bidding, a bidder enters their true maximum early, and the system defends it automatically up to that amount. A sniper then only wins by bidding above your stated maximum, which is the outcome you agreed to. The auction behaves like a second-price sealed bid, so sniping changes less than it seems. Hard closes are also predictable for buyers planning their day. A soft close mainly helps when bidders do not use max bids.',
        },
        {
          q: 'With a soft close, an auction gets bids every 100 seconds for 6 hours from two determined bidders. Is that a problem?',
          a: 'It is what the rule allows, and it usually ends quickly because each bid must raise the price by an increment, so the price climbs steadily. If it becomes a UX or capacity issue, cap the total extension or grow the increment during the extension phase. Track the distribution of extension counts; a long tail like this is rare and mostly a fairness win.',
        },
      ],
      pitfalls: [
        'Extending by adding T to ends_at, which accumulates with every late bid',
        'Extending in a separate step that races with the closer',
        'Letting rejected bids extend the auction, which bots can abuse',
      ],
    },
    {
      id: 'design-more-iq-12',
      difficulty: 'expert',
      question:
        'Your platform team must offer counting as a shared service: product teams call add(counter, delta) about 60K times a second across three regions. Finance also needs to audit how a counter reached its value and to recount a day after a bug. Clients retry and hedge requests. Design it around an event log instead of a counter row, and explain how aggregation avoids racing writers without locks.',
      whatInterviewerLooksFor: [
        'Rejects a single CAS row and pure pre-aggregation with specific reasons (contention, retries, no audit or recount)',
        'Picks an idempotency key and a partitioning scheme that bounds partition width for hot counters',
        'Explains an immutable aggregation window tied to a write-acceptance limit, and why that makes lock-free rollups safe',
        'Designs a cheap read path and states the staleness, cost and failure trade-offs honestly',
      ],
      modelAnswer: `**Why not a row or a stream pre-aggregate.** A counter row needs CAS or a transaction on every add, so a hot counter serialises, and a retry double-counts unless the token is stored somewhere else. Kafka keyed by counter plus windowed sums fixes contention, but it throws the individual increments away. Audit and recount are then impossible, and that is a stated requirement.

**Write path.**
- Each add is an **event row**: \`(counter, time_bucket, event_bucket) → (event_time, event_id, delta)\`. Use 10-minute time buckets and a few event buckets chosen by hashing event_id, so a viral counter spreads over several Cassandra partitions instead of one wide one.
- The client supplies \`token + generation_time\`. \`(event_time, event_id)\` is the clustering key, so a retry or a hedged duplicate overwrites the same row. Idempotency is a property of the data model, not of a separate lookup table.
- After the write is acknowledged, send a **fire-and-forget "dirty" signal** for the counter. It carries no delta.

**Aggregation without locks.**
- The store **rejects** events stamped older than \`acceptLimit\` (say 5 s). A window that ends at \`now − acceptLimit − skew\` is therefore **immutable**.
- A rollup worker sums events in \`[lastRollupTs, windowEnd)\` onto the checkpoint and writes \`{count, lastRollupTs}\` as one value. Two workers rolling up the same counter compute the same result for the same window, so last-write-wins is harmless and no distributed lock is needed.
- Route counters to in-memory queues by hash and drain each queue into a set, so a burst of 10K signals causes one rollup. Batch the rollups and back off when the store slows.

**Read path.** Return the cached checkpoint (a single point read, typically under 5 ms, a few seconds stale) and trigger a rollup, which also repairs counters whose signal was lost. Where freshness matters, add a live scan of the delta since \`lastRollupTs\`.

**Audit and recount.** Events are retained for about 7 days in the hot store and then archived. A recount replays a day of events into a new checkpoint. Netflix's Counter Abstraction does this at about 75K requests/s with single-digit ms latency.

**Trade-offs.** Counts lag by seconds. A retry after \`acceptLimit\` is rejected, not deduplicated. In-memory signals can be lost on a crash. Cross-region replication lag can drop an event behind a closed window, so per-region rollups summed globally are the more robust choice for three regions.`,
      followUps: [
        {
          q: 'A client retries 9 seconds after its first attempt because of a long GC pause, and acceptLimit is 5 s. What happens, and what should the client do?',
          a: 'The retry carries the original generation_time, which is now older than the 5 s acceptLimit, so the store rejects it rather than deduplicating it. If the first attempt did land, the count is correct. If not, the increment is lost unless the client acts. The client should surface a definite error, not retry with a fresh timestamp blindly, because that could double count if the first write succeeded. Options: read back the event by its id, or accept a rare loss for best-effort uses. Keeping acceptLimit a little above the client retry budget avoids most of these cases.',
        },
        {
          q: 'A rollup server crashes with 40K dirty signals in its in-memory queues. Which counters stay wrong, and for how long?',
          a: 'Nothing is lost from the event log, only the reminders. Counters that are read or written again soon re-enter a queue, because every add and every GetCount sends a signal, so they heal within one rollup cycle. The exposed ones are counters that are written once and then go quiet: their cached value stays stale until someone reads them, and that first read is stale too. Fixes: a periodic sweep for rows where lastWriteTs > lastRollupTs, or durable queues, which Netflix lists as future work.',
        },
        {
          q: 'How would ClearCount work when three regions roll up independently?',
          a: 'A clear is itself an event with a timestamp, and the rollup resets the running sum at that point in time order. With per-region rollups summed globally, every region must apply the reset at the same logical point. Otherwise one region\'s pre-clear increments survive in the global sum. One option is to write the clear to every region\'s log with one timestamp and have the global tally ignore regional checkpoints older than the latest clear. That cross-region coordination is the hard part Netflix calls out.',
        },
      ],
      pitfalls: [
        'Rolling up up to now(), so late but accepted events fall behind the checkpoint and are never counted',
        'Implementing idempotency as a separate "seen tokens" table checked before the increment, which races and doubles the writes',
        'Putting every event for a counter in one partition, which creates a wide partition for viral counters',
        'Claiming exactly-once across regions without addressing replication lag or how resets propagate',
      ],
    },
    {
      id: 'design-more-iq-13',
      difficulty: 'hard',
      question:
        'A payments fraud team wants two things from the card-authorisation stream (40K auths/s): every merchant whose share of declines exceeds 0.5% in the last hour, and a "recently blocked device" check on every auth, where devices are unblocked after review. Each scoring node has about 50 MB to spare. Which data structures do you use, and why those rather than Count-Min and a Bloom filter?',
      whatInterviewerLooksFor: [
        'Matches the direction of each structure\'s error to the business risk',
        'Sizes lossy counting with ε and support s, and states its guarantees',
        'Sees that unblocking needs deletes and picks a cuckoo filter, knowing its delete caveat',
        'Handles windowing, multiple nodes and the fallback to an exact check',
      ],
      modelAnswer: `**Heavy-hitter merchants: lossy counting.**
- Support s = 0.5%. Pick ε = 0.05% (a tenth of s), so the bucket width is w = 2,000 declines.
- Output every merchant with f ≥ (s − ε)·N. Guarantees: **no merchant above 0.5% is missed**, nothing below 0.45% is reported, and each estimate is low by at most 0.05% of N.
- Memory is at most (1/ε)·log(εN) entries. At 1M declines per hour, εN = 500 and ln 500 ≈ 6.2, so about 12.4K entries, a few MB.
- Why not Count-Min: it overestimates and stores no keys. You would need a candidate heap beside it, and every alert would be "possibly inflated". Lossy counting is deterministic and errs downwards, so an alert means the merchant really is above 0.45%.
- For the last hour, keep 12 five-minute lossy tables and combine them, or partition the stream by merchant_id so each node counts its merchants exactly and the sketch only bounds memory.

**Blocked devices: a cuckoo filter in front of the exact list.**
- Devices get **unblocked**, and a Bloom filter cannot delete. A rebuild every few minutes would keep wrongly declining users who were just cleared.
- A cuckoo filter with 4-slot buckets and 12-bit fingerprints has FPR ≤ 0.2% and uses about 13 bits per device. 10M blocked devices is about 16 MB.
- A filter hit means "maybe blocked": confirm against the exact store (Redis set or DB). A miss is definitive, so 99.8% of auths skip the remote call.
- Delete only devices you know were inserted, by driving deletes from the block table's change stream. Deleting a never-inserted id can remove another device's fingerprint and let a blocked device through.
- Plan capacity for no more than ~95% load and rebuild at a larger size before that, because inserts fail near full.

**Operations.** Rebuild filters from the source of truth on deploy, version them, and monitor the confirm-hit ratio to catch FPR drift.`,
      followUps: [
        {
          q: 'Product now wants each flagged merchant\'s decline count shown exactly on the analyst dashboard. Does lossy counting still work?',
          a: 'Use it for detection, not reporting. Lossy counting tells you which merchants to look at, with counts that may be low by up to εN (500 declines here). For the dashboard, run an exact GROUP BY over the hour for just the flagged merchants against the event store or an OLAP table. That query is cheap because it covers a few dozen merchant ids, not millions. Showing sketch values as exact would mislead analysts.',
        },
        {
          q: 'A bug sends DELETE for 20K device ids that were never blocked. What is the impact on the cuckoo filter?',
          a: 'Each bogus delete can remove a fingerprint that matches in one of the two candidate buckets, and that fingerprint may belong to a different, genuinely blocked device. That device then gets a definitive miss and bypasses the block, a false negative that a filter must never produce. With 12-bit fingerprints the chance per bogus delete is small but real, and across 20K deletes some blocked devices can slip through. Recovery: rebuild the filter from the block table. Prevention: only delete in response to an unblock event for an id that exists in the table.',
        },
      ],
      pitfalls: [
        'Choosing Count-Min for alerts without noticing that it inflates counts and stores no keys',
        'Using a Bloom filter for a set that shrinks, then rebuilding it hourly and blocking users who were already cleared',
        'Treating a filter hit as a definitive "blocked" instead of confirming it against the exact store',
        'Deleting from a cuckoo filter ids that were never inserted',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'design-more-boe-1',
      question: 'Size a search crawler that must re-fetch 5 billion pages every 30 days: fetch rate, bandwidth, storage per snapshot, concurrent connections, and how long one 50M-page host takes at a polite rate.',
      assumptions: [
        'Average HTML page ≈ 100 KB uncompressed, ≈ 25 KB gzip on the wire and in storage',
        'Average fetch time ≈ 1 s including slow servers (DNS cached)',
        'Politeness default: 1 request/s per host; large hosts may negotiate up to ~20 req/s',
        'Peak planning factor 2× over the average',
      ],
      steps: [
        { label: 'Average fetch rate', calc: '5×10⁹ ÷ (30 × 86,400 s = 2.59×10⁶ s) ≈ 1,930 pages/s; plan for ~4K/s' },
        { label: 'Bandwidth', calc: '1,930 × 25 KB ≈ 48 MB/s ≈ 390 Mbps average; ~800 Mbps at the planning peak' },
        { label: 'Storage per snapshot', calc: '5×10⁹ × 25 KB = 125 TB; × 1.5 erasure coding ≈ 190 TB' },
        { label: 'Concurrent connections', calc: '1,930 /s × 1 s ≈ 2K in flight (4K at peak) → ~8 async fetcher processes at ~500 sockets each' },
        { label: 'Big host at 1 req/s', calc: '50×10⁶ ÷ 86,400 ≈ 579 days' },
        { label: 'Big host at 20 req/s', calc: '50×10⁶ ÷ 20 ÷ 86,400 ≈ 29 days, just inside the cycle' },
        { label: 'Hosts needed in parallel', calc: '≥ 1,930 hosts active at once at 1 req/s each, more since delays exceed 1 s' },
      ],
      answer: 'About 2K pages/s (plan 4K), ~400 Mbps, ~125 TB per snapshot (~190 TB with erasure coding), and ~2K concurrent connections, which is a small fleet. But a 50M-page host needs 579 days at 1 req/s, and even at 20 req/s it uses the whole 30-day cycle.',
      insight: 'Raw throughput is cheap; the binding constraints are per-host politeness and host concentration. The frontier must interleave thousands of hosts at once, adapt per-host rates, and the re-crawl policy must decide which pages of giant hosts are worth refreshing at all, rather than adding fetchers.',
      followUps: [
        {
          q: 'Product wants the cycle cut from 30 days to 7. What breaks first?',
          a: 'The fleet scales linearly (≈ 8.3K pages/s, ~1.7 Gbps, ~8K sockets), which is just more machines. The big hosts break: a 50M-page site would need ~83 req/s for 7 days, which few operators will tolerate. So the 7-day target can only apply to a subset: important pages and hosts that permit it (or provide sitemaps and feeds). Everything else stays on a longer cycle.',
        },
        {
          q: 'Storage must halve. Which assumption do you attack?',
          a: 'Store fewer bytes per page: skip storing unchanged pages (a 304 or identical content hash means only a pointer to the previous version), drop near-duplicates (SimHash), and keep extracted text plus a compressed DOM summary rather than full raw HTML for low-value pages. zstd with per-site dictionaries also beats gzip on HTML by ~30–40%. Unchanged-page dedup alone often removes more than half of each snapshot.',
        },
      ],
    },
    {
      id: 'design-more-boe-2',
      question: 'A trending pipeline sees 500K view events/s and ~100M distinct videos per day. Compare the memory for exact counts (one day; and a sliding 24 h with per-minute buckets) against a Count-Min Sketch with ε = 10⁻⁶ and δ = 1%. What overcount does the sketch allow?',
      assumptions: [
        'Exact hash map entry ≈ 50 B (8 B id + 8 B count + map overhead)',
        'Compact per-minute bucket entry ≈ 16 B; ~5M distinct videos per minute',
        'CMS counters are 4-byte integers',
      ],
      steps: [
        { label: 'Events per day', calc: '500K × 86,400 ≈ 4.32×10¹⁰' },
        { label: 'Exact daily map', calc: '100M × 50 B ≈ 5 GB per counting instance' },
        { label: 'Exact sliding 24 h', calc: '1,440 buckets × 5M × 16 B ≈ 115 GB' },
        { label: 'CMS width', calc: 'w = ⌈e / 10⁻⁶⌉ = 2,718,282' },
        { label: 'CMS depth', calc: 'd = ⌈ln(1/0.01)⌉ = ⌈4.6⌉ = 5' },
        { label: 'CMS memory', calc: '2.72M × 5 × 4 B ≈ 54 MB' },
        { label: 'Allowed overcount', calc: 'ε·N = 10⁻⁶ × 4.32×10¹⁰ ≈ 43,200 views (with 99% probability)' },
      ],
      answer: 'Exact counting needs ~5 GB for a daily window and ~115 GB for a sliding 24 h of per-minute buckets; a CMS needs ~54 MB per window, but any estimate may be up to ~43K views too high.',
      insight: 'A sketch is about 100× smaller and merges by addition, but its error is additive in total volume: fine for picking the top 100 (which have millions of views) and meaningless for the long tail. Pair it with a candidate heap, keep exact counts only for candidates, and get exact numbers from batch when they matter.',
      followUps: [
        {
          q: 'You need the same accuracy for a sliding 24 h window built from 24 hourly sketches. How much memory now?',
          a: 'The error bound is relative to the events summed into the query. Summing 24 hourly sketches with the same w covers the same N and gives the same ε·N bound, so each hourly sketch can keep w = 2.72M. Memory is 24 × 54 MB ≈ 1.3 GB, still far below 115 GB exact. Coarser buckets mean the window slides hourly; per-minute sketches would be 1,440 × 54 MB ≈ 78 GB, which is why you choose hourly buckets plus an exact partial hour.',
        },
      ],
    },
    {
      id: 'design-more-boe-3',
      question: 'During an IPL final, the like service peaks at 2M like/unlike events per second across 50M posts. Estimate counter writes per second with no coalescing, with 1 s coalescing, and with 10 s coalescing, and size the edge-store shards.',
      assumptions: [
        'Distinct posts touched: ~150K in any 1 s window, ~600K in any 10 s window (Zipf: a few posts take most likes)',
        'Batched UPDATE of 500 rows per statement',
        'One edge-store shard sustains ~20K writes/s',
      ],
      steps: [
        { label: 'No coalescing', calc: '2M counter row updates/s, with thousands per second on the hottest rows' },
        { label: '1 s coalescing', calc: '≈ 150K row updates/s → ÷ 500 ≈ 300 statements/s' },
        { label: '10 s coalescing', calc: '≈ 600K ÷ 10 = 60K row updates/s → ≈ 120 statements/s' },
        { label: 'Reduction', calc: '2M → 150K is ~13×; 2M → 60K is ~33×, and each hot post is 1 write per window' },
        { label: 'Edge store', calc: '2M edge writes/s ÷ 20K per shard ≈ 100 shards (× replication factor in nodes)' },
      ],
      answer: 'Counter writes fall from 2M/s to ~150K/s (1 s window) or ~60K/s (10 s window), i.e. a few hundred batched statements per second. The edge store still takes all 2M writes/s and needs ~100 shards.',
      insight: 'Coalescing makes counter cost proportional to distinct posts, not clicks, and removes hot-row contention. But it does nothing for the who-liked-what edges, which dominate capacity, so they need a write-optimized, sharded store (with split partitions for mega-posts). The coalescing window is a staleness-vs-write-cost dial.',
      followUps: [
        {
          q: 'Peak is 10× higher (20M/s) on a single viral post. What breaks first?',
          a: 'Not the counter: coalescing still writes that post once per window. The edge partition for that post_id breaks first (20M inserts/s into one key), followed by the Kafka partition carrying its deltas. Split the edge key into (post_id, hash(user_id) % N) buckets, and pre-aggregate deltas at the producers so the Kafka partition receives one summed message per producer per second.',
        },
      ],
    },
    {
      id: 'design-more-boe-4',
      question: 'Size the judge fleet for a contest with 100K participants: 90 minutes, ~8 submissions per participant, a quarter of them in the last 10 minutes, ~1 s compile and 100 tests at ~20 ms CPU each.',
      assumptions: [
        'One judge slot per pinned core; 8-core nodes',
        'Target utilization 70% at peak to keep queueing delay low',
        'No early exit on failing tests (worst case); practice traffic is negligible during the contest',
      ],
      steps: [
        { label: 'Total submissions', calc: '100K × 8 = 800K' },
        { label: 'Average rate', calc: '800K ÷ 5,400 s ≈ 148/s' },
        { label: 'Final-10-minute rate', calc: '800K × 0.25 ÷ 600 s ≈ 333/s' },
        { label: 'CPU per submission', calc: '1 s + 100 × 0.02 s = 3 CPU-s' },
        { label: 'Busy cores at peak', calc: '333 × 3 ≈ 1,000 cores' },
        { label: 'With 70% target', calc: '1,000 ÷ 0.7 ≈ 1,430 cores ÷ 8 ≈ 180 nodes' },
      ],
      answer: 'About 1,000 busy cores in the final 10 minutes, so ~180 eight-core nodes at 70% utilization, versus ~450 busy cores at the contest average.',
      insight: 'The end-of-contest surge sets the fleet size and arrives on a known schedule, so pre-scale from the contest calendar instead of reacting to queue depth (VMs take 1–2 minutes to boot). Early exit on the first failing test and caching compiled artifacts for identical resubmissions cut the real demand well below this worst case.',
      followUps: [
        {
          q: 'Half of submissions fail on average at test 10 of 100. How does that change the fleet?',
          a: 'Failing submissions cost 1 s + 10 × 0.02 s = 1.2 CPU-s instead of 3. The average becomes 0.5 × 3 + 0.5 × 1.2 = 2.1 CPU-s, so peak demand drops to ≈ 333 × 2.1 ≈ 700 cores, or ~125 nodes at 70%. That is a 30% saving from early exit alone, which is why judges stop at the first failure.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'design-more-mcq-01',
      difficulty: 'hard',
      question: 'Your frontier enforces politeness per hostname with the code below. A shared-hosting company emails you: its single server at 203.0.113.7 hosts 30,000 small blogs and your crawler is sending it ~300 requests/s. What is the right fix?',
      code: {
        language: 'typescript',
        code: `enqueue(url: string) {
  const key = new URL(url).host;            // politeness key
  const q = this.queues.get(key) ?? this.newQueue(key, 1000 /* ms between hits */);
  q.urls.push(url);
}`,
      },
      options: [
        'Raise every host\'s delay from 1 s to 30 s so that shared servers see fewer requests',
        'Also rate-limit by resolved IP: a URL may be fetched only when both its host queue and its IP bucket allow it',
        'Shard the frontier by host hash so that each host is served by exactly one fetcher',
        'Lower the crawl priority of blog domains so that they are fetched later in the cycle',
      ],
      correct: [1],
      explanation:
        'Politeness protects servers, and 30,000 hostnames on one IP are one server, so the limiter must also key on IP (or IP block/ASN). A 30 s delay per host still allows 30,000 ÷ 30 = 1,000 requests per 30 s to that IP and slows every normal site for no reason. Host sharding guarantees one fetcher per host but does nothing about many hosts sharing a machine. Lower priority only delays the burst; it does not cap it.',
      followUps: [
        {
          q: 'The IP belongs to a CDN that fronts 2 million unrelated sites. Do you now crawl all of them at 1 req/s total?',
          a: 'No. CDN edge IPs are shared infrastructure built for huge load, so per-IP limits there would starve millions of sites. Keep a list of known CDN and large-provider IP ranges (by ASN) where politeness falls back to per-host or per-registered-domain limits, and apply per-IP limits to ordinary shared hosting. Adaptive back-off on latency and 429/503 still protects everything.',
        },
      ],
    },
    {
      id: 'design-more-mcq-02',
      difficulty: 'expert',
      question: 'A crawler keeps its seen-URL set in a Bloom filter sized for 10 billion URLs at a 1% false-positive rate. Select ALL statements that are correct.',
      options: [
        'It needs about 9.6 bits per URL (≈ 12 GB in total) and about 7 hash functions',
        'A false positive makes the crawler skip a URL it has never fetched, with no error anywhere',
        'A false negative makes the crawler fetch the same URL twice, so fetches must be idempotent',
        'When a page returns 404 permanently, its URL can be removed from the filter to keep it small',
        'If 20 billion URLs end up inserted, the false-positive rate rises to roughly 16%, not 2%',
      ],
      correct: [0, 1, 4],
      explanation:
        'Optimal sizing is m/n = −ln(0.01)/(ln 2)² ≈ 9.59 bits per key (≈ 12 GB for 10B) with k ≈ 0.69 × 9.59 ≈ 7 hashes. Bloom filters have false positives (silently skipped new URLs) but never false negatives. A standard Bloom filter cannot delete (that would need a counting filter). Over-filling degrades sharply: with k = 7 and twice the design load, p = (1 − e^(−7×2/9.59))⁷ ≈ 0.16.',
      followUps: [
        {
          q: 'Silently losing 1% of new URLs is unacceptable for the search team. Do you drop the Bloom filter?',
          a: 'Keep it as a fast pre-filter and add an exact store behind it. "Definitely new" (filter miss) goes straight to the frontier. "Maybe seen" (filter hit) is checked against a sharded exact KV store of URL hashes. Since most discovered links are already seen, the filter saves lookups only for new URLs, but the exact check removes all losses. Alternatively use a scalable Bloom filter that adds layers as it fills.',
        },
      ],
    },
    {
      id: 'design-more-mcq-03',
      difficulty: 'expert',
      question: 'Two equally important pages: A changes about every 10 minutes, B about every 10 days (Poisson). Your budget is one fetch per day in total for the pair. Which allocation maximizes their average freshness (the probability that the stored copy is current)?',
      options: [
        'Spend almost all fetches on A, because it changes 1,440× more often and is the most out of date',
        'Split fetches in proportion to change rate, so that each page is refreshed according to how fast it changes',
        'Spend the budget on B; A is stale again within minutes of any visit we can afford',
        'Alternate strictly between A and B, since equal importance demands an equal share',
      ],
      correct: [2],
      explanation:
        'Expected freshness at revisit interval I is (1 − e^(−λI))/(λI). For B (λ = 0.1/day) daily visits give ≈ 0.95; for A (λ = 144/day) even one visit every 2 days gives ≈ 0.003. All on B ≈ (0.95 + 0)/2 ≈ 0.48 average; alternating ≈ (0.91 + 0.003)/2 ≈ 0.45; proportional starves B and is the worst. This is Cho & Garcia-Molina\'s result: chasing very fast-changing pages wastes budget.',
      followUps: [
        {
          q: 'Page A is a news homepage whose value is the new article links it exposes. Does the conclusion still hold?',
          a: 'No, because the objective changed. For a hub, the goal is discovering new URLs quickly, not keeping a fresh copy of the page itself. Hubs belong in a separate discovery lane with a fixed short revisit cadence (within politeness), measured by time-to-discover new articles, alongside RSS feeds and sitemaps. The freshness optimizer handles ordinary content pages.',
        },
      ],
    },
    {
      id: 'design-more-mcq-04',
      difficulty: 'hard',
      question: 'A Node fetcher process (code below) plateaus at ~300 pages/s across many different hosts. CPU is 15%, bandwidth is 10% of the link, and event-loop lag is low. Traces show most time is spent before the TCP connect starts. What is the most likely bottleneck?',
      code: {
        language: 'typescript',
        code: `// UV_THREADPOOL_SIZE is not set
const agent = new Agent({ connections: 2000 });           // undici
async function fetchOne(url: string) {
  const res = await fetch(url, { dispatcher: agent, signal: AbortSignal.timeout(10_000) });
  return res.text();
}
// 1,000 fetchOne() calls are kept in flight at all times`,
      },
      options: [
        'The undici agent\'s connection limit is too low for 1,000 concurrent requests',
        'Hostname resolution: fetch uses dns.lookup (getaddrinfo) on the 4-thread libuv pool, so lookups queue',
        'HTML decoding in res.text() is blocking the event loop between requests',
        'TLS handshakes are CPU-bound and need a cluster of processes to parallelize',
      ],
      correct: [1],
      explanation:
        'Time spent before connect with low CPU points to name resolution. `dns.lookup` calls getaddrinfo on the libuv threadpool (4 threads by default), so thousands of uncached lookups per second queue behind each other. The agent allows 2,000 connections, more than the 1,000 in flight. res.text() and TLS would show CPU and event-loop lag, which are both low. Fix it with an in-process DNS cache keyed by host (respecting TTL), pre-resolution in the frontier, or c-ares-based `dns.resolve`.',
      followUps: [
        {
          q: 'You set UV_THREADPOOL_SIZE=64 and throughput doubles, then plateaus again. What next?',
          a: 'Now the upstream resolver is likely the limit: a public resolver may rate-limit you, and every lookup still pays its round trip. Run a local caching resolver (Unbound) per node, cache results in the crawler for the record TTL, and resolve each host once when it enters the frontier rather than per URL. Since the frontier is host-sharded, each host resolves on one node only.',
        },
      ],
    },
    {
      id: 'design-more-mcq-05',
      difficulty: 'expert',
      question: 'This Count-Min Sketch is used to estimate view counts per video. Select ALL statements that are correct.',
      code: {
        language: 'typescript',
        code: `class CMS {
  t = Array.from({ length: 5 }, () => new Uint32Array(2_718_282));
  cols(key: string): number[] { /* 5 independent hashes mod width */ return []; }
  add(key: string) { this.cols(key).forEach((c, i) => { this.t[i][c] += 1; }); }
  estimate(key: string) { return Math.min(...this.cols(key).map((c, i) => this.t[i][c])); }
}`,
      },
      options: [
        'estimate() never returns less than the true count of the key',
        'A video that was never viewed can get a positive estimate',
        'For a fixed key, the expected overcount shrinks as the total stream grows, because the counts average out',
        'Two sketches built with the same hashes and dimensions can be added cell by cell, giving exactly the sketch of the combined stream',
        'Doubling the depth from 5 to 10 rows halves the overcount bound ε·N',
      ],
      correct: [0, 1, 3],
      explanation:
        'Each cell holds the key\'s count plus colliding keys\' counts, so the minimum is never below the truth, and an unseen key collides with others and can read above 0. The bound is ε·N, so the error grows with total volume N; it does not average out. With plain `+= 1` updates the sketch is linear, so cell-wise addition equals sketching the concatenated stream. Width sets ε (error size); depth sets δ (the probability the bound fails), so more rows do not halve ε.',
      followUps: [
        {
          q: 'You switch to conservative update to reduce overcounting. Which of the statements changes?',
          a: 'Conservative update raises only the counters below the new minimum estimate, so the sketch is no longer linear. Merging two such sketches by addition still gives a valid overestimate, but it is no longer identical to sketching the combined stream. Conservative update also cannot support decrements. Use it on a single aggregator node, and use plain sketches where you need exact mergeability across shards.',
        },
      ],
    },
    {
      id: 'design-more-mcq-06',
      difficulty: 'expert',
      question: 'View events are randomly spread over 3 shards. Each shard sends its local top 3 to a merger. Shard 1: A 100, B 90, C 80, D 79. Shard 2: E 100, F 90, G 80, D 79. Shard 3: H 100, I 90, J 80, D 79. What is the true global #1, and what does the merger report?',
      options: [
        'True #1 is A, E or H (tied at 100); the merger reports them correctly',
        'True #1 is D with 237 views; the merger never sees D and reports A, E or H',
        'True #1 is D, but the merger finds it because D appears in all three shards',
        'True #1 cannot be determined without exact counts from every shard',
      ],
      correct: [1],
      explanation:
        'D has 79 × 3 = 237 views, far more than any item with 100, but it is #4 on every shard, so it appears in no local top-3 list. Merging local top-K lists is only correct when each key lives on exactly one shard (partition by key). With split keys, you must fetch counts for a candidate set from all shards (for example, a threshold algorithm like TPUT) or re-partition by key. Option D is too pessimistic: with the full counts listed here, the answer is computable.',
      followUps: [
        {
          q: 'Re-partitioning by video_id makes one viral video\'s shard hot. How do you keep correctness and balance?',
          a: 'Pre-aggregate before the shuffle: each producer sums views per video for about a second and sends `(video_id, count)`. The hot key\'s shard then receives one message per producer per second instead of one per view. The key still lives on one shard, so local top-K stays exact. If one key is still too hot, split it into sub-keys (`video#0..7`) and sum the sub-keys in a second stage before ranking.',
        },
      ],
    },
    {
      id: 'design-more-mcq-07',
      difficulty: 'hard',
      question: 'A "last 60 minutes" top-100 is computed in Redis as below, every minute. Each minute key has ~2M members. Redis latency spikes to seconds every minute. What is the best fix?',
      code: {
        language: 'typescript',
        code: `const keys = Array.from({ length: 60 }, (_, i) => \`views:\${minute - i}\`);
await redis.zunionstore('views:last60', keys.length, ...keys);   // every minute
const top = await redis.zrevrange('views:last60', 0, 99, 'WITHSCORES');`,
      },
      options: [
        'Maintain a running sorted set: ZINCRBY the newest minute\'s counts in and the expired minute\'s counts out, then prune members ≤ 0',
        'Run the ZUNIONSTORE on a read replica so that the primary is not blocked',
        'Use ZUNIONSTORE with AGGREGATE MAX instead of SUM to reduce the work per member',
        'Increase the minute granularity to 10 seconds so each union processes smaller keys',
      ],
      correct: [0],
      explanation:
        'ZUNIONSTORE over 60 keys of ~2M members touches ~120M entries per minute on a single-threaded server, which causes the spikes. An incremental running total only processes two minutes\' worth of changes (one added, one removed) per slide. A replica is still one thread and also lags. AGGREGATE MAX gives the wrong answer (a peak minute, not a 60-minute sum). Finer buckets mean 360 keys to union, which makes it worse. Many teams move this into the stream processor entirely.',
      followUps: [
        {
          q: 'The job that applies the "subtract the expired minute" step crashes and restarts 3 minutes later. What goes wrong?',
          a: 'If it resumes without knowing which minutes it already added or removed, the running set drifts (some minutes are subtracted twice or never). Store a watermark (`last_applied_minute`) in the same Redis transaction (MULTI or a Lua script) as the increments, and on restart apply the missing minutes in order. Each minute key must be retained for at least 60 minutes plus the maximum outage, or the expired counts are gone and you must rebuild from the per-minute keys.',
        },
      ],
    },
    {
      id: 'design-more-mcq-08',
      difficulty: 'medium',
      question: 'Trending uses score = (H + 50) / (B + 100), with a minimum of 500 views in the last hour (H = last-hour views, B = baseline hourly views). Video X: H = 1,000,000, B = 950,000. Video Y: H = 40,000, B = 2,000. Video Z: H = 12, B = 0.1. Which ranks first?',
      options: [
        'X, because it has by far the most views in the last hour',
        'Z, because 12 views against a baseline of 0.1 is a 120× jump',
        'Y, with a score of about 19, against about 1.05 for X',
        'X and Y tie, because both are above the minimum volume',
      ],
      correct: [2],
      explanation:
        'Y scores (40,000 + 50)/(2,000 + 100) ≈ 19.1. X scores (1,000,050)/(950,100) ≈ 1.05: popular but not accelerating. Z fails the 500-view floor, and even without it the smoothing gives (62)/(100.1) ≈ 0.62, which is what the constants are for. Trending measures change relative to an item\'s own history, not raw volume.',
      followUps: [
        {
          q: 'Y\'s 40,000 views came from 900 accounts created yesterday. Which input would you change?',
          a: 'Replace H with an effective count: unique viewers (HyperLogLog per video per hour) weighted by trust (account age, history, device/IP/ASN diversity), with a cap per viewer. 40,000 plays from 900 new accounts might count as a few hundred trusted views and fall below the floor. Add an anomaly check on views per unique viewer, and a short quarantine before an item can enter the top slots.',
        },
      ],
    },
    {
      id: 'design-more-mcq-09',
      difficulty: 'hard',
      question: 'Likes are counted with `INCR likes:{postId}` on each like request and `DECR` on unlike, with Redis as the only store of the count. After a week, counts no longer match `COUNT(*)` in the likes table. Select ALL plausible causes.',
      options: [
        'A mobile client retries a like after a timeout, although the first INCR succeeded',
        'A user double-taps quickly and both requests reach the server before the UI disables the button',
        'INCR is not atomic when two app servers call it for the same key at the same time',
        'Pipelining INCR and DECR from different users reorders them, and reordering changes the final total',
        'A Redis primary failed over to an asynchronously replicated replica that had not received the last increments',
      ],
      correct: [0, 1, 4],
      explanation:
        'Retries and double taps re-run a non-idempotent increment, so the count drifts above the edge table. An async-replica failover loses recent writes, so the count drifts the other way. INCR is atomic in single-threaded Redis, and increments commute, so ordering across users cannot change the total. The fix is an idempotent edge insert that emits a delta only when a row changed, with the count derived from those deltas and reconciled periodically.',
      followUps: [
        {
          q: 'You must keep Redis as the fast path. How do you make the like itself idempotent there?',
          a: 'Use a Lua script that runs `SADD liked:{postId} userId` and only if it returns 1 runs `INCR count:{postId}` (and SREM/DECR for unlike). Both keys use the same `{postId}` hash tag so they live on one cluster slot. This is idempotent per user. But the set grows with likers, so for huge posts keep the set in the durable edge store and use Redis only for the derived count, with periodic reconciliation.',
        },
      ],
    },
    {
      id: 'design-more-mcq-10',
      difficulty: 'medium',
      question: 'A dashboard shows "unique viewers today" for a video using per-region HyperLogLogs. What is wrong with this code?',
      code: {
        language: 'typescript',
        code: `const regions = ['in', 'us', 'eu'];
let total = 0;
for (const r of regions) {
  total += await redis.pfcount(\`uv:{\${videoId}}:\${r}:\${day}\`);
}
return total;`,
      },
      options: [
        'PFCOUNT is O(N) in the number of elements, so calling it three times is too slow for a dashboard',
        'Viewers seen in more than one region are counted more than once; PFCOUNT over all three keys returns the union',
        'HyperLogLog cannot count beyond 2³² distinct viewers, so totals for big videos overflow',
        'HyperLogLog estimates are not additive across days, but they are additive across regions',
      ],
      correct: [1],
      explanation:
        'Adding cardinalities double counts the intersection (travellers, VPN users, roaming phones). `PFCOUNT k1 k2 k3` (or PFMERGE then PFCOUNT) estimates the union. The `{videoId}` hash tag keeps the keys on one cluster slot so the multi-key call works. PFCOUNT on a single key is fast (cached cardinality, ~O(1)); Redis HLL handles cardinalities far beyond 2³²; and HLLs are no more additive across regions than across days.',
      followUps: [
        {
          q: 'The same video\'s weekly uniques are needed. Can you PFMERGE 7 daily keys, and what does it cost?',
          a: 'Yes. PFMERGE of 7 daily HLLs gives the union for the week, at a cost of 7 × 12 KB of register-wise max operations, which is microseconds. Store the result with a TTL, or recompute it on demand. The standard error stays ~0.81% for the merged sketch, because HLL error depends on the register count, not on how many sketches were merged.',
        },
      ],
    },
    {
      id: 'design-more-mcq-11',
      difficulty: 'hard',
      question: 'To survive hot posts, every post\'s like counter is split into 100 shard rows, and each like increments a random shard. Feed pages show 20 posts. Most posts receive under 10 likes per day. What is the best change?',
      options: [
        'Increase to 1,000 shards so that even the largest celebrity posts never contend',
        'Start every counter with one shard and split only counters whose write rate crosses a threshold, caching the summed value for reads',
        'Read the shards with strongly consistent reads so that the summed value is always exact',
        'Replace the counters with HyperLogLog sketches, which need no sharding',
      ],
      correct: [1],
      explanation:
        'A fixed 100 shards makes every feed page read 2,000 rows to show 20 numbers, which is wasteful for the 99% of posts that are cold. Dynamic sharding puts the cost only on hot keys, and a cached sum keeps reads O(1). 1,000 shards makes reads 10× worse. Strong reads add cost without fixing the fan-out. HyperLogLog counts distinct elements; it cannot support unlike, and like counts are not a distinct-count problem once the edge enforces one like per user.',
      followUps: [
        {
          q: 'How does a reader know how many shards a counter currently has, without an extra lookup?',
          a: 'Store the shard count in the counter\'s base row (or encode it in the cached value). Readers fetch the base row, which they need anyway, and fan out only if `shards > 1`. When splitting, write the new shard count first, so writers start using new shards while the old shard keeps its value. Since the sum is over all shards, no data moves. Merging shards back for cooled posts is a background job.',
        },
      ],
    },
    {
      id: 'design-more-mcq-12',
      difficulty: 'hard',
      question: 'The same accepted C++ solution gets Time Limit Exceeded on about 3 of every 10 rejudges (limit 1 s). Judge nodes run 16 judge slots on 8 physical cores with hyper-threading, and time is measured as wall-clock from process start to exit. What is the best fix?',
      options: [
        'Raise the limit to 2 s for all problems so that borderline solutions pass consistently',
        'Run each submission three times and use the average time for the verdict',
        'Measure CPU time from the cgroup, run one pinned slot per physical core, and keep wall-clock only as a generous backstop',
        'Move judging to serverless functions so that every run gets a fresh, dedicated machine',
      ],
      correct: [2],
      explanation:
        'Wall-clock time on oversubscribed hyper-threads includes waiting for the CPU and sharing execution units with a neighbour, so the same code varies run to run. CPU time on dedicated, pinned cores is reproducible, and wall-clock remains only to kill sleeping or blocked processes. A higher limit lets slow complexities pass, which breaks the problem\'s intent. Averaging three noisy runs triples cost and is still noisy. Serverless gives fractional, variable CPU, which makes timing less reproducible.',
      followUps: [
        {
          q: 'Pinning one slot per physical core halves your capacity. How do you justify it before a contest?',
          a: 'Wrong TLE verdicts in a rated contest are the most damaging failure a judge can have, so reproducibility is the requirement. Recover capacity elsewhere: stop at the first failed test (~30–50% saving), cache compiled binaries for identical resubmissions, pre-scale more nodes for the contest window, and run practice traffic on cheaper oversubscribed nodes with a warning that timings there are approximate.',
        },
      ],
    },
    {
      id: 'design-more-mcq-13',
      difficulty: 'expert',
      question: 'Judge workers run each test with the command below. Select ALL real problems.',
      code: {
        language: 'bash',
        code: `docker run --rm \\
  --read-only --user 65534:65534 --cap-drop ALL \\
  --cpus 1 --memory 256m --memory-swap 256m \\
  -v /data/tests/p42:/sandbox/tests:ro \\
  -v "$WORK/bin:/sandbox/bin:ro" \\
  judge-runner:cpp20 \\
  timeout -s KILL 6s /sandbox/bin/solution < /sandbox/tests/07.in`,
      },
      options: [
        'A fork bomb can exhaust the node\'s process table because no pids limit is set',
        'The program can read 07.out and every other expected output for problem 42',
        'The program can open network connections, for example to send test data out or fetch answers',
        'Running as user 65534 prevents the program from writing its answer to stdout',
        '--cpus 1 has no effect, so the program can use every core on the node',
      ],
      correct: [0, 1, 2],
      explanation:
        'Without `--pids-limit` a fork bomb can take down every slot on the node. The whole problem directory, including expected outputs, is mounted read-only, and read-only still means readable. There is no `--network none`, so the default bridge network allows egress. stdout is a pipe inherited from the runner, so a non-root user can write to it. `--cpus 1` does limit CPU via the CFS quota (it just does not pin a core).',
      followUps: [
        {
          q: 'After fixing these, which remaining risk would still worry you for hostile code?',
          a: 'The kernel boundary. Containers share the host kernel, so a kernel privilege-escalation bug escapes all of these flags. For untrusted code, add gVisor (`--runtime=runsc`) or run inside Firecracker microVMs, plus a strict seccomp allow-list, nodes with no credentials or metadata access, and regular node recycling. Keep a regression suite of malicious submissions and run it on every image change.',
        },
      ],
    },
    {
      id: 'design-more-mcq-14',
      difficulty: 'medium',
      question: 'At contest start, 50K submissions arrive within 3 minutes, practice users keep submitting as usual, and some contestants press Submit 30–40 times a minute. Which queueing policy fits best?',
      options: [
        'One FIFO queue for everything, with the worker pool autoscaled on queue depth',
        'Reject submissions with 503 while the queue is above capacity, so that clients retry later',
        'A contest queue ahead of practice, at most one in-flight submission per user, and "Run" requests at lower priority',
        'LIFO processing so that each user\'s latest submission is judged first and older ones are skipped',
      ],
      correct: [2],
      explanation:
        'Priority keeps practice traffic and reruns from delaying rated contest verdicts, and a per-user in-flight cap stops spammers from occupying dozens of slots while others wait. A single FIFO with reactive scaling suffers the boot delay just when it matters. 503s create retry storms and lose fairness. LIFO starves earlier submissions and breaks the meaning of submission order and penalty times.',
      followUps: [
        {
          q: 'A contestant has one submission running and submits a fix. Do you cancel the running one?',
          a: 'No. Each submission is a scored attempt, and cancelling would change the penalty logic (was the earlier one wrong or not?). Queue the new one behind it for that user. To limit waste, the UI can warn about a pending submission, and the per-user cap ensures the queue holds at most one waiting submission per user, with further submits rejected with a clear message.',
        },
      ],
    },
    {
      id: 'design-more-mcq-15',
      difficulty: 'expert',
      question: 'Judge workers pull jobs from SQS with a 30 s visibility timeout. Some Java submissions with 100 tests take ~45 s. You observe duplicate judging, and a few verdicts flip from Accepted to Time Limit Exceeded minutes after users saw them. What is the cause and the fix?',
      options: [
        'SQS FIFO is needed; standard queues deliver messages twice at random, which explains the flip',
        'The message reappears after 30 s and a second worker judges it; extend visibility with heartbeats and make the verdict write conditional so only the first final verdict sticks',
        'Java timing is non-deterministic; disable the JIT so that verdicts stop flipping',
        'Increase the visibility timeout to 12 hours so that no message can ever be redelivered',
      ],
      correct: [1],
      explanation:
        'When processing exceeds the visibility timeout, SQS makes the message visible again, so a second worker runs the same submission. The later worker (on a noisier node) overwrites the verdict. Heartbeat calls to ChangeMessageVisibility keep the lease while work progresses, and `UPDATE ... WHERE id = $1 AND status <> \'DONE\'` makes the first final verdict win. FIFO queues still redeliver after a visibility timeout. A 12-hour timeout means a crashed worker\'s job waits 12 hours. Disabling the JIT does not explain duplicates.',
      followUps: [
        {
          q: 'A worker crashes after 40 s with the lease extended to 60 s. How long until the submission is judged again, and can you do better?',
          a: 'It reappears when the current lease expires, up to ~20 s after the crash, then waits in the queue. To recover faster, keep leases short (e.g. 15 s) with frequent heartbeats, so a dead worker is detected within one lease period. A supervisor on the node can also report a dead slot so its job is released immediately via ChangeMessageVisibility to 0.',
        },
      ],
    },
    {
      id: 'design-more-mcq-16',
      difficulty: 'expert',
      question: 'Hot auctions use a single writer: a consumer owns the auction\'s Kafka partition, applies bids in memory, writes the new state to the DB, and commits offsets every 5 seconds. After a consumer-group rebalance, one auction\'s price jumps two increments for a single bid. Why?',
      options: [
        'Kafka reordered messages within the partition during the rebalance',
        'The new owner re-consumed bids after the last committed offset and re-applied ones already reflected in the DB state',
        'The producer used acks=1, so the bid message was duplicated by the broker on leader change',
        'The session timeout was too short; raising it prevents rebalances and therefore the problem',
      ],
      correct: [1],
      explanation:
        'Offsets were committed every 5 s while state was written per bid, so after a rebalance the new owner replays up to 5 s of bids already applied in the DB. A proxy bid re-applied as a fresh challenge raises the price again. Fix it by storing the last applied offset (or the last bid_id per auction) in the same DB transaction as the state, and skipping anything at or below it on replay. Kafka preserves order within a partition. acks=1 risks loss, not duplication (producer retries without idempotence can duplicate, but that is not what a rebalance causes). Longer timeouts make rebalances rarer but do not make replay safe.',
      followUps: [
        {
          q: 'During the rebalance, could the old and new owner both apply bids for a short time?',
          a: 'Yes, if the old consumer is paused (a long GC pause) and wakes up after its partitions were reassigned, it may still write state. Guard the DB write with a fencing token: the owner\'s generation or epoch is stored on the auction row, and writes are `UPDATE ... WHERE id = $1 AND writer_epoch <= $2`, so a stale owner\'s write fails. Kafka transactions with a transactional.id give similar zombie fencing when the state also lives in Kafka.',
        },
      ],
    },
    {
      id: 'design-more-mcq-17',
      difficulty: 'medium',
      question: 'An auction is scheduled to end at 10:00:00. Soft-close rule: an accepted bid with under 120 s remaining sets ends_at = bid_time + 120 s. Bids are accepted at 09:59:30, 10:01:00 and 10:02:59. Another bid arrives at 10:05:10. When does the auction end?',
      options: [
        '10:06:00, because three extensions of 2 minutes each are added to 10:00:00',
        '10:07:10, because the 10:05:10 bid extends it once more',
        '10:04:59, and the 10:05:10 bid is rejected as late',
        '10:00:00, because only bids before the original end time can extend it',
      ],
      correct: [2],
      explanation:
        'Each accepted late bid resets the end to its own time + 120 s: 09:59:30 → 10:01:30, 10:01:00 → 10:03:00, 10:02:59 → 10:04:59. The 10:05:10 bid arrives after ends_at, so the conditional write rejects it. Adding 2 minutes to ends_at per bid (option A) is the cumulative bug. Option D would make the rule useless after the first extension.',
      followUps: [
        {
          q: 'The closer was scheduled for 10:00:00 when the auction was created. What must it do at 10:00:00?',
          a: 'Run the close as a conditional update, `SET status = \'CLOSED\' WHERE id = $1 AND status = \'OPEN\' AND now() >= ends_at`. At 10:00:00 that matches zero rows because ends_at has moved, so the closer re-reads ends_at and re-schedules itself for 10:04:59 (or the bid path enqueues a new timer on each extension). Since both paths check the same ends_at under the row lock, a bid and the close can never both succeed.',
        },
      ],
    },
    {
      id: 'design-more-mcq-18',
      difficulty: 'hard',
      question: 'Using this proxy-bidding function with increment 5 and start price 50: A bids max 100, then B bids max 80, then C bids max 130. What is the state after C\'s bid?',
      code: {
        language: 'typescript',
        code: `if (maxBid > s.leaderMax) {                 // challenger takes the lead
  return { leaderId: bidder, leaderMax: maxBid, price: Math.min(maxBid, s.leaderMax + inc) };
}
return { ...s, price: Math.min(s.leaderMax, maxBid + inc) };   // leader defends`,
      },
      options: [
        'C leads at 130, because the highest maximum is the price paid',
        'C leads at 105: one increment above A\'s maximum of 100',
        'A still leads at 100, because A bid first and defends up to its maximum',
        'C leads at 85: one increment above the visible price that B pushed A to',
      ],
      correct: [1],
      explanation:
        'After A (max 100) the price is 50. B\'s max 80 is defended by A\'s proxy, so the price becomes min(100, 80 + 5) = 85 with A leading. C\'s max 130 exceeds A\'s max, so C leads at min(130, 100 + 5) = 105. Proxy bidding charges about the second-highest maximum plus one increment (a second-price auction), not the winner\'s maximum. Option D ignores A\'s hidden maximum.',
      followUps: [
        {
          q: 'Now B bids max 130, the same as C\'s maximum. Who leads and at what price?',
          a: 'B\'s max (130) is not greater than the leader\'s max (130), so the leader\'s proxy defends: the price becomes min(130, 130 + 5) = 130, and C keeps the lead because ties go to the earlier bid. C pays its full maximum because a competitor matched it. Showing B "you were outbid at 130" is accurate, and the visible price reveals C\'s maximum only because it was reached.',
        },
      ],
    },
    {
      id: 'design-more-mcq-19',
      difficulty: 'hard',
      question: 'A hot auction has 200K watchers on WebSockets and receives up to 800 accepted bids per second near the end. Select ALL design choices that are sound.',
      options: [
        'Publish to a per-auction pub/sub channel and have each gateway subscribe only to auctions its clients watch',
        'Coalesce updates to about 4 per second per auction, sending the latest state and dropping intermediate prices',
        'Include a monotonically increasing seq in each update so clients ignore older messages that arrive late',
        'Push each update to all 200K sockets from inside the bid transaction before it commits, so watchers never miss a bid',
        'Let each client compute the countdown purely from its own clock and the original end time',
      ],
      correct: [0, 1, 2],
      explanation:
        'Per-auction channels keep fan-out proportional to watchers, coalescing caps the message rate (800/s × 200K would be 160M messages/s), and seq numbers handle reordering and reconnects. Pushing from inside the transaction couples bid latency to 200K sockets and can announce bids that roll back; use an outbox after commit. Client clocks skew, and soft-close extensions change ends_at, so the countdown must come from server-provided endsAt and a server-time offset.',
      followUps: [
        {
          q: 'A watcher reconnects after 20 seconds on a flaky mobile network. What do they see, and how?',
          a: 'On reconnect the client sends its last seen seq. The gateway (or a REST call) returns the current snapshot (price, leader, endsAt, seq) rather than replaying 20 seconds of coalesced updates, since only the latest state matters for an auction. Then the client resubscribes. If the user has an active bid, the snapshot also says whether they were outbid, and an outbid push notification was already sent through the notification path.',
        },
      ],
    },
    {
      id: 'design-more-mcq-20',
      difficulty: 'hard',
      question:
        'A team copies the event-log counter idea, but their rollup job uses the code below. The store accepts events stamped up to 5 s in the past. Over a week, counters end up slightly LOWER than a full recount of the event log. What is the cause?',
      code: {
        language: 'typescript',
        code: `async function rollup(counter: string): Promise<void> {
  const cp = await checkpoints.get(counter);          // { count, lastRollupTs }
  const windowEnd = Date.now();                         // roll up "everything so far"
  const events = await eventLog.scan(counter, cp.lastRollupTs, windowEnd);
  const sum = events.reduce((n, e) => n + e.delta, 0);
  await checkpoints.put(counter, { count: cp.count + sum, lastRollupTs: windowEnd });
}`,
      },
      options: [
        'Events that arrive after a rollup but are stamped before its windowEnd fall behind the checkpoint and are never summed',
        'Two rollup workers overwrite each other\'s checkpoint, and the last writer drops the other worker\'s increments',
        'Date.now() on the rollup host drifts ahead of the writers\' clocks, so events from the near future get counted twice',
        'Retried AddCount calls are deduplicated by the event log, so the recount includes retries that the rollup skipped',
      ],
      correct: [0],
      explanation:
        'The window [lastRollupTs, now) is still mutable: the store accepts events stamped up to 5 s in the past, so some land below the new checkpoint after it is written. The next scan starts at lastRollupTs and never sees them, which gives a permanent undercount. Ending the window at now − acceptLimit − skew makes it immutable. Racing workers cannot lose increments here, because each recomputes from the same checkpoint over the same range. Clock drift would cause missed events, not double counts. Idempotent dedup affects the recount and the rollup the same way.',
      followUps: [
        {
          q: 'You fix it with windowEnd = now − 5 s − 2 s. What do users observe, and how would the accurate variant change that?',
          a: 'GetCount now lags real activity by at least 7 s plus the time until the next rollup, so a counter can briefly read lower than the writes a user just made. The accurate variant returns checkpoint + a live scan of events since lastRollupTs. It is fresh, but every read pays for the scan, which is cheap for frequently rolled-up counters (narrow gap) and expensive for quiet counters whose gap spans many time buckets.',
        },
      ],
    },
    {
      id: 'design-more-mcq-21',
      difficulty: 'expert',
      question:
        'About Netflix\'s eventually consistent counter (event log in TimeSeries on Cassandra, background rollups, EVCache), which statements are accurate? Select ALL that apply.',
      options: [
        'The rollup trigger carries only the namespace and counter name, so the rollup server learns which counters changed without scanning the dataset',
        'The cached value combines count and lastRollupTs in one entry, so a reader can never pair a count with another checkpoint\'s timestamp',
        'Concurrent rollups of one counter are serialised with a distributed lock, which is what keeps the value from fluctuating',
        'Increments are stored in a single partition per counter so that a rollup can read them with one sequential scan',
        'A GetCount also triggers a rollup, which self-heals a counter whose earlier rollup signal was lost',
      ],
      correct: [0, 1, 4],
      explanation:
        'The light-weight rollup event only marks a counter dirty. Storing {count, lastRollupTs} together prevents mismatched pairs. Reads enqueue a rollup, which repairs stale counters. Netflix deliberately avoids distributed locks: overlapping rollups are safe because they aggregate an immutable window, and values may fluctuate briefly before converging. Events are spread across time buckets and event buckets precisely to avoid one wide partition per counter.',
      followUps: [
        {
          q: 'Netflix runs fewer, larger rollup instances rather than many small ones. Why does instance count matter if correctness does not need a lock?',
          a: 'Correctness holds either way, but efficiency does not. With many instances, the same counter\'s signals can land on different servers, and each repeats the same range scans against TimeSeries, wasting read capacity. Hashing counters to queues on a few large instances concentrates each counter\'s signals so the Set dedup collapses them into one rollup per window. The trade-off is availability: fewer instances means a crash drops a larger share of in-memory signals.',
        },
      ],
    },
    {
      id: 'design-more-mcq-22',
      difficulty: 'expert',
      question:
        'Lossy counting runs with ε = 0.01 over N = 10,000 items, and you query for support s = 0.05. One item\'s true frequency is 520. Which outcome is guaranteed?',
      code: {
        language: 'typescript',
        code: `const w = Math.ceil(1 / eps);                    // 100
// new item:  table.set(x, { f: 1, delta: bucket - 1 })
// boundary:  delete entries with f + delta <= bucket
// query:     report entries with f >= (s - eps) * N  // (0.05 - 0.01) * 10_000 = 400`,
      },
      options: [
        'It is reported with an f anywhere from 420 to 520',
        'It is reported with an f anywhere from 520 to 620',
        'It may be pruned, since lossy counting only promises to keep items above s·N = 500 most of the time',
        'It is reported with f exactly 520, because entries are never pruned once they pass s·N',
      ],
      correct: [0],
      explanation:
        'Lossy counting guarantees f ≤ true ≤ f + εN, so f lies in [520 − 100, 520] = [420, 520]. Every possible f is at least the 400 threshold, so the item is always reported. The error is one-sided downward, so an overestimate to 620 describes Count-Min, not lossy counting. The guarantee is deterministic ("no false negatives"), not "most of the time". f can be below 520 because the entry may have been created late with Δ covering counts it missed, or pruned and re-created.',
      followUps: [
        {
          q: 'Another item has a true frequency of 430. Can it be reported, and what does that tell you about tuning ε?',
          a: 'It may or may not be. Its f lies in [330, 430], so it is reported only if f ≥ 400. Items between (s − ε)N = 400 and sN = 500 are the grey zone where false positives are allowed, and items below 400 are never reported. Shrinking ε narrows the zone and tightens counts, but the table grows like (1/ε)·log(εN). Halving ε roughly doubles the worst-case memory. A common rule is ε ≈ s/10.',
        },
      ],
    },
    {
      id: 'design-more-mcq-23',
      difficulty: 'hard',
      question:
        'You replace a Bloom filter of revoked session ids with a cuckoo filter (4-slot buckets, 12-bit fingerprints), so ids can be removed when a session expires. Select ALL statements that are true.',
      options: [
        'Calling delete for an id that was never inserted can remove a different id\'s matching fingerprint and create a false negative',
        'Inserting the same id nine times can fail even in a mostly empty filter, because its two buckets hold at most eight copies',
        'Moving a fingerprint during a kick requires re-reading the original id, so the ids must be stored next to the filter',
        'Near ~95% load, inserts start failing, but lookups of ids already stored still never return false negatives',
        'Two regional filters can be merged into a global one by OR-ing their slot arrays, as with Bloom filters',
      ],
      correct: [0, 1, 3],
      explanation:
        'Deletes remove any matching fingerprint from either candidate bucket, so deleting a non-member can evict someone else\'s entry. Duplicates are stored as separate copies, and 2 buckets × 4 slots cap one key at 8 copies. Inserts fail as kick chains exhaust near full load, but stored fingerprints stay findable (a correct implementation parks the last homeless one). Partial-key cuckoo hashing computes the alternate bucket from the fingerprint alone (i XOR hash(fp)), so the original id is not needed. OR-ing slot arrays would mix fingerprints into meaningless values. Cuckoo filters do not support union the way Bloom filters do.',
      followUps: [
        {
          q: 'Sessions expire at a steady 200K per hour and new revocations arrive at the same rate. How do you keep the filter healthy over months?',
          a: 'Drive deletes from the authoritative revocation table (or its CDC stream), so only real members are deleted, and size for the steady-state live count plus headroom, keeping load at or below about 90%. Because deletes free slots, a steady churn does not degrade a cuckoo filter, unlike a Bloom filter, which would need periodic rebuilds. Still rebuild from the source of truth on deploy or when monitoring shows confirm-store false-positive hits rising, which signals drift such as missed deletes.',
        },
      ],
    },
  ],
};

export default topic;
