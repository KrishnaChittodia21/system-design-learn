import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { MCQ_TOPIC, TOPICS, TOPIC_BY_ID } from '../content';
import { CircleCheck, CircleX, SkipForward } from 'lucide-react';
import { motion } from 'motion/react';
import { CountUp } from '../components/CountUp';
import { NextUp } from '../components/NextUp';
import type { Difficulty, MCQ } from '../types';
import { recordAnswers, recordTest, useProgress } from '../lib/progress';
import { weakSections } from '../lib/weak';
import { practiceLocked } from '../lib/stats';
import { StudyLock } from './Topic';
import { Badge, CodeBlock, DifficultyBadge, FollowUps, Markdown, formatClock } from '../components/ui';

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

export default function ExamPage() {
  const { id = '' } = useParams();
  const p = useProgress();
  const topic = TOPIC_BY_ID.get(id);
  if (!topic) return <div className="page">Topic not found</div>;
  if (practiceLocked(p, topic, 'exam')) {
    return (
      <div className="page">
        <Link to={`/topic/${topic.id}`} className="muted small">
          ← {topic.title}
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
  const deadline = useRef(0);
  const startedAt = useRef(0);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'wrong'>('all');

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

  // record result once when finishing a full-length exam
  const recorded = useRef(false);
  useEffect(() => {
    if (phase === 'running') recorded.current = false;
    if (phase === 'done' && !recorded.current) {
      recorded.current = true;
      recordAnswers(items.map((it) => ({ id: it.q.id, correct: sameSet(answers[it.q.id] ?? [], it.q.correct) })));
      if (recordTopicId && items.length === total) recordTest(recordTopicId, score);
    }
  }, [phase, items, answers, total, recordTopicId, score]);

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

  // keyboard: 1-5 choose, ←/→ navigate, f flag
  useEffect(() => {
    if (phase !== 'running') return;
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const item = items[cur];
      if (!item) return;
      const n = Number(e.key);
      if (n >= 1 && n <= item.order.length) {
        if (!locked.has(item.q.id)) toggle(item, item.order[n - 1]);
      }
      else if (e.key === 'ArrowRight') setCur((c) => Math.min(items.length - 1, c + 1));
      else if (e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
      else if (e.key.toLowerCase() === 'f')
        setFlagged((f) => {
          const s = new Set(f);
          if (s.has(item.q.id)) s.delete(item.q.id);
          else s.add(item.q.id);
          return s;
        });
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [phase, items, cur, toggle, locked]);

  if (phase === 'setup') {
    return (
      <div className="page narrow">
        <Link to={backHref} className="muted small">
          ← Back
        </Link>
        <h1>Exam setup</h1>
        <div className="card form">
          <label>
            <span>Time limit (minutes)</span>
            <div className="row gap-s">
              <input type="number" min={1} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 1)} />
              {[5, 10, 15, 20, 30].map((m) => (
                <button key={m} type="button" className={`chip ${minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}>
                  {m}m
                </button>
              ))}
            </div>
            <span className="muted small">≈ {Math.round((minutes * 60) / Math.max(1, count))}s per question</span>
          </label>
          <label>
            <span>
              Questions: <strong>{count}</strong> / {total}
            </span>
            <input type="range" min={Math.min(5, total)} max={total} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            {recordTopicId
              ? count < total && <span className="warn small">Practice mode: only full-length attempts count towards passing.</span>
              : <span className="muted small">Practice drill: updates your weak areas, never affects exam passes.</span>}
          </label>
          <label className="check">
            <input type="checkbox" checked={shuffleOn} onChange={(e) => setShuffleOn(e.target.checked)} /> Shuffle questions and
            options
          </label>
          <label className="check">
            <input type="checkbox" checked={interviewMode} onChange={(e) => setInterviewMode(e.target.checked)} /> Interview mode:
            lock each answer to get instant feedback and the interviewer&apos;s follow-ups (like a real interview)
          </label>
          <p className="muted small">
            Keyboard: <kbd>1</kbd>–<kbd>5</kbd> select · <kbd>←</kbd>/<kbd>→</kbd> navigate · <kbd>F</kbd> flag for review. Pass
            mark {p.settings.passMark}%.
          </p>
          <button className="btn btn-primary btn-lg" type="button" onClick={start}>
            Start exam ({minutes} min)
          </button>
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
    return (
      <div className="page exam">
        <div className="exam-bar">
          <div>
            <strong>{title}</strong>
            <div className="muted small">
              {answered}/{items.length} answered · {flagged.size} flagged
            </div>
          </div>
          <div className={`timer ${urgent ? 'urgent' : ''}`}>⏱ {formatClock(remaining)}</div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              const un = items.length - answered;
              if (!un || window.confirm(`${un} question(s) unanswered. Submit anyway?`)) submit();
            }}
          >
            Submit
          </button>
        </div>
        <div className="exam-grid">
          <div className="card exam-q">
            <div className="row between">
              <span className="muted">
                Question {cur + 1} of {items.length}
              </span>
              <span className="row gap-s">
                {multi && <Badge tone="warn">Select ALL that apply</Badge>}
                <DifficultyBadge d={item.q.difficulty} />
              </span>
            </div>
            {/* Framer Motion: each question slides in; options press in, and a locked answer pulses (right) or shakes (wrong) */}
            <motion.div key={item.q.id} className="q-body" initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24, ease: 'easeOut' }}>
              <div className="q-text">
                <Markdown>{item.q.question}</Markdown>
              </div>
              {item.q.code && <CodeBlock snippet={item.q.code} />}
              <div className="options">
                {item.order.map((orig, di) => {
                  const on = selected.includes(orig);
                  const verdict = isLocked ? (item.q.correct.includes(orig) ? 'is-correct' : on ? 'is-wrong' : '') : '';
                  return (
                    <motion.button
                      key={orig}
                      type="button"
                      className={`option ${on ? 'selected' : ''} ${verdict}`}
                      disabled={isLocked}
                      onClick={() => toggle(item, orig)}
                      whileTap={isLocked ? undefined : { scale: 0.985 }}
                      animate={verdict === 'is-wrong' ? { x: [0, -7, 7, -4, 4, 0] } : verdict === 'is-correct' ? { scale: [1, 1.02, 1] } : { x: 0, scale: 1 }}
                      transition={{ duration: verdict ? 0.42 : 0.15, ease: 'easeOut' }}
                    >
                      <span className={`opt-key ${multi ? 'square' : ''}`}>{on ? '✓' : di + 1}</span>
                      <span className="opt-text">
                        <Markdown>{item.q.options[orig]}</Markdown>
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
            {interviewMode && !isLocked && (
              <button
                className="btn btn-primary lock-btn"
                type="button"
                disabled={!selected.length}
                onClick={() => setLocked((l) => new Set(l).add(item.q.id))}
              >
                Lock answer &amp; hear the follow-up
              </button>
            )}
            {isLocked && (
              <div className={`lock-feedback ${gotIt ? 'ok' : 'bad'}`}>
                <strong>{gotIt ? '✅ Correct' : '❌ Not quite'}</strong>
                <div className="explanation">
                  <Markdown>{item.q.explanation}</Markdown>
                </div>
                <FollowUps key={item.q.id} items={item.q.followUps} />
              </div>
            )}
            <div className="row between">
              <button className="btn" type="button" disabled={cur === 0} onClick={() => setCur(cur - 1)}>
                ← Prev
              </button>
              <button
                className={`btn-ghost ${flagged.has(item.q.id) ? 'flag-on' : ''}`}
                type="button"
                onClick={() =>
                  setFlagged((f) => {
                    const s = new Set(f);
                    if (s.has(item.q.id)) s.delete(item.q.id);
                    else s.add(item.q.id);
                    return s;
                  })
                }
              >
                {flagged.has(item.q.id) ? '⚑ Flagged' : '⚐ Flag for review'}
              </button>
              <button className="btn" type="button" disabled={cur === items.length - 1} onClick={() => setCur(cur + 1)}>
                Next →
              </button>
            </div>
          </div>
          <div className="card navigator">
            <div className="label">Navigator</div>
            <div className="nav-grid">
              {items.map((it, i) => (
                <button
                  key={it.q.id}
                  type="button"
                  className={`nav-cell ${i === cur ? 'cur' : ''} ${(answers[it.q.id] ?? []).length ? 'ans' : ''} ${
                    flagged.has(it.q.id) ? 'flag' : ''
                  }`}
                  onClick={() => setCur(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="legend small muted">
              <span className="nav-cell ans mini" /> answered <span className="nav-cell flag mini" /> flagged
            </div>
          </div>
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
  return (
    <div className="page">
      <Link to={backHref} className="muted small">
        ← Back
      </Link>
      <motion.div
        className={`card result ${passed ? 'pass' : 'fail'}`}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      >
        <div className="result-score">
          <CountUp value={score} suffix="%" delay={0.15} />
        </div>
        <div>
          <h2>{passed ? (full ? 'Passed!' : 'Great practice run') : 'Not yet. Review and retake.'}</h2>
          <p>
            {correctCount}/{items.length} correct · time used {formatClock(elapsed)} · pass mark {p.settings.passMark}%
            {!full && ' · practice (not counted towards passing)'}
          </p>
          <div className="row gap-s wrap">
            <button className="btn btn-primary" type="button" onClick={() => setPhase('setup')}>
              Retake
            </button>
            {missed.length > 0 && (
              <Link className="btn" to={recordTopicId ? `/practice?topic=${recordTopicId}` : '/practice'}>
                Practise the {missed.length} I missed
              </Link>
            )}
            <Link className="btn-ghost" to="/weak-areas">
              All weak areas →
            </Link>
          </div>
        </div>
      </motion.div>
      {passed && full && recordTopicId && <NextTopic topicId={recordTopicId} />}
      <AttemptAnalysis items={items.map((it) => it.q)} missed={missed} />
      <div className="row between">
        <h2>Review</h2>
        <div className="row gap-s">
          <button type="button" className={`chip ${reviewFilter === 'all' ? 'on' : ''}`} onClick={() => setReviewFilter('all')}>
            All
          </button>
          <button type="button" className={`chip ${reviewFilter === 'wrong' ? 'on' : ''}`} onClick={() => setReviewFilter('wrong')}>
            Wrong only ({items.length - correctCount})
          </button>
        </div>
      </div>
      {shown.map((it) => {
        const sel = answers[it.q.id] ?? [];
        const ok = sameSet(sel, it.q.correct);
        return (
          <article key={it.q.id} className={`card review ${ok ? 'ok' : 'bad'}`}>
            <div className="row between">
              <span className={`review-verdict ${ok ? 'ok' : 'bad'}`}>
                {ok ? <CircleCheck size={16} aria-hidden /> : sel.length ? <CircleX size={16} aria-hidden /> : <SkipForward size={16} aria-hidden />}{' '}
                {ok ? 'Correct' : sel.length ? 'Incorrect' : 'Unanswered'}
              </span>
              <DifficultyBadge d={it.q.difficulty} />
            </div>
            <Markdown>{it.q.question}</Markdown>
            {it.q.code && <CodeBlock snippet={it.q.code} compact />}
            <ul className="review-opts">
              {it.order.map((orig) => {
                const isC = it.q.correct.includes(orig);
                const isS = sel.includes(orig);
                return (
                  <li key={orig} className={`${isC ? 'c' : ''} ${isS && !isC ? 'w' : ''}`}>
                    <span className="mark">{isC ? '✓' : isS ? '✗' : '•'}</span>
                    <Markdown>{it.q.options[orig]}</Markdown>
                    {isS && <span className="muted small"> (your pick)</span>}
                  </li>
                );
              })}
            </ul>
            <div className="explanation">
              <Markdown>{it.q.explanation}</Markdown>
            </div>
            <FollowUps items={it.q.followUps} startOpen={0} />
          </article>
        );
      })}
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
    <div className="card weak-card">
      <h2>{missed.length ? 'Where you lost marks' : 'No weak spots in this attempt 🎯'}</h2>
      <div className="diff-row">
        {levels.map((d) => {
          const qs = items.filter((q) => q.difficulty === d);
          if (!qs.length) return null;
          const ok = qs.filter((q) => !missedIds.has(q.id)).length;
          const rate = Math.round((ok / qs.length) * 100);
          return (
            <div key={d} className={`diff-cell ${rate < 60 ? 'low' : ''}`}>
              <span className={`badge badge-${d}`}>{d}</span>
              <strong>
                {ok}/{qs.length}
              </strong>
              <span className="muted small">{rate}%</span>
            </div>
          );
        })}
      </div>
      {[...byTopic].map(([topicId, qs]) => {
        const topic = TOPIC_BY_ID.get(topicId)!;
        return (
          <div key={topicId} className="weak-topic">
            {multiTopic && <div className="label">{topic.title}</div>}
            <ul className="weak-sections">
              {weakSections(topic, qs).map((ws) => (
                <li key={ws.index}>
                  <span className="weak-count">{ws.missed.length} missed</span>
                  <span className="weak-heading">{ws.heading}</span>
                  <Link to={`/topic/${topic.id}?tab=learn&s=${ws.index}`} className="small">
                    Revise section →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {missed.length > 0 && (
        <p className="muted small">
          Sections are matched automatically from each question&apos;s wording. Use the review below for the exact reasoning.
        </p>
      )}
    </div>
  );
}
