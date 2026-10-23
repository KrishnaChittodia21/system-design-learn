import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, DEMAND, LIMIT, REGIONS, RTT_TO_CENTRAL, SECONDS, simulate, type Design, type Params } from './sim';

const COL_W = 186;
const colX = (i: number) => 8 + i * 196;
const BAR_W = 150;
const CH_X = 60;
const CH_W = 520;
const CH_TOP = 206;
const CH_BOT = 292;
const CH_MAX = 130;
const cy = (v: number) => CH_BOT - (v / CH_MAX) * (CH_BOT - CH_TOP);

export default function GlobalQuotaLeasingViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const total = f.regions ? f.regions.reduce((a, r) => a + r.admitted, 0) : 0;
  const barW = CH_W / SECONDS - 14;

  const aria = `${f.second < 0 ? 'Before traffic.' : f.second >= SECONDS ? 'Summary.' : `Second ${f.second}:`} ${
    f.regions ? f.regions.map((r, i) => `${REGIONS[i]} admitted ${r.admitted} of ${r.demand}`).join(', ') : ''
  }. Per-second global admissions: ${f.history.join(', ') || 'none yet'} against a limit of ${LIMIT}.`;

  const centre =
    params.design === 'central'
      ? `central counter in us-east: ${f.regions ? total : 0}/${LIMIT} this second${f.latency ? ` · avg +${f.latency} ms per request` : ''}`
      : params.design === 'static'
        ? `static split: 33 / 33 / 34 per second, no coordination`
        : `coordinator: ${f.granted}/${LIMIT} tokens leased this window · batches of ${params.batch}`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Design>
            label="Design"
            value={params.design}
            options={[
              { value: 'central', label: 'Central counter' },
              { value: 'static', label: 'Static split' },
              { value: 'leasing', label: 'Local buckets + leases' },
            ]}
            onChange={(design) => setParams((p) => ({ ...p, design }))}
          />
          <Slider label="Traffic in the busiest region" value={params.skew} min={40} max={90} step={10} onChange={(skew) => setParams((p) => ({ ...p, skew }))} format={(v) => `${v}%`} />
          {params.design === 'leasing' && <Slider label="Lease batch size" value={params.batch} min={5} max={30} step={5} onChange={(batch) => setParams((p) => ({ ...p, batch }))} format={(v) => `${v} tokens`} />}
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> admitted
          <span className="viz-key" style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad)' }} /> rejected (429)
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> leased tokens held locally
          <span>dashed line = global limit {LIMIT}/s</span>
        </>
      }
    >
      <svg viewBox="0 0 600 308" className="viz-svg" role="img" aria-label={aria}>
        <rect x={110} y={4} width={380} height={26} rx={13} fill="var(--accent-soft)" stroke="var(--accent)" />
        <text x={300} y={21} textAnchor="middle" fontSize={11} fontWeight={700}>
          {centre}
        </text>

        {REGIONS.map((name, i) => {
          const x = colX(i);
          const r = f.regions?.[i];
          const busy = r && r.demand === Math.max(...f.regions!.map((q) => q.demand));
          const scale = BAR_W / DEMAND;
          return (
            <g key={name}>
              {params.design !== 'static' && <line x1={x + COL_W / 2} y1={30} x2={x + COL_W / 2} y2={42} stroke="var(--accent)" strokeDasharray={params.design === 'leasing' ? '3 3' : undefined} strokeWidth={1.5} />}
              <rect x={x} y={42} width={COL_W} height={140} rx={8} fill="var(--surface-2)" stroke={busy ? 'var(--warn)' : 'var(--border)'} strokeWidth={busy ? 2 : 1.2} />
              <text x={x + 10} y={60} fontSize={12} fontWeight={700}>
                {name}
              </text>
              <text x={x + COL_W - 10} y={60} textAnchor="end" fontSize={10} style={{ fill: params.design === 'central' && RTT_TO_CENTRAL[i] > 10 ? 'var(--bad)' : 'var(--text-2)' }}>
                {params.design === 'central' ? `+${RTT_TO_CENTRAL[i]} ms/req` : 'local check ~50 µs'}
              </text>
              <text x={x + 10} y={80} className="viz-label" style={{ fontSize: 10.5 }}>
                demand {r ? `${r.demand}/s` : '—'}
                {busy ? ' · busiest' : ''}
              </text>
              <rect x={x + 10} y={88} width={BAR_W} height={16} rx={3} fill="var(--surface)" stroke="var(--border)" />
              {r && (
                <>
                  <rect x={x + 10} y={88} width={r.admitted * scale} height={16} rx={3} fill="var(--good)" style={{ transition: 'width 0.3s ease' }} />
                  <rect x={x + 10 + r.admitted * scale} y={88} width={r.rejected * scale} height={16} fill="var(--bad-soft)" stroke="var(--bad)" strokeWidth={0.8} style={{ transition: 'width 0.3s ease, x 0.3s ease' }} />
                </>
              )}
              <text x={x + 10} y={122} fontSize={11}>
                admitted <tspan fontWeight={700} style={{ fill: 'var(--good)' }}>{r?.admitted ?? '—'}</tspan> · rejected{' '}
                <tspan fontWeight={700} style={{ fill: r?.rejected ? 'var(--bad)' : 'var(--text)' }}>
                  {r?.rejected ?? '—'}
                </tspan>
              </text>
              {params.design === 'leasing' && r && (
                <>
                  <text x={x + 10} y={142} className="viz-label" style={{ fontSize: 10.5 }}>
                    {r.leases} lease{r.leases === 1 ? '' : 's'} · {r.tokens} token{r.tokens === 1 ? '' : 's'} left over
                  </text>
                  {Array.from({ length: Math.min(30, r.tokens) }, (_, k) => (
                    <circle key={k} cx={x + 14 + (k % 15) * 11} cy={156 + Math.floor(k / 15) * 11} r={4} fill="var(--accent)" />
                  ))}
                </>
              )}
              {params.design === 'static' && r && (
                <text x={x + 10} y={142} fontSize={10.5} style={{ fill: r.rejected && r.admitted < LIMIT / 3 + 1 ? 'var(--bad)' : 'var(--text-2)' }}>
                  {r.demand < LIMIT / 3 ? `${Math.ceil(LIMIT / 3) - r.admitted} of its share unused` : 'capped at its fixed share'}
                </text>
              )}
              {params.design === 'central' && r && (
                <text x={x + 10} y={142} className="viz-label" style={{ fontSize: 10.5 }}>
                  {i === 0 ? 'counter is local here' : 'every check crosses the ocean'}
                </text>
              )}
            </g>
          );
        })}

        {/* per-second global chart */}
        <text x={8} y={200} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          global admitted / s
        </text>
        <line x1={CH_X} y1={CH_BOT} x2={CH_X + CH_W} y2={CH_BOT} stroke="var(--border)" />
        {[0, 50, 100].map((v) => (
          <text key={v} x={CH_X - 6} y={cy(v) + 3} textAnchor="end" fontSize={9} style={{ fill: 'var(--muted)' }}>
            {v}
          </text>
        ))}
        {Array.from({ length: SECONDS }, (_, s) => {
          const v = f.history[s];
          const x = CH_X + s * (CH_W / SECONDS) + 7;
          const over = v !== undefined && v > LIMIT;
          const under = v !== undefined && v < LIMIT - 5;
          return (
            <g key={s}>
              {v !== undefined && (
                <rect x={x} y={cy(v)} width={barW} height={CH_BOT - cy(v)} rx={3} fill={over ? 'var(--bad)' : under ? 'var(--warn-soft)' : 'var(--good)'} stroke={under ? 'var(--warn)' : 'none'} style={{ transition: 'y 0.3s ease, height 0.3s ease' }} />
              )}
              {v !== undefined && (
                <text x={x + barW / 2} y={cy(v) - 4} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: over ? 'var(--bad)' : under ? 'var(--warn)' : 'var(--text)' }}>
                  {v}
                </text>
              )}
              <text x={x + barW / 2} y={CH_BOT + 10} textAnchor="middle" fontSize={8.5} style={{ fill: s === f.second ? 'var(--accent)' : 'var(--muted)' }} fontWeight={s === f.second ? 700 : 400}>
                {s}s{s === 3 ? ' shift' : ''}
              </text>
            </g>
          );
        })}
        <line x1={CH_X} y1={cy(LIMIT)} x2={CH_X + CH_W} y2={cy(LIMIT)} stroke="var(--text-2)" strokeDasharray="5 3" strokeWidth={1.4} />
      </svg>
    </VizFrame>
  );
}
