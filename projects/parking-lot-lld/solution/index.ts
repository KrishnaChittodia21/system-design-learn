// Reference solution: Parking Lot LLD (machine-coding round).
//
// Design (SOLID in one screen):
//   ParkingLot            — orchestrates entry/exit; owns the spot inventory and tickets
//   VehicleType registry  — open/closed: new vehicle types are DATA, not new branches
//   AllocationStrategy    — strategy pattern: which free spot to give (default: smallest-fit, nearest)
//   FeeRule               — strategy + decorator: slab pricing, wrapped by a daily cap
//   Mutex                 — makes "choose spot + reserve it" atomic across async interleavings
// Money is integer paise everywhere. Never use floats for money.

/** Built-in spot sizes. Sizes are plain numbers so new ones (e.g. 4 = bus bay) need no code change. */
export const SpotSize = { SMALL: 1, MEDIUM: 2, LARGE: 3 } as const;

export interface VehicleType {
  name: string;
  /** smallest spot size this vehicle fits in */
  size: number;
}

export interface Vehicle {
  plate: string;
  /** a registered VehicleType name */
  type: string;
  /** electric vehicle: prefers EV (charger) spots */
  ev?: boolean;
}

export interface Spot {
  id: string;
  size: number;
  /** has a charger; reserved for EVs */
  ev: boolean;
  /** walking/driving distance from each gate id */
  distances: Record<string, number>;
}

export interface Ticket {
  id: string;
  plate: string;
  vehicleType: string;
  ev: boolean;
  spotId: string;
  gateId: string;
  entryAt: number;
}

export interface Receipt {
  ticketId: string;
  plate: string;
  spotId: string;
  entryAt: number;
  exitAt: number;
  durationMs: number;
  /** integer paise */
  fee: number;
}

export interface FeeContext {
  vehicleType: string;
  ev: boolean;
  entryAt: number;
  exitAt: number;
  durationMs: number;
}

