import type { Topic } from '../../types';

const topic: Topic = {
  id: 'rel-dr',
  phase: 'reliability',
  order: 2,
  title: 'Redundancy, Disaster Recovery & Multi-Region',
  subtitle:
    'From availability math and backups to RPO/RTO tiers, multi-AZ vs multi-region, active-active conflicts, failover pitfalls, cells and chaos engineering — plus what to do when the DB, Redis, Kafka, an AZ or a whole region disappears.',
  estimatedMinutes: 95,
  sources: [
    'AWS Whitepaper — Disaster Recovery of Workloads on AWS (DR strategies)',
    'AWS Well-Architected — Reducing the Scope of Impact with Cell-Based Architecture',
    'AWS Builders\' Library — Static stability using Availability Zones; Shuffle sharding',
    'Google SRE Book — Ch 26 Data Integrity',
    'Principles of Chaos Engineering (principlesofchaos.org)',
  ],
  tags: ['disaster-recovery', 'rpo', 'rto', 'multi-region', 'active-active', 'failover', 'backups', 'cells', 'chaos-engineering', 'blast-radius'],
  cheatSheet: [
    'Availability: serial deps multiply (5 × 99.9% ≈ 99.5%); redundant copies combine as 1 − (1 − a)^n (two 99% copies ≈ 99.99% if failures are independent — they often are not).',
    '99.9% ≈ 43.8 min/month (8.76 h/yr); 99.99% ≈ 4.4 min/month (52.6 min/yr); 99.999% ≈ 26 s/month (5.26 min/yr).',
    'Replication ≠ backup: replicas copy DROP TABLE and corrupt writes within milliseconds. You need point-in-time recovery (base backup + WAL/binlog archive) plus immutable, cross-account copies (3-2-1 rule).',
    'RPO = how much data you can lose (time since last recoverable point); RTO = how long until service is back. Both are business numbers that price the architecture.',
    'DR tiers: backup & restore (RPO hours, RTO hours–day) → pilot light (RPO minutes, RTO tens of minutes) → warm standby (RPO seconds, RTO minutes) → active-active (RPO ≈ 0–seconds, RTO ≈ seconds).',
    'Multi-AZ (≤ ~2 ms apart): synchronous replication, automatic failover, covers most failures. Multi-region (30–150 ms): async replication, non-zero RPO, needed for region loss or data residency.',
    'Active-active needs a conflict strategy: single home region per entity (best), CRDTs/commutative ops, or LWW (silently loses writes). Data sovereignty pins EU data to EU regions.',
    'Failover pitfalls: DNS TTLs ignored by resolvers/clients, long-lived connections pinned to the dead IP, split-brain without fencing, and control-plane dependencies during the failover itself.',
    'Static stability: pre-provision so losing one of 3 AZs needs no scaling action (run ≤ ~66% per AZ); cells + shuffle sharding cap blast radius to 1/N of customers.',
    'Chaos engineering: steady-state hypothesis → inject real faults (latency, AZ loss, dependency death) → minimise blast radius → automate. An untested DR plan is a hypothesis, not a plan.',
  ],
  sections: [
    {
      heading: '1. Redundancy and availability math',
      body: `**Intuition:** redundancy is carrying a spare tyre. It only helps if the spare is inflated (tested), in the car (independent location), and the flat doesn't also puncture the spare (independent failure).

**The nines**

| Availability | Downtime / year | Downtime / month (30d) |
|---|---|---|
| 99% | 3.65 days | 7.2 hours |
| 99.9% | 8.76 hours | 43.2 min |
| 99.95% | 4.38 hours | 21.6 min |
| 99.99% | 52.6 min | 4.3 min |
| 99.999% | 5.26 min | 26 s |

**Composition**

- **Serial** (request needs A *and* B *and* C): \`A = a₁ × a₂ × … × aₙ\`. Five 99.9% dependencies → 0.999^5 ≈ **99.5%** (~3.6 h/month). Every synchronous dependency lowers your ceiling.
- **Parallel** (any one of n redundant copies suffices): \`A = 1 − (1 − a)^n\`. Two independent 99% nodes → 1 − 0.01² = **99.99%**.
- **The catch:** the parallel formula assumes *independent* failures. Same rack, same AZ, same deploy, same config push, same bug, same certificate expiry → correlated failure → the math is fiction. Most large outages are correlated (bad config deployed everywhere at once).

**Redundancy levels:** N (no spare), N+1 (survive one failure), N+2 (survive one failure during maintenance of another), 2N (full duplicate). Redundancy exists at every layer: disks (RAID/EBS replication), instances (autoscaling group across AZs), databases (replicas), AZs, regions, and *providers* (rarely worth it).

**In interviews say this:** "Redundancy only buys availability when failures are independent, so I spread replicas across failure domains — hosts, AZs, regions — and I also stagger deploys and config changes, because the most common correlated failure is us."`,
      code: [
        {
          language: 'typescript',
          title: 'Quick availability calculator',
          code: `// Serial chain: every component must be up
export const serial = (...as: number[]) => as.reduce((acc, a) => acc * a, 1);

// n independent redundant copies: at least one must be up
export const parallel = (a: number, n: number) => 1 - (1 - a) ** n;

export const downtimeMinutesPerMonth = (a: number) => (1 - a) * 30 * 24 * 60;

// Example: LB (99.99) -> 3 app pods (each 99.5, redundant) -> Postgres primary+standby (99.9 each)
const app = parallel(0.995, 3);          // 0.999999875
const db = parallel(0.999, 2);           // 0.999999 (only if failover is automatic & fast!)
const total = serial(0.9999, app, db);   // ~0.99989
console.log(total.toFixed(6), downtimeMinutesPerMonth(total).toFixed(1) + ' min/month'); // ~4.8`,
        },
      ],
      keyPoints: [
        'Serial dependencies multiply availability down; redundancy multiplies unavailability down.',
        'Parallel math assumes independence — correlated failures (deploys, config, AZ) break it.',
        'Spread replicas across failure domains and stagger changes.',
      ],
    },
    {
      heading: '2. Replication vs backups: what each protects against',
      body: `**Intuition:** a replica is a mirror — if you spill coffee on the original, the mirror shows the spill instantly. A backup is a photo from yesterday.

| Threat | Replica helps? | Backup/PITR helps? |
|---|---|---|
| Disk / node failure | Yes (failover in seconds–minutes) | Yes, slowly |
| AZ failure | Yes if cross-AZ | Yes, slowly |
| \`DELETE FROM orders\` without WHERE | **No** — replicated instantly | Yes: restore to 1 second before |
| Application bug corrupting rows for 3 days | **No** | Yes, if retention > 3 days |
| Ransomware / compromised admin credentials | **No** (attacker deletes both) | Only if backups are **immutable** and in a separate account |

**Backup types**

- **Full** — complete copy. Simple to restore, expensive to take.
- **Incremental** — changes since the last backup of any kind. Small, but restore needs the chain.
- **Differential** — changes since the last full. Restore = full + latest differential.
- **Snapshots** — storage-level (EBS/RDS snapshots), incremental at block level, fast to take, restore creates a new volume that lazily loads blocks from S3 (first reads are slow unless pre-warmed).
- **Logical** (\`pg_dump\`, \`mysqldump\`) — portable, version-independent, slow for TB-scale; great for single-table recovery.
- **Physical + continuous archiving** (\`pg_basebackup\`/pgBackRest + WAL archive, MySQL binlogs) — enables **point-in-time recovery (PITR)** to any second within retention. This is what makes RPO ≈ seconds possible for "oops" events.

**The 3-2-1 rule:** 3 copies, on 2 different media/services, 1 off-site. Modern version: **3-2-1-1-0** — plus 1 immutable/air-gapped copy (S3 Object Lock in compliance mode, separate AWS account) and 0 errors in the last restore test.

**Encrypt** backups (KMS key in a separate account too — losing the key = losing the backup), and **monitor** backup jobs: "last successful backup age" is an alert, not a log line.`,
      code: [
        {
          language: 'bash',
          title: 'Postgres PITR with pgBackRest + WAL archiving to S3',
          code: `# postgresql.conf (continuous WAL archiving)
#   wal_level = replica
#   archive_mode = on
#   archive_command = 'pgbackrest --stanza=main archive-push %p'
#   archive_timeout = 60        # force a WAL switch at least every 60s => RPO <= ~60s on quiet DBs

# Weekly full + daily differential; WAL is shipped continuously
pgbackrest --stanza=main --type=full backup     # Sunday
pgbackrest --stanza=main --type=diff backup     # Mon-Sat

# Restore the cluster to 1 second before the accidental DELETE at 14:03:27 UTC
pgbackrest --stanza=main --delta \\
  --type=time --target='2026-09-28 14:03:26+00' \\
  --target-action=promote restore

# Make an immutable, cross-account copy of the repository bucket (Object Lock, 35 days)
aws s3api put-object-lock-configuration --bucket pg-backups-vault \\
  --object-lock-configuration '{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":35}}}'`,
        },
      ],
      keyPoints: [
        'Replicas protect against hardware loss, not against logical corruption or deletes.',
        'PITR = base backup + continuous log archive; it defines your RPO for human error.',
        'Keep at least one immutable, cross-account, encrypted copy; alert on backup age.',
      ],
      source: 'Google SRE Book — Ch 26 Data Integrity',
    },
    {
      heading: '3. Restore drills: a backup you have not restored is a rumour',
      body: `**Intuition:** a fire extinguisher you've never checked might be empty. You only find out during the fire.

**Why drills matter:** in January 2017 GitLab.com lost ~6 hours of production database data after an accidental directory deletion; of their several backup/replication mechanisms, none worked as expected when needed (pg_dump had been silently failing due to a version mismatch, and alert emails were being rejected). Backups that aren't restored regularly rot silently: expired credentials, format changes, missing WAL segments, encryption keys rotated away.

**What an automated restore drill does (weekly/daily):**

1. Pick the latest backup (and a random older one — test retention).
2. Restore into an isolated scratch environment (separate VPC/account).
3. Replay logs to a target time (tests PITR, not just the base backup).
4. **Verify**: DB starts, checksums pass, row counts/max IDs match production within the expected RPO window, a few application-level invariants hold (e.g. sum of ledger = 0).
5. **Measure**: time to restore end-to-end. This *is* your realistic RTO for this failure mode — compare it to the target.
6. Emit metrics (\`restore_drill_success\`, \`restore_duration_seconds\`, \`restore_data_age_seconds\`) and page on failure.
7. Tear down.

**Beyond databases:** restore object storage versions, secrets, IaC state, Kafka topic data (if you rely on it as a source of truth), and **rebuild a service from scratch in a new account/region** from code (tests that your IaC and images are complete).

**Interview line:** "My RTO number comes from the last restore drill's measured duration, not from a spreadsheet."`,
      code: [
        {
          language: 'bash',
          title: 'Nightly restore drill (CI job) with verification and metrics',
          code: `#!/usr/bin/env bash
set -euo pipefail
START=$(date +%s)
TARGET_TIME=$(date -u -d '15 minutes ago' '+%Y-%m-%d %H:%M:%S+00')

# 1. Restore latest backup + WAL into an isolated scratch host
pgbackrest --stanza=main --pg1-path=/scratch/pgdata --delta \\
  --type=time --target="$TARGET_TIME" --target-action=promote restore
pg_ctl -D /scratch/pgdata -o '-p 6543' -w start

# 2. Verify invariants, not just "it started"
psql -p 6543 -d app -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) > 0 AS has_orders FROM orders;
SELECT max(created_at) > now() - interval '30 minutes' AS fresh_enough FROM orders;
SELECT coalesce(sum(amount_cents), 0) = 0 AS ledger_balanced FROM ledger_entries;
SQL

# 3. Report measured RTO for this failure mode
DURATION=$(( $(date +%s) - START ))
echo "restore_drill_success 1" | curl --data-binary @- http://pushgateway:9091/metrics/job/restore_drill
echo "restore_duration_seconds $DURATION" | curl --data-binary @- http://pushgateway:9091/metrics/job/restore_drill
pg_ctl -D /scratch/pgdata -m fast stop`,
        },
      ],
      keyPoints: [
        'Automate restores and verify business invariants.',
        'Measured restore duration is your real RTO.',
        'Page on drill failure and on backup age, not just on job errors.',
      ],
    },
    {
      heading: '4. RPO, RTO and the four DR tiers',
      body: `**Intuition:** RPO asks "how far back in time will we be thrown?"; RTO asks "how long will we be in the dark?".

- **RPO (Recovery Point Objective)** — max acceptable data loss, measured in time. Async replication with 2s lag → RPO ≈ 2s. Nightly backups only → RPO up to 24h.
- **RTO (Recovery Time Objective)** — max acceptable time from disaster to restored service (detection + decision + recovery + validation). Humans deciding to fail over often dominate.
- Also track **MTTD** (time to detect) — you can't recover from what you haven't noticed.

**DR strategies (AWS DR whitepaper taxonomy)**

| Tier | What runs in the DR region | Typical RPO | Typical RTO | Relative cost |
|---|---|---|---|---|
| **Backup & restore** | Nothing; backups + IaC copied there | Hours (last backup) | Hours to a day | $ |
| **Pilot light** | Data layer replicated & live (DB replica), compute defined but off/at zero | Seconds–minutes | Tens of minutes (provision + scale compute) | $$ |
| **Warm standby** | Full stack running at reduced capacity, serving no/limited traffic | Seconds | Minutes (scale up + switch) | $$$ |
| **Multi-site active-active** | Full capacity in 2+ regions, all serving | ≈ 0 to seconds | ≈ seconds to minutes (reroute) | $$$$ |

**Choosing a tier:** tier by *workload*, not by company. A payment ledger may need warm standby or active-active; the internal reporting dashboard can live with backup & restore. Ask: what does an hour of downtime cost (revenue, SLA credits, regulatory fines)? What does a minute of lost data cost (lost orders vs lost money movements)?

**Important nuance:** RPO ≈ 0 across regions requires **synchronous** cross-region writes (+30–150ms per commit) or a consensus database spanning regions (Spanner, CockroachDB). Most systems accept seconds of RPO and design reconciliation for the gap (e.g. replay from PSP webhooks for payments).`,
      diagram: `  cost ^
       |                                  [active-active]
       |                         [warm standby]
       |              [pilot light]
       |  [backup & restore]
       +---------------------------------------------------> RTO/RPO
          seconds          minutes          hours        (smaller = better)
   (read right-to-left: every step toward seconds costs more)`,
      keyPoints: [
        'RPO = data loss window; RTO = downtime window; both are business decisions.',
        'Tier per workload: backup/restore → pilot light → warm standby → active-active.',
        'Cross-region RPO 0 needs synchronous/consensus writes and their latency.',
      ],
      source: 'AWS Whitepaper — Disaster Recovery of Workloads on AWS',
    },
    {
      heading: '5. Multi-AZ vs multi-region',
      body: `**Intuition:** multi-AZ is having two kitchens in the same building on separate power; multi-region is a second restaurant in another city.

| Dimension | Multi-AZ (same region) | Multi-region |
|---|---|---|
| Distance / RTT | Separate facilities, typically < 1–2 ms RTT | 30–150 ms RTT (e.g. us-east-1↔us-west-2 ~60–70 ms, us-east-1↔eu-west-1 ~70–80 ms) |
| Replication | **Synchronous** feasible (RDS Multi-AZ, Aurora 6-copy quorum across 3 AZs) | Usually **asynchronous** (Aurora Global DB typical lag < 1s) |
| RPO on failure | ≈ 0 | Seconds (replication lag) |
| Failover | Automatic, managed (RDS Multi-AZ typically 60–120s; Aurora typically < 30–60s) | Often a human decision; minutes |
| Protects against | Host, rack, power, single-datacenter events | Region-wide outages, regional control-plane failures, geo-disasters, data residency |
| Cost / complexity | Moderate (cross-AZ transfer ~$0.01/GB each way) | High: duplicate stacks, cross-region transfer (~$0.02/GB), global routing, data consistency |

**Rules of thumb**

- **Everything production should be multi-AZ.** It is cheap relative to the benefit and covers the most frequent infrastructure failures.
- Go **multi-region** when: RTO for region loss must be < hours, regulators require geographic separation, users are global and latency matters, or you need data residency.
- Keep **chatty synchronous calls within an AZ/region**; crossing regions per request adds 60–150ms each time.
- Remember **regional services** (IAM, KMS, S3, managed Kafka, SQS) are single-region by default — a multi-region app on top of single-region dependencies is not multi-region.`,
      keyPoints: [
        'Multi-AZ: sync replication, RPO ≈ 0, automatic failover — the default.',
        'Multi-region: async, RPO = lag, needed for region loss, residency, global latency.',
        'Audit hidden single-region dependencies (KMS, IAM, queues, SaaS).',
      ],
    },
    {
      heading: '6. Active-passive vs active-active: conflicts and data sovereignty',
      body: `**Intuition:** active-passive is one pilot and one co-pilot waiting; active-active is two pilots both flying — great until both pull the stick in different directions.

**Active-passive (primary + standby region)**
- One region takes writes; the other replicates asynchronously and may serve reads.
- Simple consistency model; failover loses the replication lag (RPO) and takes minutes (RTO).
- Risk: the passive side rots — config drift, untested capacity. Mitigate by regularly serving some traffic from it or doing scheduled failovers.

**Active-active (all regions take writes)**
The hard problem is **concurrent writes to the same data in two regions**.

| Strategy | How | Trade-off |
|---|---|---|
| **Home region per entity** (partitioned ownership) | Each user/tenant/account has a home region; its writes route there; others read replicas | No conflicts; cross-region write latency for travellers; failover must re-home |
| **Last-writer-wins (LWW)** | Timestamp per item; newest wins (DynamoDB Global Tables) | Silently drops concurrent writes; clock skew matters |
| **CRDTs / commutative ops** | Counters, sets, "add item to cart" as merges | Only fits some data types; deletes are tricky (tombstones) |
| **Application-level merge** | Keep both versions (vector clocks/siblings), resolve on read | Complex, domain-specific |
| **Global consensus DB** | Spanner/CockroachDB with quorum across regions | Every write pays cross-region quorum latency |

For money, inventory and anything with invariants, prefer **home-region ownership** or a consensus store; never LWW on balances.

**Data sovereignty / residency.** GDPR itself allows transfers with safeguards, but many customers, sectors (banking, health, public sector) and countries (e.g. data localisation laws in India's RBI payment-data rules, Russia, China) require data to *stay* in-country or in-region. Design: EU tenants homed in EU regions, replicas only to other EU regions, global indexes contain only non-personal routing keys. This naturally leads to the home-region model.`,
      diagram: `         Global router (GeoDNS / anycast edge)
           |  looks up user's home region
     +-----+----------------------+
     v                            v
 [eu-west-1]  <-- async repl -- [eu-central-1]      EU users' data stays in EU
  home of EU tenants              DR for EU tenants
     |
     x  (no replication of personal data to US)
 [us-east-1]  <-- async repl -- [us-west-2]
  home of US tenants              DR for US tenants`,
      code: [
        {
          language: 'typescript',
          title: 'Home-region routing at the edge (writes go to the owner region)',
          code: `type Region = 'eu-west-1' | 'eu-central-1' | 'us-east-1' | 'us-west-2';

interface Placement { home: Region; failover: Region; residency: 'EU' | 'US' }

// Small, replicated-everywhere routing table: tenantId -> placement (no personal data)
const placements = new Map<string, Placement>();
const regionHealthy = new Map<Region, boolean>(); // fed by health checks

export function routeWrite(tenantId: string): Region {
  const p = placements.get(tenantId);
  if (!p) throw new Error('unknown tenant ' + tenantId);
  if (regionHealthy.get(p.home) !== false) return p.home;
  // Failover target is ALWAYS inside the residency zone
  if (regionHealthy.get(p.failover) !== false) return p.failover;
  throw new Error('no healthy region within residency ' + p.residency);
}

// Reads may be served locally from a replica if staleness is acceptable
export function routeRead(tenantId: string, local: Region, allowStale: boolean): Region {
  const p = placements.get(tenantId)!;
  const sameZone = local.startsWith(p.residency === 'EU' ? 'eu-' : 'us-');
  return allowStale && sameZone ? local : routeWrite(tenantId);
}`,
        },
      ],
      keyPoints: [
        'Active-passive: simple, RPO = lag, risk of rotting standby.',
        'Active-active: pick a conflict strategy; home-region ownership avoids conflicts.',
        'Residency constraints shape replication topology and failover targets.',
      ],
    },
    {
      heading: '7. Failover automation and DNS TTL pitfalls',
      body: `**Intuition:** switching to the spare generator is easy; making sure the old generator can't come back on and fry everything (split-brain) is the hard part.

**Automated vs manual failover**
- **Within a region (DB primary, AZ):** automate. Managed services use quorum/witness to decide (Aurora storage quorum, Patroni + etcd, RDS internal monitoring).
- **Cross-region:** often *human-approved automation* — a single button/runbook. Automatic cross-region failover on noisy health signals can cause flip-flopping and data loss (RPO) for a transient blip.

**Split-brain and fencing.** During a network partition the old primary may still accept writes. You must **fence** it: revoke its ability to write (STONITH, revoke IAM/SG, fencing tokens checked by storage, lease expiry in etcd). Never let two primaries accept writes for the same data.

**DNS failover pitfalls**
- **TTL is advisory.** Some resolvers enforce minimum TTLs; clients cache: the JVM historically cached forever with a security manager (\`networkaddress.cache.ttl\`), browsers cache ~1 minute, and some ISPs ignore low TTLs. Expect a tail of clients hitting the old endpoint for minutes to hours.
- **Long-lived connections ignore DNS entirely.** Keep-alive HTTP pools, DB pools, gRPC channels, WebSockets stay connected to the old IP until they break. Node doesn't cache DNS itself, but an existing \`pg\` pool connection won't re-resolve until it reconnects. Set max connection lifetime, TCP keepalives, and make clients reconnect on failover.
- **Health-check flapping** causes repeated failovers; require N consecutive failures and hysteresis.
- **Control plane during failover:** changing DNS records or scaling in the DR region requires the provider's control plane (often in one region, e.g. Route 53's control plane is in us-east-1). Prefer **data-plane** mechanisms prepared in advance: Route 53 health-checked failover records or ARC routing controls, pre-scaled capacity, Global Accelerator/anycast.

**Failback** is its own project: resync data written in the DR region back to the primary, reconcile the RPO gap, and switch back in a planned window.`,
      code: [
        {
          language: 'yaml',
          title: 'Route 53 health-checked failover records (CloudFormation)',
          code: `Resources:
  PrimaryHealthCheck:
    Type: AWS::Route53::HealthCheck
    Properties:
      HealthCheckConfig:
        Type: HTTPS
        FullyQualifiedDomainName: api-use1.example.com
        ResourcePath: /ready
        RequestInterval: 10        # seconds
        FailureThreshold: 3        # ~30s before marked unhealthy
  ApiPrimary:
    Type: AWS::Route53::RecordSet
    Properties:
      HostedZoneName: example.com.
      Name: api.example.com.
      Type: CNAME
      TTL: '60'                    # low TTL, but expect clients to cache longer
      SetIdentifier: primary-us-east-1
      Failover: PRIMARY
      HealthCheckId: !Ref PrimaryHealthCheck
      ResourceRecords: [api-use1.example.com]
  ApiSecondary:
    Type: AWS::Route53::RecordSet
    Properties:
      HostedZoneName: example.com.
      Name: api.example.com.
      Type: CNAME
      TTL: '60'
      SetIdentifier: secondary-us-west-2
      Failover: SECONDARY          # answered only while PRIMARY is unhealthy
      ResourceRecords: [api-usw2.example.com]`,
        },
      ],
      keyPoints: [
        'Automate in-region failover; make cross-region failover a one-click, human-approved runbook.',
        'Fence the old primary — split-brain corrupts data.',
        'DNS TTLs and pooled connections delay failover; rely on pre-provisioned data-plane mechanisms.',
      ],
    },
    {
      heading: '8. Cell-based architecture and blast radius',
      body: `**Intuition:** instead of one giant ship, run a fleet of identical small boats. If one sinks, only its passengers get wet.

**Cells** are complete, independent copies of the service stack (compute + data + queues), each serving a subset of customers. A thin **cell router** maps a partition key (tenant/account ID) to a cell. Failures, bad deploys, poison-pill requests and noisy tenants are contained to one cell.

- **Blast radius** of a cell failure = 1/N of customers (N cells).
- **Deploy in waves:** one canary cell → 10% of cells → all, with bake time; a bad release hits one cell first.
- **Fixed maximum cell size** — cells are load-tested to a known limit; scale by adding cells, not by growing a cell into untested territory.
- **Router must be ultra-simple and statically stable**: a cached mapping table, no heavy logic; it's the one shared component.
- **Cell migration** (moving a tenant) needs a data-copy + cutover procedure.

**Shuffle sharding** (AWS Route 53 technique): give each customer a random *combination* of k workers out of n. With 8 workers and 2 per customer there are C(8,2) = 28 combinations; a poison customer that kills its 2 workers affects only customers sharing *both* workers — ~1/28 of them instead of 1/4 with fixed sharding of pairs. With n = 100 and k = 5 there are ~75 million combinations.

**Compared with bulkheads:** bulkheads isolate *within* a process/service; cells isolate *entire stacks*. Cells also help with regional residency and with cost attribution per tenant.

**Costs:** more infrastructure overhead, cross-cell queries (global analytics) need a separate pipeline, and operational tooling must handle hundreds of cells.`,
      diagram: `                 +------------------+
  requests ----> |   cell router    |  tenant -> cell (cached table)
                 +--+------+------+-+
                    |      |      |
              +-----v-+ +--v----+ +v------+
              | cell1 | | cell2 | | cell3 |   each: LB + app + DB + queue
              | T1..T | | T..   | | T..   |   max size load-tested
              +-------+ +-------+ +-------+
   bad deploy / poison tenant / DB failure in cell2 -> ~1/3 customers affected`,
      code: [
        {
          language: 'typescript',
          title: 'Cell router with pinned overrides and shuffle-shard helper',
          code: `import { createHash } from 'node:crypto';

const CELLS = ['cell-1', 'cell-2', 'cell-3', 'cell-4', 'cell-5', 'cell-6'];
// Explicit placements win (migrations, big tenants isolated in their own cell)
const overrides = new Map<string, string>([['tenant-acme', 'cell-6']]);

const h = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);

export function cellFor(tenantId: string): string {
  return overrides.get(tenantId) ?? CELLS[h(tenantId) % CELLS.length];
}

// Shuffle sharding: each tenant gets a deterministic set of k workers out of n
export function shuffleShard(tenantId: string, workers: string[], k: number): string[] {
  const scored = workers.map((w) => ({ w, score: h(tenantId + ':' + w) }));
  scored.sort((a, b) => a.score - b.score);   // rendezvous-style: stable per tenant
  return scored.slice(0, k).map((x) => x.w);
}

// shuffleShard('tenant-42', ['w1','w2','w3','w4','w5','w6','w7','w8'], 2) -> e.g. ['w3','w7']
// A poison tenant can only take down its own 2 workers; C(8,2) = 28 distinct pairs exist.`,
        },
      ],
      keyPoints: [
        'Cells = independent full stacks; blast radius 1/N; deploy cell by cell.',
        'Keep the router trivial and statically stable; cap cell size.',
        'Shuffle sharding makes full overlap between customers rare.',
      ],
      source: 'AWS Well-Architected — Reducing the Scope of Impact with Cell-Based Architecture',
    },
    {
      heading: '9. Chaos engineering and game days',
      body: `**Intuition:** fire drills. You don't wait for a real fire to find out the exit door is locked.

**Principles (principlesofchaos.org)**
1. Define **steady state** as a measurable business metric (orders/min, p99 latency, successful logins).
2. **Hypothesise** it stays steady during a fault ("losing one AZ keeps checkout success > 99.5%").
3. Inject **real-world events**: instance/pod death, AZ blackhole, dependency latency (+500ms), packet loss, DNS failure, clock skew, disk full, expired certificate, Redis/Kafka unavailable.
4. Run in **production** (eventually) — staging never has production traffic and scale.
5. **Minimise blast radius**: start with 1% of traffic or one cell, have an abort button and automatic stop conditions (e.g. SLO burn alarm).
6. **Automate** continuously so regressions are caught.

**Tools:** Netflix Chaos Monkey (instance kill), Gremlin, AWS Fault Injection Service (including AZ power-interruption scenarios), Chaos Mesh / LitmusChaos for Kubernetes, Toxiproxy for dependency faults in integration tests.

**Game days:** scheduled, cross-team exercises that simulate a disaster (e.g. region evacuation). They test *people and runbooks* as much as systems: who declares the incident, who has permissions, whether the dashboards exist.

**What typically breaks on the first run:** hidden dependencies on the "dead" region, secrets only in one region, runbooks referencing retired tools, capacity in the DR region never pre-reserved, and alerts nobody receives.`,
      code: [
        {
          language: 'yaml',
          title: 'Chaos Mesh: add 400ms latency to 50% of pricing pods for 5 minutes',
          code: `apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: pricing-latency
  namespace: chaos
spec:
  action: delay
  mode: fixed-percent
  value: '50'                     # blast radius: half the pricing pods
  selector:
    namespaces: [shop]
    labelSelectors:
      app: pricing
  delay:
    latency: '400ms'
    jitter: '100ms'
    correlation: '25'
  direction: to
  duration: '5m'                  # auto-stop even if nobody intervenes
# Hypothesis: checkout success rate stays > 99.5% and p99 < 800ms
# because callers use 300ms timeouts, bulkheads and a cached-price fallback.`,
        },
      ],
      keyPoints: [
        'Steady-state hypothesis → inject faults → measure → fix.',
        'Inject latency, not just crashes; start small with abort conditions.',
        'Game days test people, permissions and runbooks.',
      ],
      source: 'Principles of Chaos Engineering',
    },
    {
      heading: '10. Dependency outages: DB down, Redis down, Kafka down, network partition',
      body: `**Intuition:** for each dependency, decide *in advance* what "degraded but alive" looks like.

**Primary database down**
- Multi-AZ failover: RDS Multi-AZ typically 60–120s; Aurora typically < 30–60s; Patroni ~10–30s. During that window writes fail.
- App behaviour: bounded pool acquisition timeouts, short statement timeouts, fail writes fast with a clear error, keep serving **reads from replicas/cache**, optionally enter **read-only mode** (feature flag). Queue non-urgent writes (async jobs) for later.
- After failover: pools must drop dead connections and reconnect with **jitter** (avoid a connection storm); DNS endpoint changes — honour it by max connection lifetime.

**Redis down** — depends what Redis is used for:
| Use | Fallback |
|---|---|
| Cache | Go to DB — but **protect the DB** (the cache was absorbing 90%+ of reads): local in-process LRU, request coalescing, concurrency cap to DB, serve stale |
| Sessions | Stateless JWT fallback or force re-login (fail-closed for security) |
| Rate limiter | Fail-open with a local in-memory limiter (see rate-limiting) |
| Distributed lock / idempotency store | Fail-closed for money movement; or DB-based fallback |
| Queue (BullMQ) | Producers buffer or reject; this is why critical queues belong on durable brokers |
Client config matters: ioredis defaults to an **offline queue** and 20 retries per request — requests pile up in memory instead of failing fast.

**Kafka down**
- Producers: \`buffer.memory\`/in-memory batching holds only seconds–minutes; \`delivery.timeout.ms\` (default 120s) then fails. For must-not-lose events use the **transactional outbox** (write the event to the DB in the same transaction; a relay publishes when Kafka is back) — Kafka downtime then only increases latency, not loss.
- Consumers: simply stop; when Kafka returns they resume from committed offsets. Plan for the **backlog catch-up** (consumer throughput must exceed produce rate, e.g. 2–3× headroom).
- With RF=3, min.insync.replicas=2, acks=all, a single broker loss is invisible; losing 2 of 3 replicas of a partition stops writes to it (by design).

**Network partition**
- Within a quorum system, the minority side must stop accepting writes (CP) — e.g. etcd/ZooKeeper, Kafka controller quorum. Apps on the minority side should see errors, not silently diverge.
- Between regions in active-active: each region keeps serving its home entities; cross-region replication queues up and catches up later; conflicts handled by the chosen strategy. Use fencing tokens/leases for anything that must have a single owner.`,
      code: [
        {
          language: 'typescript',
          title: 'ioredis configured to fail fast when Redis is down',
          code: `import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST,
  connectTimeout: 500,
  commandTimeout: 100,          // a cache lookup slower than 100ms is worse than a miss
  maxRetriesPerRequest: 1,      // default is 20: requests would wait through reconnects
  enableOfflineQueue: false,    // default true: commands pile up in memory while disconnected
  retryStrategy: (times) => Math.min(2000, 50 * 2 ** times) + Math.random() * 100, // reconnect w/ jitter
});

redis.on('error', (e) => console.warn('redis error', e.message)); // avoid unhandled error events

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch {
    return null; // treat Redis failure as a cache miss (caller must protect the DB!)
  }
}`,
        },
      ],
      keyPoints: [
        'Pre-decide fail-open vs fail-closed per dependency use.',
        'Redis down = DB stampede risk; protect the DB with local cache + concurrency caps.',
        'Kafka down + outbox = delayed, not lost; plan backlog catch-up capacity.',
      ],
    },
    {
      heading: '11. AZ down and region down: runbooks and static stability',
      body: `**AZ down (most common large failure)**

- **Static stability:** do not depend on launching new capacity during the event (the control plane may be impaired and capacity scarce). With 3 AZs, run each at ≤ ~66% of what it can serve so the remaining 2 absorb the load: capacity overhead = n/(n−1) = 1.5×. With 4 AZs overhead is 1.33×.
- Load balancers stop routing to the dead AZ via health checks; for **gray** AZ failures (packet loss, elevated latency), health checks may pass — use **zonal shift** (e.g. Route 53 ARC zonal shift / zonal autoshift) to evacuate an AZ manually or automatically.
- Databases: Multi-AZ failover; for Aurora, a writer in another AZ is promoted.
- Watch for **AZ-affinity traps**: a stateful service with all replicas in one AZ, a NAT gateway in one AZ used by all, an EBS volume (AZ-scoped).
- Kafka: rack-aware replica placement (\`broker.rack\`) so each partition's replicas span AZs.

**Region down (rare, high impact)**

| Step | Target time | Notes |
|---|---|---|
| Detect | 1–5 min | Synthetic probes from *outside* the region; don't rely on in-region monitoring |
| Decide | 5–15 min | Incident commander + pre-agreed criteria ("> 15 min of SLO breach with no ETA") |
| Fence & fail over data | 1–10 min | Promote DR DB (e.g. Aurora Global "failover" / "switchover"); fence old writer |
| Shift traffic | 1–5 min + DNS tail | ARC routing controls / weighted records / Global Accelerator; pre-scaled capacity |
| Validate | 5–10 min | Smoke tests, business metrics |
| Reconcile | Hours–days | Replay events lost in the RPO window (from PSP webhooks, client retries, outbox) |

**Common failures in real evacuations:** DR region under-provisioned (quota limits!), secrets/certs/KMS keys only in the primary region, CI/CD or artifact registry hosted in the dead region, and third-party integrations allow-listing only the primary region's IPs.

**Interview line:** "For AZ loss I aim for zero human action via static stability. For region loss I want a rehearsed, one-button, human-approved evacuation with a measured RTO from the last game day."`,
      diagram: `  3 AZs, steady state            AZ-b fails (no scaling needed)
  +------+------+------+          +------+------+------+
  | AZ-a | AZ-b | AZ-c |          | AZ-a |  XX  | AZ-c |
  | 66%  | 66%  | 66%  |   --->   | 100% |  XX  | 100% |
  +------+------+------+          +------+------+------+
  overhead = n/(n-1) = 1.5x capacity; 4 AZs -> 1.33x`,
      keyPoints: [
        'AZ loss: static stability (n/(n−1) headroom), zonal shift for gray failures.',
        'Region loss: detect from outside, decide on pre-agreed criteria, fence, shift, reconcile.',
        'Check quotas, secrets, CI/CD and third-party allow-lists in the DR region.',
      ],
      source: 'AWS Builders\' Library — Static stability using Availability Zones',
    },
  ],
  codeChallenges: [
    {
      id: 'rel-dr-cc-1',
      title: 'Product service that dies with Redis',
      context:
        'The product service serves 20K RPS; Redis absorbs ~95% of reads so Postgres only sees ~1K QPS and is sized for ~3K QPS. When the Redis primary failed over last week (25 seconds), the product service\'s memory exploded, Postgres hit 100% CPU, and the outage lasted 18 minutes.',
      task:
        'Make the read path survive a Redis outage: fail fast on Redis, avoid unbounded memory growth, and prevent the database from being stampeded while Redis is unavailable.',
      starter: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis(process.env.REDIS_URL!); // library defaults
const db = new Pool({ max: 20 });

export async function getProduct(id: string) {
  const cached = await redis.get('product:' + id);   // throws / hangs when Redis is down
  if (cached) return JSON.parse(cached);

  const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [id]);
  await redis.set('product:' + id, JSON.stringify(rows[0]), 'EX', 300);
  return rows[0];
}`,
      },
      hints: [
        'What do ioredis\' offline queue and maxRetriesPerRequest (default 20) do to a request while Redis is reconnecting?',
        'If 95% of 20K RPS suddenly misses, what QPS reaches a DB sized for 3K? How many of those are for the same hot keys?',
        'What local, in-process state could serve hot products for 30 seconds? How do you cap how many DB queries run at once?',
      ],
      solution: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
import { Pool } from 'pg';
import { LRUCache } from 'lru-cache';

const redis = new Redis(process.env.REDIS_URL!, {
  commandTimeout: 50, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 500,
});
redis.on('error', () => {}); // logged by metrics elsewhere; avoid unhandled 'error' events

const db = new Pool({ max: 20, connectionTimeoutMillis: 200 });
// L1: in-process cache for hot items, allowed to serve stale during a Redis outage
const local = new LRUCache<string, { v: unknown; at: number }>({ max: 50_000 });
const inflight = new Map<string, Promise<unknown>>(); // request coalescing per key
let dbActive = 0;
const DB_MAX_CONCURRENT = 15;            // keep headroom under the pool/DB capacity
const FRESH_MS = 5_000;

export async function getProduct(id: string): Promise<unknown> {
  const key = 'product:' + id;
  const l1 = local.get(key);
  if (l1 && Date.now() - l1.at < FRESH_MS) return l1.v;

  let redisOk = true;
  try {
    const cached = await redis.get(key);
    if (cached) { const v = JSON.parse(cached); local.set(key, { v, at: Date.now() }); return v; }
  } catch { redisOk = false; }            // treat as miss, but remember Redis is unhealthy

  const pending = inflight.get(key);      // one DB query per key, however many callers
  if (pending) return pending;

  if (dbActive >= DB_MAX_CONCURRENT) {    // protect the DB: serve stale or shed
    if (l1) return l1.v;
    throw new Error('product temporarily unavailable'); // mapped to 503 + Retry-After
  }

  const p = (async () => {
    dbActive++;
    try {
      const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [id]);
      const v = rows[0] ?? null;
      local.set(key, { v, at: Date.now() });
      if (redisOk) redis.set(key, JSON.stringify(v), 'EX', 300).catch(() => {}); // best effort
      return v;
    } finally { dbActive--; inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}`,
      },
      explanation: `**Fixes:**

- **Fail fast on Redis.** \`commandTimeout: 50\`, \`maxRetriesPerRequest: 1\` and \`enableOfflineQueue: false\` make commands error immediately while Redis is down. With defaults, every request queued in ioredis' offline queue and waited through up to 20 reconnect retries — that is what exploded memory.
- **Redis error = miss, not 500.** The read path degrades instead of failing.
- **L1 in-process LRU** serves hot keys (product catalogs are heavily skewed) and is allowed to serve **stale** values when the DB is saturated — during a 25s outage that absorbs most traffic.
- **Request coalescing** (\`inflight\` map): 1,000 concurrent misses for the same hot product → 1 DB query.
- **DB concurrency cap** (\`DB_MAX_CONCURRENT\`) and a pool acquisition timeout: the DB can never be driven beyond its capacity; excess traffic gets stale data or a fast 503 rather than turning a Redis failover into a DB outage.
- **Best-effort write-back** only when Redis looked healthy, without awaiting it.

Net effect: a Redis failover becomes a brief latency blip plus some stale product data instead of an 18-minute outage.`,
      followUps: [
        {
          "q": "This runs on 40 pods. Is `DB_MAX_CONCURRENT = 15` per pod actually protecting a database sized for ~3K QPS?",
          "a": "No. The cap is per process, so the fleet can run 40 × 15 = 600 concurrent queries, far more than the DB can handle, and the pool (`max: 20` × 40 = 800 connections) can also exceed `max_connections`. Derive the per-pod cap from the DB budget: if the DB sustains ~100 concurrent queries comfortably, each pod gets ~2–3, recomputed when pod count changes. Or put PgBouncer in front with a fixed server pool, so the database sees at most N connections regardless of pod count."
        },
        {
          "q": "How would you test that a 25-second Redis failover is now a non-event?",
          "a": "Run a load test at production RPS with a realistic, skewed key distribution (Zipf), then make Redis unavailable for 25 s via Toxiproxy or by killing the primary in a staging Sentinel setup. Assert: pod memory flat, p99 within budget, DB CPU under ~80% and DB QPS under 3K, 503 rate small and limited to cold keys, and full recovery without restarts. Add unit tests with an injected fake Redis that rejects, checking coalescing (100 concurrent calls for one key → 1 DB query) and stale serving when the cap is hit."
        }
      ],
    },
    {
      id: 'rel-dr-cc-2',
      title: 'Order events lost whenever Kafka is unavailable',
      context:
        'The order service commits an order to Postgres and then publishes OrderPlaced to Kafka for fulfilment and email. During a 10-minute MSK maintenance issue, ~4,000 orders were saved but never fulfilled; the team only noticed from customer complaints.',
      task:
        'Redesign the write path so a Kafka outage of any length delays events but never loses them, without making order placement fail when Kafka is down.',
      starter: {
        language: 'typescript',
        code: `import { Kafka } from 'kafkajs';
import { Pool } from 'pg';

const db = new Pool();
const producer = new Kafka({ brokers: ['b1:9092', 'b2:9092'] }).producer();

export async function placeOrder(order: { id: string; userId: string; totalCents: number }) {
  await db.query('INSERT INTO orders (id, user_id, total_cents) VALUES ($1, $2, $3)',
    [order.id, order.userId, order.totalCents]);

  try {
    await producer.send({ topic: 'orders', messages: [{ key: order.id, value: JSON.stringify(order) }] });
  } catch (err) {
    console.error('failed to publish order event', err); // order is saved, event is gone
  }
  return { ok: true };
}`,
      },
      hints: [
        'The DB write and the Kafka publish are two separate systems — what happens if the process crashes between them, even when Kafka is healthy?',
        'Which system is already durable and transactional in this code path?',
        'How does a background process publish reliably, in order per aggregate, without double side effects downstream?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Kafka } from 'kafkajs';
import { Pool } from 'pg';

const db = new Pool();
const producer = new Kafka({ brokers: ['b1:9092', 'b2:9092', 'b3:9092'] })
  .producer({ idempotent: true, maxInFlightRequests: 1 }); // no dupes/reordering on producer retries

// 1) Order + event in ONE local transaction (transactional outbox)
export async function placeOrder(order: { id: string; userId: string; totalCents: number }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO orders (id, user_id, total_cents) VALUES ($1, $2, $3)',
      [order.id, order.userId, order.totalCents]);
    await client.query(
      'INSERT INTO outbox (aggregate_id, topic, payload) VALUES ($1, $2, $3)',
      [order.id, 'orders', JSON.stringify({ type: 'OrderPlaced', eventId: order.id, ...order })]);
    await client.query('COMMIT');
    return { ok: true }; // succeeds even if Kafka is down
  } catch (e) {
    await client.query('ROLLBACK'); throw e;
  } finally { client.release(); }
}

