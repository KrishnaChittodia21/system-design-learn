import type { Company, CompanyQuestion } from '../types';

// Company track: reported/realistic system design prompts with each company's twist.
// Sources: Glassdoor, LeetCode Discuss, Blind, company engineering blogs and interview-prep
// write-ups (2023–2026). Prompts are paraphrased and given a distinct angle per company.

export const COMPANIES: Company[] = [
  {
    id: "google",
    name: "Google",
    focus: "Planet-scale infrastructure, search, collaboration, data-intensive systems",
    interviewStyle:
      "Usually 1–2 system design rounds (45 min) for L5+, alongside coding and Googleyness/leadership. Interviewers give a deliberately vague prompt and expect you to drive: requirements, capacity math, APIs, data model, then deep dives they pick (often consistency, sharding, or a failure scenario). They probe first-principles reasoning over buzzwords — expect \"why not X?\" and \"what if traffic is 100x?\". Precise back-of-the-envelope numbers and clean trade-off articulation are scored heavily; hiring committee reads your interviewer's notes, so structured thinking out loud matters.",
  },
  {
    id: "amazon",
    name: "Amazon",
    focus: "E-commerce at scale, high availability, service-oriented architecture, operational excellence",
    interviewStyle:
      "Loop of 4–5 rounds; SDE-2/3 get at least one system design round, and Leadership Principles are scored in every round (including design) with a Bar Raiser in the loop who has veto power. Expect customer-facing prompts (product pages, orders, notifications) and heavy probing on availability, failure handling, and operational ownership (\"how do you know it is broken? how do you roll back?\"). Tie decisions to customer impact and cost; mention metrics, alarms and runbooks. Being able to go deep on one component (Dive Deep) matters more than covering every box.",
  },
  {
    id: "meta",
    name: "Meta",
    focus: "Social products, real-time interaction, massive fan-out, ads infrastructure",
    interviewStyle:
      "E5/E6 loops have a \"Product Architecture\" round (API-and-client-facing design, e.g. live comments, news feed) or a \"System Design\" round (backend/distributed, e.g. ad aggregation), sometimes both at E6. 45 minutes, fast pace; interviewers want a working end-to-end design in ~20 minutes and then deep dives on scale (fan-out, hot keys, real-time delivery) and data consistency. Expect explicit QPS and storage math, and trade-offs like push vs pull. Signals: speed, pragmatism, and handling celebrity/viral skew.",
  },
  {
    id: "microsoft",
    name: "Microsoft",
    focus: "Enterprise collaboration (Teams/Office), Azure cloud services, reliability",
    interviewStyle:
      "Typically 4–5 rounds with one or two design rounds for Senior/Principal; the \"as appropriate\" (AA) interviewer often goes deep on design and past projects. Prompts lean toward enterprise/cloud scenarios (presence, schedulers, storage services, multi-tenant APIs). Interviewers probe reliability, multi-region failover, security/compliance for enterprise tenants, and how you would operate the service on Azure. Clear API contracts and data models are valued; they often ask you to extend the design mid-interview.",
  },
  {
    id: "apple",
    name: "Apple",
    focus: "Device ecosystems, privacy-first services (iCloud, APNs), massive client fleets",
    interviewStyle:
      "Team-specific loops (6–8 interviews, often a full day), so design questions reflect the team: iCloud, push, Maps, Siri infra. Expect deep questioning on privacy (end-to-end encryption, minimising server-side data), client/server sync with billions of devices, battery- and network-aware protocols, and reliability. Interviewers often dig into your resume projects with design-level follow-ups. Precision and ownership of details matter more than breadth.",
  },
  {
    id: "netflix",
    name: "Netflix",
    focus: "Streaming at global scale, resilience engineering, data-driven personalisation",
    interviewStyle:
      "Senior-only hiring bar; loops are conversational and culture-heavy (Freedom & Responsibility, context not control). Design rounds are often grounded in real Netflix problems — playback, viewing history, encoding pipelines, CDN (Open Connect) — and probe resilience (chaos engineering, fallbacks, graceful degradation), multi-region active-active on AWS, and observability. They value pragmatic judgement and clear trade-offs over textbook completeness; expect \"what would you do if region X fails at peak?\".",
  },
  {
    id: "uber",
    name: "Uber",
    focus: "Real-time geospatial marketplaces, dispatch, pricing, payments",
    interviewStyle:
      "Senior loops include a system design round and often an architecture/deep-dive of past work. Prompts are marketplace-flavoured: dispatch, surge, ETA, trip state, payments. Interviewers probe geospatial indexing (H3 hexagons), real-time streaming (Kafka, Flink), consistency of trip state, and behaviour under regional outages. Quantitative reasoning (updates per second from drivers, cells per city) and handling of edge cases (driver goes offline mid-trip) are key signals.",
  },
  {
    id: "airbnb",
    name: "Airbnb",
    focus: "Two-sided marketplace, search and availability, payments, trust & safety",
    interviewStyle:
      "Senior loops include system design plus a strong \"core values\" interview. Design prompts often mirror Airbnb problems: search with date availability, booking and double-booking prevention, payments and payouts, reviews. Interviewers like clean API and data model discussions, correctness around money and inventory, and product thinking (host vs guest experience). Expect questions on idempotency, consistency across services, and how you would roll out safely.",
  },
  {
    id: "stripe",
    name: "Stripe",
    focus: "Payments APIs, correctness, developer experience, reliability",
    interviewStyle:
      "Distinctive practical loop: coding rounds are realistic (bug squash, integration against an API), and the system design round centres on payments-style problems — idempotent APIs, webhook delivery, ledgers, rate limiting, reconciliation. Interviewers push hard on failure modes (timeouts, retries, partial failure, exactly-once effects) and API ergonomics for developers. They value operational simplicity and correctness over exotic scale; say how you would test, observe and migrate the system.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    focus: "Professional graph, feed, messaging, large-scale data infrastructure (Kafka origin)",
    interviewStyle:
      "Onsite includes 1–2 design rounds (\"Host Manager\" style — one is often a product/system design, another a technical communication or deep-dive of past work). Prompts are graph- and feed-heavy: connection degrees, PYMK, who-viewed-profile, notifications. Interviewers probe graph partitioning, caching, offline vs online computation (Spark/Samza), privacy settings, and Kafka-based pipelines. Clear articulation of read/write paths and data freshness is expected.",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    focus: "Multi-tenant SaaS collaboration (Jira, Confluence, Bitbucket), extensibility",
    interviewStyle:
      "P4/P5 loops have a system design round, a code design (LLD) round, and values/management rounds. Design prompts are frequently Atlassian-flavoured and product-agnostic: tagging across products, rules/automation engines, notification systems, rate limiters for Marketplace apps. Interviewers focus on API design, pagination, data modelling, multi-tenancy and noisy neighbours, and they reward asking clarifying questions early. Expect to justify DB choices and discuss top-K/popularity features.",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    focus: "Metadata-driven multi-tenant platform, CRM, integrations, governor limits",
    interviewStyle:
      "LMTS/PMTS loops typically include one or two design rounds plus a hiring-manager round. Prompts centre on multi-tenant architecture: custom objects without schema changes, bulk APIs, workflow engines, integration with rate limits. Interviewers probe tenant isolation, governor limits (per-tenant resource caps), trust/security, and how the platform stays upgradable for thousands of orgs. Showing awareness of Salesforce's metadata-driven model (universal data dictionary) is a plus.",
  },
  {
    id: "adobe",
    name: "Adobe",
    focus: "Creative Cloud and Document Cloud services, experience/analytics platform",
    interviewStyle:
      "4–5 rounds for MTS-2/Senior with at least one design round; teams in Noida/Bangalore often ask designs tied to Document Cloud (Acrobat, Sign) or Experience Cloud (analytics, real-time profiles). Interviewers probe document workflows and auditability, large-file handling, event ingestion at scale, and privacy/consent (GDPR). LLD and OOP questions are common alongside HLD; expect follow-ups on APIs and database schema.",
  },
  {
    id: "walmart",
    name: "Walmart Global Tech",
    focus: "Omnichannel retail: stores + e-commerce, inventory, pricing, supply chain",
    interviewStyle:
      "Bangalore/Chennai hubs run 3–4 rounds for SDE-3/Staff with a dedicated system design round and a hiring-manager round. Prompts are retail-at-scale: store inventory for pickup, price propagation, order routing, catalogue. Interviewers probe event-driven architecture (Kafka), eventual consistency across thousands of stores, handling Black Friday peaks, and cost. Expect questions on how store systems work when their WAN link is down.",
  },
  {
    id: "flipkart",
    name: "Flipkart",
    focus: "Indian e-commerce at festive scale, supply chain, logistics (Ekart)",
    interviewStyle:
      "SDE-2/3 loops: machine coding (90–120 min, working OOP code), DSA, a high-level design round, and a hiring manager round. HLD prompts often reflect Flipkart problems — Big Billion Days traffic, inventory contention, serviceability and delivery promise, catalogue. Interviewers push on concurrency, capacity math for 10x sale-day spikes, and degraded-mode behaviour. Clean component boundaries and a defensible data model are expected; they frequently ask about your resume projects in depth.",
  },
  {
    id: "swiggy",
    name: "Swiggy",
    focus: "Hyperlocal food and grocery delivery, dispatch, real-time tracking",
    interviewStyle:
      "SDE-2/3 loops include machine coding, a problem-solving round, HLD, and a hiring manager round. HLD prompts are logistics-flavoured: delivery partner assignment, order batching, live tracking, Instamart inventory, ETAs. Interviewers probe geospatial indexing, real-time state machines, handling partner declines/timeouts, and dinner-peak load. Expect to discuss trade-offs between optimal and fast assignment.",
  },
  {
    id: "zomato",
    name: "Zomato",
    focus: "Restaurant discovery, food delivery, reviews, Blinkit quick commerce",
    interviewStyle:
      "Loops for SDE-2/3 include DSA, LLD/machine coding and a system design round, often followed by a culture/founder-style round. Prompts touch discovery and trust (ratings, reviews, search), live order tracking, and New Year's Eve scale (Zomato publicly discusses its NYE peaks). Interviewers probe caching, real-time updates, fraud/abuse, and pragmatic scaling on a startup budget.",
  },
  {
    id: "razorpay",
    name: "Razorpay",
    focus: "Payment gateway, UPI, settlements, payouts, banking integrations",
    interviewStyle:
      "Separate LLD and HLD rounds (both are filters at SDE-2+), plus DSA and a hiring manager round. HLD prompts are payments-first: payment gateway flows, UPI transaction state machines, webhooks, schedulers, settlements. Interviewers probe idempotency, retries with bank/NPCI timeouts, reconciliation, two-phase or saga consistency, and PCI/RBI compliance. Reported prompts also include generic infra (job scheduler, pub/sub with ordering).",
  },
  {
    id: "phonepe",
    name: "PhonePe",
    focus: "UPI payments at India scale, switch reliability, merchant payments",
    interviewStyle:
      "SDE-2/3 loops typically have machine coding, DSA, design, and hiring-manager rounds. Design prompts centre on high-TPS payment systems: UPI switch/PSP, transaction history, rewards, merchant QR payments, notifications. Interviewers probe availability during festive peaks (Diwali, IPL), degradation strategies when banks are slow, idempotency, and data at 500M-user scale. Expect capacity questions in TPS and an emphasis on in-house infra (they run their own data centres).",
  },
  {
    id: "paytm",
    name: "Paytm",
    focus: "Wallet, payments bank, bill payments, lending, notifications",
    interviewStyle:
      "Rounds typically include DSA, LLD, HLD, and a managerial round; design prompts focus on wallets, payments, recharges/bill payments, and high-volume notifications. Interviewers probe ledger correctness, RBI KYC limits, concurrency on balances, and reliability under traffic surges (cashback campaigns). Expect questions on Kafka-based async processing and database choices.",
  },
  {
    id: "cred",
    name: "CRED",
    focus: "Credit card bill payments, rewards and gamification, premium consumer UX",
    interviewStyle:
      "Small, high-bar loops: problem solving, machine coding/LLD, a system design round, and a culture round. Prompts reflect the product: bill payments with statement fetch, reminders, rewards and limited drops, member-only commerce. Interviewers probe correctness of money flows, fraud-resistant reward redemption, idempotency, and engineering taste (clean abstractions, observability). Expect follow-ups on how design choices affect user experience.",
  },
  {
    id: "meesho",
    name: "Meesho",
    focus: "Value e-commerce for Bharat: supplier catalogues, low-bandwidth users, feed",
    interviewStyle:
      "Machine coding round (60–120 min) plus an HLD round for experienced candidates, then hiring manager. Reported HLD themes: product catalogue and search, order management, payment flows, feed personalisation, sale-event spikes. Interviewers probe cost efficiency (Meesho is famously cost-conscious), catalogue quality at millions of SKUs, caching and sharding, and serving users on low-end devices and 3G/4G networks.",
  },
  {
    id: "zepto",
    name: "Zepto",
    focus: "10-minute quick commerce, dark stores, inventory accuracy, rider logistics",
    interviewStyle:
      "LLD round (~60 min) at every level plus an HLD round for senior candidates, then a founder/leadership-style round. Reported prompts: inventory and order assignment for dark stores, customer order systems, ride-hailing-like dispatch. Interviewers focus on inventory correctness under concurrent orders (reservations, locks, transactions), sub-second decisions, and store-level operations (pickers, packers, riders).",
  },
  {
    id: "goldman-sachs",
    name: "Goldman Sachs",
    focus: "Trading, market data, risk, banking platforms (Marcus, Transaction Banking)",
    interviewStyle:
      "Experienced hires get one dedicated system design interview (45–60 min), usually at the Superday, plus coding and behavioural rounds. Questions tie to the firm's systems: trading platforms, market data, risk aggregation, banking/ledger. Interviewers balance latency, financial correctness, auditability and resilience, and push on failure cases (exchange feed drops, late trades, restatements). Expect questions on regulatory audit trails and deterministic recomputation.",
  },
];

export const COMPANY_QUESTIONS: CompanyQuestion[] = [
  // ---------------------------------------------------------------- Google
  {
    id: "co-google-1",
    company: "google",
    title: "Design a web crawler that keeps 5B pages fresh",
    frequency: "high",
    level: "L5 / L6 (Senior / Staff)",
    prompt:
      "Design a crawler that discovers and re-crawls about 5 billion web pages, keeping important pages fresh within minutes to hours while being polite to every website.",
    clarifyingQuestions: [
      "Is the goal a search index (HTML + text) or an archive (all content types, including images and PDFs)?",
      "What freshness targets do we need, e.g. news homepages within 5 minutes and long-tail pages within 30 days?",
      "Must we honour robots.txt and per-site crawl-delay? Do we have an allowlist of high-value sites?",
      "Do we render JavaScript for single-page apps, or fetch raw HTML only?",
      "How do we handle duplicates: exact URLs only, or near-duplicate content too?",
      "What is the budget in machines or bandwidth? Is it a single region or multiple?",
    ],
    functional: [
      "Seed from known URLs and discover new URLs from links and sitemaps",
      "Fetch pages, respecting robots.txt, crawl-delay and per-host concurrency",
      "Re-crawl pages at a rate proportional to their importance and change frequency",
      "Detect and drop duplicate URLs and near-duplicate content",
      "Store raw pages and extracted links for the indexing pipeline",
    ],
    nonFunctional: [
      "Throughput of roughly 10K–50K fetches/s sustained",
      "Politeness: never overload a host; exponential backoff on 429/5xx",
      "Fault tolerance: crawler nodes die without losing frontier state",
      "Extensible to new content types and parsers",
      "Robust against spider traps, infinite calendars and malicious sites",
    ],
    estimation: [
      { label: "Re-crawl volume", calc: "5B pages, average revisit ~10 days → 5B ÷ 10 ÷ 86,400 ≈ 5.8K fetches/s; plus ~2B new-page discovery per month ≈ 770/s → ~7K/s, peak ×3 ≈ 20K/s" },
      { label: "Bandwidth", calc: "20K/s × 100 KB compressed HTML ≈ 2 GB/s ≈ 16 Gbps" },
      { label: "Storage for one snapshot", calc: "5B × 100 KB = 500 TB compressed; keep 3 versions ≈ 1.5 PB in object storage" },
      { label: "URL-seen set", calc: "~20B URLs known × 8-byte fingerprint ≈ 160 GB → sharded in-memory KV, or a Bloom filter (~1% FP) ≈ 24 GB" },
      { label: "Fetcher fleet", calc: "~300 concurrent connections per node × ~1 s per fetch = 300 fetches/s/node → ~70 nodes at peak (plus headroom → 100)" },
    ],
    highLevelDesign: `**Pipeline:** seed/scheduler → **URL frontier** → fetchers → content processing → link extraction → back to the frontier. Every stage is decoupled by durable queues, so any stage can scale or fail independently.

**URL frontier (the heart of the design)** has two layers, as in the Mercator design:
- **Front queues (priority):** a prioritiser assigns each URL a score from PageRank-like importance, predicted change rate (learned from past crawls: how often the content hash changed) and staleness. Higher-priority queues are drained more often.
- **Back queues (politeness):** one queue per host, and each fetcher thread is bound to a set of hosts. A heap keyed by "next allowed fetch time per host" enforces crawl-delay, which is typically 1 request/s per host (more for sites that allow it).

The frontier is **sharded by hostname** (consistent hashing) across frontier nodes, so all URLs of a host go to one shard and politeness state stays local. State lives in RocksDB on each node, backed up to object storage.

**Fetchers:** async I/O with thousands of sockets per node. There's a **DNS resolver cache** (DNS is a classic bottleneck), a robots.txt cache with a TTL of about 24 h, and conditional GETs (If-Modified-Since/ETag) to save bandwidth on unchanged pages. A headless-browser rendering pool handles JavaScript-heavy pages and is used sparingly (10–50× more expensive).

**Content processing:** checksum or SimHash for **near-duplicate detection**, language detection, and extraction of links, canonical URL and metadata. Raw pages go to object storage (as WARC files). Extracted documents are published to Kafka for the indexer.

**Link handling:** normalise URLs (lowercase host, strip fragments and tracking parameters, resolve relative links), check the **URL-seen store**, and add new URLs to the frontier with an initial priority. Trap defences cap the depth per host and the URL length, and detect repeating path patterns.

**Scheduling re-crawls:** each page gets a next-crawl time based on its observed change rate (Poisson estimate) weighted by importance. News homepages come back every few minutes, and the long tail every few weeks.`,
    diagram: `Seeds/sitemaps ─► Prioritizer ─► URL Frontier (sharded by host)
                                 │ front queues (priority)
                                 │ back queues (per-host, politeness heap)
                                 ▼
          DNS cache ◄──── Fetchers (async I/O) ────► robots.txt cache
                                 │
                                 ▼
              Content processor (dedup SimHash, parse, extract)
                 │                       │
                 ▼                       ▼
       Object store (WARC)       Link extractor ─► URL-seen store
                 │                                    │ new URLs
                 ▼                                    ▼
        Kafka ─► Indexer                     back to Prioritizer`,
    deepDives: [
      {
        topic: "Politeness and host sharding",
        discussion: `Politeness is enforced where the state is: **one frontier shard per host**, chosen by consistent hashing of the registered domain (so a.example.com and b.example.com share limits if they share servers). Each shard keeps a min-heap of hosts keyed by \`nextFetchAt\`. A fetcher asks for work, pops the host whose time has come, takes one URL from that host's back queue, and pushes the host back with \`now + max(crawlDelay, k × lastResponseTime)\`, an adaptive delay that slows down for slow servers. On 429 or 503 we back off exponentially and honour Retry-After. Shared hosting is a subtle problem: thousands of domains on one IP. So we also rate-limit **per IP** after DNS resolution. When a frontier node fails, its hosts move to another node via the hash ring, and the per-host queues are rebuilt from the RocksDB snapshot plus Kafka replay.`,
      },
      {
        topic: "Freshness: deciding what to re-crawl",
        discussion: `We can't re-crawl 5B pages daily, so crawl capacity is allocated where staleness costs the most. For each page, estimate a change rate λ from history (changes observed / time between crawls). The probability the page has changed after t is 1 − e^(−λt). Priority ≈ importance × P(changed) × query demand. Pages that never change drift to monthly re-crawls. News and home pages learn high λ and get minute-level re-crawls. Sitemaps with lastmod, RSS feeds and push signals such as IndexNow or WebSub are used where sites support them, since they're cheaper than polling. Conditional GETs return 304 for unchanged pages, which saves bandwidth, although many servers ignore them. Measure **freshness SLOs** per tier (percentage of top-1M pages crawled within 1 h of a change, sampled via probes).`,
      },
      {
        topic: "Duplicate detection at scale",
        discussion: `Two levels. **URL dedup:** a canonical URL fingerprint (a 64-bit hash) is checked against a sharded seen-store. A Bloom filter in front avoids most disk lookups, and the rare false positive just skips a new URL, which is acceptable. **Content dedup:** an exact duplicate shares a content hash (mirrors, http vs https). A near-duplicate differs only in boilerplate, ads or timestamps, and **SimHash** (a 64-bit fingerprint where similar documents differ in few bits) catches it. To find fingerprints within Hamming distance 3 among billions, split the fingerprint into 4 blocks and index each block's permutations (Manku et al., Google 2007), so candidates share at least one exact block. Duplicates are clustered, and one canonical member goes to the index. Re-crawl priority for the other members drops.`,
      },
    ],
    tradeoffs: [
      "BFS by importance vs freshness-driven scheduling: pure BFS finds new pages but lets important pages go stale",
      "JavaScript rendering improves coverage for single-page apps but costs 10–50× more CPU; reserve it for high-value hosts",
      "Bloom filter for seen URLs saves memory but false positives skip a few new URLs",
      "Sharding the frontier by host simplifies politeness but can create hot shards for giant hosts; split them by path",
      "Storing every raw version enables reprocessing but multiplies storage; keep the last N versions plus diffs",
    ],
    followUps: [
      { q: "How do you avoid spider traps like infinite calendars?", a: "Cap depth and page count per host, detect repeating path segments and query-parameter explosions, keep URL length limits, and lower priority for hosts whose pages are near-duplicates of each other." },
      { q: "A frontier node crashes. What is lost?", a: "Nothing durable. Queues are persisted in RocksDB and checkpointed to object storage, and newly discovered URLs are also in Kafka. Hosts are re-assigned by the hash ring and resume from the snapshot plus a replay of recent URLs. At worst a few URLs are fetched twice." },
      { q: "How would you crawl the dark corners without hurting small sites?", a: "Lower per-host concurrency (one connection), longer delays, respect robots.txt strictly, and prefer sitemaps. Politeness budgets are per host, not global, so small sites never see bursts." },
    ],
    relatedTopics: ["design-infra", "search-systems", "data-pipelines", "mq-fundamentals", "object-storage", "rate-limiting"],
  },
  {
    id: "co-google-2",
    company: "google",
    title: "Design Google Docs real-time collaborative editing",
    frequency: "very-high",
    level: "L5 / L6 (Senior / Staff)",
    prompt:
      "Design the backend for a collaborative document editor where up to 100 people edit the same document simultaneously and see each other's changes and cursors in real time.",
    clarifyingQuestions: [
      "What content: rich text only, or also tables, images and comments?",
      "How many concurrent editors per document (typical vs maximum)? How many documents are active at once?",
      "Is offline editing with later merge required?",
      "What latency counts as real time for remote edits, e.g. under 200 ms p95 in-region?",
      "Is version history required, and at what granularity (every keystroke vs snapshots)?",
      "Are permissions per document (view/comment/edit) with link sharing?",
    ],
    functional: [
      "Multiple users edit the same document concurrently; all converge to the same content",
      "Show presence and live cursors of collaborators",
      "Persist every change durably; version history and restore",
      "Comments and suggestions anchored to text ranges",
      "Offline edits merge when reconnecting",
    ],
    nonFunctional: [
      "Edit propagation under 200 ms p95 within a region",
      "No lost edits (acknowledged operations are durable)",
      "Convergence: all replicas reach an identical state",
      "Scale to ~10M concurrently open documents",
      "Availability 99.95%, with graceful degradation to read-only",
    ],
    estimation: [
      { label: "Active documents", calc: "100M DAU, ~10% editing at peak → 10M open documents, average 1.5 editors" },
      { label: "Operation rate", calc: "Active typists ~3M × 3 ops/s (batched keystrokes) ≈ 9M ops/s globally" },
      { label: "Session servers", calc: "~50K documents per server (in-memory state + WebSocket) → 10M ÷ 50K ≈ 200 servers per region" },
      { label: "Op log storage", calc: "9M ops/s × 100 B ≈ 900 MB/s ≈ 78 TB/day before compaction; snapshots + compaction cut the retained volume ~10×" },
    ],
    highLevelDesign: `**Core decision: centralised operational transformation (OT) per document**, which is how Google Docs works. The alternative is CRDTs, discussed as a trade-off. Each active document has exactly **one authoritative session owner** (a document server) holding the current document state and revision number in memory.

**Connection path:** clients hold a WebSocket to an edge gateway. The gateway routes all connections for document D to D's owner, found via a **document → server directory** (consistent hashing plus leases in a coordination service such as Chubby, ZooKeeper or etcd).

**Edit protocol:**
1. The client applies an edit locally (optimistic UI) and sends \`op(baseRevision = r, ops)\`. It has at most one unacknowledged op batch in flight and buffers the rest.
2. The owner server transforms the incoming op against all ops committed since r (the OT transform function), assigns revision r+k+1, **appends it to the durable op log** (a Spanner/Bigtable row keyed by docId + revision, or a replicated log), and then acknowledges.
3. The server broadcasts the transformed op to the other clients, who transform it against their pending local ops and apply it.

**Persistence:** the op log is the source of truth. A snapshotter periodically materialises the document (every N ops or M minutes) so loading a document means reading the latest snapshot plus the log tail. Version history is built from snapshots and op ranges, with named versions kept.

**Presence and cursors:** these are ephemeral, sent over the same socket, and not persisted. Cursor positions are transformed like ops, so they stay anchored to text.

**Failover:** if the owner dies, its lease expires, a new owner loads snapshot + log, and clients reconnect and resend their unacknowledged ops with their base revision (op ids make resends idempotent).

**Comments** are stored separately, anchored to positions that are transformed as the text changes.`,
    diagram: `Client A ─┐  WebSocket                 ┌──────────────────────────┐
Client B ─┼────► Edge gateway ─────────►│ Doc session owner (doc D)│
Client C ─┘   (route by docId via       │ in-memory doc + rev      │
               directory/leases)         │ OT transform, sequencing │
                                         └──────┬────────────┬──────┘
                                 append op (ack │            │ broadcast
                                 after durable) ▼            ▼ transformed op
                                 ┌──────────────────┐   other clients
                                 │ Op log (Spanner/  │
                                 │ Bigtable, per doc)│──► Snapshotter ─► snaps
                                 └──────────────────┘              + history`,
    deepDives: [
      {
        topic: "OT vs CRDT",
        discussion: `**OT** needs a central sequencer per document. The server orders operations and transforms concurrent ones (for example, an insert at position 5 is shifted when a concurrent insert at position 2 is applied first). Keeping one owner per document makes transformation simple (server-client OT only needs the transform against sequenced ops, as in the Jupiter/Wave protocol) and keeps state compact. **CRDTs** (Yjs, Automerge, RGA sequence CRDTs) give each character a unique id with ordering metadata, so replicas merge in any order without a server. That's great for offline and peer-to-peer use, at the cost of metadata overhead (tombstones, ids per character) and more complex garbage collection. For a cloud product with always-online servers, centralised OT (Google Docs) or a server-authoritative CRDT (Figma-style, with a server for ordering) are both defensible. Say which one you'd pick and why: OT here, because of the central server and compact state.`,
      },
      {
        topic: "Single owner per document and hot documents",
        discussion: `One owner per document makes ordering trivial but creates a hotspot for a viral document with 10,000 viewers. Split the roles. **Editors** (max ~100) connect to the owner. **Viewers** connect to fan-out relays that subscribe to the owner's broadcast stream (pub/sub), so the owner sends once per relay rather than once per viewer. Throttle presence updates (cursor moves batched every 50–100 ms) because they outnumber edits. To keep a server from overloading with many hot documents, the directory can migrate a document: freeze briefly, snapshot, transfer the lease, and let clients reconnect. Owner placement should also be region-aware. Put the owner near the majority of editors, since every edit round-trips to it.`,
      },
      {
        topic: "Durability and acknowledgement semantics",
        discussion: `An edit is acknowledged only after it's durable in the op log. With Spanner, a commit is ~5–10 ms within a region, and batching ops per document every ~20 ms amortises writes. Clients keep unacknowledged ops locally (IndexedDB), so a crash on either side loses nothing: on reconnect the client resends with the same op ids, and the server dedupes by (clientId, seq). The op log row key \`docId#revision\` makes appends ordered and enforces conflict detection: a concurrent owner (split brain during a lease handover) would fail on the duplicate revision, which acts as a fencing token. Snapshots every ~500 ops bound load time. Old ops are compacted into history checkpoints after 30 days.`,
      },
    ],
    tradeoffs: [
      "Centralised OT: simple convergence and compact state, but needs an owner per document and makes offline editing harder",
      "CRDT: great offline and peer-to-peer merge, but carries metadata and tombstone overhead",
      "Ack after durable write adds ~10 ms latency but guarantees no lost edits",
      "Owner placement near editors lowers latency, but multi-region documents pay a cross-region round trip for some users",
      "Presence over the same socket is simple but needs throttling so it does not starve edits",
    ],
    followUps: [
      { q: "How does offline editing work with OT?", a: "The client records ops against its last known revision. On reconnect it sends them in order, and the server transforms them against everything committed since. Long offline sessions may produce surprising merges, so the UI can show a diff." },
      { q: "How do you implement suggestion mode?", a: "Suggestions are ops tagged as proposed, stored as annotations over ranges and rendered differently. Accepting one converts it to a normal op, and rejecting it removes the annotation. Both go through the same transform pipeline." },
      { q: "What if two regions both think they own a document?", a: "Lease-based ownership with fencing: op-log appends include the lease epoch and the expected next revision, so the stale owner's writes fail and its clients reconnect to the real owner." },
    ],
    relatedTopics: ["net-realtime", "ds-consistency", "ds-consensus", "design-social", "db-sharding", "rel-patterns"],
  },
  // ---------------------------------------------------------------- Amazon
  {
    id: "co-amazon-1",
    company: "amazon",
    title: "Design \"X people are viewing this product right now\"",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the service behind the product-page badge that says \"183 people are viewing this right now\" across ~300M products, updated every few seconds.",
    clarifyingQuestions: [
      "What does viewing mean: page open in the last N seconds, or an active tab with heartbeats?",
      "How accurate must the number be? Exact, or within ±5%? Do we show it only above a threshold?",
      "How fresh must it be: within 5–10 seconds?",
      "Should bots and crawlers be excluded? What about the same user in multiple tabs?",
      "Is it global or per marketplace (amazon.in vs .com)?",
      "What is the peak, e.g. Prime Day with lightning deals?",
    ],
    functional: [
      "Count distinct active viewers per product over a sliding window (e.g. 60 s)",
      "Return the count for a product page quickly; optionally push updates while the page is open",
      "Exclude bots; dedupe multiple tabs of the same user",
      "Show only when above a threshold (e.g. 10+)",
    ],
    nonFunctional: [
      "Read latency under 20 ms p99 (on the product page critical path, or loaded asynchronously)",
      "Handle Prime Day peaks: ~5M page views/min with extreme skew on deal items",
      "Approximate is acceptable (±5%); availability over precision",
      "Failure must not break the product page (fail silent)",
    ],
    estimation: [
      { label: "Concurrent viewers", calc: "Peak ~20M concurrent shoppers; each has 1 product page open → 20M active (user, product) pairs" },
      { label: "Heartbeat rate", calc: "Heartbeat every 20 s → 20M ÷ 20 = 1M events/s at peak" },
      { label: "Hot product skew", calc: "A lightning deal may have 500K concurrent viewers → 25K heartbeats/s on one product key" },
      { label: "Memory (exact sets)", calc: "20M pairs × ~50 B ≈ 1 GB; HyperLogLog per product per window ≈ 12 KB × active products (~2M) ≈ 24 GB → use exact counters for most, HLL only if needed" },
    ],
    highLevelDesign: `**Signal:** when a product page is visible, the page JavaScript sends a lightweight **heartbeat** (\`POST /presence {productId, sessionId}\`) on load and every 20 s while the tab is visible (Page Visibility API), plus a best-effort "leave" beacon on unload. Heartbeats go to an edge-terminated, stateless **presence ingestion service**. Bot filtering (known crawlers, and no-JS clients that never heartbeat) happens here.

**Counting model: time-bucketed distinct counts.**
- Keep per-product buckets of 10 s. For each heartbeat, record \`sessionId\` in the product's current bucket.
- Viewers now = distinct sessions across the last 6 buckets (60 s). An exact approach uses a Redis sorted set per product (\`ZADD viewers:{p} now sessionId\`, \`ZREMRANGEBYSCORE\` older than 60 s, \`ZCARD\`). That's simple and exact, and fine for most products.
- For **hot products**, switch to approximate: **HyperLogLog** per 10 s bucket (\`PFADD\`), and PFCOUNT over the last 6 buckets (PFCOUNT merges multiple keys on the fly), with ~0.8% standard error at 12 KB per key.

**Sharding:** Redis Cluster keyed by productId. The hot-product write rate (25K/s) is fine for one shard, but aggregating heartbeats first helps: the ingestion tier micro-batches heartbeats per product for 1 s before writing (a pipeline of PFADD with many members), which cuts ops by 10–100× on hot keys.

**Read path:** the product page does not wait for this. The badge is loaded asynchronously (\`GET /presence/{productId}\`) from a **read cache** that holds the computed count per product for 5 s (in-process cache in the read service plus CDN edge caching with max-age=5). A pre-computation job for the top 100K hot products writes counts every 5 s, so reads never hit Redis at peak.

**Failure isolation:** the feature is non-critical. Timeouts of ~50 ms and a circuit breaker hide the badge on failure. Presence ingestion is sized separately so it can't starve the checkout path.`,
    diagram: `Product page JS ── heartbeat /20s ──► Edge / ALB ──► Presence ingest (stateless)
      │                                              │ bot filter,
      │ GET count (async, cached 5s)                 │ 1 s batch per product
      ▼                                              ▼
 CDN edge (max-age 5s)                  Redis Cluster (by productId)
      │                                  • ZSET per product (exact, normal)
      ▼                                  • HLL per 10 s bucket (hot items)
 Presence read svc (L1 cache 5s) ◄───────┘
      ▲
      └── Hot-product precompute job (top 100K every 5 s)`,
    deepDives: [
      {
        topic: "Exact ZSET vs HyperLogLog",
        discussion: `A ZSET per product (member = sessionId, score = last heartbeat time) gives exact counts and supports "leave" (ZREM), but its memory and write cost grow with viewers: 500K members × ~70 B ≈ 35 MB for one hot product, and every heartbeat is an O(log n) update. **HyperLogLog** uses a fixed 12 KB per key regardless of cardinality, with ~0.81% error, and naturally dedupes repeated heartbeats from the same session. It can't delete, so use time buckets and let old buckets expire (TTL 70 s), and PFCOUNT across the last 6 buckets. A hybrid works well: all products start on a ZSET, and once ZCARD exceeds ~5K the product is flagged hot and writes switch to HLL buckets. The UI shows rounded numbers ("180+" or "1.2K") anyway, so HLL error is invisible.`,
      },
      {
        topic: "Handling Prime Day skew",
        discussion: `The danger is one lightning-deal key receiving 25K+ writes/s and 100K+ reads/s. Writes: the ingestion service aggregates in memory for 1 s per product and flushes one PFADD with hundreds of members, so a hot key sees ~1 op/s per ingestion node (100 nodes → 100 ops/s), which is trivial. Reads: the precompute job computes counts for hot products every 5 s and writes them into a small **count cache** replicated across read nodes, and the CDN edge caches \`/presence/{id}\` for 5 s. Most reads then never leave the edge. Load-test with a synthetic deal at 10× the expected concurrency, and alarm on ingestion lag and on the Redis ops/s of the hottest shard.`,
      },
      {
        topic: "Accuracy and trust",
        discussion: `Showing inflated numbers erodes trust, and regulators in some markets look at dark patterns. Define viewing precisely (a visible tab, a heartbeat within 60 s), exclude bots and internal traffic, dedupe per session (and per customer id when logged in, so multiple tabs count once), and show the badge only above a threshold. Measure accuracy offline by comparing HLL counts with exact counts from clickstream logs for a sample of products. Also expose the feature behind a flag per marketplace, so it can be turned off quickly during an incident or for legal review. Finally, document the definition publicly in the help pages, so the number is defensible if a customer or regulator asks how it is computed.`,
      },
    ],
    tradeoffs: [
      "Heartbeats vs page-view logs: heartbeats reflect presence accurately but add client traffic; page-view logs are cheaper but overcount people who left",
      "Exact ZSET vs HLL: exactness and deletes vs fixed memory and ~1% error",
      "Push (WebSocket updates) vs poll with CDN caching: push is fresher but costs millions of sockets; polling every 10 s with edge caching is far cheaper",
      "Micro-batching adds ~1 s of staleness but cuts hot-key write load by orders of magnitude",
    ],
    followUps: [
      { q: "How would you also show \"X bought in the last hour\"?", a: "That's a different signal: count order events from the order stream (Kafka) into per-product hourly buckets with a sliding window in Flink or Redis. The data is exact, lower volume and less time-sensitive." },
      { q: "Why not store presence in DynamoDB?", a: "A TTL attribute gives cleanup, but counting distinct active viewers needs a query per read and hot partitions on deal items. An in-memory structure is a better fit for ephemeral data that tolerates approximation." },
      { q: "What happens if the Redis shard for a hot product fails over?", a: "Presence data is ephemeral. The replica takes over (possibly losing a few seconds), counts dip briefly, and heartbeats refill the window within 60 s. The page is never affected." },
    ],
    relatedTopics: ["cache-fundamentals", "cache-failures", "net-realtime", "data-pipelines", "prod-scale", "cdn-global"],
  },
  {
    id: "co-amazon-2",
    company: "amazon",
    title: "Design Amazon Best Sellers rank per category (top-K)",
    frequency: "medium",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the system that computes and serves the Best Sellers top-100 list for each of ~40K categories, updated hourly and showing each product's Best Sellers Rank on its page.",
    clarifyingQuestions: [
      "Is rank based on units sold, revenue, or a weighted recency score (e.g. the last 24 h weighted more)?",
      "How fresh must it be: hourly, or near real time for deals?",
      "Are categories hierarchical, with a product ranked in several ancestor categories?",
      "Must every product get a rank (e.g. #45,231 in Books), or only the top 100 per category?",
      "Should returns and cancellations subtract from sales? What about fraud (fake orders)?",
    ],
    functional: [
      "Compute the top 100 per category (40K categories) from order events",
      "Compute every product's rank in its leaf and ancestor categories (the BSR shown on the product page)",
      "Serve lists and ranks with low latency",
      "Exclude cancelled, returned and fraudulent orders",
    ],
    nonFunctional: [
      "Hourly refresh, with results within 15 minutes after the hour",
      "Read latency under 10 ms (served from cache)",
      "Correct under skew (a viral item) and late or duplicate events",
      "Auditable: reproducible from the raw order log",
    ],
    estimation: [
      { label: "Order line events", calc: "~20M order lines/day ≈ 230/s average; Prime Day peak ~10K/s" },
      { label: "Products", calc: "~500M listed SKUs; ~50M with a sale in the last 30 days" },
      { label: "Rank table size", calc: "50M products × ~5 category memberships × 16 B ≈ 4 GB → fits a KV store or even memory" },
      { label: "Top-100 lists", calc: "40K categories × 100 × 16 B ≈ 64 MB → trivially cacheable everywhere" },
    ],
    highLevelDesign: `**Two-stage design: stream pre-aggregation plus hourly exact ranking.**

1. **Ingestion:** order, cancel and return events come from the order service's outbox into **Kafka**, keyed by productId. A fraud-scoring stage tags suspicious orders, which are excluded.
2. **Streaming aggregation (Flink):** it maintains per-product sales in **hourly buckets** (units, with an event-time window and a watermark allowing ~10 minutes of lateness). Each bucket is emitted to a **sales store** (Cassandra/DynamoDB: \`product_id, hour → units\`) and to S3 as Parquet for audit. Events are deduped by orderLineId.
3. **Scoring:** the BSR score is a decayed sum, e.g. score = Σ units_h × 0.5^(age_h / 24), so recent sales matter more. This can be updated incrementally: score_new = score_old × decay + units_this_hour.
4. **Hourly ranking job (Spark):** read all products with a non-zero score (~50M), join them with the category hierarchy (each product maps to its leaf and ancestor categories), explode to (category, product, score), and rank within each category (a window function over the partition by category, ordered by score desc). The output is:
   - the top 100 per category → the **Best Sellers list store**, and
   - the rank of each (product, category) → the **rank store**.
5. **Serving:** a read service with an in-memory copy of all top-100 lists (64 MB, reloaded hourly by version) and a KV lookup for ranks shown on product pages, cached at the edge for 1 h.

**Why not a live top-K in Redis for every category?** Hierarchical categories multiply the updates (one sale updates ~5 ZSETs), and exact ranks for the long tail (#45,231) are rarely needed in real time. The hourly batch is cheaper, auditable and simple. For deals needing faster movement, maintain **Redis ZSETs only for the top-level categories**, updated from the stream, with the batch as the source of truth.`,
    deepDives: [
      {
        topic: "Heavy hitters in real time (if hourly is not enough)",
        discussion: `For near-real-time "Movers & Shakers" we can't keep exact counts for every product in every category in memory cheaply. Use a **Count-Min Sketch** per category window to estimate counts, plus a **min-heap of size K** of the top candidates: each event updates the sketch and, if the estimate beats the heap minimum, enters the heap. Memory is O(width × depth) per category, independent of product count, and error is bounded (overestimates only). Or, because the top-level category count is small (~40), keep Redis ZSETs with ZINCRBY per event and ZREVRANGE 0 99. Either way, the hourly exact batch corrects any drift. Present it as a Lambda-style design: speed layer for freshness, batch layer for truth.`,
      },
      {
        topic: "Correctness: late, duplicate and reversed events",
        discussion: `Order events can arrive late (mobile retries), be duplicated (at-least-once delivery), or be reversed (cancellations, returns up to 30 days later). The streaming job dedupes by orderLineId with keyed state (a TTL of a few days), uses event time with watermarks, and emits corrections for late events into the correct hourly bucket. Returns subtract units from the original sale hour, or apply as a negative adjustment in the current hour. Policy matters for simplicity: we can decide returns only affect ranks within the decay window. Because raw events are kept in S3, any hour's ranking can be recomputed, which matters when sellers dispute a rank.`,
      },
      {
        topic: "Serving ranks on 500M product pages",
        discussion: `The product page shows "#3 in Headphones, #120 in Electronics". The rank store is keyed by productId and returns all category ranks. It's ~4 GB, so a DynamoDB table or a replicated in-memory KV works, with a per-request latency of a few ms, and a page cache (CloudFront or the page-rendering service's cache) for an hour, because ranks change hourly. Versioning: each hourly run writes a new version, and the serving layer flips an atomic pointer only after validation (row counts, top-list sanity checks against the previous hour, such as no category emptied). A bad run can then be rolled back instantly.`,
      },
    ],
    tradeoffs: [
      "Hourly batch vs real-time: simple, exact and auditable vs fresher but approximate and costlier",
      "Units vs revenue vs decayed score: product semantics differ; a decayed score resists stale best-sellers",
      "Count-Min Sketch gives bounded memory with overestimates; exact counters give exact results with memory proportional to products",
      "Exploding to ancestor categories multiplies data ~5× but keeps each category ranking independent and parallel",
    ],
    followUps: [
      { q: "How do you stop sellers gaming the rank with fake orders?", a: "Exclude orders flagged by fraud models, cap the rank influence of a single buyer or payment instrument, delay counting for new sellers, and weight verified purchases." },
      { q: "How would ranking change for a new category launched today?", a: "The batch job picks it up next hour via the category hierarchy. There's no special path, because categories are data, not code." },
      { q: "How do you test a change to the scoring formula?", a: "Run the new formula in shadow on the same hourly inputs, compare rank correlation (Kendall tau) and category-level diffs, review top movers, and then A/B test the lists on a traffic slice." },
    ],
    relatedTopics: ["data-pipelines", "mq-scenarios", "cache-fundamentals", "db-sharding", "design-advanced", "prod-correctness-ops"],
  },
  // ---------------------------------------------------------------- Meta
  {
    id: "co-meta-1",
    company: "meta",
    title: "Design live comments for Facebook Live",
    frequency: "very-high",
    level: "E5 / E6",
    prompt:
      "Design the system that lets viewers of a Facebook Live video post comments and see other viewers' comments in near real time, for streams ranging from 10 viewers to 5 million.",
    clarifyingQuestions: [
      "Do all viewers see all comments, or a sampled or ranked subset on huge streams?",
      "What latency target from post to display, e.g. under 2 s?",
      "Are comments persisted for replay (VOD) with the video timeline?",
      "Moderation: must comments be filtered before display (spam, hate), and can we delay for that?",
      "Are reactions (hearts, likes) in scope with the same pipeline?",
    ],
    functional: [
      "Post a comment on a live video",
      "Receive new comments in near real time while watching",
      "Load recent comments when joining; scroll back through history",
      "Moderation: spam/abuse filtering, creator-level blocking",
      "Persist comments for replay synchronised to the video timeline",
    ],
    nonFunctional: [
      "End-to-end latency under 2 s p95",
      "Streams with 5M concurrent viewers; 10K+ concurrent live videos",
      "High availability; degrade by sampling rather than failing",
      "Low client battery and bandwidth cost",
    ],
    estimation: [
      { label: "Viewers", calc: "Peak ~50M concurrent live viewers across ~10K streams, heavily skewed (the top stream has 5M)" },
      { label: "Comment writes", calc: "~1% of viewers comment per minute → 500K comments/min ≈ 8.3K writes/s globally; the top stream ≈ 800/s" },
      { label: "Naive fan-out", calc: "Top stream: 800 comments/s × 5M viewers = 4B deliveries/s → impossible; must sample/rank to ~20 comments/s per viewer" },
      { label: "Delivery with sampling", calc: "50M viewers × ~5 comments/s shown = 250M deliveries/s → batched into 1–2 push frames/s per viewer ≈ 50–100M frames/s" },
    ],
    highLevelDesign: `**Write path:** client → API (\`POST /videos/{id}/comments\`) → **comment service**: auth, rate limit per user, and a synchronous lightweight spam/classifier check (a few ms). It persists to the **comment store** (TAO/MySQL sharded by videoId, or Cassandra with partition = videoId and clustering = time bucket + commentId) and publishes to a **pub/sub system** on topic \`video:{id}\`. Heavier moderation (ML models, human review) runs asynchronously and can retract comments.

**Delivery path (push):** viewers hold a persistent connection (MQTT/WebSocket, as Facebook's mobile apps use MQTT) to an edge **gateway/realtime server**. Each gateway subscribes on behalf of its connected viewers: if 20K viewers of video V are on gateway G, G subscribes once to \`video:V\`. That's the key fan-out reduction. Meta's real systems route through a subscription layer (the BLADERUNNER/Pylon style), which maps topics to the set of gateways holding subscribers.

**Handling large streams:** for small streams, every comment goes to every viewer. For large streams, a **comment sampler/ranker** per video sits between the raw topic and the viewer topic. It selects ~10–20 comments/s to display using ranking signals (friend of the viewer, verified or creator replies, quality score, language), and it can produce **per-cohort streams** (by language or region). A viewer's own comments and those of friends are injected client-side or via a personal channel, so users always see their own.

**Joining late / history:** \`GET /videos/{id}/comments?before=cursor\` reads from the comment store (the last N minutes are cached in Redis for hot videos).

**Replay (VOD):** comments are stored with a video timestamp offset. The replay client fetches comments by time window as playback proceeds.

**Why not pull (polling)?** 5M viewers polling every 2 s would be 2.5M QPS on one video. With push, each comment is sent once per gateway.`,
    diagram: `Commenter ─► API ─► Comment svc (rate limit, fast spam check)
                        │            │
                        ▼            ▼ publish video:V
               Comment store      Pub/Sub (topic per video)
               (sharded by video)    │
                                     ▼
                        Sampler/ranker (large videos only)
                                     │ video:V:display (+cohorts)
                   ┌─────────────────┼──────────────────┐
                   ▼                 ▼                  ▼
             Gateway 1          Gateway 2   ...    Gateway N
             (subscribes once   (MQTT/WS)          (edge PoPs)
              per video)            │
                   ▼                ▼
               viewers          viewers (batched frames ~1/s)`,
    deepDives: [
      {
        topic: "Subscription routing: which gateways need video V?",
        discussion: `Every gateway holds a local map \`videoId → set(connections)\`. When the first viewer of V connects to gateway G, G registers "G subscribes to V" in a **subscription registry**: a sharded in-memory store keyed by videoId, listing gateways. Publishers (or the pub/sub layer) look up the gateways for V and send each one message, and the gateway fans out locally to its connections. For a 5M-viewer stream spread over ~2,000 gateways, that's 2,000 sends per displayed comment instead of 5M. The registry must handle churn (viewers joining and leaving at ~100K/s on big streams), so gateways register at gateway granularity (only the first join and last leave matter), with TTL heartbeats to clean up after gateway crashes.`,
      },
      {
        topic: "Sampling and ranking comments for huge streams",
        discussion: `At 800 comments/s nobody can read them all. Showing everything makes the UI useless and costs bandwidth. The sampler consumes the raw stream per video and, per 1 s window, selects the top K by score: creator and moderator replies always pass, then friends of the viewer (a per-viewer boost applied at the gateway using the viewer's friend set, which is hard, so often done client-side by also subscribing to a small friends channel), then quality and engagement (reactions on the comment), with language matching. Fairness adds randomisation so not only popular commenters appear. The output is a display topic per video (optionally per language). Small videos bypass the sampler entirely, so latency stays minimal.`,
      },
      {
        topic: "Hot-video storage and history",
        discussion: `Writing 800 comments/s into one partition (videoId) is fine for MySQL or Cassandra, but reads for "load recent comments" by millions of joiners are not. Keep a **ring buffer of the last ~500 displayed comments per hot video** in Redis (or in gateway memory), so a join is served from cache. History pagination further back goes to the store with a cursor (commentId, time bucket), and Cassandra partitions per (video, 10-minute bucket) avoid huge partitions. After the live stream ends, comments are compacted and indexed by video offset for replay. Moderation deletes are tombstones propagated through the same pub/sub channel so clients remove them live.`,
      },
    ],
    tradeoffs: [
      "Push vs poll: push minimises latency and load on hot videos, but needs millions of persistent connections",
      "Show all vs sample: sampling keeps the UI usable and costs bounded, but drops most comments on big streams",
      "Synchronous moderation adds latency but blocks abuse before display; async is faster but abuse is briefly visible",
      "Topic per video in pub/sub vs sharded topics: per-video topics are simple, but hot videos need a tree of fan-out relays",
      "MQTT on mobile saves battery and bandwidth vs WebSockets; the edge must support both",
    ],
    followUps: [
      { q: "How do reactions (flying hearts) differ?", a: "They're far higher volume and don't need individual delivery. Aggregate counts per video per second (a streaming counter) and push the totals, and the client animates them, so millions of events become one number per second." },
      { q: "A gateway region fails. What happens to viewers?", a: "Clients reconnect with backoff to another PoP, re-subscribe, and fetch the missed comments since their last seen id from the Redis ring buffer. Video playback is independent." },
      { q: "How do you rate limit comment spam from bots?", a: "Per-user and per-device token buckets, slow mode set by the creator (e.g. 1 comment per 10 s), classifier scores and new-account restrictions. Throttled comments can be shadow-dropped." },
    ],
    relatedTopics: ["net-realtime", "mq-fundamentals", "design-social", "rate-limiting", "cache-fundamentals", "prod-scale"],
  },
  {
    id: "co-meta-2",
    company: "meta",
    title: "Design an ad click and impression aggregation system",
    frequency: "high",
    level: "E5 / E6",
    prompt:
      "Design the pipeline that counts ad impressions and clicks from billions of events per day and serves per-ad, per-minute aggregates for advertiser dashboards and billing, accurate and near real time.",
    clarifyingQuestions: [
      "What event volume: ~10B clicks/day and ~500B impressions/day?",
      "What latency for dashboards (under 1 minute) vs billing (end of day, must be exact)?",
      "Which dimensions for queries: ad, campaign, advertiser, country, device? Granularity per minute?",
      "What delivery semantics are required: exactly-once counting for billing?",
      "How long do we keep raw and aggregated data?",
      "Must invalid traffic (bot clicks) be excluded before billing?",
    ],
    functional: [
      "Ingest click and impression events from ad servers and clients",
      "Aggregate counts per ad per minute (and roll up to campaign/advertiser, hour/day)",
      "Serve queries for the last M minutes and historical ranges; top-N ads by clicks",
      "Filter invalid and duplicate events; support corrections",
    ],
    nonFunctional: [
      "Throughput: ~6M events/s at peak",
      "Dashboard freshness under 1 minute; billing exact",
      "No data loss; idempotent processing",
      "Recompute from raw data when logic changes",
    ],
    estimation: [
      { label: "Event rate", calc: "500B impressions + 10B clicks per day ≈ 510B ÷ 86,400 ≈ 5.9M events/s average; peak ~2× ≈ 12M/s" },
      { label: "Raw storage", calc: "510B × 100 B ≈ 51 TB/day raw (compressed ~10 TB) → S3/HDFS, 1 year ≈ 3.6 PB compressed" },
      { label: "Aggregate rows", calc: "~10M active ads × 1,440 minutes ≈ 14B rows/day at minute granularity (sparse, most ads inactive per minute ~1–2B)" },
      { label: "Kafka sizing", calc: "12M/s × 100 B = 1.2 GB/s ingest ≈ 10 Gbps; at ~20 MB/s per partition → ~60–120 partitions per topic, typically 256+ for parallelism" },
    ],
    highLevelDesign: `**Ingestion:** ad servers and client beacons send events (eventId, adId, userId, timestamp, type, device, country) to **log collectors** at the edge, which write to **Kafka** (acks=all, idempotent producer), partitioned by adId so each ad's events land on one partition.

**Stream aggregation (Flink):**
1. **Dedup:** keyed state on eventId with a TTL (e.g. 1 h) drops retried beacons. The ad server generates impression ids, and clicks carry the impression id.
2. **Invalid traffic filter:** rules (click without impression, rapid repeated clicks, known bot IPs) and a model score. Invalid events go to a separate stream for audit, not dropped silently.
3. **Windowed aggregation:** tumbling 1-minute windows on **event time**, with watermarks allowing ~2–5 minutes of lateness. Very late events go to a side output and are corrected by the batch path.
4. **Exactly-once:** Flink checkpoints plus a transactional sink (two-phase commit into Kafka), or idempotent upserts keyed by (adId, minute) into the OLAP store.

**Serving store:** an OLAP database built for aggregates (Apache Druid/Pinot or ClickHouse; Meta internally uses Scuba/ODS-like systems), holding per-minute rollups with dimensions. It supports "clicks for ad X in the last 30 minutes" and "top 100 ads by clicks in the last hour" (a top-N query, or a separate top-K stream).

**Batch reconciliation (Lambda correction):** the raw events in the data lake are recomputed hourly or daily with Spark, which is the **billing source of truth**. That includes late events, reprocessed fraud decisions and bug fixes. The batch output overwrites streaming aggregates for closed periods (versioned).

**Billing:** reads daily reconciled aggregates. Dashboards read the streaming aggregates and are marked "preliminary" until reconciled.`,
    diagram: `Ad servers / client beacons
       │
       ▼
Edge log collectors ─► Kafka (clicks, impressions; partition by adId)
                            │                     │
                            ▼                     ▼
             Flink: dedup → IVT filter →    Raw sink → Data lake (S3/Parquet)
             1-min event-time windows              │
                            │ exactly-once          ▼
                            ▼                 Spark hourly/daily recompute
                  OLAP store (Druid/Pinot) ◄──── overwrite closed periods
                       │            │
                Dashboards      Billing (reads reconciled data)`,
    deepDives: [
      {
        topic: "Exactly-once counting end to end",
        discussion: `Duplicates enter at three points: client retries (the same beacon sent twice), producer retries into Kafka, and stream job restarts. Fixes, in order: **event ids** from the ad server with dedup state in Flink (a keyed MapState with a TTL); the **idempotent Kafka producer** (enable.idempotence) to avoid broker-level duplicates; and **Flink checkpoints with a transactional or idempotent sink**. For the OLAP store, write aggregates as upserts keyed by (adId, minute, dimensions), so a replay after restart overwrites instead of adding. For billing, keep a **reconciliation** job that recounts from raw data daily and compares totals per advertiser with the streaming numbers, alerting on more than 0.1% drift. That's the Lambda-style safety net that interviewers like to hear.`,
      },
      {
        topic: "Hot ads and partition skew",
        discussion: `A Super Bowl ad might get 1% of all events: 60K events/s on one adId, and so on one Kafka partition and one Flink task. Mitigate by **salting the key** (adId#0..#15) in the first aggregation stage, which spreads the load over 16 tasks, then a second stage merges by adId per window (two-phase aggregation). Flink's local pre-aggregation (mini-batch) also cuts the state updates. Detect hot keys dynamically from a streaming heavy-hitter sketch, and salt only those. Otherwise you pay a merge cost for every ad. Watch the skew continuously: the set of hot ads changes hourly during big events, so the salting decision must be dynamic, and it's worth alerting on per-task backpressure in Flink as the early signal.`,
      },
      {
        topic: "Late data and watermarks",
        discussion: `Mobile clients send beacons late (offline, batching), and some arrive hours later. Event-time windows with a watermark of, say, 5 minutes finalise a minute's counts 5 minutes later, which trades freshness for completeness. Events later than the watermark go to a **side output**: they're either applied as corrections (a Druid re-ingestion of that segment) or left for the batch recomputation. Dashboards show preliminary numbers immediately (updated as late data arrives), and billing only uses closed, reconciled periods. Being explicit about freshness vs correctness is the core trade-off here. Advertisers should see a clear "last updated" and "preliminary" marker on the dashboard, which avoids support tickets when numbers shift slightly after late data arrives.`,
      },
    ],
    tradeoffs: [
      "Lambda (stream + batch) vs Kappa (stream only, with replay): Lambda gives a billing-grade batch truth at the cost of two code paths",
      "Watermark delay: longer means more complete, shorter means fresher",
      "Druid/Pinot pre-aggregated rollups make queries fast but less flexible than raw-event OLAP (ClickHouse on raw)",
      "Key salting fixes hot ads but adds a second aggregation stage",
      "Filtering invalid traffic inline vs in batch: inline keeps dashboards clean, batch can use better models later",
    ],
    followUps: [
      { q: "How would you answer \"top 100 ads by clicks in the last 5 minutes\" in real time?", a: "Keep a sliding-window top-K in Flink: per-minute counts, then a merge of the last 5 windows with a min-heap. Emit to a small cache and serve directly, rather than scanning the OLAP store." },
      { q: "An advertiser disputes their bill. How do you investigate?", a: "Recompute their numbers from the raw events in the lake with the same versioned logic, show the invalid-traffic exclusions with reasons, and compare them with the streaming aggregates. Raw data is kept for that purpose." },
      { q: "How do you change the IVT logic without breaking history?", a: "Version the logic. Reprocess affected periods in batch, write new aggregate versions, and switch readers after validation. Billing for closed invoices is only adjusted via credits." },
    ],
    relatedTopics: ["data-pipelines", "mq-scenarios", "mq-fundamentals", "design-advanced", "prod-correctness-ops", "observability"],
  },
  // ---------------------------------------------------------------- Microsoft
  {
    id: "co-microsoft-1",
    company: "microsoft",
    title: "Design Microsoft Teams presence (Available / Busy / Away / Offline)",
    frequency: "high",
    level: "Senior SDE (L63–L64)",
    prompt:
      "Design the presence service that shows each user's status (Available, Busy, In a meeting, Away, Offline) to colleagues across Teams clients, for 300M monthly users in enterprise tenants.",
    clarifyingQuestions: [
      "Which sources drive presence: client activity, calendar (Outlook), calls, manual status?",
      "How fresh must status be for others: within ~5–10 s?",
      "Who can see whose presence: same tenant only, or federated with other tenants?",
      "How many contacts does a typical user watch (chat list, org chart, open channels)?",
      "Multiple devices per user: how do we aggregate (desktop idle, phone active)?",
    ],
    functional: [
      "Compute an aggregated status per user from devices, calendar, calls and manual override",
      "Publish status changes to subscribers (watchers) in near real time",
      "Batch-fetch presence for a list of users (roster, channel members)",
      "Custom status messages with expiry; tenant privacy policies",
    ],
    nonFunctional: [
      "Update fan-out under 5 s p95",
      "~300M MAU, ~100M concurrently online at peak (Monday 9 AM per region)",
      "Highly available: stale presence is acceptable, errors are not",
      "Tenant isolation and data residency (EU data stays in EU)",
    ],
    estimation: [
      { label: "Online users and devices", calc: "100M online × 1.5 devices = 150M device sessions" },
      { label: "Raw signals", calc: "Activity heartbeat every 60 s + state changes → ~150M ÷ 60 ≈ 2.5M signals/s" },
      { label: "Aggregated status changes", calc: "~4 changes/user/hour → 100M × 4 ÷ 3,600 ≈ 110K changes/s" },
      { label: "Fan-out", calc: "Average 50 online watchers per user → 110K × 50 ≈ 5.5M notifications/s (batched per client connection)" },
      { label: "State memory", calc: "300M users × ~200 B presence record ≈ 60 GB → partitioned in-memory store with replicas" },
    ],
    highLevelDesign: `**Components:**
1. **Signal ingestion:** clients send activity and heartbeats over their existing real-time connection (the Teams notification channel), and calendar and calling services publish events ("meeting started", "call connected") to an event bus.
2. **Presence aggregator (sharded by userId):** it keeps per-user state in memory: device states (active/idle/offline with last heartbeat), calendar state, call state and manual override with expiry. A deterministic **aggregation rule** picks the displayed status. For example: manual "Do not disturb" > in a call > presenting > in a meeting (from calendar) > active on any device = Available > idle on all devices = Away > no heartbeat for 3 minutes = Offline. Shards are actor-like (Orleans virtual actors, per user, a good Microsoft-native answer) with state checkpointed to storage (Cosmos DB or Azure Table) for recovery.
3. **Subscription service:** clients subscribe to the users they're rendering (chat list, channel members visible on screen), with subscriptions expiring after ~1 h unless renewed. The subscription index is keyed by the *watched* user: \`userId → set(subscriber connection ids / gateway ids)\`.
4. **Fan-out:** when an aggregated status changes, the aggregator publishes the change, and the subscription service resolves the watchers and sends to the **gateways** holding those connections, batched (a gateway receives "user X changed" once and fans out locally).
5. **Batch GET API:** \`POST /presence:batchGet {userIds[≤650]}\` serves roster rendering from the aggregator's cache.

**Debouncing:** an idle transition only after 5 minutes of inactivity; flapping (network blips) suppressed with a grace period before going Offline.

**Multi-region:** users are homed to a region based on tenant geography. Cross-region watchers (a global company) subscribe through a regional relay that replicates status changes, which respects residency by sending only the status, not the underlying signals.`,
    diagram: `Teams clients ──heartbeats/activity──► Gateways (persistent conns)
      ▲                                      │
      │ batched presence updates             ▼
      │                          Presence aggregator (actors per user,
Calendar svc ──events──► Event bus ──► sharded by userId, rules engine)
Calling svc  ──events──►                     │ status changed
                                             ▼
                             Subscription index (watched → gateways)
                                             │
                                             ▼
                               Fan-out to gateways ─► subscribed clients`,
    deepDives: [
      {
        topic: "Aggregating multiple devices and sources",
        discussion: `Presence is a pure function of current inputs, which keeps it testable and deterministic: \`status = f(manualOverride, callState, calendarState, deviceStates, now)\`. Each input carries a timestamp and a TTL. Device heartbeats expire after ~3 minutes, a manual status expires at the user-chosen time, and a calendar busy block ends at the meeting end. The aggregator re-evaluates f on any input change and on timer expiry (per-user timers, handled by actor reminders). It only emits when the *output* changes, which suppresses most noise, since heartbeats rarely change status. A phone active while the desktop is idle means Available (activity wins). All devices idle means Away. This rule set is configuration, not code, so product can change precedence.`,
      },
      {
        topic: "Subscription management at scale",
        discussion: `The fan-out cost is proportional to watchers, so we want to watch only what's visible. Clients subscribe to presence for users currently rendered (virtualised lists), with a lease of about 1 hour that's renewed while visible. Large channels (5,000 members) don't subscribe to everyone: they fetch presence on scroll via batchGet and subscribe only to the visible window. The index \`watchedUser → gateways\` is sharded by watched user and co-located with that user's aggregator shard, so a status change is resolved locally. Gateways register and deregister in aggregate (reference-counting their connections), which keeps churn manageable during the Monday-morning login storm.`,
      },
      {
        topic: "Degradation and tenant boundaries",
        discussion: `Presence is not critical to messaging, so under load we prefer stale over failing. Fan-out is best-effort with coalescing (if a user changes status 3 times in 2 s, send the latest only). If the subscription service is overloaded, clients fall back to polling batchGet every 60 s. Tenant boundaries: the subscription check verifies that watcher and watched are in the same tenant, or that federation is allowed by both tenants' admin policies, and privacy settings (hide presence) are enforced in the aggregator output. EU tenants' signals never leave the EU region, and only the derived status is replicated for federated watchers.`,
      },
    ],
    tradeoffs: [
      "Push fan-out vs polling: push is fresher but its cost scales with watchers; polling is simple but laggy and wasteful",
      "Actor model (Orleans) gives natural per-user state and timers, but single-activation guarantees need care during failover",
      "Aggressive debouncing reduces flapping but delays Away/Offline accuracy",
      "Short subscription leases cut stale subscriptions but increase renewal traffic",
    ],
    followUps: [
      { q: "How do you handle the Monday 9 AM login storm?", a: "Gateways absorb reconnects with jittered backoff. Aggregator actors activate lazily, and initial roster presence is served via batchGet from checkpointed state, with subscriptions established progressively." },
      { q: "What if an aggregator shard fails?", a: "Actors reactivate elsewhere from their last checkpoint. Devices re-send heartbeats within 60 s, restoring accuracy. Watchers may see brief stale statuses, which is acceptable." },
      { q: "How would you add \"out of office until Friday\"?", a: "It's another input with a TTL derived from the calendar or the user's setting, with high precedence in the rule set, and it's shown as a status message." },
    ],
    relatedTopics: ["net-realtime", "design-social", "ds-consistency", "microservices", "rel-patterns", "api-design"],
  },
  {
    id: "co-microsoft-2",
    company: "microsoft",
    title: "Design a distributed job scheduler (cron at cloud scale)",
    frequency: "high",
    level: "Senior / Principal SDE",
    prompt:
      "Design a multi-tenant service where customers register jobs (one-off at a time, or cron expressions) that call their HTTP endpoint or enqueue a message, running tens of millions of schedules reliably.",
    clarifyingQuestions: [
      "What precision is needed: within 1 s of the scheduled time, or within a minute?",
      "What delivery semantics: at-least-once with idempotency keys, or exactly-once?",
      "How many schedules, and how bursty is the load (many jobs at :00 of every hour)?",
      "What happens if a run is still going when the next one is due: skip, queue, or overlap?",
      "Retry policy per job, timeouts, and run history retention?",
      "Multi-region: must jobs keep firing if a region fails?",
    ],
    functional: [
      "Create, update, pause and delete jobs with a cron expression or a one-off timestamp",
      "Trigger targets: HTTP webhook, queue message, or internal function",
      "Retries with backoff, timeouts, concurrency policy, run history",
      "Per-tenant quotas and rate limits",
    ],
    nonFunctional: [
      "Fire within 1–2 s of the scheduled time at p99",
      "No missed runs; duplicates allowed but rare (at-least-once, with a run id for idempotency)",
      "Handle top-of-hour spikes of ~1M jobs firing in the same second",
      "HA across zones; regional failover with bounded delay",
    ],
    estimation: [
      { label: "Schedules", calc: "50M active schedules; average one run per hour → 50M ÷ 3,600 ≈ 14K runs/s" },
      { label: "Top-of-hour spike", calc: "~30% of cron jobs use minute 0 → 15M runs due at :00 → must smear over ~60 s or scale executors to ~250K/s" },
      { label: "Run history", calc: "14K/s × 86,400 ≈ 1.2B runs/day × 300 B ≈ 360 GB/day → keep 30 days hot (~11 TB), then archive" },
      { label: "Executor fleet", calc: "HTTP call p50 200 ms; 14K/s × 0.2 s ≈ 2,800 concurrent calls average; spike 250K/s → queue buffering + ~50K concurrency" },
    ],
    highLevelDesign: `**Separate "when" from "do":**

1. **Job API + job store:** jobs are stored in a sharded database (Azure SQL or Cosmos DB), partitioned by jobId hash: definition, cron, target, retry policy and **next_fire_time**.
2. **Scheduler (the "when"):** the timeline is partitioned into **shards** (e.g. 1,024), each owned by one scheduler instance via **leases** (etcd/ZooKeeper, or blob leases on Azure). Each shard owner keeps an **in-memory timing wheel / min-heap** of jobs due in the next ~5 minutes, loaded by a query on next_fire_time. A job's shard = hash(jobId) % 1024.
3. When a job is due, the scheduler **enqueues a run** (runId = jobId + scheduled timestamp, which is the idempotency key) onto a durable **work queue** (Kafka or Service Bus), and advances next_fire_time with a conditional update (\`WHERE next_fire_time = :old\`), so two owners during a lease transfer can't both advance.
4. **Executors (the "do"):** a stateless worker pool consumes runs, applies per-tenant concurrency limits, calls the target with a timeout, and records the result in **run history**. Failures are retried with backoff by re-enqueueing with a delay. Exhausted runs go to a DLQ and notify the tenant.
5. **Smearing spikes:** at creation the service can suggest jitter ("H" in Jenkins-style cron). For strict jobs, the queue absorbs the burst and the executors autoscale on queue lag.

**Recovery:** a new shard owner re-queries due jobs whose next_fire_time is in the past (a missed-run catch-up policy per job: fire once, fire all, or skip).

**Observability:** per-tenant metrics for scheduled-vs-actual start delay, success rate and retries, plus alerts when any shard's firing lag exceeds a few seconds.`,
    diagram: `Tenant ─► Job API ─► Job store (sharded; next_fire_time index)
                             ▲        │ load due-soon jobs per shard
          conditional update │        ▼
                             │  Scheduler instances (lease per shard,
                             │   timing wheel in memory)
                             │        │ enqueue run(runId=job+ts)
                             │        ▼
                             │  Durable work queue (Kafka / Service Bus)
                             │        │
                             │        ▼
                             └── Executors (stateless, per-tenant limits)
                                      │ call target (timeout, retries)
                                      ▼
                                Run history + DLQ + tenant notifications`,
    deepDives: [
      {
        topic: "Shard ownership and never double-firing",
        discussion: `Each of the 1,024 shards has exactly one active owner, which holds a lease with a TTL (~10 s, renewed every 3 s). On failure the lease expires and another instance acquires it with a higher **fencing epoch**. Two protections against double-fire during handover: (1) advancing next_fire_time is a conditional update that includes the epoch, so the stale owner's update fails; (2) runId = jobId + scheduledTime, and the work queue or executors dedupe on runId (a unique key in run history). Consumers still receive at-least-once delivery, so we pass runId to the target as an idempotency header. Being honest that exactly-once across an HTTP boundary is impossible, and that we provide at-least-once plus an idempotency key, is the senior answer.`,
      },
      {
        topic: "Efficiently finding due jobs",
        discussion: `Scanning 50M jobs each second is a non-starter. Each shard owner runs a query every minute: \`SELECT … WHERE shard = s AND next_fire_time < now() + 5 min\`, using an index on (shard, next_fire_time), which gives ~14K × 300 s ÷ 1,024 ≈ 4K jobs per shard in memory. A **hierarchical timing wheel** (buckets per second for the next 5 minutes) gives O(1) insert and fire. Newly created or updated jobs due within the window are pushed to the owning shard directly (via a notification) so they don't wait for the next load. Computing the next fire time from cron is done at advance time, and time zones and DST must be handled explicitly (store the tz, and compute in it).`,
      },
      {
        topic: "Protecting targets and tenants",
        discussion: `A scheduler can DDoS its customers (15M jobs at :00) or be abused by one tenant. Controls: per-tenant concurrency and rate limits in executors (a token bucket per tenant), per-target-host limits, and circuit breakers per target, so a failing endpoint doesn't consume all the retries. Retry storms are prevented with exponential backoff plus jitter and a max attempts setting. Timeouts are per job (default 30 s). Fair scheduling across tenants in the executor pool (weighted round-robin over per-tenant queues) prevents one tenant's 1M-job burst from delaying everyone else's jobs. Tenants get per-job metrics: scheduled vs actual start latency, success rate and duration.`,
      },
    ],
    tradeoffs: [
      "Timing wheel in memory per shard gives precise, cheap firing but needs lease-based ownership and a reload on failover",
      "Polling the DB for due jobs is simple and robust; push notifications for near-term jobs add freshness and complexity",
      "At-least-once plus an idempotency key is achievable; exactly-once to external HTTP is not",
      "Smearing top-of-hour jobs reduces peak cost but changes customer-visible timing, so make it opt-in or advisory",
      "Kafka vs Service Bus for runs: Kafka has high throughput with delayed retries via separate topics; Service Bus has native scheduled messages and DLQ",
    ],
    followUps: [
      { q: "How do you support \"run at most one instance at a time\"?", a: "The executor takes a per-job lock (a lease row with an expiry) before running. If it's held, apply the job's policy: skip, queue, or allow overlap. The lock expires if an executor dies." },
      { q: "How would you do regional failover?", a: "Replicate the job store asynchronously to a secondary region. On failover, schedulers there acquire the shards and fire missed runs per each job's catch-up policy. Duplicates are possible, and runId dedupe handles them." },
      { q: "How would you handle one-off jobs scheduled a year ahead?", a: "Same store and index. They only enter a shard's in-memory window when due within 5 minutes, so memory is bounded by near-term jobs, not the total." },
    ],
    relatedTopics: ["design-infra", "mq-fundamentals", "ds-consensus", "rel-patterns", "prod-async-failure", "rate-limiting"],
  },
  // ---------------------------------------------------------------- Apple
  {
    id: "co-apple-1",
    company: "apple",
    title: "Design a push notification service like APNs",
    frequency: "high",
    level: "ICT4 / ICT5",
    prompt:
      "Design a service that lets app developers' servers send push notifications to any of ~2 billion Apple devices with low latency, while preserving device battery and user privacy.",
    clarifyingQuestions: [
      "What scale: ~2B devices, and a few billion notifications per day?",
      "What delivery guarantees: best-effort with store-and-forward for offline devices? How long do we keep them?",
      "Priorities: alerts vs background/silent pushes (throttled for battery)?",
      "Collapse semantics: replace older notifications with the same collapse id?",
      "What is the authentication model for provider servers (token or certificate)?",
    ],
    functional: [
      "Providers send a notification to a device token via an HTTP/2 API",
      "Deliver to online devices over a persistent connection; store for offline devices (latest per collapse id)",
      "Priority levels, expiry, collapse id, and silent/background pushes",
      "Feedback: report invalid or unregistered tokens to providers",
    ],
    nonFunctional: [
      "Sub-second delivery for online devices at p95",
      "Billions of long-lived connections; minimal device battery and radio usage",
      "Privacy: the device token is opaque; providers never learn device identity or IP",
      "Highly available globally; tolerant of provider bursts (e.g. a sports score push to 50M devices)",
    ],
    estimation: [
      { label: "Connections", calc: "~2B devices, ~1.2B connected at any time → at ~1M idle TLS connections per server (tuned) ≈ 1,200 servers, realistically 3–5K with headroom" },
      { label: "Notification rate", calc: "~40B/day ≈ 460K/s average; bursts (breaking news) of 50M in 1 minute ≈ 830K/s extra" },
      { label: "Keepalive traffic", calc: "Heartbeat every ~15–30 min per device (carrier NAT timeouts) → 1.2B ÷ 1,200 s ≈ 1M heartbeats/s" },
      { label: "Offline store", calc: "Say 300M offline devices × ~1 pending (latest per app) × 1 KB ≈ 300 GB → replicated KV" },
    ],
    highLevelDesign: `**Device side:** each device keeps **one** persistent, mutually authenticated TLS connection to a nearby **push gateway**, for all apps. One radio connection instead of one per app is what saves battery. Heartbeats are adaptive: the device learns the longest keepalive its carrier NAT tolerates.

**Registration:** the OS registers the app and receives a **device token**, an opaque value encrypted by the service, which encodes routing information that only the service can read. The app sends it to its provider server.

**Provider API:** providers connect over HTTP/2 with JWT or certificate auth and send \`POST /3/device/{token}\` with a JSON payload (≤ 4 KB), headers for priority, expiration, collapse-id and push-type. Many requests are multiplexed per connection.

**Routing:**
1. The **frontend API tier** authenticates the provider, validates the payload, decrypts the token to get (device id, routing hints), and enforces per-provider rate limits.
2. The **connection directory** (a sharded in-memory KV: deviceId → gateway id, updated on connect and disconnect) finds the gateway currently holding the device's connection.
3. The message goes over the internal fabric to that gateway, which writes it on the device connection. The device acknowledges it.
4. If the device is **offline** (no directory entry, or the write fails), store it in the **offline store**, keeping only the latest notification per (device, app, collapse id) until expiry. When the device reconnects, the gateway flushes stored notifications.

**Battery-aware delivery:** priority 10 alerts are delivered immediately. Priority 5 and background pushes are coalesced and delivered when the device is awake or on power, and silent pushes are budgeted per app.

**Feedback:** an unregistered or invalid token gets HTTP 410 back to the provider synchronously.`,
    diagram: `Provider servers ──HTTP/2 + JWT──► API frontends (auth, validate, rate limit,
                                      decrypt token → deviceId)
                                             │
                                             ▼
                             Connection directory (deviceId → gateway)
                                 │ online                  │ offline
                                 ▼                         ▼
                      Push gateways (TLS, ~1M     Offline store (latest per
                      conns each, regional)        collapse-id, TTL)
                                 │                         │ flush on reconnect
                                 ▼                         │
                       Devices (one connection for all apps) ◄┘`,
    deepDives: [
      {
        topic: "Holding a billion connections",
        discussion: `Connection servers are optimised for idle sockets: event-driven I/O (epoll/kqueue), small per-connection memory (~2–10 KB with TLS session state tuned), and kernel tuning for file descriptors and TCP buffers. Devices connect to the nearest region by DNS or anycast and reconnect with jittered backoff to avoid storms after an outage. Losing a gateway drops ~1M connections at once: devices reconnect elsewhere within their backoff window, and the directory is updated. Notifications addressed to the dead gateway during that window fail and go to the offline store, then flush on reconnect. Graceful drains on deploys (sending a reconnect hint to devices in waves) avoid thundering herds. Heartbeat intervals are the main battery lever: longer is better, bounded by carrier NAT timeouts learned per network.`,
      },
      {
        topic: "Privacy by design",
        discussion: `The device token is encrypted by the service, so providers can't correlate a user across apps: the same device has a different token per app, and tokens are rotated on reinstall or restore. Payloads can be end-to-end encrypted by the app (the provider encrypts, and a notification service extension decrypts on the device), so the push service carries opaque bytes. The service logs minimal metadata and has no content retention beyond store-and-forward for offline delivery. Rate limiting and abuse detection operate on provider identity, not user identity. These choices are why APNs uses opaque tokens and a single system-owned connection rather than letting apps hold their own sockets.`,
      },
      {
        topic: "Bursts: 50M notifications in a minute",
        discussion: `A news app may push to 50M devices at once, which is millions of API calls in seconds. The frontends autoscale and apply per-provider token buckets (backpressure via HTTP 429 with retry hints). Internally, messages are queued per destination gateway, so gateway write rates are smoothed. Delivery to a gateway is batched (many notifications per internal RPC), and each gateway writes to thousands of sockets per millisecond. The directory lookup is the hot path: it's in memory, sharded by deviceId, and replicated. For topic-style broadcasts, a provider-side fan-out is still required, because APNs is addressed per token. That's a deliberate privacy choice, since a server-side topic list would reveal subscriptions.`,
      },
    ],
    tradeoffs: [
      "One shared connection per device saves battery but centralises the dependency on the push service",
      "Store only the latest per collapse id: bounded storage but intermediate notifications are dropped",
      "Opaque per-app tokens protect privacy but prevent server-side broadcast topics",
      "Long heartbeat intervals save battery but detect dead connections more slowly",
      "Best-effort delivery (no guaranteed ordering or delivery) keeps the system simple; apps must sync the real state on open",
    ],
    followUps: [
      { q: "How does the provider know a user uninstalled the app?", a: "The next push to that token returns 410 Unregistered with a timestamp, and the provider should delete the token. Tokens also change on reinstall." },
      { q: "Why not guarantee delivery of every notification?", a: "Devices may be offline for weeks. Storing everything would be unbounded and mostly stale. Push is a nudge: the app syncs authoritative state from its own server when opened." },
      { q: "How would you design Android-style FCM topic messaging differently?", a: "Keep a server-side topic → token subscription index with fan-out workers, trading some privacy for convenience. The shape is the same as the gateways and directory, plus a fan-out tier." },
    ],
    relatedTopics: ["net-realtime", "net-load-balancing", "design-infra", "security-general", "rate-limiting", "prod-scale"],
  },
  {
    id: "co-apple-2",
    company: "apple",
    title: "Design iCloud Photos sync with end-to-end encryption",
    frequency: "medium",
    level: "ICT4 / ICT5",
    prompt:
      "Design a service that syncs a user's photo library (100K+ photos and videos) across iPhone, iPad and Mac, including edits and deletes, where the content is end-to-end encrypted so the server cannot read it.",
    clarifyingQuestions: [
      "Are originals and derivatives (thumbnails, edits) both synced? Does the device keep optimised versions to save space?",
      "Does E2E cover content only, or metadata (location, faces, captions) too?",
      "Conflict model: can two devices edit the same photo offline?",
      "Shared albums or libraries with family (multi-user keys)?",
      "Upload constraints: only on Wi-Fi or charging? Resumable uploads for large videos?",
    ],
    functional: [
      "Upload new photos and videos from any device; appear on all devices",
      "Sync edits (non-destructive adjustments) and deletes (recently deleted for 30 days)",
      "Download on demand (optimised storage keeps thumbnails locally)",
      "Shared libraries with other users",
    ],
    nonFunctional: [
      "Content E2E encrypted; keys never leave user devices (except escrowed keys when the user opts in)",
      "Efficient: resumable uploads, dedup within the account, minimal battery use",
      "Durable (11 nines for blobs); strongly consistent per-library change log",
      "Scale: ~1B+ accounts, hundreds of exabytes over time",
    ],
    estimation: [
      { label: "Uploads", calc: "1B users × 10 photos/day ≈ 10B/day ≈ 115K/s average" },
      { label: "Bytes", calc: "Average 3 MB per photo (videos far larger; average asset ~5 MB) → 10B × 5 MB = 50 PB/day ingest" },
      { label: "Metadata", calc: "10B records/day × 1 KB ≈ 10 TB/day in the metadata store" },
      { label: "Thumbnails", calc: "Device-generated, encrypted, ~50 KB each → 500 TB/day" },
    ],
    highLevelDesign: `**Key hierarchy (the crux of E2E):**
- Each asset gets a random **content key** (AES-256-GCM), and the file is encrypted on the device before upload.
- The content key is wrapped with the **library key**, which is wrapped with keys held only in each trusted device's Secure Enclave or keychain and synced via an end-to-end-encrypted keychain (as in Advanced Data Protection). The server stores only wrapped keys and ciphertext.
- Metadata that must be searchable (captions, faces, locations) is encrypted too. Search and ML (face grouping, object detection) run **on device**, which is Apple's approach.

**Server architecture:**
1. **Metadata service:** per-library **records** (the CloudKit model): asset id, wrapped keys, encrypted metadata, a pointer to the blob, and version. It's stored in a strongly consistent, sharded database keyed by user or library (CloudKit is backed by Cassandra and FoundationDB). Each library has a **change log** with a monotonically increasing change token, which is the sync cursor.
2. **Blob service:** encrypted chunks stored in object storage (Apple uses its own and third-party clouds). Uploads are **resumable and chunked** (e.g. 4–16 MB chunks, retried individually), with presigned or tokenised URLs so bytes bypass the metadata tier.
3. **Sync protocol:** a device calls \`fetchChanges(sinceToken)\` for records changed since its last token, then downloads blobs lazily (thumbnails eagerly, originals on demand if storage is optimised). A push notification (via APNs) tells devices "your library changed", which triggers the fetch.
4. **Edits** are stored as adjustment data (a small encrypted record) plus an optional rendered derivative, so originals are never modified. Deletes move a record to "recently deleted" with a 30-day TTL before blobs are garbage-collected.

**Dedup** happens only within the account (convergent encryption across users would leak information), using a keyed hash of the plaintext computed on the device, so identical re-uploads are skipped.`,
    deepDives: [
      {
        topic: "Conflicts without seeing the content",
        discussion: `The server can't merge encrypted content, so conflict detection relies on **record versions** (the record change tag). A device modifies a record with the version it last saw; if the server's version differs, it returns a conflict error with the server's record, and the device resolves it locally (it can decrypt both). For photos, most conflicts are simple: edits are adjustment stacks, and a later edit (by device timestamp) wins, with the other kept as history. Favourites and album membership are CRDT-like sets merged by union and removal tombstones. Deletes win over edits for 30 days, and recovery restores them. The server enforces ordering and atomicity per record, and the device does the semantic merge.`,
      },
      {
        topic: "Large videos and unreliable networks",
        discussion: `A 4K video may be 2 GB. Uploading it as one request on cellular would fail constantly. Chunked, resumable uploads split the file into chunks encrypted independently (per-chunk nonce, the same content key, and a manifest with chunk hashes). The device uploads missing chunks, retries each with backoff, and finally commits the manifest into the record in one metadata transaction. Background URLSession or discretionary scheduling lets the OS upload when on Wi-Fi and charging, which matters for battery. Downloads use range requests per chunk, and thumbnails and previews are separate small blobs, so browsing never waits for originals. Unreferenced chunks from abandoned uploads are garbage-collected after ~24 h.`,
      },
      {
        topic: "Key recovery and shared libraries",
        discussion: `Pure E2E means that if a user loses all their devices and has no recovery key, the data is unrecoverable. The product therefore offers recovery contacts or a recovery key, and with standard (non-ADP) protection, keys are escrowed in HSMs. Be explicit about that trade-off. For a **shared library**, the library key is wrapped separately for each participant's public key, and adding a member means wrapping the library key for them. Removing one means **rotating** the library key and re-wrapping it for the remaining members. New content uses the new key, and old content is either re-encrypted (expensive) or accepted as previously shared. Key operations are logged in an append-only, signed membership log that devices verify.`,
      },
    ],
    tradeoffs: [
      "E2E encryption removes server-side search and ML, so that work moves on-device at the cost of battery and compute",
      "Dedup only within an account: cross-user dedup would save storage but leak content equality",
      "Optimised storage saves device space but adds download latency for originals",
      "Record-version conflicts are simple and server-enforced, but put the merge logic on every client platform",
      "Key escrow enables recovery but weakens the guarantee; offering both modes (standard vs ADP) is a product decision",
    ],
    followUps: [
      { q: "How does a brand-new Mac get the keys?", a: "The new device joins the trust circle, approved by an existing device or a recovery method. Existing devices wrap the library keys to its public key via the E2E keychain, and then it can decrypt records." },
      { q: "How do you sync 100K photos to a new device quickly?", a: "Fetch records in pages via change tokens, download thumbnails and previews first (small blobs, highly parallel), and load originals lazily in the background, prioritised by recency." },
      { q: "What does the server still learn?", a: "Account id, sizes, timestamps, counts and access patterns. Minimise it further with padding and coarse timestamps. Be upfront that metadata privacy is weaker than content privacy." },
    ],
    relatedTopics: ["design-storage", "object-storage", "security-general", "api-security", "ds-consistency", "net-realtime"],
  },
  // ---------------------------------------------------------------- Netflix
  {
    id: "co-netflix-1",
    company: "netflix",
    title: "Design Continue Watching (playback position and viewing history)",
    frequency: "high",
    level: "Senior / L5",
    prompt:
      "Design the service that records where each member stopped watching every title and powers the Continue Watching row and viewing history across all devices, for 250M+ members.",
    clarifyingQuestions: [
      "How often do clients report position: every 10–30 s, and on pause or stop?",
      "Cross-device resume: how fresh must the position be when switching from TV to phone (within seconds)?",
      "Is history per profile, and how long is it kept?",
      "Does Continue Watching need ranking (recency, likelihood to resume), or just recency?",
      "What does resume mean for episodes: next episode after finishing, credits detection?",
    ],
    functional: [
      "Record playback position per (profile, title/episode) with periodic heartbeats",
      "Resume from the last position on any device",
      "Continue Watching row: in-progress titles ordered by recency/relevance",
      "Full viewing history (per profile), including removal of items by the user",
    ],
    nonFunctional: [
      "Write-heavy: millions of heartbeats per second at peak evening hours",
      "Cross-device read-your-writes within a few seconds",
      "Highly available and multi-region active-active; heartbeat loss is tolerable, history loss is not",
      "Low-latency reads (<50 ms) since resume is on the playback critical path",
    ],
    estimation: [
      { label: "Concurrent streams", calc: "Peak ~40M concurrent streams globally" },
      { label: "Heartbeat writes", calc: "One heartbeat per 30 s → 40M ÷ 30 ≈ 1.3M writes/s" },
      { label: "History storage", calc: "250M members × 3 profiles × ~2,000 history entries × 100 B ≈ 150 TB (Netflix compresses older history)" },
      { label: "Latest-position working set", calc: "Active in-progress items ~250M × 3 × 20 in progress × 50 B ≈ 750 GB → sharded cache + Cassandra" },
    ],
    highLevelDesign: `**Two data shapes with different access patterns:**
1. **Latest position per (profile, video):** high-frequency overwrites, read on resume and for the row.
2. **Viewing history:** an append-mostly log of sessions (title, start and end time, device, % watched), read for the history page, recommendations and analytics.

**Write path:** player clients send heartbeats (\`POST /playback/position {profileId, videoId, positionMs, sessionId, ts}\`) every 30 s and on pause, seek or stop. The **playback events gateway** (stateless, per region) validates them and writes to **Kafka** (partitioned by profileId) and to the **position store** synchronously (the latest-write-wins row). History consumers aggregate heartbeats into sessions.

**Position store:** Cassandra (Netflix's core OLTP store), with partition key = profileId and clustering = videoId. Each heartbeat is an upsert with a client timestamp as the write time (\`USING TIMESTAMP\`), so out-of-order heartbeats can't regress the position. In front of it sits **EVCache** (Netflix's memcached-based cache), write-through, keyed by profileId, holding the Continue Watching list.

**History store:** Netflix's published design uses Cassandra with a **live** table (recent, uncompressed, per-row entries) and a **compressed** table (older history per profile as compressed blobs, chunked when large). This cut storage and read latency for heavy users.

**Continue Watching row:** a service reads in-progress items (position between ~5% and ~95%, or the next episode for series), joins them with titles metadata, and ranks by recency or a personalisation model. It's cached per profile and invalidated on heartbeats.

**Multi-region:** Cassandra replicates across 3–4 AWS regions (asynchronously, with LOCAL_QUORUM writes), so a member switching devices in the same region reads their own write. Cross-region traffic shifts during a failover may show a slightly older position, which is acceptable.`,
    diagram: `Players (TV, phone, web) ── heartbeat /30s, pause, stop ──► Events gateway
                                                            │        │
                                       upsert (USING TIMESTAMP)      │ Kafka
                                                            ▼        ▼
                           EVCache (write-through) ◄─ Position store (Cassandra,
                                  │                   profile → video → pos)
                                  ▼                          History aggregator
                    Continue Watching svc     (sessions) → History store
                                  │                          (live + compressed)
                                  ▼
                         Homepage / resume API        Recs/analytics ← Kafka`,
    deepDives: [
      {
        topic: "Out-of-order and conflicting heartbeats",
        discussion: `Two devices can play the same title (a TV and a phone on the same profile), heartbeats can arrive late after a client reconnects, and the network can reorder them. Upserting with the client event timestamp as Cassandra's write timestamp makes the newest *event* win regardless of arrival order, which is last-write-wins by event time. Clock skew on cheap TVs can break this, so the gateway clamps client timestamps to server time ± a tolerance and includes a per-session sequence number. A seek backwards is a legitimate newer event (the user rewound) and correctly wins. For history we don't overwrite: sessions are appended, and dedup uses sessionId.`,
      },
      {
        topic: "Scaling 1.3M writes/s cheaply",
        discussion: `Cassandra handles high write rates well (LSM trees, ~10–30K writes/s per node for small rows), so ~100–150 nodes per region cover heartbeats with replication. Further savings: the client sends heartbeats less often when nothing changed (paused playback only needs one), and the gateway coalesces per session in memory for a few seconds before writing, since only the latest position matters. The trade is a few seconds of possible loss if the gateway dies, which is acceptable. TTL is not used on the position rows, because resuming a show months later is a feature. Compaction strategy: LeveledCompaction for read-heavy position lookups, TimeWindowCompaction for time-series history.`,
      },
      {
        topic: "Resilience and graceful degradation",
        discussion: `Resume is on the playback path, but it shouldn't block playback. If the position service is slow (a >50 ms budget with Hystrix/resilience4j-style timeouts), the player starts from the locally cached position (the device remembers its own last position) or from the beginning with a "resume" prompt when data arrives. The Continue Watching row degrades to a cached copy or a generic row. Heartbeat writes are fire-and-forget from the player's point of view, with a client-side retry queue. Netflix practises this with chaos testing: kill a Cassandra region, fail EVCache, and verify that members can still press play. Say that explicitly for Netflix.`,
      },
    ],
    tradeoffs: [
      "LWW by event time is simple and fits the product, but relies on bounded clock skew",
      "Coalescing heartbeats cuts write load but risks losing the last few seconds",
      "Live + compressed history tables save storage and speed reads for heavy users, but add a background compaction job",
      "Async multi-region replication gives availability and low latency but may show a slightly stale position after a region failover",
    ],
    followUps: [
      { q: "How do you decide when an episode is finished and show the next one?", a: "Use the credits start marker (per title metadata) or a watched percentage over ~95%, then advance the in-progress pointer to the next episode at position 0 for the Continue Watching row." },
      { q: "A user removes a title from Continue Watching. How do you persist that?", a: "Write a hide flag or tombstone for (profile, video) that the row service filters on, and clear it if they start watching again." },
      { q: "How do analytics and recommendations use this data without loading the store?", a: "They consume the Kafka stream into the data warehouse (S3/Iceberg) and feature stores, and never query the OLTP Cassandra cluster." },
    ],
    relatedTopics: ["db-fundamentals", "db-replication", "cache-fundamentals", "mq-fundamentals", "rel-patterns", "design-social"],
  },
  {
    id: "co-netflix-2",
    company: "netflix",
    title: "Design the video ingest, encoding and CDN pre-positioning pipeline",
    frequency: "medium",
    level: "Senior / L5–L6",
    prompt:
      "Design the pipeline that takes a studio's master file for a new title, encodes it into all device formats and bitrates, and gets it onto edge caches worldwide before the global launch at 00:00 PT.",
    clarifyingQuestions: [
      "Input size: a 4K HDR master is ~500 GB–1 TB per hour of content?",
      "How many output renditions (codecs x resolutions x bitrates x audio/subtitle tracks)?",
      "Deadline: how long between the master arriving and launch (days vs hours)?",
      "Quality targets: per-title or per-shot encoding optimisation?",
      "DRM requirements (Widevine, FairPlay, PlayReady)?",
    ],
    functional: [
      "Ingest and validate studio masters (checksums, format checks, QC)",
      "Encode into many renditions (AVC, HEVC, VP9, AV1; SD to 4K; HDR), audio and subtitles",
      "Package (DASH/HLS/CMAF) and encrypt with DRM",
      "Distribute to CDN edge caches before launch; serve manifests to players",
    ],
    nonFunctional: [
      "Massive parallelism: finish a full season in hours",
      "Fault tolerant: resume failed chunks, never re-encode everything",
      "Cost efficient (spot/preemptible compute, off-peak prefill)",
      "Launch-day hit ratio close to 100% at the edge for the new title",
    ],
    estimation: [
      { label: "Renditions", calc: "~6 codecs/profiles × ~8 resolutions/bitrates ≈ 50 video streams + ~20 audio + ~30 subtitle tracks per title" },
      { label: "Compute", calc: "1 hour of 4K content with AV1 at ~1 fps per core-slot ≈ 86,400 frames per rendition ÷ 1 fps ≈ 24 core-hours × 50 ≈ 1,200 core-hours per hour of content → a 10-episode season ≈ 12K core-hours → parallelised over 10K cores ≈ 1–2 hours" },
      { label: "Output bytes", calc: "All renditions ≈ 3–5× the top bitrate stream; ~20 GB per hour of content in total → season ≈ 200 GB" },
      { label: "Edge prefill", calc: "~18K Open Connect appliances; a popular title's top renditions ≈ 100 GB × 18K ≈ 1.8 PB pushed off-peak over a few nights" },
    ],
    highLevelDesign: `**1. Ingest:** studios upload masters to a secure ingest endpoint (accelerated transfer to S3). A validation service checks checksums, container and codec compliance and audio sync. Automated plus human QC flags defects before encoding.

**2. Chunked encoding (the parallelism trick):** the master is split into **chunks at shot boundaries** (scene detection, a few seconds to a minute each). Each (chunk × rendition) is an independent encoding task: that's thousands of tasks per title, run on a workflow engine (Netflix built Cosmos/Conductor) over a large compute pool using spare capacity. Chunks are then **assembled** per rendition. A failed task retries only that chunk.

**3. Per-title / per-shot optimisation:** instead of a fixed bitrate ladder, encode trial renditions and measure quality with **VMAF**, then choose the ladder (resolution/bitrate pairs) per title or even per shot. Animation needs far fewer bits than grainy action, which saves 20–50% bandwidth at equal quality.

**4. Packaging and DRM:** fragment into CMAF segments, generate DASH/HLS manifests, and encrypt with per-title content keys (common encryption, CENC), with license servers for Widevine, PlayReady and FairPlay.

**5. Distribution to Open Connect:** Netflix's own CDN appliances sit inside ISPs and at IXPs. A **popularity forecast** decides which files go to which appliance. Files are **pushed during off-peak hours** (nightly fill windows) in a tiered way: storage appliances at IXPs get the full catalogue, and ISP-embedded flash appliances get the predicted-popular files. By launch, the top renditions of the new title are already at the edge.

**6. Playback steering:** at play time, the control plane on AWS returns a manifest with a ranked list of edge URLs (the closest healthy appliances that have the file). The player does adaptive bitrate selection over segments.`,
    diagram: `Studio master ─► Ingest (S3, checksums, QC)
                      │
                      ▼
               Shot detection + chunking
                      │  thousands of (chunk × rendition) tasks
                      ▼
    Workflow engine ─► Encoding workers (spot/spare capacity, retries)
                      │                     VMAF per-title ladder
                      ▼
               Assemble ─► Package (CMAF, DASH/HLS) ─► DRM encrypt
                      │
                      ▼
           Origin (S3) ─► Popularity forecast ─► nightly push to
                                   Open Connect appliances (IXP + ISP-embedded)
                      │
 Player ─► Control plane (AWS): manifest + ranked edge URLs ─► stream from edge`,
    deepDives: [
      {
        topic: "Chunked encoding and failure recovery",
        discussion: `Encoding a whole title serially would take days. Chunking at shot boundaries (so a chunk starts at an I-frame and no visual artefacts appear at joins) gives embarrassingly parallel tasks. The workflow engine tracks a DAG per title: validate → split → encode chunks → per-rendition assemble → package → publish. Each task is idempotent, writing output to a deterministic S3 key, so a retry just overwrites. Spot instances are fine because an interrupted task is simply retried, and checkpointing within a chunk isn't needed since chunks are short. Stragglers are handled with speculative duplicates for the slowest ~1% of tasks. Quality checks (VMAF against the source, artefact detection) run per rendition, and a failing rendition triggers re-encoding with different parameters, not the whole pipeline.`,
      },
      {
        topic: "Pre-positioning content with a popularity forecast",
        discussion: `An on-demand pull CDN would take a cache miss storm at 00:00 PT when millions press play. Netflix instead **proactively fills** its Open Connect appliances during each ISP's off-peak window (for example 2–8 AM local), using a forecast of views per region and title from historical similar launches, marketing signals and regional tastes. Files are ranked and placed by expected demand per byte, with the hottest renditions on flash appliances embedded in ISPs, and the catalogue on larger storage appliances at IXPs. At launch the steering service directs each play to an appliance that already holds the file. The cache-fill traffic uses otherwise idle capacity, and the peak-time hit ratio stays in the high 90s percent.`,
      },
      {
        topic: "Per-title and per-shot bitrate ladders",
        discussion: `A fixed ladder (e.g. 1080p at 5.8 Mbps) wastes bits on simple content and starves complex scenes. Per-title encoding runs trial encodes at several resolution/bitrate points, computes the convex hull of quality (VMAF) vs bitrate, and selects the ladder rungs on that hull. Per-shot ("dynamic optimizer") encoding goes further, choosing parameters per shot and stitching them together, which gives the same perceptual quality at 20–50% fewer bits. That translates directly into lower CDN egress, better quality on poor mobile networks in markets like India, and fewer rebuffers. The cost is extra compute at encode time, which is paid once per title and amortised over millions of views.`,
      },
    ],
    tradeoffs: [
      "Per-shot optimisation costs more compute once but saves bandwidth on every stream",
      "Push pre-positioning needs accurate forecasts; mistakes waste fill bandwidth or cause misses (pull fill covers the tail)",
      "Chunk size: smaller chunks increase parallelism but add assembly and boundary overhead",
      "Spot capacity is cheap but interruptible; the design must make tasks idempotent and short",
      "More codecs (AV1) mean better efficiency but more renditions to encode and store",
    ],
    followUps: [
      { q: "A last-minute fix to episode 3 arrives 6 hours before launch. What happens?", a: "Re-run only episode 3's DAG with high priority on reserved capacity, encoding just the affected chunks if the change is localised. Then publish a new manifest version and push the new files to the edge in a prioritised fill." },
      { q: "How do players pick bitrates?", a: "Adaptive bitrate: the player measures throughput and buffer level and picks the next segment's rendition from the ladder, switching down before the buffer drains." },
      { q: "How do you protect content from piracy?", a: "DRM with per-title keys and hardware-backed security levels for HD/4K, license policies per device, watermarking of pre-release content, and short-lived signed URLs." },
    ],
    relatedTopics: ["cdn-global", "object-storage", "data-pipelines", "deployment-infra", "design-infra", "prod-performance"],
  },
  // ---------------------------------------------------------------- Uber
  {
    id: "co-uber-1",
    company: "uber",
    title: "Design surge pricing",
    frequency: "very-high",
    level: "Senior SWE (L5a/L5b)",
    prompt:
      "Design the system that computes dynamic surge multipliers per small geographic area every minute from real-time supply and demand, and applies them consistently to rider price quotes.",
    clarifyingQuestions: [
      "What granularity of area (hexagon size) and update frequency (every 1–2 minutes)?",
      "How are demand and supply measured: app opens and price requests vs trip requests; idle drivers vs ETA?",
      "Must the price a rider saw be honoured when they request (price lock with an expiry)?",
      "Should the multiplier smooth across neighbouring areas to avoid sharp borders? Are there caps set by regulation?",
      "Per product (UberX, XL, Moto)?",
    ],
    functional: [
      "Ingest supply (driver locations and states) and demand (sessions, quote requests, trips) in real time",
      "Compute a surge multiplier per (hexagon, product) every ~1 minute",
      "Serve the multiplier in fare quotes with low latency; lock the quoted fare for a few minutes",
      "Show heatmaps to drivers; audit trail of every multiplier",
    ],
    nonFunctional: [
      "Quote path latency under 50 ms for the surge lookup",
      "Freshness: multipliers under 2 minutes old",
      "Consistency: a rider's accepted quote is honoured; no flip-flopping",
      "Explainable and auditable (regulatory scrutiny); safe fallbacks (no surge) on failure",
    ],
    estimation: [
      { label: "Driver pings", calc: "5M online drivers at peak × 1 ping / 4 s ≈ 1.25M location events/s" },
      { label: "Demand events", calc: "~30M app sessions/hour at peak with ~3 price views each ≈ 25K quote events/s" },
      { label: "Hexagons", calc: "~10,000 cities/areas; H3 resolution 8 hex ≈ 0.74 km²; active hexes worldwide ≈ 1–2M" },
      { label: "Computation", calc: "2M hexes × 5 products every 60 s ≈ 170K multiplier computations/s → a streaming job easily handles it" },
    ],
    highLevelDesign: `**Spatial index:** Uber's **H3** hexagonal grid. Every driver ping and rider request is mapped to an H3 cell (res 7–9, depending on the city's density). Hexagons have uniform neighbours, which makes smoothing easy.

**Pipeline:**
1. **Ingestion:** driver location and state events (online, open, en route, on trip) and demand events (app open with pickup location, quote requested, trip requested, and unfulfilled or cancelled requests) are published to **Kafka**, keyed by city.
2. **Stream aggregation (Flink):** per (hex, product) over sliding windows (e.g. the last 2–5 minutes, updated every minute) it computes the **supply** of available drivers and ETA-weighted supply from neighbouring hexes, and **demand** from quote requests and conversion-weighted opens.
3. **Pricing model service:** multiplier = f(demand/supply ratio, historical elasticity, time of day, events) using a pricing model (historically a function curve, now ML-driven). Then **smooth spatially** (blend with k-ring neighbours to avoid a 1.0 vs 2.5 border) and **temporally** (limit the change per interval, with hysteresis), and apply caps (regulatory, emergencies).
4. **Surge store:** the result (hex, product → multiplier, version, computedAt) goes to a low-latency replicated KV (Redis, or Uber's Docstore) per region, and also to Kafka and the data lake for audit.
5. **Quote path:** the fare service computes base fare + distance + time × multiplier of the **pickup hex**. It returns a **fare quote id** (signed, with an expiry of ~2–5 minutes) that stores the multiplier used. Trip request references the quote id, so the rider pays what they saw.

**Fallbacks:** if the multipliers are stale (older than 5 minutes) or the store is unavailable, return 1.0 (no surge) and alert. Business prefers under-charging to wrong over-charging.`,
    diagram: `Driver app pings ─┐                  ┌─► Driver heatmap API
Rider opens/quotes ┼──► Kafka (by city) ┼
Trip events ───────┘         │          └─► Data lake (audit)
                             ▼
               Flink: map to H3 cells, sliding windows
               supply(hex,product), demand(hex,product)
                             │
                             ▼
               Pricing model: ratio → multiplier, spatial/temporal
               smoothing, caps, hysteresis
                             │ versioned per minute
                             ▼
                Surge KV (regional, replicated)
                             │  lookup < 5 ms
                             ▼
   Rider ─► Fare svc ─► signed quote (multiplier locked 2–5 min) ─► Trip`,
    deepDives: [
      {
        topic: "Measuring supply and demand correctly",
        discussion: `Naive counts are misleading. **Supply** should count drivers who can actually serve the hex soon: idle drivers in the hex plus drivers in neighbouring hexes weighted by ETA, and drivers about to drop off nearby (predicted from trip state). **Demand** should include *intent*: app opens and quote views with the pickup location, not only requested trips, because at high surge people stop requesting (demand hides). Unfulfilled requests and cancellations signal shortage. Windows of 2–5 minutes balance noise against responsiveness. Small sparse hexes are noisy, so fall back to a coarser H3 resolution when counts are low. That's one reason H3's hierarchy is useful.`,
      },
      {
        topic: "Stability: smoothing, hysteresis and price locks",
        discussion: `A multiplier jumping 1.0 → 2.3 → 1.2 in three minutes erodes trust and creates driver herding (everyone chases the red hex, then it collapses). Controls: **temporal smoothing** (an exponential moving average, with max change per interval), **hysteresis** (require the ratio to stay above a threshold for 2 intervals before raising the price), and **spatial smoothing** (a weighted average with k-ring neighbours). For riders, the **upfront price** is locked in a signed quote that the trip service honours, so recomputation never changes a price the rider already accepted. Every multiplier version is stored with its inputs for audit and dispute resolution, which is important for regulators.`,
      },
      {
        topic: "Serving at low latency and failure modes",
        discussion: `The fare service runs in every region and must not call a remote region for surge. Multipliers for a city are small (a few thousand hexes × products), so each fare-service instance can keep an **in-memory copy per city**, refreshed from the regional KV or pushed via a stream every minute. A lookup is then a hash-map read. Staleness is tracked by version and timestamp. If stale beyond the threshold, the fare service falls back to 1.0 and emits alerts. If the Flink job lags, stop publishing rather than publishing stale data. The model service is deployed with shadow mode and canaries per city, since a bad model can mis-price a whole market.`,
      },
    ],
    tradeoffs: [
      "Finer hexes react to local demand but are noisy; coarser hexes are stable but blunt",
      "Short windows are responsive but jittery; longer windows are stable but slow to react to a concert ending",
      "Pushing multipliers into fare-service memory is fastest, at the cost of up to ~1 minute of staleness",
      "Fallback to no surge is safe for riders but may worsen supply shortages during failures",
      "Rule-based curves are explainable; ML models are more accurate but need auditability",
    ],
    followUps: [
      { q: "How would you evaluate a new pricing model?", a: "Offline replay on historical supply and demand, then city-level switchback experiments (alternating time slices) rather than user-level A/B tests, because marketplace effects spill between users." },
      { q: "How do drivers see where surge is?", a: "The driver app shows a heatmap from the same surge KV, updated every minute. Some marketplaces show a guaranteed bonus instead of a multiplier to reduce herding." },
      { q: "What if a region's Kafka cluster is down?", a: "The surge pipeline stops producing fresh values, so the fare service falls back to 1.0 after the staleness threshold. The trip flow is unaffected." },
    ],
    relatedTopics: ["design-geo", "data-pipelines", "mq-scenarios", "cache-fundamentals", "rel-patterns", "prod-correctness-ops"],
  },
  {
    id: "co-uber-2",
    company: "uber",
    title: "Design driver location ingestion and nearby-driver dispatch",
    frequency: "very-high",
    level: "Senior SWE",
    prompt:
      "Design the system that ingests live GPS from millions of drivers and, when a rider requests a trip, finds and offers the trip to the best nearby driver within a couple of seconds.",
    clarifyingQuestions: [
      "How often do drivers send location (every 4 s)? What accuracy?",
      "Is best nearest by straight line or by ETA on the road network?",
      "Offer flow: one driver at a time with a 15 s timeout, or broadcast to several?",
      "Constraints: product type, vehicle capacity, driver rating, pooling?",
      "Scale: 5M drivers online, ~1M trip requests per minute at peak globally?",
    ],
    functional: [
      "Ingest driver locations and states (available, dispatched, on trip)",
      "For a trip request, find candidate drivers near the pickup and rank them by ETA",
      "Offer to a driver; handle accept, decline or timeout and move to the next",
      "Guarantee one trip per driver at a time (no double dispatch)",
    ],
    nonFunctional: [
      "Match within ~2 s p95 (excluding driver response time)",
      "Handle 1.25M location updates/s; location freshness within ~5 s",
      "City-level isolation and high availability; degrade gracefully",
      "Strong consistency for driver assignment (a driver is dispatched to one trip only)",
    ],
    estimation: [
      { label: "Location writes", calc: "5M drivers ÷ 4 s ≈ 1.25M updates/s" },
      { label: "Index memory", calc: "5M × ~100 B (driverId, lat/lng, cell, state, ts) ≈ 500 MB → fits in memory per region, sharded by city" },
      { label: "Dispatch requests", calc: "~20M trips/day, peak ~1K requests/s per large city, ~15K/s globally" },
      { label: "ETA calls", calc: "Each request ranks ~20 candidates by road ETA → 300K ETA computations/s globally → a dedicated routing service with caches" },
    ],
    highLevelDesign: `**Location ingestion:** driver apps send \`{driverId, lat, lng, heading, speed, state, ts}\` every 4 s over a persistent connection (or HTTPS) to regional **location gateways**, which publish to **Kafka** (keyed by city, then driverId). Consumers update the **geospatial index** and write a sampled trace to storage for trip receipts and analytics.

**Geospatial index (in memory, sharded by city):** map each position to an **H3 cell** (res 9, ~0.1 km², or a geohash). Keep \`cell → set(available driverIds)\` and \`driverId → {cell, lat/lng, state, ts}\`. An update moves the driver between cell sets if the cell changed. Uber's earlier dispatch system (DISCO) used Google S2 cells with a consistent-hash ring (Ringpop) sharding across nodes. Stale entries (no ping for 30 s) are evicted.

**Dispatch flow:**
1. The rider requests (a signed quote id). The **dispatch service** for the city takes the pickup location's cell and queries a **k-ring** of neighbouring cells (expanding rings until ~20 candidates are found or a radius cap is hit).
2. It filters by product, state=available, and constraints. The **ETA service** (road-network routing with traffic, via contraction hierarchies and caching) ranks the candidates.
3. It offers to the best driver: an **atomic reservation** of the driver (a compare-and-set on the driver state available → offered, with an offer id and a 15 s expiry) in the driver-state store. Only then is the offer pushed to the app.
4. On accept: CAS offered → dispatched and the trip moves to assigned. On decline or timeout: release the driver and offer to the next candidate. Batched matching optimises globally: every ~2 s, collect all requests and available drivers in an area and solve an assignment problem to minimise total ETA (Uber does this).

**Consistency:** the driver-state store (sharded by driverId with linearizable CAS, e.g. Redis with Lua, or a strongly consistent KV) is the single authority for "is this driver free?". The location index is eventually consistent (seconds).`,
    diagram: `Driver apps ── GPS /4s ──► Location gateways ─► Kafka (city, driverId)
                                                   │
                                ┌──────────────────┼────────────────┐
                                ▼                  ▼                ▼
                      Geo index (per city,   Trace store      Surge/analytics
                      H3 cell → drivers)     (receipts)
                                ▲ k-ring query
Rider request ─► Dispatch svc ──┘──► ETA service (road graph + traffic)
                      │ CAS available→offered (15 s expiry)
                      ▼
                Driver-state store ──► push offer to driver app
                      │ accept → dispatched → Trip service`,
    deepDives: [
      {
        topic: "Why cells (H3/S2/geohash) instead of a quadtree or DB radius query",
        discussion: `With 1.25M updates/s, the index must support very cheap moves. Cells are just hash keys: a move is "remove from set A, add to set B", which is O(1), and most updates don't even change cell. A nearby query is a fixed set of neighbouring cells (the k-ring), independent of the total number of drivers. Quadtrees adapt to density but need rebalancing under constant movement. A DB with a spatial index (PostGIS) can't absorb 1M writes/s cheaply. Hexagons (H3) are preferred over squares because all 6 neighbours are equidistant, which makes rings closer to circles and smoothing easier. Sharding by city keeps queries local and gives failure isolation. Big metros can be sub-sharded by cell ranges.`,
      },
      {
        topic: "Preventing double dispatch",
        discussion: `Two riders' dispatch attempts can pick the same nearest driver within milliseconds. The fix is a single-authority reservation: \`CAS driver:{id}.state from AVAILABLE to OFFERED(offerId, expiresAt)\`. Only the winner sends the offer, and the loser moves to its next candidate. The offer carries its offerId, and the driver's accept must present it, so a late accept of an expired offer is rejected. Expiry is enforced by the state store (a lazy check at the next CAS, or a timer). Because trip assignment is money- and safety-critical, this store must be strongly consistent per driver (single leader per shard, or a Lua script in Redis with AOF and replicas), while locations can be eventually consistent.`,
      },
      {
        topic: "Greedy vs batched matching",
        discussion: `Greedy (the nearest available driver for each request as it arrives) is simple and fast but globally suboptimal. Two requests near each other may both be served poorly when a smarter swap would cut total pickup time. **Batched matching** collects requests and available drivers in a city zone over a short window (1–2 s), builds a bipartite graph with ETA edge weights, and solves the assignment (Hungarian algorithm, or min-cost flow and heuristics at scale). This reduces average ETA noticeably in dense markets and adds ~1–2 s of latency. Mention the trade-off and that Uber uses batched matching in busy areas, with a fallback to greedy when the batch solver is slow.`,
      },
    ],
    tradeoffs: [
      "Update frequency: every 4 s gives fresh positions but costs battery, data and 1.25M writes/s; adaptive rates help (slower when stationary)",
      "Straight-line vs road ETA: straight-line is cheap but wrong across rivers and one-ways; ETA needs a routing service",
      "Greedy vs batched assignment: latency vs global efficiency",
      "In-memory index per city is fast but must be rebuilt from Kafka and driver pings after failover",
      "Offer to one driver at a time is fair and simple but slower; broadcast is fast but causes contention",
    ],
    followUps: [
      { q: "A city shard node crashes. How quickly do you recover?", a: "A replica takes over the city's index, or rebuilds it from the Kafka stream: within ~4–8 s every active driver has pinged again. Dispatch retries after a short degradation." },
      { q: "How do you handle GPS noise and tunnels?", a: "Map-match to the road network (snap to the likely road), apply Kalman filtering for noisy points, and dead-reckon using speed and heading when pings are missing." },
      { q: "How does pooling change matching?", a: "Candidates include drivers on trips with seats and compatible routes. Scoring adds detour costs for existing riders, and it's a much larger search solved within batches." },
    ],
    relatedTopics: ["design-geo", "ds-concurrency", "mq-fundamentals", "net-realtime", "db-sharding", "rel-patterns"],
  },
  // ---------------------------------------------------------------- Airbnb
  {
    id: "co-airbnb-1",
    company: "airbnb",
    title: "Design listing search with date availability and pricing",
    frequency: "high",
    level: "Senior / Staff",
    prompt:
      "Design Airbnb search: a guest enters a location, dates and number of guests, and gets ranked available listings with total prices, from ~8M listings with frequently changing calendars.",
    clarifyingQuestions: [
      "What filters: location (map bounds or city), dates, guests, price range, amenities, instant book?",
      "How fresh must availability be: can a just-booked listing appear briefly in results?",
      "Is pricing dynamic per night (host pricing tools, discounts for weekly stays)?",
      "Map-based search with panning? Results count and pagination?",
      "What latency target, e.g. p95 under 400 ms?",
    ],
    functional: [
      "Search by location (bounding box or polygon), date range, guest count and filters",
      "Return only listings available for every night in the range, with the total price",
      "Rank results (relevance, quality, conversion likelihood, personalisation)",
      "Map view with pins; pagination",
    ],
    nonFunctional: [
      "p95 latency under 400 ms",
      "Availability freshness within ~1 minute; final check at booking time",
      "Read-heavy: ~100K search QPS at peak; calendar updates ~10K/s",
      "Graceful degradation (drop personalisation before dropping results)",
    ],
    estimation: [
      { label: "Search QPS", calc: "~150M searches/day, peak ×3 ≈ 5K QPS average → ~15K peak (map pans multiply it → budget 50–100K QPS)" },
      { label: "Calendar data", calc: "8M listings × 365 nights × (1 bit availability + 4 B price) ≈ 8M × 1.5 KB ≈ 12 GB → fits in memory across the search cluster" },
      { label: "Calendar updates", calc: "Bookings + host edits + iCal syncs ≈ 1B night-changes/day ≈ 12K/s" },
      { label: "Candidate set", calc: "A big city has ~50K listings; after geo + guests filters ~10K; after availability ~3K → rank the top 500 with the ML model" },
    ],
    highLevelDesign: `**Two systems:** the **source of truth** (the listing and calendar services with relational DBs, used for booking) and a **search index** optimised for retrieval, which is eventually consistent via CDC.

**Search index design:** each listing document holds static attributes (location as lat/lng, geohash or S2 cell, capacity, amenities, quality scores) and an **availability bitmap** of 365–730 bits (one per night) plus a per-night price array. It's sharded geographically (by S2/H3 cell ranges) or by listing id with geo filtering. Airbnb built search on Lucene/Elasticsearch-style infrastructure with custom plugins.

**Query flow:**
1. **Geo retrieval:** the bounding box → the covering cells → candidate listings (thousands).
2. **Filters:** guests ≤ capacity, and amenities as inverted-index filters.
3. **Availability:** for dates [d1, d2), check that the bitmap's bits d1..d2−1 are all 1, using bitwise AND with a mask (microseconds per listing). Minimum-stay and check-in-day rules are stored alongside.
4. **Pricing:** the sum of nightly prices + cleaning fee + weekly discount, computed per candidate in the index plugin.
5. **Ranking:** the top ~1,000 by a cheap score go to a **learned ranking model** (Airbnb publishes on deep learning for search ranking) using listing, query and guest features from a feature store, then the top 500 are re-ranked for diversity (not every result from one host or neighbourhood).
6. **Return** results with total prices and map pins.

**Freshness:** calendar changes are published (CDC/Kafka) to indexers, which update the bitmap in place (a partial update) within seconds. **Booking re-validates** availability transactionally in the calendar service, so a stale search result can at worst produce "just booked, pick another listing".

**Caching:** popular query fragments (city + dates) are cached for 30–60 s, and the map-tile pin density is precomputed.`,
    diagram: `Guest ─► Search API ─► Query planner (geo cells, filters, dates)
                             │ scatter to geo shards
                ┌────────────┼────────────┐
                ▼            ▼            ▼
           Index shard   Index shard   Index shard  (listing docs +
           (geo filter → availability bitmap AND → price sum → cheap score)
                └────────────┼────────────┘
                             ▼
               Ranker (ML, feature store) → diversity re-rank → results
Hosts/bookings ─► Calendar svc (SQL, source of truth) ─► CDC/Kafka ─► indexers
Booking flow ───► re-check availability transactionally at book time`,
    deepDives: [
      {
        topic: "Availability bitmap and date-range checks",
        discussion: `Storing the calendar as rows (listing, date, available) and joining at query time is too slow for thousands of candidates. A per-listing bitmap (bit i = night i from a base date) makes a stay check a mask-and-compare: \`(bitmap >> start) & ((1 << nights) − 1) == all ones\`, done 64 nights at a time with machine words. Rules such as minimum nights, no check-in on Sundays, and gap-night restrictions are encoded as additional small bitmaps or rule parameters evaluated in the same pass. The base date rolls daily (shift the bitmaps). Updates are tiny partial writes, so a booking flips 3–7 bits. This is how the index can answer "available 12–15 Oct for 4 guests" over 10K candidates in a few ms.`,
      },
      {
        topic: "Consistency between search and booking",
        discussion: `Search is eventually consistent (seconds behind), and booking must be strongly consistent. At booking, the calendar service does a transactional check-and-reserve for all nights (rows per night with a unique constraint on (listing, night) in the reservation table, or a conditional update), which prevents double booking even under concurrency. Search staleness appears as a rare "no longer available" error at checkout. We reduce it by pushing booking events to the index immediately (a priority lane) and by re-checking availability for the top results just before rendering the listing page (a cheap point lookup). External calendars (hosts listing on multiple platforms via iCal) sync periodically, which is a known source of double bookings, handled by host policies.`,
      },
      {
        topic: "Ranking and personalisation",
        discussion: `Retrieval returns thousands of available listings, and ranking decides conversion. A cheap first-stage score (quality, price competitiveness, distance to the map centre) trims to ~1,000. Then a neural ranker (Airbnb's KDD papers) scores booking likelihood using listing features (reviews, photos quality, response rate), query features (dates, trip length, guests) and guest features (past bookings, price affinity, embedding similarity of listings they clicked). Listing embeddings trained on session co-clicks capture similarity. Business constraints include host fairness (new listings get exposure), diversity across neighbourhoods and price points, and legal regulation (license requirements per city). If the ranker times out, fall back to the first-stage order. That's graceful degradation.`,
      },
    ],
    tradeoffs: [
      "Index bitmaps make date queries fast but require CDC freshness and a final check at booking",
      "Geo-sharding keeps queries local but creates hot shards for big cities; sub-shard dense areas",
      "Heavier ML ranking improves conversion at a latency cost; use a two-stage ranker",
      "Short-TTL query caching reduces load but can show just-booked listings",
      "Precomputing total prices for common stay lengths speeds queries but multiplies index size",
    ],
    followUps: [
      { q: "How do you handle flexible dates (\"any weekend in October\")?", a: "Evaluate several date masks per listing in the same pass (bitmaps make this cheap) and return the best option per listing, or group results by date option." },
      { q: "How would you support a price-range filter with dynamic nightly prices?", a: "Compute the total per candidate during the scan (sum of the night price array) and filter afterwards. Pre-aggregated price bands per listing help prune candidates early." },
      { q: "A city gets 10× search traffic (a festival). What do you do?", a: "Add replicas for that city's shards, raise query-cache hit rates by normalising queries, and temporarily shed personalisation features." },
    ],
    relatedTopics: ["search-systems", "design-geo", "design-commerce", "cache-fundamentals", "db-indexing", "data-pipelines"],
  },
  {
    id: "co-airbnb-2",
    company: "airbnb",
    title: "Design host payouts: multi-currency, split and delayed payments",
    frequency: "medium",
    level: "Senior / Staff",
    prompt:
      "Design the system that collects guest payments at booking, holds funds, and pays hosts (and co-hosts) 24 hours after check-in in their chosen currency and payout method across 190+ countries.",
    clarifyingQuestions: [
      "When is the guest charged: at booking, or partly later (pay-less-upfront)? When does the host get paid?",
      "Which payout methods: bank transfer, PayPal, Payoneer? What are the FX rules (rate locked at booking vs at payout)?",
      "Splits: co-hosts, service fees, taxes (VAT, occupancy tax) remitted to governments?",
      "Cancellations and refunds after payout: how are they recovered?",
      "Volumes: ~1.5M nights booked per day?",
    ],
    functional: [
      "Charge the guest (PSP) at booking; hold funds",
      "Schedule payout release 24 h after check-in; split between host, co-hosts, platform fees and taxes",
      "Convert currency and execute payouts via local rails; handle failures and returns",
      "Refunds, cancellations and adjustments (resolution centre) with a clawback from future payouts",
    ],
    nonFunctional: [
      "Money correctness: double-entry ledger, idempotent operations, full audit",
      "Timeliness: payouts released on schedule; SLA per payout method",
      "Compliance: KYC for hosts, sanctions screening, tax reporting (1099-K etc.)",
      "Resilience to PSP and bank outages with retries and alternate rails",
    ],
    estimation: [
      { label: "Bookings", calc: "~1.5M nights/day ≈ 500K reservations/day ≈ 6 bookings/s average, peak ~50/s" },
      { label: "Payouts", calc: "~500K payout line items/day, batched per host per day → ~300K payout transfers/day" },
      { label: "Ledger entries", calc: "~10 entries per reservation lifecycle (charge, fees, tax, FX, payout) → 5M entries/day → ~2B/year" },
      { label: "Scheduler", calc: "Release events keyed by check-in time: ~500K/day with peaks at local check-in hours ≈ trivial QPS but must be exact" },
    ],
    highLevelDesign: `**Core principle:** every money movement is a **double-entry ledger** transaction, and every external action (charge, payout) is an idempotent, state-machine-driven operation. Airbnb has written about moving payments to a service-oriented architecture with an event-sourced ledger.

**Flow:**
1. **Booking and charge:** the reservation service calls the payments service with an idempotency key (reservationId + charge type). Payments calls the PSP (Adyen/Braintree/local providers), and on success posts to the ledger: debit guest receivable, credit **funds held (liability to host)**, credit service fee revenue, and credit tax payable.
2. **Payout schedule:** a **payout scheduler** creates a **payout obligation** per host per reservation, with release_at = check-in + 24 h in the listing's time zone. At release, obligations move from held to payable (a ledger transfer).
3. **Aggregation and FX:** a daily payout batcher groups payable obligations per host payout method and currency and applies **FX**. The rate is either locked at booking (stored on the reservation) or taken at payout time from the treasury service. The FX gain or loss is posted to an FX account.
4. **Execution:** payout execution calls payout providers (bank rails per country, PayPal, Payoneer) with idempotency keys (payoutId). Statuses arrive via webhooks and polling: sent → paid, or returned (wrong account), which reverses the ledger movement and notifies the host.
5. **Adjustments:** a cancellation after payout creates a **negative balance** for the host, which is recovered from future payouts (netting) or collected. It's all ledgered.
6. **Reconciliation:** daily PSP settlement files vs charges, bank statements vs payouts, and ledger balance sums (held funds equal the pending obligations).`,
    diagram: `Guest ─► Reservation svc ─► Payments svc ──(idem key)──► PSP (charge)
                                 │ ledger post: guest→held, fees, taxes
                                 ▼
                       Double-entry ledger (append-only)
                                 ▲        ▲
    Payout scheduler (check-in+24h) ──────┘        │
              │ release obligations                │ FX, payout, returns
              ▼                                    │
    Daily batcher (per host/method/currency) ─► FX (treasury) ─► Payout exec
                                                   │ idem payoutId
                                                   ▼
                                     Bank rails / PayPal / Payoneer
                                                   │ webhooks/status
                 Reconciliation (PSP + bank files vs ledger) ◄──┘`,
    deepDives: [
      {
        topic: "Ledger accounts and the lifecycle of one booking",
        discussion: `Model accounts explicitly: guest receivable (per PSP), funds held for hosts (a liability), host payable (per host and currency), platform revenue (service fees), tax payable per jurisdiction, FX gain/loss, and payout clearing. A ₹20,000 booking might post: debit PSP receivable 20,000; credit host held 17,000; credit guest service fee revenue 2,400; credit occupancy tax payable 600. At release: debit host held 17,000, credit host payable 17,000 (less the host fee: debit 510 to host fee revenue). At payout: debit host payable, credit payout clearing, and when the bank confirms, clear it against the bank account. Every transaction balances, and the outstanding "held" balance is always explainable by the list of future obligations.`,
      },
      {
        topic: "Idempotent payouts and bank uncertainty",
        discussion: `Bank payouts are slow and ambiguous: an API call may time out while the transfer still goes out, or bounce back days later. Each payout has a stable payoutId used as the provider idempotency key and a state machine: CREATED → SUBMITTED → (PAID | FAILED | RETURNED). A timeout keeps it SUBMITTED, and a status poller resolves it. We never create a second payout for the same obligations until the first is terminally failed, and a failed payout releases its obligations back to payable for the next attempt (possibly via another method after the host updates details). Returns can arrive after PAID, so the state machine allows PAID → RETURNED with a reversing ledger entry. Reconciliation against bank statements catches anything missed.`,
      },
      {
        topic: "Multi-currency and FX exposure",
        discussion: `A guest pays in EUR, and the host wants INR. Options: lock the FX rate at booking (host certainty, platform bears FX risk until payout, which can be hedged by treasury) or convert at payout (the host bears the risk). Airbnb shows hosts expected payouts in their currency, so rate locking with treasury hedging is common. Store the amounts in the original currency and the converted currency on the obligation, with the rate id, and post FX differences to FX gain/loss. Never mix currencies in one ledger transaction without an FX account. Use integer minor units with the currency exponent (JPY 0, KWD 3). Payout batching per currency minimises conversion fees.`,
      },
    ],
    tradeoffs: [
      "Rate lock at booking gives host certainty but platform FX risk; conversion at payout shifts the risk to hosts",
      "Batching payouts daily reduces fees but delays funds; instant payouts cost more (offer them as a paid option)",
      "Event-sourced ledger gives full audit and replay, but needs projections for balances",
      "Netting negative balances against future payouts is simple but slow to recover from churned hosts",
      "One payments platform vs per-country integrations: consistency vs local optimisation",
    ],
    followUps: [
      { q: "A host changes their bank account 1 hour before a payout. Risk?", a: "It could be account takeover. Hold payouts for a cooling-off period after payout-method changes, require re-authentication or 2FA, and notify through existing channels." },
      { q: "How do you remit occupancy taxes?", a: "Tax payable accounts per jurisdiction accumulate from bookings. A periodic remittance job files and pays authorities and posts debit tax payable, credit bank." },
      { q: "How do you guarantee the payout happens 24 h after check-in even if the scheduler is down?", a: "Obligations are durable rows with release_at, and the scheduler is a catch-up query (release_at ≤ now AND status = HELD), so downtime only delays and never loses a payout." },
    ],
    relatedTopics: ["design-commerce", "ds-transactions", "prod-correctness-ops", "mq-fundamentals", "api-design", "security-general"],
  },
  // ---------------------------------------------------------------- Stripe
  {
    id: "co-stripe-1",
    company: "stripe",
    title: "Design an idempotent payments API with reliable webhook delivery",
    frequency: "very-high",
    level: "L3 / L4 (Senior)",
    prompt:
      "Design the public API for creating charges so that client retries never double-charge, and design the webhook system that notifies merchants of payment events reliably, in order where it matters, and at scale.",
    clarifyingQuestions: [
      "How long must idempotency keys be honoured (24 h, as Stripe does)? Scoped per merchant?",
      "What if the same key is reused with a different request body?",
      "Webhook guarantees: at-least-once? Ordering per object? What retry schedule (up to 3 days)?",
      "How many merchants and endpoints, and what event volume?",
      "Must merchants be able to replay or list missed events?",
    ],
    functional: [
      "POST /v1/charges accepts an Idempotency-Key header; a retry returns the original response",
      "Detect key reuse with a different payload (return 400/422)",
      "Emit events (charge.succeeded, refund.created...) and deliver them to merchant endpoints with signatures",
      "Retries with exponential backoff for up to 3 days; disable failing endpoints; event list API for recovery",
    ],
    nonFunctional: [
      "Exactly-once effect for charges from the merchant's point of view",
      "Webhook delivery p50 within seconds; tolerant of slow or failing merchant servers",
      "Isolation: one merchant's dead endpoint must not delay others",
      "Auditable and observable per merchant (delivery attempts, response codes)",
    ],
    estimation: [
      { label: "API writes", calc: "~10K charge requests/s at peak (Black Friday); ~5% are retries" },
      { label: "Idempotency store", calc: "10K/s × 86,400 s (24 h TTL) ≈ 860M keys × ~2 KB (stored response) ≈ 1.7 TB → sharded KV/DB" },
      { label: "Events", calc: "~5 events per charge lifecycle → 50K events/s; average 3 endpoints per merchant → 150K deliveries/s" },
      { label: "Retry backlog", calc: "If 2% of endpoints are down for hours: 3K deliveries/s accumulate → ~10M pending deliveries per hour kept in a delay queue" },
    ],
    highLevelDesign: `**Idempotent API (Stripe's published approach):**
1. The request arrives with \`Idempotency-Key\`. In the API's primary DB transaction, **insert** \`idempotency_keys(merchant_id, key, request_hash, status=started, locked_at)\`. On a unique-constraint conflict: if a response is stored, return it; if it's in progress, return 409 (retry later); if the request hash differs, return 400.
2. Execute the charge as a series of **atomic phases** with **recovery points** stored on the key row (\`started → charge_created → psp_called → finished\`). External calls to card networks use their own idempotency identifiers. A crashed request can be resumed or completed by a background **completer** that picks up keys stuck in intermediate states.
3. Store the final HTTP status and body on the key row and return it. Keys expire after 24 h.
4. Write events to a **transactional outbox** in the same transaction as the state change (charge succeeded plus the event row).

**Webhook delivery:**
1. An **outbox relay** publishes events to Kafka (partitioned by merchant).
2. The **fan-out service** looks up the merchant's endpoints and subscribed event types, and creates one **delivery task** per (event, endpoint).
3. **Delivery workers** POST to the endpoint with a signature header (HMAC-SHA256 over timestamp + payload with the endpoint secret) and a short timeout (e.g. 10–30 s). A 2xx marks it delivered.
4. On failure, schedule a retry in a **delay queue** with exponential backoff (minutes, then hours, for up to ~3 days). Persistent failures notify the merchant and eventually **disable the endpoint**.
5. **Per-endpoint isolation:** a queue or concurrency limit per endpoint, so a slow endpoint only backs up itself.

**Ordering:** Stripe does *not* guarantee order. Events carry \`created\` timestamps and object versions, and merchants are told to fetch the latest object state. That's a deliberate simplification to state.`,
    diagram: `Merchant ─► API (Idempotency-Key) ─► txn: idempotency row + charge + outbox
                                             │ recovery points; completer
                                             ▼
                                     Outbox relay ─► Kafka (by merchant)
                                                        │
                                                        ▼
                                     Fan-out (endpoints × event types)
                                                        │ delivery tasks
                                                        ▼
                            Delivery workers (per-endpoint concurrency caps)
                             │ 2xx → delivered      │ fail → delay queue
                             ▼                      ▼   (backoff up to 3 days)
                   Merchant endpoint (verify HMAC)  Disable + alert merchant`,
    deepDives: [
      {
        topic: "Atomic phases and recovery points",
        discussion: `A charge touches our DB and an external network, so it can't be one ACID transaction. Split it into phases, each a local transaction that advances \`recovery_point\` on the idempotency row. Phase 1 creates the charge record (pending). Phase 2 calls the card network with a deterministic idempotency identifier derived from the charge id. Phase 3 records the result and the outbox event. If the process crashes between phases, the key row is left at an intermediate recovery point with a lock timestamp. A retry by the client (same key) or the background completer resumes from that point: it re-calls phase 2 safely (the network dedupes) and finishes. That's how "exactly once" is built from at-least-once pieces, as Stripe's engineering blog describes.`,
      },
      {
        topic: "Isolating bad endpoints",
        discussion: `Webhook volume is dominated by healthy endpoints, but failures dominate the cost: timeouts hold worker slots. Protections: a short connect and read timeout; a **per-endpoint concurrency limit** (e.g. 10 in-flight); per-endpoint circuit breakers that stop attempts for a cool-down after N consecutive failures; and retries in a delay queue (e.g. per-minute time buckets or Kafka retry topics by backoff tier) rather than blocking workers. Workers are shared, but scheduling is fair across endpoints, so a merchant with 1M backlogged deliveries can't starve others. Metrics per endpoint (success rate, latency) feed merchant dashboards and alert emails before disabling. Enterprise merchants may get dedicated delivery pools.`,
      },
      {
        topic: "Security of webhooks",
        discussion: `Merchants must be able to verify that a webhook came from us and wasn't replayed. Sign \`timestamp + '.' + rawBody\` with HMAC-SHA256 using the per-endpoint secret, sent as \`Stripe-Signature: t=...,v1=...\`. Merchants recompute it over the raw bytes (not re-serialised JSON), compare in constant time, and reject timestamps older than ~5 minutes. Support **secret rotation** by signing with both old and new secrets during the overlap. Egress comes from published IP ranges so merchants can allowlist them. Block SSRF: validate that endpoint URLs aren't internal addresses, re-resolving DNS at send time. Payloads contain object snapshots, and sensitive data such as full card numbers is never included.`,
      },
    ],
    tradeoffs: [
      "Storing full responses for idempotency uses TB of storage but gives true replay semantics",
      "Guaranteeing webhook order would require per-object serialisation and head-of-line blocking; Stripe chooses unordered delivery plus fetch-latest guidance",
      "Long retry windows (3 days) help merchants recover but grow the backlog; the event list API offers an alternative recovery path",
      "Shared worker pool with per-endpoint limits is efficient; dedicated pools isolate better but cost more",
    ],
    followUps: [
      { q: "Two requests with the same idempotency key arrive at the same time. What happens?", a: "Both try to insert the key row. One wins, and the other hits the unique constraint, sees status in-progress and returns 409, so the client retries after a delay and gets the stored response." },
      { q: "How does a merchant recover from 4 hours of downtime?", a: "Retries continue with backoff and succeed when the endpoint returns. The merchant can also call the event list API (events since a timestamp) to reconcile, and resend deliveries from the dashboard." },
      { q: "How do you test this system?", a: "Fault injection: crash between phases, simulate network timeouts and duplicate requests, and run property-based tests asserting one charge per key. Contract tests for the signature format." },
    ],
    relatedTopics: ["api-design", "design-commerce", "prod-async-failure", "mq-scenarios", "api-security", "rel-patterns"],
  },
  {
    id: "co-stripe-2",
    company: "stripe",
    title: "Design API rate limiting and load shedding for a payments API",
    frequency: "high",
    level: "L3 / L4 (Senior)",
    prompt:
      "Design the rate limiters and load shedders in front of a payments API: protect the platform from abusive or buggy clients and from overload, while keeping critical traffic (charges) flowing.",
    clarifyingQuestions: [
      "Limit per what: API key, account, endpoint, IP? Different limits for live vs test mode?",
      "Bursts: should a merchant get short bursts above the steady rate?",
      "Which traffic is critical during overload (charge creation) vs sheddable (list endpoints, analytics)?",
      "Single region or multi-region enforcement?",
      "What should clients receive: 429 with Retry-After and headers?",
    ],
    functional: [
      "Request rate limiter per account/key (token bucket with burst)",
      "Concurrent request limiter per account (caps in-flight expensive requests)",
      "Fleet-level load shedder that drops low-priority traffic when the system is overloaded",
      "Worker utilisation shedder: reserve capacity for critical requests",
    ],
    nonFunctional: [
      "Added latency under 1 ms p99 for limiter checks",
      "Fail open in a controlled way if the limiter store is unavailable (never take down the API)",
      "Accurate enough (a few percent) with clear client feedback",
      "Dark launch and per-limiter kill switches for safe rollout",
    ],
    estimation: [
      { label: "Checks", calc: "~50K API requests/s × ~3 limiters each ≈ 150K limiter checks/s" },
      { label: "Redis load", calc: "One Lua script per check ≈ 150K ops/s → a Redis Cluster of 4–6 shards (at ~40–50K scripted ops/s each)" },
      { label: "Keys", calc: "~1M active accounts × 3 limiter keys ≈ 3M keys × ~100 B ≈ 300 MB" },
      { label: "Shed capacity", calc: "Reserve ~20% of worker capacity for critical requests during overload" },
    ],
    highLevelDesign: `Stripe's engineering blog describes **four layers**, which is a great structure to present:

1. **Request rate limiter (per user):** a token bucket per API key/account in Redis via a Lua script (refill based on elapsed time, capacity = burst). This is the limiter most clients hit. It returns **429** with \`Retry-After\`. Test mode has separate, lower limits.
2. **Concurrent requests limiter (per user):** limits in-flight requests (e.g. 20) for expensive endpoints. Implemented with a sorted set of request ids and start timestamps: add on start, remove on finish, expire entries older than the timeout. It protects against clients retrying slow requests aggressively, which would otherwise pile up.
3. **Fleet usage load shedder:** traffic is classified as **critical** (charges, refunds) vs **non-critical** (list, search, reports). When fleet usage for non-critical traffic exceeds its share (e.g. non-critical may use at most 80% of capacity), non-critical requests get 503. Critical traffic always has headroom.
4. **Worker utilisation load shedder:** each API server tracks worker saturation. Under overload it sheds by priority (test mode first, then non-critical GETs, then non-critical POSTs), progressively and quickly, and recovers gradually.

**Where it runs:** middleware in the API servers (Ruby/Go at Stripe), with Redis for layers 1–2 and local state for layers 3–4.

**Failure handling:** if Redis is slow or unavailable, the limiter **fails open** (logs and allows) with a local fallback bucket per process (limit ÷ number of processes), so a limiter outage can never become an API outage.

**Rollout:** each limiter is dark-launched (log-only mode) to see who would be limited, then enforced. There are feature flags per limiter and per account overrides for large merchants.`,
    deepDives: [
      {
        topic: "Token bucket in Redis, atomically",
        discussion: `Store \`tokens\` and \`last_refill_ms\` in a hash per key. A Lua script computes tokens = min(capacity, tokens + elapsed × rate), decrements if at least one token is available, writes back, sets a TTL of ~2× (capacity ÷ rate), and returns allowed/remaining. Because Lua runs atomically on the Redis shard, concurrent requests can't both take the last token. Pass server time from the application, or use Redis TIME inside the script, to avoid client clock skew. Put the account id in a hash tag so a user's limiter keys co-locate for multi-key scripts. Return remaining and reset values so the API can set RateLimit headers. A fixed window is worse, since bursts at boundaries allow 2×.`,
      },
      {
        topic: "Load shedding by priority",
        discussion: `Rate limits protect against individual clients. Load shedders protect the fleet when aggregate demand exceeds capacity (a deploy gone wrong, a dependency slowdown, a retry storm). The key idea is **priority**: during overload, fail the least important requests first, fast (return 503 in microseconds rather than queueing). Worker-utilisation shedding uses a signal such as the queue length or the percentage of workers busy, with thresholds per priority class (shed test traffic at 70% utilisation, non-critical at 80%, and critical only at 95%+). Clients should see clear errors with Retry-After, and our own SDKs retry with exponential backoff and jitter, which keeps shedding from causing a synchronized retry storm.`,
      },
      {
        topic: "Choosing and communicating limits",
        discussion: `Limits must reflect real capacity and merchant needs: the default is e.g. 100 read and 100 write requests/s in live mode, with a higher burst capacity, and large merchants get negotiated overrides stored in config. Per-endpoint cost weights (a search call costs more than a GET) allow one bucket with weighted tokens. Communicate with \`RateLimit-Limit\`, \`RateLimit-Remaining\` and \`Retry-After\` headers, documentation, and dashboard alerts when a merchant is frequently limited, because a merchant hitting limits during checkout is losing money. Dark-launching limiters and reviewing who would be affected before enforcement prevents surprise outages for legitimate high-volume merchants. Finally, expose limit usage in the dashboard and API responses, so merchants can build client-side pacing instead of discovering limits through errors in production.`,
      },
    ],
    tradeoffs: [
      "Fail open keeps the API up during limiter outages but temporarily removes protection; a local fallback bucket bounds the risk",
      "Centralised Redis gives accurate per-account limits; local-only limits are faster but inaccurate across many servers",
      "Shedding by priority keeps critical flows alive but needs honest request classification",
      "Concurrency limits protect against slow-request pile-ups but can starve legitimate long-running requests; tune per endpoint",
    ],
    followUps: [
      { q: "How do you enforce limits across multiple regions?", a: "Keep per-region buckets with a share of the limit, rebalanced by recent demand. Or home each account to a region for limiter purposes, accepting small inaccuracy during failover." },
      { q: "A big merchant's traffic doubles legitimately on Black Friday. How do you avoid throttling them?", a: "Pre-provisioned overrides from account managers, auto-raising limits based on history and risk scoring, and monitoring the throttle rate per top merchant with alerts." },
      { q: "How do you know shedding thresholds are right?", a: "Load test to find the knee of the latency curve, set thresholds below it, and validate with game days and incident reviews." },
    ],
    relatedTopics: ["rate-limiting", "rel-patterns", "api-design", "cache-fundamentals", "prod-scale", "design-advanced"],
  },
  // ---------------------------------------------------------------- LinkedIn
  {
    id: "co-linkedin-1",
    company: "linkedin",
    title: "Design connection degrees (1st/2nd/3rd) and People You May Know",
    frequency: "high",
    level: "Senior / Staff",
    prompt:
      "Design the service that shows the connection degree between the viewer and any member (1st, 2nd, 3rd+) on profiles and search results, and generates People You May Know recommendations, for 1B members.",
    clarifyingQuestions: [
      "Average and maximum connections per member (average ~400, cap 30K)?",
      "Latency: the degree badge on search results needs a batch of ~25 members in under 50 ms?",
      "Freshness: a new connection should reflect in degrees within minutes?",
      "Is PYMK precomputed daily or computed online? What signals besides mutual connections (company, school)?",
      "Privacy: members who hide their connections?",
    ],
    functional: [
      "Degree(viewer, target) for single and batch lookups (1, 2, 3+ with mutual count for 2nd)",
      "List mutual connections",
      "PYMK: ranked candidate list per member, refreshed regularly",
      "Update the graph when members connect or disconnect",
    ],
    nonFunctional: [
      "Batch degree lookup under 50 ms p99",
      "Graph updates reflected within minutes",
      "~1B nodes, ~200B edges (undirected, stored both ways)",
      "Highly available; degraded mode can hide badges",
    ],
    estimation: [
      { label: "Edge storage", calc: "1B members × 400 connections avg = 400B directed adjacency entries × 8 B ≈ 3.2 TB (compressed adjacency lists ~1–1.5 TB)" },
      { label: "Degree lookups", calc: "Search + feed + profile views ≈ 500K degree checks/s (batched as ~25 per request → 20K requests/s)" },
      { label: "2nd-degree set size", calc: "400 × 400 ≈ 160K (with overlap ~50–100K) per member → too big to materialise for all members (1B × 100K)" },
      { label: "PYMK batch", calc: "1B members × top 100 candidates × 16 B ≈ 1.6 TB output per daily run" },
    ],
    highLevelDesign: `**Graph storage:** a distributed in-memory graph service (LinkedIn built **LIquid** and earlier GAIA/Cleo-era graph services), partitioned by member id. Each partition holds members' **sorted adjacency lists** (compressed). Writes come from the connection service's database via a change stream (Kafka/Brooklin), updating partitions within seconds.

**Degree computation for (viewer V, targets T[]):**
1. **1st degree:** is T in adj(V)? Binary search in V's sorted list, O(log d).
2. **2nd degree:** is adj(V) ∩ adj(T) non-empty? Intersect two sorted lists (≈ 400 + 400 comparisons), or probe the smaller list against the larger. The mutual count is the intersection size.
3. **3rd degree:** otherwise, check whether adj(adj(V)) intersects adj(T). That's expensive, so answer "3rd+" by default, or use a **bidirectional BFS** with a budget.

Since V's adjacency list is reused across the 25 targets in a batch, fetch it once. For each target, the request goes to the target's partition, which already has V's list (sent along) and intersects locally. That's one scatter round to the targets' partitions.

**Caching:** a viewer's **2nd-degree set** can be cached as a compressed bitmap (Roaring) for very active viewers (recruiters) on demand, with a TTL, turning a 2nd-degree check into a bitmap probe.

**PYMK:** an offline (Spark) daily job generates candidates by **friends-of-friends** with mutual counts, plus shared company, school and location, contact-book imports, and profile-view signals. A ranking model (probability of invitation and acceptance) scores them, and the results are written to a KV store (Venice/Voldemort-style) for serving. An **online booster** adds fresh candidates after a new connection (their connections) through a streaming job.`,
    diagram: `Connect/disconnect ─► Connections DB ─► CDC/Kafka ─► Graph partitions
                                                      (sorted adjacency)
Search/feed/profile ─► Degree API (batch 25)
      │  fetch adj(V) once, scatter to targets' partitions
      ▼
Partition(T): 1st? binary search; 2nd? intersect adj(V) ∩ adj(T) → mutual count
      │
      ▼  results merged (3rd+ by default)
Hot-viewer cache: Roaring bitmap of 2nd-degree set (TTL)

Offline: Spark FoF + signals → ranker → PYMK KV store ◄── streaming booster`,
    deepDives: [
      {
        topic: "Partitioning the graph",
        discussion: `Hash partitioning by member id spreads load evenly but means almost every 2nd-degree query touches another partition. That's acceptable because we only need one hop to the target's partition, carrying V's adjacency list (~3 KB compressed). Graph-aware partitioning (co-locating communities) reduces cross-partition traffic, but it's complex to maintain as the graph evolves, and it creates hot partitions for dense communities. Each partition is replicated (3×) for availability and read throughput. Super-connectors (30K connections, influencers with followers) need care: cap per-request work, use bitmaps for their adjacency, and never materialise their 2nd-degree set. The degree API also enforces privacy settings (members who hide their connection list still show a degree but not the mutual list).`,
      },
      {
        topic: "PYMK candidate generation at scale",
        discussion: `Computing friends-of-friends for 1B members naively is 1B × 160K pairs, far too much. Techniques: (1) for each member, iterate over their connections' lists and count occurrences, but only through connections with fewer than N connections, or by sampling, to bound work; (2) generate candidates from multiple cheaper sources (same company and overlapping tenure, same school and graduation year, email contacts, "viewed your profile") and union them; (3) a distributed join in Spark (edges ⋈ edges on the middle node, then aggregate by pair) with skew handling for high-degree middle nodes (salting). Then rank with a model trained on invite and accept outcomes, filter people already invited, blocked or connected, and store the top 100 per member.`,
      },
      {
        topic: "Freshness after a new connection",
        discussion: `A member who just connected with a colleague expects to see the colleague's connections as 2nd degree immediately. Graph partitions consume the connection event from Kafka and update both endpoints' adjacency lists (idempotent insert into the sorted list). Updates land within seconds, and the cached 2nd-degree bitmaps for those members are invalidated. For PYMK, a streaming job reacts to the connection event by pulling the new connection's top connections as fresh candidates, merged with the daily batch at serve time (a Lambda-style design). Deletions (disconnects) must also propagate, and the serving layer re-checks 1st degree on the fly to avoid showing a stale "1st" badge.`,
      },
    ],
    tradeoffs: [
      "Online intersection vs materialised 2nd-degree sets: compute on demand saves massive storage at a small CPU cost",
      "Hash partitioning is simple and balanced but costs one network hop; graph-aware partitioning is fewer hops but complex",
      "3rd degree exact vs \"3rd+\" label: exactness is rarely worth the fan-out cost",
      "Daily batch PYMK is cheap and thorough; streaming boosters add freshness with more complexity",
    ],
    followUps: [
      { q: "How would you compute \"how you're connected\" (the shortest path) for 3rd degree?", a: "A bidirectional BFS from both ends up to depth 2 on each side, with per-level budgets, returning the first meeting node. It's rare and user-initiated, so a higher latency (~200 ms) is acceptable." },
      { q: "How do you avoid recommending someone the member blocked?", a: "A block list filter at serve time, plus exclusion in the batch job. Blocks must propagate immediately, so the serve-time filter is mandatory." },
      { q: "What if the graph service partition for a viewer is down?", a: "Replicas serve reads. If all are down, hide degree badges (degrade) instead of failing search results." },
    ],
    relatedTopics: ["design-social", "db-sharding", "data-pipelines", "cache-fundamentals", "search-systems", "prod-scale"],
  },
  {
    id: "co-linkedin-2",
    company: "linkedin",
    title: "Design \"Who viewed your profile\"",
    frequency: "medium",
    level: "Senior",
    prompt:
      "Design the feature that records profile views and shows members who viewed their profile (with counts, trends and viewer insights), respecting viewers' privacy settings (full, semi-private, private).",
    clarifyingQuestions: [
      "Retention: free members see 90 days (limited viewers), premium members see full details?",
      "Privacy modes: a private viewer appears as \"Anonymous LinkedIn member\"; semi-private shows only headline/company?",
      "Dedup: repeated views by the same viewer within a day count once?",
      "Real-time notification (\"X viewed your profile\") or daily digest?",
      "Aggregates: views per week, viewer companies, job titles, search appearances?",
    ],
    functional: [
      "Record a profile view event (viewer, viewee, timestamp, source)",
      "List recent viewers of my profile with privacy applied; paginated",
      "Aggregates: total views, weekly trend, top viewer companies and titles",
      "Notifications for new views (batched)",
    ],
    nonFunctional: [
      "Write-heavy ingestion (~100K views/s); read latency under 100 ms",
      "Privacy is mandatory: the viewer's privacy mode at view time is enforced",
      "Eventual consistency acceptable (minutes)",
      "Cost-efficient storage of billions of view events",
    ],
    estimation: [
      { label: "Views", calc: "~2B profile views/week ≈ 3.3K/s average; peak and bots ×10 → design for ~50K/s ingestion" },
      { label: "Raw storage", calc: "2B/week × 52 × 100 B ≈ 10 TB/year raw" },
      { label: "Serving store", calc: "Keep 90 days of deduped viewer lists: ~20B entries × 50 B ≈ 1 TB (sharded by viewee)" },
      { label: "Aggregates", calc: "Per-member weekly counts and top-N companies: 1B × ~1 KB ≈ 1 TB (mostly sparse)" },
    ],
    highLevelDesign: `**Write path:** when a profile page renders, the profile service emits a \`ProfileViewEvent {viewerId, vieweeId, ts, source, viewerPrivacyMode}\` to **Kafka**, fire-and-forget and off the page's critical path. The privacy mode is **captured at view time** (if the viewer browses in private mode, the event is permanently anonymised for display).

**Stream processing (Samza/Flink, LinkedIn-style):**
1. **Filter:** bots (known crawlers, rate anomalies), self-views, and blocked relationships.
2. **Dedup:** the same (viewer, viewee) within 24 h counts once. Keyed state with a TTL, keyed by vieweeId + viewerId.
3. **Write the serving record:** into a store **partitioned by vieweeId** (Espresso/Cassandra-like), with clustering by ts desc: \`(vieweeId, ts, viewerId or anonymised token, displayMode)\`. A private viewer is stored as anonymous with no viewerId in the serving path; the real id is kept only in restricted raw logs for abuse or legal needs, if at all.
4. **Update aggregates:** a weekly count, and top companies and titles via increments into per-viewee aggregates (resolved from the viewer's profile at view time, so later job changes don't rewrite history).

**Read path:** \`GET /me/profile-views?cursor=\` reads the viewee's partition, pages by ts, and hydrates viewer display info (name, headline, photo) from the profile cache. Privacy display is applied per entry: full, semi-private ("Someone at Google"), or anonymous. Free vs premium limits are applied here (a free member sees the last 5 named viewers, for example).

**Notifications:** a digest job batches new views (for example, when views in the last day are ≥ 3) into a notification, rather than one per view, to avoid spam.

**Offline:** the raw events land in HDFS/Iceberg for analytics, recommendations and "search appearances" metrics.`,
    deepDives: [
      {
        topic: "Privacy enforcement as a data-model property",
        discussion: `The riskiest bug is leaking a private viewer's identity. So don't rely on read-time filtering alone. **Decide the display mode when the event is processed** and write only what may be shown: for private viewers, the serving row has no viewerId, just an "anonymous" marker. Semi-private stores only the derived attributes (company, title category). The raw event with viewerId goes to a restricted, access-audited store with short retention, or is hashed. Changing your privacy setting later affects future views only, which matches the product semantics and avoids retroactive recomputation. Tests assert that no API path can return a viewerId for a private-mode row.`,
      },
      {
        topic: "Hot viewees and write amplification",
        discussion: `A celebrity profile or a viral job-seeker may get 100K views in an hour, all going to one partition key. Dedup in the stream processor reduces repeats. Batching writes per viewee (micro-batches every second) cuts per-row write overhead. For extremely hot viewees, split the partition by time bucket (vieweeId + day) so no single partition grows unbounded, and the read path merges the recent buckets. Aggregates use counters updated in batches rather than per event. Because the feature tolerates minutes of delay, backpressure simply grows Kafka lag temporarily without affecting profile page latency. Readers of a hot profile hit the same partition too, so cache the first page of viewers for a minute, since the list changes slowly relative to how often it's viewed.`,
      },
      {
        topic: "Aggregates and insights",
        discussion: `Members want trends: "Your profile was viewed 132 times this week, up 20%; top companies: Flipkart, Amazon". Maintain per-viewee weekly counters and a top-K of viewer companies and titles (a small heap per viewee, updated in the stream job, or an hourly batch). Viewer attributes are resolved at view time from the profile service (cached), so history stays consistent. For premium insights over 90 days or a year, compute from the offline store in a daily Spark job and write results to a read-optimised KV (Venice-style). That separates the real-time "recent viewers" list from the heavy analytics. Keeping these as separate read models also lets product iterate on insight types without touching the real-time pipeline.`,
      },
    ],
    tradeoffs: [
      "Deciding privacy at write time is safest, but settings changes are not retroactive",
      "Dedup within 24 h reduces noise and storage but undercounts genuine repeat interest",
      "Stream-maintained aggregates are fresh but approximate if events are late; batch recomputation corrects them",
      "Time-bucketed partitions avoid hot, huge partitions but make reads merge buckets",
    ],
    followUps: [
      { q: "A member deletes their account. What happens to views they made?", a: "Their appearances in others' viewer lists are removed or anonymised via an erasure pipeline (GDPR): delete events propagate to the serving store and aggregates." },
      { q: "How do you stop scrapers from appearing as viewers?", a: "Bot detection in the stream filter (request rate, headless signals, account age), and scraper accounts are excluded from lists and counts." },
      { q: "How do you show \"people who viewed this profile also viewed\"?", a: "An offline co-view job builds item-to-item similarities from view sessions and serves them from a KV store. It's a different feature built on the same raw events." },
    ],
    relatedTopics: ["data-pipelines", "mq-scenarios", "db-sharding", "security-general", "design-social", "observability"],
  },
  // ---------------------------------------------------------------- Atlassian
  {
    id: "co-atlassian-1",
    company: "atlassian",
    title: "Design a tagging system across Jira, Confluence and Bitbucket",
    frequency: "very-high",
    level: "P4 / P5 (Senior / Principal)",
    prompt:
      "Design a product-agnostic tagging service that lets users add and remove tags on Jira issues, Confluence pages and Bitbucket pull requests, click a tag to see all tagged content across products, and see a dashboard of the top K popular tags.",
    clarifyingQuestions: [
      "Are tags scoped per tenant (site/org) and shared across products within a tenant?",
      "Scale: ~1M DAU × 10 operations/day, with reads ~10× writes (the commonly given numbers)?",
      "Top K: global per tenant, per product, over what time window (all time vs last 7 days)?",
      "Permissions: must tag search results only include content the user can see?",
      "Must new products be pluggable without code changes to the tagging service?",
      "Tag names: free text with normalisation (case, whitespace)? Rename or merge tags?",
    ],
    functional: [
      "Add/remove/replace tags on any content item (product, contentId)",
      "List tags of an item; list items for a tag across products (paginated)",
      "Top K tags per tenant (optionally per product, per time window)",
      "Autocomplete tag names; onboarding new products via configuration",
    ],
    nonFunctional: [
      "Read-heavy: ~10× reads vs writes; p99 read latency under 100 ms",
      "Tenant isolation and permission-aware results",
      "Eventual consistency acceptable for top-K (minutes); item tags read-your-writes",
      "Handle tags with hundreds of thousands of items (pagination)",
    ],
    estimation: [
      { label: "Traffic", calc: "1M DAU × 10 ops/day = 10M ops/day ≈ 115 ops/s average; peak ×5 ≈ 600/s; ~10% writes → 60 writes/s peak, 540 reads/s" },
      { label: "Tag associations", calc: "Say 200K tenants × 50K tagged items × 3 tags ≈ 30B associations × ~60 B ≈ 1.8 TB → shard by tenant" },
      { label: "Top-K counters", calc: "200K tenants × ~5K distinct tags × 16 B ≈ 16 GB → small; precompute" },
      { label: "Hot tag", calc: "A tag like \"bug\" in a big tenant may have 500K items → cursor pagination, never OFFSET" },
    ],
    highLevelDesign: `**Product-agnostic model:** everything is addressed by \`(tenantId, product, contentId)\`, and products register in a **product registry** (the content type, URL template, and a permission-check endpoint or bulk-permission API). Adding GitLab merge requests later means a registry entry, not a schema change.

**Data model (relational, e.g. Postgres, sharded by tenantId):**
- \`tag(tenant_id, tag_id, name, normalized_name UNIQUE per tenant, created_at)\`
- \`tag_assignment(tenant_id, tag_id, product, content_id, created_by, created_at)\` with PK (tenant_id, product, content_id, tag_id) for "tags of an item" and an index (tenant_id, tag_id, created_at desc, product, content_id) for "items for a tag" with cursor pagination.
- \`tag_count(tenant_id, tag_id, count)\`, maintained asynchronously.

**APIs:**
- \`PUT /v1/content/{product}/{contentId}/tags\` with body \`{tags: [..]}\` replaces the set idempotently. The server diffs it against the current set in one transaction and emits TagAdded/TagRemoved events.
- \`GET /v1/content/{product}/{contentId}/tags\`
- \`GET /v1/tags/{tagId}/content?cursor=&limit=50&product=\`
- \`GET /v1/tags/top?k=10&window=7d\` and \`GET /v1/tags?prefix=bu\` for autocomplete.

**Events:** tag changes go to an **outbox → Kafka**. Consumers update counters and top-K, the search index (for cross-product content discovery), and caches.

**Top K:** a streaming consumer maintains per-tenant counts (all-time plus daily buckets for windows) and writes a precomputed top-K list per tenant (and per product) to Redis, refreshed every minute. Reads are O(1).

**Permissions:** "items for a tag" returns candidates, then filters them via the products' **bulk permission check** (a batch of 50–100 ids per call). Over-fetch to fill a page, and cache permission results for a short time.

**Content deletion:** products emit ContentDeleted events, and the tagging service removes the assignments.

**Caching:** the tags of an item are cached per (tenant, product, contentId) and invalidated on PUT, and the top-K lists are cached per tenant with a one-minute TTL.`,
    diagram: `Jira / Confluence / Bitbucket UIs
      │ PUT tags / GET tags / GET top-K
      ▼
API gateway (auth, tenant) ─► Tagging service ─► Postgres (sharded by tenant)
      │                          │ outbox        tag, tag_assignment, tag_count
      │                          ▼
      │                        Kafka ─► top-K consumer ─► Redis (per tenant)
      │                          │
      │                          └──► Search indexer (cross-product discovery)
      ▼
Product registry (content types, permission-check APIs)
"items for tag" → candidates → bulk permission filter per product → page`,
    deepDives: [
      {
        topic: "The PUT endpoint: idempotent set replacement",
        discussion: `Interviewers ask specifically about the PUT that updates tags for a page or ticket. Make it **replace the set** (declarative), not add or remove single tags, so retries are idempotent and concurrent editors converge. In one transaction: normalise the names, upsert missing tag rows (\`ON CONFLICT (tenant_id, normalized_name) DO NOTHING\`), read the current assignments for the item \`FOR UPDATE\`, compute the diff, insert and delete the assignments, and write outbox events for each added or removed tag. To avoid lost updates between two editors, accept an optional \`If-Match\` ETag (the item's tag version) and return 412 on mismatch, or apply last-writer-wins, depending on the product requirement. Validate limits (e.g. max 50 tags per item, name length) to prevent abuse.`,
      },
      {
        topic: "Top K and time windows",
        discussion: `An all-time top K is a sorted view of tag_count per tenant, cheap to maintain with increments and decrements from events and a Redis ZSET per tenant (ZINCRBY on add, -1 on remove, ZREVRANGE 0 K-1 on read). A **last-7-days** window needs time buckets: keep daily ZSETs per tenant (\`top:{tenant}:2026-09-28\`) and compute the 7-day top K with ZUNIONSTORE of the last 7 into a cached key every few minutes. For very large tenants, the ZSETs are still small (thousands of tags). Global cross-tenant top K (if asked) must never leak tenant data, and should be computed offline with privacy review. Counts are eventually consistent, which is acceptable for a dashboard.`,
      },
      {
        topic: "Pagination and permission-aware results for huge tags",
        discussion: `A tag with 500K items needs keyset pagination: \`WHERE tenant_id = ? AND tag_id = ? AND (created_at, content_id) < (?, ?) ORDER BY created_at DESC LIMIT 100\`, using the composite index, with an opaque cursor encoding the last (created_at, content_id). OFFSET would scan and slow down deep pages. Permissions complicate page filling: a user may only see 10% of items. Over-fetch in batches, call each product's bulk permission API in parallel, and continue until the page is filled or a work budget is hit (then return a partial page with a cursor). Cache "user can see content" results for ~60 s. For huge tenants, an alternative is to index permissions into a search engine (with ACL fields) and query there.`,
      },
    ],
    tradeoffs: [
      "Relational store gives transactions for set replacement and easy indexes; NoSQL scales writes but complicates \"items for tag\" queries",
      "Precomputed top-K is fast but eventually consistent; querying counts live is exact but expensive",
      "Permission filtering at read time is always correct but costly; indexing ACLs is faster but risks staleness",
      "Product-agnostic registry adds indirection but makes onboarding new products config-only",
      "Tenant-based sharding isolates tenants but big tenants can become hot shards; move whales to dedicated shards",
    ],
    followUps: [
      { q: "How do you rename or merge two tags (\"Bug\" and \"bugs\")?", a: "Rename is an update on the tag row (assignments reference tag_id). Merge re-points assignments from B to A in batches (a background job, deduping collisions), then deletes B, emitting events so counts and top-K update." },
      { q: "How do you support tag autocomplete fast?", a: "A prefix index on normalized_name per tenant (a B-tree with LIKE 'bu%' on a text_pattern_ops index), cached, and ranked by usage count." },
      { q: "A Confluence page is deleted. How do tags stay consistent?", a: "Products emit ContentDeleted events. The tagging service deletes the assignments and decrements counts, and a nightly reconciliation removes orphans for missed events." },
    ],
    relatedTopics: ["api-design", "db-indexing", "db-sharding", "cache-fundamentals", "design-advanced", "search-systems"],
  },
  {
    id: "co-atlassian-2",
    company: "atlassian",
    title: "Design a multi-tenant automation rules engine (Jira Automation)",
    frequency: "high",
    level: "P4 / P5",
    prompt:
      "Design a no-code automation engine where tenants define rules like \"When an issue is transitioned to Done, if priority is High, then comment and notify Slack\", executed reliably across hundreds of thousands of tenants.",
    clarifyingQuestions: [
      "Which trigger types: product events (issue created or transitioned), scheduled (cron), incoming webhooks?",
      "Which actions: in-product edits (comment, transition), outbound calls (Slack, webhooks), branching over related issues?",
      "Latency expectations: seconds after the trigger event?",
      "Limits per tenant plan (executions per month)? Loop protection (a rule triggering itself)?",
      "Audit log per rule execution visible to admins?",
    ],
    functional: [
      "Tenants create rules: trigger + conditions + actions (a tree with branches)",
      "Execute rules on matching events, schedules and incoming webhooks",
      "Per-execution audit log with status and errors",
      "Plan-based quotas, loop detection, and rule enable/disable",
    ],
    nonFunctional: [
      "Scale: ~10M rule executions/hour at peak across tenants",
      "Noisy-neighbour isolation: one tenant's bulk edit must not delay others",
      "At-least-once execution with idempotent actions where possible",
      "Rule changes take effect within seconds; high availability",
    ],
    estimation: [
      { label: "Product events", calc: "~50K Jira/Confluence events/s at peak (edits, transitions, comments)" },
      { label: "Rule matching", calc: "Average tenant has 20 active rules; filtering by trigger type/project first → ~2 candidate rules per event → 100K condition evaluations/s" },
      { label: "Executions", calc: "~10% of candidates pass conditions → ~5K executions/s ≈ 18M/hour" },
      { label: "Audit log", calc: "18M/hour × 2 KB ≈ 36 GB/hour → ~30-day retention ≈ 26 TB → time-partitioned store" },
    ],
    highLevelDesign: `**Rule definition service:** rules are stored as versioned JSON documents (a trigger, a condition tree, and an action list with branches) per tenant in a DB. A **rule index** is compiled per tenant: \`(tenantId, triggerType, scope such as projectId) → [ruleIds]\`, cached in memory in the matchers and invalidated via events when rules change.

**Event ingestion:** products publish domain events (IssueTransitioned, etc.) to **Kafka**, partitioned by tenantId (Atlassian uses streaming platforms such as its StreamHub). Scheduled triggers come from a scheduler service, and incoming webhooks from an ingress endpoint.

**Matching:** stateless matcher consumers look up candidate rules by (tenant, trigger, scope), evaluate cheap conditions using the event payload (JQL-like conditions may need an issue fetch), and emit an **execution request** \`{executionId, tenantId, ruleId, ruleVersion, triggerEvent}\` onto a **per-tenant fair queue**.

**Execution:** executor workers run the action list step by step with a **per-execution state record** (current step and outputs), so a crash resumes at the step, not from the beginning. Actions call product APIs as the rule actor (with scoped permissions) or outbound integrations (Slack, webhooks) with timeouts, retries and circuit breakers per destination.

**Fairness and noisy neighbours:** executions are scheduled with **weighted fair queuing across tenants** (per-tenant queues with a scheduler picking round-robin, weighted by plan), with per-tenant concurrency caps and quotas (executions per month), and throttles for bulk events (a 10K-issue bulk edit triggers 10K executions queued behind that tenant's own cap).

**Loop protection:** events produced by rule actions carry an **automation lineage** (the rule id chain and depth). Matchers ignore events whose lineage depth exceeds N or that would re-trigger the same rule, unless explicitly allowed.

**Audit:** each execution writes a summary (trigger, conditions result, actions, errors, duration) to an audit store partitioned by tenant and day, which is visible in the UI.`,
    deepDives: [
      {
        topic: "Fair scheduling across tenants",
        discussion: `A single FIFO queue lets one tenant's bulk operation (100K executions) delay everyone's rules for an hour, which is the classic noisy-neighbour problem. Instead, the executors pull from a **two-level scheduler**: active tenants are in a ring, and each turn dispatches up to w executions from that tenant's queue (w weighted by plan), capped by the tenant's concurrent-execution limit. Per-tenant queues can be Kafka partitions keyed by tenant with consumer-side fair scheduling, or SQS FIFO message groups, or Redis streams per tenant. Heavy tenants are moved to a dedicated pool (a cell) when they exceed thresholds. Metrics per tenant: queue delay, executions and failures. The SLO is on queue delay for median tenants, not just the average.`,
      },
      {
        topic: "Reliability and idempotency of actions",
        discussion: `Execution is at-least-once: a worker can crash after performing an action but before recording it. Mitigations: persist step progress before and after each action. Use **idempotency keys** (executionId + stepIndex) on product API calls that support them (such as a comment create with a client-generated id), so a retry doesn't double-comment. For external webhooks, pass the key in a header and document at-least-once semantics. Actions that aren't idempotent (sending an email) accept a rare duplicate. Timeouts per action and retries with backoff (and a circuit breaker per external host) keep a failing Slack integration from holding workers. Permanent failures mark the execution failed in the audit log and notify the rule owner.`,
      },
      {
        topic: "Evaluating conditions efficiently",
        discussion: `Conditions range from cheap (a field comparison on the event payload) to expensive (JQL over related issues, or lookups). Order evaluation cheap-first and short-circuit. Use **enriched events** (the product includes the changed fields and the key issue fields in the event) to avoid fetching the issue for most rules. For expensive conditions, fetch with batching and caching per execution. Compile each rule's condition tree into an evaluable form when the rule is saved (validation, type checking of fields), so bad rules fail at save time. Cap per-rule compute (a max number of related issues in a branch) and expose "rule too expensive" errors, just as governor limits do.`,
      },
    ],
    tradeoffs: [
      "Per-tenant fair queues isolate tenants but add scheduler complexity compared with one shared queue",
      "At-least-once execution with idempotency keys vs exactly-once workflows (Temporal-style) with more infrastructure",
      "Enriched events reduce fetches but increase event size and coupling to product schemas",
      "Loop protection via lineage depth is simple but can block legitimate chained automations; make it configurable",
      "Compiling rule indexes in matchers gives fast matching but needs cache invalidation on rule edits",
    ],
    followUps: [
      { q: "A tenant's rule sends 1M Slack messages by accident. How do you prevent that?", a: "Per-rule and per-tenant rate limits on outbound actions, anomaly detection on execution spikes that auto-pauses the rule, and loop protection. The audit log explains what happened." },
      { q: "How do you roll out a new action type safely?", a: "Feature flags per tenant, versioned rule schemas with the executor supporting old versions, canary cells, and a kill switch for the action type." },
      { q: "How would you implement scheduled rules for 1M tenants?", a: "A sharded scheduler with next-run timestamps and leases emits trigger events into the same pipeline, with jitter to avoid everyone's 9 AM rules firing at the same second." },
    ],
    relatedTopics: ["design-advanced", "mq-scenarios", "microservices", "rate-limiting", "prod-async-failure", "rel-patterns"],
  },
  // ---------------------------------------------------------------- Salesforce
  {
    id: "co-salesforce-1",
    company: "salesforce",
    title: "Design a metadata-driven multi-tenant CRM with custom objects",
    frequency: "high",
    level: "LMTS / PMTS",
    prompt:
      "Design the data platform for a CRM where each of 150K tenant orgs can define their own custom objects and fields (e.g. Invoice__c with 40 fields) at runtime, without schema migrations, while sharing infrastructure efficiently.",
    clarifyingQuestions: [
      "How many custom objects and fields per org (hundreds of objects, ~500 fields each)?",
      "Query requirements: filters, sorting, relationships (lookups), reports?",
      "Per-tenant resource limits (governor limits) on queries and storage?",
      "Isolation needs: shared databases (pool), or dedicated for large enterprises?",
      "Upgrades: the platform releases 3 times a year without breaking tenant customisations?",
    ],
    functional: [
      "Tenants create, alter and delete custom objects and fields at runtime (metadata)",
      "CRUD and query records of custom objects with filters, sorting and relationships",
      "Indexes on selected custom fields; reports and list views",
      "Validation rules, field-level security and sharing rules per tenant",
    ],
    nonFunctional: [
      "No DDL per tenant change; metadata changes apply instantly",
      "Strict tenant isolation in shared storage",
      "Predictable performance per tenant (governor limits against noisy neighbours)",
      "Scale: 150K orgs, billions of records, ~100K requests/s",
    ],
    estimation: [
      { label: "Records", calc: "150K orgs, heavily skewed (most small, a few with 1B+ rows) → ~100B records in total across pods" },
      { label: "Row size", calc: "Generic data row with ~500 slot columns (mostly null) ≈ 1–2 KB actual → 100B × 1.5 KB ≈ 150 TB, spread across ~100 pods/instances" },
      { label: "Metadata", calc: "150K orgs × ~200 objects × ~100 fields × 1 KB ≈ 3 TB metadata; hot subset cached" },
      { label: "Request rate", calc: "~100K API/UI requests/s at peak across pods → ~1–2K/s per pod" },
    ],
    highLevelDesign: `**Salesforce's actual approach (the "Force.com multitenant architecture" whitepaper), which is the model answer:**

**1. Metadata tables** (the Universal Data Dictionary): \`MT_Objects(OrgID, ObjID, ObjName…)\` and \`MT_Fields(OrgID, ObjID, FieldID, FieldName, DataType, FieldNum, IsIndexed…)\`. Creating Invoice__c inserts metadata rows. No DDL.

**2. One big data table:** \`MT_Data(OrgID, ObjID, GUID, Name, Value0 … Value500)\`, where each custom field is mapped to a **flex column** slot (Value0..Value500), stored as variable-length strings. Field metadata says "Invoice__c.Amount is in Value7, type Number". Values are converted at query time using the metadata.

**3. Pivot tables for indexing:** because Value columns hold mixed types, native indexes on them are useless. \`MT_Indexes(OrgID, ObjID, FieldNum, StringValue, NumValue, DateValue, GUID)\` holds **strongly typed copies** of indexed fields, maintained synchronously on write. \`MT_Unique_Indexes\` enforces uniqueness, and \`MT_Relationships\` handles lookups and joins.

**4. Query path:** the platform's **query compiler** translates the tenant's query language (SOQL: \`SELECT Name, Amount__c FROM Invoice__c WHERE Status__c = 'Open'\`) into SQL against MT_Data plus the pivot tables, **always adding OrgID** as the leading predicate (every table is partitioned by OrgID). A tenant-aware optimiser uses per-org statistics (row counts, selectivity per index) to choose plans.

**5. Pods (cells):** orgs are placed on **instances/pods** (NA1, EU15...), each with its own database cluster, app servers and search index. Large orgs can be moved between pods.

**6. Governor limits:** a runtime cap per transaction (SOQL queries ≤ 100, records returned ≤ 50K, CPU time ≤ 10 s, heap limits) enforced by the execution engine, which keeps shared resources predictable.

**7. Caching:** a metadata cache per app server (org and object definitions), invalidated on metadata change. Data caches are careful and per org.`,
    diagram: `Tenant UI / API (SOQL)
      │
      ▼
App servers (runtime engine, governor limits, metadata cache)
      │ query compiler: SOQL → SQL (+ OrgID, flex-column mapping)
      ▼
┌──────────────────────── Pod database (partitioned by OrgID) ─────────┐
│ MT_Objects / MT_Fields (metadata)                                    │
│ MT_Data (OrgID, ObjID, GUID, Value0..Value500 flex columns)          │
│ MT_Indexes (typed pivot copies: StringValue/NumValue/DateValue)      │
│ MT_Unique_Indexes, MT_Relationships                                  │
└──────────────────────────────────────────────────────────────────────┘
      │ async
      ▼
Search index (full-text), analytics store, sandbox copies`,
    deepDives: [
      {
        topic: "Why flex columns instead of EAV or JSONB",
        discussion: `An **EAV** table (row per field value) makes every record read an N-row join and every query a self-join, which is terrible for performance. **DDL per tenant** (a real table per custom object) gives native types and indexes, but with 150K orgs × hundreds of objects that's millions of tables, slow migrations, catalog bloat and risky runtime DDL. **Flex columns** in a wide shared table give one row per record, cheap inserts and a stable physical schema, with type information in metadata. The cost is weak typing (strings), so native indexes don't work, which the typed pivot tables solve. A modern alternative is Postgres **JSONB with expression or GIN indexes** per tenant field, which is simpler, but tenant-specific indexes become DDL again. Discussing this trade-off is the heart of the question.`,
      },
      {
        topic: "Tenant-aware query optimisation",
        discussion: `A generic database optimiser sees one giant MT_Data table and can't know that org A has 10 invoices while org B has 50M. Salesforce keeps **per-org, per-object statistics** (row counts, and the cardinality of each indexed field) and chooses plans itself: if \`Status__c = 'Open'\` matches 2% of org B's invoices and is indexed, drive from MT_Indexes and then fetch from MT_Data by GUID. If it's unselective, scan the org's partition with filters. Queries are also bounded by governor limits (the max rows returned, and non-selective queries on large objects are rejected with an error that asks for a selective filter). Sharing rules (row-level access) are joined via precomputed sharing tables, so the results respect permissions.`,
      },
      {
        topic: "Isolation, limits and pods",
        discussion: `All orgs on a pod share the database, so isolation is enforced by **OrgID in every key and every generated query** (the compiler is the only path to SQL; no raw SQL is allowed for tenants) and tested aggressively. Noisy neighbours are contained by **governor limits** per transaction, per-org API request limits per 24 h, concurrency limits on long-running requests, and asynchronous processing queues (Bulk API, batch jobs) with fair scheduling. Placement across pods spreads the big orgs, and an org can be migrated to another pod (with a maintenance window, or live copy plus cutover). Pods also define the failure domain: an incident affects one instance, not all customers.`,
      },
    ],
    tradeoffs: [
      "Flex columns give a stable physical schema and cheap customisation, at the cost of weak typing and pivot-table maintenance",
      "Per-tenant DDL gives native performance but can't scale to 150K orgs × hundreds of objects",
      "Governor limits protect the shared platform but frustrate developers with hard caps",
      "Pods/cells limit blast radius but make cross-org features and org migrations harder",
      "Synchronous pivot index maintenance keeps queries correct but increases write amplification",
    ],
    followUps: [
      { q: "How does a tenant add an index on a custom field?", a: "It's a metadata flag. A background job backfills the pivot rows (MT_Indexes) for existing records, and new writes maintain them synchronously." },
      { q: "How do you run a platform upgrade without breaking customisations?", a: "Because customisations are metadata interpreted by the runtime, the platform upgrades code while APIs stay versioned, and a huge regression suite runs against tenant metadata samples." },
      { q: "How would you implement full-text search across custom objects?", a: "Asynchronously index the searchable fields into a per-pod search cluster with OrgID and sharing info, and filter results by user permissions at query time." },
    ],
    relatedTopics: ["design-advanced", "db-indexing", "db-fundamentals", "db-sharding", "api-evolution", "prod-scale"],
  },
  {
    id: "co-salesforce-2",
    company: "salesforce",
    title: "Design a Bulk API to import 50M records per tenant job",
    frequency: "medium",
    level: "LMTS / PMTS",
    prompt:
      "Design an asynchronous Bulk API where a tenant uploads a CSV with up to 50M records to insert or upsert into an object, processed in parallel with per-record results, without hurting other tenants on the same pod.",
    clarifyingQuestions: [
      "Operations: insert, update, upsert on an external id, delete?",
      "File size limits (e.g. 150 MB per upload, multiple uploads per job)?",
      "Must triggers, validation rules and workflows run per record?",
      "Result reporting: per-record success or failure with error reasons, downloadable?",
      "Ordering constraints: parent records before children?",
    ],
    functional: [
      "Create a job; upload data in chunks; close the job to start processing",
      "Process in parallel batches; apply validation and triggers per record",
      "Report progress and per-record results (successful, failed with errors)",
      "Abort a job; retry failed records",
    ],
    nonFunctional: [
      "Throughput of ~10–50K records/s per job on a quiet pod, adaptive under load",
      "Tenant fairness: bulk jobs must not starve interactive traffic",
      "Durable and resumable (worker crashes resume without duplicates)",
      "Correct locking behaviour (avoid lock contention on parent records)",
    ],
    estimation: [
      { label: "Job size", calc: "50M records × 500 B ≈ 25 GB CSV → uploaded in ~170 chunks of 150 MB" },
      { label: "Batches", calc: "Split into 10K-record batches → 5,000 batches per job" },
      { label: "Time", calc: "At 20K records/s with 20 parallel workers (1K/s each) → 50M ÷ 20K ≈ 42 minutes" },
      { label: "Results", calc: "50M result rows × ~100 B ≈ 5 GB → stored as files in object storage" },
    ],
    highLevelDesign: `**API (following Salesforce Bulk API 2.0 semantics):**
1. \`POST /jobs {object: Invoice__c, operation: upsert, externalIdField: ExtId__c}\` returns a jobId (state Open).
2. \`PUT /jobs/{id}/batches\` uploads CSV data (chunks go directly to **object storage**, not app memory, streamed with checksums).
3. \`PATCH /jobs/{id} {state: UploadComplete}\` makes the job eligible for processing.
4. \`GET /jobs/{id}\` returns progress, and \`GET /jobs/{id}/successfulResults\`, \`/failedResults\` return result files.

**Processing:**
- A **splitter** reads the uploaded files and cuts them into batches (10K records), recorded in a \`bulk_batch\` table (jobId, batchNo, offsets, state).
- Batches go into a **per-tenant fair queue**. A pod-level **bulk scheduler** gives each org a concurrency budget (e.g. max 10 batches in flight per org), weighted by edition, and **throttles globally when the pod's DB load is high** (a feedback loop on DB CPU, lock waits and replication lag).
- **Workers** process one batch in database transactions of ~200 records (the platform's trigger batch size), running validation rules, triggers and workflows through the same runtime as the UI (governor limits apply per chunk). Per-record results are appended to a result file part in object storage.
- **Checkpointing:** batch state goes from processing to completed with the result file pointer. If a worker dies mid-batch, the batch is retried. Upserts are naturally idempotent by external id, while inserts use a batch-level record-to-id mapping to skip already-inserted rows (or the job is declared at-least-once for inserts, with dedup via external ids recommended).

**Lock contention:** records referencing the same parent (e.g. 1M contacts under one account) contend for the parent's lock during rollup updates. Sorting the input by parent id and processing a parent's records in the same batch (serially) avoids cross-batch lock waits. Otherwise, fall back to serial mode for the job.`,
    deepDives: [
      {
        topic: "Protecting the shared database",
        discussion: `A single tenant's 50M-record import could saturate the pod's database, slowing thousands of other orgs. The bulk scheduler is **adaptive**: it tracks the pod's health signals (DB CPU, I/O wait, lock wait time, replica lag, interactive p95 latency) and scales the bulk worker concurrency down when they degrade, like TCP congestion control (additive increase, multiplicative decrease). Per-org caps prevent one org from occupying all bulk slots. Bulk work runs at lower priority than interactive requests in the app tier. Daily limits on the number of bulk batches per org also bound abuse. That's the Salesforce governor-limit philosophy applied to async work.`,
      },
      {
        topic: "Idempotency and resumability",
        discussion: `Jobs run for hours, so failures mid-flight are normal. Each batch is a unit of retry with a durable state machine (Queued → InProgress (with a worker lease) → Completed or Failed). A lease expiry makes an orphaned batch re-queue. For **upsert**, re-processing is safe because the external id makes it an update the second time. For **insert**, a retry could create duplicates. Mitigate by persisting, per sub-transaction of 200 records, the source row numbers committed (in the same DB transaction as the inserts), so a resumed batch skips committed chunks. Results are written per chunk and merged at the end. Clients get clear docs: prefer upsert with external ids for exactly-once imports.`,
      },
      {
        topic: "Per-record errors and result files",
        discussion: `Import quality problems (invalid picklist values, a failed validation rule, a missing parent reference) must not fail the whole job. Each record's outcome is captured: success with the new record id, or failure with the error code and message and the original row. Chunk-level transactions use "partial success" semantics, where good records commit and bad ones are reported. However, triggers that throw roll back the whole 200-record chunk, which is then retried record by record to isolate the bad row (a bisect-on-failure strategy). Result files are CSVs in object storage with a presigned download URL, kept for 7 days. Progress counters (processed, failed) are updated per batch for polling.`,
      },
    ],
    tradeoffs: [
      "Larger batches have better throughput but a bigger retry unit and more lock contention",
      "Adaptive throttling protects neighbours but makes job completion time unpredictable",
      "Running full triggers and validation per record gives correctness at a big CPU cost; offer a fast path for trusted loads",
      "Parallel mode is fast; serial mode avoids parent lock contention; auto-detect or let users choose",
    ],
    followUps: [
      { q: "A customer imports children before parents. How do you handle relationships?", a: "Support references by external id, resolved at processing time. Missing parents fail those records with a clear error, and users can import parents first or use a multi-object job with dependency ordering." },
      { q: "How would you let the job continue after a pod failover?", a: "Job and batch state plus the uploaded files are durable (DB plus object storage). Workers on the recovered pod resume queued and leased-out batches after lease expiry." },
      { q: "How is this different from the synchronous REST API?", a: "REST handles 1–200 records per call with immediate results. Bulk is asynchronous and chunked, with its own fair scheduling and limits, and it's optimised for throughput over latency." },
    ],
    relatedTopics: ["api-design", "prod-async-failure", "mq-scenarios", "db-connections-locks", "object-storage", "rate-limiting"],
  },
  // ---------------------------------------------------------------- Adobe
  {
    id: "co-adobe-1",
    company: "adobe",
    title: "Design an e-signature workflow service (Adobe Acrobat Sign)",
    frequency: "medium",
    level: "MTS-2 / Senior Computer Scientist",
    prompt:
      "Design a service where a sender uploads a document, defines signers in order or in parallel, each signer signs via a link, and the final PDF is sealed with a tamper-evident audit trail that holds up legally.",
    clarifyingQuestions: [
      "Signing order: sequential, parallel, or mixed groups? Reminders and expiry?",
      "Signer authentication: email link only, OTP, government ID, or a digital certificate (for qualified signatures under EU eIDAS)?",
      "Legal requirements: an audit trail of all events (IP, timestamps), document hash and tamper evidence?",
      "Volume: millions of agreements per day? Enterprise integrations (Salesforce, Workday) via API and webhooks?",
      "Data residency (EU, India) and retention policies?",
    ],
    functional: [
      "Create an agreement: upload a document, place fields, define participants and routing",
      "Notify signers; signing session (view, fill, sign); decline or delegate",
      "Workflow engine advances routing; reminders and expiry",
      "Seal the final PDF (a digital signature + certificate), generate the audit report; webhooks to integrators",
    ],
    nonFunctional: [
      "Integrity: any modification after signing is detectable",
      "Non-repudiation: every event is attributable and time-stamped (trusted timestamps)",
      "Durability and availability of legal records for 10+ years",
      "Security: document encryption at rest, least-privilege access, residency",
    ],
    estimation: [
      { label: "Agreements", calc: "~5M agreements/day ≈ 60/s average, peak ~500/s (month/quarter-end)" },
      { label: "Documents", calc: "Average 1 MB → 5 TB/day of originals + signed versions ≈ 10 TB/day → ~3.6 PB/year in object storage" },
      { label: "Events", calc: "~15 audit events per agreement → 75M events/day ≈ 870/s" },
      { label: "Signing sessions", calc: "~10M signer sessions/day; page renders ~50 pages each → rendered images cached on CDN" },
    ],
    highLevelDesign: `**Core services:**
1. **Agreement service:** agreement metadata, participants, routing definition, and state machine (DRAFT → OUT_FOR_SIGNATURE → SIGNED | DECLINED | EXPIRED | CANCELLED), in a relational DB sharded by account.
2. **Document service:** stores originals in **object storage** (encrypted with per-account keys via KMS, residency-specific buckets). It computes a **SHA-256 hash** at upload and renders pages to images for the signing UI (cached behind signed CDN URLs).
3. **Workflow engine:** the routing is modelled as a DAG (groups in sequence, and signers in parallel within a group). Events such as SignerCompleted advance the workflow and activate the next participants. Durable timers handle reminders and expiry (Temporal-style or a scheduler service).
4. **Signing service:** a signer opens a unique, expiring, high-entropy **signing link** (the token is hashed at rest), optionally with second-factor authentication. It records field values and signature images or typed names, bound to the document hash.
5. **Audit service:** an **append-only, hash-chained event log** per agreement. Each event (created, emailed, viewed, signed, with IP, user agent and timestamp) includes the previous event's hash, and events are time-stamped by a trusted time source (RFC 3161 TSA).
6. **Sealing:** when all participants finish, the **flattening service** merges the field values into the PDF, appends the audit report, and applies a **PDF digital signature (PAdES)** using a certificate held in an **HSM**, with a trusted timestamp. Any byte change breaks the signature in Acrobat.
7. **Notifications and webhooks:** email/SMS via providers, and integrator webhooks (signed, retried) through an outbox.

**Scale-out:** everything except the per-agreement state machine is stateless, and agreements shard by account, so month-end peaks are handled by adding workers.`,
    diagram: `Sender ─► Agreement svc (state machine) ─► Document svc (S3 + KMS, hash)
               │ routing DAG                      │ page renders (CDN)
               ▼                                   │
        Workflow engine (timers: reminders/expiry)  │
               │ activate signer                    │
               ▼                                    ▼
    Notification svc ─► signer email link ─► Signing svc (auth, fields)
               │                                    │ events
               ▼                                    ▼
        Webhooks (outbox)            Audit log (append-only, hash-chained, TSA)
                                                    │ all signed
                                                    ▼
                               Seal: flatten + audit report + PAdES (HSM)`,
    deepDives: [
      {
        topic: "Tamper evidence: hashes, chains and PDF signatures",
        discussion: `Three layers. (1) The **document hash** (SHA-256) is taken at upload, and every signing event references it, so a signer provably signed that exact content. (2) The **hash-chained audit log**: event_n.hash = SHA256(event_n.payload || event_(n−1).hash), with periodic anchoring (e.g. a daily Merkle root signed by an HSM key, or a transparency log), so altering any past event breaks the chain. (3) The **final PAdES signature** on the sealed PDF with an HSM-protected certificate from a trusted CA, plus an RFC 3161 timestamp. Anyone can validate it offline in a PDF reader, which is what courts rely on. Long-term validation (LTV) embeds the certificate revocation data so signatures remain verifiable after certificates expire.`,
      },
      {
        topic: "Workflow correctness under concurrency",
        discussion: `Parallel signers can finish at the same moment, and both events try to advance the workflow. Use the agreement row as the concurrency boundary: each transition is a transaction with optimistic versioning (\`UPDATE agreement SET version = version + 1, state = … WHERE id = ? AND version = ?\`), or all events for one agreement go through a single partition (Kafka keyed by agreementId), so the workflow processes them serially. Event handling is idempotent (the signerId + action pair is unique), so retried events don't double-advance. Timers (reminders every 3 days, expiry at 30 days) are durable and cancelled on completion. A late signature after expiry is rejected by the state check.`,
      },
      {
        topic: "Security and residency",
        discussion: `Documents are contracts and HR records, so they're highly sensitive. Encrypt them per account with KMS envelope encryption (customer-managed keys for enterprise). Signing links are single-purpose bearer tokens: long random values, hashed in the DB, scoped to one participant and agreement, expiring, and optionally requiring an OTP or knowledge-based authentication. Access by the sender's organisation follows RBAC and is audited. Residency means the account is homed to a region (EU, IN, US) with its storage, database and processing there, and no cross-region replication of document content. Retention policies (auto-delete after N years) are enforced by lifecycle rules, with legal hold overrides.`,
      },
    ],
    tradeoffs: [
      "A hash-chained log gives tamper evidence without a blockchain; anchoring roots externally adds independent proof",
      "Email-link signing is frictionless but weaker identity; stronger authentication (OTP, ID) adds friction",
      "Rendering pages server-side to images is secure and consistent, but costs compute and storage compared with client-side PDF rendering",
      "Per-agreement serial processing is simple and correct but limits throughput for massive bulk sends (fine at this scale)",
    ],
    followUps: [
      { q: "How do you handle a bulk send to 10,000 employees?", a: "A parent agreement template fans out into 10K child agreements via an async job with rate-limited emails. Each child has its own workflow and audit log, and the parent shows aggregate status." },
      { q: "A signer claims they never signed. What evidence do you have?", a: "The audit trail (email delivery, link opened from an IP and device, authentication method, timestamps from the TSA, and the document hash) plus the sealed PDF signature and certificate chain." },
      { q: "How do you support qualified electronic signatures in the EU?", a: "Integrate with qualified trust service providers: the signer authenticates with the provider and signs with a certificate-backed key (remote HSM or a smart card), producing a signature that meets the eIDAS QES requirements." },
    ],
    relatedTopics: ["security-general", "api-security", "object-storage", "ds-transactions", "mq-fundamentals", "design-storage"],
  },
  {
    id: "co-adobe-2",
    company: "adobe",
    title: "Design a real-time customer profile and segmentation platform",
    frequency: "medium",
    level: "MTS-2 / Senior",
    prompt:
      "Design a platform (like Adobe Experience Platform) that ingests events from web, mobile, email and CRM for enterprise brands, merges them into a unified customer profile, and evaluates audience segments in real time for personalisation.",
    clarifyingQuestions: [
      "Identity: how do we stitch anonymous cookies, device ids, emails and CRM ids into one person?",
      "Segment types: streaming (qualify within seconds), batch (daily), edge (at page load)?",
      "Scale per brand: 100M profiles, 1B events/day? Multi-tenant across thousands of brands?",
      "Privacy and consent: GDPR/CCPA deletion, consent flags per channel?",
      "Destinations: activate segments to ad platforms, email tools, on-site personalisation?",
    ],
    functional: [
      "Ingest streaming and batch data with schemas (XDM-like)",
      "Identity resolution graph; merged profile view per person",
      "Segment definitions (e.g. visited pricing page twice in 7 days AND not a customer) evaluated streaming and batch",
      "Profile lookup API for personalisation (<50 ms); activation to destinations; consent and deletion",
    ],
    nonFunctional: [
      "Streaming segment qualification within ~1–5 minutes; edge lookup under 50 ms",
      "Tenant isolation (brand data never mixes); per-tenant quotas",
      "Privacy compliance: deletion requests completed within regulatory windows",
      "Scale: tens of billions of events per day across tenants",
    ],
    estimation: [
      { label: "Events", calc: "Large brand: 1B events/day ≈ 12K/s; platform total ~50B/day ≈ 580K/s" },
      { label: "Profiles", calc: "~10B profiles platform-wide; the hot profile (attributes + recent aggregates) is ~2 KB → ~20 TB in the online store, with full event history in the data lake" },
      { label: "Identity graph", calc: "~3 identities per person → 30B nodes, ~40B edges → partitioned graph store (~5 TB)" },
      { label: "Segment evaluations", calc: "Average 200 streaming segments per tenant; each event triggers only segments referencing its event type → ~5 evaluations/event → ~3M evaluations/s" },
    ],
    highLevelDesign: `**Ingestion:** SDKs and edge collectors send events with a schema (event type, identities such as ECID cookie, email hash and CRM id, timestamp, payload) to **Kafka**, partitioned by tenant and identity. Batch loads (CRM exports) land in the **data lake** and are replayed through the same pipeline.

**Identity resolution:** each event carries one or more identities. The **identity graph service** links identities that co-occur (a login event links cookie X to email Y), using union-find semantics per tenant, to produce a stable **person id** (the cluster id). The graph is stored partitioned by identity, with a cache for hot lookups. Merge rules prevent over-merging (a shared family device, or a cap on cluster size).

**Profile store:** an online, low-latency KV store (Cassandra/Aerospike-like, or Azure Cosmos DB, which Adobe uses) keyed by (tenant, personId), holding profile attributes (the merged view with per-attribute precedence by source and timestamp), **pre-aggregated behavioural features** (counts per event type in rolling windows) and **segment memberships**.

**Streaming segmentation:** a stream processor (Flink/Spark streaming) keyed by (tenant, personId) updates the rolling aggregates and evaluates the segment definitions affected by the event type (an index from event type to segments). Qualification changes emit **SegmentQualified/Exited** events to activation.

**Batch segmentation:** a daily Spark job over the lake computes complex segments (long windows, heavy joins) and writes memberships back.

**Edge personalisation:** at page load, an edge service looks up the profile's segments (and the next-best offer) from a regional replica or cache in <50 ms.

**Activation:** destination connectors send qualifications to ad platforms and email tools with rate limits and retries, using hashed identifiers where required.

**Privacy:** consent attributes gate activation. A **deletion service** removes a person across the profile store, graph, lake (for example via Iceberg deletes) and destinations, with an auditable job status.`,
    deepDives: [
      {
        topic: "Identity stitching without over-merging",
        discussion: `Union-find on co-occurring identities is powerful but dangerous: a shared kiosk device or a support agent's login can merge thousands of people into one "super profile". Guardrails: identity namespaces with priorities (a CRM id beats an email, which beats a cookie). Limits: one CRM id per cluster, and a cap on the number of devices per person (splitting the oldest links). Mark devices as shared when they're seen with many logins. Merges are recorded as graph edges with timestamps and sources, so un-merging is possible. The person id should be stable: when clusters merge, keep the oldest id and alias the others, and downstream systems receive merge events so they can combine state.`,
      },
      {
        topic: "Evaluating segments on a stream efficiently",
        discussion: `A naive approach re-evaluates every segment for every event, which is 200 segments × 580K events/s. Instead, compile each segment into (a) the event types it depends on and (b) the aggregate features it needs (e.g. count of "pricing_view" in 7 days). Per event, update only those aggregates (with sliding-window state per person) and evaluate only the dependent segments (usually 1–5). Features are maintained as time-bucketed counters (daily buckets for a 7-day window) so expiry works without replaying events. Segments with conditions on profile attributes are re-evaluated when the attribute changes. The output is a membership delta, and only changes are emitted to activation, which keeps the downstream volume low.`,
      },
      {
        topic: "Multi-tenancy and privacy at scale",
        discussion: `Each brand is a tenant with its own schemas, identity graph, profile namespace and segment definitions. Isolation is enforced by tenant keys in every partition key, per-tenant encryption keys, and sandbox environments (dev and prod) per tenant. Quotas cover events/s, profile count and segment count, and a noisy tenant's ingestion is throttled at the edge. Privacy requests (the GDPR right to erasure) fan out via a deletion job: find all identities in the person's cluster, delete them from online stores immediately, propagate to the lake (compaction removes them from files), call destination deletion APIs, and record completion. Consent (marketing opt-out) is checked at activation time for each channel.`,
      },
    ],
    tradeoffs: [
      "Streaming segmentation is fresh but expensive in state; batch is cheap and handles complex logic but is stale",
      "Aggressive identity merging finds more matches but risks false merges; conservative merging misses links",
      "Pre-aggregated features make evaluation fast but limit ad-hoc segment logic to supported aggregates",
      "A regional profile replica for edge lookups is fast but eventually consistent",
    ],
    followUps: [
      { q: "A marketer creates a new streaming segment. How do existing profiles get evaluated?", a: "Backfill via a batch evaluation over the current profiles and lake history, then switch to streaming for new events. The segment status shows the backfill progress." },
      { q: "How do you guarantee a deleted user doesn't reappear from a late batch import?", a: "Keep a deletion tombstone list per tenant, checked at ingestion to drop matching identities for a retention period." },
      { q: "How would you personalise within 50 ms at the edge?", a: "Replicate segment memberships and key attributes to edge-region caches keyed by the cookie identity, and fall back to a default experience on a miss or timeout." },
    ],
    relatedTopics: ["data-pipelines", "mq-scenarios", "design-advanced", "db-sharding", "security-general", "cache-fundamentals"],
  },
  // ---------------------------------------------------------------- Walmart
  {
    id: "co-walmart-1",
    company: "walmart",
    title: "Design store-level inventory availability for \"Pickup today\"",
    frequency: "high",
    level: "SDE-3 / Staff",
    prompt:
      "Design the system that shows accurate \"In stock at your store, pickup today\" availability for ~500K SKUs across ~4,700 stores, and reserves units when a customer places a pickup order.",
    clarifyingQuestions: [
      "What are the sources of truth: store POS sales, receiving, cycle counts, online orders?",
      "How fresh must availability be: within a minute of a POS sale?",
      "How accurate: do we show \"limited stock\" when counts are low (inventory records are imperfect)?",
      "What happens if a store's network link to the cloud is down?",
      "Peak: Black Friday online traffic ~50× normal?",
    ],
    functional: [
      "Maintain the available-to-promise quantity per (store, SKU) from store events",
      "Serve availability on product pages and search (single and batch lookups)",
      "Reserve units for pickup orders; release them on cancellation or expiry; commit on pick",
      "Safety stock and confidence levels to avoid overselling phantom inventory",
    ],
    nonFunctional: [
      "Read-heavy: ~200K availability lookups/s at peak with p99 under 30 ms",
      "Freshness under 1 minute from POS sale to online availability",
      "Oversell rate below ~1% of pickup orders",
      "Stores keep operating when disconnected; data syncs when they reconnect",
    ],
    estimation: [
      { label: "Inventory records", calc: "4,700 stores × ~100K SKUs actually stocked per store ≈ 470M (store, SKU) rows × 100 B ≈ 47 GB" },
      { label: "Store events", calc: "~25M POS line items/day nationally + receiving and counts → ~500/s average, ~5K/s peak" },
      { label: "Reads", calc: "Product pages + search results (each shows 20–40 items × nearby stores) → ~200K lookups/s peak" },
      { label: "Reservations", calc: "~2M pickup orders/day × 5 lines ≈ 10M reservations/day ≈ 115/s, peak ~2K/s" },
    ],
    highLevelDesign: `**Event-driven inventory:**
1. **Store systems** (POS, receiving, cycle counts, returns) run locally in each store and publish inventory events to a **store-edge agent**, which buffers durably when the WAN is down, then to **Kafka** in the cloud (partitioned by storeId, keeping per-store ordering). Events carry a store sequence number for dedup and ordering.
2. The **inventory service** (sharded by storeId, with Cassandra or Azure Cosmos DB, which Walmart uses along with Cassandra) maintains per (store, SKU): \`on_hand\`, \`reserved\` (for pickup orders), \`safety_stock\`, \`last_counted_at\`, and \`confidence\`.
3. **Available to promise** = on_hand − reserved − safety_stock, where safety stock depends on the SKU's shrink and error history.
4. **Availability read path:** a **read-optimised projection** in Redis/Memcached, keyed by (storeId, SKU), holding ATP and a display state (in stock / limited / out of stock), updated by consumers within seconds. A batch API supports lookups of up to 100 SKUs per store, and search results use a per-store bitmap of in-stock SKUs for filtering.
5. **Reservations:** the order service calls the inventory service with an idempotency key. It does a conditional update \`reserved += q WHERE on_hand − reserved − safety_stock >= q\` with a TTL (released if the order is not picked within e.g. 48 h) and an event to the projection.
6. **Pick and commit:** the store associate picks. The picker app confirms the actual quantity (it may be short), the reservation converts to a sale (on_hand −= q, reserved −= q), and substitutions or short picks are handled.

**Offline stores:** the store keeps selling, and POS events queue locally. Online, the store's availability shows as "limited" (or is hidden) once the data is older than N minutes. On reconnect, events replay in sequence order.`,
    diagram: `Store: POS / receiving / counts ─► Store edge agent (durable buffer)
                                            │ WAN (may be down)
                                            ▼
                                 Kafka (partition by storeId)
                                            │
                                            ▼
          Inventory service (sharded by store): on_hand, reserved, safety
                 ▲         │ ATP changes
    reserve/     │         ▼
    release      │   Availability projection (Redis: store,SKU → ATP/state)
 Order svc ──────┘         │
                           ▼
             Product page / search (batch lookups, in-stock bitmaps)
 Picker app ─► confirm pick → commit sale / short pick → event`,
    deepDives: [
      {
        topic: "Phantom inventory and safety stock",
        discussion: `Store inventory records are notoriously inaccurate (studies of retail record accuracy find a large share of SKU-store records are wrong), because of shrink, misplaced items and receiving errors. Showing "in stock" when the shelf is empty causes failed pickups. Mitigations: **safety stock per SKU-store** computed from historical shrink and pick-failure rates (hold back 1–3 units for high-risk items), a **confidence score** that decays with time since the last cycle count, and **display thresholds** (show "limited stock" when ATP is below 3). Feed pick failures back: when an associate reports an item missing, immediately zero it out in the projection and trigger a cycle count. This closed loop matters more than millisecond freshness.`,
      },
      {
        topic: "Stores as edge nodes",
        discussion: `Each store is effectively an edge data centre with its own POS and inventory state, connected over a WAN that sometimes fails. Design for disconnection: the store remains the source of truth for physical movements and buffers events durably (a local queue on disk), with monotonically increasing per-store sequence numbers. The cloud consumer applies events idempotently in sequence order (skipping duplicates, and detecting gaps to request a replay). Online, the freshness of each store's data is tracked. If stale beyond a threshold, availability degrades to "check in store" rather than risking oversells. Reservations made online while the store is offline are held in the cloud and synced to the store's picking queue on reconnect.`,
      },
      {
        topic: "Serving 200K lookups/s cheaply",
        discussion: `Product and search pages need availability for many SKUs across the customer's preferred store (plus nearby stores). The projection is keyed by store and SKU, so a batch GET for (store, 40 SKUs) is one pipelined Redis call. For search filtering ("in stock at my store"), maintain a **per-store bitmap of in-stock SKU ordinals** (Roaring bitmaps, ~500K bits ≈ 60 KB per store), updated by the consumer and intersected with search results in the search tier. The CDN can't cache this per user, but per-store results can be cached for ~30 s. On Black Friday, pre-scale the projection cluster and add in-process caches of 5–10 s for the hottest SKUs.`,
      },
    ],
    tradeoffs: [
      "Safety stock reduces oversells but hides sellable units (lost sales); tune per SKU risk",
      "Event-driven projections give fast reads but eventual consistency; reservations must use the authoritative store",
      "Store-as-source-of-truth tolerates disconnects but complicates reconciling online reservations",
      "Bitmaps for search filtering are compact and fast but need rebuilds when SKU ordinal mappings change",
    ],
    followUps: [
      { q: "How do you handle a customer's order when the item is short at pick time?", a: "The picker app offers substitutions (by customer preference) or a partial fulfilment. The reservation adjusts, the customer is notified, and payment is adjusted (captured for the picked amount only)." },
      { q: "How would you add \"ship from store\"?", a: "It's the same ATP with a separate reservation channel and store capacity constraints (picking labour). An order-routing service chooses the store by ATP, distance and capacity." },
      { q: "How do you reconcile online and physical counts?", a: "Nightly cycle counts and associate counts publish absolute on-hand values that reset drift, logged as adjustments with reasons for shrink analytics." },
    ],
    relatedTopics: ["design-commerce", "data-pipelines", "cache-fundamentals", "mq-scenarios", "ds-consistency", "rel-dr"],
  },
  {
    id: "co-walmart-2",
    company: "walmart",
    title: "Design price-change propagation across online and 4,700 stores",
    frequency: "medium",
    level: "SDE-3 / Staff",
    prompt:
      "Design the pricing platform that lets merchants change prices (regular, rollbacks, clearance) for millions of SKUs, and propagates them consistently to the website, apps, and store POS and electronic shelf labels by an effective time.",
    clarifyingQuestions: [
      "Price hierarchy: national, zone or region, store-specific, online-only?",
      "Effective-dated changes (a rollback starts Thursday at 00:00 local time)? How far ahead are they scheduled?",
      "Scale: how many price changes per day (millions in a bulk markdown)?",
      "Consistency: must the shelf label, the POS and online match at the effective time (legal pricing accuracy)?",
      "Competitive price matching or algorithmic pricing inputs?",
    ],
    functional: [
      "Author price changes (single and bulk) with an effective start/end time and zone/store scope",
      "Resolve the effective price per (SKU, store/channel, time) through the hierarchy",
      "Distribute to online pricing caches, store POS, and electronic shelf labels at the right time",
      "Audit: who changed what, when; rollback of a mistaken bulk change",
    ],
    nonFunctional: [
      "Correctness at effective time (POS charges the shelf price); legal compliance",
      "Bulk: apply 5M changes in under an hour",
      "Online price lookups ~300K/s under 10 ms",
      "Stores operate offline with the last known prices, plus pre-staged future prices",
    ],
    estimation: [
      { label: "Price points", calc: "~1M SKUs in store assortment × 4,700 stores → if fully materialised 4.7B (store, SKU) prices; with zones (~200) → ~200M zone prices + store overrides" },
      { label: "Changes", calc: "~2M price changes/day normally; a clearance event of 5M; expanded to stores → up to 5M × avg 1,000 stores = 5B store-level updates (why zones matter)" },
      { label: "Online reads", calc: "~300K price lookups/s (pages, search, cart) → Redis/in-memory keyed by (SKU, zone)" },
      { label: "Store payload", calc: "Per store per day ~50K changed SKUs × 100 B ≈ 5 MB → tiny; ship as effective-dated deltas" },
    ],
    highLevelDesign: `**Authoring and resolution:**
1. The **price authoring service** stores price change records (not current prices): \`(sku, scope: national/zone/store, type: regular/rollback/clearance, price, effective_from, effective_to, author, reason)\`, in a relational DB with full audit. Bulk changes come in as files and jobs (validated, simulated for margin impact, approved).
2. The **resolution engine** computes the effective price per (SKU, zone or store, channel) at any time using precedence rules (for example, clearance beats rollback, which beats regular, and store beats zone, which beats national), and it's **materialised as a timeline** per key: the current price plus future scheduled changes.

**Distribution:**
- **Online:** the resolved current prices go to a **pricing cache** (Redis cluster keyed by SKU + zone) used by product, search and cart services. A scheduler flips each price at its effective time (per time zone). The cart re-prices at checkout from the same service for correctness.
- **Stores:** each store receives **effective-dated price files/deltas ahead of time** (for example, tonight's package contains Thursday's rollback with effective_from). The store's POS and ESL (electronic shelf label) system applies them locally at the effective time, even without WAN connectivity at that moment. Delivery goes over a reliable event pipeline (Kafka → store edge agent) with per-store sequence numbers and acknowledgements.
- Shelf labels: the ESL controllers update the display at the effective time, and paper-label stores print the new labels the evening before with the change time.

**Consistency guarantee:** because both online and stores apply the **same effective-dated records** at the same time (store-local time), POS and shelf agree without synchronous coordination. Stores acknowledge receipt, and a dashboard flags stores missing packages before the effective time.

**Rollback:** reverting a bulk change is a new change set with an earlier effective time or a cancel, and it propagates the same way. Audit shows both.`,
    deepDives: [
      {
        topic: "Effective dating instead of push-at-time",
        discussion: `Pushing 5 billion updates at exactly 00:00 across thousands of stores and caches would be fragile: network hiccups mean some stores flip late, and POS and shelf disagree, which is a legal risk. **Effective-dated records shipped in advance** turn a timing problem into a data problem: each consumer holds the future price with its start time and switches locally by its own clock (NTP-synced). Distribution can then happen hours earlier, with retries and acknowledgements, and a dashboard shows which stores haven't received the package, so ops can act before the deadline. Late-breaking changes (effective within minutes) take an expedited path, and if a store misses one, the POS applies the latest received price and flags the discrepancy.`,
      },
      {
        topic: "Hierarchy and fan-out control",
        discussion: `Materialising every price per store multiplies data by 4,700. Instead, keep prices at the coarsest scope that applies (national or zone), with store overrides only where they exist. The resolution result per store is computed lazily or incrementally: a zone price change affects the stores in that zone, but each store only needs the delta for SKUs it carries (its assortment), so the per-store package is small. Online, the cache key is (SKU, zone), with the customer's store mapped to a zone. The cart and checkout always resolve through the service, never trusting a stale page price, and if the price changed since the item was added, the customer is shown the new price.`,
      },
      {
        topic: "Safety for bulk changes",
        discussion: `A fat-finger bulk markdown (a 90% discount on electronics) can cost millions in minutes. Guardrails: validation rules (the max change percentage per category, margin floors, price under cost needs extra approval), **simulation** (a preview of the margin impact and the number of SKUs and stores affected), **approval workflows** for large changes, a **staged rollout** (online first in one zone, then wider), and a **kill switch** that stops distribution and reverts through a new change set. Every change is attributable (author, approver, reason) for audit. Monitoring alerts on anomalies: sudden order spikes on discounted SKUs or large price deltas. After an incident, the audit trail shows exactly which change set caused it and lets finance quantify the exposure.`,
      },
    ],
    tradeoffs: [
      "Effective-dated distribution is robust and offline-safe, but late changes need an expedited path",
      "Zone-level materialisation keeps data small, but store overrides add resolution complexity",
      "Re-pricing at checkout ensures correctness but can surprise customers if a price changed after they added the item",
      "Strict approval workflows add safety but slow down urgent competitive responses",
    ],
    followUps: [
      { q: "How do you handle time zones for a national rollback at midnight?", a: "Effective times are store-local (a timestamp plus the store's time zone), so each store flips at its own midnight, and online uses the customer's store zone." },
      { q: "How would you support algorithmic competitive pricing?", a: "An upstream pricing engine proposes changes as normal change records through the same validation and approval pipeline (auto-approved within guardrails), so distribution stays uniform." },
      { q: "A store's POS shows the old price after the effective time. How do you detect it?", a: "Stores acknowledge applied package versions, and POS transactions include the price version used. Monitoring compares them with the expected version per store and alerts on mismatches." },
    ],
    relatedTopics: ["data-pipelines", "cache-fundamentals", "mq-fundamentals", "prod-correctness-ops", "api-design", "ds-consistency"],
  },
  // ---------------------------------------------------------------- Flipkart
  {
    id: "co-flipkart-1",
    company: "flipkart",
    title: "Design the Big Billion Days flash sale backend",
    frequency: "very-high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the systems that let Flipkart run a Big Billion Days deal where 1 lakh units of a phone go on sale at 12:00 and ~1 crore users try to buy in the first few minutes, without overselling or taking the site down.",
    clarifyingQuestions: [
      "How much inventory vs demand (1 lakh units vs ~1 crore attempts)? A limit per user (1 unit)?",
      "When is inventory reserved: add-to-cart or order placement? What's the payment window?",
      "Payment methods: prepaid only, or COD allowed for deal items?",
      "Should traffic for non-deal pages (browsing) be protected from the deal surge?",
      "Fairness: first come first served, or a lottery/queue? How do we treat bots?",
    ],
    functional: [
      "Deal page with countdown; buy button active at 12:00",
      "Reserve a unit atomically for the buyer; order placement with a payment window (e.g. 10 min)",
      "Release unpaid reservations back to stock",
      "Per-user limits; bot and reseller mitigation",
    ],
    nonFunctional: [
      "No overselling; no double reservations for the same user",
      "Deal-path peak of ~5–10 lakh requests/s at T0, without degrading the rest of the site",
      "Fast failure: sold-out users learn quickly (under 1 s)",
      "Observability and kill switches per deal",
    ],
    estimation: [
      { label: "Attempts", calc: "1 crore users; 60% arrive within 60 s, 3 retries each → 1.8 crore requests ÷ 60 ≈ 3 lakh req/s average, spikes ~10 lakh/s" },
      { label: "Winners", calc: "1 lakh units → 99% of buyers must be told \"sold out\" cheaply" },
      { label: "Inventory ops", calc: "If gated, only ~1–2 lakh reservation attempts reach the inventory service over ~2 minutes ≈ 1–2K/s" },
      { label: "Page traffic", calc: "Deal page refreshes ~20 lakh/s at T0 → must come from CDN (static + cached JSON), not origin" },
    ],
    highLevelDesign: `**Layered defence, from the edge inward:**
1. **Static and CDN:** the deal page, images and countdown are CDN-cached. The client clock syncs with a server time endpoint. The buy button's state ("live" at 12:00) comes from a tiny cached JSON with a short TTL, so the origin doesn't take refresh storms.
2. **Admission control / waiting room:** at T0, buy clicks go to a **token issuance service** at the edge: users get a queue position (randomised within the first second for fairness), and a controller admits N users/s into the purchase flow with a signed **purchase token** (bound to user, deal and a 5-minute expiry). Bots are filtered here (device fingerprinting, account age, CAPTCHA for suspicious sessions).
3. **Stock gate (Redis):** each deal's stock is preloaded into Redis as a counter, split into **buckets** (e.g. 20 keys of 5,000 units across shards). An admitted request picks a random bucket and runs a Lua script: check the per-user limit key (\`SET user:{deal}:{uid} NX\`) and \`DECR\` the bucket if > 0 (otherwise try another bucket). Winners get a **reservation id**, and losers get "sold out" instantly. Once the gate hits zero, the deal flag flips to sold out at the CDN.
4. **Reservation and order service (durable):** winners create an order with an idempotency key (the reservation id). The inventory service records the reservation in its DB (MySQL, sharded by SKU) with a TTL of 10 minutes. The Redis gate is a fast filter, and the DB is the ledger.
5. **Payment window:** a reservation expiry job (a delayed queue) releases unpaid units: DB update, then increment the Redis bucket, and a new token batch is admitted for them.
6. **Isolation:** the deal path runs on dedicated capacity (separate pods, Redis and DB replicas), so browsing and other categories are unaffected. Kill switches exist per deal.`,
    diagram: `1 crore users ─► CDN (deal page, cached status JSON, time sync)
                      │ buy click
                      ▼
            Edge waiting room ─► signed purchase token (N/s admitted)
                      │ bot filter, per-user checks
                      ▼
       Stock gate: Redis buckets (Lua: user-limit NX + DECR bucket)
          │ winner (reservation id)            │ loser → "sold out" fast
          ▼
    Order svc (idempotent) ─► Inventory DB (reservation, TTL 10 min)
          │                               ▲
          ▼                               │ expiry job: release → Redis INCR
    Payment (PSP) ── success → confirm ───┘   (re-admit waiting users)`,
    deepDives: [
      {
        topic: "Why Redis buckets + DB, and consistency between them",
        discussion: `A single MySQL row for the deal's stock would serialise ~thousands of updates/s behind one row lock. The Redis gate absorbs contention in memory: Lua scripts are atomic per shard, and splitting the stock into 20 buckets across shards removes the single-key hotspot. But Redis isn't the ledger. After a gate win, the durable reservation in MySQL (with a unique (deal, user) constraint and a conditional decrement on the SKU's stock row, sharded or bucketed as well) is authoritative. If Redis says yes but the DB says no (drift), the user gets sold out and we log the drift. If the DB succeeds but the app crashes before replying, the idempotent retry with the same reservation id returns the existing reservation. Periodic reconciliation (the Redis counters vs DB available stock) corrects drift after the sale.`,
      },
      {
        topic: "Fairness and bot defence",
        discussion: `Reseller bots script requests at exactly 12:00:00.000. Defences: a **randomised queue position** for everyone who arrived before T0+1 s (removing the millisecond advantage), purchase tokens bound to a device fingerprint and logged-in account (with account age and past purchase checks), **per-user and per-address limits** (one unit), and velocity checks on payment instruments. CAPTCHA or OTP is added only for risky sessions, to keep genuine users fast. Post-sale, orders flagged as resellers (the same address for many accounts) can be cancelled. Communicate the queue honestly ("you are in line") rather than showing errors, which reduces retries and so load. Finally, keep a small share of units in reserve to handle cancellations and re-offer them to the queue, which reduces the incentive to hammer the buy button.`,
      },
      {
        topic: "Capacity planning and game days",
        discussion: `BBD is a known date, so capacity is planned rather than autoscaled on the fly. Model the traffic from previous years (peak QPS per service, 10× normal), pre-scale pods and Redis/DB replicas, warm caches (products, offers, pricing), and prewarm CDN objects. Run **load tests in production-like environments** and **game days** that simulate failures (a Redis shard down, a PSP slowdown) with runbooks. Graceful degradation plans shed non-critical features (recommendations, reviews, "similar items") via feature flags when latency rises. Rate-limit per user and device at the edge. Monitoring dashboards per deal show the tokens issued, gate wins, reservations, payments and expiries, so anomalies are visible within seconds.`,
      },
    ],
    tradeoffs: [
      "A waiting room adds friction but converts a spike into a controllable rate",
      "Redis gate is fast but not the ledger; the DB reservation stays authoritative, with reconciliation",
      "Reserve at order placement vs add-to-cart: prevents hoarding, but users may lose the deal at payment",
      "Bucketed stock removes hotspots but may report sold out slightly early while a few buckets still have units (retry across buckets)",
      "Dedicated deal infrastructure isolates the blast radius but costs extra reserved capacity",
    ],
    followUps: [
      { q: "Payment gateways slow down at T0. What happens to reservations?", a: "Extend payment windows slightly, queue payment attempts with backoff, and route to alternate PSPs. Expired reservations are released and re-offered through the waiting room." },
      { q: "How do you show an accurate \"X units left\"?", a: "Aggregate the Redis bucket counters every second into a cached value served via CDN. It's approximate and shown in ranges to avoid misleading precision." },
      { q: "How would you handle COD orders?", a: "Require confirmation (OTP), since COD has no payment step, and apply stricter per-user limits and fraud checks for deal items. The reservation converts to an order immediately." },
    ],
    relatedTopics: ["design-commerce", "rate-limiting", "cache-failures", "prod-scale", "cdn-global", "ds-concurrency"],
  },
  {
    id: "co-flipkart-2",
    company: "flipkart",
    title: "Design pincode serviceability and the delivery date promise",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the service that answers, for any product and a customer's pincode, whether it can be delivered and by which date (\"Delivery by Thu, 12 Oct\"), across ~19,000 pincodes, many warehouses and courier partners.",
    clarifyingQuestions: [
      "Inputs: seller or warehouse location(s) with stock, cut-off times, courier network capabilities (COD, heavy items)?",
      "Must the promise be honoured (SLA), and what accuracy target (e.g. 95% on time)?",
      "Latency: shown on product pages and search results (batch lookups)?",
      "Constraints: hazardous goods, large appliances needing installation, COD availability?",
      "Dynamic factors: warehouse capacity, sale-day backlogs, holidays, weather disruptions?",
    ],
    functional: [
      "Serviceability(product, pincode): can we deliver, by which modes (standard, express, COD)",
      "Delivery date promise considering stock location, cut-off, processing and transit time",
      "Batch API for search results and product listing pages",
      "Ops tools to disable pincodes or lanes quickly (floods, strikes)",
    ],
    nonFunctional: [
      "p99 under 20 ms per lookup; ~2 lakh lookups/s at sale peaks",
      "Promise accuracy ≥ 95%; err on the side of later dates rather than broken promises",
      "Near-real-time updates when capacity or lanes change (minutes)",
      "Highly available; fall back to conservative estimates",
    ],
    estimation: [
      { label: "Lanes", calc: "~1,500 origin nodes (warehouses/seller hubs) × 19,000 pincodes ≈ 2.9 crore (29M) origin-destination lanes × 50 B ≈ 1.5 GB → fits in memory" },
      { label: "Lookups", calc: "Search pages show 40 items for 1 pincode → 50K search QPS × 40 = 20 lakh item-lookups/s → only feasible with batching and caching by (origin set, pincode)" },
      { label: "Inventory locations", calc: "Per product, stock at 1–10 fulfilment centres → candidate origins small" },
      { label: "Updates", calc: "Capacity and lane changes a few thousand per hour; inventory changes ~10K/s (only origin availability matters)" },
    ],
    highLevelDesign: `**Decompose the promise:** delivery date = order time → **(1) fulfilment node selection** → **(2) processing time** at that node (pick, pack, cut-off for the day's dispatch) → **(3) linehaul + last-mile transit** for the lane (origin hub → destination pincode) → **(4) buffers** (holidays, weather, sale backlog).

**Data:**
- **Lane table** (in memory, replicated): \`(origin_node, dest_pincode) → {serviceable, modes (COD, express, heavy), transit_days by courier, cut_off_time}\`, built from the logistics network (Ekart and 3PL partners) and historical on-time performance.
- **Node capacity and processing:** per fulfilment centre, the processing SLA and current backlog multiplier (updated every few minutes from warehouse systems).
- **Holiday calendar** per region, and **disruption overrides** (a pincode or lane disabled by ops).
- **Inventory locations:** for each product, which nodes have stock (from the inventory service, cached).

**Serving:**
1. \`POST /promise:batch {pincode, items: [{listingId, qty}]}\`
2. For each item, get the candidate nodes with stock (usually 1–3). For each node, look up the lane → earliest dispatch date (now vs cut-off, plus processing and backlog) + transit days, skipping holidays.
3. Choose the node giving the best date (and cost), and return the date and modes. It's **deterministic and cacheable**: cache (listing-origin set, pincode, date bucket) results for a few minutes.

**Serving architecture:** stateless promise servers with the lane and calendar data **in memory** (loaded from a snapshot, updated by a Kafka stream of changes), so a lookup is pure computation (~microseconds). Inventory location data comes from a local cache refreshed by events.

**Checkout:** the promise is recomputed at order placement and **locked** into the order. The fulfilment system then must plan to meet it (it's used as the SLA for picking priority).`,
    deepDives: [
      {
        topic: "Where transit times come from",
        discussion: `Static SLA tables from couriers are optimistic. Build lane transit estimates from **historical shipment data**: for each lane (and courier, and service type), compute a high percentile (p90–p95) of actual delivery time, broken down by dispatch day of week, and refreshed daily by a batch job. Using a high percentile rather than the mean is what hits a 95% promise accuracy target. Sparse lanes fall back to hierarchical estimates (origin city → destination district averages). Real-time adjustments come from operational signals: a hub's backlog (shipments waiting vs throughput) adds days to lanes through that hub, and disruptions (floods, strikes) come in as overrides from ops dashboards and propagate within minutes via Kafka.`,
      },
      {
        topic: "Sale-day capacity and dynamic promises",
        discussion: `During BBD, warehouses receive 10× orders, and the standard processing time isn't achievable. Each fulfilment centre publishes its **capacity plan** (the orders it can process per day) and its current booked load. The promise service converts that into a dispatch date: if today's capacity is booked, the earliest dispatch moves to tomorrow. That makes promises honest under load. Capacity booking can be approximate (counters per node per day in Redis, incremented at order placement). Showing a later date loses a little conversion, while broken promises cost more (cancellations, support calls, lower trust). Product and ops agree the buffer policy per category.`,
      },
      {
        topic: "Batching and caching for search pages",
        discussion: `Search results need a date for 40 items for one pincode, and product listing pages render millions of times. Most items share origin nodes (a big FC holds many products), so the batch API groups items by candidate origin set and computes once per (origin set, pincode). Results are cached at the promise tier (keyed by origin set + pincode + date-hour) and optionally at the search tier for ~5 minutes. Search may use a coarser "delivery by" estimate (the fastest node only), while the product page and checkout compute the exact promise with quantity and modes. The fallback is a conservative default (e.g. 5–7 days) if the service times out, so pages never fail because of promise lookups.`,
      },
    ],
    tradeoffs: [
      "High-percentile transit estimates improve promise accuracy but show later dates than the average",
      "In-memory lane tables are fast and simple but need snapshot and stream updates and memory per server",
      "Exact per-quantity promises on search pages are costly; use coarse estimates in search and exact ones at the PDP and checkout",
      "Choosing the fastest node vs the cheapest node: speed vs logistics cost; expose it as a policy",
    ],
    followUps: [
      { q: "How do you decide which warehouse ships a multi-item order?", a: "An order-routing optimiser minimises splits and cost subject to the promised date. The promise shown per item assumed independent sourcing, so re-check at checkout." },
      { q: "A pincode floods. How fast can you stop promising deliveries there?", a: "Ops sets an override (the pincode is unserviceable, or delayed by N days). It's published via Kafka to all promise servers and applied within seconds, and caches keyed by pincode are invalidated." },
      { q: "How do you measure promise accuracy?", a: "Join the promised date with the actual delivery per order, and track on-time rates by lane, node and category daily. Retune percentiles and buffers where accuracy dips." },
    ],
    relatedTopics: ["design-geo", "cache-fundamentals", "data-pipelines", "prod-performance", "api-design", "design-commerce"],
  },
  // ---------------------------------------------------------------- Swiggy
  {
    id: "co-swiggy-1",
    company: "swiggy",
    title: "Design delivery partner assignment with order batching",
    frequency: "very-high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the system that assigns delivery partners to food orders: find a partner near the restaurant who arrives just as the food is ready, batch two orders going the same way, and handle declines and timeouts, at dinner peak across 500+ cities.",
    clarifyingQuestions: [
      "Scale: ~2–3 million orders/day, dinner peak ~5K orders/min in a big city?",
      "Objective: minimise the customer delivery time, partner idle time, or cost per delivery (a weighted combination)?",
      "Batching: at most 2 orders per trip, from the same or nearby restaurants?",
      "Offer flow: offer to one partner with a timeout (e.g. 30 s), or broadcast?",
      "Inputs: food preparation time predictions per restaurant, live partner locations and states?",
    ],
    functional: [
      "Track partner locations and states (idle, assigned, at restaurant, on delivery)",
      "For each new order, choose a partner (or a batch) based on predicted food-ready time and travel times",
      "Offer, accept/decline/timeout, and reassign",
      "Reassign when a partner goes offline or is delayed; customer ETA updates",
    ],
    nonFunctional: [
      "Assignment decisions within a few seconds; reassign quickly on declines",
      "Handle dinner peaks and rain surges (supply shortage)",
      "Consistency: a partner is never double-assigned",
      "City-level isolation; degrade to simpler greedy assignment if the optimiser is slow",
    ],
    estimation: [
      { label: "Orders", calc: "~30 lakh orders/day; the dinner peak is ~20% of the day in 2 h → 6 lakh ÷ 7,200 s ≈ 83 orders/s nationally, ~15/s in Bangalore" },
      { label: "Partners", calc: "~3 lakh active partners at peak; location ping every 5 s → 60K updates/s" },
      { label: "Candidate evaluation", calc: "Per order ~30 nearby partners × travel-time lookups → 83 × 30 ≈ 2.5K ETA calls/s (plus batch combinations)" },
      { label: "Batch window", calc: "Solve assignments every ~10–30 s per zone with ~50 orders × ~100 partners → small matching problems solvable in ms" },
    ],
    highLevelDesign: `**Inputs:**
- **Partner state service:** location (via the partner app, every 5 s → Kafka → a geo index by H3 cell per city), state machine (idle → assigned → at restaurant → picked up → delivered), current route, and shift status. Redis or an in-memory geo index sharded by city.
- **Prep-time prediction:** an ML model per restaurant and item mix, adjusted by the restaurant's current load (how many orders are in the kitchen). It outputs the predicted **food-ready time**.
- **Travel-time service:** road-network ETA between points with time-of-day traffic (a routing engine plus historical speeds per road segment), cached per cell pair.

**Assignment engine (per city zone):**
1. New orders enter a **pending pool**. Assignment runs in **micro-batches** every ~15 s (or immediately in low-load zones).
2. Candidate generation: for each order, the partners within k rings of the restaurant, including partners currently finishing a delivery nearby (predicted free time) and partners carrying an order where a batch is feasible.
3. Scoring: cost = w1 × customer delivery time + w2 × partner wait at the restaurant (arrive too early = idle) + w3 × extra distance + penalties (breaching the promised ETA, partner fairness). **The ideal is for the partner to arrive exactly at the food-ready time.**
4. Batching: pairs of orders with nearby restaurants, similar ready times and compatible drop directions are evaluated as a combined route (pickup A → pickup B → drop A → drop B, or other permutations), accepted if neither customer's ETA gets worse than a threshold.
5. **Solve** the matching (Hungarian or min-cost flow on the bipartite graph), and issue **offers**: CAS the partner's state idle → offered (with a 30 s expiry).
6. On decline or timeout, the order returns to the pool with a higher priority. Partners who repeatedly decline get fewer offers.

**Delay handling:** if the restaurant is running late (the kitchen marks it), the partner's route is re-planned, or the partner is released to another order and a new one is assigned later.`,
    diagram: `Partner app ─ GPS/5s ─► Kafka ─► Partner geo index + state (per city)
Restaurant/order events ─► Prep-time model ─► food-ready time
                                   │
New orders ─► Pending pool (per zone) ─► Assignment engine (every ~15 s)
                                   │   candidates (k-ring), travel ETAs,
                                   │   batching combos, cost matrix,
                                   │   min-cost matching
                                   ▼
                   Offer service: CAS partner idle→offered (30 s TTL)
                       │ accept → assigned        │ decline/timeout → pool
                       ▼
               Order tracking / customer ETA updates`,
    deepDives: [
      {
        topic: "Timing the partner's arrival with food readiness",
        discussion: `Assigning the nearest partner immediately is often wrong: if the food needs 20 minutes and the partner is 3 minutes away, they wait 17 minutes (wasted supply at peak), while a partner 15 minutes away finishing another drop would be ideal. The engine therefore plans against the **predicted food-ready time**, aiming for the partner's arrival within a small window of it, and it may deliberately **delay assignment** (keeping the order in the pool until the right time to dispatch). Prep-time prediction quality is central: use restaurant history by hour, the current kitchen queue (orders accepted but not ready), and item complexity, and update the prediction when the restaurant marks "food ready". Measure partner wait time at restaurants and customer delivery time as the core metrics.`,
      },
      {
        topic: "Batching orders safely",
        discussion: `Batching two orders on one trip raises partner productivity (orders per hour) and cuts cost, but it risks delaying the first customer. Evaluate candidate pairs only when the restaurants are within ~1 km (or the same restaurant), the ready times are within a few minutes, and the drop locations lie roughly in the same direction (angle between the vectors, or the incremental route distance). For each pair, compute the best route permutation and check that each customer's ETA degradation is under a threshold (e.g. +5 minutes) and within the promise. At peaks with supply shortages, relax the thresholds, since batching is how you serve more orders with fewer partners. Food quality matters too: limit the time food spends in transit (for example, ice cream must not ride a long batch).`,
      },
      {
        topic: "Consistency of partner state and reassignment",
        discussion: `Multiple zones' engines and manual ops tools could try to assign the same partner. The partner state service is the single authority, with CAS transitions per partner (Redis Lua or a strongly consistent store): idle → offered(offerId, expiry) → assigned(orderId). Offers expire automatically, and a stale accept (after expiry) is rejected by the offerId check. When a partner's app goes silent (no pings for 60 s) while assigned, the system flags the order at risk and, after a grace period, reassigns it, notifying both parties. All transitions are events on Kafka for order tracking, customer notifications and analytics. At city level, a failed engine instance is replaced and re-reads the pending pool, since assignments are durable in the state service.`,
      },
    ],
    tradeoffs: [
      "Batch matching every ~15 s gives better global assignment but adds up to 15 s of latency; immediate greedy is faster but worse at peak",
      "Delaying assignment until the right time reduces partner idle time but risks no partner being available later",
      "Batching improves productivity and cost but can hurt the first customer's ETA and food quality",
      "Tighter ETA promises improve conversion but increase breaches when prep predictions are wrong",
      "Offer to one partner is fair but slow; broadcast is fast but causes contention and cherry-picking",
    ],
    followUps: [
      { q: "It starts raining and supply drops 40%. What changes?", a: "Surge incentives for partners, relaxed batching thresholds, longer promised ETAs shown to customers, and possibly throttled order intake in zones (a smaller serviceable radius) to protect the experience." },
      { q: "How do you evaluate a new assignment algorithm?", a: "Simulate on historical order and partner traces, then run city-level or time-sliced (switchback) experiments, measuring delivery time, partner utilisation and cost per order." },
      { q: "How do you handle an order where the restaurant is 50% late?", a: "Update the ready-time prediction, re-plan the partner (release and reassign if needed), update the customer ETA, and feed the delay into the restaurant's future prep-time predictions." },
    ],
    relatedTopics: ["design-geo", "ds-concurrency", "net-realtime", "mq-scenarios", "prod-scale", "rel-patterns"],
  },
  {
    id: "co-swiggy-2",
    company: "swiggy",
    title: "Design the order lifecycle and state machine across customer, restaurant and partner",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the order management system that takes a food order from placement through restaurant acceptance, preparation, pickup and delivery, coordinating payments, refunds and notifications to three parties with timeouts and cancellations.",
    clarifyingQuestions: [
      "Which states and which actors can move them (customer cancels, restaurant rejects, partner marks picked up)?",
      "Timeouts: if the restaurant does not accept in 3 minutes, what happens (auto-cancel and refund, or call centre escalation)?",
      "Payments: prepaid (UPI/cards/wallet) and COD? When are refunds triggered?",
      "Notifications: push/SMS to customers, the restaurant tablet app, the partner app; real-time status?",
      "Scale: ~30 lakh orders/day; peak ~1,500 orders/s nationally on special events?",
    ],
    functional: [
      "Create an order after cart validation and payment authorisation",
      "State machine: PLACED → ACCEPTED → PREPARING → READY → PICKED_UP → DELIVERED, plus CANCELLED/REJECTED/FAILED paths",
      "Timeouts and escalations at each step; cancellation rules and refund computation",
      "Real-time status to all parties; audit history of transitions",
    ],
    nonFunctional: [
      "No lost or stuck orders (every order reaches a terminal state or an ops queue)",
      "Consistency: state transitions are atomic and ordered per order",
      "Payments and refunds exactly-once in effect",
      "Peak handling on New Year's Eve and IPL finals (5–10× normal)",
    ],
    estimation: [
      { label: "Orders", calc: "30 lakh/day ≈ 35/s average; NYE peak ~10× → 350–1,500/s" },
      { label: "Transitions", calc: "~8 transitions per order → 2.4 crore/day ≈ 280/s avg, peak ~12K/s" },
      { label: "Notifications", calc: "~15 notifications per order across three parties → 4.5 crore/day ≈ 520/s, peak ~20K/s" },
      { label: "Storage", calc: "Order + items + transitions ≈ 5 KB/order → 15 GB/day → ~5.5 TB/year hot, archive older" },
    ],
    highLevelDesign: `**Order service (the orchestrator):** it owns the order aggregate and its **state machine**. It's stored in a relational DB (MySQL/Postgres, sharded by order_id or customer_id) with an \`orders\` table (state, version, timestamps, amounts) and an \`order_events\` table (an append-only transition log with actor and reason).

**Transitions** are commands (AcceptOrder from the restaurant app, MarkPickedUp from the partner app) processed as a **transaction**: validate that the transition is allowed from the current state (a transition table), update the state with **optimistic concurrency** (version check), append the event, and write to the **outbox**. The outbox relay publishes to **Kafka** (keyed by order_id, so consumers see events in order).

**Consumers react to events:** the notification service (push, SMS, restaurant tablet, partner app), the assignment engine (on ACCEPTED it starts planning a partner), the payments service (on DELIVERED it captures or settles; on CANCELLED it refunds), the customer tracking service (live status via WebSocket/SSE), and analytics.

**Timeouts:** each state with a deadline registers a **durable timer** (a delayed message, or a scheduler table: order_id, fire_at, expected_state). When a timer fires, it issues a timeout command. If the order has moved on, the command is a no-op (the expected-state check). Examples: the restaurant doesn't accept in 3 minutes → try a call via an automated IVR, then auto-cancel with a full refund. No partner assigned in N minutes → escalate to ops.

**Cancellation and refunds:** the refund amount depends on the state at cancellation (full before ACCEPTED, partial after PREPARING, per policy). It's computed by the order service, and the refund is requested with an idempotency key (order_id + refund type). The payment service handles PSP calls, retries and reconciliation.

**Stuck-order detection:** a sweeper finds orders whose state hasn't changed past expected durations and routes them to an ops dashboard. Every order ends in a terminal state.`,
    deepDives: [
      {
        topic: "Why an explicit state machine with versioned transitions",
        discussion: `Three actors act concurrently: the customer cancels at the same moment the restaurant accepts. Without an explicit machine you get impossible states (cancelled but picked up). Define the allowed transitions in a table (from, command, actor → to, side-effects), and apply each command in a transaction with \`UPDATE orders SET state = :to, version = version + 1 WHERE id = :id AND version = :v AND state = :from\`. The loser of a race gets a conflict, re-reads, and re-evaluates. A cancel after acceptance may then become "cancel with partial refund" or be rejected, per policy. The order_events log makes support investigations and analytics easy, and consumers can rebuild views from it.`,
      },
      {
        topic: "Reliable side-effects: outbox and idempotent consumers",
        discussion: `State changes and their side-effects (notify, refund, start assignment) must not diverge. The **transactional outbox** writes the event in the same DB transaction as the state change, and a relay publishes to Kafka at-least-once. Consumers must be **idempotent**: the notification service dedupes by (order_id, event_seq). The payments service uses idempotency keys with the PSP, so a redelivered "CANCELLED" event doesn't trigger two refunds. Kafka partitioning by order_id preserves per-order ordering, so a consumer never processes DELIVERED before PICKED_UP. For failures, consumers retry with backoff, and poison events go to a DLQ with alerts. Critical ones (refunds) are reconciled daily. Consumers also need to tolerate schema evolution, so version event payloads and keep old fields until every consumer has migrated.`,
      },
      {
        topic: "Peak events and graceful degradation",
        discussion: `On New Year's Eve, orders surge 5–10× and restaurants saturate. Protect the core flow: pre-scale the order service and Kafka, and throttle order intake per restaurant (restaurant capacity: if a kitchen has 25 active orders, show "busy" or longer ETAs rather than accepting more), with per-zone serviceability shrinkage if partners are short. Non-critical consumers (analytics, recommendation updates) can lag. Notifications are prioritised (the restaurant accept prompt and partner assignment before promotional messages). Timeouts may be relaxed during peaks to avoid mass auto-cancellations. Runbooks and dashboards track the orders per state and the age of the oldest order in each state, which detects stuck flows quickly.`,
      },
    ],
    tradeoffs: [
      "Orchestration (one order service owns the state) is easier to reason about than choreography across services, but it becomes central",
      "Optimistic concurrency is simple and fast at per-order contention levels; pessimistic locking is unnecessary",
      "Durable timers per order add scheduler load but guarantee no stuck orders",
      "At-least-once events with idempotent consumers are simpler than distributed transactions, but every consumer must be idempotent",
    ],
    followUps: [
      { q: "The restaurant tablet is offline. How do they receive orders?", a: "Fallbacks: SMS or IVR calls to the restaurant, and a timeout that escalates to ops or auto-cancels. The restaurant app queues its actions and syncs when it's back online, with the server as the authority." },
      { q: "How do you give customers a live ETA?", a: "Combine the state, predicted prep time and partner location into an ETA service, pushed via WebSocket/SSE on changes and at intervals." },
      { q: "How do you handle a partial order (an item out of stock)?", a: "The restaurant marks items unavailable at accept time. The order service transitions to MODIFIED (awaiting customer approval or auto-accept), with a partial refund computed and issued idempotently." },
    ],
    relatedTopics: ["ds-transactions", "mq-scenarios", "microservices", "prod-async-failure", "net-realtime", "design-commerce"],
  },
  // ---------------------------------------------------------------- Zomato
  {
    id: "co-zomato-1",
    company: "zomato",
    title: "Design restaurant ratings and reviews with anti-fraud",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the ratings and reviews system for restaurants: users rate delivery and dining experiences, write reviews with photos, and see an aggregate rating, while fake reviews and rating manipulation are kept out.",
    clarifyingQuestions: [
      "Separate delivery and dining ratings? Is the rating per order (verified) or open to anyone?",
      "How is the aggregate computed: a simple average, a time-decayed average, or a Bayesian average?",
      "How fresh must the aggregate be after a new rating (minutes)?",
      "Moderation: automated and human? Can restaurants respond or report reviews?",
      "Scale: ~2 lakh restaurants with delivery, ~30 lakh ratings/day?",
    ],
    functional: [
      "Submit a rating (1–5) and an optional review/photos, linked to an order for delivery ratings",
      "Show a restaurant's aggregate rating, count and distribution, plus paginated reviews (sort by recent/helpful)",
      "Fraud detection and moderation; hide or discount suspicious ratings",
      "Restaurant replies; users mark reviews helpful; report abuse",
    ],
    nonFunctional: [
      "Read-heavy: restaurant pages and search listings show ratings (~1 lakh reads/s peak)",
      "Aggregates within a few minutes of new ratings",
      "Trustworthiness: manipulation-resistant aggregates",
      "Photo storage and CDN delivery",
    ],
    estimation: [
      { label: "Ratings", calc: "~30 lakh ratings/day ≈ 35/s average, dinner peak ~200/s; ~10% with text reviews, ~3% with photos" },
      { label: "Storage", calc: "Ratings: 30 lakh × 365 × 200 B ≈ 220 GB/year; photos: 90K/day × 500 KB ≈ 45 GB/day → object storage + CDN" },
      { label: "Reads", calc: "Search listings show ~20 restaurants × rating → aggregates cached; restaurant page reviews ~5K QPS" },
      { label: "Aggregates", calc: "2 lakh restaurants × (count, sum, histogram, decayed score) ≈ 2 lakh × 100 B = 20 MB → fits anywhere" },
    ],
    highLevelDesign: `**Write path:**
1. \`POST /orders/{orderId}/rating {stars, review, tags, photos[]}\`: the **ratings service** verifies that the order belongs to the user and was delivered (a verified rating), and that there's one rating per order (a unique constraint on order_id, with edits allowed within a window). Photos are uploaded via presigned URLs to object storage and then scanned (NSFW, and relevance to food).
2. The rating is stored in MySQL/Postgres (sharded by restaurant_id for reads, or by user with a secondary projection), and a **RatingSubmitted** event goes to Kafka via the outbox.

**Fraud and quality pipeline (async, on the event):**
- Signals: account age and history, device and IP clusters (many accounts rating the same restaurant), rating velocity spikes, text similarity (duplicate or templated reviews), relationships (the rater ordered from the restaurant only once, just before rating), and payment-instrument reuse across accounts.
- A model and rules produce a **trust weight** (0–1) and flags. High-risk ratings are hidden pending review, and medium-risk ones are down-weighted in aggregates.
- Human moderation queues handle reported reviews and flagged content.

**Aggregation:** a stream consumer updates the per-restaurant aggregates: the weighted count, the weighted sum, the histogram, and a **time-decayed, Bayesian-smoothed score**: score = (C × m + Σ wᵢ × rᵢ × decayᵢ) ÷ (C + Σ wᵢ × decayᵢ), where m is the city/cuisine prior mean and C a confidence constant. New restaurants with 3 ratings don't jump to 5.0. A nightly batch recomputes all aggregates from scratch, with the latest trust weights, to correct drift.

**Read path:** aggregates are served from Redis (and embedded in the search index for sorting and filtering by rating), and review lists come from the DB with cursor pagination and a cache for the first page. "Helpful" votes are counters.`,
    diagram: `User app ─► Ratings svc (verify order, 1 per order) ─► Ratings DB
                │ photos → presigned upload → S3 → scan → CDN
                │ outbox
                ▼
              Kafka ─► Fraud/quality scoring (rules + ML) ─► trust weight, flags
                │                              │
                │                              └─► Moderation queue (humans)
                ▼
        Aggregator (weighted, decayed, Bayesian) ─► Redis + search index
                ▲
    Nightly batch recompute from DB (corrects drift, new weights)
Restaurant page / search ◄── aggregates (cache) + reviews (paginated)`,
    deepDives: [
      {
        topic: "A manipulation-resistant aggregate",
        discussion: `A plain average is easy to game (10 fake 5-star ratings on a new restaurant) and unfairly volatile. Use: (1) **verified ratings only** for delivery (tied to a delivered order), which raises the attacker's cost to real orders; (2) **trust weights** from the fraud model, so suspicious ratings count less without being visibly deleted (and attackers get less feedback); (3) a **Bayesian prior**, where new restaurants start near the local average and move as evidence accumulates; (4) **time decay**, so recent experiences matter more and a restaurant that improved isn't anchored to old reviews. Display both the score and the count ("4.2 · 1.2K ratings") so users can judge confidence. Recompute periodically when the models change.`,
      },
      {
        topic: "Detecting rating fraud",
        discussion: `Fraud comes from restaurants boosting themselves (friends, paid rating farms), competitors bombing ratings, and incentivised reviews. Build a **graph** of users, devices, IPs, payment instruments, addresses and restaurants, and look for dense clusters rating the same restaurant in a short window. Velocity anomalies (a restaurant averaging 5 ratings/day gets 80 in an hour) trigger holds. Text models detect templated or AI-generated reviews and off-topic content. A user whose ratings strongly deviate from the consensus across many restaurants gets a lower weight. Enforcement is graduated: down-weight, hold for review, remove, and penalise the restaurant's visibility. Everything is logged for appeals. Model features and thresholds are reviewed regularly, because fraud rings adapt quickly once they notice what gets caught.`,
      },
      {
        topic: "Serving ratings everywhere cheaply",
        discussion: `Ratings appear on search results, listing cards and restaurant pages, which is far more reads than writes. The aggregates are tiny (20 MB), so replicate them into each search and listing service's memory, or a Redis cluster, updated by the aggregator stream. The search index stores the rating as a sortable field, updated asynchronously (a few minutes of lag is fine). The review list for a restaurant is paginated by (created_at, id) with a cache of the first page per sort order, invalidated on new approved reviews. Photos are served via CDN with resized variants. That keeps the DB load dominated by writes and deep pagination only.`,
      },
    ],
    tradeoffs: [
      "Verified-only ratings improve trust but exclude dine-in visitors without an order (use separate dining verification such as bill upload or a table booking)",
      "Hidden down-weighting frustrates attackers but reduces transparency; provide appeal paths",
      "Bayesian smoothing stabilises new restaurants but slows recognition of genuinely great new places",
      "Streaming aggregates are fresh; nightly recomputes are needed to apply updated trust weights",
    ],
    followUps: [
      { q: "A restaurant complains about a sudden rating drop from coordinated 1-star ratings. What do you do?", a: "Velocity detection holds the ratings for review, and graph analysis identifies the cluster. The confirmed-fraudulent ratings are removed and the aggregate recomputed, and the actors are banned." },
      { q: "How would you show dish-level ratings?", a: "Collect per-item ratings on the order, aggregate per (restaurant, item) with the same weighting, and display them on the menu for items above a minimum count." },
      { q: "How do you handle a user editing their rating?", a: "Allow edits within a window. The aggregator applies a delta (remove the old contribution, add the new one), keyed by rating id and version to stay idempotent." },
    ],
    relatedTopics: ["data-pipelines", "search-systems", "cache-fundamentals", "object-storage", "security-general", "design-social"],
  },
  {
    id: "co-zomato-2",
    company: "zomato",
    title: "Design live order tracking for customers",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the live tracking screen that shows a customer their delivery partner moving on a map with an updating ETA, from pickup to doorstep, for peak loads like New Year's Eve with millions of concurrent trackers.",
    clarifyingQuestions: [
      "How often should the map update (every 3–5 s)? Is a smooth animation between points needed?",
      "Tracking scope: only after pickup, or also restaurant preparation progress?",
      "Scale: ~20 lakh orders in flight at NYE peak, with each customer's app open most of the time?",
      "Privacy: hide the partner's exact location before pickup or after delivery?",
      "Battery and data constraints on customer and partner phones?",
    ],
    functional: [
      "Stream the partner location for an order to the customer's app in near real time",
      "Show the order status and an updating ETA",
      "Reconnect and resume seamlessly; work on flaky mobile networks",
      "Stop sharing the location after delivery (privacy)",
    ],
    nonFunctional: [
      "Update latency under 3 s from partner ping to customer screen",
      "Scale to ~20 lakh concurrent tracking sessions and ~2 lakh partner pings/s",
      "Cheap on battery and data; degrade to lower update rates under load",
      "No impact on the ordering path if tracking fails",
    ],
    estimation: [
      { label: "Partner pings", calc: "~4 lakh active partners at NYE peak, 1 ping / 4 s → 1 lakh pings/s" },
      { label: "Tracking sessions", calc: "~20 lakh orders in flight; ~60% have tracking open → 12 lakh concurrent connections" },
      { label: "Fan-out", calc: "Only post-pickup orders stream location (~40% of 12 lakh ≈ 5 lakh sessions) → 5 lakh ÷ 4 s ≈ 1.2 lakh pushes/s" },
      { label: "Connection servers", calc: "~50K–1 lakh idle WebSockets per node → 12 lakh ÷ 50K ≈ 24 nodes (+ headroom → 40)" },
    ],
    highLevelDesign: `**Partner side:** the partner app sends location updates every ~4 s (adaptive: less often when stationary) to the **location ingestion service**, which publishes to **Kafka** (keyed by partnerId) and writes the latest position to Redis (\`partner:{id}:loc\`, with a short TTL).

**Order-to-partner mapping:** when an order is assigned, the order service publishes an OrderAssigned event. The **tracking service** maintains \`orderId → partnerId\` and the reverse \`partnerId → active orderIds\` (a batched delivery may serve 2 orders).

**Fan-out path:**
1. A **location router** consumes partner location events. For each event, it looks up the partner's active orders and publishes the (orderId, lat, lng, heading, ts) to a pub/sub channel per order (Redis pub/sub, or an internal message bus).
2. Customers connect via **WebSocket/SSE** (MQTT on mobile is also viable) to **realtime gateways**, subscribing to their order's channel after auth (the order must belong to the user). A gateway subscribes to the channels of its connected orders.
3. The gateway pushes updates to the client. The client **interpolates** the movement smoothly between points (animating along the route polyline) so a 4 s update rate looks continuous.

**ETA:** an ETA service recomputes the remaining time from the partner's location, the route and traffic every ~30 s, or on significant deviation, and pushes it with the status updates. Status events (picked up, arriving, delivered) flow from the order service on the same channel.

**Fallback:** if the socket fails, the app polls \`GET /orders/{id}/tracking\` every 10 s (served from Redis). Under extreme load, the server lowers the update frequency (e.g. to 10 s) via a config flag, and the client animations hide it.

**Privacy:** the tracking stream starts at pickup (before that, show restaurant progress), and it stops and purges when the order is delivered. The partner's phone number is masked via a calling proxy.`,
    diagram: `Partner app ─ loc/4s ─► Location ingest ─► Kafka (by partner) ─► Redis loc
                                               │
                                               ▼
                                Location router: partner → active orders
                                               │ publish order:{id}
                                               ▼
                                Pub/Sub (per order channel)
                                               │
                            Realtime gateways (WebSocket/SSE, ~50K conns each)
                                               │ push + client interpolation
                                               ▼
                                        Customer app map
ETA svc ── periodic ETA ──► same channel    Fallback: poll GET /tracking`,
    deepDives: [
      {
        topic: "Why push and how gateways scale",
        discussion: `Polling every 4 s by 12 lakh clients would be 3 lakh QPS of mostly redundant reads, and slower. Push via WebSocket or SSE sends only when a new point exists. Gateways are stateful: each holds its connections plus the channel subscriptions for them. Scale horizontally behind an L4 load balancer with connection draining on deploys. Because each order usually has one viewer, per-order channels are cheap, and the gateway subscribes on connect and unsubscribes on disconnect. Redis pub/sub is fire-and-forget, which is fine because the next location update supersedes a lost one. On reconnect, the client fetches the latest state from Redis via REST, then resumes the stream. Heartbeats detect dead mobile connections.`,
      },
      {
        topic: "Smooth maps with sparse updates",
        discussion: `Users perceive jerky jumps every 4 s as broken. The client animates the marker along the **route polyline** from the previous point to the new one over the update interval, using the heading and speed. Server-side, **map-match** the noisy GPS to roads before publishing, which avoids markers jumping across buildings, and drop outliers (sudden 2 km jumps). Send only the essentials (lat, lng, heading, ts, and a route progress index), as compact binary or JSON of about 60 bytes. This allows lowering the frequency under load (6–10 s) without users noticing much, which is the key degradation lever for NYE. The same trick saves partner battery via adaptive pinging.`,
      },
      {
        topic: "NYE peak planning",
        discussion: `Zomato has publicly discussed NYE as its biggest traffic event. Plan capacity for ~3× the previous year's peak: pre-scale gateways (connection count, file descriptors), the Redis pub/sub cluster (sharded by channel, e.g. Redis Cluster with sharded pub/sub in Redis 7, or a Kafka-backed router), and the ingestion tier. Load-test with synthetic partners and customers. Protect the order path: tracking runs on separate infrastructure, and its failure only degrades the map, with the status still shown via polling. Runtime knobs are the update frequency, the ETA recompute interval, and disabling live maps for distant cities. Dashboards cover connection counts, the fan-out lag (partner ping to client receipt) and the error rates per gateway.`,
      },
    ],
    tradeoffs: [
      "WebSocket/SSE push is fresh and efficient but needs stateful gateways; polling is simple but costly and laggy",
      "Redis pub/sub is fast and simple but lossy; Kafka-based fan-out is durable but adds latency (lossy is fine for superseding updates)",
      "Higher ping frequency is smoother but costs battery and load; interpolation gives smoothness cheaply",
      "Map-matching on the server improves UX but costs compute per ping",
    ],
    followUps: [
      { q: "How do you show tracking for a batched delivery where the partner drops another order first?", a: "Show the partner's route, including the intermediate stop, with an ETA that accounts for it. Mask the other customer's exact address (show just \"another delivery nearby\")." },
      { q: "The partner's GPS drops in a basement. What does the customer see?", a: "The last known position with a \"location updating\" hint, dead-reckoned along the route with a capped extrapolation, and the ETA refreshed from the order status." },
      { q: "How do you secure the tracking channel?", a: "Authenticate the WebSocket with the customer's token and authorise that the order belongs to them. Channels are per order and never guessable, and location sharing ends at delivery." },
    ],
    relatedTopics: ["net-realtime", "design-geo", "cache-fundamentals", "prod-scale", "mq-fundamentals", "net-load-balancing"],
  },
  // ---------------------------------------------------------------- Razorpay
  {
    id: "co-razorpay-1",
    company: "razorpay",
    title: "Design a payment gateway flow that handles UPI retries and pending states",
    frequency: "very-high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the payment gateway path from merchant checkout to bank/NPCI for UPI (collect and intent flows), handling timeouts, pending and \"deemed\" statuses, customer retries and late callbacks, without double charging or losing money.",
    clarifyingQuestions: [
      "UPI flows: intent/QR (the user pays in a UPI app) and collect (a request sent to a VPA)? Both?",
      "What do we do when the bank or NPCI times out: the status is unknown for how long?",
      "Merchant experience: redirect or callback URL plus webhooks (payment.captured, payment.failed)?",
      "Auto-capture vs manual capture? Refund flows?",
      "Scale: festive peak ~10K TPS across merchants?",
    ],
    functional: [
      "Create an order (merchant server) and a payment (checkout) with a UPI intent/collect",
      "Track the payment through a state machine: created → pending → authorized/captured | failed",
      "Handle callbacks from the acquiring bank/NPCI, status polling for pending, late success after a failure",
      "Webhooks to merchants; refunds; reconciliation with bank MIS/settlement files",
    ],
    nonFunctional: [
      "Correctness: no double debit for one order; late successes reconciled (auto-refund or capture)",
      "High availability with multiple acquiring bank routes; smart routing on bank health",
      "Latency: most UPI payments complete in 5–30 s; the gateway adds under 200 ms",
      "Audit and compliance (RBI PA guidelines, data localisation)",
    ],
    estimation: [
      { label: "Peak TPS", calc: "~10K payment attempts/s at festive peaks; ~70% UPI" },
      { label: "Pending", calc: "~3–5% of UPI attempts go pending or time out → ~300–500/s entering status reconciliation" },
      { label: "Status polls", calc: "Polling pending payments at 5 s, 15 s, 60 s, 5 min … → ~5 polls each → ~2.5K polls/s to banks (rate-limited per bank)" },
      { label: "Storage", calc: "~5 crore payments/day × 2 KB (payment + attempts + events) ≈ 100 GB/day" },
    ],
    highLevelDesign: `**Entities:** a **Order** (merchant intent to collect ₹X, idempotent by the merchant's receipt id) has many **Payments** (attempts by the customer). An order can be paid successfully **at most once**.

**Flow (intent/QR):**
1. The merchant server creates the order via the API (with an idempotency key). Checkout creates a payment (state CREATED) and asks the **UPI gateway service** to generate an intent or QR via the chosen **acquiring bank (PSP bank)**. That's selected by a **smart router** based on the bank's success rate, latency and cost.
2. The customer approves in their UPI app. NPCI routes to the remitter bank for debit, then back to our acquiring bank, which sends a **callback** to us with the final status.
3. The payment state goes to AUTHORIZED/CAPTURED (auto-capture) or FAILED. The ledger is posted, the merchant webhook (via outbox) sent, and the checkout page (polling our status API) redirects.

**Pending handling (the heart of the question):**
- If no callback arrives within T (e.g. 30–60 s), or the bank returns "pending" or "deemed", the payment stays **PENDING**, never FAILED by guesswork. A **status reconciler** polls the bank's status-check API with backoff (5 s, 15 s, 60 s, 5 min, … up to hours), respecting per-bank rate limits.
- The checkout shows "processing". A **customer retry** creates a *new* payment on the same order: allowed, but at most one can succeed.
- **Late success** (a payment turns successful after a newer attempt already succeeded, or after the order expired): auto-refund the extra payment immediately, with a clear status to the merchant (payment captured then refunded) and to the customer.

**Consistency:** each payment's state machine allows only forward transitions (a success after FAILED is allowed only via the "late success" path). The order's "paid" flag is set with a conditional update, so the first success wins, and the others go to refund.

**Reconciliation:** daily bank MIS and settlement files are matched against payments. Mismatches are auto-resolved (a missed callback) or queued for ops.`,
    diagram: `Merchant server ─► Orders API (idempotent receipt) ─► Order (paid once)
Checkout ─► Payments svc ─► Smart router (bank health, cost)
                 │                 │
                 │                 ▼
                 │     UPI gateway ─► Acquirer bank A/B ─► NPCI ─► remitter
                 │                 ▲         │ callback (async)
                 ▼                 │         ▼
      Payment state machine ◄──────┴── Callback handler (verify, dedupe)
      CREATED→PENDING→CAPTURED|FAILED     │
                 │ pending too long         ▼
                 ▼                     Ledger + outbox → merchant webhooks
      Status reconciler (poll w/ backoff, per-bank limits)
      Late success → auto-refund if order already paid ─► Refund svc
      Daily: bank MIS/settlement files ─► Reconciliation`,
    deepDives: [
      {
        topic: "Why \"pending\" must not become \"failed\"",
        discussion: `In UPI the debit can succeed at the remitter bank while the response to us is lost or delayed (network issues between NPCI and banks, or timeouts). If we mark such payments FAILED, the customer retries and pays twice, which is the classic complaint. The state machine keeps them PENDING and drives resolution through the **status-check API** and callbacks, with NPCI's dispute and reconciliation rules as the backstop (deemed-approved transactions are settled later). The UI must communicate this: "Payment processing, don't pay again. If money is debited it will be credited to the merchant or refunded within X hours". The order stays payable only if the prior attempt is terminally FAILED, or the merchant allows parallel attempts with auto-refund of extras.`,
      },
      {
        topic: "Smart routing across acquiring banks",
        discussion: `Razorpay routes UPI through multiple partner banks. A **router** keeps real-time health metrics per bank (success rate and p95 latency over sliding 1-minute windows, and error types) and per remitter bank or app (some issuers degrade during peaks). The routing decision per payment weighs success probability, latency and cost (a multi-armed bandit or rule-based weights), with circuit breakers that pull a degraded bank out of rotation and gradually re-admit it. Pinning a merchant to a bank may be required by contract. Health data flows through a streaming pipeline, and decisions must be fast (in-memory scores refreshed every few seconds). This improves success rates by a few percentage points, which is major revenue for merchants.`,
      },
      {
        topic: "Idempotency and exactly-once effects",
        discussion: `Idempotency layers: merchant order creation with a receipt/idempotency key, payment creation with a checkout attempt id, the bank request with a unique transaction reference (our payment id as the UPI txn ref, which NPCI and banks dedupe), and callbacks deduped by (bank ref, status). The **order-level invariant** "at most one captured payment" is enforced with a conditional update (\`UPDATE orders SET paid_payment_id = ? WHERE id = ? AND paid_payment_id IS NULL\`). A payment losing that race is auto-refunded. Ledger postings are idempotent by an external ref. Merchant webhooks are at-least-once with event ids, and merchants are told to dedupe. Refunds carry their own idempotency keys, so a retried refund can't double-credit.`,
      },
    ],
    tradeoffs: [
      "Waiting on pending instead of failing fast avoids double debits but worsens the checkout experience",
      "Aggressive status polling resolves faster but can hit bank rate limits; use backoff and callbacks first",
      "Allowing parallel retries improves conversion but requires reliable auto-refunds of late successes",
      "Smart routing raises success rates but adds complexity and needs careful bandit exploration",
      "Auto-capture simplifies merchants but complicates refund handling for cancelled orders",
    ],
    followUps: [
      { q: "How do you design the merchant webhook for payment.captured to be safe?", a: "Sign with HMAC, deliver at-least-once with event ids, retry with backoff for 24 h, and expose a fetch-payment API for merchants to verify status." },
      { q: "A bank's callback system is down for an hour. What happens?", a: "Payments stay pending, and the reconciler polls status APIs (throttled). The router shifts new traffic to other banks. After recovery, callbacks are deduped against already-polled results." },
      { q: "How do refunds for UPI work?", a: "A refund request to the acquiring bank, tracked by its own state machine, with an idempotency key and status polling. Refunds are settled via NPCI with a reference that's shared with the customer." },
    ],
    relatedTopics: ["design-commerce", "prod-async-failure", "ds-transactions", "rel-patterns", "api-design", "prod-correctness-ops"],
  },
  {
    id: "co-razorpay-2",
    company: "razorpay",
    title: "Design merchant settlements (T+1) and reconciliation",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the system that settles collected payments to lakhs of merchants' bank accounts on T+1 (or instantly on demand), net of fees, taxes, refunds and chargebacks, and reconciles everything with bank settlement files.",
    clarifyingQuestions: [
      "Settlement schedules: T+1 default, custom schedules, instant settlement as a paid feature?",
      "Deductions: MDR fees, GST on fees, refunds, chargebacks, reserves/holds for risky merchants?",
      "Payout rails: NEFT/RTGS/IMPS; batch files vs API; bank holiday handling?",
      "Where does the money sit: a nodal/escrow account per RBI PA guidelines?",
      "Scale: ~10 lakh merchants, ~5 crore payments/day?",
    ],
    functional: [
      "Compute each merchant's settlement amount per cycle from captured payments minus fees, taxes, refunds and adjustments",
      "Create and execute payouts to merchant bank accounts; track status (processed, failed, reversed)",
      "Reconcile incoming funds (from acquirers/card networks) and outgoing payouts with bank statements",
      "Merchant-facing settlement reports with line items",
    ],
    nonFunctional: [
      "Money correctness: double-entry ledger; every rupee explained",
      "Timeliness: T+1 settlements complete by the committed time",
      "Idempotent, resumable batch processing",
      "Auditability and compliance (RBI nodal account rules)",
    ],
    estimation: [
      { label: "Payments", calc: "~5 crore payments/day → ledger entries ~4 per payment ≈ 20 crore entries/day" },
      { label: "Settlements", calc: "~3 lakh merchants settled daily (not all transact daily)" },
      { label: "Batch compute", calc: "Aggregate 5 crore rows by merchant → a Spark/SQL job; ~minutes on a partitioned table" },
      { label: "Payout calls", calc: "3 lakh payouts in a 2-hour window ≈ 40/s → bank APIs with rate limits of 50–100 TPS per bank → spread across banks" },
    ],
    highLevelDesign: `**Ledger first:** every captured payment posts: debit acquirer receivable (money we'll receive from the bank or network), credit merchant payable (gross), debit merchant payable and credit fee revenue (MDR), and credit GST payable. Refunds and chargebacks post reversing entries against merchant payable. The merchant's **settleable balance** = the merchant payable entries eligible by schedule (captured before the cut-off, not on hold).

**Settlement pipeline (daily at the cut-off, plus instant on demand):**
1. **Eligibility:** a settlement job freezes a **cut-off** (e.g. all entries up to T 23:59 IST) per schedule and computes, per merchant, the net amount = Σ eligible payable entries − reserves/holds − negative balances carried forward. It writes a \`settlement(merchant, cycle_id, amount, entries[])\` record, **deterministic and idempotent per (merchant, cycle_id)**.
2. **Funding check:** incoming settlements from acquirers and networks must have arrived in the nodal/escrow account (tracked via bank statement ingestion). Settlements are released only against received funds, or per the risk policy.
3. **Payout execution:** a payout service creates a **payout** per settlement with an idempotency key, via bank APIs (IMPS/NEFT/RTGS) or batch files. A state machine tracks created → processing → processed | failed | reversed, driven by bank responses, webhooks and status polling.
4. **Ledger on payout:** debit merchant payable, credit bank (nodal) account when processed. A failed or reversed payout re-credits the merchant payable, marks it for retry, and alerts the merchant to fix their bank details.
5. **Reports:** a per-merchant settlement report (each payment, fee, tax, refund) is generated from the settlement's entries.

**Reconciliation (three-way):** our ledger vs the acquirer/network settlement reports (did we receive what we expected per payment?), vs the nodal bank statement (did money actually move?), vs payout bank responses. Mismatch buckets are auto-fixed when explainable (timing differences), or go to an ops queue with ageing SLAs.`,
    diagram: `Payments / refunds / chargebacks ─► Ledger (double-entry, append-only)
                                        │
            daily cut-off (per schedule) ▼
                        Settlement calculator (per merchant, per cycle_id,
                        idempotent; reserves, negative balances)
                                        │
                 funds received? ◄── Bank statement ingestion (nodal a/c)
                                        │ yes
                                        ▼
                        Payout service (idempotency key, state machine)
                                        │ IMPS/NEFT/RTGS APIs or batch files
                                        ▼
                                   Merchant bank
Recon: ledger ⇄ acquirer/network reports ⇄ bank statements ⇄ payouts`,
    deepDives: [
      {
        topic: "Deterministic, idempotent settlement cycles",
        discussion: `Batch jobs crash and get re-run, so a re-run must never pay twice. The key is **cycle_id** (merchant schedule + cut-off date) with a unique constraint on (merchant_id, cycle_id). The calculation selects ledger entries up to the frozen cut-off that aren't yet assigned to a settlement, and assigns them in the same transaction as the settlement record (entry.settlement_id = X), so an entry can belong to one settlement only. A re-run finds the existing settlement and skips it. Payouts carry the settlement id as the bank idempotency reference. Instant settlements use the same mechanism with an ad-hoc cycle id. Late entries (a refund after the cut-off) roll into the next cycle, which is explained in the reports.`,
      },
      {
        topic: "Handling negative balances, reserves and chargebacks",
        discussion: `Refunds and chargebacks can exceed a merchant's settleable amount (a merchant with heavy refunds, or a fraud case). The net can go negative. Carry the negative balance forward, and deduct it from future settlements before paying anything. For risky merchants (new, high chargeback ratio), keep a **rolling reserve** (hold X% for N days) by posting to a merchant reserve account, released on schedule. Chargebacks arrive weeks later from card networks, and they're posted as reversals with dispute state tracking (evidence submission, win/lose). All of this is just ledger movements between accounts, which keeps the settlement calculator simple: settleable = balance of the merchant payable account minus holds.`,
      },
      {
        topic: "Reconciliation that scales",
        discussion: `Every day, millions of payments must match the acquirers' and networks' settlement files (by payment id or bank reference, amount and date), and the nodal account statement must match the aggregate credits. Load the files into a staging area (Parquet or an RDBMS), and run matching jobs keyed by reference (exact match, then fuzzy rules for known quirks: split settlements, fee netting by networks). Output matched, unmatched-ours (expected but not received) and unmatched-theirs (received but unknown). Ageing matters: an item unmatched after T+2 is escalated. Mismatch rates per acquirer are monitored because a sudden spike usually means a file-format change or an integration bug. Results feed finance close and regulatory reporting.`,
      },
    ],
    tradeoffs: [
      "Settling only against received funds is safer but slower; pre-funding (paying before receipt) is a credit risk taken for merchant experience",
      "Batch files are cheap and bulk-friendly, while API payouts give granular status and speed",
      "Frozen cut-offs give deterministic, auditable cycles, at the cost of late entries waiting a cycle",
      "Rolling reserves protect against merchant fraud but hurt merchant cash flow",
    ],
    followUps: [
      { q: "A bank marks 5,000 payouts failed because of an outage. What happens?", a: "Payouts stay in the failed state, and the ledger re-credits merchant payable. A retry job re-attempts via another bank or rail after health checks, using new payout ids linked to the same settlements, and merchants are notified if the delay exceeds the SLA." },
      { q: "How do you offer instant settlements?", a: "Compute the settleable balance in real time from the ledger (with holds), create an ad-hoc settlement and IMPS payout, and charge a fee. The platform fronts the funds before receipt, so risk limits per merchant apply." },
      { q: "How do you prove a merchant's settlement was correct?", a: "The settlement report lists every ledger entry included (payments, fees, GST, refunds). It's reproducible from the immutable ledger at the cut-off, and it ties to the payout bank reference." },
    ],
    relatedTopics: ["design-commerce", "prod-correctness-ops", "data-pipelines", "ds-transactions", "prod-async-failure", "db-fundamentals"],
  },
  // ---------------------------------------------------------------- PhonePe
  {
    id: "co-phonepe-1",
    company: "phonepe",
    title: "Design a UPI payments app backend (PSP) for festive-peak TPS",
    frequency: "very-high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the backend of a UPI payments app (a Third-Party App/PSP like PhonePe) that lets 50 crore users send money and pay merchants via UPI, sustaining festive peaks of 20K+ TPS with high success rates.",
    clarifyingQuestions: [
      "Which flows: P2P (to VPA/mobile), P2M (QR scan), collect requests, mandates (AutoPay)?",
      "What's our role vs the PSP banks and NPCI: we're a TPAP, and banks connect to NPCI?",
      "Device binding and PIN: the UPI PIN is entered in the NPCI common library; we never see it?",
      "Scale: peak TPS during Diwali and IPL? Success-rate targets?",
      "Transaction history and notifications requirements?",
    ],
    functional: [
      "Onboarding: device binding (SMS-based), link bank accounts (fetched via NPCI), create VPA",
      "Pay: resolve the payee VPA, initiate a transaction via a PSP bank, collect the PIN via the NPCI library, track status",
      "Collect requests, QR merchant payments, transaction history, notifications",
      "Handle pending/deemed transactions, complaints and disputes (UDIR)",
    ],
    nonFunctional: [
      "Peak 20K–30K TPS with p95 app-side latency dominated by banks (2–10 s)",
      "High availability: active-active data centres; degrade features, never payments",
      "Security: device binding, encryption, fraud checks (velocity, mule accounts)",
      "Idempotency and exact status tracking; regulatory compliance (NPCI and RBI data localisation)",
    ],
    estimation: [
      { label: "Transactions", calc: "~25 crore UPI txns/day on a leading app → ~2.9K TPS average; festive peak ×7 ≈ 20K TPS" },
      { label: "Status traffic", calc: "Each txn ~3 status checks/polls from the app + callbacks → ~60K status reads/s at peak → cache-first" },
      { label: "History", calc: "25 crore txns/day × 1 KB ≈ 250 GB/day → ~90 TB/year (sharded by user)" },
      { label: "PSP bank capacity", calc: "Spread across 4–5 PSP banks, each ~5K TPS capacity → routing and health-based load balancing are mandatory" },
    ],
    highLevelDesign: `**Actors:** the app (with the NPCI common library for the PIN), our **PSP switch** (the backend), **PSP banks** (our partner banks connected to NPCI), NPCI's UPI switch, and the remitter and beneficiary banks.

**Pay flow (P2P to a VPA):**
1. The app calls \`POST /pay {txnRef (client idempotency), payeeVpa, amount, accountRef}\`. The **payments service** validates it (limits, device binding, fraud score) and creates a transaction record (INITIATED) in a sharded DB (by payer user id).
2. **Payee resolution:** validate the VPA via the PSP bank → NPCI (cached briefly for repeat payees).
3. **Router** chooses the PSP bank handle for the user's VPA (@ybl, @ibl, @axl on PhonePe map to partner banks). Each handle is tied to a bank, and health-based routing applies to the underlying API infrastructure.
4. The PIN is captured by the NPCI library as an encrypted credential block, which is forwarded to the PSP bank → NPCI → remitter bank to verify and debit, then credit the beneficiary.
5. **Response/callback** from the PSP bank: SUCCESS, FAILURE, or PENDING/DEEMED. The state machine updates. PENDING goes to a **status reconciler** (status-check API with backoff). The app shows "processing" and never encourages a retry.
6. Events (outbox → Kafka) feed notifications (push/SMS), the transaction history projection, rewards, analytics and fraud models.

**Scaling pattern:** stateless API tier across 2–3 active-active data centres (PhonePe runs its own DCs), a sharded MySQL/Aerospike-style store for transactions (by user, with a secondary index by txn id via a lookup table), Redis for hot status reads, and Kafka for async flows. Non-critical features (rewards, recommendations) are behind feature flags that are shed at peak.

**Bank health management:** per PSP bank and per remitter bank, real-time success and latency metrics. Circuit breakers and graceful messages ("SBI servers are slow right now") avoid futile retries that would add load.`,
    diagram: `App (NPCI lib for PIN) ─► API gateway (auth, device binding, rate limits)
                                 │
                                 ▼
                  Payments svc (idempotent txnRef, fraud check, state machine)
                       │                 │ outbox → Kafka ─► notifications,
                       ▼                 │                   history, rewards
          Router (PSP bank health)       ▼
                       │           Txn DB (sharded by user) + Redis status
                       ▼
        PSP banks (@ybl/@ibl/@axl) ─► NPCI switch ─► remitter/beneficiary
                       │ callbacks (SUCCESS / FAILURE / PENDING)
                       ▼
         Callback handler ─► state machine ─► status reconciler for PENDING`,
    deepDives: [
      {
        topic: "Designing for bank variability",
        discussion: `Success rates and latency depend heavily on remitter banks, and at festive peaks a large bank's core system may slow down. What we control: (1) **fast failure feedback**: detect a degraded remitter bank from live metrics (success rate over 1-minute windows) and warn users before they try ("Bank X is facing issues, try another account"), which cuts futile attempts; (2) **timeouts tuned per bank** with PENDING semantics rather than failures; (3) **PSP bank load balancing**, spreading traffic across partner banks within capacity and moving new-user VPA creation to healthier handles; (4) **no automatic retries of debits** (they risk double debits). Retries only apply to idempotent status checks. The status reconciler's rate is capped per bank to avoid overloading them further.`,
      },
      {
        topic: "Transaction state and idempotency",
        discussion: `The client sends a txnRef (a UUID per payment attempt), and the server enforces it as unique per user, so a double tap or a network retry returns the same transaction. The UPI transaction id is generated by us, passed to NPCI, and used to dedupe bank callbacks and status responses. State transitions are forward-only (INITIATED → PENDING → SUCCESS/FAILURE, with a DEEMED path to eventual resolution), applied with conditional updates so a late FAILURE can't overwrite a SUCCESS. User-facing balance and history projections are derived from these events. Complaints for stuck transactions are raised through NPCI's online dispute resolution (UDIR) with the same references, and resolutions are applied as events.`,
      },
      {
        topic: "Active-active data centres and peak readiness",
        discussion: `A payments app can't have a regional outage during Diwali. Run active-active in 2–3 DCs with users sharded to a home DC, and replicate data for failover (asynchronous with low lag, since sync replication across DCs adds latency). A transaction is processed in the user's home DC, and failover moves traffic with a short blast radius. Status reconciliation covers transactions in flight during a failover. Peak readiness: capacity planning from last year ×1.5, load tests with bank simulators, pre-scaled Kafka and DB capacity, feature shedding (rewards, offers and banners off at peak), and **war rooms** with dashboards of success rate per bank. The key SLOs are the payment success rate and time to resolve pending transactions.`,
      },
    ],
    tradeoffs: [
      "Showing processing for pending transactions avoids double debits but creates anxious users; clear messaging and fast reconciliation help",
      "Multiple PSP bank handles spread risk but add integration and reconciliation complexity",
      "Async replication across DCs gives low latency but a tiny risk of losing the latest state on failover (reconciled via bank status)",
      "Proactive bank-down warnings reduce load but may discourage users even when partially working",
      "Caching payee VPA validation speeds repeat payments but risks stale names (use a short TTL)",
    ],
    followUps: [
      { q: "How do you design AutoPay mandates (recurring payments)?", a: "Create a mandate with the user's approval (PIN) and store its limits and frequency. A scheduler triggers executions with pre-debit notifications (a 24 h notice for recurring mandates), each an idempotent transaction with its own state machine." },
      { q: "How do you detect fraud like mule accounts?", a: "Real-time features (new device, new payee, amount velocity, graph links to reported accounts) scored before initiation, with step-up actions (warnings, cooling periods) and reporting to banks." },
      { q: "How is transaction history served for 50 crore users?", a: "A per-user projection sharded by user id, paginated by time, with the latest page cached. It's covered as a separate PhonePe question." },
    ],
    relatedTopics: ["design-commerce", "rel-dr", "prod-async-failure", "rel-patterns", "security-general", "mq-scenarios"],
  },
  {
    id: "co-phonepe-2",
    company: "phonepe",
    title: "Design transaction history for 50 crore users",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the transaction history service: each user sees all their payments (UPI, wallet, cards, bill payments, refunds, cashback) newest first with filters and search, status updates in near real time, across years of data.",
    clarifyingQuestions: [
      "Which sources feed history: UPI switch, wallet, bill payments, merchant refunds, rewards?",
      "Filters: date range, type, status, counterparty; free-text search on payee name or note?",
      "How far back must the history go (years)? Downloadable statements?",
      "How fast must a new transaction or status change appear (under 2 s)?",
      "Heavy users: merchants or power users with 1 lakh+ transactions?",
    ],
    functional: [
      "Append new transactions and status updates from multiple source systems",
      "List a user's transactions newest first, paginated, with filters",
      "Search by counterparty/note; transaction detail view",
      "Statement export (PDF/CSV) for a date range",
    ],
    nonFunctional: [
      "Read-heavy: ~1 lakh history reads/s at peak; p99 under 100 ms for the first page",
      "Near-real-time (<2 s) reflection of new transactions and status changes",
      "Years of retention cheaply (hot/cold tiering)",
      "Consistency: never show a transaction as failed after it succeeded (ordered updates)",
    ],
    estimation: [
      { label: "Writes", calc: "~25 crore txns/day × ~2 events (created + final status) ≈ 50 crore events/day ≈ 5.8K/s avg, ~40K/s peak" },
      { label: "Storage", calc: "~25 crore × 365 × 600 B (history row) ≈ 55 TB/year; 5 years ≈ 275 TB → tiering needed" },
      { label: "Reads", calc: "Users open history after payments: ~1 lakh reads/s peak; 90% are the first page" },
      { label: "Per-user size", calc: "Median ~500 txns/year; power users 1 lakh+/year → partition by (user, time bucket)" },
    ],
    highLevelDesign: `**Ingestion:** each source system publishes transaction events (created, status changed, refunded) with a global txn id, user ids (payer and payee both get an entry), amounts, counterparty and a **monotonically increasing version** to Kafka, partitioned by user id so a user's updates are ordered.

**History projection writer:** it consumes the events and **upserts** the user's history entry: \`(user_id, time_bucket, txn_ts DESC, txn_id) → {type, amount, direction, counterparty, status, version, source}\`. It applies an update only if the event version is greater than the stored version (out-of-order safe and idempotent). A P2P payment writes two entries, one for the payer (debit) and one for the payee (credit).

**Store:** a wide-column store (Cassandra/ScyllaDB/HBase, or Aerospike for the hot tier) with partition key = (user_id, month) to bound partition size, and clustering = (txn_ts DESC, txn_id). A **txn_id → (user, bucket, ts)** lookup table supports detail pages and status updates that arrive with only a txn id.

**Read path:**
- The first page comes from a **Redis cache** per user (the latest 20 entries), updated by the writer on new events (write-through), so most reads never touch the store.
- Older pages walk the month buckets backwards with a cursor (bucket, ts, txn_id).
- **Filters** (type or status) are applied on the partition scan for bounded buckets. For heavy users, maintain secondary projections per type if needed.
- **Search:** an Elasticsearch index (fed from the same stream), routed by user id so each user's documents sit in one shard, for counterparty and note search. It's eventually consistent.

**Tiering:** the last 12–18 months are in the hot store. Older data is compacted into per-user yearly files (Parquet) in object storage, served by a slower "older transactions" path or a statement generation job.

**Statements:** an async job builds the PDF/CSV from the store and archive and delivers it via a download link.`,
    diagram: `UPI switch / wallet / bills / refunds / rewards ─► Kafka (partition by user)
                                                      │ events w/ version
                                                      ▼
                        History writer (upsert if newer; payer+payee)
                            │                 │                    │
                            ▼                 ▼                    ▼
                   Wide-column store    Redis latest-20      Search index
                   (user, month) → txns    per user           (by user)
                   + txn_id lookup
                            │ age > 18 months
                            ▼
             Archive (per-user yearly Parquet) ─► statements
App ─► History API: page 1 from Redis → older pages via cursor → search via ES`,
    deepDives: [
      {
        topic: "Ordering and idempotency of status updates",
        discussion: `A payment's status can change PENDING → SUCCESS, and events can arrive out of order (the success before the created event, or a replayed old event). Rules: each source event carries a version (a per-transaction sequence or a status rank), and the writer upserts with a condition (a lightweight transaction on version, or a client-side read-then-conditional write, or Cassandra's last-write-wins with the version encoded as the write timestamp). A missing base record is fine, since the upsert creates the row from any event, with later fields filled in. Partitioning Kafka by user preserves per-user order, and the version handles cross-source races. Terminal-state protection: a FAILURE with a lower rank than SUCCESS can never overwrite it.`,
      },
      {
        topic: "Hot users and partition sizing",
        discussion: `Merchants and power users with lakhs of transactions per month would make a single user partition huge and slow to read. Partitioning by (user, month) bounds each partition. Very heavy users can use (user, day) buckets via a per-user bucket-granularity setting. Reads for the first page hit the cache, and deeper pages scan bucket by bucket with limits. Writes to a hot user are sequential appends in the LSM store, which is cheap. For merchants, history is often served by a separate merchant dashboard system with OLAP-style aggregation (settlement reports), not the consumer history service, which is a good boundary to call out.`,
      },
      {
        topic: "Tiering years of history cheaply",
        discussion: `Users rarely look beyond the last few months, but regulations and user trust require a long history. Keep 12–18 months in the hot wide-column store (SSD), and move older buckets by a nightly job into columnar files in object storage, per user per year, indexed by a small manifest. The history API transparently serves older pages from the archive with higher latency (hundreds of ms), and statement exports read from both. Deletion and retention policies apply per data class. This cuts the hot store's size by ~70% and keeps compaction and repair times manageable. The archive format also makes bulk statement generation and analytics cheap, since both can scan columnar files without touching the online store.`,
      },
    ],
    tradeoffs: [
      "A denormalised per-user projection gives fast reads but duplicates data (payer and payee rows) and depends on event quality",
      "Month buckets bound partitions but add multi-partition reads for long ranges",
      "Search via ES is flexible but eventually consistent and another system to operate",
      "Tiering to object storage is cheap but slow for old pages; set expectations in the UI",
    ],
    followUps: [
      { q: "A user reports a transaction missing from history but debited. How do you debug?", a: "Look up by txn id in the lookup table and source systems, check Kafka consumer lag and DLQ, and replay the event. Also add a reconciliation job comparing source ledgers with history counts per day." },
      { q: "How would you show a monthly spend summary?", a: "Maintain per-user monthly aggregates (by category) in the writer or a stream job, stored alongside history and recomputable from events." },
      { q: "How do you handle refunds linked to the original payment?", a: "The refund event references the original txn id. The writer adds a refund entry and updates the original entry's refund status via the lookup table." },
    ],
    relatedTopics: ["db-sharding", "cache-fundamentals", "data-pipelines", "mq-scenarios", "search-systems", "object-storage"],
  },
  // ---------------------------------------------------------------- Paytm
  {
    id: "co-paytm-1",
    company: "paytm",
    title: "Design a KYC-aware digital wallet with double-entry balances",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design a prepaid wallet where users add money (UPI/cards), pay merchants, send to other wallets and withdraw to bank, with RBI KYC-based limits, cashback credits, and balances that are always correct under concurrency.",
    clarifyingQuestions: [
      "Which RBI PPI limits apply: minimum-KYC wallets (e.g. ₹10,000 balance cap) vs full-KYC (₹2 lakh)?",
      "Operations: load, pay merchant, P2P transfer, withdraw to bank, cashback credit, refunds?",
      "Scale: ~5,000 wallet TPS at peak, 10 crore wallets?",
      "Consistency: no negative balances; no double spend under concurrent payments?",
      "Is a wallet-to-bank transfer async via IMPS, and how do failures reverse?",
    ],
    functional: [
      "Load money via PG (UPI/cards/netbanking) into the wallet",
      "Pay merchants and transfer to other wallets instantly",
      "Withdraw to bank (IMPS) with fees and failure reversal",
      "Enforce KYC limits (balance cap, monthly load limits); cashback and promotional balances with expiry",
    ],
    nonFunctional: [
      "Strong consistency of balances; no lost or duplicated money",
      "Payment latency under 300 ms for wallet debits",
      "High availability; auditable ledger for RBI compliance",
      "Handle cashback campaign spikes (10× transfers)",
    ],
    estimation: [
      { label: "TPS", calc: "~2 crore wallet txns/day ≈ 230 TPS avg; campaign peaks ~5K TPS" },
      { label: "Ledger entries", calc: "~2.5 entries per txn → ~5 crore entries/day ≈ 20 GB/day at ~400 B each" },
      { label: "Hot wallets", calc: "Large merchants receive ~500 payments/s → hot credit accounts need special handling" },
      { label: "Balance rows", calc: "10 crore wallets × 3 sub-balances (main, cashback, gift) → 30 crore balance rows ≈ 30 GB" },
    ],
    highLevelDesign: `**Ledger design:** a double-entry, append-only **ledger** in a relational DB (MySQL/Postgres), sharded by account id. Accounts: user wallet (split into **sub-balances**: main, cashback/promotional with expiry, gift), merchant wallet, pool/escrow accounts (the money held in the regulated escrow bank account), fee revenue, and a cashback expense account.

**Balances:** \`account_balance(account_id, balance, version)\` is updated in the **same transaction** as the ledger entries. A debit does \`UPDATE account_balance SET balance = balance − :amt, version = version + 1 WHERE account_id = :a AND balance >= :amt\`, which is atomic, so there's no negative balance and concurrent payments can't double spend.

**Operations:**
- **Load:** the payment gateway (UPI/card) captures, then a callback, then a ledger transaction: debit escrow, credit user main (idempotent by the PG payment id). A KYC check before initiating: monthly load and the balance cap after load.
- **Pay merchant:** a single transaction debiting the user sub-balances by precedence (cashback first if eligible for the merchant category, then main) and crediting the merchant wallet. That's cross-shard if the user and merchant are on different shards.
- **P2P:** as above, with the recipient's KYC balance cap checked.
- **Withdraw:** debit user main (+fee) into an "in-transit" account, then an IMPS payout. On success: debit in-transit, credit escrow outflow. On failure: reverse to user main.

**Cross-shard transfers:** use a **TC/C-style or saga pattern** with a system in-flight account: debit A (local txn with an outbox) → credit B (local txn, idempotent by transfer id). Failures are compensated. Or co-locate merchant accounts per shard group with **hot merchant sub-accounts** (see the deep dive).

**Limits service:** tracks per-user monthly counters (loads, transfers) and KYC tier, and is checked synchronously before operations (with counters in the same shard as the wallet, or Redis with reconciliation).

**Everything** emits events (outbox → Kafka) for notifications, history, cashback engines and fraud.`,
    deepDives: [
      {
        topic: "Hot merchant accounts",
        discussion: `A big merchant (a large recharge or ticketing partner) receives hundreds of credits per second. Updating one balance row for each credit serialises on its row lock. Mitigations: (1) **split the merchant account into N sub-accounts** (merchant#0..#31), credit a random one, and compute the balance as the sum. Settlement aggregates the sub-accounts. (2) **Batch credits**: payments debit users immediately and post a "merchant payable" ledger entry, and a batcher credits the merchant balance every second in aggregate. Merchants don't need real-time balance precision, so this is an acceptable eventual consistency. Users' debits stay strongly consistent, since that's where overspending risk lies. The ledger entries remain exact per payment for audit.`,
      },
      {
        topic: "KYC limits and regulatory rules",
        discussion: `RBI PPI rules differ by KYC level: minimum-KYC wallets have lower balance and monthly load caps and may be restricted from P2P and cash withdrawal, while full-KYC wallets have higher limits. Model limits as policy data by tier, and check them transactionally: a load must not push the balance above the cap (checked in the same transaction as the credit, via \`WHERE balance + :amt <= :cap\`), and monthly counters are incremented in the same transaction or with compensation. Cashback credits count toward the balance, so a cashback that would breach the cap is either deferred or credited as a separate non-withdrawable promotional balance, per policy. All checks are logged for audits. KYC upgrades (video KYC) change the tier and the limits immediately.`,
      },
      {
        topic: "Idempotency and failure handling",
        discussion: `Every external interaction has an idempotency key: PG payment id for loads, client txn id for payments, transfer id for P2P, payout id for withdrawals. The ledger's external_ref column is unique, so a replay can't double-post. Asynchronous steps (withdraw via IMPS) use state machines with reversal paths: IMPS timeouts stay pending (with status polling), and a failure reverses the in-transit amount to the user. Daily reconciliation compares the ledger escrow balance with the escrow bank account statement (the regulator expects them to match), PG settlements with loads, and payout bank reports with withdrawals. The sum of all user balances plus merchant balances must equal the escrow balance, which is the key invariant to monitor.`,
      },
    ],
    tradeoffs: [
      "Conditional-update balances are simple and strongly consistent, but hot accounts need splitting or batching",
      "Sub-balances (cashback, gift) enable promotions but complicate debit precedence and refunds",
      "Cross-shard P2P via saga avoids 2PC but shows in-flight states; a co-location strategy reduces cross-shard traffic",
      "Real-time limit counters in Redis are fast but need reconciliation; DB counters are exact but add write load",
    ],
    followUps: [
      { q: "A payment to a merchant is refunded after the merchant was settled. What happens?", a: "Post a reversing entry: debit the merchant wallet (it can go negative, netted against future settlements), credit the user. Refund to the original sub-balance per policy (cashback returned as cashback)." },
      { q: "How do you expire cashback after 30 days?", a: "Store cashback as lots with expiry dates. A daily job posts expiry entries (debit cashback lot, credit expiry income) for unused amounts, consuming lots FIFO on debits." },
      { q: "What invariant would you alert on first?", a: "The sum of all wallet balances equals the escrow account balance in the ledger and the bank statement. Any drift is a severity-1 incident." },
    ],
    relatedTopics: ["design-commerce", "ds-transactions", "db-connections-locks", "prod-correctness-ops", "ds-concurrency", "db-sharding"],
  },
  {
    id: "co-paytm-2",
    company: "paytm",
    title: "Design a high-volume notification service (OTP, SMS, push) with provider failover",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the central notification platform that sends OTPs, transaction alerts and promotional messages over SMS, push, WhatsApp and email, with provider failover, priority lanes (OTP first) and DLT compliance, at crores of messages per day.",
    clarifyingQuestions: [
      "Message classes: OTP (seconds matter), transactional alerts, promotional (bulk campaigns)?",
      "Channels and providers: multiple SMS aggregators, FCM/APNs, WhatsApp BSPs, email ESPs?",
      "Compliance: TRAI DLT template registration, promotional time windows (9 AM–9 PM), user opt-outs?",
      "Delivery tracking: delivery receipts (DLRs) and retries across providers?",
      "Scale: ~50 crore notifications/day; campaigns of 5 crore in an hour?",
    ],
    functional: [
      "API for services to send a notification (template id + params + user or recipients + priority)",
      "Channel routing and fallback (push → SMS for OTPs if push fails)",
      "Provider selection with health-based failover and cost optimisation",
      "Delivery tracking, user preferences/opt-outs, rate limiting per user, templates with DLT ids",
    ],
    nonFunctional: [
      "OTP p95 delivery under 5 s end to end; never blocked by promotional traffic",
      "Throughput: 50 crore/day, bursts of ~50K/s during campaigns",
      "At-least-once sending with dedup; no duplicate OTPs spamming users",
      "Compliance-by-design (DLT, consent) and full audit",
    ],
    estimation: [
      { label: "Volume", calc: "50 crore/day ≈ 5.8K/s average; campaigns add ~15K/s; OTPs ~500/s steady, ~3K/s peak" },
      { label: "SMS cost", calc: "At ~₹0.15/SMS, 20 crore SMS/day ≈ ₹3 crore/day → cost-aware routing and push-first matter" },
      { label: "Provider limits", calc: "Each SMS aggregator ~1–3K TPS per account → need 5–10 accounts or providers for peak" },
      { label: "Status data", calc: "50 crore × ~300 B (message + DLR) ≈ 150 GB/day → 30–90 day retention" },
    ],
    highLevelDesign: `**Intake:** \`POST /notify {templateId, userId|recipients, params, priority, idempotencyKey, channelsPreferred}\`. The **notification API** validates the template (with its DLT template id and sender header for SMS), renders the content, checks the **preferences service** (opt-outs, quiet hours for promotional messages, per-user frequency caps), dedupes by idempotency key, and writes a message record (status QUEUED).

**Priority lanes:** separate Kafka topics or queues per class: \`otp\`, \`transactional\`, \`promotional\`. Each has its own dedicated consumer pool and provider quota, so a 5-crore campaign can never delay OTPs. Promotional sends are also paced by a campaign scheduler (tokens per second) and restricted to allowed hours.

**Channel workers:** SMS, push (FCM/APNs), WhatsApp and email workers pick messages from their lanes and call the provider through a **provider router**:
- Per-provider health (success rate, DLR latency, errors) and capacity (TPS quotas).
- Routing policy by class: OTP goes to the fastest and most reliable provider, with **fast failover** (if no submit ack within ~2 s or on an error, retry on the next provider). Promotional goes to the cheapest within capacity.
- Circuit breakers per provider. Operator-specific routing (some aggregators perform better on some telecom operators).

**Delivery receipts:** providers call back with DLRs. A DLR processor updates the message status (DELIVERED/FAILED), and fallback rules can trigger (an OTP push with no delivery in 5 s leads to SMS). Metrics per provider and operator feed the router.

**Storage:** message records and statuses in a wide-column store (by message id and by user for history), with a short retention. Aggregates for dashboards come via the stream.`,
    diagram: `Services ─► Notification API (template render, DLT ids, prefs/opt-out,
                               dedupe, frequency caps)
                  │ by priority
    ┌─────────────┼───────────────────┐
    ▼             ▼                   ▼
otp topic   transactional topic   promotional topic ◄── campaign pacer
    │             │                   │ (time windows, tokens/s)
    ▼             ▼                   ▼
Dedicated worker pools per lane (SMS / push / WhatsApp / email)
                  │
                  ▼
    Provider router (health, quotas, cost, operator) ─► SMS aggregators A/B/C,
                  ▲                                     FCM/APNs, BSPs, ESPs
                  │ DLR callbacks
       DLR processor ─► status store ─► fallback (push→SMS) + metrics`,
    deepDives: [
      {
        topic: "Isolating OTPs from everything else",
        discussion: `OTPs are on the login and payment critical path: a 30-second delay equals failed logins and abandoned payments. Isolation at every layer: separate topics and consumer pools (never shared queues), reserved provider capacity (dedicated sender ids and accounts with TPS headroom), higher-priority routing to premium routes, and aggressive failover (timeout after ~2 s on submission, try the next provider). Rate-limit per user (e.g. 5 OTPs per 10 minutes) to prevent abuse and SMS-pumping fraud (bots triggering OTPs to premium numbers). Dedupe identical OTP requests within seconds (return the same OTP) to avoid user confusion. Monitor the OTP delivery p95 per operator, and alert on DLR latency spikes.`,
      },
      {
        topic: "Provider failover without duplicates",
        discussion: `Failover risks double-sending: provider A accepted but was slow to acknowledge, and we also sent via B. For OTPs, a duplicate is tolerable (the same code, so resending the identical content is harmless), and speed wins. For transactional alerts, prefer waiting for the provider ack with a longer timeout before failing over, and include a message id in provider requests where supported, for idempotency. For promotional messages, never fail over mid-flight: retry later on the same provider or drop. The router maintains a per-provider state (healthy, degraded, down) from rolling metrics, and moves traffic weights gradually (e.g. 80/20) to avoid flapping. Contracts with 3+ aggregators prevent single-vendor dependence.`,
      },
      {
        topic: "Compliance and user trust",
        discussion: `In India, TRAI's DLT regime requires registered sender headers and content templates for commercial SMS. Unregistered content is blocked by operators. The platform stores the DLT template ids with templates, and variable substitution is validated against the registered format. Promotional messages respect consent and opt-outs (and the National Customer Preference Register), time windows (no promotional SMS at night), and frequency caps per user per day across channels. That's also good UX. Audit logs keep who sent what, when, why (the triggering service) and the delivery outcome for dispute resolution. Channel preference logic prefers push and in-app (free) over SMS (paid) for non-critical messages, which also cuts cost significantly.`,
      },
    ],
    tradeoffs: [
      "Dedicated OTP infrastructure costs more (reserved capacity) but protects critical flows",
      "Fast failover improves OTP latency but risks duplicates; acceptable for OTPs, not for alerts",
      "Push-first for non-critical messages saves SMS cost but has lower reach (uninstalled apps, disabled notifications)",
      "Central platform standardises compliance but becomes a critical dependency; design it for high availability",
    ],
    followUps: [
      { q: "A campaign accidentally targets 5 crore users with the wrong message. How do you stop it?", a: "Campaign-level kill switch: the pacer stops issuing tokens and queued campaign messages are purged by campaign id. Messages already submitted to providers can't be recalled, which is why pacing and staged rollouts (1% first) matter." },
      { q: "How do you prevent SMS pumping fraud?", a: "Per-user and per-IP OTP rate limits, CAPTCHA on repeated requests, blocking premium-rate number ranges, anomaly detection on OTP request spikes per country or operator, and cost alerts." },
      { q: "How do you track delivery rates for a campaign in real time?", a: "DLR events stream into aggregations per campaign (sent, delivered, failed) shown on dashboards, with provider and operator breakdowns." },
    ],
    relatedTopics: ["design-infra", "mq-scenarios", "rate-limiting", "rel-patterns", "prod-async-failure", "security-general"],
  },
  // ---------------------------------------------------------------- CRED
  {
    id: "co-cred-1",
    company: "cred",
    title: "Design credit card bill payments with statement fetch and reminders",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the system that fetches members' credit card bills (via BBPS or bank APIs), reminds them before the due date, and lets them pay the bill instantly, ensuring the payment reaches the card issuer on time and is never lost or duplicated.",
    clarifyingQuestions: [
      "Bill sources: BBPS (Bharat Bill Payment System) bill fetch, bank/issuer APIs, or parsing email/SMS statements with consent?",
      "Payment rails to the issuer: BBPS payment, NEFT/IMPS to the card account, issuer direct integrations?",
      "What does instant mean: the card limit is restored in minutes via BBPS vs T+1 via NEFT?",
      "Scale: ~1.5 crore members, ~2 cards each; peak around salary days and due dates?",
      "Reminders: channels and cadence; smart reminders based on payment habits?",
    ],
    functional: [
      "Link cards (tokenised/masked), fetch the latest bill (amount due, minimum due, due date)",
      "Schedule reminders before the due date; notify on bill generation",
      "Pay the bill via UPI/netbanking into CRED, then settle to the issuer via BBPS or bank transfer; track until the issuer confirms",
      "Payment history, receipts, refunds for failed issuer settlement",
    ],
    nonFunctional: [
      "Correctness: a member's payment must reach the issuer before the due date, or be refunded; no duplicates",
      "Transparency: status updates (processing → paid to issuer)",
      "Handle peaks near due dates and month-end (5–10× normal)",
      "Security and compliance (card data tokenisation, RBI guidelines; no full PAN storage)",
    ],
    estimation: [
      { label: "Cards", calc: "1.5 crore members × 2 cards = 3 crore cards; bills monthly → 3 crore bill fetches/month ≈ 10 lakh/day" },
      { label: "Bill fetch rate", calc: "Spread across the cycle but clustered around statement dates → ~50/s average, ~500/s peak (issuer/BBPS rate limits!)" },
      { label: "Payments", calc: "~1.5 crore payments/month ≈ 5 lakh/day; peaks ~3× near due dates → ~20/s, spikes ~200/s" },
      { label: "Reminders", calc: "~3 reminders per bill → 9 crore/month ≈ 30 lakh/day via push/SMS/WhatsApp" },
    ],
    highLevelDesign: `**Bill fetch:**
- The **card registry** stores linked cards as the issuer, a masked number, an issuer-provided token/reference and the BBPS biller id, never the full PAN (RBI tokenisation rules).
- A **bill fetch scheduler** triggers fetches around each card's statement date (learned from history), through a **BBPS connector** (via a BBPS operating unit partner) or issuer APIs. It uses per-biller rate limits and retries with backoff, because issuers throttle heavily. Results go to the **bill store** (amount due, minimum due, due date, statement date).
- Consent-based email or SMS parsing is a fallback for billers not on BBPS.

**Reminders:** a reminder scheduler creates reminder jobs relative to the due date (e.g. D−5, D−2, D−0), cancelled when the bill is paid. Timing and channel are personalised by past behaviour.

**Payment flow (two legs):**
1. **Collection leg:** the member pays CRED via a PG (UPI/netbanking) with an idempotency key (billId + attempt). On capture, the ledger posts: debit PG receivable, credit member-to-issuer payable.
2. **Issuer settlement leg:** the **payout orchestrator** pays the issuer via **BBPS payment** (the fastest confirmation, where the card limit usually updates quickly) or NEFT/IMPS to the card account, with a unique reference. A state machine goes COLLECTED → SENT_TO_ISSUER → CONFIRMED | FAILED. Status comes from BBPS or bank responses and polling.
3. **Failure:** if the issuer settlement fails and can't be retried before the due date, **auto-refund** the member and notify them urgently (they may incur late fees otherwise, which is the product's trust promise).

**Reconciliation:** daily matching of PG settlements, BBPS/bank payout reports and issuer confirmations against the ledger. Any member payment not confirmed by the issuer within the SLA triggers ops escalation.

**Peak handling:** payments cluster on due dates and salary days (1st–5th). The collection leg scales on stateless services, while issuer settlement is queued and paced per issuer's limits with priority by due date.`,
    diagram: `Card registry (tokens, biller ids) ─► Bill fetch scheduler ─► BBPS / issuer APIs
                                            │ rate-limited per biller
                                            ▼
                                      Bill store ─► Reminders ─► push/SMS/WA
Member ─► Pay bill ─► PG (UPI/netbanking, idem key) ─► ledger: collected
                                            │
                                            ▼
          Payout orchestrator (priority by due date, per-issuer pacing)
                │ BBPS payment / NEFT / IMPS (unique ref)
                ▼
          Issuer ─► confirmation ─► state CONFIRMED ─► receipt to member
                │ failure → retry or auto-refund before due date
Daily reconciliation: PG ⇄ BBPS/bank reports ⇄ issuer confirmations ⇄ ledger`,
    deepDives: [
      {
        topic: "The two-leg money flow and its failure modes",
        discussion: `The member's money enters CRED (leg 1) before reaching the issuer (leg 2), so there's a window where CRED holds it and must deliver it. Failure modes: leg 1 succeeds but leg 2 fails (issuer down, wrong card reference); leg 2 times out (unknown status); or the member pays twice (two devices). Controls: idempotency on leg 1 per bill and amount (warn on a duplicate payment for the same bill within minutes), a durable leg-2 state machine with status polling and a **deadline awareness** (if the due date is near and the rail is slow, choose a faster rail or escalate), and automatic refunds when leg 2 can't complete. The ledger makes the in-flight amounts visible (member-to-issuer payable), and an ageing report on that account is the key ops dashboard.`,
      },
      {
        topic: "Fetching bills under issuer rate limits",
        discussion: `Issuers and BBPS impose strict rate limits and have variable uptime. Blindly fetching all 3 crore cards on the 1st would be throttled and slow. Learn each card's statement date from history and fetch just after it (spreading load naturally), and use **token buckets per biller** at the connector with priority queues (a member-initiated refresh gets priority over background fetches). Cache the fetched bill until the next statement, and re-fetch before the due date only if needed (to catch payments made elsewhere). A per-biller circuit breaker stops hammering a failing issuer. Show "last updated" timestamps in the UI. Being honest about data freshness is part of the design.`,
      },
      {
        topic: "Security and compliance",
        discussion: `Card data is sensitive. Store only masked numbers and issuer or BBPS references, with RBI card-on-file tokenisation for any card used as a payment instrument. Encrypt personal data at rest with KMS-managed keys, and restrict access by service identity. All payment operations are audited. Consent flows cover email or SMS statement parsing (explicit opt-in, minimal extraction, and deleting raw messages). Fraud checks cover unusual payment amounts, card linking attempts across many accounts, and account takeover signals (new device + payment method change). Refunds go only to the original source instrument. Reliability SLOs are about trust: the percentage of payments confirmed by the issuer within T minutes, and zero late-fee incidents caused by CRED.`,
      },
    ],
    tradeoffs: [
      "BBPS gives standardised, fast confirmations but not every biller is on BBPS and it adds a dependency; NEFT is universal but slower",
      "Proactive bill fetching improves UX but consumes issuer rate limits; on-demand fetches are fresher but slower",
      "Holding funds briefly between legs adds risk and compliance duties; direct issuer rails remove it but are hard to integrate",
      "Aggressive reminders improve on-time payment but annoy users; personalise the cadence",
    ],
    followUps: [
      { q: "The member already paid the bill via the bank app. How do you avoid a duplicate?", a: "Re-fetch the bill before payment (a BBPS fetch returns the current due), show \"already paid\" signals, and warn on paying more than the outstanding amount." },
      { q: "How do you guarantee issuer credit before the due date when the member pays at 11:50 PM on the due date?", a: "You can't guarantee it for slow rails. Show a cut-off warning, prefer the fastest rail (BBPS), and state the expected credit time clearly. Policies may offer late-fee protection for CRED-caused delays." },
      { q: "How would you add rewards (coins) for paying bills?", a: "The payment-confirmed event (after issuer confirmation) triggers the rewards service idempotently by payment id. See the CRED rewards design." },
    ],
    relatedTopics: ["design-commerce", "prod-async-failure", "rate-limiting", "ds-transactions", "security-general", "prod-correctness-ops"],
  },
  {
    id: "co-cred-2",
    company: "cred",
    title: "Design a rewards system with coins and limited-inventory drops",
    frequency: "medium",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design CRED's rewards platform: members earn coins for paying bills, spend coins on rewards and limited \"drops\" (e.g. 500 premium vouchers released at 8 PM), and gamified jackpots, with fraud-resistant, exactly-once coin accounting.",
    clarifyingQuestions: [
      "Coin earning rules: 1 coin per rupee of bill paid? Caps? Coins expire?",
      "Redemption: fixed-price catalogue, auctions/bids, jackpot spins (probabilistic)?",
      "Drops: limited inventory with thousands of members competing at a fixed time?",
      "Fraud: abuse via fake bill payments, multiple accounts, reversed payments?",
      "Scale: ~1.5 crore members; a drop may attract ~5 lakh members in the first minute?",
    ],
    functional: [
      "Credit coins on eligible events (bill payment confirmed), with a ledger per member",
      "Redeem coins for catalogue rewards, drops and jackpot spins",
      "Limited-inventory drops with a fair allocation at launch time",
      "Reversals (payment refunded → coins clawed back), expiry, and a history view",
    ],
    nonFunctional: [
      "Exactly-once coin credits and debits; no negative coin balances",
      "Drops: fair, no overselling of limited inventory; fail fast for losers",
      "Resistant to abuse (bots, multi-accounting)",
      "Highly available during drops (bursty traffic)",
    ],
    estimation: [
      { label: "Coin credits", calc: "~5 lakh bill payments/day → 5 lakh credit events/day ≈ 6/s (easy)" },
      { label: "Drop burst", calc: "5 lakh members × 3 attempts in 60 s ≈ 25K requests/s for 500 units" },
      { label: "Coin ledger", calc: "~20 lakh entries/day (earn, burn, expiry, clawback) × 200 B ≈ 400 MB/day" },
      { label: "Jackpot spins", calc: "~10 lakh spins/day ≈ 12/s average, event peaks ~2K/s" },
    ],
    highLevelDesign: `**Coin ledger:** coins are a currency, so treat them like money. A double-entry ledger in Postgres (sharded by member) has accounts for member coin balances (with **lots** that carry expiry dates), the coin issuance account (platform liability), a redemption sink, expiry, and clawback. \`coin_balance(member, balance, version)\` is updated in the same transaction as the entries, with the conditional debit \`balance >= cost\`.

**Earning:** the payments system emits **BillPaymentConfirmed** (after issuer confirmation, not just collection, to prevent coin farming via payments that later fail) to Kafka. The rewards service computes the coins by rule (a rules engine: rate, caps per month, and campaign multipliers) and posts the credit with external_ref = paymentId, so replays can't double-credit. If the payment is refunded later, a **clawback** entry is posted, and the balance may go negative (blocking redemptions until it recovers).

**Catalogue redemption:** \`POST /redeem {rewardId, idemKey}\` debits coins and reserves the reward's inventory (voucher codes) in one saga: debit coins (local txn), allocate a voucher (conditional update on the inventory or pop a pre-generated code). On failure, compensate by refunding the coins.

**Drops (limited inventory at a fixed time):**
1. The drop page and countdown are served from CDN. At T0, requests go through an **admission layer** (per-member rate limit, bot checks, an eligibility check such as a minimum CRED score or coin balance).
2. The **inventory gate** in Redis: a pre-loaded list of 500 voucher codes (LPOP gives each winner a unique code atomically) or a counter with DECR, plus \`SET member:{drop}:{uid} NX\` to allow one per member, all in one Lua script.
3. Winners proceed to the coin debit (the durable ledger). If the debit fails (insufficient coins), the code goes back to the pool (RPUSH).
4. Losers get "sold out" instantly, and the drop status flips at the CDN.

**Jackpot (probabilistic rewards):** outcomes are generated server-side with a cryptographically secure RNG against a **pre-allocated prize budget** (prize counts per day, so the system can never give out more high-value prizes than budgeted), and every spin is logged for audit.`,
    diagram: `Payments ─ BillPaymentConfirmed ─► Kafka ─► Rewards rules engine
                                                │ credit (ref=paymentId)
                                                ▼
                                 Coin ledger (double-entry, lots with expiry)
                                   ▲         ▲             ▲
                     debit/refund  │         │ clawback     │ expiry job
Member ─► Redeem API ─────────────┘   Refund events         │
Member ─► Drop (CDN page) ─► Admission (rate limit, bots, eligibility)
                            ─► Redis gate: Lua (one per member + LPOP code)
                                  │ winner → coin debit → confirm code
                                  │ debit fails → RPUSH code back
Jackpot ─► Spin svc (CSPRNG, prize budget per day, audit log)`,
    deepDives: [
      {
        topic: "Exactly-once coins and clawbacks",
        discussion: `Every coin movement has an external reference: an earn uses the paymentId, a burn uses the redemptionId, and a clawback uses the refundId. The unique constraint on (external_ref, entry type) makes Kafka redeliveries and retries harmless. Earning only on the *confirmed* issuer payment closes the loop where users pay, earn coins, and get the payment refunded. If a refund still happens, the clawback debits the coins. Allowing a negative balance (with redemption blocked) is simpler and fairer than failing the clawback. Expiry uses lots: coins credited on date D expire at D + 12 months, consumed FIFO by burns, and a nightly job posts expiry entries for the unconsumed remainder of each expired lot.`,
      },
      {
        topic: "Fair drops without overselling",
        discussion: `500 vouchers and 5 lakh members is a classic flash-sale shape, at a smaller scale than e-commerce. A single Lua script per request checks the member's eligibility flag, enforces one-per-member (\`SET NX\`) and pops a code (\`LPOP\`) atomically, so it can't oversell and there are no duplicate winners. The hash tag keeps the drop's keys in one slot. 25K scripted ops/s is fine for a single Redis shard. The durable coin debit happens after the gate, and if it fails the code is returned. Fairness levers: a randomised admission order within the first second (neutralising bots with faster reflexes), eligibility gates (proof of real members), and device-level rate limits. After the drop, a reconciliation checks that codes allocated in Redis equal the redemptions recorded in the DB.`,
      },
      {
        topic: "Fraud resistance",
        discussion: `Rewards attract abuse: multi-accounting (many accounts behind one person), circular bill payments (paying a card with money from the same card to farm coins), and bots for drops. Controls: identity strength (phone + device + KYC-grade signals), the graph linking accounts via devices, cards and bank accounts to detect clusters, per-card and per-month earning caps, earning only after issuer confirmation, velocity rules on redemptions, and manual review for high-value rewards. Keep fraud decisions explainable and reversible (a flagged account's redemptions are held, not silently dropped). Monitoring: coin issuance per day vs forecast, and redemption spikes per reward. Clear public rules for earning and redemption also reduce disputes, because members know exactly why an action didn't earn coins.`,
      },
    ],
    tradeoffs: [
      "Treating coins as a double-entry currency is heavier but gives auditability and correctness",
      "Earning on issuer confirmation delays gratification but prevents farming via failed payments",
      "Redis gate for drops is fast and atomic, but the DB remains the ledger; reconciliation is needed",
      "Pre-allocated prize budgets cap liability but make jackpot odds time-dependent; disclose rules transparently",
    ],
    followUps: [
      { q: "How do you run an auction-style drop (highest coin bid wins)?", a: "Collect sealed bids with coin holds (reserve coins) until the close. Pick the top N at close, convert the winners' holds to burns, and release the losers' holds. All steps are ledgered and idempotent." },
      { q: "A bug credits 10× coins for an hour. What do you do?", a: "Stop the rule via a feature flag, identify the affected credits by rule version, post correcting debit entries (with user communication), and block redemptions from the excess in the meantime." },
      { q: "How do you show a member's coin history?", a: "From the ledger entries per member, paginated and joined with human-readable reasons (the event type and reference)." },
    ],
    relatedTopics: ["design-commerce", "ds-concurrency", "rate-limiting", "cache-failures", "prod-correctness-ops", "security-general"],
  },
  // ---------------------------------------------------------------- Meesho
  {
    id: "co-meesho-1",
    company: "meesho",
    title: "Design supplier catalogue ingestion with image dedup and moderation",
    frequency: "high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the pipeline where lakhs of small suppliers upload products (images, titles, prices, variants) that are validated, deduplicated, moderated, categorised and published to the catalogue within minutes, cost-efficiently.",
    clarifyingQuestions: [
      "Upload channels: supplier app/panel single uploads and bulk CSV + image zips?",
      "Volume: ~10 lakh new SKUs/day? Images per product (3–8)?",
      "Moderation: prohibited items, counterfeit brands, adult content, image quality?",
      "Duplicates: the same product listed by many suppliers (common with resellers)? Merge them or show the best?",
      "Latency: live within 30 minutes, with a human review SLA for flagged items?",
    ],
    functional: [
      "Accept uploads (single and bulk), validate schema and required attributes per category",
      "Image processing: resize, compress, quality checks, perceptual dedup",
      "Moderation: automated classifiers + human review queues; policy enforcement",
      "Auto-categorisation and attribute extraction; publish to the catalogue and search index",
    ],
    nonFunctional: [
      "Throughput: 10 lakh SKUs/day, bursty (suppliers upload in the evening)",
      "Cost efficiency: CPU/GPU for ML moderation, storage, CDN",
      "Publish latency p95 under 30 minutes for clean items",
      "Accuracy: low false positives (blocking genuine suppliers hurts the supply side)",
    ],
    estimation: [
      { label: "SKUs and images", calc: "10 lakh SKUs/day × 5 images = 50 lakh images/day ≈ 58/s average, evening peak ~500/s" },
      { label: "Image storage", calc: "50 lakh × 1.5 MB original ≈ 7.5 TB/day raw; after compression + 4 resized variants (~300 KB total) keep originals in cold storage" },
      { label: "ML inference", calc: "~500 images/s peak × (moderation + embedding + category) ≈ 1,500 inferences/s → a GPU pool of ~10–20 GPUs with batching" },
      { label: "Human review", calc: "~5% flagged → 50K SKUs/day → ~100 reviewers at ~500 reviews/day each" },
    ],
    highLevelDesign: `**Upload:** the supplier panel requests presigned URLs and uploads images directly to object storage (S3/GCS), then submits the product JSON referencing the image keys. Bulk uploads (CSV + zip) go to storage, and an async job explodes them into per-product tasks. Each product submission becomes a **catalogue draft** (state DRAFT) and an event on Kafka.

**Processing pipeline (a DAG per product, workers per stage, Kafka topics between stages):**
1. **Validation:** required attributes per category schema, price sanity, and variant consistency (sizes, colours). Errors go back to the supplier immediately.
2. **Image processing:** decode, auto-orient, resize to variants (thumbnail, listing, zoom), convert to WebP/AVIF, strip EXIF, and quality checks (blur, too small, heavy text overlays or watermarks).
3. **Perceptual dedup:** compute pHash/dHash plus a CNN embedding for each primary image. A lookup in a **near-duplicate index** (a Hamming-distance search over pHash via multi-index hashing, or ANN over embeddings in FAISS/Milvus) groups identical products across suppliers into a **product cluster**, which enables catalogue dedup (one product page with multiple sellers, or ranking the best listing).
4. **Moderation:** image classifiers (adult, weapons, prohibited categories), a brand/logo detector for counterfeits, and text models on titles and descriptions. Scores are combined, then auto-approve, auto-reject (with a reason) or send to **human review**.
5. **Categorisation and attribute extraction:** ML predicts the category and attributes (colour, material, pattern) from images and text, and fills gaps.
6. **Publish:** the catalogue DB (sharded by product id), plus events to the search indexer and feed candidate generators. Images are served via CDN.

**Cost levers:** batch GPU inference, cheap CPU models first (a cascade where only uncertain items go to heavier models), spot instances for batch workers, and lifecycle policies moving originals to cold storage.`,
    diagram: `Supplier panel ─► presigned upload ─► Object storage (originals)
      │ product JSON / bulk CSV
      ▼
 Catalogue draft ─► Kafka ─► Validate ─► Image proc (resize, WebP, quality)
                                                 │
                                                 ▼
                       Perceptual dedup (pHash + ANN) ─► clusters
                                                 │
                                                 ▼
                   Moderation (CPU → GPU) ─► approve / reject / human
                                                 │
                                                 ▼
                     Categorise ─► Publish: catalogue, search, feed
                                                 │
                                          CDN (resized variants)`,
    deepDives: [
      {
        topic: "Near-duplicate detection at scale",
        discussion: `Resellers upload the same product photos (often with small crops, watermarks or colour changes) under many supplier accounts, so exact hashes miss them. Use two layers: **perceptual hashes** (a 64-bit pHash, where similar images differ in a few bits) with a Hamming search (split into 4 × 16-bit blocks and index each block, so candidates share at least one exact block), which is fast and cheap. Then **CNN embeddings** (e.g. 256-dimension) with ANN search (HNSW) for harder cases, verified by a similarity threshold. Group matches into clusters with union-find. The product decision: show one canonical listing per cluster (the best price, rating and fulfilment reliability) with the other sellers as offers, which improves search quality and prevents spammy results.`,
      },
      {
        topic: "Moderation cascade and human review",
        discussion: `Running the heaviest model on every image is expensive. A **cascade** is cheaper: fast CPU classifiers (MobileNet-class) run first. Confident safe items are auto-approved, confident violations auto-rejected, and only the uncertain middle (~10–20%) goes to heavier GPU models, with a residual ~5% going to humans. Thresholds are tuned per category by precision and recall targets, since false rejections anger genuine suppliers and false approvals create legal and brand risk. Human review queues are prioritised by supplier trust, category risk and SLA. Reviewer decisions feed training data (active learning). Supplier trust scores (history of violations) adjust thresholds per supplier: trusted suppliers get faster auto-approval.`,
      },
      {
        topic: "Handling evening upload bursts cost-effectively",
        discussion: `Suppliers upload in the evening, 5–10× the average. Kafka buffers the bursts, so the pipeline is **throughput-oriented**, not latency-critical beyond the 30-minute SLO. Autoscale workers on consumer lag, with GPU inference batched (collect up to 32 images or 50 ms) for 5–10× throughput per GPU. Spot or preemptible nodes run the stateless stages, since tasks are idempotent (keyed by productId and image hash, so reprocessing overwrites). Priority lanes let single uploads from active suppliers go ahead of bulk imports. Image variants are generated once and cached on the CDN forever (content-hashed URLs). The metric to watch is cost per published SKU, which Meesho cares about explicitly.`,
      },
    ],
    tradeoffs: [
      "A moderation cascade saves GPU cost but adds pipeline complexity and threshold tuning",
      "Clustering duplicates improves catalogue quality but must be fair to suppliers (which listing wins?)",
      "Async pipeline with a 30-minute SLO is cheaper than synchronous processing but delays go-live",
      "Aggressive image compression saves bandwidth for low-end devices but may reduce perceived quality",
    ],
    followUps: [
      { q: "A supplier uploads 50,000 SKUs via CSV. How do you keep it from starving others?", a: "Put bulk jobs in a separate lower-priority lane with per-supplier concurrency caps, and progress reporting per job." },
      { q: "How do you handle a supplier editing the price after publishing?", a: "Price edits skip image processing and go through validation and anomaly checks (a 90% drop is suspicious), then update the catalogue and search index quickly." },
      { q: "How would you detect counterfeit branded products?", a: "Logo detection plus brand-keyword matching in titles, combined with the price being too low for the brand and supplier authorisation checks. Flagged items go to review." },
    ],
    relatedTopics: ["data-pipelines", "object-storage", "cdn-global", "mq-scenarios", "search-systems", "prod-scale"],
  },
  {
    id: "co-meesho-2",
    company: "meesho",
    title: "Design a personalised home feed for 15 crore users on low-end devices",
    frequency: "medium",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the product home feed: an infinite scroll of personalised product cards for ~15 crore monthly users, many on low-end Android phones and 3G/4G connections in tier-2/3 cities, at low infrastructure cost.",
    clarifyingQuestions: [
      "Feed composition: personalised products, category widgets, sale banners, trending items?",
      "Freshness: reflect a user's recent clicks within the same session?",
      "Scale: ~3 crore DAU, sale-day peaks of ~5×?",
      "Constraints: app size, image data per card, and latency on slow networks?",
      "Cold start: many first-time internet shoppers with no history?",
    ],
    functional: [
      "Return a ranked, paginated feed of product cards per user",
      "Personalise using history (views, carts, orders), location and price affinity",
      "Handle cold start via onboarding signals and popular items in the region/language",
      "Inject merchandising (sales, banners) and ensure diversity",
    ],
    nonFunctional: [
      "Server p95 under 150 ms for the first page; payload under ~100 KB per page",
      "Low cost per request (Meesho optimises infra spend aggressively)",
      "Sale-day peaks of ~2 lakh feed requests/s",
      "Graceful degradation to non-personalised feeds",
    ],
    estimation: [
      { label: "Requests", calc: "3 crore DAU × ~10 feed pages/day ≈ 30 crore/day ≈ 3.5K/s average; sale peak ×5 and evening ×3 → ~50K/s (plan 2 lakh/s headroom for big sales)" },
      { label: "Candidates", calc: "Catalogue ~10 crore listings → retrieval ~1,000 candidates → rank → 20 per page" },
      { label: "Payload", calc: "20 cards × (JSON ~500 B + thumbnail ~8–15 KB WebP) ≈ 200–300 KB per page → lazy-load images, small thumbs on slow networks" },
      { label: "Precompute", calc: "Precomputing top 200 per user for 3 crore DAU × 200 × 8 B ≈ 48 GB → feasible in a KV store" },
    ],
    highLevelDesign: `**Hybrid: precompute + real-time re-rank (cost-efficient).**

**Offline (batch, nightly and hourly):**
- Train embeddings (user and product) from interactions, using two-tower or item2vec over sessions.
- For each active user, **precompute a candidate list** (~200–500 products) from multiple sources: ANN over user embeddings, categories and price bands they like, co-viewed items, and trending in their state or language. Store it in a KV store (Redis/Aerospike, or ScyllaDB) keyed by user.
- For cold-start segments (new users by location, language and acquisition source), precompute **segment feeds**.

**Online (per request):**
1. The feed API gets the user's precomputed candidates (1 KV read), plus **session signals** (the last few clicked categories from a session store updated by the app's events via Kafka or a direct write).
2. A **lightweight re-ranker** (GBDT/LightGBM on CPU, with ~50 features) scores ~300 candidates in a few ms: base affinity, session boost, price fit, freshness, and seller quality and delivery speed.
3. Filters: out-of-stock (a bitmap from the inventory stream), already purchased, and non-serviceable pincodes.
4. **Blending and diversity:** interleave widgets (sale banners, categories), cap items per category and seller, and inject exploration items (~5%).
5. Pagination: return 20 items plus a cursor (a server-side snapshot of the ranked list cached for 30 minutes), so scrolling is consistent and cheap: page N is read from the cached list, not re-ranked.

**Client efficiency:** small WebP/AVIF thumbnails sized per device DPI via a CDN image service, lazy loading, prefetching the next page on good networks only, and compact JSON (or protobuf).

**Degradation:** if personalisation is down, serve the segment feed from cache, then a global popular feed.`,
    diagram: `Offline (Spark/GPU): embeddings, candidate gen per user & segment
               │ nightly + hourly refresh
               ▼
       KV store: user → top 300 candidates; segment → feed
               │
App ─► Feed API ─► fetch candidates + session signals (Redis)
               │
               ▼
       CPU re-ranker (GBDT, ~50 features) ─► filters (stock, serviceability)
               │
               ▼
       Blend widgets + diversity + exploration ─► ranked list cached per session
               │ page 1..N via cursor
               ▼
App (lazy WebP thumbs via CDN)   Events ─► Kafka ─► session store, training`,
    deepDives: [
      {
        topic: "Why precompute + lightweight re-rank",
        discussion: `A full real-time retrieval and heavy neural ranking per request at 50K+ QPS would need a large GPU fleet, which is expensive for a value-commerce business. Precomputing candidates offline amortises the expensive parts (embeddings, ANN searches) over the day, and online cost becomes a KV read plus CPU GBDT scoring of ~300 items (a few ms per request on commodity cores). Session freshness comes from a small set of real-time features (the categories clicked in this session), used as re-rank boosts. The trade-off is that candidates can be up to a few hours stale for new interests. Mitigate with hourly incremental refreshes for active users and a real-time "similar to what you just viewed" source computed from item-to-item tables.`,
      },
      {
        topic: "Designing for low-end devices and networks",
        discussion: `Many users are on budget phones with limited RAM and patchy 3G/4G. So: keep payloads small (cards with essential fields only; a price-formatted string instead of rich objects), serve thumbnails at a device-appropriate size via an image CDN with format negotiation (WebP/AVIF), and lazy-load and recycle views to limit memory. Cache the last feed on the device for instant startup and offline browsing. Avoid chatty APIs: one feed call returns the widgets and products together. Measure time-to-first-card and data consumed per session per network type, and adapt the page size and image quality to measured bandwidth. These UX choices often beat model improvements on engagement for this audience.`,
      },
      {
        topic: "Cold start and exploration",
        discussion: `A large share of users are new to e-commerce or the app. With no history, use context: location (state, city tier), language, device price band (a proxy for price affinity), acquisition source (for example, an ad for sarees), and onboarding choices. Serve **segment feeds** (precomputed per segment) that are updated hourly with trending items. Learn quickly within the session: the first few clicks shift the re-ranker's boosts. For new products (the long tail from suppliers), reserve exploration slots with a bandit (Thompson sampling on CTR) so good products get discovered. Diversity rules prevent the feed collapsing into one category after a single click.`,
      },
    ],
    tradeoffs: [
      "Precomputed candidates are cheap to serve but stale for new interests; real-time retrieval is fresh but costly",
      "GBDT on CPU is cheap and fast; deep models on GPU are more accurate but expensive",
      "Caching the ranked list per session makes pagination consistent and cheap, but it doesn't react mid-session",
      "Smaller images save data and speed but can reduce conversion for visual categories like fashion",
    ],
    followUps: [
      { q: "How do you inject a sale event into everyone's feed at 12 PM?", a: "Merchandising rules in the blending layer, driven by a config service with a start time: banner widgets and boosts for sale items, with no need to recompute candidates." },
      { q: "How do you measure feed quality?", a: "Online A/B tests on CTR, add-to-cart, orders per session and revenue per user, plus guardrails (diversity, supplier fairness, latency, data usage)." },
      { q: "The KV store with precomputed candidates is down. What happens?", a: "Fall back to cached segment feeds by location and language, then to globally popular items. The feed remains usable, just less personal." },
    ],
    relatedTopics: ["design-advanced", "cache-fundamentals", "cdn-global", "data-pipelines", "prod-performance", "design-social"],
  },
  // ---------------------------------------------------------------- Zepto
  {
    id: "co-zepto-1",
    company: "zepto",
    title: "Design dark-store inventory for 10-minute delivery",
    frequency: "very-high",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design the inventory system for a quick-commerce app delivering in 10 minutes from ~500 dark stores: customers must only be able to order what is physically available in their serving store, even when hundreds of orders compete for the last units.",
    clarifyingQuestions: [
      "How is a customer mapped to a dark store: one serving store per location polygon, or a fallback to a second store?",
      "SKUs per store (~5,000–8,000)? Order rate per store at peak (~5–10 orders/min, spikes on rain or match nights)?",
      "When is stock reserved: add-to-cart or checkout? How long is a reservation held?",
      "Sources of truth for physical stock: inbound receiving (GRN), picking, damages, cycle counts?",
      "Substitutions when an item is missing at pick time?",
    ],
    functional: [
      "Maintain the sellable quantity per (store, SKU) from store operations",
      "Show availability on catalogue and search for the serving store in real time",
      "Reserve stock at checkout atomically; release on payment failure or timeout; commit on pick",
      "Handle pick-time shortfalls (damaged or missing): substitutions, partial refunds, correcting inventory",
    ],
    nonFunctional: [
      "No overselling: the oversell/cancellation rate is a core metric (target under 0.5%)",
      "Availability updates visible within ~1–2 s",
      "Checkout reservation latency under 100 ms",
      "Store-level isolation: one store's issue doesn't affect others",
    ],
    estimation: [
      { label: "Stores and SKUs", calc: "500 stores × 6,000 SKUs = 30 lakh (store, SKU) rows → tiny (~300 MB)" },
      { label: "Orders", calc: "~15 lakh orders/day ≈ 17/s nationally; peak store ~2 orders/s during rain spikes" },
      { label: "Reservations", calc: "Average basket ~8 items → peak ~20K line reservations/min nationally ≈ 330/s; per store ≤ ~20/s" },
      { label: "Availability reads", calc: "~2 crore app sessions/day × ~30 catalogue page views → ~7K QPS average, ~50K QPS peak → cache per store" },
    ],
    highLevelDesign: `**Store mapping:** a **serviceability service** maps the customer's location to a serving dark store (point-in-polygon over store polygons, via H3 cells precomputed to store ids), considering the store's capacity state (temporarily shrinking the radius when the store is overloaded). The app session is pinned to that store, and the catalogue and availability are store-specific.

**Inventory model per (store, SKU):** \`physical_qty\` (the sum of bin quantities), \`reserved_qty\` (active checkout reservations and orders not yet picked), \`blocked_qty\` (damaged, quality hold) and **sellable = physical − reserved − blocked − buffer**, where the buffer is a small safety count for fast movers with poor count accuracy.

**Store operations as events:** GRN (inbound received and putaway), pick confirmations, damage marking, cycle counts and returns come from the **store ops app** (handhelds used by pickers and packers). They're written to the inventory service (the source of truth for physical movements) and published as events.

**Reservation at checkout:** a single-store transaction (the inventory for a store is sharded together, so a basket is one shard): for all basket lines, \`UPDATE inventory SET reserved = reserved + q WHERE store = ? AND sku = ? AND physical - reserved - blocked - buffer >= q\`. All lines must succeed, or it rolls back and returns the unavailable items for the UI to adjust. It's recorded with an order id and a TTL (e.g. 7 minutes for payment). Idempotency is by (order id, sku).

**Commit and release:** a successful payment converts the reservation to an order commitment. A payment failure or TTL expiry (a delayed message or sweeper) releases it. On pick, physical −= picked and reserved −= q. A shortfall at pick (the bin is empty) triggers substitution or a partial refund, **and immediately corrects physical to the observed count**, marking the SKU for a cycle count.

**Availability read path:** an inventory change event goes to a **per-store availability cache** (Redis hash per store: sku → sellable, plus a bitmap of in-stock SKUs), updated within a second. Catalogue and search APIs filter by the store's bitmap, and a 0-quantity item shows "out of stock" instantly.`,
    diagram: `Customer location ─► Serviceability (H3 → store, capacity-aware radius)
                                 │ serving store
                                 ▼
App ─► Catalogue/Search ─► per-store availability (Redis: sellable, bitmap)
    │                                   ▲ events (<1 s)
    │ checkout                           │
    ▼                                   │
Order svc ─► Inventory svc (sharded by store; one txn per basket)
               physical − reserved − blocked − buffer ≥ q ?
               │ reserve (TTL) / release / commit
               ▲
Store ops app (GRN, putaway, pick confirm, damage, cycle count) ─┘
Pick shortfall → substitute / refund + correct physical + cycle count task`,
    deepDives: [
      {
        topic: "Why reserve at checkout, per basket, in one store shard",
        discussion: `Reserving on add-to-cart would lock scarce stock (the last packs of milk at 7 AM) for browsers who never buy. Reserving at checkout with a short TTL balances conversion and accuracy. Because a basket is served by exactly one dark store, keeping all of a store's inventory rows on one shard makes the reservation a **single local transaction** across all lines: all-or-nothing, no distributed transaction. Per-store contention is modest (≤ ~20 line updates/s), so row-level locking in Postgres/MySQL is fine. For flash events (a limited drop), add a Redis gate in front. The conditional update (\`physical − reserved − blocked − buffer >= q\`) prevents oversell without read-then-write races.`,
      },
      {
        topic: "Inventory accuracy is the real problem",
        discussion: `Software can't sell what's actually missing from a shelf. The oversell rate comes mostly from **record inaccuracy**: mis-picks, damage not recorded, receiving errors, and theft. Countermeasures: bin-level tracking (each SKU in specific bins, and pickers scan the bin and item barcode), putaway confirmations after GRN before stock becomes sellable, **cycle counts** triggered by signals (pick shortfalls, zero-sales anomalies for fast movers, age since the last count), safety buffers per SKU based on its shortfall history, and immediate correction when a picker reports a missing item (set physical to the counted value). Track inventory record accuracy per store as an SLO. It predicts customer cancellations better than any software metric.`,
      },
      {
        topic: "Fast availability updates and store overload",
        discussion: `Customers must not see items that just sold out. Every inventory mutation emits an event (a Kafka partition per store), and a consumer updates the store's Redis hash and in-stock bitmap within about a second. Catalogue and search results are filtered by the bitmap at query time (search returns candidates, and the store bitmap is intersected). At checkout the reservation is authoritative, and a failure returns a precise list of unavailable items so the UI can adjust the cart without a dead end. Store overload (the pickers can't keep up during a rain spike) is also an inventory-adjacent control: the store's capacity state shrinks its serving radius or shows longer ETAs, protecting the 10-minute promise.`,
      },
    ],
    tradeoffs: [
      "Checkout-time reservation avoids hoarding, but users may see items become unavailable at checkout",
      "Safety buffers reduce oversell but hide sellable units (lost sales on low-stock items)",
      "Store-sharded inventory keeps baskets local, but cross-store fallback (a split order) becomes complex",
      "Real-time availability caches improve UX but need careful event ordering per store",
    ],
    followUps: [
      { q: "How would you add a fallback store when the primary is out of stock?", a: "Only for items the fallback store can serve within the ETA. It would split the order into two shipments, which is usually avoided in 10-minute delivery. Otherwise offer substitutes from the same store." },
      { q: "How do you forecast replenishment for dark stores?", a: "Per store per SKU demand forecasting (time of day, weather, events) drives purchase orders and transfers from the mother warehouse, with safety stock by service level." },
      { q: "Payment is slow (UPI pending) and the reservation TTL expires. What happens?", a: "Extend the TTL while payment is pending, up to a cap. If it expires and the payment later succeeds, try to re-reserve. If that fails, auto-refund and notify the customer." },
    ],
    relatedTopics: ["design-commerce", "ds-concurrency", "cache-fundamentals", "design-geo", "mq-scenarios", "db-connections-locks"],
  },
  {
    id: "co-zepto-2",
    company: "zepto",
    title: "Design store-aware product search for quick commerce",
    frequency: "medium",
    level: "SDE-2 / SDE-3",
    prompt:
      "Design product search where results must only include items in stock at the customer's serving dark store, ranked for fast conversion, with typo tolerance for Hinglish queries like \"doodh\" or \"amul btr\", within 100 ms.",
    clarifyingQuestions: [
      "Catalogue size: ~50K master SKUs, each store stocking ~6K?",
      "Languages: English, Hinglish and transliterations; brand-heavy queries?",
      "Should out-of-stock items appear (greyed out) or be hidden?",
      "Ranking signals: popularity per store, margin, promotions, personalisation?",
      "Autocomplete and query suggestions in scope?",
    ],
    functional: [
      "Search the catalogue with typo tolerance, synonyms, transliteration",
      "Filter results to the serving store's in-stock SKUs (or show OOS last)",
      "Rank by relevance, store-level popularity and conversion; show price and offers",
      "Autocomplete suggestions; \"did you mean\"",
    ],
    nonFunctional: [
      "p95 under 100 ms server-side",
      "Availability freshness within ~2 s of stock changes",
      "Scale: ~5K search QPS average, ~30K at peak",
      "Cheap to operate; easy relevance tuning by merchandisers",
    ],
    estimation: [
      { label: "Index size", calc: "50K master SKUs × ~2 KB doc ≈ 100 MB → the whole catalogue index fits in memory on every search node" },
      { label: "Availability data", calc: "500 stores × 50K-bit bitmap (in-stock flags) = 500 × 6.25 KB ≈ 3 MB → trivial to hold in memory" },
      { label: "Stock updates", calc: "~330 reservation/pick events/s nationally → ~100–300 bitmap bit flips/s" },
      { label: "QPS", calc: "30K QPS peak ÷ ~3K QPS per node (in-memory index) ≈ 10 nodes + replicas" },
    ],
    highLevelDesign: `**Key insight: separate the *static catalogue index* (shared by all stores, small) from the *dynamic per-store availability* (bitmaps), and combine them at query time.** Indexing a document per (store, SKU) would multiply the index by 500 and force re-indexing on every stock change.

**Catalogue index:** Elasticsearch/OpenSearch (or an in-process Lucene/Tantivy index) with one document per master SKU: name, brand, category, synonyms, **transliteration variants** (doodh → milk, "dahi" → curd), unit size, and static popularity. Analyzers include edge n-grams for prefix matching, phonetic filters, and fuzzy matching (edit distance 1–2 with a prefix length of 1 to avoid garbage). The index is small, so it's replicated fully on every node (no scatter-gather).

**Availability:** a per-store **bitmap of sellable SKU ordinals** is maintained by an availability service from the inventory event stream and pushed to all search nodes (pub/sub, compact updates of SKU ordinal + state), held in memory. With OpenSearch, implement it as a custom filter plugin or a terms filter from a cached bitmap. With an in-process index, it's a direct bitmap AND.

**Query flow:**
1. Normalise the query (lowercase, transliterate, spell-correct via a dictionary built from the catalogue and query logs: "amul btr" → "amul butter").
2. Retrieve the top ~500 candidates by text relevance (BM25 + field boosts: brand and name > category > description).
3. **Filter by the store bitmap** (hide OOS, or demote to the end, per product decision).
4. **Re-rank** with a learning-to-rank model (LightGBM) using store-level popularity (SKU sales in this store in the last 7 days), personal purchase history (for repeat grocery buyers), price and promotions, and pack-size preference. Returning the top 30.
5. Hydrate the price and offers from a per-store price cache.

**Autocomplete:** a prefix-completion index from popular queries per city, filtered by store availability for product suggestions.`,
    diagram: `Query ─► Normalise (transliterate, spell-correct, synonyms)
               │
               ▼
   Catalogue index (all master SKUs, fully replicated per node)
               │ top ~500 by BM25 + boosts
               ▼
   AND with store bitmap (sellable SKUs for serving store) ◄── Availability svc
               │                                              ▲ inventory events
               ▼                                              │ (bitmaps
   LTR re-rank (store popularity, personal history, promos)   pushed to nodes)
               │
               ▼
   Hydrate price/offers (per-store cache) ─► top 30 results`,
    deepDives: [
      {
        topic: "Why not index per store",
        discussion: `A document per (store, SKU) means 500 × 6,000 = 30 lakh documents. That's not huge, but every stock change becomes an index update (hundreds per second), and near-real-time refresh intervals (1 s) plus segment merges add load and staleness. With the split approach, the text index changes only when the catalogue changes (rarely), and availability is a tiny bitmap per store updated in memory in microseconds. Filtering is a bitmap AND on candidate ordinals, which is extremely fast. This also makes relevance tuning global (one index) while ranking features stay store-specific. Mention the alternative (ES with a store_ids array field, updated partially) and why its update rate and refresh semantics are worse here.`,
      },
      {
        topic: "Hinglish, typos and transliteration",
        discussion: `Queries like "doodh", "atta 5kg", "amul btr" or "maggi noodels" are common. Build a **synonym and transliteration dictionary** (Hindi/regional names to catalogue terms: doodh → milk, aloo → potato, dhaniya → coriander) from merchandiser input plus mined query logs (queries followed by a click or purchase on product X teach a mapping). Use fuzzy matching with edit-distance limits by term length, phonetic encodings for vernacular spellings, and unit parsing (5kg, 500 ml) as structured filters. Spell correction compares against a dictionary of catalogue tokens and popular queries, with confidence thresholds before auto-correcting (show "showing results for …"). Offline evaluation uses null-result and reformulation rates as quality signals.`,
      },
      {
        topic: "Ranking for conversion in quick commerce",
        discussion: `Grocery search is repeat-heavy: users buy the same brand of milk weekly. Strong features include **personal purchase history** (boost previously bought SKUs), **store-level popularity** (what sells in this neighbourhood), pack-size preference, price and discount, and margin or sponsored boosts, within guardrails. Train LTR on click and add-to-cart logs with position-bias correction. Out-of-stock handling is a product call. Hiding OOS avoids frustration, while showing it greyed with "notify me" preserves intent signals. Either way, a substitute suggestion (same category, in stock) helps conversion. Latency stays low because everything except the price hydration is in memory on the search node. Measure it per store, since assortment and popularity differ a lot between neighbourhoods, so a globally tuned ranker can underperform locally.`,
      },
    ],
    tradeoffs: [
      "Split static index + dynamic bitmaps gives fresh availability cheaply but needs custom filtering integration",
      "Full replication of a small index avoids scatter-gather but requires memory per node (fine at ~100 MB)",
      "Aggressive fuzzy matching improves recall for typos but hurts precision; tune per term length",
      "Hiding out-of-stock items simplifies the UX but loses demand signals; demoting keeps them",
    ],
    followUps: [
      { q: "How do you keep the search nodes' bitmaps consistent after a node restart?", a: "Bootstrap by snapshotting all store bitmaps from the availability service, then apply the event stream from the snapshot's offset. The versions are checked per store." },
      { q: "How would you add sponsored products?", a: "Insert sponsored results at fixed slots with relevance thresholds (only relevant, in-stock sponsored SKUs), with auction or priority per keyword, and label them clearly." },
      { q: "How do you evaluate a relevance change?", a: "Offline NDCG on judged queries, then an online A/B test on search conversion (add-to-cart per search) and null-result rate." },
    ],
    relatedTopics: ["search-systems", "design-advanced", "cache-fundamentals", "data-pipelines", "prod-performance", "design-geo"],
  },
  // ---------------------------------------------------------------- Goldman Sachs
  {
    id: "co-goldman-sachs-1",
    company: "goldman-sachs",
    title: "Design real-time risk and position aggregation across trading desks",
    frequency: "high",
    level: "Associate / VP",
    prompt:
      "Design a system that aggregates positions and risk metrics (P&L, exposure by counterparty, sector and currency, sensitivities) across all trading desks in real time as trades and market prices change, with an auditable end-of-day snapshot.",
    clarifyingQuestions: [
      "What volume: trades per day, number of positions and instruments? How often do market data ticks affect valuations?",
      "Which metrics: position quantity, market value, P&L, Greeks/sensitivities, VaR (intraday approximate vs end-of-day full)?",
      "Hierarchies: trader → book → desk → division → firm; counterparty and legal-entity rollups?",
      "Latency targets: position updates in under 1 s; risk refresh every few seconds?",
      "Corrections: trade amendments and cancellations, late bookings, back-dated trades?",
    ],
    functional: [
      "Ingest trades (new, amend, cancel) from multiple booking systems and market data for pricing",
      "Maintain positions per (book, instrument) and aggregate up hierarchies",
      "Compute real-time P&L and exposures; limit checks with alerts",
      "End-of-day snapshot for regulatory reporting; the ability to recompute any point in time",
    ],
    nonFunctional: [
      "Correctness and auditability: every number traceable to its trades and prices",
      "Low latency (seconds) for intraday risk; high availability during market hours",
      "Deterministic recomputation (the same inputs give the same outputs)",
      "Scale to millions of positions and tens of thousands of ticks per second",
    ],
    estimation: [
      { label: "Trades", calc: "~5 million trade events/day (incl. amends) ≈ 200/s over trading hours, bursts ~5K/s" },
      { label: "Positions", calc: "~5 million (book, instrument) positions across desks" },
      { label: "Market data", calc: "~50K instruments with active pricing × multiple ticks/s → ~100K–500K price updates/s (conflated to ~1/s per instrument for risk)" },
      { label: "Revaluation", calc: "Conflated 50K instrument updates/s × average 100 positions per instrument = 5M position revaluations/s → incremental delta aggregation is essential" },
    ],
    highLevelDesign: `**Event-sourced inputs:** all trade events (with a trade id, version, book, instrument, quantity, price, and the timestamps: trade time and booking time) are published to **Kafka**, partitioned by book, from the booking systems through a normaliser that maps the various formats to a canonical trade model. Market data goes through a **price service** that conflates ticks to at most N updates per second per instrument, and publishes **price snapshots with versions**.

**Position engine:** a stateful stream processor (Flink/Kafka Streams or an in-house grid) keyed by (book, instrument). It applies trade events idempotently by (trade id, version): an amendment replaces the previous version's contribution (subtract old, add new), and a cancellation subtracts. The output is the position quantity and cost basis.

**Valuation and risk engine:** for each position, value = f(quantity, price and curves) using pricing libraries (a simple mark for equities, models for derivatives). Sensitivities come from risk calculators on a compute grid, with the heavy calculations batched every few seconds. The **incremental aggregation** keeps each position's current contribution, and when a price or position changes it emits a **delta** (new − old contribution) up the hierarchy.

**Aggregation tree:** deltas flow into aggregators by rollup dimension (desk, division, counterparty, currency, sector). Each aggregator maintains sums (for additive metrics) and serves queries. Non-additive metrics (VaR) are computed separately: intraday approximations using sensitivities, and full historical-simulation VaR at end of day on the grid.

**Serving:** a low-latency store (in-memory data grid like Hazelcast/Coherence, or Redis) holds the current aggregates, with WebSocket push to trader dashboards. Limit checks run on aggregate updates and raise alerts.

**Audit and EOD:** all inputs (trades and price snapshots) are retained immutably. The EOD snapshot runs at a cut-off (inputs as of a timestamp) through the deterministic engine, and the results are stored for reports. Any past day can be recomputed from the inputs plus library versions.`,
    diagram: `Booking systems ─► Normaliser ─► Kafka trades (by book, versioned)
Market data ─► Price service (conflate, versioned snapshots) ─► Kafka prices
                                │                         │
                                ▼                         ▼
               Position engine (book×instrument, idempotent amends/cancels)
                                │
                                ▼
               Valuation/risk (pricing libs, compute grid for Greeks)
                                │ contribution deltas
                                ▼
        Aggregators: desk / division / counterparty / currency / sector
                                │                        │
                                ▼                        ▼
             In-memory grid + WebSocket dashboards   Limit checks → alerts
Immutable inputs (trades + prices) ─► EOD deterministic recompute ─► reports`,
    deepDives: [
      {
        topic: "Incremental aggregation with deltas",
        discussion: `Recomputing the firm-wide totals from 5M positions on every tick is impossible at sub-second latency. Instead, each position node remembers its last emitted contribution for each metric. When its quantity or price changes, it computes the new contribution and emits **delta = new − old** to its parent aggregators. Aggregators just add deltas, which is O(1) per update, and a change propagates up the tree in milliseconds. This works for **additive** metrics (market value, P&L, notional exposure, and first-order sensitivities by bucket). For non-additive metrics (VaR, expected shortfall), use approximations intraday (sensitivity-based) and full recomputation at EOD. Periodic full re-aggregation (every few minutes) checks for drift from lost or duplicated deltas.`,
      },
      {
        topic: "Amendments, cancellations and determinism",
        discussion: `Trades get amended (quantity or price corrected) and cancelled, sometimes hours later, and booking systems can resend events. Every trade event carries (trade id, version). The position engine stores the latest applied version per trade and ignores older or duplicate versions. On an amendment it reverses the old version's contribution and applies the new one, and a cancel is reversal only. That makes processing **idempotent** and order-tolerant within a trade. For determinism, valuations reference explicit price snapshot versions and pricing-library versions, so the EOD process with the same inputs reproduces exactly the same numbers. This matters for regulators (audit trails) and for explaining P&L ("P&L explain": attribution to price moves, new trades and amendments).`,
      },
      {
        topic: "Market data conflation and fairness to risk",
        discussion: `Raw market data can reach hundreds of thousands of ticks per second, far more than risk needs. The price service **conflates** per instrument: it keeps the latest price and publishes at most every 100 ms–1 s (configurable per asset class). Stale-price detection flags instruments with no updates (a feed outage), so risk shows them as stale rather than silently using old marks. Pricing dependencies (curves, volatility surfaces) are versioned objects updated less frequently, and a curve change triggers revaluation of all dependent positions, a fan-out handled by the compute grid in batches. Priority lanes keep the most important books (large exposures) refreshed first under load.`,
      },
    ],
    tradeoffs: [
      "Incremental deltas give low latency but risk drift; periodic full re-aggregation corrects it",
      "Conflating prices cuts compute massively but loses intra-second price paths (irrelevant for risk, relevant for trading)",
      "Intraday approximate VaR is fast but inexact; EOD full VaR is exact but slow",
      "Event sourcing inputs gives full auditability and recomputation, at the cost of storage and replay tooling",
      "An in-memory data grid is fast but needs careful HA (replicated partitions) during market hours",
    ],
    followUps: [
      { q: "A booking system replays yesterday's trades by mistake. What protects the positions?", a: "Idempotency by (trade id, version): already-applied versions are ignored. Monitoring on unusual event volumes per source raises alerts." },
      { q: "How do you produce a point-in-time report for 3 PM yesterday?", a: "Replay the immutable trade events with booking time ≤ 3 PM and the price snapshots as of 3 PM through the same deterministic engine version." },
      { q: "How do you enforce trading limits in real time?", a: "Limit definitions per book, desk or counterparty are checked on each aggregate update. A breach raises alerts and can feed pre-trade checks in the order management system." },
    ],
    relatedTopics: ["data-pipelines", "mq-scenarios", "design-advanced", "ds-consistency", "prod-correctness-ops", "observability"],
  },
  {
    id: "co-goldman-sachs-2",
    company: "goldman-sachs",
    title: "Design an internal market data distribution platform (ticker plant)",
    frequency: "medium",
    level: "Associate / VP",
    prompt:
      "Design the platform that consumes market data feeds from multiple exchanges and vendors, normalises them, and distributes real-time quotes and trades to thousands of internal consumers (trading algos, risk, UIs) with low latency and per-consumer entitlements.",
    clarifyingQuestions: [
      "Which consumers need the lowest latency (algorithmic trading: microseconds) vs UIs (hundreds of ms)?",
      "Feeds: direct exchange feeds (multicast binary) and consolidated vendors (Bloomberg, Refinitiv)?",
      "Data types: L1 quotes, L2 depth, trades, reference data? Historical tick storage?",
      "Entitlements: exchange licensing requires per-user/app permissions and usage reporting?",
      "Failure handling: feed A/B line arbitration, gap recovery, stale detection?",
    ],
    functional: [
      "Ingest multiple feeds with A/B line arbitration and gap recovery",
      "Normalise to a common symbology and message model; maintain order books (L2)",
      "Distribute to subscribers by symbol/topic with conflation options for slow consumers",
      "Entitlement enforcement and usage reporting; tick capture for historical storage",
    ],
    nonFunctional: [
      "Latency: microseconds for co-located algo consumers; milliseconds for others",
      "Throughput: millions of messages per second at market open",
      "No silent data loss: detect gaps and stale data; clear status to consumers",
      "High availability during market hours; deterministic failover",
    ],
    estimation: [
      { label: "Feed rate", calc: "US equities + options at the open: options feeds (OPRA) peak at tens of millions of msgs/s; equities several million msgs/s" },
      { label: "Consumers", calc: "~5,000 subscribing applications; UIs subscribe to ~100 symbols each, algos to thousands" },
      { label: "Fan-out", calc: "A hot symbol with 500 subscribers at 10K updates/s → 5M deliveries/s → multicast or shared-memory fan-out" },
      { label: "Tick capture", calc: "~5 billion messages/day × ~50 B ≈ 250 GB/day compressed → tick store (kdb+/columnar)" },
    ],
    highLevelDesign: `**Tiered design by latency need:**

**Tier 0: ultra-low latency (co-located algos).** Feed handlers run on servers co-located at exchange data centres, receiving **multicast UDP** feeds (A and B lines) with kernel-bypass NICs. They **arbitrate** A/B (take whichever packet arrives first per sequence number), detect gaps via sequence numbers, and recover from exchange retransmission or snapshot services. Normalised messages are delivered to co-located strategy processes via **shared memory ring buffers** on the same host, or a low-latency multicast bus. It's microsecond-level, with no brokers in the path.

**Tier 1: firm-wide distribution.** Normalised data (a common symbology mapping exchange tickers to internal instrument ids, and a common message schema) is published on a **pub/sub middleware** built for market data (Solace, 29West/Informatica Ultra Messaging, or Aeron) with topics by asset class, venue and symbol. Consumers subscribe to the symbols they need. The middleware uses multicast within data centres to avoid per-subscriber copies.

**Conflation for slow consumers:** UIs and risk systems don't need every tick. A **conflation service** keeps the latest value per symbol and sends updates at most every N ms (per subscription), so a slow consumer never builds an unbounded queue. Critical consumers get full-rate streams with **slow-consumer detection** (they're disconnected or switched to conflated mode rather than backing up publishers).

**Order books:** book builders per venue maintain L2/L3 depth from incremental messages, publish derived L1/L2, and also serve snapshot requests (late joiners get a snapshot, then deltas with sequence alignment).

**Entitlements:** every subscription is checked against an entitlement service (a user or application × exchange × data type, per licensing). Usage is logged for exchange reporting, and non-display (algo) vs display (UI) usage is tracked separately because of different fees.

**Tick capture:** a capture process records all normalised messages with timestamps (PTP-synced clocks) into a tick database (kdb+ or columnar files) for research, compliance and replay.`,
    diagram: `Exchange feeds (multicast A/B) ─► Feed handlers (co-lo, kernel bypass)
                                    │ arbitrate A/B, gap detect/recover
                                    │ normalise (symbology, schema)
           ┌────────────────────────┼─────────────────────────────┐
           ▼                        ▼                             ▼
 Shared-memory rings        Book builders (L2/L3)          Tick capture
 → co-located algos (µs)    snapshots + deltas             (kdb+/columnar, PTP)
                                    │
                                    ▼
                 Pub/Sub middleware (multicast in DC; topics by symbol)
                  │                     │
                  ▼                     ▼
        Full-rate consumers     Conflation service ─► UIs, risk (N ms updates)
        (slow-consumer detect)
Entitlement service ─ checks every subscription; usage reporting to exchanges`,
    deepDives: [
      {
        topic: "A/B line arbitration and gap recovery",
        discussion: `Exchanges publish identical packets on two multicast lines (A and B) over separate network paths. The feed handler tracks the next expected sequence number per channel, takes the first copy of each packet from either line, and discards the duplicate. That masks a single line's packet loss with no latency penalty. If a sequence is missing on both lines, it's a **gap**: request retransmission (TCP retransmit service, rate-limited) or, for large gaps, recover via a snapshot channel, rebuild the book, and mark affected symbols as **stale** until recovery. Downstream consumers see explicit status flags (OK, stale, recovering) rather than silently wrong books. Monitoring counts gaps per line, and a line with persistent loss triggers network investigation.`,
      },
      {
        topic: "Slow consumers and conflation",
        discussion: `In pub/sub fan-out, one slow subscriber can create unbounded queues or (with reliable multicast) slow the publisher for everyone, which is the classic market data failure. Policy per consumer class: latency-critical consumers must keep up and are monitored for lag, and if they fall behind they're disconnected or dropped to conflated mode. Everyone else gets **conflated** streams: the conflation service holds only the latest state per symbol (for L1, a map of symbol → latest quote) and sends at a fixed cadence or on change after a minimum interval. That bounds memory and bandwidth regardless of the input rate. For order books, conflation sends snapshots of the current top-N levels rather than every delta.`,
      },
      {
        topic: "Latency engineering",
        discussion: `For the co-located tier, every microsecond matters: kernel-bypass networking (Solarflare/OpenOnload, DPDK) avoids syscalls, busy-polling threads are pinned to isolated cores, NUMA-aware memory is used, there's no allocation on the hot path (pre-allocated buffers), and parsing is binary with zero-copy. Normalisation adds minimal work (fixed-width structures). Timestamping uses hardware NIC timestamps with PTP-synchronised clocks, so latency can be measured precisely at each hop (feed receive, normalise, publish, consumer receive). That's also a compliance requirement (MiFID II clock sync). The measure is the latency distribution (p50, p99, p99.9), and tails are hunted with continuous monitoring, because algos care about worst cases during bursts at the open.`,
      },
    ],
    tradeoffs: [
      "Direct feeds give the lowest latency and full depth but are expensive and need a handler per venue; consolidated vendor feeds are simpler but slower",
      "Multicast gives efficient fan-out but is harder to operate (network config, no per-subscriber reliability) than broker-based TCP",
      "Conflation protects consumers and the platform but drops intermediate ticks",
      "Strict entitlement checks on every subscription add latency at subscribe time only, not per message",
      "Co-location cuts latency at high infrastructure cost; reserve it for the strategies that need it",
    ],
    followUps: [
      { q: "How does a consumer that joins mid-day get a consistent order book?", a: "Request a snapshot tagged with a sequence number, buffer live deltas received meanwhile, and apply the deltas with sequence numbers after the snapshot's sequence. Then it's in sync." },
      { q: "A feed handler server dies at 9:31 AM. What happens?", a: "A hot standby handler, already consuming the same multicast and building state, takes over publishing (a deterministic takeover via sequence alignment). Consumers see continuity, or a brief stale flag." },
      { q: "How do you report exchange usage for billing?", a: "The entitlement service logs subscriptions per user or app per exchange and data type. Monthly reports are generated to exchanges, distinguishing display and non-display use." },
    ],
    relatedTopics: ["design-advanced", "net-protocols", "mq-fundamentals", "prod-performance", "net-realtime", "observability"],
  },
];
