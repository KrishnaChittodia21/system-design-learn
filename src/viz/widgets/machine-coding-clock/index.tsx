import { useMemo, useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { FEATURES, PLAN_NAME, simulate, type FeatureState, type Plan, type Params } from './sim';
import './clock.css';

const X0 = 20;
const X1 = 580;
const mx = (m: number) => X0 + (m / 90) * (X1 - X0);
const PHASE_FILL = ['var(--accent-soft)', 'var(--good-soft)', 'var(--warn-soft)', 'var(--bad-soft)', 'var(--surface-2)'];
const PHASE_STROKE = ['var(--accent)', 'var(--good)', 'var(--warn)', 'var(--bad)', 'var(--muted)'];
const FEAT: Record<FeatureState, { label: string; fill: string; stroke: string }> = {
  todo: { label: 'not started', fill: 'transparent', stroke: 'var(--border)' },
  coded: { label: 'coded, never ran', fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
  runs: { label: 'runs in driver', fill: 'var(--good-soft)', stroke: 'var(--good)' },
};
const PLANS: Plan[] = ['slice', 'layers', 'goldplate'];

export default function MachineCodingClockViz() {
  const [params, setParams] = useState<Params>({ plan: 'slice' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const totals = useMemo(
    () =>
      PLANS.map((plan) => {
        const fr = simulate({ plan });
        return { plan, total: fr[fr.length - 1].rubric!.reduce((a, b) => a + b.score, 0) };
      }),
    [],
  );
  const running = FEATURES.filter((x) => f.features[x.id] === 'runs').length;
  const ariaLabel = `Minute ${f.minute} of 90. ${f.phases.map((p) => `${p.label} from ${p.from} to ${p.to}`).join('; ')}. ${FEATURES.map(
    (x) => `${x.label}: ${FEAT[f.features[x.id]].label}`,
  ).join(', ')}. ${f.runnable ? 'The program runs.' : 'Nothing runs yet.'}`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <Choice<Plan>
          label="Plan"
          value={params.plan}
          options={[
            { value: 'slice', label: 'Vertical slices (§10)' },
            { value: 'layers', label: 'All layers, wire last' },
            { value: 'goldplate', label: 'Gold-plate feature 1' },
          ]}
          onChange={(plan) => setParams({ plan })}
        />
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)', borderRadius: 2 }} /> runs in the driver
          <span className="viz-key" style={{ background: 'var(--warn)', borderRadius: 2 }} /> coded, never executed
          <span className="viz-key ring" style={{ borderColor: 'var(--border)', borderRadius: 2 }} /> not started
          <span>▼ the topic’s checkpoints: runnable by 20, all must-haves by 60</span>
        </>
      }
    >
      <svg viewBox="0 0 600 214" className="viz-svg" role="img" aria-label={ariaLabel}>
        <text x={X0} y={16} style={{ fontSize: 12, fontWeight: 800 }}>
          {PLAN_NAME[params.plan]}
        </text>
        <text x={X1} y={16} textAnchor="end" style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--mono)' }}>
          {f.minute}′ / 90′
        </text>
        {/* clock track */}
        <rect x={X0} y={40} width={X1 - X0} height={30} rx={6} fill="var(--surface-2)" stroke="var(--border)" />
        {f.phases.map((p, k) => (
          <g key={k}>
            <rect
              x={mx(p.from)}
              y={40}
              width={Math.max(0, mx(p.to) - mx(p.from))}
              height={30}
              fill={PHASE_FILL[k % PHASE_FILL.length]}
              stroke={PHASE_STROKE[k % PHASE_STROKE.length]}
              strokeWidth={1}
            />
            {mx(p.to) - mx(p.from) > 54 && (
              <text x={mx(p.from) + 5} y={59} style={{ fontSize: 9.5, fontWeight: 700 }}>
                {p.label.length > (mx(p.to) - mx(p.from)) / 5.4 ? p.label.slice(0, Math.floor((mx(p.to) - mx(p.from)) / 5.4) - 1) + '…' : p.label}
              </text>
            )}
          </g>
        ))}
        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((m) => (
          <text key={m} x={mx(m)} y={84} textAnchor="middle" className="viz-label" style={{ fontSize: 9.5 }}>
            {m}
          </text>
        ))}
        {[
          { m: 20, l: 'runs' },
          { m: 60, l: 'all must-haves' },
        ].map((c) => (
          <g key={c.m}>
            <path d={`M${mx(c.m) - 5},${30} L${mx(c.m) + 5},${30} L${mx(c.m)},${38} z`} fill="var(--accent)" />
            <text x={mx(c.m) + 7} y={34} style={{ fontSize: 9.5, fill: 'var(--accent)', fontWeight: 700 }}>
              {c.l}
            </text>
          </g>
        ))}
        <line x1={mx(f.minute)} x2={mx(f.minute)} y1={36} y2={74} stroke="var(--text)" strokeWidth={2} />

        {/* features */}
        <text x={X0} y={112} className="viz-label" style={{ fontSize: 10.5 }}>
          must-haves
        </text>
        {FEATURES.map((x, k) => {
          const st = FEAT[f.features[x.id]];
          const w = 104;
          const bx = X0 + k * (w + 8);
          return (
            <g key={x.id}>
              <rect x={bx} y={120} width={w} height={40} rx={8} fill={st.fill} stroke={st.stroke} strokeWidth={1.6} strokeDasharray={f.features[x.id] === 'todo' ? '4 3' : undefined} />
              <text x={bx + w / 2} y={137} textAnchor="middle" style={{ fontSize: 11, fontWeight: 800 }}>
                {x.label}
              </text>
              <text x={bx + w / 2} y={152} textAnchor="middle" className="viz-label" style={{ fontSize: 9.5 }}>
                {st.label}
              </text>
            </g>
          );
        })}
        <rect x={X0} y={174} width={176} height={30} rx={15} fill={f.runnable ? 'var(--good-soft)' : 'var(--bad-soft)'} stroke={f.runnable ? 'var(--good)' : 'var(--bad)'} />
        <text x={X0 + 88} y={193} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 800, fill: f.runnable ? 'var(--good)' : 'var(--bad)' }}>
          {f.runnable ? `▶ driver runs · ${running}/5 work` : '■ nothing runs yet'}
        </text>
        <text x={X1} y={193} textAnchor="end" className="viz-label" style={{ fontSize: 10.5 }}>
          {[
            f.flags.includes('atomic') ? 'atomic alias ✓' : null,
            f.flags.includes('errors') ? 'typed errors ✓' : null,
            f.flags.includes('demo') ? 'demo ✓' : null,
            f.flags.includes('tests') ? 'tests ✓' : null,
            f.flags.includes('godclass') ? 'god main() ✕' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </text>
      </svg>
      {f.rubric && (
        <div className="mcc-rubric" role="table" aria-label="Evaluation rubric at minute 90">
          {f.rubric.map((r) => (
            <div key={r.name} className="mcc-row" role="row">
              <span className="mcc-name" role="cell">
                {r.name}
              </span>
              <span className={`mcc-score mcc-s${r.score}`} role="cell">
                {r.score}/2
              </span>
              <span className="mcc-why" role="cell">
                {r.why}
              </span>
            </div>
          ))}
          <div className="mcc-compare" aria-label="Rubric totals for each plan">
            {totals.map((t) => (
              <span key={t.plan} className={`mcc-plan ${t.plan === params.plan ? 'on' : ''}`}>
                {PLAN_NAME[t.plan]} <strong>{t.total}/12</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </VizFrame>
  );
}