// 2) Relay: publishes pending rows; safe to run in several pods (SKIP LOCKED)
export async function relayOnce(batch = 500): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, aggregate_id, topic, payload FROM outbox WHERE published_at IS NULL ' +
      'ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED', [batch]);
    if (rows.length === 0) { await client.query('COMMIT'); return 0; }
    await producer.send({ topic: 'orders', acks: -1, // acks=all
      messages: rows.map((r) => ({ key: r.aggregate_id, value: r.payload })) });
    await client.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1)', [rows.map((r) => r.id)]);
    await client.query('COMMIT');
    return rows.length;
  } catch (e) {
    await client.query('ROLLBACK'); // Kafka down: rows stay pending, retried next tick
    throw e;
  } finally { client.release(); }
}
// Run relayOnce in a loop with jittered backoff on error; alert on max(now() - created_at) of pending rows.`,
      },
      explanation: `**Why this fixes it:**

- **Dual-write eliminated.** The order row and the event row commit atomically in Postgres. Either both exist or neither — no lost events on Kafka outages *or* on process crashes between the two writes (which the starter also suffered from, even with Kafka healthy).
- **Kafka outage → backlog, not loss.** When Kafka is down, \`relayOnce\` fails and rolls back; rows stay \`published_at IS NULL\` and are published when Kafka recovers. Order placement never depends on Kafka availability.
- **At-least-once delivery.** If the relay publishes and crashes before marking rows, they are re-sent; consumers must be idempotent (dedupe on \`eventId\`). The idempotent producer prevents duplicates caused by producer-level retries.
- **Ordering per order.** Messages are keyed by \`aggregate_id\`, so all events of one order go to the same partition; relay reads in \`id\` order.
- **Scale-out safe.** \`FOR UPDATE SKIP LOCKED\` lets several relay instances work without double-claiming rows (per-aggregate strict ordering across relays needs partitioning of the outbox or a single relay per shard).
- **Observability.** Alert on the age of the oldest unpublished row — you'd have caught the incident in minutes, not from complaints.
- **Recovery capacity.** After a 10-minute outage at 7 orders/s, ~4K rows drain in seconds; plan relay/consumer throughput for the backlog at your peak rate.`,
      followUps: [
        {
          "q": "The outbox table grows by millions of rows a day. How do you keep it from becoming a performance problem?",
          "a": "Use a partial index on unpublished rows (`CREATE INDEX ON outbox (id) WHERE published_at IS NULL`) so the relay's query stays small regardless of history. Remove published rows quickly: either delete them in the relay transaction, or partition the outbox by day and drop old partitions (dropping is cheaper than mass DELETE and avoids vacuum bloat). Keep a few days for debugging and replay if needed. Alternatively, use CDC (Debezium on the outbox table) and avoid polling altogether."
        },
        {
          "q": "With several relay instances using SKIP LOCKED, two events for the same order can be published out of order. When does that matter, and how do you fix it?",
          "a": "It matters when a consumer applies events as state transitions: `OrderCancelled` processed before `OrderPlaced` gets lost or misapplied. Relay A may lock rows 1–500 (including OrderPlaced) and relay B rows 501–1000 (including OrderCancelled), and B publishes first. Fixes: partition the outbox by `hash(aggregate_id) % N` and run one relay per partition, so each aggregate has a single ordered publisher; or have consumers check a per-aggregate version number and buffer or reject out-of-order events."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'rel-dr-iq-01',
      difficulty: 'hard',
      question:
        'The CFO asks you: "What should our RPO and RTO be, and what will it cost?" for a payments platform with a merchant dashboard, a ledger, and a reporting warehouse. How do you answer?',
      whatInterviewerLooksFor: [
        'Tiers per workload rather than one number for everything',
        'Translates business impact into RPO/RTO targets',
        'Maps targets to concrete DR strategies and costs',
        'Addresses reconciliation of the RPO gap for money data',
      ],
      modelAnswer: `### Start from business impact, per workload
| Workload | Cost of downtime | Cost of data loss | Target RPO | Target RTO |
|---|---|---|---|---|
| Payment API + ledger | Lost GMV (e.g. $50K/min), SLA credits, regulator scrutiny | Unacceptable: money movement must be reconstructable | ≤ 1–5 s (and **0 effective** via reconciliation) | ≤ 15 min region loss, ≤ 2 min AZ loss |
| Merchant dashboard | Annoyance, support tickets | Low (derived data) | 15 min | 1–4 h |
| Reporting warehouse | Delayed reports | None (rebuildable from sources) | 24 h | 24–48 h |

### Map to strategies
- **Ledger/payment API:** Multi-AZ synchronous (Aurora/RDS Multi-AZ) for AZ loss with automatic failover; **warm standby** in a second region with async replication (Aurora Global DB, lag typically < 1s) and pre-scaled compute at ~30–50% capacity. Cost ≈ +60–100% of the primary region's infra for this workload.
- **Dashboard:** pilot light — DB replica in DR region, compute provisioned on demand from IaC. +15–25%.
- **Warehouse:** backup & restore — snapshots copied cross-region, rebuild with IaC. +5%.

### Closing the RPO gap for money
Async replication means a region loss can lose the last ~1s of ledger writes. Make it *effectively* zero via **reconciliation**: PSP/bank webhooks and settlement files, idempotency keys from clients, outbox events. After failover, replay and reconcile before closing books.

### Make the numbers real
- RTO is measured in quarterly game days (region evacuation), not asserted.
- Restore drills daily for PITR (human-error RPO: seconds via WAL archiving; retention 35 days).
- Present cost vs expected loss: e.g. a 4-hour region outage every ~3 years × $50K/min ≈ $12M exposure vs ~$1M/yr for warm standby.`,
      followUps: [
        {
          q: 'Why not active-active for the ledger?',
          a: 'Ledger writes need strict invariants (no double spend); multi-writer requires either home-region ownership per account (possible, more complex) or cross-region consensus adding ~70–150ms per commit. Warm standby + reconciliation usually meets the target at lower complexity.',
        },
        {
          q: 'An engineer drops a table. Which of your mechanisms helps?',
          a: 'Not replication (replicates instantly) and not the DR region. PITR from base backup + WAL to the second before the drop, restored side-by-side and the table copied back.',
        },
      ],
      pitfalls: [
        'Quoting one RPO/RTO for the whole company',
        'Assuming replication covers human error',
        'Not measuring RTO through drills',
        'Ignoring cost when proposing active-active everywhere',
      ],
    },
    {
      id: 'rel-dr-iq-02',
      difficulty: 'expert',
      question:
        'Design an active-active multi-region setup (US + EU) for a shopping cart and user profile service. How do you handle write conflicts, a network partition between regions, and EU data residency?',
      whatInterviewerLooksFor: [
        'Chooses conflict strategy per data type (CRDT for carts, ownership for profiles)',
        'Handles partitions explicitly and explains behaviour on each side',
        'Designs residency into routing and replication',
        'Explains failover re-homing and its RPO',
      ],
      modelAnswer: `### Routing
- GeoDNS/anycast edge routes users to the nearest region; a small global **placement table** (userId → home region, residency) replicated everywhere.
- EU users' home is an EU region with DR in a second EU region; US similarly. **Personal data never replicates across the residency boundary**; global services only see pseudonymous IDs.

### Conflict strategy per data type
- **User profile (low write rate, invariants like unique email):** single **home region** per user. All writes are forwarded to home (a traveller in the US writing to an EU profile pays ~80ms extra, acceptable). No conflicts by construction.
- **Cart (high write rate, merge-friendly):** model as a **CRDT** — an OR-Set of line items with per-item PN-counters for quantity — so concurrent adds/removes from two regions (two devices) merge deterministically. Checkout (which needs a consistent snapshot, inventory, payment) is executed in the home region.
- Avoid LWW for anything where losing a write is user-visible.

### Network partition between regions
- Each region keeps serving users **homed** there; replication queues accumulate and catch up on heal.
- A user homed in EU but routed to US (roaming) during the partition: reads served from US replica if allowed (stale), writes either rejected with a friendly error or accepted into the CRDT cart (merged later). Profile writes fail — CP for that data.
- Leases/fencing for anything requiring a single owner (e.g. scheduled jobs per tenant).

### Region failure
- Re-home users of the failed region to its DR peer *within the same residency zone*. RPO = replication lag (typically < 1s); profile writes in that window may be lost → surface "please retry" and use idempotency keys.
- Failback: resync, then move ownership back in a controlled migration.

### Operations
- Replication lag dashboards per region pair, conflict-merge metrics, periodic region evacuation drills.`,
      followUps: [
        {
          q: 'How do you enforce a globally unique email if each user is owned by one region?',
          a: 'A small global uniqueness registry (hashed email → userId) on a consensus store spanning regions, or reserve-then-confirm with a TTL. It only stores a hash, which helps with residency.',
        },
        {
          q: 'Why not DynamoDB Global Tables for everything?',
          a: 'Global Tables historically resolve concurrent writes with last-writer-wins, silently losing one update. Fine for carts modelled carefully, dangerous for counters or invariants. It also replicates to every region in the table, which conflicts with residency unless you use separate tables per zone.',
        },
      ],
      pitfalls: [
        'Using LWW everywhere and hand-waving "eventual consistency"',
        'Ignoring residency when choosing failover regions',
        'Assuming partitions resolve themselves without defining per-side behaviour',
      ],
    },
    {
      id: 'rel-dr-iq-03',
      difficulty: 'hard',
      question:
        'At 2 a.m. the primary Postgres (RDS Multi-AZ) in your region fails. Walk me through what happens second by second, what your application sees, and what can go wrong.',
      whatInterviewerLooksFor: [
        'Understands managed failover mechanics (DNS flip, standby promotion)',
        'Knows application-side behaviour: pools, in-flight transactions, reconnection',
        'Mentions split-brain/fencing and RPO for sync vs async',
        'Proposes read-only degradation and post-failover checks',
      ],
      modelAnswer: `### Timeline (typical)
- **t=0:** primary host dies. In-flight transactions are aborted; uncommitted work is lost (committed work is safe — Multi-AZ replicates synchronously to the standby).
- **t≈10–30s:** RDS detects failure, promotes the standby in another AZ, updates the instance endpoint's DNS record (TTL ~5s) to the new primary.
- **t≈60–120s:** failover complete (Aurora typically < 30–60s).

### What the application sees
- Existing pooled connections hang or reset. Without TCP keepalive and query timeouts they can hang for minutes (TCP retransmission timeout). With \`statement_timeout\`/client timeouts they error quickly.
- New connections resolve DNS → until the record flips, they hit the dead IP (connect timeout matters: 1–2s, not 30s).
- Requests needing writes fail; if pools block on acquisition without a timeout, the whole service stalls (cascading failure).

### What good looks like
- Pool: \`connectionTimeoutMillis\` ~1s, idle/lifetime limits, validate on borrow; reconnect with **jittered backoff** so 200 pods don't stampede the new primary.
- Circuit breaker on write paths → fast 503 with Retry-After; **read-only mode** flag: serve reads from replicas/cache, queue non-critical writes (outbox/jobs).
- Idempotency keys on client-retried writes so retries after failover don't double-apply.

### What can go wrong
- **Split-brain:** managed RDS fences the old primary; with self-managed Patroni you rely on etcd leader leases and fencing (and watchdog) — misconfigured, both nodes accept writes.
- **Async replicas:** if the standby were async (self-managed streaming replication), you'd lose the lag window (RPO > 0).
- **Cold standby:** buffer cache empty → slow queries for minutes after failover.
- **Connection storm:** pool sizes × pods > max_connections on the new primary; use PgBouncer/RDS Proxy (RDS Proxy also shortens failover as seen by apps by holding client connections).
- **Read replicas** must re-point to the new primary; lag spikes.

### After
Verify replication topology, re-create a standby, reconcile any failed jobs, review alert timing (did we page within 1 minute?).`,
      followUps: [
        {
          q: 'The DNS flipped but some pods keep failing for 10 minutes. Why?',
          a: 'Long-lived connections still pointing to the old IP (no keepalive/lifetime), a client-side DNS cache, or a pool that never evicts broken connections. Fix with TCP keepalive, max lifetime, validation on borrow.',
        },
        {
          q: 'How would a network partition between AZs differ from a crash?',
          a: 'The old primary may still be alive and reachable by some clients. Without fencing, writes can land on both sides. Managed systems fence by revoking the old node; self-managed use quorum-based leader election with leases and STONITH.',
        },
      ],
      pitfalls: [
        'Assuming failover is instant and invisible to the app',
        'Forgetting about connection pools and DNS caching',
        'Not mentioning idempotency for retried writes',
      ],
    },
    {
      id: 'rel-dr-iq-04',
      difficulty: 'hard',
      question:
        'Your Redis cluster is used for page caching, user sessions, the API rate limiter and distributed locks for a nightly billing job. It goes down entirely for 20 minutes. What happens to each, and how should each have been designed?',
      whatInterviewerLooksFor: [
        'Differentiates behaviour per use case (fail-open vs fail-closed)',
        'Recognises DB stampede risk when the cache vanishes',
        'Addresses security implications for sessions/limits',
        'Suggests isolating critical uses onto separate clusters',
      ],
      modelAnswer: `### Page cache
- Cache hit ratio 95% → DB load jumps 20× → DB saturates → full outage. **Design:** fail-fast client (short command timeout, no offline queue), in-process L1 LRU for hot keys, request coalescing, DB concurrency cap, serve stale/CDN-cached pages. Size the DB to survive at least a partial cache loss, or shed load.

### Sessions
- Every authenticated request fails → all users logged out or 500s. **Design:** stateless signed tokens (short-lived JWT access tokens + refresh) so session validation doesn't need Redis; or replicate the session store (Redis with replicas across AZs + Sentinel/Cluster failover). If sessions are revocable only via Redis, choose fail-closed for sensitive actions and fail-open-with-JWT for browsing.

### Rate limiter
- **Fail-open** with a local per-pod in-memory limiter (global limit / pod count) for normal APIs; **fail-closed** (or strict local limit) for login/OTP endpoints where brute force is the threat. Never let the limiter's failure take down the API.

### Distributed locks for billing
- If the lock can't be acquired, the job must **not run** (fail-closed) — running twice could double-bill. Better: make the job idempotent (billing period + customer unique constraint in Postgres) and use a DB advisory lock or lease in the same database the job writes to, so correctness never depends on Redis.

### Structural fixes
- **Separate clusters per criticality** (cache vs sessions/limits vs coordination) — one failure mode shouldn't cross use cases.
- Redis Cluster/Sentinel across 3 AZs with replicas; ElastiCache Multi-AZ automatic failover (typically < 1 minute).
- Chaos test: "Redis unavailable for 5 minutes" in staging and then production with a small blast radius.`,
      followUps: [
        {
          q: 'After Redis comes back empty, what happens?',
          a: 'A cold-cache stampede: every key misses at once. Mitigate with gradual traffic ramp, request coalescing, pre-warming the top N keys, and staggered TTLs.',
        },
        {
          q: 'Is Redlock safe for the billing job?',
          a: 'Not for correctness under process pauses/clock issues; locks can expire while the holder still works. Use fencing tokens checked by the storage or DB-level constraints for correctness.',
        },
      ],
      pitfalls: [
        'Treating all Redis uses the same way',
        'Fail-open on login rate limits',
        'Relying on Redis locks for money correctness',
      ],
    },
    {
      id: 'rel-dr-iq-05',
      difficulty: 'medium',
      question:
        'The Kafka cluster that carries order, payment and notification events is unavailable for 45 minutes. What should happen to producers, consumers and the business, and how do you recover?',
      whatInterviewerLooksFor: [
        'Knows producer buffering limits and delivery.timeout.ms',
        'Proposes outbox or durable spooling for must-not-lose events',
        'Plans for backlog catch-up capacity and ordering',
        'Distinguishes critical vs droppable event streams',
      ],
      modelAnswer: `### Producers
- kafkajs/Java producers buffer in memory only briefly (\`buffer.memory\` 32MB default in Java; \`delivery.timeout.ms\` 120s default) — after that, sends fail. For 45 minutes you need a **durable buffer**:
  - **Transactional outbox** in the service's DB for business events (orders, payments): the request succeeds, the relay publishes later.
  - For high-volume telemetry/clickstream: local disk spool or accept loss (sample) — decide explicitly.
- Never block user requests on Kafka for critical flows; circuit-break the producer.

### Consumers
- Consumers idle; offsets are committed in Kafka, so they resume exactly where they stopped once the cluster returns.
- Side effects that must happen quickly (payment confirmation emails) are delayed; the UI should show "processing".

### Recovery
- Backlog = 45 min × produce rate. At 5K events/s → 13.5M events. Consumers must process faster than live traffic: with 3× headroom they drain in ~22 minutes (net drain rate 2× live → 45/2 ≈ 22.5 min).
- Scale consumer groups up to the partition count; consider temporarily pausing non-critical consumers to prioritise critical topics.
- Watch downstream systems (DB, email provider rate limits) during catch-up; throttle consumers if needed.
- Ordering per key is preserved as long as the outbox relay publishes in commit order per aggregate.

### Prevention
- RF=3, min.insync.replicas=2, rack awareness across 3 AZs; managed Kafka with multi-AZ; MirrorMaker 2 / cluster linking to a DR cluster for region loss (async; consumer offsets translation needed).`,
      followUps: [
        {
          q: 'Why is a 45-minute outage unlikely with RF=3 across 3 AZs, and what could still cause it?',
          a: 'Single broker or AZ loss is tolerated. Full outages usually come from correlated causes: bad config/upgrade on all brokers, controller/KRaft quorum loss, disk full everywhere, expired certificates, or network/security-group changes.',
        },
        {
          q: 'Consumers restart and reprocess some events. Problem?',
          a: 'Expected under at-least-once; consumers must be idempotent (dedupe on event ID with a processed-events table or upserts).',
        },
      ],
      pitfalls: [
        'Assuming the producer "retries until it works"',
        'Forgetting catch-up capacity and downstream limits',
        'Blocking checkout on Kafka availability',
      ],
    },
    {
      id: 'rel-dr-iq-06',
      difficulty: 'expert',
      question:
        'Your company runs in us-east-1 with a warm standby in us-west-2. Leadership wants a credible plan for "us-east-1 is gone for 8 hours". Walk me through the plan, including an AZ-level failure first, and the pitfalls you expect in the first real exercise.',
      whatInterviewerLooksFor: [
        'Distinguishes AZ loss (automatic, static stability) from region loss (runbook, human decision)',
        'Covers data, traffic, dependencies, people and permissions',
        'Knows DNS/TTL and connection pinning issues',
        'Emphasises rehearsal and measured RTO',
      ],
      modelAnswer: `### AZ loss (should need no humans)
- Capacity pre-provisioned so 2 of 3 AZs carry 100% (each runs at ≤ ~66%).
- Multi-AZ DB failover automatic; Kafka rack-aware; stateless pods spread with topology spread constraints.
- For gray failures, **zonal shift** the AZ out of load balancers.

### Region loss plan
1. **Detection:** synthetic checks from outside us-east-1 (other regions, third-party). Criteria agreed beforehand: e.g. "SLO burn for 15 minutes and provider gives no ETA" → evacuate.
2. **Decision:** incident commander has authority; no committee.
3. **Data:** promote the Aurora Global secondary in us-west-2 (managed failover); fence the old writer. Kafka: consumers in west start from MirrorMaker-translated offsets. S3: CRR-replicated buckets; accept object lag.
4. **Compute:** warm standby at ~30–50%; scale to 100% — **quotas pre-raised**, AMIs/images in regional registries, capacity reservations for critical tiers.
5. **Traffic:** Route 53 ARC routing controls (data plane) or pre-configured failover records; avoid depending on control-plane API calls in the failed region.
6. **Validate:** smoke tests, business KPIs (orders/min), then declare.
7. **Reconcile:** replay the RPO window (~1s of DB writes, some queued events) from PSP webhooks/outbox; later failback in a planned window.

### Pitfalls I expect in the first exercise
- **DNS tail:** resolvers and clients honour TTLs loosely; mobile apps with pinned IPs/long-lived connections keep hitting east. Pooled connections and gRPC channels don't re-resolve until reconnect.
- **Hidden east dependencies:** CI/CD, artifact registry, secrets manager, KMS keys, IAM Identity Center, third-party webhooks allow-listing east IPs, SaaS vendors in east.
- **Capacity:** quota limits and instance shortage when everyone evacuates at once.
- **People:** on-call lacking permissions in the DR account; runbook steps out of date.
- **Data:** replication was broken for weeks and nobody noticed (no lag alert).

### Make it credible
Quarterly game days with a real traffic shift (start with 5% of traffic, then full evacuation off-peak), measured RTO/RPO published to leadership.`,
      followUps: [
        {
          q: 'Why not automate cross-region failover fully?',
          a: 'False positives are costly: a transient blip triggering failover loses the RPO window and causes a disruptive failback. Automate every step, but gate the trigger with a human or very conservative multi-signal criteria.',
        },
        {
          q: 'Your TTL is 60s but 5% of traffic still hits east after 30 minutes. What do you do?',
          a: 'Make the east endpoint actively reject/redirect (if reachable), fix clients with long-lived connections (max connection age), and consider anycast/Global Accelerator where the IP stays the same and the edge reroutes.',
        },
      ],
      pitfalls: [
        'Assuming DNS failover is instant',
        'Ignoring control-plane and quota dependencies',
        'No distinction between AZ and region strategies',
      ],
    },
    {
      id: 'rel-dr-iq-07',
      difficulty: 'expert',
      question:
        'A bad config push to your multi-tenant SaaS took down all 3,000 customers for 2 hours. The CTO asks how to ensure the next incident affects at most 5% of customers. What architecture do you propose?',
      whatInterviewerLooksFor: [
        'Proposes cell-based architecture with sizing',
        'Covers deployment/config waves per cell',
        'Designs a simple, statically stable router',
        'Mentions shuffle sharding and isolation of large tenants',
        'Acknowledges the operational costs',
      ],
      modelAnswer: `### Cells
- Partition customers into **≥ 20 cells** (5% blast radius each); each cell is a full stack: LB, app services, DB, cache, queues — no shared data stores between cells.
- **Fixed maximum cell size** determined by load tests (e.g. 200 tenants or X RPS). Grow by adding cells.
- Very large or noisy tenants get **dedicated cells**; the long tail is hashed across standard cells.

### Cell router
- Thin layer (edge/gateway) mapping tenant → cell from a replicated, cached table; **statically stable** — keeps working with last known mapping if the control plane is down.
- No business logic in the router; it's the one shared component so it must be the simplest.

### Change management (the actual root cause)
- **Every change — code, config, feature flags, infra — deploys cell by cell:** canary cell (internal tenants) → 1 cell → 5% → 25% → 100%, with automated bake time and SLO-based rollback.
- Config treated like code: validated, versioned, staged rollout; no "global" config button.

### Shared-layer risks
- Identity, billing, the control plane are cross-cell: make them non-critical for the data path (cached tokens, static stability) or cell them too.

### Shuffle sharding for shared worker pools
- Where cells share pools (e.g. an async processing fleet), assign each tenant k of n workers so a poison tenant only affects tenants sharing its exact combination.

### Costs to acknowledge
- More infrastructure baseline (per-cell overhead), more deployment steps, cell migration tooling, cross-cell analytics via a separate pipeline. Worth it at 3,000 customers where a 2-hour global outage is existential.`,
      followUps: [
        {
          q: 'How do you move a tenant between cells?',
          a: 'Copy data to the target cell (snapshot + change stream), dual-read or block writes briefly, flip the router mapping, verify, then clean up. Needs per-tenant data partitioning from the start.',
        },
        {
          q: 'How is this different from sharding a database?',
          a: 'Sharding splits only the data layer; compute and other dependencies are shared and can still fail globally. Cells split the entire stack and the deployment unit.',
        },
      ],
      pitfalls: [
        'Only sharding the database and calling it a cell',
        'Global config pushes that bypass cells',
        'A smart, heavy router that becomes a single point of failure',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'rel-dr-boe-1',
      question:
        'Your Postgres database is 5 TB with ~400 GB of WAL generated per day. Nightly base backups go to S3. Estimate the RTO for a full restore after an accidental DROP TABLE at 17:00, and decide whether a 1-hour RTO target is realistic.',
      assumptions: [
        'Restore throughput from S3 to a fresh volume ≈ 500 MB/s (parallel pgBackRest)',
        'WAL replay ≈ 100 MB/s (single-threaded replay, IO-dependent)',
        'Base backup taken at 01:00; drop at 17:00 → 16 h of WAL to replay',
        'Plus ~15 min for detection, decision, provisioning and validation',
      ],
      steps: [
        { label: 'Base restore', calc: '5 TB ÷ 500 MB/s = 5,000,000 MB ÷ 500 ≈ 10,000 s ≈ 2.8 h' },
        { label: 'WAL to replay', calc: '400 GB/day × 16/24 ≈ 267 GB' },
        { label: 'WAL replay time', calc: '267,000 MB ÷ 100 MB/s ≈ 2,670 s ≈ 45 min' },
        { label: 'Overheads', calc: '≈ 15 min' },
        { label: 'Total RTO', calc: '2.8 h + 0.75 h + 0.25 h ≈ 3.8 h' },
      ],
      answer:
        'About 3.5–4 hours. A 1-hour RTO is not achievable with full-cluster restore from nightly backups; it would need a delayed replica (e.g. recovery_min_apply_delay = 1h to pause before the bad write), more frequent base backups, or restoring side-by-side and copying just the dropped table.',
      insight:
        'Restore time scales with data size, so large databases need recovery paths that avoid a full restore: delayed replicas, storage snapshots, table-level recovery. Only a measured drill gives the real number.',
      followUps: [
        {
          "q": "You add a delayed replica with a 1-hour apply delay. The DROP is noticed at 17:20. What's the recovery time now?",
          "a": "At 17:20, the delayed replica has applied WAL up to about 16:20. Pause replay, set `recovery_target_time = '16:59:59'` and resume. It needs to replay 40 minutes of WAL: 400 GB × 40/1,440 ≈ 11 GB, which at 100 MB/s is about 111 s, about 2 minutes. Then copy the table out (`pg_dump -t` and restore into the primary), which for a typical table takes minutes. Total is roughly 15–30 minutes including decisions, compared with ~3.8 hours, well inside the 1-hour RTO. The cost is one more replica."
        },
        {
          "q": "The database grows to 20 TB in two years. What happens to the full-restore RTO, and does anything else break?",
          "a": "Base restore becomes 20,000,000 MB ÷ 500 MB/s = 40,000 s ≈ 11.1 hours. With ~45 minutes of WAL replay and 15 minutes of overhead, that's about 12 hours. A full restore stops being a usable DR path for anything except total loss. Nightly base backups also take longer to create and may overlap peak hours. Move to incremental or differential backups, storage-level snapshots (EBS snapshots restore lazily in minutes, with slow first reads), and archive cold partitions so the hot database stays small."
        }
      ],
    },
    {
      id: 'rel-dr-boe-2',
      question:
        'A service needs 30,000 RPS at peak. Each pod handles 500 RPS at the target utilisation. It runs across 3 AZs and must survive the loss of one AZ with no scaling action. How many pods do you need, and what does it cost versus a non-statically-stable design?',
      assumptions: [
        '500 RPS/pod at target utilisation (already includes normal headroom)',
        'Load spread evenly across AZs',
        'Autoscaling during an AZ event is not relied upon',
      ],
      steps: [
        { label: 'Pods for peak (no AZ loss)', calc: '30,000 ÷ 500 = 60 pods → 20 per AZ' },
        { label: 'Survivors must carry full peak', calc: '2 AZs × P pods ≥ 60 → P = 30 pods per AZ' },
        { label: 'Total statically stable', calc: '3 × 30 = 90 pods' },
        { label: 'Overhead', calc: '90 ÷ 60 = 1.5× = n/(n−1) for n = 3' },
        { label: 'With 4 AZs', calc: '60 ÷ 3 = 20 per AZ → 80 pods → 1.33×' },
      ],
      answer:
        '90 pods (30 per AZ) versus 60 without AZ-loss headroom — 50% more capacity. Using 4 AZs lowers that to 80 pods (33% overhead).',
      insight:
        'Static stability has a precise price, n/(n−1). You can lower it with more AZs, or by only keeping critical tiers statically stable and letting batch/background tiers degrade during an AZ event.',
      followUps: [
        {
          "q": "Black Friday peak is 60,000 RPS. Can you rely on autoscaling to add the AZ-loss headroom on the day?",
          "a": "No. Static stability means not depending on the control plane during the event, and on peak day capacity may also be scarce. Normal peak needs 60,000 ÷ 500 = 120 pods; to survive losing an AZ, the surviving 2 AZs must hold 120 pods, so 60 per AZ, 180 in total. Pre-scale to 180 a day ahead (scheduled scaling), confirm EC2 and IP quotas and capacity reservations, and keep them until the peak passes. The extra cost is a few days of 60 additional pods, which is cheap insurance."
        },
        {
          "q": "Finance wants to cut the 50% overhead. Only checkout (12,000 of the 30,000 RPS) must survive an AZ loss. Redo the numbers.",
          "a": "Checkout: 12,000 ÷ 500 = 24 pods, statically stable needs 3 × 12 = 36 pods (12 per AZ, so 2 AZs carry 24). Non-critical (browse, search, recommendations): 18,000 ÷ 500 = 36 pods, 12 per AZ with no headroom. Total = 72 pods instead of 90, a 20% saving. In an AZ loss, the non-critical tier drops to 24 pods (two-thirds capacity), so it must shed: degrade recommendations, serve cached pages, rate-limit search, while checkout stays at full capacity."
        }
      ],
    },
    {
      id: 'rel-dr-boe-3',
      question:
        'Estimate cross-region replication bandwidth, monthly transfer cost and the RPO exposure for an order database doing 5,000 writes/s at peak (2,000 average) with ~2 KB of replicated change per write.',
      assumptions: [
        'Replicated bytes ≈ WAL/binlog volume ≈ 2 KB per write (row + index changes)',
        'Cross-region transfer ≈ $0.02/GB',
        'Typical async lag 500 ms, spikes to 5 s during peaks',
      ],
      steps: [
        { label: 'Peak bandwidth', calc: '5,000 × 2 KB = 10 MB/s ≈ 80 Mbps' },
        { label: 'Average daily volume', calc: '2,000 × 2 KB = 4 MB/s × 86,400 ≈ 346 GB/day' },
        { label: 'Monthly transfer cost', calc: '346 GB × 30 ≈ 10.4 TB × $0.02/GB ≈ $208/month' },
        { label: 'RPO exposure (typical)', calc: '0.5 s × 5,000 writes/s = 2,500 writes at risk at peak' },
        { label: 'RPO exposure (lag spike)', calc: '5 s × 5,000 = 25,000 writes at risk' },
      ],
      answer:
        'About 80 Mbps at peak, ~10 TB/month (~$200/month) in transfer, and a region loss at peak could lose ~2.5K writes normally, up to ~25K during lag spikes.',
      insight:
        'Bandwidth and cost are rarely the blocker; lag is. Alert on replication lag against the RPO target and design reconciliation (idempotent client retries, outbox/webhook replay) for the writes that can be lost.',
      followUps: [
        {
          "q": "A nightly backfill rewrites 500M rows (~2 KB each) in 2 hours. What does it do to replication and RPO?",
          "a": "500M × 2 KB = 1 TB in 7,200 s ≈ 139 MB/s ≈ 1.1 Gbps of WAL, about 14× the normal peak. If the cross-region path or the replica's apply rate can't keep up, lag grows for the whole 2 hours, possibly to many minutes, so a region loss during the backfill loses far more than 25K writes. It also adds ~1 TB × $0.02 = $20 per run in transfer. Throttle the backfill on replication lag (pause when lag exceeds e.g. 5 s) and run it off-peak."
        },
        {
          "q": "The business says losing up to 25,000 orders in a region loss is unacceptable, but synchronous replication is too slow. What do you do about the writes that might be lost?",
          "a": "Make them recoverable from outside the database. Clients send an idempotency key with every order and keep a local pending record until they see confirmation, so after failover they can safely retry. Payment providers hold their own record of successful charges, so a reconciliation job compares the provider's charges against orders in the surviving region and recreates missing orders from them. Emit order events to a separately replicated log as well. RPO stays a few seconds for the DB, but the business outcome becomes 'delayed', not 'lost'."
        }
      ],
    },
  ],
  test: [
    {
      id: 'rel-dr-mcq-01',
      difficulty: 'hard',
      question:
        'An engineer runs the statement below on the primary at 10:42:00. You have a synchronous Multi-AZ standby, two async read replicas (lag ~200 ms) and daily snapshots with continuous WAL archiving. What is the best recovery path?',
      code: {
        language: 'sql',
        code: `-- intended: WHERE customer_id = 42
UPDATE subscriptions SET status = 'cancelled';
-- UPDATE 1843211   (autocommit)`,
      },
      options: [
        'Point-in-time restore to 10:41:59 into a new instance, then copy the affected rows back',
        'Promote the read replica with the highest lag, since it may not have applied the UPDATE yet',
        'Fail over to the synchronous standby, which still has the old data',
        'Restore last night\'s snapshot over the primary',
      ],
      correct: [0],
      explanation:
        'Synchronous standby has the UPDATE already; replicas lagging a few seconds almost certainly applied it too, and promoting one discards all other writes since. PITR to just before the statement, restored side-by-side, lets you repair only the affected rows. Restoring last night\'s snapshot over the primary loses a day of writes.',
      followUps: [
        {
          "q": "The PITR instance is up at 10:41:59. Customers have legitimately updated some of the same rows between 10:42 and now. How do you copy the data back without clobbering their changes?",
          "a": "Don't blanket-overwrite. Join the restored table to production on the primary key and classify each row: rows where production still equals the bad UPDATE's result (and `updated_at` is the 10:42 timestamp) can be restored from the PITR copy; rows changed after 10:42 by real users need a field-level merge or manual review. Do it in a transaction per batch, write the before/after into an audit table so the fix itself can be undone, and have the service owner sign off on the conflict list."
        },
        {
          "q": "How would you make this class of incident recoverable in minutes instead of a PITR restore that takes hours?",
          "a": "Keep a delayed replica (`recovery_min_apply_delay = '1h'`): when someone runs a bad statement, pause replay, roll forward to just before it with `recovery_target_time`, and copy rows out, without restoring terabytes. Also reduce the chance in the first place: no ad-hoc writes on the primary without a reviewed script, `BEGIN` plus row-count check before `COMMIT`, a `statement_timeout`, and soft-delete or history tables (temporal triggers) on critical data so the old values sit right next to the new ones."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-02',
      difficulty: 'medium',
      question:
        'A request path requires five independent services in series, each with 99.9% availability. What is the approximate end-to-end availability and monthly downtime?',
      options: [
        '99.9%, about 43 minutes per month',
        '95%, about 36 hours per month',
        '99.99%, about 4 minutes per month',
        '99.5%, about 3.6 hours per month',
      ],
      correct: [3],
      explanation:
        '0.999^5 ≈ 0.995, and 0.5% of a 30-day month is ≈ 3.6 hours. Serial dependencies multiply availabilities; they don\'t keep the individual value (99.9%) and don\'t improve it (99.99% would be the parallel case). 95% would require 1% unavailability per service.',
      followUps: [
        {
          "q": "The SLO is 99.95% for this path and you can't make the five services individually more reliable. What architectural options do you have?",
          "a": "Shorten or weaken the serial chain. Make non-essential dependencies optional with fallbacks (recommendations or reviews fail → render without them), which takes them out of the product. Cache or replicate data needed on the read path so a dependency outage doesn't block reads. Move some calls asynchronous (enqueue and return). Add redundancy where possible: two independent instances in parallel give 1 − 0.001² ≈ 99.9999%. If only 3 calls stay hard dependencies, 0.999³ ≈ 99.7%; to reach 99.95% the remaining hard dependencies need about 99.99% each."
        },
        {
          "q": "Each service measures 99.9% but users report the page broken far more often than 3.6 hours a month. Why could the real number be worse?",
          "a": "The multiplication assumes independent failures, but failures are often correlated: shared databases, the same DNS, the same deploy pipeline, or one region's network all take several services down together, sometimes helping and sometimes hurting the math. More often the gap is measurement. Services measure availability at their own server (excluding timeouts the caller saw, retries, and client-side errors), while users experience the slowest dependency plus network. Measure availability where the user is (synthetic probes and RUM) and count slow responses beyond the timeout as failures."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-03',
      difficulty: 'expert',
      question:
        'A DR design keeps a replicated Aurora Global secondary in the DR region, and the application stack there is defined in Terraform but has zero running instances. What is this strategy and its typical recovery profile?',
      options: [
        'Warm standby — RTO seconds because compute is ready',
        'Backup & restore — RPO hours, RTO a day',
        'Pilot light — RPO seconds (replicated data), RTO tens of minutes to provision and scale compute',
        'Active-active — RPO ≈ 0 because the database is global',
      ],
      correct: [2],
      explanation:
        'A live data layer with dormant compute is the pilot light pattern: data is current (RPO ≈ replication lag) but compute must be provisioned and warmed (RTO tens of minutes). Warm standby has the full stack running at reduced capacity; backup & restore has no live replica; active-active serves traffic in both regions.',
      followUps: [
        {
          "q": "Leadership wants RTO under 5 minutes but won't pay for warm standby. What can you change in the pilot light to get closer?",
          "a": "Compute provisioning is the slow part, so pre-stage it: keep AMIs/images in the DR region's registry, pre-create load balancers, security groups, DNS records and IAM, and keep an auto scaling group at minimum size 0 that only needs a desired-count change. Raise service quotas in DR beforehand, since quota increases are slow during a regional event. Container platforms help (Fargate or a small EKS cluster that's already running scales pods in a few minutes). Even then, scaling to full capacity and warming caches takes 10–20 minutes, so be honest that sub-5 minutes really means warm standby."
        },
        {
          "q": "How do you know the DR Terraform will actually work on the day you need it?",
          "a": "Run it regularly: apply the DR stack on a schedule (e.g. monthly), run smoke tests against it with real traffic replayed or synthetic transactions, then tear it down, timing each step against the RTO. Run `terraform plan` against the DR region in CI on every change so drift (a module that only works in us-east-1, hard-coded AMI IDs, missing KMS keys) fails the pipeline immediately. Any manual step discovered in a drill becomes code or a runbook item."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-04',
      difficulty: 'expert',
      question:
        'After a regional failover via DNS (TTL 60s), 20 minutes later a subset of backend services is still writing to the old primary database in the failed region, which came back briefly. Select ALL plausible causes.',
      options: [
        'Pooled DB connections established before failover were never closed and never re-resolved DNS',
        'The old primary was not fenced, so it accepted writes when it became reachable again',
        'DNS TTL of 60s guarantees all clients switch within 60s, so this must be an application bug unrelated to DNS',
        'Some runtimes or resolvers cache DNS results longer than the TTL',
        'Aurora automatically merges writes from both primaries after failover',
      ],
      correct: [0, 1, 3],
      explanation:
        'Long-lived connections bypass DNS entirely; resolvers/runtimes can cache beyond TTL; and without fencing the old writer accepts writes — the recipe for split-brain. A TTL is advisory, not a guarantee. No managed database merges divergent primaries; the divergent writes must be reconciled manually.',
      followUps: [
        {
          "q": "Some writes landed on the old primary during those 20 minutes. How do you find and reconcile them?",
          "a": "Snapshot the old primary first (don't delete it). Find its divergence point (the LSN where the new primary was promoted) and extract everything after it: logical decoding from that LSN, or rows with `updated_at` after the failover time if WAL isn't usable. Compare each row with the new primary: rows untouched there can be replayed; conflicting rows need business rules (orders: keep both and flag; balances: recompute from the ledger). Notify affected customers if needed, then rebuild the old primary as a replica with `pg_rewind`."
        },
        {
          "q": "How would you fence the old primary so this can't happen again, even if it comes back?",
          "a": "Use several layers. Have the failover orchestrator revoke the old primary's ability to accept writes: stop the instance or detach its network (STONITH), or set it read-only. Use a lease: the primary may only accept writes while holding a lock in a consensus store (etcd/ZooKeeper, as Patroni does), so it demotes itself when it can't renew. Rotate or disable the DB credentials the apps use for the old endpoint. On the client side, set connection max-lifetime (e.g. 5 minutes) and re-resolve DNS on reconnect, so pools can't stay attached indefinitely."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-05',
      difficulty: 'hard',
      question:
        'Which conflict-resolution choice is most appropriate for a multi-region active-active wallet balance?',
      options: [
        'Home-region ownership per wallet, so all balance mutations for a wallet are serialized in one region',
        'A CRDT PN-counter on the balance so concurrent debits merge',
        'Last-writer-wins on the balance attribute using server timestamps',
        'Let each region keep its own balance and reconcile nightly',
      ],
      correct: [0],
      explanation:
        'Balances carry an invariant (never below zero) that requires serialized checks; single-region ownership per wallet provides that. LWW silently loses a debit or credit. A PN-counter merges correctly but cannot enforce "balance ≥ 0" across concurrent debits in two regions. Nightly reconciliation allows double spends during the day.',
      followUps: [
        {
          "q": "A user whose wallet is homed in us-east travels to Europe. Every debit now crosses the Atlantic. How do you handle latency and the case where us-east is down?",
          "a": "The latency (~80–100 ms per write) is usually acceptable for payments. If they settle in Europe, re-home the wallet: freeze writes briefly, wait for replication to catch up, move ownership to eu-west, and unfreeze. If us-east is down, the wallet is unavailable for writes; that's the CP choice. You can soften it with a bounded allowance: let the other region approve small debits up to a pre-reserved amount (e.g. a $50 'escrow' that us-east already moved to EU ownership), and reconcile later."
        },
        {
          "q": "Why can't you just use a CRDT and check 'balance ≥ 0' locally in each region?",
          "a": "Each region checks against its own view. With $100 balance, us-east approves a $80 debit and eu-west approves a $70 debit concurrently; each sees $100 and passes. After the PN-counter merges, the balance is −$50. Invariants spanning concurrent operations need coordination. The CRDT-friendly workaround is escrow: split the balance into per-region allowances ($50 each), let each region spend only its share locally, and transfer allowance between regions through a coordinated operation."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-06',
      difficulty: 'expert',
      question: 'What happens to this client when Redis becomes unreachable for 30 seconds under 5,000 RPS per pod?',
      code: {
        language: 'typescript',
        code: `import Redis from 'ioredis';
const redis = new Redis({ host: 'cache.internal' }); // all defaults

app.get('/product/:id', async (req, res) => {
  const cached = await redis.get('p:' + req.params.id);
  if (cached) return res.json(JSON.parse(cached));
  res.json(await loadFromDb(req.params.id));
});`,
      },
      options: [
        'Each get() rejects immediately and requests fall through to the database',
        'The process crashes immediately due to an unhandled error event, which Kubernetes restarts',
        'ioredis automatically routes reads to a replica',
        'Commands are queued in the offline queue and retried across reconnects, so requests stall and memory grows until Redis returns or retries are exhausted',
      ],
      correct: [3],
      explanation:
        'By default ioredis enables the offline queue and uses maxRetriesPerRequest = 20, so commands wait through reconnect attempts; at 5,000 RPS tens of thousands of requests pile up in memory with no response. They don\'t fail fast (that needs enableOfflineQueue: false / small maxRetriesPerRequest); replica routing requires Cluster/Sentinel config; missing error listeners log warnings rather than crash the process in ioredis.',
      followUps: [
        {
          "q": "You set `enableOfflineQueue: false` and `maxRetriesPerRequest: 1`. Now every cache miss during the outage hits the DB. Is that safe?",
          "a": "Only if the DB can take it. With Redis absorbing 95% of reads, a full miss can multiply DB load by ~20×. Fail-fast fixes the memory problem but moves the pressure to the database. Pair it with request coalescing (one DB query per key), a small in-process LRU serving hot keys (stale is fine for 30 s), and a concurrency cap on DB calls that sheds or serves stale beyond it. Then a Redis outage becomes a latency blip with some stale data instead of a DB outage."
        },
        {
          "q": "How would you test this behaviour before production does it for you?",
          "a": "Use fault injection in staging under realistic load: run the load test at production RPS and then block Redis (Toxiproxy `timeout` toxic or a `NetworkPolicy` denying egress to 6379) for 30 s. Assert: pod memory stays flat (no queue growth), p99 latency stays under the agreed budget, error rate stays bounded, DB CPU stays under ~80%, and recovery is automatic when Redis returns. Also test the slow case (Redis responds in 500 ms rather than not at all), which often behaves worse than hard down."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-07',
      difficulty: 'hard',
      question:
        'You run 3 AZs at 80% utilisation each. One AZ fails and autoscaling cannot launch instances because the regional control plane is impaired. What happens?',
      options: [
        'Nothing noticeable; the remaining AZs absorb the load at 80%',
        'Remaining AZs receive 120% of their capacity; without load shedding they overload and latency/errors spike',
        'The load balancer automatically throttles to 80% of traffic',
        'Traffic automatically shifts to another region',
      ],
      correct: [1],
      explanation:
        'Total load is 3 × 80% = 240% of one AZ; spread over 2 AZs that is 120% each — beyond capacity. Static stability requires running ≤ ~66% per AZ with 3 AZs. Load balancers don\'t throttle to capacity by default, and cross-region shift isn\'t automatic.',
      followUps: [
        {
          "q": "Utilisation is 80% because finance cut capacity. Without adding instances, what can you do to survive an AZ loss?",
          "a": "Shed load deliberately rather than everywhere: classify traffic by priority (checkout > browse > recommendations > batch) and configure the gateway to drop the lowest classes first when the remaining AZs saturate, so 120% demand becomes ~95% admitted with critical paths protected. Turn off expensive optional features via flags during an AZ event. Move batch and async work to queues that simply slow down. Being statically stable for the critical tier only (e.g. checkout at ≤ 66%) is much cheaper than for everything."
        },
        {
          "q": "The AZ comes back after 2 hours. What can go wrong when traffic returns to it?",
          "a": "Recovering capacity can cause a second incident: cold caches and empty connection pools in the recovered AZ, with the load balancer sending a full third of traffic immediately; pods that came back in a half-broken state passing shallow health checks; and a thundering herd of queued retries and backlogged jobs. Shift traffic back gradually (weighted, 10% → 33% over 15–30 minutes), use slow-start on the load balancer, require deep readiness checks, and watch error rates per AZ during the ramp."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-08',
      difficulty: 'expert',
      question: 'Which statements about this backup setup are true? Select ALL that apply.',
      code: {
        language: 'bash',
        code: `# cron on the DB host, 02:00 daily
pg_dump -Fc app > /var/backups/app-$(date +%F).dump
aws s3 cp /var/backups/app-$(date +%F).dump s3://prod-backups/   # same AWS account
find /var/backups -mtime +7 -delete`,
      },
      options: [
        'RPO for an accidental DELETE is up to ~24 hours',
        'A compromised production admin credential could delete both the database and all backups',
        'This provides point-in-time recovery to any second within 7 days',
        'Nothing detects a silently failing or corrupt dump until someone tries to restore',
        'pg_dump -Fc holds an exclusive lock that blocks writes for the duration',
      ],
      correct: [0, 1, 3],
      explanation:
        'Daily logical dumps give RPO up to a day, no PITR (that needs WAL archiving), and same-account, non-immutable storage means an attacker or mistake can delete everything. No verification or restore test means failures go unnoticed — the GitLab 2017 failure mode. pg_dump takes an ACCESS SHARE lock and a consistent snapshot; it doesn\'t block normal writes (only DDL like ALTER/DROP).',
      followUps: [
        {
          "q": "Redesign this backup setup for RPO ≤ 5 minutes and resilience against a compromised production admin account.",
          "a": "Switch to physical backups with continuous WAL archiving (pgBackRest or WAL-G): a weekly full and daily incremental base backup, and WAL pushed every 60 s or 16 MB (`archive_timeout = 60`), which gives point-in-time recovery with RPO about a minute. Write backups to a separate AWS account the production role can only `PutObject` into, with S3 Object Lock in compliance mode (e.g. 35-day retention) so nobody can delete them early, including root. Encrypt with a KMS key owned by the backup account. Alert if the newest WAL segment in the bucket is older than 5 minutes."
        },
        {
          "q": "How do you prove backups are restorable without waiting for a disaster?",
          "a": "Automate restores: a scheduled job (daily for critical DBs) restores the latest backup plus WAL into a scratch instance, runs `pg_amcheck`/integrity checks, compares row counts and checksums of key tables against production at the recovery point, runs a few application queries, records the restore time as a metric, then destroys the instance. Alert if the job fails or the restore time exceeds the RTO. The measured restore duration is the RTO number to report to leadership."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-09',
      difficulty: 'hard',
      question:
        'Your primary region is lost. Consumers fail over to the DR Kafka cluster, which MirrorMaker 2 fed asynchronously (replication lag ~2 s, consumer-offset checkpoints every 60 s, DefaultReplicationPolicy). Select ALL that apply after the failover.',
      options: [
        'Events produced in the last ~2 s before the outage may be missing in DR, so RPO is seconds, not zero',
        'Consumers resume from translated offsets that can be up to ~60 s behind, so they re-process some events and must be idempotent',
        'Offsets are identical in both clusters, so consumers resume exactly where they stopped',
        'Mirrored topics are named with the source-cluster alias (e.g. primary.orders), so consumers must subscribe to the renamed topic or a pattern',
        'MirrorMaker 2 gives exactly-once delivery across clusters, so there is no loss and no duplication',
      ],
      correct: [0, 1, 3],
      explanation:
        'Asynchronous mirroring means the last few seconds of writes can be lost (RPO ≈ replication lag). Offsets differ between clusters; MM2 translates them through checkpoints emitted periodically, so consumers restart from the last checkpoint and duplicates are expected, which is why consumers must be idempotent. DefaultReplicationPolicy prefixes remote topics with the source alias (IdentityReplicationPolicy keeps the names but makes active-active loops harder). Even with exactly-once enabled for the mirroring itself (Kafka 3.5+), async lag and checkpoint intervals still cause loss and duplicates at failover, so both must be planned for.',
      followUps: [
        {
          "q": "The primary region comes back. How do you fail back to the original Kafka cluster without losing what was produced in DR?",
          "a": "Treat failback as a planned migration. Set up MirrorMaker 2 in the reverse direction (DR → primary) and let it catch up on everything produced during the outage. Then move producers back to the primary, wait for the remaining DR traffic to mirror over, and switch consumers using translated offsets for the DR-produced topics (`dr.orders`) and the original topics. Events produced in the primary's last seconds before the outage that never reached DR need reconciliation against the source database (e.g. replay from the outbox)."
        },
        {
          "q": "How would you make consumers idempotent enough to tolerate ~60 s of replay after failover?",
          "a": "Give every event a stable ID assigned at the source (e.g. the outbox row's event ID), not a Kafka offset, since offsets differ between clusters. Consumers record processed IDs in the same transaction as their side effect (a `processed_events(event_id PRIMARY KEY)` table, `INSERT … ON CONFLICT DO NOTHING`, and skip if 0 rows inserted). For external side effects (emails, payments), pass the event ID as the idempotency key to the provider. Keep dedup records longer than the maximum replay window, e.g. 7 days."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-10',
      difficulty: 'medium',
      question:
        'Your multi-tenant SaaS has 10 cells. A poison-pill request from one tenant crashes all application pods that process it. What is the expected blast radius compared with a single shared fleet?',
      options: [
        'About 10% of tenants — only the cell hosting that tenant is affected',
        '100% of tenants, since cells share the same code',
        '0% because cells automatically reject poison requests',
        '50%, because cells are paired for redundancy',
      ],
      correct: [0],
      explanation:
        'Cells run the same code but independent fleets; a poison request only reaches the cell the router maps that tenant to, so ~1/N (10%) of tenants are affected, versus everyone on a shared fleet. Cells don\'t automatically detect poison requests, and they aren\'t paired by default.',
      followUps: [
        {
          "q": "Your biggest tenant generates 30% of all traffic. How does that fit a 10-cell design?",
          "a": "It doesn't fit evenly: a cell sized for 1/10 of traffic can't hold 30% of it. Options: give the whale a dedicated, larger cell (and accept that its blast radius is 30% of traffic but only one customer); or split the whale across several cells by a sub-key (workspace or region), if its data allows. Size cells by a maximum capacity rather than by tenant count, and let the placement service assign tenants based on measured load. A whale on a dedicated cell also stops noisy-neighbour effects on small tenants."
        },
        {
          "q": "Cells isolate failures, but a deploy goes to all 10 cells. How do you roll out so a bad release can't hit everyone?",
          "a": "Deploy cell by cell in waves: first a canary cell (internal or low-risk tenants), let it bake against automated health checks for e.g. 30–60 minutes, then 1 cell, then 2–3, then the rest. Halt automatically on SLO regression. Config and feature flags must follow the same waves, since a global flag flip bypasses cell isolation. The cell router and placement map are global components, so keep them minimal, versioned and changed with extra care."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-11',
      difficulty: 'expert',
      question:
        'You have 8 workers and assign each customer 2 of them via shuffle sharding. A poison customer takes down both of its workers. What fraction of other customers lose ALL their capacity?',
      options: [
        '1/4 — the same as fixed sharding into 4 pairs',
        '1/8 — one per worker',
        'About 1/28 — only customers assigned exactly the same pair',
        'None — every customer always keeps at least one worker',
      ],
      correct: [2],
      explanation:
        'There are C(8,2) = 28 possible pairs; only customers that happen to share exactly the same pair lose both workers (~1/28 ≈ 3.6%). Customers sharing one worker lose half capacity but remain available. Fixed sharding would put 1/4 of customers on the same pair; "none" ignores customers with the identical pair.',
      followUps: [
        {
          "q": "Customers on the poison customer's exact pair are fully down. What else would you add so even they keep partial service?",
          "a": "Shuffle sharding limits how many share fate; you still need to stop the poison request. Add per-customer circuit breaking or quarantine: when a customer's requests correlate with worker crashes, move that customer to an isolated quarantine worker and retry others normally. Give workers crash-resistant request handling (per-request timeouts and memory limits, or running risky parsing in a sandbox process). Clients with retries across a second shuffle shard can also recover by trying a different pair."
        },
        {
          "q": "How does the blast radius change if you grow to 100 workers with 5 per customer?",
          "a": "The number of possible combinations is C(100,5) ≈ 75 million, so the chance another customer has exactly the same 5 workers is about 1 in 75 million: effectively nobody else loses all capacity. Customers sharing 1–2 workers lose 20–40% of their capacity, which retries absorb. The trade-off is that each customer's requests spread over more workers, which reduces cache locality and connection reuse. Route53 and AWS use this design to keep a single bad tenant's impact negligible."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-12',
      difficulty: 'hard',
      question:
        'Your chaos experiment kills random pods and everything passes. Two weeks later a 500ms latency increase in a dependency causes a major outage. What does this reveal? Select ALL that apply.',
      options: [
        'Crash faults and latency faults exercise different failure paths; latency injection was missing',
        'Chaos engineering is not useful for latency issues',
        'The steady-state hypothesis should include latency/SLO metrics, not just error rates',
        'Timeouts, bulkheads and breakers were likely untested under slowness',
      ],
      correct: [0, 2, 3],
      explanation:
        'Pod kills produce fast failures that load balancers handle well; slowness exhausts pools and needs timeouts/bulkheads — a different path that must be injected explicitly (network delay). The steady-state metric must include latency. Chaos tools inject latency routinely, so the second option is wrong.',
      followUps: [
        {
          "q": "Design the next chaos experiment for the 500 ms latency case. What's the hypothesis, the blast radius and the abort condition?",
          "a": "Hypothesis: with 500 ms added to the inventory service, checkout p99 stays under 1.2 s and success rate above 99.5%, because the client timeout is 300 ms and the fallback shows 'availability unknown'. Inject latency with a service mesh fault filter (Istio `fault.delay`) on 10% of requests, from one pod or one canary cell first. Abort automatically if checkout success drops below 99% or p99 exceeds 2 s for 2 minutes. Measure thread or connection pool saturation in the caller, which is what actually failed last time."
        },
        {
          "q": "What other fault types would you add to the experiment library after this incident?",
          "a": "Faults that produce slow or partial failure, not clean crashes: packet loss (2–5%) on one AZ, DNS resolution failures and slow DNS, dependency returning errors on a fraction of calls, TLS certificate expiry, a full disk on a stateful node, clock skew on a node, a database failover (connections cut mid-transaction), and resource exhaustion in the caller (CPU throttling, a low file descriptor limit). Prioritise by past incidents and by the dependencies with the weakest timeout and fallback coverage."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-13',
      difficulty: 'expert',
      question:
        'Leadership asks for RPO = 0 for an order database across us-east-1 and eu-west-1 (≈ 75 ms RTT). What is the unavoidable consequence?',
      options: [
        'None — async replication with low lag achieves RPO = 0',
        'You need to double the number of availability zones',
        'Reads become slower but writes are unaffected',
        'Each commit must be acknowledged by the remote region (sync replication or cross-region quorum), adding at least ~75 ms to every write',
      ],
      correct: [3],
      explanation:
        'Zero data loss on region failure means no commit may be acknowledged before it is durable in another region, so every write pays at least one cross-region round trip (~75 ms plus consensus overhead). Async replication always has a lag window. Reads can be local; more AZs don\'t protect against region loss.',
      followUps: [
        {
          "q": "Leadership accepts the latency but then asks: what happens to writes when the link between the two regions is down?",
          "a": "With synchronous replication to the other region, a partition means no commit can be acknowledged, so writes stop in both regions: you've chosen consistency over availability. The alternative is a 3-region quorum (e.g. us-east, us-east-2, eu-west with a majority of 2), so losing any one region or link still leaves a majority that keeps accepting writes, at the cost of a third region and commit latency set by the nearest other replica. Spanner-style and CockroachDB-style systems use this layout."
        },
        {
          "q": "Not every write needs RPO = 0. How would you limit the 75 ms cost to the writes that matter?",
          "a": "Split data by criticality: orders and payments go to a synchronously replicated (or quorum) store, while carts, sessions, analytics and notifications use async replication with RPO of seconds. Within the order flow, write only the commit record synchronously (order ID, amount, status) and let derived data (search index, emails, recommendations) replicate asynchronously and be rebuilt from the order record. Users then pay ~75 ms only at 'Place order', not on every click."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-14',
      difficulty: 'hard',
      question: 'What is the main reliability risk in this Kubernetes placement for a 3-replica stateful service?',
      code: {
        language: 'yaml',
        code: `apiVersion: apps/v1
kind: StatefulSet
metadata: { name: ledger-db }
spec:
  replicas: 3
  template:
    spec:
      nodeSelector:
        topology.kubernetes.io/zone: us-east-1a   # "keeps replication latency low"
      containers:
        - name: db
          image: postgres:16`,
      },
      options: [
        'All replicas share one AZ, so a single AZ failure takes out the whole service despite 3 replicas',
        'Replication latency will be too high for synchronous commit',
        'StatefulSets cannot run more than one replica per zone',
        'The postgres:16 image does not support replication',
      ],
      correct: [0],
      explanation:
        'Pinning all replicas to one zone creates a correlated failure domain: redundancy is useless when the AZ goes down. Cross-AZ latency is typically ~1–2 ms, compatible with synchronous replication. Use topologySpreadConstraints or anti-affinity across zones. StatefulSets have no per-zone limit and the image supports replication.',
      followUps: [
        {
          "q": "You add `topologySpreadConstraints` across zones. The pod in zone b dies and its PersistentVolume (EBS) lives in zone b. What happens?",
          "a": "EBS volumes are zonal, so the replacement pod can only be scheduled in zone b, where its volume is. If zone b is down, that StatefulSet replica stays Pending until the zone returns. That's acceptable when the database replicates across the other two replicas and fails over to them. For a self-managed DB, it means designing for 'replica lost' rather than 'replica moved': promote another replica, and rebuild a fresh replica in a healthy zone from a backup or a peer instead of waiting for the zonal volume."
        },
        {
          "q": "How would you stop someone from re-introducing single-zone placement in a future PR?",
          "a": "Enforce it with policy rather than review: a Kyverno or OPA Gatekeeper rule that rejects StatefulSets and Deployments with more than 1 replica unless they declare a zone spread constraint, and rejects `nodeSelector`/affinity pinning to a single `topology.kubernetes.io/zone`. Add a CI check (conftest on the rendered manifests) so it fails before merge. Also monitor at runtime: an alert when all ready replicas of a workload are in one zone, since scheduling can drift after node failures."
        }
      ],
    },
    {
      id: 'rel-dr-mcq-15',
      difficulty: 'expert',
      question:
        'During a partial AZ impairment (5% packet loss, health checks mostly passing), p99 latency triples. Select ALL effective mitigations.',
      options: [
        'Zonal shift: remove the impaired AZ from load balancer routing while capacity in other AZs is sufficient',
        'Increase health-check failure thresholds so pods in the AZ are not marked unhealthy',
        'Rely on static stability — pre-provisioned capacity lets the other AZs absorb the shifted traffic',
        'Fail over the entire region to the DR region immediately',
      ],
      correct: [0, 2],
      explanation:
        'Gray failures often pass health checks, so an explicit zonal shift is the tool, and static stability ensures the remaining AZs can take the load. Raising thresholds keeps traffic on the impaired AZ; a full region failover is a far larger and riskier action (RPO loss, DNS tail) than necessary for a single-AZ problem.',
      followUps: [
        {
          "q": "How do you detect a gray failure like this when per-instance health checks keep passing?",
          "a": "Compare zones against each other instead of against absolute thresholds: per-AZ error rate and p99 latency from the client or load-balancer side (not self-reported health), and alert when one AZ is an outlier (e.g. p99 2× the other AZs for 5 minutes). Use outlier detection in the mesh to eject hosts with high error rates. Run synthetic probes pinned to each AZ that do real work (a write and a read), since a TCP or `/health` check doesn't feel 5% packet loss."
        },
        {
          "q": "Should zonal shift be automated, and what guardrails would you put on it?",
          "a": "Automate it for clear signals, but with guardrails: shift only one AZ at a time; only if the remaining AZs have the capacity (checked against current utilisation, e.g. projected ≤ 85%); require two independent signals (LB-side latency plus synthetic probes) to avoid shifting on a monitoring bug; time-limit the shift (e.g. it expires after 1 hour unless renewed) and page a human when it happens. AWS ARC zonal autoshift follows this pattern."
        }
      ],
    },
  ],
};

export default topic;
