// Pure simulation of an O(1) LRU cache: hash map → nodes of a doubly linked list with sentinels.
// head.next = MRU, tail.prev = LRU. Every operation is composed of unlink(x) and pushFront(x).
import type { BaseFrame } from '../../core';

export type Pattern = 'recency' | 'scan';

export interface Params {
  capacity: number;
  pattern: Pattern;
}

export const DEFAULT_PARAMS: Params = { capacity: 3, pattern: 'recency' };

export interface Entry {
  key: string;
  value: number;
}

export type Result = 'hit' | 'miss' | 'insert' | 'update' | 'evict' | 'move' | 'start' | 'done';

export interface Frame extends BaseFrame {
  /** linked list from head.next (MRU) to tail.prev (LRU) */
  list: Entry[];
  /** a node that has been unlinked and is about to be re-inserted (move) or dropped (evict) */
  floating?: { entry: Entry; tone: 'move' | 'evict'; fromIndex: number };
  /** keys present in the hash map */
  mapKeys: string[];
  op: string;
  result: Result;
  /** key of the node that was just touched (pushed to the front) */
  touched?: string;
  /** the pointer writes performed in this step */
  writes: string[];
  hits: number;
  misses: number;
}

/** get = lookup only; put = insert/update; read = cache-aside get, and on a miss load + put */
type Op = { kind: 'get'; key: string } | { kind: 'put'; key: string; value: number } | { kind: 'read'; key: string };

function script(pattern: Pattern): Op[] {
  const get = (key: string): Op => ({ kind: 'get', key });
  const put = (key: string, value = 1): Op => ({ kind: 'put', key, value });
  const read = (key: string): Op => ({ kind: 'read', key });
  if (pattern === 'recency') {
    return [put('A'), put('B'), put('C'), get('A'), put('D'), get('B'), get('C'), put('A', 2), put('E'), get('D'), get('A'), get('E'), get('C')];
  }
  return [read('A'), read('B'), read('A'), read('B'), read('A'), read('S1'), read('S2'), read('S3'), read('S4'), read('S5'), read('A'), read('B'), read('A')];
}

const nameOf = (list: Entry[], i: number) => (i < 0 ? 'HEAD' : i >= list.length ? 'TAIL' : list[i].key);

function unlinkWrites(list: Entry[], i: number): string[] {
  const prev = nameOf(list, i - 1);
  const next = nameOf(list, i + 1);
  return [`${prev}.next = ${next}`, `${next}.prev = ${prev}`];
}

function pushFrontWrites(list: Entry[], key: string): string[] {
  const first = nameOf(list, 0);
  return [`${key}.prev = HEAD`, `${key}.next = ${first}`, `${first}.prev = ${key}`, `HEAD.next = ${key}`];
}

