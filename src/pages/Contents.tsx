// Contents: every phase, topic, section, practice tab and tool in the course on one searchable page.
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Building,
  Calculator,
  Check,
  ChevronDown,
  CirclePlay,
  CodeXml,
  Dumbbell,
  FileText,
  GraduationCap,
  Hammer,
  ListTree,
  Lock,
  LockOpen,
  MessagesSquare,
  Search,
  Settings,
  Target,
} from 'lucide-react';
import { COMPANY_QUESTIONS, PHASES, TOPICS } from '../content';
import { PROJECTS, projectsForTopic } from '../content/projects';
import { useProgress } from '../lib/progress';
import { companyUnlocked, topicCompletion, topicStatus } from '../lib/stats';
import { codeLabLabel } from '../lib/nextStep';
import { currentlyWrong, weakTopics } from '../lib/weak';
import { VIZ, vizForSection } from '../viz/registry';
import { ProgressRing } from '../components/ProgressRing';
import { shortTitle } from '../lib/labels';
import type { Topic } from '../types';

/** section → has an interactive visualisation (computed once) */
const VIZ_SECTIONS = new Map(TOPICS.map((t) => [t.id, t.sections.map((s) => vizForSection(t.id, s.heading).length > 0)]));
const COMPANY_BY_TOPIC = new Map(TOPICS.map((t) => [t.id, COMPANY_QUESTIONS.filter((q) => q.relatedTopics.includes(t.id)).length]));

const TOTALS = {
  phases: PHASES.filter((ph) => TOPICS.some((t) => t.phase === ph.id)).length,
  topics: TOPICS.length,
  sections: TOPICS.reduce((a, t) => a + t.sections.length, 0),
  labs: TOPICS.reduce((a, t) => a + t.codeChallenges.length, 0),
  interview: TOPICS.reduce((a, t) => a + t.interviewQuestions.length, 0),
  drills: TOPICS.reduce((a, t) => a + t.envelopeQuestions.length, 0),
  exam: TOPICS.reduce((a, t) => a + t.test.length, 0),
  animations: VIZ.length,
  capstones: PROJECTS.length,
  company: COMPANY_QUESTIONS.length,
};

/** Wrap every case-insensitive occurrence of `q` in <mark>. */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  for (let at = lower.indexOf(q, i); at >= 0; at = lower.indexOf(q, i)) {
    out.push(text.slice(i, at), <mark key={at}>{text.slice(at, at + q.length)}</mark>);
    i = at + q.length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}

interface TopicView {
  topic: Topic;
  /** section indexes to show */
  sections: number[];
}

