import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { GUARD_LABELS, LANES, PRICE, SCENARIO_LABELS, simulate, verdict, type Guard, type Lane, type Params, type ScenarioId, type Tone } from './sim';
import { Tiles } from '../prod-perf-incident-lab/kit/ui';
import '../prod-perf-incident-lab/kit/kit.css';

const LANE_X: Record<Lane, number> = { client: 52, api: 206, db: 384, psp: 548 };
const ROW = 30;
const TOP = 58;
const TONE: Record<Tone, string> = { ok: 'var(--good)', bad: 'var(--bad)', warn: 'var(--warn)', info: 'var(--ink-3)' };
const REQ_COLOR = ['var(--accent)', 'var(--accent)', 'var(--mag)', 'var(--amber)'];

const fmtAt = (s: number) => (s >= 10 ? `${s.toFixed(1)}s` : `${s.toFixed(2)}s`);

export default function ProdIdempotencyLab() {
  const [params, setParams] = useState<Params>({ scenario: 'timeout', guard: 'none', forward: false });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const final = frames[frames.length - 1];
  const rows = final.msgs.length;
  const H = TOP + rows * ROW + 14;
  const l = f.ledger;
  const v = verdict(final.ledger);

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<ScenarioId>
            label="Trigger"
            value={params.scenario}
            options={(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((k) => ({ value: k, label: SCENARIO_LABELS[k] }))}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
          <Choice<Guard>
            label="Server guard"
            value={params.guard}
            options={(Object.keys(GUARD_LABELS) as Guard[]).map((k) => ({ value: k, label: GUARD_LABELS[k] }))}
            onChange={(guard) => setParams((p) => ({ ...p, guard }))}
          />
          <Choice<'no' | 'yes'>
            label="Forward key to PSP"
            value={params.forward ? 'yes' : 'no'}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
            onChange={(x) => setParams((p) => ({ ...p, forward: x === 'yes' }))}
          />
        </>
      }
      legend={
        <>
          <span className="pil-leg">
            <span className="pil-swatch" style={{ background: 'var(--good)' }} aria-hidden />
            safe step
          </span>
          <span className="pil-leg">
            <span className="pil-swatch" style={{ background: 'var(--warn)' }} aria-hidden />
            retry / conflict
          </span>
          <span className="pil-leg">
            <span className="pil-swatch" style={{ background: 'var(--bad)' }} aria-hidden />
            duplicate side effect
          </span>
          <span className="pil-leg">#1 #2 #3 = HTTP attempt</span>
        </>
      }
    >
      <Tiles
        label="Ledger"
        tiles={[
          { label: 'card captured', value: `${l.captures}×`, tone: l.captures > 1 ? 'bad' : l.captures === 1 ? 'good' : 'neutral', sub: `₹${(PRICE * l.captures).toLocaleString('en-IN')}` },
          { label: 'orders', value: String(l.orders), tone: l.orders > 1 ? 'bad' : l.orders === 1 ? 'good' : 'neutral' },
          { label: 'key row', value: params.guard === 'key' ? l.keyRow : 'n/a', tone: 'neutral' },
          { label: 'client sees', value: f.done ? l.clientSees : '…', tone: 'neutral' },
        ]}
      />
      {f.done && (
        <p className={`pil-note tone-${v.tone === 'ok' ? 'good' : v.tone}`}>
          <span className="pil-kicker">Outcome</span>
          {v.text}
        </p>
      )}
      <svg viewBox={`0 0 600 ${H}`} className="viz-svg" role="img" aria-label={`Sequence diagram, ${f.msgs.length} of ${rows} messages shown. ${f.msgs.length ? `Latest: ${f.msgs[f.msgs.length - 1].label}.` : ''}`}>
        <defs>
          {(['ok', 'bad', 'warn', 'info'] as Tone[]).map((t) => (
            <marker key={t} id={`pidl-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={TONE[t]} />
            </marker>
          ))}
        </defs>
        {LANES.map((ln) => (
          <g key={ln.id}>
            <rect x={LANE_X[ln.id] - 44} y={8} width={88} height={28} rx={8} fill="var(--surface)" stroke="var(--line-2)" strokeWidth={1.5} />
            <text x={LANE_X[ln.id]} y={27} textAnchor="middle" fontSize={12.5} fontWeight={700}>
              {ln.label}
            </text>
            <line x1={LANE_X[ln.id]} x2={LANE_X[ln.id]} y1={36} y2={H - 6} stroke="var(--line-2)" strokeDasharray="3 4" />
          </g>
        ))}
        {f.msgs.map((m, i) => {
          const y = TOP + i * ROW;
          const x1 = LANE_X[m.from];
          const x2 = LANE_X[m.to];
          const cur = i === f.msgs.length - 1;
          const color = TONE[m.tone];
          const self = m.from === m.to;
          const mid = self ? x1 + 8 : (x1 + x2) / 2;
          return (
            <g key={i} opacity={cur ? 1 : 0.78}>
              <text x={2} y={y + 4} fontSize={9.5} className="viz-label pil-svg-mono">
                {fmtAt(m.at)}
              </text>
              {self ? (
                <circle cx={x1} cy={y} r={5} fill={color} />
              ) : (
                <line x1={x1} x2={x2 + (x2 > x1 ? -3 : 3)} y1={y} y2={y} stroke={color} strokeWidth={cur ? 2.6 : 1.8} markerEnd={`url(#pidl-${m.tone})`} />
              )}
              <circle cx={x1} cy={y} r={7} fill="var(--surface)" stroke={REQ_COLOR[m.req]} strokeWidth={1.5} />
              <text x={x1} y={y + 3.5} textAnchor="middle" fontSize={8.5} fontWeight={700} style={{ fill: REQ_COLOR[m.req] }}>
                {m.req}
              </text>
              <text
                x={self ? mid + 6 : mid}
                y={y - 5}
                textAnchor={self ? 'start' : 'middle'}
                fontSize={10.5}
                fontWeight={cur ? 700 : 500}
                style={{ fill: m.tone === 'info' ? 'var(--ink)' : color, stroke: 'var(--surface-2)', strokeWidth: 3, paintOrder: 'stroke' }}
              >
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
    </VizFrame>
  );
}
