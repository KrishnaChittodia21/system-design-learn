import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const {
  ParkingLot, SpotSize, SlabFeeRule, DailyCapFeeRule, PerHourFeeRule, NearestSmallestFitStrategy, Mutex,
  LotFullError, DuplicateVehicleError, InvalidTicketError,
} = mod;
type Spot = import('../solution/index.ts').Spot;
type FeeContext = import('../solution/index.ts').FeeContext;
type AllocationStrategy = import('../solution/index.ts').AllocationStrategy;

const MIN = 60_000;
const HOUR = 60 * MIN;

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simulated I/O: yields to the event loop a seeded-random number of times (no real sleeping). */
function jitteryIo(seed: number) {
  const r = rng(seed);
  return async () => {
    const turns = Math.floor(r() * 5);
    for (let i = 0; i < turns; i++) await new Promise<void>((res) => setImmediate(res));
  };
}

/** Car pricing: ≤10 min free, ≤1h ₹40, ≤3h ₹100, then ₹30 per started hour; capped at ₹300/day. */
const carSlabs = () => new SlabFeeRule({ graceMinutes: 10, slabs: [{ uptoMinutes: 60, amount: 4000 }, { uptoMinutes: 180, amount: 10000 }], extraPerHour: 3000 });
const carPricing = () => new DailyCapFeeRule(carSlabs(), 30000);
const ctx = (durationMs: number): FeeContext => ({ vehicleType: 'car', ev: false, entryAt: 0, exitAt: durationMs, durationMs });

const spot = (id: string, size: number, north: number, south: number, ev = false): Spot => ({ id, size, ev, distances: { north, south } });

function standardLot(extra: Partial<ConstructorParameters<typeof ParkingLot>[0]> = {}) {
  const c = clock();
  const lot = new ParkingLot({
    spots: [
      spot('S1', SpotSize.SMALL, 5, 50),
      spot('M1', SpotSize.MEDIUM, 10, 10),
      spot('M2', SpotSize.MEDIUM, 3, 60),
      spot('E1', SpotSize.MEDIUM, 20, 20, true),
      spot('L1', SpotSize.LARGE, 1, 1),
    ],
    gates: ['north', 'south'],
    pricing: { motorcycle: new PerHourFeeRule(1000), car: carPricing(), truck: new PerHourFeeRule(8000) },
    now: c.now,
    ...extra,
  });
  return { lot, c };
}

// ---------------------------------------------------------------- fees

test('M1: slab fees in integer paise — grace period, slabs, and per started hour beyond the last slab', () => {
  const r = carSlabs();
  assert.equal(r.calculate(ctx(0)), 0);
  assert.equal(r.calculate(ctx(10 * MIN)), 0);
  assert.equal(r.calculate(ctx(10 * MIN + 1)), 4000, 'billable minutes are rounded up');
  assert.equal(r.calculate(ctx(60 * MIN)), 4000);
  assert.equal(r.calculate(ctx(61 * MIN)), 10000);
  assert.equal(r.calculate(ctx(180 * MIN)), 10000);
  assert.equal(r.calculate(ctx(181 * MIN)), 13000);
  assert.equal(r.calculate(ctx(300 * MIN)), 16000);
  assert.equal(new PerHourFeeRule(2500).calculate(ctx(1)), 2500, 'minimum one hour');
  assert.equal(new PerHourFeeRule(2500).calculate(ctx(2 * HOUR + 1)), 7500);
});

test('M1: a daily cap decorates any rule per 24h period', () => {
  const r = carPricing();
  assert.equal(r.calculate(ctx(2 * HOUR)), 10000, 'under the cap');
  assert.equal(r.calculate(ctx(10 * HOUR)), 30000, '10h would be ₹310 → capped at ₹300');
  assert.equal(r.calculate(ctx(24 * HOUR)), 30000);
  assert.equal(r.calculate(ctx(25 * HOUR)), 34000, 'one full day + ₹40 for the next hour');
  assert.equal(r.calculate(ctx(72 * HOUR + 5 * MIN)), 90000, 'grace applies to the partial day');
});

