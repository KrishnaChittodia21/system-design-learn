// Scripted (deterministic) walk through the database triage loop for four incident types.
// Each stage carries the dashboard values an on-call engineer would see at that moment, the evidence
// they would pull, and why that step comes before the next one. Numbers follow the topic's text.
import type { BaseFrame } from '../../core';

export type ScenarioId = 'slow' | 'cpu' | 'lag' | 'shard';
export type Stage = 'symptom' | 'mitigate' | 'changed' | 'use' | 'queries' | 'fix' | 'prevent';
export type Health = 'ok' | 'warn' | 'bad';

export const STAGES: { id: Stage; label: string }[] = [
  { id: 'symptom', label: 'Symptom' },
  { id: 'mitigate', label: 'Mitigate' },
  { id: 'changed', label: 'What changed?' },
  { id: 'use', label: 'USE per resource' },
  { id: 'queries', label: 'Top queries' },
  { id: 'fix', label: 'Fix (cheapest first)' },
  { id: 'prevent', label: 'Prevent' },
];

export interface Metric {
  key: string;
  label: string;
  unit: string;
  /** value at which the tile turns amber / red */
  warn: number;
  bad: number;
  /** full-scale value for the bar */
  max: number;
  /** true when lower is worse (e.g. cache hit ratio) */
  inverse?: boolean;
}

export interface StageData {
  values: Record<string, number>;
  /** what the engineer looks at or runs in this stage (monospace) */
  evidence: string[];
  caption: string;
  /** metric keys this stage points at */
  focus: string[];
  predict?: string;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  title: string;
  metrics: Metric[];
  stages: Record<Stage, StageData>;
}

export interface Params {
  scenario: ScenarioId;
}

export interface Frame extends BaseFrame {
  stage: Stage;
  stageIndex: number;
  values: Record<string, number>;
  baseline: Record<string, number>;
  evidence: string[];
  focus: string[];
  /** 'incident': the dashboards are read for the incident window, after mitigation */
  window: 'live' | 'incident';
}

export function health(m: Metric, v: number): Health {
  if (m.inverse) return v <= m.bad ? 'bad' : v <= m.warn ? 'warn' : 'ok';
  return v >= m.bad ? 'bad' : v >= m.warn ? 'warn' : 'ok';
}

