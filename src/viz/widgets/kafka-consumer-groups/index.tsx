import { useMemo, useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { simulate, type CommitMode, type LogRecord, type Params } from './sim';

const ROW_X = 34;
const ROW_END = 410;
const TOP = 46;
const BOTTOM = 306;
const CONS_X = 486;
const CONS_W = 104;

function cellStyle(r: LogRecord, offset: number, committed: number) {
  if (offset < committed) {
    return r.processed > 0 ? { fill: 'var(--good-soft)', stroke: 'var(--good)' } : { fill: 'var(--bad-soft)', stroke: 'var(--bad)' };
  }
  return r.processed > 0 ? { fill: 'var(--warn-soft)', stroke: 'var(--warn)' } : { fill: 'var(--surface-2)', stroke: 'var(--border)' };
}

export default function KafkaConsumerGroupsViz() {
  const [params, setParams] = useState<Params>({ partitions: 4, consumers: 3, commit: 'after' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;

  // keep the horizontal scale stable across the whole run
  const maxLen = useMemo(() => Math.max(6, ...frames.flatMap((fr) => fr.partitions.map((p) => p.log.length))), [frames]);
  const P = f.partitions.length;
  const rowH = Math.min(58, (BOTTOM - TOP) / P);
  const cellW = Math.min(30, (ROW_END - ROW_X - 8) / maxLen);
  const cellH = Math.min(26, rowH - 20);
  const rowY = (i: number) => TOP + i * rowH;

  const nC = f.consumers.length;
  const boxGap = 6;
  const boxH = Math.min(40, (BOTTOM - TOP - boxGap * (nC - 1)) / nC);
  const consY = (i: number) => TOP + i * (boxH + boxGap);

  const totalLag = f.partitions.reduce((s, p) => s + p.log.length - p.committed, 0);
  const aria =
    `Topic with ${P} partitions, total lag ${totalLag}. ` +
    f.partitions
      .map((p, i) => `P${i}: ${p.log.length} records, committed ${p.committed}, owner ${p.owner === null ? 'none' : `C${p.owner + 1}`}`)
      .join('; ') +
    '. ' +
    f.consumers.map((c) => `C${c.id + 1} ${!c.alive ? 'crashed' : c.partitions.length ? `owns ${c.partitions.map((p) => `P${p}`).join(', ')}` : 'idle'}`).join('; ');

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Partitions" value={params.partitions} min={1} max={6} onChange={(partitions) => setParams((p) => ({ ...p, partitions }))} />
          <Slider label="Consumers (one more joins later)" value={params.consumers} min={1} max={6} onChange={(consumers) => setParams((p) => ({ ...p, consumers }))} />
          <Choice<CommitMode>
            label="Commit"
            value={params.commit}
            options={[
              { value: 'after', label: 'after processing' },
              { value: 'before', label: 'before processing' },
            ]}
            onChange={(commit) => setParams((p) => ({ ...p, commit }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }} /> not yet processed
          <span className="viz-key" style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn)' }} /> processed, not committed
          <span className="viz-key" style={{ background: 'var(--good-soft)', border: '1px solid var(--good)' }} /> processed + committed
          <span className="viz-key" style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad)' }} /> committed but never processed
          <span className="viz-key" style={{ background: 'var(--bad)', width: 3, borderRadius: 0 }} /> committed offset
        </>
      }
    >
      <svg viewBox="0 0 600 320" className="viz-svg" role="img" aria-label={aria}>
        <text x={8} y={18} className="viz-label">
          topic “orders” · offsets →
        </text>
        <text x={CONS_X} y={18} className="viz-label">
          group “billing”
        </text>
        <text x={ROW_END + 40} y={18} className="viz-label" textAnchor="end">
          total lag {totalLag}
        </text>
        {f.rebalance && (
          <g>
            <rect x={CONS_X - 4} y={24} width={CONS_W + 8} height={16} rx={4} fill="var(--warn-soft)" stroke="var(--warn)" />
            <text x={CONS_X + CONS_W / 2} y={36} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: 'var(--warn)' }}>
              REBALANCE
            </text>
          </g>
        )}

        {/* ownership links */}
        {f.partitions.map((p, i) => {
          if (p.owner === null) return null;
          const ci = f.consumers.findIndex((c) => c.id === p.owner);
          const y1 = rowY(i) + cellH / 2 + 4;
          const y2 = consY(ci) + boxH / 2;
          const dead = !f.consumers[ci].alive;
          return (
            <path
              key={`l${i}`}
              d={`M${ROW_END + 44},${y1} C${ROW_END + 60},${y1} ${CONS_X - 24},${y2} ${CONS_X},${y2}`}
              fill="none"
              stroke={dead ? 'var(--bad)' : 'var(--accent)'}
              strokeWidth={1.6}
              strokeDasharray={dead ? '4 3' : undefined}
              opacity={0.85}
            />
          );
        })}

        {/* partitions */}
        {f.partitions.map((p, i) => {
          const y = rowY(i) + 4;
          const [from, to] = f.fetched[i] ?? [0, 0];
          const produced = f.produced.includes(i);
          const lag = p.log.length - p.committed;
          const cx = ROW_X + p.committed * cellW;
          return (
            <g key={i}>
              <text x={8} y={y + cellH / 2 + 4} fontSize={12} fontWeight={700} style={{ fill: produced ? 'var(--accent)' : 'var(--text)' }}>
                P{i}
              </text>
              <line x1={ROW_X} y1={y + cellH + 2} x2={ROW_END} y2={y + cellH + 2} stroke="var(--border)" />
              {p.log.map((r, o) => {
                const st = cellStyle(r, o, p.committed);
                const inFetch = o >= from && o < to;
                return (
                  <g key={o}>
                    <rect
                      x={ROW_X + o * cellW + 1}
                      y={y}
                      width={cellW - 2}
                      height={cellH}
                      rx={3}
                      fill={st.fill}
                      stroke={inFetch ? 'var(--accent)' : st.stroke}
                      strokeWidth={inFetch ? 2.4 : 1.2}
                      style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
                    />
                    <text x={ROW_X + o * cellW + cellW / 2} y={y + cellH / 2 + 4} textAnchor="middle" fontSize={Math.min(11, cellW * 0.45)} fontWeight={600}>
                      {r.key[0].toUpperCase()}
                    </text>
                    {r.processed > 1 && (
                      <text x={ROW_X + o * cellW + cellW / 2} y={y - 2} textAnchor="middle" fontSize={9} fontWeight={700} style={{ fill: 'var(--bad)' }}>
                        ×{r.processed}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* committed offset marker */}
              <line x1={cx} y1={y - 3} x2={cx} y2={y + cellH + 5} stroke="var(--bad)" strokeWidth={2.5} style={{ transition: 'all 0.3s ease' }} />
              <text x={cx + 2} y={y + cellH + 15} fontSize={9} style={{ fill: 'var(--text-2)' }}>
                committed {p.committed}
              </text>
              <text x={ROW_END + 6} y={y + cellH / 2 + 4} fontSize={10} fontWeight={lag ? 700 : 400} style={{ fill: lag ? 'var(--warn)' : 'var(--muted)' }}>
                lag {lag}
              </text>
            </g>
          );
        })}

        {/* consumers */}
        {f.consumers.map((c, k) => {
          const y = consY(k);
          const idle = c.alive && c.partitions.length === 0;
          return (
            <g key={c.id}>
              <rect
                x={CONS_X}
                y={y}
                width={CONS_W}
                height={boxH}
                rx={6}
                fill={!c.alive ? 'var(--bad-soft)' : idle ? 'var(--surface-2)' : 'var(--accent-soft)'}
                stroke={!c.alive ? 'var(--bad)' : idle ? 'var(--border)' : 'var(--accent)'}
                strokeDasharray={!c.alive || idle ? '4 3' : undefined}
                strokeWidth={1.5}
              />
              <text x={CONS_X + 8} y={y + boxH / 2 + 4} fontSize={12} fontWeight={700}>
                C{c.id + 1}
              </text>
              <text x={CONS_X + CONS_W - 6} y={y + boxH / 2 + 4} textAnchor="end" fontSize={10} style={{ fill: !c.alive ? 'var(--bad)' : 'var(--text-2)' }}>
                {!c.alive ? 'crashed ✕' : idle ? 'idle' : c.partitions.map((p) => `P${p}`).join(' ')}
              </text>
            </g>
          );
        })}
      </svg>
    </VizFrame>
  );
}
