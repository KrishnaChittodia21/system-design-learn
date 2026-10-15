import type { KeyboardEvent } from 'react';
import type { ActivityCell } from '../../lib/metrics';
import { useTip } from './hooks';
import { ChartTip, TipRow } from './tooltip';

const MOVES: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const DOW = ['Mon', '', 'Wed', '', 'Fri', '', ''];

function fmt(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Study-activity calendar: weeks as columns, Monday-first rows; a studied day is filled, today is ringed.
 * Today is in the tab order; arrow keys move between days. */
export function Heatmap({ weeks }: { weeks: ActivityCell[][] }) {
  const { ref, tip, bind } = useTip();
  const monthLabel = (w: ActivityCell[], i: number) => {
    const first = w[0].day;
    const prev = i > 0 ? weeks[i - 1][0].day : '';
    return first.slice(5, 7) !== prev.slice(5, 7) ? new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, { month: 'short' }) : '';
  };
  // arrow keys move between days (only today is in the tab order)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const w = Number(el.dataset.w);
    const r = Number(el.dataset.r);
    if (Number.isNaN(w)) return;
    const d = MOVES[e.key];
    if (!d) return;
    e.preventDefault();
    e.currentTarget.querySelector<HTMLElement>(`[data-w="${w + d[0]}"][data-r="${r + d[1]}"]`)?.focus();
  };
  return (
    <div className="dv-plot dv-heat" ref={ref}>
      <div className="dv-heat-grid" style={{ ['--weeks' as string]: weeks.length }} onKeyDown={onKey}>
        <span aria-hidden />
        {weeks.map((w, i) => (
          <span key={w[0].day} className="dv-heat-month" aria-hidden>
            {monthLabel(w, i)}
          </span>
        ))}
        {DOW.map((label, row) => (
          <Row key={row} label={label} row={row} weeks={weeks} bind={bind} />
        ))}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function Row({ label, row, weeks, bind }: { label: string; row: number; weeks: ActivityCell[][]; bind: ReturnType<typeof useTip>['bind'] }) {
  return (
    <>
      <span className="dv-heat-dow" aria-hidden>
        {label}
      </span>
      {weeks.map((w, wi) => {
        const c = w[row];
        if (c.future) return <span key={c.day} className="dv-heat-cell future" aria-hidden />;
        const text = `${fmt(c.day)}${c.today ? ' (today)' : ''}: ${c.active ? 'studied' : 'no study'}`;
        return (
          <span
            key={c.day}
            className={`dv-heat-cell dv-mark ${c.active ? 'on' : ''} ${c.today ? 'today' : ''}`}
            tabIndex={c.today ? 0 : -1}
            data-w={wi}
            data-r={row}
            role="img"
            aria-label={text}
            {...bind(<TipRow value={c.active ? 'Studied' : 'No study'} label={`${fmt(c.day)}${c.today ? ' · today' : ''}`} color={c.active ? 'var(--dv-1)' : undefined} />)}
          />
        );
      })}
    </>
  );
}
