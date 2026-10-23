// Pure simulation of a client scrolling a newest-first feed page by page while other users
// insert new posts (and optionally delete one) between page fetches.
//   offset: LIMIT n OFFSET (page-1)*n  — positions shift under writes → duplicates / skipped rows
//   cursor: WHERE (created_at, id) < cursor LIMIT n+1 — anchored to a row → stable
import type { BaseFrame } from '../../core';

export type Mode = 'offset' | 'cursor';

export interface Params {
  mode: Mode;
  /** new posts inserted at the head between two page fetches */
  inserts: number;
  /** someone deletes a post you already saw, before page 3 */
  del: boolean;
}

export interface Frame extends BaseFrame {
  kind: 'intro' | 'write' | 'fetch' | 'summary';
  /** server table, newest first (post ids; higher id = newer) */
  table: number[];
  /** ids inserted in this step (highlight) */
  inserted: number[];
  deleted: number | null;
  /** pages received so far */
  pages: number[][];
  /** rows the DB walked for the latest fetch (offset rows are read then discarded) */
  scanned: number[];
  returned: number[];
  sql: string;
  /** id the next cursor points after (cursor mode) */
  cursor: number | null;
  dups: number[];
  missed: number[];
  totalScanned: number;
}

export const PAGE = 5;
export const PAGES = 4;
export const INITIAL = 30;
export const DELETED_ID = 27;

/** base64url of an ASCII string (opaque cursor), no padding */
export function b64url(s: string) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < s.length; i += 3) {
    const n = (s.charCodeAt(i) << 16) | ((s.charCodeAt(i + 1) || 0) << 8) | (s.charCodeAt(i + 2) || 0);
    const len = Math.min(3, s.length - i);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (len > 1 ? A[(n >> 6) & 63] : '') + (len > 2 ? A[n & 63] : '');
  }
  return out;
}

export const cursorFor = (id: number) => b64url(`{"id":${id}}`);

