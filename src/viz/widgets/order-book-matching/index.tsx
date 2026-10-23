import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, PRICES, simulate, type BuyType, type Order, type Params } from './sim';

const MID = 300;
const SCALE = 0.55;
const rowY = (p: number) => 78 + PRICES.indexOf(p) * 34;
const ROW_H = 28;

export default function OrderBookViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const inc = f.incoming;
  const bestBid = f.bids[0]?.price;
  const bestAsk = f.asks[0]?.price;

  const chips = (orders: Order[], side: 'buy' | 'sell') =>
    PRICES.map((p) => {
      let off = 0;
      return orders
        .filter((o) => o.price === p)
        .map((o) => {
          const w = Math.max(18, o.qty * SCALE);
          const x = side === 'buy' ? MID - 32 - off - w : MID + 32 + off;
          off += w + 3;
          const hit = f.hit === o.id;
          const rested = f.rested === o.id;
          const tone = hit ? 'accent' : rested ? 'warn' : side === 'buy' ? 'good' : 'bad';
          return (
            <g key={o.id}>
              <rect x={x} y={rowY(p) + 3} width={w} height={ROW_H - 6} rx={4} fill={hit || rested ? `var(--${tone})` : `var(--${tone}-soft)`} stroke={`var(--${tone})`} strokeWidth={hit || rested ? 2 : 1} style={{ transition: 'width 0.3s ease, x 0.3s ease' }} />
              <text x={x + w / 2} y={rowY(p) + 18} textAnchor="middle" fontSize={w > 44 ? 10 : 9} fontWeight={700} style={{ fill: hit || rested ? 'var(--surface)' : 'var(--text)' }}>
                {w > 44 ? `${o.id} ${o.qty}` : o.id}
              </text>
            </g>
          );
        });
    });

  const aria = `Bids: ${f.bids.map((o) => `${o.id} ${o.qty}@${o.price}`).join(', ') || 'none'}. Asks: ${f.asks.map((o) => `${o.id} ${o.qty}@${o.price}`).join(', ') || 'none'}. ${f.trades.length} trades.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Aggressive buy size" value={params.buyQty} min={100} max={900} step={50} onChange={(buyQty) => setParams((p) => ({ ...p, buyQty }))} />
          <Choice<BuyType>
            label="Buy order type"
            value={params.buyType}
            options={[
              { value: 'limit', label: 'Limit 102' },
              { value: 'market', label: 'Market' },
            ]}
            onChange={(buyType) => setParams((p) => ({ ...p, buyType }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good-soft)', border: '1px solid var(--good)' }} /> resting buy
          <span className="viz-key" style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad)' }} /> resting sell
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> maker being filled
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> remainder just rested
          <span>chips nearest the price arrived first</span>
        </>
      }
    >
      <svg viewBox="0 0 600 330" className="viz-svg" role="img" aria-label={aria}>
        {/* incoming */}
        <rect x={8} y={6} width={300} height={46} rx={8} fill={inc ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke={inc ? 'var(--accent)' : 'var(--border)'} strokeWidth={inc ? 2 : 1.2} />
        <text x={16} y={23} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          incoming order
        </text>
        {inc ? (
          <>
            <text x={16} y={42} fontSize={12} fontWeight={700} style={{ fill: inc.side === 'buy' ? 'var(--good)' : 'var(--bad)' }}>
              {inc.id}: {inc.side.toUpperCase()} {inc.price === null ? 'MARKET' : `limit ${inc.price}`} × {inc.qty}
            </text>
            <rect x={210} y={33} width={90} height={10} rx={3} fill="var(--surface)" stroke="var(--border)" />
            <rect x={210} y={33} width={(90 * (inc.qty - inc.left)) / inc.qty} height={10} rx={3} fill="var(--accent)" style={{ transition: 'width 0.3s ease' }} />
            <text x={300} y={23} textAnchor="end" fontSize={10} style={{ fill: f.cancelled === inc.id ? 'var(--bad)' : 'var(--text-2)' }}>
              {f.cancelled === inc.id ? `${inc.left} cancelled` : `${inc.qty - inc.left} filled · ${inc.left} left`}
            </text>
          </>
        ) : (
          <text x={16} y={42} fontSize={11} style={{ fill: 'var(--muted)' }}>
            {f.cancelled ? `cancel ${f.cancelled}` : 'none'}
          </text>
        )}
        <text x={592} y={23} textAnchor="end" fontSize={11} fontWeight={700}>
          spread {bestBid ?? '—'} / {bestAsk ?? '—'}
        </text>
        <text x={592} y={42} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
          L1: best bid / best ask
        </text>

        {/* ladder */}
        <text x={MID - 36} y={70} textAnchor="end" fontSize={10.5} fontWeight={700} style={{ fill: 'var(--good)' }}>
          ← bids (buy), FIFO
        </text>
        <text x={MID} y={70} textAnchor="middle" fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          price
        </text>
        <text x={MID + 36} y={70} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--bad)' }}>
          asks (sell), FIFO →
        </text>
        {PRICES.map((p) => {
          const best = p === bestBid || p === bestAsk;
          return (
            <g key={p}>
              <rect x={8} y={rowY(p)} width={584} height={ROW_H} rx={4} fill={best ? 'var(--surface-2)' : 'none'} stroke="var(--border)" strokeWidth={0.6} />
              <rect x={MID - 26} y={rowY(p) + 2} width={52} height={ROW_H - 4} rx={5} fill="var(--surface)" stroke={best ? 'var(--accent)' : 'var(--border)'} strokeWidth={best ? 1.8 : 1} />
              <text x={MID} y={rowY(p) + 18} textAnchor="middle" fontSize={12} fontWeight={700}>
                {p}
              </text>
            </g>
          );
        })}
        {chips(f.bids, 'buy')}
        {chips(f.asks, 'sell')}

        {/* trade tape */}
        <text x={8} y={268} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          trade tape (price = maker's price)
        </text>
        {f.trades.length === 0 && (
          <text x={8} y={288} fontSize={10.5} style={{ fill: 'var(--muted)' }}>
            no trades yet
          </text>
        )}
        {f.trades.slice(-8).map((t, i) => {
          const x = 8 + (i % 4) * 148;
          const y = 288 + Math.floor(i / 4) * 20;
          const latest = i === Math.min(7, f.trades.length - 1) && f.hit === t.maker;
          return (
            <text key={i} x={x} y={y} fontSize={10.5} fontWeight={latest ? 800 : 500} style={{ fill: latest ? 'var(--accent)' : 'var(--text)' }}>
              {t.qty} @ {t.price} <tspan style={{ fill: 'var(--text-2)' }}>({t.buy}←{t.sell})</tspan>
            </text>
          );
        })}
      </svg>
    </VizFrame>
  );
}
