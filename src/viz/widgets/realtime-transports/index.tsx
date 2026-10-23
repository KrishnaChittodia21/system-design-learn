import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { CLIENTS, DEFAULT_PARAMS, DURATION, LANES, LANE_NAME, fmtRps, simulate, type Lane, type Msg, type Params, type Traffic } from './sim';
import './realtime-transports.css';

const TX0 = 52;
const TX1 = 592;
const TOP = 22;
const LANE_H = 78;
const x = (t: number) => TX0 + (Math.min(t, DURATION) / DURATION) * (TX1 - TX0);

const COLOR: Record<Msg['kind'], string> = {
  poll: 'var(--ink-3)',
  post: 'var(--ink-3)',
  ack: 'var(--ink-4)',
  data: 'var(--good)',
  push: 'var(--good)',
  empty: 'var(--bad)',
  open: 'var(--accent)',
  frame: 'var(--accent)',
  beat: 'var(--ink-4)',
};

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

export default function RealtimeTransportsViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const { sim, now } = f;
  const H = TOP + LANES.length * LANE_H + 6;
  const best = Math.min(...LANES.map((l) => f.stats[l].requests));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Traffic>
            label="Server events"
            value={params.traffic}
            options={[
              { value: 'bursty', label: 'Bursty' },
              { value: 'chatty', label: 'Chatty' },
              { value: 'quiet', label: 'Quiet' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, traffic: v }))}
          />
          <Slider label="Short-poll interval" value={params.interval} min={1} max={15} onChange={(v) => setParams((p) => ({ ...p, interval: v }))} format={(v) => `${v} s`} />
          <Slider label="Round-trip time" value={params.rttMs} min={50} max={400} step={50} onChange={(v) => setParams((p) => ({ ...p, rttMs: v }))} format={(v) => `${v} ms`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> event on server
          <span className="viz-key" style={{ background: 'var(--good)' }} /> response with data / push
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> empty response
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> open connection / WS frame
        </>
      }
    >
      <svg viewBox={`0 0 600 ${H}`} className="viz-svg" role="img" aria-label={`At t=${now} s: ${LANES.map((l) => `${LANE_NAME[l]} ${f.stats[l].requests} requests, ${f.stats[l].empty} empty`).join('; ')}.`}>
        {[0, 10, 20, 30, 40, 50, 60].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP - 4} y2={H - 4} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={x(t)} y={12} textAnchor={t === DURATION ? 'end' : 'middle'} className="viz-label" style={{ fontSize: 10.5 }}>
              {t}s
            </text>
          </g>
        ))}
        {LANES.map((lane: Lane, k) => {
          const y0 = TOP + k * LANE_H;
          const yc = y0 + 26;
          const ys = y0 + 64;
          const tl = sim.lanes[lane];
          return (
            <g key={lane}>
              <text x={TX0} y={y0 + 13} style={{ fontSize: 12, fontWeight: 700 }}>
                {LANE_NAME[lane]}
              </text>
              <text x={TX0 - 6} y={yc + 4} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
                client
              </text>
              <text x={TX0 - 6} y={ys + 4} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
                server
              </text>
              <line x1={TX0} x2={TX1} y1={yc} y2={yc} stroke="var(--line-2)" />
              <line x1={TX0} x2={TX1} y1={ys} y2={ys} stroke="var(--line-2)" />
              {tl.holds
                .filter(([a]) => a <= now)
                .map(([a, b], i) => (
                  <rect
                    key={i}
                    x={x(a)}
                    y={lane === 'long' ? ys - 5 : yc + 4}
                    width={Math.max(1.5, x(Math.min(b, now)) - x(a))}
                    height={lane === 'long' ? 10 : ys - yc - 8}
                    rx={3}
                    fill={lane === 'long' ? 'var(--warn-soft)' : 'var(--accent-soft)'}
                    stroke={lane === 'long' ? 'var(--warn)' : 'none'}
                    strokeWidth={0.8}
                  />
                ))}
              {tl.msgs
                .filter((m) => m.from <= now)
                .map((m, i) => {
                  const ya = m.dir === 'up' ? yc : ys;
                  const yb = m.dir === 'up' ? ys : yc;
                  const xm = x(m.from);
                  return (
                    <g key={i}>
                      <line x1={xm} y1={ya} x2={x(m.to)} y2={yb} stroke={COLOR[m.kind]} strokeWidth={m.kind === 'beat' ? 1 : 1.8} strokeDasharray={m.kind === 'beat' ? '2 2' : undefined} />
                      {m.kind === 'empty' && <circle cx={x(m.to)} cy={yb - 4} r={2.6} fill="var(--bad)" />}
                      {(m.kind === 'data' || m.kind === 'push') && <circle cx={x(m.to)} cy={yb - 4} r={2.6} fill="var(--good)" />}
                      {m.kind === 'frame' && <circle cx={x(m.to)} cy={yb + 4} r={2.6} fill="var(--accent)" />}
                      {m.kind === 'post' && <rect x={xm - 2.5} y={ya + 2} width={5} height={5} fill="var(--ink-3)" />}
                    </g>
                  );
                })}
              {sim.events
                .filter((e) => e <= now)
                .map((e, i) => (
                  <path key={i} d={`M${x(e)},${ys + 3} l4,5 l-4,5 l-4,-5 z`} fill="var(--warn)" />
                ))}
            </g>
          );
        })}
        <line x1={x(now)} x2={x(now)} y1={TOP - 6} y2={H - 2} stroke="var(--text)" strokeWidth={1.4} strokeDasharray="5 3" />
      </svg>
      <div className="rt-tablewrap">
        <table className="rt-table">
          <caption>After {now} s · last column extrapolates to {CLIENTS / 1e6}M clients</caption>
          <thead>
            <tr>
              <th scope="col">Transport</th>
              <th scope="col">HTTP requests</th>
              <th scope="col">Empty</th>
              <th scope="col">Avg delay</th>
              <th scope="col">Fleet req/s</th>
            </tr>
          </thead>
          <tbody>
            {LANES.map((l) => {
              const s = f.stats[l];
              return (
                <tr key={l}>
                  <th scope="row">{LANE_NAME[l]}</th>
                  <td className={s.requests === best ? 'is-good' : ''}>{s.requests}</td>
                  <td className={s.empty ? 'is-bad' : ''}>{s.empty}</td>
                  <td className={s.avgLatencyMs > 1000 ? 'is-bad' : s.delivered ? 'is-good' : ''}>{s.delivered ? ms(s.avgLatencyMs) : '–'}</td>
                  <td>{fmtRps(s.fleetRps)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </VizFrame>
  );
}
