import type { Topic } from '../../types';

const topic: Topic = {
  id: 'ds-concurrency',
  phase: 'distributed',
  order: 4,
  title: 'Concurrency, Locking & Distributed Locks',
  subtitle:
    'Race conditions, optimistic vs pessimistic locking, atomic ops, Redis/etcd locks, fencing tokens and deadlocks — the bugs that only show up at 3 AM under load.',
  estimatedMinutes: 110,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 7 Hotel Reservation (concurrency)',
    'Alex Xu — System Design Interview Vol 2, Ch 11 Payment System (idempotency)',
    'Martin Kleppmann — How to do distributed locking (2016)',
    'Designing Data-Intensive Applications — Ch 7 & 8',
  ],
  tags: [
    'race-condition',
    'optimistic-locking',
    'pessimistic-locking',
    'select-for-update',
    'cas',
    'redis-lock',
    'redlock',
    'fencing-token',
    'etcd',
    'deadlock',
    'idempotency',
    'worker-threads',
  ],
  cheatSheet: [
    'Race = two actors interleave between READ and WRITE. Fix by making the check and the write ONE atomic step (conditional UPDATE, unique constraint, CAS) — not by "being faster".',
    'Node is single-threaded but NOT race-free: every `await` is a yield point; 2 requests can both read stock=1 before either writes.',
    'Optimistic: `UPDATE ... SET v=v+1 WHERE id=$1 AND v=$2` → 0 rows = conflict → reload/retry. Best when conflicts are rare (<~5%).',
    'Pessimistic: `SELECT ... FOR UPDATE` inside a short txn; add `NOWAIT` or `lock_timeout`; `SKIP LOCKED` turns a table into a job queue.',
    'Inventory: `UPDATE stock SET qty=qty-$n WHERE sku=$1 AND qty>=$n` — atomic, no lock round-trip; plus `CHECK (qty >= 0)` as the last line of defence.',
    'Duplicates (orders/payments): idempotency key + UNIQUE constraint + `INSERT ... ON CONFLICT DO NOTHING`; locks alone never make retries safe.',
    'Redis lock: `SET k <uuid> NX PX 30000`; release ONLY via Lua compare-and-delete. TTL too short → two holders; too long → slow recovery.',
    'A lease without a fencing token is only an efficiency lock. For correctness the storage must reject stale tokens (`WHERE fence < $token`). Redlock gives no fencing token.',
    'etcd/ZooKeeper give consensus-backed leases + monotonic revisions/zxids you can use as fencing tokens; prefer them (or the DB itself) for correctness locks.',
    'Deadlock = cycle of waits. Prevent with a global lock order (sort ids), short txns, lock timeouts; Postgres detects after `deadlock_timeout` (1s) and aborts one (40P01) — always retry.',
  ],
  sections: [
    {
      heading: 'Race conditions: check-then-act and read-modify-write',
      body: `**Intuition:** two cashiers look at the same shelf, both see "1 left", both sell it. Nobody lied — the world changed between *looking* and *acting*.

A **race condition** is any bug whose outcome depends on the interleaving of concurrent operations. In backend systems there are two shapes you will see again and again:

| Shape | Pattern | Classic bug |
|---|---|---|
| **Check-then-act** | \`if (!exists) create()\` | Two identical orders, two accounts with one email, a cron job running twice |
| **Read-modify-write** | \`x = read(); write(x + 1)\` | Lost update: two +1s produce +1, inventory goes negative, balance overwritten |

Both are the same root problem: the **decision** is made on a snapshot that is stale by the time the **write** lands. The window may be 2 ms — at 5K RPS that window is hit many times a day.

**Why "it works on my machine":** a single developer never sends two requests in the same millisecond. Load tests with a tight loop of retries, double-clicks, mobile clients retrying on flaky networks, and at-least-once message delivery all do.

**The only real fixes** (everything in this topic is a variant of one of these):
1. **Make the check and the write one atomic operation** — conditional \`UPDATE ... WHERE\`, \`INSERT ... ON CONFLICT\`, Redis \`INCR\`/Lua, CAS.
2. **Serialize access** to the resource — a lock (row lock, mutex, distributed lock) or a single-writer partition.
3. **Detect conflicts and retry** — optimistic concurrency with version numbers, SERIALIZABLE isolation.
4. **Make duplicates harmless** — idempotency keys and unique constraints.

**In interviews say this:** "The bug is that the read and the write are two steps. I'd push the invariant into a single atomic statement the database enforces, and only reach for a lock if the invariant spans things one statement can't cover."`,
      diagram: `  Lost update (read-modify-write), balance starts at 100

  Request A                 DB (balance)            Request B
  ---------                 ------------            ---------
  SELECT balance  ------->     100
                               100     <-------  SELECT balance
  new = 100 - 30                                  new = 100 - 50
  UPDATE bal=70   ------->      70
                                50     <-------  UPDATE bal=50
                                ^
            A's debit of 30 is silently lost (should be 20)`,
      code: [
        {
          language: 'typescript',
          title: 'Buggy: classic read-modify-write in a NestJS service',
          code: `// Looks innocent. Under concurrency it loses writes.
async withdraw(accountId: string, amount: number): Promise<void> {
  const { rows } = await this.pg.query(
    'SELECT balance FROM accounts WHERE id = $1',
    [accountId],
  );
  const balance = Number(rows[0].balance);
  if (balance < amount) throw new BadRequestException('insufficient funds');

  // <-- another request can read the SAME balance right here
  await this.pg.query(
    'UPDATE accounts SET balance = $1 WHERE id = $2',
    [balance - amount, accountId], // absolute write clobbers the other update
  );
}

// Fixed: one atomic conditional statement. The DB row lock taken by
// UPDATE serializes the two requests; the WHERE re-checks the invariant.
async withdrawSafe(accountId: string, amount: number): Promise<void> {
  const res = await this.pg.query(
    'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1',
    [amount, accountId],
  );
  if (res.rowCount === 0) throw new BadRequestException('insufficient funds');
}`,
        },
      ],
      keyPoints: [
        'Check-then-act and read-modify-write are the two canonical race shapes.',
        'Relative updates (balance = balance - $1) with a guard in WHERE beat read-then-write.',
        'Fix categories: atomic op, serialize, detect-and-retry, make duplicates harmless.',
      ],
      source: 'Designing Data-Intensive Applications — Ch 7 (lost updates, write skew)',
    },
    {
      heading: 'Concurrency inside one Node process: the event loop is not a mutex',
      body: `**Intuition:** Node runs your JavaScript on one thread, so two lines never execute *simultaneously* — but every \`await\` hands the thread to someone else. Anything you read before an \`await\` may be stale after it.

**Mechanics:**
- JS code between two \`await\`s runs to completion (no preemption) — that is a tiny critical section for free.
- An \`await\` on DB/Redis/HTTP yields; other requests' callbacks run; they can read and mutate the same shared state.
- An in-memory "lock" (\`Map<key, Promise>\`, \`async-mutex\`) only protects a **single process**. With 12 pods × 4 cluster workers, you have 48 independent memories — in-process locks do nothing for cross-instance races.

**Where real parallelism exists in Node:**
| Mechanism | Parallel? | Shared memory? | Use for |
|---|---|---|---|
| Event loop | No (concurrent, not parallel) | Yes (JS heap) | I/O-bound request handling |
| libuv thread pool (default **4**, \`UV_THREADPOOL_SIZE\` up to 1024) | Yes | No JS access | fs, dns.lookup, crypto.pbkdf2, zlib |
| \`worker_threads\` | Yes | Only via \`SharedArrayBuffer\` + \`Atomics\` | CPU-bound work (image resize, parsing, hashing) |
| \`cluster\` / multiple pods | Yes | No | Scaling across cores/hosts |

**Java/Go comparison (interviewers from those shops ask):** a JVM thread pool shares a heap, so you need \`synchronized\`, \`ReentrantLock\`, \`AtomicLong\`; Go uses goroutines + channels or \`sync.Mutex\`. In Node, the shared-heap race only appears at \`await\` points — but the *distributed* race (many processes, one DB) is identical in every language.

**In production:** use in-process mutexes only to coalesce work in one instance (e.g., single-flight a cache refill); use the database or a distributed primitive for anything that must hold across instances.`,
      code: [
        {
          language: 'typescript',
          title: 'Per-key in-process mutex (single-flight) — correct only within one process',
          code: `// Serializes async work per key inside ONE Node process.
// Useful for cache refill coalescing; useless across pods.
export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => current);
    this.tails.set(key, tail);

    await prev; // wait for everyone queued before us
    try {
      return await fn();
    } finally {
      release();
      // clean up only if nobody queued behind us
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

// worker_threads + Atomics: a true cross-thread counter
import { Worker, isMainThread, workerData } from 'node:worker_threads';
if (isMainThread) {
  const sab = new SharedArrayBuffer(4);
  const counter = new Int32Array(sab);
  for (let i = 0; i < 4; i++) new Worker(__filename, { workerData: sab });
  setTimeout(() => console.log('total', Atomics.load(counter, 0)), 1000);
} else {
  const counter = new Int32Array(workerData as SharedArrayBuffer);
  for (let i = 0; i < 100_000; i++) Atomics.add(counter, 0, 1); // no lost increments
}`,
        },
      ],
      keyPoints: [
        'Every await is a yield point — state read before it can be stale after it.',
        'In-process locks protect one process only; pods need DB/Redis/etcd coordination.',
        'worker_threads share memory only through SharedArrayBuffer + Atomics.',
      ],
    },
    {
      heading: 'Optimistic locking: version columns and compare-and-set',
      body: `**Intuition:** like Google Docs' "someone else edited this — reload?" You don't block anyone; you check at save time whether the thing you read is still the thing you're overwriting.

**Mechanics:** each row carries a \`version\` (integer) or \`updated_at\`. Read it, compute, then write **conditionally**:
\`UPDATE t SET ..., version = version + 1 WHERE id = $1 AND version = $2\`.
If \`rowCount = 0\`, someone else won; reload and retry (or return **409 Conflict** / **412 Precondition Failed** to the client — this is exactly what HTTP \`ETag\` + \`If-Match\` expresses).

**When it shines:**
- Low contention (profile edits, admin CMS, hotel room *types* on most dates).
- Long "think time" (user holds a form open for minutes — you can't hold a DB lock that long).
- Across service boundaries (ETags on REST resources).

**When it hurts:** high contention on one row (flash-sale SKU, hot counter). With N concurrent writers, only one succeeds per round; the rest retry — wasted work grows roughly O(N²) and p99 explodes. Alex Xu's hotel reservation chapter makes the same point: optimistic locking is the favoured option *when contention is low*, but performance collapses when many users hit the same room type.

**Details that matter:**
- Use an integer version, not \`updated_at\` — two writes in the same millisecond (or clock skew) break timestamps.
- ORMs support it: TypeORM \`@VersionColumn()\` (check \`affected\`), Prisma via \`updateMany({ where: { id, version } })\`, JPA \`@Version\`.
- Bound retries (3–5) with jitter; surface a conflict to the user after that.
- Optimistic ≠ lock-free magic for invariants across rows — it protects the row you versioned, not a sum over many rows (write skew).`,
      code: [
        {
          language: 'typescript',
          title: 'Optimistic update with bounded retry (pg)',
          code: `class ConflictError extends Error {}

async function updateProfile(
  pg: Pool,
  userId: string,
  mutate: (p: Profile) => Profile,
  maxAttempts = 4,
): Promise<Profile> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { rows } = await pg.query(
      'SELECT id, data, version FROM profiles WHERE id = $1',
      [userId],
    );
    const current: Profile = rows[0];
    const next = mutate(current);

    const res = await pg.query(
      // CAS: succeeds only if nobody bumped the version since our read
      'UPDATE profiles SET data = $1, version = version + 1 ' +
        'WHERE id = $2 AND version = $3 RETURNING id, data, version',
      [next.data, userId, current.version],
    );
    if (res.rowCount === 1) return res.rows[0];

    // lost the race: back off with jitter, then re-read and retry
    await sleep(Math.random() * 20 * 2 ** attempt);
  }
  throw new ConflictError('too much contention on profile ' + userId);
}`,
        },
        {
          language: 'sql',
          title: 'Same idea over HTTP: ETag / If-Match maps to the version',
          code: `-- GET /profiles/42  ->  ETag: "7"   (version = 7)
-- PUT /profiles/42  with  If-Match: "7"
UPDATE profiles
SET    data = $1, version = version + 1
WHERE  id = 42 AND version = 7;
-- 1 row  -> 200 OK, ETag: "8"
-- 0 rows -> 412 Precondition Failed (client must re-GET and merge)`,
        },
      ],
      keyPoints: [
        'Conditional write on version; 0 rows affected means conflict.',
        'Great for low contention and long think-time; terrible for hot rows.',
        'Use integer versions, bounded retries with jitter, and 409/412 to clients.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 7 Hotel Reservation',
    },
    {
      heading: 'Pessimistic locking: SELECT ... FOR UPDATE, NOWAIT, SKIP LOCKED',
      body: `**Intuition:** take the key to the room before you check if the bed is free. Nobody else can even look-to-modify until you hand the key back.

**Mechanics (Postgres/MySQL InnoDB):** inside a transaction, \`SELECT ... FOR UPDATE\` takes a row-level exclusive lock on the matched rows. Other \`FOR UPDATE\`/\`UPDATE\`/\`DELETE\` on those rows **block** until you commit/rollback. Plain \`SELECT\`s are *not* blocked (MVCC readers see the old version).

**Variants you should know:**
| Clause | Behaviour | Use |
|---|---|---|
| \`FOR UPDATE\` | wait for the lock | short, critical read-modify-write |
| \`FOR UPDATE NOWAIT\` | error immediately (55P03 in PG) if locked | fail fast, "seat being booked by someone else" |
| \`FOR UPDATE SKIP LOCKED\` | silently skip locked rows | job queues: N workers each grab different rows |
| \`FOR NO KEY UPDATE\` (PG) | weaker; doesn't block FK inserts referencing the row | updates that don't touch the key |
| \`SET lock_timeout = '2s'\` | bound the wait | protect p99 and pool from pile-ups |

**Rules for using it safely:**
1. Keep the transaction **short** — no HTTP calls, no Kafka publishes, no \`await sleep\` while holding the lock. A held row lock pins a pool connection; 50 waiters = 50 connections gone.
2. Lock in a **consistent order** (sort ids) to avoid deadlocks.
3. Beware **gap/next-key locks** in MySQL REPEATABLE READ — \`FOR UPDATE\` on a range can lock gaps and block inserts, a frequent source of surprise deadlocks.
4. It only works if **every** writer path also locks. One code path doing a naked \`UPDATE\` after its own \`SELECT\` reintroduces the race.

**Optimistic vs pessimistic — pick by contention:**
| | Optimistic | Pessimistic |
|---|---|---|
| Conflict rate | low | high |
| Cost on no-conflict | ~0 | lock + blocking |
| Failure mode under load | retry storms | lock queues, pool exhaustion, deadlocks |
| Holds across user think-time | yes | never |`,
      code: [
        {
          language: 'typescript',
          title: 'Seat booking with FOR UPDATE NOWAIT and lock_timeout',
          code: `async function bookSeat(pool: Pool, showId: string, seatNo: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'"); // scoped to this txn

    const { rows } = await client.query(
      'SELECT status FROM seats WHERE show_id = $1 AND seat_no = $2 FOR UPDATE NOWAIT',
      [showId, seatNo],
    );
    if (rows.length === 0) throw new NotFoundException();
    if (rows[0].status !== 'AVAILABLE') throw new ConflictException('seat taken');

    await client.query(
      "UPDATE seats SET status = 'HELD', held_by = $3, held_until = now() + interval '10 minutes' " +
        'WHERE show_id = $1 AND seat_no = $2',
      [showId, seatNo, userId],
    );
    await client.query('COMMIT'); // lock released here — keep this block tiny
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e.code === '55P03') throw new ConflictException('seat is being booked'); // NOWAIT / lock_timeout
    throw e;
  } finally {
    client.release();
  }
}`,
        },
      ],
      keyPoints: [
        'FOR UPDATE blocks other writers on the row until commit; MVCC readers are unaffected.',
        'NOWAIT / lock_timeout bound waiting; SKIP LOCKED builds work queues.',
        'Never do network I/O while holding a row lock.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 7 Hotel Reservation',
    },
    {
      heading: 'Atomic operations & CAS: let the storage enforce the invariant',
      body: `**Intuition:** instead of asking "how many are left?" and then "take one", say "take one **if** any are left" in a single sentence the storage engine executes indivisibly.

**SQL conditional update (inventory):**
\`UPDATE inventory SET qty = qty - $2 WHERE sku = $1 AND qty >= $2\` — the row lock the UPDATE takes plus the re-evaluated predicate makes this correct under READ COMMITTED in Postgres (the second writer waits, then re-checks \`qty >= $2\` against the committed value). Add \`CHECK (qty >= 0)\` so no buggy path can ever go negative.

**Redis atomics:** Redis executes each command (and each Lua script / function) atomically on its single command thread, ~100K+ ops/s per shard.
- \`INCR\`, \`DECRBY\`, \`HINCRBY\`, \`SETNX\`, \`GETDEL\` are atomic primitives.
- A **Lua script** makes check-and-act atomic: "if stock >= n then decrby". No other command interleaves while it runs (so keep scripts short; a slow script blocks the whole shard).
- \`WATCH\`/\`MULTI\`/\`EXEC\` is Redis's optimistic CAS: \`EXEC\` aborts (returns null) if a watched key changed.

**CAS in general:** compare-and-swap is the hardware/storage primitive under all of this — \`AtomicInteger.compareAndSet\`, DynamoDB \`ConditionExpression\`, etcd \`Txn(If(ModRevision==x))\`, S3 conditional writes (\`If-Match\`/\`If-None-Match\`). If your store offers a conditional write, you rarely need a separate lock.

**Flash sale pattern (numbers):** a single hot Postgres row tops out at roughly a few hundred to ~1–2K updates/s because every update serializes on the row lock and WAL flush. A Redis Lua decrement handles 50–100K/s on one shard. Common design: gate in Redis (fast reject when sold out), then write the durable order in the DB asynchronously, with reconciliation.`,
      code: [
        {
          language: 'lua',
          title: 'Redis Lua: atomic reserve-if-available with per-user limit',
          code: `-- KEYS[1] = stock:{sku}     KEYS[2] = buyers:{sku}  (set of user ids)
-- ARGV[1] = qty requested   ARGV[2] = user id
-- Hash tag {sku} keeps both keys in the same Redis Cluster slot.
local qty = tonumber(ARGV[1])
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')

if redis.call('SISMEMBER', KEYS[2], ARGV[2]) == 1 then
  return -2               -- already bought: enforce 1 per user
end
if stock < qty then
  return -1               -- sold out: reject without touching the DB
end

redis.call('DECRBY', KEYS[1], qty)
redis.call('SADD', KEYS[2], ARGV[2])
return stock - qty        -- remaining stock`,
        },
        {
          language: 'sql',
          title: 'DB-level invariant + atomic decrement',
          code: `ALTER TABLE inventory ADD CONSTRAINT qty_non_negative CHECK (qty >= 0);

-- Atomic reserve: 1 row = success, 0 rows = insufficient stock
UPDATE inventory
SET    qty = qty - $2, updated_at = now()
WHERE  sku = $1 AND qty >= $2
RETURNING qty;

-- Multi-SKU cart: lock rows in a deterministic order to avoid deadlocks
SELECT sku, qty FROM inventory
WHERE  sku = ANY($1::text[])
ORDER  BY sku
FOR UPDATE;`,
        },
      ],
      keyPoints: [
        'Conditional UPDATE + CHECK constraint is the simplest correct inventory guard.',
        'Redis single commands and Lua scripts are atomic per shard; keep scripts short.',
        'Any conditional write (DynamoDB, etcd, S3 If-Match) is a CAS — often no lock needed.',
      ],
    },
    {
      heading: 'Duplicates: unique constraints and idempotency keys',
      body: `**Intuition:** you can't stop a nervous user from pressing "Pay" twice or a mobile client from retrying after a timeout. So make the second press a no-op, not a second charge.

**Why locks don't solve this:** a lock serializes two requests — both still execute, just one after the other. You need the second to recognize "this already happened". That requires a **durable identity** for the operation.

**The pattern:**
1. Client generates an **idempotency key** (UUID v4) per logical operation and sends it on every retry (\`Idempotency-Key\` header — Stripe's convention).
2. Server does \`INSERT INTO idempotency_keys (key, request_hash, status) VALUES (...) ON CONFLICT DO NOTHING\`. The **unique constraint** is the atomic check-then-act.
3. If inserted → you own it; process, then store the response. If conflict → return the stored response (or 409 "in progress" if still running; 422 if the request body hash differs).
4. Keep keys 24h–7 days; expire with a TTL job.

**Natural keys are even better:** \`UNIQUE (user_id, cart_id)\` on orders, \`UNIQUE (payment_intent_id)\` on charges, \`UNIQUE (message_id)\` in a consumer's processed table. Alex Xu's payment chapter uses exactly this: the idempotency key is the primary key of the payment order, so a duplicate insert fails.

**Downstream calls:** pass the same key to the PSP (Stripe, Adyen accept idempotency keys). Your dedupe is useless if you call a non-idempotent external API twice.

**Transactional guarantee:** do the idempotency insert and the business write **in the same DB transaction** when they share a DB — otherwise a crash between them leaves a "reserved" key with no order (handle with a status + recovery sweep).`,
      code: [
        {
          language: 'typescript',
          title: 'Idempotent order creation (same txn as the business write)',
          code: `async function createOrder(pool: Pool, key: string, userId: string, body: CreateOrderDto) {
  const reqHash = sha256(JSON.stringify(body));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      'INSERT INTO idempotency_keys (key, user_id, request_hash, status) ' +
        "VALUES ($1, $2, $3, 'IN_PROGRESS') ON CONFLICT (key) DO NOTHING",
      [key, userId, reqHash],
    );

    if (ins.rowCount === 0) {
      // Duplicate: this blocks until the first txn commits (unique index wait)
      await client.query('ROLLBACK');
      const { rows } = await pool.query(
        'SELECT request_hash, status, response FROM idempotency_keys WHERE key = $1', [key]);
      if (rows[0].request_hash !== reqHash) throw new UnprocessableEntityException('key reused');
      if (rows[0].status !== 'DONE') throw new ConflictException('in progress');
      return rows[0].response; // replay the original response
    }

    const order = await insertOrder(client, userId, body);
    await client.query(
      "UPDATE idempotency_keys SET status = 'DONE', response = $2 WHERE key = $1",
      [key, order],
    );
    await client.query('COMMIT'); // key + order become visible atomically
    return order;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}`,
        },
      ],
      keyPoints: [
        'Locks serialize duplicates; they do not deduplicate them.',
        'Unique constraint + ON CONFLICT is the atomic "have I seen this?" check.',
        'Propagate the idempotency key to external APIs (PSPs).',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 11 Payment System',
    },
    {
      heading: 'Distributed locks with Redis: SET NX PX and safe release',
      body: `**Intuition:** a lock that lives in a shared place (Redis) instead of in one process's memory. Whoever writes their name on the whiteboard first owns it — and the name auto-erases after a while in case they faint.

**Acquire:** \`SET lock:{resource} <random-token> NX PX 30000\`
- \`NX\` — only if it doesn't exist (atomic check-then-act).
- \`PX 30000\` — TTL so a crashed holder doesn't lock forever. **Never** \`SETNX\` then \`EXPIRE\` as two commands — a crash between them leaves an immortal lock.
- \`<random-token>\` — unique per acquisition, so you can prove ownership on release.

**Release:** must be compare-and-delete in **one Lua script**. A naive \`DEL\` can delete someone else's lock: A's TTL expires while A is GC-paused, B acquires, A wakes and \`DEL\`s B's lock, C acquires → B and C both "hold" it.

**Renewal (watchdog):** for work longer than the TTL, extend periodically (every TTL/3) with a compare-and-\`PEXPIRE\` script. Redisson does this by default (30s lease, renew every 10s). If renewal fails, **abort the work** — you've lost the lock.

**What can still go wrong (single Redis):**
- **Failover:** primary acknowledges the SET, crashes before replicating; replica is promoted without the key → second client acquires. Redis replication is async.
- **Process pauses:** a 40s stop-the-world GC, VM migration, or event-loop block can exceed the TTL; the holder doesn't know it lost the lock.
- **Clock jumps** on the Redis host affect TTL expiry.

So a Redis lock is great as an **efficiency lock** (avoid doing the same expensive work twice; occasional double execution is tolerable) and insufficient alone as a **correctness lock** (money, inventory) unless paired with fencing or an idempotent/conditional write.`,
      code: [
        {
          language: 'typescript',
          title: 'ioredis lock with token, safe release and renewal',
          code: `import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
const EXTEND = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end";

export async function withLock<T>(
  redis: Redis, resource: string, ttlMs: number, fn: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  const key = 'lock:' + resource;
  const token = randomUUID();
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX'); // atomic acquire + TTL
  if (ok !== 'OK') return null; // someone else holds it

  const ac = new AbortController();
  const timer = setInterval(async () => {
    try {
      const extended = await redis.eval(EXTEND, 1, key, token, ttlMs);
      if (extended === 0) ac.abort(); // lock lost: tell the worker to stop
    } catch { ac.abort(); }
  }, Math.floor(ttlMs / 3));

  try {
    return await fn(ac.signal); // fn must check signal.aborted before side effects
  } finally {
    clearInterval(timer);
    await redis.eval(RELEASE, 1, key, token); // only deletes OUR lock
  }
}`,
        },
      ],
      keyPoints: [
        'Acquire with one command: SET key token NX PX ttl.',
        'Release and extend via Lua compare-then-act on the token.',
        'Async replication + process pauses mean two holders are possible; treat it as an efficiency lock unless fenced.',
      ],
    },
    {
      heading: 'Redlock, fencing tokens and consensus-backed leases (etcd/ZooKeeper)',
      body: `**Intuition:** a lock with a timeout can expire while the holder is frozen. When the holder wakes, it still *believes* it has the lock. The only safe fix is for the **resource** to reject the zombie — that's what a fencing token does.

**Redlock (antirez):** acquire the same key on **N = 5 independent** Redis masters; you hold the lock if you got a **majority (3)** within a time well under the TTL; validity = TTL − elapsed − clock-drift allowance. It survives one Redis node crashing (unlike single-instance).

**The controversy (Kleppmann, 2016):**
1. **No fencing token:** Redlock's random value is not monotonic, so storage can't tell an old holder from a new one.
2. **Timing assumptions:** safety depends on bounded network delay, bounded process pauses and roughly synchronized clocks. A GC pause or a clock jump on a Redis node (e.g., NTP step) can let two clients hold a majority.
3. antirez's rebuttal: with monotonic clocks and careful ops, the assumptions are reasonable. Practical consensus: **use Redlock only where an occasional double-holder is tolerable; for correctness use consensus + fencing**.

**Fencing tokens:** the lock service returns a strictly increasing number with each grant (33, 34, ...). Every write to the protected resource carries it; the resource stores the highest token seen and rejects lower ones:
\`UPDATE files SET content=$1, fence=$2 WHERE id=$3 AND fence < $2\`.
The zombie with token 33 is rejected once 34 has written — no matter how long it slept.

**etcd / ZooKeeper leases:**
| | Redis (single / Redlock) | etcd | ZooKeeper |
|---|---|---|---|
| Consistency | async replication / timing-based | Raft (linearizable) | ZAB (linearizable writes) |
| Liveness | TTL | lease with TTL + keepalive | session + ephemeral znode |
| Fencing token | none built in | key's \`mod_revision\` / create revision (monotonic) | \`zxid\` / sequential znode number |
| Waiters | poll/retry | watch on previous key | watch on predecessor znode (no herd) |
| Throughput | 100K+/s | ~10K writes/s | ~10K writes/s |

**Also consider:** the database you already have. Postgres \`pg_advisory_xact_lock(hashtext('job:x'))\` is released automatically when the transaction/connection ends — no TTL guessing — and is perfect for "only one instance runs the migration/cron".

**In interviews say this:** "Is this lock for efficiency or correctness? If efficiency, Redis \`SET NX PX\`. If correctness, I use a consensus-backed lease and pass a fencing token that the downstream store checks — or better, avoid the lock by making the write itself conditional."`,
      diagram: `  Why TTL locks need fencing

  Client A          Lock service          Client B          Storage
  --------          ------------          --------          -------
  acquire -------->  grant token=33
  [ GC pause ....................................... ]
                     lease expires
                     grant token=34 <----- acquire
                                            write(tok=34) --> ok, fence=34
  wakes up
  write(tok=33) -------------------------------------------> REJECT (33<34)`,
      code: [
        {
          language: 'typescript',
          title: 'etcd lease lock + fencing token checked by the DB',
          code: `import { Etcd3 } from 'etcd3';
const etcd = new Etcd3({ hosts: ['http://etcd-0:2379'] });

async function runExclusive(resourceId: string, pg: Pool) {
  // Lease-backed lock: key disappears if our keepalives stop (crash / partition)
  const lock = etcd.lock('locks/' + resourceId).ttl(15);
  await lock.acquire();
  try {
    // mod revision of the lock key = cluster-wide monotonic number = fencing token
    const kv = await etcd.get('locks/' + resourceId).exec();
    const fence = Number(kv.kvs[0].mod_revision);

    const res = await pg.query(
      'UPDATE reports SET body = $1, fence = $2 WHERE id = $3 AND fence < $2',
      [await buildReport(resourceId), fence, resourceId],
    );
    if (res.rowCount === 0) throw new Error('stale lock holder fenced off');
  } finally {
    await lock.release();
  }
}`,
        },
        {
          language: 'sql',
          title: 'Postgres advisory lock: single-runner cron without TTLs',
          code: `-- Returns true for exactly one session; auto-released at txn end or disconnect
BEGIN;
SELECT pg_try_advisory_xact_lock(hashtext('cron:daily-settlement')) AS got_it;
-- if got_it = false -> another instance is running; exit quietly
-- ... do the job in this txn (or record a run row + commit) ...
COMMIT;`,
        },
      ],
      keyPoints: [
        'Ask first: efficiency lock or correctness lock?',
        'Redlock needs timing assumptions and provides no fencing token.',
        'Fencing: monotonic token from the lock service, enforced by the resource.',
        'etcd mod_revision / ZK zxid give you monotonic tokens; PG advisory locks avoid TTLs.',
      ],
      source: 'Kleppmann — How to do distributed locking; DDIA Ch 8 (fencing tokens)',
    },
    {
      heading: 'Producer-consumer, worker pools and SKIP LOCKED queues',
      body: `**Intuition:** a restaurant: waiters (producers) drop tickets on a rail; cooks (consumers) take the next ticket. The rail absorbs bursts; the number of cooks sets throughput; two cooks must never cook the same ticket.

**Core ideas:**
- A **bounded buffer** between producers and consumers decouples their speeds. Bounded matters: an unbounded in-memory queue in Node is just an OOM with extra steps. When full, apply **backpressure** (block, reject with 429/503, or drop by policy).
- **Concurrency limit** = number of workers. For I/O-bound work in Node, run many concurrent tasks on one event loop (e.g., \`p-limit(50)\`); for CPU-bound, use \`worker_threads\` sized to cores (\`os.availableParallelism()\`).
- **Exclusive claim:** each job must be taken by exactly one worker at a time — via queue semantics (SQS visibility timeout, Kafka partition ownership) or a DB claim (\`FOR UPDATE SKIP LOCKED\`).

**Postgres as a job queue (good up to ~1–5K jobs/s):** \`SKIP LOCKED\` lets 20 workers each grab a different batch without blocking each other. Add a \`locked_until\` lease so a crashed worker's jobs become visible again (the same idea as SQS visibility timeout). Beyond that scale, or for fan-out, use a real broker (see the messaging phase).

**Multiple workers processing the same message** happens when (a) the claim isn't exclusive, (b) a lease/visibility timeout expires while the first worker is still running, or (c) the broker redelivers after a crash (at-least-once). (a) is a bug; (b) and (c) are physics — so handlers must be **idempotent** anyway.

**Thread pools vs Node event loop:**
| | Thread pool (Java/Go) | Node event loop |
|---|---|---|
| Concurrency unit | OS thread (~1MB stack) / goroutine (~KB) | callback/promise (bytes) |
| 10K concurrent I/O waits | thread-per-request struggles; virtual threads/goroutines fine | trivial |
| CPU-bound task | fine, parallel | blocks everything — move to worker_threads |
| Shared-state race | any line | only across await boundaries |`,
      code: [
        {
          language: 'sql',
          title: 'Job claim with SKIP LOCKED + lease (crash-safe)',
          code: `-- Claim up to 10 due jobs. Concurrent workers skip rows others have locked,
-- and expired leases (crashed workers) become claimable again.
WITH next AS (
  SELECT id FROM jobs
  WHERE  status IN ('PENDING', 'RUNNING')
    AND  run_at <= now()
    AND  (locked_until IS NULL OR locked_until < now())
  ORDER  BY run_at
  LIMIT  10
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs j
SET    status = 'RUNNING',
       locked_by = $1,                       -- worker id
       locked_until = now() + interval '60 seconds',
       attempts = attempts + 1
FROM   next
WHERE  j.id = next.id
RETURNING j.id, j.payload, j.attempts;

-- Completion must prove we still own the lease (fencing-lite):
-- UPDATE jobs SET status='DONE' WHERE id=$2 AND locked_by=$1;`,
        },
      ],
      keyPoints: [
        'Bounded buffers + backpressure; unbounded in-memory queues are OOMs.',
        'SKIP LOCKED + lease = simple, crash-safe DB job queue.',
        'Redelivery is inevitable with leases — handlers must be idempotent.',
      ],
    },
    {
      heading: 'Deadlocks: detection, prevention and retry',
      body: `**Intuition:** two cars at a one-lane bridge, each waiting for the other to back up. Nobody is wrong locally; the cycle is the problem.

**Coffman conditions** (all four needed): mutual exclusion, hold-and-wait, no preemption, circular wait. Break any one.

**How databases handle it:**
- **Postgres:** a waiter that has waited \`deadlock_timeout\` (default **1s**) runs cycle detection; one transaction is aborted with **40P01 deadlock_detected**.
- **MySQL InnoDB:** detects immediately with its wait-for graph (\`innodb_deadlock_detect\`, on by default); rolls back the "smaller" transaction (error 1213). Separate \`innodb_lock_wait_timeout\` (default **50s**) for plain long waits — lower it for OLTP.
- **Distributed locks** (Redis/etcd across services) have **no** global deadlock detector — only TTLs. Lock ordering is mandatory there.

**Prevention playbook:**
1. **Global lock order:** always lock accounts by ascending id (transfer A→B and B→A both lock min(id) first).
2. **Lock everything up front** in one statement (\`WHERE id = ANY($1) ORDER BY id FOR UPDATE\`).
3. **Short transactions**, no user/network waits inside.
4. **Timeouts:** \`lock_timeout\`, \`statement_timeout\`, TTLs on distributed locks.
5. **Retry** deadlock (40P01) and serialization failures (40001) with jittered backoff — they are expected, not exceptional.
6. **Index your FKs and WHERE columns:** an unindexed UPDATE scans and locks far more rows (and in MySQL, gaps), widening the collision surface.

**Diagnosing:** Postgres logs both queries on deadlock (\`log_lock_waits = on\` also logs waits > deadlock_timeout); \`pg_locks\` joined with \`pg_stat_activity\` shows who blocks whom (\`pg_blocking_pids(pid)\`). MySQL: \`SHOW ENGINE INNODB STATUS\` → LATEST DETECTED DEADLOCK.`,
      diagram: `  Transfer A->B and B->A concurrently (no ordering)

  T1: lock(A) ----------> wants lock(B) ...waits for T2
  T2: lock(B) ----------> wants lock(A) ...waits for T1
            \\______________ cycle ______________/

  Fix: both lock min(A,B) first
  T1: lock(A) -> lock(B) -> commit
  T2:   waits on lock(A) ---------> lock(A) -> lock(B) -> commit`,
      code: [
        {
          language: 'typescript',
          title: 'Deadlock-free transfer: ordered locking + retry on 40P01/40001',
          code: `const RETRYABLE = new Set(['40P01', '40001']); // deadlock, serialization failure

async function transfer(pool: Pool, from: string, to: string, cents: number) {
  for (let attempt = 1; ; attempt++) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // Lock both rows in a deterministic order in ONE statement
      await c.query(
        'SELECT id FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[from, to]],
      );
      const debit = await c.query(
        'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1',
        [cents, from],
      );
      if (debit.rowCount === 0) throw new BadRequestException('insufficient funds');
      await c.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [cents, to]);
      await c.query('COMMIT');
      return;
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => {});
      if (!RETRYABLE.has(e.code) || attempt >= 5) throw e;
      await sleep(10 * 2 ** attempt + Math.random() * 25); // jittered backoff
    } finally {
      c.release();
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Break circular wait with a global lock order.',
        'PG detects after deadlock_timeout (1s) → 40P01; MySQL detects immediately → 1213.',
        'Distributed locks have no deadlock detector — rely on ordering + TTLs.',
      ],
    },
    {
      heading: 'Scenario playbook: the seven concurrency incidents interviewers love',
      body: `**Intuition:** almost every incident maps to "which invariant broke, and what single atomic thing should have enforced it?"

| Scenario | Root cause | Fix (in order of preference) |
|---|---|---|
| **Two users update the same record** (last write wins silently) | read-modify-write, absolute overwrite | Optimistic version / ETag + If-Match → 412; field-level PATCH with relative updates; FOR UPDATE if contention is high |
| **Two requests create the same order** (double-click, client retry) | check-then-act on "does it exist?" | Idempotency-Key + UNIQUE constraint + ON CONFLICT; natural key \`UNIQUE(user_id, cart_id)\` |
| **Inventory goes negative** | read stock, then decrement in app | \`UPDATE ... WHERE qty >= n\` + \`CHECK (qty >= 0)\`; Redis Lua gate for flash sales; reservations with expiry |
| **Duplicate payment** | retry after timeout re-calls the PSP | Idempotency key persisted before the PSP call and passed to the PSP; unique on payment_intent; reconcile with PSP settlement files |
| **Cron runs twice** (2 replicas, or overlapping runs) | every replica schedules the job | Leader election / \`pg_try_advisory_lock\` / Redis lock for efficiency; a \`job_runs(job, period) UNIQUE\` row for correctness; K8s CronJob \`concurrencyPolicy: Forbid\` |
| **Multiple workers process the same message** | at-least-once delivery, lease/visibility expiry, rebalance | Idempotent handler: processed-ids table in the same txn as the side effect; conditional state transitions (\`WHERE status='PENDING'\`) |
| **Deadlock** | inconsistent lock order, long txns | Ordered locking, single-statement multi-row locks, short txns, retry 40P01 |

**The meta-lesson for interviews:** prefer mechanisms where **the storage engine enforces the invariant** (constraints, conditional writes, unique keys). Locks are a coordination optimization on top; idempotency is what makes retries — which *will* happen — safe.`,
      code: [
        {
          language: 'yaml',
          title: 'Kubernetes CronJob that never overlaps itself',
          code: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-settlement
spec:
  schedule: '0 2 * * *'
  concurrencyPolicy: Forbid        # skip a run if the previous one is still active
  startingDeadlineSeconds: 600     # do not start a very late run
  successfulJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 3600  # kill hung runs so the next day is not skipped
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: settle
              image: registry.local/settlement:1.42.0
              # The job itself still inserts job_runs(job, run_date) UNIQUE,
              # because K8s CronJob can occasionally create 2 jobs for one schedule.`,
        },
      ],
      keyPoints: [
        'Map each incident to the invariant and the atomic mechanism that enforces it.',
        'K8s CronJob concurrencyPolicy: Forbid helps, but the docs warn jobs may still run twice — keep a DB uniqueness guard.',
        'Idempotent consumers are non-negotiable with at-least-once delivery.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'ds-concurrency-cc-1',
      title: 'Fix the Redis lock guarding merchant payouts',
      context: `A payouts worker runs on 6 pods. Every minute each pod tries to take a Redis lock per merchant and, if it wins, sends that merchant's pending balance to the bank. Finance reports occasional **double payouts**, mostly during deploys and a Redis failover last month. Payout runs take 2–40 seconds (bank API latency varies).`,
      task: 'Identify every concurrency bug in the lock helper and the payout job, then rewrite them so a payout can never be sent twice for the same balance — even if the lock is lost mid-run.',
      starter: {
        language: 'typescript',
        title: 'payout-lock.ts (buggy)',
        code: `import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL!);

export async function acquire(key: string): Promise<boolean> {
  const ok = await redis.setnx(key, '1');     // 1) acquire
  if (ok === 1) await redis.expire(key, 30);  // 2) then set a TTL
  return ok === 1;
}

export async function release(key: string) {
  await redis.del(key);
}

export async function payoutMerchant(pg: Pool, bank: BankClient, merchantId: string) {
  const key = 'lock:payout:' + merchantId;
  if (!(await acquire(key))) return;
  try {
    const { rows } = await pg.query(
      'SELECT balance FROM merchant_balances WHERE merchant_id = $1', [merchantId]);
    const amount = Number(rows[0].balance);
    if (amount <= 0) return;

    await bank.transfer({ merchantId, amount });   // 2-40s, no idempotency key
    await pg.query(
      'UPDATE merchant_balances SET balance = 0 WHERE merchant_id = $1', [merchantId]);
  } finally {
    await release(key);
  }
}`,
      },
      hints: [
        'What happens if the process crashes between SETNX and EXPIRE? And whose lock does DEL remove if your TTL already expired?',
        'The run can outlive the 30s TTL. Even a perfect lock cannot stop a paused holder — what can the database and the bank check instead?',
        'Split the job into "claim the balance as a payout row" (atomic DB step) and "send the payout" (idempotent external call keyed by that row).',
      ],
      solution: {
        language: 'typescript',
        title: 'payout-lock.ts (fixed)',
        code: `import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
const redis = new Redis(process.env.REDIS_URL!);

const RELEASE = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";

// Efficiency lock only: avoids 6 pods doing the same work. Correctness comes from the DB.
async function tryLock(key: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const ok = await redis.set(key, token, 'PX', ttlMs, 'NX'); // atomic acquire + TTL
  return ok === 'OK' ? token : null;
}

export async function payoutMerchant(pg: Pool, bank: BankClient, merchantId: string) {
  const key = 'lock:payout:' + merchantId;
  const token = await tryLock(key, 60_000);
  if (!token) return;
  try {
    // Step 1 (atomic, correctness): move balance into a payout row in ONE txn.
    // Zeroing with a relative, guarded UPDATE means a second runner finds nothing to pay.
    const client = await pg.connect();
    try {
      await client.query('BEGIN');
      // Lock the row, capture the old balance, zero it — one statement
      const res = await client.query(
        'WITH old AS (SELECT balance FROM merchant_balances WHERE merchant_id = $1 FOR UPDATE) ' +
          'UPDATE merchant_balances m SET balance = 0 FROM old ' +
          'WHERE m.merchant_id = $1 AND old.balance > 0 RETURNING old.balance AS amount',
        [merchantId]);
      if (res.rowCount === 1) {
        await client.query(
          "INSERT INTO payouts (id, merchant_id, amount, status) VALUES (gen_random_uuid(), $1, $2, 'PENDING')",
          [merchantId, res.rows[0].amount]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally { client.release(); }

    // Step 2: send every PENDING payout (including ones a crashed run left behind).
    const pending = await pg.query(
      "SELECT id, amount FROM payouts WHERE merchant_id = $1 AND status = 'PENDING'", [merchantId]);
    for (const p of pending.rows) {
      // Bank dedupes on idempotencyKey: a retry or a zombie holder cannot pay twice.
      await bank.transfer({ merchantId, amount: Number(p.amount), idempotencyKey: p.id },
        { timeoutMs: 15_000 });
      await pg.query(
        "UPDATE payouts SET status = 'SENT', sent_at = now() WHERE id = $1 AND status = 'PENDING'",
        [p.id]);
    }
  } finally {
    await redis.eval(RELEASE, 1, key, token); // delete only our own lock
  }
}`,
      },
      explanation: `**Bugs in the starter**
- **SETNX + EXPIRE are two commands**: a crash between them leaves an immortal lock (merchant never paid again). Fix: \`SET key token PX ttl NX\` in one atomic command.
- **Unconditional DEL**: if the TTL (30s) expires during a 40s bank call, pod B takes the lock, then pod A's \`finally\` deletes **B's** lock and pod C also enters. Fix: random token + Lua compare-and-delete.
- **Read-modify-write on the balance** (\`SELECT balance\` ... \`SET balance = 0\`): money credited between the read and the zeroing is wiped out, and two holders both read the same balance. Fix: move the balance into a payout row with a guarded UPDATE inside one transaction.
- **Side effect before the state change, with no idempotency key**: a crash after \`bank.transfer\` but before the UPDATE re-pays on the next run. Fix: persist a \`PENDING\` payout first, pass its id as the bank's idempotency key, then mark \`SENT\` conditionally.
- **The lock was carrying correctness**: during a Redis failover (async replication) two pods can hold the lock. Now the lock is just an efficiency optimization — correctness comes from the atomic DB claim and the bank-side idempotency, so double holders are harmless.
- Added a timeout on the bank call and a sweep that retries leftover \`PENDING\` payouts.`,
      followUps: [
        {
          "q": "The bank's API has no idempotency key. What can you do to keep 'never pay twice' with the PENDING payout design?",
          "a": "Make the bank call reconcilable: send the payout id in a field the bank echoes back (reference/narration), and before retrying a PENDING payout whose previous attempt had an unknown outcome (timeout), query the bank's transfer-status or statement API by that reference. Mark the payout `UNKNOWN` instead of retrying blindly, and let a reconciliation job resolve it to SENT or FAILED. That shifts the system from at-least-once to 'at-most-once plus manual/automatic reconciliation', which is the honest guarantee without bank idempotency."
        },
        {
          "q": "How would you test this under the same failure modes finance saw: deploys and Redis failover?",
          "a": "Run an integration test with real Postgres and Redis and a fake bank that records transfers. Inject faults: kill the worker after `bank.transfer` but before marking SENT, flush Redis (simulating failover) while two workers run, pause one worker longer than the TTL, and run 6 workers concurrently for the same merchant. Assert the fake bank received each payout id at most once and sum(transfers) equals credited balance. In production, run a daily reconciliation comparing bank statements against `payouts` and alert on any mismatch."
        }
      ],
    },
    {
      id: 'ds-concurrency-cc-2',
      title: 'Make checkout safe under double-clicks and flash-sale load',
      context: `A NestJS checkout endpoint for a sneaker drop: 5,000 pairs, ~200K users hammering "Buy" in the first minute. Mobile clients retry on timeout. After the last drop, stock went to **-312**, some users had **two orders** for one click, and Postgres showed dozens of sessions "idle in transaction".`,
      task: 'Rewrite checkout so stock never goes negative, a retried request never creates a second order or charge, and the DB is not held hostage by slow payment calls.',
      starter: {
        language: 'typescript',
        title: 'checkout.service.ts (buggy)',
        code: `@Injectable()
export class CheckoutService {
  constructor(private readonly pool: Pool, private readonly psp: PaymentClient) {}

  async checkout(userId: string, sku: string, qty: number) {
    const client = await this.pool.connect();
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT qty FROM inventory WHERE sku = $1', [sku]);
    if (rows[0].qty < qty) throw new ConflictException('sold out'); // leaks the connection

    const existing = await client.query(
      "SELECT id FROM orders WHERE user_id = $1 AND sku = $2 AND status = 'PAID'", [userId, sku]);
    if (existing.rowCount) return existing.rows[0];

    await client.query('UPDATE inventory SET qty = $1 WHERE sku = $2', [rows[0].qty - qty, sku]);
    const order = await client.query(
      "INSERT INTO orders (user_id, sku, qty, status) VALUES ($1, $2, $3, 'NEW') RETURNING id",
      [userId, sku, qty]);

    await this.psp.charge({ userId, amount: 18000 * qty }); // 1-5s, inside the txn!
    await client.query("UPDATE orders SET status = 'PAID' WHERE id = $1", [order.rows[0].id]);
    await client.query('COMMIT');
    client.release();
    return order.rows[0];
  }
}`,
      },
      hints: [
        'Two requests can both pass the SELECT qty check and both pass the "existing order" check. Which single statements would make each check atomic?',
        'What identifies "the same click" across a client retry? The client has to send it.',
        'Split into a short reserve transaction and a separate, idempotent payment step. What happens to the reservation if payment fails?',
      ],
      solution: {
        language: 'typescript',
        title: 'checkout.service.ts (fixed)',
        code: `@Injectable()
export class CheckoutService {
  constructor(private readonly pool: Pool, private readonly psp: PaymentClient) {}

  // idemKey comes from the client's Idempotency-Key header (same value on every retry)
  async checkout(idemKey: string, userId: string, sku: string, qty: number) {
    const order = await this.reserve(idemKey, userId, sku, qty);
    if (order.status === 'PAID') return order; // replayed request

    try {
      // Outside any DB txn; the PSP dedupes on the same key
      await this.psp.charge({ userId, amount: 18000 * qty, idempotencyKey: order.id },
        { timeoutMs: 8000 });
    } catch (e) {
      await this.release(order.id, sku, qty); // compensate: give stock back
      throw e;
    }
    await this.pool.query(
      "UPDATE orders SET status = 'PAID' WHERE id = $1 AND status = 'RESERVED'", [order.id]);
    return { ...order, status: 'PAID' };
  }

  private async reserve(idemKey: string, userId: string, sku: string, qty: number) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      // UNIQUE(idempotency_key) makes "have I seen this click?" atomic
      const ins = await c.query(
        'INSERT INTO orders (idempotency_key, user_id, sku, qty, status) ' +
          "VALUES ($1, $2, $3, $4, 'RESERVED') ON CONFLICT (idempotency_key) DO NOTHING " +
          'RETURNING id, status', [idemKey, userId, sku, qty]);
      if (ins.rowCount === 0) {
        await c.query('ROLLBACK');
        const prev = await this.pool.query(
          'SELECT id, status FROM orders WHERE idempotency_key = $1', [idemKey]);
        return prev.rows[0];
      }
      // Atomic guarded decrement; CHECK (qty >= 0) backs it up
      const dec = await c.query(
        'UPDATE inventory SET qty = qty - $2 WHERE sku = $1 AND qty >= $2', [sku, qty]);
      if (dec.rowCount === 0) throw new ConflictException('sold out'); // rolls back the order too
      await c.query('COMMIT'); // txn lasts a few ms: no network calls inside
      return ins.rows[0];
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release(); // always returned to the pool
    }
  }

  private async release(orderId: string, sku: string, qty: number) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const upd = await c.query(
        "UPDATE orders SET status = 'CANCELLED' WHERE id = $1 AND status = 'RESERVED'", [orderId]);
      if (upd.rowCount === 1) // only one path can return the stock
        await c.query('UPDATE inventory SET qty = qty + $2 WHERE sku = $1', [sku, qty]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {}); throw e;
    } finally { c.release(); }
  }
}`,
      },
      explanation: `**Fixes**
- **Negative stock**: \`SELECT qty\` then \`SET qty = <absolute>\` is a lost-update race. Replaced with \`UPDATE ... SET qty = qty - $2 WHERE qty >= $2\` (atomic, row-locked, re-checked) plus a \`CHECK (qty >= 0)\` constraint.
- **Duplicate orders**: the "existing order" SELECT is check-then-act and also ignored non-PAID orders. Replaced with a client-supplied idempotency key under a UNIQUE constraint and \`ON CONFLICT DO NOTHING\`; a retry returns the original order.
- **Duplicate charges**: the PSP call now carries an idempotency key (the order id), so a timeout-and-retry cannot charge twice.
- **Idle-in-transaction / pool exhaustion**: the 1–5s PSP call ran inside an open transaction holding the inventory row lock — every buyer of that SKU queued behind it, with one pool connection pinned per waiter. The reserve txn now lasts milliseconds; payment runs outside it.
- **Connection leak**: early \`throw\` skipped \`release()\`. Now \`try/finally\` always releases and rolls back.
- **Compensation**: a failed payment cancels the reservation with a conditional state transition (\`WHERE status = 'RESERVED'\`) so stock is returned exactly once. In production also add a sweeper that expires stale RESERVED orders (for example after 10 minutes) and, for drops this hot, a Redis Lua gate that rejects requests once the SKU is sold out before they reach Postgres.`,
      followUps: [
        {
          "q": "The PSP call times out after 8 s, but the charge actually succeeded at the PSP. What does this code do, and how do you fix it?",
          "a": "The catch block calls `release`, cancelling the order and returning stock — yet the customer was charged. A timeout is an unknown outcome, not a failure. Only compensate on a definitive decline; on timeout, mark the order `PAYMENT_UNKNOWN` and resolve it by querying the PSP with the same idempotency key (or retrying the charge, which the PSP dedupes) and by handling the PSP's webhook. A sweeper resolves unknowns before reservations expire, and the client gets 'payment processing' instead of an error."
        },
        {
          "q": "For this drop, 200K users will mostly get 'sold out'. How do you stop them all from reaching Postgres?",
          "a": "After 5,000 reservations, 195K+ requests still hit the guarded UPDATE and fail. Put a cheap gate first: a Redis Lua decrement of the SKU's stock (rejecting when it hits zero), plus a per-pod in-memory sold-out flag broadcast via pub/sub, so late requests return instantly. Only gate winners proceed to the Postgres reservation, where the guarded UPDATE and CHECK remain the source of truth. Add a per-user limit key in Redis so one user can't take many units."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'ds-concurrency-iq-01',
      difficulty: 'hard',
      question:
        'Design the inventory decrement for a flash sale: 10,000 units of one SKU, ~1M users arriving in the first 60 seconds. Stock must never oversell, and the system must stay responsive.',
      context: 'Interviewer at an e-commerce company (Flipkart/Amazon style). Assume Postgres is the system of record.',
      whatInterviewerLooksFor: [
        'Recognizes the single hot row as the bottleneck and quantifies it',
        'Uses an atomic conditional decrement, not read-then-write',
        'Adds a fast rejection layer (Redis/Lua or token bucket) in front of the DB',
        'Handles reservation expiry, payment failure and reconciliation',
        'Talks about idempotency for retries',
      ],
      modelAnswer: `### 1. Correctness first
The invariant is \`sold <= 10,000\`. The simplest correct guard is a single statement:
\`UPDATE inventory SET qty = qty - 1 WHERE sku = $1 AND qty >= 1\` plus \`CHECK (qty >= 0)\`. Under READ COMMITTED the second writer waits on the row lock, then re-evaluates the predicate — no oversell.

### 2. Why that alone is not enough
Every decrement serializes on **one row**. With ~1–2 ms lock hold (update + WAL commit), one row sustains roughly **500–1,000 updates/s**. 1M requests in 60s is ~17K req/s, so requests pile up, pool connections are exhausted and latency explodes — even though only 10K can succeed.

### 3. Layered design
- **Edge gate:** CDN/waiting room or rate limit per user so bots don't dominate.
- **Redis gate (atomic Lua):** \`stock:{sku}\` preloaded to 10,000. The script checks per-user limit and decrements; returns sold-out instantly. One shard does 50–100K ops/s, so 17K/s is fine. After sell-out, a local in-memory "sold out" flag short-circuits requests without touching Redis.
- **Durable reservation:** winners (≤10K) write a \`RESERVED\` order with an idempotency key, either synchronously or via a queue. The DB sees ~10K writes total, not 1M.
- **Optional sharded counters:** split stock into 10 buckets of 1,000 rows to spread row locks if you must decrement in the DB.

### 4. Lifecycle
- Reservation TTL (e.g. 10 min). Payment success → \`PAID\`; failure/expiry → conditional \`RESERVED → CANCELLED\` and \`INCRBY\` back in Redis.
- **Reconciliation job:** Redis counter vs DB order count; DB wins. Redis can lose a write on failover, so it is a gate, never the ledger.

### 5. Trade-offs
Redis-first means a small window where Redis says "sold" but the DB write fails — handled by compensation. Pure DB is simpler but needs queueing (a waiting room) to protect the pool.`,
      followUps: [
        {
          q: 'Redis fails over mid-sale and loses the last ~100ms of decrements. What happens?',
          a: 'The new primary shows more stock than reality, so up to a few hundred extra "winners" could pass the gate. The DB guarded decrement (or a count check at reservation) is the final authority; excess reservations get rejected and the user sees sold-out. Reconcile the Redis counter from the DB after failover.',
        },
        {
          q: 'Why not optimistic locking with a version column on the inventory row?',
          a: 'With thousands of concurrent writers on one row, only one CAS per round succeeds; the rest retry. Wasted work is roughly quadratic in concurrency and p99 explodes. Optimistic locking suits low contention; a guarded relative decrement is strictly better here.',
        },
        {
          q: 'How do you enforce one pair per user?',
          a: 'In the Lua script, keep a set of buyer ids (SISMEMBER/SADD, same hash slot as the stock key) and in the DB a UNIQUE (user_id, sale_id) constraint on orders. The DB constraint is the guarantee; Redis is the fast path.',
        },
      ],
      pitfalls: [
        'Reading stock, checking in app code, then writing an absolute value',
        'Using a distributed lock around every purchase (serializes everything through a lock round-trip)',
        'Treating Redis as the source of truth without reconciliation',
        'Ignoring abandoned reservations, so stock is stranded',
      ],
    },
    {
      id: 'ds-concurrency-iq-02',
      difficulty: 'expert',
      question:
        'Our payout service uses a Redis SET NX PX lock per merchant. During a Redis primary failover last week, 14 merchants were paid twice. Walk me through what happened and how you would redesign it.',
      whatInterviewerLooksFor: [
        'Explains async replication losing the lock key on failover',
        'Mentions process pauses / TTL expiry as a second path to double holders',
        'Distinguishes efficiency locks from correctness locks',
        'Proposes fencing tokens and/or idempotent, conditional writes as the real fix',
        'Knows the Redlock debate without cargo-culting it',
      ],
      modelAnswer: `### What happened
1. Pod A: \`SET lock:m42 tokA NX PX 30000\` → primary replies OK.
2. Primary crashes **before replicating** (Redis replication is asynchronous; \`WAIT\` only reduces this window).
3. Sentinel promotes a replica that has no \`lock:m42\`.
4. Pod B acquires the same lock. Both call the bank. The bank had no idempotency key, so both succeeded.

The same outcome happens without failover whenever a holder pauses (GC, event-loop blocked by a sync CSV parse, VM stall) longer than the TTL.

### Diagnosis principle
A TTL lock can guarantee **mutual exclusion only under timing assumptions**. For money, correctness must not depend on those.

### Redesign
- **Make the work idempotent and claimed atomically in the DB.** Move balance → \`payouts\` row (\`PENDING\`, unique per merchant+period) in one transaction with a guarded UPDATE. Only one runner can claim a given balance, because the row lock and predicate enforce it.
- **Pass the payout id as the bank's idempotency key.** A zombie or retry cannot pay twice.
- **Conditional state transitions:** \`UPDATE payouts SET status='SENT' WHERE id=$1 AND status='PENDING'\`.
- **Keep the Redis lock** purely as an efficiency lock to stop 6 pods doing redundant work.
- If a lock must guard a non-idempotent resource, use **etcd/ZooKeeper** leases and a **fencing token** (etcd revision) that the resource checks: \`WHERE fence < $token\`.

### On Redlock
Redlock (5 independent masters, majority) survives a single node loss but still has no fencing token and depends on clock/pause assumptions (Kleppmann's critique). It does not fix this incident class; idempotency does.

### Verification
Chaos test: kill the Redis primary and inject a 45s \`SIGSTOP\` into a worker during a payout run; assert exactly one bank transfer per payout id.`,
      followUps: [
        {
          q: 'Would WAIT 1 after SET fix it?',
          a: 'It reduces the window by confirming one replica has the write, but Redis replication is still not consensus: failover can choose a replica that did not ack, and WAIT does not help with process pauses. It is mitigation, not a guarantee.',
        },
        {
          q: 'Where does the fencing token come from with etcd?',
          a: 'The lock key\'s create or mod revision is a cluster-wide monotonically increasing number assigned by Raft. The holder passes it with every write; the storage keeps the max seen and rejects smaller ones.',
        },
        {
          q: 'The bank API does not support idempotency keys. Now what?',
          a: 'Record intent (PENDING with a unique reference in the transfer memo) before calling, never auto-retry an ambiguous timeout, and resolve ambiguous payouts by querying the bank or reconciling against the settlement file before re-sending. Serialize per merchant via a single-partition queue to minimize concurrent attempts.',
        },
      ],
      pitfalls: [
        'Saying "switch to Redlock" as the full answer',
        'Increasing the TTL to 10 minutes (slower recovery, still unsafe under pauses)',
        'Blaming Redis without noticing the non-idempotent side effect',
      ],
    },
    {
      id: 'ds-concurrency-iq-03',
      difficulty: 'hard',
      question:
        'You are building seat booking for a cinema chain (and later hotel rooms). Walk me through optimistic vs pessimistic locking for this, and which you would pick for each case.',
      whatInterviewerLooksFor: [
        'Frames the choice around contention and think-time',
        'Knows the concrete SQL for both approaches',
        'Uses DB constraints as a safety net',
        'Designs a hold/expiry model instead of locking across user think-time',
      ],
      modelAnswer: `### Model the invariant
- Cinema: one seat per show can be sold once → \`UNIQUE (show_id, seat_no)\` on bookings, or a seat row with a status.
- Hotel: per room type per date, \`reserved <= total\` (Alex Xu Ch 7 models \`room_type_inventory(hotel_id, room_type_id, date, total_inventory, total_reserved)\`).

### Options
| | Pessimistic (\`FOR UPDATE\`) | Optimistic (version) | DB constraint |
|---|---|---|---|
| Mechanism | lock row, check, update | \`WHERE version = $v\` | \`CHECK\` / \`UNIQUE\` |
| High contention | queues, but no wasted work | retry storm | fine |
| Low contention | unnecessary overhead | ideal | ideal |
| Risk | deadlocks, long locks | starvation on hot rows | only covers what a constraint can express |

### My picks
- **Hotel rooms:** contention per (hotel, room type, date) is low for most dates, so an **optimistic** version check or even a guarded update \`SET total_reserved = total_reserved + $n WHERE total_reserved + $n <= total_inventory\` works, backed by a \`CHECK\`. Multi-night stays update several date rows — do it in one transaction, **ordered by date**, to avoid deadlocks.
- **Cinema premiere seats:** contention on specific seats is high and users hold a seat while paying. I would never hold a DB lock during payment. Instead: a short transaction \`UPDATE seats SET status='HELD', held_until=now()+10min WHERE ... AND (status='AVAILABLE' OR held_until < now())\` — an atomic conditional transition. Payment confirms \`HELD → SOLD\`; a sweeper releases expired holds. Use \`NOWAIT\` if I do take a row lock, to fail fast with "seat being booked".

### Safety nets
UNIQUE on (show_id, seat_no) in bookings; idempotency key on the booking request to handle double-clicks.

### Numbers
A single guarded update is ~1–3 ms in Postgres; a theatre of 300 seats × a few thousand concurrent users is well within one primary.`,
      followUps: [
        {
          q: 'A user selects 4 seats together. How do you avoid two users each getting 2 of the 4?',
          a: 'Claim all 4 in one statement (UPDATE ... WHERE seat_no = ANY($1) AND status = AVAILABLE) and check rowCount === 4; otherwise roll back. Locking in sorted order prevents deadlocks between overlapping multi-seat requests.',
        },
        {
          q: 'How do you release holds reliably?',
          a: 'Make expiry part of the predicate (held_until < now() counts as available) so correctness does not depend on the sweeper; the sweeper only cleans up status for display.',
        },
      ],
      pitfalls: [
        'Holding SELECT FOR UPDATE while the user enters card details',
        'Picking optimistic locking for a hot row without discussing retries',
        'Forgetting multi-row lock ordering',
      ],
    },
    {
      id: 'ds-concurrency-iq-04',
      difficulty: 'hard',
      question:
        'Your transfers service started throwing "deadlock detected" errors a few hundred times an hour after you added a feature that updates both a wallet and a rewards row in one transaction. How do you investigate and fix it?',
      whatInterviewerLooksFor: [
        'Knows how to get deadlock details from Postgres/MySQL',
        'Identifies inconsistent lock ordering as the usual root cause',
        'Mentions retries as required, not optional',
        'Considers missing indexes, long transactions and FK locks',
      ],
      modelAnswer: `### Investigate
- Postgres logs both statements and the PIDs for each deadlock (error **40P01**). Turn on \`log_lock_waits = on\` to also log waits longer than \`deadlock_timeout\` (default 1s).
- Live: \`SELECT pid, pg_blocking_pids(pid), query FROM pg_stat_activity WHERE wait_event_type = 'Lock'\`.
- MySQL: \`SHOW ENGINE INNODB STATUS\` → LATEST DETECTED DEADLOCK; \`performance_schema.data_locks\`.
- Correlate with the new code path: which rows, in which order, does each transaction touch?

### Typical root causes
1. **Inconsistent order:** path A updates wallet then rewards; path B (e.g., a rewards cron) updates rewards then wallet. Classic cycle.
2. **Transfers between two wallets** locking payer first: A→B and B→A concurrently.
3. **Unindexed foreign keys / WHERE columns:** updates scan and lock more rows; in MySQL REPEATABLE READ, gap/next-key locks block inserts.
4. **Long transactions** widening the window (network calls inside the txn).

### Fix
- **Global lock order:** define it (e.g., wallets before rewards, ascending id within a table) and lock up front: \`SELECT ... WHERE id = ANY($1) ORDER BY id FOR UPDATE\`.
- Keep transactions short; move event publishing to an outbox.
- Add missing indexes.
- **Retry 40P01 and 40001** with jittered backoff (3–5 attempts). Deadlocks are a normal concurrency outcome; the DB already rolled back the victim, so a retry is safe if the transaction is self-contained.
- Alert on rate, not existence: a handful per day is normal; hundreds per hour is a design bug.

### Verify
Load-test both paths concurrently with a hot set of 10 wallets; expect zero 40P01 after reordering.`,
      followUps: [
        {
          q: 'Why does Postgres wait 1 second before detecting?',
          a: 'Deadlock detection is relatively expensive, so it only runs when a lock wait exceeds deadlock_timeout; most waits resolve sooner. Lowering it detects faster but costs CPU under contention.',
        },
        {
          q: 'Can you get deadlocks with a distributed lock across services?',
          a: 'Yes, and nothing detects them — service A holds lock X waiting for Y, B holds Y waiting for X until TTLs expire. You need a global order or tryLock with timeout plus back-off and release of held locks.',
        },
      ],
      pitfalls: [
        'Raising lock timeouts to "make it go away"',
        'Not retrying the victim transaction',
        'Wrapping everything in SERIALIZABLE without understanding it increases aborts',
      ],
    },
    {
      id: 'ds-concurrency-iq-05',
      difficulty: 'expert',
      question:
        'A customer was charged twice for one order. The mobile app shows one tap. Trace every place in a typical checkout → payment → PSP flow where a duplicate can be born, and design it so this cannot happen.',
      context: 'Stripe/Adyen style PSP, NestJS backend, Kafka between order and payment services.',
      whatInterviewerLooksFor: [
        'Enumerates duplicate sources: client retry, gateway retry, consumer redelivery, PSP timeout retry',
        'End-to-end idempotency key propagation',
        'Unique constraints as the enforcement point',
        'Handles the ambiguous-timeout case explicitly',
        'Reconciliation as the backstop',
      ],
      modelAnswer: `### Where duplicates are born
1. **Client retry:** request timed out on a flaky network; app retries the POST.
2. **Gateway/LB retry:** some proxies retry idempotency-unsafe requests on upstream reset.
3. **Message redelivery:** the payment service consumed "OrderPlaced", charged, crashed before committing the offset → redelivered.
4. **PSP timeout:** our call to the PSP timed out after the PSP actually charged; our retry charges again.
5. **Two workers** racing on the same payment row (rebalance, visibility timeout).

### Design
- **Client-generated idempotency key** per checkout attempt, persisted with the order: \`orders.idempotency_key UNIQUE\`. Retries return the same order.
- **One payment per order:** \`payments.order_id UNIQUE\` (or a payment_intent id). The consumer does \`INSERT ... ON CONFLICT DO NOTHING\`; only the inserter proceeds.
- **Intent before side effect:** write \`payment(status=PENDING)\` and commit **before** calling the PSP. The payment id is the PSP idempotency key (Stripe keeps keys ~24h and replays the original response).
- **Ambiguous outcome** (timeout/5xx): never blindly create a new charge. Retry with the **same** key, or query the PSP by our reference; mark \`UNKNOWN\` and let a resolver job settle it.
- **Conditional transitions:** \`UPDATE payments SET status='SUCCEEDED' WHERE id=$1 AND status IN ('PENDING','UNKNOWN')\` — webhooks and polling can both arrive without double-processing.
- **Reconciliation:** daily PSP settlement file vs ledger (Alex Xu Ch 11). Any charge without a matching payment row triggers an automatic refund plus an alert.

### Why not a lock?
A lock around "charge" only serializes the two attempts; the second still charges after the first finishes. The problem is identity, not concurrency.`,
      followUps: [
        {
          q: 'The same idempotency key arrives with a different amount. What do you do?',
          a: 'Store a hash of the request with the key; on mismatch return 422. It is either a client bug or tampering; silently replaying or re-processing are both wrong.',
        },
        {
          q: 'How long should you keep idempotency keys?',
          a: 'At least as long as the longest plausible retry window (client, queue retention, DLQ redrive). 24h is common for API keys; per-order uniqueness is kept forever since it is a natural key.',
        },
        {
          q: 'The webhook for success arrives before your PSP call returns. Problem?',
          a: 'Not with conditional transitions: the webhook moves PENDING to SUCCEEDED; the late API response tries the same transition, affects 0 rows, and is a no-op.',
        },
      ],
      pitfalls: [
        'Proposing a distributed lock as the fix',
        'Generating the idempotency key server-side per request (each retry gets a new key)',
        'Retrying PSP timeouts with a new key',
        'No reconciliation backstop',
      ],
    },
    {
      id: 'ds-concurrency-iq-06',
      difficulty: 'medium',
      question:
        'A teammate says: "Node is single-threaded, so we cannot have race conditions in our NestJS service." Also, the PDF export endpoint makes every other endpoint slow. Respond to both.',
      whatInterviewerLooksFor: [
        'Explains await as a yield point and cross-instance races',
        'Distinguishes concurrency from parallelism',
        'Knows the libuv thread pool and worker_threads',
        'Proposes offloading CPU-bound work (worker pool or separate service/queue)',
      ],
      modelAnswer: `### Races in Node
- JavaScript runs on one thread, so code **between** awaits is atomic. But every \`await\` yields: request A reads a counter from Redis, awaits, request B reads the same value, both write +1 → lost update. That is the same read-modify-write race as in Java.
- In-memory state (\`Map\` caches, "isRunning" flags) races across awaits within a pod, and it is **not shared** across pods or cluster workers — 10 pods mean 10 independent flags.
- Distributed races (two pods, one DB row) are language-independent; the fixes are DB atomics, constraints, and distributed coordination.

### The slow PDF endpoint
- PDF rendering is **CPU-bound** and runs on the event loop, so while it computes for 800 ms, no other callbacks run: every request's p99 jumps. Event-loop lag metrics (\`perf_hooks.monitorEventLoopDelay\`) will show it.
- Not a libuv thread pool problem — that pool (default **4** threads, \`UV_THREADPOOL_SIZE\` up to 1024) only serves fs, dns.lookup, crypto, zlib. But it can be one too: 100 concurrent \`bcrypt\`/\`pbkdf2\` calls queue behind 4 threads.

### Fixes
1. **worker_threads pool** (e.g., Piscina) sized to \`os.availableParallelism() - 1\`, with a bounded queue that returns 503 when full (backpressure).
2. Better: make exports **async** — enqueue a job, return 202 with a status URL, render in a separate worker deployment that autoscales on queue depth, upload to S3.
3. Protect the API pods: set request timeouts and a concurrency limit on the export route.

### Summary for the teammate
"Single-threaded means no two lines run at the same instant, not that sequences of awaits are atomic — and we run many processes anyway."`,
      followUps: [
        {
          q: 'When would you use SharedArrayBuffer and Atomics?',
          a: 'Rarely: when worker threads need a shared counter or lock-free ring buffer without message-passing overhead (e.g., high-rate metrics aggregation). Most apps pass messages instead.',
        },
        {
          q: 'Does running with cluster mode fix the PDF issue?',
          a: 'It spreads the damage across workers but one render still blocks whichever worker it lands on, including all its other requests. Isolation via worker threads or a separate service is the real fix.',
        },
      ],
      pitfalls: [
        'Agreeing that Node cannot have races',
        'Suggesting setImmediate chunking as the main fix for heavy CPU work',
        'Unbounded worker queues (OOM under burst)',
      ],
    },
    {
      id: 'ds-concurrency-iq-07',
      difficulty: 'expert',
      question:
        'You need exactly one instance of a scheduler (leader) in a 5-pod deployment that assigns work to others. Design leader election and explain what happens during a network partition.',
      whatInterviewerLooksFor: [
        'Uses a consensus-backed lease (etcd, ZooKeeper, Kubernetes Lease) rather than ad-hoc Redis',
        'Understands lease expiry vs holder awareness (the leader may not know it lost leadership)',
        'Uses fencing (epoch/term) on downstream writes',
        'Picks sensible timing parameters',
      ],
      modelAnswer: `### Mechanism
- Use a **Kubernetes Lease** object (client-go/leaderelection style) or an **etcd** lease/election. K8s defaults commonly used: \`leaseDuration 15s\`, \`renewDeadline 10s\`, \`retryPeriod 2s\`.
- Candidates try to create/update the lease with CAS on \`resourceVersion\`. The winner renews periodically; others watch it.
- Each new leadership gets an **epoch** (lease transitions counter or etcd revision).

### Partition walkthrough
1. Leader L (epoch 7) is partitioned from etcd/API server but can still reach the DB.
2. L can't renew. After \`renewDeadline\` (10s) L must **step down voluntarily** and stop issuing work.
3. After \`leaseDuration\` (15s) since the last renewal, another pod acquires with epoch 8.
4. The gap between L's step-down and the lease expiry is the safety margin — it only holds if L's clock rate is sane and L isn't paused. A 30s GC pause breaks the assumption: L wakes up and thinks it still leads.

### Fencing
Every assignment write carries the epoch: \`UPDATE tasks SET owner=$w, epoch=$e WHERE id=$t AND epoch <= $e\`, and workers reject commands with an epoch lower than the highest they have seen. The zombie leader with epoch 7 is harmless.

### Design choices
- Prefer **idempotent assignments** so brief dual leadership is survivable.
- Expose \`is_leader\` and \`leader_epoch\` metrics; alert on two pods reporting leader simultaneously.
- Failover time ≈ leaseDuration + acquire time → ~15–20s of no scheduling. If that is unacceptable, shorten the lease (more API-server load, more false failovers on GC pauses).

### Why not Redis?
A single Redis primary with async replication can grant the lease twice on failover and gives no fencing epoch; fine for efficiency, not for "exactly one leader".`,
      followUps: [
        {
          q: 'Why must renewDeadline be shorter than leaseDuration?',
          a: 'So the old leader stops acting before anyone else can acquire the lease; the difference absorbs clock-rate differences and scheduling delays between nodes.',
        },
        {
          q: 'Can you avoid leader election entirely?',
          a: 'Often yes: partition the work (hash tasks to pods via consistent hashing or Kafka partition assignment) or use SKIP LOCKED claims so any pod can safely take any task.',
        },
      ],
      pitfalls: [
        'Assuming the old leader instantly knows it lost leadership',
        'No fencing on downstream effects',
        'Leader-election via SETNX with no renewal or token',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'ds-concurrency-boe-1',
      question:
        'Flash sale: 100,000 units of one SKU, 600,000 purchase attempts in the first 60 seconds. Can a single Postgres row with a guarded decrement keep up? What about Redis?',
      assumptions: [
        'Each guarded UPDATE holds the row lock ~1.5 ms (update + commit/WAL flush), so updates on the same row are serialized',
        'Redis single shard: ~80K simple ops/s; a short Lua script ~50K/s',
        'Traffic is roughly uniform over the 60s',
      ],
      steps: [
        { label: 'Incoming rate', calc: '600,000 ÷ 60 s = 10,000 attempts/s' },
        { label: 'Single-row DB throughput', calc: '1 ÷ 1.5 ms ≈ 667 serialized updates/s' },
        { label: 'Time to sell out via DB only', calc: '100,000 ÷ 667 ≈ 150 s (and 10K/s arrive while only 667/s drain → queue grows ~9.3K/s)' },
        { label: 'Connections pinned waiting', calc: 'Queue grows beyond any pool (typical pool 20–100/pod) within milliseconds → timeouts' },
        { label: 'Sharded DB counters', calc: '20 bucket rows × 667 ≈ 13K/s > 10K/s arrival — works, but needs bucket-selection + retry logic' },
        { label: 'Redis Lua gate', calc: '10K/s ÷ 50K/s ≈ 20% of one shard; sells out in ~10 s at 10K/s' },
        { label: 'Durable writes after gate', calc: 'Only 100K winners → 100K order inserts spread over ~10–60 s ≈ 1.7–10K inserts/s across many rows (no hot row)' },
      ],
      answer:
        'One hot row (~650 updates/s) cannot keep up with 10K/s; either shard the counter into ~20 rows or gate in Redis (a fraction of one shard) and write only the ~100K winners to Postgres.',
      insight:
        'Hot-row contention, not total DB capacity, is the limit. Put an atomic in-memory gate in front of the durable store and reconcile, or split the contended counter.',
      followUps: [
        {
          "q": "The drop is announced on TV and attempts jump 10× to 6M in 60 s. What breaks in the Redis-gate design?",
          "a": "Arrival becomes 6M ÷ 60 s = 100K attempts/s, double the ~50K/s a single shard runs the Lua script at. Fix it in layers: a waiting room/token issuance at the edge admits at a fixed rate, every app pod caches a local 'sold out' flag (pub/sub broadcast) so the 95% of requests arriving after sell-out never touch Redis, and the stock can be split across several Redis keys on different shards (e.g. 4 × 25,000) with fallback to another shard when one is empty."
        },
        {
          "q": "Redis has admitted 100K winners, but 3% of them fail payment. How does the stock get back, and can a returned unit be oversold?",
          "a": "Each admitted winner gets a reservation with an expiry (say 10 minutes) in Postgres. On payment failure or expiry, a conditional transition `RESERVED → CANCELLED` returns the unit with an `INCR` on the Redis counter — conditional so it happens exactly once. That re-opens the gate for ~3,000 units. No oversell occurs as long as Redis is only incremented after the cancel commits, and Postgres keeps `CHECK (qty >= 0)` as the backstop if Redis and the DB ever disagree."
        }
      ],
    },
    {
      id: 'ds-concurrency-boe-2',
      question:
        '20 editors hit "save" on the same document at the same moment. Compare total DB work for optimistic locking (retry on conflict) vs pessimistic locking.',
      assumptions: [
        'All 20 read the same version simultaneously; each round exactly one CAS wins',
        'Each attempt = 1 read + 1 conditional write ≈ 3 ms of DB time',
        'Pessimistic: each save = lock + read + write ≈ 3 ms, strictly serialized',
      ],
      steps: [
        { label: 'Optimistic attempts', calc: 'Round k has (21 − k) contenders: 20 + 19 + ... + 1 = 20 × 21 ÷ 2 = 210 attempts' },
        { label: 'Optimistic DB time', calc: '210 × 3 ms = 630 ms of DB work; last writer succeeds after 20 rounds' },
        { label: 'Pessimistic attempts', calc: '20 attempts, 20 × 3 ms = 60 ms total; last writer waits ~57 ms' },
        { label: 'Low-contention case', calc: 'If conflicts are 1%: optimistic ≈ 1.01 attempts/save, no lock overhead' },
      ],
      answer:
        'Under full contention optimistic locking does ~10x more work (210 vs 20 attempts, O(N²) vs O(N)); under rare conflicts it is cheaper than locking.',
      insight:
        'Choose by contention: optimistic for rare conflicts and long think-time, pessimistic/atomic updates or a single-writer queue for hot records. Collaborative editors avoid both via operational transforms/CRDTs.',
      followUps: [
        {
          "q": "Now 200 editors save at once instead of 20. Re-run both numbers.",
          "a": "Optimistic: 200 × 201 ÷ 2 = 20,100 attempts × 3 ms ≈ 60 s of DB work, and the last writer needs 200 rounds. Pessimistic: 200 × 3 ms = 600 ms total, with the last writer waiting ~0.6 s. The gap grows linearly with N (≈ N/2 times more work), which is why optimistic concurrency collapses on hot records. At 200 concurrent writers to one document neither is right — you'd move to a single-writer queue per document or operation-based merging."
        },
        {
          "q": "With pessimistic locking, one editor's client holds the lock and then goes idle for 10 minutes. What's your policy?",
          "a": "Never hold a DB row lock across user think-time. Use an application-level lease instead: `doc_locks(doc_id, holder, expires_at)` with a short TTL (e.g. 2 minutes) refreshed by client heartbeats while the editor is active. If the holder idles, the lease expires and others can edit; the returning user's save then fails a version check and gets a merge/diff prompt. The DB-level lock exists only for the milliseconds of the actual write."
        }
      ],
    },
    {
      id: 'ds-concurrency-boe-3',
      question:
        '20,000 long-running jobs run concurrently, each guarded by a Redis lease (SET NX PX, released with a token-checked Lua script). Job duration: mean 40 s, p99 90 s. The worst stop-the-world GC pause seen is 3 s. Pick the lease TTL and renewal interval, estimate the Redis load, and say how long a crashed holder blocks its job.',
      assumptions: [
        'Renewal is a token-checked Lua "compare and PEXPIRE", sent every TTL ÷ 3, so a holder can miss one renewal and survive',
        'Steady state: the job start rate equals concurrency ÷ mean duration (Little\'s law)',
        'One Redis shard handles ~100K simple ops/s; RTT ~1 ms',
        'The alternative under discussion: no renewal, with a fixed TTL set to the p99 duration (90 s)',
      ],
      steps: [
        { label: 'Minimum TTL', calc: 'Must cover 2 renewal intervals + worst pause: 2 × TTL/3 + 3 s < TTL → TTL > 9 s; pick 30 s (renew every 10 s) for margin' },
        { label: 'Acquire + release rate', calc: '20,000 ÷ 40 s = 500 acquires/s + 500 releases/s' },
        { label: 'Renewal rate', calc: '20,000 ÷ 10 s = 2,000 renewals/s' },
        { label: 'Total Redis load', calc: '500 + 500 + 2,000 ≈ 3,000 ops/s ≈ 3% of one shard' },
        { label: 'Crashed holder blocks its job for', calc: 'Up to 30 s (between 20 and 30 s, depending on when it last renewed)' },
        { label: 'No-renewal alternative (TTL = 90 s)', calc: '1% of jobs outlive the lease: 500 starts/s × 1% = 5/s ≈ 432,000 jobs/day run past lease expiry, where a second worker can take them over; a crash blocks for up to 90 s' },
      ],
      answer:
        'A 30 s TTL renewed every 10 s: about 3,000 Redis ops/s (a few percent of one shard), and a crashed holder blocks its job for at most 30 s. A fixed 90 s TTL with no renewal looks simpler but leaves about 5 jobs/s (≈432K/day) running without a valid lease, and triples the crash-recovery delay.',
      insight:
        'The TTL is a trade-off between false expiry (pauses, slow renewals) and recovery time after a crash, so renew short leases instead of guessing a long job duration. Renewal load is tiny. The real residual risk is a pause or Redis failover longer than the slack. That is why the protected resource must still check a fencing token (e.g. a monotonically increasing INCR value stored with the lease).',
      followUps: [
        {
          "q": "A new JVM build shows stop-the-world pauses up to 15 s. Is the 30 s TTL still safe, and what do you change?",
          "a": "No. A holder must survive two missed renewals plus the pause: 2 × 10 s + 15 s = 35 s > 30 s, so a lease can expire under a live holder. Solve 2 × TTL/3 + 15 s < TTL → TTL > 45 s; pick 60 s renewed every 20 s. Renewals drop to 20,000 ÷ 20 = 1,000/s (total ~2,000 ops/s), but crash recovery doubles to up to 60 s. Fencing still covers pauses beyond that, and fixing GC is the better long-term answer."
        },
        {
          "q": "The team scales to 200,000 concurrent jobs with the same durations. Does one Redis shard still hold up?",
          "a": "Starts are 200,000 ÷ 40 s = 5,000/s, releases 5,000/s and renewals 200,000 ÷ 10 s = 20,000/s: ~30K ops/s, about 30% of one shard. It fits, but a failover now drops many leases at once and causes mass takeovers, and lease keys sit in one failure domain. Shard leases by job id across several Redis primaries (hash tags not needed since each lease is a single key) to spread load and limit the blast radius of one failover."
        }
      ],
    },
  ],
  test: [
    {
      id: 'ds-concurrency-mcq-01',
      difficulty: 'hard',
      question:
        'This NestJS handler dedupes coupon redemptions. The service runs as ONE Node process. Two requests for the same coupon arrive within 1 ms. What happens?',
      code: {
        language: 'typescript',
        code: `const redeemed = new Set<string>();

async redeem(couponId: string, userId: string) {
  if (redeemed.has(couponId)) throw new ConflictException();
  const coupon = await this.repo.findOne(couponId);   // ~5 ms DB call
  if (coupon.used) throw new ConflictException();
  redeemed.add(couponId);
  await this.repo.markUsed(couponId, userId);
}`,
      },
      options: [
        'Both can succeed: both pass the Set check, then both await findOne and read used=false before either calls add',
        'Only one succeeds: Node is single-threaded, so the first request finishes before the second starts',
        'Only one succeeds, because Set.add is atomic and the second add throws',
        'Both fail with ConflictException because the first add happens before the second has()',
      ],
      correct: [0],
      explanation:
        'Request A checks the Set, then yields at "await findOne". Request B runs, also finds the Set empty, and also awaits. Both read used=false and both mark it used. Single-threaded means no two lines run simultaneously, not that a sequence spanning awaits is atomic. Set.add never throws, and the add happens after the await, so the "both fail" option is wrong. The real fix is a conditional DB update (UPDATE coupons SET used=true WHERE id=$1 AND used=false), which also works across pods.',
      followUps: [
        {
          "q": "You replace the Set with the conditional `UPDATE coupons SET used = true WHERE id = $1 AND used = false`. Now the business wants each coupon usable 3 times instead of once. How does the statement change, and is it still race-free?",
          "a": "Use a counter with a guard: `UPDATE coupons SET uses = uses + 1 WHERE id = $1 AND uses < 3 RETURNING uses`, and treat rowCount 0 as exhausted. It stays race-free because Postgres takes the row lock and re-evaluates `uses < 3` against the latest committed row before applying each update, so at most 3 succeed. If you also need 'one use per user', add a `coupon_redemptions(coupon_id, user_id)` table with a unique key and insert it in the same transaction."
        },
        {
          "q": "How would you write a test that reliably reproduces the original race instead of hoping two requests collide?",
          "a": "Make the interleaving deterministic: stub `repo.findOne` with a promise you control, start two `redeem` calls, let both reach the await (both have passed the Set check), then resolve both with `used: false`. Assert that `markUsed` was called twice — the test fails on the buggy code. For the DB-level fix, run an integration test firing 50 concurrent requests at a real Postgres with `Promise.all` and assert exactly one success and one row marked used."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-02',
      difficulty: 'expert',
      question: 'What is the most serious flaw in this lock release under production conditions?',
      code: {
        language: 'typescript',
        code: `async function release(key: string, token: string) {
  const current = await redis.get(key);
  if (current === token) {
    await redis.del(key);
  }
}`,
      },
      options: [
        'Comparing tokens is unnecessary because SET NX already guarantees ownership',
        'DEL is slower than UNLINK and blocks Redis for large values',
        'GET and DEL are separate round-trips: the lock can expire and be taken by another client between them, so DEL removes the new owner\'s lock',
        'It leaks memory because the key is never given a TTL',
      ],
      correct: [2],
      explanation:
        'Check-then-act across two commands reintroduces the race the token was meant to prevent: if the TTL expires right after GET, another client acquires, and our DEL wipes their lock. The compare and delete must run atomically in a Lua script (or a Redis 7 function). UNLINK vs DEL is irrelevant for tiny string values. The token comparison is necessary precisely because NX only guarantees ownership at acquire time, and the TTL was set at acquire time, so there is no leak.',
      followUps: [
        {
          "q": "You move compare-and-delete into a Lua script. Your Redis is a primary with an async replica, and the primary fails over right after you acquire. Does the Lua release fix anything there?",
          "a": "No. The SET NX may not have reached the replica before failover, so the promoted replica has no lock key and another client acquires it immediately — two holders, and the Lua release can't help because the race happened at acquire time. Release atomicity fixes 'deleting someone else's lock', not 'lock lost on failover'. For correctness-critical work you still need fencing tokens checked by the resource or idempotent side effects; `WAIT` only narrows the window."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-03',
      difficulty: 'expert',
      question:
        'Client A holds a Redis lock (TTL 30s) protecting writes to a file in object storage. A hits a 45-second stop-the-world GC pause, the lock expires, client B acquires it and writes. A wakes up and writes its stale version. Which mechanism actually prevents the corruption?',
      options: [
        'Switching to Redlock across 5 Redis masters so the lock survives node failures',
        'A watchdog thread in A that renews the lock every 10 seconds',
        'Setting the TTL to 5 minutes so the GC pause never exceeds it',
        'A monotonically increasing token issued with each lock grant, which the storage checks and rejects when it is lower than the highest it has seen',
      ],
      correct: [3],
      explanation:
        'Only fencing tokens enforced by the resource handle the holder that does not know it lost the lock. Redlock addresses Redis node failures, not client pauses, and issues no monotonic token. A renewal watchdog runs in the same paused process, so it also stops during the GC. A longer TTL only moves the threshold (pauses, VM stalls and network delays are unbounded) and slows recovery after real crashes.',
      followUps: [
        {
          "q": "The protected resource is S3, which can't compare fencing tokens. How do you get the same protection?",
          "a": "Push the check somewhere that can do conditional writes. S3 now supports conditional PUTs (`If-Match` on ETag, `If-None-Match`), so write versioned objects and only update the 'current' pointer with a compare-and-swap that includes the token in a metadata store like DynamoDB (`ConditionExpression: token < :t`). Or write each version under a key that includes the token (`file.v{token}`) and have readers pick the highest. The principle: the last hop that performs the write must reject stale holders."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-04',
      difficulty: 'hard',
      question:
        'Postgres at READ COMMITTED, table inventory(sku, qty). Many concurrent checkouts. Select ALL approaches that guarantee qty never drops below zero.',
      options: [
        'UPDATE inventory SET qty = qty - $n WHERE sku = $1 AND qty >= $n, treating rowCount 0 as sold out',
        'SELECT qty ... FOR UPDATE in a transaction, check in app code, then UPDATE ... SET qty = qty - $n before commit',
        'SELECT qty (no lock), check in app code, then UPDATE ... SET qty = qty - $n',
        'A CHECK (qty >= 0) constraint with UPDATE ... SET qty = qty - $n, treating a constraint violation as sold out',
        'Wrapping SELECT then UPDATE in BEGIN/COMMIT without FOR UPDATE',
      ],
      correct: [0, 1, 3],
      explanation:
        'The guarded UPDATE re-checks its predicate after acquiring the row lock, FOR UPDATE serializes the read-check-write, and the CHECK constraint rejects any decrement that would go negative. An unlocked SELECT followed by a relative UPDATE lets two transactions both see qty=1 and both decrement to -1. A plain transaction at READ COMMITTED does not lock rows on SELECT, so wrapping it in BEGIN/COMMIT changes nothing.',
      followUps: [
        {
          "q": "The guarded UPDATE works, but at 5K checkouts/s on one SKU p99 latency climbs. What's actually slow, and what do you change?",
          "a": "All decrements serialise on one row lock, and each holds it until its transaction commits (WAL flush), so throughput is roughly 1/(lock hold time) — a few hundred to a couple of thousand per second. Shorten hold time (do the decrement as the last statement, commit immediately, `synchronous_commit` tuning for this table is risky), or split the counter into N bucket rows and decrement a random bucket with fallback, or put a Redis gate in front so only likely winners reach Postgres."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-05',
      difficulty: 'expert',
      question:
        'Two transactions run this at the same moment on a row with version = 5 (Postgres, READ COMMITTED). T1 commits first. What does T2 get?',
      code: {
        language: 'sql',
        code: `UPDATE documents
SET    body = $1, version = version + 1
WHERE  id = 42 AND version = 5;`,
      },
      options: [
        'T2 also updates the row, because it took its snapshot before T1 committed, so it still sees version = 5',
        'T2 blocks on the row lock until T1 commits, re-evaluates the WHERE against the new row (version = 6), and updates 0 rows',
        'T2 fails immediately with a serialization error (40001)',
        'T2 deadlocks with T1 and one of them is aborted with 40P01',
      ],
      correct: [1],
      explanation:
        'In READ COMMITTED, an UPDATE that finds a row locked by a concurrent writer waits, then re-checks its WHERE clause against the newly committed version (EvalPlanQual). version is now 6, so T2 matches 0 rows and the application sees a conflict. Error 40001 is what REPEATABLE READ/SERIALIZABLE would raise. There is only one lock involved, so no deadlock cycle can form. The stale-snapshot answer describes a plain SELECT, not an UPDATE.',
      followUps: [
        {
          "q": "Run the same scenario at REPEATABLE READ. What does T2 see now, and how should the application handle it?",
          "a": "T2 still blocks on T1's row lock, but after T1 commits Postgres sees the row was modified after T2's snapshot and aborts T2 with SQLSTATE 40001 (could not serialize access) instead of quietly updating 0 rows. The application must catch 40001 and retry the whole transaction from a fresh read, since its snapshot is stale. At READ COMMITTED you get 0 rows and must report a conflict yourself; both outcomes prevent a lost update, but the retry handling differs."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-06',
      difficulty: 'medium',
      question:
        'A ticketing site uses optimistic locking (version column) on a single "remaining seats" row for a concert. At on-sale time, 3,000 users click Buy within a second. What is the most likely outcome?',
      options: [
        'Excellent throughput, because optimistic locking never blocks',
        'Deadlocks between the competing transactions',
        'Overselling, because optimistic locking does not detect conflicting writes',
        'A retry storm: most attempts fail the version check and retry, burning DB capacity and pushing p99 latency to seconds',
      ],
      correct: [3],
      explanation:
        'On a hot row only one CAS succeeds per round, so work grows roughly with N² and latency explodes. Optimistic locking does detect conflicts, so it does not oversell. A single-row version check cannot form a lock cycle, so deadlocks are not the issue. "Never blocks" is true but beside the point: the failed attempts are the cost. A guarded relative decrement or a Redis gate fits here.',
      followUps: [
        {
          "q": "Product insists on optimistic locking for the general case. How do you keep it for normal events but survive the 3,000-click on-sale?",
          "a": "Detect contention and switch strategy: for events marked high-demand, route purchases through a virtual waiting room that admits users at a rate the inventory row can handle, and use a guarded relative decrement (`qty = qty - 1 WHERE qty >= 1`) which needs no retries. Keep optimistic version checks for low-contention edits such as order details. Also cap optimistic retries (e.g. 3 with jittered backoff) and return 'try again' rather than letting retries amplify load."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-07',
      difficulty: 'expert',
      question:
        'Redlock with 5 Redis masters. Client A acquires on nodes 1, 2, 3. Node 3\'s clock jumps forward (NTP step), so A\'s key there expires early. Client B then acquires on nodes 3, 4, 5. Which statement is correct?',
      options: [
        'Unsafe: A and B both believe they hold a majority. Redlock\'s safety depends on timing assumptions like bounded clock drift',
        'Safe: B cannot reach a majority because A still holds nodes 1 and 2',
        'Safe: Redlock uses monotonic clocks on the client, so server clock jumps cannot matter',
        'Unsafe only if nodes 1 and 2 also fail; one clock jump is tolerated by design',
      ],
      correct: [0],
      explanation:
        'Nodes {1,2,3} and {3,4,5} are both majorities; they overlap only on node 3, where A\'s key expired early. This is Kleppmann\'s example: TTL expiry happens on the server clock, so client-side monotonic time does not help. B needs only 3 of 5 nodes, and it has them. Redlock tolerates node crashes, not arbitrary timing faults, which is why correctness-critical locks need fencing or consensus.',
      followUps: [
        {
          "q": "Suppose the team keeps Redlock because it's already deployed. What's the minimum you must add so this clock-jump scenario can't corrupt data?",
          "a": "A fencing check at the resource, generated independently of Redlock since Redlock has no monotonic counter: e.g. each acquire does an atomic increment on a strongly consistent store (a Postgres sequence or etcd revision), and every write carries it with the resource rejecting tokens lower than the last seen. Once you have that, the resource is providing safety and Redlock is only reducing contention, so a single Redis instance would do just as well. Also configure NTP to slew, not step, clocks."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-08',
      difficulty: 'hard',
      question:
        'Two Postgres transactions lock rows in opposite order and form a cycle. deadlock_timeout is the default. What happens?',
      options: [
        'Both wait until lock_timeout (unset by default), so they hang forever',
        'Postgres detects the cycle instantly and rolls back both transactions',
        'After ~1 second one transaction runs deadlock detection, and one is aborted with 40P01 while the other proceeds',
        'The transaction that started later is always chosen as the victim and silently retried by the server',
      ],
      correct: [2],
      explanation:
        'Postgres checks for deadlocks only after a lock wait exceeds deadlock_timeout (default 1s), then aborts one participant with SQLSTATE 40P01. The application must retry it, because Postgres never retries transactions itself. Instant detection with a wait-for graph describes MySQL InnoDB, and even InnoDB rolls back only one victim, not both. Without detection they would hang, but detection is always on.',
      followUps: [
        {
          "q": "Deadlocks happen a few times an hour and each costs a 1 s wait plus a retry. Should you lower `deadlock_timeout` to 100 ms?",
          "a": "Probably not as the main fix. Deadlock detection is expensive (it scans the lock graph), and running it after 100 ms of any ordinary lock wait adds overhead under heavy, non-deadlocking contention. Fix the cause: acquire locks in a consistent order (e.g. sort row IDs before `SELECT ... FOR UPDATE`), keep transactions short, and lock up front. Keep a retry on 40P01 with jittered backoff and alert on the deadlock count in `pg_stat_database` so regressions show up."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-09',
      difficulty: 'expert',
      question:
        'A nightly settlement cron must run exactly once per day. The service has 3 replicas, each running @nestjs/schedule. Select ALL options that actually prevent double settlement.',
      options: [
        'A job_runs table with UNIQUE (job_name, run_date); each replica INSERTs first and only the one whose insert succeeds runs',
        'pg_try_advisory_xact_lock around the job, with the job\'s writes in the same transaction',
        'Adding a random 0–30 second startup delay to each replica\'s cron so they don\'t collide',
        'Running it as a Kubernetes CronJob with concurrencyPolicy: Forbid while ALSO keeping an idempotent run marker, since CronJob can occasionally create two jobs',
        'Checking an in-memory isRunning flag before starting the job',
      ],
      correct: [0, 1, 3],
      explanation:
        'A unique run marker and an advisory lock held for the transaction both make the "who runs" decision atomic in the database. A K8s CronJob plus an idempotent marker covers the documented edge case where two jobs start for one schedule. A random delay only makes collisions rarer, and a long job still overlaps. An in-memory flag is per process, so the 3 replicas each have their own.',
      followUps: [
        {
          "q": "With the UNIQUE (job_name, run_date) marker, the winning replica crashes halfway through settlement. What happens on the next day, and how do you make today's run complete?",
          "a": "The marker row says today's run started, so no other replica retries it, and settlement for today silently stays half done. Add a status and heartbeat to job_runs (`STARTED`, `last_heartbeat`, `COMPLETED`); a supervisor or the next replica can take over a run whose heartbeat is stale by a conditional update that bumps a fencing epoch. The settlement work itself must be resumable and idempotent — process in batches keyed by merchant and mark each batch done — so a takeover continues rather than double-settles."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-10',
      difficulty: 'hard',
      question:
        'Workers claim jobs with "SELECT ... FOR UPDATE SKIP LOCKED", set status=RUNNING, commit, and then process. A worker is OOM-killed mid-job. Select ALL statements that are true.',
      options: [
        'The job stays RUNNING forever unless there is a lease or heartbeat (for example, locked_until) that makes it claimable again',
        'Postgres automatically re-queues the job because the worker\'s row lock is released when its connection dies',
        'Once leases exist, a slow but alive worker can have its job re-claimed by another worker, so processing must be idempotent',
        'SKIP LOCKED guarantees exactly-once processing across crashes',
      ],
      correct: [0, 2],
      explanation:
        'The row lock was released at the claim commit, so Postgres has no idea the job is in progress; only the status column says RUNNING. A lease with expiry recovers it. It also creates the SQS-visibility-timeout problem: a slow worker can be overtaken, so handlers must be idempotent and completion should be conditional on locked_by. SKIP LOCKED only prevents concurrent claims of locked rows; it says nothing about exactly-once.',
      followUps: [
        {
          "q": "You add `locked_until = now() + 5 min`. A job legitimately takes 12 minutes. What happens, and how do you fix it without making crash recovery slow?",
          "a": "After 5 minutes another worker reclaims it, so two workers process the same job and the first one's completion may overwrite the second's. Have the worker heartbeat: extend `locked_until` every minute with `UPDATE ... WHERE id = $1 AND locked_by = $me`, and abort if that returns 0 rows because it lost the job. Crash recovery stays ~5 minutes while long jobs survive. Completion must also be conditional on `locked_by`, and side effects idempotent."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-11',
      difficulty: 'hard',
      question:
        'orders.idempotency_key has a UNIQUE index. Two requests with the same key run this concurrently in separate transactions (Postgres). T1 has inserted but not committed yet. What does T2 experience?',
      code: {
        language: 'sql',
        code: `INSERT INTO orders (idempotency_key, user_id, amount)
VALUES ($1, $2, $3)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;`,
      },
      options: [
        'T2 inserts a duplicate, because T1\'s row is not yet visible to T2\'s snapshot',
        'T2 waits for T1 to finish. If T1 commits, T2 does nothing and returns 0 rows. If T1 rolls back, T2 inserts its row',
        'T2 immediately returns 0 rows without waiting',
        'T2 fails with a unique_violation error (23505)',
      ],
      correct: [1],
      explanation:
        'Unique index checks look at in-progress inserts, not just the snapshot, so T2 blocks on T1\'s transaction. On commit, the conflict resolves to DO NOTHING (0 rows, so T2 should read and replay the stored result). On rollback, the slot is free and T2 inserts. That is why unique constraints are a safe atomic check-then-act. A 23505 error occurs only without ON CONFLICT, and a duplicate is impossible with a unique index.',
      followUps: [
        {
          "q": "T2 returns 0 rows because T1 committed. What should T2 send back to the client, and what if T1 is still processing payment?",
          "a": "T2 should look up the stored row and replay T1's result — same order id, same status code — so the retry looks identical to the original. If T1 is still in progress (status `PROCESSING`), return 409 or 202 with a 'request in progress, retry later' signal rather than starting a second payment. Store the response body and status with the key once T1 finishes, and also store a hash of the request so a reused key with different parameters is rejected with 422."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-12',
      difficulty: 'medium',
      question:
        'A handler does BEGIN, then SELECT the wallet row FOR UPDATE, calls a fraud-check HTTP API (p99 3s), then UPDATEs and COMMITs. What is the most likely production symptom during a traffic spike on popular wallets?',
      options: [
        'Requests queue behind the row lock while each waiter pins a pool connection, leading to pool exhaustion and timeouts on unrelated endpoints',
        'Faster requests, because the lock prevents conflicting retries',
        'Deadlocks on every request because HTTP calls release row locks',
        'Lost updates, because FOR UPDATE does not block other UPDATEs',
      ],
      correct: [0],
      explanation:
        'The lock is held for the whole 3-second external call, so every other writer to that wallet waits while holding a connection. The pool drains and unrelated endpoints fail too. HTTP calls do not affect DB locks, and a single lock cannot produce a cycle. FOR UPDATE does block other UPDATEs, so there is no lost update. Move the external call outside the transaction and re-validate with a conditional update afterward.',
      followUps: [
        {
          "q": "You move the fraud call outside the transaction. Between the fraud check and the UPDATE, the wallet balance changes. How do you keep correctness?",
          "a": "Re-validate in the write: `UPDATE wallets SET balance = balance - $amt, version = version + 1 WHERE id = $1 AND balance >= $amt AND version = $v`. If the version changed, decide whether the fraud verdict still applies — for most cases rerun only the balance check (the guard already does), and only rerun fraud if the risk inputs changed materially. Pass an idempotency key to the fraud API so retries are cheap, and hold a short `RESERVED` hold instead of a row lock if you need the funds pinned."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-13',
      difficulty: 'expert',
      question:
        'A service holds an etcd lease-based lock (TTL 10s). Its network to etcd is partitioned, but it can still reach the database. Which statement is correct?',
      options: [
        'The lock is held until the partition heals, because etcd cannot revoke a lease from a client it cannot reach',
        'The lease is revoked instantly when the TCP connection drops',
        'etcd\'s Raft consensus guarantees that the partitioned client stops immediately, so fencing is unnecessary with etcd',
        'etcd expires the lease after ~10s without keepalives and another client can acquire it. The partitioned client keeps running until its own keepalive failure is noticed, so writes still need a fencing token',
      ],
      correct: [3],
      explanation:
        'Leases expire server-side after TTL without keepalives, and consensus makes that grant decision linearizable. However, the old holder learns about it only when its keepalives fail, and a paused process may not notice at all. Consensus gives you a correct lock service, not a well-behaved client, so fencing tokens (for example, the key\'s revision) are still needed. Revocation is TTL-based, not triggered by the connection dropping.',
      followUps: [
        {
          "q": "Which number from etcd do you use as the fencing token, and how does the database enforce it?",
          "a": "Use the lock key's create revision (`mod_revision`/`create_revision` returned when the lock key is created). etcd revisions are cluster-wide and strictly increasing, so a later holder always has a larger one. The database keeps the highest token seen per resource and writes conditionally: `UPDATE resource SET data = $d, fence = $t WHERE id = $1 AND fence <= $t`. A zero-row result means a newer holder exists, and the stale writer must stop and exit."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-14',
      difficulty: 'expert',
      question:
        'MySQL InnoDB, REPEATABLE READ. The users table has a unique index on email. Two sign-ups for the same NEW email run this concurrently. What typically happens?',
      code: {
        language: 'sql',
        code: `START TRANSACTION;
SELECT id FROM users WHERE email = 'a@x.io' FOR UPDATE;  -- returns no row
INSERT INTO users (email) VALUES ('a@x.io');
COMMIT;`,
      },
      options: [
        'The second SELECT blocks until the first commits, then sees the row and skips the insert',
        'Both inserts succeed and create duplicate emails, because FOR UPDATE on a missing row locks nothing',
        'Both SELECTs take compatible gap locks on the empty range. Each INSERT then waits on the other\'s gap lock, InnoDB detects a deadlock and rolls one back (error 1213)',
        'The second INSERT fails immediately with a duplicate-key error before any waiting',
      ],
      correct: [2],
      explanation:
        'Locking reads on a non-existent key take gap/next-key locks, and gap locks do not conflict with each other, so both SELECTs succeed. Each INSERT needs an insert-intention lock that conflicts with the other transaction\'s gap lock, creating a cycle, and InnoDB picks a victim (1213). The unique index prevents duplicates regardless. The robust pattern is a plain INSERT that handles the duplicate-key error, or INSERT ... ON DUPLICATE KEY, without the locking SELECT.',
      followUps: [
        {
          "q": "You drop the locking SELECT and just INSERT, catching duplicate-key errors. Under heavy sign-up traffic, is there still any deadlock or performance risk?",
          "a": "Far less. Two concurrent INSERTs of the same email: the second waits on the first's uncommitted index entry, then gets duplicate-key (1062) or succeeds if the first rolled back — no cycle. Remaining risks: if the same transaction inserts several unique keys in different orders, cross-key deadlocks can still occur, so keep sign-up to one insert per transaction. INSERT ... ON DUPLICATE KEY UPDATE takes next-key locks too, so prefer the plain INSERT and handle 1062 in the application."
        }
      ],
    },
    {
      id: 'ds-concurrency-mcq-15',
      difficulty: 'medium',
      question:
        'A Node login service uses async crypto.pbkdf2 (about 100 ms CPU each). At 200 concurrent logins on one pod, login latency climbs to several seconds but event-loop lag stays low. What is the best explanation?',
      options: [
        'The event loop is blocked by pbkdf2, so all requests wait',
        'Async pbkdf2 runs on the libuv thread pool, which defaults to 4 threads, so 200 hashes queue behind 4 workers (~50 rounds × 100 ms)',
        'Node is single-threaded, so it can only compute one hash at a time',
        'Postgres connection pool exhaustion is delaying the user lookup',
      ],
      correct: [1],
      explanation:
        'Low event-loop lag rules out a blocked main thread, which points at the libuv pool (default size 4) serializing the CPU work: 200 ÷ 4 × 100 ms ≈ 5 s. Fixes are raising UV_THREADPOOL_SIZE toward the core count, scaling pods, or running a worker_threads pool. "Only one hash at a time" ignores the thread pool. Pool exhaustion would show up in DB wait metrics, and nothing here suggests it.',
      followUps: [
        {
          "q": "You set UV_THREADPOOL_SIZE=8 on an 8-core pod. What latency and throughput do you get at 200 concurrent logins, and what's the real fix?",
          "a": "The pool now runs 8 hashes in parallel: 200 ÷ 8 × 100 ms ≈ 2.5 s for the last one. Throughput is capped by CPU at ~8 ÷ 0.1 s = 80 logins/s per pod, no matter the pool size; going beyond core count just time-slices. The real fixes: add pods (or a dedicated auth service) sized for peak login rate, rate-limit login per IP/user, and tune the KDF cost to your latency budget. Also note the thread pool is shared with fs and DNS, so they queue behind hashing."
        }
      ],
    },
  ],
};

export default topic;
