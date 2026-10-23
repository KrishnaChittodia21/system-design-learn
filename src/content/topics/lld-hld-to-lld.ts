import type { Topic } from '../../types';

const topic: Topic = {
  id: 'lld-hld-to-lld',
  phase: 'lld',
  order: 1,
  title: 'From HLD to LLD: The Bridge & The Machine-Coding Round',
  subtitle:
    'How HLD and LLD rounds differ and connect, the requirements → entities → class diagram → interfaces → patterns → concurrency → extensibility flow, a URL shortener taken from boxes to TypeScript classes, and how Indian product companies run and score 60–90 minute machine-coding rounds.',
  estimatedMinutes: 95,
  sources: [
    'Flipkart SDE-2 interview experience (Jan 2026, machine coding: BNPL system + viva) — leetcode.com/discuss/post/8455829',
    'Jobrise — Indian Unicorn Interviews: Flipkart, Meesho, Zomato, Razorpay Hiring Guide (2026)',
    'PhonePe Backend Software Engineer (3–5 yrs) interview experience — machine coding "Customer Issue Resolution", 90 min — leetcode.com/discuss/post/7539137',
    'Swiggy SDE-2 interview experience (LLD / machine coding) — leetcode.com/discuss/post/8314817; TechPrep — Swiggy Interview Process (2026)',
    'Atlassian P40 Bangalore interview experience (code design round: snake game / rate limiter) — leetcode.com/discuss/interview-experience/7196860',
    'DesignGurus — What is the Swiggy interview process like (round by round)',
    'Robert C. Martin — Clean Architecture (dependency rule, boundaries)',
  ],
  tags: ['lld', 'machine-coding', 'hld-to-lld', 'class-diagram', 'interfaces', 'url-shortener', 'repository-pattern', 'interview-strategy', 'typescript'],
  cheatSheet: [
    'HLD answers "which boxes and why"; LLD answers "which classes, which interfaces, which invariants, which locks" inside ONE box. Machine coding = LLD that must compile, run and demo.',
    'Flow: requirements → API/use-cases → core entities (nouns→classes, verbs→methods) → class diagram → interfaces at the seams → patterns where variation exists → concurrency → extensibility.',
    'Go deep on the component with the most rules + state + variation (ID generation, dispatcher, allocator, pricing) — never on a thin CRUD proxy or on infra you would buy (Kafka, Redis).',
    'Seams = interfaces for anything that varies or is slow/non-deterministic: repository, ID/code generator, clock, notifier/channel, pricing/eviction strategy.',
    'In-memory repositories behind an interface are expected in machine coding — but give them the semantics the real store would (atomic putIfAbsent ≈ UNIQUE constraint, version check ≈ optimistic lock).',
    'Node is single-threaded but NOT race-free: any check-then-act spanning an await interleaves; across pods you need DB constraints/Redis atomics. Java: ConcurrentHashMap.putIfAbsent, ReentrantLock, AtomicLong.',
    '90-min plan: 10 clarify+entities, 10 diagram+interfaces, 45 core happy path end-to-end, 15 edge cases+concurrency, 10 demo+tests. Working end-to-end at minute 60 beats perfect half-code.',
    'Evaluators score: functional completeness → runs/demo → modularity (SRP, layering) → extensibility (new type = new class, not new if) → testability (DI) → concurrency/edge handling → naming. Then a viva on your own code.',
    'Stub: persistence, network, auth, UI, real providers. Never stub: the core domain rules the problem is about (allocation, splitting, pricing, state transitions).',
    'Classic mistakes: coding before entities, god service with Maps everywhere, if/else on type strings, Date.now()/Math.random() hard-wired, patterns for show, no driver/demo, silent console-only errors.',
  ],
  sections: [
    {
      heading: '1. Two rounds, one system: HLD vs LLD vs machine coding',
      body: `**Intuition:** HLD is the city map — where the roads, power plants and warehouses go. LLD is the floor plan of one building — which rooms, which doors, which locks. Machine coding is actually building that floor plan in 90 minutes and turning the lights on in front of the inspector.

Indian product companies increasingly split these: Flipkart, Swiggy, PhonePe, Razorpay, Meesho and Uber India run a **machine-coding round** (60–120 min, you write runnable code on your laptop, then a viva on it), and many also run a separate **HLD round** for SDE-2+ and a whiteboard-style **LLD round** (class diagram + key code, 45–60 min). Atlassian calls its version a "code design" round — small, real-world problems (rate limiter, snake game, popularity tracker) judged on structure and extensibility.

| Dimension | HLD round | LLD (whiteboard) | Machine coding |
|---|---|---|---|
| Unit of design | services, stores, queues | classes, interfaces, methods | runnable modules |
| Key artefact | box diagram + API + data model | class diagram + signatures | working code + demo |
| Scale talk | QPS, shards, replicas, caches | rarely (but "what if multi-pod?") | almost never — in-memory |
| Concurrency | distributed: idempotency, locks, consistency | in-process: mutex, atomic ops, races | must not double-book in your own code |
| Typical fail | no numbers, no trade-offs | god classes, no patterns, no invariants | doesn't run, no extensibility |
| Time | 45–60 min | 45–60 min | 60–120 min + 15–30 min viva |

**What connects them:** every LLD lives inside an HLD box. The HLD tells you *which* box matters, what its API is, and which non-functional requirements leak into the code (an idempotency key in HLD becomes an \`IdempotencyStore\` interface in LLD; "p99 < 10 ms" means no synchronous analytics call in the redirect path).

**In interviews say this:** "Let me spend two minutes on the HLD so we agree where this component sits and what it talks to — then I'll go deep on its classes."`,
      keyPoints: [
        'Machine coding = runnable LLD + viva; LLD whiteboard = diagram + signatures + key methods.',
        'HLD decides WHICH component to deep-dive and which NFRs leak into the class design.',
        'Atlassian "code design", Flipkart/Swiggy/PhonePe "machine coding", Uber "LLD/coding" — same skills, different weights.',
      ],
    },
    {
      heading: '2. The HLD-first → LLD flow (the 8 steps you narrate)',
      body: `**Intuition:** zoom in one level at a time. You never jump from "a URL shortener" to \`class Base62\` — you walk down a ladder and say each rung out loud, so the interviewer can steer early.

1. **Requirements** — functional (create short link, redirect, custom alias, expiry), non-functional (latency, read-heavy, uniqueness), and explicit *out of scope*.
2. **API / use cases** — the 3–6 operations the component exposes. These become public methods of your service class.
3. **Core entities** — nouns become classes (\`ShortLink\`, \`User\`, \`ClickEvent\`), verbs become methods (\`shorten\`, \`resolve\`, \`expire\`). Distinguish entities (identity) from value objects (\`ShortCode\`, \`Url\`).
4. **Class diagram** — relationships with UML-ish notation and multiplicity; who *owns* whom.
5. **Interfaces at the seams** — wherever something varies (generation strategy, channel) or is slow/non-deterministic (DB, clock, random, network).
6. **Patterns** — only where there is variation: Strategy for generation, Repository for storage, Observer for click analytics, Factory for channel creation. Name *why*.
7. **Concurrency** — what can race (two users claiming one alias; two pods allocating the same counter value) and how you prevent it in-process and across pods.
8. **Extensibility** — rehearse 2–3 follow-ups ("add expiry", "add analytics", "add custom domains") and show they are additive changes.`,
      diagram: `  REQUIREMENTS ──> API/USE CASES ──> ENTITIES ──> CLASS DIAGRAM
  (FR, NFR, scope)  (public methods)  (nouns/verbs)  (<>-- ^ ..> 1..*)
                                                        │
                                                        v
  EXTENSIBILITY <── CONCURRENCY <── PATTERNS <── INTERFACES (seams)
  (new type =       (check-then-act, (why each)    (repo, clock,
   new class)        atomic, locks)                 strategy, notifier)

  Time on a 45-60 min LLD whiteboard:
  [req 5][api+entities 8][diagram 10][interfaces+code 15][conc 7][ext 5]`,
      keyPoints: [
        'Narrate each rung — interviewers steer early and reward structure.',
        'Public methods of the service come straight from the use cases.',
        'Patterns follow variation; never lead with a pattern name.',
      ],
    },
    {
      heading: '3. Reading an HLD and choosing what to go deep on',
      body: `**Intuition:** in an HLD with eight boxes, five are plumbing (gateway, load balancer, cache, queue, DB). The interviewer wants the box with *business rules and state* — that's where class design shows.

**Selection heuristic — score each component on:**

| Criterion | Question to ask | Example winner |
|---|---|---|
| Rule density | Are there non-trivial business rules / invariants? | slot allocator, fare calculator |
| State transitions | Does an object move through a lifecycle? | order, payment, ride, elevator |
| Variation | Will new types/strategies be added? | notification channels, pricing |
| Concurrency | Can two actors contend for the same thing? | seat booking, alias claim, inventory |
| Ownership | Is it *ours* (not bought infra)? | dispatcher, not Kafka |

**URL shortener HLD:** API gateway → Shortening service → ID generator → KV store → Redirect service (+ cache) → Analytics pipeline. Go deep on **Shortening service + code generation**: it has rules (alias validity, reserved words, expiry), variation (counter vs random vs hash), and a real race (custom alias claims). The redirect path is a thin cache-aside read — mention it, don't model it.

**Notification service HLD:** Ingest API → Preference/Template service → Dispatcher → Channel workers (email/SMS/push) → Provider adapters → Status tracker. Go deep on the **Dispatcher + channels**: preferences, quiet hours, rate limiting per user, retry policy, provider failover — lots of Strategy/Chain-of-Responsibility material.

**Say it explicitly:** "I'll go deep on X because it holds the invariants and the extension points; Y and Z are infra I'd treat as interfaces."`,
      keyPoints: [
        'Pick the component with the most rules, state, variation and contention.',
        'Treat bought infrastructure (Kafka, Redis, S3) as interfaces, not classes to design.',
        'State your choice and reason — interviewers grade the judgement itself.',
      ],
    },
    {
      heading: '4. Worked example (1/3): URL shortener — requirements, HLD slice, entities',
      body: `**Requirements (agreed in 3 minutes):**

- FR: \`shorten(longUrl, opts?)\` → short code; optional **custom alias**; optional **expiry**; \`resolve(code)\` → long URL or not-found/expired; per-user listing; click counting.
- NFR: codes 7 chars base62 (62^7 ≈ 3.5 × 10^12), resolve must be fast (no extra I/O in the hot path), aliases globally unique, same long URL by different users → different codes (no dedup across users).
- Out of scope: auth, UI, abuse/malware scanning, custom domains (kept as extension).

**HLD slice we are designing:** the \`ShorteningService\` box, which talks to an \`IdGenerator\` (in HLD: a counter service handing out ranges) and a \`LinkStore\` (in HLD: a KV store with conditional put).

**Entities and value objects:**

- \`ShortLink\` (entity — identity is the code): code, targetUrl, ownerId, createdAt, expiresAt?, isCustom.
- \`ShortCode\` (value object): validated base62 string, length 4–30, not reserved.
- \`TargetUrl\` (value object): parsed, http/https only, normalised.
- \`ClickEvent\` (value object, emitted, not stored by this service).

**Verbs → methods:** \`shorten\` and \`resolve\` on the service; \`isExpired(now)\` on \`ShortLink\` (behaviour lives with data); \`next()\` on \`CodeGenerator\`; \`insertIfAbsent\` on \`LinkRepository\`.`,
      diagram: `   Client
     │ POST /links           GET /:code
     v                          v
 ┌───────────────────┐   ┌──────────────┐
 │ ShorteningService │   │ RedirectSvc  │──> cache ──> LinkStore
 │  (DEEP DIVE)      │   └──────┬───────┘
 └──┬─────────┬──────┘          │ click events (async)
    │         │                 v
    v         v            Analytics pipeline
 IdGenerator  LinkStore (KV, conditional put)
 (ranges)`,
    },
    {
      heading: '5. Worked example (2/3): class diagram and interfaces',
      body: `**Intuition:** interfaces go exactly where the HLD had arrows to other boxes (store, ID generator, analytics) and where tests need control (clock).

Notation used across this phase: \`<>--\` composition (owner controls lifecycle), \`o--\` aggregation, \`-->\` association, \`..>\` dependency (uses transiently), \`..|>\` realization (implements), \`^\` inheritance.

Design choices to *say out loud*:

- \`ShorteningService\` depends only on interfaces (DIP) — it does not know whether storage is a \`Map\`, Postgres or DynamoDB.
- **Strategy** for \`CodeGenerator\`: counter+base62 (no collisions, guessable), random (unguessable, needs collision retry), hash(url+user) (deterministic). The product can pick per tenant.
- **Repository** with \`insertIfAbsent\` — the atomic primitive that makes custom aliases safe. Its contract mirrors a DB \`UNIQUE\` constraint / DynamoDB \`attribute_not_exists\`.
- **Observer** (\`LinkEventListener\`) for click analytics so the redirect path never blocks on analytics.
- **Clock** injected so expiry is testable without sleeping.`,
      diagram: `            ┌──────────────────────┐
            │  ShorteningService   │
            │ +shorten(cmd)        │
            │ +resolve(code)       │
            └──┬────┬─────┬─────┬──┘
     ..>       │    │     │     │        ..>
 ┌─────────────v┐ ┌─v─────v──┐ ┌v──────────────┐
 │<<interface>> │ │<<iface>> │ │<<interface>>  │
 │CodeGenerator │ │ Clock    │ │LinkRepository │
 │+next():string│ │+now()    │ │+insertIfAbsent│
 └──^────────^──┘ └──────────┘ │+findByCode    │
    :        :                 └──^─────────^──┘
 Counter   Random                 :         :
 Base62Gen  Gen (retry)     InMemoryRepo  PgRepo
                                  │
                                  │ 0..* (<>-- owns)
                             ┌────v─────┐  <>-- ShortCode (VO)
                             │ShortLink │  <>-- TargetUrl (VO)
                             └──────────┘`,
      code: [
        {
          language: 'typescript',
          title: 'domain.ts — entities, value objects and the seams',
          code: `export class ShortCode {
  private static readonly RE = /^[0-9A-Za-z_-]{4,30}$/;
  private static readonly RESERVED = new Set(['api', 'admin', 'login', 'health']);
  private constructor(readonly value: string) {}

  static of(raw: string): ShortCode {
    if (!ShortCode.RE.test(raw)) throw new InvalidAliasError(raw, 'format');
    if (ShortCode.RESERVED.has(raw.toLowerCase())) throw new InvalidAliasError(raw, 'reserved');
    return new ShortCode(raw);
  }
}

export class TargetUrl {
  private constructor(readonly href: string) {}
  static of(raw: string): TargetUrl {
    const u = new URL(raw); // throws on garbage
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('unsupported scheme');
    u.hash = ''; // fragments never reach the server anyway
    return new TargetUrl(u.toString());
  }
}

export class ShortLink {
  constructor(
    readonly code: ShortCode,
    readonly target: TargetUrl,
    readonly ownerId: string,
    readonly createdAt: Date,
    readonly expiresAt: Date | null,
    readonly isCustom: boolean,
  ) {}

  isExpired(now: Date): boolean {
    return this.expiresAt !== null && now >= this.expiresAt; // behaviour lives with data
  }
}

export class InvalidAliasError extends Error {
  constructor(readonly alias: string, readonly reason: 'format' | 'reserved' | 'taken') {
    super('alias ' + alias + ' rejected: ' + reason);
  }
}

// ---- seams (one per HLD arrow + one for time) ----
export interface CodeGenerator { next(): Promise<string>; }
export interface Clock { now(): Date; }
export interface LinkRepository {
  /** atomic: returns false if the code already exists (≈ UNIQUE constraint) */
  insertIfAbsent(link: ShortLink): Promise<boolean>;
  findByCode(code: string): Promise<ShortLink | null>;
  findByOwner(ownerId: string, limit: number): Promise<ShortLink[]>;
}
export interface LinkEventListener { onResolved(link: ShortLink, at: Date): void; }`,
        },
      ],
    },
    {
      heading: '6. Worked example (3/3): the service, strategies and an in-memory repository',
      body: `**Intuition:** the service is a thin orchestrator; the rules live in value objects and the atomic guarantee lives in the repository contract.

Things an evaluator notices in this code:

- **No check-then-act on the alias.** A naive \`if (!(await repo.find(alias))) await repo.save(...)\` races across the \`await\` — two requests both see "free". \`insertIfAbsent\` makes the check and the write one step.
- **Collision retry is bounded** (random generator): 5 attempts, then fail loudly — never an unbounded loop.
- **Listeners are fire-and-forget and isolated** — a throwing analytics listener cannot break a redirect.
- **The in-memory repo is synchronous inside** — in Node, code with no \`await\` between check and set cannot interleave, so \`insertIfAbsent\` is atomic within one process. That is exactly the guarantee a DB unique index gives across processes.`,
      code: [
        {
          language: 'typescript',
          title: 'shortening.service.ts — orchestrator + generator strategies + in-memory repo',
          code: `import { randomInt } from 'node:crypto';
import { ShortCode, TargetUrl, ShortLink, InvalidAliasError } from './domain';
import type { CodeGenerator, Clock, LinkRepository, LinkEventListener } from './domain';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class CounterBase62Generator implements CodeGenerator {
  constructor(private readonly nextId: () => Promise<bigint>) {} // e.g. leased ID range
  async next(): Promise<string> {
    let n = await this.nextId();
    let s = '';
    do { s = ALPHABET[Number(n % 62n)] + s; n /= 62n; } while (n > 0n);
    return s.padStart(7, '0');
  }
}

export class RandomGenerator implements CodeGenerator {
  async next(): Promise<string> {
    let s = '';
    for (let i = 0; i < 7; i++) s += ALPHABET[randomInt(62)]; // CSPRNG: unguessable
    return s;
  }
}

export interface ShortenCommand { url: string; ownerId: string; alias?: string; ttlSeconds?: number; }

export class ShorteningService {
  private static readonly MAX_ATTEMPTS = 5;
  constructor(
    private readonly repo: LinkRepository,
    private readonly generator: CodeGenerator,
    private readonly clock: Clock,
    private readonly listeners: LinkEventListener[] = [],
  ) {}

  async shorten(cmd: ShortenCommand): Promise<ShortLink> {
    const target = TargetUrl.of(cmd.url);
    const now = this.clock.now();
    const expiresAt = cmd.ttlSeconds ? new Date(now.getTime() + cmd.ttlSeconds * 1000) : null;

    if (cmd.alias) {
      const link = new ShortLink(ShortCode.of(cmd.alias), target, cmd.ownerId, now, expiresAt, true);
      if (!(await this.repo.insertIfAbsent(link))) throw new InvalidAliasError(cmd.alias, 'taken');
      return link;
    }
    for (let i = 0; i < ShorteningService.MAX_ATTEMPTS; i++) {
      const code = ShortCode.of(await this.generator.next());
      const link = new ShortLink(code, target, cmd.ownerId, now, expiresAt, false);
      if (await this.repo.insertIfAbsent(link)) return link; // collision → try again
    }
    throw new Error('code space congested: generator collided ' + ShorteningService.MAX_ATTEMPTS + ' times');
  }

  async resolve(code: string): Promise<ShortLink | null> {
    const link = await this.repo.findByCode(code);
    const now = this.clock.now();
    if (!link || link.isExpired(now)) return null;
    for (const l of this.listeners) {
      try { l.onResolved(link, now); } catch { /* analytics must never break redirects */ }
    }
    return link;
  }
}

export class InMemoryLinkRepository implements LinkRepository {
  private readonly byCode = new Map<string, ShortLink>();
  private readonly byOwner = new Map<string, ShortLink[]>();

  async insertIfAbsent(link: ShortLink): Promise<boolean> {
    // no await between check and set → atomic within one Node process
    if (this.byCode.has(link.code.value)) return false;
    this.byCode.set(link.code.value, link);
    const list = this.byOwner.get(link.ownerId) ?? [];
    list.push(link);
    this.byOwner.set(link.ownerId, list);
    return true;
  }
  async findByCode(code: string) { return this.byCode.get(code) ?? null; }
  async findByOwner(ownerId: string, limit: number) { return (this.byOwner.get(ownerId) ?? []).slice(-limit).reverse(); }
}`,
        },
      ],
    },
    {
      heading: '7. Concurrency in the LLD: one process, many pods, and the Java answer',
      body: `**Intuition:** "Node is single-threaded" means *one thing runs at a time*, not *nothing interleaves*. Every \`await\` is a door other requests walk through.

**Three levels interviewers probe:**

| Level | Race | Node answer | Java answer |
|---|---|---|---|
| Within one call stack (no await) | none | synchronous code is atomic | needs \`synchronized\` / \`ConcurrentHashMap.putIfAbsent\` — threads are real |
| Across awaits, one process | check-then-act on alias, counter read-modify-write | do check+set without awaiting, or a keyed async mutex | \`ReentrantLock\`, \`AtomicLong.incrementAndGet\` |
| Across pods / worker_threads | same alias on two pods, duplicate counter values | DB \`UNIQUE\` / conditional put, Redis \`INCR\`/\`SET NX\`, leased ID ranges | same — JVM locks do not cross processes |

**Leased ID ranges** (the HLD "ticket server" turned into a class): each pod asks the counter store for a block of 1,000 IDs (\`UPDATE counters SET next = next + 1000 RETURNING next\`), then hands them out locally. Store round-trips drop 1,000×, and two pods can never collide because their blocks are disjoint. If a pod dies, up to 999 IDs are wasted — fine at 3.5 × 10^12 code space.

**Keyed async mutex** when you truly need a multi-await critical section in-process (e.g. "check quota, then insert"): serialise per key, not globally.`,
      code: [
        {
          language: 'typescript',
          title: 'id-range.ts — leased ID ranges with a single in-flight refill',
          code: `export interface CounterStore {
  /** atomically reserves [start, start + size) — e.g. UPDATE ... RETURNING, or Redis INCRBY */
  reserve(name: string, size: number): Promise<bigint>;
}

export class LeasedIdAllocator {
  private next = 0n;
  private end = 0n;               // exclusive
  private refill: Promise<void> | null = null; // shared by concurrent callers

  constructor(private readonly store: CounterStore, private readonly blockSize = 1000) {}

  async nextId(): Promise<bigint> {
    while (this.next >= this.end) {
      // Without this guard, 200 concurrent callers hitting an empty block would
      // fire 200 reserve() calls and burn 200 blocks.
      this.refill ??= this.store.reserve('short_link', this.blockSize).then((start) => {
        this.next = start;
        this.end = start + BigInt(this.blockSize);
      }).finally(() => { this.refill = null; });
      await this.refill;
    }
    return this.next++; // synchronous after the loop → no interleaving
  }
}

// Java equivalent interviewers expect:
//   private final ReentrantLock lock = new ReentrantLock();
//   long nextId() { lock.lock(); try { if (next >= end) refill(); return next++; } finally { lock.unlock(); } }
// or an AtomicLong + CAS loop for the hot path, locking only for the refill.`,
        },
      ],
      keyPoints: [
        'Every await is an interleaving point — check-then-act across it is a race.',
        'In-process locks never protect you across pods; push atomicity into the store.',
        'Dedupe concurrent refills with a shared in-flight promise (single-flight).',
      ],
    },
    {
      heading: '8. Extensibility: follow-ups as additive changes (+ the notification-service variant)',
      body: `**Intuition:** extensibility is measured by *what you touch*. A good design answers a follow-up by adding a class and one line of wiring, not by editing five \`if\` chains.

**URL shortener follow-ups:**

| Follow-up | Change in this design |
|---|---|
| Click analytics | new \`LinkEventListener\` (Kafka publisher) — service untouched |
| Custom domains | \`ShortLink\` gains \`domain\`; repository key becomes (domain, code) — contract change, call it out |
| Unguessable codes for a bank tenant | inject \`RandomGenerator\` for that tenant via a \`GeneratorResolver\` |
| Password-protected links | a \`ResolvePolicy\` chain (expiry → password → geo) instead of more \`if\`s in \`resolve\` |
| Postgres instead of Map | new \`PgLinkRepository\` using \`INSERT ... ON CONFLICT DO NOTHING\` — same contract |

**Notification service — the same flow, compressed.** Entities: \`Notification\`, \`Recipient\`, \`Template\`, \`DeliveryAttempt\`. Seams: \`Channel\` (Strategy per email/SMS/push/WhatsApp), \`ProviderAdapter\` (Adapter over SendGrid/Twilio/FCM, with failover), \`PreferenceStore\`, \`RateLimiter\`, \`Clock\`. A \`ChannelRegistry\` (Factory/registry) maps a channel name to an implementation so "add WhatsApp" is one new class plus one registration. Concurrency: per-user rate limiting and de-duplication by idempotency key (\`insertIfAbsent\` again).`,
      code: [
        {
          language: 'typescript',
          title: 'dispatcher.ts — registry + strategy so a new channel is additive',
          code: `export type ChannelName = 'email' | 'sms' | 'push' | 'whatsapp';

export interface Channel {
  readonly name: ChannelName;
  send(to: Recipient, body: RenderedMessage): Promise<{ providerId: string }>;
}
export interface Recipient { userId: string; email?: string; phone?: string; deviceTokens: string[]; }
export interface RenderedMessage { subject?: string; text: string; }
export interface PreferenceStore { channelsFor(userId: string, category: string): Promise<ChannelName[]>; }
export interface IdempotencyStore { claim(key: string, ttlSeconds: number): Promise<boolean>; }

export class ChannelRegistry {
  private readonly channels = new Map<ChannelName, Channel>();
  register(c: Channel): this { this.channels.set(c.name, c); return this; }
  get(name: ChannelName): Channel {
    const c = this.channels.get(name);
    if (!c) throw new Error('no channel registered for ' + name);
    return c;
  }
}

export class Dispatcher {
  constructor(
    private readonly registry: ChannelRegistry,
    private readonly prefs: PreferenceStore,
    private readonly idem: IdempotencyStore,
  ) {}

  async dispatch(key: string, to: Recipient, category: string, msg: RenderedMessage) {
    if (!(await this.idem.claim(key, 86_400))) return { skipped: 'duplicate' as const };
    const names = await this.prefs.channelsFor(to.userId, category);
    // channels fail independently; one bad provider must not block the others
    const results = await Promise.allSettled(names.map((n) => this.registry.get(n).send(to, msg)));
    return { sent: names.filter((_, i) => results[i].status === 'fulfilled') };
  }
}`,
        },
      ],
    },
    {
      heading: '9. How machine-coding rounds are run and evaluated (2025–2026)',
      body: `**Intuition:** you are hired to write code your future teammates can extend on a Monday morning. The rubric is "does it work" first, "would I enjoy maintaining it" second.

**Typical format (from 2025–26 candidate reports):**

- **Flipkart:** 90 minutes, a detailed problem statement (recent: a BNPL system; classics: Splitwise, parking lot, ride sharing), your own IDE and language, input via a driver/commands, then a **viva on your own code** — justify every decision and extend it live. Candidates report "correct running code" is weighed above beautiful-but-incomplete code.
- **PhonePe:** 90 minutes, e.g. "Customer Issue Resolution" — agents, issue types and a pluggable **assignment strategy** (Strategy is the whole point of the problem).
- **Swiggy:** 90–120 minutes machine coding/LLD (inventory management for Instamart, expense sharing, parking lot); high bar on modularity even for SDE-1.
- **Razorpay:** machine coding for backend and frontend, with payment-domain flavour; expect idempotency and state-machine questions in the viva.
- **Atlassian:** 60-minute "code design" round — snake game (grow every nth food), rate limiter, popularity tracker — focused on clean abstractions and how easily a twist is absorbed.

**Evaluation rubric (what interviewers actually tick):**

| Criterion | What earns it | What loses it |
|---|---|---|
| Functional completeness | all must-have features work in the demo | half the features, or only happy path |
| Runs + demo | a driver that exercises scenarios incl. errors | "it compiles, trust me" |
| Modularity | entities / services / repositories / strategies separated | god class, Maps in main |
| Extensibility | twist absorbed by a new class | edit 5 if/else chains |
| Testability | DI, no hidden \`new\`, injectable clock/random | statics, singletons, Date.now() |
| Concurrency & edge cases | atomic ops, validation, explicit errors | silent failures, races |
| Code quality | names, small methods, typed errors | \`data\`, \`helper\`, 200-line methods |

Weights shift by level: SDE-1 is mostly completeness + modularity; SDE-2/3 adds extensibility, concurrency and the quality of the viva.`,
      source: 'Candidate reports: LeetCode Discuss (Flipkart Jan 2026, PhonePe, Swiggy SDE-2, Atlassian P40); Jobrise 2026 hiring guide; TechPrep Swiggy 2026',
    },
    {
      heading: '10. Time management, what to stub, and how to structure the project',
      body: `**Intuition:** the round is a delivery project with a hard deadline. Ship a vertical slice early, then widen.

**90-minute plan:**

- **0–10 min — clarify + entities.** Read twice, list must-haves vs nice-to-haves, confirm input/output format, write entities and the 3–6 operations as comments.
- **10–20 — skeleton.** Folders, interfaces, empty classes, the driver calling every operation with TODOs. It should *run* now.
- **20–65 — core features end-to-end**, one at a time, running the driver after each. By minute 60 every must-have works on the happy path.
- **65–80 — edges + concurrency:** validation, typed errors, the atomic operation, one extensibility hook.
- **80–90 — demo script + a few tests**, re-read names, delete dead code.

**Stub vs build:**

| Stub (interface + in-memory/fake) | Build for real |
|---|---|
| database, cache, queue | the domain rules (allocation, splitting, pricing, state machine) |
| HTTP/CLI framework (use a plain driver) | validation and error types |
| auth, payment gateways, SMS providers | the strategy the problem is about (assignment, eviction) |
| clock and randomness (inject, fake in demo) | atomicity guarantees in the repository contract |

**In-memory repositories** are expected, but don't let them be dumb Maps leaking everywhere: one class per aggregate, behind an interface, with the semantics a real store would have (unique keys, version checks, copies on read so callers can't mutate stored state).`,
      diagram: `src/
 ├─ domain/            entities + value objects + domain errors (no I/O)
 │   ├─ short-link.ts
 │   └─ errors.ts
 ├─ ports/             interfaces: LinkRepository, CodeGenerator, Clock
 ├─ services/          use-case orchestration (ShorteningService)
 ├─ strategies/        CounterBase62Generator, RandomGenerator
 ├─ infra/             InMemoryLinkRepository, SystemClock, FakeClock
 ├─ app.ts             composition root: wire implementations (DI)
 └─ main.ts            driver/demo: runs scenarios, prints results
test/
 └─ shortening.service.spec.ts`,
      keyPoints: [
        'Something runnable by minute 20; every must-have on the happy path by minute 60.',
        'Stub I/O, never the domain rules the problem is testing.',
        'One composition root wires everything — the only place that calls new on infra.',
      ],
    },
    {
      heading: '11. The demo, the tests and the viva',
      body: `**Intuition:** the demo is your closing argument. A scripted driver that shows happy path, edge cases and a concurrency scenario is worth more than ten extra features nobody saw.

**Demo checklist:** run every must-have; show at least two failure paths with clear typed errors ("alias taken", "expired"); show the twist being absorbed (swap a strategy in \`app.ts\`); fire concurrent requests at the contended operation and show exactly one winner.

**Tests in 10 minutes:** you won't get full coverage — test the rules: one invariant, one race, one strategy swap. Using \`node:test\` avoids setup time.

**Viva questions to rehearse:** "Why is this an interface?", "What changes for Postgres?", "What breaks with two pods?", "Add feature X now — show me where.", "What is the complexity of \`findByOwner\`?", "Why didn't you use inheritance here?"`,
      code: [
        {
          language: 'typescript',
          title: 'shortening.service.spec.ts — rules, race and time, with node:test',
          code: `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShorteningService, InMemoryLinkRepository, RandomGenerator } from '../src/services/shortening.service';
import type { Clock } from '../src/domain';

class FakeClock implements Clock {
  constructor(private t = new Date('2026-01-01T00:00:00Z')) {}
  now() { return new Date(this.t); }
  advance(ms: number) { this.t = new Date(this.t.getTime() + ms); }
}

test('exactly one of 50 concurrent claims on the same alias wins', async () => {
  const svc = new ShorteningService(new InMemoryLinkRepository(), new RandomGenerator(), new FakeClock());
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, (_, i) => svc.shorten({ url: 'https://a.com/' + i, ownerId: 'u' + i, alias: 'sale' })),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('link stops resolving exactly at expiry', async () => {
  const clock = new FakeClock();
  const svc = new ShorteningService(new InMemoryLinkRepository(), new RandomGenerator(), clock);
  const link = await svc.shorten({ url: 'https://a.com', ownerId: 'u1', ttlSeconds: 60 });
  clock.advance(59_999);
  assert.ok(await svc.resolve(link.code.value));
  clock.advance(1);
  assert.equal(await svc.resolve(link.code.value), null);
});

test('generator collisions are retried, then fail loudly', async () => {
  const stuck = { next: async () => 'aaaaaaa' }; // always the same code
  const svc = new ShorteningService(new InMemoryLinkRepository(), stuck, new FakeClock());
  await svc.shorten({ url: 'https://a.com', ownerId: 'u1' });
  await assert.rejects(svc.shorten({ url: 'https://b.com', ownerId: 'u2' }), /congested/);
});`,
        },
      ],
    },
    {
      heading: '12. Common mistakes (and what to do instead)',
      body: `| Mistake | Why it hurts | Instead |
|---|---|---|
| Coding in minute 2 | wrong entities, rewrite at minute 50 | 10 minutes of entities + operations first |
| God \`Service\` with five Maps | no modularity, untestable | repository per aggregate, service per use case |
| \`if (type === 'CAR') ... else if\` | every twist edits it | Strategy/registry; a new type is a new class |
| Inheritance for variation (\`PremiumUser extends User\`) | explodes on combinations | composition: user *has* a plan/policy |
| Hard-wired \`Date.now()\`, \`Math.random()\`, \`new Repo()\` | can't test expiry, collisions or swap storage | inject Clock, generator, repository |
| Patterns for show (Abstract Factory for 2 classes) | noise, harder viva | a pattern per real variation point, named with reason |
| Check-then-act across \`await\` | double booking in the demo | atomic repository operation / keyed lock |
| Errors as \`console.log\` + \`return null\` | evaluator can't tell failure from absence | typed domain errors, explicit results |
| No driver; "run the tests" | evaluator sees nothing working | a scripted demo of every must-have + failures |
| Ignoring the HLD in LLD | design contradicts NFRs (sync analytics in redirect) | carry NFRs down: async listeners, atomic store ops |

**The meta-mistake:** treating LLD as "draw classes". It is a *conversation* — state assumptions, offer two options with trade-offs, pick one, and leave the door open for the twist you can see coming.`,
    },
  ],
  codeChallenges: [
    {
      id: 'lld-hld-to-lld-cc-1',
      title: 'From a god route handler to a layered shortener',
      context:
        'A 40-minute machine-coding submission for "build a URL shortener with custom aliases and expiry". It works in the happy-path demo, but the evaluator flagged it as "not extensible, not testable, racy". The viva starts in 10 minutes.',
      task:
        'Refactor into a design an evaluator would score highly: separate domain, ports and service, make the custom-alias claim race-free, bound the collision loop, make expiry testable without sleeping, and keep the redirect path free of analytics latency. Keep a thin HTTP layer.',
      starter: {
        language: 'typescript',
        title: 'app.ts (starter)',
        code: `import express from 'express';
import { db } from './db'; // async KV: get/set/exists
import { analytics } from './analytics'; // HTTP client, ~80ms per call

const app = express();
app.use(express.json());

app.post('/links', async (req, res) => {
  const { url, alias, ttl, user } = req.body;
  let code = alias;
  if (alias) {
    if (await db.exists(alias)) return res.status(409).send('taken');
  } else {
    code = Math.random().toString(36).slice(2, 9);
    while (await db.exists(code)) code = Math.random().toString(36).slice(2, 9);
  }
  await db.set(code, {
    url, user,
    expires: ttl ? Date.now() + ttl * 1000 : null,
  });
  res.json({ short: 'https://sho.rt/' + code });
});

app.get('/:code', async (req, res) => {
  const link = await db.get(req.params.code);
  if (!link) return res.sendStatus(404);
  if (link.expires && link.expires < Date.now()) return res.sendStatus(404);
  await analytics.track(req.params.code, req.ip); // record the click
  res.redirect(302, link.url);
});

app.listen(3000);`,
      },
      hints: [
        'Two requests for alias "sale" both pass db.exists before either calls db.set — what single store operation removes the gap?',
        'Which three things in this file are non-deterministic or slow and should be behind an interface so a test can control them?',
        'Should a redirect wait 80 ms for analytics, and what happens to the redirect when analytics is down?',
      ],
      solution: {
        language: 'typescript',
        title: 'Layered solution (ports + service + thin controller + composition root)',
        code: `// ports.ts
export interface Link { code: string; url: string; ownerId: string; expiresAt: number | null; }
export interface LinkStore {
  putIfAbsent(link: Link): Promise<boolean>; // conditional write: SET NX / ON CONFLICT DO NOTHING
  get(code: string): Promise<Link | null>;
}
export interface CodeGenerator { next(): string; }
export interface Clock { nowMs(): number; }
export interface ClickSink { record(code: string, ip: string): void; } // non-blocking (buffer → queue)

export class AliasTakenError extends Error {}
export class ValidationError extends Error {}

// shortener.service.ts
export class Shortener {
  private static readonly ALIAS = /^[0-9A-Za-z_-]{4,30}$/;
  constructor(private store: LinkStore, private gen: CodeGenerator, private clock: Clock, private clicks: ClickSink) {}

  async create(url: string, ownerId: string, alias?: string, ttlSec?: number): Promise<Link> {
    const parsed = new URL(url); // throws on garbage
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new ValidationError('scheme');
    if (alias && !Shortener.ALIAS.test(alias)) throw new ValidationError('alias format');
    const expiresAt = ttlSec ? this.clock.nowMs() + ttlSec * 1000 : null;
    const attempts = alias ? 1 : 5;
    for (let i = 0; i < attempts; i++) {
      const link = { code: alias ?? this.gen.next(), url: parsed.toString(), ownerId, expiresAt };
      if (await this.store.putIfAbsent(link)) return link; // check + write in ONE step
    }
    if (alias) throw new AliasTakenError(alias);
    throw new Error('generator collided 5 times; code space congested');
  }

  async resolve(code: string, ip: string): Promise<string | null> {
    const link = await this.store.get(code);
    if (!link || (link.expiresAt !== null && this.clock.nowMs() >= link.expiresAt)) return null;
    try { this.clicks.record(code, ip); } catch { /* never fail a redirect for analytics */ }
    return link.url;
  }
}

// http.ts — thin adapter: parse, call, map errors
export function routes(app: import('express').Express, svc: Shortener) {
  app.post('/links', async (req, res) => {
    try {
      const { url, alias, ttl } = req.body;
      const link = await svc.create(url, String(req.header('x-user-id')), alias, ttl);
      res.status(201).json({ short: 'https://sho.rt/' + link.code });
    } catch (e) {
      if (e instanceof AliasTakenError) return res.status(409).json({ error: 'alias_taken' });
      if (e instanceof ValidationError || e instanceof TypeError) return res.status(400).json({ error: 'invalid' });
      throw e;
    }
  });
  app.get('/:code', async (req, res) => {
    const url = await svc.resolve(req.params.code, req.ip ?? '');
    return url ? res.redirect(302, url) : res.sendStatus(404);
  });
}

// main.ts — composition root is the only place that picks implementations
// const svc = new Shortener(new RedisLinkStore(redis), new RandomBase62(), { nowMs: Date.now }, new BufferedKafkaClicks(producer));`,
      },
      explanation: `**Fixes, mapped to the rubric:**

- **Race on alias (concurrency):** \`exists\` then \`set\` spans two awaits, so concurrent claims both win and the second silently overwrites the first owner's link. \`putIfAbsent\` (Redis \`SET NX\`, SQL \`ON CONFLICT DO NOTHING\`, DynamoDB \`attribute_not_exists\`) makes the claim atomic across processes, not just within one.
- **Unbounded loop:** \`while (exists)\` could spin forever when the space fills or the generator is broken. Bounded to 5 attempts with a loud failure.
- **Weak randomness and length:** \`Math.random().toString(36)\` can yield short strings and is predictable; the generator is now a strategy (CSPRNG base62 or counter) chosen in the composition root.
- **Testability:** clock, generator and store are injected, so expiry and collisions are unit-testable with fakes.
- **Hot path:** analytics no longer adds ~80 ms to each redirect or fails it when down; \`ClickSink\` buffers and publishes asynchronously.
- **Modularity:** validation and rules live in the service, HTTP concerns in a thin adapter, wiring in one place, and typed errors map to 400/409 instead of plain-text strings.`,
      followUps: [
        {
          q: 'Your `putIfAbsent` is Redis `SET NX`. The interviewer says: "Redis fails over and the replica hadn\'t received the last write — what can happen to aliases, and is it acceptable?"',
          a: 'Async replication means an acknowledged `SET NX` can be lost on failover, so a second user can claim the same alias and **both** got a 201. For a shortener that is a correctness bug (one user\'s link now points elsewhere). Options: make the source of truth a DB with a `UNIQUE` index (Redis only as cache), or use `WAIT 1` for alias claims to require replica ack (lower but non-zero risk). Random codes are less exposed since collisions are rare, but custom aliases need the durable constraint.',
        },
        {
          q: 'How would you unit-test that analytics can never break or slow a redirect, without a real Kafka?',
          a: 'Inject a `ClickSink` fake whose `record` throws, call `resolve`, and assert it still returns the URL. For latency, inject a sink whose `record` is synchronous but schedules a never-resolving promise, and assert `resolve` settles (e.g. within a `node:test` timeout of 50 ms). The design makes this trivial because the sink interface is synchronous fire-and-forget; the real implementation pushes into an in-memory buffer flushed by a timer, with a bounded size and a drop counter metric.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-cc-2',
      title: 'Machine-coding driver: from a switch-statement main to command handlers',
      context:
        'Machine-coding round (90 min): "Wallet system — commands CREATE <user> <amount>, TOPUP <user> <amount>, TRANSFER <from> <to> <amount>, STATEMENT <user>, read from stdin." The candidate put everything in main.ts. The evaluator asks to add a new OFFER command (cashback on transfer) during the viva and to run the tests — there are none.',
      task:
        'Restructure so parsing, domain rules and output are separated; a new command is additive; domain failures are explicit and never leave a partial update; money is exact; and the whole thing is testable without stdin.',
      starter: {
        language: 'typescript',
        title: 'main.ts (starter)',
        code: `import * as readline from 'node:readline';

const wallets: Record<string, number> = {};
const history: Record<string, string[]> = {};

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const p = line.trim().split(' ');
  switch (p[0]) {
    case 'CREATE':
      wallets[p[1]] = parseFloat(p[2]);
      history[p[1]] = [];
      break;
    case 'TOPUP':
      wallets[p[1]] += parseFloat(p[2]);
      history[p[1]].push('TOPUP ' + p[2]);
      break;
    case 'TRANSFER': {
      const amt = parseFloat(p[3]);
      wallets[p[1]] -= amt;
      if (wallets[p[1]] < 0) { console.log('Insufficient balance'); process.exit(1); }
      wallets[p[2]] += amt;
      history[p[1]].push('DEBIT ' + amt);
      history[p[2]].push('CREDIT ' + amt);
      break;
    }
    case 'STATEMENT':
      console.log(history[p[1]].join('\\n'), wallets[p[1]]);
      break;
    default:
      console.log('bad command');
  }
});`,
      },
      hints: [
        'What state is left behind when TRANSFER fails the balance check, or when the receiver does not exist (`undefined += amt`)?',
        'If OFFER is added, how many places change? Could each command be an object registered by name?',
        'What do 0.1 + 0.2 and `parseFloat("12abc")` give, and what should money be stored as?',
      ],
      solution: {
        language: 'typescript',
        title: 'domain service + command registry + driver',
        code: `// domain/wallet.service.ts — exact money in paise, validate-then-mutate
export class DomainError extends Error {}
type Txn = { kind: 'TOPUP' | 'DEBIT' | 'CREDIT'; paise: bigint; at: number };

export class WalletService {
  private readonly balances = new Map<string, bigint>();
  private readonly txns = new Map<string, Txn[]>();
  constructor(private readonly now: () => number = Date.now) {}

  create(user: string, paise: bigint) {
    if (this.balances.has(user)) throw new DomainError('wallet exists: ' + user);
    this.balances.set(user, paise);
    this.txns.set(user, []);
  }
  topup(user: string, paise: bigint) {
    if (paise <= 0n) throw new DomainError('amount must be positive');
    this.balances.set(user, this.must(user) + paise);
    this.txns.get(user)!.push({ kind: 'TOPUP', paise, at: this.now() });
  }
  transfer(from: string, to: string, paise: bigint) {
    if (from === to) throw new DomainError('self transfer');
    if (paise <= 0n) throw new DomainError('amount must be positive');
    const a = this.must(from), b = this.must(to); // validate EVERYTHING first
    if (a < paise) throw new DomainError('insufficient balance');
    this.balances.set(from, a - paise);            // then mutate (no await in between)
    this.balances.set(to, b + paise);
    const at = this.now();
    this.txns.get(from)!.push({ kind: 'DEBIT', paise, at });
    this.txns.get(to)!.push({ kind: 'CREDIT', paise, at });
  }
  statement(user: string) { return { balance: this.must(user), txns: [...this.txns.get(user)!] }; }
  private must(user: string): bigint {
    const b = this.balances.get(user);
    if (b === undefined) throw new DomainError('unknown wallet: ' + user);
    return b;
  }
}

// app/commands.ts — one handler per command; a new command is a new entry
export const toPaise = (s: string): bigint => {
  if (!/^\\d+(\\.\\d{1,2})?$/.test(s)) throw new DomainError('bad amount: ' + s);
  const [r, p = ''] = s.split('.');
  return BigInt(r) * 100n + BigInt(p.padEnd(2, '0'));
};
export interface CommandHandler { arity: number; run(args: string[], svc: WalletService): string; }

export const handlers: Record<string, CommandHandler> = {
  CREATE:   { arity: 2, run: ([u, a], s) => (s.create(u, toPaise(a)), 'OK') },
  TOPUP:    { arity: 2, run: ([u, a], s) => (s.topup(u, toPaise(a)), 'OK') },
  TRANSFER: { arity: 3, run: ([f, t, a], s) => (s.transfer(f, t, toPaise(a)), 'OK') },
  STATEMENT: { arity: 1, run: ([u], s) => {
    const st = s.statement(u);
    return [...st.txns.map((t) => t.kind + ' ' + t.paise), 'BALANCE ' + st.balance].join('\\n');
  } },
};

export function execute(line: string, svc: WalletService): string {
  const [name, ...args] = line.trim().split(/\\s+/);
  const h = handlers[name?.toUpperCase() ?? ''];
  if (!h) return 'ERROR unknown command ' + name;
  if (args.length !== h.arity) return 'ERROR ' + name + ' expects ' + h.arity + ' args';
  try { return h.run(args, svc); }
  catch (e) { if (e instanceof DomainError) return 'ERROR ' + e.message; throw e; }
}

// main.ts — the only file that touches stdin/stdout
// const svc = new WalletService();
// readline.createInterface({ input: process.stdin }).on('line', (l) => console.log(execute(l, svc)));`,
      },
      explanation: `**What changed and why the evaluator cares:**

- **No partial updates:** the starter debited the sender before checking the balance (and \`process.exit\`ed with corrupted state), and \`wallets[to] += amt\` on a missing receiver produced \`NaN\` *after* the debit. The service validates every precondition first, then mutates synchronously.
- **Exact money:** \`parseFloat\` accepts \`"12abc"\` and accumulates binary float error; amounts are now validated and stored as integer paise (\`bigint\`).
- **Open for extension:** each command is a handler in a registry; OFFER is a new entry (plus, ideally, a \`TransferListener\` hook in the service for cashback) — the dispatcher doesn't change.
- **Testability:** \`execute(line, svc)\` is a pure function of input and service; tests feed strings and assert outputs, no stdin. The clock is injected.
- **Errors as output, not crashes:** domain errors become \`ERROR ...\` lines; unexpected errors still throw, so bugs aren't swallowed.
- **Separation:** parsing (\`execute\`), rules (\`WalletService\`), I/O (\`main.ts\`) — exactly the layering evaluators look for.`,
      followUps: [
        {
          q: 'Now add OFFER: "on any transfer ≥ ₹500, credit the sender 1% cashback from a system wallet, capped at ₹50". Where does it go and what do you change?',
          a: 'Make it a domain extension, not a command hack: add a `TransferPolicy`/listener hook (`afterTransfer(from, to, paise)`) that `WalletService` invokes after a successful transfer, and implement `CashbackOffer` that computes `min(paise / 100n, 5000n)` when `paise >= 50000n` and calls an internal credit from the `SYSTEM` wallet. Wire it in the composition root. The OFFER command (if needed) only toggles/registers policies. Existing handlers and the dispatcher are untouched — that is the OCP demo the evaluator wants.',
        },
        {
          q: 'The interviewer says: "This runs as an HTTP service on 4 pods with a shared Postgres. Is `transfer` still safe?"',
          a: 'No — the "validate then mutate with no await" trick only protects a single Node process. On Postgres do it in one transaction: `UPDATE wallets SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1` (check row count = 1), then credit the receiver, insert both ledger rows, commit. Lock rows in a consistent order (lower user_id first) if you use `SELECT ... FOR UPDATE`, to avoid deadlocks between A→B and B→A transfers. Add an idempotency key so client retries don\'t double-transfer.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'lld-hld-to-lld-iq-01',
      difficulty: 'hard',
      question:
        'Here is the HLD we agreed for a notification platform: ingest API, template service, preference service, dispatcher, per-channel workers, provider adapters, delivery-status tracker. You have 35 minutes left. Pick one box to take down to classes and interfaces — which one, and why not the others?',
      context: 'Second half of a combined HLD→LLD round at a fintech; the interviewer deliberately leaves the choice to you.',
      whatInterviewerLooksFor: [
        'An explicit selection criterion (rules, state, variation, contention) rather than "the most important one"',
        'Rejects infra-like boxes (ingest API, workers as plain consumers) with a reason',
        'Names the extension points and invariants before drawing classes',
        'Carries HLD NFRs (idempotency, per-user rate limits, provider failover) into the LLD',
      ],
      modelAnswer: `**Choice: the dispatcher (plus the channel/provider seam under it).**

**Why it wins on every criterion:**

- **Rules:** user preferences per category, quiet hours (no promotional SMS 9pm–9am per TRAI norms), per-user frequency caps, priority (OTP bypasses caps), fallback order (push → SMS).
- **Variation:** channels (email, SMS, push, WhatsApp) and providers (two SMS vendors with failover) keep growing — natural Strategy + Adapter + registry.
- **Contention/correctness:** the same event can arrive twice (at-least-once queue) → idempotency claim; rate-limit counters are shared state.
- **State:** a \`Notification\` moves PENDING → SENT/FAILED/SUPPRESSED, with \`DeliveryAttempt\` children.

**Why not the others:** ingest API is validation + enqueue (thin); template service is mostly a renderer I'd treat as \`TemplateRenderer\` interface; workers are queue consumers that *call* the dispatcher; status tracker is a write-heavy store with little logic.

**What I'd draw:** \`Dispatcher\` depends on \`PreferenceStore\`, \`RateLimiter\`, \`IdempotencyStore\`, \`ChannelRegistry\`, \`Clock\`. \`Channel\` (strategy) composes an ordered list of \`ProviderAdapter\`s with a \`FailoverPolicy\`. A \`SuppressionRule\` chain (Chain of Responsibility: opted-out → quiet hours → frequency cap) decides before sending — each rule a class, so "add DND registry check" is additive.

**Concurrency:** idempotency via atomic claim (Redis \`SET NX EX\`, or unique key in DB); rate limits via atomic \`INCR\`; channels sent in parallel with \`Promise.allSettled\` so one provider timeout doesn't block others.

**Extensibility I'd rehearse:** add WhatsApp (new \`Channel\` + register), add a second SMS vendor (new adapter, failover order config), add digesting (a new rule that defers instead of suppressing).`,
      followUps: [
        {
          q: 'Quiet hours depend on the user\'s timezone and an OTP must bypass them. Where do these two rules live in your classes?',
          a: 'Each is a `SuppressionRule` in the chain: `QuietHoursRule` takes an injected `Clock` and reads the recipient\'s timezone from `Recipient`, returning `DEFER(until)` for promotional categories. Bypass is not an `if` inside it — `Notification.priority` (CRITICAL/TRANSACTIONAL/PROMOTIONAL) is checked by each rule\'s `appliesTo(n)`, so OTPs (TRANSACTIONAL) skip quiet hours but still hit opt-out for legal channels. Testable with a fake clock at 22:30 IST.',
        },
        {
          q: 'Your interviewer says "the preference service is also full of rules — why not that?"',
          a: 'Fair challenge: it holds per-category opt-ins and channel ordering, but those are mostly **data**, read through a narrow query (`channelsFor(user, category)`). The behaviour that combines them with time, limits, idempotency and provider failure lives in the dispatcher. If the interviewer wants preferences, I\'d model `PreferenceProfile` as an aggregate with versioned updates and inheritance of defaults (org → team → user) — happy to switch, but it shows less design.',
        },
        {
          q: 'How does the dispatcher\'s class design change if the queue guarantees only at-least-once and a worker can crash after the provider accepted the SMS but before you marked it SENT?',
          a: 'Idempotency claim before send is not enough: on crash the claim exists but status is unknown. Model `DeliveryAttempt` with states CLAIMED → SENT/FAILED and a provider idempotency key (many SMS/email APIs accept a client reference). On redelivery, a CLAIMED attempt older than the timeout is **reconciled** (query provider by reference) rather than resent blindly. In code: `AttemptRepository.claim()`, `markSent(providerId)`, and a `Reconciler` class — accepting that some channels (push) can only be at-least-once.',
        },
      ],
      pitfalls: [
        'Choosing the ingest API because "everything starts there" — it has no interesting design',
        'Designing every box shallowly instead of one deeply',
        'Forgetting at-least-once delivery and idempotency, which the HLD already implied',
        'Hard-coding channels in a switch inside the dispatcher',
      ],
    },
    {
      id: 'lld-hld-to-lld-iq-02',
      difficulty: 'hard',
      question:
        'You drew `ShorteningService` with a `LinkRepository` interface and an in-memory implementation. The interviewer asks: "Replace it with Postgres without touching the service — and tell me which part of your interface contract was quietly relying on being in-memory."',
      whatInterviewerLooksFor: [
        'Recognises that an interface signature is not the whole contract — atomicity, ordering, mutability and errors are semantics',
        'Maps in-memory guarantees to DB primitives (UNIQUE / ON CONFLICT, transactions, version columns)',
        'Spots leaks: returning live mutable objects, synchronous assumptions, unbounded list methods',
        'Mentions testing the contract against both implementations',
      ],
      modelAnswer: `**The swap itself:** \`PgLinkRepository implements LinkRepository\`, wired in the composition root. \`insertIfAbsent\` becomes \`INSERT INTO links (...) VALUES (...) ON CONFLICT (code) DO NOTHING RETURNING code\` — row returned → true. \`findByCode\` is a PK lookup; \`findByOwner\` uses an index on \`(owner_id, created_at DESC)\` with \`LIMIT\`.

**Contract assumptions that were secretly in-memory:**

1. **Atomicity source.** In memory, \`insertIfAbsent\` was atomic because there was no \`await\` between \`has\` and \`set\`. In Postgres it must come from the UNIQUE constraint — if someone implements it as SELECT-then-INSERT, races return. I document the method as "atomic across all processes".
2. **Object identity/mutability.** The Map returned the *same* \`ShortLink\` instance; a caller mutating it silently changed "stored" state. Postgres returns a fresh copy. Fix: immutable entities (\`readonly\`) or copy-on-read in the memory repo so both behave alike.
3. **Unbounded/ordered reads.** \`findByOwner\` sliced an array whose order was insertion order. In SQL order must be explicit (\`ORDER BY created_at DESC, code\`) and paging needs a cursor, not \`limit\` alone, once a user has 100K links.
4. **Failure modes.** Memory never times out or throws connection errors; Postgres does. The contract needs to say what errors surface (transient vs constraint) so the service can retry the right ones.
5. **Latency.** Callers that loop over repo calls (N+1) were free in memory and cost 1–2 ms each in Postgres.

**How I'd prove it:** a shared contract test suite (\`describeLinkRepositoryContract(factory)\`) run against both implementations — including 50 concurrent \`insertIfAbsent\` on the same code expecting exactly one \`true\`.`,
      followUps: [
        {
          q: 'Your contract test spins up 50 concurrent inserts against Postgres and gets exactly one winner — but a reviewer says the test could pass even with a SELECT-then-INSERT implementation. Why, and how do you make it meaningful?',
          a: 'With a small connection pool (e.g. 2 connections) the 50 calls are effectively serialised, so the racy implementation rarely loses. Make the race real: pool size ≥ concurrency, start all calls behind a shared barrier promise, and optionally inject a delay between SELECT and INSERT in a test-only subclass. Better still, assert on the mechanism: the PG implementation must rely on the unique index — the test also verifies that inserting a duplicate directly raises `23505`.',
        },
        {
          q: 'The interviewer adds: "links can be edited — owner changes the target URL". What does the repository contract gain?',
          a: 'An optimistic concurrency method: `update(link, expectedVersion): Promise<boolean>` implemented as `UPDATE links SET target = $1, version = version + 1 WHERE code = $2 AND version = $3` (row count 1 = success). The entity carries `version`. The in-memory repo compares the stored version before replacing, keeping semantics identical. Also: cache invalidation for the redirect path becomes part of the use case (publish `LinkUpdated`), not the repository.',
        },
      ],
      pitfalls: [
        'Saying "it\'s behind an interface so nothing changes" — ignoring semantic contracts',
        'Implementing insertIfAbsent as find-then-save in the DB version',
        'Returning mutable shared objects from the in-memory repo, hiding aliasing bugs until production',
      ],
    },
    {
      id: 'lld-hld-to-lld-iq-03',
      difficulty: 'medium',
      question:
        'Minute 70 of a 90-minute machine-coding round: two of five must-have features are unimplemented, your driver crashes on the third scenario, and you have a half-built Observer abstraction for a nice-to-have. What do you do in the remaining 20 minutes, and what do you say to the evaluator?',
      context: 'Flipkart/Swiggy-style round; evaluation and viva start at minute 90.',
      whatInterviewerLooksFor: [
        'Prioritises a running demo of what exists over starting new features',
        'Cuts scope deliberately (removes half-built abstraction) instead of leaving dead code',
        'Communicates status and the plan for the missing features in design terms',
        'Knows evaluators weigh working code + modularity over breadth',
      ],
      modelAnswer: `**Triage (2 min):** a crashing driver is worse than a missing feature — the evaluator sees nothing working. Order: make it run → finish the cheapest missing must-have → describe the other.

**Plan:**

1. **Minutes 70–78 — fix the crash.** Find the failing scenario, fix it; if the fix is deep, guard that scenario so the rest of the demo runs, and note it.
2. **Delete or park the half-built Observer.** Unused abstractions cost points (YAGNI, "pattern for show") and might not compile. Keep a one-line \`// TODO: emit BookingConfirmed event for notifications\` where it would plug in.
3. **Minutes 78–86 — implement the smaller missing must-have**, end-to-end through the driver, even with minimal validation. One working feature beats two stubs.
4. **Minutes 86–90 — the demo script** runs every working scenario including one failure path; skim names.

**What I say at minute 90:** "Features 1–4 work end-to-end — here's the demo. Feature 5 isn't implemented; it would be a new \`RefundPolicy\` strategy plugged into \`BookingService.cancel\` — no existing class changes except wiring. I also dropped the Observer for notifications to keep the code honest; it would hang off the \`BookingConfirmed\` point here."

**Why this scores:** reports from Flipkart and Swiggy rounds consistently say running, correct code is weighed above incomplete elegant code — and the viva rewards a candidate who can explain where the missing piece slots in. Next time: vertical slice by minute 20, all must-haves on the happy path by minute 60.`,
      followUps: [
        {
          q: 'The evaluator says: "You have 5 more minutes — implement feature 5." What do you write first?',
          a: 'The thinnest end-to-end path: the interface (`RefundPolicy.refundFor(booking, now)`), one concrete implementation with the main rule, the one-line call in `cancel`, the wiring in the composition root and a driver line demonstrating it. Validation and edge cases last. This proves the extension point was real rather than talk, which is what the request is testing.',
        },
        {
          q: 'Would you ever submit code that doesn\'t compile but has more features?',
          a: 'No. Most evaluators run it first; a non-compiling submission often caps the score regardless of design. Comment out or remove the broken part, keep it compiling, and explain the missing piece. TypeScript makes this especially sharp: a type error in an unused file can still fail `tsc` — so compile often (every feature), not only at the end.',
        },
      ],
      pitfalls: [
        'Starting the remaining two features in parallel and finishing neither',
        'Leaving dead half-abstractions in the submission',
        'Not running the full driver until minute 89',
      ],
    },
    {
      id: 'lld-hld-to-lld-iq-04',
      difficulty: 'expert',
      question:
        'Your interviewer says: "Node is single-threaded, so your in-memory seat allocator can\'t have race conditions — right?" Defend or refute with a concrete interleaving, then tell me what changes when we run 6 pods and when we move the hot path to worker_threads.',
      whatInterviewerLooksFor: [
        'A concrete interleaving across an await (not a vague "async is tricky")',
        'Distinguishes in-process, multi-pod and worker_thread memory models',
        'Correct fixes for each: no-await critical sections or keyed mutex; store-level atomics; Atomics/SharedArrayBuffer or message passing',
        'Knows the Java equivalents since panels often expect them',
      ],
      modelAnswer: `**Refute.** One JS statement runs at a time, but an async method yields at every \`await\`.

**Interleaving:**

1. Request A: \`const seat = await repo.find(id)\` → AVAILABLE.
2. A awaits \`pricing.quote(seat)\` (I/O) — event loop runs B.
3. Request B: \`find(id)\` → still AVAILABLE; B awaits pricing too.
4. A resumes: \`seat.hold(userA)\`; B resumes: \`seat.hold(userB)\` → double booking.

**In-process fixes:**

- Keep check-and-mutate **synchronous**: do the I/O first (quote), then \`if (seat.isAvailable()) seat.hold(u)\` with no await between check and set.
- If the critical section must span awaits, a **keyed async mutex** (per seat/show) — never one global lock, which serialises everything.

**6 pods:** each has its own memory; the in-memory allocator is now six allocators. Atomicity must move to shared storage: \`UPDATE seats SET holder=$1, hold_until=$2 WHERE id=$3 AND (holder IS NULL OR hold_until < now())\` and check the row count; or Redis \`SET seat:42 userA NX PX 300000\`. Alternatively shard by show ID so one pod owns each show (single-writer) — but then you need routing and failover.

**worker_threads:** separate isolates; plain objects are copied, not shared. Shared state needs \`SharedArrayBuffer\` + \`Atomics.compareExchange\` (true data races now exist, like Java), or keep ownership in one thread and message-pass commands to it (actor style) — usually the simpler choice.

**Java framing:** threads share the heap, so the in-memory version itself needs \`ConcurrentHashMap.compute\`/\`putIfAbsent\`, a per-seat \`ReentrantLock\`, or \`AtomicReference.compareAndSet\` on seat state; multi-instance still needs the DB/Redis constraint.

**Summary:** Node removes *data races* on a single thread, not *logical races* across awaits — and nothing in-process survives scaling out.`,
      followUps: [
        {
          q: 'You choose a keyed async mutex. How do you stop the key map from leaking memory for 10 million seats over a week?',
          a: 'Store only *held* keys: the mutex map entry is created on acquire and deleted when the last waiter releases (track a waiter count per key, or chain promises and delete when the tail promise is still the stored one). With that, size ≈ concurrently contended keys (hundreds), not all seats. Add a timeout on acquire so a hung holder can\'t block a key forever, and expose map size as a metric to catch leaks.',
        },
        {
          q: 'With single-writer sharding (each show owned by one pod), what happens during a deploy?',
          a: 'Ownership must move: the old pod stops accepting commands for its shows, drains in-flight ones, and the router (consistent hashing over a membership list, or a lease in etcd/Redis with fencing tokens) hands shows to the new pod, which rebuilds state from the DB. Without fencing, a slow old pod can still write after losing the lease — so writes carry the lease epoch and the DB rejects stale epochs. That complexity is why the DB conditional update is usually preferred for booking.',
        },
      ],
      pitfalls: [
        'Agreeing that single-threaded means race-free',
        'Proposing a process-level mutex for a multi-pod deployment',
        'A single global lock around all bookings',
        'Assuming worker_threads share ordinary objects',
      ],
    },
    {
      id: 'lld-hld-to-lld-iq-05',
      difficulty: 'medium',
      question:
        'An engineer from a company without machine-coding rounds asks you: "How is a machine-coding round scored differently from a DSA round and an HLD round? What does \'extensible\' actually mean to the evaluator?" Answer as if briefing them for a Flipkart or PhonePe loop.',
      whatInterviewerLooksFor: [
        'Clear contrast: DSA = correctness/complexity, HLD = trade-offs at scale, machine coding = working modular code',
        'Operational definition of extensibility (twist absorbed by adding, not editing)',
        'Mentions the viva and live extension',
        'Knows what to stub and how to demo',
      ],
      modelAnswer: `**Three rounds, three rubrics:**

| | DSA | HLD | Machine coding |
|---|---|---|---|
| Output | one function | diagram + reasoning | a small runnable app |
| Scored on | correctness, complexity | requirements, scale numbers, trade-offs | completeness, demo, modularity, extensibility, testability |
| Penalised for | wrong complexity | no numbers, single point of failure | god class, no run, if/else on types |

**Extensible, operationally:** the evaluator (or the viva) adds a twist — PhonePe's issue-resolution problem asks for a pluggable agent-assignment strategy; Flipkart interviewers ask to add a new vehicle or split type live. They watch *what you touch*:

- **Good:** a new class implementing an existing interface + one registration line in the composition root.
- **OK:** a small, local change to one class's internals.
- **Bad:** editing switch statements in four places, changing method signatures across layers, or "I'd need to rewrite this".

**What else they tick:** runs end-to-end via a driver; entities separated from services and repositories; injected clock/IDs so behaviour is testable; explicit errors; no double booking in the contended operation; sensible names.

**Practical briefing:** 10 minutes entities before code; stub storage with in-memory repositories behind interfaces; keep something runnable from minute 20; all must-haves by 60; edge cases and one concurrency guarantee by 80; demo script last. Expect a 15–30 minute viva where they'll ask you to justify every abstraction — so don't add any you can't justify.`,
      followUps: [
        {
          q: 'They ask: "Then should I add Strategy and Factory everywhere to look extensible?"',
          a: 'No — extensibility is graded against the likely twists, and unused abstractions are graded as noise. Put an interface where the problem statement implies variation (assignment strategy, split type, pricing) or where I/O/time sits. A Factory for two classes that never vary is a viva liability: "why is this here?" with no good answer costs more than its absence.',
        },
        {
          q: 'What if the evaluator\'s twist doesn\'t fit any of your interfaces?',
          a: 'Say so and refactor honestly: "my abstraction assumed X; this twist breaks it — I\'d extract interface Y here." Show the minimal change, keep tests green. Evaluators value candidates who recognise a wrong seam and move it cleanly over those who bend the twist to fit the existing design with flags.',
        },
      ],
      pitfalls: [
        'Describing machine coding as "LLD on paper"',
        'Equating extensibility with the number of patterns used',
        'Ignoring the viva entirely',
      ],
    },
    {
      id: 'lld-hld-to-lld-iq-06',
      difficulty: 'hard',
      question:
        'The HLD says: "redirect p99 < 10 ms at 100K RPS, links are immutable after creation except for expiry, analytics is eventually consistent." Which concrete LLD decisions in the redirect/resolve classes do these three NFRs force?',
      whatInterviewerLooksFor: [
        'Translates each NFR into a class/method-level decision',
        'Keeps I/O off the hot path (listeners, buffering) with bounded memory',
        'Uses immutability to justify caching and lock-free reads',
        'Handles expiry correctly with cached entries',
      ],
      modelAnswer: `**p99 < 10 ms at 100K RPS →**

- \`resolve\` does at most one cache read on a hit and one store read on a miss; no other awaited I/O. A \`LinkCache\` interface (in-process LRU in front of Redis) sits behind the repository via a **Decorator** (\`CachedLinkRepository implements LinkRepository\`) so the service stays unchanged.
- Negative caching for unknown codes (short TTL) — scanners hammering random codes would otherwise hit the DB.
- Single-flight on misses so a viral link doesn't stampede the store.

**Immutable links →**

- \`ShortLink\` is a \`readonly\` value-like entity; cache entries need no invalidation for target changes — only for deletion/abuse takedown (publish an event, short TTL as backstop).
- Shared across requests without copies or locks — safe even if the cache moves to a worker thread with structured cloning.

**Expiry with caching →** cache TTL = \`min(defaultTtl, expiresAt − now)\`; and \`resolve\` *still* checks \`isExpired(clock.now())\`, so a stale cache entry can't serve an expired link.

**Eventually consistent analytics →**

- \`ClickSink.record\` is synchronous, non-blocking: pushes to a bounded in-memory ring buffer flushed every 100 ms or 500 events to Kafka.
- When the buffer is full, **drop and count** (\`clicks_dropped_total\`) rather than block — the NFR explicitly ranks redirect latency above analytics completeness.
- Listener exceptions are caught; analytics can never fail a redirect.

**Also:** 302 vs 301 is a product/analytics decision (301 is cached by browsers, so clicks vanish from analytics) — mention it, as it changes what \`resolve\` returns to the controller.`,
      followUps: [
        {
          q: 'The ring buffer holds 50K events per pod. Kafka is down for 3 minutes at 20K clicks/s per pod. What happens and is that acceptable?',
          a: 'The buffer fills in 2.5 s; the remaining ~3.6M events are dropped and counted. Acceptable only if the NFR truly says analytics is best-effort. If billing depends on clicks (paid links), add a local disk spool (append-only file, bounded at e.g. 2 GB) drained on recovery — still non-blocking for redirects — or derive counts from CDN/LB logs as a reconciliation source.',
        },
        {
          q: 'Where exactly does the Decorator sit, and why not put caching inside `ShorteningService`?',
          a: '`CachedLinkRepository` wraps `PgLinkRepository` and implements the same interface; the composition root builds `new CachedLinkRepository(new PgLinkRepository(pool), lru, redis)`. Putting cache logic in the service mixes two reasons to change (business rules vs performance tuning), makes service tests depend on cache behaviour, and duplicates logic if another service reads links. The decorator is also removable for tests.',
        },
      ],
      pitfalls: [
        'Calling analytics synchronously in resolve',
        'Relying on cache TTL alone for expiry correctness',
        'Ignoring negative caching and stampedes on hot keys',
      ],
    },
    {
      id: 'lld-hld-to-lld-iq-07',
      difficulty: 'medium',
      question:
        'The problem statement says: "Build a ride-sharing app: riders offer rides, others select rides by preference (most vacant seats / preferred vehicle), track ride stats." The evaluator says "start coding". What do you clarify in the first 5–8 minutes, and what do you write down before the first class?',
      context: 'A classic Flipkart machine-coding prompt style; the statement is intentionally ambiguous.',
      whatInterviewerLooksFor: [
        'Separates must-haves from nice-to-haves and confirms I/O format (driver vs CLI vs REST)',
        'Asks about the rules that shape the model (one active ride per vehicle, seat counts, multi-hop)',
        'Writes entities, operations and the variation points before coding',
        'Time-boxes clarification instead of over-asking',
      ],
      modelAnswer: `**Clarify (in ~5 minutes, grouped):**

- **Interface:** driver with hard-coded scenarios, or parse commands from stdin? Exact output format? (Changes how I separate parsing.)
- **Scope:** which operations are must-have: onboard user, add vehicle, offer ride, select ride, end ride, stats? Is multi-hop (A→B→C via two rides) required or a bonus?
- **Rules:** can a vehicle have two active rides? (Usually no.) Can one rider book multiple seats? What does "select" do when nothing matches — error or empty?
- **Selection strategies:** only "most vacant" and "preferred vehicle"? Expect more? (Tells me Strategy is the point.)
- **Concurrency:** do they want thread-safety in the demo, or single-threaded is fine?

**Then write down (as comments / a README stub):**

1. **Entities:** \`User\`, \`Vehicle\` (owner, model, reg no), \`Ride\` (vehicle, origin, destination, totalSeats, availableSeats, status), \`RideStats\` (offered, taken).
2. **Operations → service methods:** \`addUser\`, \`addVehicle\`, \`offerRide\`, \`selectRide(rider, from, to, seats, strategy)\`, \`endRide\`, \`printStats\`.
3. **Variation points:** \`RideSelectionStrategy\` (MostVacant, PreferredVehicle); repository interfaces for users/vehicles/rides.
4. **Invariants:** one active ride per vehicle; \`availableSeats\` never negative; seats decrement atomically with selection.
5. **Plan:** skeleton + driver by minute 20; offer/select by 45; stats + errors by 60; multi-hop only if time remains.

**Why:** these questions change the design (CLI vs driver, multi-hop changes selection into a graph search), and writing invariants first prevents the classic double-booking bug in the demo.`,
      followUps: [
        {
          q: 'The evaluator answers "multi-hop is a bonus". How do you keep the door open for it without building it?',
          a: 'Make selection return a `RidePlan` (an ordered list of legs) instead of a single `Ride`, even if the strategies only ever produce one leg. A future `MultiHopStrategy` (BFS over offered rides as edges, origin→destination) then plugs into the same interface. It costs one tiny wrapper type now and avoids changing the return type of `selectRide` across the service, driver and tests later.',
        },
        {
          q: 'Two riders select the last seat of the same ride at the same time — how do you show this is handled in an in-memory, single-process demo?',
          a: 'Put the seat decrement inside `Ride.reserve(seats)` which checks `availableSeats >= seats` and decrements synchronously — no await between. In the driver, fire two `selectRide` calls with `Promise.all` and print that one succeeds and one gets `NoRideAvailableError`. Mention that in Java I\'d guard `reserve` with `synchronized` or an `AtomicInteger` CAS loop, and multi-instance needs a conditional DB update.',
        },
      ],
      pitfalls: [
        'Asking 20 questions and coding at minute 20',
        'Not asking about input/output format, then rewriting the driver',
        'Modelling selection strategies as an if/else on a string',
      ],
    },
    {
      id: 'lld-hld-to-lld-iq-08',
      difficulty: 'hard',
      question:
        'In the viva the evaluator points at your code and asks: "Why did you make `PricingStrategy` an interface but `Ride` a concrete class? And why does `BookingService` receive its repositories in the constructor instead of creating them?" Answer, then tell me one abstraction in your code you would remove.',
      whatInterviewerLooksFor: [
        'Interfaces justified by variation or I/O, not by habit',
        'Entities as concrete classes with behaviour; services depending on abstractions',
        'DI explained in terms of testability and the composition root',
        'Self-critique: willingness to remove an unjustified abstraction',
      ],
      modelAnswer: `**PricingStrategy as an interface:** pricing is a known variation point — base fare, surge, subscription discounts, corporate rates. Different implementations can be chosen per city or rider at runtime, and new ones arrive without touching \`BookingService\` (OCP). It is also where business experiments happen, so isolating it keeps that churn local.

**Ride as a concrete class:** \`Ride\` is an **entity** — it has identity, state and invariants (\`reserve(seats)\` can't oversell, status transitions are guarded). There's no second implementation of "a ride"; variations in ride behaviour are expressed by composing strategies/state *into* it, not by subclassing or interfacing it. An \`IRide\` interface would add a name and nothing else.

**Constructor injection in BookingService:**

- The service depends on \`RideRepository\` (interface), not on \`InMemoryRideRepository\` (DIP). The composition root (\`app.ts\` or a NestJS module) decides the implementation.
- Tests construct it with fakes in one line — no module mocking, no global state.
- Dependencies are explicit in the signature, so a constructor with 8 parameters is a visible SRP smell rather than hidden \`new\` calls.
- It enables swapping to Postgres or a cached decorator later with zero service change.

**One I'd remove:** e.g. a \`VehicleFactory\` that only does \`new Vehicle(type, reg)\` with no branching — it adds an indirection without variation. Or an \`IUserService\` interface with a single implementation that no one mocks (I test through the real service). I'd keep interfaces at I/O and variation boundaries only.

**Rule of thumb I'd say aloud:** "Interfaces for behaviour that varies or crosses a boundary; concrete classes for entities and value objects; constructor injection everywhere a dependency does I/O or is non-deterministic."`,
      followUps: [
        {
          q: 'How would this look in NestJS, given TypeScript interfaces don\'t exist at runtime?',
          a: 'Use an injection token: `export const PRICING = Symbol(\'PRICING\')`; in the module `{ provide: PRICING, useClass: SurgePricing }` (or `useFactory` choosing per config); in the service `constructor(@Inject(PRICING) private readonly pricing: PricingStrategy)`. Alternatively declare `abstract class PricingStrategy` and use it as both type and token — it survives compilation. Tests use `Test.createTestingModule` with `{ provide: PRICING, useValue: fakePricing }`.',
        },
        {
          q: 'The evaluator says: "Your constructor takes 7 dependencies." What does that tell you?',
          a: 'The service likely has more than one responsibility — e.g. booking, pricing orchestration, notifications and stats in one class. Split by use case (`BookRideHandler`, `EndRideHandler`) or move side effects behind events (`RideBooked` → notification and stats listeners). Constructor parameters are a cheap cohesion metric; I aim for 2–4 per class.',
        },
      ],
      pitfalls: [
        'Saying "everything should be an interface for loose coupling"',
        'Defending DI only as "the framework does it"',
        'Being unable to name any abstraction they would drop',
      ],
    },
    {
      id: 'lld-hld-to-lld-iq-09',
      difficulty: 'expert',
      question:
        'Your shortener generates codes from a counter via leased ID ranges of 1,000 per pod. Security review says sequential codes let anyone enumerate every link, and product wants to keep 7-character codes. Redesign the generator at the class level without breaking uniqueness or adding a DB round-trip per link.',
      whatInterviewerLooksFor: [
        'Keeps uniqueness from the counter while removing guessability (bijective permutation)',
        'Knows random + retry trade-offs (collision probability, extra round-trips at high fill)',
        'Respects the Strategy seam — the service doesn\'t change',
        'Handles secrets/keys and rotation sensibly',
      ],
      modelAnswer: `**Option A — permute the counter (preferred).** Keep \`LeasedIdAllocator\` for uniqueness, then pass the ID through a **keyed bijection** over [0, 62^7): e.g. a small Feistel network (3–4 rounds, keyed with a secret via HMAC as the round function) with cycle-walking to stay inside the domain, then base62-encode to exactly 7 chars. Because a bijection maps distinct inputs to distinct outputs, uniqueness is preserved with **no collision check** and no extra round-trip; consecutive IDs produce unrelated-looking codes.

Class-level: \`PermutedCounterGenerator implements CodeGenerator\` composes \`LeasedIdAllocator\` and a \`Permutation\` interface (\`FeistelPermutation(secret)\`). The service only sees \`CodeGenerator\`.

**Option B — CSPRNG random + insertIfAbsent.** Simple and unguessable; collision probability per insert ≈ n / 62^7. At 1 billion links that's ~1/3,500 — negligible with a 5-attempt retry, but each retry is an extra conditional write, and enumeration resistance depends only on space density (1B of 3.5T filled ≈ 0.03% hit rate for a scanner).

**Option C — hash(url, user, salt).** Deterministic, but truncation to 7 chars brings collisions that need resolution — strictly worse here.

**Trade-offs I'd state:**

- Feistel is *obfuscation with a secret*, not encryption-grade protection of the counter; if the key leaks, codes become enumerable again, so keep it in a secret manager and treat rotation as "new key for new IDs" (old codes stay valid because they're stored, not recomputed).
- Rate-limit and alert on 404 scanning regardless — defence in depth.
- Leased ranges still waste IDs on pod death; irrelevant at 3.5 × 10^12.

**Why A wins:** zero extra I/O, zero collisions, fits the existing seam, and testable (property test: permutation of 0..1e6 has no duplicates and stays < 62^7).`,
      followUps: [
        {
          q: 'How do you unit-test that the Feistel permutation is a bijection without enumerating 3.5 trillion values?',
          a: 'Make the domain a constructor parameter: run the same code with domain 62^3 (238,328) and assert all outputs are distinct and in range — exhaustive at small size. Add a property test (fast-check) for the real domain: `decode(encode(x)) === x` for random x, since a Feistel network is invertible by construction; invertibility implies injectivity. Also check cycle-walking terminates (bounded iterations in practice).',
        },
        {
          q: 'A tenant wants vanity sequential codes (`acme-0001`, `acme-0002`) while everyone else gets permuted ones. Where does that live?',
          a: 'A `GeneratorResolver` (strategy selector) keyed by tenant returns either `PermutedCounterGenerator` or `TenantSequentialGenerator(prefix, counterName)` with its own leased counter per tenant. The service asks the resolver for a generator per command. The custom format must still pass `ShortCode` validation and uses the same `insertIfAbsent`, so cross-tenant uniqueness holds even if prefixes collide.',
        },
      ],
      pitfalls: [
        'Hashing the counter with SHA and truncating — collisions return',
        'Switching to random codes without discussing retries and probability',
        'Changing ShorteningService instead of plugging a new strategy',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'lld-hld-to-lld-boe-1',
      question:
        'A reviewer suggests shipping your machine-coding `InMemoryLinkRepository` (byCode Map + byOwner Map of arrays, `ShortLink` objects with `ShortCode`/`TargetUrl` value objects and two `Date`s) to production for a "small" tenant with 20M links. Estimate the Node heap it needs and whether the default heap holds it.',
      assumptions: [
        'V8 on 64-bit with pointer compression: ~4 bytes per field slot, ~12–16 byte object headers',
        'Average long URL 80 ASCII chars; codes 7 chars; ownerId strings shared across a user\'s links',
        'Map entries cost ~30–40 bytes each including hash-table slack',
        'Default old-space limit in a container with 4–8 GB RAM is roughly 2–4 GB unless --max-old-space-size is set',
      ],
      steps: [
        { label: 'ShortLink object', calc: 'header ~16 B + 6 fields × 4 B ≈ 40 B' },
        { label: 'ShortCode VO + 7-char string', calc: '~20 B object + ~24 B string ≈ 44 B' },
        { label: 'TargetUrl VO + 80-char string', calc: '~20 B object + ~96 B string ≈ 116 B' },
        { label: 'Two Date objects (createdAt, expiresAt)', calc: '2 × ~24 B ≈ 48 B' },
        { label: 'Index overhead', calc: 'byCode Map entry ~40 B + byOwner array slot ~4 B (+ growth slack) ≈ 50 B' },
        { label: 'Per link', calc: '40 + 44 + 116 + 48 + 50 ≈ 300 B (call it 300–350 B)' },
        { label: 'Total', calc: '20M × ~320 B ≈ 6.4 GB of live heap; GC wants headroom → ~8–10 GB --max-old-space-size' },
        { label: 'Cold start', calc: 'reloading 20M rows at ~50K rows/s ≈ 400 s before the pod can serve' },
      ],
      answer:
        '≈ 6–7 GB of live heap — 2–3× the default limit. It would OOM unless the heap is raised to ~8–10 GB, and then full GCs on a 7 GB heap, a ~7-minute cold start and one copy per pod make it a poor production store.',
      insight:
        'In-memory repositories are a machine-coding convenience, not a storage tier. The interface lets production use a KV store/DB while hot links sit in a bounded LRU (e.g. top 1M ≈ 300 MB). If something must stay in-process, flatten it: store `code → url` as plain strings (no VOs, epoch-ms numbers instead of Dates), which cuts ~40%.',
      followUps: [
        {
          q: 'The tenant runs 3 pods behind a round-robin load balancer, each with its own in-memory repository. What breaks besides memory?',
          a: 'Correctness, not just cost: a link created on pod A is invisible to pods B and C, so ~2/3 of redirects 404 right after creation, and custom-alias uniqueness is per pod — the same alias can be claimed three times. You would need sticky routing by code (still breaks on pod failure) or replication between pods, which reinvents a database. This is why "in-memory behind an interface" is a demo choice that must be swapped before scale-out.',
        },
        {
          q: 'Product says only 5% of links get 95% of the clicks. How does that change the in-process design?',
          a: 'Keep only the hot set in-process: an LRU of ~1M entries (~300 MB with VOs, ~150 MB flattened) in front of the real store, via a `CachedLinkRepository` decorator. With a 95% hit rate, store reads drop 20× and cold start is irrelevant (the cache warms in seconds). Size the LRU by memory budget per pod, and track hit rate to tune it.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-boe-2',
      question:
        'Your notification `Dispatcher` (Node, one process per pod) sends 50M notifications/day, fanning out to 1.6 channels on average; peak is 5× the daily average; provider calls take ~250 ms mean. Each send costs ~1 ms of CPU. How many pods, and which limit binds first: CPU or sockets?',
      assumptions: [
        'Each pod has 1 vCPU for the event loop; target ≤ 60% CPU at peak',
        'HTTP keep-alive agent capped at 256 sockets per provider host per pod',
        'Little\'s law: in-flight requests = arrival rate × latency',
        'Retries ignored for the base estimate',
      ],
      steps: [
        { label: 'Average notification rate', calc: '50M ÷ 86,400 ≈ 580/s' },
        { label: 'Peak notification rate', calc: '580 × 5 ≈ 2,900/s' },
        { label: 'Peak provider calls', calc: '2,900 × 1.6 ≈ 4,640 calls/s' },
        { label: 'CPU-bound pods', calc: '4,640 calls/s × 1 ms = 4.64 CPU-s/s ÷ 0.6 target ≈ 8 pods' },
        { label: 'In-flight calls (Little)', calc: '4,640 × 0.25 s ≈ 1,160 concurrent' },
        { label: 'Socket-bound pods', calc: '1,160 ÷ 256 ≈ 4.5 → 5 pods' },
      ],
      answer:
        '≈ 8 pods at peak; CPU binds first (8 vs 5 for sockets). With N+2 headroom for deploys and zone loss, run ~10.',
      insight:
        'The class design needs per-provider bulkheads: a concurrency limiter and a hard timeout per `ProviderAdapter`, so a slow provider exhausts its own socket budget instead of starving every channel on the pod. That is a concrete reason the HLD\'s "provider adapter" box becomes a separate class with its own limiter.',
      followUps: [
        {
          q: 'The SMS provider degrades and mean latency rises from 250 ms to 2 s for SMS only (40% of calls). What breaks first?',
          a: 'SMS in-flight becomes 4,640 × 0.4 × 2 s ≈ 3,700 across pods (~370 per pod at 10 pods) — above the 256-socket cap — so SMS calls queue inside the agent, memory grows, and without a timeout callers pile up. Push and email are unaffected only if they have separate agents/limiters. Fix: per-provider limiter (fail fast or fail over to vendor B when saturated), a 3 s timeout, and backpressure upstream (stop consuming the SMS queue partition) instead of buffering.',
        },
        {
          q: 'Rendering templates turns out to cost 4 ms of CPU per notification, not 1 ms. Does the pod count change, and what would you do in code?',
          a: 'CPU becomes 2,900 × 4 ms + 4,640 × 1 ms ≈ 16.2 CPU-s/s ÷ 0.6 ≈ 27 pods — a 3× jump. Options: cache compiled templates (compile once per template version, render is then sub-ms), render once per notification rather than per channel, or move rendering to a worker_threads pool so the event loop stays responsive. The `TemplateRenderer` interface makes the caching decorator a drop-in change.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-boe-3',
      question:
        'Your `LeasedIdAllocator` reserves ID blocks from a single Postgres counter row. Peak link creation is 30K/s across 40 pods. Size the block so the counter row is not a bottleneck, and estimate how many IDs a full rolling restart wastes.',
      assumptions: [
        'Single-row UPDATE ... RETURNING holds the row lock ~1–2 ms → ~500–1,000 updates/s max on that row',
        'Traffic is spread evenly across pods',
        'A pod that dies loses the unused remainder of its current block (worst case ~whole block)',
        'Code space 62^7 ≈ 3.5 × 10^12',
      ],
      steps: [
        { label: 'One reservation per link', calc: '30K reservations/s vs ~500–1,000/s row capacity → 30–60× overloaded' },
        { label: 'Per-pod rate', calc: '30K ÷ 40 = 750 IDs/s per pod' },
        { label: 'Block of 1,000', calc: 'lasts 1,000 ÷ 750 ≈ 1.3 s → 40 pods × 0.75 refills/s ≈ 30 reservations/s (3–6% of row capacity)' },
        { label: 'Rolling restart waste', calc: '40 pods × ≤ 1,000 IDs ≈ 40K IDs per deploy' },
        { label: 'Yearly waste at 3 deploys/day', calc: '40K × 3 × 365 ≈ 44M IDs ≈ 0.001% of 3.5 × 10^12' },
      ],
      answer:
        'A block of ~1,000 brings counter load from 30K/s (impossible on one row) to ~30/s; waste on restarts is ~40K IDs per deploy, negligible against the code space.',
      insight:
        'Batching converts a hot-row contention problem into a near-free one; the waste is the price and it is affordable because the ID space is huge. In code, the refill must be single-flight per pod, or concurrent callers on an empty block each reserve a block and multiply both load and waste.',
      followUps: [
        {
          q: 'Traffic grows 10× (300K/s) during a sale. Keep block size 1,000 or change it — and how?',
          a: 'At 7,500 IDs/s per pod a 1,000 block lasts ~0.13 s, so 300 reservations/s — still within row capacity but now 30–60% of it, and each refill stalls callers ~2 ms. Make block size adaptive: target ~2–5 s of consumption (`blockSize = clamp(rate × 3 s, 1K, 100K)`), and prefetch the next block when the current one is 80% used, so callers never wait. Waste per restart rises to ≤ 22.5K × 40 ≈ 900K IDs — still negligible.',
        },
        {
          q: 'The counter row\'s Postgres primary fails over and the replica was 200 ms behind. Can two pods get overlapping blocks?',
          a: 'Yes, with async replication: reservations acknowledged in the last 200 ms may be lost, so the new primary hands out the same range again → duplicate IDs → `insertIfAbsent` collisions (or silent overwrites if the store lacks a unique constraint). Mitigations: synchronous replication for the counter table, or on failover bump the counter by a safety margin (e.g. +10M) before serving, and always keep the unique constraint on code as the last line of defence.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'lld-hld-to-lld-mcq-01',
      difficulty: 'hard',
      question:
        'A candidate adds audit logging to their in-memory repository during a machine-coding round. Two users submit the custom alias "diwali" at the same moment. What does the demo show?',
      code: {
        language: 'typescript',
        code: `async insertIfAbsent(link: ShortLink): Promise<boolean> {
  if (this.byCode.has(link.code.value)) return false;
  await this.audit.log('claim', link.code.value, link.ownerId); // added later
  this.byCode.set(link.code.value, link);
  return true;
}`,
      },
      options: [
        'Exactly one succeeds — Node runs one callback at a time, so the has/set pair is atomic',
        'Both return true; the second set overwrites the first owner\'s link',
        'The second call throws because Map.set on an existing key is rejected',
        'Both return true, but the first owner\'s link survives because Map keeps the first insertion',
      ],
      correct: [1],
      explanation:
        'The `await` between `has` and `set` yields to the event loop, so both calls pass the `has` check before either writes; both then `set`, and the later write replaces the earlier one while both callers believe they own the alias. Single-threaded execution only makes *synchronous* sections atomic. `Map.set` never throws on existing keys and always keeps the last value, so options 3 and 4 are wrong.',
      followUps: [
        {
          q: 'The audit log must record the claim. How do you keep it without breaking atomicity?',
          a: 'Do the check-and-set synchronously first, then audit after the decision: `if (has) return false; set(...); void this.audit.log(...)` (or await it after the set). If the audit write must succeed for the claim to count, record intent in the same atomic step (store a PENDING claim) and finalise after audit, rolling back on failure — but usually audit-after-commit with retries is the right trade-off.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-02',
      difficulty: 'expert',
      question:
        'An evaluator reviews a 90-minute parking-lot submission. Select ALL findings that would most likely cost points under "extensibility" specifically (not completeness).',
      options: [
        'Fee calculation is a switch on vehicleType inside ParkingService.exit()',
        'A new EV-charging spot type requires editing SpotAllocator, Floor and the driver',
        'The driver only demonstrates the happy path for two vehicle types',
        'Spot allocation strategy (nearest-first) is hard-coded in the Floor class',
        'Methods are named doStuff() and process2()',
      ],
      correct: [0, 1, 3],
      explanation:
        'Extensibility is judged by what a new requirement forces you to touch: a type switch in fee logic, a new spot type rippling through three classes, and an allocation rule baked into `Floor` all turn additive changes into edits. A thin demo is a completeness/demo issue, and poor naming is a code-quality issue — both cost points, but under different rubric lines.',
      followUps: [
        {
          q: 'Fix the fee switch in one sentence of design and tell me what the evaluator will ask next.',
          a: 'Introduce `FeeStrategy` (per vehicle type or per lot policy) resolved from a registry in the composition root, so a new type adds a class and a registration. Expect next: "now add weekend/hourly slabs" — which should compose (`SlabbedFee` wrapping a base rate) rather than multiply subclasses per type × slab.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-03',
      difficulty: 'medium',
      question:
        'After a ride-hailing HLD (API gateway, location ingestion via Kafka, matching service, trip service, payment adapter, notification service), the interviewer says "pick one for LLD". Which choice gives the most design signal?',
      options: [
        'Location ingestion — it handles the highest QPS in the system',
        'Trip service with driver assignment — a lifecycle state machine plus contention on a driver',
        'API gateway — every request passes through it, so its classes matter most',
        'Payment adapter — it integrates with an external provider and needs retries',
      ],
      correct: [1],
      explanation:
        'The trip service owns state transitions (REQUESTED → ASSIGNED → STARTED → COMPLETED/CANCELLED), invariants (one active trip per driver), contention (two trips assigned the same driver) and variation (pricing, cancellation fees) — rich material for State, Strategy and concurrency. High QPS makes ingestion an HLD topic, not an LLD one; the gateway is mostly infrastructure; the payment adapter is a narrower Adapter/retry exercise.',
      followUps: [
        {
          q: 'Name the invariant you would enforce first and the class that owns it.',
          a: 'A driver can hold at most one active trip. `Driver` (or a `DriverAvailability` aggregate) owns it via `assign(tripId)` which only transitions AVAILABLE → ASSIGNED; in a DB it becomes `UPDATE drivers SET state=\'ASSIGNED\', trip_id=$1 WHERE id=$2 AND state=\'AVAILABLE\'` with a row-count check, so two matchers can\'t both win.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-04',
      difficulty: 'expert',
      question:
        'This allocator starts with an empty block and receives 200 concurrent `nextId()` calls. What happens?',
      code: {
        language: 'typescript',
        code: `class Allocator {
  private next = 0n;
  private end = 0n;
  constructor(private store: { reserve(n: number): Promise<bigint> }) {}

  async nextId(): Promise<bigint> {
    if (this.next >= this.end) {
      const start = await this.store.reserve(1000);
      this.next = start;
      this.end = start + 1000n;
    }
    return this.next++;
  }
}`,
      },
      options: [
        'One reserve() call happens; Node runs the if-check for one caller at a time, so the rest wait',
        'Duplicate IDs are returned, because several callers share the same block after the overwrite',
        '200 reserve() calls; each caller returns the first ID of its own block, and ~199K IDs are wasted',
        'The calls deadlock because they all await the same store',
      ],
      correct: [2],
      explanation:
        'All 200 callers see an empty block before any `await` resolves, so each calls `reserve` — 200 round-trips. As each resumes it overwrites `next`/`end` with its own block and returns that block\'s first ID; blocks are disjoint, so no duplicates, but 199 blocks are abandoned after one ID (~199K wasted) and the counter row takes a 200× burst. Nothing serialises the check across awaits, and there is no deadlock.',
      followUps: [
        {
          q: 'Fix it with the smallest change.',
          a: 'Single-flight the refill: keep `private refill: Promise<void> | null`; if empty, `this.refill ??= store.reserve(1000).then(s => { this.next = s; this.end = s + 1000n; }).finally(() => this.refill = null)`, then `await this.refill` inside a `while (this.next >= this.end)` loop (a loop, because 1,000+ waiters can drain the new block). Return `this.next++` synchronously after the loop.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-05',
      difficulty: 'hard',
      question:
        'Minute 55 of a 90-minute round: the core "book slot" flow works for the happy path, two more must-haves (cancel, waitlist) are untouched, and you notice your entities lack validation. What is the best next move?',
      options: [
        'Add validation and typed errors to every entity first, since quality is scored',
        'Implement cancel end-to-end, then waitlist, then add validation on the contended booking path',
        'Write unit tests for booking to prove quality before adding features',
        'Refactor the booking service into Strategy + Factory so cancel and waitlist will be easier',
      ],
      correct: [1],
      explanation:
        'Functional completeness and a running demo carry the most weight; untouched must-haves cost more than missing validation on non-critical paths. Building the remaining features end-to-end first, then hardening the contended booking path, maximises the score. Validating everything first or writing tests now risks unfinished features; a speculative refactor at minute 55 is the classic way to end with nothing running.',
      followUps: [
        {
          q: 'Waitlist needs "when a booking is cancelled, promote the first waitlisted user". How do you keep cancel and waitlist decoupled?',
          a: 'Have `cancel` emit a `SlotFreed(slotId)` domain event to listeners; a `WaitlistPromoter` listener pops the first entry and calls `book` for them. Cancel doesn\'t know waitlists exist, and the promotion reuses the same atomic booking path. In a 90-minute round a synchronous in-process event bus (an array of listeners) is enough.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-06',
      difficulty: 'expert',
      question:
        'All unit tests pass with the in-memory repository. In production on Postgres, cancelled bookings keep showing as CONFIRMED. What is the root cause?',
      code: {
        language: 'typescript',
        code: `class InMemoryBookingRepo implements BookingRepo {
  private rows = new Map<string, Booking>();
  async findById(id: string) { return this.rows.get(id) ?? null; }
  async save(b: Booking) { this.rows.set(b.id, b); }
}

class BookingService {
  constructor(private repo: BookingRepo) {}
  async cancel(id: string) {
    const b = await this.repo.findById(id);
    if (!b) throw new NotFound(id);
    b.status = 'CANCELLED';
    // TODO: notify user
  }
}`,
      },
      options: [
        'Postgres runs at READ COMMITTED, so the cancelled status is not visible to the next read',
        'The in-memory repo returns the stored object itself, so mutating it "persists" without save(); the Postgres repo returns a copy and nothing is written',
        'The status field should be an enum; string literals are not persisted by the ORM',
        'cancel() is async without a lock, so a concurrent read overwrites the status',
      ],
      correct: [1],
      explanation:
        'The service never calls `save`. The in-memory repo hands out live references, so the mutation changes the stored object and tests pass by accident; the Postgres repo maps rows into new objects, so the change is lost. Isolation level would not hide a committed write that never happened; enums and locking are unrelated to a missing save.',
      followUps: [
        {
          q: 'How do you make the in-memory repository catch this class of bug in tests?',
          a: 'Copy on the way in and out: `save` stores `structuredClone(b)` (or a frozen snapshot) and `findById` returns a fresh clone, so only an explicit `save` changes stored state — the same semantics as a DB. Run one shared contract test suite against both repositories. Making entities immutable (methods return new instances) also forces an explicit save.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-07',
      difficulty: 'medium',
      question:
        'Machine-coding prompt: "Build a Buy-Now-Pay-Later system — users have credit limits, purchases create instalment schedules, repayments clear dues, overdue dues incur late fees." In 90 minutes, select ALL that are reasonable to stub behind an interface.',
      options: [
        'The payment gateway that collects repayments',
        'Persistence of users, purchases and schedules',
        'The credit-limit check that blocks purchases above available limit',
        'Sending SMS reminders for upcoming dues',
        'The instalment schedule calculation (dates and amounts)',
      ],
      correct: [0, 1, 3],
      explanation:
        'The gateway, storage and SMS are I/O that the problem is not testing — stub them with in-memory or fake implementations behind interfaces. The credit-limit check and schedule calculation *are* the domain rules being evaluated; stubbing them leaves nothing to assess and invites the "where is the logic?" question in the viva.',
      followUps: [
        {
          q: 'Late fees depend on "today". How do you demo an overdue scenario in a 2-minute demo?',
          a: 'Inject a `Clock` into the dues service and use a `FakeClock` in the driver: create a purchase on 1 Jan, `clock.advanceDays(35)`, run `applyLateFees()`, print the updated dues. No sleeping, deterministic output, and it doubles as the test fixture — a typical place evaluators award testability points.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-08',
      difficulty: 'hard',
      question:
        'The HLD fixed: "redirect p99 < 10 ms; click analytics may lag by minutes." Which LLD choice in the resolve path contradicts those NFRs?',
      options: [
        'A CachedLinkRepository decorator with a short negative-cache TTL for unknown codes',
        'Awaiting analyticsClient.track(code) before returning the redirect URL, with a 50 ms timeout',
        'A synchronous ClickSink.record() that appends to a bounded buffer flushed every 100 ms',
        'Re-checking expiresAt against an injected clock even when the link came from cache',
      ],
      correct: [1],
      explanation:
        'Awaiting analytics puts a network call (up to 50 ms with the timeout) into a path budgeted at 10 ms, for data the NFR says may lag — the timeout bounds the damage but still blows the budget. Negative caching protects the store from scanners, a bounded buffer keeps analytics off the hot path, and re-checking expiry keeps cached entries correct; all three fit the NFRs.',
      followUps: [
        {
          q: 'Analytics later becomes billable (advertisers pay per click). What changes in the class design?',
          a: 'Clicks can no longer be dropped when the buffer fills. Keep the hot path non-blocking but make the sink durable: append to a local write-ahead file or a Kafka producer with `acks=all` and an idempotent producer, fed from the buffer by a background flusher; add reconciliation against LB/CDN logs. The `ClickSink` interface stays; the implementation and its failure policy change.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-09',
      difficulty: 'expert',
      question:
        'In Node 20, one listener\'s Kafka publish rejects (broker down) during a redirect. What is the observable effect?',
      code: {
        language: 'typescript',
        code: `interface LinkEventListener { onResolved(link: ShortLink): Promise<void>; }

async resolve(code: string): Promise<string | null> {
  const link = await this.repo.findByCode(code);
  if (!link) return null;
  for (const l of this.listeners) {
    try { l.onResolved(link); } catch (e) { this.log.warn(e); }
  }
  return link.target.href;
}`,
      },
      options: [
        'The rejection is caught by the try/catch and logged as a warning',
        'resolve() rejects, so the user gets a 500 instead of the redirect',
        'The redirect succeeds, but the unhandled rejection crashes the process under Node\'s default --unhandled-rejections=throw',
        'Nothing at all — rejected promises that are not awaited are silently discarded',
      ],
      correct: [2],
      explanation:
        'The promise is neither awaited nor given a `.catch`, so the synchronous `try/catch` catches nothing; `resolve` returns normally. When the promise rejects, it has no handler, and since Node 15 the default mode turns unhandled rejections into an uncaught exception that terminates the process — taking down every in-flight redirect on the pod. Silently discarding was the pre-15 behaviour (with only a warning).',
      followUps: [
        {
          q: 'Fix it without making redirects wait for Kafka.',
          a: 'Attach a handler without awaiting: `void l.onResolved(link).catch((e) => this.log.warn(e))` — or make the listener interface synchronous (`record(): void`) and let the implementation buffer and own its error handling. Also add a process-level `unhandledRejection` metric/log as a safety net, but never rely on it as the fix.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-10',
      difficulty: 'hard',
      question:
        'For the URL-shortener LLD, select ALL dependencies of ShorteningService that should be expressed as interfaces (injected), rather than concrete classes used directly.',
      options: [
        'The link storage (in-memory now, Postgres or DynamoDB later)',
        'The source of the current time used for expiry',
        'The ShortCode value object that validates alias format',
        'The short-code generation algorithm (counter, random, permuted)',
        'The TargetUrl value object that normalises URLs',
      ],
      correct: [0, 1, 3],
      explanation:
        'Storage crosses an I/O boundary, time is non-deterministic, and code generation is a genuine variation point — all three belong behind interfaces so they can be swapped and faked. Value objects like `ShortCode` and `TargetUrl` are pure, deterministic domain types with one correct implementation; interfacing them adds indirection without any variation or testability gain.',
      followUps: [
        {
          q: 'An interviewer insists the generator needs no interface "because random is random". How do you justify it in one test?',
          a: 'Collision handling is untestable with real randomness: inject a stub generator that returns the same code twice, assert the service retries and that after 5 identical codes it fails with a "congested" error. Without the seam you would need to mock `crypto.randomInt` globally — a sign the dependency was hidden.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-11',
      difficulty: 'hard',
      question:
        'Your dispatcher enforces "max 10 notifications per user per minute" with an in-memory counter Map. It is deployed on 4 pods behind a round-robin load balancer. What is the effective per-user limit?',
      options: [
        'Exactly 10/min — round-robin spreads the user\'s requests evenly',
        'Up to 40/min, and anywhere between 10 and 40 depending on how requests are distributed',
        'Exactly 2.5/min per pod, which sums to 10/min',
        'Undefined — the counters will corrupt each other through shared memory',
      ],
      correct: [1],
      explanation:
        'Each pod counts independently, so a user can receive up to 10 per pod — 40/min in the worst case; with perfect round-robin it trends to 40, with skewed routing less. Pods do not share memory, so there is no corruption and no automatic division of the limit. Fixes: a shared atomic counter (Redis `INCR` + `EXPIRE`), or partition consumption by user ID so one pod owns each user.',
      followUps: [
        {
          q: 'Redis adds ~1 ms per check and you send 4,000 notifications/s. Is that acceptable, and what if Redis is down?',
          a: 'At 4,000 checks/s, a single Redis handles it easily (well under 100K ops/s) and 1 ms per notification is small against 250 ms provider calls. If Redis is down: transactional (OTP) should fail open with a local per-pod limit as a fallback, while promotional should fail closed or defer — the decision belongs in the `RateLimiter` implementation, configured per category.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-12',
      difficulty: 'medium',
      question:
        'Mid-interview twist: "Some links must now require a password before redirecting." Which change best indicates your shortener design was extensible?',
      options: [
        'Add a password?: string parameter to resolve() and an if-block that checks it',
        'Create ProtectedShortLink extends ShortLink and override resolve behaviour in the subclass',
        'Add a PasswordPolicy to an ordered list of ResolvePolicy checks run by resolve(), registered in the composition root',
        'Check the password in the HTTP controller before calling the service',
      ],
      correct: [2],
      explanation:
        'A policy chain makes the twist additive: a new class plus one registration, with expiry, password and future geo rules composed. Adding parameters and ifs grows resolve() with each twist; subclassing the entity mixes access policy into data and explodes with combinations (protected + geo-fenced?); checking in the controller leaks a business rule into the transport layer and is skipped by any other entry point.',
      followUps: [
        {
          q: 'The password check needs input from the user, but expiry doesn\'t. How do policies get what they need without a giant parameter list?',
          a: 'Pass a `ResolveContext` object (`{ now, ip, credentials?, country? }`) built by the controller; each policy reads what it needs and returns `ALLOW`, `DENY(reason)` or `CHALLENGE(kind)`. The controller maps `CHALLENGE(password)` to a password page. New policies add optional context fields without changing the method signature.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-13',
      difficulty: 'expert',
      question:
        'Two riders call selectRide concurrently in a single Node process; only one ride matches and it has 1 seat left (another ride with seats matches rider B\'s route only via a different strategy). Which statement is true?',
      code: {
        language: 'typescript',
        code: `async selectRide(rider: User, q: RideQuery, strategy: SelectionStrategy) {
  const candidates = this.rides.findOpen(q.from, q.to);
  const ride = strategy.pick(candidates, q.seats);
  if (!ride) throw new NoRideError();
  const fare = await this.pricing.quote(ride, q.seats); // I/O
  ride.reserve(q.seats); // throws if availableSeats < seats (synchronous check+decrement)
  return this.bookings.create(rider, ride, fare);
}`,
      },
      options: [
        'Both riders get the seat, because the pick happens before the await',
        'No oversell; the slower rider gets an error from reserve() even if re-running selection would now pick another eligible ride',
        'Neither rider gets the seat, because reserve() detects the conflict and rejects both',
        'The code is safe and optimal; picking before pricing is the recommended ordering',
      ],
      correct: [1],
      explanation:
        'Both pick the same ride before awaiting the quote, but `reserve` re-checks and decrements synchronously, so the second call throws and seats never go negative. The flaw is user-facing: the loser fails outright instead of re-selecting. Option 1 ignores the re-check in `reserve`; option 3 is wrong because the first reserve succeeds; option 4 misses that a stale pick should be retried.',
      followUps: [
        {
          q: 'Improve it so the loser gets the next best ride, without a global lock.',
          a: 'Wrap pick + reserve in a bounded retry: on `SeatsUnavailable` from `reserve`, exclude that ride and pick again (max 3 attempts). Better, reserve first and price after — `ride.reserve()` synchronously right after `pick`, then await the quote, releasing the seats if pricing fails. That shortens the stale window to zero and keeps the critical section synchronous.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-14',
      difficulty: 'hard',
      question:
        'In a submission\'s folder layout, `domain/short-link.ts` imports `InMemoryLinkRepository` from `infra/` so the ShortLink constructor can reject duplicate codes. What is the most important problem?',
      code: {
        language: 'typescript',
        code: `// domain/short-link.ts
import { repo } from '../infra/in-memory-link.repository';

export class ShortLink {
  constructor(readonly code: string, readonly url: string) {
    if (repo.has(code)) throw new Error('duplicate');
  }
}`,
      },
      options: [
        'The constructor should be async, because repository lookups are I/O',
        'The domain depends on infrastructure, inverting the dependency rule: swapping storage or testing ShortLink now requires the global in-memory repo',
        'Uniqueness should be checked with a regex in the constructor instead',
        'Throwing in a constructor is not allowed in TypeScript classes',
      ],
      correct: [1],
      explanation:
        'Dependencies must point inward (infra → ports → domain). Importing a concrete global repository into an entity couples the domain to one storage choice, makes it untestable in isolation, and still races (check in the constructor, write elsewhere). Uniqueness is a set-level rule enforced by the repository\'s atomic insert, not by an entity. Constructors can throw, and making them async is not possible nor the issue.',
      followUps: [
        {
          q: 'Where should the uniqueness rule live, and how does the entity stay "valid by construction"?',
          a: 'The entity validates what it can know alone (format, reserved words via `ShortCode.of`). Uniqueness across all links is enforced atomically by `LinkRepository.insertIfAbsent`, and the service translates `false` into `AliasTakenError`. That splits rules by the data they need: entity-local invariants in the entity, set invariants in the repository/DB constraint.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-15',
      difficulty: 'expert',
      question:
        'The HLD mandates an Idempotency-Key header for POST /payouts. In LLD, a candidate implements: "look up key → if a stored response exists return it; else execute payout, then store the response". A client times out at 3 s and retries while the first execution (taking 5 s) is still running. What happens?',
      options: [
        'The retry returns the stored response, because the key was recorded on arrival',
        'The payout executes twice, because nothing records the key until the first execution finishes',
        'The retry blocks until the first finishes, because the store serialises access per key',
        'The retry fails with a unique-constraint error, preventing the duplicate',
      ],
      correct: [1],
      explanation:
        'With "check, execute, then store", the key does not exist until the first payout completes, so the retry at ~3 s finds nothing and executes again. Nothing in that design serialises per key or inserts anything up front that a constraint could reject. The fix is to claim the key atomically before executing (`insertIfAbsent(key, IN_PROGRESS, requestHash)`), return 409/"processing" to concurrent retries, and store the final response on completion.',
      followUps: [
        {
          q: 'The first execution crashes after calling the bank but before storing the response. The key is stuck IN_PROGRESS. What now?',
          a: 'Give claims a lease (`claimedAt`, e.g. 60 s). A retry after expiry must not blindly re-execute; it runs a recovery step: query the bank by the payout reference derived from the idempotency key (most bank/PG APIs accept a client reference) and complete or fail the record from the bank\'s answer. Only if the bank has no record is it safe to execute again.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-16',
      difficulty: 'medium',
      question:
        'Atlassian-style code-design twist on your snake game: "the snake should grow only on every 3rd food eaten, and later we may vary this per level." Where does this rule belong?',
      options: [
        'A counter field and an if (eaten % 3 === 0) inside Snake.move()',
        'A GrowthPolicy interface injected into the Game/Snake, with EveryNthFoodGrowth(3) as one implementation',
        'A subclass SlowGrowingSnake extends Snake that overrides move()',
        'A global constant GROW_EVERY = 3 read by the board renderer',
      ],
      correct: [1],
      explanation:
        'The prompt itself signals variation ("may vary per level"), so the rule becomes a strategy injected where the game decides growth; per-level policies are new implementations, not edits. An inline counter works once but grows with each twist; a subclass per growth rule explodes when combined with other variations (speed, wrap-around walls); a renderer-level constant puts game rules in the presentation layer.',
      followUps: [
        {
          q: 'The interviewer then asks: "and walls now wrap around on level 2". Does your design absorb both twists at once?',
          a: 'Yes, if each variation is its own seam: `GrowthPolicy` and a `BoundaryPolicy` (`Solid` vs `Wraparound`, mapping a next head position to a valid one or a collision). A `Level` object composes the two policies plus speed, so level 2 is configuration — `new Level(new EveryNthFoodGrowth(3), new Wraparound())` — with no subclass per combination.',
        },
      ],
    },
    {
      id: 'lld-hld-to-lld-mcq-17',
      difficulty: 'expert',
      question:
        'Your machine-coding shortener (in-memory repos, keyed in-process mutex for quota checks, in-memory rate limiter, injected Clock) must move to 3 pods with Postgres. Select ALL changes that are actually required for correctness.',
      options: [
        'Enforce alias uniqueness with a UNIQUE constraint / ON CONFLICT instead of the in-memory check',
        'Move the per-user rate limiter to a shared atomic store (or route each user to one pod)',
        'Replace the keyed in-process mutex for "check quota then insert" with a DB-level guarantee (transaction with row lock or a conditional insert)',
        'Remove the Clock interface and call Date.now() directly, since pods have synchronised clocks',
        'Convert the service interfaces into abstract classes so NestJS can inject them',
      ],
      correct: [0, 1, 2],
      explanation:
        'Every in-process guarantee — the uniqueness check, the rate-limit counters and the mutex — protects only one process, so each must move to a shared mechanism. The Clock seam is about testability and is unaffected by scale-out (and pod clocks drift anyway). Abstract classes vs injection tokens is a framework convenience, not a correctness requirement.',
      followUps: [
        {
          q: 'Quota is "max 1,000 links per free user". Show the DB-level guarantee without a long transaction.',
          a: 'Keep a counter row per user and make the increment conditional in the same transaction as the insert: `UPDATE user_quota SET used = used + 1 WHERE user_id = $1 AND used < 1000` → if 0 rows, reject; else `INSERT INTO links ... ON CONFLICT DO NOTHING`, and if that inserts nothing, roll back. The row lock lasts only for the short transaction, and two pods can\'t both take the last slot.',
        },
      ],
    },
  ],
};

export default topic;
