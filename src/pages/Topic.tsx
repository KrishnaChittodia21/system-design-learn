import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { usePageMotion } from '../lib/usePageMotion';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PHASES, TOPICS, TOPIC_BY_ID } from '../content';
import type { CapstoneProject, CodeChallenge, Difficulty, EnvelopeQuestion, InterviewQuestion, Topic } from '../types';
import {
  rateIQ,
  setDraft,
  markAllSectionsRead,
  setFlag,
  toggleSectionRead,
  useProgress,
  type Rating,
} from '../lib/progress';
import { CodeBlock, CodeEditor, Diagram, FollowUps, Markdown, ProgressBar, Reveal } from '../components/ui';
import { practiceLocked, topicCompletion, topicStatus } from '../lib/stats';
import { topicSteps } from '../lib/nextStep';
import { StudyPath, type TabId } from '../components/StudyPath';
import { CoachTip } from '../components/CoachTip';
import { NextUp } from '../components/NextUp';
import { topicCode } from '../lib/labels';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CirclePlay,
  Clock,
  GraduationCap,
  Library,
  Lightbulb,
  ListChecks,
  Lock,
  Mic,
  Puzzle,
  Star,
  Target,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { PREREQS } from '../content/prereqs';
import { projectsForTopic } from '../content/projects';
import { CapstoneTab } from '../components/Capstone';
import { vizForSection } from '../viz/registry';
import { currentlyWrong, weakSections } from '../lib/weak';
import { hasChallenges, puzzleKey, useChallengeSet } from '../challenges/registry';
import { MODE_INFO } from '../challenges/ui/run';
import type { ChallengeSet } from '../challenges/types';

// the challenge engine and its puzzle data load only when the Challenge tab opens
const ChallengeTab = lazy(() => import('../challenges/ui/ChallengeTab'));

const STATUS = {
  new: { text: 'Not started', tone: '' },
  'in-progress': { text: 'In progress', tone: 'amber' },
  passed: { text: 'Exam passed', tone: 'cyan' },
} as const;

const DIFF_TONE: Record<Difficulty, string> = { medium: 'blue', hard: 'amber', expert: 'rose' };

const TAB_IDS: TabId[] = ['learn', 'code', 'interview', 'envelope', 'cheat', 'capstone', 'exam', 'challenge'];

/** First-time tips, one per tab type (Settings → "Show coach tips"). */
const TIPS: Record<TabId, { title: string; text: string }> = {
  learn: {
    title: 'How to use Learn:',
    text: 'read a section, then press "Mark read" (or tick "Read" at its top right). Sections with an interactive animation let you play with the idea. The rail and the tabs above fill in as you go.',
  },
  code: {
    title: 'How to use the lab:',
    text: 'edit the starter in place (it saves automatically), open hints one at a time, then compare with the reference solution and mark it done.',
  },
  interview: {
    title: 'How to practise:',
    text: 'answer out loud or type a draft before revealing anything, then rate yourself honestly. "Partially" and "Missed" ratings feed Weak Areas.',
  },
  envelope: {
    title: 'How to drill estimates:',
    text: 'write your own numbers first, then reveal the assumptions and each step to check your maths and the design insight.',
  },
  cheat: { title: 'Cheat sheet:', text: 'a last-minute revision list for the day before an interview, not a replacement for the lessons.' },
  capstone: {
    title: 'Capstones:',
    text: 'build the project in your editor, run its judge command, and the test results appear here automatically.',
  },
  challenge: {
    title: 'The challenge:',
    text: 'hands-on puzzles built from this topic. Drag (or tap, or use the keyboard) to fix flows, order steps, hunt faults, patch cables, tune knobs, route packets or survive traffic spikes. Fewer misses and hints earn more stars; your best is saved.',
  },
  exam: {
    title: 'About the exam:',
    text: 'timed and shuffled. Only full-length attempts at or above the pass mark count. Questions you miss show up in Weak Areas.',
  },
};

