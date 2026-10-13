// Reference solution: a Kafka-lite partitioned log with consumer groups.
//
// Model:
//   Broker ── topics ── partitions (append-only arrays of records, offsets never reused)
//          └─ consumer groups ── members (subscriptions) ── assignment (topic-partition → member)
//                                └─ committed offsets (per topic-partition, the NEXT offset to read)
// A member's fetch position starts at the committed offset and advances on poll. On
// rebalance every position is reset to the committed offset, which is exactly why
// uncommitted records are redelivered (at-least-once).

/** 32-bit FNV-1a hash of the UTF-8 bytes of `key`, as an unsigned integer. */
export function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(key, 'utf8')) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Partition for a keyed record: fnv1a(key) % partitions. */
export function partitionFor(key: string, partitions: number): number {
  return fnv1a(key) % partitions;
}

export interface LogRecord {
  topic: string;
  partition: number;
  offset: number;
  key: string | null;
  value: string;
  timestamp: number;
}

export interface TopicPartition {
  topic: string;
  partition: number;
}

export interface OffsetCommit extends TopicPartition {
  /** the next offset to consume (last processed offset + 1), like Kafka */
  offset: number;
}

export interface TopicOptions {
  /** keep at most this many records per partition; older ones are deleted (default: unlimited) */
  retentionMaxRecords?: number;
}

export interface BrokerOptions {
  now?: () => number;
}

export class OffsetOutOfRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OffsetOutOfRangeError';
  }
}

export class NotAssignedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAssignedError';
  }
}

interface Partition {
  /** offset of records[0] */
  start: number;
  records: LogRecord[];
}

interface Topic {
  name: string;
  partitions: Partition[];
  retention: number;
  /** round-robin cursor for null-key records */
  rr: number;
}

interface Group {
  generation: number;
  /** memberId → subscribed topics */
  members: Map<string, string[]>;
  /** "topic/partition" → memberId */
  owners: Map<string, string>;
  /** "topic/partition" → committed offset */
  committed: Map<string, number>;
  /** memberId → ("topic/partition" → fetch position) */
  positions: Map<string, Map<string, number>>;
}

const tpKey = (topic: string, partition: number) => `${topic}/${partition}`;

export class Broker {
  #topics = new Map<string, Topic>();
  #groups = new Map<string, Group>();
  #now: () => number;

  constructor(opts: BrokerOptions = {}) {
    this.#now = opts.now ?? Date.now;
  }

