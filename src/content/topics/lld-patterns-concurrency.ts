import type { Topic } from '../../types';

const topic: Topic = {
  id: 'lld-patterns-concurrency',
  phase: 'lld',
  order: 3,
  title: 'Design Patterns & Concurrency for LLD',
  subtitle:
    'The thirteen patterns that actually appear in LLD and machine-coding rounds, each with when to use it, idiomatic TypeScript and the trap interviewers set, plus how to make an in-memory design safe under concurrency, from one event loop to worker_threads to many pods.',
  estimatedMinutes: 130,
  sources: [
    'Gamma, Helm, Johnson, Vlissides — Design Patterns: Elements of Reusable Object-Oriented Software',
    'Eric Freeman & Elisabeth Robson — Head First Design Patterns, 2nd ed.',
    'Joshua Bloch — Effective Java, 3rd ed. (Items 1–3, 83: builders, singletons, lazy initialization)',
    'Brian Goetz — Java Concurrency in Practice (Ch 5, 13, 16)',
    'Martin Fowler — Patterns of Enterprise Application Architecture (Repository, Anemic Domain Model)',
    'async-mutex (npm) documentation; Node.js docs — worker_threads, Atomics',
  ],
  tags: [
    'lld',
    'machine-coding',
    'design-patterns',
    'strategy',
    'factory',
    'builder',
    'singleton',
    'observer',
    'state',
    'command',
    'decorator',
    'chain-of-responsibility',
    'repository',
    'mutex',
    'concurrency',
    'worker-threads',
  ],
  cheatSheet: [
    'Pick a pattern from a SMELL, never from a wish list: growing if/else on a type → Strategy + registry Factory; boolean soup for status → State; "notify A, B, C" → Observer; undo/retry/queue an action → Command.',
    'Factory as a registry (`Map<Type, Strategy>`) gives Open/Closed for free: a new vehicle or payment method is one registration, and an unknown type fails loudly instead of defaulting.',
    'Singleton via `static getInstance()` hides a dependency and breaks tests; in NestJS every provider is already a DI-managed singleton per module scope, so inject it instead.',
    'Decorator = same interface, adds behaviour (cache, retry, metrics). Adapter = different interface, translates. Facade = new, simpler interface over many classes. Proxy = same interface, controls access.',
    'In-process Observer: isolate listener failures (try/catch per listener) and never put work that must survive a crash there; cross-service events need an outbox + broker.',
    'Node in-memory store race: the check and the act are split by an `await`. Fix by removing the await from the critical section, or serialise per entity with `async-mutex` `runExclusive`.',
    'Two locks → lock ordering (sort by id) or you get an async deadlock; `withTimeout(new Mutex(), ms)` turns a silent hang into an error you can alert on.',
    'Optimistic versioning in memory: compare and set in ONE synchronous step; bounded retries; under heavy contention on one key it degrades, so switch to a per-key mutex or single-writer queue.',
    'Java lazy singleton: double-checked locking needs `volatile`; the holder idiom (class-init is thread-safe) or an `enum` is simpler and is what interviewers want to hear.',
    'Scope of a lock = scope of the memory it lives in: JS mutex → one event loop; SharedArrayBuffer + Atomics → worker_threads; DB constraint / conditional UPDATE / fenced lease → many pods.',
  ],
  sections: [
    {
      heading: 'How patterns are scored in an LLD round: smell first, pattern second',
      body: `**Intuition:** a pattern is a named answer to a recurring *change*. Interviewers do not award points for naming GoF patterns; they award points when the pattern makes the next requirement ("add a vehicle type", "add surge pricing", "undo the last move") a one-class change.

**HLD first, even for a pattern question.** Before drawing classes, state the scope (single process, in-memory, 60–90 minute build), the API (\`bookRide\`, \`cancelRide\`, \`fareFor\`) and the non-functionals that matter to the design (concurrency, extensibility, testability). Then let each *axis of change* pick its pattern:

| Smell you can point at in the requirement | Pattern | Why it earns its place |
|---|---|---|
| \`switch (vehicleType)\` repeated in 3 methods | **Strategy** + registry **Factory** | New type = new class + one registration |
| A family of objects that must match (client + webhook verifier + refund rules per provider) | **Abstract Factory** | Cannot mix Razorpay's client with Stripe's verifier |
| Constructor with 9 optional params, half invalid together | **Builder** | Validate once in \`build()\`, immutable result |
| \`isPaid && !isShipped && !isCancelled\` flags | **State** | Illegal transitions become impossible, not just unlikely |
| "When X happens, notify A, B, C (and D next quarter)" | **Observer** | Publisher does not know the subscribers |
| Undo / redo / queue / retry an action | **Command** | An action becomes data: it can be stored, replayed, de-duplicated |
| Add caching / retry / metrics around a dependency | **Decorator** | Stack behaviours without touching the class |
| Third-party SDK with the wrong shape | **Adapter** | Domain code depends on your interface |
| Sequence of checks, each may stop the request | **Chain of Responsibility** | Reorder and insert checks without editing the others |
| Same algorithm skeleton, steps differ | **Template Method** | The order of steps is fixed in one place |
| Domain must not know about SQL vs in-memory | **Repository** | Swap storage; machine coding starts in-memory |

**What evaluators at Flipkart, Razorpay, Swiggy, PhonePe and Uber write on the scorecard:** working demo, separation of concerns, extensibility (they *will* add a requirement at minute 60), naming, handling of concurrency for the shared state, and no over-engineering. One well-placed Strategy beats five decorative patterns.

**In interviews say this:** "The axis of change here is vehicle type and pricing rules, so pricing is a Strategy chosen by a Factory. Ride status is a State machine because illegal transitions are the bugs I care about. I am not adding a Visitor; nothing here needs it."`,
      diagram: `  Ride-booking module: where each pattern sits (in-memory, one process)

  RideController ..> RideService (Facade over the use case)
                        |
       +----------------+-----------------+--------------------+
       |                |                 |                    |
  FareStrategyFactory  RideRepository   RideEventBus      BookingChain
   <>-- FareStrategy   (Repository)     (Observer)        (Chain of Resp.)
        ^      ^        ^          ^      |   |            Auth -> Kyc ->
   PerKmFare SurgeFare InMemory  Postgres  SMS  Loyalty     Fraud -> Quota
                           Repo     Repo
  Ride <>-- RideState  (State: REQUESTED -> ASSIGNED -> ONGOING -> DONE)`,
      keyPoints: [
        'Name the axis of change first; the pattern follows from it.',
        'Extensibility is tested live: expect a new requirement in the last 30 minutes.',
        'Over-patterning loses points as surely as a god class does.',
      ],
      source: 'Gamma et al. — Design Patterns, Ch 1 (How design patterns solve design problems)',
    },
    {
      heading: 'Strategy and Factory / Abstract Factory: replacing the type switch',
      body: `**Intuition:** Strategy is "same question, swappable answer" (how much does this ride cost?). Factory is "who picks the answer" so callers never write \`new PerKmFare(...)\` or \`if (type === 'AUTO')\`.

**Strategy mechanics:** one interface (\`FareStrategy.fare(input)\`), one class per algorithm, the context holds a reference and delegates. Strategies should be **stateless** (or immutable) so one instance can be shared by every concurrent request; a strategy that caches per-ride data in a field is a race waiting to happen.

**Factory, the version that scales:** not a \`switch\` inside \`createStrategy()\` (that just moves the smell), but a **registry**: \`Map<VehicleType, FareStrategy>\` populated at boot. In NestJS the registry is filled by DI: every strategy is a provider tagged with a token, and the factory receives them all via a multi-provider or \`DiscoveryService\`.

**Abstract Factory** is for *families* that must be consistent. A payment provider has a client, a webhook signature verifier and refund rules; mixing Razorpay's verifier with Stripe's client is a production incident, so one factory per provider returns the whole family.

**The traps interviewers set:**
- **Default branch:** \`return this.byType.get(t) ?? sedanFare\` silently prices a new SUV as a sedan. Fail loudly at boot (validate the registry covers every enum value) or at call time.
- **Strategy explosion:** surge × vehicle × city = 60 classes. Compose instead: a base fare strategy wrapped by a surge Decorator, with numbers in config.
- **Money as float:** use integer paise/cents; round once at the end.`,
      code: [
        {
          language: 'typescript',
          title: 'Strategy + registry Factory for ride fares (integer paise)',
          code: `export type VehicleType = 'BIKE' | 'AUTO' | 'SEDAN' | 'SUV';
export interface FareInput { km: number; minutes: number; surge: number }

export interface FareStrategy {
  readonly type: VehicleType;
  fare(input: FareInput): number; // paise: never use floats for money
}

class PerKmFare implements FareStrategy {
  constructor(
    readonly type: VehicleType,
    private readonly base: number,
    private readonly perKm: number,
    private readonly perMin: number,
    private readonly minFare: number,
  ) {}
  fare({ km, minutes, surge }: FareInput): number {
    const raw = this.base + Math.ceil(km * this.perKm) + minutes * this.perMin;
    return Math.max(this.minFare, Math.round(raw * surge)); // stateless: safe to share
  }
}

// Factory as a registry: adding a vehicle = one registration, zero edits to callers.
export class FareStrategyFactory {
  private readonly byType = new Map<VehicleType, FareStrategy>();

  register(strategy: FareStrategy): this {
    if (this.byType.has(strategy.type)) throw new Error('duplicate strategy for ' + strategy.type);
    this.byType.set(strategy.type, strategy);
    return this;
  }

  for(type: VehicleType): FareStrategy {
    const s = this.byType.get(type);
    if (!s) throw new Error('no fare strategy for ' + type); // never fall back to SEDAN
    return s;
  }
}

export const fares = new FareStrategyFactory()
  .register(new PerKmFare('BIKE', 2000, 700, 100, 2500))
  .register(new PerKmFare('AUTO', 3000, 1100, 150, 3500))
  .register(new PerKmFare('SEDAN', 5000, 1500, 200, 8000));

// fares.for('AUTO').fare({ km: 5.2, minutes: 14, surge: 1.5 }) === 16230 paise`,
        },
        {
          language: 'typescript',
          title: 'Abstract Factory: one consistent family per payment provider',
          code: `export interface PaymentClient { charge(orderId: string, paise: number): Promise<string> }
export interface WebhookVerifier { verify(rawBody: Buffer, signature: string): boolean }
export interface RefundPolicy { maxRefundWindowDays: number; partialAllowed: boolean }

// The abstract factory: every method returns a member of the SAME family.
export interface PaymentProviderFactory {
  readonly name: 'razorpay' | 'stripe';
  client(): PaymentClient;
  webhookVerifier(): WebhookVerifier;
  refundPolicy(): RefundPolicy;
}

export class PaymentGatewayRouter {
  private readonly factories = new Map<string, PaymentProviderFactory>();

  constructor(all: PaymentProviderFactory[]) {
    for (const f of all) this.factories.set(f.name, f);
  }

  // Webhook handling picks verifier AND client from the same family,
  // so a Razorpay webhook can never be checked with Stripe's secret.
  forMerchant(provider: string): PaymentProviderFactory {
    const f = this.factories.get(provider);
    if (!f) throw new Error('unsupported provider ' + provider);
    return f;
  }
}`,
        },
      ],
      keyPoints: [
        'Strategies are stateless and shared; per-call data goes in arguments.',
        'A registry Factory removes the switch; validate coverage at boot.',
        'Abstract Factory guarantees family consistency, not just object creation.',
      ],
      source: 'Gamma et al. — Design Patterns: Strategy, Factory Method, Abstract Factory',
    },
    {
      heading: 'Builder, and Singleton (and why DI beats it)',
      body: `**Builder intuition:** an order for a cab fleet has 2 required fields and 9 optional ones, and some combinations are illegal (scheduled pickup without a time, corporate billing without a cost centre). A telescoping constructor hides that; a builder makes the illegal combination fail in one place, \`build()\`, and returns an **immutable** object.

**Builder traps:**
- Validating in each setter instead of \`build()\`: cross-field rules (A requires B) cannot be checked until the end.
- Returning a mutable object, or letting the builder be reused after \`build()\` so two orders share an array.
- Using a builder for a 3-field object: in TypeScript an options object with a type is enough. Builders earn their place with *cross-field invariants* or *staged construction*.

**Singleton intuition:** "exactly one instance" is a real need (one connection pool, one metrics registry). The **\`static getInstance()\`** implementation is the problem, not the need:
- It is a **hidden dependency**: \`BookingService\` calls \`RedisClient.getInstance()\` inside a method, so the constructor lies about what the class needs.
- **Tests share state** across cases and cannot substitute a fake without monkey-patching.
- **Lifecycle is implicit**: who closes it on shutdown? In what order?

**Dependency injection gives you the single instance without those costs.** In NestJS every provider is a singleton within its module scope by default (\`Scope.DEFAULT\`); \`Scope.REQUEST\` and \`Scope.TRANSIENT\` exist for the rare cases you need otherwise. The container owns creation and \`onModuleDestroy\` ordering, and tests use \`Test.createTestingModule(...).overrideProvider(...)\`.

**In Node, a module is already a singleton per process** (module cache), with two caveats interviewers like: two copies of the same package in \`node_modules\` produce two "singletons", and each worker thread or pod has its own.

**In interviews say this:** "I want one pool per process, so it is a DI-managed provider with a factory that awaits the connection; nothing calls \`getInstance\`. Java-style lazy singletons are a concurrency question, which I can cover separately."`,
      code: [
        {
          language: 'typescript',
          title: 'Builder with cross-field validation and an immutable result',
          code: `type Billing = { kind: 'PERSONAL' } | { kind: 'CORPORATE'; costCentre: string };

export interface RideRequest {
  readonly riderId: string;
  readonly pickup: string;
  readonly drop: string;
  readonly scheduledAt?: Date;
  readonly billing: Billing;
  readonly stops: readonly string[];
}

export class RideRequestBuilder {
  private scheduledAt?: Date;
  private billing: Billing = { kind: 'PERSONAL' };
  private readonly stops: string[] = [];
  private built = false;

  constructor(private readonly riderId: string, private readonly pickup: string, private readonly drop: string) {}

  scheduleAt(when: Date): this { this.scheduledAt = when; return this; }
  corporate(costCentre: string): this { this.billing = { kind: 'CORPORATE', costCentre }; return this; }
  addStop(place: string): this { this.stops.push(place); return this; }

  build(now = new Date()): RideRequest {
    if (this.built) throw new Error('builder already used'); // no shared arrays between two requests
    if (this.scheduledAt && this.scheduledAt.getTime() < now.getTime() + 15 * 60_000) {
      throw new Error('scheduled rides need at least 15 minutes notice');
    }
    if (this.stops.length > 3) throw new Error('at most 3 intermediate stops');
    if (this.billing.kind === 'CORPORATE' && this.stops.length > 0) {
      throw new Error('corporate rides cannot add stops'); // cross-field rule: only checkable here
    }
    this.built = true;
    return Object.freeze({
      riderId: this.riderId, pickup: this.pickup, drop: this.drop,
      scheduledAt: this.scheduledAt, billing: this.billing, stops: Object.freeze([...this.stops]),
    });
  }
}`,
        },
        {
          language: 'typescript',
          title: 'Singleton by DI (NestJS) instead of static getInstance()',
          code: `import { Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

@Module({
  providers: [
    {
      provide: REDIS,
      // Created once per app (default scope); the container owns its lifecycle.
      useFactory: async () => {
        const client = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 2 });
        await client.connect(); // boot fails fast if Redis is unreachable
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onModuleDestroy() { await this.redis.quit(); } // explicit shutdown ordering
}

@Injectable()
export class SeatHoldService {
  // The dependency is visible in the constructor and replaceable in tests:
  // Test.createTestingModule({...}).overrideProvider(REDIS).useValue(fakeRedis)
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
}`,
        },
      ],
      keyPoints: [
        'Builders earn their keep with cross-field invariants; validate in build().',
        'The need for one instance is fine; static access is the anti-pattern.',
        'Node module cache = per-process singleton, duplicated per worker, pod or duplicate package copy.',
      ],
      source: 'Joshua Bloch — Effective Java, Items 2–3; NestJS docs — Injection scopes',
    },
    {
      heading: 'Observer / pub-sub: decoupling side effects without losing them',
      body: `**Intuition:** the ride service should say "ride completed" once, and not know that SMS, loyalty points, driver payout and analytics care. Observer inverts the dependency: subscribers register; the subject publishes.

**In-process Observer vs a broker:**

| | In-process (EventEmitter, typed bus) | Broker (Kafka, SQS, Redis Streams) |
|---|---|---|
| Delivery | Same process, same tick or next microtask | Durable, survives crash |
| Failure of a subscriber | Can throw into the publisher if not isolated | Retried per consumer group |
| Ordering | Registration order | Per partition / per group |
| Use for | Decoupling inside one bounded context, cache invalidation, metrics | Anything that must happen even if this pod dies |

**The traps:**
- **One listener throws, the rest never run** (Node's \`EventEmitter.emit\` calls listeners synchronously and stops at the first throw). Wrap each listener.
- **Async listeners are fire-and-forget:** \`emit\` does not await them, so a rejected promise becomes an unhandled rejection, and the HTTP response returns before the side effect happened.
- **Leaks:** subscribing per request and never unsubscribing; Node prints \`MaxListenersExceededWarning\` at 11 listeners per event by default.
- **"Notify after commit":** publishing inside the DB transaction means subscribers see an event for data that may roll back. Publish after commit, and for cross-service events use the transactional outbox.

**In interviews say this:** "Inside the module I use a typed in-process bus with per-listener isolation for non-critical side effects. Payout is not optional, so it goes through an outbox to Kafka; the in-process observer would lose it on a crash."`,
      code: [
        {
          language: 'typescript',
          title: 'Typed event bus with per-listener isolation and unsubscribe',
          code: `type RideEvents = {
  'ride.completed': { rideId: string; riderId: string; farePaise: number };
  'ride.cancelled': { rideId: string; by: 'RIDER' | 'DRIVER'; reason: string };
};

type Listener<T> = (payload: T) => void | Promise<void>;

export class EventBus<E extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof E, Set<Listener<any>>>();

  constructor(private readonly onError: (event: keyof E, err: unknown) => void) {}

  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn);
    return () => set!.delete(fn); // caller keeps the disposer: no leaks
  }

  /** Awaits every listener; one failure never blocks the others. */
  async emit<K extends keyof E>(event: K, payload: E[K]): Promise<void> {
    const fns = [...(this.listeners.get(event) ?? [])]; // snapshot: listeners may unsubscribe mid-emit
    const results = await Promise.allSettled(fns.map(async (fn) => fn(payload)));
    for (const r of results) if (r.status === 'rejected') this.onError(event, r.reason);
  }
}

// usage
const bus = new EventBus<RideEvents>((e, err) => console.error('listener failed', e, err));
const stop = bus.on('ride.completed', async ({ riderId, farePaise }) => {
  // loyalty points: nice to have, so the in-process observer is acceptable
  await Promise.resolve(riderId + ' earns ' + Math.floor(farePaise / 10000) + ' points');
});
// stop() on module shutdown`,
        },
      ],
      keyPoints: [
        'Isolate listeners; snapshot the listener set before iterating.',
        'In-process events are lost on crash: anything mandatory goes through an outbox.',
        'Publish after commit, never inside the transaction.',
      ],
      source: 'Gamma et al. — Design Patterns: Observer',
    },
    {
      heading: 'State: making illegal transitions impossible',
      body: `**Intuition:** an order is a board game piece: from PAID you may move to SHIPPED or CANCELLED, never back to CREATED. Encoding that as flags (\`isPaid\`, \`isShipped\`, \`isCancelled\`) allows 8 combinations of which 3 are legal; encoding it as a State makes the other 5 unrepresentable.

**Two implementations, both acceptable in a round:**

| | Transition table (\`Record<State, Partial<Record<Event, State>>>\`) | State objects (GoF) |
|---|---|---|
| Best when | Transitions are data; few side effects | Each state has behaviour (what \`cancel\` does when PAID: refund) |
| Adding a state | One row | One class/object |
| Visualise / audit | Trivial (print the table) | Needs docs |
| Trap | Side effects creep into a giant switch next to it | State objects holding per-order data (share them; keep data on the context) |

**Mechanics of the GoF version:** the context (\`Order\`) holds a reference to the current state and delegates \`apply(event)\`; each state returns the next state or throws. State objects are **stateless singletons**, the order's data lives on the context.

**Concurrency trap:** two requests (driver "arrived" and rider "cancel") race on the same order. The State pattern makes each transition legal *in isolation*, but you still need the transition to be atomic against the stored status: \`UPDATE orders SET status='CANCELLED', version=version+1 WHERE id=$1 AND status='PAID' AND version=$2\`, or a per-order mutex in an in-memory machine-coding build.

**In interviews say this:** "Status is a state machine. I keep the states stateless and the data on the context, persist the status with a version, and the transition is a compare-and-set on (status, version) so two concurrent events cannot both win."`,
      code: [
        {
          language: 'typescript',
          title: 'Order lifecycle with stateless state objects',
          code: `type OrderEvent = 'PAY' | 'SHIP' | 'DELIVER' | 'CANCEL';

interface OrderState {
  readonly name: string;
  on(event: OrderEvent, order: Order): OrderState; // returns the next state
}

class IllegalTransition extends Error {}
const reject = (s: OrderState, e: OrderEvent): never => {
  throw new IllegalTransition(e + ' not allowed in ' + s.name);
};

const Created: OrderState = {
  name: 'CREATED',
  on(e) {
    if (e === 'PAY') return Paid;
    if (e === 'CANCEL') return Cancelled;
    return reject(this, e);
  },
};
const Paid: OrderState = {
  name: 'PAID',
  on(e, order) {
    if (e === 'SHIP') return Shipped;
    if (e === 'CANCEL') { order.refundRequested = true; return Cancelled; } // behaviour lives with the state
    return reject(this, e);
  },
};
const Shipped: OrderState = {
  name: 'SHIPPED',
  on(e) { return e === 'DELIVER' ? Delivered : reject(this, e); }, // no cancel after dispatch
};
const Delivered: OrderState = { name: 'DELIVERED', on(e) { return reject(this, e); } };
const Cancelled: OrderState = { name: 'CANCELLED', on(e) { return reject(this, e); } };

export class Order {
  private state: OrderState = Created;
  refundRequested = false;
  version = 0;
  readonly history: string[] = ['CREATED'];

  apply(event: OrderEvent): void {
    this.state = this.state.on(event, this); // no switch on a status string anywhere
    this.version++;
    this.history.push(this.state.name);
  }
  get status(): string { return this.state.name; }
}`,
        },
      ],
      keyPoints: [
        'Flags allow illegal combinations; a State makes them unrepresentable.',
        'States are shared and stateless; data stays on the context.',
        'A legal transition still needs an atomic compare-and-set against concurrent events.',
      ],
      source: 'Gamma et al. — Design Patterns: State',
    },
    {
      heading: 'Command: undo, redo and idempotent actions',
      body: `**Intuition:** turn "add 2 teas to the cart" from a method call into an **object**. Once an action is data, you can queue it, log it, retry it, undo it and refuse to apply it twice.

**Mechanics:** \`Command { id; execute(); undo() }\`; an invoker (\`CommandBus\`) keeps a \`done\` stack and an \`undone\` stack. \`undo\` pops from \`done\`, calls \`undo()\`, pushes to \`undone\`; any **new** command clears the redo stack (otherwise redo would replay onto a different history).

**Undo has two strategies:**
- **Inverse operation** (add ↔ remove): cheap, but only correct if the operation is invertible. "Remove 5" when only 3 existed is not inverted by "add 5".
- **Memento / snapshot** of what the command destroyed (\`ClearCart\` stores the previous lines). Costs memory; bound the history.

**Idempotency is the backend twist interviewers add:** a mobile client retries "add to cart" after a timeout, or a double-tap fires twice. Give every command a client-generated \`id\` and keep the set of applied ids (bounded by time or count). In a distributed system this becomes an idempotency-key table with a unique constraint; in a machine-coding round a \`Set\` with eviction is enough, as long as you say where it would live in production.

**Traps:**
- Commands capturing mutable references (the \`sku\` array the caller later mutates).
- Unbounded history: a long-lived editor session grows memory forever.
- Undo of an action with an external side effect (an SMS was sent): you cannot unsend. Model it as a *compensating* command, not an undo.`,
      code: [
        {
          language: 'typescript',
          title: 'Cart commands with undo/redo, snapshot undo and idempotent ids',
          code: `interface Command {
  readonly id: string; // client-generated: the same id is applied at most once
  execute(): void;
  undo(): void;
}

export class Cart {
  readonly lines = new Map<string, number>();
  add(sku: string, qty: number) { this.lines.set(sku, (this.lines.get(sku) ?? 0) + qty); }
  remove(sku: string, qty: number) {
    const left = (this.lines.get(sku) ?? 0) - qty;
    if (left > 0) this.lines.set(sku, left); else this.lines.delete(sku);
  }
}

export class AddItem implements Command {
  constructor(readonly id: string, private cart: Cart, private sku: string, private qty: number) {}
  execute() { this.cart.add(this.sku, this.qty); }
  undo() { this.cart.remove(this.sku, this.qty); } // inverse operation
}

export class ClearCart implements Command {
  private snapshot = new Map<string, number>(); // not invertible: remember what we destroyed
  constructor(readonly id: string, private cart: Cart) {}
  execute() { this.snapshot = new Map(this.cart.lines); this.cart.lines.clear(); }
  undo() { for (const [sku, q] of this.snapshot) this.cart.lines.set(sku, q); }
}

export class CommandBus {
  private readonly done: Command[] = [];
  private readonly undone: Command[] = [];
  private readonly applied = new Set<string>();

  constructor(private readonly maxHistory = 100) {}

  dispatch(cmd: Command): void {
    if (this.applied.has(cmd.id)) return; // double tap / client retry: no second effect
    cmd.execute();
    this.applied.add(cmd.id);
    this.done.push(cmd);
    if (this.done.length > this.maxHistory) this.done.shift(); // bounded memory
    this.undone.length = 0; // a new action invalidates the redo branch
  }
  undo(): void { const c = this.done.pop(); if (c) { c.undo(); this.undone.push(c); } }
  redo(): void { const c = this.undone.pop(); if (c) { c.execute(); this.done.push(c); } }
}`,
        },
      ],
      keyPoints: [
        'A command is an action as data: queue, log, retry, undo, de-duplicate.',
        'Inverse undo for invertible ops, snapshot undo for destructive ones.',
        'External side effects get compensating commands, not undo.',
      ],
      source: 'Gamma et al. — Design Patterns: Command, Memento',
    },
    {
      heading: 'Decorator, Adapter, Facade (and Proxy): four wrappers, four intents',
      body: `**Intuition:** all four wrap something; what differs is the *interface* they expose and *why*.

| Pattern | Interface exposed | Intent | Backend example |
|---|---|---|---|
| **Decorator** | Same as the wrapped object | Add behaviour, stackable | Caching, retry, metrics around \`RateProvider\` |
| **Proxy** | Same | Control access (lazy load, auth, remote) | Lazy-connecting client, access-checking repo |
| **Adapter** | Different (yours) | Translate a foreign API | Callback-based SMS SDK → \`SmsSender\` promise API |
| **Facade** | New, smaller | Simplify a subsystem | \`CheckoutFacade.placeOrder\` over inventory, pricing, payment |

**Decorator order is semantics, not style.** \`Caching(Retrying(Http))\` caches only successful results and retries misses; \`Retrying(Caching(Http))\` retries around the cache (pointless for hits). Put **metrics outermost** to measure what callers experience, or innermost to measure the dependency.

**Adapter is where your domain stops depending on a vendor.** The domain owns \`SmsSender\`; \`MsgVendorAdapter\` implements it. Switching vendors (or adding a fallback vendor) touches one class. Translate errors too: a vendor's \`ERR_DND\` becomes your \`RecipientOptedOut\`.

**Facade trap:** a facade that grows business rules becomes the next god class. It should orchestrate (call A, then B, then C) and keep decisions inside the domain objects.

**In NestJS** decorators-as-pattern are just providers that wrap other providers (\`useFactory: (http) => new CachingRateProvider(new RetryingRateProvider(http))\`), not TypeScript \`@Decorators\` (which are metadata annotations, a different thing).`,
      code: [
        {
          language: 'typescript',
          title: 'Decorators stacked around a rate provider, and an Adapter for a callback SDK',
          code: `export interface RateProvider { getRate(from: string, to: string): Promise<number> }

export class CachingRateProvider implements RateProvider {
  private readonly cache = new Map<string, { rate: number; exp: number }>();
  constructor(private readonly inner: RateProvider, private readonly ttlMs = 30_000) {}
  async getRate(from: string, to: string): Promise<number> {
    const key = from + ':' + to;
    const hit = this.cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.rate;
    const rate = await this.inner.getRate(from, to); // only successes get cached
    this.cache.set(key, { rate, exp: Date.now() + this.ttlMs });
    return rate;
  }
}

export class RetryingRateProvider implements RateProvider {
  constructor(private readonly inner: RateProvider, private readonly attempts = 3) {}
  async getRate(from: string, to: string): Promise<number> {
    for (let i = 1; ; i++) {
      try { return await this.inner.getRate(from, to); }
      catch (e) {
        if (i >= this.attempts) throw e;
        await new Promise((r) => setTimeout(r, 50 * 2 ** i * (0.5 + Math.random()))); // jittered backoff
      }
    }
  }
}
// const rates = new CachingRateProvider(new RetryingRateProvider(new HttpRateProvider(url)));

// ---- Adapter: vendor SDK with callbacks and string error codes ----
interface LegacySmsSdk {
  send(opts: { to: string; body: string }, cb: (err: { code: string } | null, msgId?: string) => void): void;
}
export class RecipientOptedOut extends Error {}
export interface SmsSender { send(to: string, text: string): Promise<string> }

export class LegacySmsAdapter implements SmsSender {
  constructor(private readonly sdk: LegacySmsSdk) {}
  send(to: string, text: string): Promise<string> {
    return new Promise((resolve, reject) =>
      this.sdk.send({ to, body: text }, (err, msgId) => {
        if (!err) return resolve(msgId!);
        reject(err.code === 'ERR_DND' ? new RecipientOptedOut(to) : new Error('sms failed: ' + err.code));
      }),
    );
  }
}`,
        },
      ],
      keyPoints: [
        'Same interface + added behaviour = Decorator; different interface = Adapter; smaller interface = Facade.',
        'Decorator stacking order changes behaviour; state it explicitly.',
        'Adapters translate errors as well as calls.',
      ],
      source: 'Gamma et al. — Design Patterns: Decorator, Adapter, Facade, Proxy',
    },
    {
      heading: 'Chain of Responsibility and Template Method: ordered steps, two ways',
      body: `**Intuition:** Chain of Responsibility is airport security: each desk either stops you or passes you to the next, and desks can be added or reordered without retraining the others. Template Method is a recipe card: the order of steps is fixed by the parent, and subclasses fill in individual steps.

**Chain mechanics:** each handler has \`check(ctx)\` and a \`next\`. A handler may **short-circuit** (reject), **enrich** the context, or **pass**. Express/NestJS middleware, guards and interceptors are chains; so are discount engines ("first applicable coupon wins") and booking pre-checks.

**Template Method mechanics:** an abstract base defines a final \`run()\` that calls protected steps (\`fetch\`, \`transform\`, \`serialize\`) and optional **hooks** with default no-op bodies. Notice that the chain's \`handle()\` below *is* a template method: the skeleton (check, short-circuit, forward) is fixed; only \`check\` varies.

**Template Method vs Strategy:** inheritance vs composition. Template Method fixes the algorithm skeleton at compile time and is fine for 2–3 variants inside one module. When variants multiply or must be chosen at runtime, extract the varying step into a Strategy.

**Traps interviewers probe:**
- **Hidden ordering dependencies:** the fraud check reads \`ctx.riskScore\` that the KYC handler sets; reorder them and fraud silently passes. Make dependencies explicit (typed context stages) or assert at chain build time.
- **Chain falls off the end:** decide whether "no handler rejected" means allow (validation chains) or deny (authorization chains: default deny).
- **Cost order:** put cheap, high-rejection checks first (quota, input validation) and expensive ones (fraud model call, 40 ms) last.`,
      code: [
        {
          language: 'typescript',
          title: 'Booking pre-checks as a chain; handle() is itself a template method',
          code: `export interface BookingContext {
  riderId: string;
  kycVerified: boolean;
  bookingsLastHour: number;
  walletPaise: number;
  estimatedFarePaise: number;
  riskScore?: number; // set by FraudCheck, read by later handlers
}
export type Verdict = { ok: true } | { ok: false; code: string };

export abstract class BookingCheck {
  private next?: BookingCheck;

  setNext(next: BookingCheck): BookingCheck { this.next = next; return next; } // enables a.setNext(b).setNext(c)

  // Template method: the skeleton is fixed, subclasses only implement check().
  async handle(ctx: BookingContext): Promise<Verdict> {
    const v = await this.check(ctx);
    if (!v.ok) return v;                                  // short-circuit
    return this.next ? this.next.handle(ctx) : { ok: true }; // end of chain = allow
  }
  protected abstract check(ctx: BookingContext): Promise<Verdict>;
}

export class QuotaCheck extends BookingCheck {
  protected async check(c: BookingContext): Promise<Verdict> {
    return c.bookingsLastHour < 5 ? { ok: true } : { ok: false, code: 'QUOTA' }; // cheap: first
  }
}
export class KycCheck extends BookingCheck {
  protected async check(c: BookingContext): Promise<Verdict> {
    return c.kycVerified ? { ok: true } : { ok: false, code: 'KYC_PENDING' };
  }
}
export class FraudCheck extends BookingCheck {
  constructor(private readonly score: (riderId: string) => Promise<number>) { super(); }
  protected async check(c: BookingContext): Promise<Verdict> {
    c.riskScore = await this.score(c.riderId); // expensive (~40 ms model call): last
    return c.riskScore < 0.8 ? { ok: true } : { ok: false, code: 'RISK' };
  }
}

// const chain = new QuotaCheck();
// chain.setNext(new KycCheck()).setNext(new FraudCheck(fraudClient.score));
// const verdict = await chain.handle(ctx);`,
        },
      ],
      keyPoints: [
        'Chain: each handler rejects, enriches or passes; order cheap checks first.',
        'Template Method fixes the skeleton via inheritance; Strategy swaps a step via composition.',
        'Decide explicitly what falling off the end of the chain means.',
      ],
      source: 'Gamma et al. — Design Patterns: Chain of Responsibility, Template Method',
    },
    {
      heading: 'Repository with optimistic versioning: the machine-coding storage seam',
      body: `**Intuition:** the domain asks "give me wallet w1" and "save it"; whether that is a \`Map\`, Postgres or DynamoDB is the repository's business. In a 90-minute machine-coding round this is what lets you ship an in-memory store and still answer "how would this run in production?".

**Mechanics:** one interface per aggregate (\`WalletRepository\`, not a generic \`Repository<any>\` with 30 methods), returning domain objects, never ORM entities or rows. The in-memory implementation must behave like a database in the two ways that matter:
1. **Copy on read and write** (\`structuredClone\`): otherwise a caller mutates the stored object without calling \`save\`, and your tests pass for the wrong reason.
2. **Optimistic concurrency:** \`save\` succeeds only if the stored \`version\` equals the version the caller read, and bumps it. In Node the compare and the set are one synchronous block, so they are atomic within the process; in Postgres it is \`UPDATE ... WHERE id=$1 AND version=$2\`.

**Idempotent commands on top:** a retried \`debit(commandId)\` must return the first result, not debit twice. Store the *promise* per command id so a retry arriving while the first attempt is still running joins it.

**Where optimistic versioning stops working:** many writers on one key. Every round only one CAS wins; with bounded retries the others fail (see the MCQ that runs this code with 5 concurrent debits and 3 attempts). For a hot key switch to a per-key mutex or a single-writer queue.

**Traps:** repositories that leak query builders (\`findWhere(qb => ...)\`), generic repositories that force every aggregate to support every query, and "repository" methods containing business rules (\`debitIfEnough\`) that belong on the entity.`,
      code: [
        {
          language: 'typescript',
          title: 'In-memory repository with version CAS, and an idempotent debit on top',
          code: `export class ConcurrencyError extends Error {}
export interface Versioned { id: string; version: number }

export interface Repository<T extends Versioned> {
  findById(id: string): Promise<T | undefined>;
  save(entity: T): Promise<T>; // succeeds only if stored version === entity.version
}

export class InMemoryRepository<T extends Versioned> implements Repository<T> {
  private readonly rows = new Map<string, T>();

  async findById(id: string): Promise<T | undefined> {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : undefined; // never hand out the stored object
  }

  async save(entity: T): Promise<T> {
    const expected = this.rows.get(entity.id)?.version ?? 0;
    if (entity.version !== expected) {
      throw new ConcurrencyError(entity.id + ': expected v' + expected + ', got v' + entity.version);
    }
    const next = { ...structuredClone(entity), version: expected + 1 };
    this.rows.set(entity.id, next); // compare + set in ONE synchronous block
    return structuredClone(next);
  }
}

type Wallet = Versioned & { balance: number };

export class WalletService {
  private readonly processed = new Map<string, Promise<number>>(); // commandId -> result

  constructor(private readonly repo: Repository<Wallet>) {}

  debit(commandId: string, walletId: string, amount: number): Promise<number> {
    const seen = this.processed.get(commandId);
    if (seen) return seen; // retry joins or replays the first attempt
    const p = this.debitWithRetry(walletId, amount);
    this.processed.set(commandId, p);
    p.catch(() => this.processed.delete(commandId)); // a failed command may be retried
    return p;
  }

  private async debitWithRetry(walletId: string, amount: number, attempts = 3): Promise<number> {
    for (let i = 1; ; i++) {
      const w = await this.repo.findById(walletId);
      if (!w) throw new Error('wallet not found');
      if (w.balance < amount) throw new Error('insufficient funds');
      try {
        return (await this.repo.save({ ...w, balance: w.balance - amount })).balance;
      } catch (e) {
        if (!(e instanceof ConcurrencyError) || i === attempts) throw e; // bounded retries
      }
    }
  }
}`,
        },
      ],
      keyPoints: [
        'One repository per aggregate; return domain objects, not rows.',
        'In-memory repos must copy and version-check, or they hide real bugs.',
        'Store the in-flight promise per command id so concurrent retries join it.',
      ],
      source: 'Martin Fowler — Patterns of Enterprise Application Architecture: Repository, Optimistic Offline Lock',
    },
    {
      heading: 'Anti-patterns: god class, anaemic model, over-patterning',
      body: `**Intuition:** the three ways an LLD answer loses points even when the code runs: everything in one place, all data and no behaviour, or patterns as decoration.

| Anti-pattern | How it looks in a round | Why it hurts | Fix |
|---|---|---|---|
| **God class** | \`ParkingLotService\` with 40 methods: pricing, spot allocation, payments, notifications, reports | Every change touches it; merge conflicts; untestable | Split by axis of change: \`SpotAllocator\` (Strategy), \`PricingPolicy\`, \`TicketRepository\`, \`EventBus\` |
| **Anaemic domain model** | \`Wallet { balance }\` with public fields; \`WalletService.debit\` does \`if (w.balance < x)\` | Invariants live far from the data; any caller can set \`balance = -500\` | Move rules onto the entity: \`wallet.debit(x)\` throws; fields private |
| **Over-patterning** | Abstract Factory of Builders of Strategies for a 2-rule pricing; a Visitor "for future reports" | Slower to build, harder to read; evaluators mark it as poor judgement | YAGNI: introduce a pattern when the second variant arrives, and *say* where it would go |
| **Singleton everywhere** | \`Config.getInstance()\`, \`Db.getInstance()\` inside methods | Hidden coupling, shared test state | Constructor injection |
| **Boolean-flag state** | \`isActive\`, \`isBlocked\`, \`isDeleted\` | Illegal combos representable | State / enum + transition table |

**Rich model is not "put everything on the entity".** Rules that involve one aggregate (a wallet cannot go below its overdraft limit) belong on the entity. Rules that coordinate several aggregates or external systems (transfer between two wallets, then notify) belong in a domain or application service.

**Over-patterning tell:** if you cannot name the concrete second implementation, the interface is premature. In a machine-coding round, "I would extract a \`SpotAllocationStrategy\` the moment we add EV spots; for now it is one method" is a senior answer.`,
      code: [
        {
          language: 'typescript',
          title: 'Anaemic vs rich: where the overdraft rule lives',
          code: `// Anaemic: the entity is a struct; every service must remember the rules.
class WalletData { balancePaise = 0; overdraftLimitPaise = 0; frozen = false }
class AnaemicWalletService {
  debit(w: WalletData, amount: number) {
    if (w.frozen) throw new Error('frozen');
    if (w.balancePaise - amount < -w.overdraftLimitPaise) throw new Error('limit');
    w.balancePaise -= amount; // the refund service forgot the frozen check last sprint
  }
}

// Rich: the entity guards its own invariants; services orchestrate.
export class Wallet {
  private balance: number;
  private frozen = false;

  constructor(readonly id: string, opening: number, private readonly overdraftLimit: number) {
    this.balance = opening;
  }

  debit(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) throw new RangeError('amount must be positive paise');
    if (this.frozen) throw new Error('wallet frozen');
    if (this.balance - amount < -this.overdraftLimit) throw new Error('overdraft limit exceeded');
    this.balance -= amount;
  }

  credit(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) throw new RangeError('amount must be positive paise');
    this.balance += amount; // credits allowed while frozen (refunds), by business rule
  }

  freeze(): void { this.frozen = true; }
  get balancePaise(): number { return this.balance; }
}`,
        },
      ],
      keyPoints: [
        'God class: split by axis of change, not by layer.',
        'Single-aggregate invariants on the entity; cross-aggregate coordination in services.',
        'No second implementation in sight → no interface yet; say where it would go.',
      ],
      source: 'Martin Fowler — AnemicDomainModel (bliki); Eric Evans — Domain-Driven Design, Ch 5–6',
    },
    {
      heading: 'Races in in-memory stores: async-mutex, lock granularity and lock ordering',
      body: `**Intuition:** a machine-coding round almost always has shared in-memory state (seats, spots, wallets, inventory) and the evaluator will ask "what if two requests hit this at once?". In Node the answer is not "single-threaded, so safe": a method is atomic only **until its first \`await\`**.

**Three fixes, in order of preference:**
1. **No await inside the critical section.** Do the check and the mutation synchronously, then await the side effect (audit log, notification). If the side effect fails, compensate. This is free and cannot deadlock.
2. **Per-entity mutex** when the await must sit between check and act (the journal must be written before the balance changes). \`async-mutex\` gives \`Mutex.runExclusive\`, \`tryAcquire\` and \`withTimeout\`. Lock **per entity** (one mutex per wallet), not one global mutex, or every transfer in the system serialises.
3. **Optimistic versioning** (previous section) when conflicts are rare.

**Multi-entity operations need lock ordering.** \`transfer(A, B)\` locks A then B; a concurrent \`transfer(B, A)\` locks B then A; each waits for the other forever. Async mutexes deadlock exactly like threads, just silently: no thread dump, only requests that never complete. Always acquire in a global order (sort by id), and wrap mutexes in \`withTimeout\` so a bug becomes an error you can see.

**Java equivalent interviewers expect:** \`synchronized\` on the entity or a \`ReentrantLock\` per wallet with \`tryLock(timeout)\`, ordered by id; \`ConcurrentHashMap.compute(key, fn)\` for single-key atomic updates.

**Say the limit out loud:** this mutex lives in one process's heap. With two pods, two mutexes exist and nothing is protected (last section).`,
      code: [
        {
          language: 'typescript',
          title: 'Per-wallet async-mutex with lock ordering and timeouts',
          code: `import { Mutex, withTimeout } from 'async-mutex';

class Wallet {
  // A stuck holder fails waiting callers after 2 s instead of hanging them forever.
  readonly lock = withTimeout(new Mutex(), 2_000);
  constructor(readonly id: string, public balance: number) {}
}

export class WalletLedger {
  private readonly wallets = new Map<string, Wallet>();
  constructor(private readonly journal: (line: string) => Promise<void>) {}

  open(id: string, balance: number): void { this.wallets.set(id, new Wallet(id, balance)); }

  async transfer(fromId: string, toId: string, amount: number): Promise<void> {
    if (fromId === toId) throw new Error('same wallet'); // would wait on its own mutex
    const from = this.must(fromId);
    const to = this.must(toId);
    // Lock ORDERING: always lock the lower id first, so A->B and B->A cannot deadlock.
    const [first, second] = fromId < toId ? [from, to] : [to, from];
    await first.lock.runExclusive(() =>
      second.lock.runExclusive(async () => {
        if (from.balance < amount) throw new Error('insufficient funds');
        await this.journal(fromId + '->' + toId + ' ' + amount); // this await is now safe
        from.balance -= amount;
        to.balance += amount;
      }),
    );
  }

  balanceOf(id: string): number { return this.must(id).balance; }

  private must(id: string): Wallet {
    const w = this.wallets.get(id);
    if (!w) throw new Error('unknown wallet ' + id);
    return w;
  }
}
// 50 x transfer(A,B,3) and 50 x transfer(B,A,2) concurrently: A+B stays 200, no timeouts.`,
        },
      ],
      keyPoints: [
        'Best fix: keep awaits out of the critical section.',
        'Lock per entity, acquire in sorted order, always with a timeout.',
        'An async deadlock shows up as hung requests with no stack trace; withTimeout surfaces it.',
      ],
      source: 'async-mutex documentation; Brian Goetz — Java Concurrency in Practice, Ch 10 (lock ordering)',
    },
    {
      heading: 'Producer–consumer with a bounded queue: backpressure in one process',
      body: `**Intuition:** a kitchen with a ticket rail of 20 slots. If waiters keep pinning tickets when the rail is full, tickets fall on the floor (memory blow-up, lost orders); a bounded rail forces the waiter to wait or to tell the customer "kitchen is full".

**Why unbounded is the bug:** an in-process \`items: T[]\` queue with producers at 2,000/s and consumers at 1,500/s grows by 500 items/s; at 4 KB each that is 2 MB/s, an OOM-kill in under an hour, and every queued item is lost on that kill anyway.

**A bounded queue needs a full-queue policy, chosen per use case:**

| Policy | Producer experience | Use when |
|---|---|---|
| **Block** (await \`put\`) | Slows down to consumer speed | Producer is a loop you control (file import, Kafka consumer with pause) |
| **Reject** (\`offer\` returns false) | Gets an immediate "no" → HTTP 429/503 | Producer is a user request; failing fast beats timing out |
| **Drop oldest / newest** | Never waits | Telemetry, location pings where newer data supersedes |

**Java vocabulary interviewers use:** \`ArrayBlockingQueue\` (\`put\` blocks, \`offer\` returns false, \`offer(e, timeout)\`), \`LinkedBlockingQueue\` (unbounded by default: a classic production trap), and \`ThreadPoolExecutor\` with a bounded queue plus \`RejectedExecutionHandler\` (\`CallerRunsPolicy\` is built-in backpressure).

**In Node:** consumers are async loops, not threads; the queue protects memory and smooths bursts, and \`N\` consumer loops give concurrency \`N\` for I/O work. Streams already implement this (\`highWaterMark\`, \`write()\` returning false, \`'drain'\`). And remember the queue is in-process: anything that must survive a pod restart belongs in a broker (BullMQ, SQS, Kafka).`,
      code: [
        {
          language: 'typescript',
          title: 'Bounded async queue with blocking put, rejecting offer and consumer loops',
          code: `export class BoundedQueue<T> {
  private readonly items: T[] = [];
  private readonly waitingConsumers: ((item: T) => void)[] = [];
  private readonly waitingProducers: (() => void)[] = [];

  constructor(private readonly capacity: number) {}

  async put(item: T): Promise<void> {
    const consumer = this.waitingConsumers.shift();
    if (consumer) return consumer(item); // direct hand-off, buffer untouched
    while (this.items.length >= this.capacity) {
      await new Promise<void>((r) => this.waitingProducers.push(r)); // backpressure
    }
    this.items.push(item);
  }

  /** For producers that must not wait (an HTTP handler): false => shed load with 429. */
  offer(item: T): boolean {
    const consumer = this.waitingConsumers.shift();
    if (consumer) { consumer(item); return true; }
    if (this.items.length >= this.capacity) return false;
    this.items.push(item);
    return true;
  }

  async take(): Promise<T> {
    if (this.items.length > 0) {
      const item = this.items.shift()!; // use a ring buffer on hot paths: shift() is O(n)
      this.waitingProducers.shift()?.(); // one slot opened: wake ONE producer
      return item;
    }
    return new Promise<T>((r) => this.waitingConsumers.push(r));
  }

  get length(): number { return this.items.length; }
}

// N consumer loops = concurrency N for I/O-bound work
export function startConsumers<T>(q: BoundedQueue<T>, n: number, work: (t: T) => Promise<void>) {
  for (let i = 0; i < n; i++) {
    void (async () => {
      for (;;) {
        const job = await q.take();
        try { await work(job); } catch (err) { console.error('job failed', err); } // one bad job never kills the loop
      }
    })();
  }
}`,
        },
      ],
      keyPoints: [
        'Every in-process queue must be bounded and must declare its full-queue policy.',
        'Block for producers you control; reject (429) for user-facing producers.',
        'In-process queues lose everything on a crash; durable work goes to a broker.',
      ],
      source: 'Brian Goetz — Java Concurrency in Practice, Ch 5.3 (Blocking queues and producer–consumer)',
    },
    {
      heading: 'Thread-safe singletons and lazy initialisation (the Java questions, and Node\'s version)',
      body: `**Intuition:** lazy init is "create it the first time someone asks". With threads, two callers can ask at the same moment and both create it; with async Node, two callers can both see "not yet created" before the first \`await connect()\` finishes.

**Java, as interviewers ask it (Bloch, Goetz):**
1. **Naive lazy:** \`if (instance == null) instance = new X();\` → two threads create two instances.
2. **\`synchronized getInstance()\`:** correct, but every call takes the monitor (cheap when uncontended, still a needless serialisation point on a hot path).
3. **Double-checked locking (DCL):** check, lock, check again. **Broken without \`volatile\`**: the JIT/CPU may publish the reference before the constructor's writes are visible, so another thread sees a non-null, half-constructed object. \`volatile\` (Java 5+ memory model) adds the happens-before edge. Read the field into a local to avoid a second volatile read.
4. **Initialization-on-demand holder:** a nested static class whose static field holds the instance. The JVM guarantees class initialisation is lazy (on first access) and thread-safe. No locks in your code. **This is the answer to give.**
5. **\`enum\` singleton:** Bloch's recommendation; also safe against serialisation and reflection creating a second instance, but it is eager-ish (on first enum access) and cannot extend a class.

**Node's version of the same bug:** \`if (!client) { client = await createClient(); }\` lets two concurrent first requests create two clients (two pools, double the connections). Memoise the **promise**, not the value, and clear it on failure so a transient outage does not cache a rejection forever.

**Where interviewers go next:** "is \`ConcurrentHashMap.computeIfAbsent\` a lazy-init tool?" Yes, for per-key lazy values: the mapping function runs at most once per key while the bin is locked. Keep it short and never recursive into the same map.`,
      code: [
        {
          language: 'java',
          title: 'DCL with volatile vs the holder idiom vs enum',
          code: `// 3. Double-checked locking: correct ONLY because of volatile
public final class PricingConfig {
    private static volatile PricingConfig instance;
    private final java.util.Map<String, Long> baseFares;

    private PricingConfig() { this.baseFares = loadFromDisk(); }

    public static PricingConfig getInstance() {
        PricingConfig local = instance;        // one volatile read on the fast path
        if (local == null) {
            synchronized (PricingConfig.class) {
                local = instance;
                if (local == null) {
                    instance = local = new PricingConfig(); // safe publication via volatile write
                }
            }
        }
        return local;
    }
    private static java.util.Map<String, Long> loadFromDisk() { return new java.util.HashMap<>(); }
}

// 4. Holder idiom: lazy and thread-safe by the JVM's class-init guarantee, no locks
final class SurgeModel {
    private SurgeModel() { }
    private static final class Holder { static final SurgeModel INSTANCE = new SurgeModel(); }
    static SurgeModel get() { return Holder.INSTANCE; } // Holder initialised on first call only
}

// 5. Enum: serialisation- and reflection-safe single instance
enum IdGenerator {
    INSTANCE;
    private final java.util.concurrent.atomic.AtomicLong next = new java.util.concurrent.atomic.AtomicLong();
    long nextId() { return next.incrementAndGet(); }
}`,
        },
        {
          language: 'typescript',
          title: 'Node: memoise the promise, not the value (and forget failures)',
          code: `import { Pool } from 'pg';

let poolPromise: Promise<Pool> | undefined;

export function getPool(): Promise<Pool> {
  // The assignment happens synchronously, before any await, so the
  // second concurrent caller sees the same in-flight promise.
  poolPromise ??= (async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    await pool.query('SELECT 1'); // fail fast if the DB is unreachable
    return pool;
  })().catch((err) => {
    poolPromise = undefined; // do not cache a rejection forever
    throw err;
  });
  return poolPromise;
}

// BUGGY version for contrast:
// let pool: Pool | undefined;
// async function getPoolBad() {
//   if (!pool) { const p = new Pool(cfg); await p.query('SELECT 1'); pool = p; } // two callers => two pools
//   return pool;
// }`,
        },
      ],
      keyPoints: [
        'DCL needs volatile because of unsafe publication, not because of the double check.',
        'Holder idiom is the lock-free, lazy, correct default in Java.',
        'Node: cache the promise synchronously; clear it on rejection.',
      ],
      source: 'Joshua Bloch — Effective Java, Items 3 and 83; Brian Goetz — Java Concurrency in Practice, Ch 16.2',
    },
    {
      heading: 'Event loop vs worker_threads vs multiple pods: when an in-process lock stops being enough',
      body: `**Intuition:** a lock protects exactly the memory it lives in. Draw the boundary of the memory and you know the boundary of the protection.

| Deployment | Shared memory? | What protects an invariant | Cost per lock op |
|---|---|---|---|
| **One Node process, one event loop** | Yes, one heap | Sync code between awaits; \`async-mutex\` for await-spanning sections | ~100 ns–1 µs |
| **worker_threads** | No (separate isolates); only \`SharedArrayBuffer\` | \`Atomics\` (\`add\`, \`compareExchange\`, \`wait\`/\`notify\`) on typed arrays; or keep state in the main thread and message workers | ~10–100 ns per atomic; ~10–50 µs per \`postMessage\` |
| **Node \`cluster\` / N pods** | No | The database (unique constraint, conditional UPDATE, \`SELECT ... FOR UPDATE\`), a single-writer partition, or a fenced lease (etcd/ZooKeeper) | ~1–5 ms per DB round trip |

**How this plays out in a machine-coding round:** you build \`ParkingLot.park()\` with a \`Map\` and a per-floor mutex. The evaluator asks: "we now run 3 pods behind a load balancer". The mutex is now 3 mutexes guarding 3 different Maps, and the Maps disagree. The design answer is to move the **state** first (Postgres/Redis), then the invariant goes where the state is: a partial unique index \`ON spot_assignments(spot_id) WHERE released_at IS NULL\` makes double-assignment impossible regardless of how many pods race.

**worker_threads are for CPU, not for sharing objects.** Each worker has its own heap; a \`Map\` passed via \`postMessage\` is *cloned*. Use them for 30–200 ms CPU tasks (image resize, PDF, bcrypt with high cost) through a pool (Piscina), keep the authoritative state in one place, and send results back.

**Routing as a lock substitute:** if every request for parking lot \`L7\` is routed (consistent hashing on lot id, or a Kafka partition key) to the same single-threaded consumer, the in-process design stays correct at scale. This is the single-writer principle, and it is how many order books and ledgers scale.

**Say this in interviews:** "In-process locking is correct for one pod. When we scale out I either route by entity id to a single writer, or push the invariant into the database as a constraint or a conditional update. Distributed locks are my last choice and need fencing tokens."`,
      diagram: `  Where the invariant lives as you scale a ParkingLot design

  1 process                worker_threads             N pods
  +-----------------+     +-----------------+     +------+ +------+ +------+
  | event loop      |     | main  | w1 | w2 |     | pod1 | | pod2 | | pod3 |
  | Map<spot,veh>   |     | SAB + Atomics   |     | Map  | | Map  | | Map  |  <- 3 truths
  | Mutex per floor |     | (typed arrays)  |     +--+---+ +--+---+ +--+---+
  +-----------------+     +-----------------+        |        |        |
   invariant: in-heap      invariant: atomics        v        v        v
                                                 +---------------------------+
                                                 | Postgres: UNIQUE (spot_id)|
                                                 | WHERE released_at IS NULL |
                                                 +---------------------------+
                                                  invariant: in the database`,
      code: [
        {
          language: 'sql',
          title: 'Multi-pod version of park(): the invariant moves into a partial unique index',
          code: `-- One active assignment per spot, enforced no matter how many pods race.
CREATE TABLE spot_assignments (
  id          bigserial PRIMARY KEY,
  spot_id     text        NOT NULL,
  vehicle_no  text        NOT NULL,
  parked_at   timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE UNIQUE INDEX one_active_assignment_per_spot
  ON spot_assignments (spot_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX one_active_spot_per_vehicle
  ON spot_assignments (vehicle_no) WHERE released_at IS NULL;

-- park(): pick a free spot and claim it in ONE statement; a racing pod
-- that picked the same spot gets 0 rows (ON CONFLICT) and retries.
WITH candidate AS (
  SELECT s.id FROM spots s
  WHERE s.floor = $1 AND s.size >= $2
    AND NOT EXISTS (SELECT 1 FROM spot_assignments a
                    WHERE a.spot_id = s.id AND a.released_at IS NULL)
  ORDER BY s.distance_to_lift
  LIMIT 1
)
INSERT INTO spot_assignments (spot_id, vehicle_no)
SELECT id, $3 FROM candidate
ON CONFLICT DO NOTHING
RETURNING spot_id;`,
        },
      ],
      keyPoints: [
        'A lock protects only the memory it lives in.',
        'worker_threads clone messages; share only typed arrays via SharedArrayBuffer + Atomics.',
        'Scaling out: route by entity to a single writer, or move the invariant into the database.',
      ],
      source: 'Node.js docs — worker_threads, Atomics; Martin Thompson — Single Writer Principle',
    },
  ],
  codeChallenges: [
    {
      id: 'lld-patterns-concurrency-cc-1',
      title: 'Refactor a checkout god-method into Strategies, a registry and events',
      context:
        'A food-delivery checkout grew one if/else at a time. Support tickets: a Gold member saw someone else\'s discount on their receipt, a BNPL order was saved with total NaN, Gold users with the FIRST50 coupon got the smaller discount, and an SMS outage failed checkouts after the order row was already written. Product wants a new payment method next sprint.',
      task:
        'Refactor so that discounts and payment fees are pluggable without editing the service, money is exact, concurrent checkouts cannot leak data into each other, an unknown payment method is rejected cleanly, and notification failures never fail a placed order.',
      starter: {
        language: 'typescript',
        code: `export class CheckoutService {
  private lastDiscount = 0; // read by the receipt email below

  constructor(private db: any, private sms: any, private email: any) {}

  async checkout(cart: { items: { price: number; qty: number }[]; coupon?: string },
                 user: { id: string; tier: string; phone: string; email: string },
                 method: string) {
    let total = cart.items.reduce((s, i) => s + i.price * i.qty, 0); // rupees as float

    if (user.tier === 'GOLD') this.lastDiscount = total * 0.1;
    else if (user.tier === 'SILVER') this.lastDiscount = total * 0.05;
    else if (cart.coupon === 'FIRST50') this.lastDiscount = 50;
    else this.lastDiscount = 0;
    total -= this.lastDiscount;

    let fee;
    if (method === 'UPI') fee = 0;
    else if (method === 'CARD') fee = total * 0.018;
    else if (method === 'COD') fee = 25;
    total += fee; // unknown method => NaN

    const order = await this.db.insert({ userId: user.id, total, discount: this.lastDiscount });
    await this.sms.send(user.phone, 'Order placed ' + order.id); // throws => 500 after insert
    await this.email.send(user.email, 'Receipt', 'Total ' + total + ', discount ' + this.lastDiscount);
    return order;
  }
}`,
      },
      hints: [
        'The service is a shared singleton and there are two awaits before the email is built. What else can write lastDiscount in between?',
        'List the axes of change: discount rules, payment methods, side effects. Each one deserves its own seam (two Strategies and an Observer).',
        'Separate a pure, synchronous quote() (no I/O, integer paise, returns a value) from the orchestration that saves and publishes.',
      ],
      solution: {
        language: 'typescript',
        code: `export interface Line { sku: string; unitPaise: number; qty: number }
export interface CheckoutInput {
  userId: string; tier: 'GOLD' | 'SILVER' | 'NONE'; coupon?: string; lines: Line[]; method: string;
}
export interface Quote { subtotal: number; discount: number; discountRule: string; fee: number; total: number }

// Strategy 1: discount rules are independent and comparable
export interface DiscountRule { readonly name: string; discount(subtotal: number, input: CheckoutInput): number }
export const tierDiscount: DiscountRule = {
  name: 'TIER',
  discount: (sub, i) => (i.tier === 'GOLD' ? Math.floor(sub * 0.1) : i.tier === 'SILVER' ? Math.floor(sub * 0.05) : 0),
};
export const firstOrderCoupon: DiscountRule = {
  name: 'FIRST50',
  discount: (sub, i) => (i.coupon === 'FIRST50' ? Math.min(5_000, sub) : 0),
};

// Strategy 2: fee per payment method, resolved through a registry
export interface FeePolicy { readonly method: string; fee(amountPaise: number): number }
export class FeePolicyRegistry {
  private readonly byMethod = new Map<string, FeePolicy>();
  register(p: FeePolicy): this { this.byMethod.set(p.method, p); return this; }
  for(method: string): FeePolicy {
    const p = this.byMethod.get(method);
    if (!p) throw new Error('unsupported payment method ' + method); // maps to 400, never NaN
    return p;
  }
}

// Pure pricing: no I/O, no fields written per request
export class PricingEngine {
  constructor(private readonly rules: DiscountRule[], private readonly fees: FeePolicyRegistry) {}
  quote(input: CheckoutInput): Quote {
    const subtotal = input.lines.reduce((s, l) => s + l.unitPaise * l.qty, 0);
    let best = { rule: 'NONE', amount: 0 };
    for (const r of this.rules) {
      const amount = r.discount(subtotal, input);
      if (amount > best.amount) best = { rule: r.name, amount }; // business rule: best single discount
    }
    const afterDiscount = subtotal - best.amount;
    const fee = this.fees.for(input.method).fee(afterDiscount);
    return { subtotal, discount: best.amount, discountRule: best.rule, fee, total: afterDiscount + fee };
  }
}

export interface OrderRepo { insert(o: { userId: string } & Quote): Promise<{ id: string }> }
export interface Events {
  emit(name: 'order.placed', p: { orderId: string; userId: string; quote: Quote }): Promise<void>;
}

export class CheckoutService {
  constructor(private readonly pricing: PricingEngine, private readonly orders: OrderRepo,
              private readonly events: Events) {}

  async checkout(input: CheckoutInput): Promise<{ orderId: string; quote: Quote }> {
    if (input.lines.length === 0) throw new Error('empty cart');
    const quote = this.pricing.quote(input); // a local: concurrent checkouts cannot see it
    const { id } = await this.orders.insert({ userId: input.userId, ...quote });
    // SMS and email are subscribers with their own retries; their failure never fails the order
    void this.events.emit('order.placed', { orderId: id, userId: input.userId, quote }).catch(() => {});
    return { orderId: id, quote };
  }
}

export const fees = new FeePolicyRegistry()
  .register({ method: 'UPI', fee: () => 0 })
  .register({ method: 'CARD', fee: (a) => Math.ceil(a * 0.018) }) // 1.8% MDR, rounded up to the paisa
  .register({ method: 'COD', fee: () => 2_500 });
// SILVER + FIRST50 on Rs 800 by CARD: discount 5000 (FIRST50 beats 4000), fee 1350, total 76350 paise`,
      },
      explanation: `**What was wrong and how each fix addresses it:**
- **Cross-request leak:** \`lastDiscount\` was a field on a singleton service, written before two awaits and read after them, so a concurrent checkout overwrote it and the receipt showed another user's discount. The quote is now a value returned by a pure function and held in a local.
- **NaN orders:** an unknown method left \`fee\` undefined. The fee registry throws a typed error for unsupported methods, which the controller maps to 400. Adding BNPL is a single \`register\` call (Open/Closed).
- **Wrong discount precedence:** the else-if chain made tier always win over the coupon. Rules are now independent strategies, and the precedence ("best single discount") is one explicit line you can change to stacking.
- **Floats:** all amounts are integer paise, with rounding decided per rule (\`floor\` for discounts, \`ceil\` for the card fee).
- **Side effects failing the order:** SMS and email are subscribers of \`order.placed\` (Observer) and run after the insert. In production the event goes through an outbox so a crash cannot lose it.
- **Testability:** \`PricingEngine\` is pure and has no I/O. It can be tested with plain tables of inputs and expected outputs.`,
      followUps: [
        {
          q: 'Marketing now wants Gold discount and FIRST50 to stack, but capped at 15% of the subtotal. What changes?',
          a: 'Only the combination policy in `quote()`. Extract it as a `DiscountCombiner` strategy (`BestSingle`, `StackWithCap(0.15)`), so the rules themselves stay untouched. `StackWithCap` sums the amounts and clamps to `Math.floor(subtotal * 0.15)`. Record which rules applied (an array, not one name) so the receipt and finance reconciliation can explain the number. Test it with a table that includes the boundary where the cap kicks in.',
        },
        {
          q: 'The same user double-taps "Place order" and two requests arrive 40 ms apart. Does your refactor prevent two orders?',
          a: 'No. The refactor fixed the shared state, not duplicate submission. The client sends an idempotency key (say, a cart checkout id). The order insert carries it under a UNIQUE constraint, with `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, followed by a select of the existing row. The second request returns the first order, and payment is keyed the same way so the gateway also de-duplicates. An in-process `Set` of keys would not survive multiple pods.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-cc-2',
      title: 'Make a movie seat-hold service safe: singleton race, double holds, stale timers, double charge',
      context:
        'A machine-coding submission for a BookMyShow-style round. It passed the demo but the evaluator\'s concurrency test found two users holding the same seat, a seat that was BOOKED flipping back to FREE five minutes later, and a confirm retry charging the card twice. On a cold start, two layouts were loaded and requests saw different seat maps.',
      task:
        'Fix initialisation, make hold all-or-nothing and race-free in a single Node process, make expiry correct without per-seat timers, and make confirm safe against expiry during payment and against client retries.',
      starter: {
        language: 'typescript',
        code: `type Seat = { id: string; status: 'FREE' | 'HELD' | 'BOOKED'; heldBy?: string };

export class SeatHoldService {
  private static instance: SeatHoldService;
  private shows = new Map<string, Map<string, Seat>>();

  constructor(private audit: { log(...a: unknown[]): Promise<void> },
              private payments: { charge(userId: string, paise: number): Promise<string> }) {}

  static async getInstance(deps: any): Promise<SeatHoldService> {
    if (!SeatHoldService.instance) {
      const svc = new SeatHoldService(deps.audit, deps.payments);
      await svc.loadLayouts(deps.db);          // two cold-start callers both get here
      SeatHoldService.instance = svc;
    }
    return SeatHoldService.instance;
  }

  private async loadLayouts(db: any) { /* SELECT show_id, seat_id ... */ }

  async hold(showId: string, seatIds: string[], userId: string): Promise<boolean> {
    const show = this.shows.get(showId)!;
    for (const id of seatIds) if (show.get(id)!.status !== 'FREE') return false;
    await this.audit.log('hold', userId, showId, seatIds);
    for (const id of seatIds) {
      const seat = show.get(id)!;
      seat.status = 'HELD';
      seat.heldBy = userId;
      setTimeout(() => { seat.status = 'FREE'; seat.heldBy = undefined; }, 5 * 60_000);
    }
    return true;
  }

  async confirm(showId: string, seatIds: string[], userId: string): Promise<string> {
    const show = this.shows.get(showId)!;
    const bookingId = await this.payments.charge(userId, seatIds.length * 25_000);
    for (const id of seatIds) show.get(id)!.status = 'BOOKED';
    return bookingId;
  }
}`,
      },
      hints: [
        'Find every await that sits between a check and the write it guards. Can the check and the write happen synchronously instead?',
        'A setTimeout captured a seat object, not a hold. What does it do if the seat was booked, or re-held by someone else, before it fires? Can expiry be decided at read time instead?',
        'Payment takes seconds. Which state should seats be in while the charge is in flight, and what key makes a retried confirm return the first booking?',
      ],
      solution: {
        language: 'typescript',
        code: `import { randomUUID } from 'node:crypto';

type SeatStatus = 'FREE' | 'HELD' | 'PAYING' | 'BOOKED';
interface Seat { id: string; status: SeatStatus; holdId?: string }
interface Hold { id: string; showId: string; seatIds: string[]; userId: string; expiresAt: number }
export interface Payments { charge(userId: string, paise: number, idempotencyKey: string): Promise<string> }

export class SeatHoldService {
  private readonly shows = new Map<string, Map<string, Seat>>();
  private readonly holds = new Map<string, Hold>();
  private readonly confirmations = new Map<string, Promise<string>>(); // holdId -> bookingId

  constructor(layouts: Map<string, string[]>, private readonly payments: Payments,
              private readonly now: () => number = Date.now, private readonly holdMs = 5 * 60_000) {
    for (const [showId, ids] of layouts) {
      this.shows.set(showId, new Map(ids.map((id) => [id, { id, status: 'FREE' as SeatStatus }])));
    }
  }

  /** Synchronous on purpose: no await between check and act => atomic in one event loop. */
  hold(showId: string, seatIds: string[], userId: string): string | null {
    const show = this.shows.get(showId);
    if (!show || seatIds.length === 0 || new Set(seatIds).size !== seatIds.length) return null;
    const seats = seatIds.map((id) => show.get(id));
    if (seats.some((s) => !s || !this.isAvailable(s))) return null; // all-or-nothing
    const hold: Hold = { id: randomUUID(), showId, seatIds, userId, expiresAt: this.now() + this.holdMs };
    for (const s of seats as Seat[]) { s.status = 'HELD'; s.holdId = hold.id; }
    this.holds.set(hold.id, hold);
    return hold.id; // audit log is emitted AFTER, outside the critical section
  }

  /** Idempotent per holdId: a retry joins the first attempt and never charges twice. */
  confirm(holdId: string, userId: string): Promise<string> {
    const existing = this.confirmations.get(holdId);
    if (existing) return existing;
    const p = this.doConfirm(holdId, userId);
    this.confirmations.set(holdId, p);
    p.catch(() => this.confirmations.delete(holdId));
    return p;
  }

  private async doConfirm(holdId: string, userId: string): Promise<string> {
    const hold = this.holds.get(holdId);
    if (!hold || hold.userId !== userId || hold.expiresAt <= this.now()) throw new Error('hold expired or not yours');
    const seats = this.seatsOf(hold);
    if (seats.some((s) => s.status !== 'HELD' || s.holdId !== holdId)) throw new Error('hold no longer valid');
    for (const s of seats) s.status = 'PAYING'; // cannot expire or be stolen during the await
    try {
      const bookingId = await this.payments.charge(userId, seats.length * 25_000, holdId); // gateway de-dupes too
      for (const s of seats) s.status = 'BOOKED';
      this.holds.delete(holdId);
      return bookingId;
    } catch (err) {
      for (const s of seats) { s.status = 'FREE'; s.holdId = undefined; }
      this.holds.delete(holdId);
      throw err;
    }
  }

  /** Lazy expiry: an expired HELD seat is just available; no timers that can go stale. */
  private isAvailable(s: Seat): boolean {
    if (s.status === 'FREE') return true;
    if (s.status !== 'HELD') return false; // PAYING and BOOKED are never available
    const h = this.holds.get(s.holdId!);
    if (h && h.expiresAt > this.now()) return false;
    if (h) this.release(h);
    return true;
  }

  private release(h: Hold): void {
    for (const s of this.seatsOf(h)) if (s.holdId === h.id && s.status === 'HELD') { s.status = 'FREE'; s.holdId = undefined; }
    this.holds.delete(h.id);
  }

  private seatsOf(h: Hold): Seat[] {
    const show = this.shows.get(h.showId)!;
    return h.seatIds.map((id) => show.get(id)!);
  }
}

// DI factory (NestJS useFactory) replaces the racy static async getInstance()
export async function createSeatHoldService(load: () => Promise<Map<string, string[]>>, payments: Payments) {
  return new SeatHoldService(await load(), payments);
}`,
      },
      explanation: `**Fixes, one per bug:**
- **Cold-start double instance:** \`getInstance\` awaited before assigning the static, so two callers built two services with two seat maps. The service is now created once by a DI \`useFactory\` before the app accepts traffic. If you must stay lazy, memoise the promise synchronously.
- **Double hold:** the availability check and the write were separated by \`await audit.log\`. \`hold\` is now synchronous, so within one event loop nothing can interleave between check and act. It is also all-or-nothing (no partial holds) and rejects duplicate seat ids. The audit log is written after the hold.
- **Stale timers:** each \`setTimeout\` closed over a *seat*, so it freed a seat that had since been booked or re-held by another user. Expiry is now decided lazily from the hold's \`expiresAt\`. There are no timers, nothing to clear, and the behaviour can be tested with an injected clock.
- **Expiry during payment:** seats move to \`PAYING\` before the charge is awaited, and \`isAvailable\` never treats \`PAYING\` as free. A slow gateway can no longer hand the seat to someone else.
- **Double charge:** \`confirm\` is keyed by \`holdId\`. A retry gets the same promise, and the \`holdId\` is passed to the gateway as its idempotency key.
- **Ownership:** \`confirm\` verifies that the caller owns a live hold instead of trusting the seat ids the client sent.`,
      followUps: [
        {
          q: 'The evaluator says: "Now we run 4 pods behind a load balancer." What survives from this design and what changes?',
          a: 'The state machine (FREE → HELD → PAYING → BOOKED), lazy expiry and idempotency-by-holdId survive. The in-process atomicity does not, because there are 4 heaps. Move seats to Postgres and make hold one statement: `UPDATE seats SET status=\'HELD\', hold_id=$1, hold_expires_at=now()+interval \'5 min\' WHERE show_id=$2 AND seat_id = ANY($3) AND (status=\'FREE\' OR (status=\'HELD\' AND hold_expires_at < now()))`, and succeed only if rowCount equals the number of seats requested (otherwise roll back). Confirmations go in a table with a UNIQUE hold_id. An alternative is to route each show id to one pod.',
        },
        {
          q: 'How do you write a deterministic test that proves two concurrent holds on the same seat cannot both succeed?',
          a: 'Inject the clock and the payment port. Fire `Promise.all([svc.hold(\'S1\', [\'A2\'], \'u1\'), svc.hold(\'S1\', [\'A2\'], \'u2\')])` and assert that exactly one returns a holdId. Because `hold` is synchronous this is deterministic. Add a test that advances the fake clock past `holdMs` and re-holds. Add another with a payments fake that awaits a promise you control: while it is pending, advance the clock and assert a third user cannot hold the PAYING seat. Finally, a randomized test interleaves operations and checks the invariant that no seat is ever held or booked by two holds.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'lld-patterns-concurrency-iq-01',
      difficulty: 'hard',
      question:
        'Here is a 90-line calculateFare() with nested if/else on vehicle type, city and time of day. Refactor it live, then tell me what happens when I add "EV bikes in Bengaluru get 20% off between 11 pm and 6 am".',
      context: 'Machine-coding round for a ride-hailing company; the interviewer adds the EV rule 40 minutes in.',
      whatInterviewerLooksFor: [
        'Identifies the axes of change (vehicle, city, time) instead of creating one class per combination',
        'Strategy for the base fare, chosen by a registry Factory, with composition for modifiers',
        'Stateless, shareable strategies and integer money',
        'Adds the EV rule without editing existing classes, and states the precedence of modifiers',
      ],
      modelAnswer: `**Step 1: name the axes.** The base fare depends on the vehicle type. Surcharges and discounts depend on context (city, time, promo). Encoding every combination as its own class would give 4 vehicles × 20 cities × 3 time bands = 240 strategies, so I would not do that.

**Step 2: the shape.**
- \`BaseFareStrategy\` per vehicle type (per-km, per-minute, minimum fare), registered in a \`FareStrategyFactory\` (\`Map<VehicleType, BaseFareStrategy>\`). Numbers come from config per city, so a new city is data, not code.
- A list of \`FareModifier\`s, each with \`applies(ctx)\` and \`apply(amount, ctx)\`: \`SurgeModifier\`, \`NightChargeModifier\`, \`PromoModifier\`. They run in an explicit, ordered pipeline (decorator-style composition).
- \`FareCalculator\` = base strategy + ordered modifiers + rounding. It is pure, synchronous and holds no per-request fields.

**Step 3: the EV rule.** Add one class, \`EvNightDiscount\`, whose \`applies\` checks \`vehicle === 'EV_BIKE' && city === 'BLR' && hour in [23, 6)\`, and register it. Nothing else is edited. The question I ask the interviewer is **precedence**: is the 20% taken before or after surge? Is it capped? Does it stack with promos? I would encode the order explicitly (base → surge → night → discounts → floor at minimum fare) and test each boundary hour (22:59, 23:00, 05:59, 06:00) in the city's time zone, not UTC.

**Details that score:** integer paise, rounding once at the end, timezone from the city, and failing loudly when a vehicle type has no strategy rather than silently defaulting to sedan. Strategies are stateless, so one instance is shared across all requests.`,
      followUps: [
        {
          q: 'Pricing wants to change the night-discount percentage without a deploy. Does your design allow it?',
          a: 'Yes, if modifiers read parameters from a `PricingConfig` port instead of constants. Load the config from a table or a config service, cache it with a short TTL or a version push, and stamp the config version used on each quote so disputes can be replayed. The rule logic (when it applies, its precedence) stays in code. The numbers move to data.',
        },
        {
          q: 'Two modifiers both claim to be "the" discount and finance says only the larger should apply. Where does that logic go?',
          a: 'In a combiner, not inside either modifier. Tag modifiers with a group (`DISCOUNT`, `SURCHARGE`) and give each group a policy: surcharges stack, while discounts take the best single one or stack with a cap. The pipeline evaluates the group and the policy picks the result. Each modifier stays ignorant of the others, which keeps Open/Closed intact.',
        },
        {
          q: 'How do you prove the refactor did not change any existing fare?',
          a: 'Characterization tests before touching anything. Generate a few thousand inputs (all vehicles, cities, boundary hours, distances 0–80 km, surge 1.0–3.0), record the old function\'s outputs, and assert the new calculator returns identical paise. Keep the old function in the test suite until the diff is zero, then delete it. In production, shadow-run both for a day and log any mismatches.',
        },
      ],
      pitfalls: [
        'One class per vehicle×city combination (strategy explosion)',
        'Strategies that store the current ride in a field and are shared across requests',
        'Floating-point rupees and rounding at every step',
        'A switch inside the "factory", which just moves the smell',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-02',
      difficulty: 'medium',
      question:
        'A teammate wrapped our Redis client in a static getInstance() singleton "so we never open two connections". Since then, unit tests pass alone but fail when run together. Explain why, and what you would do instead in NestJS.',
      whatInterviewerLooksFor: [
        'Explains shared mutable state across tests and hidden dependencies',
        'Knows Nest providers are singletons by default and how scopes work',
        'Uses overrideProvider or a fake injected through the constructor',
        'Addresses lifecycle (shutdown) and the per-process nature of the singleton',
      ],
      modelAnswer: `**Why tests interfere:** the static instance lives in the module cache for the whole Jest worker. Test A sets a key or stubs a method on the singleton, and test B in the same file (or another file in the same worker) sees it. Worse, code calls \`RedisClient.getInstance()\` *inside methods*, so tests cannot inject a fake without monkey-patching the module, and a forgotten \`jest.restoreAllMocks\` leaks. Open handles from the real connection also keep Jest from exiting.

**The underlying problem** is not "one instance", which is a fine goal. It is **static access**. The class's constructor no longer tells the truth about what it depends on.

**What I would do:**
- Register Redis as a provider with a \`useFactory\` that creates and connects the client. Nest providers default to \`Scope.DEFAULT\`, which means one instance per application, so we still open one connection per process.
- Inject it with \`@Inject(REDIS)\` into the services that need it.
- Close it in \`onModuleDestroy\` (or \`beforeApplicationShutdown\`) so shutdown order is explicit.
- In tests: \`Test.createTestingModule({ providers: [SeatHoldService, { provide: REDIS, useValue: fakeRedis }] })\` for unit tests, or \`overrideProvider(REDIS)\` in integration tests. Each test module builds a fresh instance, so there is no cross-test state.

**Caveats worth saying:** "one connection" really means one per *process*. Ten pods with four workers each open 40. If the concern is total connections, the fix is pool sizing and limits, not a singleton. Also, two copies of the same package in \`node_modules\` produce two "singletons".`,
      followUps: [
        {
          q: 'One service genuinely needs a per-request Redis transaction context. Do you switch the provider to Scope.REQUEST?',
          a: 'No. A request-scoped provider makes every consumer up the chain request-scoped too, so a new instance graph is built per request (measurable CPU and GC cost). Keep the client a singleton and pass the per-request piece explicitly (a `multi()` pipeline object as a method argument), or use AsyncLocalStorage (nestjs-cls) for request context. Reserve Scope.REQUEST for things like a per-tenant connection chosen from request headers.',
        },
        {
          q: 'Is a module-level `export const redis = new Redis()` any better than getInstance()?',
          a: 'It is the same singleton with less ceremony. It still connects at import time (so tests that import the file open a socket), it is still hidden from constructors, and it still cannot be replaced without module mocking. It is acceptable in a tiny script. In an app, a DI provider gives you lazy creation, overrides in tests and ordered shutdown.',
        },
      ],
      pitfalls: [
        'Saying singletons are always bad (the need for one pool is real)',
        'Fixing flaky tests with jest.resetModules everywhere instead of removing static access',
        'Claiming a singleton limits connections across pods',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-03',
      difficulty: 'hard',
      question:
        'When a ride completes we must charge the rider, pay the driver, award loyalty points, send a receipt and update analytics. A junior wired these as in-process EventEmitter listeners. Review that design.',
      whatInterviewerLooksFor: [
        'Separates mandatory effects (charge, payout) from best-effort ones (points, analytics)',
        'Knows EventEmitter semantics: synchronous dispatch, first throw stops the rest, async listeners not awaited',
        'Brings in the outbox for durability and idempotency for redelivery',
        'Considers ordering and the "publish after commit" rule',
      ],
      modelAnswer: `**What is good:** the ride service no longer knows about five downstream concerns. That decoupling is exactly what Observer is for.

**What is dangerous about plain \`EventEmitter\`:**
- \`emit\` calls listeners **synchronously in registration order**. If the loyalty listener throws, receipt and analytics never run, and the exception propagates into the code that completed the ride.
- **Async listeners are not awaited.** The HTTP response returns "completed" before the charge has happened, and a rejected promise becomes an unhandled rejection (which crashes the process by default since Node 15).
- **Nothing is durable.** If the pod is killed after the ride row commits and before the listeners finish, the rider is never charged and the driver is never paid. The in-process event existed only in memory.

**How I would split it:**
| Effect | Criticality | Mechanism |
|---|---|---|
| Charge rider, pay driver | Must happen exactly once (effectively) | Transactional outbox row in the same DB transaction as \`status=COMPLETED\`, relayed to Kafka; consumers idempotent on \`rideId\` |
| Receipt | Must happen, may be late | Same outbox event; email consumer with retries + DLQ |
| Loyalty, analytics | Best effort | In-process typed bus with per-listener isolation is acceptable; or the same Kafka topic |

**Mechanics that matter:** publish only after commit, so subscribers never see a ride that rolled back. Every consumer de-duplicates on \`(rideId, effect)\` because the relay is at-least-once. Charge and payout ordering is handled by the payment service's own state machine, not by listener registration order.

**In-process Observer still has a place** for cache invalidation and metrics within the module, with \`Promise.allSettled\` per listener and an error hook.`,
      followUps: [
        {
          q: 'The outbox relay publishes the same RideCompleted twice after a restart. What prevents a double charge?',
          a: 'The payment consumer keys the charge on an idempotency key derived from the event (`ride:{rideId}:charge`). It inserts into a `processed_events` table with a UNIQUE key in the same transaction as the ledger entry and skips the event on conflict. The gateway call also carries the key, so even if our DB write fails after the gateway succeeds, the retry returns the first charge. At-least-once delivery plus idempotent effects gives effectively-once.',
        },
        {
          q: 'Analytics wants events in the exact order rides completed across the city. Can you promise that?',
          a: 'Not globally without a single partition, which caps throughput. Promise order per key instead: partition by `rideId` (or `driverId` if driver timelines matter) so each key\'s events stay ordered. Include `completedAt` and a monotonic version so analytics can re-order within a window. Global ordering is a reporting concern, solved downstream by event time and watermarks.',
        },
      ],
      pitfalls: [
        'Treating payment as a fire-and-forget listener',
        'Emitting inside the DB transaction',
        'Assuming emit awaits async listeners',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-04',
      difficulty: 'medium',
      question:
        'Design the state handling for a vending machine (idle, has money, dispensing, out of stock, maintenance). Would you use the State pattern or a transition table, and how do you handle a coin inserted while it is dispensing?',
      whatInterviewerLooksFor: [
        'Enumerates states and events and draws the transition table first',
        'Chooses State objects when states carry behaviour, a table when transitions are data',
        'Defines behaviour for every event in every state (including rejections and refunds)',
        'Handles events that arrive during a long action',
      ],
      modelAnswer: `**First the table** (events: insertCoin, selectItem, dispense-done, cancel, service):

| State | insertCoin | select | dispenseDone | cancel |
|---|---|---|---|---|
| IDLE | → HAS_MONEY | reject "insert money" | ignore | no-op |
| HAS_MONEY | add credit | enough & in stock → DISPENSING; else stay | ignore | refund → IDLE |
| DISPENSING | **queue as credit or return immediately** | reject "busy" | change → IDLE or HAS_MONEY | reject |
| OUT_OF_STOCK | return coin | reject | — | — |
| MAINTENANCE | return coin | reject | — | — |

**Pattern choice:** states here carry behaviour (refund logic, change calculation, display messages), so I use **State objects**: \`VendingState\` with \`insertCoin(m, coin)\`, \`select(m, slot)\`, \`cancel(m)\`, each returning the next state. The machine (context) owns credit, inventory and the current state. State objects are stateless singletons. If the interviewer cares more about auditing or config-driven transitions, a \`Record<State, Record<Event, Transition>>\` table plus small action functions is equally valid. I would say why I picked one.

**Coin during DISPENSING:** dispensing is a long, physical action. Options: reject the coin to the return tray (simplest, and honest), or accept it as credit for the next purchase. Either way the behaviour is **defined**, never an accidental fall-through. Because hardware callbacks (coin sensor, motor done) arrive asynchronously, all events go through one **serial event queue** on the machine. Transitions are then processed one at a time and never interleave, which is the same single-writer idea as an actor.

**Extensibility:** adding card payments means a new event (\`cardAuthorised\`) and maybe a \`AWAITING_CARD\` state. Existing states get a default "reject" from a base class, so nothing breaks.`,
      followUps: [
        {
          q: 'Power fails mid-dispense. On reboot, what state is the machine in?',
          a: 'Persist the state and credit before each irreversible action (write-ahead): record `DISPENSING slot=B4 credit=50` to flash before running the motor. On boot, a recovery transition reads the log. If the item sensor confirms the drop, complete and return change. If not, go to a `NEEDS_RECONCILIATION` state that refunds the credit or flags service. Never default to IDLE with the customer\'s money unaccounted for.',
        },
        {
          q: 'Why not just keep a status enum and a switch in each method?',
          a: 'It works for three states. With five states and five events it is 25 cases spread across 5 methods, and adding a state means editing every switch (the Open/Closed violation). The State pattern groups behaviour by state and gives each state a default "reject" via a base class, so a new state is one class. A table gives the same locality as data. Both beat scattered switches.',
        },
      ],
      pitfalls: [
        'Boolean flags (hasMoney, isDispensing) instead of states',
        'Undefined behaviour for events in "impossible" states',
        'Ignoring that hardware events are asynchronous and can interleave',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-05',
      difficulty: 'expert',
      question:
        'Build undo/redo for a shared whiteboard where two people edit the same board. Undo should only undo MY last action. How does the Command pattern handle this, and where does it break?',
      whatInterviewerLooksFor: [
        'Command objects with execute/undo and per-user stacks',
        'Recognises that inverse operations become invalid when others edit concurrently',
        'Mentions transformation (OT) or CRDT-style approaches, or rebasing the inverse',
        'Bounds memory and handles non-invertible commands',
      ],
      modelAnswer: `**Single-user baseline:** every edit is a \`Command { id, userId, execute(doc), invert(doc): Command }\`. The invoker keeps \`done\` and \`undone\` stacks. A new command clears redo. Undo means: pop, apply the inverse, push to redo. For destructive commands (delete shape, clear board) the command stores a memento of what it removed.

**With two users, the naive version is wrong.** I draw shape S at (10,10). You then move S to (50,50). If I undo by "applying my inverse", the result depends on the inverse:
- "Delete S" removes the shape you just moved. That may be acceptable (undoing creation deletes it).
- If my action was "move S by +10" and my inverse is "set S.x = 10" (absolute), I wipe out your move. That is wrong.

**What works:**
1. **Per-user stacks.** Undo means "invert *my* most recent command that is still applicable", not the global last command.
2. **Inverses expressed relative to the current state** (\`move by -10\` rather than \`set x = 10\`), or **transformed** against the operations that happened since (operational transformation: transform my inverse through the later ops so it applies to today's document).
3. **Applicability checks:** if the object my command touched was deleted by someone else, my undo becomes a no-op or is skipped, and the UI shows that.
4. With a **CRDT** model (Yjs, Automerge), use the library's \`UndoManager\` scoped to the local origin. It tracks only local changes and computes inverses over the CRDT, which is the production answer.

**Operational concerns:** every command carries an id, so a retried send is idempotent on the server. Bound each history (e.g. 200 commands, or by bytes). Commands that hit external systems (export to Slack) are not undoable; they get compensating actions or are excluded from the stack.`,
      followUps: [
        {
          q: 'A user hits undo 50 times quickly on a 2 MB board. How do you avoid 50 round trips and 50 re-renders?',
          a: 'Group commands into transactions (one drag = one undo unit, captured by a time window such as 500 ms, or by gesture boundaries). Apply undos locally and optimistically, then batch-send the inverse operations as one message with a client sequence number. The renderer coalesces changes per animation frame. The server applies the batch atomically or rejects it with the current version for a rebase.',
        },
        {
          q: 'Should the undo history live on the client or the server?',
          a: 'The intent ("my last N actions") belongs to the client session, so keep the stacks client-side. The server holds the authoritative op log with author ids, so a reconnecting client can rebuild its stack from its own recent ops. Server-side history is also needed for audit and version restore, but "restore version 12" is a different feature from interactive undo and should not share its code path.',
        },
      ],
      pitfalls: [
        'A single global undo stack for all users',
        'Absolute-value inverses that overwrite collaborators\' edits',
        'Unbounded history and undo of external side effects',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-06',
      difficulty: 'hard',
      question:
        'Our PaymentGateway interface has one implementation. We now need retries, a circuit breaker, metrics and an idempotency guard around it. A colleague proposes RetryingPaymentGateway extends RazorpayGateway. What do you propose?',
      whatInterviewerLooksFor: [
        'Prefers composable decorators over an inheritance chain',
        'Reasons about decorator order and its behavioural impact',
        'Knows which operations are safe to retry (idempotency key) and which are not',
        'Wires the stack in DI without coupling call sites',
      ],
      modelAnswer: `**Why not inheritance:** \`RetryingPaymentGateway extends RazorpayGateway\` binds retry logic to one vendor. Adding metrics means \`MetricsRetryingRazorpayGateway\`, and adding Stripe doubles every class. Inheritance multiplies features by vendors; decorators add them.

**Proposal:** every wrapper implements \`PaymentGateway\` and receives an inner \`PaymentGateway\`:
- \`IdempotencyGuard\`: attaches or validates an idempotency key, and short-circuits a duplicate request already completed locally.
- \`MetricsGateway\`: latency histogram and outcome counters.
- \`CircuitBreakerGateway\`: opens after, say, 50% failures over 20 calls, then fails fast for 30 s.
- \`RetryingGateway\`: 2 retries with jittered backoff, **only** on retryable errors (timeouts, 5xx, connection reset) and **only** because the idempotency key makes the retry safe.

**Order is semantics:** \`Metrics(IdempotencyGuard(CircuitBreaker(Retry(Razorpay))))\`.
- Metrics outermost measures what the caller experiences (including retries). Put a second metrics decorator innermost if you want per-attempt vendor latency.
- Breaker outside Retry means one logical call counts once. With Retry outside Breaker, each attempt counts and the breaker trips three times faster. Pick one on purpose.
- The idempotency key must be created **before** Retry, so every attempt reuses the same key. A key generated inside the retry loop defeats it.

**Wiring:** one NestJS \`useFactory\` builds the stack per vendor; call sites inject \`PAYMENT_GATEWAY\` and never know about the decorators. Each decorator is unit-tested against a fake inner gateway.`,
      followUps: [
        {
          q: 'The charge call times out after 10 s. Is it safe for RetryingGateway to retry?',
          a: 'Only with the same idempotency key. A timeout means "unknown outcome": the vendor may have captured the money. Retrying with the same key makes the gateway return the original result instead of charging again. Without a key, do not retry. Mark the payment as `PENDING_VERIFICATION` and reconcile through the vendor\'s status API or webhook. The total time budget across retries must also fit the caller\'s deadline.',
        },
        {
          q: 'How is a Decorator different from a NestJS interceptor doing the same job?',
          a: 'An interceptor wraps a route handler, so it sees HTTP-level calls and runs for every endpoint it is bound to. A decorator wraps one dependency (the gateway) wherever it is used, including from Kafka consumers and cron jobs that never pass through an HTTP interceptor. Cross-cutting concerns on the transport belong in interceptors. Resilience for a specific outbound dependency belongs in decorators around that port.',
        },
      ],
      pitfalls: [
        'Inheritance chains combining vendors with features',
        'Retrying non-idempotent charges',
        'Not stating decorator order and its effect on metrics and breakers',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-07',
      difficulty: 'hard',
      question:
        'Coupon validation runs as a chain: expiry → min-order → user-eligibility → per-user usage limit → budget check. After someone reordered two handlers, a coupon capped at 1 use per user was redeemed 3 times. How could reordering cause that, and how do you design the chain so it cannot happen again?',
      whatInterviewerLooksFor: [
        'Spots hidden data or side-effect dependencies between handlers',
        'Separates pure checks from reservations (side effects)',
        'Makes reservations atomic and compensatable',
        'Makes ordering constraints explicit and testable',
      ],
      modelAnswer: `**How reordering breaks it:** the usage-limit handler was not a pure check. It *reserved* a use: \`INCR coupon:{id}:user:{u}\` and passed if the result was ≤ 1. The budget handler after it also reserved budget. Someone moved the usage-limit handler **before** user-eligibility "because it is cheaper". Now:
1. Request 1 increments usage to 1 and passes. Eligibility fails, and the chain short-circuits with no compensation. Usage stays at 1 and the user is wrongly blocked later.
2. Or the reverse case: the counter was read in one handler (\`GET\`) and incremented in a later handler, and reordering put an await between the read and the increment. Three concurrent requests all read 0 and all passed.

Either way, the root cause is that **checks and reservations were mixed in a chain whose order was implicit**.

**Redesign:**
- **Phase 1, pure validation chain:** expiry, min-order, eligibility. These have no side effects, can run in any order, and are ordered only by cost (cheap first).
- **Phase 2, one atomic reservation:** a single Lua script or a single SQL statement that checks the per-user limit **and** the global budget and decrements both, or does nothing. For example: \`UPDATE coupon_usage SET used = used + 1 WHERE coupon_id=$1 AND user_id=$2 AND used < 1\` in the same transaction as the budget decrement and the order insert.
- **Compensation:** if the order later fails, release the reservation through an explicit \`release(couponId, orderId)\` that is idempotent per orderId.
- **Make order explicit:** handlers declare \`requires\` and \`provides\` (e.g. eligibility provides \`ctx.userSegment\`), and the chain builder validates the graph at boot. A unit test asserts the exact order.

**Rule of thumb:** a Chain of Responsibility should be made of *decisions*. Side effects belong in a single atomic step after the chain.`,
      followUps: [
        {
          q: 'Budget is global (Rs 10 lakh across all users) and 5,000 checkouts per second hit it at a sale start. Does one atomic counter row survive?',
          a: 'One Postgres row serialises roughly 500–1,000 updates/s, so it will not. Shard the budget into N sub-budgets (say 32 rows or Redis keys, each with 1/32 of the money) and pick one by hash or at random, retrying another shard when one is empty. Alternatively, gate in Redis with a Lua decrement (~50K ops/s) and write the winners durably. Accept a small overshoot or undershoot at the end and reconcile.',
        },
        {
          q: 'Product wants to show WHY a coupon failed, all reasons at once, not just the first. Does Chain of Responsibility still fit?',
          a: 'Not as short-circuit. Switch the validation phase to a Composite or Specification style: run every pure rule and collect `{ rule, passed, message }`, then return all failures. Because these rules are side-effect free, running them all is safe. The reservation phase stays a single atomic step that runs only if the list is empty.',
        },
      ],
      pitfalls: [
        'Assuming a chain\'s order only matters for performance',
        'Doing GET-then-INCR across handlers',
        'No compensation when a later handler rejects after an earlier one reserved',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-08',
      difficulty: 'hard',
      question:
        'You inherit a 2,400-line HotelBookingService with 38 public methods covering search, pricing, inventory, payments, emails and reports. Every sprint it causes merge conflicts. How do you break it up without a big-bang rewrite?',
      whatInterviewerLooksFor: [
        'Splits by axis of change and cohesion, not by technical layer',
        'Uses characterization tests and strangler-style incremental extraction',
        'Moves invariants into rich domain objects instead of new anaemic services',
        'Avoids over-correcting into dozens of one-method classes',
      ],
      modelAnswer: `**Diagnose first.** I would group the 38 methods by the data they touch and by *who asks for changes*: revenue (pricing), ops (inventory and allotments), finance (payments and refunds), marketing (emails), analytics (reports). Git history tells you which methods change together. That gives the seams: \`PricingPolicy\`, \`InventoryService\` around a rich \`RoomInventory\` aggregate, \`PaymentOrchestrator\`, notification subscribers and a read-model \`ReportingQueries\`.

**Safety net:** characterization tests on the current public methods (golden inputs and outputs), especially pricing and cancellation refunds, which are where the money is.

**Incremental extraction (strangler inside the codebase):**
1. Extract the pure parts first. Pricing has no I/O and becomes a Strategy with zero behaviour change.
2. Move invariants into the domain object: \`RoomInventory.reserve(nights, qty)\` throws if it would overbook, instead of the service doing \`if (inv.available < qty)\` in four places. This fixes the anaemic model as you go.
3. Replace inline email and report calls with domain events (\`BookingConfirmed\`) and subscribers.
4. The old service becomes a thin **Facade** that delegates. Callers migrate at their own pace, and then the facade is deleted.

**Each step is one small PR** with green characterization tests and no long-lived branch, which also ends the merge conflicts.

**Do not over-correct:** 38 one-method "services" with interfaces nobody implements twice is the opposite smell. Aim for cohesive modules of 5–10 methods each, each owned by one team or concern. I would also add an ArchUnit-style lint rule (e.g. \`eslint-plugin-boundaries\`) so pricing cannot import payments again.`,
      followUps: [
        {
          q: 'Pricing logic is copy-pasted in three methods with slightly different rounding. Which one is "correct" when you extract it?',
          a: 'None, until the business says so. Characterization tests will show the three produce different paise for the same input. List the cases where they differ, take them to product or finance with real examples, and agree on one rule. Then extract a single `PricingPolicy` and accept that a known set of outputs changes, with a changelog entry. Never silently pick one during a refactor.',
        },
        {
          q: 'How do you stop the new InventoryService from becoming the next god class in two years?',
          a: 'Keep its boundary aligned to one aggregate and one reason to change, and push behaviour into the aggregate so the service stays a thin orchestrator. Enforce module boundaries with lint rules, review new public methods against the module\'s purpose, and watch metrics (file length, fan-in, PR conflict rate). When a sub-area starts changing independently, such as allotments for travel agents, split it then, not before.',
        },
      ],
      pitfalls: [
        'Splitting into Controller/Service/Helper layers, which keeps every concern tangled',
        'A big-bang rewrite with no characterization tests',
        'Creating many single-method classes and interfaces with one implementation',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-09',
      difficulty: 'hard',
      question:
        'In your parking-lot machine-coding solution, park() finds a free spot, awaits a call to the camera service to read the number plate, then assigns the spot. You say "Node is single-threaded, so this is race-free." Convince me, or fix it.',
      context: 'Interviewer is checking whether the candidate understands await as a yield point in an in-memory LLD.',
      whatInterviewerLooksFor: [
        'Admits the race: the await splits check and act',
        'Prefers restructuring (reserve synchronously, then await) over adding a lock',
        'Knows how to use a per-floor or per-spot mutex when needed, with ordering and timeouts',
        'States that this only holds within one process',
      ],
      modelAnswer: `**It is not race-free.** Single-threaded means two lines never run *at the same instant*. It does not mean a method runs to completion. Every \`await\` returns control to the event loop. Two cars arrive. Request A finds spot F1-07 free and awaits the camera (~200 ms). Request B runs, finds the same F1-07 free, and awaits too. Both resume and both assign F1-07.

**Fix 1 (preferred): restructure so the critical section is synchronous.**
1. Synchronously pick a spot and mark it \`RESERVED\` with a reservation id and an expiry.
2. Await the camera.
3. Synchronously move it to \`OCCUPIED\` if the reservation is still ours. On camera failure, release it.
No lock is needed, nothing can deadlock, and a concurrent request simply skips RESERVED spots.

**Fix 2: a mutex, if the await must stay between check and act** (for example, a rule that depends on the plate number). Use one \`async-mutex\` per floor, not a global one, so floors proceed in parallel. Wrap it with \`withTimeout\` so a hung camera call cannot freeze the floor. Never call out to a slow dependency while holding a lock if you can avoid it, because the lock hold time becomes the camera latency and floor throughput drops to about 5 cars/s.

**The scope caveat:** both fixes are correct for **one process**. With 3 pods there are three Maps that disagree. The state must move to a database with a unique constraint on active assignments, or requests must be routed per lot to a single writer.

**Java parallel:** the same check-then-act is fixed with \`ConcurrentHashMap.compute\`, or a \`ReentrantLock\` per floor.`,
      followUps: [
        {
          q: 'With fix 1, a crash after RESERVED and before OCCUPIED leaves the spot reserved forever in your in-memory model. Does it?',
          a: 'In memory, a crash loses everything anyway, so the reserved spot disappears with the process. The real concern is a camera call that never returns. Give reservations an `expiresAt` (say 30 s) and treat expired reservations as free lazily when scanning for spots, so no timer is needed. In the database version the same `expires_at` column is part of the availability predicate.',
        },
        {
          q: 'The evaluator asks you to prove the race exists with a test. What does it look like?',
          a: 'Inject a camera fake whose read returns a promise you resolve manually. Call `park(carA)` and `park(carB)` without awaiting, resolve both camera promises, then `await Promise.all`. Assert the two cars got different spots, or that one was rejected when only one spot was free. Against the buggy version, the test deterministically shows both cars on the same spot. Avoid `setTimeout`-based tests, which are flaky.',
        },
      ],
      pitfalls: [
        '"Node is single-threaded, so there are no races"',
        'One global mutex for the whole lot',
        'Holding a lock across a slow network call without a timeout',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-10',
      difficulty: 'expert',
      question:
        'Write a lazily initialised, thread-safe singleton in Java. Why does double-checked locking need volatile, exactly? Then tell me which version you would actually ship.',
      whatInterviewerLooksFor: [
        'Explains reordering and unsafe publication, not just "volatile means visible"',
        'Knows the holder idiom and why class initialisation is thread-safe',
        'Mentions the enum singleton and serialisation/reflection',
        'Questions whether a singleton is needed at all (DI container scope)',
      ],
      modelAnswer: `**The naive versions:** an unsynchronised \`if (instance == null) instance = new X()\` creates two instances under a race. A \`synchronized static getInstance()\` is correct but serialises every call.

**Double-checked locking:** check without the lock, lock, check again, construct. **Without \`volatile\` it is broken** because of how \`instance = new X()\` executes: allocate memory, run the constructor, write the reference. The JIT and CPU are allowed to make the reference write visible to another thread **before** the constructor's field writes. Thread B sees \`instance != null\` on the unsynchronised fast path, skips the lock, and reads default-valued fields. That is a half-constructed object. Under the Java Memory Model (JSR-133, Java 5+), a \`volatile\` write creates a happens-before edge with a subsequent volatile read, so everything the constructor wrote is visible to any thread that sees the reference. Idiomatic DCL also reads the volatile into a local to avoid a second volatile read on the fast path.

**What I would ship:**
- **Initialization-on-demand holder:** \`private static class Holder { static final X INSTANCE = new X(); }\`. The JVM initialises \`Holder\` lazily, on first access, and class initialisation is guaranteed thread-safe by the JLS (12.4.2) with an internal lock. There are no locks or volatiles in my code and no fast-path cost.
- **Enum singleton** when serialisation or reflection could create a second instance. Bloch's recommendation: \`enum IdGen { INSTANCE; ... }\`.

**And the senior answer:** in a Spring or Guice app, a bean is already a singleton per container. I would not hand-roll this unless it is a library without DI. Lazy init only pays off when construction is expensive and not always needed.`,
      followUps: [
        {
          q: 'What happens with the holder idiom if the constructor throws?',
          a: 'Class initialisation fails with `ExceptionInInitializerError` on the first access, and the class is then marked erroneous. Every later access throws `NoClassDefFoundError`, so there is no retry for the life of the classloader. If initialisation can fail transiently (a network call), the holder idiom is the wrong tool. Use DCL with volatile, or a lazily computed `AtomicReference` with retry, so a later call can try again.',
        },
        {
          q: 'Is `private static final X INSTANCE = new X();` (eager) thread-safe, and when is it fine?',
          a: 'Yes, by the same class-initialisation guarantee. It is created when the outer class is initialised, which happens on first active use, not at JVM start, so it is lazier than people think. It is fine when the class has no other static members that would trigger initialisation early, which is the usual case. The holder idiom only matters when the outer class is touched for other reasons before the instance is needed.',
        },
        {
          q: 'How would you write the same lazy, once-only init in Node, where there are no threads?',
          a: 'The race moves to `await`. Memoise the promise synchronously (`p ??= init()`) so the second concurrent caller receives the same in-flight promise, and clear it on rejection so a transient failure is retried. Caching the resolved value after `await` reintroduces the race: two callers see undefined before either finishes and you get two pools.',
        },
      ],
      pitfalls: [
        '"volatile makes it atomic" (it gives visibility and ordering, not atomicity)',
        'Synchronising on a non-final or public lock object',
        'Not mentioning the holder idiom or enum',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-11',
      difficulty: 'hard',
      question:
        'Your notification module receives order events from a Kafka consumer at up to 3,000/s and sends push notifications through a vendor that allows 1,000/s. Someone added an in-memory array as a buffer between them. Design the in-process producer–consumer properly.',
      whatInterviewerLooksFor: [
        'Bounded buffer with an explicit full policy (backpressure into Kafka: pause/resume)',
        'Consumer concurrency matched to the vendor rate limit',
        'Offset commits only after successful processing (no loss on crash)',
        'Sizing math for buffer and drain time',
      ],
      modelAnswer: `**What is wrong with the array:** at 3,000 in and 1,000 out, the array grows by 2,000 items/s. A 10-minute sale peak means 1.2M items × ~2 KB ≈ 2.4 GB, so the pod OOMs. And because the consumer auto-committed offsets on receipt, every buffered notification is lost on that crash.

**Design:**
- **Bounded queue** of, say, 5,000 items (≈ 5 s of vendor capacity, ~10 MB).
- **Backpressure, not drops:** the producer is the Kafka consumer, which we control. When \`queue.length > highWater (4,000)\`, call \`consumer.pause([{ topic }])\`. Below \`lowWater (1,000)\`, \`resume\`. Kafka itself becomes the large durable buffer, and the lag metric tells ops what is happening.
- **Consumers:** a token-bucket rate limiter at 950/s (headroom under the vendor's 1,000), with enough consumer loops to sustain it. With 120 ms vendor latency, 950 × 0.12 ≈ 114 in-flight requests, so ~120 loops.
- **Commits:** commit an offset only after every message up to it has been processed (track the lowest unfinished offset per partition). On crash we redeliver instead of losing, so the vendor call carries an idempotency key or we de-dupe on \`(orderId, template)\`.
- **Poison messages:** after 3 attempts, send to a DLQ topic and continue.

**Policy by message type:** OTPs and payment alerts get a separate, higher-priority queue. Marketing pushes can be dropped or deferred when lag exceeds a threshold, which is the drop policy applied deliberately to the right traffic.

**Java vocabulary:** an \`ArrayBlockingQueue(5000)\` with \`put\` in the poller and a fixed thread pool of consumers, or a \`ThreadPoolExecutor\` with a bounded queue and \`CallerRunsPolicy\`. Never the default unbounded \`LinkedBlockingQueue\`.`,
      followUps: [
        {
          q: 'While the consumer is paused, the Kafka group rebalances and kicks this pod out. Why, and how do you avoid it?',
          a: 'In kafkajs, `pause` stops fetching but heartbeats continue, so pausing itself is safe. The danger is a handler that blocks the `eachMessage` or `eachBatch` loop longer than `sessionTimeout` or `maxPollInterval` (e.g. awaiting `queue.put` under backpressure inside `eachMessage`). Pause the partitions instead of blocking inside the handler, keep handler awaits short, call `heartbeat()` in long batches, and size `sessionTimeout` (30 s is typical) above the worst stall.',
        },
        {
          q: 'Vendor latency jumps from 120 ms to 2 s during their incident. What happens to your pipeline?',
          a: 'With ~120 loops, throughput collapses to about 120 / 2 s = 60/s. The queue hits high-water within seconds, Kafka is paused and lag grows. That is the correct behaviour: nothing is lost and memory is flat. Add a circuit breaker so you stop hammering a failing vendor, alert on lag and age of the oldest message, and consider failing over OTPs to a secondary vendor. Do not raise concurrency to 2,000 loops, which only adds load to a struggling vendor.',
        },
      ],
      pitfalls: [
        'Unbounded in-memory buffer',
        'Auto-committing offsets before processing',
        'Dropping messages as the default full policy for critical traffic',
      ],
    },
    {
      id: 'lld-patterns-concurrency-iq-12',
      difficulty: 'expert',
      question:
        'Your in-memory LLD for a meeting-room booking system uses a per-room async mutex and passes every test. Walk me through what happens as we go to (a) worker_threads for CPU-heavy conflict detection, (b) 6 pods. At what point does the mutex stop protecting the invariant, and what replaces it?',
      whatInterviewerLooksFor: [
        'Ties lock scope to memory scope precisely',
        'Knows that worker_threads do not share JS objects (structured clone) and what Atomics can and cannot do',
        'For pods, moves the invariant to the data store (exclusion constraint, conditional insert) or single-writer routing',
        'Treats distributed locks as a last resort with fencing',
      ],
      modelAnswer: `**(0) One process:** \`bookings: Map<roomId, Interval[]>\` plus a per-room mutex. The invariant "no overlapping bookings per room" holds because every mutation happens in one heap under one mutex.

**(a) worker_threads.** Workers are separate V8 isolates. When I \`postMessage\` the room's bookings, the worker receives a **structured clone**. The worker can compute conflicts in parallel, but it cannot mutate the authoritative Map, and the main thread's mutex does not exist in its isolate.
- Correct design: the main thread stays the **single writer**. Workers are pure functions (bookings in, conflicts out). The main thread holds the per-room mutex across "send to worker → receive verdict → apply", or re-validates cheaply before applying.
- \`SharedArrayBuffer\` + \`Atomics\` share only typed arrays, so you could build a bitmap of 15-minute slots per room and claim slots with \`Atomics.compareExchange\`. That is clever but rarely worth it. Message passing with a single writer is simpler.

**(b) 6 pods.** The mutex now exists six times, guarding six different Maps, so it protects nothing. The fix is to move the **state** and then the **invariant**:
- Postgres can enforce it directly: \`EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at) WITH &&)\` (needs \`btree_gist\`). Two pods inserting overlapping bookings means one gets a constraint violation and returns 409. No lock code is needed.
- Or **route by room**: consistent hashing or a Kafka partition key on \`roomId\` sends all writes for a room to one consumer, so the in-process single-writer design keeps working at scale.
- A Redis or etcd lock per room is my last choice. It needs a TTL longer than the worst operation, and correctness needs a fencing token checked by the store. Since the store must check something anyway, the constraint is simpler.

**One sentence for the interviewer:** a lock protects only the memory it lives in, so as the memory boundary grows, the invariant has to move to the component that owns the data.`,
      followUps: [
        {
          q: 'Postgres rejects the overlapping insert. What does the API return, and how does the client recover?',
          a: 'Catch the exclusion violation (SQLSTATE `23P01`) and return 409 Conflict with the conflicting booking\'s time range, if visible to the user. The client refreshes availability and offers the nearest free slots. Do not retry automatically, because the conflict is a business outcome, not a transient error. Log a metric: a rising 23P01 rate means the UI is showing stale availability and the read path needs a shorter cache TTL.',
        },
        {
          q: 'Why might single-writer routing beat the database constraint for a very busy system, and what is its weak spot?',
          a: 'Routing keeps conflict checks in memory (microseconds) and batches DB writes, which suits hot keys such as order books or popular rooms. Its weak spot is ownership handover. During a rebalance, two consumers can briefly both believe they own room R. You still need an epoch or fencing check at write time (e.g. `WHERE owner_epoch = $e`), plus the DB constraint as a safety net. Routing is a throughput optimisation, not a replacement for invariants in the store.',
        },
      ],
      pitfalls: [
        'Believing worker_threads share the main thread\'s Map',
        'Reaching for Redlock before a database constraint',
        'Forgetting the gap between "mutex works in tests" and "mutex works in production with N pods"',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'lld-patterns-concurrency-boe-1',
      question:
        'An in-process bounded queue sits between an ingestion handler and a pool of consumers. Producers burst to 2,000 items/s for 30 s; consumers sustain 1,500 items/s; items are 4 KB. Size the queue so the burst is absorbed without rejecting, and estimate the memory and the drain time afterwards.',
      assumptions: [
        'Burst lasts 30 s at 2,000/s; afterwards the producer returns to 800/s',
        'Consumers sustain 1,500/s throughout (I/O-bound async loops)',
        'Each queued item costs ~4 KB on the heap including object overhead',
        'Pod memory limit 1 GiB with ~400 MiB already used by the app',
      ],
      steps: [
        { label: 'Excess rate during burst', calc: '2,000 − 1,500 = 500 items/s accumulate' },
        { label: 'Peak backlog', calc: '500 × 30 s = 15,000 items' },
        { label: 'Peak memory', calc: '15,000 × 4 KB ≈ 60 MB (fits in the ~600 MiB headroom)' },
        { label: 'Capacity with margin', calc: '15,000 × 1.5 ≈ 22,500 → round to 25,000 (~100 MB worst case)' },
        { label: 'Drain rate after burst', calc: '1,500 − 800 = 700 items/s' },
        { label: 'Drain time', calc: '15,000 ÷ 700 ≈ 21 s' },
        { label: 'Added latency at peak', calc: '15,000 queued ÷ 1,500/s ≈ 10 s wait for the last item' },
      ],
      answer:
        'A capacity of about 25,000 items (~100 MB worst case) absorbs a 30 s burst with margin. The backlog peaks near 15,000 items (60 MB), drains in about 21 s, and the last item waits about 10 s.',
      insight:
        'The bound is a memory budget and a latency budget at the same time. If 10 s of queueing violates the SLO, a larger queue is the wrong fix: add consumers or reject early (429), because a deeper queue only turns overload into latency.',
      followUps: [
        {
          q: 'The burst lasts 5 minutes instead of 30 seconds. What breaks first?',
          a: 'The backlog would reach 500 × 300 = 150,000 items ≈ 600 MB, which exceeds the headroom, so the 25,000 bound is hit after about 50 s. From then on `offer` returns false and the handler must reject (429) or block. Latency for accepted items caps at 25,000 ÷ 1,500 ≈ 17 s. The real fix is capacity (consumers scale on queue depth) or moving the buffer to a durable broker, where 600 MB of backlog is cheap and survives restarts.',
        },
        {
          q: 'Items carry a 50 KB image instead of 4 KB. Do you keep the same capacity?',
          a: 'No. 25,000 × 50 KB ≈ 1.25 GB, which is an OOM. Bound the queue by bytes, not count (track the total of `item.size`), or queue only a reference (an object-store key) and have consumers fetch the payload. At ~4 KB per reference the original count-based sizing is valid again, and memory no longer depends on the payload.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-boe-2',
      question:
        'A per-wallet async mutex guards a critical section that awaits a journal write (5 ms). A merchant\'s settlement wallet receives 300 credits/s at peak. Will the mutex keep up, how long do waiters queue, and what does restructuring buy?',
      assumptions: [
        'Lock hold time = journal write 5 ms + ~0.05 ms of sync work',
        'Arrivals are roughly uniform at 300/s on this one wallet',
        'withTimeout is 2 s on the mutex',
        'Restructured version: sync check-and-apply under the lock (~0.05 ms), journal written outside via outbox',
      ],
      steps: [
        { label: 'Max throughput of one lock', calc: '1 ÷ 5.05 ms ≈ 198 ops/s' },
        { label: 'Utilisation', calc: '300 ÷ 198 ≈ 1.5 → over 100%: queue grows without bound' },
        { label: 'Queue growth', calc: '300 − 198 ≈ 100 waiters/s added' },
        { label: 'Time to hit the 2 s timeout', calc: 'Waiters see > 2 s once ~400 are queued: 400 ÷ 100/s ≈ 4 s into the peak' },
        { label: 'Restructured capacity', calc: '1 ÷ 0.05 ms = 20,000 ops/s per wallet' },
        { label: 'Restructured utilisation', calc: '300 ÷ 20,000 = 1.5% → queueing negligible' },
      ],
      answer:
        'No. One lock holding for 5 ms caps the wallet at about 200 ops/s, so at 300/s the queue grows by about 100 waiters per second and requests start timing out about 4 s into the peak. Moving the await out of the critical section raises the per-wallet ceiling to about 20,000 ops/s.',
      insight:
        'Lock throughput is 1 ÷ hold time, and an await inside a lock makes the hold time equal to I/O latency. For hot entities, never await I/O while holding the lock. Apply the change synchronously and make the I/O asynchronous (outbox), or shard the entity, e.g. into sub-wallets.',
      followUps: [
        {
          q: 'Compliance says the journal must be durable BEFORE the balance changes. You cannot move the write out. Now what?',
          a: 'Batch the writes. A single writer for the wallet collects credits for up to 2 ms or 50 items, writes one journal batch (~6 ms), then applies them all. Throughput becomes about 50 ÷ 6 ms ≈ 8,000/s, at the cost of a few milliseconds of added latency. This is group commit. Alternatively, split the settlement wallet into N sub-wallets credited round-robin and summed on read, which gives N × 198/s.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-boe-3',
      question:
        'An invoice service renders PDFs (40 ms of CPU each) at a peak of 200 renders/s on 4-vCPU pods. Size the worker_threads pool per pod and the number of pods, and show why rendering on the event loop fails.',
      assumptions: [
        'Render = 40 ms pure CPU; everything else is I/O',
        'Per pod: 1 vCPU kept for the event loop and GC, 3 worker threads (Piscina)',
        'Target ≤ 70% CPU utilisation at peak',
        'p99 budget for the render endpoint: 500 ms',
      ],
      steps: [
        { label: 'CPU demand', calc: '200 renders/s × 40 ms = 8 core-seconds per second = 8 cores busy' },
        { label: 'On the event loop', calc: 'One loop does 1 ÷ 40 ms = 25 renders/s, and every other request waits behind each 40 ms render' },
        { label: 'Per-pod worker capacity', calc: '3 workers × 25/s = 75 renders/s at 100%' },
        { label: 'At 70% target', calc: '75 × 0.7 ≈ 52 renders/s per pod' },
        { label: 'Pods', calc: '200 ÷ 52 ≈ 3.8 → 4 pods (5 for N+1)' },
        { label: 'Queueing check', calc: 'At 70% utilisation with 3 servers, mean wait is ~1 service time (~40 ms); p99 stays well under 500 ms' },
      ],
      answer:
        'About 8 cores of render work. Use 3 workers per 4-vCPU pod and 4 pods (5 with N+1 headroom) at a 70% target. On the event loop, a single process would cap at 25 renders/s and add 40 ms of stall to every other request.',
      insight:
        'worker_threads are a throughput tool for CPU work, not a shared-state tool. Pool size follows the core count, not the request rate. Scaling past one pod is still a pod-count question, and no in-process lock spans those pods.',
      followUps: [
        {
          q: 'Someone sets the pool to 16 workers per 4-vCPU pod "to be safe". What happens?',
          a: 'The CPU work does not get faster. Sixteen threads contend for 4 cores, so each render takes roughly 4× longer in wall-clock time, context switching rises and the event loop competes for CPU too, which hurts p99 for unrelated endpoints. Memory also grows by about 10–30 MB per isolate. Keep the pool at cores − 1 and let a bounded task queue in front of the pool apply backpressure.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'lld-patterns-concurrency-mcq-01',
      difficulty: 'hard',
      question:
        'A wallet holds 100 and the WalletService below (optimistic versioning, 3 attempts) receives five concurrent debits of 5 with distinct command ids. Balance is plentiful. What is the most likely outcome?',
      code: {
        language: 'typescript',
        code: `// repo.save throws ConcurrencyError when stored version !== entity.version
private async debitWithRetry(walletId: string, amount: number, attempts = 3) {
  for (let i = 1; ; i++) {
    const w = await this.repo.findById(walletId);
    if (w.balance < amount) throw new Error('insufficient funds');
    try {
      return (await this.repo.save({ ...w, balance: w.balance - amount })).balance;
    } catch (e) {
      if (!(e instanceof ConcurrencyError) || i === attempts) throw e;
    }
  }
}
// await Promise.allSettled(['d0','d1','d2','d3','d4'].map(id => svc.debit(id, 'w1', 5)))`,
      },
      options: [
        'Three succeed and two reject with ConcurrencyError after exhausting their attempts, though funds were sufficient',
        'All five succeed, because Node is single-threaded and each save is synchronous',
        'Exactly one succeeds and four fail, because optimistic locking allows one winner in total',
        'All five succeed, but the final balance is 95 because of lost updates',
      ],
      correct: [0],
      explanation:
        'Each round, all pending callers read the same version and only one save wins; the rest retry. With five contenders and three attempts each, the requests that lose three rounds give up, so running this exact code yields three successes and two ConcurrencyErrors. A single-threaded runtime does not help, because the read and the save are separated by awaits. There are no lost updates (the version check prevents them), and it is one winner per round, not one in total.',
      followUps: [
        {
          q: 'This wallet is a merchant settlement account with hundreds of concurrent credits. What do you change?',
          a: 'Optimistic concurrency wastes work under contention: with N writers per round, total attempts grow roughly as N². For a known-hot key, serialise instead. Use a per-wallet mutex around a synchronous apply, or a single-writer queue per wallet that applies credits in order. You can also use a relative atomic update in the store (`balance = balance + $1`), which never conflicts. Keep optimistic versioning for low-contention entities such as user profiles.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-02',
      difficulty: 'expert',
      question:
        'transfer(A, B) and transfer(B, A) are started at the same moment with this code. Each wallet\'s mutex is wrapped in withTimeout(new Mutex(), 300). What happens?',
      code: {
        language: 'typescript',
        code: `async function transfer(from: Wallet, to: Wallet, amt: number) {
  await from.lock.runExclusive(async () => {
    await journal('begin ' + from.id + '->' + to.id); // ~5 ms
    await to.lock.runExclusive(async () => {
      from.balance -= amt;
      to.balance += amt;
    });
  });
}`,
      },
      options: [
        'Both complete, because async-mutex detects the cycle and grants one lock early',
        'Both hang forever, because withTimeout only applies to runExclusive callbacks that run longer than 300 ms',
        'One rejects with a mutex timeout after ~300 ms, which releases its first lock, and the other then completes',
        'Both reject with a timeout and neither balance changes',
      ],
      correct: [2],
      explanation:
        'Each call holds its first lock and waits for the other\'s, which is a classic lock-order deadlock. withTimeout bounds the wait to acquire. One waiter times out first, its outer runExclusive unwinds and releases its lock, and the other transfer proceeds (running this gives one rejection and one success). async-mutex has no deadlock detection. Without the timeout both would hang forever. They do not both time out, because the first timeout breaks the cycle.',
      followUps: [
        {
          q: 'The timeout "fixed" it in tests. Why is that not an acceptable fix?',
          a: 'It converts a deadlock into random failures of legitimate transfers under load, with a 300 ms latency penalty each time. The fix is to remove the cycle: acquire locks in a global order (sort the wallet ids), so A→B and B→A both lock A first. Keep the timeout as a safety net and alert on it. Also move the journal await out of the outer lock if possible, which shrinks the window in which a second lock is needed.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-03',
      difficulty: 'hard',
      question:
        'An order module uses Node\'s EventEmitter. The loyalty listener throws for a user with a corrupt profile. What happens on this request?',
      code: {
        language: 'typescript',
        code: `const events = new EventEmitter();
events.on('order.placed', (o) => loyalty.award(o.userId, o.total)); // throws
events.on('order.placed', (o) => cache.invalidate('orders:' + o.userId));
events.on('order.placed', (o) => metrics.increment('orders'));

async function placeOrder(input: OrderInput) {
  const order = await repo.insert(input);
  events.emit('order.placed', order);
  return order;
}`,
      },
      options: [
        'All three listeners run; the error is logged by Node and placeOrder returns the order',
        'EventEmitter re-emits the error as an \'error\' event and the request succeeds',
        'The cache and metrics listeners run, then placeOrder rejects with the loyalty error',
        'The cache and metrics listeners never run and placeOrder rejects, though the order row is already inserted',
      ],
      correct: [3],
      explanation:
        'emit calls listeners synchronously in registration order, and a throw propagates straight out of emit. The later listeners never run and placeOrder rejects after the insert has committed, so the client sees a 500 for an order that exists. Node does not isolate listeners. Throwing inside a listener does not trigger the special \'error\' event, which is only used when you emit \'error\' yourself.',
      followUps: [
        {
          q: 'You wrap each listener in try/catch. Is placeOrder now correct?',
          a: 'It no longer fails because of a side effect, but the effects are still volatile: a crash between insert and emit loses them, and async listeners are not awaited. Isolation fixes blast radius, not durability. For anything that must happen (points, invalidations that guard correctness), write an outbox row in the same transaction as the order and process it with retries. Keep the in-process bus for best-effort work such as metrics.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-04',
      difficulty: 'expert',
      question:
        'After a deploy, Postgres shows twice the expected connections from each pod for the first minute. The lazy accessor below runs on the first requests. What is the cause?',
      code: {
        language: 'typescript',
        code: `let pool: Pool | undefined;

export async function getPool(): Promise<Pool> {
  if (!pool) {
    const p = new Pool({ connectionString: url, max: 20 });
    await p.query('SELECT 1'); // warm-up
    pool = p;
  }
  return pool;
}`,
      },
      options: [
        'pg opens two connections per query by default, so warm-up doubles the count',
        'Concurrent first requests all see pool as undefined before any warm-up resolves, so several pools are created and only the last is kept',
        'The module is loaded twice because ESM and CommonJS caches are separate',
        'Pool max is per CPU core, so 20 becomes 40 on a 2-vCPU pod',
      ],
      correct: [1],
      explanation:
        'The check and the assignment are separated by an await, so every request arriving during warm-up creates its own Pool. The extra pools are never closed and leak connections until they idle out. Memoise the promise synchronously (pool ??= init()) and clear it on rejection. pg does not open two connections per query, and max is not per core. Dual ESM/CJS loading can duplicate modules, but that would show as a constant 2×, not a cold-start burst.',
      followUps: [
        {
          q: 'You switch to memoising the promise, but the DB is down for 10 seconds at boot. What does your code do afterwards?',
          a: 'If the rejected promise stays cached, every later call fails instantly, forever, even after the DB recovers. Clear the memo in a `.catch` that rethrows, so the next caller retries. Add a short backoff so a thundering herd of requests does not re-trigger init on every call. Or fail the readiness probe until init succeeds, so the pod receives no traffic while the DB is unreachable.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-05',
      difficulty: 'hard',
      question:
        'An FX rate provider is wrapped as shown. The upstream fails transiently 10% of the time. Which statement about the two stacks is right?',
      code: {
        language: 'typescript',
        code: `// Stack A
const a = new RetryingRateProvider(new CachingRateProvider(http), 3);
// Stack B
const b = new CachingRateProvider(new RetryingRateProvider(http, 3));
// CachingRateProvider caches only successful results for 30 s`,
      },
      options: [
        'Both hide transient failures equally, but in A every retry also re-checks the cache, so a value cached by a concurrent caller can satisfy a retry; in B the retry loop talks only to upstream',
        'In A a cache hit can be retried; in B the cache is bypassed during retries, so B hits upstream more',
        'They behave identically, because decorators are commutative when each implements the same interface',
        'A caches failures because the retry decorator converts errors to undefined',
      ],
      correct: [0],
      explanation:
        'In A, each retry attempt calls the caching layer, so if another request populated the cache between attempts the retry is served from the cache. In B, retries happen beneath the cache and always go upstream, and only the final success is cached. The observable difference is small here, but it shows that decorator order changes behaviour, so the order should be chosen and stated. Decorators are not generally commutative. A cache hit never throws, so it is never retried. Neither stack caches failures.',
      followUps: [
        {
          q: 'You add a metrics decorator. Where do you put it to measure the latency users experience versus the upstream\'s latency?',
          a: 'For user-experienced latency, put it outermost, so it includes cache hits (microseconds) and retries with backoff (possibly seconds). For upstream health, put a second instance innermost, directly around `http`, so it records each attempt and its error rate. Mixing the two into one histogram hides upstream degradation behind a high cache hit ratio.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-06',
      difficulty: 'hard',
      question:
        'In a machine-coding round you back your repositories with an in-memory Map. Select ALL practices that make tests against it catch the same bugs a real database would.',
      options: [
        'Return structuredClone copies from findById and store copies on save',
        'Check a version field on save and throw on mismatch',
        'Return the stored object itself so tests run faster',
        'Enforce uniqueness rules (e.g. one active booking per seat) inside save',
        'Wrap every repository method in one global async mutex',
      ],
      correct: [0, 1, 3],
      explanation:
        'Copy-on-read/write stops callers from mutating stored state without calling save, which a database would never allow. Version checks reproduce optimistic-concurrency conflicts, and enforcing unique constraints reproduces the database rejecting duplicates. Returning the stored reference hides missing-save bugs. A global mutex serialises everything, so it hides races rather than surfacing the conflicts a real store would report.',
      followUps: [
        {
          q: 'How do you make sure the in-memory and Postgres repositories really behave the same?',
          a: 'Write one contract test suite parameterised by a repository factory, and run it against both: the in-memory one in unit CI and Postgres (Testcontainers) in integration CI. It covers save and load round trips, a version conflict on a stale save, a unique violation on a duplicate active booking, and not-found behaviour. Any divergence fails the suite, which keeps the fake honest.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-07',
      difficulty: 'expert',
      question:
        'A Java service uses double-checked locking for a lazily created PricingConfig, but the developer removed volatile "because the synchronized block already gives visibility". Select ALL statements that are true.',
      options: [
        'A thread can see a non-null reference on the unsynchronised first check and read fields still at their default values',
        'The synchronized block makes the code safe, because every reader eventually enters it',
        'Making PricingConfig\'s fields final would prevent readers seeing default values of those fields, though the pattern remains fragile',
        'The initialization-on-demand holder idiom avoids the problem without volatile or explicit locks',
        'Two PricingConfig instances can be constructed concurrently because the second check is redundant',
      ],
      correct: [0, 2, 3],
      explanation:
        'Readers that see a non-null reference never enter the synchronized block, so they get no happens-before edge with the constructor and can observe a partially constructed object. The JMM\'s final-field semantics guarantee readers see correctly initialised final fields once the constructor completes, but non-final state is still unsafe. The holder idiom relies on the JVM\'s thread-safe class initialisation. The second check inside the lock is what prevents duplicate construction, so double construction is not the issue.',
      followUps: [
        {
          q: 'Why does idiomatic DCL copy the volatile field into a local variable?',
          a: 'Every read of a volatile field is a volatile read, with memory-ordering cost and no caching in registers. Without the local, the fast path reads `instance` twice (check, then return). Reading it once into `local` and returning `local` halves that. Bloch measured roughly a 1.4× speedup for this in Effective Java. It also guarantees you return the same reference you checked.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-08',
      difficulty: 'hard',
      question:
        'On ride completion the service emits ride.completed on an in-process typed bus with per-listener isolation. Select ALL effects that are acceptable to run as in-process listeners on that bus.',
      options: [
        'Incrementing a Prometheus counter of completed rides',
        'Invalidating the rider\'s cached "recent rides" list in the local L1 cache',
        'Crediting the driver\'s payout ledger',
        'Issuing the rider\'s refund for a fare dispute auto-approved at completion',
        'Logging a structured debug event',
      ],
      correct: [0, 1, 4],
      explanation:
        'Metrics, local cache invalidation and logs are best-effort and local. Losing one on a crash is tolerable, and the cache has a TTL as a backstop. Payout and refunds move money and must survive crashes and be retried idempotently, so they belong in a transactional outbox consumed through a broker. An isolated in-process listener still vanishes when the pod dies between commit and execution.',
      followUps: [
        {
          q: 'The L1 cache invalidation must happen on ALL 12 pods, not just the one that completed the ride. Does the in-process bus still work?',
          a: 'No. It only reaches its own process. Publish the invalidation over a fan-out channel every pod subscribes to (Redis Pub/Sub, or a Kafka topic with a unique consumer group per pod), and keep a short L1 TTL (5–30 s) as a backstop because Pub/Sub is fire-and-forget. The in-process listener can be the bridge that forwards the event to that channel.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-09',
      difficulty: 'medium',
      question:
        'A RideRequestBuilder has setters for scheduledAt, corporate(costCentre) and addStop(place). Rule: corporate rides cannot have intermediate stops. Where should this rule be enforced?',
      options: [
        'In addStop(), by throwing if corporate() was already called',
        'In the RideRequest constructor, made public so callers can skip the builder',
        'In the controller, before the builder is created',
        'In build(), because it depends on the final combination of fields, whatever order the setters were called in',
      ],
      correct: [3],
      explanation:
        'Cross-field invariants can only be checked once all fields are known. A setter check fails if the caller calls addStop() before corporate(), so it would silently allow the illegal combination. Checking in the controller scatters domain rules into the transport layer. A public constructor would let callers bypass the builder\'s validation entirely.',
      followUps: [
        {
          q: 'A teammate reuses one builder instance to create two requests in a loop. What can go wrong, and how does your builder prevent it?',
          a: 'The `stops` array is shared, so the second request inherits the first\'s stops, and any field set for request 1 leaks into request 2. Prevent it by making `build()` copy and freeze collections (`Object.freeze([...this.stops])`) and by marking the builder as used, so a second `build()` throws. Alternatively, return a fresh builder from a static factory each time and treat builders as single-use.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-10',
      difficulty: 'hard',
      question:
        'An order uses the State pattern: PAID accepts CANCEL (refund) and SHIP. A rider\'s cancel and the warehouse\'s ship arrive 20 ms apart on different pods. Both load the order in PAID. What is needed so that only one transition wins?',
      options: [
        'Nothing: the State pattern rejects illegal transitions, so the second event throws',
        'Make the state objects singletons so both pods share them',
        'Persist transitions as a compare-and-set on (status, version), e.g. UPDATE ... WHERE id=$1 AND status=\'PAID\' AND version=$2',
        'Process CANCEL before SHIP by giving cancel requests a higher HTTP priority',
      ],
      correct: [2],
      explanation:
        'Each pod validates its transition against its own in-memory copy, where PAID → CANCELLED and PAID → SHIPPED are both legal, so both succeed and the order is refunded and shipped. The persisted transition must be conditional on the state that was read. Exactly one UPDATE matches, and the loser re-reads the order and re-evaluates (cancel after shipping becomes "initiate return"). Singleton state objects share behaviour, not data, and HTTP priority gives no ordering guarantee across pods.',
      followUps: [
        {
          q: 'The losing request was a rider cancel. What should the API tell the rider?',
          a: 'Re-load the order and apply the event against the new state. In SHIPPED, CANCEL is not a legal transition, so return 409 Conflict with the current status and the allowed next actions (for example "request return after delivery"). Do not auto-retry the cancel. The conflict reflects a real business outcome, and the client should render the new state rather than an error toast.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-11',
      difficulty: 'expert',
      question:
        'In a text editor, the user types A, B, C, undoes twice (document shows "A"), then types D. Your CommandBus did not clear the redo stack on new commands. The user now presses redo twice. What do they see?',
      options: [
        '"AD" (redo is a no-op, because D was a new action)',
        '"ADBC": B and C are re-executed on top of a history that no longer contains them',
        '"ABC" (the editor restores the pre-undo state)',
        'An exception, because B and C commands are immutable once undone',
      ],
      correct: [1],
      explanation:
        'B and C were inverted relative to a document of "ABC". After D, the document has branched, so replaying them executes inserts at positions computed for the old history. With simple append commands that yields "ADBC". With position-based inserts it can corrupt text. Clearing the redo stack on any new command keeps history linear, which is why every editor does it. Nothing magically restores the pre-undo state, and commands do not lock themselves after undo.',
      followUps: [
        {
          q: 'Product wants "undo tree" behaviour (never lose the branch). How do you model it?',
          a: 'Replace the two stacks with a tree of states or commands. Each node has a parent and children, undo moves to the parent, redo moves to the most recent child, and a UI lets the user jump to other branches (as Vim\'s undo tree does). New actions add a child instead of discarding the redo branch. Memory grows, so bound it by node count or snapshot size, and store snapshots periodically so jumping across branches does not replay thousands of commands.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-12',
      difficulty: 'medium',
      question:
        'Your domain defines SmsSender.send(to, text): Promise<string>. The chosen vendor\'s SDK takes ({ to, body }, callback) and signals do-not-disturb with the string code ERR_DND. Which pattern describes the class you write between them?',
      options: [
        'Adapter, because it converts the vendor\'s interface and error codes into the one your domain defines',
        'Facade, because it hides the vendor SDK behind a simpler API',
        'Decorator, because it wraps the SDK and adds promise support',
        'Proxy, because it controls access to the remote vendor',
      ],
      correct: [0],
      explanation:
        'The defining feature is interface conversion. Your domain\'s port has a different shape from the SDK, and the class translates calls, results and errors (ERR_DND becomes RecipientOptedOut). A Decorator keeps the same interface as what it wraps. A Facade simplifies a subsystem of many classes. A Proxy also preserves the interface and exists to control access.',
      followUps: [
        {
          q: 'You add a second SMS vendor as fallback. Where does the failover logic live?',
          a: 'In a separate class that implements the same `SmsSender` port and holds two adapters: a failover Composite or Decorator. It calls the primary and, on retryable errors (timeouts, 5xx, not opted-out), calls the secondary. Each vendor keeps its own Adapter, and the domain still sees one `SmsSender`. Do not put failover inside an Adapter, because that couples two vendors in one translation class.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-13',
      difficulty: 'hard',
      question:
        'An admin API authorises requests with a chain: IpAllowlistCheck → RoleCheck → TenantScopeCheck. Each handler returns "deny" or calls next. A refactor accidentally removed TenantScopeCheck from the chain. What should happen when the last handler calls next and there is no next?',
      options: [
        'Allow, because no handler denied the request',
        'Throw a 500 so the bug is noticed',
        'Deny: authorization chains must default to deny when they fall off the end, and the builder should assert the expected handlers are present',
        'Re-run the chain from the start in case a handler was skipped',
      ],
      correct: [2],
      explanation:
        'For authorization, the safe default is deny. Allow-by-default means a missing or misordered handler silently grants access, which is exactly what this refactor would do. Validation chains may default to allow, but security chains should require an explicit grant. A 500 is better than allow, but it is not the right semantic, and a boot-time assertion catches the missing handler before deploy. Re-running the chain does nothing useful.',
      followUps: [
        {
          q: 'How do you make "a handler was removed" fail in CI rather than in production?',
          a: 'Declare the chain in one place, as a list of handler classes, and add a test that asserts the exact sequence. Better, have the final handler be an explicit `GrantIfAllPassed` that verifies required markers on the context (`ctx.tenantScoped === true`), so a missing check produces a deny plus a loud log. A contract test can also call an endpoint as a cross-tenant user and expect 403.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-14',
      difficulty: 'expert',
      question:
        'To speed up conflict detection, the main thread posts a room\'s bookings Map to a worker_thread, the worker removes cancelled entries from it and adds a computed field, then replies "done". The main thread then reads the Map. What does it see?',
      options: [
        'The worker\'s changes, because worker_threads share the same V8 heap',
        'The changes, but only if the main thread awaited the worker\'s reply',
        'A DataCloneError, because Maps cannot be sent to workers',
        'The original Map unchanged, because postMessage structured-clones the Map into the worker\'s isolate',
      ],
      correct: [3],
      explanation:
        'Each worker is a separate V8 isolate with its own heap. postMessage uses the structured clone algorithm, which supports Map, so the worker mutates its own copy and nothing propagates back. Only SharedArrayBuffer memory is shared (and ArrayBuffers can be transferred, which moves ownership). Awaiting the reply changes timing, not memory visibility. The worker must send results back, and the main thread applies them as the single writer.',
      followUps: [
        {
          q: 'The bookings are large (200 MB) and cloning them per request is slow. What are your options?',
          a: 'Encode the hot data in a compact typed layout, such as a bitmap of 15-minute slots per room in a `SharedArrayBuffer`, built once and shared with workers. Workers read it without copying, and writes stay on the main thread or use `Atomics`. Alternatively, keep the data in the worker permanently (the worker owns the index and the main thread sends small queries), or transfer an `ArrayBuffer` zero-copy when ownership can move. Cloning 200 MB per request is never acceptable.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-15',
      difficulty: 'hard',
      question:
        'A clickstream ingestion endpoint pushes events into an in-process bounded queue drained by consumers that batch-write to ClickHouse. During a ClickHouse slowdown the queue fills. Which full-queue policy fits best for the HTTP handler?',
      options: [
        'await queue.put() so the handler blocks until space frees up',
        'queue.offer(); if it returns false, respond 429/503 with Retry-After so clients back off and retry later',
        'Grow the queue capacity dynamically to avoid ever rejecting',
        'Drop the oldest queued event silently to make room',
      ],
      correct: [1],
      explanation:
        'The producer is a remote client, not a loop you control. Blocking the handler ties up sockets and memory, and clients time out anyway (then retry, which adds load). Failing fast with 429/503 and Retry-After pushes backpressure to clients, who can buffer and retry. An unbounded queue is the original OOM bug. Silent drops lose data without anyone knowing, which may be acceptable for some telemetry but should be a deliberate, metered choice rather than the default.',
      followUps: [
        {
          q: 'Mobile SDKs cannot retry for long and product says clickstream may lose up to 0.1% of events. Does that change the policy?',
          a: 'Yes. A bounded, metered drop becomes reasonable. Drop the newest (or sample) when the queue is above 90%, increment a `dropped_events_total` counter, and alert when the drop rate exceeds 0.1%. Better still, decouple from ClickHouse with a durable buffer (Kafka) in front, so a slow sink causes lag rather than loss, and the in-process queue only absorbs short bursts.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-16',
      difficulty: 'expert',
      question:
        'A Java notification service uses Executors.newFixedThreadPool(32) and submits a task per event. During a vendor outage the JVM dies with OutOfMemoryError although only 32 threads exist. Why?',
      options: [
        'newFixedThreadPool uses an unbounded LinkedBlockingQueue, so tasks pile up on the heap without limit while the 32 threads are stuck',
        'Each blocked thread reserves heap equal to its stack size',
        'Fixed pools create a new thread per task once all 32 are busy',
        'The JVM leaks Future objects only when tasks throw exceptions',
      ],
      correct: [0],
      explanation:
        'The fixed pool caps threads, not queued work. Its LinkedBlockingQueue has capacity Integer.MAX_VALUE, so every submitted task (and its captured payload) waits on the heap until memory runs out. Thread stacks are off-heap and only 32 exist. Fixed pools never grow beyond their size (cached pools do). Futures accumulate only if the caller retains them. Use a ThreadPoolExecutor with a bounded ArrayBlockingQueue and a rejection policy such as CallerRunsPolicy.',
      followUps: [
        {
          q: 'You switch to a bounded queue with CallerRunsPolicy. What does that do to the thread submitting tasks, and when is that bad?',
          a: 'When the queue is full, the submitting thread runs the task itself, which slows the producer to consumer speed: backpressure for free. That is bad if the submitter is a Kafka poll loop (polling stalls, the consumer misses `max.poll.interval.ms` and is kicked from the group) or a Netty event loop (all connections stall). In those cases, reject explicitly and pause the source instead.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-17',
      difficulty: 'expert',
      question:
        'Your in-memory parking-lot design guarantees "one vehicle per spot" with an async-mutex per floor. It now runs on 3 pods. Select ALL mechanisms that still guarantee the invariant.',
      options: [
        'A partial unique index on active assignments (spot_id WHERE released_at IS NULL) with INSERT ... ON CONFLICT DO NOTHING',
        'Routing all requests for a given lot to one consumer via a Kafka partition key on lotId, keeping the in-memory design',
        'Keeping the per-floor async-mutex, but making it a module-level singleton',
        'A conditional UPDATE spots SET vehicle=$1 WHERE id=$2 AND vehicle IS NULL, checking rowCount',
        'Using worker_threads with Atomics.compareExchange on a SharedArrayBuffer of spot states',
      ],
      correct: [0, 1, 3],
      explanation:
        'The constraint and the conditional UPDATE put the invariant in the single shared store, so any number of pods can race and only one wins. Partition-key routing makes one consumer the single writer for each lot, so the in-memory design stays valid (ownership handover still needs care during rebalances). A module-level mutex is still one per process. SharedArrayBuffer is shared only among threads of one process, never across pods.',
      followUps: [
        {
          q: 'With the partition-routing option, a rebalance moves lot L7 from pod 1 to pod 2 while pod 1 is mid-request. How can two pods briefly both assign the same spot?',
          a: 'Pod 1 may still be finishing a request it read before losing the partition, while pod 2 has already rebuilt state and starts serving L7. If both write assignments, the invariant breaks. Mitigations: pod 2 rebuilds from the durable store after the handover; writes carry an owner epoch (the partition generation) checked by the store (`WHERE owner_epoch = $e`); and the DB constraint remains as the final guard.',
        },
      ],
    },
    {
      id: 'lld-patterns-concurrency-mcq-18',
      difficulty: 'medium',
      question:
        'Wallet is a plain object with public balance and frozen fields. WalletService.debit checks frozen and limits, but the new RefundReversalService wrote wallet.balance -= x directly and drove frozen wallets negative. What is the design-level fix?',
      options: [
        'Add the same frozen and limit checks to RefundReversalService and mention them in the PR template',
        'Add a database trigger and keep the domain model as is',
        'Create a WalletValidator singleton that every service must call before mutating',
        'Move the invariants into Wallet: private balance, and debit()/credit() methods that enforce frozen and overdraft rules',
      ],
      correct: [3],
      explanation:
        'This is the anaemic domain model failure. Rules that protect one aggregate\'s consistency belong on that aggregate, so no caller can bypass them. Copying checks into each service repeats the bug the next time someone forgets. A validator singleton is optional to call, so the same gap remains. A DB trigger is a useful last line of defence, but it pushes business rules into the database and the domain stays easy to misuse.',
      followUps: [
        {
          q: 'A transfer needs to debit one wallet and credit another atomically. Does that logic go on Wallet too?',
          a: 'No. It coordinates two aggregates, so it belongs in a domain or application service, `TransferService`. The service loads both wallets, calls `from.debit(x)` and `to.credit(x)` (each enforcing its own rules), and persists both in one transaction, or uses a saga if the wallets live in different stores. Each entity guards itself, and the service guards the cross-entity invariant (money is conserved).',
        },
      ],
    },
  ],
};

export default topic;
