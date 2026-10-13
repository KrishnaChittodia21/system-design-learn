import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DB_POOL, STRATEGY_LABELS, simulate, type CacheState, type Params, type Strategy } from './sim';

const CACHE_STYLE: Record<CacheState, { fill: string; stroke: string; label: string }> = {
  fresh: { fill: 'var(--good-soft)', stroke: 'var(--good)', label: 'FRESH' },
  stale: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', label: 'STALE' },
  refreshing: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', label: 'LOADING' },
  expired: { fill: 'var(--bad-soft)', stroke: 'var(--bad)', label: 'MISSING' },
};

const C = { hit: 'var(--good)', stale: 'var(--warn)', wait: 'var(--accent)', miss: 'var(--bad)' };

export default function CacheStampedeViz() {
  const [params, setParams] = useState<Params>({ strategy: 'none', rps: 20, recompute: 3 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const final = frames[frames.length - 1];
  const T = f.ticks;
  const E = f.expireAt;

  // chart geometry
  const X0 = 40;
  const W = 550;
  const cw = W / T;
  const reqTop = 138;
  const reqH = 56;
  const dbTop = 222;
  const dbH = 70;
  const dbMax = Math.max(DB_POOL * 1.25, ...final.history.map((h) => h.dbInflight));
  const cur = f.tick >= 0 ? f.history[f.tick] : undefined;
  const cs = CACHE_STYLE[f.cache];
  const poolY = dbTop + dbH - (DB_POOL / dbMax) * dbH;
  const worst = Math.max(0, ...f.history.map((h) => h.maxLatency));
  const inflightNow = cur?.dbInflight ?? 0;

  const options: { value: Strategy; label: string }[] = (Object.keys(STRATEGY_LABELS) as Strategy[]).map((k) => ({
    value: k,
    label: STRATEGY_LABELS[k],
  }));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice label="Strategy" value={params.strategy} options={options} onChange={(v) => setParams((p) => ({ ...p, strategy: v }))} />
          <Slider label="Concurrent requests" value={params.rps} min={4} max={40} step={2} onChange={(v) => setParams((p) => ({ ...p, rps: v }))} format={(v) => `${v}/tick`} />
          <Slider label="Recompute time Δ" value={params.recompute} min={1} max={5} onChange={(v) => setParams((p) => ({ ...p, recompute: v }))} format={(v) => `${v} tick${v > 1 ? 's' : ''}`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: C.hit }} /> cache hit
          <span className="viz-key" style={{ background: C.stale }} /> served stale
          <span className="viz-key" style={{ background: C.wait }} /> waiting on lock
          <span className="viz-key" style={{ background: C.miss }} /> recompute on DB (user waits Δ)
        </>
      }
    >
      <svg
        viewBox="0 0 600 330"
        className="viz-svg"
        role="img"
        aria-label={`Strategy ${STRATEGY_LABELS[params.strategy]}. ${f.tick < 0 ? 'Before start' : `Tick ${f.tick}`}: cache ${cs.label.toLowerCase()}, ${inflightNow} DB queries in flight, ${f.totalDb} started in total.`}
      >
        <defs>
          <marker id="cs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>

        {/* flow: clients → cache → DB */}
        <rect x={10} y={22} width={130} height={62} rx={10} fill="var(--surface-2)" stroke="var(--border)" strokeWidth={2} />
        <text x={75} y={48} textAnchor="middle" className="viz-node-label">
          Clients
        </text>
        <text x={75} y={68} textAnchor="middle" className="viz-label">
          {params.rps} req / tick
        </text>
        <line x1={142} y1={53} x2={226} y2={53} className="viz-edge" markerEnd="url(#cs-arrow)" />
        {cur && (
          <text x={184} y={44} textAnchor="middle" className="viz-label">
            {cur.hits + cur.stale} served now
          </text>
        )}

        <rect x={230} y={22} width={140} height={62} rx={10} fill={cs.fill} stroke={cs.stroke} strokeWidth={3} style={{ transition: 'fill .3s, stroke .3s' }} />
        <text x={300} y={46} textAnchor="middle" className="viz-node-label">
          Cache: {cs.label}
        </text>
        <text x={300} y={66} textAnchor="middle" className="viz-label">
          {params.strategy === 'swr' ? `soft TTL t=${E}` : `expires t=${E}`}
        </text>

        <line x1={372} y1={53} x2={456} y2={53} className="viz-edge" markerEnd="url(#cs-arrow)" />
        {cur && cur.dbStarted > 0 && (
          <text x={414} y={44} textAnchor="middle" className="viz-label" style={{ fill: 'var(--bad)' }}>
            +{cur.dbStarted} quer{cur.dbStarted === 1 ? 'y' : 'ies'}
          </text>
        )}

        <rect
          x={460}
          y={22}
          width={130}
          height={62}
          rx={10}
          fill={inflightNow > DB_POOL ? 'var(--bad-soft)' : 'var(--surface-2)'}
          stroke={inflightNow > DB_POOL ? 'var(--bad)' : inflightNow > 0 ? 'var(--warn)' : 'var(--border)'}
          strokeWidth={inflightNow > 0 ? 3 : 2}
          style={{ transition: 'fill .3s, stroke .3s' }}
        />
        <text x={525} y={46} textAnchor="middle" className="viz-node-label">
          DB
        </text>
        <text x={525} y={66} textAnchor="middle" className="viz-label">
          {inflightNow} in flight / pool {DB_POOL}
        </text>

        <text x={10} y={112} className="viz-label">
          DB queries started: <tspan style={{ fontWeight: 700, fill: f.totalDb > 1 ? 'var(--bad)' : 'var(--text)' }}>{f.totalDb}</tspan> · peak in flight: {f.peakInflight} · worst user wait: {worst} tick{worst === 1 ? '' : 's'} · stale responses: {f.totalStale}
        </text>

        {/* chart 1: request outcomes per tick */}
        <text x={X0} y={reqTop - 6} className="viz-label">
          requests per tick
        </text>
        {/* chart 2 label */}
        <text x={X0} y={dbTop - 6} className="viz-label">
          DB queries in flight
        </text>
        <line x1={X0} y1={poolY} x2={X0 + W} y2={poolY} stroke="var(--bad)" strokeDasharray="5 4" strokeWidth={1.2} />
        <text x={X0 + W} y={poolY - 4} textAnchor="end" className="viz-label">
          DB pool {DB_POOL}
        </text>
        <line x1={X0} y1={dbTop + dbH} x2={X0 + W} y2={dbTop + dbH} stroke="var(--border)" />
        <line x1={X0} y1={reqTop + reqH} x2={X0 + W} y2={reqTop + reqH} stroke="var(--border)" />

        {/* expiry marker */}
        <line x1={X0 + E * cw} y1={reqTop - 2} x2={X0 + E * cw} y2={dbTop + dbH + 4} stroke="var(--muted)" strokeDasharray="2 3" />
        <text x={X0 + E * cw} y={dbTop + dbH + 18} textAnchor="middle" className="viz-label">
          {params.strategy === 'swr' ? 'soft expiry' : 'expiry'}
        </text>

        {Array.from({ length: T }, (_, t) => {
          const h = f.history[t];
          const x = X0 + t * cw + 1;
          const w = Math.max(2, cw - 2);
          if (!h) {
            return <rect key={t} x={x} y={reqTop + reqH - 2} width={w} height={2} fill="var(--border)" />;
          }
          const parts: [number, string][] = [
            [h.hits, C.hit],
            [h.stale, C.stale],
            [h.waits, C.wait],
            [h.misses, C.miss],
          ];
          let y = reqTop + reqH;
          const dbh = (h.dbInflight / dbMax) * dbH;
          const isCur = t === f.tick || (t >= f.from && t <= f.tick);
          return (
            <g key={t}>
              {isCur && <rect x={X0 + t * cw} y={reqTop - 2} width={cw} height={dbTop + dbH - reqTop + 4} fill="var(--accent-soft)" />}
              {parts.map(([n, color], k) => {
                const hh = (n / params.rps) * reqH;
                y -= hh;
                return n > 0 ? <rect key={k} x={x} y={y} width={w} height={hh} fill={color} /> : null;
              })}
              {h.dbInflight > 0 && (
                <rect x={x} y={dbTop + dbH - dbh} width={w} height={dbh} fill={h.dbInflight > DB_POOL ? 'var(--bad)' : 'var(--warn)'} />
              )}
            </g>
          );
        })}
        {[0, Math.floor(T / 2), T - 1].map((t) => (
          <text key={t} x={X0 + t * cw + cw / 2} y={dbTop + dbH + 18} textAnchor="middle" className="viz-label">
            {Math.abs(t - E) > 2 ? `t=${t}` : ''}
          </text>
        ))}
      </svg>
    </VizFrame>
  );
}