/** A pricing policy. Returns integer paise. */
export interface FeeRule {
  calculate(ctx: FeeContext): number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function assertPaise(n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer (paise)`);
}

export interface Slab {
  /** this slab applies when billable minutes ≤ uptoMinutes */
  uptoMinutes: number;
  /** total fee for the stay, paise */
  amount: number;
}

export interface SlabFeeOptions {
  /** stays of ≤ graceMinutes are free (default 0) */
  graceMinutes?: number;
  /** ascending by uptoMinutes */
  slabs: Slab[];
  /** beyond the last slab: + this per started hour, paise */
  extraPerHour: number;
}

/**
 * Slab pricing. Billable minutes = ⌈duration / 1 min⌉.
 * ≤ grace → 0; else the first slab with minutes ≤ uptoMinutes; beyond the last slab:
 * last.amount + ⌈(minutes − last.uptoMinutes) / 60⌉ × extraPerHour.
 */
export class SlabFeeRule implements FeeRule {
  #grace: number;
  #slabs: Slab[];
  #extra: number;

  constructor(opts: SlabFeeOptions) {
    if (opts.slabs.length === 0) throw new Error('at least one slab');
    for (let i = 0; i < opts.slabs.length; i++) {
      assertPaise(opts.slabs[i].amount, 'slab amount');
      if (i > 0 && opts.slabs[i].uptoMinutes <= opts.slabs[i - 1].uptoMinutes) throw new Error('slabs must be ascending');
    }
    assertPaise(opts.extraPerHour, 'extraPerHour');
    this.#grace = opts.graceMinutes ?? 0;
    this.#slabs = opts.slabs.map((s) => ({ ...s }));
    this.#extra = opts.extraPerHour;
  }

  calculate(ctx: FeeContext): number {
    const minutes = Math.ceil(ctx.durationMs / MINUTE);
    if (minutes <= this.#grace) return 0;
    for (const s of this.#slabs) if (minutes <= s.uptoMinutes) return s.amount;
    const last = this.#slabs[this.#slabs.length - 1];
    return last.amount + Math.ceil((minutes - last.uptoMinutes) / 60) * this.#extra;
  }
}

/** Flat rate per started hour (minimum one hour). */
export class PerHourFeeRule implements FeeRule {
  #rate: number;
  constructor(ratePerHour: number) {
    assertPaise(ratePerHour, 'ratePerHour');
    this.#rate = ratePerHour;
  }
  calculate(ctx: FeeContext): number {
    return Math.max(1, Math.ceil(ctx.durationMs / HOUR)) * this.#rate;
  }
}

/**
 * Decorator: caps each 24h period at `capPerDay`.
 * fee = fullDays × cap + min(cap, inner(remainder)) (the remainder term is 0 when remainder is 0).
 */
export class DailyCapFeeRule implements FeeRule {
  #inner: FeeRule;
  #cap: number;
  constructor(inner: FeeRule, capPerDay: number) {
    assertPaise(capPerDay, 'capPerDay');
    this.#inner = inner;
    this.#cap = capPerDay;
  }
  calculate(ctx: FeeContext): number {
    const days = Math.floor(ctx.durationMs / DAY);
    const rest = ctx.durationMs - days * DAY;
    const restFee = rest === 0 ? 0 : Math.min(this.#cap, this.#inner.calculate({ ...ctx, durationMs: rest }));
    return days * this.#cap + restFee;
  }
}

/** Picks one spot from candidates that already fit (size and EV rules applied by the lot). */
export interface AllocationStrategy {
  choose(candidates: readonly Spot[], vehicle: Vehicle, type: VehicleType, gateId: string): Spot | undefined;
}

/**
 * Default strategy: EVs prefer EV spots; then smallest size that fits (keeps big spots free
 * for big vehicles); then nearest to the entry gate; then spot id.
 */
export class NearestSmallestFitStrategy implements AllocationStrategy {
  choose(candidates: readonly Spot[], vehicle: Vehicle, _type: VehicleType, gateId: string): Spot | undefined {
    const evRank = (s: Spot) => (vehicle.ev && s.ev ? 0 : 1);
    const dist = (s: Spot) => s.distances[gateId] ?? Infinity;
    let best: Spot | undefined;
    for (const s of candidates) {
      if (
        !best ||
        evRank(s) - evRank(best) < 0 ||
        (evRank(s) === evRank(best) &&
          (s.size < best.size || (s.size === best.size && (dist(s) < dist(best) || (dist(s) === dist(best) && s.id < best.id)))))
      ) {
        best = s;
      }
    }
    return best;
  }
}

/** FIFO async mutex. */
export class Mutex {
  #tail: Promise<void> = Promise.resolve();

  /** Resolves with a release function once the lock is held. */
  lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    const acquired = this.#tail.then(() => release);
    this.#tail = this.#tail.then(() => next);
    return acquired;
  }

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.lock();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class LotFullError extends Error {
  constructor(message = 'no free spot fits this vehicle') {
    super(message);
    this.name = 'LotFullError';
  }
}

export class DuplicateVehicleError extends Error {
  constructor(plate: string) {
    super(`vehicle ${plate} is already parked`);
    this.name = 'DuplicateVehicleError';
  }
}

export class InvalidTicketError extends Error {
  constructor(id: string) {
    super(`ticket ${id} is unknown or already closed`);
    this.name = 'InvalidTicketError';
  }
}

export interface ParkingLotOptions {
  spots: Spot[];
  gates: string[];
  /** vehicle type name → fee rule */
  pricing: Record<string, FeeRule>;
  now: () => number;
  strategy?: AllocationStrategy;
  /** simulated I/O (camera, DB write, barrier) awaited during park/exit; allocation must stay correct across it */
  io?: () => Promise<void>;
}

export const DEFAULT_VEHICLE_TYPES: readonly VehicleType[] = [
  { name: 'motorcycle', size: SpotSize.SMALL },
  { name: 'car', size: SpotSize.MEDIUM },
  { name: 'truck', size: SpotSize.LARGE },
];

export class ParkingLot {
  #spots = new Map<string, Spot>();
  /** spot id → ticket id */
  #occupied = new Map<string, string>();
  #tickets = new Map<string, Ticket>();
  /** plate → ticket id, for vehicles currently inside */
  #byPlate = new Map<string, string>();
  #types = new Map<string, VehicleType>();
  #pricing = new Map<string, FeeRule>();
  #gates: Set<string>;
  #now: () => number;
  #strategy: AllocationStrategy;
  #io: () => Promise<void>;
  #mutex = new Mutex();
  #seq = 0;

  constructor(opts: ParkingLotOptions) {
    this.#gates = new Set(opts.gates);
    this.#now = opts.now;
    this.#strategy = opts.strategy ?? new NearestSmallestFitStrategy();
    this.#io = opts.io ?? (async () => {});
    for (const t of DEFAULT_VEHICLE_TYPES) this.#types.set(t.name, { ...t });
    for (const [name, rule] of Object.entries(opts.pricing)) this.#pricing.set(name, rule);
    for (const s of opts.spots) this.addSpot(s);
  }

  /** Extension point: add a vehicle type without touching allocation code. */
  registerVehicleType(type: VehicleType): void {
    if (this.#types.has(type.name)) throw new Error(`vehicle type exists: ${type.name}`);
    if (!(type.size > 0)) throw new Error('size must be > 0');
    this.#types.set(type.name, { ...type });
  }

  vehicleTypes(): string[] {
    return [...this.#types.keys()].sort();
  }

  setPricing(vehicleType: string, rule: FeeRule): void {
    this.#pricing.set(vehicleType, rule);
  }

  addSpot(spot: Spot): void {
    if (this.#spots.has(spot.id)) throw new Error(`duplicate spot ${spot.id}`);
    this.#spots.set(spot.id, { ...spot, distances: { ...spot.distances } });
  }

  async park(vehicle: Vehicle, gateId: string): Promise<Ticket> {
    if (!this.#gates.has(gateId)) throw new Error(`unknown gate ${gateId}`);
    const type = this.#types.get(vehicle.type);
    if (!type) throw new Error(`unknown vehicle type ${vehicle.type}`);
    if (!this.#pricing.has(vehicle.type)) throw new Error(`no pricing for ${vehicle.type}`);
    await this.#io(); // e.g. ANPR camera reads the plate
    // Check-then-act on shared state must be atomic: hold the lock across choose + reserve
    // (and the persisting I/O), otherwise two cars can be given the same spot.
    return this.#mutex.runExclusive(async () => {
      if (this.#byPlate.has(vehicle.plate)) throw new DuplicateVehicleError(vehicle.plate);
      const candidates = [...this.#spots.values()].filter(
        (s) => !this.#occupied.has(s.id) && s.size >= type.size && (!s.ev || vehicle.ev === true),
      );
      const spot = this.#strategy.choose(candidates, vehicle, type, gateId);
      if (!spot) throw new LotFullError();
      if (!candidates.includes(spot)) throw new Error('strategy returned a spot that is not a candidate');
      const ticket: Ticket = {
        id: `T-${++this.#seq}`,
        plate: vehicle.plate,
        vehicleType: vehicle.type,
        ev: vehicle.ev === true,
        spotId: spot.id,
        gateId,
        entryAt: this.#now(),
      };
      this.#occupied.set(spot.id, ticket.id);
      this.#tickets.set(ticket.id, ticket);
      this.#byPlate.set(vehicle.plate, ticket.id);
      await this.#io(); // persist the ticket
      return { ...ticket };
    });
  }

  async exit(ticketId: string): Promise<Receipt> {
    return this.#mutex.runExclusive(async () => {
      const t = this.#tickets.get(ticketId);
      if (!t) throw new InvalidTicketError(ticketId);
      const exitAt = this.#now();
      const durationMs = Math.max(0, exitAt - t.entryAt);
      const fee = this.#pricing.get(t.vehicleType)!.calculate({ vehicleType: t.vehicleType, ev: t.ev, entryAt: t.entryAt, exitAt, durationMs });
      assertPaise(fee, 'fee');
      this.#tickets.delete(ticketId);
      this.#occupied.delete(t.spotId);
      this.#byPlate.delete(t.plate);
      await this.#io(); // persist the payment
      return { ticketId, plate: t.plate, spotId: t.spotId, entryAt: t.entryAt, exitAt, durationMs, fee };
    });
  }

  /** Free/occupied counts, and free spots per size. */
  availability(): { free: number; occupied: number; freeBySize: Record<number, number> } {
    const freeBySize: Record<number, number> = {};
    let free = 0;
    for (const s of this.#spots.values()) {
      if (this.#occupied.has(s.id)) continue;
      free++;
      freeBySize[s.size] = (freeBySize[s.size] ?? 0) + 1;
    }
    return { free, occupied: this.#occupied.size, freeBySize };
  }

  activeTickets(): Ticket[] {
    return [...this.#tickets.values()].map((t) => ({ ...t }));
  }

  /** Where is this car? */
  findVehicle(plate: string): Ticket | undefined {
    const id = this.#byPlate.get(plate);
    const t = id ? this.#tickets.get(id) : undefined;
    return t ? { ...t } : undefined;
  }
}