export function simulate({ mode, inserts, del }: Params): Frame[] {
  let table = Array.from({ length: INITIAL }, (_, i) => INITIAL - i);
  let nextId = INITIAL + 1;
  const pages: number[][] = [];
  const seen = new Set<number>();
  const dups: number[] = [];
  let cursor: number | null = null;
  let totalScanned = 0;
  const frames: Frame[] = [];
  const base = (): Pick<Frame, 'table' | 'pages' | 'dups' | 'totalScanned' | 'cursor'> => ({
    table: [...table],
    pages: pages.map((p) => [...p]),
    dups: [...dups],
    totalScanned,
    cursor,
  });
  // posts that existed when scrolling started, are older than the newest one shown, were never shown and still exist
  const missedNow = () => {
    if (!pages.length) return [];
    const oldestShown = Math.min(...pages.flat());
    return table.filter((id) => id <= INITIAL && id >= oldestShown && !seen.has(id));
  };

  frames.push({
    kind: 'intro',
    ...base(),
    inserted: [],
    deleted: null,
    scanned: [],
    returned: [],
    sql: mode === 'offset' ? 'GET /posts?limit=5&offset=0' : 'GET /posts?limit=5',
    missed: [],
    caption: `A newest-first feed of ${INITIAL} posts (#${INITIAL} is newest). The client scrolls ${PAGES} pages of ${PAGE} using ${
      mode === 'offset' ? 'offset/limit' : 'an opaque cursor (keyset on created_at, id)'
    }. Between fetches ${inserts === 0 ? 'nobody writes' : `${inserts} new post${inserts > 1 ? 's are' : ' is'} published at the head`}${del ? `, and before page 3 someone deletes #${DELETED_ID}, which you already saw` : ''}.`,
  });

  for (let n = 1; n <= PAGES; n++) {
    if (n > 1 && (inserts > 0 || (del && n === 3))) {
      const ins = Array.from({ length: inserts }, () => nextId++).reverse();
      table = [...ins, ...table];
      let deleted: number | null = null;
      if (del && n === 3) {
        table = table.filter((id) => id !== DELETED_ID);
        deleted = DELETED_ID;
      }
      const parts = [];
      if (ins.length) parts.push(`${ins.length} new post${ins.length > 1 ? 's' : ''} (${ins.map((i) => `#${i}`).join(', ')}) land at the head`);
      if (deleted) parts.push(`#${deleted} is deleted`);
      const shift = ins.length - (deleted ? 1 : 0);
      frames.push({
        kind: 'write',
        ...base(),
        inserted: ins,
        deleted,
        scanned: [],
        returned: [],
        sql: '',
        missed: missedNow(),
        caption: `While you read page ${n - 1}, ${parts.join(' and ')}. ${
          mode === 'offset'
            ? `Every older row's POSITION shifts by ${shift >= 0 ? '+' : ''}${shift}, but your next offset (${(n - 1) * PAGE}) does not know that.`
            : `Your cursor still points just after #${cursor}: positions changed, the anchor did not.`
        }`,
        predict:
          n === 2 && mode === 'offset' && inserts > 0
            ? `Page ${n} asks for OFFSET ${(n - 1) * PAGE}. After ${inserts} insert${inserts > 1 ? 's' : ''} at the head, which rows sit at positions ${(n - 1) * PAGE + 1}–${n * PAGE}?`
            : n === 3 && del && mode === 'offset'
              ? `A row you already saw was deleted, so everything older moves UP one position. What does OFFSET ${(n - 1) * PAGE} now skip?`
              : undefined,
      });
    }

    let returned: number[];
    let scanned: number[];
    let sql: string;
    if (mode === 'offset') {
      const off = (n - 1) * PAGE;
      scanned = table.slice(0, off + PAGE);
      returned = table.slice(off, off + PAGE);
      sql = `SELECT … ORDER BY created_at DESC, id DESC LIMIT ${PAGE} OFFSET ${off}`;
    } else {
      const after = cursor === null ? table : table.filter((id) => id < cursor!);
      scanned = after.slice(0, PAGE + 1);
      returned = after.slice(0, PAGE);
      sql = cursor === null ? `SELECT … ORDER BY created_at DESC, id DESC LIMIT ${PAGE + 1}` : `SELECT … WHERE (created_at, id) < ($ts, ${cursor}) ORDER BY … LIMIT ${PAGE + 1}`;
    }
    totalScanned += scanned.length;
    const newDups = returned.filter((id) => seen.has(id));
    dups.push(...newDups);
    returned.forEach((id) => seen.add(id));
    pages.push(returned);
    const prevCursor = cursor;
    if (mode === 'cursor') cursor = returned[returned.length - 1] ?? cursor;
    const missed = missedNow();
    const prevMissed = frames[frames.length - 1].missed;
    const newlyMissed = missed.filter((id) => !prevMissed.includes(id));

    let caption =
      mode === 'offset'
        ? `Page ${n}: OFFSET ${(n - 1) * PAGE} — the DB walks ${scanned.length} rows and throws away the first ${scanned.length - returned.length}. Returns ${returned.map((i) => `#${i}`).join(' ')}.`
        : `Page ${n}: ${prevCursor === null ? 'no cursor yet' : `after cursor "${cursorFor(prevCursor)}" (= #${prevCursor})`} — an index seek reads ${scanned.length} rows (limit + 1 to know there's more). Returns ${returned
            .map((i) => `#${i}`)
            .join(' ')}; next_cursor = "${cursorFor(cursor!)}".`;
    if (newDups.length)
      caption += ` DUPLICATE${newDups.length > 1 ? 'S' : ''}: ${newDups.map((i) => `#${i}`).join(', ')} ${newDups.length > 1 ? 'were' : 'was'} already on an earlier page — inserts pushed ${newDups.length > 1 ? 'them' : 'it'} down into this window.`;
    if (newlyMissed.length) caption += ` SKIPPED: ${newlyMissed.map((i) => `#${i}`).join(', ')} moved up past your offset and will never be shown.`;
    if (mode === 'cursor' && n > 1 && !newDups.length && (inserts > 0 || del)) caption += ' No duplicates, nothing skipped.';
    frames.push({ kind: 'fetch', ...base(), inserted: [], deleted: null, scanned, returned, sql, missed, caption });
  }

  const missed = missedNow();
  const newer = table.filter((id) => id > INITIAL).length;
  frames.push({
    kind: 'summary',
    ...base(),
    inserted: [],
    deleted: null,
    scanned: [],
    returned: [],
    sql: '',
    missed,
    caption:
      `Done: ${pages.flat().length} rows delivered, ${dups.length} duplicate${dups.length === 1 ? '' : 's'}, ${missed.length} skipped; the DB read ${totalScanned} rows for ${PAGES * PAGE} results. ` +
      (mode === 'offset'
        ? `Offset cost grows with depth: page 2,000 of 5 reads 10,000 rows. Under writes the window slides — fine for admin tables with "jump to page 7", wrong for feeds.`
        : `${newer ? `The ${newer} new post${newer > 1 ? 's' : ''} above the cursor appear on pull-to-refresh, not mid-scroll. ` : ''}Each page is O(limit) at any depth; the price is no random "jump to page 7".`),
  });
  return frames;
}
