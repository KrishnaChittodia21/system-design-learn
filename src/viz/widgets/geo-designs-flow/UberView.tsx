import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { Key, Panel, Pill } from './kit';
import { BRIDGE_ROW, COLS, RIDER, RIVER_AFTER_COL, ROWS, STALE_S, simulateUber, type Rank, type UberParams } from './sim';

const G = { x: 10, y: 10, cell: 40 };
const cx = (x: number) => G.x + x * G.cell + G.cell / 2;
const cy = (y: number) => G.y + y * G.cell + G.cell / 2;
const ON_OFF = [
  { value: 'on' as const, label: 'On' },
  { value: 'off' as const, label: 'Off' },
];

export default function UberView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<UberParams>({ rank: 'eta', rival: false, ignore: false });
  const frames = useSimulation(simulateUber, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const riverX = G.x + (RIVER_AFTER_COL + 1) * G.cell;
  const aria = `Uber matching step ${stepper.i + 1}: trip ${f.trip}, ring ${Math.max(0, f.ringK)}, candidates ${f.cands.map((c) => `${c.id} ${c.eta} min`).join(', ') || 'none'}. ${f.assigned ? `Assigned ${f.assigned}.` : ''}`;

  return (
    <VizFrame
      title="Uber: pings, rings, road ETA and offers that cannot double-book"
      blurb="A rider requests a ride east of a river with one bridge. Rank candidates by straight-line distance or by road ETA, add a rival dispatcher grabbing the same driver, or let the first driver ignore the offer."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<Rank>
            label="Rank candidates by"
            value={params.rank}
            options={[
              { value: 'distance', label: 'Straight-line distance' },
              { value: 'eta', label: 'Road ETA' },
            ]}
            onChange={(rank) => setParams((p) => ({ ...p, rank }))}
          />
          <Choice<'on' | 'off'> label="Rival dispatcher" value={params.rival ? 'on' : 'off'} options={ON_OFF} onChange={(v) => setParams((p) => ({ ...p, rival: v === 'on' }))} />
          <Choice<'on' | 'off'> label="Driver ignores offer" value={params.ignore ? 'on' : 'off'} options={ON_OFF} onChange={(v) => setParams((p) => ({ ...p, ignore: v === 'on' }))} />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> idle driver (fresh ping)
          <Key tone="warn" /> offered / ring searched
          <Key tone="good" /> assigned · route
          <Key tone="muted" /> on trip or stale
        </>
      }
    >
      <svg viewBox="0 0 600 300" className="viz-svg" role="img" aria-label={aria}>
        <rect x={G.x} y={G.y} width={COLS * G.cell} height={ROWS * G.cell} rx={8} fill="var(--surface)" stroke="var(--line-2)" />
        {/* streets */}
        {Array.from({ length: ROWS }, (_, y) => (
          <line key={`r${y}`} x1={cx(0)} x2={cx(COLS - 1)} y1={cy(y)} y2={cy(y)} stroke="var(--line-2)" strokeWidth={1} />
        ))}
        {Array.from({ length: COLS }, (_, x) => (
          <line key={`c${x}`} x1={cx(x)} x2={cx(x)} y1={cy(0)} y2={cy(ROWS - 1)} stroke="var(--line-2)" strokeWidth={1} />
        ))}
        {/* river with one bridge */}
        <rect x={riverX - 7} y={G.y} width={14} height={ROWS * G.cell} fill="var(--blue)" opacity={0.28} />
        <rect x={riverX - 9} y={cy(BRIDGE_ROW) - 4} width={18} height={8} rx={2} fill="var(--ink-3)" />
        <text x={riverX + 10} y={G.y + ROWS * G.cell - 8} fontSize={9.5} className="gdf-muted">
          river
        </text>
        <text x={riverX + 12} y={cy(BRIDGE_ROW) - 8} fontSize={9.5} className="gdf-muted">
          only bridge
        </text>
        {/* ring */}
        {f.ringK >= 0 && (
          <rect
            x={G.x + Math.max(0, RIDER.x - f.ringK) * G.cell}
            y={G.y + Math.max(0, RIDER.y - f.ringK) * G.cell}
            width={(Math.min(COLS - 1, RIDER.x + f.ringK) - Math.max(0, RIDER.x - f.ringK) + 1) * G.cell}
            height={(Math.min(ROWS - 1, RIDER.y + f.ringK) - Math.max(0, RIDER.y - f.ringK) + 1) * G.cell}
            fill="var(--warn-soft)"
            stroke="var(--warn)"
            strokeDasharray="5 3"
            style={{ transition: 'all 0.35s ease' }}
          />
        )}
        {/* route */}
        {f.path && <polyline className="gdf-pop" points={f.path.map((p) => `${cx(p.x)},${cy(p.y)}`).join(' ')} fill="none" stroke="var(--good)" strokeWidth={3.5} strokeLinejoin="round" opacity={0.85} />}
        {/* rider */}
        <path d={`M${cx(RIDER.x)},${cy(RIDER.y) - 11} l3,7 7.5,0.5 -5.8,4.7 2,7.3 -6.7,-4 -6.7,4 2,-7.3 -5.8,-4.7 7.5,-0.5z`} fill="var(--warn)" stroke="var(--ink)" strokeWidth={1} />
        {/* drivers */}
        {f.drivers.map((d) => {
          const stale = d.lastPingS > STALE_S;
          const fill = d.id === f.assigned ? 'var(--good)' : d.state === 'OFFERED' ? 'var(--warn)' : d.state === 'ON_TRIP' || stale ? 'var(--ink-4)' : 'var(--blue)';
          return (
            <g key={d.id} style={{ transition: 'all 0.3s ease' }}>
              <circle cx={cx(d.x)} cy={cy(d.y)} r={9} fill={fill} stroke="var(--surface)" strokeWidth={2} />
              <text x={cx(d.x)} y={cy(d.y) + 3.5} textAnchor="middle" fontSize={8.5} fontWeight={800} style={{ fill: 'var(--on-accent)' }}>
                {d.id}
              </text>
              {(stale || d.state !== 'IDLE') && (
                <text x={cx(d.x)} y={cy(d.y) + 20} textAnchor="middle" fontSize={8} className="gdf-muted">
                  {stale ? `${d.lastPingS}s ago` : d.state === 'ON_TRIP' ? (d.id === f.assigned ? 'assigned' : 'on trip') : d.id === f.offered ? 'offered' : 'rival took it'}
                </text>
              )}
            </g>
          );
        })}

        <Panel x={460} y={10} w={132} h={280} title="Candidates">
          {['id', 'km', 'ETA'].map((h, k) => (
            <text key={h} x={470 + k * 40} y={42} fontSize={9.5} fontWeight={700} className="gdf-muted">
              {h}
            </text>
          ))}
          {f.cands.length === 0 && (
            <text x={470} y={62} fontSize={10} className="gdf-muted">
              none yet
            </text>
          )}
          {f.cands.map((c, k) => (
            <g key={c.id}>
              {k === 0 && <rect x={464} y={49 + k * 20} width={124} height={18} rx={4} fill="var(--good-soft)" />}
              <text x={470} y={62 + k * 20} fontSize={10.5} fontWeight={800}>
                {c.id}
              </text>
              <text x={510} y={62 + k * 20} fontSize={10} fontFamily="var(--f-mono)">
                {c.km.toFixed(1)}
              </text>
              <text x={550} y={62 + k * 20} fontSize={10} fontFamily="var(--f-mono)" fontWeight={params.rank === 'eta' ? 800 : 500}>
                {c.eta}m
              </text>
            </g>
          ))}
          <text x={470} y={150} fontSize={9.5} className="gdf-muted">
            trip
          </text>
          <Pill x={470} y={168} text={f.trip} tone={f.trip === 'DRIVER_ASSIGNED' ? 'good' : f.trip === '—' ? 'muted' : 'accent'} size={9} />
          <text x={470} y={196} fontSize={9.5} className="gdf-muted">
            offered: {f.offered ?? '–'}
          </text>
          <text x={470} y={214} fontSize={9.5} className="gdf-muted">
            assigned: {f.assigned ?? '–'}
          </text>
          <text x={470} y={240} fontSize={9} className="gdf-muted">
            1 block ≈ 0.5 km ≈ 1 min
          </text>
          <text x={470} y={256} fontSize={9} className="gdf-muted">
            ring = cells around pickup
          </text>
          <text x={470} y={272} fontSize={9} className="gdf-muted">
            stale if ping &gt; {STALE_S}s
          </text>
        </Panel>
      </svg>
    </VizFrame>
  );
}
