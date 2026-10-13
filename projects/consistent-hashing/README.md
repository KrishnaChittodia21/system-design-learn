# Build a Consistent-Hash Ring with Virtual Nodes

## Goal
Implement in `src/index.ts`: `fnv1a32`, `fmix32`, `hash32` and the `HashRing` class
(`addNode`, `removeNode`, `getNode`, `getNodes`, `nodes`, `pointCount`).

## Semantics the judge checks
- A node with weight `w` contributes `max(1, round(vnodes × w))` points labelled `` `${id}#${i}` ``; each point sits at `hash(label)`.
- Points are sorted by hash (ties by node id). `getNode(key)` returns the owner of the **first point with hash ≥ hash(key)**, wrapping to the first point.
- `getNodes(key, n)` keeps walking clockwise and returns up to `n` **distinct physical** nodes (the replica set / preference list).
- Same membership ⇒ same answers, regardless of the order nodes were added.
- Duplicate ids throw; non-positive weights and vnodes throw `RangeError`.
- The balance and movement tests inject their own seeded hash (MD5) through `options.hash`, so your ring logic is judged independently of your `hash32`. One test also checks balance with your default `hash32`.

## Run
```bash
npm run project -- consistent-hashing
npm run project -- consistent-hashing --solution
```

## Hints
- `Math.imul` + `>>> 0` keep FNV in unsigned 32-bit land; JavaScript bitwise ops are signed.
- Store points in one sorted array of `{ hash, node }` and binary-search for the successor. Re-sorting on `addNode` is fine — membership changes are rare compared with lookups.
- The ±25% band needs a few hundred vnodes per node: load variance shrinks roughly with `1/√vnodes`.

## Stretch goals
- Bounded-load consistent hashing (Google/Vimeo): cap each node at `(1+ε) × mean` and spill to the next node.
- Rendezvous (HRW) hashing and Jump Consistent Hash — compare movement, memory and lookup cost.
- A `diff(oldRing, newRing)` that lists the hash ranges that changed owner (what a rebalancer streams).
