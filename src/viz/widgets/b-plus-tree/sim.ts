// Pure, deterministic B+ tree simulation (no React, testable with Node).
// Insert a fixed key sequence into a B+ tree whose nodes hold at most `maxKeys` keys, then run a
// range scan that descends once and walks the leaf sibling links. For contrast, the same keys are
// also inserted into a classic B-tree (every key stored exactly once, also in internal nodes) and
// the same range is answered with an in-order traversal.
import type { BaseFrame } from '../../core';

export type KeyOrder = 'sequential' | 'random';

export interface Params {
  maxKeys: number; // 3..5 keys per node
  keyOrder: KeyOrder;
}

export const DEFAULT_PARAMS: Params = { maxKeys: 3, keyOrder: 'sequential' };

export const SEQUENTIAL = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70];
export const RANDOM = [35, 10, 60, 25, 50, 5, 45, 70, 15, 40, 30, 65, 20, 55];
export const RANGE_LO = 20;
export const RANGE_HI = 45;

/** immutable snapshot of a node for rendering */
export interface SnapNode {
  id: string;
  leaf: boolean;
  keys: number[];
  children: SnapNode[];
  /** leaf sibling pointer (B+ tree leaves only) */
  next: string | null;
}

export type Tone = 'path' | 'overflow' | 'split' | 'new' | 'scan' | 'visit' | 'done';
export type KeyTone = 'inserted' | 'copied' | 'pushed' | 'hit' | 'miss';

export interface Stats {
  height: number;
  nodes: number;
  leaves: number;
  internal: number;
}

export interface Frame extends BaseFrame {
  phase: 'intro' | 'insert' | 'overflow' | 'split' | 'scan' | 'btree' | 'done';
  kind: 'bplus' | 'btree';
  tree: SnapNode | null;
  /** node id → highlight */
  hl: Record<string, Tone>;
  /** individual keys to highlight: `${nodeId}:${key}` → tone */
  keyHl: Record<string, KeyTone>;
  inserted: number[];
  /** keys collected so far by the range scan */
  found: number[];
  stats: Stats;
  /** draw leaf→leaf sibling arrows */
  showLinks: boolean;
  /** leaf link to emphasise (from leaf id) during the scan */
  linkHl: string | null;
}

interface Node {
  id: string;
  leaf: boolean;
  keys: number[];
  children: Node[];
  next: Node | null;
}

/** count of keys <= x: child index to follow in a B+ tree (separator = first key of right child) */
const childIndex = (keys: number[], x: number) => {
  let i = 0;
  while (i < keys.length && keys[i] <= x) i++;
  return i;
};

export function snapshot(n: Node): SnapNode {
  return { id: n.id, leaf: n.leaf, keys: [...n.keys], children: n.children.map(snapshot), next: n.next ? n.next.id : null };
}

export function statsOf(root: SnapNode | null): Stats {
  if (!root) return { height: 0, nodes: 0, leaves: 0, internal: 0 };
  let nodes = 0;
  let leaves = 0;
  let height = 0;
  const walk = (n: SnapNode, d: number) => {
    nodes++;
    height = Math.max(height, d);
    if (n.children.length === 0) leaves++;
    n.children.forEach((c) => walk(c, d + 1));
  };
  walk(root, 1);
  return { height, nodes, leaves, internal: nodes - leaves };
}

const list = (xs: number[]) => xs.join(', ');

