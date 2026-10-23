# End-of-topic challenges: authoring guide

Every topic ends with 5 hands-on puzzles in at least 4 different modes. They appear as the last **Challenge** tab of the topic page and as a "Ready for the challenge?" card at the bottom of the Learn tab. A topic with no challenge file shows neither.

```
src/challenges/
  types.ts              the data format (read the doc comments: they hold the limits)
  logic.ts              pure engine logic: tune rule evaluator, route steps, the spike simulation (also used by the validator)
  registry.ts           discovery: import.meta.glob('./topics/*.ts'), lazy per topic
  topics/<topic-id>.ts  ONE FILE PER TOPIC  ← you only ever add / edit these
  ui/                   the game (lazy chunk): Board, seven mode components, styles
scripts/validate-challenges.mjs
```

## Workflow (phase 2)

1. Read the topic: `src/content/topics/<topic-id>.ts`. Every fact, number, label and explanation in a puzzle must come from (or agree with) that lesson.
2. Create `src/challenges/topics/<topic-id>.ts` (file name = topic id). Nothing else needs editing: discovery is automatic, so many authors can work in parallel.
3. `npm run validate:challenges -- <topic-id>` until it prints ✓. Then `npx tsc -b` (type errors) and `npm run validate:challenges` (all files).
4. Preview: `npx vite --port <free port> --strictPort`, open `http://localhost:<port>/#/topic/<topic-id>?tab=challenge`. Check desktop **and** a 360–390px phone width, light and dark.

### File skeleton

```ts
import type { ChallengeSet } from '../types';

const set: ChallengeSet = {
  topic: 'cache-failures',
  puzzles: [
    /* 5 puzzles, at least 4 different modes */
  ],
};

export default set;
```

**Only `import type`** (plus local helper constants/functions inside the file). The validator loads these files with plain Node (type stripping), so a value import such as `import { x } from '../logic'` would break it. Never rename a shipped puzzle `id`: learners' stars are stored under `<topic>/<puzzle id>`.

## Common fields (every mode)

| field | rule |
|---|---|
| `id` | kebab-case, unique within the topic |
| `mode` | `flow` · `sequence` · `fault` · `match` · `tune` · `route` · `spike` |
| `tab` | optional picker label, ≤ 24 chars (defaults to the title) |
| `title` | ≤ 60 chars |
| `brief` | 1–2 sentences: what must work, under what pressure ("Mobile networks retry…") |
| `why` | 2–5 short takeaways shown on completion ("Why this design works") |

Explanations are shown in sentences built by the engine, so write them to fit:

- Option / step / right-item `is`: a **noun phrase that completes "\<label\> is …"**, lower-case start, no trailing period. ✓ `'an in-memory key–value cache with sub-millisecond reads'`. For a decoy, `is` must also say *why it is wrong here*: `'a full batch export, so search would lag by hours, not seconds'`.
- `hint` / `clue`: ≤ 40 chars, a short functional description, never the answer's name. ✓ `'Answers repeat clicks near the user'` ✗ `'CDN'`.
- Fault `why`, match `because`, tune `fail` / `pass`: full sentences.

Scoring is the same everywhere: 3 stars with no misses and no hints, 2 stars with at most two misses + hints combined, otherwise 1. (Tune has no misses; in route a miss is a wrong hop, in spike a failed run.)

## The board (flow, fault, tune, route, spike; sequence `stages` reuses it)

Nodes sit on a `cols × rows` grid; a node's **centre** is in the middle of cell (`col`, `row`). Fractions are fine (`2.6`). On boards narrower than 620px the grid is **transposed** (col ↔ row), so a left → right flow runs top → bottom on phones.

