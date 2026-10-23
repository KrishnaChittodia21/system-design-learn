import type { ChallengeSet } from '../types';

const set: ChallengeSet = {
  topic: 'design-classics',
  puzzles: [
    {
      mode: 'flow',
      id: 'shortener-redirect',
      tab: 'URL shortener',
      title: 'URL shortener: the redirect path',
      brief:
        'A click on sho.rt/aZ3k must reach the long URL in a few milliseconds, survive a hot link going viral, and still count the click.',
      cols: 5,
      rows: 3.6,
      nodes: [
        { id: 'user', label: 'Browser', sub: 'GET /aZ3k', kind: 'terminal', col: 0, row: 1 },
        { id: 'edge', answer: 'cdn', hint: 'Answers repeat clicks near the user', col: 1, row: 1 },
        { id: 'lb', answer: 'lb', hint: 'Spreads requests over app servers', col: 2, row: 1 },
        { id: 'app', label: 'Redirect service', sub: 'stateless', col: 3, row: 1 },
        { id: 'cache', answer: 'redis', hint: 'code → URL in ~1 ms', col: 4, row: 0 },
        { id: 'db', answer: 'kv', hint: 'Source of truth on a miss', col: 4, row: 2 },
        { id: 'events', answer: 'kafka', hint: 'Counts the click off the hot path', col: 3, row: 2.6 },
      ],
      edges: [
        ['user', 'edge'],
        ['edge', 'lb', 'miss'],
        ['lb', 'app'],
        ['app', 'cache', '1 · lookup'],
        ['app', 'db', '2 · on miss'],
        ['app', 'events', 'async'],
      ],
      options: [
        { id: 'cdn', label: 'CDN edge', sub: 'caches 301/302', is: 'an edge cache that serves repeat requests close to the user' },
        { id: 'lb', label: 'Load balancer', sub: 'L7, health checks', is: 'the traffic spreader in front of a pool of servers' },
        { id: 'redis', label: 'Redis cache', sub: 'in-memory', is: 'an in-memory key–value cache with sub-millisecond reads' },
        { id: 'kv', label: 'DynamoDB / Cassandra', sub: 'code → long URL', is: 'a durable, horizontally scalable key–value store' },
        { id: 'kafka', label: 'Kafka topic', sub: 'click events', is: 'a durable log for asynchronous events' },
        {
          id: 's3',
          label: 'Object storage (S3)',
          sub: 'blobs',
          decoy: true,
          is: 'blob storage for files and media, too slow and coarse for per-click lookups',
        },
        { id: 'cron', label: 'Nightly cron job', sub: 'batch', decoy: true, is: 'a batch job; nothing on a live request path should wait for it' },
      ],
      why: [
        'CDN edges absorb viral links: repeat clicks never reach your servers (use 302 if you need every click counted).',
        'The load balancer lets the stateless redirect service scale out and drains unhealthy instances.',
        'Read path: Redis first, the key–value store only on a cache miss, then cache the answer.',
        'The click event goes to Kafka asynchronously, so analytics can never slow down a redirect.',
      ],
    },
    {
      mode: 'sequence',
      id: 'kv-lsm-read-path',
      tab: 'KV store read path',
      title: 'KV store: one get(cart:42) through the LSM engine',
      brief:
        'A Dynamo-style cart store keeps each node’s data in an LSM tree: a memtable plus a stack of immutable SSTables on disk. Put the steps of a single get(cart:42) on one replica in order, so the read stays fast and never returns a value that was deleted.',
      layout: 'stages',
      steps: [
        {
          id: 'memtable',
          label: 'Check the memtable',
          sub: 'in-memory skip list',
          clue: 'Newest writes, not yet flushed',
          is: 'the first stop: the in-memory sorted structure holds the most recent writes that have not been flushed to an SSTable yet',
        },
        {
          id: 'bloom',
          label: 'Ask each Bloom filter',
          sub: 'SSTables newest → oldest',
          clue: 'Skip files that surely lack the key',
          is: 'a per-SSTable probabilistic check (1% false positives at about 9.6 bits per key): “no” skips that file, “maybe” makes it a candidate',
        },
        {
          id: 'index',
          label: 'Jump via the sparse index',
          sub: 'summary → block offset',
          clue: 'Find the right spot in a candidate',
          is: 'the per-SSTable index summary that points at the one block that could hold the key, so the read never scans the file',
        },
        {
          id: 'block',
          label: 'Read the data block',
          sub: 'page cache / block cache',
          clue: 'Fetch the bytes, often from memory',
          is: 'the actual read of the block, usually served from the OS page cache or the block cache',
        },
        {
          id: 'merge',
          label: 'Merge versions by timestamp',
          sub: 'newest wins, tombstones',
          clue: 'Decide which version is the answer',
          is: 'combining the versions found in the memtable and SSTables: the newest timestamp wins, and a tombstone hides the older value so a deleted key reads as not found',
        },
      ],
      decoys: [
        {
          id: 'commitlog',
          label: 'Scan the commit log',
          sub: 'replay the WAL to find k',
          is: 'the crash-recovery log: everything in it is already in the memtable, so reads never scan it',
        },
        {
          id: 'compact',
          label: 'Compact SSTables first',
          sub: 'merge files first',
          is: 'background maintenance on its own schedule; a read never waits for it, it simply merges whatever files exist',
        },
        {
          id: 'btree',
          label: 'Descend the B-tree pages',
          sub: 'root → leaf, in place',
          is: 'how Postgres or InnoDB read: an LSM engine has no in-place B-tree, only immutable sorted SSTables',
        },
      ],
      why: [
        'Writes are a commit-log append plus a memtable insert, so the newest data is always in memory: reads look there first.',
        'Bloom filters let a read skip every SSTable that definitely lacks the key; only “maybe” files cost a disk lookup.',
        'The sparse index turns a candidate SSTable into a single block read, often served from cache.',
        'Versions are merged by timestamp and tombstones hide deleted values, which is why compaction (STCS, LCS, TWCS) matters: fewer SSTables mean fewer places to look.',
      ],
    },
    {
      mode: 'fault',
      id: 'snowflake-duplicate-ids',
      tab: 'ID generator',
      title: 'Snowflake IDs: duplicates after the move to Kubernetes',
      brief:
        'Since the order service’s ID generator moved to Kubernetes, inserts fail with duplicate primary keys, worst during flash-sale bursts and right after nodes resync their clocks, and a few new IDs sort before older ones. Find the three broken pieces and swap in the fix. (Error rates are scenario numbers.)',
      cols: 5,
      rows: 3.6,
      nodes: [
        { id: 'svc', label: 'Order service', sub: 'POST /orders', kind: 'terminal', col: 0, row: 1.2 },
        {
          id: 'gen',
          label: 'ID generator pods',
          sub: '41 ms · 10 worker · 12 seq',
          col: 1.35,
          row: 1.2,
          fine: 'The 64-bit layout is right: 41 bits of milliseconds last about 69.7 years from a custom epoch, 10 bits give 1,024 workers, and 12 bits give 4,096 IDs per ms per worker.',
        },
        {
          id: 'wid',
          label: 'Worker ID from env',
          sub: 'WORKER_ID=7 in Deployment',
          col: 2.8,
          row: 0.15,
          fault: {
            answer: 'lease',
            clue: 'Each live pod needs its own number',
            why: 'Every replica of the Deployment gets the same WORKER_ID, so pods generating in the same millisecond produce identical IDs. Static worker IDs break as soon as pods churn and scale.',
          },
        },
        {
          id: 'clk',
          label: 'Clock went back: keep going',
          sub: 'uses ts < lastTs anyway',
          col: 2.8,
          row: 2.3,
          fault: {
            answer: 'refuse',
            clue: 'Never reuse a past timestamp',
            why: 'After an NTP step or VM migration the clock jumps backwards and the generator reuses timestamps it already issued: IDs repeat and sort before older ones.',
          },
        },
        {
          id: 'seq',
          label: 'Sequence wraps to 0',
          sub: '4,097th ID in the same ms',
          col: 4.1,
          row: 1.2,
          fault: {
            answer: 'spin',
            clue: 'Out of numbers this millisecond',
            why: 'During a burst the 12-bit sequence passes 4,095 within one millisecond and wraps to 0, so the next ID equals the first one issued in that millisecond.',
          },
        },
        {
          id: 'db',
          label: 'Orders DB',
          sub: 'BIGINT PK · sharded',
          col: 1.35,
          row: 2.75,
          fine: 'A 64-bit, time-ordered key is exactly what a sharded BIGINT primary key wants: it fits, and new rows land at the end of the index.',
        },
      ],
      edges: [
        ['svc', 'gen', 'next()'],
        ['gen', 'wid'],
        ['gen', 'clk'],
        ['gen', 'seq'],
        ['gen', 'db', 'INSERT'],
      ],
      options: [
        {
          id: 'lease',
          label: 'Leased worker ID',
          sub: 'etcd lease + TTL, renewed',
          is: 'a worker ID leased from etcd, ZooKeeper or Redis with a TTL and renewed; if the lease is lost the pod stops generating, so no two pods ever share an ID',
        },
        {
          id: 'refuse',
          label: 'Wait ≤ 5 ms, else refuse',
          sub: 'alert · chrony slews',
          is: 'clock-rollback handling: a small drift is waited out, a large one refuses and alerts, and chrony slews the clock instead of stepping it',
        },
        {
          id: 'spin',
          label: 'Spin to the next ms',
          sub: 'seq exhausted → wait',
          is: 'sequence-overflow handling: after 4,096 IDs in one millisecond the generator busy-waits for the next millisecond and restarts the sequence there',
        },
        {
          id: 'uuid4',
          label: 'Switch to UUIDv4',
          sub: '128-bit random',
          decoy: true,
          is: 'coordination-free but random and 128-bit: it no longer fits the BIGINT key, is not time-sortable, and causes B-tree page splits',
        },
        {
          id: 'autoinc',
          label: 'One DB auto-increment',
          sub: 'central sequence',
          decoy: true,
          is: 'a single point of failure and a write bottleneck for the whole fleet, the problem a distributed generator exists to avoid',
        },
      ],
      metrics: [
        { label: 'Duplicate-key errors', bad: 420, good: 0, unit: '/h' },
        { label: 'Pods sharing an ID', bad: 12, good: 0, fixedBy: ['wid'] },
        { label: 'IDs out of order', bad: 37, good: 0, unit: '/h', fixedBy: ['clk'] },
      ],
      why: [
        'Snowflake IDs are time + worker + sequence: unique only if every live pod has a distinct worker ID, so lease it with a TTL instead of baking it into config.',
        'Never generate with a timestamp at or before the last one: wait out a small rollback (≤ 5 ms), refuse and alert on a large one, and run chrony with slewing.',
        'The 12-bit sequence allows 4,096 IDs per ms per worker; on overflow, spin until the next millisecond.',
        'UUIDv4 and a central auto-increment trade one problem for another: no ordering and 128 bits, or a single point of failure.',
      ],
    },
    {
      mode: 'route',
      id: 'sms-lane-routing',
      tab: 'Notification routing',
      title: 'Notifications: route every SMS to the right lane',
      brief:
        'A notification service sends OTPs and order updates while a 1M-user marketing SMS campaign is draining (scenario numbers). Steer each message so OTPs never wait behind the campaign, a provider outage doesn’t stop delivery, and money is never spent on hopeless retries.',
      cols: 5,
      rows: 3.1,
      nodes: [
        { id: 'api', label: 'Notification API', sub: 'prefs + dedup checked', kind: 'terminal', col: 0, row: 1.2 },
        { id: 'tx', label: 'sms.tx queue', sub: 'OTP / alerts lane', col: 1.45, row: 0.2 },
        { id: 'bulk', label: 'sms.bulk queue', sub: 'campaign lane · 1M', col: 1.45, row: 2.2 },
        { id: 'workers', label: 'SMS workers', sub: 'claim key · breakers', col: 2.85, row: 1.2 },
        { id: 'twilio', label: 'Twilio', sub: 'primary provider', col: 4.25, row: 0.2 },
        { id: 'msg91', label: 'MSG91', sub: 'secondary provider', col: 4.25, row: 1.2 },
        { id: 'dlq', label: 'Dead-letter queue', sub: 'alert + inspect', col: 4.25, row: 2.2 },
      ],
      edges: [
        ['api', 'tx'],
        ['api', 'bulk'],
        ['tx', 'workers'],
        ['bulk', 'workers'],
        ['workers', 'twilio'],
        ['workers', 'msg91', 'failover'],
        ['workers', 'dlq'],
      ],
      packets: [
        {
          id: 'otp',
          label: 'Login OTP for user 9',
          sub: 'security category · Twilio healthy',
          from: 'api',
          paths: [['api', 'tx', 'workers', 'twilio']],
          wrong: {
            'api>bulk':
              'The bulk lane is a million campaign messages deep. An OTP queued behind them arrives long after the login screen gave up: that is exactly why transactional and bulk traffic get separate lanes.',
            'workers>msg91':
              'The secondary provider is for failover when the primary’s circuit breaker opens. Twilio is healthy, so the OTP goes to the primary.',
            'workers>dlq':
              'Nothing has failed yet. The dead-letter queue is for messages that exhausted their retries or hit a permanent error.',
          },
          done: 'OTPs ride the transactional lane, so a campaign burst can never delay them. The worker claims the idempotency key first, then sends through the healthy primary provider.',
        },
        {
          id: 'campaign',
          label: 'Spring sale SMS to one opted-in user',
          sub: 'marketing category',
          from: 'api',
          paths: [['api', 'bulk', 'workers', 'twilio']],
          wrong: {
            'api>tx':
              'Marketing in the transactional lane puts a 1M-message campaign in front of every OTP. Campaign traffic belongs in the bulk lane, which may lag by minutes.',
            'workers>msg91':
              'Failover is for a provider whose breaker is open. The primary is up, so the campaign uses it, inside its per-provider token bucket.',
            'workers>dlq':
              'The message has not failed. Dead-lettering a healthy campaign message just loses it.',
          },
          done: 'Campaign messages wait in their own lane and drain at the provider’s rate limit, while OTPs keep their own fast path.',
        },
        {
          id: 'outage',
          label: 'Password-reset SMS during a Twilio outage',
          sub: 'Twilio breaker OPEN after 503s',
          from: 'api',
          paths: [['api', 'tx', 'workers', 'msg91']],
          wrong: {
            'api>bulk': 'A password reset is transactional: in the bulk lane it would wait behind the campaign.',
            'workers>twilio':
              'The breaker for Twilio is open because it keeps returning 503s. Sending more just burns retries against a provider that is down.',
            'workers>dlq':
              'A 503 is retryable and a second provider is available. Dead-lettering would drop a message that can still be delivered.',
          },
          done: 'Keeping two SMS providers pays off here: with the primary’s breaker open, the worker fails over to the secondary instead of retrying into an outage.',
        },
        {
          id: 'invalid',
          label: 'Order update to a number that doesn’t exist',
          sub: 'Twilio replied 400 · invalid number',
          from: 'api',
          paths: [['api', 'tx', 'workers', 'dlq']],
          wrong: {
            'api>bulk': 'An order update is transactional: it belongs in the transactional lane.',
            'workers>twilio':
              'A 4xx such as an invalid number is permanent. Retrying it, even with backoff, only spends money on a message that can never arrive.',
            'workers>msg91':
              'Failover is for provider failures (429, 5xx, timeouts). The number is invalid at every provider, so the secondary would reject it too and still charge for the attempt.',
          },
          done: 'Classify errors: 4xx means don’t retry. Mark it FAILED, send it to the dead-letter queue with the reason, and prune the bad contact data.',
        },
      ],
      why: [
        'Per-channel queues with separate transactional and bulk lanes stop a 50M-user campaign from delaying OTPs.',
        'Workers claim an idempotency key per (event, user, channel) before sending, because delivery is at-least-once.',
        'Retry only 429, 5xx and timeouts, with backoff and jitter; a circuit breaker per provider fails over to the second provider.',
        'Permanent 4xx errors are never retried: dead-letter them and prune invalid numbers and tokens.',
      ],
    },
    {
      mode: 'spike',
      id: 'viral-paste-spike',
      tab: 'Viral paste',
      title: 'Pastebin: a public paste goes viral',
      brief:
        'A public paste hits a forum front page. Views climb from 100 to 20K per second; each view loads the page (metadata check) and its raw text, which the API pods proxy from S3. Capacities are scenario numbers. With two changes, keep p99 ≤ 150 ms and errors ≤ 1% for the whole minute.',
      cols: 4,
      rows: 2.2,
      nodes: [
        { id: 'readers', label: 'Readers', sub: 'page + /raw per view', kind: 'terminal', col: 0, row: 0.6 },
        { id: 'api', label: 'Paste API pods', sub: 'page + raw proxy', col: 1.35, row: 0.6, share: 2, capacity: 24000, unit: 'req/s', ms: 5, timeoutMs: 100 },
        { id: 'meta', label: 'Postgres metadata', sub: 'visibility · expires_at', col: 2.85, row: 0, share: 1, capacity: 3000, unit: 'q/s', base: 300, ms: 5, timeoutMs: 1000 },
        { id: 's3', label: 'S3 pastes/{key}', sub: 'blob GET', col: 2.85, row: 1.2, share: 1, ms: 40 },
      ],
      edges: [
        ['readers', 'api'],
        ['api', 'meta', 'check'],
        ['api', 's3', 'GET blob'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 100],
        [10, 100],
        [40, 20000],
        [60, 20000],
      ],
      maxCards: 2,
      cards: [
        {
          id: 'cdn',
          label: 'CDN in front of /raw',
          sub: 'immutable → cache forever',
          node: 'api',
          effects: [
            { node: 'api', load: 0.505 },
            { node: 's3', load: 0.01 },
          ],
          is: 'an edge cache for public raw content, which never changes, so almost every /raw request is answered at the edge and never reaches the pods or S3',
        },
        {
          id: 'redis',
          label: 'Redis metadata cache',
          sub: 'key → visibility, expiry',
          node: 'meta',
          effects: [{ node: 'meta', load: 0.05 }],
          is: 'a cache of the small metadata row that the read path checks, so repeat views of one hot paste stop querying Postgres',
        },
        {
          id: 'inline',
          label: 'Inline every paste in DB',
          sub: 'blob moves into Postgres',
          node: 'meta',
          decoy: true,
          effects: [{ node: 'meta', load: 2 }],
          is: 'the opposite of the fix: inlining suits only small pastes, and here every raw read would also hit the database that is already saturating',
        },
        {
          id: 'lifecycle',
          label: 'S3 lifecycle rule',
          sub: 'exp=1d/ prefix',
          node: 's3',
          decoy: true,
          effects: [],
          is: 'a cost tool that lets S3 delete expired blobs on its own; it does nothing for read load on a paste that is still live',
        },
      ],
      goals: [
        { metric: 'p99', max: 150, label: 'p99 ≤ 150 ms', fail: 'A saturated box is making the slowest 1% of views wait for its timeout.' },
        { metric: 'errors', max: 1, label: 'Errors ≤ 1%', fail: 'A box is past its capacity, and every request beyond it fails.' },
      ],
      why: [
        'Pastebin separates the blob from the metadata: bytes in object storage, a small row in the database.',
        'Public raw content is immutable, so a CDN can cache it forever and take the raw traffic off the API pods and S3.',
        'Every view still checks visibility and expiry, so the hot metadata row needs a cache in front of Postgres.',
        'Reads outnumber writes 5–10×, and a viral paste is the spike to design for; inlining everything in the database moves the hot path onto the box that breaks first.',
      ],
    },
  ],
};

export default set;
