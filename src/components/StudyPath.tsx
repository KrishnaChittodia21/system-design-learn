import { useEffect, useRef, type ReactNode } from 'react';
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

/** Display order of the tabs (the study-path order itself comes from `steps`). */
const ORDER: TabId[] = ['learn', 'code', 'interview', 'envelope', 'cheat', 'capstone', 'exam'];

/**
 * The topic's study path as a glowing tab bar (each step switches `?tab=`).
 * Step states: done, current (the next thing to do), todo, locked (study-first lock).
 * `counts` overrides the number in a tab's count pill (e.g. the exam's question count).
 */
export function StudyPath({
  steps,
  active,
  locks,
  onSelect,
  counts,
}: {
  steps: TopicStep[];
  active: TabId;
  locks: Partial<Record<TabId, boolean>>;
  onSelect: (id: TabId) => void;
  counts?: Partial<Record<TabId, number>>;
}) {
  const current = steps.find((s) => !s.complete && s.id !== 'capstone')?.id;
  const bar = useRef<HTMLDivElement>(null);
  // keep the open tab in view when the bar scrolls sideways (narrow screens)
  useEffect(() => {
    const box = bar.current;
    const el = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2 });
  }, [active]);

  const indicator = (
    <motion.span layoutId="study-path-indicator" className="tp-tab-ind" transition={{ type: 'spring', stiffness: 500, damping: 40 }} aria-hidden />
  );

  const tabs = new Map<TabId, ReactNode>();
  steps.forEach((s, i) => {
    const Icon = ICONS[s.id];
    const state = locks[s.id] ? 'locked' : s.complete ? 'done' : s.id === current ? 'current' : 'todo';
    const isActive = active === s.id;
    const count = counts?.[s.id] ?? s.total;
    const partial = state !== 'done' && s.id !== 'exam' && s.id !== 'capstone' && s.done > 0;
    tabs.set(
      s.id,
      <button
        key={s.id}
        type="button"
        role="tab"
        aria-selected={isActive}
        className={`tp-tab ${state}`}
        onClick={() => onSelect(s.id)}
        title={state === 'locked' ? 'Read every Learn section first' : `Step ${i + 1}: ${s.label} (${s.progress})`}
      >
        {isActive && indicator}
        <span className="tp-tab-ic" aria-hidden>
          {state === 'locked' ? <Lock size={15} /> : <Icon size={16} />}
        </span>
        <span className="tp-tab-lbl">{s.label}</span>
        <span className={`tp-tab-c ${state === 'done' ? 'ok' : ''}`} aria-hidden>
          {state === 'done' ? <Check size={13} strokeWidth={3} /> : partial ? `${s.done}/${count}` : count}
        </span>
        {state === 'current' && <span className="tp-tab-now" aria-hidden />}
        <span className="sr-only">
          , {s.progress}, {state === 'current' ? 'next step' : state}
        </span>
      </button>,
    );
  });
  tabs.set(
    'cheat',
    <button key="cheat" type="button" role="tab" aria-selected={active === 'cheat'} className="tp-tab" onClick={() => onSelect('cheat')}>
      {active === 'cheat' && indicator}
      <span className="tp-tab-ic" aria-hidden>
        <FileText size={16} />
      </span>
      <span className="tp-tab-lbl">Cheat Sheet</span>
      <span className="sr-only">, revise</span>
    </button>,
  );

  return (
    <div className="tp-tabs glass" role="tablist" aria-label="Study path" ref={bar}>
      {ORDER.filter((id) => tabs.has(id)).map((id) => tabs.get(id))}
    </div>
  );
}
