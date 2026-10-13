import type { Topic } from '../../types';

const topic: Topic = {
  id: 'platform-key-tech',
  phase: 'platform',
  order: 6,
  title: 'Key Technology Deep Dives: DynamoDB, Temporal & ZooKeeper',
  subtitle:
    'Three technologies interviewers love to probe once you name them: DynamoDB (keys, single-table design, GSI vs LSI, partition limits, transactions, DAX, Streams, global tables), Temporal durable execution (workflows vs activities, deterministic replay, versioning, history limits, when it beats saga + outbox), and ZooKeeper (ZAB, znodes, one-shot watches, recipes, and why Kafka and Kubernetes moved to KRaft and etcd).',
  estimatedMinutes: 130,
  sources: [
    'Hello Interview — Key Technologies deep dives: DynamoDB (hellointerview.com/learn/system-design/deep-dives/dynamodb) and ZooKeeper',
    'AWS DynamoDB Developer Guide (2026) — Service quotas; Partitions; Burst and adaptive capacity; Global secondary indexes; Local secondary indexes; Transactions; DAX consistency; DynamoDB Streams; Global tables (MREC and MRSC)',
    'Alex DeBrie — The DynamoDB Book (single-table design, access-pattern-first modelling)',
    'Temporal docs (2026) — Workflow Execution limits; Temporal Cloud limits; Retry Policies; Activity timeouts; TypeScript SDK versioning (patching, Worker Versioning); Continue-As-New',
    'Apache ZooKeeper 3.9 docs — Programmer\'s Guide (znodes, sessions, watches, persistent recursive watches, consistency guarantees) and Recipes',
    'Junqueira, Reed, Serafini — Zab: High-performance broadcast for primary-backup systems (DSN 2011)',
    'Apache Kafka 4.0 release notes (March 2025) — ZooKeeper mode removed, KRaft only; KIP-500',
    'Apache Curator docs — Recipes (LeaderLatch, InterProcessMutex, protection mode)',
  ],
  tags: ['dynamodb', 'single-table-design', 'gsi', 'lsi', 'dax', 'dynamodb-streams', 'global-tables', 'temporal', 'durable-execution', 'workflow-engine', 'zookeeper', 'zab', 'coordination', 'kraft', 'etcd'],
  cheatSheet: [
    'Before naming a managed product, ask "is it OK to use DynamoDB/Temporal, or should I stay vendor-neutral?" Then state why it fits, its limits and the open-source equivalent (Cassandra/ScyllaDB, Cadence/self-hosted Temporal, etcd).',
    'DynamoDB partition = 10 GB and 3,000 RCU / 1,000 WCU. RCU = one 4 KB strongly consistent read (eventual = half); WCU = one 1 KB write; transactional ops cost 2×. Items are at most 400 KB; a Query page is at most 1 MB. The default table quota is 40K RCU/WCU, and it is adjustable.',
    'Model access patterns first: PK spreads load, SK gives order and range queries, single-table design pre-joins related items under one PK. GSIs re-key data for other patterns (eventual, can be added any time, own capacity, can throttle the base table). LSIs keep the PK with another SK (strong reads, creation-time only, 10 GB item-collection cap).',
    'Hot keys: adaptive capacity is instant and can isolate one hot item on its own partition, but a single key never exceeds 3,000 RCU / 1,000 WCU, so shard the key (suffix #0..N) or cache reads. Burst capacity banks up to 300 s of unused throughput.',
    'Transactions: up to 100 items / 4 MB, same Region, no item twice, 2× capacity, ClientRequestToken idempotent for 10 min, failures return per-item CancellationReasons. Prefer single-item condition expressions (optimistic version check) when they suffice.',
    'DAX: item cache and query cache are separate; writes do not invalidate cached queries; strongly consistent and transactional reads pass through uncached; writes that bypass DAX (incl. global-table replication) go stale until TTL. Streams: 24 h retention, exactly once per record, ordered per item only, ≤ 2 readers per shard.',
    'Global tables: MREC = async, typically < 1 s, last-writer-wins per item, RPO > 0. MRSC = exactly 3 Regions (3 replicas or 2 + witness), RPO 0, but no transactions, TTL or LSIs, and writes can fail with ReplicatedWriteConflictException.',
    'Temporal: workflow code is replayed from the event history and must be deterministic (no I/O, clocks or randomness except via SDK APIs); activities do the side effects with retries (default: 1 s initial, ×2, cap 100 s, unlimited attempts) and must be idempotent. Set Start-To-Close (or Schedule-To-Close) on every activity.',
    'Temporal limits: history 51,200 events / 50 MB (warn at 10,240 / 10 MB) → Continue-As-New; 2 MB per payload; 4 MB per gRPC message; 2,000 pending activities, child workflows or outbound signals; 10,000 signals per execution. Version changes with patched()/deprecatePatch() or Worker Versioning.',
    'ZooKeeper: ZAB leader with quorum writes, zxid = (epoch, counter), reads served locally (may be stale; sync() first). Znodes < 1 MB, ephemeral (session-bound, no children), sequential (10-digit counter). Standard watches are one-shot; persistent recursive watches exist since 3.6. Kafka 4.0 removed ZooKeeper (KRaft); Kubernetes uses etcd.',
  ],
  sections: [
    {
      heading: 'Using a key technology in an interview: ask, justify, bound, and have a neutral fallback',
      body: `**Intuition:** naming a specific product is a bet. If you know it deeply, it makes your design concrete and lets you go deep fast. If you name it and cannot answer the follow-up ("what happens when that partition gets hot?"), it hurts you more than staying generic. Hello Interview's guidance for DynamoDB applies to every managed product: **ask whether it is allowed**. Some interviewers are happy with AWS services. Others want vendor-neutral, open-source designs.

**A four-step script:**
1. **Ask:** "Can I assume AWS, so DynamoDB is on the table, or should I stay vendor-neutral?"
2. **Justify against requirements:** "Access is by user id plus a time range, 50K writes/s, no ad-hoc joins, and we need multi-AZ durability without operating a cluster. That is DynamoDB's sweet spot."
3. **Bound it:** state the limit that matters for *this* design: 1,000 WCU per partition, 400 KB items, eventual GSIs, 24-hour Streams retention.
4. **Fallback:** "If AWS is out, the same model works on Cassandra or ScyllaDB, with the trade-offs being X and Y."

| Need | Managed / named product | Vendor-neutral equivalent | What changes |
|---|---|---|---|
| Key-value / wide-column at scale | DynamoDB | Cassandra, ScyllaDB | You operate the cluster; tunable consistency (QUORUM); LWW by cell timestamp; no 400 KB item cap, but large partitions hurt |
| Durable workflows | Temporal Cloud, AWS Step Functions | Self-hosted Temporal, Cadence, Netflix Conductor, Restate | Same programming model for Temporal and Cadence; you run the persistence (Cassandra, Postgres or MySQL) and the history shards |
| Coordination / config / leader election | ZooKeeper, etcd | etcd (Raft), Consul | etcd: leases instead of sessions, MVCC revisions, watches that resume from a revision |
| Change data capture | DynamoDB Streams | Debezium on Postgres/MySQL into Kafka | Kafka retention is configurable (days or forever) instead of 24 h |

**What interviewers probe once you name these:** partition-key choice and hot keys (DynamoDB), what happens on worker crash and on code change (Temporal), and the semantics of watches and sessions (ZooKeeper). The rest of this topic goes deep on exactly those.`,
      keyPoints: [
        'Ask whether managed or AWS-specific technology is allowed before you build on it.',
        'Justify the product against stated requirements and name the limit that matters for this design.',
        'Always have the open-source equivalent and its trade-offs ready.',
      ],
      source: 'Hello Interview — DynamoDB deep dive ("Ask if DynamoDB is allowed"); Hello Interview — Key Technologies',
    },
    {
      heading: 'DynamoDB data model: partitions, keys and the capacity arithmetic',
      body: `**Intuition:** DynamoDB is a giant distributed hash map of sorted lists. The **partition key** is hashed to choose a partition (a replicated storage node group across three AZs). Within a partition key, items are kept **sorted by the sort key**, so "all orders of user 42 in March" is one contiguous range read. Everything else follows from that shape.

**Units and limits (AWS quotas page, 2026):**
| Thing | Limit / cost |
|---|---|
| Item size | 400 KB, including attribute names |
| Partition | ~10 GB of data; **3,000 RCU and 1,000 WCU** per partition |
| Read cost | 1 RCU = one strongly consistent read of up to 4 KB per second; eventually consistent = 0.5 RCU; transactional = 2 RCU |
| Write cost | 1 WCU = one write of up to 1 KB; transactional = 2 WCU |
| Query/Scan | Up to **1 MB** per page, then \`LastEvaluatedKey\` to continue; \`Limit\` and filters apply inside that page |
| Batch APIs | \`BatchWriteItem\`: 25 put/delete requests, 16 MB; \`BatchGetItem\`: 100 keys, 16 MB; partial failures come back as \`UnprocessedItems\` / \`UnprocessedKeys\` |
| Table throughput quota | 40,000 RCU and 40,000 WCU per table by default (adjustable); account default 80K for provisioned |
| Indexes | 20 GSIs (default quota), 5 LSIs per table |

**Capacity math you should do out loud:** a 2.5 KB item costs ceil(2.5 / 1) = **3 WCU** per write. A 6 KB eventually consistent read costs ceil(6 / 4) × 0.5 = **1 RCU**. 5,000 writes/s of that item need 15,000 WCU, which means at least 15 partitions' worth of write capacity, and the PK must spread writes across all of them.

**Choosing the partition key:** high cardinality, requests spread evenly over time, and it matches the main read pattern. User id and order id are good. Status, date and tenant (when one tenant is 40% of traffic) are bad. **Sort-key** design gives you free range queries: \`ORDER#2026-10-12T10:00:00Z#01J9…\`. Hello Interview recommends time-ordered unique ids (ULID, UUIDv7, Snowflake) over raw timestamps, so that two writes in the same millisecond do not collide.

**Filter expressions do not save capacity.** A filter is applied *after* items are read, so you pay for everything the key condition matched (up to 1 MB per page). If you filter away 95% of the items, model a better key or a sparse index instead.`,
      code: [
        {
          language: 'typescript',
          title: 'Query one user\'s orders for a month, paginating correctly (AWS SDK v3)',
          code: `import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, QueryCommandOutput } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-south-1' }));

export async function ordersForMonth(userId: string, month: string /* '2026-10' */) {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page: QueryCommandOutput = await ddb.send(
      new QueryCommand({
        TableName: 'app',
        // Key condition = partition + sort-key range: reads ONLY matching items
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': \`USER#\${userId}\`, ':sk': \`ORDER#\${month}\` },
        ScanIndexForward: false,          // newest first (descending sort key)
        ExclusiveStartKey: startKey,      // continue after the previous 1 MB page
        ReturnConsumedCapacity: 'TOTAL',  // log it: capacity is your cost model
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;     // undefined means no more pages
  } while (startKey);
  return items;
}`,
        },
      ],
      keyPoints: [
        'PK hashes to a partition (3,000 RCU / 1,000 WCU / ~10 GB); SK orders items within a PK for range queries.',
        'Do capacity math in 1 KB write and 4 KB read units; transactions double it.',
        'Filters run after the read and cost the same capacity; fix the key design instead.',
      ],
      source: 'AWS DynamoDB Developer Guide — Service quotas; Partitions and data distribution; Read/write capacity units',
    },
    {
      heading: 'Single-table design: pre-joining data around access patterns',
      body: `**Intuition:** DynamoDB has no joins, so you store related things **next to each other** under the same partition key, and one Query fetches the "join" in a single round trip. The table stops being a list of entities and becomes a list of **answers to known questions**.

**The method (DeBrie / AWS):**
1. Write down every access pattern with its frequency and latency target *before* designing keys. For example: get customer, list a customer's orders (newest first), get an order with its items, list open orders by warehouse, look up a customer by email.
2. Use **generic key names** (\`PK\`, \`SK\`, \`GSI1PK\`, \`GSI1SK\`) and prefixed values so different entity types can share them (\`CUST#42\`, \`ORDER#…\`, \`ITEM#…\`).
3. Put an entity's children in the parent's **item collection** when they are read together.
4. Add **overloaded GSIs** for the remaining patterns, and **sparse GSIs** (only items that have the GSI attribute appear) for "list all open X".

| Access pattern | Key condition | Notes |
|---|---|---|
| Get customer 42 | PK = \`CUST#42\`, SK = \`PROFILE\` | GetItem, 1 RCU |
| Customer's orders, newest first | PK = \`CUST#42\`, SK begins_with \`ORDER#\` | One Query, descending |
| Order with its line items | PK = \`ORDER#01J9…\`, SK begins_with nothing (all) | Header + items in one collection |
| Open orders for warehouse BLR-1 | GSI1PK = \`WH#BLR-1#OPEN\`, GSI1SK = createdAt | Sparse: remove the GSI1 attributes when the order closes |
| Customer by email (unique) | PK = \`EMAIL#a@b.com\` | Separate "uniqueness" item written in a transaction |

**When single-table design hurts:**
- **Evolving or unknown access patterns.** Every new pattern means a new GSI or a backfill migration. This is Hello Interview's warning sign: heavy dependence on many GSIs and LSIs means the data wants a relational database.
- **Analytics and ad-hoc queries.** Export to S3 (full or incremental export) and query with Athena or Redshift, or stream to OpenSearch.
- **Team and debugging cost.** Overloaded keys are unreadable without documentation. Many teams use one table per bounded context (or service) rather than one table for the whole company.
- **Item collections with LSIs** are capped at 10 GB, and adaptive capacity will not split an item collection across partitions when the table has an LSI.

**Interview line:** "I will list the access patterns first, then show the keys that serve each one, and call out which patterns would force a GSI. If the product keeps adding query shapes weekly, I would argue for Postgres."`,
      diagram: `  Table "app" (single-table design)

  PK              SK                       attributes          GSI1PK
  --------------  -----------------------  ------------------  -------------
  CUST#42         PROFILE                  name, email, tier
  CUST#42         ORDER#2026-10-11#01J9AB  total=1499, status
  CUST#42         ORDER#2026-10-12#01J9CD  total=899, status
  ORDER#01J9CD    HEADER                   cust=42, wh=BLR-1   WH#BLR-1#OPEN
  ORDER#01J9CD    ITEM#1                   sku=S1, qty=2
  ORDER#01J9CD    ITEM#2                   sku=S9, qty=1
  EMAIL#a@b.com   UNIQUE                   cust=42

  Query PK=CUST#42, SK begins_with ORDER#  -> a customer's orders (one call)
  Query PK=ORDER#01J9CD                    -> header + items (pre-joined)
  Query GSI1 PK=WH#BLR-1#OPEN              -> sparse "open orders" index`,
      keyPoints: [
        'List access patterns first; keys are answers to known questions.',
        'Item collections pre-join parents and children; sparse, overloaded GSIs cover the rest.',
        'Frequently changing query shapes or analytics push you to a relational store or an export pipeline.',
      ],
      source: 'Alex DeBrie — The DynamoDB Book; AWS DynamoDB Developer Guide — Best practices for modeling relational data',
    },
    {
      heading: 'GSI vs LSI: the decision you cannot easily undo',
      body: `**Intuition:** a **GSI** is a second, automatically maintained table with a different key. It is fully flexible, but it is updated *asynchronously*. An **LSI** is an alternative sort order *inside* each partition key. It is strongly consistent, but you must decide on it the day you create the table, and it caps how big each partition key can grow.

| | Global secondary index (GSI) | Local secondary index (LSI) |
|---|---|---|
| Key | Any PK and optional SK (now up to 4 + 4 attributes with multi-attribute keys) | Same PK as the table, a different SK |
| Consistency | **Eventually consistent only** (usually < 1 s, longer in rare failures) | Strongly or eventually consistent |
| When created | Any time (online backfill) | **Only at table creation** |
| Capacity | Its own RCU/WCU (inherits the capacity mode) | Shares the base table's capacity |
| Size impact | None on the base table | **10 GB per item collection** (all items with one PK value, plus their LSI entries) |
| Uniqueness | Keys need not be unique | Keys need not be unique |
| Quota | 20 per table (default, adjustable) | 5 per table |
| Gotcha | An under-provisioned GSI **throttles writes to the base table** | Adaptive capacity cannot split item collections when an LSI exists |

**Write cost of GSIs:** every base-table write that touches indexed attributes also writes each affected GSI. Changing an indexed key costs **2 index writes** (delete the old entry, put the new one). Project only what the queries need (\`KEYS_ONLY\` or \`INCLUDE\`), because index items are charged by projected size, plus about 100 bytes of overhead each.

**Patterns:**
- **Sparse index:** the GSI key attribute exists only on items you want listed (e.g. \`openSince\` is set only while an order is open). The index stays tiny and the Query returns only open items.
- **Inverted index:** a GSI with PK = SK and SK = PK, to traverse many-to-many relationships (groups ↔ members) in both directions.
- **Read-your-write through a GSI:** you cannot get it. If the user must immediately see their new item in a list, read the list from the **base table's** item collection, or merge the just-written item on the client.`,
      code: [
        {
          language: 'typescript',
          title: 'A sparse GSI for "open orders per warehouse" (create, then keep it sparse)',
          code: `import { UpdateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const raw = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(raw);

// GSIs can be added to a live table (LSIs cannot).
await raw.send(new UpdateTableCommand({
  TableName: 'app',
  AttributeDefinitions: [
    { AttributeName: 'GSI1PK', AttributeType: 'S' },
    { AttributeName: 'GSI1SK', AttributeType: 'S' },
  ],
  GlobalSecondaryIndexUpdates: [{
    Create: {
      IndexName: 'GSI1',
      KeySchema: [{ AttributeName: 'GSI1PK', KeyType: 'HASH' }, { AttributeName: 'GSI1SK', KeyType: 'RANGE' }],
      Projection: { ProjectionType: 'INCLUDE', NonKeyAttributes: ['total', 'cust'] },
    },
  }],
}));

// Closing an order REMOVES the GSI attributes, so it drops out of the index.
export async function closeOrder(orderId: string) {
  await ddb.send(new UpdateCommand({
    TableName: 'app',
    Key: { PK: \`ORDER#\${orderId}\`, SK: 'HEADER' },
    UpdateExpression: 'SET #s = :closed REMOVE GSI1PK, GSI1SK',
    ConditionExpression: '#s = :open',              // idempotent state transition
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':open': 'OPEN', ':closed': 'CLOSED' },
  }));
}`,
        },
      ],
      keyPoints: [
        'GSI: any key, eventual only, add any time, own capacity, can back-pressure base-table writes.',
        'LSI: same PK, strong reads, creation-time only, 10 GB item-collection cap.',
        'Sparse GSIs make "list all open X" cheap; you cannot read your own write through a GSI.',
      ],
      source: 'AWS DynamoDB Developer Guide — Using Global Secondary Indexes; Local Secondary Indexes; Hello Interview — DynamoDB deep dive',
    },
    {
      heading: 'Throughput in practice: partition limits, burst, adaptive capacity and hot keys',
      body: `**Intuition:** your table's capacity is a sum over partitions, but each request lands on *one* partition. If a single key is hot, the table-level number does not help. That key's partition is the bottleneck.

**What DynamoDB does for you:**
- **Burst capacity:** unused throughput is banked for up to **300 seconds** and can absorb short spikes (AWS may also use it for background work, so do not plan on it).
- **Adaptive capacity:** automatic, instant, and free. A hot partition can borrow unused table capacity, up to the **per-partition maximum** of 3,000 RCU / 1,000 WCU. If traffic concentrates on a few items, DynamoDB **rebalances** so frequently accessed items do not share a partition. In the extreme, one item gets a partition to itself, and that is the ceiling: **one key can never exceed 3,000 RCU / 1,000 WCU**.
- **On-demand mode:** no capacity planning. A new on-demand table serves up to about 4,000 writes/s and 12,000 reads/s right away, and it adapts to roughly **2× the previous peak** almost instantly. Beyond that it scales over minutes, so a 10× launch spike can throttle. **Warm throughput** lets you pre-warm a table or index before a known event. You can also cap on-demand spend with maximum throughput settings.

**Hot-key fixes, in order of preference:**
1. **Better key choice** (e.g. \`TENANT#7#USER#123\` instead of \`TENANT#7\`).
2. **Write sharding:** append a suffix \`#0..N-1\` (random for pure writes, or a hash of a secondary attribute so reads can target one shard). Reads scatter-gather across N shards. For counters, sum the N shard items, or aggregate asynchronously.
3. **Absorb reads** with DAX or an app-level cache for read-hot items. This does not help hot *writes*.
4. **Aggregate before writing:** buffer per-key increments for 1–5 s in the service and flush one \`ADD\` per window.

**Diagnose it:** CloudWatch Contributor Insights shows the most-accessed and most-throttled keys. \`ThrottledRequests\` with plenty of table-level headroom is the classic hot-partition signature.`,
      code: [
        {
          language: 'typescript',
          title: 'Write-sharded counter for a viral item (N shards, scatter-gather read)',
          code: `import { DynamoDBDocumentClient, UpdateCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const SHARDS = 10; // 10 x 1,000 WCU ceiling = up to ~10K increments/s for one logical key

export async function incrementViews(ddb: DynamoDBDocumentClient, videoId: string, by = 1) {
  const shard = Math.floor(Math.random() * SHARDS);       // spread writes uniformly
  await ddb.send(new UpdateCommand({
    TableName: 'counters',
    Key: { PK: \`VIEWS#\${videoId}#\${shard}\` },
    UpdateExpression: 'ADD #c :by',                          // atomic, no read needed
    ExpressionAttributeNames: { '#c': 'count' },
    ExpressionAttributeValues: { ':by': by },
  }));
}

export async function totalViews(ddb: DynamoDBDocumentClient, videoId: string): Promise<number> {
  const keys = Array.from({ length: SHARDS }, (_, i) => ({ PK: \`VIEWS#\${videoId}#\${i}\` }));
  const res = await ddb.send(new BatchGetCommand({ RequestItems: { counters: { Keys: keys } } }));
  // Production code must retry res.UnprocessedKeys with backoff
  return (res.Responses?.counters ?? []).reduce((sum, it) => sum + Number(it.count ?? 0), 0);
}`,
        },
      ],
      keyPoints: [
        'One key tops out at 3,000 RCU / 1,000 WCU even after adaptive capacity isolates it.',
        'Burst = up to 300 s of banked capacity; on-demand absorbs ~2× the previous peak instantly; pre-warm for launches.',
        'Fix hot keys with key design, write sharding, read caching or pre-aggregation; find them with Contributor Insights.',
      ],
      source: 'AWS DynamoDB Developer Guide — Burst and adaptive capacity; On-demand capacity mode; Warm throughput',
    },
    {
      heading: 'Transactions, conditional writes and idempotency in DynamoDB',
      body: `**Intuition:** most DynamoDB correctness problems are solved with a **condition expression on a single item**: "write only if version = 7", "create only if it does not exist". Reach for multi-item transactions when one business fact spans several items, such as reserving stock and creating an order, or enforcing a unique email.

**TransactWriteItems / TransactGetItems (2026 limits):**
- Up to **100 actions** on up to 100 distinct items, aggregate **4 MB**, across tables in **one account and one Region**.
- You **cannot target the same item twice** in one transaction (no ConditionCheck plus Update on the same key).
- Cost: **2 underlying operations per item** (prepare and commit), consumed even when the transaction is cancelled.
- **Idempotency:** pass a \`ClientRequestToken\`. Retries with the same token within **10 minutes** return success without reapplying; the same token with different parameters returns \`IdempotentParameterMismatch\`.
- Failures return \`TransactionCanceledException\` with **CancellationReasons in request order** (\`ConditionalCheckFailed\`, \`TransactionConflict\`…), so you can tell the user which condition failed.
- **Isolation:** serializable against single-item reads and writes and other transactions. \`Query\`, \`Scan\` and \`BatchGetItem\` as a whole are only **read-committed** relative to a transaction, so a Query can see half of a transaction's items. Use \`TransactGetItems\` when you need an atomic snapshot of several items.
- **GSIs and Streams** receive a transaction's changes gradually. Stream consumers must not assume transaction atomicity or ordering across items. On **global tables** a transaction is atomic only in its own Region (MREC), and **MRSC does not support transactions** at all.

**Optimistic locking pattern:** store \`version\`. Update with \`ConditionExpression: version = :expected\` and \`SET version = version + 1\`. On \`ConditionalCheckFailedException\`, re-read and retry, or surface a conflict. It costs 1 WCU per write instead of 2 and has no transaction conflicts.`,
      code: [
        {
          language: 'typescript',
          title: 'Create a user with a unique email in one transaction',
          code: `import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';

export async function createUser(ddb: DynamoDBDocumentClient, email: string, name: string, requestId: string) {
  const userId = randomUUID();
  try {
    await ddb.send(new TransactWriteCommand({
      ClientRequestToken: requestId,   // safe client retries for 10 minutes
      TransactItems: [
        { Put: {                       // uniqueness guard item
          TableName: 'app',
          Item: { PK: \`EMAIL#\${email.toLowerCase()}\`, SK: 'UNIQUE', userId },
          ConditionExpression: 'attribute_not_exists(PK)',
        } },
        { Put: {
          TableName: 'app',
          Item: { PK: \`USER#\${userId}\`, SK: 'PROFILE', email, name, version: 1 },
          ConditionExpression: 'attribute_not_exists(PK)',
        } },
      ],
    }));
    return userId;
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      // Reasons are in the same order as TransactItems
      const [emailReason] = err.CancellationReasons ?? [];
      if (emailReason?.Code === 'ConditionalCheckFailed') throw new Error('EMAIL_TAKEN');
    }
    throw err; // TransactionConflict, throttling: retry with backoff, same token
  }
}`,
        },
      ],
      keyPoints: [
        'Single-item conditions (optimistic versioning) first; transactions when one fact spans items.',
        '100 items / 4 MB, one Region, no item twice, 2× capacity, 10-minute ClientRequestToken window.',
        'Query and Scan are read-committed against transactions; Streams and GSIs see transactional changes gradually.',
      ],
      source: 'AWS DynamoDB Developer Guide — Amazon DynamoDB Transactions: How it works',
    },
    {
      heading: 'DAX, Streams and global tables: the caveats interviewers dig for',
      body: `**DAX (DynamoDB Accelerator)** is an in-memory, write-through cache cluster in your VPC. It gives microsecond reads, and the API is the same as DynamoDB, but you must use the DAX client.
- There are two **independent caches**: the **item cache** (GetItem and BatchGetItem) and the **query cache** (Query and Scan result sets). A write through DAX updates the item cache but does **not invalidate cached query results**. A user who adds an item and re-runs the same Query sees the old list until the query-cache TTL expires (5 min default).
- **Strongly consistent and transactional reads pass through** to DynamoDB and are not cached.
- **Writes that bypass DAX** (another service using the plain SDK, Lambda, **global-table replication from other Regions**) leave DAX stale until TTL or eviction.
- **Negative caching:** "item not found" is cached too, so a read-before-create race can keep returning "missing" after the item exists, if it was created outside DAX.
- Cluster nodes replicate the item cache asynchronously (usually < 1 s), so two clients can read different values. Run ≥ 3 nodes across AZs.

**DynamoDB Streams** give an ordered change log per table.
- **24-hour retention.** A consumer outage longer than a day loses changes, so for a long-lived log use Kinesis Data Streams for DynamoDB, or land the changes in Kafka.
- Each stream record appears **exactly once**, and records for the **same item** appear in modification order. There is **no ordering across items**. Shards split, and parents must be processed before children (the KCL adapter and Lambda handle this).
- Design for **≤ 2 concurrent readers per shard** (1 recommended on global tables). Fan out through one Lambda or Kinesis, not ten consumers.
- No-op writes (data unchanged) produce no record. A transaction's items appear as separate records, possibly interleaved with others.

**Global tables** come in two modes:
| | MREC (default) | MRSC |
|---|---|---|
| Replication | Async, typically ≤ 1 s | Sync to at least one other Region before ack |
| Conflicts | **Last writer wins** per item (internal timestamp) | Write fails with \`ReplicatedWriteConflictException\` (retryable) |
| Strong reads | Latest only if the last write was in the same Region | Latest everywhere |
| Regions | Any number | **Exactly 3** (3 replicas, or 2 replicas + 1 witness) |
| Not supported | n/a | **Transactions, TTL, LSIs**; replicas cannot be added later; the table must be empty to convert |
| RPO | Replication delay (seconds) | 0 |

LWW silently discards concurrent updates. For carts, counters and balances, route each item's writes to a **home Region**, or use MRSC and accept the cross-Region write latency.`,
      keyPoints: [
        'DAX: item and query caches are separate; strong/transactional reads uncached; bypassing writes go stale; negative caching.',
        'Streams: 24 h, exactly once, ordered per item only, ≤ 2 readers per shard.',
        'Global tables: MREC = async LWW, RPO > 0; MRSC = 3 Regions, RPO 0, no transactions, TTL or LSIs.',
      ],
      source: 'AWS DynamoDB Developer Guide — DAX and DynamoDB consistency models; Change data capture for DynamoDB Streams; How global tables work',
    },
    {
      heading: 'When NOT to use DynamoDB',
      body: `**Intuition:** DynamoDB is excellent when you know your queries, need predictable single-digit-millisecond latency at any scale, and do not want to run a database. It is a poor fit when the questions you ask the data keep changing.

| Requirement | Why DynamoDB struggles | Better fit |
|---|---|---|
| Ad-hoc queries, joins, reporting | No joins; filters cost full reads; Scan is O(table) | Postgres, a warehouse (Redshift, BigQuery), or an export to S3 + Athena |
| Access patterns change monthly | Each change means a new GSI or backfill; overloaded keys get complex | Postgres with indexes; maybe DynamoDB later for proven hot paths |
| Large items (> 400 KB) or blobs | Hard item limit; cost scales per KB | S3 for the blob + DynamoDB/Postgres for metadata |
| Very high sustained writes of large items | Cost is linear per 1 KB write unit and GSIs multiply it | Cassandra/ScyllaDB on your own hardware, or batch to S3 |
| Strict multi-entity invariants across many rows | 100-item transactions, 2× cost, conflicts under contention | Relational with serializable or row locks |
| Full-text, geo, vector-heavy search | Limited native support | OpenSearch, PostGIS, a dedicated vector store |
| Multi-cloud, on-prem, or "no AWS" interviews | Vendor lock-in | Cassandra, ScyllaDB, FoundationDB, CockroachDB |

**Cost reality check:** on-demand list price in us-east-1 is about **$0.625 per million write request units** and **$0.125 per million read request units** (after the November 2024 price cut; check your Region, e.g. ap-south-1). 20K writes/s of 2 KB items is 40K WRU/s ≈ 104B per 30-day month ≈ **$65K/month** in writes alone. Provisioned capacity with reserved pricing can be several times cheaper for steady load. Always do this arithmetic in the interview when writes are heavy.

**A senior answer** names DynamoDB for the hot, well-understood path (sessions, carts, idempotency keys, user feeds, device state) and keeps the relational system of record for money, reporting and evolving queries. It connects the two with Streams or CDC.`,
      keyPoints: [
        'Changing access patterns, ad-hoc analytics and joins are the main reasons to avoid it.',
        'Do the write-cost arithmetic: per-KB pricing multiplied by GSIs gets expensive at high write rates.',
        'A common senior split: DynamoDB for hot known paths, relational for the system of record.',
      ],
      source: 'Hello Interview — DynamoDB deep dive ("When not to use it"); AWS DynamoDB pricing page (Nov 2024 on-demand price reduction)',
    },
    {
      heading: 'Temporal and durable execution: workflows, activities, event history and replay',
      body: `**Intuition:** with Temporal you write a long-running business process as ordinary code (\`await chargeCard(); await sleep('3 days'); await sendReminder()\`) and the platform makes that code **survive crashes, deploys and week-long waits**. It records every decision the code made in an append-only **event history**. If the worker dies, another worker re-runs the code from the top and *replays* the history to rebuild the exact in-memory state, skipping work that already happened.

**The moving parts:**
- **Temporal Service** (Temporal Cloud, or self-hosted on Cassandra, Postgres or MySQL with Elasticsearch for visibility): stores histories, owns timers and **task queues**. Executions are sharded by workflow id across history shards.
- **Workers** (your NestJS or Node process with the TS SDK) **poll** task queues. They run two kinds of code:
  - **Workflow code:** orchestration logic. It must be **deterministic**, because it is replayed. No network or file I/O, no real clocks, no randomness except through SDK APIs.
  - **Activity code:** the side effects (call the PSP, send email, write the DB). It runs once per attempt, with **retries and timeouts** managed by the service. It must be **idempotent**, because an attempt can succeed and then time out or lose its completion.
- **Commands and events:** when workflow code calls an activity, the worker sends a *ScheduleActivityTask* command, and the service records \`ActivityTaskScheduled\`, then \`Started\`, then \`Completed\` with the result. On replay, the SDK sees that \`Completed\` event and returns the recorded result *without calling the activity again*.

**What happens on a crash mid-workflow:** the worker running step 3 of 5 dies. Step 3's activity attempt times out (Start-To-Close) and is retried on another worker. When the next workflow task arrives, a healthy worker loads the history, replays steps 1–2 from recorded results (milliseconds), and continues. No status columns, no cron sweepers, no outbox polling. The history *is* the state.

**Why it matters for a NestJS/microservices engineer:** it replaces the hand-built saga machinery (*ds-transactions* covers sagas, outbox and compensations) with a programming model in which a timeout, a retry or a 30-day wait is one line, and the state of every in-flight business process can be queried.`,
      diagram: `  client (NestJS API)                 Temporal Service
  ------------------                  ---------------------------------------
  start workflow id=order-123 ----->  history shard: order-123
                                       1 WorkflowExecutionStarted
                                       2-4 WorkflowTask Scheduled/Started/Done
  Worker A (task queue "orders")       5 ActivityTaskScheduled  reserveStock
   workflow code: deterministic <-->   6 ActivityTaskStarted
   activity code: side effects         7 ActivityTaskCompleted  {ok}
            X  crash                   ...
                                      11 ActivityTaskScheduled  chargeCard
  Worker B picks up next workflow task:
   replay events 1..10 (no re-execution: results come from history)
   continue at chargeCard attempt 2 (retry policy, idempotency key!)
                                      14 TimerStarted  3 days
                                      15 TimerFired    (service-owned timer)`,
      keyPoints: [
        'Workflow code orchestrates and is replayed from history, so it must be deterministic; activities do side effects with retries.',
        'History is the state: a crashed worker is replaced by replaying recorded results, with no re-execution.',
        'Activities can run more than once, so they need idempotency keys.',
      ],
      source: 'Temporal docs — Workflows, Activities, Event History, Workers and Task Queues',
    },
    {
      heading: 'Temporal determinism, versioning and history limits',
      body: `**Intuition:** replay works only if the workflow code, run again with the same history, issues **the same commands in the same order**. Anything that could differ between the original run and a replay months later breaks that: the wall clock, random numbers, network responses, a config file, or *your next deploy*.

**Determinism rules (TypeScript SDK):**
- Workflow code runs in a **V8 isolate sandbox**. \`Date.now()\` returns the workflow-task time, \`Math.random()\` is seeded from the history, and \`setTimeout\` becomes a durable timer. Use \`sleep()\`, \`condition()\` and \`uuid4()\` from \`@temporalio/workflow\`.
- **No I/O in workflows:** no \`fetch\`, DB clients or \`fs\`. The bundler rejects many Node modules outright. Put all I/O in activities.
- Do not branch on things outside the history: env vars, feature flags read at runtime, the current deploy's config. Pass them in as workflow input or read them via an activity, which makes them recorded.
- Iteration order, \`Promise.race\` over activities and timers, and \`await\` ordering are all part of the command sequence. *Each \`await\` is a yield point that affects the Command sequence seen during replay.*

**Changing code while executions are in flight (the hard part):**
| Approach | How | Use when |
|---|---|---|
| **Patching** | \`if (patched('add-fraud-check')) { await fraudCheck(); }\` writes a marker. Old histories, which have no marker, take the old path. Later, \`deprecatePatch()\`, then remove the branch once no old executions remain | Small changes to long-running workflows |
| **Worker Versioning** (Worker Deployments) | Tag workers with a deployment version. Workflows are **pinned** to the version they started on, or **auto-upgrade** to the current one. Old workers keep serving old executions until they drain | Frequent deploys, big changes, avoiding patch clutter. (The pre-2025 experimental versioning API is being removed from the server in March 2026.) |
| **New workflow type** | \`OrderWorkflowV2\`, start new executions on it | Rewrites; short-lived workflows |
| **Replay tests in CI** | Download real histories and run \`Worker.runReplayHistories\` against the new code | Always. This catches non-determinism before deploy |

A mismatch surfaces as a **non-determinism error**. The *workflow task* fails and is retried, and the execution is stuck (not failed) until you fix or roll back the code.

**History limits (hard, non-configurable):**
- **51,200 events or 50 MB** per execution. Exceeding it terminates the execution. The SDK warns at **10,240 events or 10 MB**.
- **2 MB per payload** (each activity argument or result), **4 MB per gRPC message** and per history transaction. Pass references (S3 keys, row ids), not documents.
- **2,000 pending** activities, child workflows, outbound signals or cancel requests per execution. **10,000 signals** total per execution. Updates: 10 in flight, 2,000 total in history.
- **Continue-As-New** atomically completes the run and starts a fresh one with the same workflow id, carrying state forward as input. Use it for entity or subscription workflows and loops. \`workflowInfo().continueAsNewSuggested\` tells you when to do it.`,
      code: [
        {
          language: 'typescript',
          title: 'An order workflow: activity timeouts, a signal, a query, a patch and continue-as-new',
          code: `import {
  proxyActivities, defineSignal, defineQuery, setHandler, condition,
  patched, workflowInfo, continueAsNew, sleep,
} from '@temporalio/workflow';
import type * as acts from './activities';

const { reserveStock, chargeCard, fraudCheck, releaseStock } = proxyActivities<typeof acts>({
  startToCloseTimeout: '30 seconds',     // required: bounds ONE attempt
  scheduleToCloseTimeout: '10 minutes',  // bounds all retries together
  retry: { initialInterval: '1s', backoffCoefficient: 2, maximumInterval: '1m',
           nonRetryableErrorTypes: ['CardDeclined'] },
});

export const cancelSignal = defineSignal('cancel');
export const statusQuery = defineQuery<string>('status');

export async function orderWorkflow(orderId: string): Promise<string> {
  let status = 'NEW';
  let cancelled = false;
  setHandler(cancelSignal, () => { cancelled = true; });
  setHandler(statusQuery, () => status);           // read-only, never mutates

  await reserveStock(orderId);
  status = 'RESERVED';
  if (patched('fraud-check-v2')) {                 // new code path; old histories skip it
    await fraudCheck(orderId);
  }
  // Wait up to 15 minutes for payment, unless cancelled first
  const gotCancel = await condition(() => cancelled, '15 minutes');
  if (gotCancel) {
    await releaseStock(orderId);                   // compensation
    return (status = 'CANCELLED');
  }
  await chargeCard(orderId, \`charge-\${orderId}\`); // idempotency key = stable per order
  return (status = 'PAID');
}

// Entity-style workflow that loops forever: roll the history over regularly.
export async function subscriptionWorkflow(userId: string, cycle = 0): Promise<void> {
  for (;;) {
    await sleep('30 days');
    // ... renew via activity ...
    if (workflowInfo().continueAsNewSuggested) return continueAsNew<typeof subscriptionWorkflow>(userId, cycle + 1);
    cycle++;
  }
}`,
        },
      ],
      keyPoints: [
        'Replay must issue the same commands in order: no I/O, wall clock, randomness or external config in workflow code.',
        'Version with patched()/deprecatePatch() or Worker Versioning; run replay tests in CI.',
        'Hard limits: 51,200 events / 50 MB, 2 MB payloads, 2,000 pending ops, 10,000 signals → Continue-As-New, pass references.',
      ],
      source: 'Temporal docs — Workflow Execution limits; Temporal Cloud limits; TypeScript SDK: Versioning, Determinism; Continue-As-New',
    },
    {
      heading: 'Temporal signals, queries, updates, retries and timeouts, and when a workflow engine beats saga + outbox',
      body: `**Talking to a running workflow:**
| Primitive | Direction | Mutates state? | Caller gets | Recorded in history? |
|---|---|---|---|---|
| **Signal** | Into the workflow | Yes | Nothing (fire-and-forget ack) | Yes (counts toward 10,000 per execution) |
| **Query** | Read from the workflow | **No** (the handler must be read-only) | A value computed from current state | No |
| **Update** | Into the workflow, synchronous | Yes, with an optional **validator** that can reject before anything is recorded | A result or an error | Yes (if accepted) |

Use **Update** when the caller needs a validated answer ("add item and return the new total, reject if the cart is closed"). Use **Signal** for events ("payment webhook arrived"). Use **Query** for dashboards and status endpoints.

**Activity timeouts, the most common source of bugs:**
- **Start-To-Close:** maximum duration of one attempt. Always set it, and make it bigger than the slowest healthy call.
- **Schedule-To-Close:** total budget across all attempts and queueing.
- **Schedule-To-Start:** time spent waiting in the task queue. Use it to detect a missing or overloaded worker fleet. It is rarely needed when one queue is served by healthy workers.
- **Heartbeat timeout:** long activities call \`heartbeat(progress)\`. If heartbeats stop, the attempt is failed fast (rather than waiting for Start-To-Close), and the next attempt can resume from the last heartbeat details.
- **Default activity retry policy:** initial 1 s, coefficient 2.0, maximum interval 100 × initial (100 s), **unlimited attempts**. Mark business failures **non-retryable** (\`CardDeclined\`), or they retry forever. **Workflows have no retry policy by default**, which is usually right.

**Workflow engine vs hand-rolled saga + outbox:**
| Prefer Temporal (or a similar engine) when | Prefer saga + outbox / choreography when |
|---|---|
| Many steps, long waits (hours to months), human-in-the-loop, timers | 1–3 steps, sub-second end-to-end SLA |
| Complex branching, compensation and retries are the bulk of the code | Simple event fan-out where each service reacts independently |
| You need to answer "where is order 123 stuck?" instantly | Throughput is huge (tens of K/s) and per-step history writes would cost too much |
| Several teams keep re-implementing state machines, cron sweepers and retry tables | The team cannot operate (or pay for) another stateful platform |

**Costs to state honestly:** every step writes several history events, so a 5-step workflow is tens of persisted events, and Temporal Cloud bills per action. Each workflow-task round-trip adds tens of milliseconds, which is fine for business processes and wrong for the hot path of a 50 ms API. The determinism discipline is a real learning curve. Self-hosting means running Cassandra or Postgres, Elasticsearch and the history shards.`,
      code: [
        {
          language: 'typescript',
          title: 'An idempotent, heartbeating activity (TS SDK)',
          code: `import { Context, ApplicationFailure } from '@temporalio/activity';
import { psp } from './psp-client';
import { s3 } from './s3';

// Activities can run more than once (timeout after success, worker crash after the PSP call).
export async function chargeCard(orderId: string, idempotencyKey: string): Promise<string> {
  const res = await psp.charge({ orderId, idempotencyKey }); // PSP dedupes on the key
  if (res.status === 'DECLINED') {
    // Business failure: do NOT retry. Declared non-retryable via its error type.
    throw ApplicationFailure.create({ type: 'CardDeclined', message: res.reason, nonRetryable: true });
  }
  return res.chargeId;
}

// Long activity: heartbeat progress so a dead worker is detected in seconds,
// and the retry resumes from the last checkpoint instead of row 0.
export async function exportLedger(month: string): Promise<string> {
  const ctx = Context.current();
  let cursor: string | undefined = ctx.info.heartbeatDetails as string | undefined;
  do {
    const page = await s3.exportPage(month, cursor);  // writes are idempotent per page
    cursor = page.next;
    ctx.heartbeat(cursor);                            // needs heartbeatTimeout in options
    if (ctx.cancellationSignal.aborted) throw new Error('cancelled');
  } while (cursor);
  return \`s3://exports/\${month}\`;                   // return a reference, not the data
}`,
        },
      ],
      keyPoints: [
        'Signal = async event in; Query = read-only out; Update = synchronous, validated mutation with a result.',
        'Always set Start-To-Close; use heartbeats for long activities; mark business errors non-retryable (the default retry is unlimited).',
        'Pick an engine for long, branching, observable processes; keep sub-second, high-throughput flows on saga + outbox or plain calls.',
      ],
      source: 'Temporal docs — Message passing (Signals, Queries, Updates); Activity timeouts; Retry Policies',
    },
    {
      heading: 'ZooKeeper internals: ZAB, znodes, sessions and the real semantics of watches',
      body: `**Intuition:** ZooKeeper is a small, replicated, in-memory tree of tiny files (**znodes**) with three superpowers: nodes that vanish when their owner dies (**ephemeral**), nodes that get an increasing number in their name (**sequential**), and notifications when something changes (**watches**). Coordination recipes are built from these three. *ds-consensus* covers the election recipe and the etcd comparison. Here we look at the protocol and the edge cases that break real systems.

**ZAB (ZooKeeper Atomic Broadcast):**
- An ensemble of 3 or 5 voting servers elects a **leader**. **All writes** go through the leader, which assigns a **zxid**, a 64-bit number whose high 32 bits are the **epoch** (bumped on each new leader) and low 32 bits a counter. It proposes each write to the followers and commits once a **quorum** has logged it to disk. Writes are applied in zxid order everywhere: a total order.
- On leader change, the new leader runs **discovery and synchronisation**: it makes sure every committed proposal from the previous epoch is on the quorum before serving new writes, and truncates uncommitted ones on lagging followers.
- **Reads are served locally** by whichever server the client is connected to, so they can be **stale**. The guarantees are: sequential consistency per client, a single system image (a client never goes back in time, even when it reconnects to another server), and atomic updates. Call **\`sync()\`** before a read if you need the latest committed value. **Observers** are non-voting members that scale reads (or remote datacenters) without slowing quorum writes.
- Throughput: tens of thousands of small writes per second at best, bounded by leader fan-out and the fsync of the transaction log. Reads scale with servers.

**Znodes:** under **1 MB** each (\`jute.maxbuffer\` ≈ 1 MB), with kilobytes recommended. The whole tree lives in memory on every server. Types: persistent, **ephemeral** (deleted when the session ends; cannot have children), **sequential** (10-digit, zero-padded suffix from a signed 32-bit counter in the parent), **container** (deleted once the last child goes, since 3.5.3) and **TTL** (disabled by default).

**Sessions:** the client negotiates a timeout between **2× and 20× tickTime** (with the common tickTime of 2 s, that is 4–40 s). *Connection loss* is not *session expiry*. While disconnected, the session (and your ephemeral nodes) can still be alive. Only the ensemble decides that the session has expired, and the client finds out on reconnect. Between the two, a process **does not know** whether it still holds its lock.

**Watches, the semantics people get wrong:**
1. **Standard watches are one-shot.** They fire once and must be re-registered by your next read. Changes that happen *between* the fire and your re-read are not delivered individually: you see only the latest state. Watches give you **"something changed, go look"**, not a change log.
2. Watch events are **not delivered while disconnected**. A node created and deleted during a disconnect may never be noticed.
3. A client sees the watch event **before** it sees the new data, and events are ordered with respect to other updates.
4. Since **3.6.0**, \`addWatch(path, PERSISTENT | PERSISTENT_RECURSIVE)\` registers watches that stay until removed. They fire for created, deleted and data-changed events (not child events), so a whole subtree can be followed without re-registering.`,
      diagram: `  ZAB write path (5 voters, quorum = 3)

  client --setData(/cfg)--> follower F2 --forward--> LEADER (epoch 7)
                                                      zxid = 0x00000007_0000A1F3
                     PROPOSAL zxid  /----------------/  |  \\----------------\\
                               F1  F2                   |                F3  F4
                               log+fsync -- ACK --------+-- ACK -- log+fsync
                     quorum (leader + 2 ACKs) => COMMIT to all, apply in order
  client <--- OK --- F2 (after it applies zxid ...A1F3)

  Read on F4 (lagging) may still return the old /cfg  -> sync() then read`,
      code: [
        {
          language: 'typescript',
          title: 'One-shot watch handled correctly: re-register by reading, then act on the latest state',
          code: `import zookeeper from 'node-zookeeper-client';

const zk = zookeeper.createClient('zk-0:2181,zk-1:2181,zk-2:2181', { sessionTimeout: 15000 });

function watchConfig(path: string, onChange: (cfg: unknown) => void) {
  // getData with a watcher both READS the latest value and RE-ARMS the one-shot
  // watch in a single call, so no change can slip between "fired" and "re-armed".
  const read = () =>
    zk.getData(
      path,
      () => read(),                          // watch fired: just read again
      (err, data, stat) => {
        if (err) { setTimeout(read, 1000); return; } // e.g. connection loss: retry
        // Updates that happened between the event and this read are collapsed:
        // we only ever see the LATEST version (stat.version tells us which one).
        onChange({ version: stat.version, cfg: JSON.parse(data.toString()) });
      },
    );
  read();
}

zk.on('state', (s) => {
  // SYNC_CONNECTED again after a disconnect: watches set before may have missed events,
  // so re-read everything you depend on. EXPIRED: ephemerals are gone; rebuild the session.
  if (s === zookeeper.State.EXPIRED) process.exit(1); // let the orchestrator restart us
});
zk.once('connected', () => watchConfig('/services/payments/config', console.log));
zk.connect();`,
        },
      ],
      keyPoints: [
        'ZAB: leader-ordered writes committed by quorum, zxid = (epoch, counter); reads are local and may be stale, so sync() first when it matters.',
        'Connection loss is not session expiry; ephemerals live until the ensemble expires the session.',
        'Standard watches are one-shot "go look" signals that collapse intermediate changes; persistent recursive watches exist since 3.6.',
      ],
      source: 'Apache ZooKeeper 3.9 — Programmer\'s Guide; Junqueira et al. — Zab (DSN 2011)',
    },
    {
      heading: 'ZooKeeper recipes done right, why the world moved to KRaft and etcd, and when ZooKeeper is the wrong tool',
      body: `**Recipes and their sharp edges** (use **Apache Curator** on the JVM, which encodes these fixes):
- **Lock / leader election:** create \`/lock/guid-lock-\` as **EPHEMERAL_SEQUENTIAL**. The lowest sequence holds it, and each other contender watches **only its predecessor** (no herd). The edge case: the create succeeds on the server, but the client gets **CONNECTIONLOSS** before the reply. A naive retry creates a *second* node, and the first one (possibly the lowest!) is never deleted while the session lives, so nobody gets the lock. **Fix:** Curator's *protection mode* puts a client GUID in the name and, after connection loss, lists the children to find its own node before retrying.
- **Read-write lock:** \`read-\` and \`write-\` sequential children. A reader waits for lower write nodes only, and a writer waits for any lower node.
- **Config:** one small znode with the version or the hash of the config, *not* the config itself. Clients watch it and fetch the payload from S3 or a config service. 30K clients each pulling a 200 KB znode on every change saturates the ensemble's NICs.
- **Service discovery:** ephemeral node per instance under \`/services/x\`. It works for hundreds of instances. With tens of thousands of churning pods, every deploy triggers child-watch storms, and Kubernetes endpoints or a mesh do it better.
- **Fencing:** the lock does not stop a paused former holder. Pass the znode's \`czxid\` or sequence as a fencing token to the storage layer (see *ds-consensus*).

**Why many systems moved off ZooKeeper:**
| System | Moved to | Why |
|---|---|---|
| Kafka | **KRaft** (KIP-500). **Kafka 4.0 (March 2025) removed ZooKeeper mode entirely**; migrate on 3.x first | Metadata becomes a Raft log inside Kafka: one system to operate, controller failover in seconds instead of reloading all metadata from ZK, millions of partitions |
| Kubernetes | **etcd** (from the start) | Raft, MVCC revisions, watches that resume from a revision (no missed events), leases, gRPC |
| ClickHouse | **ClickHouse Keeper** (a ZK-compatible API on Raft) | Lower memory, linearisable reads option, no JVM |
| Still on ZooKeeper (2026) | HBase, Hadoop HA, Solr, older Pulsar deployments | Deep integration; they work fine |

**When ZooKeeper (or etcd) is the wrong tool:**
- **High write rates:** counters, rate limits, per-request state. Every write is a quorum fsync, so use Redis or a database.
- **Large data or many keys:** the tree is fully in memory on every node, with a 1 MB limit per znode.
- **A message queue or log:** sequential nodes are not Kafka.
- **Cross-region coordination on the hot path:** quorum writes pay the WAN RTT. Prefer a per-region coordinator plus async reconciliation.
- **A new system in 2026:** unless you are in an ecosystem that already runs it, choose **etcd** (or the coordination built into your platform: Kubernetes leases, a database advisory lock with fencing) rather than adding a JVM ensemble.`,
      code: [
        {
          language: 'java',
          title: 'Curator: lock with protection mode and a fencing token',
          code: `import org.apache.curator.framework.CuratorFramework;
import org.apache.curator.framework.CuratorFrameworkFactory;
import org.apache.curator.framework.recipes.locks.InterProcessMutex;
import org.apache.curator.retry.ExponentialBackoffRetry;
import java.util.concurrent.TimeUnit;

public class PayoutScheduler {
  public static void main(String[] args) throws Exception {
    CuratorFramework zk = CuratorFrameworkFactory.newClient(
        "zk-0:2181,zk-1:2181,zk-2:2181", 15_000, 5_000,
        new ExponentialBackoffRetry(1_000, 5));
    zk.start();

    // InterProcessMutex uses protected EPHEMERAL_SEQUENTIAL nodes internally:
    // a GUID prefix lets it find its own node after CONNECTIONLOSS on create.
    InterProcessMutex lock = new InterProcessMutex(zk, "/locks/payout-run");
    if (!lock.acquire(10, TimeUnit.SECONDS)) return;   // never wait forever
    try {
      // Fencing token: czxid of our lock node is unique and increasing per acquisition
      String node = lock.getParticipantNodes().iterator().next(); // sorted: first = holder (us)
      long token = zk.checkExists().forPath(node).getCzxid();
      runPayouts(token);   // storage rejects writes with a token lower than the last seen
    } finally {
      lock.release();
    }
  }

  static void runPayouts(long fencingToken) { /* pass the token to every protected write */ }
}`,
        },
      ],
      keyPoints: [
        'CONNECTIONLOSS on a sequential create can orphan a node; protection mode (GUID prefix) fixes it.',
        'Keep znodes tiny (pointers, versions); large or high-fanout config and discovery melt the ensemble.',
        'Kafka 4.0 is KRaft-only; Kubernetes uses etcd; for new systems prefer etcd or platform-native coordination.',
      ],
      source: 'Apache ZooKeeper — Recipes and Solutions; Apache Curator — Recipes; Apache Kafka 4.0 release notes and KIP-500; Hello Interview — ZooKeeper deep dive',
    },
  ],
  codeChallenges: [
    {
      id: 'platform-key-tech-cc-1',
      title: 'A DynamoDB wallet repository with a scan, a lost-update race and dropped batch writes',
      context:
        'A NestJS wallet service on DynamoDB (table `app`, PK/SK, on-demand) handles ~3K debits/s at peak during a cashback sale. Incidents: the "my transactions" endpoint costs a fortune and gets slower every week, a few users ended up with negative balances, a nightly import silently lost ~0.5% of rows, and debits retried by the API gateway were applied twice.',
      task:
        'Rewrite the repository so that reads use the key design, debits are atomic, never overdraw and are idempotent per request id, and imports never silently drop items. Keep it within DynamoDB (no external locks).',
      starter: {
        language: 'typescript',
        title: 'wallet.repository.ts (naive)',
        code: `import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

export class WalletRepository {
  constructor(private readonly ddb: DynamoDBDocumentClient) {}

  async listTransactions(userId: string) {
    const res = await this.ddb.send(new ScanCommand({
      TableName: 'app',
      FilterExpression: 'userId = :u AND begins_with(SK, :t)',
      ExpressionAttributeValues: { ':u': userId, ':t': 'TXN#' },
    }));
    return res.Items ?? [];                       // first 1 MB page only
  }

  async debit(userId: string, amount: number, requestId: string) {
    const { Item } = await this.ddb.send(new GetCommand({
      TableName: 'app', Key: { PK: \`USER#\${userId}\`, SK: 'WALLET' },
    }));
    if (!Item || Item.balance < amount) throw new Error('INSUFFICIENT_FUNDS');
    await this.ddb.send(new PutCommand({           // read-modify-write race
      TableName: 'app',
      Item: { ...Item, balance: Item.balance - amount },
    }));
    await this.ddb.send(new PutCommand({           // separate write: not atomic
      TableName: 'app',
      Item: { PK: \`USER#\${userId}\`, SK: \`TXN#\${Date.now()}\`, userId, amount, requestId },
    }));
  }

  async importTransactions(items: Record<string, unknown>[]) {
    for (let i = 0; i < items.length; i += 25) {
      await this.ddb.send(new BatchWriteCommand({
        RequestItems: { app: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) },
      }));                                         // UnprocessedItems ignored
    }
  }
}`,
      },
      hints: [
        'Which items does the Scan read and pay for before the filter runs, and how many pages can it return?',
        'Can you express "balance >= amount" and "this request id was never applied" as conditions that DynamoDB evaluates atomically together with the write?',
        'BatchWriteItem can succeed as a call while some puts are not applied. Where does the response tell you that?',
      ],
      solution: {
        language: 'typescript',
        title: 'wallet.repository.ts (key-based, atomic, idempotent, complete)',
        code: `import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { setTimeout as sleep } from 'node:timers/promises';
import { monotonicFactory } from 'ulid';

const ulid = monotonicFactory();

export class WalletRepository {
  constructor(private readonly ddb: DynamoDBDocumentClient) {}

  // Query the user's item collection: reads only TXN items of this user, newest first.
  async listTransactions(userId: string, limit = 50, cursor?: Record<string, unknown>) {
    const res = await this.ddb.send(new QueryCommand({
      TableName: 'app',
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :t)',
      ExpressionAttributeValues: { ':pk': \`USER#\${userId}\`, ':t': 'TXN#' },
      ScanIndexForward: false, Limit: limit, ExclusiveStartKey: cursor,
    }));
    return { items: res.Items ?? [], next: res.LastEvaluatedKey };  // cursor pagination
  }

  // One transaction: idempotency record + conditional balance update + ledger entry.
  async debit(userId: string, amount: number, requestId: string): Promise<'APPLIED' | 'DUPLICATE'> {
    const pk = \`USER#\${userId}\`;
    try {
      await this.ddb.send(new TransactWriteCommand({
        ClientRequestToken: requestId.slice(0, 36), // SDK-level retries are deduped for 10 min
        TransactItems: [
          { Put: {                                  // permanent dedupe beyond 10 minutes
            TableName: 'app',
            Item: { PK: pk, SK: \`REQ#\${requestId}\`, ttl: Math.floor(Date.now() / 1000) + 7 * 86400 },
            ConditionExpression: 'attribute_not_exists(SK)',
          } },
          { Update: {
            TableName: 'app',
            Key: { PK: pk, SK: 'WALLET' },
            UpdateExpression: 'SET balance = balance - :a, version = version + :one',
            ConditionExpression: 'balance >= :a',  // evaluated atomically: no overdraft
            ExpressionAttributeValues: { ':a': amount, ':one': 1 },
          } },
          { Put: {
            TableName: 'app',
            Item: { PK: pk, SK: \`TXN#\${ulid()}\`, amount: -amount, requestId }, // ULID: sortable, unique
          } },
        ],
      }));
      return 'APPLIED';
    } catch (err) {
      if (err instanceof TransactionCanceledException) {
        const [dup, bal] = err.CancellationReasons ?? [];
        if (dup?.Code === 'ConditionalCheckFailed') return 'DUPLICATE';
        if (bal?.Code === 'ConditionalCheckFailed') throw new Error('INSUFFICIENT_FUNDS');
      }
      throw err; // TransactionConflict or throttling: the caller retries with the same requestId
    }
  }

  // Retry UnprocessedItems with exponential backoff + jitter until all are written.
  async importTransactions(items: Record<string, unknown>[]) {
    for (let i = 0; i < items.length; i += 25) {
      let pending: Record<string, any> | undefined = {
        app: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })),
      };
      for (let attempt = 0; pending && Object.keys(pending).length; attempt++) {
        if (attempt > 8) throw new Error(\`import stalled at batch \${i / 25}\`);
        if (attempt > 0) await sleep(Math.random() * Math.min(5000, 50 * 2 ** attempt));
        const res = await this.ddb.send(new BatchWriteCommand({ RequestItems: pending }));
        pending = res.UnprocessedItems;           // throttled or partially failed puts
      }
    }
  }
}`,
      },
      explanation: `**Fixes:**
- **Scan → Query.** The Scan read the *entire table* (paying RCUs for every item) and filtered afterwards, returned only the first 1 MB page, and got slower as the table grew. A Query on \`PK = USER#id\` with \`begins_with(SK, 'TXN#')\` reads only that user's ledger, newest first, with cursor pagination.
- **Lost update / overdraft.** Get-then-Put lets two concurrent debits both read balance 100 and both write 100 − x. The \`UpdateExpression\` computes the balance server-side, and \`ConditionExpression: balance >= :a\` is evaluated atomically, so overdraft is impossible.
- **Atomicity.** The balance update and the ledger entry were separate writes, so a crash between them left a balance with no ledger row. \`TransactWriteItems\` makes the three writes all-or-nothing (costing 2× WCU per item).
- **Idempotency.** \`ClientRequestToken\` dedupes retries for only **10 minutes**. The \`REQ#<id>\` item with \`attribute_not_exists\` dedupes for as long as its TTL (7 days here), and the cancellation reason tells duplicates apart from insufficient funds.
- **Sortable unique SK.** \`Date.now()\` collides for two debits in the same millisecond, and the second Put overwrote the first ledger row. A monotonic ULID is unique and time-ordered.
- **Dropped batch writes.** \`BatchWriteItem\` returns \`UnprocessedItems\` under throttling; ignoring them lost ~0.5% of rows. Retry until empty, with backoff and jitter, and fail loudly if it stalls.`,
      followUps: [
        {
          q: 'During the sale, one celebrity-endorsed merchant wallet receives 4,000 credits/s. What happens with this design, and how do you fix it?',
          a: 'Every credit updates the same `WALLET` item, and a single item caps at 1,000 WCU, plus 2× for transactions, so roughly 500 transactional writes/s. Credits throttle and transactions conflict. Shard the merchant balance into N sub-wallets (`WALLET#0..15`), credit a random shard, and compute the balance as the sum of the shards. Or append credits as ledger items and aggregate asynchronously (Streams → a periodic roll-up), keeping the debit path on a single item only for consumers.',
        },
        {
          q: 'How would you test that debits never overdraw under concurrency?',
          a: 'Run an integration test against DynamoDB Local or a real test table: seed balance 1,000, fire 200 concurrent debits of 10 with distinct request ids plus 50 duplicates of existing ids, then assert the final balance = 1,000 − 10 × (number of APPLIED results), balance ≥ 0, ledger count = APPLIED count, and that duplicates returned DUPLICATE. Repeat with randomized delays, and add a property test for the reconciliation invariant balance = initial + sum(ledger).',
        },
      ],
    },
    {
      id: 'platform-key-tech-cc-2',
      title: 'A Temporal trial-conversion workflow that is non-deterministic, unbounded and double-charges',
      context:
        'A SaaS team built a 30-day free-trial workflow on Temporal (TypeScript SDK). Problems after launch: the worker bundle fails to build in CI ("cannot import axios"), toggling the NEW_PRICING env var caused non-determinism errors on in-flight trials, a PSP slowdown led to two charges for some users, and one test tenant\'s workflow hit the history warning after many reminder loops.',
      task:
        'Rewrite the workflow and its activity options so that replay is deterministic, every side effect is in an activity with bounded timeouts and sensible retries, charging is idempotent, and history stays bounded for long-running loops. Keep the business behaviour: daily usage check, reminder on day 25, charge at day 30 unless cancelled.',
      starter: {
        language: 'typescript',
        title: 'trial.workflow.ts (naive)',
        code: `import axios from 'axios';
import { proxyActivities, sleep, defineSignal, setHandler } from '@temporalio/workflow';
import type * as acts from './activities';

const { checkUsage, sendEmail, chargeCard } = proxyActivities<typeof acts>({
  retry: { maximumAttempts: 0 },          // retry forever, and no timeouts set
});

export const cancel = defineSignal('cancel');

export async function trialWorkflow(userId: string) {
  let cancelled = false;
  setHandler(cancel, () => { cancelled = true; });

  // Fetch the plan price directly from the pricing service
  const { data: plan } = await axios.get(\`https://pricing.internal/plans/\${userId}\`);
  const price = process.env.NEW_PRICING === 'true' ? plan.newPrice : plan.price;

  // Poll usage every 10 minutes for 30 days
  for (let i = 0; i < 30 * 24 * 6; i++) {
    await sleep('10 minutes');
    if (cancelled) return 'CANCELLED';
    const usage = await checkUsage(userId);
    if (i === 25 * 24 * 6) await sendEmail(userId, \`Trial ends soon, usage: \${usage}\`);
  }
  await chargeCard(userId, price);         // retries can charge twice
  return 'CONVERTED';
}`,
      },
      hints: [
        'List everything in the workflow body whose result could differ between the original run and a replay months later.',
        'What does one loop iteration add to the event history, and how many iterations does the starter run? Compare with the 51,200-event limit.',
        'An activity attempt can succeed at the PSP and still time out from Temporal\'s point of view. What makes the second attempt harmless?',
      ],
      solution: {
        language: 'typescript',
        title: 'trial.workflow.ts (deterministic, bounded, idempotent)',
        code: `import {
  proxyActivities, defineSignal, setHandler, condition, workflowInfo, continueAsNew,
} from '@temporalio/workflow';
import type * as acts from './activities';

// Short calls: bounded per attempt and in total; business errors are not retried.
const { getPlan, checkUsage, sendEmail } = proxyActivities<typeof acts>({
  startToCloseTimeout: '10 seconds',
  scheduleToCloseTimeout: '30 minutes',
  retry: { initialInterval: '2s', backoffCoefficient: 2, maximumInterval: '2m' },
});
const { chargeCard } = proxyActivities<typeof acts>({
  startToCloseTimeout: '45 seconds',       // above the PSP p99.9, so attempts rarely overlap
  scheduleToCloseTimeout: '6 hours',
  retry: { maximumAttempts: 20, nonRetryableErrorTypes: ['CardDeclined', 'InvalidPlan'] },
});

export const cancel = defineSignal('cancel');

type TrialState = { userId: string; newPricing: boolean; day: number; reminded: boolean; price?: number };

export async function trialWorkflow(s: TrialState): Promise<string> {
  let cancelled = false;
  setHandler(cancel, () => { cancelled = true; });

  // I/O goes through an activity: its result is recorded and replayed, never re-fetched.
  s.price ??= (await getPlan(s.userId, s.newPricing)).price; // the flag is workflow INPUT

  while (s.day < 30) {
    // Durable 1-day timer that wakes early on cancel: one wake-up per day, not 144.
    if (await condition(() => cancelled, '1 day')) return 'CANCELLED';
    s.day++;
    const usage = await checkUsage(s.userId);
    if (s.day >= 25 && !s.reminded) {
      await sendEmail(s.userId, 'trial-ending', { usage }, \`remind-\${workflowInfo().workflowId}\`);
      s.reminded = true;
    }
    // Defensive: roll the history over if the server suggests it (e.g. after many signals).
    if (workflowInfo().continueAsNewSuggested) return continueAsNew<typeof trialWorkflow>(s);
  }
  // Stable idempotency key: the same on every attempt and on every replay.
  await chargeCard(s.userId, s.price, \`trial-charge-\${workflowInfo().workflowId}\`);
  return 'CONVERTED';
}`,
      },
      explanation: `**Fixes:**
- **I/O in workflow code.** \`axios\` cannot run in the workflow sandbox (the bundle fails), and even if it could, a replay would re-fetch a price that may have changed. \`getPlan\` is now an **activity**, so its result is recorded in history and replayed.
- **Runtime config in workflow code.** \`process.env.NEW_PRICING\` differed between the worker that started a trial and the worker that replayed it, which caused non-determinism errors. The flag is now **workflow input** (decided once at start, recorded in history).
- **No timeouts and infinite retries.** Activities need a \`startToCloseTimeout\` (or a schedule-to-close timeout), and \`maximumAttempts: 0\` retried forever with no non-retryable errors. Each activity now has per-attempt and total budgets, and business errors (\`CardDeclined\`) are non-retryable.
- **Double charge.** When the PSP took longer than the attempt timeout, Temporal retried while the first charge succeeded. The charge now carries a **stable idempotency key** derived from the workflow id (identical across attempts and replays), and the attempt timeout is above the PSP's tail latency.
- **History growth.** Polling every 10 minutes for 30 days is 4,320 iterations × ~11 events ≈ 47,500 events: past the 10,240 warning and close to the 51,200 hard limit, with signals on top. A daily \`condition\` timer that wakes on cancel cuts it to 30 iterations (~330 events). \`continueAsNewSuggested\` carries state forward as input if the history ever grows.
- **Deterministic scheduling.** The reminder uses a day counter and a \`reminded\` flag in state instead of an exact loop index, so the logic survives continue-as-new.`,
      followUps: [
        {
          q: '20,000 trials are in flight on the old code. How do you deploy this rewrite without breaking them?',
          a: 'The command sequence changed completely (new getPlan activity, different timers), so patching every difference is impractical. Register the rewrite as a new workflow type (`trialWorkflowV2`) or a new Worker Deployment version with pinned behaviour, and start new trials on it. Keep old workers running the old code until in-flight trials drain (at most 30 days). Run replay tests of downloaded old histories against both code versions in CI.',
        },
        {
          q: 'Product wants the usage email to include live analytics from a 5 MB report. What do you change?',
          a: 'Never pass the report through Temporal: payloads are capped at 2 MB, and every payload is persisted in history. Have an activity generate the report, store it in S3, and return only the object key. The `sendEmail` activity takes the key and fetches the report itself. History stays small, and replays never move the blob.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'platform-key-tech-iq-01',
      difficulty: 'hard',
      question:
        'Design the DynamoDB schema for a food-delivery order service. Access patterns: get an order with its line items and status history; list a customer\'s orders newest first; list a restaurant\'s active orders for its tablet; look up an order by payment reference from a PSP webhook; and a nightly finance report. Walk me through keys, indexes and what you would not put in DynamoDB.',
      whatInterviewerLooksFor: [
        'Starts from access patterns and their frequency, not from entities',
        'Uses item collections for order + items + history and a sparse GSI for active orders',
        'Handles uniqueness and lookup by payment reference without a Scan',
        'Pushes the finance report out of DynamoDB (export or Streams to a warehouse)',
        'Mentions hot keys (big restaurant chains), GSI eventual consistency and item size',
      ],
      modelAnswer: `### Access patterns → keys (single table \`orders\`)
| Pattern | Key | Notes |
|---|---|---|
| Order + items + status history | PK = \`ORDER#<ulid>\`; SK = \`HEADER\` / \`ITEM#<n>\` / \`STATUS#<ts>\` | One Query returns the whole aggregate (pre-joined) |
| Customer's orders, newest first | GSI1: PK = \`CUST#<id>\`, SK = \`<createdAt>#<orderId>\` on the HEADER item only | Paginate with LastEvaluatedKey; project summary fields (INCLUDE) |
| Restaurant's active orders | GSI2 (**sparse**): PK = \`REST#<id>#ACTIVE\`, SK = \`<promisedAt>\`; attributes set only while active | Removing the attributes on DELIVERED drops it from the index |
| Webhook lookup by payment ref | Separate item PK = \`PAYREF#<ref>\` → orderId, written in the same transaction as the order | Doubles as a uniqueness guard (\`attribute_not_exists\`) |
| Nightly finance report | **Not a DynamoDB query**: incremental export to S3 → Athena/Redshift, or Streams → warehouse | Avoids Scans that burn RCU and compete with live traffic |

### Writes
- Place order: \`TransactWriteItems\` with header + items + PAYREF guard (well under 100 items / 4 MB), and a \`ClientRequestToken\` from the API's idempotency key.
- Status changes: \`UpdateItem\` with \`ConditionExpression: status = :expectedPrev\` (a state machine guard), plus a STATUS item for history.

### Capacity and hot spots
- At ~5K orders/min peak, writes are trivial for DynamoDB. The risk is **GSI2 hot keys**: one cloud kitchen with 600 active orders is fine, but a chain's central dashboard keyed by brand would not be. Key by outlet, and shard (\`#0..3\`) only if one outlet exceeds ~1K writes/s.
- GSIs are **eventually consistent**: after placing an order, the customer's list might not show it for a fraction of a second. Have the client insert the just-created order locally, or read it by PK.
- Keep line-item notes small; items are capped at 400 KB. Photos go to S3.

### What stays out
Refund ledgers and settlement with restaurants (money, complex invariants, reporting) live in Postgres, fed from the same events through Streams or an outbox.`,
      followUps: [
        {
          q: 'Product adds "search orders by dish name for support agents". Do you add a GSI?',
          a: 'No. It is a free-text, low-volume, ad-hoc query. Stream order items into OpenSearch with Streams + Lambda (or Kinesis) and query there. A GSI on dish name would be high-write, low-selectivity and still unable to do partial matches.',
        },
        {
          q: 'Why put customer orders in a GSI instead of making the customer the table\'s partition key?',
          a: 'The most frequent and critical access is by order id (tracking, webhooks, the restaurant tablet), and keeping the order aggregate under `ORDER#id` keeps it in one collection, below the 10 GB cap and spread evenly. Keying the table by customer would make order lookups by id need their own index. Choose the base key for the hottest, strongly consistent path, and GSIs for the rest.',
        },
      ],
      pitfalls: [
        'Designing tables per entity and then asking for joins',
        'Scanning with filters for the restaurant dashboard or the report',
        'Forgetting that GSIs are eventually consistent when the user expects read-your-writes',
      ],
    },
    {
      id: 'platform-key-tech-iq-02',
      difficulty: 'hard',
      question:
        'During a cricket final, a live-score page increments one DynamoDB item per view, about 25,000 increments/s at peak. The table is on-demand and shows throttling even though the table-level metrics are far below quota. Explain exactly why, then design a fix that still lets the page show a near-real-time count.',
      whatInterviewerLooksFor: [
        'Knows the per-partition ceiling of 1,000 WCU per key even after adaptive capacity isolates the item',
        'Distinguishes table-level quota from key-level limits; mentions Contributor Insights',
        'Proposes write sharding and/or pre-aggregation with the arithmetic',
        'Addresses the read side (summing shards, caching) and accuracy trade-offs',
      ],
      modelAnswer: `### Why it throttles
- Every increment targets the same partition key. A single key can never exceed **1,000 WCU** (and 3,000 RCU) because it lives on one partition. **Adaptive capacity** can isolate the item on its own partition, but that is still the ceiling.
- 25,000 increments/s ÷ 1,000 = **25×** over. The table-level quota (40K WRU per table by default) is irrelevant. CloudWatch Contributor Insights would show one key at the top of the throttled-keys list.

### Fix 1: write sharding
- Spread increments over N items: \`VIEWS#final#<0..N-1>\` with \`ADD count :1\`. For headroom at ~70% of the ceiling: N = 25,000 ÷ 700 ≈ **36 → 40 shards**.
- Read = BatchGet of 40 keys (40 × 0.5 RCU eventual), summed. Serve that from a 1 s cache, so the page does not create a read hot spot either.

### Fix 2: pre-aggregate in the service (better at this scale)
- Each API pod keeps an in-memory counter and flushes every second: \`ADD count :n\`. With 60 pods that is 60 writes/s instead of 25,000, still sharded a little (e.g. 4 shards) to absorb pod-count growth.
- Cost: on a pod crash, up to 1 s of counts is lost, which is acceptable for a view counter and not for money. Make it explicit.

### Fix 3: do not count in DynamoDB at all
Redis \`INCR\` (100K+ ops/s on one node) or Kinesis → Flink windowed counts, with DynamoDB holding a periodically checkpointed total.

### The page
Read the summed count from a cache (CDN or Redis, 1–2 s TTL). Viewers cannot tell 1 s staleness apart, and it removes the 25K/s of reads.

### Cost note
25K individual increments/s on on-demand ≈ 25K WRU/s ≈ $56/hour at $0.625 per million. Pre-aggregation cuts that by ~400×.`,
      followUps: [
        {
          q: 'Will switching the table to provisioned mode with 100K WCU fix it?',
          a: 'No. Provisioned capacity is spread across partitions, and the per-partition maximum still applies to one key: 1,000 WCU for a single item. You would pay for 100K WCU and still throttle at ~1K/s on that key. The fix must change the key distribution or the write rate.',
        },
        {
          q: 'How do you pick the shard suffix if you also need per-region view counts?',
          a: 'Make the suffix meaningful: `VIEWS#final#<region>#<0..k>`. The per-region count is the sum over k shards, and the total is the sum over all. Choose k per region from that region\'s peak (e.g. India 30, others 2–4), since uniform N wastes reads. Keep the shard count in config that readers also use, and only increase it (adding shards is safe; removing them needs a merge).',
        },
      ],
      pitfalls: [
        'Assuming on-demand means unlimited per-key throughput',
        'Raising table capacity instead of fixing key distribution',
        'Forgetting the read side of a sharded counter',
      ],
    },
    {
      id: 'platform-key-tech-iq-03',
      difficulty: 'expert',
      question:
        'We have a 2 TB DynamoDB table of support tickets keyed by PK = TENANT#id, SK = TICKET#ulid. Agents now need "a tenant\'s tickets sorted by last-updated time" and they complain that tickets they just updated sometimes do not move to the top. A teammate proposes adding an LSI. Evaluate that and give me your design.',
      whatInterviewerLooksFor: [
        'Knows LSIs can only be created at table creation and cap item collections at 10 GB',
        'Recognises the GSI staleness (eventual consistency) and the hot-key risk of tenant keys',
        'Offers concrete options: new table + migration, GSI + client-side merge, write sharding',
        'Weighs consistency needs against operational cost',
      ],
      modelAnswer: `### Why the LSI idea fails
1. **LSIs can only be defined at table creation.** On an existing 2 TB table, "adding an LSI" means creating a new table and migrating all the data.
2. **10 GB item-collection cap.** With an LSI, all items for one PK value (\`TENANT#id\`) plus their LSI entries must stay under 10 GB, and DynamoDB cannot split that collection across partitions. A large enterprise tenant with millions of tickets and attachments metadata could hit the cap and **writes for that tenant start failing**.
3. **Tenant-keyed collections are already hot.** The biggest tenant's writes all land on one key range.

### Why tickets "do not move to the top"
They are presumably using a GSI already (PK = tenant, SK = updatedAt). GSIs are **eventually consistent**: propagation is usually sub-second, but the agent re-fetching immediately after an update can see the old order.

### My design
- **GSI** \`byUpdated\`: PK = \`TENANT#id#<shard 0..k>\`, SK = \`<updatedAt>#<ticketId>\`. Shard large tenants (k from tenant size, k = 1 for small tenants) so no single GSI key exceeds ~1K writes/s. The read side merges the top N from k shards (a k-way merge on the sort key).
- **Read-your-writes in the UI:** after an update, the client already knows the new \`updatedAt\` and moves the ticket locally (an optimistic update). For a correct "my latest change" view, do a strongly consistent \`GetItem\` on the base table and merge it into the GSI page.
- If the business truly needs **strongly consistent sorted lists per tenant** and tenants are bounded (< 10 GB each, with a hard product limit), a new table with an LSI is defensible: create it, dual-write, backfill through export/import or a parallel Scan with rate limits, verify, then cut over.

### Trade-off summary
GSI: flexible, add online, eventual, own capacity (and an under-provisioned GSI throttles base writes). LSI: strong, but creation-time only and capped per tenant. For multi-tenant SaaS with unbounded tenants, I would almost always pick the GSI plus a client-side merge.`,
      followUps: [
        {
          q: 'The GSI backfill on the 2 TB table is throttling production writes. Why, and what do you do?',
          a: 'Creating a GSI backfills it from the base table, and GSI write capacity is consumed during the backfill. If the GSI cannot absorb both the backfill and live writes, back-pressure throttles base-table writes. On provisioned mode, give the new GSI generous WCU during the build (and use warm throughput where available). On on-demand, consider building it off-peak. Watch `OnlineIndexPercentageProgress` and the GSI throttle metrics.',
        },
        {
          q: 'How would you migrate 2 TB to a new table without downtime?',
          a: 'Enable Streams (or Kinesis) on the old table and start dual-writing from the app, or replay the stream into the new table with idempotent, version-conditioned puts. Bulk copy existing data with export to S3 + import to the new table (import creates a new table), then replay stream changes since the export time. Verify with sampled checksums per tenant, switch reads behind a flag, then stop the old writes.',
        },
      ],
      pitfalls: [
        'Believing an LSI can be added to an existing table',
        'Ignoring the 10 GB item-collection limit for large tenants',
        'Promising strong consistency from a GSI',
      ],
    },
    {
      id: 'platform-key-tech-iq-04',
      difficulty: 'medium',
      question:
        'Rapid-fire: you proposed DynamoDB and the interviewer says, "Our analytics and ops teams add new ways to slice this data every sprint, and finance wants monthly reconciliations." Do you keep DynamoDB? What would make you switch, and what would you say?',
      whatInterviewerLooksFor: [
        'Recognises changing access patterns and ad-hoc analytics as anti-patterns for DynamoDB',
        'Offers a split: DynamoDB for known hot paths, relational or warehouse for the rest',
        'Mentions exports/Streams/CDC rather than Scans',
        'Shows the habit of asking whether managed AWS technology is acceptable at all',
      ],
      modelAnswer: `**Short answer:** I would reconsider. DynamoDB rewards *known, stable* access patterns. Every new slice means a new GSI (more write cost, a backfill) or a Scan (expensive and slow). Monthly reconciliations need joins and aggregates it does not do.

**What decides it:**
- If the **online** path is still a few key-value patterns at high scale (get order, list by user) and the new slicing is **analytical**, keep DynamoDB for the online path and send changes via **Streams or incremental export to S3** into a warehouse (Athena, Redshift, BigQuery) where analysts can ask anything.
- If the *online product* itself keeps adding query shapes (filters, sorts, joins in the UI), switch the system of record to **Postgres** (or Aurora). At moderate scale (say < 20K writes/s, tens of TB with partitioning) it handles this with indexes and SQL, and I can still add a DynamoDB or Redis cache for one proven hot path later.
- **Finance reconciliation** should be in a relational store or the warehouse, never in a Scan over the live table.

**What I would say:** "Given that the access patterns are not stable, I would rather start with Postgres and keep DynamoDB as an option for specific hot paths. If you prefer to stay with DynamoDB, I would keep it to the user-facing patterns and export everything else to a warehouse." Earlier in the interview I would also have asked whether AWS-managed services are acceptable, since some interviewers want vendor-neutral answers.`,
      followUps: [
        {
          q: 'The interviewer insists on DynamoDB for everything. How do you support a new filter without a GSI explosion?',
          a: 'Use overloaded GSIs (one GSI serving several entity-specific patterns through prefixed keys), sparse indexes for "status = X" lists, and composite sort keys (`<status>#<date>`) so that one index answers several filters with begins_with or range conditions. Accept that genuinely ad-hoc combinations go to a secondary store (OpenSearch) fed by Streams.',
        },
        {
          q: 'What are the capacity cost implications of each extra GSI?',
          a: 'Every write that touches a GSI\'s attributes is also written to that GSI, consuming its WCU (2 writes when an indexed key changes), plus storage of projected attributes and ~100 bytes of overhead per index item. Five ALL-projection GSIs can make each logical write cost 6× the base write.',
        },
      ],
      pitfalls: [
        'Defending DynamoDB for ad-hoc analytics',
        'Proposing Scan with FilterExpression for reports',
        'Not offering a concrete alternative split',
      ],
    },
    {
      id: 'platform-key-tech-iq-05',
      difficulty: 'hard',
      question:
        'A 7-day merchant-onboarding flow runs on Temporal: KYC check, document review by a human, bank-account verification via penny drop, then account activation. Explain precisely what happens if the worker running it is killed during the penny-drop activity, and again if it is killed while the workflow is waiting 3 days for the human review.',
      whatInterviewerLooksFor: [
        'Explains that timers and waiting are owned by the service, so nothing runs while waiting',
        'Describes activity retry via Start-To-Close or heartbeat timeout and why the activity must be idempotent',
        'Explains replay from event history on a new worker',
        'Mentions signals or updates for the human decision and determinism constraints',
      ],
      modelAnswer: `### Killed during the penny-drop activity
1. History already contains: \`WorkflowExecutionStarted\`, KYC \`ActivityTaskScheduled/Started/Completed\`, review-related events, then \`ActivityTaskScheduled(pennyDrop)\` and \`ActivityTaskStarted\`.
2. The worker dies mid-call. The service does not know whether the bank call happened. After the **heartbeat timeout** (if the activity heartbeats) or the **Start-To-Close timeout**, it marks the attempt as timed out and, following the retry policy, schedules **attempt 2** on any worker polling the task queue.
3. The penny drop may have **already succeeded**, so the activity must be idempotent: pass a key like \`pennydrop-<workflowId>\` to the bank API, or first query "did a transfer with this reference happen?".
4. When the attempt completes, the service records \`ActivityTaskCompleted\` and schedules a **workflow task**. Whichever worker takes it loads the history, **replays** the workflow code from the start (KYC results come from history, nothing is re-executed) and continues to activation.

### Killed while waiting 3 days for review
- Nothing is running. The workflow is blocked on \`condition(() => decision !== undefined, '3 days')\` (a signal or update handler sets \`decision\`). The **timer lives in the service**, and the worker holds at most a cached copy of the state (sticky execution).
- When the reviewer submits, the API sends a **signal** (or an **Update**, if the UI needs validation, e.g. "reviewer not authorised"). That creates a workflow task. A new worker replays the history to rebuild state and runs the handler and the continuation. If no one decides in 3 days, \`TimerFired\` triggers the escalation branch.
- A worker killed mid-workflow-task simply causes that task to time out (10 s by default) and be retried elsewhere. Workflow tasks are deterministic and side-effect free, so re-running them is safe.

### What must be true for this to work
Workflow code is deterministic (no I/O, no \`process.env\` branching). Activities are idempotent with sensible timeouts. Payloads stay small (document ids, not PDFs). The history stays far below 51,200 events, which it easily does for a 7-day flow with tens of steps.`,
      followUps: [
        {
          q: 'The penny-drop API takes up to 2 minutes under load, and your Start-To-Close is 30 s. What happens?',
          a: 'Every slow attempt is declared timed out at 30 s and retried, while the first one is still running at the bank, so you get duplicate transfers unless the API is idempotent, plus wasted load. Set Start-To-Close above the API\'s p99.9 (say 3 min), add heartbeats only if the call can report progress, and enforce idempotency on the bank side with a stable reference.',
        },
        {
          q: 'How does a support engineer find out where merchant M-881 is stuck?',
          a: 'Describe or query the workflow by its id (`onboarding-M-881`): the UI or CLI shows the pending activity (attempt count, last failure) or the pending timer. A Query handler can return a business-level status ("waiting for review since Tuesday"). Search attributes (e.g. `Stage = REVIEW`) let you list all stuck merchants in visibility queries.',
        },
      ],
      pitfalls: [
        'Thinking the worker process sleeps for 3 days holding state',
        'Assuming activities run exactly once',
        'Putting the bank API call directly in workflow code',
      ],
    },
    {
      id: 'platform-key-tech-iq-06',
      difficulty: 'expert',
      question:
        'We need to add a mandatory fraud-screening step between "reserve inventory" and "charge" in our Temporal order workflow. About 40,000 executions are in flight, and some are subscription orders that run for months. How do you ship this change safely, and how do you know you did it right?',
      whatInterviewerLooksFor: [
        'Explains why inserting a step breaks replay of in-flight histories (non-determinism)',
        'Uses patched()/deprecatePatch() or Worker Versioning appropriately, with a plan for retirement',
        'Runs replay tests on production histories in CI',
        'Considers in-flight semantics: should old executions get the new step?',
      ],
      modelAnswer: `### Why a naive deploy breaks
In-flight histories record "after reserve came \`ActivityTaskScheduled(charge)\`". New code, replaying that history, issues a *ScheduleActivity(fraudCheck)* command at that point. The SDK sees a command that does not match the recorded event and raises a **non-determinism error**: the workflow task fails and retries, and the execution is stuck until code is fixed or rolled back.

### Option A: patching (good for one targeted change)
\`if (patched('fraud-check')) await fraudCheck(orderId);\`
- New executions (and old ones that have not reached this point yet, since \`patched\` returns true when the code first runs there) take the new path, and a marker is written into history.
- Executions that already passed the point replay without the marker, so they take the old path, which is consistent with their history.
- **Retire it:** once all pre-patch executions are closed (check with visibility queries), deploy \`deprecatePatch('fraud-check')\`. Then, after all executions that saw the marker are closed, remove the call. With months-long subscriptions this can take a while. Track it as tech debt.

### Option B: Worker Versioning (better for frequent deploys)
Deploy the new code as a new **Worker Deployment version**. Short orders can be **pinned** to the version they started on (old workers keep serving them until drained). Long-lived subscription workflows should **continue-as-new** onto the new version at their next cycle boundary, or use auto-upgrade combined with patches. This avoids an accumulation of \`patched\` branches.

### Business question to settle first
Should orders already past "reserve" be screened? Patching gives "only if not yet past this point". If compliance requires screening for *all* unpaid orders, add the check in the charge path behind the patch, or **signal** in-flight executions to run it.

### How I would know it is right
- **Replay tests in CI:** download a few hundred recent histories (all versions in flight) and run \`Worker.runReplayHistories\` against the new code. Any non-determinism fails the build.
- Canary: route a small task queue or deployment version first. Alert on workflow-task failures with \`NonDeterministicError\`.
- Monitor executions stuck in workflow-task retries after the deploy, and have a rollback that keeps the old code path available.`,
      followUps: [
        {
          q: 'Could you just change the activity\'s implementation (the code inside fraudCheck or charge) without versioning?',
          a: 'Yes. Activity code is not replayed, only its recorded result is, so changing an activity\'s internals is safe for determinism. You must still keep its input and output types compatible for in-flight executions whose recorded results get deserialised by new workflow code. What needs versioning is a change to the sequence of commands the workflow issues.',
        },
        {
          q: 'A developer "fixed" the error by wrapping the new step in `if (Date.now() > deployTime)`. Why is that wrong?',
          a: 'In the workflow sandbox, Date.now() returns the workflow-task time recorded in history, so on replay it can differ from the original decision point relative to deployTime, depending on when each task ran. It does not encode which code path the history actually took. Execution paths could still diverge from recorded commands. Patches record a marker in history, which is exactly the missing information.',
        },
      ],
      pitfalls: [
        'Deploying and hoping in-flight executions are fine',
        'Never removing patches, leaving branch soup',
        'Skipping replay tests against real histories',
      ],
    },
    {
      id: 'platform-key-tech-iq-07',
      difficulty: 'expert',
      question:
        'A payments team wants to run the synchronous checkout path (authorise card, reserve stock, create order) as a Temporal workflow called from the API. It is 2,000 checkouts/s at peak, with a p99 budget of 250 ms end-to-end. Would you approve it? Give me numbers.',
      context: 'They already have an outbox + Kafka pipeline for post-checkout steps (emails, invoicing, loyalty points).',
      whatInterviewerLooksFor: [
        'Estimates the history writes and per-step latency overhead of a workflow engine',
        'Separates the synchronous critical path from long-running orchestration',
        'Considers Temporal Cloud cost per action or self-hosted persistence load',
        'Proposes a hybrid: plain calls + idempotency + outbox for the fast path, workflows for long tails',
      ],
      modelAnswer: `### What a workflow adds per checkout
- A 3-activity workflow writes roughly: start (1), workflow tasks (3 events each, about 4 rounds), and 3 events per activity → **~20–25 history events**, persisted durably.
- Each step is a round trip: the worker completes a workflow task, the service persists it and dispatches the activity task, the worker polls, then completes and persists. That is typically **~10–30 ms of engine overhead per step** on a healthy cluster, plus the activity's own latency. For 3 steps: ~50–100 ms of overhead before card authorisation (often 150–300 ms on its own).
- At 2,000/s: **~45,000 history events/s** for this one flow. Self-hosted, that is a serious Cassandra or Postgres write load across history shards. On Temporal Cloud, which bills per action, each of the ~6–10 billable actions per workflow × 2,000/s ≈ 12K–20K actions/s, or roughly 30–50 billion actions a month. That is expensive.

### Verdict: not for the synchronous path
The 250 ms p99 is consumed by the PSP. Adding ~50–100 ms of orchestration overhead and a new tail-latency dependency on the critical path is a bad trade, and the 3 steps have simple compensation.

### What I would do
- **Synchronous path:** the API calls authorise (with an idempotency key), reserves stock (a conditional update), and creates the order plus an **outbox row in the same DB transaction**. On a partial failure, void the authorisation inline or let a reconciler handle it (authorisations expire anyway).
- **Long tail on Temporal:** *start* a workflow from the outbox consumer for what really is long-running and branching: capture after shipment, a 7-day refund window, retries of failed captures, dispute handling, partial cancellations. These run at the same 2K/s start rate, but latency no longer matters, and visibility ("where is order X?") is valuable.
- If the team insists, run Temporal for checkout only behind a feature flag, on a dedicated namespace, after a load test that shows engine p99 overhead and cost per checkout.`,
      followUps: [
        {
          q: 'What if checkout includes a 3-D Secure challenge where the user may take 5 minutes?',
          a: 'Then checkout is no longer a 250 ms synchronous call: it is a long-running process with a human step and timeouts, which is exactly what workflows are good at. Start a workflow when the challenge is issued, wait for a signal or update from the 3DS callback with a 10-minute timer, then continue to capture or cancel. The API returns "pending" and the client polls, or gets a push.',
        },
        {
          q: 'How does your non-Temporal fast path stay correct if the API pod dies right after authorisation?',
          a: 'The authorisation used an idempotency key derived from the checkout id. A retry (client or gateway) reuses it, and the PSP returns the same authorisation. If nobody retries, the order row never committed, and a reconciler compares PSP authorisations (by key) without orders older than N minutes, then voids them. Authorisations also auto-expire after a few days, so the worst case is a temporary hold.',
        },
      ],
      pitfalls: [
        'Choosing Temporal for every multi-step flow regardless of latency and throughput',
        'Ignoring history write volume and per-action cost',
        'Rejecting workflow engines outright instead of placing them where they fit',
      ],
    },
    {
      id: 'platform-key-tech-iq-08',
      difficulty: 'hard',
      question:
        'Our feature-flag system stores a 300 KB JSON document in one ZooKeeper znode, and ~25,000 service instances watch it. Every flag change causes a ZooKeeper latency spike, some instances log "connection loss", and a few instances end up running with stale flags for hours. Diagnose all three symptoms and redesign it.',
      whatInterviewerLooksFor: [
        'Computes the fan-out bytes per change and links them to NIC and GC pressure on the servers',
        'Explains one-shot watches, missed events during disconnects, and re-registration bugs as the cause of stale flags',
        'Moves payloads out of ZooKeeper (pointer + version) and reduces the number of watchers',
        'Mentions observers, session timeouts and the alternatives',
      ],
      modelAnswer: `### Symptom 1: latency spike on every change
- A change fires 25,000 watch notifications. Each client re-reads the znode: **25,000 × 300 KB ≈ 7.5 GB** pushed by the ensemble within seconds. With 5 servers, that is ~1.5 GB each, which saturates a 10 Gbps NIC (~1.25 GB/s) for over a second. Large buffers also cause JVM GC pauses.
- 300 KB is far above the "kilobytes" ZooKeeper is designed for (hard limit just under 1 MB).

### Symptom 2: connection loss
During the burst, servers stall on GC and network, heartbeats are delayed past the session timeout's ping budget, and clients see **CONNECTIONLOSS** and reconnect elsewhere. Reconnect storms add load. If the stall exceeds the session timeout, **sessions expire** and every ephemeral node of those clients disappears: discovery and locks break too.

### Symptom 3: stale flags for hours
- Watches are **one-shot**. A client whose handler threw before re-reading, or that re-registered with \`exists\` instead of \`getData\`, never re-arms and stops hearing changes.
- Watch events are **not delivered while disconnected**. A client that reconnects must re-read, and many client wrappers do not.
- Rapid successive changes collapse into one notification. That is fine if you re-read the latest version, but a bug if the code applies "diffs".

### Redesign
1. **The znode holds a pointer, not the payload:** \`/flags/version = { "v": 1842, "sha256": "…", "url": "s3://flags/1842.json" }\`, about 100 bytes. Clients fetch the document from S3 or a CDN (which scales) and verify the hash.
2. **Fewer watchers:** a per-node sidecar or per-cluster flag relay watches ZooKeeper (tens of watchers instead of 25,000) and pushes to local processes over a socket or file. Or use a purpose-built flag service with SSE or gRPC streaming.
3. **Correct client loop:** \`getData(path, watcher)\` reads and re-arms in one call. On reconnect, re-read unconditionally. Expose \`flags_version\` as a metric and alert on instances behind the latest version for more than 2 minutes.
4. If many readers must remain, add **observers** to absorb reads without slowing quorum writes.`,
      followUps: [
        {
          q: 'Would ZooKeeper 3.6 persistent watches fix the stale-flag problem?',
          a: 'Partly. A persistent watch does not need re-arming, which removes the "forgot to re-register" bug. But events are still not delivered during disconnects, and notifications still trigger reads of the 300 KB payload, so the fan-out problem remains. You still need re-read-on-reconnect and the pointer-plus-version design.',
        },
        {
          q: 'Why not just move this to etcd?',
          a: 'etcd watches can resume from a revision, so a reconnecting client gets every missed event, which fixes the "missed while disconnected" class. But etcd has a 1.5 MB request limit, is tuned for small values, and watch fan-out to 25K clients still costs bandwidth. The pointer + version + relay design is needed either way, and the store choice is secondary.',
        },
      ],
      pitfalls: [
        'Treating ZooKeeper as a blob store or a pub/sub system',
        'Assuming watches deliver every change',
        'Ignoring session expiry consequences for ephemeral nodes',
      ],
    },
    {
      id: 'platform-key-tech-iq-09',
      difficulty: 'medium',
      question:
        'Rapid-fire: why did Kafka remove ZooKeeper, what did it replace it with, and in 2026 when would you still choose ZooKeeper for a new system versus etcd or something built into your platform?',
      whatInterviewerLooksFor: [
        'Knows KRaft and KIP-500, and that Kafka 4.0 (2025) is KRaft-only',
        'Explains the concrete benefits: one system, faster controller failover, partition scale',
        'Compares ZooKeeper with etcd: watches, leases, revisions, ecosystem',
        'Gives a sensible rule for new systems',
      ],
      modelAnswer: `**Why Kafka dropped it:** in ZooKeeper mode, cluster metadata (topics, partitions, ISR, configs) lived in ZooKeeper and one broker acted as controller. On controller failover, the new controller had to **reload all metadata from ZooKeeper**, which took minutes for clusters with hundreds of thousands of partitions, and two distributed systems had to be secured, monitored and upgraded together. **KRaft (KIP-500)** puts the metadata in an internal Raft-replicated log (\`__cluster_metadata\`) on a quorum of controllers. Brokers follow that log, failover is near-instant because standby controllers already have the state, and the partition ceiling rises to millions. **Kafka 4.0 (March 2025) removed ZooKeeper mode entirely.** You migrate to KRaft on a 3.x release before upgrading.

**ZooKeeper vs etcd for a new system:**
- etcd: Raft; MVCC with a global **revision**, so watches can **resume from a revision** with no missed events; leases with TTL; transactions (compare-and-swap); gRPC; it is what Kubernetes runs on. Limits: 1.5 MB requests, a ~2 GB default storage quota.
- ZooKeeper: ZAB; mature recipes via Curator; one-shot watches (persistent ones since 3.6); sessions with ephemeral nodes; a JVM ensemble to operate.

**My rule in 2026:**
- **Use what the platform already provides:** Kubernetes Lease objects for leader election, the database (advisory lock + fencing token) for low-rate locks, and the cloud's managed config service.
- **New dedicated coordination store:** etcd.
- **ZooKeeper:** when you are already in an ecosystem that runs it (HBase, Hadoop HA, Solr, older Pulsar deployments), or need Curator's recipes on the JVM.
- **Neither** for high write rates, large data or queues.`,
      followUps: [
        {
          q: 'Does KRaft mean Kafka no longer needs any external coordination at all?',
          a: 'For its own metadata, yes: the controller quorum is internal. You still run the controller nodes (3 or 5, dedicated or combined with brokers), and they need the same care as any consensus group: odd count, separate failure domains, fast disks for the metadata log. Clients and Connect also no longer talk to ZooKeeper; everything goes through brokers.',
        },
        {
          q: 'What is a Kubernetes Lease and why is it often enough for leader election?',
          a: 'A `coordination.k8s.io/v1` Lease object holds `holderIdentity`, `leaseDurationSeconds` and `renewTime`. Candidates update it with optimistic concurrency (resourceVersion) through the API server, which is backed by etcd. client-go and controller-runtime implement the election. It has the same caveat as any lease: add fencing (e.g. the resourceVersion or a generation counter) for side effects outside Kubernetes.',
        },
      ],
      pitfalls: [
        'Saying Kafka "still optionally supports ZooKeeper" in 4.x',
        'Claiming ZooKeeper watches are reliable change streams',
        'Introducing a new ZooKeeper ensemble for a simple leader election inside Kubernetes',
      ],
    },
    {
      id: 'platform-key-tech-iq-10',
      difficulty: 'expert',
      question:
        'Our homegrown ZooKeeper lock client occasionally deadlocks the whole job fleet: no worker can acquire `/locks/reconcile` for hours, yet no worker reports holding it. Restarting one specific worker fixes it. Explain the most likely mechanism and how you would fix the client.',
      context: 'The client creates EPHEMERAL_SEQUENTIAL nodes and retries create() on any error; incidents correlate with network blips between workers and the ensemble.',
      whatInterviewerLooksFor: [
        'Identifies CONNECTIONLOSS during create of a sequential node, leaving an orphaned lowest node',
        'Explains why the ephemeral node survives (the session is still alive) and why restarting that worker fixes it',
        'Proposes protection mode (GUID in the name, find your node after reconnect) or Curator',
        'Adds timeouts, metrics and fencing',
      ],
      modelAnswer: `### Mechanism: the orphaned sequential node
1. Worker W calls \`create('/locks/reconcile/lock-', EPHEMERAL_SEQUENTIAL)\`. The server creates \`lock-0000000412\`, which is the **lowest**, so W now holds the lock.
2. A network blip drops the reply. W's client gets **CONNECTIONLOSS**. It does *not* know whether the create happened.
3. The naive client "retries on any error" and creates \`lock-0000000413\`. Since 413 is not the lowest, W watches its predecessor, **its own** 412, and waits.
4. 412 is ephemeral but is **not deleted**, because W's **session is still alive** (it reconnected within the session timeout). Everyone else is queued behind 412 or 413. Nobody holds the lock in their own view: a fleet-wide deadlock.
5. Restarting W closes its session, the ensemble deletes both ephemerals, and the queue moves.

### Fix
- **Protection mode (as Curator does):** include a client GUID in the node name (\`_c_<guid>-lock-\`). After a CONNECTIONLOSS during create, list the children and look for your GUID **before** retrying. If found, adopt that node.
- Better: use **Curator's \`InterProcessMutex\`** (JVM) or a maintained client library that implements this, rather than maintaining your own.
- Always acquire with a **timeout**, and emit a metric for the age of the lowest lock node. Alert if one node holds the lock for longer than the job's maximum duration.
- Handle **session expiry**: when it happens, the client must assume it lost the lock, abort work and rebuild. Pass the lock node's \`czxid\` as a **fencing token** to protected resources so a paused former holder cannot write.
- Consider whether this needs ZooKeeper at all. A single reconcile job could use a DB row lock or lease with fencing, or a Kubernetes Lease.`,
      followUps: [
        {
          q: 'Why is retrying non-sequential creates usually safe while sequential ones are not?',
          a: 'A plain `create("/x")` is naturally idempotent to detect: if the first attempt succeeded, the retry fails with NODEEXISTS and you can check the owner. A sequential create gets a new, unique name every time, so a retry always succeeds and silently leaves the earlier node behind. Idempotence must be added by encoding identity (a GUID) in the name.',
        },
        {
          q: 'Which other operations have the same "unknown outcome" problem on connection loss?',
          a: 'Any write: setData, delete and multi. For setData, use the conditional version (`setData(path, data, expectedVersion)`) and re-read on BADVERSION to see whether your earlier write landed. For delete, retrying until NONODE is safe. The general rule is the same as in distributed transactions: make writes conditional or identity-tagged so a retry can tell "already applied" from "not applied".',
        },
      ],
      pitfalls: [
        'Blaming ZooKeeper bugs or the lock recipe itself',
        'Fixing it by lowering the session timeout, which only shortens the window and adds false expiries',
        'Ignoring fencing after session expiry',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'platform-key-tech-boe-1',
      question:
        'A device-state service on DynamoDB on-demand takes 5,000 writes/s of 2.5 KB items (80% are updates to existing devices that change only non-key attributes, 20% are new devices) and serves 20,000 eventually consistent reads/s of 6 KB items. There are two GSIs with KEYS_ONLY projections (~0.3 KB entries). Estimate the request units, the minimum partition count for writes and the monthly bill for requests.',
      assumptions: [
        'WRU = 1 KB written; RRU = 4 KB strongly consistent read, eventually consistent = 0.5 RRU',
        'Updates that do not change a GSI key or projected attribute cost nothing on that GSI; inserts cost 1 WRU per GSI (0.3 KB entry)',
        'On-demand list price ≈ $0.625 per million WRU and $0.125 per million RRU (us-east-1, after the Nov 2024 cut)',
        'Steady average load, 30-day month = 2,592,000 s',
      ],
      steps: [
        { label: 'Base-table write units', calc: 'ceil(2.5 KB / 1 KB) = 3 WRU × 5,000/s = 15,000 WRU/s' },
        { label: 'GSI write units', calc: 'Only inserts touch GSIs: 20% × 5,000 = 1,000/s × 2 GSIs × 1 WRU = 2,000 WRU/s' },
        { label: 'Total writes', calc: '15,000 + 2,000 = 17,000 WRU/s' },
        { label: 'Read units', calc: 'ceil(6 KB / 4 KB) = 2 × 0.5 (eventual) = 1 RRU × 20,000/s = 20,000 RRU/s' },
        { label: 'Minimum partitions for base writes', calc: '15,000 WCU ÷ 1,000 per partition = 15 partitions; the device-id key must spread evenly' },
        { label: 'Monthly write cost', calc: '17,000 × 2,592,000 ≈ 44.1B WRU × $0.625/M ≈ $27,500' },
        { label: 'Monthly read cost', calc: '20,000 × 2,592,000 ≈ 51.8B RRU × $0.125/M ≈ $6,500' },
        { label: 'Storage growth (for TTL planning)', calc: '1,000 new items/s × 86,400 × 2.5 KB ≈ 216 GB/day' },
      ],
      answer:
        '≈ 17K WRU/s and 20K RRU/s, at least 15 partitions of write capacity, and ≈ $34K/month in request charges (≈ $27.5K writes + $6.5K reads), plus storage growing ~216 GB/day unless TTL removes stale devices.',
      insight:
        'Writes dominate cost, and item size is the lever: trimming the item from 2.5 KB to under 1 KB (move the bulky blob to S3, shorten attribute names) cuts base writes from 3 WRU to 1, saving ~$18K/month. KEYS_ONLY GSIs that are not touched by updates are nearly free. Steady 24/7 load like this is also where provisioned capacity with auto scaling (or reserved capacity) beats on-demand.',
      followUps: [
        {
          q: 'Product adds a GSI with ALL projection keyed by `lastSeenAt` for "devices seen in the last hour". What happens to the bill?',
          a: 'Every update changes `lastSeenAt`, which is that GSI\'s key, so each update costs 2 index writes (delete the old entry, put the new one) of a 2.5 KB+ projected item: 2 × 3 = 6 WRU. 4,000 updates/s × 6 = 24,000 WRU/s extra, more than doubling write cost (~ +$39K/month). It also creates a hot GSI partition on the current time bucket. Use a sparse, KEYS_ONLY index with bucketed keys, or compute this view from Streams.',
        },
        {
          q: 'Reads must become strongly consistent for a compliance API. What changes?',
          a: 'Strong reads cost 1 RRU per 4 KB instead of 0.5, so 6 KB items cost 2 RRU: 40,000 RRU/s, doubling read cost to ~$13K/month. Strong reads are not available on GSIs, and if DAX is used they bypass the cache. Only the compliance API needs them; keep the rest eventual.',
        },
      ],
    },
    {
      id: 'platform-key-tech-boe-2',
      question:
        'An "account-health" Temporal workflow runs for 90 days per customer. In a loop, it sleeps, calls one activity to fetch metrics, and goes back to sleep. Estimate the event-history size with a 1-hour versus a 5-minute polling interval, find when the 5-minute version would hit the hard limit, and size a continue-as-new policy.',
      assumptions: [
        'Per iteration ≈ 11 events: TimerStarted + TimerFired (2), a workflow task after the timer (3), ActivityTaskScheduled/Started/Completed (3), a workflow task after the activity (3)',
        'Hard limit 51,200 events; warning at 10,240 events',
        'Small payloads, so the 50 MB size limit is not the binding constraint',
      ],
      steps: [
        { label: '1-hour loop: iterations', calc: '90 days × 24 = 2,160 iterations' },
        { label: '1-hour loop: events', calc: '2,160 × 11 ≈ 23,760 events: above the 10,240 warning, below 51,200' },
        { label: '5-minute loop: iterations', calc: '90 × 24 × 12 = 25,920 iterations' },
        { label: '5-minute loop: events', calc: '25,920 × 11 ≈ 285,000 events ≫ 51,200' },
        { label: 'When the 5-minute version dies', calc: '51,200 ÷ 11 ≈ 4,654 iterations × 5 min ≈ 23,270 min ≈ 16.2 days' },
        { label: 'Continue-as-new every 500 iterations', calc: '500 × 11 = 5,500 events per run (under the warning); 25,920 ÷ 500 ≈ 52 runs over 90 days' },
      ],
      answer:
        'About 24K events at hourly polling (survives, but past the warning) and about 285K at 5-minute polling, which would hit the 51,200-event limit and terminate around day 16. Continue-as-new every ~500 iterations keeps each run near 5,500 events.',
      insight:
        'History grows with the number of wake-ups, not with elapsed time, so polling loops are the classic way to blow the limit. Prefer event-driven input (signals or updates when metrics change), longer timers, or batching several checks into one activity. For any unbounded loop, add continue-as-new with explicit state carried forward, and check `continueAsNewSuggested`.',
      followUps: [
        {
          q: 'An upstream system also sends ~50 signals/day per workflow. Does that change the plan?',
          a: 'Each signal adds a WorkflowExecutionSignaled event plus usually a workflow task (3 events): about 4 × 50 = 200 events/day, or 18,000 over 90 days. On top of the 1-hour loop that is ~41,760, dangerously close to the limit, and the 10,000-signals-per-execution cap would be hit at 4,500. Continue-as-new resets both counts, so keep runs to, say, 7 days.',
        },
        {
          q: 'There are 2 million such customers. What does that mean for persistence on a self-hosted cluster?',
          a: 'At 1-hour polling: 2M × 11 events/hour ≈ 22M events/hour ≈ 6,100 events/s sustained, plus visibility updates. At 5-minute polling it is 12× more (~73K/s), which is a large Cassandra cluster. The polling interval is a cost knob for the whole platform, not just for one workflow.',
        },
      ],
    },
    {
      id: 'platform-key-tech-boe-3',
      question:
        'A legacy platform uses ZooKeeper for service discovery: the `payments` service has 2,000 instances registered as ephemeral znodes (~40-byte names) under /services/payments, and 5,000 client instances hold child watches on that path. Estimate the read traffic the ensemble must serve during a rolling deploy that replaces all 2,000 instances in 10 minutes.',
      assumptions: [
        '5-server ensemble, 10 Gbps NIC per server (~1.25 GB/s)',
        'Each instance replacement = 1 delete + 1 create of an ephemeral znode',
        'Every child-watch fire makes the client call getChildren (re-arming the watch), returning all 2,000 names (~80 KB)',
        'Changes are frequent enough that each client re-reads after almost every change (worst case)',
      ],
      steps: [
        { label: 'Membership changes', calc: '2,000 instances × 2 = 4,000 changes in 600 s ≈ 6.7 changes/s' },
        { label: 'Response size', calc: '2,000 names × 40 B ≈ 80 KB per getChildren' },
        { label: 'Bytes per change', calc: '5,000 watchers × 80 KB = 400 MB' },
        { label: 'Ensemble egress', calc: '6.7/s × 400 MB ≈ 2.7 GB/s ÷ 5 servers ≈ 530 MB/s each (~43% of a 10 Gbps NIC)' },
        { label: 'Requests', calc: '6.7 × 5,000 ≈ 33,500 getChildren/s, plus 6.7 quorum writes/s' },
        { label: 'Over the deploy', calc: '2.7 GB/s × 600 s ≈ 1.6 TB served to tell clients about 4,000 changes' },
      ],
      answer:
        'Roughly 33K getChildren/s and ~2.7 GB/s of egress (~530 MB/s per server) for the 10-minute deploy, around 1.6 TB in total, even though only ~7 writes/s happen.',
      insight:
        'Discovery cost in ZooKeeper scales as changes × watchers × membership size: O(N²) as the fleet grows. Fixes: per-host discovery agents or caches (watchers drop from 5,000 to a few hundred), sharding membership into sub-paths, batching or rate-limiting deploys, or using a system built for this (Kubernetes EndpointSlices, a service mesh control plane with incremental xDS, Consul with blocking queries).',
      followUps: [
        {
          q: 'The deploy speeds up to 2 minutes. What breaks first?',
          a: 'The change rate goes up 5× to ~33/s. Egress demand becomes ~13 GB/s, about 2.7 GB/s per server, which is above a 10 Gbps NIC. Servers fall behind, heartbeats are delayed, clients see connection loss, and ephemeral nodes of healthy instances may expire, so discovery collapses mid-deploy. In reality one-shot watches self-throttle somewhat (a client re-reads at most once per round trip), but tail latency still explodes.',
        },
        {
          q: 'How much would a per-host agent (one per VM, 40 clients per VM) save?',
          a: 'Watchers drop from 5,000 to 5,000 ÷ 40 = 125. Bytes per change go from 400 MB to 125 × 80 KB = 10 MB, and egress at 6.7 changes/s from ~2.7 GB/s to ~67 MB/s, a 40× reduction. Agents serve the local processes from memory, and the clients no longer hold ZooKeeper sessions at all.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'platform-key-tech-mcq-01',
      difficulty: 'hard',
      question:
        'This query on a user\'s order history returns only 3 items and a LastEvaluatedKey, although the user has hundreds of DELIVERED orders. Why?',
      code: {
        language: 'typescript',
        title: 'order history query',
        code: `await ddb.send(new QueryCommand({
  TableName: 'app',
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :o)',
  FilterExpression: '#s = :delivered',
  ExpressionAttributeNames: { '#s': 'status' },
  ExpressionAttributeValues: { ':pk': 'USER#42', ':o': 'ORDER#', ':delivered': 'DELIVERED' },
  Limit: 50,
}));`,
      },
      options: [
        'Limit caps the number of items evaluated (50) before the filter is applied, so only 3 of those 50 matched; keep paginating or change the key design',
        'FilterExpression is applied before Limit, so DynamoDB found only 3 DELIVERED orders in the partition',
        'begins_with on the sort key returns at most one page of 3 items per partition by default',
        'Eventually consistent reads hide recently written items, so the remaining orders are not replicated yet',
      ],
      correct: [0],
      explanation:
        'DynamoDB reads up to Limit items (or 1 MB) that match the key condition, then applies the filter. 50 orders were read and charged, and only 3 were DELIVERED, so a LastEvaluatedKey is returned. The filter does not run first, begins_with has no such page cap, and eventual consistency would delay at most very recent writes, not hundreds of older orders.',
      followUps: [
        {
          q: 'How would you serve "delivered orders, newest first, 50 per page" efficiently?',
          a: 'Put the status in the sort key of an index: a GSI with PK = `USER#42#DELIVERED` and SK = createdAt (sparse, set when the order is delivered), or a base-table SK like `ORDER#DELIVERED#<ts>` if status rarely changes. The key condition then selects exactly the wanted items, Limit 50 returns 50, and you pay only for what you read.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-02',
      difficulty: 'hard',
      question:
        'An existing 800 GB table has PK = CHANNEL#id and SK = MSG#ulid. You now need strongly consistent reads of a channel\'s messages ordered by "pinnedAt". What is the realistic option?',
      options: [
        'Add an LSI with sort key pinnedAt via UpdateTable; LSIs support strong reads',
        'Add a GSI with PK = CHANNEL#id and SK = pinnedAt and read it with ConsistentRead = true',
        'Create a new table that defines the LSI at creation, migrate the data, and check that no channel exceeds 10 GB per item collection',
        'Enable DAX in front of a GSI so reads become strongly consistent',
      ],
      correct: [2],
      explanation:
        'LSIs can only be defined when a table is created, so strong reads on an alternate sort key mean a new table plus migration, and the LSI brings the 10 GB per-partition-key cap. GSIs do not support ConsistentRead = true. DAX passes strongly consistent reads through without caching and cannot make a GSI consistent.',
      followUps: [
        {
          q: 'If "eventually consistent within a second" is acceptable after all, what changes?',
          a: 'Add a GSI online (PK = CHANNEL#id, SK = `pinnedAt#msgId`), sparse so that only pinned messages carry the attributes, with KEYS_ONLY or a small INCLUDE projection. There is no migration and no 10 GB cap. If a user pins a message and immediately reloads, the client inserts it locally, or you read the pin from the base table.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-03',
      difficulty: 'expert',
      question:
        'A provisioned table has three GSIs. Select ALL statements about GSI writes that are correct.',
      options: [
        'GSIs are updated asynchronously, so a Query on a GSI right after a successful PutItem may not return the new item',
        'If one GSI lacks write capacity, writes to the base table can be throttled even though the base table has spare WCU',
        'An UpdateItem that changes the value of a GSI\'s partition key costs two writes on that GSI (remove the old entry, add the new one)',
        'Updating an attribute that is neither a key nor projected into a GSI still consumes 1 WCU on that GSI',
        'GSI queries support ConsistentRead = true at double the RCU cost',
      ],
      correct: [0, 1, 2],
      explanation:
        'GSI propagation is asynchronous (usually sub-second). An under-provisioned GSI applies back-pressure that throttles base-table writes, and changing an indexed key requires deleting and re-inserting the index entry. Updates to attributes not in the index consume no GSI capacity, and GSIs support only eventually consistent reads.',
      followUps: [
        {
          q: 'How do you size GSI write capacity during a bulk backfill of 200M items?',
          a: 'Every new item that has the GSI\'s key attributes writes one index entry, sized by its projection. Give each GSI at least the base table\'s write rate × the WRU per index entry, with headroom. Monitor `WriteThrottleEvents` on the index (not just the table), and backfill at a controlled rate so the GSI never back-pressures live writes.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-04',
      difficulty: 'medium',
      question:
        'This transaction is rejected with a ValidationException before any condition is evaluated. What is wrong?',
      code: {
        language: 'typescript',
        title: 'reserve seat',
        code: `await ddb.send(new TransactWriteCommand({
  TransactItems: [
    { ConditionCheck: {
        TableName: 'seats', Key: { PK: 'SHOW#77', SK: 'SEAT#A12' },
        ConditionExpression: '#st = :free',
        ExpressionAttributeNames: { '#st': 'state' }, ExpressionAttributeValues: { ':free': 'FREE' } } },
    { Update: {
        TableName: 'seats', Key: { PK: 'SHOW#77', SK: 'SEAT#A12' },
        UpdateExpression: 'SET #st = :held, holder = :u',
        ExpressionAttributeNames: { '#st': 'state' }, ExpressionAttributeValues: { ':held': 'HELD', ':u': 'U9' } } },
  ],
}));`,
      },
      options: [
        'The same item is targeted by two actions in one transaction; put the condition on the Update itself',
        'TransactWriteItems needs a ClientRequestToken, otherwise it is rejected',
        'ConditionCheck actions are only allowed in TransactGetItems',
        'Transactions cannot update items that share a partition key',
      ],
      correct: [0],
      explanation:
        'A transaction cannot include multiple operations on the same item, here a ConditionCheck and an Update on SHOW#77/SEAT#A12. Move `#st = :free` into the Update\'s ConditionExpression, which also makes this a plain single-item conditional update with no transaction needed. The token is optional, ConditionCheck belongs to TransactWriteItems, and items sharing a partition key are fine.',
      followUps: [
        {
          q: 'The booking must also insert a HOLD item with a 10-minute TTL. Is a transaction justified now?',
          a: 'Yes. Two distinct items (seat + hold) must change together: an Update on the seat with the FREE condition and a Put of `HOLD#U9#A12` with `attribute_not_exists`. It costs 2× WCU per item. Note that TTL deletion is not instant (typically within a few days), so expiry logic must check `expiresAt` rather than rely on the item disappearing.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-05',
      difficulty: 'hard',
      question:
        'A single "global announcement" item receives 1,500 writes/s of 0.8 KB each on an on-demand table with plenty of table-level headroom. Adaptive capacity has already isolated the item on its own partition. What happens?',
      options: [
        'Writes succeed: on-demand mode scales any single key without limit',
        'Writes succeed only if burst capacity is enabled on the table',
        'Writes succeed after DynamoDB splits the item across two partitions by attribute',
        'Writes are throttled above about 1,000 WCU/s, because a single partition key cannot exceed the per-partition maximum; the key must be sharded or the writes aggregated',
      ],
      correct: [3],
      explanation:
        'Adaptive capacity can isolate a hot item, but it cannot exceed the per-partition maximum of 1,000 WCU / 3,000 RCU for one key. 1,500 writes/s of 1 WCU each is 1.5× over. On-demand scales the table, not a single key. Items are never split across partitions, and burst capacity is automatic, short-lived (up to 300 s banked) and not something you enable.',
      followUps: [
        {
          q: 'Readers fetch this announcement 50,000 times/s. Is that a problem too?',
          a: 'Yes. 50K eventually consistent reads of 0.8 KB = 25K RCU on one key, far above the 3,000 RCU per-partition limit. Cache it in DAX, Redis, an in-process cache with a short TTL, or a CDN. Better, publish announcements via a push channel rather than having every client poll the item.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-06',
      difficulty: 'expert',
      question:
        'A team uses the DAX client for all reads and writes. After a user adds a comment, they immediately reload the comment list and do not see it, for several minutes. What is the cause?',
      code: {
        language: 'typescript',
        title: 'comments.service.ts (via DAX client)',
        code: `await dax.send(new PutCommand({
  TableName: 'app',
  Item: { PK: \`POST#\${postId}\`, SK: \`COMMENT#\${ulid()}\`, text, author },
}));
// immediately afterwards, same DAX cluster:
const page = await dax.send(new QueryCommand({
  TableName: 'app',
  KeyConditionExpression: 'PK = :p AND begins_with(SK, :c)',
  ExpressionAttributeValues: { ':p': \`POST#\${postId}\`, ':c': 'COMMENT#' },
}));`,
      },
      options: [
        'DAX is write-around, so the Put did not reach DynamoDB until the cache flushed',
        'DynamoDB Streams lag behind writes, and DAX reads from the stream',
        'The Query is served from the DAX query cache, which is not invalidated by writes; the stale result lives until the query-cache TTL expires',
        'The Put went to a different DAX node, and nodes never share data',
      ],
      correct: [2],
      explanation:
        'DAX keeps separate item and query caches. A write through DAX updates the item cache, but cached Query and Scan result sets are not invalidated, so the same Query returns the old list until its TTL (5 min by default). DAX is write-through, not write-around. It does not read from Streams, and nodes do replicate the item cache, asynchronously.',
      followUps: [
        {
          q: 'How would you fix the user experience without dropping DAX?',
          a: 'Send this Query with ConsistentRead = true (DAX passes it through to DynamoDB uncached) only right after a write by the same user, or bypass DAX for list endpoints that must reflect writes. Alternatively, shorten the query-cache TTL for this table, or have the client merge the comment it just posted into the displayed list. Keep DAX for item lookups and truly read-heavy, staleness-tolerant queries.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-07',
      difficulty: 'hard',
      question:
        'You are choosing a global-table configuration for a wallet ledger that must have RPO = 0 across Regions. Select ALL statements that are true for multi-Region strong consistency (MRSC).',
      options: [
        'It must be deployed in exactly three Regions: three replicas, or two replicas plus a witness',
        'TransactWriteItems is not supported on MRSC replicas',
        'Concurrent writes to the same item from two Regions are resolved by last-writer-wins on an internal timestamp',
        'A write can fail with ReplicatedWriteConflictException when the item is being modified in another Region, and it can be retried',
        'You can convert an existing populated table to MRSC by adding two replicas',
      ],
      correct: [0, 1, 3],
      explanation:
        'MRSC needs exactly three Regions, does not support transactions (nor TTL or LSIs), and rejects conflicting concurrent writes with a retryable ReplicatedWriteConflictException. Last-writer-wins describes MREC, the default eventually consistent mode. Converting to MRSC requires an empty table.',
      followUps: [
        {
          q: 'The ledger needs multi-item atomic debits. How do you reconcile that with MRSC not supporting transactions?',
          a: 'Either redesign each debit as a single-item conditional update (balance plus an embedded recent-request-id set for idempotency), with the ledger entries derived asynchronously, or keep the ledger in a single Region with transactions and use MREC replicas or backups for DR, accepting RPO > 0. You can also move the money ledger to a relational database with synchronous cross-AZ replication.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-08',
      difficulty: 'expert',
      question:
        'An order header and its 5 line items are written in one TransactWriteItems call. A Lambda on the table\'s Stream indexes orders into OpenSearch and assumes "when I see the header, all items are there". Search occasionally shows orders with missing items. Why?',
      options: [
        'Streams deliver duplicate records, so some item records were dropped as duplicates',
        'The Lambda batch size truncates transactions larger than 5 items',
        'Transactions are not captured by Streams at all; only the header was written by a separate call',
        'Stream records from one transaction can appear at different times, in different shards, interleaved with other records; there is no atomicity or cross-item ordering',
      ],
      correct: [3],
      explanation:
        'Streams guarantee exactly-once records and ordering per item only. A transaction\'s changes propagate gradually, and items with different keys may land on different shards, so consumers must not assume transaction atomicity. Records are not duplicated, transactional writes are captured, and the Lambda batch size does not split a transaction semantically.',
      followUps: [
        {
          q: 'How do you make the search index eventually correct?',
          a: 'Make the consumer idempotent and convergent. On any order-related record, re-read the whole order aggregate (a Query on PK = ORDER#id, strongly consistent) and upsert the full document into OpenSearch with a version (e.g. the header\'s version attribute) so older writes cannot overwrite newer ones. Alternatively, write an `itemCount` on the header and defer indexing until all items are seen.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-09',
      difficulty: 'expert',
      question:
        'Version 1 of this workflow has thousands of executions in flight. Version 2 is deployed to all workers. What happens to an in-flight execution that already completed `reserve` and is waiting on `charge` when its next workflow task is processed?',
      code: {
        language: 'typescript',
        title: 'orderWorkflow v1 → v2 diff',
        code: `export async function orderWorkflow(id: string) {
  await reserve(id);
+ await fraudCheck(id);          // v2: new activity inserted
  await charge(id);
  await ship(id);
}`,
      },
      options: [
        'Replay issues a ScheduleActivity(fraudCheck) command where history recorded charge; the SDK raises a non-determinism error and the workflow task keeps failing until the code is fixed or rolled back',
        'It continues normally: Temporal only replays activities, so new code is applied from the next step onwards',
        'The execution fails permanently and is marked Failed, so you must restart it from scratch',
        'Temporal automatically skips the new activity for old executions because it detects the version change',
      ],
      correct: [0],
      explanation:
        'On replay, workflow code must produce the same command sequence as the history. After reserve, v2 schedules fraudCheck, but the history recorded charge, so this is a non-determinism error. It fails the workflow task (retried, so the execution is stuck), not the execution itself. Nothing detects versions automatically: you must use patched() or Worker Versioning.',
      followUps: [
        {
          q: 'Rewrite the change so both old and new executions work.',
          a: 'Wrap it: `if (patched(\'fraud-check\')) { await fraudCheck(id); }`. Executions replaying past this point without the marker skip it, and new executions (or those reaching this point fresh) record the marker and run it. After all old executions close, change it to `deprecatePatch(\'fraud-check\')`, and later remove the patch call entirely.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-10',
      difficulty: 'hard',
      question:
        'A `chargeCard` activity has startToCloseTimeout = 10 s and the default retry policy. During a PSP slowdown, a charge takes 14 s and succeeds at the PSP. What happens next?',
      options: [
        'Temporal waits for the late result and records it, because the activity eventually completed',
        'The workflow fails immediately, because activities do not retry by default',
        'Attempt 1 times out at 10 s and Temporal schedules attempt 2 about 1 s later; without an idempotency key the customer can be charged twice',
        'The PSP call is cancelled automatically at 10 s, so no charge happens',
      ],
      correct: [2],
      explanation:
        'Start-To-Close bounds one attempt. After 10 s the attempt is considered failed and, under the default policy (1 s initial interval, ×2, unlimited attempts), retried, while the first HTTP call may still complete at the PSP. A late completion from a timed-out attempt is ignored. Activities do retry by default, and Temporal cannot cancel an in-flight external HTTP request.',
      followUps: [
        {
          q: 'Besides the idempotency key, what would you change in the options?',
          a: 'Set startToCloseTimeout above the PSP\'s p99.9 (e.g. 45 s), and add a scheduleToCloseTimeout (e.g. 30 min) to bound total retry time. Mark CardDeclined or InvalidCard as non-retryable, and cap backoff with a maximumInterval. Consider heartbeating only if the call can report progress. Then alert on attempt counts above 3 for this activity type.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-11',
      difficulty: 'expert',
      question:
        'A subscription workflow is meant to run for 5 years per customer and receives a signal on every usage event (~20/day). Select ALL changes that keep it within Temporal\'s limits.',
      options: [
        'Call continueAsNew periodically (e.g. monthly, or when continueAsNewSuggested is true), passing the current state as input',
        'Store large invoices in S3 and pass only object keys through activities and signals',
        'Batch usage events upstream and signal a daily summary instead of every event',
        'Raise the event-history limit for this namespace to 1M events in Temporal Cloud',
        'Set a 5-year WorkflowRunTimeout so that the history is compacted automatically',
      ],
      correct: [0, 1, 2],
      explanation:
        'Continue-As-New resets the history (and the 10,000-signal count) while keeping the workflow id. Payload references keep each payload under 2 MB and the history under 50 MB, and batching cuts signal events. The history limits (51,200 events / 50 MB) are not configurable, and timeouts never compact history: a run timeout just ends the run.',
      followUps: [
        {
          q: 'How do you avoid losing a signal that arrives exactly while the workflow is calling continueAsNew?',
          a: 'Before continuing as new, drain buffered signals into state, and only call continueAsNew when no handlers are running (the TS SDK offers `allHandlersFinished()` with `condition`). Signals that arrive after the continue-as-new command go to the new run, since signals target the workflow id. Pass any unprocessed queue in the input so nothing in memory is dropped.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-12',
      difficulty: 'medium',
      question:
        'A cart is modelled as a Temporal workflow. The API needs "add item, return the new total, and reject if the cart is already checked out", synchronously, without a separate read. Which primitive fits?',
      options: [
        'A Query handler that adds the item and returns the total',
        'A Signal, followed by polling a Query until the total changes',
        'An Update with a validator that rejects closed carts and a handler that returns the new total',
        'Starting a child workflow per item and awaiting its result',
      ],
      correct: [2],
      explanation:
        'Updates are synchronous, can mutate state, return a result, and support a validator that rejects a request before anything is written to history. Query handlers must be read-only. Signal + poll is asynchronous and racy, and a child workflow per item adds heavy overhead and history for a simple state change.',
      followUps: [
        {
          q: 'Black Friday traffic sends ~50 updates per cart per minute for popular carts. Any limits to watch?',
          a: 'Each accepted update adds events, so a long-lived cart accumulates history quickly, and Temporal caps updates at 10 in flight and 2,000 total per execution. Continue-as-new the cart periodically (carrying its items), debounce client calls, or keep high-frequency cart edits in Redis or DynamoDB and use the workflow only for checkout orchestration.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-13',
      difficulty: 'hard',
      question:
        'This config watcher logs the first change correctly but misses the second and third changes made a minute later. Why?',
      code: {
        language: 'typescript',
        title: 'config-watcher.ts',
        code: `zk.getData('/cfg/payments', (event) => {
  // watch fired: reload config
  zk.getData('/cfg/payments', (err, data) => {   // no watcher passed here
    if (!err) applyConfig(JSON.parse(data.toString()));
  });
}, (err, data) => {
  if (!err) applyConfig(JSON.parse(data.toString()));
});`,
      },
      options: [
        'ZooKeeper delivers notifications only to the client that last wrote the znode',
        'getData watchers fire only for node deletion, not for data changes',
        'The second change is buffered by the server until the session timeout elapses',
        'Standard watches are one-shot; the reload in the handler reads without a watcher, so after the first notification no watch is armed',
      ],
      correct: [3],
      explanation:
        'A standard watch fires once and must be re-registered by a subsequent read with a watcher. The handler re-reads without one, so the client never hears about later changes. Watches notify any client that set them, the server does not hold events until a timeout, and getData watches do fire on data changes and deletion.',
      followUps: [
        {
          q: 'After fixing re-registration, could the client still miss intermediate versions?',
          a: 'Yes, by design. If two changes happen before the client\'s re-read, it gets one notification and reads only the latest version. Treat watches as "state changed, read the latest", never as a change log. If every version matters, store the versions as sequential children or use a real log (Kafka), or etcd watches from a revision.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-14',
      difficulty: 'expert',
      question:
        'A lock client creates /locks/job/lock- with EPHEMERAL_SEQUENTIAL, receives CONNECTIONLOSS, reconnects within the session timeout and creates the node again. What is the most dangerous consequence?',
      options: [
        'The second create fails with NODEEXISTS, so the client never gets the lock',
        'The first create may have succeeded, leaving an orphaned node owned by the live session; if it is the lowest, everyone (including this client) waits behind it until the session ends',
        'ZooKeeper deduplicates the two creates because they come from the same session',
        'Session expiry immediately deletes both nodes, so there is no lasting effect',
      ],
      correct: [1],
      explanation:
        'Sequential creates always get a new name, so retries do not fail. If the lost create had succeeded, the session (still alive after reconnect) keeps an extra ephemeral node, which may be the lowest and thus block the queue indefinitely. ZooKeeper does not deduplicate creates, and the session did not expire, so nothing is cleaned up.',
      followUps: [
        {
          q: 'How does Curator\'s protection mode solve it?',
          a: 'It prefixes the node name with a client-generated GUID (`_c_<guid>-lock-`). After CONNECTIONLOSS during create, it lists the parent\'s children and looks for its GUID. If the node exists, it adopts it instead of creating another. That makes the sequential create effectively idempotent per attempt.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-15',
      difficulty: 'hard',
      question:
        'Service A writes /deploy/version = 42 through ZooKeeper server 1, then publishes "version 42 ready" on Kafka. Service B consumes the message, reads /deploy/version from server 3 and gets 41. Which statement is correct?',
      options: [
        'Reads are served locally and may lag the leader; B should call sync() on the path before reading if it needs the value A just wrote',
        'This violates ZooKeeper\'s guarantees; the write must have been lost',
        'Server 3 must be partitioned, because a connected server always returns the latest committed value',
        'B should read with a watch, which forces a linearizable read',
      ],
      correct: [0],
      explanation:
        'ZooKeeper gives sequential consistency and a single system image per client, not linearizable reads across clients. Server 3 may not have applied zxid 42 yet. sync() makes the connected server catch up with the leader before the following read, which is exactly what a cross-client, out-of-band notification needs. The write was committed, the lag is normal, and watches do not change read consistency.',
      followUps: [
        {
          q: 'Could B get the same guarantee without sync()?',
          a: 'Yes, if A includes the zxid or version of its write in the Kafka message. B reads and compares `stat.version` (or mzxid) with the expected one, and retries or calls sync() if it is behind. That avoids a sync on every read. etcd offers linearizable reads by default (with a quorum check on the leader), which is one reason it is preferred for this pattern.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-16',
      difficulty: 'hard',
      question:
        'Select ALL use cases where ZooKeeper (or a similar coordination store) is the wrong tool.',
      options: [
        'A per-user API rate limiter updating counters on every request at 30K requests/s',
        'Electing one active scheduler among 3 replicas of a batch service, with fencing tokens',
        'Storing 20 MB ML model blobs so all inference pods can fetch them',
        'Service discovery for 40,000 rapidly churning pods with thousands of watchers per service',
        'Holding a small, versioned shard-map pointer that a few hundred routers watch',
      ],
      correct: [0, 2, 3],
      explanation:
        'Every ZooKeeper write is a leader-ordered quorum write with fsync, and the whole tree lives in memory on every server with znodes under 1 MB. High-rate counters, large blobs and massive watch fan-out all fight that design. Leader election among a few replicas and a small, watched pointer to a versioned config or shard map are exactly what it is for.',
      followUps: [
        {
          q: 'What would you use instead for the three bad cases?',
          a: 'Rate limiter: Redis (INCR plus expiry, or a Lua token bucket), possibly sharded. Model blobs: S3 or a CDN, with a small version pointer in the coordination store or the deploy manifest. Discovery at that scale: Kubernetes EndpointSlices or a mesh control plane with incremental xDS, or per-host discovery agents so watcher counts stay small.',
        },
      ],
    },
    {
      id: 'platform-key-tech-mcq-17',
      difficulty: 'medium',
      question:
        'You run Kafka 3.6 with ZooKeeper and want to upgrade to Kafka 4.1. What must happen?',
      options: [
        'Upgrade brokers directly to 4.1; it auto-migrates metadata from ZooKeeper on first start',
        'Migrate the cluster to KRaft mode on a 3.x release (3.9 is the bridge), then upgrade to 4.x, which no longer supports ZooKeeper',
        'Nothing special: 4.x supports both ZooKeeper and KRaft, with KRaft recommended',
        'Replace ZooKeeper with etcd, which Kafka 4.x uses for metadata',
      ],
      correct: [1],
      explanation:
        'Kafka 4.0 removed ZooKeeper mode completely (KIP-500 finished), so a ZooKeeper-based cluster must first complete the ZK → KRaft migration on a 3.x release that supports it (3.9 is the last, bridge release) before moving to 4.x. 4.x cannot migrate itself, it has no dual mode, and Kafka uses its own Raft-based controller quorum, not etcd.',
      followUps: [
        {
          q: 'What do you need to provision for KRaft that you did not before?',
          a: 'A controller quorum: 3 or 5 controller nodes (dedicated in large clusters, or combined broker+controller in small ones), in separate failure domains, with fast disks for the `__cluster_metadata` log. Monitor controller metadata lag and quorum health, and remove ZooKeeper-specific tooling and ACL paths.',
        },
      ],
    },
  ],
};

export default topic;
