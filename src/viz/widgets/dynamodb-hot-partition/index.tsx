import { useState } from 'react';
import { Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { PART_WCU, partitionOf, simulate, wcuPerWrite, type Params } from './sim';

const L = 30;
const R = 510;
const halo = { paintOrder: 'stroke' as const, stroke: 'var(--surface-2)', strokeWidth: 3, strokeLinejoin: 'round' as const };

export default function DynamoHotPartitionViz() {
  const [params, setParams] = useState<Params>({ viral: 1500, itemKB: 1, shards: 4 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  const hx = (h: number) => L + h * (R - L);
  const HL = 46; // hash line y
  // bars
  const n = f.parts.length;
  const slot = (R - L) / n;
  const bw = Math.min(64, slot - 18);
  const BT = 112;
  const BB = 262;
  const yMax = PART_WCU * 2;
  const by = (v: number) => BB - (Math.min(v, yMax) / yMax) * (BB - BT);
  const partLabel = (i: number) => {
    const p = f.parts[i];
    if (p.isolated) return 'hot key';
    return `P${f.parts.slice(0, i + 1).filter((x) => !x.isolated).length}`;
  };
  const hotKeys = f.keys.filter((k) => k.hot);

  const aria =
    `${n} partitions, table ${f.usedWcu} of ${f.tableWcu} WCU used, ${Math.round(f.throttled)} WCU per second throttled. ` +
    f.loads.map((l, i) => `${partLabel(i)}: ${Math.round(l.demand)} WCU demand${l.throttled > 0 ? `, ${Math.round(l.throttled)} throttled` : ''}`).join('; ');

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Viral item writes/s" value={params.viral} min={200} max={1800} step={100} onChange={set('viral')} format={(v) => v.toLocaleString('en-US')} />
          <Slider label="Viral item size" value={params.itemKB} min={1} max={4} step={0.5} onChange={set('itemKB')} format={(v) => `${v} KB = ${wcuPerWrite(v)} WCU/write`} />
          <Slider label="Write shards (fix)" value={params.shards} min={2} max={10} onChange={set('shards')} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> user keys
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> viral key / its shards
          <span className="viz-key" style={{ background: 'var(--good)' }} /> served WCU
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> throttled WCU
        </>
      }
    >
      <svg viewBox="0 0 520 322" className="viz-svg" role="img" aria-label={aria}>
        <text x={L} y={16} fontSize={10.5} className="viz-label">
          hash(partition key) → [0, 1), each range is one partition
        </text>
        {/* partition ranges on the hash line */}
        {f.parts.map((p, i) =>
          p.isolated ? null : (
            <g key={i}>
              <rect x={hx(p.lo)} y={HL - 12} width={hx(p.hi) - hx(p.lo)} height={24} fill={i % 2 ? 'var(--tint)' : 'var(--tint-2)'} stroke="var(--border)" />
              <text x={(hx(p.lo) + hx(p.hi)) / 2} y={HL + 26} textAnchor="middle" fontSize={10} fontWeight={600}>
                {partLabel(i)}
              </text>
            </g>
          ),
        )}
        {f.parts.some((p) => p.isolated) && (
          <g>
            {(() => {
              const p = f.parts.find((x) => x.isolated)!;
              return <rect x={hx(p.lo) - 5} y={HL - 15} width={10} height={30} rx={3} fill="none" stroke="var(--warn)" strokeWidth={2} />;
            })()}
          </g>
        )}
        {f.keys
          .filter((k) => !k.hot)
          .map((k) => (
            <circle key={k.key} cx={hx(k.h)} cy={HL} r={3} fill="var(--accent)" opacity={k.wcu > 0 ? 0.9 : 0.4} />
          ))}
        {hotKeys.map((k, i) => (
          <g key={k.key}>
            <circle cx={hx(k.h)} cy={HL} r={hotKeys.length > 1 ? 5 : 7} fill="var(--warn)" stroke="var(--surface)" strokeWidth={1.5} />
            {hotKeys.length === 1 && (
              <text x={hx(k.h)} y={HL - 17} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: 'var(--warn)', ...halo }}>
                {k.key}
              </text>
            )}
            {hotKeys.length > 1 && i === 0 && (
              <text x={L} y={HL - 17} fontSize={10} fontWeight={700} style={{ fill: 'var(--warn)', ...halo }}>
                {hotKeys.length} shard keys: #0…#{hotKeys.length - 1}
              </text>
            )}
          </g>
        ))}

        {/* per-partition WCU bars */}
        <text x={L} y={BT - 14} fontSize={10.5} className="viz-label">
          write demand per partition (WCU/s)
        </text>
        <line x1={L} x2={R} y1={by(PART_WCU)} y2={by(PART_WCU)} stroke="var(--bad)" strokeDasharray="6 4" />
        <text x={L} y={by(PART_WCU) - 4} fontSize={10} fontWeight={700} style={{ fill: 'var(--bad)', ...halo }}>
          1,000 WCU per-partition max
        </text>
        <line x1={L} x2={R} y1={BB} y2={BB} stroke="var(--border)" />
        {f.loads.map((l, i) => {
          const cx = L + slot * i + slot / 2;
          const p = f.parts[i];
          const servedTop = by(l.served);
          const overflow = l.demand > yMax;
          const hotHere = f.keys.some((k) => k.hot && partitionOf(f.parts, k.h) === i);
          return (
            <g key={i}>
              <rect x={cx - bw / 2} y={servedTop} width={bw} height={BB - servedTop} rx={3} fill="var(--good)" opacity={0.85} style={{ transition: 'y .35s, height .35s' }} />
              {l.throttled > 0 && (
                <rect x={cx - bw / 2} y={by(l.demand)} width={bw} height={by(l.served) - by(l.demand)} rx={3} fill="var(--bad)" opacity={0.75} style={{ transition: 'y .35s, height .35s' }} />
              )}
              <text x={cx} y={by(l.demand) - 5} textAnchor="middle" fontSize={10.5} fontWeight={700} style={{ fill: l.throttled > 0 ? 'var(--bad)' : 'var(--text)', ...halo }}>
                {Math.round(l.demand).toLocaleString('en-US')}
                {overflow ? ' ↑' : ''}
              </text>
              <text x={cx} y={BB + 14} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: p.isolated ? 'var(--warn)' : 'var(--text)' }}>
                {partLabel(i)}
              </text>
              <text x={cx} y={BB + 26} textAnchor="middle" fontSize={9} className="viz-label">
                {hotHere ? 'hot' : `${l.keys} keys`}
              </text>
            </g>
          );
        })}
        <text x={L} y={316} fontSize={11} fontWeight={700} style={{ fill: f.throttled > 0 ? 'var(--bad)' : 'var(--good)' }}>
          table {f.usedWcu.toLocaleString('en-US')}/{f.tableWcu.toLocaleString('en-US')} WCU used · {f.throttled > 0 ? `${Math.round(f.throttled).toLocaleString('en-US')} WCU/s throttled` : 'no throttling'}
          {f.burstSeconds ? ` · burst covers ~${Math.round(f.burstSeconds)} s` : ''}
        </text>
      </svg>
    </VizFrame>
  );
}
