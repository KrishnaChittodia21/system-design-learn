# Build a Stampede-Proof Cache Loader

## Goal
Implement `LoaderCache<V>` in `src/index.ts` — a read-through cache in front of a slow `loader(key)`.

## Entry lifecycle (age = now − loadedAt, loadedAt taken when the load completes)
```
0 ──── fresh ──── freshMs ──── stale (serve + 1 background refresh) ──── freshMs+staleMs ──── expired (callers wait)
negative entries (loader resolved undefined): 0 ── negative ── negativeTtlMs ── expired
```

## What the judge checks
- **Single-flight:** 50 concurrent `get('k')` → 1 loader call, 50 identical results; `inflight` counts keys with a load running.
- **Errors:** every joiner gets the same rejection; nothing cached; next `get` retries; sync throws too.
- **Stale-while-revalidate:** stale reads resolve immediately with the old value; exactly one refresh; a failed refresh → `onError(key, err)`, stale value kept, **no unhandled rejection** (the test runner fails on those); a later stale read retries.
- **Negative caching:** `undefined` cached for `negativeTtlMs` only.
- **Concurrency:** `maxConcurrentLoads` caps running loader calls across all keys; waiters FIFO; `activeLoads` / `queuedLoads` gauges; joining an in-flight key never takes a slot.
- **Invalidation:** see the doc comment on `invalidate` — a generation counter per key is the classic fix.

## Run
```bash
npm run project -- single-flight-cache
npm run project -- single-flight-cache --solution
```

## Hints
- Keep two maps: `entries` (settled values) and `flights` (key → in-flight promise). Remove the flight in a `finally`-style handler, and only if it is still *your* flight.
- `promise.then(onOk, onErr)` for cleanup does not swallow the rejection for the caller who holds `promise`, but a background refresh nobody awaits needs its own `.catch`.
- Semaphore: when a load finishes, hand the slot straight to the next waiter instead of decrementing and re-incrementing.

## Stretch goals
- Probabilistic early refresh (XFetch: refresh with probability that rises as expiry nears) instead of a fixed stale window.
- TTL jitter to avoid a cache avalanche when many keys were loaded together.
- A distributed version: a Redis `SET lock NX PX` lease so only one *process* refreshes a key.
- Bounded memory (plug in the LRU from the `lru-cache` capstone).