export function simulate({ capacity, pattern }: Params): Frame[] {
  const frames: Frame[] = [];
  let list: Entry[] = [];
  const map = new Set<string>();
  let hits = 0;
  let misses = 0;
  let predictedEvict = false;
  let predictedUpdate = false;
  let predictedMove = false;
  const ops = script(pattern);
  const snapshot = (extra: Omit<Frame, 'list' | 'mapKeys' | 'hits' | 'misses'>): Frame => ({
    list: list.map((e) => ({ ...e })),
    mapKeys: [...map].sort(),
    hits,
    misses,
    ...extra,
  });

  frames.push(
    snapshot({
      op: '—',
      result: 'start',
      writes: [],
      caption:
        pattern === 'recency'
          ? `Empty LRU of capacity ${capacity}: just the HEAD and TAIL sentinels. The map will point at list nodes; HEAD.next is the most recent, TAIL.prev the least.`
          : `Empty LRU of capacity ${capacity}, read cache-aside: on a miss we load from the DB and put. Keys A and B are the hot set; S1…S5 are a one-off batch scan.`,
    }),
  );

  /** pushes key to the front, recording writes; used for insert and for re-insert after unlink */
  const pushFront = (entry: Entry) => {
    const writes = pushFrontWrites(list, entry.key);
    list = [entry, ...list];
    return writes;
  };

  /** evict tail.prev in two visible steps: unlink + map.delete, then the caller inserts */
  const evict = (op: string, incoming: string) => {
    const idx = list.length - 1;
    const victim = list[idx];
    const writes = [...unlinkWrites(list, idx), `map.delete("${victim.key}")`];
    list = list.slice(0, idx);
    map.delete(victim.key);
    frames.push(
      snapshot({
        op,
        result: 'evict',
        floating: { entry: victim, tone: 'evict', fromIndex: idx },
        writes,
        caption: `Full (${capacity}/${capacity}), so evict TAIL.prev = ${victim.key}, the least recently used: unlink it (2 writes) and map.delete("${victim.key}"). The node stores its key so we can do that delete. This makes room for ${incoming}.`,
      }),
    );
  };

  /** move an existing key to the front: unlink frame (if not already MRU) then pushFront frame */
  const touch = (op: string, key: string, result: Result, lead: string) => {
    const idx = list.findIndex((e) => e.key === key);
    const entry = list[idx];
    if (idx === 0) {
      frames.push(snapshot({ op, result, touched: key, writes: [], caption: `${lead} ${key} is already HEAD.next (MRU), so no pointers change.` }));
      return;
    }
    const uw = unlinkWrites(list, idx);
    list = list.filter((_, i) => i !== idx);
    frames.push(
      snapshot({
        op,
        result: 'move',
        floating: { entry, tone: 'move', fromIndex: idx },
        writes: uw,
        caption: `${lead} The map hands us ${key}'s node directly (O(1)), so unlink it: ${uw.join('; ')}. Its neighbours now point at each other.`,
      }),
    );
    const pw = pushFront(entry);
    frames.push(
      snapshot({
        op,
        result,
        touched: key,
        writes: pw,
        caption: `pushFront(${key}): 4 writes, reading HEAD.next before overwriting it. ${key} is now the most recently used.`,
      }),
    );
  };

  const insert = (op: string, key: string, value: number, lead: string) => {
    if (list.length >= capacity) evict(op, key);
    map.add(key);
    const pw = pushFront({ key, value });
    frames.push(
      snapshot({
        op,
        result: 'insert',
        touched: key,
        writes: [`map.set("${key}", node)`, ...pw],
        caption: `${lead} Create node ${key}, map.set it, then pushFront. Size ${list.length}/${capacity}.`,
      }),
    );
  };

  ops.forEach((o, oi) => {
    const label = o.kind === 'put' ? `put(${o.key}${o.value > 1 ? `, v${o.value}` : ''})` : `get(${o.key})`;
    const present = map.has(o.key);
    if (o.kind === 'get') {
      if (present) {
        hits++;
        touch(label, o.key, 'hit', `get(${o.key}) is a HIT.`);
      } else {
        misses++;
        frames.push(
          snapshot({ op: label, result: 'miss', writes: [], caption: `get(${o.key}) is a MISS: it is not in the map (it was evicted or never stored). The caller must go to the database.` }),
        );
      }
    } else if (o.kind === 'put') {
      if (present) {
        const idx = list.findIndex((e) => e.key === o.key);
        list[idx] = { key: o.key, value: o.value };
        touch(label, o.key, 'update', `put(${o.key}) on an existing key: update the value in place. Updating is a recency touch too.`);
      } else {
        insert(label, o.key, o.value, `put(${o.key}) is a new key.`);
      }
    } else {
      if (present) {
        hits++;
        touch(`get(${o.key})`, o.key, 'hit', `get(${o.key}) is a HIT.`);
      } else {
        misses++;
        insert(`get(${o.key}) → miss → put(${o.key})`, o.key, 1, `get(${o.key}) MISSES, so we load it from the DB and put it.`);
      }
    }

    // predict prompts on the frame just before an "aha" operation
    const next = ops[oi + 1];
    const last = frames[frames.length - 1];
    if (!next) return;
    const nextPresent = map.has(next.key);
    const willInsert = (next.kind === 'put' || next.kind === 'read') && !nextPresent;
    if (pattern === 'scan') {
      if (next.key === 'S1') last.predict = `A and B are hot (hit repeatedly). A batch job now reads 5 one-off keys S1…S5 into a cache of ${capacity}. What happens to A and B?`;
      else if (oi > 0 && ops[oi].key === 'S5') last.predict = 'The scan is over and the app asks for its hot key again. Does get(A) hit?';
      return;
    }
    if (willInsert && list.length >= capacity && !predictedEvict) {
      predictedEvict = true;
      last.predict = `The cache is full and ${next.key} is new. Which node is evicted, and which second structure must also be updated?`;
    } else if (next.kind === 'get' && nextPresent && list[0].key !== next.key && !predictedMove) {
      predictedMove = true;
      last.predict = `get(${next.key}): ${next.key} is in the middle or at the tail. Which pointers change to make it MRU?`;
    } else if (next.kind === 'put' && nextPresent && !predictedUpdate) {
      predictedUpdate = true;
      last.predict = `put(${next.key}) for a key that already exists. Does anything get evicted? Where does ${next.key} end up?`;
    }
  });

  const total = hits + misses;
  frames.push(
    snapshot({
      op: '—',
      result: 'done',
      writes: [],
      caption:
        pattern === 'recency'
          ? `Done: ${hits} hits / ${total} gets (${Math.round((hits / total) * 100)}%). Every get and put touched a constant number of pointers, whatever the size: O(1).`
          : `Done: ${hits} hits / ${total} reads (${Math.round((hits / total) * 100)}%). The one-off scan flushed the hot set, so A and B missed afterwards. Scan-resistant policies (2Q, SLRU, W-TinyLFU) keep the scan in a probation area.`,
    }),
  );
  return frames;
}
