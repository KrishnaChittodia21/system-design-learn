# Build an O(1) LRU Cache (then LFU & TTL)

## Goal
Implement, in `src/index.ts`:

1. **`DoublyLinkedList<T>` / `ListNode<T>`** — the recency list. `pushFront`, `remove(node)`, `moveToFront(node)`, `popBack`, `head`, `tail`, `length`, `toArray`.
2. **`LRUCache<K, V>`** — `Map<K, ListNode>` + your list, so `get`/`set`/`delete`/eviction are O(1).
3. **TTL + eviction callback** — injected clock (`now`), default and per-entry TTL, lazy expiry, `prune()`, `onEvict(key, value, reason)`.
4. **Stretch: `LFUCache<K, V>`** — O(1) LFU with recency tie-break.

## API semantics (the tests check all of these)
| Method | Recency | Notes |
|---|---|---|
| `get(k)` | refreshes | expired → removed, `onEvict(...,'expired')`, returns `undefined` |
| `peek(k)` / `has(k)` | no change | expired → treated as missing |
| `set(k, v, ttl?)` | becomes MRU | overwrite updates value + TTL in place (no callback); over capacity → evict tail with `'capacity'` |
| `delete(k)` | — | `true` only if a live entry existed; no callback |
| `keys()` | no change | MRU → LRU, expired entries hidden (but still counted in `size` until touched/pruned) |
| `prune()` | — | removes all expired entries, returns how many |

An entry set at time `t` with TTL `d` is expired when `now() >= t + d`.

## Constraints
- **Do not rely on `Map` insertion order for recency** (the `delete`-then-`set` trick). Recency must live in your own linked list — that's the interview answer.
- Erasable TypeScript only (no enums, parameter properties or namespaces). No npm dependencies.
- Capacity must be a positive integer, otherwise throw `RangeError`.

## Run
```bash
npm run project -- lru-cache            # judge your src/
npm run project -- lru-cache --solution # judge the reference solution
```

## Hints
- Write the list first and test pointer surgery in isolation — most LRU bugs are a forgotten `prev` pointer or not updating `tail` when removing the last node.
- Store the **key inside the node** so that evicting the tail can delete it from the map.
- For LFU: `nodes: Map<K, Node>`, `buckets: Map<freq, DoublyLinkedList>`, `minFreq`. On a touch, move the node from bucket `f` to `f+1`; if bucket `f` empties and `f === minFreq`, `minFreq++`. A brand-new key always resets `minFreq` to 1.

## Stretch goals
- Size-aware eviction (`maxBytes` with a `sizeOf` function).
- Segmented LRU / 2Q for scan resistance, or W-TinyLFU's admission filter.
- Thread-safety discussion: what would you lock in a multi-threaded runtime, and why sharding the cache helps.