- `0 ≤ col < cols`, `0 ≤ row < rows`, and the **whole node** must sit inside the board on every layout. A node's centre in the last half-cell is not enough: a node is ~58–100px tall on desktop and up to ~140px on a phone (its label wraps to 3 lines in an 84px box). The validator estimates each node's height from its text (every state it can show: a slot's clue, the placed card, an exposed fault) and tells you which `col` / `cols` or `row` / `rows` to adjust; usually `rows` / `cols` + 0.1–0.3 is enough.
- Layouts checked: **desktop** (900px board: one column ≈ 150px node, one row ≈ 112px), **tablet** (640px board, the narrowest untransposed one: nodes ≈ 92px, 12.5px text) and a **360px phone** (296px board, transposed: one row (former column) ≈ 150px tall, nodes 84–128px wide).
- Keep ≤ 8 nodes and ≤ ~6 columns × 3–4 rows. Nodes must not overlap (estimated boxes + 4px) on any layout.
- Labels ≤ 28 chars, `sub` ≤ 26 chars (mono, small). A word that can't break and is wider than the 84px phone box spills over its border: the validator warns. Add a soft hyphen `\u00AD` inside English words (`'Elastic\u00ADsearch'`, shows a hyphen when it breaks) or a zero-width space `\u200B` inside code (`'process.\u200Bexit()'`, `'max_\u200Bconnections'`). Neither counts toward the length limits.
- Edges: `['from', 'to', 'label?']`, label ≤ 14 chars. A wire must not cross a third node. Wire labels are placed by the engine (`placeEdgeLabel` in `logic.ts`): centred above a mostly horizontal wire (lifted above both nodes when the wire is shorter than the text), otherwise beside the wire, flipped to the other side if it would leave the board. The validator warns when a label would still cover a node or run off the board: move the nodes apart or shorten the label.
- Kinds: `box` (default), `decision` (◆ amber, for flowcharts), `terminal` (pill: user, client, start/end).

## Mode 1: `flow` — "Fix the flow"

Some nodes are red slots (`answer` + `hint`); the learner drags the matching card from the tray. Wires stay red/dashed with a blinking ✗ until both ends are correct, then turn green with packets.

```ts
{
  mode: 'flow',
  id: 'shortener-redirect',
  tab: 'URL shortener',
  title: 'URL shortener: the redirect path',
  brief: 'A click on sho.rt/aZ3k must reach the long URL in a few milliseconds, survive a hot link going viral, and still count the click.',
  cols: 5,
  rows: 3.6,
  nodes: [
    { id: 'user', label: 'Browser', sub: 'GET /aZ3k', kind: 'terminal', col: 0, row: 1 },
    { id: 'edge', answer: 'cdn', hint: 'Answers repeat clicks near the user', col: 1, row: 1 },
    { id: 'app', label: 'Redirect service', sub: 'stateless', col: 2, row: 1 },
    { id: 'cache', answer: 'redis', hint: 'code → URL in ~1 ms', col: 3, row: 0 },
    { id: 'db', answer: 'kv', hint: 'Source of truth on a miss', col: 3, row: 2 },
  ],
  edges: [['user', 'edge'], ['edge', 'app', 'miss'], ['app', 'cache', '1 · lookup'], ['app', 'db', '2 · on miss']],
  options: [
    { id: 'cdn', label: 'CDN edge', sub: 'caches 301/302', is: 'an edge cache that serves repeat requests close to the user' },
    { id: 'redis', label: 'Redis cache', sub: 'in-memory', is: 'an in-memory key–value cache with sub-millisecond reads' },
    { id: 'kv', label: 'DynamoDB / Cassandra', sub: 'code → long URL', is: 'a durable, horizontally scalable key–value store' },
    { id: 's3', label: 'Object storage (S3)', decoy: true, is: 'blob storage for files and media, too slow and coarse for per-click lookups' },
  ],
  why: ['…', '…'],
}
```

Rules: every slot has `hint`; each non-decoy option answers exactly one slot; 1–3 decoys; fixed nodes need `label`. 3–6 slots is the sweet spot. Full examples: `topics/design-classics.ts`, `topics/data-pipelines.ts`, `topics/design-commerce.ts` (flowchart with decisions).

## Mode 2: `sequence` — "Sequence it"

`steps` are listed **in the correct order**; the tray shuffles them with `decoys` (steps that never happen). Any position can be filled at any time; a correctly placed step lights up and packets flow from step 1 up to the first gap. A wrong card says whether it happens earlier or later, or never.

Two layouts:

- `layout: 'ladder'` — a message sequence between exactly two `actors` (client ↔ server). Every step needs `from` and `to` (actor ids); the arrow direction is revealed when placed. Labels ≤ 34 chars.
- `layout: 'stages'` — numbered pipeline stages on the board (left → right, snaking onto a second row after 5; vertical on phones). Labels ≤ 28 chars.

```ts
{
  mode: 'sequence',
  id: 'tls13-handshake',
  title: 'TLS 1.3: the 1-RTT handshake',
  brief: '…',
  layout: 'ladder',
  actors: [{ id: 'c', label: 'Client', sub: 'phone app' }, { id: 's', label: 'Server', sub: 'api.shop.com' }],
  steps: [
    { id: 'hello', label: 'ClientHello + key_share', sub: 'ciphers + X25519 share', from: 'c', to: 's',
      clue: 'Client guesses the key exchange',
      is: "the opening message: supported ciphers plus the client's ECDHE key share, sent up front so no extra round trip is needed" },
    // … in order
  ],
  decoys: [
    { id: 'cke', label: 'ClientKeyExchange', sub: 'Client → Server',
      is: 'a TLS 1.2 message: in TLS 1.3 the key share already rode in the ClientHello, which is exactly how 1.3 saves a round trip' },
  ],
  why: ['…'],
}
```

Rules: 3–8 steps, 1–3 decoys, unique ids/labels, `clue` per step strongly recommended (it is printed in the empty position). Good fits: handshakes, protocol message flows (Raft, 2PC, OAuth, saga), request lifecycles, incident-response or migration runbooks, pipeline stages. Examples: `topics/net-protocols.ts` (ladder), `topics/ds-consensus.ts` (stages).

## Mode 3: `fault` — "Fault hunt"

A complete-looking design with red alarm tiles. 1–3 nodes carry `fault`: their `label`/`sub` show the **wrong** design. The learner clicks a suspect node (a wrong click is a miss and shows that node's `fine` text, and the node is marked "checked"), then swaps in the replacement card. Metrics tween from `bad` to `good` as their faults are fixed; all wires go green at the end. Dropping a card straight onto an unexposed fault also works.

```ts
{
  mode: 'fault',
  id: 'black-friday-cache',
  title: 'Black Friday: the cache layer is on fire',
  brief: 'Every hour on the hour the database melts, … Find the three misconfigured pieces and swap in the fix.',
  cols: 5,
  rows: 3,
  nodes: [
    { id: 'shop', label: 'Shoppers + bots', sub: 'GET /product/:id', kind: 'terminal', col: 0, row: 1 },
    { id: 'warm', label: 'Warm-up job', sub: '2M keys · TTL 3600 s', col: 3, row: 0,
      fault: { answer: 'jitter', clue: 'Spread the expiry times',
        why: 'The job writes 2M keys with the same 1-hour TTL, so exactly one hour later they all expire within seconds (cache avalanche).' } },
    { id: 'redis', label: 'Redis cluster', sub: '3 shards + replicas', col: 4, row: 0,
      fine: 'Sharded, replicated and with automatic failover: the cluster itself is set up well.' },
    // …
  ],
  edges: [['warm', 'redis', 'SET'] /* … */],
  options: [
    { id: 'jitter', label: 'Warm-up with TTL jitter', sub: 'TTL = 1 h ± 10%', is: 'spreading the expiry times so 2M keys expire over minutes instead of in the same second' },
    { id: 'longttl', label: 'Longer TTL: 24 h for all', decoy: true, is: 'still one synchronized expiry, just a day later, with staler data in between' },
  ],
  metrics: [
    { label: 'DB queries', bad: 48000, good: 2400, unit: '/s' },                       // driven by every fault
    { label: 'Expiries at :00', bad: 2000000, good: 2800, unit: '/s', fixedBy: ['warm'] },
  ],
  why: ['…'],
}
```

Rules: every non-fault, non-terminal node needs `fine` (why it is NOT the problem); faults can't be terminals; each non-decoy option fixes exactly one fault; 2–4 metrics (`label` ≤ 22, `unit` is appended verbatim, so use `' ms'` with a space); the brief must describe **symptoms**, not name the faults. Make the faulty node's text a plausible but wrong configuration a reader of the lesson can spot. Example: `topics/cache-failures.ts`.

## Mode 4: `match` — "Patch cables"

Two columns. Drag a cable from a left socket to a right socket (or tap left, then right; or Enter, Enter). Correct cables glow green; wrong ones flash red and snap back with the right item's `is`.

```ts
{
  mode: 'match',
  id: 'symptoms-patterns',
  title: 'On call: match each symptom to its pattern',
  brief: '…',
  leftTitle: 'Symptom',
  rightTitle: 'Pattern',
  left: [
    { id: 'pool', label: 'A slow dependency drains the shared pool; other calls fail', answer: 'bulkhead',
      because: 'Bulkheads give each dependency its own pool or semaphore, so a slow one can only flood its own compartment.' },
    // 3–6 items
  ],
  right: [
    { id: 'bulkhead', label: 'Bulkheads', sub: 'pool per dependency', is: 'isolating resource pools so one failure cannot sink the whole service' },
    { id: 'moreretries', label: 'Retry immediately, 5 attempts', decoy: true, is: 'the classic load amplifier: …' },
  ],
  why: ['…'],
}
```

Rules: left labels ≤ 60 chars, right ≤ 40; every right item is either an answer or `decoy: true`; 1–3 decoys; several lefts may share one right. The heading above the instructions reads "Connect each \<leftTitle\> to its \<rightTitle\>" (first letter lower-cased unless it is an acronym); when that doesn't read naturally, set `instruction` (≤ 60 chars), e.g. `instruction: 'Connect each question to what its answer decides'`. Good pairings: symptom ↔ fix, problem ↔ pattern, guarantee ↔ mechanism, workload ↔ data store, failure ↔ detection signal, requirement ↔ technology. Example: `topics/rel-patterns.ts`.

## Mode 5: `tune` — "Tune it"

Knobs drive gauges. Each gauge is `left op right` over safe expressions (no `eval`). Gauges update live; when all pass, wires go green and the puzzle completes (knobs lock; Reset to play again). Tune has no misses: stars come from hints only (each hint names the next failing gauge and highlights the knobs it uses).

Knobs: `slider` / `stepper` (`min`, `max`, `step`), `toggle` (0/1), `choice` (`choices: [{ value, label }]`, 2–5). `initial` must be a reachable value. Readouts show as many decimals as `step` / `min` need (`decimals` overrides). A toggle is announced as a switch named after its label; each choice button as "\<knob label\>: \<choice\>".

Expressions (`Expr`):

| form | meaning |
|---|---|
| `3` | constant (`Infinity` allowed) |
| `{ knob: 'W' }` | a knob's value |
| `{ op: 'add' \| 'sub' \| 'mul' \| 'div' \| 'min' \| 'max', args: [...] }` | arithmetic, left to right; x/0 = ∞ |
| `{ op: 'pick', list: [5, 8, 12], index: expr }` | 1-based lookup; out of range = ∞ ("latency of the W-th fastest replica") |
| `{ op: 'if', cond: rule, then: expr, else: expr }` | condition |
| `{ op: 'fn', fn: 'mm1Latency', args: [...] }` | a pure function registered in `logic.ts` `FUNCTIONS`: `ceil`, `floor`, `round`, `pow`, `log2`, `mm1Latency(serviceMs, util)`, `fanoutTail(q, n)`. Need another? Add a pure, total function there (one line + doc). |

Rules (`Rule`, used by `if`, node / wire `showIf` and gauge `applies`): `{ left, op, right }` with `op` in `< <= > >= == !=` (float-tolerant), or `{ all: [...] }`, `{ any: [...] }`, `{ not: rule }`.

Board extras:

- Node `label` / `sub` and edge labels may contain placeholders, replaced live: `{W}` → the knob's value, shown with the knob's decimals (default: as many as its `step` / `min` has, so `step: 0.5` shows `2.5`; set `decimals` on the knob to override); `{W:1}` → with exactly 1 decimal; `{ttl.label}` → a choice knob's button text (`'1 h'`) or a toggle's `on` / `off`. Plain `{ttl}` on a choice knob prints its numeric value (`'TTL {ttl} s'` → `TTL 3,600 s`). The validator measures every text with the knob values that make it widest.
- `showIf` on a node hides it and its wires (e.g. replica 4 only when `N ≥ 4`).
- `showIf` on a wire: a 4th tuple element, `['apps', 'gw', 'stream', PUSH]` (use `''` for no label). The same pair may appear twice as alternatives when the copies carry a `showIf`.

Gauge extras:

- `display` — how the value line reads. Default `'number'` ("18 ms ≤ 20 ms"). For a 0/1 gauge (a toggle, or an `if` that yields 1 / 0) use `'yesno'` ("no · needs yes") or your own words per state, `display: { pass: 'no gap', fail: 'train/serve gap' }` (≤ 32 chars each). The validator warns about a unit-less gauge that only ever compares 0 and 1 ("1 = 0").
- `applies` — a rule; while it doesn't hold the gauge shows "n/a", counts as passing and hints skip it. Use it instead of multiplying by a 0/1 flag, e.g. "Sockets per gateway" only when the transport is push: `applies: PUSH`. The validator errors if it never holds.
- `decimals` / `unit` work as before (both sides).

```ts
const N: Expr = { knob: 'N' };
const W: Expr = { knob: 'W' };
// …
knobs: [
  { id: 'N', label: 'N · replicas', kind: 'stepper', min: 3, max: 5, initial: 3, help: 'copies of every key' },
  { id: 'W', label: 'W · write acks', kind: 'stepper', min: 1, max: 5, initial: 1, help: 'acks before a write succeeds' },
],
constraints: [
  { id: 'overlap', label: 'Reads overlap the last write',
    left: { op: 'add', args: [R, W] }, op: '>', right: N,
    hint: 'Every read set must share at least one replica with every write set. How big must R + W be compared with N?',
    fail: 'R + W ≤ N: a read can land only on replicas that missed the latest write and return stale data.',
    pass: 'R + W > N: every read quorum overlaps every write quorum…' },
  { id: 'write-p99', label: 'Write p99 ≤ 20 ms', unit: ' ms',
    left: { op: 'pick', list: [5, 8, 12, 90, 150], index: W }, op: '<=', right: 20, hint: '…', fail: '…', pass: '…' },
],
```

Rules: 1–5 knobs, 2–6 gauges (`label` ≤ 32), every gauge must reference a knob, `hint`/`fail`/`pass` required. The validator **searches every knob combination** (up to 2M) and fails if none satisfies all gauges, or if the initial values already do; it prints how many settings pass. Aim for few solutions (1–5) so the puzzle forces real trade-offs; keep slider steps coarse (≤ ~50 positions). Numbers in formulas must come from the lesson (or be clearly labelled scenario numbers in the brief / node subs). Example: `topics/ds-consistency.ts`.

## Mode 6: `route` — "Route it"

A request, message or query travels **hop by hop** through a directed system graph. The packet sits on a node (a pulsing accent ring with a `PACKET` badge). Every outgoing wire becomes a numbered choice: the neighbour nodes turn into dashed accent buttons, and the same hops appear as buttons under the board (keys `1`–`4` work too). A **right** hop glides the packet along the wire and leaves a green trail. A **wrong** hop runs the packet halfway out, where it fizzles (red spark) and springs back. The wire stays red and dotted, the node is marked ✗, and the feedback panel shows that packet's explanation for the hop. A node with a single outgoing wire is crossed automatically. Several packets play in order, each with its own caption ("Packet 2 of 4: Balance shown right after the top-up"). After each delivery the learner presses "Send packet N" to continue. A wrong hop is a miss, and the same wrong hop can't be taken twice. A hint lights up the right next hop.

```ts
{
  mode: 'route',
  id: 'wallet-read-routing',
  tab: 'Route the queries',
  title: 'Wallet: send every query to the right copy',
  brief: 'A wallet API runs on one primary and two async replicas, and Replica B is 8 s behind while a backfill runs. Steer each query so …',
  cols: 4,
  rows: 3.3,
  nodes: [
    { id: 'api', label: 'Wallet API', sub: 'NestJS', kind: 'terminal', col: 0, row: 0.9 },
    { id: 'router', label: 'Read router', sub: 'compares replay LSNs', col: 1.5, row: 1.95 },
    { id: 'primary', label: 'Primary', sub: 'all writes · WAL', col: 3, row: 0.05 },
    { id: 'ra', label: 'Replica A', sub: 'replayed to 3/A1C0', col: 3, row: 1.2 },
    { id: 'rb', label: 'Replica B', sub: '8 s behind · 3/9F00', col: 3, row: 2.35 },
  ],
  edges: [['api', 'primary', 'writer'], ['api', 'router', 'reader'], ['router', 'primary', 'fallback'], ['router', 'ra'], ['router', 'rb']],
  packets: [
    {
      id: 'topup',
      label: 'Top-up ₹500: UPDATE … RETURNING',      // ≤ 44
      sub: 'a write',                                 // ≤ 44, mono
      from: 'api',
      paths: [['api', 'primary']],                    // acceptable routes, most preferred first
      wrong: {                                        // EVERY wrong hop offered at a junction on the way
        'api>router': 'The reader pool is for SELECTs outside a transaction. Replicas are read-only …',
      },
      done: 'All writes go to the one primary. It returns the new balance and the commit LSN …',
    },
    {
      id: 'read-after',
      label: 'Balance shown right after the top-up',
      sub: 'carries token LSN 3/A1B2',
      from: 'api',
      paths: [['api', 'router', 'ra']],
      wrong: {
        'api>primary': 'Reading your own data from the primary is correct, but …',
        'router>rb': 'Replica B has only replayed up to 3/9F00, behind the token 3/A1B2 …',
        'router>primary': 'The primary is the fallback for when no replica has replayed the token yet …',
      },
      right: { 'api>router': 'Display reads go through the router.' }, // optional note on a right hop
      done: 'Replica A’s replay LSN is at or past the token, so it already contains the top-up.',
    },
  ],
  // optional HUD: accumulates per packet, with "+n" chips floating off each wire as the packet crosses it
  // meter: { label: 'Latency', unit: ' ms', costs: { 'api>router': 1, 'router>ra': 2 }, budget: 50 },
  why: ['…', '…'],
}
```

Rules and what the validator checks:

- Nodes need `label`. Edges are **directed** (`from → to`). Board and layout checks are the same as for flow, on desktop, tablet and phone, with 10px kept free above each node for the hop number and packet badges.
- 1–4 packets, unique ids. `label`/`sub` ≤ 44 characters, and `done` is required.
- `paths`: each one starts at `from`, uses only existing wires, never visits a node twice, and is not a prefix of another path (the packet would stop early). Use several paths only when more than one route is genuinely right.
- `to` is optional. When set, the board shows a goal flag and every path must end there. Leave it out when choosing the destination *is* the puzzle, as with the read packets above.
- At every junction the packet passes along an acceptable route: 2–4 outgoing wires, at least one of them acceptable, no dead ends, and **every wrong hop has a `wrong['a>b']` explanation**. A `wrong` key that isn't a wire, or that names a hop on an acceptable path, is an error. A `wrong` key the packet never meets is a warning.
- Each packet needs at least one real decision (a junction with 2+ wires).
- `meter`: `costs` keys must be wires, values ≥ 0, and every acceptable path must stay within `budget`.
- The engine must accept the first path hop by hop and report arrival only at its end.

Write `wrong` / `right` / `done` as full sentences that teach: say what would actually happen ("it would show the balance from before the top-up"), not just "wrong". Put the facts the learner needs into node `sub`s and packet `sub`s (replica LSNs, lag, the token), so a reader of the lesson can work out the answer. Good fits: read/write routing (primary vs replica, read-your-writes), cache-aside read vs write paths, request paths through CDN → LB → service → cache → DB, message routing (topic, partition, DLQ), auth flows (which service validates what), multi-region routing, and failure paths (where a request goes when a dependency is down).

## Mode 7: `spike` — "Survive the spike"

A short, deterministic **traffic simulation**. The board shows the system. Each box with a `capacity` has a utilisation badge and a pressure bar, and heats up from green to amber to throbbing red as it saturates. Above the board are the goal chips. Under it is a live chart: a traffic lane (with the planned curve dotted ahead of the playhead and amber bands for bursts), then one lane per goal with its limit as a dashed red line over a red danger zone.

The learner installs **capacity cards**: tap one (it toggles), or drag it onto the diagram. Installed cards appear in the "Installed" rail and as a `+n` badge on their node, and are removed by tapping them or dragging them back to the tray. Then they press **Run the spike**. The run animates the whole timeline in about 8 s (2× and Instant speeds are available; with reduced motion it is always instant). Cards can still change mid-run, and each change applies from that tick on. Afterwards an end report lists each goal's peak and when it first broke, plus every box's peak utilisation. A failed run is a **miss**, and the feedback names the first goal that broke, when, by how much, and the hottest box at that moment. All goals must hold at every tick to win. A hint points at an installed card that doesn't belong, or else the next card of the intended solution.

```ts
{
  mode: 'spike',
  id: 'viral-product-spike',
  tab: 'Survive the spike',
  title: 'A product goes viral: survive the next minute',
  brief: 'A celebrity posts product 42. Reads of its single cache key climb from 20K to 300K per second, and at second 6 the key’s TTL runs out. You can make two changes. Keep p99 ≤ 100 ms and errors ≤ 1% …',
  cols: 4,
  rows: 2,
  nodes: [
    { id: 'users', label: 'Shoppers', sub: 'GET /product/42', kind: 'terminal', col: 0, row: 0.5 },
    { id: 'api', label: 'API pods × 60', sub: 'cache-aside reads', col: 1.3, row: 0.5, share: 1, ms: 5 },
    { id: 'redis', label: 'Redis shard', sub: 'one key = one shard', col: 2.9, row: 0,
      share: 1, capacity: 100000, unit: 'ops/s', ms: 1, timeoutMs: 50 },
    { id: 'db', label: 'Postgres', sub: 'other pages: 1K q/s', col: 2.9, row: 1.05,
      capacity: 3000, unit: 'q/s', base: 1000, ms: 10, timeoutMs: 1000 },
  ],
  edges: [['users', 'api'], ['api', 'redis', 'GET'], ['api', 'db', 'on miss']],
  duration: 60,                                       // simulated seconds
  step: 2,                                            // tick size → 31 ticks (10–61 allowed)
  traffic: [[0, 20000], [10, 20000], [40, 300000], [60, 300000]],   // [second, offered rps], linear between
  bursts: [{ node: 'db', from: 6, to: 8, add: 4000, label: 'key expires' }],  // stampede: [from, to)
  maxCards: 2,                                        // optional: at most this many installed at once
  cards: [
    { id: 'single-flight', label: 'Single-flight per pod', sub: 'coalesce concurrent misses', node: 'api',
      effects: [{ node: 'db', load: 0.015 }],          // 4,000 identical recomputes → ~60
      is: 'request coalescing: concurrent misses on a pod share one in-flight query, so …' },
    { id: 'l1', label: 'L1 in-process cache', sub: '2 s TTL in every pod', node: 'api',
      effects: [{ node: 'redis', load: 0.0001 }],      // 300K Redis reads/s → ~30
      is: 'a short-TTL copy inside each pod: 60 pods × 1 fetch per 2 s is 30 Redis reads/s instead of 300K' },
    { id: 'shards', label: 'Add 4 Redis shards', sub: 'cluster 1 → 5 shards', node: 'redis', decoy: true,
      effects: [], is: 'more shards for a one-key problem: a key maps to one slot on one shard, so …' },
    { id: 'retry', label: 'Retry Redis 3× on timeout', sub: 'maxRetriesPerRequest: 3', node: 'api', decoy: true,
      effects: [{ node: 'redis', load: 2 }], is: 'a load amplifier: every timed-out read is sent again …' },
  ],
  goals: [
    { metric: 'p99', max: 100, label: 'p99 ≤ 100 ms', fail: 'Enough requests are waiting on a saturated box that the slowest 1% hit its timeout.' },
    { metric: 'errors', max: 1, label: 'Errors ≤ 1%', fail: 'A box is past its capacity, and every request beyond it fails.' },
  ],
  why: ['…', '…'],
}
```

**The model** (`spikeSample` in `logic.ts`, pure, no `eval`). It is computed for each tick `t` with the cards installed at that tick:

| quantity | formula |
|---|---|
| admitted rps | offered rps × Π (1 − `shed`) of installed shed effects |
| request-driven load on a node | (admitted × `share` + active bursts' `add`) × Π card `load` factors on that node |
| load | request-driven load + `base` (background load, untouched by cards) |
| utilisation u | load ÷ (`capacity` × Π card `capacity` factors); nodes without `capacity` never saturate |
| node latency | (`ms` + card `ms`) ÷ (1 − u), at most 10× while u < 1; `timeoutMs` (default 20 × ms) once u ≥ 1 |
| **p99** | sum of the latencies of nodes that ≥ 1% of requests wait on (request-driven load ÷ admitted ≥ 0.01). So a miss path only enters the p99 when more than 1% of requests take it. |
| **errors** | Σ over nodes of max(0, load − capacity) ÷ offered rps, as % |
| **shed** | % of offered traffic rejected at the edge by shed effects (not counted as errors) |
| **cost** | Σ installed cards' `cost` |
| **util:\<node\>** | that node's u as % |

Effects: `{ node, load: f }` multiplies the request-driven load (caching, coalescing; `> 1` amplifies, e.g. retries), `{ node, capacity: f }` multiplies capacity (replicas, a bigger box; `< 1` models contention), `{ node, ms: n }` adds service time, and `{ shed: 0.2 }` rejects 20% at the edge (a rate limiter or load shedder). A card may have several effects; a decoy may have none.

Rules and what the validator checks:

- Nodes need `label`. At least one node has a `capacity` and at least one has `share > 0`. Numeric fields must be ≥ 0, `unit` ≤ 10 characters. Layout checks match the other boards, with 10px kept free above nodes for the badges.
- `duration / step + 1` must give 10–61 ticks. `traffic` starts at 0, ends at `duration` and is in time order. Bursts sit inside the run, cover at least one tick, and have `add > 0` and a `label` ≤ 18.
- 3–8 cards with unique ids and labels. Each card's `node` and every effect's `node` must exist. A `capacity` effect needs a node that has a capacity, and `shed` must be in (0, 1). A non-decoy card needs an effect. There must be 1–3 decoys, and `maxCards` (optional) must be an integer.
- 1–4 goals. `metric` is `p99`, `errors`, `shed`, `cost` or `util:<node with capacity>`, and `max` is a number. `label` ≤ 24 characters and `fail` is required.
- **The simulation is searched**: every card set (≤ `maxCards`, at most 256) is run. With no cards it must fail. Some set must pass. No decoy passes on its own. Some minimal passing set must use no decoys. A non-decoy card used by no minimal passing set is a warning, and more than 6 passing sets is a warning (tighten with `maxCards`). A goal already broken at t = 0 with no cards is a warning (the spike should be visible). The validator prints the passing sets and when the empty set first breaks.

Design tips: make the problems break **at different times**. In the example, the stampede breaks things at 6 s, and once that is fixed the hot shard breaks them at 20 s, so each run teaches one thing. Use lesson numbers for capacities and factors, and put scenario numbers in the brief or in node subs. Make decoys plausible and visible in the chart: a retry storm should break things *sooner*, and more shards should change nothing. Good fits: cache stampede / hot keys / avalanche, flash sales (queue, rate limit, admission tokens), read-heavy scaling (replicas, cache, CDN), connection-pool exhaustion, retry storms (backoff, circuit breakers), load shedding, autoscaling lag, and fan-out on write.

## Writing guidelines

- **5 puzzles per topic, at least 4 different modes, including `route` or `spike`.** Pick the mode that matches the topic's shape:

  | the topic is about … | mode |
  |---|---|
  | an architecture: which component goes where | `flow` |
  | a protocol, lifecycle or runbook: what happens in which order | `sequence` |
  | failure modes and misconfigurations: spot what's wrong | `fault` |
  | a catalogue of patterns: symptom ↔ fix, requirement ↔ tech | `match` |
  | a quantitative trade-off with a closed form (quorums, sizing, SLO math, cost) | `tune` |
  | **where a request / message / query must go**, and why the other paths are wrong (read/write routing, cache paths, consistency guarantees, failover paths) | `route` |
  | **behaviour under load over time**: what saturates first and which capacity fix helps (stampedes, hot keys, flash sales, retry storms, shedding) | `spike` |

  `route` and `spike` are different in feel from the others: route is a step-by-step journey with immediate per-hop feedback, and spike is a plan-then-run experiment judged over a timeline. Reusing modes across topics is fine; within a topic, vary.
- **Accuracy beats cleverness.** Every claim, label and number must match the topic's lesson. If the lesson says "TTL jitter spreads expiries over ~12 minutes", don't invent "30 seconds".
- **Decoys must be plausible**: something a mid-level candidate might really propose (a batch job, a fire-and-forget queue, more retries, a bigger box), and their `is` must teach why it fails *here*.
- **Clues describe the job, never the name** of the answer.
- **The brief sets pressure** (scale, failure, SLO) that justifies each piece; `why` pays it off, one line per key decision.
- Keep text short: the board must work at 360px. Run the validator: it enforces lengths and geometry.
- Plain English, no emojis, no marketing tone. Use `→`, `×`, `≤` as the lessons do.

## Behaviour reference (for reviewers)

- Input (`ui/useDrag.ts`): pointer drag (mouse, pen, touch) with a ghost card (floats above the finger on touch); tap a card then a target; keyboard Enter/Space to pick up and drop, Esc to put back. Feedback is in an `aria-live` region.
  - Drag sources carry `touch-action: none` (plus no long-press callout / text selection), so a touch drag is never turned into a page scroll; swipes anywhere else still scroll. A press becomes a drag after 5px (mouse) / 8px (touch); less is a tap.
  - Moves and the release are tracked on `window` for the gesture's pointer id (pointer capture is requested but not relied on), so drags work even when the browser re-targets capture or the events are synthetic; `pointercancel` / window `blur` cancel the gesture and a non-passive `touchmove` handler blocks scrolling while dragging.
  - Auto-scroll while dragging near the top / bottom of the **usable** viewport, i.e. inside the fixed header and the floating phone tab bar (detected at drag start), so targets above or below the screen come into reach; the target under a still finger is re-evaluated as the page scrolls.
  - Match mode: drag from the item or its socket to a right item (or tap left, then right).
- Progress: `Progress.challenges['<topic>/<puzzle id>'] = { stars, plays, firstAt }` (best stars kept). Optional field: old saves load; Settings → reset clears it; it does not affect topic completion, percentages or achievements.
- Route: hop by tap / click on a numbered node, the hop buttons, or keys `1`–`4` while focus is inside the puzzle. Keyboard focus stays in the hop bar as the packet moves. The packet animation is a small requestAnimationFrame loop along the wire's drawn geometry (`Board`'s `overlay` prop); with reduced motion each hop applies instantly.
- Spike: cards are toggle buttons (`aria-pressed`) that can also be dragged onto the diagram (`data-drop="board"`) or back to the tray. The run uses `setInterval` over the tick list (≈ 8 s at 1×); Instant (forced with reduced motion) computes the whole run at once. The chart is `role="img"` with a summary label; per-tick numbers are hidden from screen readers, and the end result is announced in the feedback region.
- `Board` extras (used by route / spike): edge `state` (`idle`, `cand`, `trail`, `nope`, `fizz`, `run`, `hot`) replaces the broken/live look, node `style` (e.g. `--heat`), and `overlay(wires)` draws extra SVG with each wire's clipped geometry keyed `'from>to'`.
- Completion fires the app's `celebrate()` (toast + confetti, skipped with reduced motion). Reduced motion removes packets and all animation; layout and feedback are unchanged.