export default function ContentsPage() {
  const p = useProgress();
  const nav = useNavigate();
  const { hash } = useLocation();
  const [query, setQuery] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyViz, setOnlyViz] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const q = useDeferredValue(query.trim().toLowerCase());
  const filtering = !!q || onlyUnread || onlyViz;

  const phases = useMemo(() => {
    return PHASES.map((ph) => {
      const phaseHit = !!q && (ph.title.toLowerCase().includes(q) || ph.blurb.toLowerCase().includes(q));
      const views: TopicView[] = [];
      for (const t of TOPICS.filter((x) => x.phase === ph.id)) {
        const read = new Set(p.sections[t.id] ?? []);
        const topicHit =
          phaseHit || !q || t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q) || t.tags.some((g) => g.toLowerCase().includes(q));
        const sections = t.sections
          .map((_, i) => i)
          .filter((i) => (!onlyUnread || !read.has(i)) && (!onlyViz || VIZ_SECTIONS.get(t.id)?.[i]))
          .filter((i) => topicHit || t.sections[i].heading.toLowerCase().includes(q));
        if (sections.length || (topicHit && !onlyUnread && !onlyViz)) views.push({ topic: t, sections });
      }
      return { ph, views, total: TOPICS.filter((x) => x.phase === ph.id).length };
    }).filter((x) => x.total > 0);
  }, [p.sections, q, onlyUnread, onlyViz]);

  const matchCount = phases.reduce((a, x) => a + x.views.length, 0);

  // deep links (/contents#phase-<id>) jump straight there; the jump bar scrolls smoothly itself
  const jumping = useRef(false);
  useEffect(() => {
    if (!hash || jumping.current) {
      jumping.current = false;
      return;
    }
    const raf = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(raf);
  }, [hash]);

  const jump = (id: string) => {
    jumping.current = true;
    nav({ hash: id }, { replace: true });
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const setAll = (value: boolean) => setCollapsed(Object.fromEntries(PHASES.map((ph) => [ph.id, value])));

  return (
    <div className="page contents-page">
      <header className="contents-head">
        <div className="eyebrow">
          <ListTree size={14} aria-hidden /> Contents
        </div>
        <h1>Everything in this course</h1>
        <ul className="contents-totals" aria-label="Course totals">
          <li>
            <strong>{TOTALS.phases}</strong> phases
          </li>
          <li>
            <strong>{TOTALS.topics}</strong> topics
          </li>
          <li>
            <strong>{TOTALS.sections}</strong> sections
          </li>
          <li>
            <strong>{TOTALS.animations}</strong> animations
          </li>
          <li>
            <strong>{TOTALS.labs}</strong> code labs
          </li>
          <li>
            <strong>{TOTALS.interview}</strong> interview Qs
          </li>
          <li>
            <strong>{TOTALS.drills}</strong> estimation drills
          </li>
          <li>
            <strong>{TOTALS.exam}</strong> exam questions
          </li>
          <li>
            <strong>{TOTALS.capstones}</strong> capstones
          </li>
          <li>
            <strong>{TOTALS.company}</strong> company Qs
          </li>
        </ul>
      </header>

      <div className="contents-tools card">
        <label className="contents-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            placeholder="Search topics, tags and section headings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the contents"
          />
        </label>
        <div className="row wrap gap-s">
          <button type="button" className={`chip ${onlyUnread ? 'on' : ''}`} aria-pressed={onlyUnread} onClick={() => setOnlyUnread((v) => !v)}>
            Only unread
          </button>
          <button type="button" className={`chip ${onlyViz ? 'on' : ''}`} aria-pressed={onlyViz} onClick={() => setOnlyViz((v) => !v)}>
            <CirclePlay size={14} aria-hidden /> Only with animations
          </button>
          <span className="spacer" />
          <button type="button" className="link-btn small" onClick={() => setAll(false)}>
            Expand all
          </button>
          <span className="muted small">·</span>
          <button type="button" className="link-btn small" onClick={() => setAll(true)}>
            Collapse all
          </button>
        </div>
        {filtering && (
          <div className="small muted" aria-live="polite">
            {matchCount} topic{matchCount === 1 ? '' : 's'} match
          </div>
        )}
      </div>

      <nav className="jump-bar" aria-label="Jump to phase">
        {phases.map(({ ph, views }) => (
          <button key={ph.id} type="button" className={`chip ${views.length ? '' : 'dim'}`} onClick={() => jump(`phase-${ph.id}`)} title={ph.title}>
            {ph.number}. {shortTitle(ph.title)}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => jump('phase-tools')}>
          Practice &amp; tools
        </button>
      </nav>

      {phases.map(({ ph, views, total }) => {
        if (filtering && !views.length) return null;
        const passed = TOPICS.filter((t) => t.phase === ph.id && topicStatus(p, t) === 'passed').length;
        const open = filtering || !collapsed[ph.id];
        return (
          <section key={ph.id} id={`phase-${ph.id}`} className="contents-phase">
            <button
              type="button"
              className="contents-phase-head"
              aria-expanded={open}
              onClick={() => setCollapsed((c) => ({ ...c, [ph.id]: !c[ph.id] }))}
            >
              <span className="phase-num">{ph.number}</span>
              <span className="contents-phase-text">
                <span className="contents-phase-title">
                  <Hl text={ph.title} q={q} />
                </span>
                <span className="muted small">{ph.blurb}</span>
              </span>
              <span className="contents-phase-meter">
                <ProgressRing value={(passed / Math.max(1, total)) * 100} size={34} tone="good" />
                <span className="small muted">
                  {passed}/{total} passed
                </span>
              </span>
              <ChevronDown size={18} aria-hidden className={`chev-icon ${open ? '' : 'closed'}`} />
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="body"
                  className="collapse-anim"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                >
                  <div className="contents-topics">
                    {views.map((v) => (
                      <TopicEntry key={v.topic.id} view={v} q={q} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        );
      })}

      <ToolsGroup />
    </div>
  );
}

function TopicEntry({ view, q }: { view: TopicView; q: string }) {
  const p = useProgress();
  const { topic: t, sections } = view;
  const read = new Set(p.sections[t.id] ?? []);
  const st = topicStatus(p, t);
  const rec = p.tests[t.id];
  const capstones = projectsForTopic(t.id).length;
  const companyQs = COMPANY_BY_TOPIC.get(t.id) ?? 0;
  const base = `/topic/${t.id}`;
  const chips: { label: string; to: string; count?: number; icon: typeof CodeXml }[] = [
    { label: codeLabLabel(t), to: `${base}?tab=code`, count: t.codeChallenges.length, icon: CodeXml },
    { label: 'Interview Qs', to: `${base}?tab=interview`, count: t.interviewQuestions.length, icon: MessagesSquare },
    { label: 'Back-of-Envelope', to: `${base}?tab=envelope`, count: t.envelopeQuestions.length, icon: Calculator },
    { label: 'Cheat Sheet', to: `${base}?tab=cheat`, icon: FileText },
    { label: 'Exam', to: `${base}?tab=exam`, count: t.test.length, icon: GraduationCap },
    { label: 'Capstone', to: `${base}?tab=capstone`, count: capstones, icon: Hammer },
    { label: 'Company Qs', to: '/companies', count: companyQs, icon: Building },
  ];
  return (
    <article className={`contents-topic st-${st}`}>
      <div className="contents-topic-head">
        <ProgressRing value={topicCompletion(p, t)} size={38} tone={st === 'passed' ? 'good' : undefined} label={`${topicCompletion(p, t)}% complete`}>
          <span className="ring-pct">{topicCompletion(p, t)}</span>
        </ProgressRing>
        <div className="contents-topic-title">
          <Link to={base}>
            <Hl text={t.title} q={q} />
          </Link>
          <div className="muted small">
            <Hl text={t.subtitle} q={q} />
          </div>
        </div>
        <span className={`status-pill st-${st}`}>
          {st === 'passed' ? `Passed · ${rec?.best}%` : st === 'in-progress' ? (rec ? `In progress · best ${rec.best}%` : 'In progress') : 'New'}
        </span>
      </div>
      {sections.length > 0 && (
        <ol className="contents-sections">
          {sections.map((i) => (
            <li key={i} className={read.has(i) ? 'read' : ''}>
              <Link to={`${base}?tab=learn&s=${i}`}>
                <span className="sec-num">{i + 1}</span>
                <span className="sec-title">
                  <Hl text={t.sections[i].heading} q={q} />
                </span>
                {VIZ_SECTIONS.get(t.id)?.[i] && <CirclePlay size={15} className="sec-viz" aria-label="Has an interactive animation" />}
                {read.has(i) && <Check size={15} className="sec-read" aria-label="Read" />}
              </Link>
            </li>
          ))}
        </ol>
      )}
      <div className="contents-chips">
        {chips
          .filter((c) => c.count === undefined || c.count > 0)
          .map(({ label, to, count, icon: Icon }) => (
            <Link key={label} to={to} className="chip">
              <Icon size={13} aria-hidden /> {label}
              {count !== undefined && <span className="chip-count">{count}</span>}
            </Link>
          ))}
      </div>
    </article>
  );
}

function ToolsGroup() {
  const p = useProgress();
  const { unlocked, remaining } = companyUnlocked(p, TOPICS);
  const companyDone = COMPANY_QUESTIONS.filter((q) => p.company[q.id]).length;
  const weak = weakTopics(p, TOPICS).length;
  const mistakes = TOPICS.reduce((a, t) => a + currentlyWrong(p, t).length, 0);
  return (
    <section id="phase-tools" className="contents-phase">
      <div className="contents-phase-head static">
        <span className="phase-num">
          <Dumbbell size={16} aria-hidden />
        </span>
        <span className="contents-phase-text">
          <span className="contents-phase-title">Practice &amp; tools</span>
          <span className="muted small">Everything outside the topic pages.</span>
        </span>
      </div>
      <div className="tools-grid">
        <Link to="/companies" className={`tool-card ${unlocked ? '' : 'locked'}`}>
          {unlocked ? <LockOpen size={20} aria-hidden /> : <Lock size={20} aria-hidden />}
          <strong>Company track</strong>
          <span className="small muted">
            {COMPANY_QUESTIONS.length} real company questions with timed mock interviews.{' '}
            {unlocked ? `${companyDone}/${COMPANY_QUESTIONS.length} done.` : `Locked: pass ${remaining.length} more topic exam${remaining.length === 1 ? '' : 's'}.`}
          </span>
        </Link>
        <div className="tool-card">
          <Hammer size={20} aria-hidden />
          <strong>Capstone projects ({PROJECTS.length})</strong>
          <span className="small muted">Real code projects in this repo, judged by tests.</span>
          <ul className="tool-list">
            {PROJECTS.map((pr) => (
              <li key={pr.id}>
                <Link to={`/topic/${pr.topics[0]}?tab=capstone`}>{pr.title}</Link>
              </li>
            ))}
          </ul>
        </div>
        <Link to="/weak-areas" className="tool-card">
          <Target size={20} aria-hidden />
          <strong>Weak Areas</strong>
          <span className="small muted">
            The sections behind the questions you miss{weak ? `: ${weak} topic${weak === 1 ? '' : 's'} need work.` : '. Nothing yet.'}
          </span>
        </Link>
        <Link to="/practice" className="tool-card">
          <Dumbbell size={20} aria-hidden />
          <strong>Practice</strong>
          <span className="small muted">A timed drill of every exam question you currently get wrong ({mistakes}).</span>
        </Link>
        <Link to="/settings" className="tool-card">
          <Settings size={20} aria-hidden />
          <strong>Settings</strong>
          <span className="small muted">Pass mark, exam timing, study-first lock, theme, coach tips, guide and reset.</span>
        </Link>
      </div>
    </section>
  );
}
