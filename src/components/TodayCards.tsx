import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, LockKeyhole, LockKeyholeOpen, Mic, RotateCcw } from 'lucide-react';
import type { TopicWeakness } from '../lib/weak';
import { shiftDay } from '../lib/metrics';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ company track */
export function CompanyTrackCard({
  unlocked,
  remaining,
  topics,
  questions,
  practised,
  companies,
  mockMinutes,
  passMark,
}: {
  unlocked: boolean;
  remaining: number;
  topics: number;
  questions: number;
  practised: number;
  companies: string[];
  mockMinutes: number;
  passMark: number;
}) {
  const share = unlocked ? (questions ? (practised / questions) * 100 : 0) : topics ? ((topics - remaining) / topics) * 100 : 0;
  const SHOW = 9;
  return (
    <section className="glass card td-track" aria-labelledby="td-track-title">
      <div className="td-track-head">
        <span
          className="td-track-ring"
          role="img"
          aria-label={unlocked ? `Company track unlocked, ${Math.round(share)}% of questions practised` : `Company track ${Math.round(share)} percent unlocked`}
        >
          <span className="nb-ring" style={{ '--rw': '5px', background: `conic-gradient(var(--blue) 0 ${share.toFixed(1)}%, var(--tint-2) ${share.toFixed(1)}%)` } as CSSProperties} />
          <span className="td-track-ic">{unlocked ? <LockKeyholeOpen size={20} aria-hidden /> : <LockKeyhole size={20} aria-hidden />}</span>
        </span>
        <div>
          <div className="eyebrow">Company track · {unlocked ? 'unlocked' : 'locked'}</div>
          <h2 id="td-track-title" className="td-h2">
            {unlocked ? `${practised} of ${questions} practised` : `${plural(remaining, 'exam')} to go`}
          </h2>
        </div>
      </div>
      <p className="td-body">
        {plural(questions, 'question')} from {plural(companies.length, 'company', 'companies')}, each with a {mockMinutes}-minute mock timer.{' '}
        {unlocked ? 'Every topic exam is passed: run timed mocks on real interview questions.' : `Unlocks when every topic exam is passed at ${passMark}%.`}
      </p>
      {companies.length > 0 && (
        <ul className="td-co" aria-label="Companies in the track">
          {companies.slice(0, SHOW).map((c) => (
            <li key={c}>{c}</li>
          ))}
          {companies.length > SHOW && <li>+{companies.length - SHOW}</li>}
        </ul>
      )}
      <Link to="/companies" className="td-link td-card-foot">
        {unlocked ? 'Open the company track →' : 'Preview a mock interview →'}
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------------ weak spot */
export function WeakSpotCard({
  weak,
  answered,
  passMark,
  firstExamHref,
  mistakes,
}: {
  weak: TopicWeakness[];
  answered: number;
  passMark: number;
  firstExamHref: string;
  mistakes: number;
}) {
  // the weakest topic with a section to revise first (the one the hero's secondary action points at), else the weakest
  const w = weak.find((x) => x.sections.length > 0) ?? weak[0];
  const sec = w?.sections[0];
  const examLine = w ? (w.attempts ? `Exam best ${w.best}%, last ${w.last}%${w.passed ? ' (passed)' : ''}.` : 'No full exam yet.') : '';
  const missLine =
    w && sec && w.wrong.length ? ` ${sec.missed.length === w.wrong.length ? (w.wrong.length === 1 ? 'Your one miss' : `All ${w.wrong.length} of your misses`) : `${sec.missed.length} of your ${w.wrong.length} misses`} came from this section.` : '';
  const shaky = w && w.shakyInterview ? ` ${plural(w.shakyInterview, 'interview question')} rated partial or missed.` : '';

  return (
    <section className="gborder td-weak" aria-labelledby="td-weak-title">
      <div className="in">
        <div className="eyebrow td-weak-eyebrow">Weak spot</div>
        {w ? (
          <>
            <h2 id="td-weak-title" className="td-h2">
              <Link to={`/topic/${w.topic.id}`}>{w.topic.title}</Link>
            </h2>
            {sec && (
              <p className="mono td-weak-sec">
                §{sec.index + 1} {sec.heading.replace(/^\d+\.\s+/, '')}
              </p>
            )}
            <p className="td-body">
              {examLine}
              {missLine}
              {shaky}
            </p>
            <div className="td-actions">
              {sec && (
                <Link to={`/topic/${w.topic.id}?tab=learn&s=${sec.index}`} className="btn btn-primary btn-sm">
                  <BookOpen size={14} aria-hidden /> Re-read §{sec.index + 1}
                </Link>
              )}
              {w.wrong.length > 0 && (
                <Link to={`/practice?topic=${w.topic.id}`} className="btn btn-sm">
                  <RotateCcw size={14} aria-hidden /> Retry {plural(w.wrong.length, 'miss', 'misses')}
                </Link>
              )}
              {!w.wrong.length && w.shakyInterview > 0 && (
                <Link to={`/topic/${w.topic.id}?tab=interview`} className="btn btn-sm">
                  <Mic size={14} aria-hidden /> Redo interview Qs
                </Link>
              )}
              {!sec && (
                <Link to={`/topic/${w.topic.id}/exam`} className="btn btn-sm">
                  Retake exam
                </Link>
              )}
            </div>
            <p className="td-weak-more">
              {weak.length > 1 && <>{plural(weak.length - 1, 'more weak topic')} · </>}
              {mistakes > 0 && (
                <>
                  <Link to="/practice">Drill all {plural(mistakes, 'mistake')}</Link> ·{' '}
                </>
              )}
              <Link to="/weak-areas">Weak areas →</Link>
            </p>
          </>
        ) : (
          <>
            <h2 id="td-weak-title" className="td-h2">
              {answered ? 'No weak spots right now' : 'No weak spots yet'}
            </h2>
            <p className="td-body">
              {answered
                ? 'Every exam question you have attempted is currently answered correctly, and no interview answer is rated partial or missed.'
                : 'Take a timed exam and the questions you miss are traced back to the Learn section they test. Your weakest one shows up here.'}
            </p>
            <div className="td-actions">
              {answered ? (
                <Link className="btn btn-sm" to="/weak-areas">
                  Open weak areas
                </Link>
              ) : (
                <Link className="btn btn-primary btn-sm" to={firstExamHref}>
                  Take an exam
                </Link>
              )}
            </div>
          </>
        )}
        <details className="td-howto">
          <summary>How clearing a weak area works</summary>
          <ol>
            <li>
              <strong>Practise the wrong answers.</strong> The mistakes drill asks only questions whose latest answer was wrong. Drills update each
              question but never count towards passing an exam.
            </li>
            <li>
              <strong>Answer it right once.</strong> A question leaves the weak list as soon as your most recent answer to it is correct.
            </li>
            <li>
              <strong>Revise the weakest section.</strong> Each wrong question is matched to the Learn section it most likely tests, so
              &ldquo;Re-read&rdquo; opens that section.
            </li>
            <li>
              <strong>Retake the full exam.</strong> Only a full-length exam updates your score and can pass the topic (pass mark {passMark}%).
              Re-rate partial or missed interview questions after practising them.
            </li>
          </ol>
        </details>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ study streak */
function longestRun(days: string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev = '';
  for (const d of sorted) {
    run = prev && shiftDay(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

function fmt(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function StreakCard({ days, today, streak }: { days: string[]; today: string; streak: number }) {
  const set = new Set(days);
  const cells = Array.from({ length: 28 }, (_, i) => {
    const day = shiftDay(today, i - 27);
    return { day, on: set.has(day), today: day === today };
  });
  // the days that make up the current streak (ending today, or yesterday when today has no study yet)
  const streakFrom = shiftDay(set.has(today) ? today : shiftDay(today, -1), -(streak - 1));
  const inStreak = (d: string) => streak > 0 && d >= streakFrom && d <= today;
  const studied = cells.filter((c) => c.on).length;
  const longest = Math.max(longestRun(days), streak);
  const studiedToday = set.has(today);
  const title = streak > 1 ? `${streak} days in a row` : streak === 1 ? (studiedToday ? 'Studied today' : 'Studied yesterday') : studied ? 'Streak paused' : 'Start a streak';
  const note = studiedToday
    ? `You have studied today. ${longest > 1 ? `Longest streak: ${plural(longest, 'day')}.` : 'Come back tomorrow to build a streak.'}`
    : streak > 0
      ? `Read one section today to keep it going.${longest > streak ? ` Longest streak: ${plural(longest, 'day')}.` : ''}`
      : studied
        ? `Read one section today to start a new streak.${longest > 1 ? ` Longest streak: ${plural(longest, 'day')}.` : ''}`
        : 'Any study counts: read a section, rate an interview question or take an exam.';

  return (
    <section className="glass card td-streak" aria-labelledby="td-streak-title">
      <div className="eyebrow">Study activity · last 4 weeks</div>
      <h2 id="td-streak-title" className="td-h2">
        {title}
      </h2>
      <div
        className="td-heat"
        role="img"
        aria-label={`Studied on ${studied} of the last 28 days${streak ? `, including the last ${plural(streak, 'day')} in a row` : ''}.`}
      >
        {cells.map((c) => (
          <span
            key={c.day}
            title={`${fmt(c.day)}${c.today ? ' (today)' : ''}: ${c.on ? 'studied' : 'no study'}`}
            className={`${c.on ? (inStreak(c.day) ? 'on run' : 'on') : ''} ${c.today ? 'today' : ''}`}
          />
        ))}
      </div>
      <p className="td-body">{note}</p>
    </section>
  );
}
