import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { AXIS_END, DEFAULT_PARAMS, WINDOW, WINDOWS, simulate, type ClickStatus, type LatePolicy, type Params, type TimeMode } from './sim';

const AX0 = 30;
const AX1 = 590;
const ex = (t: number) => AX0 + (Math.max(0, Math.min(AXIS_END, t)) / AXIS_END) * (AX1 - AX0);
const BAND_TOP = 34;
const BAND_BOT = 168;

const STATUS: Record<ClickStatus, { fill: string; stroke: string; label: string }> = {
  counted: { fill: 'var(--accent)', stroke: 'var(--accent)', label: 'counted' },
  'late-dropped': { fill: 'var(--bad-soft)', stroke: 'var(--bad)', label: 'late, dropped' },
  'late-corrected': { fill: 'var(--warn)', stroke: 'var(--warn)', label: 'late, corrected' },
  duplicate: { fill: 'var(--surface)', stroke: 'var(--muted)', label: 'duplicate' },
  misbucketed: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', label: 'wrong window' },
  spilled: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', label: 'counted later' },
};

export default function AdClickWatermarkViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const ev = params.mode === 'event';

  // stack dots per true window (by event time)
  const stackCount: number[] = Array(WINDOWS).fill(0);

  const aria = `Processing time ${f.now}s. ${f.windows
    .map((w, k) => `Window ${k}: ${w.emitted === null ? `open with ${w.running}` : `emitted ${w.emitted}`}, true ${w.truth}`)
    .join('. ')}.${f.watermark !== null ? ` Watermark ${f.watermark}s.` : ''}`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<TimeMode>
            label="Bucket clicks by"
            value={params.mode}
            options={[
              { value: 'event', label: 'Event time' },
              { value: 'processing', label: 'Processing time' },
            ]}
            onChange={(mode) => setParams((p) => ({ ...p, mode }))}
          />
          {ev && (
            <>
              <Slider label="Allowed lateness" value={params.lateness} min={0} max={10} onChange={(lateness) => setParams((p) => ({ ...p, lateness }))} format={(v) => `${v}s`} />
              <Choice<LatePolicy>
                label="Late click"
                value={params.policy}
                options={[
                  { value: 'drop', label: 'Drop it' },
                  { value: 'update', label: 'Upsert a correction' },
                ]}
                onChange={(policy) => setParams((p) => ({ ...p, policy }))}
              />
            </>
          )}
        </>
      }
      legend={
        <>
          {(ev ? (['counted', 'late-dropped', 'late-corrected', 'duplicate'] as ClickStatus[]) : (['counted', 'misbucketed', 'duplicate'] as ClickStatus[])).map((s) => (
            <span key={s}>
              <span className="viz-key" style={{ marginRight: 4, background: STATUS[s].fill, border: `1.5px solid ${STATUS[s].stroke}` }} /> {STATUS[s].label}
            </span>
          ))}
          <span>dots sit at their event time · ring = just arrived</span>
        </>
      }
    >
      <svg viewBox="0 0 600 318" className="viz-svg" role="img" aria-label={aria}>
        <text x={AX0} y={14} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          event time →
        </text>
        <text x={AX1} y={14} textAnchor="end" fontSize={11} fontWeight={700}>
          processing clock: t = {f.now}s
        </text>

        {/* windows */}
        {f.windows.map((w, k) => {
          const x0 = ex(k * WINDOW);
          const x1 = ex((k + 1) * WINDOW);
          const fired = w.emitted !== null;
          const justFired = f.fired.includes(k);
          const ok = fired && w.emitted === w.truth;
          return (
            <g key={k}>
              <rect
                x={x0 + 2}
                y={BAND_TOP}
                width={x1 - x0 - 4}
                height={BAND_BOT - BAND_TOP}
                rx={6}
                fill={fired ? (ok ? 'var(--good-soft)' : 'var(--bad-soft)') : 'var(--surface)'}
                stroke={justFired ? 'var(--accent)' : fired ? (ok ? 'var(--good)' : 'var(--bad)') : 'var(--border)'}
                strokeWidth={justFired ? 2.5 : 1.2}
                style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
              />
              <text x={x0 + 10} y={BAND_TOP + 15} fontSize={11} fontWeight={700}>
                W{k} [{k * WINDOW}, {(k + 1) * WINDOW})
              </text>
              <text x={x1 - 10} y={BAND_TOP + 15} textAnchor="end" fontSize={10.5} style={{ fill: fired ? (ok ? 'var(--good)' : 'var(--bad)') : 'var(--muted)' }} fontWeight={fired ? 700 : 400}>
                {fired ? `fired @${w.firedAt}s` : `open · ${w.running}`}
              </text>
            </g>
          );
        })}

        {/* axis */}
        <line x1={AX0} y1={BAND_BOT + 4} x2={AX1} y2={BAND_BOT + 4} stroke="var(--border)" />
        {Array.from({ length: AXIS_END / 5 + 1 }, (_, i) => i * 5).map((t) => (
          <text key={t} x={ex(t)} y={BAND_BOT + 16} textAnchor="middle" fontSize={9} style={{ fill: 'var(--muted)' }}>
            {t}s
          </text>
        ))}

        {/* clicks */}
        {f.clicks.map((c, i) => {
          const tw = Math.min(WINDOWS - 1, Math.floor(c.e / WINDOW));
          const k = stackCount[tw]++;
          const x = ex(c.e);
          const y = BAND_BOT - 14 - k * 16;
          const st = STATUS[c.status];
          const cur = i === f.current;
          return (
            <g key={`${c.id}-${i}`}>
              <circle cx={x} cy={y} r={cur ? 8 : 6} fill={st.fill} stroke={cur ? 'var(--text)' : st.stroke} strokeWidth={cur ? 2.2 : 1.5} strokeDasharray={c.status === 'duplicate' ? '2 2' : undefined} />
              <text x={x + 10} y={y + 3.5} fontSize={9} style={{ fill: 'var(--text-2)' }}>
                {c.id}
                {c.status === 'misbucketed' || c.status === 'spilled' ? ` →W${c.win}` : ''}
                {c.status === 'duplicate' ? ' dup' : ''}
              </text>
            </g>
          );
        })}

        {/* watermark */}
        {f.watermark !== null && (
          <g style={{ transition: 'transform 0.35s ease' }}>
            <line x1={ex(f.watermark)} y1={BAND_TOP - 6} x2={ex(f.watermark)} y2={BAND_BOT + 4} stroke="var(--good)" strokeWidth={2.4} strokeDasharray="6 3" />
            <text x={ex(f.watermark)} y={BAND_TOP - 9} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: 'var(--good)' }}>
              watermark {f.watermark}s
            </text>
          </g>
        )}

        {/* results */}
        <text x={10} y={205} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          Aggregation DB rows (ad_42, window)
        </text>
        {f.windows.map((w, k) => {
          const x = 10 + k * 196;
          const fired = w.emitted !== null;
          const ok = fired && w.emitted === w.truth;
          return (
            <g key={k}>
              <rect x={x} y={213} width={186} height={96} rx={8} fill="var(--surface-2)" stroke={fired ? (ok ? 'var(--good)' : 'var(--bad)') : 'var(--border)'} strokeWidth={fired ? 1.8 : 1.2} />
              <text x={x + 10} y={231} fontSize={11.5} fontWeight={700}>
                W{k}
              </text>
              <text x={x + 10} y={256} fontSize={22} fontWeight={700} style={{ fill: fired ? (ok ? 'var(--good)' : 'var(--bad)') : 'var(--muted)' }}>
                {fired ? w.emitted : '—'}
              </text>
              <text x={x + 10} y={276} className="viz-label" style={{ fontSize: 10.5 }}>
                true count {w.truth}
              </text>
              <text x={x + 10} y={295} fontSize={10.5} style={{ fill: w.dropped ? 'var(--bad)' : w.corrections ? 'var(--warn)' : 'var(--text-2)' }}>
                {w.dropped ? `${w.dropped} late dropped` : w.corrections ? `${w.corrections} correction upsert${w.corrections > 1 ? 's' : ''}` : fired ? `latency ${w.firedAt! - (k + 1) * WINDOW}s after close` : 'not emitted yet'}
              </text>
              {fired && (
                <text x={x + 176} y={256} textAnchor="end" fontSize={18} fontWeight={700} style={{ fill: ok ? 'var(--good)' : 'var(--bad)' }}>
                  {ok ? '✓' : '✗'}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </VizFrame>
  );
}
