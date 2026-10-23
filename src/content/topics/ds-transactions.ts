import type { Topic } from '../../types';

const topic: Topic = {
  id: 'ds-transactions',
  phase: 'distributed',
  order: 3,
  title: 'Idempotency, Distributed Transactions, 2PC & Sagas',
  subtitle:
    'Keeping money and orders correct across services: idempotency keys on both sides of every hop, 2PC and why it blocks, TC/C, sagas with compensations, transactional outbox + CDC, inbox dedup, the exactly-once illusion, and reconciliation.',
  estimatedMinutes: 100,
  sources: [
    'Chris Richardson — Microservices Patterns (Saga, Transactional Outbox)',
    'Martin Kleppmann — Designing Data-Intensive Applications, Ch 9 & 11',
    'Garcia-Molina & Salem — Sagas (1987)',
    'Stripe API docs — Idempotent requests',
    'Apache Kafka docs — Idempotent producer & transactions (KIP-98)',
    'Mastering API Architecture — Ch on reliable API design',
  ],
  tags: ['idempotency', '2pc', '3pc', 'tcc', 'saga', 'outbox', 'inbox', 'cdc', 'exactly-once', 'reconciliation', 'payments'],
  cheatSheet: [
    'A timeout is an UNKNOWN outcome, not a failure. Every retried operation must be idempotent, or retries create duplicates (double charges, double orders).',
    'API idempotency: client sends Idempotency-Key; server atomically inserts (key, request hash) FIRST, runs the operation, stores the response; replays return the stored response; same key + different body → 422; concurrent same key → 409.',
    'Consumer idempotency (inbox): record message_id in a processed table in the SAME transaction as the side effect; unique constraint dedups. Dedup window ≥ max redelivery/replay horizon.',
    'Exactly-once delivery doesn\'t exist end-to-end; exactly-once EFFECT = at-least-once delivery + idempotent processing.',
    '2PC: prepare (vote) → commit/abort. Atomic, but BLOCKING: if the coordinator dies after participants vote yes, they hold locks in-doubt until it recovers. OK inside one DB/vendor; poor across microservices.',
    'TC/C: Try reserves resources (business-level), Confirm/Cancel finalise. Each phase is a separate local txn; must handle idempotent confirm/cancel, empty rollback, and hanging (cancel before try).',
    'Saga: sequence of local transactions + compensating actions. No isolation (others see intermediate states) → use semantic locks (PENDING states), put the pivot step late, make compensations idempotent and retryable.',
    'Choreography = services react to events (simple, hard to see/trace). Orchestration = a coordinator state machine drives steps (explicit, testable, preferred for >3 steps or money).',
    'Transactional outbox: write business row + event row in ONE local txn; a relay (poller with SKIP LOCKED or Debezium CDC) publishes. Eliminates the dual-write problem; delivery is at-least-once, so consumers dedupe.',
    'Reconciliation is the last line of defence: compare internal ledger vs PSP/bank settlement files daily; classify mismatches; auto-fix known classes, route the rest to finance ops.',
  ],
  sections: [
    {
      heading: 'Why distributed correctness is hard: the unknown outcome',
      body: `**Intuition:** you mail a cheque and hear nothing back. Did it get lost on the way? Was it cashed and the receipt lost? You can't tell — and if you send another cheque you might pay twice.

Every remote call has three outcomes, not two: **success**, **failure**, and **unknown** (timeout, connection reset, 502 from a proxy, process crash after sending). For the unknown case:

| What actually happened | Caller sees | Naive retry causes |
|---|---|---|
| Request never arrived | Timeout | Correct single execution |
| Request processed, response lost | Timeout | **Duplicate** (double charge) |
| Request still processing (slow) | Timeout | **Concurrent duplicate** |
| Processed, then server crashed before commit | 500/timeout | Correct re-execution |

Retries are unavoidable (clients, SDKs, gateways, service meshes, Kafka consumers all retry), so the system must make **repeated execution safe**. That is idempotency: \`f(f(x)) = f(x)\` — executing a request N times has the same effect as once.

**Where duplicates come from in practice:** mobile clients retrying on flaky networks, users double-clicking "Pay", API gateway/mesh automatic retries, at-least-once message delivery (Kafka consumer rebalance before offset commit, SQS visibility timeout), cron jobs rerun after a partial failure, and operators replaying a dead-letter queue.

**Across services** there is no shared transaction: the order DB, the payment provider and the inventory service each commit independently. The toolbox, in order of preference:
1. **Avoid the distributed transaction** — redesign so one service/DB owns the invariant (co-locate data, see *db-sharding*).
2. **Idempotency + retries** for single remote side effects.
3. **Outbox/inbox** so local state changes and messages are atomic.
4. **Sagas** (or TC/C) for multi-step business transactions with compensation.
5. **2PC** only within a single trusted system (one DB engine, one vendor's XA) where blocking is acceptable.
6. **Reconciliation** to catch whatever slips through.`,
      diagram: `Client ──POST /pay──▶ API ──charge──▶ PSP
   │                  │               │ ✓ charged
   │                  │◀──── ✗ response lost (network) ───┘
   │◀── 504 timeout ──┘
   │
   └── retry POST /pay ──▶ without idempotency: CHARGED TWICE
                           with Idempotency-Key: return stored result`,
      keyPoints: [
        'Timeouts mean unknown outcome; retries are inevitable.',
        'Idempotency makes N executions equal one.',
        'Prefer eliminating distributed transactions; then idempotency, outbox, sagas; 2PC last.',
      ],
    },
    {
      heading: 'Idempotency keys on the API side',
      body: `**Intuition:** the client writes a unique serial number on each request ("this is payment attempt #abc"). The server keeps a ledger of serial numbers it has already handled and, for repeats, hands back the original receipt instead of doing the work again.

**Protocol (Stripe-style):**
1. Client generates a **UUID per logical operation** (per checkout attempt, not per HTTP attempt) and sends \`Idempotency-Key: <uuid>\` on every retry. Stripe keeps keys for **at least 24 hours**.
2. Server, **before doing any work**, atomically inserts \`(key, scope=merchant/user, request_hash, status='IN_PROGRESS')\`. A **unique constraint** is the concurrency control — never "SELECT then INSERT".
3. If the insert conflicts:
   - existing row **COMPLETED** with the same request hash → return the stored status code + body (replay);
   - same key, **different request hash** → \`422\` (client bug: key reuse);
   - existing row **IN_PROGRESS** → \`409 Conflict\` (a concurrent duplicate is running; client retries later). If it's been in progress too long (crashed worker), a recovery process resumes or fails it.
4. Execute the operation; **downstream calls reuse a derived key** (e.g. \`pay_<key>\` to the PSP) so the whole chain is idempotent.
5. Store the final response and mark COMPLETED — ideally in the **same DB transaction** as the business write, so "done but not recorded" can't happen.

**Design details interviewers probe:**
- **Scope keys** by client/merchant to prevent cross-tenant collisions.
- **Which responses to cache?** Cache successes and deterministic failures (validation 4xx, card declined). Don't cache transient 5xx/timeouts — let the retry try again.
- **Natural idempotency** is even better: \`PUT /orders/{clientOrderId}\`, or a unique constraint on \`(merchant_id, merchant_order_ref)\`.
- **Retention**: key TTL ≥ the longest client retry window; purge with a time-partitioned table.
- **GraphQL/NestJS**: implement as an interceptor for mutations, keyed by a header or an \`idempotencyKey\` argument.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS idempotency interceptor backed by Postgres (insert-first, unique key)',
          code: `import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor,
  UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { Observable, from, of, lastValueFrom } from 'rxjs';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: Pool) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const key: string | undefined = req.headers['idempotency-key'];
    if (!key) return next.handle(); // or reject for money-moving endpoints
    const scope = req.user.merchantId;
    const hash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

    // 1) Claim the key atomically. Unique (scope, key) is the lock.
    const claim = await this.db.query(
      'INSERT INTO idempotency_keys (scope, key, request_hash, status, created_at) ' +
      "VALUES ($1, $2, $3, 'IN_PROGRESS', now()) ON CONFLICT (scope, key) DO NOTHING RETURNING key",
      [scope, key, hash]);

    if (claim.rowCount === 0) {
      const { rows: [row] } = await this.db.query(
        'SELECT request_hash, status, response_code, response_body FROM idempotency_keys WHERE scope = $1 AND key = $2',
        [scope, key]);
      if (row.request_hash !== hash) throw new UnprocessableEntityException('Idempotency-Key reused with a different body');
      if (row.status === 'IN_PROGRESS') throw new ConflictException('Request with this key is in progress');
      res.status(row.response_code);
      return of(row.response_body); // 2) Replay the original result
    }

    try {
      const body = await lastValueFrom(next.handle()); // 3) Execute once
      await this.db.query(
        "UPDATE idempotency_keys SET status = 'COMPLETED', response_code = $3, response_body = $4 WHERE scope = $1 AND key = $2",
        [scope, key, res.statusCode, JSON.stringify(body)]);
      return from([body]);
    } catch (err: any) {
      if (err?.status && err.status < 500) { // deterministic failure: cache it
        await this.db.query(
          "UPDATE idempotency_keys SET status = 'COMPLETED', response_code = $3, response_body = $4 WHERE scope = $1 AND key = $2",
          [scope, key, err.status, JSON.stringify(err.response ?? { message: err.message })]);
      } else { // transient: release the key so a retry can run again
        await this.db.query('DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2', [scope, key]);
      }
      throw err;
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Insert the key first under a unique constraint; never check-then-insert.',
        'Same key + different body → 422; in-progress → 409; completed → replay stored response.',
        'Propagate derived keys downstream (PSP) so the whole chain is idempotent.',
      ],
      source: 'Stripe API docs — Idempotent requests',
    },
    {
      heading: 'Consumer-side idempotency: the inbox pattern and dedup windows',
      body: `**Intuition:** a message queue is a postman who sometimes delivers the same letter twice. The recipient keeps a list of letter IDs already opened and ignores repeats.

**Why duplicates arrive:** at-least-once delivery is the norm. A Kafka consumer processes a batch, crashes before committing offsets → the batch is redelivered after rebalance. SQS redelivers when the visibility timeout expires during slow processing. Producers retry sends. Outbox relays republish after a crash.

**Inbox pattern:** the consumer, in the **same local transaction** as its side effect, inserts the message ID into a \`processed_messages\` (inbox) table with a unique constraint. If the insert conflicts, the message was already handled → skip. Because the dedup record and the effect commit atomically, a crash either keeps both or neither.

**Choosing the dedup key:** a producer-assigned **event ID** (UUID/ULID), or a business key (\`payment_id + event_type\`). Don't use Kafka offsets alone — a republished event gets a new offset.

**Dedup window:** how long you remember IDs. It must exceed the longest time a duplicate can arrive: consumer lag + max redelivery delay + any manual replay horizon (DLQ replays days later!). Typical: 7–30 days in a time-partitioned table (drop old partitions), or keep forever for money events. Redis \`SET key NX EX\` works for short windows but isn't atomic with a DB side effect — fine for "send email once-ish", not for ledgers.

**Alternatives to a dedup table:**
- **Naturally idempotent effects:** \`UPSERT\` by business key, "set status = SHIPPED" instead of "toggle".
- **Version/sequence checks:** apply an event only if \`event.version = current.version + 1\` (also enforces order per entity).
- **Kafka idempotent producer** (\`enable.idempotence=true\`, default since Kafka 3.0): broker dedups *producer retries* using producer ID + sequence number per partition. It does **not** dedupe application-level resends or consumer reprocessing.`,
      code: [
        {
          language: 'typescript',
          title: 'Kafka consumer with an inbox table: dedup + side effect in one transaction',
          code: `import { Kafka } from 'kafkajs';
import { Pool } from 'pg';

const db = new Pool({ max: 10 });
const consumer = new Kafka({ brokers: ['kafka:9092'] }).consumer({ groupId: 'ledger-writer' });

export async function start(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: 'payments.captured' });
  await consumer.run({
    autoCommit: false,                              // commit offsets only after DB commit
    eachMessage: async ({ topic, partition, message }) => {
      const evt = JSON.parse(message.value!.toString()) as
        { eventId: string; paymentId: string; merchantId: string; amount: number; currency: string };
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const dedup = await client.query(
          'INSERT INTO inbox (consumer, event_id, received_at) VALUES ($1, $2, now()) ' +
          'ON CONFLICT DO NOTHING', ['ledger-writer', evt.eventId]);
        if (dedup.rowCount === 1) {
          // Double-entry: debit PSP clearing, credit merchant payable — same txn as the inbox row
          await client.query(
            'INSERT INTO ledger_entries (payment_id, account, direction, amount, currency) VALUES ' +
            "($1, 'psp_clearing', 'DEBIT', $2, $3), ($1, 'merchant:' || $4, 'CREDIT', $2, $3)",
            [evt.paymentId, evt.amount, evt.currency, evt.merchantId]);
        }                                             // else: duplicate, effect already applied
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;                                      // no offset commit -> redelivered -> deduped
      } finally {
        client.release();
      }
      await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
    },
  });
}
// inbox: PRIMARY KEY (consumer, event_id); partitioned by received_at, drop partitions older than 30 days`,
        },
      ],
      keyPoints: [
        'Inbox row and side effect in one local transaction; unique constraint dedups.',
        'Dedup window must cover consumer lag, redelivery and manual replays.',
        'Kafka idempotent producer only dedups producer retries, not reprocessing.',
      ],
    },
    {
      heading: 'Two-phase commit (2PC) — and why it blocks',
      body: `**Intuition:** a wedding officiant asks both partners "do you?" (prepare). Only if both say yes does the officiant declare them married (commit). Once you've said "I do", you can't leave the altar until the officiant speaks — even if the officiant faints.

**Protocol:**
1. **Prepare:** the coordinator sends PREPARE to all participants. Each participant durably writes everything needed to commit (redo/undo, locks held) and votes **YES** (promise: "I can commit no matter what") or **NO**.
2. **Decision:** if all vote YES, the coordinator durably logs COMMIT, then sends COMMIT to all; if any votes NO or times out, it logs and sends ABORT.
3. Participants apply the decision, release locks, and ack. The coordinator retries the decision until all acks arrive.

**The blocking problem:** after a participant votes YES it is **in doubt** — it cannot commit or abort on its own. If the coordinator crashes before sending the decision, participants **hold their locks** until the coordinator recovers (minutes to hours), blocking any other transaction touching those rows. A participant can't ask peers either, because the coordinator may have decided COMMIT and told nobody yet.

**Other costs:** 2+ round trips and several fsyncs per transaction; the slowest participant sets the latency; throughput limited by locks held across the network; all participants must speak the same protocol (XA). Across microservices owned by different teams (and third parties like a PSP that can't "prepare"), 2PC is usually infeasible.

**Where 2PC is fine:** inside a single distributed database (Spanner/CockroachDB/YugabyteDB run 2PC over *replicated* consensus groups, so the coordinator doesn't disappear), Kafka transactions (a transaction coordinator writes markers to partitions), XA between a DB and a message broker in legacy Java EE stacks.

**3PC** adds a pre-commit phase so participants can decide without the coordinator under *synchronous* assumptions (bounded delays, no partitions). With network partitions it can still violate safety, so it's almost never used; real systems instead make the coordinator highly available via consensus.

**Postgres note:** \`PREPARE TRANSACTION 'id'\` / \`COMMIT PREPARED 'id'\` exist but require \`max_prepared_transactions > 0\` (default 0); orphaned prepared transactions hold locks and block VACUUM — monitor \`pg_prepared_xacts\`.`,
      diagram: `Coordinator            Participant A (orders)      Participant B (inventory)
    │── PREPARE ───────────────▶│                            │
    │── PREPARE ─────────────────────────────────────────────▶│
    │◀──────────── YES (locks held, in doubt) ──│            │
    │◀──────────────────────────────── YES (locks held, in doubt) ──│
    │ log COMMIT (durable)                                          │
    ╳  coordinator crashes here                                     │
                             │ in doubt: can't commit,     │ in doubt: rows
                             │ can't abort, locks held ... │ locked ...
    (recovers) ── COMMIT ───▶│── ack                       │
               ── COMMIT ────────────────────────────────▶│── ack`,
      code: [
        {
          language: 'sql',
          title: 'Postgres 2PC primitives and finding in-doubt transactions',
          code: `-- postgresql.conf: max_prepared_transactions = 100   (default 0 = disabled)

-- Participant, phase 1: do the work, then persist a "YES" vote
BEGIN;
UPDATE inventory SET reserved = reserved + 1 WHERE sku = 'SKU-42' AND available - reserved >= 1;
PREPARE TRANSACTION 'order-9f2c:inventory';   -- survives crashes; locks stay held

-- Participant, phase 2 (on coordinator's decision)
COMMIT PREPARED 'order-9f2c:inventory';
-- or: ROLLBACK PREPARED 'order-9f2c:inventory';

-- Operations: in-doubt transactions older than 5 minutes are an incident
SELECT gid, prepared, owner, database, now() - prepared AS age
FROM pg_prepared_xacts
WHERE now() - prepared > interval '5 minutes'
ORDER BY prepared;`,
        },
      ],
      keyPoints: [
        'Atomic across participants, but blocking: YES voters wait for the coordinator.',
        'In-doubt participants hold locks; coordinator availability is critical.',
        'Good inside one distributed DB with replicated coordinators; poor across microservices and third parties.',
      ],
      source: 'DDIA Ch 9',
    },
    {
      heading: 'TC/C: Try-Confirm/Cancel',
      body: `**Intuition:** booking a trip — you place *holds* on the flight and the hotel (Try). If both holds succeed you confirm both; if either fails you release the other hold. Nobody locks database rows across the network; the "lock" is a business-level reservation.

**Phases (each is an independent local transaction in its service):**
- **Try:** check business rules and **reserve** resources (freeze ₹500 in the wallet, reserve 1 unit of stock). Visible as a reservation, not a final change.
- **Confirm:** turn the reservation into the real change (debit the frozen amount). Must succeed if Try succeeded — so it is retried until it does.
- **Cancel:** release the reservation. Also retried until it succeeds.

**TC/C vs 2PC:** both are two-phase, but 2PC's phases are at the *database* level (locks held, in-doubt state inside the DB), whereas TC/C phases are at the *application/business* level — each phase commits locally, so there are no long DB locks and no blocking of unrelated transactions. The price: every service must implement three operations, and the coordinator must persist progress to drive Confirm/Cancel after crashes (the classic wallet design uses a phase status table).

**Three classic TC/C anomalies (must handle):**
1. **Idempotent Confirm/Cancel:** the coordinator retries, so Confirm/Cancel will be called more than once.
2. **Empty rollback:** Cancel arrives for a Try that never executed (the Try request was lost/timed out) → record "cancelled" and return success without releasing anything.
3. **Hanging / out-of-order:** Cancel is processed *before* a delayed Try arrives → the late Try must be **rejected**, otherwise it reserves resources forever. This is the out-of-order execution problem, solved by recording the cancel first.

The usual implementation: a per-participant \`tcc_branch(xid, state)\` table where states move TRYING → CONFIRMED | CANCELLED, updated with conditional transitions.`,
      code: [
        {
          language: 'typescript',
          title: 'Wallet participant: idempotent Try/Confirm/Cancel with empty-rollback and anti-hanging',
          code: `import type { Pool } from 'pg';

// tcc_branch(xid PK, state TEXT CHECK (state IN ('TRIED','CONFIRMED','CANCELLED')), account_id, amount)
export class WalletTcc {
  constructor(private db: Pool) {}

  async try(xid: string, accountId: string, amount: number): Promise<boolean> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      // Anti-hanging: if Cancel already ran (row exists as CANCELLED), this insert is a no-op
      const ins = await c.query(
        "INSERT INTO tcc_branch (xid, state, account_id, amount) VALUES ($1, 'TRIED', $2, $3) " +
        'ON CONFLICT (xid) DO NOTHING', [xid, accountId, amount]);
      if (ins.rowCount === 0) { await c.query('ROLLBACK'); return false; } // duplicate or late Try
      const frozen = await c.query(
        'UPDATE wallets SET available = available - $2, frozen = frozen + $2 ' +
        'WHERE account_id = $1 AND available >= $2', [accountId, amount]);
      if (frozen.rowCount === 0) { await c.query('ROLLBACK'); return false; } // insufficient funds
      await c.query('COMMIT');
      return true;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  async confirm(xid: string): Promise<void> {
    // Conditional transition makes it idempotent: second call updates 0 rows
    await this.db.query(
      'WITH b AS (UPDATE tcc_branch SET state = $2 WHERE xid = $1 AND state = $3 RETURNING account_id, amount) ' +
      'UPDATE wallets w SET frozen = w.frozen - b.amount FROM b WHERE w.account_id = b.account_id',
      [xid, 'CONFIRMED', 'TRIED']);
  }

  async cancel(xid: string): Promise<void> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      // Empty rollback: Try never arrived -> leave a CANCELLED marker (blocks a late Try)
      await c.query(
        "INSERT INTO tcc_branch (xid, state, account_id, amount) VALUES ($1, 'CANCELLED', NULL, 0) " +
        'ON CONFLICT (xid) DO NOTHING', [xid]);
      await c.query(
        'WITH b AS (UPDATE tcc_branch SET state = $2 WHERE xid = $1 AND state = $3 RETURNING account_id, amount) ' +
        'UPDATE wallets w SET available = w.available + b.amount, frozen = w.frozen - b.amount ' +
        'FROM b WHERE w.account_id = b.account_id', [xid, 'CANCELLED', 'TRIED']);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
}`,
        },
      ],
      keyPoints: [
        'Try reserves at the business level; Confirm/Cancel finalise; each phase is a local txn.',
        'Handle idempotent Confirm/Cancel, empty rollback, and hanging (late Try after Cancel).',
        'No DB locks across the network, but three operations per participant and a durable coordinator.',
      ],
    },
    {
      heading: 'Sagas: long-lived transactions with compensations',
      body: `**Intuition:** instead of one big all-or-nothing transaction, do a series of small committed steps. If step 4 fails, run "undo" actions for steps 3, 2, 1 in reverse. It's how a travel agent unwinds a trip: cancel the hotel, refund the flight.

A **saga** (Garcia-Molina & Salem, 1987) is a sequence of local transactions T1…Tn, each with a **compensating transaction** C1…Cn-1. Either all Ti commit, or T1…Tk commit followed by Ck…C1. Guarantees are **ACD without I**: intermediate states are visible to others.

**Step types (Richardson):**
- **Compensatable** steps (before the pivot): can be undone — create order PENDING, reserve inventory.
- **Pivot** step: the point of no return — capture payment. If it succeeds, the saga must complete.
- **Retriable** steps (after the pivot): must eventually succeed and are retried (idempotently) — mark order CONFIRMED, send email, schedule shipping.

**Compensation is semantic, not a rollback:** you can't un-send an email; you send a correction. A refund is a *new* ledger entry, not deletion of the charge. Compensations must be **idempotent**, **retryable forever** (a failing compensation is an incident, not a stop), and tolerant of running when the forward step never happened.

**Dealing with the missing isolation (countermeasures):**
- **Semantic lock:** status fields like \`PENDING\` / \`APPROVAL_PENDING\` that other operations respect (can't ship a PENDING order).
- **Commutative updates:** design increments/decrements that commute (credit/debit) so interleaving is safe.
- **Reread value / version check** before a later step acts on earlier-read data.
- **Order steps by risk:** put the steps most likely to fail (validation, stock) first and the hard-to-compensate step (payment capture) last, as the pivot.

**Choreography vs orchestration:**

| | Choreography (events) | Orchestration (coordinator) |
|---|---|---|
| Control | Each service reacts to others' events | Central state machine sends commands, awaits replies |
| Coupling | Services know each other's events | Services know only the orchestrator's commands |
| Visibility | Flow is implicit, spread across services | Flow explicit in one place; easy to query state |
| Failure handling | Compensation logic scattered | Centralised; timeouts, retries, compensations in one place |
| Good for | 2–3 steps, simple flows | Money, >3 steps, complex branching |
| Tools | Kafka topics + outbox | Temporal, AWS Step Functions, Camunda, homegrown state machine + outbox |

**2PC vs TC/C vs Saga summary:**

| | 2PC | TC/C | Saga |
|---|---|---|---|
| Atomicity | Yes | Yes (eventually) | Yes (eventually, via compensation) |
| Isolation | Yes (locks) | Partial (reservations) | No (semantic locks) |
| Blocking | Yes, on coordinator failure | No DB locks; reservations held | No |
| Participant work | XA support | Try + Confirm + Cancel | Action + compensation |
| Latency | Low for short txns, locks held | 2 phases of calls | Steps sequential; long-running OK |
| Typical use | Single distributed DB, legacy XA | Wallets, reservations, fund freezes | Order/checkout, travel booking, onboarding |`,
      diagram: `ORCHESTRATED CHECKOUT SAGA (orchestrator state persisted per step)

 T1 create order (PENDING)      C1: cancel order
   ▼
 T2 reserve stock               C2: release stock
   ▼
 T3 authorise + capture pay     ◀── PIVOT (point of no return)
   ▼
 T4 confirm order               retriable (never compensated)
   ▼
 T5 create shipment             retriable

 failure at T3 (card declined) → run C2, then C1
 failure at T4/T5 → retry until success; never refund automatically`,
      keyPoints: [
        'Saga = local transactions + compensations; no isolation.',
        'Compensatable → pivot → retriable; compensations are semantic, idempotent and retried forever.',
        'Orchestrate money flows; choreograph only short, simple ones.',
      ],
      source: 'Garcia-Molina & Salem (1987); Richardson — Microservices Patterns',
    },
    {
      heading: 'Implementing an orchestrated saga as a persisted state machine',
      body: `**Intuition:** the orchestrator is a checklist that lives in the database. After a crash, whoever picks it up reads the checklist and continues from the last ticked box — so every step must be safe to run twice.

**Implementation rules:**
1. **Persist state before and after every step** (saga_id, current step, status, step results). The orchestrator process is stateless; any replica can resume a saga.
2. **Commands carry deterministic idempotency keys** (\`saga_id:step\`) so a resumed saga re-sending a command doesn't duplicate its effect.
3. **Send commands via the outbox** (same transaction as the state change) or call synchronously with retries and idempotency — never "update state, then call" without one of those.
4. **Timeouts are failures with unknown outcome:** a timed-out step is **retried** (idempotently) or its outcome queried, *not* blindly compensated — compensating a step that actually succeeded is fine only if compensations are designed for it.
5. **Compensate in reverse order** of completed steps; retry compensations with backoff; alert and park in a manual queue after N attempts.
6. **Observability:** one row per saga makes "where is order X?" a simple query; export metrics per step (latency, failure, compensation rate).

Frameworks like **Temporal** give you this durably (workflow code replayed from event history, activities retried with idempotency keys) — a strong answer in interviews if you explain what it's doing underneath.`,
      code: [
        {
          language: 'typescript',
          title: 'Checkout saga orchestrator: persisted steps, idempotent commands, reverse compensation',
          code: `import type { Pool } from 'pg';

type Step = { name: string; run(sagaId: string, key: string): Promise<void>; compensate?(sagaId: string, key: string): Promise<void>; pivot?: boolean };
type Status = 'RUNNING' | 'COMPENSATING' | 'COMPLETED' | 'FAILED' | 'NEEDS_ATTENTION';

export class CheckoutSaga {
  constructor(private db: Pool, private steps: Step[]) {}
  // steps: createOrder(C: cancelOrder) -> reserveStock(C: releaseStock) -> capturePayment(pivot) -> confirmOrder -> requestShipping

  async resume(sagaId: string): Promise<Status> {
    const { rows: [s] } = await this.db.query(
      'SELECT step_index, status FROM sagas WHERE id = $1 FOR UPDATE SKIP LOCKED', [sagaId]); // one runner at a time
    if (!s) return 'RUNNING';                                  // another worker owns it
    let i: number = s.step_index;
    let status: Status = s.status;

    while (status === 'RUNNING' && i < this.steps.length) {
      const step = this.steps[i];
      const pastPivot = this.steps.slice(0, i).some((x) => x.pivot);
      try {
        await withRetry(() => step.run(sagaId, sagaId + ':' + step.name), pastPivot ? 20 : 3);
        i++;
        await this.save(sagaId, i, 'RUNNING');                 // checkpoint after each step
      } catch (err) {
        if (pastPivot) { status = 'NEEDS_ATTENTION'; break; }  // after pivot: never compensate
        status = 'COMPENSATING';
        await this.save(sagaId, i, status, String(err));
      }
    }
    if (status === 'RUNNING') status = 'COMPLETED';

    if (status === 'COMPENSATING') {
      for (let j = i - 1; j >= 0; j--) {                       // reverse order
        const c = this.steps[j].compensate;
        if (!c) continue;
        try { await withRetry(() => c(sagaId, sagaId + ':' + this.steps[j].name + ':undo'), 10); }
        catch { status = 'NEEDS_ATTENTION'; break; }           // park for humans, keep evidence
      }
      if (status === 'COMPENSATING') status = 'FAILED';        // cleanly rolled back
    }
    await this.save(sagaId, i, status);
    return status;
  }

  private save(id: string, stepIndex: number, status: Status, error?: string) {
    return this.db.query(
      'UPDATE sagas SET step_index = $2, status = $3, last_error = $4, updated_at = now() WHERE id = $1',
      [id, stepIndex, status, error ?? null]);
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  for (let a = 1; ; a++) {
    try { return await fn(); } catch (e) {
      if (a >= attempts || (e as { retryable?: boolean }).retryable === false) throw e;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 200 * 2 ** a) * (0.5 + Math.random())));
    }
  }
}
// NB: SELECT ... FOR UPDATE must run inside a transaction held for the whole resume() in real code,
// or use a lease column (owner, lease_until) so long-running sagas don't hold row locks.`,
        },
      ],
      keyPoints: [
        'Persist saga state per step; any worker can resume.',
        'Commands use deterministic idempotency keys (saga_id:step).',
        'Retry (don\'t compensate) after the pivot; park failing compensations for humans.',
      ],
    },
    {
      heading: 'Transactional outbox + CDC: killing the dual-write problem',
      body: `**Intuition:** you can't atomically write to your database *and* to Kafka. So write the message into your database too (an "outbox" drawer), in the same transaction as the business change. A courier (relay) empties the drawer into Kafka.

**The dual-write problem:** \`save order; publish OrderCreated\`. If the process crashes between the two, the order exists but no event was sent (downstream never reserves stock). Publish first and the DB write fails → phantom event. Wrapping the publish inside the DB transaction doesn't help (the publish can succeed and the commit fail). Every "write DB + call/publish" without an outbox is a latent inconsistency.

**Outbox:**
1. In the same local transaction: \`INSERT INTO orders ...\` and \`INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload, created_at)\`.
2. A **relay** publishes outbox rows to the broker and marks/deletes them:
   - **Polling publisher:** \`SELECT ... FOR UPDATE SKIP LOCKED LIMIT 500\` in a loop; simple; adds DB load and ~100 ms–1 s latency; multiple relays scale via SKIP LOCKED but lose strict ordering across relays unless partitioned by aggregate.
   - **Log tailing (CDC):** Debezium reads the WAL/binlog and emits outbox inserts (Debezium's *Outbox Event Router* routes by \`aggregate_type\` and keys by \`aggregate_id\`). Lower latency, no polling load, preserves commit order; needs Kafka Connect and replication slot care.
3. **Delivery is at-least-once** (relay can crash after publishing, before marking) → consumers must dedupe (inbox, previous section) using the outbox row's ID as event ID.
4. **Ordering:** key messages by aggregate ID so all events for an order land in one partition, in commit order.
5. **Cleanup:** delete published rows or partition the outbox by day and drop old partitions (with CDC, you can delete immediately after insert — the WAL already has it).

**CDC without an outbox** (streaming table changes directly) is fine for replication/analytics, but it leaks your internal schema as a public contract; an outbox publishes **intentional domain events** with a stable schema.`,
      code: [
        {
          language: 'typescript',
          title: 'Write order + outbox atomically; polling relay with SKIP LOCKED',
          code: `import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Producer } from 'kafkajs';

export async function placeOrder(db: Pool, cmd: { orderId: string; customerId: string; totalCents: number }) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      'INSERT INTO orders (id, customer_id, total_cents, status) VALUES ($1, $2, $3, $4)',
      [cmd.orderId, cmd.customerId, cmd.totalCents, 'PENDING']);
    await c.query(
      'INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), 'order', cmd.orderId, 'OrderPlaced', JSON.stringify(cmd)]);
    await c.query('COMMIT');                 // both or neither
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

export async function relayOnce(db: Pool, producer: Producer): Promise<number> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      'SELECT id, aggregate_type, aggregate_id, type, payload FROM outbox ' +
      'WHERE published_at IS NULL ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED');
    if (rows.length === 0) { await c.query('COMMIT'); return 0; }

    await producer.send({                    // idempotent producer: acks=all, enable.idempotence
      topic: 'orders.events',
      messages: rows.map((r) => ({
        key: r.aggregate_id,                  // per-order ordering within a partition
        value: JSON.stringify(r.payload),
        headers: { eventId: r.id, type: r.type },  // consumers dedupe on eventId
      })),
    });
    await c.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1)', [rows.map((r) => r.id)]);
    await c.query('COMMIT');                 // crash before this => republish => consumers dedupe
    return rows.length;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}`,
        },
      ],
      keyPoints: [
        'Business row + outbox row in one local transaction removes the dual-write gap.',
        'Relay via polling (SKIP LOCKED) or CDC (Debezium outbox router); at-least-once.',
        'Key by aggregate ID for ordering; consumers dedupe on the outbox ID.',
      ],
      source: 'Richardson — Microservices Patterns; Debezium Outbox Event Router docs',
    },
    {
      heading: 'The exactly-once illusion',
      body: `**Intuition:** the network can always lose the acknowledgement, so no system can guarantee a message is *delivered* exactly once. What you can guarantee is that its *effect* happens exactly once.

**Delivery semantics:**
- **At-most-once:** send and forget (or commit offset before processing). Loses messages on failure.
- **At-least-once:** retry until acked (commit offset after processing). Duplicates on failure.
- **"Exactly-once":** in practice = **at-least-once delivery + idempotent/transactional processing** (payment systems state this explicitly: retries give at-least-once, idempotency gives at-most-once, together exactly-once).

**What Kafka's exactly-once (EOS) really covers:**
- **Idempotent producer** (PID + per-partition sequence numbers) — no duplicates from producer retries.
- **Transactions** — a read-process-write loop can atomically write output records *and* the consumer offsets to Kafka; consumers with \`isolation.level=read_committed\` only see committed output. So **Kafka → processing → Kafka** is exactly-once (Kafka Streams \`processing.guarantee=exactly_once_v2\`).
- It does **not** cover side effects outside Kafka: an HTTP call to a PSP, a Postgres insert, an email. If your consumer charges a card and crashes before committing, the charge happens again unless *the charge itself* is idempotent (PSP idempotency key) or the DB write and offset are stored atomically (inbox table, or storing offsets in the same DB transaction).

**Checklist for "exactly-once" claims in design reviews:**
1. Where is the dedup key generated, and is it stable across retries?
2. Is the dedup record committed atomically with the side effect?
3. Is the dedup window longer than the replay horizon?
4. For third parties: do they support idempotency keys? If not, query-before-retry ("did payment X happen?") plus reconciliation.`,
      diagram: `Producer ──retry──▶ Broker ──redeliver──▶ Consumer ──▶ DB
 idempotent producer   may deliver a     event_id dedup + effect
 (PID + seq): no dup   message twice     in ONE txn → effect 1×
 on producer retry     (rebalance/crash)

Kafka transactions: exactly-once only for Kafka → Kafka pipelines`,
      keyPoints: [
        'Exactly-once delivery is impossible; exactly-once effect is at-least-once + idempotency.',
        'Kafka EOS covers Kafka-to-Kafka read-process-write, not external side effects.',
        'Audit dedup key stability, atomicity with the effect, and window length.',
      ],
      source: 'Kafka KIP-98',
    },
    {
      heading: 'Reconciliation: the safety net for money',
      body: `**Intuition:** at the end of each day, a shop compares its till receipts with the bank statement. Whatever doesn't match gets investigated. Distributed payment systems do the same, automatically, because *something* always slips through retries, timeouts and bugs.

**Why it's needed even with idempotency and sagas:** third parties (PSPs, banks, card networks) are asynchronous, send late webhooks, occasionally double-settle or miss one; internal bugs and manual fixes happen; outage recovery replays events. A well-designed payment system treats reconciliation as a core component of the payment system, not an afterthought.

**How it works:**
1. **Sources of truth to compare:** internal **ledger** (double-entry: every movement is a debit and a credit that sum to zero), internal payment/order state, **PSP settlement files** (daily CSV/SFTP or API), bank statements, and wallet balances (Ch 12: balance must equal the sum of ledger entries).
2. **Match** records by a shared reference (payment ID sent to the PSP as merchant reference / idempotency key), then compare amount, currency, status and fees.
3. **Classify mismatches:**
   - *Missing in PSP* (we think captured, PSP has nothing) → query PSP; often a timeout where the charge never happened → mark failed.
   - *Missing internally* (PSP captured, we have no record or record is FAILED) → the classic "charged but order failed" → auto-refund or complete the order.
   - *Duplicate at PSP* (two captures for one order) → auto-refund the duplicate.
   - *Amount/currency/fee mismatch* → finance ops queue.
4. **Resolve:** known, safe classes are fixed automatically (with an audit trail); unknown classes go to a manual queue with SLAs. Track mismatch rate as a KPI; spikes indicate a bug or a PSP incident.
5. **Intraday checks** for high-risk flows: continuously compare webhook streams with internal state (e.g. every 15 minutes), not just nightly.

**Ledger invariants you can check by SQL:** every transaction's entries sum to zero; account balance = sum of its entries; no payment has more than one capture entry.`,
      code: [
        {
          language: 'sql',
          title: 'Daily reconciliation: internal payments vs PSP settlement file',
          code: `-- psp_settlement: loaded daily from the PSP's settlement report (one row per PSP transaction)
-- payments: internal source of truth (payment_id is sent to the PSP as merchant_reference)
WITH internal AS (
  SELECT payment_id, amount_cents, currency, status
  FROM payments
  WHERE captured_at >= DATE '2026-09-27' AND captured_at < DATE '2026-09-28'
    AND status IN ('CAPTURED', 'REFUNDED')
),
psp AS (
  SELECT merchant_reference AS payment_id, count(*) AS captures,
         sum(amount_cents) AS amount_cents, min(currency) AS currency
  FROM psp_settlement
  WHERE settlement_date = DATE '2026-09-28' AND type = 'CAPTURE'
  GROUP BY merchant_reference
)
SELECT coalesce(i.payment_id, p.payment_id) AS payment_id,
       CASE
         WHEN p.payment_id IS NULL THEN 'MISSING_AT_PSP'          -- we think captured; PSP did not
         WHEN i.payment_id IS NULL THEN 'MISSING_INTERNALLY'      -- charged but we have no capture
         WHEN p.captures > 1        THEN 'DUPLICATE_CAPTURE'       -- auto-refund candidates
         WHEN p.amount_cents <> i.amount_cents OR p.currency <> i.currency THEN 'AMOUNT_MISMATCH'
       END AS mismatch_type,
       i.amount_cents AS internal_amount, p.amount_cents AS psp_amount, p.captures
FROM internal i
FULL OUTER JOIN psp p ON p.payment_id = i.payment_id
WHERE p.payment_id IS NULL OR i.payment_id IS NULL
   OR p.captures > 1 OR p.amount_cents <> i.amount_cents OR p.currency <> i.currency;

-- Ledger invariant: every journal entry balances to zero
SELECT journal_id FROM ledger_entries
GROUP BY journal_id
HAVING sum(CASE direction WHEN 'DEBIT' THEN amount ELSE -amount END) <> 0;`,
        },
      ],
      keyPoints: [
        'Reconciliation catches what idempotency and sagas miss — especially third-party inconsistencies.',
        'Match on a shared reference; classify mismatches; auto-fix safe classes, queue the rest.',
        'Double-entry ledger invariants are cheap, powerful SQL checks.',
      ],
    },
    {
      heading: 'Scenario playbook: duplicate payments and duplicate orders',
      body: `**Intuition:** duplicates are almost never one bug — they're a missing layer of defence. Walk the request path and ask at each hop: "if this hop is retried, what stops a second effect?"

**Scenario A — "Customers charged twice" (incident):**
1. **Mitigate:** identify affected payments (reconciliation query: >1 capture per order), auto-refund duplicates, communicate. Disable the retry path if it's the trigger (e.g. a new gateway retry policy).
2. **Diagnose:** find the two captures' request IDs. Common roots: (a) client/gateway retried after timeout and the server had no idempotency key; (b) the key was generated **per HTTP attempt** instead of per checkout; (c) server-side idempotency existed but used check-then-insert (race between concurrent duplicates); (d) the call to the PSP didn't pass an idempotency key, so our own retry after a PSP timeout created a second charge; (e) a consumer processed a \`PaymentRequested\` event twice.
3. **Fix in layers:** client key per logical attempt + disabled double-submit; API idempotency with insert-first unique key; PSP idempotency key derived from payment ID; payment state machine that refuses to capture an order that's not \`AWAITING_PAYMENT\`; unique constraint "one successful capture per order"; consumer inbox; reconciliation alert on duplicate captures.

**Scenario B — "Duplicate orders created":**
- Double-click / retry of \`POST /orders\` → natural idempotency: client-generated \`order_id\` or unique \`(customer_id, cart_id)\`.
- Event replays creating orders in a downstream system → inbox dedup keyed by the upstream event ID.
- Saga resumed after a crash re-running "create order" → deterministic step keys (\`saga_id:createOrder\`) and upsert.

**Scenario C — "Order paid but shows failed":** the PSP captured but our callback/timeout path marked it failed. Fix: on timeout, mark \`PAYMENT_UNKNOWN\` (not FAILED), query the PSP by idempotency key/reference, consume webhooks idempotently, and let reconciliation close the loop.

**Defence-in-depth table:**

| Layer | Guard |
|---|---|
| Client | One key per logical operation; disable button; retry with same key |
| API | Insert-first idempotency table; 409 on in-progress; 422 on body mismatch |
| Domain | State machine transitions with conditional updates (\`WHERE status = 'AWAITING_PAYMENT'\`) |
| DB | Unique constraints on business keys (one capture per order) |
| Third party | Pass idempotency keys; query-before-retry; handle webhooks idempotently |
| Messaging | Outbox for producing, inbox for consuming |
| After the fact | Reconciliation + alerts on duplicate/missing captures |`,
      diagram: `Client ─key K─▶ Gateway ─(retry)─▶ Payment API ─key pay_K─▶ PSP
  same K on retry                     │ 1. INSERT idem(K) unique
                                      │ 2. UPDATE payment SET status='CAPTURING'
                                      │    WHERE id=? AND status='AWAITING_PAY'
                                      │ 3. PSP charge, idempotency key pay_K
                                      │ 4. outbox PaymentCaptured (same txn)
                                      ▼
            Ledger consumer: inbox(event_id) + double-entry in 1 txn
            Nightly + intraday reconciliation vs PSP settlement`,
      keyPoints: [
        'Duplicates come from a missing layer; check every hop for retry safety.',
        'On timeout, mark UNKNOWN and verify with the provider — never assume failure.',
        'Unique business constraints and conditional state transitions are cheap, strong guards.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'ds-transactions-cc-1',
      title: 'Make a payment endpoint safe under retries and double-clicks',
      context:
        'A NestJS checkout service exposes POST /payments. The mobile app retries on timeout, the API gateway retries 502s once, and users double-tap "Pay". Finance found 0.2% of orders charged twice last month.',
      task: 'Identify every path that produces a duplicate charge or an order stuck in the wrong state, and rewrite the handler so any number of retries or concurrent duplicates result in at most one charge and a consistent order state, including when the PSP call times out.',
      starter: {
        language: 'typescript',
        title: 'payments.controller.ts (starter)',
        code: `import { Body, Controller, Post } from '@nestjs/common';
import { Pool } from 'pg';

@Controller('payments')
export class PaymentsController {
  constructor(private db: Pool, private psp: { charge(o: { amount: number; card: string }): Promise<{ id: string }> }) {}

  @Post()
  async pay(@Body() body: { orderId: string; card: string }) {
    const { rows: [order] } = await this.db.query('SELECT * FROM orders WHERE id = $1', [body.orderId]);
    if (order.status === 'PAID') return { status: 'already paid' };

    try {
      const charge = await this.psp.charge({ amount: order.total, card: body.card });
      await this.db.query("UPDATE orders SET status = 'PAID', psp_charge_id = $2 WHERE id = $1",
        [order.id, charge.id]);
      return { status: 'paid', chargeId: charge.id };
    } catch (e) {
      await this.db.query("UPDATE orders SET status = 'PAYMENT_FAILED' WHERE id = $1", [order.id]);
      throw e;
    }
  }
}`,
      },
      hints: [
        'Two requests for the same order arrive 50 ms apart. What does each see when it reads status? What stops both from charging?',
        'The PSP call times out, but the charge actually succeeded. What status does the order get, and what happens when the user taps "Pay" again?',
        'Which key could the PSP use to recognise a retry as the same charge? Where should the state transition live so it is atomic?',
      ],
      solution: {
        language: 'typescript',
        title: 'payments.controller.ts (solution)',
        code: `import { Body, ConflictException, Controller, Headers, Post } from '@nestjs/common';
import { Pool } from 'pg';

type Psp = {
  charge(o: { amount: number; currency: string; card: string; idempotencyKey: string; reference: string }):
    Promise<{ id: string; status: 'succeeded' | 'declined' }>;
};

@Controller('payments')
export class PaymentsController {
  constructor(private db: Pool, private psp: Psp) {}

  @Post()
  async pay(@Headers('idempotency-key') key: string, @Body() body: { orderId: string; card: string }) {
    // (API-level Idempotency-Key replay handled by IdempotencyInterceptor; see section 2)
    // 1) Atomic state transition = the concurrency guard. Only one request wins.
    const { rows: [order] } = await this.db.query(
      "UPDATE orders SET status = 'PAYMENT_PENDING', payment_attempt = payment_attempt + 1 " +
      "WHERE id = $1 AND status IN ('AWAITING_PAYMENT', 'PAYMENT_DECLINED') " +
      'RETURNING id, total_cents, currency, payment_attempt', [body.orderId]);
    if (!order) throw new ConflictException('Order is already being paid or is paid');

    // 2) Deterministic PSP key per attempt: our own retries of THIS attempt dedupe at the PSP
    const pspKey = 'order-' + order.id + '-attempt-' + order.payment_attempt;
    try {
      const charge = await this.psp.charge({
        amount: order.total_cents, currency: order.currency, card: body.card,
        idempotencyKey: pspKey, reference: order.id,
      });
      const next = charge.status === 'succeeded' ? 'PAID' : 'PAYMENT_DECLINED';
      await this.finish(order.id, next, charge.id);
      return { status: next, chargeId: charge.id };
    } catch (e) {
      // 3) Timeout / 5xx = UNKNOWN outcome. Never mark failed; a resolver job queries the PSP
      //    by pspKey (or waits for the webhook) and moves UNKNOWN -> PAID | PAYMENT_DECLINED.
      await this.db.query(
        "UPDATE orders SET status = 'PAYMENT_UNKNOWN', psp_idempotency_key = $2 WHERE id = $1 AND status = 'PAYMENT_PENDING'",
        [order.id, pspKey]);
      return { status: 'PROCESSING' }; // client polls GET /orders/:id; do NOT invite a new attempt
    }
  }

  private async finish(orderId: string, status: string, chargeId: string) {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        "UPDATE orders SET status = $2, psp_charge_id = $3 WHERE id = $1 AND status IN ('PAYMENT_PENDING', 'PAYMENT_UNKNOWN')",
        [orderId, status, chargeId]);
      await c.query( // outbox event in the same txn (ledger, email, fulfilment consume it idempotently)
        'INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
        ['order', orderId, status === 'PAID' ? 'OrderPaid' : 'PaymentDeclined', JSON.stringify({ orderId, chargeId })]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
}
// Also: UNIQUE (order_id) on successful captures in the payments ledger; reconciliation alerts on >1 capture.`,
      },
      explanation: `**Bugs in the starter:**
- **Check-then-act race:** two concurrent requests both read \`status != PAID\` and both charge.
- **No PSP idempotency key:** any retry (ours, the gateway's, the app's) is a brand-new charge.
- **Timeout treated as failure:** a charge that succeeded but timed out marks the order \`PAYMENT_FAILED\`, inviting the user to pay again → double charge, and the first charge is orphaned.
- **Non-atomic follow-ups:** status update and downstream notifications are not atomic (no outbox); \`order\` may be undefined.

**Fixes:**
- **Conditional state transition** (\`UPDATE … WHERE status IN (…) RETURNING\`) is the lock: exactly one request moves the order to \`PAYMENT_PENDING\`; others get 409.
- **Deterministic PSP idempotency key** per payment attempt, plus the order ID as PSP reference for reconciliation.
- **UNKNOWN state for timeouts**, resolved by querying the PSP or consuming its webhook — never by asking the user to pay again.
- **Outbox** for the resulting event in the same transaction as the final status.
- Defence in depth: API idempotency interceptor, unique capture constraint, reconciliation alert on duplicate captures.`,
      followUps: [
        {
          "q": "The resolver job finds 3,000 orders in PAYMENT_UNKNOWN after a 10-minute PSP outage. How should it work through them?",
          "a": "Process them with bounded concurrency and rate limits towards the PSP (it just recovered, so don't stampede it), oldest first. For each, query the PSP by the stored `psp_idempotency_key`; if found, call `finish` with PAID or DECLINED (conditional on status, so a concurrent webhook doesn't conflict); if not found and the safety window has passed, retry the charge with the same key or mark DECLINED, depending on policy. Emit metrics for UNKNOWN count and age, and alert if any stays unresolved beyond, say, 30 minutes."
        },
        {
          "q": "The user taps Pay again while the order is PAYMENT_UNKNOWN and gets a 409. Product says that's a bad experience. What would you do?",
          "a": "Return a better response, not a second charge path. Make the 409 body (or a 202) carry the order state 'processing' and have the app show 'Payment is being confirmed' and poll GET /orders/:id. Speed up resolution by triggering an immediate PSP lookup for that order when the user retries. If the user wants to switch cards, allow it only after the unknown attempt resolves as declined; never start attempt N+1 while attempt N's outcome is unknown."
        }
      ],
    },
    {
      id: 'ds-transactions-cc-2',
      title: 'Replace a dual-write + non-idempotent consumer with outbox and inbox',
      context:
        'The order service saves an order and then publishes OrderPlaced to Kafka; the inventory service consumes it and decrements stock. Incidents: orders with no stock reservation (event never sent) and stock decremented twice for the same order (event processed twice after a rebalance).',
      task: 'Rewrite both sides so an order and its event are committed atomically, events are published at least once in per-order order, and the inventory effect happens exactly once per order even with redeliveries and replays.',
      starter: {
        language: 'typescript',
        title: 'order-and-inventory.ts (starter)',
        code: `// order-service
export async function placeOrder(db: any, producer: any, order: { id: string; sku: string; qty: number }) {
  await db.query('INSERT INTO orders (id, sku, qty, status) VALUES ($1,$2,$3,$4)',
    [order.id, order.sku, order.qty, 'PLACED']);
  await producer.send({ topic: 'orders', messages: [{ value: JSON.stringify(order) }] }); // no key
}

// inventory-service
export async function runConsumer(consumer: any, db: any) {
  await consumer.run({
    eachMessage: async ({ message }: any) => {         // autoCommit: true (default)
      const order = JSON.parse(message.value.toString());
      await db.query('UPDATE stock SET qty = qty - $2 WHERE sku = $1', [order.sku, order.qty]);
    },
  });
}`,
      },
      hints: [
        'What happens if the process dies after the INSERT but before send()? What if send() succeeds but the INSERT had failed and you reordered the calls?',
        'Without a message key, which partition do an order\'s events go to? What about ordering between OrderPlaced and a later OrderCancelled?',
        'On the consumer, what identifies "this event was already applied", and how do you make recording that and decrementing stock a single atomic step?',
      ],
      solution: {
        language: 'typescript',
        title: 'order-and-inventory.ts (solution)',
        code: `import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Consumer } from 'kafkajs';

// ---------- order-service: business row + outbox row in ONE local transaction ----------
export async function placeOrder(db: Pool, order: { id: string; sku: string; qty: number }) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO orders (id, sku, qty, status) VALUES ($1,$2,$3,$4)',
      [order.id, order.sku, order.qty, 'PLACED']);
    await c.query(
      'INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), 'order', order.id, 'OrderPlaced', JSON.stringify(order)]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
// Relay: Debezium Outbox Event Router (key = aggregate_id, header eventId = outbox.id)
// or the SKIP LOCKED poller from the outbox section. Delivery: at-least-once.

// ---------- inventory-service: inbox dedup + effect in ONE transaction, manual offsets ----------
export async function runConsumer(consumer: Consumer, db: Pool) {
  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const eventId = message.headers?.eventId?.toString();
      if (!eventId) throw new Error('missing eventId header');   // -> DLQ after retries
      const order = JSON.parse(message.value!.toString()) as { id: string; sku: string; qty: number };

      const c = await db.connect();
      try {
        await c.query('BEGIN');
        const fresh = await c.query(
          'INSERT INTO inbox (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          ['inventory', eventId]);
        if (fresh.rowCount === 1) {
          const r = await c.query(
            'UPDATE stock SET qty = qty - $2 WHERE sku = $1 AND qty >= $2', [order.sku, order.qty]);
          // business outcome goes back via this service's own outbox (reserved / out of stock)
          await c.query(
            'INSERT INTO outbox (id, aggregate_type, aggregate_id, type, payload) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
            ['order', order.id, r.rowCount ? 'StockReserved' : 'OutOfStock', JSON.stringify({ orderId: order.id })]);
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }

      await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
    },
  });
}`,
      },
      explanation: `**What was wrong:**
- **Dual write:** a crash between INSERT and send() leaves an order with no event (no reservation); reversing the order creates phantom events.
- **No message key:** events for one order spread across partitions → OrderCancelled can be processed before OrderPlaced.
- **Auto-commit + non-idempotent UPDATE:** after a rebalance or crash the message is redelivered and stock is decremented twice; with auto-commit the offset may also be committed before processing, losing events.
- **No stock check:** \`qty\` can go negative.

**Fixes:**
- **Transactional outbox:** order and event commit atomically; a relay publishes at least once, keyed by \`aggregate_id\` for per-order ordering, with the outbox ID as \`eventId\`.
- **Inbox dedup** in the same transaction as the stock update — redeliveries become no-ops, so the effect is exactly-once.
- **Manual offset commit after the DB commit** (at-least-once delivery, idempotent effect).
- **Guarded decrement** (\`qty >= $2\`) and the outcome published through the inventory service's own outbox, continuing the choreographed saga safely.`,
      followUps: [
        {
          "q": "An OrderCancelled event must release stock. The inventory service receives OrderCancelled for an order whose OrderPlaced it hasn't processed yet (e.g. it went to the DLQ). What should it do?",
          "a": "Per-order keys keep order within a partition, but a DLQ'd event breaks that. The cancellation handler must check whether a reservation exists for the order: if not, record a 'cancelled' marker in the same transaction (like a TCC empty rollback) so a later OrderPlaced replayed from the DLQ is ignored instead of reserving stock forever. Also, putting a poison OrderPlaced in a DLQ should pause or flag that order's key, since skipping it reorders subsequent events."
        },
        {
          "q": "How would you verify end to end that stock is decremented exactly once per order under redeliveries?",
          "a": "Integration test with real Postgres and Kafka (Testcontainers): place N orders, then force redeliveries — kill the consumer after the DB commit but before the offset commit, trigger rebalances, and reset the group offset to replay the topic. Assert final stock = initial − Σ qty, the inbox has N rows, and the inventory outbox has exactly one StockReserved/OutOfStock per order. In production, a reconciliation job compares orders placed versus reservations per day and alerts on any difference."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'ds-transactions-iq-01',
      difficulty: 'hard',
      question:
        'Design idempotency for a public payments API like Stripe\'s POST /charges. Merchants will retry aggressively. Walk me through storage, concurrency, and edge cases.',
      whatInterviewerLooksFor: [
        'Client-supplied key per logical operation, scoped per merchant',
        'Insert-first with a unique constraint; in-progress handling; request fingerprinting',
        'Which responses are cached and for how long',
        'Propagation to downstream calls and recovery of crashed in-progress requests',
        'Storage sizing and cleanup',
      ],
      modelAnswer: `### Contract
Clients send \`Idempotency-Key\` (UUID) per *logical* charge; the same key on every retry. Keys are scoped by merchant account and retained ≥ 24 h (Stripe's documented minimum).

### Storage
Table \`idempotency_keys(merchant_id, key, request_hash, status, response_code, response_body, locked_until, created_at)\`, PK \`(merchant_id, key)\`, co-located with the payments data (same shard by merchant) so the key record and the charge can be written in **one local transaction**.

### Flow
1. \`INSERT … ON CONFLICT DO NOTHING\` with status \`IN_PROGRESS\`, \`locked_until = now() + 30s\`.
2. Conflict → load the row:
   - hash differs → **422** (key reused for a different request),
   - \`IN_PROGRESS\` and lock not expired → **409** (retry later),
   - \`COMPLETED\` → replay stored status + body byte-for-byte.
3. Execute: create the payment record, call the card network/PSP with a **derived key** (\`ch_<merchant>_<key>\`), persist the result and mark COMPLETED **in the same transaction** as the payment state change.

### Edge cases
- **Crash mid-flight:** a recovery worker picks rows where \`locked_until < now()\` and resumes using the stored progress ("recovery points": started → PSP called → finished); because the downstream call used a derived key, re-calling is safe.
- **Transient errors** (5xx, timeouts to our DB) aren't cached — the key is released or left for recovery; **deterministic errors** (validation, card declined) are cached so retries get the same answer.
- **Parameter changes** between retries are rejected by the hash check.
- **Different endpoints** with the same key: include the endpoint/method in the scope.
- **GET/PUT/DELETE** are naturally idempotent; the key only matters for POST.

### Sizing
At 5K charges/s × 86,400 s ≈ 430M keys/day × ~1 KB ≈ 430 GB/day — fine as a daily-partitioned table (drop partitions after the retention window), spread across payment shards; Redis alone would be expensive and not atomic with the charge.`,
      followUps: [
        {
          q: 'Why not use Redis SET NX for the key?',
          a: 'It is not atomic with the charge in the payments DB, so a crash between Redis and DB leaves them inconsistent; and Redis failover can lose keys. Redis is fine as a fast-path cache in front of the DB record.',
        },
        {
          q: 'What if the client doesn\'t send a key?',
          a: 'For money-moving endpoints either require it, or derive a natural key (merchant_id + merchant_order_reference) with a unique constraint; otherwise duplicates are the merchant\'s risk.',
        },
      ],
      pitfalls: [
        'SELECT-then-INSERT (race between concurrent duplicates).',
        'Caching transient 500s as the permanent answer.',
        'Not propagating idempotency to the PSP call.',
      ],
    },
    {
      id: 'ds-transactions-iq-02',
      difficulty: 'hard',
      question:
        'Support escalates: 180 customers were charged twice yesterday between 14:00 and 14:20. You own the payments service. What do you do, in order?',
      context: 'Stack: mobile app → API gateway → payments service (NestJS, Postgres) → external PSP; Kafka for payment events.',
      whatInterviewerLooksFor: [
        'Customer impact first: identify and refund duplicates, communicate',
        'Structured root-cause hunt across each hop (client, gateway, service, PSP, consumers)',
        'Knows the common root causes and how logs/IDs distinguish them',
        'Layered prevention and detection (reconciliation alert)',
      ],
      modelAnswer: `### 1. Contain and remediate (first hour)
- Query for orders with >1 successful capture in the window (internal DB and PSP API/dashboard by merchant reference). Refund duplicates (idempotently — refund keyed by capture ID), notify customers, loop in finance/support.
- Check if the trigger is still active: a deploy, a gateway config change, a PSP incident? Roll back / disable automatic retries for POST /payments if they're the trigger.

### 2. Diagnose — walk every hop
For a few affected orders, pull both captures and trace IDs:
- **Same idempotency key on both requests?** If yes, server-side idempotency failed: race (check-then-insert), key not scoped/stored correctly, or the PSP call used a fresh key per attempt.
- **Different keys?** Client generated a key per HTTP attempt, or the user tapped twice and the app created two checkout attempts; or the order was reset to "payment failed" after a timeout, inviting a second payment.
- **Gateway logs:** did the gateway retry on 504 at 14:00 after a new timeout config (e.g. upstream timeout reduced from 10 s to 3 s while PSP latency spiked)? That pattern — PSP slow → our timeout → retry → second charge — is the most common.
- **Kafka consumers:** did a consumer rebalance at 14:00 cause \`PaymentRequested\` events to be reprocessed without an inbox?

### 3. Fix in layers
- Client: key per logical attempt; disable double-submit.
- Service: insert-first idempotency; conditional state transition (\`AWAITING_PAYMENT → PAYMENT_PENDING\`); **timeouts become PAYMENT_UNKNOWN**, resolved by querying the PSP, never "failed".
- PSP: deterministic idempotency key per attempt.
- DB: unique constraint — one successful capture per order.
- Gateway: no automatic retries on non-idempotent POSTs unless an Idempotency-Key is present.
- Consumers: inbox dedup.

### 4. Detect next time
Real-time alert on duplicate captures (streaming join on order_id), plus daily reconciliation against PSP settlement. Postmortem with owners and dates.`,
      followUps: [
        {
          q: 'The PSP doesn\'t support idempotency keys. How do you avoid duplicates on retry?',
          a: 'Query-before-retry: look up the charge by our merchant reference; if found, reuse it; if not, retry. Serialize attempts per order and rely on reconciliation for residual cases.',
        },
        {
          q: 'How would you prove the fix works?',
          a: 'Fault-injection tests: delay PSP responses past our timeout, drop responses, kill the service after the PSP call, and assert exactly one capture per order under concurrent duplicate requests.',
        },
      ],
      pitfalls: [
        'Starting with root cause while customers remain double-charged.',
        'Blaming "the network" without tracing idempotency keys.',
        'Fixing one hop only.',
      ],
    },
    {
      id: 'ds-transactions-iq-03',
      difficulty: 'expert',
      question:
        'Design the "place order" flow across Order, Inventory, Payment and Shipping microservices. Payment fails 3% of the time, shipping quotes occasionally time out. No 2PC allowed.',
      whatInterviewerLooksFor: [
        'Orchestrated saga with explicit steps, compensations and a pivot',
        'Semantic locks / PENDING states for missing isolation',
        'Idempotent commands with deterministic keys; outbox for messaging',
        'Timeout handling (unknown outcome) and what happens after the pivot',
        'Observability and manual intervention path',
      ],
      modelAnswer: `### Saga (orchestrated)
An **Order Saga orchestrator** (inside the order service or a workflow engine like Temporal) with persisted state per order:

1. **Create order** \`PENDING\` (compensation: mark \`CANCELLED\`).
2. **Reserve inventory** — reservation row with TTL (compensation: release reservation).
3. **Get shipping quote / reserve slot** — retry with timeout; if unavailable, use a default rate or fail early (compensation: release slot). Put it *before* payment, because it's likelier to fail and easy to undo.
4. **Authorise + capture payment** — the **pivot**. On decline (3%): compensate 3 → 2 → 1 and tell the user.
5. **Confirm order** (\`CONFIRMED\`), **commit inventory** (reservation → sold), **create shipment** — all **retriable** steps; never refund just because shipping creation is slow — retry until it succeeds or escalate.

### Mechanics
- Each command carries \`sagaId:step\` as idempotency key; participants dedupe (inbox) and respond via their **outbox** → reply topic.
- Orchestrator state changes and outgoing commands are written in one transaction (orchestrator's outbox).
- **Timeouts:** a step timing out is **unknown**, so the orchestrator retries the same idempotent command or queries status; only a definitive failure triggers compensation.
- **Isolation:** \`PENDING\` order and inventory \`reserved\` state are *semantic locks* — other flows (shipping, cancellation by user) check them. Reservation TTL prevents stock leaks if the saga dies.

### Failure cases
- Payment declined → release stock, cancel order: clean rollback.
- Payment succeeded but orchestrator crashed → resumes from the checkpoint and continues to confirmation.
- Compensation fails repeatedly (inventory service down) → keep retrying with backoff; after N attempts status \`NEEDS_ATTENTION\` with an ops dashboard.

### Why not choreography?
With four services and money involved, the flow must be visible and testable in one place; choreography spreads compensation logic across services and makes "where is order X?" hard.

### Numbers
1M orders/day × 3% declines = 30K compensations/day — the compensation path is a hot path and must be as well-tested as the happy path.`,
      followUps: [
        {
          q: 'Why authorise-then-capture instead of a single charge?',
          a: 'Authorisation holds funds without moving money, so it can be voided cheaply (a better compensation than a refund); capture after inventory is committed. It makes payment compensatable until capture.',
        },
        {
          q: 'A user cancels while the saga is at step 4. What happens?',
          a: 'The cancel request sees the PENDING semantic lock and is either queued as a saga event (orchestrator handles it after the pivot by running a refund flow) or rejected until the saga settles — never applied concurrently.',
        },
      ],
      pitfalls: [
        'Compensating payment because a post-pivot step timed out.',
        'Compensations that are not idempotent.',
        'Dual writes between orchestrator state and message publishing.',
      ],
    },
    {
      id: 'ds-transactions-iq-04',
      difficulty: 'hard',
      question:
        'An architect wants XA two-phase commit between the Orders Postgres, the Inventory MySQL, and Kafka "so everything is atomic". Evaluate the proposal.',
      whatInterviewerLooksFor: [
        'Explains 2PC mechanics and the blocking/in-doubt problem precisely',
        'Operational costs: latency, locks, coordinator HA, heuristic outcomes',
        'Notes Kafka is not an XA participant and microservice ownership issues',
        'Proposes alternatives and when 2PC is acceptable',
      ],
      modelAnswer: `### What 2PC would give
Atomic commit across participants: all commit or all abort, with isolation via locks held until the decision.

### Why I'd push back
1. **Blocking:** after voting YES, Postgres and MySQL keep row locks while in doubt. If the coordinator (the app's transaction manager) crashes, those rows stay locked until it recovers and resolves — stock rows for hot SKUs would block checkout for everyone.
2. **Coordinator durability:** the transaction manager must have a durable, highly available log; a pod-local log on an ephemeral k8s container is a recipe for orphaned prepared transactions (Postgres \`pg_prepared_xacts\` holding locks and blocking VACUUM).
3. **Latency & throughput:** extra round trips + fsyncs per participant, locks held across network calls; tail latency is the slowest participant's.
4. **Kafka doesn't participate in XA.** Kafka transactions only coordinate Kafka partitions (and consumer offsets). You can't enlist Kafka in the same atomic commit as two databases.
5. **Ownership:** microservices owning their databases shouldn't expose them to another service's transaction manager; it couples deployments, schema and availability.
6. **Heuristic outcomes:** operators forced to resolve in-doubt transactions manually can create exactly the inconsistency 2PC was meant to prevent.

### Alternatives
- **Outbox** in Orders (order + event atomically), consumed idempotently by Inventory (inbox) — a **saga** with reservation + compensation for stock.
- If Orders and Inventory truly need atomicity, **co-locate** them in one database/schema (they may be one bounded context), or use a distributed SQL DB that runs 2PC internally over replicated groups (Spanner, CockroachDB, YugabyteDB) — there the coordinator is highly available and blocking is mostly theoretical.

### When 2PC is acceptable
Inside one database engine/vendor, low contention, short transactions, and an HA coordinator — or legacy integration where the business accepts the operational burden.`,
      followUps: [
        {
          q: 'Does 3PC fix the blocking problem?',
          a: 'Only under synchronous assumptions (bounded delays, no partitions); with partitions it can violate atomicity, so practical systems replicate the coordinator with consensus instead.',
        },
        {
          q: 'How does Spanner avoid 2PC\'s blocking?',
          a: 'Participants and coordinator are Paxos groups, not single machines, so the coordinator\'s decision survives failures of individual replicas; the protocol still blocks only if a whole group loses its majority.',
        },
      ],
      pitfalls: [
        'Believing Kafka can be an XA participant.',
        'Ignoring in-doubt locks after coordinator failure.',
        'Rejecting 2PC without offering a concrete alternative.',
      ],
    },
    {
      id: 'ds-transactions-iq-05',
      difficulty: 'expert',
      question:
        'Our Kafka Streams app is configured with exactly_once_v2. It consumes payment events, calls a fraud-scoring HTTP API, writes results to Postgres, and emits a "scored" event. The team says every payment is scored exactly once. Are they right?',
      whatInterviewerLooksFor: [
        'Knows exactly what Kafka EOS covers (idempotent producer, transactional read-process-write, read_committed)',
        'Identifies external side effects (HTTP call, Postgres write) as outside the guarantee',
        'Proposes idempotent sinks, inbox/upsert, or storing offsets with DB writes',
        'Discusses zombie fencing and transactional.id',
      ],
      modelAnswer: `### What exactly_once_v2 guarantees
For **Kafka → Streams → Kafka**, input offsets, state-store changelogs and output records are committed in **one Kafka transaction**. If the task crashes, the transaction aborts, uncommitted output is invisible to \`read_committed\` consumers, and processing restarts from the last committed offsets. Producer retries are deduplicated by the idempotent producer; **zombie instances** are fenced by producer epochs (per transactional id / consumer-group metadata in v2).

### What it does not cover
The **HTTP fraud call** and the **Postgres write** happen outside the Kafka transaction. On a crash after the HTTP call/DB write but before the Kafka commit, the input is reprocessed:
- the fraud API is called again (cost, possibly rate limits, maybe a different score),
- the Postgres row is written again (duplicate or overwritten),
- only the "scored" Kafka output is exactly-once.
So the claim holds for Kafka outputs, not for the effects in other systems.

### Making the whole flow effectively exactly-once
- **Postgres sink idempotent:** upsert by \`payment_id\` (\`ON CONFLICT (payment_id) DO UPDATE … WHERE excluded.version >= scores.version\`), or an inbox table keyed by event ID in the same transaction. Better: emit "scored" to Kafka and let a separate **idempotent sink connector** write Postgres.
- **Fraud API:** pass an idempotency key (\`payment_id\`) if supported, or cache results by payment_id (read-through) so reprocessing reuses the score deterministically.
- Alternatively, store Kafka offsets **in Postgres** in the same DB transaction as the result (manual offset management) — then Postgres is the exactly-once boundary.

### Summary
Exactly-once is a property of a **boundary**. Kafka EOS draws the boundary around Kafka; everything else needs idempotency.`,
      followUps: [
        {
          q: 'What does read_committed cost consumers?',
          a: 'They can only read up to the last stable offset, so an open long transaction delays downstream visibility; commit intervals (default 100 ms in EOS mode) trade latency for throughput.',
        },
        {
          q: 'What is a zombie in this context?',
          a: 'A paused/partitioned old instance of a task that wakes up and tries to write; transactional producers with epochs fence it so its writes are rejected — a fencing token for producers.',
        },
      ],
      pitfalls: [
        'Believing Kafka EOS extends to HTTP calls or databases.',
        'Claiming exactly-once delivery is possible end-to-end.',
        'Ignoring zombie producers.',
      ],
    },
    {
      id: 'ds-transactions-iq-06',
      difficulty: 'medium',
      question:
        'Explain the transactional outbox pattern to me as if I will implement it tomorrow. What goes wrong in production?',
      whatInterviewerLooksFor: [
        'Explains the dual-write problem clearly',
        'Concrete schema and transaction boundaries',
        'Relay options (polling vs CDC) with trade-offs',
        'At-least-once implications, ordering, cleanup, monitoring',
      ],
      modelAnswer: `### Problem
"Save to DB then publish to Kafka" can't be atomic — a crash in between loses the event, and reversing the order creates events for rows that never committed.

### Pattern
- Table \`outbox(id uuid pk, aggregate_type, aggregate_id, type, payload jsonb, created_at, published_at null)\`.
- In the **same transaction** as the business change, insert the event row. Commit once.
- A **relay** reads unpublished rows and publishes to Kafka, keyed by \`aggregate_id\`, with header \`eventId = outbox.id\`.

### Relay choices
| | Polling publisher | CDC (Debezium outbox router) |
|---|---|---|
| Latency | 100 ms–1 s (poll interval) | Tens of ms |
| DB load | Index scans + updates | Reads WAL only |
| Ordering | Per aggregate if single relay or partitioned by aggregate | Commit order preserved |
| Ops | Just app code | Kafka Connect + replication slot |

Polling: \`SELECT … WHERE published_at IS NULL ORDER BY created_at LIMIT 500 FOR UPDATE SKIP LOCKED\`, publish, mark published, commit.

### What goes wrong
1. **Duplicates:** relay publishes, crashes before marking → republished. Consumers **must** dedupe on eventId (inbox).
2. **Ordering across relays:** SKIP LOCKED with multiple pollers can publish event 2 of an order before event 1 — partition relay work by aggregate hash or use CDC.
3. **Outbox bloat:** millions of rows/day → index bloat and slow polls. Delete after publishing or partition by day and drop partitions; with CDC, delete right after insert.
4. **Stuck relay:** alert on oldest unpublished row age (e.g. > 30 s) and outbox row count. With CDC, alert on replication slot lag — a stuck slot fills the disk.
5. **Schema as contract:** payloads are public events — version them (schema registry), don't dump internal rows.
6. **Poison events:** a payload the broker rejects (size limits ~1 MB default) blocks the queue — validate at write time, DLQ in the relay.`,
      followUps: [
        {
          q: 'Could you use LISTEN/NOTIFY to reduce polling latency?',
          a: 'Yes, as a wake-up signal after commit, but NOTIFY isn\'t durable — keep the table as source of truth and poll as a fallback.',
        },
        {
          q: 'How is the inbox different from the outbox?',
          a: 'Outbox makes producing atomic with a local write; inbox makes consuming idempotent by recording processed event IDs atomically with the consumer\'s side effect.',
        },
      ],
      pitfalls: [
        'Publishing inside the DB transaction and calling it atomic.',
        'Assuming the relay gives exactly-once delivery.',
        'Forgetting cleanup and monitoring.',
      ],
    },
    {
      id: 'ds-transactions-iq-07',
      difficulty: 'hard',
      question:
        'Design reconciliation for a marketplace payment system that uses two PSPs and pays out sellers daily. What do you compare, when, and what happens to mismatches?',
      whatInterviewerLooksFor: [
        'Identifies the datasets: internal ledger, payment states, PSP settlement reports, bank statements, payouts',
        'Matching keys and categories of mismatches',
        'Automated vs manual resolution with audit trail',
        'Timing (intraday vs daily, settlement lag, time zones) and metrics',
      ],
      modelAnswer: `### Data to reconcile (three-way)
1. **Internal ledger** (double-entry: customer → PSP clearing → seller payable → payout) and payment/order states.
2. **PSP settlement reports** (per PSP, daily, include captures, refunds, chargebacks, fees, FX).
3. **Bank statements** showing actual PSP deposits and payouts to sellers.

### Matching
- Our \`payment_id\` is sent to PSPs as merchant reference/idempotency key; refunds carry \`refund_id\`. Match on those; fall back to (amount, currency, time window, card fingerprint) fuzzy matching only for PSP-initiated events like chargebacks.
- Handle **settlement lag** (T+1/T+2) and time-zone cut-offs: reconcile by PSP settlement date, carry unmatched items forward for N days before flagging.

### Mismatch classes and actions
| Class | Typical cause | Action |
|---|---|---|
| Captured at PSP, not internally | Timeout marked failed, lost webhook | Auto: complete order or refund per policy |
| Internal captured, absent at PSP | Our timeout, charge never happened | Auto: mark failed after PSP query |
| Duplicate capture | Missing idempotency somewhere | Auto-refund duplicate, alert engineering |
| Amount/fee/FX mismatch | Fee changes, FX rounding | Finance queue; adjust fee accounts |
| PSP deposit ≠ settlement total | Reserve holds, bank delay | Treasury queue |
| Seller payout ≠ payable balance | Bug in payout calc | Block payout, manual review |

### Process
- **Intraday**: stream webhooks vs internal state every 15 min for fast detection of duplicates/lost updates.
- **Daily batch**: load settlement files (idempotently — file hash), run matching SQL/Spark jobs, write results to a \`recon_items\` table with status and owner.
- **Before payouts**: seller payable balances must reconcile; unreconciled amounts are held.
- Every automated fix creates **new ledger entries** (never edits), with the recon item as reference.

### Metrics
Match rate (target > 99.9%), unmatched count/amount by class, age of oldest open item, auto-resolution rate.`,
      followUps: [
        {
          q: 'Why not just trust webhooks?',
          a: 'Webhooks can be delayed, duplicated, reordered or lost, and endpoints go down; settlement reports are the PSP\'s financial record, so they are the authoritative comparison.',
        },
        {
          q: 'How do you make loading settlement files safe to re-run?',
          a: 'Store file checksums and row-level natural keys (PSP transaction ID) with unique constraints, so reloading the same or overlapping file is a no-op.',
        },
      ],
      pitfalls: [
        'Treating reconciliation as an afterthought or manual spreadsheet process.',
        'Fixing mismatches by editing ledger rows.',
        'Ignoring settlement timing, producing false mismatches.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'ds-transactions-boe-1',
      question:
        'Size the idempotency-key store for a payments API doing 3,000 POSTs/s average (peak 3×) with a 24-hour retention window. Postgres table or Redis?',
      assumptions: [
        'Row ≈ 64 B key/scope + 32 B hash + ~600 B stored response + ~100 B overhead/indexes ≈ 800 B',
        'Retention 24 h, dropped by daily partitions',
        'Redis per-key overhead ≈ 60–80 B plus value; memory costs roughly 10× SSD per GB',
      ],
      steps: [
        { label: 'Keys per day', calc: '3,000/s × 86,400 s ≈ 259M keys' },
        { label: 'Storage per day', calc: '259M × 800 B ≈ 207 GB (≈ 2 days kept during partition rollover ≈ 415 GB)' },
        { label: 'Peak write rate', calc: '3,000 × 3 = 9,000 inserts/s + 9,000 updates/s' },
        { label: 'If sharded with payments (8 shards)', calc: '≈ 26–52 GB and ~2.3K writes/s per shard — easy' },
        { label: 'Redis alternative', calc: '259M × ~880 B ≈ 228 GB RAM (+ replicas ×2) ≈ 450 GB RAM' },
      ],
      answer:
        '~200 GB/day and ~9K inserts/s at peak — comfortably a daily-partitioned Postgres table co-located with the payment shards; Redis would need ~450 GB of RAM with replicas.',
      insight:
        'Storing the key next to the payment lets the key update and the business write share one transaction (true atomicity), and time partitioning makes expiry free. Keep response bodies small (or store a pointer to the payment) — the response payload dominates size.',
      followUps: [
        {
          "q": "Compliance wants 7-day key retention instead of 24 hours. What changes, and how do you shrink it?",
          "a": "Storage grows 7×: 259M keys/day × 7 × 800 B ≈ 1.45 TB, ~180 GB per shard over 8 shards — still workable in Postgres but bloated by response bodies. Store a pointer instead of the full response (payment ID plus status, ~200 B/row), and rebuild the response on replay from the payment record: ~52 GB/day, or ~360 GB for 7 days. Redis at 7 days would be multi-terabyte RAM, so this decision firmly favours the database."
        },
        {
          "q": "A merchant's retry bug sends the same key 200 times per second for an hour. What happens to your store, and what protects it?",
          "a": "Each replay is a read of the same row, so the store survives (the row is hot in cache); the risk is connection/CPU load on that shard and noisy logs. Protect with per-merchant rate limits at the gateway, a small in-process or Redis cache of recently completed keys with their responses (TTL a few minutes) to absorb replays before they hit the DB, and an alert on replay ratio per merchant, which usually reveals a client bug worth reporting to them."
        }
      ],
    },
    {
      id: 'ds-transactions-boe-2',
      question:
        'An order platform processes 1.2M orders/day through a 5-step saga. Each step fails definitively 0.5% of the time (independent), and each compensation fails on first try 1% of the time but succeeds on retry 99% of the time. How many compensations and manual interventions per day?',
      assumptions: [
        'Steps 1–4 are compensatable; step 5 is retriable (never compensated)',
        'A failure at step k triggers k−1 compensations',
        'Manual intervention only if a compensation still fails after retries (1% × 1% = 0.01% of compensations)',
      ],
      steps: [
        { label: 'Sagas failing at step 2', calc: '1.2M × 0.995 × 0.005 ≈ 5,970 → 1 compensation each' },
        { label: 'Failing at step 3', calc: '1.2M × 0.995² × 0.005 ≈ 5,940 → 2 compensations each = 11,880' },
        { label: 'Failing at step 4', calc: '1.2M × 0.995³ × 0.005 ≈ 5,910 → 3 each = 17,730' },
        { label: 'Total compensations', calc: '5,970 + 11,880 + 17,730 ≈ 35,600/day (step-1 failures need none)' },
        { label: 'Manual interventions', calc: '35,600 × 0.0001 ≈ 3.6/day' },
      ],
      answer:
        '~18K failed sagas/day triggering ~36K compensations, and ~3–4 sagas/day needing manual intervention.',
      insight:
        'At scale, the compensation path is a hot path: it needs the same idempotency, retries, metrics and tests as the happy path, plus an ops queue with SLAs. Reordering steps so the most failure-prone ones run first (fewer compensations each) cuts compensation volume substantially.',
      followUps: [
        {
          "q": "A new PSP integration makes step 4 fail definitively 3% of the time instead of 0.5%. Redo the compensation and manual-intervention estimates.",
          "a": "Step-4 failures become 1.2M × 0.995³ × 0.03 ≈ 35.5K sagas/day, each needing 3 compensations ≈ 106K. Adding steps 2 and 3 (5,970 + 11,880) gives ≈ 124K compensations/day — 3.5× the baseline — and manual interventions rise to ≈ 12/day. The ops queue needs staffing to match, and compensation services (stock release, order cancellation) now see ~1.4 compensations/s on average, with bursts during PSP incidents."
        },
        {
          "q": "Can you reorder steps to reduce that? What does moving the 3%-failure step to position 1 give?",
          "a": "If the payment step can run first (e.g. authorise before reserving stock), its failures need zero compensations. With rates [3%, 0.5%, 0.5%, 0.5%], compensations drop to ≈ 34.7K/day and manual interventions to ≈ 3.5/day — back near the baseline despite the worse PSP. The catch: authorising first can mean authorising for items that turn out to be out of stock, so you'd need a void of the authorisation (cheap, no money moved), which is exactly why authorise-then-capture designs exist."
        }
      ],
    },
    {
      id: 'ds-transactions-boe-3',
      question:
        'The order service writes 8,000 orders/s at peak, each producing 3 outbox events of ~1 KB. Size a polling outbox relay and estimate the latency, versus Debezium CDC.',
      assumptions: [
        'Relay batch = 500 rows; one poll + publish + mark cycle ≈ 40 ms (DB 10 ms, Kafka acks=all 20 ms, update 10 ms)',
        'Pollers partitioned by hash(aggregate_id) to preserve per-order order',
        'Debezium throughput per connector task ≈ 20–50K events/s for small events',
      ],
      steps: [
        { label: 'Event rate', calc: '8,000 × 3 = 24,000 events/s ≈ 24 MB/s' },
        { label: 'Per-poller throughput', calc: '500 rows ÷ 0.04 s = 12,500 events/s' },
        { label: 'Pollers needed', calc: '24,000 ÷ 12,500 ≈ 2 → run 4 (partitioned) for headroom' },
        { label: 'Polling latency', calc: 'poll interval (say 50 ms idle) + ~40 ms cycle ≈ 50–100 ms p50' },
        { label: 'Extra DB write load', calc: '24K inserts + 24K updates (mark published) ≈ 48K row writes/s — doubles outbox WAL' },
        { label: 'CDC alternative', calc: '1–2 connector tasks; ~10s of ms latency; no mark-updates (delete-after-insert or partition drop)' },
      ],
      answer:
        '~4 partitioned pollers handle 24K events/s at ~50–100 ms latency but add ~24K updates/s; CDC handles it with 1–2 tasks, lower latency and no extra updates.',
      insight:
        'At high volume the polling relay\'s "mark as published" updates become a significant DB write load (and vacuum burden). CDC-based outbox reading the WAL is the scalable choice; keep polling for low-volume services where simplicity wins.',
      followUps: [
        {
          "q": "A flash sale drives peak to 80,000 orders/s — 10×. What breaks first in the polling relay?",
          "a": "Events rise to 240K/s (~240 MB/s). Pollers need 240K ÷ 12.5K ≈ 19, so ~24–32 with headroom, but the bottleneck is the database: 240K inserts plus 240K 'mark published' updates per second, roughly 480 MB/s of extra row writes before WAL overhead, plus dead tuples that vacuum can't keep up with, so polling queries slow down and lag snowballs. At this scale switch to CDC (reads the WAL, no updates), and drop outbox rows via time-partition truncation instead of updates or deletes."
        },
        {
          "q": "With Debezium, the replication slot falls behind for an hour after a connector crash. What's the risk to the order database?",
          "a": "A logical replication slot pins WAL until the connector confirms it. At ~24 MB/s of outbox data plus all other table changes, an hour of lag retains well over 86 GB of WAL, and if the connector is down long enough the primary's disk fills and the database stops accepting writes. Mitigate with alerting on slot lag (`pg_replication_slots` confirmed_flush_lsn), `max_slot_wal_keep_size` to cap retention (at the cost of forcing a re-snapshot), and running connectors HA."
        }
      ],
    },
  ],
  test: [
    {
      id: 'ds-transactions-mcq-01',
      difficulty: 'hard',
      question:
        'What is the race in this idempotency implementation, and what fixes it?',
      code: {
        language: 'typescript',
        code: `const existing = await db.query('SELECT response FROM idem WHERE key = $1', [key]);
if (existing.rows[0]) return existing.rows[0].response;
const result = await chargeCard(req);
await db.query('INSERT INTO idem (key, response) VALUES ($1, $2)', [key, result]);
return result;`,
      },
      options: [
        'Two concurrent requests with the same key both pass the SELECT and both charge; insert the key FIRST under a unique constraint (IN_PROGRESS) and only the winner executes',
        'No race; the SELECT protects against duplicates',
        'The INSERT should be an UPSERT so the second request overwrites the first response',
        'Wrap SELECT and INSERT in a READ COMMITTED transaction',
      ],
      correct: [0],
      explanation:
        'Check-then-act lets concurrent duplicates (double-tap, gateway retry while the first is still running) both see "no row" and both charge. Claiming the key with an atomic insert on a unique constraint makes exactly one request the executor; others get 409 or the stored result. An upsert still charges twice, and READ COMMITTED doesn\'t prevent two transactions from both reading "absent".',
      followUps: [
        {
          "q": "You claim the key with an IN_PROGRESS row. The executing request crashes mid-charge. What do retries see, and how does the key ever become usable again?",
          "a": "Retries hit the unique constraint, find IN_PROGRESS and get 409 'request in progress' — forever, unless you handle staleness. Store `locked_at` with the claim; a retry that finds a lock older than a timeout (e.g. 60 s) may take it over with a conditional UPDATE (`WHERE locked_at = $old`), and must then resume safely: re-call the PSP with the same deterministic idempotency key, so a charge that already happened is returned, not repeated. This is why the downstream key matters as much as your own."
        },
        {
          "q": "A merchant reuses the same idempotency key with a different amount by mistake. What should the API do?",
          "a": "Reject it. Store a hash of the canonical request (method, path, body fields that matter) alongside the key; on a replay, compare hashes and return 422 'idempotency key reused with different parameters' if they differ. Silently returning the first response would hide a real bug on the merchant side and could make them believe the second payment went through. Scope keys per merchant/API account so different merchants can't collide."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-02',
      difficulty: 'medium',
      question:
        'A client calls POST /transfers, gets a 504 from the gateway, and must decide what to do. Which approach is correct?',
      options: [
        'Treat 504 as a failure and create a new transfer with a new idempotency key',
        'Call GET /transfers to list recent transfers and compare amounts before deciding',
        'Retry with the same idempotency key; the server either executes it once or replays the original result',
        'Never retry POSTs; ask the user to check their bank statement',
      ],
      correct: [2],
      explanation:
        'A 504 means the outcome is unknown — the transfer may have succeeded. Retrying with the same key is safe by design: executed at most once, and the replay returns the original response. A new key risks a duplicate transfer; heuristically comparing amounts is fragile and racy; refusing to retry pushes the problem onto users.',
      followUps: [
        {
          "q": "The client retries with the same key 26 hours later, after your 24-hour key retention expired. What happens, and how should the design handle it?",
          "a": "The key is gone, so the server treats it as new and may execute a second transfer. Mitigations: document the retention window and make SDKs give up and query status well within it; keep a second, business-level guard that outlives keys, such as a unique client reference per transfer (`UNIQUE (account_id, client_reference)`) stored permanently with the transfer; and make clients resolve unknown outcomes via GET /transfers?client_reference=… rather than blind late retries."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-03',
      difficulty: 'expert',
      question:
        'In 2PC, the coordinator crashes after participants A and B have both voted YES but before any decision was sent. Which statements are true? Select ALL that apply.',
      options: [
        'A and B cannot unilaterally commit or abort; they must wait for the coordinator (or its durable log) to learn the decision',
        'A and B keep holding the locks for the in-doubt transaction, blocking conflicting transactions',
        'A and B can safely abort after a timeout because no decision was made',
        'If the coordinator had durably logged COMMIT before crashing, recovery must commit on both participants',
      ],
      correct: [0, 1, 3],
      explanation:
        'After voting YES a participant has promised it can commit, and it cannot know whether the coordinator logged COMMIT before crashing — so it must wait, holding locks (the blocking problem). Aborting on timeout is unsafe precisely because the coordinator may have decided COMMIT and informed another participant. On recovery, a logged decision is authoritative and must be completed everywhere.',
      followUps: [
        {
          "q": "The coordinator's disk is lost permanently, so its log is gone. A and B are stuck in-doubt holding locks. How do you get out?",
          "a": "There is no safe automatic answer: the participants must learn the decision from somewhere. If any participant already received COMMIT (or ABORT), the others can ask it (cooperative termination) and follow. If all are in-doubt with no log, an operator must decide heuristically — XA calls this a heuristic commit/rollback — accepting possible inconsistency and reconciling afterwards. The real fix is preventing this: replicate the coordinator's log (e.g. via Paxos/Raft), which is what Spanner does with Paxos groups as coordinators."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-04',
      difficulty: 'hard',
      question:
        'In a TC/C wallet transfer, the Cancel for transaction X arrives at the wallet service before the (delayed) Try for X. What must the participant do?',
      options: [
        'Ignore the Cancel because nothing was reserved, then process Try normally when it arrives',
        'Return an error for Cancel so the coordinator retries until Try has run',
        'Process the Try immediately when Cancel arrives to keep the order correct',
        'Record X as CANCELLED (empty rollback) and reject the late Try so funds are not frozen forever',
      ],
      correct: [3],
      explanation:
        'This is the empty-rollback plus hanging (out-of-order) problem. Cancel must succeed idempotently even though Try never ran, leaving a marker; when the late Try arrives it sees the marker and does nothing — otherwise it would freeze funds with no future Confirm/Cancel to release them. Ignoring the Cancel or forcing retries leaves the same hanging risk.',
      followUps: [
        {
          "q": "How long must the participant keep the CANCELLED marker for transaction X before deleting it?",
          "a": "Longer than the maximum time a delayed Try can still arrive: the coordinator's total retry window plus network and queue delays. If Try retries for up to 1 hour and messages can sit in a queue for a day, keep markers for several days, then purge by partition. If the marker is purged early and a stale Try arrives, it freezes funds with no Confirm/Cancel coming, so also add a sweeper that cancels TRIED branches older than the global transaction timeout."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-05',
      difficulty: 'expert',
      question:
        'Which statements about sagas are correct? Select ALL that apply.',
      options: [
        'Sagas provide atomicity (eventually) but not isolation; other transactions can observe intermediate states',
        'After the pivot transaction succeeds, the remaining steps must be retried until they succeed rather than compensated',
        'A compensating transaction must restore the database to the exact bytes it had before the forward step',
        'Semantic locks (e.g. an order in PENDING state) are a countermeasure for the lack of isolation',
      ],
      correct: [0, 1, 3],
      explanation:
        'Sagas are ACD without I; countermeasures such as semantic locks, commutative updates and rereading values address the anomalies. Past the pivot (point of no return) the saga moves forward with retriable steps. Compensations are semantic — a refund entry, a cancellation email — not byte-level rollbacks; other transactions may have changed the data since.',
      followUps: [
        {
          "q": "Two sagas run concurrently: one reserves the last unit of stock, then fails and compensates; meanwhile the other sees 'out of stock' and rejects its customer. How do you reduce these dirty-read effects?",
          "a": "That's a lost sale due to missing isolation. Countermeasures: semantic locks — mark the unit as RESERVED (pending) rather than decrementing available stock, so readers can treat pending reservations differently (e.g. wait-list or 'try again shortly'); order steps so likely failures (payment authorization, fraud checks) run before the reservation; keep reservation TTLs short so compensation frees stock fast. Accept some anomalies but measure them, e.g. rejections followed by stock release within N seconds."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-06',
      difficulty: 'hard',
      question:
        'An order service publishes an event inside its DB transaction as below. Which statement correctly describes the risk and the fix?',
      code: {
        language: 'typescript',
        code: `await db.query('BEGIN');
await db.query('INSERT INTO orders ...');
await kafka.send({ topic: 'orders', messages: [event] });
await db.query('COMMIT');`,
      },
      options: [
        'None — publishing inside the transaction makes it atomic',
        'COMMIT succeeds but the send is lost after a crash → order without event; send before COMMIT → phantom event if COMMIT fails. Both are dual-write failures; fix with an outbox written in the same transaction',
        'Kafka send succeeds but COMMIT fails → a phantom event for an order that doesn\'t exist; fix by moving the send after COMMIT',
        'Only network partitions between the service and Kafka cause problems; add retries to send()',
      ],
      correct: [1],
      explanation:
        'Kafka isn\'t part of the DB transaction, so ordering the calls just chooses which inconsistency you get: here, a send that succeeds followed by a failed COMMIT yields a phantom event, and if you move the send after COMMIT a crash yields an order without an event. Retries don\'t help if the process dies. Writing the event to an outbox table in the same transaction makes both commit together.',
      followUps: [
        {
          "q": "You add the outbox table. The relay publishes the event but crashes before marking the row published. What happens, and who has to cope with it?",
          "a": "On restart the relay republishes the same row, so the event appears twice in Kafka. The outbox gives at-least-once delivery, never exactly-once, so consumers must dedupe — typically with an inbox table keyed by the outbox row's ID carried in a header. The relay should publish with acks=all and an idempotent producer to avoid extra duplicates from its own retries, and mark rows in batches after the send resolves."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-07',
      difficulty: 'expert',
      question:
        'A Kafka consumer does this. A rebalance happens after the ledger insert but before the offset commit. What is the outcome, and which fix is correct?',
      code: {
        language: 'typescript',
        code: `eachMessage: async ({ message }) => {
  const e = JSON.parse(message.value!.toString());
  await db.query('INSERT INTO ledger (payment_id, amount) VALUES ($1, $2)', [e.paymentId, e.amount]);
  // offsets auto-committed periodically
}`,
      },
      options: [
        'The message is lost; switch to at-most-once',
        'Kafka\'s idempotent producer prevents redelivery, so nothing happens',
        'The message is redelivered and the ledger gets a duplicate entry; insert the event ID into an inbox table (unique) in the same DB transaction as the ledger entry, and commit offsets after the DB commit',
        'Enable exactly_once_v2 on the consumer; that deduplicates DB writes',
      ],
      correct: [2],
      explanation:
        'Offsets weren\'t committed, so the new owner of the partition reprocesses the message: at-least-once delivery produces a duplicate ledger row. The consumer must make the effect idempotent — inbox or unique business key committed atomically with the effect. The idempotent producer only dedups producer retries, and Kafka EOS covers Kafka outputs, not Postgres writes.',
      followUps: [
        {
          "q": "The inbox table grows by 50M rows a day. How do you keep dedup cheap without losing protection?",
          "a": "Bound it by the redelivery window: events can only be redelivered while they're within Kafka retention or a replay window you control, say 7 days. Partition the inbox by day and drop old partitions instead of deleting rows. Alternatively, if the effect has a natural unique key (`UNIQUE (payment_id)` on the ledger), you don't need a separate inbox at all: the business constraint is the dedup. For full replays older than the window, rely on the business key or truncate-and-rebuild."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-08',
      difficulty: 'hard',
      question:
        'Which scenarios are genuinely exactly-once in effect? Select ALL that apply.',
      options: [
        'Kafka Streams with exactly_once_v2 reading topic A and writing aggregated results to topic B',
        'A consumer that charges a card via a PSP API with a deterministic idempotency key per payment, retried on failure',
        'A consumer that sends an SMS per message with at-least-once delivery and no dedup',
        'A consumer that writes to Postgres and stores its Kafka offsets in the same Postgres transaction, seeking to them on startup',
      ],
      correct: [0, 1, 3],
      explanation:
        'Kafka-to-Kafka with transactions is exactly-once; retries with an idempotency key honoured by the PSP yield one charge; storing offsets atomically with the DB write makes the DB the exactly-once boundary. The SMS consumer is at-least-once with a non-idempotent side effect, so duplicates reach users after any redelivery.',
      followUps: [
        {
          "q": "The SMS consumer can't use a provider idempotency key. How close to exactly-once can you get, and which way should it fail?",
          "a": "Record intent and outcome in your own DB: insert `(event_id) ON CONFLICT DO NOTHING` before sending; only the winner sends. If the process crashes after the insert but before the provider accepts, you've lost an SMS (at-most-once); if you insert after sending, a crash duplicates it (at-least-once). Pick based on harm — an OTP should prefer at-least-once (resend is fine), a marketing SMS prefers at-most-once. Exactly-once with a non-idempotent external side effect isn't achievable."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-09',
      difficulty: 'medium',
      question:
        'A payment call to the PSP times out after 10 s. What should the payment service record for the order?',
      options: [
        'PAYMENT_UNKNOWN, then resolve by querying the PSP by reference/idempotency key or waiting for the webhook',
        'PAID, because most timeouts are slow successes',
        'PAYMENT_FAILED, so the user can try again immediately',
        'Delete the payment record and let reconciliation recreate it',
      ],
      correct: [0],
      explanation:
        'A timeout is an unknown outcome. Marking failed invites a second payment (duplicate charge if the first succeeded); marking paid ships goods that may be unpaid. An explicit UNKNOWN state resolved by an authoritative lookup (and backed by reconciliation) is correct. Deleting records destroys the audit trail that reconciliation depends on.',
      followUps: [
        {
          "q": "The resolver queries the PSP for an UNKNOWN payment, and the PSP says 'no such charge'. Can you mark it failed now?",
          "a": "Not immediately. The PSP may still be processing the request (it timed out on your side, not theirs), or its lookup API may be eventually consistent. Wait until a safety window passes (e.g. the PSP's documented max processing time), query again by idempotency key, and then mark failed. Even then, reconciliation against the settlement file is the final check; if a charge appears later, auto-refund or attach it to the order. Never let the user retry with a new key during the window."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-10',
      difficulty: 'expert',
      question:
        'Two outbox relays poll the same outbox table with FOR UPDATE SKIP LOCKED and publish to a topic keyed by order_id. A consumer sees OrderShipped before OrderPaid for some orders. Why?',
      code: {
        language: 'sql',
        code: `SELECT * FROM outbox
WHERE published_at IS NULL
ORDER BY created_at
LIMIT 500
FOR UPDATE SKIP LOCKED;`,
      },
      options: [
        'Kafka reorders messages within a partition under load',
        'The producer lacks acks=all',
        'created_at has insufficient precision',
        'Relay 1 locks a batch containing OrderPaid; relay 2 skips those rows and publishes a later batch with OrderShipped first — SKIP LOCKED sacrifices ordering across relays',
      ],
      correct: [3],
      explanation:
        'SKIP LOCKED lets concurrent relays grab disjoint batches, so a later event can be published before an earlier one that is locked by a slower relay. Kafka preserves order within a partition only in the order it receives records. Fix: assign each relay a hash range of aggregate_id, use a single relay, or use CDC which follows commit order. acks and timestamp precision are unrelated to this reordering.',
      followUps: [
        {
          "q": "You switch to one relay per hash range of aggregate_id. How do you keep that safe when relay instances scale up, down or crash?",
          "a": "Ownership of each range must be exclusive: assign ranges via leases (e.g. Kubernetes leases, etcd, or a `relay_owner` row with a heartbeat and expiry), and fence a relay whose lease lapsed so it can't keep publishing after another took over. On handover the new owner restarts from the oldest unpublished row in its range, which may republish a few events — fine for at-least-once. Use a fixed number of ranges (e.g. 64) larger than the relay count so rebalancing moves ranges, not row hashes."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-11',
      difficulty: 'hard',
      question:
        'A checkout saga runs: create order → reserve stock → capture payment → create shipment. Shipment creation fails for 20 minutes because the carrier API is down. What should the orchestrator do?',
      options: [
        'Refund the payment, release the stock and cancel the order after the first failure',
        'Retry shipment creation with backoff (idempotent key), keep the order CONFIRMED-awaiting-shipment, and escalate if it exceeds an SLA',
        'Mark the saga FAILED and let the customer contact support',
        'Run all compensations but keep the payment captured',
      ],
      correct: [1],
      explanation:
        'Payment capture is the pivot; once it has succeeded the saga must move forward, and shipment creation is a retriable step. A temporary carrier outage should not refund the customer and release stock (poor UX and money churn); retry idempotently and escalate past an SLA. Marking FAILED or partially compensating leaves inconsistent state.',
      followUps: [
        {
          "q": "The carrier is down for 3 days, not 20 minutes. Do you still keep retrying the shipment step?",
          "a": "The saga still can't un-capture by reversing the pivot automatically, but business rules take over. After the SLA breach, escalate: switch to a fallback carrier (the step should be 'arrange shipment', not 'call carrier X'), notify the customer with an updated ETA, and offer cancellation. If the customer cancels, that's a new forward flow — refund plus stock release — not a compensation of the original saga. Keep retries capped with backoff so you don't hammer the carrier when it returns."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-12',
      difficulty: 'expert',
      question:
        'Which changes most directly prevent "customer charged twice" caused by a gateway retrying POST /pay after the service\'s upstream call to the PSP was slow? Select ALL that apply.',
      options: [
        'Pass a deterministic idempotency key (derived from the payment ID) on the PSP charge call',
        'Guard the charge with a conditional state transition (only AWAITING_PAYMENT → PAYMENT_PENDING proceeds)',
        'Increase the gateway timeout from 3 s to 30 s so retries happen less often',
        'Add a unique constraint allowing only one successful capture per order',
      ],
      correct: [0, 1, 3],
      explanation:
        'Idempotency at the PSP, an atomic state transition that lets only one request proceed, and a unique capture constraint each block the duplicate regardless of timing. A longer timeout merely makes the race rarer — the next slow PSP incident or a client-side retry reproduces it — so it is not a fix.',
      followUps: [
        {
          "q": "Which of these defences would you test first, and how?",
          "a": "The conditional state transition, because it's what stops concurrent duplicates inside your system. Test: fire 50 parallel POST /pay requests for the same order against a real database, with a fake PSP that sleeps 2 s; assert exactly one PSP call, one PAYMENT_PENDING transition, and 409s for the rest. Then test the PSP key by killing the handler after the PSP call and retrying, asserting the fake PSP saw the same key twice and charged once. Finally, a unique capture constraint test asserts the DB rejects a second capture row."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-13',
      difficulty: 'hard',
      question:
        'This TC/C Confirm handler is retried by the coordinator after a network timeout. What goes wrong?',
      code: {
        language: 'sql',
        code: `-- confirm(xid)
UPDATE wallets SET frozen = frozen - $amount WHERE account_id = $acct;
UPDATE tcc_branch SET state = 'CONFIRMED' WHERE xid = $xid;`,
      },
      options: [
        'Each retry subtracts the amount from frozen again — the transition must be conditional (UPDATE ... WHERE xid = $xid AND state = \'TRIED\') and drive the wallet change from that row in one transaction',
        'Nothing; Confirm is naturally idempotent',
        'Confirm should re-run Try first to be safe',
        'The coordinator should call Cancel instead of retrying Confirm',
      ],
      correct: [0],
      explanation:
        'The balance update is unconditional, so every retry (inevitable after timeouts) debits frozen funds again. Making the state transition conditional and applying the wallet change only when it actually moves TRIED → CONFIRMED (in one transaction) makes Confirm idempotent. Re-running Try double-freezes, and switching to Cancel after a possibly successful Confirm corrupts the outcome.',
      followUps: [
        {
          "q": "The coordinator sends Confirm, then due to a bug also sends Cancel for the same xid. What should the participant do?",
          "a": "Transitions must be one-way and conditional: Cancel applies only `WHERE state = 'TRIED'`. Since state is already CONFIRMED, Cancel affects zero rows and returns success-with-no-op or a 'conflict' response, never unfreezing or refunding funds. Log it as an anomaly with the xid and alert, because a coordinator issuing both decisions means its own state machine is broken. Test this matrix explicitly: every message type in every state, including duplicates and out-of-order arrivals."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-14',
      difficulty: 'medium',
      question:
        'Why does a payment system still need daily reconciliation against PSP settlement reports if every step is idempotent?',
      options: [
        'It doesn\'t; idempotency guarantees consistency with third parties',
        'Only for tax purposes',
        'Because third parties and internal processes can still diverge (lost/late webhooks, PSP-side errors, manual fixes, bugs), and settlement reports are the financial source of truth',
        'Because idempotency keys expire after 24 hours',
      ],
      correct: [2],
      explanation:
        'Idempotency prevents duplicates from retries, but it cannot detect a missed webhook, a PSP double-settlement, a fee change, or a bug in your own state machine. Reconciliation compares independent records and is the last line of defence. Key expiry is a detail, and tax is not the primary driver.',
      followUps: [
        {
          "q": "Reconciliation finds your ledger has 1,240 captured payments for yesterday but the PSP settlement file has 1,238. Walk through what happens next.",
          "a": "Match records by PSP reference, not just counts, to find the 2 unmatched. Classify them: still settling (captured late in the day, will appear tomorrow), a PSP-side failure after you recorded success (webhook or API inconsistency), or a bug on your side recording a capture that never happened. Auto-resolve known categories (timing differences roll into the next day's run), open tickets for the rest, and don't ship or pay out against unmatched captures above a threshold. Track the mismatch rate as a metric."
        }
      ],
    },
    {
      id: 'ds-transactions-mcq-15',
      difficulty: 'expert',
      question:
        'You must choose between choreography and orchestration for a 6-step loan-disbursement saga with regulatory audit requirements. Which reasoning is strongest?',
      options: [
        'Choreography, because events decouple services and scale better',
        'Orchestration using 2PC between all six services for atomicity',
        'Choreography with a shared database table that every service updates',
        'Orchestration: an explicit, persisted state machine gives one place to see each loan\'s state, enforce step order and timeouts, run compensations, and produce an audit trail',
      ],
      correct: [3],
      explanation:
        'For many steps, money and audit needs, an orchestrator makes the flow explicit and testable, centralises timeouts and compensations, and trivially answers "where is loan X and why?". Choreography scatters that logic and state across services; a shared table couples services at the data layer; 2PC across six services is blocking and operationally fragile — the orchestrator still uses local transactions and outbox.',
      followUps: [
        {
          "q": "The orchestrator itself crashes mid-saga. How does it recover without re-running completed steps or skipping one?",
          "a": "Persist the saga state machine after every step transition in the orchestrator's DB (or use a durable workflow engine such as Temporal/Camunda). Each step command carries a deterministic idempotency key (saga ID + step), and is sent via an outbox in the same transaction as the state change. On restart, the orchestrator loads sagas in non-terminal states and resends the current step's command; participants dedupe by the key, so a step that had already completed just returns its result."
        }
      ],
    },
  ],
};

export default topic;
