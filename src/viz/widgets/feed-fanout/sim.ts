// Pure simulation of news-feed fan-out: push (fan-out on write), pull (fan-out on read) and
// the hybrid (push for normal authors, pull + merge for celebrities). Counts timeline writes
// and read-time queries for a small cast of authors plus "you". No React here.
import type { BaseFrame } from '../../core';

export type Strategy = 'push' | 'pull' | 'hybrid';

export interface Params {
  strategy: Strategy;
  /** followers of the celebrity author */
  celebFollowers: number;
  /** rounds of posting; each round every author posts once and then you open your feed */
  rounds: number;
}

export interface Author {
  id: string;
  name: string;
  followers: number;
  celeb: boolean;
}

/** accounts "you" follow, including the 4 simulated authors */
export const YOU_FOLLOW = 150;
/** hybrid: authors at or above this follower count are not fanned out */
export const CELEB_THRESHOLD = 100_000;
/** fan-out fleet throughput, timeline inserts per second */
export const FANOUT_PER_SEC = 1_000_000;

export function authors(celebFollowers: number): Author[] {
  return [
    { id: 'A', name: 'Alice', followers: 200, celeb: false },
    { id: '★', name: 'Celeb ★', followers: celebFollowers, celeb: true },
    { id: 'B', name: 'Bob', followers: 350, celeb: false },
    { id: 'C', name: 'Carol', followers: 120, celeb: false },
  ];
}

/** does this strategy push this author's posts into follower timelines? */
export function pushes(strategy: Strategy, a: Author): boolean {
  if (strategy === 'push') return true;
  if (strategy === 'pull') return false;
  return a.followers < CELEB_THRESHOLD;
}

/** read-time work for one feed open: timeline reads + per-author outbox queries */
export function readCost(strategy: Strategy, list: Author[]): { timeline: number; outbox: number } {
  if (strategy === 'push') return { timeline: 1, outbox: 0 };
  if (strategy === 'pull') return { timeline: 0, outbox: YOU_FOLLOW };
  // hybrid: your precomputed timeline + the celebrities you follow
  return { timeline: 1, outbox: list.filter((a) => !pushes('hybrid', a)).length };
}

export interface FeedItem {
  post: string;
  /** how it got into your feed */
  via: 'timeline' | 'merge';
}

export type Event =
  | { type: 'intro' }
  | { type: 'post'; author: number; post: string; pushed: boolean; writes: number; lagSec: number }
  | { type: 'read'; timeline: number; outbox: number }
  | { type: 'summary' };

export interface Frame extends BaseFrame {
  event: Event;
  /** cumulative timeline inserts per author */
  writesBy: number[];
  /** posts stored per author (their outbox / recent list) */
  postsBy: number[];
  /** total timeline inserts so far */
  timelineWrites: number;
  /** total read-time queries so far (timeline reads + outbox queries) */
  readQueries: number;
  feedOpens: number;
  /** what you saw on your last feed open, newest first */
  feed: FeedItem[];
}