const P99: Metric = { key: 'p99', label: 'API p99', unit: 'ms', warn: 300, bad: 1000, max: 2500 };
const CPU: Metric = { key: 'cpu', label: 'DB CPU', unit: '%', warn: 70, bad: 90, max: 100 };
const HIT: Metric = { key: 'hit', label: 'buffer hit', unit: '%', warn: 99, bad: 97, max: 100, inverse: true };
const CONN: Metric = { key: 'conn', label: 'connections', unit: '/100', warn: 70, bad: 90, max: 100 };

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  slow: {
    id: 'slow',
    label: 'suddenly slow',
    title: '"The database is suddenly slow"',
    metrics: [P99, CPU, HIT, CONN, { key: 'io', label: 'read IOPS', unit: 'k', warn: 8, bad: 12, max: 16 }],
    stages: {
      symptom: {
        values: { p99: 2000, cpu: 86, hit: 96, conn: 78, io: 14 },
        focus: ['p99'],
        evidence: ['14:09 PagerDuty: checkout-api p99 2.0 s (SLO 300 ms)', 'app logs: timeout exceeded when trying to connect', 'error rate 4.8%'],
        caption: 'You are paged: p99 jumped from 80 ms to 2 s and timeouts are appearing. Before looking for a root cause, stop the bleeding.',
      },
      mitigate: {
        values: { p99: 700, cpu: 61, hit: 97.5, conn: 52, io: 9 },
        focus: ['p99', 'conn'],
        evidence: ['$ flags set order-history-v2 off', '# rollback / flag off / shed batch jobs come first', 'p99 2.0 s -> 0.7 s within 2 min'],
        caption: 'Mitigate first: the only change in the last hour is a feature flag for the new order-history page. Turning it off brings p99 down to 700 ms. Users hurt less, and the clue is strong.',
        predict: 'The flag pointed at one endpoint. Before opening any dashboard, what single question do you ask next?',
      },
      changed: {
        values: { p99: 700, cpu: 61, hit: 97.5, conn: 52, io: 9 },
        focus: [],
        evidence: ['14:02 deploy checkout-api v4.18 (order-history-v2 at 10%)', '14:03 p99 starts climbing', 'no migration, traffic flat, no cron'],
        caption: 'What changed? The p99 curve bends at 14:03, one minute after the deploy that enabled the new endpoint. Most incidents follow a change: deploy, migration, traffic, data size, plan flip, cron.',
      },
      use: {
        values: { p99: 2000, cpu: 86, hit: 96, conn: 78, io: 14 },
        focus: ['cpu', 'hit', 'io'],
        evidence: ['CPU 86% util; disk await 9 ms (saturated)', 'buffer hit 99.6% -> 96%: big scans evict hot pages', 'connections 78/100: a consequence, not the cause'],
        caption: 'USE per resource: CPU busy, read IOPS and disk wait saturated, and the buffer hit ratio fell from 99.6% to 96%. That means 10× more disk reads. Connections are climbing only because every query now holds its connection longer.',
        predict: 'CPU, IO and cache all point to "reading far too much". Which tool tells you which statement is doing it?',
      },
      queries: {
        values: { p99: 2000, cpu: 86, hit: 96, conn: 78, io: 14 },
        focus: ['io'],
        evidence: [
          'pg_stat_statements by total_exec_time:',
          ' 61%  mean 1450 ms  rows/call 20  SELECT * FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20',
          'EXPLAIN (ANALYZE, BUFFERS):',
          ' Seq Scan on orders (rows=40,000,000)  Buffers: read=182,113',
        ],
        caption: 'Top queries: one new statement is 61% of DB time. It returns 20 rows but reads 182k pages, because orders has no index on customer_id, so every call is a full sequential scan of 40M rows.',
      },
      fix: {
        values: { p99: 85, cpu: 31, hit: 99.6, conn: 18, io: 2 },
        focus: ['p99', 'cpu', 'io'],
        evidence: ['CREATE INDEX CONCURRENTLY orders_customer_created', '  ON orders (customer_id, created_at DESC);', 'Index Scan ... Buffers: hit=24   (mean 0.4 ms)', '$ flags set order-history-v2 on'],
        caption: 'Fix, cheapest first: a composite index matching WHERE + ORDER BY, built CONCURRENTLY so the hot table is never locked. The query now touches 24 pages instead of 182k; with the flag back on, p99 is 85 ms.',
      },
      prevent: {
        values: { p99: 85, cpu: 31, hit: 99.6, conn: 18, io: 2 },
        focus: [],
        evidence: ['CI: EXPLAIN check fails on Seq Scan over tables > 1M rows', 'ALTER ROLE api SET statement_timeout = 2s', 'alert: p99 per endpoint, buffer hit < 99%', 'postmortem: new endpoints ship behind a flag at 1%'],
        caption: 'Prevent: a plan check in CI, statement_timeout for the API role so one bad query cannot hold the pool, per-endpoint latency alerts, and a runbook entry. Narrating this loop in order is what interviewers score.',
      },
    },
  },
  cpu: {
    id: 'cpu',
    label: 'CPU pinned',
    title: '"DB CPU is pinned at 90–100%"',
    metrics: [P99, CPU, { key: 'qps', label: 'queries/s', unit: 'k', warn: 20, bad: 35, max: 50 }, HIT, CONN],
    stages: {
      symptom: {
        values: { p99: 1500, cpu: 98, qps: 42, hit: 99.8, conn: 94 },
        focus: ['cpu'],
        evidence: ['DB CPU 98%, run queue 31 on 16 vCPU', 'every endpoint slower, not just one', 'connections 94/100 and climbing'],
        caption: 'CPU is pinned and latency is up on every endpoint: everything waits for CPU. The connection count rises only because each query takes longer.',
      },
      mitigate: {
        values: { p99: 260, cpu: 52, qps: 6, hit: 99.8, conn: 31 },
        focus: ['cpu', 'qps'],
        evidence: ['$ deploy rollback orders-api v2.31 -> v2.30', 'CPU 98% -> 52% within 3 min', 'queries/s 42k -> 6k'],
        caption: 'Mitigate: roll back the morning deploy. CPU drops to 52% and query rate drops 7×, so the deploy is involved and the database box is not "too small".',
        predict: 'Query rate fell 7× after the rollback, but the number of user requests did not change. What kind of bug multiplies queries per request?',
      },
      changed: {
        values: { p99: 260, cpu: 52, qps: 6, hit: 99.8, conn: 31 },
        focus: ['qps'],
        evidence: ['v2.31: "load order lines lazily" (ORM relation change)', 'requests/s unchanged: 1.4k', 'queries per request: 4 -> 30'],
        caption: 'What changed? v2.31 switched an ORM relation to lazy loading. Requests per second are flat, but queries per request went from 4 to 30: an N+1.',
      },
      use: {
        values: { p99: 1500, cpu: 98, qps: 42, hit: 99.8, conn: 94 },
        focus: ['cpu', 'hit'],
        evidence: ['CPU: 98% util, run queue 2× cores (saturated)', 'buffer hit 99.8%: data is in memory', 'disk IO idle -> CPU-bound, not IO-bound'],
        caption: 'USE: CPU is saturated (run queue twice the cores) while the cache hit ratio is 99.8% and disks are idle. The work is CPU-bound in memory: many cheap queries, not one big scan.',
      },
      queries: {
        values: { p99: 1500, cpu: 98, qps: 42, hit: 99.8, conn: 94 },
        focus: ['qps'],
        evidence: ['pg_stat_statements (diff of two snapshots):', ' 58%  calls 2.1M/min (was 50k)  mean 0.4 ms', '      SELECT * FROM line_items WHERE order_id = $1', ' -> calls jumped 40×: an app-side problem'],
        caption: 'Top queries: a 0.4 ms statement is 58% of DB time because its call count jumped 40×. When calls change rather than mean time, look at the app (N+1, retry storm, cache stampede), not the index.',
      },
      fix: {
        values: { p99: 90, cpu: 34, qps: 5.5, hit: 99.8, conn: 22 },
        focus: ['cpu', 'qps', 'p99'],
        evidence: ['SELECT * FROM line_items WHERE order_id = ANY($1)', '-- one batched query per page instead of one per order', 'CPU 34% at full traffic, queries/request 4'],
        caption: 'Fix: batch the lookups with WHERE order_id = ANY($1) (one query per page) and redeploy. CPU is 34% at full traffic. Scaling up vCPUs would have hidden a 40× bug at 2× the cost.',
      },
      prevent: {
        values: { p99: 90, cpu: 34, qps: 5.5, hit: 99.8, conn: 22 },
        focus: [],
        evidence: ['test: assert queries per request <= 10', 'alert: calls/min per statement +5× vs last week', 'statement_timeout per role', 'postmortem: ORM relation changes need review'],
        caption: 'Prevent: count queries per request in tests, alert when a statement\'s call rate jumps, and set statement_timeout per role. Kill or cancel a runaway query first; add vCPUs only after the per-query work is fixed.',
      },
    },
  },
  lag: {
    id: 'lag',
    label: 'replication lag',
    title: '"Replication lag keeps increasing"',
    metrics: [
      { key: 'lag', label: 'replay lag', unit: 's', warn: 10, bad: 60, max: 400 },
      { key: 'wal', label: 'WAL rate', unit: 'MB/min', warn: 200, bad: 600, max: 1400 },
      { key: 'rio', label: 'replica IO', unit: '%', warn: 70, bad: 90, max: 100 },
      { key: 'stale', label: 'stale-read tickets', unit: '/h', warn: 3, bad: 10, max: 40 },
    ],
    stages: {
      symptom: {
        values: { lag: 340, wal: 1200, rio: 100, stale: 31 },
        focus: ['lag', 'stale'],
        evidence: ['replay_lag 340 s and rising linearly', 'support: "I paid but my order says unpaid"', 'primary pg_wal 38 GB (retained for the replica)'],
        caption: 'Replica lag is growing linearly and users see stale data: reads after a payment hit a replica that is almost 6 minutes behind.',
      },
      mitigate: {
        values: { lag: 290, wal: 35, rio: 100, stale: 2 },
        focus: ['wal', 'stale'],
        evidence: ['$ pause job backfill-order-status', 'route reads for 30 s after a write to the primary', 'lag now draining ~1 s per second'],
        caption: 'Mitigate: pause the running batch job and route each user\'s reads to the primary for a short window after they write. Stale-read tickets stop at once; the lag starts to drain.',
        predict: 'The lag starts draining as soon as the job pauses. Which number in the "what changed" step proves the job was the cause?',
      },
      changed: {
        values: { lag: 290, wal: 35, rio: 100, stale: 2 },
        focus: ['wal'],
        evidence: ['13:40 backfill: UPDATE orders SET status_v2 = ... (80M rows)', 'WAL generation 30 MB/min -> 1.2 GB/min (40×)', 'no change on the replica'],
        caption: 'What changed? A backfill started at 13:40 and raised WAL generation 40×, from 30 MB/min to 1.2 GB/min. The replica has to replay every byte of it.',
      },
      use: {
        values: { lag: 340, wal: 1200, rio: 100, stale: 31 },
        focus: ['rio', 'lag'],
        evidence: ['pg_stat_replication (on primary):', ' send lag 0 B   flush lag 12 MB   replay lag 21 GB', ' -> sent and flushed fine; REPLAY is behind', 'replica disk 100% util (smaller instance than primary)'],
        caption: 'USE on replication, split by stage: sending and flushing keep up, replay is 21 GB behind, and the replica\'s disk is at 100%. Replay is single-threaded and IO-bound, on a replica sized smaller than the primary.',
      },
      queries: {
        values: { lag: 340, wal: 1200, rio: 100, stale: 31 },
        focus: ['wal'],
        evidence: ['pg_stat_statements on primary by wal_bytes:', ' 94%  UPDATE orders SET status_v2 = $1 WHERE id BETWEEN $2 AND $3', '      rows/call 500,000   wal_bytes/call 410 MB'],
        caption: 'Top statements by WAL bytes: the backfill\'s UPDATE writes 94% of all WAL, half a million rows per statement. It is one statement shape, not general load.',
      },
      fix: {
        values: { lag: 1.2, wal: 140, rio: 55, stale: 0 },
        focus: ['lag', 'wal'],
        evidence: ['loop: UPDATE ... WHERE id BETWEEN $a AND $a+5000', '      wait until replay_lag < 5 s, then continue', 'backfill resumes at 140 MB/min; lag stays ~1 s'],
        caption: 'Fix: rewrite the backfill as 5,000-row batches that wait until replica lag is under 5 s. The job takes longer, but lag stays around 1 s while it runs. Sizing the replica\'s IO like the primary\'s is the follow-up.',
      },
      prevent: {
        values: { lag: 1.2, wal: 140, rio: 55, stale: 0 },
        focus: [],
        evidence: ['alert: replay lag > 30 s AND lag bytes > 1 GB', 'alert: inactive replication slots, max_slot_wal_keep_size', 'batch tooling: lag-aware throttle by default', 'reads after writes carry the write LSN'],
        caption: 'Prevent: alert on lag in both bytes and seconds, alert on inactive slots, make lag-aware throttling the default for batch jobs, and make the app lag-aware (read-your-writes routing).',
      },
    },
  },
  shard: {
    id: 'shard',
    label: 'one shard hot',
    title: '"One shard is overloaded"',
    metrics: [
      { key: 'hot', label: 'shard 7 CPU', unit: '%', warn: 70, bad: 90, max: 100 },
      { key: 'avg', label: 'cluster avg CPU', unit: '%', warn: 70, bad: 90, max: 100 },
      { key: 'p99', label: 'shard 7 p99', unit: 'ms', warn: 200, bad: 600, max: 1200 },
      { key: 'share', label: 'top key share', unit: '%', warn: 20, bad: 30, max: 100 },
    ],
    stages: {
      symptom: {
        values: { hot: 95, avg: 38, p99: 900, share: 64 },
        focus: ['hot', 'p99', 'avg'],
        evidence: ['errors only for some tenants', 'cluster average CPU 38%: "looks fine"', 'max by shard: shard 7 at 95%, p99 10× the rest'],
        caption: 'Errors for a subset of users while the cluster average looks healthy. Only a max-by-shard view shows shard 7 of 32 at 95% CPU with p99 ten times the others.',
      },
      mitigate: {
        values: { hot: 62, avg: 36, p99: 160, share: 38 },
        focus: ['hot', 'p99'],
        evidence: ['$ gateway ratelimit tenant=4411 200 req/s', 'pause tenant 4411 import job', 'shard 7 CPU 95% -> 62%'],
        caption: 'Mitigate: rate-limit the offending tenant at the gateway and pause its import. Shard 7 recovers to 62% and every other tenant on it is healthy again.',
        predict: 'One tenant caused 64% of a shard\'s load. Is that a hot key or a hot shard, and why does the distinction change the fix?',
      },
      changed: {
        values: { hot: 62, avg: 36, p99: 160, share: 38 },
        focus: ['share'],
        evidence: ['tenant 4411 enabled a bulk-import integration at 09:15', 'shard 7 calls ×6, same statements as other shards', 'storage per shard unchanged (traffic skew, not data skew)'],
        caption: 'What changed? Tenant 4411 switched on a bulk-import integration. Shard 7 runs the same statements as healthy shards, six times as often: traffic skew, not data skew.',
      },
      use: {
        values: { hot: 95, avg: 38, p99: 900, share: 64 },
        focus: ['hot', 'avg'],
        evidence: ['per-shard USE: shard 7 CPU saturated; 31 shards at ~35%', 'no lock waits (not a single hot row)', 'storage within 5% of other shards'],
        caption: 'USE per shard, not per cluster: one shard saturated, 31 idle-ish, no lock waits, and equal storage. Averages hide this every time; alert on max by shard.',
      },
      queries: {
        values: { hot: 95, avg: 38, p99: 900, share: 64 },
        focus: ['share'],
        evidence: ['top keys on shard 7 (last 15 min):', ' tenant_id=4411   64% of statements', ' tenant_id=118     3%', ' -> one key > 30% of load = HOT KEY (whale tenant)'],
        caption: 'Top keys: tenant 4411 alone is 64% of shard 7\'s statements. One key above 20–30% of a shard\'s load is a hot key; load spread across many keys would be a hot shard, fixed by moving logical shards.',
      },
      fix: {
        values: { hot: 41, avg: 37, p99: 70, share: 4 },
        focus: ['hot', 'share', 'p99'],
        evidence: ['directory override: tenant 4411 -> dedicated shard 33', 'per-tenant quota: 500 writes/s', 'shard 7 CPU 41%, top key share 4%'],
        caption: 'Fix: a directory override moves the whale tenant to a dedicated shard, and a per-tenant quota caps its writes. Rehashing all 32 shards would have moved 31 healthy shards\' data to fix one tenant.',
      },
      prevent: {
        values: { hot: 41, avg: 37, p99: 70, share: 4 },
        focus: [],
        evidence: ['alert: max by (shard) CPU > 80%, not avg', 'per-tenant rate limits by default', 'top-K key tracking in the shard router', 'practised "move logical shard" runbook'],
        caption: 'Prevent: per-shard SLO alerts using max, not average, per-tenant limits on by default, top-K key tracking in the router, and a rehearsed runbook for moving a logical shard.',
      },
    },
  },
};

export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

export function simulate({ scenario }: Params): Frame[] {
  const sc = SCENARIOS[scenario];
  const baseline = sc.stages.symptom.values;
  return STAGES.map((s, k) => {
    const d = sc.stages[s.id];
    return {
      stage: s.id,
      stageIndex: k,
      values: d.values,
      baseline,
      evidence: d.evidence,
      focus: d.focus,
      window: s.id === 'use' || s.id === 'queries' ? 'incident' : 'live',
      caption: s.id === 'symptom' ? `Symptom: ${d.caption}` : d.caption,
      predict: d.predict,
    };
  });
}
