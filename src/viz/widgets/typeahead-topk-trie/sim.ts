// Pure model of a typeahead trie with cached top-k per node (no React, Node-testable).
//   Built offline from aggregated query counts. Each node stores the k most frequent completions in
//   its subtree, so a keystroke costs O(prefix length) to walk + O(1) to read the list, instead of a
//   traversal of the whole subtree. When counts change (a trending term), only the nodes on that
//   term's root-to-leaf path can have a different top-k list.
import type { BaseFrame } from '../../core';

export type Query = 'bea' | 'tre' | 'b';

export interface Params {
  query: Query;
  k: number;
}

export const DEFAULT_PARAMS: Params = { query: 'bea', k: 3 };

export const COUNTS: Record<string, number> = {
  beach: 40,
  bean: 25,
  bear: 30,
  beard: 12,
  bee: 18,
  beer: 55,
  best: 70,
  bet: 22,
  tea: 50,
  tree: 60,
  trend: 35,
  try: 28,
};

export const TRENDING: Record<'b' | 't', { word: string; plus: number }> = {
  b: { word: 'bean', plus: 60 },
  t: { word: 'trend', plus: 40 },
};

export interface TrieNode {
  prefix: string;
  children: string[];
  terminal: boolean;
  depth: number;
}

/** every prefix of every word, parent → children (sorted) */
export function buildTrie(words: string[]): Map<string, TrieNode> {
  const nodes = new Map<string, TrieNode>();
  nodes.set('', { prefix: '', children: [], terminal: false, depth: 0 });
  for (const w of [...words].sort()) {
    for (let i = 1; i <= w.length; i++) {
      const p = w.slice(0, i);
      if (!nodes.has(p)) {
        nodes.set(p, { prefix: p, children: [], terminal: false, depth: i });
        nodes.get(w.slice(0, i - 1))!.children.push(p);
      }
    }
    nodes.get(w)!.terminal = true;
  }
  return nodes;
}

export function subtree(nodes: Map<string, TrieNode>, prefix: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    out.push(p);
    for (const c of nodes.get(p)!.children) walk(c);
  };
  if (nodes.has(prefix)) walk(prefix);
  return out;
}

export function topK(nodes: Map<string, TrieNode>, counts: Record<string, number>, prefix: string, k: number): { word: string; count: number }[] {
  return subtree(nodes, prefix)
    .filter((p) => nodes.get(p)!.terminal)
    .map((w) => ({ word: w, count: counts[w] }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, k);
}

export interface Frame extends BaseFrame {
  typed: string;
  /** nodes visited on the walk */
  path: string[];
  /** subtree a cache-less lookup would scan */
  scan: string[];
  list: { word: string; count: number }[];
  counts: Record<string, number>;
  /** nodes whose cached list was rewritten in this step */
  rewritten: string[];
  trending: string | null;
}

export function simulate({ query, k }: Params): Frame[] {
  const nodes = buildTrie(Object.keys(COUNTS));
  let counts = { ...COUNTS };
  const frames: Frame[] = [];

  const snap = (typed: string, caption: string, extra: Partial<Pick<Frame, 'rewritten' | 'trending' | 'scan'>> = {}, predict?: string) => {
    const path = ['', ...Array.from({ length: typed.length }, (_, i) => typed.slice(0, i + 1))];
    frames.push({
      caption,
      predict,
      typed,
      path: typed ? path : [],
      scan: extra.scan ?? [],
      list: typed ? topK(nodes, counts, typed, k) : [],
      counts: { ...counts },
      rewritten: extra.rewritten ?? [],
      trending: extra.trending ?? null,
    });
  };

  snap(
    '',
    `The trie is built offline from weekly query counts (${Object.keys(COUNTS).length} queries, ${nodes.size} nodes). Every node caches its top ${k} completions with their counts, computed bottom-up at build time.`,
  );

  for (let i = 1; i <= query.length; i++) {
    const p = query.slice(0, i);
    const scan = subtree(nodes, p);
    const words = scan.filter((x) => nodes.get(x)!.terminal).length;
    const list = topK(nodes, counts, p, k);
    snap(
      p,
      `Keystroke "${p[p.length - 1]}": walk ${i} edge${i > 1 ? 's' : ''} from the root to node "${p}" and read its cached list: ${list.map((x) => `${x.word} (${x.count})`).join(', ')}. Without the cache we would scan ${scan.length} nodes and sort ${words} candidates on every keystroke.`,
      { scan },
      i === query.length ? `"${TRENDING[query[0] as 'b' | 't'].word}" is about to start trending. Which nodes' cached lists might change?` : undefined,
    );
  }

  const trend = TRENDING[query[0] as 'b' | 't'];
  const before = new Map<string, string>();
  for (const p of nodes.keys()) if (p) before.set(p, JSON.stringify(topK(nodes, counts, p, k)));
  counts = { ...counts, [trend.word]: counts[trend.word] + trend.plus };
  const rewritten = [...nodes.keys()].filter((p) => p && before.get(p) !== JSON.stringify(topK(nodes, counts, p, k)));
  const pathOfTrend = Array.from({ length: trend.word.length }, (_, i) => trend.word.slice(0, i + 1));
  snap(
    query,
    `"${trend.word}" trends: its count jumps from ${COUNTS[trend.word]} to ${counts[trend.word]}. The rebuild only needs to recompute lists on its path (${pathOfTrend.map((x) => `"${x}"`).join(' → ')}); ${rewritten.length} of those lists actually change (${rewritten.map((x) => `"${x}"`).join(', ') || 'none'}). Every other node is untouched.`,
    { rewritten, trending: trend.word, scan: subtree(nodes, query) },
  );

  const list = topK(nodes, counts, query, k);
  const changed = rewritten.includes(query);
  snap(
    query,
    `The next user typing "${query}" gets ${list.map((x) => `${x.word} (${x.count})`).join(', ')}${changed ? `, now including the trending term` : ', unchanged, because the trend did not alter this prefix\'s top ' + k}. Short prefixes like "${query[0]}" are also cached in browsers and at the CDN.`,
    { trending: trend.word, scan: subtree(nodes, query) },
  );
  return frames;
}
