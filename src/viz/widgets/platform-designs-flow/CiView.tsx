import { useState, type ReactNode } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { BOOT_TICKS, ORGS, TICK_S, simulateCi, type CiParams, type Dispatch } from './sim';
import type { Tone } from './sim';
import { stroke } from './tones';

const ORG_TONE: Record<string, Tone> = { A: 'accent', B: 'mag', C: 'good' };
const ON_OFF = [
  { value: 'on' as const, label: 'On' },
  { value: 'off' as const, label: 'Off' },
];

export default function CiView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<CiParams>({ dispatch: 'fifo', warm: 1, slots: 3, die: false });
  const frames = useSimulation(simulateCi, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const nodes: Record<string, NodeDef> = {
    queues: { id: 'queues', label: 'Queues', sub: 'per (pool label, org)', x: 4, y: 10, w: 150, h: 44 },
    dispatcher: { id: 'dispatcher', label: 'Dispatcher', sub: params.dispatch === 'fair' ? 'lowest running ÷ weight' : 'one global FIFO', x: 214, y: 10, w: 170, h: 44 },
    pool: { id: 'pool', label: 'Runner pool', sub: `max ${params.slots} jobs at once`, x: 444, y: 10, w: 152, h: 44 },
  };
  const started = f.done.filter((d) => d.wait >= 0);
  const aria = `CI dispatch at t=${f.t * TICK_S}s: ${f.slots.length} jobs on runners, ${Object.values(f.queues).flat().length} queued, ${started.length} started, ${f.warmReady} warm VMs ready.`;

  return (
    <VizFrame
      title="CI/CD runners: who runs next, and where"
      blurb="Org A queues 6 jobs before B and C queue theirs. Compare one global FIFO with weighted fair share, size the warm pool, change capacity, and kill a runner to see what its lease decides."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<Dispatch>
            label="Dispatch"
            value={params.dispatch}
            options={[
              { value: 'fifo', label: 'Global FIFO' },
              { value: 'fair', label: 'Weighted fair share' },
            ]}
            onChange={(dispatch) => setParams((p) => ({ ...p, dispatch }))}
          />
          <Slider label="Warm VMs" value={params.warm} min={0} max={3} onChange={(warm) => setParams((p) => ({ ...p, warm }))} />
          <Slider label="Concurrent jobs" value={params.slots} min={2} max={4} onChange={(slots) => setParams((p) => ({ ...p, slots }))} />
          <Choice<'on' | 'off'> label="A runner dies at t=30s" value={params.die ? 'on' : 'off'} options={ON_OFF} onChange={(v) => setParams((p) => ({ ...p, die: v === 'on' }))} />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> org A (weight 1)
          <Key tone="mag" /> org B (weight 1)
          <Key tone="good" /> org C (weight 2)
          <Key tone="warn" /> cold boot
          <Key tone="bad" /> runner lost
        </>
      }
    >
      <svg viewBox="0 0 600 340" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        <Edge a={nodes.queues} b={nodes.dispatcher} dashed />
        <Edge a={nodes.dispatcher} b={nodes.pool} dashed />
        {Object.values(nodes).map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} labelDy={-28} packet k={`${stepper.i}-${k}`} />
        ))}

        <Panel x={8} y={64} w={190} h={150} title={`Queued at t=${f.t * TICK_S}s`}>
          {ORGS.map((o, k) => (
            <g key={o.id}>
              <text x={18} y={96 + k * 40} fontSize={10.5} fontWeight={800} style={{ fill: stroke(ORG_TONE[o.id]) }}>
                org {o.id}
              </text>
              <text x={18} y={110 + k * 40} fontSize={9} className="pdf-muted">
                weight {o.weight}
              </text>
              {f.queues[o.id].map((j, m) => (
                <Pill key={j} x={82 + (m % 4) * 28} y={96 + k * 40 + Math.floor(m / 4) * 15} text={j} tone={ORG_TONE[o.id]} size={8.5} />
              ))}
              {f.queues[o.id].length === 0 && (
                <text x={82} y={96 + k * 40} fontSize={9.5} className="pdf-muted">
                  empty
                </text>
              )}
            </g>
          ))}
        </Panel>

        <Panel x={206} y={64} w={232} h={150} title="Runners (one job each, destroyed after)">
          {Array.from({ length: params.slots }, (_, k) => {
            const s = f.slots[k];
            const y = 92 + k * 29;
            if (!s)
              return (
                <text key={k} x={216} y={y + 8} fontSize={10} className="pdf-muted">
                  slot {k + 1}: free
                </text>
              );
            const tone: Tone = s.phase === 'lost' ? 'bad' : s.phase === 'booting' ? 'warn' : ORG_TONE[s.job.org];
            const total = s.phase === 'booting' ? BOOT_TICKS : s.job.dur;
            return (
              <g key={k}>
                <Pill x={216} y={y + 6} text={s.job.id} tone={ORG_TONE[s.job.org]} size={9.5} />
                <text x={254} y={y + 8} fontSize={10} fontWeight={700} style={{ fill: stroke(tone) }}>
                  {s.phase === 'lost' ? 'no heartbeat' : s.phase === 'booting' ? `cold boot ${s.left * TICK_S}s` : `running ${s.warm ? '(warm)' : ''}`}
                </text>
                <rect x={364} y={y} width={64} height={10} rx={3} fill="var(--tint)" />
                <rect x={364} y={y} width={s.phase === 'lost' ? 64 : 64 * (1 - s.left / total)} height={10} rx={3} fill={stroke(tone)} style={{ transition: 'width 0.35s ease' }} />
              </g>
            );
          })}
        </Panel>

        <Panel x={446} y={64} w={146} h={150} title="Warm pool">
          {Array.from({ length: Math.max(f.warmReady, 0) }, (_, k) => (
            <rect key={`r${k}`} x={458 + k * 30} y={92} width={24} height={20} rx={4} fill="var(--good-soft)" stroke="var(--good)" />
          ))}
          {f.refills.map((r, k) => (
            <rect key={`b${k}`} x={458 + k * 30} y={124} width={24} height={20} rx={4} fill="var(--warn-soft)" stroke="var(--warn)" strokeDasharray="3 2">
              <title>{`booting, ready in ${r * TICK_S}s`}</title>
            </rect>
          ))}
          <text x={456} y={162} fontSize={9.5} className="pdf-muted">
            ready: {f.warmReady} · refilling: {f.refills.length}
          </text>
          <text x={456} y={178} fontSize={9.5} className="pdf-muted">
            cold boot = {BOOT_TICKS * TICK_S}s
          </text>
          <text x={456} y={194} fontSize={9.5} className="pdf-muted">
            size ≈ arrivals × boot time
          </text>
        </Panel>

        <Panel x={8} y={222} w={584} h={112} title="Wait before the first step (seconds)">
          {ORGS.map((o, k) => {
            const ds = f.done.filter((d) => d.job.org === o.id);
            return (
              <g key={o.id}>
                <text x={18} y={252 + k * 26} fontSize={10.5} fontWeight={800}>
                  {o.id}
                </text>
                {ds.map((d, m) => (
                  <Pill
                    key={`${d.job.id}-${m}`}
                    x={36 + m * 76}
                    y={250 + k * 26}
                    text={d.status === 'requeued' ? `${d.job.id} requeued` : d.status === 'failed' ? `${d.job.id} failed` : `${d.job.id} ${d.wait}s`}
                    tone={d.status === 'failed' ? 'bad' : d.status === 'requeued' ? 'warn' : ORG_TONE[o.id]}
                    size={9}
                  />
                ))}
              </g>
            );
          })}
        </Panel>
      </svg>
    </VizFrame>
  );
}
