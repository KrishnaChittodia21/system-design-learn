import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { MCQ_TOPIC, TOPICS, TOPIC_BY_ID } from '../content';
import { ArrowLeft, ArrowRight, Check, CircleCheck, CircleX, Flag, Lock, RotateCcw, SkipForward, Target, X } from 'lucide-react';
import { motion } from 'motion/react';
import { CountUp } from '../components/CountUp';
import { NextUp } from '../components/NextUp';
import type { Difficulty, MCQ } from '../types';
import { recordAnswers, recordTest, useProgress } from '../lib/progress';
import { commiserate } from '../lib/commiserate';
import { weakSections } from '../lib/weak';
import { practiceLocked } from '../lib/stats';
import { StudyLock } from './Topic';
import { CodeBlock, FollowUps, Markdown, formatClock } from '../components/ui';

interface Item {
  q: MCQ;
  /** order[displayIndex] = original option index */
  order: number[];
}

type Answers = Record<string, number[]>;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
const LETTERS = 'ABCDEFGH';
const pad2 = (n: number) => String(n).padStart(2, '0');
const DIFF_TONE: Record<Difficulty, string> = { medium: 'blue', hard: 'amber', expert: 'rose' };

/** mono uppercase difficulty stamp (medium = blue, hard = amber, expert = rose) */
export function DiffChip({ d }: { d: Difficulty }) {
  return <span className={`nb-chip ${DIFF_TONE[d]}`}>{d}</span>;
}

export default function ExamPage() {
  const { id = '' } = useParams();
  const p = useProgress();
  const topic = TOPIC_BY_ID.get(id);
  if (!topic) return <div className="page">Topic not found</div>;
  if (practiceLocked(p, topic, 'exam')) {
    return (
      <div className="page">
        <Link to={`/topic/${topic.id}`} className="ex-back">
          <ArrowLeft size={15} aria-hidden /> {topic.title}
        </Link>
        <StudyLock topic={topic} what="exam" />
      </div>
    );
  }
  return (
    <Exam
      key={topic.id}
      title={topic.title}
      questions={topic.test}
      recordTopicId={topic.id}
      backHref={`/topic/${topic.id}?tab=exam`}
    />
  );
}

export interface ExamProps {
  title: string;
  questions: MCQ[];
  /** full-length attempts count towards this topic's pass; omit for practice drills */
  recordTopicId?: string;
  backHref: string;
}

