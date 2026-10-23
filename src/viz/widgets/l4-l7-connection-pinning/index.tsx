import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { CLIENTS, END_PODS, MAX_AGE, POD_CAP, SCALE_AT, TICKS, simulate, type Conn, type Frame, type Layer, type Params } from './sim';

const CX = 6;
const CW = 84;
const LBX = 196;
const LBW = 112;
const PX = 410;
const PW = 186;
const TOP = 34;
const ROW = 38;
const CLIENT_COLORS = ['var(--accent)', 'var(--mag)', 'var(--warn)', 'var(--green)', 'var(--cyan)', 'var(--ink-3)'];
const cy = (i: number) => TOP + i * ROW + 14;
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 4, strokeLinejoin: 'round' as const };

function Drawing({ f, params }: { f: Frame; params: Params }) {
  const perRequest = params.layer === 'l7' || params.conn === 'h1';
  const maxLoad = 320;
  const lbMid = TOP + (CLIENTS.length * ROW) / 2 - 4;
  const totalErr = f.errorHistory.reduce((a, b) => a + b, 0);
  const aria =
    `Tick ${f.tick}. ${f.pods} pods. ` +
    f.load.map((l, p) => `pod ${p + 1}: ${Math.round(l)} requests per second${l > f.cap ? ', overloaded' : ''}`).join('; ') +
    `. Failing ${Math.round(f.errors)} requests per second.`;
  const sw = (rps: number) => 1 + (rps / 260) * 7;
  return (
    <svg viewBox="0 0 600 338" className="viz-svg" role="img" aria-label={aria}>
      <text x={CX} y={20} fontSize={10.5} fontWeight={700}>
        clients (req/s)
      </text>
      <text x={LBX + LBW / 2} y={20} textAnchor="middle" fontSize={10.5} fontWeight={700}>
        {params.layer === 'l4' ? 'L4 balancer' : 'L7 proxy'}
      </text>
      <text x={PX} y={20} fontSize={10.5} fontWeight={700}>
        pods (capacity {f.cap}/s)
      </text>
      {/* LB */}
      <rect x={LBX} y={TOP} width={LBW} height={CLIENTS.length * ROW - 10} rx={10} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.5} />
      {/* clients + flows */}
      {CLIENTS.map((rps, i) => {
        const pod = f.pin[i];
        const re = f.reconnected.includes(i);
        const col = CLIENT_COLORS[i];
        return (
          <g key={i}>
            <rect x={CX} y={TOP + i * ROW} width={CW} height={28} rx={7} fill="var(--surface)" stroke={re && f.tick > 0 ? 'var(--warn)' : col} strokeWidth={re && f.tick > 0 ? 2.4 : 1.5} />
            <text x={CX + 10} y={cy(i) + 4} fontSize={10.5} fontWeight={700}>
              c{i + 1}
            </text>
            <text x={CX + CW - 8} y={cy(i) + 4} textAnchor="end" fontSize={10} style={{ fill: 'var(--text-2)' }}>
              {rps}/s
            </text>
            {f.tick >= 0 && <line x1={CX + CW} y1={cy(i)} x2={LBX} y2={pod === null || perRequest ? lbMid : cy(i)} stroke={col} strokeWidth={sw(rps)} opacity={0.75} />}
            {f.tick >= 0 && !perRequest && pod !== null && (
              <path
                d={`M${LBX + LBW},${cy(i)} C${LBX + LBW + 50},${cy(i)} ${PX - 50},${cy(pod)} ${PX},${cy(pod)}`}
                fill="none"
                stroke={col}
                strokeWidth={sw(rps)}
                opacity={0.75}
                style={{ transition: 'd 0.45s ease' }}
              />
            )}
          </g>
        );
      })}
      {/* through-LB pinned segment */}
      {f.tick >= 0 &&
        !perRequest &&
        CLIENTS.map((rps, i) => <line key={i} x1={LBX} y1={cy(i)} x2={LBX + LBW} y2={cy(i)} stroke={CLIENT_COLORS[i]} strokeWidth={sw(rps)} opacity={0.35} strokeDasharray="4 3" />)}
      {/* per-request fan-out */}
      {f.tick >= 0 &&
        perRequest &&
        f.load.map((l, p) => <line key={p} x1={LBX + LBW} y1={lbMid} x2={PX} y2={cy(p)} stroke="var(--accent)" strokeWidth={sw(l)} opacity={0.7} />)}

      <text x={LBX + LBW / 2} y={lbMid - 22} textAnchor="middle" fontSize={9.5} fontWeight={700} style={halo}>
        unit: {params.layer === 'l4' ? 'connection' : 'request'}
      </text>
      <text x={LBX + LBW / 2} y={lbMid - 4} textAnchor="middle" fontSize={8.6} style={{ fill: 'var(--text-2)', ...halo }}>
        sees:
      </text>
      {(params.layer === 'l4' ? ['10.0.3.7:51234', '→ VIP:443', '(TCP/TLS bytes)'] : [':path /orders.v1/Get', 'authorization, host', 'grpc-timeout']).map((l, k) => (
        <text key={k} x={LBX + LBW / 2} y={lbMid + 10 + k * 12} textAnchor="middle" fontSize={8.6} fontFamily="var(--f-mono)" style={{ fill: 'var(--text)', ...halo }}>
          {l}
        </text>
      ))}

      {/* pods */}
      {Array.from({ length: END_PODS }, (_, p) => {
        const ready = p < f.pods;
        const l = f.load[p] ?? 0;
        const over = l > f.cap;
        const bw = PW - 12;
        return (
          <g key={p} opacity={ready ? 1 : 0.55}>
            <rect
              x={PX}
              y={TOP + p * ROW}
              width={PW}
              height={28}
              rx={7}
              fill={over ? 'var(--bad-soft)' : 'var(--surface)'}
              stroke={over ? 'var(--bad)' : 'var(--border-strong)'}
              strokeDasharray={ready ? undefined : '4 3'}
              style={{ transition: 'fill 0.3s ease' }}
            />
            <text x={PX + 8} y={cy(p) - 1} fontSize={10} fontWeight={700}>
              p{p + 1}
            </text>
            <text x={PX + PW - 6} y={cy(p) - 1} textAnchor="end" fontSize={9.5} fontWeight={over ? 800 : 500} style={{ fill: over ? 'var(--bad)' : 'var(--text-2)' }}>
              {!ready ? `joins at t=${SCALE_AT}` : `${Math.round(l)}/s${!perRequest ? ` · ${f.conns[p] ?? 0} conn` : ''}${over ? ' OVER' : ''}`}
            </text>
            <rect x={PX + 6} y={cy(p) + 4} width={bw} height={6} rx={3} fill="var(--surface-2)" />
            <rect x={PX + 6} y={cy(p) + 4} width={(bw * Math.min(l, maxLoad)) / maxLoad} height={6} rx={3} fill={over ? 'var(--bad)' : 'var(--good)'} style={{ transition: 'width 0.45s ease' }} />
            <line x1={PX + 6 + (bw * f.cap) / maxLoad} x2={PX + 6 + (bw * f.cap) / maxLoad} y1={cy(p) + 2} y2={cy(p) + 12} stroke="var(--text)" strokeWidth={1.5} />
          </g>
        );
      })}

      {/* errors over time */}
      <text x={CX} y={TOP + CLIENTS.length * ROW + 18} fontSize={10.5} fontWeight={700}>
        failed req/s
      </text>
      {Array.from({ length: TICKS }, (_, t) => {
        const e = f.errorHistory[t];
        const x = 96 + t * 30;
        const base = TOP + CLIENTS.length * ROW + 60;
        const h = e === undefined ? 0 : Math.max(e > 0 ? 2 : 0, (e / 120) * 40);
        return (
          <g key={t}>
            <rect x={x} y={base - h} width={24} height={h} fill="var(--bad)" opacity={t === f.tick ? 1 : 0.6} />
            <line x1={x} x2={x + 24} y1={base} y2={base} stroke="var(--border-strong)" />
            <text x={x + 12} y={base + 11} textAnchor="middle" fontSize={8.5} style={{ fill: t === SCALE_AT ? 'var(--accent)' : 'var(--text-2)' }}>
              {t === SCALE_AT ? '+2' : t}
            </text>
          </g>
        );
      })}
      <text x={596} y={TOP + CLIENTS.length * ROW + 18} textAnchor="end" fontSize={10.5} fontWeight={700} style={{ fill: totalErr ? 'var(--bad)' : 'var(--good)' }}>
        total failed: {Math.round(totalErr)}
      </text>
    </svg>
  );
}

export default function L4L7ConnectionPinningViz() {
  const [params, setParams] = useState<Params>({ layer: 'l4', conn: 'h2' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Layer>
            label="Balancer"
            value={params.layer}
            options={[
              { value: 'l4', label: 'L4 (per connection)' },
              { value: 'l7', label: 'L7 (per request)' },
            ]}
            onChange={(layer) => setParams((p) => ({ ...p, layer }))}
          />
          <Choice<Conn>
            label="Client connections"
            value={params.conn}
            options={[
              { value: 'h2', label: 'One long-lived HTTP/2' },
              { value: 'h2age', label: `HTTP/2 + max age ${MAX_AGE}` },
              { value: 'h1', label: 'New connection per request' },
            ]}
            onChange={(conn) => setParams((p) => ({ ...p, conn }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> pod load (tick = capacity {POD_CAP}/s)
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> overloaded / failing
          <span className="viz-key" style={{ background: 'transparent', border: '2px solid var(--warn)' }} /> client reconnected this tick
        </>
      }
    >
      <Drawing f={stepper.frame} params={params} />
    </VizFrame>
  );
}
