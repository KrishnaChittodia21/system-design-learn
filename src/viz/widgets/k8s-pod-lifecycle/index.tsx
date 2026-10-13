import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { BACKOFF_CAP, DEFAULT_PARAMS, MAX_REPLICAS, simulate, type Frame, type Params, type PodView, type Scenario, type Status } from './sim';

const STATUS_COLOR: Record<Status, string> = {
  Pending: 'var(--bad)',
  ContainerCreating: 'var(--warn)',
  Running: 'var(--good)',
  CrashLoopBackOff: 'var(--bad)',
  OOMKilled: 'var(--bad)',
  Terminating: 'var(--muted)',
};

const NODE_TOP = 22;
const ROW_H = 24;
const PANEL_TOP = 178;

function PodRow({ pod, x, y, w }: { pod: PodView; x: number; y: number; w: number }) {
  const tone = pod.tone ? `var(--${pod.tone}-soft)` : 'var(--surface)';
  const narrow = w < 170;
  return (
    <g>
      <rect x={x} y={y} width={w} height={ROW_H - 4} rx={5} fill={tone} stroke={pod.tone ? `var(--${pod.tone})` : 'var(--border)'} style={{ transition: 'fill 0.3s ease' }} />
      <circle cx={x + 9} cy={y + (ROW_H - 4) / 2} r={4.5} fill={pod.ready ? 'var(--good)' : 'var(--surface-2)'} stroke={pod.ready ? 'var(--good)' : 'var(--muted)'} />
      <text x={x + 18} y={y + 14} fontSize={10} fontWeight={600} style={{ fontFamily: 'var(--mono)' }}>
        {pod.name}
      </text>
      <text x={x + w - 6} y={y + 14} textAnchor="end" fontSize={9.5} fontWeight={700} style={{ fill: STATUS_COLOR[pod.status] }}>
        {narrow && pod.status === 'ContainerCreating' ? 'Creating' : narrow && pod.status === 'CrashLoopBackOff' ? 'CrashLoop' : pod.status}
        {pod.restarts ? ` ↻${pod.restarts}` : ''}
      </text>
    </g>
  );
}

function Nodes({ f }: { f: Frame }) {
  const n = f.nodes.length;
  const gap = 10;
  const w = (580 - gap * (n - 1)) / n;
  const pending = f.pods.filter((p) => !p.node);
  return (
    <g>
      {f.nodes.map((nd, i) => {
        const x = 10 + i * (w + gap);
        const pods = f.pods.filter((p) => p.node === nd.name);
        const prov = nd.state === 'provisioning';
        return (
          <g key={nd.name}>
            <rect x={x} y={NODE_TOP} width={w} height={22 + nd.slots * ROW_H} rx={8} fill={prov ? 'var(--warn-soft)' : 'var(--surface-2)'} stroke={prov ? 'var(--warn)' : 'var(--border)'} strokeDasharray={prov ? '5 3' : undefined} />
            <text x={x + 8} y={NODE_TOP + 15} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
              {nd.name}
              {prov ? ' · booting…' : ` · ${pods.length}/${nd.slots} pods`}
            </text>
            {pods.map((p, k) => (
              <PodRow key={p.name} pod={p} x={x + 6} y={NODE_TOP + 22 + k * ROW_H} w={w - 12} />
            ))}
          </g>
        );
      })}
      {pending.length > 0 && (
        <g>
          <text x={10} y={NODE_TOP + 22 + 3 * ROW_H + 18} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--bad)' }}>
            unscheduled:
          </text>
          {pending.map((p, k) => {
            const pw = Math.min(122, 496 / pending.length - 6);
            return <PodRow key={p.name} pod={p} x={92 + k * (pw + 6)} y={NODE_TOP + 22 + 3 * ROW_H + 5} w={pw} />;
          })}
        </g>
      )}
    </g>
  );
}

function Service({ f, y }: { f: Frame; y: number }) {
  return (
    <g>
      <rect x={10} y={y} width={92} height={22} rx={11} fill="var(--accent-soft)" stroke="var(--accent)" />
      <text x={56} y={y + 15} textAnchor="middle" fontSize={10.5} fontWeight={700} style={{ fill: 'var(--accent)' }}>
        Service
      </text>
      <text x={110} y={y + 15} fontSize={10.5}>
        → endpoints ({f.endpoints.length}): <tspan style={{ fontFamily: 'var(--mono)' }}>{f.endpoints.length > 6 ? `${f.endpoints.slice(0, 6).join(', ')}, …` : f.endpoints.join(', ') || 'none'}</tspan>
      </text>
    </g>
  );
}

