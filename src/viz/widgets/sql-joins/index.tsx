import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import {
  CLAUSE_LINE,
  CUSTOMERS,
  DEFAULT_PARAMS,
  JOIN_NAME,
  JOIN_SQL,
  ORDERS,
  simulate,
  sqlText,
  type Clause,
  type FilterAt,
  type JoinFrame,
  type JoinType,
  type Mode,
  type OrderFrame,
  type Params,
  type Table,
  type Val,
} from './sim';

const RH = 20;
const mono = { fontFamily: 'var(--mono)' };

const STATE_FILL: Record<Table['state'][number], string> = {
  keep: 'var(--surface-2)',
  drop: 'var(--bad-soft)',
  null: 'var(--warn-soft)',
  unknown: 'var(--warn-soft)',
  new: 'var(--accent-soft)',
  group0: 'var(--accent-soft)',
  group1: 'var(--good-soft)',
  group2: 'var(--warn-soft)',
};

function Cell({ x, y, w, v, bold }: { x: number; y: number; w: number; v: Val; bold?: boolean }) {
  const isNull = v === null;
  const s = isNull ? 'NULL' : String(v);
  const max = Math.max(3, Math.floor((w - 6) / 5.6));
  return (
    <text
      x={x + 5}
      y={y + 14}
      fontSize={10}
      fontWeight={bold ? 700 : 400}
      className={isNull ? 'viz-label' : undefined}
      style={{ ...mono, fontStyle: isNull ? 'italic' : undefined }}
    >
      {s.length > max ? s.slice(0, max - 1) + '…' : s}
    </text>
  );
}

function Grid({
  x,
  y,
  title,
  cols,
  widths,
  rows,
  fills,
  strokes,
  struck,
}: {
  x: number;
  y: number;
  title?: string;
  cols: string[];
  widths: number[];
  rows: Val[][];
  fills?: string[];
  strokes?: (string | undefined)[];
  struck?: boolean[];
}) {
  const W = widths.reduce((a, b) => a + b, 0);
  const xs = widths.map((_, i) => x + widths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <g>
      {title && (
        <text x={x} y={y - 6} fontSize={11} fontWeight={700}>
          {title}
        </text>
      )}
      <rect x={x} y={y} width={W} height={RH} fill="var(--border)" rx={3} />
      {cols.map((c, i) => (
        <text key={c + i} x={xs[i] + 5} y={y + 14} fontSize={9.5} fontWeight={700}>
          {c}
        </text>
      ))}
      {rows.map((r, ri) => {
        const yy = y + RH * (ri + 1);
        return (
          <g key={ri} opacity={struck?.[ri] ? 0.55 : 1}>
            <rect x={x} y={yy} width={W} height={RH} fill={fills?.[ri] ?? 'var(--surface-2)'} stroke={strokes?.[ri] ?? 'var(--border)'} strokeWidth={strokes?.[ri] ? 2 : 0.5} />
            {r.map((v, ci) => (
              <Cell key={ci} x={xs[ci]} y={yy} w={widths[ci]} v={v} />
            ))}
            {struck?.[ri] && <line x1={x + 3} x2={x + W - 3} y1={yy + RH / 2} y2={yy + RH / 2} stroke="var(--bad)" strokeWidth={1.5} />}
          </g>
        );
      })}
    </g>
  );
}

function sqlLines(sql: string): string[] {
  const out: string[] = [];
  let rest = sql;
  while (rest.length > 92) {
    const cut = Math.max(rest.lastIndexOf(' WHERE ', 92), rest.lastIndexOf(' ON ', 92), rest.lastIndexOf(' JOIN ', 92));
    const at = cut > 0 ? cut : 92;
    out.push(rest.slice(0, at));
    rest = '  ' + rest.slice(at + 1);
  }
  out.push(rest);
  return out;
}

