# Build a Count-Min Sketch + Heavy-Hitters Top-K

Implement everything in `src/index.ts`. The judge is `test/top-k-sketch.test.ts` (15 tests). It generates a deterministic Zipf(1.1) stream of 100,000 events over 5,000 items.

```bash
npm run project -- top-k-sketch             # judge YOUR code (saves results for the app)
npm run project -- top-k-sketch --no-save   # judge without saving
npm run project -- top-k-sketch --solution  # run the reference solution
```

## What to build

1. **`murmur3_32(key, seed)`**: MurmurHash3 x86 32-bit over UTF-8 bytes. The doc comment lists the constants, and the tests check the standard test vectors.
2. **`sketchDimensions(ε, δ)`**: `width = ⌈e/ε⌉`, `depth = ⌈ln(1/δ)⌉`.
3. **`CountMinSketch`**: `depth` rows of `width` counters. Row `i` uses `murmur3_32(item, seed + i) % width`.
   - `add` increments one counter per row. `estimate` takes the **minimum** over the rows.
   - Guarantees: `estimate ≥ true count` always, and `estimate ≤ true + ε·N` with probability `≥ 1 − δ`.
   - `merge` adds cell by cell. It is only valid for an identical width, depth **and seed**.
4. **`MinHeap<T>`**: a generic binary heap.
5. **`HeavyHitters`**: sketch plus at most K candidates in a min-heap ranked by `compareRanked` (count desc, then item asc). A non-candidate replaces the weakest candidate only if it ranks **strictly** higher.
6. **`TrendingTopK`**: buckets `b = ⌊now/bucketMs⌋`. Each bucket holds a `HeavyHitters`. A query merges the live buckets' sketches and ranks the union of their candidates.

## Why this matters in interviews

- An exact count needs one counter per distinct item, which can be billions of hashtags. The sketch needs `width × depth` counters whatever the cardinality, for example 2,719 × 5 for ε = 0.001.
- The sketch alone can't *list* the heavy items, because it only answers "how many of X?". The heap keeps the candidates.
- **Mergeability** is the distributed-systems angle. Each shard or each minute keeps its own sketch, and a query adds them together. This is how "trending in the last hour" works without storing raw events.
- Know the failure modes. Errors are one-sided, so you overcount. Collisions hurt rare items far more than frequent ones. Candidate tracking is approximate, so a heavy item that arrives exactly at a bucket boundary may be missed. The usual fix is to keep more than K candidates.

## Hints

- `HeavyHitters` needs to *update* a candidate's count. Either keep an index map `item → heap position` (an indexed heap), or rebuild the heap. K is small.
- Use `Float64Array` rows. They are fast and integer counts stay exact.
- In `TrendingTopK`, expire old buckets on every call, using the injected `now()`.

## Stretch goals

- **Conservative update**: increment only the counters that equal the current minimum, and measure how much the error drops on the Zipf stream.
- **Count-Min-Log** or **Count Sketch** (signed, unbiased) and compare their errors.
- **Space-Saving** (Metwally et al.) for deterministic heavy hitters with no sketch, and compare it to this design.
- Serialize sketches to bytes (`Buffer`) and merge them "across the network".