  createTopic(name: string, partitions: number, opts: TopicOptions = {}): void {
    if (this.#topics.has(name)) throw new Error(`topic exists: ${name}`);
    if (!Number.isInteger(partitions) || partitions < 1) throw new Error('partitions must be a positive integer');
    this.#topics.set(name, {
      name,
      partitions: Array.from({ length: partitions }, () => ({ start: 0, records: [] })),
      retention: opts.retentionMaxRecords ?? Infinity,
      rr: 0,
    });
  }

  partitionCount(topic: string): number {
    return this.#topic(topic).partitions.length;
  }

  /** Append; keyed records go to partitionFor(key), null keys round-robin from partition 0. */
  produce(topic: string, key: string | null, value: string): { partition: number; offset: number } {
    const t = this.#topic(topic);
    const partition = key === null ? t.rr++ % t.partitions.length : partitionFor(key, t.partitions.length);
    return { partition, offset: this.produceTo(topic, partition, key, value) };
  }

  /** Append to an explicit partition; returns the record's offset. */
  produceTo(topic: string, partition: number, key: string | null, value: string): number {
    const p = this.#partition(topic, partition);
    const offset = p.start + p.records.length;
    p.records.push({ topic, partition, offset, key, value, timestamp: this.#now() });
    // Retention by count: drop from the head; offsets of remaining records are unchanged.
    const retention = this.#topic(topic).retention;
    while (p.records.length > retention) {
      p.records.shift();
      p.start++;
    }
    return offset;
  }

  /** First offset still stored (advances as retention deletes records). */
  logStartOffset(topic: string, partition: number): number {
    return this.#partition(topic, partition).start;
  }

  /** Offset the next appended record will get (a.k.a. log-end offset / high watermark). */
  endOffset(topic: string, partition: number): number {
    const p = this.#partition(topic, partition);
    return p.start + p.records.length;
  }

  /** Up to maxRecords from `offset`. offset < logStart throws OffsetOutOfRangeError; offset >= end returns []. */
  read(topic: string, partition: number, offset: number, maxRecords: number): LogRecord[] {
    const p = this.#partition(topic, partition);
    if (offset < p.start) throw new OffsetOutOfRangeError(`offset ${offset} < log start ${p.start} for ${tpKey(topic, partition)}`);
    const i = offset - p.start;
    return p.records.slice(i, i + maxRecords).map((r) => ({ ...r }));
  }

  // ------------------------------------------------------------ consumer groups

  /** Add (or update the subscription of) a member and rebalance the group. */
  joinGroup(groupId: string, memberId: string, topics: string[]): void {
    for (const t of topics) this.#topic(t);
    let g = this.#groups.get(groupId);
    if (!g) {
      g = { generation: 0, members: new Map(), owners: new Map(), committed: new Map(), positions: new Map() };
      this.#groups.set(groupId, g);
    }
    g.members.set(memberId, [...topics]);
    this.#rebalance(g);
  }

  /** Remove a member (graceful leave or detected crash) and rebalance. Uncommitted work is redelivered. */
  leaveGroup(groupId: string, memberId: string): void {
    const g = this.#group(groupId);
    if (!g.members.delete(memberId)) return;
    this.#rebalance(g);
  }

  generation(groupId: string): number {
    return this.#group(groupId).generation;
  }

  members(groupId: string): string[] {
    return [...this.#group(groupId).members.keys()].sort();
  }

  /** Partitions currently owned by the member, sorted by topic then partition. */
  assignment(groupId: string, memberId: string): TopicPartition[] {
    const g = this.#group(groupId);
    const out: TopicPartition[] = [];
    for (const [k, owner] of g.owners) {
      if (owner !== memberId) continue;
      const i = k.lastIndexOf('/');
      out.push({ topic: k.slice(0, i), partition: Number(k.slice(i + 1)) });
    }
    return out.sort((a, b) => (a.topic === b.topic ? a.partition - b.partition : a.topic < b.topic ? -1 : 1));
  }

  /**
   * Fetch up to maxRecords from the member's partitions (in assignment order), starting at
   * its fetch position and advancing it. Positions below log start reset to log start.
   */
  poll(groupId: string, memberId: string, maxRecords: number): LogRecord[] {
    const g = this.#group(groupId);
    if (!g.members.has(memberId)) throw new NotAssignedError(`${memberId} is not a member of ${groupId}`);
    const positions = g.positions.get(memberId)!;
    const out: LogRecord[] = [];
    for (const tp of this.assignment(groupId, memberId)) {
      if (out.length >= maxRecords) break;
      const k = tpKey(tp.topic, tp.partition);
      const start = this.logStartOffset(tp.topic, tp.partition);
      let pos = positions.get(k) ?? g.committed.get(k) ?? start;
      if (pos < start) pos = start; // auto.offset.reset = earliest
      const batch = this.read(tp.topic, tp.partition, pos, maxRecords - out.length);
      out.push(...batch);
      positions.set(k, pos + batch.length);
    }
    return out;
  }

  /** Commit offsets; only the current owner of each partition may commit (fencing zombies). */
  commit(groupId: string, memberId: string, offsets: OffsetCommit[]): void {
    const g = this.#group(groupId);
    // Validate everything first so a commit is all-or-nothing.
    for (const o of offsets) {
      const k = tpKey(o.topic, o.partition);
      if (g.owners.get(k) !== memberId) throw new NotAssignedError(`${memberId} does not own ${k} in generation ${g.generation}`);
      if (o.offset < 0 || o.offset > this.endOffset(o.topic, o.partition)) throw new OffsetOutOfRangeError(`cannot commit ${o.offset} for ${k}`);
    }
    for (const o of offsets) g.committed.set(tpKey(o.topic, o.partition), o.offset);
  }

  /** Committed offset (next to read) for the group, or undefined if never committed. */
  committed(groupId: string, topic: string, partition: number): number | undefined {
    return this.#group(groupId).committed.get(tpKey(topic, partition));
  }

  /** Lag = endOffset − (committed ?? logStart), summed over all partitions of `topic`. */
  lag(groupId: string, topic: string): number {
    const g = this.#group(groupId);
    let lag = 0;
    for (let p = 0; p < this.partitionCount(topic); p++) {
      const start = this.logStartOffset(topic, p);
      lag += this.endOffset(topic, p) - Math.max(start, g.committed.get(tpKey(topic, p)) ?? start);
    }
    return lag;
  }

  /**
   * Eager rebalance: bump generation, reassign every partition, reset every fetch position
   * to the committed offset. Per topic, partition p → the (p % n)-th subscriber (sorted ids).
   */
  #rebalance(g: Group): void {
    g.generation++;
    g.owners.clear();
    g.positions.clear();
    const memberIds = [...g.members.keys()].sort();
    for (const id of memberIds) g.positions.set(id, new Map());
    const topics = new Set<string>();
    for (const subs of g.members.values()) for (const t of subs) topics.add(t);
    for (const topic of [...topics].sort()) {
      const subscribers = memberIds.filter((id) => g.members.get(id)!.includes(topic));
      const n = this.partitionCount(topic);
      for (let p = 0; p < n; p++) g.owners.set(tpKey(topic, p), subscribers[p % subscribers.length]);
    }
  }

  #topic(name: string): Topic {
    const t = this.#topics.get(name);
    if (!t) throw new Error(`unknown topic: ${name}`);
    return t;
  }

  #partition(topic: string, partition: number): Partition {
    const p = this.#topic(topic).partitions[partition];
    if (!p) throw new Error(`unknown partition: ${tpKey(topic, partition)}`);
    return p;
  }

  #group(id: string): Group {
    const g = this.#groups.get(id);
    if (!g) throw new Error(`unknown group: ${id}`);
    return g;
  }
}
