import { motion } from 'motion/react';
import { BookOpen, Calculator, Check, CodeXml, FileText, GraduationCap, Hammer, Lock, MessagesSquare } from 'lucide-react';
import type { StepId, TopicStep } from '../lib/nextStep';

const ICONS = {
  learn: BookOpen,
  code: CodeXml,
  interview: MessagesSquare,
  envelope: Calculator,
  exam: GraduationCap,
  capstone: Hammer,
} as const;

export type TabId = StepId | 'cheat';

/**
 * The topic's study path as a stepper (it is also the tab bar: each step switches `?tab=`).
 * Step states: done, current (the next thing to do), todo, locked (study-first lock).
 */
export function StudyPath({
  steps,
  active,
  locks,
  onSelect,
}: {
  steps: TopicStep[];
  active: TabId;
  locks: Partial<Record<TabId, boolean>>;
  onSelect: (id: TabId) => void;
}) {
  const current = steps.find((s) => !s.complete && s.id !== 'capstone')?.id;
  return (
    <div className="study-path" role="tablist" aria-label="Study path">
      <ol className="study-steps">
        {steps.map((s, i) => {
          const Icon = ICONS[s.id];
          const state = locks[s.id] ? 'locked' : s.complete ? 'done' : s.id === current ? 'current' : 'todo';
          const isActive = active === s.id;
          return (
            <li key={s.id} className={`study-step-wrap ${state}`}>
              {i > 0 && <span className={`study-connector ${steps[i - 1].complete ? 'filled' : ''}`} aria-hidden />}
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`study-step ${state} ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(s.id)}
                title={state === 'locked' ? 'Read every Learn section first' : undefined}
              >
                {isActive && <motion.span layoutId="study-path-indicator" className="study-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span className="study-icon">
                  {state === 'done' ? <Check size={16} aria-hidden /> : state === 'locked' ? <Lock size={15} aria-hidden /> : <Icon size={16} aria-hidden />}
                </span>
                <span className="study-text">
                  <span className="study-label">
                    <span className="study-num">{i + 1}.</span> {s.label}
                  </span>
                  <span className="study-progress">
                    {s.progress}
                    <span className="sr-only">, {state === 'current' ? 'next step' : state}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'cheat'}
        className={`study-step study-extra ${active === 'cheat' ? 'active' : ''}`}
        onClick={() => onSelect('cheat')}
      >
        {active === 'cheat' && <motion.span layoutId="study-path-indicator" className="study-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
        <span className="study-icon">
          <FileText size={16} aria-hidden />
        </span>
        <span className="study-text">
          <span className="study-label">Cheat Sheet</span>
          <span className="study-progress">revise</span>
        </span>
      </button>
    </div>
  );
}
