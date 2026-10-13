# Build the Parking Lot LLD (Machine-Coding Round)

Implement the classes in `src/index.ts`. The judge is `test/parking-lot.test.ts` (16 tests).

```bash
npm run project -- parking-lot-lld             # judge YOUR code (saves results for the app)
npm run project -- parking-lot-lld --no-save   # judge without saving
npm run project -- parking-lot-lld --solution  # run the reference solution
```

## Requirements (as an interviewer would state them)

1. The lot has spots of several sizes (`SMALL = 1`, `MEDIUM = 2`, `LARGE = 3`, …), some of them **EV spots with chargers**, and several entry gates.
2. Vehicles: a motorcycle fits size ≥ 1, a car size ≥ 2, a truck size ≥ 3. New types must be addable **without editing the allocator**.
3. Allocation order:
   1. EVs prefer EV spots, and **non-EVs may never use EV spots**.
   2. The **smallest** size that fits.
   3. The spot **nearest to the entry gate**.
   4. The lowest spot id.
4. Entry issues a ticket and exit returns a receipt with the fee. A plate can't be inside twice, and a ticket can't be used twice.
5. Pricing per vehicle type, in **integer paise**:
   - Slabs: ≤ 10 min free, ≤ 60 min ₹40, ≤ 180 min ₹100, then ₹30 per started hour.
   - A **daily cap** applies per 24h period.
6. Entries and exits at several gates happen **concurrently**. Never give one spot to two vehicles.

## Design you should end up with

```
ParkingLot ──uses──► AllocationStrategy (interface) ◄── NearestSmallestFitStrategy, valet strategy…
     │      ──uses──► FeeRule (interface) ◄── SlabFeeRule, PerHourFeeRule, DailyCapFeeRule(inner)
     │      ──uses──► Mutex
     └── registry: Map<typeName, VehicleType>, Map<typeName, FeeRule>, Map<spotId, Spot>
```

- **Open/closed**: a vehicle type is *data* (`{ name, size }`), not a subclass with a `switch`. The bus test registers a type, adds a size-4 spot and a price, and expects allocation to just work.
- **Strategy**: the lot filters the spots that are *allowed* (free, big enough, EV rule). The strategy picks *which* one. Valet parking is a different strategy, not a flag.
- **Decorator**: `DailyCapFeeRule` wraps any rule.
- **Concurrency**: `park` awaits I/O (`opts.io`), as real code awaits a camera or a database. If you choose a spot, `await`, and then mark it occupied, two entries pick the same spot. Hold a mutex across *check-then-act*, or reserve synchronously before the first `await`. Both pass, but be ready to explain which you would use with a real database (`SELECT … FOR UPDATE SKIP LOCKED`, or a conditional update on `spot.occupied_by IS NULL`).

## Hints

- Billable minutes are `Math.ceil(durationMs / 60_000)`. The tests check boundaries such as exactly 60 minutes and 60 minutes plus 1 ms.
- The `Mutex` can be a promise chain: each `lock()` waits on the previous tail and installs its own release as the new tail.
- Return **copies** of tickets so callers can't mutate your state.

## Stretch goals

- Multiple floors with a display board per floor, updated by an observer.
- Reservations made ahead of time (a hold with a TTL) and a lost-ticket flow (charge the daily maximum).
- Move the state into a repository interface with an in-memory adapter, and write a Postgres adapter that uses row locks.
- Discounts (monthly pass, EV charging surcharge) as more `FeeRule` decorators.
