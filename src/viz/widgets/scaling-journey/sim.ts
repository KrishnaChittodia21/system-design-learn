// Pure data + frames for the "1 user → 1M+" scaling journey (DesiCart running example).
// Every stage is two frames: the measured pain on the current architecture, then the change.
import type { BaseFrame } from '../../core';

export type CompId = 'users' | 'cdn' | 'lb' | 'app' | 'workers' | 'cache' | 'db' | 'queue' | 'objstore' | 'replica' | 'search' | 'region2';

export interface Stage {
  n: number;
  users: string;
  title: string;
  trigger: string;
  /** component that was hot before the change */
  hot?: CompId;
  hotLabel?: string;
  change: string;
  newRisk: string;
  /** components introduced by this stage */
  adds: CompId[];
}

export const STAGES: Stage[] = [
  {
    n: 0,
    users: '1–1K',
    title: 'One box',
    trigger: 'None yet. Speed of iteration beats architecture.',
    change: 'One VM runs NestJS, Postgres and uploaded files.',
    newRisk: 'App and DB share one CPU, RAM and disk; the box is the whole outage.',
    adds: ['users', 'app'],
  },
  {
    n: 1,
    users: '1K–10K',
    title: 'Split the database off',
    trigger: 'App and DB fight for CPU/RAM; backups sit on the same disk.',
    hot: 'app',
    hotLabel: 'CPU/RAM contention',
    change: 'Managed Postgres on its own box: point-in-time recovery and independent sizing.',
    newRisk: 'A network hop per query (N+1 hurts more) and a connection budget.',
    adds: ['db'],
  },
  {
    n: 2,
    users: '10K–50K',
    title: 'Scale up',
    trigger: 'App CPU above 70% at the evening peak.',
    hot: 'app',
    hotLabel: 'CPU > 70%',
    change: 'Bigger instances, Node cluster mode (one process per core), DB sized so the working set fits in RAM.',
    newRisk: 'Still one app box: a SPOF, resize downtime, and sale spikes arrive faster than a resize.',
    adds: [],
  },
  {
    n: 3,
    users: '50K–200K',
    title: 'Stateless app tier + load balancer',
    trigger: 'Deploys cause downtime, one box is a SPOF, no headroom for sale spikes.',
    hot: 'app',
    hotLabel: 'SPOF + deploy downtime',
    change: 'Stateless pods behind a load balancer with autoscaling. Sessions and uploads move out of the pod.',
    newRisk: 'Connection explosion on Postgres, LB timeouts, debugging across machines.',
    adds: ['lb'],
  },
  {
    n: 4,
    users: '100K–500K',
    title: 'Cache the hot reads',
    trigger: 'DB CPU dominated by repeated reads of slow-changing catalog data.',
    hot: 'db',
    hotLabel: 'catalog reads',
    change: 'Redis cache-aside for catalog and product pages (never checkout price or stock).',
    newRisk: 'Stale data, a stampede at sale start, and a plan for Redis being down.',
    adds: ['cache'],
  },
  {
    n: 5,
    users: '300K–1M',
    title: 'Read replicas',
    trigger: 'The primary is still hot from per-user and report reads that do not cache well.',
    hot: 'db',
    hotLabel: 'uncacheable reads',
    change: 'Read replica(s), with routing by intent: checkout and just-written data stay on the primary.',
    newRisk: 'Replication lag is a new bug class, and replicas add zero write capacity.',
    adds: ['replica'],
  },
  {
    n: 6,
    users: '200K+',
    title: 'CDN + object storage',
    trigger: 'GB/day of image egress, slow pages outside metros, local uploads break with many pods.',
    hot: 'app',
    hotLabel: 'serving images',
    change: 'Images and static assets in object storage behind a CDN, with content-hashed immutable URLs.',
    newRisk: 'Cache-key hygiene: query strings and cookies destroy the hit ratio.',
    adds: ['cdn', 'objstore'],
  },
  {
    n: 7,
    users: '200K+',
    title: 'Queues for side effects',
    trigger: 'Checkout p99 is dominated by email, SMS and invoice calls; a vendor outage fails checkout.',
    hot: 'app',
    hotLabel: 'checkout p99',
    change: 'Write an outbox row in the checkout transaction; workers drain a queue for side effects.',
    newRisk: 'At-least-once delivery: idempotent handlers, dead-letter queues with owners.',
    adds: ['queue', 'workers'],
  },
  {
    n: 8,
    users: '500K+',
    title: 'Offload search',
    trigger: 'ILIKE sequential scans in the top queries, high zero-result rate, slow facets.',
    hot: 'db',
    hotLabel: 'ILIKE seq scans',
    change: 'pg_trgm first; then a search engine fed by CDC or the outbox, never dual writes.',
    newRisk: 'Index lag. It is a rebuildable read model: checkout still trusts Postgres.',
    adds: ['search'],
  },
  {
    n: 9,
    users: '1M → 10M+',
    title: 'Partition, shard much later',
    trigger: 'Huge append-only tables; writes and WAL approach one primary’s ceiling.',
    hot: 'db',
    hotLabel: 'write/WAL ceiling',
    change: 'Partition big append tables by time first; shard by the dominant key only when every cheaper lever is spent.',
    newRisk: 'Cross-shard queries need fan-out or an analytics store.',
    adds: [],
  },
  {
    n: 10,
    users: '1M+, revenue-critical',
    title: 'Multi-AZ',
    trigger: 'Losing one data centre means a full outage, and downtime per hour costs more than the monthly premium.',
    hotLabel: 'AZ = SPOF',
    change: 'Every stateful layer gets a cross-AZ replica with tested failover; pods are pre-provisioned N+1 per AZ.',
    newRisk: 'About 2× DB cost, cross-AZ transfer fees, a small write-latency penalty.',
    adds: [],
  },
  {
    n: 11,
    users: '10M+, global',
    title: 'Multi-region (active-passive first)',
    trigger: 'A named reason: disaster recovery beyond a region, far-away users, or data residency.',
    hotLabel: 'region = SPOF',
    change: 'A warm standby region with async replication. Active-active only when the business case is proven.',
    newRisk: 'Hidden single-region dependencies; RTO/RPO only count once failover is drilled.',
    adds: ['region2'],
  },
];

