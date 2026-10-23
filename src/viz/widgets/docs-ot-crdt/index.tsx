import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, simulate, type Arrow, type DocView, type Params, type Scenario, type Strategy } from './sim';

const COL = { A: { x: 8, w: 180 }, S: { x: 210, w: 180 }, B: { x: 412, w: 180 } };
const cxOf = (k: 'A' | 'B' | 'S') => COL[k].x + COL[k].w / 2;
const CHAR_W = 22;

function Doc({ k, title, d, crdt }: { k: 'A' | 'B' | 'S'; title: string; d: DocView | null; crdt: boolean }) {
  const { x, w } = COL[k];
  if (!d) {
    return (
      <g>
        <rect x={x} y={8} width={w} height={118} rx={8} fill="none" stroke="var(--border)" strokeDasharray="4 4" />
        <text x={x + w / 2} y={60} textAnchor="middle" fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          no sequencer
        </text>
        <text x={x + w / 2} y={78} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
          ops may travel peer-to-peer
        </text>
        <text x={x + w / 2} y={94} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
          or through a dumb relay
        </text>
      </g>
    );
  }
  const chars = crdt && d.chars ? d.chars : [...d.text].map((ch, i) => ({ ch, id: String(i), deleted: false, fresh: false }));
  const total = chars.length * CHAR_W;
  const x0 = x + (w - total) / 2;
  return (
    <g>
      <rect x={x} y={8} width={w} height={118} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
      <text x={x + 8} y={24} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
        {title}
      </text>
      {d.rev !== null && (
        <text x={x + w - 8} y={24} textAnchor="end" fontSize={10.5} fontWeight={700} style={{ fill: 'var(--accent)' }}>
          rev {d.rev}
        </text>
      )}
      {chars.map((c, i) => (
        <g key={`${c.id}-${i}`}>
          <rect
            x={x0 + i * CHAR_W + 1}
            y={40}
            width={CHAR_W - 2}
            height={28}
            rx={4}
            fill={c.deleted ? 'var(--bad-soft)' : c.fresh ? 'var(--accent-soft)' : 'var(--surface)'}
            stroke={c.deleted ? 'var(--bad)' : c.fresh ? 'var(--accent)' : 'var(--line-2)'}
            strokeDasharray={c.deleted ? '3 2' : undefined}
          />
          <text x={x0 + i * CHAR_W + CHAR_W / 2} y={59} textAnchor="middle" fontSize={14} fontWeight={700} fontFamily="var(--f-mono)" textDecoration={c.deleted ? 'line-through' : undefined} style={{ fill: c.deleted ? 'var(--bad)' : 'var(--text)' }}>
            {c.ch}
          </text>
          {crdt && (
            <text x={x0 + i * CHAR_W + CHAR_W / 2} y={80} textAnchor="middle" fontSize={8} style={{ fill: 'var(--muted)' }}>
              {c.id}
            </text>
          )}
        </g>
      ))}
      <text x={x + w / 2} y={102} textAnchor="middle" fontSize={11} fontFamily="var(--f-mono)" fontWeight={700}>
        “{d.text}”
      </text>
      {d.pending && (
        <text x={x + w / 2} y={118} textAnchor="middle" fontSize={9.5} style={{ fill: 'var(--warn)' }}>
          unacked: {d.pending}
        </text>
      )}
    </g>
  );
}

export default function DocsOtCrdtViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const crdt = params.strategy === 'crdt';

  const arrow = (a: Arrow, i: number) => {
    const y = 146 + i * 26;
    const x1 = cxOf(a.from);
    const x2 = cxOf(a.to);
    const dir = x2 > x1 ? 1 : -1;
    return (
      <g key={i}>
        <line x1={x1 + dir * 30} y1={y} x2={x2 - dir * 30} y2={y} stroke={`var(--${a.tone})`} strokeWidth={2.2} markerEnd={`url(#otc-${a.tone})`} />
        <text x={(x1 + x2) / 2} y={y - 5} textAnchor="middle" fontSize={10} fontFamily="var(--f-mono)" fontWeight={700} style={{ fill: `var(--${a.tone})` }}>
          {a.label}
        </text>
      </g>
    );
  };

  const aria = `A shows "${f.A.text}", ${f.S ? `server "${f.S.text}", ` : ''}B shows "${f.B.text}".${f.status ? ` ${f.status.text}.` : ''}`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Strategy>
            label="Merge strategy"
            value={params.strategy}
            options={[
              { value: 'naive', label: 'Naive replay' },
              { value: 'ot', label: 'OT (central server)' },
              { value: 'crdt', label: 'CRDT' },
            ]}
            onChange={(strategy) => setParams((p) => ({ ...p, strategy }))}
          />
          <Choice<Scenario>
            label="Conflict"
            value={params.scenario}
            options={[
              { value: 'ins-del', label: 'Insert vs delete' },
              { value: 'ins-ins', label: 'Two inserts, same spot' },
              { value: 'del-del', label: 'Both delete "b"' },
            ]}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)' }} /> inserted character
          <span className="viz-key" style={{ background: 'var(--bad-soft)', border: '1px dashed var(--bad)' }} /> tombstone (CRDT)
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> transformed op
        </>
      }
    >
      <svg viewBox="0 0 600 262" className="viz-svg" role="img" aria-label={aria}>
        <defs>
          {['accent', 'warn', 'good', 'bad'].map((c) => (
            <marker key={c} id={`otc-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={`var(--${c})`} />
            </marker>
          ))}
        </defs>
        <Doc k="A" title="editor A" d={f.A} crdt={crdt} />
        <Doc k="S" title={params.strategy === 'naive' ? 'server (no transform)' : 'server (sequencer)'} d={f.S} crdt={crdt} />
        <Doc k="B" title="editor B" d={f.B} crdt={crdt} />
        {f.arrows.map(arrow)}
        {f.note && (
          <text x={300} y={214} textAnchor="middle" fontSize={10.5} fontFamily="var(--f-mono)" style={{ fill: 'var(--text-2)' }}>
            {f.note}
          </text>
        )}
        {f.status && (
          <g>
            <rect x={150} y={226} width={300} height={28} rx={14} fill={`var(--${f.status.tone}-soft)`} stroke={`var(--${f.status.tone})`} />
            <text x={300} y={244} textAnchor="middle" fontSize={11.5} fontWeight={700} style={{ fill: `var(--${f.status.tone})` }}>
              {f.status.text}
            </text>
          </g>
        )}
      </svg>
    </VizFrame>
  );
}
