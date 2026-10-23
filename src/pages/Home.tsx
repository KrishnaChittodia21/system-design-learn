import { useMemo, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Target } from 'lucide-react';
import { COMPANIES, COMPANY_QUESTIONS, PHASES, TOPICS, TOPIC_BY_ID } from '../content';
import { projectsForTopic } from '../content/projects';
import { localDay, useProgress } from '../lib/progress';
import { companyUnlocked, topicCompletion, topicStatus } from '../lib/stats';
import { weakTopics } from '../lib/weak';
import { codeLabLabel, nextStep, topicSteps, type StepId, type TopicStep } from '../lib/nextStep';
import { getUiPrefs } from '../lib/uiPrefs';
import { describeLocation, sameStudyTarget, type LocationLookup } from '../lib/studyLocation';
import { averageBest, mistakesToDrill, phaseProgress, practiceVolume, ratingCounts, statusCounts } from '../lib/metrics';
import { studyStreak } from '../lib/streak';
import { phaseCode, topicCode } from '../lib/labels';
import { HeroDiagram } from '../components/HeroDiagram';
import { PhaseList, SystemMap } from '../components/SystemMap';
import { ProgressPanel } from '../components/ProgressPanel';
import { CompanyTrackCard, StreakCard, WeakSpotCard } from '../components/TodayCards';
import { DashboardMetrics } from '../components/DashboardMetrics';
import { AchievementsSummary } from '../components/achievements/AchievementsSummary';
import { CountUp } from '../components/CountUp';
import { gsap, heroIn, MOTION_OK, revealOnScroll, useGSAP } from '../lib/gsap';

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

