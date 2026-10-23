import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { BASE_ERR, BUDGET, ERR_OPTIONS, PAGE_BURN, TICKS, TICK_MIN, simulate, type Frame, type Params, type Strategy } from './sim';

const X0 = 54;
const X1 = 592;
const SH_TOP = 50;
const SH_BOT = 140;
const ER_TOP = 162;
const ER_BOT = 250;
const LOG_MIN = 0.05;
const LOG_MAX = 12;
const bw = (X1 - X0) / TICKS;
const xt = (t: number) => X0 + t * bw;
const ys = (s: number) => SH_BOT - s * (SH_BOT - SH_TOP);
const ye = (pct: number) => ER_BOT - (Math.log10(Math.max(LOG_MIN, pct) / LOG_MIN) / Math.log10(LOG_MAX / LOG_MIN)) * (ER_BOT - ER_TOP);
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' as const };
const TONE = { good: 'var(--good)', bad: 'var(--bad)', warn: 'var(--warn)', info: 'var(--accent)' } as const;

function Drawing({ f }: { f: Frame }) {
  const t = f.tick;
  const s = t >= 0 ? f.share[t] : 0;
  const e = t >= 0 ? f.err[t] : BASE_ERR;
  const budgetPct = (f.excess / BUDGET) * 100;
  const pageLine = PAGE_BURN * BASE_ERR;
  let area = '';
  f.share.forEach((v, i) => {
    area += `${i === 0 ? `M${xt(0)},${SH_BOT} ` : ''}L${xt(i)},${ys(v)} L${xt(i + 1)},${ys(v)} `;
  });
  if (f.share.length) area += `L${xt(f.share.length)},${SH_BOT} Z`;
  const aria =
    t < 0
      ? 'Release timeline, not started.'
      : `Minute ${(t + 1) * TICK_MIN}: ${Math.round(s * 100)} percent of traffic on the new version, fleet error rate ${e.toFixed(2)} percent, ${Math.round(f.excess)} extra failed requests. Events: ${f.events.map((ev) => `${ev.label} at minute ${(ev.tick + 1) * TICK_MIN}`).join(', ') || 'none'}.`;
  return (
    <svg viewBox="0 0 600 312" className="viz-svg" role="img" aria-label={aria}>
      <text x={4} y={16} fontSize={11} fontWeight={700}>
        new version {Math.round(s * 100)}% · fleet errors {e.toFixed(2)}% · burn{' '}
        <tspan style={{ fill: e / BASE_ERR >= PAGE_BURN ? 'var(--bad)' : e / BASE_ERR > 1.05 ? 'var(--warn)' : 'var(--good)' }}>{(e / BASE_ERR).toFixed(1)}×</tspan>
      </text>
      <text x={596} y={16} textAnchor="end" fontSize={10.5} fontWeight={700} style={{ fill: f.phase === 'rolled-back' || f.phase === 'rolling-back' ? 'var(--warn)' : f.phase === 'paged' ? 'var(--bad)' : 'var(--text-2)' }}>
        {f.phase.replace('-', ' ')}
      </text>

      {/* share lane */}
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={X0} x2={X1} y1={ys(v)} y2={ys(v)} stroke="var(--border)" strokeDasharray={v === 0 ? undefined : '3 3'} />
          <text x={X0 - 4} y={ys(v) + 3.5} textAnchor="end" fontSize={9} style={{ fill: 'var(--text-2)' }}>
            {v * 100}%
          </text>
        </g>
      ))}
      {area && <path d={area} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.8} />}
      <text x={X0 + 6} y={SH_TOP + 12} fontSize={9.5} fontWeight={700} style={{ fill: 'var(--text-2)', ...halo }}>
        traffic on the new version
      </text>

      {/* events */}
      {f.events.map((ev, k) => (
        <g key={k}>
          <line x1={xt(ev.tick) + bw / 2} x2={xt(ev.tick) + bw / 2} y1={SH_TOP - 6} y2={ER_BOT} stroke={TONE[ev.tone]} strokeWidth={1.4} strokeDasharray="3 2" />
          <text x={Math.min(X1 - 2, xt(ev.tick) + bw / 2 + 3)} y={SH_TOP - 8 + (k % 2) * 11} fontSize={9.5} fontWeight={800} textAnchor={xt(ev.tick) > 520 ? 'end' : 'start'} style={{ fill: TONE[ev.tone] }}>
            {ev.label}
          </text>
        </g>
      ))}

      {/* error lane (log scale) */}
      {[0.1, 1, 10].map((v) => (
        <g key={v}>
          <line x1={X0} x2={X1} y1={ye(v)} y2={ye(v)} stroke="var(--border)" strokeDasharray="3 3" />
          <text x={X0 - 4} y={ye(v) + 3.5} textAnchor="end" fontSize={9} style={{ fill: 'var(--text-2)' }}>
            {v}%
          </text>
        </g>
      ))}
      <line x1={X0} x2={X1} y1={ye(pageLine)} y2={ye(pageLine)} stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="6 3" />
      <text x={X1} y={ye(pageLine) - 4} textAnchor="end" fontSize={9} fontWeight={700} style={{ fill: 'var(--bad)' }}>
        page at {PAGE_BURN}× burn ({+pageLine.toFixed(2)}%) over 1 h and 5 min
      </text>
      {f.err.map((v, i) => (
        <rect
          key={i}
          x={xt(i) + 1.5}
          y={ye(v)}
          width={bw - 3}
          height={ER_BOT - ye(v)}
          fill={v / BASE_ERR >= PAGE_BURN ? 'var(--bad)' : v / BASE_ERR > 1.05 ? 'var(--warn)' : 'var(--good)'}
          opacity={i === t ? 1 : 0.65}
        />
      ))}
      <text x={X0 + 6} y={ER_TOP + 2} fontSize={9.5} fontWeight={700} style={{ fill: 'var(--text-2)', ...halo }}>
        fleet error rate (log scale)
      </text>
      <line x1={X0} x2={X1} y1={ER_BOT} y2={ER_BOT} stroke="var(--border-strong)" />
      {[0, 10, 20, 30, 40, 50, 60].map((m) => (
        <text key={m} x={xt(m / TICK_MIN)} y={ER_BOT + 13} textAnchor="middle" fontSize={9} style={{ fill: 'var(--text-2)' }}>
          {m}
        </text>
      ))}
      <text x={X1} y={ER_BOT + 25} textAnchor="end" fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
        minutes after the deploy started →
      </text>

      {/* budget */}
      <text x={4} y={292} fontSize={10.5} fontWeight={700}>
        extra failures: {Math.round(f.excess).toLocaleString('en-US')}
      </text>
      <rect x={190} y={283} width={300} height={12} rx={6} fill="var(--surface)" stroke="var(--border)" />
      <rect x={190} y={283} width={Math.min(300, (budgetPct / 5) * 300)} height={12} rx={6} fill={budgetPct > 1 ? 'var(--bad)' : budgetPct > 0.1 ? 'var(--warn)' : 'var(--good)'} style={{ transition: 'width 0.45s ease' }} />
      <text x={496} y={293} fontSize={10} fontWeight={700} style={{ fill: budgetPct > 1 ? 'var(--bad)' : 'var(--text)' }}>
        {budgetPct > 0 && budgetPct < 0.01 ? '<0.01' : budgetPct.toFixed(2)}% of budget
      </text>
      <text x={190} y={308} fontSize={9} style={{ fill: 'var(--text-2)' }}>
        bar = share of the 30-day error budget ({BUDGET.toLocaleString('en-US')} requests), full width = 5%
      </text>
    </svg>
  );
}

export default function CanaryAutoRollbackViz() {
  const [params, setParams] = useState<Params>({ strategy: 'canary', newErr: 3 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const idx = ERR_OPTIONS.indexOf(params.newErr);
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Strategy>
            label="Release with"
            value={params.strategy}
            options={[
              { value: 'rolling', label: 'Rolling update' },
              { value: 'bluegreen', label: 'Blue/green' },
              { value: 'canary', label: 'Automated canary' },
            ]}
            onChange={(strategy) => setParams((p) => ({ ...p, strategy }))}
          />
          <Slider
            label="New version error rate"
            value={idx}
            min={0}
            max={ERR_OPTIONS.length - 1}
            format={(i) => `${ERR_OPTIONS[i]}%${ERR_OPTIONS[i] <= BASE_ERR ? ' (good)' : ''}`}
            onChange={(i) => setParams((p) => ({ ...p, newErr: ERR_OPTIONS[i] }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> traffic on the new version
          <span className="viz-key" style={{ background: 'var(--good)' }} /> errors at baseline
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> elevated
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> above the page threshold
        </>
      }
    >
      <Drawing f={stepper.frame} />
    </VizFrame>
  );
}
