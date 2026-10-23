import type { ChallengeSet, Expr } from '../types';

const likeIso: Expr = { knob: 'likeIso' };
const likeStyle: Expr = { knob: 'likeStyle' };
const leaveIso: Expr = { knob: 'leaveIso' };
const retry: Expr = { knob: 'retry' };

const ISO = [
  { value: 1, label: 'Read Committed' },
  { value: 2, label: 'Repeatable Read' },
  { value: 3, label: 'Serializable' },
];

const set: ChallengeSet = {
  topic: 'db-fundamentals',
  puzzles: [
    {
      mode: 'match',
      id: 'requirement-to-store',
      tab: 'Requirement → store',
      title: 'Choose the store by the hardest requirement',
      brief:
        'Six squads are picking databases for a new super-app. Patch each requirement to the data model that fits its access pattern and invariants. Two options on the right are classic wrong answers.',
      leftTitle: 'Requirement',
      rightTitle: 'Store',
      left: [
        {
          id: 'ledger',
          label: 'Wallet ledger: balances must never go below zero',
          answer: 'pg',
          because: 'The invariant spans rows, so it needs multi-row ACID transactions and constraints: a relational database such as Postgres.',
        },
        {
          id: 'chat',
          label: 'Chat history: 1M+ writes/s, read by channel and time',
          answer: 'wide',
          because: 'Append-mostly, known queries at huge write volume: wide-column partitioned by (channel_id, bucket) scales writes linearly.',
        },
        {
          id: 'fraud',
          label: 'Fraud: find rings of accounts linked 3–4 hops apart',
          answer: 'graph',
          because: 'Multi-hop relationship queries are what graph databases are built for; joins per hop get slow in SQL.',
        },
        {
          id: 'board',
          label: 'Game leaderboard: top 100 and my rank, sub-ms',
          answer: 'redis',
          because: 'Redis sorted sets keep scores ordered in memory, so rank and top-N are sub-millisecond (with a durable store behind).',
        },
        {
          id: 'iot',
          label: 'Fleet sensor metrics with downsampling and retention',
          answer: 'ts',
          because: 'Append-heavy (series, timestamp) data with retention and downsampling is the time-series sweet spot.',
        },
        {
          id: 'product',
          label: 'Product page: one aggregate, attributes vary by category',
          answer: 'doc',
          because: 'An aggregate-shaped read with an evolving schema fits a document (MongoDB or Postgres JSONB): one record per screen.',
        },
      ],
      right: [
        { id: 'pg', label: 'PostgreSQL / MySQL', sub: 'relational', is: 'a relational store with joins, constraints and multi-row ACID transactions' },
        { id: 'wide', label: 'Cassandra / ScyllaDB', sub: 'wide-column', is: 'a wide-column store that scales writes linearly for queries known up front' },
        { id: 'graph', label: 'Neo4j / Neptune', sub: 'graph', is: 'a graph database built for multi-hop traversals' },
        { id: 'redis', label: 'Redis sorted set', sub: 'in-memory', is: 'an in-memory structure that keeps members ordered by score' },
        { id: 'ts', label: 'TimescaleDB / InfluxDB', sub: 'time-series', is: 'a time-series store with compression, retention and downsampling' },
        { id: 'doc', label: 'MongoDB / Postgres JSONB', sub: 'document', is: 'a document model that stores one aggregate per record with a flexible schema' },
        {
          id: 'es',
          label: 'Elasticsearch as source of truth',
          decoy: true,
          is: 'an inverted index meant to be a derived view fed by CDC, not the store that enforces your invariants',
        },
        {
          id: 'memcached',
          label: 'Memcached',
          sub: 'strings only',
          decoy: true,
          is: 'a pure look-aside cache with no persistence or replication: never a system of record',
        },
      ],
      why: [
        'Start from the top queries, the invariants and the volume, then choose the simplest model that satisfies all three.',
        'Invariants that span rows (money, bookings) keep you on a relational store with ACID.',
        'Wide-column, graph, time-series and Redis each win one access pattern; they lose at ad-hoc queries.',
        'Specialised stores such as search are derived views fed by CDC, not the source of truth.',
      ],
    },
    {
      mode: 'route',
      id: 'catalog-polyglot-routes',
      tab: 'Route to the right store',
      title: 'Product catalog: one source of truth, derived views',
      brief:
        'A marketplace catalog keeps products in Postgres, and Elasticsearch and Redis are derived views fed from it. Steer each request to the store that should serve it, without letting any copy drift or any invariant slip.',
      cols: 5,
      rows: 3.3,
      nodes: [
        { id: 'api', label: 'Catalog API', sub: 'NestJS', kind: 'terminal', col: 0, row: 1.25 },
        { id: 'pg', label: 'Postgres', sub: 'source of truth · JSONB', col: 1.5, row: 0.1 },
        { id: 'cdc', label: 'CDC stream', sub: 'change events from WAL', col: 3, row: 0.1 },
        { id: 'es', label: 'Elastic­search', sub: 'derived search index', col: 4.2, row: 1.25 },
        { id: 'redis', label: 'Redis', sub: 'hot product reads', col: 3, row: 2.4 },
      ],
      edges: [
        ['api', 'pg', 'SQL'],
        ['api', 'es', 'query'],
        ['api', 'redis', 'GET'],
        ['pg', 'cdc'],
        ['cdc', 'es', 'reindex'],
        ['cdc', 'redis', 'invalidate'],
      ],
      packets: [
        {
          id: 'search',
          label: 'Search: "red running shoes"',
          sub: 'full text, ranked by relevance',
          from: 'api',
          paths: [['api', 'es']],
          wrong: {
            'api>pg':
              'Postgres is the source of truth, but relevance-ranked full-text search over the catalog is what an inverted index is built for. Leave Postgres to the writes and invariants.',
            'api>redis':
              'Redis here holds hot products by key. A key-value store answers lookups by key, not queries by anything else, so it cannot rank products for a phrase.',
          },
          done: 'Full-text relevance goes to Elasticsearch: an inverted index derived from the source of truth, not the store that owns the data.',
        },
        {
          id: 'page',
          label: 'Product page #9, the hottest item today',
          sub: 'read by id, many times a second',
          from: 'api',
          paths: [['api', 'redis']],
          wrong: {
            'api>pg':
              'Postgres could answer it, but the catalog design puts hot reads in Redis (or a CDN) so repeated lookups by id do not load the source of truth.',
            'api>es':
              'The search index is for relevance queries. A page that is fetched by id belongs in the in-memory store built for lookups by key.',
          },
          done: 'Lookups by key for hot products go to Redis: an in-memory store with sub-millisecond reads, kept in step by CDC invalidations.',
        },
        {
          id: 'price',
          label: 'Seller edits a price; search must show it',
          sub: 'UPDATE product SET price …',
          from: 'api',
          to: 'es',
          paths: [['api', 'pg', 'cdc', 'es']],
          wrong: {
            'api>es':
              'That is a dual write: the API also writes Elasticsearch itself. A crash or a failed call between the two writes leaves search and Postgres disagreeing, and nothing notices the drift.',
            'api>redis':
              'Writing the new price only into the cache makes a copy the source of truth. It can be evicted, and Postgres and search would still show the old price.',
            'cdc>redis':
              'Invalidating the cached page is right for product pages, but this change has to reach search. Search results are served from the index, which would still hold the old price.',
          },
          right: { 'api>pg': 'The write lands in the store that enforces the constraints. CDC picks it up from the WAL after commit.' },
          done: 'Write once to the source of truth and let CDC feed the derived views. The index cannot drift silently, because every change it sees is one that committed.',
        },
        {
          id: 'reserve',
          label: 'Checkout: reserve the last unit of SKU 9',
          sub: 'stock must never go below zero',
          from: 'api',
          paths: [['api', 'pg']],
          wrong: {
            'api>redis':
              'The cache is a derived copy and may be stale. Deciding on a copy is how you oversell: the check must run where the invariant is enforced.',
            'api>es':
              'Elasticsearch is a derived view fed by CDC, seconds behind and without transactions. It cannot enforce stock ≥ 0.',
          },
          done: 'A conditional UPDATE … SET stock = stock − 1 WHERE stock >= 1 on Postgres checks and reserves in one atomic statement, so the last unit is sold once.',
        },
      ],
      why: [
        'Keep the source of truth in a store that enforces your invariants (Postgres), and treat search and caches as derived views.',
        'Feed derived views with CDC instead of dual writes, so they cannot drift silently after a partial failure.',
        'Route by access pattern: relevance search → inverted index, hot lookups by key → Redis, invariants → the relational source.',
        'Never decide on a derived copy (stock, balance): read it for display, decide on the source of truth.',
      ],
    },
    {
      mode: 'sequence',
      id: 'transfer-tx-ladder',
      tab: 'All-or-nothing transfer',
      title: 'Wallet transfer: both rows change or neither does',
      brief:
        'Move ₹500 from Asha to Ravi in one Postgres transaction. Two transfers from the same wallet may arrive at once, and the process may crash at any moment. Order the messages so money is never lost, duplicated or overdrawn.',
      layout: 'ladder',
      actors: [
        { id: 'app', label: 'Wallet service', sub: 'node-postgres withTx' },
        { id: 'db', label: 'PostgreSQL', sub: 'primary' },
      ],
      steps: [
        {
          id: 'begin',
          label: 'BEGIN',
          sub: 'pooled client',
          from: 'app',
          to: 'db',
          clue: 'Open the unit of work',
          is: 'the start of a transaction: every statement until COMMIT or ROLLBACK succeeds or fails together',
        },
        {
          id: 'debit',
          label: 'Debit only if balance ≥ 500',
          sub: 'WHERE balance >= $1',
          from: 'app',
          to: 'db',
          clue: 'Check and change in one statement',
          is: 'a conditional atomic UPDATE: the row lock serialises concurrent transfers, so two of them cannot both spend the same money',
        },
        {
          id: 'one',
          label: 'UPDATE 1 (rowCount = 1)',
          sub: 'funds were there',
          from: 'db',
          to: 'app',
          clue: 'Proof the money existed',
          is: 'the row count that tells the app the debit happened; 0 would mean insufficient funds and a ROLLBACK',
        },
        {
          id: 'credit',
          label: 'Credit Ravi: balance + 500',
          sub: 'UPDATE … SET balance + $1',
          from: 'app',
          to: 'db',
          clue: 'The other half of the move',
          is: 'the second row of the transfer, inside the same transaction so it cannot happen without the debit',
        },
        {
          id: 'commit',
          label: 'COMMIT',
          from: 'app',
          to: 'db',
          clue: 'Make both changes final',
          is: 'the point where both updates become visible to others at once and are made durable',
        },
        {
          id: 'durable',
          label: 'WAL fsynced → COMMIT ok',
          sub: 'group commit, ~0.1–1 ms',
          from: 'db',
          to: 'app',
          clue: 'Now it survives a crash',
          is: 'the durability promise: the commit record is flushed to the write-ahead log before success is reported',
        },
      ],
      decoys: [
        {
          id: 'readcheck',
          label: 'SELECT balance, check in the app',
          sub: 'then SET balance = new',
          is: 'a read-modify-write race: two concurrent transfers both read enough money and both write, so one update is lost and the wallet is overdrawn',
        },
        {
          id: 'earlycommit',
          label: 'COMMIT right after the debit',
          sub: 'then credit separately',
          is: 'two transactions instead of one: a crash between them leaves ₹500 debited and never credited, which is exactly what atomicity prevents',
        },
        {
          id: 'earlyok',
          label: 'Reply "sent" before COMMIT',
          sub: 'faster response',
          is: 'a broken promise: if the commit then fails or the server crashes before the WAL flush, the user was told success for a transfer that never happened',
        },
      ],
      why: [
        'Atomicity is about aborts: a crash or error between the two updates rolls both back (undo via the WAL).',
        'Put the check inside the write (UPDATE … WHERE balance >= $1): the cheapest correct defence against lost updates and overdrafts.',
        'Durability: COMMIT returns only after the WAL is fsynced; group commit batches many transactions per fsync.',
        'Always ROLLBACK on error and release the client in finally, or failures leak connections from the pool.',
      ],
    },
    {
      mode: 'fault',
      id: 'iot-cassandra-partitions',
      tab: 'IoT table on fire',
      title: 'IoT dashboard: Cassandra queries time out',
      brief:
        'An IoT platform stores readings from 2M devices, one every 10 s. The dashboard times out, nodes report multi-GB partitions, and reads log tombstone warnings every morning. Find the three design mistakes and swap in the fix.',
      cols: 4.6,
      rows: 3.2,
      nodes: [
        { id: 'dev', label: '2M devices', sub: '1 reading / 10 s', kind: 'terminal', col: 0, row: 0.1 },
        {
          id: 'ingest',
          label: 'Ingest service',
          sub: '200K readings/s',
          col: 1.25,
          row: 0.1,
          fine: 'Ingest just writes what arrives: 200K readings/s (400K writes/s with two tables) is well within a modest Cassandra cluster.',
        },
        {
          id: 'table',
          label: 'Partition key: customer_id',
          sub: 'PK (customer, device, ts)',
          col: 2.5,
          row: 0.1,
          fault: {
            answer: 'bucket',
            clue: 'Bound each partition by time',
            why: 'The partition key is customer_id alone, so a customer with 50K devices puts 50K × 8,640 = 432M rows a day into one partition: huge partitions, hot nodes and timeouts.',
          },
        },
        {
          id: 'cleanup',
          label: 'Nightly DELETE job',
          sub: 'rows older than 30 days',
          col: 3.75,
          row: 0.1,
          fault: {
            answer: 'ttl',
            clue: 'Expire data as it is written',
            why: 'Explicit DELETEs write millions of tombstones, which every read must skip until compaction: warnings first, then failed reads at 100K tombstones by default.',
          },
        },
        { id: 'dash', label: 'Dashboard', sub: 'latest per device', kind: 'terminal', col: 0, row: 2.1 },
        {
          id: 'latest',
          label: 'Latest per device: GROUP BY',
          sub: 'max(ts) over the partition',
          col: 1.25,
          row: 2.1,
          fault: {
            answer: 'latest',
            clue: 'One small row per device',
            why: '"Latest reading per device" aggregates across the whole customer partition, so Cassandra reads every reading of that customer to answer one dashboard tile. That query needs its own table.',
          },
        },
        {
          id: 'cluster',
          label: 'Cassandra cluster',
          sub: '~10K+ writes/s per node',
          col: 2.5,
          row: 2.1,
          fine: 'Cassandra writes are cheap (commit log + memtable) and clusters scale linearly. The nodes are healthy; the data model is making them read too much.',
        },
      ],
      edges: [
        ['dev', 'ingest'],
        ['ingest', 'table', 'INSERT'],
        ['cleanup', 'table', 'DELETE'],
        ['dash', 'latest'],
        ['latest', 'cluster', 'SELECT'],
        ['table', 'cluster', 'stored on'],
      ],
      options: [
        {
          id: 'bucket',
          label: 'PK ((device_id, day), ts)',
          sub: '~430 KB per partition',
          is: 'a time-bucketed partition key: 8,640 rows a day per device, read as one pre-sorted partition',
        },
        {
          id: 'latest',
          label: 'latest_\u200Bby_\u200Bcustomer table',
          sub: 'one row per device, upsert',
          is: 'a second table shaped for the second query: one row per device, overwritten on every reading, so "latest" is a single bounded read',
        },
        {
          id: 'ttl',
          label: 'TTL 30 days + TWCS',
          sub: 'expire at write time',
          is: 'expiry set at write time, with TimeWindowCompactionStrategy dropping whole expired SSTables instead of compacting tombstones row by row',
        },
        {
          id: 'deviceonly',
          label: 'PK (device_id, ts)',
          sub: 'partition = device',
          decoy: true,
          is: 'better than per customer but still unbounded: 30 days of readings is ~259K rows in one partition, past the ~100K-row guideline',
        },
        {
          id: 'filtering',
          label: 'Add ALLOW FILTERING',
          sub: 'query by any column',
          decoy: true,
          is: 'a cluster-wide scan dressed up as a query, the classic Cassandra red flag: it makes the timeouts worse, not better',
        },
      ],
      metrics: [
        { label: 'Rows/partition/day', bad: 432000000, good: 8640, fixedBy: ['table'] },
        { label: 'Rows read for latest', bad: 432000000, good: 50000, fixedBy: ['latest'] },
        { label: 'Tombstones per read', bad: 100000, good: 0, fixedBy: ['cleanup'] },
      ],
      why: [
        'In Cassandra you design one table per query; the partition key must appear in every query and decides data placement.',
        'Bucket by time ((device_id, day)) to keep partitions bounded: under ~100 MB and ~100K rows.',
        'Pre-join at write time: a second, upsert-only table answers "latest per device" in one bounded read.',
        'Expire with TTL and TWCS, not DELETE jobs: tombstones make every read slower until compaction.',
      ],
    },
    {
      mode: 'tune',
      id: 'isolation-lab',
      tab: 'Isolation lab',
      title: 'Two bugs, one Postgres: pick isolation per transaction',
      brief:
        'A hospital app has a viral "like" button on a hot post row and a leave request that must keep at least one doctor on call. Likes run at the default level; the leave check runs at REPEATABLE READ "to be safe". Likes go missing, and two doctors just left the same shift in the same second.',
      cols: 3,
      rows: 3,
      nodes: [
        { id: 'like', label: 'Like button', sub: 'viral post, one row', kind: 'terminal', col: 0, row: 0.2 },
        { id: 'leave', label: 'Leave request', sub: 'shift 7 · 2 on call', kind: 'terminal', col: 0, row: 1.8 },
        { id: 'ltx', label: 'Like transaction', sub: 'posts.likes', col: 1, row: 0.2 },
        { id: 'vtx', label: 'Leave transaction', sub: 'count on-call, update me', col: 1, row: 1.8 },
        { id: 'pg', label: 'PostgreSQL', sub: 'MVCC', col: 2.2, row: 1 },
      ],
      edges: [
        ['like', 'ltx'],
        ['leave', 'vtx'],
        ['ltx', 'pg'],
        ['vtx', 'pg'],
      ],
      knobs: [
        { id: 'likeIso', label: 'Like tx isolation', kind: 'choice', initial: 1, choices: ISO, help: 'level for the hot counter' },
        {
          id: 'likeStyle',
          label: 'Like update style',
          kind: 'choice',
          initial: 1,
          choices: [
            { value: 1, label: 'Load, +1, save' },
            { value: 2, label: 'SET likes = likes + 1' },
          ],
          help: 'ORM read-modify-write or one atomic UPDATE',
        },
        { id: 'leaveIso', label: 'Leave tx isolation', kind: 'choice', initial: 2, choices: ISO, help: 'level for the on-call check' },
        { id: 'retry', label: 'Retry on 40001', kind: 'toggle', initial: 0, help: 'rerun the whole transaction on a serialization failure' },
      ],
      constraints: [
        {
          id: 'lost',
          label: 'Two likes count as two',
          left: {
            op: 'if',
            cond: { all: [{ left: likeIso, op: '==', right: 1 }, { left: likeStyle, op: '==', right: 1 }] },
            then: 1,
            else: 2,
          },
          op: '==',
          right: 2,
          unit: ' likes',
          hint: 'Both requests read 10, then both write 11. Which update style never reads the value into the app first?',
          fail: 'Load-modify-save at Read Committed is a lost update: both transactions read 10 and both write 11.',
          pass: 'The increment cannot be lost: either the database does the +1 atomically, or it aborts one of the racing writers.',
        },
        {
          id: 'hot',
          label: 'Hot row: no abort storm',
          display: { pass: 'no aborts', fail: '40001 abort storm' },
          left: { op: 'if', cond: { left: likeIso, op: '>=', right: 2 }, then: 1, else: 0 },
          op: '==',
          right: 0,
          hint: 'At snapshot levels, what does Postgres do when two transactions update the same row at once?',
          fail: 'At Repeatable Read or Serializable, one of two concurrent writers to the same row aborts with 40001, so a viral post turns into a retry loop.',
          pass: 'At Read Committed an atomic UPDATE simply waits for the row lock and applies on the latest value: no aborts on the hot row.',
        },
        {
          id: 'skew',
          label: 'Doctors on call after 2 leave',
          left: { op: 'if', cond: { left: leaveIso, op: '==', right: 3 }, then: 1, else: 0 },
          op: '>=',
          right: 1,
          unit: ' on call',
          hint: 'Both transactions read "2 on call" and update different rows. Which level detects that pattern?',
          fail: 'Write skew: both read the same snapshot, write different rows and commit. Snapshot isolation (Repeatable Read) does not catch it.',
          pass: 'Serializable (SSI) sees the read/write dependency cycle and aborts one transaction, so one doctor stays on call.',
        },
        {
          id: 'errors',
          label: 'No 40001 reaches the user',
          display: { pass: 'none reach users', fail: '40001 reaches users' },
          left: {
            op: 'if',
            cond: {
              all: [
                { left: retry, op: '==', right: 0 },
                { any: [{ left: leaveIso, op: '==', right: 3 }, { left: likeIso, op: '>=', right: 2 }] },
              ],
            },
            then: 1,
            else: 0,
          },
          op: '==',
          right: 0,
          unit: ' errors',
          hint: 'Stronger isolation turns races into serialization failures. Who handles them?',
          fail: 'A transaction that can abort with SQLSTATE 40001 runs without a retry loop, so users see an error instead of a result.',
          pass: 'Serialization failures are retried as whole transactions, so an abort is invisible to the user.',
        },
      ],
      why: [
        'Fix counters with one atomic UPDATE at Read Committed: the cheapest correct defence against lost updates.',
        'Repeatable Read is snapshot isolation: it stops lost updates by aborting, but still allows write skew.',
        'Only SERIALIZABLE (or locking the rows the decision depends on) prevents write skew, and it requires retries on 40001.',
        'Isolation is set per transaction: choose it by the anomaly each one must prevent, not one level for everything.',
      ],
    },
  ],
};

export default set;
