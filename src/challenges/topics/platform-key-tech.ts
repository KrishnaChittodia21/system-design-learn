import type { ChallengeSet, Expr } from '../types';

const N: Expr = { knob: 'n' };
const WCU: Expr = { knob: 'size' };
const RCU: Expr = { knob: 'read' };
/** scenario: views per second on the viral video, and live-counter reads per second */
const VIEWS = 10000;
const READS = 1500;

const set: ChallengeSet = {
  topic: 'platform-key-tech',
  puzzles: [
    {
      mode: 'tune',
      id: 'dynamo-viral-counter',
      tab: 'Viral view counter',
      title: 'DynamoDB: a view counter for a viral video',
      brief:
        'A video goes viral: 10,000 views/s hit one counter, and 1,500 times a second viewers read a live total that must include every acknowledged view. Pick the item shape, shard count and read mode within a 15,000 RCU read budget.',
      cols: 4,
      rows: 3,
      nodes: [
        { id: 'viewers', label: 'Viewers', sub: '10,000 views/s', kind: 'terminal', col: 0, row: 0 },
        { id: 'api', label: 'View API', sub: 'ADD, random shard', col: 1.5, row: 0 },
        { id: 'shards', label: 'Shard items: {n}', sub: '{size} WCU per write', col: 3, row: 1 },
        { id: 'live', label: 'Live counter', sub: '1,500 reads/s', kind: 'terminal', col: 0, row: 2 },
        { id: 'reader', label: 'Batch\u200BGetItem ×{n}', sub: 'sum all shards', col: 1.5, row: 2 },
      ],
      edges: [
        ['viewers', 'api'],
        ['api', 'shards', 'ADD'],
        ['live', 'reader'],
        ['reader', 'shards'],
      ],
      knobs: [
        {
          id: 'size',
          label: 'Shard item',
          kind: 'choice',
          initial: 3,
          choices: [
            { value: 1, label: '0.4 KB count' },
            { value: 3, label: '2.5 KB + meta' },
          ],
          help: 'write units per increment',
        },
        { id: 'n', label: 'Shards', kind: 'stepper', min: 1, max: 16, initial: 1, help: 'VIEWS#id#0 … #n−1' },
        {
          id: 'read',
          label: 'Read mode',
          kind: 'choice',
          initial: 0.5,
          choices: [
            { value: 0.5, label: 'Eventual' },
            { value: 1, label: 'Strong' },
            { value: 2, label: 'Transact' },
          ],
          help: 'RCU per item read (≤ 4 KB)',
        },
      ],
      constraints: [
        {
          id: 'hot',
          label: 'Hottest shard ≤ 1,000 WCU',
          left: { op: 'div', args: [{ op: 'mul', args: [VIEWS, WCU] }, N] },
          op: '<=',
          right: 1000,
          unit: ' WCU',
          hint: 'One key can never exceed one partition\'s write ceiling, even after adaptive capacity. Writes cost 1 WCU per started KB.',
          fail: 'Each shard takes more writes than one partition can absorb, so increments throttle however much table capacity you buy.',
          pass: 'Increments spread over enough shards that none exceeds the 1,000 WCU per-partition ceiling.',
        },
        {
          id: 'fresh',
          label: 'Total includes every acked view',
          left: RCU,
          op: '>=',
          right: 1,
          unit: ' RCU',
          decimals: 1,
          hint: 'Which read modes are guaranteed to reflect every write that has already been acknowledged?',
          fail: 'Eventually consistent reads may miss recent increments, so the live total can lag behind acknowledged views.',
          pass: 'Each shard read reflects every acknowledged write.',
        },
        {
          id: 'budget',
          label: 'Total reads ≤ 15,000 RCU',
          left: { op: 'mul', args: [READS, N, RCU] },
          op: '<=',
          right: 15000,
          unit: ' RCU',
          hint: 'Every live-counter read fetches all n shards, each costing the read mode\'s RCU.',
          fail: 'Scatter-gather reads across the shards cost more than the 15,000 RCU budget: more shards or a pricier read mode multiplies every read.',
          pass: 'Reading all shards 1,500 times a second fits the read budget.',
        },
      ],
      why: [
        'One key tops out at 1,000 WCU, so 10,000 increments/s need about 10 write shards of a small item.',
        'Write cost is per started KB: a 2.5 KB item costs 3 WCU per increment and needs three times the shards.',
        'Write sharding moves the cost to reads: every total is a scatter-gather over n shards.',
        'Strongly consistent reads cost 1 RCU per 4 KB, eventual 0.5, transactional 2; pick the cheapest that meets the requirement.',
      ],
    },
    {
      mode: 'sequence',
      id: 'zookeeper-lock-recipe',
      tab: 'ZooKeeper lock',
      title: 'ZooKeeper lock that survives a lost reply',
      brief:
        'Only one payout worker may run at a time. Its create call for the lock node gets CONNECTIONLOSS, and another worker already holds the lock. Put the messages in order so the worker neither orphans a node nor stampedes the ensemble.',
      layout: 'ladder',
      actors: [
        { id: 'c', label: 'Worker', sub: 'payout job' },
        { id: 'z', label: 'ZooKeeper', sub: '3-node ensemble' },
      ],
      steps: [
        {
          id: 'create',
          label: 'create /lock/<guid>-lock-',
          sub: 'EPHEMERAL_SEQUENTIAL',
          from: 'c',
          to: 'z',
          clue: 'Join the queue for the lock',
          is: 'an ephemeral, sequential node named with a client GUID, so it vanishes with the session and can be recognised later',
        },
        {
          id: 'loss',
          label: 'CONNECTIONLOSS',
          sub: 'reply never arrived',
          from: 'z',
          to: 'c',
          clue: 'Did the create happen?',
          is: 'a lost reply: the create may have succeeded on the server even though the worker never heard back',
        },
        {
          id: 'list',
          label: 'getChildren /lock',
          sub: 'look for own GUID',
          from: 'c',
          to: 'z',
          clue: 'Check before retrying',
          is: 'listing the lock\'s children to find a node carrying our GUID instead of blindly creating another',
        },
        {
          id: 'found',
          label: 'lock-05, <guid>-lock-07',
          sub: 'ours exists, not lowest',
          from: 'z',
          to: 'c',
          clue: 'Someone is ahead of us',
          is: 'proof the first create worked: our node is 07, and 05 holds the lock',
        },
        {
          id: 'watch',
          label: 'exists(lock-05, watch)',
          sub: 'predecessor only',
          from: 'c',
          to: 'z',
          clue: 'Wait on exactly one node',
          is: 'a watch on just the next-lower node, so one release wakes one waiter instead of the whole herd',
        },
        {
          id: 'deleted',
          label: 'NodeDeleted lock-05',
          sub: 'one-shot watch fires',
          from: 'z',
          to: 'c',
          clue: 'The holder let go',
          is: 'the watch firing because the predecessor\'s node was deleted (released, or its session expired)',
        },
        {
          id: 'recheck',
          label: 'getChildren /lock (re-check)',
          sub: 'am I lowest now?',
          from: 'c',
          to: 'z',
          clue: 'A watch says "go look"',
          is: 'reading the children again, because a watch only signals that something changed, not what the state is',
        },
        {
          id: 'held',
          label: '[<guid>-lock-07] → lowest',
          sub: 'lock held',
          from: 'z',
          to: 'c',
          clue: 'Our turn',
          is: 'our node is now the lowest sequence, so this worker holds the lock (and can use the czxid as a fencing token)',
        },
      ],
      decoys: [
        {
          id: 'blind',
          label: 'create again, no GUID check',
          sub: 'blind retry',
          is: 'how locks deadlock: the first node may exist (possibly lowest) and is never deleted while the session lives',
        },
        {
          id: 'herd',
          label: 'getChildren(/lock, watch)',
          sub: 'watch every child',
          is: 'the herd effect: every change wakes every waiter, which then all hit the ensemble at once',
        },
        {
          id: 'persistent',
          label: 'create PERSISTENT /lock/owner',
          sub: 'plain node',
          is: 'a node that outlives a crashed holder, so the lock is never released without manual cleanup',
        },
      ],
      why: [
        'Ephemeral sequential nodes give a fair queue that cleans itself up when a holder\'s session ends.',
        'After CONNECTIONLOSS the create may have succeeded: a GUID in the name lets the client find its own node (Curator\'s protection mode).',
        'Watch only your predecessor to avoid the herd, and re-read on every watch because standard watches are one-shot "go look" signals.',
        'A lock does not stop a paused former holder: pass the czxid or sequence as a fencing token to storage.',
      ],
    },
    {
      mode: 'route',
      id: 'dynamo-access-path-routing',
      tab: 'Route the reads',
      title: 'Single-table shop: send each read down the right path',
      brief:
        'An orders service on one DynamoDB table (PK = CUST# / ORDER#, a sparse GSI1 for open orders per warehouse) also has a DAX cluster and a nightly S3 export. Steer each read so it is correct, fresh enough and does not burn capacity. Read rates are scenario numbers.',
      cols: 4,
      rows: 3.4,
      nodes: [
        { id: 'app', label: 'Orders service', sub: 'NestJS · SDK v3', kind: 'terminal', col: 0, row: 1.35 },
        { id: 'dax', label: 'DAX cluster', sub: 'item + query cache', col: 1.5, row: 0.15 },
        { id: 'ddb', label: 'DynamoDB client', sub: 'plain SDK calls', col: 1.5, row: 1.35 },
        { id: 'export', label: 'S3 export + Athena', sub: 'nightly, full table', col: 1.5, row: 2.6 },
        { id: 'table', label: 'Base table', sub: 'PK + SK · strong reads', col: 3, row: 0.15 },
        { id: 'gsi', label: 'GSI1 (sparse)', sub: 'WH#…#OPEN · eventual', col: 3, row: 1.35 },
        { id: 'scan', label: 'Scan + Filter­Expression', sub: 'reads every item', col: 3, row: 2.6 },
      ],
      edges: [
        ['app', 'dax'],
        ['app', 'ddb'],
        ['app', 'export'],
        ['dax', 'table', 'on miss'],
        ['ddb', 'table'],
        ['ddb', 'gsi'],
        ['ddb', 'scan'],
      ],
      packets: [
        {
          id: 'hot-product',
          label: 'Product 7 page: GetItem, 20K reads/s',
          sub: 'one item · a few seconds stale is fine',
          from: 'app',
          paths: [['app', 'dax', 'table']],
          wrong: {
            'app>ddb':
              'One key can never exceed 3,000 RCU, even after adaptive capacity. 20K eventually consistent reads/s of one item need 10,000 RCU, so the item’s partition throttles however much table capacity you buy.',
            'app>export':
              'The export is a nightly batch copy for analytics. A product page needs a millisecond key lookup, not an Athena query over yesterday’s data.',
          },
          done: 'DAX’s item cache answers GetItem in microseconds and only misses reach the table, so the read-hot key stays far below its 3,000 RCU partition ceiling.',
        },
        {
          id: 'my-orders',
          label: '“My orders” right after checkout',
          sub: 'must show the order just written',
          from: 'app',
          paths: [['app', 'ddb', 'table']],
          wrong: {
            'app>dax':
              'A write through DAX updates the item cache but does not invalidate cached Query results, so re-running the same Query shows the old list until the query-cache TTL (5 min default) expires.',
            'app>export':
              'The export is hours behind and meant for analytics; the order placed a second ago is not in it.',
            'ddb>gsi':
              'GSIs are eventually consistent only. There is no read-your-write through a GSI, so the new order may be missing from the list.',
            'ddb>scan':
              'A Scan reads every item in the table and the filter is applied after the read, so you pay for the whole table to find one customer’s orders.',
          },
          done: 'Query PK = CUST#42, SK begins_with ORDER# on the base table with a strongly consistent read: the customer’s item collection, newest first, including the order just written.',
        },
        {
          id: 'open-orders',
          label: 'Picker screen: open orders in BLR-1',
          sub: 'key = warehouse, not customer',
          from: 'app',
          paths: [['app', 'ddb', 'gsi']],
          wrong: {
            'app>dax':
              'The DAX query cache would keep showing orders that were already picked for up to its TTL. This list changes all the time and should come from the index itself.',
            'app>export':
              'A nightly export cannot drive a live picking screen: orders placed today would be invisible until tomorrow.',
            'ddb>table':
              'The base table is keyed by customer and order. There is no key condition that finds a warehouse’s open orders, so this pattern needs its own index.',
            'ddb>scan':
              'Scan + FilterExpression pays for every item read (1 MB per page) and throws almost all of them away. Filters do not save capacity: model a key or a sparse index instead.',
          },
          done: 'Query GSI1PK = WH#BLR-1#OPEN on the sparse GSI. Only open orders carry the GSI1 attributes, so the index stays tiny and returns exactly the list; a second of index lag is fine here.',
        },
        {
          id: 'finance',
          label: 'Finance: revenue by region, last quarter',
          sub: 'ad-hoc · asked once a month',
          from: 'app',
          paths: [['app', 'export']],
          wrong: {
            'app>dax':
              'DAX caches items and query results for known keys. An ad-hoc aggregate over the whole table is not a key lookup, and a cache cannot add the missing query shape.',
            'app>ddb':
              'DynamoDB has no joins or aggregates: answering this means a Scan of the whole table (O(table) read cost) or yet another GSI for a question asked once a month.',
          },
          done: 'Ad-hoc analytics belong outside the hot path: export the table to S3 (full or incremental) and query it with Athena, without touching the table’s capacity.',
        },
      ],
      why: [
        'One key can never exceed 3,000 RCU / 1,000 WCU; absorb read-hot items with DAX or an app cache.',
        'DAX writes update the item cache but not cached Query results, and GSIs are eventually consistent: read-your-write lists come from the base table.',
        'Patterns that do not match the table key get a (sparse) GSI, never Scan + filter, because filters are applied after you pay for the read.',
        'Analytics and ad-hoc questions go to an export (S3 + Athena) or a warehouse.',
      ],
    },
    {
      mode: 'match',
      id: 'temporal-primitive-match',
      tab: 'Temporal toolbox',
      title: 'Temporal: pick the primitive for each request',
      brief:
        'The team is moving an order and subscription platform onto Temporal, and six requirements arrive in one planning meeting. Patch each one to the Temporal feature that solves it without breaking replay.',
      leftTitle: 'Requirement',
      rightTitle: 'Feature',
      instruction: 'Connect each requirement to the feature that solves it',
      left: [
        {
          id: 'webhook',
          label: 'Payment webhook arrived; caller needs nothing back',
          answer: 'signal',
          because: 'A Signal pushes an event into the running workflow, is recorded in history and returns only an acknowledgement: right for fire-and-forget events.',
        },
        {
          id: 'status',
          label: 'Support dashboard: “where is order 123 stuck?”',
          answer: 'query',
          because: 'A Query handler is read-only, computes a value from current workflow state and is not recorded in history, so a dashboard can poll it freely.',
        },
        {
          id: 'cart',
          label: 'Add to cart: return the total, reject if cart closed',
          answer: 'update',
          because: 'An Update is synchronous: its validator can reject the request before anything is recorded, and the caller gets a result or an error back.',
        },
        {
          id: 'loop',
          label: 'Monthly subscription loop is nearing 10,240 history events',
          answer: 'can',
          because: 'Continue-As-New completes the run and starts a fresh one with the same workflow id, carrying state as input, before the hard 51,200-event / 50 MB limit terminates it.',
        },
        {
          id: 'fraud',
          label: 'Add a fraud check while old orders are still in flight',
          answer: 'patch',
          because: 'patched() writes a marker: new executions take the new branch, while old histories without the marker replay the old path, so in-flight orders do not hit a non-determinism error.',
        },
        {
          id: 'transcode',
          label: '30-min transcode activity; worker died at minute 4',
          answer: 'heartbeat',
          because: 'With heartbeats, a stopped heartbeat fails the attempt fast instead of waiting out Start-To-Close, and the retry can resume from the last heartbeat details.',
        },
      ],
      right: [
        { id: 'signal', label: 'Signal', sub: 'async, into the workflow', is: 'a fire-and-forget message into a running workflow that mutates its state and is recorded in history' },
        { id: 'query', label: 'Query', sub: 'read-only handler', is: 'a read-only call that returns a value computed from the workflow’s current state without recording anything' },
        { id: 'update', label: 'Update + validator', sub: 'sync, can reject', is: 'a synchronous, validated state change that returns a result or an error to the caller' },
        { id: 'can', label: 'Continue-As-New', sub: 'same id, fresh history', is: 'atomically completing a run and starting a new one with the same workflow id and the state carried as input' },
        { id: 'patch', label: 'patched(\'add-fraud-check\')', sub: 'marker in history', is: 'a versioning branch that records a marker so old executions replay the old code path' },
        { id: 'heartbeat', label: 'Heartbeat timeout', sub: 'heartbeat(progress)', is: 'a per-activity liveness timeout that fails an attempt as soon as its heartbeats stop' },
        {
          id: 'envflag',
          label: 'Read a feature flag in workflow',
          sub: 'process.env at runtime',
          decoy: true,
          is: 'a non-determinism bug: a value outside the history can differ on replay, so a replay months later issues different commands',
        },
        {
          id: 'longstc',
          label: 'Start-To-Close = 2 h',
          sub: 'one big attempt timeout',
          decoy: true,
          is: 'a timeout that only fires after the full two hours, so a dead worker is noticed far too late and no progress is kept',
        },
      ],
      why: [
        'Signal for events, Query for read-only status, Update when the caller needs a validated answer.',
        'Histories are capped at 51,200 events or 50 MB; Continue-As-New keeps long-lived workflows small.',
        'Changing workflow code with executions in flight needs patching or Worker Versioning, and replay tests in CI.',
        'Long activities heartbeat so a dead worker is detected quickly and the retry can resume from progress.',
      ],
    },
    {
      mode: 'fault',
      id: 'orders-table-throttling',
      tab: 'Throttled with headroom',
      title: 'DynamoDB throttles with 90% of capacity unused',
      brief:
        'An orders table is provisioned at 40,000 WCU, yet checkout writes throttle all day, the warehouse dashboard costs more than checkout, and new orders fail whenever a back-office job runs. Metric values are scenario numbers. Find the three misconfigured pieces.',
      cols: 5.4,
      rows: 3.5,
      nodes: [
        { id: 'api', label: 'Checkout API', sub: 'PutItem per order', kind: 'terminal', col: 0, row: 0.4 },
        {
          id: 'key',
          label: 'Table key: PK = status',
          sub: 'PENDING / PAID / SHIPPED',
          col: 1.4,
          row: 0.4,
          fault: {
            answer: 'ulid',
            why: 'A status has three values, so every new order lands on the PENDING key. One key can never exceed 1,000 WCU, so writes throttle while the table’s 40,000 WCU sit unused.',
            clue: 'Spread writes over many keys',
          },
        },
        {
          id: 'table',
          label: 'Orders table',
          sub: '40,000 WCU provisioned',
          col: 2.9,
          row: 0.4,
          fine: 'Table-level capacity is ample. ThrottledRequests with plenty of table headroom is the hot-partition signature, so the cause is how requests are keyed, not the total.',
        },
        {
          id: 'gsi',
          label: 'GSI1 open orders',
          sub: '100 WCU provisioned',
          col: 4.4,
          row: 0.4,
          fault: {
            answer: 'gsicap',
            why: 'Every base-table write that touches GSI1 attributes also writes the index. An under-provisioned GSI throttles writes to the base table, which is why orders fail when the back-office job updates many orders.',
            clue: 'Give the index its own headroom',
          },
        },
        {
          id: 'dash',
          label: 'Dashboard: Scan every 10 s',
          sub: 'Filter wh = BLR-1',
          col: 1.4,
          row: 2.6,
          fault: {
            answer: 'gsiquery',
            why: 'A filter is applied after the items are read, so every Scan pays for the whole table in 1 MB pages just to keep a few open orders.',
            clue: 'Read only the open orders',
          },
        },
        {
          id: 'streams',
          label: 'Streams → 1 Lambda',
          sub: 'one reader per shard',
          col: 2.9,
          row: 2.6,
          fine: 'One consumer per shard is within the ≤ 2 readers guidance, and the stream feeds email asynchronously; it never slows writes.',
        },
        { id: 'ops', label: 'Back-office job', sub: 'bulk status updates', kind: 'terminal', col: 4.4, row: 2.6 },
      ],
      edges: [
        ['api', 'key'],
        ['key', 'table', 'PutItem'],
        ['table', 'gsi', 'async'],
        ['table', 'streams'],
        ['dash', 'table', 'Scan'],
        ['ops', 'gsi'],
      ],
      options: [
        { id: 'ulid', label: 'PK = ORDER# + ULID', sub: 'high-cardinality key', is: 'a high-cardinality, time-ordered partition key that spreads writes evenly over all partitions' },
        { id: 'gsicap', label: 'GSI WCU ≥ index writes', sub: 'or on-demand mode', is: 'provisioning the index for the writes it receives, so index maintenance never back-pressures the base table' },
        { id: 'gsiquery', label: 'Query GSI1 WH#BLR-1#OPEN', sub: 'sparse index read', is: 'a key-condition read on the sparse index that returns only open orders and pays only for what it reads' },
        {
          id: 'dax',
          label: 'Put DAX in front',
          sub: 'microsecond reads',
          decoy: true,
          is: 'a read cache, which does not help hot writes and does not make a Scan cheaper on a table that changes every second',
        },
        {
          id: 'morewcu',
          label: 'Raise table to 80,000 WCU',
          sub: 'double the total',
          decoy: true,
          is: 'more table capacity, but a single key is still capped at 1,000 WCU, so the hot PENDING key throttles exactly as before',
        },
      ],
      metrics: [
        { label: 'Throttled writes', bad: 4200, good: 0, unit: '/s', fixedBy: ['key', 'gsi'] },
        { label: 'Hottest key WCU', bad: 1000, good: 40, unit: ' WCU', fixedBy: ['key'] },
        { label: 'Dashboard RCU', bad: 9000, good: 5, unit: '/s', fixedBy: ['dash'] },
      ],
      why: [
        'Partition keys need high cardinality: status, date or a dominant tenant funnel writes onto one partition capped at 1,000 WCU.',
        'ThrottledRequests with table-level headroom is the classic hot-partition signature (Contributor Insights shows the key).',
        'A GSI has its own capacity; an under-provisioned one throttles base-table writes.',
        'Filters do not save capacity: list views come from a sparse GSI, not Scan + filter.',
      ],
    },
  ],
};

export default set;
