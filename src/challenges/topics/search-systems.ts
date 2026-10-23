import type { ChallengeSet } from '../types';

const set: ChallengeSet = {
  topic: 'search-systems',
  puzzles: [
    {
      mode: 'fault',
      id: 'indexer-drift',
      tab: 'Drifting index',
      title: 'Search shows yesterday\'s prices',
      brief:
        'Products edited twice in quick succession show the older price in search, some edits never arrive after an Elasticsearch hiccup, and the nightly 2M-row price import crawls for hours. The CDC pipeline is in place; find the three bad settings and swap in the fix.',
      cols: 5.4,
      rows: 3,
      nodes: [
        {
          id: 'cdc',
          label: 'Postgres + Debezium',
          sub: 'WAL, commit order',
          col: 0,
          row: 1,
          fine: 'Postgres holds the right prices and CDC captures every committed change in commit order. That order is lost later, not here.',
        },
        {
          id: 'topic',
          label: 'products topic',
          sub: 'key: round-robin',
          col: 1.1,
          row: 1,
          fault: {
            answer: 'key',
            clue: 'Keep one product\'s changes in order',
            why: 'Round-robin spreads two edits of the same product over different partitions, so consumers can apply them in the opposite order and the older price wins.',
          },
        },
        {
          id: 'indexer',
          label: 'Indexer',
          sub: 'commit offset, then bulk',
          col: 2.2,
          row: 1,
          fault: {
            answer: 'after',
            clue: 'Only acknowledge what was written',
            why: 'Offsets are committed before the bulk request, so when Elasticsearch rejects a batch (429) those events are already marked done and never indexed.',
          },
        },
        {
          id: 'es',
          label: 'products alias',
          sub: 'refresh=true per doc',
          col: 3.3,
          row: 0,
          fault: {
            answer: 'refresh',
            clue: 'Make documents searchable in batches',
            why: 'Forcing a refresh on every write creates a tiny segment per document: a merge storm that cuts indexing throughput by an order of magnitude.',
          },
        },
        {
          id: 'dlq',
          label: 'Dead-letter topic',
          sub: 'mapping errors (400)',
          col: 3.3,
          row: 2,
          fine: 'Sending 400 mapping errors to a DLQ is correct: they will never succeed on retry.',
        },
        { id: 'users', label: 'Shoppers', sub: 'GET /search', kind: 'terminal', col: 4.4, row: 0 },
      ],
      edges: [
        ['cdc', 'topic'],
        ['topic', 'indexer'],
        ['indexer', 'es', 'bulk'],
        ['indexer', 'dlq', '400s'],
        ['es', 'users'],
      ],
      options: [
        {
          id: 'key',
          label: 'Key = product id',
          sub: 'one partition per product',
          is: 'routing every change of a product to the same partition, so they are consumed in commit order',
        },
        {
          id: 'after',
          label: 'Commit offsets after bulk',
          sub: 'retry 429s · versioned',
          is: 'at-least-once delivery with retries plus version_type external, so replays and duplicates converge on the newest version',
        },
        {
          id: 'refresh',
          label: 'Default 1 s refresh',
          sub: 'wait_for only if needed',
          is: 'letting Elasticsearch make new documents searchable about once a second instead of once per write',
        },
        {
          id: 'dual',
          label: 'Dual-write from the service',
          sub: 'save(), then es.index()',
          decoy: true,
          is: 'two non-atomic writes: a crash between them drifts forever, and concurrent requests can reach the index out of order',
        },
        {
          id: 'nodes',
          label: 'Add data nodes',
          sub: 'bigger cluster',
          decoy: true,
          is: 'more hardware for a problem of ordering and acknowledgement; the refresh storm and lost batches remain',
        },
      ],
      metrics: [
        { label: 'Stale docs in index', bad: 4100, good: 0, fixedBy: ['topic', 'indexer'] },
        { label: 'Index lag p99', bad: 600, good: 3, unit: ' s' },
        { label: 'Nightly import', bad: 360, good: 25, unit: ' min', fixedBy: ['es'] },
      ],
      why: [
        'Kafka keyed by entity id keeps each product\'s changes in one partition, in order.',
        'Commit offsets only after the bulk succeeds; with external versions, at-least-once plus idempotent writes is effectively once.',
        'Never refresh per request: indexed is not searchable until the next refresh, typically 1 s, which is fine for search.',
        'Add a nightly reconciliation job: drift will still happen, and comparing DB and index versions catches it.',
      ],
    },
    {
      mode: 'sequence',
      id: 'alias-reindex',
      tab: 'Zero-downtime reindex',
      title: 'New analyzer, no downtime: reindex behind an alias',
      brief:
        'Searching "iphones" misses "iPhone" because of the analyzer, and fixing it needs a new index. Shoppers search 24/7 and edits keep flowing through CDC. Put the reindex steps in order.',
      layout: 'stages',
      steps: [
        {
          id: 'create',
          label: 'Create products_v4',
          sub: 'refresh −1, 0 replicas',
          clue: 'New mappings, tuned for bulk',
          is: 'a new index with the fixed analyzer, refresh off and no replicas so the backfill runs fast',
        },
        {
          id: 'offset',
          label: 'Record the CDC offset',
          sub: 'before the backfill',
          clue: 'Bookmark the change stream',
          is: 'noting where the change stream is now, so edits made during the backfill can be replayed later',
        },
        {
          id: 'backfill',
          label: 'Backfill v4',
          sub: '_reindex or DB export',
          clue: 'Copy what exists today',
          is: 'loading every document into v4 from v3\'s _source or from a database export',
        },
        {
          id: 'replay',
          label: 'Replay CDC into v4',
          sub: 'v3 keeps serving',
          clue: 'Catch up on recent edits',
          is: 'replaying changes from the bookmark; external versions make the overlap with the backfill harmless',
        },
        {
          id: 'validate',
          label: 'Restore replicas, validate',
          sub: 'counts, NDCG, shadow',
          clue: 'Prove it before users see it',
          is: 'turning replicas and refresh back on, then comparing doc counts, judged queries and shadow traffic',
        },
        {
          id: 'swap',
          label: 'Atomic alias swap',
          sub: 'remove v3 + add v4',
          clue: 'Readers move in one call',
          is: 'a single _aliases call that points products at v4; rolling back is the same call in reverse',
        },
        {
          id: 'drop',
          label: 'Delete v3 days later',
          sub: 'rollback window',
          clue: 'Keep the way back a while',
          is: 'removing the old index only after a few days without needing to swap back',
        },
      ],
      decoys: [
        {
          id: 'inplace',
          label: 'Change the analyzer on v3',
          sub: 'PUT _settings',
          is: 'not possible for existing fields: changing an analyzer or field type is exactly what forces a reindex',
        },
        {
          id: 'clients',
          label: 'Redeploy clients to use v4',
          sub: 'new index name',
          is: 'a slow, non-atomic cut-over that is hard to roll back; clients should only ever know the alias',
        },
      ],
      why: [
        'Clients always talk to the alias, so the cut-over is one atomic _aliases call and rollback is the same call reversed.',
        'Record the CDC offset before the backfill and replay from it, so no edit made during the copy is lost.',
        'Build with refresh off and zero replicas, then restore both and validate before the swap.',
        'Keep the old index for a few days as the rollback path.',
      ],
    },
    {
      mode: 'flow',
      id: 'autocomplete-keystroke-path',
      tab: 'Autocomplete path',
      title: 'Query suggestions under 50 ms per keystroke',
      brief:
        'A shop wants Google-style query suggestions as people type: a keystroke every ~100–150 ms, p99 well under 50 ms end to end, and never an offensive or dead-end suggestion. Place the pieces on the serving and the offline path.',
      cols: 5,
      rows: 3.1,
      nodes: [
        { id: 'user', label: 'Shopper typing', sub: '“wirel…”', kind: 'terminal', col: 0, row: 0.2 },
        { id: 'client', answer: 'debounce', hint: 'Waits for a pause, drops stale calls', col: 1, row: 0.2 },
        { id: 'edge', answer: 'cdn', hint: 'Answers popular prefixes nearby', col: 2, row: 0.2 },
        { id: 'svc', label: 'Suggest service', sub: 'GET /suggest', col: 3, row: 0.2 },
        { id: 'store', answer: 'trie', hint: 'O(prefix) lookup, best k stored', col: 4, row: 0.2 },
        { id: 'log', label: 'Query log', sub: 'every search typed', kind: 'terminal', col: 1, row: 2.1 },
        { id: 'build', answer: 'agg', hint: 'Hourly: count what people search', col: 2.3, row: 2.1 },
        { id: 'clean', answer: 'filter', hint: 'Keeps only safe, useful queries', col: 3.6, row: 2.1 },
      ],
      edges: [
        ['user', 'client'],
        ['client', 'edge'],
        ['edge', 'svc', 'miss'],
        ['svc', 'store'],
        ['log', 'build'],
        ['build', 'clean'],
        ['clean', 'store', 'rebuild'],
      ],
      options: [
        { id: 'debounce', label: 'Debounce ~100 ms + cancel', sub: 'in the browser', is: 'a client-side pause that sends one request per burst of keystrokes and aborts responses that are already stale' },
        { id: 'cdn', label: 'CDN prefix cache', sub: 'short TTL', is: 'an edge cache of prefix responses, so the most common prefixes never reach the service' },
        { id: 'trie', label: 'Top-k trie', sub: 'in memory / Redis', is: 'a prefix tree that caches the k best completions at every node, so a lookup needs no subtree walk' },
        { id: 'agg', label: 'Offline aggregation job', sub: 'query → frequency', is: 'a batch job that turns the raw query log into query frequencies for the next trie build' },
        { id: 'filter', label: 'Blocklist + has-results', sub: 'before publishing', is: 'a filter that drops offensive or PII queries and queries that return no results' },
        {
          id: 'ilike',
          label: 'Postgres ILIKE \'wirel%\'',
          sub: 'on the primary',
          decoy: true,
          is: 'a database prefix match per keystroke: no ranking by popularity, and at high QPS the OLTP primary takes the whole autocomplete load',
        },
        {
          id: 'subtree',
          label: 'Walk the subtree per call',
          sub: 'sort all completions',
          decoy: true,
          is: 'collecting and sorting every completion under the prefix on each request, which is exactly the work the precomputed top-k list avoids',
        },
      ],
      why: [
        'Autocomplete is a prefix problem with a brutal budget: debounce and cancel stale requests on the client first.',
        'A top-k trie stores the best completions at every node, so serving is O(prefix length), from memory or Redis, with short-TTL edge caching.',
        'The trie is built offline (hourly or daily) from the aggregated query log; trending queries come from a small real-time layer.',
        'Filter suggestions: block offensive or PII queries and only suggest queries that return results.',
      ],
    },
    {
      mode: 'route',
      id: 'search-request-routing',
      tab: 'Route the requests',
      title: 'Search platform: send each request to the right place',
      brief:
        'Postgres is the system of record and Elasticsearch is a derived read model fed by CDC, about 1–5 s behind. Steer each request so it reads correct data and never makes the cluster do deep-paging work it can’t afford.',
      cols: 4,
      rows: 3.4,
      nodes: [
        { id: 'api', label: 'Catalog API', sub: 'NestJS', kind: 'terminal', col: 0, row: 1.35 },
        { id: 'pg', label: 'Postgres primary', sub: 'system of record', col: 1.5, row: 0.15 },
        { id: 'job', label: 'Async export worker', sub: 'queued job · emails link', col: 1.5, row: 2.6 },
        { id: 'coord', label: 'ES coordinating node', sub: 'alias: products', col: 1.5, row: 1.35 },
        { id: 'agg', label: 'Terms aggregation', sub: 'brand · doc values', col: 3, row: 0.15 },
        { id: 'fromsize', label: 'from + size', sub: 'max_result_\u200Bwindow 10,000', col: 3, row: 1.35 },
        { id: 'after', label: 'search_\u200Bafter + PIT', sub: 'cursor = last sort values', col: 3, row: 2.6 },
      ],
      edges: [
        ['api', 'pg'],
        ['api', 'coord'],
        ['api', 'job'],
        ['job', 'coord'],
        ['coord', 'agg'],
        ['coord', 'fromsize'],
        ['coord', 'after'],
      ],
      packets: [
        {
          id: 'charge',
          label: 'Checkout: price of SKU 991 to charge',
          sub: 'price edited 2 s ago',
          from: 'api',
          paths: [['api', 'pg']],
          wrong: {
            'api>coord':
              'The index is an eventually consistent copy, typically 1–5 s behind (CDC + Kafka + batch + refresh). Charging from it could use the price from before the edit.',
            'api>job':
              'A single price lookup is a synchronous key read, not a bulk export. The customer is waiting at checkout.',
          },
          done: 'Money decisions read the system of record. Postgres has the committed price; the search index only needs to catch up for browsing.',
        },
        {
          id: 'facets',
          label: 'Sidebar: brand counts for “headphones”',
          sub: 'on every results page',
          from: 'api',
          paths: [['api', 'coord', 'agg']],
          wrong: {
            'api>pg':
              'Facets on every query turn into expensive GROUP BYs on the OLTP primary, competing with checkout writes.',
            'api>job':
              'Facet counts are part of the live results page, not a background export.',
            'coord>fromsize':
              'Paging through hits does not count brands. Counting by fetching documents would be slow and still wrong past the first page.',
            'coord>after':
              'A cursor walks hits in order; it does not aggregate them. Brand counts come from an aggregation.',
          },
          done: 'A terms aggregation on the keyword brand field reads columnar doc values, so facets are fast and stay off the database.',
        },
        {
          id: 'deep',
          label: 'Infinite scroll: next 20 after hit 12,000',
          sub: 'previous page’s last sort values',
          from: 'api',
          paths: [['api', 'coord', 'after']],
          wrong: {
            'api>pg':
              'Postgres has no relevance ranking for these results, so the order would not match the list the shopper is scrolling.',
            'api>job':
              'Scrolling is interactive: the next 20 hits are needed now, not in an emailed file.',
            'coord>fromsize':
              'from 12,000 is past max_result_window (10,000), and even below it every shard must return its top from + size hits, so cost grows with depth × shards.',
            'coord>agg':
              'An aggregation returns counts, not the next page of hits.',
          },
          done: 'search_after with the last hit’s sort values (and a unique tiebreaker) makes each shard return only size hits: constant cost per page, and PIT keeps the view consistent.',
        },
        {
          id: 'export',
          label: 'Partner wants all 3M products as CSV',
          sub: 'one tenant · whole catalog',
          from: 'api',
          paths: [['api', 'job', 'coord', 'after']],
          wrong: {
            'api>pg':
              'The partner wants exactly what search shows (denormalised documents). Streaming 3M rows from the OLTP primary inside a request would also tie up a connection for minutes.',
            'api>coord':
              'Paging 3M documents inside one HTTP request ties up the API for minutes and times out. Bulk exports belong in an async job.',
            'coord>fromsize':
              'from + size stops at 10,000 hits and gets more expensive with every page. It cannot export 3M documents.',
            'coord>agg':
              'An aggregation summarises documents; the partner needs the documents themselves.',
          },
          done: 'The export runs as an async job that walks the index with search_after + PIT (sliced if needed), keeps keep_alive short, and closes the PIT at the end.',
        },
      ],
      why: [
        'The search index is a derived, eventually consistent read model: anything that charges, debits or validates reads the database.',
        'Facets are aggregations over doc values in the search cluster, not GROUP BYs on the OLTP primary.',
        'from + size costs shards × (from + size) and is capped at 10,000; deep pages use search_after + PIT.',
        'Cap UI depth and move bulk exports to an asynchronous job.',
      ],
    },
    {
      mode: 'spike',
      id: 'sale-search-spike',
      tab: 'Survive the spike',
      title: 'Sale day: search traffic ×5 during a price import',
      brief:
        'At 10:00 the nightly 2M-row price import runs late, and the sale starts at the same time: search climbs from 3K to 15K queries/s (scenario numbers). You can make three changes. Keep search p99 ≤ 200 ms, errors ≤ 1% and the indexer from being rejected.',
      cols: 4,
      rows: 2.1,
      nodes: [
        { id: 'users', label: 'Shoppers', sub: 'search + facets', kind: 'terminal', col: 0, row: 0.5 },
        { id: 'coord', label: 'Coordinating node', sub: 'scatter → merge', col: 1.3, row: 0.5, share: 1, ms: 5 },
        { id: 'data', label: 'Data nodes × 3', sub: 'P + R per shard', col: 2.9, row: 0, share: 1, capacity: 6000, unit: 'q/s', ms: 20, timeoutMs: 2000 },
        { id: 'write', label: 'Write thread pool', sub: 'CDC updates 1K docs/s', col: 2.9, row: 1.15, capacity: 3000, unit: 'docs/s', base: 1000 },
      ],
      edges: [
        ['users', 'coord'],
        ['coord', 'data', 'query'],
        ['write', 'data', 'index'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 3000],
        [10, 3000],
        [40, 15000],
        [60, 15000],
      ],
      bursts: [{ node: 'write', from: 4, to: 14, add: 8000, label: 'price import' }],
      maxCards: 3,
      cards: [
        {
          id: 'bulk',
          label: 'Bulk + refresh 30 s',
          sub: '1–5K docs per _bulk',
          node: 'write',
          effects: [{ node: 'write', capacity: 5 }],
          is: 'batched indexing with a longer refresh_interval during the import, so far fewer requests and segment refreshes per document',
        },
        {
          id: 'replica',
          label: 'Add a replica',
          sub: 'number_of_replicas 1 → 2',
          node: 'data',
          effects: [{ node: 'data', capacity: 2 }],
          is: 'another copy of every shard on new nodes: replicas add read throughput and can be changed at any time',
        },
        {
          id: 'filter',
          label: 'Tenant + status as filters',
          sub: 'bool.filter, cached',
          node: 'coord',
          effects: [{ node: 'data', load: 0.6 }],
          is: 'moving exact conditions into filter context, which skips scoring and caches the bitset per segment, so each query does less work',
        },
        {
          id: 'heap',
          label: 'Heap 31 → 64 GB',
          sub: 'more JVM memory',
          node: 'data',
          decoy: true,
          effects: [{ node: 'data', capacity: 0.8 }],
          is: 'a heap above ~31 GB, which loses compressed object pointers and eats the page cache that actually makes search fast',
        },
        {
          id: 'window',
          label: 'max_result_window 100K',
          sub: 'allow deeper pages',
          node: 'coord',
          decoy: true,
          effects: [{ node: 'data', load: 1.3 }],
          is: 'a memory and CPU foot-gun: it lets bots page deeper, and every shard must return from + size hits for each of those pages',
        },
      ],
      goals: [
        { metric: 'p99', max: 200, label: 'Search p99 ≤ 200 ms', fail: 'Queries queue on saturated data nodes, so the slowest 1% wait for the timeout.' },
        { metric: 'errors', max: 1, label: 'Errors ≤ 1%', fail: 'A thread pool is past capacity and rejects requests with 429s.' },
        { metric: 'util:write', max: 100, label: 'Indexer not rejected', fail: 'Bulk requests are rejected, so price updates pile up and search shows old prices.' },
      ],
      why: [
        'Indexing throughput comes from the bulk API (1–5K docs per request) and a longer refresh_interval during big imports, not refresh=true per document.',
        'Replicas add read throughput and availability and can be added at any time; primaries parallelise writes and size and are fixed at creation.',
        'Filter context skips scoring and caches bitsets, so moving exact conditions out of must makes every query cheaper.',
        'Keep heap ≤ 50% of RAM and under ~31 GB: the OS page cache does the real work.',
      ],
    },
  ],
};

export default set;
