import type { CSSProperties } from 'react';
import type { PhaseProgress } from '../lib/metrics';
import { phaseCode } from '../lib/labels';
import { phaseState, type PhaseState } from './phaseState';

const LABEL_COLOR: Record<PhaseState, string> = { done: 'var(--cyan)', now: 'var(--amber)', prog: 'var(--ink-2)', todo: 'var(--ink-4)' };
const GAP = 0.45; // % of the circle left empty between two phase arcs

/** conic-gradient of the topic ring: one arc per phase, sized by its topic count, filled passed → in progress → rest */
function ringGradient(phases: PhaseProgress[]) {
  const total = phases.reduce((n, ph) => n + ph.total, 0) || 1;
  const stops: string[] = [];
  const labels: { id: string; n: number; angle: number }[] = [];
  let acc = 0;
  for (const ph of phases) {
    const a0 = (acc / total) * 100;
    const a1 = ((acc + ph.total) / total) * 100;
    const span = Math.max(0, a1 - a0 - (phases.length > 1 ? GAP : 0));
    const pp = a0 + (span * ph.passed) / Math.max(1, ph.total);
    const ii = pp + (span * ph.inProgress) / Math.max(1, ph.total);
    const f = (n: number) => `${n.toFixed(2)}%`;
    stops.push(`var(--cyan) ${f(a0)} ${f(pp)}`, `var(--amber) ${f(pp)} ${f(ii)}`, `var(--tint-2) ${f(ii)} ${f(a0 + span)}`, `transparent ${f(a0 + span)} ${f(a1)}`);
    labels.push({ id: ph.id, n: ph.number, angle: ((a0 + span / 2) / 100) * 2 * Math.PI });
    acc += ph.total;
  }
  return { grad: `conic-gradient(${stops.join(',')})`, labels };
}

const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);
const sweep = (color: string, share: number) => `conic-gradient(${color} 0 ${share.toFixed(2)}%, transparent ${share.toFixed(2)}%)`;
const rw = (px: number) => ({ '--rw': `${px}px` }) as CSSProperties;

export interface RingFigures {
  phases: PhaseProgress[];
  currentPhaseId?: string;
  passed: number;
  topics: number;
  sectionsRead: number;
  sectionsTotal: number;
  iqRated: number;
  iqTotal: number;
}

/**
 * The dashboard's signature diagram: a "hash ring" of every topic in phase arcs (passed cyan, in progress amber),
 * inner rings for Learn sections read (blue) and interview questions rated (magenta), orbiting dots, and the share
 * of topics passed in the core. `compact` is the phone version: the topic ring and the core only.
 * The orbiting dots are hidden with reduced motion (base.css); the rings themselves are static.
 */
export function HeroDiagram({ f, compact = false }: { f: RingFigures; compact?: boolean }) {
  const { grad, labels } = ringGradient(f.phases);
  const passedPct = Math.round(pct(f.passed, f.topics));
  const states = new Map(f.phases.map((ph) => [ph.id, phaseState(ph, f.currentPhaseId)]));
  const inProgress = f.phases.reduce((n, ph) => n + ph.inProgress, 0);

  if (compact) {
    return (
      <div className="td-ring td-ring-compact" role="img" aria-label={`Topic ring: ${f.passed} of ${f.topics} topics passed (${passedPct}%), ${inProgress} in progress.`}>
        <div className="nb-ring td-ring-arcs" style={{ ...rw(10), background: grad }} />
        <div className="orbit slow" aria-hidden>
          <span className="orbit-dot" />
        </div>
        <div className="td-ring-core">
          <div>
            <div className="num gtext td-ring-pct">{passedPct}%</div>
            <div className="eyebrow td-ring-cap">passed</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <figure className="td-ringfig">
      <div
        className="td-ring"
        role="img"
        aria-label={`Ring of ${f.topics} topics in ${f.phases.length} phase arcs: ${f.passed} passed, ${inProgress} in progress. Learn sections read ${f.sectionsRead} of ${f.sectionsTotal}. Interview questions rated ${f.iqRated} of ${f.iqTotal}.`}
      >
        <div className="td-ring-l1">
          <div className="nb-ring td-ring-arcs" style={{ ...rw(16), background: grad }} />
          <div className="orbit slow" aria-hidden>
            <span className="orbit-dot" />
          </div>
          {labels.map((l) => (
            <span
              key={l.id}
              className="mono td-ring-lbl"
              aria-hidden
              style={{ left: `${50 + 54.8 * Math.sin(l.angle)}%`, top: `${50 - 54.8 * Math.cos(l.angle)}%`, color: LABEL_COLOR[states.get(l.id) ?? 'todo'] }}
            >
              {phaseCode(l.n)}
            </span>
          ))}
          <div className="td-ring-l2">
            <div className="nb-ring td-ring-base" style={rw(9)} />
            <div className="nb-ring td-ring-sec" style={{ ...rw(9), background: sweep('var(--blue)', pct(f.sectionsRead, f.sectionsTotal)) }} />
            <div className="orbit rev" aria-hidden>
              <span className="orbit-dot td-dot-blue" />
            </div>
            <div className="td-ring-l3">
              <div className="nb-ring td-ring-base" style={rw(7)} />
              <div className="nb-ring td-ring-iq" style={{ ...rw(7), background: sweep('var(--mag)', pct(f.iqRated, f.iqTotal)) }} />
              <div className="td-ring-core">
                <div>
                  <div className="eyebrow td-ring-cap">Exams passed</div>
                  <div className="num gtext td-ring-pct">{passedPct}%</div>
                  <div className="mono td-ring-sub">
                    {f.passed} / {f.topics} topics
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        <ul className="td-legend td-ring-legend">
          <li>
            <span className="dot td-key-cyan" aria-hidden />
            Outer: topics by phase
          </li>
          <li>
            <span className="dot" style={{ background: 'var(--blue)' }} aria-hidden />
            Sections {f.sectionsRead}/{f.sectionsTotal}
          </li>
          <li>
            <span className="dot" style={{ background: 'var(--mag)' }} aria-hidden />
            Interview Qs {f.iqRated}/{f.iqTotal}
          </li>
        </ul>
      </figcaption>
    </figure>
  );
}
