import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, MODE_NAME, simulate, type Caller, type FlowKind, type Mode, type Params, type PeerAuth, type Pod, type RetryLayers } from './sim';
import './mesh-sidecars.css';

const POD_Y = [66, 158, 250];
const PX = 398;
const SC = { x: 102, y: 148, w: 76, h: 48 }; // caller sidecar
const FLOW_COLOR: Record<FlowKind, string> = {
  ok: 'var(--good)',
  fail: 'var(--bad)',
  mtls: 'var(--accent)',
  plain: 'var(--warn)',
  rejected: 'var(--bad)',
};
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' as const };

function podStyle(p: Pod) {
  switch (p.state) {
    case 'failing':
      return { fill: 'var(--bad-soft)', stroke: 'var(--bad)', tag: '5xx', opacity: 1 };
    case 'ejected':
      return { fill: 'var(--surface)', stroke: 'var(--line-2)', tag: 'EJECTED', opacity: 0.5 };
    case 'unready':
      return { fill: 'var(--warn-soft)', stroke: 'var(--warn)', tag: 'no config/cert', opacity: 1 };
    case 'dead':
      return { fill: 'var(--surface)', stroke: 'var(--bad)', tag: 'DEAD', opacity: 0.45 };
    case 'absent':
      return { fill: 'transparent', stroke: 'var(--line-2)', tag: '', opacity: 0.6 };
    default:
      return { fill: 'var(--good-soft)', stroke: 'var(--good)', tag: 'healthy', opacity: 1 };
  }
}

