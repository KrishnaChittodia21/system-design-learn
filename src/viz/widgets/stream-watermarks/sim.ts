// Pure simulation of event-time tumbling windows driven by a bounded-out-of-orderness watermark.
//   watermark = max event time seen − delay
//   window [s, s+10) fires once the watermark reaches s+10
//   an event whose window has already fired (and whose allowed lateness has passed) is "late"
// Late events are dropped, applied as an updated result (allowed lateness), or sent to a side output.
import type { BaseFrame } from '../../core';

export type LatePolicy = 'drop' | 'allowed' | 'side';

export interface Params {
  /** bounded out-of-orderness, in seconds */
  delay: number;
  late: LatePolicy;
}

export interface Ev {
  id: number;
  /** event time (when it happened) */
  e: number;
  /** processing time (when the stream processor sees it) */
  p: number;
}

export type Fate = 'ontime' | 'update' | 'dropped' | 'side';

export interface Win {
  start: number;
  end: number;
  /** events counted in the last emitted (or pending) result */
  count: number;
  /** every event that belongs to it, regardless of fate (ground truth) */
  truth: number;
  /** processing time of the first emission, null while pending */
  firedAt: number | null;
  /** count in the first emission */
  firstCount: number | null;
  updates: number;
  dropped: number;
  side: number;
  /** state discarded: later events can no longer update it */
  closed: boolean;
}

export interface Frame extends BaseFrame {
  /** events processed so far, with their fate */
  seen: { ev: Ev; fate: Fate }[];
  cur: number;
  maxE: number;
  /** watermark history: [processing time, watermark] after each event */
  wm: [number, number][];
  windows: Win[];
}

export const WINDOW = 10;
export const N_WINDOWS = 6;
export const ALLOWED_LATENESS = 10;
export const P_MAX = 60;
export const E_MAX = 60;

/** events in arrival (processing-time) order; most arrive 1–3 s after they happen, four are badly delayed */
export const EVENTS: Ev[] = (
  [
    [1, 2],
    [4, 5],
    [3, 6],
    [8, 9],
    [12, 13],
    [15, 16],
    [6, 18], // phone was offline: arrives 12 s after it happened
    [18, 20],
    [22, 23],
    [11, 25], // 14 s in transit
    [25, 27],
    [28, 29],
    [33, 34],
    [19, 36], // 17 s in transit
    [36, 38],
    [39, 40],
    [27, 42], // 15 s in transit
    [44, 45],
    [47, 49],
    [52, 53],
    [55, 57],
    [58, 59],
  ] as const
).map(([e, p], i) => ({ id: i + 1, e, p }));

const windowOf = (e: number) => Math.floor(e / WINDOW);