function JoinsView({ f, join }: { f: JoinFrame; join: JoinType }) {
  const CX = 6;
  const OX = 196;
  const RX = 410;
  const Y = 26;
  const cW = [30, 50, 64];
  const oW = [34, 50, 66, 52];
  const anti = join === 'anti';
  const rW = anti ? [34, 52, 70] : [34, 52, 40, 66];
  const rCols = anti ? ['c.id', 'c.name', 'c.city'] : ['c.id', 'c.name', 'o.id', 'o.status'];
  const markColor = { match: 'var(--good)', nomatch: 'var(--muted)', unknown: 'var(--warn)' } as const;
  const label = `${JOIN_NAME[join]}: result has ${f.result.length} rows${f.cur >= 0 ? `; scanning customer ${CUSTOMERS[f.cur].name}` : ''}.`;
  const custRowY = (i: number) => Y + RH * (i + 1) + RH / 2;
  const ordRowY = (i: number) => Y + RH * (i + 1) + RH / 2;

  return (
    <svg viewBox="0 0 600 212" className="viz-svg" role="img" aria-label={label}>
      <Grid
        x={CX}
        y={Y}
        title="customers c"
        cols={['id', 'name', 'city']}
        widths={cW}
        rows={CUSTOMERS.map((c) => [c.id, c.name, c.city])}
        strokes={CUSTOMERS.map((_, i) => (i === f.cur ? 'var(--accent)' : undefined))}
        fills={CUSTOMERS.map((_, i) => (i === f.cur ? 'var(--accent-soft)' : 'var(--surface-2)'))}
      />
      <Grid
        x={OX}
        y={Y}
        title="orders o"
        cols={['id', 'cust_id', 'status', 'paise']}
        widths={oW}
        rows={ORDERS.map((o) => [o.id, o.customer_id, o.status, o.paise])}
        strokes={ORDERS.map((_, i) => (i === f.curOrder ? 'var(--accent)' : undefined))}
        fills={ORDERS.map((o, i) =>
          i === f.curOrder ? 'var(--accent-soft)' : f.marks[o.id] === 'match' ? 'var(--good-soft)' : 'var(--surface-2)',
        )}
      />
      {/* comparison edges */}
      {f.cur >= 0 &&
        ORDERS.map((o, oi) => {
          const m = f.marks[o.id];
          if (!m) return null;
          return (
            <g key={o.id}>
              <line
                x1={CX + 144 + 2}
                y1={custRowY(f.cur)}
                x2={OX - 16}
                y2={ordRowY(oi)}
                stroke={markColor[m]}
                strokeWidth={m === 'match' ? 2 : 1}
                strokeDasharray={m === 'match' ? undefined : '3 3'}
                opacity={m === 'match' ? 1 : 0.6}
              />
              <text x={OX - 12} y={ordRowY(oi) + 4} fontSize={11} fontWeight={700} fill={markColor[m]} style={{ fill: markColor[m] }}>
                {m === 'match' ? '✓' : m === 'unknown' ? '?' : '✗'}
              </text>
            </g>
          );
        })}
      <Grid
        x={RX}
        y={Y}
        title={`result (${f.result.length} rows)`}
        cols={rCols}
        widths={rW}
        rows={f.result.map((r) => (anti ? [r.c!.id, r.c!.name, r.c!.city] : [r.c?.id ?? null, r.c?.name ?? null, r.o?.id ?? null, r.o?.status ?? null]))}
        fills={f.result.map((r, i) => (f.fresh.includes(i) ? 'var(--accent-soft)' : !r.c || !r.o ? (anti ? 'var(--surface-2)' : 'var(--warn-soft)') : 'var(--surface-2)'))}
        strokes={f.result.map((_, i) => (f.fresh.includes(i) ? 'var(--accent)' : undefined))}
      />
      <text x={6} y={Y + RH * 6 + 22} fontSize={9.5} className="viz-label">
        ✓ ON is TRUE · ✗ FALSE · ? UNKNOWN (NULL compared) — only TRUE pairs join
      </text>
      {sqlLines(JOIN_SQL[join]).map((l, i) => (
        <text key={i} x={6} y={Y + RH * 6 + 44 + 14 * i} fontSize={10} style={mono}>
          {l}
        </text>
      ))}
    </svg>
  );
}

const PIPE: { c: Clause; label: string }[] = [
  { c: 'from', label: 'FROM' },
  { c: 'join', label: 'JOIN' },
  { c: 'where', label: 'WHERE' },
  { c: 'group', label: 'GROUP BY' },
  { c: 'having', label: 'HAVING' },
  { c: 'select', label: 'SELECT' },
  { c: 'order', label: 'ORDER BY' },
  { c: 'limit', label: 'LIMIT' },
];

