import type { Topic } from '../../types';

const topic: Topic = {
  id: 'prod-dissections',
  phase: 'production',
  order: 5,
  title: 'Real-World Dissections: Famous Architectures & Outages, Explained',
  subtitle:
    'Twelve primary-source case studies (GitHub, Discord, Uber, Hotstar, Slack, Cloudflare, AWS, Meta, Figma, Notion), each told as context, timeline, root cause, what changed, lessons, and how to cite it in an interview',
  estimatedMinutes: 150,
  sources: [
    'GitHub — October 21 post-incident analysis (github.blog, 30 Oct 2018)',
    'GitHub — gh-ost: GitHub\'s online schema migration tool for MySQL (github.blog, Aug 2016)',
    'Discord — How Discord Stores Trillions of Messages (discord.com/blog, 2023)',
    'Uber Engineering — Why Uber Engineering Switched from Postgres to MySQL (Evan Klitzke, July 2016)',
    'Markus Winand — On Uber\'s Choice of Databases (use-the-index-luke.com, July 2016)',
    'PostgreSQL documentation — Heap-Only Tuples (HOT), hot_standby_feedback, logical replication (PG 10+)',
    'AWS re:Invent 2019 CMY302 — Scaling Hotstar.com for 25 million concurrent viewers (talk; summary by Classmethod)',
    'Slack Engineering — Slack\'s Outage on January 4th 2021 (slack.engineering)',
    'Cloudflare — Details of the Cloudflare outage on July 2, 2019 (blog.cloudflare.com)',
    'Cloudflare — Cloudflare outage on November 18, 2025 (blog.cloudflare.com)',
    'AWS — Summary of the Amazon DynamoDB Service Disruption in the Northern Virginia (US-EAST-1) Region (aws.amazon.com/message/101925, Oct 2025)',
    'Meta Engineering — More details about the October 4 outage (engineering.fb.com, 5 Oct 2021)',
    'Cloudflare — Understanding how Facebook disappeared from the Internet (blog.cloudflare.com, Oct 2021)',
    'Figma — How Figma\'s databases team lived to tell the scale (figma.com/blog, March 2024)',
    'Notion — Herding elephants: lessons learned from sharding Postgres at Notion (notion.com/blog, Oct 2021)',
    'Arpit Bhayani — engineering-blog and outage dissections (arpitbhayani.me, YouTube) — used as a reading list; every fact here is checked against the original post',
  ],
  tags: ['case-study', 'postmortem', 'outage', 'mysql-failover', 'schema-migration', 'cassandra', 'scylladb', 'postgres', 'sharding', 'regex', 'dns', 'bgp', 'config-push', 'pre-scaling', 'war-room'],
  cheatSheet: [
    'GitHub 2018: a 43 s partition made Orchestrator promote West Coast primaries; a few seconds of unreplicated East writes plus ~40 min of West writes meant no clean failback → restore from backups → 24 h 11 min degraded. Lesson: block cross-region automatic promotion; integrity over availability.',
    'gh-ost: trigger-based online ALTERs (pt-osc) locked production and could not truly pause; gh-ost tails the binlog, copies rows into a ghost table, throttles on lag/load, and lets you postpone the cut-over.',
    'Discord: Cassandra grew 12 → 177 nodes with hot partitions and GC pauses; ScyllaDB on 72 nodes plus Rust data services (request coalescing + consistent-hash routing by channel_id). p99 reads 40–125 ms → 15 ms; inserts 5–70 ms → 5 ms.',
    'Uber 2016: Postgres indexes point at physical tuple locations (ctid), so a moved row touches every index and the physical WAL grows; InnoDB secondaries store the PK. Counter: HOT + fillfactor, hot_standby_feedback, logical replication in PG 10, and the extra B-tree hop on every InnoDB secondary lookup.',
    'Hotstar (re:Invent 2019): 25.3 M concurrent viewers; traffic grew 1 M+/min against a ~90 s reaction time, so pre-warm before the match, scale on ladders, and use panic mode (switch off recommendations and personalisation, protect playback and payments).',
    'Slack 4 Jan 2021: first Monday after holidays + cold client caches → an AWS Transit Gateway did not scale fast enough → packet loss made CPU-based autoscaling scale down, then 1,200 instances at once, then provision-service hit the open-files limit and a quota.',
    'Cloudflare 2019: one WAF rule containing .*(?:.*=.*) backtracked catastrophically, CPUs hit ~100% worldwide for 27 min. Global push without staging plus a removed CPU guard. Fixes: re2/Rust regex engines, staged rollouts, rule profiling.',
    'Cloudflare Nov 2025: a ClickHouse permission change duplicated metadata rows, doubling a generated Bot Management file past a hard 200-feature limit; FL2 called unwrap() and returned 5xx. Treat internally generated config like untrusted user input and keep a last-known-good file.',
    'AWS Oct 2025: a delayed DNS Enactor applied a stale plan after a newer one; cleanup then deleted it, emptying dynamodb.us-east-1. EC2 DWFM then fell into congestive collapse and NLB health checks flapped. Lessons: compare-and-set on generations, velocity limits on automated removal, and queue-aware throttling during recovery.',
    'Meta 2021: an audit-tool bug let a capacity command cut the whole backbone; DNS servers withdrew their own BGP routes when they lost the data centers. ~5.5 h dark (per Cloudflare). Figma: views-based logical sharding before physical splits; Notion: 480 logical shards on 32 Postgres DBs keyed by workspace ID.',
  ],
  sections: [
    {
      heading: '1. GitHub, 21 Oct 2018 — 43 seconds of partition, 24 hours of degradation',
      body: `**Intuition:** an automatic failover tool did exactly what it was configured to do, and that was the problem. A 43-second network blip led to a choice between losing data and losing a day, and GitHub chose to lose the day.

**Context & scale.** GitHub ran MySQL clusters with primaries in a US East Coast data center, replicas in the US West Coast and in a public-cloud East region, and **Orchestrator** (Raft-based) managing topology and automatic failover.

**What broke (UTC):**
- **22:52** — routine maintenance to replace failing 100G optical equipment cut the link between the East Coast network hub and the primary East Coast data center. Connectivity came back in **43 seconds**.
- In that window the Orchestrator nodes in the West Coast and public-cloud East formed a Raft quorum and **promoted West Coast primaries**. GitHub's write-up says Orchestrator "behaved as configured".
- The East Coast primaries had accepted **a few seconds of writes** that never replicated west (954 writes on one of the busiest clusters). Then the West Coast took writes for **nearly 40 minutes**.
- East Coast application servers could not cope with a cross-country round trip on most database calls, so the site degraded.
- **23:13** status red; **23:19** webhooks and Pages builds paused. **00:05** recovery from backups begins (backups every 4 hours, stored in remote public-cloud blob storage, multiple TB, so restores took hours). **11:12** all primaries back East. **23:03 on 22 Oct** status green. **Total: 24 h 11 min.**
- Backlog: over **5 million** webhook events and **80,000** Pages builds queued; about **200,000** webhook payloads outlived an internal TTL and were dropped.

**Root cause / key decision.** Both sides now had writes the other lacked, so there was no safe failback. GitHub **failed forward** to protect data integrity rather than discard either side's writes. Binlogs of the unreplicated writes were captured for reconciliation.

**What they changed:** Orchestrator reconfigured to **never promote primaries across regional boundaries**; component-level status reporting; accelerate active/active/active (N+1 at the facility level); fault injection and chaos tooling; a temporary longer webhook TTL.

**Transferable lessons:** a failover detector must distinguish "primary dead" from "I can't see the primary"; cross-region promotion changes your latency model, not just your topology; RTO for "restore from backup" is dominated by download and decompress time, so measure it.

**How to cite it in an interview:** "GitHub 2018 is my go-to example of why automatic cross-region promotion is dangerous: a 43-second partition gave them divergent writes on both coasts and a 24-hour restore. In my design, cross-region failover is a human decision; in-region failover is automatic and fenced."`,
      diagram: `GitHub 21-22 Oct 2018 (UTC)
22:52 ─┬─ optical maintenance: East hub <-X-> East DC (43 s)
       │   Orchestrator quorum (West + cloud-East) promotes WEST primaries
       │   East primaries already hold "a few seconds" of unreplicated writes
22:54 ─┼─ alerts fire
23:13 ─┼─ status RED      (West takes writes for ~40 min: divergence!)
23:19 ─┼─ webhooks + Pages paused
00:05 ─┼─ restore from backups (remote blob storage, multi-TB) begins
11:12 ─┼─ all primaries back in East
16:24 ─┼─ original topology restored, backlog draining
23:03 ─┴─ GREEN  -> 24 h 11 min of degradation

   East DC [primary, +954 writes]      West DC [new primary, +40 min writes]
          \\________ neither is a superset of the other ________/`,
      keyPoints: [
        'Orchestrator did what it was configured to do: the config was the bug.',
        'Divergent writes on both sides make clean failback impossible.',
        'GitHub chose data integrity over availability and restored from backups.',
        'Fix: no automatic cross-region primary promotion.',
      ],
      source: 'GitHub — October 21 post-incident analysis (github.blog, 2018)',
    },
    {
      heading: '2. GitHub gh-ost — why ALTER TABLE on a busy MySQL primary needed a new tool',
      body: `**Intuition:** changing a large table in place is like renovating a kitchen while still cooking in it. gh-ost builds a second kitchen next door, keeps it in sync, and swaps the doors at the end.

**Context & scale.** GitHub ran schema migrations on large, busy MySQL tables all the time. A plain \`ALTER TABLE\` that rebuilds the table holds locks and produces replication lag. So the industry used **trigger-based** online tools such as \`pt-online-schema-change\`.

**What broke with triggers (GitHub's own list):**
- Triggers are interpreted stored routines, so every write to the table pays for them.
- Trigger writes **compete for locks** on the shadow table, which caused "near or complete lock downs in production".
- **Dropping the triggers** at the end on a busy table stalled for many seconds, up to a minute.
- **No true pause**: you can stop the row copy, but the triggers must keep running or you lose data, so on a busy primary "the master is brought down by the load of the triggers".
- Testing on replicas is not representative, because trigger behaviour under statement-based replication differs.

**Key design decision — go triggerless.** gh-ost:
1. Creates a **ghost table** with the new schema.
2. **Copies rows** in chunks.
3. **Tails the binary log** (row-based) to replay ongoing changes into the ghost table. Copy writes and binlog replays are serialised, so the primary sees one connection writing sequentially.
4. **Throttles** on replica lag, \`Threads_running\`, a custom query, a flag file or a socket command. With nothing writing through triggers, throttling can stop the migration's writes to the primary completely.
5. **Cut-over** swaps the tables. You can **postpone** it with a flag file and run it during a quiet window.
6. **Test mode** (\`--test-on-replica\`): swap and swap back on a replica, then checksum both tables. GitHub ran continuous no-op migrations (\`engine=innodb\`) on dedicated replicas to test the tool.

**Transferable lessons:** the most dangerous moment in a migration is the moment you can't pause. Design every long-running operation (backfill, reindex, resharding) to be **throttleable, pausable, observable and testable on a replica**.

**How to cite it in an interview:** "For a 2 TB table change I'd use a binlog-based tool like gh-ost rather than triggers. GitHub moved away from trigger-based tools because triggers lock-compete and can't be paused. I'd throttle on replica lag and postpone cut-over to a low-traffic window."`,
      code: [
        {
          language: 'bash',
          title: 'A gh-ost run with the safety rails GitHub describes',
          code: `# Connect to a replica; gh-ost finds the primary and reads the binlog from the replica
gh-ost \\
  --host=db-replica-07.internal \\
  --database=app --table=orders \\
  --alter="ADD COLUMN fulfilment_sla_ms INT NULL, ADD INDEX idx_created (created_at)" \\
  --chunk-size=1000 \\
  --max-lag-millis=1500 \\
  --max-load=Threads_running=30 \\
  --critical-load=Threads_running=200 \\
  --throttle-control-replicas=db-replica-03.internal,db-replica-05.internal \\
  --throttle-flag-file=/tmp/ghost.throttle \\
  --postpone-cut-over-flag-file=/tmp/ghost.postpone \\
  --serve-socket-file=/tmp/gh-ost.orders.sock \\
  --exact-rowcount --verbose \\
  --execute

# While it runs, change behaviour without restarting:
echo 'throttle' | nc -U /tmp/gh-ost.orders.sock          # stop writes to the primary
echo 'chunk-size=500' | nc -U /tmp/gh-ost.orders.sock    # gentler copy
echo 'no-throttle' | nc -U /tmp/gh-ost.orders.sock
# Row copy done, tables in sync, waiting on the flag file. At 03:00 IST:
rm /tmp/ghost.postpone                                    # triggers the cut-over`,
        },
      ],
      keyPoints: [
        'Trigger-based migrations add write cost, lock contention, and cannot truly pause.',
        'gh-ost: ghost table + row copy + binlog replay, so it controls all of its own writes.',
        'Throttle on lag and load; postpone cut-over; rehearse on a replica with checksums.',
      ],
      source: 'GitHub — gh-ost: GitHub\'s online schema migration tool for MySQL (2016)',
    },
    {
      heading: '3. Discord — trillions of messages: Cassandra → ScyllaDB, with Rust data services',
      body: `**Intuition:** the database wasn't too small; it was being hit unevenly and paused for garbage collection at the worst moments. Discord fixed it at two layers: a database without a JVM, and a thin service in front that collapses identical reads.

**Context & scale.** In 2017 Discord stored billions of messages on **12** Cassandra nodes. By early 2022 it was **177** nodes and **trillions** of messages. Messages are partitioned by channel and a time bucket.

**What hurt:**
- **Hot partitions.** A huge server announces something and thousands of people read one \`(channel_id, bucket)\` at once. With quorum reads and writes, that node's latency rose, and so did latency for *unrelated* queries that shared it.
- **GC pauses** in the JVM caused latency spikes. Some were long enough that an operator had to reboot the node by hand.
- Operating 177 nodes was a toil burden: compactions and repairs had to be babysat.

**What they built:**
1. **Data services in Rust** between the API monolith and the database: roughly one gRPC endpoint per query, no business logic.
2. **Request coalescing:** if many users ask for the same row at once, **one** database query runs and the other requests subscribe to its result.
3. **Consistent-hash routing** on a routing key (the **channel_id** for messages), so all requests for a channel reach the *same* data-service instance. That makes coalescing effective; without it, the duplicates are spread over many instances and never meet.
4. **ScyllaDB** (C++, shard-per-core, no GC) on **72 nodes** with 9 TB of disk each (vs ~4 TB per Cassandra node).

**Migration:** the Spark-based plan was estimated at three months. A Rust migrator built "in an afternoon" cut that to **nine days**, peaking at **3.2 M messages/s**. It stalled at **99.9999%** because the last token ranges held uncompacted tombstones; compacting them finished the job. Cut-over in **May 2022**.

**Results (p99):** historical reads **40–125 ms → 15 ms**; inserts **5–70 ms → steady 5 ms**. During the 2022 World Cup final the send-rate graph spiked with each goal, and the database didn't strain.

**Transferable lessons:** fix hot keys **above** the database when you can (coalesce + route by key); choose a storage engine for its tail latency, not its average; and a migration tool is a product, so making it fast changes what is possible.

**How to cite it in an interview:** "For a hot-read pattern I'd put a coalescing layer in front of storage and route by the hot key, as Discord did with channel_id, so N identical concurrent reads become one."`,
      code: [
        {
          language: 'typescript',
          title: 'Request coalescing (singleflight) in a NestJS data service',
          code: `import { Injectable } from '@nestjs/common';

type Msg = { id: string; channelId: string; body: string };

@Injectable()
export class MessagesDataService {
  // key -> in-flight promise; every concurrent caller awaits the same one
  private readonly inflight = new Map<string, Promise<Msg[]>>();

  constructor(private readonly db: { fetch(channelId: string, bucket: number): Promise<Msg[]> }) {}

  fetchBucket(channelId: string, bucket: number): Promise<Msg[]> {
    const key = channelId + ':' + bucket;
    const existing = this.inflight.get(key);
    if (existing) return existing; // coalesced: no extra DB query

    const p = this.db
      .fetch(channelId, bucket)
      .finally(() => this.inflight.delete(key)); // drop on success AND failure
    this.inflight.set(key, p);
    return p;
  }
}

// Coalescing only works if duplicates reach the SAME instance. The gateway
// must route by channelId (consistent hash ring), not round-robin:
//   instance = ring.lookup(hash(channelId))
// Round-robin over 40 pods would turn 1 hot read into up to 40 DB queries.`,
        },
      ],
      keyPoints: [
        'Cassandra 12 → 177 nodes; ScyllaDB 72 nodes.',
        'Hot partitions + quorum reads hurt neighbours; JVM GC pauses hurt the tail.',
        'Coalescing needs key-affinity routing to work.',
        'Migration: 9 days, up to 3.2 M msg/s, stuck at 99.9999% on tombstones.',
      ],
      source: 'Discord — How Discord Stores Trillions of Messages',
    },
    {
      heading: '4. Uber, 2016 — "Why we switched from Postgres to MySQL", and the counter-arguments',
      body: `**Intuition:** Uber's argument boils down to how indexes point at rows. Postgres indexes store a row's physical address, while InnoDB secondary indexes store its primary key. Which one wins depends on whether you update rows or read through secondary indexes more often.

**Context.** Uber's write-up (Evan Klitzke, July 2016) was based mainly on **Postgres 9.2**, and it accompanied a move to **Schemaless**, a sharding layer Uber built on MySQL.

**Uber's five complaints:**
| Complaint | Mechanism Uber described |
|---|---|
| Write amplification | Every index points at the tuple's on-disk location (ctid). An update writes a new tuple version, so every index may need a new entry. Uber counted **at least four** physical writes for a one-column change, before WAL. |
| Inefficient replication | Physical WAL streaming ships those low-level changes across data centres. The MySQL row binlog is "significantly more compact". |
| Table corruption | A 9.2 bug misapplied WAL during timeline switches, leaving dead row versions visible. With physical replication, corruption can travel. |
| Replica MVCC | WAL replay can't apply changes that conflict with open queries on a replica, so long queries cause lag or get cancelled. |
| Upgrades | Physical replication can't cross major versions, so Uber was stuck on 9.2 because upgrading took too many hours. |
Uber also mentioned Postgres's process-per-connection model (it relied on pgbouncer) against MySQL's threads, saying some MySQL instances ran close to **10,000** concurrent connections.

**Counter-arguments a senior engineer should know:**
- **HOT updates + fillfactor.** If an update changes no indexed column and the new version fits on the same page, Postgres does a heap-only-tuple update with **no index writes**. A lower \`fillfactor\` leaves room for that. Winand agreed it would not save Uber's workload, though, because their hot updates touched indexed columns.
- **Replica conflicts are tunable:** \`hot_standby_feedback\` stops the primary from vacuuming row versions a replica still needs, and \`max_standby_streaming_delay\` sets how long replay waits.
- **InnoDB's hidden cost:** every secondary-index lookup is two B-tree traversals (secondary index → PK → row). Uber called it a "slight disadvantage". Winand called it a big one for read-heavy secondary-index workloads.
- **Time moved on:** Postgres 10 (2017) added built-in **logical replication**, which also enables cross-version upgrades.

**Transferable lesson:** database choice follows from your **access pattern**. Uber's workload was update-heavy with many indexes, at the time, on 9.2. Name the mechanism, not the brand.

**How to cite it in an interview:** "I'd frame Postgres vs MySQL the way Uber's debate did: physical tuple pointers vs PK-indexed secondaries. If updates hit indexed columns at high rate, InnoDB's model helps. If reads use secondaries heavily, Postgres's direct pointers help, and HOT reduces the update cost when indexed columns are untouched."`,
      code: [
        {
          language: 'sql',
          title: 'Measuring the "Uber problem" on your own Postgres',
          code: `-- What share of updates were HOT (no index writes)?
SELECT relname,
       n_tup_upd,
       n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / NULLIF(n_tup_upd, 0), 1) AS hot_pct
FROM pg_stat_user_tables
ORDER BY n_tup_upd DESC
LIMIT 10;

-- Leave 20% free space per page so updated versions can stay on-page (HOT-eligible)
ALTER TABLE trips SET (fillfactor = 80);
-- Applies to new pages; rewrite existing ones in a maintenance window if needed.

-- An index on a frequently-updated column defeats HOT for every update of it:
-- e.g. INDEX ON trips(status) + "UPDATE trips SET status = ..." 1,000x/s.
-- Ask: does status really need its own index, or a partial index?
CREATE INDEX CONCURRENTLY trips_active_idx ON trips (driver_id)
  WHERE status IN ('requested', 'en_route');

-- On replicas: trade primary bloat for fewer cancelled analytics queries
-- postgresql.conf (replica):
--   hot_standby_feedback = on
--   max_standby_streaming_delay = 30s`,
        },
      ],
      keyPoints: [
        'Postgres indexes → ctid; InnoDB secondaries → PK.',
        'HOT avoids index writes only when no indexed column changes and the tuple fits on the page.',
        'InnoDB pays a second B-tree hop on every secondary lookup.',
        'Postgres 10 logical replication removed part of the upgrade argument.',
      ],
      source: 'Uber Engineering (2016); Markus Winand — On Uber\'s Choice of Databases; PostgreSQL docs',
    },
    {
      heading: '5. Hotstar — 25 million concurrent viewers: pre-warm, ladders and panic mode',
      body: `**Intuition:** at cricket scale, reactive autoscaling arrives after the wave has already broken. You scale **before** the toss, and you decide **in advance** what to switch off when the wave is bigger than planned.

**Context & scale (AWS re:Invent 2019, CMY302).** Hotstar hit **25.3 M concurrent viewers on 10 July 2019**, beating its own record of **18.6 M**. The talk quotes **1 M+ requests/s** at peak, **10 Tbps+** of bandwidth, and reports Hotstar's peak traffic as **70–75% of India's internet bandwidth**.

**What's hard — the race against time:**
- Concurrency can grow by **1 M+ users per minute** (a big wicket, a finish, a push notification).
- The talk cites roughly **90 seconds** of reaction time and about **a minute** of application boot time. A metric-driven scale-up has to detect, decide, launch and warm instances inside that, which is too tight.
- Plain autoscaling hit practical problems: **insufficient-capacity errors**, **one instance type per ASG**, step sizes, retries with exponential backoff, and AZ balancing.

**What they built / decided:**
1. **Pre-warm infrastructure before match time** to a level set by the forecast, rather than trusting reactive scaling.
2. **Scale in ladders** tied to concurrency (secondary write-ups describe pre-defined ladders per million concurrent users; the exact ladder values are not public).
3. **Panic mode:** in a live game there is no time for a 15–20 minute fix, so non-critical features (**recommendations, personalisation**) are switched off to protect **video playback and payments**.
4. **Project HULK** load and chaos testing across **8 regions**, quoted at **108,000 CPUs** and **200 Gbps** of outbound traffic, plus chaos tests for tsunami traffic, push notifications, delayed scale-up, added latency, limited bandwidth and CDN failures.

**Transferable lessons:** for **scheduled** peaks (IPL, Big Billion Days, a Tatkal booking window), capacity is a **calendar** problem, not a metrics problem. Write the degradation order **before** the event, rank features by revenue and user impact, and rehearse turning them off.

**How to cite it in an interview:** "For an IPL-style spike I'd follow Hotstar: pre-warm to the forecast before the match, because 1 M users a minute outruns a 90-second reaction window. I'd keep panic-mode flags that shed recommendations and personalisation first and never touch playback or payments."`,
      code: [
        {
          language: 'typescript',
          title: 'Ladder-based pre-scaling plus panic-mode flags (illustrative)',
          code: `// Capacity is driven by FORECAST concurrency before the match, then by live
// concurrency with a floor that never drops below the pre-warmed rung.
type Rung = { concurrentUsers: number; playbackPods: number; apiPods: number };

const LADDER: Rung[] = [
  { concurrentUsers: 5_000_000, playbackPods: 400, apiPods: 250 },
  { concurrentUsers: 10_000_000, playbackPods: 800, apiPods: 480 },
  { concurrentUsers: 20_000_000, playbackPods: 1600, apiPods: 950 },
  { concurrentUsers: 30_000_000, playbackPods: 2400, apiPods: 1400 },
];

export function targetRung(forecast: number, live: number, headroom = 1.3): Rung {
  // Plan for max(forecast, live) * headroom; scale-up must lead the wave, not chase it
  const need = Math.max(forecast, live) * headroom;
  return LADDER.find((r) => r.concurrentUsers >= need) ?? LADDER[LADDER.length - 1];
}

// Panic mode: an ordered list of features to shed. Decided BEFORE the match.
const SHED_ORDER = ['recommendations', 'personalisedTray', 'watchParty', 'highResThumbnails'] as const;
const NEVER_SHED = new Set(['playback', 'auth', 'payments']);

export function featuresToDisable(saturation: number): string[] {
  // saturation = worst of (CPU, p99/SLO, error rate / budget), normalised to 0..1+
  if (saturation < 0.8) return [];
  const steps = Math.min(SHED_ORDER.length, Math.ceil((saturation - 0.8) / 0.05));
  return SHED_ORDER.slice(0, steps).filter((f) => !NEVER_SHED.has(f));
}`,
        },
      ],
      keyPoints: [
        '25.3 M concurrent (10 Jul 2019), previous record 18.6 M.',
        '1 M+/min growth vs ~90 s reaction time → pre-warm, don\'t react.',
        'Panic mode: shed recommendations/personalisation; protect playback and payments.',
      ],
      source: 'AWS re:Invent 2019 CMY302 (Hotstar) — via Classmethod session summary',
    },
    {
      heading: '6. Slack, 4 Jan 2021 — the first Monday back, cold caches and a Transit Gateway',
      body: `**Intuition:** the quietest fortnight of the year was followed by one of its biggest mornings, and every client came back with an empty cache. The bottleneck was a managed AWS network component Slack couldn't see or scale. Slack's own autoscaling then made it worse.

**Context.** Slack's web tier sat behind AWS **Transit Gateways (TGWs)**. It autoscaled on **CPU** and **Apache worker-thread utilisation**. A **provision-service** configured new instances.

**What broke (PST):**
- Morning (Americas): an external monitor paged on rising errors. Then **dashboards and alerting became unavailable**, because they depended on the same network path. Rolling back the day's changes did nothing.
- **6:57** — message success at **99%** against a normal **> 99.999%**.
- **7:00–7:15** — the hourly peak plus packet loss saturated the web tier. **Autoscaling tried to add 1,200 servers** between 7:01 and 7:15.
- Before that, packet loss had made threads *wait*, so **CPU fell** and the autoscaler **scaled down**, deprovisioning instances and dropping engineers' SSH sessions. Then thread utilisation spiked and it scaled **up** hard.
- **Provision-service** collapsed under that burst: it hit the **Linux open-files limit** (the most significant bottleneck) and an **AWS quota**. It was healthy again around **8:15**.
- **9:15** — enough healthy hosts; Slack degraded rather than down. Load-balancer **panic mode**, retries and circuit breaking helped.
- **10:40** — AWS's manual TGW capacity increase reached every AZ, and the network returned to normal.

**Root cause.** Slack's systems scaled, but **one TGW didn't scale fast enough** for the packet-rate jump. AWS saw the drops in its own monitoring and increased capacity by hand.

**What changed:** AWS reviewing TGW scaling for large packets-per-second jumps; Slack to **request pre-emptive TGW upscaling** before the next holidays; dashboards and alerting moved into the **same VPC as their databases** (off the TGW path); regular **load tests of provision-service**; autoscaling and health-check settings re-evaluated.

**Transferable lessons:**
1. **Cold caches multiply load.** "First request after a long idle" is a capacity event, so plan it like a launch.
2. **CPU is a bad scaling signal when the bottleneck is I/O wait.** It points the wrong way.
3. Your **scale-up path** (provisioning, config, image pulls, quotas) is itself a service with limits. Load-test it.
4. **Observability must not share the failure domain** it observes.

**How to cite it in an interview:** "Slack's January 2021 outage is the classic case of autoscaling amplifying a network fault: packet loss lowered CPU, so it scaled down, then panicked up 1,200 instances and broke its own provisioning service. I'd scale on saturation signals that can't invert, cap scale-down velocity, and keep monitoring out of the shared network path."`,
      diagram: `Slack 4 Jan 2021 — the feedback loop
 holidays end + cold client caches ─▶ packet rate jumps
                                      │
                         AWS TGW can't scale fast enough
                                      │  packet loss
                                      ▼
  threads wait on I/O ─▶ CPU ▼ ─▶ autoscaler SCALES DOWN (lose hosts, SSH)
          │
          └─▶ thread util ▲ ─▶ autoscaler: +1,200 instances (7:01–7:15)
                                      │
               provision-service: open-files limit + AWS quota ✗
                                      │
           dashboards/alerting on same TGW path ✗ (debugging blind)
 Recovery: LB panic mode + retries/circuit breaking (9:15 degraded)
           AWS manual TGW upscale complete in all AZs (10:40)`,
      code: [
        {
          language: 'yaml',
          title: 'Kubernetes HPA: never let an I/O-bound dip scale you down fast',
          code: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: web }
  minReplicas: 120          # holiday-return floor, raised the Friday before
  maxReplicas: 900
  metrics:
    # Worker saturation (busy/total) cannot fall during an I/O stall the way CPU does
    - type: Pods
      pods:
        metric: { name: http_workers_busy_ratio }
        target: { type: AverageValue, averageValue: '0.6' }
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 900   # 15 min of evidence before shrinking
      policies:
        - { type: Percent, value: 5, periodSeconds: 60 }   # at most 5%/min
    scaleUp:
      policies:
        - { type: Pods, value: 60, periodSeconds: 60 }     # sized to what provisioning can absorb
      selectPolicy: Max`,
        },
      ],
      keyPoints: [
        'First Monday after holidays + cold client caches = launch-sized load.',
        'Packet loss → CPU down → scale-down → thread spike → +1,200 instances.',
        'Provision-service hit the open-files limit and an AWS quota.',
        'Monitoring shared the failing network path.',
      ],
      source: 'Slack Engineering — Slack\'s Outage on January 4th 2021',
    },
    {
      heading: '7. Cloudflare, 2 Jul 2019 — one regex, every CPU, 27 minutes',
      body: `**Intuition:** a backtracking regex engine, given the wrong pattern and input, will try every way of splitting the string before it gives up. Cloudflare shipped such a pattern to every edge server at once, and the CPUs that serve HTTP traffic spent their time on it.

**Context.** Cloudflare's WAF ran Lua-based managed rules using a backtracking regex engine. WAF rule changes propagate through **Quicksilver**, which distributes config globally in seconds (p99 **2.29 s**). Unlike software releases, WAF rules were **allowed to go global by design**, so that new threats could be blocked quickly.

**Timeline (UTC):**
- **13:31** engineer merges a "minor change" to XSS detection rules → **13:37** CI builds, tests pass → **13:42** automatic global deploy.
- The new rule was meant to run in **simulate** mode, but simulate rules still *execute*, so it still burned CPU.
- **~13:45** first page (synthetic WAF test). CPUs serving HTTP/HTTPS reached **nearly 100%** across the network; one leader reported losing **80%** of traffic.
- **14:00** WAF identified → **14:02** "global terminate" proposed → **14:07** executed. Access to internal tools was impaired, which slowed this. → **14:09** traffic and CPU normal. **27 minutes** of outage.
- **14:52** WAF re-enabled globally.

**Root cause.** The rule contained \`.*(?:.*=.*)\`. Several greedy \`.*\` terms that can match the same characters force the engine to try a very large number of split points when the match fails. The cost grows super-linearly with input length. A **CPU-excess protection** that would have limited it **had been removed** in an earlier refactor.

**What they changed:**
- Move to **re2 or the Rust regex engine**: automata-based engines with linear-time guarantees. They give up backreferences and lookaround.
- Re-introduce the CPU guard; **manually inspect all 3,868** managed rules for backtracking; add **performance profiling of every rule** to the test suite.
- **Staged rollouts** for WAF rules, with global emergency deploys kept only for active attacks.
- An emergency path to run the dashboard and API **off the Cloudflare edge**.

**Transferable lessons:** "config" and "rules" are code and need canaries. Functional tests don't catch performance cliffs, so benchmark against adversarial inputs. Prefer a linear-time engine for anything user-facing or authored by many people. In Node, the event loop is a single CPU, so one ReDoS request stalls every request on that pod.

**How to cite it in an interview:** "Cloudflare 2019 is my example of why config pushes need staged rollout: one WAF regex with catastrophic backtracking took every edge CPU to ~100% for 27 minutes. In Node I'd treat ReDoS as a P1 risk, because one bad input blocks the event loop for the whole pod."`,
      code: [
        {
          language: 'typescript',
          title: 'CI gate: profile every rule against adversarial inputs in a worker with a hard timeout',
          code: `import { Worker } from 'node:worker_threads';

// A rule that is "correct" can still be a performance bomb. Run it off-thread
// against generated worst-case inputs and fail the build if it is slow.
const ADVERSARIAL = (n: number) => [
  'x'.repeat(n),                 // no '=' anywhere: forces every split of .*(.*=.*) to fail
  'a=' + 'x'.repeat(n),
  ';'.repeat(n) + '!',
];

export function profileRule(pattern: string, budgetMs = 50): Promise<'ok' | 'slow'> {
  return new Promise((resolve) => {
    const w = new Worker(
      "const { workerData, parentPort } = require('node:worker_threads');" +
        'const re = new RegExp(workerData.pattern);' +
        'for (const s of workerData.inputs) re.test(s);' +
        "parentPort.postMessage('done');",
      { eval: true, workerData: { pattern, inputs: [10_000, 50_000].flatMap(ADVERSARIAL) } },
    );
    const timer = setTimeout(() => {
      void w.terminate(); // a runaway regex can only be stopped by killing its thread
      resolve('slow');
    }, budgetMs);
    w.once('message', () => {
      clearTimeout(timer);
      void w.terminate();
      resolve('ok');
    });
  });
}

// In production prefer a linear-time engine for untrusted input, e.g. the 're2'
// npm binding (new RE2(pattern)), which rejects backreferences/lookaround.`,
        },
      ],
      keyPoints: [
        'Global push by design + simulate mode still executing + a removed CPU guard.',
        '.*(?:.*=.*) → catastrophic backtracking → ~100% CPU, 27 min.',
        'Fix: re2/Rust regex, staged rule rollout, per-rule profiling, 3,868 rules audited.',
      ],
      source: 'Cloudflare — Details of the Cloudflare outage on July 2, 2019',
    },
    {
      heading: '8. Cloudflare, 18 Nov 2025 — a generated config file that doubled in size',
      body: `**Intuition:** a database permission change caused a metadata query to return every row twice. A file generated from that query doubled, crossed a hard limit in the proxy, and the proxy's error handling for "too big" was to crash.

**Context.** Cloudflare's Bot Management module scores every request using a **feature file** that is **regenerated every five minutes** from a ClickHouse query and pushed to the whole fleet. The core proxy (FL2, written in Rust) preallocates for a **limit of 200 features**; about **60** were in use.

**Timeline (UTC):**
- **11:05** a ClickHouse access-control change makes access to the underlying \`r0\` tables explicit.
- A metadata query that listed columns **without filtering by database name** now returned **duplicate rows** (from \`default\` and \`r0\`). The generated feature file **roughly doubled** and exceeded 200 features.
- **11:20–11:28** 5xx errors begin: FL2 panicked with \`called Result::unwrap() on an Err value\`.
- The failures **flapped**: the ClickHouse cluster was being updated node by node, so each five-minute run produced a good or a bad file depending on which node ran the query. The team first suspected a **hyper-scale DDoS**, and Cloudflare's status page, which is hosted *off* its infrastructure, coincidentally went down too.
- **13:05** Workers KV and Access bypass the core proxy to reduce impact → **14:24** generation and propagation of the file stopped → **14:30** a known-good file is pushed and main impact ends → **17:06** all services restored.

**Root cause.** Three things lined up: an **unvalidated, internally generated** config artifact; a **hard limit enforced by panicking** instead of rejecting the file; and a **global, fast push** with no last-known-good fallback.

**What they're changing:** harden ingestion of Cloudflare-generated config files **as if they were user input**; more **global kill switches** for features; stop core dumps and error reports from consuming resources during an incident; review failure modes across proxy modules.

**Transferable lessons:**
- Validate config at the **producer** (schema, size, row count against the previous version) **and** at the **consumer**.
- On a bad file, the consumer should **keep serving the last-known-good** version and alert, never crash.
- A flapping symptom that follows a periodic job's schedule is a clue: line up error spikes against job runs.

**How to cite it in an interview:** "Since Cloudflare's November 2025 outage, I treat internally generated config like user input. A feature file doubled because of duplicate metadata rows, crossed a 200-entry limit, and the proxy unwrapped an error and returned 5xx. My consumers validate, reject and keep the last-known-good version."`,
      code: [
        {
          language: 'typescript',
          title: 'Config consumer: validate, compare to last-known-good, never crash the hot path',
          code: `import { createHash } from 'node:crypto';

type FeatureFile = { version: number; features: { name: string; weight: number }[] };
const MAX_FEATURES = 200;

export class FeatureConfig {
  private current: FeatureFile; // last-known-good, always servable

  constructor(initial: FeatureFile, private readonly alert: (msg: string) => void) {
    this.current = initial;
  }

  get(): FeatureFile {
    return this.current; // request path never parses or validates
  }

  /** Called by the 5-minute poller. Returns true if the candidate was adopted. */
  offer(raw: string): boolean {
    let next: FeatureFile;
    try {
      next = JSON.parse(raw) as FeatureFile;
    } catch {
      this.alert('feature file: invalid JSON, keeping v' + this.current.version);
      return false;
    }
    const names = new Set(next.features.map((f) => f.name));
    const problems: string[] = [];
    if (next.features.length > MAX_FEATURES) problems.push('too many features');
    if (names.size !== next.features.length) problems.push('duplicate feature names');
    // Producer bugs show up as sudden size jumps: 60 -> 120 is not a normal edit
    if (next.features.length > this.current.features.length * 1.5) problems.push('size jumped >50%');
    if (next.version <= this.current.version) problems.push('stale version');
    if (problems.length) {
      const digest = createHash('sha256').update(raw).digest('hex').slice(0, 12);
      this.alert('feature file ' + digest + ' rejected: ' + problems.join(', '));
      return false; // keep serving last-known-good
    }
    this.current = next;
    return true;
  }
}`,
        },
      ],
      keyPoints: [
        'Duplicate metadata rows → file doubled → over the 200-feature limit → unwrap() panic.',
        'Flapping every 5 min because ClickHouse nodes were updated gradually.',
        'Status page outage coincidence pushed the team toward a DDoS theory.',
        'Fix: treat generated config as untrusted input; last-known-good; kill switches.',
      ],
      source: 'Cloudflare — Cloudflare outage on November 18, 2025',
    },
    {
      heading: '9. AWS us-east-1, 19–20 Oct 2025 — the DNS race that emptied DynamoDB\'s endpoint',
      body: `**Intuition:** two copies of the same automation each did a correct step, in the wrong order. The slow one wrote an old plan over a new one, and the fast one then deleted the old plan as garbage, which left the live record empty.

**Context.** DynamoDB's regional endpoint DNS is managed by automation. A **DNS Planner** produces plans (sets of load balancers and weights). **Three DNS Enactors**, one per AZ, apply plans to Route 53 independently for resilience. After applying, an Enactor **cleans up** plans that are much older than the one it applied.

**The race (as AWS described it):**
1. Enactor A is **delayed** (retrying updates on several endpoints). Its freshness check, made when it started, says its plan is newer than what's live.
2. The Planner keeps producing newer plans. **Enactor B** applies a **much newer plan**, then runs **cleanup**, deleting plans far older than its own, including the one A is still working through.
3. A finally applies its **stale plan**, overwriting B's. The freshness check had gone stale in the meantime.
4. B's cleanup deletes that old plan. Deleting it removed **all IP addresses** for \`dynamodb.us-east-1.amazonaws.com\`, and the inconsistent state blocked any Enactor from repairing it. **Manual intervention** was needed.

**Timeline (PDT):** **23:48** (19 Oct) DynamoDB errors begin → **00:38** DNS state identified → **02:25** DNS restored → **02:40** cached records expired and errors ended. Impact did not end there:
- **EC2:** the DropletWorkflow Manager (DWFM) keeps leases on the physical hosts ("droplets") and its state checks depend on DynamoDB, so leases timed out. After DynamoDB returned, DWFM had too many leases to re-establish and fell into **congestive collapse**: work timed out and was retried faster than it completed. Engineers throttled and restarted DWFM hosts at **04:14**; leases were restored by **05:28**. Network Manager then worked through a propagation backlog, and EC2 launches were fully normal at **13:50**.
- **NLB:** health checks ran against instances whose network state had not propagated, so they **flapped** and repeatedly pulled capacity out of DNS (05:30–14:09). Automatic AZ failover was disabled at 09:36 to stop the churn.

**What AWS changed:** disabled the DynamoDB DNS Planner/Enactor automation **worldwide** until the race is fixed and protections against bad plans are added; NLB **velocity control** on how much capacity health-check failover can remove; a DWFM recovery test suite and **queue-size-based throttling** in EC2.

**Transferable lessons:** stale-check-then-act is a TOCTOU bug, so the write itself must be **conditional** (compare-and-set on a generation number). Garbage collection must **never delete what is live**. Recovery is a load event, so admission-control the backlog. Health-check-driven removal needs a **rate limit**.

**How to cite it in an interview:** "AWS's October 2025 incident is a textbook TOCTOU race: a delayed DNS Enactor applied a stale plan after a newer one, and cleanup deleted it, emptying the DynamoDB endpoint. Recovery then caused congestive collapse in EC2's lease manager. So I make 'apply' a compare-and-set on a monotonic generation, and I throttle recovery work by queue depth."`,
      diagram: `DynamoDB DNS race (simplified from AWS's summary)
time ─────────────────────────────────────────────────────────────▶
Planner   : plan#100 ... plan#140 ...........................
Enactor A : check(#100 newer than live? yes) ── slow retries ──── APPLY #100 (!)
Enactor B :            APPLY #140 ── cleanup(delete plans << #140)
                                       └─ deletes #100 after A applied it
Route 53  : #9x ─────▶ #140 ─────────────────────▶ #100 ──▶ (deleted) = EMPTY
Fix: apply = conditional write "only if live.generation < mine";
     cleanup never deletes the plan that is currently live.`,
      code: [
        {
          language: 'typescript',
          title: 'Make "apply" a compare-and-set on a monotonic generation',
          code: `type Plan = { generation: number; records: { ip: string; weight: number }[] };

interface PlanStore {
  /** Atomically sets live = next only if live.generation === expected. */
  compareAndSetLive(expected: number, next: Plan): Promise<boolean>;
  getLive(): Promise<Plan>;
  deletePlan(generation: number): Promise<void>;
  listPlans(): Promise<number[]>;
}

export async function applyPlan(store: PlanStore, candidate: Plan): Promise<'applied' | 'stale'> {
  if (candidate.records.length === 0) throw new Error('refusing to apply empty plan'); // invariant
  for (let attempt = 0; attempt < 5; attempt++) {
    const live = await store.getLive();
    if (live.generation >= candidate.generation) return 'stale'; // checked AT write time
    if (await store.compareAndSetLive(live.generation, candidate)) return 'applied';
    // someone else won the race; re-read and re-evaluate instead of overwriting
  }
  return 'stale';
}

export async function cleanup(store: PlanStore, keepLatest = 10): Promise<void> {
  const live = await store.getLive();
  const gens = (await store.listPlans()).sort((a, b) => b - a);
  for (const g of gens.slice(keepLatest)) {
    if (g === live.generation) continue; // GC must never delete what is serving traffic
    await store.deletePlan(g);
  }
}`,
        },
      ],
      keyPoints: [
        'Stale freshness check + independent Enactors + aggressive cleanup = empty DNS record.',
        'Automation could not self-repair the inconsistent state; humans did.',
        'EC2 DWFM congestive collapse after recovery; NLB health checks flapped.',
        'Fixes: CAS on generation, protected live plan, velocity limits, queue-aware throttling.',
      ],
      source: 'AWS — Summary of the Amazon DynamoDB Service Disruption in US-EAST-1 (Oct 2025)',
    },
    {
      heading: '10. Meta, 4 Oct 2021 — the backbone command and the DNS servers that hid themselves',
      body: `**Intuition:** a safety feature worked as designed and finished the job. DNS servers that can't reach a data centre withdraw their own routes so users go elsewhere, but when *every* data centre was unreachable, there was nowhere else to go, and Facebook disappeared from the internet.

**Context.** Meta's backbone links its data centres. Its edge DNS servers announce their anycast prefixes via **BGP**, and they are designed to **withdraw** those announcements when they can't reach the data centres, which is a health signal that steers traffic to healthy sites.

**What broke:**
- During routine maintenance, a command meant to **assess global backbone capacity** unintentionally **took down all backbone connections**.
- An **audit tool** that should have blocked the command had a **bug** and let it through.
- With the backbone gone, the DNS servers declared themselves unhealthy and **withdrew their BGP routes**. They were "still operational" but unreachable, so facebook.com, Instagram and WhatsApp names stopped resolving worldwide.
- Internal tools and remote access shared the same infrastructure, so engineers had to go **on site**. Data-centre security (by design) slowed physical access and hardware work.
- Restoring traffic carried risks of its own: data centres had shown power dips of **tens of megawatts**, and turning everything back on at once could overload electrical systems and cold caches. Meta credited its **"storm" drills**, though it had never drilled a global backbone outage.

**Duration.** Meta's post gives no duration. Cloudflare's measurements show routing trouble beginning **~15:40 UTC**, facebook.com unresolvable on 1.1.1.1 from **~15:50 to 21:20 UTC**, and DNS working again by **21:28 UTC**, so roughly **5.5 hours**. Resolvers worldwide saw **30×** normal query volume as clients retried.

**Transferable lessons:**
1. **Out-of-band access** (separate network, separate auth) for the infrastructure you'd need in order to fix the infrastructure.
2. **Self-protective health logic needs a global sanity check.** "If *everyone* looks unhealthy, the detector is probably wrong", so don't withdraw everything.
3. Change tooling is part of production: the audit tool's bug was a root cause.
4. **Restore gradually.** Recovery traffic and cold caches are a load event.
5. Clients retrying failed DNS lookups added load for everyone else, so back off.

**How to cite it in an interview:** "Meta 2021 shows why health checks need a global floor: DNS servers withdrew BGP routes when they lost the backbone, which made a backbone outage a total outage. I'd also keep out-of-band access and turn traffic back on in stages, because cold caches and power draw make recovery a load event too."`,
      diagram: `Meta, 4 Oct 2021
 maintenance cmd ──(audit tool bug: not blocked)──▶ backbone links DOWN
                                                     │
          edge DNS: "can't reach DCs => I'm unhealthy" │
                                                     ▼
            BGP WITHDRAW anycast DNS prefixes (all sites, ~15:40 UTC)
                                                     │
  internet resolvers: facebook.com -> SERVFAIL  (30x query volume, retries)
  engineers: VPN/internal tools down -> on-site, physical security slows work
  recovery: stage traffic back (power swings of tens of MW, cold caches)
  DNS resolving again ~21:28 UTC  (~5.5 h, per Cloudflare's data)`,
      code: [
        {
          language: 'typescript',
          title: 'A health-withdrawal guard with a global floor (the lesson, in code)',
          code: `// Each edge node decides whether to keep announcing its anycast prefix.
// Withdrawing is right when ONE site is sick, catastrophic when ALL are.
type Fleet = { totalSites: number; sitesReportingHealthy: number };

export function shouldAnnounce(
  localBackendsReachable: boolean,
  fleet: Fleet,
  minFleetFraction = 0.5,
): { announce: boolean; reason: string } {
  if (localBackendsReachable) return { announce: true, reason: 'healthy' };

  const healthyFraction = fleet.sitesReportingHealthy / fleet.totalSites;
  if (healthyFraction < minFleetFraction) {
    // Most of the fleet thinks it's unhealthy: the shared dependency (backbone,
    // health-check service) is the likelier failure. Keep serving and page humans.
    return { announce: true, reason: 'fail-static: fleet-wide unhealthy, refusing mass withdrawal' };
  }
  return { announce: false, reason: 'local backends unreachable; others can absorb traffic' };
}`,
        },
      ],
      keyPoints: [
        'Command to assess capacity took down the whole backbone; audit tool bug let it through.',
        'DNS servers withdrew their own BGP routes when they lost the data centres.',
        'No out-of-band access: on-site recovery, slowed by physical security.',
        '~5.5 h by Cloudflare\'s measurements; Meta\'s post states no duration.',
      ],
      source: 'Meta Engineering — More details about the October 4 outage; Cloudflare — Understanding how Facebook disappeared from the Internet',
    },
    {
      heading: '11. Figma, 2020–2024 — horizontally sharding RDS Postgres without leaving Postgres',
      body: `**Intuition:** before moving any data, Figma made the application behave as if the database were already sharded, using views. Once that worked, the physical split was an operation that had already been rehearsed.

**Context & scale.** In 2020 Figma ran **one Postgres database on AWS's largest physical instance**. The stack then grew **almost 100×**. By the end of 2022 Figma had **a dozen vertically partitioned databases** (groups of related tables split into their own DBs), with caching and read replicas.

**What broke / forced the change:** some tables reached **several TB and billions of rows**. **Vacuum** caused reliability problems, and write-heavy tables were approaching **RDS's IOPS limits**. Vertical partitioning can't split a single table.

**Key decisions:**
- **Stay on RDS Postgres.** CockroachDB, TiDB, Spanner and Vitess were considered and rejected for now: a risky migration, and the team would lose years of RDS Postgres operating expertise while it had only **months of runway**. NoSQL didn't fit Figma's relational model.
- **Shard keys** \`UserID\`, \`FileID\`, \`OrgID\`; tables sharing a key form a **colo**, so joins and transactions within a colo stay on one shard. Keys are **hashed**, because auto-increment and Snowflake-style IDs are time-ordered and would create hotspots.
- **Logical before physical:** **Postgres views** per logical shard let the app run "sharded" reads and writes while the data still sat on one host. Rolling back was a **config change**. Only then did they do the physical split.
- **DBProxy** (Go), between the app and **PgBouncer**: a query engine with parser, logical planner and physical planner. It routes by shard key and does **scatter-gather** for queries without one. **No cross-shard atomic transactions.**

**Result:** the first sharded table shipped in **September 2023** after roughly **nine months** of work, with about **10 seconds** of partial availability on primaries during the failover and no impact on replicas. Figma reported no latency or availability regressions afterwards. Still open at the time of writing: sharded schema changes, globally unique IDs, and cross-shard transactions.

**Transferable lessons:** squeeze the cheap levers first (vertical partitioning, replicas, caching). Group tables by shard key so most transactions stay single-shard. Make the **risky step reversible**: logical sharding first, then physical. A proxy that understands SQL lets the app migrate gradually.

**How to cite it in an interview:** "I'd follow Figma's playbook: vertical partitioning first, then hash-sharded colos by UserID, FileID and OrgID, with logical shards as views before any physical split, so rollback is a config change. A query-aware proxy handles routing, and cross-shard transactions are designed out rather than supported."`,
      code: [
        {
          language: 'sql',
          title: 'Logical shards as views over one physical table (the reversible step)',
          code: `-- 1. Still one physical table on one host
--    files(id uuid, file_id_hash int4 GENERATED ALWAYS AS (hashtext(id::text)) STORED, ...)
-- 2. One view per logical shard; the app (via the proxy) only talks to views.
CREATE VIEW files_shard_0 AS
  SELECT * FROM files WHERE file_id_hash >= -2147483648 AND file_id_hash < -1073741824;
CREATE VIEW files_shard_1 AS
  SELECT * FROM files WHERE file_id_hash >= -1073741824 AND file_id_hash < 0;
CREATE VIEW files_shard_2 AS
  SELECT * FROM files WHERE file_id_hash >= 0 AND file_id_hash < 1073741824;
CREATE VIEW files_shard_3 AS
  SELECT * FROM files WHERE file_id_hash >= 1073741824;

-- 3. Run production traffic through the views for weeks. Any query the proxy
--    cannot route by file id shows up now, while rollback is just config.
-- 4. Physical split later: replicate the rows behind shards 2-3 to a new host,
--    then repoint those views' routing in the proxy during a ~seconds failover.

-- Simple hash ranges like these make adding shards later a range split,
-- not a full rehash of every row.`,
        },
      ],
      keyPoints: [
        'One Postgres → ~100× growth → vertical partitioning → horizontal sharding.',
        'Colos by UserID/FileID/OrgID; hashed keys to avoid time-ordered hotspots.',
        'Logical sharding via views first; physical split second.',
        'DBProxy in Go; no cross-shard transactions; first table Sept 2023.',
      ],
      source: 'Figma — How Figma\'s databases team lived to tell the scale (2024)',
    },
    {
      heading: '12. Notion, 2021 — 480 logical shards on 32 Postgres hosts, keyed by workspace',
      body: `**Intuition:** pick a shard count you can divide in many ways, put every row of a workspace on the same shard, and move data with a double-write, backfill, verify, switch-over plan that you can check at every step.

**Context.** Notion's block model put everything in one Postgres monolith. The trigger to act was **VACUUM stalling consistently** (dead tuples no longer reclaimed) and the looming risk of **TXID wraparound**, which would force Postgres to stop accepting writes.

**Key design decisions:**
- **Partition key: workspace ID.** Nearly every query is scoped to a workspace, so a workspace's blocks, comments and members live on **one shard** and queries and transactions stay local. Sharded tables keep \`space_id\` in a composite key with \`id\`.
- **480 logical shards across 32 physical databases**, 15 per host, each logical shard a **Postgres schema**. 480 has many divisors, so they can go from 32 hosts to 40, 48 or 60 without re-hashing. With 512 the next step would be 64 hosts.
- **Sizing targets:** at most **500 GB per table** and **10 TB per physical database**, with at least **60K IOPS** in total.

**Migration:**
1. **Double-write** new changes. They chose an **audit log + catch-up script** over logical replication.
2. **Backfill** existing data: a single \`m5.24xlarge\` using all **96 CPUs** took about **three days**.
3. **Verify** with random UUID sampling and **dark reads**: read both, compare, log mismatches.
4. **Switch over** in **five minutes of scheduled maintenance**.

**Transferable lessons:** choose the shard key from **tenancy** (what every query is scoped by). Over-provision **logical** shards and map them to fewer **physical** hosts. Instrument verification before switching reads. Watch \`age(datfrozenxid)\` long before it becomes an emergency.

**How to cite it in an interview:** "For a multi-tenant SaaS I'd shard by workspace like Notion: 480 logical shards as schemas on 32 hosts, because 480 divides cleanly as we add hosts. I'd migrate with double-writes, a backfill, and dark-read verification before a short switch-over."`,
      code: [
        {
          language: 'typescript',
          title: 'Workspace → logical shard → physical host routing (Notion-style)',
          code: `import { createHash } from 'node:crypto';
import { Pool } from 'pg';

const LOGICAL_SHARDS = 480;        // divisible by 2,3,4,5,6,8,10,12,15,16,20,24,30,32,40,48,60...
const PHYSICAL_HOSTS = 32;         // 15 logical shards per host today
const SHARDS_PER_HOST = LOGICAL_SHARDS / PHYSICAL_HOSTS;

export function logicalShard(workspaceId: string): number {
  // Stable hash of the tenant key; never Math.random, never time-ordered ids
  const h = createHash('sha1').update(workspaceId).digest().readUInt32BE(0);
  return h % LOGICAL_SHARDS;
}

export function physicalHost(shard: number): number {
  return Math.floor(shard / SHARDS_PER_HOST); // shards 0..14 -> host 0, 15..29 -> host 1, ...
}

const pools = Array.from({ length: PHYSICAL_HOSTS }, (_, i) =>
  new Pool({ host: 'pg-' + i + '.internal', max: 20 }));

export async function blocksForPage(workspaceId: string, pageId: string) {
  const shard = logicalShard(workspaceId);
  const schema = 'schema' + String(shard).padStart(3, '0'); // each logical shard = a schema
  const sql = 'SELECT id, type, properties FROM ' + schema +
    '.block WHERE space_id = $1 AND parent_id = $2';
  // space_id in the predicate keeps the query on the composite (space_id, id) key
  return (await pools[physicalHost(shard)].query(sql, [workspaceId, pageId])).rows;
}
// Growing to 48 hosts = move whole schemas (10 per host); no row is re-hashed.`,
        },
      ],
      keyPoints: [
        'Trigger: VACUUM stalling and TXID wraparound risk.',
        'Workspace ID as partition key keeps tenant queries single-shard.',
        '480 logical / 32 physical; 480 chosen for divisibility.',
        'Double-write via audit log, 3-day backfill, dark reads, 5-min maintenance.',
      ],
      source: 'Notion — Herding elephants: lessons learned from sharding Postgres at Notion (2021)',
    },
    {
      heading: '13. The pattern map — five failure shapes, and how to tell any case study in 90 seconds',
      body: `**Intuition:** these twelve stories reduce to a handful of failure shapes. If you can name the shape, you can apply the lesson to the system in front of you, and that is what interviewers are really testing when they ask about an outage you studied.

| Shape | Cases | The general lesson |
|---|---|---|
| **Automation did what it was told, fast and everywhere** | GitHub/Orchestrator, Cloudflare 2019 & 2025, AWS DNS Enactor, Meta audit tool | Blast-radius limits: staged rollout, velocity caps, "refuse if it affects > X%", human gate across regions |
| **Self-protection that turns into a total outage** | Meta DNS withdrawal, NLB health-check flapping, Slack scale-down | Health logic needs a global floor and rate limits |
| **Recovery is a load event** | AWS DWFM congestive collapse, Slack cold caches, Meta power/cache, GitHub backlog of 5 M webhooks | Admission control and staged warm-up |
| **Tail latency from hot keys and runtimes** | Discord hot partitions + GC | Coalesce above storage, route by key, pick engines for p99 |
| **Outgrowing one database** | Uber, Figma, Notion, gh-ost | Know the storage mechanism; reversible, verifiable migrations |

**The 90-second telling (STAR for systems):**
1. **Context & scale**, one sentence with one number ("Discord, 177 Cassandra nodes, trillions of messages").
2. **Trigger and mechanism**: what happened, and why it spread.
3. **The decision under pressure** ("GitHub chose integrity over availability: 24 hours of degradation instead of discarding writes").
4. **What they changed**: two concrete fixes.
5. **What I do differently because of it**: tie it to your own NestJS/Postgres/Kafka world.

**Accuracy rules:** quote numbers only from the primary post. Say "about" when a figure is derived (Meta's duration comes from Cloudflare's data, not Meta's post). Separate what the company said from your own inference. An interviewer who has read the postmortem will notice an invented number immediately.`,
      diagram: `Before telling it, ask four questions:
 ┌──────────────┐   ┌───────────────┐   ┌───────────────┐   ┌─────────────┐
 │ What changed?│──▶│ Why did it    │──▶│ Why was       │──▶│ What guard  │
 │ (cmd, config,│   │ spread? (push,│   │ recovery slow?│   │ would have  │
 │  traffic)    │   │  shared dep)  │   │ (OOB, backlog)│   │ capped it?  │
 └──────────────┘   └───────────────┘   └───────────────┘   └─────────────┘`,
      keyPoints: [
        'Most outages are automation with no blast-radius limit.',
        'Recovery is a load event: plan admission control.',
        'Primary-source numbers only; flag derived figures.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'prod-dissections-cc-1',
      title: 'Defuse a ReDoS: the search-tag validator that froze every pod',
      context:
        'After the Cloudflare 2019 write-up, your team audits regexes on hot paths. This NestJS pipe validates a `tags` query parameter and parses an `x-client-meta` header of `key=value;key=value` pairs. A pen-tester sent a 30 KB tags value ending in `!`, and the pod\'s event-loop lag went from 2 ms to 40 s. Since Node runs JavaScript on one thread, every other request on that pod stalled too.',
      task:
        'Make both parsers linear-time and safe against hostile input without changing what valid input they accept (space-separated word tags; semicolon-separated key=value pairs). Bound the work per request, and keep untrusted patterns off the backtracking engine.',
      starter: {
        language: 'typescript',
        title: 'tags.pipe.ts — starter',
        code: `import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class TagsPipe implements PipeTransform<string, string[]> {
  // "words separated by single spaces"
  private readonly TAGS = /^(\\w+\\s?)*$/;

  transform(value: string): string[] {
    if (!this.TAGS.test(value)) throw new BadRequestException('bad tags');
    return value.split(' ');
  }
}

export function parseClientMeta(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  // grab every "k=v" chunk; borrowed from an old WAF-style rule
  const re = /(?:^|;)\\s*(.*=.*?)(?=;|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header)) !== null) {
    const [k, v] = m[1].split('=');
    out[k.trim()] = v;
  }
  return out;
}

// Also: admins can add custom "blocked tag" patterns in the dashboard:
export function isBlocked(tag: string, adminPatterns: string[]): boolean {
  return adminPatterns.some((p) => new RegExp(p).test(tag));
}`,
      },
      hints: [
        '`(\\w+\\s?)*` lets "abc" be split as a|bc, ab|c, a|b|c… When the final `!` makes the match fail, the engine tries every split. Make each character belong to exactly one quantifier.',
        'A header of `k=v` pairs doesn\'t need a regex: `split(\';\')`, then `indexOf(\'=\')`. Cap the length before doing any work.',
        'Admin-authored patterns are untrusted code. Use a linear-time engine such as RE2 (the `re2` npm binding) and reject patterns it can\'t compile.',
      ],
      solution: {
        language: 'typescript',
        title: 'tags.pipe.ts — linear-time, bounded, engine-safe',
        code: `import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import RE2 from 're2'; // linear-time automata engine; no backreferences/lookaround

const MAX_TAGS_LEN = 512;
const MAX_META_LEN = 2048;
const MAX_PAIRS = 32;

@Injectable()
export class TagsPipe implements PipeTransform<string, string[]> {
  // Unambiguous: a space can only be matched by the literal ' ', a word char only by \\w+
  private readonly TAGS = /^\\w+(?: \\w+)*$/;

  transform(value: string): string[] {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TAGS_LEN) {
      throw new BadRequestException('tags must be 1-' + MAX_TAGS_LEN + ' chars');
    }
    if (!this.TAGS.test(value)) throw new BadRequestException('bad tags');
    return value.split(' ');
  }
}

export function parseClientMeta(header: string): Record<string, string> {
  if (header.length > MAX_META_LEN) throw new BadRequestException('x-client-meta too long');
  const out: Record<string, string> = Object.create(null); // no __proto__ pollution
  const parts = header.split(';', MAX_PAIRS + 1);
  if (parts.length > MAX_PAIRS) throw new BadRequestException('too many pairs');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i <= 0) continue; // skip empty or keyless chunks; O(n) total
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); // keeps '=' inside values
  }
  return out;
}

// Compile admin patterns ONCE, at save time, with RE2; reject what RE2 can't run.
const compiled = new Map<string, RE2>();
export function compileAdminPattern(p: string): void {
  if (p.length > 200) throw new BadRequestException('pattern too long');
  compiled.set(p, new RE2(p)); // throws on backreferences/lookaround -> 400 to the admin
}
export function isBlocked(tag: string): boolean {
  for (const re of compiled.values()) if (re.test(tag)) return true;
  return false;
}`,
      },
      explanation: `**Fixes:**
- **Ambiguous quantifier removed.** \`^(\\w+\\s?)*$\` can split one word in exponentially many ways, and the trailing \`!\` forces the engine to try them all. \`^\\w+(?: \\w+)*$\` gives every character one possible owner, so matching is linear.
- **Length caps before work.** Even a linear regex on 30 KB is wasted CPU. Reject oversized input first.
- **No regex for structured splitting.** \`.*=.*?\` with alternation and lookahead is the same \`.*(?:.*=.*)\` shape that broke Cloudflare. \`split\`/\`indexOf\` is O(n), keeps \`=\` inside values (the starter dropped everything after a second \`=\`), and \`Object.create(null)\` blocks prototype pollution.
- **Untrusted patterns go to RE2.** Admin-authored patterns are code from many authors, which was exactly the WAF situation. RE2 guarantees linear time and refuses the features that need backtracking.
- **Compile once.** \`new RegExp\` per request was also a CPU and GC cost.`,
      followUps: [
        {
          q: 'How would you catch the next ReDoS in CI rather than in production?',
          a: 'Run every regex in the codebase (and every stored admin pattern) against generated adversarial inputs, such as long runs of one character followed by a non-matching tail, inside a `worker_thread` with a hard timeout, and fail the build over budget. Add a lint rule (e.g. eslint-plugin-regexp / safe-regex) for nested quantifiers. This is what Cloudflare added after 2019: profiling of every rule in the test suite.',
        },
        {
          q: 'Product insists admins need lookahead in blocked-tag patterns. RE2 can\'t do it. Now what?',
          a: 'Run the backtracking engine off the event loop: a small `worker_threads` pool with a per-evaluation timeout (terminate the worker on overrun) and input length caps. Treat a timeout as "blocked" or "allowed" by policy, and alert. Canary new patterns: evaluate them in shadow against recent traffic and measure time per match before enabling them. This is the staged-rollout lesson applied to user-authored rules.',
        },
      ],
    },
    {
      id: 'prod-dissections-cc-2',
      title: 'Fix the failover script that causes split brain',
      context:
        'Your platform team wrote a Postgres failover daemon after reading about Orchestrator. One instance runs in ap-south-1a and watches the primary (ap-south-1a). Candidates are a same-region replica (ap-south-1b) and a DR replica in ap-southeast-1. Last month a 40-second switch flap in 1a caused it to promote the Singapore replica while the old primary kept accepting writes from pods that still had pooled connections. You got a GitHub-2018-style divergence, on a smaller scale.',
      task:
        'Rewrite the daemon so that it (1) only fails over when a quorum of observers in different AZs agree the primary is gone, (2) never promotes across regions automatically, (3) never promotes a replica that is too far behind, (4) fences the old primary before routing writes to the new one, and (5) can\'t flap.',
      starter: {
        language: 'typescript',
        title: 'failover-daemon.ts — starter',
        code: `import { Client } from 'pg';
import { setTimeout as sleep } from 'node:timers/promises';

const PRIMARY = { host: 'pg-1a.internal', region: 'ap-south-1' };
const REPLICAS = [
  { host: 'pg-sg.internal', region: 'ap-southeast-1' }, // listed first: "biggest box"
  { host: 'pg-1b.internal', region: 'ap-south-1' },
];

async function ping(host: string): Promise<boolean> {
  const c = new Client({ host, connectionTimeoutMillis: 1000 });
  try { await c.connect(); await c.query('SELECT 1'); return true; }
  catch { return false; }
  finally { await c.end().catch(() => {}); }
}

export async function run(dns: { point(name: string, host: string): Promise<void> }) {
  let failures = 0;
  for (;;) {
    failures = (await ping(PRIMARY.host)) ? 0 : failures + 1;
    if (failures >= 3) {
      const target = REPLICAS[0];
      const c = new Client({ host: target.host });
      await c.connect();
      await c.query('SELECT pg_promote()');
      await c.end();
      await dns.point('pg-primary.internal', target.host);
      failures = 0;
    }
    await sleep(1000);
  }
}`,
      },
      hints: [
        'A single observer that can\'t reach the primary may simply be on the wrong side of the partition. Ask observers in other AZs, and require a majority.',
        'Before promoting: is the candidate in the same region? How far behind is its replay LSN? After promoting: what stops the old primary and pooled connections from still accepting writes?',
        'Fencing needs a monotonic epoch stored somewhere with compare-and-set, plus a cooldown so one flapping link can\'t trigger repeated failovers.',
      ],
      solution: {
        language: 'typescript',
        title: 'failover-daemon.ts — quorum, same-region, lag-bounded, fenced, rate-limited',
        code: `import { Client } from 'pg';

type Node = { host: string; region: string; az: string };
type Observer = { az: string; canReachPrimary(): Promise<boolean> };
interface Coord { // etcd/Consul/DynamoDB-conditional-write backed
  getEpoch(): Promise<{ epoch: number; primary: string; lastFailoverAt: number }>;
  casEpoch(expected: number, next: { epoch: number; primary: string; lastFailoverAt: number }): Promise<boolean>;
}
interface Fencer { isolate(host: string): Promise<void> } // SG rule / STONITH / pg_hba deny + kill sessions

const HOME_REGION = 'ap-south-1';
const MAX_LAG_BYTES = 16 * 1024 * 1024; // RPO budget: promote only if <= 16 MB behind
const COOLDOWN_MS = 15 * 60 * 1000;

async function q<T>(host: string, sql: string): Promise<T> {
  const c = new Client({ host, connectionTimeoutMillis: 1500, statement_timeout: 2000 });
  await c.connect();
  try { return (await c.query(sql)).rows[0] as T; } finally { await c.end(); }
}

export async function maybeFailover(
  primary: Node, replicas: Node[], observers: Observer[], coord: Coord, fencer: Fencer,
  page: (msg: string) => Promise<void>, now = Date.now(),
): Promise<string> {
  // 1. Quorum: a majority of observers in DIFFERENT AZs must fail to reach the primary
  const votes = await Promise.all(observers.map((o) => o.canReachPrimary().catch(() => false)));
  const down = votes.filter((v) => !v).length;
  if (down <= observers.length / 2) return 'primary reachable by quorum; no action';

  const state = await coord.getEpoch();
  if (now - state.lastFailoverAt < COOLDOWN_MS) { await page('failover suppressed: cooldown'); return 'cooldown'; }

  // 2. Same-region candidates only; cross-region is a human decision (GitHub 2018)
  const local = replicas.filter((r) => r.region === HOME_REGION);
  if (!local.length) { await page('primary down, only cross-region replicas: HUMAN DECISION'); return 'paged'; }

  // 3. Pick the most caught-up local replica; refuse if beyond the RPO budget
  const lsns = await Promise.all(local.map(async (r) => ({ r,
    lag: Number((await q<{ lag: string }>(r.host,
      "SELECT pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) AS lag")).lag) })));
  const best = lsns.sort((a, b) => a.lag - b.lag)[0];
  if (best.lag > MAX_LAG_BYTES) { await page('best replica ' + best.lag + ' B behind: HUMAN DECISION'); return 'paged'; }

  // 4. Claim the new epoch FIRST (only one daemon can win), then fence, then promote
  const next = { epoch: state.epoch + 1, primary: best.r.host, lastFailoverAt: now };
  if (!(await coord.casEpoch(state.epoch, next))) return 'another daemon is handling it';
  await fencer.isolate(primary.host); // old primary can no longer accept writes, even if it's alive
  await q(best.r.host, 'SELECT pg_promote(true, 60)');
  // 5. Clients discover the primary from coord (epoch-tagged), not a 300 s DNS TTL
  await page('failover epoch ' + next.epoch + ' -> ' + best.r.host);
  return 'promoted ' + best.r.host;
}`,
      },
      explanation: `**Fixes, mapped to the incident:**
- **Quorum of observers across AZs.** The starter trusted one observer in the same AZ as the primary, which is exactly the vantage point that a partition fools. A majority across AZs separates "dead" from "I can't see it".
- **No automatic cross-region promotion.** That was GitHub's main remediation after 2018. Cross-region candidates page a human, because promotion moves write latency and creates divergence risk.
- **RPO-bounded candidate choice.** The starter promoted \`REPLICAS[0]\`, the "biggest box", whatever its lag. Now the most caught-up local replica wins, and only within a byte budget.
- **Epoch via compare-and-set before acting.** Two daemons can't both promote, and the epoch acts as a fencing token clients can check.
- **Fence before promote.** Isolate the old primary (security-group deny, STONITH, or \`pg_hba\` deny plus terminating sessions), so pooled connections can't keep writing to it. That was the source of the split brain.
- **Cooldown.** A flapping link can't cause repeated failovers.
- **Discovery through the coordinator,** not a long DNS TTL that keeps clients on the old primary.`,
      followUps: [
        {
          q: 'The old primary is completely unreachable, so `fencer.isolate` times out. Do you promote anyway?',
          a: 'Only if the fence doesn\'t depend on reaching the host. Use a mechanism that acts from outside: revoke its security-group ingress or detach its ENI through the cloud API, or rely on a lease, where the primary must renew an etcd/DynamoDB lease every few seconds and demotes itself to read-only when it can\'t. With a lease, you wait one lease TTL plus clock-skew margin before promoting, so you know the old primary has stopped accepting writes.',
        },
        {
          q: 'How would you test this daemon without waiting for a real partition?',
          a: 'Inject faults in a staging cluster: drop packets between AZs with `tc netem` or security-group rules, kill observers, delay replication, and run two daemons at once. Assert the invariants rather than the timings: never two writable primaries (probe with a write + epoch check), no cross-region promotion, promoted lag ≤ budget, at most one failover per cooldown window. Also run it as a scheduled game day. GitHub listed fault injection as a remediation.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'prod-dissections-iq-01',
      difficulty: 'expert',
      question:
        'You are on call. Six minutes ago a 43-second link flap made your topology manager promote MySQL primaries in your secondary region. The link is back, East Coast app servers are timing out on cross-country writes, and the old primaries hold a few seconds of writes that never replicated. You are the incident commander. What do you do in the next 30 minutes, and what do you refuse to do?',
      context: 'Modelled on GitHub\'s 21 October 2018 incident, as described in GitHub\'s post-incident analysis.',
      whatInterviewerLooksFor: [
        'Recognises divergence: neither side is a superset, so naive failback loses data',
        'Freezes automation and side-effectful pipelines (webhooks, builds) before they spread bad state',
        'States the integrity vs availability trade-off explicitly and picks one with reasons',
        'Preserves evidence (binlogs) for reconciliation',
        'Communicates status honestly and early',
      ],
      modelAnswer: `### First 5 minutes: stop the bleeding without destroying evidence
- **Freeze the automation.** Pause the topology manager (Orchestrator) so it can't make another move while humans decide.
- **Declare red status** and name an incident commander, a comms lead and a DB lead.
- **Stop side effects that amplify inconsistency.** Pause webhook delivery, Pages-style builds and async jobs that read freshly written data. GitHub paused webhooks and Pages at 23:19.

### Minutes 5–15: establish the data picture
- For every cluster, find which side took writes after the split: the East primaries' unreplicated binlog tail (GitHub: 954 writes on one busy cluster) and the West writes since promotion.
- **Copy those binlogs off-host now.** They are the only record for reconciliation.

### Minutes 15–30: decide, and say why
| Option | Cost |
|---|---|
| Fail back to East, discard West writes | Silent loss of minutes of user data (issues, comments, pushes metadata) |
| Keep West, discard East tail | Loses a few seconds of writes; East apps stay slow on cross-country latency |
| **Fail forward:** restore East from backup + replicate from West, reconcile East tail | Hours of degradation, no silent data loss |

I'd choose **integrity**, as GitHub did: run degraded rather than discard writes, and reconcile the captured tail later (automatically where safe, with user outreach where not). Keep the site read-mostly, shed non-critical writes, and publish an ETA that includes the real backup-restore time (multi-TB from blob storage takes hours).

### What I refuse to do
- **Re-enable automatic failover** until the topology is consistent.
- **Point writes back East "because the link is fine now".** That forks history a second time.

### Afterwards
- No automatic cross-region promotion.
- Measured restore times.
- Component-level status reporting.
- Fault-injection game days.`,
      followUps: [
        {
          q: 'Your VP asks why you can\'t just accept 30 seconds of data loss and be green in 10 minutes. How do you answer?',
          a: 'Because the loss isn\'t 30 seconds in one place. It is two divergent histories, and it is silent: users won\'t know which comments, merges or payments vanished, and downstream systems (webhooks already delivered, CI already run) would disagree with the database. A few hours of visible degradation is recoverable. Silent loss breaks trust and creates support debt. If the business still prefers availability, it should be a written, explicit decision, made per cluster by data criticality.',
        },
        {
          q: 'How would you reconcile the 954 unreplicated writes once the topology is restored?',
          a: 'Replay the captured binlog events into a staging copy of the current schema and classify them. Inserts with no conflicting key can be applied automatically. Updates to rows that were also changed after the split are conflicts and need per-entity rules (last-writer-wins only where that is semantically safe) or user outreach. Deletes need special care. Track which writes users already redid themselves, which GitHub observed, so you don\'t apply them twice.',
        },
        {
          q: 'What single config change would have prevented this, and what does it cost you?',
          a: 'Forbid automatic primary promotion across regions; Orchestrator has data-centre/region-scoped promotion rules for this. The cost: if the primary region really is lost, failover waits for a human (minutes, not seconds), so your cross-region RTO rises. That is usually the right trade, because cross-region promotion also changes every app\'s write latency, and the app tier may not survive it anyway.',
        },
      ],
      pitfalls: [
        'Failing back immediately because "the network is fine now"',
        'Leaving the automation running while humans debug',
        'Forgetting async consumers (webhooks, CI) that spread inconsistent state',
        'Giving a 30-minute ETA without having measured backup restore time',
      ],
    },
    {
      id: 'prod-dissections-iq-02',
      difficulty: 'expert',
      question:
        'Our chat product stores messages in Cassandra partitioned by (channel_id, day). When a creator with 2M followers posts in a channel, read p99 for that channel goes to 900 ms and, oddly, unrelated channels on the same nodes also slow down. Leadership asks: tune Cassandra, add a layer in front, or migrate to ScyllaDB as Discord did? Walk me through the decision.',
      whatInterviewerLooksFor: [
        'Explains why quorum reads make a hot partition hurt neighbours',
        'Separates hot-key load (fix above the DB) from runtime tail latency (GC; engine choice)',
        'Knows coalescing needs key-affinity routing',
        'Treats migration as a project with verification and a timeline, and cites Discord\'s real numbers',
      ],
      modelAnswer: `### Diagnose two separate problems
1. **Hot partition.** Millions of reads of one \`(channel_id, day)\` land on the same replica set. With quorum reads, every request needs those same replicas, so their queues fill, and any other partition sharing them waits too. That explains the "unrelated channels" symptom.
2. **Tail latency from the runtime.** Check GC logs. If pauses line up with the spikes, the JVM is part of p99. Discord saw both, and some GC pauses needed manual reboots.

### Option A — fix above the database (do this first)
- **Request coalescing** in a data service: N concurrent identical reads become 1 query.
- **Consistent-hash routing by channel_id**, so duplicates reach the *same* instance. Round-robin spreads them out and coalescing barely helps.
- A short-TTL cache of the latest page for hot channels.
This is cheap, takes weeks rather than months, and works whatever the storage engine.

### Option B — tune Cassandra
Smaller time buckets for very active channels, \`LOCAL_ONE\` for non-critical reads (weaker consistency), GC tuning, and more nodes. This helps at the margins, but more nodes means more operations work. Discord went from 12 to 177 nodes.

### Option C — migrate (ScyllaDB)
Worth it if GC tail and operating cost dominate. Discord's results: **72 ScyllaDB nodes** replaced 177, p99 reads **40–125 ms → 15 ms**, inserts **5–70 ms → 5 ms**. Its migrator did **up to 3.2 M msgs/s**, finished in **nine days**, and stalled at 99.9999% on tombstones. Budget for dual-writes, verification and a tombstone/compaction plan.

### Recommendation
A then C: ship coalescing and routing in a sprint, which fixes the creator spike. Then decide on migration using GC and toil data, not the incident alone.`,
      followUps: [
        {
          q: 'You add coalescing but DB reads for the hot channel only drop 20%. Why?',
          a: 'The duplicates aren\'t meeting. Either the gateway round-robins across, say, 40 data-service pods, so each pod sees only 1/40th of the concurrent requests, or the coalescing key includes something per-user (a cursor, a locale) and identical reads look different. Fix the routing (hash on channel_id) and normalise the key to the storage query, not the API request.',
        },
        {
          q: 'What breaks when one channel is so hot that a single data-service instance can\'t handle its traffic?',
          a: 'Key-affinity routing now creates a hot pod. Options: serve the hottest keys from a replicated in-memory cache on every pod (accepting a stale window of 100–500 ms), split a hot key across a few virtual nodes and coalesce per virtual node (k DB queries instead of N), or push fan-out to the gateway layer so the data service sees one subscription per gateway. You trade some duplicate work for spreading the load.',
        },
      ],
      pitfalls: [
        'Jumping straight to "migrate the database" without fixing the access pattern',
        'Adding coalescing behind a round-robin load balancer',
        'Quoting Discord numbers wrongly, or as if they apply directly to your cluster',
      ],
    },
    {
      id: 'prod-dissections-iq-03',
      difficulty: 'hard',
      question:
        'Our new CTO read Uber\'s 2016 "Postgres to MySQL" post and wants us to migrate our 3 TB Postgres (trips-like table: 400 updates/s on a status column, 9 secondary indexes, analytics on replicas) to MySQL. Make the case for and against using our workload, not opinions.',
      whatInterviewerLooksFor: [
        'Explains ctid-pointing indexes vs PK-pointing InnoDB secondaries',
        'Knows HOT, fillfactor, and why an indexed status column defeats HOT',
        'Knows the replica-conflict knobs and modern Postgres logical replication',
        'Proposes measurement before migration',
      ],
      modelAnswer: `### The mechanism Uber described
- In Postgres, every index entry points at the tuple's **physical location**. An UPDATE writes a new tuple version, and unless it is a **HOT** update, **every index** gets a new entry and all of it goes into the WAL. Uber counted at least four physical writes for a one-column change.
- InnoDB secondary indexes store the **primary key**, so an update only touches indexes whose columns changed.

### Where it applies to us
- **400 updates/s on \`status\` with 9 indexes.** If \`status\` (or anything that changes with it, such as \`updated_at\`) is indexed, those updates **can't be HOT**, and each one writes up to 9 index entries plus WAL. That is real write amplification.
- **Measure it:** \`n_tup_hot_upd / n_tup_upd\` in \`pg_stat_user_tables\`, WAL bytes per second, index bloat.

### Fixes that stay on Postgres
- Drop or replace indexes on churny columns: a partial index on active rows, or move \`status\` history to an append-only table.
- \`fillfactor = 80–90\` on the hot table so non-indexed updates stay HOT.
- Replica analytics: \`hot_standby_feedback\` or \`max_standby_streaming_delay\`, or a dedicated analytics replica fed by **logical replication** (Postgres 10+). Logical replication also makes major-version upgrades possible, which was another of Uber's 9.2-era complaints.
- Connections: PgBouncer in transaction mode, which Uber also used.

### The case against migrating
- InnoDB pays a **second B-tree traversal on every secondary lookup**. If our analytics and APIs read mostly through secondaries, we'd pay that everywhere, and Winand argued it is not a "slight" cost.
- A 3 TB migration takes months: dual-write, backfill, verification, rewriting queries, and losing Postgres features (partial indexes, rich types).

### Verdict
Run the HOT and WAL measurement for a week. If removing 2–3 indexes and tuning fillfactor brings write amplification down, stay. Migrate only if the workload is mostly update-heavy key lookups, and even then, consider that Uber also changed its *data model* (Schemaless), not just the engine.`,
      followUps: [
        {
          q: 'HOT percentage is 3%. Removing the status index isn\'t possible because the dispatcher queries by status. What now?',
          a: 'Make the query cheaper to index. Use a **partial index** `WHERE status IN (...)` on the small active set, so most status changes (into terminal states) leave it. Alternatively, move dispatch state into a separate narrow table (`trip_id, status`) with one index, so updates there don\'t touch the wide table\'s 9 indexes. Then recheck the HOT ratio and WAL rate.',
        },
        {
          q: 'What does logical replication change about Uber\'s "can\'t upgrade" complaint?',
          a: 'Physical WAL streaming requires identical major versions, so Uber faced hours of downtime for a `pg_upgrade`. With logical replication (Postgres 10+), you stream row changes from an old-version primary to a new-version cluster, let it catch up, then switch over in seconds to minutes. Caveats: DDL isn\'t replicated, sequences need syncing, and tables need a replica identity (PK).',
        },
      ],
      pitfalls: [
        '"MySQL is faster" without naming a mechanism',
        'Not knowing HOT exists, or claiming it always applies',
        'Ignoring the InnoDB secondary-lookup cost',
      ],
    },
    {
      id: 'prod-dissections-iq-04',
      difficulty: 'hard',
      question:
        'You run the backend of a fantasy-sports app. Team selection locks at the toss, so roughly 60% of the day\'s active users hit "create team" and "join contest" in the 20 minutes before a 7:30 PM IST IPL match. Last season the HPA lagged and you served 503s for 9 minutes. How do you prepare for the final?',
      context: 'The interviewer expects you to reference how Hotstar handles cricket peaks (AWS re:Invent 2019 talk).',
      whatInterviewerLooksFor: [
        'Treats a scheduled peak as a capacity-planning problem, not an autoscaling problem',
        'Does the arithmetic on reaction time vs arrival rate',
        'Defines a degradation order in advance (panic mode)',
        'Covers stateful bottlenecks (DB, cache, payment provider), not just pods',
        'Load tests and rehearses',
      ],
      modelAnswer: `### Why autoscaling failed
Hotstar's numbers make the point: concurrency can grow **1 M+ users per minute** against a **~90 s** reaction window and about **a minute** of boot. HPA detection (30–60 s) + node provisioning (1–3 min) + pod start and warm-up is longer than the ramp. Hotstar also hit **insufficient-capacity** errors and **one-instance-type-per-ASG** limits.

### Plan
1. **Forecast** from last season's peak for the same fixture tier, × growth, × 1.3 headroom.
2. **Pre-warm by schedule** at T-60 min: node groups, pods (\`minReplicas\` raised by a CronJob), **DB connection pools**, the Redis cluster, and CDN cache for static contest data. Pre-request capacity from the cloud provider for big events, across several instance types.
3. **Ladders:** fixed capacity rungs per concurrency band. Live scaling only moves *up* from the pre-warmed floor during the match window.
4. **Stateful tier:** "join contest" is a write hot spot (contest seat counts). Use Redis atomic counters with an async ledger write to Postgres, and an idempotency key per join.
5. **Panic mode (written beforehand):** shed in order: leaderboards refresh rate → recommendations → player-stat widgets → new-contest discovery. **Never shed** team lock, contest join, or payments. Hotstar sheds recommendations and personalisation to protect playback and payments.
6. **Admission control:** a token-bucket virtual queue at the edge when the DB rung is saturated, with honest "you're in queue" UX instead of 503s.
7. **Rehearse:** a load test at 1.5× forecast (Hotstar's Project HULK used 8 regions), plus chaos tests for delayed scale-up and a push-notification spike.

### Success criteria
p99 < 300 ms for join; zero 5xx on the lock path; panic-mode flags toggled in a drill within 30 s.`,
      followUps: [
        {
          q: 'Marketing sends a push notification to 40M users at 7:25 PM. What does that do to your plan?',
          a: 'A push is a synthetic tsunami: open rates spike within seconds and arrive faster than any organic ramp. Hotstar included push notifications in its chaos tests for this reason. Mitigate by staggering the send (e.g. 4M every 30 s), excluding users who already have a team, pointing the deep link at a cacheable page, and getting the send time approved against the capacity plan.',
        },
        {
          q: 'Pre-warming costs ₹ lakhs per match. How do you justify or reduce it?',
          a: 'Price the alternative: 9 minutes of 503s at peak, times contest entry revenue per minute, plus refunds and churn. Reduce cost by pre-warming only the critical path, scaling down quickly after the lock (the curve collapses at the toss), using spot capacity for stateless non-critical tiers, and tightening the forecast with past-season data per fixture tier.',
        },
      ],
      pitfalls: [
        'Relying on HPA with a lower CPU target',
        'Scaling pods without scaling DB connections and cache',
        'Deciding what to degrade during the incident',
      ],
    },
    {
      id: 'prod-dissections-iq-05',
      difficulty: 'expert',
      question:
        'You\'re in the war room at 7:05 AM on the first working Monday of January. Message-send success has dropped from 99.999% to 99%, your Grafana and alerting are timing out, and a rollback of today\'s deploys changed nothing. Run the incident.',
      context: 'Mirrors Slack\'s 4 January 2021 outage as described by Slack Engineering.',
      whatInterviewerLooksFor: [
        'Notices the observability outage as a clue (shared dependency) rather than a nuisance',
        'Recognises demand shape: post-holiday return plus cold client caches',
        'Spots autoscaling oscillation and stops it',
        'Protects the scale-up path (provisioning, quotas, fd limits)',
        'Engages the cloud provider early',
      ],
      modelAnswer: `### Read the clues
- **A rollback did nothing**, so this is unlikely to be our code. Think capacity, network, or a dependency.
- **Dashboards are down at the same time**, so look for a dependency the app and monitoring share: a network path, DNS, or a transit gateway. Slack's monitoring sat behind the same Transit Gateways as the app.
- **Calendar:** first Monday after the holidays, with **cold client caches**, so every client does a full sync. Demand is launch-sized, not Monday-sized.

### Actions, in order
1. **Fall back to provider and external signals:** cloud-provider metrics, an external synthetic monitor (which is what paged Slack), VPC flow logs. Open a **severity-1 case with AWS now**. In Slack's case only AWS could see and fix the TGW packet drops.
2. **Freeze autoscaling decisions.** Packet loss makes threads wait, so CPU *falls* and a CPU-based policy scales *down*. Then thread saturation triggers a giant scale-up (Slack's tried to add **1,200 servers** in 14 minutes). Disable scale-down and cap scale-up at what provisioning can absorb.
3. **Protect the provisioning path.** Slack's provision-service hit the **Linux open-files limit** and an **AWS quota**. Raise \`ulimit\`, request quota increases, and stagger launches.
4. **Shed and smooth demand:** load-balancer panic mode, server-driven client back-off (\`Retry-After\`), deferring non-essential sync (emoji packs, full history) so cold clients hydrate gradually.
5. **Comms:** an honest status update every 30 minutes.

### Afterwards
- Request pre-emptive capacity (Slack did, for TGWs) before known high-demand days.
- Move monitoring off the shared path (Slack moved it into the same VPC as its databases).
- Scale on saturation, not CPU.
- Load-test provisioning.`,
      followUps: [
        {
          q: 'Why exactly does CPU-based autoscaling make a network problem worse?',
          a: 'When packets drop, requests spend their time waiting on retransmits and backend responses, not computing, so CPU per instance drops. The autoscaler reads that as over-provisioning and removes hosts, which concentrates load on the rest. Then worker threads fill up, a second policy fires, and you get a burst of new instances that hits provisioning limits. Scale on worker/thread saturation or in-flight requests, and cap scale-down velocity.',
        },
        {
          q: 'How would you design the client so a post-holiday cold start doesn\'t look like a launch?',
          a: 'Make the cold boot cheap and staged: fetch a minimal boot payload (current channel, unread counts) first, then lazy-load history and assets on demand, with server-provided back-off hints. Use delta sync with a version vector so a two-week-old cache syncs deltas instead of a full reload. Add jitter to reconnects, and let the server give a "come back in N seconds" token to non-active tabs.',
        },
      ],
      pitfalls: [
        'Spending 30 minutes on application logs because "it must be our code"',
        'Leaving autoscaling running while it oscillates',
        'Not opening a provider ticket for a managed component you can\'t see into',
      ],
    },
    {
      id: 'prod-dissections-iq-06',
      difficulty: 'expert',
      question:
        'Your API returns 5xx in waves: bad for about five minutes, fine for five, bad again, for over an hour. Your status page, hosted with a different vendor, also just went down, and half the war room is convinced it\'s a DDoS. What is your reasoning, step by step?',
      context: 'Based on Cloudflare\'s 18 November 2025 outage write-up.',
      whatInterviewerLooksFor: [
        'Treats periodicity as a signal and correlates it with scheduled jobs and config pushes',
        'Avoids anchoring on the attack theory; uses traffic evidence to test it',
        'Checks recent changes outside the deploy pipeline (DB permissions, generated artifacts)',
        'Knows the remedy is stopping the producer and pinning last-known-good',
      ],
      modelAnswer: `### 1. Test the DDoS theory with data, quickly
A DDoS shows up as request volume, new source ASNs, or connection rates going up *before* the errors. If ingress volume is flat and the errors are **panics or exceptions inside our own process**, it's internal. A coincidence like the status page going down feels like evidence, but it isn't. Cloudflare's team was misled by exactly this.

### 2. Periodicity = something scheduled
A clean ~5-minute rhythm points to a **cron, poller, or config regeneration**. List everything that runs on that period. At Cloudflare it was the **Bot Management feature file, rebuilt every five minutes** from a ClickHouse query.

### 3. Why good, then bad, then good?
The generator's output must depend on **which node or replica** it reads from. At Cloudflare, ClickHouse was being updated **gradually**, so runs on updated nodes produced a bad file and runs on the rest produced a good one. Once every node was updated, it stayed broken.

### 4. What changed (beyond deploys)?
Database grants and permissions, schema, feature flags, upstream data. At Cloudflare, a **permission change** made a metadata query (no \`database\` filter) return duplicate rows, so the file **doubled**, crossed a **200-feature** limit, and the proxy **panicked on \`unwrap()\`**.

### 5. Mitigate
- **Stop the producer** (freeze generation and propagation).
- **Push a known-good artifact** and pin it.
- Restart consumers that are stuck in a crash loop.
- Bypass the affected module where possible (Cloudflare moved Workers KV and Access off the core proxy).

### 6. Fix properly
- Validate generated config at the producer *and* the consumer.
- Consumers keep the last-known-good file on rejection.
- Add per-feature kill switches.
- Make sure error reporting can't exhaust CPU during the incident.`,
      followUps: [
        {
          q: 'Which signal on your dashboards would have pointed at the feature file within ten minutes?',
          a: 'The version/hash of the config each proxy currently runs, plotted against the error rate. Error waves would line up with file version changes. Also: the size or row count of each generated artifact (a 2× jump is an obvious anomaly), and the panic or crash count tagged by module. Emit these as metrics at load time; without them you are guessing from symptoms.',
        },
        {
          q: 'The consumer has a hard limit of 200 entries for memory preallocation. Should it truncate to 200 instead of failing?',
          a: 'Not silently. Truncation changes behaviour in ways you can\'t predict: which 200 features survive? Better: reject the whole candidate, keep serving last-known-good, and alert loudly. The limit is a sanity bound, so a file that exceeds it is evidence of a producer bug. Only if there is no previous good version (cold start) fall back to a bundled default file and flag degraded mode.',
        },
      ],
      pitfalls: [
        'Starting WAF and IP blocking without checking ingress volume',
        'Assuming no deploy means no change',
        'Rolling back code while the bad config keeps regenerating',
      ],
    },
    {
      id: 'prod-dissections-iq-07',
      difficulty: 'expert',
      question:
        'Design the automation that applies weighted load-balancer IP sets to a regional DNS name, with one applier per AZ for resilience, so that a delayed applier can never overwrite a newer plan or leave the record empty. Then: the DNS is fixed, but your control plane that depends on it is drowning in a backlog of retried work. What do you do?',
      context: 'Grounded in AWS\'s post-event summary of the 19–20 October 2025 DynamoDB disruption in us-east-1.',
      whatInterviewerLooksFor: [
        'Identifies the TOCTOU: freshness checked at start, write applied much later',
        'Uses conditional writes / generation numbers and protects the live version from GC',
        'Adds invariants (never empty, bounded change size) and a halt-and-page mode',
        'Recognises congestive collapse and applies admission control rather than more retries',
      ],
      modelAnswer: `### What went wrong at AWS
An Enactor checked "my plan is newer than live" **at the start**, then retried slowly. Meanwhile another Enactor applied a much newer plan and ran **cleanup**, deleting old plans. The slow one then wrote its stale plan, cleanup deleted that plan, and \`dynamodb.us-east-1.amazonaws.com\` was left with **no IPs**, in a state the automation couldn't repair.

### Design
1. **Monotonic generations** from the planner.
2. **Apply = conditional write:** "set live to plan G only if live.generation < G", evaluated by the store at write time (a DynamoDB condition expression, an etcd transaction, or a version field on the record set). The check and the write happen in one atomic step.
3. **Invariants enforced in the applier:** never apply an empty set; never remove more than X% of capacity in one change; never apply a plan older than N minutes.
4. **GC protects the live plan** and the last K plans, and runs as a separate actor that reads \`live.generation\` itself.
5. **Halt, don't guess.** On any invariant violation or inconsistent state, freeze the automation and page a human, with a runbook to restore the last-known-good set.
6. **Observe:** live generation per applier, apply latency, and alerts when an applier is more than N generations behind.

### Backlog after recovery
AWS's DWFM had to re-establish leases on a huge fleet at once. Work timed out and was retried faster than it completed: **congestive collapse**. The response:
- **Throttle incoming work** (AWS throttled and restarted DWFM hosts, then added queue-size-based throttling).
- **Prioritise:** renew existing leases before accepting new launches.
- **Shed retries:** jittered exponential back-off, retry budgets, and drop requests whose callers have already timed out.
- **Release throttles gradually** (AWS relaxed them over hours).
- Rate-limit any health-check-driven capacity removal, to avoid NLB-style flapping.`,
      followUps: [
        {
          q: 'Why not just use a distributed lock so only one applier runs at a time?',
          a: 'A lock doesn\'t save you from a paused holder: a GC or network pause past the lease lets a second applier in while the first still believes it holds the lock, so its late write lands anyway. You need the store to reject stale writes, either with a fencing token or a conditional write on the generation. Once you have that, the lock is optional, and dropping it keeps the per-AZ independence the design wanted.',
        },
        {
          q: 'How do you test for this race before production?',
          a: 'Deterministic simulation: run the planner, three appliers and GC in a single-threaded scheduler that explores interleavings (or use Jepsen-style fault injection with long pauses in one applier). Assert invariants after every step: live is never empty and live.generation never decreases. Add a property test where one applier is delayed by up to 10 minutes of planner progress.',
        },
      ],
      pitfalls: [
        'Re-checking freshness more often instead of making the write conditional',
        'Letting cleanup delete without consulting the live pointer',
        'Answering the backlog with more workers and retries',
      ],
    },
    {
      id: 'prod-dissections-iq-08',
      difficulty: 'hard',
      question:
        'Your network team wants a single command that drains backbone links to measure spare capacity, run from the same automation that manages production. After reading Meta\'s October 2021 write-up, what guardrails do you require, and how do you make sure you can still recover if it goes wrong anyway?',
      whatInterviewerLooksFor: [
        'Blast-radius limits in the tool (refuse if > X% of links), not just in an audit step',
        'Treats the audit tool as production code with its own tests',
        'Out-of-band access and break-glass credentials independent of the production network',
        'Fail-static health logic (don\'t withdraw everything)',
        'Staged recovery with power and cache awareness',
      ],
      modelAnswer: `### What happened at Meta
A capacity-assessment command **took down every backbone connection**. The **audit tool** meant to block such commands **had a bug**. The edge DNS servers then lost reach to the data centres and **withdrew their BGP routes** by design, so the names stopped resolving everywhere. Remote tools were down too, so engineers had to go on site, and physical security slowed them down. Cloudflare's data puts the darkness at about **5.5 hours**.

### Guardrails before execution
1. **Blast-radius computation in the tool itself:** simulate the command against the topology and **refuse** if it drains more than, say, 5% of capacity or isolates any site. The audit should be a second, independent check, not the only one.
2. **Test the auditor** with known-bad commands in CI, and alert if it is ever bypassed.
3. **Staged execution:** one link group, observe, continue. Use a dead-man switch (JunOS-style \`commit confirmed\`) that auto-reverts unless a human confirms within N minutes.
4. **Change windows** with a named owner on call and a rollback rehearsed in staging.

### Design for "it went wrong anyway"
- **Out-of-band management network** (separate circuits, even LTE) and **break-glass credentials** that don't depend on production identity or DNS.
- **Fail-static health logic:** if most sites look unhealthy at once, the detector or a shared dependency is the likelier failure, so keep announcing. Withdraw only when it's local.
- **Physical access runbooks** pre-approved for emergencies.
- **Staged traffic restoration.** Meta saw power swings of tens of megawatts and was wary of cold caches. Bring regions back gradually.
- **Storm drills** covering the backbone. Meta's drills helped, but it had never simulated a global backbone outage.`,
      followUps: [
        {
          q: 'The DNS withdrawal logic is a feature: it moves users away from a sick site. How do you keep that benefit without the global failure mode?',
          a: 'Make withdrawal a local decision with a global floor. A site withdraws only if its own backends are unreachable *and* enough peer sites are healthy to absorb its traffic, for example at least 50% of the fleet. If most sites report unhealthy at once, assume the shared dependency (backbone, health-check service) is broken and fail static: keep announcing and page humans. Also rate-limit withdrawals, e.g. at most N sites per minute.',
        },
        {
          q: 'How would your NestJS mobile backend\'s clients behave during such a DNS blackout, and what would you change?',
          a: 'Clients see DNS failures and retry, often in tight loops: Cloudflare reported resolvers worldwide at 30× normal query volume. Add exponential back-off with jitter on resolution and connection failures, cap retries, and cache the last-known-good config. Prefer a server-sent "retry after" hint whenever you can still reach any endpoint, so recovery doesn\'t come with a thundering herd.',
        },
      ],
      pitfalls: [
        'Trusting the audit step as the only guardrail',
        'Keeping management access dependent on the production network',
        'Restoring all traffic at once',
      ],
    },
    {
      id: 'prod-dissections-iq-09',
      difficulty: 'hard',
      question:
        'Our B2B SaaS runs on one RDS Postgres: 9 TB, the largest instance class, autovacuum falling behind on two multi-TB tables, IOPS near the limit. Walk me through how you would scale it, and cite what Figma and Notion actually did where it helps.',
      whatInterviewerLooksFor: [
        'Exhausts cheaper levers first (vertical partitioning, replicas, caching)',
        'Chooses the shard key from tenancy and query shape; uses colos',
        'Uses many logical shards mapped to fewer hosts',
        'Has a reversible migration with verification',
        'Is explicit about lost features (cross-shard transactions, global IDs)',
      ],
      modelAnswer: `### Step 0: confirm the cause
Is it vacuum falling behind (dead tuples, \`age(datfrozenxid)\` climbing toward wraparound) or IOPS? Notion's trigger was **VACUUM stalling** plus **TXID wraparound** risk. Figma's was multi-TB tables, vacuum reliability problems, and **RDS IOPS limits**.

### Step 1: cheap levers
- **Vertical partitioning:** move independent table groups (audit logs, notifications, analytics events) to their own databases. Figma had about a dozen of these before it sharded anything.
- Read replicas and caching for read-heavy paths; partitioning by time for append-only tables (dropping a partition replaces DELETE and vacuum work).

### Step 2: horizontal sharding, if single tables still dominate
- **Shard key = tenant** (workspace or org ID) when nearly every query is tenant-scoped, as at Notion. Where there are several natural keys, group tables into **colos** by key (Figma: UserID, FileID, OrgID), so most transactions stay within one shard.
- **Hash the key.** Sequential or time-ordered IDs create hotspots, which is why Figma hashed.
- **Many logical, few physical:** Notion used **480 logical shards** (each a schema) on **32 hosts**. 480 has many divisors, so adding hosts means moving whole schemas.

### Step 3: migrate reversibly
- **Figma:** logical sharding via **views** first, so production queries prove routable while rollback is a config flag. Then the physical split, with about 10 s of partial primary unavailability.
- **Notion:** double-write (an audit log plus a catch-up script), backfill (about 3 days on 96 CPUs), **dark-read verification**, then a 5-minute switch-over.

### What you give up
Cross-shard transactions (Figma doesn't support them), global uniqueness (you need an ID scheme), cross-tenant queries (go to a warehouse), and sharded schema changes. A query-aware proxy (Figma's DBProxy, or Citus/Vitess-like tools) handles routing and scatter-gather.

### Alternatives
NewSQL (CockroachDB, Spanner) or Citus. Figma rejected these mainly because of migration risk and limited runway. Revisit them with your own team's constraints.`,
      followUps: [
        {
          q: 'One enterprise tenant is 18% of all data and traffic. Your shard key is tenant ID. What now?',
          a: 'Tenant-keyed sharding puts that whale on one shard. Options: give it a dedicated physical host (logical-to-physical mapping makes this a placement choice), or sub-shard it by a second key (project_id within the tenant), accepting that tenant-wide queries become scatter-gather inside that tenant\'s shard set. Decide using its actual access pattern, and keep per-tenant rate limits so it can\'t starve co-located tenants.',
        },
        {
          q: 'Why might views-first logical sharding catch problems that a staging test would miss?',
          a: 'Production traffic includes the long tail of queries: admin tools, cron jobs, ad-hoc reports, ORM-generated joins. Many of these lack a shard key or join across colos. Routing real traffic through shard-scoped views while the data still sits on one host turns each of those into a visible error or proxy log, while rollback is still a config change, before a physical split would turn them into wrong answers.',
        },
      ],
      pitfalls: [
        'Sharding before trying vertical partitioning and time partitioning',
        'Picking created_at or an auto-increment ID as a raw shard key',
        'Promising cross-shard transactions "with 2PC" without discussing the cost',
      ],
    },
    {
      id: 'prod-dissections-iq-10',
      difficulty: 'hard',
      question:
        'You need to add a NOT NULL column with a default and a new composite index to a 1.5 TB, 20K-writes/s MySQL orders table, with no downtime and replicas that serve reads. A teammate proposes pt-online-schema-change. Explain how you\'d run it, why GitHub built gh-ost instead, and exactly how you\'d control the cut-over.',
      whatInterviewerLooksFor: [
        'Knows the trigger-based failure modes (lock contention, no true pause, trigger removal stalls)',
        'Explains binlog-based copying and serialised writes',
        'Throttles on replica lag and load; postpones cut-over',
        'Tests on a replica and verifies with checksums',
      ],
      modelAnswer: `### Why not triggers at 20K writes/s
GitHub listed the problems with trigger-based tools:
- Triggers add **interpreted work to every write**.
- They **compete for locks** on the shadow table, which caused "near or complete lock downs".
- **Dropping them** at the end stalled a busy table for many seconds, up to a minute.
- You **can't truly pause**, because the triggers must keep firing or you lose changes. On a busy primary, the trigger load alone can take it down.

### gh-ost plan
1. **Rehearse** on a dedicated replica with \`--test-on-replica\`: it swaps and swaps back, then checksum both tables. GitHub ran continuous no-op migrations to keep confidence in the tool.
2. **Run** against a replica (\`--host=replica\`). gh-ost creates the ghost table with the new column and index, copies rows in chunks, and **tails the row-based binlog** to replay concurrent changes. Copy and replay writes are serialised, so the primary sees one sequential writer.
3. **Throttle:** \`--max-lag-millis=1500\` on read replicas via \`--throttle-control-replicas\`, \`--max-load=Threads_running=30\`, and \`--critical-load\` to abort. Adjust \`chunk-size\` live over the socket and pause with \`throttle\` during the evening peak.
4. **Postpone cut-over** with \`--postpone-cut-over-flag-file\`. The tables stay in sync until you remove the flag at 03:00 IST, with the on-call ready and a dashboard of lock waits up.
5. **Verify** row counts and checksums on a sample, and keep the old table for 24 hours before dropping it (drop it in chunks or during a quiet window, because dropping a 1.5 TB table can stall too).

### Watch-outs
- Requires **ROW binlog format** (or a replica converting from statement-based).
- Foreign keys aren't supported by gh-ost.
- The new index makes every replayed write more expensive, so expect a slower copy.
- Disk: you need room for a second copy of the table plus binlogs.`,
      followUps: [
        {
          q: 'Halfway through, replica lag hits 40 s and won\'t recover even while gh-ost is throttled. What\'s going on?',
          a: 'If gh-ost is throttled, its own writes have stopped, so the lag comes from something else: an application batch job, a long transaction on the replica blocking the SQL thread, or the replica being under-provisioned for the base write rate. Check `SHOW PROCESSLIST` and the replica\'s IO and SQL thread states. gh-ost is the usual suspect, but throttling it would have fixed lag it caused.',
        },
        {
          q: 'What is actually risky about the cut-over moment, even with gh-ost?',
          a: 'The swap needs a brief metadata lock on the original table. If a long-running transaction holds a conflicting lock, the rename waits, and every new query on the table queues behind it, which can stall the app within seconds. gh-ost bounds this with a lock timeout and retries, but you should still cut over at low traffic, kill long transactions beforehand, and watch lock waits live.',
        },
      ],
      pitfalls: [
        'Running a plain ALTER and hoping it is "online"',
        'No throttle on replica lag, so read replicas serve stale data',
        'Letting cut-over happen automatically at peak',
      ],
    },
    {
      id: 'prod-dissections-iq-11',
      difficulty: 'medium',
      question:
        'An interviewer at a Bengaluru product company says: "Tell me about a real production outage at another company that you\'ve studied, and what it changed about how you build systems." Pick one and answer as you would in the room.',
      whatInterviewerLooksFor: [
        'Accurate facts with one or two real numbers, sourced',
        'Clear mechanism, not just a headline',
        'A personal, concrete practice change tied to their own stack',
        'Concise (about 90 seconds), then invites depth',
      ],
      modelAnswer: `### Structure (about 90 seconds)
**Context, trigger, mechanism, decision, what they changed, what I changed.**

### Example answer (Cloudflare, 2 July 2019)
"One I've studied closely is Cloudflare's July 2019 outage.

**Context:** their WAF rules are pushed globally in seconds through Quicksilver, and rule changes were allowed to skip staged rollout so they could respond to attacks quickly.

**Trigger:** an engineer shipped a minor XSS rule. Its regex contained \`.*(?:.*=.*)\`, which backtracks catastrophically on non-matching input. Even in 'simulate' mode the rule executed, so the HTTP-serving CPUs went to nearly 100% worldwide, and the outage lasted **27 minutes** until they used a global kill switch for the WAF.

**Contributing factor:** a CPU-protection guard that would have bounded it had been removed earlier.

**What they changed:** moving to linear-time engines (re2 or Rust's regex), staged rollout for rules, profiling every rule in CI, and a manual audit of all **3,868** managed rules.

**What it changed for me:** in our NestJS services I treat regexes on request input as a P1 risk, because a single ReDoS blocks the event loop for every request on that pod. We cap input length before validation, lint for nested quantifiers, run admin-defined patterns through RE2, and canary config changes like code: 1%, then 10%, then 100%, with an automatic kill switch."

### Then offer depth
"I can go into why that pattern backtracks, or how I'd design the rollout pipeline."`,
      followUps: [
        {
          q: 'Why does ".*(?:.*=.*)" blow up, in one minute, on a whiteboard?',
          a: 'Take input with no `=`. The first `.*` grabs everything, then the engine needs `=`, fails, and backtracks one character. The inner `.*` then tries every length, then the next `.*`, and so on. Each extra `.*` that can match the same characters multiplies the number of split points tried, and an unanchored search repeats this from every starting position. A linear-time engine (re2) tracks all possible states at once instead of backtracking.',
        },
        {
          q: 'If you had been the on-call engineer at 13:45 that day, what would you have done first?',
          a: 'Correlate the global CPU spike with the most recent global push (the WAF rule deploy at 13:42) and pull the biggest lever available: the global WAF kill switch. Cloudflare found the cause at 14:00 and executed the kill switch at 14:07. The lesson is to make the kill switch reachable even when internal tools are degraded, since impaired access delayed it, and to have a "revert the last global config push" button.',
        },
      ],
      pitfalls: [
        'Invented numbers or the wrong year',
        'Only the headline ("a regex took down Cloudflare") without the mechanism',
        'No personal practice change',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'prod-dissections-boe-1',
      question:
        'A team-chat app has 3M daily active desktop clients. After a two-week holiday (or after you flush the shared cache during a Redis migration), everyone reconnects between 9:00 and 9:30 AM IST with a cold local cache. Estimate the API and database load of this "cold Monday" against a normal warm Monday morning, and say what you would pre-scale.',
      assumptions: [
        'Warm reconnect: 3 API calls, about 40 KB of delta sync per client',
        'Cold boot: 25 API calls (channels, members, history pages, emoji, prefs), about 2 MB per client',
        'On a warm Monday, 3M clients spread over 2 hours; on a cold Monday, 70% arrive in the 30-minute window (holiday-return compression)',
        'Server-side cache hit ratio: 95% warm, 60% while the server cache is also cold for the first 15 minutes',
        'Arrivals inside the window: peak 1-minute rate = 2× the window average',
      ],
      steps: [
        { label: 'Warm Monday API rate', calc: '3M × 3 calls ÷ 7,200 s ≈ 1,250 RPS average; ×2 peak ≈ 2,500 RPS' },
        { label: 'Cold Monday arrivals', calc: '0.7 × 3M = 2.1M clients ÷ 1,800 s ≈ 1,170 clients/s; peak ≈ 2,330 clients/s' },
        { label: 'Cold Monday API rate', calc: '2,330 clients/s × 25 calls ≈ 58,000 RPS peak, i.e. about 23× the warm peak' },
        { label: 'DB reads, warm', calc: '2,500 RPS × 5% miss ≈ 125 QPS' },
        { label: 'DB reads, cold', calc: '58,000 RPS × 40% miss ≈ 23,000 QPS, about 185× warm' },
        { label: 'Egress bandwidth', calc: '2,330 clients/s × 2 MB ≈ 4.7 GB/s ≈ 37 Gbps at peak (vs 2,500/3 × 40 KB ≈ 33 MB/s warm)' },
      ],
      answer:
        'A cold Monday peaks around 58K RPS at the API (about 23× normal), about 23K QPS of database reads (about 185× normal, because a cold cache stacks on the arrival burst), and roughly 37 Gbps of egress. Slack\'s 4 January 2021 outage had this exact demand shape: the first Monday after the holidays, with cold client caches.',
      insight:
        'The database is the multiplier, not the API tier. Pre-warm the server cache (replay the top keys) before 9:00, raise pod and network capacity (including managed gateways; Slack later requested pre-emptive Transit Gateway scaling), and shrink the cold boot itself: lazy-load history, defer emoji and prefs, and let the server tell clients to back off. Cutting cold boot from 25 calls to 8 matters more than doubling the pods.',
      followUps: [
        {
          q: 'You can only afford to pre-warm one thing. Server cache or more pods?',
          a: 'The server cache. With a 95% hit ratio the database sees about 58K × 5% ≈ 2.9K QPS instead of 23K, an 8× drop, which most Postgres or replica fleets can absorb. Extra pods without a warm cache just send more misses to the database faster. Warm it by replaying the previous Friday\'s top-N keys or by dark-reading traffic from a canary before the window opens.',
        },
        {
          q: 'If you add server-driven jitter that spreads cold boots over 60 minutes instead of 30, what happens to the peak?',
          a: 'The arrival rate halves to about 1,170 clients/s at peak, so roughly 29K RPS and about 12K QPS of cold-cache database reads. And because the cache warms during the first 15 minutes, a larger share of later arrivals hit a warm cache, so the real reduction is more than 2×. Spreading demand is often cheaper than buying capacity.',
        },
      ],
    },
    {
      id: 'prod-dissections-boe-2',
      question:
        'Your MySQL cluster diverged after an unsafe cross-region failover (GitHub 2018 style). You must rebuild the home-region primary from backups held in object storage: a 6 TB full backup taken every 4 hours, plus binlogs since. Estimate the time to a caught-up primary, and the biggest lever for cutting it.',
      assumptions: [
        'Backup compressed 3:1, so 2 TB to download',
        'Object storage download: 1 GB/s sustained to one host (parallel range GETs)',
        'Decompress plus prepare (xtrabackup-style): 400 MB/s of uncompressed data',
        'Worst case: the backup is 4 h old; the write rate was 12 MB/s of binlog',
        'Binlog apply on the restored host: 3× faster than real time with parallel replication',
      ],
      steps: [
        { label: 'Download', calc: '2 TB ÷ 1 GB/s = 2,000 s ≈ 33 min' },
        { label: 'Decompress + prepare', calc: '6 TB ÷ 400 MB/s = 15,000 s ≈ 4.2 h' },
        { label: 'Binlog to replay', calc: '4 h × 3,600 × 12 MB/s ≈ 173 GB; plus writes that arrive during the 4.75 h restore (≈ 205 GB) → ~378 GB backlog' },
        { label: 'Catch-up time', calc: 'Apply 36 MB/s − arrival 12 MB/s = 24 MB/s net → 378 GB ÷ 24 MB/s ≈ 15,750 s ≈ 4.4 h (it converges only because apply > arrival)' },
        { label: 'Total', calc: '0.55 + 4.2 + 4.4 ≈ 9.2 h per cluster, before verification and re-seeding replicas' },
      ],
      answer:
        'About 9 hours per cluster to a caught-up primary, dominated by decompress/prepare (around 4 h) and binlog catch-up (around 4.4 h), not by the download. That fits the "hours" GitHub reported. Its East Coast restores began at 00:05 and several clusters finished around 06:51.',
      insight:
        'RTO for "restore from backup" is a number you must measure, not assume. The biggest lever is skipping the off-site path: clone from a healthy in-region replica or a local snapshot, which GitHub ended up doing by restoring from the West Coast. Next: more frequent backups (shorter binlog tail), parallel prepare on bigger hosts, and per-cluster priority so the most critical clusters come back first.',
      followUps: [
        {
          q: 'Backups move to every 1 hour instead of every 4. How much does the RTO change?',
          a: 'The worst-case binlog tail drops from about 173 GB to about 43 GB, so the backlog is about 248 GB. At 24 MB/s net apply, catch-up falls from about 4.4 h to about 2.9 h, and the total from about 9.2 h to about 7.6 h. A modest gain, because decompress/prepare still dominates. The bigger win is avoiding the full restore by cloning a replica.',
        },
        {
          q: 'You have 20 clusters and restore throughput is shared. How do you schedule them?',
          a: 'Order by criticality and dependency: auth, repositories metadata and billing first; analytics and notifications last. Run in parallel up to the bottleneck (object-storage bandwidth or prepare CPU). If the download is shared at 1 GB/s, parallelism helps only for the CPU-bound prepare stage. Publish per-component status as each cluster returns; GitHub later prioritised component-level status reporting.',
        },
      ],
    },
    {
      id: 'prod-dissections-boe-3',
      question:
        'A streaming app expects 24M concurrent viewers for a cricket final. Concurrency can rise by 1M users per minute after a big moment. Reactive scaling takes 60 s to detect, 120 s to get nodes, and 60 s to boot and warm a pod. Each pod serves 5,000 concurrent viewers at target utilisation. How many pods must be pre-warmed above the current load to survive one surge, and what should the match-start floor be?',
      assumptions: [
        'Surge: +1M users/min, sustained for 5 minutes (a finish or super over)',
        'Reactive lag = 60 + 120 + 60 = 240 s from the start of the surge to new capacity serving',
        'Pods run at 70% utilisation at target, so there is 30% burst headroom before SLO breach',
        'Hotstar\'s re:Invent 2019 talk cites 1M+/min growth and ~90 s reaction time; our 240 s lag is deliberately pessimistic',
      ],
      steps: [
        { label: 'Users arriving during the lag', calc: '1M/min × 4 min = 4M users before any new pod helps' },
        { label: 'Pods needed for them', calc: '4M ÷ 5,000 = 800 pods of spare capacity at target' },
        { label: 'Headroom already present', calc: 'At 16M current load: 16M ÷ 5,000 = 3,200 pods at 70% → burst capacity 3,200 × 5,000 × (0.3/0.7) ≈ 6.9M users' },
        { label: 'Surge vs headroom', calc: '4M ≤ 6.9M, so one surge fits inside the burst headroom; a 5-min surge (5M) also fits, at about 93% utilisation' },
        { label: 'Match-start floor', calc: 'Forecast 24M × 1.3 safety ÷ 5,000 ≈ 6,240 pods pre-warmed before the toss' },
      ],
      answer:
        'Reactive scaling leaves about 4 minutes in which 4M users arrive with no new capacity, so you need around 800 pods of spare capacity at target. Running at 70% already gives about 6.9M users of burst room at 16M load, so one surge survives. Pre-warm a floor of about 6,200 pods to the forecast before the match, and let reactive scaling only add on top.',
      insight:
        'Arrival rate × reaction lag is the number that decides pre-warming. Shrinking the lag (warm node pools, pre-pulled images) or running at lower utilisation buys the same safety. Hotstar\'s answer was to pre-warm before match time and keep panic mode (shedding recommendations and personalisation) for surges beyond plan.',
      followUps: [
        {
          q: 'Finance wants 85% target utilisation instead of 70%. Does one surge still survive?',
          a: 'A pod\'s full capacity is about 7,140 viewers (5,000 ÷ 0.7). At 85%, each carries about 6,070, so 16M users need about 2,635 pods, and burst room is 2,635 × ~1,070 ≈ 2.8M users, which is less than the 4M that arrive during the 4-minute lag. You breach the SLO for roughly the last 1.2M arrivals. Either keep 70%, cut the lag (warm spare nodes cut the 120 s to about 10 s, so about 2.2M arrive in the 130 s lag), or accept panic mode as the planned response.',
        },
        {
          q: 'The surge is driven by a push notification instead: 3M arrive in 60 s. What changes?',
          a: 'Now 3M users arrive in a quarter of the lag window, so reactive scaling contributes nothing. Only pre-existing headroom matters: 6.9M at 70% still covers it, but backends such as auth and entitlement checks see a 3M/min rate spike. Pre-scale those too, or stagger the push in waves. Hotstar treated push notifications as a chaos-test scenario for this reason.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'prod-dissections-mcq-01',
      difficulty: 'expert',
      question:
        'This failover policy runs on Raft-elected topology managers spread across the home region (2 nodes), a DR region (2 nodes), and a cloud region (1 node). After a 43-second link loss between the home hub and the home DC, which behaviour of this code most directly reproduces GitHub\'s October 2018 outcome?',
      code: {
        language: 'typescript',
        title: 'promotion policy',
        code: `function onPrimaryUnreachable(cluster: Cluster, quorumAgrees: boolean) {
  if (!quorumAgrees) return;                 // Raft majority says primary is gone
  const candidates = cluster.replicas
    .filter((r) => r.healthy)
    .sort((a, b) => a.lagBytes - b.lagBytes); // most caught-up first
  promote(candidates[0]);                    // any region
  repointWriters(candidates[0]);
}`,
      },
      options: [
        'It relies on a Raft quorum, which cannot tell a dead primary from a partitioned one',
        'It sorts by replication lag instead of by hardware size, so it may pick an under-provisioned replica',
        'It doesn\'t wait for the old primary to finish its in-flight transactions before promoting',
        'It promotes the most caught-up replica regardless of region, so a short partition can move every write primary across the country',
      ],
      correct: [3],
      explanation:
        'GitHub\'s fix was to stop promoting primaries across regional boundaries. The quorum worked as designed (Orchestrator "behaved as configured"); the problem was that a 43-second partition could move write primaries to the West Coast, where East Coast apps could not tolerate the latency and both sides ended up with writes the other lacked. Quorum is the right tool for agreeing on a decision, though it doesn\'t fence. Sorting by lag is correct. Waiting for in-flight transactions is impossible when the primary is unreachable.',
      followUps: [
        {
          q: 'You add a same-region filter. The entire home region is now genuinely lost. What happens, and is that acceptable?',
          a: 'No candidate passes the filter, so the policy promotes nothing and pages a human. The cross-region failover RTO becomes minutes (human decision plus runbook) instead of seconds. For most businesses that is the right trade, because cross-region promotion changes every app\'s write latency and risks divergence. Make the human path fast: a rehearsed, single-command, audited promotion.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-02',
      difficulty: 'hard',
      question:
        'In GitHub\'s 2018 incident the network recovered within a minute. Why didn\'t GitHub simply point writes back at the original East Coast primaries once connectivity returned?',
      options: [
        'The East Coast primaries had been automatically demoted and their data files deleted by Orchestrator',
        'MySQL cannot switch replication direction without a full restore from backup in any situation',
        'Both sides held writes the other did not have, so failing back would discard the West Coast writes and still leave the unreplicated East tail inconsistent',
        'DNS TTLs for the database endpoints were too long, so clients would keep writing to the West anyway',
      ],
      correct: [2],
      explanation:
        'GitHub states that because both data centres contained writes not present in the other, they could not fail the primary back. The West had taken writes for roughly 40 minutes, and the East held a few seconds that never replicated. Nothing deleted the East data files. MySQL can change replication direction when histories are consistent; the divergence was the obstacle. DNS TTLs were not the issue described.',
      followUps: [
        {
          q: 'If the West had taken writes for only 2 seconds before someone froze it, would failback have been safe?',
          a: 'Safer, but still not clean. Two seconds of West writes plus a few seconds of unreplicated East writes is still two divergent histories. You would capture both binlog tails, fail back to East, and reconcile the West writes there (re-apply the non-conflicting ones, resolve conflicts per entity). Short divergence makes reconciliation smaller; it doesn\'t make it unnecessary.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-03',
      difficulty: 'hard',
      question:
        'During a gh-ost migration of a busy table, the on-call engineer sends `throttle` because the evening peak is starting. What actually happens, and why couldn\'t a trigger-based tool do the same?',
      options: [
        'gh-ost stops writing to the primary entirely (apart from tiny heartbeats) because it owns all migration writes; a trigger-based tool must keep its triggers firing on every application write or lose changes',
        'gh-ost drops its triggers temporarily and re-creates them later, which a trigger-based tool cannot do because it doesn\'t track the binlog',
        'gh-ost switches the binlog to statement-based format to reduce load; trigger-based tools need row-based format',
        'gh-ost pauses the application\'s writes to the table using a metadata lock until the peak passes',
      ],
      correct: [0],
      explanation:
        'gh-ost is triggerless: it copies rows and replays binlog events itself, so when throttled it can suspend all its writes to the primary, keeping only a negligible heartbeat. A trigger-based tool can pause the row copy, but the triggers still fire on every application write, because removing them would lose data. gh-ost never uses triggers, so it has none to drop and re-create. It expects row-based binlogs and doesn\'t change the format. It never blocks application writes with a lock to throttle.',
      followUps: [
        {
          q: 'While throttled for 3 hours, the binlog keeps growing. What does gh-ost need to do when you un-throttle, and what can go wrong?',
          a: 'It resumes tailing from where it stopped and must replay 3 hours of changes for that table into the ghost table before the row copy can usefully continue. Risks: the binlog files are purged before gh-ost reads them (check `binlog_expire_logs_seconds`), and catch-up competes with production load, so keep the lag and load throttles on. If the binlogs were purged, you have to restart the migration.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-04',
      difficulty: 'expert',
      question:
        'You deploy this coalescing data service on 40 pods behind a round-robin Kubernetes Service. During a hot-channel spike, database QPS for that channel drops only slightly. What is the best explanation?',
      code: {
        language: 'typescript',
        title: 'per-pod coalescing',
        code: `const inflight = new Map<string, Promise<Row[]>>();
export function getMessages(channelId: string, before: string) {
  const key = channelId + ':' + before;     // cursor from the client
  if (inflight.has(key)) return inflight.get(key)!;
  const p = db.fetch(channelId, before).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}`,
      },
      options: [
        'Map lookups are too slow under load; a Redis-backed in-flight registry is needed',
        'The `finally` deletes the key before waiting callers receive the result, so every caller re-queries',
        'Coalescing only helps writes; reads must use a cache instead',
        'Identical requests are spread across 40 pods by round-robin, and the client-specific cursor makes keys differ, so few duplicates ever meet in the same map',
      ],
      correct: [3],
      explanation:
        'Coalescing only works when duplicates land on the same instance with the same key. Discord routes by channel_id with consistent hashing for exactly this reason. Round-robin cuts the chance of a match by up to 40×, and a per-client cursor fragments the key further (normalise it, e.g. to "latest page"). Map lookups are nanoseconds. Callers already hold the promise, so deleting the key in `finally` doesn\'t affect them. Coalescing is mainly a read optimisation.',
      followUps: [
        {
          q: 'You switch to hash-by-channel routing and one pod now melts during the spike. What next?',
          a: 'Key affinity concentrates a hot key on one pod. Split the very hottest channels across k virtual nodes (k DB queries instead of N), or add a tiny per-pod read-through cache with a 200–500 ms TTL for the latest page so any pod can serve it, accepting brief staleness. Autoscaling doesn\'t help, because the hash keeps sending that key to one pod.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-05',
      difficulty: 'expert',
      question:
        'Your Cassandra message store (quorum reads/writes, partitions by channel and time bucket) shows p99 spikes on one node during large-server announcements, plus unrelated latency spikes that line up with long JVM pauses. Which measures address these symptoms the way Discord did? Select ALL that apply.',
      options: [
        'Put a data-service layer in front that coalesces identical concurrent reads and routes requests by channel ID',
        'Move to a storage engine without a garbage-collected runtime to remove GC pause tail latency',
        'Switch all reads to consistency ALL so hot partitions are served by every replica',
        'Add more Cassandra nodes until hot partitions disappear, since more nodes spread a single partition',
        'Rebuild the migration tooling for throughput so a storage migration takes days instead of months',
      ],
      correct: [0, 1, 4],
      explanation:
        'Discord added Rust data services with request coalescing and consistent-hash routing by channel_id, moved to ScyllaDB (C++, no GC pauses), and wrote a Rust migrator that brought the estimate from three months to nine days. Consistency ALL makes hot-partition contention worse, since every replica must respond. Adding nodes doesn\'t split a single partition: one (channel, bucket) still lives on the same replica set, and Discord was already at 177 nodes.',
      followUps: [
        {
          q: 'Discord\'s migration stalled at 99.9999%. What caused it, and how would you plan for it in your own migration?',
          a: 'The last few token ranges contained large amounts of uncompacted tombstones, so reading them was extremely slow. Compacting those ranges let the migrator finish. Plan for it: check tombstone counts per range before you start, compact ahead of the migration, and track progress per range so one slow range is visible rather than looking like a 99.9999% mystery.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-06',
      difficulty: 'expert',
      question:
        'Table `trips` has indexes on (id), (rider_id), (status) and fillfactor 90. Which of these updates can be HOT (heap-only tuple, no index writes), assuming the new version fits on the same page? Select ALL that apply.',
      code: {
        language: 'sql',
        title: 'candidate updates',
        code: `-- A
UPDATE trips SET fare_paise = fare_paise + 500 WHERE id = $1;
-- B
UPDATE trips SET status = 'completed' WHERE id = $1;
-- C
UPDATE trips SET notes = 'rider called', last_ping_at = now() WHERE id = $1;
-- D
UPDATE trips SET rider_id = $2 WHERE id = $1;`,
      },
      options: ['A', 'B', 'C', 'D'],
      correct: [0, 2],
      explanation:
        'HOT applies when no indexed column changes and the new tuple version fits on the same heap page; fillfactor 90 leaves room for that. A and C modify only unindexed columns, so they can be HOT. B changes `status`, which is indexed, and D changes `rider_id`, also indexed. Those must insert new entries in every index, which is the write amplification Uber described and why Winand noted HOT wouldn\'t save their workload.',
      followUps: [
        {
          q: 'B runs 400 times a second and the dispatcher needs to find trips by status. How do you stop it hitting every index?',
          a: 'Replace the full `(status)` index with a partial index on the small active set, e.g. `WHERE status IN (\'requested\',\'en_route\')`. Moving into a terminal state still writes index entries, but the index stays tiny. Alternatively, move dispatch state into a narrow side table with one index, so status churn never touches the wide table\'s other indexes. Then check `n_tup_hot_upd` again.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-07',
      difficulty: 'hard',
      question:
        'Analytics queries on your Postgres streaming replica keep getting cancelled with "canceling statement due to conflict with recovery", one of the complaints in Uber\'s 2016 post. You enable `hot_standby_feedback = on`. What trade-off did you just make?',
      options: [
        'The primary will hold back VACUUM on row versions replicas still need, so long replica queries can cause bloat on the primary',
        'Replicas now apply WAL asynchronously, so replication lag can grow without bound',
        'Replica queries now take locks on the primary, slowing primary writes',
        'The replica switches to logical replication and stops replicating DDL',
      ],
      correct: [0],
      explanation:
        'With feedback on, the replica reports its oldest snapshot, and the primary doesn\'t vacuum tuples that snapshot still needs. That stops the cancellations, but long analytics queries now delay cleanup on the primary, causing bloat (the remedy Winand said Uber never mentioned). Lag is controlled by `max_standby_streaming_delay`, a separate setting. No locks are taken on the primary. The replica stays physical.',
      followUps: [
        {
          q: 'Your analytics queries run for 2 hours. Is hot_standby_feedback still the right tool?',
          a: 'Probably not. Holding back vacuum on a busy primary for 2 hours causes significant bloat, and it may push wraparound protection later. Better: feed a dedicated analytics replica via logical replication, or send the data to a warehouse with CDC, so analytics never holds back the OLTP primary. Keep feedback for replicas whose queries finish in seconds.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-08',
      difficulty: 'medium',
      question:
        'For a cricket final, concurrency can rise by over a million users per minute, and Hotstar cites roughly a 90-second reaction window. Which strategy best fits this traffic shape?',
      options: [
        'Lower the autoscaler CPU target from 70% to 40% so it scales earlier',
        'Use serverless functions for all APIs because they scale to zero and back instantly',
        'Pre-warm capacity to the forecast before match time, scale in ladders, and keep pre-decided panic-mode feature switches',
        'Rate-limit every user to one request per second so total load stays within current capacity',
      ],
      correct: [2],
      explanation:
        'Hotstar\'s re:Invent talk describes pre-warming infrastructure before match time, because reactive autoscaling (detection, insufficient-capacity errors, boot time) cannot keep up with 1M+/min, plus panic mode that sheds non-critical features. A lower CPU target still reacts after the fact. Serverless has concurrency limits and cold starts at this scale. Blanket per-user rate limits break normal playback and API patterns without adding capacity.',
      followUps: [
        {
          q: 'Pre-warmed and still overloaded at the super over. What do you switch off first, and what never?',
          a: 'Shed in a pre-agreed order: recommendations and personalisation first (Hotstar\'s choice), then rich features such as high-resolution thumbnails, social widgets, and polling-heavy scorecards. Never touch playback, authentication/entitlement, or payments. Each step should be a feature flag that can be flipped in seconds and that you have drilled before the event.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-09',
      difficulty: 'hard',
      question:
        'Your web tier autoscales on average CPU. A managed network gateway starts dropping 3% of packets. What does the autoscaler most likely do first, as in Slack\'s January 2021 outage?',
      options: [
        'Scales up aggressively, because retransmits raise CPU usage on every instance',
        'Does nothing, because packet loss doesn\'t affect application-level metrics',
        'Marks all instances unhealthy and replaces them in place, keeping the count constant',
        'Scales down, because requests wait on the network instead of computing, so average CPU falls',
      ],
      correct: [3],
      explanation:
        'Slack explains that network problems made threads wait longer, which lowered CPU and triggered downscaling. Then thread utilisation rose and a huge scale-up followed (an attempt to add 1,200 servers). Retransmits cost the kernel little compared with the idle time requests spend waiting. Packet loss clearly affects app metrics such as latency, errors and thread saturation. Health-check replacement did happen at Slack, but the autoscaler\'s first CPU-driven move was down.',
      followUps: [
        {
          q: 'Which scaling signal would not have inverted here, and how would you guard against the scale-up burst?',
          a: 'Worker or thread saturation (busy ÷ total) or in-flight requests per instance. These rise when requests wait, whatever the CPU. Guard the burst by capping scale-up per minute to what provisioning can handle, and load-test that path. Slack\'s provision-service hit the open-files limit and an AWS quota under the 1,200-instance request.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-10',
      difficulty: 'hard',
      question:
        'Reviewing Slack\'s 4 January 2021 outage, which follow-ups would have reduced impact or time to recovery? Select ALL that apply.',
      options: [
        'Running dashboards and alerting so they don\'t depend on the network path that failed',
        'Requesting pre-emptive scaling of the managed gateways before a known post-holiday peak',
        'Load-testing the provisioning service and raising its open-file limits',
        'Lowering client cache TTLs so clients refresh more often over the holidays',
        'Switching from Transit Gateways to public internet routing between VPCs',
      ],
      correct: [0, 1, 2],
      explanation:
        'Slack listed all three: moving monitoring into the same VPC as its databases (off the TGW path), asking for pre-emptive TGW upscaling before the next holiday season, and load-testing provision-service, which had hit the open-files limit. Shorter client cache TTLs would add load all the time and wouldn\'t avoid cold starts after two weeks idle. Routing internal traffic over the public internet trades a capacity problem for security and reliability problems, and nobody proposed it.',
      followUps: [
        {
          q: 'You can\'t see inside a managed gateway. How would you detect it as the bottleneck earlier next time?',
          a: 'Watch the provider metrics that exist (TGW packet-drop counts, bytes and packets per attachment), and compare them with your own per-AZ connection errors and TCP retransmits (node exporter `TcpRetransSegs`). Add synthetic probes that cross the gateway between VPCs. A rise in retransmits alongside flat CPU and normal app error logs points to the network. Open a provider ticket early; AWS saw the drops in its own monitoring.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-11',
      difficulty: 'expert',
      question:
        'All four patterns below are intended to validate a header value of `key=value` pairs separated by `;`. Run on Node\'s backtracking engine against a 50 KB hostile input with no match, which one runs in linear time?',
      code: {
        language: 'javascript',
        title: 'candidates',
        code: `const A = /^(.*=.*;?)*$/;
const B = /^(?:[^=;]+=[^;]*)(?:;[^=;]+=[^;]*)*$/;
const C = /^(?:(\\w|=|;)+)+$/;
const D = /.*(?:.*=.*)/;`,
      },
      options: ['A', 'B', 'C', 'D'],
      correct: [1],
      explanation:
        'B is unambiguous: keys use `[^=;]`, values use `[^;]`, and `;` and `=` are literal separators, so each character has only one way to be matched and failure is detected in linear time. A nests `.*` inside a repeated group (exponential). C nests a `+` inside a `+` (the classic `(a+)+` shape). D is the `.*(?:.*=.*)` construct from Cloudflare\'s 2019 WAF rule, which is super-linear on inputs without a match.',
      followUps: [
        {
          q: 'B is linear. Do you still need a length cap before running it?',
          a: 'Yes. Linear in a 5 MB header is still millions of steps on the event loop for every request, and an attacker controls n. Cap at the HTTP layer (e.g. a header limit of about 8–16 KB) and in the pipe (e.g. 2 KB for this header), so the worst-case cost per request is bounded and small. Linear-time engines remove the blow-up but don\'t remove the cost of length.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-12',
      difficulty: 'medium',
      question:
        'Cloudflare\'s 2019 rule change was deployed in "simulate" (log-only) mode, yet it still took CPUs to nearly 100%. What lesson does that teach about dry-run modes?',
      options: [
        'A dry run that still executes the expensive work protects you from wrong outcomes but not from resource exhaustion; performance needs its own canary',
        'Simulate mode was buggy and enforced the rule; dry-run modes are fine when bug-free',
        'Simulate mode should log to disk asynchronously; the CPU spike came from synchronous logging',
        'Dry-run modes should only be used for rules that don\'t use regular expressions',
      ],
      correct: [0],
      explanation:
        'Simulate mode suppresses the action (blocking) but still evaluates the regex on every request, so the catastrophic backtracking still ran. Dry-run catches correctness problems such as false positives, not cost. Cloudflare added per-rule performance profiling and staged rollouts. Nothing indicates simulate mode enforced the rule or that logging was the cost. Banning regex in dry-run misses the point.',
      followUps: [
        {
          q: 'How would you design a canary that would have caught this rule within a minute on 1% of servers?',
          a: 'Deploy to a small slice first (a single PoP or 1% of machines) and gate promotion on resource SLOs: CPU per request, p99 rule-evaluation time, and event-loop or worker saturation compared with the control group. Roll back automatically if CPU rises by more than X%. With a global p99 propagation of 2.29 s, the gating must be in the deploy system, because humans can\'t react between push and impact.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-13',
      difficulty: 'hard',
      question:
        'A proxy loads a feature file regenerated every five minutes. Given this loader, which change best prevents a Cloudflare-November-2025-style outage when a producer bug doubles the file?',
      code: {
        language: 'typescript',
        title: 'loader',
        code: `const MAX = 200;
let features: Feature[] = [];
export function onNewFile(raw: string) {
  const parsed = JSON.parse(raw) as Feature[];
  if (parsed.length > MAX) throw new Error('too many features'); // crashes the worker
  features = parsed;
}`,
      },
      options: [
        'Raise MAX to 1,000 so the doubled file fits',
        'Truncate the list to the first 200 features and continue',
        'Reject the candidate, keep serving the last-known-good list, alert, and add sanity checks (duplicates, size jump versus the previous version)',
        'Regenerate the file every minute instead of every five so bad files are replaced faster',
      ],
      correct: [2],
      explanation:
        'Cloudflare\'s follow-ups include hardening ingestion of internally generated config as if it were user input. The consumer should reject bad input, keep the last-known-good version, and never crash the request path. Raising the limit hides the producer bug and moves the cliff. Truncation silently changes model behaviour. Regenerating faster from the same broken query just produces bad files faster, and with gradually rolled-out nodes it makes the flapping worse.',
      followUps: [
        {
          q: 'The proxy restarts during the incident and has no last-known-good in memory. What then?',
          a: 'Persist last-known-good to local disk with a checksum each time a file is accepted, and load that on start. If there is still nothing (a fresh node), fall back to a bundled default shipped with the binary and run the module in degraded mode, or fail open (skip bot scoring) instead of failing every request. Decide per module whether fail-open or fail-closed is safer, and write it down.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-14',
      difficulty: 'expert',
      question:
        'Three appliers in different AZs each run this function. Which interleaving can leave the live DNS record empty, as in AWS\'s October 2025 DynamoDB incident?',
      code: {
        language: 'typescript',
        title: 'applier + cleanup',
        code: `async function apply(plan: Plan) {
  const live = await store.getLive();
  if (plan.gen <= live.gen) return;          // freshness check
  await slowRetries(plan);                   // may take minutes
  await store.setLive(plan);                 // unconditional write
  await cleanup(plan.gen);                   // delete plans with gen < current - 50
}
async function cleanup(currentGen: number) {
  for (const g of await store.listPlans()) if (g < currentGen - 50) await store.deletePlan(g);
}`,
      },
      options: [
        'Two appliers apply the same plan at the same time, writing identical records twice',
        'The planner produces two plans with the same generation, and the check rejects both',
        'Applier A passes the check for gen 100 and stalls; B applies gen 160 and later cleans up; A writes gen 100 as live; B\'s cleanup deletes plan 100, which is now the live plan',
        'Cleanup runs before the first apply and deletes all plans, so no applier has anything to apply',
      ],
      correct: [2],
      explanation:
        'This matches AWS\'s description: a delayed Enactor\'s early freshness check went stale, it overwrote a newer plan with an old one, and the other Enactor\'s cleanup deleted that old plan, removing all IPs. The fix is a conditional write at apply time and a cleanup that never deletes the live generation. Writing an identical plan twice is harmless. Equal generations being rejected is a liveness issue, not an empty record. Cleanup keeps recent plans, so it can\'t delete everything before the first apply.',
      followUps: [
        {
          q: 'Rewrite `store.setLive(plan)` so this can\'t happen, in one sentence, and name a real primitive.',
          a: 'Make it `compareAndSet(expectedGen = live.gen, next = plan)`, with the check-and-write evaluated atomically by the store and failing if live has moved on. For example, a DynamoDB `PutItem` with `ConditionExpression: \'gen < :g\'`, an etcd transaction comparing `mod_revision`, or a Postgres `UPDATE ... WHERE gen < $1`. Cleanup must also skip the live generation.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-15',
      difficulty: 'expert',
      question:
        'After DynamoDB recovered, EC2\'s lease manager (DWFM) entered congestive collapse: so many leases needed re-establishing that work timed out and was retried faster than it completed. Which actions break such a collapse? Select ALL that apply.',
      options: [
        'Throttle incoming work and restart workers so in-flight queues start empty',
        'Add rate limiting based on queue size, so new work is admitted only when the backlog can be processed',
        'Increase client retry counts and shorten timeouts so stuck work is retried sooner',
        'Prioritise renewing existing leases over admitting new launch requests, and relax throttles gradually',
        'Disable all health checks so no work is classified as failed',
      ],
      correct: [0, 1, 3],
      explanation:
        'AWS throttled incoming work and selectively restarted DWFM hosts at 04:14, then committed to queue-size-based rate limiting. Prioritising existing state over new work and relaxing throttles gradually (AWS relaxed EC2 throttles from late morning) prevents a relapse. More retries and shorter timeouts are what feed congestive collapse. Disabling all health checks hides real failures; AWS instead disabled one specific automatic failover (NLB AZ DNS failover) and planned velocity controls.',
      followUps: [
        {
          q: 'How would you detect congestive collapse in your own queue workers before it becomes an outage?',
          a: 'Track goodput (completions within deadline per second) against throughput and arrival rate. Collapse shows up as rising queue age and retries while goodput falls, even though workers are 100% busy. Alert on "work completed after its caller had already timed out" as a ratio. Respond by dropping expired work at dequeue, applying retry budgets, and shedding at admission.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-16',
      difficulty: 'hard',
      question:
        'Meta\'s edge DNS servers withdrew their BGP announcements when they lost contact with the data centres, and with the whole backbone down that made Facebook unresolvable worldwide. Which design change most directly removes this failure mode while keeping the benefit of the health check?',
      options: [
        'Raise DNS TTLs to 24 hours so resolvers keep cached answers during outages',
        'Remove the health-based withdrawal entirely and always announce from every site',
        'Host DNS with a second provider so a backbone failure cannot affect name resolution',
        'Make withdrawal fail-static: withdraw only if this site is unhealthy and enough peer sites remain healthy; if most sites look unhealthy at once, keep announcing and page humans',
      ],
      correct: [3],
      explanation:
        'The withdrawal is good when one site is sick (traffic moves elsewhere) and catastrophic when every site concludes the same thing because of a shared dependency. A global floor keeps the local benefit and blocks mass withdrawal. Long TTLs delay legitimate changes and don\'t help once caches expire. Removing withdrawal entirely sends users to genuinely dead sites. A second DNS provider would resolve names to addresses that were still unreachable over a dead backbone.',
      followUps: [
        {
          q: 'Even with DNS fixed, engineers could not get in remotely. What would you build for that?',
          a: 'An out-of-band management network on separate circuits (even cellular), with break-glass credentials and an identity path that doesn\'t depend on production DNS or SSO, plus a console server per site. Rehearse it in drills: Meta\'s "storm" exercises helped, but had never simulated a global backbone outage. Pre-approve emergency physical access so security procedures don\'t become the bottleneck.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-17',
      difficulty: 'medium',
      question:
        'Notion chose 480 logical shards on 32 physical Postgres hosts. Why 480 rather than a power of two like 512?',
      options: [
        '480 has many divisors, so the fleet can grow from 32 to 40, 48 or 60 hosts with an even number of logical shards each, whereas 512 forces 32 → 64',
        '480 fits exactly inside Postgres\'s per-database schema limit, while 512 exceeds it',
        'Hash functions distribute keys more evenly modulo a non-power-of-two number',
        'PgBouncer pools are limited to 15 databases each, and 480 = 32 × 15',
      ],
      correct: [0],
      explanation:
        'Notion said that 480 is divisible by many numbers, which gives flexibility to add or remove hosts, and that 512 would mean jumping from 32 to 64. Postgres has no small schema limit that 512 would exceed. With a good hash, distribution modulo 512 is just as even. 15 shards per host is a consequence of 480 ÷ 32, not a PgBouncer limit; the post doesn\'t mention PgBouncer.',
      followUps: [
        {
          q: 'You move from 32 to 48 hosts. What exactly moves, and how many rows are re-hashed?',
          a: 'Each host goes from 15 to 10 logical shards, so 5 whole schemas leave each original host for the 16 new ones: 160 schemas move in total. No row is re-hashed, because workspace → logical shard is fixed; only the logical → physical mapping changes. Move each schema with logical replication or dump/restore, switch its routing entry, and verify with dark reads.',
        },
      ],
    },
    {
      id: 'prod-dissections-mcq-18',
      difficulty: 'hard',
      question:
        'Figma implemented "logical sharding" using Postgres views on a single host before splitting any data physically. What did this buy them?',
      options: [
        'Views are materialised, so read latency dropped and helped justify the project',
        'Views let Postgres enforce cross-shard foreign keys after the physical split',
        'Production traffic went through shard-scoped routing while the data stayed on one host, so unroutable queries surfaced early and rollback was a configuration change',
        'Views removed the need for a proxy, because the application could query views directly forever',
      ],
      correct: [2],
      explanation:
        'Figma separated the reversible step (logical sharding via views, which a config change can roll back) from the risky one (the physical split), so problems such as queries without a shard key appeared while rollback was cheap. Ordinary views aren\'t materialised and add no speed. Figma explicitly does not support cross-shard atomic transactions, and views don\'t give cross-host foreign keys. DBProxy (Go) still routes and runs scatter-gather after the split.',
      followUps: [
        {
          q: 'During the logical phase you find 3% of queries have no shard key. What are your options?',
          a: 'Rewrite them to include the key (most ORM-generated queries can); allow DBProxy scatter-gather for low-QPS admin or reporting queries, with a cost limit; move cross-entity reporting to a warehouse fed by CDC; or keep certain global tables unsharded on a separate database. Figma\'s proxy supports scatter-gather precisely because some queries will always lack a shard key. The aim is to make them visible and rare, not zero.',
        },
      ],
    },
  ],
};

export default topic;
