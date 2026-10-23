import { useMemo, useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { ALGO_NAME, TOP, reqLabel, simulate, summarise, type Algo, type Params, type ReqState, type Scenario } from './sim';
import './elevator.css';

const Y0 = 34; // y of the top floor
const FH = 21; // floor height
const fy = (f: number) => Y0 + (TOP - f) * FH;
const SHAFT_X = 46;
const SHAFT_W = 40;
const CX0 = 196;
const CX1 = 588;
const ALGOS: Algo[] = ['look', 'scan', 'sstf', 'fcfs'];

function reqTone(r: ReqState, tick: number) {
  if (r.at > tick) return 'future';
  if (r.servedAt !== null && r.servedAt < tick) return 'served';
  return 'waiting';
}

export default function ElevatorLookViz() {
  const [params, setParams] = useState<Params>({ algo: 'look', scenario: 'textbook' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const tMax = frames[frames.length - 1].tick;
  const dx = (CX1 - CX0) / Math.max(1, tMax);
  const tx = (t: number) => CX0 + t * dx;
  const scenario = params.scenario;
  const compare = useMemo(() => ALGOS.map((a) => ({ a, ...summarise({ algo: a, scenario }) })), [scenario]);

  const visible = f.reqs.filter((r) => r.at <= f.tick);
  const waiting = visible.filter((r) => reqTone(r, f.tick) === 'waiting');
  const pathPts = f.path.slice(0, f.tick + 1).map((fl, t) => `${tx(t)},${fy(fl)}`).join(' ');
  const ariaLabel = `${ALGO_NAME[params.algo]} at tick ${f.tick}: car at floor ${f.floor}, ${f.doorsOpen ? 'doors open' : f.dir === 'IDLE' ? 'idle' : `moving ${f.dir.toLowerCase()}`}. Waiting calls: ${
    waiting.map(reqLabel).join(', ') || 'none'
  }. ${f.travelled} floors travelled.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Algo>
            label="Policy"
            value={params.algo}
            options={ALGOS.map((a) => ({ value: a, label: a === 'sstf' ? 'SSTF' : ALGO_NAME[a] }))}
            onChange={(algo) => setParams((p) => ({ ...p, algo }))}
          />
          <Choice<Scenario>
            label="Requests"
            value={params.scenario}
            options={[
              { value: 'textbook', label: 'Topic example (5 calls)' },
              { value: 'stream', label: 'Far call + steady trickle' },
            ]}
            onChange={(s) => setParams((p) => ({ ...p, scenario: s }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> car path
          <span className="viz-key" style={{ background: 'var(--good)' }} /> stop (doors open)
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> call waiting
          <span className="viz-key" style={{ background: 'var(--muted)' }} /> call served (line = wait)
        </>
      }
    >
      <svg viewBox="0 0 600 316" className="viz-svg" role="img" aria-label={ariaLabel}>
        <defs>
          <marker id="elv-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
        </defs>
        <text x={SHAFT_X} y={16} className="viz-label">
          shaft
        </text>
        <text x={CX0} y={16} className="viz-label">
          floor over time (ticks) →
        </text>
        {/* floor grid */}
        {Array.from({ length: TOP + 1 }, (_, fl) => (
          <g key={fl}>
            <text x={30} y={fy(fl) + 4} textAnchor="end" className="viz-label" style={{ fontSize: 10.5 }}>
              {fl}
            </text>
            <line x1={SHAFT_X} x2={SHAFT_X + SHAFT_W} y1={fy(fl) + FH / 2} y2={fy(fl) + FH / 2} stroke="var(--border)" strokeWidth={0.6} />
            <line x1={CX0} x2={CX1} y1={fy(fl)} y2={fy(fl)} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="2 4" />
            <text x={CX0 - 6} y={fy(fl) + 3.5} textAnchor="end" className="viz-label" style={{ fontSize: 9.5 }}>
              {fl}
            </text>
          </g>
        ))}
        <rect x={SHAFT_X} y={Y0 - FH / 2} width={SHAFT_W} height={(TOP + 1) * FH} fill="none" stroke="var(--border)" strokeWidth={1.5} rx={3} />

        {/* hall + cab calls next to the shaft */}
        {visible.map((r) => {
          const tone = reqTone(r, f.tick);
          if (tone === 'served') return null;
          const y = fy(r.floor);
          if (r.kind === 'CAB')
            return (
              <circle key={r.id} cx={SHAFT_X + SHAFT_W + 50} cy={y} r={4.5} fill="var(--warn)">
                <title>{`cab call to ${r.floor}`}</title>
              </circle>
            );
          const up = r.kind === 'UP';
          const x = SHAFT_X + SHAFT_W + (up ? 14 : 30);
          return (
            <path
              key={r.id}
              d={up ? `M${x - 6},${y + 4} L${x + 6},${y + 4} L${x},${y - 6} z` : `M${x - 6},${y - 4} L${x + 6},${y - 4} L${x},${y + 6} z`}
              fill="var(--warn)"
            >
              <title>{reqLabel(r)}</title>
            </path>
          );
        })}
        <text x={SHAFT_X + SHAFT_W + 8} y={Y0 + (TOP + 1) * FH + 2} className="viz-label" style={{ fontSize: 9.5 }}>
          ▲ ▼ hall · ● cab
        </text>

        {/* the car */}
        <g style={{ transform: `translateY(${fy(f.floor) - FH / 2 + 1}px)`, transition: 'transform 0.4s ease' }}>
          <rect
            x={SHAFT_X + 3}
            y={0}
            width={SHAFT_W - 6}
            height={FH - 2}
            rx={3}
            fill={f.doorsOpen ? 'var(--good-soft)' : 'var(--accent-soft)'}
            stroke={f.doorsOpen ? 'var(--good)' : 'var(--accent)'}
            strokeWidth={2}
          />
          {f.doorsOpen ? (
            <>
              <line x1={SHAFT_X + 11} x2={SHAFT_X + 11} y1={3} y2={FH - 5} stroke="var(--good)" strokeWidth={2} />
              <line x1={SHAFT_X + SHAFT_W - 11} x2={SHAFT_X + SHAFT_W - 11} y1={3} y2={FH - 5} stroke="var(--good)" strokeWidth={2} />
            </>
          ) : (
            <text x={SHAFT_X + SHAFT_W / 2} y={FH - 6} textAnchor="middle" style={{ fontSize: 11, fontWeight: 800, fill: 'var(--accent)' }}>
              {f.dir === 'UP' ? '▲' : f.dir === 'DOWN' ? '▼' : '•'}
            </text>
          )}
        </g>

        {/* request markers and wait lines on the chart */}
        {f.reqs.map((r) => {
          if (r.at > f.tick) return null;
          const tone = reqTone(r, f.tick);
          const end = tone === 'served' ? (r.servedAt as number) : f.tick;
          const y = fy(r.floor);
          return (
            <g key={r.id}>
              <line
                x1={tx(r.at)}
                x2={tx(Math.max(r.at, end))}
                y1={y}
                y2={y}
                stroke={tone === 'served' ? 'var(--muted)' : 'var(--warn)'}
                strokeWidth={tone === 'served' ? 1.5 : 3}
                opacity={tone === 'served' ? 0.6 : 0.85}
              />
              <rect x={tx(r.at) - 3} y={y - 3} width={6} height={6} fill={tone === 'served' ? 'var(--muted)' : 'var(--warn)'} />
            </g>
          );
        })}
        {/* path + stops */}
        <polyline points={pathPts} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinejoin="round" />
        {f.stops.map((s, k) => (
          <g key={k}>
            <circle cx={tx(s.t + 0.5)} cy={fy(s.floor)} r={5} fill="var(--good)" stroke="var(--surface)" strokeWidth={1.5} />
            <text x={tx(s.t + 0.5)} y={fy(s.floor) - 8} textAnchor="middle" style={{ fontSize: 9.5, fontWeight: 700, fill: 'var(--good)' }}>
              {k + 1}
            </text>
          </g>
        ))}
        <line x1={tx(f.tick)} x2={tx(f.tick)} y1={Y0 - 8} y2={fy(0) + 8} stroke="var(--accent)" strokeDasharray="3 3" opacity={0.5} />

        <text x={10} y={306} className="viz-label">
          t = {f.tick} · floors travelled {f.travelled} · served {f.reqs.filter((r) => r.servedAt !== null && r.servedAt < f.tick).length}/
          {f.reqs.length}
          {waiting.length
            ? ` · waiting: ${waiting.slice(0, 3).map((r) => `${reqLabel(r)} for ${f.tick - r.at}`).join(', ')}${waiting.length > 3 ? '…' : ''}`
            : ''}
        </text>
      </svg>
      <div className="elv-compare" role="table" aria-label="Same requests, every policy">
        <div className="elv-row elv-head" role="row">
          <span role="columnheader">Policy</span>
          <span role="columnheader">Stop order</span>
          <span role="columnheader">Floors</span>
          <span role="columnheader">Worst wait</span>
        </div>
        {compare.map((c) => {
          const best = Math.min(...compare.map((x) => x.travelled));
          const worst = Math.max(...compare.map((x) => x.maxWait));
          return (
            <div key={c.a} className={`elv-row ${c.a === params.algo ? 'on' : ''}`} role="row">
              <span role="cell">{c.a === 'sstf' ? 'SSTF' : ALGO_NAME[c.a]}</span>
              <span role="cell" className="elv-order">
                {c.order.join(' → ')}
              </span>
              <span role="cell" className={c.travelled === best ? 'elv-good' : ''}>
                {c.travelled}
              </span>
              <span role="cell" className={c.maxWait === worst ? 'elv-bad' : ''}>
                {c.maxWait} ticks
              </span>
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}