test('M1: fee rules reject non-integer or negative money and unordered slabs', () => {
  assert.equal(new DailyCapFeeRule(new PerHourFeeRule(0), 0).calculate(ctx(HOUR)), 0, 'valid zero prices are fine');
  assert.throws(() => new SlabFeeRule({ slabs: [{ uptoMinutes: 60, amount: 40.5 }], extraPerHour: 0 }));
  assert.throws(() => new SlabFeeRule({ slabs: [{ uptoMinutes: 60, amount: 100 }, { uptoMinutes: 30, amount: 200 }], extraPerHour: 0 }));
  assert.throws(() => new SlabFeeRule({ slabs: [], extraPerHour: 0 }));
  assert.throws(() => new PerHourFeeRule(-1));
  assert.throws(() => new DailyCapFeeRule(carSlabs(), 0.5));
});

// ---------------------------------------------------------------- allocation

test('M2: smallest spot that fits first, then nearest to the entry gate', async () => {
  const { lot } = standardLot();
  assert.equal((await lot.park({ plate: 'MC1', type: 'motorcycle' }, 'north')).spotId, 'S1');
  assert.equal((await lot.park({ plate: 'MC2', type: 'motorcycle' }, 'north')).spotId, 'M2', 'no small spot left → smallest larger one, nearest to north');
  assert.equal((await lot.park({ plate: 'CAR1', type: 'car' }, 'south')).spotId, 'M1');
  assert.equal((await lot.park({ plate: 'CAR2', type: 'car' }, 'south')).spotId, 'L1', 'a regular car never takes the EV spot');
  await assert.rejects(lot.park({ plate: 'TRUCK', type: 'truck' }, 'north'), LotFullError);
  assert.deepEqual(lot.availability(), { free: 1, occupied: 4, freeBySize: { 2: 1 } });
});

test('M2: EVs prefer EV spots, and fall back to regular spots when chargers are taken', async () => {
  const { lot } = standardLot();
  assert.equal((await lot.park({ plate: 'EV1', type: 'car', ev: true }, 'north')).spotId, 'E1');
  assert.equal((await lot.park({ plate: 'EV2', type: 'car', ev: true }, 'north')).spotId, 'M2');
  assert.equal((await lot.park({ plate: 'T1', type: 'truck' }, 'north')).spotId, 'L1', 'trucks only fit large');
});

test('M2: ties on size and distance break by spot id, so allocation is deterministic', async () => {
  const c = clock();
  const lot = new ParkingLot({
    spots: [spot('B', 2, 5, 5), spot('A', 2, 5, 5), spot('C', 2, 5, 5)],
    gates: ['north', 'south'],
    pricing: { car: carPricing() },
    now: c.now,
  });
  const ids = [];
  for (const p of ['x', 'y', 'z']) ids.push((await lot.park({ plate: p, type: 'car' }, 'north')).spotId);
  assert.deepEqual(ids, ['A', 'B', 'C']);
});

test('M2: park validates gate, vehicle type and pricing', async () => {
  const { lot } = standardLot();
  await assert.rejects(lot.park({ plate: 'X', type: 'car' }, 'west'), /gate/);
  await assert.rejects(lot.park({ plate: 'X', type: 'spaceship' }, 'north'), /type/);
  lot.registerVehicleType({ name: 'van', size: 2 });
  await assert.rejects(lot.park({ plate: 'X', type: 'van' }, 'north'), /pricing/);
  assert.equal(lot.availability().free, 5, 'failed entries reserve nothing');
});

// ---------------------------------------------------------------- tickets & exit

