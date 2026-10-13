import { useState } from 'react';
import { Slider, VizFrame, useFrames, useSimulation, type BaseFrame } from '../../core';
import { meta } from './meta';

type State = 'closed' | 'open' | 'half-open';
type Outcome = 'ok' | 'fail' | 'fast-fail' | 'probe-ok' | 'probe-fail';

interface Params {
  threshold: number;
  openTicks: number;
  outageStart: number;
  outageLength: number;
}

interface Frame extends BaseFrame {
  tick: number;
  state: State;
  failures: number;
  history: Outcome[];
  downstreamUp: boolean;
}

const TICKS = 28;

function simulate({ threshold, openTicks, outageStart, outageLength }: Params): Frame[] {
  const frames: Frame[] = [];
  let state: State = 'closed';
  let failures = 0;
  let openedAt = -1;
  const history: Outcome[] = [];
  frames.push({
    tick: -1,
    state,
    failures,
    history: [],
    downstreamUp: true,
    caption: `Breaker starts CLOSED: every request goes to the downstream. It opens after ${threshold} consecutive failures.`,
  });
  for (let t = 0; t < TICKS; t++) {
    const up = t < outageStart || t >= outageStart + outageLength;
    let outcome: Outcome;
    let caption: string;
    if (state === 'open' && t - openedAt >= openTicks) state = 'half-open';
    if (state === 'closed') {
      if (up) {
        outcome = 'ok';
        failures = 0;
        caption = `t=${t}: request succeeds. Failure count stays at 0.`;
      } else {
        outcome = 'fail';
        failures++;
        if (failures >= threshold) {
          state = 'open';
          openedAt = t;
          caption = `t=${t}: failure #${failures} hits the threshold, so the breaker OPENS. Callers now fail fast instead of waiting on a dead dependency.`;
        } else {
          caption = `t=${t}: request fails after a timeout (${failures}/${threshold} consecutive failures).`;
        }
      }
    } else if (state === 'open') {
      outcome = 'fast-fail';
      caption = `t=${t}: breaker OPEN, so the request is rejected immediately (no thread or connection tied up). ${openTicks - (t - openedAt)} tick(s) until a probe is allowed.`;
    } else {
      // half-open: a single probe decides
      if (up) {
        outcome = 'probe-ok';
        state = 'closed';
        failures = 0;
        caption = `t=${t}: HALF-OPEN probe succeeds, so the breaker CLOSES and normal traffic resumes.`;
      } else {
        outcome = 'probe-fail';
        state = 'open';
        openedAt = t;
        caption = `t=${t}: HALF-OPEN probe fails, so the breaker re-OPENS and the timeout restarts. Only one request paid the price.`;
      }
    }
    history.push(outcome);
    const nextUp = t + 1 < outageStart || t + 1 >= outageStart + outageLength;
    let predict: string | undefined;
    if (state === 'closed' && failures === threshold - 1 && !nextUp) predict = 'The next request will also fail. What does the breaker do?';
    if (state === 'open' && t + 1 - openedAt >= openTicks) predict = 'The open timeout expires next tick. What does the breaker let through?';
    frames.push({ tick: t, state, failures, history: [...history], downstreamUp: up, caption, predict });
  }
  return frames;
}

const COLORS: Record<Outcome, string> = {
  ok: 'var(--good)',
  fail: 'var(--bad)',
  'fast-fail': 'var(--muted)',
  'probe-ok': 'var(--good)',
  'probe-fail': 'var(--bad)',
};

export default function CircuitBreakerViz() {
  const [params, setParams] = useState<Params>({ threshold: 3, openTicks: 4, outageStart: 4, outageLength: 9 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = (k: keyof Params) => (v: number) => setParams((p) => ({ ...p, [k]: v }));

  const nodes: { id: State; x: number; label: string }[] = [
    { id: 'closed', x: 90, label: 'CLOSED' },
    { id: 'open', x: 300, label: 'OPEN' },
    { id: 'half-open', x: 510, label: 'HALF-OPEN' },
  ];
  const cell = 600 / TICKS;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Failure threshold" value={params.threshold} min={1} max={6} onChange={set('threshold')} />
          <Slider label="Open timeout" value={params.openTicks} min={1} max={8} onChange={set('openTicks')} format={(v) => `${v} ticks`} />
          <Slider label="Outage length" value={params.outageLength} min={2} max={18} onChange={set('outageLength')} format={(v) => `${v} ticks`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> success
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> failure (slow)
          <span className="viz-key" style={{ background: 'var(--muted)' }} /> fast-fail (breaker open)
          <span className="viz-key ring" /> half-open probe
        </>
      }
    >
      <svg viewBox="0 0 600 250" className="viz-svg" role="img" aria-label={`Breaker is ${f.state}`}>
        <defs>
          <marker id="cb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {/* transitions */}
        <path d="M140,70 Q195,30 250,70" className="viz-edge" markerEnd="url(#cb-arrow)" />
        <text x="195" y="34" className="viz-label" textAnchor="middle">threshold failures</text>
        <path d="M350,70 Q405,30 460,70" className="viz-edge" markerEnd="url(#cb-arrow)" />
        <text x="405" y="34" className="viz-label" textAnchor="middle">timeout expires</text>
        <path d="M460,110 Q405,150 350,110" className="viz-edge" markerEnd="url(#cb-arrow)" />
        <text x="405" y="124" className="viz-label" textAnchor="middle">probe fails</text>
        <path d="M480,118 Q300,205 120,118" className="viz-edge" markerEnd="url(#cb-arrow)" />
        <text x="300" y="186" className="viz-label" textAnchor="middle">probe succeeds</text>
        {nodes.map((n) => (
          <g key={n.id} className={`viz-node ${f.state === n.id ? 'active' : ''} cb-${n.id}`}>
            <circle cx={n.x} cy={90} r={46} />
            <text x={n.x} y={95} textAnchor="middle" className="viz-node-label">
              {n.label}
            </text>
          </g>
        ))}
        {/* downstream health */}
        <text x="8" y="214" className="viz-label">
          downstream: {f.downstreamUp ? '🟢 up' : '🔴 down'} · consecutive failures: {f.failures}
        </text>
        {/* request timeline */}
        {Array.from({ length: TICKS }, (_, t) => {
          const o = f.history[t];
          const outage = t >= params.outageStart && t < params.outageStart + params.outageLength;
          return (
            <g key={t}>
              {outage && <rect x={t * cell} y={222} width={cell} height={26} className="viz-outage" />}
              <circle
                cx={t * cell + cell / 2}
                cy={235}
                r={o ? 7 : 3}
                fill={o ? COLORS[o] : 'var(--border)'}
                stroke={o === 'probe-ok' || o === 'probe-fail' ? 'var(--text)' : 'none'}
                strokeWidth={2}
                className="viz-dot"
              />
            </g>
          );
        })}
      </svg>
    </VizFrame>
  );
}
