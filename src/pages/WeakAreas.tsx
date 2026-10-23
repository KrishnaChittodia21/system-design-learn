import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleCheck, Mic, RotateCcw, Target } from 'lucide-react';
import { TOPICS, TOPIC_BY_ID } from '../content';
import type { Difficulty } from '../types';
import { useProgress } from '../lib/progress';
import { accuracyBreakdown, currentlyWrong, pct, weakTopics, type Accuracy } from '../lib/weak';
import { DiffChip, Exam } from './Exam';

/** cyan at or above 70%, amber from 50%, rose below */
const toneFor = (v: number | null) => (v === null ? 'none' : v >= 70 ? 'hi' : v >= 50 ? 'mid' : 'lo');

function AccuracyRow({ label, a }: { label: ReactNode; a: Accuracy }) {
  const v = pct(a);
  return (
    <div className={`wk-acc ${toneFor(v)}`}>
      <span className="wk-acc-label">{label}</span>
      <span className="num wk-acc-val">
        {v === null ? '—' : v}
        {v !== null && <small>%</small>}
      </span>
      <div className="track wk-meter" aria-hidden>
        {v !== null && <i style={{ width: `${Math.max(2, v)}%` }} />}
      </div>
      <span className="mono wk-acc-n">{a.seen ? `${a.correct}/${a.seen} right` : 'no data yet'}</span>
    </div>
  );
}

