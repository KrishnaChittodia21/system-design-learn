import { Link } from 'react-router-dom';
import { COMPANY_QUESTIONS, PHASES, TOPICS } from '../content';
import { useProgress } from '../lib/progress';
import { companyUnlocked, topicCompletion, topicStatus } from '../lib/stats';
import { ProgressBar } from '../components/ui';
import { weakTopics } from '../lib/weak';

export default function Home() {
  const p = useProgress();
  const passed = TOPICS.filter((t) => topicStatus(p, t) === 'passed').length;
  const totalMcq = TOPICS.reduce((a, t) => a + t.test.length, 0);
  const totalIq = TOPICS.reduce((a, t) => a + t.interviewQuestions.length, 0);
  const totalBoe = TOPICS.reduce((a, t) => a + t.envelopeQuestions.length, 0);
  const totalCc = TOPICS.reduce((a, t) => a + t.codeChallenges.length, 0);
  const practicedIq = Object.keys(p.iq).length;
  const next = TOPICS.find((t) => topicStatus(p, t) !== 'passed');
  const { unlocked, remaining } = companyUnlocked(p, TOPICS);
  const weak = weakTopics(p, TOPICS);
  const readiness = TOPICS.length
    ? Math.round(TOPICS.reduce((a, t) => a + topicCompletion(p, t), 0) / TOPICS.length)
    : 0;

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>Your system design roadmap</h1>
          <p className="lead">
            {TOPICS.length} topics across {PHASES.length} phases. Built from <em>System Design Interview Vol 2</em> (Alex Xu),{' '}
            <em>Mastering API Architecture</em> and a senior backend interview syllabus. Learn each topic, practise interview
            questions and estimation drills, fix code, then pass the timed exam. Pass every exam to unlock the company track.
          </p>
          {next && (
            <Link to={`/topic/${next.id}`} className="btn btn-primary">
              {topicStatus(p, next) === 'new' ? 'Start' : 'Continue'}: {next.title} →
            </Link>
          )}
        </div>
        <div className="stat-grid">
          <Stat label="Exams passed" value={`${passed}/${TOPICS.length}`} />
          <Stat label="Readiness" value={`${readiness}%`} />
          <Stat label="Interview Qs practised" value={`${practicedIq}/${totalIq}`} />
          <Stat label="Question bank" value={`${totalMcq + totalIq + totalBoe}`} hint={`${totalMcq} MCQ · ${totalBoe} estimation · ${totalCc} code labs`} />
        </div>
      </section>

      {weak.length > 0 && (
        <section className="card weak-card">
          <div className="row between wrap">
            <h2>Focus next: your weakest areas</h2>
            <Link to="/weak-areas">Full analysis →</Link>
          </div>
          <ul className="weak-sections">
            {weak.slice(0, 4).map((w) => (
              <li key={w.topic.id}>
                <span className="weak-count">{w.attempts ? `${w.last}%` : `${w.wrong.length} wrong`}</span>
                <span className="weak-heading">
                  {w.topic.title}
                  {w.sections[0] && <span className="muted small"> · weakest: {w.sections[0].heading}</span>}
                </span>
                <Link
                  to={w.sections[0] ? `/topic/${w.topic.id}?tab=learn&s=${w.sections[0].index}` : `/topic/${w.topic.id}`}
                  className="small"
                >
                  Revise →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {PHASES.map((ph) => {
        const topics = TOPICS.filter((t) => t.phase === ph.id);
        if (!topics.length) return null;
        const phPassed = topics.filter((t) => topicStatus(p, t) === 'passed').length;
        return (
          <section key={ph.id} className="phase">
            <div className="phase-head">
              <div>
                <div className="eyebrow">Phase {ph.number}</div>
                <h2>{ph.title}</h2>
                <p className="muted">{ph.blurb}</p>
              </div>
              <div className="phase-meter">
                <span className="muted">
                  {phPassed}/{topics.length} passed
                </span>
                <ProgressBar value={(phPassed / topics.length) * 100} tone="good" />
              </div>
            </div>
            <div className="card-grid">
              {topics.map((t) => {
                const st = topicStatus(p, t);
                const rec = p.tests[t.id];
                return (
                  <Link key={t.id} to={`/topic/${t.id}`} className={`topic-card st-${st}`}>
                    <div className="topic-card-top">
                      <span className={`dot dot-${st}`} />
                      <span className="muted small">{t.estimatedMinutes} min</span>
                    </div>
                    <h3>{t.title}</h3>
                    <p className="muted small">{t.subtitle}</p>
                    <div className="topic-card-foot">
                      <ProgressBar value={topicCompletion(p, t)} />
                      <span className="small">
                        {st === 'passed' ? `✓ Passed · best ${rec?.best}%` : rec ? `Best ${rec.best}%` : `${t.test.length}-question exam`}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="phase">
        <div className="phase-head">
          <div>
            <div className="eyebrow">Final track</div>
            <h2>Company-specific system design questions</h2>
            <p className="muted">
              {COMPANY_QUESTIONS.length} reported questions from product companies and Indian unicorns, each with a timed mock interview mode.
            </p>
          </div>
        </div>
        <Link to="/companies" className={`topic-card company-card ${unlocked ? 'st-passed' : 'locked'}`}>
          <h3>{unlocked ? '🔓 Unlocked. Start the company mock interviews' : '🔒 Locked'}</h3>
          <p className="muted small">
            {unlocked
              ? 'You passed every topic exam. Time to practise the real thing.'
              : `Pass ${remaining.length} more topic exam${remaining.length === 1 ? '' : 's'} (pass mark ${p.settings.passMark}%) to unlock.`}
          </p>
        </Link>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
