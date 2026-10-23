// Pure, deterministic simulation of a toy Lucene-style inverted index.
// Story: analyse each document (lowercase → split → drop stop words → stem), append postings
// (term → [docId:tf]), then answer a query: analyse it, look up one posting list per term,
// intersect (AND) or union (OR) them, and score the candidates with BM25.
import type { BaseFrame } from '../../core';

export type Mode = 'and' | 'or';
export type QueryId = 'wh' | 'nce' | 'wired';

export interface Params {
  query: QueryId;
  mode: Mode;
  /** BM25 length-normalisation strength, 0..1 */
  b: number;
  /** BM25 term-frequency saturation */
  k1: number;
}

export const DOCS: string[] = [
  'Wireless noise cancelling headphones',
  'Wired headphones with mic',
  'Wireless earbuds',
  'Sony wireless headphones with wireless charging case and travel pouch',
  'Noise cancelling wireless earbuds for running',
];

export const QUERIES: Record<QueryId, string> = {
  wh: 'wireless headphones',
  nce: 'noise cancelling earbuds',
  wired: 'wired headphones',
};

export const STOP = new Set(['with', 'for', 'and', 'the', 'a', 'of']);
// a tiny, explicit stemmer (real analyzers use Porter / Snowball / KStem)
const STEMS: Record<string, string> = {
  cancelling: 'cancel',
  headphones: 'headphon',
  noise: 'nois',
  wired: 'wire',
  earbuds: 'earbud',
  charging: 'charg',
  running: 'run',
};

export interface Token {
  raw: string;
  term: string | null; // null = dropped stop word
}

export function analyze(text: string): Token[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((raw) => ({ raw, term: STOP.has(raw) ? null : (STEMS[raw] ?? raw) }));
}
export const terms = (text: string) => analyze(text).flatMap((t) => (t.term ? [t.term] : []));

export interface Posting {
  doc: number; // 1-based doc id
  tf: number;
}
export type Postings = Record<string, Posting[]>;

export function buildIndex(docs: string[]): { postings: Postings; lengths: number[] } {
  const postings: Postings = {};
  const lengths: number[] = [];
  docs.forEach((d, i) => {
    const ts = terms(d);
    lengths.push(ts.length);
    const tf = new Map<string, number>();
    for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) (postings[t] ??= []).push({ doc: i + 1, tf: n });
  });
  return { postings, lengths };
}

/** Lucene's BM25 IDF (never negative) */
export const idf = (N: number, n: number) => Math.log(1 + (N - n + 0.5) / (n + 0.5));

export function bm25Term(tf: number, dl: number, avgdl: number, N: number, n: number, k1: number, b: number) {
  return (idf(N, n) * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * dl) / avgdl));
}

