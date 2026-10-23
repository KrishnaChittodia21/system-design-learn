import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { SCENARIOS, SCENARIO_IDS, STAGES, health, simulate, type Health, type Params, type ScenarioId } from './sim';
import './triage.css';

const H_COLOR: Record<Health, string> = { ok: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };
const H_SOFT: Record<Health, string> = { ok: 'var(--good-soft)', warn: 'var(--warn-soft)', bad: 'var(--bad-soft)' };
const SHORT: Record<string, string> = {
  symptom: 'Symptom',
  mitigate: 'Mitigate',
  changed: 'Changed?',
  use: 'USE',
  queries: 'Queries',
  fix: 'Fix',
  prevent: 'Prevent',
};

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export default function DbIncidentTriageViz() {
  const [params, setParams] = useState<Params>({ scenario: 'slow' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const sc = SCENARIOS[params.scenario];
  const n = sc.metrics.length;
  const gap = 8;
  const tileW = (584 - gap * (n - 1)) / n;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <Choice<ScenarioId>
          label="Incident"
          value={params.scenario}
          options={SCENARIO_IDS.map((k) => ({ value: k, label: SCENARIOS[k].label }))}
          onChange={(v) => setParams({ scenario: v })}
        />
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> healthy
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> degraded
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> saturated / breaching
          <span>tick mark = value when paged · thick border = what this step looks at</span>
        </>
      }
    >
      <svg
        viewBox="0 0 600 200"
        className="viz-svg"
        role="img"
        aria-label={`${sc.title}, step ${f.stageIndex + 1} of 7: ${STAGES[f.stageIndex].label}. ${sc.metrics.map((m) => `${m.label} ${fmt(f.values[m.key])} ${m.unit}`).join(', ')}.`}
      >
        <text x={8} y={18} style={{ fontSize: 13, fontWeight: 700 }}>
          {sc.title}
        </text>
        {/* the loop */}
        {STAGES.map((s, k) => {
          const w = 584 / STAGES.length;
          const x = 8 + k * w;
          const on = k === f.stageIndex;
          const past = k < f.stageIndex;
          return (
            <g key={s.id}>
              <rect
                x={x + 2}
                y={30}
                width={w - 4}
                height={26}
                rx={13}
                fill={on ? 'var(--blue-s)' : 'var(--surface)'}
                stroke={on ? 'var(--blue)' : past ? 'var(--good)' : 'var(--border)'}
                strokeWidth={on ? 2.5 : 1.2}
              />
              <text x={x + w / 2} y={47} textAnchor="middle" style={{ fontSize: 11, fontWeight: on ? 800 : 600, fill: on ? 'var(--blue)' : past ? 'var(--good)' : 'var(--muted)' }}>
                {past ? '✓ ' : ''}
                {SHORT[s.id]}
              </text>
            </g>
          );
        })}

        <text x={8} y={78} className="viz-label">
          {f.window === 'incident' ? 'dashboards for the incident window (read after mitigating)' : f.stageIndex >= 5 ? 'live dashboard after the fix' : 'live dashboard'}
        </text>

        {/* metric tiles */}
        {sc.metrics.map((m, k) => {
          const x = 8 + k * (tileW + gap);
          const v = f.values[m.key];
          const h = health(m, v);
          const focus = f.focus.includes(m.key);
          const barW = tileW - 20;
          const frac = (val: number) => Math.max(0, Math.min(1, m.inverse ? (val - 90) / (m.max - 90) : val / m.max));
          const base = f.baseline[m.key];
          return (
            <g key={m.key}>
              <rect x={x} y={88} width={tileW} height={96} rx={10} fill={H_SOFT[h]} stroke={focus ? H_COLOR[h] : 'var(--border)'} strokeWidth={focus ? 3 : 1.2} style={{ transition: 'fill .3s, stroke .3s' }} />
              <text x={x + 10} y={108} className="viz-label" style={{ fontSize: 11 }}>
                {m.label}
              </text>
              <text x={x + 10} y={138} style={{ fontSize: 22, fontWeight: 800, fill: H_COLOR[h], fontFamily: 'var(--f-mono)' }}>
                {fmt(v)}
                <tspan style={{ fontSize: 11, fontWeight: 600, fill: 'var(--text-2)' }}> {m.unit}</tspan>
              </text>
              <rect x={x + 10} y={154} width={barW} height={7} rx={3.5} fill="var(--border)" />
              <rect x={x + 10} y={154} width={barW * frac(v)} height={7} rx={3.5} fill={H_COLOR[h]} style={{ transition: 'width .4s' }} />
              <line x1={x + 10 + barW * frac(base)} y1={149} x2={x + 10 + barW * frac(base)} y2={166} stroke="var(--text)" strokeWidth={1.5} />
              <text x={x + 10} y={178} className="viz-label" style={{ fontSize: 10 }}>
                {f.stageIndex === 0 ? `limit ${m.inverse ? '≥' : '<'} ${m.warn}` : `paged at ${fmt(base)}`}
              </text>
            </g>
          );
        })}
      </svg>
      <pre className="dbt-evidence" aria-label="Evidence for this step">
        <span className="dbt-evidence-h">{f.stageIndex === 0 ? 'alert' : f.stageIndex === 1 || f.stageIndex === 5 ? 'action' : 'evidence'}</span>
        {f.evidence.join('\n')}
      </pre>
    </VizFrame>
  );
}