export default function MeshSidecarsViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const cpDown = f.cp === 'down';

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <div className="ms-ctl">
          <Choice<Mode> label="Scenario" value={params.mode} options={(Object.keys(MODE_NAME) as Mode[]).map((k) => ({ value: k, label: MODE_NAME[k] }))} onChange={set('mode')} />
          {params.mode === 'mtls' && (
            <>
              <Choice<Caller>
                label="Caller"
                value={params.caller}
                options={[
                  { value: 'meshed', label: 'Meshed pod' },
                  { value: 'legacy', label: 'Legacy VM, no sidecar' },
                ]}
                onChange={set('caller')}
              />
              <Choice<PeerAuth>
                label="PeerAuthentication"
                value={params.peerAuth}
                options={[
                  { value: 'PERMISSIVE', label: 'PERMISSIVE' },
                  { value: 'STRICT', label: 'STRICT' },
                ]}
                onChange={set('peerAuth')}
              />
            </>
          )}
          {params.mode === 'retries' && (
            <Choice<RetryLayers>
              label="Who retries"
              value={params.retryLayers}
              options={[
                { value: 'mesh', label: 'Mesh only' },
                { value: 'app', label: 'App + mesh' },
                { value: 'gateway', label: 'Gateway + app + mesh' },
              ]}
              onChange={set('retryLayers')}
            />
          )}
          {params.mode === 'canary' && <Slider label="Weight to v2" value={params.weight} min={0} max={50} step={5} onChange={set('weight')} format={(v) => `${v}%`} />}
        </div>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> mTLS / config push (xDS)
          <span className="viz-key" style={{ background: 'var(--good)' }} /> success
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> error / rejected
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> plaintext
        </>
      }
    >
      <svg
        viewBox="0 0 600 330"
        className="viz-svg"
        role="img"
        aria-label={`Control plane ${f.cp}. ${f.pods.map((p) => `${p.label} ${p.state}, ${p.got} requests`).join('; ')}.`}
      >
        <defs>
          {(Object.keys(FLOW_COLOR) as FlowKind[]).map((k) => (
            <marker key={k} id={`ms-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={FLOW_COLOR[k]} />
            </marker>
          ))}
        </defs>

        {/* control plane */}
        <rect x={214} y={6} width={172} height={44} rx={10} fill={cpDown ? 'var(--bad-soft)' : 'var(--accent-soft)'} stroke={cpDown ? 'var(--bad)' : 'var(--accent)'} strokeWidth={1.8} />
        <text x={300} y={24} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 700 }}>
          istiod · control plane
        </text>
        <text x={300} y={40} textAnchor="middle" className="viz-label" style={{ fontSize: 10.5 }}>
          {cpDown ? '✕ DOWN: no pushes, no new certs' : 'config (xDS) + certs (SDS)'}
        </text>
        {f.push && (
          <g stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="5 4" fill="none">
            {f.callerSidecar && <path d={`M260,50 Q${SC.x + 38},70 ${SC.x + SC.w / 2},${SC.y}`} />}
            {POD_Y.map((y, i) => (f.pods[i].state === 'absent' ? null : <path key={y} d={`M340,50 Q${PX + 40},${Math.max(56, y - 10)} ${PX + 44},${y + 12}`} />))}
          </g>
        )}

        {/* caller pod */}
        <rect x={8} y={110} width={180} height={112} rx={12} fill="none" stroke="var(--line-2)" strokeDasharray="4 3" />
        <text x={16} y={126} className="viz-label" style={{ fontSize: 10.5 }}>
          {f.callerSidecar ? 'pod: service A' : 'legacy VM (no sidecar)'}
        </text>
        <rect x={18} y={SC.y} width={f.callerSidecar ? 74 : 160} height={SC.h} rx={8} fill="var(--surface)" stroke="var(--line-2)" />
        <text x={f.callerSidecar ? 55 : 98} y={SC.y + 21} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700 }}>
          app A
        </text>
        <text x={f.callerSidecar ? 55 : 98} y={SC.y + 36} textAnchor="middle" className="viz-label" style={{ fontSize: 9.5 }}>
          http://b:8080
        </text>
        {f.callerSidecar && (
          <>
            <line x1={92} x2={SC.x} y1={SC.y + 24} y2={SC.y + 24} stroke="var(--ink-4)" strokeWidth={1.4} />
            <rect x={SC.x} y={SC.y} width={SC.w} height={SC.h} rx={8} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.6} />
            <text x={SC.x + SC.w / 2} y={SC.y + 21} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700 }}>
              sidecar
            </text>
            <text x={SC.x + SC.w / 2} y={SC.y + 36} textAnchor="middle" className="viz-label" style={{ fontSize: 9.5 }}>
              Envoy :15001
            </text>
          </>
        )}
        <text x={14} y={240} style={{ fontSize: 10.5, fontWeight: 700, fill: 'var(--accent)', fontFamily: 'var(--f-mono)' }}>
          {f.config}
        </text>

        {/* flows */}
        {f.flows.map((fl, k) => {
          const y = POD_Y[fl.to] + 35;
          const x1 = f.callerSidecar ? SC.x + SC.w : 178;
          const y1 = SC.y + 24 + (fl.to - 1) * 6;
          const x2 = PX + 10;
          const d = `M${x1},${y1} C${x1 + 90},${y1} ${x2 - 90},${y} ${x2},${y}`;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y) / 2;
          return (
            <g key={k}>
              <path d={d} fill="none" stroke={FLOW_COLOR[fl.kind]} strokeWidth={2} strokeDasharray={fl.kind === 'plain' ? '6 4' : undefined} markerEnd={`url(#ms-arrow-${fl.kind})`} />
              {fl.kind === 'rejected' && (
                <text x={x2 - 14} y={y + 4} textAnchor="middle" style={{ fontSize: 14, fontWeight: 800, fill: 'var(--bad)' }}>
                  ✕
                </text>
              )}
              {fl.label && (
                <text x={mx} y={my - 4} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 700, fill: FLOW_COLOR[fl.kind], ...halo }}>
                  {fl.label}
                </text>
              )}
            </g>
          );
        })}

        {/* B pods */}
        {f.pods.map((p, i) => {
          const y = POD_Y[i];
          const s = podStyle(p);
          return (
            <g key={i} opacity={s.opacity} style={{ transition: 'opacity 0.3s ease' }}>
              <rect x={PX} y={y} width={194} height={70} rx={12} fill="none" stroke="var(--line-2)" strokeDasharray="4 3" />
              {p.state !== 'absent' && (
                <>
                  <rect x={PX + 10} y={y + 12} width={64} height={46} rx={8} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.4} />
                  <text x={PX + 42} y={y + 32} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700 }}>
                    sidecar
                  </text>
                  <text x={PX + 42} y={y + 46} textAnchor="middle" className="viz-label" style={{ fontSize: 9 }}>
                    :15006
                  </text>
                  <line x1={PX + 74} x2={PX + 82} y1={y + 35} y2={y + 35} stroke="var(--ink-4)" />
                  <rect x={PX + 82} y={y + 12} width={104} height={46} rx={8} fill={s.fill} stroke={s.stroke} strokeWidth={1.6} style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }} />
                  <text x={PX + 134} y={y + 29} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 700 }}>
                    {p.label}
                  </text>
                  <text x={PX + 134} y={y + 43} textAnchor="middle" style={{ fontSize: 9.5, fontWeight: 700, fill: s.stroke }}>
                    {s.tag}
                  </text>
                  <text x={PX + 134} y={y + 54} textAnchor="middle" className="viz-label" style={{ fontSize: 9 }}>
                    {p.version} · {p.got} req{p.errs ? ` · ${p.errs}× 5xx` : ''}
                  </text>
                </>
              )}
              {p.state === 'absent' && (
                <text x={PX + 97} y={y + 40} textAnchor="middle" className="viz-label" style={{ fontSize: 10.5 }}>
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {f.stats.length > 0 && (
        <dl className="ms-stats">
          {f.stats.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </VizFrame>
  );
}
