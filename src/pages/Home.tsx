import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Building2, Dumbbell, ListTree, Lock, LockOpen, Map as MapIcon, Target } from 'lucide-react';
import { COMPANY_QUESTIONS, PHASES, TOPICS, TOPIC_BY_ID } from '../content';
import { useProgress } from '../lib/progress';
import { companyUnlocked, topicCompletion, topicStatus } from '../lib/stats';
import { weakTopics } from '../lib/weak';
import { nextStep } from '../lib/nextStep';
import { phaseProgress } from '../lib/metrics';
import { getUiPrefs } from '../lib/uiPrefs';
import { ProgressRing } from '../components/ProgressRing';
import { CountUp } from '../components/CountUp';
import { NextStepCard } from '../components/NextStepCard';
import { JourneyMap } from '../components/JourneyMap';
import { ChartCard } from '../components/charts/ChartCard';
import { BarList } from '../components/charts/BarList';
import { DashboardMetrics } from '../components/DashboardMetrics';
import { WeakReattempt } from '../components/WeakReattempt';
import { shortTitle } from '../lib/labels';

const TAB_LABELS: Record<string, string> = {
  learn: 'Learn',
  code: 'Code Lab',
  interview: 'Interview Qs',
  envelope: 'Back-of-Envelope',
  cheat: 'Cheat Sheet',
  capstone: 'Capstone',
  exam: 'Exam',
};
const PAGE_LABELS: Record<string, string> = {
  '/contents': 'Contents',
  '/weak-areas': 'Weak Areas',
  '/companies': 'Company track',
  '/settings': 'Settings',
};

/** Human label for a saved location, e.g. "Caching patterns · Learn · §3 Write-through". */
function describeLocation(loc: string): string | null {
  const [path, search = ''] = loc.split('?');
  const params = new URLSearchParams(search);
  const topic = /^\/topic\/([^/]+)/.exec(path);
  if (topic) {
    const t = TOPIC_BY_ID.get(topic[1]);
    if (!t) return null;
    const tab = params.get('tab') ?? 'learn';
    const s = Number(params.get('s'));
    const sec = tab === 'learn' && params.has('s') && t.sections[s] ? ` · §${s + 1} ${t.sections[s].heading}` : '';
    return `${t.title} · ${TAB_LABELS[tab] ?? 'Learn'}${sec}`;
  }
  const cq = /^\/companies\/(.+)$/.exec(path);
  if (cq) return COMPANY_QUESTIONS.find((q) => q.id === cq[1])?.title ?? null;
  return PAGE_LABELS[path] ?? null;
}

