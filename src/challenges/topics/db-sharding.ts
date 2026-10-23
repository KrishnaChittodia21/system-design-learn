import type { ChallengeSet, Expr } from '../types';

const T: Expr = { knob: 'T' };
const W: Expr = { knob: 'W' };
const S: Expr = { knob: 'S' };
const pow2 = (x: Expr): Expr => ({ op: 'fn', fn: 'pow', args: [2, x] });
/** milliseconds in a (Julian) year */
const MS_PER_YEAR = 31557600000;

const set: ChallengeSet = {
  topic: 'db-sharding',
  puzzles: [
    {
      mode: 'flow',
      id: 'logical-shard-router',
      tab: 'Shard router',
      title: 'A social app\'s sharded user store',
      brief:
        'Users are sharded by user_id over two Postgres servers today and must grow to ten without rehashing everyone. A celebrity profile gets 500K reads/s, and login looks users up by email.',
      cols: 5.1,
      rows: 3.6,
      nodes: [
        { id: 'app', label: 'App servers', sub: 'user_id in every query', kind: 'terminal', col: 0, row: 1.3 },
        { id: 'cache', answer: 'cache', hint: 'Absorbs one key\'s huge read rate', col: 1, row: 0 },
        { id: 'router', label: 'Query router', sub: 'VTGate / app library', col: 1.2, row: 1.3 },
        { id: 'gsi', answer: 'gsi', hint: 'Find a user without their user_id', col: 1.2, row: 2.7 },
        { id: 'bucket', answer: 'logical', hint: 'Fixed bucket count, never rehashed', col: 2.4, row: 1.3 },
        { id: 'map', answer: 'map', hint: 'Moving data = editing this', col: 3.4, row: 1.3 },
        { id: 'db1', label: 'pg-1', sub: 'logical 0–2047', col: 4.4, row: 0.5 },
        { id: 'db2', label: 'pg-2', sub: 'logical 2048–4095', col: 4.4, row: 2.1 },
      ],
      edges: [
        ['app', 'cache', 'hot reads'],
        ['app', 'router'],
        ['router', 'gsi'],
        ['router', 'bucket'],
        ['bucket', 'map'],
        ['map', 'db1'],
        ['map', 'db2'],
      ],
      options: [
        {
          id: 'logical',
          label: 'Hash into 4,096 buckets',
          sub: 'logical shards',
          is: 'hashing into a large, fixed number of logical shards, so adding servers never changes which bucket a key is in',
        },
        {
          id: 'map',
          label: 'Logical → physical map',
          sub: 'small, versioned',
          is: 'the small table that says which server owns each logical shard; resharding moves whole shards and flips this map',
        },
        {
          id: 'cache',
          label: 'Redis / in-process cache',
          sub: 'short TTL',
          is: 'a read cache in front of the shard, so a celebrity profile read 500K times/s never reaches the database',
        },
        {
          id: 'gsi',
          label: 'Global index: email → id',
          sub: 'updated async',
          is: 'a global secondary index maintained asynchronously, so a login finds the user_id without asking every shard',
        },
        {
          id: 'modulo',
          label: 'Hash mod server count',
          sub: 'physical modulo',
          decoy: true,
          is: 'modulo over physical nodes: going from N to N+1 servers moves about N/(N+1) of all keys (80% from 4 → 5)',
        },
        {
          id: 'range',
          label: 'Range shard on created_at',
          sub: 'new users together',
          decoy: true,
          is: 'range sharding on a monotonic key, which sends every new signup to the last shard: a permanent hotspot',
        },
        {
          id: 'scatter',
          label: 'Ask every shard by email',
          sub: 'scatter-gather',
          decoy: true,
          is: 'a fan-out on every login that costs the slowest shard\'s latency and grows with the shard count',
        },
      ],
      why: [
        'Hash into many fixed logical shards and map them to servers: resharding moves whole logical shards, never rehashes keys.',
        'Pick the logical count 10–100× above the largest physical count you can foresee.',
        'A hot key is not fixed by splitting shards: cache its reads (and salt its writes) instead.',
        'Queries without the shard key need a global secondary index, or they become scatter-gather.',
      ],
    },
    {
      mode: 'route',
      id: 'sharded-query-routes',
      tab: 'Route the queries',
      title: 'Orders sharded by customer: where does each query go?',
      brief:
        'A marketplace hash-distributes orders, order items and payments by customer_id (co-located) over 4,096 logical shards on two servers. A merchant-keyed copy is kept by CDC, and analytics runs on a CDC-fed warehouse. Send each query where it touches the fewest shards and stays correct.',
      cols: 4,
      rows: 3.4,
      nodes: [
        { id: 'app', label: 'Orders API', sub: 'NestJS', kind: 'terminal', col: 0, row: 1.2 },
        { id: 'router', label: 'Shard router', sub: 'hash → slot → server', col: 1.5, row: 1.2 },
        { id: 's1', label: 'pg-1', sub: 'slots 0–2047', col: 3, row: 0.05 },
        { id: 's2', label: 'pg-2', sub: 'slots 2048–4095', col: 3, row: 1.2 },
        { id: 'bymerchant', label: 'orders_by_\u200Bmerchant', sub: 'keyed by merchant_id', col: 3, row: 2.35 },
        { id: 'olap', label: 'Warehouse', sub: 'CDC · seconds behind', col: 1.5, row: 2.35 },
      ],
      edges: [
        ['app', 'router', 'OLTP'],
        ['app', 'olap', 'reports'],
        ['router', 's1'],
        ['router', 's2'],
        ['router', 'bymerchant'],
      ],
      packets: [
        {
          id: 'my-orders',
          label: 'My orders: customer 42, latest 20',
          sub: 'customer 42 → slot 731',
          from: 'app',
          paths: [['app', 'router', 's1']],
          wrong: {
            'app>olap':
              'The warehouse is fed by CDC and is seconds behind, and it is built for scans, not a user’s own page. An order placed a moment ago would be missing.',
            'router>s2': 'Customer 42 hashes to slot 731, and pg-2 owns slots 2048–4095. That server has none of this customer’s orders.',
            'router>bymerchant':
              'The merchant copy is keyed by merchant_id, so finding one customer’s orders there would mean asking every merchant partition: a scatter-gather.',
          },
          done: 'The shard key is in the WHERE clause, so the router hashes it to one slot and one server. created_at sorts rows inside the shard, so "latest 20 for this customer" stays a single-shard query.',
        },
        {
          id: 'checkout',
          label: 'Checkout: order + items + payment, one txn',
          sub: 'customer 7001 → slot 3,512',
          from: 'app',
          paths: [['app', 'router', 's2']],
          wrong: {
            'app>olap': 'A warehouse is a read-only analytics copy. A checkout is an OLTP write and must go to the shard that owns the customer.',
            'router>s1': 'Slot 3,512 is in pg-2’s range (2048–4095). Writing on pg-1 would put the order on a server the router will never read it from.',
            'router>bymerchant':
              'The merchant copy is filled asynchronously by CDC from the shards. Writing to it directly would skip the source of truth and break the copy.',
          },
          done: 'Orders, items and payments are co-located on customer_id, so all three rows live on pg-2 and the checkout is an ordinary single-shard ACID transaction, with no 2PC or saga.',
        },
        {
          id: 'merchant',
          label: 'Merchant 9: today’s orders for my store',
          sub: 'no customer_id in the query',
          from: 'app',
          paths: [['app', 'router', 'bymerchant']],
          wrong: {
            'app>olap':
              'A merchant watching live orders needs fresher answers than a reporting store, and this is a hot OLTP query that belongs on a serving copy.',
            'router>s1':
              'Without customer_id the router cannot pick a shard. Orders for merchant 9 are spread over every slot, so pg-1 alone returns only part of them.',
            'router>s2':
              'Without customer_id the router cannot pick a shard. Orders for merchant 9 are spread over every slot, so pg-2 alone returns only part of them.',
          },
          done: 'The second access path is served by a denormalized copy keyed by merchant_id. One partition answers instead of a fan-out to every shard, at the cost of write amplification and a little CDC lag.',
        },
        {
          id: 'revenue',
          label: 'Finance: revenue by country, last 12 months',
          sub: 'ad-hoc aggregate over all orders',
          from: 'app',
          paths: [['app', 'olap']],
          wrong: {
            'app>router':
              'An aggregate over every order would scatter to every shard and every slot. Its latency follows the slowest shard, and it competes with checkouts for OLTP capacity.',
          },
          done: 'Ad-hoc analytics is offloaded to a CDC-fed warehouse. Seconds of lag are fine for a 12-month report, and the shards keep serving users.',
        },
      ],
      why: [
        'Pick the shard key for the dominant OLTP path, and put it in the WHERE clause so the router sends the query to one shard.',
        'Co-locate tables that change together (orders, items, payments by customer_id) so a business transaction stays on one shard.',
        'Serve a second access path with a copy keyed differently, or with a global index, rather than scatter-gather.',
        'Push ad-hoc analytics to a CDC-fed store: a fan-out query costs as much as the slowest shard and multiplies load.',
      ],
    },
    {
      mode: 'tune',
      id: 'snowflake-bits',
      tab: 'Snowflake ID layout',
      title: 'Lay out a 64-bit Snowflake ID',
      brief:
        'Orders across shards need k-sorted IDs that fit a Postgres bigint. Scenario: up to 1,000 generator pods, bursts of 4,000 IDs per millisecond per pod, and IDs must not run out for 50 years.',
      cols: 5,
      rows: 1.2,
      nodes: [
        { id: 'sign', label: 'Sign', sub: '1 bit, unused', col: 0, row: 0.1 },
        { id: 'ts', label: 'Timestamp · {T} bits', sub: 'ms since custom epoch', col: 1, row: 0.1 },
        { id: 'worker', label: 'Worker ID · {W} bits', sub: 'leased via etcd', col: 2, row: 0.1 },
        { id: 'seq', label: 'Sequence · {S} bits', sub: 'resets every ms', col: 3, row: 0.1 },
        { id: 'id', label: 'Order ID', sub: 'bigint, k-sorted', kind: 'terminal', col: 4, row: 0.1 },
      ],
      edges: [
        ['sign', 'ts'],
        ['ts', 'worker'],
        ['worker', 'seq'],
        ['seq', 'id'],
      ],
      knobs: [
        { id: 'T', label: 'Timestamp bits', kind: 'stepper', min: 38, max: 44, initial: 41, help: 'milliseconds since a custom epoch' },
        { id: 'W', label: 'Worker ID bits', kind: 'stepper', min: 6, max: 14, initial: 12, help: 'unique per generator' },
        { id: 'S', label: 'Sequence bits', kind: 'stepper', min: 8, max: 16, initial: 12, help: 'counter within one millisecond' },
      ],
      constraints: [
        {
          id: 'fit',
          label: 'Fits a signed bigint',
          left: { op: 'add', args: [T, W, S] },
          op: '<=',
          right: 63,
          unit: ' bits',
          hint: 'A bigint has 64 bits and one of them is the sign.',
          fail: 'The fields need more than 63 bits, so the ID no longer fits a signed 64-bit integer.',
          pass: 'Timestamp + worker + sequence fit in the 63 bits after the sign bit.',
        },
        {
          id: 'years',
          label: 'Lifetime ≥ 50 years',
          left: { op: 'div', args: [pow2(T), MS_PER_YEAR] },
          op: '>=',
          right: 50,
          unit: ' yrs',
          decimals: 1,
          hint: 'The timestamp counts milliseconds. How many years fit in 2^T ms?',
          fail: 'The timestamp field overflows before 50 years: 40 bits of milliseconds last only about 35 years.',
          pass: '2^41 ms is about 69.7 years from the custom epoch.',
        },
        {
          id: 'workers',
          label: 'Worker IDs ≥ 1,000 pods',
          left: pow2(W),
          op: '>=',
          right: 1000,
          unit: ' IDs',
          hint: 'Every generator needs its own worker ID, or two pods mint duplicates.',
          fail: 'There are fewer worker IDs than pods: two pods would share an ID and generate duplicates.',
          pass: '10 bits give 1,024 worker IDs, one per pod (assigned by a lease).',
        },
        {
          id: 'burst',
          label: 'IDs per ms per pod ≥ 4,000',
          left: pow2(S),
          op: '>=',
          right: 4000,
          unit: '/ms',
          hint: 'The sequence counts IDs within one millisecond on one worker.',
          fail: 'The sequence runs out within the millisecond, so the generator must spin until the next one during bursts.',
          pass: '12 bits give 4,096 IDs per millisecond per worker, about 4.1M per second.',
        },
      ],
      why: [
        'Snowflake: 1 sign bit, 41 bits of milliseconds (~69.7 years), 10 bits of worker ID, 12 bits of sequence.',
        'Every bit is a trade: a longer lifetime or more workers must come out of another field.',
        'IDs are k-sorted: roughly time-ordered across workers, strictly ordered within one, and they need no coordination.',
        'Guard the two pitfalls: clock rollback (refuse to generate) and duplicate worker IDs (lease them).',
      ],
    },
    {
      mode: 'sequence',
      id: 'orders-shard-migration',
      tab: 'Live migration',
      title: 'Move a live orders table to the new shards',
      brief:
        'The orders table must move from one Postgres to the new sharded cluster with no downtime, no lost writes, and a way back at every step. Put the playbook in order.',
      layout: 'stages',
      steps: [
        {
          id: 'prepare',
          label: 'Prepare: idempotent writes',
          sub: 'router: old/new/shadow',
          clue: 'Make replays safe first',
          is: 'standing up the new shards and making writes idempotent upserts, with a router flag for old, new and shadow modes',
        },
        {
          id: 'cdc',
          label: 'Start CDC from old DB',
          sub: 'tail the WAL',
          clue: 'Capture before copying',
          is: 'change capture that tails the old WAL in order and catches writes from every writer, started before the snapshot',
        },
        {
          id: 'backfill',
          label: 'Backfill in PK chunks',
          sub: '5–10K rows, throttled',
          clue: 'Copy history; newer wins',
          is: 'copying historical rows in throttled primary-key chunks, where a newer streamed change always wins',
        },
        {
          id: 'verify',
          label: 'Shadow reads + checksums',
          sub: '0 mismatches for days',
          clue: 'Prove the copy matches',
          is: 'comparing row counts, chunk checksums and asynchronous shadow reads against the old store',
        },
        {
          id: 'reads',
          label: 'Shift reads 1% → 100%',
          sub: 'watch errors and p99',
          clue: 'Move readers gradually',
          is: 'cutting reads over by percentage, sticky per key, while watching error rate and p99',
        },
        {
          id: 'writes',
          label: 'Flip writes, reverse CDC',
          sub: 'seconds of write freeze',
          clue: 'The one risky moment',
          is: 'stopping writes to the old store, waiting for lag 0, flipping the map, then replicating new → old to keep rollback possible',
        },
        {
          id: 'contract',
          label: 'Contract: drop old tables',
          sub: 'after 1–4 weeks',
          clue: 'Clean up after the bake',
          is: 'removing reverse replication, old code paths and old tables once the bake period is over',
        },
      ],
      decoys: [
        {
          id: 'late',
          label: 'Backfill, then start CDC',
          sub: 'copy first',
          is: 'the classic ordering bug: every write that lands during the backfill is missed',
        },
        {
          id: 'bigbang',
          label: 'Flip reads + writes at once',
          sub: 'big-bang cutover',
          is: 'a cutover with no gradual read shift and no shadow comparison, so the first sign of a bug is production',
        },
        {
          id: 'drop',
          label: 'Drop the old DB at cutover',
          sub: 'save money',
          is: 'deleting the rollback path at the riskiest moment; the old copy stays (with reverse replication) through the bake',
        },
      ],
      why: [
        'Start capturing changes before the backfill snapshot, never after.',
        'CDC beats application dual writes: ordered per key, catches every writer, no partial-failure divergence.',
        'Shadow reads and checksums prove correctness; reads move gradually before writes.',
        'Reverse replication after the write flip keeps rollback possible until the contract step.',
      ],
    },
    {
      mode: 'spike',
      id: 'hot-key-fanout-spike',
      tab: 'Hot key + fan-out',
      title: 'A viral post and a hashtag page melt the shards',
      brief:
        'A social app shards posts by user_id over 64 Postgres shards. At second 6 a celebrity’s post starts taking 40K likes/s on one row, and later the "posts by hashtag" page (no shard key, so it asks all 64 shards) climbs from 300 to 1,500 req/s. Scenario sizing: the hot shard takes ~10K writes/s; each shard has ~1K q/s spare for the hashtag page. Two changes.',
      cols: 4,
      rows: 2.1,
      nodes: [
        { id: 'users', label: 'App users', sub: 'hashtag page + likes', kind: 'terminal', col: 0, row: 0.55 },
        { id: 'router', label: 'Shard router', sub: 'no shard key → all 64', col: 1.35, row: 0.55, share: 1, ms: 5 },
        { id: 'hot', label: 'Shard 7', sub: 'post 42 · likes row', col: 2.95, row: 0, capacity: 10000, unit: 'writes/s', base: 2000, ms: 2, timeoutMs: 1000 },
        { id: 'all', label: '64 shards', sub: '~1K q/s spare each', col: 2.95, row: 1.1, share: 64, capacity: 64000, unit: 'q/s', ms: 20, timeoutMs: 1000 },
      ],
      edges: [
        ['users', 'router'],
        ['router', 'all', 'scatter × 64'],
        ['router', 'hot', 'UPDATE likes'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 300],
        [20, 300],
        [45, 1500],
        [60, 1500],
      ],
      bursts: [{ node: 'hot', from: 6, to: 60, add: 40000, label: 'post 42 viral' }],
      maxCards: 2,
      cards: [
        {
          id: 'salt',
          label: 'Salt into 16 sub-counters',
          sub: 'likes:42:#0..#15',
          node: 'hot',
          effects: [{ node: 'hot', load: 0.0625 }],
          is: 'write sharding: each like picks a random sub-key, so 40K writes/s on one row become ~2.5K/s per sub-key spread across shards, and reads sum the 16',
        },
        {
          id: 'batch',
          label: 'Buffer likes, flush each 1 s',
          sub: 'in memory or Kafka',
          node: 'hot',
          effects: [{ node: 'hot', load: 0.0001 }],
          is: 'aggregating increments in a buffer or stream: tens of thousands of likes per second become one UPDATE per second',
        },
        {
          id: 'gsi',
          label: 'Global index hashtag → post',
          sub: 'sharded by hashtag, async',
          node: 'all',
          effects: [{ node: 'all', load: 0.03 }],
          is: 'a term-partitioned index: the page reads one index shard and batch-fetches the posts, instead of asking all 64 shards (eventually consistent)',
        },
        {
          id: 'split',
          label: 'Split shard 7’s slot range',
          sub: 'move half to a new server',
          node: 'hot',
          decoy: true,
          effects: [],
          is: 'the fix for a hot shard, not a hot key: the likes row is one atomic key, so it still lands on one server after the split',
        },
        {
          id: 'more-shards',
          label: 'Go from 64 to 128 shards',
          sub: 'double the fleet',
          node: 'all',
          decoy: true,
          effects: [
            { node: 'all', load: 2 },
            { node: 'all', capacity: 2 },
          ],
          is: 'more servers for a fan-out query: every hashtag request now asks 128 shards, so the load doubles with the capacity and nothing improves',
        },
      ],
      goals: [
        { metric: 'p99', max: 300, label: 'p99 ≤ 300 ms', fail: 'Requests wait on a saturated shard until they hit the 1 s timeout.' },
        { metric: 'errors', max: 1, label: 'Errors ≤ 1%', fail: 'A shard is past its capacity, and the excess queries fail.' },
      ],
      why: [
        'Hashing spreads keys evenly, not traffic. A hot key is atomic, so splitting or moving shards does not cool it.',
        'Salt the hot key into K sub-keys (K = 16 turns one hot row into ~1/16 of the writes per sub-key), or buffer and flush increments once a second.',
        'A query without the shard key fans out to every shard: 1K req/s × 64 shards is 64K shard queries/s, and latency follows the slowest shard.',
        'A global secondary index (or a copy keyed by the other column) turns the fan-out into one index read. Adding shards only adds fan-out.',
      ],
    },
  ],
};

export default set;
