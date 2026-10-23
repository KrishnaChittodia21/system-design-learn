import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  CodeXml,
  FileText,
  GraduationCap,
  Hammer,
  Lock,
  MessagesSquare,
  Puzzle,
} from 'lucide-react';
import type { StepId, TopicStep } from '../lib/nextStep';

const ICONS = {
  learn: BookOpen,
  code: CodeXml,
  interview: MessagesSquare,
  envelope: Calculator,
  exam: GraduationCap,
  capstone: Hammer,
} as const;

export type TabId = StepId | 'cheat' | 'challenge';

/** Display order of the tabs (the study-path order itself comes from `steps`). */
const ORDER: TabId[] = ['learn', 'code', 'interview', 'envelope', 'cheat', 'capstone', 'exam', 'challenge'];

/**
 * The topic's study path as a glowing tab bar (each step switches `?tab=`).
 * Step states: done, current (the next thing to do), todo, locked (study-first lock).
 * `counts` overrides the number in a tab's count pill (e.g. the exam's question count).
 * `challenge` adds the end-of-topic Challenge tab (last); it is not a study-path step, so it never changes completion.
 */
export function StudyPath({
  steps,
  active,
  locks,
  onSelect,
  counts,
  challenge,
}: {
  steps: TopicStep[];
  active: TabId;
  locks: Partial<Record<TabId, boolean>>;
  onSelect: (id: TabId) => void;
  counts?: Partial<Record<TabId, number>>;
  /** solved / total puzzles when the topic has a challenge (null: no Challenge tab) */
  challenge?: { solved: number; total: number } | null;
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

  // The bar's scrollbar is hidden, so show which tabs are cut off on each side ("2 more ›") — otherwise a tab at the
  // end (e.g. Challenge) is easy to miss on narrow screens.
  const [hidden, setHidden] = useState<{ left: string[]; right: string[] }>({ left: [], right: [] });
  const measure = useCallback(() => {
    const box = bar.current;
    if (!box) return;
    const b = box.getBoundingClientRect();
    const left: string[] = [];
    const right: string[] = [];
    if (box.scrollWidth > box.clientWidth + 1) {
      // a tab counts as hidden when less than 2/3 of it is visible inside the bar
      box.querySelectorAll<HTMLElement>('[role="tab"]').forEach((t) => {
        const r = t.getBoundingClientRect();
        const visible = Math.min(r.right, b.right) - Math.max(r.left, b.left);
        if (visible >= r.width * 0.66) return;
        const name = t.querySelector('.tp-tab-lbl')?.textContent ?? '';
        (r.left < b.left ? left : right).push(name);
      });
    }
    setHidden((h) => (h.left.join() === left.join() && h.right.join() === right.join() ? h : { left, right }));
  }, []);
  useEffect(() => {
    const box = bar.current;
    if (!box) return;
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => {
      box.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [measure]);
  // tabs can appear later (the Challenge tab loads lazily) or change width (counts)
  useEffect(measure, [measure, steps, challenge, active]);

  const page = (dir: 1 | -1) => {
    const box = bar.current;
    if (!box) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollBy({ left: dir * box.clientWidth * 0.7, behavior: smooth ? 'smooth' : 'auto' });
  };

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

  if (challenge) {
    const all = challenge.total > 0 && challenge.solved >= challenge.total;
    tabs.set(
      'challenge',
      <button
        key="challenge"
        type="button"
        role="tab"
        aria-selected={active === 'challenge'}
        className={`tp-tab ${all ? 'done' : ''}`}
        onClick={() => onSelect('challenge')}
        title="End-of-topic challenge: puzzles that put the topic to work"
      >
        {active === 'challenge' && indicator}
        <span className="tp-tab-ic" aria-hidden>
          <Puzzle size={16} />
        </span>
        <span className="tp-tab-lbl">Challenge</span>
        {challenge.total > 0 && (
          <span className={`tp-tab-c ${all ? 'ok' : ''}`} aria-hidden>
            {all ? <Check size={13} strokeWidth={3} /> : challenge.solved ? `${challenge.solved}/${challenge.total}` : challenge.total}
          </span>
        )}
        <span className="sr-only">
          , {challenge.solved} of {challenge.total} puzzles solved
        </span>
      </button>,
    );
  }

  // the "more" buttons are mouse/touch helpers: keyboard users reach every tab with Tab/arrow keys, and a focused tab
  // scrolls itself into view, so the buttons stay out of the tab order
  return (
    <div className={`tp-tabs-wrap${hidden.left.length ? ' more-left' : ''}${hidden.right.length ? ' more-right' : ''}`}>
      <div className="tp-tabs glass" role="tablist" aria-label="Study path" ref={bar}>
        {ORDER.filter((id) => tabs.has(id)).map((id) => tabs.get(id))}
      </div>
      {hidden.left.length > 0 && (
        <button
          type="button"
          className="tp-tabs-more left"
          tabIndex={-1}
          onClick={() => page(-1)}
          title={`More tabs: ${hidden.left.join(', ')}`}
          aria-label={`Scroll tabs left: ${hidden.left.join(', ')}`}
        >
          <ChevronLeft size={16} strokeWidth={2.5} aria-hidden />
          <span className="n">{hidden.left.length}</span>
        </button>
      )}
      {hidden.right.length > 0 && (
        <button
          type="button"
          className="tp-tabs-more right"
          tabIndex={-1}
          onClick={() => page(1)}
          title={`More tabs: ${hidden.right.join(', ')}`}
          aria-label={`Scroll tabs right: ${hidden.right.join(', ')}`}
        >
          <span className="n">{hidden.right.length} more</span>
          <ChevronRight size={16} strokeWidth={2.5} aria-hidden />
        </button>
      )}
    </div>
  );
}
