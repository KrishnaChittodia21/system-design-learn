import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Target } from 'lucide-react';
import { COMPANY_QUESTIONS, PHASES, TOPICS, TOPIC_BY_ID } from '../content';
import { useProgress } from '../lib/progress';
import { topicCompletion, topicStatus } from '../lib/stats';
import { weakTopics } from '../lib/weak';
import { codeLabLabel, nextStep } from '../lib/nextStep';
import { getUiPrefs } from '../lib/uiPrefs';
import { describeLocation, sameStudyTarget, type LocationLookup } from '../lib/studyLocation';
import { mcqAccuracy, mistakesToDrill, phaseProgress } from '../lib/metrics';
import { studyStreak } from '../lib/streak';
import { phaseCode, shortTitle, topicCode } from '../lib/labels';
import { ProgressPanel } from '../components/ProgressPanel';
import { DashboardMetrics } from '../components/DashboardMetrics';
import { WeakReattempt } from '../components/WeakReattempt';

const TAB_LABELS: Record<string, string> = {
  learn: 'Learn',
  interview: 'Interview Qs',
  envelope: 'Back-of-Envelope',
  cheat: 'Cheat Sheet',
  capstone: 'Capstone',
  exam: 'Exam',
};

const LOOKUP: LocationLookup = {
  topic: (id) => TOPIC_BY_ID.get(id),
  tabLabel: (id, tab) => {
    const t = TOPIC_BY_ID.get(id);
    if (!t) return undefined;
    return tab === 'code' ? codeLabLabel(t) : TAB_LABELS[tab];
  },
  companyQuestion: (id) => COMPANY_QUESTIONS.find((q) => q.id === id)?.title,
};

