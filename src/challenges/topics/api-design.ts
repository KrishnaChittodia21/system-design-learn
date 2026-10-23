import type { ChallengeSet, Expr } from '../types';

const B: Expr = { knob: 'B' };
const MODE: Expr = { knob: 'mode' };
const KEYS: Expr = { knob: 'keys' };

const set: ChallengeSet = {
  topic: 'api-design',
  puzzles: [
    {
      mode: 'match',
      id: 'status-code-review',
      tab: 'Status codes',
      title: 'API review: answer each case with the right status',
      brief:
        'A food-delivery Orders API returns 200 with an error body for everything, so retries, caches and alerts all misbehave. Patch each case to the status code clients and infrastructure can act on. Three tempting codes fit none of them.',
      leftTitle: 'Situation',
      rightTitle: 'Response',
      left: [
        {
          id: 'created',
          label: 'POST /orders created order o_91',
          answer: 's201',
          because: 'A create returns 201 with a Location header pointing at the new resource, so the client knows where it lives.',
        },
        {
          id: 'export',
          label: 'Monthly invoice export queued; it will take minutes',
          answer: 's202',
          because: '202 says “accepted, not done”: return a status resource (Location: /jobs/…) the client can poll.',
        },
        {
          id: 'qty',
          label: 'Body parses fine, but quantity is −3',
          answer: 's422',
          because: 'The request is well-formed but semantically invalid: 422, with field pointers in a problem+json body.',
        },
        {
          id: 'version',
          label: 'PATCH with If-Match: "7", but the order is now at "8"',
          answer: 's412',
          because: 'The precondition failed: someone changed the order since the client read it, so the server refuses the lost update with 412.',
        },
        {
          id: 'inflight',
          label: 'Same Idempotency-Key arrives while the first still runs',
          answer: 's409',
          because: 'An in-flight duplicate is a state conflict: 409 tells the client to retry later, and the operation never runs twice concurrently.',
        },
        {
          id: 'rate',
          label: 'A partner exceeds its 100 requests per minute',
          answer: 's429',
          because: '429 with Retry-After tells this client it is over its own limit and when to come back.',
        },
      ],
      right: [
        { id: 's201', label: '201 Created + Location', is: 'the response for a successful create, pointing at the new resource' },
        { id: 's202', label: '202 Accepted', sub: '+ status resource', is: 'the response for work queued to finish later' },
        { id: 's422', label: '422 Unprocessable Content', is: 'the response for a well-formed request that fails validation' },
        { id: 's412', label: '412 Precondition Failed', is: 'the response when an If-Match (or other precondition) no longer holds' },
        { id: 's409', label: '409 Conflict', is: 'the response for a state conflict: duplicate, version conflict or in-flight idempotent request' },
        { id: 's429', label: '429 Too Many Requests', sub: '+ Retry-After', is: 'the response for a client over its rate limit' },
        {
          id: 's400',
          label: '400 Bad Request',
          decoy: true,
          is: 'for malformed syntax, such as JSON that does not parse; none of these requests is malformed',
        },
        {
          id: 's500',
          label: '500 Internal Server Error',
          decoy: true,
          is: 'a server bug signal that retry libraries and alerts treat as the server’s fault, causing pointless retries and false pages',
        },
        {
          id: 's200err',
          label: '200 OK { "error": … }',
          decoy: true,
          is: 'success on the wire with failure in the body, which defeats monitoring, caches and every generic HTTP client',
        },
      ],
      why: [
        'Status codes are a contract that proxies, caches, SDKs and retry libraries already understand: precise codes get you correct retries and alerts for free.',
        'Retry libraries retry 502/503/504 and connection errors, not 4xx: returning 500 for a validation error causes pointless retries.',
        '409, 412, 422 and 429 mean different things a client can act on: wait, re-read, fix the input, slow down.',
        'Pair every error with one consistent RFC 9457 problem+json body, never a 200 with an error inside.',
      ],
    },
    {
      mode: 'sequence',
      id: 'etag-lost-update',
      tab: 'ETags vs lost updates',
      title: 'Two editors, one order: If-Match saves the day',
      brief:
        'A support agent opens order 42 to change the delivery slot, and seconds later a colleague edits the same order. Put the exchange between the agent’s console and the API in order so the colleague’s change is never silently overwritten.',
      layout: 'ladder',
      actors: [
        { id: 'c', label: 'Console', sub: 'agent' },
        { id: 's', label: 'API', sub: 'orders' },
      ],
      steps: [
        {
          id: 'get1',
          label: 'GET /orders/42',
          from: 'c',
          to: 's',
          clue: 'Opens the order',
          is: 'the initial read of the order the agent wants to edit',
        },
        {
          id: 'etag7',
          label: '200 OK · ETag: "7"',
          sub: 'from the version column',
          from: 's',
          to: 'c',
          clue: 'Fingerprint of what was read',
          is: 'the order plus a strong ETag derived from its version column, not from hashing the body',
        },
        {
          id: 'patch7',
          label: 'PATCH · If-Match: "7"',
          sub: 'new delivery slot',
          from: 'c',
          to: 's',
          clue: '“Only if nobody changed it”',
          is: 'a conditional update: UPDATE … WHERE id = 42 AND version = 7',
        },
        {
          id: 'fail412',
          label: '412 Precondition Failed',
          sub: 'order is now "8"',
          from: 's',
          to: 'c',
          clue: 'The colleague got there first',
          is: 'the refusal that prevents the lost update: the current version is no longer 7',
        },
        {
          id: 'get2',
          label: 'GET /orders/42 again',
          sub: 're-read and merge',
          from: 'c',
          to: 's',
          clue: 'Sees the colleague’s change',
          is: 'the re-read after a 412, so the agent can merge their change with the colleague’s',
        },
        {
          id: 'etag8',
          label: '200 OK · ETag: "8"',
          from: 's',
          to: 'c',
          clue: 'The fresh fingerprint',
          is: 'the current order including the colleague’s edit, at version 8',
        },
        {
          id: 'patch8',
          label: 'PATCH · If-Match: "8"',
          sub: 'merged change',
          from: 'c',
          to: 's',
          clue: 'Tries again on the new version',
          is: 'the conditional update retried against the version the agent actually saw',
        },
        {
          id: 'ok9',
          label: '200 OK · ETag: "9"',
          from: 's',
          to: 'c',
          clue: 'Both edits survive',
          is: 'the successful update, which bumps the version to 9 and keeps both editors’ changes',
        },
      ],
      decoys: [
        {
          id: 'overwrite',
          label: 'PUT without If-Match → 200',
          sub: 'last write wins',
          from: 'c',
          to: 's',
          is: 'the lost update itself: the agent’s full replace silently erases the colleague’s edit',
        },
        {
          id: 'weak',
          label: '200 OK · ETag: W/"7"',
          sub: 'weak ETag',
          from: 's',
          to: 'c',
          is: 'a weak ETag, which never satisfies If-Match because concurrency control needs strong comparison',
        },
        {
          id: 'notmod',
          label: '304 Not Modified',
          from: 's',
          to: 'c',
          is: 'the answer to a conditional GET with If-None-Match; it saves bandwidth but never guards a write',
        },
      ],
      why: [
        'An ETag is a fingerprint of a version; derive it from a version or updated_at column instead of hashing the body on every request.',
        'If-Match turns a write into “only if it is still the version I read”: a mismatch returns 412 and the client re-reads and merges.',
        'Return 428 Precondition Required when a client omits If-Match on resources where lost updates matter.',
        'If-None-Match → 304 is the caching side of the same header family; weak ETags are fine there but never for If-Match.',
      ],
    },
    {
      mode: 'route',
      id: 'payment-retry-routing',
      tab: 'Route the retries',
      title: 'Payments: route every retry through the key table',
      brief:
        'Mobile clients on flaky networks retry POST /payments after a 10-second timeout, and the service runs on 12 pods. Steer each request carrying an Idempotency-Key so nobody is charged twice and every retry gets a useful answer.',
      cols: 4,
      rows: 4.4,
      nodes: [
        { id: 'app', label: 'Mobile app', sub: 'POST /payments', kind: 'terminal', col: 0, row: 1.7 },
        { id: 'memset', label: 'In-memory Set', sub: 'per pod · 12 pods', col: 1, row: 0.2 },
        { id: 'claim', label: 'Claim the key', sub: 'INSERT … ON CONFLICT', kind: 'decision', col: 1, row: 2.6 },
        { id: 'exec', label: 'Charge + store result', sub: 'one transaction', col: 2, row: 0.8 },
        { id: 'lookup', label: 'Read stored row', sub: 'status + request hash', kind: 'decision', col: 2, row: 2.8 },
        { id: 'replay', label: 'Replay response', sub: 'same status + body', kind: 'terminal', col: 3, row: 0.1 },
        { id: 'c409', label: '409 Conflict', sub: 'Retry-After: 1', kind: 'terminal', col: 3, row: 1.85 },
        { id: 'c422', label: '422 Key reused', sub: 'different body', kind: 'terminal', col: 3, row: 3.6 },
      ],
      edges: [
        ['app', 'memset'],
        ['app', 'claim'],
        ['claim', 'exec', 'claimed'],
        ['claim', 'lookup', 'exists'],
        ['lookup', 'replay'],
        ['lookup', 'c409'],
        ['lookup', 'c422'],
      ],
      packets: [
        {
          id: 'first',
          label: 'Pay ₹499 · Idempotency-Key k1',
          sub: 'k1 never seen before',
          from: 'app',
          paths: [['app', 'claim', 'exec']],
          wrong: {
            'app>memset':
              'A Set in one pod’s memory is invisible to the other 11 pods and vanishes on restart, so the retry that lands on another pod charges again. The key must be claimed in shared storage.',
            'claim>lookup':
              'The INSERT … ON CONFLICT DO NOTHING succeeded, so this request owns the key. There is no earlier row to read: it is the first attempt and must run.',
          },
          done: 'The claim succeeded, so the charge runs, and its 201 response is stored with the key in the same transaction. “Did the work but didn’t record it” can’t happen.',
        },
        {
          id: 'timeout-retry',
          label: 'Retry after a 10 s timeout · key k1',
          sub: 'same body · first attempt completed',
          from: 'app',
          paths: [['app', 'claim', 'lookup', 'replay']],
          wrong: {
            'app>memset':
              'The retry may land on any of the 12 pods, and a per-pod Set has never seen k1 there. That is exactly how the quick fix kept double-charging.',
            'claim>exec':
              'The key already exists, so the claim inserted nothing. Charging again is the double charge the key exists to prevent.',
            'lookup>c409':
              'The stored row is completed, not in progress. A 409 would make the client wait for work that has already finished.',
            'lookup>c422':
              'The request hash matches the stored one: this is a genuine retry of the same payment, not a reused key.',
          },
          done: 'Completed + same request hash: the server replays the stored status and body. The client finally learns the payment went through, and nothing is charged twice.',
        },
        {
          id: 'double-tap',
          label: 'Double tap: k2 again, 200 ms later',
          sub: 'same body · first k2 still running',
          from: 'app',
          paths: [['app', 'claim', 'lookup', 'c409']],
          wrong: {
            'app>memset':
              'Both taps can hit different pods at the same moment. Only a unique constraint in shared storage serialises them.',
            'claim>exec':
              'The first tap already holds the key. Running the charge again would execute the operation twice concurrently.',
            'lookup>replay':
              'There is nothing to replay yet: the stored row is still in progress and has no response.',
            'lookup>c422':
              'The body is identical, so the key isn’t being misused. The problem is timing, not content.',
          },
          done: 'An in-flight duplicate gets 409 Conflict (with Retry-After), and the operation never runs twice at once. The client retries shortly and then receives the replay.',
        },
        {
          id: 'reused-key',
          label: 'Bug: key k1 reused for a ₹1,200 payment',
          sub: 'different body · k1 completed',
          from: 'app',
          paths: [['app', 'claim', 'lookup', 'c422']],
          wrong: {
            'app>memset':
              'A per-pod Set can’t compare request hashes across pods, and it would either charge or silently drop this request.',
            'claim>exec':
              'k1 is taken. Executing would treat a key that means “the ₹499 payment” as a new payment.',
            'lookup>replay':
              'Replaying the ₹499 response for a ₹1,200 request would tell the client a payment succeeded that never ran.',
            'lookup>c409':
              'k1 isn’t in progress, it’s completed. 409 would make the client retry forever without fixing the bug.',
          },
          done: 'Completed + a different request hash means the client reused a key for another operation, so the server answers 422 and runs nothing. A key belongs to one logical operation.',
        },
      ],
      why: [
        'The client generates one Idempotency-Key per logical operation, and every retry reuses it.',
        'The server claims the key atomically with a unique constraint in shared storage, never in one pod’s memory.',
        'An existing key gives three answers: completed and same hash → replay, still running → 409, different hash → 422.',
        'Store the response in the same transaction as the side effect, and expire keys after a retention window (Stripe: 24 hours).',
      ],
    },
    {
      mode: 'tune',
      id: 'bulk-sync-batching',
      tab: 'Tune the batch',
      title: 'Nightly inventory sync: size the batch API',
      brief:
        'A retail partner pushes 2 million inventory updates every night over 8 connections, under a 100 requests/s per-partner rate limit, and 0.2% of items fail validation. Finish within 3 minutes (the partner’s window, a scenario number) without re-sending more than 10,000 items.',
      cols: 4,
      rows: 2.4,
      nodes: [
        { id: 'partner', label: 'Retail partner', sub: 'item keys {keys.label}', kind: 'terminal', col: 0, row: 0.6 },
        { id: 'gw', label: 'API gateway', sub: '100 req/s per partner', col: 1, row: 0.6 },
        { id: 'api', label: 'POST /inventory:\u200Bbatch', sub: '{B.label} items per call', col: 2, row: 0.6 },
        { id: 'db', label: 'Postgres', sub: 'multi-row upsert', col: 3, row: 0.5 },
        { id: 'resp', label: 'Response', sub: '{mode.label}', col: 3, row: 1.75 },
      ],
      edges: [
        ['partner', 'gw', '8 conns'],
        ['gw', 'api'],
        ['api', 'db', 'upsert'],
        ['api', 'resp'],
      ],
      knobs: [
        {
          id: 'B',
          label: 'Items per call',
          kind: 'choice',
          initial: 1,
          choices: [
            { value: 1, label: '1' },
            { value: 2, label: '100' },
            { value: 3, label: '500' },
            { value: 4, label: '1,000' },
            { value: 5, label: '50,000' },
          ],
          help: 'today: one PUT per item',
        },
        {
          id: 'mode',
          label: 'Batch semantics',
          kind: 'choice',
          initial: 0,
          choices: [
            { value: 0, label: 'all-or-nothing' },
            { value: 1, label: 'per-item results' },
          ],
          help: 'what a failed item does to its batch',
        },
        { id: 'keys', label: 'Per-item idempotency', kind: 'toggle', initial: 0, help: 'a client ref + key on every item' },
      ],
      constraints: [
        {
          id: 'time',
          label: 'Sync time ≤ 3 min',
          left: { op: 'pick', list: [20000, 200, 107, 97, 77], index: B },
          op: '<=',
          right: 180,
          unit: ' s',
          hint: 'Per call: 40 ms round trip + server time + body transfer. How many calls fit under 100 req/s?',
          fail: 'Too many round trips: item by item the rate limit caps you at 100 req/s, which is 5.6 hours for 2M items, and 100-item batches still sit on that cap.',
          pass: 'Each call carries enough items that round trips and the rate limit stop being the bottleneck: about 2 minutes for the whole night.',
        },
        {
          id: 'body',
          label: 'Request body ≤ 5 MB',
          left: { op: 'pick', list: [0.3, 30, 150, 300, 15000], index: B },
          op: '<=',
          right: 5000,
          unit: ' KB',
          hint: 'Each item is about 300 bytes. Bulk APIs cap a batch by count or by megabytes.',
          fail: 'A 15 MB body holds row locks for seconds in one transaction, and a timeout loses the whole call.',
          pass: 'The body stays well inside the usual 1–5 MB batch cap, which bounds latency and memory.',
        },
        {
          id: 'resent',
          label: 'Items re-sent ≤ 10,000',
          left: { op: 'if', cond: { left: MODE, op: '==', right: 1 }, then: 4000, else: { op: 'pick', list: [4000, 363000, 1260000, 1730000, 2000000], index: B } },
          op: '<=',
          right: 10000,
          hint: 'With 0.2% bad items, what share of 500-item batches contain at least one?',
          fail: 'All-or-nothing: one bad item fails its whole batch, and about 63% of 500-item batches contain one, so ~1.26M good items are re-sent (and fail again).',
          pass: 'Per-item results tell the partner exactly which 4,000 items failed, so only those are re-sent.',
        },
        {
          id: 'dupes',
          label: 'Retried batch adds no duplicates',
          left: KEYS,
          op: '==',
          right: 1,
          display: { pass: 'safe to retry', fail: 'duplicates successes' },
          hint: 'A batch call times out halfway. What happens to its items that already succeeded when it is sent again?',
          fail: 'Without per-item keys, retrying a timed-out or partly failed batch applies its successful items a second time.',
          pass: 'Each item carries its own key and ref, so a retried batch replays the items that already succeeded instead of applying them twice.',
        },
      ],
      why: [
        'Batching removes the round-trip and rate-limit bottleneck: 4,000 calls of 500 items take about 2 minutes instead of 5.6 hours.',
        'Past a few hundred items the speed-up flattens, while body size, lock time and the cost of a lost call keep growing: cap batches at about 500–1,000 items.',
        'At a 0.2% error rate about 63% of 500-item batches contain a failure, so partial failure has to be part of the contract (per-item results or 207).',
        'Per-item refs and idempotency keys make a retried batch safe; a batch is not a transaction.',
      ],
    },
    {
      mode: 'spike',
      id: 'graphql-launch-spike',
      tab: 'Survive the spike',
      title: 'Launch day: the GraphQL orders page melts',
      brief:
        'The new orders screen asks GraphQL for 50 orders and each order’s customer. Launch traffic climbs from 200 to 3,000 requests/s (scenario numbers: Postgres takes 20,000 queries/s, the gateway 2,000 requests/s). Pick two changes that keep p99 ≤ 100 ms and errors ≤ 1%.',
      cols: 4,
      rows: 1.5,
      nodes: [
        { id: 'apps', label: 'Mobile + web', sub: 'orders(first: 50)', kind: 'terminal', col: 0, row: 0.5 },
        { id: 'cdn', label: 'CDN edge', sub: 'caches GETs only', col: 1, row: 0.5 },
        { id: 'gw', label: 'GraphQL gateway', sub: 'parse · validate · resolve', col: 2, row: 0.5, share: 1, capacity: 2000, unit: 'req/s', ms: 20, timeoutMs: 1000 },
        { id: 'db', label: 'Orders Postgres', sub: 'other traffic: 2K q/s', col: 3, row: 0.5, share: 51, capacity: 20000, unit: 'q/s', base: 2000, ms: 5, timeoutMs: 1000 },
      ],
      edges: [
        ['apps', 'cdn', 'POST /graphql'],
        ['cdn', 'gw'],
        ['gw', 'db', '51 q / page'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 200],
        [10, 200],
        [30, 3000],
        [60, 3000],
      ],
      maxCards: 2,
      cards: [
        {
          id: 'dataloader',
          label: 'DataLoader per request',
          sub: 'batch customer lookups',
          node: 'gw',
          effects: [{ node: 'db', load: 2 / 51 }],
          is: 'a per-request loader that collects every customer id asked for in the same tick and issues one WHERE id = ANY($1) query: 51 queries per page become 2',
        },
        {
          id: 'apq',
          label: 'Persisted queries over GET',
          sub: '~70% CDN hits (scenario)',
          node: 'cdn',
          effects: [
            { node: 'gw', load: 0.3 },
            { node: 'db', load: 0.3 },
          ],
          is: 'sending a registered query hash with GET instead of a POST body, which makes the response CDN-cacheable so repeat requests never reach the gateway',
        },
        {
          id: 'retry',
          label: 'Clients retry 5xx 3×',
          sub: 'in the app SDK',
          node: 'apps',
          decoy: true,
          effects: [{ node: 'gw', load: 2 }],
          is: 'a load amplifier: every timed-out request comes back again to a gateway that is already saturated',
        },
        {
          id: 'nointro',
          label: 'Disable introspection',
          sub: 'in production',
          node: 'gw',
          decoy: true,
          effects: [],
          is: 'a sensible hardening step for a private API, but it hides the schema; it removes no queries and no load',
        },
      ],
      goals: [
        {
          metric: 'p99',
          max: 100,
          label: 'p99 ≤ 100 ms',
          fail: 'A saturated box makes the slowest 1% of order pages wait for its timeout.',
        },
        {
          metric: 'errors',
          max: 1,
          label: 'Errors ≤ 1%',
          fail: 'A box is past its capacity, so requests beyond it fail and the orders screen shows an error.',
        },
      ],
      why: [
        'N+1: one query for the 50 orders plus one per customer is 51 queries per page, which melts the database long before the gateway is busy.',
        'DataLoader, created per request, batches and de-duplicates those lookups into one query, so the page costs 2 queries.',
        'GraphQL over POST can’t be cached by a CDN. Persisted queries let clients send a hash with GET, so repeat responses come from the edge.',
        'Retries against a saturated box multiply its load, and disabling introspection is hardening, not capacity.',
      ],
    },
  ],
};

export default set;
