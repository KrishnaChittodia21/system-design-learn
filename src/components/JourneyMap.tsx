import { motion } from 'motion/react';
import { Check, Lock, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Phase } from '../content/phases';
import { shortTitle } from '../lib/labels';

export interface JourneyPhase {
  phase: Phase;
  passed: number;
  total: number;
}

/** The phases as connected nodes along a path that fills as phases are completed; the company track is the goal. */
export function JourneyMap({ phases, unlocked, onSelect }: { phases: JourneyPhase[]; unlocked: boolean; onSelect: (id: string) => void }) {
  const complete = phases.filter((x) => x.total > 0 && x.passed === x.total).length;
  // the path fills up to the last fully completed phase in course order
  const reached = phases.findIndex((x) => x.passed < x.total);
  const filled = reached === -1 ? phases.length : reached;
  const fillPct = (filled / phases.length) * 100;
  return (
    <section className="card journey" aria-labelledby="journey-title">
      <div className="row between wrap">
        <h2 id="journey-title">Your journey</h2>
        <span className="small muted">
          {complete}/{phases.length} phases complete
        </span>
      </div>
      <div className="journey-scroll">
        <ol className="journey-path" style={{ ['--nodes' as string]: phases.length + 1 }}>
          <span className="journey-track" aria-hidden>
            <motion.span className="journey-fill" initial={{ width: 0 }} animate={{ width: `${fillPct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
          </span>
          {phases.map(({ phase, passed, total }, i) => {
            const state = passed === total ? 'done' : i === filled ? 'current' : passed > 0 ? 'started' : 'todo';
            const pct = total ? passed / total : 0;
            return (
              <li key={phase.id} className={`journey-node ${state}`}>
                <motion.button
                  type="button"
                  onClick={() => onSelect(phase.id)}
                  aria-label={`Phase ${phase.number}: ${phase.title}, ${passed} of ${total} topics passed`}
                  title={phase.title}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.95 }}
                  style={{ ['--pct' as string]: `${Math.round(pct * 360)}deg` }}
                >
                  <span className="journey-dot">{state === 'done' ? <Check size={16} aria-hidden /> : phase.number}</span>
                </motion.button>
                <span className="journey-label">{shortTitle(phase.title)}</span>
              </li>
            );
          })}
          <li className={`journey-node goal ${unlocked ? 'done' : 'locked'}`}>
            <Link to="/companies" aria-label={unlocked ? 'Company track: unlocked' : 'Company track: locked until every exam is passed'}>
              <span className="journey-dot">{unlocked ? <Trophy size={16} aria-hidden /> : <Lock size={15} aria-hidden />}</span>
            </Link>
            <span className="journey-label">Company track</span>
          </li>
        </ol>
      </div>
    </section>
  );
}
