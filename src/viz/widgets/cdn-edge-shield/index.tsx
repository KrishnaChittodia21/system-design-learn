import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import {
  EVENT_AT,
  EVENT_LABELS,
  OUTAGE_END,
  REGIONS,
  SWR_WINDOW,
  simulate,
  type CacheState,
  type CacheView,
  type Event,
  type Outcome,
  type Params,
} from './sim';

const OUT_COLOR: Record<Outcome, string> = {
  hit: 'var(--good)',
  stale: 'var(--warn)',
  shield: 'var(--blue)',
  origin: 'var(--bad)',
  error: 'var(--bad)',
};
const OUT_SHORT: Record<Outcome, string> = { hit: 'HIT', stale: 'STALE', shield: 'SHIELD', origin: 'ORIGIN', error: '502' };
const STATE_STYLE: Record<CacheState, { fill: string; stroke: string; label: string }> = {
  empty: { fill: 'var(--surface)', stroke: 'var(--border-strong)', label: 'empty' },
  fresh: { fill: 'var(--good-soft)', stroke: 'var(--good)', label: 'fresh' },
  stale: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', label: 'stale (SWR)' },
  expired: { fill: 'var(--bad-soft)', stroke: 'var(--bad)', label: 'expired' },
};

const ROW0 = 40;
const ROW_H = 62;
const BOX_H = 48;
const rowMid = (k: number) => ROW0 + k * ROW_H + BOX_H / 2;

function CacheBox({ x, y, w, cv, ttl, title, dim }: { x: number; y: number; w: number; cv: CacheView; ttl: number; title: string; dim?: boolean }) {
  const s = STATE_STYLE[cv.state];
  const frac = cv.age === null ? 0 : Math.min(1, cv.age / ttl);
  return (
    <g opacity={dim ? 0.4 : 1}>
      <rect x={x} y={y} width={w} height={BOX_H} rx={9} fill={s.fill} stroke={s.stroke} strokeWidth={2} style={{ transition: 'fill .3s, stroke .3s' }} />
      <text x={x + 8} y={y + 17} style={{ fontSize: 12, fontWeight: 700 }}>
        {title}
      </text>
      <text x={x + w - 8} y={y + 17} textAnchor="end" style={{ fontSize: 11, fontWeight: 700, fill: s.stroke }}>
        {cv.version === null ? 'empty' : `v${cv.version}`}
      </text>
      <text x={x + 8} y={y + 33} className="viz-label" style={{ fontSize: 11 }}>
        {cv.age === null ? 'no copy' : `Age ${cv.age}s · ${s.label}`}
      </text>
      <rect x={x + 8} y={y + 38} width={w - 16} height={4} rx={2} fill="var(--border)" />
      {cv.age !== null && <rect x={x + 8} y={y + 38} width={(w - 16) * frac} height={4} rx={2} fill={s.stroke} />}
    </g>
  );
}