export function fmt(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtLag(sec: number): string {
  if (sec < 1) return `${+(sec * 1000).toFixed(1)}ms`;
  if (sec < 120) return `${+sec.toFixed(1)}s`;
  return `${+(sec / 60).toFixed(1)} min`;
}

export function simulate({ strategy, celebFollowers, rounds }: Params): Frame[] {
  const list = authors(celebFollowers);
  const writesBy = list.map(() => 0);
  const postsBy = list.map(() => 0);
  const posted: { post: string; author: number }[] = [];
  let timelineWrites = 0;
  let readQueries = 0;
  let feedOpens = 0;
  let feed: FeedItem[] = [];
  const frames: Frame[] = [];
  const celebIdx = list.findIndex((a) => a.celeb);
  const celeb = list[celebIdx];
  const celebPushed = pushes(strategy, celeb);
  const rc = readCost(strategy, list);

  const snap = (event: Event, caption: string, predict?: string) =>
    frames.push({
      event,
      writesBy: [...writesBy],
      postsBy: [...postsBy],
      timelineWrites,
      readQueries,
      feedOpens,
      feed: feed.map((x) => ({ ...x })),
      caption,
      predict,
    });

  const intro: Record<Strategy, string> = {
    push: 'Fan-out on write (push): every new post is copied into each follower\'s precomputed timeline, so reading a feed is one cache lookup.',
    pull: 'Fan-out on read (pull): a post is stored once in its author\'s list; each feed open queries everyone you follow and merges the results.',
    hybrid: `Hybrid: authors under ${fmt(CELEB_THRESHOLD)} followers are pushed to timelines; celebrities are not, and their recent posts are merged in at read time.`,
  };
  snap(
    { type: 'intro' },
    `${intro[strategy]} Cast: Alice (200 followers), Bob (350), Carol (120) and a celebrity with ${fmt(celebFollowers)}. You follow ${YOU_FOLLOW} accounts, including all four.`,
  );

  for (let r = 1; r <= rounds; r++) {
    for (let ai = 0; ai < list.length; ai++) {
      const a = list[ai];
      const post = `${a.id}${r}`;
      const pushed = pushes(strategy, a);
      const writes = pushed ? a.followers : 0;
      postsBy[ai]++;
      writesBy[ai] += writes;
      timelineWrites += writes;
      posted.push({ post, author: ai });
      const lagSec = writes / FANOUT_PER_SEC;
      let caption: string;
      if (pushed) {
        caption = `${a.name} posts ${post}: stored once, then ${fmt(writes)} timeline inserts, one per follower (write amplification ×${fmt(writes)}).`;
        if (a.celeb)
          caption += ` At ${fmt(FANOUT_PER_SEC)} inserts/s the last follower sees it after ~${fmtLag(lagSec)}, and the fan-out queue is jammed meanwhile.`;
      } else if (strategy === 'hybrid') {
        caption = `${a.name} has ${fmt(a.followers)} followers (≥ ${fmt(CELEB_THRESHOLD)}), so ${post} is NOT fanned out: 1 write to the celebrity's recent list instead of ${fmt(a.followers)} timeline inserts.`;
      } else {
        caption = `${a.name} posts ${post}: 1 write to ${a.name}'s own recent list. Zero timeline inserts, whatever the follower count (${fmt(a.followers)}).`;
      }
      let predict: string | undefined;
      // just before the celebrity's first post
      if (r === 1 && ai === celebIdx - 1)
        predict =
          strategy === 'hybrid'
            ? `The celebrity (${fmt(celebFollowers)} followers) posts next. Will hybrid fan it out, and how many timeline writes will it cost?`
            : `The celebrity (${fmt(celebFollowers)} followers) posts next. How many timeline writes will that one post cost under ${strategy}?`;
      // just before your first feed open
      if (r === 1 && ai === list.length - 1)
        predict = `You now open your feed. You follow ${YOU_FOLLOW} accounts. How many lookups does building the page take under ${strategy}?`;
      snap({ type: 'post', author: ai, post, pushed, writes, lagSec }, caption, predict);
    }

    // you open your feed
    feedOpens++;
    readQueries += rc.timeline + rc.outbox;
    feed = posted
      .slice()
      .reverse()
      .slice(0, 8)
      .map((p) => ({ post: p.post, via: pushes(strategy, list[p.author]) ? ('timeline' as const) : ('merge' as const) }));
    let caption: string;
    if (strategy === 'push') caption = `You open your feed: 1 read of your precomputed timeline. The posts are already there, so read cost is O(1).`;
    else if (strategy === 'pull')
      caption = `You open your feed: ${YOU_FOLLOW} outbox queries (one per account you follow, most of them returning nothing new), then a ${YOU_FOLLOW}-way merge by time. Read cost is O(followees).`;
    else
      caption =
        rc.outbox > 0
          ? `You open your feed: 1 timeline read + ${rc.outbox} celebrity list query, merged by time = ${rc.timeline + rc.outbox} lookups. The celebrity's posts are the only ones merged at read time.`
          : `You open your feed: 1 timeline read. With ${fmt(celebFollowers)} followers the "celebrity" is under the threshold, so it was pushed like everyone else.`;
    caption += ` Feed opens so far: ${feedOpens}, read lookups so far: ${fmt(readQueries)}.`;
    snap({ type: 'read', timeline: rc.timeline, outbox: rc.outbox }, caption);
  }

  // totals and the platform-scale extrapolation
  const posts = rounds * list.length;
  snap(
    { type: 'summary' },
    `Totals for ${posts} posts and ${feedOpens} feed opens: ${fmt(timelineWrites)} timeline writes and ${fmt(readQueries)} read lookups. ${writesBy[celebIdx] > 0 ? `The celebrity alone caused ${fmt(writesBy[celebIdx])} of the writes (${Math.round((100 * writesBy[celebIdx]) / Math.max(1, timelineWrites))}%).` : 'The celebrity caused none of the timeline writes.'}`,
  );
  const perRead = rc.timeline + rc.outbox;
  const scale: Record<Strategy, string> = {
    push: `At platform scale (30K feed reads/s, 1.2K posts/s × 200 avg followers) push costs ~240K inserts/s plus ${fmt(celebFollowers)} inserts per celebrity post; reads stay at 30K lookups/s. Celebrities are the problem.`,
    pull: `At platform scale (30K feed reads/s × ${YOU_FOLLOW} followees) pull costs ~${fmt(30_000 * YOU_FOLLOW)} outbox queries/s with merges, while writes are only 1.2K/s. Reads are the problem.`,
    hybrid: `At platform scale hybrid pays ~240K inserts/s for normal authors${celebPushed ? ` (and ${fmt(celebFollowers)} per post here, since this celebrity is under the threshold)` : ', nothing extra for celebrities'}, and about 30K × ${perRead} = ${fmt(30_000 * perRead)} read lookups/s. That is why Twitter-style feeds use it.`,
  };
  snap({ type: 'summary' }, scale[strategy]);
  return frames;
}
