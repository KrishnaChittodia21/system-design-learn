import type { ChallengeSet } from '../types';

const set: ChallengeSet = {
  topic: 'design-commerce',
  puzzles: [
    {
      mode: 'flow',
      id: 'idempotent-payment',
      tab: 'Payment flowchart',
      title: 'Idempotent payment API (flowchart)',
      brief:
        'Mobile networks retry. The same POST /pay can arrive twice, and the payment provider can time out. Wire the decisions so a customer is charged exactly once.',
      cols: 5,
      rows: 4,
      nodes: [
        { id: 'start', label: 'POST /pay', sub: 'Idempotency-Key: k1', kind: 'terminal', col: 0, row: 1.5 },
        { id: 'seen', label: 'Key seen before?', kind: 'decision', col: 1, row: 1.5 },
        { id: 'replay', answer: 'stored', hint: 'A retry must not charge again', col: 2, row: 0.25 },
        { id: 'claim', answer: 'claim', hint: 'Wins the race before calling out', col: 2, row: 2.75 },
        { id: 'psp', label: 'Call PSP', sub: 'forward the same key', col: 3, row: 2.75 },
        { id: 'res', label: 'PSP result?', kind: 'decision', col: 3, row: 1.2 },
        { id: 'ok', answer: 'ledger', hint: 'Money moved: record it', col: 4, row: 0.25 },
        { id: 'unknown', answer: 'unknown', hint: 'Timeout: did it charge or not?', col: 4, row: 2.25 },
      ],
      edges: [
        ['start', 'seen'],
        ['seen', 'replay', 'yes'],
        ['seen', 'claim', 'no'],
        ['claim', 'psp'],
        ['psp', 'res'],
        ['res', 'ok', 'success'],
        ['res', 'unknown', 'timeout'],
      ],
      options: [
        { id: 'stored', label: 'Return the stored response', sub: 'same status + body', is: 'replaying the first result for a duplicate request' },
        { id: 'claim', label: 'INSERT key as IN_\u200BPROGRESS', sub: 'UNIQUE(key)', is: 'atomically claiming the key so only one request proceeds' },
        { id: 'ledger', label: 'Write ledger + save response', sub: 'one transaction', is: 'recording the double entry and the reply together' },
        {
          id: 'unknown',
          label: 'Mark UNKNOWN, reconcile',
          sub: 'query PSP later',
          is: "treating a timeout as \"outcome unknown\" and settling it from the PSP's records",
        },
        { id: 'recharge', label: 'Charge again with a new key', sub: 'retry', decoy: true, is: 'a fresh charge, which is exactly how customers get double-billed' },
        {
          id: 'forget',
          label: 'Return 500, delete the key',
          sub: 'fail fast',
          decoy: true,
          is: "forgetting the attempt, so the client's retry charges a second time",
        },
      ],
      why: [
        'A duplicate request with the same key gets the stored response, so it never reaches the PSP again.',
        'The UNIQUE insert is the race winner: two simultaneous requests cannot both proceed.',
        'Forwarding the same key to the PSP means even a retry after a crash is deduplicated downstream.',
        'A timeout is unknown, not failed: reconcile against the PSP instead of charging again.',
      ],
    },
    {
      mode: 'match',
      id: 'money-incident-guards',
      tab: 'Money incidents',
      title: 'Payments and wallet: patch each incident to its guard',
      brief:
        'The finance team has filed five incidents against the payment system and the wallet. Each one breaks the rule that money is never created, lost or moved twice. Connect each incident to the mechanism that prevents it.',
      leftTitle: 'Incident',
      rightTitle: 'Guard',
      instruction: 'Connect each incident to the guard that prevents it',
      left: [
        {
          id: 'late-hook',
          label: 'A late "processing" webhook overwrites a "succeeded" payment',
          answer: 'forward',
          because:
            'Webhooks arrive at least once and possibly out of order. Dedupe on the PSP event id and apply only forward state transitions, so a late "processing" can never undo "succeeded".',
        },
        {
          id: 'double-post',
          label: 'A replayed Kafka message posts the same ledger entry twice',
          answer: 'extref',
          because:
            'Each ledger transaction carries a unique external reference (payment_order_id + event type). The replay hits the UNIQUE constraint and posts nothing.',
        },
        {
          id: 'replay-drift',
          label: 'A Raft follower replays the log and gets another balance',
          answer: 'determ',
          because:
            'Followers hold identical state only if apply() is deterministic: no wall-clock reads, no randomness and no I/O. The timestamp must come from the command itself.',
        },
        {
          id: 'half-transfer',
          label: 'Crash after debiting A on shard 1, before crediting B',
          answer: 'tcc',
          because:
            'With TC/C each phase is a local transaction keyed by txnId, and a phase-status table records TRY_DONE. A recovery job resumes from there and retries the idempotent Confirm until B is credited.',
        },
        {
          id: 'missing-charge',
          label: 'Settlement file lists a charge our ledger never recorded',
          answer: 'recon',
          because:
            'Nightly reconciliation compares the settlement file with the ledger and payment orders. A missed webhook is the auto-fixable case: mark the order succeeded and post the ledger entry.',
        },
      ],
      right: [
        { id: 'forward', label: 'Forward-only state transitions', sub: 'dedupe on PSP event id', is: 'ignoring any event that would move a payment backwards in its state machine' },
        { id: 'extref', label: 'UNIQUE external_ref per ledger txn', sub: 'idempotent posting', is: 'a unique key on every ledger transaction, so posting it twice is a no-op' },
        { id: 'determ', label: 'Deterministic apply()', sub: 'no clock, randomness, I/O', is: 'a pure state-machine function, so every replica that replays the same events reaches the same state' },
        { id: 'tcc', label: 'TC/C with a phase-status table', sub: 'Try → Confirm / Cancel', is: 'a cross-shard transfer built from local, idempotent phases whose progress is recorded durably' },
        { id: 'recon', label: 'Nightly reconciliation', sub: 'vs PSP settlement file', is: 'a batch job that compares our records with the PSP’s and classifies every mismatch' },
        {
          id: 'twopc',
          label: '2PC across the wallet shards',
          sub: 'prepare → commit',
          decoy: true,
          is: 'a blocking protocol that holds locks across the network with the coordinator as a single point of failure, which the lesson keeps out of a 1M TPS hot path',
        },
        {
          id: 'eos',
          label: 'Kafka exactly-once semantics',
          sub: 'transactional producer',
          decoy: true,
          is: 'a guarantee that covers Kafka-to-Kafka processing only, so the ledger write and the PSP call still need their own idempotency',
        },
      ],
      why: [
        'Exactly-once effect = at-least-once delivery + idempotency at every hop: client → us, us → PSP, PSP → us, and Kafka → ledger.',
        'Webhooks are deduped on the event id and only ever move a payment forward.',
        'Event sourcing gives reproducibility only if apply() is deterministic, so every Raft replica converges.',
        'Cross-shard transfers use local, idempotent phases plus a durable phase table instead of 2PC locks.',
        'Reconciliation against the settlement file is the safety net that catches whatever the other guards missed.',
      ],
    },
    {
      mode: 'sequence',
      id: 'checkout-saga-stages',
      tab: 'Checkout saga',
      title: 'Checkout saga: from Place order to captured payment',
      brief:
        'An order touches Order, Inventory and Payment services that don’t share a database, and on a sale day the store must never oversell. Put the steps of the orchestrated checkout saga in order, from the click to the money being taken.',
      layout: 'stages',
      steps: [
        {
          id: 'pending',
          label: 'Create order PENDING',
          sub: 'local txn + outbox row',
          clue: 'One local txn, the event rides along',
          is: 'the Order service’s first local transaction, written together with an outbox row so the event can’t be lost',
        },
        {
          id: 'reserve',
          label: 'Reserve stock, 15 min TTL',
          sub: 'on_hand − reserved ≥ q',
          clue: 'Atomic conditional update, with expiry',
          is: 'a conditional UPDATE that adds to reserved only while enough stock is free; 0 rows means out of stock and the order is cancelled',
        },
        {
          id: 'authorize',
          label: 'Authorize payment',
          sub: 'PSP · idempotent per order',
          clue: 'Hold the funds, don’t take them yet',
          is: 'a hold on the buyer’s funds through the PSP; a decline releases the reservation and cancels the order',
        },
        {
          id: 'confirm',
          label: 'Mark order CONFIRMED',
          sub: 'CAS AUTHORIZED → CONFIRMED',
          clue: 'Compare-and-set loses to the sweeper',
          is: 'a compare-and-set on the order state, which fails if the TTL sweeper already cancelled the order (then the auth is voided)',
        },
        {
          id: 'commit',
          label: 'Commit stock at pick',
          sub: 'on_hand, reserved −= q',
          clue: 'The warehouse takes the units',
          is: 'the moment the reservation becomes a real decrement, when the warehouse picks the items',
        },
        {
          id: 'capture',
          label: 'Capture payment at shipment',
          sub: 'cards (UPI: immediately)',
          clue: 'Now the held money is taken',
          is: 'taking the authorized funds, done at shipment for cards and immediately for UPI or wallets',
        },
      ],
      decoys: [
        {
          id: 'cart-reserve',
          label: 'Reserve stock on add-to-cart',
          sub: 'hold units per cart',
          is: 'a step the design deliberately skips: reserving on add-to-cart lets hoarders lock inventory for days, so stock is reserved only at checkout',
        },
        {
          id: 'onhand-now',
          label: 'Decrement on_hand at order',
          sub: 'on_hand = on_hand − q',
          is: 'not part of the saga: checkout only raises reserved, so a cancelled or expired order just releases the reservation; on_hand drops when the warehouse picks',
        },
      ],
      why: [
        'Checkout is a saga: a sequence of local transactions, each with a compensating action (release stock, cancel the order, void the auth).',
        'Stock is reserved with a 15-minute TTL by a conditional update, so there is no read-then-write window and abandoned checkouts free themselves.',
        'Authorize first, capture later: funds are held during the saga and taken at shipment (cards) or immediately (UPI, wallets).',
        'State changes are compare-and-set, so an orchestrator retry or the TTL sweeper can’t push an order into two states.',
      ],
    },
    {
      mode: 'route',
      id: 'hotel-booking-paths',
      tab: 'Route the bookings',
      title: 'Booking.com scale: route reads, bookings and refunds',
      brief:
        'Hotel inventory is sharded by hotel_id, with a Redis copy of “rooms left” kept fresh by CDC. Steer each request so search stays off the database, bookings can never oversell, and the cache never drifts from the truth.',
      cols: 5,
      rows: 3.3,
      nodes: [
        { id: 'gw', label: 'API gateway', sub: 'auth · rate limit', kind: 'terminal', col: 0, row: 1.2 },
        { id: 'hotel', label: 'Hotel service', sub: 'names, photos · cached', col: 1.5, row: 0.05 },
        { id: 'resv', label: 'Reservation service', sub: 'owns inventory', col: 1.5, row: 1.2 },
        { id: 'pay', label: 'Payment service', sub: 'saga step', col: 0.6, row: 2.35 },
        { id: 'psp', label: 'PSP', sub: 'card network', col: 2.2, row: 2.35 },
        { id: 'redis', label: 'Inventory cache', sub: 'inv:\u200B{h}:\u200B{rt}:\u200B{d}', col: 4, row: 0.05 },
        { id: 'db', label: 'Reservation DB', sub: 'shard by hotel_id', col: 3, row: 1.2 },
        { id: 'cdc', label: 'CDC → Kafka', sub: 'Debezium on inventory', col: 4, row: 1.2 },
      ],
      edges: [
        ['gw', 'hotel'],
        ['gw', 'resv'],
        ['resv', 'redis', 'SET / GET'],
        ['resv', 'db', 'txn'],
        ['pay', 'resv', 'compensate'],
        ['pay', 'psp', 'charge'],
        ['db', 'cdc', 'WAL'],
        ['cdc', 'redis', 'update'],
      ],
      packets: [
        {
          id: 'badge',
          label: 'Search: “only 2 rooms left” badge',
          sub: 'GET availability · read-only',
          from: 'gw',
          paths: [['gw', 'resv', 'redis']],
          wrong: {
            'gw>hotel':
              'The Hotel service holds static data such as names and photos. Per-date room inventory is owned by the Reservation service.',
            'resv>db':
              'Search is the read hotspot. Sending every badge to the inventory shards spends their capacity on reads that the Redis copy can answer; the database is kept for bookings.',
          },
          done: 'The badge reads the cached count. If it is slightly stale, a user may see “available” and get “sold out” at submit, which is acceptable and honest because the database still decides.',
        },
        {
          id: 'book',
          label: 'POST /v1/reservations · 3 nights',
          sub: 'client-generated reservationId',
          from: 'gw',
          paths: [['gw', 'resv', 'db']],
          wrong: {
            'gw>hotel': 'Bookings change inventory, and inventory is owned by the Reservation service, not the static Hotel service.',
            'resv>redis':
              'Decrementing the cached count would make the cache the source of truth. Two racing users could both win, and a crash would leave the cache and the database disagreeing.',
          },
          done: 'One local transaction inserts the reservation (its client-generated id makes a retry a no-op) and runs a conditional UPDATE on the 3 date rows, which must change exactly 3 rows or roll back.',
        },
        {
          id: 'refresh',
          label: 'Booking committed: refresh “rooms left”',
          sub: 'inventory row changed',
          from: 'resv',
          paths: [['resv', 'db', 'cdc', 'redis']],
          wrong: {
            'resv>redis':
              'A dual write from the service can diverge on partial failure: the database commits, the cache write fails, and the badge shows the wrong count until the key is next written.',
          },
          done: 'The service only writes its database. Debezium reads the committed change from the WAL and the cache updater applies it, so the cache follows every commit, including ones whose service call crashed.',
        },
        {
          id: 'declined',
          label: 'Card declined for a pending stay',
          sub: 'non-retryable error',
          from: 'pay',
          paths: [['pay', 'resv', 'db']],
          wrong: {
            'pay>psp':
              'A decline is a non-retryable error. Charging again won’t change the answer; the saga must compensate instead.',
            'resv>redis':
              'Returning the room only in the cache would leave the database still counting it as reserved. The compensation has to run in the database, and CDC updates the cache.',
          },
          done: 'The compensation sets the reservation to canceled and gives the inventory back in one local transaction. CDC then pushes the new count to the cache.',
        },
      ],
      why: [
        'Keep reservation and inventory in one database, sharded by hotel_id, so a booking is one local ACID transaction.',
        'The Redis count serves only the read path. The conditional UPDATE in the database is the final arbiter.',
        'Feed the cache from CDC instead of dual writes, so it can’t drift when a service call fails halfway.',
        'A saga wraps only the payment step: on a decline or a 15-minute timeout, cancel the reservation and return the inventory.',
      ],
    },
    {
      mode: 'spike',
      id: 'deal-sku-flash-sale',
      tab: 'Flash sale spike',
      title: '₹1 phone deal: survive the first minute of the sale',
      brief:
        'A ₹1 deal on 1,000 phones goes live. In this scenario, requests climb from 5K to 150K per second, and 1 in 10 is a buy attempt on the same inventory row. You can make two changes. Keep checkout p99 under 1 s and errors ≤ 1% for the whole minute.',
      cols: 4,
      rows: 2.2,
      nodes: [
        { id: 'buyers', label: 'Buyers', sub: 'sale page + Buy now', kind: 'terminal', col: 0, row: 0.6 },
        { id: 'api', label: 'Sale API pods', sub: 'scenario: 60K req/s max', col: 1.4, row: 0.6, share: 1, capacity: 60000, unit: 'req/s', ms: 20 },
        { id: 'row', label: 'Inventory row', sub: '1 hot SKU · row lock', col: 2.9, row: 0.6, share: 0.1, capacity: 1000, unit: 'upd/s', ms: 5, timeoutMs: 2000 },
      ],
      edges: [
        ['buyers', 'api'],
        ['api', 'row', 'UPDATE'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 5000],
        [10, 5000],
        [40, 150000],
        [60, 150000],
      ],
      maxCards: 2,
      cards: [
        {
          id: 'waiting-room',
          label: 'Virtual waiting room',
          sub: 'signed admission tokens',
          node: 'api',
          effects: [
            { node: 'api', load: 0.2 },
            { node: 'row', load: 0.2 },
          ],
          is: 'admission control: everyone waits on a CDN-cached page and the gateway only accepts admitted, token-bearing users, here about a fifth of the crowd at peak',
        },
        {
          id: 'decrby-gate',
          label: 'Redis DECRBY stock gate',
          sub: 'only winners reach the DB',
          node: 'row',
          effects: [{ node: 'row', load: 0.01 }],
          is: 'a Redis token pool in front of the row: DECRBY below zero is rejected at once, so only the ~1,000 winners go on to the database reservation',
        },
        {
          id: 'buckets',
          label: 'Split stock into 16 buckets',
          sub: '(sku_id, bucket 0..15)',
          node: 'row',
          effects: [{ node: 'row', capacity: 16 }],
          is: 'pre-split stock rows: a buyer picks a random bucket and falls back to others, so lock contention is spread 16 ways',
        },
        {
          id: 'bigger-db',
          label: 'Upgrade DB to 4× vCPU',
          sub: 'bigger primary',
          node: 'row',
          decoy: true,
          effects: [],
          is: 'more CPU for a lock problem: updates to one row wait on that row’s lock one at a time, so a bigger box doesn’t shorten the queue',
        },
        {
          id: 'lock-retry',
          label: 'Retry 3× on lock timeout',
          sub: 'client-side retries',
          node: 'api',
          decoy: true,
          effects: [{ node: 'row', load: 2 }],
          is: 'a load amplifier: every buyer who timed out queues on the same locked row again',
        },
      ],
      goals: [
        { metric: 'p99', max: 1000, label: 'Checkout p99 < 1 s', fail: 'Buyers are queued on a saturated box long enough that the slowest 1% wait past a second.' },
        { metric: 'errors', max: 1, label: 'Errors ≤ 1%', fail: 'A box is past its capacity, and the requests beyond it fail.' },
      ],
      why: [
        'A hot SKU funnels every buyer onto one inventory row, and row-lock contention caps it at a few hundred to low thousands of updates per second.',
        'Bucketed stock spreads that contention 16 ways, and a Redis DECRBY gate lets only the winners reach the database, which stays the ledger.',
        'A waiting room turns an unbounded spike into a bounded arrival rate, which protects the API pods that no row fix can help.',
        'A bigger database doesn’t help a single-row lock queue, and retries on lock timeouts make the queue longer.',
      ],
    },
  ],
};

export default set;
