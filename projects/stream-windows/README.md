# Build a Windowed Stream Aggregator with Watermarks

Implement `assignWindows`, the aggregators, `WindowedAggregator` and `ResultTable` in `src/index.ts`. The judge is `test/stream-windows.test.ts` (17 tests).

```bash
npm run project -- stream-windows             # judge YOUR code (saves results for the app)
npm run project -- stream-windows --no-save   # judge without saving
npm run project -- stream-windows --solution  # run the reference solution
```

## The model

```
events (arrive out of order) ──► assign to windows by EVENT time ──► per (key, window) accumulator
                                        │
          watermark = max(ts) − outOfOrdernessMs ──► fire windows with end ≤ watermark (revision 0)
                                        │
          late but within allowedLatenessMs ──► update + re-emit (revision 1, 2, …)
          later than that ──► drop or side output
                                        │
                     sink: upsert by (key, window.start), keep the highest revision
```

- Windows are **half-open** `[start, end)` and **aligned to epoch 0**. With `size 10, slide 5`, the timestamp 12 belongs to `[5,15)` and `[10,20)`.
- The **watermark** only moves forward. Before the first event it is `-Infinity`.
- An event is **too late** for a window when `window.end + allowedLatenessMs ≤ watermark`. It counts as late (`lateCount`, side output) only if it is too late for **every** one of its windows.
- An event whose window has already fired, but is still within the lateness span, updates the state and is **emitted at once** with `revision + 1`.
- Events with an `id` are deduplicated per window. A redelivered event is a no-op: it is neither counted nor late.
- `advanceWatermark(wm)` handles idle sources: without new events nothing would ever fire. `flush()` is the end of input.
- When one watermark jump fires several windows, emit them sorted by `(end, start, key)`.

## Hints

- Key the state map by `` `${key}\u0000${window.start}` ``. Each entry holds `{ acc, count, fired, revision, ids }`.
- `process` is three steps: add to windows (and emit late updates), detect "too late", then advance the watermark (fire and purge). Advancing goes in a helper shared with `advanceWatermark` and `flush`.
- The batch-equality test is the strongest check. If it fails, print the first mismatching `(key, window)` and replay its events by hand.

## Interview angles

- **Watermark trade-off**: a bigger `outOfOrdernessMs` drops fewer events but adds latency and memory.
- **Allowed lateness**: results become *updates*, so downstream must upsert. An append-only sink would double count.
- **At-least-once sources**: dedupe by event id, or make the sink idempotent, or both (this project does both).
- **Processing-time windows** are simpler but give different answers on replay. Event time gives reproducible results.

## Stretch goals

- **Session windows**: a gap-based window that merges when an event bridges two sessions.
- **Per-partition watermarks**: the overall watermark is the minimum across partitions, with idleness detection.
- **Early firings**: emit speculative results every N events before the watermark arrives.
- Checkpoint state to JSON and restore it, then show identical output after a simulated crash.
