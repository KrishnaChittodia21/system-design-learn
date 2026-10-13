import { useState } from 'react';
import { Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, KEY_COUNT, NODE_NAMES, simulate, type Params, type RingPoint } from './sim';

const PALETTE = [
  'var(--accent)',
  'var(--good)',
  'var(--warn)',
  'var(--bad)',
  'var(--text-2)',
  'color-mix(in srgb, var(--accent) 50%, var(--good))',
  'color-mix(in srgb, var(--warn) 50%, var(--bad))',
];
const color = (node: string) => PALETTE[NODE_NAMES.indexOf(node) % PALETTE.length];

const CX = 160;
const CY = 165;
const R = 122;

function xy(pos: number, r: number): [number, number] {
  const a = pos * 2 * Math.PI - Math.PI / 2; // 0 at 12 o'clock, clockwise
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/** clockwise arc from p0 to p1 at radius r */
function arcPath(p0: number, p1: number, r: number): string {
  let d = p1 - p0;
  if (d <= 0) d += 1;
  const [x0, y0] = xy(p0, r);
  const [x1, y1] = xy(p0 + d, r);
  return `M${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${d > 0.5 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
}

export default function ConsistentHashingViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = (k: keyof Params) => (v: number) => setParams((p) => ({ ...p, [k]: v }));

  const live = f.points.filter((p) => p.state !== 'gone');
  const showPointLabels = f.points.length <= 24;
  const maxCount = Math.max(KEY_COUNT / 2, ...f.nodes.map((n) => Math.max(f.counts[n] ?? 0, (f.share[n] ?? 0) * KEY_COUNT)));
  const barX = 360;
  const barW = 200;
  const avg = KEY_COUNT / f.nodes.length;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Physical nodes" value={params.nodes} min={2} max={6} onChange={set('nodes')} />
          <Slider label="Vnodes per node" value={params.vnodes} min={1} max={32} onChange={set('vnodes')} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--muted)' }} /> key (coloured by owner)
          <span className="viz-key ring" /> key that moved
          <span className="viz-key" style={{ background: 'var(--text)', borderRadius: 2 }} /> vnode point on the ring
          <span>dashed line = ideal keys per node</span>
        </>
      }
    >
      <svg
        viewBox="0 0 600 330"
        className="viz-svg"
        role="img"
        aria-label={`Hash ring with ${live.length} points for nodes ${f.nodes.join(', ')}; ${f.keys.filter((k) => k.moved).length} keys just moved`}
      >
        <defs>
          <marker id="ch-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text)" />
          </marker>
        </defs>
        {/* base ring and owned arcs */}
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border)" strokeWidth={10} />
        {live.length === 1 ? (
          <circle cx={CX} cy={CY} r={R} fill="none" stroke={color(live[0].node)} strokeWidth={10} opacity={0.55} />
        ) : (
          live.map((p, i) => {
            const prev = live[(i - 1 + live.length) % live.length];
            return <path key={`a${p.node}${p.vi}`} d={arcPath(prev.pos, p.pos, R)} fill="none" stroke={color(p.node)} strokeWidth={10} opacity={0.55} />;
          })
        )}
        <line x1={CX} x2={CX} y1={CY - R - 8} y2={CY - R + 8} stroke="var(--text-2)" strokeWidth={1.5} />
        <text x={CX - 8} y={CY - R - 28} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
          0 / 2³² ↓
        </text>
        <text x={CX} y={CY - 4} textAnchor="middle" className="viz-label">
          clockwise →
        </text>
        <text x={CX} y={CY + 12} textAnchor="middle" className="viz-label">
          {live.length} points
        </text>
        {/* trace arrow */}
        {f.trace && (
          <path d={arcPath(f.trace.keyPos, f.trace.pointPos, R - 30)} fill="none" stroke="var(--text)" strokeWidth={2.5} markerEnd="url(#ch-arrow)" />
        )}
        {/* keys */}
        {f.showKeys &&
          f.keys.map((k, i) => {
            const [x, y] = xy(k.pos, R - (i % 2 ? 26 : 18));
            const traced = f.trace?.key === k.id;
            return (
              <circle
                key={k.id}
                cx={x}
                cy={y}
                r={k.moved || traced ? 6 : 3.5}
                fill={color(k.owner)}
                stroke={k.moved || traced ? 'var(--text)' : 'none'}
                strokeWidth={2}
                className="viz-dot"
              >
                <title>{`${k.id} → ${k.owner}${k.prev ? ` (was ${k.prev})` : ''}`}</title>
              </circle>
            );
          })}
        {/* vnode points */}
        {f.points.map((p: RingPoint) => {
          const [x, y] = xy(p.pos, R);
          const [lx, ly] = xy(p.pos, R + 17);
          const gone = p.state === 'gone';
          return (
            <g key={`p${p.node}${p.vi}`}>
              <rect
                x={x - (p.state === 'new' ? 6 : 4.5)}
                y={y - (p.state === 'new' ? 6 : 4.5)}
                width={p.state === 'new' ? 12 : 9}
                height={p.state === 'new' ? 12 : 9}
                rx={2}
                fill={gone ? 'var(--surface)' : color(p.node)}
                stroke={gone ? 'var(--bad)' : 'var(--surface)'}
                strokeDasharray={gone ? '2 2' : undefined}
                strokeWidth={gone ? 1.5 : 1.5}
              />
              {showPointLabels && (
                <text x={lx} y={ly + 4} textAnchor="middle" className="viz-label" style={{ textDecoration: gone ? 'line-through' : undefined }}>
                  {p.node}
                  {p.vi}
                </text>
              )}
            </g>
          );
        })}

        {/* per-node load bars */}
        <text x={330} y={22} className="viz-label">
          keys per node (thin bar = ring share)
        </text>
        {f.nodes.map((n, i) => {
          const y = 34 + i * 25;
          const c = f.counts[n] ?? 0;
          return (
            <g key={n}>
              <rect x={330} y={y} width={14} height={14} rx={3} fill={color(n)} />
              <text x={350} y={y + 12} className="viz-node-label" style={{ fontSize: 12 }}>
                {n}
              </text>
              <rect x={barX + 8} y={y} width={barW} height={14} rx={3} fill="var(--surface-2)" />
              <rect x={barX + 8} y={y} width={(c / maxCount) * barW} height={14} rx={3} fill={color(n)} opacity={0.8} />
              <rect x={barX + 8} y={y + 16} width={(((f.share[n] ?? 0) * KEY_COUNT) / maxCount) * barW} height={3} rx={1.5} fill="var(--text-2)" />
              <text x={barX + 14 + barW} y={y + 12} className="viz-label">
                {c}
              </text>
            </g>
          );
        })}
        <line
          x1={barX + 8 + (avg / maxCount) * barW}
          x2={barX + 8 + (avg / maxCount) * barW}
          y1={30}
          y2={34 + f.nodes.length * 25 - 6}
          stroke="var(--text-2)"
          strokeDasharray="3 3"
        />

        {/* moved-keys comparison */}
        {f.compare && (
          <g>
            <text x={330} y={232} className="viz-label">
              keys moved on {f.compare.label}
            </text>
            {[
              { label: 'ring', v: f.compare.ring, c: 'var(--good)' },
              { label: 'hash % N', v: f.compare.naive, c: 'var(--bad)' },
            ].map((r, i) => (
              <g key={r.label}>
                <text x={330} y={256 + i * 26} className="viz-label">
                  {r.label}
                </text>
                <rect x={395} y={245 + i * 26} width={170} height={14} rx={3} fill="var(--surface-2)" />
                <rect x={395} y={245 + i * 26} width={(r.v / f.compare!.total) * 170} height={14} rx={3} fill={r.c} />
                <text x={571} y={256 + i * 26} className="viz-label">
                  {Math.round((r.v / f.compare!.total) * 100)}%
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </VizFrame>
  );
}
