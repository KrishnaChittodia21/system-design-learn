import type { Topic } from '../../types';

const topic: Topic = {
  id: 'lld-cases-1',
  phase: 'lld',
  order: 5,
  title: 'LLD Case Studies I: Parking Lot, Elevator, BookMyShow & Splitwise',
  subtitle:
    'The four most-asked machine-coding problems in Indian product companies, each done the way a strong senior does it: requirements and a thin HLD first, then entities, an ASCII class diagram and the patterns that earn their place, then the hard core in TypeScript (spot allocation and slab pricing, LOOK scheduling with State, TTL seat holds that survive many pods, debt simplification), concurrency, extensibility probes and a 90-minute build plan.',
  estimatedMinutes: 150,
  sources: [
    'workat.tech — How to design Splitwise (machine coding editorial) and How to practice for machine coding',
    'LeetCode Discuss — Groww | Machine Coding Round | Design Splitwise (post 2008079)',
    'LeetCode Discuss — Interview Experience | SDE2 | Uber | Nov 2025 (Splitwise, minimise transactions)',
    'LeetCode Discuss — Acko | SDE-1 | Interview experience (2025, Splitwise machine coding)',
    'LeetCode Discuss — Swiggy SDE-1 Interview Experience: very high expectation in LLD round (2025)',
    'LeetCode Discuss — Design BookMyShow / online movie booking LLD (OOD) threads',
    'Glassdoor / Taro — Flipkart SDE-2 machine coding round reports (2025: 90 min build + 30 min review, SOLID and patterns)',
    'GeeksforGeeks — Razorpay Product Development Engineer interview (1.5 h machine coding over Google Meet)',
    'jobrise.io — Indian Unicorn Interviews: Flipkart, Meesho, Zomato, Razorpay hiring guide (2026)',
    'techinterview.org — LLD: Elevator System; LLD: Movie Ticket Booking System',
    'AlgoMaster — Design Elevator System (LLD); Codemia — Design an Elevator System',
    'Gamma, Helm, Johnson, Vlissides — Design Patterns (Strategy, State, Observer, Factory, Command)',
  ],
  tags: [
    'lld',
    'machine-coding',
    'parking-lot',
    'elevator',
    'bookmyshow',
    'splitwise',
    'strategy-pattern',
    'state-pattern',
    'concurrency',
    'solid',
  ],
  cheatSheet: [
    'Attack order for any LLD: clarify scope (5 min) → thin HLD: API + where state lives (5) → entities/relationships + diagram (10) → core interfaces + patterns (10) → code the hard path first (45) → demo driver + extensions (15).',
    'Parking lot: Strategy for allocation (nearest-to-gate, smallest-fit, EV-only chargers) and for pricing (slabs + daily cap, rupees in paise); Observer for floor display boards; Factory/registry for vehicle → spot-size rules.',
    'Parking concurrency: one process → single-threaded event loop makes a synchronous pick+mark atomic (never await between them); many pods → DB claim with FOR UPDATE SKIP LOCKED or a conditional UPDATE … WHERE occupied_by IS NULL.',
    'Elevator: separate hall calls (floor + direction, owned by the dispatcher) from cab calls (floor, owned by one car); LOOK reverses at the last request, SCAN runs to the end; a car moving up skips DOWN hall calls unless that floor is its turnaround.',
    'Elevator patterns: State (Idle / Moving / DoorsOpen / Maintenance) to kill boolean soup; Strategy for dispatch cost; Command queue so one single-writer loop owns car state (actor model) — no locks needed.',
    'BookMyShow: Show ◇— ShowSeat (status per show, never on the physical Seat); a SeatLockProvider interface (in-memory for the round, Redis/DB in prod); holds are all-or-nothing, owner-checked and TTL-bound (≈10 min).',
    'Double booking across pods: the TTL hold is an optimisation; the durable guard is UNIQUE(show_id, seat_id) on booking_seat or UPDATE … WHERE status = HELD AND hold_id = $1 AND hold_expires_at > now(). Late payment after expiry → refund or re-hold, never overwrite.',
    'Splitwise: store money as integer paise; Split strategies (Equal / Exact / Percent / Shares) validate and distribute the remainder (largest-remainder) so the parts sum exactly; balances are a derived net map, expenses are the ledger.',
    'Simplify debts: greedy max-creditor × max-debtor gives ≤ n−1 transfers but is not optimal; exact minimum = n − (max number of disjoint zero-sum subgroups), NP-hard, bitmask DP O(2ⁿ·n) fine up to ≈20 people.',
    'Machine-coding grading (Flipkart/Razorpay/Swiggy/PhonePe): it must run, the demo must be driven by a main() script, the core must be behind interfaces, and the extension the interviewer asks for at minute 75 must touch one new class, not five if/else chains.',
  ],
  sections: [
    {
      heading: 'How to attack any LLD case in 90 minutes: HLD first, then classes',
      body: `**Intuition:** an LLD round is a tiny product build with a stopwatch. The interviewer is not grading how many patterns you can name; they are grading whether your *first* design survives the change request they will throw at you in minute 75 ("now add EV spots", "now a VIP elevator", "now split by shares").

**The 7-step clock (what a strong senior does):**

| Minute | Step | Output |
|---|---|---|
| 0–5 | Clarify scope | 5–8 functional bullets, 2–3 non-functional (concurrency? persistence? single process?), an explicit *out of scope* list |
| 5–10 | Thin HLD | API (\`park(vehicle, gate)\`, \`holdSeats(show, seats, user)\`), which component owns state, what is in memory vs DB |
| 10–20 | Entities + relationships | Nouns → classes, verbs → methods; ASCII class diagram; composition over inheritance |
| 20–30 | Interfaces + patterns | Only where something *varies*: Strategy (pricing, allocation, split), State (lifecycle), Observer (displays/notifications), Factory (creation by type) |
| 30–75 | Code the hard path first | The allocation/scheduling/locking/simplification core; repositories as in-memory maps |
| 75–85 | Demo driver | A \`main()\` that prints a realistic scenario, including one failure (lot full, seat taken) |
| 85–90 | Extensions + concurrency talk | Which class you would add for the follow-up; how it behaves with 2 gates / 3 pods |

**Where state lives decides your concurrency story.** In a single Node process every synchronous block is atomic — but the moment you \`await\` between "read free spot" and "mark it taken", another request can interleave. In Java the same code needs \`synchronized\`, a \`ReentrantLock\` or \`ConcurrentHashMap.compute\`. With several pods, in-process locks mean nothing and the database (conditional update, unique constraint, \`SKIP LOCKED\`) or Redis becomes the arbiter.

**How each case maps to a core idea:**
- Parking lot → *allocation policy + pricing policy* (two Strategies) and atomic claim.
- Elevator → *scheduling + lifecycle* (LOOK + State) with a single writer.
- BookMyShow → *temporary exclusive ownership* (TTL lease) with a durable guard.
- Splitwise → *ledger + derived view + graph optimisation* (money correctness, min cash flow).

**In interviews say this:** "Let me pin requirements and where state lives, then I will draw the classes and code the allocation core first, and keep the repository in memory behind an interface so it can become Postgres later."`,
      diagram: `   Requirements ──> Thin HLD (API, state owner) ──> Entities
        │                                              │
        │          what varies? ──> Strategy / State / Observer
        ▼                                              ▼
   Out-of-scope list            Code hard core first (in-memory repos)
                                               │
                     main() demo ──> extension asked at min 75
                                               │
                     touches 1 new class? ✔ good design  ✘ rewrite`,
      keyPoints: [
        'Spend the first 20 minutes on scope, HLD and entities — it saves the last 20.',
        'Patterns only where behaviour varies; name the variation out loud.',
        'Concurrency answer depends on where state lives: event loop, JVM locks, or DB/Redis.',
        'A runnable main() demo with one failure path beats a perfect but uncompiled design.',
      ],
      source: 'workat.tech — How to practice for machine coding; Flipkart/Razorpay machine-coding reports (2025)',
    },
    {
      heading: 'Parking Lot (1/3): requirements and a thin HLD for a multi-gate mall',
      body: `**Intuition:** forget the textbook "Level → Spot" toy. The realistic prompt is a **mall in Bengaluru with 3 floors, 4 entry and 4 exit gates, bikes, cars, SUVs/vans and some EV chargers**. Each gate has a kiosk that prints a ticket; exits take UPI/card.

**Functional requirements (confirm these out loud):**
- Issue a ticket at an entry gate, assigning a *specific* spot (or reject when full for that vehicle size).
- Spot assignment prefers the spot **nearest to that gate**, smallest size that fits; EV chargers only to EVs unless the lot is nearly full.
- Compute the fee at exit using **slab pricing** (e.g. car: first 2 h ₹40, then ₹20/h, capped at ₹300 per 24 h; lost ticket = flat ₹500).
- Free the spot on exit; live per-floor availability boards.
- *Out of scope:* reservations ahead of time, number-plate recognition, multiple lots (mention as extension).

**Non-functional:** 8 gates may request concurrently; no two vehicles may get the same spot; fee calculation must be deterministic and auditable (store tariff version on the ticket); a gate kiosk losing network must not lose a ticket (idempotent ticket id generated at the kiosk).

**Thin HLD:**
- \`POST /tickets { gateId, plate, vehicleType, idempotencyKey }\` → \`{ ticketId, spotId, floor }\`
- \`POST /tickets/:id/exit { gateId }\` → \`{ amountPaise, breakdown[] }\` then \`POST /payments\`
- \`GET /floors/:n/availability\` (also pushed to boards)
- **State owner:** the ParkingService. In the machine-coding round it is in memory. In production it is one Postgres table \`spot(id, floor, size, has_charger, occupied_ticket_id)\` — 3,000 rows is tiny; contention is per-gate, not per-row.

**Why this matters for LLD:** the HLD tells you the two things that vary — *how a spot is chosen* and *how a fee is computed* — and those become your two Strategies. It also tells you the concurrency boundary: the claim of a spot must be atomic.`,
      keyPoints: [
        'Pin: gates, vehicle sizes, EV rules, slab tariff, lost ticket, out-of-scope.',
        'Ticket stores tariff version so fees are reproducible after a tariff change.',
        'Two variation points → two Strategies: allocation and pricing.',
        'Kiosk-generated idempotency key prevents duplicate tickets on retries.',
      ],
    },
    {
      heading: 'Parking Lot (2/3): entities, class diagram and why each pattern earns its place',
      body: `**Entities:** \`ParkingLot\` (aggregate root) composes \`Floor[]\`, each composing \`Spot[]\`. \`Gate\` (entry/exit) knows its id; each \`Spot\` carries a precomputed \`distanceTo[gateId]\`. \`Vehicle\` is a *value object* with \`size\` and \`needsCharger\` — no \`Car extends Vehicle\` hierarchy, because vehicle types differ only in data, not behaviour. \`Ticket\` records spot, entry time and \`tariffId\`. \`Receipt\` holds a line-item breakdown.

**Patterns, with the reason you say out loud:**

| Pattern | Where | Why (the variation) |
|---|---|---|
| Strategy | \`AllocationStrategy\` | Nearest-to-gate today; "fill top floor first" during a festival; "VIP reserved" tomorrow |
| Strategy + Composite | \`FeeRule[]\` in a \`Tariff\` | Slabs, daily cap, weekend surcharge, lost ticket compose; adding one is a new class |
| Registry / Factory | \`VehicleProfiles\` map | Adding "e-rickshaw" = one map entry (size + charger), not a subclass |
| Observer | \`SpotEvents\` → display boards, analytics | Boards should not be called from inside allocation code |
| Repository | \`SpotRepository\` | In-memory for the round, Postgres with \`SKIP LOCKED\` in prod |

**Why not inheritance for vehicles?** \`Bike/Car/Truck extends Vehicle\` with an overridden \`canFit()\` spreads the fit rules across N classes; when the mall adds "SUV may use LARGE or two adjacent MEDIUM" you edit every class. Keep rules in one place (the allocation strategy) and vehicles as data.

**SOLID check interviewers look for:** OCP — new tariff rule or vehicle profile without editing \`ParkingService\`; SRP — \`ParkingService\` orchestrates, it does not compute fees; DIP — service depends on \`AllocationStrategy\`/\`SpotRepository\` interfaces, injected via the NestJS module.`,
      diagram: `+-------------+ 1   * +--------+ 1   * +----------------------+
| ParkingLot  |<>-----| Floor  |<>-----| Spot                 |
+-------------+       +--------+       | id, size, hasCharger |
| park()      |                        | distanceTo{gate}     |
| exit()      |                        | occupiedBy?          |
+------+------+                        +----------------------+
       | uses
       +..> AllocationStrategy <<interface>>
       |        ^ NearestFitStrategy   ^ TopFloorFirstStrategy
       +..> Tariff ◇── FeeRule <<interface>>
       |        ^ SlabRule  ^ DailyCapRule  ^ LostTicketRule
       +..> SpotEvents (Observer) ──> FloorBoard, Analytics
       +--> Ticket { id, spotId, plate, entryAt, tariffId }
Vehicle (value object): { plate, size, needsCharger }`,
      keyPoints: [
        'Vehicles are data (size, needsCharger), not a subclass tree.',
        'Allocation and pricing are separate Strategies; tariff rules compose.',
        'Observer decouples boards/analytics from the allocation hot path.',
        'Repository interface lets the in-memory round become Postgres.',
      ],
    },
    {
      heading: 'Parking Lot (3/3): allocation and slab pricing code, concurrency, extensions, 90-min plan',
      body: `**The core:** the allocation strategy filters free spots that fit, keeps chargers for EVs while the lot has headroom, and picks the minimum by (size waste, distance to gate). The fee is a pipeline of rules over an integer-paise amount — never floating rupees.

**Complexity:** a linear scan over 3,000 spots is ~10–30 µs in V8 — fine. At 50K spots (airport) keep per-gate min-heaps per size and lazily discard occupied spots on pop.

**Concurrency:**
- *One Node process:* \`park()\` is synchronous from \`pick\` to \`occupiedBy = …\` — atomic on the event loop. The bug appears when someone inserts \`await repo.save()\` *between* pick and mark: two gates can pick the same spot. Mark first (in memory), persist after, roll back on failure.
- *Many pods:* claim in SQL: \`UPDATE spot SET occupied_ticket_id = $1 WHERE id = (SELECT id FROM spot WHERE size >= $2 AND occupied_ticket_id IS NULL ORDER BY size, dist_gate_3 LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id\`. Gates never wait on each other's locked row.
- *Java expectation:* \`synchronized park()\` is correct but serialises all gates; better a \`ConcurrentHashMap<SpotSize, ConcurrentLinkedQueue<Spot>>\` with \`poll()\` per size, or a \`ReentrantLock\` per floor.

**Extensibility follow-ups:** EV charging billed per kWh → a new \`ChargingRule\` reading meter data on the ticket; surge pricing at 90% occupancy → \`SurgeRule\` with an occupancy provider injected; multiple lots → \`LotId\` on spots and a lot-selection strategy in front; monthly passes → a \`PassRule\` that zeroes parking lines but keeps EV lines.

**90-minute machine-coding version:** build \`ParkingService\` (park/exit/availability), \`NearestFitStrategy\`, \`Tariff\` with 3 rules, in-memory repo, \`main()\` that parks 6 vehicles across 2 gates, shows lot-full for a truck, exits one car after 5h 10m and prints the breakdown. *Stub:* payments (always success), boards (console Observer), persistence. *Graded on:* runs, interfaces at the 2 variation points, money in paise, a clear answer for 2 gates.`,
      code: [
        {
          language: 'typescript',
          title: 'Allocation strategy (nearest-fit, EV-aware) and a composable slab tariff',
          code: `export enum SpotSize { SMALL = 1, MEDIUM = 2, LARGE = 3 }
export interface Vehicle { plate: string; size: SpotSize; needsCharger: boolean }
export interface Spot {
  id: string; floor: number; size: SpotSize; hasCharger: boolean;
  distanceTo: Record<string, number>;          // metres from each gate
  occupiedBy: string | null;                   // ticketId
}

export interface AllocationStrategy {
  pick(v: Vehicle, spots: readonly Spot[], gateId: string, occupancy: number): Spot | undefined;
}

export class NearestFitStrategy implements AllocationStrategy {
  pick(v: Vehicle, spots: readonly Spot[], gateId: string, occupancy: number) {
    const chargersReserved = occupancy < 0.9;  // let non-EVs use chargers only when almost full
    let best: Spot | undefined;
    for (const s of spots) {
      if (s.occupiedBy || s.size < v.size) continue;
      if (v.needsCharger && !s.hasCharger) continue;
      if (!v.needsCharger && s.hasCharger && chargersReserved) continue;
      if (!best || this.score(s, v, gateId) < this.score(best, v, gateId)) best = s;
    }
    return best;
  }
  // waste a size class only if the spot is >40 m closer
  private score(s: Spot, v: Vehicle, gate: string) {
    return (s.size - v.size) * 40 + s.distanceTo[gate];
  }
}

export interface FeeLine { label: string; paise: number }
export interface FeeRule { apply(minutes: number, lines: FeeLine[]): FeeLine[] }

export class SlabRule implements FeeRule {     // first 120 min flat, then per started hour
  constructor(private firstSlabPaise: number, private perHourPaise: number) {}
  apply(minutes: number, lines: FeeLine[]) {
    const extraHours = Math.max(0, Math.ceil((minutes - 120) / 60));
    return [...lines, { label: 'First 2h', paise: this.firstSlabPaise },
      { label: extraHours + 'h extra', paise: extraHours * this.perHourPaise }];
  }
}
export class DailyCapRule implements FeeRule { // cap each 24h block
  constructor(private capPaise: number) {}
  apply(minutes: number, lines: FeeLine[]) {
    const total = lines.reduce((s, l) => s + l.paise, 0);
    const cap = Math.ceil(minutes / 1440) * this.capPaise;
    return total > cap ? [...lines, { label: 'Daily cap', paise: cap - total }] : lines;
  }
}
export class Tariff {
  constructor(readonly id: string, private rules: FeeRule[]) {}
  quote(entry: Date, exit: Date): FeeLine[] {
    const minutes = Math.ceil((exit.getTime() - entry.getTime()) / 60_000);
    return this.rules.reduce<FeeLine[]>((lines, r) => r.apply(minutes, lines), []);
  }
}
// car: new Tariff('CAR-2026-04', [new SlabRule(4000, 2000), new DailyCapRule(30000)])
// 5h10m -> 4000 + 4 x 2000 = 12000 paise (Rs 120)`,
        },
        {
          language: 'typescript',
          title: 'ParkingService: atomic claim on the event loop, Observer after the fact',
          code: `type SpotEvent = { kind: 'OCCUPIED' | 'FREED'; spot: Spot };

export class ParkingService {
  private tickets = new Map<string, { spotId: string; entryAt: Date; tariffId: string }>();
  private listeners: ((e: SpotEvent) => void)[] = [];

  constructor(
    private spots: Spot[],
    private strategy: AllocationStrategy,
    private tariffs: Map<string, Tariff>,      // keyed by tariff id, chosen by size
    private tariffFor: (size: SpotSize) => string,
    private repo: { saveTicket(id: string, spotId: string): Promise<void> },
  ) {}

  onSpotEvent(fn: (e: SpotEvent) => void) { this.listeners.push(fn); }

  async park(v: Vehicle, gateId: string, ticketId: string) {
    if (this.tickets.has(ticketId)) return this.tickets.get(ticketId)!; // idempotent retry
    const occupancy = this.spots.filter((s) => s.occupiedBy).length / this.spots.length;
    // ---- critical section: no await between pick and mark ----
    const spot = this.strategy.pick(v, this.spots, gateId, occupancy);
    if (!spot) throw new Error('NO_SPOT_FOR_SIZE_' + SpotSize[v.size]);
    spot.occupiedBy = ticketId;
    const t = { spotId: spot.id, entryAt: new Date(), tariffId: this.tariffFor(v.size) };
    this.tickets.set(ticketId, t);
    // ---- end critical section ----
    try {
      await this.repo.saveTicket(ticketId, spot.id);
    } catch (e) {
      spot.occupiedBy = null;                  // compensate: release the claim
      this.tickets.delete(ticketId);
      throw e;
    }
    this.listeners.forEach((fn) => fn({ kind: 'OCCUPIED', spot }));
    return t;
  }

  exit(ticketId: string, at = new Date()) {
    const t = this.tickets.get(ticketId);
    if (!t) throw new Error('UNKNOWN_TICKET');
    const lines = this.tariffs.get(t.tariffId)!.quote(t.entryAt, at);
    const spot = this.spots.find((s) => s.id === t.spotId)!;
    spot.occupiedBy = null;
    this.tickets.delete(ticketId);
    this.listeners.forEach((fn) => fn({ kind: 'FREED', spot }));
    return { lines, totalPaise: lines.reduce((s, l) => s + l.paise, 0) };
  }
}`,
        },
      ],
      keyPoints: [
        'Score = size waste × weight + distance; tune the weight, do not add if/else.',
        'Fees are a rule pipeline over integer paise; the ticket pins the tariff version.',
        'No await between pick and mark; compensate if persistence fails.',
        'Multi-pod: FOR UPDATE SKIP LOCKED or conditional UPDATE is the real lock.',
      ],
    },
    {
      heading: 'Elevator (1/3): requirements, hall vs cab calls and the dispatcher HLD',
      body: `**Intuition:** an elevator bank is a tiny real-time scheduler. People on floors press ▲/▼ (they say *where they are and which way*), people inside press a number (they say *where they go*). The single most important modelling decision is to keep those two kinds of request separate.

**Functional requirements:**
- A building with N floors (say 0–39) and K cars (say 6). Hall calls: \`(floor, UP|DOWN)\`. Cab calls: \`(carId, floor)\`.
- A **dispatcher** assigns each hall call to one car; each car serves its own stops with a **LOOK** sweep.
- Doors open/close with a dwell time; display shows floor and direction.
- Modes: normal, maintenance (car taken out of service), fire (all cars return to ground floor and ignore hall calls), overload (doors stay open).
- *Out of scope:* destination-dispatch kiosks, energy optimisation, double-deck cars (mention as extensions).

**Non-functional:** hall calls must never be lost (a car going into maintenance must hand its hall calls back), no car may be commanded by two writers at once, average wait time is the metric the scheduler optimises.

**Thin HLD (inside one controller box):**
- \`HallButtonPanel\` and \`CabPanel\` → \`ElevatorController.submit(request)\` (a command queue).
- \`Dispatcher\` (Strategy) scores cars for a hall call; \`Car\` holds a \`LookScheduler\` and an \`ElevatorState\`.
- A **tick loop** (every 100 ms simulated, real hardware would push sensor events) advances each car.
- **State owner:** the controller process — a single writer. Hardware sensors and buttons only *enqueue* events.

**Why hall vs cab separation matters:** a cab call belongs to that car forever. A hall call belongs to the bank and can be **reassigned** — when a car goes to maintenance or gets stuck, its hall calls go back to the dispatcher, but its passengers' cab calls die with it (they are inside).`,
      diagram: `  Floor panels (▲/▼)        Cab panels (0..39)
        │ HallCall(f, dir)          │ CabCall(car, f)
        ▼                           ▼
  ┌────────────────────────────────────────────┐
  │ ElevatorController  (single-writer queue)  │
  │   Dispatcher <<Strategy>> ── picks a car   │
  │   ┌──────────┐ ┌──────────┐ ┌──────────┐   │
  │   │ Car 1    │ │ Car 2    │ │ Car 6    │   │
  │   │ LOOK set │ │ LOOK set │ │ LOOK set │   │
  │   │ State    │ │ State    │ │ State    │   │
  │   └────┬─────┘ └────┬─────┘ └────┬─────┘   │
  └────────┼────────────┼────────────┼─────────┘
           ▼ motor/door commands, sensor events back into queue`,
      keyPoints: [
        'Hall call = (floor, direction), owned by the bank, reassignable.',
        'Cab call = (car, floor), owned by one car, dies with it.',
        'One controller is the single writer; sensors and buttons only enqueue.',
        'Modes (maintenance, fire, overload) are first-class requirements.',
      ],
    },
    {
      heading: 'Elevator (2/3): entities, State for the car lifecycle, Strategy for dispatch',
      body: `**Entities:** \`ElevatorController\` composes \`Car[]\` and a \`Dispatcher\`. \`Car\` has \`floor\`, \`direction\`, \`load\`, a \`LookScheduler\` (its stops) and a current \`ElevatorState\`. \`Request\` is a discriminated union: \`{ kind: 'HALL', floor, dir }\` | \`{ kind: 'CAB', carId, floor }\`. \`Door\` and \`Display\` are tiny collaborators notified via Observer.

**Why State and not an enum + switch?** A car's legal actions depend on its mode: in \`DoorsOpen\` you cannot move; in \`Maintenance\` you ignore hall calls but accept a technician's commands; in \`FireRecall\` you ignore everything except "go to ground". With an enum, every method grows a \`switch (this.mode)\` and every new mode edits every method (OCP violation, and the classic bug: someone forgets the \`DoorsOpen\` branch in \`move()\` and the car moves with doors open). With State, each mode is a class implementing \`onTick\`, \`onRequest\`, \`onDoorSensor\`; illegal transitions are simply not implemented.

**Why Strategy for dispatch?** The cost function is the business knob: *nearest car* is fine for a 10-floor residential tower; office towers at 9 a.m. want *zoning* (cars 1–3 serve 0–20, 4–6 serve 20–39) and a penalty for cars that must reverse. Swapping \`NearestCarStrategy\` for \`ZonedUpPeakStrategy\` at 08:30 is a config change, not a code change.

**SCAN vs LOOK vs nearest-request (SSTF):**

| Algorithm | Behaviour | Problem |
|---|---|---|
| FCFS | serve in arrival order | zig-zags, terrible throughput |
| SSTF (nearest stop) | always go to closest stop | starvation of far floors |
| SCAN | sweep to the physical end, reverse | wastes trips to empty top/bottom floors |
| **LOOK** | sweep until the last request in that direction, reverse | default answer; bounded wait, no wasted travel |

**Direction-aware stopping:** a car moving UP stops for cab calls and UP hall calls ahead; it *passes* a DOWN hall call at floor 25 — unless 25 is the highest request, in which case 25 is its turnaround and it serves the DOWN call there.`,
      diagram: `+---------------------+ 1   * +--------------------------+
| ElevatorController  |<>-----| Car                      |
+---------------------+       | floor, direction, load   |
| submit(Request)     |       | state: ElevatorState ----+--> <<interface>>
| tick()              |       | stops: LookScheduler     |     ElevatorState
+----------+----------+       +--------------------------+       ^ Idle
           | uses                                                ^ Moving
           +..> Dispatcher <<interface>>                         ^ DoorsOpen
                  ^ NearestCarStrategy                           ^ Maintenance
                  ^ ZonedUpPeakStrategy                          ^ FireRecall
Request = HallCall{floor,dir} | CabCall{carId,floor}`,
      keyPoints: [
        'State removes switch-on-mode from every method and blocks illegal moves.',
        'Dispatch cost is a Strategy: nearest for residential, zoning for office up-peak.',
        'LOOK is the default; SSTF starves, SCAN wastes travel.',
        'A car going UP passes DOWN hall calls unless that floor is its turnaround.',
      ],
      source: 'GoF Design Patterns — State, Strategy; AlgoMaster / techinterview.org elevator LLD (2025)',
    },
    {
      heading: 'Elevator (3/3): LOOK scheduler and State code, single-writer concurrency, 90-min plan',
      body: `**The core:** each car owns three sets — cab stops, UP hall stops, DOWN hall stops. On every floor it asks the scheduler "should I stop here given my direction?" and after serving it asks "which way next?". The logic below was verified with a simulation: a car idle at floor 3 with requests {cab 7, hall 5▼, hall 4▲, hall 1▲, hall 9▼} stops at **4, 7, 9, 5, 1** — it skips 5▼ on the way up, turns at 9 (the last request, not floor 39) and picks up 1▲ as its downward turnaround.

**Concurrency — the single-writer rule:** buttons, door sensors and the tick timer all *enqueue* commands; one loop drains the queue and mutates cars. In Node that loop is naturally single-threaded, so as long as \`submit\` never mutates a car directly and \`tick\` never awaits mid-mutation, there are no races. The classic bug is an \`async assignHallCall()\` that awaits a Redis read of car positions and then assigns — two hall calls both see car 2 idle and both get it, and meanwhile the tick moved car 2. In Java you would model each car as an actor on its own thread with a \`BlockingQueue<Command>\`, or guard the bank with one \`ReentrantLock\`; \`synchronized\` on each car is not enough because the dispatcher reads *all* cars to choose.

**Stuck/faulty car:** the \`MovingState\` tracks "floor not changed for > 3 ticks while motor on" → transition to \`Maintenance\`, **return its hall calls to the dispatcher** for reassignment, raise an alarm; cab calls are dropped (passengers are inside and need the intercom, not another car).

**Extensibility:** VIP/service car → a \`Dispatcher\` decorator that excludes car 6 from normal calls; destination dispatch (passengers type the floor in the lobby) → a new \`Request\` kind and a dispatcher that groups by destination; multiple buildings → a controller per bank, nothing shared.

**90-minute machine-coding version:** build \`Car\` with \`LookScheduler\` and 3 states (Idle, Moving, DoorsOpen), \`NearestCarStrategy\`, a controller with a command queue and \`tick()\`, and a \`main()\` that submits 6 calls at different ticks and prints a timeline per car. *Stub:* motors and door hardware (state transitions only), Maintenance as a flag-driven state if time permits. *Graded on:* LOOK correctness on the demo, no race between submit and tick, adding a new state touches one class.`,
      code: [
        {
          language: 'typescript',
          title: 'LookScheduler: direction-aware stops and LOOK turnaround (simulation-verified)',
          code: `export type Dir = 'UP' | 'DOWN' | 'IDLE';
export type Request =
  | { kind: 'HALL'; floor: number; dir: 'UP' | 'DOWN' }
  | { kind: 'CAB'; carId: string; floor: number };

export class LookScheduler {
  private cab = new Set<number>();
  private up = new Set<number>();
  private down = new Set<number>();

  add(r: Request) {
    if (r.kind === 'CAB') this.cab.add(r.floor);
    else (r.dir === 'UP' ? this.up : this.down).add(r.floor);
  }
  private all() { return [...this.cab, ...this.up, ...this.down]; }
  isEmpty() { return this.all().length === 0; }
  hasAny(f: number) { return this.cab.has(f) || this.up.has(f) || this.down.has(f); }
  private anyBeyond(f: number, dir: 'UP' | 'DOWN') {
    return this.all().some((x) => (dir === 'UP' ? x > f : x < f));
  }

  shouldStop(floor: number, dir: Dir): boolean {
    if (dir === 'IDLE') return this.hasAny(floor);
    if (this.cab.has(floor)) return true;
    if ((dir === 'UP' ? this.up : this.down).has(floor)) return true;
    // LOOK turnaround: nothing further this way, so serve the opposite hall call here
    return !this.anyBeyond(floor, dir) && this.hasAny(floor);
  }

  served(floor: number, dir: Dir) {
    this.cab.delete(floor);
    if (dir !== 'DOWN') this.up.delete(floor);
    if (dir !== 'UP') this.down.delete(floor);
    if (dir !== 'IDLE' && !this.anyBeyond(floor, dir)) { this.up.delete(floor); this.down.delete(floor); }
  }

  nextDirection(cur: number, dir: Dir): Dir {
    if (this.isEmpty()) return 'IDLE';
    if (dir !== 'IDLE' && this.anyBeyond(cur, dir)) return dir;      // keep sweeping
    if (dir === 'UP' && this.anyBeyond(cur, 'DOWN')) return 'DOWN';  // reverse at last request
    if (dir === 'DOWN' && this.anyBeyond(cur, 'UP')) return 'UP';
    const nearest = this.all().reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a));
    return nearest > cur ? 'UP' : nearest < cur ? 'DOWN' : 'IDLE';
  }
}`,
        },
        {
          language: 'typescript',
          title: 'State pattern for the car + a single-writer controller loop',
          code: `interface ElevatorState {
  readonly name: string;
  onTick(car: Car): void;
  acceptsHallCalls(): boolean;
}

class IdleState implements ElevatorState {
  readonly name = 'IDLE';
  acceptsHallCalls() { return true; }
  onTick(car: Car) {
    if (car.stops.shouldStop(car.floor, 'IDLE')) return car.open();
    const d = car.stops.nextDirection(car.floor, 'IDLE');
    if (d !== 'IDLE') { car.direction = d; car.setState(new MovingState()); }
  }
}
class MovingState implements ElevatorState {
  readonly name = 'MOVING';
  private stuckTicks = 0;
  acceptsHallCalls() { return true; }
  onTick(car: Car) {
    const before = car.floor;
    car.floor += car.direction === 'UP' ? 1 : -1;              // hardware: motor command + sensor
    this.stuckTicks = car.floor === before ? this.stuckTicks + 1 : 0;
    if (this.stuckTicks > 3) return car.setState(new MaintenanceState());
    if (car.stops.shouldStop(car.floor, car.direction)) car.open();
  }
}
class DoorsOpenState implements ElevatorState {
  readonly name = 'DOORS_OPEN';
  private dwell = 3;                                           // ticks
  acceptsHallCalls() { return true; }
  onTick(car: Car) {
    if (--this.dwell > 0 || car.overloaded) return;            // overload keeps doors open
    const d = car.stops.nextDirection(car.floor, car.direction);
    car.direction = d;
    car.setState(d === 'IDLE' ? new IdleState() : new MovingState());
  }
}
class MaintenanceState implements ElevatorState {
  readonly name = 'MAINTENANCE';
  acceptsHallCalls() { return false; }
  onTick() { /* only a technician command leaves this state */ }
}

export class Car {
  floor = 0; direction: Dir = 'IDLE'; overloaded = false;
  stops = new LookScheduler();
  private state: ElevatorState = new IdleState();
  constructor(readonly id: string, private onEvict: (car: Car) => void) {}
  setState(s: ElevatorState) {
    this.state = s;
    if (!s.acceptsHallCalls()) this.onEvict(this);             // hand hall calls back
  }
  open() { this.stops.served(this.floor, this.direction); this.setState(new DoorsOpenState()); }
  tick() { this.state.onTick(this); }
  get stateName() { return this.state.name; }
}

export class ElevatorController {
  private inbox: Request[] = [];                               // buttons only enqueue
  constructor(private cars: Car[], private dispatch: (r: Request, cars: Car[]) => Car) {}
  submit(r: Request) { this.inbox.push(r); }
  tick() {                                                     // the ONLY mutator: no awaits inside
    for (const r of this.inbox.splice(0)) {
      const car = r.kind === 'CAB' ? this.cars.find((c) => c.id === r.carId)! : this.dispatch(r, this.cars);
      car.stops.add(r);
    }
    this.cars.forEach((c) => c.tick());
  }
}`,
        },
      ],
      keyPoints: [
        'Verified LOOK order for the demo: 4, 7, 9, 5, 1 from floor 3.',
        'Buttons enqueue, one loop mutates: no locks needed in Node.',
        'Stuck detection lives in MovingState; eviction returns hall calls to the bank.',
        'Java: actor per car with BlockingQueue or one bank-level ReentrantLock.',
      ],
    },
    {
      heading: 'BookMyShow (1/3): requirements and the HLD slice that the LLD must serve',
      body: `**Intuition:** the HLD version (waiting rooms, Redis Lua holds, 67K QPS seat maps) lives in the commerce designs topic. Here the interviewer wants the **classes** — how a seat in a specific show is modelled, who owns a hold, what object enforces "no double booking", and how you would swap an in-memory lock for a distributed one without touching the booking service.

**Functional requirements (machine-coding scope):**
- Cities → Cinemas → Screens (with a seat layout: rows, seat categories RECLINER/PRIME/CLASSIC).
- Movies and Shows (screen + start time + per-category price).
- View available seats for a show; **hold** up to 10 seats for 10 minutes; confirm after payment; cancel/expire.
- *Out of scope in 90 min:* search, reviews, offers engine (mention a \`PricingStrategy\` hook), notifications.

**Non-functional:** a seat in a show is sold at most once even with many app pods; holds expire without a cron job being correct; a payment callback that arrives after expiry must not silently book.

**Thin HLD for the LLD:**
- \`GET /shows/:id/seats\` → seat map with status AVAILABLE / HELD / BOOKED.
- \`POST /shows/:id/holds { seatIds, userId }\` → \`{ holdId, expiresAt }\` (all-or-nothing)
- \`POST /holds/:holdId/confirm { paymentRef }\` → \`Booking\`
- **Where state lives:** the *physical* \`Seat\` is static master data. The per-show status lives in \`ShowSeat\`. Holds live behind a \`SeatLockProvider\` — memory in the round, Redis in prod — and the final truth is a Postgres \`booking_seat\` row with \`UNIQUE(show_id, seat_id)\`.

**Key modelling decision:** never put \`status\` on \`Seat\`. Seat A7 in Screen 2 exists for every show; its availability is a property of *(show, seat)*. Candidates who put \`isBooked\` on \`Seat\` fail the first follow-up ("A7 is booked for the 6 pm show; is it free at 9 pm?").`,
      keyPoints: [
        'Physical Seat is master data; ShowSeat holds per-show status.',
        'Holds are behind a SeatLockProvider interface — in-memory or Redis.',
        'Final guard is a unique (show, seat) row in the database.',
        'Late payment after hold expiry is a requirement, not an edge case.',
      ],
    },
    {
      heading: 'BookMyShow (2/3): entities, class diagram and the lock-provider seam',
      body: `**Entities:** \`Cinema\` ◇— \`Screen\` ◇— \`Seat(row, number, category)\`. \`Movie\` and \`Show(screen, movie, startsAt, prices: Map<Category, paise>)\`. \`ShowSeat\` is computed or persisted per show. \`Hold(holdId, showId, seatIds, userId, expiresAt)\`. \`Booking(bookingId, holdId, showId, seatIds, amountPaise, status)\` with a lifecycle **PENDING_PAYMENT → CONFIRMED | EXPIRED | CANCELLED | REFUNDED** (State or a guarded transition table).

**Services:** \`ShowService\` (seat map), \`BookingService\` (hold → confirm → cancel), \`PaymentGateway\` (interface, stub), \`SeatLockProvider\` (interface).

**Patterns and why:**
- **Strategy / Adapter — \`SeatLockProvider\`:** \`InMemorySeatLockProvider\` for the round and unit tests; \`RedisSeatLockProvider\` in prod. BookingService does not know which. This is the single most valued seam in this problem.
- **State (or a transition map) for \`Booking\`:** prevents CONFIRMED → PENDING after a duplicate webhook.
- **Strategy for pricing:** weekday/weekend, category, convenience fee; offers are decorators on the base price.
- **Observer:** confirmed bookings → ticket email/SMS, analytics, loyalty points — outside the critical path.
- **Facade:** \`BookingService\` is the facade the controller calls; it orchestrates lock provider, repo and payments.

**Why all-or-nothing holds?** A family of four selecting A5–A8 does not want A5–A7. If you lock seat by seat and stop at the first conflict, you must release the ones you already took — or you leak holds. The provider takes the whole set or nothing.

**Ordering detail that prevents deadlocks:** if your provider uses per-seat mutexes (Java \`ReentrantLock\` per seat), acquire them in **sorted seat-id order**; two users grabbing {A5, A6} and {A6, A5} otherwise deadlock.`,
      diagram: `+--------+ 1  * +--------+ 1  * +-----------------------+
| Cinema |<>----| Screen |<>----| Seat(row,no,category) |
+--------+      +---+----+      +-----------------------+
                    | 1
                    | *
+--------+ 1  * +---+----------------------+
| Movie  |------| Show(startsAt, prices)   |
+--------+      +---+----------------------+
                    | 1                *
                    +------------- ShowSeat(status)
BookingService (Facade) ──uses──> SeatLockProvider <<interface>>
     |                              ^ InMemorySeatLockProvider
     |                              ^ RedisSeatLockProvider
     +──> BookingRepository ──> Booking(state: PENDING→CONFIRMED|EXPIRED)
     +──> PaymentGateway <<interface>>   +──> BookingEvents (Observer)`,
      keyPoints: [
        'SeatLockProvider is the seam that lets one design scale from 1 to N pods.',
        'Booking has an explicit lifecycle; illegal transitions are rejected.',
        'Holds are all-or-nothing; per-seat locks are taken in sorted order.',
        'Pricing and notifications hang off Strategy and Observer, not BookingService.',
      ],
    },
    {
      heading: 'BookMyShow (3/3): TTL hold code, double-booking across pods, 90-min plan',
      body: `**The core:** an in-memory provider with lazy expiry (no timer needed to be correct), owner-checked release, and all-or-nothing acquisition. Then the confirmation path that stays correct even when the lock layer is wrong.

**Defence in depth across pods:**
1. **Hold layer (fast, probabilistic):** Redis keys per (show, seat) with a TTL. Prevents 99.9% of collisions cheaply.
2. **Durable layer (authoritative):** the confirm transaction inserts \`booking_seat(show_id, seat_id, booking_id)\` with \`UNIQUE(show_id, seat_id)\`. If the hold layer ever lies (Redis failover lost a key, clock skew, a GC pause past TTL), the second insert fails with a unique violation and that user is refunded. Two people can never both hold a *confirmed* A7.
3. **Fencing on confirm:** confirm only if \`hold_id\` still owns the booking and \`hold_expires_at > now()\` *in the DB clock* — not the app pod's clock.

**Late payment after expiry:** the PSP says "paid" at minute 11. Options in order: try to re-acquire the same seats (often still free) → confirm; else auto-refund and tell the user. Never overwrite another user's hold.

**Java expectation:** \`ConcurrentHashMap<String, Hold>\` with \`compute()\` per seat key gives per-key atomicity but *not* multi-seat atomicity — say "I take a \`ReentrantLock\` per show (fine: one show ≈ 200–400 seats and low per-show QPS in the round) or per-seat locks in sorted order".

**Extensibility:** seat categories with dynamic pricing → \`PricingStrategy\`; group booking with "best available N together" → a \`SeatSelectionStrategy\` (contiguous-row search); waitlist → Observer on EXPIRED holds that offers seats to the queue.

**90-minute machine-coding version:** build master data loader, \`ShowService.availableSeats\`, \`BookingService.hold/confirm/cancel\`, \`InMemorySeatLockProvider\` with an injectable clock, booking state transitions, and a \`main()\` where user U1 holds A5–A6, U2 tries A6–A7 (fails), clock advances 11 minutes, U2 retries (succeeds), U1's late confirm is rejected. *Stub:* payment, pricing, notifications. *Graded on:* ShowSeat vs Seat modelling, the lock interface, the injectable clock for TTL tests.`,
      code: [
        {
          language: 'typescript',
          title: 'SeatLockProvider: all-or-nothing, owner-checked, lazily expiring holds',
          code: `export interface Clock { now(): number }
export interface SeatLockProvider {
  acquire(showId: string, seatIds: string[], holdId: string, ttlMs: number): Promise<boolean>;
  validate(showId: string, seatIds: string[], holdId: string): Promise<boolean>;
  release(showId: string, seatIds: string[], holdId: string): Promise<void>;
}

type Lease = { holdId: string; expiresAt: number };

export class InMemorySeatLockProvider implements SeatLockProvider {
  private leases = new Map<string, Lease>();                  // key: showId + ':' + seatId
  constructor(private clock: Clock) {}

  private live(key: string): Lease | undefined {
    const l = this.leases.get(key);
    if (l && l.expiresAt <= this.clock.now()) { this.leases.delete(key); return undefined; } // lazy expiry
    return l;
  }

  async acquire(showId: string, seatIds: string[], holdId: string, ttlMs: number) {
    const keys = [...new Set(seatIds)].sort().map((s) => showId + ':' + s);
    // phase 1: check every seat (synchronous => atomic on the event loop)
    for (const k of keys) {
      const l = this.live(k);
      if (l && l.holdId !== holdId) return false;              // someone else owns it
    }
    // phase 2: take all; same holdId re-acquire extends the lease (idempotent retry)
    const expiresAt = this.clock.now() + ttlMs;
    for (const k of keys) this.leases.set(k, { holdId, expiresAt });
    return true;
  }

  async validate(showId: string, seatIds: string[], holdId: string) {
    return seatIds.every((s) => this.live(showId + ':' + s)?.holdId === holdId);
  }

  async release(showId: string, seatIds: string[], holdId: string) {
    for (const s of seatIds) {
      const k = showId + ':' + s;
      if (this.live(k)?.holdId === holdId) this.leases.delete(k); // never delete another user's lease
    }
  }
}`,
        },
        {
          language: 'typescript',
          title: 'Confirm path: lock validation is advisory, the DB constraint is the truth',
          code: `// booking_seat has UNIQUE (show_id, seat_id); booking.hold_expires_at set at hold time
export class BookingService {
  constructor(private locks: SeatLockProvider, private db: { query: (sql: string, p: unknown[]) => Promise<{ rowCount: number }> },
              private payments: { refund(ref: string): Promise<void> }) {}

  async confirm(bookingId: string, holdId: string, showId: string, seatIds: string[], paymentRef: string) {
    if (!(await this.locks.validate(showId, seatIds, holdId))) {
      // hold gone: try to re-take the same seats before refunding (often still free)
      const retaken = await this.locks.acquire(showId, seatIds, holdId, 60_000);
      if (!retaken) { await this.payments.refund(paymentRef); throw new Error('HOLD_EXPIRED_REFUNDED'); }
    }
    try {
      await this.db.query('BEGIN', []);
      const upd = await this.db.query(
        "UPDATE booking SET status = 'CONFIRMED', payment_ref = $3 " +
        "WHERE id = $1 AND hold_id = $2 AND status = 'PENDING_PAYMENT'", // fencing: only this hold, only once
        [bookingId, holdId, paymentRef]);
      if (upd.rowCount !== 1) throw new Error('NOT_PENDING');          // duplicate webhook or cancelled
      for (const seat of seatIds) {
        await this.db.query(
          'INSERT INTO booking_seat (show_id, seat_id, booking_id) VALUES ($1, $2, $3)',
          [showId, seat, bookingId]);                                 // unique violation => double booking blocked
      }
      await this.db.query('COMMIT', []);
    } catch (e) {
      await this.db.query('ROLLBACK', []);
      if ((e as { code?: string }).code === '23505') await this.payments.refund(paymentRef);
      throw e;
    }
    await this.locks.release(showId, seatIds, holdId);
  }
}`,
        },
      ],
      keyPoints: [
        'Lazy expiry on read makes the TTL correct even if a sweeper never runs.',
        'Re-acquire with the same holdId extends; release is owner-checked.',
        'UNIQUE(show_id, seat_id) is the cross-pod guarantee; Redis is an optimisation.',
        'Late payment: re-take seats if free, otherwise refund — never overwrite.',
      ],
    },
    {
      heading: 'Splitwise (1/3): requirements and HLD — the ledger is truth, balances are a view',
      body: `**Intuition:** Splitwise looks like CRUD, but it is a tiny accounting system. Every expense is an immutable ledger entry; "who owes whom" is a *derived* view; "simplify debts" is a graph optimisation over that view. Interviewers at Flipkart, Groww, Acko and Uber (reported 2025) go straight for split rounding and the minimise-transactions algorithm.

**Functional requirements:**
- Users and groups; add an expense paid by one (or several) payers, split EQUAL / EXACT / PERCENT / SHARES among participants.
- Show a user's balance with each person, within a group and overall.
- Record a settlement (A paid B ₹500 in cash/UPI).
- **Simplify debts** for a group: output the minimum (or near-minimum) set of payments.
- *Out of scope:* multi-currency (mention), receipts OCR, recurring expenses.

**Non-functional:** money must never be lost or created by rounding (₹1000 split 3 ways must sum to exactly ₹1000); edits and deletes must be auditable; balances must be reproducible from the ledger at any time.

**Thin HLD:**
- \`POST /groups/:id/expenses { paidBy: [{userId, paise}], split: { type, entries } , idempotencyKey }\`
- \`GET /users/:id/balances?groupId=\`; \`POST /groups/:id/settlements\`; \`GET /groups/:id/simplified\`
- **Where state lives:** \`expense\` + \`expense_share\` tables are the ledger (append-only; an edit is a new version, a delete is a reversal). \`balance(group_id, from, to, paise)\` is a cache/denormalised projection updated in the *same transaction* as the ledger insert, or rebuilt from the ledger.

**Design decision to say out loud:** store **net balance per user per group** (one number per user) for simplification, and pairwise balances for the UI. Net balances sum to zero; that invariant is your best unit test.`,
      keyPoints: [
        'Expense ledger is append-only truth; balances are a projection.',
        'Integer paise everywhere; splits must sum exactly to the total.',
        'Net balances per group sum to zero — assert it in tests.',
        'Simplify-debts is the algorithmic heart and the usual follow-up.',
      ],
      source: 'workat.tech — How to design Splitwise (machine coding); LeetCode Discuss Groww/Acko/Uber 2025 reports',
    },
    {
      heading: 'Splitwise (2/3): entities, Split strategies and the class diagram',
      body: `**Entities:** \`User\`, \`Group\` (members), \`Expense(id, groupId, payers: Payment[], shares: Share[], version, createdBy)\`, \`Share(userId, paise)\`, \`Settlement(from, to, paise)\`. \`BalanceSheet\` maintains \`net: Map<userId, paise>\` per group (positive = is owed). \`ExpenseService\` validates and records; \`DebtSimplifier\` (Strategy) produces transfers.

**Split types are a Strategy, created by a Factory.** Each type has different input and different validation:

| Split | Input | Validation | Distribution |
|---|---|---|---|
| EQUAL | participants | ≥ 1 participant | floor(total/n), remainder 1 paisa each to the first r |
| EXACT | paise per user | sum == total | as given |
| PERCENT | basis points per user | sum == 10,000 | floor, then largest-remainder |
| SHARES | integer weights | all > 0 | proportional floor + largest-remainder |

A \`switch(type)\` inside \`addExpense\` works for EQUAL/EXACT, then PERCENT adds validation branches and SHARES adds a third; that is the OCP violation the interviewer is waiting for. With \`SplitStrategy\` + a \`SplitFactory\` registry, "add SHARES" is one class and one registry line.

**Why Strategy for simplification too?** \`GreedySimplifier\` (fast, ≤ n−1 transfers) for big groups, \`ExactSimplifier\` (bitmask DP, optimal) for ≤ ~15–20 members, \`NoSimplify\` when the group setting is off. Same interface, chosen per group.

**Observer:** expense added → notify participants, update activity feed; not inside the transaction.`,
      diagram: `+-------+ *   * +--------+ 1    * +-----------------------------+
| User  |-------| Group  |<>-------| Expense                     |
+-------+       +---+----+         | payers: Payment[]            |
                    | 1            | shares: Share[]  version     |
                    v              +--------------+--------------+
               BalanceSheet                       | built by
               net{user: paise}     SplitStrategy <<interface>>
                    |                 ^ Equal ^ Exact ^ Percent ^ Shares
                    | uses            (SplitFactory registry)
                    v
           DebtSimplifier <<interface>>
             ^ GreedySimplifier  ^ ExactSimplifier  ^ NoSimplify
ExpenseService ..> SplitFactory, BalanceSheet, ExpenseRepository, Events`,
      keyPoints: [
        'Split type = Strategy + Factory registry; new type is one class.',
        'Each split validates its own input and distributes the remainder.',
        'Simplifier is also a Strategy: greedy vs exact vs off.',
        'Notifications are Observer, outside the money transaction.',
      ],
    },
    {
      heading: 'Splitwise (3/3): exact splits, greedy vs optimal simplification, concurrency, 90-min plan',
      body: `**Splits that always sum:** ₹1000.00 = 100,000 paise among 3 → 33,334 + 33,333 + 33,333. Percent 33.33/33.33/33.34 → 33,330 + 33,330 + 33,340. Both verified by running the code.

**Greedy simplification:** settle the largest debtor against the largest creditor, repeat. At most n−1 transfers, O(n log n) with heaps. **It is not optimal.** Verified counterexample (₹): A +300, B +400, C −200, D −200, E −300. Greedy: E→B 300, C→A 200, D→A 100, D→B 100 = **4** transfers. Optimal: E→A 300, C→B 200, D→B 200 = **3**, because {A, E} and {B, C, D} are independent zero-sum subgroups.

**Exact minimum:** min transfers = (non-zero users) − (max number of disjoint zero-sum subsets). Finding it is NP-hard (it contains subset-sum), so use bitmask DP: \`dp[mask] = max over i in mask of dp[mask without i]\` plus 1 if \`sum[mask] == 0\`. O(2ⁿ·n): 20 people ≈ 21M steps (tens of ms in Node); 30 people ≈ 32 billion — infeasible, fall back to greedy. Real Splitwise groups rarely exceed 10–15 active debtors.

**Concurrency:**
- Two members add expenses simultaneously → both insert ledger rows (no conflict); the balance projection must use atomic increments (\`UPDATE balance SET paise = paise + $1\`) in the same transaction, never read-modify-write in app code.
- Two members *edit the same expense* → optimistic concurrency on \`expense.version\`; the loser gets 409 and re-reads.
- Retries from a flaky mobile network → idempotency key on \`POST /expenses\`.
- Java: \`ConcurrentHashMap.merge(user, delta, Long::sum)\` for in-memory net balances; \`AtomicLong\` is not enough when two maps must change together.

**Extensibility:** multi-currency (store currency per expense; simplify per currency or convert at a pinned rate); multiple payers (payers[] already modelled); recurring expenses (scheduler emits normal expenses).

**90-minute machine-coding version:** build users/groups, \`ExpenseService.add\` with EQUAL/EXACT/PERCENT strategies, \`BalanceSheet\`, \`showBalances(user)\`, \`GreedySimplifier\`, command-style \`main()\` (\`EXPENSE u1 1000 3 u1 u2 u3 EQUAL\`, \`SHOW u2\`). *Stub:* persistence, notifications, exact DP (talk about it). *Graded on:* paise correctness, validation errors, OCP for split types, net-sum-zero assertion.`,
      code: [
        {
          language: 'typescript',
          title: 'Split strategies with exact remainder distribution',
          code: `export interface Share { userId: string; paise: number }
export interface SplitStrategy { split(totalPaise: number, input: Map<string, number>): Share[] }

export class EqualSplit implements SplitStrategy {        // input: userId -> ignored
  split(total: number, input: Map<string, number>) {
    const users = [...input.keys()];
    if (!users.length) throw new Error('NO_PARTICIPANTS');
    const base = Math.floor(total / users.length);
    const rem = total - base * users.length;               // 0..n-1 paise left over
    return users.map((userId, i) => ({ userId, paise: base + (i < rem ? 1 : 0) }));
  }
}

export class ExactSplit implements SplitStrategy {        // input: userId -> paise
  split(total: number, input: Map<string, number>) {
    const sum = [...input.values()].reduce((a, b) => a + b, 0);
    if (sum !== total) throw new Error('EXACT_SUM_MISMATCH ' + sum + ' != ' + total);
    return [...input].map(([userId, paise]) => ({ userId, paise }));
  }
}

// Shared by PERCENT (weights = basis points, must sum to 10,000) and SHARES (any weights)
export class WeightedSplit implements SplitStrategy {
  constructor(private requiredSum?: number) {}
  split(total: number, weights: Map<string, number>) {
    const w = [...weights.values()].reduce((a, b) => a + b, 0);
    if (w <= 0 || (this.requiredSum !== undefined && w !== this.requiredSum)) throw new Error('BAD_WEIGHTS');
    const parts = [...weights].map(([userId, wt]) => {
      const exact = (total * wt) / w;
      return { userId, paise: Math.floor(exact), frac: exact - Math.floor(exact) };
    });
    let rem = total - parts.reduce((s, p) => s + p.paise, 0);
    [...parts].sort((a, b) => b.frac - a.frac).forEach((p) => { if (rem-- > 0) p.paise++; }); // largest remainder
    return parts.map(({ userId, paise }) => ({ userId, paise }));
  }
}

export const SplitFactory = new Map<string, SplitStrategy>([
  ['EQUAL', new EqualSplit()],
  ['EXACT', new ExactSplit()],
  ['PERCENT', new WeightedSplit(10_000)],
  ['SHARES', new WeightedSplit()],                          // adding a type = one line here
]);`,
        },
        {
          language: 'typescript',
          title: 'Debt simplification: greedy (≤ n−1) and exact bitmask DP (verified with node)',
          code: `export type Transfer = { from: string; to: string; paise: number };

// Greedy: largest debtor pays largest creditor. Fast, not always minimal.
export function simplifyGreedy(net: Map<string, number>): Transfer[] {
  const cred = [...net].filter(([, v]) => v > 0).map(([u, v]) => ({ u, v }));
  const debt = [...net].filter(([, v]) => v < 0).map(([u, v]) => ({ u, v: -v }));
  const out: Transfer[] = [];
  while (cred.length && debt.length) {
    cred.sort((a, b) => b.v - a.v); debt.sort((a, b) => b.v - a.v); // heaps in prod: O(n log n)
    const c = cred[0], d = debt[0], amt = Math.min(c.v, d.v);
    out.push({ from: d.u, to: c.u, paise: amt });
    c.v -= amt; d.v -= amt;
    if (c.v === 0) cred.shift();
    if (d.v === 0) debt.shift();
  }
  return out;
}

// Exact minimum COUNT: n - (max number of disjoint zero-sum subsets). O(2^n * n), n <= ~20.
export function minTransfers(balances: number[]): number {
  const v = balances.filter((x) => x !== 0);
  const n = v.length, full = 1 << n;
  const sum = new Array<number>(full).fill(0);
  const dp = new Array<number>(full).fill(0);
  for (let m = 1; m < full; m++) {
    const low = m & -m, i = 31 - Math.clz32(low);
    sum[m] = sum[m ^ low] + v[i];                              // subset sum via lowest bit
    let best = 0;
    for (let j = 0; j < n; j++) if (m & (1 << j)) best = Math.max(best, dp[m ^ (1 << j)]);
    dp[m] = best + (sum[m] === 0 ? 1 : 0);                     // closed a zero-sum group
  }
  return n - dp[full - 1];
}
// [300, 400, -200, -200, -300]: greedy -> 4 transfers, minTransfers -> 3
// (each zero-sum group of size k settles with k-1 transfers; groups via dp parent pointers)`,
        },
      ],
      keyPoints: [
        'Equal: base + 1 paisa to the first r; weighted: largest remainder.',
        'Greedy ≤ n−1 transfers, but 4 vs 3 on a 5-person counterexample.',
        'Exact = n − max zero-sum partitions; bitmask DP feasible up to ~20.',
        'Atomic SQL increments for balances; optimistic version for expense edits.',
      ],
    },
    {
      heading: 'Closing comparison: the four cases side by side',
      body: `**Use this table in the last 5 minutes** or to choose your talking points when the interviewer says "you have seen these before — what is the hard part of each?"

| | Parking lot | Elevator | BookMyShow | Splitwise |
|---|---|---|---|---|
| Hard core | Allocation + tariff | LOOK scheduling + lifecycle | TTL exclusive holds | Exact splits + min cash flow |
| Key patterns | Strategy ×2, Observer, registry | State, Strategy, Command queue | Lock-provider seam, State, Facade, Observer | Strategy + Factory (splits), Strategy (simplifier) |
| Contended resource | A free spot | A car's stop list | A (show, seat) pair | A group's balances |
| Concurrency answer (1 process) | no await between pick and mark | single-writer tick loop | synchronous check-then-set | ledger insert + atomic increments |
| Concurrency answer (N pods) | SKIP LOCKED / conditional UPDATE | one controller per bank (no sharing) | Redis TTL + UNIQUE(show, seat) | DB transaction, version column, idempotency key |
| Java expectation | ConcurrentLinkedQueue per size | actor per car, BlockingQueue | ReentrantLock per show / sorted seat locks | ConcurrentHashMap.merge |
| Classic weak answer | Car extends Vehicle with canFit() | enum + switch in every method | isBooked on Seat | floats and a switch on split type |
| First extension asked | EV + surge pricing | stuck car / VIP car | late payment, best-N-together | shares split, multi-currency |
| 90-min demo must show | lot full + fee breakdown | per-car stop timeline | U2 blocked then succeeds after TTL | splits sum exactly + simplified list |

**Patterns that recur:** every case has one *policy* that changes (Strategy), most have a *lifecycle* (State), and all have a *side-effect fan-out* (Observer). The concurrency answer always starts with "where does the state live?" — if you answer that first, the lock design follows.

**What separates senior from mid-level in these rounds:** the senior pins money as integers, makes time injectable (Clock) so TTLs and fees are testable, names the durable guard (constraint or conditional update) instead of trusting an in-process lock, and shows the extension landing in one new class.`,
      keyPoints: [
        'Each case: one policy (Strategy), often a lifecycle (State), always a fan-out (Observer).',
        'Concurrency starts with "where does state live?"',
        'Injectable Clock and integer money are senior signals in every case.',
        'Know the weak answer for each case so you can avoid it explicitly.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'lld-cases-1-cc-1',
      title: 'Parking fee god-method → composable tariff rules (Strategy + open/closed)',
      context:
        'A mall parking backend has grown a single calculateFee method. Finance reports customers parked 2h29m were billed 2 hours, a 20-minute bike stay was free, weekend truck receipts show amounts like ₹121.19999, and an EV customer who left after 1 hour got a negative base fee. Product now wants an "e-rickshaw" type and a festival surcharge.',
      task: 'Refactor so that adding a vehicle type or a pricing rule never edits existing code, money is exact, and every listed billing bug is fixed. Keep the public call site simple for the exit-gate controller.',
      starter: {
        language: 'typescript',
        title: 'parking-fee.service.ts (starter)',
        code: `export class ParkingFeeService {
  private chargingFee = 75.5;

  calculateFee(vehicleType: string, entry: Date, exit: Date,
               isWeekend: boolean, lostTicket: boolean): number {
    const hours = Math.round((exit.getTime() - entry.getTime()) / 3600000);
    let fee = 0;
    if (lostTicket) return 500;
    if (vehicleType === 'BIKE') {
      fee = hours * 10;
    } else if (vehicleType === 'CAR') {
      if (hours <= 2) fee = 40;
      else fee = 40 + (hours - 2) * 20;
      if (fee > 300) fee = 300;                 // cap... for the whole stay?
    } else if (vehicleType === 'TRUCK') {
      fee = hours * 50.5;
    } else if (vehicleType === 'EV') {
      fee = 40 + (hours - 2) * 20 + this.chargingFee;
    } else {
      throw new Error('unknown vehicle');
    }
    if (isWeekend) fee = fee * 1.2;            // caller decides weekend in server timezone
    return fee;
  }
}`,
      },
      hints: [
        'List what varies (per vehicle tariff, surcharges, caps, lost ticket) and what is fixed (duration in started minutes/hours, summing lines).',
        'Make each rule a small class that transforms a list of fee lines; a tariff is an ordered list of rules registered per vehicle profile.',
        'Use integer paise, Math.ceil for started hours, a minimum charge, and derive "weekend" from the entry time in Asia/Kolkata inside a rule, not from the caller.',
      ],
      solution: {
        language: 'typescript',
        title: 'tariff.ts (solution)',
        code: `export interface StayContext { entry: Date; exit: Date; lostTicket: boolean; kWh: number }
export interface FeeLine { label: string; paise: number }
export interface FeeRule { apply(ctx: StayContext, lines: FeeLine[]): FeeLine[] }

const startedHours = (c: StayContext) =>
  Math.max(1, Math.ceil((c.exit.getTime() - c.entry.getTime()) / 3_600_000)); // 20 min => 1h

export class FlatThenHourly implements FeeRule {        // e.g. car: Rs40 for 2h, Rs20/h after
  constructor(private flatHours: number, private flatPaise: number, private hourlyPaise: number) {}
  apply(c: StayContext, lines: FeeLine[]) {
    const extra = Math.max(0, startedHours(c) - this.flatHours);
    return [...lines, { label: 'Parking', paise: this.flatPaise + extra * this.hourlyPaise }];
  }
}
export class PerDayCap implements FeeRule {
  constructor(private capPaise: number) {}
  apply(c: StayContext, lines: FeeLine[]) {
    const days = Math.ceil(startedHours(c) / 24);
    const total = lines.reduce((s, l) => s + l.paise, 0);
    return total > days * this.capPaise ? [...lines, { label: 'Cap', paise: days * this.capPaise - total }] : lines;
  }
}
export class WeekendSurcharge implements FeeRule {     // 20%, decided in IST from entry time
  apply(c: StayContext, lines: FeeLine[]) {
    const day = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }).format(c.entry);
    if (day !== 'Sat' && day !== 'Sun') return lines;
    const base = lines.reduce((s, l) => s + l.paise, 0);
    return [...lines, { label: 'Weekend 20%', paise: Math.round((base * 20) / 100) }]; // integer paise
  }
}
export class ChargingPerKwh implements FeeRule {
  constructor(private paisePerKwh: number) {}
  apply(c: StayContext, lines: FeeLine[]) {
    return c.kWh > 0 ? [...lines, { label: c.kWh + ' kWh', paise: Math.round(c.kWh * this.paisePerKwh) }] : lines;
  }
}
export class LostTicket implements FeeRule {            // replaces, not ignores, the time-based fee
  constructor(private flatPaise: number) {}
  apply(c: StayContext, lines: FeeLine[]) {
    return c.lostTicket ? [{ label: 'Lost ticket', paise: this.flatPaise }] : lines;
  }
}

export class TariffRegistry {                          // open for extension: register, never edit
  private tariffs = new Map<string, FeeRule[]>();
  register(profile: string, rules: FeeRule[]) { this.tariffs.set(profile, rules); return this; }
  quote(profile: string, ctx: StayContext) {
    const rules = this.tariffs.get(profile);
    if (!rules) throw new Error('NO_TARIFF_FOR_' + profile);
    const lines = rules.reduce<FeeLine[]>((acc, r) => r.apply(ctx, acc), []);
    return { lines, totalPaise: lines.reduce((s, l) => s + l.paise, 0) };
  }
}

export const tariffs = new TariffRegistry()
  .register('BIKE', [new FlatThenHourly(1, 1000, 1000), new PerDayCap(10000), new LostTicket(20000)])
  .register('CAR', [new FlatThenHourly(2, 4000, 2000), new PerDayCap(30000), new WeekendSurcharge(), new LostTicket(50000)])
  .register('EV_CAR', [new FlatThenHourly(2, 4000, 2000), new PerDayCap(30000), new ChargingPerKwh(1800), new LostTicket(50000)])
  .register('E_RICKSHAW', [new FlatThenHourly(2, 2000, 1000), new PerDayCap(15000)]); // new type: one line`,
      },
      explanation: `**What was fixed and why:**
- **Rounding:** \`Math.round\` billed 2h29m as 2h and 20 min as 0h. \`Math.ceil\` of started hours with a 1-hour minimum matches how every Indian mall tariff board reads ("per hour or part thereof").
- **Money:** \`50.5 * 1.2\` produced float noise; all amounts are integer paise and percentage surcharges round once per line.
- **EV negative fee:** \`(hours - 2) * 20\` went negative under 2 hours; \`Math.max(0, …)\` inside one rule removes the class of bug, and charging is billed per kWh as its own line.
- **Cap per 24 h**, not per stay: a 3-day car was previously capped at ₹300 total.
- **Weekend** is derived from the entry time in Asia/Kolkata inside the rule; the caller in a UTC container used to get Saturday wrong after 18:30 UTC Friday.
- **Lost ticket** is a rule ordered last that replaces the lines, so it is visible on the receipt.

**Design:** each rule is a Strategy over a list of fee lines; a tariff is a Composite of rules registered per vehicle profile. Adding \`E_RICKSHAW\` or a \`FestivalSurcharge\` is a new registration or a new class — \`TariffRegistry\` and existing rules are untouched (OCP). Line items make receipts and disputes explainable.`,
      followUps: [
        {
          q: 'The tariff board changes on 1 April. A car that entered on 31 March at 22:00 exits on 1 April at 02:00. Which tariff applies and how does your design guarantee it?',
          a: 'Business rule is usually "tariff at entry". Version tariffs (\`CAR-2026-04\`) and store the **tariff id on the ticket** at entry; the exit gate quotes with that id, so a mid-stay change never retroactively reprices. If the business wants split pricing across the boundary, add a \`SplitByEffectiveDate\` rule that slices the stay and delegates each slice to the matching version — still a new class, not an edit.',
        },
        {
          q: 'How do you unit test WeekendSurcharge and PerDayCap without waiting for weekends or mocking Date globally?',
          a: 'Rules are pure functions of \`StayContext\`, so tests build contexts with fixed ISO timestamps: entry \`2026-10-10T10:00:00+05:30\` (a Saturday) and exit 3h later must add 20%; entry Friday 23:30 IST must not, even though it is Friday 18:00 UTC. For caps, a 49-hour stay must cap at 3 × ₹300. Table-driven tests per rule plus one golden receipt test per registered profile catch rule-ordering mistakes.',
        },
      ],
    },
    {
      id: 'lld-cases-1-cc-2',
      title: 'Elevator controller with races → single-writer command loop',
      context:
        'A 30-floor office building runs this controller in one Node process; car positions are mirrored to Redis for the lobby screens. Ops sees two cars arriving at the same floor for one button press, cars skipping a floor during busy minutes (moving two floors in one second), and pressed buttons being "forgotten" after a car is taken out for maintenance.',
      task: 'Find every race and design flaw, then restructure the controller so a single writer owns car state, hall calls are never lost or duplicated, and the stop order follows LOOK.',
      starter: {
        language: 'typescript',
        title: 'elevator.controller.ts (starter)',
        code: `type CarRow = { id: string; floor: number; state: 'IDLE' | 'MOVING' | 'MAINTENANCE'; targets: number[] };

export class ElevatorController {
  constructor(private cars: CarRow[], private positions: {
    readAll(): Promise<CarRow[]>; write(c: CarRow): Promise<void> }) {}

  async requestPickup(floor: number, dir: 'UP' | 'DOWN') {
    const snapshot = await this.positions.readAll();            // ~2 ms round trip
    const idle = snapshot.filter((c) => c.state === 'IDLE');
    const pool = idle.length ? idle : snapshot;
    const best = pool.sort((a, b) => Math.abs(a.floor - floor) - Math.abs(b.floor - floor))[0];
    const car = this.cars.find((c) => c.id === best.id)!;
    car.state = 'MOVING';
    car.targets.push(floor);                                     // dir ignored, FIFO order
    await this.positions.write(car);
  }

  setMaintenance(carId: string) {
    const car = this.cars.find((c) => c.id === carId)!;
    car.state = 'MAINTENANCE';
    car.targets = [];
  }

  start() {
    setInterval(async () => {
      for (const car of this.cars) {
        if (car.state === 'MAINTENANCE') continue;
        if (!car.targets.length) { car.state = 'IDLE'; continue; }
        car.floor += car.targets[0] > car.floor ? 1 : -1;
        if (car.floor === car.targets[0]) {
          car.targets.shift();
          await this.openDoors(car);                            // 3-5 s dwell
        }
        await this.positions.write(car);
      }
    }, 1000);
  }

  private openDoors(car: CarRow) { return new Promise((r) => setTimeout(r, 4000)); }
}`,
      },
      hints: [
        'Look at every await: what can change in this.cars between the read and the write? What happens when one interval callback is still awaiting openDoors when the next interval fires?',
        'Treat buttons, maintenance and the timer as producers of commands; let exactly one non-overlapping loop consume them and mutate cars.',
        'Store stops as sets keyed by direction (cab, hall UP, hall DOWN) so duplicates collapse and LOOK can decide stops; model the door dwell as a state with a tick counter instead of an await.',
      ],
      solution: {
        language: 'typescript',
        title: 'elevator.controller.ts (solution)',
        code: `import { LookScheduler, type Dir, type Request } from './look-scheduler'; // from the section

type Mode = 'IDLE' | 'MOVING' | 'DOORS_OPEN' | 'MAINTENANCE';
class CarModel {
  floor = 0; dir: Dir = 'IDLE'; mode: Mode = 'IDLE'; dwell = 0;
  stops = new LookScheduler();
  hallCalls = new Set<string>();                             // "15:DOWN" owned by this car
  constructor(readonly id: string) {}
}
type Command =
  | { t: 'HALL'; floor: number; dir: 'UP' | 'DOWN' }
  | { t: 'CAB'; carId: string; floor: number }
  | { t: 'MAINTENANCE'; carId: string };

export class ElevatorController {
  private inbox: Command[] = [];
  private assigned = new Map<string, string>();               // hall key -> carId (dedupe)
  private running = false;

  constructor(private cars: CarModel[], private floors: number,
              private publish: (snapshot: object[]) => void) {} // Redis = read-only projection

  submit(c: Command) {                                          // producers never mutate cars
    if ('floor' in c && (c.floor < 0 || c.floor >= this.floors)) throw new Error('BAD_FLOOR');
    this.inbox.push(c);
  }

  start(periodMs = 1000) {                                      // chained timeout: no overlap
    this.running = true;
    const loop = () => { if (!this.running) return; this.step(); setTimeout(loop, periodMs); };
    loop();
  }

  step() {                                                      // the ONLY writer, fully synchronous
    for (const c of this.inbox.splice(0)) this.apply(c);
    for (const car of this.cars) this.advance(car);
    this.publish(this.cars.map(({ id, floor, dir, mode }) => ({ id, floor, dir, mode })));
  }

  private apply(c: Command) {
    if (c.t === 'CAB') return this.car(c.carId).stops.add({ kind: 'CAB', carId: c.carId, floor: c.floor });
    if (c.t === 'MAINTENANCE') {
      const car = this.car(c.carId);
      car.mode = 'MAINTENANCE';
      for (const key of car.hallCalls) {                        // hand hall calls back, never drop
        this.assigned.delete(key);
        const [f, d] = key.split(':');
        this.inbox.push({ t: 'HALL', floor: Number(f), dir: d as 'UP' | 'DOWN' });
      }
      car.hallCalls.clear(); car.stops = new LookScheduler();
      return;
    }
    const key = c.floor + ':' + c.dir;
    if (this.assigned.has(key)) return;                         // second press: already handled
    const pool = this.cars.filter((x) => x.mode !== 'MAINTENANCE');
    if (!pool.length) return void setTimeout(() => this.submit(c), 5000); // retry later, not lost
    const best = pool.reduce((a, b) => (this.cost(b, c.floor) < this.cost(a, c.floor) ? b : a));
    best.stops.add({ kind: 'HALL', floor: c.floor, dir: c.dir });
    best.hallCalls.add(key); this.assigned.set(key, best.id);
  }

  private cost(car: CarModel, floor: number) {                  // reversal penalty: Strategy in prod
    const ahead = car.dir === 'IDLE' || (car.dir === 'UP' ? floor >= car.floor : floor <= car.floor);
    return Math.abs(car.floor - floor) + (ahead ? 0 : this.floors);
  }

  private advance(car: CarModel) {
    if (car.mode === 'MAINTENANCE') return;
    if (car.mode === 'DOORS_OPEN') { if (--car.dwell > 0) return; car.mode = 'IDLE'; }
    if (car.mode === 'MOVING') car.floor += car.dir === 'UP' ? 1 : -1;
    if (car.stops.shouldStop(car.floor, car.dir)) {
      car.stops.served(car.floor, car.dir);
      for (const d of ['UP', 'DOWN']) {
        const k = car.floor + ':' + d;
        if (car.hallCalls.delete(k)) this.assigned.delete(k);  // re-press now creates a new call
      }
      car.mode = 'DOORS_OPEN'; car.dwell = 4; return;           // dwell = ticks, not an await
    }
    car.dir = car.stops.nextDirection(car.floor, car.dir);
    car.mode = car.dir === 'IDLE' ? 'IDLE' : 'MOVING';
  }

  private car(id: string) { return this.cars.find((c) => c.id === id)!; }
}`,
      },
      explanation: `**Races and flaws in the starter:**
1. **Stale snapshot:** \`requestPickup\` awaits Redis, then decides. Two presses within 2 ms both see car B idle and both assign it; meanwhile the timer may have moved B. Redis was being used as a source of truth *and* a mirror.
2. **Overlapping ticks:** \`setInterval(async …)\` does not wait for the previous callback. While one callback awaits a 4 s door dwell, three more callbacks start and each moves the same car — the "skipped floor".
3. **Duplicate hall calls:** pressing ▼ three times pushes floor 15 three times.
4. **FIFO targets, direction ignored:** zig-zags instead of LOOK; a car going up stops for a DOWN caller.
5. **Maintenance drops hall calls:** \`targets = []\` forgets people waiting on floors.
6. **No validation** of floor numbers.

**Fixes:** producers only enqueue \`Command\`s; one synchronous \`step()\` is the single writer (actor model), scheduled with chained \`setTimeout\` so it never overlaps. Stops are LOOK sets, so duplicates collapse and direction is respected. Hall calls are tracked per car and re-enqueued on maintenance. Door dwell is a counted state, so nothing awaits inside the critical loop. Redis becomes a published projection for screens. In Java this is a single-thread \`ScheduledExecutorService\` draining a \`ConcurrentLinkedQueue<Command>\`.`,
      followUps: [
        {
          q: 'The building owner wants two controller processes for high availability. How do you keep the single-writer property?',
          a: 'Run active-passive, not active-active: both processes compete for a **leader lease** (etcd/Consul session or a Redis key with a fencing token, TTL ≈ 3 s). Only the leader drains the button queue and sends motor commands; hardware rejects commands with an older fencing token. On failover the new leader rebuilds state from car sensors (floor, door) and from the hall-button lamps that are still lit — the lamps are the durable record of unserved hall calls.',
        },
        {
          q: 'How would you test that no hall call is ever lost when a car goes into maintenance mid-sweep?',
          a: 'Because \`step()\` is synchronous and time is a tick count, write a deterministic simulation test: submit 20 random hall calls over 50 ticks, put car 2 into maintenance at tick 17, run 400 ticks, then assert every submitted hall key was served exactly once (record a "served" log in \`advance\`) and \`assigned\` is empty. Add a property-based test (fast-check) over random seeds for call times and maintenance ticks.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'lld-cases-1-iq-01',
      difficulty: 'medium',
      question:
        'You get a 90-minute machine-coding prompt: "Build a parking lot." Walk me through exactly how you spend the 90 minutes and what you will have running at the end.',
      context:
        'Reported in Flipkart SDE-2 machine-coding rounds (2025): 90 minutes to build, then a 30-minute review where the interviewer asks for feature enhancements.',
      whatInterviewerLooksFor: [
        'Time-boxed plan with requirements and scope cut explicitly',
        'Identifies variation points before coding (allocation, pricing)',
        'Codes the hard core first with in-memory repositories behind interfaces',
        'Leaves a runnable demo including a failure path',
        'Can name what is stubbed and why',
      ],
      modelAnswer: `**0–5 min — scope.** I confirm: floors, gates, vehicle sizes, EV chargers, tariff, lost ticket, single process or many. I write an explicit out-of-scope list (reservations, ANPR, payments beyond a stub).

**5–10 — thin HLD.** Commands: \`park(plate, type, gateId)\`, \`exit(ticketId)\`, \`availability(floor)\`. State lives in a \`ParkingService\` backed by an in-memory \`SpotRepository\` interface; I say how it becomes Postgres.

**10–20 — entities + diagram.** Lot ◇ Floor ◇ Spot; Vehicle as a value object (size, needsCharger); Ticket with tariffId; Gate.

**20–30 — interfaces.** \`AllocationStrategy\` and \`FeeRule\`/\`Tariff\` (the two things that change), \`SpotEvents\` Observer for boards. No other patterns — I say why I did not add a Factory hierarchy for vehicles.

**30–70 — code the hard path first:** \`NearestFitStrategy\` (size waste + distance to gate, chargers reserved under 90% occupancy), slab tariff in paise, \`park/exit\` with idempotent ticket id and no await between pick and mark.

**70–80 — \`main()\` demo:** 2 gates, 6 vehicles, a truck rejected when LARGE is full, a car exiting after 5h10m with a printed fee breakdown (₹40 + 4 × ₹20 = ₹120).

**80–90 — polish + talk:** input validation, custom errors, a few assertions as tests; prepared answers for "add EV per-kWh billing" (one rule) and "3 pods" (\`SKIP LOCKED\`).

**What graders score** (Flipkart/Swiggy/Razorpay style): it compiles and runs, separation of concerns, extensibility at the right seams, correctness on edge cases, and how I explain trade-offs. A beautiful diagram with code that does not run scores below a plain design that runs.`,
      followUps: [
        {
          q: 'At minute 60 your fee logic still has a bug and the demo does not run. What do you cut?',
          a: 'Cut breadth, not the core: drop the Observer boards and the second strategy, hard-code one tariff, and make \`main()\` run end to end with park → exit → fee. A running vertical slice beats half-built features. Tell the interviewer explicitly what was cut and how it plugs back in (interfaces already exist), which turns the gap into a design discussion instead of a failure.',
        },
        {
          q: 'The interviewer says "now add a VIP floor that only members can use". Where does the change land?',
          a: 'A \`Vehicle\`/driver context gains \`membership\`, spots get a \`reservedFor\` tag, and a decorator \`MembershipFilterStrategy\` wraps the existing \`AllocationStrategy\` to filter candidates before delegating. \`ParkingService\` and \`NearestFitStrategy\` are untouched. If the change forces edits in three classes, that is the signal your seams were wrong — say so and show the refactor.',
        },
      ],
      pitfalls: [
        'Spending 30 minutes on a UML diagram and starting code at minute 40',
        'Building a Car/Bike/Truck inheritance tree with overridden canFit()',
        'No main() or demo — "the logic is all there" does not pass',
        'Using floating rupees for fees',
      ],
    },
    {
      id: 'lld-cases-1-iq-02',
      difficulty: 'expert',
      question:
        'Our mall lot runs on 3 NestJS pods behind a load balancer and 8 gate kiosks. Last Diwali two cars were sent to the same spot on floor 2. Show me how spot assignment should work so it is correct across pods and still fast at the gates.',
      whatInterviewerLooksFor: [
        'Recognises in-process locks are useless across pods',
        'Uses the DB as arbiter with a conditional claim (SKIP LOCKED or WHERE occupied IS NULL)',
        'Keeps allocation preference (nearest to gate) in the query or a two-step pick-and-claim with retry',
        'Handles kiosk retries idempotently and releases on failure',
      ],
      modelAnswer: `**Why it broke:** each pod read "spot F2-17 is free" from its own cache/DB read, then wrote occupied — a classic read-then-write race. An \`async-mutex\` in each pod only serialises inside that pod.

**Correct claim (Postgres):** a single statement that picks and claims atomically and skips rows another transaction is claiming:

- \`UPDATE spot SET occupied_ticket_id = $ticket WHERE id = (SELECT id FROM spot WHERE size >= $size AND occupied_ticket_id IS NULL AND (has_charger = $ev OR $nearlyFull) ORDER BY size, dist_gate_$g LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id\`
- \`SKIP LOCKED\` means gate 3 does not wait for gate 5's in-flight claim; it takes the next best spot. With 3,000 rows and indexes on \`(size, dist_gate_n) WHERE occupied_ticket_id IS NULL\` (partial index), this is ~1–2 ms.

**Alternative:** let the app choose the spot via \`AllocationStrategy\` in memory, then claim with \`UPDATE … WHERE id = $id AND occupied_ticket_id IS NULL\`; if \`rowCount = 0\` retry with the next candidate (optimistic). Fine because contention is low — 8 gates, ~1 car per gate per 6 s.

**Belt and braces:** a partial unique index \`ON ticket(spot_id) WHERE exited_at IS NULL\` makes two active tickets on one spot impossible even if code regresses.

**Idempotency:** the kiosk generates \`ticketId\` (UUIDv7) and retries with it; \`INSERT … ON CONFLICT (id) DO NOTHING\` returns the original assignment, so a timeout never burns a second spot.

**Failure:** if the ticket insert fails after the claim, both are in one transaction — rollback releases the spot.

**Java equivalent:** same SQL; in a single JVM you might use \`ConcurrentLinkedQueue<Spot>\` per size with \`poll()\`, but across JVMs the DB is the lock.`,
      followUps: [
        {
          q: 'The DB is in Mumbai and one mall gate kiosk loses connectivity for 20 minutes. What happens?',
          a: 'The kiosk cannot claim a spot, so it should fall back to **unassigned entry**: print a ticket with entry time and "park anywhere on floors 3–4", queue the ticket locally, and sync when back. Assignment is a convenience; billing correctness only needs the entry time. Floor sensors (if present) reconcile occupancy later. Never let the kiosk pick spots from a stale local copy — that recreates the original double-assignment bug.',
        },
        {
          q: 'Why not just put a Redis SETNX lock per spot?',
          a: 'It works but adds a second system whose state must agree with Postgres: a claim can succeed in Redis and fail in the DB (or vice versa after a Redis failover), and you need TTLs and owner-checked release. With only ~10 claims per second, the DB conditional update is simpler and already transactional with the ticket insert. Use Redis when the claim rate or latency budget exceeds what one Postgres primary handles.',
        },
        {
          q: 'How do display boards stay accurate without polling the spot table every second?',
          a: 'Emit \`SPOT_OCCUPIED\`/\`SPOT_FREED\` events via a transactional outbox in the same transaction as the claim, publish to a topic, and let each floor board service keep a counter. Every 5 minutes it re-syncs with \`SELECT floor, count(*) … GROUP BY floor\` to correct drift from missed events.',
        },
      ],
      pitfalls: [
        'Adding a mutex in the NestJS service and calling it solved',
        'SELECT then UPDATE in READ COMMITTED without a predicate on occupied',
        'Using SERIALIZABLE for everything and ignoring retry storms at peak',
      ],
    },
    {
      id: 'lld-cases-1-iq-03',
      difficulty: 'hard',
      question:
        'Product wants EV charging bays billed per kWh plus a surge multiplier when occupancy crosses 85%, rolled out next sprint without touching the existing allocation and fee classes. Walk me through the class changes.',
      whatInterviewerLooksFor: [
        'Open/closed: new classes and registrations, no edits to existing rules',
        'Separates allocation concerns (charger bays) from pricing concerns (kWh, surge)',
        'Surge determined at a defined moment (entry) and recorded for auditability',
        'Considers non-EVs blocking chargers',
      ],
      modelAnswer: `**Allocation side:** spots already carry \`hasCharger\`; vehicles carry \`needsCharger\`. If the existing \`NearestFitStrategy\` does not yet reserve chargers, I add a **decorator** \`ChargerAwareStrategy\` that filters candidates (EVs → charger bays only; non-EVs → chargers only above 90% occupancy) and delegates the ranking to the wrapped strategy. Composition, so the original class stays unchanged.

**Pricing side:** two new \`FeeRule\`s registered in the EV and car tariffs:
- \`ChargingPerKwhRule(paisePerKwh)\` reads \`kWh\` from the stay context, which the charger controller reports at exit (meter reading delta). Separate receipt line: "14.2 kWh × ₹18 = ₹255.60" as 25,560 paise.
- \`SurgeRule(thresholdPct, multiplierBps)\` applies to the parking line only, not to energy.

**When is surge decided?** At **entry**, not exit, and stored on the ticket (\`surgeBps: 12500\`). Otherwise a driver who parked at 9 a.m. in an empty lot pays surge because the lot is full at 6 p.m. An \`OccupancyProvider\` interface is injected into the ticket-issuing path, not into the rule, so the rule stays a pure function of the ticket.

**Idle-fee:** EVs that finish charging and keep the bay blocked get an \`IdleAfterChargeRule\` (₹5/min after 15 minutes past charge-complete) — the most common real follow-up.

**What changes in existing code:** only the composition root (NestJS module providers / tariff registration) and the \`Ticket\` schema (\`surgeBps\`, \`kWh\`). Tests: one per new rule plus a golden receipt.

**Trade-off:** the rule pipeline order matters (surge before cap? cap before energy?). I make order explicit in the tariff definition and test it.`,
      followUps: [
        {
          q: 'Should the surge cap be applied before or after the daily cap?',
          a: 'Business choice, but state it: usually the **daily cap applies to the surged parking line**, otherwise surge on a long stay becomes unbounded and creates complaints. Energy is never capped by the parking cap. Encode it as rule order \`[Slab, Surge, DailyCap, ChargingPerKwh, IdleFee]\` and add a golden test for a 26-hour stay so a re-ordering change is caught.',
        },
        {
          q: 'The charger meter API is down at exit time. How does exit still work?',
          a: 'Do not block the barrier. Bill parking now, mark the energy line \`PENDING_METER\`, and settle energy asynchronously when the reading arrives (UPI mandate or post-paid wallet debit). Alternatively estimate from charging session duration × charger power with a later true-up. The design point: exit is a critical path; meter reads are not.',
        },
      ],
      pitfalls: [
        'Adding if (vehicleType === EV) branches into the existing fee method',
        'Computing surge from occupancy at exit time',
        'Letting non-EVs take charger bays while EVs are turned away',
      ],
    },
    {
      id: 'lld-cases-1-iq-04',
      difficulty: 'hard',
      question:
        'Design the classes for a 6-car elevator bank in a 40-floor office tower. How do you represent requests, and which algorithm does each car use to order its stops?',
      whatInterviewerLooksFor: [
        'Separates hall calls (floor + direction) from cab calls (car + floor)',
        'Dispatcher as Strategy, per-car scheduler as LOOK with direction-aware stops',
        'Explains why not FCFS/SSTF/SCAN',
        'Single writer for car state',
      ],
      modelAnswer: `**Requests:** a discriminated union — \`HallCall { floor, dir }\` from floor panels and \`CabCall { carId, floor }\` from inside. Hall calls belong to the **bank** (reassignable); cab calls belong to **one car**.

**Classes:**
- \`ElevatorController\`: owns \`Car[]\`, a \`Dispatcher\`, and a command inbox; \`tick()\` is the single writer.
- \`Dispatcher\` (Strategy): \`assign(hall, cars): Car\`. Default cost = distance + penalty if the car must reverse to reach the caller + small load penalty. At 08:30–10:00 swap to a zoned up-peak strategy.
- \`Car\`: floor, direction, load, \`ElevatorState\` (Idle/Moving/DoorsOpen/Maintenance/FireRecall) and a \`LookScheduler\` with three sets: cab stops, UP hall stops, DOWN hall stops.

**Per-car ordering — LOOK:** keep moving in the current direction while any request lies ahead; stop at a floor if it has a cab call or a hall call in the *same* direction; at the last request in that direction, serve whatever is there (including the opposite hall call) and reverse. Example from floor 3 with {cab 7, 5▼, 4▲, 1▲, 9▼}: stops 4, 7, 9, 5, 1.

**Why not the others:** FCFS zig-zags; SSTF (nearest stop) starves the top floors under load; SCAN travels to floor 39 even when the last request is 22. LOOK bounds wait time and wastes no travel.

**Concurrency:** buttons enqueue; one loop assigns and advances; no awaits inside. Redis/screens get a published snapshot.

**Numbers:** ~2.5 m/s cars, ~1.5 s per floor plus 8–10 s per stop; the stop count dominates trip time, which is why up-peak strategies try to reduce stops per trip.`,
      followUps: [
        {
          q: 'A hall call at floor 25 ▼ was assigned to car 3, but car 5 just became idle at floor 26. Do you reassign?',
          a: 'Allow reassignment of a hall call only until the assigned car has committed (e.g. is within 2 floors or decelerating). Re-score open hall calls when a car becomes idle; if the improvement exceeds a threshold (say 10 s ETA), move the call and remove it from car 3. Without a threshold you get flip-flopping assignments and lobby displays that change the assigned car repeatedly.',
        },
        {
          q: 'Passengers inside press 8 floors, then the car hits its weight limit at floor 2. What changes?',
          a: 'The car enters an overload sub-state: doors stay open and a buzzer sounds until load drops. While load > 80%, the dispatcher stops assigning it new hall calls (load penalty → infinity) and the car skips hall calls on the way, serving only cab calls. That is a cost-function change plus a state guard — no change to LOOK itself.',
        },
      ],
      pitfalls: [
        'One Request class with nullable direction and nullable carId',
        'Each car greedily answering every hall call (all cars race to the same floor)',
        'Choosing SSTF without mentioning starvation',
      ],
    },
    {
      id: 'lld-cases-1-iq-05',
      difficulty: 'hard',
      question:
        'Your elevator code has an enum mode and a switch in move(), openDoor(), onButton() and onSensor(). Now we need fire recall, independent service (attendant mode) and an earthquake mode. Refactor the design and justify it.',
      whatInterviewerLooksFor: [
        'Applies State pattern with per-mode classes and explicit transitions',
        'Explains OCP benefit and how illegal actions become impossible',
        'Defines who triggers transitions (sensors, building systems)',
        'Mentions testing transitions as a table',
      ],
      modelAnswer: `**Problem with enum + switch:** four methods × N modes. Adding three modes edits every method; forgetting one branch is a safety bug (moving with doors open, accepting hall calls in fire recall). It also scatters the rules for one mode across the file.

**Refactor — State pattern:**
- \`interface ElevatorState { onTick(car); onHallCall(car, call); onCabCall(car, floor); onDoorSensor(car, blocked); onEmergency(car, signal) }\`
- Classes: \`Idle\`, \`Moving\`, \`DoorsOpen\`, \`Maintenance\`, \`FireRecallPhase1\` (go to the designated floor non-stop, open doors, ignore all calls), \`FireServicePhase2\` (firefighter key, cab calls only, doors open only while button held), \`IndependentService\` (no hall calls, attendant controls doors), \`SeismicStop\` (stop at nearest floor, open doors, wait for reset).
- \`Car.setState(next)\` is the only transition point; it logs transitions and notifies the dispatcher, which removes the car from the pool when \`acceptsHallCalls()\` is false and **re-dispatches its hall calls**.

**Who triggers transitions:** building fire panel and seismic sensor push events into the controller inbox; each state decides how to react (e.g. \`Moving.onEmergency(FIRE)\` → \`FireRecallPhase1\`; \`DoorsOpen.onEmergency(FIRE)\` → close doors then recall).

**Why it is better:** a new mode is a new class plus transitions into it; an illegal action is simply a no-op in that class. Each state is testable in isolation.

**Testing:** a transition table test — for every (state, event) pair assert next state and side effects; generate from a spec (fire codes such as ASME A17.1 / EN 81-73 define phase behaviour), which also documents compliance.

**Trade-off:** more classes; for 2 modes an enum is fine. With 6+ modes and safety implications, State wins.`,
      followUps: [
        {
          q: 'Where does the transition logic live — in the states or in a central table?',
          a: 'Either works; state-owned transitions (each state returns the next) keep behaviour together, a central transition table (state × event → next) is easier to audit for safety reviews. For safety-critical modes I prefer a table checked in tests plus states for behaviour, so a reviewer can read every allowed transition on one page and nothing can transition to Moving from FireServicePhase2 without the key.',
        },
        {
          q: 'How do you avoid a state object holding stale data, like a stuck-tick counter, after transitions?',
          a: 'Create a new state instance on every transition (cheap) and keep per-car data on the \`Car\` context, per-visit data (dwell countdown, stuck ticks) inside the state instance. Shared singletons for states are fine only if stateless; once a state needs counters, instantiate it per entry so a car returning to Moving starts with a fresh stuck counter.',
        },
      ],
      pitfalls: [
        'Adding more booleans (isFire, isMaintenance) instead of modelling states',
        'Leaving hall calls assigned to a car that entered fire recall',
        'One singleton state object holding per-car counters',
      ],
    },
    {
      id: 'lld-cases-1-iq-06',
      difficulty: 'hard',
      question:
        'An elevator in a 25-floor hospital wing stops responding between floors 11 and 12 with two passengers inside and four hall calls assigned to it. What should the software do, step by step, and what classes own each step?',
      whatInterviewerLooksFor: [
        'Detection via state (motor on, floor unchanged) with thresholds',
        'Reassigns hall calls, does not drop them; cab calls handled differently',
        'Safety and alerting (intercom, technician) separate from scheduling',
        'Recovery path back to service',
      ],
      modelAnswer: `**1. Detect (MovingState):** each tick it checks "motor commanded, floor/position sensor unchanged for > N ticks" (e.g. > 10 s for a floor that takes ~2 s). A door-zone sensor also tells us it is *between* floors. Transition to \`OutOfService(reason = STUCK_BETWEEN_FLOORS)\`.

**2. Make safe (car controller / hardware layer):** apply brake, keep doors closed (opening between floors is a fall hazard), turn on emergency lighting and connect the intercom. Software does not attempt to move it.

**3. Re-dispatch (Controller + Dispatcher):** on entering a state where \`acceptsHallCalls()\` is false, the car's 4 hall calls go back to the controller inbox and are assigned to other cars. The hall lamps stay lit; the lobby display may show a new ETA. Cab calls of the two passengers are kept on the car record for the incident log, not re-dispatched (they are inside).

**4. Alert (Observer):** \`ElevatorIncident\` event → BMS dashboard, on-call technician page, hospital security. Hospitals also need a priority rule: if a stretcher/service car is stuck, the dispatcher's \`HospitalPriorityStrategy\` reserves another car for bed transfers.

**5. Recover:** a technician moves the car to the nearest floor (manual or rescue operation); a command \`ReturnToService(carId)\` from an authorised panel transitions \`OutOfService → Idle\` only after a self-test (doors, levelling).

**Ownership summary:** detection = state class; safety = hardware adapter; reassignment = controller + dispatcher; notification = observers; recovery = authorised command.

**Metrics:** count incidents, mean time to rescue, hall-call wait time while degraded (5 of 6 cars → ~20% longer waits at peak).`,
      followUps: [
        {
          q: 'The position sensor is flaky and reports "stuck" falsely twice a day. How do you avoid evacuating hall calls each time?',
          a: 'Use corroboration and hysteresis: require both the encoder and the floor-zone sensor to agree, a threshold relative to expected travel time, and a short "suspect" sub-state where the car keeps its calls but gets no new ones for, say, 5 seconds. Only after confirmation do you evict calls. Track false-positive rate as a metric and alert maintenance on sensor health separately.',
        },
        {
          q: 'All 4 hall calls were from floor 11, and the only other working car is in independent service. What do the waiting people see?',
          a: 'No car accepts hall calls, so the dispatcher holds them in a pending queue with retry rather than dropping them, keeps hall lamps lit, and the floor display shows "Service delayed — use stairs/other bank". When any car returns to an accepting state, pending calls are dispatched first, oldest first, to avoid starvation.',
        },
      ],
      pitfalls: [
        'Opening the doors between floors to "release" passengers',
        'Clearing all requests of the car, losing waiting hall callers',
        'Letting the car auto-resume without a technician command',
      ],
    },
    {
      id: 'lld-cases-1-iq-07',
      difficulty: 'expert',
      question:
        'Design the classes for a movie-ticket booking service where a user holds seats for 10 minutes and pays. Where exactly does the lock live, and how does the same design work on one laptop during the round and on 20 pods in production?',
      context:
        'Common in Indian product-company LLD rounds; LeetCode Discuss BookMyShow LLD threads focus on concurrent locking of the same seat and a pluggable lock provider.',
      whatInterviewerLooksFor: [
        'Seat vs ShowSeat modelling',
        'A SeatLockProvider seam with in-memory and distributed implementations',
        'All-or-nothing holds, owner-checked release, TTL with lazy expiry',
        'A durable database guard independent of the lock layer',
      ],
      modelAnswer: `**Model:** \`Screen\` ◇ \`Seat(row, no, category)\` is static. \`Show(screen, movie, startsAt, prices)\`. Per-show availability is \`ShowSeat\`/\`booking_seat\`, never a flag on \`Seat\`. \`Booking\` has a lifecycle PENDING_PAYMENT → CONFIRMED | EXPIRED | CANCELLED | REFUNDED.

**The seam:** \`BookingService\` depends on \`SeatLockProvider { acquire(show, seats, holdId, ttl); validate(...); release(...) }\`.

- **Laptop/round:** \`InMemorySeatLockProvider\` — a \`Map<show:seat, {holdId, expiresAt}>\`, an injectable \`Clock\`, lazy expiry on read, check-all-then-set-all inside one synchronous block (atomic on the event loop), same-holdId re-acquire extends, release only if owner matches.
- **20 pods:** \`RedisSeatLockProvider\` — keys \`hold:{show}:{seat}\` with a TTL, multi-seat atomicity via a script on keys sharing a hash tag; the interface does not change.

**Where the truth lives:** not in either provider. Confirmation is a DB transaction: \`UPDATE booking … WHERE id = $1 AND hold_id = $2 AND status = 'PENDING_PAYMENT'\` plus \`INSERT booking_seat\` under \`UNIQUE(show_id, seat_id)\`. If Redis loses a key on failover or a pod pauses past TTL, the second confirm fails with a unique violation and gets refunded. **Two confirmed bookings for one seat are impossible**; at worst one user gets a refund.

**Why two layers:** the lock layer keeps 10K hold attempts/s off the database and gives fast "seat taken" feedback; the constraint makes correctness independent of clocks and caches.

**Java version:** a \`ReentrantLock\` per show (or per-seat locks acquired in sorted order to avoid deadlock) around check-and-set; \`ConcurrentHashMap.compute\` alone is per-key and cannot make four seats atomic.

**Tests:** inject the clock; U1 holds A5–A6, U2 fails on A6–A7, advance 11 minutes, U2 succeeds, U1 confirm rejected.`,
      followUps: [
        {
          q: 'Two people tap the last seat at the exact same millisecond on different pods. Walk me through what each sees.',
          a: 'Both requests hit the Redis provider; Redis executes commands serially per shard, so one \`SET NX PX\` (or script) wins and returns OK, the other sees the key and returns false. Winner gets a hold id and a 10-minute timer; loser gets "seat just taken" and a refreshed seat map within ~50 ms. If Redis somehow allowed both (failover), the DB unique constraint at confirm still lets only one booking through.',
        },
        {
          q: 'Why not use SELECT … FOR UPDATE on show_seat rows for the whole 10 minutes?',
          a: 'A row lock lives as long as the transaction, so you would keep a DB transaction and connection open for up to 10 minutes per user — with 5,000 concurrent holders that is 5,000 pinned connections and blocked vacuum. Holds must be **data with an expiry** (Redis TTL or a \`held_until\` column), not open transactions. Row locks are fine for the milliseconds of the confirm transaction.',
        },
        {
          q: 'How do you show a seat map that is consistent with holds without hammering Redis?',
          a: 'Seat map = static layout (cached per screen) + booked set from DB (cached per show, invalidated on confirm) + held set from Redis via one \`MGET\`/pipeline per show or a per-show hash of holds. Accept 1–2 s staleness on the map; the hold call is the authoritative check, so a stale "available" just yields a "taken" error.',
        },
      ],
      pitfalls: [
        'isBooked boolean on Seat',
        'Trusting the in-process Map across pods',
        'Release deleting the key without checking the holder',
        'Holding DB row locks for the payment window',
      ],
    },
    {
      id: 'lld-cases-1-iq-08',
      difficulty: 'expert',
      question:
        'The payment gateway confirms success 70 seconds after the user\'s 10-minute seat hold expired, and another user already holds two of the four seats. What does your booking service do, and how is that encoded in the booking lifecycle?',
      whatInterviewerLooksFor: [
        'Explicit lifecycle with guarded transitions',
        'Never overwrites another user\'s hold',
        'Partial availability handling (all-or-nothing vs offer alternatives)',
        'Idempotent webhook handling and refunds as first-class flows',
      ],
      modelAnswer: `**Lifecycle (State/transition table):** \`PENDING_PAYMENT\` → \`CONFIRMED\` (paid + seats secured) | \`EXPIRED\` (hold timed out, no payment) | \`PAID_UNSEATED\` (money in, seats lost) → \`REFUNDED\` or \`CONFIRMED\` (if re-seated with consent).

**On the late webhook:**
1. Dedupe by \`paymentRef\` (idempotency table). Second webhook returns the stored outcome.
2. Load booking; if the sweeper already moved it to \`EXPIRED\`, allow the special transition \`EXPIRED + PAYMENT_SUCCESS → PAID_UNSEATED\` (guarded: only within, say, 30 minutes).
3. Try to **re-acquire all four seats** with the original hold id. Here 2 of 4 are held by another user → acquire fails atomically; we do *not* take the free two.
4. Outcome: \`PAID_UNSEATED\`. Two options by product policy: (a) auto-refund immediately (\`REFUNDED\`), or (b) hold the money for 5 minutes and offer "4 seats together in row F" via \`SeatSelectionStrategy\`; user accepts → \`CONFIRMED\`, declines/timeout → \`REFUNDED\`.
5. Notify via Observer (push/SMS) with a clear message.

**Why not just confirm anyway?** Overwriting the other user's hold creates exactly the double booking the system exists to prevent; the DB \`UNIQUE(show_id, seat_id)\` would reject it anyway if they confirm first.

**Prevention:** make the hold slightly longer than the payment page timeout (hold 10 min, PSP session 8 min), and extend the hold when the user enters the payment page (\`acquire\` with the same hold id).

**Reconciliation:** a nightly job matches PSP settlements to bookings; any \`PAID_UNSEATED\` older than 30 minutes without a refund raises an alert — money must never sit unexplained.`,
      followUps: [
        {
          q: 'The refund API call itself times out. Is the user refunded?',
          a: 'Unknown, so treat it as a durable job: write \`refund_requested\` with an idempotency key (\`refund:<bookingId>\`) in the same transaction as \`PAID_UNSEATED\`, and let a worker call the PSP with that key until it gets a definitive answer. PSP idempotency ensures retries do not refund twice. The booking moves to \`REFUNDED\` only on confirmation.',
        },
        {
          q: 'Why keep both a hold TTL and a sweeper that marks bookings EXPIRED?',
          a: 'The TTL frees seats for others with zero coordination; the sweeper fixes the **booking row**, which otherwise stays PENDING forever and confuses "My bookings" and reconciliation. They are independent: TTL is about the seat resource, sweeper is about the order record. Lazy check on read (\`hold_expires_at < now()\`) covers the gap between them.',
        },
      ],
      pitfalls: [
        'Confirming the booking because "the user paid"',
        'Taking the two free seats and confirming a partial booking silently',
        'No idempotency on webhooks, causing double refunds',
      ],
    },
    {
      id: 'lld-cases-1-iq-09',
      difficulty: 'expert',
      question:
        'Splitwise\'s "simplify debts" for a trip group: explain how you compute the settlement list, whether your answer is optimal, and what you would ship.',
      context:
        'Reported in Uber SDE-2 interviews (Nov 2025) as a Splitwise design focused on minimising the number of transactions, and in Flipkart machine-coding rounds as "implement simplify debt".',
      whatInterviewerLooksFor: [
        'Reduce to net balances first (graph collapses to per-user numbers)',
        'Greedy algorithm with complexity and the n−1 bound',
        'Knows greedy is not optimal; gives a counterexample',
        'Exact formulation (zero-sum subsets), NP-hardness, DP limits, pragmatic choice',
      ],
      modelAnswer: `**Step 1 — net balances.** Sum every expense share and settlement per user: \`net[u] = paid − owed\` in paise. The pairwise graph is irrelevant now; Σ net = 0 (assert it).

**Step 2 — greedy (ship this by default).** Repeatedly match the largest debtor with the largest creditor, transfer \`min(|d|, c)\`; at least one user hits zero each round, so **≤ n−1 transfers**, O(n log n) with two heaps. Settlements are "natural": big debtors pay big creditors.

**Is it optimal? No.** Net balances (₹): A +300, B +400, C −200, D −200, E −300. Greedy: E→B 300, C→A 200, D→A 100, D→B 100 — **4** transfers. Optimal: E→A 300, C→B 200, D→B 200 — **3**, because {A,E} and {B,C,D} each sum to zero.

**Exact minimum:** min transfers = k − (max number of disjoint zero-sum subsets), k = non-zero users; each subset of size s needs s−1 transfers. It is NP-hard (contains subset-sum/partition). Bitmask DP: \`dp[mask] = max_{i∈mask} dp[mask−i] + [sum(mask)=0]\`, O(2ᵏ·k): k=15 → ~0.5M steps (instant), k=20 → ~21M (~tens of ms), k=30 infeasible.

**What I ship:** a \`DebtSimplifier\` Strategy: exact DP when k ≤ 15 (most trip groups), greedy above, with a cap on DP time. Also respect constraints greedy ignores: users can choose "don't simplify with people I don't know" (only transfer along existing edges — a different, flow-based problem), and amounts must stay in paise.

**Testing:** property tests — after applying transfers every net is 0; transfers ≤ k−1; exact ≤ greedy; compare DP to brute force for k ≤ 8.`,
      followUps: [
        {
          q: 'Users complain "simplify" made them pay someone they never shared an expense with. How do you change the algorithm?',
          a: 'Constrain transfers to the existing debt graph edges: it becomes a min-cost-flow / cycle-cancelling problem — find cycles in the pairwise debt graph and cancel the minimum edge along each cycle, and merge parallel paths only where both endpoints already transact. You lose some reduction but keep social acceptability. Offer it as a group setting; implement as another DebtSimplifier strategy.',
        },
        {
          q: 'Why does the DP compute subset sums by removing the lowest set bit?',
          a: '\`sum[mask] = sum[mask without lowest bit] + v[index of lowest bit]\` reuses an already computed smaller mask, so all 2ᵏ subset sums cost O(2ᵏ) instead of O(2ᵏ·k). \`mask & -mask\` isolates the lowest bit and \`31 − clz32\` gives its index. The dominant cost is then the dp transition loop over k bits.',
        },
        {
          q: 'A group has 300 members (a college fest). Anything change?',
          a: 'Exact is impossible; greedy with heaps is O(n log n), trivial for 300. But most members have tiny balances; add a rounding policy (ignore balances under ₹1 by a final pooled adjustment to the organiser) and batch-notify. Also compute it on demand, not on every expense write, and cache per group version.',
        },
      ],
      pitfalls: [
        'Claiming greedy is optimal',
        'Running simplification on pairwise edges instead of net balances',
        'Using floats so balances never sum to exactly zero',
      ],
    },
    {
      id: 'lld-cases-1-iq-10',
      difficulty: 'hard',
      question:
        'In your Splitwise clone a ₹1,000 dinner is split three ways, someone else enters 33.33% / 33.33% / 33.34%, and a third expense uses shares 2:1:1. Design the split model so every case sums to the exact total and a new split type can be added without touching ExpenseService.',
      context:
        'Reported in Acko SDE-1 (2025) and Groww machine-coding rounds: users, groups, expenses with equal/unequal/percent splits, balances within and across groups, fully working code in 60–90 minutes.',
      whatInterviewerLooksFor: [
        'Integer paise and a deterministic remainder policy',
        'Strategy per split type with its own validation; Factory/registry',
        'Validation errors that are user-meaningful',
        'Invariant tests (sum of shares = total, Σ net = 0)',
      ],
      modelAnswer: `**Money:** store paise as integers (\`number\` is safe to 2^53; use \`bigint\` only for ledgers in the trillions). ₹1,000 = 100,000 paise.

**Interface:** \`SplitStrategy.split(totalPaise, input: Map<userId, number>): Share[]\`. \`ExpenseService.add(expense)\` looks up \`SplitFactory.get(type)\`, gets shares, asserts \`Σ shares === total\`, writes ledger rows, updates balances. It never branches on type.

**Implementations:**
- **Equal:** base = floor(100,000/3) = 33,333, remainder 1 → first participant (ordered deterministically, e.g. by payer first or user id) gets 33,334. Sum = 100,000.
- **Exact:** validates Σ = total; error "Shares add up to ₹999.99, expected ₹1,000.00".
- **Percent:** input in basis points (3,333/3,333/3,334 = 10,000 required); floor each, then **largest-remainder** distributes leftover paise: 33,330 + 33,330 + 33,340. Using basis points avoids 33.33 float input.
- **Shares 2:1:1:** same weighted algorithm without the 10,000 requirement: 50,000/25,000/25,000.

Percent and Shares share one \`WeightedSplit\` class configured differently — reuse via composition.

**Adding "by adjustment" (equal ± fixed deltas):** new class \`AdjustmentSplit\` + one registry line. ExpenseService unchanged — that is the OCP proof interviewers want.

**Validation placement:** each strategy validates its own input (it knows its rules); ExpenseService validates cross-cutting things (participants are group members, total > 0, payers sum to total).

**Tests:** table tests per strategy; property test: for random totals and weights, Σ shares = total and every share ≥ 0; Σ net balances in the group = 0 after any sequence.`,
      followUps: [
        {
          q: 'Who should get the extra paisa in an equal split — and does it matter?',
          a: 'It matters for disputes and reproducibility, not for money. Choose a deterministic, explainable rule: give remainders to the payer first (they already fronted money, so their net is reduced) or rotate by expense id hash so no one systematically pays more. Persist the computed shares on the expense; never recompute later with a different rule, or historical balances change.',
        },
        {
          q: 'An expense is edited from equal to percent after two settlements were made. How do balances stay correct?',
          a: 'Treat edits as **reversal + new version** in the ledger: insert negative shares for v1 and positive shares for v2 in one transaction, bump \`expense.version\` with optimistic concurrency. Settlements are separate ledger rows and are not touched; the net balances naturally reflect the new split, possibly making someone owed money back.',
        },
      ],
      pitfalls: [
        'Math.round per person, losing or creating a paisa',
        'Accepting percentages as floats and comparing sum === 100',
        'A switch on split type inside ExpenseService',
      ],
    },
    {
      id: 'lld-cases-1-iq-11',
      difficulty: 'hard',
      question:
        'Two roommates add expenses to the same group from their phones at the same second, and one of them also edits an older grocery expense. Users report their "you owe" totals drift by a few rupees after busy weekends. Diagnose and fix the Splitwise backend.',
      whatInterviewerLooksFor: [
        'Spots read-modify-write on denormalised balances',
        'Atomic increments in the same transaction as ledger inserts',
        'Optimistic concurrency for edits of the same expense',
        'Idempotency for client retries and a rebuild-from-ledger check',
      ],
      modelAnswer: `**Likely causes of drift:**
1. **Read-modify-write on \`balance\` rows in app code:** both requests read A→B = ₹200, each adds its delta, last write wins — one expense's effect vanishes.
2. **Ledger and balance updates in separate transactions:** a crash between them leaves the projection out of sync.
3. **Mobile retries** without idempotency create a duplicate expense (a few rupees each time).
4. **Concurrent edits of the same expense** both reverse v1 and apply their own version → double reversal.

**Fixes:**
- Ledger insert + balance update in **one transaction**, using \`UPDATE balance SET paise = paise + $delta WHERE group_id = $g AND user_id = $u\` (atomic in the DB, no app-side read). Lock order by user id when updating multiple rows to avoid deadlocks.
- \`POST /expenses\` requires an \`Idempotency-Key\`; unique index \`(group_id, idempotency_key)\`.
- Edits: \`UPDATE expense SET version = version + 1 … WHERE id = $id AND version = $expected\`; 0 rows → 409, client re-reads and re-applies.
- **Self-healing:** balances are a projection; a nightly job rebuilds \`net\` from the ledger per group and alerts on any difference (should be 0). Σ net = 0 per group is checked on every write in tests.

**In-memory machine-coding version:** Node's single thread already serialises synchronous \`addExpense\`; the bug appears only if you \`await\` between reading and writing the balance map. Java: \`ConcurrentHashMap.merge(key, delta, Long::sum)\` per pair, but multi-row updates for one expense still need a lock per group to be atomic as a whole.`,
      followUps: [
        {
          q: 'A group of 40 with heavy activity starts showing lock waits on balance rows. What now?',
          a: 'Store balances as **net per user per group** (40 rows) rather than pairwise (up to 780 rows), and append ledger rows only, deriving balances asynchronously via a per-group queue (single consumer per group key in Kafka/SQS FIFO). Writes become append-only and lock-free; reads may lag by a second, which is acceptable for Splitwise. Keep the projection version so the UI can show "updating…".',
        },
        {
          q: 'How do you prove the rebuild job and the live projection agree after a migration?',
          a: 'Run both in shadow: compute balances from the ledger into a temp table and diff against live balances per group, reporting groups with non-zero difference and the sum of absolute differences. Gate the migration on zero diffs for 24 hours, and keep the diff as a permanent canary metric.',
        },
      ],
      pitfalls: [
        'Blaming rounding without checking for lost updates',
        'Adding a Node mutex in a multi-pod deployment',
        'Editing expenses in place without versions or reversals',
      ],
    },
    {
      id: 'lld-cases-1-iq-12',
      difficulty: 'expert',
      question:
        'Across parking lot, elevator, ticket booking and expense splitting, where exactly is the contended state in each, and what concurrency primitive would you choose for each in Node and in Java? Defend why they differ.',
      whatInterviewerLooksFor: [
        'Identifies contended unit precisely per case',
        'Matches primitive to contention shape (single writer, conditional update, TTL lease, atomic increment)',
        'Knows Node event-loop atomicity and its await caveat',
        'Gives Java equivalents without over-locking',
      ],
      modelAnswer: `| Case | Contended unit | Shape | Node (1 process) | N pods | Java (1 JVM) |
|---|---|---|---|---|---|
| Parking | a free spot of a size | many claimers, many resources | sync pick+mark, no await between | \`FOR UPDATE SKIP LOCKED\` / conditional UPDATE | \`ConcurrentLinkedQueue\` per size, \`poll()\` |
| Elevator | a car's stop set and state | few writers, continuous control | single-writer tick loop | one leader per bank (lease) | actor per car, \`BlockingQueue\` |
| Booking | a (show, seat) pair for minutes | extreme bursts on few keys, long hold | sync check-all-then-set Map with TTL | Redis TTL lease + DB unique constraint | \`ReentrantLock\` per show or sorted per-seat locks |
| Splitwise | a group's balances | low rate, multi-row money updates | sync update; no await mid-update | transaction + atomic increments + version | \`ConcurrentHashMap.merge\` + group lock |

**Why they differ:**
- **Parking** resources are interchangeable; you do not need *that* spot, just *a* spot, so skipping locked rows beats waiting.
- **Elevator** is a control loop; correctness is about ordering commands, so a single writer is simpler and safer than locks around physics.
- **Booking** resources are *not* interchangeable (the user wants A7) and ownership spans minutes, so a lease with expiry is the right primitive, and a durable constraint protects against lease failures.
- **Splitwise** is accounting; updates must be atomic across rows and auditable, so DB transactions and increments, plus optimistic versions for edits.

**Node caveat:** the event loop makes synchronous blocks atomic in one process — that is a gift in machine-coding rounds, but any \`await\` inside the critical section reintroduces races, and it means nothing across pods or \`worker_threads\` (which need \`Atomics\`/\`SharedArrayBuffer\` or message passing).`,
      followUps: [
        {
          q: 'Would SERIALIZABLE isolation solve all four in one stroke?',
          a: 'It would make the DB-backed parts correct but at a cost: serialization failures under bursts (booking on-sales, festival parking) cause retry storms, and it does nothing for in-memory elevator state or Redis holds. Use targeted primitives — conditional updates and constraints are cheaper and explain themselves. SERIALIZABLE is reasonable for low-rate Splitwise multi-row updates if you implement retries.',
        },
        {
          q: 'In the elevator case, why not just put a mutex around each car?',
          a: 'The dispatcher reads all cars to choose one, so per-car mutexes either need ordered acquisition of all six (deadlock-prone, slow) or allow decisions on inconsistent snapshots. A single writer per bank processes ~10 events/second easily, removes locking entirely and makes the system deterministic and testable by replaying the command log.',
        },
      ],
      pitfalls: [
        'One answer ("use Redis lock") for all four',
        'Assuming async functions in Node are atomic',
        'Ignoring the difference between interchangeable and specific resources',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'lld-cases-1-boe-1',
      question:
        'A Bengaluru mall lot has 3,200 spots over 4 floors and 8 entry gates. On a Saturday 6–7 p.m. peak, estimate the spot-claim rate, the cost of a linear-scan allocation vs indexed claim, and the in-memory footprint if one service instance keeps all spot state.',
      assumptions: [
        '75% of spots turn over during the peak hour (people arriving for dinner/movies)',
        'Arrivals concentrated: peak 10-minute window carries 30% of the hour',
        'Spot object ≈ 200 bytes in V8 (id, floor, size, charger, distance map for 8 gates, occupiedBy)',
        'Linear scan of one spot ≈ 10 ns in V8 for the fit/score checks',
      ],
      steps: [
        { label: 'Hourly entries', calc: '3,200 × 0.75 ≈ 2,400 entries/hour' },
        { label: 'Peak 10-minute rate', calc: '2,400 × 0.30 ÷ 600 s ≈ 1.2 claims/s overall ≈ 0.15/s per gate' },
        { label: 'Linear-scan cost', calc: '3,200 spots × 10 ns ≈ 32 µs per claim → 1.2 × 32 µs ≈ 0.004% of one core' },
        { label: 'Indexed SQL claim', calc: 'partial index on free spots + SKIP LOCKED ≈ 1–2 ms per claim → ~2 ms × 1.2/s, negligible DB load' },
        { label: 'Memory', calc: '3,200 × 200 B ≈ 640 KB (+ tickets 3,200 × 150 B ≈ 480 KB) ≈ ~1 MB' },
      ],
      answer:
        'About 1–2 claims per second at peak; a linear scan costs ~32 µs and all state fits in ~1 MB. Performance is a non-issue; correctness across gates/pods is the whole problem.',
      insight:
        'Do not over-engineer allocation data structures (heaps, segment trees) for a mall — say the numbers and spend your design budget on the atomic claim, idempotent tickets and the pricing seam. Heaps only matter for airport-scale lots with 50K+ spots and dozens of gates.',
      followUps: [
        {
          q: 'An airport has 60,000 spots and 40 gates with ~25 claims/s at peak. Does linear scan still work?',
          a: '60,000 × 10 ns = 600 µs per claim; × 25/s ≈ 15 ms CPU per second (1.5% of a core) — still workable in one process, but the scan becomes visible in p99 when GC pauses stack. Switch to per-gate, per-size min-heaps keyed by distance with lazy deletion (O(log n) ≈ 16 comparisons), or in SQL a partial index ordered by \`(size, dist_gate_n)\` so the claim reads one index page.',
        },
      ],
    },
    {
      id: 'lld-cases-1-boe-2',
      question:
        'A 40-floor office tower holds 4,000 people who mostly arrive between 9:00 and 9:30. Estimate how many elevator cars are needed for an up-peak target of ≤ 40 s average interval, and what that implies for the dispatch strategy.',
      assumptions: [
        '80% of occupants arrive in the 30-minute window; car capacity 16 persons, loaded to 80% (≈ 13)',
        'Car speed 2.5 m/s, floor height 3.5 m; each stop costs ~10 s (decelerate, doors, dwell, accelerate)',
        'With 13 passengers going to random floors among 39, a car makes ~11 stops per up-trip (probable stops formula)',
        'Round trip time (RTT) = express return + up trip travel + stops',
      ],
      steps: [
        { label: 'Arrival rate', calc: '4,000 × 0.8 ÷ 1,800 s ≈ 1.8 persons/s ≈ 107 persons/min' },
        { label: 'Travel time', calc: 'highest stop ≈ floor 38 → 38 × 3.5 m = 133 m; up + down ≈ 266 m ÷ 2.5 m/s ≈ 106 s' },
        { label: 'Stop time', calc: '~11 stops × 10 s + lobby loading 15 s ≈ 125 s' },
        { label: 'Round trip', calc: 'RTT ≈ 106 + 125 ≈ 230 s' },
        { label: 'Handling per car', calc: '13 persons per 230 s ≈ 0.057 persons/s per car' },
        { label: 'Cars needed', calc: '1.8 ÷ 0.057 ≈ 32 cars (!) ; interval = RTT ÷ cars = 230 ÷ 32 ≈ 7 s' },
        { label: 'With 2 zones (low 1–20, high 21–39)', calc: 'stops per trip ≈ 8, travel shorter for low zone → RTT ≈ 150–190 s → ≈ 22–26 cars total' },
      ],
      answer:
        'Without zoning a single bank would need ~30 cars, which no building has; zoning into low/high banks (and sky lobbies or destination dispatch) brings it to ~20–26 cars split across banks, each bank of 6–8 cars hitting a 30–40 s interval.',
      insight:
        'Stops per trip dominate round-trip time, not travel distance. That is why the dispatcher for up-peak must reduce stops per trip — zoning, express cars, or destination dispatch that groups passengers by floor — rather than "nearest car". In the LLD, this justifies Dispatcher as a swappable Strategy selected by time of day.',
      followUps: [
        {
          q: 'Management installs destination dispatch, cutting stops per trip from 11 to 5. How many cars do you save?',
          a: 'Stop time drops to 5 × 10 + 15 = 65 s; travel stays ≈ 106 s; RTT ≈ 171 s. Per car 13 ÷ 171 ≈ 0.076 persons/s; cars ≈ 1.8 ÷ 0.076 ≈ 24 versus ~32 — roughly 25% fewer cars for the same load. In the class design this is a new Request kind (destination entered in the lobby) and a dispatcher that batches by destination group.',
        },
      ],
    },
    {
      id: 'lld-cases-1-boe-3',
      question:
        'Your Splitwise service runs exact debt simplification (bitmask DP) when a user taps "Simplify". Estimate CPU cost per call for groups of 10, 15, 20 and 25 non-zero members and decide the cutoff for falling back to greedy, given 2,000 simplify taps per second at peak (month-end).',
      assumptions: [
        'DP cost ≈ 2ⁿ × n inner iterations; ~2 ns per iteration in V8 for tight integer loops',
        'Two arrays of 2ⁿ numbers (8 bytes each)',
        'Group size distribution at peak: 90% ≤ 10, 9% 11–15, 1% > 15 non-zero members',
        'Per-pod CPU budget for simplify: 20% of 8 cores across 10 pods',
      ],
      steps: [
        { label: 'n = 10', calc: '1,024 × 10 ≈ 10K iterations × 2 ns ≈ 20 µs; memory 2 × 8 KB' },
        { label: 'n = 15', calc: '32,768 × 15 ≈ 0.5M × 2 ns ≈ 1 ms; memory ≈ 0.5 MB' },
        { label: 'n = 20', calc: '1.05M × 20 ≈ 21M × 2 ns ≈ 42 ms; memory ≈ 16 MB' },
        { label: 'n = 25', calc: '33.5M × 25 ≈ 840M × 2 ns ≈ 1.7 s; memory ≈ 540 MB → unacceptable' },
        { label: 'Peak load with cutoff 15', calc: '2,000/s × (0.9 × 20 µs + 0.09 × 1 ms + 0.01 × greedy ~5 µs) ≈ 2,000 × 0.108 ms ≈ 0.22 core-seconds/s' },
        { label: 'Budget', calc: '10 pods × 8 cores × 20% = 16 cores ≫ 0.22 cores; cutoff 20 would add 2,000 × 0.01 × 42 ms ≈ 0.84 cores, still fine but p99 = 42 ms + GC' },
      ],
      answer:
        'Exact DP is free up to ~15 members (~1 ms), acceptable at 20 (~40 ms, 16 MB), and impossible at 25 (~1.7 s, ~0.5 GB). A cutoff of 15–18 with greedy above keeps CPU under one core and p99 low.',
      insight:
        'Exponential algorithms are a product decision: gate them by input size, run them in a worker_thread so a 40 ms DP does not block the event loop for other requests, and cache the result per group ledger version so repeated taps cost nothing.',
      followUps: [
        {
          q: 'You must support exact simplification for groups of 25 for a premium tier. What changes?',
          a: 'Shrink n first: users with identical opposite balances pair off directly (removes 2 per match), and zero balances are dropped; often 25 becomes ~15. Otherwise run it asynchronously in a job queue with a time limit, return greedy immediately and upgrade the plan when the exact result lands, and use meet-in-the-middle or ILP solvers rather than the plain 2ⁿ DP.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'lld-cases-1-mcq-01',
      difficulty: 'hard',
      question:
        'This parking service runs in a single Node process with 4 entry gates calling park() concurrently. Floor sensors later show two cars on spot F1-07. What is the cause?',
      code: {
        language: 'typescript',
        code: `async park(v: Vehicle, gateId: string) {
  const spot = await this.repo.findBestFree(v.size, gateId); // SELECT ... LIMIT 1
  if (!spot) throw new Error('FULL');
  await this.audit.log('assigning', spot.id);                 // HTTP call, ~15 ms
  spot.occupiedBy = v.plate;
  await this.repo.save(spot);
  return spot.id;
}`,
      },
      options: [
        'Node runs async functions on multiple threads, so two gates mutate the spot object in parallel',
        'Between the read of the free spot and the write, two awaits yield the event loop, so another gate reads the same spot as free',
        'repo.save() is not idempotent, so a retried save writes the vehicle twice',
        'The audit HTTP call reorders the SQL statements inside the connection pool',
      ],
      correct: [1],
      explanation:
        'Node is single-threaded, but every await is a yield point. Gate 2 can run findBestFree while gate 1 is waiting on the audit call, and both see F1-07 free. The fix is to claim atomically (mark before any await, or a conditional UPDATE … WHERE occupied_by IS NULL). Multiple threads is the Java mental model, not Node; save idempotency and pool reordering do not explain two different plates on one spot.',
      followUps: [
        {
          q: 'You move spot.occupiedBy = plate directly after findBestFree. Is it fixed?',
          a: 'Not fully: findBestFree itself awaits a DB query, so two gates can both receive the same row before either marks it. You either keep the authoritative free list in memory and pick+mark synchronously, or make the DB do the claim in one statement (\`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED) RETURNING id\`).',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-02',
      difficulty: 'medium',
      question:
        'Your parking design has Bike, Car and Truck subclasses each overriding canFitIn(spot). The mall now says SUVs may take a LARGE spot or, if none, two adjacent MEDIUM spots. Which change keeps the design closest to open/closed?',
      options: [
        'Add an Suv subclass that overrides canFitIn and edit Car to exclude SUVs from MEDIUM spots',
        'Model vehicles as data (size, needsCharger) and add an allocation strategy decorator that can return a pair of adjacent MEDIUM spots',
        'Add an isSuv flag to Vehicle and a branch for it in ParkingLot.park()',
        'Create a SpotFactory that converts two MEDIUM spots into one LARGE spot permanently',
      ],
      correct: [1],
      explanation:
        'Fit rules belong in the allocation policy, not scattered across vehicle subclasses; a decorator over the strategy adds the two-adjacent-spots behaviour without touching existing code. The subclass route forces edits to Car as well, the flag adds a branch in the orchestrator, and permanently merging spots changes capacity for everyone rather than allocating per vehicle.',
      followUps: [
        {
          q: 'How does exit and billing work when one ticket holds two spots?',
          a: 'Make the ticket reference a list of spot ids (an allocation), free all of them on exit in one operation, and let pricing use the vehicle profile (SUV tariff), not the spot count — unless the business explicitly charges per spot, which is then one FeeRule reading the allocation size.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-03',
      difficulty: 'expert',
      question:
        'The parking backend now runs 3 pods against one Postgres. Which mechanisms on their own prevent two active tickets for the same spot? Select ALL that apply.',
      options: [
        'UPDATE spot SET occupied_ticket_id = $1 WHERE id = $2 AND occupied_ticket_id IS NULL, treating rowCount = 0 as "taken, retry"',
        'An async-mutex instance in each pod wrapped around the allocation method',
        'Claiming with a subquery that uses FOR UPDATE SKIP LOCKED inside the same UPDATE statement',
        'Reading free spots under READ COMMITTED, then updating by id without any predicate on occupancy',
        'A partial unique index on ticket(spot_id) WHERE exited_at IS NULL',
      ],
      correct: [0, 2, 4],
      explanation:
        'The conditional UPDATE and the SKIP LOCKED claim make the database arbitrate each spot, and the partial unique index rejects a second active ticket even if application logic regresses. A per-pod mutex only serialises within one process, and read-then-update without an occupancy predicate is the original lost-update race.',
      followUps: [
        {
          q: 'Which of the three would you choose for the hot path, and why?',
          a: 'SKIP LOCKED in one statement: it chooses the best free spot and claims it without waiting on rows other gates are claiming, so no retry loop. Keep the partial unique index as a safety net; the conditional update is the fallback when the app picks the spot itself via an in-memory strategy.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-04',
      difficulty: 'hard',
      question:
        'With this fee function (car: ₹40 first 2 hours, ₹20 per additional hour), what do a 2h29m stay and a 20-minute stay cost, and what is the defect?',
      code: {
        language: 'typescript',
        code: `function carFee(entry: Date, exit: Date): number {
  const hours = Math.round((exit.getTime() - entry.getTime()) / 3_600_000);
  return hours <= 2 ? 40 : 40 + (hours - 2) * 20;
}`,
      },
      options: [
        '₹60 and ₹40 — the code is correct for "per hour or part thereof"',
        '₹40 and ₹40 — Math.round under-bills the partial third hour; it should be Math.ceil of started hours',
        '₹40 and ₹0 — a 20-minute stay rounds to 0 hours and is free',
        '₹60 and ₹20 — rounding happens per started half hour',
      ],
      correct: [1],
      explanation:
        '2h29m = 2.48 h rounds to 2 → ₹40, losing the started third hour (should be ₹60). The 20-minute stay rounds to 0, but hours ≤ 2 still returns ₹40, so it is not free here — that tempting answer applies to the per-hour bike formula. The fix is Math.ceil on minutes/60 (with a minimum of 1), and integer paise for amounts.',
      followUps: [
        {
          q: 'Finance wants a 10-minute grace period after each started hour. Where does it go?',
          a: 'In the duration policy, not every tariff: compute billable hours as ceil((minutes − grace) / 60) with a floor of 1, implemented once as a \`BillableDuration\` helper or a \`GraceRule\` that adjusts the stay context before slab rules run. Document it on the receipt line.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-05',
      difficulty: 'hard',
      question:
        'A car is at floor 12 moving UP using LOOK. Pending: cab call to 18, hall call at 15 (DOWN), hall call at 20 (UP). No other requests. In which order does it stop?',
      options: ['15, 18, 20', '18, 20, 15', '18, 20, 39, 15', '18, 15, 20'],
      correct: [1],
      explanation:
        'Moving up, the car stops for cab calls and UP hall calls ahead (18, then 20), passing the DOWN call at 15 because it is behind and in the opposite direction. At 20 there is nothing further up, so LOOK reverses there (SCAN would continue to the top, the 39 distractor) and serves 15 on the way down. Stopping at 15 first ignores direction; reversing at 18 abandons the UP caller at 20.',
      followUps: [
        {
          q: 'While at 20, someone at 25 presses DOWN. What happens under LOOK?',
          a: 'If the car has not yet reversed, 25 is now ahead in the UP direction, so it continues up to 25 (its new turnaround), serves the DOWN call there, then reverses for 15. If it already reversed, the dispatcher should give 25▼ to another car or this car serves it on its next up sweep.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-06',
      difficulty: 'expert',
      question:
        'This elevator dispatcher runs in one Node process. Under load, two cars sometimes arrive for one press and some hall calls are served by a car that has already passed the floor. What is the root cause?',
      code: {
        language: 'typescript',
        code: `async assignHallCall(floor: number, dir: Dir) {
  const cars = await this.redis.getCarSnapshots();   // positions published every 500 ms
  const best = pickNearestIdle(cars, floor) ?? pickNearest(cars, floor);
  await this.redis.lpush('car:' + best.id + ':stops', floor);
}
// elsewhere: each car worker pops its own Redis list and moves`,
      },
      options: [
        'lpush is not atomic in Redis, so two pushes for the same floor interleave',
        'Decisions are made on a stale, external snapshot by multiple concurrent callers with no single owner of car state, so concurrent calls choose the same idle car and positions are up to 500 ms old',
        'The nearest-car heuristic is wrong; switching to SCAN would fix duplicate arrivals',
        'Redis lists are FIFO, so the car serves stops in arrival order, which causes duplicate arrivals',
      ],
      correct: [1],
      explanation:
        'Every assignHallCall awaits a snapshot that can be 500 ms old and acts on it; two calls in flight both see car 2 as idle, and a moving car may have passed the floor. LPUSH is atomic; the algorithm choice and FIFO ordering cause inefficiency, not double dispatch. The fix is a single writer that owns live car state and deduplicates hall calls.',
      followUps: [
        {
          q: 'You must keep car workers as separate processes. How do you restore a single owner?',
          a: 'Make one dispatcher the only assigner (leader-elected), consuming hall calls from one queue in order and holding authoritative car state from direct worker heartbeats, not polled snapshots. Workers accept stop commands only from the leader with a fencing token, and acknowledge them, so assignments are serialized and never duplicated.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-07',
      difficulty: 'expert',
      question:
        'Car 4 is detected as stuck between floors with 3 assigned hall calls and 2 cab calls from passengers inside. Select ALL correct behaviours for the controller.',
      options: [
        'Return the 3 hall calls to the dispatcher for reassignment to other cars',
        'Re-dispatch the 2 cab calls to the nearest other car so passengers are not delayed',
        'Keep the doors closed and stop accepting new hall calls for car 4 until a technician returns it to service',
        'Open the doors immediately so passengers can climb out',
        'Emit an incident event to monitoring and the intercom/rescue workflow',
      ],
      correct: [0, 2, 4],
      explanation:
        'Hall calls belong to the bank and must be reassigned, the car leaves the dispatch pool and stays safe, and an incident event drives rescue and alerting. Cab calls are requests by people inside car 4 — another car cannot serve them. Opening doors between floors creates a fall hazard; evacuation is a trained rescue operation.',
      followUps: [
        {
          q: 'Where in your class design does "stop accepting hall calls" live?',
          a: 'In the state object: \`OutOfServiceState.acceptsHallCalls()\` returns false. \`Car.setState\` notifies the controller on transitions to a non-accepting state, which evicts and re-enqueues hall calls; the dispatcher filters the pool by \`acceptsHallCalls()\`. No if-checks on a stuck flag scattered through the code.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-08',
      difficulty: 'medium',
      question:
        'Your elevator Car has an enum mode and a switch in five methods. The team adds an "attendant service" mode and forgets one branch; the car now accepts hall calls in that mode. Which refactor most directly prevents this class of bug?',
      options: [
        'Add unit tests for every switch statement',
        'Replace the enum with State classes so each mode implements the full behaviour interface, and the compiler forces every method to exist for the new mode',
        'Move all switches into one giant handleEvent(event, mode) method',
        'Use a Strategy for dispatching hall calls to cars',
      ],
      correct: [1],
      explanation:
        'With State, a new mode is a class implementing the whole interface; TypeScript will not compile if acceptsHallCalls or onTick is missing, so a forgotten branch is impossible. Tests help but do not force completeness; one giant method concentrates the problem; dispatch Strategy addresses car choice, not per-mode behaviour.',
      followUps: [
        {
          q: 'With only two modes ever planned, would you still use State?',
          a: 'Probably not: an enum with an exhaustive switch (TypeScript \`never\` check in the default branch) gives the same compile-time completeness at lower ceremony. State pays off when there are many modes, mode-specific data (dwell counters, stuck ticks) and safety rules per mode.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-09',
      difficulty: 'hard',
      question:
        'In a 35-floor office building, the nearest-car dispatcher works well all day but at 9 a.m. lobby queues reach 4 minutes while cars travel half-empty to scattered floors. Which change targets the actual bottleneck?',
      options: [
        'Switch each car from LOOK to SCAN so cars always reach the top floor',
        'Increase car speed from 2.5 m/s to 4 m/s',
        'Swap in an up-peak dispatch strategy: zone cars by floor ranges and send idle cars back to the lobby',
        'Assign every hall call to all idle cars and let the first arrival serve it',
      ],
      correct: [2],
      explanation:
        'At up-peak, round-trip time is dominated by the number of stops, so reducing stops per trip via zoning and fast return to the lobby raises handling capacity. Faster cars barely help because stops cost ~10 s each. SCAN adds wasted travel, and broadcasting calls to all cars wastes capacity.',
      followUps: [
        {
          q: 'How do you switch strategies at 9 a.m. without restarting?',
          a: 'Inject a \`DispatcherSelector\` that returns a strategy based on time and observed traffic (lobby call rate > threshold), evaluated per assignment. Strategies are stateless or keep their own state, so swapping is just a reference change inside the single-writer loop; log every switch for tuning.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-10',
      difficulty: 'expert',
      question:
        'Seat holds use this release method. U1 held A7 at 18:00 with a 10-minute TTL, went idle, and U2 held A7 at 18:11. At 18:12 U1 taps "Cancel". What happens?',
      code: {
        language: 'typescript',
        code: `async release(showId: string, seatIds: string[], _holdId: string) {
  for (const s of seatIds) {
    await this.redis.del('hold:{' + showId + '}:' + s);
  }
}`,
      },
      options: [
        'Nothing; U1\'s hold already expired, so the delete is a no-op',
        'U2\'s live hold on A7 is deleted, so a third user can hold A7 while U2 is paying',
        'Redis rejects the delete because the key is owned by another client connection',
        'The delete fails with CROSSSLOT because of the hash tag in the key',
      ],
      correct: [1],
      explanation:
        'The key now belongs to U2, and release ignores the hold id, so it deletes U2\'s lease. Redis has no notion of key ownership by connection, and the hash tag only matters for multi-key commands. The fix is compare-and-delete (only delete if the stored value equals the caller\'s hold id), atomically via a script.',
      followUps: [
        {
          q: 'If this bug ships, can a seat end up confirmed for two users?',
          a: 'Not if confirmation inserts into \`booking_seat\` with \`UNIQUE(show_id, seat_id)\`: U2 and the third user may both reach payment, but only the first confirm commits; the second gets a unique violation and an automatic refund. The bug degrades experience (a paid user refunded) but the durable guard keeps inventory correct.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-11',
      difficulty: 'hard',
      question:
        'A junior models the cinema as Screen → Seat with a boolean isBooked on Seat, plus Show(screen, startsAt). Which bug report will arrive first?',
      options: [
        'Seat prices cannot differ between RECLINER and CLASSIC categories',
        'Booking A7 for the 6 p.m. show makes A7 unavailable for the 9 p.m. show on the same screen',
        'Two users cannot hold seats in the same row at once',
        'Shows cannot be cancelled once tickets are sold',
      ],
      correct: [1],
      explanation:
        'Availability belongs to the (show, seat) pair; putting it on the physical seat shares state across every show of that screen. Category pricing is a separate modelling issue, row-level concurrency is unaffected by this choice, and cancellation is a lifecycle concern unrelated to the boolean.',
      followUps: [
        {
          q: 'Do you persist a ShowSeat row for every seat of every show, or derive it?',
          a: 'Either works; deriving (layout + booking_seat rows + holds) avoids writing 300 rows per show and keeps one source of truth, while persisting ShowSeat simplifies queries and per-show seat blocking (e.g. broken seats). Many systems persist only exceptions — booked or blocked seats — and treat absence as available.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-12',
      difficulty: 'expert',
      question:
        'After a Redis failover, some seat-hold keys were lost and two users completed payment for seat C12 of the same show. Which mechanisms still guarantee that at most one CONFIRMED booking includes C12? Select ALL that apply.',
      options: [
        'A UNIQUE (show_id, seat_id) constraint on the booking_seat table, inserted inside the confirm transaction',
        'The 10-minute TTL on the Redis hold key',
        'Confirm executed as UPDATE booking … WHERE id = $1 AND hold_id = $2 AND status = \'PENDING_PAYMENT\' in the same transaction as the seat insert',
        'A ConcurrentHashMap of held seats inside each Java pod',
      ],
      correct: [0, 2],
      explanation:
        'The unique constraint is enforced by the database regardless of what the cache says, and the conditional status update ensures each booking is confirmed once and only under its own hold, both inside one transaction. The TTL is exactly what failed, and a per-pod map cannot see holds made on other pods.',
      followUps: [
        {
          q: 'The second user\'s confirm fails with a unique violation. What should the API return and do?',
          a: 'Roll back, mark the booking \`PAID_UNSEATED\`, enqueue an idempotent refund (key \`refund:<bookingId>\`), and return a clear 409 with alternatives ("C12 was just taken — 2 similar seats in row D?"). Emit a metric: unique violations at confirm should be ~0; a spike means the hold layer is misbehaving.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-13',
      difficulty: 'expert',
      question:
        'A Java booking service uses a ReentrantLock per seat. User X selects {B4, B5} and user Y selects {B5, B4}; occasionally both requests hang forever. What is the minimal correct fix?',
      options: [
        'Use tryLock with a 10-second timeout and silently continue if it fails',
        'Acquire the per-seat locks in a canonical order (e.g. sorted seat id) and release in reverse',
        'Replace ReentrantLock with synchronized blocks on each Seat object',
        'Make the seat map a ConcurrentHashMap so locks are no longer needed',
      ],
      correct: [1],
      explanation:
        'Each thread holds one seat lock and waits for the other — a lock-ordering deadlock. Sorting acquisition removes the cycle. tryLock plus continuing would break all-or-nothing semantics, synchronized has the same ordering problem, and ConcurrentHashMap only makes single-key operations atomic, not multi-seat holds.',
      followUps: [
        {
          q: 'Would one lock per show be simpler, and what does it cost?',
          a: 'Yes — one lock per show removes ordering concerns entirely. Cost: all holds for that show serialize. A hold is a few microseconds of in-memory work, so even 5,000 attempts/s on one show fit; it only becomes a problem if I/O happens inside the lock, which you should never do.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-14',
      difficulty: 'hard',
      question:
        'Holds last 10 minutes; the payment page session lasts 15 minutes. Support sees users charged with no ticket. Which change addresses the root cause rather than the symptom?',
      options: [
        'Run the expiry sweeper every 10 seconds instead of every minute',
        'Make holds shorter than the payment session so users retry sooner',
        'Bound the payment session below the hold TTL and extend the hold (same hold id) when the user enters payment, while keeping a late-payment refund path',
        'Store holds in Postgres instead of Redis',
      ],
      correct: [2],
      explanation:
        'Users can legitimately pay after their hold expired because the payment window outlives the hold. Aligning windows and extending the hold at payment entry removes most cases, and the refund path covers PSP delays. Faster sweeping or shorter holds make it worse, and changing the store does not change the timing mismatch.',
      followUps: [
        {
          q: 'How many times may a user extend a hold before you stop?',
          a: 'Cap it: one extension of ~5 minutes at payment entry, tied to a live payment intent. Unlimited extensions let scalpers or bots keep seats out of circulation. Enforce in the lock provider by storing \`extensions\` on the lease and rejecting the third request.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-15',
      difficulty: 'medium',
      question:
        'A Splitwise clone splits ₹1,000.00 (100,000 paise) equally among 3 users with this code. What is the problem?',
      code: {
        language: 'typescript',
        code: `const per = Math.round(totalPaise / users.length);
users.forEach((u) => shares.push({ userId: u, paise: per }));`,
      },
      options: [
        'Nothing; Math.round on paise is exact',
        'Shares sum to 99,999 paise, so one paisa vanishes and the group\'s net balances no longer sum to zero',
        'Shares sum to 100,002 paise because Math.round rounds 33,333.33 up',
        'It throws because 100,000 is not divisible by 3',
      ],
      correct: [1],
      explanation:
        '100,000 ÷ 3 = 33,333.33, rounded to 33,333; three shares total 99,999. Over many expenses these drifts make balances disagree with the ledger. Distribute the remainder explicitly (base + 1 paisa to the first r users). It rounds down, not up, and JavaScript division never throws.',
      followUps: [
        {
          q: 'Which invariant test would have caught this immediately?',
          a: 'Assert Σ shares === total for every expense, and Σ net balances === 0 per group after every operation. A property-based test over random totals and participant counts finds the 100,000 / 3 case in milliseconds.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-16',
      difficulty: 'expert',
      question:
        'Net balances in a group are A +₹300, B +₹400, C −₹200, D −₹200, E −₹300. Which statement about "largest debtor pays largest creditor" greedy simplification is correct?',
      options: [
        'Greedy yields 3 transfers, which is optimal because greedy is always optimal for net balances',
        'Greedy yields 4 transfers while 3 suffice, because {A, E} and {B, C, D} are independent zero-sum groups',
        'Greedy yields 5 transfers, which equals n for this group',
        'Greedy yields 2 transfers by netting creditors against each other first',
      ],
      correct: [1],
      explanation:
        'Greedy does E→B 300, C→A 200, D→A 100, D→B 100 = 4. Optimal is E→A 300, C→B 200, D→B 200 = 3, since the minimum equals (non-zero users) − (max disjoint zero-sum subsets) = 5 − 2. Greedy is bounded by n−1 (here 4), not n, and is not always optimal; creditors cannot net against each other.',
      followUps: [
        {
          q: 'Why is finding the exact minimum hard in general?',
          a: 'Maximising the number of disjoint zero-sum subsets contains subset-sum (deciding whether any proper subset sums to zero), which is NP-complete. So exact algorithms are exponential — bitmask DP in O(2ⁿ·n) — and are used only for small groups.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-17',
      difficulty: 'expert',
      question:
        'Your exact debt simplifier uses bitmask DP over non-zero members. A request arrives for a group with 24 non-zero balances on a Node API pod. What is the most appropriate behaviour?',
      options: [
        'Run the DP on the request thread; 2²⁴ is only ~16M states, so it is fast',
        'Fall back to greedy (or reduce n by pairing equal opposite balances first) and optionally compute the exact plan asynchronously in a worker',
        'Recursively try all permutations of transfers, pruning when a branch exceeds the greedy count',
        'Reject the request because simplification is undefined for more than 20 members',
      ],
      correct: [1],
      explanation:
        'The DP is 2²⁴ × 24 ≈ 400M iterations (roughly a second) with ~270 MB of arrays — blocking the event loop for every other request. Reducing n and falling back to greedy keeps latency bounded; an async worker can upgrade the plan later. Permutation search is worse than DP, and simplification is perfectly defined, just expensive.',
      followUps: [
        {
          q: 'Why does a 1-second computation on one request hurt other users on the same pod?',
          a: 'Node runs JavaScript on one thread: a synchronous 1 s loop blocks every other request, timer and health check on that pod, so p99 latency for unrelated APIs jumps and the load balancer may mark the pod unhealthy. CPU-heavy work belongs in \`worker_threads\` or a separate job service.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-18',
      difficulty: 'hard',
      question:
        'Splitwise group balances drift after busy weekends when roommates add and edit expenses simultaneously from mobile apps on a 6-pod backend. Select ALL changes that address real causes.',
      options: [
        'Update balances with UPDATE … SET paise = paise + $delta in the same transaction as the ledger insert',
        'Require an idempotency key on expense creation with a unique index per group',
        'Wrap addExpense in an in-process async mutex on each pod',
        'Use optimistic concurrency (version column) when editing an existing expense',
        'Recompute balances in the client and send the new totals to the server',
      ],
      correct: [0, 1, 3],
      explanation:
        'Atomic increments in the ledger transaction remove lost updates and partial writes, idempotency keys stop duplicate expenses from mobile retries, and version checks stop two concurrent edits from double-reversing. Per-pod mutexes do not coordinate 6 pods, and client-computed totals reintroduce last-writer-wins at the API.',
      followUps: [
        {
          q: 'How do you detect drift in production if it happens anyway?',
          a: 'Run a periodic job that rebuilds net balances from the immutable ledger per group and compares them to the stored projection; alert on any non-zero difference and auto-repair from the ledger. Also check Σ net = 0 per group as a cheap continuous invariant.',
        },
      ],
    },
    {
      id: 'lld-cases-1-mcq-19',
      difficulty: 'medium',
      question:
        'In a 90-minute machine-coding round you have a clean class diagram, interfaces for every service and 30 minutes left, but nothing runs end to end yet. What should you do next?',
      options: [
        'Add the remaining design patterns (Builder, Visitor) so the design looks complete',
        'Write a thin vertical slice through the core flow with in-memory repositories and a main() demo, even if secondary features stay stubbed',
        'Start writing unit tests for every interface before implementing them',
        'Explain to the interviewer that the design is done and the code is trivial',
      ],
      correct: [1],
      explanation:
        'Machine-coding rounds are graded first on working code; a running core flow with clear stubs demonstrates the design and leaves room for the extension discussion. Extra patterns add no value, tests without implementations do not run, and "the code is trivial" is exactly what the round exists to verify.',
      followUps: [
        {
          q: 'What does a convincing main() demo contain for the BookMyShow problem?',
          a: 'Seed one show, have U1 hold two seats, U2 fail on an overlapping seat, advance an injected clock past the TTL, U2 succeed, and U1\'s late confirm be rejected — printing each step. It proves the lock seam, TTL logic and lifecycle in under a minute.',
        },
      ],
    },
  ],
};

export default topic;
