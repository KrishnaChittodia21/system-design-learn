import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TOPICS, TOPIC_BY_ID } from '../content';
import type { Difficulty } from '../types';
import { useProgress } from '../lib/progress';
import { accuracyBreakdown, currentlyWrong, pct, weakTopics, type Accuracy } from '../lib/weak';
import { Badge, ProgressBar } from '../components/ui';
import { Exam } from './Exam';

function AccuracyBar({ label, a }: { label: ReactNode; a: Accuracy }) {
  const v = pct(a);
  return (
    <div className="acc-row">
      <span className="acc-label">{label}</span>
      <ProgressBar value={v ?? 0} tone={v !== null && v >= 70 ? 'good' : undefined} />
      <span className="acc-val">{v === null ? '—' : `${v}%`}</span>
      <span className="muted small acc-n">{a.seen ? `${a.correct}/${a.seen}` : 'no data'}</span>
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
      <div className="page narrow">
        <h1>Weak areas</h1>
        <div className="card info">
          Nothing to analyse yet. Take any topic exam and this page will show the topics, sections and question types where you
          lose marks, with links straight to what to revise.
        </div>
        <Link to="/" className="btn btn-primary">
          Go to the roadmap →
        </Link>
      </div>
    );
  }

  const levels: Difficulty[] = ['medium', 'hard', 'expert'];
  return (
    <div className="page">
      <div className="eyebrow">Your analytics</div>
      <h1>Weak areas</h1>
      <p className="lead">
        Based on your latest answer to each of the {answered} exam questions you&apos;ve attempted. A question leaves this list once
        you answer it correctly.
      </p>

      <div className="two-col weak-summary">
        <div className="card">
          <div className="label">Accuracy by difficulty</div>
          {levels.map((d) => (
            <AccuracyBar key={d} label={<span className={`badge badge-${d}`}>{d}</span>} a={byDifficulty[d]} />
          ))}
          <AccuracyBar label={<strong>Overall</strong>} a={overall} />
        </div>
        <div className="card">
          <div className="label">Accuracy by question type</div>
          <AccuracyBar label="Single answer" a={byFormat.single} />
          <AccuracyBar label="Select all that apply" a={byFormat.multi} />
          <AccuracyBar label="Reading code" a={byFormat.code} />
          <p className="muted small">
            A low "select all" score usually means you spot the main idea but miss a second valid trade-off. Read explanations for
            the options you skipped.
          </p>
        </div>
      </div>

      <div className="row between wrap">
        <h2>
          Focus list ({weak.length} topic{weak.length === 1 ? '' : 's'})
        </h2>
        {totalWrong > 0 && (
          <Link to="/practice" className="btn btn-primary">
            Practise all {totalWrong} mistakes
          </Link>
        )}
      </div>
      {!weak.length && <div className="card info">No weak topics right now. Every question you&apos;ve attempted is currently correct. 🎯</div>}

      {weak.map((w) => (
        <article key={w.topic.id} className="card weak-topic-card">
          <div className="section-head">
            <div>
              <Link to={`/topic/${w.topic.id}`}>
                <h3>{w.topic.title}</h3>
              </Link>
              <div className="row gap-s wrap small">
                {w.attempts > 0 ? (
                  w.passed ? (
                    <Badge tone="good">Passed</Badge>
                  ) : (
                    <Badge tone="expert">Not passed</Badge>
                  )
                ) : (
                  <Badge>Drill only</Badge>
                )}
                {w.attempts > 0 && (
                  <span className="muted">
                    Last {w.last}% · best {w.best}% · {w.attempts} attempt{w.attempts === 1 ? '' : 's'}
                  </span>
                )}
                {w.history.length > 1 && <span className="trend">Trend: {w.history.slice(-5).join(' → ')}</span>}
              </div>
            </div>
            <span className="weak-big" title="questions currently wrong">
              {w.wrong.length}
            </span>
          </div>

          {w.sections.length > 0 && (
            <ul className="weak-sections">
              {w.sections.slice(0, 5).map((ws) => (
                <li key={ws.index}>
                  <span className="weak-count">{ws.missed.length} missed</span>
                  <span className="weak-heading">{ws.heading}</span>
                  <Link to={`/topic/${w.topic.id}?tab=learn&s=${ws.index}`} className="small">
                    Revise section →
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {w.shakyInterview > 0 && (
            <p className="small">
              🗣 {w.shakyInterview} interview question{w.shakyInterview === 1 ? '' : 's'} self-rated <em>partial</em> or{' '}
              <em>missed</em>. <Link to={`/topic/${w.topic.id}?tab=interview`}>Practise them →</Link>
            </p>
          )}
          <div className="row gap-s wrap">
            {w.wrong.length > 0 && (
              <Link to={`/practice?topic=${w.topic.id}`} className="btn">
                Practise {w.wrong.length} mistake{w.wrong.length === 1 ? '' : 's'}
              </Link>
            )}
            <Link to={`/topic/${w.topic.id}/exam`} className="btn-ghost">
              Retake full exam
            </Link>
          </div>
        </article>
      ))}
      <p className="muted small">
        Sections are matched automatically from each question&apos;s wording, so treat them as a pointer. The exam review shows the
        exact reasoning.
      </p>
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
    return (
      <div className="page narrow">
        <h1>No mistakes to practise</h1>
        <p className="lead">
          {topic ? `Every question you've attempted in ${topic.title} is currently correct.` : 'Every question you have attempted is currently correct.'}
        </p>
        <Link to="/weak-areas" className="btn">
          ← Weak areas
        </Link>
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
