import type { Topic } from '../../types';

const topic: Topic = {
  id: 'lld-oop-solid',
  phase: 'lld',
  order: 2,
  title: 'OOP, SOLID & Modelling for LLD',
  subtitle:
    'The four pillars used for protecting invariants rather than as textbook vocabulary, composition over inheritance, interfaces vs abstract classes in TypeScript and Java, every SOLID principle as violation → fix, UML relationships in ASCII, cohesion and coupling, value objects and aggregates, and designing for testability with NestJS providers.',
  estimatedMinutes: 100,
  sources: [
    'Robert C. Martin — Clean Architecture (Part III: Design Principles — SRP, OCP, LSP, ISP, DIP)',
    'Robert C. Martin — Agile Software Development: Principles, Patterns, and Practices',
    'Eric Evans — Domain-Driven Design (entities, value objects, aggregates)',
    'Vaughn Vernon — Implementing Domain-Driven Design, Ch 10 Aggregates ("Effective Aggregate Design")',
    'Joshua Bloch — Effective Java, 3rd ed., Item 18 "Favor composition over inheritance", Item 17 "Minimize mutability"',
    'Gamma, Helm, Johnson, Vlissides — Design Patterns (composition over inheritance)',
    'Barbara Liskov & Jeannette Wing — A Behavioral Notion of Subtyping (1994)',
    'NestJS documentation — Custom providers, injection tokens, testing',
    'Sandi Metz — "The Wrong Abstraction" (2016)',
    'Alistair Cockburn — Hexagonal Architecture (Ports and Adapters), 2005',
    'Jeffrey Palermo — The Onion Architecture (2008)',
    'Robert C. Martin — The Clean Architecture (blog, 2012)',
  ],
  tags: ['lld', 'oop', 'solid', 'composition', 'uml', 'value-objects', 'aggregates', 'ddd', 'dependency-injection', 'nestjs', 'typescript'],
  cheatSheet: [
    'Encapsulation = protecting invariants (balance never negative), not writing getters/setters. Expose behaviour (`debit`), not state (`setBalance`).',
    'Composition over inheritance: inherit only for true is-a with substitutable behaviour; vary behaviour by holding a strategy/policy. Inheritance couples you to the parent\'s implementation (fragile base class).',
    'TS interfaces are erased at runtime (structural typing) → NestJS needs a token (`Symbol` + `@Inject`) or an abstract class as token. Java interfaces are nominal and exist at runtime.',
    'SRP: one reason to change (one actor). OCP: add behaviour by adding code, not editing. LSP: subtypes keep the contract (no stronger preconditions, no weaker postconditions, no surprise throws). ISP: small client-specific interfaces. DIP: policy depends on abstractions it owns.',
    'UML: association (uses-long-term) `-->`, aggregation (has, independent lifecycle) `o--`, composition (owns, dies with whole) `<>--`, dependency (uses transiently) `..>`, realization `..|>`, inheritance `^`.',
    'High cohesion, low coupling; a constructor with 7+ dependencies or a class named Manager/Helper/Util is a cohesion smell.',
    'DRY is about knowledge, not identical-looking lines; duplication is cheaper than the wrong abstraction. YAGNI: no seams without a known variation or I/O boundary. KISS: the simplest design that passes the twist you can see.',
    'Value objects: immutable, equality by value, self-validating (Money in paise as bigint/integer + currency). Entities: identity + lifecycle.',
    'Aggregate = consistency boundary; mutate only via the root, one aggregate per transaction, reference other aggregates by ID, keep them small (hot aggregates serialise writes).',
    'Testability = inject time, randomness, I/O. Constructor injection, composition root (NestJS module) is the only place choosing implementations; fakes over mocks for repositories.',
  ],
  sections: [
    {
      heading: '1. The four pillars, done right: encapsulation is about invariants',
      body: `**Intuition:** an object is a small bouncer guarding a rule. If anyone can reach in and change its fields, the bouncer is decorative.

**Encapsulation** — hide state so the object can guarantee its invariants. The test: *can any caller put this object into an invalid state?* Getters and setters for every field fail that test — \`setBalance(-500)\` is a public field with extra steps. Expose intention-revealing behaviour: \`debit\`, \`credit\`, \`freeze\`.

**Abstraction** — expose *what*, hide *how*. A \`PaymentGateway.charge(amount, ref)\` abstracts Razorpay vs Stripe vs a fake; callers never see HTTP, signatures or retries.

**Polymorphism** — one call, many behaviours, chosen at runtime by the object (\`channel.send()\` on email/SMS/push). It replaces type switches; in TS it is mostly *interface* polymorphism (structural), not class hierarchies.

**Inheritance** — reuse + subtyping in one mechanism, which is exactly why it is dangerous: you inherit the parent's implementation and its future changes. Use it sparingly (section 2).

| Pillar | Misuse seen in LLD rounds | Done right |
|---|---|---|
| Encapsulation | public fields, setters for everything | behaviour methods enforcing invariants |
| Abstraction | interface mirroring one class 1:1 | interface shaped by the caller's needs |
| Polymorphism | \`if (type === 'SMS')\` chains | strategy objects chosen once |
| Inheritance | \`PremiumUser extends User\` | user *has* a plan/policy |

**Interview line:** "I'll make the wallet own its balance and only expose operations that keep it non-negative — that's what encapsulation buys us."`,
      code: [
        {
          language: 'typescript',
          title: 'wallet.ts — invariant-guarding behaviour instead of setters',
          code: `export class InsufficientFunds extends Error {}
export class WalletFrozen extends Error {}

export class Wallet {
  private balancePaise: bigint;
  private frozen = false;
  private readonly entries: { kind: 'CR' | 'DR'; paise: bigint; ref: string }[] = [];

  constructor(readonly id: string, readonly ownerId: string, openingPaise = 0n) {
    if (openingPaise < 0n) throw new RangeError('opening balance cannot be negative');
    this.balancePaise = openingPaise;
  }

  get balance(): bigint { return this.balancePaise; } // read-only view, no setter

  credit(paise: bigint, ref: string): void {
    this.assertPositive(paise);
    this.assertActive();
    this.balancePaise += paise;
    this.entries.push({ kind: 'CR', paise, ref });
  }

  debit(paise: bigint, ref: string): void {
    this.assertPositive(paise);
    this.assertActive();
    if (paise > this.balancePaise) throw new InsufficientFunds(this.id);
    this.balancePaise -= paise; // invariant: balance >= 0 holds after every public call
    this.entries.push({ kind: 'DR', paise, ref });
  }

  freeze(): void { this.frozen = true; }

  history(): ReadonlyArray<{ kind: 'CR' | 'DR'; paise: bigint; ref: string }> {
    return this.entries.map((e) => ({ ...e })); // copies: callers can't rewrite history
  }

  private assertPositive(p: bigint) { if (p <= 0n) throw new RangeError('amount must be > 0'); }
  private assertActive() { if (this.frozen) throw new WalletFrozen(this.id); }
}`,
        },
      ],
      keyPoints: [
        'Ask "can a caller break the invariant?" — if yes, encapsulation failed.',
        'Return copies or read-only views of internal collections.',
        'Polymorphism replaces type switches; inheritance is only one way to get it.',
      ],
    },
    {
      heading: '2. Composition over inheritance (and when inheritance is fine)',
      body: `**Intuition:** inheritance is a tattoo — permanent, and you get the whole design. Composition is a toolbelt — you pick tools and swap them.

**Why inheritance bites:**

- **Fragile base class.** A subclass depends on *how* the parent implements methods. Classic (Effective Java Item 18): an \`InstrumentedSet\` overriding \`add\` and \`addAll\` double-counts because the parent's \`addAll\` calls \`add\` internally — an implementation detail you never agreed to. JavaScript has its own version: \`Set\`'s constructor calls \`this.add\` for initial values, before the subclass's fields exist (snippet below).
- **Combinatorial explosion.** \`EmailNotification\`, \`UrgentEmailNotification\`, \`BatchedSmsNotification\`, \`UrgentBatchedPush...\` — N channels × M behaviours.
- **Single inheritance** in TS and Java: once you extend one base, you can't extend another axis.
- **Static choice.** A user can't change from \`FreeUser\` to \`PremiumUser\` at runtime without rebuilding the object.

**Composition:** the object *has* collaborators for each axis of variation (channel, urgency policy, batching policy) and delegates. Behaviour can change at runtime, and each axis evolves independently.

**When inheritance is fine:** a genuine is-a with substitutable behaviour and a stable base, ideally an **abstract base designed for extension** (template method with protected hooks), or framework requirements (\`extends Error\`, NestJS \`PassportStrategy\`). Keep hierarchies shallow (≤ 2 levels).

| Question | Inheritance | Composition |
|---|---|---|
| Change behaviour at runtime? | no | yes (swap the collaborator) |
| Two independent axes of variation? | explodes | one field per axis |
| Reuse without exposing parent API? | no — all public methods leak | yes — expose only what you choose |
| Coupling to implementation | high | to an interface only |`,
      code: [
        {
          language: 'typescript',
          title: 'fragile base class → composition with a decorator',
          code: `// BROKEN: Set's constructor calls this.add() for each initial value — a base-class
// implementation detail. Our override runs during super(), BEFORE our field initialiser.
class TrackedSet<T> extends Set<T> {
  added = 0;
  override add(v: T) { this.added++; return super.add(v); }
}
const s = new TrackedSet(['a', 'b', 'c']);
// s.size === 3 but s.added === 0: add() ran 3 times (undefined++ → NaN), then 'added = 0' reset it

// FIX: wrap, don't extend. We depend on the interface, not on internals.
interface Bag<T> { add(v: T): void; has(v: T): boolean; size(): number; }

class SetBag<T> implements Bag<T> {
  private s = new Set<T>();
  add(v: T) { this.s.add(v); }
  has(v: T) { return this.s.has(v); }
  size() { return this.s.size; }
}

class CountingBag<T> implements Bag<T> {
  private attempts = 0;
  constructor(private readonly inner: Bag<T>) {}
  add(v: T) { this.attempts++; this.inner.add(v); }
  addAll(vs: T[]) { for (const v of vs) this.add(v); } // our own loop: no hidden coupling
  has(v: T) { return this.inner.has(v); }
  size() { return this.inner.size(); }
  get addAttempts() { return this.attempts; }
}

// Variation by composition, not subclass-per-combination
interface UrgencyPolicy { delayMs(): number; }
interface BatchingPolicy { shouldFlush(pending: number): boolean; }
class Notifier {
  constructor(
    private readonly channel: { send(msg: string): Promise<void> },
    private readonly urgency: UrgencyPolicy,
    private readonly batching: BatchingPolicy,
  ) {}
}`,
        },
      ],
      source: 'Joshua Bloch — Effective Java, Item 18; GoF — Design Patterns, Introduction',
    },
    {
      heading: '3. Interfaces vs abstract classes — the TypeScript view and the Java view',
      body: `**Intuition:** an interface is a contract ("you must be able to do X"); an abstract class is a half-built house ("here is the frame, you finish the rooms").

| Aspect | TS interface | TS abstract class | Java interface | Java abstract class |
|---|---|---|---|---|
| Exists at runtime | **no** (erased) | yes (a JS class) | yes | yes |
| Typing | structural — anything with the right shape fits | nominal-ish when used with \`instanceof\`; structural for type checks | nominal (\`implements\`) | nominal |
| State/fields | no | yes | constants only | yes |
| Implementation | no | yes (concrete + abstract members) | \`default\` methods (Java 8+) | yes |
| Multiple | implement many | extend one | implement many | extend one |
| Use as DI token | needs a \`Symbol\`/string token | **can be the token** | Spring injects by type | by type |

**TypeScript consequences:**

- Because typing is structural, a plain object literal \`{ now: () => new Date() }\` satisfies \`Clock\` — great for test fakes, no mocking library needed.
- Because interfaces are erased, \`@Inject()\` can't find an interface at runtime. Use \`provide: CLOCK\` (a \`Symbol\`) + \`@Inject(CLOCK)\`, or declare \`abstract class Clock\` and use it as both type and token.
- \`instanceof SomeInterface\` is impossible; prefer discriminated unions (\`kind: 'card' | 'upi'\`) or type guards.

**Java consequences interviewers probe:** interfaces with \`default\` methods blur the line, but abstract classes still own *state* and constructors. Rule: interface for capability (\`Comparable\`, \`PaymentMethod\`), abstract class when subclasses share state and a template algorithm.

**Default for LLD:** interfaces for seams; an abstract class only when there is real shared state or a template method — and even then consider composition first.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS: interface + Symbol token vs abstract class as token',
          code: `import { Inject, Injectable, Module } from '@nestjs/common';

// Option A: interface (erased) + explicit token
export interface Clock { now(): Date; }
export const CLOCK = Symbol('CLOCK');

@Injectable()
export class ExpiryService {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}
  isExpired(expiresAt: Date) { return this.clock.now() >= expiresAt; }
}

// Option B: abstract class doubles as type AND runtime token
export abstract class PaymentGateway {
  abstract charge(paise: bigint, ref: string): Promise<{ gatewayRef: string }>;
  // shared, non-abstract behaviour is allowed here (unlike an interface)
  protected idempotencyHeader(ref: string) { return { 'Idempotency-Key': ref }; }
}

@Injectable()
export class RazorpayGateway extends PaymentGateway {
  async charge(paise: bigint, ref: string) {
    // HTTP call with this.idempotencyHeader(ref) ...
    return { gatewayRef: 'pay_' + ref };
  }
}

@Injectable()
export class CheckoutService {
  constructor(private readonly gateway: PaymentGateway) {} // no @Inject needed
}

@Module({
  providers: [
    ExpiryService,
    CheckoutService,
    { provide: CLOCK, useValue: { now: () => new Date() } satisfies Clock },
    { provide: PaymentGateway, useClass: RazorpayGateway },
  ],
})
export class CheckoutModule {}`,
        },
      ],
      source: 'NestJS docs — Custom providers (non-class-based provider tokens)',
    },
    {
      heading: '4. SRP and OCP — violation → fix',
      body: `**SRP (Single Responsibility):** "a module should be responsible to one, and only one, actor" (Clean Architecture). Not "does one thing" — a class can have five methods and still have one reason to change. The smell: finance, ops and marketing all request edits to the same class.

**OCP (Open/Closed):** open for extension, closed for modification — new behaviour arrives as *new code* (a class plus registration), not as edits to tested code. OCP is relative to *anticipated* change: you protect against the variation you can see (new payment methods), not every imaginable one.

**Violation:** \`InvoiceService\` computes GST, renders a PDF, emails it and switches on discount type. Finance (tax rules), design (PDF layout), CRM (email) and marketing (discounts) all edit one file; each new discount edits a switch.

**Fix:** split by actor — \`TaxCalculator\`, \`InvoiceRenderer\`, \`InvoiceMailer\`; discounts become a \`DiscountRule\` registry. The orchestrating service only sequences steps.`,
      code: [
        {
          language: 'typescript',
          title: 'violation (top) → SRP + OCP fix (bottom)',
          code: `// VIOLATION: four actors, one class; every new discount edits the switch
class InvoiceServiceBad {
  async issue(order: Order) {
    let total = order.items.reduce((s, i) => s + i.pricePaise * BigInt(i.qty), 0n);
    switch (order.discount?.type) {
      case 'FLAT': total -= order.discount.paise; break;
      case 'PERCENT': total -= (total * BigInt(order.discount.pct)) / 100n; break;
      // marketing adds 'BOGO' next sprint → edit here
    }
    const gst = (total * 18n) / 100n;                          // finance
    const pdf = '<h1>Invoice</h1>' + total + ' + GST ' + gst; // design
    await sendMail(order.email, 'Invoice', pdf);              // CRM
  }
}

// FIX
interface DiscountRule { readonly type: string; apply(subtotal: bigint, order: Order): bigint; }
class FlatDiscount implements DiscountRule {
  readonly type = 'FLAT';
  apply(s: bigint, o: Order) { return s - (o.discount?.paise ?? 0n); }
}
class PercentDiscount implements DiscountRule {
  readonly type = 'PERCENT';
  apply(s: bigint, o: Order) { return s - (s * BigInt(o.discount?.pct ?? 0)) / 100n; }
}

interface TaxCalculator { taxOn(amount: bigint, order: Order): bigint; }       // finance owns
interface InvoiceRenderer { render(inv: InvoiceData): Promise<Buffer>; }       // design owns
interface InvoiceMailer { send(to: string, pdf: Buffer): Promise<void>; }      // CRM owns

class InvoiceService {
  private readonly rules: Map<string, DiscountRule>;
  constructor(
    rules: DiscountRule[],
    private readonly tax: TaxCalculator,
    private readonly renderer: InvoiceRenderer,
    private readonly mailer: InvoiceMailer,
  ) { this.rules = new Map(rules.map((r) => [r.type, r])); }

  async issue(order: Order) {
    const subtotal = order.items.reduce((s, i) => s + i.pricePaise * BigInt(i.qty), 0n);
    const rule = order.discount ? this.rules.get(order.discount.type) : undefined;
    if (order.discount && !rule) throw new Error('unknown discount ' + order.discount.type);
    const net = rule ? rule.apply(subtotal, order) : subtotal;
    const inv = { orderId: order.id, net, tax: this.tax.taxOn(net, order) };
    await this.mailer.send(order.email, await this.renderer.render(inv));
  }
}

type Order = { id: string; email: string; items: { pricePaise: bigint; qty: number }[];
  discount?: { type: string; paise?: bigint; pct?: number } };
type InvoiceData = { orderId: string; net: bigint; tax: bigint };
declare function sendMail(to: string, subject: string, body: string): Promise<void>;`,
        },
      ],
      keyPoints: [
        'SRP = one actor/reason to change, not "one method".',
        'OCP is achieved with polymorphism + a registry/composition root.',
        'Adding BOGO is now a new class + one line in the module.',
      ],
    },
    {
      heading: '5. LSP — substitutability is about behaviour, not signatures',
      body: `**Intuition:** if code works with a \`Bird\`, it must work with every bird you hand it. If your penguin throws on \`fly()\`, the type system lied.

**The behavioural rules (Liskov & Wing):** a subtype may not **strengthen preconditions** (accept less), **weaken postconditions** (promise less), break **invariants** of the parent, or throw **new kinds of exceptions** callers don't expect. The compiler checks signatures; it cannot check these.

**LLD-flavoured violations:**

- \`CashPayment extends PaymentMethod\` whose \`refund()\` throws \`NotSupported\` — every caller of \`refund\` now needs an \`instanceof\` check.
- \`ReadOnlyRepository extends Repository\` overriding \`save\` to throw.
- \`CappedQueue\` that silently drops on \`push\` where the base contract said "push always enqueues".
- A \`CachedPriceService\` returning stale prices where the base promised "current price" — a weakened postcondition.

**Fix pattern:** split the interface by capability (ISP helps LSP), so only types that can honour a contract claim it. \`Refundable\` is a separate interface; code that refunds asks for \`Refundable\`, and the type system now prevents the mismatch.

**Smell detector:** \`instanceof\` checks or "if subtype X, skip" in client code, and overrides whose body is \`throw new Error('not supported')\`.`,
      code: [
        {
          language: 'typescript',
          title: 'LSP violation → capability interfaces',
          code: `// VIOLATION
abstract class PaymentMethodBad {
  abstract pay(paise: bigint): Promise<string>;
  abstract refund(paymentId: string, paise: bigint): Promise<void>;
}
class CashOnDeliveryBad extends PaymentMethodBad {
  async pay() { return 'cod-' + Date.now(); }
  async refund(): Promise<void> { throw new Error('COD cannot be refunded online'); } // surprise
}
// every caller now writes: if (!(m instanceof CashOnDeliveryBad)) await m.refund(...)

// FIX: contracts only for what a type can honour
interface Payable { pay(paise: bigint, ref: string): Promise<string>; }
interface Refundable { refund(paymentId: string, paise: bigint): Promise<void>; }

class UpiPayment implements Payable, Refundable {
  async pay(paise: bigint, ref: string) { return 'upi-' + ref; }
  async refund(paymentId: string, paise: bigint) { /* PSP refund API */ }
}
class CashOnDelivery implements Payable {
  async pay(paise: bigint, ref: string) { return 'cod-' + ref; }
}

const isRefundable = (m: Payable): m is Payable & Refundable =>
  typeof (m as Partial<Refundable>).refund === 'function';

class RefundService {
  constructor(private readonly payout: { toBankAccount(orderId: string, paise: bigint): Promise<void> }) {}
  async refund(orderId: string, method: Payable, paymentId: string, paise: bigint) {
    if (isRefundable(method)) return method.refund(paymentId, paise);
    return this.payout.toBankAccount(orderId, paise); // explicit, modelled alternative path
  }
}`,
        },
      ],
      source: 'Liskov & Wing — A Behavioral Notion of Subtyping (1994); Martin — Clean Architecture, Ch 9',
    },
    {
      heading: '6. ISP and DIP — small interfaces, dependencies pointing inward',
      body: `**ISP (Interface Segregation):** clients shouldn't depend on methods they don't use. A 15-method \`UserRepository\` forces every fake to implement 15 methods and couples a read-only report to write operations. Shape interfaces by *client need*: \`UserReader\`, \`UserWriter\`, \`UserSearch\`. One class can implement all three.

**DIP (Dependency Inversion):** high-level policy must not depend on low-level detail; both depend on abstractions — and the abstraction is **owned by the policy side**. \`OrderService\` declares the \`PaymentGateway\` port it needs in *its* module; \`RazorpayAdapter\` in infra implements it. Source-code dependencies now point inward (infra → domain) even though calls flow outward.

**DIP is not DI.** Dependency *injection* is a mechanism (constructor parameters, NestJS container). Inversion is about *who owns the interface* and which way imports point. You can inject a concrete \`RazorpayClient\` and still violate DIP.

| | Violation | Fix |
|---|---|---|
| ISP | \`ReportService\` depends on full \`UserRepository\` (incl. delete) | depends on \`UserReader\` only |
| DIP | \`OrderService\` imports \`razorpay\` SDK types | \`OrderService\` owns \`PaymentGateway\`; adapter maps SDK types |`,
      code: [
        {
          language: 'typescript',
          title: 'ISP + DIP: ports owned by the domain, adapters in infra',
          code: `// ---- domain/ports.ts (owned by the high-level policy) ----
export interface OrderReader { byId(id: string): Promise<OrderSnapshot | null>; }
export interface OrderWriter { save(o: OrderSnapshot, expectedVersion: number): Promise<boolean>; }
export interface PaymentGateway { capture(orderId: string, paise: bigint): Promise<'OK' | 'DECLINED'>; }
export type OrderSnapshot = { id: string; totalPaise: bigint; status: 'PLACED' | 'PAID'; version: number };

// ---- domain/order.service.ts (imports only its own ports) ----
export class PayOrder {
  constructor(
    private readonly reader: OrderReader,
    private readonly writer: OrderWriter,
    private readonly gateway: PaymentGateway,
  ) {}
  async execute(orderId: string): Promise<void> {
    const o = await this.reader.byId(orderId);
    if (!o || o.status !== 'PLACED') throw new Error('order not payable');
    if ((await this.gateway.capture(o.id, o.totalPaise)) === 'DECLINED') throw new Error('declined');
    const ok = await this.writer.save({ ...o, status: 'PAID', version: o.version + 1 }, o.version);
    if (!ok) throw new Error('concurrent modification'); // optimistic lock lost
  }
}

// ---- infra/razorpay.adapter.ts (depends inward on the port) ----
type RazorpaySdk = { payments: { capture(id: string, amount: number, currency: string): Promise<{ status: string }> } };
export class RazorpayGateway implements PaymentGateway {
  constructor(private readonly sdk: RazorpaySdk, private readonly paymentIdFor: (orderId: string) => Promise<string>) {}
  async capture(orderId: string, paise: bigint) {
    const res = await this.sdk.payments.capture(await this.paymentIdFor(orderId), Number(paise), 'INR');
    return res.status === 'captured' ? 'OK' as const : 'DECLINED' as const; // SDK types stop here
  }
}

// ---- a report needs reading only (ISP) ----
export class RevenueReport {
  constructor(private readonly orders: OrderReader) {} // can't accidentally write
}`,
        },
      ],
      keyPoints: [
        'Interfaces are shaped by the client, not by the implementing class.',
        'The policy owns its ports; SDK types never cross into the domain.',
        'DI is a mechanism; DIP is a dependency-direction rule.',
      ],
    },
    {
      heading: '7. UML class relationships in ASCII (and what each means in code)',
      body: `**Intuition:** the relationship type answers two questions — *how long* do the objects know each other, and *who controls whose lifetime*?

| Relationship | Meaning | Lifetime | TS shape | Example |
|---|---|---|---|---|
| Dependency \`..>\` | uses transiently | none — parameter/local | method parameter | \`FareCalculator ..> Ride\` |
| Association \`-->\` | knows long-term | independent | field holding a reference/ID | \`Ride --> Driver\` |
| Aggregation \`o--\` | has-a, parts can exist alone | independent | collection of references passed in | \`Team o-- Player\` |
| Composition \`<>--\` | owns, parts die with whole | whole creates/destroys parts | parts created inside, never shared | \`Order <>-- OrderLine\` |
| Realization \`..|>\` | implements contract | — | \`implements\` | \`UpiPayment ..|> Payable\` |
| Inheritance \`^\` / \`--|>\` | is-a | — | \`extends\` | \`InsufficientFunds --|> Error\` |

**Multiplicity:** \`1\`, \`0..1\`, \`*\`/\`0..*\`, \`1..*\` on each end. Say it out loud: "an Order has 1..* OrderLines; an OrderLine belongs to exactly 1 Order".

**How composition shows in code:** the whole constructs its parts (\`order.addLine(sku, qty)\` creates the \`OrderLine\`), never exposes them for external mutation, and deleting the order deletes its lines (cascade). **Aggregation:** parts are passed in and outlive the whole (deleting a \`Team\` doesn't delete \`Player\`s).

**Interview trap:** aggregation vs composition is about **lifecycle ownership**, not about "strong vs weak" vibes. Ask "if the whole is deleted, do the parts still mean anything?"`,
      diagram: `            ┌──────────────┐ 1      1..* ┌──────────────┐
            │    Order     │<>───────────│  OrderLine   │   composition
            │ -lines       │             │ -sku -qty    │   (dies with Order)
            │ +addLine()   │             └──────────────┘
            └──┬───────┬───┘
       customerId│       │ 1
          (assoc)│       │<>── Money (value object)
                 v       │
          ┌──────────┐   │ ..> PricingPolicy  (dependency: param)
          │ Customer │   │
          └──────────┘   v
                   ┌─────────────┐        ┌──────────┐
                   │  Payable    │<|.......│UpiPayment│ realization
                   │<<interface>>│        └──────────┘
                   └─────────────┘
  ┌──────┐ 0..1    * ┌────────┐
  │ Team │o──────────│ Player │   aggregation (players outlive team)
  └──────┘           └────────┘
  ┌─────────────────┐
  │InsufficientFunds│──|> Error   inheritance`,
      code: [
        {
          language: 'typescript',
          title: 'Relationships as code',
          code: `class Player { constructor(readonly id: string, readonly name: string) {} }

class Team {                                   // aggregation: players passed in, shared, outlive team
  private readonly players = new Set<Player>();
  join(p: Player) { this.players.add(p); }
}

class OrderLine {                              // composition part: only Order creates it
  constructor(readonly sku: string, readonly qty: number, readonly unitPaise: bigint) {}
}

class Order {
  private readonly lines: OrderLine[] = [];
  constructor(readonly id: string, readonly customerId: string) {} // association by ID

  addLine(sku: string, qty: number, unitPaise: bigint) {          // whole constructs parts
    this.lines.push(new OrderLine(sku, qty, unitPaise));
  }
  total(policy: { adjust(paise: bigint): bigint }): bigint {     // dependency: parameter only
    const raw = this.lines.reduce((s, l) => s + l.unitPaise * BigInt(l.qty), 0n);
    return policy.adjust(raw);
  }
}`,
        },
      ],
    },
    {
      heading: '8. Cohesion, coupling, and the DRY / YAGNI / KISS trade-offs',
      body: `**Intuition:** cohesion = do the things inside a class belong together? Coupling = how much does this class need to know about others? You want rooms where everything is used together, and few, narrow doors between rooms.

**Cohesion (best → worst):** functional (all members serve one purpose) > sequential > communicational (operate on same data) > procedural > temporal ("things done at startup") > logical ("all validations") > coincidental (\`Utils\`). Signals of low cohesion: methods that use disjoint subsets of fields, names like \`Manager\`/\`Helper\`/\`Processor\`, constructors with 7+ dependencies.

**Coupling (worst → best):** content (reaching into another's internals) > common (shared global mutable state) > control (passing a flag that changes the callee's logic: \`save(order, true)\`) > stamp (passing a whole object when two fields are needed) > data (passing only needed values) > message (events).

**The principle trade-offs:**

| Principle | Means | Over-applied becomes |
|---|---|---|
| DRY | each piece of **knowledge** has one authoritative place | coupling unrelated code because lines look similar ("the wrong abstraction") |
| YAGNI | don't build for imagined requirements | refusing seams the problem statement clearly implies |
| KISS | simplest design that works | god function "because it's simple" |
| SOLID | manageable change | 40 one-method classes and interfaces with one impl |

**Key judgement (Sandi Metz):** duplication is far cheaper than the wrong abstraction. Two \`validateAddress\` functions for shipping and billing look identical today but change for different actors (logistics vs tax) — merging them couples two reasons to change. Wait for the third occurrence *and* the same reason to change.

**In interviews say:** "I'll keep this concrete now; the seam I'm adding is for X because the prompt implies variation there. Everything else stays simple until a requirement forces it."`,
      keyPoints: [
        'DRY applies to knowledge and rules, not to coincidentally similar code.',
        'Boolean flag parameters are control coupling — split the method or pass a strategy.',
        'Seams for known variation and I/O; simplicity everywhere else.',
      ],
    },
    {
      heading: '9. Immutability and value objects (Money done right)',
      body: `**Intuition:** a ₹500 note is a value — you don't care *which* note, and nobody edits it into ₹600. You exchange it for a new one.

**Value object properties:** no identity (equality by value), **immutable** (operations return new instances), **self-validating** (can't construct an invalid one), side-effect-free behaviour. Classic LLD candidates: \`Money\`, \`Email\`, \`PhoneNumber\`, \`DateRange\`, \`GeoPoint\`, \`SeatNumber\`, \`ShortCode\`.

**Why immutability matters in LLD:**

- **Aliasing bugs vanish:** a \`Money\` shared between a cart line and a discount can't be changed from under either.
- **Safe sharing across async boundaries** and caches without defensive copies.
- **Thread-safety in Java** for free (final fields, no setters) — the reason \`String\`, \`BigDecimal\`, \`LocalDate\` are immutable.
- **Cost:** allocation per operation — usually negligible next to I/O (see envelope questions).

**Money rules:** never \`number\` rupees with decimals (0.1 + 0.2 ≠ 0.3). Store integer minor units (paise) as \`bigint\` or safe integers, carry the currency, refuse to add different currencies, and make rounding explicit when splitting (allocate the remainder deterministically so parts sum to the whole).

**TS tools:** \`readonly\` fields, private constructor + static factory for validation, \`Object.freeze\` for runtime guarantees, \`equals()\` method (JS \`===\` compares references).`,
      code: [
        {
          language: 'typescript',
          title: 'money.ts — immutable, self-validating, exact',
          code: `export type Currency = 'INR' | 'USD';

export class Money {
  private constructor(readonly minor: bigint, readonly currency: Currency) {
    Object.freeze(this); // runtime immutability, not just a compile-time hint
  }

  static of(minor: bigint, currency: Currency): Money { return new Money(minor, currency); }

  static parse(rupees: string, currency: Currency = 'INR'): Money {
    const m = /^(-?)(\\d+)(?:\\.(\\d{1,2}))?$/.exec(rupees);
    if (!m) throw new RangeError('invalid amount: ' + rupees);
    const minor = BigInt(m[2]) * 100n + BigInt((m[3] ?? '').padEnd(2, '0'));
    return new Money(m[1] ? -minor : minor, currency);
  }

  add(o: Money): Money { this.same(o); return new Money(this.minor + o.minor, this.currency); }
  subtract(o: Money): Money { this.same(o); return new Money(this.minor - o.minor, this.currency); }
  times(qty: number): Money {
    if (!Number.isInteger(qty)) throw new RangeError('qty must be integer');
    return new Money(this.minor * BigInt(qty), this.currency);
  }

  /** split into n parts that always sum back to the original (first parts get the extra paise) */
  allocate(n: number): Money[] {
    const base = this.minor / BigInt(n);
    const rem = Number(this.minor % BigInt(n));
    return Array.from({ length: n }, (_, i) => new Money(base + (i < rem ? 1n : 0n), this.currency));
  }

  equals(o: Money): boolean { return this.minor === o.minor && this.currency === o.currency; }
  isNegative(): boolean { return this.minor < 0n; }
  toString(): string {
    const abs = this.minor < 0n ? -this.minor : this.minor;
    return (this.minor < 0n ? '-' : '') + (abs / 100n) + '.' + String(abs % 100n).padStart(2, '0') + ' ' + this.currency;
  }

  private same(o: Money) {
    if (o.currency !== this.currency) throw new TypeError('currency mismatch: ' + this.currency + ' vs ' + o.currency);
  }
}

// Money.parse('100.00').allocate(3) → [33.34, 33.33, 33.33] — sums to exactly 100.00`,
        },
      ],
      source: 'Eric Evans — Domain-Driven Design, Ch 5 (Value Objects); Effective Java Item 17',
    },
    {
      heading: '10. Domain modelling: entities, value objects and aggregates',
      body: `**Intuition:** an aggregate is a cluster of objects you treat as one unit for changes — like a sealed envelope. You can only change what's inside by handing the envelope to its owner (the root), who checks the rules before sealing it again.

**Entity vs value object:**

| | Entity | Value object |
|---|---|---|
| Identity | yes (\`orderId\`) — same entity even when attributes change | no — defined by attributes |
| Mutability | lifecycle state changes (PLACED → PAID) | immutable |
| Equality | by ID | by value |
| Examples | Order, Booking, Wallet, Driver | Money, Address, DateRange, SeatNo |

**Aggregate rules (Evans, Vernon):**

1. **The root is the only entry point.** External code calls \`order.addItem()\`, never \`order.lines.push()\`.
2. **Invariants inside the boundary are always consistent** after each root method (e.g. cart total ≤ ₹2,00,000, max 10 units per SKU, no changes after PAID).
3. **One aggregate per transaction.** Cross-aggregate rules (decrement inventory when an order is placed) are eventually consistent via domain events.
4. **Reference other aggregates by ID**, not object references (\`customerId\`, not \`Customer\`).
5. **Keep aggregates small.** A large aggregate means more contention: every write locks/versions the whole thing.

**Concurrency:** the aggregate carries a \`version\`; the repository saves with \`WHERE id = ? AND version = ?\` (optimistic locking). In Java/JPA that is \`@Version\`; in TypeORM \`@VersionColumn\`.

**Anemic model smell:** entities as bags of public fields and all logic in services — the invariants end up duplicated or missing.`,
      code: [
        {
          language: 'typescript',
          title: 'order.aggregate.ts — root guards invariants; events for cross-aggregate effects',
          code: `import { Money } from './money';

type Status = 'DRAFT' | 'PLACED' | 'PAID' | 'CANCELLED';
export type DomainEvent =
  | { type: 'OrderPlaced'; orderId: string; lines: { sku: string; qty: number }[] }
  | { type: 'OrderCancelled'; orderId: string };

class Line { // entity local to the aggregate; not exported
  constructor(readonly sku: string, public qty: number, readonly unit: Money) {}
  subtotal() { return this.unit.times(this.qty); }
}

export class Order {
  static readonly MAX_TOTAL = Money.parse('200000.00');
  static readonly MAX_QTY_PER_SKU = 10;
  private readonly lines = new Map<string, Line>();
  private status: Status = 'DRAFT';
  private readonly pending: DomainEvent[] = [];

  constructor(readonly id: string, readonly customerId: string, public version = 0) {}

  addItem(sku: string, qty: number, unit: Money): void {
    this.assertStatus('DRAFT');
    const line = this.lines.get(sku);
    const newQty = (line?.qty ?? 0) + qty;
    if (qty <= 0 || newQty > Order.MAX_QTY_PER_SKU) throw new RangeError('qty out of range for ' + sku);
    const newTotal = this.total().add(unit.times(qty));
    if (newTotal.minor > Order.MAX_TOTAL.minor) throw new RangeError('order limit exceeded');
    if (line) line.qty = newQty; else this.lines.set(sku, new Line(sku, qty, unit));
  }

  place(): void {
    this.assertStatus('DRAFT');
    if (this.lines.size === 0) throw new Error('empty order');
    this.status = 'PLACED';
    this.pending.push({ type: 'OrderPlaced', orderId: this.id,
      lines: [...this.lines.values()].map((l) => ({ sku: l.sku, qty: l.qty })) });
  }

  cancel(): void {
    if (this.status === 'PAID') throw new Error('paid orders are refunded, not cancelled');
    this.status = 'CANCELLED';
    this.pending.push({ type: 'OrderCancelled', orderId: this.id });
  }

  total(): Money {
    let t = Money.of(0n, 'INR');
    for (const l of this.lines.values()) t = t.add(l.subtotal());
    return t;
  }

  pullEvents(): DomainEvent[] { return this.pending.splice(0); } // repository publishes after save
  private assertStatus(s: Status) { if (this.status !== s) throw new Error('order is ' + this.status); }
}`,
        },
      ],
      source: 'Eric Evans — Domain-Driven Design, Ch 6 (Aggregates); Vaughn Vernon — Effective Aggregate Design',
    },
    {
      heading: '11. Designing for testability: DI, NestJS providers and fakes',
      body: `**Intuition:** a testable class is one where everything that makes it unpredictable (time, randomness, network, storage) comes in through the front door — the constructor — so a test can hand it a controllable substitute.

**Hidden dependencies that kill testability:** \`Date.now()\`, \`Math.random()\`/\`uuid()\`, \`new HttpClient()\` inside methods, module-level singletons (\`import { db } from './db'\`), static methods with side effects, \`process.env\` reads deep in logic.

**Rules:**

- **Constructor injection** of every collaborator that does I/O or is non-deterministic.
- **Composition root:** one place chooses implementations (the NestJS module / \`app.ts\`). Classes never \`new\` their infrastructure.
- **Fakes over mocks** for repositories (an in-memory implementation that honours the contract) — tests assert on outcomes, not on call sequences, so refactors don't break them. Mocks for interactions that *are* the behaviour (e.g. "an email was sent").
- **Pure domain:** entities and value objects need no DI at all — test them directly.
- **NestJS specifics:** default provider scope is singleton (one instance per app); \`Scope.REQUEST\` creates the provider (and everything depending on it) per request — avoid unless needed (cost, see envelope). Use \`Test.createTestingModule\` + \`overrideProvider\` for integration tests; plain \`new Service(fakes)\` for unit tests — faster and framework-free.`,
      code: [
        {
          language: 'typescript',
          title: 'subscription.service.ts — injectable time & IDs; unit test without Nest; module wiring',
          code: `import { Inject, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface Clock { now(): Date; }
export interface IdGen { next(): string; }
export interface SubscriptionRepo { save(s: Subscription): Promise<void>; byUser(u: string): Promise<Subscription | null>; }
export type Subscription = { id: string; userId: string; plan: 'MONTHLY' | 'ANNUAL'; renewsAt: Date };
export const CLOCK = Symbol('CLOCK');
export const ID_GEN = Symbol('ID_GEN');
export const SUB_REPO = Symbol('SUB_REPO');

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(SUB_REPO) private readonly repo: SubscriptionRepo,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GEN) private readonly ids: IdGen,
  ) {}

  async subscribe(userId: string, plan: Subscription['plan']): Promise<Subscription> {
    if (await this.repo.byUser(userId)) throw new Error('already subscribed');
    const renewsAt = new Date(this.clock.now());
    if (plan === 'MONTHLY') renewsAt.setUTCMonth(renewsAt.getUTCMonth() + 1);
    else renewsAt.setUTCFullYear(renewsAt.getUTCFullYear() + 1);
    const sub = { id: this.ids.next(), userId, plan, renewsAt };
    await this.repo.save(sub);
    return sub;
  }
}

@Module({
  providers: [
    SubscriptionService,
    { provide: CLOCK, useValue: { now: () => new Date() } },
    { provide: ID_GEN, useValue: { next: () => randomUUID() } },
    // { provide: SUB_REPO, useClass: PgSubscriptionRepo },
  ],
})
export class SubscriptionModule {}

// Unit test: no Nest container, no mocking library — structural typing makes fakes trivial
// const repo = new Map<string, Subscription>();
// const svc = new SubscriptionService(
//   { save: async (s) => { repo.set(s.userId, s); }, byUser: async (u) => repo.get(u) ?? null },
//   { now: () => new Date('2026-01-31T10:00:00Z') },
//   { next: () => 'sub-1' });
// expect((await svc.subscribe('u1', 'MONTHLY')).renewsAt) → 2026-03-03 (!) — the test exposes
// JS month overflow from Jan 31; the fix (clamp to month end) is now a one-line, testable change.`,
        },
      ],
      keyPoints: [
        'Time, randomness and I/O come through the constructor.',
        'Fakes that honour contracts beat mocks that assert call order.',
        'Deterministic tests reveal real bugs (month overflow on Jan 31).',
      ],
    },
    {
      heading: '12. DDD vocabulary for LLD rounds: ubiquitous language, entities, value objects, aggregates and aggregate roots, repositories, domain events, bounded contexts, anti-corruption layer',
      body: `**Intuition:** DDD gives you two toolkits. **Tactical** patterns shape the classes *inside* one model: entity, value object, aggregate, repository, domain event. **Strategic** patterns decide *where one model ends and the next begins*: bounded context, context map, anti-corruption layer. LLD rounds mostly test tactical patterns. Senior rounds add "and how does this talk to the rest of the company?", which is strategic.

**Tactical glossary** (section 10 covers aggregate rules in depth):

| Term | One-line meaning | How it shows up in code | Smell in an LLD round |
|---|---|---|---|
| **Ubiquitous language** | the same words in conversations, code, tests and events | \`booking.confirm()\`, \`SeatHeld\` event | \`setStatus(2)\`, a \`Manager\`/\`Helper\` class, "trip" in code but "ride" in the spec |
| **Entity** | identity that persists while attributes change | \`Booking\` with \`id\`, equality by id | entity with public setters for every field |
| **Value object** | defined by its values, immutable, self-validating | \`Money\`, \`SeatNo\`, \`DateRange\` | primitive obsession: \`price: number\`, \`currency: string\` passed separately |
| **Aggregate / root** | consistency boundary; outsiders talk only to the root | \`show.holdSeats(...)\` checks rules, then changes child seats | code reaching into \`show.seats[3].status = ...\` |
| **Factory** | creation that has to enforce invariants | \`Booking.request(...)\` static method or a factory class | constructors with 9 optional params |
| **Repository** | collection-like access to **whole aggregates**, one per root | \`ShowRepository.byId()\` / \`save(show, version)\` | a repository per table, or \`updateSeatStatus(seatId)\` bypassing the root |
| **Domain service** | rule that belongs to no single entity | \`PricingPolicy.quote(show, seats, coupon)\` | everything becomes a service → anemic model |
| **Application service / use case** | orchestrates: load → call domain → save → publish; owns the transaction | \`HoldSeatsHandler\` | business rules inside the handler |
| **Domain event** | past-tense fact raised by an aggregate | \`SeatsHeld { showId, seats, until }\` | events named like commands (\`SendEmail\`) |

**Domain event vs integration event:** a domain event lives inside one context and can be dispatched in-process. An **integration event** is the published, versioned contract other contexts consume, sent through an outbox to Kafka/SNS. Keep them separate so internal refactors don't break consumers.

**Strategic patterns:**
- **Bounded context:** the boundary inside which a word has exactly one meaning. "Show" in *Catalogue* is a title, cast and poster. In *Booking* it is a seat map with holds. In *Settlement* it is revenue share and tax. Forcing one shared \`Show\` class on all three is how god-objects are born. One team usually owns a context, and it often (not always) maps to one service or one NestJS module.
- **Context map relationships:** customer–supplier (upstream plans with downstream needs), conformist (downstream adopts upstream's model as-is), shared kernel (small co-owned code, high coordination), open host service + published language (upstream offers a stable API/event schema for many), separate ways, and **anti-corruption layer**.
- **Anti-corruption layer (ACL):** a translation layer *owned by the downstream context*. It converts a foreign or legacy model (status codes, odd field names, overloaded records) into your own value objects, so the foreign model never leaks into your domain. In Nest it is an adapter provider that implements your port and contains every mapping and every "unknown code" decision.

**In an LLD round say this:** "Inside the Booking context, \`Show\` is the aggregate root that guards seat holds. Other contexts learn about bookings through a versioned \`BookingConfirmed\` integration event. The legacy payment switch sits behind an ACL, so its codes never appear in our domain."`,
      diagram: `  [Catalogue]  --- open host / published language ---+
   Show = title, cast, poster                         |
                                                      v  ShowScheduled v1
  [Booking]  (Show = seat map + holds; root = Show)   <----------------+
     |  BookingConfirmed v2 (integration event, outbox)
     v
  [Settlement]  customer-supplier: Booking is upstream
     |
     | ACL (adapter owned by Settlement)
     v
  {Legacy payment switch}  codes '00','05','91', amounts in paise strings`,
      code: [
        {
          language: 'typescript',
          title: 'Booking context in NestJS: aggregate, repository port, ACL adapter, use case',
          code: `import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ---- booking/domain: no Nest, no ORM ----
export type SeatNo = string & { readonly __brand: 'SeatNo' };
export type SeatsHeld = { type: 'SeatsHeld'; showId: string; seats: SeatNo[]; until: Date };

export class Show {                                   // aggregate root
  private readonly events: SeatsHeld[] = [];
  constructor(readonly id: string, private readonly held: Map<SeatNo, Date>, public version: number) {}

  holdSeats(seats: SeatNo[], now: Date, ttlMs: number): void {
    if (seats.length === 0 || seats.length > 10) throw new RangeError('1-10 seats per hold');
    for (const s of seats) {
      const until = this.held.get(s);
      if (until && until > now) throw new Error('seat ' + s + ' already held');  // invariant
    }
    const until = new Date(now.getTime() + ttlMs);
    seats.forEach((s) => this.held.set(s, until));
    this.events.push({ type: 'SeatsHeld', showId: this.id, seats, until });
  }
  pullEvents(): SeatsHeld[] { return this.events.splice(0); }
}

export interface ShowRepository {                     // one repository per aggregate root
  byId(id: string): Promise<Show | null>;
  save(show: Show, expectedVersion: number): Promise<void>; // throws on version conflict
}
export const SHOW_REPO = Symbol('SHOW_REPO');

// ---- booking/infra: anti-corruption layer for the legacy seat-map API ----
type LegacySeat = { SEAT_CD: string; STS: 'A' | 'B' | 'H' | 'X' }; // their model, not ours
export function toSeatNo(raw: LegacySeat): SeatNo | null {
  if (raw.STS === 'X') return null;                   // 'X' = removed seat: drop, never leak it
  if (!/^[A-Z]\\d{1,2}$/.test(raw.SEAT_CD)) throw new Error('unmapped seat code ' + raw.SEAT_CD);
  return raw.SEAT_CD as SeatNo;
}

// ---- booking/application: the use case orchestrates, the root decides ----
@Injectable()
export class HoldSeatsHandler {
  constructor(@Inject(SHOW_REPO) private readonly shows: ShowRepository,
              private readonly bus: EventEmitter2) {}

  async execute(cmd: { showId: string; seats: SeatNo[] }): Promise<void> {
    const show = await this.shows.byId(cmd.showId);
    if (!show) throw new Error('unknown show');
    const expected = show.version;
    show.holdSeats(cmd.seats, new Date(), 8 * 60_000); // 8-minute hold
    await this.shows.save(show, expected);              // optimistic lock on the aggregate
    for (const e of show.pullEvents()) this.bus.emit(e.type, e); // in-process domain event
  }
}`,
        },
      ],
      keyPoints: [
        'Tactical DDD shapes classes inside a model; strategic DDD draws the boundaries between models.',
        'Repositories load and save whole aggregates, one per root, never per table or per child entity.',
        'Domain events stay inside the context; integration events are versioned contracts sent through an outbox.',
        'A bounded context is where a word has exactly one meaning; the same noun can be three different classes.',
        'The downstream team owns the ACL, and every foreign code is mapped or rejected there.',
      ],
      source: 'Eric Evans — Domain-Driven Design (2003), Parts II and IV; Vaughn Vernon — Implementing Domain-Driven Design (2013), Ch 2–3, 8, 10, 12',
    },
    {
      heading: '13. Clean, Hexagonal and Onion architecture: dependency rule, ports & adapters, use cases',
      body: `**Intuition:** all three architectures describe the same idea in different pictures. Business rules sit in the middle, I/O sits at the edge, and **source-code imports point inward only**. The database, the web framework and Kafka are plug-ins to your application, not its foundation.

| | Hexagonal (Ports & Adapters) | Onion | Clean |
|---|---|---|---|
| Author, year | Alistair Cockburn, 2005 | Jeffrey Palermo, 2008 | Robert C. Martin, 2012 |
| Core idea | app talks to the world only through **ports** (purpose-named interfaces); **adapters** translate a technology to a port | concentric rings: domain model → domain services → application services → infrastructure/UI | four circles: entities → use cases → interface adapters → frameworks & drivers |
| Emphasis | symmetry: a test harness, REST, a CLI and a queue can all **drive** the same port; DB, mail and payments are **driven** | the domain model has zero outward dependencies | the **Dependency Rule** plus simple data structures (DTOs) at each boundary |

**The dependency rule vs the flow of control.** At runtime the use case *calls* the Postgres adapter, so control flows outward. At compile time the adapter *imports* the port that the use case owns, so dependencies point inward. Dependency inversion (section 6) is what lets the two point in opposite directions.

**Vocabulary you should use correctly:**
- **Driving (primary) port:** what the outside world calls, usually the use case's input interface (\`ReserveSeat.execute(cmd)\`). Driving adapters: Nest controller, GraphQL resolver, Kafka consumer, CLI, test.
- **Driven (secondary) port:** what the application needs from the world (\`SeatInventory\`, \`Clock\`, \`Notifier\`). Driven adapters: Postgres, Redis, SES, an in-memory fake.
- **Use case (interactor):** one application operation per class. It takes a plain input DTO and returns a plain result. It has no HTTP types, no ORM entities and no framework decorators in the signature.
- **Data crossing boundaries:** pass DTOs or domain values, never an ORM row or an Express \`req\`.

**Folder layout (Nest service, one bounded context):**

| Folder | Contains | May import |
|---|---|---|
| \`domain/\` | entities, value objects, domain events, domain services | nothing outside \`domain/\` |
| \`application/\` | use cases, driven-port interfaces, DTOs | \`domain/\` |
| \`adapters/in/\` | controllers, resolvers, consumers (driving) | \`application/\` |
| \`adapters/out/\` | pg / Redis / HTTP implementations of ports (driven) | \`application/\`, \`domain/\`, libraries |
| \`main/\` (Nest module) | composition root: binds ports to adapters | everything |

**When it is overkill:** CRUD admin screens, internal tools, prototypes and thin "validate-and-save" services. There the layers turn into pass-through mappers (an entity, a DTO, a persistence model and a response model with four identical fields each). Signals that it pays off: non-trivial rules, **more than one delivery mechanism** (REST + GraphQL + Kafka + cron calling the same operation), infrastructure that changes (SQS today, Kafka next year), and a codebase that must live 5+ years. A pragmatic middle ground is to add ports **only where volatility or testing pain exists** (payments, messaging, time) and keep plain repositories elsewhere. Vertical slices (one folder per feature) fit well with this.

**Enforce it or it decays:** a dependency-cruiser or eslint-plugin-boundaries rule in CI that fails when \`domain/\` imports \`@nestjs/*\`, \`typeorm\` or \`adapters/\`.

**In a 90-minute machine-coding round:** show the folders, one or two ports (repository + external gateway), **in-memory adapters**, and a CLI or REST driver. That demonstrates the idea without five layers of mappers. Say out loud which adapter you would add for production.`,
      code: [
        {
          language: 'typescript',
          title: 'Driven port owned by the application, two adapters, two driving adapters',
          code: `// ---- application/ports.ts (inner: no framework, no driver imports) ----
export interface SeatInventory {
  tryReserve(showId: string, seat: string, holder: string, until: Date): Promise<boolean>;
}
export interface Clock { now(): Date; }

// ---- application/reserve-seat.ts (use case = driving port implementation) ----
export type ReserveSeatCmd = { showId: string; seat: string; userId: string };
export type ReserveSeatResult = { ok: true; until: Date } | { ok: false; reason: 'TAKEN' };

export class ReserveSeat {
  constructor(private readonly seats: SeatInventory, private readonly clock: Clock) {}
  async execute(cmd: ReserveSeatCmd): Promise<ReserveSeatResult> {
    const until = new Date(this.clock.now().getTime() + 8 * 60_000);
    const ok = await this.seats.tryReserve(cmd.showId, cmd.seat, cmd.userId, until);
    return ok ? { ok: true, until } : { ok: false, reason: 'TAKEN' };
  }
}

// ---- adapters/out/pg-seat-inventory.ts (outer: depends inward on the port) ----
import type { Pool } from 'pg';
export class PgSeatInventory implements SeatInventory {
  constructor(private readonly pool: Pool) {}
  async tryReserve(showId: string, seat: string, holder: string, until: Date) {
    const r = await this.pool.query(
      'UPDATE seats SET holder = $3, held_until = $4 WHERE show_id = $1 AND seat_no = $2 ' +
      'AND (holder IS NULL OR held_until < now())',   // atomic check-and-set: no double booking
      [showId, seat, holder, until]);
    return r.rowCount === 1;
  }
}

// ---- adapters/out/in-memory-seat-inventory.ts (tests and machine-coding demo) ----
export class InMemorySeatInventory implements SeatInventory {
  private readonly held = new Map<string, Date>();
  async tryReserve(showId: string, seat: string, _holder: string, until: Date) {
    const key = showId + ':' + seat;
    const cur = this.held.get(key);
    if (cur && cur > new Date()) return false;
    this.held.set(key, until);                          // single-threaded: no await in between
    return true;
  }
}

// ---- adapters/in: both drivers call the same use case ----
// @Post(':showId/seats/:seat/reserve') reserve(...) { return this.reserveSeat.execute({ ... }); }
// @EventPattern('seat.reserve.requested') onMsg(m) { return this.reserveSeat.execute(m); }
// main/booking.module.ts: { provide: ReserveSeat, inject: [SEATS, CLOCK],
//   useFactory: (s: SeatInventory, c: Clock) => new ReserveSeat(s, c) }`,
        },
        {
          language: 'javascript',
          title: '.dependency-cruiser.cjs — fail CI when the dependency rule is broken',
          code: `module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '^src/[^/]+/domain/' },
      to: { path: ['^src/[^/]+/(application|adapters|main)/', 'node_modules/(@nestjs|typeorm|pg|kafkajs)'] },
    },
    {
      name: 'application-ignores-adapters',
      severity: 'error',
      from: { path: '^src/[^/]+/application/' },
      to: { path: ['^src/[^/]+/(adapters|main)/', 'node_modules/(typeorm|pg|kafkajs|@aws-sdk)'] },
    },
    {
      name: 'no-cross-context-internals',   // contexts talk via published APIs/events only
      severity: 'error',
      from: { path: '^src/([^/]+)/' },
      to: { path: '^src/([^/]+)/(domain|application)/', pathNot: '^src/$1/' },
    },
  ],
};`,
        },
      ],
      keyPoints: [
        'Hexagonal, Onion and Clean are one idea: rules in the centre, I/O at the edge, imports point inward.',
        'The application owns the ports; adapters implement them, and controllers, consumers and tests all drive the same use case.',
        'Only plain DTOs or domain values cross a boundary, never ORM rows or HTTP request objects.',
        'It is overkill for CRUD; add ports where volatility, multiple drivers or testing pain exist.',
        'Enforce the dependency rule in CI (dependency-cruiser or eslint boundaries), or it decays.',
      ],
      source: 'Alistair Cockburn — Hexagonal Architecture (2005); Jeffrey Palermo — The Onion Architecture (2008); Robert C. Martin — The Clean Architecture (2012) and Clean Architecture (2017)',
    },
  ],
  codeChallenges: [
    {
      id: 'lld-oop-solid-cc-1',
      title: 'Break up the OrderManager god class',
      context:
        'A NestJS food-ordering backend has an `OrderManager` that grew over two years. Every sprint, three teams edit it (pricing, payments, notifications) and merge conflicts are weekly. Last month a payment-gateway outage left 1,200 orders with stock decremented but no payment. Unit tests don\'t exist because "it needs a DB, Razorpay and SMTP".',
      task:
        'Refactor into a SOLID design: separate responsibilities by actor, replace the customer-type switch with an extensible mechanism, invert dependencies on Postgres/Razorpay/SMTP, fix the stock-without-payment bug, and make the use case unit-testable with fakes.',
      starter: {
        language: 'typescript',
        title: 'order.manager.ts (starter)',
        code: `import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import Razorpay from 'razorpay';
import nodemailer from 'nodemailer';

@Injectable()
export class OrderManager {
  private db = new Pool({ connectionString: process.env.DB_URL });
  private rzp = new Razorpay({ key_id: process.env.RZP_KEY!, key_secret: process.env.RZP_SECRET! });
  private mail = nodemailer.createTransport({ host: 'smtp.internal' });

  async placeOrder(userId: string, items: { sku: string; qty: number; price: number }[], customerType: string) {
    let total = items.reduce((s, i) => s + i.price * i.qty, 0);
    if (customerType === 'GOLD') total = total * 0.9;
    else if (customerType === 'EMPLOYEE') total = total * 0.7;
    else if (customerType === 'CORPORATE') total = total - 50;

    for (const i of items) {
      await this.db.query('UPDATE stock SET qty = qty - $1 WHERE sku = $2', [i.qty, i.sku]);
    }
    const payment = await this.rzp.orders.create({ amount: Math.round(total * 100), currency: 'INR' });
    const { rows } = await this.db.query(
      'INSERT INTO orders(user_id, total, rzp_id, created_at) VALUES($1,$2,$3,$4) RETURNING id',
      [userId, total, payment.id, new Date(Date.now())],
    );
    await this.mail.sendMail({ to: userId + '@mail.com', subject: 'Order placed', text: 'Total ' + total });
    return rows[0].id;
  }
}`,
      },
      hints: [
        'List the actors who request changes to this class. Each one should own a separate class or port.',
        'What happens to the stock when `rzp.orders.create` throws? Reorder the steps and add compensation.',
        'For OCP, CUSTOMER discounts should be registered pricing policies. For DIP, the use case should own `PaymentGateway`, `Inventory`, `OrderRepository` and `Notifier` interfaces.',
      ],
      solution: {
        language: 'typescript',
        title: 'PlaceOrder use case with owned ports, policy registry and compensation',
        code: `// ---- ports owned by the ordering domain ----
export interface Item { sku: string; qty: number; unitPaise: bigint; }
export interface PricingPolicy { readonly tier: string; price(subtotal: bigint): bigint; }
export interface Inventory {
  reserve(orderRef: string, items: Item[]): Promise<boolean>; // atomic all-or-nothing hold with TTL
  commit(orderRef: string): Promise<void>;
  release(orderRef: string): Promise<void>;
}
export interface PaymentGateway { createOrder(ref: string, paise: bigint): Promise<string>; }
export interface OrderRepository {
  insert(o: { ref: string; userId: string; totalPaise: bigint; paymentRef: string; createdAt: Date }): Promise<void>;
}
export interface Notifier { orderPlaced(userId: string, ref: string, totalPaise: bigint): void; } // async, best-effort
export interface Clock { now(): Date; }

// ---- pricing: open for extension (a new tier = a new class + registration) ----
export class PercentOff implements PricingPolicy {
  constructor(readonly tier: string, private readonly pct: bigint) {}
  price(s: bigint) { return s - (s * this.pct) / 100n; }
}
export class FlatOff implements PricingPolicy {
  constructor(readonly tier: string, private readonly paise: bigint) {}
  price(s: bigint) { return s > this.paise ? s - this.paise : 0n; }
}
export class PricingRegistry {
  private readonly byTier: Map<string, PricingPolicy>;
  constructor(policies: PricingPolicy[]) { this.byTier = new Map(policies.map((p) => [p.tier, p])); }
  priceFor(tier: string, subtotal: bigint) { return this.byTier.get(tier)?.price(subtotal) ?? subtotal; }
}

export class OutOfStock extends Error {}

// ---- the use case: orchestration only ----
export class PlaceOrder {
  constructor(
    private readonly pricing: PricingRegistry,
    private readonly inventory: Inventory,
    private readonly payments: PaymentGateway,
    private readonly orders: OrderRepository,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
    private readonly newRef: () => string,
  ) {}

  async execute(userId: string, tier: string, items: Item[]): Promise<string> {
    if (!items.length || items.some((i) => i.qty <= 0)) throw new RangeError('invalid items');
    const subtotal = items.reduce((s, i) => s + i.unitPaise * BigInt(i.qty), 0n);
    const total = this.pricing.priceFor(tier, subtotal);
    const ref = this.newRef();

    if (!(await this.inventory.reserve(ref, items))) throw new OutOfStock(ref); // hold, don't decrement
    try {
      const paymentRef = await this.payments.createOrder(ref, total);
      await this.orders.insert({ ref, userId, totalPaise: total, paymentRef, createdAt: this.clock.now() });
      await this.inventory.commit(ref);
    } catch (e) {
      await this.inventory.release(ref); // compensation: gateway outage no longer strands stock
      throw e;
    }
    this.notifier.orderPlaced(userId, ref, total); // never fails the order
    return ref;
  }
}

// ---- NestJS wiring (composition root) ----
// providers: [
//   { provide: PricingRegistry, useFactory: () => new PricingRegistry([
//       new PercentOff('GOLD', 10n), new PercentOff('EMPLOYEE', 30n), new FlatOff('CORPORATE', 5000n)]) },
//   { provide: INVENTORY, useClass: PgInventory }, { provide: PAYMENTS, useClass: RazorpayGateway }, ...
// ]`,
      },
      explanation: `**Fixes:**

- **SRP by actor:** pricing (marketing), inventory (ops), payment (payments team), persistence and notification each sit behind their own class or port. \`PlaceOrder\` only orchestrates, so teams stop colliding in one file.
- **OCP:** the \`if/else\` on customer type becomes a \`PricingRegistry\` of policies. A PLATINUM tier is a registration line, and the use case doesn't change.
- **DIP:** the use case owns \`Inventory\`, \`PaymentGateway\`, \`OrderRepository\`, \`Notifier\` and \`Clock\`. Postgres, Razorpay and SMTP adapters implement them in infra. No \`new Pool()\` or \`process.env\` inside business logic.
- **Bug: stock without payment.** The starter decremented stock first and never restored it when the gateway threw. Now stock is *reserved* (a hold with a TTL as a backstop), committed only after payment and persistence succeed, and released on failure.
- **Money:** floats and \`Math.round(total * 100)\` are replaced by bigint paise. A flat discount can't push the total below zero.
- **Side effects:** email is fire-and-forget behind \`Notifier\`, so an SMTP outage can't fail an order.
- **Testability:** every collaborator is an interface, so a unit test builds \`PlaceOrder\` with in-memory fakes and asserts that a throwing gateway releases the reservation.`,
      followUps: [
        {
          q: 'The process crashes after `payments.createOrder` succeeds but before `orders.insert`. What state are we in, and how does the design recover?',
          a: 'The gateway has an order for `ref`, but we have no row, and the reservation is still held. The reservation TTL (e.g. 15 min) eventually returns stock. For money, use the deterministic `ref` as the gateway receipt/idempotency key: a reconciler lists gateway orders without a local row and either creates the row (if paid) or cancels them. A cleaner option is to insert the order as PENDING *before* calling the gateway (outbox-style), so every external call has a local record to reconcile against.',
        },
        {
          q: '`PlaceOrder` now takes 7 constructor parameters. Isn\'t that the god class again?',
          a: 'No. It *coordinates* seven collaborators but holds no business rules of its own, and each dependency is a narrow port. That is a normal application-service shape. If it grows further, the next step is to move side effects behind domain events (`OrderPlaced` → notifier and analytics listeners) and group the clock and id generator into a small `RuntimeContext`. Seven parameters with one reason to change is fine. Seven parameters with four actors editing the class is not.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-cc-2',
      title: 'From an anemic cart with primitive obsession to an aggregate with value objects',
      context:
        'A quick-commerce cart is a plain class with public fields, and all rules live in `CartService`. Bugs from the last quarter: totals off by ₹0.01 after removals, the same coupon applied twice by double-tapping, items added after checkout via a different endpoint, and a ₹2 lakh cart limit bypassed by a batch-update API that pushes into `cart.items` directly.',
      task:
        'Redesign the cart as an aggregate: invariants enforced by the root, money as a value object, a derived (not stored) total, single-coupon semantics that are safe against double-taps, no mutation after checkout, and optimistic versioning for concurrent requests.',
      starter: {
        language: 'typescript',
        title: 'cart.ts (starter)',
        code: `export class Cart {
  id!: string;
  userId!: string;
  items: { sku: string; qty: number; price: number }[] = [];
  total = 0;
  coupons: string[] = [];
  status = 'OPEN';
}

export class CartService {
  constructor(private repo: { get(id: string): Promise<Cart>; put(c: Cart): Promise<void> }) {}

  async addItem(cartId: string, sku: string, qty: number, price: number) {
    const cart = await this.repo.get(cartId);
    cart.items.push({ sku, qty, price });
    cart.total += price * qty;
    if (cart.total > 200000) console.log('cart over limit');
    await this.repo.put(cart);
  }

  async removeItem(cartId: string, sku: string) {
    const cart = await this.repo.get(cartId);
    const it = cart.items.find((i) => i.sku === sku)!;
    cart.items = cart.items.filter((i) => i.sku !== sku);
    cart.total -= it.price * it.qty * 0.9; // coupon adjustment?
    await this.repo.put(cart);
  }

  async applyCoupon(cartId: string, code: string) {
    const cart = await this.repo.get(cartId);
    cart.coupons.push(code);
    cart.total = cart.total * 0.9;
    await this.repo.put(cart);
  }
}`,
      },
      hints: [
        'If the total is stored and updated incrementally, every operation must remember every rule. What if it were derived from the lines and the coupon every time?',
        'Which fields should nobody outside the cart be able to write? How do you stop the batch API from pushing into `items`?',
        'Two concurrent `applyCoupon` calls each read version 7. How does the repository make the second one fail instead of overwriting the first?',
      ],
      solution: {
        language: 'typescript',
        title: 'cart.aggregate.ts — root-guarded invariants, Money VO, derived total, versioning',
        code: `import { Money } from './money'; // immutable VO from the Money section

export class CartRuleViolation extends Error {}

export class Coupon { // value object: percent off, with a cap
  private constructor(readonly code: string, readonly pct: number, readonly cap: Money) {}
  static of(code: string, pct: number, cap: Money) {
    if (!/^[A-Z0-9]{4,16}$/.test(code) || pct <= 0 || pct > 50) throw new CartRuleViolation('bad coupon');
    return new Coupon(code, pct, cap);
  }
  discountOn(subtotal: Money): Money {
    const raw = Money.of((subtotal.minor * BigInt(this.pct)) / 100n, subtotal.currency);
    return raw.minor > this.cap.minor ? this.cap : raw;
  }
}

export class Cart {
  static readonly LIMIT = Money.parse('200000.00');
  private readonly lines = new Map<string, { qty: number; unit: Money }>();
  private coupon: Coupon | null = null;
  private checkedOut = false;

  constructor(readonly id: string, readonly userId: string, public version = 0) {}

  setQuantity(sku: string, qty: number, unit: Money): void { // add, update and remove in one place
    this.assertOpen();
    if (!Number.isInteger(qty) || qty < 0 || qty > 20) throw new CartRuleViolation('qty');
    const prev = this.lines.get(sku);
    if (qty === 0) this.lines.delete(sku); else this.lines.set(sku, { qty, unit });
    if (this.subtotal().minor > Cart.LIMIT.minor) { // check after, roll back on violation
      if (prev) this.lines.set(sku, prev); else this.lines.delete(sku);
      throw new CartRuleViolation('cart limit exceeded');
    }
  }

  applyCoupon(c: Coupon): void {
    this.assertOpen();
    if (this.coupon?.code === c.code) return;              // idempotent: double-tap is a no-op
    if (this.coupon) throw new CartRuleViolation('one coupon per cart');
    this.coupon = c;
  }

  subtotal(): Money {
    let s = Money.of(0n, 'INR');
    for (const l of this.lines.values()) s = s.add(l.unit.times(l.qty));
    return s;
  }
  total(): Money { // derived, so it can never drift
    const sub = this.subtotal();
    return this.coupon ? sub.subtract(this.coupon.discountOn(sub)) : sub;
  }

  checkout(): Money {
    this.assertOpen();
    if (this.lines.size === 0) throw new CartRuleViolation('empty cart');
    this.checkedOut = true;
    return this.total();
  }

  lineView() { return [...this.lines].map(([sku, l]) => ({ sku, qty: l.qty, unit: l.unit })); } // copies
  private assertOpen() { if (this.checkedOut) throw new CartRuleViolation('cart is checked out'); }
}

export interface CartRepository {
  get(id: string): Promise<Cart | null>;
  /** UPDATE ... WHERE id = $1 AND version = $2; returns false if someone else saved first */
  save(cart: Cart, expectedVersion: number): Promise<boolean>;
}

export class CartCommands {
  constructor(private readonly repo: CartRepository) {}
  async mutate(id: string, op: (c: Cart) => void, retries = 2): Promise<Cart> {
    for (let i = 0; i <= retries; i++) {
      const cart = await this.repo.get(id);
      if (!cart) throw new CartRuleViolation('no cart');
      const v = cart.version;
      op(cart);                                 // all rules enforced inside the aggregate
      if (await this.repo.save(cart, v)) { cart.version = v + 1; return cart; }
    }
    throw new CartRuleViolation('concurrent modification, retry');
  }
}`,
      },
      explanation: `**Fixes:**

- **Encapsulation:** \`lines\`, \`coupon\` and \`checkedOut\` are private. The batch API has to call \`setQuantity\`, so it can't push past the ₹2 lakh limit. \`lineView()\` returns copies.
- **Derived total:** the stored, incrementally patched \`total\` caused the ₹0.01 drift and the mystery \`* 0.9\` on removal. \`total()\` is now computed from lines and coupon, so there is one source of truth.
- **Money VO:** integer paise, currency-checked, immutable. Float rounding is gone.
- **Coupon:** a validated value object with a cap. \`applyCoupon\` is idempotent for the same code and rejects a second coupon, so a double-tap can't discount twice.
- **Lifecycle invariant:** every mutator calls \`assertOpen()\`, so nothing changes after checkout.
- **Limit enforced as an invariant:** the starter only *logged* the violation. Now it throws and rolls back the line change.
- **Concurrency:** optimistic versioning (\`WHERE version = expected\`). Two concurrent requests can't both win on a stale read, and the loser retries against fresh state with the same rules applied.`,
      followUps: [
        {
          q: 'Prices change while items sit in the cart. Should `unit` be captured at add time or looked up at checkout?',
          a: 'It is a product decision, and the model should make it explicit. Capture `unit` at add time (what the user saw), then at checkout re-price through a `PriceQuote` port and compare. If any line changed beyond a tolerance, fail checkout with `PricesChanged(lines)` so the UI can confirm. The aggregate keeps the captured price for display, and checkout takes a fresh quote as a parameter. That keeps the aggregate pure (no I/O inside) and the rule testable.',
        },
        {
          q: 'During a flash sale, one corporate cart is edited by 30 employees at once and most saves fail with version conflicts. What do you change?',
          a: 'The aggregate is too coarse for this collaboration pattern. Options: (1) make each employee\'s sub-cart its own aggregate (versioned separately) and merge at checkout; (2) keep one cart but make line operations commutative, e.g. store per-line rows keyed by (cartId, sku) with per-row versions, and enforce the cart limit at checkout instead of on every add; (3) retry automatically with jittered backoff, since the domain op is re-applied to fresh state. Option 1 or 2 fixes the contention itself. Retries only hide it.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'lld-oop-solid-iq-01',
      difficulty: 'hard',
      question:
        'Your codebase has `class User`, `class PremiumUser extends User`, and `class CorporatePremiumUser extends PremiumUser`. Product now wants corporate users who are NOT premium, and users who upgrade mid-session. How do you remodel this, and what does the migration look like?',
      whatInterviewerLooksFor: [
        'Recognises two independent axes (plan, account type) crammed into one hierarchy',
        'Proposes composition: user has a plan/entitlements and an organisation membership',
        'Handles runtime change (upgrade) — impossible with class identity',
        'Plans an incremental migration rather than a big-bang rewrite',
      ],
      modelAnswer: `**Diagnosis:** the hierarchy encodes two orthogonal axes, *plan* (free/premium) and *affiliation* (individual/corporate), as one inheritance chain. Combinations explode (2 × 2 = 4 classes today, 3 × 3 = 9 tomorrow), and an object's class is fixed at construction, so upgrading means rebuilding the object and every reference to it.

**Remodel with composition:**

- \`User\` (entity) **has** a \`Plan\` (\`FreePlan\`, \`PremiumPlan\`, with \`entitlements(): Entitlements\`) and an optional \`OrgMembership\` (\`orgId\`, \`role\`, \`billingOwner\`).
- Behaviour that differed by subclass (limits, discounts, support SLA) moves into **policies** consulted through the plan or the org: \`user.plan.maxProjects()\`, \`billingResolver.payerFor(user)\`.
- Upgrade becomes \`user.changePlan(new PremiumPlan(...), clock.now())\`. The same object and ID, with an event \`PlanChanged\` for billing.
- Combination rules (corporate org overrides the individual plan) live in one \`EntitlementResolver\`, not spread across overrides.

**Code checks:** \`instanceof PremiumUser\` calls are the migration's hit list. Replace each with an entitlement query (\`can(user, 'priority-support')\`), which is also what product actually wants to ask.

**Migration (incremental, no big bang):**

1. Add \`plan\` and \`org\` fields to \`User\` and populate them from the existing subclass (a factory maps \`PremiumUser\` → \`User + PremiumPlan\`).
2. Introduce \`EntitlementResolver\` and convert \`instanceof\` checks one by one behind tests.
3. When no code depends on the subclasses, collapse them into \`User\` and delete. Persistence probably already stored a \`type\` column, which becomes \`plan_id\` + \`org_id\`.

**When I'd keep inheritance:** if the subclasses differed in *identity* and were substitutable, which they aren't here. "Premium" is a role a user plays for a while, not something they are.`,
      followUps: [
        {
          q: 'Entitlements must be checked on every API call (~20K RPS). Where do you compute them so the composition doesn\'t cost a DB round-trip each time?',
          a: 'Resolve entitlements once per plan or org change and cache the result as an immutable `Entitlements` value object, either in the auth token claims (short TTL, e.g. 15 min) or in a per-user cache invalidated by `PlanChanged`/`OrgChanged` events. The resolver runs on change, not on read. For hard limits like seat counts, still enforce at write time against the source of truth, because a stale token could otherwise allow an over-limit action.',
        },
        {
          q: 'Couldn\'t you solve it with mixins (`class CorporatePremium extends Corporate(Premium(User))`)?',
          a: 'Mixins avoid duplicating code but keep the core problem: the combination is still a *class* fixed at construction, upgrade still means a new object, and method-resolution order across mixins becomes an implicit dependency (which `discount()` wins?). They make sense for orthogonal technical capabilities (e.g. `Timestamped`, `SoftDeletable`), not for business roles that change over time.',
        },
        {
          q: 'How do you stop someone re-introducing `if (user.plan instanceof PremiumPlan)` checks in six months?',
          a: 'Give callers a better question to ask: `entitlements.has(\'export-csv\')` or `plan.limits().maxProjects`, so the plan type never needs inspecting. Add a lint rule (e.g. `no-restricted-syntax` on `instanceof PremiumPlan` outside the billing module) and an architecture test that only `EntitlementResolver` imports concrete plan classes.',
        },
      ],
      pitfalls: [
        'Adding a fourth subclass `CorporateFreeUser`',
        'Keeping a `type` string and switching on it everywhere — inheritance replaced by conditionals',
        'Ignoring runtime plan changes',
      ],
    },
    {
      id: 'lld-oop-solid-iq-02',
      difficulty: 'medium',
      question:
        'In a NestJS service you wrote `constructor(private readonly gateway: PaymentGateway)` where `PaymentGateway` is an `interface`, and the app fails at boot. Explain why, give two fixes, and tell me when you would pick an abstract class over an interface — and how a Java/Spring engineer on the panel would see the same design.',
      whatInterviewerLooksFor: [
        'Knows TS interfaces are erased; Nest resolves by runtime metadata (design:paramtypes)',
        'Gives token-based and abstract-class-based fixes with trade-offs',
        'Criteria for abstract class: shared state/behaviour, template method',
        'Contrasts with Java nominal interfaces and Spring injection by type',
      ],
      modelAnswer: `**Why it fails:** Nest reads constructor parameter types from \`design:paramtypes\` metadata emitted by TypeScript. Interfaces don't exist in JavaScript, so the emitted type is \`Object\`. Nest can't find a provider for it and reports "Nest can't resolve dependencies of CheckoutService (?)".

**Fix 1 — token + interface:**

- \`export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY')\`
- provider \`{ provide: PAYMENT_GATEWAY, useClass: RazorpayGateway }\`
- \`constructor(@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway)\`

Pros: the interface stays purely structural (fakes are object literals) and there is no runtime coupling. Cons: you have to keep the token and the type in sync by hand.

**Fix 2 — abstract class as token:** \`export abstract class PaymentGateway { abstract charge(...): Promise<...> }\`, then \`{ provide: PaymentGateway, useClass: RazorpayGateway }\`. No \`@Inject\` needed, because the class exists at runtime and serves as both type and token. Cons: implementations may \`extends\` it, which invites shared state, and it's slightly heavier than an interface.

**When I'd choose an abstract class anyway:** there is real shared behaviour or state, e.g. a template method (\`charge()\` = validate → \`doCharge()\` → record metrics) where subclasses fill one hook, or common helpers like idempotency headers and signature verification. Without shared code, an interface plus a token keeps coupling minimal.

**The Java/Spring view:** Java interfaces are nominal and exist at runtime, so Spring injects \`PaymentGateway\` by type with no token. Ambiguity between two implementations is resolved with \`@Qualifier\` or \`@Primary\`, which plays the same role as Nest's tokens. Since Java 8, interfaces can have \`default\` methods, so a Java dev reaches for an abstract class mainly when there's **state** or constructor logic. And a Java dev would ask whether the gateway is thread-safe. In Node the singleton is shared across concurrent requests too, so the same rule applies: no per-request state in fields.`,
      followUps: [
        {
          q: 'You need Razorpay for INR and Stripe for USD, chosen per request. How do you wire it in Nest?',
          a: 'Inject a resolver, not a single gateway. Register both adapters under their own tokens, then `{ provide: GATEWAY_RESOLVER, useFactory: (rzp, stripe) => new GatewayResolver({ INR: rzp, USD: stripe }), inject: [RAZORPAY, STRIPE] }`. The service calls `resolver.for(currency).charge(...)`. Avoid request-scoped providers for this: they cascade request scope through the dependency graph and allocate per request, while the resolver keeps everything singleton.',
        },
        {
          q: 'Structural typing means any object with `charge()` satisfies the interface. Is that ever a problem?',
          a: 'Yes, through accidental compatibility. A `RefundGateway` with the same method shapes could be passed where a `PaymentGateway` is expected, and the compiler won\'t object. For identifiers it\'s worse: `UserId` and `OrderId` aliased to `string` are interchangeable. Mitigations are branded types (`string & { __brand: \'UserId\' }`), value-object classes with a private field (which makes them nominal), and distinct method names for distinct capabilities.',
        },
      ],
      pitfalls: [
        'Suggesting `emitDecoratorMetadata` will fix it — it is already on; interfaces simply have no runtime value',
        'Switching to a concrete class injection, giving up DIP',
        'Claiming abstract classes are always better because they "work with DI"',
      ],
    },
    {
      id: 'lld-oop-solid-iq-03',
      difficulty: 'hard',
      question:
        'You are reviewing a 1,400-line `PaymentsService` with 38 public methods: payment creation, refunds, webhook handling, settlement reports, GST invoice generation, retry scheduling and merchant notifications. How would you split it, which principle drives each cut, and how do you avoid ending up with 40 one-method classes?',
      context: 'Razorpay-style payments backend; four teams touch this file.',
      whatInterviewerLooksFor: [
        'Uses SRP as "reason to change / actor", not "one method per class"',
        'Groups by cohesion (shared data and change cadence) and finds seams in the code',
        'Incremental strangler-style extraction with tests, not a rewrite',
        'Explicit guard against over-fragmentation',
      ],
      modelAnswer: `**Find the actors first, then cut.** I'd list who requests changes, using git log on the file plus the method list:

| Actor | Methods | New home |
|---|---|---|
| Checkout/payments team | create, capture, cancel, status | \`PaymentLifecycle\` (around the \`Payment\` aggregate + state machine) |
| Refunds/disputes ops | refund, partial refund, dispute hooks | \`RefundService\` |
| Integrations | webhook parsing, signature verification, dedupe | \`WebhookIngestor\` (adapter layer, not domain) |
| Finance | settlement reports, GST invoices | \`SettlementReporting\`, \`InvoiceGenerator\` (read side, own module) |
| Platform | retry scheduling | \`RetryScheduler\` (infra, behind a port) |
| CRM | merchant notifications | listener on domain events |

**Principles behind each cut:**

- **SRP:** each group has one actor, which ends the merge conflicts.
- **DIP:** webhooks and retries are infrastructure. The domain owns ports (\`PaymentEvents\`, \`Scheduler\`) and infra implements them.
- **ISP:** reporting gets a read-only \`PaymentReader\`, so it can't call \`capture\`.
- **OCP:** notifications move to \`PaymentCaptured\`/\`RefundIssued\` events, so new side effects become new listeners.

**Avoiding 40 tiny classes:** cohesion is the counterweight. Methods that share data and change together stay together. \`create/capture/cancel\` all mutate the payment state machine, so they belong to one class (or one aggregate plus a thin application service), not three. My heuristics: a class should have a noun name that isn't "Manager", 2–5 constructor dependencies, and methods that use most of its fields. If a split produces a class whose only caller is one other new class with no independent reason to change, merge it back.

**Doing it safely:**

1. Characterisation tests on the public methods (record current behaviour, especially webhook dedupe and refund edge cases).
2. Extract one group at a time behind the *existing* \`PaymentsService\` façade, which delegates and keeps callers working.
3. Move callers to the new services, then delete the façade methods.
4. Enforce module boundaries (Nest modules exporting only their service, plus an eslint boundary rule).`,
      followUps: [
        {
          q: 'Refund logic reads payment state and must not refund more than captured. Which class owns that invariant after the split?',
          a: 'The `Payment` aggregate. Its `refund(amount)` checks `refunded + amount <= captured` and records a `Refund` entity inside the boundary, with optimistic versioning for concurrent partial refunds. `RefundService` orchestrates: load the payment, call `payment.refund()`, call the gateway, save, publish `RefundIssued`. If the invariant sat in `RefundService`, any other path that creates refunds (dispute auto-refund) could bypass it.',
        },
        {
          q: 'Product says: "just add the new BNPL settlement report to PaymentsService, it\'s one method". What do you say?',
          a: 'It belongs with finance reporting. Adding it back reintroduces a second actor into the payment lifecycle class, plus its dependencies (warehouse queries, CSV export), which then get injected into every payment flow. In the new structure it\'s a new class in `SettlementReporting` with a read-only port, so it\'s just as quick to add and doesn\'t touch the lifecycle tests. "One method" is never the measure. Who will change it, and why, is.',
        },
      ],
      pitfalls: [
        'Splitting by CRUD verb (CreateService, UpdateService) instead of by actor',
        'Big-bang rewrite without characterisation tests',
        'One class per method, scattering one invariant across classes',
      ],
    },
    {
      id: 'lld-oop-solid-iq-04',
      difficulty: 'medium',
      question:
        'In your library-management class diagram you drew `Library <>-- Book` (composition) and `Book <>-- BookCopy`. The interviewer asks: "If a branch closes, do its books disappear? What does each relationship force in code and in the database?" Defend or revise your diagram.',
      whatInterviewerLooksFor: [
        'Lifecycle ownership as the deciding factor between composition and aggregation',
        'Distinguishes catalogue entity (Book/title) from physical item (BookCopy)',
        'Maps relationships to code (who constructs/deletes) and DB (FK, cascade, nullable)',
        'Willingness to revise the diagram',
      ],
      modelAnswer: `**Revise.** \`Library <>-- Book\` is wrong. A \`Book\` (title, ISBN, author) is catalogue data that exists independently of any branch, and many branches stock the same title. Closing a branch must not delete the title.

**Corrected model:**

- \`Book\` (catalogue entity, ISBN identity) is shared and independent.
- \`BookCopy\` (physical item, barcode identity) **association** to \`Book\` (many copies → 1 book).
- \`Branch o-- BookCopy\` (**aggregation**). A branch holds copies, but copies outlive the branch: on closure they are transferred, sold or written off, each a recorded event.
- \`Loan\` associates \`Member\` and \`BookCopy\` with its own lifecycle.
- \`Loan <>-- Fine\` (**composition**) might be justified. A fine is meaningless without its loan and is created by \`loan.markOverdue()\`.

**What each choice forces in code:**

| Relationship | Construction | Deletion | Exposure |
|---|---|---|---|
| Composition | whole creates parts (\`loan.addFine()\`) | parts removed with the whole | parts not handed out mutable |
| Aggregation | parts created elsewhere, passed in (\`branch.receive(copy)\`) | removing the whole requires re-homing parts | parts may be referenced by others |
| Association | reference/ID field | independent | by ID |

**In the database:** composition maps to an FK with \`ON DELETE CASCADE\` (fines with loans) or rows inside the aggregate's table/JSON. Aggregation maps to a *nullable* FK \`branch_id\` (or a transfer history table) with \`ON DELETE RESTRICT\`, so a branch can't be deleted while it holds copies. That's the DB enforcing the lifecycle decision.

**Why it matters in interviews:** composition vs aggregation is how you show you thought about **lifecycle and ownership**, which drives cascade rules, aggregate boundaries and transaction scope. It's more than notation.`,
      followUps: [
        {
          q: 'A copy is in transit between branches for two days. Which object holds it, and how does that show in the model?',
          a: 'Neither branch. Model a `Transfer` entity (from, to, copyId, dispatchedAt, receivedAt) and give `BookCopy` a location state: `AT_BRANCH(branchId)` | `IN_TRANSIT(transferId)` | `ON_LOAN(loanId)`. That makes the copy\'s location a single source of truth with a guarded state machine, rather than two branches each believing they own it. It also confirms aggregation is right: the copy\'s life isn\'t bound to any branch.',
        },
        {
          q: 'Is `Member --> Loan` association or composition — what happens to loans when a member deletes their account?',
          a: 'Association. Loans are financial and audit records that must outlive the member\'s account (fines, lost books). Account deletion anonymises the member (GDPR/DPDP-style), keeping a tombstone ID, and loans keep referencing that ID. Modelling it as composition with cascade delete would destroy evidence of unreturned copies and unpaid fines.',
        },
      ],
      pitfalls: [
        'Calling composition "strong aggregation" without lifecycle reasoning',
        'Conflating the catalogue title with physical copies',
        'Using cascade deletes for records that must be retained',
      ],
    },
    {
      id: 'lld-oop-solid-iq-05',
      difficulty: 'hard',
      question:
        'Your split-bill feature stores amounts as `number` rupees. Users report that splitting ₹100 three ways shows ₹33.33 × 3 and the group balance never settles to zero; GST on a ₹999 item comes out as ₹179.82000000000002 in one API. Redesign the money model and the split algorithm.',
      whatInterviewerLooksFor: [
        'Integer minor units and an immutable Money value object with currency',
        'Allocation algorithm that conserves the total (remainder distribution)',
        'Explicit rounding policy for tax (per line vs per invoice) with stated mode',
        'Migration and API representation concerns',
      ],
      modelAnswer: `**Root causes:** binary floating point can't represent 0.1 exactly, so float arithmetic drifts. Splitting by division loses the remainder: 3 × 33.33 = 99.99, which leaves ₹0.01 that belongs to nobody.

**Money value object:**

- \`Money { minor: bigint; currency: 'INR' }\`, immutable, created via \`Money.parse('100.00')\` or \`Money.of(10000n)\`.
- Operations return new instances. Adding different currencies throws. No \`toNumber()\` in domain code.
- Equality is by value (\`equals\`), never \`===\` on objects.

**Splitting that conserves the total (allocation):**

- \`allocate(n)\`: base = minor / n, remainder r = minor % n, and the first r parts get +1 paisa. ₹100 / 3 gives 3334, 3333, 3333, which sums to exactly 10000.
- Weighted split (by ratio or by item) uses the largest-remainder method: compute floors, then hand leftover paise to the parts with the largest fractional remainders, with a deterministic tie-break (e.g. by userId) so recomputation is stable.
- Invariant asserted in the method: the sum of the parts equals the original. This is also a property test.

**Tax rounding policy (explicit, configurable):**

- 18% of 99900 paise = 17982 paise exactly here. When it isn't exact, decide **per-line vs per-invoice** rounding and the mode (half-up is common for GST invoices). Encode it in a \`TaxPolicy\` strategy, since rounding is a business rule.
- Store computed tax as Money and never recompute old invoices with new rules.

**Persistence/API:**

- DB: \`BIGINT amount_minor\` + \`CHAR(3) currency\` (or \`NUMERIC(14,2)\`, never \`FLOAT\`).
- API: send minor units as integers, or decimal strings (\`"100.00"\`), never JS floats.
- Migration: dual-write the new columns, backfill with \`ROUND(amount * 100)\`, reconcile per group (balances must sum to zero), then switch reads.

**Ledger angle:** the group balance settles because every expense is recorded as entries whose allocated parts sum exactly to the paid amount. Zero-sum is then an invariant you can assert, not something you hope for.`,
      followUps: [
        {
          q: 'Who gets the extra paisa — always the first participant? Isn\'t that unfair over hundreds of expenses?',
          a: 'Over many expenses a fixed order biases the same person. Make the tie-break deterministic but rotating, e.g. order participants by `hash(expenseId + userId)`, so the extra paisa spreads evenly and stays reproducible on recomputation. Or give it to the payer, which is defensible because they fronted the money. The key properties are that the total is conserved, the result is reproducible, and the policy is documented. Randomness without a seed breaks reproducibility.',
        },
        {
          q: 'A group mixes INR and USD expenses. Where does conversion happen in your model?',
          a: 'Never implicitly in `Money.add`, which throws on a mismatch. Conversion is an explicit domain operation, `FxConverter.convert(money, to, rateSnapshot)`, and the `rateSnapshot` (rate, source, timestamp) is stored on the expense so balances are reproducible later. Group balances are kept per currency, and settlement either happens per currency or converts at settle time with the rate recorded on the settlement.',
        },
      ],
      pitfalls: [
        'Using `toFixed(2)` as the fix — display formatting, not arithmetic',
        'Storing amounts as FLOAT/DOUBLE in the database',
        'Splitting by division and ignoring the remainder',
      ],
    },
    {
      id: 'lld-oop-solid-iq-06',
      difficulty: 'expert',
      question:
        'For a movie-ticketing LLD, should `Show` be an aggregate that contains all 300 `Seat`s, or should each seat (or seat hold) be its own aggregate? A blockbuster opens and ~2,000 users try to book the same show within the first minute. Walk through the trade-off and your choice.',
      whatInterviewerLooksFor: [
        'Aggregate = consistency boundary; identifies which invariants span seats and which don\'t',
        'Quantifies contention for a large aggregate under optimistic locking',
        'Chooses smaller aggregates and handles multi-seat atomicity explicitly',
        'Mentions how cross-seat rules (no single-seat gaps, max 10 per user) are enforced',
      ],
      modelAnswer: `**Which invariants exist?**

1. A seat is held/booked by at most one user. Per seat.
2. A booking's seats are all-or-nothing (4 seats together or none). Spans the seats in one booking.
3. Max 10 seats per user per show. Per user and show.
4. Optional: "no single empty seat between bookings". Spans a row.

**Option A — \`Show\` aggregate with 300 seats.** Every hold rewrites one versioned aggregate. With 2,000 attempts in ~60 s (~33/s) and each read-modify-write taking ~10–20 ms, concurrent attempts collide constantly. Under optimistic locking most saves fail on version conflicts and retry storms follow, even when users want *different* seats. With pessimistic locking all bookings serialise on one row, which caps throughput at ~50–100/s with growing tail latency. All the conflict is false contention.

**Option B — seat-level holds (my choice).** Each \`SeatHold\` (showId, seatId) is the unit of consistency, enforced by a unique key or a conditional update:

- Multi-seat atomicity: in **one DB transaction**, \`UPDATE show_seats SET hold_id=$1, held_until=now()+'10 min' WHERE show_id=$2 AND seat_id = ANY($3) AND (hold_id IS NULL OR held_until < now())\`. If the row count is not equal to the requested count, roll back. The transaction touches only the requested rows, so different users rarely conflict.
- Max 10 per user: a small per-(user, show) counter row updated in the same transaction. Contention is per user, which is fine.
- The row-gap rule needs a row-level view. Either validate in the same transaction by locking the row's seats (\`SELECT ... FOR UPDATE\` on that row only, so contention is per row, not per show) or relax it to a UI recommendation.

**Model shape in code:** \`Show\` remains an aggregate for show-level data (timing, pricing tiers, status like CANCELLED) and is rarely written. \`SeatInventory\` is a repository with \`holdAll(showId, seatIds, holdId, ttl)\`. A \`Booking\` aggregate references the hold by ID and moves HELD → CONFIRMED → CANCELLED.

**Rule I'd state:** design aggregates around *true* invariants and keep them small. A large aggregate turns unrelated user actions into contention, which is Vernon's "Effective Aggregate Design" point exactly.`,
      followUps: [
        {
          q: 'A show is cancelled by the cinema while 120 holds and 400 bookings exist. With seat-level aggregates, how do you keep this consistent?',
          a: 'Set `Show.status = CANCELLED` first (a single versioned write). From then on `holdAll` checks show status in its transaction (join or check constraint) and rejects new holds. A `ShowCancelled` event drives an idempotent process that cancels bookings and triggers refunds per booking (each its own transaction), while holds simply expire. It\'s eventually consistent across aggregates, with the status flag as the gate that prevents new work.',
        },
        {
          q: 'Would you do the same in a pure in-memory machine-coding version?',
          a: 'Mostly. Keep a `Map<seatKey, Hold>` per show and make `holdAll` synchronous: check every seat, then write every seat, with no await in between, so a multi-seat hold is atomic in one Node process. In Java, use a per-show `ReentrantLock` held only for the check-and-write, or striped locks per row. Say explicitly that the DB version swaps this for the conditional multi-row update.',
        },
      ],
      pitfalls: [
        'Making Show the aggregate "because seats belong to a show" without discussing contention',
        'Per-seat aggregates with no plan for multi-seat atomicity',
        'Distributed locks per seat held across user think-time instead of TTL holds',
      ],
    },
    {
      id: 'lld-oop-solid-iq-07',
      difficulty: 'hard',
      question:
        'Two years ago someone DRY-ed up `validateAddress()` into a shared util used by checkout (shipping) and by billing (GST invoices). Now logistics wants landmark and geo-pin mandatory, while finance wants GSTIN-state matching and no landmark. The function has 6 boolean flags. What went wrong and what do you do?',
      whatInterviewerLooksFor: [
        'DRY is about knowledge, not similar code — two actors, two pieces of knowledge',
        'Recognises flag parameters as control coupling and the "wrong abstraction" trap',
        'Plan: inline back, then extract what is truly shared (format primitives)',
        'Uses value objects per context (ShippingAddress vs BillingAddress)',
      ],
      modelAnswer: `**What went wrong:** the two functions looked the same but encoded *different knowledge* for *different actors*: deliverability for logistics, tax jurisdiction for finance. Merging them coupled two reasons to change. Each new requirement added a flag (\`requireLandmark\`, \`checkGstin\`, \`allowPoBox\`...), which is **control coupling**. Callers now pass flag combinations nobody can reason about, and every change risks breaking the other team. Sandi Metz's line applies: duplication is far cheaper than the wrong abstraction.

**Fix — go backwards before going forwards:**

1. **Inline** the shared function back into both call sites, keeping only the branches each one actually uses. Characterisation tests per caller first.
2. **Model each context explicitly** with value objects:
   - \`ShippingAddress\` (line1, landmark, pincode, geoPin, contact phone). Its factory validates deliverability rules and may consult a \`ServiceabilityChecker\` port.
   - \`BillingAddress\` (legal name, line1, state code, pincode, GSTIN?). Its factory validates that the GSTIN state code matches the address state.
3. **Extract only true shared knowledge** as small primitives: \`Pincode\` (6 digits, valid range), \`IndianStateCode\`, \`PhoneNumber\`. These are stable facts that change for the same reason, which is genuine DRY.
4. Conversion between them is explicit (\`BillingAddress.fromShipping(addr, gstin)\` when the user ticks "same as shipping"), so the coupling is visible and one-directional.

**Result:** logistics changes \`ShippingAddress\` and finance changes \`BillingAddress\`, independently. Shared primitives change rarely and for both together.

**Rule of thumb I'd state:** deduplicate when the code represents the same rule that would change for the same reason. Wait for the third occurrence, and even then check the actor.`,
      followUps: [
        {
          q: 'A junior argues: "now Pincode validation is in one place but the 6-character landmark rule is copy-pasted in two services". Is that acceptable?',
          a: 'Check whether it\'s the same knowledge. If both services enforce the *logistics* landmark rule (e.g. checkout and order-edit), it belongs in `ShippingAddress` and both should use the value object rather than duplicate it, because that duplication is real. If one copy is a coincidentally similar *UI* rule, leave it. The test: if logistics changes the rule tomorrow, must both places change? If yes, unify.',
        },
        {
          q: 'How do you refactor a function with 6 boolean flags safely when 40 call sites use different combinations?',
          a: 'Inventory the combinations actually used (grep or AST search). Usually there are 3–4 distinct ones. Create a named function or value-object factory per real combination, with tests that pin current behaviour for each, then migrate call sites mechanically (codemod) and delete the flags. Unused combinations disappear, and the names document intent that the flags hid.',
        },
      ],
      pitfalls: [
        'Adding a seventh flag or an options object with the same branches',
        'Concluding "DRY is bad" rather than "DRY applies to knowledge"',
        'Forcing a common base class `Address` with overrides per context',
      ],
    },
    {
      id: 'lld-oop-solid-iq-08',
      difficulty: 'medium',
      question:
        'Here is an `OtpService` that calls `Date.now()`, `Math.floor(Math.random() * 1e6)` and `new Msg91Client()` internally, and stores OTPs in a module-level Map. Rules: 5-minute validity, max 3 verify attempts, 30-second resend cooldown. The interviewer asks you to unit-test all three rules — what do you change first?',
      whatInterviewerLooksFor: [
        'Identifies hidden dependencies: time, randomness, I/O, global state',
        'Constructor injection with small interfaces; fakes for tests',
        'Notes security aspects that design changes reveal (CSPRNG, hashed OTP, constant-time compare)',
        'Concrete test cases for each rule without sleeping',
      ],
      modelAnswer: `**Hidden dependencies to pull out:**

| Hidden | Problem in tests | Seam |
|---|---|---|
| \`Date.now()\` | can't test 5-min expiry or 30-s cooldown without sleeping | \`Clock\` |
| \`Math.random()\` | can't know the OTP in a test; also not cryptographically secure | \`OtpGenerator\` (impl uses \`crypto.randomInt(0, 1_000_000)\`) |
| \`new Msg91Client()\` | sends real SMS, needs network/keys | \`SmsSender\` port |
| module-level Map | state leaks between tests; breaks with >1 pod | \`OtpStore\` port (in-memory fake, Redis in prod) |

**Shape after refactor:** \`new OtpService(store, generator, sms, clock, config)\`, where the config holds TTL, max attempts and cooldown so the rules are explicit.

**Tests (no sleeping, no network):**

1. **Expiry:** fake clock at T, \`send('9198...')\`, the generator returns \`'123456'\`. Advance 4:59, verify passes. Fresh send, advance 5:00, verify fails with \`Expired\`.
2. **Attempts:** three wrong codes give \`Invalid\` ×3. The fourth attempt, *even with the right code*, gives \`Locked\`. Assert the store marked the OTP consumed or locked.
3. **Cooldown:** send at T and again at T+29s gives \`TooSoon(retryAfter=1s)\`. Send at T+30s works, \`FakeSms\` recorded two messages, and the second OTP replaced the first (verifying the old code now fails).
4. **Single use:** verify succeeds once, then the same code fails.

**What the refactor reveals (bonus signals):**

- Store a **hash** of the OTP (HMAC with a server key), not the plaintext, and compare in constant time (\`crypto.timingSafeEqual\`).
- The attempt counter must be decremented **atomically** in the store (Redis \`HINCRBY\`/Lua), otherwise parallel verify calls bypass the 3-attempt limit. The \`OtpStore\` port's contract should say "atomic".
- Rate-limit sends per phone number and per IP as well, since cooldown alone doesn't stop SMS pumping fraud.`,
      followUps: [
        {
          q: 'Wouldn\'t `jest.useFakeTimers()` and `jest.spyOn(Math, \'random\')` let you test without refactoring?',
          a: 'They can, but they patch globals: tests become coupled to *how* the code reads time and randomness (switch to `crypto.randomInt` and the spy silently stops working), and fake timers interfere with real async I/O in the same test. Injection makes the dependency part of the class\'s contract and works in any test runner. For legacy code I\'d use the spies as a first step to get characterisation tests, then refactor.',
        },
        {
          q: 'With Redis as the OtpStore in production, how do you guarantee "max 3 attempts" under parallel verify requests?',
          a: 'Do check-and-decrement in one atomic step: a Lua script that loads `{hash, attemptsLeft, expiresAt}`, returns LOCKED if attemptsLeft <= 0, decrements, then compares the hash and deletes the key on success. Alternatively `HINCRBY attempts 1` first and reject if the result is > 3 before comparing. That way 10 parallel guesses consume 10 attempts instead of all reading "3 left". The in-memory fake implements the same semantics synchronously.',
        },
      ],
      pitfalls: [
        'Testing by sleeping 5 minutes or shortening TTL via env vars',
        'Keeping Math.random for OTPs',
        'Mocking every method call order instead of asserting outcomes',
      ],
    },
    {
      id: 'lld-oop-solid-iq-09',
      difficulty: 'expert',
      question:
        'The interviewer says: "Prove your checkout design is open/closed. Product wants to add BNPL as a payment method — list every file you touch." You find you must edit 6 files including a switch in the refund flow. Is OCP violated, what is an acceptable number of edits, and how do you restructure?',
      whatInterviewerLooksFor: [
        'OCP is about protecting against anticipated variation — some edits (wiring/config) are expected',
        'Distinguishes additive changes from modifications to tested logic',
        'Restructures with a capability-based strategy + registry, and per-capability interfaces (ISP/LSP)',
        'Considers persistence/enums/exhaustiveness and the composition root',
      ],
      modelAnswer: `**What "closed" realistically means:** zero edits is a myth. Something must learn BNPL exists. The goal is that **no tested business logic** changes. Acceptable edits are: a new adapter class, a registration in the composition root (Nest module), config (keys, limits), and possibly a migration if the method is persisted as an enum. Unacceptable: switches in the payment, refund and reconciliation flows.

**Typical 6-file audit:**

1. \`PaymentMethodType\` enum. Acceptable (data), but consider a string ID validated by the registry.
2. \`CheckoutService\` switch to create the payment. **Violation.**
3. \`RefundService\` switch. **Violation.** BNPL refunds work differently (cancel the loan vs refund).
4. \`ReconciliationJob\` mapping gateway statuses. **Violation.**
5. \`PaymentModule\` provider registration. Acceptable.
6. Frontend config. Out of scope.

**Restructure:**

- \`PaymentMethodProvider\` registry keyed by method ID. Each provider implements \`Payable\` and optionally other capabilities: \`Refundable\`, \`Reconcilable\`, \`SupportsEmi\`. Capabilities are separate interfaces (ISP), so BNPL implements \`Payable + Reconcilable\` and handles refunds via \`Cancellable\` (loan cancellation), with no fake \`refund()\` that throws (LSP).
- \`CheckoutService\` calls \`registry.get(method).pay(...)\`. \`RefundService\` asks \`registry.capability(method, 'refund')\`, which returns a \`Refundable\` or routes to an explicit alternative flow (\`Cancellable\` or manual payout).
- Gateway status mapping lives *inside* each provider (\`toDomainStatus()\`), so reconciliation is generic.
- BNPL-specific rules (eligibility check, credit limit) live in the BNPL provider or a \`PreCheckoutCheck\` chain that providers can contribute to.

**After:** adding BNPL touches its new provider class (+ tests), one registration line, config, and optionally a migration. Checkout, refunds and reconciliation are untouched, and their tests pass unchanged. That is the measurable OCP claim.

**Trade-off to mention:** registries lose compile-time exhaustiveness (a forgotten registration fails at runtime). Mitigate with a boot-time check that every enabled method in config has a provider exposing the capabilities the flows require.`,
      followUps: [
        {
          q: 'The refund flow differs so much for BNPL (partial cancellation of a loan, re-amortised EMIs) that the generic interface barely fits. Do you force it in?',
          a: 'No. Forcing different semantics into one `refund()` signature produces LSP violations (methods that throw or ignore arguments). Model the business difference explicitly: `RefundService` handles `Refundable` methods, and a `LoanAdjustmentService` handles `Cancellable` ones, both triggered by the same `ReturnApproved` event. OCP still holds for the next card-like method. BNPL just introduced a new capability, which is a legitimate one-time design change.',
        },
        {
          q: 'How would you make the "forgot to register" failure impossible to ship?',
          a: 'At boot, validate the registry against configuration: for each enabled method ID, assert a provider exists and implements the capabilities the enabled flows need (`isRefundable(p) || isCancellable(p)`), and fail fast before the server accepts traffic. Add a contract test suite every provider must pass. Optionally, generate the method-ID union type from the registry so TypeScript flags unknown IDs in config.',
        },
      ],
      pitfalls: [
        'Claiming OCP means zero modified files',
        'Adding a base class with `refund()` that BNPL overrides to throw',
        'Leaving gateway-specific status mapping in shared jobs',
      ],
    },
    {
      id: 'lld-oop-solid-iq-10',
      difficulty: 'expert',
      question:
        'In a food-delivery LLD round: "Order" means a cart-turned-purchase to the customer app, a ticket with prep time to the restaurant, a pickup-and-drop task to the rider app, and a payable with commission to finance. The current NestJS monolith has one 60-column Order entity shared by all four teams. How would you model this, and how do the parts talk to each other?',
      whatInterviewerLooksFor: [
        'Recognises four bounded contexts with four different models behind the same word',
        'Names an aggregate root and its invariants per context instead of one shared entity',
        'Uses versioned integration events (via an outbox) between contexts, with clear upstream/downstream roles',
        'Places an anti-corruption layer where a foreign model (restaurant POS, payment gateway) enters',
        'Plans an incremental split of the shared entity and knows when not to over-engineer',
      ],
      modelAnswer: `### Contexts and their own models
| Context | Aggregate root | Invariants it guards |
|---|---|---|
| **Ordering** | \`Order\` (lines, address, price snapshot) | can't change items after \`PLACED\`; total = sum(lines) + fees − discount |
| **Kitchen** | \`KitchenTicket\` | states ACCEPTED → PREPARING → READY; prep ETA only moves forward once READY |
| **Delivery** | \`DeliveryJob\` | one active rider; pickup before drop; proof-of-delivery required to complete |
| **Settlement** | \`Payable\` | commission computed once at a frozen rate; payout only after delivery confirmed |

Each one has its own table(s) and its own NestJS module, and maybe its own service later. They share **IDs** (\`orderId\`), never classes.

### How they talk
- Ordering publishes \`OrderPlaced v1\` (integration event, transactional outbox → Kafka). Kitchen consumes it and creates a \`KitchenTicket\`. Ordering is **upstream**, Kitchen is a **customer**.
- Kitchen publishes \`OrderReady\` → Delivery assigns a rider. Delivery publishes \`OrderDelivered\` → Settlement creates the \`Payable\`.
- Queries spanning contexts ("order status screen") use a **read model** built from these events, not joins across modules.
- **ACL** in Kitchen for each restaurant POS integration (a cloud POS API, a legacy XML feed): their status codes become \`KitchenTicket\` commands, and unknown codes go to a quarantine queue. **ACL** in Settlement for the payment gateway's settlement files.

### Inside one context (Ordering)
\`domain/\` (Order, Money, OrderLine), \`application/\` (PlaceOrder use case, OrderRepository port, PaymentAuthorizer port), \`adapters/\` (pg repository, gateway client, controller). Repository per **root**; optimistic locking via \`version\`.

### Migration from the 60-column entity
1. Draw the context map and assign column ownership per context.
2. Strangle by context: introduce the Kitchen module with its own table, fed by \`OrderPlaced\`, and dual-read during cutover.
3. Make other modules stop writing Kitchen's columns; then drop them.
4. Add a CI boundary rule so modules can't import each other's \`domain/\`.

### Don't overdo it
Four contexts, yes. Microservices for each on day one, no: modules with separate schemas inside the monolith give most of the benefit. Avoid a shared kernel beyond small value objects such as \`Money\`.`,
      followUps: [
        {
          q: 'The customer cancels 30 seconds after placing the order, but the kitchen already accepted it. Who decides, and how?',
          a: 'Ordering owns the customer\'s intent, and Kitchen owns whether food is being made. Ordering sends `CancellationRequested`. Kitchen replies `CancellationAccepted` if the ticket is still ACCEPTED, or `CancellationRejected { reason: PREPARING }`. Ordering then moves to CANCELLED, or to CANCEL_FAILED with a partial refund policy. It is a small saga: no context reaches into another\'s aggregate, and each keeps its own invariant.',
        },
        {
          q: 'Finance wants the order\'s item list in Settlement. Do you share the Ordering Order class or copy data?',
          a: 'Copy the data you need, frozen, in the integration event or fetched once through Ordering\'s published API: item ids, quantities, prices and the tax snapshot. Settlement needs the values *as they were at settlement time*, not a live object that Ordering may change. Sharing the class creates a shared kernel that couples deploys and invites Settlement to call Ordering\'s methods.',
        },
        {
          q: 'In a 90-minute machine-coding version, how much of this do you build?',
          a: 'One context end to end (Ordering): domain classes with invariants, a PlaceOrder use case, an in-memory repository, and an in-memory event bus that a stub Kitchen handler subscribes to, to show the flow. Mention the outbox, Kafka and ACLs verbally. Evaluators look for clear boundaries, invariants enforced in the root, and testable code, not for four services.',
        },
      ],
      pitfalls: [
        'Keeping one shared Order class and adding nullable columns per team',
        'Calling other contexts\' repositories directly or joining their tables',
        'Turning every context into a microservice immediately',
        'Letting POS or gateway status codes leak into domain enums',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'lld-oop-solid-boe-1',
      question:
        'A reviewer objects to your immutable `Money` value object: "every add/times allocates — at sale peak we re-price 5,000 carts/s with ~25 lines each". Estimate the allocation rate and GC cost, and decide whether to switch to a mutable accumulator.',
      assumptions: [
        '~4 Money operations per line (times, add to subtotal, discount share, tax), each creating 1 Money + 1 bigint',
        'Money object ~24 B + small bigint ~24 B ≈ 50 B per operation',
        'V8 young generation: scavenges are cheap for short-lived garbage (~1 ms per scavenge of a 16 MB semi-space, cost scales with survivors)',
        'Each checkout already spends ~30 ms in I/O (inventory, pricing, payment calls)',
      ],
      steps: [
        { label: 'Money ops per cart', calc: '25 lines × 4 ≈ 100 allocations' },
        { label: 'Allocations per second', calc: '5,000 carts/s × 100 = 500K Money objects/s' },
        { label: 'Garbage bytes per second', calc: '500K × 50 B ≈ 25 MB/s' },
        { label: 'Scavenges', calc: '25 MB/s ÷ 16 MB ≈ 1.6 scavenges/s × ~1 ms ≈ 1.6 ms/s ≈ 0.16% of one core' },
        { label: 'Spread across pods', calc: '5,000 carts/s over 20 pods = 250/s per pod → ~0.01% CPU per pod' },
        { label: 'Compare with I/O', calc: '100 allocations ≈ a few µs per cart vs ~30,000 µs of I/O' },
      ],
      answer:
        '≈ 500K short-lived objects/s (~25 MB/s) fleet-wide, which costs well under 1% of a core even on one pod. Keep immutability. The mutable accumulator saves microseconds per cart and reintroduces aliasing bugs.',
      insight:
        'Immutability costs are almost always noise next to I/O. Optimise only where a profiler shows allocation pressure, e.g. tight loops over millions of items in batch jobs. There, accumulate in a local `bigint` inside one method and wrap the result in `Money` once at the end, keeping the public API immutable.',
      followUps: [
        {
          q: 'A nightly settlement job sums 50M ledger entries in a single Node process using `Money.add`. Does your conclusion change?',
          a: 'Here allocation is the work: 50M × 2 objects ≈ 5 GB of garbage, about 300 scavenges, and a few seconds of GC. That\'s noticeable but rarely the bottleneck compared with reading 50M rows. Better design: let the DB `SUM(amount_minor)` grouped by merchant, or stream rows and accumulate a raw `bigint` per merchant inside the reducer, creating `Money` once per merchant. Immutability stays at the domain boundary while the hot loop stays primitive.',
        },
        {
          q: 'What would change if amounts were `number` paise instead of `bigint`?',
          a: 'Small integers (SMIs, up to ±2^31 on pointer-compressed builds) are unboxed in V8, so `number` paise avoid the bigint allocation, roughly halving garbage, and arithmetic is faster. Safe up to 2^53 paise (about ₹90 trillion), which is fine for most carts. The risk is silent precision loss beyond that and accidental float math (`* 0.9`). Many teams use `number` with integer-only operations validated in the VO. `bigint` is the stricter choice for ledgers.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-boe-2',
      question:
        'To pass tenant context, someone made a deep NestJS provider `Scope.REQUEST`. Request scope cascades, so 40 providers in its dependency chain are now built per request. A pod serves 3,000 RPS on one event loop. Estimate the CPU and allocation overhead.',
      assumptions: [
        'Instantiating a provider via Nest\'s injector (resolve deps + construct) ~10 µs average',
        'Each provider instance and its closures ~200 B of heap',
        'Before the change, all 40 were singletons (0 per-request cost)',
        'Pod target: event loop ≤ 70% busy',
      ],
      steps: [
        { label: 'Per-request DI cost', calc: '40 providers × 10 µs = 0.4 ms CPU per request' },
        { label: 'Per-second DI cost', calc: '3,000 req/s × 0.4 ms = 1.2 s of CPU per second' },
        { label: 'Event-loop budget', calc: '1 core = 1.0 s/s → DI alone exceeds the whole loop (120%)' },
        { label: 'Garbage', calc: '3,000 × 40 × 200 B ≈ 24 MB/s extra young-gen garbage' },
        { label: 'Capacity impact', calc: 'if real work was ~0.2 ms/request (60% of the loop), adding 0.4 ms cuts max throughput from ~3,500 to ~1,150 RPS per pod at 70% target' },
      ],
      answer:
        '≈ 0.4 ms of DI per request, which is more than one full core at 3,000 RPS. The pod can no longer sustain its old load and needs ~3× the pods for the same traffic.',
      insight:
        'Request scope is a hidden fan-out of object construction. Keep providers singleton and pass request context through `AsyncLocalStorage` (e.g. nestjs-cls) or as explicit method parameters. If per-tenant instances are truly needed, use Nest\'s durable providers (one instance per tenant, not per request).',
      followUps: [
        {
          q: 'Your estimate of 10 µs per provider could be off by 5×. How do you measure the real overhead before deciding?',
          a: 'Benchmark one endpoint with autocannon at fixed concurrency on a single pod, singleton vs request-scoped build, and compare max RPS and event-loop utilisation (`perf_hooks.monitorEventLoopDelay`, ELU). Add a CPU profile (`--cpu-prof`) and look at time in `Injector.loadPerContext`/instantiation frames. Measure on a production-like container CPU limit, since a throttled 1-vCPU pod magnifies the cost compared with a laptop.',
        },
        {
          q: 'With AsyncLocalStorage instead, what new failure mode must the design guard against?',
          a: 'Lost context. Code that runs outside the original async chain (callbacks from some pooled libraries, event emitters registered at startup, timers created before the request) sees `undefined` tenant, and a fallback to a "default tenant" would leak data across tenants. Guard by failing closed: `getTenant()` throws if missing. Also run tests that execute two tenants concurrently and assert no cross-talk.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-boe-3',
      question:
        'You modelled `MerchantWallet` as one aggregate (one row, versioned) updated on every captured payment. During a sale a large merchant receives 500 payments/s. Each update transaction (balance update + ledger insert + commit) holds the row lock ~4 ms. Will it keep up, and how would you reshape the aggregate?',
      assumptions: [
        'Pessimistic: updates to one row serialise on its lock; ~4 ms per transaction including commit fsync',
        'Optimistic alternative: read-modify-write with version check, ~4 ms between read and write',
        'Arrivals are roughly Poisson',
        'Payouts (debits) happen a few times per day',
      ],
      steps: [
        { label: 'Max serialised throughput on one row', calc: '1 ÷ 4 ms = 250 tx/s' },
        { label: 'Utilisation', calc: '500 ÷ 250 = 200% → queue grows without bound' },
        { label: 'Optimistic conflicts', calc: '500/s × 4 ms = 2 concurrent writers on average → ~85% of attempts see another write → retry storm, effective throughput < 250/s' },
        { label: 'Split into N sub-balances (buckets)', calc: 'N = 8 → capacity 8 × 250 = 2,000 tx/s → utilisation 25%' },
        { label: 'Append-only alternative', calc: 'INSERT ledger rows only (no hot row); balance = snapshot + SUM(entries since snapshot), snapshot every 10 s' },
      ],
      answer:
        'No. One row caps at ~250 updates/s against 500/s of demand. Use ~8 balance buckets (credit a random or hashed bucket) or an append-only ledger with periodic balance snapshots. Both remove the single hot row.',
      insight:
        'Aggregate boundaries are throughput decisions. "One merchant = one aggregate" is a natural model but serialises a hot merchant. Credits commute, so they don\'t need the whole-balance invariant. Only debits ("balance ≥ payout") do, and those are rare, so they can afford to lock all buckets or read the ledger sum.',
      followUps: [
        {
          q: 'With 8 buckets, how do you implement a payout of ₹40 lakh that must not overdraw?',
          a: 'Lock all 8 bucket rows in a fixed order (`SELECT ... FOR UPDATE ORDER BY bucket`), sum them, reject if the sum is below the payout, then debit from buckets (largest first) and insert a ledger entry, all in one transaction. Taking the locks blocks credits for a few ms, which is acceptable because payouts are rare. Fixed lock order prevents deadlocks with concurrent payouts. Credits never need the sum.',
        },
        {
          q: 'Peak becomes 5,000 payments/s for a single merchant. Do you just set N = 80?',
          a: 'N = 80 gives 20K/s capacity (25% utilisation), but payouts must now lock 80 rows and balance reads sum 80 rows. It still works, but the append-only ledger scales better here: inserts don\'t contend at all (only on index pages), and a background aggregator folds entries into the balance every few seconds. The trade-off is that the balance is slightly stale, so the payout check must read snapshot + unaggregated entries in a consistent transaction.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'lld-oop-solid-mcq-01',
      difficulty: 'hard',
      question:
        'A payments module models fixed deposits as a subclass. Code that sweeps idle funds iterates over all `Account`s and calls `withdraw`. What is the core design problem?',
      code: {
        language: 'typescript',
        code: `class Account {
  constructor(protected balance: bigint) {}
  /** Withdraws amount if balance allows. */
  withdraw(paise: bigint): void {
    if (paise > this.balance) throw new InsufficientFunds();
    this.balance -= paise;
  }
}

class FixedDepositAccount extends Account {
  constructor(balance: bigint, private readonly maturesAt: Date, private readonly clock: Clock) {
    super(balance);
  }
  override withdraw(paise: bigint): void {
    if (this.clock.now() < this.maturesAt) throw new Error('FD not matured');
    super.withdraw(paise);
  }
}`,
      },
      options: [
        'It violates SRP, because FixedDepositAccount handles both maturity and balance',
        'It violates LSP: the subclass strengthens the precondition of withdraw, so callers written against Account break',
        'It violates DIP, because FixedDepositAccount depends on a Clock',
        'There is no problem; throwing a domain error from an override is normal polymorphism',
      ],
      correct: [1],
      explanation:
        'The base contract says "withdraws if balance allows". The subclass adds a stronger precondition (must be matured) and a new failure type, so generic sweep code that was correct for `Account` now fails. That is the textbook LSP violation. Maturity is one cohesive rule, so SRP is fine. Injecting a Clock is good DIP practice. Throwing is fine only when the base contract allows that failure.',
      followUps: [
        {
          q: 'Fix it without an instanceof check in the sweep code.',
          a: 'Make withdrawability part of the contract: either split capabilities (`Withdrawable` implemented by savings accounts; FD exposes `prematureClose(penaltyPolicy)` instead), or put `canWithdraw(amount, now): boolean` on the base type so every subtype honestly reports it and the sweep skips non-withdrawable accounts. The first is cleaner: the sweep depends on `Withdrawable[]`, so FDs never enter it.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-02',
      difficulty: 'expert',
      question:
        'A candidate de-duplicates cart discounts using a Set of Money value objects. What does `applied.size` print, and why?',
      code: {
        language: 'typescript',
        code: `class Money {
  constructor(readonly minor: bigint, readonly currency: 'INR') {}
  equals(o: Money) { return this.minor === o.minor && this.currency === o.currency; }
}

const applied = new Set<Money>();
applied.add(new Money(5000n, 'INR'));
applied.add(new Money(5000n, 'INR'));
applied.add(new Money(2500n, 'INR'));
console.log(applied.size);`,
      },
      options: [
        '2 — Set uses the equals() method when it is defined',
        '2 — readonly fields make instances structurally equal',
        '3 — Set compares objects by reference (SameValueZero), ignoring equals()',
        '3 — bigint fields cannot be compared by Set, so every entry is unique',
      ],
      correct: [2],
      explanation:
        'JavaScript `Set`/`Map` use SameValueZero, which for objects means reference identity. A custom `equals` is never consulted (unlike Java\'s HashSet with equals/hashCode). `readonly` is a compile-time annotation that doesn\'t affect runtime equality, and bigints compare by value as primitives, but here they sit inside distinct objects.',
      followUps: [
        {
          q: 'How do you get value semantics for keys in JS?',
          a: 'Key collections by a canonical primitive: `new Map<string, Money>()` with key `m.currency + \':\' + m.minor`, exposed through a `Money.key()` method. Alternatively intern instances through a factory cache (`Money.of` returns the same instance for equal values, workable for small domains), or use a library hash map with custom equality. Java gets this from `equals`/`hashCode` in `HashSet`, or from records which implement both.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-03',
      difficulty: 'medium',
      question:
        'Select ALL correctly labelled UML relationships for an e-commerce LLD.',
      options: [
        'Order <>-- OrderLine (composition): lines are created by the order and deleted with it',
        'Team o-- Player (aggregation): players exist independently and can move teams',
        'FareCalculator --> Ride (association): calculate(ride) receives a ride as a parameter only',
        'UpiPayment ..|> Payable (realization): the class implements the interface',
        'Warehouse <>-- Forklift (composition): forklifts are tracked as assets and transferred between warehouses',
      ],
      correct: [0, 1, 3],
      explanation:
        'Composition means lifecycle ownership (OrderLine), aggregation means a has-a with independent parts (Player), and realization means implementing an interface. A class that only receives another as a method parameter has a *dependency* (`..>`), not an association, which implies a lasting reference. Transferable forklifts outlive any warehouse, so that relationship is aggregation, not composition.',
      followUps: [
        {
          q: 'How does the Order–OrderLine composition show up in the database schema?',
          a: 'Either `order_lines.order_id NOT NULL REFERENCES orders(id) ON DELETE CASCADE`, or the lines stored inside the order row (JSONB) when they are only ever read with the order. Either way no other table references an order line independently, and lines are written only through the order\'s repository in the same transaction as the order.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-04',
      difficulty: 'hard',
      question:
        'A repository exposes `save(order: Order, skipValidation: boolean, notify: boolean)`. Call sites pass all four combinations. Which description and fix are most accurate?',
      options: [
        'Stamp coupling — pass only the order ID instead of the whole order',
        'Control coupling — callers steer the callee\'s internal logic; split into intention-revealing operations and move notification to an event listener',
        'Content coupling — the repository reads private fields; make Order\'s fields public',
        'Acceptable data coupling — booleans are primitive data, so coupling is minimal',
      ],
      correct: [1],
      explanation:
        'Flags that select behaviour inside the callee are control coupling: callers must know the callee\'s internals, and each flag doubles the paths to test. The repository also mixes persistence with validation and notification (an SRP problem). Splitting it up, validating in the aggregate (so it can\'t be skipped) and moving notification to a `OrderSaved` listener removes the flags. It is not stamp coupling (the order is needed), and primitives can still carry control.',
      followUps: [
        {
          q: 'One caller genuinely needs to save without validation — a data migration importing legacy orders. How do you serve it?',
          a: 'Give it its own explicit path: a `LegacyOrderImporter` that constructs orders via a dedicated factory (`Order.rehydrate(snapshot)`, which trusts persisted data) and writes through a migration-only repository method or bulk SQL. It\'s visible in the code, named, and not reachable from request handlers, so the bypass can\'t leak into normal flows the way a boolean parameter can.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-05',
      difficulty: 'expert',
      question:
        'This NestJS app fails at startup with "Nest can\'t resolve dependencies of OrderService (?)". What is the cause?',
      code: {
        language: 'typescript',
        code: `export interface OrderRepository {
  save(o: Order): Promise<void>;
}

@Injectable()
export class PgOrderRepository implements OrderRepository {
  async save(o: Order) { /* ... */ }
}

@Injectable()
export class OrderService {
  constructor(private readonly repo: OrderRepository) {}
}

@Module({ providers: [OrderService, PgOrderRepository] })
export class OrderModule {}`,
      },
      options: [
        'PgOrderRepository must be listed in exports for OrderService to see it',
        'The interface is erased at compile time; the emitted constructor metadata is Object, so no provider matches',
        'Interfaces cannot be implemented by @Injectable classes in NestJS',
        'emitDecoratorMetadata is disabled, so Nest cannot see any constructor types',
      ],
      correct: [1],
      explanation:
        'TypeScript emits `design:paramtypes` using runtime values, and an interface has none, so the parameter type becomes `Object`, which no provider is registered for. Implementing `implements OrderRepository` doesn\'t create a link Nest can see. Exports only matter across modules. If emitDecoratorMetadata were off, Nest would fail for every class-typed dependency too, not just interface-typed ones.',
      followUps: [
        {
          q: 'Give the two idiomatic fixes and one reason to prefer each.',
          a: '(1) Token: `export const ORDER_REPO = Symbol(\'ORDER_REPO\')`, `{ provide: ORDER_REPO, useClass: PgOrderRepository }`, `@Inject(ORDER_REPO)`. It keeps a pure interface, and fakes can be plain objects. (2) Make `OrderRepository` an `abstract class` and register `{ provide: OrderRepository, useClass: PgOrderRepository }`. No decorator is needed and the type doubles as the token, which is handy when there are many repositories. Both keep `OrderService` depending on an abstraction.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-06',
      difficulty: 'hard',
      question:
        'The loans team\'s `computeLateFee(days, principal)` and the payments team\'s `computeConvenienceFee(days, amount)` currently have identical bodies (2% per day, capped at ₹500). A PR merges them into one shared `computeFee`. What is the best review response?',
      options: [
        'Approve — identical code is duplication and DRY requires one implementation',
        'Approve, but add a `type` parameter so each team can diverge later',
        'Reject — they encode different business knowledge owned by different actors; keep them separate and share only genuinely common primitives',
        'Reject — shared functions across teams always violate the DIP',
      ],
      correct: [2],
      explanation:
        'DRY is about single sources of *knowledge*. Late fees are regulated lending policy and convenience fees are a pricing decision, so they will change for different reasons at different times, and merging them couples two actors. Adding a `type` flag builds in control coupling from day one. Sharing code across teams doesn\'t inherently violate DIP. The issue is the wrong abstraction.',
      followUps: [
        {
          q: 'What could legitimately be shared between them?',
          a: 'Stable primitives that mean the same thing for both: `Money` arithmetic, a `Percentage` value object with an explicit rounding mode, and a `capAt(max)` helper. Those change for the same reason (correct arithmetic), unlike the fee policies. Each fee then becomes a small policy class (`LateFeePolicy`, `ConvenienceFeePolicy`) composed from the primitives.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-07',
      difficulty: 'expert',
      question:
        'Base type: `Cache.get(key)` returns the latest value written or null; `Cache.set(key, v)` stores v. Select ALL subtypes that violate the Liskov Substitution Principle.',
      options: [
        'TtlCache.set throws if the value is larger than 1 MB, though the base accepted any value',
        'InstrumentedCache.get returns a more specific type (`CachedValue` subclass) than the base declares',
        'ReadThroughCache.set throws UnsupportedOperation because writes go to the database',
        'LenientCache.get accepts `string | number` keys where the base accepted only `string`',
        'EventuallyConsistentCache.get may return a value older than the latest write for a few seconds',
      ],
      correct: [0, 2, 4],
      explanation:
        'Rejecting large values strengthens a precondition, throwing on `set` adds a failure the base contract doesn\'t allow, and returning stale values weakens the "latest value" postcondition. All three break callers written against `Cache`. Covariant return types and contravariant (broader) parameters are both allowed by LSP, because callers still get what they expect.',
      followUps: [
        {
          q: 'EventuallyConsistentCache is genuinely useful. How do you offer it without the violation?',
          a: 'Change the contract honestly. Either declare a separate `StaleTolerantReader` interface that callers opt into (say, a product listing), or weaken the base contract to "returns a value no older than N seconds" and give `Cache` a `consistency` property. Callers needing read-your-writes (checkout) then depend on a type that guarantees it, so the compiler routes them away from the stale implementation.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-08',
      difficulty: 'medium',
      question:
        '`RevenueReportService` depends on a 14-method `OrderRepository` (create, update, cancel, delete, findById, search, sumByDay...). It only calls `sumByDay`. What is the most concrete cost of this design?',
      options: [
        'The report runs slower, because larger interfaces add runtime dispatch overhead',
        'Every test fake must implement 14 methods, and the report can accidentally call write/delete operations it should never use',
        'It violates OCP, because adding a report requires editing the repository',
        'It violates composition over inheritance, because the service should extend the repository',
      ],
      correct: [1],
      explanation:
        'This is an ISP problem. Clients coupled to methods they don\'t use pay for them in test fakes, in recompiles and reviews whenever unrelated methods change, and in the ability to mutate data from a read-only report. Interface size has no runtime dispatch cost in JS. OCP and inheritance are not what is broken here.',
      followUps: [
        {
          q: 'Should the fix be a new `OrderReportingRepository` class or just a narrower interface?',
          a: 'Start with a narrower interface (`OrderRevenueReader { sumByDay(range) }`) implemented by the existing repository, which is cheap and immediate. If reporting queries diverge (read replica, warehouse, materialised views), give them their own implementation on a different data source behind the same interface. The report service doesn\'t change, which is the payoff of ISP plus DIP.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-09',
      difficulty: 'expert',
      question:
        'This compiles without errors and refunds the wrong customer in production. Which design change would have made the compiler catch it?',
      code: {
        language: 'typescript',
        code: `type UserId = string;
type OrderId = string;

function issueRefund(userId: UserId, orderId: OrderId, paise: bigint) { /* ... */ }

const order = { id: 'ord_91', userId: 'usr_17', totalPaise: 49900n };
issueRefund(order.id, order.userId, order.totalPaise); // arguments swapped`,
      },
      options: [
        'Use interfaces instead of type aliases for UserId and OrderId',
        'Enable strictNullChecks so string parameters are checked more strictly',
        'Branded/nominal identifier types (e.g. `string & { readonly __brand: \'UserId\' }`, or VO classes with a private field)',
        'Mark the parameters readonly so they cannot be reassigned',
      ],
      correct: [2],
      explanation:
        'Type aliases are just names for `string`, and TypeScript\'s structural typing treats both as the same type, so swapped arguments compile. Branding (or classes with a private member, which TS compares nominally) gives each ID a distinct type. Interfaces can\'t wrap a primitive this way, strictNullChecks is about null/undefined, and readonly parameters don\'t affect type compatibility.',
      followUps: [
        {
          q: 'Brands exist only at compile time. Where do you create branded IDs so they can\'t be forged?',
          a: 'At trust boundaries: a parsing/validation function per ID (`parseUserId(raw): UserId`, which checks prefix and format) used by controllers and repository row mappers. It\'s the only place allowed to cast, enforced with a lint rule against `as UserId` elsewhere. Inside the domain, IDs then flow typed end to end.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-10',
      difficulty: 'hard',
      question:
        'The `Order` aggregate holds a reference to the `Customer` aggregate and, inside `order.place()`, increments `customer.loyaltyPoints`; both are saved in one transaction. Under load, what is the most significant consequence?',
      options: [
        'Orders lose atomicity, because two aggregates can never share a transaction',
        'Every order from the same customer contends on the customer row/version, and the order aggregate now has two reasons to change — loyalty rules belong in a separate, eventually consistent handler',
        'Loyalty points become eventually consistent, which is incorrect for financial data',
        'The ORM will refuse to save two aggregates in one unit of work',
      ],
      correct: [1],
      explanation:
        'Modifying two aggregates per transaction enlarges the consistency boundary. Concurrent orders from one customer (or a B2B account with many buyers) serialise or conflict on the customer\'s version, and loyalty policy leaks into ordering. The usual rule is to reference by ID and update loyalty from an `OrderPlaced` event. A shared transaction is technically possible, which is exactly why it gets abused. The design as written is strongly consistent, not eventually consistent. ORMs allow it.',
      followUps: [
        {
          q: 'Product insists that points be visible immediately on the order confirmation page. Do you go back to one transaction?',
          a: 'Usually not. The confirmation page can show *computed* points (`pointsFor(order)` from the same policy), labelled "points earned", while the balance updates asynchronously within seconds through an idempotent `OrderPlaced` handler keyed by order ID. If the balance itself must be exact on that page, read your own write by polling or awaiting the handler briefly. That\'s a UX trade-off, not a reason to couple aggregates.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-11',
      difficulty: 'expert',
      question:
        'A batch-import script bypasses the per-SKU quantity limit on a cart whose lines field is marked readonly. Which statement explains what happens?',
      code: {
        language: 'typescript',
        code: `class Cart {
  readonly lines: { sku: string; qty: number }[] = [];
  addLine(sku: string, qty: number) {
    if (qty > 10) throw new RangeError('max 10 per sku');
    this.lines.push({ sku, qty });
  }
}

const cart = new Cart();
cart.lines.push({ sku: 'iphone', qty: 500 }); // from a batch-import script
cart.lines[0].qty = 9999;`,
      },
      options: [
        'Both mutations fail to compile, because the lines field is readonly',
        'The push fails to compile, but the qty assignment compiles',
        'Both compile and run; readonly only prevents reassigning the lines reference, so the invariant is bypassed',
        'Both compile, but throw at runtime because readonly fields are frozen',
      ],
      correct: [2],
      explanation:
        '`readonly` on a property is shallow and compile-time only. It blocks `cart.lines = [...]`, not mutation of the array or its elements, and nothing is frozen at runtime. The fix is a private field with a `ReadonlyArray<Readonly<Line>>` getter that returns copies (or frozen snapshots), so every change has to go through `addLine`.',
      followUps: [
        {
          q: 'Would `Object.freeze(this.lines)` in the constructor solve it?',
          a: 'It would make `push` throw in strict mode, including inside `addLine` itself, so the class couldn\'t mutate its own list. It\'s also shallow, so `lines[0].qty = 9999` still works unless elements are frozen too. The cleaner design keeps a private mutable array and exposes immutable views: `get lines(): ReadonlyArray<Readonly<Line>> { return this._lines.map(l => ({ ...l })) }`.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-12',
      difficulty: 'hard',
      question:
        '`OrderService` is a NestJS provider whose constructor receives `RazorpayClient` (the vendor SDK class) via DI, and it calls `this.rzp.orders.create(...)` and reads Razorpay-specific status strings. Which statement is accurate?',
      options: [
        'DIP is satisfied, because the dependency is injected rather than constructed',
        'Dependency injection is used, but DIP is violated: high-level policy depends on a low-level vendor detail it doesn\'t own',
        'DIP is violated only because Nest providers should be interfaces, not classes',
        'Neither applies, because SDK classes are infrastructure and exempt from SOLID',
      ],
      correct: [1],
      explanation:
        'DI is the mechanism for supplying collaborators, and DIP is about the direction of source dependencies and ownership of abstractions. Here the domain service imports vendor types and status vocabulary, so switching vendors (or faking one) means editing business logic. The fix is a domain-owned `PaymentGateway` port implemented by a `RazorpayGateway` adapter that translates SDK types. Classes can be providers, and nothing is exempt from SOLID.',
      followUps: [
        {
          q: 'The adapter must translate Razorpay statuses (created, attempted, paid) into domain states. What goes wrong if the mapping is incomplete?',
          a: 'Unknown statuses (a new state like `partially_refunded`, or a renamed one) either crash the flow or get silently mapped to a default, and defaulting to "paid" is a financial bug. The adapter should map exhaustively, treat unknown values as `UNKNOWN` routed to reconciliation with an alert, and have contract tests built from recorded vendor payloads.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-13',
      difficulty: 'medium',
      question:
        'In a 90-minute parking-lot round, a candidate spends 20 minutes building `AbstractVehicleFactoryProvider`, `VehicleFactoryRegistry` and `IVehicleBuilder` for exactly two vehicle types that differ only in size. How will a typical evaluator read this?',
      options: [
        'Positively, because more patterns signal stronger design skills',
        'Neutrally, because unused abstractions do no harm as long as the code runs',
        'Negatively: speculative abstraction (YAGNI) cost time from must-haves and adds viva questions the candidate must justify',
        'Positively, but only if every class has a unit test',
      ],
      correct: [2],
      explanation:
        'Evaluators reward abstractions placed at real variation points. Three layers of factory for two size-only variants is speculative generality: it consumes time that should go to features, and the viva will ask "why?" without a good answer. A simple `VehicleType` with a size, or a small `Vehicle` class, plus a `SpotAllocationStrategy` where variation really exists, scores better.',
      followUps: [
        {
          q: 'The evaluator then adds: "EV vehicles need charging spots and are billed per kWh." Now is a factory justified?',
          a: 'Now there is real variation in allocation (needs a charging spot) and billing (per kWh), so the seams should be `SpotRequirement` (or spot capability matching) and `BillingPolicy`, not vehicle construction. Construction stays simple (`new Vehicle(type, reg)`). A tiny factory or registry mapping `VehicleType` to its requirement and billing policy is reasonable. A builder hierarchy still isn\'t.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-14',
      difficulty: 'expert',
      question:
        'A `CouponService` calls `Date.now()`, `crypto.randomUUID()`, `new RedisClient(process.env.REDIS_URL)` and reads `process.env.MAX_REDEMPTIONS` inside methods. Select ALL changes that genuinely improve its testability and design.',
      options: [
        'Inject a Clock so expiry tests can set "now" without sleeping',
        'Inject an IdGenerator so tests can assert on deterministic coupon IDs',
        'Inject a RedemptionStore port and use an in-memory fake that honours its atomic contract',
        'Convert all methods to static so tests can call them without constructing the service',
        'Read process.env inside each method so tests can change configuration between assertions',
      ],
      correct: [0, 1, 2],
      explanation:
        'Time, randomness and I/O are the classic hidden dependencies. Injecting them, ideally as small ports with contract-honouring fakes, makes behaviour deterministic and swappable. Static methods make dependencies *harder* to substitute. Reading env vars deep inside methods is hidden global state, so configuration should be parsed once and injected as a typed config object.',
      followUps: [
        {
          q: 'Your in-memory RedemptionStore fake passes all tests, but production double-redeems under concurrency. What did the fake get wrong?',
          a: 'It probably implemented `redeem` as separate `get` and `set` calls with an `await` between them, or the production Redis implementation did (GET then INCR). Then both fake and real store let two parallel calls pass the limit check. The port\'s contract must state "atomic check-and-increment", the Redis version must use a Lua script or `INCR` + compare, and the shared contract test must fire concurrent redemptions against both implementations.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-15',
      difficulty: 'hard',
      question:
        'In a Java machine-coding round, your singleton `ParkingLot` keeps `HashMap<Integer, Spot> occupied` and 8 gate threads park vehicles using `if (!occupied.containsKey(id)) occupied.put(id, spot)`. Which fix is correct?',
      options: [
        'Switch to ConcurrentHashMap and keep the containsKey-then-put sequence',
        'Use ConcurrentHashMap.putIfAbsent (or compute) so the check and the insert are one atomic operation',
        'Mark the map field volatile so all threads see the latest map',
        'Wrap it in Collections.synchronizedMap and keep containsKey-then-put as two calls',
      ],
      correct: [1],
      explanation:
        'The bug is a compound check-then-act. `ConcurrentHashMap` makes each call thread-safe but not the pair, and the same goes for `synchronizedMap` with two separate calls. Two gates can both see the spot as free. `putIfAbsent`/`compute` perform the check and the write atomically per key. `volatile` only affects visibility of the reference, not atomicity of operations on the map.',
      followUps: [
        {
          q: 'What is the equivalent reasoning in Node, and where does it stop being enough?',
          a: 'In Node, `if (!map.has(id)) map.set(id, spot)` with no `await` between is atomic because one callback runs at a time. That stops being enough when an `await` sits between check and set (other requests interleave), with worker_threads (separate heaps unless you use SharedArrayBuffer and Atomics), and with multiple pods. For those, the guarantee has to come from the store: a unique constraint, a conditional update or Redis `SET NX`.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-16',
      difficulty: 'expert',
      question:
        'A customer changes their saved address after an order shipped. Support now sees the new address on the old order\'s invoice. Which modelling choice prevents this?',
      options: [
        'Make Address an entity with an ID and have Order reference the customer\'s current address by that ID',
        'Treat the shipping address as a value object copied into the Order at placement time (a snapshot), independent of the customer\'s address book',
        'Add an updatedAt column to the address table and show the version closest to the order date',
        'Forbid address edits once any order has used the address',
      ],
      correct: [1],
      explanation:
        'At placement the address is a fact about the order ("shipped to"), so it belongs inside the Order aggregate as an immutable value. Referencing a mutable address entity is exactly what caused the bug. Temporal lookups by timestamp are a fragile reconstruction of what should simply have been stored. Freezing edits pushes a modelling mistake onto users.',
      followUps: [
        {
          q: 'Then why keep Address as an entity in the customer\'s address book at all?',
          a: 'In the address book an address has identity and a lifecycle from the user\'s point of view: "Home" can be edited, set as default or deleted, and other features reference it by ID. The same data plays two roles. It\'s an entity in the customer context (an editable saved address) and a value object in the order context (an immutable snapshot). Recognising context-dependent modelling is the DDD point here.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-17',
      difficulty: 'expert',
      question:
        'Product adds a new payment kind, `WALLET`. With design A (discriminated union + switch with exhaustive check) vs design B (Map<string, PaymentHandler> registry), what does the compiler tell you?',
      code: {
        language: 'typescript',
        code: `type Payment =
  | { kind: 'CARD'; last4: string }
  | { kind: 'UPI'; vpa: string }
  | { kind: 'WALLET'; walletId: string }; // newly added

// Design A
function feePaise(p: Payment, amount: bigint): bigint {
  switch (p.kind) {
    case 'CARD': return (amount * 2n) / 100n;
    case 'UPI': return 0n;
    default: { const never: never = p; throw new Error('unhandled ' + never); }
  }
}

// Design B
interface PaymentHandler { fee(amount: bigint): bigint; }
const handlers = new Map<string, PaymentHandler>([
  ['CARD', { fee: (a) => (a * 2n) / 100n }],
  ['UPI', { fee: () => 0n }],
]);`,
      },
      options: [
        'Neither design produces a compile error; both fail only at runtime',
        'Design A fails to compile until WALLET is handled in every such switch; design B compiles and fails at runtime when WALLET has no handler',
        'Design B fails to compile, because the Map is missing a key from the union',
        'Design A compiles, because default catches WALLET; design B fails to compile',
      ],
      correct: [1],
      explanation:
        'In A, `p` is narrowed to `{ kind: \'WALLET\' }` in the default branch, and assigning it to `never` is a compile error, so the compiler lists every switch that must change. B is open for extension (a new handler is a new entry), but a `Map<string, ...>` has no link to the union, so a missing registration is only discovered at runtime. That\'s the classic trade-off: a closed set with exhaustiveness versus an open set with registration.',
      followUps: [
        {
          q: 'Can you get registry-style extensibility with compile-time completeness?',
          a: 'Yes, for a closed set: type the registry as `Record<Payment[\'kind\'], PaymentHandler>` (or use `satisfies Record<...>`). Then adding `WALLET` to the union makes the object literal fail to compile until a handler is supplied, while each handler stays its own class. For a truly open set (plugins loaded at runtime) you give that up and add a boot-time check that every configured kind has a handler.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-18',
      difficulty: 'hard',
      question:
        'This use case lives in src/booking/application/. The team says it follows Clean Architecture "because Nest injects the repository". What is the real problem?',
      code: {
        language: 'typescript',
        code: `import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SeatRow } from '../adapters/out/seat.row';   // @Entity() class with TypeORM decorators

@Injectable()
export class ReserveSeat {
  constructor(@InjectRepository(SeatRow) private readonly seats: Repository<SeatRow>) {}

  async execute(showId: string, seatNo: string, userId: string): Promise<SeatRow> {
    const seat = await this.seats.findOneByOrFail({ showId, seatNo });
    if (seat.holder) throw new Error('taken');
    seat.holder = userId;
    return this.seats.save(seat);                     // returns the ORM row to the controller
  }
}`,
      },
      options: [
        'Nothing structural: dependency injection already decouples the use case from TypeORM',
        'The application layer imports an outer adapter and the ORM types, and returns an ORM row across the boundary, so the dependency rule is broken in both directions of data flow',
        'It violates LSP, because Repository<SeatRow> could be replaced by a subclass with different behaviour',
        'The only problem is performance: findOneByOrFail followed by save is two round trips',
      ],
      correct: [1],
      explanation:
        'The dependency rule concerns source imports: application/ imports adapters/out and typeorm, so an inner circle names an outer one. It also leaks an ORM row outward, which couples controllers to persistence. Injection is just the wiring mechanism; the imports still point outward. The fix is a SeatInventory port owned by application/, a pg/TypeORM adapter implementing it, and plain result DTOs. The read-then-write is also a race (two users reserve the same seat), but that is a concurrency bug, not the structural issue asked about, and LSP is unrelated.',
      followUps: [
        {
          q: 'After you add a port, the reserve still double-books under load. Where does the fix belong: use case, port or adapter?',
          a: 'The port\'s contract should say "atomic reserve: returns false if already held" (`tryReserve`), and the adapter implements that atomically, e.g. `UPDATE … WHERE holder IS NULL` checking `rowCount`, or a unique constraint on (show, seat) with insert-on-hold. The use case must not do read-then-write itself, because no in-process lock helps across 10 pods. Making atomicity part of the port contract also forces the in-memory fake to honour it.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-19',
      difficulty: 'expert',
      question:
        'Select ALL that apply. Your Settlement context must ingest a legacy ERP "CUSTOMER" record that mixes billing and shipping data and uses status codes A, S, X and blanks. Which choices fit an anti-corruption layer done right?',
      options: [
        'The Settlement team owns a translator/adapter that maps ERP records into its own value objects (e.g. BillingAccount, Gstin)',
        'Import the ERP DTO types into Settlement\'s domain, to avoid writing mapping code that can drift',
        'Unknown or blank status codes are rejected or quarantined in the translator, not passed through as strings',
        'The ERP team should change its schema to match Settlement\'s model, since the ACL is their responsibility',
        'Declare the ERP CUSTOMER schema a shared kernel so both sides evolve it together',
      ],
      correct: [0, 2],
      explanation:
        'An ACL protects the downstream model, so the downstream team builds and owns it, and every translation decision lives there, including what to do with codes it doesn\'t understand. Importing ERP types into the domain is the conformist relationship, the opposite of an ACL. Asking upstream to change is a customer–supplier negotiation, not an ACL, and legacy ERPs rarely change. A shared kernel over a legacy schema couples both teams to its worst parts.',
      followUps: [
        {
          q: 'The ERP adds a new status "P" without notice and 4% of records start failing translation. What should happen operationally?',
          a: 'The ACL sends the records to a quarantine/DLQ with the raw payload, increments a `acl_unmapped_code{code="P"}` metric and alerts. It must not guess a mapping. Settlement keeps processing the other 96%. Once the business confirms what "P" means, add the mapping and a test with the raw sample, then replay the quarantined records idempotently. That is the value of keeping all translation in one place.',
        },
      ],
    },
    {
      id: 'lld-oop-solid-mcq-20',
      difficulty: 'expert',
      question:
        'The Order aggregate enforces "max 10 units per SKU and total ≤ ₹2,00,000" in order.addItem(). A teammate adds the repository methods below for a new "edit quantity" screen. What is the most important problem?',
      code: {
        language: 'typescript',
        code: `export interface OrderRepository {
  byId(id: string): Promise<Order | null>;
  save(order: Order, expectedVersion: number): Promise<void>;
  // new:
  findLines(orderId: string): Promise<OrderLineRow[]>;
  updateLineQty(lineId: string, qty: number): Promise<void>;   // UPDATE order_lines SET qty = $2 WHERE id = $1
}

// controller
await repo.updateLineQty(body.lineId, body.qty);`,
      },
      options: [
        'It causes an N+1 query when the screen loads many lines, so findLines should join orders',
        'The repository should be a generic Repository<T> so lines and orders share one implementation',
        'It changes a child entity behind the aggregate root, bypassing the invariants and the version check, so limits and status rules can be broken and concurrent edits are lost',
        'It is acceptable as long as updateLineQty runs inside a database transaction',
      ],
      correct: [2],
      explanation:
        'Repositories exist per aggregate root and load or save the whole aggregate, so every change goes through the root\'s methods. updateLineQty skips addItem/changeQty rules (per-SKU cap, order total, "no edits after PAID") and skips the optimistic version, so two concurrent edits silently overwrite each other. A transaction gives atomicity, not business invariants. The N+1 and generic-repository points are secondary or unrelated. The fix is order.changeQty(sku, qty) and then repo.save(order, version).',
      followUps: [
        {
          q: 'Loading the whole Order to change one line feels wasteful. When is it a real problem, and what do you do then?',
          a: 'It is a problem only when the aggregate is large (hundreds of lines) or heavily contended, which usually means the boundary is wrong. Keep aggregates small: an order with ≤ 50 lines loads in one indexed query in ~1 ms. If a sub-part changes independently and has its own invariants (e.g. a cart vs a placed order), split it into its own aggregate referenced by id. For read-heavy screens, use a separate read model; the write path still goes through the root.',
        },
      ],
    },
  ],
};

export default topic;