/** "1K–10K users", "1M+, revenue-critical" … */
export const usersLabel = (s: Stage) => (/[\dKM+]$/.test(s.users) ? `${s.users} users` : s.users);

export interface Frame extends BaseFrame {
  stage: number;
  phase: 'pain' | 'fix';
  /** components present on screen */
  present: CompId[];
  /** components added in this frame (highlighted) */
  added: CompId[];
}

export function componentsAt(stage: number): CompId[] {
  return STAGES.slice(0, stage + 1).flatMap((s) => s.adds);
}

/** First frame index for a stage (its "pain" frame). */
export function frameOfStage(stage: number): number {
  return stage === 0 ? 0 : 2 * stage - 1;
}

export function simulate(): Frame[] {
  const frames: Frame[] = [];
  for (const s of STAGES) {
    if (s.n === 0) {
      frames.push({
        stage: 0,
        phase: 'fix',
        present: componentsAt(0),
        added: s.adds,
        caption: `Stage 0 (${usersLabel(s)}): ${s.change} At this size that is the right design. ${s.newRisk}`,
        predict: 'Users grow to a few thousand. What breaks first, and how would you know?',
      });
      continue;
    }
    frames.push({
      stage: s.n,
      phase: 'pain',
      present: componentsAt(s.n - 1),
      added: [],
      caption: `Stage ${s.n} trigger (${usersLabel(s)}): ${s.trigger}`,
      predict: `What is the smallest change that removes this bottleneck${s.hot ? '' : ' (no single box is hot)'}?`,
    });
    frames.push({
      stage: s.n,
      phase: 'fix',
      present: componentsAt(s.n),
      added: s.adds,
      caption: `Stage ${s.n}, ${s.title.toLowerCase()}: ${s.change} New failure mode: ${s.newRisk}`,
    });
  }
  return frames;
}
