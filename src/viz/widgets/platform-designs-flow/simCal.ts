// Calendar free/busy: each calendar's busy index is range-scanned for the day, local times are
// resolved in their own IANA zone (with or without US DST in effect), intervals are merged, and
// the merged busy time is subtracted from the intersection of everyone's working hours.
import type { FlowEdge, FlowFrame, Tone } from './types';

export type CalDate = 'mar2' | 'mar16';

export interface CalParams {
  date: CalDate;
  duration: number; // minutes
}

/** [start, end) in minutes after 00:00 UTC */
export type Interval = [number, number];

export interface Person {
  id: string;
  name: string;
  zone: string;
  /** UTC offset in minutes for each date */
  offset: Record<CalDate, number>;
  work: [string, string]; // local HH:MM
  busy: { title: string; start: string; end: string }[];
}

export const PEOPLE: Person[] = [
  {
    id: 'priya',
    name: 'Priya',
    zone: 'Asia/Kolkata',
    offset: { mar2: 330, mar16: 330 },
    work: ['12:00', '21:00'],
    busy: [{ title: 'design review', start: '19:00', end: '19:30' }],
  },
  {
    id: 'sam',
    name: 'Sam',
    zone: 'America/New_York',
    offset: { mar2: -300, mar16: -240 },
    work: ['09:00', '17:00'],
    busy: [{ title: 'daily standup (RRULE)', start: '09:00', end: '09:30' }],
  },
  {
    id: 'lena',
    name: 'Lena',
    zone: 'Europe/London',
    offset: { mar2: 0, mar16: 0 },
    work: ['09:00', '17:00'],
    busy: [{ title: '1:1', start: '14:45', end: '15:15' }],
  },
];

/** a room calendar, stored in UTC */
export const ROOM_BUSY: Interval[] = [[15 * 60, 15 * 60 + 30]];

export const hm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
export const fmt = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Resolve a local wall-clock time on this date to minutes UTC. */
export function toUtc(local: string, offsetMin: number): number {
  return hm(local) - offsetMin;
}

export function merge(intervals: Interval[]): Interval[] {
  const s = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const s = Math.max(a[0], b[0]);
  const e = Math.min(a[1], b[1]);
  return e > s ? [s, e] : null;
}

/** window minus merged busy intervals */
export function subtract(window: Interval, busy: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cur = window[0];
  for (const [a, b] of merge(busy)) {
    if (b <= cur || a >= window[1]) continue;
    if (a > cur) out.push([cur, Math.min(a, window[1])]);
    cur = Math.max(cur, b);
  }
  if (cur < window[1]) out.push([cur, window[1]]);
  return out;
}

export function freeSlots(date: CalDate): { window: Interval | null; busy: Interval[]; free: Interval[] } {
  let window: Interval | null = [0, 1440];
  const busy: Interval[] = [...ROOM_BUSY];
  for (const p of PEOPLE) {
    const w: Interval = [toUtc(p.work[0], p.offset[date]), toUtc(p.work[1], p.offset[date])];
    window = window ? intersect(window, w) : null;
    for (const b of p.busy) busy.push([toUtc(b.start, p.offset[date]), toUtc(b.end, p.offset[date])]);
  }
  const merged = merge(busy);
  return { window, busy: merged, free: window ? subtract(window, merged) : [] };
}

export interface CalRow {
  id: string;
  label: string;
  work?: Interval;
  busy: { iv: Interval; label: string }[];
  tone: Tone;
}

export interface CalFrame extends FlowFrame {
  rows: CalRow[];
  window: Interval | null;
  merged: Interval[];
  free: Interval[];
  pick: Interval | null;
}

const zoneShort = (p: Person, d: CalDate) => {
  const o = p.offset[d];
  const sign = o >= 0 ? '+' : '−';
  const a = Math.abs(o);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${a % 60}` : ''}`;
};