/** which study-path pill the next step sits on */
const KIND_STEP: Partial<Record<string, StepId>> = { start: 'learn', read: 'learn', code: 'code', interview: 'interview', envelope: 'envelope', exam: 'exam' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

function joinAnd(parts: string[]) {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "the Code Lab, 7 interview questions and 3 estimation drills follow": the unfinished steps after the current one */
function whatFollows(steps: TopicStep[], current: StepId | undefined) {
  const at = steps.findIndex((s) => s.id === current);
  const parts = steps
    .slice(at + 1)
    .filter((s) => !s.complete && s.id !== 'capstone')
    .map((s) => {
      const left = s.total - s.done;
      if (s.id === 'code') return `the ${s.label}`;
      if (s.id === 'interview') return plural(left, 'interview question');
      if (s.id === 'envelope') return plural(left, 'estimation drill');
      if (s.id === 'exam') return 'the exam';
      return s.label;
    });
  if (!parts.length) return '';
  const many = parts.length > 1 || /s$/.test(parts[0]);
  return `${joinAnd(parts)} ${many ? 'follow' : 'follows'}`;
}

export default function Home() {
  const p = useProgress();
  const root = useRef<HTMLDivElement>(null);
  // GSAP: the hero copy enters as one group on mount, the ring as media; the tiles and every section below reveal
  // as they scroll into view; a magnetic primary button for fine pointers. Nothing runs with reduced motion;
  // everything is reverted on unmount.
  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const q = gsap.utils.selector(el);
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        heroIn(q('.td-mission-in, .td-mini'));
        heroIn(q('.td-ringcol'), { media: true });
        revealOnScroll(q('.td-tiles, .td-reveal'));
      });
      mm.add(`${MOTION_OK} and (pointer: fine)`, () => {
        const btn = q('.td-cta')[0] as HTMLElement | undefined;
        if (!btn) return;
        const x = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3.out' });
        const y = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3.out' });
        const move = (e: PointerEvent) => {
          const r = btn.getBoundingClientRect();
          x(((e.clientX - (r.left + r.width / 2)) / r.width) * 8);
          y(((e.clientY - (r.top + r.height / 2)) / r.height) * 6);
        };
        const leave = () => {
          x(0);
          y(0);
        };
        btn.addEventListener('pointermove', move);
        btn.addEventListener('pointerleave', leave);
        return () => {
          btn.removeEventListener('pointermove', move);
          btn.removeEventListener('pointerleave', leave);
          gsap.set(btn, { clearProps: 'transform' });
        };
      });
    },
    { scope: root },
  );

  const passMark = p.settings.passMark;
  const weak = useMemo(() => weakTopics(p, TOPICS), [p]);
  const readiness = TOPICS.length ? Math.round(TOPICS.reduce((a, t) => a + topicCompletion(p, t), 0) / TOPICS.length) : 0;
  const weakest = weak.find((w) => w.sections.length > 0);
  const step = nextStep(p, TOPICS, {
    companyTotal: COMPANY_QUESTIONS.length,
    weak: weakest ? { topic: weakest.topic, index: weakest.sections[0].index, heading: weakest.sections[0].heading } : null,
  });
  const fresh = step.kind === 'start';
  const topic = step.topic;
  const phase = topic ? PHASES.find((ph) => ph.id === topic.phase) : undefined;
  const steps = topic ? topicSteps(p, topic, projectsForTopic(topic.id).length) : [];
  const currentStep = KIND_STEP[step.kind];
  const learn = steps.find((s) => s.id === 'learn');

  const last = getUiPrefs().lastStudyLocation;
  const lastLabel = last ? describeLocation(last, LOOKUP) : null;
  const resume = last && lastLabel && !sameStudyTarget(last, step.href) ? { href: last, label: lastLabel } : null;

  // ---- figures (all derived from saved progress + content) ----
  const phases = phaseProgress(p, TOPICS, PHASES);
  const counts = statusCounts(p, TOPICS);
  const volume = practiceVolume(p, TOPICS, COMPANY_QUESTIONS.length);
  const vol = (id: string) => volume.find((v) => v.id === id) ?? { done: 0, total: 0, pct: 0 };
  const sections = vol('learn');
  const boe = vol('envelope');
  const ratings = ratingCounts(p, TOPICS);
  const taken = TOPICS.filter((t) => p.tests[t.id]).length;
  const avgBest = averageBest(p, TOPICS);
  const mistakes = mistakesToDrill(p, TOPICS);
  const today = localDay();
  const streak = studyStreak(p.activityDays, today);
  const { unlocked, remaining } = companyUnlocked(p, TOPICS);
  const companyNames = COMPANIES.length ? COMPANIES.map((c) => c.name) : [...new Set(COMPANY_QUESTIONS.map((q) => q.company))];
  const answered = Object.keys(p.mcq).length;
  const firstUntested = TOPICS.find((t) => !p.tests[t.id]) ?? TOPICS[0];
  const firstExamHref = firstUntested ? `/topic/${firstUntested.id}?tab=exam` : '/contents';
  const ringFigures = {
    phases,
    currentPhaseId: phase?.id,
    passed: counts.passed,
    topics: counts.total,
    sectionsRead: sections.done,
    sectionsTotal: sections.total,
    iqRated: ratings.rated,
    iqTotal: ratings.total,
  };

  // ---- on your desk: other in-progress topics, closest to done first ----
  const onDesk = TOPICS.filter((t) => t.id !== topic?.id && topicStatus(p, t) === 'in-progress')
    .map((t) => ({ t, done: topicCompletion(p, t) }))
    .sort((a, b) => b.done - a.done)
    .slice(0, 4);

  // ---- hero copy ----
  const phaseName = phase ? (phase.title.length > 28 ? phase.title.replace(/^Miscellaneous:\s*/, '').replace(/\s*\([^)]*\)/, '') : phase.title) : '';
  const eyebrow: ReactNode = phase ? (
    <>
      {fresh ? 'Start here' : 'Next step'} · Phase {phaseCode(phase.number)}
      <span className="td-eyebrow-name"> · {phaseName}</span>
    </>
  ) : step.kind === 'company' ? (
    'Next step · Company track'
  ) : (
    'Course complete'
  );
  const heading = topic ? topic.title : step.title;
  const detail = topic && step.detail.startsWith(`${topic.title}: `) ? step.detail.slice(topic.title.length + 2) : step.detail;
  const follows = topic ? whatFollows(steps, currentStep) : '';
  let lede: ReactNode;
  if (fresh && topic) {
    lede = (
      <>
        Begin with <strong>§1 {topic.sections[0]?.heading}</strong>. Read each section, then tick &ldquo;Read&rdquo; so the app can guide you
        {follows ? `; ${follows}` : ''}.
      </>
    );
  } else if (step.kind === 'read' && learn) {
    lede = (
      <>
        Read the next section: <strong>{step.title.replace(/^Read /, '')}</strong>. You have read {learn.done} of {plural(learn.total, 'section')}
        {follows ? `; ${follows}` : ''}.
      </>
    );
  } else if (topic) {
    lede = (
      <>
        <strong>{step.title}.</strong> {detail}
      </>
    );
  } else {
    lede = detail;
  }
  const secNo = /§(\d+)/.exec(step.title)?.[1];
  const ctaLabel: Record<string, string> = {
    start: 'Open the first lesson',
    read: secNo ? `Continue §${secNo}` : 'Continue reading',
    code: `Open the ${topic ? codeLabLabel(topic) : 'Code Lab'}`,
    interview: 'Practise interview Qs',
    envelope: 'Start the drills',
    exam: topic && p.tests[topic.id] ? 'Retake the exam' : 'Take the exam',
    company: 'Open the company track',
    done: 'Open weak areas',
  };

  const HOW: [string, string][] = [
    ['Learn', 'Read each topic’s short sections and tick “Read” as you finish each one.'],
    ['Code Lab', 'Fix realistic code the way a senior engineer would, then compare with the reference (Answer Lab in the behavioural topics).'],
    ['Interview Qs & Back-of-Envelope', 'Answer out loud and rate yourself, then work the estimation drills one step at a time.'],
    ['Pass the timed exam', `Score ${passMark}% or more and the topic is passed. Pass every exam to unlock the company track.`],
  ];

  const tiles = [
    {
      id: 'topics',
      label: 'Topics passed',
      value: counts.passed,
      of: `/${counts.total}`,
      bar: counts.passed > 0 && <i className="f-pass" style={{ width: `${pct(counts.passed, counts.total)}%` }} />,
      note: counts.inProgress ? `${counts.inProgress} more in progress` : counts.passed ? 'none in progress right now' : 'pass a topic’s exam to count it',
    },
    {
      id: 'exams',
      label: 'Exams passed',
      value: counts.passed,
      of: `of ${taken} taken`,
      bar: counts.passed > 0 && <i className="td-fill-grad" style={{ width: `${pct(counts.passed, taken)}%` }} />,
      note: avgBest === null ? `Pass mark ${passMark}%` : `Average best score ${avgBest}% · pass mark ${passMark}%`,
    },
    {
      id: 'iq',
      label: 'Interview Qs rated',
      short: 'Interview Qs',
      value: ratings.rated,
      of: `/${ratings.total}`,
      bar: ratings.rated > 0 && <i style={{ width: `${pct(ratings.rated, ratings.total)}%`, background: 'var(--mag)' }} />,
      note: ratings.rated ? `${ratings.nailed} rated “nailed it”` : 'answer out loud, then rate yourself',
    },
    {
      id: 'boe',
      label: 'Back-of-envelope drills',
      short: 'BoE drills',
      value: boe.done,
      of: `/${boe.total}`,
      bar: boe.done > 0 && <i style={{ width: `${boe.pct}%`, background: 'var(--amber)' }} />,
      note: boe.done ? `${plural(boe.total - boe.done, 'drill')} to go` : 'estimation maths, one step at a time',
    },
  ];

  return (
    <div className="page today" ref={root} data-motion="own">
      <section className="td-hero" aria-labelledby="today-title">
        <div className="td-mission">
          <div className="td-mission-in">
            <p className="nb-chip amber td-eyebrow">
              <span className="dot pulse-a td-key-amber" aria-hidden />
              {eyebrow}
            </p>
            <h1 id="today-title" className="td-title">
              <span className="gtext">{heading}</span>
            </h1>
            <p className="lede td-lede">{lede}</p>
            {topic && <p className="td-mobile-only td-lede-s">{step.kind === 'read' || fresh ? (fresh ? `§1 ${topic.sections[0]?.heading ?? ''}` : step.title.replace(/^Read /, '')) : step.title}</p>}
            {learn && (step.kind === 'read' || fresh) && (
              <div className="td-mobile-only td-mission-meter">
                <div className="track" aria-hidden>
                  {learn.done > 0 && <i className="f-pass" style={{ width: `${pct(learn.done, learn.total)}%` }} />}
                </div>
                <div className="mono">
                  {learn.done} of {plural(learn.total, 'section')} read
                </div>
              </div>
            )}
            <div className="td-actions">
              <Link className="btn btn-primary btn-lg td-cta" to={step.href}>
                {ctaLabel[step.kind]} <ArrowRight size={18} aria-hidden />
              </Link>
              {step.secondary ? (
                <Link className="btn btn-lg td-cta-2" to={step.secondary.href} title={step.secondary.title}>
                  <Target size={16} aria-hidden /> Revise weak spot<span className="sr-only">: {step.secondary.title.replace(/^Revise weak area:\s*/, '')}</span>
                </Link>
              ) : (
                <Link className="btn btn-lg td-cta-2" to="/contents">
                  Open contents
                </Link>
              )}
            </div>
            {resume && (
              <Link to={resume.href} className="td-resume">
                <span className="eyebrow">Where you left off</span>
                <span className="td-resume-target">{resume.label}</span>
                <ArrowRight size={14} aria-hidden />
              </Link>
            )}
            {topic && steps.length > 0 && (
              <nav className="td-steps" aria-label={`Study path for ${topic.title}`}>
                {steps.map((s, i) => {
                  const now = s.id === currentStep;
                  return (
                    <Link
                      key={s.id}
                      to={`/topic/${topic.id}?tab=${s.id}`}
                      className={`td-step${now ? ' now' : ''}${s.complete ? ' done' : ''}`}
                      aria-current={now ? 'step' : undefined}
                      title={s.progress}
                    >
                      {now ? <i>{i + 1}</i> : s.complete ? <Check size={13} aria-hidden className="td-step-check" /> : null}
                      {s.label}
                      {s.complete && <span className="sr-only"> (done)</span>}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>
        </div>

        <div className="td-ringcol td-desktop-only">
          <HeroDiagram f={ringFigures} />
        </div>
      </section>

      {/* phone: the compact ring with the key figures (Mobile mockup) */}
      <section className="glass td-mini td-mobile-only" aria-label="Overall progress">
        <HeroDiagram f={ringFigures} compact />
        <dl className="td-kv">
          <div>
            <dt>Topics passed</dt>
            <dd className="num">
              {counts.passed}
              <small>/{counts.total}</small>
            </dd>
          </div>
          <div>
            <dt>Exams taken</dt>
            <dd className="num">{taken}</dd>
          </div>
          <div>
            <dt>Company track</dt>
            <dd className="mono td-kv-flag">{unlocked ? 'UNLOCKED' : 'LOCKED'}</dd>
          </div>
        </dl>
      </section>

      <section className="td-tiles" aria-label="Practice figures">
        {tiles.map((t) => (
          <div key={t.id} className={`glass td-tile td-tile-${t.id}`}>
            <div className="eyebrow">
              {'short' in t ? (
                <>
                  <span className="td-desktop-inline">{t.label}</span>
                  <span className="td-mobile-inline">{t.short}</span>
                </>
              ) : (
                t.label
              )}
            </div>
            <div className="num td-tile-n">
              <CountUp value={t.value} />
              <small>{t.of}</small>
            </div>
            <div className="track td-tile-track" aria-hidden>
              {t.bar}
            </div>
            <div className="td-tile-note">{t.note}</div>
          </div>
        ))}
      </section>

      {fresh && (
        <section className="glass card td-how td-reveal" aria-labelledby="how-title">
          <div className="td-card-head">
            <h2 id="how-title" className="td-h2">
              How this works
            </h2>
            <span className="muted td-head-note">Every topic follows the same path</span>
          </div>
          <ol className="td-how-steps">
            {HOW.map(([verb, rest], i) => (
              <li key={verb}>
                <span className="mono td-how-n">{phaseCode(i + 1)}</span>
                <strong>{verb}</strong>
                <p>{rest}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="td-desktop-only td-reveal">
        <SystemMap phases={phases} currentPhaseId={phase?.id} />
      </div>
      <div className="td-mobile-only">
        <PhaseList phases={phases} currentPhaseId={phase?.id} />
      </div>

      {onDesk.length > 0 && (
        <section className="glass card td-desk td-reveal" aria-labelledby="desk-title">
          <div className="td-card-head">
            <h2 id="desk-title" className="td-h2">
              On your desk
            </h2>
            <span className="muted td-head-note">Other topics in progress, closest to done first</span>
          </div>
          <ul className="td-desk-list">
            {onDesk.map(({ t, done }) => (
              <li key={t.id}>
                <Link to={`/topic/${t.id}`}>
                  <span className="mono td-desk-code">{topicCode(TOPICS, PHASES, t.id)}</span>
                  <span className="td-desk-title">{t.title}</span>
                </Link>
                <span className="track td-desk-bar" aria-hidden>
                  {done > 0 && <i className="f-prog" style={{ width: `${done}%` }} />}
                </span>
                <span className="mono td-desk-pct">
                  {done}%<span className="sr-only"> complete</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="td-reveal">
        <ProgressPanel
          counts={counts}
          phases={phases}
          currentPhaseId={phase?.id}
          passMark={passMark}
          volume={volume.filter((v) => v.id === 'learn' || v.id === 'code' || v.id === 'company')}
        />
      </div>

      <div className="td-three td-reveal">
        <CompanyTrackCard
          unlocked={unlocked}
          remaining={remaining.length}
          topics={TOPICS.length}
          questions={COMPANY_QUESTIONS.length}
          practised={Math.min(Object.keys(p.company).length, COMPANY_QUESTIONS.length)}
          companies={companyNames}
          mockMinutes={p.settings.mockMinutes}
          passMark={passMark}
        />
        <WeakSpotCard weak={weak} answered={answered} passMark={passMark} firstExamHref={firstExamHref} mistakes={mistakes} />
        <StreakCard days={p.activityDays ?? []} today={today} streak={streak} />
      </div>

      <div className="td-reveal">
        <AchievementsSummary p={p} />
      </div>

      <div className="td-reveal">
        <DashboardMetrics p={p} topics={TOPICS} readiness={readiness} firstExamHref={firstExamHref} />
      </div>
    </div>
  );
}
