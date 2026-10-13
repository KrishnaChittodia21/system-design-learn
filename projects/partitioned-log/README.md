# Build a Kafka-lite Partitioned Log

Implement `Broker` in `src/index.ts`. It is an in-memory model of Kafka's log and consumer-group protocol. There is no networking, so you can focus on the semantics interviewers ask about.

The judge is `test/partitioned-log.test.ts` (18 tests).

```bash
npm run project -- partitioned-log             # judge YOUR code (saves results for the app)
npm run project -- partitioned-log --no-save   # judge without saving
npm run project -- partitioned-log --solution  # run the reference solution
```

## What to build

**The log**
- `createTopic(name, partitions, { retentionMaxRecords })`
- `produce(topic, key, value)`: a keyed record goes to `fnv1a(key) % partitions`. A `null` key round-robins over partitions 0, 1, 2, …
- `produceTo(topic, partition, key, value)` returns the offset. Offsets start at 0 in each partition and are **never reused**.
- `read(topic, partition, offset, max)`, `logStartOffset`, `endOffset`. Reading below the log start throws `OffsetOutOfRangeError`.
- Retention by count: when a partition holds more than `retentionMaxRecords` records, drop the oldest. The log start offset moves forward and the remaining records keep their offsets.

**Consumer groups**
- `joinGroup(group, member, topics)` and `leaveGroup(group, member)` each trigger an **eager rebalance**:
  - `generation += 1`.
  - For each topic, sort the subscribers' ids. Partition `p` goes to `subscribers[p % n]`.
  - Reset every fetch position. The next `poll` starts from the **committed offset**, or from the log start if nothing was committed or the committed offset has since been deleted.
- `poll(group, member, max)` reads from the member's partitions in assignment order and advances its in-memory position. Polling does **not** commit.
- `commit(group, member, offsets)` stores the **next offset to read** (`lastProcessed + 1`). Only the current owner may commit. This fences "zombie" consumers that lost the partition in a rebalance. Validate every entry before applying any of them.
- `lag(group, topic)` is the sum over partitions of `endOffset − committed`.

## Why it matters

- **Ordering**: ordering is per partition, so it is per key. There is no ordering across partitions.
- **Parallelism**: the number of partitions caps the useful consumers in a group. Extra members sit idle.
- **At-least-once**: if a consumer processes records and dies before committing, the next owner reads them again. Exactly-once processing needs idempotent consumers, or offsets committed atomically with the side effects.
- **Retention**: a consumer slower than retention loses data. It resets to the log start, which is `auto.offset.reset=earliest`.

## Hints

- Keep `Partition = { start: number; records: LogRecord[] }`. The offset of `records[i]` is `start + i`.
- Keep per-group maps keyed by `"topic/partition"` for owners, committed offsets and fetch positions.
- FNV-1a in JS: `h ^= byte; h = Math.imul(h, 0x01000193) >>> 0`, iterating over `Buffer.from(key, 'utf8')`.

## Stretch goals

- Use a **sticky / cooperative** assignor that moves as few partitions as possible, and measure how many moves each strategy makes.
- Add session timeouts: a member that hasn't polled within `sessionTimeoutMs` (injected clock) is removed.
- Add **retention by time** and **log compaction** (keep only the latest value per key).
- Add idempotent producers: deduplicate by `(producerId, sequence)` per partition.
