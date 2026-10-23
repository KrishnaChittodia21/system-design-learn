import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Key, Markers, type NodeDef } from './kit';
import { fmt, simulateCal, type CalDate, type CalParams } from './sim';

const T0 = 11 * 60;
const T1 = 17 * 60;
const AX = { x: 112, w: 478 };
const tx = (m: number) => AX.x + ((Math.max(T0, Math.min(T1, m)) - T0) / (T1 - T0)) * AX.w;
const ROW_Y = 78;
const ROW_H = 30;

export default function CalView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<CalParams>({ date: 'mar2', duration: 30 });
  const frames = useSimulation(simulateCal, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const nodes: Record<string, NodeDef> = {
    svc: { id: 'svc', label: 'Free/busy service', sub: 'merge · subtract', x: 112, y: 8, w: 170, h: 40 },
    idx: { id: 'idx', label: 'Busy index', sub: '(cal_id, start_utc)', x: 380, y: 8, w: 170, h: 40 },
  };
  const rows = [...f.rows];
  const yMerged = ROW_Y + 4 * ROW_H;
  const yFree = ROW_Y + 5 * ROW_H;
  const aria = `Free/busy step ${stepper.i + 1}. ${f.window ? `Shared window ${fmt(f.window[0])} to ${fmt(f.window[1])} UTC.` : ''} ${f.free.length ? `Free: ${f.free.map((m) => `${fmt(m[0])}–${fmt(m[1])}`).join(', ')} UTC.` : ''} ${f.pick ? `Picked ${fmt(f.pick[0])} UTC.` : ''}`;

  return (
    <VizFrame
      title="Calendar free/busy across three time zones"
      blurb="Find a slot for Bengaluru, New York, London and a room. Switch the date across the US daylight-saving change and change the meeting length: every local time is resolved in its own zone first, then everything is merged in UTC."
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<CalDate>
            label="Date"
            value={params.date}
            options={[
              { value: 'mar2', label: 'Mon 2 Mar (before US DST)' },
              { value: 'mar16', label: 'Mon 16 Mar (after US DST)' },
            ]}
            onChange={(date) => setParams((p) => ({ ...p, date }))}
          />
          <Choice<'15' | '30' | '45' | '60'>
            label="Meeting length"
            value={String(params.duration) as '15' | '30' | '45' | '60'}
            options={['15', '30', '45', '60'].map((v) => ({ value: v as '15' | '30' | '45' | '60', label: `${v} min` }))}
            onChange={(v) => setParams((p) => ({ ...p, duration: Number(v) }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" ring /> working hours in UTC (clipped to 11:00–17:00)
          <Key tone="warn" /> busy
          <Key tone="mag" /> room booked
          <Key tone="good" /> free in the shared window
        </>
      }
    >
      <svg viewBox="0 0 600 272" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        <Edge a={nodes.svc} b={nodes.idx} dashed />
        {Object.values(nodes).map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} labelDy={-4} packet k={`${stepper.i}-${k}`} />
        ))}

        {/* hour grid */}
        {Array.from({ length: 7 }, (_, k) => T0 + k * 60).map((m) => (
          <g key={m}>
            <line x1={tx(m)} x2={tx(m)} y1={ROW_Y - 8} y2={yFree + ROW_H - 4} stroke="var(--line)" />
            <text x={tx(m)} y={ROW_Y - 12} fontSize={9.5} textAnchor="middle" className="pdf-muted">
              {fmt(m)}
            </text>
          </g>
        ))}
        <text x={8} y={ROW_Y - 12} fontSize={9.5} fontWeight={700} className="pdf-muted">
          UTC
        </text>
        {f.window && <rect x={tx(f.window[0])} y={ROW_Y - 6} width={tx(f.window[1]) - tx(f.window[0])} height={6 * ROW_H} fill="var(--blue-s)" opacity={0.6} />}

        {rows.map((r, k) => {
          const y = ROW_Y + k * ROW_H;
          return (
            <g key={r.id} className="pdf-pop">
              <text x={8} y={y + 15} fontSize={10} fontWeight={700}>
                {r.label}
              </text>
              {r.work && <rect x={tx(r.work[0])} y={y + 2} width={tx(r.work[1]) - tx(r.work[0])} height={18} rx={4} fill="none" stroke="var(--blue)" strokeWidth={1.4} />}
              {r.busy.map((b, j) => (
                <g key={j}>
                  <rect x={tx(b.iv[0])} y={y + 4} width={Math.max(3, tx(b.iv[1]) - tx(b.iv[0]))} height={14} rx={3} fill={r.id === 'room' ? 'var(--mag)' : 'var(--warn)'} />
                  <text x={tx(b.iv[0]) - 3} y={y + 15} fontSize={8.5} textAnchor="end" className="pdf-muted">
                    {b.label}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
        {f.merged.length > 0 && (
          <g className="pdf-pop">
            <text x={8} y={yMerged + 15} fontSize={10} fontWeight={700}>
              merged busy
            </text>
            {f.merged.map((m, j) => (
              <rect key={j} x={tx(m[0])} y={yMerged + 4} width={tx(m[1]) - tx(m[0])} height={14} rx={3} fill="var(--warn)" opacity={0.8} />
            ))}
          </g>
        )}
        {(f.free.length > 0 || f.pick) && (
          <g className="pdf-pop">
            <text x={8} y={yFree + 15} fontSize={10} fontWeight={700}>
              free
            </text>
            {f.free.map((m, j) => (
              <g key={j}>
                <rect x={tx(m[0])} y={yFree + 4} width={tx(m[1]) - tx(m[0])} height={14} rx={3} fill="var(--good)" />
                <text x={(tx(m[0]) + tx(m[1])) / 2} y={yFree + 32} fontSize={9.5} fontWeight={700} textAnchor="middle">
                  {fmt(m[0])}–{fmt(m[1])} ({m[1] - m[0]}m)
                </text>
              </g>
            ))}
            {f.pick && <rect x={tx(f.pick[0])} y={yFree + 1} width={tx(f.pick[1]) - tx(f.pick[0])} height={20} rx={4} fill="none" stroke="var(--ink)" strokeWidth={2} />}
          </g>
        )}
      </svg>
    </VizFrame>
  );
}
