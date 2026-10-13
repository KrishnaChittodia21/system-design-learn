# Build Lamport/Vector Clocks and a Leader-Election Simulator

Three parts, all in `src/index.ts`:

1. **Lamport clocks**: `LamportClock`.
2. **Vector clocks and conflict detection**: `vcCompare`, `vcMerge`, `vcIncrement`, `VectorClock`, `VersionedStore`.
3. **Raft leader election** as a deterministic discrete-event simulation: `mulberry32`, `handleRequestVote`, `handleAppendEntries`, `RaftCluster`.

The judge is `test/clocks-and-election.test.ts` (21 tests).

```bash
npm run project -- clocks-and-election             # judge YOUR code (saves results for the app)
npm run project -- clocks-and-election --no-save   # judge without saving
npm run project -- clocks-and-election --solution  # run the reference solution
```

## Part 1–2: clocks

- Lamport: `tick` and `send` increment the clock; `receive(t)` sets it to `max(local, t) + 1`. If `a → b` then `L(a) < L(b)`, but `L(a) < L(b)` tells you nothing about causality.
- Vector clocks: `a` is *before* `b` when every entry of `a` is `≤` the matching entry of `b` and at least one is `<`. When neither dominates, they are *concurrent*. Missing entries count as 0.
- `VersionedStore` is the Dynamo or Riak model. Here is a write:
  `clock = vcIncrement(context ?? {}, coordinator)`. Delete every stored version whose clock is before or equal to `clock`, keep the concurrent ones as **siblings**, then append the new version. `get` returns every sibling value plus the merged context. A client resolves a conflict by writing back with that context.

## Part 3: Raft election simulator

Nothing uses real time. `RaftCluster` keeps a priority queue of events ordered by `(time, sequence)`:

| event | effect |
|---|---|
| election timeout | follower or candidate becomes a candidate: `term++`, votes for itself, resets its timer, sends `RequestVote` to every peer |
| heartbeat timer | leader sends `AppendEntries` (empty) to every peer and re-arms the timer |
| message delivery | dropped if the receiver is crashed or partitioned away at delivery time; otherwise handled |

Rules (Raft §5.2, §5.4.1):
- **Higher term wins.** Any RPC or reply carrying a higher term makes the receiver a follower in that term with `votedFor = null`. A leader that steps down stops its heartbeats and arms an election timer.
- **One vote per term**, and only for a candidate whose log is at least as up-to-date as yours. Granting a vote resets your election timer.
- A candidate that collects votes from a **majority** (`> n/2`, counting itself) becomes leader and starts heartbeating at once.
- An accepted `AppendEntries` resets the election timer, and a same-term candidate steps down.
- Election timeouts are random integers in `[min, max]`, re-drawn on every reset, and message delays are random integers in `[delayMin, delayMax]`. Take **all** randomness from `mulberry32(seed)` so a seed replays exactly.
- Use a **token per timer**. Resetting a timer increments the token, and a timer event whose token is stale is ignored. This is far simpler than removing events from the heap.
- `crash` stops a node. `restart` brings it back as a follower that keeps `currentTerm` and `votedFor`: they are persisted state, and the tests check this.
- **Don't** implement Pre-Vote or CheckQuorum. One test shows the disruption they prevent.

## Hints

- Write `handleRequestVote` and `handleAppendEntries` as pure rule functions over a `RaftNodeState` first. The tests check them directly, and then the simulator calls them.
- Track `leadersByTerm` every time a node becomes leader. The chaos test asserts that no term ever has two.
- Debug with a seed and a log of `[time] node: event`. Determinism means every bug reproduces.

## Stretch goals

- Add **Pre-Vote** behind a flag and show that the "isolated node inflates its term" test now keeps the old leader.
- Add log replication: `AppendEntries` with entries, `commitIndex`, and the log-matching property. Assert that committed entries are never lost under chaos.
- Add **hybrid logical clocks** (HLC) with an injected physical clock, and show that they stay close to wall time while still respecting causality.
- Measure the time to elect as a function of `electionTimeoutMax − electionTimeoutMin` over 1,000 seeds.
