import type { Topic } from '../../types';

const topic: Topic = {
  id: 'prod-correctness-ops',
  phase: 'production',
  order: 4,
  title: 'Incidents IV: Correctness, Regions & Operability',
  subtitle:
    'Duplicate payments, races, deadlocks and locks; consistency choices; AZ and region failures, DR; sudden latency, bad deploys, tracing; slow and stale search',
  estimatedMinutes: 115,
  sources: [
    'Designing Data-Intensive Applications — Ch 7 Transactions, Ch 8 Trouble with Distributed Systems, Ch 9 Consistency',
    'Stripe Engineering — Designing robust and predictable APIs with idempotency',
    'AWS Well-Architected — Reliability Pillar (multi-AZ, multi-region, DR strategies)',
    'Google SRE Book — Ch 12 Effective Troubleshooting',
  ],
  tags: ['incident', 'idempotency', 'race-condition', 'deadlock', 'distributed-lock', 'consistency', 'multi-az', 'multi-region', 'disaster-recovery', 'tracing', 'search', 'war-room'],
  cheatSheet: [
    'Idempotency key = client-generated UUID per logical operation; server stores (key, request hash, status, response) with a UNIQUE constraint, returns the stored response on replay, 409/422 if the same key arrives with a different body.',
    'Duplicate payment root cause is almost always "retry after timeout on a non-idempotent call" — client, gateway, queue redelivery or the user double-clicking. Fix at every hop: key in, key forwarded to the PSP.',
    'Lost update / oversell: replace read-modify-write with an atomic conditional UPDATE (… SET stock = stock − 1 WHERE id = $1 AND stock > 0), optimistic version column, or SELECT … FOR UPDATE. Check rowCount.',
    'Postgres detects deadlocks after deadlock_timeout (1 s default) and aborts one transaction with SQLSTATE 40P01. Fix: consistent lock ordering, shorter transactions, retry on 40P01/40001.',
    'A Redis lock (SET key token NX PX ttl) is a lease, not a guarantee: GC pauses and clock/TTL expiry allow two holders. Protect the resource with a fencing token (monotonic number checked by the storage layer).',
    'Choose consistency per operation: money movement, inventory decrement, uniqueness → strong (single leader / serialisable / consensus). Feeds, counts, search, recommendations → eventual with bounded staleness.',
    'Multi-AZ must be statically stable: run N+1 capacity across ≥ 3 AZs so losing one AZ needs no scale-up; DB with synchronous standby in another AZ; failover ≈ 30–120 s.',
    'DR tiers by RTO/RPO: backup & restore (hours/hours) → pilot light (tens of minutes) → warm standby (minutes) → active-active (seconds/≈0). RPO is set by replication mode; untested backups are not backups.',
    'Sudden latency with no deploy: check dependency latency, saturation (pools, CPU throttling, GC), traffic mix, noisy neighbours, DB plan flips/autovacuum, and cert/DNS/network changes. Errors after deploy: roll back first, diff second.',
    'Tracing: W3C traceparent propagated through HTTP, gRPC AND message headers; tail-based sampling keeps slow/error traces. Stale search = broken CDC/indexer pipeline: measure lag as now − last indexed event timestamp.',
  ],
  sections: [
    {
      heading: '1. Incident: duplicate orders and double-charged payments — idempotency',
      body: `**Intuition:** an elevator button is idempotent — pressing it five times calls one elevator. A "Pay" button that charges five times is a bug in every layer that retried without asking "have I already done this?".

**Symptoms:** support tickets "charged twice", two orders with identical carts seconds apart, PSP dashboard showing duplicate captures, spikes correlated with a gateway timeout incident or a mobile app release that added auto-retry.

**First 5 minutes:**
- Quantify: find duplicates by (user, amount, cart hash) within a short window (SQL below).
- Correlate with timeouts: did the gateway/LB return 504 while the backend actually completed? Did the queue redeliver (consumer crash before ack/commit)?
- Stop the bleeding: if a client retry loop is the trigger, disable it via remote config; pause auto-capture if duplicates are still being created.

**Root causes:**
- **Timeout ≠ failure.** Client times out at 10 s, the server finishes at 12 s, client retries → second order.
- Retries at multiple layers (SDK, gateway, service mesh) on non-idempotent POSTs.
- At-least-once message delivery with a non-idempotent consumer.
- Double-click / double-submit from the UI.
- "Check-then-insert" dedup in application code without a unique constraint (two concurrent requests both see "not exists").

**Fix now:** refund duplicates (reconcile against the PSP), disable retries on POST at the gateway, add a unique constraint on a natural key where one exists (e.g. \`(cart_id)\` for orders).

**Fix permanently:**
- **Idempotency-Key header** (client-generated UUID per logical operation, reused on retry). Server: insert the key with a UNIQUE constraint *before* doing work, in the same transaction as the business write or with a state machine (\`started → completed\`), store the response, replay it on duplicates, reject the same key with a different request hash (422).
- Forward the key downstream — Stripe/Adyen accept idempotency keys, so a retry never captures twice.
- Consumers: dedup table (\`processed_messages(message_id PK)\`) written in the same transaction as the side effect.
- Keys expire (e.g. 24 h), sized for the retry window.

**What to say in the interview:** "Every retryable, side-effecting operation gets an idempotency key that is enforced by a unique constraint in the same transaction as the write, and the key is propagated to the payment provider. I never rely on 'check if exists' in application code."`,
      code: [
        {
          language: 'sql',
          title: 'Find duplicate charges, then the table that prevents them',
          code: `-- Duplicates: same user, same amount, within 60 s of each other
SELECT a.user_id, a.id AS first_id, b.id AS dup_id, a.amount_cents,
       b.created_at - a.created_at AS gap
FROM payments a
JOIN payments b
  ON b.user_id = a.user_id
 AND b.amount_cents = a.amount_cents
 AND b.id > a.id
 AND b.created_at BETWEEN a.created_at AND a.created_at + interval '60 seconds'
WHERE a.created_at > now() - interval '1 day'
ORDER BY a.created_at DESC;

-- Idempotency store: UNIQUE key is the real guarantee
CREATE TABLE idempotency_keys (
  tenant_id     uuid        NOT NULL,
  key           text        NOT NULL,
  request_hash  text        NOT NULL,          -- sha256 of method+path+body
  status        text        NOT NULL DEFAULT 'started',  -- started | completed
  response_code int,
  response_body jsonb,
  locked_until  timestamptz,                   -- recovery for crashed 'started' rows
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
CREATE INDEX ON idempotency_keys (created_at);  -- for TTL cleanup (e.g. 24 h)`,
        },
        {
          language: 'typescript',
          title: 'Idempotent payment endpoint (pg, NestJS service)',
          code: `import { Injectable, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { createHash } from 'node:crypto';

@Injectable()
export class PaymentsService {
  constructor(private readonly pool: Pool, private readonly psp: { charge(o: object): Promise<{ id: string }> }) {}

  async charge(tenantId: string, key: string, body: { orderId: string; amountCents: number }) {
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    // 1) claim the key atomically; ON CONFLICT means someone already used it
    const claim = await this.pool.query(
      'INSERT INTO idempotency_keys (tenant_id, key, request_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [tenantId, key, hash],
    );
    if (claim.rowCount === 0) {
      const { rows } = await this.pool.query(
        'SELECT request_hash, status, response_code, response_body FROM idempotency_keys WHERE tenant_id = $1 AND key = $2',
        [tenantId, key],
      );
      if (rows[0].request_hash !== hash) throw new UnprocessableEntityException('key reused with different body');
      if (rows[0].status !== 'completed') throw new ConflictException('request in progress, retry later');
      return rows[0].response_body;                    // replay: no second charge
    }
    // 2) do the side effect; forward the SAME key so the PSP dedups its retries too
    const result = await this.psp.charge({ ...body, idempotencyKey: tenantId + ':' + key });
    const response = { paymentId: result.id, status: 'captured' };
    await this.pool.query(
      "UPDATE idempotency_keys SET status = 'completed', response_code = 201, response_body = $3 WHERE tenant_id = $1 AND key = $2",
      [tenantId, key, response],
    );
    return response;
  }
}`,
        },
      ],
      keyPoints: [
        'Timeouts make outcomes unknown; retries must be safe by design.',
        'Unique constraint first, work second, stored response replayed.',
        'Propagate the key to the PSP; dedup consumers in the same transaction as the effect.',
      ],
      source: 'Stripe Engineering — Designing robust and predictable APIs with idempotency',
    },
    {
      heading: '2. Incident: race condition — oversold inventory and lost updates',
      body: `**Intuition:** two cashiers both check the shelf ("one left!"), both sell it. Nothing crashed, no error was logged — the data is simply wrong.

**Symptoms:** stock goes negative or more orders than units; a counter lower than the number of events; "my change vanished" (two admins editing the same record); wallet balance inconsistent with its ledger. Often appears only under load or after a scale-out (more concurrency).

**First 5 minutes:**
- Reconcile: compare derived state with the source of truth (orders vs stock, ledger sum vs balance) to size the damage.
- Find the code path: a read → compute in app → write sequence (\`SELECT stock\`, then \`UPDATE SET stock = :newValue\`).
- Check isolation level (Postgres default READ COMMITTED does **not** prevent lost updates in read-modify-write done in app code).

**Root causes:** read-modify-write without a lock or condition; check-then-act (\`if (!exists) insert\`) without a unique constraint; in-memory locks/mutex that only work within one pod; cache-then-DB updates in the wrong order; concurrent consumers processing messages for the same entity out of order.

**Fix now:** add a DB constraint (\`CHECK (stock >= 0)\`) so bad writes fail loudly; reduce concurrency on the hot path (single consumer per entity via partition key) while fixing.

**Fix permanently (pick per case):**

| Technique | How | Best for |
|---|---|---|
| Atomic conditional update | \`UPDATE … SET stock = stock − $n WHERE id = $1 AND stock >= $n\`, check rowCount | counters, inventory |
| Optimistic concurrency | \`version\` column, \`WHERE version = $v\`, retry on 0 rows | low-contention edits, APIs with ETag/If-Match |
| Pessimistic lock | \`SELECT … FOR UPDATE\` inside a short transaction | multi-row invariants, high contention |
| SERIALIZABLE isolation | DB detects anomalies, abort with 40001, app retries | complex invariants (write skew) |
| Single writer | partition by entity (Kafka key) so one consumer owns it | event-driven systems |

**What to say in the interview:** "I push the invariant into the database — a conditional update or constraint — so correctness doesn't depend on timing. Application-level mutexes don't work across pods, and READ COMMITTED doesn't save you from read-modify-write."`,
      code: [
        {
          language: 'typescript',
          title: 'Racy vs safe stock decrement',
          code: `import { Pool } from 'pg';
const pool = new Pool();

// RACY: two requests read stock=1 concurrently, both write 0, both succeed -> oversold
export async function reserveRacy(productId: string, qty: number) {
  const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [productId]);
  if (rows[0].stock < qty) throw new Error('out of stock');
  await pool.query('UPDATE products SET stock = $2 WHERE id = $1', [productId, rows[0].stock - qty]);
}

// SAFE: the condition and the write are one atomic statement
export async function reserve(productId: string, qty: number): Promise<boolean> {
  const res = await pool.query(
    'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2',
    [productId, qty],
  );
  return res.rowCount === 1; // 0 rows = insufficient stock (or unknown id), never negative
}

// SAFE (optimistic): for edits of whole documents, compare-and-set on a version
export async function updateProfile(id: string, version: number, patch: { bio: string }) {
  const res = await pool.query(
    'UPDATE profiles SET bio = $3, version = version + 1 WHERE id = $1 AND version = $2',
    [id, version, patch.bio],
  );
  if (res.rowCount === 0) throw new Error('409: modified by someone else, reload and retry');
}`,
        },
      ],
      keyPoints: [
        'Races are silent: detect them with reconciliation, not error logs.',
        'Make the DB enforce the invariant (conditional update, constraint, version).',
        'In-process mutexes are useless with more than one pod.',
      ],
    },
    {
      heading: '3. Incident: deadlocks in the database',
      body: `**Intuition:** two people in a corridor each waiting for the other to step aside. The database is the janitor who eventually tells one of them to go back.

**Symptoms:** sporadic errors \`deadlock detected\` (Postgres SQLSTATE \`40P01\`) or MySQL \`1213 Deadlock found when trying to get lock\`; latency spikes of ~1 s on some writes (Postgres waits \`deadlock_timeout\`, default 1 s, before running detection); errors grow with concurrency; batch jobs colliding with API traffic.

**First 5 minutes:**
- Postgres logs the deadlock with both statements (\`log_lock_waits = on\` also logs waits > deadlock_timeout). MySQL: \`SHOW ENGINE INNODB STATUS\` → LATEST DETECTED DEADLOCK.
- Current lock waits: \`pg_blocking_pids()\` query below.
- Identify the two code paths and the **order** in which they lock rows/tables.

**Root causes:**
- Two transactions locking the same rows in **different orders** (transfer A→B while another does B→A; batch updating rows in random order while API updates in id order).
- Long transactions holding locks while doing network calls.
- Foreign keys: inserting child rows takes \`FOR KEY SHARE\` locks on parents; updating parents concurrently can deadlock.
- MySQL gap/next-key locks under REPEATABLE READ on range updates and inserts.
- Bulk \`UPDATE … WHERE status = 'x'\` touching rows in heap order while other txns lock them individually.

**Fix now:** add retry-on-40P01 (with jitter) to the affected transaction — deadlock victims are safe to retry because the DB rolled them back; move the colliding batch job off-peak.

**Fix permanently:**
- **Consistent lock ordering**: lock rows sorted by primary key (\`SELECT … WHERE id = ANY($1) ORDER BY id FOR UPDATE\`).
- Keep transactions short; never call external services inside a transaction.
- Batch jobs: process in small, ordered chunks; \`FOR UPDATE SKIP LOCKED\` for queue-like work.
- Lower isolation where appropriate (MySQL READ COMMITTED eliminates most gap locks).
- Monitor \`pg_stat_database.deadlocks\` rate.

**What to say in the interview:** "Deadlocks are a lock-ordering bug, and the DB already resolved them by aborting a victim. I make victims retry safely, then fix the order — sort the keys, shorten the transaction, and keep batch jobs from locking in a different order than the online path."`,
      code: [
        {
          language: 'sql',
          title: 'Who blocks whom, and deadlock counters',
          code: `-- Blocked sessions and the sessions blocking them
SELECT blocked.pid                    AS blocked_pid,
       left(blocked.query, 60)        AS blocked_query,
       blocking.pid                   AS blocking_pid,
       left(blocking.query, 60)       AS blocking_query,
       now() - blocking.xact_start    AS blocking_txn_age
FROM pg_stat_activity blocked
JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
JOIN pg_stat_activity blocking ON blocking.pid = b.pid
ORDER BY blocking_txn_age DESC;

-- Deadlocks since stats reset (alert on the rate of change)
SELECT datname, deadlocks FROM pg_stat_database WHERE datname = current_database();

-- Settings that make diagnosis possible
-- ALTER SYSTEM SET log_lock_waits = on;      -- logs waits longer than deadlock_timeout
-- ALTER SYSTEM SET deadlock_timeout = '1s';  -- default; detection delay`,
        },
        {
          language: 'typescript',
          title: 'Transfer with ordered locks and retry on deadlock/serialization failure',
          code: `import { Pool, PoolClient } from 'pg';
const pool = new Pool();
const RETRYABLE = new Set(['40P01', '40001']); // deadlock_detected, serialization_failure

export async function transfer(from: string, to: string, cents: number) {
  for (let attempt = 1; ; attempt++) {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      // lock both accounts in a GLOBAL order (by id) -> A->B and B->A can't deadlock
      const ids = [from, to].sort();
      await client.query('SELECT id FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE', [ids]);
      const debit = await client.query(
        'UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2', [from, cents]);
      if (debit.rowCount !== 1) throw new Error('insufficient funds');
      await client.query('UPDATE accounts SET balance = balance + $2 WHERE id = $1', [to, cents]);
      await client.query('COMMIT');
      return;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!RETRYABLE.has(err.code) || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 50)); // jitter
    } finally {
      client.release();
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Deadlock victims were rolled back — retrying them is safe.',
        'Sort keys before locking; keep transactions short and free of network calls.',
        'Batch jobs are the usual second party in a deadlock.',
      ],
    },
    {
      heading: '4. Incident: "we need a distributed lock" — and the lock that failed',
      body: `**Intuition:** a distributed lock is a hotel key card with an expiry time. If you fall asleep in the room past checkout, the hotel gives your room to someone else — and you both wake up inside it.

**Symptoms:** a cron job ran twice (two pods, two emails to every customer); two workers processed the same file; a "leader" and a zombie ex-leader both writing; Redis lock "held" but the work took longer than its TTL.

**First 5 minutes:**
- Confirm double execution from logs (same job/run ID on two hosts; overlapping timestamps).
- Check lock TTL vs job duration distribution (p99 duration > TTL = guaranteed overlap), GC pauses, Redis failover events (a replica promoted before replicating the lock key).
- Is the lock released by value check? (\`DEL key\` without checking the token deletes someone else's lock.)

**Root causes:**
- TTL shorter than work; no renewal (watchdog).
- Process paused (GC, CPU throttling, VM migration) past TTL, then continues writing.
- Unsafe release (plain \`DEL\`).
- Redis async replication: lock written to primary, primary dies, replica promoted without it → second holder.
- Using a lock where a **constraint or idempotency** would be simpler and actually correct.

**Fix now:** make the side effect idempotent (dedup table) so double runs are harmless; for scheduled jobs, use a single-run mechanism (Kubernetes CronJob with \`concurrencyPolicy: Forbid\`, or a DB row claim).

**Fix permanently:**
- Prefer **not needing a lock**: unique constraints, conditional updates, single-writer partitioning, \`SELECT … FOR UPDATE SKIP LOCKED\` job claims, Postgres advisory locks when the work is in the same DB.
- If you need one: \`SET key token NX PX ttl\`, release with a Lua compare-and-delete, renew while working.
- For correctness-critical resources: **fencing tokens** — a monotonically increasing number issued with the lock (etcd revision, ZooKeeper zxid, DB sequence); the storage rejects writes with a token older than the last one seen. Redlock alone doesn't provide fencing.
- Use consensus-backed coordination (etcd/ZooKeeper/Consul leases) for leader election.

**What to say in the interview:** "A lock with a TTL is a lease: it gives mutual exclusion for efficiency, not for correctness. If double execution is harmful I either make the operation idempotent or enforce fencing tokens at the resource."`,
      code: [
        {
          language: 'typescript',
          title: 'Redis lease with safe release and renewal, plus a fenced write',
          code: `import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const redis = new Redis();
const pool = new Pool();

// Compare-and-delete: only the holder's token may release
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const RENEW = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";

export async function withLease<T>(key: string, ttlMs: number, work: (signal: AbortSignal) => Promise<T>) {
  const token = randomUUID();
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (ok !== 'OK') return null;                              // someone else holds it
  const ac = new AbortController();
  const timer = setInterval(async () => {                    // watchdog renewal at ttl/3
    const renewed = await redis.eval(RENEW, 1, key, token, String(ttlMs)).catch(() => 0);
    if (renewed !== 1) ac.abort();                           // lost the lease: stop working
  }, ttlMs / 3);
  try {
    return await work(ac.signal);
  } finally {
    clearInterval(timer);
    await redis.eval(RELEASE, 1, key, token);
  }
}

// Fencing: storage rejects stale holders even if they wake up after a long GC pause
export async function writeReport(reportId: string, fencingToken: number, body: string) {
  const res = await pool.query(
    'UPDATE reports SET body = $3, fence = $2 WHERE id = $1 AND fence < $2',
    [reportId, fencingToken, body],
  );
  if (res.rowCount === 0) throw new Error('stale lock holder rejected');
}`,
        },
      ],
      keyPoints: [
        'First ask whether a constraint, idempotency or single writer removes the need.',
        'Token-checked release + renewal; TTL above p99 work time.',
        'Fencing tokens are what make a lock safe for correctness.',
      ],
      source: 'Designing Data-Intensive Applications — Ch 8 (fencing tokens)',
    },
    {
      heading: '5. Incident: stale reads hurt — strong consistency vs eventual consistency',
      body: `**Intuition:** a bank statement can be a day old; the balance check before a withdrawal cannot. Consistency is a per-operation choice, not a per-system one.

**Symptoms:** a user pays, then sees "unpaid" on the next screen; two users both book the last seat; an admin disables an account but the account keeps working for 30 s; counts differ between pages; complaints spike after a read-replica or cache was added.

**First 5 minutes:**
- Which read served stale data? Replica (lag), cache (TTL/invalidation), search index (indexing lag), or a different region?
- Measure the staleness window: replica lag, cache TTL, CDC lag.
- Is the decision made on stale data (booking, authorisation) or only displayed (feed)? The first is a correctness bug; the second is UX.

**Decision framework:**

| Operation | Needs | Mechanism |
|---|---|---|
| Money movement, inventory decrement, seat booking, uniqueness (usernames) | Linearizable / serialisable on the decision | single leader + transaction/conditional write; consensus store (Spanner, CockroachDB, etcd) |
| Read-after-own-write (profile edit, order status after checkout) | Session consistency | primary stickiness, LSN tokens, write-through cache |
| Authorisation revocation | Bounded staleness (seconds) | short TTLs, push invalidation, token revocation lists |
| Feeds, like counts, search, recommendations, analytics | Eventual | async replication, caches, CDC |

**Root causes of the incident:** a decision path moved to a replica/cache "for performance"; cache invalidation ordered wrong (delete-then-write races refill the old value); cross-region async replication for a globally unique resource.

**Fix now:** route the affected decision path back to the primary; shorten TTLs or disable the cache for that endpoint.

**Fix permanently:** classify every endpoint by consistency need; make the *decision* strongly consistent even if displays are eventual (check seat availability from cache, but **commit** with a conditional write on the primary); use read-your-writes tokens; document staleness SLOs ("search reflects changes within 5 s p99").

**What to say in the interview:** "I separate decisions from displays. Decisions that protect invariants go to the single source of truth with a conditional write; displays can be eventually consistent with a stated staleness bound, plus read-your-writes for the user who just changed something."`,
      code: [
        {
          language: 'typescript',
          title: 'Eventual for display, strong for the decision',
          code: `import { Pool } from 'pg';
import Redis from 'ioredis';

const primary = new Pool({ host: 'pg-primary' });
const replica = new Pool({ host: 'pg-replica' });
const cache = new Redis();

// DISPLAY: seat map may be a few seconds stale -> cache + replica are fine
export async function seatMap(showId: string) {
  const cached = await cache.get('seatmap:' + showId);
  if (cached) return JSON.parse(cached);
  const { rows } = await replica.query('SELECT seat_no, status FROM seats WHERE show_id = $1', [showId]);
  await cache.set('seatmap:' + showId, JSON.stringify(rows), 'EX', 5);
  return rows;
}

// DECISION: booking must be linearizable per seat -> conditional write on the primary
export async function bookSeat(showId: string, seatNo: string, userId: string) {
  const res = await primary.query(
    "UPDATE seats SET status = 'held', held_by = $3, held_until = now() + interval '10 minutes' " +
    "WHERE show_id = $1 AND seat_no = $2 AND (status = 'free' OR held_until < now())",
    [showId, seatNo, userId],
  );
  await cache.del('seatmap:' + showId);  // best-effort invalidation after the write
  return res.rowCount === 1;             // false: someone else got it, show a fresh map
}`,
        },
      ],
      keyPoints: [
        'Consistency is chosen per operation.',
        'Decisions go to the source of truth with a conditional write; displays can lag.',
        'State staleness bounds as SLOs.',
      ],
    },
    {
      heading: '6. Incident: one availability zone is down',
      body: `**Intuition:** an AZ is one building of a data centre campus. Losing one should feel like losing a server: a blip, not an outage — but only if you already paid for the spare capacity.

**Symptoms:** a third of pods NotReady or unreachable; elevated errors/timeouts for ~1–2 minutes; a DB failover event; cloud status page reports "increased error rates in use1-az2"; cross-AZ latency spikes (gray failure: the AZ is slow, not dead).

**First 5 minutes:**
- Confirm scope: errors/latency grouped by \`topology.kubernetes.io/zone\`; node readiness per zone.
- Is the DB primary in the affected AZ? Did managed failover complete (RDS Multi-AZ failover typically 60–120 s; Aurora ~30 s)?
- Are LBs still sending traffic to the impaired AZ (health checks passing but slow = gray failure)?
- Can the remaining AZs absorb the load, or are pods Pending (no capacity, or everyone else is scaling up in the same region at the same time)?

**Root causes of an AZ loss turning into an outage:**
- Capacity only for normal load in 3 AZs — remaining 2 AZs at 150% load.
- Relying on **scale-up during the event** (control planes and capacity are congested regionally during AZ incidents).
- Single-AZ dependencies: NAT gateway, a cache node, a Kafka broker set with replicas in the same AZ, an EBS-backed stateful pod pinned to its AZ.
- Clients caching DNS for the old DB endpoint; connection pools that don't reconnect.
- Gray failure: health checks pass, real requests time out.

**Fix now:** evacuate the AZ — remove it from LB target groups / enable zonal shift (e.g. AWS ARC zonal shift), cordon its nodes; force the DB failover if the primary is impaired but not failed; restart pods with stale connections.

**Fix permanently:**
- **Static stability**: provision so N−1 AZs carry peak (3 AZs at ≤ 66% utilisation each); don't depend on the control plane during failure.
- Spread everything: topology spread constraints, PDBs, one NAT gateway per AZ, Kafka rack awareness (\`broker.rack\`), Redis replicas in other AZs.
- Synchronous standby for the DB in another AZ (RPO ≈ 0); drivers with short DNS TTL and reconnect logic.
- Zonal isolation: prefer in-AZ routing to limit cross-AZ dependencies, with automatic zonal shift on outlier detection.
- Game days: actually fail an AZ.

**What to say in the interview:** "Multi-AZ only works if it's statically stable — pre-provisioned so two AZs carry peak without scaling. The first action is to evacuate the impaired AZ, especially for gray failures where health checks lie."`,
      code: [
        {
          language: 'yaml',
          title: 'Zone spread so losing one AZ leaves ≥ 2/3 capacity',
          code: `spec:
  replicas: 12                        # peak needs 8 -> 12 across 3 AZs survives losing one
  template:
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule   # never pile into 2 AZs silently
          labelSelector: { matchLabels: { app: checkout } }
        - maxSkew: 2
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector: { matchLabels: { app: checkout } }
---
# PromQL during the incident: error ratio by zone
# sum by (zone) (rate(http_requests_total{code=~"5.."}[1m]))
#   / sum by (zone) (rate(http_requests_total[1m]))`,
        },
      ],
      keyPoints: [
        'Static stability: N−1 AZs carry peak without scaling.',
        'Evacuate impaired AZs quickly — gray failures fool health checks.',
        'Hunt single-AZ dependencies: NAT, caches, brokers, pinned volumes.',
      ],
      source: 'AWS Well-Architected — Reliability Pillar',
    },
    {
      heading: '7. Incident: a whole region is down — and designing multi-region',
      body: `**Intuition:** a region is a city. Surviving a city outage means having a second city with its own copy of the data, its own capacity, and a pre-agreed way to send everyone there.

**Symptoms:** everything in one region failing (or its control plane: can't launch instances, can't change DNS records hosted there), health checks from other regions failing, cross-region replication lag growing without bound.

**First 5 minutes:**
- Confirm it's regional (multiple AZs, multiple services, provider status) rather than your own deploy.
- **Decide failover early** using pre-agreed criteria ("> 15 min regional impairment on the critical path"). Waiting 2 hours for the provider is a decision too.
- Check the replication lag at the moment of failure → that is your **data loss window (RPO)** if you fail over.
- Verify the standby region's capacity and that its dependencies (secrets, third-party allowlists, certificates) work.

**Failover mechanics:** DNS/GeoDNS or global LB (Route 53 health-checked records with 60 s TTL, Global Accelerator/anycast, Cloudflare LB), promote the replica DB, flip write-routing config, scale the passive region to full size (unless already warm). Avoid depending on the failed region's control plane to fail away from it (e.g. data-plane routing controls, ARC).

**Multi-region architectures:**

| Pattern | Writes | RPO / RTO | Complexity |
|---|---|---|---|
| Active-passive (warm standby) | one region; async replica elsewhere | seconds–minutes / 5–30 min | medium |
| Read-local, write-home | writes to home region; reads served regionally | per-user home | medium |
| Geo-partitioned (users homed per region) | each user's data written in their region | region loss affects its users | medium-high |
| Active-active with conflict resolution | any region (CRDTs, LWW, per-key ownership) | ≈ 0 / seconds | high |
| Globally consistent DB (Spanner, CockroachDB) | consensus across regions | 0 / seconds | high latency for writes (cross-region quorum) |

**Root causes of failed failovers:** never tested; standby under-sized; hard-coded region endpoints; the DNS provider or IAM in the failed region; split-brain when the old region comes back and keeps accepting writes; async replication losing the last seconds of payments.

**Fix permanently:** pick the pattern per domain (payments: single-writer with synchronous or consensus replication; catalog: active-active reads); automate and rehearse failover quarterly; fence the old primary (block writes) before promoting; design fail-back.

**What to say in the interview:** "Multi-region is a data problem, not a compute problem. I choose per domain between active-passive with an explicit RPO and active-active with a conflict strategy, pre-provision or pre-warm the standby, fence the old writer, and rehearse failover — an untested runbook is a hypothesis."`,
      diagram: `             GeoDNS / anycast global LB (health-checked)
                 │                               │
        ┌────────▼────────┐             ┌────────▼────────┐
        │ region A (home) │             │ region B (warm) │
        │ app x30         │             │ app x10 -> x30  │
        │ PG primary ─────┼── async ───►│ PG replica      │
        │ Kafka ──────────┼─ MirrorMaker►│ Kafka           │
        └─────────────────┘  lag = RPO  └─────────────────┘
  failover: fence A writes -> promote B -> flip DNS/LB -> scale B`,
      code: [
        {
          language: 'bash',
          title: 'Region failover runbook skeleton (Postgres + DNS)',
          code: `#!/usr/bin/env bash
set -euo pipefail
# 0. Record the data-loss window BEFORE promoting (run on the standby)
psql -h pg-b -c "SELECT now() - pg_last_xact_replay_timestamp() AS replica_lag;"

# 1. Fence the old writer so a recovering region A cannot accept writes (split-brain)
kubectl --context region-a scale deploy/orders-api --replicas=0 || echo "region A unreachable"
# app-level fence: writers check this flag before any write
aws ssm put-parameter --region eu-west-1 --name /orders/write-region --value B --overwrite

# 2. Promote the standby
psql -h pg-b -c "SELECT pg_promote(wait => true, wait_seconds => 60);"

# 3. Scale region B to full capacity (warm standby runs at ~30%)
kubectl --context region-b scale deploy/orders-api --replicas=30

# 4. Shift traffic: weighted records to 100% B (short TTLs set in advance: 60s)
aws route53 change-resource-record-sets --hosted-zone-id Z123 \\
  --change-batch file://shift-to-region-b.json

# 5. Verify: error rate, write success, replication topology; then announce`,
        },
      ],
      keyPoints: [
        'Replication lag at failure time = data loss (RPO).',
        'Fence the old writer before promoting; plan fail-back.',
        'Pick the multi-region pattern per domain; rehearse failover.',
      ],
    },
    {
      heading: '8. Incident: disaster recovery — the accidental DELETE, ransomware, or lost database',
      body: `**Intuition:** replication protects you from machines dying; backups protect you from *people and software* doing the wrong thing — because replication faithfully copies a \`DELETE\` to every replica within milliseconds.

**Symptoms:** a migration or script deleted/updated the wrong rows; a bug corrupted data for hours; ransomware encrypted volumes; a cloud account compromised; the managed DB is unrecoverable.

**First 5 minutes:**
- **Stop the damage**: disable the job/deploy/credentials causing it; put affected features in read-only mode.
- Determine the **point in time** just before the damage (audit logs, WAL/binlog timestamps, first error report).
- Do **not** fail over to a replica (it has the same damage). Preserve evidence; snapshot the current state before restoring.
- Communicate: RTO estimate, what data is affected.

**Key concepts:**
- **RPO** (how much data you can lose) and **RTO** (how long you can be down) per system, agreed with the business.
- **PITR** (point-in-time recovery): base backup + continuous WAL archiving (pgBackRest, WAL-G, RDS PITR with ~5 min granularity of restorable time). Restore to a *new* instance at T−1s, then copy back only the affected rows — rather than rolling the whole DB back and losing all later good writes.
- **Delayed replica** (\`recovery_min_apply_delay = '1h'\`) gives a live copy from an hour ago for fast surgical recovery.
- **3-2-1 and immutability**: 3 copies, 2 media, 1 off-site; object-lock/WORM backups in a separate account so a compromised prod account can't delete them.
- **Restore drills**: measure actual restore time (a 5 TB restore can take many hours — that *is* your RTO).

**DR strategies (AWS terminology):** backup & restore (RTO hours) → pilot light (core data replicated, compute off; tens of minutes) → warm standby (scaled-down full stack; minutes) → multi-site active-active (near zero).

**Fix permanently:** PITR on every stateful store (DBs, but also Redis-as-source-of-truth, Elasticsearch snapshots, S3 versioning), cross-account immutable copies, delayed replica for the core DB, soft deletes for user-facing deletes, guardrails on destructive scripts (dry run, row-count limits, peer review), quarterly restore drills with measured RTO.

**What to say in the interview:** "Replicas are not backups — they replicate mistakes. I'd restore a PITR copy to just before the damage, surgically copy back the affected rows, and I'd quote RTO from a real restore drill, not from the documentation."`,
      code: [
        {
          language: 'sql',
          title: 'Surgical recovery from a PITR restore (restored copy attached via postgres_fdw)',
          code: `-- On prod: attach the restored instance (restored to 2026-09-28 10:41:59, just before the bad DELETE)
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SERVER pitr_restore FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'pg-pitr-restore', dbname 'orders');
CREATE USER MAPPING FOR CURRENT_USER SERVER pitr_restore
  OPTIONS (user 'recovery', password 'from-secrets-manager');
CREATE SCHEMA IF NOT EXISTS pitr;
IMPORT FOREIGN SCHEMA public LIMIT TO (order_items) FROM SERVER pitr_restore INTO pitr;

-- Dry run: how many rows vanished?
SELECT count(*) FROM pitr.order_items r
WHERE NOT EXISTS (SELECT 1 FROM public.order_items p WHERE p.id = r.id);

-- Restore only the deleted rows; later legitimate writes stay intact
BEGIN;
INSERT INTO public.order_items
SELECT r.* FROM pitr.order_items r
WHERE NOT EXISTS (SELECT 1 FROM public.order_items p WHERE p.id = r.id)
ON CONFLICT (id) DO NOTHING;
-- verify counts match the dry run before committing
COMMIT;`,
        },
      ],
      keyPoints: [
        'Replication copies mistakes; backups and PITR undo them.',
        'Restore to a new instance, then copy back surgically.',
        'Immutable, cross-account backups and measured restore drills.',
      ],
      source: 'AWS Well-Architected — Reliability Pillar (DR strategies)',
    },
    {
      heading: '9. Incident: API latency suddenly increases (no deploy)',
      body: `**Intuition:** latency is the sum of waiting and working. If nobody changed the code, something changed the waiting — a queue, a dependency, or the environment.

**Symptoms:** p99 of one or many endpoints jumps (e.g. 80 ms → 900 ms) at a clear timestamp; p50 may be flat (tail problem) or moved (everything slower); no deploy in the window.

**First 5 minutes:**
1. **Scope:** all endpoints or one? all pods or some (one AZ, one node)? all tenants or one?
2. **What changed anyway?** Config/flag changes, cron/batch jobs, traffic mix (a big customer started a bulk export), certificate rotation, DNS, infra maintenance, autovacuum, a dependency's deploy.
3. **Saturation signals:** pool acquire time, event-loop lag, CPU throttling, GC pauses, DB active sessions and wait events, cache hit ratio.
4. **Dependency latency:** client-side histograms per downstream — did Redis/DB/PSP get slower?

**Root causes (common, in rough frequency order):**
- A dependency got slower (DB plan flip after \`ANALYZE\` stats change, index bloat, autovacuum, noisy neighbour on a managed service, third-party degradation).
- Saturation: pool exhausted → requests queue for connections; event loop blocked by a large payload.
- Traffic mix: one tenant sending huge requests or a new client using an expensive query pattern.
- Environment: CPU throttling after a node pool change; cross-AZ routing after a failover; DNS resolution slowness (no caching, \`ndots:5\` in Kubernetes causing multiple lookups).
- Retries: a dependency returning errors quietly retried → latency ×2–3.

**Fix now:** shed/limit the offending traffic; fail over or bypass the slow dependency (serve from cache, disable feature); for a plan flip, \`ANALYZE\` / pin the plan / add the missing index concurrently; restart pods only if you've captured evidence (heap/CPU profile).

**Fix permanently:** per-dependency latency SLOs and alerts; timeouts and budgets; per-tenant rate limits; plan-regression detection (\`pg_stat_statements\` mean-time alerts, \`auto_explain\` for slow queries); capacity headroom; tracing with exemplars linking p99 buckets to traces.

**What to say in the interview:** "No deploy doesn't mean no change. I scope the regression (endpoint, pod, tenant), then check saturation and each dependency's client-side latency. The answer is usually a slower dependency or a queue forming in front of a pool."`,
      code: [
        {
          language: 'text',
          title: 'PromQL + SQL: slicing a sudden p99 regression',
          code: `# Which endpoint regressed? p99 now vs 1 day ago
histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
  / histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m] offset 1d)))

# Which dependency got slower? client-side histograms per downstream
histogram_quantile(0.99, sum by (le, peer_service) (rate(client_request_duration_seconds_bucket[5m])))

# Queueing in front of the DB pool
histogram_quantile(0.99, sum by (le, pod) (rate(db_pool_acquire_seconds_bucket[5m])))

# Retries hiding errors
sum by (peer_service) (rate(client_retries_total[5m]))

-- Postgres: did a query's mean time jump (plan flip)? compare snapshots
SELECT queryid, calls, round(mean_exec_time::numeric, 1) AS mean_ms, left(query, 70)
FROM pg_stat_statements ORDER BY mean_exec_time * calls DESC LIMIT 10;
-- What are sessions waiting on right now?
SELECT wait_event_type, wait_event, count(*) FROM pg_stat_activity
WHERE state = 'active' GROUP BY 1, 2 ORDER BY 3 DESC;`,
        },
      ],
      keyPoints: [
        'Scope first: endpoint, pod, AZ, tenant.',
        'No deploy ≠ no change: flags, jobs, traffic mix, dependencies, stats.',
        'Client-side dependency histograms locate the slow hop fastest.',
      ],
      source: 'Google SRE Book — Ch 12 Effective Troubleshooting',
    },
    {
      heading: '10. Incident: errors increase after a deployment',
      body: `**Intuition:** the last thing that changed is the prime suspect. Don't interrogate it while the house is on fire — take it out of the room first.

**Symptoms:** 5xx or business errors rise within minutes of a deploy; error logs with a new exception signature; canary analysis failing (if you're lucky); consumers erroring on new message shapes.

**First 5 minutes:**
1. **Correlate**: deploy markers on the error graph; is the error rate higher on new-version pods (\`version\` label)?
2. **Mitigate**: canary abort / rollback / flag off — *before* root-causing. MTTR is dominated by time-to-mitigate.
3. **Check the blast radius beyond HTTP**: new events published in a new schema, migrations run, data written in a new format (rollback may not undo these).
4. Collect the new top error signatures (group logs by exception type + route).

**Root causes:**
- Code bug in a path not covered by tests.
- **Config drift**: env var/secret missing or different in prod; feature flag defaults differ across environments.
- **Contract break**: removed/renamed field; a consumer on an older version rejects the new payload; GraphQL schema change breaking a persisted query.
- **Migration mismatch**: new code assumes a column that isn't there yet (migration ordering), or old pods (still running during the rollout) break on the new schema.
- Dependency version bump (driver, ORM) changing defaults — timeouts, pool size, serialisation.
- Capacity: new version uses 2× memory → OOMKilled → errors.

**Fix now:** rollback (git revert in GitOps); if rollback is unsafe due to data/schema, forward-fix with the smallest change or disable via flag.

**Fix permanently:** canary with automated analysis; contract tests (Pact) and schema-registry compatibility checks in CI; expand/contract migrations run before code; config validated at boot (fail fast); release checklists for dependency upgrades; error-budget policy freezing releases after incidents.

**What to say in the interview:** "Roll back first, diff second. Then I check what a rollback doesn't undo — migrations, data written in new formats, events already published — and make canaries and contract tests catch it next time."`,
      code: [
        {
          language: 'bash',
          title: 'After-deploy error triage',
          code: `# Errors by version (new vs old pods) - if only new pods error, it's the release
# PromQL: sum by (version) (rate(http_requests_total{code=~"5.."}[2m]))
#         / sum by (version) (rate(http_requests_total[2m]))

# Mitigate first
kubectl argo rollouts abort checkout          # canary: 100% back to stable
kubectl rollout undo deploy/checkout          # plain Deployment (or git revert for GitOps)

# What exactly changed? image, env, config between revisions
kubectl rollout history deploy/checkout --revision=41 > r41.txt
kubectl rollout history deploy/checkout --revision=42 > r42.txt
diff r41.txt r42.txt

# Top new error signatures (JSON logs via Loki's logcli)
logcli query --since=30m --limit=5000 \\
  '{app="checkout", level="error"} | json | line_format "{{.error_type}} {{.route}}"' \\
  | sort | uniq -c | sort -rn | head -20`,
        },
      ],
      keyPoints: [
        'Split errors by version label to confirm causation.',
        'Mitigate first; rollback does not undo data, schema or published events.',
        'Contract tests and schema compatibility checks prevent the common breaks.',
      ],
    },
    {
      heading: '11. Incident: we cannot find where the latency originates — distributed tracing',
      body: `**Intuition:** metrics tell you *that* the checkout is slow; logs tell you *what* each service said; a trace tells you *where the time went* across 14 services, as one timeline.

**Symptoms:** p99 of the edge API is 2 s but every service's own dashboard looks "fine"; teams point at each other; logs can't be joined because there is no common request ID; async hops (Kafka) make the path invisible.

**First 5 minutes (without tracing):** propagate or find a request ID in gateway logs; compare each service's *server* latency with its callers' *client* latency to the same service (a large gap = network, queueing, retries or connection setup); look for fan-out (one request → 40 downstream calls).

**Root causes of "invisible latency":**
- Queueing before the handler runs (pool waits, event-loop lag, Kafka consumer lag) — not in server-side request timers.
- Sequential calls that could be parallel; N+1 across services.
- Retries and timeouts in client libraries or the mesh.
- DNS/TLS/connection setup (no keep-alive).
- Async hops where the context was lost.

**Fix — instrument with OpenTelemetry:**
- Auto-instrumentation for HTTP, gRPC, pg, ioredis, kafkajs; manual spans around business steps.
- **W3C Trace Context** (\`traceparent\` header) propagated everywhere — including **Kafka message headers**, so a consumer span links to the producer.
- **Sampling**: head-based (e.g. 1–10%) is cheap but drops the rare slow request; **tail-based sampling** in the OTel Collector keeps 100% of errors and slow traces plus a small % of the rest.
- **Exemplars**: attach trace IDs to histogram buckets so you click from the p99 spike to a real trace.
- Put trace_id in every log line to pivot between logs and traces.

**Reading a trace:** look for the longest span on the critical path, gaps between parent and child spans (queueing/serialisation), repeated sibling spans (N+1, retries), and spans with long client-side but short server-side durations (network, pool, DNS).

**What to say in the interview:** "I compare client-side and server-side latency per hop to find gaps, and roll out OpenTelemetry with trace context propagated over HTTP and Kafka headers, tail-based sampling to keep slow and error traces, and trace IDs in logs and exemplars."`,
      code: [
        {
          language: 'typescript',
          title: 'OpenTelemetry bootstrap + trace context through Kafka headers',
          code: `// tracing.ts - must be imported before anything else (node -r ./dist/tracing.js)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { context, propagation, trace } from '@opentelemetry/api';

export const sdk = new NodeSDK({
  serviceName: 'checkout',
  traceExporter: new OTLPTraceExporter({ url: 'http://otel-collector:4318/v1/traces' }),
  // keep everything at the SDK, let the collector's tail_sampling decide (errors, >1s, 5% rest)
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(1.0) }),
  instrumentations: [getNodeAutoInstrumentations()], // http, express, pg, ioredis, grpc...
});
sdk.start();

// Producer: inject the current context into Kafka headers
export function withTraceHeaders(headers: Record<string, string> = {}) {
  propagation.inject(context.active(), headers);     // adds traceparent / tracestate
  return headers;
}

// Consumer: extract and continue the trace
export async function handleMessage(msg: { headers?: Record<string, Buffer | undefined>; value: Buffer | null }) {
  const carrier: Record<string, string> = {};
  for (const [k, v] of Object.entries(msg.headers ?? {})) if (v) carrier[k] = v.toString();
  const parent = propagation.extract(context.active(), carrier);
  const tracer = trace.getTracer('checkout-consumer');
  await context.with(parent, () =>
    tracer.startActiveSpan('process order.created', async (span) => {
      try { /* business logic */ } finally { span.end(); }
    }),
  );
}`,
        },
      ],
      keyPoints: [
        'Client-vs-server latency gaps reveal queueing, retries and network.',
        'Propagate traceparent over HTTP, gRPC and message headers.',
        'Tail-based sampling keeps the slow/error traces you actually need.',
      ],
    },
    {
      heading: '12. Incident: search is slow, or the search index is stale',
      body: `**Intuition:** a search index is a separate, derived copy of your data optimised for finding things. It can be slow (the copy is badly organised or overloaded) or stale (the copy stopped receiving updates).

**Symptoms (slow):** search p99 from 150 ms to 3 s; Elasticsearch/OpenSearch search thread-pool queue and rejections rising; heap > 75% with long old-GC; one node hot.
**Symptoms (stale):** "I renamed my product but search shows the old name"; newly created items not found; indexing lag alert; CDC connector in FAILED state.

**First 5 minutes (slow):**
- \`GET _cluster/health\`, \`_cat/nodes?v&h=name,heap.percent,cpu,load_1m\`, \`_cat/thread_pool/search?v\` (queue, rejected).
- Slow log / \`profile: true\` for a representative query: leading wildcards, deep pagination (\`from\` + \`size\` of 10,000+), huge aggregations on high-cardinality fields, scripts.
- Shard layout: too many tiny shards (overhead) or too few huge ones (> 50 GB); hot node holding the busiest shards.
- Did a bulk reindex or merge storm start (indexing competing with search)?

**First 5 minutes (stale):**
- Measure lag: \`now − max(indexed_at)\` or the source-event timestamp of the last indexed document; Kafka consumer lag of the indexer group.
- Connector status (Debezium/Kafka Connect REST), indexer errors (mapping conflicts → documents rejected), \`refresh_interval\` (documents are searchable only after a refresh, default 1 s; many set 30 s or -1 during bulk loads and forget to revert).

**Root causes:** expensive query patterns, mapping explosions, oversharding, heap pressure; for staleness — dual writes from the app that silently fail, CDC connector stopped after a schema change, poison message blocking an indexer partition, rejected documents due to mapping type conflicts, refresh disabled.

**Fix now:** slow — cap pagination (\`search_after\`), disable expensive features (fuzzy, aggregations), add replicas for read throughput, throttle reindexing; stale — restart/repair the connector, skip/DLQ the poison message, restore \`refresh_interval\`, reindex the affected range.

**Fix permanently:** CDC/outbox-driven indexing (no dual writes), idempotent upserts by document ID with an external version (\`version_type=external\`) so out-of-order updates don't regress data, DLQ for rejected docs, indexing-lag SLO and alert, zero-downtime reindex via **aliases** (build new index, swap alias atomically), shard sizing (10–50 GB per shard), query review for new search features.

**What to say in the interview:** "Search is a derived view, so I monitor it like a replica: indexing lag is the SLO. For slowness I look at query shape and shard layout before adding nodes; for staleness I look at the pipeline — CDC connector, poison messages, rejected documents and refresh settings."`,
      code: [
        {
          language: 'bash',
          title: 'Elasticsearch/OpenSearch triage + alias-swap reindex',
          code: `ES=http://es:9200
# Slow: health, hot nodes, search thread-pool queue/rejections
curl -s "$ES/_cluster/health?pretty"
curl -s "$ES/_cat/nodes?v&h=name,heap.percent,cpu,load_1m,node.role"
curl -s "$ES/_cat/thread_pool/search?v&h=node_name,active,queue,rejected"
curl -s "$ES/_cat/shards/products*?v&h=index,shard,prirep,store,node&s=store:desc" | head

# Stale: refresh interval and indexer lag
curl -s "$ES/products/_settings/index.refresh_interval?include_defaults=true&pretty"
kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group search-indexer
curl -s http://connect:8083/connectors/products-cdc/status   # RUNNING vs FAILED

# Zero-downtime reindex: build v2, then swap the alias atomically
curl -s -XPOST "$ES/_reindex?wait_for_completion=false" -H 'Content-Type: application/json' \\
  -d '{"source":{"index":"products_v1"},"dest":{"index":"products_v2"}}'
curl -s -XPOST "$ES/_aliases" -H 'Content-Type: application/json' -d '{
  "actions": [
    { "remove": { "index": "products_v1", "alias": "products" } },
    { "add":    { "index": "products_v2", "alias": "products" } }
  ]}'`,
        },
      ],
      keyPoints: [
        'Treat the index like a replica: indexing lag is an SLO.',
        'Slow search is usually query shape, shard layout or heap — not node count.',
        'CDC/outbox + external versioning + alias swaps for safe, fresh indexes.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'prod-correctness-ops-cc-1',
      title: 'Stop the checkout endpoint from creating duplicate orders and charges',
      context:
        'After a gateway incident (504s at 10 s while the backend kept working), 1,800 customers were charged twice. The mobile app retries POST /checkout up to 3 times on timeout. The handler below is what production runs. PSP calls take 1–8 s.',
      task: 'Make checkout safe under client retries, concurrent double-submits and PSP timeouts: one order and at most one capture per logical checkout, correct replay of the original response, and no DB connection held during the PSP call.',
      starter: {
        language: 'typescript',
        title: 'checkout.service.ts (starter)',
        code: `import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class CheckoutService {
  constructor(private readonly pool: Pool, private readonly psp: any) {}

  async checkout(userId: string, cartId: string, amountCents: number) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // dedup: has this cart already been ordered?
      const existing = await client.query('SELECT id FROM orders WHERE cart_id = $1', [cartId]);
      if (existing.rowCount) return { orderId: existing.rows[0].id };

      const { rows } = await client.query(
        'INSERT INTO orders (user_id, cart_id, amount_cents, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, cartId, amountCents, 'pending'],
      );
      const charge = await this.psp.charge({ amountCents, userId });   // 1-8 s, inside txn
      await client.query('UPDATE orders SET status = $2, charge_id = $3 WHERE id = $1',
        [rows[0].id, 'paid', charge.id]);
      await client.query('COMMIT');
      return { orderId: rows[0].id, chargeId: charge.id };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}`,
      },
      hints: [
        'Two concurrent requests both run the SELECT before either INSERT commits. What in the database — not the application — can make the second one fail?',
        'If the PSP call succeeds but the COMMIT fails (or the pod dies), what does the retry see, and does the PSP know it is a retry?',
        'Split the operation into a short "claim" transaction, the external call, and a short "complete" transaction. What state do you store in between?',
      ],
      solution: {
        language: 'typescript',
        title: 'checkout.service.ts (solution)',
        code: `import { Injectable, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';

// Schema: orders.cart_id UNIQUE; orders.status in ('pending','paid','failed')
@Injectable()
export class CheckoutService {
  constructor(
    private readonly pool: Pool,
    private readonly psp: { charge(o: object): Promise<{ id: string; status: string }> },
  ) {}

  async checkout(userId: string, cartId: string, amountCents: number) {
    // 1) CLAIM: short txn; the UNIQUE(cart_id) constraint is the dedup guarantee
    const ins = await this.pool.query(
      "INSERT INTO orders (user_id, cart_id, amount_cents, status) VALUES ($1, $2, $3, 'pending') " +
      'ON CONFLICT (cart_id) DO NOTHING RETURNING id',
      [userId, cartId, amountCents],
    );
    const { rows } = ins.rowCount
      ? ins
      : await this.pool.query('SELECT id, status, charge_id, amount_cents FROM orders WHERE cart_id = $1', [cartId]);
    const order = rows[0];

    if (order.status === 'paid') return { orderId: order.id, chargeId: order.charge_id }; // replay
    if (order.amount_cents !== undefined && order.amount_cents !== amountCents) {
      throw new ConflictException('cart already checked out with a different amount');
    }

    // 2) SIDE EFFECT outside any transaction; key = order id, so PSP retries are deduped too
    const charge = await this.psp.charge({ amountCents, userId, idempotencyKey: 'order-' + order.id });

    // 3) COMPLETE: conditional transition, safe if two retries race here
    await this.pool.query(
      "UPDATE orders SET status = 'paid', charge_id = $2 WHERE id = $1 AND status = 'pending'",
      [order.id, charge.id],
    );
    return { orderId: order.id, chargeId: charge.id };
  }
}
// Plus: a reconciler job that finds orders 'pending' > 5 min and asks the PSP
// (by idempotency key) whether a charge exists, then completes or fails them.`,
      },
      explanation: `**Fixes:**
- **Check-then-insert race**: under READ COMMITTED two concurrent requests both saw no row. The \`UNIQUE(cart_id)\` constraint with \`ON CONFLICT DO NOTHING\` makes the database the arbiter; the loser reads the existing order.
- **Replay**: a retry of a paid checkout returns the original order and charge IDs instead of creating anything.
- **PSP idempotency**: the key \`order-<id>\` is stable across retries, so even if our process died after the PSP captured but before we recorded it, the retry's charge call returns the *same* charge rather than a second capture.
- **No transaction across the network call**: previously a connection and row locks were held for 1–8 s per checkout (pool exhaustion under load), and a failed COMMIT after a successful charge lost the record of the charge. Now there are two short transactions around the external call.
- **Conditional state transition** (\`WHERE status = 'pending'\`) makes the completion idempotent when retries race.
- **Reconciliation** closes the remaining gap (crash between charge and complete) — correctness comes from idempotency plus reconciliation, not from hoping nothing crashes.`,
      followUps: [
        {
          "q": "Your reconciler finds an order stuck in 'pending' for 10 minutes. Write out its decision logic.",
          "a": "Look up the charge at the PSP using the idempotency key `order-<id>`. If a charge exists and succeeded, transition the order to `paid` with a conditional UPDATE `WHERE status='pending'`, and emit the order-paid event. If it exists but failed or was declined, mark the order `failed` and release the stock. If there's no charge at all, the request never reached the PSP: either mark it `failed` (the customer retries) or re-drive the charge with the same key, a business decision. Act only on orders older than the maximum PSP latency plus margin, so you never race an in-flight request. Emit metrics for each outcome."
        },
        {
          "q": "How would you load-test this to prove there are no duplicate charges under concurrent double-submits?",
          "a": "Use a fake PSP that records idempotency keys and fails or delays randomly (1–8 s, with some timeouts). Fire bursts where each cart is submitted 2–5 times concurrently, with client retries on timeout, across several app instances against a real Postgres. Kill pods randomly during the run. Afterwards assert: exactly one order per cart, at most one PSP charge per order key, every `paid` order has a charge ID, and no charge exists without an order after the reconciler runs. Run it in CI nightly."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-cc-2',
      title: 'The nightly settlement job that paid merchants twice',
      context:
        'Settlement runs on every pod via @nestjs/schedule at 02:00 and uses a Redis lock so only one pod runs it. Last night the job took 9 minutes (a slow DB), and 40 merchants received two payouts. Redis is a primary/replica pair with async replication.',
      task: 'Make double payouts impossible even if two instances run concurrently, the lock expires mid-run, or Redis fails over. Keep the "only one pod does the work" optimisation if you want, but do not rely on it for correctness.',
      starter: {
        language: 'typescript',
        title: 'settlement.job.ts (starter)',
        code: `import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { Pool } from 'pg';

@Injectable()
export class SettlementJob {
  constructor(private readonly redis: Redis, private readonly pool: Pool, private readonly bank: any) {}

  @Cron('0 2 * * *')
  async run() {
    const got = await this.redis.set('lock:settlement', '1', 'EX', 300, 'NX'); // 5 min
    if (!got) return;
    try {
      const { rows: merchants } = await this.pool.query(
        "SELECT merchant_id, sum(amount_cents) AS total FROM ledger WHERE settled = false GROUP BY merchant_id");
      for (const m of merchants) {
        await this.bank.payout(m.merchant_id, m.total);
        await this.pool.query('UPDATE ledger SET settled = true WHERE merchant_id = $1', [m.merchant_id]);
      }
    } finally {
      await this.redis.del('lock:settlement');   // may delete another pod's lock
    }
  }
}`,
      },
      hints: [
        'What happens at minute 5 of a 9-minute run? And what does the first pod\'s DEL do at minute 9?',
        'Between payout() and the UPDATE, new ledger rows can arrive and the process can crash. Which rows does the UPDATE mark as settled?',
        'Could a unique constraint on (merchant_id, settlement_date) plus a bank idempotency key replace the lock as the correctness mechanism?',
      ],
      solution: {
        language: 'typescript',
        title: 'settlement.job.ts (solution)',
        code: `import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';

// Schema: payouts(id, merchant_id, run_date, amount_cents, status, bank_ref,
//                 UNIQUE (merchant_id, run_date))
//         ledger.payout_id NULL until assigned
@Injectable()
export class SettlementJob {
  constructor(private readonly pool: Pool, private readonly bank: { payout(o: object): Promise<{ ref: string }> }) {}

  @Cron('0 2 * * *')
  async run() {
    const runDate = new Date().toISOString().slice(0, 10);
    // Efficiency only: one pod does the scan. Session advisory lock dies with the connection.
    const lockConn = await this.pool.connect();
    try {
      const { rows } = await lockConn.query("SELECT pg_try_advisory_lock(hashtext('settlement')) AS ok");
      if (!rows[0].ok) return;
      const { rows: merchants } = await this.pool.query(
        'SELECT DISTINCT merchant_id FROM ledger WHERE payout_id IS NULL');
      for (const { merchant_id } of merchants) await this.settle(merchant_id, runDate);
    } finally {
      await lockConn.query("SELECT pg_advisory_unlock(hashtext('settlement'))").catch(() => undefined);
      lockConn.release();
    }
  }

  // Correctness: safe even if two runs execute concurrently or a run is retried
  private async settle(merchantId: string, runDate: string) {
    const c = await this.pool.connect();
    let payout: { id: string; amount_cents: string; status: string };
    try {
      await c.query('BEGIN');
      const ins = await c.query(
        "INSERT INTO payouts (merchant_id, run_date, amount_cents, status) VALUES ($1, $2, 0, 'pending') " +
        'ON CONFLICT (merchant_id, run_date) DO NOTHING RETURNING id', [merchantId, runDate]);
      if (ins.rowCount) {
        // assign exactly the rows being paid, atomically with the payout record
        const sum = await c.query(
          'UPDATE ledger SET payout_id = $2 WHERE merchant_id = $1 AND payout_id IS NULL RETURNING amount_cents',
          [merchantId, ins.rows[0].id]);
        const total = sum.rows.reduce((a, r) => a + Number(r.amount_cents), 0);
        await c.query('UPDATE payouts SET amount_cents = $2 WHERE id = $1', [ins.rows[0].id, total]);
      }
      ({ rows: [payout] } = await c.query(
        'SELECT id, amount_cents, status FROM payouts WHERE merchant_id = $1 AND run_date = $2', [merchantId, runDate]));
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }

    if (payout.status === 'paid' || Number(payout.amount_cents) === 0) return;
    const res = await this.bank.payout({ merchantId, amountCents: Number(payout.amount_cents), idempotencyKey: 'payout-' + payout.id });
    await this.pool.query("UPDATE payouts SET status = 'paid', bank_ref = $2 WHERE id = $1 AND status = 'pending'", [payout.id, res.ref]);
  }
}`,
      },
      explanation: `**What was broken:**
- **Lease expiry**: the 5-minute TTL expired during a 9-minute run; another pod (or a retried cron) acquired the lock and paid the same merchants.
- **Unsafe release**: plain \`DEL\` removed the *other* holder's lock, inviting a third runner.
- **Redis async replication** can lose a lock on failover — the lock was never a correctness guarantee.
- **Mark-after-pay race**: \`UPDATE ledger SET settled = true WHERE merchant_id = …\` also marked rows that arrived *after* the SUM (never paid), and a crash between payout and UPDATE caused re-payment next run.

**The fix:**
- **Correctness comes from the data model**: \`UNIQUE (merchant_id, run_date)\` means at most one payout per merchant per day, and ledger rows are assigned to a specific payout in the same transaction that creates it — exactly those rows, no more.
- **Bank idempotency key** \`payout-<id>\`: a retry after a crash can't pay twice.
- **Conditional status transition** makes completion idempotent.
- The advisory lock (session-scoped, released automatically if the connection dies) is kept purely as an optimisation so pods don't all scan; if two runs overlap, the constraint makes the loser a no-op.`,
      followUps: [
        {
          "q": "The bank payout call takes 2 s and there are 50,000 merchants, so a sequential run takes 28 hours. Make it parallel without losing the guarantees.",
          "a": "Sequentially, 50,000 × 2 s = 100,000 s ≈ 28 h. Fan out with a bounded concurrency of 50 (e.g. `p-limit`), giving about 2,000 s ≈ 33 min, within the bank's rate limit. Correctness is per merchant: the unique `(merchant_id, run_date)` constraint, atomic ledger assignment and the bank idempotency key don't depend on ordering, so parallel workers or even multiple pods are safe. Each `settle()` uses its own short-lived connection, so size the DB pool above the concurrency. Make failures per merchant (log and leave `pending` for the next retry) so one bad account doesn't abort the run."
        },
        {
          "q": "A payout row is 'pending' with the ledger assigned, but the bank call failed permanently (closed account). What should happen to those ledger rows?",
          "a": "Mark the payout `failed` with the reason, then either release the ledger rows (`UPDATE ledger SET payout_id = NULL WHERE payout_id = $id`) in the same transaction so they're picked up again once the merchant fixes their bank details, or keep them linked and move the payout to a `held` state that ops can retry manually. Don't silently re-include them in tomorrow's run without a status change, because tomorrow's payout row is a different `(merchant, run_date)` and the history becomes confusing. Alert the merchant and finance."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'prod-correctness-ops-iq-01',
      difficulty: 'hard',
      question:
        'Your API gateway had a 20-minute incident where it returned 504 after 10 s while backends kept processing. Finance now reports ~2,000 double charges. You are the incident commander. What do you do today, and what do you change so it can never happen again?',
      whatInterviewerLooksFor: [
        'Immediate customer remediation and stopping further damage',
        'Explains timeout ≠ failure and multi-layer retries',
        'Idempotency keys enforced by a unique constraint, propagated to the PSP',
        'Reconciliation as a permanent safety net',
        'Retry policy hygiene at gateway/mesh/client',
      ],
      modelAnswer: `### Today
1. **Stop new damage**: disable client/gateway retries on non-idempotent POSTs via remote config; confirm the gateway is healthy.
2. **Size it**: SQL over payments grouped by (user, amount, cart) within a short window, cross-checked with PSP captures — the PSP is the source of truth for money.
3. **Remediate**: refund duplicates automatically (the refund itself idempotent, keyed by the duplicate charge ID), notify customers, give support a script. Prefer voiding uncaptured authorisations to refunding captures.
4. **Communicate**: status page, finance, support — with counts and ETA.

### Why it happened
A timeout only means *the caller stopped waiting*. The backend completed the charge at 12 s; the client saw 504 and retried; the retry was a brand-new request. Possibly retries at several layers (SDK × gateway × mesh = up to 27 attempts in the worst case).

### Permanent fix
- **Idempotency-Key** on every side-effecting endpoint, generated by the client once per logical operation and reused on retries. Server-side: insert the key under a **UNIQUE** constraint before doing work, store request hash + response, replay on duplicate, 409 while in progress, 422 if the body differs. TTL ≥ retry window (24 h).
- **Forward the key to the PSP** (Stripe, Adyen, Braintree support this) so a retry after our crash still yields one capture.
- **Natural-key constraints** as defence in depth (one order per cart).
- **Reconciliation job**: compare our payments with PSP settlement files daily and alert on mismatches.
- **Retry policy**: retries only at one layer, only for idempotent requests or ones with keys, with budgets (≤ 10% extra traffic) and jittered backoff; timeouts decreasing along the call chain so inner calls give up before outer ones.`,
      followUps: [
        {
          q: 'Where do you store idempotency keys at 5k payments/s?',
          a: 'In the same database as the payment write so the key and the effect commit atomically — a table partitioned by day with a 24–48 h TTL via partition drops. Redis alone is not enough: a failover or eviction can forget a key and allow a duplicate.',
        },
        {
          q: 'What if the client does not send a key (legacy clients)?',
          a: 'Derive one from a natural key (cart ID, invoice ID) and enforce it with a unique constraint, or fingerprint (user, amount, merchant, 60 s window) as a soft guard that flags rather than blocks. Make keys mandatory for new API versions.',
        },
        {
          q: 'The first request is still in progress when the retry arrives. What do you return?',
          a: '409 Conflict (or 425/429 with Retry-After), telling the client to retry later. Do not run the operation again, and do not block the retry indefinitely waiting on the first one.',
        },
      ],
      pitfalls: [
        'Checking for duplicates with a SELECT before INSERT without a unique constraint.',
        'Keeping keys only in Redis with eviction enabled.',
        'Forgetting that the PSP call itself must be idempotent.',
        'Jumping to the fix without remediating affected customers.',
      ],
    },
    {
      id: 'prod-correctness-ops-iq-02',
      difficulty: 'hard',
      question:
        'A flash sale for 500 units sold 812. The code "checks stock then decrements" and runs on 40 pods. Walk me through the root cause and three ways to fix it, with trade-offs at 20k checkout attempts per second.',
      whatInterviewerLooksFor: [
        'Identifies read-modify-write race under READ COMMITTED',
        'Offers atomic conditional update, pessimistic lock, reservation via Redis/queue',
        'Reasons about hot-row contention at 20k/s',
        'Addresses the oversold customers (compensation)',
      ],
      modelAnswer: `### Root cause
Each request did \`SELECT stock\` → check in code → \`UPDATE SET stock = :computed\`. Under Postgres READ COMMITTED, concurrent requests read the same value and overwrite each other — lost updates. 40 pods make the window huge; in-process mutexes can't help across pods.

### Options

**1. Atomic conditional update** — \`UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock >= 1\`, check \`rowCount\`. Correct and simple. But at 20k attempts/s on **one row**, every update serialises on that row's lock: Postgres manages maybe a few thousand single-row updates/s on one hot row, latency climbs, pools exhaust.

**2. Pre-sharded inventory** — split 500 units into 50 bucket rows of 10; each request picks a random bucket and does the conditional update (retry another bucket on 0 rows). Contention drops ~50×; still strongly consistent in the DB.

**3. Redis gate + async order** — \`DECR\` (or a Lua script that checks and decrements) in Redis is atomic, ~100k ops/s on one key; winners get a reservation token and proceed to create the order in the DB asynchronously; losers are rejected instantly. Risks: Redis failover losing decrements (use AOF + replication, and reconcile with the DB), reservations that are never paid must be released (TTL).

**4. Queue-based sequencing** — requests enqueue into a partition per SKU; a single consumer allocates units in order. Perfectly fair and correct, higher latency (users wait for a result).

### Also
- Add \`CHECK (stock >= 0)\` so the DB rejects negative stock as a last line of defence.
- For the 312 oversold customers: prioritise by order time, offer refund + voucher or backorder — business decision, with engineering providing the exact list.
- Load test the fix at 2× expected concurrency.`,
      followUps: [
        {
          q: 'Why not SERIALIZABLE isolation?',
          a: 'It would detect the anomaly and abort conflicting transactions (40001), so it is correct, but under 20k/s contention on one row most transactions would abort and retry — throughput collapses. Conditional updates express the invariant directly with far less overhead.',
        },
        {
          q: 'How do you release reservations for users who abandon payment?',
          a: 'Reservation rows/keys carry an expiry (e.g. 10 min); a sweeper (or the conditional update itself treating expired holds as free) returns units to stock. Make release idempotent, keyed by reservation ID.',
        },
      ],
      pitfalls: [
        'Proposing a JavaScript mutex or a lock in one pod.',
        'Saying "use transactions" without explaining that READ COMMITTED still allows the lost update.',
        'Ignoring hot-row contention at the stated throughput.',
      ],
    },
    {
      id: 'prod-correctness-ops-iq-03',
      difficulty: 'expert',
      question:
        'It is 03:10. The primary region is impaired: 60% of requests to payments fail, the provider says "investigating". You have a warm standby in another region with async replication. Do you fail over? Walk me through the decision and the execution.',
      whatInterviewerLooksFor: [
        'Uses pre-agreed criteria and time-boxes the decision',
        'Quantifies RPO from replication lag and its business impact',
        'Fences the old primary to avoid split-brain',
        'Knows DNS/LB mechanics and control-plane dependencies',
        'Plans reconciliation of lost writes and fail-back',
      ],
      modelAnswer: `### Decide (time-boxed, ~10–15 min)
- **Criteria** from the runbook: critical-path error rate > X% for > 15 min, provider ETA unknown → fail over. Waiting is also a decision with a cost (60% payment failures per minute).
- **Cost of failing over**: async replication means data loss = replication lag at failure. Check the standby: \`now() - pg_last_xact_replay_timestamp()\` — say 4 s. At 300 payments/s that's up to ~1,200 payments that the standby doesn't know about. They are not lost forever — they're in the old primary — but they'll need reconciliation. PSP records let us reconstruct them.
- **Partial impairment trap**: the old region still processes 40% of requests. If both regions accept writes → **split-brain**. So fencing is mandatory.

### Execute
1. **Fence** region A writers: flip the write-region flag, scale A's writers to zero if reachable; revoke A's DB credentials if needed.
2. **Promote** the standby (\`pg_promote()\`), verify it's writable.
3. **Scale** region B to full capacity (warm standby at ~30%) — pre-approved quotas, pre-pulled images.
4. **Shift traffic**: health-checked DNS / global LB weights to B; TTLs pre-set to 60 s. Avoid depending on the impaired region's control plane (data-plane routing controls).
5. **Verify**: synthetic payment, error rates, PSP callbacks (webhook URLs pointing to B?), third-party IP allowlists include B's egress IPs.

### After
- **Reconcile** A's unreplicated writes once A is reachable: diff by ID/time window, replay idempotently (idempotency keys make replay safe), or reconcile against PSP settlement.
- **Fail back** deliberately later: rebuild A as a replica of B, then switch in a calm window.
- Postmortem: was the RPO acceptable? Maybe payments need synchronous/consensus replication (higher write latency) while other domains stay async.`,
      followUps: [
        {
          q: 'How would you get RPO to zero for payments?',
          a: 'Synchronous replication to another region (write latency +RTT, e.g. +60–80 ms across US regions) or a consensus database (Spanner/CockroachDB) with a quorum spanning regions. Or reduce the problem: make the PSP the source of truth and rebuild local state from its ledger.',
        },
        {
          q: 'DNS TTL is 60 s but some clients keep hitting region A for 30 minutes. Why?',
          a: 'Clients and resolvers ignore TTLs, the JVM or mobile clients cache DNS, and long-lived keep-alive connections never re-resolve. Anycast/global accelerator IPs avoid DNS for failover; servers in A should actively reject or redirect once fenced.',
        },
      ],
      pitfalls: [
        'Failing over without fencing the old primary.',
        'Assuming async replication means zero data loss.',
        'Never having rehearsed, discovering missing allowlists and secrets in B.',
      ],
    },
    {
      id: 'prod-correctness-ops-iq-04',
      difficulty: 'hard',
      question:
        'Twenty minutes ago an engineer ran a migration that deleted 3.2 million rows from `order_items` in production. The database has two streaming replicas and nightly snapshots. Orders keep coming in. What do you do?',
      whatInterviewerLooksFor: [
        'Knows replicas already contain the deletion',
        'Uses PITR to a new instance rather than rolling back the whole DB',
        'Surgical restore preserving writes made after the incident',
        'Handles application behaviour during recovery (read-only, feature flags)',
        'Prevention: guardrails, delayed replica, drills',
      ],
      modelAnswer: `### Stop and contain
- Make sure the job isn't still running; revoke the credentials it used if needed.
- Decide on user impact: order pages missing items — put order-history views into a degraded mode ("details temporarily unavailable") rather than showing wrong data; keep checkout running if it doesn't depend on the deleted rows.
- Snapshot the current state (evidence, and a safe point to return to).

### Why not the obvious moves
- **Replicas** replayed the DELETE within milliseconds — useless here (unless we had a delayed replica).
- **Nightly snapshot**: restoring it over prod would throw away up to 24 h of legitimate orders.
- **PITR of the whole DB** to 10:41:59 also discards 20 minutes of new orders.

### Surgical recovery
1. Restore a **PITR copy to a new instance** at the timestamp just before the DELETE (from WAL/binlog or audit logs). With WAL-G/pgBackRest or RDS PITR this takes roughly base-restore time + WAL replay — for a 1 TB DB maybe 1–2 h; start it immediately.
2. Attach it (postgres_fdw or dump the affected table), **dry-run** a diff: rows present in the restore but missing in prod.
3. **Insert only missing rows** (\`ON CONFLICT DO NOTHING\`), in batches, verifying counts; check dependent tables and derived data (search index, caches, analytics) and re-sync them.
4. Validate with the product team on sample orders; announce resolution.

### Prevention
- Migration guardrails: reviewed, run in a transaction with an expected-row-count assertion, \`statement_timeout\`, dry-run on a prod-size copy.
- A **delayed replica** (\`recovery_min_apply_delay = '1h'\`) for fast recovery of exactly this failure.
- Soft deletes for user data; least-privilege roles (the app role can't \`DELETE\` in bulk).
- Quarterly restore drills to know the real RTO.`,
      followUps: [
        {
          q: 'How would a delayed replica change the timeline?',
          a: 'You pause its replay (pg_wal_replay_pause), advance it to just before the DELETE with a recovery target, and copy rows from it within minutes instead of waiting hours for a base backup restore.',
        },
        {
          q: 'What else might be corrupted besides the table?',
          a: 'Derived systems: CDC consumers may have propagated deletions to the search index, caches, the data warehouse, and downstream services via events. Each needs re-sync from the restored source of truth.',
        },
      ],
      pitfalls: [
        'Failing over to a replica.',
        'Restoring last night\'s snapshot over production.',
        'Forgetting downstream systems that consumed the deletes.',
      ],
    },
    {
      id: 'prod-correctness-ops-iq-05',
      difficulty: 'expert',
      question:
        'At 14:05 checkout p99 jumped from 400 ms to 2.2 s. No deploys. Every team says their service dashboard is green. The call path crosses 11 services and a Kafka hop. How do you find where the time goes — today and in general?',
      whatInterviewerLooksFor: [
        'Compares client-side vs server-side latency per hop',
        'Considers queueing and retries not visible in server metrics',
        'Knows how to roll out OpenTelemetry with context propagation incl. Kafka',
        'Tail-based sampling and exemplars',
        'Methodical scoping (endpoint, tenant, AZ)',
      ],
      modelAnswer: `### Today, with what exists
- **Scope**: which checkout step regressed (per-route p99), all tenants or one, all AZs or one? A regression starting at an exact minute suggests a change: flag, job, dependency deploy, traffic mix.
- **"Green dashboards" usually means each team measures server-side time *inside their handler***. Time spent **before the handler** — waiting for a DB/HTTP pool connection, event-loop lag, retries in the caller's client library, DNS/TLS setup, Kafka consumer lag — shows up only in the *caller's* client-side latency. So I list, for each hop, *caller-observed* latency vs *callee-reported* latency. The hop with the gap is the culprit (queueing, network, retries).
- Check retry counters: a dependency failing fast and being retried with 500 ms backoff quietly adds a second.
- Kafka hop: consumer lag × processing rate = delay added; a rebalance at 14:05 would do exactly this.

### In general: distributed tracing
- **OpenTelemetry** SDK with auto-instrumentation (HTTP, gRPC, pg, ioredis, kafkajs), plus manual spans for business steps.
- **W3C traceparent** propagated over HTTP/gRPC and injected into **Kafka headers** so consumers continue the trace (span links for batch consumers).
- **Tail-based sampling** in the collector: keep 100% of errors and traces > 1 s, ~5% of the rest; head sampling at 1% would likely drop exactly the slow requests we care about.
- **Exemplars** on latency histograms: click the p99 bucket → a real trace.
- trace_id in every log line; service map from traces shows fan-out and N+1 (40 sibling spans to the same service).

### What I'd expect to find
Frequently: a connection-pool queue in one service (its DB got slower or its pool is too small after a scale-up elsewhere), a retry storm to a flaky dependency, or a sequential fan-out that grew with data (a cart with 60 items now makes 60 calls).`,
      followUps: [
        {
          q: 'Tracing overhead is a concern for the platform team. What do you tell them?',
          a: 'SDK span creation costs microseconds; export is batched and async. Cost is mostly storage — controlled by tail sampling at the collector and span attribute limits. Typical overhead is low single-digit percent CPU; measure with a load test.',
        },
        {
          q: 'A trace shows a 900 ms gap between the parent span ending its child call and the child span starting. What is it?',
          a: 'Time between the client starting the request and the server starting the handler: client-side pool wait, DNS/TCP/TLS connect, a proxy or sidecar queue, or server-side queueing before instrumentation (event-loop lag, accept backlog). Add pool-wait spans and check sidecar metrics.',
        },
      ],
      pitfalls: [
        'Trusting server-side handler timings as the whole story.',
        'Losing trace context across Kafka.',
        'Relying on 1% head sampling for tail-latency debugging.',
      ],
    },
    {
      id: 'prod-correctness-ops-iq-06',
      difficulty: 'hard',
      question:
        'Merchants complain: products they deleted hours ago still appear in search, and products created today can\'t be found. Search is Elasticsearch fed from Postgres. Diagnose and fix — then redesign the pipeline so this can\'t silently happen again.',
      whatInterviewerLooksFor: [
        'Measures indexing lag and checks pipeline components',
        'Knows poison messages, mapping rejections, refresh settings',
        'Handles ordering with external versioning',
        'Proposes CDC/outbox over dual writes, DLQ, reindex with aliases',
      ],
      modelAnswer: `### Diagnose
1. **Measure staleness**: compare \`max(updated_at)\` of indexed docs with Postgres; Kafka consumer lag of the indexer group; the CDC connector status (\`/connectors/<name>/status\` — FAILED after a schema change is common).
2. **Is it all documents or a subset?** A subset suggests **rejected documents** (mapping conflict: a field that was a number now arrives as a string → the bulk item fails with a 400, and a naive indexer logs and moves on) or one stuck partition.
3. **Poison message**: one Kafka partition's lag growing while others are zero → the indexer retries one bad message forever and blocks that partition.
4. **Refresh interval**: someone set \`refresh_interval: -1\` for a bulk load and didn't revert — docs are indexed but not searchable.
5. **Deletes specifically**: dual-write code path for deletes missing, or soft deletes not mapped to ES deletes.

### Fix now
Repair and restart the connector (from its stored offset), DLQ the poison message, restore refresh_interval, reindex the affected time range from Postgres.

### Redesign
- **Transactional outbox or CDC** (Debezium) as the only path into search: no app dual writes that can fail silently.
- **Idempotent upserts with external versioning** (\`version_type=external\`, version = row's updated counter or LSN) so out-of-order or replayed events can't overwrite newer data; deletes as tombstones.
- **DLQ** for rejected docs + alert on DLQ size; schema contract between DB and index mapping (strict mappings).
- **Indexing lag SLO** (e.g. p99 < 5 s) with an end-to-end canary: write a probe row every minute, alert if it's not searchable within the SLO.
- **Full rebuild ability**: reindex into a new index and swap the alias atomically; periodic reconciliation (count + checksum per partition) between DB and index.`,
      followUps: [
        {
          q: 'Why is external versioning important here?',
          a: 'Events can be replayed or reordered (rebalance, retries, reindex running alongside live updates). With external versions ES rejects a write whose version is not higher than the stored one, so an old update can never overwrite a newer state.',
        },
        {
          q: 'Search latency doubled after adding a "contains" search feature. Likely cause?',
          a: 'Leading-wildcard or regexp queries (*term*) which scan the term dictionary. Use n-gram or wildcard field types at index time, or search_as_you_type, rather than query-time wildcards.',
        },
      ],
      pitfalls: [
        'Restarting the indexer without finding why it stopped.',
        'Proposing app-level dual writes as the fix.',
        'Ignoring ordering when replaying events.',
      ],
    },
    {
      id: 'prod-correctness-ops-iq-07',
      difficulty: 'medium',
      question:
        'Since we added a nightly reconciliation job, the API logs 200–300 "deadlock detected" errors between 01:00 and 01:30, all on the `accounts` table. Explain what is happening and how you fix it without cancelling the job.',
      whatInterviewerLooksFor: [
        'Explains lock-ordering deadlocks with a concrete interleaving',
        'Knows DB resolves deadlocks by aborting a victim and retry is safe',
        'Fixes ordering, batch size, transaction length',
        'Knows how to get the deadlock details from logs',
      ],
      modelAnswer: `### What's happening
Deadlocks need two transactions acquiring the same locks in different orders. Likely:
- The **job** updates accounts in large transactions in some order (e.g. by \`last_activity\` or heap order), holding locks on hundreds of rows until commit.
- **API transfers** lock two accounts — debit A then credit B.
- Interleaving: job holds B, wants A; transfer holds A, wants B → cycle. Postgres waits \`deadlock_timeout\` (1 s), detects it, aborts one (SQLSTATE 40P01). The victim is fully rolled back — the user sees an error (and ~1 s extra latency on waits even when no deadlock occurs).

### Confirm
Postgres logs both statements and PIDs for every deadlock; \`log_lock_waits = on\` shows waits beyond 1 s. \`pg_stat_database.deadlocks\` gives the rate.

### Fix
1. **Consistent lock order**: API transfers lock both accounts sorted by ID (\`SELECT … WHERE id = ANY($1) ORDER BY id FOR UPDATE\`); the job processes accounts ordered by ID too.
2. **Small batches**: job commits every 500–1,000 rows so it holds few locks for milliseconds, not the whole batch for minutes.
3. **\`SKIP LOCKED\`** in the job: skip rows the API is currently touching and pick them up in the next pass.
4. **Retry** on 40P01/40001 in the API with jitter (max 3 attempts) — safe because the victim was rolled back.
5. Keep network calls out of both transactions.
6. Optionally \`lock_timeout\` in the job so it gives up rather than queueing behind API traffic.`,
      followUps: [
        {
          q: 'Would increasing deadlock_timeout help?',
          a: 'No — it only delays detection (lock waits last longer before the check). It is a detection cost trade-off, not a fix. Lower values detect faster at a slight CPU cost.',
        },
        {
          q: 'Could the same happen with MySQL even when rows are updated in the same order?',
          a: 'Yes: under REPEATABLE READ InnoDB takes gap and next-key locks for range scans and inserts, which can deadlock between inserts into the same gap. READ COMMITTED largely eliminates gap locking.',
        },
      ],
      pitfalls: [
        'Saying Postgres hangs forever on deadlocks.',
        'Proposing a global application mutex.',
        'Only adding retries without fixing the ordering.',
      ],
    },
    {
      id: 'prod-correctness-ops-iq-08',
      difficulty: 'expert',
      question:
        'We run a wallet app in 3 AZs of one region and want to go multi-region for resilience and latency in EU and India. Which operations need strong consistency, which can be eventual, and what architecture do you propose?',
      whatInterviewerLooksFor: [
        'Classifies operations by invariant',
        'Chooses per-domain replication (home region, consensus) rather than one global answer',
        'Considers regulatory residency and latency numbers',
        'Explains failover semantics and RPO per domain',
      ],
      modelAnswer: `### Classify operations
- **Strong (linearizable per wallet)**: balance debit/transfer, withdrawal, idempotency records, KYC status changes that gate money movement. Invariant: never spend money twice, never go below zero.
- **Session consistency**: "my last transaction appears in my history immediately" — read-your-writes for the actor.
- **Bounded staleness**: fraud-rule configs, FX rates (seconds), notification preferences.
- **Eventual**: transaction history for other devices, analytics, rewards points display, search, marketing.

### Architecture
- **Home-region per user** (geo-partitioning): an Indian user's wallet lives in ap-south-1, an EU user's in eu-west-1 — also satisfies data-residency rules (RBI data localisation for payments data in India, GDPR in EU). The wallet ledger is single-leader in the home region with **synchronous replication across 3 AZs** (RPO 0 for AZ loss).
- **Cross-region**: async replication of each region's data to a DR region for disaster recovery (RPO seconds), or a consensus DB spanning nearby regions if RPO 0 on region loss is mandated (write latency +RTT, ~20–40 ms within Europe).
- **Transfers between users in different home regions**: a saga — debit in region A (local transaction), durable event, credit in region B, with compensation and idempotency keys; never a distributed 2PC over the WAN on the hot path.
- **Routing**: the edge resolves user → home region (token claim), sends writes there; reads of eventual data served locally.

### Failure semantics
- AZ loss: transparent (sync standby).
- Region loss: that region's users fail over to DR with RPO = replication lag, or stay read-only until recovery if the business prefers zero data loss over availability — an explicit CAP choice per region.

### Numbers
Mumbai ↔ Frankfurt ≈ 110–130 ms RTT; synchronous cross-region writes on every payment would add that to p50 — acceptable for some flows, not for tap-to-pay.`,
      followUps: [
        {
          q: 'Why not active-active with last-writer-wins for balances?',
          a: 'LWW loses concurrent updates — two debits in two regions could both succeed against the same balance and one silently overwrites the other. Balances need a single writer per wallet or consensus; CRDT counters can model increments but cannot enforce a non-negative balance without coordination.',
        },
        {
          q: 'How do you move a user who relocates from India to the EU?',
          a: 'A controlled migration: freeze writes for that wallet briefly (or dual-home with a fenced handover), copy the ledger, flip the directory entry for the user\'s home region, unfreeze. Regulations may forbid moving some data at all.',
        },
      ],
      pitfalls: [
        'One consistency model for the whole system.',
        'Multi-master with LWW for money.',
        'Ignoring data-residency regulations.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'prod-correctness-ops-boe-1',
      question:
        'Postmortem: for 20 minutes the PSP\'s p99 rose to 5 s while our payment client had a 2 s timeout and retried once, WITHOUT forwarding the idempotency key. Checkout ran at 400 payments/s. Estimate how many customers were double-charged, the money to refund, and how long the refund backfill takes.',
      assumptions: [
        '8% of PSP calls exceeded 2 s during the incident; the PSP kept processing them after our client gave up',
        '90% of those timed-out originals were eventually captured; each retry was a brand-new charge, captured 97% of the time',
        'Average ticket $60',
        'PSP refund API limit: 100 requests/s; about 2% of affected customers file a card dispute before the refund lands (~$15 fee each)',
      ],
      steps: [
        { label: 'Payment attempts in the window', calc: '400/s × 1,200 s = 480,000' },
        { label: 'Timed out on our side', calc: '480,000 × 8% = 38,400' },
        { label: 'Originals captured anyway', calc: '38,400 × 90% = 34,560' },
        { label: 'Retries also captured → double charges', calc: '34,560 × 97% ≈ 33,500 customers' },
        { label: 'Money to refund', calc: '33,500 × $60 ≈ $2.0M' },
        { label: 'Refund backfill time', calc: '33,500 ÷ 100 req/s ≈ 335 s ≈ 6 min (after detection: orders with more than one captured charge in the PSP report)' },
        { label: 'Dispute exposure', calc: '33,500 × 2% ≈ 670 disputes × $15 ≈ $10K in fees, plus support load' },
      ],
      answer:
        'Roughly 33,500 double-charged customers and about $2M to refund. The refund API calls take only ~6 minutes; finding the duplicates (reconciling orders against PSP captures) and handling ~670 disputes (~$10K in fees) is the real cost.',
      insight:
        'A client timeout below the dependency\'s p99, combined with a retry that is not idempotent, turns a latency incident into a correctness incident: 7% of all payments in the window were charged twice. Fixes, in order: forward the same idempotency key to the PSP on every retry, set the timeout above the PSP p99 (or look up the charge status by key before retrying), and alert on "more than one capture per order" from reconciliation so detection takes minutes, not a day.',
      followUps: [
        {
          "q": "Same failure, but it lasted 2 hours and was only detected by next morning's reconciliation. Redo the estimate.",
          "a": "Attempts: 400 × 7,200 = 2.88M. Timed out: 8% = 230,400. Originals captured: 90% = 207,360. Retries also captured: 97% ≈ 201,000 double-charged customers, about 201,000 × $60 ≈ $12M. The refund API run is 201,000 ÷ 100/s ≈ 2,011 s ≈ 34 min, which is still not the bottleneck. With a day of delay, the dispute rate rises well above 2% and the support queue explodes. The lesson: detection time multiplies the damage linearly, so near-real-time reconciliation (alert when an order has more than one capture) matters as much as the fix."
        },
        {
          "q": "You forward the idempotency key but keep the 2 s timeout. What's the user-facing impact now, and what else would you change?",
          "a": "No double charges. The retry returns the original charge, or a \"still processing\" response. But 8% of payments (38,400 in 20 min) still hit the timeout, and if the retry also times out the user sees an error even though they will be charged. That makes for confusing support cases. Also return a \"pending\" state after the deadline rather than failing, and let an async status poll or webhook confirm the payment. Raise the client timeout toward the PSP's p99 during normal operation, and make the checkout UI show \"processing\" instead of \"failed\" for unknown outcomes."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-boe-2',
      question:
        'After moving profile reads to async Postgres replicas, support gets "my change did not save" tickets. There are 1.5M profile writes per day and 40% are followed by a read from the same user about 300 ms later. Estimate how many stale reads users see per day, and what a 5-second read-from-primary pin after each write costs.',
      assumptions: [
        'Outside the nightly batch, replica lag exceeds 300 ms about 2% of the time',
        'A nightly batch runs for 1 hour and holds replica lag around 3 s; 4% of the day\'s profile writes land in that hour',
        '60M profile reads per day in total; peak traffic is about 3× the daily average',
        'After a write, the same user makes about 3 reads in the next 5 s (redirect, avatar, settings panel)',
        '~1% of users who see stale data open a ticket',
      ],
      steps: [
        { label: 'Read-after-write events', calc: '1.5M writes × 40% = 600,000 reads/day that arrive ~300 ms after the user\'s own write' },
        { label: 'Stale during the batch hour', calc: '600,000 × 4% = 24,000; lag 3 s > 300 ms, so all 24,000 are stale' },
        { label: 'Stale the rest of the day', calc: '600,000 × 96% × 2% = 11,520' },
        { label: 'Total stale reads', calc: '24,000 + 11,520 = 35,520/day ≈ 5.9% of read-after-write events; batch hour = 24,000 ÷ 35,520 ≈ 68%' },
        { label: 'Tickets', calc: '35,520 × 1% ≈ 355 tickets/day' },
        { label: 'Cost of a 5 s primary pin', calc: '1.5M writes × 3 reads = 4.5M reads/day on the primary = 4.5M ÷ 60M = 7.5% of reads; 4.5M ÷ 86,400 ≈ 52 reads/s average, ×3 ≈ 156 reads/s at peak' },
        { label: 'Does the pin cover the batch?', calc: 'pin 5 s > batch lag 3 s → every read in the pin window is fresh; reads after 5 s see a replica at most 3 s behind, which is already past the write' },
      ],
      answer:
        'About 35,500 stale reads a day (~6% of read-after-write events, ~355 tickets), and two thirds of them come from the one batch hour. A 5 s primary pin removes them all for ~4.5M extra primary reads a day (7.5% of reads, ~150 reads/s at peak).',
      insight:
        'Read-your-writes bugs are driven by the lag tail, not the average: a p98 lag of 300 ms looks healthy, yet one hour of 3 s lag causes most of the damage. A session pin (or waiting for the replica to replay the write\'s LSN) costs a few percent of reads on the primary, far cheaper than the tickets. Also throttle the batch job, and alert on lag above the pin window, because once lag exceeds 5 s the pin stops protecting users.',
      followUps: [
        {
          "q": "Traffic grows 10×: 15M writes/day with the same 3 reads in the next 5 s. Can the primary still absorb the 5 s pin?",
          "a": "Pinned reads become 15M × 3 = 45M/day, i.e. 45M ÷ 86,400 ≈ 521 reads/s on average and about 1,560 reads/s at 3× peak. Total reads also scale to 600M/day, so it's still 7.5% of reads. Whether the primary copes depends on its headroom alongside 10× writes. If it doesn't, switch from a time-based pin to LSN-based routing: after a write, return the commit LSN to the client (cookie or header), and route reads to any replica whose `pg_last_wal_replay_lsn()` is at or past it, falling back to the primary only if none is."
        },
        {
          "q": "The nightly batch now pushes lag to 8 s, longer than the 5 s pin. What happens, and how do you fix it without lengthening the pin forever?",
          "a": "Reads in the 5–8 s window after a write go to a replica that hasn't replayed the write yet, so stale reads reappear only during the batch hour. Longer pins push more load onto the primary. Better fixes: throttle the batch job (smaller transactions, sleep between chunks) to keep lag bounded; route batch reads and writes away from the replicas users read from; or use the LSN-aware routing that checks the replica's actual replay position rather than assuming a time bound. Alert when replica lag exceeds the pin window."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-boe-3',
      question:
        'Your core Postgres is 4 TB with async cross-region replication (p99 lag 800 ms) and nightly base backups plus WAL archiving. Estimate the RPO for a region loss and the RTO for a full PITR restore after data corruption. Does it meet RPO 1 s / RTO 1 h?',
      assumptions: [
        'Write rate 3,000 transactions/s at peak',
        'Restore throughput from object storage ≈ 400 MB/s',
        'WAL generated ≈ 25 GB/hour; corruption discovered 18 h after the last base backup',
        'WAL replay speed ≈ 100 MB/s',
      ],
      steps: [
        { label: 'Region-loss RPO', calc: 'p99 lag 0.8 s → up to 0.8 s × 3,000 tx/s ≈ 2,400 transactions not yet replicated' },
        { label: 'Base backup restore', calc: '4 TB ÷ 400 MB/s = 4,000,000 MB ÷ 400 ≈ 10,000 s ≈ 2.8 h' },
        { label: 'WAL to replay', calc: '18 h × 25 GB = 450 GB ÷ 100 MB/s ≈ 4,500 s ≈ 1.25 h' },
        { label: 'Total PITR RTO', calc: '2.8 h + 1.25 h + checks/cutover ~0.5 h ≈ 4.5 h' },
        { label: 'With a 1 h delayed replica', calc: 'pause replay, advance to target, copy rows ≈ 10–30 min' },
      ],
      answer:
        'RPO on region loss is about 0.8 s (~2,400 transactions), which just meets 1 s at p99 but breaks during lag spikes. A full PITR takes about 4.5 hours, far beyond RTO 1 h.',
      insight:
        'Backups set a floor on RTO, and it scales with database size. To hit a 1 h RTO for logical corruption you need a delayed replica, more frequent base backups/snapshots, or a smaller blast radius (sharding). For region loss you need a warm standby that is already running. Measure these numbers in drills.',
      followUps: [
        {
          "q": "You take base backups every 6 hours instead of nightly. What does the worst-case PITR RTO become, and what does that tell you?",
          "a": "WAL to replay is at most 6 h × 25 GB = 150 GB ÷ 100 MB/s = 1,500 s ≈ 25 min. But the base restore is still 4 TB ÷ 400 MB/s ≈ 2.8 h. Total ≈ 2.8 + 0.4 + 0.5 ≈ 3.7 h, down from 4.5 h but nowhere near 1 h. The base copy dominates, so more frequent backups barely help. You need something that avoids copying 4 TB: storage snapshots that restore lazily (EBS/RDS snapshots are usable in minutes, warming in the background), or a delayed replica."
        },
        {
          "q": "The database grows to 16 TB in two years. What happens to RTO, and how should the architecture change?",
          "a": "The base restore alone becomes 16 TB ÷ 400 MB/s = 40,000 s ≈ 11 h, so a full restore takes half a day, and drills become painful enough that teams stop running them. Shrink the blast radius: shard by tenant or region so each shard is 1–2 TB and restores in parallel, archive cold data (old orders) into a separate store, and rely on lazy-loading snapshots plus delayed replicas for logical corruption. Track \"measured restore time\" as an SLO from quarterly drills, so growth trips an alert before it trips an incident."
        }
      ],
    },
  ],
  test: [
    {
      id: 'prod-correctness-ops-mcq-01',
      difficulty: 'hard',
      question:
        'Two identical POST /orders requests with the same Idempotency-Key arrive 50 ms apart on different pods. The first is still calling the PSP. With the code below, what does the second request get?',
      code: {
        language: 'typescript',
        code: `const claim = await db.query(
  'INSERT INTO idempotency_keys (key, request_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
  [key, hash]);
if (claim.rowCount === 0) {
  const row = await getKey(key);
  if (row.request_hash !== hash) throw new UnprocessableEntity();
  if (row.status !== 'completed') throw new Conflict('in progress');
  return row.response_body;
}
// ... call PSP, then mark completed with response`,
      },
      options: [
        'A second PSP charge, because the first request has not committed its response yet.',
        'The stored response body, which is null until completion.',
        '409 Conflict ("in progress"), so the client should retry later and then receives the stored response.',
        '422, because the request hash of an in-progress key is not yet written.',
      ],
      correct: [2],
      explanation:
        'The INSERT is autocommitted, so the key row exists immediately with status "started". The second request hits ON CONFLICT (rowCount 0), finds the same hash, sees the status is not completed and returns 409, and a later retry replays the stored response. No second charge happens because the claim is committed before the PSP call. The hash is written in the claim itself, so 422 would be returned only for a different body.',
      followUps: [
        {
          "q": "The first pod crashes right after the PSP call succeeds, before it marks the key completed. What do retries see forever, and how do you unstick it?",
          "a": "The key row is stuck at \"started\", so every retry gets 409 indefinitely while the customer has actually been charged. Add a lease: store `locked_until = now() + 30s` on claim. A retry that finds an expired lease may take over the key (with a conditional UPDATE on the old lease value) and re-run the operation. That's safe because the PSP call reuses the same idempotency key and returns the original charge. A sweeper also resolves stale \"started\" keys by querying the PSP, so the customer isn't stuck waiting for a retry."
        },
        {
          "q": "The client reuses the same Idempotency-Key but sends a different amount. What should the server do and why?",
          "a": "Return 422 (or 409 with a clear error) and do nothing. The stored request hash, e.g. SHA-256 of the canonicalised method, path and body, doesn't match, which means the client has a bug: it is reusing a key for a different logical operation. Silently replaying the old response would hide that, and executing the new request would break the guarantee that one key means one operation. Canonicalise the body before hashing (sorted JSON keys, ignore volatile fields like client timestamps) so harmless reformatting doesn't trigger false mismatches."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-02',
      difficulty: 'expert',
      question:
        'Under Postgres READ COMMITTED, 100 concurrent calls of this function start with balance = 1000. Each call adds 10. What is the final balance most likely to be?',
      code: {
        language: 'typescript',
        code: `async function credit(id: string, amt: number) {
  await db.query('BEGIN');
  const { rows } = await db.query('SELECT balance FROM wallets WHERE id = $1', [id]);
  await db.query('UPDATE wallets SET balance = $2 WHERE id = $1', [id, rows[0].balance + amt]);
  await db.query('COMMIT');
}`,
      },
      options: [
        'Exactly 2000, because each UPDATE takes a row lock and transactions serialise.',
        'Somewhere between 1010 and 2000, because concurrent transactions read the same balance and overwrite each other (lost updates).',
        'Exactly 2000, but only if a single DB connection is used; otherwise the query fails with a serialization error.',
        'The transactions deadlock and all but one abort with 40P01.',
      ],
      correct: [1],
      explanation:
        'The SELECT takes no lock, so many transactions read 1000 (or another stale value) and each writes its own computed absolute value. The row lock on UPDATE only orders the writes, so later ones overwrite earlier ones: a classic lost update. READ COMMITTED does not raise serialization errors (REPEATABLE READ would raise 40001 on the concurrent update). A single row with one lock cannot form a deadlock cycle. The fix is `SET balance = balance + $2` or `SELECT ... FOR UPDATE`.',
      followUps: [
        {
          "q": "You change it to `UPDATE … SET balance = balance + $2`. Now 5,000 concurrent credits per second hit the same merchant account row. What breaks next?",
          "a": "Correctness is fixed, but every transaction now queues for the same row lock, so throughput is capped at 1 ÷ (lock hold time). With a 2 ms commit that's about 500 updates/s, and p99 explodes. Fixes: append-only ledger rows (INSERT per credit, no contention) with the balance derived by periodic aggregation; or split the hot account into N sub-balance rows (pick one at random) and sum them on read; or batch credits in the application and apply one UPDATE every 100 ms. Debits that need a no-overdraft check are harder: keep those on a single row or reserve funds per shard."
        },
        {
          "q": "How would you write a test that reliably reproduces the lost update before the fix?",
          "a": "Run against a real Postgres (Testcontainers), not a mock. Fire 100 calls with `Promise.all` using a pool of 20 or more connections, so transactions genuinely overlap. To make it deterministic, add an optional test hook that awaits a barrier between the SELECT and the UPDATE, so every transaction reads the same value before any of them writes. Assert the final balance equals 1000 + 100×10. Before the fix it fails with something like 1010; after the fix it always passes. Keep it as a regression test."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-03',
      difficulty: 'hard',
      question:
        'Transaction T1 transfers A→B and T2 transfers B→A concurrently, each locking the debit account first. What does Postgres do, and what is the best permanent fix?',
      options: [
        'Postgres detects the cycle after deadlock_timeout and aborts one transaction with 40P01; the fix is to lock accounts in a consistent order (e.g. sorted by ID) and retry victims.',
        'Both transactions wait until statement_timeout; the fix is to lower statement_timeout.',
        'Postgres automatically reorders the lock requests to avoid the cycle; no fix is needed.',
        'Both commit, but one transfer is silently lost; the fix is SERIALIZABLE isolation.',
      ],
      correct: [0],
      explanation:
        'Postgres runs deadlock detection once a lock wait exceeds deadlock_timeout (1 s by default) and aborts one participant, which is then fully rolled back and safe to retry. Lock ordering removes the cycle altogether. statement_timeout would only help if detection did not exist, and it would fail both transactions. Postgres never reorders locks. Row locks prevent silent lost updates in this pattern.',
      followUps: [
        {
          "q": "A transfer touches 3 accounts (A→B with a fee to account F). How do you apply lock ordering, and what if the set of rows isn't known up front?",
          "a": "Collect every account ID the transaction will touch, sort them, and lock them in one statement: `SELECT … FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE`. Postgres takes the locks in that order, so cycles can't form. If the rows depend on data read mid-transaction, e.g. looking up a routing account, do a read-only lookup first, then lock the full sorted set, and re-verify the lookup under the lock (retry if it changed). As a last resort, catch `40P01` and retry with jittered backoff; deadlock retries are safe because the victim is fully rolled back."
        },
        {
          "q": "How would you detect in production that deadlocks are happening and which code paths cause them?",
          "a": "Postgres logs \"deadlock detected\" with both statements and the PIDs involved. Turn on `log_lock_waits = on`, so any wait longer than `deadlock_timeout` is logged too, and ship those logs. `pg_stat_database.deadlocks` gives a counter to graph and alert on. In the application, tag the `40P01` errors with the route or job name and the trace ID. Correlating the timestamps with job schedules (\"spikes at 01:00\") usually points straight at the batch job whose lock order differs from the API's."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-04',
      difficulty: 'expert',
      question:
        'Worker A holds this Redis lock (TTL 30 s), then pauses for 35 s in a long GC. Worker B acquires the lock. A wakes up and finishes. What goes wrong?',
      code: {
        language: 'typescript',
        code: `const ok = await redis.set('lock:report:42', 'held', 'PX', 30000, 'NX');
if (ok) {
  try {
    await writeReport(42, data);      // writes to Postgres
  } finally {
    await redis.del('lock:report:42');
  }
}`,
      },
      options: [
        'Nothing: Redis extends the TTL automatically while the client connection is open.',
        'Only a performance problem: B waits for A to finish because NX blocks until the key is deleted.',
        'A\'s write fails because Redis rejects commands from clients whose lock expired.',
        'A and B both write report 42 concurrently, and A\'s DEL removes B\'s lock, letting a third worker in. Fix with a unique token plus compare-and-delete, and fencing tokens checked by Postgres.',
      ],
      correct: [3],
      explanation:
        'A TTL lock is a lease: after expiry B legitimately acquires it while A still believes it holds it. The constant value "held" means A\'s DEL deletes B\'s lock. The storage must reject stale holders using a fencing token, and the release must check a unique token. Redis does not auto-extend TTLs (Redisson\'s watchdog is a client feature), SET NX does not block, and Redis has no idea which writes to Postgres relate to the lock.',
      followUps: [
        {
          "q": "You add fencing tokens. Where does the token come from, and how does Postgres enforce it on the report write?",
          "a": "The token must be monotonic across lock acquisitions. With Redis, `INCR lock:report42:fence` at acquire time gives a strictly increasing number; with etcd/ZooKeeper, the revision or zxid works. Pass it with every write: `UPDATE reports SET body = $1, fence = $2 WHERE id = 42 AND fence < $2`. If A wakes up holding token 7 after B wrote with 8, A's update matches 0 rows and A aborts. The storage enforces it, so pauses, clock skew or lost locks can't let a stale holder write."
        },
        {
          "q": "Would Redlock across 5 Redis nodes remove the need for fencing in this GC-pause scenario?",
          "a": "No. Redlock makes acquiring the lock more robust against a single Redis node failing, but it's still a TTL lease. A process that pauses 35 s, longer than the TTL, wakes up believing it holds the lock, whatever the number of Redis nodes. Redlock also assumes bounded clock drift and network delay. For correctness you still need the storage to reject stale holders (a fencing token) or an idempotent, conditional write. Use Redis locks for efficiency (avoiding duplicate work), not for safety."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-05',
      difficulty: 'hard',
      question:
        'Select ALL that apply: which of these operations should be decided against a strongly consistent source of truth rather than a cache or async replica?',
      options: [
        'Reserving the last seat on a flight.',
        'Rendering the like count on a post.',
        'Checking whether a username is available at the moment of registration.',
        'Debiting a wallet for a purchase.',
        'Showing "people also bought" recommendations.',
      ],
      correct: [0, 2, 3],
      explanation:
        'Seat reservation, username uniqueness and wallet debits protect invariants (no double booking, uniqueness, no overdraft), so the decision must be a conditional write or constraint on the source of truth. Displaying availability or pre-checking a username in a form can use a cache, but the commit cannot. Like counts and recommendations tolerate staleness, so eventual consistency is fine there.',
      followUps: [
        {
          "q": "Seat reservation must be strongly consistent, but the flight page gets 50k reads/s. How do you serve availability without hammering the primary?",
          "a": "Separate display from decision. Serve the seat map from a cache or read replica refreshed every few seconds (or via CDC), accepting that it can show a seat that was just taken. The reservation itself is a conditional write on the primary: `UPDATE seats SET held_by = $user, hold_until = now() + 10 min WHERE id = $seat AND held_by IS NULL`. If 0 rows change, tell the user it's gone and refresh the map. Primary load scales with booking attempts (maybe hundreds per second), not with page views."
        },
        {
          "q": "Username uniqueness must hold across two regions with active-active writes. What do you do?",
          "a": "Don't let both regions decide independently. Options: route all username claims to one home region (a single-leader table with a unique index), which adds cross-region latency only at registration; or use a globally consistent store (Spanner, CockroachDB, DynamoDB global tables with a conditional write in one owning region). Partitioning the namespace by region doesn't work for global handles. Registration is rare, so paying 100–200 ms of cross-region latency there is a cheap price for a hard invariant."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-06',
      difficulty: 'expert',
      question:
        'During an AZ impairment, the AZ\'s instances still pass LB health checks, but 30% of real requests routed there time out. Error rate is 10% overall. What is the best immediate action?',
      options: [
        'Wait for the health checks to fail; the LB will remove the AZ automatically.',
        'Scale up all deployments by 50% so there is more capacity everywhere.',
        'Restart the pods in the affected AZ to clear bad state.',
        'Evacuate the AZ proactively (zonal shift / deregister its targets, cordon nodes), relying on pre-provisioned capacity in the other AZs.',
      ],
      correct: [3],
      explanation:
        'This is a gray failure: shallow health checks pass while real work fails, so the LB will not act on its own. Shifting traffic away from the zone is fast and reversible, and static stability means the remaining AZs can absorb it. Scaling up spreads pods into the bad AZ too, and control planes are congested during AZ events. Restarting pods in an impaired AZ does not fix the infrastructure.',
      followUps: [
        {
          "q": "How would you design health checks so the LB detects this gray failure on its own next time?",
          "a": "Make the health signal reflect real work. Use deep checks that exercise the AZ-local dependency path (e.g. a lightweight query through the actual DB/cache connection) with a tight timeout. More importantly, use outlier detection on real traffic: Envoy or the LB ejects hosts or zones whose 5xx or latency rate is far above their peers'. Add zonal health metrics, i.e. per-AZ error rate and p99 computed from client-side telemetry, with an automated zonal-shift trigger when one AZ's error rate is several times the others' for a few minutes."
        },
        {
          "q": "You evacuate the AZ, and the remaining two AZs now run at 95% CPU. What did you get wrong in capacity planning, and what's the rule?",
          "a": "You weren't statically stable. Losing 1 of 3 AZs means the other two must carry 150% of their normal load, so each AZ should normally run at no more than about 66% of what it can safely handle, or you pre-provision N+1 capacity. Autoscaling during the event is unreliable because the control plane is congested and new capacity takes minutes. The rule: size steady state so that `load / (AZs − 1)` fits within safe per-AZ capacity, and verify it with regular zonal-evacuation drills."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-07',
      difficulty: 'hard',
      question:
        'Select ALL that apply: an accidental `DELETE FROM order_items WHERE …` removed the wrong 3M rows 15 minutes ago. Which recovery sources can restore the rows?',
      options: [
        'A synchronous standby replica in another AZ.',
        'A point-in-time restore to a new instance at the timestamp just before the DELETE.',
        'A delayed replica configured with recovery_min_apply_delay = 1h.',
        'The async cross-region replica, since its lag is only a few hundred milliseconds.',
      ],
      correct: [1, 2],
      explanation:
        'PITR replays the base backup plus WAL up to just before the DELETE, and a 1-hour delayed replica has not yet applied it, so both still contain the rows. Synchronous and async replicas both applied the DELETE within about a second, and replication faithfully copies mistakes. That is why replicas are not backups.',
      followUps: [
        {
          "q": "You restore via PITR to a new instance. Orders kept flowing into production for 15 minutes. How do you get the 3M rows back without losing the new writes?",
          "a": "Don't swap the whole database. Restore to a side instance at the timestamp just before the DELETE, export only the deleted `order_items` rows (use the DELETE's WHERE clause, or diff primary keys against production), and insert them back into production with `INSERT … ON CONFLICT DO NOTHING`. Check foreign keys and any rows the app changed since (e.g. cascades, or orders cancelled after the delete). Do it in batches to avoid lock and replication spikes. Validate with row counts and checksums per order before closing the incident."
        },
        {
          "q": "How would you make an accidental mass DELETE like this much harder to run in the first place?",
          "a": "Put guardrails in layers. Run migrations only through a reviewed pipeline, never from ad-hoc prod shells. Use a linter that rejects `DELETE`/`UPDATE` without a WHERE clause or above a row estimate. Production roles for humans should be read-only, with break-glass access audited. Big data changes must run as batched jobs with a dry-run count and a confirmation step. Set `statement_timeout` on human sessions. Soft-delete critical tables (a `deleted_at` column) so a mistaken delete becomes an UPDATE you can undo, and keep a delayed replica for whatever slips through."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-08',
      difficulty: 'expert',
      question:
        'You fail over from region A to region B during a partial outage. Twenty minutes later region A recovers, and some clients with cached DNS are still sending writes to A, which accepts them. What is this, and what should have prevented it?',
      options: [
        'Replication lag; it resolves automatically once A replicates to B.',
        'Split-brain; the old primary must be fenced (writes blocked or credentials revoked) before promoting B, and servers in A should reject writes once not authoritative.',
        'A DNS caching problem only; lowering TTLs to 5 s is enough to prevent it.',
        'Normal active-active behaviour; last-writer-wins will merge the data correctly.',
      ],
      correct: [1],
      explanation:
        'Two regions accepting writes for the same data independently is split-brain, and the divergent writes need manual reconciliation. Fencing the old writer, via a write-region flag checked by the app, revoked DB credentials or STONITH, is a mandatory failover step. Replication from A to B stopped when B was promoted. Low TTLs help but many clients ignore them. LWW is not a safe merge strategy for business data like orders or payments.',
      followUps: [
        {
          "q": "Split-brain already happened: A accepted 4,000 orders for 20 minutes after B was promoted. How do you reconcile?",
          "a": "First fence A (block writes) so the divergence stops growing. Then extract A's writes since the promotion point. The replication position at promotion (LSN) tells you where the histories forked, so use WAL decoding or `updated_at` filters. Classify them: new orders with UUIDs that don't conflict can be re-applied to B; conflicting updates, such as inventory decrements or payment status changes, need business rules or manual review. Re-run payments reconciliation against the PSP. Communicate with affected customers. Then rebuild A as a fresh replica of B rather than trying to merge it."
        },
        {
          "q": "How do you make the app layer itself refuse writes in the non-authoritative region, even if DNS and clients misbehave?",
          "a": "Keep a write-authority record in a strongly consistent control store (e.g. etcd or a small consensus-backed config service) containing the current primary region and an epoch number. Each app instance caches it with a short TTL and checks it on every write path: if this region isn't the primary, return 503/redirect instead of writing. The failover runbook bumps the epoch first. Also stamp the epoch on DB writes, or revoke the old region's DB credentials, so even a stale cache can't write."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-09',
      difficulty: 'medium',
      question:
        'Checkout p99 jumped from 300 ms to 1.5 s. The payments service reports its server-side p99 as 120 ms, but checkout\'s client-side histogram for calls to payments shows p99 1.2 s. Where do you look first?',
      options: [
        'The payments service\'s database queries.',
        'The checkout service\'s own business logic CPU usage.',
        'The CDN in front of the public API.',
        'The gap between client and server: checkout\'s HTTP connection pool wait, DNS/TLS connection setup, client retries, or sidecar/proxy queueing.',
      ],
      correct: [3],
      explanation:
        'If the callee handles requests in 120 ms but the caller waits 1.2 s, the missing time is spent between them. Common causes are client pool exhaustion, connection setup without keep-alive, retries with backoff, or a proxy queue. Payments\' DB time is already included in its 120 ms server time. Checkout\'s own CPU would not show up inside the client-call histogram. The CDN is not on this internal path.',
      followUps: [
        {
          "q": "You find each checkout pod has a pool of 20 connections to payments and handles 300 payment calls/s. Is the pool the problem?",
          "a": "Yes. With 120 ms server time plus ~10 ms network, Little's law needs 300 × 0.13 ≈ 39 concurrent connections per pod, but only 20 exist. The pool caps throughput at 20 ÷ 0.13 ≈ 154 calls/s, so ~146 calls/s queue for a connection and the wait grows until something times out. That is how the caller sees 1.2 s while payments reports 120 ms. Confirm with the pool-acquire latency histogram and the pending-requests gauge, then raise the pool to about 50, but only after checking that payments and its DB can handle the extra concurrency."
        },
        {
          "q": "How would you instrument checkout so this \"between client and server\" time is visible next time without guesswork?",
          "a": "Break the client span into phases. OpenTelemetry HTTP instrumentation plus undici/http agent hooks can record pool-acquire wait, DNS, TCP/TLS connect, time-to-first-byte, and the retry count as span attributes or child spans. Export a histogram for pool-acquire time and a gauge for in-use versus max connections per upstream. If there's a sidecar, enable its upstream timing metrics (Envoy's `upstream_rq_time` and `upstream_cx_connect_ms`). Then the client minus server delta is attributed to a specific phase on a dashboard."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-10',
      difficulty: 'hard',
      question:
        'After a deploy, error rate rose from 0.1% to 4%. You rolled back within 6 minutes, but errors stay at 4%. Which explanation is most likely?',
      options: [
        'The old version cannot handle state the new version created: a migration it does not expect, data written in a new format (e.g. a new enum value), or events already published with a new schema.',
        'The rollback did not complete; Kubernetes rollbacks usually take over an hour.',
        'Errors are cached at the CDN for the old version and will expire on their own.',
        'Rollbacks always cause a temporary increase in errors, which subsides after the HPA scales.',
      ],
      correct: [0],
      explanation:
        'A rollback reverts code but not data, schema or messages already published. If errors continue after a clean rollback, look at what the release changed outside the image. That is why migrations must be backward compatible and new data formats must be introduced readers-first. Kubernetes rollbacks take minutes, error responses are generally not cached for API traffic, and a rollback does not inherently cause sustained errors.',
      followUps: [
        {
          "q": "Investigation shows the new version wrote a new enum value `PARTIALLY_REFUNDED` into orders.status. How do you stop the errors now?",
          "a": "Either roll forward (re-deploy the new version, which understands the value, perhaps behind a flag that disables the risky feature), or ship a quick hotfix to the old version that tolerates unknown enum values, e.g. mapping them to a safe default. Don't rewrite production data under pressure unless you can map it losslessly. Long term: introduce new enum values readers-first. Release N+1 can read the value but doesn't write it; release N+2 starts writing it. Then a rollback to N+1 is always safe."
        },
        {
          "q": "How would you catch this \"not rollback-safe\" class of change before it reaches production?",
          "a": "Add a rollback test to the deploy pipeline: in staging, deploy version N+1, run a traffic replay or synthetic tests that write data, roll back to N, and run the tests again. Any error after the rollback fails the release. Add migration linting that flags non-backward-compatible changes (dropping or renaming columns, adding NOT NULL without a default). Run schema-registry compatibility checks for events. Require PRs that add enum values or new formats to declare their readers-first plan."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-11',
      difficulty: 'expert',
      question:
        'Traces for the order flow end at the producer. The consumer\'s spans appear as separate traces with no parent. Given this producer code, what is the fix?',
      code: {
        language: 'typescript',
        code: `await producer.send({
  topic: 'order.created',
  messages: [{ key: order.id, value: JSON.stringify(order) }],
});
// consumer: eachMessage: async ({ message }) => tracer.startActiveSpan('process', ...)`,
      },
      options: [
        'Increase the sampling rate to 100% so the consumer\'s spans are kept.',
        'Use the same service.name in producer and consumer so the backend stitches them together.',
        'Inject the active context (W3C traceparent) into message headers on send, and extract it in the consumer to start spans with that parent context (or a span link for batches).',
        'Put the trace ID into the message key so partitioning keeps traces together.',
      ],
      correct: [2],
      explanation:
        'Trace context only crosses process boundaries if it is propagated. HTTP instrumentation does this automatically via headers, but here the message carries no context, so the consumer starts a new root trace. Injecting into Kafka headers and extracting on consume fixes it; kafkajs instrumentation can do this automatically. Sampling and service.name do not link traces. Changing the message key would break per-order ordering and still would not carry the context.',
      followUps: [
        {
          "q": "The consumer reads batches of 500 messages from many different orders. Should each batch's span be a child of all 500 producers?",
          "a": "A span can have only one parent, so use span links. Create one \"process batch\" span (a new root, or a child of the consumer's polling context) with links to each message's extracted context, capping the number of links if needed. Then create a per-message child span when you process each message individually, and parent that one to the message's extracted context so each order's trace continues end to end. That gives correct per-order traces without pretending a batch belongs to a single trace."
        },
        {
          "q": "After the fix, traces now span the Kafka hop. How do you measure time spent waiting in the topic, as opposed to processing?",
          "a": "Record the producer send timestamp, which is already the Kafka message timestamp, and on consume compute `now - message.timestamp` as a \"queue time\" attribute on the consumer span. Also emit it as a histogram metric per topic and consumer group. In the trace view, the gap between the producer span ending and the consumer span starting shows it visually. That splits end-to-end latency into publish, waiting (driven by lag), and processing, so you know whether to scale consumers or optimise the handler."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-12',
      difficulty: 'medium',
      question:
        'Select ALL that apply: you need to debug rare 3-second checkout requests (0.1% of traffic) without storing every trace. Which choices help?',
      options: [
        'Tail-based sampling in the OTel Collector that keeps all traces over 1 s and all errors, plus a few percent of the rest.',
        'Head-based sampling at 1%, decided at the first span.',
        'Exemplars on the latency histogram linking buckets to trace IDs.',
        'Logging the trace_id on every log line to pivot from an error log to its trace.',
      ],
      correct: [0, 2, 3],
      explanation:
        'Tail sampling decides after the trace completes, so it can keep exactly the slow and failed traces. Exemplars jump from a p99 spike to a representative trace, and trace IDs in logs let you pivot from errors to traces. 1% head sampling keeps only about 1% of the 0.1% slow requests, so it discards almost all the traces you need.',
      followUps: [
        {
          "q": "Tail sampling in the Collector: what infrastructure constraint does it impose when you run 10 collector replicas?",
          "a": "All spans of a trace must reach the same collector instance, or the sampler sees partial traces and decides wrongly. You need a two-tier setup: a first layer of collectors using the `loadbalancing` exporter, which routes by trace ID, feeding a second layer that runs `tail_sampling`. The tail samplers also buffer spans in memory for the decision wait (e.g. 10–30 s), so memory is roughly spans/s × decision wait × span size. Size it, and set `num_traces` limits so a traffic spike doesn't OOM the sampler."
        },
        {
          "q": "Your trace backend bill doubled after enabling the policy. Which knobs do you turn without losing the slow and error traces?",
          "a": "Lower the baseline probabilistic rate for normal traces (e.g. from 5% to 1%) while keeping the latency and error policies at 100%. Add rate-limiting policies per service so a noisy endpoint can't flood the backend. Drop high-cardinality or verbose attributes and span events in the Collector (`attributes`/`transform` processors). Shorten retention for the baseline traces versus the interesting ones. Watch out: if the 1 s latency threshold catches 20% of traffic during an incident, cap that policy with a rate limit too."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-13',
      difficulty: 'expert',
      question:
        'An indexer consumes CDC events and upserts documents into Elasticsearch. After a consumer-group rebalance, some products show older prices than the database. What prevents this class of bug?',
      code: {
        language: 'typescript',
        code: `await es.index({
  index: 'products',
  id: evt.productId,
  document: evt.after,            // full row image from Debezium
});`,
      },
      options: [
        'Setting refresh: true on every index call so documents are immediately visible.',
        'Increasing the number of Kafka partitions so each product has its own partition.',
        'Indexing with external versioning (version = row version or source LSN, version_type: external), so an older event can never overwrite a newer document.',
        'Switching to the _update API with a script that merges fields.',
      ],
      correct: [2],
      explanation:
        'Rebalances and retries replay events, so an older event can be applied after a newer one. With external versioning ES rejects writes whose version is not greater than the stored version, which makes upserts order-safe and idempotent. refresh: true affects visibility and hurts indexing throughput, not ordering. Per-key ordering already holds within a partition and replay is the real issue. A merge script still applies stale values.',
      followUps: [
        {
          "q": "A product is deleted in Postgres. With external versioning, how do you make sure a delayed older \"update\" event can't resurrect it in Elasticsearch?",
          "a": "A plain ES delete removes the document's version, so a late update with a lower version could re-create it once the delete tombstone is garbage-collected (`index.gc_deletes`, 60 s by default). Safer: index a soft-deleted document (`deleted: true`) with the delete event's version, so stale updates are rejected by the version check, and filter `deleted:false` in queries. Purge those tombstone documents later with a cleanup job after a safe window. Or, if you hard-delete, raise `gc_deletes` above your worst replay delay."
        },
        {
          "q": "How would you continuously verify that Elasticsearch agrees with Postgres, rather than waiting for merchants to complain?",
          "a": "Run a reconciliation job. Sample, or fully scan by key ranges, and compare `(id, version)` between Postgres and ES, e.g. 1% of products every hour plus all products changed in the last hour. Emit metrics for missing, stale and orphaned document counts and alert above a threshold. Repair automatically by re-emitting those IDs into the indexer topic. Also alert on indexer consumer lag and on the age of the newest indexed `updated_at` versus Postgres, which is an end-to-end freshness SLI."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-14',
      difficulty: 'medium',
      question:
        'New products are indexed (the bulk API returns success and the documents exist via GET by ID), but they do not appear in search results for a long time. What is the most likely cause?',
      options: [
        'The index\'s refresh_interval was set to -1 or a large value (e.g. for a bulk load) and never reverted, so new segments are not opened for search.',
        'The CDC connector is in FAILED state.',
        'The search thread pool is rejecting queries.',
        'The documents were routed to a replica shard that is not searchable.',
      ],
      correct: [0],
      explanation:
        'GET by ID is real-time because it reads from the translog, but search only sees documents after a refresh opens a new segment. A disabled or very long refresh_interval therefore produces exactly this symptom. A failed connector would mean the documents never arrive, so GET would miss them too. Thread-pool rejections return errors rather than silently missing results. Replica shards are searchable once refreshed.',
      followUps: [
        {
          "q": "The team set refresh_interval to -1 for a nightly 50M-document reindex. How should the bulk-load job be written so it can't leave the index in this state?",
          "a": "Better: build the new index separately, with `refresh_interval: -1` and `number_of_replicas: 0`, bulk-load it, then set refresh back to `1s`, restore replicas, wait for green, and atomically switch an alias from the old index to the new one. The live index's settings are never touched. If you must modify the live index, use try/finally to restore settings, plus a monitor that alerts when any index serving traffic has `refresh_interval` of -1 or above 30 s."
        },
        {
          "q": "Product asks for \"new items searchable within 1 second\" while indexing 20k docs/s. What does a 1 s refresh interval cost, and is it enough?",
          "a": "Each refresh creates a new small segment per shard, so at 1 s you create many tiny segments and spend more CPU and I/O on merges and cache invalidation. That cuts indexing throughput compared with 30 s, often noticeably. Also, 1 s refresh means visibility up to ~1 s after ES receives the doc, plus pipeline lag (CDC, Kafka, bulk batching), so the end-to-end time is more like 2–5 s. Agree on an end-to-end freshness SLO, measure it with a canary doc, and only use `refresh=wait_for` on the specific writes where a user immediately searches for their own item."
        }
      ],
    },
    {
      id: 'prod-correctness-ops-mcq-15',
      difficulty: 'expert',
      question:
        'Select ALL that apply: a Kubernetes CronJob "settle-payouts" must never pay a merchant twice. Which measures actually provide that guarantee (rather than just making double runs less likely)?',
      options: [
        'concurrencyPolicy: Forbid on the CronJob.',
        'A UNIQUE (merchant_id, run_date) constraint on the payouts table, with ledger rows assigned to the payout in the same transaction.',
        'Passing an idempotency key derived from the payout ID to the bank API.',
        'A Redis SET NX lock with a TTL longer than the typical job duration.',
      ],
      correct: [1, 2],
      explanation:
        'The unique constraint makes a second payout record for the same merchant and day impossible, and the bank idempotency key stops a retried payout call from moving money twice. Together they guarantee correctness whatever the scheduling. concurrencyPolicy: Forbid reduces overlaps, but CronJobs can still run a schedule twice in edge cases and manual re-runs bypass it. A Redis TTL lock can expire or be lost on failover. Both are optimisations, not guarantees.',
      followUps: [
        {
          "q": "The bank API doesn't support idempotency keys. How do you still avoid paying twice when the payout call times out?",
          "a": "Treat a timeout as \"unknown\", never as \"failed\". Use a unique reference you control, the payout ID, in the bank transfer's reference field. Before retrying, query the bank's transfer list or status by that reference (many banks offer it, or there is a statement/reconciliation file). If no lookup is possible, park the payout in `UNKNOWN` and resolve it from the next bank statement instead of retrying automatically. A day of delay is far cheaper than a duplicate payout, which is often unrecoverable."
        },
        {
          "q": "How do you prove to finance that no merchant was paid twice across a month of runs?",
          "a": "Reconcile three sources: your `payouts` table (the unique constraint already guarantees at most one row per merchant per day), the ledger rows assigned to each payout (they should sum exactly to the payout amount, with every row assigned at most once), and the bank's statement of actual transfers matched by reference. Run it daily and report counts of payouts without a bank match, bank transfers without a payout, and amount mismatches. Zero mismatches over the month is the evidence; any mismatch opens an incident."
        }
      ],
    },
  ],
};

export default topic;
