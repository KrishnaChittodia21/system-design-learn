// Pure model of a monthly tournament leaderboard in a Redis sorted set (no React, Node-testable).
//   member order = score DESC; for equal scores Redis orders members lexicographically, and
//   ZREVRANGE / ZREVRANK reverse that, so a later name in the alphabet ranks HIGHER on a tie.
//   Composite tie-break: score = points × 2^32 + (2^32 − 1 − secondsSinceMonthStart), so among
//   equal points the earlier achiever has the larger score.
//   Costs: SQL "my rank" = COUNT(*) WHERE score > mine → a scan of ~n rows; ZREVRANK = O(log n)
//   via the skip list's span counts.
import type { BaseFrame } from '../../core';

export type Tie = 'member' | 'time';

export interface Params {
  tie: Tie;
  /** players in the tournament, in millions */
  players: number;
}

export const DEFAULT_PARAMS: Params = { tie: 'member', players: 25 };
export const KEY = 'lb:2026-09';
export const ME = 'zoe';
export const TOP = 3;

export interface Entry {
  member: string;
  points: number;
  /** seconds since month start when the current points were reached */
  at: number;
}

export const INITIAL: Entry[] = [
  { member: 'ana', points: 5, at: 10 },
  { member: 'ben', points: 4, at: 8 },
  { member: 'cai', points: 4, at: 12 },
  { member: 'dev', points: 3, at: 5 },
  { member: 'eli', points: 2, at: 3 },
  { member: 'fay', points: 2, at: 7 },
  { member: 'gus', points: 1, at: 2 },
  { member: 'zoe', points: 2, at: 9 },
];

/** match wins in order: [member, time] */
export const WINS: [string, number][] = [
  ['zoe', 20],
  ['eli', 21],
  ['zoe', 22],
  ['cai', 24],
  ['zoe', 25],
  ['ana', 26],
  ['zoe', 27],
  ['zoe', 29],
];

const TWO32 = 2 ** 32;
const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** how a member is named in captions */
export const who = (m: string) => (m === ME ? `${m} (you)` : m);
export const composite = (e: Entry) => e.points * TWO32 + (TWO32 - 1 - e.at);

/** ZREVRANGE order under the given tie policy */
export function ranked(entries: Entry[], tie: Tie): Entry[] {
  return [...entries].sort((a, b) => {
    if (tie === 'time') return composite(b) - composite(a);
    if (b.points !== a.points) return b.points - a.points;
    return a.member < b.member ? 1 : a.member > b.member ? -1 : 0; // reverse lexicographic
  });
}

export interface Frame extends BaseFrame {
  order: Entry[];
  moved: string | null;
  /** previous 0-based rank of the moved member */
  from: number | null;
  op: string;
  myRank: number;
  /** members tied with someone, by points */
  ties: string[];
  sqlRows: number;
  zsetHops: number;
}

export function simulate({ tie, players }: Params): Frame[] {
  const n = players * 1_000_000;
  const entries = INITIAL.map((e) => ({ ...e }));
  const frames: Frame[] = [];
  const hops = Math.ceil(Math.log2(n));

  const snap = (caption: string, moved: string | null, from: number | null, op: string, predict?: string) => {
    const order = ranked(entries, tie);
    const myRank = order.findIndex((e) => e.member === ME);
    const counts = new Map<number, number>();
    for (const e of order) counts.set(e.points, (counts.get(e.points) ?? 0) + 1);
    frames.push({
      caption,
      predict,
      order: order.map((e) => ({ ...e })),
      moved,
      from,
      op,
      myRank,
      ties: order.filter((e) => (counts.get(e.points) ?? 0) > 1).map((e) => e.member),
      sqlRows: n,
      zsetHops: hops,
    });
  };

  snap(
    `The ${KEY} sorted set holds every player's wins this month (8 shown; the real set has ${players}M members). Internally it is a hash (member → score) plus a skip list ordered by score.`,
    null,
    null,
    `ZREVRANGE ${KEY} 0 ${TOP - 1} WITHSCORES`,
  );

  WINS.forEach(([member, at], i) => {
    const before = ranked(entries, tie).findIndex((e) => e.member === member);
    const e = entries.find((x) => x.member === member)!;
    e.points++;
    e.at = at;
    const order = ranked(entries, tie);
    const after = order.findIndex((x) => x.member === member);
    const tied = order.filter((x) => x.points === e.points && x.member !== member);
    const op = tie === 'member' ? `ZINCRBY ${KEY} 1 ${member}` : `ZADD ${KEY} ${e.points}·2³² + (2³²−1−${at}) ${member}`;
    let tieNote = '';
    if (tied.length) {
      const above = tied.filter((x) => order.indexOf(x) < after).map((x) => x.member);
      const below = tied.filter((x) => order.indexOf(x) > after).map((x) => x.member);
      tieNote =
        tie === 'member'
          ? ` It ties on ${e.points} with ${and(tied.map((x) => x.member))}. Redis breaks the tie by member name (reverse order in ZREVRANGE), so ${member} lands ${below.length ? `above ${and(below)}` : ''}${below.length && above.length ? ' and ' : ''}${above.length ? `below ${and(above)}` : ''}, regardless of who got there first.`
          : ` It ties on ${e.points} points with ${and(tied.map((x) => x.member))}. The composite score ranks the earlier achiever higher, so ${member} (reached at ${at}s) lands ${below.length ? `above ${and(below)}` : ''}${below.length && above.length ? ' and ' : ''}${above.length ? `below ${and(above)}` : ''}.`;
    }
    const moveNote = after < before ? `climbs from #${before + 1} to #${after + 1}` : after === before ? `stays at #${after + 1}` : `drops to #${after + 1}`;
    const me = entries.find((x) => x.member === ME)!;
    const nextTied = WINS[i + 1]?.[0] === ME ? entries.filter((x) => x.member !== ME && x.points === me.points + 1).map((x) => x.member) : [];
    snap(
      `${who(member)} wins a match: ${tie === 'member' ? 'ZINCRBY adds 1 in O(log n)' : 'a Lua script reads the points and ZADDs the new composite score, O(log n)'}, and ${member} ${moveNote}.${tieNote}`,
      member,
      before,
      op,
      nextTied.length ? `${ME} (you) wins next and will tie with ${and(nextTied)} on ${me.points + 1}. Who ranks higher?` : undefined,
    );
  });

  const order = ranked(entries, tie);
  snap(
    `Final board: ${order
      .slice(0, TOP)
      .map((e, i) => `#${i + 1} ${e.member} (${e.points})`)
      .join(', ')}. "What is my rank?" was one ZREVRANK (~${hops} skip-list hops for ${players}M players) instead of an SQL COUNT(*) over ~${players}M rows. ${
      tie === 'member' ? 'Name-based ties are deterministic but unfair; encode time into the score to reward who got there first.' : 'Composite scores keep ties fair and deterministic within a double\'s 53 bits of precision.'
    }`,
    null,
    null,
    `ZREVRANK ${KEY} ${ME} → ${order.findIndex((e) => e.member === ME)}`,
  );
  return frames;
}