export function simulate({ delay, late }: Params): Frame[] {
  const windows: Win[] = Array.from({ length: N_WINDOWS }, (_, k) => ({
    start: k * WINDOW,
    end: (k + 1) * WINDOW,
    count: 0,
    truth: 0,
    firedAt: null,
    firstCount: null,
    updates: 0,
    dropped: 0,
    side: 0,
    closed: false,
  }));
  const seen: Frame['seen'] = [];
  const wm: [number, number][] = [];
  let maxE = -Infinity;
  let watermark = -Infinity;
  const lateness = late === 'allowed' ? ALLOWED_LATENESS : 0;
  const policy =
    late === 'drop'
      ? 'late events are dropped (and counted in a metric)'
      : late === 'allowed'
        ? `windows keep state for ${ALLOWED_LATENESS} s of allowed lateness, so late events re-emit an updated result (the sink must upsert)`
        : 'late events go to a side output for a correction job';

  const snap = () => windows.map((w) => ({ ...w }));
  const frames: Frame[] = [
    {
      seen: [],
      cur: -1,
      maxE: 0,
      wm: [],
      windows: snap(),
      caption: `${EVENTS.length} click events arrive over ${P_MAX} s of processing time. We count them in ${WINDOW}-second tumbling windows by EVENT time. Watermark = newest event time seen − ${delay} s; a window fires when the watermark passes its end; ${policy}.`,
    },
  ];

  EVENTS.forEach((ev, idx) => {
    const k = windowOf(ev.e);
    const w = windows[k];
    w.truth++;
    let fate: Fate;
    const behind = maxE === -Infinity ? 0 : maxE - ev.e;
    if (w.firedAt === null) {
      w.count++;
      fate = 'ontime';
    } else if (!w.closed) {
      w.count++;
      w.updates++;
      fate = 'update';
    } else if (late === 'side') {
      w.side++;
      fate = 'side';
    } else {
      w.dropped++;
      fate = 'dropped';
    }
    maxE = Math.max(maxE, ev.e);
    watermark = maxE - delay;
    wm.push([ev.p, watermark]);
    const fired: Win[] = [];
    for (const x of windows) {
      if (x.firedAt === null && x.end <= watermark) {
        x.firedAt = ev.p;
        x.firstCount = x.count;
        fired.push(x);
      }
      if (x.firedAt !== null && !x.closed && x.end + lateness <= watermark) x.closed = true;
    }
    seen.push({ ev, fate });

    const label = `[${w.start},${w.end})`;
    let caption = `p=${ev.p}s: event #${ev.id} with event time ${ev.e}s arrives${behind > 0 ? ` (${behind} s behind the newest event)` : ''}. `;
    if (fate === 'ontime') caption += `Window ${label} is still open, so it is counted (${w.count}).`;
    else if (fate === 'update') caption += `Window ${label} already fired with ${w.firstCount}, but it is within allowed lateness: an UPDATED result ${w.count} is emitted.`;
    else if (fate === 'side') caption += `Window ${label} is closed — the event is LATE and goes to the side output for later correction.`;
    else caption += `Window ${label} has already fired — the event is LATE and dropped; that window's result is now wrong forever (${w.count} reported, ${w.truth} true).`;
    caption += ` Watermark → ${watermark}s.`;
    if (fired.length)
      caption += ` It passes ${fired.map((x) => `${x.end}s, so [${x.start},${x.end}) fires: count ${x.firstCount} (${x.firedAt! - x.end} s after the window ended)`).join('; ')}.`;

    let predict: string | undefined;
    const next = EVENTS[idx + 1];
    if (next && maxE - next.e > 8 && windowOf(next.e) !== windowOf(maxE))
      predict = `Next: an event from ${next.e}s arrives while the newest is ${maxE}s (watermark ${watermark}s). Has window [${windowOf(next.e) * WINDOW},${(windowOf(next.e) + 1) * WINDOW}) already fired?`;

    if (idx === EVENTS.length - 1) {
      const done = windows.filter((x) => x.firedAt !== null);
      const lat = done.length ? done.reduce((s, x) => s + (x.firedAt! - x.end), 0) / done.length : 0;
      const exact = done.filter((x) => x.firstCount === x.truth).length;
      const lost = windows.reduce((s, x) => s + x.dropped, 0);
      const pending = windows.filter((x) => x.firedAt === null && x.truth > 0).length;
      const ups = windows.reduce((s, x) => s + x.updates, 0);
      caption += ` Summary at delay ${delay}s: ${done.length} window${done.length === 1 ? '' : 's'} emitted (${pending} still waiting for the watermark), on average ${lat.toFixed(1)} s after the window ended; ${exact}/${done.length} complete on first emission; ${
        ups ? `${ups} updated result${ups === 1 ? '' : 's'} re-emitted; ` : ''
      }${lost} event${lost === 1 ? '' : 's'} dropped${late === 'side' ? `, ${windows.reduce((s, x) => s + x.side, 0)} parked in the side output` : ''}. A bigger delay means later but more complete results.`;
    }

    frames.push({ seen: [...seen], cur: idx, maxE, wm: [...wm], windows: snap(), caption, predict });
  });
  return frames;
}
