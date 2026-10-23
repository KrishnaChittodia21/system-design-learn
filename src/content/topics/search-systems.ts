import type { Topic } from '../../types';

const topic: Topic = {
  id: 'search-systems',
  phase: 'platform',
  order: 1,
  title: 'Search Systems & Elasticsearch',
  subtitle:
    'Inverted indexes, analyzers, BM25 relevance, autocomplete, fuzzy matching, CDC indexing pipelines, zero-downtime reindexing and cluster sizing.',
  estimatedMinutes: 120,
  sources: [
    'Elasticsearch Reference (8.x) — mapping, analysis, similarity, search_after, aliases',
    'Lucene / BM25: Robertson & Zaragoza — The Probabilistic Relevance Framework',
  ],
  tags: ['elasticsearch', 'opensearch', 'lucene', 'inverted-index', 'bm25', 'autocomplete', 'fuzzy', 'cdc', 'relevance'],
  cheatSheet: [
    'Inverted index = term → sorted postings list (docId, freq, positions); queries intersect/union postings, so cost scales with matching docs, not table size.',
    'Analyzer = char filters → tokenizer → token filters (lowercase, stop, stemmer, synonyms); the SAME analysis must run at index and query time or matches silently fail.',
    'text = analyzed for full-text relevance; keyword = exact value for filters, aggregations, sorting. Use multi-fields (title + title.raw) when you need both.',
    'BM25 (ES default since 5.0): IDF × saturating TF (k1=1.2) × length normalisation (b=0.75). Rare terms matter, the 10th occurrence of a term barely does.',
    'Filters (bool.filter) do not score and are cached; put every yes/no condition there, keep must/should for relevance.',
    'Autocomplete: edge n-grams at index time (flexible, bigger index) vs completion suggester (in-memory FST, <10ms, prefix only) vs precomputed trie with top-k at each node.',
    'fuzziness AUTO = 0 edits for 1–2 chars, 1 for 3–5, 2 for >5; set prefix_length 1–2 and max_expansions to keep fuzzy cheap.',
    'Near-real-time: docs become searchable after refresh (default 1s); refresh=true per write kills indexing throughput. Use bulk (5–15 MB batches) and refresh_interval 30s/-1 for backfills.',
    'Never mutate a live index mapping: reindex into products_v2, then atomically swap the alias; primary shard count is fixed at creation (split/shrink only).',
    'Shard size 10–50 GB, heap ≤ 50% RAM and < ~31 GB; deep pages via search_after + PIT, never from+size past index.max_result_window (10,000).',
  ],
  sections: [
    {
      heading: 'Why your database is not a search engine',
      body: `**Intuition:** a B-tree index is a phone book sorted by surname — great if you know how the value *starts*. Search users type fragments, misspellings and synonyms in any order, and expect the *best* results first. That needs a different data structure and a scoring model.

**What breaks in Postgres/MySQL:**
- \`WHERE title ILIKE '%wireless headphone%'\` cannot use a B-tree (leading wildcard) → sequential scan. On 50M rows that is seconds of CPU per query, and 200 QPS melts the primary.
- No relevance: rows come back in arbitrary order; \`ORDER BY\` on a computed score still scans everything.
- No linguistics: "headphones" ≠ "headphone", "running" ≠ "run", "tv" ≠ "television", "iphnoe" matches nothing.
- Facets (brand counts, price buckets) on every query turn into expensive GROUP BYs on the OLTP primary.

**Middle ground before adding a cluster:** Postgres \`tsvector\` + GIN index gives stemming and \`ts_rank\`, and \`pg_trgm\` gives fuzzy/substring matching. It is genuinely good up to a few million rows and modest QPS, and it keeps one source of truth. Move to Elasticsearch/OpenSearch when you need BM25-quality relevance tuning, heavy faceting, autocomplete at high QPS, horizontal scaling of search independently of writes, or tens of millions of documents.

| Need | Postgres FTS / pg_trgm | Elasticsearch / OpenSearch |
|---|---|---|
| < 5M docs, low QPS | Good, zero extra infra | Overkill |
| Relevance tuning, boosts, synonyms | Limited | First-class |
| Facets/aggregations at scale | Expensive on OLTP | Columnar doc values, fast |
| Horizontal scale of reads | Read replicas | Shards + replicas |
| Consistency with writes | Transactional | Eventually consistent (~1s+) |

**Interview line:** "The database stays the system of record; the search index is a *derived, eventually consistent read model* fed from it. I design the sync pipeline and the reindex story on day one."`,
      code: [
        {
          language: 'sql',
          title: 'Postgres full-text + trigram: the "before Elasticsearch" option',
          code: `-- Generated tsvector column with weights: title matters more than description
ALTER TABLE products ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX products_search_gin ON products USING gin (search_vec);

-- Trigram index for fuzzy / substring matching on titles
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX products_title_trgm ON products USING gin (title gin_trgm_ops);

-- Stemmed, ranked query ("headphones" matches "headphone")
SELECT id, title, ts_rank(search_vec, q) AS score
FROM products, websearch_to_tsquery('english', 'wireless headphones') q
WHERE search_vec @@ q
ORDER BY score DESC
LIMIT 20;

-- Typo tolerance: similarity() uses trigram overlap (0..1)
SELECT id, title FROM products
WHERE title % 'hedphones'          -- % uses pg_trgm.similarity_threshold (0.3)
ORDER BY similarity(title, 'hedphones') DESC
LIMIT 10;`,
        },
      ],
      keyPoints: [
        'Leading-wildcard LIKE = full scan; no relevance, no linguistics.',
        'Postgres tsvector/GIN + pg_trgm is a legitimate first step for small corpora.',
        'The search index is a derived read model — design sync and rebuild from day one.',
      ],
    },
    {
      heading: 'The inverted index — build one yourself',
      body: `**Intuition:** the index at the back of a textbook. Instead of "page → words", you store "word → pages". To answer "wireless AND headphones" you look up two short lists and intersect them.

**Mechanics (what Lucene actually stores per field):**
- **Term dictionary**: every distinct term, sorted, with an FST (finite state transducer) prefix index in memory so lookups are O(term length).
- **Postings list** per term: sorted docIds (delta + bit-packed compressed), term frequency, and optionally positions/offsets (needed for phrase queries and highlighting).
- **Doc values**: a column store per field (docId → value) for sorting, aggregations and scripts — the "reverse" of postings.
- **Segments**: Lucene writes immutable segments. Updates are delete-marker + new document; background merges reclaim deleted docs. Immutability is why caching is easy and why updates are relatively expensive.

**Query evaluation:** AND = intersection of sorted lists (skip lists let you leapfrog), OR = union; the scorer only touches documents that contain at least one query term. Cost ∝ size of postings touched, not corpus size. Top-k uses a heap plus optimisations like WAND/block-max WAND (Lucene 8+) that skip blocks that cannot enter the top k — which is why ES reports \`track_total_hits\` only up to 10,000 by default.

The code below is a faithful toy: analysis, postings with frequencies and positions, AND intersection, and BM25 scoring.`,
      diagram: `Docs:  1 "Wireless noise cancelling headphones"
       2 "Wired headphones"
       3 "Wireless earbuds"

Term dictionary       Postings (docId:tf:[positions])
-------------------   --------------------------------
cancel            ->  1:1:[2]
earbud            ->  3:1:[1]
headphon          ->  1:1:[3]  2:1:[1]
nois              ->  1:1:[1]
wire              ->  2:1:[0]
wireless          ->  1:1:[0]  3:1:[0]

"wireless headphones" (AND) -> {1,3} ∩ {1,2} = {1}`,
      code: [
        {
          language: 'typescript',
          title: 'A minimal inverted index with positions and AND queries',
          code: `type Posting = { docId: number; tf: number; positions: number[] };

const STOP = new Set(['a', 'an', 'the', 'and', 'of', 'for']);

// Toy analyzer: lowercase, split on non-alphanumerics, drop stop words, crude stem
export function analyze(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOP.has(t))
    .map((t) => t.replace(/(ing|es|s)$/, '')); // real systems use Porter/Snowball
}

export class InvertedIndex {
  private postings = new Map<string, Posting[]>(); // term -> postings sorted by docId
  readonly docLengths = new Map<number, number>();

  add(docId: number, text: string): void {
    const tokens = analyze(text);
    this.docLengths.set(docId, tokens.length);
    const perDoc = new Map<string, number[]>();
    tokens.forEach((t, pos) => perDoc.set(t, [...(perDoc.get(t) ?? []), pos]));
    for (const [term, positions] of perDoc) {
      const list = this.postings.get(term) ?? [];
      list.push({ docId, tf: positions.length, positions }); // docIds added in order
      this.postings.set(term, list);
    }
  }

  get(term: string): Posting[] {
    return this.postings.get(term) ?? [];
  }

  // AND query: intersect postings, starting from the shortest list
  searchAll(query: string): number[] {
    const lists = analyze(query).map((t) => this.get(t)).sort((a, b) => a.length - b.length);
    if (lists.length === 0 || lists[0].length === 0) return [];
    let result = lists[0].map((p) => p.docId);
    for (const list of lists.slice(1)) {
      const ids = new Set(list.map((p) => p.docId)); // real engines merge sorted lists
      result = result.filter((id) => ids.has(id));
    }
    return result;
  }
}`,
        },
      ],
      keyPoints: [
        'Postings are sorted, compressed docId lists; intersection starts with the rarest term.',
        'Segments are immutable: an update is delete + reinsert, merges clean up later.',
        'Doc values (columnar) power sort/aggs; postings power matching.',
      ],
      source: 'Lucene file format documentation; Elasticsearch Reference — Near real-time search',
    },
    {
      heading: 'Analysis: tokenizers, filters, stemming and synonyms',
      body: `**Intuition:** analysis decides what "the same word" means. If the index stores \`headphon\` and the query produces \`headphones\`, nothing matches — no error, just empty results.

**Pipeline:** \`char_filter\` (strip HTML, map characters) → \`tokenizer\` (standard = Unicode word boundaries; whitespace; keyword = whole string; ngram/edge_ngram) → \`token filters\` (lowercase, asciifolding "café"→"cafe", stop words, stemmer, synonym_graph, word_delimiter_graph "iPhone15"→"iphone","15").

**Stemming vs lemmatisation:** stemmers (Porter, Snowball, the lighter \`kstem\`/\`light_english\`) chop suffixes algorithmically — fast but can over-stem ("university"/"universe" → "univers"). Lemmatisers use dictionaries. For product search prefer a *light* stemmer; aggressive stemming hurts precision on SKUs and brand names.

**Synonyms:** apply at **query time** with \`synonym_graph\` using an updatable synonym set (ES 8.10+ has a synonyms API; before that, a reloadable file + \`_reload_search_analyzers\`). Query-time synonyms can change without reindexing and handle multi-word synonyms ("tv" ⇄ "television", "ny" ⇄ "new york") correctly. Index-time synonyms bloat the index and require a full reindex for every change.

**Different analyzers per path:** \`analyzer\` (index) vs \`search_analyzer\` (query). Autocomplete is the classic case — edge n-grams at index time, plain standard analyzer at query time, otherwise the query "hea" is itself n-grammed into "h","he","hea" and matches everything starting with "h".

**Debug with \`_analyze\`:** the first thing to do when "search doesn't find X" is run both the document text and the query through \`POST /index/_analyze\` and compare tokens.`,
      code: [
        {
          language: 'json',
          title: 'Index settings: custom analyzers for products (PUT /products_v1)',
          code: `{
  "settings": {
    "number_of_shards": 6,
    "number_of_replicas": 1,
    "analysis": {
      "filter": {
        "english_light": { "type": "stemmer", "language": "light_english" },
        "product_synonyms": {
          "type": "synonym_graph",
          "synonyms_set": "product-synonyms",
          "updateable": true
        },
        "autocomplete_edge": { "type": "edge_ngram", "min_gram": 2, "max_gram": 15 }
      },
      "analyzer": {
        "product_index": {
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "english_light"]
        },
        "product_search": {
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "product_synonyms", "english_light"]
        },
        "autocomplete_index": {
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "autocomplete_edge"]
        }
      }
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Mismatched index/query analysis is the #1 cause of "search returns nothing".',
        'Synonyms at query time (synonym_graph, updateable) — no reindex to change them.',
        'Use _analyze to compare document tokens vs query tokens.',
      ],
      source: 'Elasticsearch Reference — Text analysis, synonym_graph token filter',
    },
    {
      heading: 'Mapping design: full-text vs keyword, multi-fields and filters',
      body: `**Intuition:** \`text\` fields are for "does this *talk about* X, and how much"; \`keyword\` fields are for "is this *exactly* X". Mixing them up gives either zero results (term query on analyzed text) or garbage facets (aggregating a tokenised field).

| | text | keyword |
|---|---|---|
| Analyzed | Yes (tokens) | No (one exact term, optional normalizer) |
| Queries | match, multi_match, match_phrase | term, terms, prefix, range |
| Scoring | BM25 relevance | Usually filter context (no score) |
| Sort / aggregations | No (fielddata is a heap bomb) | Yes, via doc values |
| Examples | title, description, reviews | sku, brand, status, tenant_id, tags |

**Multi-fields** index the same source value twice: \`title\` as text for matching, \`title.raw\` as keyword for sorting/exact match, \`title.autocomplete\` with edge n-grams.

**Query vs filter context:** inside \`bool.filter\` / \`must_not\` clauses Elasticsearch computes no score and can cache the resulting bitset per segment. Put tenant, status, price range, category in filters; only user text goes in \`must\`/\`should\`. This is both faster and gives cleaner relevance.

**Mapping hygiene in production:**
- \`"dynamic": "strict"\` so a rogue field (e.g. a user-supplied JSON map) cannot create thousands of fields — *mapping explosion* bloats cluster state and can take the master down (\`index.mapping.total_fields.limit\` defaults to 1000).
- Disable \`_source\` fields you never return? Usually no — you need \`_source\` to reindex. Prefer \`"index": false\` on fields you store but never query.
- \`nested\` type only when you must correlate fields inside array objects (e.g. variant color=red AND size=M); each nested object is a hidden Lucene doc and costs at query time.`,
      code: [
        {
          language: 'json',
          title: 'Mappings: text + keyword multi-fields, strict dynamic',
          code: `{
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "tenant_id":  { "type": "keyword" },
      "sku":        { "type": "keyword" },
      "title": {
        "type": "text",
        "analyzer": "product_index",
        "search_analyzer": "product_search",
        "fields": {
          "raw":          { "type": "keyword", "ignore_above": 256 },
          "autocomplete": { "type": "text", "analyzer": "autocomplete_index", "search_analyzer": "standard" }
        }
      },
      "description":  { "type": "text", "analyzer": "product_index", "search_analyzer": "product_search" },
      "brand":        { "type": "keyword" },
      "category_ids": { "type": "keyword" },
      "price":        { "type": "scaled_float", "scaling_factor": 100 },
      "in_stock":     { "type": "boolean" },
      "popularity":   { "type": "rank_feature" },
      "updated_at":   { "type": "date" },
      "internal_notes": { "type": "text", "index": false }
    }
  }
}`,
        },
      ],
      keyPoints: [
        'term query on a text field compares against analyzed tokens — usually wrong.',
        'Filters: no scoring + bitset caching; relevance only for user text.',
        'dynamic: strict prevents mapping explosion.',
      ],
    },
    {
      heading: 'Relevance: BM25 and how to tune ranking',
      body: `**Intuition:** a document is relevant if it contains the query's *rare* words, contains them *a few* times (but ten times is not ten times better), and is not an enormous document that mentions everything.

**BM25 per query term t in document d:**

score(t,d) = IDF(t) × tf × (k1 + 1) / (tf + k1 × (1 − b + b × |d| / avgdl))

- **IDF(t)** = ln(1 + (N − n + 0.5) / (n + 0.5)) where N = docs in the shard, n = docs containing t. "the" → ≈0, "noise-cancelling" → high.
- **k1 = 1.2** controls TF saturation: going from tf 1→2 helps a lot, 10→11 almost nothing (unlike classic TF-IDF, which grows without bound and rewards keyword stuffing).
- **b = 0.75** controls length normalisation: b=0 ignores length; b=1 fully normalises. For short fields like titles people sometimes lower b.
- Scores are summed over query terms (and multiplied by field boosts).

**Gotcha — IDF is per shard.** With few documents or skewed routing, the same doc gets different scores on different shards. \`search_type=dfs_query_then_fetch\` computes global term stats first (one extra round trip); with large, evenly distributed shards it rarely matters.

**Tuning toolbox (in order of preference):**
1. Fix analysis and field choice first (most "relevance bugs" are analysis bugs).
2. Field boosts in \`multi_match\` (\`title^3\`, \`brand^2\`, \`description\`), \`best_fields\` vs \`cross_fields\` (terms spread across fields, e.g. "sony headphones" = brand + title).
3. \`match_phrase\` in a \`should\` clause to reward proximity.
4. Business signals: \`rank_feature\` (popularity, rating) or \`function_score\` (recency decay, in-stock boost). Keep them bounded (log/saturation) so a viral item cannot outrank an exact match.
5. Learning-to-rank (LTR plugin, or rerank top 100 with an ML model / vector similarity) once you have click data.

**Measure, don't guess:** build a judgement list (query → graded relevant docs) and track NDCG@10 / MRR offline with the \`_rank_eval\` API, then A/B test online on click-through rate, zero-result rate, and conversion. Zero-result rate is the cheapest, loudest signal.`,
      code: [
        {
          language: 'typescript',
          title: 'BM25 over the toy inverted index',
          code: `import { InvertedIndex, analyze } from './inverted-index';

const K1 = 1.2;
const B = 0.75;

export function bm25(index: InvertedIndex, query: string, topK = 10) {
  const N = index.docLengths.size;
  let total = 0;
  index.docLengths.forEach((len) => (total += len));
  const avgdl = total / Math.max(N, 1);

  const scores = new Map<number, number>();
  for (const term of new Set(analyze(query))) {
    const postings = index.get(term);
    const n = postings.length;
    if (n === 0) continue;
    // Lucene's IDF: never negative, even for terms in > half the docs
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    for (const { docId, tf } of postings) {
      const dl = index.docLengths.get(docId) ?? avgdl;
      const norm = tf + K1 * (1 - B + (B * dl) / avgdl); // length normalisation
      const s = (idf * (tf * (K1 + 1))) / norm;             // saturating TF
      scores.set(docId, (scores.get(docId) ?? 0) + s);      // OR semantics: sum per term
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([docId, score]) => ({ docId, score: Number(score.toFixed(4)) }));
}`,
        },
        {
          language: 'json',
          title: 'A tuned product query: filters + boosts + phrase + bounded popularity',
          code: `{
  "size": 20,
  "timeout": "300ms",
  "query": {
    "bool": {
      "filter": [
        { "term": { "tenant_id": "t_42" } },
        { "term": { "in_stock": true } },
        { "range": { "price": { "lte": 200 } } }
      ],
      "must": {
        "multi_match": {
          "query": "sony wireless headphones",
          "type": "cross_fields",
          "fields": ["title^3", "brand^2", "description"],
          "operator": "and"
        }
      },
      "should": [
        { "match_phrase": { "title": { "query": "sony wireless headphones", "slop": 2, "boost": 2 } } },
        { "rank_feature": { "field": "popularity", "saturation": { "pivot": 1000 } } }
      ]
    }
  }
}`,
        },
      ],
      keyPoints: [
        'BM25: IDF × saturating TF × length norm; defaults k1=1.2, b=0.75.',
        'IDF is computed per shard — dfs_query_then_fetch fixes small-index skew.',
        'Measure with judgement lists (NDCG@10) and online CTR / zero-result rate.',
      ],
      source: 'Robertson & Zaragoza (2009); Elasticsearch Reference — Similarity module, rank_feature',
    },
    {
      heading: 'Autocomplete: edge n-grams, completion suggester, and a top-k trie',
      body: `**Intuition:** autocomplete is a *prefix* problem with a brutal latency budget — a keystroke every ~100–150 ms, so p99 must be well under 50 ms end to end, and the client should debounce (~100 ms) and cancel stale requests.

**Three designs:**

| Approach | How | Latency | Flexibility | Cost |
|---|---|---|---|---|
| Edge n-grams (or \`search_as_you_type\` field) | Index "headphones" as he, hea, head… ; query with standard analyzer | 5–30 ms | Full query DSL: filters, fuzzy, infix via word-level grams, BM25 + boosts | Index 3–10× larger for that field |
| Completion suggester | In-memory FST per segment of weighted inputs | 1–5 ms | Prefix only (plus fuzzy & contexts); no arbitrary filters; deleted docs linger until merges | Heap/off-heap memory |
| Precomputed trie with top-k per node (query log based) | Offline job aggregates query log → trie; each node caches its k best completions | < 1 ms in-process / Redis | Suggests *queries people type*, not documents | Rebuild pipeline; staleness hours |

**The top-k trie** is what Google-style query suggestion uses: store the top k (e.g. 5–10) completions *at every node*, so a lookup is O(prefix length) and needs no subtree traversal. Build it offline (hourly/daily) from aggregated query frequencies, shard by prefix range, serve from memory or Redis, and cache prefix responses in the browser/CDN (short TTL). Trending queries are merged from a small real-time layer.

**Filter the suggestions**: blocklist offensive/PII queries, and only suggest queries that return results.`,
      code: [
        {
          language: 'typescript',
          title: 'Trie with cached top-k completions at each node',
          code: `type Suggestion = { query: string; freq: number };

class TrieNode {
  children = new Map<string, TrieNode>();
  topK: Suggestion[] = []; // best completions for this prefix, sorted desc
}

export class AutocompleteTrie {
  private root = new TrieNode();
  constructor(private readonly k = 5) {}

  // Build-time insert: O(L * k) per query, done offline from aggregated logs
  insert(query: string, freq: number): void {
    const q = query.toLowerCase().trim();
    let node = this.root;
    this.offer(node, q, freq);
    for (const ch of q) {
      let next = node.children.get(ch);
      if (!next) {
        next = new TrieNode();
        node.children.set(ch, next);
      }
      node = next;
      this.offer(node, q, freq); // every prefix node remembers its best completions
    }
  }

  // Serve-time lookup: O(prefix length), no subtree walk
  suggest(prefix: string): string[] {
    let node: TrieNode | undefined = this.root;
    for (const ch of prefix.toLowerCase()) {
      node = node.children.get(ch);
      if (!node) return [];
    }
    return node.topK.map((s) => s.query);
  }

  private offer(node: TrieNode, query: string, freq: number): void {
    const existing = node.topK.find((s) => s.query === query);
    if (existing) existing.freq = Math.max(existing.freq, freq);
    else node.topK.push({ query, freq });
    node.topK.sort((a, b) => b.freq - a.freq);
    if (node.topK.length > this.k) node.topK.length = this.k; // keep only k
  }
}`,
        },
        {
          language: 'json',
          title: 'Completion suggester query with fuzziness',
          code: `{
  "_source": ["title", "sku"],
  "suggest": {
    "product-suggest": {
      "prefix": "wirles hea",
      "completion": {
        "field": "suggest",
        "size": 8,
        "skip_duplicates": true,
        "fuzzy": { "fuzziness": 1, "prefix_length": 2 },
        "contexts": { "tenant": ["t_42"] }
      }
    }
  }
}`,
        },
      ],
      keyPoints: [
        'Debounce + cancel on the client; p99 budget < 50 ms.',
        'Edge n-grams for document typeahead with filters; completion suggester for pure speed.',
        'Query suggestion = offline top-k trie from query logs, cached at every node.',
      ],
      source: 'Elasticsearch Reference — Completion suggester',
    },
    {
      heading: 'Fuzzy search: Levenshtein distance and making it cheap',
      body: `**Intuition:** "iphnoe" is two keystrokes away from "iphone". Fuzzy search matches terms within a small *edit distance* (insert, delete, substitute; Damerau adds transposition).

**How Lucene does it efficiently:** it does not compute distance against every term. It builds a **Levenshtein automaton** for the query term (max 2 edits) and intersects it with the term dictionary FST, enumerating only terms that can match. Then it runs a normal OR over those expanded terms.

**Knobs that matter:**
- \`fuzziness: "AUTO"\` → 0 edits for terms of 1–2 chars, 1 edit for 3–5, 2 edits for > 5 chars. Max is 2 — beyond that, precision collapses.
- \`prefix_length\` (default 0): number of leading chars that must match exactly. Setting 1–2 massively reduces candidate terms (users rarely misspell the first letter).
- \`max_expansions\` (default 50): cap on expanded terms per query term.
- \`transpositions\` (default true): "teh" → "the" counts as 1 edit.

**Production pattern:** run the exact/stemmed query first; if it returns few results (or zero), fall back to fuzzy, or add fuzzy as a lower-boosted \`should\` clause so exact matches outrank fuzzy ones. For "Did you mean…?", use the \`phrase\` suggester (n-gram language model over a shingle field). Fuzzy does not solve phonetic errors ("fone") — add a phonetic analyzer or synonyms — and does not fix word-boundary errors ("head phones") — use shingles or \`word_delimiter_graph\`.`,
      code: [
        {
          language: 'typescript',
          title: 'Levenshtein distance with early exit (the idea behind fuzziness)',
          code: `// Classic DP with two rows: O(m*n) time, O(n) memory.
// maxEdits lets us bail out early, like a bounded automaton would.
export function levenshtein(a: string, b: string, maxEdits = 2): number {
  if (Math.abs(a.length - b.length) > maxEdits) return maxEdits + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxEdits) return maxEdits + 1; // no path can come back under the bound
    prev = curr;
  }
  return prev[b.length];
}

// Elasticsearch equivalent: exact matches score higher than fuzzy ones
export const fuzzyQuery = (q: string) => ({
  bool: {
    should: [
      { match: { title: { query: q, boost: 3 } } },
      { match: { title: { query: q, fuzziness: 'AUTO', prefix_length: 1, max_expansions: 20 } } },
    ],
    minimum_should_match: 1,
  },
});`,
        },
      ],
      keyPoints: [
        'AUTO fuzziness: 0/1/2 edits by term length; hard max of 2.',
        'prefix_length 1–2 and low max_expansions keep fuzzy cheap.',
        'Boost exact above fuzzy; fuzzy does not fix phonetics or word splits.',
      ],
      source: 'Elasticsearch Reference — Fuzzy query, fuzziness parameter',
    },
    {
      heading: 'The indexing pipeline: CDC → Kafka → indexer, and near-real-time refresh',
      body: `**Intuition:** the search index is a cache of your database shaped for reading. Like any cache, the hard part is keeping it in sync without losing or reordering updates.

**Why not dual-write** (\`await db.save(); await es.index()\` in the request)? The two writes are not atomic: the ES call fails or the process dies between them → permanent drift. Concurrent requests can also land in ES in the opposite order to the DB commit → the older version wins.

**Reliable pipeline:**
1. **Capture**: Debezium reads the Postgres WAL (logical replication) or MySQL binlog — or the app writes a transactional **outbox** row. Every committed change is captured exactly in commit order.
2. **Transport**: Kafka topic keyed by entity id → all changes for a product land in one partition, in order. Retention of days lets you replay.
3. **Enrich/denormalise**: search docs are denormalised (product + brand name + category path + stock). The indexer fetches joins or consumes several topics and builds the document. This is where most complexity hides — a brand rename fans out to thousands of product docs.
4. **Load**: bulk API, 5–15 MB / 1–5K docs per request; use \`version_type: external\` with a monotonic version (WAL LSN or row version) so out-of-order or replayed events are rejected (409) instead of overwriting newer data.
5. **Handle partial failure**: bulk returns per-item status; retry 429/5xx items with backoff, send mapping errors (400) to a DLQ, commit Kafka offsets only after the batch succeeds (at-least-once + idempotent versioned writes = effectively once).

**Near-real-time (NRT):** an indexed doc goes to an in-memory buffer + translog (durability). A **refresh** (default every 1 s; if refresh_interval is left unset, shards idle for 30 s skip refresh until the next search) writes a new searchable segment to the filesystem cache. A **flush** fsyncs segments and trims the translog. Therefore "indexed" ≠ "searchable": end-to-end lag = CDC lag + Kafka lag + indexer batch time + refresh interval, typically 1–5 s.

**Throughput knobs:** \`refresh_interval: 30s\` (or \`-1\` during backfill), \`number_of_replicas: 0\` during initial load then restore, avoid \`refresh=true\` per request (use \`refresh=wait_for\` only where a user must read their own write), and let ES auto-generate ids for append-only data (skips the version lookup).`,
      diagram: `+----------+  WAL   +----------+  topic:products  +-----------+  _bulk  +------+
| Postgres |------->| Debezium |---- (key=id) --->|  Indexer  |-------->|  ES  |
|  (SoR)   |        | Connect  |    partitions    | consumers |         |alias |
+----------+        +----------+       |          +-----------+         +------+
     ^                                 |            |      |
     | enrich lookups (brand, stock)   |            |      +--> DLQ (400s)
     +---------------------------------+------------+
                     replay from offset for rebuilds / new index versions

lag = CDC (~100ms) + Kafka (~10ms) + batch (~500ms) + refresh (1s) ≈ 1–3 s`,
      code: [
        {
          language: 'typescript',
          title: 'kafkajs indexer: bulk, external versioning, per-item failure handling',
          code: `import { Kafka } from 'kafkajs';
import { Client } from '@elastic/elasticsearch';

const es = new Client({ node: process.env.ES_URL, requestTimeout: 30_000 });
const kafka = new Kafka({ clientId: 'search-indexer', brokers: [process.env.KAFKA_BROKER!] });
const consumer = kafka.consumer({ groupId: 'search-indexer-products-v3' });

type ProductEvent = { op: 'upsert' | 'delete'; id: string; version: number; doc?: object };

export async function run(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: 'products.cdc', fromBeginning: false });
  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
      const events = batch.messages.map((m) => JSON.parse(m.value!.toString()) as ProductEvent);
      const operations = events.flatMap((e) =>
        e.op === 'delete'
          ? [{ delete: { _index: 'products', _id: e.id, version: e.version, version_type: 'external' as const } }]
          : [
              { index: { _index: 'products', _id: e.id, version: e.version, version_type: 'external' as const } },
              e.doc!,
            ],
      );
      const res = await es.bulk({ operations, timeout: '30s' });
      if (res.errors) {
        const retryable = res.items.filter((it) => {
          const status = Object.values(it)[0]!.status;
          // 409 = we already have a newer version: safe to ignore (idempotent replay)
          return status === 429 || status >= 500;
        });
        if (retryable.length > 0) throw new Error('retryable bulk failures: ' + retryable.length);
        // 400-class mapping errors would be published to a DLQ topic here
      }
      resolveOffset(batch.messages[batch.messages.length - 1].offset); // commit only after success
      await heartbeat();
    },
  });
}`,
        },
      ],
      keyPoints: [
        'Never dual-write from the request path; use CDC or a transactional outbox.',
        'Kafka key = entity id for per-entity ordering; external versions reject stale writes.',
        'Searchable only after refresh (1 s default); lag is the sum of every hop.',
      ],
      source: 'Elasticsearch Reference — Near real-time search, Bulk API, Tune for indexing speed',
    },
    {
      heading: 'Zero-downtime reindexing with aliases',
      body: `**Intuition:** you cannot rebuild the plane in flight, but you can build a second plane and move passengers atomically. Clients always talk to the **alias** \`products\`, never to \`products_v3\`.

**When you must reindex:** changing an analyzer or field type, changing primary shard count (beyond split/shrink factors), fixing a denormalisation bug. Adding a *new* field can often be done in place with \`PUT _mapping\` plus \`_update_by_query\`.

**The playbook:**
1. Create \`products_v4\` with new settings/mappings, \`refresh_interval: -1\`, \`number_of_replicas: 0\`.
2. Record the current CDC offset (or start a second consumer group at "now") **before** the backfill.
3. Backfill: \`_reindex\` from v3 (if \`_source\` is complete and only analysis changed — can be sliced for parallelism) or a bulk export from the database / snapshot.
4. Catch up: replay CDC from the recorded offset into v4 while v3 keeps serving; external versions make overlap harmless.
5. Restore replicas and refresh, run validation — doc counts, sample queries, NDCG on the judgement list, shadow traffic comparison.
6. **Atomic alias swap** (single \`_aliases\` call with remove + add). Rollback = swap back.
7. Keep v3 for a few days, then delete it.

Point writes at a separate \`products-write\` alias (\`is_write_index\`) so the indexer can be switched independently of readers.`,
      code: [
        {
          language: 'typescript',
          title: 'Reindex and atomic alias swap',
          code: `import { Client } from '@elastic/elasticsearch';

const es = new Client({ node: process.env.ES_URL });

export async function reindex(from: string, to: string, settings: object, mappings: object) {
  await es.indices.create({
    index: to,
    settings: { ...settings, 'index.refresh_interval': '-1', 'index.number_of_replicas': 0 },
    mappings,
  });

  // Server-side reindex, sliced across shards, run as a task we can poll
  const { task } = await es.reindex({
    source: { index: from, size: 5000 },
    dest: { index: to, version_type: 'external' }, // keep source versions; newer CDC writes win
    slices: 'auto',
    wait_for_completion: false,
    conflicts: 'proceed',
  });
  let done = false;
  while (!done) {
    await new Promise((r) => setTimeout(r, 10_000));
    done = (await es.tasks.get({ task_id: String(task) })).completed;
  }

  await es.indices.putSettings({ index: to, settings: { 'index.number_of_replicas': 1, 'index.refresh_interval': '1s' } });
  await es.cluster.health({ index: to, wait_for_status: 'green', timeout: '30m' });

  const [a, b] = await Promise.all([es.count({ index: from }), es.count({ index: to })]);
  if (Math.abs(a.count - b.count) > a.count * 0.001) throw new Error('doc count mismatch');

  // One atomic cluster-state update: readers never see an empty alias
  await es.indices.updateAliases({
    actions: [
      { remove: { index: from, alias: 'products' } },
      { add: { index: to, alias: 'products' } },
    ],
  });
}`,
        },
      ],
      keyPoints: [
        'Clients use aliases only; the physical index name is an implementation detail.',
        'Record the CDC offset before the backfill, replay after, versions make it idempotent.',
        'The alias swap is one atomic call; rollback is the reverse swap.',
      ],
    },
    {
      heading: 'Cluster architecture: sharding, replication and hot shards',
      body: `**Intuition:** a shard is a complete Lucene index; an Elasticsearch index is N primary shards × (1 + R) copies spread over nodes. Primaries parallelise *writes and data size*; replicas add *read throughput and availability*.

**Query path (query_then_fetch):** the coordinating node sends the query to one copy of every shard → each returns top (from+size) docIds + scores → coordinator merges → fetch phase pulls \`_source\` for the final page. Latency ≈ slowest shard, so one slow node sets your p99. **Adaptive replica selection** (default since 7.0) routes to the copy with the best response time/queue.

**Sizing rules of thumb:**
- Shard size **10–50 GB** (search-heavy: toward 10–30 GB), and < ~200M docs per shard.
- Heap ≤ 50% of RAM and below ~31 GB (compressed object pointers); the other half is the OS page cache, which is what really makes search fast.
- Avoid oversharding: every shard costs heap, file handles and cluster-state; thousands of tiny shards is a classic outage cause.
- Primary count is fixed at creation (\`_split\` to multiples, \`_shrink\` to factors); plan for 1–2 years of growth, or use time-based indices + rollover for logs/events.
- Dedicated master nodes (3, for quorum), data nodes (hot/warm tiers), and optional coordinating-only nodes for heavy aggregations.

**Routing and hot shards:** a doc goes to shard = hash(_routing) mod primaries (\`_routing\` defaults to \`_id\`). Custom routing by \`tenant_id\` makes tenant queries hit one shard (great), but a whale tenant creates a **hot shard**. Mitigations:
- \`index.routing_partition_size\` — spread each routing key over a *subset* of shards.
- Give whale tenants a dedicated index (silo), keep small tenants pooled.
- Time-based indices: the newest index gets all writes → give it more primaries or roll over by size.
- Uneven allocation: two primaries of the hottest index on one node → set \`index.routing.allocation.total_shards_per_node\`.
- More replicas spread read load for a hot *read* key (a hot write key needs re-routing).

**Diagnose with:** \`_cat/shards?v&s=store:desc\`, \`_cat/thread_pool/search,write?v\` (queue and rejected), \`_nodes/hot_threads\`, the search slow log, and the \`profile: true\` query API.`,
      diagram: `              client
                |
        +---------------+        search: scatter to 1 copy of each shard
        | coordinating  |------------------------------------+
        +---------------+                                    |
          |         |                                        |
   +------v--+  +---v-----+  +---------+   3 dedicated masters (cluster state)
   | data-1  |  | data-2  |  | data-3  |
   | P0  R1  |  | P1  R2  |  | P2  R0  |   P = primary, R = replica
   +---------+  +---------+  +---------+   never put Pn and Rn on one node

   doc -> shard = hash(_routing) % 3   (_routing = _id unless overridden)`,
      keyPoints: [
        'Shards 10–50 GB; heap ≤ 50% RAM and < ~31 GB; page cache does the real work.',
        'Primaries fixed at creation; replicas can change any time.',
        'Custom routing reduces fan-out but creates hot shards for skewed keys.',
      ],
      source: 'Elasticsearch Reference — Size your shards, Search shard routing',
    },
    {
      heading: 'Deep pagination: why page 5,000 is expensive and what to do',
      body: `**Intuition:** to show results 10,000–10,020, *every* shard must find its own top 10,020 and ship them to the coordinator, which sorts shards × 10,020 entries to keep 20. Cost grows linearly with depth × shard count.

- **from + size** is capped by \`index.max_result_window\` (default **10,000**). Raising it is a memory/CPU foot-gun, not a fix.
- **search_after**: pass the sort values of the last hit of the previous page. Each shard only returns \`size\` docs after that cursor → constant cost per page. Requires a deterministic sort with a unique tiebreaker.
- **Point in time (PIT)**: a lightweight snapshot of segments, so pages stay consistent while indexing continues; PIT supplies the implicit \`_shard_doc\` tiebreaker. Keep \`keep_alive\` short (1–5 min) because it pins segments from being merged away.
- **scroll** is no longer recommended for deep pagination; for exports, prefer search_after + PIT or sliced PIT.

**Product answer:** humans never go to page 500. Cap the UI at ~50 pages, use infinite scroll with search_after, and move bulk exports to an async job.`,
      code: [
        {
          language: 'typescript',
          title: 'Stable deep paging with search_after + point in time',
          code: `import { Client } from '@elastic/elasticsearch';

const es = new Client({ node: process.env.ES_URL });

// Iterates every matching product in pages of 1000 without from/size
export async function* scanProducts(tenantId: string) {
  const pit = await es.openPointInTime({ index: 'products', keep_alive: '2m' });
  let searchAfter: (string | number)[] | undefined;
  try {
    while (true) {
      const res = await es.search<{ sku: string; title: string }>({
        size: 1000,
        pit: { id: pit.id, keep_alive: '2m' },          // no index param when using PIT
        query: { bool: { filter: [{ term: { tenant_id: tenantId } }] } },
        sort: [{ updated_at: 'desc' }, { _shard_doc: 'asc' }], // unique tiebreaker
        search_after: searchAfter,
        track_total_hits: false,                          // skip counting: cheaper
      });
      const hits = res.hits.hits;
      if (hits.length === 0) break;
      for (const h of hits) yield h._source!;
      searchAfter = hits[hits.length - 1].sort as (string | number)[];
    }
  } finally {
    await es.closePointInTime({ id: pit.id });            // release pinned segments
  }
}`,
        },
      ],
      keyPoints: [
        'from+size cost ∝ shards × (from+size); capped at 10,000 by default.',
        'search_after + PIT gives constant cost per page and a consistent view.',
        'Cap UI depth; do exports asynchronously.',
      ],
    },
    {
      heading: 'Scenario playbook: the seven classic search incidents',
      body: `Use this as the "what would you do" checklist interviewers probe.

| Scenario | First diagnosis | Fix |
|---|---|---|
| **DB can't handle search** (LIKE scans, primary CPU 90%) | Slow query log shows \`%term%\` scans | Postgres FTS/pg_trgm for small scale; otherwise ES fed by CDC, DB stays source of truth |
| **Need fuzzy search** | Zero-result rate high on misspellings | fuzziness AUTO with prefix_length 1, max_expansions 20–50, boosted below exact; phrase suggester for "did you mean" |
| **Need autocomplete** | Latency budget < 50 ms per keystroke | Edge n-gram / search_as_you_type field or completion suggester; query-log top-k trie for query suggestions; debounce + CDN cache |
| **Slow results** (p99 2 s) | profile API, slow log: leading wildcards, regex, huge aggregations, deep from/size, scoring filters | Move conditions to filter context, remove leading wildcards (use n-grams), cap size, search_after, request cache for aggs, timeouts |
| **Stale index** (updates appear minutes late or never) | Consumer lag metric, bulk rejections (429), DLQ size, refresh_interval | Scale indexer partitions/consumers, fix bulk error handling, versioned writes, alert on lag and on DB-vs-index count drift, periodic reconciliation job |
| **Overloaded cluster** | _cat/thread_pool rejections, GC pauses, heap > 75%, too many shards | Reduce shard count, add replicas/nodes for reads, isolate heavy aggregations to coordinating nodes, circuit breakers, rate-limit expensive query types |
| **Hot shard** | One node's CPU pegged; _cat/shards shows skewed size/traffic | Better routing key or routing_partition_size, whale-tenant index, total_shards_per_node, more primaries on rollover |

**Reconciliation matters:** even with CDC, run a nightly job that compares DB and index checksums per id range and reindexes differences. Drift *will* happen (bug in enrichment, manual DB fix that bypassed the outbox).`,
      keyPoints: [
        'Always start with evidence: slow log, profile API, thread-pool rejections, consumer lag.',
        'Most latency problems are query shape (wildcards, scoring filters, deep paging), not hardware.',
        'Alert on index lag and DB-vs-index drift, not just cluster health.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'search-systems-cc-1',
      title: 'Fix the product indexer that keeps drifting from the database',
      context:
        'A NestJS ProductService writes to Postgres and then indexes into Elasticsearch in the same request. Support reports products whose price in search differs from the product page, deleted products that still appear, and indexing throughput collapses during the nightly price import (2M updates).',
      task:
        'Identify every correctness and throughput bug, then redesign the sync so the index converges to the database even with crashes, retries and concurrent updates.',
      starter: {
        language: 'typescript',
        title: 'product.service.ts (naive dual-write)',
        code: `import { Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { Pool } from 'pg';

@Injectable()
export class ProductService {
  constructor(private readonly db: Pool, private readonly es: Client) {}

  async updatePrice(id: string, price: number): Promise<void> {
    await this.db.query('UPDATE products SET price = $1 WHERE id = $2', [price, id]);
    const { rows } = await this.db.query('SELECT * FROM products WHERE id = $1', [id]);
    try {
      // make it visible immediately so the UI sees the change
      await this.es.index({ index: 'products', id, document: rows[0], refresh: true });
    } catch (e) {
      console.error('es index failed', e); // do not fail the user request
    }
  }

  async deleteProduct(id: string): Promise<void> {
    await this.db.query('DELETE FROM products WHERE id = $1', [id]);
    // search will be cleaned by the next full reindex
  }

  async nightlyImport(updates: { id: string; price: number }[]): Promise<void> {
    for (const u of updates) await this.updatePrice(u.id, u.price); // 2M sequential calls
  }
}`,
      },
      hints: [
        'What happens if the process crashes between the UPDATE and the index call, or if two updates to the same product race?',
        'Where can an ordered, replayable log of committed changes come from without the app remembering to send it?',
        'Look at refresh: true, the per-document calls, and what a replayed old event would do to a newer document.',
      ],
      solution: {
        language: 'typescript',
        title: 'Outbox in the same transaction + versioned bulk indexer',
        code: `import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

// 1) Write path: business row + outbox row in ONE transaction (Debezium tails the outbox).
@Injectable()
export class ProductService {
  constructor(private readonly db: Pool) {}

  async updatePrice(id: string, price: number): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE products SET price = $1, version = version + 1, updated_at = now() WHERE id = $2 RETURNING id, version',
        [price, id],
      );
      if (rows.length === 0) throw new Error('product not found');
      await client.query(
        'INSERT INTO outbox (aggregate_id, type, version) VALUES ($1, $2, $3)',
        [id, 'product.changed', rows[0].version],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteProduct(id: string): Promise<void> {
    // soft delete keeps a version so the delete is ordered like any other change
    await this.db.query(
      'WITH d AS (UPDATE products SET deleted = true, version = version + 1 WHERE id = $1 RETURNING id, version) ' +
        "INSERT INTO outbox (aggregate_id, type, version) SELECT id, 'product.deleted', version FROM d",
      [id],
    );
  }

  // Bulk path: one set-based statement per chunk; outbox rows emitted in the same statement
  async nightlyImport(updates: { id: string; price: number }[]): Promise<void> {
    for (let i = 0; i < updates.length; i += 5000) {
      const chunk = updates.slice(i, i + 5000);
      await this.db.query(
        'WITH u AS (UPDATE products p SET price = x.price, version = p.version + 1 ' +
          'FROM unnest($1::text[], $2::numeric[]) AS x(id, price) WHERE p.id = x.id RETURNING p.id, p.version) ' +
          "INSERT INTO outbox (aggregate_id, type, version) SELECT id, 'product.changed', version FROM u",
        [chunk.map((c) => c.id), chunk.map((c) => c.price)],
      );
    }
  }
}

// 2) Indexer (separate deployment) consumes outbox events keyed by product id,
//    re-reads the current row, and bulk-indexes with external versioning:
//    { index: { _index: 'products', _id: id, version: row.version, version_type: 'external' } }
//    deleted rows -> { delete: { ..., version, version_type: 'external' } }
//    409 conflicts are ignored (a newer version is already indexed); 429/5xx retried;
//    Kafka offsets committed only after the bulk succeeds. No refresh=true anywhere.`,
      },
      explanation: `**Fixes:**
- **Dual-write removed.** The DB change and the outbox row commit atomically; CDC (Debezium outbox router) publishes to Kafka keyed by product id. A crash can no longer leave the index permanently stale, and swallowed ES errors no longer lose updates.
- **Ordering + idempotency.** A monotonic \`version\` column with \`version_type: external\` makes ES reject older writes (409), so races, retries and replays converge to the latest state.
- **Deletes propagate.** Soft delete + versioned delete event instead of "wait for the next full reindex".
- **Throughput.** \`refresh: true\` per write forced a new tiny segment every request (merge storm, indexing throughput down by an order of magnitude). The indexer uses the bulk API and the default 1 s refresh. The nightly import is set-based SQL instead of 2M round trips.
- **Read-your-writes** for the editor UI should read the product page from the DB (or use \`refresh: wait_for\` on that one path), not force refreshes globally.
- Add a nightly reconciliation job comparing DB and index versions per id range to catch residual drift.`,
      followUps: [
        {
          "q": "The indexer re-reads the current row for each event. During the 2M-row nightly import, that is 2M extra Postgres reads. How do you keep this from hurting the database?",
          "a": "Batch the re-read: the indexer consumes up to ~1,000 events, dedupes by product id (keeping the highest version), and fetches all rows in one `SELECT ... WHERE id = ANY($1)` from a read replica. That turns 2M point reads into ~2K batched queries. Replica lag is acceptable because the version check protects correctness: if the replica returns an older version than the event, either wait/retry or skip — the newer event will come. Alternatively embed the full row in the outbox payload so no re-read is needed, at the cost of larger events."
        },
        {
          "q": "How would you test that the system converges under races, crashes and replays?",
          "a": "Write a property-style integration test with Testcontainers (Postgres, Kafka, ES): fire random concurrent updates and deletes for a small set of ids (to force races), kill and restart the indexer at random points, and replay the topic from offset 0 at the end. Then assert for every id that ES `version` equals the DB `version`, and that deleted rows are absent. Run it with many seeds in CI. Add a unit test that an older version produces a 409 that is treated as success, not retried forever."
        }
      ],
    },
    {
      id: 'search-systems-cc-2',
      title: 'Harden a slow, abusable search endpoint',
      context:
        'The /search endpoint of a marketplace (80M listings, 12 shards) has p99 of 2.4 s and occasionally times out the whole cluster. Security also reported that some queries return 500s and that clients can page to page 20,000.',
      task:
        'Rewrite the endpoint so it is fast, bounded and safe for user input, while keeping tenant isolation and supporting infinite scroll.',
      starter: {
        language: 'typescript',
        title: 'search.controller.ts',
        code: `import { Controller, Get, Query } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';

@Controller('search')
export class SearchController {
  constructor(private readonly es: Client) {}

  @Get()
  async search(
    @Query('q') q: string,
    @Query('tenant') tenant: string,
    @Query('page') page = 1,
    @Query('size') size = 20,
  ) {
    const res = await this.es.search({
      index: 'listings',
      from: (page - 1) * size,
      size,
      query: {
        bool: {
          must: [
            { query_string: { query: '*' + q + '*', fields: ['title', 'description'] } },
            { match: { tenant_id: tenant } },
            { match: { status: 'active' } },
          ],
        },
      },
      aggs: { brands: { terms: { field: 'brand', size: 1000 } } },
    });
    return res.hits.hits.map((h) => h._source);
  }
}`,
      },
      hints: [
        'Which clauses contribute to scoring but should not, and which can be cached?',
        'What does query_string do with raw user syntax, and what does a leading wildcard do to the term dictionary?',
        'How much work does page 20,000 cost each of the 12 shards, and what bounds exist on size and time?',
      ],
      solution: {
        language: 'typescript',
        title: 'search.controller.ts (bounded, filter-context, cursor paging)',
        code: `import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';

const MAX_SIZE = 50;

@Controller('search')
export class SearchController {
  constructor(private readonly es: Client) {}

  @Get()
  async search(
    @Query('q') q = '',
    @Query('cursor') cursor?: string, // opaque base64 of the last hit's sort values
    @Query('size') sizeRaw = '20',
  ) {
    const tenant = 't_from_auth_context'; // derive from the verified token, never the query string
    const size = Math.min(Math.max(parseInt(sizeRaw, 10) || 20, 1), MAX_SIZE);
    const text = q.trim().slice(0, 200);
    if (!text) throw new BadRequestException('q required');

    const searchAfter = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : undefined;

    const res = await this.es.search({
      index: 'listings',
      size,
      timeout: '400ms',                 // per-shard budget: partial results beat a meltdown
      track_total_hits: 1000,           // "1000+" is enough for the UI
      query: {
        bool: {
          filter: [                     // no scoring, cached bitsets
            { term: { tenant_id: tenant } },
            { term: { status: 'active' } },
          ],
          must: {
            // simple, safe syntax; infix matching comes from an n-gram subfield, not wildcards
            multi_match: {
              query: text,
              fields: ['title^3', 'title.autocomplete', 'description'],
              fuzziness: 'AUTO',
              prefix_length: 1,
              max_expansions: 20,
            },
          },
        },
      },
      sort: [{ _score: 'desc' }, { listing_id: 'asc' }], // unique tiebreaker for search_after
      search_after: searchAfter,
      aggs: cursor ? undefined : { brands: { terms: { field: 'brand', size: 20 } } }, // facets on page 1 only
    });

    const hits = res.hits.hits;
    const last = hits[hits.length - 1];
    return {
      timedOut: res.timed_out,
      items: hits.map((h) => h._source),
      nextCursor: last && hits.length === size ? Buffer.from(JSON.stringify(last.sort)).toString('base64url') : null,
      brands: res.aggregations?.brands,
    };
  }
}`,
      },
      explanation: `**Fixes:**
- **Leading wildcard \`*q*\`** forced a scan of the whole term dictionary per shard → replaced by an edge/n-gram subfield plus BM25 \`multi_match\`.
- **query_string on raw input** exposes Lucene syntax: unbalanced quotes cause 500s, and users can craft regex/wildcard bombs → \`multi_match\` (or \`simple_query_string\`) with length limits.
- **Filters in \`must\`** were scored and not cached → moved to \`bool.filter\`; \`term\` on keyword instead of \`match\`.
- **Tenant from the query string** is a BOLA-style isolation hole → tenant comes from the auth context.
- **Deep from/size** (page 20,000 = each of 12 shards sorting 400K entries) → \`search_after\` with an opaque cursor and a unique tiebreaker; \`size\` capped at 50.
- **Unbounded work**: \`timeout\`, \`track_total_hits\` cap, brand aggregation shrunk from 1000 to 20 buckets and only computed on the first page.
- Consider the shard request cache for aggregation-only requests and a rate limit per API key for expensive query types.`,
      followUps: [
        {
          "q": "The response says `timedOut: true` on 3% of requests during peak. What does the client get in that case, and how do you decide whether that's acceptable?",
          "a": "With `timeout: '400ms'`, shards that exceed the budget return whatever hits they collected so far, and the coordinator merges partial results; some shards may contribute nothing (`_shards.failed`/`timed_out`). The user gets a page that may miss good results but arrives on time. Measure it: compare CTR and conversion for timed-out vs complete responses. If quality drops measurably, fix the cause (heavy queries, hot shards) rather than raising the timeout. Never cache partial responses in the shard request cache or CDN."
        },
        {
          "q": "A competitor scrapes the endpoint with 10,000 requests per minute using cursors. How do you defend without hurting real users?",
          "a": "Layer controls: per-API-key and per-IP rate limits (token bucket, e.g. 10 req/s burst 20 for anonymous users) at the gateway; sign cursors with an HMAC that includes the user/session id and an expiry so cursors can't be shared or forged; cap cursor depth (e.g. 50 pages) per query. Detect scraping by behaviour — sequential deep paging, no clicks, uniform timing — and challenge or throttle those sessions. Keep facets and expensive aggregations behind authenticated usage."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'search-systems-iq-01',
      difficulty: 'hard',
      question:
        'Our product catalogue search is a Postgres ILIKE query over 60M rows. The primary is at 90% CPU at peak and search p99 is 4 seconds. Walk me through what you would build.',
      context: 'E-commerce, 60M SKUs, ~1,500 search QPS at peak, catalogue updates ~2K/s during price imports.',
      whatInterviewerLooksFor: [
        'Explains why ILIKE with leading wildcard cannot use an index',
        'Keeps the DB as source of truth; search as a derived read model',
        'Designs a reliable sync (CDC/outbox) instead of dual writes',
        'Sizes shards/replicas and discusses consistency lag honestly',
        'Mentions a stop-gap (read replica / pg_trgm) while the real system is built',
      ],
      modelAnswer: `### Diagnosis
\`ILIKE '%term%'\` cannot use a B-tree, so every search is a sequential scan of 60M rows on the **primary**, competing with writes. There is no relevance ranking and no stemming either.

### Immediate relief (days)
- Route search to a read replica so writes stop suffering.
- Add a \`pg_trgm\` GIN index for substring matching as a stop-gap — it will help latency but not relevance.

### Target architecture
- **Elasticsearch/OpenSearch** cluster holding a denormalised product document (title, brand, category path, price, stock, popularity).
- **Sync via CDC**: Debezium on the Postgres WAL (or transactional outbox) → Kafka topic keyed by product id → indexer consumers → bulk API with \`version_type: external\` so replays and reorders can't regress a document.
- **Reads**: API → search service → ES alias \`products\`; filters (tenant, stock, price) in \`bool.filter\`, user text in \`multi_match\` with field boosts.
- **Consistency**: search is eventually consistent, typically 1–3 s. The product detail page and checkout read Postgres, so a stale price in search is never charged.

### Sizing
60M × ~3 KB source ≈ 180 GB primary; with analysis overhead ~250 GB. At 25–40 GB per shard → **8 primaries**, 1 replica = 16 shards ≈ 500 GB on disk. Each query fans out to one copy of each of the 8 shards: 1,500 × 8 ≈ 12K shard-queries/s; at ~2–5 ms each that is 24–60 CPU-seconds/s → ~6 data nodes of 16 vCPU with headroom, plus 3 small dedicated masters.

### Operability
Aliases for zero-downtime reindex, lag + drift alerts, nightly reconciliation, slow log and zero-result-rate dashboards.`,
      followUps: [
        {
          q: 'The price import pushes 2K updates/s. How do you stop it from hurting search latency?',
          a: 'Bulk indexing with 5–15 MB batches, refresh_interval 1s or higher, and throttle the indexer by consumer concurrency. If needed, separate indexing load with a dedicated ingest tier, or temporarily raise refresh_interval during imports. Price-only updates can be partial updates, but they still rewrite the whole Lucene doc.',
        },
        {
          q: 'Why not just index from the application after each save?',
          a: 'Dual writes are not atomic — a crash or ES outage between the two leaves permanent drift, and concurrent requests can index in the wrong order. CDC/outbox gives an ordered, replayable log of committed changes.',
        },
        {
          q: 'When would you keep Postgres full-text search instead?',
          a: 'A few million rows, modest QPS, simple relevance, and a team that cannot operate another stateful cluster — tsvector + GIN and pg_trgm are transactional and good enough.',
        },
      ],
      pitfalls: [
        'Proposing "add an index on title" without realising leading wildcards defeat it',
        'Dual-writing to ES from the request handler',
        'Treating Elasticsearch as the system of record',
        'Ignoring that the index is eventually consistent and serving checkout prices from it',
      ],
    },
    {
      id: 'search-systems-iq-02',
      difficulty: 'expert',
      question:
        'Our marketplace has 40M product listings from 3,000 sellers. We need a product-name typeahead (documents, not past queries) that matches words in the middle of a title ("pro" should find "iPhone 15 Pro"), hides out-of-stock items for the buyer\'s country, and stays under 50 ms p99 at 20K QPS. The team wants to use the Elasticsearch completion suggester. Walk me through your index design.',
      whatInterviewerLooksFor: [
        'Knows the completion suggester is an in-memory FST that matches from the start of each input and filters only via contexts',
        'Chooses search_as_you_type / edge n-grams with a normal bool filter when filtering and infix matching matter',
        'Builds a slim, dedicated suggest index and sizes it (docs, n-gram blow-up, shards, replicas)',
        'Handles stock churn without reindex storms, and ranks by popularity with exact-prefix boosts',
      ],
      modelAnswer: `### Why not the completion suggester (as-is)
- It is an **FST held in memory**, matching from the **start of each input**. Infix matches need extra inputs per title (every word start), which bloats the FST.
- Filtering is limited to **contexts** (category/geo) chosen at index time. "In stock in country X" changes constantly and can't be expressed as an arbitrary filter; you would over-fetch and post-filter, and then return fewer than 10 results.
- It is excellent for **query suggestions** (short, static strings). This is document typeahead with live filters.

### Index design
- A **dedicated \`products_suggest\` index**: only \`title\`, \`brand\`, \`popularity\`, \`in_stock_countries\` (keyword array), \`seller_id\`. There are no descriptions, so docs stay small and hot in the page cache.
- \`title\` as **\`search_as_you_type\`** (shingles plus an edge n-gram \`._index_prefix\` subfield), or a custom **edge_ngram analyzer at index time only** (min_gram 2, max_gram 15), with the standard analyzer at search time.
- Query: \`multi_match\` type \`bool_prefix\` over the subfields, with a \`bool.filter\` term on \`in_stock_countries\`. Filters are cached bitsets, so they're cheap.
- Ranking: \`function_score\` with log(popularity), plus a boost when the title **starts with** the prefix (a \`prefix\` query on a keyword subfield).

### Sizing
40M × ~300 B ≈ 12 GB of source; edge n-grams inflate the index ~3–4× → ~40 GB. Use 4 primaries (~10 GB each) and 4 replicas: 20 copies across ~10 nodes. At ~1–2K simple queries/s per shard copy that covers 20K QPS with headroom, and the whole index fits in RAM.

### Stock churn
Stock flips thousands of times per second, but only **transitions** (in ↔ out) per country matter. CDC → a transition filter → partial updates, batched with \`_bulk\` and a 1–5 s \`refresh_interval\`. Each update rewrites the whole doc, which is another reason to keep the suggest doc tiny.

### Latency hygiene
Client debounce (~100 ms) and request cancellation, \`timeout\` on the query, no \`track_total_hits\`, size 8–10, and \`_source\` limited to what the UI renders.`,
      followUps: [
        {
          q: 'Sellers complain their brand-new listings take minutes to appear in typeahead. Why, and what do you change?',
          a: 'Usually the indexing path, not refresh: CDC lag or large bulk intervals. Measure now minus the event time of the last indexed change; refresh_interval (1–5 s) is rarely the bottleneck. Prioritise creates over stock updates in the indexer queue.',
        },
        {
          q: 'Would you ever still use the completion suggester here?',
          a: 'Yes, for a separate "popular searches" row built from query logs: short static strings, category contexts, and sub-5 ms FST lookups. Merge both lists in the BFF.',
        },
        {
          q: 'One huge seller has 8M of the 40M listings and floods the suggestions. How do you keep results diverse?',
          a: 'Use collapse on seller_id (or brand) with a small inner cap, or re-rank in the service so no seller takes more than 2–3 of the 10 slots.',
        },
      ],
      pitfalls: [
        'Assuming the completion suggester can apply arbitrary filters like stock or price',
        'Pointing typeahead at the full product index with descriptions and nested offers',
        'Using the edge_ngram analyzer at search time too, so "pro" matches everything starting with "p"',
      ],
    },
    {
      id: 'search-systems-iq-03',
      difficulty: 'hard',
      question:
        'Product says 12% of searches return zero results, mostly because of typos. You turn on fuzziness AUTO everywhere and p99 doubles while relevance gets worse. What happened and how do you do this properly?',
      whatInterviewerLooksFor: [
        'Understands term expansion via Levenshtein automata',
        'Uses prefix_length / max_expansions to bound cost',
        'Keeps exact matches ranked above fuzzy ones',
        'Knows fuzzy does not fix phonetic or word-boundary errors',
      ],
      modelAnswer: `### Why it got slower and worse
- Fuzzy expands each query term into all dictionary terms within 1–2 edits. With \`prefix_length: 0\` every term in the dictionary is a candidate; up to \`max_expansions\` (50) terms per query term per shard become an OR query. A 4-word query can become ~200 terms.
- Relevance: fuzzy matches are scored like exact ones (rare misspelling-neighbours even get *high* IDF), so "cart" also matches "card" and "care", pushing exact hits down.

### Doing it properly
1. **Measure first**: sample the zero-result queries. Typically: typos, word-split problems ("head phones"), synonyms ("tv"), and items we simply don't sell.
2. **Two-tier query**: exact/stemmed \`match\` boosted ×3, plus a fuzzy \`should\` clause — or run fuzzy only as a fallback when the exact query returns < N hits.
3. **Bound cost**: \`prefix_length: 1\` (or 2), \`max_expansions: 10–20\`, \`fuzziness: AUTO\` (0 edits for 1–2 char tokens, 1 for 3–5, 2 for > 5), fuzzy only on the title field, not the description.
4. **Other fixes**: synonyms at query time, shingles/\`word_delimiter_graph\` for splits, phonetic subfield for names, and a phrase suggester for "Did you mean…".
5. **Validate**: zero-result rate, CTR on corrected queries, and p99 by query type in an A/B test.

Typical outcome: zero-result rate down to 3–5% with less than 10% latency increase.`,
      followUps: [
        {
          q: 'Why is prefix_length so effective?',
          a: 'Requiring the first N characters to match lets Lucene jump to that range of the term dictionary, shrinking the candidate set by orders of magnitude; users rarely mistype the first letter.',
        },
        {
          q: 'Should "Did you mean" re-run the search automatically?',
          a: 'If the original query has zero results and the correction has high confidence, show corrected results with a "search instead for X" link; otherwise just show the suggestion.',
        },
      ],
      pitfalls: [
        'Setting fuzziness 2 on every field including descriptions',
        'Not boosting exact matches above fuzzy matches',
        'Assuming fuzzy solves synonyms and phonetic misspellings',
      ],
    },
    {
      id: 'search-systems-iq-04',
      difficulty: 'hard',
      question:
        'Sellers complain that after editing a listing it takes 10–20 minutes to show in search, and sometimes old data comes back after an hour. Your pipeline is Postgres → Debezium → Kafka → indexer → Elasticsearch. Debug it.',
      whatInterviewerLooksFor: [
        'Breaks lag into hops and measures each',
        'Identifies ordering / versioning as the cause of regressions',
        'Knows bulk rejections, refresh and consumer lag metrics',
        'Proposes alerting and reconciliation',
      ],
      modelAnswer: `### Split the lag into hops
End-to-end lag = WAL→Debezium + Kafka + indexer batching/enrichment + ES bulk + refresh. Instrument each: Debezium \`MilliSecondsBehindSource\`, Kafka consumer-group lag per partition, indexer batch duration, bulk latency and rejections, and \`refresh_interval\`.

### Likely causes of 10–20 min lag
- **Consumer lag**: too few partitions/consumers, or one hot partition (a seller doing a bulk import keyed to one partition).
- **Bulk 429s** (write thread pool full) retried with long backoff, or merges throttling.
- **Slow enrichment**: the indexer does N+1 DB lookups per event.
- Someone set \`refresh_interval: -1\` or 15m on the live index after a backfill and never restored it.
- A replication slot problem makes Debezium restart and re-snapshot.

### Old data coming back = ordering bug
- Events for the same listing on different partitions (wrong key) or parallel processing within a partition → an older version indexed last.
- A replay/backfill job writing without versions overwrites newer docs.
- Fix: key by listing id, process a partition in order, and index with \`version_type: external\` using a monotonic row version or WAL LSN, so stale writes get 409.

### Guardrails
- SLO: 99% of changes searchable within 5 s; alert on consumer lag in seconds, not messages.
- Reconciliation job comparing DB version vs index version per id range nightly.
- For the seller's own view, read from the DB or use \`refresh=wait_for\` for that single write.`,
      followUps: [
        {
          q: 'Could you use the updated_at timestamp as the external version?',
          a: 'Only if it is monotonic per row; clock skew across app servers or same-millisecond updates can break it. A version counter incremented in the UPDATE or the WAL LSN is safer.',
        },
        {
          q: 'How do you handle a brand rename that touches 400K listing documents?',
          a: 'Treat it as a fan-out job: an update_by_query on brand_id or a background reindex of affected ids, rate-limited so it does not starve normal CDC traffic — ideally on a separate lower-priority topic.',
        },
      ],
      pitfalls: [
        'Blaming the 1 s refresh without measuring the other hops',
        'Fixing staleness with refresh=true on every write',
        'Parallelising consumption without preserving per-entity order',
      ],
    },
    {
      id: 'search-systems-iq-05',
      difficulty: 'expert',
      question:
        'Search p99 jumped from 120 ms to 1.8 s. One of nine data nodes shows 95% CPU while the rest sit at 30%. The index is routed by tenant_id. What is going on and what do you do now vs long term?',
      whatInterviewerLooksFor: [
        'Recognises hot shard from routing skew or allocation',
        'Explains why the slowest shard sets p99 (scatter-gather)',
        'Uses the right diagnostic APIs',
        'Offers both immediate mitigation and structural fixes',
      ],
      modelAnswer: `### Why one node dominates p99
Search is scatter-gather: the coordinator waits for the slowest shard. If one node is saturated, every query touching its shards inherits its latency — so p99 for everyone degrades, not just for one tenant.

### Diagnose
- \`_cat/shards?v&s=store:desc\` — is one shard much bigger? (routing skew from a whale tenant)
- \`_cat/thread_pool/search?v\` — queue/rejections on that node.
- \`_nodes/hot_threads\` — is it query execution, merges, or GC?
- Slow log + \`profile\` for that tenant's queries; check whether that node holds *both* shards of the hottest index (allocation skew).

### Immediate
- Add replicas for the affected index so reads for the hot shard spread across more nodes (adaptive replica selection will prefer less-loaded copies).
- \`index.routing.allocation.total_shards_per_node\` or manual \`_cluster/reroute\` to move co-located hot shards apart.
- Rate-limit or cache the whale tenant's expensive queries (e.g. dashboards polling aggregations).

### Long term
- \`index.routing_partition_size\` (e.g. 3–4) so each tenant spans a subset of shards instead of one.
- Move tenants above a size threshold to a dedicated index (silo) with its own shard count; keep the long tail pooled.
- Re-plan primaries via a reindex behind an alias; target 10–30 GB shards.
- Per-tenant query cost monitoring and quotas.

### Numbers
If the whale tenant is 30% of traffic and pinned to 1 of 9 nodes, that node gets ~30% + its 1/9 share of others ≈ 38% of all shard work vs ~8% for the rest — a 4–5× imbalance, matching the CPU picture.`,
      followUps: [
        {
          q: 'Why not just remove custom routing?',
          a: 'Then every tenant query fans out to all shards: more total work and worse tail latency for the long tail. Partitioned routing or silos keep the benefit without the skew.',
        },
        {
          q: 'Would adding more nodes fix it?',
          a: 'Not by itself — a single shard lives on one node per copy. You need more copies (replicas) or a different distribution of that data.',
        },
      ],
      pitfalls: [
        'Scaling the whole cluster vertically without finding the skew',
        'Assuming primaries can be increased in place',
        'Ignoring GC/merges as alternative causes of one hot node',
      ],
    },
    {
      id: 'search-systems-iq-06',
      difficulty: 'hard',
      question:
        'We need to change the analyzer on the title field of a 2 TB production index that serves 3K QPS and receives continuous CDC updates. How do you do it with zero downtime and a rollback path?',
      whatInterviewerLooksFor: [
        'Knows analyzers on existing fields cannot be changed in place',
        'Alias-based blue/green index swap',
        'Handles writes during backfill (offset capture + replay, versioning)',
        'Validation before swap and cheap rollback',
      ],
      modelAnswer: `### Constraint
An existing field's analyzer can't be changed on a live index — existing segments hold tokens produced by the old analyzer. We build a new index and swap.

### Plan
1. **Create** \`products_v5\` with the new analyzer, possibly better shard count, \`refresh_interval: -1\`, replicas 0.
2. **Capture a position**: start a new consumer group for v5 at the current CDC offset (or record it) *before* the backfill starts.
3. **Backfill**: \`_reindex\` from v4 with \`slices: auto\` (only analysis changes, \`_source\` is complete) — throttle with \`requests_per_second\` so live search isn't hurt. 2 TB at ~50–100 MB/s ≈ 6–12 hours.
4. **Catch up**: the v5 consumer group replays CDC from the recorded offset; external versioning means overlap with backfilled docs is harmless.
5. **Finalise**: replicas 1, refresh 1s, force-merge optional, wait for green.
6. **Validate**: doc count parity, spot-check ids, run the judgement list (NDCG@10) and mirror a slice of production queries to compare latency and top-10 overlap.
7. **Swap**: single atomic \`_aliases\` call (remove v4, add v5). Keep the v4 consumer running for a day so v4 stays current → **rollback is an instant alias swap**.
8. Delete v4 after the soak period.

### Capacity
You temporarily need ~2× disk (plus merge headroom) and extra indexing CPU; schedule off-peak and check disk watermarks (85%/90% defaults) first.`,
      followUps: [
        {
          q: 'What if the source index does not contain every field (some excluded from _source)?',
          a: 'Then _reindex cannot rebuild it; backfill from the database or a snapshot export via the indexer instead. This is why _source should normally be kept complete.',
        },
        {
          q: 'How do you avoid double-writing logic in the indexer?',
          a: 'Run a second consumer group pointed at a write alias for v5; the indexer code is the same, only the target alias differs.',
        },
      ],
      pitfalls: [
        'Trying PUT _mapping to change an analyzer',
        'Starting the CDC replay after the backfill and losing changes in between',
        'Deleting the old index immediately, removing rollback',
      ],
    },
    {
      id: 'search-systems-iq-07',
      difficulty: 'expert',
      question:
        'Merchandising wants "popular products higher" and the CEO complains that searching "iphone 15 case" shows an iPhone 15 first. How do you approach relevance tuning without it turning into whack-a-mole?',
      whatInterviewerLooksFor: [
        'Measurement-first: judgement lists, NDCG, CTR, zero-result rate',
        'Understands BM25 components and why the phone outranks the case',
        'Bounded business signals rather than raw multipliers',
        'A/B testing and learning-to-rank path',
      ],
      modelAnswer: `### Why the phone wins
BM25 sums per-term scores: the iPhone 15 title matches "iphone" and "15" strongly, is short (length normalisation favours short titles), and a popularity multiplier amplifies it. "case" is just one term among three. The engine has no notion that "case" is the **head noun** that defines intent.

### Build a measurement loop first
- A **judgement list**: top 500–1,000 queries with graded relevant products (from clicks/purchases + manual labelling).
- Offline metric: NDCG@10 via \`_rank_eval\` for every ranking change; online: CTR, add-to-cart, zero-result rate in A/B tests.

### Tuning levers, in order
1. **Query understanding**: detect category intent ("case" → phone-accessories) with a query classifier and apply it as a boost or filter — this fixes the CEO's query class, not just one query.
2. **Field design**: boost category/product-type fields; \`cross_fields\` for multi-field queries; phrase/proximity boosts via \`match_phrase\` with slop.
3. **Business signals bounded**: \`rank_feature\` with saturation/log for popularity, so it breaks ties among relevant items rather than overriding textual relevance. Never a raw multiplier on sales count.
4. **Learning to rank**: once logs are clean, rerank the top 100–200 BM25 candidates with a gradient-boosted model (features: BM25 per field, category match, CTR, price, recency). Keep BM25 as the fast retrieval stage.
5. Optional **hybrid retrieval**: add dense-vector kNN for semantic matches and fuse with BM25 (reciprocal rank fusion).

### Governance
Every change goes through offline NDCG + A/B test; pinned results ("merch rules") are explicit, expiring, and audited so they don't silently accumulate.`,
      followUps: [
        {
          q: 'Why rerank only the top 100–200?',
          a: 'ML models are orders of magnitude more expensive per document than BM25; a two-stage retrieve-then-rerank keeps latency bounded while improving precision where users look.',
        },
        {
          q: 'How do you avoid position bias in click data?',
          a: 'Users click higher results regardless of relevance; use interleaving experiments, randomise small slices, or apply click models / inverse propensity weighting.',
        },
      ],
      pitfalls: [
        'Tweaking boosts per complaint without an offline metric',
        'Multiplying score by raw popularity',
        'Assuming more synonyms always improves relevance',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'search-systems-boe-1',
      question:
        'Size an Elasticsearch cluster for a 200M-document product catalogue serving 1,000 search QPS at peak with p99 < 200 ms.',
      assumptions: [
        'Average _source 2 KB; on-disk index ≈ 1.5× source (inverted index + doc values + multi-fields)',
        '1 replica; target shard size ~30 GB',
        'Each query hits one copy of every primary shard; ~2 ms CPU per shard-query for a typical filtered multi_match',
        'Data nodes: 16 vCPU, 64 GB RAM (30 GB heap), 1 TB SSD; keep CPU ≤ 50% at peak and disk ≤ 75%',
      ],
      steps: [
        { label: 'Raw source', calc: '200M × 2 KB = 400 GB' },
        { label: 'Primary index size', calc: '400 GB × 1.5 ≈ 600 GB' },
        { label: 'With 1 replica + 30% growth/merge headroom', calc: '600 × 2 = 1.2 TB; × 1.3 ≈ 1.6 TB' },
        { label: 'Primary shard count', calc: '600 GB ÷ 30 GB = 20 primaries (40 shards total)' },
        { label: 'Nodes by disk', calc: '1.6 TB ÷ (1 TB × 0.75) ≈ 2.1 → 3 nodes' },
        { label: 'Search CPU', calc: '1,000 QPS × 20 shards × 2 ms = 40 CPU-seconds/s = 40 busy cores' },
        { label: 'Nodes by CPU', calc: '40 cores ÷ (16 × 0.5) = 5 → 6 data nodes for N+1' },
        { label: 'Page cache coverage', calc: '6 × ~32 GB page cache ≈ 190 GB hot data cached (~16% of 1.2 TB)' },
      ],
      answer:
        '~6 data nodes (16 vCPU / 64 GB / 1 TB) holding 20 primaries + 20 replicas, plus 3 small dedicated master nodes. CPU from scatter-gather, not disk, drives the node count.',
      insight:
        'Fan-out multiplies per-query cost by the shard count: halving primaries (e.g. 10 × 60 GB, still acceptable for many workloads) halves shard-queries, while extra replicas add read throughput without extra fan-out. Size for CPU and page cache, then check disk.',
      followUps: [
        {
          "q": "Peak traffic becomes 5,000 QPS instead of 1,000. Redo the CPU sizing and say how you'd restructure the shards.",
          "a": "Same layout: 5,000 × 20 shards × 2 ms = 200 busy cores → 200 ÷ 8 usable cores per node = 25 data nodes. Since cost scales with shard count, consolidate to 10 primaries of ~60 GB; per-shard cost rises (say ~3 ms) but total drops to 5,000 × 10 × 3 ms = 150 cores ≈ 19 nodes. Then add replicas (e.g. 10 primaries × 2–3 copies) so there are enough shard copies to spread across ~19–20 nodes and each copy serves part of the reads. Also add the shard request cache for repeated facet-only queries."
        },
        {
          "q": "The catalogue grows to 1B documents at the same 1,000 QPS. What dominates now — disk or CPU?",
          "a": "Source: 1B × 2 KB = 2 TB; primary index ≈ 3 TB → 100 primaries at 30 GB. Disk: 3 TB × 2 (replica) × 1.3 = 7.8 TB ÷ 0.75 TB usable ≈ 11 nodes. CPU: 1,000 × 100 shards × 2 ms = 200 cores ÷ 8 = 25 nodes. CPU dominates even more, because fan-out grew 5× with data. Options: bigger shards (50 GB → 60 primaries), routing by category or tenant so a query hits only relevant shards, and tiering out rarely searched items (e.g. discontinued products) into a separate index queried only on demand."
        }
      ],
    },
    {
      id: 'search-systems-boe-2',
      question:
        'The CDC indexer must sustain 5K updates/s normally and 20K/s during nightly price imports, and you need to backfill all 200M docs for a reindex. How many Kafka partitions and indexer consumers, and how long does the backfill take?',
      assumptions: [
        'Document size 3 KB after enrichment',
        'Bulk request target ~5 MB; bulk latency ~300 ms under load',
        'One in-flight bulk request per consumer (ordering preserved per partition)',
        'Backfill with replicas 0 and refresh_interval -1 achieves ~50K docs/s cluster-wide',
      ],
      steps: [
        { label: 'Docs per bulk', calc: '5 MB ÷ 3 KB ≈ 1,700 docs' },
        { label: 'Per-consumer throughput', calc: '1,700 docs ÷ 0.3 s ≈ 5,700 docs/s' },
        { label: 'Consumers for peak', calc: '20K ÷ 5.7K ≈ 3.5 → 4; ×2 headroom = 8 consumers' },
        { label: 'Partitions', calc: '≥ consumers and room to grow → 12–16 partitions keyed by product id' },
        { label: 'Ingest bandwidth at peak', calc: '20K × 3 KB = 60 MB/s; ×2 with replica = 120 MB/s of indexing work' },
        { label: 'Backfill time', calc: '200M ÷ 50K docs/s = 4,000 s ≈ 1.1 h (vs 200M ÷ 20K ≈ 2.8 h with replicas on)' },
      ],
      answer:
        '~8 consumers on 12–16 partitions handle peak with 2× headroom; a full backfill takes ~1–3 hours depending on whether replicas/refresh are disabled during the load.',
      insight:
        'Partition count caps consumer parallelism and must be chosen up front; per-entity keys keep ordering. The backfill number tells you a reindex is an off-peak, hours-long operation — hence aliases, offset capture and rollback rather than in-place changes.',
      followUps: [
        {
          "q": "Nightly imports grow to 60K updates/s. What changes in partitions, consumers and ES ingest, and what's the risk of adding partitions?",
          "a": "Consumers: 60K ÷ 5.7K ≈ 10.5 → 11, ×2 headroom = 22, more than the 12–16 partitions, so you need ~24–32 partitions. ES ingest: 60K × 3 KB = 180 MB/s, ×2 with replica = 360 MB/s of indexing, which may need more data nodes or temporarily fewer replicas. The risk: adding partitions changes `hash(key) % N`, so a product's events move partitions and old and new events can be processed out of order during the transition. External versioning makes that harmless — stale writes get 409. Also coalesce bursty updates per product."
        },
        {
          "q": "The reindex backfill runs while live CDC (5K/s) continues into the new index. How long does it take, and how long to catch up afterwards if CDC is replayed only once the backfill finishes?",
          "a": "If live writes consume 5K of the 50K docs/s capacity, the backfill gets ~45K docs/s: 200M ÷ 45K ≈ 4,444 s ≈ 74 minutes. CDC events accumulated meanwhile: 5K × 4,444 ≈ 22M. Replay with 8 consumers at ~5.7K each = 45.6K/s, minus 5K/s still arriving → ~40.6K/s net drain → 22M ÷ 40.6K ≈ 550 s ≈ 9 minutes. So ~83 minutes in total before the alias flip. Running CDC into the new index concurrently (versioned) removes the catch-up phase entirely."
        }
      ],
    },
    {
      id: 'search-systems-boe-3',
      question:
        'Estimate memory and serving capacity for a query-autocomplete trie built from 10M unique queries, serving 50K prefix requests/s at peak.',
      assumptions: [
        '10M unique normalised queries, average 20 characters',
        'Only prefixes up to 12 characters are materialised; longer prefixes fall back to the 12-char node filtered in memory',
        'Prefix sharing leaves ~3 new nodes per query beyond length 12 truncation → ~30M nodes',
        'Compact node: child index + top-5 query ids (5 × 4 B) + overhead ≈ 64 B; query strings stored once (~25 B each)',
        'CDN/browser cache absorbs 70% of prefix requests; one node serves ~40K req/s from memory',
      ],
      steps: [
        { label: 'Trie nodes', calc: '10M queries × ~3 unshared nodes ≈ 30M nodes' },
        { label: 'Node memory', calc: '30M × 64 B ≈ 1.9 GB' },
        { label: 'Query string table', calc: '10M × 25 B = 250 MB' },
        { label: 'Total per replica', calc: '≈ 2.2 GB → fits in one process (a naive JS object trie would be 10×+)' },
        { label: 'Origin QPS', calc: '50K × (1 − 0.7) = 15K req/s' },
        { label: 'Serving nodes', calc: '15K ÷ 40K ≈ 0.4 → 3 nodes for HA across zones' },
      ],
      answer:
        '~2–3 GB of memory per replica with a compact array-based trie; 3 small serving nodes behind a CDN comfortably handle 50K QPS peak.',
      insight:
        'Autocomplete is memory-layout bound, not CPU bound: cap materialised prefix length, store top-k as ids in compact arrays (or an FST), and cache short prefixes at the edge. Rebuild offline and hot-swap the immutable structure.',
      followUps: [
        {
          "q": "Product launches the trie in 10 locales, each with its own 10M queries. Does it still fit, and how do you deploy rebuilds safely?",
          "a": "Memory per locale stays ~2.2 GB, so 10 locales ≈ 22 GB per replica — fits on a 32–64 GB node. The catch is the hot swap: building the new immutable trie next to the old one temporarily needs 2× memory for the locale being swapped (another ~2.2 GB), so swap one locale at a time rather than all ten. Alternatively shard by locale across node groups so each node holds a few locales. Build offline into a memory-mappable file (e.g. an FST) so loading is a fast `mmap` and pages are shared across processes."
        },
        {
          "q": "Legal requires removing an offensive query from suggestions within 5 minutes, but rebuilds are nightly. How do you handle it?",
          "a": "Add a blocklist layer applied at serving time: a small, frequently refreshed set of blocked query ids (or normalized strings) pushed via config or a pub/sub update every few seconds. When serving a prefix, filter blocked ids from the precomputed top-k. Since only top-5 are stored per node, store top-8 or top-10 so removing one still leaves 5 to show. Purge the CDN cache for affected prefixes (each prefix of the query, ≤ 12 entries) so the edge doesn't keep serving it. The nightly rebuild then removes it permanently."
        }
      ],
    },
  ],
  test: [
    {
      id: 'search-systems-mcq-01',
      difficulty: 'medium',
      question:
        'A developer reports that this query returns 0 hits although the title "Wireless Headphones" definitely exists. The title field is mapped as type text with the standard analyzer. What is the cause?',
      code: {
        language: 'json',
        code: `GET /products/_search
{
  "query": { "term": { "title": "Wireless Headphones" } }
}`,
      },
      options: [
        'term queries bypass analysis, so the exact string is compared against lowercase single-word tokens that were indexed',
        'The index has not been refreshed, so recently indexed documents are not yet searchable',
        'term queries only work on numeric and date fields; text fields need a prefix query',
        'The standard analyzer removed "Wireless" as a stop word, so the token no longer exists',
      ],
      correct: [0],
      explanation:
        'The standard analyzer indexed the tokens "wireless" and "headphones"; a term query looks up the unanalyzed string "Wireless Headphones", which is not a term in the dictionary. Use match on title or term on a keyword subfield (title.raw). Refresh would only matter for a just-indexed doc, term works fine on keyword fields, and "wireless" is not a stop word.',
      followUps: [
        {
          "q": "The product team also wants exact-title sorting and a \"brand equals\" facet on the same field. What mapping would you ship, and which query hits which part?",
          "a": "Use a multi-field: `title` as `text` (standard or a custom analyzer) for full-text `match`, plus `title.raw` as `keyword` with a `lowercase` normalizer for exact `term` lookups, sorting and aggregations. Keyword fields use doc values (columnar, on disk) so sorting and facets don't need fielddata on the text field, which would blow the heap. Brand should be its own `keyword` field. Queries: `match: { title: q }` for search, `term: { 'title.raw': 'wireless headphones' }` for exact match, `terms` aggregation on `brand`."
        },
        {
          "q": "How would you catch this class of bug (term on an analyzed field) before it reaches production?",
          "a": "Run the `_analyze` API in tests to assert how representative strings tokenize, and add query-shape tests that run against a real ES container (Testcontainers) with the production mapping, asserting that known titles are found. A lint rule in the query builder layer can reject `term`/`terms` on fields whose mapping type is `text` by reading the mapping at startup. In production, a dashboard of zero-result rate per query type exposes it quickly: a `term` on text fields yields near-100% zero results for multi-word or capitalized input."
        }
      ],
    },
    {
      id: 'search-systems-mcq-02',
      difficulty: 'medium',
      question:
        'During a 2M-document nightly import, a service calls the index API once per document with refresh=true. Indexing crawls at a few hundred docs/s and search latency spikes. What is the main mechanism behind this?',
      options: [
        'Each refresh fsyncs the translog to disk, turning every write into a synchronous disk flush',
        'Each refresh creates a new tiny searchable segment, causing heavy segment merging and cache invalidation',
        'refresh=true forces the request to wait for all replicas to be reallocated before acknowledging',
        'refresh=true disables bulk thread pools, so all writes fall back to a single-threaded path',
      ],
      correct: [1],
      explanation:
        'A refresh opens a new Lucene segment; forcing one per document creates thousands of tiny segments that must be merged, and invalidates per-segment caches, hurting both indexing and search. Translog fsync is controlled by index.translog.durability, not refresh; replicas are not reallocated; and thread pools are unaffected. Use the bulk API and the normal refresh interval (or -1 during backfills).',
      followUps: [
        {
          "q": "You switch to the bulk API. How do you pick the bulk size and concurrency for the 2M-doc import, and what signal tells you to back off?",
          "a": "Start with ~5–15 MB per bulk request (roughly 1–5K docs of 2–3 KB), then double the number of concurrent bulk workers until throughput stops rising or latency spikes. Typical sweet spots are 2–8 concurrent requests per data node. The back-off signal is HTTP 429 (`es_rejected_execution_exception`) from the write thread pool queue, or item-level 429s inside a 200 bulk response — you must inspect `items[].status`, not just the HTTP code. On 429, retry only the failed items with exponential backoff and jitter, and reduce concurrency."
        },
        {
          "q": "During the import you also set refresh_interval to -1. The import crashes at 60%. What is the state of the index, and what do you do?",
          "a": "Everything acknowledged is durable (it is in the translog), but documents indexed since the last refresh are not visible to search until a refresh happens, so users may see stale data. Restore `refresh_interval` (e.g. `1s`) or call `_refresh` right away, so the partial import becomes searchable. Then resume from a checkpoint — the importer should record the last committed batch offset — rather than restarting at 0. Because the writes use document ids (and ideally versions), re-sending a few overlapping batches is idempotent. Always restore settings in a `finally` or watchdog."
        }
      ],
    },
    {
      id: 'search-systems-mcq-03',
      difficulty: 'medium',
      question:
        'You move "tenant_id = X" and "status = active" from bool.must to bool.filter in a query that also has a multi_match on user text. What happens next?',
      options: [
        'The same documents match, their scores now come only from the text clause, and the filter bitsets become cacheable',
        'Fewer documents match because filter clauses are applied after the top-k is chosen',
        'Scores are unchanged but the query becomes slower because filters are evaluated per document',
        'The result set becomes unordered because filter context disables relevance scoring for the whole query',
      ],
      correct: [0],
      explanation:
        'Filter clauses restrict the match set exactly like must, but contribute no score and their results can be cached per segment, so queries get faster and relevance reflects only the user text. Filters are not post-filters on the top-k, they are not slower, and the multi_match in must still scores and orders results.',
      followUps: [
        {
          "q": "After this change, a tenant with 30M active documents still sees slow queries even though the filter is cached. Why can caching not save that tenant?",
          "a": "The filter cache stores a bitset per segment, but the expensive part is still scoring the `multi_match` across all documents that pass the filter — for that tenant, 30M candidates. Caching makes the filter step cheap but doesn't shrink the scored set. Fixes: route that tenant to its own index or shard subset so the per-shard term statistics and posting lists are smaller, use index sorting on `tenant_id` so its docs are contiguous (early termination, better compression), or move it to a dedicated index. Also check `track_total_hits` isn't forcing a full count."
        },
        {
          "q": "Is there a case where you would deliberately keep a non-text condition inside `must` or `should` rather than `filter`?",
          "a": "Yes, when the condition should influence ranking rather than restrict results. For example, `should: [{ term: { is_premium: true } }]` with a boost lifts premium listings without excluding others, and recency can be expressed as a `should` range or a `function_score` decay. A `must` on a structured field only makes sense if you want it to add a constant score. Using `filter` for those would remove the ranking signal. The rule: restrict → filter, rank → should/function_score."
        }
      ],
    },
    {
      id: 'search-systems-mcq-04',
      difficulty: 'hard',
      question:
        'Typeahead was built with the mapping below. Typing "hea" returns "hello kitty mug" and "headphones" with similar scores. Why?',
      code: {
        language: 'json',
        code: `"title_ac": {
  "type": "text",
  "analyzer": "autocomplete_index"
}
// autocomplete_index = standard tokenizer + lowercase + edge_ngram(min 1, max 15)`,
      },
      options: [
        'min_gram of 1 makes the index too large, so Lucene falls back to fuzzy matching for short prefixes',
        'Without a search_analyzer, the query "hea" is also edge-n-grammed into h, he, hea, so it matches any token starting with "h"',
        'edge_ngram must be used as a tokenizer rather than a token filter or it produces infix grams',
        'BM25 length normalisation gives short n-grams identical IDF so ranking becomes random',
      ],
      correct: [1],
      explanation:
        'When search_analyzer is not set, the index analyzer is used at query time too, so the query becomes OR(h, he, hea) and "h" matches "hello". Set search_analyzer to standard. Lucene does not fall back to fuzzy, the edge_ngram filter produces prefixes (not infixes), and IDF differs per gram — the real problem is query-side analysis.',
      followUps: [
        {
          "q": "You set `search_analyzer: standard`. A user types \"Headph\" in upper case and with a trailing space. Does it still match, and what about \"headphone\" matching \"headphones\"?",
          "a": "The standard analyzer lowercases and tokenizes on whitespace, so \"Headph \" becomes the single token `headph`, which matches the indexed edge-gram `headph` as long as `max_gram` ≥ 6. If `max_gram` is 5, the longest stored gram is `headp` and the query fails, so set max_gram to ~15–20 or use `search_as_you_type`. \"headphone\" matches because it is a prefix of \"headphones\". The reverse (\"headphones\" query vs a doc that only says \"headphone\") needs stemming on a separate subfield."
        },
        {
          "q": "The edge-gram field made the index 4× larger. How would you reduce it while keeping typeahead fast?",
          "a": "Limit what gets n-grammed: only the title (not the description), `min_gram: 2` instead of 1 (single letters match almost everything anyway), and `max_gram` around 15. Use `index_options: docs` on the gram subfield since positions and frequencies aren't needed for prefix matching, and set `norms: false`. Alternatively use the `index_prefixes` option on a text field, which stores prefixes 2–5 chars efficiently and lets `match_phrase_prefix` handle longer ones. Measure each change with `_disk_usage` (ES 7.15+) to see the per-field cost."
        }
      ],
    },
    {
      id: 'search-systems-mcq-05',
      difficulty: 'hard',
      question:
        'Users occasionally see an OLD price in search that had been corrected an hour earlier. The pipeline is Postgres → Debezium → Kafka → indexer → ES. Select ALL that can cause an older version to overwrite a newer one.',
      options: [
        'The Kafka message key is the event id rather than the product id',
        'The indexer processes messages from one partition concurrently with Promise.all',
        'A backfill job replays old events using plain index requests without external versions',
        'refresh_interval was raised from 1s to 30s on the live index',
        'The index has one replica instead of two',
      ],
      correct: [0, 1, 2],
      explanation:
        'Keying by event id scatters one product across partitions, concurrent processing within a partition breaks order, and unversioned replays overwrite newer docs — all three let stale writes land last. A longer refresh interval only delays visibility (by up to 30 s), it never regresses data, and the replica count does not affect write ordering because replicas apply the primary\'s operations.',
      followUps: [
        {
          "q": "You fix all three causes. How would you prove the index has converged with Postgres, and find any products still stale?",
          "a": "Run a reconciliation job: scan Postgres by id range (e.g. 10K ids per batch, ordered by id) and fetch `_id` + `version` from ES with an `mget` or a `terms` query on the same ids. Compare versions; for mismatches or missing docs, enqueue a re-index event. Expose metrics: drift count per run and age of the oldest mismatch. Running it nightly on a replica DB keeps primary load low. For a cheaper continuous signal, sample 1,000 random ids per hour and alert if drift exceeds ~0.01%."
        },
        {
          "q": "Product id keying is in place, but one viral product gets 5,000 price updates per minute during a flash sale and its partition lags. What now?",
          "a": "Coalesce updates. The indexer re-reads the current row anyway, so it only needs to index the latest version per product within a batch: buffer events for 200–500ms, keep the highest version per product id, and send one bulk item. 5,000 updates/min becomes ~2 per second for that product. External versioning makes it safe to drop intermediate versions. If the partition also holds other products, the coalescing frees most of its throughput. Debezium log compaction on the topic helps for replays but not live lag."
        }
      ],
    },
    {
      id: 'search-systems-mcq-06',
      difficulty: 'hard',
      question:
        'A mobile client paginates with from/size; at from=9,990,size=20 it gets "Result window is too large". A teammate proposes raising index.max_result_window to 1,000,000. What is the best response?',
      options: [
        'Accept it: the limit is arbitrary and only affects the coordinating node memory',
        'Use the scroll API for the mobile infinite list, since it keeps a search context per user',
        'Switch to search_after with a unique tiebreaker (optionally with a point in time) and cap UI depth',
        'Increase the number of primary shards so each shard handles a smaller window',
      ],
      correct: [2],
      explanation:
        'With from/size, every shard must produce from+size hits and the coordinator sorts shards × (from+size), so cost grows with depth; the limit protects the heap on data and coordinating nodes. search_after makes each page constant cost. Scroll is not intended for user-facing paging (and is no longer recommended for deep pagination), and more shards actually increases the total work.',
      followUps: [
        {
          "q": "The mobile app also has a \"jump to page 37\" control used by 0.5% of users. How do you serve it with search_after?",
          "a": "You can't jump directly with a cursor, so change the product: cap jumps at a shallow depth (e.g. pages 1–50 with from/size, which is ≤ 1,000 hits and cheap) and use cursors for scrolling beyond that. If jumps truly must go deep, precompute cursors: when a user pages, return a sparse list of cursors for every 10th page. Most mature engines (Google, Amazon) stop at a few hundred results — users who need page 500 need better filters, not pagination."
        },
        {
          "q": "With search_after and no PIT, documents are being indexed while the user scrolls. What anomalies can the user see, and when is that acceptable?",
          "a": "Each page runs against the latest refreshed view, so a new or re-scored document can appear above the cursor (never shown) or below it (shown), and an updated sort value can make a doc appear twice or be skipped. For infinite-scroll consumer search this is acceptable — users don't notice a missing listing among thousands. For exports or compliance, open a point in time (`pit` with `keep_alive: 1m`, renewed each page) so every page sees the same snapshot; the cost is holding old segments open, which delays merges and uses disk."
        }
      ],
    },
    {
      id: 'search-systems-mcq-07',
      difficulty: 'hard',
      question:
        'An integration test indexes 20 documents into a 5-shard index and asserts the order of results. It passes locally but fails randomly in CI, with scores differing for identical documents. What is the most likely explanation?',
      options: [
        'BM25 includes a random tie-breaking component seeded per node',
        'IDF is computed from per-shard statistics, and with so few docs each shard sees very different term frequencies',
        'Replicas have different analyzers until the cluster turns green',
        'The query cache returns stale scores from a previous test run',
      ],
      correct: [1],
      explanation:
        'BM25 uses shard-local document frequencies; with 20 docs over 5 shards, the same term has very different IDF on each shard, and which copy answers can vary. Use 1 shard in tests or search_type=dfs_query_then_fetch. BM25 is deterministic, replicas share the same mapping, and the query cache caches filters, not scores.',
      followUps: [
        {
          "q": "Production indices have millions of documents, but one small tenant's index has 300 docs across 5 shards and users report odd ranking. Do you use dfs_query_then_fetch in production for it?",
          "a": "Not as a blanket setting — DFS adds an extra round trip to every shard to collect term statistics, roughly doubling latency for that query. The better fix is structural: small indices should have 1 primary shard (a 300-doc index needs no sharding at all). Use shard-per-size rules in index templates or a shared multi-tenant index with routing so tenants get realistic global statistics. Reserve `dfs_query_then_fetch` for rare cases where the shard count can't change and ranking quality matters more than a few ms."
        },
        {
          "q": "Even with 1 shard, a test asserting exact order for two documents with identical scores is still flaky. Why, and how do you write the test properly?",
          "a": "Ties are broken by internal Lucene doc id, which depends on segment layout and merges, so it can change between runs or after a refresh. Add an explicit secondary sort (`sort: ['_score', { id: 'asc' }]`) in the production query too, so behaviour is deterministic for users as well. In tests, assert relative ordering where scores differ, and for ties assert set membership. Also call `refresh` after indexing test fixtures, or use `refresh: 'wait_for'`, so the test doesn't race the refresh interval."
        }
      ],
    },
    {
      id: 'search-systems-mcq-08',
      difficulty: 'hard',
      question:
        'This query powers typo tolerance for short product names. It is slow and returns noisy matches such as "car", "cut", "bat" for "cat". Which change best fixes both problems?',
      code: {
        language: 'json',
        code: `{
  "query": {
    "match": {
      "title": { "query": "cat", "fuzziness": 2, "prefix_length": 0, "max_expansions": 50 }
    }
  }
}`,
      },
      options: [
        'Raise max_expansions to 500 so the right term is guaranteed to be among the expansions',
        'Use fuzziness AUTO with prefix_length 1 and add an exact match clause with a higher boost',
        'Replace match with a wildcard query "*cat*" which is cheaper than fuzzy',
        'Set transpositions to false so fewer candidate terms are generated',
      ],
      correct: [1],
      explanation:
        'Two edits on a 3-letter word match almost any 1–5 letter word; AUTO allows only 1 edit for 3–5 char terms, prefix_length 1 prunes the term dictionary walk, and boosting exact matches keeps "cat" on top. More expansions increases cost and noise, a leading wildcard is far more expensive, and disabling transpositions barely changes the candidate set.',
      followUps: [
        {
          "q": "Fuzziness AUTO + prefix_length 1 is still too slow at 8K QPS on a 50M-term dictionary. What else can you do?",
          "a": "Only run fuzzy when needed: execute the exact query first and fall back to fuzzy only for zero or low results (typically 5–15% of queries), which removes most of the cost. Also restrict fuzzy to the title field, not description. Build a spelling-correction layer from query logs and the term dictionary (\"did you mean\") to rewrite \"headphnes\" → \"headphones\" before the search, cached per query. Lower `max_expansions` to ~20–50. Monitor per-query took time for queries that triggered fuzzy separately."
        },
        {
          "q": "How would you measure whether the change improved relevance rather than just latency?",
          "a": "Build an offline judgment set: a few hundred real typo queries from logs paired with the products users eventually clicked or bought, and score NDCG@10 or MRR before and after with the `_rank_eval` API. Online, A/B test with zero-result rate, click-through on the first page, and search-to-purchase conversion as metrics, plus a guardrail that queries with no typos don't lose ranking quality. A fuzzy change that cuts zero results but lowers conversion means it is matching noisy terms."
        }
      ],
    },
    {
      id: 'search-systems-mcq-09',
      difficulty: 'expert',
      question:
        'A multi-tenant index routes by tenant_id. One tenant holds 35% of the documents and its shard\'s node is pegged at 95% CPU. You want to keep tenant queries from fanning out to all 24 shards. Which change best fits?',
      options: [
        'Remove custom routing so documents are spread by _id across all shards',
        'Set index.routing_partition_size (e.g. 4) in a new index so each tenant spans a small subset of shards',
        'Increase number_of_replicas to 5 on the existing index and keep routing unchanged',
        'Call _split on the index so the hot shard is divided into two halves automatically',
      ],
      correct: [1],
      explanation:
        'routing_partition_size spreads each routing key over a subset of shards: a tenant query touches ~4 shards instead of 1 or all 24, and the whale no longer sits on one node. Removing routing forces every query to fan out to all shards; more replicas help read load but writes and data size still concentrate on one primary; _split multiplies every shard and routing still maps the tenant to a subset determined by the hash, without targeting the skew. For extreme whales a dedicated index is the other answer.',
      followUps: [
        {
          "q": "You create the new index with routing_partition_size 4. How do you migrate the live tenant traffic to it without losing writes?",
          "a": "Same pattern as any reindex: create the new index with the new settings, record the CDC (Kafka) offset, backfill with `_reindex` or from the DB using external versions, then replay CDC from the recorded offset into the new index until the lag is near zero. Dual-consume into both indices for a while, compare counts and sampled queries, then flip the read alias atomically. Keep the old index for rollback for a few days. Note `routing_partition_size` must be set at creation and requires `_routing` to be required on the mapping."
        },
        {
          "q": "The whale tenant keeps growing to 60% of all documents. When do you give it a dedicated index or cluster instead, and what does that cost?",
          "a": "When its shard group dominates CPU or disk on several nodes or its query profile differs (heavy aggregations, custom analyzers), isolation is cleaner: a dedicated index with its own shard count sized for its data (e.g. 20 shards for 600 GB), optionally on dedicated nodes via allocation filtering. Costs: more indices to manage (mappings, alias per tenant, migrations multiplied), and small tenants' leftover index may become over-sharded. Many SaaS search platforms use a tiered model: pooled index for the long tail, dedicated indices above a size threshold."
        }
      ],
    },
    {
      id: 'search-systems-mcq-10',
      difficulty: 'expert',
      question:
        'You must change the analyzer of the title field on a live 2 TB index fed by CDC, with zero downtime. Select ALL steps that belong in a correct plan.',
      options: [
        'Create a new index with the new analyzer and switch readers via an atomic alias update',
        'Record the CDC offset (or start a new consumer group) before starting the backfill, then replay from it',
        'Close the index, update the analysis settings, reopen it — existing documents are re-analyzed on open',
        'Use external versioning so backfilled documents and replayed CDC events cannot overwrite newer data',
        'Use PUT _mapping to change the analyzer of the existing title field',
      ],
      correct: [0, 1, 3],
      explanation:
        'A new index + alias swap, capturing the offset before backfill, and versioned writes give a lossless, reversible migration. Closing and reopening lets you add or modify analyzer definitions, but already-indexed segments keep their old tokens, so existing docs are not re-analyzed. PUT _mapping cannot change the analyzer of an existing field.',
      followUps: [
        {
          "q": "Backfill done and CDC lag is near zero. Before flipping the alias, how do you verify the new analyzer won't hurt users?",
          "a": "Compare both indices with real traffic: shadow a sample (e.g. 5%) of production queries to the new index, log both result lists, and compute overlap@10 and differences per query; review the queries with the largest divergence manually. Run the `_rank_eval` judgment set against both. Check performance: p99 latency and index size on the new index. Then flip the alias for a small cohort via an application-level flag before flipping the alias globally, watching zero-result rate and CTR. Rollback is a single alias update back."
        },
        {
          "q": "The backfill of 2 TB takes ~6 hours, but the Kafka topic retention is only 4 hours. What goes wrong and how do you fix the plan?",
          "a": "The recorded offset is deleted before the backfill finishes, so you can't replay the changes made during it and the new index silently misses up to 2 hours of updates. Options: extend topic retention to well beyond the backfill duration (e.g. 24–48h) before starting; or start a second consumer group writing into the new index from the start, in parallel with the backfill — external versioning makes order irrelevant between the two. Also alert on consumer lag approaching retention, which is the generic guard against silent loss."
        }
      ],
    },
    {
      id: 'search-systems-mcq-11',
      difficulty: 'expert',
      question:
        'A seller stuffs the word "cheap" 25 times into a long product description to rank for "cheap headphones". The index uses default BM25 (k1=1.2, b=0.75). What is the realistic effect?',
      options: [
        'Score for "cheap" grows roughly linearly with the 25 repetitions, so the listing dominates results',
        'The TF contribution saturates near (k1+1) times the single-occurrence weight, and the longer field is penalised by length normalisation, so the gain is small',
        'BM25 ignores repeated terms entirely and scores only presence, so there is zero gain',
        'The IDF of "cheap" becomes negative because it appears so many times, so the listing is demoted',
      ],
      correct: [1],
      explanation:
        'BM25 TF is tf×(k1+1)/(tf + k1×norm), which approaches k1+1 (2.2) as tf grows, and b=0.75 reduces scores for longer-than-average fields. Linear growth describes classic TF-IDF, which is why it was vulnerable to stuffing. BM25 does count TF, and IDF depends on how many documents contain the term, not repetitions inside one — Lucene\'s IDF formula is also never negative.',
      followUps: [
        {
          "q": "The seller now creates 500 near-duplicate listings, each with \"cheap headphones\" in the title. BM25 can't stop this. What can?",
          "a": "This is spam at the collection level, so handle it outside per-document scoring: near-duplicate detection at index time (MinHash/SimHash on title + image hash) to cluster and suppress duplicates; result diversification or field collapsing (`collapse` on seller_id or a duplicate-cluster id) so one seller occupies at most N slots on page one; and quality signals in ranking (seller rating, conversion rate, returns) via `function_score` or a learning-to-rank model. Policy enforcement (listing limits per seller) complements it."
        },
        {
          "q": "Short titles of 3 words rank above detailed 12-word titles for the same query. Which BM25 parameter would you tune, and how would you verify the change?",
          "a": "`b` controls length normalisation (0 = none, 1 = full). For titles, where length mostly reflects useful detail rather than verbosity, lowering b to around 0.3–0.5 via a custom `similarity` on the title field reduces the penalty on longer titles. The similarity is set in the mapping, so you need a new index (or a new subfield) to test it. Verify with `_rank_eval` on a judged query set and an A/B test on CTR, and use `explain: true` on sample queries to confirm the tf-norm component actually changed."
        }
      ],
    },
    {
      id: 'search-systems-mcq-12',
      difficulty: 'expert',
      question:
        'An export job pages through products sorted by price with search_after. The exported file has duplicate and missing products even though no documents changed. Why?',
      code: {
        language: 'typescript',
        code: `let after: unknown[] | undefined;
do {
  const res = await es.search({
    index: 'products', size: 1000,
    sort: [{ price: 'asc' }],
    search_after: after,
  });
  write(res.hits.hits);
  after = res.hits.hits.at(-1)?.sort;
} while (after);`,
      },
      options: [
        'search_after requires the sort to be on _score, so price sorting is non-deterministic',
        'Many products share the same price; without a unique tiebreaker, the cursor cannot tell which tied products were already returned',
        'size 1000 exceeds the maximum for search_after, so Elasticsearch silently truncates pages',
        'The job must use from = page × 1000 together with search_after for correctness',
      ],
      correct: [1],
      explanation:
        'search_after returns hits strictly after the last sort values; with ties on price, the boundary is ambiguous and ordering among tied docs can vary between requests, causing skips and repeats. Add a unique tiebreaker (product_id, or _shard_doc with a PIT, which also freezes the view). search_after works with any sort, size 1000 is fine, and from must be 0/omitted with search_after.',
      followUps: [
        {
          "q": "You add `product_id` as a tiebreaker. The export takes 40 minutes and products are updated during it. How do you get a consistent snapshot?",
          "a": "Open a point in time (`POST products/_pit?keep_alive=5m`) and pass its id on every page with `search_after`, sorting by `[price, _shard_doc]` (the cheapest unique tiebreaker within a PIT). All pages read the same frozen set of segments, so updates during the 40 minutes are invisible and no doc is skipped or repeated. Renew keep_alive each request and close the PIT at the end. Cost: segments are retained for the duration, so merged-away segments aren't freed — watch disk on heavily updated indices."
        },
        {
          "q": "The export must cover 200M products and finish within an hour. Is a single search_after stream fast enough, and how would you parallelize it?",
          "a": "A single stream at ~1,000 docs per page and ~100ms per page is ~10K docs/s → 200M takes ~5.5 hours, too slow. Use sliced search: split the PIT into N slices (`slice: { id: i, max: N }`), each with its own search_after stream, run by N workers. With 8 slices at ~10K docs/s each you get ~80K docs/s → ~42 minutes. Keep N ≤ shard count to avoid per-slice overhead, and stream output to object storage in parts so a crashed worker can resume from its last cursor."
        }
      ],
    },
    {
      id: 'search-systems-mcq-13',
      difficulty: 'expert',
      question:
        'To "use all the memory", ops set a 64 GB JVM heap on 128 GB data nodes. GC pauses got longer and search got slower. Which explanation is most accurate?',
      options: [
        'Above ~31–32 GB the JVM loses compressed object pointers, and the larger heap halves the OS page cache that Lucene relies on',
        'Elasticsearch caps its internal caches at 32 GB, so the extra heap is unused but GC scans it anyway',
        'Lucene segments are loaded into heap, and 64 GB of segments causes full GCs on every merge',
        'Large heaps force Elasticsearch to use the serial garbage collector',
      ],
      correct: [0],
      explanation:
        'Past the compressed-oops threshold every pointer doubles in size, so a 64 GB heap may hold little more than ~31 GB would, and it takes page cache away from Lucene\'s memory-mapped files, which is what makes search fast. Guidance: heap ≤ 50% RAM and below the compressed-oops cutoff. Caches are not hard-capped at 32 GB, segments live mostly off-heap in the page cache, and the collector choice is independent of heap size.',
      followUps: [
        {
          "q": "You set the heap to 30 GB. How do you confirm compressed oops are actually enabled and that the page cache is doing its job?",
          "a": "Elasticsearch logs `compressed ordinary object pointers [true]` at startup; you can also check `GET _nodes/jvm` for `using_compressed_ordinary_object_pointers`. With heaps near the limit, zero-based compressed oops (best performance) typically stop around 26–30 GB, so 30 GB may still be non-zero-based — check the JVM flag output. For page cache, watch OS memory (`free -m` buff/cache ~ 30+ GB) and disk read IOPS: under steady query load, reads should be mostly served from memory, with near-zero disk reads for the hot index."
        },
        {
          "q": "With a 30 GB heap, the circuit breaker trips on heavy aggregations (\"Data too large\"). Do you raise the breaker limit or the heap?",
          "a": "Neither first. The parent breaker (default 95% of heap with the real-memory breaker) protects the node from OOM; raising it just trades a 429 for a node crash. Fix the query: a huge `terms` aggregation with high cardinality and large `size`, or aggregations on `text` fields with fielddata, are the usual culprits. Use `composite` aggregation to page through buckets, lower `size`/`shard_size`, use keyword doc values instead of fielddata, or pre-aggregate in a rollup or transform index. Scale out (more nodes) only if legitimate load needs it."
        }
      ],
    },
    {
      id: 'search-systems-mcq-14',
      difficulty: 'expert',
      question:
        'Search p99 rose from 150 ms to 1.5 s with no traffic increase and healthy nodes. Select ALL query-shape changes from the latest release that plausibly explain it.',
      options: [
        'A new "contains" filter implemented as a wildcard query "*term*" on a keyword field',
        'A terms aggregation on user_id (50M distinct values) with size 10,000 added to every search',
        'A function_score script that computes distance and discount per matching document',
        'Moving the category condition from must into bool.filter',
        'Replacing match on sku with a term query on the sku keyword field',
      ],
      correct: [0, 1, 2],
      explanation:
        'Leading wildcards scan the term dictionary, a huge high-cardinality terms aggregation is CPU- and memory-heavy on every shard, and per-document scripts run for every match. Moving a condition to filter context and using term on a keyword field both make queries cheaper, not slower.',
      followUps: [
        {
          "q": "Which tool shows you which part of a single slow query is expensive, and what would the leading-wildcard case look like in it?",
          "a": "Use the Profile API (`profile: true`) or Kibana's Search Profiler. It breaks down time per shard by query component (`build_scorer`, `next_doc`, `advance`) and by aggregation, plus rewrite time. A `*term*` wildcard shows as a `MultiTermQueryConstantScoreWrapper` with a large `rewrite_time` — the term dictionary scan — and high `build_scorer` time across many terms. A script score shows as high `score` time proportional to matched documents. Use it on a sample of slow-log queries, not on every request (it's expensive)."
        },
        {
          "q": "You can't roll back the release for a week. How do you protect the cluster from these query shapes now?",
          "a": "Apply guardrails at the cluster and gateway level: set `search.allow_expensive_queries: false` (rejects leading wildcards, scripts, joins on ES 7.7+); lower `search.max_buckets`; set a default `timeout` and `search.default_search_timeout`; and reduce the terms aggregation size in the query layer via config. Route heavy queries to a separate set of coordinating nodes or rate-limit them per API key. Enable the search slow log at, say, 500ms to measure the effect of each step."
        }
      ],
    },
    {
      id: 'search-systems-mcq-15',
      difficulty: 'expert',
      question:
        'Typeahead for a B2B catalogue must return suggestions in < 50 ms, respect per-customer price lists and entitlements (thousands of distinct combinations), exclude out-of-stock items, and tolerate one typo. Which design fits best?',
      options: [
        'Completion suggester with a context for each customer entitlement combination',
        'A search_as_you_type (or edge n-gram) field queried with bool.filter for entitlements and stock, plus bounded fuzziness',
        'An offline query-log trie with top-k completions per prefix served from memory',
        'A wildcard prefix query "term*" on the title keyword field with a post_filter for entitlements',
      ],
      correct: [1],
      explanation:
        'Edge n-gram / search_as_you_type fields support the full query DSL, so arbitrary filters, stock, and fuzziness combine in one fast query. Completion suggester contexts are predeclared categories/geo and do not scale to thousands of dynamic entitlement combinations or stock filters; a query-log trie suggests queries, not entitled documents; and a prefix query on keyword only matches the start of the whole title and is slower.',
      followUps: [
        {
          "q": "Entitlements change: a customer loses access to a product line. How do you make that take effect in typeahead within a minute?",
          "a": "Don't encode entitlements per document per customer — a product line change would reindex millions of docs. Index stable product attributes (`product_line_id`, `price_list_ids`), and at query time build the filter from the customer's entitlements (`terms: { product_line_id: [...] }`) loaded from a cache with a ~30–60s TTL or invalidated by an event. Entitlement changes then apply at the next query without touching the index. If the entitlement list is huge, use the terms lookup query, which fetches the list from a document in another index."
        },
        {
          "q": "Measured p99 is 80 ms, not 50. Where would you look for the extra 30 ms, step by step?",
          "a": "Break latency down: (1) client/network — compare app-side timing with ES `took`; if `took` is ~40ms, the rest is network, TLS, or JSON parsing/serialisation in the app. (2) Fan-out — a typeahead index should have few shards (1–3 for a few GB); 12 shards multiply per-query overhead. (3) Query — profile the fuzziness and the terms filter; fuzzy on every keystroke is costly, so apply fuzziness only after 3+ chars. (4) Fetch phase — return only needed fields via `_source` includes. (5) Cache — short prefixes (1–2 chars) are hot and cacheable at the app layer."
        }
      ],
    },
  ],
};

export default topic;
