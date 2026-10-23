import { useState, type ReactNode } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { saleBuyers, simulateSale, type SaleParams } from './sim';
import { stroke } from './tones';

const NODES: NodeDef[] = [
  { id: 'browsers', label: 'Browsers', sub: 'humans + bots', x: 2, y: 20, w: 88, h: 44 },
  { id: 'cdn', label: 'CDN / WAF', sub: 'token check', x: 104, y: 20, w: 88, h: 44 },
  { id: 'api', label: 'API pods', sub: 'sold-out flag', x: 206, y: 20, w: 88, h: 44 },
  { id: 'redis', label: 'Redis gate', sub: 'Lua per bucket', x: 308, y: 20, w: 88, h: 44 },
  { id: 'kafka', label: 'Kafka', sub: 'key = sku', x: 410, y: 20, w: 88, h: 44 },
  { id: 'workers', label: 'Order workers', sub: 'claim a row', x: 512, y: 20, w: 86, h: 44 },
];
const DB: NodeDef = { id: 'db', label: 'Postgres', sub: 'unit rows', x: 512, y: 80, w: 86, h: 34 };
const ON_OFF = [
  { value: 'on' as const, label: 'On' },
  { value: 'off' as const, label: 'Off' },
];

export default function SaleView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<SaleParams>({ stock: 24, buckets: 4, failover: true, sweeper: false });
  const frames = useSimulation(simulateSale, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const nodes: Record<string, NodeDef> = Object.fromEntries([...NODES, DB].map((n) => [n.id, n]));
  const t = f.tally;
  const sold = f.units.filter(Boolean).length;
  const per = Math.ceil(params.stock / params.buckets);

  // bucket bars
  const bucketList = [...f.buckets.map((v, i) => ({ name: `b${i}`, v })), ...(f.tail !== null ? [{ name: 'tail', v: f.tail }] : [])];
  const BAR_AREA = { x: 18, y: 152, w: 270, h: 92 };
  const bw = Math.min(40, (BAR_AREA.w - 8 * (bucketList.length - 1)) / bucketList.length);
  const maxV = Math.max(per, ...bucketList.map((b) => b.v), 1);

  // unit rows grid
  const cols = 8;
  const cell = 28;
  const gx = 318;
  const gy = 154;

  const aria = `Flash sale step ${stepper.i + 1}: ${sold} of ${params.stock} units sold, ${t.reserved} gate winners, ${t.apologies} apologies, ${t.blockedAtCdn} bots blocked, oversold ${Math.max(0, sold - params.stock)}.`;

  return (
    <VizFrame
      title="Flash sale: admission, bucketed gate and unit rows"
      blurb="Buyers arrive in waves. Change stock and bucket count, fail the Redis primary over mid-sale, and turn on the tail-bucket sweeper. Watch the sold counter: it never exceeds the stock."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Slider label="Stock (units)" value={params.stock} min={12} max={32} step={4} onChange={(stock) => setParams((p) => ({ ...p, stock }))} />
          <Slider label="Redis buckets" value={params.buckets} min={1} max={6} onChange={(buckets) => setParams((p) => ({ ...p, buckets }))} />
          <Choice<'on' | 'off'> label="Redis failover mid-sale" value={params.failover ? 'on' : 'off'} options={ON_OFF} onChange={(v) => setParams((p) => ({ ...p, failover: v === 'on' }))} />
          <Choice<'on' | 'off'> label="Tail-bucket sweeper" value={params.sweeper ? 'on' : 'off'} options={ON_OFF} onChange={(v) => setParams((p) => ({ ...p, sweeper: v === 'on' }))} />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> request / stock in a bucket
          <Key tone="good" /> unit row claimed
          <Key tone="warn" /> sold-out flag
          <Key tone="bad" /> blocked / failover
        </>
      }
    >
      <svg viewBox="0 0 600 356" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        {NODES.slice(1).map((n, i) => (
          <Edge key={n.id} a={NODES[i]} b={n} dashed />
        ))}
        <Edge a={nodes.workers} b={DB} dashed />
        {[...NODES, DB].map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} dim={Object.keys(f.active).length > 0 && !f.active[n.id]} badge={n.id === 'redis' && f.failedOver ? 'failed over' : n.id === 'api' && f.soldOutFlag ? 'SOLD OUT' : undefined} badgeTone={n.id === 'redis' ? 'bad' : 'warn'} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} labelDy={e.from === 'workers' ? 0 : 26} packet k={`${stepper.i}-${k}`} />
        ))}

        {/* buckets */}
        <Panel x={8} y={122} w={292} h={146} title={`Redis buckets (stock left: ${f.buckets.reduce((a, b) => a + b, 0) + (f.tail ?? 0)})`} tone={f.failedOver ? 'bad' : undefined}>
          {bucketList.map((b, i) => {
            const x = BAR_AREA.x + i * (bw + 8);
            const h = (b.v / maxV) * BAR_AREA.h;
            return (
              <g key={b.name}>
                <rect x={x} y={BAR_AREA.y} width={bw} height={BAR_AREA.h} rx={4} fill="var(--tint)" stroke="var(--line)" />
                <rect x={x} y={BAR_AREA.y + BAR_AREA.h - h} width={bw} height={h} rx={4} fill={b.name === 'tail' ? 'var(--good)' : 'var(--blue)'} opacity={0.85} style={{ transition: 'all 0.35s ease' }} />
                <text x={x + bw / 2} y={BAR_AREA.y + BAR_AREA.h - h - 4} textAnchor="middle" fontSize={10.5} fontWeight={800}>
                  {b.v}
                </text>
                <text x={x + bw / 2} y={BAR_AREA.y + BAR_AREA.h + 13} textAnchor="middle" fontSize={10} className="csf-muted">
                  {b.name}
                </text>
              </g>
            );
          })}
        </Panel>

        {/* unit rows */}
        <Panel x={308} y={122} w={284} h={146} title={`Postgres unit rows: ${sold}/${params.stock} claimed`}>
          {f.units.map((u, i) => {
            const x = gx + (i % cols) * (cell + 5);
            const y = gy + Math.floor(i / cols) * (cell - 2);
            return (
              <g key={i}>
                <rect x={x} y={y} width={cell} height={cell - 6} rx={4} fill={u ? 'var(--good-soft)' : 'var(--surface-2)'} stroke={u ? 'var(--good)' : 'var(--line-2)'} strokeWidth={1.2} style={{ transition: 'fill 0.3s ease' }} />
                <text x={x + cell / 2} y={y + 15} textAnchor="middle" fontSize={9} fontWeight={700} style={{ fill: u ? 'var(--ink)' : 'var(--ink-4)' }}>
                  {u || '·'}
                </text>
              </g>
            );
          })}
        </Panel>

        {/* tally */}
        {[
          { label: 'bots blocked at CDN', v: t.blockedAtCdn, tone: 'bad' as const },
          { label: 'gate winners (202)', v: t.reserved, tone: 'accent' as const },
          { label: 'retries deduped', v: t.retriesDeduped, tone: 'accent' as const },
          { label: 'sold out (Redis / flag)', v: `${t.soldOutRedis} / ${t.soldOutFlag}`, tone: 'warn' as const },
          { label: 'stranded "sold out"', v: t.stranded, tone: t.stranded ? ('bad' as const) : ('muted' as const) },
          { label: 'apologies', v: t.apologies, tone: t.apologies ? ('warn' as const) : ('muted' as const) },
          { label: 'OVERSOLD', v: Math.max(0, sold - params.stock), tone: 'good' as const },
        ].map((s, k) => {
          const col = k % 4;
          const row = Math.floor(k / 4);
          const x = 8 + col * 148;
          const y = 276 + row * 40;
          return (
            <g key={s.label}>
              <rect x={x} y={y} width={140} height={34} rx={8} fill="var(--surface)" stroke={s.tone === 'muted' ? 'var(--line)' : stroke(s.tone)} strokeWidth={1.2} />
              <text x={x + 10} y={y + 15} fontSize={13} fontWeight={800}>
                {s.v}
              </text>
              <text x={x + 10} y={y + 28} fontSize={9.5} className="csf-muted">
                {s.label}
              </text>
            </g>
          );
        })}
        <Pill x={588} y={336} text={`${saleBuyers(params.stock)} humans in waves of 4`} tone="muted" anchor="end" size={9.5} />
      </svg>
    </VizFrame>
  );
}
