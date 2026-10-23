import { useState } from 'react';
import { Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { BULKHEAD, DEADLINE_MS, FIX_AT, FIX_LABELS, PAY_MS, RECOVER_AT, SLOW_AT, TICKS, TICK_S, simulate, type BreakerState, type FixId, type Params } from './sim';
import { fmtMs, fmtNum, fmtPct, toneFor } from '../prod-perf-incident-lab/kit/queue';
import { SeriesLegend, TimeChart, Tiles, Toggles } from '../prod-perf-incident-lab/kit/ui';

const CHECKOUT = 'var(--accent)';
const HOME = 'var(--ink-3)';
const FIX_ORDER: FixId[] = ['timeout', 'bulkhead', 'breaker', 'scale'];

const BREAKER_STYLE: Record<BreakerState, { fill: string; stroke: string; label: string }> = {
  off: { fill: 'var(--surface)', stroke: 'var(--line-2)', label: 'no breaker' },
  closed: { fill: 'var(--good-soft)', stroke: 'var(--good)', label: 'CLOSED' },
  open: { fill: 'var(--bad-soft)', stroke: 'var(--bad)', label: 'OPEN' },
  'half-open': { fill: 'var(--warn-soft)', stroke: 'var(--warn)', label: 'HALF-OPEN' },
};

export default function ProdCascadeLab() {
  const [params, setParams] = useState<Params>({ fixes: [], slowMs: 4000 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const t = f.tick;
  // before the run starts, show the healthy baseline (t = 0)
  const shown = t >= 0 ? f : frames[1];
  const s = shown.sockets;

  const cols = s.total > 50 ? 20 : 10;
  const rows = Math.ceil(s.total / cols);
  const GX = 128;
  const GY = 54;
  const GW = 236;
  const GH = 96;
  const cw = GW / cols;
  const ch = GH / rows;
  const recsN = Math.round(s.recs);
  const payN = Math.round(s.pay);
  const compartment = s.bulkhead ? BULKHEAD * (s.total > 50 ? 2 : 1) : 0;
  const cellFill = (i: number) => {
    if (s.bulkhead) {
      if (i < compartment) return i < recsN ? 'var(--warn)' : 'var(--tint-2)';
      return i - compartment < payN ? 'var(--good)' : 'var(--tint-2)';
    }
    if (i < recsN) return 'var(--warn)';
    if (i < recsN + payN) return 'var(--good)';
    return 'var(--tint-2)';
  };
  const br = BREAKER_STYLE[f.breaker];
  const recsState = t < 0 ? 'healthy · 40 ms' : f.recsSlow ? `SLOW · ${fmtMs(params.slowMs)}` : 'healthy · 40 ms';

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider
            label="Recommendations latency while slow"
            value={params.slowMs}
            min={500}
            max={8000}
            step={500}
            format={fmtMs}
            onChange={(slowMs) => setParams((p) => ({ ...p, slowMs }))}
          />
          <Toggles<FixId>
            label={`Mitigations (live at ${FIX_AT * TICK_S} s)`}
            options={FIX_ORDER.map((x) => ({ value: x, label: FIX_LABELS[x] }))}
            value={params.fixes}
            onChange={(fixes) => setParams((p) => ({ ...p, fixes: FIX_ORDER.filter((x) => fixes.includes(x)) }))}
          />
        </>
      }
      legend={
        <SeriesLegend
          series={[
            { label: '/checkout p99', color: CHECKOUT },
            { label: '/home p99', color: HOME, dash: true },
          ]}
          extra={
            <>
              <span className="pil-leg">
                <span className="pil-swatch" style={{ background: 'var(--bad)' }} aria-hidden />
                /checkout error rate
              </span>
              <span className="pil-leg">
                <span className="pil-swatch" style={{ background: 'var(--warn)' }} aria-hidden />
                socket held by a recs call
              </span>
              <span className="pil-leg">
                <span className="pil-swatch" style={{ background: 'var(--good)' }} aria-hidden />
                socket held by a payments call
              </span>
            </>
          }
        />
      }
    >
      <Tiles
        label={t < 0 ? 'Healthy baseline before the run starts' : `Metrics at ${t * TICK_S} seconds`}
        tiles={[
          { label: '/checkout p99', value: shown.checkout ? fmtMs(shown.checkout.p99) : '–', tone: shown.checkout ? toneFor(shown.checkout.p99, 300, 1000) : 'neutral' },
          { label: '/checkout err', value: shown.checkout ? fmtPct(shown.checkout.err) : '–', tone: shown.checkout ? toneFor(shown.checkout.err, 0.001, 0.01) : 'neutral', sub: 'never calls recs' },
          { label: '/home p99', value: shown.home ? fmtMs(shown.home.p99) : '–', tone: shown.home ? toneFor(shown.home.p99, 300, 1000) : 'neutral' },
          {
            label: '/home err',
            value: shown.home ? fmtPct(shown.home.err) : '–',
            tone: shown.home ? (shown.home.degraded && shown.home.err < 0.01 ? 'warn' : toneFor(shown.home.err, 0.001, 0.01)) : 'neutral',
            sub: shown.home?.degraded ? 'fallback: no recs' : undefined,
          },
          { label: 'sockets busy', value: `${Math.round(s.recs + s.pay)}/${s.total}`, tone: toneFor((s.recs + s.pay) / s.total, 0.8, 0.98), sub: s.waiting >= 1 ? `${fmtNum(s.waiting)} waiting` : undefined },
        ]}
      />
      <svg viewBox="0 0 600 200" className="viz-svg" role="img" aria-label={`Recommendations ${f.recsSlow ? 'slow' : 'healthy'}; ${Math.round(s.recs)} sockets held by recommendations calls and ${Math.round(s.pay)} by payments, of ${s.total}; breaker ${br.label}.`}>
        <defs>
          <marker id="pcl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-4)" />
          </marker>
        </defs>
        {/* gateway */}
        <rect x={6} y={74} width={88} height={52} rx={10} fill="var(--surface)" stroke="var(--line-2)" strokeWidth={1.5} />
        <text x={50} y={96} textAnchor="middle" fontSize={12} fontWeight={700}>
          gateway
        </text>
        <text x={50} y={113} textAnchor="middle" fontSize={10} className="viz-label">
          deadline {DEADLINE_MS / 1000} s
        </text>
        <line x1={96} y1={100} x2={110} y2={100} stroke="var(--ink-4)" strokeWidth={1.5} markerEnd="url(#pcl-arrow)" />
        {/* the pod and its socket pool */}
        <rect x={114} y={14} width={264} height={176} rx={12} fill="var(--surface)" stroke="var(--line-2)" strokeWidth={1.5} />
        <text x={124} y={32} fontSize={12} fontWeight={700}>
          orders-api pod
        </text>
        <text x={368} y={32} textAnchor="end" fontSize={10} className="viz-label">
          {s.bulkhead ? 'two pools (bulkhead)' : 'one shared socket pool'}
        </text>
        {Array.from({ length: s.total }, (_, i) => (
          <rect
            key={i}
            x={GX + (i % cols) * cw + 1}
            y={GY + Math.floor(i / cols) * ch + 1}
            width={cw - 2}
            height={ch - 2}
            rx={2}
            fill={cellFill(i)}
            style={{ transition: 'fill 0.3s ease' }}
          />
        ))}
        {s.bulkhead && (
          <rect x={GX - 2} y={GY - 2} width={GW + 4} height={(compartment / cols) * ch + 4} rx={4} fill="none" stroke="var(--warn)" strokeWidth={2} strokeDasharray="4 3" />
        )}
        <text x={GX} y={GY + GH + 18} fontSize={11} className="viz-label">
          {s.waiting >= 1 ? `${fmtNum(s.waiting)} requests waiting for a socket` : 'no one waiting for a socket'}
        </text>
        <text x={GX} y={GY + GH + 33} fontSize={10.5} className="viz-label">
          {s.bulkhead ? `recs compartment: ${compartment} sockets (dashed)` : 'any route can take any socket'}
        </text>
        {/* edges + breaker */}
        <line x1={380} y1={70} x2={436} y2={56} stroke="var(--ink-4)" strokeWidth={1.5} markerEnd="url(#pcl-arrow)" />
        <line x1={380} y1={140} x2={436} y2={150} stroke="var(--ink-4)" strokeWidth={1.5} markerEnd="url(#pcl-arrow)" />
        <g>
          <rect x={381} y={84} width={57} height={20} rx={10} fill={br.fill} stroke={br.stroke} strokeWidth={1.5} style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }} />
          <text x={409.5} y={98} textAnchor="middle" fontSize={8.5} fontWeight={700}>
            {br.label}
          </text>
        </g>
        {/* dependencies */}
        <rect
          x={440}
          y={24}
          width={154}
          height={58}
          rx={10}
          fill={f.recsSlow ? 'var(--bad-soft)' : 'var(--good-soft)'}
          stroke={f.recsSlow ? 'var(--bad)' : 'var(--good)'}
          strokeWidth={2}
          style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
        />
        <text x={517} y={47} textAnchor="middle" fontSize={12} fontWeight={700}>
          recommendations
        </text>
        <text x={517} y={66} textAnchor="middle" fontSize={11} style={{ fill: f.recsSlow ? 'var(--bad)' : 'var(--good)' }}>
          {recsState}
        </text>
        <rect x={440} y={122} width={154} height={58} rx={10} fill="var(--good-soft)" stroke="var(--good)" strokeWidth={2} />
        <text x={517} y={145} textAnchor="middle" fontSize={12} fontWeight={700}>
          payments
        </text>
        <text x={517} y={164} textAnchor="middle" fontSize={11} style={{ fill: 'var(--good)' }}>
          healthy · {PAY_MS} ms
        </text>
      </svg>
      <TimeChart
        ticks={TICKS}
        cur={t}
        tickLabel={(k) => `${k * TICK_S}s`}
        series={[
          { key: 'checkout', label: '/checkout p99', color: CHECKOUT, values: f.checkoutP99 },
          { key: 'home', label: '/home p99', color: HOME, values: f.homeP99, dash: '5 4' },
        ]}
        errors={f.checkoutErr}
        markers={[
          { tick: SLOW_AT, label: 'recs slow', color: 'var(--warn)' },
          { tick: FIX_AT, label: params.fixes.length ? 'fix live' : 'no fix', color: params.fixes.length ? 'var(--good)' : 'var(--ink-4)' },
          { tick: RECOVER_AT, label: 'recs ok', color: 'var(--ink-3)' },
        ]}
        ariaLabel={
          t >= 0 && shown.checkout && shown.home
            ? `At ${t * TICK_S} s: checkout p99 ${fmtMs(shown.checkout.p99)}, errors ${fmtPct(shown.checkout.err)}; home p99 ${fmtMs(shown.home.p99)}, errors ${fmtPct(shown.home.err)}.`
            : 'Latency timeline, not started.'
        }
      />
    </VizFrame>
  );
}
