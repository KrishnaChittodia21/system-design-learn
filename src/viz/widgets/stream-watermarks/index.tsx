import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { ALLOWED_LATENESS, E_MAX, N_WINDOWS, P_MAX, simulate, type Fate, type Frame, type LatePolicy, type Params } from './sim';

const X0 = 52;
const X1 = 590;
const Y0 = 252; // event time 0
const Y1 = 16; // event time E_MAX
const px = (p: number) => X0 + (p / P_MAX) * (X1 - X0);
const py = (e: number) => Y0 - (e / E_MAX) * (Y0 - Y1);
const FATE: Record<Fate, string> = { ontime: 'var(--accent)', update: 'var(--warn)', dropped: 'var(--bad)', side: 'var(--mag)' };
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' as const };

function Drawing({ f, delay }: { f: Frame; delay: number }) {
  // watermark staircase (only the part ≥ 0 is drawable)
  let wmPath = '';
  f.wm.forEach(([p, w], i) => {
    const next = f.wm[i + 1]?.[0] ?? (f.cur === f.wm.length - 1 && f.cur >= 0 ? p + 1.5 : p);
    const y = py(Math.max(0, w));
    wmPath += `${i === 0 ? 'M' : 'L'}${px(p)},${y} L${px(next)},${y} `;
  });
  const cur = f.cur >= 0 ? f.seen[f.cur] : null;
  const wmNow = f.wm.length ? f.wm[f.wm.length - 1][1] : null;
  const boxW = (600 - 4 - (N_WINDOWS - 1) * 6) / N_WINDOWS;
  const aria =
    cur === null
      ? `Empty plot of event time against processing time with ${N_WINDOWS} ten-second windows.`
      : `Processing time ${cur.ev.p} s. Event time ${cur.ev.e} s, ${cur.fate}. Watermark ${wmNow} s. ` +
        f.windows.map((w) => `Window ${w.start} to ${w.end}: ${w.firedAt === null ? 'waiting' : `emitted ${w.count} of ${w.truth}`}`).join('; ');
  return (
    <svg viewBox="0 0 600 352" className="viz-svg" role="img" aria-label={aria}>
      {/* event-time windows as horizontal bands */}
      {f.windows.map((w, k) => (
        <g key={w.start}>
          <rect x={X0} y={py(w.end)} width={X1 - X0} height={py(w.start) - py(w.end)} fill={k % 2 ? 'var(--tint)' : 'transparent'} />
          <text x={X0 - 4} y={(py(w.start) + py(w.end)) / 2 + 3.5} textAnchor="end" fontSize={9.5} style={{ fill: 'var(--text-2)' }}>
            [{w.start},{w.end})
          </text>
          {w.firedAt !== null && (
            <g>
              <line x1={px(w.firedAt)} x2={px(w.firedAt)} y1={py(w.end)} y2={py(w.start)} stroke="var(--good)" strokeWidth={2} />
              <text x={px(w.firedAt) + 4} y={py(w.end) + 11} fontSize={9.5} fontWeight={700} style={{ fill: 'var(--good)', ...halo }}>
                fire {w.firstCount}
              </text>
            </g>
          )}
        </g>
      ))}
      <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke="var(--border-strong)" />
      <line x1={X0} y1={Y1} x2={X0} y2={Y0} stroke="var(--border-strong)" />
      <text x={X1} y={Y0 + 27} textAnchor="end" style={{ fill: 'var(--text-2)' }} fontSize={10}>
        processing time (when it arrives) →
      </text>
      {[0, 10, 20, 30, 40, 50, 60].map((p) => (
        <text key={p} x={px(p)} y={Y0 + 14} textAnchor="middle" fontSize={9} style={{ fill: 'var(--text-2)' }}>
          {p === 60 ? '' : p}
        </text>
      ))}
      <text x={4} y={10} style={{ fill: 'var(--text-2)' }} fontSize={10}>
        event time ↑
      </text>
      {/* ideal: arrives the instant it happens */}
      <line x1={px(0)} y1={py(0)} x2={px(P_MAX)} y2={py(P_MAX)} stroke="var(--control)" strokeDasharray="3 4" />
      <text x={px(48)} y={py(52) - 2} fontSize={9} style={{ fill: 'var(--text-2)' }} transform={`rotate(-23 ${px(48)} ${py(52)})`}>
        no delay
      </text>
      {/* watermark */}
      {wmPath && <path d={wmPath} fill="none" stroke="var(--warn)" strokeWidth={2.4} />}
      {wmNow !== null && f.wm.length > 0 && (
        <text
          x={Math.min(X1 - 2, px(f.wm[f.wm.length - 1][0]) + 4)}
          y={py(Math.max(0, wmNow)) + 13}
          textAnchor={px(f.wm[f.wm.length - 1][0]) > 470 ? 'end' : 'start'}
          fontSize={10}
          fontWeight={700}
          style={{ fill: 'var(--warn)', ...halo }}
        >
          watermark {wmNow}s = max {f.maxE} − {delay}
        </text>
      )}
      {/* events */}
      {f.seen.map(({ ev, fate }, i) => {
        const x = px(ev.p);
        const y = py(ev.e);
        const now = i === f.cur;
        return (
          <g key={ev.id}>
            {fate === 'dropped' ? (
              <path d={`M${x - 5},${y - 5} L${x + 5},${y + 5} M${x - 5},${y + 5} L${x + 5},${y - 5}`} stroke={FATE.dropped} strokeWidth={2.4} />
            ) : (
              <circle cx={x} cy={y} r={now ? 6 : 4.5} fill={FATE[fate]} className="viz-dot" />
            )}
            {now && <circle cx={x} cy={y} r={10} fill="none" stroke="var(--text)" strokeWidth={1.5} />}
          </g>
        );
      })}
      {/* per-window results */}
      {f.windows.map((w, k) => {
        const x = 2 + k * (boxW + 6);
        const exact = w.firedAt !== null && w.count === w.truth;
        const tone = w.firedAt === null ? 'idle' : exact ? 'good' : 'bad';
        const stroke = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--border)';
        const fill = tone === 'good' ? 'var(--good-soft)' : tone === 'bad' ? 'var(--bad-soft)' : 'var(--surface)';
        return (
          <g key={w.start}>
            <rect x={x} y={288} width={boxW} height={60} rx={8} fill={fill} stroke={stroke} strokeWidth={1.4} style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }} />
            <text x={x + boxW / 2} y={303} textAnchor="middle" fontSize={10.5} fontWeight={700}>
              [{w.start},{w.end})
            </text>
            <text x={x + boxW / 2} y={319} textAnchor="middle" fontSize={10}>
              {w.firedAt === null ? 'waiting' : `${w.count}${w.updates ? '*' : ''} of ${w.truth}`}
            </text>
            <text x={x + boxW / 2} y={335} textAnchor="middle" fontSize={9} style={{ fill: 'var(--text-2)' }}>
              {w.firedAt === null ? `${w.count} so far` : `+${w.firedAt - w.end}s${w.dropped ? ` · ${w.dropped} lost` : w.side ? ` · ${w.side} side` : ''}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function StreamWatermarksViz() {
  const [params, setParams] = useState<Params>({ delay: 4, late: 'drop' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Watermark delay (out-of-orderness)" value={params.delay} min={0} max={16} step={2} format={(v) => `${v} s`} onChange={(delay) => setParams((p) => ({ ...p, delay }))} />
          <Choice<LatePolicy>
            label="Late events"
            value={params.late}
            options={[
              { value: 'drop', label: 'Drop + count' },
              { value: 'allowed', label: `Allowed lateness ${ALLOWED_LATENESS}s` },
              { value: 'side', label: 'Side output' },
            ]}
            onChange={(late) => setParams((p) => ({ ...p, late }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> counted on time
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> late → updated result (*)
          <span className="viz-key" style={{ background: 'var(--mag)' }} /> late → side output
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> late → dropped
          <span className="viz-key" style={{ background: 'var(--good)', borderRadius: 2 }} /> window fires · result box: emitted of true, +seconds after window end
        </>
      }
    >
      <Drawing f={stepper.frame} delay={params.delay} />
    </VizFrame>
  );
}
