import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { INCIDENT_AT, RULES, VIEW_MIN, budgetFraction, ratioAt, simulate, type Params } from './sim';
import './slo.css';

const W = 520;
const H = 170;
const L = 44;
const R = W - 10;
const T = 14;
const B = H - 24;
const SLOS = ['99', '99.5', '99.9', '99.95', '99.99'] as const;

export default function SloErrorBudgetBurnViz() {
  const [params, setParams] = useState<Params>({ slo: 99.9, errorPct: 2, duration: 60 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  const budget = budgetFraction(params.slo);
  const yMax = Math.max(params.errorPct / 100, 14.4 * budget) * 1.15;
  const x = (m: number) => L + (m / VIEW_MIN) * (R - L);
  const y = (r: number) => B - (r / yMax) * (B - T);
  const series: string[] = [];
  for (let m = 0; m <= VIEW_MIN; m++) series.push(`${x(m).toFixed(1)},${y(ratioAt(params, m)).toFixed(1)}`);
  const drawn = series.slice(0, f.t + 1).join(' ');
  const fmtPct = (r: number) => `${+(r * 100).toFixed(2)}%`;
  const thresholds = [
    { burn: 14.4, label: '14.4×' },
    { burn: 6, label: '6×' },
    { burn: 1, label: '1× (budget)' },
  ];
  const usedPct = Math.min(100, f.used * 100);

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<(typeof SLOS)[number]> label="SLO" value={String(params.slo) as (typeof SLOS)[number]} options={SLOS.map((s) => ({ value: s, label: `${s}%` }))} onChange={(v) => set('slo')(Number(v))} />
          <Slider label="Incident error rate" value={params.errorPct} min={0.5} max={10} step={0.5} onChange={set('errorPct')} format={(v) => `${v}%`} />
          <Slider label="Incident lasts" value={params.duration} min={10} max={240} step={10} onChange={set('duration')} format={(v) => `${v} min`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> error ratio per minute
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> burn-rate thresholds
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> alert firing
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={`Minute ${f.t} of ${VIEW_MIN}. Burn rates: 5 minute ${f.burns[5].toFixed(1)}x, 1 hour ${f.burns[60].toFixed(1)}x, 6 hour ${f.burns[360].toFixed(1)}x. Error budget used ${usedPct.toFixed(1)} percent. ${RULES.filter((r) => f.firing[r.id]).map((r) => r.label + ' firing').join(', ') || 'No alert firing'}.`}>
        <rect x={x(INCIDENT_AT)} y={T} width={x(INCIDENT_AT + params.duration) - x(INCIDENT_AT)} height={B - T} fill="var(--bad-soft)" opacity={0.6} />
        <text x={x(INCIDENT_AT) + 3} y={T + 10} fontSize={10} style={{ fill: 'var(--bad)' }} fontWeight={700}>
          incident
        </text>
        {thresholds.map((th) => {
          const r = th.burn * budget;
          if (r > yMax) return null;
          return (
            <g key={th.burn}>
              <line x1={L} x2={R} y1={y(r)} y2={y(r)} stroke="var(--warn)" strokeDasharray="5 4" opacity={0.85} />
              <text x={R} y={y(r) - 3} textAnchor="end" fontSize={9.5} style={{ fill: 'var(--warn)' }} fontWeight={600} className="slo-halo">
                {th.label} = {fmtPct(r)}
              </text>
            </g>
          );
        })}
        <line x1={L} x2={R} y1={B} y2={B} stroke="var(--border)" />
        <line x1={L} x2={L} y1={T} y2={B} stroke="var(--border)" />
        {[0, 0.5, 1].map((p) => (
          <text key={p} x={L - 4} y={y(p * yMax) + 3} textAnchor="end" fontSize={9.5} className="viz-label">
            {fmtPct(p * yMax)}
          </text>
        ))}
        {[0, 60, 120, 180, 240, 300, 360].map((m) => (
          <text key={m} x={x(m)} y={H - 8} textAnchor="middle" fontSize={9.5} className="viz-label">
            {m / 60}h
          </text>
        ))}
        <polyline points={drawn} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        <line x1={x(f.t)} x2={x(f.t)} y1={T} y2={B} stroke="var(--accent)" strokeOpacity={0.5} />
      </svg>

      <div className="slo-panel">
        <div className="slo-budget">
          <div className="slo-budget-head">
            <span>30-day error budget used</span>
            <strong className={usedPct > 50 ? 'is-bad' : usedPct > 10 ? 'is-warn' : ''}>{usedPct.toFixed(1)}%</strong>
          </div>
          <div className="slo-meter" role="meter" aria-label="Error budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(usedPct.toFixed(1))}>
            <span style={{ width: `${usedPct}%` }} />
          </div>
        </div>
        <table className="slo-rules">
          <thead>
            <tr>
              <th scope="col">alert</th>
              <th scope="col">long</th>
              <th scope="col">short</th>
              <th scope="col">state</th>
            </tr>
          </thead>
          <tbody>
            {RULES.map((r) => {
              const lb = f.burns[r.long];
              const sb = f.burns[r.short];
              const firing = f.firing[r.id];
              return (
                <tr key={r.id} className={firing ? 'is-firing' : ''}>
                  <th scope="row">{r.label}</th>
                  <td className={lb > r.burn ? 'is-over' : ''}>{lb.toFixed(1)}×</td>
                  <td className={sb > r.burn ? 'is-over' : ''}>{sb.toFixed(1)}×</td>
                  <td>
                    <span className={`slo-chip${firing ? ' is-firing' : ''}`}>{firing ? (r.severity === 'page' ? 'PAGING' : 'TICKET') : 'ok'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {f.longOnlyFiring && !f.firing.fast && (
          <p className="slo-note">A 1 h-only rule would still be paging here ({f.burns[60].toFixed(1)}×) although errors are back to normal: that is what the short window prevents.</p>
        )}
      </div>
    </VizFrame>
  );
}