export function simulate({ maxKeys: m, keyOrder }: Params): Frame[] {
  const keys = keyOrder === 'sequential' ? SEQUENTIAL : RANDOM;
  const frames: Frame[] = [];
  let seq = 0;
  const mk = (leaf: boolean): Node => ({ id: `${leaf ? 'L' : 'I'}${seq++}`, leaf, keys: [], children: [], next: null });
  let root: Node | null = null;
  const inserted: number[] = [];
  let sawLeafSplit = false;
  let sawInternalSplit = false;

  const push = (f: Omit<Frame, 'kind' | 'stats' | 'inserted' | 'found' | 'showLinks' | 'linkHl'> & Partial<Frame>) => {
    const tree = f.tree ?? null;
    frames.push({
      kind: 'bplus',
      inserted: [...inserted],
      found: [],
      showLinks: true,
      linkHl: null,
      ...f,
      tree,
      stats: statsOf(tree),
    });
  };

  push({
    phase: 'intro',
    tree: null,
    hl: {},
    keyHl: {},
    caption: `A B+ tree with at most ${m} keys per node. All ${keys.length} keys will live in the LEAVES; internal nodes only hold copies used as signposts. Keys arrive ${keyOrder === 'sequential' ? 'in ascending order (like an auto-increment id)' : 'in a shuffled order (like a random UUID)'}.`,
  });

  for (const k of keys) {
    inserted.push(k);
    if (!root) {
      root = mk(true);
      root.keys.push(k);
      push({
        phase: 'insert',
        tree: snapshot(root),
        hl: { [root.id]: 'new' },
        keyHl: { [`${root.id}:${k}`]: 'inserted' },
        caption: `Insert ${k}: the tree is a single leaf, which is also the root. Height 1.`,
      });
      continue;
    }
    // descend to the leaf, remembering the path
    const path: Node[] = [];
    let n: Node = root;
    while (!n.leaf) {
      path.push(n);
      n = n.children[childIndex(n.keys, k)];
    }
    const leaf = n;
    const pos = childIndex(leaf.keys, k);
    leaf.keys.splice(pos, 0, k);
    const pathHl: Record<string, Tone> = {};
    path.forEach((p) => (pathHl[p.id] = 'path'));
    const depth = path.length + 1;

    if (leaf.keys.length <= m) {
      push({
        phase: 'insert',
        tree: snapshot(root),
        hl: { ...pathHl, [leaf.id]: 'new' },
        keyHl: { [`${leaf.id}:${k}`]: 'inserted' },
        caption:
          path.length === 0
            ? `Insert ${k}: it fits in the root leaf (${leaf.keys.length}/${m} keys), kept in sorted order.`
            : `Insert ${k}: descend ${depth - 1} internal level${depth - 1 > 1 ? 's' : ''} to the leaf [${list(leaf.keys.filter((x) => x !== k))}] and add it there (${leaf.keys.length}/${m} keys). No split.`,
      });
      continue;
    }

    // overflow frame
    const firstLeafSplit = !sawLeafSplit;
    const parentFull = path.length > 0 && path[path.length - 1].keys.length === m;
    const rootIsLeaf = path.length === 0;
    let predict: string | undefined;
    if (firstLeafSplit)
      predict = `The leaf now holds ${m + 1} keys, one more than the maximum ${m}. It must split in two. Which key goes up to the parent, and does it leave the leaf?`;
    else if (!sawInternalSplit && (rootIsLeaf || path.every((p) => p.keys.length === m)) && parentFull)
      predict = `This leaf split will add a separator to a parent that is already full (${m} keys). What happens to the parent, and to the tree's height?`;
    push({
      phase: 'overflow',
      tree: snapshot(root),
      hl: { ...pathHl, [leaf.id]: 'overflow' },
      keyHl: { [`${leaf.id}:${k}`]: 'inserted' },
      caption: `Insert ${k}: the leaf becomes [${list(leaf.keys)}], ${m + 1} keys > max ${m}: OVERFLOW.`,
      predict,
    });

    // split the leaf: left keeps ceil((m+1)/2), right gets the rest; the right's first key is COPIED up
    const splitAt = Math.ceil((m + 1) / 2);
    const right = mk(true);
    right.keys = leaf.keys.splice(splitAt);
    right.next = leaf.next;
    leaf.next = right;
    let sep = right.keys[0];
    const hl: Record<string, Tone> = { ...pathHl, [leaf.id]: 'split', [right.id]: 'split' };
    const keyHl: Record<string, KeyTone> = { [`${right.id}:${sep}`]: 'copied' };
    const notes: string[] = [
      `Leaf splits into [${list(leaf.keys)}] and [${list(right.keys)}], linked left→right. Separator ${sep} is COPIED up: it stays in the right leaf because every key must remain in a leaf.`,
    ];
    sawLeafSplit = true;

    // insert separator into parents, splitting internal nodes as needed (keys PUSHED up)
    let leftChild: Node = leaf;
    let rightChild: Node = right;
    let level = path.length - 1;
    let grew = false;
    for (;;) {
      if (level < 0) {
        const r = mk(false);
        r.keys = [sep];
        r.children = [leftChild, rightChild];
        root = r;
        hl[r.id] = 'new';
        keyHl[`${r.id}:${sep}`] = keyHl[`${r.id}:${sep}`] ?? (leftChild.leaf ? 'copied' : 'pushed');
        grew = true;
        break;
      }
      const p = path[level];
      const ci = p.children.indexOf(leftChild);
      p.keys.splice(ci, 0, sep);
      p.children.splice(ci + 1, 0, rightChild);
      keyHl[`${p.id}:${sep}`] = leftChild.leaf ? 'copied' : 'pushed';
      if (p.keys.length <= m) break;
      // internal overflow: middle key moves UP (it is not kept in either half)
      const mid = Math.floor((m + 1) / 2);
      const pr = mk(false);
      const up = p.keys[mid];
      pr.keys = p.keys.slice(mid + 1);
      pr.children = p.children.slice(mid + 1);
      p.keys = p.keys.slice(0, mid);
      p.children = p.children.slice(0, mid + 1);
      hl[p.id] = 'split';
      hl[pr.id] = 'split';
      const tone = keyHl[`${p.id}:${sep}`];
      delete keyHl[`${p.id}:${sep}`];
      if (sep !== up && tone) keyHl[`${p.keys.includes(sep) ? p.id : pr.id}:${sep}`] = tone;
      notes.push(`The parent overflowed too, so it splits into [${list(p.keys)}] and [${list(pr.keys)}] and ${up} is MOVED up (not copied): internal keys are only signposts, so it leaves this level.`);
      sawInternalSplit = true;
      sep = up;
      leftChild = p;
      rightChild = pr;
      level--;
    }
    if (grew) notes.push(`There was no parent left, so a new root [${sep}] is created: the tree grows at the TOP and is now height ${statsOf(snapshot(root)).height}; every leaf stays at the same depth.`);
    push({
      phase: 'split',
      tree: snapshot(root),
      hl,
      keyHl,
      caption: notes.join(' '),
    });
  }

  // ---- range scan on the B+ tree ----
  const final = root!;
  const st = statsOf(snapshot(final));
  const occupancy = (() => {
    let used = 0;
    let lv = 0;
    for (let l: Node | null = leftmost(final); l; l = l.next) {
      used += l.keys.length;
      lv++;
    }
    return Math.round((100 * used) / (lv * m));
  })();
  push({
    phase: 'done',
    tree: snapshot(final),
    hl: {},
    keyHl: {},
    caption: `All ${keys.length} keys inserted: height ${st.height}, ${st.nodes} nodes (${st.internal} internal, ${st.leaves} leaves). Leaves are ${occupancy}% full on average${
      keyOrder === 'sequential'
        ? `: ascending keys always split the RIGHTMOST leaf, and the left halves (${Math.ceil((m + 1) / 2)} of ${m} keys) are never filled again. Real engines spot this append pattern and split the rightmost page unevenly.`
        : '.'
    } Now run the range query ${RANGE_LO} ≤ k ≤ ${RANGE_HI}.`,
  });

  const descent: Node[] = [];
  let n: Node = final;
  while (!n.leaf) {
    descent.push(n);
    n = n.children[childIndex(n.keys, RANGE_LO)];
  }
  descent.push(n);
  const scanHl: Record<string, Tone> = {};
  descent.forEach((d, i) => {
    scanHl[d.id] = 'path';
    const last = i === descent.length - 1;
    push({
      phase: 'scan',
      tree: snapshot(final),
      hl: { ...scanHl, ...(last ? { [d.id]: 'scan' } : {}) },
      keyHl: {},
      caption: last
        ? `Level ${i + 1}: the leaf [${list(d.keys)}] is where ${RANGE_LO} lives. One root-to-leaf descent = ${descent.length} node reads, the tree height.`
        : `Level ${i + 1}: in [${list(d.keys)}], ${RANGE_LO} ${childIndex(d.keys, RANGE_LO) === 0 ? `< ${d.keys[0]}` : `≥ ${d.keys[childIndex(d.keys, RANGE_LO) - 1]}`}, so follow child #${childIndex(d.keys, RANGE_LO) + 1}.`,
      predict: last ? `The leaf holds the start of the range. How does the tree reach ${RANGE_LO + 5} … ${RANGE_HI} without going back up through the internal nodes?` : undefined,
    });
  });

  const found: number[] = [];
  let leafReads = 0;
  let prev: Node | null = null;
  for (let l: Node | null = n; l; l = l.next) {
    leafReads++;
    const kh: Record<string, KeyTone> = {};
    let stop = false;
    for (const x of l.keys) {
      if (x > RANGE_HI) {
        kh[`${l.id}:${x}`] = 'miss';
        stop = true;
        break;
      }
      if (x >= RANGE_LO) {
        found.push(x);
        kh[`${l.id}:${x}`] = 'hit';
      }
    }
    if (!stop && !l.next) stop = true;
    scanHl[l.id] = 'scan';
    push({
      phase: 'scan',
      tree: snapshot(final),
      hl: { ...scanHl },
      keyHl: kh,
      found: [...found],
      linkHl: prev ? prev.id : null,
      caption:
        (prev ? `Follow the sibling link to the next leaf [${list(l.keys)}]: ` : `Scan the leaf [${list(l.keys)}]: `) +
        (stop
          ? `${l.keys.some((x) => x > RANGE_HI) ? `${l.keys.find((x) => x > RANGE_HI)} > ${RANGE_HI}, so the scan stops.` : 'end of the leaf chain.'} Found ${found.length} keys (${list(found)}) with ${descent.length - 1} internal + ${leafReads} leaf reads.`
          : `collect ${l.keys.filter((x) => x >= RANGE_LO && x <= RANGE_HI).length} key(s). So far: ${list(found)}.`),
    });
    if (stop) break;
    prev = l;
  }
  const bplusReads = descent.length - 1 + leafReads;

  // ---- contrast: classic B-tree, in-order traversal ----
  const bt = buildBTree(keys, m);
  const visits: string[] = [];
  const bFound: number[] = [];
  const walk = (x: BNode) => {
    visits.push(x.id);
    let back = false; // returned from a child: the next key/child here needs a climb back up
    const touch = () => {
      if (back) visits.push(x.id);
      back = false;
    };
    for (let i = 0; i <= x.keys.length; i++) {
      // child i holds the keys strictly between keys[i-1] and keys[i]
      const lo = i === 0 ? -Infinity : x.keys[i - 1];
      const hi = i === x.keys.length ? Infinity : x.keys[i];
      if (x.children.length && hi > RANGE_LO && lo < RANGE_HI) {
        touch();
        walk(x.children[i]);
        back = true;
      }
      if (i < x.keys.length && x.keys[i] >= RANGE_LO && x.keys[i] <= RANGE_HI) {
        touch();
        bFound.push(x.keys[i]);
      }
    }
  };
  walk(bt);
  const distinct = new Set(visits);
  const bSnap = bsnap(bt);
  const bStats = statsOf(bSnap);
  const vh: Record<string, Tone> = {};
  distinct.forEach((id) => (vh[id] = 'visit'));
  const bkh: Record<string, KeyTone> = {};
  const markHits = (x: BNode) => {
    x.keys.forEach((kk) => {
      if (kk >= RANGE_LO && kk <= RANGE_HI) bkh[`${x.id}:${kk}`] = 'hit';
    });
    x.children.forEach(markHits);
  };
  markHits(bt);
  const internalHits = (() => {
    let c = 0;
    const f = (x: BNode) => {
      if (x.children.length) x.keys.forEach((kk) => kk >= RANGE_LO && kk <= RANGE_HI && c++);
      x.children.forEach(f);
    };
    f(bt);
    return c;
  })();
  const pathTxt = visits.map((id) => id.replace('B', 'n')).join('→');
  push({
    phase: 'btree',
    kind: 'btree',
    tree: bSnap,
    hl: {},
    keyHl: {},
    showLinks: false,
    caption: `Contrast: the same ${keys.length} keys in a classic B-tree (max ${m} keys/node). Each key is stored exactly once, ${internalHits > 0 ? `so ${internalHits} of the range's keys ${internalHits === 1 ? 'sits' : 'sit'} in INTERNAL nodes, ` : ''}and leaves have no sibling links. Height ${bStats.height}, ${bStats.nodes} nodes.`,
    predict: `With no leaf links and some keys stored in internal nodes, how does a B-tree return ${RANGE_LO}…${RANGE_HI} in order?`,
  });
  push({
    phase: 'btree',
    kind: 'btree',
    tree: bSnap,
    hl: vh,
    keyHl: bkh,
    found: [...bFound],
    showLinks: false,
    caption: `In-order traversal: ${pathTxt}: ${visits.length} node visits, ${visits.length - distinct.size} of them climbing BACK to a parent to read a key stored between two children (it needs a stack). The B+ tree used ${bplusReads} reads and only ever moved forward. Same ${bFound.length} keys.`,
  });
  push({
    phase: 'done',
    tree: snapshot(final),
    hl: scanHl,
    keyHl: {},
    found,
    caption: `Why databases use B+ trees: a range scan is one descent (${st.height} reads here) plus a forward walk of linked leaves, and because internal pages hold only keys, not rows, real pages fit hundreds of them, so even a billion rows needs just 3–4 levels.`,
  });
  return frames;
}