test('M3: a ticket records the entry; exit returns a receipt with the fee and frees the spot', async () => {
  const { lot, c } = standardLot();
  const t = await lot.park({ plate: 'KA01AB1234', type: 'car' }, 'south');
  assert.deepEqual(t, { id: t.id, plate: 'KA01AB1234', vehicleType: 'car', ev: false, spotId: 'M1', gateId: 'south', entryAt: c.now() });
  assert.equal(lot.findVehicle('KA01AB1234')?.spotId, 'M1');
  c.advance(61 * MIN);
  const r = await lot.exit(t.id);
  assert.deepEqual(r, { ticketId: t.id, plate: 'KA01AB1234', spotId: 'M1', entryAt: t.entryAt, exitAt: t.entryAt + 61 * MIN, durationMs: 61 * MIN, fee: 10000 });
  assert.equal(lot.findVehicle('KA01AB1234'), undefined);
  assert.equal(lot.availability().free, 5);
  assert.deepEqual(lot.activeTickets(), []);
});

test('M3: ticket ids are unique; double exit and unknown tickets are rejected; a vehicle cannot be inside twice', async () => {
  const { lot } = standardLot();
  const a = await lot.park({ plate: 'A', type: 'car' }, 'north');
  const b = await lot.park({ plate: 'B', type: 'car' }, 'north');
  assert.notEqual(a.id, b.id);
  await assert.rejects(lot.park({ plate: 'A', type: 'car' }, 'south'), DuplicateVehicleError);
  await lot.exit(a.id);
  await assert.rejects(lot.exit(a.id), InvalidTicketError);
  await assert.rejects(lot.exit('T-404'), InvalidTicketError);
  const again = await lot.park({ plate: 'A', type: 'car' }, 'south');
  assert.notEqual(again.id, a.id, 'a returning vehicle gets a fresh ticket');
  assert.equal(lot.activeTickets().length, 2);
});

// ---------------------------------------------------------------- concurrency

test('M4: Mutex runs critical sections one at a time, in FIFO order', async () => {
  const m = new Mutex();
  let inside = 0, maxInside = 0;
  const order: number[] = [];
  const io = jitteryIo(5);
  await Promise.all(Array.from({ length: 20 }, (_, i) => m.runExclusive(async () => {
    inside++; maxInside = Math.max(maxInside, inside);
    await io();
    order.push(i);
    inside--;
  })));
  assert.equal(maxInside, 1);
  assert.deepEqual(order, Array.from({ length: 20 }, (_, i) => i));
  await assert.rejects(m.runExclusive(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await m.runExclusive(() => 42), 42, 'a throwing section releases the lock');
});

test('M4: 40 concurrent entries for 10 spots — exactly 10 tickets, no spot given twice', async () => {
  const c = clock();
  const spots = Array.from({ length: 10 }, (_, i) => spot(`P${i}`, 2, i, 10 - i));
  const lot = new ParkingLot({ spots, gates: ['north', 'south'], pricing: { car: carPricing() }, now: c.now, io: jitteryIo(42) });
  const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => lot.park({ plate: `CAR-${i}`, type: 'car' }, i % 2 ? 'north' : 'south')));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ spotId: string; id: string }>).value);
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(ok.length, 10);
  assert.equal(new Set(ok.map((t) => t.spotId)).size, 10, 'every ticket has a distinct spot');
  assert.equal(new Set(ok.map((t) => t.id)).size, 10);
  assert.ok(failed.every((f) => f.reason instanceof LotFullError));
  assert.deepEqual(lot.availability(), { free: 0, occupied: 10, freeBySize: {} });
});

