import type { ChallengeSet, Expr } from '../types';

const S: Expr = { knob: 'S' };
const D: Expr = { knob: 'D' };
const R: Expr = { knob: 'R' };
const M: Expr = { knob: 'M' };
/** 30-day error budget in minutes for the chosen SLO (lesson table: 43.2 / 21.6 / 4.3 min) */
const budget: Expr = { op: 'if', cond: { left: S, op: '==', right: 1 }, then: 43.2, else: { op: 'if', cond: { left: S, op: '==', right: 2 }, then: 21.6, else: 4.3 } };
/** expected downtime per 30 days: 1 in 4 deploys needs a rollback (scenario) + 30 min/month of AZ trouble without multi-AZ failover (scenario) */
const downtime: Expr = {
  op: 'add',
  args: [{ op: 'mul', args: [{ op: 'div', args: [D, 4] }, R] }, { op: 'if', cond: { left: M, op: '==', right: 1 }, then: 0, else: 30 }],
};

const set: ChallengeSet = {
  topic: 'fund-requirements',
  puzzles: [
    {
      mode: 'sequence',
      id: 'req-45-minute-run',
      tab: 'Run the 45 minutes',
      title: '“Design Ticketmaster”: run the four steps in order',
      brief:
        'The prompt is “design a ticketing system” and the clock says 45 minutes. Put the moves in the order the 4-step framework runs them, so nothing expensive is decided before the requirements are known.',
      layout: 'stages',
      steps: [
        {
          id: 'scope',
          label: 'Clarify scope and scale',
          sub: 'FR, NFR, out of scope',
          clue: 'Verbs, numbers, what is out',
          is: 'step 1 (3–10 min): functional requirements, NFRs with numbers, an out-of-scope list and rough scale, proposed as assumptions',
        },
        {
          id: 'hld',
          label: 'API, data, read/write paths',
          sub: 'boxes for both paths',
          clue: 'Contract and boxes, high level',
          is: 'step 2 (10–15 min): the API, a data-model sketch and a box diagram of the read and write paths',
        },
        {
          id: 'buyin',
          label: 'Ask for buy-in',
          sub: '“Does this look right?”',
          clue: 'Check in before going deep',
          is: 'the explicit check-in that ends step 2: changing direction is cheap at minute 15 and expensive at minute 35',
        },
        {
          id: 'deep',
          label: 'Deep dive: seat contention',
          sub: 'conditional UPDATE, holds',
          clue: 'The part the NFRs make hardest',
          is: 'step 3 (10–25 min): the component the NFRs make hardest, argued with numbers, alternatives and a chosen trade-off',
        },
        {
          id: 'wrap',
          label: 'Wrap-up: 10× and failures',
          sub: 'bottleneck, AZ loss, SLOs',
          clue: 'Day-2 operations, last 5 min',
          is: 'step 4 (3–5 min): the next bottleneck at 10×, failure modes and the SLO alerts you would page on',
        },
      ],
      decoys: [
        {
          id: 'shard-first',
          label: 'Sketch the sharding plan',
          sub: 'before any requirement',
          is: 'diving into sharding before you know what you are building, which is exactly what the framework exists to stop',
        },
        {
          id: 'framework',
          label: 'Debate NestJS vs Express',
          sub: 'framework choice',
          is: 'a question whose answer changes no box on the diagram, so it costs minutes and earns nothing',
        },
      ],
      why: [
        'Scope first: FRs, NFRs with numbers and an explicit out-of-scope list decide every later box.',
        'Step 2 ends with an explicit buy-in: a cheap moment to change direction.',
        'Deep-dive whatever the NFRs make hardest (here: one winner per seat), with numbers and alternatives.',
        'Wrap up with the 10× bottleneck, failure modes and monitoring: the day-2 view.',
      ],
    },
    {
      mode: 'fault',
      id: 'req-onsale-review',
      tab: 'On-sale design review',
      title: 'Design review: the on-sale broke the booking path',
      brief:
        'A 50K-seat stadium went on sale: seat-map pages took seconds, two fans were sold the same seat, and phones retrying on flaky 4G ended up holding seats twice. Find the three requirement mistakes baked into the design.',
      cols: 5,
      rows: 3,
      nodes: [
        { id: 'fans', label: 'Fans', sub: 'browse · hold · pay', kind: 'terminal', col: 0, row: 1 },
        {
          id: 'wait',
          label: 'Waiting room',
          sub: 'admits at a DB-safe rate',
          col: 1,
          row: 1,
          fine: 'Admitting buyers at the rate the database can sustain is exactly the right answer to a 1M-fans-for-50K-seats spike.',
        },
        {
          id: 'map',
          label: 'Seat map API',
          sub: 'FOR UPDATE on primary',
          col: 2,
          row: 0,
          fault: {
            answer: 'cachedmap',
            clue: 'Browsing can be a little stale',
            why: 'Rendering the seat map took row locks on the primary, so every browse paid write-path costs and queued behind the holds. The read path should be cached and eventually consistent.',
          },
        },
        {
          id: 'hold',
          label: 'POST /holds',
          sub: 'no idempotency key',
          col: 2,
          row: 2,
          fault: {
            answer: 'idem',
            clue: 'A retry must not hold again',
            why: 'Mobile clients retry on flaky networks. Without an Idempotency-Key the server cannot tell a retry from a new request, so the same fan holds seats twice.',
          },
        },
        {
          id: 'book',
          label: 'SELECT seat, then UPDATE',
          sub: 'two statements',
          col: 3,
          row: 2,
          fault: {
            answer: 'cond',
            clue: 'Exactly one winner per seat',
            why: 'Two buyers both read AVAILABLE, then both update: the contended row needs one conditional update so only a single buyer can win.',
          },
        },
        {
          id: 'pg',
          label: 'Postgres primary',
          sub: 'seat rows, the truth',
          col: 4,
          row: 1,
          fine: 'One primary easily holds 50K seats per event. The trouble is how requests reach it, not its size.',
        },
      ],
      edges: [
        ['fans', 'wait'],
        ['wait', 'map', 'browse'],
        ['wait', 'hold', 'hold'],
        ['hold', 'book'],
        ['map', 'pg', 'read'],
        ['book', 'pg', 'write'],
      ],
      options: [
        {
          id: 'cachedmap',
          label: 'Cached seat map',
          sub: 'CDN 1–2 s TTL + Redis',
          is: 'an eventually consistent read path with an "asOf" timestamp, so millions of browses never take a lock on the primary',
        },
        {
          id: 'idem',
          label: 'Holds with Idem\u00ADpotency-Key',
          sub: 'key → stored result',
          is: 'a contract where the server stores key → result and replays it for a retried request instead of holding again',
        },
        {
          id: 'cond',
          label: 'Conditional UPDATE per seat',
          sub: 'only if still AVAILABLE',
          is: 'a single atomic statement only one buyer can win; the loser sees 0 rows updated',
        },
        {
          id: 'strongall',
          label: 'Strong consistency for all',
          sub: 'serializable reads too',
          decoy: true,
          is: "one consistency model for the whole system: it makes browsing pay booking's costs, the red flag interviewers write down",
        },
        {
          id: 'shard',
          label: 'Shard Postgres by event_id',
          sub: 'more primaries',
          decoy: true,
          is: 'the 10× answer: 50K seats fit one primary, and sharding fixes neither the double sale nor the retried holds',
        },
      ],
      metrics: [
        { label: 'Seat map p99', bad: 2400, good: 180, unit: ' ms', fixedBy: ['map'] },
        { label: 'Double-sold seats', bad: 37, good: 0, fixedBy: ['book'] },
        { label: 'Duplicate holds', bad: 1200, good: 0, unit: '/h', fixedBy: ['hold'] },
        { label: 'Primary lock waits', bad: 9000, good: 300, unit: '/s' },
      ],
      why: [
        'Consistency is per feature: booking must be strong, the seat map can be a few seconds stale and served from cache.',
        'Name the contended row (the seat) and make the write a conditional update so exactly one buyer wins.',
        'Idempotency keys are a requirement written into the API contract: a retry replays, it does not repeat.',
        'Never pay write-path costs (locks, primary reads) on the read path unless a requirement demands it.',
      ],
    },
    {
      mode: 'match',
      id: 'req-questions-decide',
      tab: 'Questions that matter',
      title: 'Scoping: which answer changes which box?',
      brief:
        'You have five minutes to scope "Design Ticketmaster" before drawing anything. Patch each high-leverage question to the design decision its answer settles. Two "decisions" on the right are not what clarifying questions are for.',
      leftTitle: 'Clarifying question',
      rightTitle: 'What the answer decides',
      instruction: 'Connect each question to what its answer decides',
      left: [
        {
          id: 'spike',
          label: 'Peak vs average: do 1M fans arrive at on-sale time?',
          answer: 'queue',
          because: 'Scale and spikes decide single node vs partitioned, and whether a queue or virtual waiting room must sit in front of the write path.',
        },
        {
          id: 'ratio',
          label: 'Read:write ratio? Any celebrity-sized hot keys?',
          answer: 'cache',
          because: 'A 100:1 read-heavy shape wants caches and replicas; a write-heavy one wants a partitioned, write-optimised store, plus hot-key handling.',
        },
        {
          id: 'never-wrong',
          label: 'Which operations must never be wrong?',
          answer: 'txn',
          because: 'Money and inventory need transactions or locks; everything else can use async replication with stated staleness, per feature.',
        },
        {
          id: 'live',
          label: 'Must changes show up live, or is a refresh fine?',
          answer: 'push',
          because: 'Interactive real-time needs push (WebSocket or SSE); a few seconds of staleness lets you poll or simply re-fetch.',
        },
        {
          id: 'geo',
          label: 'Single region or global? Any data residency rules?',
          answer: 'region',
          because: 'Going global or meeting residency rules brings multi-region replication and conflict handling into the design.',
        },
        {
          id: 'clients',
          label: 'Mobile clients on flaky networks? Third-party callers?',
          answer: 'contract',
          because: 'Clients that retry and partners that page through data need idempotency keys, retry rules, pagination and versioning in the API.',
        },
      ],
      right: [
        { id: 'queue', label: 'Waiting room / queue vs single node', is: 'how the write path survives a spike far above average load' },
        { id: 'cache', label: 'Cache + replicas vs write-optimised DB', is: 'the storage shape chosen from the read/write mix' },
        { id: 'txn', label: 'Transactions vs async replication', is: 'where strong consistency is paid for and where staleness is allowed' },
        { id: 'push', label: 'WebSocket / SSE push vs polling', is: 'the delivery mechanism for updates the user waits on' },
        { id: 'region', label: 'Multi-region replication + conflicts', is: 'the geography of the data and how concurrent writes are reconciled' },
        { id: 'contract', label: 'Idempotency, retries, pagination', is: 'API contract rules that make flaky or external clients safe' },
        {
          id: 'language',
          label: 'Which language and framework to use',
          decoy: true,
          is: 'a choice that changes no box or data store, so it is not worth a scoping question',
        },
        {
          id: 'kafka',
          label: 'Kafka or RabbitMQ',
          decoy: true,
          is: 'a technology decision you make and justify later; asking it in minute one signals solution-first thinking',
        },
      ],
      why: [
        'Only ask questions whose answer changes a box, a data store or a protocol.',
        'Propose assumptions in one bundle ("I\'ll assume 10M DAU, 100:1 reads…") and let the interviewer correct them.',
        'Attach consistency and latency to each use-case, not to "the system".',
        'Technology names are your decisions to justify, not questions to ask.',
      ],
    },
    {
      mode: 'route',
      id: 'req-ticket-paths',
      tab: 'Read path vs write path',
      title: 'On-sale night: keep the read and write paths apart',
      brief:
        'During an on-sale, millions browse event 42’s seat map while tens of thousands try to hold seats. Route each request down the path its requirements call for: cheap and slightly stale for reads, small and strictly correct for writes.',
      cols: 4.5,
      rows: 3,
      nodes: [
        { id: 'client', label: 'Fans’ browsers', sub: 'event 42 on-sale', kind: 'terminal', col: 0, row: 1 },
        { id: 'cdn', label: 'CDN', sub: '1–2 s TTL', col: 1, row: 0 },
        { id: 'read', label: 'Seat-map API', sub: 'read path', col: 2, row: 0 },
        { id: 'redis', label: 'Redis', sub: 'seat map, hot copy', col: 3, row: 0 },
        { id: 'replica', label: 'Read replica', sub: 'lag 100 ms – 1 s', col: 3.5, row: 1 },
        { id: 'wait', label: 'Waiting room', sub: 'admits at DB pace', col: 1, row: 2 },
        { id: 'book', label: 'Booking API', sub: 'write path', col: 2, row: 2 },
        { id: 'primary', label: 'Primary DB', sub: 'seat rows', col: 3, row: 2 },
      ],
      edges: [
        ['client', 'cdn', 'GET'],
        ['client', 'wait', 'POST'],
        ['cdn', 'read', 'miss'],
        ['read', 'redis'],
        ['read', 'replica'],
        ['read', 'primary'],
        ['wait', 'book'],
        ['book', 'primary'],
        ['book', 'redis'],
      ],
      packets: [
        {
          id: 'browse',
          label: 'Browse the seat map of event 42',
          sub: 'GET /events/42/seats · cached at the edge',
          from: 'client',
          paths: [['client', 'cdn']],
          wrong: {
            'client>wait':
              'The waiting room protects the write path. Browsing is a read that can be a second or two stale, so it never needs to queue.',
          },
          done: 'The edge answers: with a 1–2 s TTL, millions of identical map reads cost the origin almost nothing.',
        },
        {
          id: 'browse-miss',
          label: 'Same map, right after the TTL ran out',
          sub: 'CDN miss · Redis holds the map',
          from: 'client',
          paths: [['client', 'cdn', 'read', 'redis']],
          wrong: {
            'client>wait': 'Still a read: it goes down the read path, not through the queue that guards the holds.',
            'read>replica':
              'The replica is the fallback when the cache misses. Redis already holds the map, so going to the database spends capacity for nothing.',
            'read>primary':
              'Reading the primary (or taking a lock) just to render the map mixes the two paths, the most common design bug. The primary must stay free for holds.',
          },
          done: 'The read path is cache-heavy and eventually consistent: CDN, then Redis, then a replica, never the contended primary.',
        },
        {
          id: 'hold',
          label: 'Hold seats A-12 and A-13',
          sub: 'POST /holds · Idempotency-Key',
          from: 'client',
          paths: [['client', 'wait', 'book', 'primary']],
          wrong: {
            'client>cdn': 'A hold is a write that must have exactly one winner. Nothing about it can be cached at the edge.',
            'book>redis':
              'The cache is a copy for reads. The hold must be a conditional UPDATE … WHERE status = ’AVAILABLE’ on the source of truth so that exactly one buyer wins.',
          },
          done: 'Waiting room, Booking API, then a conditional UPDATE per seat on the primary: small, strongly consistent and protected.',
        },
      ],
      why: [
        'Name the core entity and its hot row (the seat), then design the read and write paths separately.',
        'Read path: optimise for latency and cost (CDN, cache, replicas), a few seconds stale is fine.',
        'Write path: optimise for correctness (conditional update, idempotency key), protected by a waiting room.',
        'Taking the primary (or a lock) to render the seat map mixes the paths and is the most common design bug.',
      ],
    },
    {
      mode: 'tune',
      id: 'req-error-budget',
      tab: 'Spend the error budget',
      title: 'Booking SLO: pick a target you can actually keep',
      brief:
        'Booking must be at least 99.95% available over 30 days, and product wants ≥ 6 deploys a month. Scenario numbers: 1 in 4 deploys needs a rollback, and without multi-AZ failover AZ trouble costs ~30 min a month. Make the expected downtime fit the error budget.',
      cols: 3,
      rows: 2,
      nodes: [
        { id: 'svc', label: 'Booking API', sub: 'SLO {S.label}', kind: 'terminal', col: 0, row: 0.5 },
        { id: 'deploy', label: '{D} deploys / month', sub: 'rollback: {R.label}', col: 1, row: 0 },
        { id: 'db', label: 'Primary DB', sub: 'multi-AZ: {M.label}', col: 1, row: 1 },
        { id: 'budget', label: 'Error budget', sub: '30-day window', col: 2, row: 0.5 },
      ],
      edges: [
        ['svc', 'deploy'],
        ['svc', 'db'],
        ['deploy', 'budget', 'burns'],
        ['db', 'budget', 'burns'],
      ],
      knobs: [
        {
          id: 'S',
          label: 'SLO target',
          kind: 'choice',
          initial: 1,
          choices: [
            { value: 1, label: '99.9%' },
            { value: 2, label: '99.95%' },
            { value: 3, label: '99.99%' },
          ],
          help: 'availability over 30 days',
        },
        { id: 'D', label: 'Deploys per month', kind: 'stepper', min: 2, max: 7, initial: 2 },
        {
          id: 'R',
          label: 'Rollback',
          kind: 'choice',
          initial: 15,
          choices: [
            { value: 15, label: 'manual ~15 min' },
            { value: 2, label: 'automated ~2 min' },
          ],
          help: 'time to recover from a bad deploy',
        },
        { id: 'M', label: 'Multi-AZ failover', kind: 'toggle', initial: 0, help: 'standby in a second AZ' },
      ],
      constraints: [
        {
          id: 'slo',
          label: 'SLO meets the 99.95% need',
          left: S,
          op: '>=',
          right: 2,
          display: { pass: '≥ 99.95%', fail: 'below 99.95%' },
          hint: 'The requirement says booking needs at least this target. Which choices satisfy it?',
          fail: 'The target is looser than what booking needs: a confirmed seat that cannot be booked costs real sales.',
          pass: 'The target is at least what booking needs.',
        },
        {
          id: 'fits',
          label: 'Downtime fits the budget',
          unit: ' min',
          decimals: 1,
          left: downtime,
          op: '<=',
          right: budget,
          hint: 'Downtime = rollbacks × time to recover + AZ trouble. Which term is largest, and which knob shrinks it?',
          fail: 'Expected downtime is larger than the error budget: you will breach the SLO every month and freeze deploys.',
          pass: 'Expected downtime fits inside the error budget, with room to spare for experiments.',
        },
        {
          id: 'velocity',
          label: '≥ 6 deploys a month',
          unit: '/mo',
          left: D,
          op: '>=',
          right: 6,
          hint: 'Product asked for a deploy cadence; the budget is there to be spent on it.',
          fail: 'Too few deploys: the budget is not being spent on shipping.',
          pass: 'The team ships at the cadence product asked for.',
        },
      ],
      why: [
        'An NFR is a number with a window: 99.95% over 30 days allows 21.6 minutes of downtime.',
        'Error budget = 1 − SLO. Spend it on deploys and experiments; freeze risky changes when it is gone.',
        '99.95% usually needs multi-AZ, automated failover and fast rollback; manual recovery eats the budget.',
        'Different features get different SLOs: browsing can be 99.9% while booking is 99.95%.',
      ],
    },
  ],
};

export default set;
