import { useTip } from './hooks';
import { ChartTip, TipRow } from './tooltip';

export interface Column {
  id: string;
  label: string;
  /** 0..100 */
  value: number;
  display: string;
  detail?: string;
}

const TICKS = [0, 50, 100];

/** Vertical columns on a 0–100 scale: hairline grid, ≤ 24px columns, value on the cap, one hue. */
export function ColumnChart({ columns, color = 'var(--dv-1)', height = 150 }: { columns: Column[]; color?: string; height?: number }) {
  const { ref, tip, bind } = useTip();
  return (
    <div className="dv-plot dv-columns" ref={ref}>
      <div className="dv-col-area" style={{ height }}>
        {TICKS.map((t) => (
          <div key={t} className={`dv-grid ${t === 0 ? 'base' : ''}`} style={{ bottom: `${t}%` }}>
            <span className="dv-tick">{t}%</span>
          </div>
        ))}
        <div className="dv-col-bars">
          {columns.map((c) => (
            <div
              key={c.id}
              className="dv-col-slot dv-mark"
              tabIndex={0}
              role="img"
              aria-label={`${c.label}: ${c.display}${c.detail ? `, ${c.detail}` : ''}`}
              {...bind(
                <>
                  <TipRow value={c.display} label={c.label} color={color} />
                  {c.detail && <div className="dv-tip-detail">{c.detail}</div>}
                </>,
              )}
            >
              <div className="dv-col" style={{ height: `${Math.max(0, Math.min(100, c.value))}%`, background: color, minHeight: c.value > 0 ? 3 : 0 }}>
                <span className="dv-col-value">{c.display}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="dv-col-labels" aria-hidden>
        {columns.map((c) => (
          <span key={c.id}>{c.label}</span>
        ))}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}
