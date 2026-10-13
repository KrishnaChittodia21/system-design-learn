import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { LOGICAL, simulate, type Params, type Strategy, type Workload } from './sim';

export default function ShardingHotspotsViz() {
  const [params, setParams] = useState<Params>({ strategy: 'hash', workload: 'celebrity', shards: 4, skew: 40 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  // logical shard strip
  const cellW = 560 / LOGICAL;
  const maxSlot = Math.max(1, ...f.slotLoad);
  // node bars
  const maxNodes = params.shards + 1;
  const barSlot = 560 / maxNodes;
  const barW = Math.min(46, barSlot - 14);
  const BAR_TOP = 132;
  const BAR_H = 128;
  const total = Math.max(1, f.totalOps);
  const fair = 1 / f.nodes;
  const scaleMax = Math.max(fair * 2.2, ...f.nodeLoad.map((l) => l / total));
  const yOf = (share: number) => BAR_TOP + BAR_H - (share / scaleMax) * BAR_H;
  const slotsPerNode = Array.from({ length: f.nodes }, (_, n) => f.slotNode.filter((x) => x === n).length);
  const isNew = (n: number) => n === params.shards;
  const hotLabel = params.workload === 'celebrity' ? (f.salted ? 'salted key' : 'celebrity key') : f.salted ? 'prefixed ids' : 'insert tail';

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Strategy>
            label="Shard by"
            value={params.strategy}
            options={[
              { value: 'hash', label: 'hash(key)' },
              { value: 'range', label: 'key range' },
            ]}
            onChange={set('strategy')}
          />
          <Choice<Workload>
            label="Workload"
            value={params.workload}
            options={[
              { value: 'celebrity', label: 'celebrity key' },
              { value: 'time', label: 'time-ordered inserts' },
            ]}
            onChange={set('workload')}
          />
          <Slider label="Shard nodes" value={params.shards} min={3} max={8} onChange={set('shards')} />
          <Slider label={params.workload === 'celebrity' ? 'Skew (ops on hot key)' : 'Skew (new inserts)'} value={params.skew} min={0} max={80} step={10} onChange={set('skew')} format={(v) => `${v}%`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> logical-shard heat (ops)
          <span className="viz-key" style={{ background: 'var(--good)' }} /> node near fair share
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> busy node
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> new node / shard being moved
        </>
      }
    >
      <svg
        viewBox="0 0 600 330"
        className="viz-svg"
        role="img"
        aria-label={`${params.strategy} sharding, ${f.nodes} nodes. Node load shares: ${f.nodeLoad.map((l, n) => `N${n + 1} ${Math.round((100 * l) / total)}%`).join(', ')}.${f.moving.length ? ` Moving ${f.moving.length} logical shard(s), ${f.movedRows} rows.` : ''}`}
      >
        <text x={20} y={16} className="viz-label">
          {LOGICAL} logical shards (cell = heat, label = owning node)
        </text>
        {f.slotLoad.map((load, s) => {
          const x = 20 + s * cellW;
          const moving = f.moving.includes(s);
          const heat = f.totalOps ? load / maxSlot : 0;
          const isHot = s === f.hotSlot && !f.salted && f.phase !== 'intro';
          return (
            <g key={s}>
              <rect x={x + 1} y={24} width={cellW - 2} height={40} rx={5} fill="var(--surface-2)" stroke={moving ? 'var(--accent)' : 'var(--border)'} strokeWidth={moving ? 3 : 1} strokeDasharray={moving ? '4 3' : undefined} />
              <rect x={x + 1} y={24} width={cellW - 2} height={40} rx={5} fill="var(--bad)" fillOpacity={0.08 + 0.75 * heat} style={{ transition: 'fill-opacity .3s' }} />
              <text x={x + cellW / 2} y={41} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700 }}>
                L{s + 1}
              </text>
              <text x={x + cellW / 2} y={57} textAnchor="middle" style={{ fontSize: 10, fill: isNew(f.slotNode[s]) ? 'var(--accent)' : 'var(--text-2)', fontWeight: isNew(f.slotNode[s]) ? 700 : 400 }}>
                N{f.slotNode[s] + 1}
              </text>
              {isHot && (
                <text x={x + cellW / 2} y={80} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--bad)', fontWeight: 700 }}>
                  ▲ {hotLabel}
                </text>
              )}
            </g>
          );
        })}

        <text x={20} y={112} className="viz-label">
          load per physical node (share of ops)
        </text>
        {/* fair share line */}
        {f.totalOps > 0 && (
          <g>
            <line x1={20} y1={yOf(fair)} x2={580} y2={yOf(fair)} stroke="var(--muted)" strokeDasharray="5 4" />
            <text x={22} y={yOf(fair) - 4} className="viz-label">
              fair share {Math.round(fair * 100)}%
            </text>
          </g>
        )}
        <line x1={20} y1={BAR_TOP + BAR_H} x2={580} y2={BAR_TOP + BAR_H} stroke="var(--border)" />
        {Array.from({ length: maxNodes }, (_, n) => {
          const cx = 20 + barSlot * n + barSlot / 2;
          const present = n < f.nodes;
          const share = present ? f.nodeLoad[n] / total : 0;
          const ratio = share / fair;
          const color = ratio > 1.6 ? 'var(--bad)' : ratio > 1.25 ? 'var(--warn)' : 'var(--good)';
          const top = yOf(share);
          return (
            <g key={n} opacity={present ? 1 : 0.35}>
              <rect
                x={cx - barW / 2}
                y={top}
                width={barW}
                height={BAR_TOP + BAR_H - top}
                rx={4}
                fill={color}
                stroke={isNew(n) && present ? 'var(--accent)' : 'none'}
                strokeWidth={3}
                style={{ transition: 'y .35s, height .35s, fill .35s' }}
              />
              {present && f.totalOps > 0 && (
                <text x={cx} y={top - 5} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700 }}>
                  {Math.round(share * 100)}%
                </text>
              )}
              <text x={cx} y={BAR_TOP + BAR_H + 16} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: isNew(n) ? 'var(--accent)' : 'var(--text)' }}>
                N{n + 1}
                {isNew(n) ? ' (new)' : ''}
              </text>
              <text x={cx} y={BAR_TOP + BAR_H + 30} textAnchor="middle" className="viz-label">
                {present ? `${slotsPerNode[n]} shard${slotsPerNode[n] === 1 ? '' : 's'}` : 'not yet'}
              </text>
            </g>
          );
        })}

        <text x={20} y={322} className="viz-label">
          {f.totalOps} ops · {f.totalRows.toLocaleString('en-US')} rows
          {f.moving.length > 0 ? ` · moving ${f.movedRows.toLocaleString('en-US')} rows (${Math.round((100 * f.movedRows) / f.totalRows)}%)` : ''}
          {f.phase === 'plan' || f.phase === 'copy' || f.phase === 'cutover' ? ` · naive rehash would move ${f.naiveMovePct}%` : ''}
        </text>
      </svg>
    </VizFrame>
  );
}
