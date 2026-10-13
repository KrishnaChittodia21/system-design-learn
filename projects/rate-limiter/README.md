# Build a Pluggable Rate-Limiting Library

## Goal
Implement in `src/index.ts`:

- `TokenBucket` and `SlidingWindowCounter`, both implementing `RateLimitStrategy` (`check`, `consume`, `reset`, `sweep`, `size`, `name`).
- `RateLimiter` — combines several strategies, all-or-nothing charging.
- `retryAfterHeader(ms)` — HTTP `Retry-After` seconds.

Every decision is `{ allowed, remaining, retryAfterMs }` (the limiter adds `deniedBy: string[]`).

## Semantics the judge checks
- **Token bucket:** a new key starts full. Refill is continuous and lazy: `tokens = min(capacity, tokens + elapsedMs * refillPerSecond / 1000)`. `remaining = floor(tokens - cost)`. When denied, `retryAfterMs = ceil((cost - tokens) / ratePerMs)`; `Infinity` if `cost > capacity`.
- **Sliding-window counter:** fixed windows are `floor(now / windowMs)`. `estimate = prev * (1 - elapsedInWindow / windowMs) + curr`; allowed when `estimate + cost <= limit`. `retryAfterMs` is the *exact* earliest time (ceil to ms) the same request would pass — denied 1 ms before, allowed at that moment. Two cases: wait for `prev` to decay in this window, or (if `curr + cost > limit`) wait for the next window, where `curr` becomes `prev`.
- `check` never charges **and never creates state**. A denied `consume` never charges.
- **Limiter:** pre-check every rule; only if all allow, consume from all. `remaining = min`, denied `retryAfterMs = max` of the denying rules (both algorithms only get more permissive as time passes, so the max is safe).
- **Memory:** `maxKeys` → evict the least-recently-*used* key when a new key arrives (a denied consume still counts as a use). `sweep()` drops keys whose state equals a fresh key's.
- Costs must be positive finite numbers; configs must be positive → `RangeError`.
- Use the injected `now()` — never `Date.now()` directly.

## Run
```bash
npm run project -- rate-limiter
npm run project -- rate-limiter --solution
```

## Hints
- Floating point: `(1 - 0.3) / 0.01` is not exactly 70. Compare with a tiny epsilon and use `Math.ceil(x - 1e-9)`.
- Write `#current(key)` that returns the state *rolled forward* to now as a copy; `check` discards it, `consume` persists it.
- Evicting a key resets its limit — that is **fail-open**. Say so in the interview and explain when you'd rather fail closed.

## Stretch goals
- A `FixedWindow` and a `SlidingLog` strategy, plus a benchmark comparing memory per key.
- A Redis-backed strategy: the whole check-and-charge as one Lua script (atomic across gateway nodes).
- GCRA (generic cell rate algorithm): a token bucket stored as a single timestamp.
