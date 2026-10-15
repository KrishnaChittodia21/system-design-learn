import type { ReactNode } from 'react';

/** KPI figure: label · value (proportional figures) · optional context line and a same-ramp meter. */
export function StatTile({ label, value, hint, meter }: { label: string; value: ReactNode; hint?: ReactNode; meter?: number }) {
  return (
    <div className="dv-stat">
      <div className="dv-stat-label">{label}</div>
      <div className="dv-stat-value">{value}</div>
      {meter !== undefined && (
        <div className="dv-meter" aria-hidden>
          <span style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
        </div>
      )}
      {hint && <div className="dv-stat-hint">{hint}</div>}
    </div>
  );
}
