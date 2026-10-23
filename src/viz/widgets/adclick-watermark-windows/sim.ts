// Pure model of a streaming click aggregator with 10 s tumbling windows (no React, Node-testable).
//   Event-time mode: watermark = max event time seen − allowed lateness. A window [s, s+10) fires
//   (emits its count) once the watermark reaches s+10. A click whose window already fired is LATE:
//   either dropped (the billed count stays low) or applied as a correction (an upsert of the row).
//   Processing-time mode: a click is counted in the window of its ARRIVAL time, and a window fires as
//   soon as the clock passes its end. No click is ever late, but clicks land in the wrong window.
//   Duplicates (a retried click with the same click_id) are always discarded by id.
import type { BaseFrame } from '../../core';

export type TimeMode = 'event' | 'processing';
export type LatePolicy = 'drop' | 'update';

export interface Params {
  mode: TimeMode;
  lateness: number;
  policy: LatePolicy;
}

export const DEFAULT_PARAMS: Params = { mode: 'event', lateness: 2, policy: 'drop' };

export const WINDOW = 10;
export const WINDOWS = 3;
export const AXIS_END = WINDOWS * WINDOW;

export interface Click {
  id: string;
  /** processing (arrival) time */
  p: number;
  /** event time (when the click happened) */
  e: number;
}

/** arrival order; c6 is retried by the client and arrives twice */
export const CLICKS: Click[] = [
  { id: 'c1', p: 2, e: 1 },
  { id: 'c2', p: 4, e: 3 },
  { id: 'c3', p: 6, e: 6 },
  { id: 'c4', p: 8, e: 5 },
  { id: 'c5', p: 11, e: 9 },
  { id: 'c6', p: 12, e: 11 },
  { id: 'c7', p: 13, e: 4 },
  { id: 'c6', p: 14, e: 11 },
  { id: 'c8', p: 16, e: 15 },
  { id: 'c9', p: 19, e: 17 },
  { id: 'c10', p: 21, e: 13 },
  { id: 'c11', p: 23, e: 22 },
  { id: 'c12', p: 26, e: 24 },
  { id: 'c13', p: 28, e: 19 },
  { id: 'c14', p: 29, e: 27 },
];

export type ClickStatus = 'counted' | 'late-dropped' | 'late-corrected' | 'duplicate' | 'misbucketed' | 'spilled';

export interface ClickView extends Click {
  status: ClickStatus;
  /** window it was counted in (processing mode may differ from the true one) */
  win: number;
}

export interface WindowView {
  /** count emitted downstream (null = not fired yet) */
  emitted: number | null;
  /** running count inside the operator */
  running: number;
  truth: number;
  firedAt: number | null;
  corrections: number;
  dropped: number;
}

export interface Frame extends BaseFrame {
  now: number;
  clicks: ClickView[];
  windows: WindowView[];
  watermark: number | null;
  maxEvent: number | null;
  /** index in `clicks` of the click that arrived in this step */
  current: number;
  fired: number[];
}

const winOf = (t: number) => Math.floor(t / WINDOW);

export function truthCounts(): number[] {
  const seen = new Set<string>();
  const out = Array(WINDOWS).fill(0);
  for (const c of CLICKS) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out[winOf(c.e)]++;
  }
  return out;
}

