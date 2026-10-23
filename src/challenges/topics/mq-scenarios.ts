import type { ChallengeSet, Expr } from '../types';

// Spike scenario numbers (from the lesson's worked example): normal 2K/s, spike 20K/s for 15 min.
const NORMAL = 2000;
const SPIKE = 20000;
const SPIKE_S = 15 * 60;
const PER_POD = 500; // msgs/s one consumer pod processes
const PODS: Expr = { knob: 'pods' };
const PARTS: Expr = { knob: 'parts' };
/** consumer capacity: pods beyond the partition count sit idle */
const CAP: Expr = { op: 'mul', args: [{ op: 'min', args: [PODS, PARTS] }, PER_POD] };
/** backlog built during the spike */
const BACKLOG: Expr = { op: 'mul', args: [{ op: 'sub', args: [SPIKE, CAP] }, SPIKE_S] };
/** minutes to drain after the spike; never drains when capacity ≤ normal traffic */
const DRAIN_MIN: Expr = {
  op: 'if',
  cond: { left: CAP, op: '<=', right: NORMAL },
  then: Infinity,
  else: { op: 'div', args: [BACKLOG, { op: 'sub', args: [CAP, NORMAL] }, 60] },
};

const set: ChallengeSet = {
  topic: 'mq-scenarios',
  puzzles: [
    {
      mode: 'flow',
      id: 'poison-pill-retries',
      tab: 'Retry tiers + DLQ',
      title: 'One poison pill froze partition 7',
      brief:
        'An order-events consumer retried a malformed message in place all night: partition 7’s lag grew forever while the others were fine. Wire the failure path so blips are ridden out, permanent errors never block the partition, and nothing disappears silently.',
      cols: 6,
      rows: 3.4,
      nodes: [
        { id: 'msg', label: 'orders.v1 message', sub: 'handler threw', kind: 'terminal', col: 0, row: 1.5 },
        { id: 'class', label: 'Error class?', kind: 'decision', col: 1, row: 1.5 },
        { id: 'dlq', answer: 'dlq', hint: 'Bad schema: never retry it', col: 3.5, row: 0.4 },
        { id: 'quick', answer: 'inplace', hint: 'Rides out a short blip', col: 1.9, row: 2.4 },
        { id: 'tier', answer: 'retrytopic', hint: 'Unblocks the partition, tries later', col: 3.5, row: 2.4 },
        { id: 'redrive', answer: 'redrive', hint: 'Replays after the bug is fixed', col: 5, row: 0.4 },
      ],
      edges: [
        ['msg', 'class'],
        ['class', 'dlq', 'permanent'],
        ['class', 'quick', 'transient'],
        ['quick', 'tier', 'still fails'],
        ['tier', 'dlq', 'last tier'],
        ['dlq', 'redrive', 'fixed'],
      ],
      options: [
        {
          id: 'dlq',
          label: 'DLQ with error headers',
          sub: 'alert on rate + age',
          is: 'a parking topic that keeps the message with its original topic, offset, attempt count and error, and pages someone when it fills',
        },
        {
          id: 'inplace',
          label: 'Retry 2–3× in place',
          sub: '100 ms–1 s backoff',
          is: 'a short in-place retry with backoff for timeouts, 503s and leader changes',
        },
        {
          id: 'retrytopic',
          label: 'Publish to retry.1m',
          sub: 'commit the original offset',
          is: 'a delay tier (1m → 10m → 1h) whose consumer pauses until not-before, so the main partition keeps flowing',
        },
        {
          id: 'redrive',
          label: 'Rate-limited redrive tool',
          sub: 'same event ids',
          is: 'a replay of DLQ messages back to the main topic at a safe rate, with the same ids so idempotent handlers skip what was already applied',
        },
        {
          id: 'forever',
          label: 'Retry in place until it wins',
          sub: 'never give up',
          decoy: true,
          is: 'exactly how partition 7 froze: a permanent error never succeeds, so the poison pill blocks every message behind it',
        },
        {
          id: 'sleep',
          label: 'sleep(10 min) in the handler',
          sub: 'then retry',
          decoy: true,
          is: 'a blocking wait that breaks the poll and heartbeat deadlines, so the group rebalances and the partition stalls anyway',
        },
        {
          id: 'drop',
          label: 'Log it and commit',
          sub: 'skip the message',
          decoy: true,
          is: 'a silent loss: the order event disappears with only a log line nobody alerts on',
        },
      ],
      why: [
        'Classify first: permanent errors (schema, validation, 4xx) go straight to the DLQ; only transient ones are retried.',
        'A few quick in-place retries ride out blips; anything longer moves to a retry topic and the original offset is committed, so the partition never blocks.',
        'Retry consumers pause until not-before instead of sleeping inside the handler, which would break poll and heartbeat deadlines.',
        'A DLQ needs an alert and a rate-limited redrive tool that reuses event ids; retry topics also break per-key order, so guard with version checks if order matters.',
      ],
    },
    {
      mode: 'tune',
      id: 'spike-load-leveling',
      tab: 'Spike load leveling',
      title: 'Flash sale: absorb a 10× spike with a queue',
      brief:
        'Normal traffic is 2K order events/s; the flash sale pushes 20K/s for 15 minutes. Each consumer pod handles 500/s and Postgres takes at most 6K writes/s. Size the topic and consumers so the receipts backlog clears within an hour and nothing expires first.',
      cols: 4.9,
      rows: 2.9,
      nodes: [
        { id: 'api', label: 'Checkout API', sub: '2K/s → 20K/s for 15 min', kind: 'terminal', col: 0, row: 0.6 },
        { id: 'topic', label: 'order-events', sub: '{parts} partitions', col: 1.4, row: 0.6 },
        { id: 'pods', label: '{pods} consumer pods', sub: '500/s each', col: 2.8, row: 0.6 },
        { id: 'pg', label: 'Postgres', sub: '≤ 6K writes/s', col: 3.9, row: 1.9 },
      ],
      edges: [
        ['api', 'topic', 'append'],
        ['topic', 'pods', 'poll'],
        ['pods', 'pg', 'write'],
      ],
      knobs: [
        { id: 'pods', label: 'Consumer pods', kind: 'stepper', min: 2, max: 20, initial: 4, help: '500 msgs/s per pod' },
        {
          id: 'parts',
          label: 'Partitions',
          kind: 'choice',
          initial: 6,
          choices: [
            { value: 6, label: '6' },
            { value: 12, label: '12' },
            { value: 24, label: '24' },
          ],
          help: 'max active consumers in one group',
        },
        {
          id: 'ret',
          label: 'Retention',
          kind: 'choice',
          initial: 60,
          unit: ' min',
          choices: [
            { value: 30, label: '30 min' },
            { value: 60, label: '1 h' },
            { value: 120, label: '2 h' },
          ],
          help: 'how long unconsumed events are kept',
        },
      ],
      constraints: [
        {
          id: 'idle',
          label: 'No idle consumer pods',
          left: PODS,
          op: '<=',
          right: PARTS,
          unit: ' pods',
          hint: 'In one consumer group, how many consumers can own a partition at the same time?',
          fail: 'More pods than partitions: the extra pods get no partition and sit idle, adding cost but no throughput.',
          pass: 'Every pod owns at least one partition, so each one adds real throughput.',
        },
        {
          id: 'db',
          label: 'DB writes ≤ 6K/s',
          left: CAP,
          op: '<=',
          right: 6000,
          unit: '/s',
          hint: 'Consumers drain only as fast as the database behind them can write.',
          fail: 'The consumers would write faster than Postgres can take: you have moved the overload from the queue to the database.',
          pass: 'The drain rate stays within what Postgres can absorb.',
        },
        {
          id: 'drain',
          label: 'Backlog drained ≤ 60 min after',
          left: DRAIN_MIN,
          op: '<=',
          right: 60,
          unit: ' min',
          decimals: 0,
          hint: 'Drain time = backlog ÷ (capacity − normal rate). Which knob raises capacity, and what caps it?',
          fail: 'Backlog = (20K − capacity) × 900 s, and it only drains at capacity − 2K/s: at this capacity the receipts are late for more than an hour (or never catch up).',
          pass: 'Enough spare capacity after the spike drains the backlog within the hour.',
        },
        {
          id: 'retention',
          label: 'Retention covers spike + drain',
          left: { knob: 'ret' },
          op: '>=',
          right: { op: 'add', args: [15, DRAIN_MIN] },
          unit: ' min',
          decimals: 0,
          hint: 'An event waits through the rest of the spike and the whole drain before it is read.',
          fail: 'Unread events would be deleted before consumers reach them: retention is shorter than spike + drain.',
          pass: 'Retention outlasts the 15-minute spike plus the drain, so nothing expires unread.',
        },
      ],
      why: [
        'A queue turns a spike into temporary lag instead of an outage: producers append in milliseconds, consumers drain at a sustainable rate.',
        'Backlog = (spike rate − capacity) × duration; drain time = backlog ÷ (capacity − post-spike rate). Do this math before the sale, not during it.',
        'Scaling consumers helps only up to the partition count and only while the database behind them keeps up: 12 pods × 500/s = 6K/s is the ceiling here.',
        'Retention must cover spike + drain with margin, and alert on lag in time, not message count.',
      ],
    },
    {
      mode: 'sequence',
      id: 'async-202-polling',
      tab: '202 + polling',
      title: 'The 40-second export: 202 Accepted and polling',
      brief:
        'POST /reports takes 10–40 s, the gateway times out at 30 s and clients retry into duplicate exports. Put the async request-reply exchange in order so the client never waits on an open request.',
      layout: 'ladder',
      actors: [
        { id: 'c', label: 'Client', sub: 'dashboard' },
        { id: 's', label: 'API', sub: 'reports' },
      ],
      steps: [
        {
          id: 'post',
          label: 'POST /reports + Idempotency-Key',
          sub: 'client UUID',
          from: 'c',
          to: 's',
          clue: 'Asks once, safe to retry',
          is: 'the request that creates the job; the client’s key makes a retried POST return the same job instead of a second export',
        },
        {
          id: 'accepted',
          label: '202 Accepted + Location',
          sub: 'Retry-After: 5',
          from: 's',
          to: 'c',
          clue: 'Job stored and queued',
          is: 'the immediate answer: the job is persisted as PENDING and enqueued, and Location points at /reports/jobs/{id}',
        },
        {
          id: 'poll1',
          label: 'GET /reports/jobs/{id}',
          sub: 'after Retry-After',
          from: 'c',
          to: 's',
          clue: 'Checks on progress',
          is: 'a poll of the status resource, sent after waiting the Retry-After interval',
        },
        {
          id: 'running',
          label: '200 { status: RUNNING }',
          sub: 'progress: 40%',
          from: 's',
          to: 'c',
          clue: 'Not done yet',
          is: 'the job’s current state while a worker is still generating the report',
        },
        {
          id: 'poll2',
          label: 'GET /reports/jobs/{id} again',
          sub: 'next interval',
          from: 'c',
          to: 's',
          clue: 'Tries again later',
          is: 'the next poll, again spaced by Retry-After so polling stays cheap',
        },
        {
          id: 'done',
          label: '303 See Other → result',
          sub: 'presigned S3 link',
          from: 's',
          to: 'c',
          clue: 'Points at the finished file',
          is: 'the redirect to the finished result resource once the job is SUCCEEDED',
        },
      ],
      decoys: [
        {
          id: 'gw504',
          label: '504 Gateway Timeout',
          sub: 'after 30 s',
          from: 's',
          to: 'c',
          is: 'what the synchronous design produced: the work ran inside the request and the gateway gave up at 30 s',
        },
        {
          id: 'newkey',
          label: 'POST /reports with a new key',
          sub: 'retry',
          from: 'c',
          to: 's',
          is: 'a fresh key, so the server sees a new logical operation and starts a duplicate export',
        },
        {
          id: 'body',
          label: '200 OK with the PDF body',
          sub: 'on the POST',
          from: 's',
          to: 'c',
          is: 'the blocking design again: the POST would have to stay open for the whole 10–40 s of work',
        },
      ],
      why: [
        'Long work leaves the request: POST validates, stores the job idempotently, enqueues, and returns 202 with a Location in milliseconds.',
        'The Idempotency-Key makes client retries return the same job instead of a duplicate export.',
        'Retry-After spaces the polls; the status resource reports RUNNING, then points at the result (200 with a link, or 303 See Other).',
        'Webhooks (signed, with an event id and retries) or SSE/WebSocket replace polling when the client can receive pushes.',
      ],
    },
    {
      mode: 'route',
      id: 'per-key-version-routing',
      tab: 'Route by version',
      title: 'Order events: apply, ignore or park?',
      brief:
        'An order-status consumer runs keys in parallel but each key one at a time, applies an event only if version = stored + 1, and parks a key while one of its events sits in the retry topic. Route each event so no order ever flips back from PAID to PENDING and nothing is applied twice.',
      cols: 4.4,
      rows: 3.4,
      nodes: [
        { id: 'src', label: 'order-events, p3', sub: 'key = orderId', kind: 'terminal', col: 0, row: 1.0 },
        { id: 'exec', label: 'Keyed executor', sub: 'one at a time per key', col: 1.2, row: 1.0 },
        { id: 'guard', label: 'Version guard', sub: 'stored version per order', col: 2.35, row: 1.0 },
        { id: 'apply', label: 'Apply + commit', sub: 'version = stored + 1', col: 3.5, row: 0.2 },
        { id: 'skip', label: 'Ignore as stale', sub: 'version ≤ stored', col: 3.5, row: 1.7 },
        { id: 'park', label: 'Retry path, key parked', sub: 'behind its earlier event', col: 2.35, row: 2.5 },
      ],
      edges: [
        ['src', 'exec'],
        ['exec', 'guard'],
        ['guard', 'apply'],
        ['guard', 'skip'],
        ['guard', 'park'],
      ],
      packets: [
        {
          id: 'a-v2',
          label: 'Order A: PAID, v2',
          sub: 'stored A = v1',
          from: 'src',
          paths: [['src', 'exec', 'guard', 'apply']],
          wrong: {
            'guard>skip': 'v2 is exactly stored + 1, the next event for this order. Ignoring it would leave order A stuck at PENDING.',
            'guard>park': 'Order A has nothing waiting in the retry topic, so there is no earlier event to wait behind.',
          },
          done: 'v2 = stored + 1, so it is applied and the stored version moves to 2 in the same transaction as the effect.',
        },
        {
          id: 'a-v2-again',
          label: 'Order A: PAID, v2 again (redelivered)',
          sub: 'stored A = v2 · after a rebalance',
          from: 'src',
          paths: [['src', 'exec', 'guard', 'skip']],
          wrong: {
            'guard>apply':
              'At-least-once delivery redelivers around rebalances. Applying v2 a second time could double an effect such as a loyalty grant; the guard exists to make this a no-op.',
            'guard>park': 'Nothing is in the retry topic for order A. This is a duplicate, not an event waiting for an earlier one.',
          },
          done: 'version ≤ stored, so the duplicate is ignored. Version guards handle duplicates and reordering with one integer per entity.',
        },
        {
          id: 'b-v3',
          label: 'Order B: PENDING → SHIPPED, v3',
          sub: 'B v2 failed and sits in the retry topic',
          from: 'src',
          paths: [['src', 'exec', 'guard', 'park']],
          wrong: {
            'guard>apply':
              'Retries reorder: if v3 is applied now and v2 an hour later, state regresses. With stored = v1, v3 is also a gap the strict guard must not accept.',
            'guard>skip': 'v3 is not stale, it is ahead. Ignoring it would lose the SHIPPED status for good.',
          },
          done: 'Key parking: while B’s v2 is in retry, later B events follow it onto the retry path, so B stays in order and other keys keep flowing.',
        },
        {
          id: 'b-v2',
          label: 'Order B: PAID, v2 redriven, now succeeds',
          sub: 'stored B = v1',
          from: 'src',
          paths: [['src', 'exec', 'guard', 'apply']],
          wrong: {
            'guard>skip': 'v2 is the next version for B (stored + 1). Ignoring it would block v3 behind it forever.',
            'guard>park': 'This is the parked event itself. Once it is applied the key is unparked and v3 can follow.',
          },
          done: 'The parked event applies, B moves to v2, the key is unparked and v3 follows: per-key order without blocking the partition.',
        },
      ],
      why: [
        'Order per entity, not globally: key by orderId and serialize per key, while different keys run in parallel.',
        'A producer-stamped version makes consumers safe against duplicates and reordering: apply only stored + 1, ignore anything ≤ stored.',
        'Retries reorder events. Key parking (or blocking retries, or a version guard) keeps a failing key in order without stalling the other keys.',
      ],
    },
    {
      mode: 'spike',
      id: 'whale-merchant-spike',
      tab: 'Survive the spike',
      title: 'Sale day: one merchant is 40% of payments',
      brief:
        'Payment events climb from 1K to 8K/s. One merchant is 40% of them and, keyed by merchantId, lands on a single partition whose consumer handles 500/s; Postgres takes about 6K writes/s (scenario numbers). You can make two changes. Keep the hot consumer and Postgres under 90% busy, or lag grows without bound.',
      cols: 4,
      rows: 2.2,
      nodes: [
        { id: 'prod', label: 'Payment producers', sub: 'key = merchantId', kind: 'terminal', col: 0, row: 0.6 },
        { id: 'hot', label: 'Consumer of p7', sub: 'the whale’s partition', col: 1.5, row: 0, share: 0.4, capacity: 500, unit: 'msg/s', ms: 2 },
        { id: 'rest', label: '47 other consumers', sub: 'every other merchant', col: 1.5, row: 1.2, share: 0.6, capacity: 23500, unit: 'msg/s', ms: 2 },
        { id: 'db', label: 'Postgres', sub: 'one write per event', col: 3, row: 0.6, share: 1, capacity: 6000, unit: 'writes/s', ms: 5 },
      ],
      edges: [
        ['prod', 'hot', '40%'],
        ['prod', 'rest', '60%'],
        ['hot', 'db'],
        ['rest', 'db'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 1000],
        [10, 1000],
        [40, 8000],
        [60, 8000],
      ],
      maxCards: 2,
      cards: [
        {
          id: 'salt',
          label: 'Salt the whale’s key ×8',
          sub: 'merchantId#hash(orderId)%8',
          node: 'hot',
          effects: [
            { node: 'hot', load: 0.125 },
            { node: 'rest', load: 1.6 },
          ],
          is: 'salting only the known hot key: its events spread over 8 sub-streams on different partitions, while per-order ordering is kept because the salt comes from orderId',
        },
        {
          id: 'aggregate',
          label: 'Aggregate before writing',
          sub: 'sum a batch → 1 UPDATE',
          node: 'db',
          effects: [{ node: 'db', load: 0.1 }],
          is: 'making each message cheaper: consumers sum many events in memory into one database update instead of one write per event',
        },
        {
          id: 'more-pods',
          label: 'Add 20 consumer pods',
          sub: 'scale the group',
          node: 'rest',
          decoy: true,
          effects: [{ node: 'rest', capacity: 1.4 }],
          is: 'more consumers for a one-partition problem: a partition is read by one consumer in the group, so the whale’s partition gets no extra help',
        },
        {
          id: 'more-parts',
          label: 'Partitions 48 → 96',
          sub: 'same key, same hash',
          node: 'hot',
          decoy: true,
          effects: [],
          is: 'no help for a hot key: hash(merchantId) still sends every one of the whale’s events to one partition, and adding partitions also remaps other keys',
        },
      ],
      goals: [
        { metric: 'util:hot', max: 90, label: 'Hot consumer ≤ 90%', fail: 'The whale’s partition is consumed slower than it is produced, so its lag grows without bound.' },
        { metric: 'util:db', max: 90, label: 'Postgres ≤ 90%', fail: 'Postgres is at its write limit, so every consumer slows down and lag grows on all partitions.' },
      ],
      why: [
        'Total lag dominated by one partition, with one pod pegged and adding consumers changing nothing, is a hot key.',
        'Salt only the hot key, and take the salt from a finer key (orderId) so per-order order survives; per-merchant totals need a merge step.',
        'When the bottleneck is per-message work, make each message cheaper: aggregate in memory and write once per batch.',
        'More pods or partitions cannot split a strictly hashed key: the whale still lands on one partition.',
      ],
    },
  ],
};

export default set;