export default function Home() {
  const p = useProgress();
  const passMark = p.settings.passMark;
  const weak = useMemo(() => weakTopics(p, TOPICS), [p]);
  const readiness = TOPICS.length ? Math.round(TOPICS.reduce((a, t) => a + topicCompletion(p, t), 0) / TOPICS.length) : 0;
  const weakest = weak.find((w) => w.sections.length > 0);
  const step = nextStep(p, TOPICS, {
    companyTotal: COMPANY_QUESTIONS.length,
    weak: weakest ? { topic: weakest.topic, index: weakest.sections[0].index, heading: weakest.sections[0].heading } : null,
  });
  const fresh = step.kind === 'start';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const last = getUiPrefs().lastStudyLocation;
  const lastLabel = last ? describeLocation(last, LOOKUP) : null;
  const resume = last && lastLabel && !sameStudyTarget(last, step.href) ? { href: last, label: lastLabel } : null;

  // ---- record ledger ----
  const phases = phaseProgress(p, TOPICS, PHASES);
  const passedTopics = phases.reduce((n, ph) => n + ph.passed, 0);
  const examAnswers = mcqAccuracy(p, TOPICS).seen;
  const mistakes = mistakesToDrill(p, TOPICS);
  const streak = studyStreak(p.activityDays);

  // ---- on your desk ----
  const onDesk = TOPICS.filter((t) => topicStatus(p, t) === 'in-progress')
    .map((t) => ({ t, pct: topicCompletion(p, t) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);

  const HOW: [string, string][] = [
    ['Learn', 'Read each topic’s short sections and tick “Read” as you finish each one.'],
    ['Code Lab', 'Fix realistic code the way a senior engineer would, then compare with the reference (Answer Lab in the behavioural topics).'],
    ['Interview Qs & Back-of-Envelope', 'Answer out loud and rate yourself, then work the estimation drills one step at a time.'],
    ['Pass the timed exam', `Score ${passMark}% or more and the topic is passed. Pass every exam to unlock the company track.`],
  ];

  const firstUntested = TOPICS.find((t) => !p.tests[t.id]) ?? TOPICS[0];
  const firstExamHref = firstUntested ? `/topic/${firstUntested.id}?tab=exam` : '/contents';
  const answered = Object.keys(p.mcq).length;

  return (
    <div className="page dash">
      <header className="today-lead">
        <section className="today-main" aria-labelledby="today-title">
          <p className="eyebrow today-date">{today}</p>
          <p className="today-kicker">{fresh ? 'Start here' : 'Your next step'}</p>
          <h1 id="today-title" className="today-title">
            {step.title}
          </h1>
          <p className="today-detail">{step.detail}</p>
          <div className="row gap-s wrap today-actions">
            <Link className="btn btn-primary btn-lg" to={step.href}>
              {fresh ? 'Open the first lesson' : step.kind === 'read' ? 'Continue reading' : 'Go'} <ArrowRight size={18} aria-hidden />
            </Link>
            {step.secondary && (
              <Link className="btn btn-lg" to={step.secondary.href}>
                <Target size={16} aria-hidden /> {step.secondary.title}
              </Link>
            )}
          </div>
          {resume && (
            <Link to={resume.href} className="resume-line">
              <span className="resume-label">Where you left off</span>
              <span className="resume-target">{resume.label}</span>
              <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        </section>

        <aside className="ledger" aria-labelledby="ledger-title">
          <h2 id="ledger-title" className="ledger-title">
            Record
          </h2>
          <table className="ledger-phases">
            <caption className="sr-only">Topics passed per phase</caption>
            <colgroup>
              <col />
              <col className="ledger-col-bar" />
              <col className="ledger-col-count" />
            </colgroup>
            <tbody>
              {phases.map((ph) => (
                <tr key={ph.id} className={ph.passed === ph.total ? 'done' : ''}>
                  <th scope="row">
                    <span className="ledger-num">{phaseCode(ph.number)}</span>
                    <span className="ledger-phase" title={ph.title}>
                      {shortTitle(ph.title)}
                    </span>
                  </th>
                  <td className="ledger-bar" aria-hidden>
                    <span style={{ width: `${ph.pct}%` }} />
                  </td>
                  <td className="ledger-count">
                    {ph.passed}/{ph.total}
                    <span className="sr-only"> passed</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ledger-facts">
            <div>
              <dt>Topics passed</dt>
              <dd>
                {passedTopics}
                <span>/{TOPICS.length}</span>
              </dd>
            </div>
            <div>
              <dt>Exam answers</dt>
              <dd>{examAnswers}</dd>
            </div>
            <div>
              <dt>
                <Link to="/practice">Mistakes to drill</Link>
              </dt>
              <dd className={mistakes > 0 ? 'flag' : ''}>
                {mistakes}
                {mistakes > 0 && <span className="sr-only"> (needs attention)</span>}
              </dd>
            </div>
            <div>
              <dt>Study streak</dt>
              <dd>
                {streak}
                <span> day{streak === 1 ? '' : 's'}</span>
              </dd>
            </div>
          </dl>
        </aside>
      </header>

      {fresh && (
        <section className="dash-section how" aria-labelledby="how-title">
          <div className="dash-section-head">
            <h2 id="how-title">How this works</h2>
          </div>
          <ol className="how-steps">
            {HOW.map(([verb, rest], i) => (
              <li key={verb}>
                <span className="how-num">{phaseCode(i + 1)}</span>
                <strong>{verb}</strong>
                <p>{rest}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {onDesk.length > 0 && (
        <section className="dash-section desk" aria-labelledby="desk-title">
          <div className="dash-section-head">
            <h2 id="desk-title">On your desk</h2>
            <span className="muted small">In-progress topics, closest to done first</span>
          </div>
          <ul className="desk-list">
            {onDesk.map(({ t, pct }) => (
              <li key={t.id}>
                <Link to={`/topic/${t.id}`}>
                  <span className="desk-code">{topicCode(TOPICS, PHASES, t.id)}</span>
                  {t.title}
                </Link>
                <span className="desk-bar" aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="desk-pct">
                  {pct}%<span className="sr-only"> complete</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ProgressPanel p={p} />

      <WeakReattempt weak={weak} answered={answered} passMark={passMark} firstExamHref={firstExamHref} />

      <DashboardMetrics p={p} topics={TOPICS} readiness={readiness} firstExamHref={firstExamHref} />
    </div>
  );
}