export function simulate({ mode, lateness, policy }: Params): Frame[] {
  const truth = truthCounts();
  const wins: WindowView[] = truth.map((t) => ({ emitted: null, running: 0, truth: t, firedAt: null, corrections: 0, dropped: 0 }));
  const clicks: ClickView[] = [];
  const seen = new Set<string>();
  let maxEvent: number | null = null;
  const frames: Frame[] = [];
  const ev = mode === 'event';

  const watermark = () => (maxEvent === null ? null : maxEvent - lateness);

  const snap = (now: number, caption: string, current: number, fired: number[], predict?: string) =>
    frames.push({
      caption,
      predict,
      now,
      clicks: clicks.map((c) => ({ ...c })),
      windows: wins.map((w) => ({ ...w })),
      watermark: ev ? watermark() : null,
      maxEvent: ev ? maxEvent : null,
      current,
      fired,
    });

  snap(
    0,
    ev
      ? `Clicks are counted per ad in 10 s tumbling windows by EVENT time (when the click happened). Watermark = max event time seen − allowed lateness (${lateness} s). A window fires when the watermark passes its end.`
      : `Clicks are counted in 10 s tumbling windows by PROCESSING time (when the aggregator receives them). A window fires as soon as the clock passes its end.`,
    -1,
    [],
  );

  CLICKS.forEach((c, idx) => {
    const fired: number[] = [];
    const parts: string[] = [];
    const lag = c.p - c.e;
    const head = `t=${c.p}s: ${c.id} arrives (event time ${c.e}s${lag > 2 ? `, ${lag}s late` : ''}).`;

    if (seen.has(c.id)) {
      clicks.push({ ...c, status: 'duplicate', win: ev ? winOf(c.e) : winOf(c.p) });
      snap(c.p, `${head} It is a client retry of a click already counted: the click_id dedup store discards it, so the count is not inflated.`, clicks.length - 1, fired);
      return;
    }
    seen.add(c.id);

    if (!ev) {
      // fire every window whose end the clock has passed
      for (let w = 0; w < WINDOWS; w++) {
        if (wins[w].firedAt === null && c.p >= (w + 1) * WINDOW) {
          wins[w].emitted = wins[w].running;
          wins[w].firedAt = c.p;
          fired.push(w);
        }
      }
      const w = winOf(c.p);
      const right = winOf(c.e);
      if (w >= WINDOWS) {
        clicks.push({ ...c, status: 'spilled', win: w });
        parts.push(`It belongs to W${right} but arrives after t=${WINDOWS * WINDOW}s, so it is counted in a later window that is off this chart.`);
      } else {
        wins[w].running++;
        clicks.push({ ...c, status: w === right ? 'counted' : 'misbucketed', win: w });
        parts.push(w === right ? `Counted in W${w}.` : `It happened in W${right} but is counted in W${w} because that is when it arrived: the billed minute is wrong.`);
      }
      if (fired.length) parts.unshift(`The clock passed the end of ${fired.map((x) => `W${x}`).join(', ')}, which fires with ${fired.map((x) => wins[x].emitted).join(', ')}.`);
      snap(c.p, `${head} ${parts.join(' ')}`, clicks.length - 1, fired);
      return;
    }

    // event time
    const w = winOf(c.e);
    if (wins[w].firedAt !== null) {
      if (policy === 'update') {
        wins[w].running++;
        wins[w].emitted = wins[w].running;
        wins[w].corrections++;
        clicks.push({ ...c, status: 'late-corrected', win: w });
        parts.push(`W${w} already fired, so this is a LATE event. Policy "update": the aggregator re-emits W${w} = ${wins[w].emitted} as an upsert that overwrites the stored row.`);
      } else {
        wins[w].dropped++;
        clicks.push({ ...c, status: 'late-dropped', win: w });
        parts.push(`W${w} already fired, so this is a LATE event. Policy "drop": it is discarded and W${w} stays at ${wins[w].emitted} (true count ${wins[w].truth}). The advertiser is under-billed.`);
      }
    } else {
      wins[w].running++;
      clicks.push({ ...c, status: 'counted', win: w });
      parts.push(`Added to W${w} (running count ${wins[w].running}).`);
    }
    maxEvent = maxEvent === null ? c.e : Math.max(maxEvent, c.e);
    const wm = watermark()!;
    for (let k = 0; k < WINDOWS; k++) {
      if (wins[k].firedAt === null && wm >= (k + 1) * WINDOW) {
        wins[k].emitted = wins[k].running;
        wins[k].firedAt = c.p;
        fired.push(k);
      }
    }
    parts.push(`Watermark = ${maxEvent} − ${lateness} = ${wm < 0 ? `−${-wm}` : wm}s.`);
    if (fired.length) parts.push(`It has passed the end of ${fired.map((x) => `W${x}`).join(', ')}, which fires with ${fired.map((x) => wins[x].emitted).join(', ')}.`);
    const nextLate = CLICKS.slice(idx + 1).find((n) => !seen.has(n.id) && winOf(n.e) < WINDOWS && wins[winOf(n.e)].firedAt !== null && n.e < wm);
    snap(
      c.p,
      `${head} ${parts.join(' ')}`,
      clicks.length - 1,
      fired,
      fired.length && nextLate ? `A click from W${winOf(nextLate.e)} is still in flight. What happens when it arrives?` : undefined,
    );
  });

  // end of input: flush every open window
  const end = CLICKS[CLICKS.length - 1].p + 4;
  const flushed: number[] = [];
  for (let k = 0; k < WINDOWS; k++) {
    if (wins[k].firedAt === null) {
      wins[k].emitted = wins[k].running;
      wins[k].firedAt = end;
      flushed.push(k);
    }
  }
  snap(
    end,
    flushed.length
      ? `The demo input ends, so the remaining open windows (${flushed.map((x) => `W${x}`).join(', ')}) are flushed.`
      : 'The demo input ends; every window has already fired.',
    -1,
    flushed,
  );

  const wrong = wins.filter((w) => w.emitted !== w.truth).length;
  const latency = wins.map((w, k) => (w.firedAt ?? end) - (k + 1) * WINDOW);
  snap(
    end,
    ev
      ? wrong
        ? `Result: ${wrong} of ${WINDOWS} windows emitted the wrong count because late clicks were dropped. Raising the allowed lateness waits longer before firing (W0 closed ${latency[0]}s after its end) but catches more stragglers.`
        : `Result: every window matches the true count${wins.some((w) => w.corrections) ? ', thanks to correction upserts' : ''}. W0 was emitted ${latency[0]}s after its end: allowed lateness buys accuracy with latency.`
      : `Result: ${wrong} of ${WINDOWS} windows are wrong. Processing-time windows fire promptly but bill clicks to the minute they arrived, not the minute they happened. Billing must use event time.`,
    -1,
    [],
  );

  return frames;
}