export default function Home() {
  const p = useProgress();
  const navigate = useNavigate();
  const { unlocked, remaining } = companyUnlocked(p, TOPICS);
  const weak = useMemo(() => weakTopics(p, TOPICS), [p]);
  const readiness = TOPICS.length ? Math.round(TOPICS.reduce((a, t) => a + topicCompletion(p, t), 0) / TOPICS.length) : 0;
  const weakest = weak.find((w) => w.sections.length > 0);
  const step = nextStep(p, TOPICS, {
    companyTotal: COMPANY_QUESTIONS.length,
    weak: weakest ? { topic: weakest.topic, index: weakest.sections[0].index, heading: weakest.sections[0].heading } : null,
  });
  const last = getUiPrefs().lastStudyLocation;
  const lastLabel = last ? describeLocation(last) : null;
  const resume = last && lastLabel && last !== step.href ? { href: last, label: lastLabel } : null;
  const journey = PHASES.map((phase) => {
    const topics = TOPICS.filter((t) => t.phase === phase.id);
    return { phase, total: topics.length, passed: topics.filter((t) => topicStatus(p, t) === 'passed').length };
  }).filter((x) => x.total > 0);
  const phases = phaseProgress(p, TOPICS, PHASES);
  const openPhase = (id: string) => navigate(`/contents#phase-${id}`);
  const firstUntested = TOPICS.find((t) => !p.tests[t.id]) ?? TOPICS[0];
  const firstExamHref = firstUntested ? `/topic/${firstUntested.id}?tab=exam` : '/contents';
  const answered = Object.keys(p.mcq).length;
  const wrongCount = Object.values(p.mcq).filter((r) => !r.lastCorrect).length;

  return (
    <div className="page dashboard">
      <section className="hero hero-grad">
        <div className="aurora" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="hero-copy">
          <div className="eyebrow">Dashboard</div>
          <h1 className="hero-title">Your system design roadmap</h1>
          <p className="lead">
            {TOPICS.length} topics across {PHASES.length} phases, built from <em>System Design Interview Vol 2</em> (Alex Xu),{' '}
            <em>Mastering API Architecture</em> and a senior backend interview syllabus. Learn each topic, practise it the way
            interviews test it, then pass the timed exam. Pass every exam to unlock the company track.
          </p>
          <Link to="/contents" className="btn">
            Browse all contents <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
        <div className="hero-ring">
          <ProgressRing gradient value={readiness} size={148} stroke={12} tone={readiness === 100 ? 'good' : undefined} label={`Readiness ${readiness}%`}>
            <span className="hero-ring-value">
              <CountUp value={readiness} suffix="%" />
            </span>
            <span className="hero-ring-label">readiness</span>
          </ProgressRing>
        </div>
      </section>

      <NextStepCard step={step} resume={resume} />

      <section className="dash-section" aria-labelledby="roadmap-title">
        <div className="dash-section-head">
          <div>
            <div className="eyebrow">
              <MapIcon size={14} aria-hidden /> Your roadmap
            </div>
            <h2 id="roadmap-title">Phase by phase to the company track</h2>
          </div>
          <Link to="/contents" className="small">
            All topics in Contents →
          </Link>
        </div>
        <JourneyMap phases={journey} unlocked={unlocked} onSelect={openPhase} />
        <ChartCard
          title="Progress by phase"
          subtitle="Share of each phase's exams passed, in course order. Select a phase to open it in Contents."
          table={{ columns: ['Phase', 'Exams passed', 'Topics', 'Share'], rows: phases.map((ph) => [`${ph.number}. ${ph.title}`, ph.passed, ph.total, `${ph.pct}%`]) }}
        >
          <BarList
            seriesLabel="Exams passed per phase"
            rows={phases.map((ph) => ({
              id: ph.id,
              label: `${ph.number}. ${shortTitle(ph.title)}`,
              value: ph.pct,
              display: `${ph.passed}/${ph.total}`,
              detail: `${ph.pct}% of ${ph.title} passed`,
              href: `/contents#phase-${ph.id}`,
            }))}
          />
        </ChartCard>
      </section>

      <DashboardMetrics p={p} topics={TOPICS} readiness={readiness} companyTotal={COMPANY_QUESTIONS.length} companyUnlocked={unlocked} firstExamHref={firstExamHref} />

      <WeakReattempt weak={weak} answered={answered} passMark={p.settings.passMark} firstExamHref={firstExamHref} />

      <nav className="dash-practice" aria-label="Practice">
        <span className="label">Practice</span>
        <Link to="/practice" className="chip-link">
          <Dumbbell size={15} aria-hidden /> Mistakes drill{wrongCount > 0 && <span className="side-badge">{wrongCount}</span>}
        </Link>
        <Link to="/weak-areas" className="chip-link">
          <Target size={15} aria-hidden /> Weak Areas
        </Link>
        <Link to="/companies" className="chip-link" title={unlocked ? 'Company track unlocked' : `Pass ${remaining.length} more exam${remaining.length === 1 ? '' : 's'} to unlock`}>
          {unlocked ? <LockOpen size={15} aria-hidden /> : <Lock size={15} aria-hidden />} <Building2 size={15} aria-hidden /> Company questions ({COMPANY_QUESTIONS.length})
        </Link>
        <Link to="/contents" className="chip-link">
          <ListTree size={15} aria-hidden /> Contents
        </Link>
      </nav>
    </div>
  );
}