export function Exam({ title, questions, recordTopicId, backHref }: ExamProps) {
  const p = useProgress();
  const total = questions.length;
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup');
  const [count, setCount] = useState(total);
  const [minutes, setMinutes] = useState(Math.ceil((total * p.settings.secondsPerQuestion) / 60));
  const [shuffleOn, setShuffleOn] = useState(p.settings.shuffle);
  // interview mode: lock each answer, then see feedback and the interviewer's follow-ups at once
  const [interviewMode, setInterviewMode] = useState(true);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<Item[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [cur, setCur] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [limitSecs, setLimitSecs] = useState(60);
  const deadline = useRef(0);
  const startedAt = useRef(0);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'wrong'>('all');
  const drill = !recordTopicId;
  const kind = drill ? 'Mistakes drill' : 'Timed exam';

  const start = () => {
    const qs = shuffleOn ? shuffle(questions) : questions;
    const chosen = qs.slice(0, count).map((q) => {
      const idx = q.options.map((_, i) => i);
      return { q, order: shuffleOn ? shuffle(idx) : idx };
    });
    setItems(chosen);
    setAnswers({});
    setFlagged(new Set());
    setLocked(new Set());
    setCur(0);
    const secs = Math.max(1, minutes) * 60;
    startedAt.current = Date.now();
    deadline.current = Date.now() + secs * 1000;
    setLimitSecs(secs);
    setRemaining(secs);
    setPhase('running');
  };

  const score = useMemo(() => {
    if (!items.length) return 0;
    const correct = items.filter((it) => sameSet(answers[it.q.id] ?? [], it.q.correct)).length;
    return Math.round((correct / items.length) * 100);
  }, [items, answers]);

  const submit = useCallback(() => {
    setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
    setPhase('done');
  }, []);

  // record result once when finishing a full-length exam (and commiserate once if it's below the pass mark)
  const passMark = p.settings.passMark;
  const recorded = useRef(false);
  useEffect(() => {
    if (phase === 'running') recorded.current = false;
    if (phase === 'done' && !recorded.current) {
      recorded.current = true;
      recordAnswers(items.map((it) => ({ id: it.q.id, correct: sameSet(answers[it.q.id] ?? [], it.q.correct) })));
      if (recordTopicId && items.length === total) recordTest(recordTopicId, score);
      if (items.length && score < passMark) commiserate(`Not yet — ${score}%`, 'Every miss is a pointer. Review the answers below, then retake.');
    }
  }, [phase, items, answers, total, recordTopicId, score, passMark]);

  // countdown
  useEffect(() => {
    if (phase !== 'running') return;
    const t = setInterval(() => {
      const left = Math.round((deadline.current - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) submit();
    }, 250);
    return () => clearInterval(t);
  }, [phase, submit]);

  // guard against leaving mid-exam
  const blocker = useBlocker(phase === 'running');
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Leave the exam? Your progress in this attempt will be lost.')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (phase !== 'running') return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [phase]);

  // a new attempt or the results start at the top of the page
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase]);

  const toggle = useCallback(
    (item: Item, original: number) => {
      setAnswers((a) => {
        const prev = a[item.q.id] ?? [];
        const multi = item.q.correct.length > 1;
        const next = multi
          ? prev.includes(original)
            ? prev.filter((x) => x !== original)
            : [...prev, original]
          : [original];
        return { ...a, [item.q.id]: next };
      });
    },
    [],
  );

  const toggleFlag = useCallback((qid: string) => {
    setFlagged((f) => {
      const s = new Set(f);
      if (s.has(qid)) s.delete(qid);
      else s.add(qid);
      return s;
    });
  }, []);

  const lockIn = useCallback((qid: string) => setLocked((l) => new Set(l).add(qid)), []);

  // keyboard: 1-5 choose, ←/→ navigate, f flag, Enter lock in (interview mode)
  useEffect(() => {
    if (phase !== 'running') return;
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      const item = items[cur];
      if (!item) return;
      const n = Number(e.key);
      if (n >= 1 && n <= item.order.length) {
        if (!locked.has(item.q.id)) toggle(item, item.order[n - 1]);
      }
      else if (e.key === 'ArrowRight') setCur((c) => Math.min(items.length - 1, c + 1));
      else if (e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
      else if (e.key.toLowerCase() === 'f') toggleFlag(item.q.id);
      else if (e.key === 'Enter' && interviewMode && !locked.has(item.q.id) && (answers[item.q.id] ?? []).length) {
        // only from the page or an option row, so Enter on Submit / Previous / a link keeps its own meaning
        if (target instanceof HTMLElement && target !== document.body && !target.closest('.ex-opt')) return;
        e.preventDefault();
        lockIn(item.q.id);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [phase, items, cur, toggle, locked, toggleFlag, lockIn, interviewMode, answers]);

  if (phase === 'setup') {
    const perQ = Math.round((minutes * 60) / Math.max(1, count));
    const best = recordTopicId ? p.tests[recordTopicId]?.best : undefined;
    const minCount = Math.min(5, total);
    const fill = total > minCount ? ((count - minCount) / (total - minCount)) * 100 : 100;
    return (
      <div className="page ex-page ex-setup">
        <Link to={backHref} className="ex-back">
          <ArrowLeft size={15} aria-hidden /> Back
        </Link>
        <header className="ex-setup-head">
          <div className="eyebrow ex-eyebrow">{kind} · setup</div>
          <h1>{title}</h1>
          <p className="lead">
            {drill
              ? 'Questions whose latest answer was wrong. Each one you get right leaves your weak areas.'
              : `${total} questions on this topic. Score ${p.settings.passMark}% or more on a full-length attempt to pass it.`}
          </p>
        </header>

        <div className="ex-setup-grid">
          <section className="card ex-setup-form" aria-label="Exam options">
            <div className="ex-field">
              <div className="ex-field-head">
                <label htmlFor="ex-minutes" className="eyebrow">
                  Time limit
                </label>
                <span className="mono ex-hint">≈ {perQ} s per question</span>
              </div>
              <div className="ex-time">
                <span className="ex-num-input">
                  <input
                    id="ex-minutes"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={240}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value) || 1)}
                  />
                  <span className="mono">min</span>
                </span>
                <div className="ex-presets" role="group" aria-label="Preset time limits">
                  {[5, 10, 15, 20, 30].map((m) => (
                    <button key={m} type="button" className={`chip ${minutes === m ? 'on' : ''}`} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
                      {m}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="ex-field">
              <div className="ex-field-head">
                <label htmlFor="ex-count" className="eyebrow">
                  Questions
                </label>
                <span className="mono ex-hint">
                  <strong>{count}</strong> / {total}
                </span>
              </div>
              <input
                id="ex-count"
                className="ex-range"
                type="range"
                min={minCount}
                max={total}
                value={count}
                style={{ '--fill': `${fill}%` } as CSSProperties}
                onChange={(e) => setCount(Number(e.target.value))}
              />
              {recordTopicId ? (
                count < total && <p className="ex-note warn">Practice mode: only full-length attempts count towards passing.</p>
              ) : (
                <p className="ex-note">Practice drill: updates your weak areas, never affects exam passes.</p>
              )}
            </div>

            <label className="ex-switch">
              <input type="checkbox" checked={shuffleOn} onChange={(e) => setShuffleOn(e.target.checked)} />
              <span className="ex-switch-ui" aria-hidden />
              <span>
                <strong>Shuffle questions and options</strong>
                <span className="ex-switch-sub">A fresh order on every attempt, so you learn the idea and not the position.</span>
              </span>
            </label>
            <label className="ex-switch">
              <input type="checkbox" checked={interviewMode} onChange={(e) => setInterviewMode(e.target.checked)} />
              <span className="ex-switch-ui" aria-hidden />
              <span>
                <strong>Interview mode</strong>
                <span className="ex-switch-sub">
                  Lock each answer to get instant feedback and the interviewer&apos;s follow-ups, like a real interview.
                </span>
              </span>
            </label>
          </section>

          <aside className="gborder ex-setup-side">
            <div className="in">
              <div className="eyebrow">This attempt</div>
              <dl className="ex-stats">
                <div>
                  <dt>Questions</dt>
                  <dd className="num">{count}</dd>
                </div>
                <div>
                  <dt>Minutes</dt>
                  <dd className="num">{minutes}</dd>
                </div>
                <div>
                  <dt>Pass mark</dt>
                  <dd className="num">
                    {p.settings.passMark}
                    <small>%</small>
                  </dd>
                </div>
              </dl>
              <p className="ex-side-note">
                {interviewMode ? 'Interview mode' : 'Classic mode'} · {shuffleOn ? 'shuffled' : 'in order'}
                {best !== undefined && (
                  <>
                    {' '}
                    · best so far <strong>{best}%</strong>
                  </>
                )}
              </p>
              <div className="ex-keys">
                <span>
                  <kbd>1</kbd>–<kbd>5</kbd> select
                </span>
                <span>
                  <kbd>←</kbd>
                  <kbd>→</kbd> navigate
                </span>
                <span>
                  <kbd>F</kbd> flag
                </span>
                {interviewMode && (
                  <span>
                    <kbd>Enter</kbd> lock in
                  </span>
                )}
              </div>
              <button className="btn btn-primary btn-lg ex-start" type="button" onClick={start}>
                Start {drill ? 'drill' : 'exam'} · {minutes} min <ArrowRight size={17} aria-hidden />
              </button>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    const item = items[cur];
    const selected = answers[item.q.id] ?? [];
    const multi = item.q.correct.length > 1;
    const answered = items.filter((it) => (answers[it.q.id] ?? []).length > 0).length;
    const urgent = remaining <= 60;
    const isLocked = interviewMode && locked.has(item.q.id);
    const gotIt = sameSet(selected, item.q.correct);
    const frac = Math.max(0, Math.min(1, remaining / Math.max(1, limitSecs)));
    const isFlagged = flagged.has(item.q.id);
    const last = cur === items.length - 1;
    const best = recordTopicId ? p.tests[recordTopicId]?.best : undefined;
    const doSubmit = () => {
      const un = items.length - answered;
      if (!un || window.confirm(`${un} question(s) unanswered. Submit anyway?`)) submit();
    };
    return (
      <div className="page ex-page ex-run">
        <header className="ex-hud glass">
          <div className="ex-hud-title">
            <div className="eyebrow ex-eyebrow">
              {kind} · {shuffleOn ? 'shuffled' : 'in order'}
              {interviewMode && ' · interview'}
            </div>
            <div className="ex-hud-name">{title}</div>
          </div>
          <div className="ex-hud-progress">
            <div
              className="ex-segs"
              style={{ '--n': items.length } as CSSProperties}
              role="img"
              aria-label={`Question ${cur + 1} of ${items.length}. ${answered} answered, ${flagged.size} flagged.`}
            >
              {items.map((it, i) => {
                const a = (answers[it.q.id] ?? []).length > 0;
                const f = flagged.has(it.q.id);
                return <span key={it.q.id} className={i === cur ? 'c' : f ? 'f' : a ? 'a' : ''} />;
              })}
            </div>
            <div className="mono ex-hud-meta">
              {answered} answered · {flagged.size} flagged · pass mark {p.settings.passMark}%
              <span className="ex-hide-s">{items.some((it) => it.q.correct.length > 1) && ' · multi-select needs an exact match'}</span>
            </div>
          </div>
          <div
            className={`ex-timer ${urgent ? 'urgent' : ''}`}
            role="timer"
            aria-label={`Time left ${formatClock(remaining)}`}
            style={{ '--p': `${frac * 100}%` } as CSSProperties}
          >
            <div className="nb-ring ex-timer-track" />
            <div className="nb-ring ex-timer-fill" />
            <div className="mono ex-timer-txt">{formatClock(remaining)}</div>
          </div>
          <button className="btn btn-sm ex-submit" type="button" onClick={doSubmit}>
            Submit {drill ? 'drill' : 'exam'}
          </button>
        </header>

        <div className="ex-grid">
          <section className="ex-qcard glass" aria-labelledby="ex-qtext">
            <div className="ex-qcard-glow" aria-hidden />
            <div className="ex-qcard-body">
              <div className="ex-qmeta">
                <span className="mono ex-qnum">
                  Q {pad2(cur + 1)} <span>/ {pad2(items.length)}</span>
                </span>
                <DiffChip d={item.q.difficulty} />
                {multi && <span className="nb-chip cyan">Select all that apply</span>}
                {isFlagged && (
                  <span className="nb-chip amber">
                    <Flag size={11} aria-hidden /> Flagged
                  </span>
                )}
                {isLocked && (
                  <span className="nb-chip">
                    <Lock size={11} aria-hidden /> Locked
                  </span>
                )}
              </div>
              {/* Framer Motion: each question slides in; options press in, and a locked answer pulses (right) or shakes (wrong) */}
              <motion.div
                key={item.q.id}
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
              >
                <div className="ex-qtext" id="ex-qtext">
                  <Markdown>{item.q.question}</Markdown>
                </div>
                {item.q.code && (
                  <div className="ex-code">
                    <CodeBlock snippet={item.q.code} />
                  </div>
                )}
                <div className="ex-opts" role="group" aria-label={multi ? 'Options, select all that apply' : 'Options, select one'}>
                  {item.order.map((orig, di) => {
                    const on = selected.includes(orig);
                    const verdict = isLocked ? (item.q.correct.includes(orig) ? 'is-correct' : on ? 'is-wrong' : 'is-dim') : '';
                    return (
                      <motion.button
                        key={orig}
                        type="button"
                        className={`ex-opt ${multi ? 'multi' : ''} ${verdict}`}
                        aria-pressed={on}
                        disabled={isLocked}
                        onClick={() => toggle(item, orig)}
                        whileTap={isLocked ? undefined : { scale: 0.985 }}
                        animate={
                          verdict === 'is-wrong' ? { x: [0, -7, 7, -4, 4, 0] } : verdict === 'is-correct' ? { scale: [1, 1.02, 1] } : { x: 0, scale: 1 }
                        }
                        transition={{ duration: verdict === 'is-wrong' || verdict === 'is-correct' ? 0.42 : 0.15, ease: 'easeOut' }}
                      >
                        <span className="k" aria-hidden>
                          {LETTERS[di] ?? di + 1}
                        </span>
                        <span className="ex-opt-text">
                          <Markdown>{item.q.options[orig]}</Markdown>
                        </span>
                        <span className="box" aria-hidden>
                          {verdict === 'is-wrong' ? <X size={12} strokeWidth={3.5} /> : (on || verdict === 'is-correct') && <Check size={12} strokeWidth={3.5} />}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>

              {isLocked && (
                <motion.div
                  className={`ex-feedback ${gotIt ? 'ok' : 'bad'}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                  role="status"
                >
                  <div className="ex-feedback-head">
                    {gotIt ? <CircleCheck size={18} aria-hidden /> : <CircleX size={18} aria-hidden />}
                    <strong>{gotIt ? 'Correct' : 'Not quite'}</strong>
                  </div>
                  <div className="ex-expl">
                    <Markdown>{item.q.explanation}</Markdown>
                  </div>
                  <FollowUps key={item.q.id} items={item.q.followUps} />
                </motion.div>
              )}

              <div className="ex-actions">
                <button className="btn btn-sm" type="button" disabled={cur === 0} onClick={() => setCur(cur - 1)}>
                  <ArrowLeft size={15} aria-hidden /> Previous
                </button>
                <button
                  className={`btn btn-sm ex-flag ${isFlagged ? 'on' : ''}`}
                  type="button"
                  aria-pressed={isFlagged}
                  onClick={() => toggleFlag(item.q.id)}
                >
                  <Flag size={15} aria-hidden /> {isFlagged ? 'Flagged' : 'Flag'}
                </button>
                <span className="ex-actions-gap" />
                {interviewMode && !isLocked ? (
                  <button className="btn btn-primary btn-sm" type="button" disabled={!selected.length} onClick={() => lockIn(item.q.id)}>
                    {selected.length
                      ? `Lock in ${selected.length} answer${selected.length === 1 ? '' : 's'}`
                      : multi
                        ? 'Select answers to lock in'
                        : 'Select an answer'}
                    <ArrowRight size={15} aria-hidden />
                  </button>
                ) : last ? (
                  <button className="btn btn-primary btn-sm" type="button" onClick={doSubmit}>
                    Submit {drill ? 'drill' : 'exam'} <ArrowRight size={15} aria-hidden />
                  </button>
                ) : (
                  <button className={`btn btn-sm ${isLocked || selected.length ? 'btn-primary' : ''}`} type="button" onClick={() => setCur(cur + 1)}>
                    Next <ArrowRight size={15} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </section>

          <aside className="ex-nav glass-flat" aria-label="Question navigator">
            <div className="ex-nav-head">
              <div className="eyebrow">Navigator</div>
              <span className="mono ex-hint">
                {answered}/{items.length}
              </span>
            </div>
            <div className="ex-cells">
              {items.map((it, i) => {
                const a = (answers[it.q.id] ?? []).length > 0;
                const f = flagged.has(it.q.id);
                const lockedVerdict =
                  interviewMode && locked.has(it.q.id) ? (sameSet(answers[it.q.id] ?? [], it.q.correct) ? 'ok' : 'bad') : '';
                return (
                  <button
                    key={it.q.id}
                    type="button"
                    className={`ex-cell ${a ? 'a' : ''} ${i === cur ? 'cur' : ''} ${f ? 'fl' : ''} ${lockedVerdict}`}
                    aria-current={i === cur ? 'step' : undefined}
                    aria-label={`Question ${i + 1}${a ? ', answered' : ''}${f ? ', flagged' : ''}${lockedVerdict === 'ok' ? ', correct' : lockedVerdict === 'bad' ? ', wrong' : ''}`}
                    onClick={() => setCur(i)}
                  >
                    {pad2(i + 1)}
                  </button>
                );
              })}
            </div>
            <ul className="ex-legend">
              <li>
                <span className="sw sw-a" /> Answered
              </li>
              <li>
                <span className="sw sw-cur" /> Current
              </li>
              <li>
                <span className="sw sw-fl" /> Flagged
              </li>
              {interviewMode && (
                <li>
                  <span className="sw sw-bad" /> Locked in wrong
                </li>
              )}
            </ul>
            <div className="ex-keys ex-keys-box">
              <span>
                <kbd>1</kbd> – <kbd>{Math.min(5, item.order.length)}</kbd> {multi ? 'toggle an option' : 'choose an option'}
              </span>
              <span>
                <kbd>←</kbd> <kbd>→</kbd> previous / next
              </span>
              <span>
                <kbd>F</kbd> flag for review
              </span>
              {interviewMode && (
                <span>
                  <kbd>Enter</kbd> lock in
                </span>
              )}
            </div>
            <div className="ex-nav-info">
              {Math.round(limitSecs / Math.max(1, items.length))} s per question
              {shuffleOn ? ' · questions and options shuffled on every attempt' : ''}.
              {!drill && (
                <>
                  {' '}
                  Best so far: <strong>{best !== undefined ? `${best}%` : 'none yet'}</strong>
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // done
  const passed = score >= p.settings.passMark;
  const correctCount = items.filter((it) => sameSet(answers[it.q.id] ?? [], it.q.correct)).length;
  const full = !!recordTopicId && items.length === total;
  const missed = items.filter((it) => !sameSet(answers[it.q.id] ?? [], it.q.correct)).map((it) => it.q);
  const shown = items.filter((it) => reviewFilter === 'all' || !sameSet(answers[it.q.id] ?? [], it.q.correct));
  const unanswered = items.filter((it) => !(answers[it.q.id] ?? []).length).length;
  return (
    <div className="page ex-page ex-done">
      <Link to={backHref} className="ex-back">
        <ArrowLeft size={15} aria-hidden /> Back
      </Link>
      <motion.section
        className={`ex-result glass ${passed ? 'pass' : 'fail'}`}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        aria-labelledby="ex-verdict"
      >
        <div className="ex-result-glow" aria-hidden />
        <div className="ex-score">
          <div className="eyebrow">{full ? 'Exam score' : drill ? 'Drill score' : 'Practice score'}</div>
          <div className="ex-score-num num" aria-label={`${score} percent`}>
            <span className={passed ? 'gtext' : ''}>
              <CountUp value={score} delay={0.15} />
            </span>
            <small>%</small>
          </div>
          <div className="ex-score-meter" aria-hidden>
            <div className="ex-score-bar">
              <i style={{ width: `${score}%` }} />
            </div>
            <span className="ex-score-mark" style={{ left: `${p.settings.passMark}%` }}>
              <span className="mono">pass {p.settings.passMark}</span>
            </span>
          </div>
        </div>
        <div className="ex-result-copy">
          <span className={`nb-chip ${passed ? 'green' : 'rose'}`}>
            {passed ? (full ? 'Passed' : 'Above the pass mark') : `Below the ${p.settings.passMark}% pass mark`}
          </span>
          <h1 id="ex-verdict">{passed ? (full ? 'Passed!' : 'Great practice run') : 'Not yet. Review and retake.'}</h1>
          <p className="mono ex-result-meta">
            {correctCount}/{items.length} correct · {formatClock(elapsed)} used
            {unanswered > 0 && ` · ${unanswered} unanswered`}
            {!full && ' · practice, not counted towards passing'}
          </p>
          <p className="ex-result-topic">{title}</p>
          <div className="ex-result-actions">
            {missed.length > 0 && (
              <Link className="btn btn-primary" to={recordTopicId ? `/practice?topic=${recordTopicId}` : '/practice'}>
                <Target size={16} aria-hidden /> Practise the {missed.length} I missed
              </Link>
            )}
            <button className={`btn ${missed.length ? '' : 'btn-primary'}`} type="button" onClick={() => setPhase('setup')}>
              <RotateCcw size={15} aria-hidden /> Retake
            </button>
            <Link className="btn-ghost" to="/weak-areas">
              All weak areas <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </motion.section>
      {passed && full && recordTopicId && <NextTopic topicId={recordTopicId} />}
      <AttemptAnalysis items={items.map((it) => it.q)} missed={missed} />
      <div className="ex-review-head">
        <div>
          <div className="eyebrow">Answer review</div>
          <h2>Every question, with the reasoning</h2>
        </div>
        <div className="ex-filter" role="group" aria-label="Filter review">
          <button type="button" className={`chip ${reviewFilter === 'all' ? 'on' : ''}`} aria-pressed={reviewFilter === 'all'} onClick={() => setReviewFilter('all')}>
            All ({items.length})
          </button>
          <button type="button" className={`chip ${reviewFilter === 'wrong' ? 'on' : ''}`} aria-pressed={reviewFilter === 'wrong'} onClick={() => setReviewFilter('wrong')}>
            Wrong only ({items.length - correctCount})
          </button>
        </div>
      </div>
      {!shown.length && <div className="card info">Nothing wrong in this attempt. Every answer was right.</div>}
      <div className="ex-review-list">
        {shown.map((it) => {
          const sel = answers[it.q.id] ?? [];
          const ok = sameSet(sel, it.q.correct);
          const n = items.indexOf(it) + 1;
          return (
            <article key={it.q.id} className={`ex-review card ${ok ? 'ok' : 'bad'}`}>
              <div className="ex-review-top">
                <span className={`ex-verdict ${ok ? 'ok' : sel.length ? 'bad' : 'skip'}`}>
                  {ok ? <CircleCheck size={15} aria-hidden /> : sel.length ? <CircleX size={15} aria-hidden /> : <SkipForward size={15} aria-hidden />}
                  {ok ? 'Correct' : sel.length ? 'Incorrect' : 'Unanswered'}
                </span>
                <span className="mono ex-qnum">Q {pad2(n)}</span>
                <DiffChip d={it.q.difficulty} />
                {it.q.correct.length > 1 && <span className="nb-chip">Multi-select</span>}
              </div>
              <div className="ex-review-q">
                <Markdown>{it.q.question}</Markdown>
              </div>
              {it.q.code && <CodeBlock snippet={it.q.code} compact />}
              <ul className="ex-review-opts">
                {it.order.map((orig, di) => {
                  const isC = it.q.correct.includes(orig);
                  const isS = sel.includes(orig);
                  return (
                    <li key={orig} className={`${isC ? 'c' : ''} ${isS && !isC ? 'w' : ''}`}>
                      <span className="k" aria-hidden>
                        {isC ? <Check size={12} strokeWidth={3.5} /> : isS ? <X size={12} strokeWidth={3.5} /> : LETTERS[di]}
                      </span>
                      <span className="ex-opt-text">
                        <Markdown>{it.q.options[orig]}</Markdown>
                      </span>
                      {isS && <span className="ex-pick mono">your pick</span>}
                      <span className="sr-only">{isC ? '(correct answer)' : isS ? '(wrong)' : ''}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="ex-expl">
                <Markdown>{it.q.explanation}</Markdown>
              </div>
              <FollowUps items={it.q.followUps} startOpen={0} />
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** After a passed exam: point straight at the next topic (or the company track after the last one). */
function NextTopic({ topicId }: { topicId: string }) {
  const i = TOPICS.findIndex((t) => t.id === topicId);
  const next = TOPICS[i + 1];
  return next ? (
    <NextUp lead={<strong>Topic passed. Keep the momentum going.</strong>} label={`Next topic: ${next.title}`} to={`/topic/${next.id}`} />
  ) : (
    <NextUp lead={<strong>That was the last topic.</strong>} label="Company track" to="/companies" />
  );
}

/** Weak areas for one attempt: missed questions grouped by topic section, plus a difficulty breakdown. */
function AttemptAnalysis({ items, missed }: { items: MCQ[]; missed: MCQ[] }) {
  const byTopic = new Map<string, MCQ[]>();
  for (const q of missed) {
    const t = MCQ_TOPIC.get(q.id);
    if (t) byTopic.set(t.id, [...(byTopic.get(t.id) ?? []), q]);
  }
  const levels: Difficulty[] = ['medium', 'hard', 'expert'];
  const missedIds = new Set(missed.map((q) => q.id));
  const multiTopic = byTopic.size > 1;
  return (
    <section className="ex-analysis card" aria-labelledby="ex-analysis-h">
      <div className={`eyebrow ${missed.length ? 'ex-eb-rose' : 'ex-eb-green'}`}>{missed.length ? 'Weak spots in this attempt' : 'Clean sheet'}</div>
      <h2 id="ex-analysis-h">{missed.length ? 'Where you lost marks' : 'No weak spots in this attempt'}</h2>
      <div className="ex-diff">
        {levels.map((d) => {
          const qs = items.filter((q) => q.difficulty === d);
          if (!qs.length) return null;
          const ok = qs.filter((q) => !missedIds.has(q.id)).length;
          const rate = Math.round((ok / qs.length) * 100);
          const tone = rate >= 70 ? 'hi' : rate >= 50 ? 'mid' : 'lo';
          return (
            <div key={d} className={`ex-diff-cell ${tone}`}>
              <DiffChip d={d} />
              <div className="num ex-diff-num">
                {rate}
                <small>%</small>
              </div>
              <div className="track" aria-hidden>
                <i style={{ width: `${rate}%` }} />
              </div>
              <span className="mono ex-hint">
                {ok}/{qs.length} right
              </span>
            </div>
          );
        })}
      </div>
      {[...byTopic].map(([topicId, qs]) => {
        const topic = TOPIC_BY_ID.get(topicId)!;
        return (
          <div key={topicId} className="ex-weak-topic">
            {multiTopic && <div className="eyebrow">{topic.title}</div>}
            <ul className="ex-sections">
              {weakSections(topic, qs).map((ws) => (
                <li key={ws.index}>
                  <span className="num ex-sec-count" aria-hidden>{ws.missed.length}</span>
                  <span className="ex-sec-text">
                    <span className="mono ex-sec-no">§{ws.index + 1}</span> {ws.heading}
                    <span className="sr-only"> ({ws.missed.length} missed)</span>
                  </span>
                  <Link to={`/topic/${topic.id}?tab=learn&s=${ws.index}`} className="btn btn-xs">
                    Revise §{ws.index + 1}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {missed.length > 0 && (
        <p className="ex-note">Sections are matched automatically from each question&apos;s wording. Use the review below for the exact reasoning.</p>
      )}
    </section>
  );
}
