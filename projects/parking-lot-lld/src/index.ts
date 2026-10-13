// STARTER — Parking Lot LLD (machine-coding round).
// Implement every function/method below. Run the judge with:  npm run project -- parking-lot-lld
// Keep the exported names and signatures: the tests import them.
//
// Design you are aiming for:
//   ParkingLot            — orchestrates entry/exit; owns the spot inventory and tickets
//   VehicleType registry  — open/closed: new vehicle types are DATA, not new if/else branches
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
  /** distance from each gate id */
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

export interface Slab {
  /** this slab applies when billable minutes ≤ uptoMinutes */
  uptoMinutes: number;
  /** total fee for the stay, paise */
  amount: number;
}

export interface SlabFeeOptions {
  /** stays of ≤ graceMinutes are free (default 0) */
  graceMinutes?: number;
  /** strictly ascending by uptoMinutes, at least one */
  slabs: Slab[];
  /** beyond the last slab: + this per started hour, paise */
  extraPerHour: number;
}

/**
 * Slab pricing. Billable minutes = ⌈durationMs / 60 000⌉.
 * minutes ≤ grace → 0; else the first slab with minutes ≤ uptoMinutes; beyond the last slab:
 * last.amount + ⌈(minutes − last.uptoMinutes) / 60⌉ × extraPerHour.
 * Constructor throws on: no slabs, non-ascending slabs, money that is not a non-negative integer.
 */
export class SlabFeeRule implements FeeRule {
  constructor(opts: SlabFeeOptions) {
    throw new Error('Not implemented: SlabFeeRule.constructor');
  }

  calculate(ctx: FeeContext): number {
    throw new Error('Not implemented: SlabFeeRule.calculate');
  }
}

/** Flat rate per started hour, minimum one hour. Throws if the rate is not a non-negative integer. */
export class PerHourFeeRule implements FeeRule {
  constructor(ratePerHour: number) {
    throw new Error('Not implemented: PerHourFeeRule.constructor');
  }

  calculate(ctx: FeeContext): number {
    throw new Error('Not implemented: PerHourFeeRule.calculate');
  }
}

/**
 * Decorator: caps each 24h period at `capPerDay` (non-negative integer, else throw).
 * fee = fullDays × cap + min(cap, inner(remainder)), with the remainder term 0 when remainder is 0.
 * The inner rule is called with durationMs = remainder.
 */
export class DailyCapFeeRule implements FeeRule {
  constructor(inner: FeeRule, capPerDay: number) {
    throw new Error('Not implemented: DailyCapFeeRule.constructor');
  }

  calculate(ctx: FeeContext): number {
    throw new Error('Not implemented: DailyCapFeeRule.calculate');
  }
}

/** Picks one spot from candidates that already fit (size and EV rules applied by the lot). */
export interface AllocationStrategy {
  choose(candidates: readonly Spot[], vehicle: Vehicle, type: VehicleType, gateId: string): Spot | undefined;
}

/**
 * Default strategy, in priority order:
 * 1. EVs prefer EV spots (non-EVs never see EV spots — the lot filters them out)
 * 2. smallest spot size (keeps big spots for big vehicles)
 * 3. nearest to the entry gate (spot.distances[gateId])
 * 4. spot id ascending (determinism)
 */
export class NearestSmallestFitStrategy implements AllocationStrategy {
  choose(candidates: readonly Spot[], vehicle: Vehicle, type: VehicleType, gateId: string): Spot | undefined {
    throw new Error('Not implemented: NearestSmallestFitStrategy.choose');
  }
}

/** FIFO async mutex: waiters acquire in the order they called lock(). */
export class Mutex {
  /** Resolves with a release function once the lock is held. */
  lock(): Promise<() => void> {
    throw new Error('Not implemented: Mutex.lock');
  }

  /** Run fn while holding the lock; always release (even if fn throws); return fn's result. */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    throw new Error('Not implemented: Mutex.runExclusive');
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
  /** default: new NearestSmallestFitStrategy() */
  strategy?: AllocationStrategy;
  /**
   * Simulated I/O (camera, DB write, barrier). Await it inside park() and exit() as real code
   * would await a database. Allocation must stay correct across these awaits.
   */
  io?: () => Promise<void>;
}

/** Registered automatically by every ParkingLot. */
export const DEFAULT_VEHICLE_TYPES: readonly VehicleType[] = [
  { name: 'motorcycle', size: SpotSize.SMALL },
  { name: 'car', size: SpotSize.MEDIUM },
  { name: 'truck', size: SpotSize.LARGE },
];

export class ParkingLot {
  /** Registers DEFAULT_VEHICLE_TYPES, the given pricing and spots. */
  constructor(opts: ParkingLotOptions) {
    throw new Error('Not implemented: ParkingLot.constructor');
  }

  /** Extension point: add a vehicle type. Throws if the name exists or size ≤ 0. */
  registerVehicleType(type: VehicleType): void {
    throw new Error('Not implemented: ParkingLot.registerVehicleType');
  }

  /** Registered type names, sorted. */
  vehicleTypes(): string[] {
    throw new Error('Not implemented: ParkingLot.vehicleTypes');
  }

  setPricing(vehicleType: string, rule: FeeRule): void {
    throw new Error('Not implemented: ParkingLot.setPricing');
  }

  /** Add a spot. Throws on a duplicate id. */
  addSpot(spot: Spot): void {
    throw new Error('Not implemented: ParkingLot.addSpot');
  }

  /**
   * Enter through `gateId`.
   * - unknown gate / unknown type / no pricing for the type → throw (reserve nothing)
   * - plate already inside → DuplicateVehicleError
   * - candidates = free spots with size ≥ type.size, excluding EV spots unless vehicle.ev
   * - strategy.choose(...) → undefined means LotFullError
   * - ticket ids must be unique (e.g. "T-1", "T-2", …); entryAt = now()
   * Must be safe under concurrent calls: no spot or plate may ever be double-booked.
   * Returns a copy of the ticket.
   */
  async park(vehicle: Vehicle, gateId: string): Promise<Ticket> {
    throw new Error('Not implemented: ParkingLot.park');
  }

  /**
   * Leave: compute the fee with the vehicle type's rule (durationMs = now − entryAt), close the
   * ticket and free the spot. Unknown or already-closed ticket → InvalidTicketError.
   * Concurrent exits of the same ticket must succeed only once.
   */
  async exit(ticketId: string): Promise<Receipt> {
    throw new Error('Not implemented: ParkingLot.exit');
  }

  /** Free/occupied counts, and FREE spots per size (sizes with 0 free are omitted). */
  availability(): { free: number; occupied: number; freeBySize: Record<number, number> } {
    throw new Error('Not implemented: ParkingLot.availability');
  }

  /** Copies of open tickets. */
  activeTickets(): Ticket[] {
    throw new Error('Not implemented: ParkingLot.activeTickets');
  }

  /** The open ticket for a plate, if the vehicle is inside. */
  findVehicle(plate: string): Ticket | undefined {
    throw new Error('Not implemented: ParkingLot.findVehicle');
  }
}