/** two-pointer intersection of sorted docId lists (counts comparisons for the caption) */
export function intersect(a: number[], b: number[]): { out: number[]; steps: number } {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  let steps = 0;
  while (i < a.length && j < b.length) {
    steps++;
    if (a[i] === b[j]) {
      out.push(a[i]);
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return { out, steps };
}
export const union = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort((x, y) => x - y);

export interface TermScore {
  term: string;
  tf: number;
  idf: number;
  score: number;
}
export interface DocScore {
  doc: number;
  dl: number;
  parts: TermScore[];
  total: number;
}

export function score(params: Params): { candidates: number[]; ranked: DocScore[]; avgdl: number } {
  const { postings, lengths } = buildIndex(DOCS);
  const N = DOCS.length;
  const avgdl = lengths.reduce((s, x) => s + x, 0) / N;
  const qs = [...new Set(terms(QUERIES[params.query]))];
  const lists = qs.map((t) => (postings[t] ?? []).map((p) => p.doc));
  let candidates = lists[0] ?? [];
  for (const l of lists.slice(1)) candidates = params.mode === 'and' ? intersect(candidates, l).out : union(candidates, l);
  const ranked = candidates
    .map((doc) => {
      const dl = lengths[doc - 1];
      const parts = qs.flatMap((t) => {
        const p = (postings[t] ?? []).find((x) => x.doc === doc);
        if (!p) return [];
        const n = postings[t].length;
        return [{ term: t, tf: p.tf, idf: idf(N, n), score: bm25Term(p.tf, dl, avgdl, N, n, params.k1, params.b) }];
      });
      return { doc, dl, parts, total: parts.reduce((s, x) => s + x.score, 0) };
    })
    .sort((x, y) => y.total - x.total || x.doc - y.doc);
  return { candidates, ranked, avgdl };
}

export type Phase = 'docs' | 'index' | 'query' | 'lookup' | 'merge' | 'score' | 'rank';

export interface Frame extends BaseFrame {
  phase: Phase;
  /** docs indexed so far (1..5) */
  indexed: number;
  /** doc being analysed in this step (1-based), 0 = none */
  activeDoc: number;
  tokens: Token[];
  postings: Postings;
  /** terms touched in this step (new postings or looked-up lists) */
  hot: string[];
  queryTokens: Token[];
  /** current candidate docIds (after merge) */
  candidates: number[] | null;
  ranked: DocScore[] | null;
  avgdl: number;
}

const fmt = (x: number) => x.toFixed(2);

export function simulate(params: Params): Frame[] {
  const frames: Frame[] = [];
  const postings: Postings = {};
  const clone = (): Postings => Object.fromEntries(Object.entries(postings).map(([t, ps]) => [t, ps.map((p) => ({ ...p }))]));
  const base = { indexed: 0, activeDoc: 0, tokens: [], hot: [], queryTokens: [], candidates: null, ranked: null, avgdl: 0 };
  const push = (f: Partial<Frame> & { caption: string; phase: Phase }) => frames.push({ ...base, postings: clone(), ...f } as Frame);

  push({
    phase: 'docs',
    caption: `Five product titles. A database would answer "wireless headphones" with LIKE '%…%' and scan every row; a search engine builds a term → documents map once, at index time.`,
    predict: 'Doc 4 says "wireless" twice and is much longer than the others. Will that make it the best match?',
  });

  const lengths: number[] = [];
  DOCS.forEach((d, i) => {
    const toks = analyze(d);
    const ts = toks.flatMap((t) => (t.term ? [t.term] : []));
    lengths.push(ts.length);
    const tf = new Map<string, number>();
    for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
    const added: string[] = [];
    for (const [t, n] of tf) {
      if (!postings[t]) added.push(t);
      (postings[t] ??= []).push({ doc: i + 1, tf: n });
    }
    const dropped = toks.filter((t) => !t.term).map((t) => t.raw);
    const stemmed = toks.filter((t) => t.term && t.term !== t.raw).map((t) => `${t.raw}→${t.term}`);
    push({
      phase: 'index',
      indexed: i + 1,
      activeDoc: i + 1,
      tokens: toks,
      hot: [...tf.keys()],
      caption:
        `Doc ${i + 1}: lowercase and split into ${toks.length} tokens` +
        (dropped.length ? `, drop stop word${dropped.length > 1 ? 's' : ''} ${dropped.map((x) => `"${x}"`).join(', ')}` : '') +
        (stemmed.length ? `, stem ${stemmed.join(', ')}` : '') +
        `. Append doc ${i + 1} to ${tf.size} posting lists (${added.length} new term${added.length === 1 ? '' : 's'}).` +
        ([...tf.values()].some((n) => n > 1) ? ` "wireless" appears twice, so its posting stores tf = 2.` : ''),
    });
  });

  const N = DOCS.length;
  const avgdl = lengths.reduce((s, x) => s + x, 0) / N;
  const qText = QUERIES[params.query];
  const qToks = analyze(qText);
  const qs = [...new Set(qToks.flatMap((t) => (t.term ? [t.term] : [])))];
  push({
    phase: 'query',
    indexed: N,
    queryTokens: qToks,
    avgdl,
    caption: `Query "${qText}" goes through the SAME analyzer → terms ${qs.map((t) => `"${t}"`).join(', ')}. If the query were analysed differently from the documents, "headphones" would never meet "headphon".`,
  });
  const lists = qs.map((t) => (postings[t] ?? []).map((p) => p.doc));
  push({
    phase: 'lookup',
    indexed: N,
    queryTokens: qToks,
    hot: qs,
    avgdl,
    caption: `Look up one posting list per term: ${qs.map((t, k) => `${t} → {${lists[k].join(',')}}`).join(', ')}. Cost depends on how long these lists are, not on how many documents exist.`,
  });

  let cand = lists[0] ?? [];
  for (let k = 1; k < lists.length; k++) {
    const before = cand;
    let steps = 0;
    if (params.mode === 'and') {
      const r = intersect(cand, lists[k]);
      cand = r.out;
      steps = r.steps;
    } else cand = union(cand, lists[k]);
    push({
      phase: 'merge',
      indexed: N,
      queryTokens: qToks,
      hot: qs.slice(0, k + 1),
      candidates: cand,
      avgdl,
      caption:
        params.mode === 'and'
          ? `AND: walk both sorted lists with two pointers, {${before.join(',')}} ∩ {${lists[k].join(',')}} = {${cand.join(',')}} in ${steps} comparisons. Skip lists let Lucene leapfrog long runs.`
          : `OR: union {${before.join(',')}} ∪ {${lists[k].join(',')}} = {${cand.join(',')}}. Every doc with at least one term is a candidate; scoring decides the order.`,
    });
  }
  if (cand.length === 0) {
    push({ phase: 'rank', indexed: N, queryTokens: qToks, candidates: [], ranked: [], avgdl, caption: 'No document contains every term: zero results. Try OR mode.' });
    return frames;
  }

  const { ranked } = score(params);
  push({
    phase: 'score',
    indexed: N,
    queryTokens: qToks,
    hot: qs,
    candidates: cand,
    ranked: ranked.map((r) => ({ ...r })).sort((a, b) => a.doc - b.doc),
    avgdl,
    caption:
      `BM25 per term: IDF × tf·(k1+1) / (tf + k1·(1 − b + b·|d|/avgdl)), avgdl = ${fmt(avgdl)}. ` +
      qs.map((t) => `IDF(${t}) = ln(1 + (${N} − ${postings[t]?.length ?? 0} + 0.5)/(${postings[t]?.length ?? 0} + 0.5)) = ${fmt(idf(N, postings[t]?.length ?? 0))}`).join('; ') +
      '. Rare terms weigh more.',
  });
  const top = ranked[0];
  const d4 = params.query === 'wh' ? ranked.find((r) => r.doc === 4) : undefined;
  push({
    phase: 'rank',
    indexed: N,
    queryTokens: qToks,
    hot: qs,
    candidates: cand,
    ranked,
    avgdl,
    caption:
      `Ranked: ${ranked.map((r) => `doc ${r.doc} ${fmt(r.total)}`).join(' > ')}. ` +
      (d4
        ? d4.doc === top.doc
          ? `Doc 4 wins: with b = ${params.b} its length (${d4.dl} terms vs avg ${fmt(avgdl)}) is barely penalised, so tf = 2 counts.`
          : `Doc 4 says "wireless" twice, but tf saturates (k1 = ${params.k1.toFixed(1)}) and its ${d4.dl}-term length is normalised away (b = ${params.b}). Drag b to 0 to see length stop mattering.`
        : `The doc holding the rarest query terms in the fewest words wins: IDF makes rare terms dominate, and length normalisation favours short fields.`),
  });
  return frames;
}