const scrollToSection = (i: number) => document.getElementById(`s-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export default function TopicPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const topic = TOPIC_BY_ID.get(id);
  const p = useProgress();
  const challengeSet = useChallengeSet(id);
  const tabParam = params.get('tab');
  // GSAP: the topic header staggers in once; each tab's cards reveal as they scroll into view
  const root = useRef<HTMLDivElement>(null);
  // breadcrumbs and tabs are navigation and the Learn sections are long-form reading, so neither animates in
  usePageMotion(root, { intro: ':scope > .tp-hero', deps: [id] });
  usePageMotion(root, { reveal: '.tp-stack > article, .tp-stack > section, :scope > .tp-panel', deps: [id, tabParam] });
  if (!topic) {
    return (
      <div className="page">
        <h1>Topic not found</h1>
        <Link to="/">← Back to dashboard</Link>
      </div>
    );
  }
  const withChallenge = hasChallenges(topic.id);
  const tab = (TAB_IDS.find((t) => t === params.get('tab') && (t !== 'challenge' || withChallenge)) ?? 'learn') as TabId;
  const phase = PHASES.find((ph) => ph.id === topic.phase);
  const idx = TOPICS.findIndex((t) => t.id === topic.id);
  const prev = TOPICS[idx - 1];
  const next = TOPICS[idx + 1];
  const capstones = projectsForTopic(topic.id);
  const steps = topicSteps(p, topic, capstones.length);
  const locks: Partial<Record<TabId, boolean>> = {
    interview: practiceLocked(p, topic, 'interview'),
    exam: practiceLocked(p, topic, 'exam'),
  };
  const pct = topicCompletion(p, topic);
  const status = STATUS[topicStatus(p, topic)];
  const read = new Set(p.sections[topic.id] ?? []);
  const readCount = topic.sections.filter((_, i) => read.has(i)).length;
  const readPct = Math.round((readCount / Math.max(1, topic.sections.length)) * 100);
  const code = topicCode(TOPICS, PHASES, topic.id);
  const phaseLabel = `Phase ${String(phase?.number ?? 0).padStart(2, '0')} · ${phase?.title ?? ''}`;
  const selectTab = (t: TabId) => setParams({ tab: t }, { replace: true });
  // "Next up" target after the current tab: the following study-path step, else the next topic
  const stepIds = steps.map((s) => s.id as TabId);
  const stepAfter: TabId | undefined =
    tab === 'challenge' ? undefined : tab === 'cheat' ? (stepIds.includes('exam') ? 'exam' : undefined) : stepIds[stepIds.indexOf(tab) + 1];
  // the end-of-topic challenge comes after the last study-path step
  const after: TabId | undefined = stepAfter ?? (withChallenge && tab !== 'challenge' && tab !== 'learn' ? 'challenge' : undefined);
  const afterLabel = after === 'challenge' ? 'Challenge' : steps.find((s) => s.id === after)?.label;
  const challengeSummary = withChallenge ? challengeProgress(p.challenges, topic.id, challengeSet) : null;
  const nextUp = after ? (
    <NextUp
      lead={
        <>
          <strong>{tab === 'learn' ? 'Finished reading?' : 'Done here?'}</strong> Next: {afterLabel}
          {after === 'exam' && <span className="muted small"> · pass mark {p.settings.passMark}%</span>}
        </>
      }
      label={`Go to ${afterLabel}`}
      onClick={() => {
        selectTab(after);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
    />
  ) : next ? (
    <NextUp
      lead={
        <>
          <strong>{topicStatus(p, topic) === 'passed' ? 'Topic done.' : 'Finished this topic?'}</strong> Next topic: {next.title}
        </>
      }
      label={`Next topic: ${next.title}`}
      to={`/topic/${next.id}`}
    />
  ) : (
    <NextUp lead={<strong>That was the last topic.</strong>} label="Company track" to="/companies" />
  );

  return (
    <div className="page tp" ref={root} data-motion="own">
      <nav className="tp-crumbs" aria-label="Breadcrumb">
        <Link to="/contents">Contents</Link>
        <span aria-hidden>/</span>
        <Link to={`/contents#phase-${topic.phase}`}>{phaseLabel}</Link>
        <span aria-hidden>/</span>
        <span className="tp-crumb-now" aria-current="page">
          Topic {code}
        </span>
      </nav>

      <header className="tp-hero glass holo" aria-labelledby="tp-title">
        <div className="tp-hero-glow" aria-hidden />
        <div className="tp-hero-row">
          <div className="tp-hero-text">
            <div className="tp-chips">
              <span className="nb-chip amber">{phaseLabel}</span>
              <span className="nb-chip">
                {topic.estimatedMinutes} min · {topic.sections.length} sections
                {topic.test.length > 0 && <> · {topic.test.length}-question exam</>}
              </span>
              <span className={`nb-chip ${status.tone}`}>{status.text}</span>
            </div>
            <h1 id="tp-title">
              <span className="gtext">{topic.title}</span>
            </h1>
            <p className="lede">{topic.subtitle}</p>
            {topic.tags.length > 0 && (
              <p className="tp-tags" aria-label="Tags">
                {topic.tags.slice(0, 8).map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </p>
            )}
            {topic.sources.length > 0 && (
              <p className="tp-sources">
                <BookOpen size={13} aria-hidden /> {topic.sources.join(' · ')}
              </p>
            )}
          </div>
          <div className="tp-ring-wrap">
            <div
              className="tp-ring"
              role="img"
              aria-label={`Topic progress: ${readCount} of ${topic.sections.length} sections read, ${pct}% of the topic complete`}
              style={{ ['--p' as string]: `${readPct}%` }}
            >
              <div className="nb-ring tp-ring-bg" />
              <div className="nb-ring tp-ring-fill" />
              <div className="orbit slow tp-ring-orbit" aria-hidden>
                <span className="orbit-dot" />
              </div>
              <div className="tp-ring-text">
                <div className="num">
                  {readCount}/{topic.sections.length}
                </div>
                <div className="eyebrow">sections read</div>
              </div>
            </div>
            <div className="tp-ring-sub mono">
              <span className="tp-ring-pct">{pct}%</span> of topic complete
            </div>
          </div>
        </div>
        {topic.phase === 'miscellaneous' && (
          <div className="tp-misc info">
            This is a <strong>question bank</strong> with short refreshers. Every concept below has a <strong>Learn this first</strong>{' '}
            link to its full lesson; study that if the refresher isn&apos;t enough.
          </div>
        )}
      </header>

      <StudyPath
        steps={steps}
        active={tab}
        locks={locks}
        onSelect={selectTab}
        counts={{ exam: topic.test.length, capstone: capstones.length }}
        challenge={challengeSummary}
      />

      <CoachTip id={`tab-${tab}`} title={TIPS[tab].title}>
        {TIPS[tab].text}
      </CoachTip>

      {tab === 'learn' && (
        <LearnTab
          topic={topic}
          capstones={capstones}
          challenge={withChallenge ? { set: challengeSet, solved: challengeSummary?.solved ?? 0 } : null}
          onChallenge={() => {
            selectTab('challenge');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
      {tab === 'code' && (
        <div className="tp-stack">
          {topic.codeChallenges.map((c, i) => (
            <ChallengeCard key={c.id} c={c} n={i + 1} of={topic.codeChallenges.length} />
          ))}
        </div>
      )}
      {tab === 'interview' && (locks.interview ? <StudyLock topic={topic} what="interview questions" /> : <InterviewTab topic={topic} />)}
      {tab === 'envelope' && <EnvelopeTab topic={topic} />}
      {tab === 'cheat' && <CheatSheet topic={topic} />}
      {tab === 'capstone' && <CapstoneTab projects={capstones} />}
      {tab === 'exam' && (locks.exam ? <StudyLock topic={topic} what="exam" /> : <ExamIntro topic={topic} />)}
      {tab === 'challenge' && (
        <Suspense fallback={<div className="tp-panel tp-card muted">Loading the challenge…</div>}>
          <ChallengeTab key={topic.id} topicId={topic.id} topicTitle={topic.title} />
        </Suspense>
      )}
      {!(tab === 'interview' && locks.interview) && !(tab === 'exam' && locks.exam) && nextUp}

      <nav className="tp-pager" aria-label="Previous and next topic">
        {prev ? (
          <Link className="tp-pg glass-flat" to={`/topic/${prev.id}`}>
            <span className="eyebrow">
              <ArrowLeft size={13} aria-hidden /> Previous topic
            </span>
            <span className="tp-pg-t">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        <Link className="tp-pg tp-pg-next glass-flat" to={next ? `/topic/${next.id}` : '/companies'}>
          <span className="eyebrow">
            {next ? 'Next topic' : 'Up next'} <ArrowRight size={13} aria-hidden />
          </span>
          <span className="tp-pg-t">{next ? next.title : 'Company track'}</span>
        </Link>
      </nav>
    </div>
  );
}

/** Lessons that open with "**Intuition:** …" get that paragraph lifted into a callout. */
function splitIntuition(body: string): { intuition?: string; rest: string } {
  const m = /^\s*\*\*Intuition:?\*\*:?\s*([\s\S]*?)(?:\n\s*\n([\s\S]*))?$/.exec(body);
  if (!m) return { rest: body };
  return { intuition: m[1].trim(), rest: (m[2] ?? '').trim() };
}

/** solved / total puzzles of a topic's challenge (total 0 until the puzzle data has loaded) */
function challengeProgress(records: Record<string, unknown> | undefined, topicId: string, set: ChallengeSet | null) {
  const puzzles = set?.topic === topicId ? set.puzzles : [];
  return { solved: puzzles.filter((x) => records?.[puzzleKey(topicId, x.id)]).length, total: puzzles.length };
}

/** "Ready for the challenge?" card at the end of the Learn tab */
function ChallengeCta({ set, solved, onStart }: { set: ChallengeSet | null; solved: number; onStart: () => void }) {
  const p = useProgress();
  const puzzles = set?.puzzles ?? [];
  const stars = puzzles.reduce((n, x) => n + (p.challenges?.[puzzleKey(set!.topic, x.id)]?.stars ?? 0), 0);
  const modes = [...new Set(puzzles.map((x) => MODE_INFO[x.mode].name))];
  const all = puzzles.length > 0 && solved >= puzzles.length;
  return (
    <section className="tp-panel tp-chal-cta glass-flat" aria-labelledby="chal-cta-h">
      <span className="tp-chal-ic" aria-hidden>
        <Puzzle size={22} />
      </span>
      <div className="tp-chal-text">
        <div className="eyebrow tp-eb-amber">End-of-topic challenge</div>
        <h2 id="chal-cta-h">{all ? 'Challenge complete' : solved ? 'Back to the challenge?' : 'Ready for the challenge?'}</h2>
        <p>
          {puzzles.length > 0 ? (
            <>
              {puzzles.length} hands-on puzzle{puzzles.length === 1 ? '' : 's'}: {modes.join(' · ')}.{' '}
            </>
          ) : null}
          Put what you just read to work and earn up to three stars per puzzle.
        </p>
        {puzzles.length > 0 && (
          <p className="tp-chal-stars mono">
            <Star size={13} aria-hidden /> {stars}/{puzzles.length * 3} stars · {solved}/{puzzles.length} solved
          </p>
        )}
      </div>
      <button className={`btn ${all ? '' : 'btn-primary'}`} type="button" onClick={onStart}>
        {all ? 'Play again' : solved ? 'Continue the challenge' : 'Start the challenge'} <ArrowRight size={16} aria-hidden />
      </button>
    </section>
  );
}

function LearnTab({
  topic,
  capstones,
  challenge,
  onChallenge,
}: {
  topic: Topic;
  capstones: CapstoneProject[];
  challenge: { set: ChallengeSet | null; solved: number } | null;
  onChallenge: () => void;
}) {
  const p = useProgress();
  const read = new Set(p.sections[topic.id] ?? []);
  const readCount = topic.sections.filter((_, i) => read.has(i)).length;
  const [params] = useSearchParams();
  const target = params.get('s');
  const [now, setNow] = useState(() => (target !== null ? Number(target) || 0 : 0));
  const [railOpen, setRailOpen] = useState(false);
  const n = topic.sections.length;
  const minutes = Math.max(1, Math.round(topic.estimatedMinutes / Math.max(1, n)));

  // deep link from weak-area reports: /topic/:id?tab=learn&s=<section index>
  useEffect(() => {
    if (target === null) return;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`s-${target}`);
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1800);
    });
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // scroll-spy: the section crossing the upper third of the viewport is "now" in the rail
  useEffect(() => {
    const els = topic.sections.map((_, i) => document.getElementById(`s-${i}`)).filter((x): x is HTMLElement => !!x);
    if (!els.length || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setNow(Number(hit.target.id.slice(2)));
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [topic]);

  return (
    <div className="tp-learn">
      <aside className={`tp-rail glass-flat ${railOpen ? 'open' : ''}`} aria-label="Sections">
        <button type="button" className="tp-rail-toggle" aria-expanded={railOpen} onClick={() => setRailOpen((o) => !o)}>
          <span className="eyebrow">
            Sections · {readCount} of {n} read
          </span>
          <ChevronDown size={16} aria-hidden className="tp-rail-chev" />
        </button>
        <div className="eyebrow tp-rail-title">
          Sections · {readCount} of {n} read
        </div>
        <div className="track tp-rail-track" aria-hidden>
          <i className="f-pass" style={{ width: `${(readCount / Math.max(1, n)) * 100}%` }} />
        </div>
        <ol className="tp-rail-list">
          {topic.sections.map((s, i) => (
            <li key={s.heading} className={`${read.has(i) ? 'done' : ''} ${now === i ? 'now' : ''}`}>
              <button
                type="button"
                aria-current={now === i ? 'location' : undefined}
                onClick={() => {
                  scrollToSection(i);
                  setRailOpen(false);
                }}
              >
                <span className="b" aria-hidden />
                <span className="tp-rail-h">{s.heading}</span>
                {read.has(i) && <span className="sr-only"> (read)</span>}
              </button>
            </li>
          ))}
        </ol>
        {readCount < n && (
          <button type="button" className="btn-ghost btn-xs tp-rail-all" onClick={() => markAllSectionsRead(topic.id, n)}>
            <ListChecks size={14} aria-hidden /> Mark all as read
          </button>
        )}
        {capstones.length > 0 && (
          <div className="tp-rail-caps">
            <div className="eyebrow">Capstones for this topic</div>
            {capstones.map((c) => (
              <Link key={c.id} to={`/topic/${topic.id}?tab=capstone`} className="tp-rail-cap">
                <span className="tp-rail-cap-t">{c.title}</span>
                <span className="mono">
                  {c.difficulty} · {c.estimatedHours} h
                </span>
              </Link>
            ))}
          </div>
        )}
      </aside>

      <div className="tp-sections">
        {topic.sections.map((s, i) => {
          const isRead = read.has(i);
          const { intuition, rest } = splitIntuition(s.body);
          return (
            <article key={s.heading} id={`s-${i}`} className={`tp-sec glass-flat ${isRead ? 'is-read' : ''}`} aria-labelledby={`h-${i}`}>
              <div className="tp-sec-top">
                <div className={`eyebrow ${now === i ? 'tp-eb-amber' : ''}`}>
                  Section {i + 1} of {n} · {minutes} min
                </div>
                <label className="tp-read">
                  <input type="checkbox" checked={isRead} onChange={() => toggleSectionRead(topic.id, i)} />
                  <span className="tp-read-box" aria-hidden>
                    <Check size={12} strokeWidth={3.2} />
                  </span>
                  Read
                </label>
              </div>
              <h2 id={`h-${i}`}>{s.heading}</h2>
              {s.source && (
                <div className="tp-source">
                  <BookOpen size={13} aria-hidden /> {s.source}
                </div>
              )}
              <PrereqLinks topicId={topic.id} heading={s.heading} />
              {intuition && (
                <div className="tp-intuition">
                  <Lightbulb size={20} aria-hidden className="tp-intuition-ic" />
                  <div>
                    <strong>Intuition:</strong> <Markdown>{intuition}</Markdown>
                  </div>
                </div>
              )}
              {rest && <Markdown>{rest}</Markdown>}
              {s.diagram && (
                <figure className="tp-fig">
                  <Diagram text={s.diagram} />
                </figure>
              )}
              <SectionViz topic={topic} sectionIndex={i} />
              {s.code?.map((c, j) => <CodeBlock key={j} snippet={c} />)}
              {s.keyPoints && s.keyPoints.length > 0 && (
                <div className="tp-kp" aria-label="Key points" role="list">
                  {s.keyPoints.map((k, j) => (
                    <div key={k} role="listitem">
                      <b>Key point {j + 1}</b>
                      {k}
                    </div>
                  ))}
                </div>
              )}
              <div className="tp-sec-foot">
                <button
                  type="button"
                  className={`btn btn-sm ${isRead ? '' : 'btn-primary'}`}
                  aria-pressed={isRead}
                  onClick={() => toggleSectionRead(topic.id, i)}
                >
                  {isRead ? (
                    <>
                      <Check size={15} aria-hidden /> §{i + 1} read
                    </>
                  ) : (
                    <>Mark §{i + 1} read</>
                  )}
                </button>
                {i < n - 1 && (
                  <button type="button" className="btn-ghost btn-sm tp-sec-next" onClick={() => scrollToSection(i + 1)}>
                    <span className="tp-sec-next-t">
                      Next: §{i + 2} {topic.sections[i + 1].heading}
                    </span>
                    <ArrowRight size={15} aria-hidden />
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {readCount < n && (
          <div className="tp-panel tp-cta glass-flat">
            <div>
              <strong>
                {readCount}/{n} sections ticked as read.
              </strong>{' '}
              Tick each one when you finish it, or mark them all if you already know this topic.
            </div>
            <button className="btn" type="button" onClick={() => markAllSectionsRead(topic.id, n)}>
              Mark all as read
            </button>
          </div>
        )}
        {challenge && <ChallengeCta set={challenge.set} solved={challenge.solved} onStart={onChallenge} />}
      </div>
    </div>
  );
}

function ChallengeCard({ c, n, of }: { c: CodeChallenge; n: number; of: number }) {
  const p = useProgress();
  const draftKey = `cc:${c.id}`;
  const code = p.drafts[draftKey] ?? c.starter.code;
  const [hints, setHints] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const done = !!p.cc[c.id];
  return (
    <article className={`tp-card ${done ? 'is-done' : ''}`} aria-labelledby={`cc-${c.id}`}>
      <div className="tp-card-top">
        <span className="eyebrow tp-eb-cyan">
          Challenge {n} of {of}
        </span>
        {done && (
          <span className="nb-chip cyan">
            <Check size={12} strokeWidth={3} aria-hidden /> Completed
          </span>
        )}
      </div>
      <h2 id={`cc-${c.id}`} className="tp-card-title">
        {c.title}
      </h2>
      <Markdown>{c.context}</Markdown>
      <div className="tp-task">
        <Target size={18} aria-hidden className="tp-task-ic" />
        <div>
          <strong>Your task:</strong> <Markdown>{c.task}</Markdown>
        </div>
      </div>
      <div className="tp-editor-head">
        <span className="small muted">
          {c.starter.language === 'text' ? 'Rewrite the answer below.' : 'Edit the code below.'} Your changes are saved automatically.{' '}
          {c.starter.title && <span className="mono">({c.starter.title})</span>}
        </span>
        <button className="btn-ghost btn-xs" type="button" onClick={() => setDraft(draftKey, c.starter.code)}>
          Reset to starter
        </button>
      </div>
      <CodeEditor value={code} onChange={(v) => setDraft(draftKey, v)} language={c.starter.language} />
      {hints > 0 && (
        <div className="tp-hints">
          {c.hints.slice(0, hints).map((h, i) => (
            <div key={i} className="tp-hint">
              <Lightbulb size={15} aria-hidden className="inline-icon" /> <strong>Hint {i + 1}:</strong> {h}
            </div>
          ))}
        </div>
      )}
      <div className="tp-actions">
        {hints < c.hints.length && (
          <button className="btn btn-sm" type="button" onClick={() => setHints((h) => h + 1)}>
            <Lightbulb size={15} aria-hidden /> Show hint {hints + 1}/{c.hints.length}
          </button>
        )}
        <button className="btn btn-sm" type="button" aria-expanded={showSolution} onClick={() => setShowSolution((s) => !s)}>
          {showSolution ? 'Hide solution' : 'Compare with reference solution'}
        </button>
        <button className={`btn btn-sm ${done ? '' : 'btn-primary'}`} type="button" onClick={() => setFlag('cc', c.id, !done)}>
          {done ? 'Mark not done' : 'Mark as done'}
        </button>
      </div>
      {showSolution && (
        <div className="tp-solution">
          <div className="tp-label">Reference solution</div>
          <CodeBlock snippet={c.solution} />
          <Markdown>{c.explanation}</Markdown>
          <FollowUps items={c.followUps} />
        </div>
      )}
    </article>
  );
}

function InterviewTab({ topic }: { topic: Topic }) {
  const p = useProgress();
  const rated = topic.interviewQuestions.filter((q) => p.iq[q.id]).length;
  const firstOpen = topic.interviewQuestions.findIndex((q) => !p.iq[q.id]);
  return (
    <div className="tp-stack">
      <div className="tp-intro info">
        <Mic size={18} aria-hidden className="tp-intro-ic" />
        <div>
          <strong>How to practise:</strong> answer out loud or type your answer <em>before</em> revealing anything, as you would in a
          real interview. Then compare with what the interviewer is looking for and the model answer, work through the follow-ups
          and rate yourself honestly.{' '}
          <span className="mono small tp-intro-count">
            {rated}/{topic.interviewQuestions.length} rated
          </span>
        </div>
      </div>
      {topic.interviewQuestions.map((q, i) => (
        <InterviewCard key={q.id} q={q} n={i + 1} of={topic.interviewQuestions.length} focus={i === firstOpen} />
      ))}
    </div>
  );
}

const RATINGS: { r: Rating; label: string }[] = [
  { r: 'nailed', label: 'Nailed it' },
  { r: 'partial', label: 'Partially' },
  { r: 'missed', label: 'Missed it' },
];

function InterviewCard({ q, n, of, focus }: { q: InterviewQuestion; n: number; of: number; focus: boolean }) {
  const p = useProgress();
  const draftKey = `iq:${q.id}`;
  const [answer, setAnswer] = useState(false);
  const [fu, setFu] = useState(0);
  const rating = p.iq[q.id];
  const rate = (r: Rating) => rateIQ(q.id, rating === r ? null : r);
  const body = (
    <>
      <div className="tp-card-top">
        <span className="eyebrow tp-eb-mag">
          Interview question {n} of {of}
        </span>
        <span className="tp-chips">
          <span className={`nb-chip ${DIFF_TONE[q.difficulty]}`}>{q.difficulty}</span>
          {rating && <span className={`nb-chip ${rating === 'nailed' ? 'cyan' : rating === 'partial' ? 'amber' : 'rose'}`}>{RATINGS.find((x) => x.r === rating)?.label}</span>}
        </span>
      </div>
      <h3 className="tp-iq-q">{q.question}</h3>
      {q.context && <p className="tp-iq-ctx mono">Context: {q.context}</p>}
      <label className="tp-label" htmlFor={`d-${q.id}`}>
        Your draft
      </label>
      <textarea
        id={`d-${q.id}`}
        className="answer-box"
        placeholder="Draft your answer: clarify requirements, estimate, design, trade-offs…"
        value={p.drafts[draftKey] ?? ''}
        onChange={(e) => setDraft(draftKey, e.target.value)}
        rows={5}
      />
      <Reveal label="What the interviewer is looking for">
        <ul className="tp-look">
          {q.whatInterviewerLooksFor.map((s) => (
            <li key={s}>
              <Check size={16} strokeWidth={2.6} aria-hidden />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </Reveal>
      {!answer ? (
        <div className="tp-actions">
          <button className="btn btn-sm" type="button" onClick={() => setAnswer(true)}>
            Reveal model answer
          </button>
        </div>
      ) : (
        <div className="tp-model">
          <div className="tp-label">Model answer</div>
          <Markdown>{q.modelAnswer}</Markdown>
        </div>
      )}
      {answer && (
        <div className="followups">
          <div className="label">
            <Mic size={13} aria-hidden /> Interviewer follow-ups
          </div>
          {q.followUps.slice(0, fu).map((f, i) => (
            <div key={i} className="followup">
              <div className="fq">↳ {f.q}</div>
              <Reveal label="Show answer">
                <Markdown>{f.a}</Markdown>
              </Reveal>
            </div>
          ))}
          {fu < q.followUps.length && (
            <button className="btn-ghost btn-sm" type="button" onClick={() => setFu((x) => x + 1)}>
              + Next follow-up ({fu}/{q.followUps.length})
            </button>
          )}
          <Reveal label="Pitfalls: what weak candidates say">
            <ul className="tp-pitfalls">
              {q.pitfalls.map((s) => (
                <li key={s}>
                  <TriangleAlert size={15} aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      )}
      <div className="tp-rate" role="group" aria-label="How did you do?">
        <span className="tp-label">How did you do?</span>
        {RATINGS.map(({ r, label }) => (
          <button key={r} type="button" className={`tp-rate-btn ${r}`} aria-pressed={rating === r} onClick={() => rate(r)}>
            {label}
          </button>
        ))}
      </div>
    </>
  );
  // the next question to practise wears the animated gradient border
  return focus ? (
    <article className="gborder tp-iq-focus" aria-label={`Interview question ${n}`}>
      <div className="in tp-iq">{body}</div>
    </article>
  ) : (
    <article className="tp-card tp-iq" aria-label={`Interview question ${n}`}>
      {body}
    </article>
  );
}

function EnvelopeTab({ topic }: { topic: Topic }) {
  const p = useProgress();
  const qs = topic.envelopeQuestions;
  const [cur, setCur] = useState(() => Math.max(0, qs.findIndex((q) => !p.boe[q.id])));
  if (!qs.length) return null;
  return (
    <div className="tp-stack boe-tab">
      {qs.length > 1 && (
        <nav className="boe-drills" aria-label="Drills in this topic">
          {qs.map((q, i) => (
            <button
              key={q.id}
              type="button"
              className={`boe-drill ${p.boe[q.id] ? 'done' : ''}`}
              aria-current={i === cur ? 'step' : undefined}
              onClick={() => setCur(i)}
            >
              <b>
                Drill {i + 1}
                {i === cur && ' · now'}
                {p.boe[q.id] && ' · done'}
              </b>
              <span className="boe-drill-q">{q.question}</span>
            </button>
          ))}
        </nav>
      )}
      {qs.map((q, i) => (
        <div key={q.id} hidden={i !== cur}>
          <EnvelopeCard q={q} n={i + 1} of={qs.length} />
        </div>
      ))}
    </div>
  );
}

/** The figure a calculation lands on ("≈ 31.5K entries" → 31.5K / entries), for the big number beside each step. */
function stepResult(calc: string): { big: string; cap?: string } | null {
  const parts = calc.split(/\s(?:=|≈|→|⇒)\s/);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].trim();
  const m = /^([~<>≤≥]?\s?\$?\d[\d.,]*(?:\s?[–-]\s?\d[\d.,]*)?(?:\s?(?:%|×(?!\s?\d)|[KMGTP]B(?:\/s)?|[KMGT]bps|bps|ms|µs|min\b|h\b|s\b|[KMBT]\b))?)(.*)$/.exec(last);
  if (!m) return null;
  // "6 × 16 GB" or "2 × 10^12 rows" is an expression, not a result: show no big number
  if (/^\s*[×x*÷+−/]\s?\d/.test(m[2])) return null;
  const big = m[1].trim();
  if (big.length > 11) return null;
  const cap = m[2].replace(/\s*\(.*$/, '').replace(/^[\s,;:]+|[\s,;:]+$/g, '').trim();
  return { big, cap: cap && cap.length <= 26 && !/[=≈→]/.test(cap) ? cap : undefined };
}

const WARN = /overload|exceed|without bound|unbounded|outage|unrealistic|over capacity|budget|> ?capacity|exhaust/i;

function EnvelopeCard({ q, n, of }: { q: EnvelopeQuestion; n: number; of: number }) {
  const p = useProgress();
  const draftKey = `boe:${q.id}`;
  // stage 0: question only · 1: assumptions · 2..k+1: steps · k+2: answer
  const [stage, setStage] = useState(0);
  const total = q.steps.length + 2;
  const done = !!p.boe[q.id];
  const shownSteps = Math.max(0, Math.min(q.steps.length, stage - 1));
  return (
    <>
      <div className="boe-grid">
        <div className="boe-main">
          <section className="tp-card boe-q holo" aria-labelledby={`bq-${q.id}`}>
            <div className="tp-chips">
              <span className="nb-chip cyan">Back-of-the-envelope</span>
              <span className="nb-chip">
                Drill {n} of {of}
              </span>
              {done && (
                <span className="nb-chip green">
                  <Check size={12} strokeWidth={3} aria-hidden /> Done
                </span>
              )}
            </div>
            <h2 id={`bq-${q.id}`} className="boe-question">
              {q.question}
            </h2>
            <div className="eyebrow">Assumptions</div>
            {stage >= 1 ? (
              <ul className="boe-assume">
                {q.assumptions.map((a, i) => (
                  <li key={a}>
                    <span>A{i + 1}</span>
                    {a}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="boe-hidden">
                <Lock size={14} aria-hidden /> {q.assumptions.length} assumptions hidden. Write down your own first.
              </p>
            )}
          </section>

          <section className="tp-card boe-calc" aria-labelledby={`bc-${q.id}`}>
            <div className="boe-calc-head">
              <h3 id={`bc-${q.id}`}>The calculation</h3>
              <span className="mono small muted">
                {shownSteps} of {q.steps.length} steps revealed
              </span>
            </div>
            <ol className="boe-steps">
              {q.steps.map((s, i) => {
                if (i >= shownSteps) {
                  return (
                    <li key={i} className="boe-st locked" aria-label={`Step ${i + 1} hidden`}>
                      <span className="k">{i + 1}</span>
                      <div className="boe-ghost" aria-hidden>
                        <i />
                        <i />
                      </div>
                    </li>
                  );
                }
                const r = stepResult(s.calc);
                return (
                  <li key={i} className={`boe-st ${WARN.test(s.calc) ? 'warn' : ''} ${i === shownSteps - 1 ? 'fresh' : ''}`}>
                    <span className="k">{i + 1}</span>
                    <div className="boe-st-body">
                      <div className="l">{s.label}</div>
                      <code className="c">{s.calc}</code>
                    </div>
                    {r && (
                      <div className="r">
                        <span className="num">{r.big}</span>
                        {r.cap && <small>{r.cap}</small>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {stage >= total && (
              <div className="boe-answer">
                <div className="eyebrow tp-eb-cyan">Answer</div>
                <Markdown>{q.answer}</Markdown>
              </div>
            )}
          </section>
        </div>

        <aside className="boe-side">
          <section className="tp-card boe-you" aria-labelledby={`by-${q.id}`}>
            <h3 id={`by-${q.id}`}>Your estimate</h3>
            <label className="tp-label" htmlFor={`e-${q.id}`}>
              Assumptions and arithmetic
            </label>
            <textarea
              id={`e-${q.id}`}
              className="answer-box mono"
              placeholder="Your estimate: write down assumptions and arithmetic…"
              value={p.drafts[draftKey] ?? ''}
              onChange={(e) => setDraft(draftKey, e.target.value)}
              rows={5}
            />
            <div className="boe-progress" aria-hidden>
              <div className="track">
                <i className="f-pass" style={{ width: `${(Math.min(stage, total) / total) * 100}%` }} />
              </div>
            </div>
            <div className="tp-actions">
              {stage < total && (
                <button className="btn btn-sm btn-primary" type="button" onClick={() => setStage((s) => s + 1)}>
                  {stage === 0 ? 'Reveal assumptions' : stage < total - 1 ? `Reveal step ${stage}/${q.steps.length}` : 'Reveal answer'}
                </button>
              )}
              {stage < total && (
                <button className="btn-ghost btn-sm" type="button" onClick={() => setStage(total)}>
                  Show everything
                </button>
              )}
            </div>
            <div className="tp-label boe-done-l">When you have checked your numbers</div>
            <button className={`btn btn-sm ${done ? '' : 'btn-primary'}`} type="button" aria-pressed={done} onClick={() => setFlag('boe', q.id, !done)}>
              {done ? (
                <>
                  <Check size={15} aria-hidden /> Done · mark not done
                </>
              ) : (
                'Mark as done'
              )}
            </button>
          </section>
        </aside>
      </div>
      {stage >= total && (
        <aside className="boe-insight" aria-label="Design insight">
          <Zap size={22} aria-hidden className="boe-insight-ic" />
          <div>
            <div className="eyebrow tp-eb-amber">Design insight</div>
            <p>{q.insight}</p>
            <FollowUps items={q.followUps} />
          </div>
        </aside>
      )}
    </>
  );
}

function CheatSheet({ topic }: { topic: Topic }) {
  return (
    <section className="tp-panel tp-card tp-cheat" aria-labelledby="cheat-h">
      <div className="tp-card-top">
        <span className="eyebrow tp-eb-cyan">Cheat sheet · {topic.cheatSheet.length} items</span>
      </div>
      <h2 id="cheat-h" className="tp-card-title">
        Last-minute revision
      </h2>
      <ol className="tp-cheat-list">
        {topic.cheatSheet.map((c) => (
          <li key={c}>
            <Markdown>{c}</Markdown>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ExamIntro({ topic }: { topic: Topic }) {
  const p = useProgress();
  const nav = useNavigate();
  const rec = p.tests[topic.id];
  const minutes = Math.ceil((topic.test.length * p.settings.secondsPerQuestion) / 60);
  const multi = topic.test.filter((q) => q.correct.length > 1).length;
  const wrong = currentlyWrong(p, topic);
  const weak = weakSections(topic, wrong);
  return (
    <section className="tp-panel tp-card tp-exam holo" aria-labelledby="exam-h">
      <div className="tp-card-top">
        <span className="eyebrow tp-eb-cyan">
          <GraduationCap size={14} aria-hidden /> Timed exam
        </span>
        {rec?.passedAt && <span className="nb-chip cyan">Passed</span>}
      </div>
      <h2 id="exam-h" className="tp-card-title">
        {topic.title}
      </h2>
      <div className="tp-exam-stats">
        <div>
          <span className="num">{topic.test.length}</span>
          <span className="eyebrow">questions</span>
        </div>
        <div>
          <span className="num">{minutes}</span>
          <span className="eyebrow">minutes</span>
        </div>
        <div>
          <span className="num">{p.settings.passMark}%</span>
          <span className="eyebrow">pass mark</span>
        </div>
        {rec && (
          <div>
            <span className="num gtext">{rec.best}%</span>
            <span className="eyebrow">best of {rec.attempts}</span>
          </div>
        )}
      </div>
      <ul className="tp-look tp-exam-rules">
        <li>
          <Check size={16} strokeWidth={2.6} aria-hidden />
          <span>
            <strong>{topic.test.length}</strong> scenario-based questions ({multi} are &quot;select all that apply&quot;, which need an exact
            match to score)
          </span>
        </li>
        <li>
          <Clock size={16} aria-hidden />
          <span>
            Default time: <strong>{minutes} min</strong> ({p.settings.secondsPerQuestion}s/question). You can change it on the next
            screen.
          </span>
        </li>
        <li>
          <Target size={16} aria-hidden />
          <span>
            Pass mark: <strong>{p.settings.passMark}%</strong>. Only full-length attempts count towards unlocking the company track.
          </span>
        </li>
        <li>
          <Check size={16} strokeWidth={2.6} aria-hidden />
          <span>The exam auto-submits when time runs out. Each explanation says why the tempting wrong options are wrong.</span>
        </li>
        <li>
          <Mic size={16} aria-hidden />
          <span>
            <strong>Interview mode</strong> (on by default): lock in each answer to see instant feedback and the interviewer&apos;s
            follow-up questions, just like a real round.
          </span>
        </li>
      </ul>
      {rec && (
        <p className="tp-exam-rec mono small">
          Attempts: {rec.attempts} · Best: <strong>{rec.best}%</strong> · Last: {rec.last}%
        </p>
      )}
      <div className="tp-actions">
        <button className="btn btn-primary" type="button" onClick={() => nav(`/topic/${topic.id}/exam`)}>
          Set up exam <ArrowRight size={16} aria-hidden />
        </button>
        {wrong.length > 0 && (
          <button className="btn" type="button" onClick={() => nav(`/practice?topic=${topic.id}`)}>
            Practise my {wrong.length} mistakes
          </button>
        )}
      </div>
      {weak.length > 0 && (
        <div className="weak-card inline tp-weak">
          <div className="tp-label">Your weak sections in this topic</div>
          <ul className="weak-sections">
            {weak.map((ws) => (
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
      )}
    </section>
  );
}

/** "Learn this first" links from a Miscellaneous concept to the in-depth lesson that teaches it. */
function PrereqLinks({ topicId, heading }: { topicId: string; heading: string }) {
  const links = PREREQS[topicId]?.[heading];
  if (!links?.length) return null;
  return (
    <div className="prereq">
      <span className="prereq-label">
        <Library size={14} aria-hidden className="inline-icon" /> Learn this first:
      </span>
      {links.map((l) => {
        const t = TOPIC_BY_ID.get(l.topic);
        const sec = t?.sections[l.section];
        if (!t || !sec) return null;
        return (
          <Link key={`${l.topic}-${l.section}`} to={`/topic/${l.topic}?tab=learn&s=${l.section}`} className="prereq-link">
            {t.title} → {sec.heading}
          </Link>
        );
      })}
    </div>
  );
}

/** Shown instead of practice tabs until every Learn section is marked read (Settings → study-first lock). */
export function StudyLock({ topic, what }: { topic: Topic; what: string }) {
  const p = useProgress();
  const nav = useNavigate();
  const read = new Set(p.sections[topic.id] ?? []);
  const unread = topic.sections.map((s, i) => ({ s, i })).filter((x) => !read.has(x.i));
  const goRead = (i: number) => nav(`/topic/${topic.id}?tab=learn&s=${i}`);
  const readCount = topic.sections.length - unread.length;
  return (
    <section className="tp-panel tp-card study-lock" aria-labelledby="lock-h">
      <div className="study-lock-head">
        <span className="study-lock-ic" aria-hidden>
          <Lock size={22} />
        </span>
        <div>
          <span className="eyebrow tp-eb-amber">Locked until you&apos;ve studied</span>
          <h2 id="lock-h" className="tp-card-title">
            Study first
          </h2>
        </div>
      </div>
      <p>
        The {what} for this topic unlock once you&apos;ve read every Learn section, so the questions always come after the explanation.
      </p>
      <div className="study-lock-progress">
        <ProgressBar value={(readCount / Math.max(1, topic.sections.length)) * 100} />
        <span className="mono small muted">
          {readCount}/{topic.sections.length} sections read
        </span>
      </div>
      <div className="tp-label">Still to read</div>
      <ol className="study-lock-list">
        {unread.map(({ s, i }) => (
          <li key={i}>
            <button type="button" onClick={() => goRead(i)}>
              <span className="mono">§{i + 1}</span> {s.heading}
            </button>
          </li>
        ))}
      </ol>
      <div className="tp-actions">
        {unread.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => goRead(unread[0].i)}>
            Continue reading <ArrowRight size={16} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => {
            if (window.confirm('Mark every section of this topic as read and unlock its practice?')) {
              markAllSectionsRead(topic.id, topic.sections.length);
            }
          }}
        >
          I&apos;ve already studied this: mark all as read
        </button>
      </div>
      <p className="muted small">
        Tick &quot;Read&quot; on each section as you finish it. You can change or turn off this lock in <Link to="/settings">Settings</Link>.
      </p>
    </section>
  );
}

/**
 * Interactive visualisations placed on this section (lazy-loaded). A visualisation placed on
 * several sections of the same topic renders once, at its first placement; later sections link back.
 */
function SectionViz({ topic, sectionIndex }: { topic: Topic; sectionIndex: number }) {
  const vizzes = vizForSection(topic.id, topic.sections[sectionIndex].heading);
  if (!vizzes.length) return null;
  const firstIndex = (id: string) =>
    topic.sections.findIndex((s) => vizForSection(topic.id, s.heading).some((v) => v.meta.id === id));
  return (
    <>
      {vizzes.map(({ meta, Component }) => {
        const first = firstIndex(meta.id);
        if (first !== sectionIndex) {
          return (
            <button key={meta.id} type="button" className="viz-backlink" onClick={() => scrollToSection(first)}>
              <CirclePlay size={15} aria-hidden className="inline-icon" /> Interactive: {meta.title} (in §{first + 1} above), revisit it
              with this section in mind
            </button>
          );
        }
        return (
          <Suspense
            key={meta.id}
            fallback={
              <div className="viz-loading">
                <CirclePlay size={14} aria-hidden /> Loading interactive: {meta.title}…
              </div>
            }
          >
            <Component />
          </Suspense>
        );
      })}
    </>
  );
}
