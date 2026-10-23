import { useState } from 'react';
import { Choice, VizFrame, useFrames } from '../../core';
import { meta } from './meta';
import { CHANGES, STAGES, impact, type Box, type Edge, type Group } from './sim';
import './solid.css';

const HEAD = 30;
const ROW = 14.5;
const boxH = (b: Box) => HEAD + b.members.length * ROW + 6;

type Pt = { x: number; y: number; w: number; h: number };

/** point where the segment from the centre of r towards (tx, ty) leaves the rectangle */
function clip(r: Pt, tx: number, ty: number) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? r.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

const VERDICT = {
  cheap: { label: 'cheap change', cls: 'sol-v-good' },
  costly: { label: 'costly change', cls: 'sol-v-warn' },
  broken: { label: 'runtime bug risk', cls: 'sol-v-bad' },
};

export default function SolidRefactorViz() {
  const stepper = useFrames(STAGES);
  const s = stepper.frame;
  const [change, setChange] = useState<Record<Group, string>>({ invoice: 'bogo', payment: 'wallet', order: 'psp' });
  const cur = change[s.group];
  const imp = impact(stepper.i, cur);
  const edited = new Set(imp?.edit ?? []);

  const rects: Record<string, Pt> = {};
  for (const b of s.boxes) rects[b.id] = { x: b.x, y: b.y, w: b.w, h: boxH(b) };
  for (const a of s.actors) rects[a.id] = { x: a.x - 26, y: a.y - 18, w: 52, h: 36 };

  const edgeEl = (e: Edge, k: number) => {
    const A = rects[e.from];
    const B = rects[e.to];
    if (!A || !B) return null;
    const p1 = clip(A, B.x + B.w / 2, B.y + B.h / 2);
    const p2 = clip(B, A.x + A.w / 2, A.y + A.h / 2);
    const color = e.bad ? 'var(--bad)' : e.kind === 'actor' ? 'var(--muted)' : 'var(--text-2)';
    const dashed = e.kind === 'uses' || e.kind === 'implements' || e.kind === 'actor';
    const marker =
      e.kind === 'implements' || e.kind === 'extends' ? 'url(#sol-tri)' : e.kind === 'actor' ? undefined : e.bad ? 'url(#sol-arrow-bad)' : 'url(#sol-arrow)';
    return (
      <g key={k}>
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke={color}
          strokeWidth={e.bad ? 2 : 1.4}
          strokeDasharray={dashed ? (e.kind === 'actor' ? '2 3' : '5 3') : undefined}
          markerEnd={marker}
          markerStart={e.kind === 'owns' ? 'url(#sol-diamond)' : undefined}
        />
        {e.label && (
          <text
            x={(p1.x + p2.x) / 2 + 6}
            y={(p1.y + p2.y) / 2 - 4}
            style={{ fontSize: 10, fontWeight: 700, fill: e.bad ? 'var(--bad)' : 'var(--text-2)' }}
          >
            {e.label}
          </text>
        )}
      </g>
    );
  };

  const contentBottom = Math.max(
    ...s.boxes.map((b) => b.y + boxH(b)),
    ...s.actors.map((a) => a.y + 24),
    ...(s.layers ?? []).map((l) => l.y + l.h),
  );
  const addY = contentBottom + 12;
  const H = addY + 34;
  const options = CHANGES.filter((c) => c.group === s.group).map((c) => ({ value: c.id, label: c.label }));
  const ariaLabel = `${s.principle}: ${s.headline}. Classes: ${s.boxes
    .map((b) => `${b.stereo ? `${b.stereo} ` : ''}${b.name}${b.smell ? ' (smell)' : ''}${edited.has(b.id) ? ' (must be edited)' : ''}`)
    .join(', ')}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <Choice<string>
          label="Change request"
          value={cur}
          options={options}
          onChange={(v) => setChange((c) => ({ ...c, [s.group]: v }))}
        />
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--bad)', borderRadius: 2 }} /> smell / violation
          <span className="viz-key" style={{ background: 'var(--warn)', borderRadius: 2 }} /> must be edited
          <span className="viz-key" style={{ background: 'var(--good)', borderRadius: 2 }} /> new class only
          <span>- - ▷ implements · ── ▷ extends · - - &gt; uses · ◆ owns</span>
        </>
      }
    >
      <nav className="sol-steps" aria-label="Refactor stages">
        {STAGES.map((st, k) => (
          <button
            key={k}
            type="button"
            className={`sol-step ${k === stepper.i ? 'on' : ''} ${st.principle.includes('✕') || st.principle === 'Smell' ? 'bad' : ''}`}
            aria-current={k === stepper.i ? 'step' : undefined}
            onClick={() => stepper.seek(k)}
          >
            {st.principle}
          </button>
        ))}
      </nav>
      <svg viewBox={`0 0 600 ${H}`} className="viz-svg" role="img" aria-label={ariaLabel}>
        <defs>
          <marker id="sol-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10" fill="none" stroke="var(--text-2)" strokeWidth={1.5} />
          </marker>
          <marker id="sol-arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10" fill="none" stroke="var(--bad)" strokeWidth={1.5} />
          </marker>
          <marker id="sol-tri" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto">
            <path d="M1,1 L11,6 L1,11 z" fill="var(--surface)" stroke="var(--text-2)" strokeWidth={1.2} />
          </marker>
          <marker id="sol-diamond" viewBox="0 0 14 10" refX="1" refY="5" markerWidth="12" markerHeight="9" orient="auto">
            <path d="M1,5 L7,1 L13,5 L7,9 z" fill="var(--text-2)" />
          </marker>
        </defs>
        <text x={8} y={16} style={{ fontSize: 12.5, fontWeight: 800 }}>
          {s.principle} · <tspan style={{ fontWeight: 600 }}>{s.headline}</tspan>
        </text>
        {s.layers?.map((l) => (
          <g key={l.name}>
            <rect x={4} y={l.y} width={592} height={l.h} rx={10} fill="var(--surface-2)" stroke="var(--border)" strokeDasharray="6 4" />
            <text x={14} y={l.y + 16} className="viz-label" style={{ fontSize: 10.5, fontFamily: 'var(--mono)' }}>
              {l.name}/
            </text>
          </g>
        ))}
        {s.edges.map(edgeEl)}
        {s.actors.map((a) => (
          <g key={a.id}>
            <circle cx={a.x} cy={a.y - 8} r={6} fill="none" stroke="var(--muted)" strokeWidth={1.5} />
            <path d={`M${a.x},${a.y - 2} L${a.x},${a.y + 6} M${a.x - 7},${a.y + 1} L${a.x + 7},${a.y + 1}`} stroke="var(--muted)" strokeWidth={1.5} />
            <text x={a.x} y={a.y + 20} textAnchor="middle" className="viz-label" style={{ fontSize: 10.5 }}>
              {a.name}
            </text>
          </g>
        ))}
        {s.boxes.map((b) => {
          const h = boxH(b);
          const isEdit = edited.has(b.id);
          const stroke = isEdit ? 'var(--warn)' : b.smell ? 'var(--bad)' : b.stereo ? 'var(--accent)' : 'var(--border)';
          return (
            <g key={b.id}>
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={h}
                rx={6}
                fill={isEdit ? 'var(--warn-soft)' : b.smell ? 'var(--bad-soft)' : 'var(--surface)'}
                stroke={stroke}
                strokeWidth={isEdit || b.smell ? 2.2 : 1.4}
              />
              {b.stereo && (
                <text x={b.x + b.w / 2} y={b.y + 11} textAnchor="middle" className="viz-label" style={{ fontSize: 9, fontStyle: 'italic' }}>
                  «{b.stereo}»
                </text>
              )}
              <text x={b.x + b.w / 2} y={b.y + (b.stereo ? 24 : 19)} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 800, fontStyle: b.stereo === 'abstract' ? 'italic' : undefined }}>
                {b.name}
              </text>
              <line x1={b.x} x2={b.x + b.w} y1={b.y + HEAD - 2} y2={b.y + HEAD - 2} stroke={stroke} strokeWidth={0.8} />
              {b.members.map((m, k) => (
                <text key={k} x={b.x + 7} y={b.y + HEAD + 9 + k * ROW} style={{ fontSize: 9.8, fontFamily: 'var(--mono)', whiteSpace: 'pre' }}>
                  {m}
                </text>
              ))}
              {isEdit && (
                <text x={b.x + b.w - 4} y={b.y - 4} textAnchor="end" style={{ fontSize: 10, fontWeight: 800, fill: 'var(--warn)' }}>
                  ✎ edit
                </text>
              )}
            </g>
          );
        })}
        {imp?.add.map((name, k) => (
          <g key={name}>
            <rect x={8 + k * 150} y={addY} width={140} height={26} rx={6} fill="var(--good-soft)" stroke="var(--good)" strokeDasharray="5 3" strokeWidth={1.6} />
            <text x={18 + k * 150} y={addY + 17} style={{ fontSize: 11, fontWeight: 800, fill: 'var(--good)' }}>
              + new {name}
            </text>
          </g>
        ))}
      </svg>
      {imp && (
        <div className="sol-impact" aria-live="polite">
          <span className={`sol-verdict ${VERDICT[imp.verdict].cls}`}>{VERDICT[imp.verdict].label}</span>
          <span className="sol-counts">
            edit {imp.edit.length} existing · add {imp.add.length} new
          </span>
          <span className="sol-note">{imp.note}</span>
        </div>
      )}
    </VizFrame>
  );
}
