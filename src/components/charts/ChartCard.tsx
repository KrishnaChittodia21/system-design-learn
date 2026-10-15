import { useId, useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';

export interface LegendItem {
  label: string;
  color: string;
  kind?: 'rect' | 'line';
}

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
}

/**
 * Chart container: title, subtitle, legend, a "View as table" toggle (the accessible twin of the chart)
 * and a friendly empty state. The card grows with its content, so it never scrolls internally.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  empty,
  action,
  className = '',
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  table?: ChartTable;
  /** when set, shown instead of the chart and table toggle */
  empty?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  return (
    <figure className={`card dv-card ${className}`} aria-labelledby={titleId}>
      <div className="dv-head">
        <div>
          <h3 id={titleId} className="dv-title">
            {title}
          </h3>
          {subtitle && <p className="dv-sub">{subtitle}</p>}
        </div>
        <div className="dv-head-actions">
          {action}
          {!empty && table && (
            <button type="button" className="btn-ghost btn-xs dv-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? <BarChart3 size={14} aria-hidden /> : <Table2 size={14} aria-hidden />}
              {asTable ? 'View as chart' : 'View as table'}
            </button>
          )}
        </div>
      </div>
      {empty ? (
        <div className="dv-empty">{empty}</div>
      ) : (
        <>
          {legend && legend.length > 1 && !asTable && (
            <ul className="dv-legend" aria-label="Legend">
              {legend.map((l) => (
                <li key={l.label}>
                  <span className={`dv-key dv-key-${l.kind ?? 'rect'}`} style={{ background: l.color }} aria-hidden />
                  <span>{l.label}</span>
                </li>
              ))}
            </ul>
          )}
          {asTable && table ? (
            <div className="table-wrap dv-table">
              <table>
                <thead>
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            children
          )}
        </>
      )}
    </figure>
  );
}
