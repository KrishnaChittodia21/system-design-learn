# Build a Resilient Call Wrapper: Retries, Deadlines & a Circuit Breaker

## Goal
Implement in `src/index.ts`: `realSleep`, `defaultIsRetryable`, `backoffDelay`, `RetryBudget`, `retry`, `CircuitBreaker`, `Bulkhead` and `callResilient`. The error classes (`DeadlineExceededError`, `CircuitOpenError`, `BulkheadFullError`) are provided.

```
callResilient(fn) = bulkhead( retry( breaker( fn(attempt, signal) ) ) )
                     │          │       └ fail fast when the dependency is down
                     │          └ backoff + jitter, deadline, cancellation, budget
                     └ cap concurrent calls to this dependency
```

## What the judge checks
- Everything is deterministic: tests inject `now`, `random`, `sleep` (records the delay and advances a fake clock) and `timers` (fake `setTimeout`/`clearTimeout`). Never read the real clock/timers when an option is given.
- **Retry:** the doc comment on `retry` is the spec — attempt numbering, `onRetry` before sleeping, errors rethrown unwrapped, budget, deadline (`DeadlineExceededError` with `cause`), caller abort (`signal.reason`), timers cleared.
- **A hung attempt** that ignores its signal must still be abandoned at the deadline — race it against the abort.
- **Breaker:** `retryAfterMs` = time left until half-open; open → half-open happens lazily when `state` is read or `execute` is called; `onStateChange` sees `closed->open`, `open->half-open`, `half-open->closed`.
- **Bulkhead:** FIFO queue; rejected calls never invoke `fn`.

## Run
```bash
npm run project -- resilient-client
npm run project -- resilient-client --solution
```

## Hints
- Per attempt: create an `AbortController`, forward the caller's abort into it, arm a deadline timer with the injected `timers`, and `Promise`-race `fn` against `controller.signal`'s abort event. Clean up both listeners and the timer in every path.
- Decide "will the next sleep cross the deadline?" *before* sleeping — sleeping into a certain timeout wastes the caller's budget.
- The bulkhead and the loader semaphore in the `single-flight-cache` capstone are the same pattern: hand the slot directly to the next waiter.

## Stretch goals
- Honour a server's `Retry-After` (`err.retryAfterMs`) as a floor on the backoff.
- Sliding-window failure-*rate* breaker (e.g. ≥ 50% of the last 20 calls) instead of consecutive failures.
- Hedged requests: send a second attempt after the p95 latency and take whichever answers first.
- Deadline propagation: pass the remaining budget downstream as a header (`grpc-timeout`).
