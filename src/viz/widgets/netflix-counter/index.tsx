import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { BUCKET_SECONDS, DEFAULT_PARAMS, READ_TIMES, T_END, simulate, type Mode, type Params } from './sim';

// event-log time axis
const AX_X = 14;
const AX_W = 330;
const tx = (t: number) => AX_X + (t / (T_END + 1)) * AX_W;
// chart
const CH_X = 40;
const CH_W = 548;
const CH_TOP = 214;
const CH_BOT = 306;
const MAX_Y = 10;
const cx = (t: number) => CH_X + (t / T_END) * CH_W;
const cy = (v: number) => CH_BOT - (v / MAX_Y) * (CH_BOT - CH_TOP);

function Box({ x, y, w, h, title, tone, children }: { x: number; y: number; w: number; h: number; title: string; tone?: 'good' | 'bad' | 'warn' | 'accent'; children?: React.ReactNode }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={tone ? `var(--${tone}-soft)` : 'var(--surface-2)'}
        stroke={tone ? `var(--${tone})` : 'var(--border)'}
        strokeWidth={tone ? 2 : 1.2}
        style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
      />
      <text x={x + 8} y={y + 15} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
        {title}
      </text>
      {children}
    </g>
  );
}

export default function NetflixCounterViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const be = params.mode === 'best-effort';
  const now = f.t;
  const has = (a: string) => f.actions.includes(a as never);

  const reportedPath = f.history.map((h, i) => `${i === 0 ? `M${cx(0)},${cy(0)} L${cx(h.t)},${cy(0)}` : ''} L${cx(h.t)},${cy(f.history[i - 1]?.cached ?? 0)} L${cx(h.t)},${cy(h.cached)}`).join(' ');
  const truthPath = f.history.map((h, i) => `${i === 0 ? `M${cx(0)},${cy(0)} L${cx(h.t)},${cy(0)}` : ''} L${cx(h.t)},${cy(f.history[i - 1]?.truth ?? 0)} L${cx(h.t)},${cy(h.truth)}`).join(' ');
  const last = f.history[f.history.length - 1];

  const aria = `${params.mode} counter at t=${now}s: true count ${f.truth}, GetCount would return ${last ? last.cached : 0}.${
    be ? '' : ` Last rollup ${f.rollupCount} at ${f.rollupTs}s.`
  }`;

  // chips: stack events per second
  const stack: Record<number, number> = {};

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Mode>
            label="Counter type"
            value={params.mode}
            options={[
              { value: 'best-effort', label: 'Best-effort (EVCache)' },
              { value: 'eventual', label: 'Eventually consistent' },
              { value: 'accurate', label: 'Accurate (rollup + delta)' },
            ]}
            onChange={(mode) => setParams((p) => ({ ...p, mode }))}
          />
          <Choice<'on' | 'off'>
            label="Client retries the lost ack"
            value={params.retry}
            options={[
              { value: 'on', label: 'Yes (same token)' },
              { value: 'off', label: 'No' },
            ]}
            onChange={(retry) => setParams((p) => ({ ...p, retry }))}
          />
          {!be && <Slider label="Window lag (acceptLimit + skew)" value={params.lag} min={1} max={6} onChange={(lag) => setParams((p) => ({ ...p, lag }))} format={(v) => `${v}s`} />}
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--text-2)' }} /> true count
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> what GetCount would return · dots = actual reads
          {!be && (
            <>
              <span className="viz-key" style={{ background: 'var(--good)' }} /> event already rolled up
              <span className="viz-key" style={{ background: 'var(--good-soft)', border: '1px solid var(--good)' }} /> immutable window
              <span className="viz-key" style={{ background: 'var(--warn)' }} /> duplicate retry absorbed
            </>
          )}
        </>
      }
    >
      <svg viewBox="0 0 600 326" className="viz-svg" role="img" aria-label={aria}>
        {be ? (
          <>
            <Box x={14} y={24} w={150} h={120} title="clients" tone={has('write') || has('retry-double') ? 'accent' : undefined}>
              <text x={22} y={62} fontSize={12}>
                {has('retry-double') ? '↻ retry +1 (no token)' : has('write') ? `AddCount(+${f.truth - (frames[stepper.i - 1]?.truth ?? 0)})` : '…'}
              </text>
              {has('lost-ack') && (
                <text x={22} y={84} fontSize={11} style={{ fill: 'var(--bad)' }}>
                  ack lost → timeout
                </text>
              )}
              <text x={22} y={130} className="viz-label">
                true views: {f.truth}
              </text>
            </Box>
            <line x1={168} y1={84} x2={222} y2={84} stroke="var(--muted)" strokeWidth={1.5} />
            <Box x={226} y={24} w={170} h={120} title="EVCache (one region)" tone={has('retry-double') ? 'bad' : has('write') ? 'accent' : undefined}>
              <text x={311} y={92} textAnchor="middle" fontSize={34} fontWeight={700} style={{ fill: f.cacheValue !== f.truth ? 'var(--bad)' : 'var(--text)' }}>
                {f.cacheValue}
              </text>
              <text x={311} y={128} textAnchor="middle" className="viz-label">
                incr/decr · no token
              </text>
            </Box>
            <line x1={400} y1={84} x2={440} y2={84} stroke="var(--muted)" strokeWidth={1.5} />
            <Box x={444} y={24} w={146} h={120} title="GetCount" tone={f.read ? (f.read.value === f.read.truth ? 'good' : 'bad') : undefined}>
              <text x={517} y={84} textAnchor="middle" fontSize={22} fontWeight={700}>
                {f.read ? f.read.value : '—'}
              </text>
              <text x={517} y={110} textAnchor="middle" className="viz-label">
                {f.read ? (f.read.value === f.read.truth ? 'exact' : `truth ${f.read.truth}`) : `reads at ${READ_TIMES.join(', ')}s`}
              </text>
            </Box>
          </>
        ) : (
          <>
            {/* event log on a time axis */}
            <text x={AX_X} y={16} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
              TimeSeries event log (idempotency key = event_time + event_id)
            </text>
            {Array.from({ length: Math.ceil((T_END + 1) / BUCKET_SECONDS) }, (_, b) => (
              <g key={b}>
                <rect
                  x={tx(b * BUCKET_SECONDS)}
                  y={24}
                  width={tx(Math.min(T_END + 1, (b + 1) * BUCKET_SECONDS)) - tx(b * BUCKET_SECONDS)}
                  height={118}
                  fill={b % 2 ? 'var(--surface-2)' : 'var(--surface)'}
                  stroke="var(--border)"
                />
                <text x={tx(b * BUCKET_SECONDS) + 3} y={136} fontSize={9} style={{ fill: 'var(--muted)' }}>
                  bucket {b}
                </text>
              </g>
            ))}
            {/* immutable region and mutable tail */}
            {f.windowEnd > 0 && <rect x={tx(0)} y={24} width={tx(f.windowEnd) - tx(0)} height={10} fill="var(--good-soft)" stroke="var(--good)" strokeWidth={0.8} />}
            {now > 0 && <rect x={tx(f.windowEnd)} y={24} width={Math.max(0, tx(now + 1) - tx(f.windowEnd))} height={10} fill="var(--warn-soft)" stroke="var(--warn)" strokeWidth={0.8} />}
            {now > 0 && (
              <>
                <line x1={tx(now + 1)} y1={20} x2={tx(now + 1)} y2={146} stroke="var(--text)" strokeWidth={1.2} />
                <text x={tx(now + 1)} y={156} textAnchor="middle" fontSize={9.5} fontWeight={700}>
                  now {now}s
                </text>
              </>
            )}
            {f.rollupTs > 0 && (
              <>
                <line x1={tx(f.rollupTs)} y1={34} x2={tx(f.rollupTs)} y2={146} stroke="var(--good)" strokeWidth={2} strokeDasharray="4 2" />
                <text x={tx(f.rollupTs)} y={168} textAnchor="middle" fontSize={9} style={{ fill: 'var(--good)' }}>
                  lastRollupTs {f.rollupTs}
                </text>
              </>
            )}
            {f.events.map((e) => {
              const k = (stack[e.t] = (stack[e.t] ?? 0) + 1) - 1;
              const dup = f.dupTokens.includes(e.tok);
              const fresh = e.t === now;
              return (
                <g key={e.tok}>
                  <rect
                    x={tx(e.t) + 1}
                    y={42 + k * 22}
                    width={tx(1) - tx(0) - 2}
                    height={18}
                    rx={4}
                    fill={e.rolled ? 'var(--good)' : fresh ? 'var(--accent)' : 'var(--accent-soft)'}
                    stroke={dup ? 'var(--warn)' : 'none'}
                    strokeWidth={2.5}
                  />
                  <text x={tx(e.t) + (tx(1) - tx(0)) / 2} y={55 + k * 22} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: e.rolled || fresh ? 'var(--surface)' : 'var(--accent)' }}>
                    +{e.delta}
                  </text>
                  {dup && (
                    <text x={tx(e.t) + (tx(1) - tx(0)) / 2} y={74 + k * 22} textAnchor="middle" fontSize={9} fontWeight={700} style={{ fill: 'var(--warn)' }}>
                      dup×
                    </text>
                  )}
                </g>
              );
            })}
            <text x={AX_X} y={184} className="viz-label" style={{ fontSize: 10 }}>
              green = immutable (before now − {params.lag}s) · amber = acceptLimit + skew, may still change
            </text>

            {/* rollup pipeline */}
            <Box x={358} y={24} w={108} h={56} title="rollup queue (Set)" tone={f.queued ? 'accent' : undefined}>
              <text x={412} y={64} textAnchor="middle" fontSize={11} style={{ fill: f.queued ? 'var(--accent)' : 'var(--muted)' }}>
                {f.queued ? 'views:title42' : 'empty'}
              </text>
            </Box>
            <Box x={474} y={24} w={116} h={56} title="rollup store+cache" tone={has('rollup') ? 'good' : undefined}>
              <text x={482} y={56} fontSize={11}>
                count <tspan fontWeight={700}>{f.rollupCount}</tspan>
              </text>
              <text x={482} y={72} fontSize={11}>
                ts <tspan fontWeight={700}>{f.rollupTs}s</tspan>
              </text>
            </Box>
            <line x1={466} y1={52} x2={474} y2={52} stroke="var(--muted)" />
            <Box x={358} y={88} w={232} h={62} title={params.mode === 'accurate' ? 'GetCount = rollup + delta' : 'GetCount = last rollup'} tone={f.read ? (f.read.value === f.read.truth ? 'good' : 'warn') : undefined}>
              <text x={474} y={124} textAnchor="middle" fontSize={f.read ? 15 : 11} fontWeight={f.read ? 700 : 400} style={{ fill: f.read ? 'var(--text)' : 'var(--muted)' }}>
                {f.read
                  ? params.mode === 'accurate'
                    ? `${f.read.base} + ${f.read.value - f.read.base} = ${f.read.value}`
                    : `${f.read.value}`
                  : `reads at ${READ_TIMES.join(', ')}s`}
              </text>
              {f.read && (
                <text x={474} y={142} textAnchor="middle" fontSize={10} style={{ fill: 'var(--text-2)' }}>
                  truth {f.read.truth}
                  {params.mode === 'accurate' ? ` · scanned ${f.read.scanned} event${f.read.scanned === 1 ? '' : 's'}` : f.read.value === f.read.truth ? ' · converged' : ` · stale by ${f.read.truth - f.read.value}`}
                </text>
              )}
            </Box>
            <text x={474} y={170} textAnchor="middle" className="viz-label" style={{ fontSize: 10.5 }}>
              true views: {f.truth}
              {has('retry-dup') ? ' · retry absorbed' : has('lost-ack') ? ' · ack lost!' : ''}
            </text>
          </>
        )}

        {/* chart: truth vs GetCount */}
        <line x1={CH_X} y1={CH_BOT} x2={CH_X + CH_W} y2={CH_BOT} stroke="var(--border)" />
        <line x1={CH_X} y1={CH_TOP} x2={CH_X} y2={CH_BOT} stroke="var(--border)" />
        {[0, 4, 8].map((v) => (
          <text key={v} x={CH_X - 5} y={cy(v) + 3} textAnchor="end" fontSize={9} style={{ fill: 'var(--text-2)' }}>
            {v}
          </text>
        ))}
        <text x={CH_X + CH_W} y={CH_BOT + 14} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
          time (s) →
        </text>
        {READ_TIMES.map((t) => (
          <line key={t} x1={cx(t)} y1={CH_TOP} x2={cx(t)} y2={CH_BOT} stroke="var(--border)" strokeDasharray="2 3" />
        ))}
        {f.history.length > 0 && (
          <>
            <path d={truthPath} fill="none" stroke="var(--text-2)" strokeWidth={2} strokeDasharray="5 3" />
            <path d={reportedPath} fill="none" stroke="var(--accent)" strokeWidth={2.4} />
            <circle cx={cx(last.t)} cy={cy(last.cached)} r={4} fill="var(--accent)" />
          </>
        )}
        {f.history
          .filter((h) => READ_TIMES.includes(h.t))
          .map((h) => (
            <circle key={h.t} cx={cx(h.t)} cy={cy(h.reported)} r={5} fill={h.reported === h.truth ? 'var(--good)' : h.reported > h.truth ? 'var(--bad)' : 'var(--warn)'} stroke="var(--surface)" strokeWidth={1.5} />
          ))}
        <text x={CH_X + 4} y={CH_TOP - 8} className="viz-label" style={{ fontSize: 10.5 }}>
          count over time
        </text>
      </svg>
    </VizFrame>
  );
}