function OrderView({ f, filterAt }: { f: OrderFrame; filterAt: FilterAt }) {
  const lines = sqlText(filterAt);
  const hl = CLAUSE_LINE[f.clause];
  const step = PIPE.findIndex((p) => p.c === f.clause);
  const t = f.table;
  const hasNote = !!t?.note;
  const tableW = hasNote ? 470 : 588;
  const widths = t ? t.cols.map(() => tableW / t.cols.length) : [];
  const label = `Clause ${f.clause}: ${t ? `${t.rows.length} rows` : 'query overview'}.`;
  return (
    <svg viewBox="0 0 600 280" className="viz-svg" role="img" aria-label={label}>
      {lines.map((l, i) => (
        <g key={i}>
          {i === hl && <rect x={2} y={4 + i * 13} width={596} height={13} rx={3} fill="var(--accent-soft)" />}
          <text
            x={6}
            y={14 + i * 13}
            fontSize={9.5}
            fontWeight={i === hl ? 700 : 400}
            className={l.startsWith('--') ? 'viz-label' : undefined}
            style={{ ...mono, fill: filterAt === 'where' && i === 3 ? 'var(--bad)' : undefined }}
          >
            {l}
          </text>
        </g>
      ))}
      {PIPE.map((p, i) => {
        const x = 4 + i * 74;
        const on = i === step;
        const past = step >= 0 ? i < step : f.clause === 'done';
        return (
          <g key={p.c}>
            <rect x={x} y={114} width={68} height={20} rx={10} fill={on ? 'var(--accent)' : past ? 'var(--accent-soft)' : 'var(--surface-2)'} stroke="var(--border)" />
            <text x={x + 34} y={128} textAnchor="middle" fontSize={9.5} fontWeight={700} style={{ fill: on ? 'var(--accent-text)' : undefined }}>
              {i + 1}. {p.label}
            </text>
          </g>
        );
      })}
      {t ? (
        <g>
          <Grid
            x={6}
            y={146}
            cols={t.cols}
            widths={widths}
            rows={t.rows}
            fills={t.state.map((s) => STATE_FILL[s])}
            struck={t.state.map((s) => s === 'drop' || s === 'unknown')}
          />
          {t.note?.map((n, i) => (
            <text key={i} x={482} y={146 + RH * (i + 1) + 14} fontSize={9.5} className="viz-label">
              {n}
            </text>
          ))}
          {f.clause === 'done' && (
            <text x={300} y={146 + RH * (t.rows.length + 1) + 24} textAnchor="middle" fontSize={11} fontWeight={700} style={{ fill: filterAt === 'where' ? 'var(--bad)' : 'var(--good)' }}>
              {filterAt === 'where' ? '✗ Meera (never paid) is missing: the outer join became inner' : '✓ Meera 0 and Asha 50000: the never-paid customer is kept'}
            </text>
          )}
        </g>
      ) : (
        <text x={300} y={220} textAnchor="middle" fontSize={11} className="viz-label">
          Written order ≠ execution order. Step through to see each intermediate row set.
        </text>
      )}
    </svg>
  );
}

export default function SqlJoinsViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Mode>
            label="View"
            value={params.mode}
            options={[
              { value: 'joins', label: 'Join types' },
              { value: 'order', label: 'Execution order' },
            ]}
            onChange={set('mode')}
          />
          {params.mode === 'joins' ? (
            <Choice<JoinType>
              label="Join"
              value={params.join}
              options={[
                { value: 'inner', label: 'INNER' },
                { value: 'left', label: 'LEFT' },
                { value: 'right', label: 'RIGHT' },
                { value: 'full', label: 'FULL OUTER' },
                { value: 'anti', label: 'NOT EXISTS' },
              ]}
              onChange={set('join')}
            />
          ) : (
            <Choice<FilterAt>
              label="Paid filter"
              value={params.filterAt}
              options={[
                { value: 'where', label: "in WHERE (trap)" },
                { value: 'on', label: 'in ON (fix)' },
              ]}
              onChange={set('filterAt')}
            />
          )}
        </>
      }
      legend={
        f.mode === 'joins' ? (
          <>
            <span className="viz-key" style={{ background: 'var(--accent)' }} /> row being processed / just emitted
            <span className="viz-key" style={{ background: 'var(--good)' }} /> matching order
            <span className="viz-key" style={{ background: 'var(--warn)' }} /> NULL-filled result row
          </>
        ) : (
          <>
            <span className="viz-key" style={{ background: 'var(--warn)' }} /> NULL-filled / UNKNOWN
            <span className="viz-key" style={{ background: 'var(--bad)' }} /> filtered out
            <span className="viz-key" style={{ background: 'var(--accent)' }} /> current clause / group
          </>
        )
      }
    >
      {f.mode === 'joins' ? <JoinsView f={f} join={params.join} /> : <OrderView f={f} filterAt={params.filterAt} />}
    </VizFrame>
  );
}
