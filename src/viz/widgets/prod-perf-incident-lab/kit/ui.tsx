// Small presentational pieces shared by the prod-* incident widgets: a multi-select toggle
// group for mitigations, live metric tiles (HTML, so they stay readable at phone width), and a
// timeline chart (log-scale latency + error-rate band) drawn only up to the current tick.
import type { ReactNode } from 'react';
import './kit.css';

import type { Tone } from './queue';
export type { Tone };

/** Multi-select chip group (each chip is a toggle button with aria-pressed). */
export function Toggles<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="viz-choice pil-toggles" role="group" aria-label={label}>
      <span>{label}:</span>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            className={`chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            title={o.title}
            onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
          >
            <span className="pil-check" aria-hidden>
              {on ? '✓' : '+'}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface Tile {
  label: string;
  value: string;
  tone?: Tone;
  sub?: string;
}

export function Tiles({ tiles, label }: { tiles: Tile[]; label: string }) {
  return (
    <dl className="pil-tiles" aria-label={label}>
      {tiles.map((t) => (
        <div key={t.label} className={`pil-tile tone-${t.tone ?? 'neutral'}`}>
          <dt>{t.label}</dt>
          <dd>
            {t.value}
            {t.sub && <small>{t.sub}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}


export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  dash?: string;
}

export interface Marker {
  tick: number;
  label: string;
  color: string;
}

const W = 600;
const X0 = 46;
const X1 = 592;
const L_TOP = 16;
const L_BOT = 132;
const E_TOP = 150;
const E_BOT = 186;

/**
 * Timeline: latency series on a log scale (1 ms … 10 s) and an error-rate band underneath.
 * `values` hold one entry per tick that has happened; ticks after `cur` are left empty.
 */
export function TimeChart({
  ticks,
  cur,
  series,
  errors,
  markers,
  tickLabel = (t) => `${t}m`,
  yMaxMs = 10_000,
  sloMs,
  ariaLabel,
}: {
  ticks: number;
  cur: number;
  series: Series[];
  errors: number[];
  markers: Marker[];
  tickLabel?: (t: number) => string;
  yMaxMs?: number;
  sloMs?: number;
  ariaLabel: string;
}) {
  const bw = (X1 - X0) / ticks;
  const xc = (t: number) => X0 + (t + 0.5) * bw;
  const lmin = 0; // log10(1 ms)
  const lmax = Math.log10(yMaxMs);
  const y = (ms: number) => {
    const l = Math.max(lmin, Math.min(lmax, Math.log10(Math.max(1, ms))));
    return L_BOT - ((l - lmin) / (lmax - lmin)) * (L_BOT - L_TOP);
  };
  const ye = (e: number) => E_BOT - Math.max(0, Math.min(1, e)) * (E_BOT - E_TOP);
  const grid = [1, 10, 100, 1000, 10_000].filter((v) => v <= yMaxMs);
  const every = ticks > 24 ? 5 : ticks > 12 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} 206`} className="viz-svg pil-chart" role="img" aria-label={ariaLabel}>
      {/* markers (trigger, fix applied…) */}
      {markers.map((m) => (
        <g key={m.label}>
          <line x1={X0 + m.tick * bw} x2={X0 + m.tick * bw} y1={L_TOP - 6} y2={E_BOT} stroke={m.color} strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={X0 + m.tick * bw + 4} y={L_TOP - 2} fontSize={11} fontWeight={700} style={{ fill: m.color }}>
            {m.label}
          </text>
        </g>
      ))}
      {grid.map((v) => (
        <g key={v}>
          <line x1={X0} x2={X1} y1={y(v)} y2={y(v)} stroke="var(--line)" />
          {v > 1 && (
            <text x={X0 - 5} y={y(v) + 4} textAnchor="end" fontSize={10.5} className="viz-label">
              {v >= 1000 ? `${v / 1000}s` : `${v}ms`}
            </text>
          )}
        </g>
      ))}
      {sloMs && (
        <g>
          <line x1={X0} x2={X1} y1={y(sloMs)} y2={y(sloMs)} stroke="var(--good)" strokeWidth={1.2} strokeDasharray="2 3" />
          <text x={X1} y={y(sloMs) - 4} textAnchor="end" fontSize={10.5} fontWeight={600} style={{ fill: 'var(--good)' }}>
            SLO p99 {sloMs >= 1000 ? `${sloMs / 1000}s` : `${sloMs}ms`}
          </text>
        </g>
      )}
      {series.map((s) => {
        const pts = s.values.slice(0, cur + 1).map((v, t) => `${t === 0 ? 'M' : 'L'}${xc(t).toFixed(1)},${y(v).toFixed(1)}`);
        return pts.length > 0 ? <path key={s.key} d={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={2.4} strokeDasharray={s.dash} strokeLinejoin="round" /> : null;
      })}
      {cur >= 0 &&
        series.map((s) => (s.values[cur] !== undefined ? <circle key={s.key} cx={xc(cur)} cy={y(s.values[cur])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={1.5} /> : null))}
      {/* error band */}
      <text x={X0 - 5} y={E_TOP + 4} textAnchor="end" fontSize={10.5} className="viz-label">
        100%
      </text>
      <text x={X0 - 5} y={E_BOT + 3} textAnchor="end" fontSize={10.5} className="viz-label">
        err
      </text>
      <line x1={X0} x2={X1} y1={E_BOT} y2={E_BOT} stroke="var(--line-2)" />
      <line x1={X0} x2={X1} y1={E_TOP} y2={E_TOP} stroke="var(--line)" />
      {errors.slice(0, cur + 1).map((e, t) =>
        e > 0.0005 ? <rect key={t} x={X0 + t * bw + 1} y={ye(e)} width={Math.max(1, bw - 2)} height={E_BOT - ye(e)} fill="var(--bad)" opacity={t === cur ? 0.95 : 0.6} /> : null,
      )}
      {Array.from({ length: ticks }, (_, t) =>
        t % every === 0 ? (
          <text key={t} x={xc(t)} y={E_BOT + 15} textAnchor="middle" fontSize={10.5} className="viz-label">
            {tickLabel(t)}
          </text>
        ) : null,
      )}
      {cur >= 0 && <rect x={X0 + cur * bw} y={L_TOP - 6} width={bw} height={E_BOT - L_TOP + 6} fill="var(--accent)" opacity={0.08} />}
    </svg>
  );
}

export function SeriesLegend({ series, extra }: { series: { label: string; color: string; dash?: boolean }[]; extra?: ReactNode }) {
  return (
    <>
      {series.map((s) => (
        <span key={s.label} className="pil-leg">
          <span className={`pil-line ${s.dash ? 'dash' : ''}`} style={{ borderColor: s.color }} aria-hidden /> {s.label}
        </span>
      ))}
      {extra}
    </>
  );
}