function leftmost(n: Node): Node {
  while (!n.leaf) n = n.children[0];
  return n;
}

// ---- classic B-tree (keys stored once; median moves up on split) ----
interface BNode {
  id: string;
  keys: number[];
  children: BNode[];
}

export function buildBTree(keys: number[], m: number): BNode {
  let s = 0;
  const mk = (): BNode => ({ id: `B${s++}`, keys: [], children: [] });
  let root = mk();
  for (const k of keys) {
    const path: BNode[] = [];
    let n = root;
    while (n.children.length) {
      path.push(n);
      n = n.children[childIndex(n.keys, k)];
    }
    n.keys.splice(childIndex(n.keys, k), 0, k);
    let cur = n;
    while (cur.keys.length > m) {
      const mid = Math.floor((m + 1) / 2);
      const r = mk();
      const up = cur.keys[mid];
      r.keys = cur.keys.slice(mid + 1);
      r.children = cur.children.slice(mid + 1);
      cur.keys = cur.keys.slice(0, mid);
      cur.children = cur.children.slice(0, cur.children.length ? mid + 1 : 0);
      const p = path.pop();
      if (!p) {
        const nr = mk();
        nr.keys = [up];
        nr.children = [cur, r];
        root = nr;
        break;
      }
      const ci = p.children.indexOf(cur);
      p.keys.splice(ci, 0, up);
      p.children.splice(ci + 1, 0, r);
      cur = p;
    }
  }
  return root;
}

function bsnap(n: BNode): SnapNode {
  return { id: n.id, leaf: n.children.length === 0, keys: [...n.keys], children: n.children.map(bsnap), next: null };
}
