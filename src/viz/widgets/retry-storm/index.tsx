import { useMemo, useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { CAPACITY, INCIDENT_END, INCIDENT_START, TICKS, USERS, capacityAt, simulate, type Params, type Strategy } from './sim';

const LAYER_NAMES = [['client'], ['client', 'svc A'], ['client', 'gateway', 'svc A'], ['client', 'gateway', 'BFF', 'svc A']];

const CH_X = 44;
const CH_W = 548;
const CH_TOP = 128;
const CH_BOT = 292;

const fmt = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}k` : String(Math.round(x)));

export default function RetryStormViz() {
  const [params, setParams] = useState<Params>({ strategy: 'naive', retries: 2, layers: 3 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const { retries: R, layers: L } = params;

  // y scale fixed for the whole run so bars do not jump
  const yMax = useMemo(() => {
    const last = frames[frames.length - 1];
    return Math.max(CAPACITY * 1.3, ...last.load) * 1.08;
  }, [frames]);
  const y = (v: number) => CH_BOT - (v / yMax) * (CH_BOT - CH_TOP);
  const bw = CH_W / TICKS;

  // chain boxes: users, layers (top → bottom), B
  const names = ['users', ...LAYER_NAMES[L - 1], 'svc B'];
  const nBox = names.length;
  const slot = 600 / nBox;
  const boxW = Math.min(84, slot - 22);
  const boxX = (i: number) => i * slot + (slot - boxW) / 2;
  const inbound = (i: number) => (i === 0 ? USERS : f.hops[i - 1]);

  const worst = (R + 1) ** L;
  const tickIdx = f.tick;
  const nowLoad = tickIdx >= 0 ? f.load[tickIdx] : 0;
  const nowGood = tickIdx >= 0 ? f.goodput[tickIdx] : 0;
  const cap = tickIdx >= 0 ? capacityAt(tickIdx) : CAPACITY;
  const bDown = tickIdx >= 0 && (nowLoad > cap || cap < CAPACITY);

  const capPath = Array.from({ length: TICKS }, (_, t) => {
    const c = capacityAt(t);
    return `${t === 0 ? 'M' : 'L'}${CH_X + t * bw},${y(c)} L${CH_X + (t + 1) * bw},${y(c)}`;
  }).join(' ');

  const aria =
    tickIdx < 0
      ? `Call chain ${names.join(' to ')}; worst case ${worst} calls at B per user request.`
      : `Tick ${tickIdx}: ${Math.round(nowLoad)} calls reach B, ${(nowLoad / USERS).toFixed(1)} times user traffic; B completes ${Math.round(nowGood)} with capacity ${cap}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Strategy>
            label="Retry policy"
            value={params.strategy}
            options={[
              { value: 'naive', label: 'Immediate, every layer' },
              { value: 'backoff', label: 'Backoff + full jitter' },
              { value: 'budget', label: '+ retry budget' },
            ]}
            onChange={(strategy) => setParams((p) => ({ ...p, strategy }))}
          />
          <Slider label="Retries per layer" value={R} min={0} max={4} onChange={(retries) => setParams((p) => ({ ...p, retries }))} />
          <Slider label="Retrying layers" value={L} min={1} max={4} onChange={(layers) => setParams((p) => ({ ...p, layers }))} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> calls arriving at B
          <span className="viz-key" style={{ background: 'var(--good)' }} /> completed (goodput)
          <span className="viz-key" style={{ background: 'transparent', border: '2px dashed var(--text-2)' }} /> B capacity
          <span className="viz-key" style={{ background: 'var(--bad-soft)' }} /> incident (B degraded)
        </>
      }
    >
      <svg viewBox="0 0 600 316" className="viz-svg" role="img" aria-label={aria}>
        <defs>
          <marker id="rs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>

        {/* call chain */}
        {names.map((nm, i) => {
          const isB = i === nBox - 1;
          const val = inbound(i);
          const hot = tickIdx >= 0 && val > USERS * 1.05;
          return (
            <g key={nm}>
              <rect
                x={boxX(i)}
                y={26}
                width={boxW}
                height={46}
                rx={8}
                fill={isB ? (bDown ? 'var(--bad-soft)' : 'var(--good-soft)') : hot ? 'var(--warn-soft)' : 'var(--surface-2)'}
                stroke={isB ? (bDown ? 'var(--bad)' : 'var(--good)') : hot ? 'var(--warn)' : 'var(--border)'}
                strokeWidth={isB ? 2.5 : 1.5}
                style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
              />
              <text x={boxX(i) + boxW / 2} y={45} textAnchor="middle" fontSize={12} fontWeight={700}>
                {nm}
              </text>
              <text x={boxX(i) + boxW / 2} y={62} textAnchor="middle" fontSize={10} style={{ fill: hot ? 'var(--warn)' : 'var(--text-2)' }}>
                {tickIdx < 0 ? (i === 0 ? `${USERS}/tick` : '') : i === 0 ? `${USERS}/tick` : `in ${fmt(val)}/tick`}
              </text>
              {i < nBox - 1 && (
                <>
                  <line x1={boxX(i) + boxW + 2} y1={49} x2={boxX(i + 1) - 3} y2={49} stroke="var(--muted)" strokeWidth={1.5} markerEnd="url(#rs-arrow)" />
                  {i > 0 && R > 0 && (
                    <text x={(boxX(i) + boxW + boxX(i + 1)) / 2} y={20} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: 'var(--warn)' }}>
                      ≤×{R + 1}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
        <text x={300} y={92} textAnchor="middle" fontSize={11.5} fontWeight={600}>
          worst case per user request: {R === 0 ? '1 call' : `(1+${R})^${L} = ${worst} calls`} at B
          {tickIdx >= 0 && ` · now ${(nowLoad / USERS).toFixed(1)}× user traffic`}
        </text>

        {/* chart */}
        <rect
          x={CH_X + INCIDENT_START * bw}
          y={CH_TOP - 8}
          width={(INCIDENT_END - INCIDENT_START) * bw}
          height={CH_BOT - CH_TOP + 8}
          className="viz-outage"
        />
        <text x={CH_X + ((INCIDENT_START + INCIDENT_END) / 2) * bw} y={CH_TOP + 4} textAnchor="middle" fontSize={9} style={{ fill: 'var(--bad)' }}>
          incident
        </text>
        <line x1={CH_X} y1={CH_BOT} x2={CH_X + CH_W} y2={CH_BOT} stroke="var(--border)" />
        <line x1={CH_X} y1={CH_TOP - 8} x2={CH_X} y2={CH_BOT} stroke="var(--border)" />
        {[0, CAPACITY, yMax / 1.08].map((v, k) => (
          <text key={k} x={CH_X - 4} y={y(v) + 4} textAnchor="end" fontSize={9} style={{ fill: 'var(--text-2)' }}>
            {fmt(v)}
          </text>
        ))}
        <text x={4} y={CH_TOP - 14} className="viz-label">
          calls/tick at B
        </text>
        {f.load.map((n, t) => {
          const g = f.goodput[t];
          const cur = t === tickIdx;
          return (
            <g key={t}>
              <rect
                x={CH_X + t * bw + 1}
                y={y(n)}
                width={bw - 2}
                height={CH_BOT - y(n)}
                fill="var(--accent)"
                opacity={cur ? 0.95 : 0.55}
                style={{ transition: 'y 0.3s ease, height 0.3s ease' }}
              />
              <rect x={CH_X + t * bw + 3} y={y(g)} width={bw - 6} height={CH_BOT - y(g)} fill="var(--good)" />
            </g>
          );
        })}
        <path d={capPath} fill="none" stroke="var(--text-2)" strokeWidth={1.6} strokeDasharray="5 3" />
        {tickIdx >= 0 && (
          <text
            x={Math.min(CH_X + CH_W - 4, Math.max(CH_X + 30, CH_X + (tickIdx + 0.5) * bw))}
            y={Math.max(CH_TOP + 16, y(nowLoad) - 6)}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            style={{ fill: 'var(--accent)', stroke: 'var(--surface)', strokeWidth: 4, paintOrder: 'stroke' }}
          >
            {fmt(nowLoad)}
          </text>
        )}
        <text x={CH_X + CH_W} y={CH_BOT + 16} textAnchor="end" className="viz-label">
          time (ticks) →
        </text>
      </svg>
    </VizFrame>
  );
}
