import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { INCIDENTS, type NodeState, type Phase } from './incidents';
import { PHASE_LABEL, incidentById, simulate, type Params } from './sim';
import { Tiles } from '../prod-perf-incident-lab/kit/ui';
import './replay.css';

const STATE_STYLE: Record<NodeState, { fill: string; stroke: string; tag: string }> = {
  ok: { fill: 'var(--surface)', stroke: 'var(--line-2)', tag: 'ok' },
  change: { fill: 'var(--accent-soft)', stroke: 'var(--accent)', tag: 'changed' },
  warn: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', tag: 'degraded' },
  down: { fill: 'var(--bad-soft)', stroke: 'var(--bad)', tag: 'failing' },
  off: { fill: 'var(--tint)', stroke: 'var(--ink-4)', tag: 'off / paused' },
};

const PHASE_COLOR: Record<Phase, string> = {
  trigger: 'var(--warn)',
  spread: 'var(--bad)',
  detect: 'var(--accent)',
  mitigate: 'var(--good)',
  recover: 'var(--good)',
  lesson: 'var(--accent)',
  'what-if': 'var(--mag)',
};

const NW = 156;
const NH = 50;

export default function ProdOutageReplay() {
  const [params, setParams] = useState<Params>({ incident: INCIDENTS[0].id, guard: false });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const inc = incidentById(params.incident);
  const pos = Object.fromEntries(inc.nodes.map((n) => [n.id, n]));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<string>
            label="Outage"
            value={params.incident}
            options={INCIDENTS.map((x) => ({ value: x.id, label: x.label }))}
            onChange={(incident) => setParams((p) => ({ ...p, incident }))}
          />
          <Choice<'real' | 'guard'>
            label="Replay"
            value={params.guard ? 'guard' : 'real'}
            options={[
              { value: 'real', label: 'What happened' },
              { value: 'guard', label: `What-if: ${inc.guard.label}` },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, guard: v === 'guard' }))}
          />
        </>
      }
      legend={
        <>
          {(Object.keys(STATE_STYLE) as NodeState[]).map((s) => (
            <span key={s} className="pil-leg">
              <span className="pil-swatch" style={{ background: STATE_STYLE[s].fill, border: `2px solid ${STATE_STYLE[s].stroke}` }} aria-hidden />
              {STATE_STYLE[s].tag}
            </span>
          ))}
        </>
      }
    >
      <ol className="por-strip" aria-label="Timeline steps">
        {f.timeline.map((st, i) => (
          <li key={i}>
            <button
              type="button"
              className={`por-step ${i === f.index ? 'on' : ''} ${i < f.index ? 'past' : ''}`}
              style={{ ['--por-c' as string]: PHASE_COLOR[st.phase] }}
              onClick={() => stepper.seek(i + 1)}
              aria-current={i === f.index ? 'step' : undefined}
              aria-label={`Step ${i + 1}: ${st.time}, ${PHASE_LABEL[st.phase]}`}
            >
              <span className="por-time">{st.time}</span>
              <span className="por-phase">{PHASE_LABEL[st.phase].replace(' (our illustration)', '')}</span>
            </button>
          </li>
        ))}
      </ol>
      <Tiles
        label="Incident summary"
        tiles={[
          { label: 'when', value: inc.when.replace(/ \(.*\)$/, ''), sub: `${inc.section} · ${inc.when.match(/\((.*)\)$/)?.[1] ?? ''}` },
          { label: 'impact now', value: f.step?.impact ?? '–', tone: f.step ? (f.step.phase === 'recover' || f.step.phase === 'lesson' ? 'good' : f.step.phase === 'what-if' ? 'warn' : f.step.phase === 'mitigate' ? 'warn' : 'bad') : 'neutral' },
          { label: 'phase', value: f.step ? PHASE_LABEL[f.step.phase].replace(' (our illustration)', '') : 'not started' },
        ]}
      />
      <p className="pil-note">
        <span className="pil-kicker">Failure shape (pattern map)</span>
        {inc.shape}
      </p>
      {f.step?.phase === 'what-if' && (
        <p className="pil-note tone-warn">
          <span className="pil-kicker">Illustration</span>
          This branch replays the fix {inc.label.split(' ')[0]} announced. It is not part of the postmortem timeline.
        </p>
      )}
      <svg viewBox="0 0 600 236" className="viz-svg" role="img" aria-label={`Components: ${inc.nodes.map((n) => `${n.label} ${STATE_STYLE[f.states[n.id]].tag}`).join(', ')}.`}>
        {inc.edges.map(([a, b]) => {
          const A = pos[a];
          const B = pos[b];
          const bad = f.states[a] === 'down' || f.states[b] === 'down';
          return <line key={`${a}-${b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={bad ? 'var(--bad)' : 'var(--line-2)'} strokeWidth={bad ? 2 : 1.5} strokeDasharray={bad ? '5 4' : undefined} />;
        })}
        {inc.nodes.map((n) => {
          const st = STATE_STYLE[f.states[n.id]];
          return (
            <g key={n.id}>
              {/* opaque underlay so edges never show through a tinted fill */}
              <rect x={n.x - NW / 2} y={n.y - NH / 2} width={NW} height={NH} rx={10} fill="var(--surface)" />
              <rect
                x={n.x - NW / 2}
                y={n.y - NH / 2}
                width={NW}
                height={NH}
                rx={10}
                fill={st.fill}
                stroke={st.stroke}
                strokeWidth={f.states[n.id] === 'ok' ? 1.5 : 2.5}
                style={{ transition: 'fill 0.35s ease, stroke 0.35s ease' }}
              />
              <text x={n.x} y={n.sub ? n.y - 3 : n.y + 4} textAnchor="middle" fontSize={12} fontWeight={700}>
                {n.label}
              </text>
              {n.sub && (
                <text x={n.x} y={n.y + 13} textAnchor="middle" fontSize={10} className="viz-label">
                  {n.sub}
                </text>
              )}
              {f.states[n.id] !== 'ok' && (
                <text x={n.x + NW / 2 - 6} y={n.y - NH / 2 - 4} textAnchor="end" fontSize={9.5} fontWeight={700} style={{ fill: st.stroke }}>
                  {st.tag.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </VizFrame>
  );
}
