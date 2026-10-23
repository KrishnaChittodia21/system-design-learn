import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DELTA, EXPECTED, START_BALANCE, STRATEGY_LABELS, simulate, type ClientId, type Outcome, type Params, type Strategy } from './sim';

const CLIENT_COLOR: Record<ClientId, string> = { A: 'var(--blue)', B: 'var(--mag)' };
const OUT: Record<Outcome, { fill: string; stroke: string }> = {
  ok: { fill: 'var(--surface)', stroke: 'var(--border-strong)' },
  lost: { fill: 'var(--bad-soft)', stroke: 'var(--bad)' },
  fail: { fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
  wait: { fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
};

const X0 = 76;
const X1 = 592;
const LANE: Record<ClientId, number> = { A: 34, B: 170 };
const DB_Y = 104;

export default function LostUpdateRaceViz() {
  const [params, setParams] = useState<Params>({ strategy: 'naive', offset: 1 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const final = frames[frames.length - 1];
  const cols = Math.max(6, final.t + 1);
  const cw = (X1 - X0) / cols;
  const lastDb = f.dbHistory.at(-1);

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Strategy>
            label="Strategy"
            value={params.strategy}
            options={(Object.keys(STRATEGY_LABELS) as Strategy[]).map((k) => ({ value: k, label: STRATEGY_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, strategy: v }))}
          />
          <Slider label="B starts after A by" value={params.offset} min={0} max={3} onChange={(v) => setParams((p) => ({ ...p, offset: v }))} format={(v) => `${v} tick${v === 1 ? '' : 's'}`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: CLIENT_COLOR.A }} /> request A (+{DELTA.A})
          <span className="viz-key" style={{ background: CLIENT_COLOR.B }} /> request B (+{DELTA.B})
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> lost update
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> CAS failed / blocked
        </>
      }
    >
      <svg
        viewBox="0 0 600 262"
        className="viz-svg"
        role="img"
        aria-label={`${f.t < 0 ? 'Before start' : `Tick ${f.t}`}. Balance ${f.value}, version ${f.version}${f.lock ? `, row locked by ${f.lock}` : ''}. Expected final balance ${EXPECTED}. Lost updates: ${f.lostUpdates}.`}
      >
        {/* column grid */}
        {Array.from({ length: cols }, (_, t) => (
          <g key={t}>
            <rect x={X0 + t * cw} y={22} width={cw} height={210} fill={t === f.t ? 'var(--surface)' : 'none'} opacity={0.8} />
            <text x={X0 + t * cw + cw / 2} y={16} textAnchor="middle" className="viz-label" style={{ fontSize: 10.5 }}>
              t{t}
            </text>
          </g>
        ))}

        {/* lane labels */}
        {(['A', 'B'] as ClientId[]).map((id) => {
          const c = f.clients[id];
          return (
            <g key={id}>
              <text x={8} y={LANE[id] + 22} style={{ fontSize: 13, fontWeight: 800, fill: CLIENT_COLOR[id] }}>
                req {id}
              </text>
              <text x={8} y={LANE[id] + 38} className="viz-label" style={{ fontSize: 10.5 }}>
                +{DELTA[id]}
                {c.done ? ' · done' : c.waiting ? ' · blocked' : ''}
              </text>
              {c.retries > 0 && (
                <text x={8} y={LANE[id] + 52} style={{ fontSize: 10, fontWeight: 700, fill: 'var(--warn)' }}>
                  {c.retries} retr{c.retries === 1 ? 'y' : 'ies'}
                </text>
              )}
            </g>
          );
        })}
        <text x={8} y={DB_Y + 22} style={{ fontSize: 13, fontWeight: 800 }}>
          DB row
        </text>
        <text x={8} y={DB_Y + 38} className="viz-label" style={{ fontSize: 10.5 }}>
          balance
        </text>

        {/* op cells */}
        {f.cells.map((c, k) => {
          const st = OUT[c.outcome];
          const x = X0 + c.t * cw + 3;
          const y = LANE[c.client];
          return (
            <g key={k}>
              <rect x={x} y={y} width={cw - 6} height={50} rx={7} fill={st.fill} stroke={c.outcome === 'ok' ? CLIENT_COLOR[c.client] : st.stroke} strokeWidth={c.t === f.t ? 2.5 : 1.3} />
              <text x={x + (cw - 6) / 2} y={y + 21} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700 }}>
                {c.label}
              </text>
              <text x={x + (cw - 6) / 2} y={y + 38} textAnchor="middle" style={{ fontSize: 11, fontFamily: 'var(--f-mono)', fill: c.outcome === 'ok' ? 'var(--text-2)' : st.stroke }}>
                {c.detail}
              </text>
              {/* arrows to the DB row for reads and writes */}
              {(c.label === 'read' || c.label === 'lock+read') && (
                <line x1={x + (cw - 6) / 2} y1={DB_Y + (c.client === 'A' ? 0 : 50)} x2={x + (cw - 6) / 2} y2={c.client === 'A' ? y + 50 : y} stroke={CLIENT_COLOR[c.client]} strokeDasharray="3 3" />
              )}
              {(c.label === 'write' || c.label.startsWith('+') || (c.label.startsWith('CAS') && c.outcome === 'ok')) && (
                <line x1={x + (cw - 6) / 2} y1={c.client === 'A' ? y + 50 : y} x2={x + (cw - 6) / 2} y2={DB_Y + (c.client === 'A' ? 0 : 50)} stroke={c.outcome === 'lost' ? 'var(--bad)' : CLIENT_COLOR[c.client]} strokeWidth={2} />
              )}
            </g>
          );
        })}

        {/* DB row values per tick */}
        {f.dbHistory.map((d, k) => {
          const prev = k ? f.dbHistory[k - 1].value : START_BALANCE;
          const changed = d.value !== prev;
          const x = X0 + d.t * cw + 3;
          return (
            <g key={d.t}>
              <rect x={x} y={DB_Y} width={cw - 6} height={50} rx={7} fill={changed ? 'var(--good-soft)' : 'var(--surface)'} stroke={d.lock ? CLIENT_COLOR[d.lock] : 'var(--border)'} strokeWidth={d.lock ? 2 : 1} strokeDasharray={d.lock ? '5 3' : undefined} />
              <text x={x + (cw - 6) / 2} y={DB_Y + 24} textAnchor="middle" style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--f-mono)' }}>
                {d.value}
              </text>
              <text x={x + (cw - 6) / 2} y={DB_Y + 41} textAnchor="middle" className="viz-label" style={{ fontSize: 9.5 }}>
                {params.strategy === 'cas' ? `v${d.version}` : d.lock ? `lock ${d.lock}` : ''}
              </text>
            </g>
          );
        })}

        <text x={8} y={254} className="viz-label">
          balance now <tspan style={{ fontWeight: 800, fill: 'var(--text)' }}>{lastDb ? lastDb.value : START_BALANCE}</tspan> · expected{' '}
          <tspan style={{ fontWeight: 800, fill: 'var(--text)' }}>{EXPECTED}</tspan>
          {f.done && (
            <tspan style={{ fontWeight: 800, fill: f.value === EXPECTED ? 'var(--good)' : 'var(--bad)' }}>{f.value === EXPECTED ? ' · correct' : ` · ${EXPECTED - f.value} lost, no error raised`}</tspan>
          )}
        </text>
      </svg>
    </VizFrame>
  );
}