export default function CdnEdgeShieldViz() {
  const [params, setParams] = useState<Params>({ ttl: 40, shield: true, stale: false, event: 'deploy' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const SH = { x: 368, y: ROW0 + 34, w: 104 };
  const OR = { x: 498, y: ROW0 + 60, w: 94, h: 100 };
  const shieldMidY = SH.y + BOX_H / 2;
  const originMidY = OR.y + OR.h / 2;
  const ratio = f.total ? Math.round((f.edgeHits / f.total) * 100) : 0;
  const reqFor = (id: string) => f.reqs.find((q) => q.region === id);
  const shieldUsed = f.reqs.some((q) => q.outcome === 'origin' || q.outcome === 'shield' || q.bgRefresh || q.outcome === 'error');
  const originUsed = f.reqs.some((q) => q.originFetch);
  const outageNote = params.event === 'outage' ? ` (t=${EVENT_AT}–${OUTAGE_END}s)` : ` at t=${EVENT_AT}s`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="max-age (TTL)" value={params.ttl} min={10} max={120} step={10} onChange={(v) => setParams((p) => ({ ...p, ttl: v }))} format={(v) => `${v} s`} />
          <Choice<'on' | 'off'> label="Origin shield" value={params.shield ? 'on' : 'off'} options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]} onChange={(v) => setParams((p) => ({ ...p, shield: v === 'on' }))} />
          <Choice<'on' | 'off'>
            label={`stale-while-revalidate=${SWR_WINDOW} + stale-if-error`}
            value={params.stale ? 'on' : 'off'}
            options={[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]}
            onChange={(v) => setParams((p) => ({ ...p, stale: v === 'on' }))}
          />
          <Choice<Event>
            label={`At t=${EVENT_AT}s`}
            value={params.event}
            options={(Object.keys(EVENT_LABELS) as Event[]).map((k) => ({ value: k, label: EVENT_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, event: v }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: OUT_COLOR.hit }} /> edge hit
          <span className="viz-key" style={{ background: OUT_COLOR.shield }} /> filled from shield
          <span className="viz-key" style={{ background: OUT_COLOR.origin }} /> went to origin / error
          <span className="viz-key" style={{ background: OUT_COLOR.stale }} /> served stale
          <span>bar = Age / max-age</span>
        </>
      }
    >
      <svg
        viewBox="0 0 600 352"
        className="viz-svg"
        role="img"
        aria-label={`${f.t === null ? 'Before start' : `t=${f.t} seconds`}. Origin ${f.originDown ? 'down' : `serving v${f.originVersion}`}. ${f.total} requests, ${ratio}% edge hits, ${f.originFetches} origin fetches, ${f.errors} errors.`}
      >
        <defs>
          <marker id="cdn-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        <text x={8} y={18} className="viz-label">
          users
        </text>
        <text x={150} y={18} className="viz-label">
          nearest edge PoP
        </text>
        <text x={SH.x} y={18} className="viz-label">
          origin region (Virginia)
        </text>
        <text x={592} y={18} textAnchor="end" style={{ fontSize: 12, fontWeight: 700, fill: 'var(--text-2)' }}>
          {f.t === null ? 't = –' : `t = ${f.t}s`}
        </text>

        {REGIONS.map((r, k) => {
          const y = ROW0 + k * ROW_H;
          const q = reqFor(r.id);
          const col = q ? OUT_COLOR[q.outcome] : 'var(--border)';
          const goesUp = q && q.outcome !== 'hit' && (q.outcome !== 'stale' || q.bgRefresh || f.originDown);
          const upTarget = params.shield ? { x: SH.x, y: shieldMidY } : { x: OR.x, y: originMidY };
          return (
            <g key={r.id}>
              {/* user box */}
              <rect x={8} y={y} width={112} height={BOX_H} rx={9} fill="var(--surface)" stroke={q ? col : 'var(--border)'} strokeWidth={q ? 2.5 : 1.5} />
              <text x={16} y={y + 18} style={{ fontSize: 12, fontWeight: 700 }}>
                {r.city}
              </text>
              <text x={16} y={y + 36} style={{ fontSize: 11, fontWeight: q ? 700 : 400, fill: q ? col : 'var(--muted)' }}>
                {q ? `${OUT_SHORT[q.outcome]} ${q.latency >= 1000 ? `${q.latency / 1000}s` : `${q.latency} ms`}` : `every ${r.every}s`}
              </text>
              {/* user → PoP */}
              <line x1={120} y1={rowMid(k)} x2={148} y2={rowMid(k)} stroke={q ? col : 'var(--border)'} strokeWidth={q ? 3 : 1.5} markerEnd="url(#cdn-arrow)" />
              <text x={133} y={rowMid(k) - 9} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
                {r.userRtt}
              </text>
              <CacheBox x={150} y={y} w={150} cv={f.pops[r.id]} ttl={params.ttl} title={`PoP ${r.id.toUpperCase()}`} />
              {/* PoP → upstream */}
              <line
                x1={300}
                y1={rowMid(k)}
                x2={upTarget.x - 2}
                y2={upTarget.y + (k - 1.5) * 8}
                stroke={goesUp ? col : 'var(--border)'}
                strokeWidth={goesUp ? 2.5 : 1.2}
                strokeDasharray={goesUp ? undefined : '4 4'}
              />
              <text x={306} y={rowMid(k) + (k === 0 ? -6 : 15)} className="viz-label" style={{ fontSize: 10 }}>
                {r.longHaul} ms
              </text>
            </g>
          );
        })}

        {/* shield */}
        {params.shield ? (
          <CacheBox x={SH.x} y={SH.y} w={SH.w} cv={f.shieldCache} ttl={params.ttl} title="Shield" />
        ) : (
          <g opacity={0.5}>
            <rect x={SH.x} y={SH.y} width={SH.w} height={BOX_H} rx={9} fill="none" stroke="var(--border-strong)" strokeDasharray="5 4" />
            <text x={SH.x + SH.w / 2} y={SH.y + 29} textAnchor="middle" className="viz-label">
              no shield
            </text>
          </g>
        )}
        {params.shield && (
          <line
            x1={SH.x + SH.w}
            y1={shieldMidY}
            x2={OR.x - 2}
            y2={originMidY}
            stroke={shieldUsed && originUsed ? 'var(--bad)' : 'var(--border)'}
            strokeWidth={shieldUsed && originUsed ? 2.5 : 1.2}
            markerEnd="url(#cdn-arrow)"
          />
        )}

        {/* origin */}
        <rect x={OR.x} y={OR.y} width={OR.w} height={OR.h} rx={10} fill={f.originDown ? 'var(--bad-soft)' : 'var(--surface)'} stroke={f.originDown ? 'var(--bad)' : originUsed ? 'var(--bad)' : 'var(--border-strong)'} strokeWidth={2} />
        <text x={OR.x + OR.w / 2} y={OR.y + 22} textAnchor="middle" className="viz-node-label">
          Origin
        </text>
        <text x={OR.x + OR.w / 2} y={OR.y + 42} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: f.originDown ? 'var(--bad)' : 'var(--text)' }}>
          {f.originDown ? '5xx' : `serves v${f.originVersion}`}
        </text>
        <text x={OR.x + OR.w / 2} y={OR.y + 62} textAnchor="middle" className="viz-label">
          fetches: {f.originFetches}
        </text>
        <text x={OR.x + OR.w / 2} y={OR.y + 80} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
          +80 ms work
        </text>

        {/* metrics */}
        <line x1={8} y1={ROW0 + 4 * ROW_H - 4} x2={592} y2={ROW0 + 4 * ROW_H - 4} stroke="var(--border)" />
        <text x={8} y={ROW0 + 4 * ROW_H + 16} className="viz-label">
          requests <tspan style={{ fontWeight: 700, fill: 'var(--text)' }}>{f.total}</tspan> · edge hit ratio{' '}
          <tspan style={{ fontWeight: 700, fill: 'var(--good)' }}>{ratio}%</tspan> · origin fetches{' '}
          <tspan style={{ fontWeight: 700, fill: f.originFetches ? 'var(--bad)' : 'var(--text)' }}>{f.originFetches}</tspan> · stale served {f.staleServed} · errors{' '}
          <tspan style={{ fontWeight: 700, fill: f.errors ? 'var(--bad)' : 'var(--text)' }}>{f.errors}</tspan>
        </text>
        <text x={8} y={ROW0 + 4 * ROW_H + 36} className="viz-label">
          avg TTFB:{' '}
          {REGIONS.map((r, k) => (
            <tspan key={r.id}>
              {k ? ' · ' : ''}
              {r.city} {f.latencyCount[r.id] ? `${Math.round(f.latencySum[r.id] / f.latencyCount[r.id])} ms` : '–'}
            </tspan>
          ))}
        </text>
        <text x={8} y={ROW0 + 4 * ROW_H + 56} className="viz-label">
          old version served after deploy:{' '}
          <tspan style={{ fontWeight: 700, fill: f.oldVersionServed ? 'var(--warn)' : 'var(--text)' }}>{f.oldVersionServed}</tspan> · event: {EVENT_LABELS[params.event]}
          {outageNote}
        </text>
      </svg>
    </VizFrame>
  );
}
