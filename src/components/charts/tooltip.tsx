import type { ReactNode } from 'react';
import type { TipState } from './hooks';

/** The floating readout. Values lead (strong), labels follow; clamped inside the plot. */
export function ChartTip({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  const left = tip.w > 160 ? Math.min(Math.max(tip.x, 80), tip.w - 80) : tip.w / 2;
  return (
    <div className="dv-tip" style={{ left, top: tip.y }} aria-hidden>
      {tip.content}
    </div>
  );
}

/** A tooltip row: optional colored key (line for lines, square for fills), strong value, secondary label. */
export function TipRow({ value, label, color, kind = 'rect' }: { value: ReactNode; label: ReactNode; color?: string; kind?: 'rect' | 'line' }) {
  return (
    <div className="dv-tip-row">
      {color && <span className={`dv-key dv-key-${kind}`} style={{ background: color }} />}
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
