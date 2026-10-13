import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import {
  FLIGHTS,
  HTTPS,
  HTTP_NAME,
  PROTOS,
  PROTO_NAME,
  simulate,
  ttfbRtts,
  type FlightKind,
  type HandshakeFrame,
  type MuxFrame,
  type Params,
  type Phase,
  type Proto,
  type Req,
} from './sim';

const FLIGHT_COLOR: Record<FlightKind, string> = {
  tcp: 'var(--muted)',
  tls: 'var(--warn)',
  data: 'var(--accent)',
  resp: 'var(--good)',
};
const PHASE_COLOR: Record<Phase, string> = {
  queued: 'var(--border)',
  req: 'var(--accent)',
  resp: 'var(--good)',
  lost: 'var(--bad)',
  hol: 'var(--warn)',
  done: 'var(--good)',
  idle: 'transparent',
};
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface)', strokeWidth: 3, strokeLinejoin: 'round' as const };

function HandshakeView({ f, params }: { f: HandshakeFrame; params: Params }) {
  const COL = 140;
  const GUT = 40;
  const Y0 = 46;
  const DY = 32;
  const y = (T: number) => Y0 + T * DY;
  const ms = (r: number) => `${Math.round(r * params.rttMs)}ms`;
  const label = `At ${f.T / 2} RTT: ${PROTOS.map((p) => (f.done[p] !== undefined ? `${PROTO_NAME[p]} has its first byte after ${f.done[p]} RTT` : `${PROTO_NAME[p]} still waiting`)).join('; ')}.`;
  return (
    <svg viewBox="0 0 600 350" className="viz-svg" role="img" aria-label={label}>
      <defs>
        {(Object.keys(FLIGHT_COLOR) as FlightKind[]).map((k) => (
          <marker key={k} id={`ph-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={FLIGHT_COLOR[k]} />
          </marker>
        ))}
      </defs>
      {/* RTT grid */}
      {[0, 1, 2, 3, 4].map((r) => (
        <g key={r}>
          <line x1={GUT - 4} x2={600} y1={y(r * 2)} y2={y(r * 2)} stroke="var(--border)" strokeDasharray="2 4" />
          <text x={2} y={y(r * 2) - 2} fontSize={9} className="viz-label">
            {r} RTT
          </text>
          <text x={2} y={y(r * 2) + 9} fontSize={8.5} className="viz-label">
            {ms(r)}
          </text>
        </g>
      ))}
      {PROTOS.map((p, c) => {
        const x0 = GUT + c * COL;
        const cx = x0 + 16;
        const sx = x0 + COL - 16;
        const focus = params.focus === p;
        const ttfb = ttfbRtts(p);
        const done = f.done[p] !== undefined;
        return (
          <g key={p}>
            {focus && <rect x={x0 + 3} y={2} width={COL - 6} height={344} rx={8} fill="var(--accent-soft)" opacity={0.55} />}
            <text x={x0 + COL / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={700}>
              {PROTO_NAME[p]}
            </text>
            <text x={cx} y={32} textAnchor="middle" fontSize={9} className="viz-label">
              client
            </text>
            <text x={sx} y={32} textAnchor="middle" fontSize={9} className="viz-label">
              server
            </text>
            <line x1={cx} x2={cx} y1={38} y2={y(8) + 4} stroke="var(--text-2)" strokeWidth={1.5} />
            <line x1={sx} x2={sx} y1={38} y2={y(8) + 4} stroke="var(--text-2)" strokeWidth={1.5} />
            {FLIGHTS[p]
              .filter((fl) => fl.t < f.T)
              .map((fl, k) => {
                const fromX = fl.dir === 'c2s' ? cx : sx;
                const toX = fl.dir === 'c2s' ? sx : cx;
                const latest = fl.t + 1 === f.T;
                const mx = (fromX + toX) / 2;
                const my = (y(fl.t) + y(fl.t + 1)) / 2;
                return (
                  <g key={k} opacity={latest ? 1 : 0.7}>
                    <line
                      x1={fromX}
                      y1={y(fl.t)}
                      x2={toX + (fl.dir === 'c2s' ? -2 : 2)}
                      y2={y(fl.t + 1)}
                      stroke={FLIGHT_COLOR[fl.kind]}
                      strokeWidth={latest ? 2.4 : 1.5}
                      markerEnd={`url(#ph-arrow-${fl.kind})`}
                    />
                    <text x={mx} y={my + 3} textAnchor="middle" fontSize={8.5} fontWeight={latest ? 700 : 400} style={halo}>
                      {fl.label}
                    </text>
                  </g>
                );
              })}
            {done && (
              <g>
                <rect x={x0 + 14} y={y(ttfb * 2) + 6} width={COL - 28} height={20} rx={10} fill="var(--good-soft)" stroke="var(--good)" />
                <text x={x0 + COL / 2} y={y(ttfb * 2) + 20} textAnchor="middle" fontSize={9.5} fontWeight={700}>
                  TTFB {ttfb} RTT · {ms(ttfb)}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {/* now line */}
      {!f.summary && f.T > 0 && f.T < 8 && <line x1={GUT - 4} x2={600} y1={y(f.T)} y2={y(f.T)} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="6 3" />}
    </svg>
  );
}

function segments(r: Req): [number, number, Phase][] {
  const s: [number, number, Phase][] = [];
  if (r.start > 0) s.push([0, r.start, 'queued']);
  s.push([r.start, r.start + 0.5, 'req']);
  s.push([r.start + 0.5, r.start + 1, r.lost ? 'lost' : 'resp']);
  if (r.done > r.start + 1) s.push([r.start + 1, r.done, r.lost ? 'lost' : r.hol ? 'hol' : 'resp']);
  return s;
}

function MuxView({ f, params }: { f: MuxFrame; params: Params }) {
  const PW = 200;
  const n = params.resources;
  const top = 44;
  const rowH = Math.min(16, 256 / n);
  const H = top + n * rowH + 40;
  const label = `At ${f.T} RTT: ${HTTPS.map((h) => `${HTTP_NAME[h]} ${f.reqs[h].filter((r) => r.done <= f.T).length} of ${n} done`).join('; ')}.`;
  return (
    <svg viewBox={`0 0 600 ${Math.max(240, H)}`} className="viz-svg" role="img" aria-label={label}>
      {HTTPS.map((h, c) => {
        const x0 = c * PW + 26;
        const w = PW - 36;
        const X = (T: number) => x0 + (T / f.horizon) * w;
        const reqs = f.reqs[h];
        const doneCount = reqs.filter((r) => r.done <= f.T).length;
        return (
          <g key={h}>
            <text x={c * PW + PW / 2} y={14} textAnchor="middle" fontSize={11} fontWeight={700}>
              {HTTP_NAME[h]}
            </text>
            <text x={c * PW + PW / 2} y={30} textAnchor="middle" fontSize={10} className="viz-label">
              {doneCount}/{n} done{doneCount === n ? ` · ${Math.max(...reqs.map((r) => r.done))} RTT` : ''}
            </text>
            {/* RTT grid */}
            {Array.from({ length: f.horizon + 1 }, (_, r) => (
              <g key={r}>
                <line x1={X(r)} x2={X(r)} y1={top - 4} y2={top + n * rowH + 2} stroke="var(--border)" strokeDasharray="2 3" />
                <text x={X(r)} y={top + n * rowH + 14} textAnchor="middle" fontSize={9} className="viz-label">
                  {r}
                </text>
              </g>
            ))}
            {reqs.map((r, i) => {
              const yy = top + i * rowH;
              const bh = Math.max(3, rowH - 3);
              return (
                <g key={i}>
                  {rowH >= 9 && (
                    <text x={x0 - 4} y={yy + bh - 1} textAnchor="end" fontSize={Math.min(9, rowH - 2)} className="viz-label">
                      {h === 'h1' ? `c${r.conn + 1}` : `#${i + 1}`}
                    </text>
                  )}
                  {segments(r)
                    .filter(([a]) => a < f.T)
                    .map(([a, b, ph], k) => (
                      <rect
                        key={k}
                        x={X(a)}
                        y={yy}
                        width={Math.max(0.5, X(Math.min(b, f.T)) - X(a))}
                        height={bh}
                        rx={1.5}
                        fill={PHASE_COLOR[ph]}
                        opacity={ph === 'queued' ? 0.9 : r.done <= f.T ? 0.55 : 1}
                      />
                    ))}
                  {r.done <= f.T && <circle cx={X(r.done)} cy={yy + bh / 2} r={Math.min(3, bh / 2)} fill="var(--good)" />}
                </g>
              );
            })}
            {f.T > 0 && !f.summary && (
              <line x1={X(f.T)} x2={X(f.T)} y1={top - 6} y2={top + n * rowH + 4} stroke="var(--accent)" strokeWidth={1.5} />
            )}
          </g>
        );
      })}
      <text x={300} y={top + n * rowH + 32} textAnchor="middle" fontSize={10} className="viz-label">
        time in RTTs (1 RTT = {params.rttMs}ms) · rows: HTTP/1.1 connection c1–c6, or stream #
      </text>
    </svg>
  );
}

export default function ProtocolHandshakesViz() {
  const [params, setParams] = useState<Params>({ mode: 'handshake', rttMs: 100, focus: 'tls13', resources: 12, loss: true });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice
            label="View"
            value={params.mode}
            options={[
              { value: 'handshake', label: 'Handshakes (TTFB)' },
              { value: 'multiplex', label: 'Multiplexing & loss' },
            ]}
            onChange={set('mode')}
          />
          <Slider label="Round-trip time" value={params.rttMs} min={10} max={300} step={10} onChange={set('rttMs')} format={(v) => `${v}ms`} />
          {params.mode === 'handshake' ? (
            <Choice<Proto>
              label="Narrate"
              value={params.focus}
              options={PROTOS.map((p) => ({ value: p, label: PROTO_NAME[p] }))}
              onChange={set('focus')}
            />
          ) : (
            <>
              <Slider label="Resources on the page" value={params.resources} min={8} max={24} onChange={set('resources')} />
              <Choice
                label="Lost packet"
                value={params.loss ? 'yes' : 'no'}
                options={[
                  { value: 'no', label: 'None' },
                  { value: 'yes', label: 'Drop 1 packet of #1' },
                ]}
                onChange={(v) => set('loss')(v === 'yes')}
              />
            </>
          )}
        </>
      }
      legend={
        params.mode === 'handshake' ? (
          <>
            <span className="viz-key" style={{ background: 'var(--muted)' }} /> TCP handshake
            <span className="viz-key" style={{ background: 'var(--warn)' }} /> TLS / QUIC crypto
            <span className="viz-key" style={{ background: 'var(--accent)' }} /> request
            <span className="viz-key" style={{ background: 'var(--good)' }} /> first response byte
          </>
        ) : (
          <>
            <span className="viz-key" style={{ background: 'var(--border)' }} /> queued in browser
            <span className="viz-key" style={{ background: 'var(--accent)' }} /> request in flight
            <span className="viz-key" style={{ background: 'var(--good)' }} /> response arriving
            <span className="viz-key" style={{ background: 'var(--bad)' }} /> lost, retransmitting
            <span className="viz-key" style={{ background: 'var(--warn)' }} /> stuck behind loss (TCP HOL)
          </>
        )
      }
    >
      {f.mode === 'handshake' ? <HandshakeView f={f} params={params} /> : <MuxView f={f} params={params} />}
    </VizFrame>
  );
}
