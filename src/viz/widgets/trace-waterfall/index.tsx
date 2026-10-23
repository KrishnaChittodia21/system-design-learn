import { useMemo, useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { ORPHAN_ID, TRACE_ID, buildSpans, simulate, type Params, type Scenario, type Span } from './sim';
import './trace.css';

const SVC_COLOR: Record<string, string> = {
  gateway: 'var(--blue)',
  checkout: 'var(--cyan)',
  inventory: 'var(--green)',
  pricing: 'var(--amber)',
  payment: 'var(--mag)',
};

const W = 520;
const LABEL_W = 150;
const X0 = LABEL_W + 6;
const X1 = W - 14;
const ROW = 23;
const TOP = 34;

/** depth-first order so children sit under their parent */
function order(spans: Span[]): { span: Span; depth: number }[] {
  const out: { span: Span; depth: number }[] = [];
  const visit = (sp: Span, depth: number) => {
    out.push({ span: sp, depth });
    spans
      .filter((c) => c.parent === sp.id && c.trace === sp.trace)
      .sort((a, b) => a.start - b.start)
      .forEach((c) => visit(c, depth + 1));
  };
  spans.filter((s) => s.parent === null && s.trace === 'main').forEach((r) => visit(r, 0));
  spans.filter((s) => s.parent === null && s.trace === 'orphan').forEach((r) => visit(r, 0));
  return out;
}

export default function TraceWaterfallViz() {
  const [params, setParams] = useState<Params>({ scenario: 'slow-db', broken: false });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const spans = useMemo(() => buildSpans(params), [params]);
  const rows = useMemo(() => order(spans), [spans]);
  const total = spans.find((s) => s.id === 'gw')!.end;
  const scale = (t: number) => X0 + (t / total) * (X1 - X0);
  const orphanStart = rows.findIndex((r) => r.span.trace === 'orphan');
  const rowY = (i: number) => TOP + i * ROW + (orphanStart >= 0 && i >= orphanStart ? 26 : 0);
  const H = rowY(rows.length - 1) + ROW + 30;
  const analysed = f.phase !== 'run';
  const ticks = [...[0, 0.25, 0.5, 0.75].map((p) => Math.round((p * total) / 10) * 10), total];

  const aria =
    `Trace waterfall at ${f.t} ms of ${total} ms. ` +
    rows
      .filter((r) => f.started.includes(r.span.id))
      .map((r) => {
        const s = r.span;
        const done = f.finished.includes(s.id);
        return `${s.service} ${s.name} ${done ? `${s.end - s.start} ms` : 'running'}${s.error ? ' error' : ''}${f.critical.includes(s.id) ? ', critical path' : ''}${f.culprit.includes(s.id) ? ', biggest self time' : ''}${s.trace === 'orphan' ? ', in a separate trace' : ''}`;
      })
      .join('; ');

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Scenario>
            label="Incident"
            value={params.scenario}
            options={[
              { value: 'healthy', label: 'healthy' },
              { value: 'slow-db', label: 'slow DB insert' },
              { value: 'retries', label: 'cache timeouts + retries' },
            ]}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
          <Choice<'ok' | 'broken'>
            label="Checkout → pricing propagation"
            value={params.broken ? 'broken' : 'ok'}
            options={[
              { value: 'ok', label: 'forwards traceparent' },
              { value: 'broken', label: 'drops it' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, broken: v === 'broken' }))}
          />
        </>
      }
      legend={
        <>
          {Object.entries(SVC_COLOR).map(([svc, c]) => (
            <span key={svc}>
              <span className="viz-key" style={{ background: c }} /> <span className="tw-legend-txt">{svc}</span>
            </span>
          ))}
          <span>
            <span className="viz-key" style={{ background: 'var(--bad)' }} /> <span className="tw-legend-txt">error / biggest self time</span>
          </span>
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={aria}>
        <text x={4} y={14} className="viz-label">
          trace {TRACE_ID.slice(0, 12)}… · {total} ms end-to-end
        </text>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={scale(t)} x2={scale(t)} y1={22} y2={H - 22} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={scale(t)} y={H - 8} textAnchor={t === 0 ? 'start' : t === total ? 'end' : 'middle'} fontSize={10} className="viz-label">
              {t} ms
            </text>
          </g>
        ))}
        {orphanStart >= 0 && (
          <g>
            <line x1={4} x2={X1} y1={rowY(orphanStart) - 14} y2={rowY(orphanStart) - 14} stroke="var(--bad)" strokeDasharray="5 4" />
            <text x={4} y={rowY(orphanStart) - 4} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--bad)' }}>
              separate trace {ORPHAN_ID.slice(0, 8)}… (no parent: traceparent was dropped)
            </text>
          </g>
        )}
        {rows.map(({ span: s, depth }, i) => {
          const y = rowY(i);
          const on = f.started.includes(s.id);
          const done = f.finished.includes(s.id);
          const end = done ? s.end : Math.max(s.start, Math.min(s.end, f.t));
          const crit = f.critical.includes(s.id);
          const culprit = f.culprit.includes(s.id);
          const dim = analysed && !crit;
          const color = SVC_COLOR[s.service];
          const w = Math.max(2, scale(end) - scale(s.start));
          const self = f.self[s.id];
          return (
            <g key={s.id} opacity={on ? (dim ? 0.38 : 1) : 0.12} style={{ transition: 'opacity .3s' }}>
              <text x={4 + depth * 9} y={y + 15} fontSize={10.5} fontWeight={crit && analysed ? 700 : 500}>
                <tspan style={{ fill: color }}>●</tspan> {s.name.length > 19 - depth ? `${s.name.slice(0, 18 - depth)}…` : s.name}
              </text>
              <rect x={X0} y={y + 3} width={X1 - X0} height={ROW - 6} rx={4} fill="var(--tint)" opacity={0.5} />
              <rect
                x={scale(s.start)}
                y={y + 4}
                width={w}
                height={ROW - 8}
                rx={3}
                fill={color}
                fillOpacity={s.error ? 0.35 : 0.9}
                stroke={culprit ? 'var(--bad)' : s.error ? 'var(--bad)' : 'none'}
                strokeWidth={culprit ? 2.5 : 1.5}
                strokeDasharray={!done && on ? '3 2' : s.error && !culprit ? '3 2' : undefined}
                style={{ transition: 'width .35s ease' }}
              />
              {on && (
                <text
                  x={w > 120 ? scale(s.start) + 5 : scale(end) + 4 > X1 - 100 ? scale(s.start) - 4 : scale(end) + 4}
                  y={y + 15}
                  fontSize={10}
                  textAnchor={w <= 120 && scale(end) + 4 > X1 - 100 ? 'end' : 'start'}
                  fontWeight={culprit ? 700 : 500}
                  style={{ fill: w > 120 ? 'var(--surface)' : culprit ? 'var(--bad)' : 'var(--text)' }}
                  className={w > 120 ? undefined : 'tw-halo'}
                >
                  {done ? `${s.end - s.start} ms` : '…'}
                  {s.error ? ' ✕ timeout' : ''}
                  {analysed && crit && self !== undefined ? ` · self ${self}` : ''}
                </text>
              )}
            </g>
          );
        })}
        {f.phase === 'run' && f.t > 0 && (
          <g>
            <line x1={scale(f.t)} x2={scale(f.t)} y1={22} y2={H - 22} stroke="var(--accent)" strokeWidth={1.5} />
            <text x={scale(f.t)} y={30} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: 'var(--accent)' }} className="tw-halo">
              {f.t} ms
            </text>
          </g>
        )}
      </svg>

      {f.phase === 'signals' && (
        <div className="tw-signals">
          <div className="tw-red" role="group" aria-label="RED metrics for this request">
            <div>
              <span>Rate</span>
              <strong>+1 req</strong>
            </div>
            <div>
              <span>Errors (5xx)</span>
              <strong>0</strong>
            </div>
            <div>
              <span>Duration</span>
              <strong className={total > 500 ? 'is-bad' : ''}>{total} ms</strong>
            </div>
          </div>
          <ul className="tw-logs" aria-label="Log lines emitted">
            {f.logs.map((l, k) => (
              <li key={k} className={l.trace === ORPHAN_ID ? 'is-orphan' : ''}>
                <code>
                  {'{'}"level":"{l.level}","service":"{l.service}","trace_id":"<b>{l.trace.slice(0, 8)}…</b>","msg":"{l.msg}"{'}'}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </VizFrame>
  );
}
