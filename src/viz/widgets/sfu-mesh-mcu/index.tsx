import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, HOME_UPLINK, simulate, type Params, type Topology } from './sim';

const CX = 168;
const CY = 152;
const R = 118;
const BAR_X = 362;
const BAR_W = 200;
const SCALE_MAX = 16;

export default function SfuMeshMcuViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const { m } = f;
  const n = f.joined;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
  });
  const over = m.up > HOME_UPLINK;
  const topo = params.topology;
  const newest = stepper.i < frames.length - 1 ? n - 1 : -1;
  const bar = (v: number) => (Math.min(v, SCALE_MAX) / SCALE_MAX) * BAR_W;

  const aria = `${n} participants, ${topo}. Uplink ${m.up} Mbps and downlink ${m.down} Mbps per client. Added latency ${m.latencyMs} ms.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Topology>
            label="Topology"
            value={topo}
            options={[
              { value: 'mesh', label: 'Mesh (P2P)' },
              { value: 'mcu', label: 'MCU' },
              { value: 'sfu', label: 'SFU' },
            ]}
            onChange={(topology) => setParams((p) => ({ ...p, topology }))}
          />
          <Slider label="People in the call" value={params.max} min={3} max={12} onChange={(max) => setParams((p) => ({ ...p, max }))} />
          {topo === 'sfu' && (
            <Choice<'on' | 'off'>
              label="Simulcast"
              value={params.simulcast ? 'on' : 'off'}
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              onChange={(v) => setParams((p) => ({ ...p, simulcast: v === 'on' }))}
            />
          )}
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> media path
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> over a {HOME_UPLINK} Mbps home uplink
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> server transcoding
        </>
      }
    >
      <svg viewBox="0 0 600 300" className="viz-svg" role="img" aria-label={aria}>
        {/* edges */}
        {topo === 'mesh'
          ? pts.flatMap((a, i) =>
              pts.slice(i + 1).map((b, j) => (
                <line key={`${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={over ? 'var(--bad)' : 'var(--accent)'} strokeOpacity={0.55} strokeWidth={1.2} />
              )),
            )
          : pts.map((p, i) => (
              <g key={i}>
                <line x1={p.x} y1={p.y} x2={CX} y2={CY} stroke="var(--accent)" strokeWidth={topo === 'sfu' && params.simulcast ? 3 : 2} strokeOpacity={0.75} />
              </g>
            ))}

        {/* server */}
        {topo !== 'mesh' && (
          <g>
            <rect x={CX - 40} y={CY - 22} width={80} height={44} rx={10} fill="var(--surface)" />
            <rect x={CX - 40} y={CY - 22} width={80} height={44} rx={10} fill={topo === 'mcu' ? 'var(--warn-soft)' : 'var(--accent-soft)'} stroke={topo === 'mcu' ? 'var(--warn)' : 'var(--accent)'} strokeWidth={2} />
            <text x={CX} y={CY - 4} textAnchor="middle" fontSize={12} fontWeight={700}>
              {topo.toUpperCase()}
            </text>
            <text x={CX} y={CY + 12} textAnchor="middle" fontSize={9} style={{ fill: 'var(--text-2)' }}>
              {topo === 'mcu' ? 'decode·mix·encode' : 'forward packets'}
            </text>
          </g>
        )}

        {/* participants */}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={16} fill="var(--surface)" />
            <circle cx={p.x} cy={p.y} r={16} fill={i === newest ? 'var(--accent)' : over ? 'var(--bad-soft)' : 'var(--surface)'} stroke={over ? 'var(--bad)' : 'var(--accent)'} strokeWidth={i === newest ? 2.5 : 1.6} style={{ transition: 'fill 0.3s ease' }} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} style={{ fill: i === newest ? 'var(--surface)' : 'var(--text)' }}>
              P{i + 1}
            </text>
          </g>
        ))}

        {/* metrics */}
        <text x={BAR_X - 8} y={22} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          per participant ({n} in call)
        </text>
        {[
          { label: 'uplink', v: m.up, y: 34 },
          { label: 'downlink', v: m.down, y: 82 },
        ].map((b) => {
          const bad = b.label === 'uplink' && b.v > HOME_UPLINK;
          return (
            <g key={b.label}>
              <text x={BAR_X - 8} y={b.y + 12} fontSize={10.5}>
                {b.label}: <tspan fontWeight={700} style={{ fill: bad ? 'var(--bad)' : 'var(--text)' }}>{b.v} Mbps</tspan>
              </text>
              <rect x={BAR_X - 8} y={b.y + 18} width={BAR_W + 16} height={14} rx={3} fill="var(--surface)" stroke="var(--border)" />
              <rect x={BAR_X - 8} y={b.y + 18} width={bar(b.v)} height={14} rx={3} fill={bad ? 'var(--bad)' : 'var(--accent)'} style={{ transition: 'width 0.35s ease' }} />
              {b.label === 'uplink' && (
                <>
                  <line x1={BAR_X - 8 + bar(HOME_UPLINK)} y1={b.y + 14} x2={BAR_X - 8 + bar(HOME_UPLINK)} y2={b.y + 36} stroke="var(--bad)" strokeWidth={1.6} strokeDasharray="3 2" />
                  <text x={BAR_X - 8 + bar(HOME_UPLINK)} y={b.y + 46} textAnchor="middle" fontSize={8.5} style={{ fill: 'var(--bad)' }}>
                    home uplink {HOME_UPLINK}
                  </text>
                </>
              )}
            </g>
          );
        })}
        <rect x={BAR_X - 8} y={142} width={BAR_W + 16} height={148} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={BAR_X} y={160} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          server and network
        </text>
        <text x={BAR_X} y={182} fontSize={10.5}>
          server work:{' '}
          <tspan fontWeight={700} style={{ fill: topo === 'mcu' ? 'var(--warn)' : 'var(--text)' }}>
            {topo === 'mesh' ? 'none (no server)' : topo === 'mcu' ? `${m.serverCodec} decode/encode jobs` : `${m.serverForward} forwards, 0 transcodes`}
          </tspan>
        </text>
        <text x={BAR_X} y={202} fontSize={10.5}>
          added latency: <tspan fontWeight={700} style={{ fill: m.latencyMs > 100 ? 'var(--warn)' : 'var(--good)' }}>{m.latencyMs ? `~${m.latencyMs} ms` : '0 ms (direct)'}</tspan>
        </text>
        <text x={BAR_X} y={222} fontSize={10.5}>
          streams on the wire: <tspan fontWeight={700}>{m.wireStreams}</tspan>
        </text>
        <text x={BAR_X} y={242} fontSize={10.5}>
          client decodes: <tspan fontWeight={700}>{topo === 'mcu' ? 1 : n - 1} video streams</tspan>
        </text>
        {/* uplink growth sparkline */}
        <text x={BAR_X} y={264} className="viz-label" style={{ fontSize: 9.5 }}>
          uplink as people join (2 → {params.max})
        </text>
        <polyline
          points={f.history.map((h, i) => `${BAR_X + (i / Math.max(1, params.max - 2)) * (BAR_W - 10)},${284 - (Math.min(h.up, SCALE_MAX) / SCALE_MAX) * 14}`).join(' ')}
          fill="none"
          stroke={over ? 'var(--bad)' : 'var(--accent)'}
          strokeWidth={2}
        />
      </svg>
    </VizFrame>
  );
}
