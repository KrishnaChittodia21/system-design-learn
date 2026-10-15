import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTip } from './hooks';
import { ChartTip, TipRow } from './tooltip';

export interface BarRow {
  id: string;
  label: string;
  /** 0..max */
  value: number;
  /** text at the bar tip, e.g. "62%" or "3/9" */
  display: string;
  /** extra tooltip line */
  detail?: string;
  /** makes the row a link */
  href?: string;
  /** small content under the label (e.g. actions) */
  extra?: ReactNode;
}

/**
 * Horizontal bar list: label · thin bar on a recessive track · value at the tip.
 * One series, one hue. An optional reference value draws a hairline across every track (e.g. the pass mark).
 */
export function BarList({
  rows,
  max = 100,
  color = 'var(--dv-1)',
  reference,
  seriesLabel,
}: {
  rows: BarRow[];
  max?: number;
  color?: string;
  reference?: { value: number; label: string };
  seriesLabel: string;
}) {
  const { ref, tip, bind } = useTip();
  const refPct = reference ? Math.min(100, (reference.value / max) * 100) : null;
  return (
    <div className="dv-plot dv-barlist" ref={ref}>
      {reference && refPct !== null && (
        <div className="dv-barlist-refkey small muted" aria-hidden>
          <span className="dv-key dv-key-ref" /> {reference.label}
        </div>
      )}
      <ul>
        {rows.map((r) => {
          const w = max ? Math.max(0, Math.min(100, (r.value / max) * 100)) : 0;
          const aria = `${r.label}: ${r.display}${r.detail ? `, ${r.detail}` : ''}`;
          const tipContent = (
            <>
              <TipRow value={r.display} label={r.label} color={color} />
              {r.detail && <div className="dv-tip-detail">{r.detail}</div>}
            </>
          );
          const bar = (
            <span className="dv-bar-track">
              <span className="dv-bar" style={{ width: `${w}%`, background: color, minWidth: r.value > 0 ? 4 : 0 }} />
              {refPct !== null && <span className="dv-bar-ref" style={{ left: `${refPct}%` }} />}
            </span>
          );
          const inner = (
            <>
              <span className="dv-bar-label">{r.label}</span>
              {bar}
              <span className="dv-bar-value">{r.display}</span>
            </>
          );
          return (
            <li key={r.id} className="dv-bar-row">
              {r.href ? (
                <Link to={r.href} className="dv-bar-main dv-mark" aria-label={`${aria}. Open`} {...bind(tipContent)}>
                  {inner}
                </Link>
              ) : (
                <div className="dv-bar-main dv-mark" tabIndex={0} role="img" aria-label={aria} {...bind(tipContent)}>
                  {inner}
                </div>
              )}
              {r.extra && <div className="dv-bar-extra">{r.extra}</div>}
            </li>
          );
        })}
      </ul>
      <span className="sr-only">{seriesLabel}</span>
      <ChartTip tip={tip} />
    </div>
  );
}