export function WeakAreasPage() {
  const p = useProgress();
  const answered = Object.keys(p.mcq).length;
  const weak = weakTopics(p, TOPICS);
  const { byDifficulty, byFormat } = accuracyBreakdown(p, TOPICS);
  const overall = Object.values(byDifficulty).reduce((acc, a) => ({ seen: acc.seen + a.seen, correct: acc.correct + a.correct }), {
    seen: 0,
    correct: 0,
  });
  const totalWrong = weak.reduce((n, w) => n + w.wrong.length, 0);

  if (!answered) {
    return (
      <div className="page wk-page">
        <header className="wk-head">
          <div className="eyebrow">Diagnostics</div>
          <h1>Weak areas</h1>
        </header>
        <section className="wk-empty glass" aria-label="Nothing to analyse yet">
          <div className="wk-empty-art" aria-hidden>
            <span className="wk-empty-ring r1" />
            <span className="wk-empty-ring r2" />
            <span className="wk-empty-ring r3" />
            <span className="wk-empty-core" />
          </div>
          <div>
            <div className="eyebrow wk-eb-cyan">No answers recorded yet</div>
            <h2>Take one exam and this page lights up</h2>
            <p className="lead">
              It will show the topics, the exact sections and the question types where you lose marks, with links straight to what
              to revise.
            </p>
            <div className="wk-actions">
              <Link to="/" className="btn btn-primary">
                Go to the roadmap <ArrowRight size={16} aria-hidden />
              </Link>
              <Link to="/contents" className="btn">
                Browse topics
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const levels: Difficulty[] = ['medium', 'hard', 'expert'];
  const overallPct = pct(overall);
  return (
    <div className="page wk-page">
      <header className="wk-head">
        <div className="eyebrow">Diagnostics</div>
        <h1>Weak areas</h1>
        <p className="lead">
          Based on your latest answer to each of the {answered} exam questions you&apos;ve attempted. A question leaves this list once
          you answer it correctly.
        </p>
      </header>

      <section className="wk-summary glass" aria-label="Summary">
        <div className="wk-kpi">
          <div className="eyebrow">Overall accuracy</div>
          <div className={`num wk-kpi-num ${toneFor(overallPct)}`}>
            {overallPct ?? '—'}
            {overallPct !== null && <small>%</small>}
          </div>
          <span className="mono wk-acc-n">
            {overall.correct}/{overall.seen} currently right
          </span>
        </div>
        <div className="wk-kpi">
          <div className="eyebrow">Currently wrong</div>
          <div className={`num wk-kpi-num ${totalWrong ? 'lo' : 'hi'}`}>{totalWrong}</div>
          <span className="mono wk-acc-n">questions to clear</span>
        </div>
        <div className="wk-kpi">
          <div className="eyebrow">Topics to fix</div>
          <div className={`num wk-kpi-num ${weak.length ? 'mid' : 'hi'}`}>{weak.length}</div>
          <span className="mono wk-acc-n">of {TOPICS.length} topics</span>
        </div>
        <div className="wk-kpi-cta">
          {totalWrong > 0 ? (
            <Link to="/practice" className="btn btn-primary">
              <Target size={16} aria-hidden /> Practise all {totalWrong} mistakes
            </Link>
          ) : (
            <span className="nb-chip green">
              <CircleCheck size={12} aria-hidden /> All clear
            </span>
          )}
        </div>
      </section>

      <div className="wk-section-head">
        <div>
          <div className="eyebrow wk-eb-rose">Focus list</div>
          <h2>
            {weak.length} topic{weak.length === 1 ? '' : 's'} need{weak.length === 1 ? 's' : ''} work
          </h2>
        </div>
      </div>

      {!weak.length && (
        <section className="wk-clear card">
          <CircleCheck size={28} aria-hidden />
          <div>
            <h3>No weak topics right now</h3>
            <p>Every question you&apos;ve attempted is currently correct. Take a new topic exam to keep this page honest.</p>
          </div>
        </section>
      )}

      <div className="wk-list">
        {weak.map((w) => {
          const total = w.topic.test.length || 1;
          const share = Math.round((w.wrong.length / total) * 100);
          const tone = w.attempts > 0 && !w.passed ? 'rose' : 'amber';
          const maxSec = Math.max(1, ...w.sections.map((s) => s.missed.length));
          return (
            <article key={w.topic.id} className={`wk-topic card ${tone}`}>
              <div className="wk-topic-head">
                <div className="wk-topic-title">
                  <div className="wk-chips">
                    {w.attempts > 0 ? (
                      w.passed ? (
                        <span className="nb-chip green">Passed</span>
                      ) : (
                        <span className="nb-chip rose">Not passed</span>
                      )
                    ) : (
                      <span className="nb-chip">Drill only</span>
                    )}
                    {w.attempts > 0 && (
                      <span className="mono wk-meta">
                        last {w.last}% · best {w.best}% · {w.attempts} attempt{w.attempts === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <h3>
                    <Link to={`/topic/${w.topic.id}`}>{w.topic.title}</Link>
                  </h3>
                  {w.history.length > 1 && (
                    <div className="wk-trend mono" aria-label={`Recent scores: ${w.history.slice(-5).join(', ')}`}>
                      {w.history.slice(-5).map((s, k, arr) => (
                        <span key={k} className={s >= p.settings.passMark ? 'hi' : 'lo'}>
                          {s}
                          {k < arr.length - 1 && <em>→</em>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="wk-big" title="questions currently wrong">
                  <span className="num">{w.wrong.length}</span>
                  <span className="mono">wrong now</span>
                </div>
              </div>

              <div className="wk-topic-meter">
                <div className="track wk-meter" aria-hidden>
                  <i style={{ width: `${Math.max(w.wrong.length ? 3 : 0, share)}%` }} />
                </div>
                <span className="mono wk-acc-n">
                  {w.wrong.length}/{w.topic.test.length} of the exam currently wrong
                </span>
              </div>

              {w.sections.length > 0 && (
                <ul className="wk-sections" aria-label="Sections behind the misses">
                  {w.sections.slice(0, 5).map((ws) => (
                    <li key={ws.index} style={{ '--w': `${(ws.missed.length / maxSec) * 100}%` } as CSSProperties}>
                      <span className="num wk-sec-count">{ws.missed.length}</span>
                      <span className="wk-sec-text">
                        <span className="mono wk-sec-no">§{ws.index + 1}</span> {ws.heading}
                        <span className="wk-sec-bar" aria-hidden />
                      </span>
                      <Link to={`/topic/${w.topic.id}?tab=learn&s=${ws.index}`} className="btn btn-xs">
                        Revise §{ws.index + 1}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {w.shakyInterview > 0 && (
                <p className="wk-interview">
                  <Mic size={15} aria-hidden />
                  <span>
                    {w.shakyInterview} interview question{w.shakyInterview === 1 ? '' : 's'} self-rated <em>partial</em> or{' '}
                    <em>missed</em>. <Link to={`/topic/${w.topic.id}?tab=interview`}>Practise them →</Link>
                  </span>
                </p>
              )}
              <div className="wk-actions">
                {w.wrong.length > 0 && (
                  <Link to={`/practice?topic=${w.topic.id}`} className="btn btn-sm">
                    <Target size={15} aria-hidden /> Practise {w.wrong.length} mistake{w.wrong.length === 1 ? '' : 's'}
                  </Link>
                )}
                <Link to={`/topic/${w.topic.id}/exam`} className="btn-ghost btn-sm">
                  <RotateCcw size={14} aria-hidden /> Retake full exam
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      <div className="wk-acc-grid">
        <section className="card" aria-labelledby="wk-diff-h">
          <div className="eyebrow">Accuracy</div>
          <h2 id="wk-diff-h">By difficulty</h2>
          {levels.map((d) => (
            <AccuracyRow key={d} label={<DiffChip d={d} />} a={byDifficulty[d]} />
          ))}
          <AccuracyRow label={<strong>Overall</strong>} a={overall} />
        </section>
        <section className="card" aria-labelledby="wk-type-h">
          <div className="eyebrow">Accuracy</div>
          <h2 id="wk-type-h">By question type</h2>
          <AccuracyRow label="Single answer" a={byFormat.single} />
          <AccuracyRow label="Select all that apply" a={byFormat.multi} />
          <AccuracyRow label="Reading code" a={byFormat.code} />
          <p className="wk-note">
            A low &ldquo;select all&rdquo; score usually means you spot the main idea but miss a second valid trade-off. Read the
            explanations for the options you skipped.
          </p>
        </section>
      </div>

      <aside className="wk-howto" aria-label="How this list clears">
        <div className="eyebrow wk-eb-cyan">How it clears</div>
        <ol>
          <li>
            <span className="mono">01</span> Revise the section a miss points to (<strong>Revise §n</strong>).
          </li>
          <li>
            <span className="mono">02</span> Drill the questions you got wrong, in a timed run of only those.
          </li>
          <li>
            <span className="mono">03</span> Answer one correctly and it leaves this page. Retake the full exam to update your pass.
          </li>
        </ol>
        <p className="wk-note">
          Sections are matched automatically from each question&apos;s wording, so treat them as a pointer. The exam review shows the
          exact reasoning.
        </p>
      </aside>
    </div>
  );
}

/** Timed drill of questions whose latest answer was wrong, for one topic or all topics. */
export function PracticePage() {
  const p = useProgress();
  const [params] = useSearchParams();
  const topicId = params.get('topic');
  const topic = topicId ? TOPIC_BY_ID.get(topicId) : undefined;
  // snapshot once so the list doesn't change while answers are being recorded
  const [questions] = useState(() => (topic ? [topic] : TOPICS).flatMap((t) => currentlyWrong(p, t)));

  if (!questions.length) {
    const attempted = Object.keys(p.mcq).length > 0;
    return (
      <div className="page wk-page">
        <Link to="/weak-areas" className="ex-back">
          <ArrowLeft size={15} aria-hidden /> Weak areas
        </Link>
        <section className="wk-empty glass" aria-labelledby="pr-empty-h">
          <div className={`wk-empty-art ${attempted ? 'done' : ''}`} aria-hidden>
            <span className="wk-empty-ring r1" />
            <span className="wk-empty-ring r2" />
            <span className="wk-empty-ring r3" />
            <span className="wk-empty-core">{attempted && <CircleCheck size={30} />}</span>
          </div>
          <div>
            <div className={`eyebrow ${attempted ? 'wk-eb-green' : 'wk-eb-cyan'}`}>Mistakes drill</div>
            <h1 id="pr-empty-h">{attempted ? 'No mistakes to practise' : 'Nothing to drill yet'}</h1>
            <p className="lead">
              {!attempted
                ? 'This drill replays only the questions you got wrong. Take a topic exam first and any misses land here.'
                : topic
                  ? `Every question you've attempted in ${topic.title} is currently correct.`
                  : 'Every question you have attempted is currently correct.'}
            </p>
            <div className="wk-actions">
              {topic ? (
                <Link to={`/topic/${topic.id}/exam`} className="btn btn-primary">
                  Take the {topic.title} exam <ArrowRight size={16} aria-hidden />
                </Link>
              ) : (
                <Link to="/" className="btn btn-primary">
                  Pick a topic exam <ArrowRight size={16} aria-hidden />
                </Link>
              )}
              <Link to="/weak-areas" className="btn">
                Weak areas
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }
  return (
    <Exam
      key={topicId ?? 'all'}
      title={`Mistakes drill · ${topic ? topic.title : 'all topics'}`}
      questions={questions}
      backHref={topic ? `/topic/${topic.id}?tab=exam` : '/weak-areas'}
    />
  );
}
