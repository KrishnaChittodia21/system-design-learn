import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building,
  Calculator,
  CodeXml,
  Compass,
  Dumbbell,
  GraduationCap,
  Hammer,
  ListTree,
  MessagesSquare,
  PanelLeft,
  Save,
  Search,
  Target,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { COMPANY_QUESTIONS, PHASES, TOPICS } from '../content';
import { useProgress } from '../lib/progress';
import { nextStep } from '../lib/nextStep';
import { useFocusTrap } from '../lib/useFocusTrap';
import { closeTour } from '../lib/guide';
import { saveUiPrefs } from '../lib/uiPrefs';

const LOOP = [
  { icon: BookOpen, label: 'Learn', why: 'Short sections with diagrams and interactive animations. Tick "Read" as you go.' },
  { icon: CodeXml, label: 'Code Lab', why: 'Fix naive code the way a senior engineer would, then compare with the reference.' },
  { icon: MessagesSquare, label: 'Interview Qs', why: 'Answer out loud first, then check the model answer and the follow-ups.' },
  { icon: Calculator, label: 'Back-of-Envelope', why: 'Estimation drills, revealed one step at a time.' },
  { icon: GraduationCap, label: 'Exam', why: 'A timed scenario exam. Passing it marks the topic done.' },
  { icon: Hammer, label: 'Capstone', why: 'Some topics have a real project judged by tests. Pass every exam to unlock the company track.' },
];

const PLACES = [
  { icon: PanelLeft, label: 'Sidebar', why: 'Every phase and topic, with a coloured dot for your status.' },
  { icon: ListTree, label: 'Contents', why: 'One page listing every topic, section, animation and practice page, with search.' },
  { icon: Search, label: 'Search: ⌘K / Ctrl+K', why: 'Press it anywhere to jump to any topic, section or company question by typing.' },
  { icon: Target, label: 'Weak Areas', why: 'The sections behind the questions you miss, and drills to fix them.' },
  { icon: Building, label: 'Company track', why: `${COMPANY_QUESTIONS.length} real company questions with mock-interview timers.` },
];

/** First-visit welcome tour (also opened from the Guide button or the "?" key). */
export default function WelcomeTour() {
  const p = useProgress();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const ref = useRef<HTMLDivElement>(null);
  const next = useMemo(() => nextStep(p, TOPICS, { companyTotal: COMPANY_QUESTIONS.length }), [p]);
  const close = useCallback(() => {
    saveUiPrefs({ tourSeen: true });
    closeTour();
  }, []);
  useFocusTrap(ref, true, close);
  const steps = STEPS(next.title);
  const last = steps.length - 1;
  const go = (i: number) => {
    setDir(i > step ? 1 : -1);
    setStep(Math.max(0, Math.min(last, i)));
  };
  const finish = (href: string) => {
    close();
    nav(href);
  };
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') go(step + 1);
    if (e.key === 'ArrowLeft') go(step - 1);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <motion.div
        ref={ref}
        className="modal tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        onKeyDown={onKey}
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <div className="tour-top">
          <span className="eyebrow">
            <Compass size={14} aria-hidden /> Guide · step {step + 1} of {steps.length}
          </span>
          <button type="button" className="btn-ghost btn-icon" aria-label="Close guide" onClick={close}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="tour-stage">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -24 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <h2 id="tour-title">{steps[step].title}</h2>
              {steps[step].body}
              {step === last && (
                <div className="tour-cta">
                  <button type="button" className="btn btn-primary btn-lg" data-autofocus onClick={() => finish(next.href)}>
                    Start here: {next.title} <ArrowRight size={16} aria-hidden />
                  </button>
                  <button type="button" className="btn" onClick={() => finish('/contents')}>
                    <ListTree size={16} aria-hidden /> Show me the Contents
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="tour-foot">
          <button type="button" className="btn-ghost" onClick={close}>
            Skip
          </button>
          <div className="tour-dots" role="group" aria-label="Guide steps">
            {steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                className={`tour-dot ${i === step ? 'on' : ''}`}
                aria-label={`Step ${i + 1}: ${s.title}`}
                aria-current={i === step ? 'step' : undefined}
                onClick={() => go(i)}
              />
            ))}
          </div>
          <div className="row gap-s">
            <button type="button" className="btn" onClick={() => go(step - 1)} disabled={step === 0} aria-label="Previous step">
              <ArrowLeft size={16} aria-hidden /> Back
            </button>
            {step < last ? (
              <button type="button" className="btn btn-primary" onClick={() => go(step + 1)} data-autofocus={step === 0 ? true : undefined}>
                Next <ArrowRight size={16} aria-hidden />
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={close}>
                Done
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function STEPS(nextTitle: string) {
  return [
    {
      title: 'Welcome: system design interview prep',
      body: (
        <>
          <p className="lead">
            Learn {TOPICS.length} system design topics step by step, practise them the way interviews test them, and finish with
            real company questions.
          </p>
          <ol className="tour-path" aria-label="Phases">
            {PHASES.map((ph, i) => (
              <motion.li
                key={ph.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 * i, duration: 0.2 }}
              >
                <span className="tour-path-num">{ph.number}</span>
                <span>{ph.title}</span>
              </motion.li>
            ))}
            <motion.li className="goal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.03 * PHASES.length }}>
              <span className="tour-path-num">
                <Building size={12} aria-hidden />
              </span>
              <span>Company track</span>
            </motion.li>
          </ol>
        </>
      ),
    },
    {
      title: 'The study loop for every topic',
      body: (
        <>
          <p>Each topic page has a study path at the top. Follow it left to right:</p>
          <ol className="tour-loop">
            {LOOP.map(({ icon: Icon, label, why }, i) => (
              <motion.li
                key={label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.08 * i, duration: 0.22, ease: 'easeOut' }}
              >
                <span className="tour-loop-icon">
                  <Icon size={18} aria-hidden />
                </span>
                <span>
                  <strong>{label}</strong>
                  <span className="muted small"> · {why}</span>
                </span>
              </motion.li>
            ))}
          </ol>
        </>
      ),
    },
    {
      title: 'Where things are',
      body: (
        <ul className="tour-places">
          {PLACES.map(({ icon: Icon, label, why }) => (
            <li key={label}>
              <Icon size={18} aria-hidden />
              <span>
                <strong>{label}</strong> <span className="muted">· {why}</span>
              </span>
            </li>
          ))}
          <li>
            <Dumbbell size={18} aria-hidden />
            <span>
              <strong>Your next step</strong> <span className="muted">· the dashboard always shows one obvious thing to do next.</span>
            </span>
          </li>
        </ul>
      ),
    },
    {
      title: 'Your progress is saved automatically',
      body: (
        <div className="tour-save">
          <Save size={36} aria-hidden className="tour-save-icon" />
          <ul>
            <li>Everything you read, rate, draft and score is saved in this browser as you go. There is no account.</li>
            <li>
              It resets only if you press <strong>Reset progress</strong> in Settings, clear this site&apos;s data, or use another browser
              or a private window.
            </li>
            <li>The app reopens where you left off.</li>
          </ul>
        </div>
      ),
    },
    {
      title: 'Ready? Start here',
      body: (
        <p className="lead">
          Your next step is <strong>{nextTitle}</strong>. You can reopen this guide any time with the <Compass size={14} aria-hidden />{' '}
          Guide button or the <kbd>?</kbd> key.
        </p>
      ),
    },
  ];
}
