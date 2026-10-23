import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, DURATION, LADDER, LIVE_SEGS, bandwidth, simulate, type Mode, type Params, type Profile } from './sim';

const CX0 = 44;
const CX1 = 588;
const M_TOP = 126;
const M_BOT = 206;
const M_MAX = 9;
const M_MIN = 0.4;
const B_TOP = 234;
const B_BOT = 300;

function Box({ x, w, title, active, children }: { x: number; w: number; title: string; active?: boolean; children?: React.ReactNode }) {
  return (
    <g>
      <rect x={x} y={8} width={w} height={92} rx={8} fill={active ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke={active ? 'var(--accent)' : 'var(--border)'} strokeWidth={active ? 2 : 1.2} style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }} />
      <text x={x + 7} y={23} fontSize={10} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
        {title}
      </text>
      {children}
    </g>
  );
}

export default function LiveAbrViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const T = Math.max(DURATION, ...f.samples.map((s) => s.t), ...frames[frames.length - 1].samples.map((s) => s.t));
  const tx = (t: number) => CX0 + (t / T) * (CX1 - CX0);
  // log scale so the low rungs (0.6 / 1.2 Mbps) do not collide
  const my = (v: number) => M_BOT - (Math.log(v / M_MIN) / Math.log(M_MAX / M_MIN)) * (M_BOT - M_TOP);
  const cap = LIVE_SEGS * params.seg;
  const by = (v: number) => B_BOT - (v / cap) * (B_BOT - B_TOP);
  const live = f.rung !== null;

  // bandwidth step path over the full time axis
  let bwPath = '';
  for (let t = 0; t <= T; t += 0.5) bwPath += `${t === 0 ? 'M' : 'L'}${tx(t)},${my(bandwidth(params.profile, t))} `;
  const bufPath = f.samples.map((s, i) => `${i === 0 ? `M${tx(s.start)},${by(0)} ` : ''}L${tx(s.t)},${by(s.buffer)}`).join(' ');

  const aria = live
    ? `Segment ${f.seq} at ${LADDER[f.rung!].name}, bandwidth ${f.bw} Mbps, buffer ${f.buffer.toFixed(1)} s, total stall ${f.stallTotal.toFixed(1)} s.`
    : `Total stall ${f.stallTotal.toFixed(1)} s over ${f.samples.length} segments.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Profile>
            label="Viewer bandwidth"
            value={params.profile}
            options={[
              { value: 'drop', label: 'Drops, then recovers' },
              { value: 'spiky', label: 'Spiky' },
              { value: 'stable', label: 'Stable 8 Mbps' },
            ]}
            onChange={(profile) => setParams((p) => ({ ...p, profile }))}
          />
          <Choice<'2' | '4' | '6'>
            label="Segment length"
            value={String(params.seg) as '2' | '4' | '6'}
            options={[
              { value: '2', label: '2 s' },
              { value: '4', label: '4 s' },
              { value: '6', label: '6 s' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, seg: Number(v) as 2 | 4 | 6 }))}
          />
          <Choice<Mode>
            label="Player"
            value={params.mode}
            options={[
              { value: 'abr', label: 'Adaptive bitrate' },
              { value: 'fixed', label: 'Fixed 1080p' },
            ]}
            onChange={(mode) => setParams((p) => ({ ...p, mode }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--text-2)' }} /> available bandwidth
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> rendition fetched
          <span className="viz-key" style={{ background: 'var(--good)' }} /> buffer
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> stall / aborted download
        </>
      }
    >
      <svg viewBox="0 0 600 320" className="viz-svg" role="img" aria-label={aria}>
        <defs>
          <marker id="abr-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        <Box x={8} w={76} title="ingest">
          <text x={15} y={46} fontSize={10}>
            stadium
          </text>
          <text x={15} y={62} fontSize={10}>
            SRT ×2
          </text>
          <text x={15} y={86} className="viz-label" style={{ fontSize: 9 }}>
            primary+backup
          </text>
        </Box>
        <Box x={96} w={128} title="transcoder ladder">
          {LADDER.map((r, i) => {
            const on = f.rung === i;
            return (
              <g key={r.name}>
                <rect x={102} y={30 + i * 17} width={116} height={15} rx={3} fill={on ? 'var(--accent)' : 'var(--surface)'} stroke={on ? 'var(--accent)' : 'var(--border)'} style={{ transition: 'fill 0.3s ease' }} />
                <text x={108} y={41 + i * 17} fontSize={10} fontWeight={on ? 700 : 500} style={{ fill: on ? 'var(--surface)' : 'var(--text)' }}>
                  {r.name} · {r.mbps} Mbps
                </text>
              </g>
            );
          })}
        </Box>
        <Box x={236} w={108} title="packager" active={live}>
          <text x={243} y={46} fontSize={10.5} fontWeight={700}>
            {live ? `seg #${f.seq}` : `${params.seg} s segments`}
          </text>
          <text x={243} y={62} className="viz-label" style={{ fontSize: 9.5 }}>
            CMAF + HLS/DASH
          </text>
          <text x={243} y={78} className="viz-label" style={{ fontSize: 9.5 }}>
            GOP-aligned: switch
          </text>
          <text x={243} y={91} className="viz-label" style={{ fontSize: 9.5 }}>
            at any boundary
          </text>
        </Box>
        <Box x={356} w={92} title="shield + CDN" active={live}>
          <text x={363} y={46} className="viz-label" style={{ fontSize: 9.5 }}>
            playlist TTL ~1 s
          </text>
          <text x={363} y={62} className="viz-label" style={{ fontSize: 9.5 }}>
            segments: long TTL
          </text>
          <text x={363} y={78} className="viz-label" style={{ fontSize: 9.5 }}>
            misses collapsed
          </text>
        </Box>
        <Box x={460} w={132} title="player" active={live}>
          <text x={467} y={42} fontSize={10.5}>
            net <tspan fontWeight={700}>{f.bw} Mbps</tspan> · est {f.estimate.toFixed(1)}
          </text>
          <text x={467} y={58} fontSize={10.5}>
            playing <tspan fontWeight={700} style={{ fill: 'var(--accent)' }}>{live ? LADDER[f.rung!].name : '—'}</tspan>
          </text>
          <rect x={467} y={66} width={118} height={10} rx={3} fill="var(--surface)" stroke="var(--border)" />
          <rect x={467} y={66} width={(118 * Math.min(cap, f.buffer)) / cap} height={10} rx={3} fill="var(--good)" style={{ transition: 'width 0.3s ease' }} />
          <text x={467} y={91} fontSize={9.5} style={{ fill: f.stallTotal ? 'var(--bad)' : 'var(--text-2)' }} fontWeight={f.stallTotal ? 700 : 400}>
            buffer {f.buffer.toFixed(1)}/{cap} s · stalls {f.stallTotal.toFixed(1)} s
          </text>
        </Box>
        {[84, 224, 344, 448].map((x) => (
          <line key={x} x1={x + 1} y1={54} x2={x + 11} y2={54} stroke="var(--muted)" strokeWidth={1.4} markerEnd="url(#abr-arrow)" />
        ))}

        {/* Mbps chart */}
        <text x={8} y={118} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          Mbps (log scale)
        </text>
        <text x={CX1} y={118} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
          latency ≈ {f.latency} s behind live
        </text>
        {LADDER.map((r) => (
          <g key={r.name}>
            <line x1={CX0} y1={my(r.mbps)} x2={CX1} y2={my(r.mbps)} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={CX0 - 4} y={my(r.mbps) + 3} textAnchor="end" fontSize={8.5} style={{ fill: 'var(--muted)' }}>
              {r.name}
            </text>
          </g>
        ))}
        <line x1={CX0} y1={M_BOT} x2={CX1} y2={M_BOT} stroke="var(--border)" />
        <path d={bwPath} fill="none" stroke="var(--text-2)" strokeWidth={1.6} strokeDasharray="5 3" />
        {f.samples.map((s, i) => {
          const from = s.start + (s.abandoned?.probe ?? 0);
          return (
            <g key={i}>
              {s.abandoned && (
                <line x1={tx(s.start)} y1={my(LADDER[s.abandoned.rung].mbps)} x2={tx(from)} y2={my(LADDER[s.abandoned.rung].mbps)} stroke="var(--bad)" strokeWidth={4} strokeDasharray="2 2" />
              )}
              <line x1={tx(from)} y1={my(LADDER[s.rung].mbps)} x2={Math.max(tx(from) + 2, tx(s.dlEnd) - 1)} y2={my(LADDER[s.rung].mbps)} stroke={s.stall > 0 ? 'var(--bad)' : 'var(--accent)'} strokeWidth={4} />
            </g>
          );
        })}

        {/* buffer chart */}
        <text x={8} y={B_TOP - 6} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          buffer (s)
        </text>
        <line x1={CX0} y1={B_BOT} x2={CX1} y2={B_BOT} stroke="var(--border)" />
        <line x1={CX0} y1={by(cap)} x2={CX1} y2={by(cap)} stroke="var(--border)" strokeDasharray="2 3" />
        <text x={CX0 - 4} y={by(cap) + 3} textAnchor="end" fontSize={8.5} style={{ fill: 'var(--muted)' }}>
          {cap}
        </text>
        <text x={CX0 - 4} y={B_BOT + 3} textAnchor="end" fontSize={8.5} style={{ fill: 'var(--muted)' }}>
          0
        </text>
        {bufPath && <path d={bufPath} fill="none" stroke="var(--good)" strokeWidth={2.2} />}
        {f.samples
          .filter((s) => s.stall > 0)
          .map((s, i) => (
            <rect key={i} x={tx(s.t - s.stall)} y={B_TOP} width={Math.max(2, tx(s.stall) - tx(0))} height={B_BOT - B_TOP} fill="var(--bad-soft)" stroke="var(--bad)" strokeWidth={0.8} />
          ))}
        {[0, 10, 20, 30, 40, 50].filter((t) => t <= T).map((t) => (
          <text key={t} x={tx(t)} y={B_BOT + 12} textAnchor="middle" fontSize={8.5} style={{ fill: 'var(--muted)' }}>
            {t}s
          </text>
        ))}
      </svg>
    </VizFrame>
  );
}