function BackoffPanel({ f }: { f: Frame }) {
  const x0 = 110;
  const scale = 460 / BACKOFF_CAP;
  return (
    <g>
      <text x={10} y={PANEL_TOP + 12} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
        restart back-off (CrashLoopBackOff): 10s × 2ⁿ, capped at 300s
      </text>
      {[10, 20, 40, 80, 160, 300].map((b, i) => {
        const seen = i < f.backoffs.length;
        const cur = i === f.backoffs.length - 1;
        const y = PANEL_TOP + 22 + i * 18;
        return (
          <g key={i}>
            <text x={x0 - 8} y={y + 11} textAnchor="end" fontSize={10} style={{ fill: seen ? 'var(--text)' : 'var(--muted)' }}>
              restart #{i + 1}
            </text>
            <rect x={x0} y={y} width={b * scale} height={13} rx={3} fill={seen ? (cur ? 'var(--bad)' : 'var(--bad-soft)') : 'var(--surface-2)'} stroke={seen ? 'var(--bad)' : 'var(--border)'} style={{ transition: 'fill 0.3s ease' }} />
            <text x={x0 + b * scale + 6} y={y + 11} fontSize={10} fontWeight={cur ? 700 : 400} style={{ fill: seen ? 'var(--text)' : 'var(--muted)' }}>
              {b}s{b === BACKOFF_CAP ? ' (cap)' : ''}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function MemPanel({ f }: { f: Frame }) {
  const m = f.mem!;
  const X = 50;
  const W = 530;
  const top = PANEL_TOP + 20;
  const bot = PANEL_TOP + 140;
  const tMax = Math.max(360, m.hist[m.hist.length - 1]?.t ?? 0);
  const x = (t: number) => X + (t / tMax) * W;
  const y = (v: number) => bot - (v / 600) * (bot - top);
  const d = m.hist.map((h, i) => `${i ? 'L' : 'M'}${x(h.t)},${y(h.mib)}`).join(' ');
  const last = m.hist[m.hist.length - 1];
  return (
    <g>
      <text x={10} y={PANEL_TOP + 12} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
        worker-5c-a memory (MiB)
      </text>
      <line x1={X} y1={bot} x2={X + W} y2={bot} stroke="var(--border)" />
      <line x1={X} y1={y(m.limit)} x2={X + W} y2={y(m.limit)} stroke="var(--bad)" strokeWidth={1.6} strokeDasharray="6 3" />
      <text x={X + W} y={y(m.limit) - 4} textAnchor="end" fontSize={10} style={{ fill: 'var(--bad)' }}>
        limit {m.limit}Mi → OOMKilled
      </text>
      <line x1={X} y1={y(m.request)} x2={X + W} y2={y(m.request)} stroke="var(--text-2)" strokeWidth={1.2} strokeDasharray="3 3" />
      <text x={X + W} y={y(m.request) - 4} textAnchor="end" fontSize={10} style={{ fill: 'var(--text-2)' }}>
        request {m.request}Mi (scheduling only)
      </text>
      {[0, 256, 512].map((v) => (
        <text key={v} x={X - 5} y={y(v) + 3} textAnchor="end" fontSize={9} style={{ fill: 'var(--text-2)' }}>
          {v}
        </text>
      ))}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2.2} />
      {last && <circle cx={x(last.t)} cy={y(last.mib)} r={4} fill={last.mib >= m.limit ? 'var(--bad)' : 'var(--accent)'} />}
    </g>
  );
}

function HpaPanel({ f }: { f: Frame }) {
  const h = f.hpa!;
  const X = 50;
  const W = 330;
  const top = PANEL_TOP + 22;
  const bot = PANEL_TOP + 138;
  const n = h.hist.length;
  const x = (i: number) => X + (n <= 1 ? 0 : (i / Math.max(n - 1, 1)) * W);
  const yR = (r: number) => bot - (r / MAX_REPLICAS) * (bot - top);
  const yU = (u: number) => bot - (Math.min(u, 200) / 200) * (bot - top);
  const util = h.hist.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${yU(p.util)}`).join(' ');
  const scaling = h.desired !== h.current;
  return (
    <g>
      <text x={10} y={PANEL_TOP + 12} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
        replicas (bars) and CPU % of request (line) per 15s sync
      </text>
      <line x1={X} y1={bot} x2={X + W} y2={bot} stroke="var(--border)" />
      <line x1={X} y1={yU(h.target)} x2={X + W} y2={yU(h.target)} stroke="var(--good)" strokeDasharray="5 3" />
      <text x={X - 4} y={yU(h.target) + 3} textAnchor="end" fontSize={9} style={{ fill: 'var(--good)' }}>
        {h.target}%
      </text>
      {h.hist.map((p, i) => (
        <rect key={i} x={x(i) - 6} y={yR(p.replicas)} width={12} height={bot - yR(p.replicas)} fill="var(--accent-soft)" stroke="var(--accent)" />
      ))}
      <path d={util} fill="none" stroke="var(--warn)" strokeWidth={2} />
      {h.hist.length > 0 && (
        <text x={x(n - 1)} y={yR(h.hist[n - 1].replicas) - 4} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: 'var(--accent)' }}>
          {h.hist[n - 1].replicas}
        </text>
      )}
      <rect x={398} y={PANEL_TOP + 4} width={192} height={134} rx={8} fill={scaling ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke={scaling ? 'var(--accent)' : 'var(--border)'} />
      <text x={408} y={PANEL_TOP + 22} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
        HPA (every 15s)
      </text>
      <text x={408} y={PANEL_TOP + 42} fontSize={10}>
        load {h.load}m · avg {Math.round(h.util)}% CPU
      </text>
      <text x={408} y={PANEL_TOP + 62} fontSize={10}>
        desired = ceil(cur × util / target)
      </text>
      <text x={408} y={PANEL_TOP + 80} fontSize={10.5} fontWeight={700} style={{ fontFamily: 'var(--mono)' }}>
        {h.formula}
      </text>
      <text x={408} y={PANEL_TOP + 100} fontSize={10}>
        replicas now: <tspan fontWeight={700}>{h.current}</tspan>
      </text>
      <text x={408} y={PANEL_TOP + 118} fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
        ±10% tolerance · down: 300s window
      </text>
      <text x={408} y={PANEL_TOP + 132} fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
        up: ≤ max(+100%, +4) per 15s
      </text>
    </g>
  );
}

function Table({ f }: { f: Frame }) {
  const cols = [10, 150, 210, 360, 440];
  return (
    <g style={{ fontFamily: 'var(--mono)' }}>
      <text x={10} y={PANEL_TOP + 12} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)', fontFamily: 'var(--sans)' }}>
        $ kubectl get pods -o wide
      </text>
      {['NAME', 'READY', 'STATUS', 'RESTARTS', 'NODE'].map((h, i) => (
        <text key={h} x={cols[i]} y={PANEL_TOP + 30} fontSize={10} style={{ fill: 'var(--muted)' }}>
          {h}
        </text>
      ))}
      {f.pods.map((p, r) => (
        <g key={p.name}>
          <text x={cols[0]} y={PANEL_TOP + 48 + r * 18} fontSize={10.5}>
            {p.name}
          </text>
          <text x={cols[1]} y={PANEL_TOP + 48 + r * 18} fontSize={10.5} style={{ fill: p.ready ? 'var(--good)' : 'var(--bad)' }}>
            {p.ready ? '1/1' : '0/1'}
          </text>
          <text x={cols[2]} y={PANEL_TOP + 48 + r * 18} fontSize={10.5} style={{ fill: STATUS_COLOR[p.status] }}>
            {p.status}
          </text>
          <text x={cols[3]} y={PANEL_TOP + 48 + r * 18} fontSize={10.5}>
            {p.restarts}
          </text>
          <text x={cols[4]} y={PANEL_TOP + 48 + r * 18} fontSize={10.5}>
            {p.node ?? '<none>'}
          </text>
        </g>
      ))}
    </g>
  );
}

export default function K8sPodLifecycleViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const sc = params.scenario;
  const set = (k: keyof Params) => (v: number) => setParams((p) => ({ ...p, [k]: v }));
  const hasPending = f.pods.some((p) => !p.node);
  const svcY = NODE_TOP + 22 + 3 * ROW_H + (hasPending ? 32 : 10);

  const aria = `${sc} scenario at t=${f.t}s. ${f.pods.map((p) => `${p.name} ${p.status}${p.ready ? ' ready' : ' not ready'}${p.restarts ? `, ${p.restarts} restarts` : ''}`).join('; ')}. Service endpoints: ${f.endpoints.length}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Scenario>
            label="Scenario"
            value={sc}
            options={[
              { value: 'rollout', label: 'Healthy rollout' },
              { value: 'crashloop', label: 'Crash loop' },
              { value: 'oom', label: 'OOMKilled' },
              { value: 'scaleup', label: 'Scale-up (HPA)' },
            ]}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
          {sc === 'rollout' && <Slider label="App startup time" value={params.startup} min={5} max={30} step={5} onChange={set('startup')} format={(v) => `${v}s`} />}
          {sc === 'crashloop' && <Slider label="Liveness failureThreshold" value={params.failureThreshold} min={1} max={5} onChange={set('failureThreshold')} format={(v) => `${v} × 10s`} />}
          {sc === 'scaleup' && <Slider label="HPA target CPU" value={params.target} min={50} max={90} step={10} onChange={set('target')} format={(v) => `${v}%`} />}
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> ready (in Service endpoints)
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> starting / not ready
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> Pending, killed or backing off
          <span className="viz-key" style={{ background: 'var(--muted)' }} /> Terminating
        </>
      }
    >
      <svg viewBox="0 0 600 330" className="viz-svg" role="img" aria-label={aria}>
        <text x={10} y={14} className="viz-label">
          t = {f.t >= 60 ? `${Math.floor(f.t / 60)}m${f.t % 60 ? `${f.t % 60}s` : ''}` : `${f.t}s`}
        </text>
        <Nodes f={f} />
        <Service f={f} y={svcY} />
        {sc === 'rollout' && <Table f={f} />}
        {sc === 'crashloop' && <BackoffPanel f={f} />}
        {sc === 'oom' && <MemPanel f={f} />}
        {sc === 'scaleup' && <HpaPanel f={f} />}
      </svg>
    </VizFrame>
  );
}
