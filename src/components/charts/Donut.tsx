import type { ReactNode } from 'react';
import { useTip } from './hooks';
import { ChartTip, TipRow } from './tooltip';

export interface DonutSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

const SIZE = 168;
const R = 66;
const STROKE = 18;
const GAP = 2; // px of surface between slices

function arc(start: number, end: number) {
  const c = SIZE / 2;
  const p = (a: number) => [c + R * Math.sin(a), c - R * Math.cos(a)];
  const [x0, y0] = p(start);
  const [x1, y1] = p(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Part-to-whole ring (≤ 6 slices) with a centre figure and a direct-labelled key that doubles as the legend. */
export function Donut({ slices, center, unit = '' }: { slices: DonutSlice[]; center: ReactNode; unit?: string }) {
  const { ref, tip, bind } = useTip();
  const total = slices.reduce((a, s) => a + s.value, 0);
  const shown = slices.filter((s) => s.value > 0);
  const gapAngle = shown.length > 1 ? GAP / R : 0;
  // cumulative start of each slice, as a share of the whole
  const starts = shown.map((_, i) => shown.slice(0, i).reduce((a, s) => a + s.value, 0));
  const arcs = shown.map((s, i) => {
    const start = (starts[i] / total) * Math.PI * 2;
    const end = ((starts[i] + s.value) / total) * Math.PI * 2;
    // a lone full slice is drawn as two halves so the arc is never degenerate
    const d = shown.length === 1 ? `${arc(0, Math.PI)} ${arc(Math.PI, Math.PI * 2 - 0.0001)}` : arc(start + gapAngle / 2, Math.max(start + gapAngle / 2 + 0.001, end - gapAngle / 2));
    return { s, d };
  });
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  return (
    <div className="dv-donut">
      <div className="dv-plot dv-donut-plot" ref={ref}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label="Donut chart">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--dv-track)" strokeWidth={STROKE} opacity={total ? 0 : 1} />
          {arcs.map(({ s, d }) => (
            <g key={s.id} className="dv-mark dv-donut-seg" tabIndex={0} role="img" aria-label={`${s.label}: ${s.value}${unit} (${pct(s.value)}%)`} {...bind(<TipRow value={`${s.value}${unit} · ${pct(s.value)}%`} label={s.label} color={s.color} />)}>
              <path d={d} fill="none" stroke="transparent" strokeWidth={STROKE + 12} />
              <path d={d} fill="none" stroke={s.color} strokeWidth={STROKE} className="dv-donut-arc" />
            </g>
          ))}
        </svg>
        <div className="dv-donut-center">{center}</div>
        <ChartTip tip={tip} />
      </div>
      <ul className="dv-donut-key">
        {slices.map((s) => (
          <li key={s.id}>
            <span className="dv-key dv-key-rect" style={{ background: s.color }} aria-hidden />
            <span className="dv-donut-label">{s.label}</span>
            <strong>{s.value}</strong>
            <span className="muted">{pct(s.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
