import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTip, useWidth } from './hooks';
import { ChartTip, TipRow } from './tooltip';

export interface LinePoint {
  id: string;
  /** 0..100 */
  value: number;
  /** x-axis / tooltip label, e.g. a date */
  x: string;
  /** what the point is, e.g. the topic name */
  label: string;
}

const H = 170;
const PAD = { top: 14, right: 44, bottom: 24, left: 34 };
const TICKS = [0, 50, 100];

/**
 * One series on a 0–100 scale: 2px line, ≥ 8px markers with a surface ring, hairline grid, an optional reference
 * line (e.g. the pass mark), a crosshair that snaps to the nearest point, and arrow-key stepping when focused.
 */
export function LineChart({
  points,
  seriesLabel,
  color = 'var(--dv-1)',
  reference,
}: {
  points: LinePoint[];
  seriesLabel: string;
  color?: string;
  reference?: { value: number; label: string };
}) {
  const { ref: boxRef, width } = useWidth(560);
  const { ref, tip, showAt, hide } = useTip();
  const [active, setActive] = useState<number | null>(null);
  const w = Math.max(240, width);
  const iw = w - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const n = points.length;
  const xAt = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yAt = (v: number) => PAD.top + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
  const path = points.map((pt, i) => `${i ? 'L' : 'M'} ${xAt(i).toFixed(1)} ${yAt(pt.value).toFixed(1)}`).join(' ');

  const content = (i: number) => (
    <>
      <TipRow value={`${points[i].value}%`} label={points[i].label} color={color} kind="line" />
      <div className="dv-tip-detail">{points[i].x}</div>
    </>
  );
  const select = (i: number) => {
    setActive(i);
    const svg = ref.current?.querySelector('svg')?.getBoundingClientRect();
    if (svg) showAt(svg.left + xAt(i), svg.top + yAt(points[i].value), content(i));
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - box.left;
    const i = n <= 1 ? 0 : Math.round((rel / box.width) * (n - 1));
    const idx = Math.max(0, Math.min(n - 1, i));
    setActive(idx);
    const svg = ref.current?.querySelector('svg')?.getBoundingClientRect();
    if (svg) showAt(svg.left + xAt(idx), svg.top + yAt(points[idx].value), content(idx));
  };
  const clear = () => {
    setActive(null);
    hide();
  };
  const onKey = (e: KeyboardEvent<SVGRectElement>) => {
    if (!n) return;
    const cur = active ?? n - 1;
    const next = e.key === 'ArrowRight' ? cur + 1 : e.key === 'ArrowLeft' ? cur - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    select(Math.max(0, Math.min(n - 1, next)));
  };
  const last = points[n - 1];
  return (
    <div ref={boxRef} className="dv-line-box">
      <div className="dv-plot dv-line" ref={ref}>
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="group" aria-label={seriesLabel}>
          {TICKS.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={yAt(t)} y2={yAt(t)} className={t === 0 ? 'dv-axis-line' : 'dv-grid-line'} />
              <text x={PAD.left - 6} y={yAt(t)} className="dv-axis-text" textAnchor="end" dominantBaseline="middle">
                {t}%
              </text>
            </g>
          ))}
          {reference && (
            <g aria-hidden>
              <line x1={PAD.left} x2={w - PAD.right} y1={yAt(reference.value)} y2={yAt(reference.value)} className="dv-ref-line" />
              <text x={w - PAD.right + 4} y={yAt(reference.value)} className="dv-axis-text" dominantBaseline="middle">
                {reference.label}
              </text>
            </g>
          )}
          {n > 0 && (
            <>
              <text x={PAD.left} y={H - 6} className="dv-axis-text">
                {points[0].x}
              </text>
              {n > 1 && (
                <text x={w - PAD.right} y={H - 6} className="dv-axis-text" textAnchor="end">
                  {last.x}
                </text>
              )}
            </>
          )}
          {active !== null && <line x1={xAt(active)} x2={xAt(active)} y1={PAD.top} y2={PAD.top + ih} className="dv-crosshair" />}
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((pt, i) => (
            <circle key={pt.id} cx={xAt(i)} cy={yAt(pt.value)} r={active === i ? 5.5 : 4} fill={color} stroke="var(--surface)" strokeWidth={2} />
          ))}
          {last && (
            <text x={xAt(n - 1) + 9} y={yAt(last.value)} className="dv-direct-label" dominantBaseline="middle" aria-hidden>
              {last.value}%
            </text>
          )}
          <rect
            x={PAD.left - 10}
            y={PAD.top}
            width={iw + 20}
            height={ih}
            fill="transparent"
            className="dv-hit"
            tabIndex={0}
            role="img"
            aria-label={`${seriesLabel}. ${n} attempts, latest ${last ? `${last.value}% on ${last.label}` : 'none'}. Use left and right arrow keys to step through attempts.`}
            onPointerMove={onMove}
            onPointerLeave={clear}
            onFocus={() => n && select(active ?? n - 1)}
            onBlur={clear}
            onKeyDown={onKey}
          />
        </svg>
        <ChartTip tip={tip} />
      </div>
    </div>
  );
}
