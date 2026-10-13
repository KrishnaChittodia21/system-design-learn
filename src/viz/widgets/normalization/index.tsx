import { useMemo, useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, simulate, type Anomaly, type NF, type NormFrame, type Params, type Rel, type RowState, type Val } from './sim';

const RH = 18;
const CH = 5.9;
const mono = { fontFamily: 'var(--mono)' };
const GROUP_FILL = ['var(--accent-soft)', 'var(--good-soft)', 'var(--warn-soft)'];
const STATE: Record<Exclude<RowState, undefined>, { fill: string; stroke: string; dash?: string }> = {
  anom: { fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
  fixed: { fill: 'var(--good-soft)', stroke: 'var(--good)' },
  new: { fill: 'var(--good-soft)', stroke: 'var(--good)' },
  reject: { fill: 'var(--bad-soft)', stroke: 'var(--bad)', dash: '4 3' },
  gone: { fill: 'var(--bad-soft)', stroke: 'var(--bad)' },
};
const NFS: NF[] = ['UNF', '1NF', '2NF', '3NF', 'BCNF'];

const show = (v: Val) => (v === null ? 'NULL' : String(v));
function colWidths(r: Rel) {
  return r.cols.map((c, i) => Math.max(c.length, ...r.rows.map((row) => show(row[i]).length)) * CH + 10);
}
const relWidth = (r: Rel) => colWidths(r).reduce((a, b) => a + b, 0);
const relHeight = (r: Rel) => RH * (r.rows.length + 1) + 18;

function RelView({ r, x, y }: { r: Rel; x: number; y: number }) {
  const ws = colWidths(r);
  const xs = ws.map((_, i) => x + ws.slice(0, i).reduce((a, b) => a + b, 0));
  const W = relWidth(r);
  return (
    <g>
      <text x={x} y={y + 11} fontSize={10.5} fontWeight={700}>
        {r.name}
      </text>
      {r.cols.map((c, i) => (
        <g key={c}>
          <rect x={xs[i]} y={y + 16} width={ws[i]} height={RH} fill={r.colGroup?.[c] !== undefined ? GROUP_FILL[r.colGroup[c]] : 'var(--border)'} />
          <text x={xs[i] + 4} y={y + 16 + 13} fontSize={9.5} fontWeight={700} style={{ ...mono, textDecoration: r.key.includes(c) ? 'underline' : undefined }}>
            {c}
          </text>
        </g>
      ))}
      {r.rows.map((row, ri) => {
        const yy = y + 16 + RH * (ri + 1);
        const st = r.state?.[ri];
        const s = st ? STATE[st] : null;
        return (
          <g key={ri} opacity={st === 'gone' ? 0.6 : 1}>
            <rect x={x} y={yy} width={W} height={RH} fill={s?.fill ?? 'var(--surface-2)'} stroke={s?.stroke ?? 'var(--border)'} strokeWidth={s ? 1.5 : 0.5} strokeDasharray={s?.dash} />
            {row.map((v, ci) => (
              <text
                key={ci}
                x={xs[ci] + 4}
                y={yy + 13}
                fontSize={9.5}
                fontWeight={r.changed?.[ri] === r.cols[ci] ? 800 : 400}
                className={v === null ? 'viz-label' : undefined}
                style={{ ...mono, fontStyle: v === null ? 'italic' : undefined }}
              >
                {show(v)}
              </text>
            ))}
            {st === 'gone' && <line x1={x + 2} x2={x + W - 2} y1={yy + RH / 2} y2={yy + RH / 2} stroke="var(--bad)" strokeWidth={1.5} />}
          </g>
        );
      })}
    </g>
  );
}

function layout(tables: Rel[], top: number) {
  const out: { r: Rel; x: number; y: number }[] = [];
  let x = 4;
  let y = top;
  let rowH = 0;
  for (const r of tables) {
    const w = relWidth(r);
    if (x > 4 && x + w > 598) {
      x = 4;
      y += rowH + 10;
      rowH = 0;
    }
    out.push({ r, x, y });
    x += w + 14;
    rowH = Math.max(rowH, relHeight(r));
  }
  return out;
}

function placeFds(fds: NormFrame['fds']) {
  const out: { d: NormFrame['fds'][number]; x: number; y: number; w: number }[] = [];
  let x = 270;
  let y = 4;
  for (const d of fds) {
    const w = d.text.length * 5.7 + 14;
    if (x + w > 598) {
      x = 4;
      y += 24;
    }
    out.push({ d, x, y, w });
    x += w + 6;
  }
  return out;
}

function frameBottom(f: NormFrame) {
  const placed = layout(f.tables, 52);
  return Math.max(...placed.map((p) => p.y + relHeight(p.r))) + (f.lossless ? 34 : 8);
}

function Drawing({ f, height }: { f: NormFrame; height: number }) {
  const placed = layout(f.tables, 52);
  const bottom = Math.max(...placed.map((p) => p.y + relHeight(p.r)));
  const label = `${f.nf}: tables ${f.tables.map((t) => `${t.name} (${t.rows.length} rows)`).join(', ')}.`;
  const fdPos = placeFds(f.fds);
  return (
    <svg viewBox={`0 0 600 ${height}`} className="viz-svg" role="img" aria-label={label}>
      {NFS.map((n, i) => {
        const on = n === f.nf;
        const past = NFS.indexOf(f.nf) > i;
        return (
          <g key={n}>
            <rect x={4 + i * 52} y={4} width={46} height={18} rx={9} fill={on ? 'var(--accent)' : past ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke="var(--border)" />
            <text x={27 + i * 52} y={17} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: on ? 'var(--accent-text)' : undefined }}>
              {n}
            </text>
          </g>
        );
      })}
      {fdPos.map(({ d, x, y, w }, i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={18} rx={4} fill={d.bad ? 'var(--bad-soft)' : 'var(--surface-2)'} stroke={d.bad ? 'var(--bad)' : 'var(--border)'} />
          <text x={x + 7} y={y + 13} fontSize={9.5} style={mono}>
            {d.text}
          </text>
        </g>
      ))}
      {placed.map((p, i) => (
        <RelView key={i} r={p.r} x={p.x} y={p.y} />
      ))}
      {f.lossless && (
        <g>
          <rect x={4} y={bottom + 6} width={300} height={22} rx={11} fill={f.lossless.ok ? 'var(--good-soft)' : 'var(--bad-soft)'} stroke={f.lossless.ok ? 'var(--good)' : 'var(--bad)'} />
          <text x={154} y={bottom + 21} textAnchor="middle" fontSize={10.5} fontWeight={700}>
            {f.lossless.ok ? '✓' : '✗'} lossless: {f.lossless.rows} rows = original {f.lossless.of}, no spurious rows
          </text>
        </g>
      )}
    </svg>
  );
}

export default function NormalizationViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const height = useMemo(() => Math.max(220, ...frames.map(frameBottom)), [frames]);
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Anomaly>
            label="Anomaly"
            value={params.anomaly}
            options={[
              { value: 'update', label: 'Update' },
              { value: 'insert', label: 'Insert' },
              { value: 'delete', label: 'Delete' },
            ]}
            onChange={set('anomaly')}
          />
          <Choice<'on' | 'off'>
            label="Lossless-join checks"
            value={params.checks ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'Show' },
              { value: 'off', label: 'Skip' },
            ]}
            onChange={(v) => set('checks')(v === 'on')}
          />
          <Choice<'on' | 'off'>
            label="BCNF example"
            value={params.bcnf ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'Include' },
              { value: 'off', label: 'Stop at 3NF' },
            ]}
            onChange={(v) => set('bcnf')(v === 'on')}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> anomaly rows
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> rejected / lost / inconsistent
          <span className="viz-key" style={{ background: 'var(--good)' }} /> fixed by the split
          <span style={{ textDecoration: 'underline' }}>underlined</span> = primary key
        </>
      }
    >
      <Drawing f={stepper.frame} height={height} />
    </VizFrame>
  );
}
