import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { simulatePrice, type PriceParams } from './sim';
import type { Tone } from './sim';

const NODES: NodeDef[] = [
  { id: 'crawler', label: 'Crawler / ext.', sub: 'observations', x: 4, y: 10, w: 104, h: 42 },
  { id: 'detector', label: 'Change detector', sub: 'validate', x: 127, y: 10, w: 104, h: 42 },
  { id: 'matcher', label: 'Matcher', sub: 'range scan', x: 250, y: 10, w: 104, h: 42 },
  { id: 'gate', label: 'Notify gate', sub: 'per user', x: 373, y: 10, w: 104, h: 42 },
  { id: 'send', label: 'Push / email', sub: 'token bucket', x: 496, y: 10, w: 100, h: 42 },
];
const ON_OFF = [
  { value: 'on' as const, label: 'On' },
  { value: 'off' as const, label: 'Off' },
];
const CH = { x: 52, y: 88, w: 230, h: 130 };
const P_MIN = 44_000;
const P_MAX = 61_000;
const py = (p: number) => CH.y + CH.h - ((Math.max(P_MIN, Math.min(P_MAX, p)) - P_MIN) / (P_MAX - P_MIN)) * CH.h;
const decisionTone: Record<string, Tone> = { SEND: 'good', COOLDOWN: 'warn', DIGEST: 'mag', DUP: 'muted' };
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default function PriceView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<PriceParams>({ hysteresis: true, validate: true });
  const frames = useSimulation(simulatePrice, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const nodes: Record<string, NodeDef> = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const n = f.prices.length;
  const px = (i: number) => CH.x + (i / 5) * CH.w;
  const accepted = f.prices.map((p, i) => ({ ...p, i })).filter((p) => p.kind !== 'held');
  const path = accepted.map((p, k) => `${k ? 'L' : 'M'}${px(p.i)},${py(p.p)}`).join(' ');
  const cur = accepted[accepted.length - 1];
  const aria = `Price tracker step ${stepper.i + 1}: current accepted price ${inr(cur.p)}, ${f.alerts.filter((a) => a.state === 'FIRED').length} alerts fired, ${f.sent} notifications sent.`;

  return (
    <VizFrame
      title="Price tracker: detect, match, fire once, notify politely"
      blurb="Six alerts on one phone. Feed it a stream of prices including a fake ₹1 report and a price that wobbles around a target. Toggle validation and hysteresis to see why each exists."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<'on' | 'off'> label="Validate suspicious drops" value={params.validate ? 'on' : 'off'} options={ON_OFF} onChange={(v) => setParams((p) => ({ ...p, validate: v === 'on' }))} />
          <Choice<'on' | 'off'> label="Hysteresis (re-arm 5% above)" value={params.hysteresis ? 'on' : 'off'} options={ON_OFF} onChange={(v) => setParams((p) => ({ ...p, hysteresis: v === 'on' }))} />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> ARMED threshold
          <Key tone="good" /> SEND
          <Key tone="warn" /> COOLDOWN / held
          <Key tone="mag" /> DIGEST
          <Key tone="muted" /> DUP / fired
        </>
      }
    >
      <svg viewBox="0 0 600 350" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        {NODES.slice(1).map((nd, i) => (
          <Edge key={nd.id} a={NODES[i]} b={nd} dashed />
        ))}
        {NODES.map((nd) => (
          <Box key={nd.id} n={nd} tone={f.active[nd.id]} dim={Object.keys(f.active).length > 0 && !f.active[nd.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} labelDy={31} packet k={`${stepper.i}-${k}`} />
        ))}

        {/* price chart with thresholds */}
        <Panel x={8} y={70} w={290} h={176} title="Accepted price vs alert thresholds">
          {f.alerts.map((a) => (
            <g key={a.id}>
              <line x1={CH.x} x2={CH.x + CH.w} y1={py(a.target)} y2={py(a.target)} stroke={a.state === 'ARMED' ? 'var(--blue)' : 'var(--ink-4)'} strokeDasharray="4 3" strokeWidth={1} opacity={0.8} />
              <text x={CH.x - 4} y={py(a.target) + 3} fontSize={8.5} textAnchor="end" style={{ fill: a.state === 'ARMED' ? 'var(--blue)' : 'var(--ink-3)' }}>
                {a.id}
              </text>
            </g>
          ))}
          <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} />
          {f.prices.map((p, i) => (
            <g key={i}>
              <circle cx={px(i)} cy={p.kind === 'held' || p.kind === 'bad' ? CH.y + CH.h + 6 : py(p.p)} r={4.5} fill={p.kind === 'held' ? 'var(--warn)' : p.kind === 'bad' ? 'var(--bad)' : p.kind === 'same' ? 'var(--ink-4)' : 'var(--ink)'} />
              {i === n - 1 && (
                <text x={px(i)} y={(p.kind === 'held' || p.kind === 'bad' ? CH.y + CH.h + 6 : py(p.p)) - 8} fontSize={10} fontWeight={800} textAnchor={i > 3 ? 'end' : 'middle'}>
                  {inr(p.p)}
                  {p.kind === 'held' ? ' (held)' : ''}
                </text>
              )}
            </g>
          ))}
          <text x={CH.x} y={CH.y + CH.h + 24} fontSize={9} className="csf-muted">
            time → (dot under the axis = the ₹1 report)
          </text>
        </Panel>

        {/* alert table */}
        <Panel x={306} y={70} w={286} h={176} title="Alerts (sorted list: target, state)">
          {[...f.alerts]
            .sort((a, b) => b.target - a.target)
            .map((a, k) => (
              <g key={a.id}>
                <text x={316} y={100 + k * 23} fontSize={10} fontWeight={700}>
                  {a.id} {a.user}
                </text>
                <text x={372} y={100 + k * 23} fontSize={9.5} className="csf-muted">
                  {a.rule}
                </text>
                <text x={526} y={100 + k * 23} fontSize={10} fontWeight={700} textAnchor="end">
                  {inr(a.target)}
                </text>
                <Pill x={584} y={98 + k * 23} text={a.state} tone={a.state === 'ARMED' ? 'accent' : 'muted'} anchor="end" size={9} />
              </g>
            ))}
        </Panel>

        {/* gate */}
        <Panel x={8} y={254} w={584} h={90} title={`Notify gate this event · notifications sent so far: ${f.sent}`}>
          {f.gate.length === 0 && (
            <text x={18} y={284} fontSize={10} className="csf-muted">
              no alerts reached the gate on this step
            </text>
          )}
          {f.gate.map((g, k) => (
            <g key={`${g.alert}-${k}`} className="csf-pop">
              <text x={18 + (k % 3) * 192} y={284 + Math.floor(k / 3) * 26} fontSize={10} fontFamily="var(--f-mono)">
                {g.user} · {g.alert}
              </text>
              <Pill x={18 + (k % 3) * 192 + 112} y={282 + Math.floor(k / 3) * 26} text={g.decision} tone={decisionTone[g.decision]} size={9} />
            </g>
          ))}
        </Panel>
      </svg>
    </VizFrame>
  );
}