export function simulateCal({ date, duration }: CalParams): CalFrame[] {
  const frames: CalFrame[] = [];
  const rows: CalRow[] = [];
  let window: Interval | null = null;
  let merged: Interval[] = [];
  let free: Interval[] = [];
  let pick: Interval | null = null;
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, rows: rows.map((r) => ({ ...r, busy: r.busy.map((b) => ({ ...b })) })), window, merged: merged.map((m) => [...m] as Interval), free: free.map((m) => [...m] as Interval), pick });
  const dlabel = date === 'mar2' ? 'Monday 2 March 2026 (US still on standard time)' : 'Monday 16 March 2026 (US on daylight time since 8 March; UK not until 29 March)';

  snap({}, [], `"Find ${duration} minutes for Priya (Bengaluru), Sam (New York), Lena (London) and room 3B" on ${dlabel}. Free/busy reads only busy intervals, never titles, and works in UTC.`);
  for (const p of PEOPLE) {
    const off = p.offset[date];
    const busy = p.busy.map((b) => ({ iv: [toUtc(b.start, off), toUtc(b.end, off)] as Interval, label: `${b.start} local` }));
    rows.push({ id: p.id, label: `${p.name} · ${zoneShort(p, date)}`, work: [toUtc(p.work[0], off), toUtc(p.work[1], off)], busy, tone: 'accent' });
    const extra =
      p.id === 'sam'
        ? ` His 09:00 standup is an RRULE expanded on the local date in America/New_York, so it lands at ${fmt(toUtc('09:00', off))} UTC on this date${date === 'mar16' ? ' (it was 14:00 before DST: "add 7 × 24 h in UTC" would have moved it to 10:00 local)' : ''}.`
        : p.id === 'priya'
          ? ' India has no DST, so her offset never changes; she works a late shift to overlap with the US.'
          : ' The UK switches a few weeks after the US, so London and New York are 5 or 4 hours apart depending on the week.';
    snap(
      { svc: 'accent', idx: 'accent' },
      [{ from: 'svc', to: 'idx', label: `range scan ${p.name}`, tone: 'accent' }],
      `${p.name} (${p.zone}, ${zoneShort(p, date)}): working hours ${p.work[0]}–${p.work[1]} local = ${fmt(toUtc(p.work[0], off))}–${fmt(toUtc(p.work[1], off))} UTC; busy ${p.busy.map((b) => `${b.start}–${b.end} local = ${fmt(toUtc(b.start, off))}–${fmt(toUtc(b.end, off))} UTC`).join(', ')}.${extra}`,
    );
  }
  rows.push({ id: 'room', label: 'Room 3B · UTC', busy: ROOM_BUSY.map((iv) => ({ iv, label: 'booked' })), tone: 'mag' });
  snap({ svc: 'accent', idx: 'accent' }, [{ from: 'svc', to: 'idx', label: 'room bitmap', tone: 'mag' }], `Room 3B is busy ${ROOM_BUSY.map((iv) => `${fmt(iv[0])}–${fmt(iv[1])}`).join(', ')} UTC (rooms are pre-aggregated as one bit per 15-minute slot).`);

  const r = freeSlots(date);
  window = r.window;
  snap(
    { svc: 'good' },
    [],
    window ? `Intersect everyone's working hours: ${fmt(window[0])}–${fmt(window[1])} UTC (${window[1] - window[0]} minutes). Outside this window someone is asleep or off.` : 'The working hours do not overlap at all: no meeting time exists on this date.',
    'Which parts of the shared window survive once every busy interval is removed?',
  );
  merged = r.busy;
  snap({ svc: 'good' }, [], `Merge all busy intervals into one sorted list: ${merged.map((m) => `${fmt(m[0])}–${fmt(m[1])}`).join(', ')} UTC. Adjacent meetings collapse into one block.`);
  free = r.free;
  const fits = free.filter(([a, b]) => b - a >= duration);
  pick = fits.length ? [fits[0][0], fits[0][0] + duration] : null;
  snap(
    { svc: pick ? 'good' : 'bad' },
    [],
    `Subtract busy from the window: free ${free.length ? free.map((m) => `${fmt(m[0])}–${fmt(m[1])} (${m[1] - m[0]} min)`).join(', ') : 'nothing'}. ${
      pick
        ? `Earliest ${duration}-minute slot: ${fmt(pick[0])}–${fmt(pick[1])} UTC = ${fmt(pick[0] + 330)} for Priya, ${fmt(pick[0] + PEOPLE[1].offset[date])} for Sam, ${fmt(pick[0])} for Lena.`
        : `No gap is ${duration} minutes long${date === 'mar2' ? '. Try 16 March: US DST moves Sam\'s day an hour earlier in UTC and opens the window.' : '. Try a shorter meeting.'}`
    }`,
  );
  return frames;
}