test('M4: the same plate entering at two gates at once gets exactly one ticket', async () => {
  const { lot } = standardLot({ io: jitteryIo(7) });
  const results = await Promise.allSettled([lot.park({ plate: 'DUP', type: 'car' }, 'north'), lot.park({ plate: 'DUP', type: 'car' }, 'south')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rej = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rej.reason instanceof DuplicateVehicleError);
  assert.equal(lot.availability().occupied, 1);
});

test('M4: concurrent double exit pays once; interleaved exits and entries never overbook', async () => {
  const c = clock();
  const spots = Array.from({ length: 3 }, (_, i) => spot(`P${i}`, 2, i, i));
  const lot = new ParkingLot({ spots, gates: ['north', 'south'], pricing: { car: carPricing() }, now: c.now, io: jitteryIo(99) });
  const first = await Promise.all([0, 1, 2].map((i) => lot.park({ plate: `A${i}`, type: 'car' }, 'north')));
  c.advance(2 * HOUR);
  const exits = await Promise.allSettled([lot.exit(first[0].id), lot.exit(first[0].id)]);
  assert.equal(exits.filter((r) => r.status === 'fulfilled').length, 1);
  // Two leave while three try to enter at the same time.
  const mixed = await Promise.allSettled([
    lot.exit(first[1].id),
    lot.park({ plate: 'B0', type: 'car' }, 'south'),
    lot.exit(first[2].id),
    lot.park({ plate: 'B1', type: 'car' }, 'south'),
    lot.park({ plate: 'B2', type: 'car' }, 'south'),
    lot.park({ plate: 'B3', type: 'car' }, 'south'),
  ]);
  const parked = mixed.filter((r, i) => i !== 0 && i !== 2 && r.status === 'fulfilled').length;
  assert.equal(parked, 3, 'three spots free up overall, so exactly three of the four entries succeed');
  assert.equal(lot.availability().occupied, 3);
  const spotsInUse = lot.activeTickets().map((t) => t.spotId);
  assert.equal(new Set(spotsInUse).size, spotsInUse.length);
});

// ---------------------------------------------------------------- extensibility

test('M5: a new vehicle type is registered as data; duplicates and invalid sizes are rejected', () => {
  const { lot } = standardLot();
  lot.registerVehicleType({ name: 'bus', size: 4 });
  assert.throws(() => lot.registerVehicleType({ name: 'car', size: 2 }), 'cannot redefine a built-in type');
  assert.throws(() => lot.registerVehicleType({ name: 'drone', size: 0 }));
  assert.deepEqual(lot.vehicleTypes(), ['bus', 'car', 'motorcycle', 'truck']);
  assert.throws(() => lot.addSpot(spot('M1', 2, 1, 1)), 'duplicate spot id');
});

test('M5: buses get the bus bay, smaller vehicles use it only as a last resort, and fees use the bus rule', async () => {
  const { lot, c } = standardLot();
  lot.registerVehicleType({ name: 'bus', size: 4 });
  lot.setPricing('bus', new DailyCapFeeRule(new PerHourFeeRule(20000), 100000));
  lot.addSpot(spot('BUS-1', 4, 100, 2));
  const bus = await lot.park({ plate: 'BUS', type: 'bus' }, 'south');
  assert.equal(bus.spotId, 'BUS-1');
  await assert.rejects(lot.park({ plate: 'BUS2', type: 'bus' }, 'south'), LotFullError);
  c.advance(30 * HOUR);
  assert.equal((await lot.exit(bus.id)).fee, 100000 + 100000, '24h capped + 6h × ₹200 capped at ₹1000');
  // Now the bay is free: a truck takes L1 first, the second truck gets the bus bay.
  assert.equal((await lot.park({ plate: 'TR1', type: 'truck' }, 'north')).spotId, 'L1');
  assert.equal((await lot.park({ plate: 'TR2', type: 'truck' }, 'north')).spotId, 'BUS-1');
});

test('M5: the allocation strategy is pluggable (e.g. valet parking fills the farthest spots first)', async () => {
  const farthestFirst: AllocationStrategy = {
    choose: (cands, _v, _t, gate) => [...cands].sort((a, b) => b.distances[gate] - a.distances[gate])[0],
  };
  const { lot } = standardLot({ strategy: farthestFirst });
  assert.equal((await lot.park({ plate: 'V1', type: 'car' }, 'north')).spotId, 'M1', 'farthest non-EV medium-or-larger from north');
  assert.equal((await lot.park({ plate: 'V2', type: 'car' }, 'north')).spotId, 'M2');
  const def = new NearestSmallestFitStrategy();
  const picked = def.choose([spot('a', 3, 1, 1), spot('b', 2, 9, 9)], { plate: 'p', type: 'car' }, { name: 'car', size: 2 }, 'north');
  assert.equal(picked?.id, 'b', 'the default strategy is usable on its own');
});
