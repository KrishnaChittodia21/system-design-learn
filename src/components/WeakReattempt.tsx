import { Link } from 'react-router-dom';
import { BookOpen, Mic, RotateCcw, Target } from 'lucide-react';
import type { TopicWeakness } from '../lib/weak';
import { ChartCard } from './charts/ChartCard';
import { BarList } from './charts/BarList';

/** Dashboard: the weakest topics as a bar list with per-topic actions, and how clearing a weak area works. */
export function WeakReattempt({ weak, answered, passMark, firstExamHref }: { weak: TopicWeakness[]; answered: number; passMark: number; firstExamHref: string }) {
  const top = weak.slice(0, 6);
  const maxWrong = Math.max(1, ...top.map((w) => w.wrong.length));
  const totalWrong = weak.reduce((n, w) => n + w.wrong.length, 0);
  const status = (w: TopicWeakness) => (w.attempts ? `last exam ${w.last}% (best ${w.best}%)${w.passed ? ', passed' : ', not passed'}` : 'no full exam yet');
  const empty = !weak.length ? (
    answered ? (
      <>
        <p>No weak areas right now: every exam question you have attempted is currently answered correctly.</p>
        <Link className="btn" to="/weak-areas">
          Open Weak Areas
        </Link>
      </>
    ) : (
      <>
        <p>No weak areas yet. Take an exam to find them.</p>
        <Link className="btn btn-primary" to={firstExamHref}>
          Take an exam
        </Link>
      </>
    )
  ) : undefined;

  return (
    <section className="dash-section" aria-labelledby="weak-title">
      <div className="dash-section-head">
        <h2 id="weak-title">Weak areas &amp; how to reattempt them</h2>
        <Link to="/weak-areas" className="small">
          Full weak-areas analysis →
        </Link>
      </div>
      <div className="weak-grid">
        <ChartCard
          title="Weakest topics"
          subtitle="Bar = exam questions you currently have wrong. Ordered by priority: exams not yet passed and the lowest last score first."
          empty={empty}
          table={{
            columns: ['Topic', 'Wrong now', 'Last exam', 'Best', 'Weakest section', 'Interview Qs partial/missed'],
            rows: weak.map((w) => [w.topic.title, w.wrong.length, w.attempts ? `${w.last}%` : '—', w.attempts ? `${w.best}%` : '—', w.sections[0]?.heading ?? '—', w.shakyInterview]),
          }}
        >
          <BarList
            seriesLabel="Questions currently wrong per topic"
            color="var(--dv-2)"
            max={maxWrong}
            rows={top.map((w) => ({
              id: w.topic.id,
              label: w.topic.title,
              value: w.wrong.length,
              display: `${w.wrong.length} wrong`,
              detail: `${status(w)}${w.shakyInterview ? ` · ${w.shakyInterview} interview Q${w.shakyInterview === 1 ? '' : 's'} to redo` : ''}`,
              extra: (
                <>
                  <span className="muted small weak-row-status">
                    {status(w)}
                    {w.sections[0] && <> · weakest: {w.sections[0].heading}</>}
                  </span>
                  <span className="weak-actions">
                    {w.wrong.length > 0 && (
                      <Link to={`/practice?topic=${w.topic.id}`} className="btn btn-xs">
                        <RotateCcw size={12} aria-hidden /> Practise {w.wrong.length} wrong
                      </Link>
                    )}
                    {w.sections[0] && (
                      <Link to={`/topic/${w.topic.id}?tab=learn&s=${w.sections[0].index}`} className="btn btn-xs" title={`Revise ${w.sections[0].heading}`}>
                        <BookOpen size={12} aria-hidden /> Revise §{w.sections[0].index + 1}
                      </Link>
                    )}
                    {w.shakyInterview > 0 && (
                      <Link to={`/topic/${w.topic.id}?tab=interview`} className="btn btn-xs">
                        <Mic size={12} aria-hidden /> Redo {w.shakyInterview} interview Q{w.shakyInterview === 1 ? '' : 's'}
                      </Link>
                    )}
                    <Link to={`/topic/${w.topic.id}/exam`} className="btn btn-xs">
                      Retake exam
                    </Link>
                  </span>
                </>
              ),
            }))}
          />
          {weak.length > top.length && (
            <p className="small muted">
              +{weak.length - top.length} more on the <Link to="/weak-areas">Weak Areas page</Link>.
            </p>
          )}
        </ChartCard>
        <aside className="card weak-howto" aria-labelledby="howto-title">
          <h3 id="howto-title">
            <Target size={16} aria-hidden className="card-icon" /> How to clear a weak area
          </h3>
          <ol>
            <li>
              <strong>Practise the wrong answers.</strong> The mistakes drill asks only the questions whose <em>latest</em> answer was
              wrong (for one topic or all). Drill answers update each question but never count towards passing an exam.
            </li>
            <li>
              <strong>Answer it right once.</strong> A question leaves the weak list as soon as your most recent answer to it is
              correct, in a drill or a full exam. Get it wrong again later and it comes back.
            </li>
            <li>
              <strong>Revise the weakest section.</strong> Each wrong question is matched to the Learn section it most likely tests
              (automatically, from its wording), so &ldquo;Revise&rdquo; opens that section.
            </li>
            <li>
              <strong>Retake the full exam.</strong> Only a full-length exam updates your score and can pass the topic (pass mark{' '}
              {passMark}%). A topic stays listed while an attempted exam is still unpassed, any question is still wrong, or an interview question is
              rated partial or missed. Re-rate those after practising them.
            </li>
          </ol>
          <div className="row gap-s wrap">
            {totalWrong > 0 && (
              <Link to="/practice" className="btn btn-primary btn-sm">
                <RotateCcw size={14} aria-hidden /> Practise all {totalWrong} wrong answer{totalWrong === 1 ? '' : 's'}
              </Link>
            )}
            <Link to="/weak-areas" className="btn btn-sm">
              Weak areas page
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
