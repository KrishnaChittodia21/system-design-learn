import type { ChallengeSet, Expr } from '../types';

const hold: Expr = { knob: 'hold' };
const pool: Expr = { knob: 'pool' };
const bouncer: Expr = { knob: 'bouncer' };
const tenant: Expr = { knob: 'tenant' };

/** scenario: 60 pods at HPA max, 100 req/s each */
const PODS = 60;
const RPS_PER_POD = 100;

const set: ChallengeSet = {
  topic: 'db-connections-locks',
  puzzles: [
    {
      mode: 'match',
      id: 'lock-incidents',
      tab: 'Lock incidents',
      title: 'On call for locks: match each incident to its fix',
      brief:
        'Five lock incidents from one bad week on the payments database. Patch each to the fix that removes the cause. Two of the "fixes" on the right only hide the problem.',
      leftTitle: 'Incident',
      rightTitle: 'Fix',
      left: [
        {
          id: 'queue',
          label: 'Job workers queue behind each other on the same row',
          answer: 'skip',
          because: 'FOR UPDATE SKIP LOCKED lets each worker skip rows another worker holds, so many workers pull jobs in parallel.',
        },
        {
          id: 'ddl',
          label: 'ALTER TABLE waits, then every SELECT behind it hangs',
          answer: 'locktimeout',
          because: 'A waiting ACCESS EXCLUSIVE blocks everything queued behind it; lock_timeout makes the DDL give up and retry instead.',
        },
        {
          id: 'deadlock',
          label: 'Batch job and API hit 40P01 updating the same accounts',
          answer: 'order',
          because: 'Deadlocks need a cycle; locking rows in one deterministic order (sorted ids) makes a cycle impossible. Retry the victim.',
        },
        {
          id: 'hot',
          label: "One merchant's balance row caps at ~330 updates/s",
          answer: 'shard',
          because: 'A hot row allows about 1 / lock-hold-time updates; splitting it into sub-counters or batching removes the single queue.',
        },
        {
          id: 'idle',
          label: "Sessions sit 'idle in transaction' holding locks",
          answer: 'idletx',
          because: 'idle_in_transaction_session_timeout kills sessions that hold a transaction open doing nothing, releasing their locks.',
        },
      ],
      right: [
        { id: 'skip', label: 'FOR UPDATE SKIP LOCKED', is: 'a row lock that silently skips rows already locked by others' },
        { id: 'locktimeout', label: "SET lock_timeout = '2s'", sub: 'retry with backoff', is: 'a cap on how long a statement waits for a lock' },
        { id: 'order', label: 'Lock rows in sorted id order', sub: '+ retry on 40P01', is: 'acquiring locks in one deterministic order so no wait cycle can form' },
        { id: 'shard', label: 'Sharded counter / batching', sub: 'split the hot row', is: 'spreading updates over several rows or batching them so no single row is the bottleneck' },
        { id: 'idletx', label: 'idle_in_transaction timeout', sub: 'e.g. 10–30 s', is: 'a server-side limit that ends sessions idling inside an open transaction' },
        {
          id: 'deadlocktimeout',
          label: 'Raise deadlock_timeout to 60 s',
          decoy: true,
          is: 'only a delay before Postgres checks for deadlocks: cycles still happen, and victims now wait a minute first',
        },
        {
          id: 'biggerpool',
          label: 'Double every pool size',
          decoy: true,
          is: 'more connections waiting on the same locks: it adds contention inside the database instead of removing it',
        },
      ],
      why: [
        'SKIP LOCKED turns a lock queue into parallel work for queues and seat allocation; NOWAIT is the try-lock variant.',
        'Always SET lock_timeout before DDL: a waiting ALTER blocks every later reader on the table.',
        'Consistent lock ordering prevents deadlocks; the victim must retry the whole transaction with jitter.',
        'Hot-row throughput ≈ 1 / lock-hold time: shrink the hold or split the row. Layered timeouts stop idle holders.',
      ],
    },
    {
      mode: 'sequence',
      id: 'transfer-deadlock-detect',
      tab: 'Deadlock timeline',
      title: 'Two transfers, one deadlock: what Postgres does',
      brief:
        'At the same instant one request moves ₹500 from account 7 to account 9 and another moves ₹200 from 9 to 7, each locking the source row first. Put the events in the order they really happen, up to the moment both transfers have succeeded.',
      layout: 'stages',
      steps: [
        { id: 't1a', label: 'T1 locks account 7', sub: 'UPDATE … id = 7', clue: 'First transfer takes its source', is: 'T1 taking a row lock on its source row, held until the transaction ends' },
        { id: 't2b', label: 'T2 locks account 9', sub: 'UPDATE … id = 9', clue: 'Second transfer takes its source', is: 'T2 taking a row lock on its own source row, the one T1 will need next' },
        { id: 't1w', label: 'T1 waits for account 9', sub: 'a row lock wait', clue: 'First one blocks on the other', is: 'T1 queueing for a row lock that T2 holds' },
        { id: 't2w', label: 'T2 waits for account 7', sub: 'wait cycle formed', clue: 'Now each waits for the other', is: 'the second half of the cycle: neither transaction can ever proceed on its own' },
        { id: 'detect', label: 'Detector runs after 1 s', sub: 'deadlock_timeout', clue: 'A long wait triggers a check', is: 'the deadlock detector, which a backend runs once it has waited longer than deadlock_timeout (default 1 s) and which finds the cycle' },
        { id: 'abort', label: 'T2 aborted: 40P01', sub: 'T1 gets the lock, commits', clue: 'One victim breaks the cycle', is: 'Postgres aborting one transaction with "deadlock detected" so the other can finish' },
        { id: 'retry', label: 'App retries T2 with jitter', sub: 'whole transaction again', clue: 'The victim tries once more', is: 'the application re-running the whole victim transaction after a jittered backoff, which now succeeds' },
      ],
      decoys: [
        { id: 'both', label: 'Both transactions abort', sub: 'cycle cleared', is: 'not what happens: Postgres aborts only one victim, and the other keeps its locks and commits' },
        { id: 'wait50', label: 'Both time out after 50 s', sub: 'lock wait timeout', is: 'InnoDB’s innodb_lock_wait_timeout fallback when its detection is switched off; Postgres runs its detector after deadlock_timeout instead' },
        { id: 'retrystmt', label: 'Retry only the failed UPDATE', sub: 'same transaction', is: 'impossible: the victim transaction is aborted, so the whole transaction must be retried from BEGIN' },
      ],
      why: [
        'A deadlock is a wait cycle: T1 holds 7 and wants 9 while T2 holds 9 and wants 7.',
        'Postgres checks for cycles only after a lock wait exceeds deadlock_timeout (1 s), then aborts one victim with 40P01.',
        'Deadlocks are expected under concurrency: retry the whole transaction with jittered backoff and alert on the rate.',
        'Prevent most of them by locking rows in one order (smaller id first), so both transfers queue on the same row instead.',
      ],
    },
    {
      mode: 'route',
      id: 'pooler-path-routing',
      tab: 'Which connection?',
      title: 'PgBouncer in transaction mode: what may go through it?',
      brief:
        'The orders platform runs 60 pods behind PgBouncer in transaction mode (default_pool_size 40) in front of a 16-core primary with max_connections = 100. A few direct session connections and a read replica also exist. Route each workload so it works correctly and cannot starve checkout.',
      cols: 4,
      rows: 3.4,
      nodes: [
        { id: 'svc', label: 'Services & jobs', sub: '60 pods, cron, tools', kind: 'terminal', col: 0, row: 1.2 },
        { id: 'pgb', label: 'PgBouncer', sub: 'transaction mode · 40', col: 1.5, row: 0.05 },
        { id: 'direct', label: 'Direct session', sub: 'few reserved slots', col: 1.5, row: 1.2 },
        { id: 'replica', label: 'Read replica', sub: 'reports pool', col: 1.5, row: 2.35 },
        { id: 'primary', label: 'Postgres primary', sub: '16 cores · max 100', col: 3, row: 0.6 },
      ],
      edges: [
        ['svc', 'pgb'],
        ['svc', 'direct'],
        ['svc', 'replica'],
        ['pgb', 'primary'],
        ['direct', 'primary'],
      ],
      packets: [
        {
          id: 'checkout',
          label: 'Checkout: 3 statements in one transaction',
          sub: 'SET LOCAL app.tenant · ~5 ms',
          from: 'svc',
          to: 'primary',
          paths: [['svc', 'pgb', 'primary']],
          wrong: {
            'svc>direct':
              'If every pod opened its own session connections, 60 pods × their pool max would blow past max_connections = 100. Short transactions are exactly what the pooler multiplexes.',
            'svc>replica': 'A replica is read-only: an INSERT or UPDATE fails there. Checkout writes must reach the primary.',
          },
          done: 'A short transaction that uses SET LOCAL is safe in transaction mode: the server connection returns to the pool at COMMIT, so thousands of client connections share ~40 busy ones.',
        },
        {
          id: 'listen',
          label: 'Worker: LISTEN order_events (long-lived)',
          sub: 'session state',
          from: 'svc',
          paths: [['svc', 'direct', 'primary']],
          wrong: {
            'svc>pgb':
              'Transaction pooling hands the server connection to someone else after each transaction, so a LISTEN registered on it is lost. LISTEN/NOTIFY is on the list of things transaction mode breaks.',
            'svc>replica': 'NOTIFY is sent by transactions that commit on the primary, and a hot-standby replica does not support LISTEN at all.',
          },
          done: 'Session features such as LISTEN need a real session connection to the primary. Keep these few and long-lived, and count them in the connection budget.',
        },
        {
          id: 'migration',
          label: 'Migration: ALTER TABLE orders ADD COLUMN',
          sub: 'tool holds a session advisory lock',
          from: 'svc',
          to: 'primary',
          paths: [['svc', 'direct', 'primary']],
          wrong: {
            'svc>pgb':
              'Session-level advisory locks (pg_advisory_lock) break under transaction pooling: the lock stays on a server connection your next statement may not get.',
            'svc>replica': 'DDL changes the primary’s schema. A replica is read-only and only replays what the primary did.',
          },
          right: { 'direct>primary': 'Run it with SET lock_timeout = \'2s\' so it gives up instead of queueing every query behind it.' },
          done: 'The migration needs a session for its advisory lock, and it runs with lock_timeout so a waiting ACCESS EXCLUSIVE cannot freeze the table.',
        },
        {
          id: 'report',
          label: 'Monthly revenue report: a 4-minute query',
          sub: 'read only, can be seconds stale',
          from: 'svc',
          paths: [['svc', 'replica']],
          wrong: {
            'svc>pgb':
              'A 4-minute query holds one of the 40 server connections the whole time. A few of them starve checkout, and an API statement_timeout of 1–5 s would cancel it anyway.',
            'svc>direct':
              'On the primary a long query still competes with checkout for CPU and I/O, and holds an old snapshot the whole time. Long reads belong somewhere else.',
          },
          done: 'Long reports go to a read replica through their own pool (a bulkhead), so they can never take connections or CPU from OLTP traffic.',
        },
      ],
      why: [
        'Transaction mode multiplexes many client connections onto ~40 server connections, but forbids session state: SET (use SET LOCAL), session advisory locks, LISTEN/NOTIFY.',
        'Keep a few direct session connections for listeners and migrations, and count them in the max_connections budget.',
        'Migrations run with lock_timeout so DDL cannot queue the whole table behind it.',
        'Separate pools, or a replica, for long reports: a bulkhead so one query class cannot starve another.',
      ],
    },
    {
      mode: 'tune',
      id: 'sale-pool-sizing',
      tab: 'Pool sizing',
      title: 'Flash sale: "remaining connection slots are reserved"',
      brief:
        'orders-api scales to 60 pods at 100 req/s each against a 16-core Postgres with max_connections = 100. Each request holds its connection across an 80 ms payment call. Size the pools so the sale survives.',
      cols: 4,
      rows: 2.8,
      nodes: [
        { id: 'pods', label: '60 pods × pool {pool}', sub: '100 req/s each', kind: 'terminal', col: 0, row: 1.1 },
        { id: 'direct', label: 'Direct connections', sub: 'pods × pool max', col: 1.5, row: 0.3, showIf: { left: bouncer, op: '==', right: 0 } },
        { id: 'pgb', label: 'PgBouncer', sub: 'transaction mode', col: 1.5, row: 1.9, showIf: { left: bouncer, op: '==', right: 1 } },
        { id: 'pg', label: 'Postgres primary', sub: '16 cores · max 100', col: 3, row: 1.1 },
      ],
      edges: [
        ['pods', 'direct'],
        ['direct', 'pg'],
        ['pods', 'pgb'],
        ['pgb', 'pg', '≤ 60 conns'],
      ],
      knobs: [
        {
          id: 'hold',
          label: 'Connection hold time',
          kind: 'choice',
          initial: 85,
          choices: [
            { value: 85, label: '85 ms (across HTTP)' },
            { value: 5, label: '5 ms (queries only)' },
          ],
          help: 'call the payment API before taking a connection?',
        },
        {
          id: 'pool',
          label: 'Pool max per pod',
          kind: 'choice',
          initial: 20,
          choices: [
            { value: 2, label: '2' },
            { value: 5, label: '5' },
            { value: 10, label: '10' },
            { value: 20, label: '20' },
          ],
        },
        { id: 'bouncer', label: 'PgBouncer in between', kind: 'toggle', initial: 0, help: 'transaction pooling, default_pool_size 40' },
        {
          id: 'tenant',
          label: 'Tenant setting per tx',
          kind: 'choice',
          initial: 0,
          choices: [
            { value: 0, label: 'SET (session)' },
            { value: 1, label: 'SET LOCAL' },
          ],
          help: 'how search_path is set per request',
        },
      ],
      constraints: [
        {
          id: 'little',
          label: 'Pool ≥ λ × hold time',
          left: pool,
          op: '>=',
          right: { op: 'div', args: [{ op: 'mul', args: [RPS_PER_POD, hold] }, 1000] },
          unit: ' conns',
          decimals: 1,
          hint: "Little's Law: connections in use = request rate × how long each request holds one.",
          fail: 'The pool is smaller than the connections each pod needs on average, so requests queue for a connection.',
          pass: 'Each pod has at least λ × W connections, plus headroom for bursts.',
        },
        {
          id: 'busy',
          label: 'Busy DB connections ≤ 40',
          left: { op: 'div', args: [{ op: 'mul', args: [PODS, RPS_PER_POD, hold] }, 1000] },
          op: '<=',
          right: 40,
          unit: ' conns',
          hint: 'A 16-core server does best with about 2 × cores (+ spindles) active connections. What drives demand?',
          fail: 'Holding connections across an 80 ms HTTP call makes 6,000 req/s need ~510 busy connections: holding time, not query time, dominates.',
          pass: 'With connections held only for the queries, the whole fleet needs ~30 busy connections, within the 32–40 a 16-core DB handles well.',
        },
        {
          id: 'slots',
          label: 'Connections opened at Postgres',
          left: { op: 'if', cond: { left: bouncer, op: '==', right: 1 }, then: 60, else: { op: 'mul', args: [PODS, pool] } },
          op: '<=',
          right: 100,
          unit: ' conns',
          hint: 'Total = pods × pool max. What can sit between 60 pods and the database?',
          fail: 'pods × pool max exceeds max_connections: new pods get "remaining connection slots are reserved".',
          pass: 'PgBouncer multiplexes thousands of client connections onto at most 60 server connections (max_db_connections).',
        },
        {
          id: 'session',
          label: 'Session state broken',
          display: { pass: 'not broken', fail: 'SET leaks across clients' },
          left: { op: 'if', cond: { all: [{ left: bouncer, op: '==', right: 1 }, { left: tenant, op: '==', right: 0 }] }, then: 1, else: 0 },
          op: '==',
          right: 0,
          hint: 'In transaction mode, the next transaction may run on a different server connection.',
          fail: 'A session-level SET leaks to whichever client gets that server connection next under transaction pooling.',
          pass: 'SET LOCAL lasts only for the transaction, so it is safe with transaction pooling.',
        },
      ],
      why: [
        "Per pod, connections = λ × hold time (Little's Law); never hold a connection across a call to another service.",
        'The database wants ~2 × cores active connections; total opened = Σ pods × pool max, and autoscaling multiplies it.',
        'Put PgBouncer (transaction mode) in between and let clients queue there, not inside Postgres.',
        'Transaction pooling forbids session state: use SET LOCAL, transaction-level advisory locks, no LISTEN/NOTIFY.',
      ],
    },
    {
      mode: 'fault',
      id: 'slots-reserved-incident',
      tab: '14:02 incident',
      title: '14:02: "remaining connection slots are reserved"',
      brief:
        'API errors hit 38% and p99 sits at 10 s. pg_stat_activity shows dozens of sessions "idle in transaction" from the payment handler, report queries running for minutes, and requests that wait for a connection until the gateway gives up. Find the three misconfigured pieces.',
      cols: 5,
      rows: 3.1,
      nodes: [
        { id: 'clients', label: 'Shoppers', sub: 'checkout + reports', kind: 'terminal', col: 0, row: 1 },
        { id: 'gw', label: 'API gateway', sub: 'request timeout 10 s', col: 1, row: 1, fine: 'A 10 s request timeout is the outermost layer, as it should be. Every layer inside it must be shorter, and those are the ones missing.' },
        {
          id: 'pay',
          label: 'Payment handler',
          sub: 'connect(), no finally',
          col: 2.1,
          row: 0.1,
          fault: {
            answer: 'withtx',
            clue: 'Always end and give back',
            why: 'An exception between BEGIN and COMMIT skips release(), so the client stays checked out and the session sits "idle in transaction", holding locks and a snapshot. The pool drains a little with every error.',
          },
        },
        {
          id: 'reports',
          label: 'Report endpoint',
          sub: 'shares the pool, no limit',
          col: 2.1,
          row: 1.95,
          fault: {
            answer: 'bulkhead',
            clue: 'Cap how many can run at once',
            why: 'Every report holds a connection for minutes. With no per-endpoint limit, a handful of report requests take the whole pool and checkout waits behind them.',
          },
        },
        {
          id: 'pool',
          label: 'Pod pool · max 10',
          sub: 'acquire timeout: none',
          col: 3.2,
          row: 1,
          fault: {
            answer: 'failfast',
            clue: 'Give up quickly when none is free',
            why: 'With an infinite acquire wait, requests pile up waiting for a connection until the gateway times them out at 10 s, after holding memory and threads the whole time.',
          },
        },
        { id: 'pgb', label: 'PgBouncer', sub: 'transaction mode · 40', col: 4.2, row: 0.15, fine: 'Transaction pooling with default_pool_size 40 is sized for a 16-core primary. It multiplexes fine; it just has nothing free to hand out while sessions leak and reports hog it.' },
        { id: 'pg', label: 'Postgres primary', sub: '16 cores · max 100', col: 4.2, row: 2, fine: 'The database is healthy: it is holding open transactions it was told to hold. A bigger max_connections would only add processes past the throughput peak.' },
      ],
      edges: [
        ['clients', 'gw'],
        ['gw', 'pay'],
        ['gw', 'reports'],
        ['pay', 'pool'],
        ['reports', 'pool'],
        ['pool', 'pgb'],
        ['pgb', 'pg'],
      ],
      options: [
        { id: 'withtx', label: 'Transaction helper', sub: 'withTx(fn): always release', is: 'a wrapper that always commits or rolls back and releases the client in finally, so no path can leak a connection' },
        { id: 'bulkhead', label: 'Bulkhead: 3 reports per pod', sub: '+ 15 s statement\u200B_timeout', is: 'a per-endpoint concurrency limit with a bounded statement budget, so reports can never take the whole pool' },
        { id: 'failfast', label: 'Acquire timeout 1 s', sub: '503 + Retry-After', is: 'a short wait for a pooled connection that fails fast and keeps the service responsive for requests that can succeed' },
        { id: 'pods', label: 'Scale out to 120 pods', sub: 'HPA max raised', decoy: true, is: 'more pods means more pools pointed at the same database, which makes connection exhaustion worse, not better' },
        { id: 'maxconn', label: 'max_connections = 1000', sub: 'more slots', decoy: true, is: 'more backend processes past the 2–4× cores throughput peak; leaked and hogged sessions would simply fill the new slots too' },
      ],
      metrics: [
        { label: 'API errors', bad: 38, good: 0.5, unit: '%', decimals: 1 },
        { label: 'API p99', bad: 10000, good: 120, unit: ' ms' },
        { label: 'Idle in transaction', bad: 70, good: 0, fixedBy: ['pay'] },
        { label: 'Pool waiters', bad: 400, good: 0, fixedBy: ['reports', 'pool'] },
      ],
      why: [
        'Leaks come from paths that skip release(): a withTransaction helper (plus idle_in_transaction_session_timeout) closes them.',
        'Timeouts nest: gateway 10 s > acquire 1 s + statement timeout. A short acquire timeout fails fast instead of piling requests up.',
        'Bulkheads give heavy endpoints their own small concurrency budget, so they cannot starve checkout.',
        'During the incident do not scale out or raise max_connections: more pods mean more pools, and more connections lower throughput.',
      ],
    },
  ],
};

export default set;
