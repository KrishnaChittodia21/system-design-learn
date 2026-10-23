import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { B_TRIES_AT, MODE_LABELS, TOKEN, simulate, type Mode, type Params, type Who } from './sim';

const COLOR: Record<Who, string> = { A: 'var(--blue)', B: 'var(--mag)' };
const SOFT: Record<Who, string> = { A: 'var(--blue-s)', B: 'var(--mag-s)' };
const X0 = 100;
const X1 = 590;
const Y = { lock: 36, A: 88, B: 140, store: 196 };

export default function LeaseFencingTokenViz() {
  const [params, setParams] = useState<Params>({ ttl: 10, pause: 12, mode: 'none' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const H = f.horizon;
  const x = (t: number) => X0 + (Math.max(0, Math.min(H, t)) / H) * (X1 - X0);
  const now = f.t;
  const clip = (to: number) => Math.min(to, now);
  const bLease = f.leases.find((l) => l.who === 'B')!;
  const aLease = f.leases.find((l) => l.who === 'A')!;
  // A believes it holds the lock from 0 until it tries to release (half a second after waking)
  const aBelieveTo = f.pauseTo + 0.5;
  const overlapFrom = bLease.from;
  const overlapTo = Math.min(aBelieveTo, bLease.to);
  const hasOverlap = overlapTo > overlapFrom && now > overlapFrom;
  const ticks = Array.from({ length: Math.floor(H / 2) + 1 }, (_, k) => k * 2);

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Lease TTL" value={params.ttl} min={4} max={20} onChange={(v) => setParams((p) => ({ ...p, ttl: v }))} format={(v) => `${v} s`} />
          <Slider label="A's GC pause" value={params.pause} min={0} max={20} onChange={(v) => setParams((p) => ({ ...p, pause: v }))} format={(v) => `${v} s`} />
          <Choice<Mode>
            label="Protection"
            value={params.mode}
            options={(Object.keys(MODE_LABELS) as Mode[]).map((k) => ({ value: k, label: MODE_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, mode: v }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: COLOR.A }} /> client A{params.mode === 'fence' ? ` (token ${TOKEN.A})` : ''}
          <span className="viz-key" style={{ background: COLOR.B }} /> client B{params.mode === 'fence' ? ` (token ${TOKEN.B})` : ''}
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> GC pause
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> two "holders" / bad write
        </>
      }
    >
      <svg
        viewBox="0 0 600 262"
        className="viz-svg"
        role="img"
        aria-label={`t=${now} seconds. Lock held by ${f.holder ?? 'nobody'} per the lock service. Clients that believe they hold it: ${f.believers.join(' and ') || 'none'}. Storage: ${f.storageValue}${params.mode === 'fence' ? `, fence ${f.storageFence}` : ''}.${f.corrupted ? ' Data corrupted.' : ''}`}
      >
        <defs>
          <pattern id="lft-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--warn-soft)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--warn)" strokeWidth="2" />
          </pattern>
        </defs>

        {/* time axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={22} x2={x(t)} y2={226} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={x(t)} y={240} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
              {t}s
            </text>
          </g>
        ))}

        {/* overlap band */}
        {hasOverlap && (
          <g>
            <rect x={x(overlapFrom)} y={Y.A - 14} width={x(clip(overlapTo)) - x(overlapFrom)} height={Y.B - Y.A + 30} fill="var(--bad-soft)" stroke="var(--bad)" strokeDasharray="4 3" />
            <text x={Math.min(x(overlapFrom) + 4, X1 - 150)} y={Y.A - 18} style={{ fontSize: 10.5, fontWeight: 700, fill: 'var(--bad)' }}>
              both think they hold the lock
            </text>
          </g>
        )}

        {/* lane labels */}
        <text x={8} y={Y.lock + 4} style={{ fontSize: 12, fontWeight: 700 }}>
          lock service
        </text>
        <text x={8} y={Y.A + 4} style={{ fontSize: 12, fontWeight: 700, fill: COLOR.A }}>
          client A
        </text>
        <text x={8} y={Y.B + 4} style={{ fontSize: 12, fontWeight: 700, fill: COLOR.B }}>
          client B
        </text>
        <text x={8} y={Y.store + 4} style={{ fontSize: 12, fontWeight: 700 }}>
          storage
        </text>

        {/* leases */}
        {[aLease, bLease].map((l) =>
          now >= l.from && f.kind !== 'start' ? (
            <g key={l.who}>
              <rect x={x(l.from)} y={Y.lock - 10} width={Math.max(2, x(clip(l.to)) - x(l.from))} height={20} rx={5} fill={SOFT[l.who]} stroke={COLOR[l.who]} />
              <text x={x(l.from) + 5} y={Y.lock + 4} style={{ fontSize: 10.5, fontWeight: 700, fill: COLOR[l.who] }}>
                {x(l.to) - x(l.from) > 80 ? `lease ${l.who}` : l.who}
                {params.mode === 'fence' ? ` #${TOKEN[l.who]}` : ''}
              </text>
            </g>
          ) : null,
        )}
        {f.leases[0].to === params.ttl && now >= params.ttl && (
          <text x={x(params.ttl)} y={Y.lock - 14} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: 'var(--bad)' }}>
            TTL expired
          </text>
        )}

        {/* client A: running / paused / believes */}
        {f.kind !== 'start' && (
          <g>
            <line x1={x(0)} y1={Y.A} x2={x(clip(aBelieveTo))} y2={Y.A} stroke={COLOR.A} strokeWidth={3} />
            {now > f.pauseFrom && f.pauseTo > f.pauseFrom && (
              <g>
                <rect x={x(f.pauseFrom)} y={Y.A - 9} width={x(clip(f.pauseTo)) - x(f.pauseFrom)} height={18} rx={4} fill="url(#lft-hatch)" stroke="var(--warn)" />
                <text x={x(f.pauseFrom) + 4} y={Y.A + 24} style={{ fontSize: 10.5, fontWeight: 700, fill: 'var(--warn)' }}>
                  GC pause {params.pause}s
                </text>
              </g>
            )}
          </g>
        )}

        {/* client B: waiting then holding */}
        {now >= B_TRIES_AT && (
          <g>
            <line x1={x(B_TRIES_AT)} y1={Y.B} x2={x(clip(bLease.from))} y2={Y.B} stroke={COLOR.B} strokeWidth={1.5} strokeDasharray="4 4" />
            <text x={x(B_TRIES_AT) + 4} y={Y.B + 18} className="viz-label" style={{ fontSize: 10 }}>
              retrying
            </text>
            {now >= bLease.from && <line x1={x(bLease.from)} y1={Y.B} x2={x(clip(bLease.to))} y2={Y.B} stroke={COLOR.B} strokeWidth={3} />}
          </g>
        )}

        {/* writes */}
        {f.writes.map((w) => {
          const yLane = Y[w.who];
          const ok = w.accepted;
          const bad = ok && f.corrupted && w.who === 'A';
          const col = !ok || bad ? 'var(--bad)' : 'var(--good)';
          return (
            <g key={`${w.who}-${w.t}`}>
              <line x1={x(w.t)} y1={yLane + 6} x2={x(w.t)} y2={Y.store - 12} stroke={col} strokeWidth={2} />
              <circle cx={x(w.t)} cy={Y.store} r={10} fill={ok && !bad ? 'var(--good-soft)' : 'var(--bad-soft)'} stroke={col} strokeWidth={2} />
              <text x={x(w.t)} y={Y.store + 4} textAnchor="middle" style={{ fontSize: 11, fontWeight: 800, fill: col }}>
                {ok ? w.who : '✗'}
              </text>
              <text x={x(w.t)} y={Y.store + 24} textAnchor="middle" style={{ fontSize: 9.5, fontWeight: 700, fill: col }}>
                {ok ? (bad ? 'overwrote B' : params.mode === 'fence' ? `#${w.token} ok` : 'ok') : `#${w.token} rejected`}
              </text>
            </g>
          );
        })}

        {/* cursor */}
        {f.kind !== 'start' && <line x1={x(now)} y1={22} x2={x(now)} y2={226} stroke="var(--text)" strokeWidth={1.5} />}

        <text x={8} y={256} className="viz-label">
          t = {now}s · lock service says: <tspan style={{ fontWeight: 700, fill: 'var(--text)' }}>{f.holder ?? 'free'}</tspan> · storage:{' '}
          <tspan style={{ fontWeight: 700, fill: f.corrupted ? 'var(--bad)' : 'var(--text)' }}>{f.storageValue}</tspan>
          {params.mode === 'fence' ? ` · fence ${f.storageFence}` : ''}
        </text>
      </svg>
    </VizFrame>
  );
}
