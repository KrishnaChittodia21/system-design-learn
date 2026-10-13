import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, simulate, type Params, type Pattern, type Result } from './sim';

const BOX_H = 40;
const LIST_Y = 104;
const FLOAT_Y = 36;
const MAP_Y = 206;

const RESULT_STYLE: Record<Result, { label: string; color: string }> = {
  hit: { label: 'HIT', color: 'var(--good)' },
  miss: { label: 'MISS', color: 'var(--bad)' },
  insert: { label: 'INSERT', color: 'var(--accent)' },
  update: { label: 'UPDATE', color: 'var(--accent)' },
  evict: { label: 'EVICT', color: 'var(--bad)' },
  move: { label: 'UNLINK', color: 'var(--warn)' },
  start: { label: 'START', color: 'var(--muted)' },
  done: { label: 'DONE', color: 'var(--muted)' },
};

export default function LruCacheViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;

  const slots = params.capacity + 2;
  const slotW = 580 / slots;
  const boxW = Math.min(64, slotW - 26);
  const slotX = (s: number) => 10 + s * slotW + (slotW - boxW) / 2;
  const tailSlot = params.capacity + 1;
  // x positions of HEAD, each list node, TAIL
  const chain = [
    { name: 'HEAD', x: slotX(0), sentinel: true },
    ...f.list.map((e, i) => ({ name: e.key, x: slotX(i + 1), sentinel: false })),
    { name: 'TAIL', x: slotX(tailSlot), sentinel: true },
  ];
  const nodeX: Record<string, number> = {};
  f.list.forEach((e, i) => (nodeX[e.key] = slotX(i + 1)));
  if (f.floating) nodeX[f.floating.entry.key] = slotX(f.floating.fromIndex + 1);
  const rs = RESULT_STYLE[f.result];
  const total = f.hits + f.misses;
  const writeLines = [f.writes.slice(0, 3), f.writes.slice(3)].filter((l) => l.length);
  const mapSpacing = Math.min(64, 580 / Math.max(1, f.mapKeys.length));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Capacity" value={params.capacity} min={2} max={5} onChange={(v) => setParams((p) => ({ ...p, capacity: v }))} />
          <Choice<Pattern>
            label="Access pattern"
            value={params.pattern}
            options={[
              { value: 'recency', label: 'Recency-friendly' },
              { value: 'scan', label: 'One-off scan' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, pattern: v }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> just moved to MRU
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> unlinked, being moved
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> evicted
          <span className="viz-key" style={{ background: 'var(--muted)' }} /> sentinel
        </>
      }
    >
      <svg
        viewBox="0 0 600 312"
        className="viz-svg"
        role="img"
        aria-label={`LRU list from most to least recent: ${f.list.map((e) => e.key).join(', ') || 'empty'}. ${f.hits} hits, ${f.misses} misses.`}
      >
        <defs>
          <marker id="lru-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {/* header: operation + result */}
        <text x={10} y={20} className="viz-node-label" style={{ fontFamily: 'var(--mono)' }}>
          {f.op}
        </text>
        <rect x={10} y={26} width={64} height={18} rx={9} fill={rs.color} opacity={0.18} />
        <text x={42} y={39} textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: rs.color }}>
          {rs.label}
        </text>
        <text x={590} y={20} textAnchor="end" className="viz-label">
          hits {f.hits} · misses {f.misses}
          {total ? ` · hit ratio ${Math.round((f.hits / total) * 100)}%` : ''}
        </text>
        <text x={590} y={38} textAnchor="end" className="viz-label">
          size {f.list.length}/{params.capacity}
        </text>
        <text x={slotX(1)} y={LIST_Y - 8} className="viz-label">
          MRU ←
        </text>
        <text x={slotX(tailSlot) + boxW} y={LIST_Y - 8} textAnchor="end" className="viz-label">
          → LRU
        </text>

        {/* next / prev pointers between neighbours */}
        {chain.slice(0, -1).map((a, i) => {
          const b = chain[i + 1];
          return (
            <g key={`ptr-${a.name}-${b.name}`}>
              <line x1={a.x + boxW} y1={LIST_Y + 13} x2={b.x - 2} y2={LIST_Y + 13} stroke="var(--muted)" strokeWidth={1.5} markerEnd="url(#lru-arrow)" />
              <line x1={b.x} y1={LIST_Y + 27} x2={a.x + boxW + 2} y2={LIST_Y + 27} stroke="var(--muted)" strokeWidth={1.5} markerEnd="url(#lru-arrow)" />
            </g>
          );
        })}
        {/* empty slots */}
        {Array.from({ length: params.capacity - f.list.length }, (_, i) => (
          <rect
            key={`empty${i}`}
            x={slotX(f.list.length + 1 + i)}
            y={LIST_Y}
            width={boxW}
            height={BOX_H}
            rx={6}
            fill="none"
            stroke="var(--border)"
            strokeDasharray="4 3"
          />
        ))}
        {/* list nodes (keyed by name so they slide) */}
        {chain.map((n) => {
          const entry = f.list.find((e) => e.key === n.name);
          const touched = f.touched === n.name;
          return (
            <g key={n.name} style={{ transform: `translate(${n.x}px, ${LIST_Y}px)`, transition: 'transform 0.35s ease' }}>
              <rect
                width={boxW}
                height={BOX_H}
                rx={6}
                fill={n.sentinel ? 'var(--surface-2)' : touched ? 'var(--accent-soft)' : 'var(--surface)'}
                stroke={n.sentinel ? 'var(--muted)' : touched ? 'var(--accent)' : 'var(--border)'}
                strokeWidth={touched ? 3 : 2}
              />
              <text x={boxW / 2} y={n.sentinel ? 25 : 20} textAnchor="middle" className="viz-node-label" style={{ fontSize: n.sentinel ? 10 : 14 }}>
                {n.name}
              </text>
              {entry && (
                <text x={boxW / 2} y={34} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
                  v{entry.value}
                </text>
              )}
            </g>
          );
        })}
        {/* floating (unlinked) node */}
        {f.floating && (
          <g style={{ transform: `translate(${slotX(f.floating.fromIndex + 1)}px, ${FLOAT_Y}px)` }}>
            <rect
              width={boxW}
              height={BOX_H}
              rx={6}
              fill={f.floating.tone === 'evict' ? 'var(--bad-soft)' : 'var(--warn-soft)'}
              stroke={f.floating.tone === 'evict' ? 'var(--bad)' : 'var(--warn)'}
              strokeWidth={2.5}
              strokeDasharray="5 3"
            />
            <text x={boxW / 2} y={20} textAnchor="middle" className="viz-node-label">
              {f.floating.entry.key}
            </text>
            <text x={boxW / 2} y={34} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
              {f.floating.tone === 'evict' ? 'evicted' : 'unlinked'}
            </text>
          </g>
        )}

        {/* hash map */}
        <text x={590} y={MAP_Y + 15} textAnchor="end" className="viz-label">
          hash map: key → node reference
        </text>
        {f.mapKeys.map((k, i) => {
          const x = 10 + i * mapSpacing;
          const targetX = nodeX[k];
          const floating = f.floating?.entry.key === k;
          const ty = floating ? FLOAT_Y + BOX_H : LIST_Y + BOX_H;
          return (
            <g key={`map-${k}`}>
              {targetX !== undefined && (
                <path
                  d={`M${x + 22},${MAP_Y} C${x + 22},${MAP_Y - 30} ${targetX + boxW / 2},${ty + 30} ${targetX + boxW / 2},${ty + 2}`}
                  fill="none"
                  stroke={f.touched === k ? 'var(--accent)' : 'var(--border)'}
                  strokeWidth={f.touched === k ? 2 : 1.2}
                />
              )}
              <rect x={x} y={MAP_Y} width={44} height={22} rx={4} fill="var(--surface-2)" stroke={f.touched === k ? 'var(--accent)' : 'var(--border)'} />
              <text x={x + 22} y={MAP_Y + 15} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600 }}>
                {k} → •
              </text>
            </g>
          );
        })}

        {/* pointer writes */}
        <text x={10} y={262} className="viz-label">
          pointer writes this step{f.writes.length ? ` (${f.writes.length})` : ': none'}
        </text>
        {writeLines.map((line, li) => (
          <text key={li} x={10} y={282 + li * 18} style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
            {line.join(' ;  ')}
          </text>
        ))}
      </svg>
    </VizFrame>
  );
}
