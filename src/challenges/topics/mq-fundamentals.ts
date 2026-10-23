import type { ChallengeSet, Expr } from '../types';

const RF: Expr = { knob: 'rf' };
const ISR: Expr = { knob: 'isr' };
const ACKS: Expr = { knob: 'acks' };
const UNCLEAN: Expr = { knob: 'unclean' };
/** acks choice values: 0 = acks=0, 1 = acks=1, 2 = acks=all */
const ACKS_ALL = 2;
const isAll = { left: ACKS, op: '==', right: ACKS_ALL } as const;

const set: ChallengeSet = {
  topic: 'mq-fundamentals',
  puzzles: [
    {
      mode: 'tune',
      id: 'kafka-durability',
      tab: 'Kafka durability',
      title: 'Payments topic: no acked write may ever be lost',
      brief:
        'A fintech moves its payments.v1 topic to a 5-broker Kafka cluster. An acked payment must survive a broker dying, writes must keep flowing while one broker is down for patching, and the disk budget pays for three copies of the data.',
      cols: 4,
      rows: 3.2,
      nodes: [
        { id: 'prod', label: 'Payments producer', sub: 'idempotent', kind: 'terminal', col: 0, row: 1.1 },
        { id: 'b1', label: 'Leader B1', sub: 'RF={rf} · min ISR={isr}', col: 1.4, row: 1.1 },
        { id: 'b2', label: 'Follower B2', sub: 'fetches from leader', col: 2.9, row: 0 },
        { id: 'b3', label: 'Follower B3', sub: 'fetches from leader', col: 2.9, row: 2.2, showIf: { left: RF, op: '>=', right: 3 } },
        { id: 'b4', label: 'Follower B4', sub: 'fetches from leader', col: 1.4, row: 0, showIf: { left: RF, op: '>=', right: 4 } },
        { id: 'b5', label: 'Follower B5', sub: 'fetches from leader', col: 1.4, row: 2.2, showIf: { left: RF, op: '>=', right: 5 } },
      ],
      edges: [
        ['prod', 'b1', 'produce'],
        ['b1', 'b2'],
        ['b1', 'b3'],
        ['b1', 'b4'],
        ['b1', 'b5'],
      ],
      knobs: [
        { id: 'rf', label: 'replication.factor', kind: 'stepper', min: 2, max: 5, initial: 3, help: 'copies of every partition' },
        { id: 'isr', label: 'min.insync.replicas', kind: 'stepper', min: 1, max: 5, initial: 1, help: 'in-sync copies required for acks=all' },
        {
          id: 'acks',
          label: 'Producer acks',
          kind: 'choice',
          initial: 1,
          choices: [
            { value: 0, label: '0' },
            { value: 1, label: '1' },
            { value: ACKS_ALL, label: 'all' },
          ],
          help: 'who must have the write before the ack',
        },
        { id: 'unclean', label: 'Unclean leader election', kind: 'toggle', initial: 1, help: 'may an out-of-sync replica become leader?' },
      ],
      constraints: [
        {
          id: 'copies',
          label: 'Acked write held by ≥ 2 brokers',
          left: { op: 'if', cond: isAll, then: ISR, else: { op: 'if', cond: { left: ACKS, op: '==', right: 1 }, then: 1, else: 0 } },
          op: '>=',
          right: 2,
          unit: ' copies',
          hint: 'acks=1 waits only for the leader. What does acks=all wait for, and what sets its floor?',
          fail: 'The ack goes out while only the leader (or nobody) has the write: if that broker dies before a follower copies it, an acked payment is gone.',
          pass: 'With acks=all the ack waits for the in-sync replicas, and min.insync.replicas guarantees at least two of them hold every acked write.',
        },
        {
          id: 'clean',
          label: 'New leader always has acked data',
          display: { pass: 'always', fail: 'unclean election on' },
          left: UNCLEAN,
          op: '==',
          right: 0,
          hint: 'When the leader dies, which replicas should be allowed to take over?',
          fail: 'Unclean election lets an out-of-sync replica become leader, silently dropping writes that were already acked.',
          pass: 'Only an in-sync replica can be elected, so the new leader has every acked write: you choose unavailability over silent loss.',
        },
        {
          id: 'avail',
          label: 'Writes OK with 1 broker down',
          left: { op: 'sub', args: [RF, 1] },
          op: '>=',
          right: { op: 'if', cond: isAll, then: ISR, else: 1 },
          unit: ' in sync',
          hint: 'With one broker down, RF − 1 replicas remain. Is that enough to meet the in-sync floor?',
          fail: 'With one broker down there are fewer in-sync replicas than min.insync.replicas, so every acks=all write fails with NotEnoughReplicas.',
          pass: 'RF − 1 replicas still meet the floor, so producers keep writing while a broker is patched.',
        },
        {
          id: 'disk',
          label: 'Disk budget: ≤ 3 copies',
          left: RF,
          op: '<=',
          right: 3,
          unit: ' copies',
          hint: 'Every replica is a full copy of the partition on another broker.',
          fail: 'Each extra replica is another full copy of the topic; this replication factor is over the disk budget.',
          pass: 'Three copies fit the budget, which is the usual replication factor for important topics.',
        },
      ],
      why: [
        'replication.factor=3, min.insync.replicas=2, acks=all is the classic recipe: one broker can die with no acked data lost and writes still accepted.',
        'acks=all waits for the current ISR; min.insync.replicas is the floor that stops the ISR shrinking to the leader alone.',
        'unclean.leader.election.enable=false keeps an out-of-sync replica from becoming leader and dropping acked writes.',
        'Durability comes from replication across brokers (and racks/AZs), not from fsync: Kafka acks once the replicas have the write in page cache.',
      ],
    },
    {
      mode: 'match',
      id: 'aws-messaging-pick',
      tab: 'Pick the AWS service',
      title: 'Platform review: which AWS messaging service fits?',
      brief:
        'A marketplace platform team on AWS has six new messaging needs on the review board. Patch each need to the service that fits its model: a buffer, a copier, a router or a log. Two tempting answers do not fit any of them.',
      leftTitle: 'Need',
      rightTitle: 'Service',
      left: [
        {
          id: 'thumbs',
          label: 'Resize uploaded photos in the background, with retries + DLQ',
          answer: 'sqs',
          because: 'Background jobs for one consumer type are what SQS standard is for: a buffer with visibility timeouts, retries and DLQ redrive.',
        },
        {
          id: 'ledger',
          label: 'Apply each wallet’s events in order, low volume, no dupes',
          answer: 'fifo',
          because: 'SQS FIFO orders messages per MessageGroupId (group = wallet id) and deduplicates within a 5-minute window.',
        },
        {
          id: 'fanout',
          label: 'OrderPlaced to email, fraud and search, each at its own pace',
          answer: 'snssqs',
          because: 'SNS copies the message and each service owns its own SQS queue, so it gets its own buffer, retry pace and DLQ, and a slow consumer delays nobody.',
        },
        {
          id: 'route',
          label: 'Route partner SaaS events by content across 12 accounts',
          answer: 'eb',
          because: 'EventBridge routes JSON events by content patterns across accounts and from SaaS sources; put a queue in front of fragile targets.',
        },
        {
          id: 'clicks',
          label: 'Clickstream: ordered per user, 3 readers that replay',
          answer: 'kinesis',
          because: 'Kinesis keeps a strict order per shard (partition key → shard) and every reader can replay from a sequence number or timestamp.',
        },
        {
          id: 'compact',
          label: 'Needs log compaction and exactly-once stream processing',
          answer: 'msk',
          because: 'Compaction, transactions and the Kafka ecosystem are Kafka semantics; Kinesis has no compaction, so managed Kafka (MSK) fits.',
        },
      ],
      right: [
        { id: 'sqs', label: 'SQS standard', sub: 'buffer', is: 'a managed queue: competing consumers, visibility timeout, DLQ, no routing or fan-out' },
        { id: 'fifo', label: 'SQS FIFO', sub: 'group = entity id', is: 'a queue ordered per MessageGroupId with a 5-minute deduplication window' },
        { id: 'snssqs', label: 'SNS → SQS per service', sub: 'copier + buffers', is: 'push fan-out into one queue per consuming service' },
        { id: 'eb', label: 'EventBridge', sub: 'router', is: 'an event bus that routes by content-based rules across accounts and SaaS sources' },
        { id: 'kinesis', label: 'Kinesis Data Streams', sub: 'log', is: 'a sharded, append-only stream with per-shard order and replay for up to 365 days' },
        { id: 'msk', label: 'Amazon MSK', sub: 'managed Kafka', is: 'managed Kafka with compaction, transactions and Kafka Connect' },
        {
          id: 'snsonly',
          label: 'SNS topic, no queues',
          decoy: true,
          is: 'a copier that stores nothing on standard topics, so a subscriber that is down simply misses the messages',
        },
        {
          id: 'mirrored',
          label: 'RabbitMQ classic mirrored queue',
          decoy: true,
          is: 'a deprecated durability option removed in RabbitMQ 4.0; quorum queues replaced it',
        },
      ],
      why: [
        'SQS is a buffer, SNS is a copier, EventBridge is a router and Kinesis is a log: pick by the model the need asks for.',
        'Combine by role: route or fan out first, then put a queue in front of each consumer that needs its own retries.',
        'Ordering is always per something: per MessageGroupId in SQS FIFO, per shard in Kinesis, per partition in Kafka.',
        'When you need Kafka semantics such as compaction or transactions, use Kafka (MSK), not a look-alike.',
      ],
    },
    {
      mode: 'route',
      id: 'rabbit-exchange-routing',
      tab: 'Route through RabbitMQ',
      title: 'Order emails: route each message through RabbitMQ',
      brief:
        'An order service publishes to a RabbitMQ topic exchange. The email worker uses manual acks, prefetch 50 and a dead-letter exchange. Steer four messages so confirmations go out once, refunds reach their own queue, blips are retried and broken messages are parked, never lost.',
      cols: 5,
      rows: 3.4,
      nodes: [
        { id: 'pub', label: 'Order service', sub: 'publish(key)', kind: 'terminal', col: 0, row: 1.2 },
        { id: 'ex', label: 'Exchange orders', sub: 'type: topic', col: 1, row: 1.2 },
        { id: 'qmail', label: 'email.order-confirm', sub: 'bound: order.\u200Bplaced.*', col: 2.05, row: 0.1 },
        { id: 'qref', label: 'refunds queue', sub: 'bound: order.\u200Brefunded.*', col: 2.05, row: 2.3 },
        { id: 'worker', label: 'Email worker', sub: 'manual ack · prefetch 50', col: 3, row: 1.2 },
        { id: 'done', label: 'Deleted', sub: 'after basic.ack', col: 4, row: 0.1 },
        { id: 'requeue', label: 'Requeued', sub: 'redelivered later', col: 4, row: 1.2 },
        { id: 'dlx', label: 'orders.dlx → DLQ', sub: 'parked for a fix', col: 4, row: 2.3 },
      ],
      edges: [
        ['pub', 'ex'],
        ['ex', 'qmail'],
        ['ex', 'qref'],
        ['qmail', 'worker'],
        ['worker', 'done', 'ack'],
        ['worker', 'requeue', 'nack'],
        ['worker', 'dlx', 'reject'],
      ],
      packets: [
        {
          id: 'placed',
          label: 'OrderPlaced: email sent fine',
          sub: 'routing key order.placed.eu',
          from: 'pub',
          paths: [['pub', 'ex', 'qmail', 'worker', 'done']],
          wrong: {
            'ex>qref':
              'The refunds queue is bound with order.refunded.*, which does not match order.placed.eu. A topic exchange only copies a message to queues whose binding pattern matches its routing key.',
            'worker>requeue':
              'The email already went out. Requeueing a processed message means it is delivered again and the customer gets a second confirmation.',
            'worker>dlx':
              'Nothing failed, so there is nothing to park. Rejecting a processed message would send a healthy order to the DLQ and page someone for no reason.',
          },
          done: 'order.placed.eu matches order.placed.*, the worker sends the email and only then calls basic.ack, so RabbitMQ deletes the message.',
        },
        {
          id: 'refund',
          label: 'OrderRefunded for order 77',
          sub: 'routing key order.refunded.eu',
          from: 'pub',
          paths: [['pub', 'ex', 'qref']],
          wrong: {
            'ex>qmail':
              'The email queue is bound with order.placed.*, and order.refunded.eu does not match it. Topic exchanges route by pattern, so this message never lands there.',
          },
          done: 'The exchange matches the routing key against each binding: order.refunded.* is the only match, so the refund lands in its own queue for its own consumer.',
        },
        {
          id: 'smtp',
          label: 'OrderPlaced: SMTP server timed out',
          sub: 'transient error · attempt 1',
          from: 'pub',
          paths: [['pub', 'ex', 'qmail', 'worker', 'requeue']],
          wrong: {
            'ex>qref':
              'The refunds queue is bound with order.refunded.*, which does not match an order.placed key.',
            'worker>done':
              'Acking a message whose email never went out deletes it: the confirmation is silently lost.',
            'worker>dlx':
              'A timeout is transient: the next attempt will probably work. Parking it in the DLQ turns a blip into manual work.',
          },
          done: 'The worker nacks with requeue=true for transient errors, so the message is delivered again later. A quorum queue’s delivery limit stops it looping forever.',
        },
        {
          id: 'poison',
          label: 'OrderPlaced with a malformed address',
          sub: 'PermanentError · will never succeed',
          from: 'pub',
          paths: [['pub', 'ex', 'qmail', 'worker', 'dlx']],
          wrong: {
            'ex>qref':
              'The refunds queue is bound with order.refunded.*, which does not match an order.placed key.',
            'worker>done':
              'Acking a message you could not process drops it without a trace. Nobody will ever know this customer got no email.',
            'worker>requeue':
              'A malformed address fails the same way on every delivery. Requeueing it just burns worker time until the delivery limit is hit.',
          },
          done: 'Permanent errors are rejected without requeue, so the queue’s x-dead-letter-exchange moves the message to orders.dlx, where it keeps its payload until someone fixes and redrives it.',
        },
      ],
      why: [
        'Producers publish to an exchange, and bindings decide which queues get a copy: a topic exchange matches routing keys against patterns like order.placed.*.',
        'Manual acks after processing give at-least-once delivery: ack only once the work is done.',
        'Classify failures: nack with requeue for transient errors, reject to the dead-letter exchange for permanent ones.',
        'Quorum queues with a delivery limit keep a poison message from looping forever, and the DLQ keeps it for a later redrive.',
      ],
    },
    {
      mode: 'sequence',
      id: 'eos-read-process-write',
      tab: 'Exactly-once loop',
      title: 'Payment enricher: one exactly-once batch',
      brief:
        'A payment-enricher service reads payments.raw.v1 and writes payments.enriched.v1. After a pod restart left duplicates downstream, the team moves to Kafka transactions. Put one batch through the read-process-write loop in order.',
      layout: 'stages',
      steps: [
        {
          id: 'init',
          label: 'init\u200BTransactions()',
          sub: 'stable transactional.id',
          clue: 'Fences any older instance first',
          is: 'the start-up call that registers the stable transactional.id and bumps its epoch, so a zombie instance with the same id gets ProducerFenced',
        },
        {
          id: 'poll',
          label: 'Consume a batch',
          sub: 'payments.raw.v1',
          clue: 'Read the input records',
          is: 'fetching the next batch of input records from the raw topic',
        },
        {
          id: 'begin',
          label: 'Begin the transaction',
          sub: 'producer.\u200Btransaction()',
          clue: 'Opens the atomic unit',
          is: 'opening the transaction that the outputs and the offsets will join',
        },
        {
          id: 'send',
          label: 'Produce enriched records',
          sub: 'payments.\u200Benriched.v1',
          clue: 'Write the outputs, not yet visible',
          is: 'writing the output records inside the transaction; read_committed consumers cannot see them yet',
        },
        {
          id: 'offsets',
          label: 'send\u200BOffsets\u200BTo\u200BTransaction',
          sub: 'last offset + 1',
          clue: 'Progress joins the same unit',
          is: 'adding the consumed input offsets to the same transaction, so progress and output commit together',
        },
        {
          id: 'commit',
          label: 'commit\u200BTransaction()',
          sub: 'all or nothing',
          clue: 'Outputs and progress land together',
          is: 'the commit: either the outputs and the offsets both take effect, or neither does and the batch is re-read',
        },
        {
          id: 'markers',
          label: 'Coordinator writes markers',
          sub: 'one per partition',
          clue: 'Tells each partition the result',
          is: 'the transaction coordinator writing commit markers into every partition the transaction touched',
        },
        {
          id: 'visible',
          label: 'read_committed sees output',
          sub: 'up to last stable offset',
          clue: 'Downstream finally reads it',
          is: 'downstream consumers with isolation.level=read_committed reading the committed records and skipping aborted ones',
        },
      ],
      decoys: [
        {
          id: 'autocommit',
          label: 'Auto-commit input offsets',
          sub: 'every 5 s',
          is: 'a separate, periodic offset commit outside the transaction; it is exactly the gap that let a crash produce duplicates or skips',
        },
        {
          id: 'stripe',
          label: 'Charge the card via Stripe',
          sub: 'inside the transaction',
          is: 'a side effect outside Kafka: an aborted and retried transaction would call it twice, so it needs an idempotency key instead',
        },
        {
          id: 'fsync',
          label: 'fsync each record to disk',
          sub: 'before the ack',
          is: 'not part of the protocol: Kafka acks once replicas have the write in page cache and gets durability from replication',
        },
      ],
      why: [
        'Exactly-once in Kafka is at-least-once plus an atomic commit: the outputs and the input offsets commit in one transaction.',
        'A stable transactional.id and its epoch fence zombie instances after a restart.',
        'read_committed consumers only read committed records, up to the last stable offset.',
        'The guarantee stops at Kafka’s edge: calls to Stripe or writes to Postgres need idempotency keys or offsets stored with the data.',
      ],
    },
    {
      mode: 'spike',
      id: 'clickstream-producer-spike',
      tab: 'Producer spike',
      title: 'Sale clickstream: the brokers choke on tiny requests',
      brief:
        'A sale ramps clickstream from 100K to 400K events/s. Producers run linger.ms=0 with no compression, so each produce request carries about 2 events of ~1 KB JSON (scenario numbers). You may change two producer settings; keep errors ≤ 1% and p99 ≤ 100 ms.',
      cols: 4,
      rows: 2.2,
      nodes: [
        { id: 'apps', label: 'Web + app SDKs', sub: 'click events', kind: 'terminal', col: 0, row: 0.6 },
        { id: 'prod', label: 'Producer pods', sub: 'linger.ms=0 · JSON', col: 1.3, row: 0.6, share: 1, ms: 2 },
        {
          id: 'req',
          label: 'Broker request threads',
          sub: '3 brokers · 120K req/s',
          col: 2.9,
          row: 0,
          share: 0.5,
          capacity: 120000,
          unit: 'req/s',
          ms: 3,
          timeoutMs: 1000,
        },
        {
          id: 'net',
          label: 'Broker network in',
          sub: '3 brokers · 350 MB/s',
          col: 2.9,
          row: 1.2,
          share: 1,
          capacity: 350000,
          unit: 'KB/s',
          ms: 2,
          timeoutMs: 1000,
        },
      ],
      edges: [
        ['apps', 'prod'],
        ['prod', 'req', 'produce'],
        ['prod', 'net', 'bytes'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 100000],
        [10, 100000],
        [40, 400000],
        [60, 400000],
      ],
      maxCards: 2,
      cards: [
        {
          id: 'linger',
          label: 'linger.ms=5, 64 KB batches',
          sub: 'fill a batch, then send',
          node: 'prod',
          effects: [{ node: 'req', load: 0.05 }],
          is: 'batching: a few ms of linger lets records pile up per partition, so one request carries dozens of events and the broker request rate falls about 20×',
        },
        {
          id: 'zstd',
          label: 'compression.type=zstd',
          sub: 'compress each batch',
          node: 'prod',
          effects: [{ node: 'net', load: 0.25 }],
          is: 'batch compression: JSON typically shrinks 3–5×, and the broker stores the compressed batch as-is, so bytes in fall to about a quarter',
        },
        {
          id: 'acks0',
          label: 'acks=0',
          sub: 'fire and forget',
          node: 'prod',
          decoy: true,
          effects: [],
          is: 'skipping the ack: it sends exactly as many requests and bytes as before and silently loses events on any failure',
        },
        {
          id: 'parts',
          label: 'Double partitions 48 → 96',
          sub: 'more parallelism',
          node: 'req',
          decoy: true,
          effects: [{ node: 'req', load: 1.5 }],
          is: 'more partitions for a request-rate problem: records batch per partition, so batches get smaller and requests go up; it also remaps every key',
        },
      ],
      goals: [
        {
          metric: 'errors',
          max: 1,
          label: 'Errors ≤ 1%',
          fail: 'A broker resource is past its capacity, and the sends beyond it time out and fail.',
        },
        {
          metric: 'p99',
          max: 100,
          label: 'p99 ≤ 100 ms',
          fail: 'Produce requests queue behind a saturated broker until the slowest ones hit the request timeout.',
        },
      ],
      why: [
        'Producer throughput comes from batching and compression: batch.size plus a few ms of linger.ms multiply throughput and cut broker request rates.',
        'lz4 or zstd typically shrinks JSON 3–5×; the producer compresses, the broker stores the batch as-is, and the consumer decompresses.',
        'Request count and bytes are different limits: batching fixes the first, compression the second.',
        'acks=0 trades durability for nothing here, and more partitions mean smaller batches and remapped keys.',
      ],
    },
  ],
};

export default set;
