// Contents: every phase, topic, section, practice tab and tool in the course on one searchable page.
// Hero: a blueprint sheet drawing the phases as an architecture, coloured by real progress.
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { usePageMotion } from '../lib/usePageMotion';
import {
  Award,
  Building,
  Calculator,
  Check,
  ChevronDown,
  CircleHelp,
  CirclePlay,
  CodeXml,
  Columns3,
  Database,
  Dumbbell,
  FileText,
  Gauge,
  GraduationCap,
  Hammer,
  LayoutPanelTop,
  Lock,
  LockOpen,
  MessagesSquare,
  Monitor,
  Network,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Target,
  TriangleAlert,
  User,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { COMPANY_QUESTIONS, PHASES, TOPICS } from '../content';
import type { Phase } from '../content/phases';
import { PROJECTS, projectsForTopic } from '../content/projects';
import { isPassed, useProgress, type Progress } from '../lib/progress';
import { companyUnlocked, topicCompletion, topicStatus } from '../lib/stats';
import { codeLabLabel } from '../lib/nextStep';
import { currentlyWrong, weakTopics } from '../lib/weak';
import { VIZ, vizForSection } from '../viz/registry';
import { ACHIEVEMENT_TOTAL } from '../lib/achievements';
import { phaseCode, shortTitle, topicCode } from '../lib/labels';
import type { Topic } from '../types';

/** section → has an interactive visualisation (computed once) */
const VIZ_SECTIONS = new Map(TOPICS.map((t) => [t.id, t.sections.map((s) => vizForSection(t.id, s.heading).length > 0)]));
const COMPANY_BY_TOPIC = new Map(TOPICS.map((t) => [t.id, COMPANY_QUESTIONS.filter((q) => q.relatedTopics.includes(t.id)).length]));
const PHASES_WITH_TOPICS = PHASES.filter((ph) => TOPICS.some((t) => t.phase === ph.id));

const TOTALS = {
  phases: PHASES_WITH_TOPICS.length,
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

/* ---------- phase look: icon + where it sits on the blueprint ---------- */
interface PhaseLook {
  icon: LucideIcon;
  /** blueprint column (0–5) and row (0 top, 1 middle, 2 bottom) */
  col: number;
  row: number;
  /** node label, one or two lines */
  label: [string, string?];
}
const LOOK: Record<string, PhaseLook> = {
  fundamentals: { icon: Monitor, col: 0, row: 1, label: ['Fundamentals'] },
  networking: { icon: Share2, col: 1, row: 1, label: ['Networking &', 'Traffic'] },
  caching: { icon: Zap, col: 2, row: 0, label: ['Caching & CDN'] },
  databases: { icon: Database, col: 2, row: 1, label: ['Databases'] },
  distributed: { icon: Network, col: 2, row: 2, label: ['Distributed', 'Systems'] },
  messaging: { icon: Columns3, col: 3, row: 0, label: ['Messaging &', 'Data Pipelines'] },
  reliability: { icon: ShieldCheck, col: 3, row: 1, label: ['Reliability &', 'Resilience'] },
  'apis-security': { icon: Lock, col: 3, row: 2, label: ['APIs & Security'] },
  platform: { icon: Gauge, col: 4, row: 0, label: ['Platform &', 'Operations'] },
  production: { icon: TriangleAlert, col: 4, row: 1, label: ['Production', 'Problem → Solution'] },
  designs: { icon: LayoutPanelTop, col: 4, row: 2, label: ['Complete', 'System Designs'] },
  lld: { icon: CodeXml, col: 5, row: 0, label: ['Low-Level Design', '& Machine Coding'] },
  miscellaneous: { icon: CircleHelp, col: 5, row: 1, label: ['Interview', 'Question Bank'] },
  behavioral: { icon: User, col: 5, row: 2, label: ['Behavioural &', 'Hiring-Manager'] },
};
/** dependency edges of the course drawn on the sheet (from → to) */
const EDGES: [string, string][] = [
  ['fundamentals', 'networking'],
  ['networking', 'caching'],
  ['networking', 'databases'],
  ['networking', 'distributed'],
  ['caching', 'messaging'],
  ['databases', 'messaging'],
  ['databases', 'reliability'],
  ['distributed', 'apis-security'],
  ['messaging', 'platform'],
  ['reliability', 'platform'],
  ['reliability', 'production'],
  ['apis-security', 'designs'],
  ['platform', 'lld'],
  ['production', 'miscellaneous'],
  ['designs', 'behavioral'],
];
const COLUMNS = ['ENTRY', 'TRAFFIC', 'STATE', 'FLOW & SAFETY', 'OPERATE & DESIGN', 'CRAFT & ROUNDS'];

/** Position of every phase on the sheet; if the map does not know every phase, all are laid out in order on a 3-row grid. */
function layoutOf(phases: Phase[]) {
  const known = phases.every((ph) => LOOK[ph.id]);
  return new Map<string, { col: number; row: number; icon: LucideIcon; label: [string, string?] }>(
    phases.map((ph, i) => {
      const l = LOOK[ph.id];
      const col = known ? l.col : Math.floor(i / 3);
      const row = known ? l.row : i % 3;
      return [ph.id, { col, row, icon: l?.icon ?? LayoutPanelTop, label: l?.label ?? ([shortTitle(ph.title)] as [string]) }];
    }),
  );
}

type PhaseState = 'passed' | 'studying' | 'started' | 'ahead';
const STATE_LABEL: Record<PhaseState, string> = { passed: 'Passed', studying: 'Studying', started: 'In progress', ahead: 'Ahead' };
const STATE_TONE: Record<PhaseState, string> = { passed: 'cyan', studying: 'amber', started: 'blue', ahead: '' };

interface PhaseInfo {
  ph: Phase;
  topics: Topic[];
  passed: number;
  /** status per topic, course order */
  states: ('passed' | 'in-progress' | 'new')[];
  state: PhaseState;
}

function phaseInfo(p: Progress): { infos: PhaseInfo[]; nextTopic?: Topic } {
  const nextTopic = TOPICS.find((t) => !isPassed(p, t.id));
  const infos = PHASES_WITH_TOPICS.map((ph) => {
    const topics = TOPICS.filter((t) => t.phase === ph.id);
    const states = topics.map((t) => topicStatus(p, t));
    const passed = states.filter((s) => s === 'passed').length;
    const state: PhaseState =
      passed === topics.length ? 'passed' : nextTopic?.phase === ph.id ? 'studying' : states.some((s) => s !== 'new') ? 'started' : 'ahead';
    return { ph, topics, passed, states, state };
  });
  return { infos, nextTopic };
}

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

type StateFilter = 'all' | 'progress' | 'passed' | 'ahead';

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function ContentsPage() {
  const p = useProgress();
  const nav = useNavigate();
  const { hash } = useLocation();
  const [query, setQuery] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyViz, setOnlyViz] = useState(false);
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const q = useDeferredValue(query.trim().toLowerCase());
  const filtering = !!q || onlyUnread || onlyViz;

  const { infos, nextTopic } = useMemo(() => phaseInfo(p), [p]);
  const infoById = useMemo(() => new Map<string, PhaseInfo>(infos.map((x) => [x.ph.id, x])), [infos]);

  // phases start folded except the one being studied (and a deep-linked one); "Expand all" opens every phase
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    const studying = infos.find((x) => x.state === 'studying');
    if (studying) init[studying.ph.id] = true;
    if (hash.startsWith('#phase-')) init[hash.slice(7)] = true;
    return init;
  });

  const phases = useMemo(() => {
    return infos.map(({ ph, topics }) => {
      const phaseHit = !!q && (ph.title.toLowerCase().includes(q) || ph.blurb.toLowerCase().includes(q));
      const views: TopicView[] = [];
      for (const t of topics) {
        const read = new Set(p.sections[t.id] ?? []);
        const topicHit =
          phaseHit || !q || t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q) || t.tags.some((g) => g.toLowerCase().includes(q));
        const sections = t.sections
          .map((_, i) => i)
          .filter((i) => (!onlyUnread || !read.has(i)) && (!onlyViz || VIZ_SECTIONS.get(t.id)?.[i]))
          .filter((i) => topicHit || t.sections[i].heading.toLowerCase().includes(q));
        if (sections.length || (topicHit && !onlyUnread && !onlyViz)) views.push({ topic: t, sections });
      }
      return { ph, views };
    });
  }, [infos, p.sections, q, onlyUnread, onlyViz]);

  const matchCount = phases.reduce((a, x) => a + x.views.length, 0);
  const counts = {
    all: infos.length,
    progress: infos.filter((x) => x.state === 'studying' || x.state === 'started').length,
    passed: infos.filter((x) => x.state === 'passed').length,
    ahead: infos.filter((x) => x.state === 'ahead').length,
  };
  const stateOk = (s: PhaseState) =>
    stateFilter === 'all' || (stateFilter === 'progress' ? s === 'studying' || s === 'started' : s === stateFilter);

  // deep links (/contents#phase-<id>) unfold that phase and jump straight there; in-page jumps scroll smoothly themselves
  const jumping = useRef(false);
  const [hashPhase, setHashPhase] = useState('');
  if (hash !== hashPhase) {
    // render-time sync (no effect): a hash change from outside the page unfolds its phase
    setHashPhase(hash);
    const id = hash.slice(7);
    if (hash.startsWith('#phase-') && !open[id]) setOpen((o) => ({ ...o, [id]: true }));
  }
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
    if (id.startsWith('phase-')) {
      const phId = id.slice(6);
      setOpen((o) => ({ ...o, [phId]: true }));
      const st = infoById.get(phId)?.state;
      if (st && !stateOk(st)) setStateFilter('all');
    }
    nav({ hash: id }, { replace: true });
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }),
    );
  };
  const setAll = (value: boolean) => setOpen(Object.fromEntries(PHASES.map((ph) => [ph.id, value])));

  // GSAP: the heading enters with the syllabus sheet (media); filters stay put; phase rows reveal as they scroll into
  // view (phase bodies use Framer Motion)
  const root = useRef<HTMLDivElement>(null);
  usePageMotion(root, {
    intro: '.ct-head',
    introMedia: ':scope > .ct-sheet',
    reveal: '.ct-rows > .ct-phase',
  });

  // on narrow screens the sheet scrolls sideways: start it at the phase being studied
  const sheetScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sheetScroll.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const node = el.querySelector<SVGGraphicsElement>('.ct-node-studying');
    if (!node) return;
    const box = node.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    el.scrollLeft = Math.max(0, box.left - host.left + el.scrollLeft - (el.clientWidth - box.width) / 2);
  }, []);

  const passedTopics = infos.reduce((a, x) => a + x.passed, 0);
  const company = companyUnlocked(p, TOPICS);
  const companyDone = COMPANY_QUESTIONS.filter((x) => p.company[x.id]).length;

  return (
    <div className="page ct-page" ref={root} data-motion="own">
      <header className="ct-head">
        <div className="ct-head-text">
          <span className="nb-chip blue">Contents · the full blueprint</span>
          <h1>
            <span className="gtext">
              {TOTALS.phases} phases.
              <br />
              {TOTALS.topics} topics. One system.
            </span>
          </h1>
        </div>
        <div className="ct-facts-wrap">
          <ul className="ct-facts" aria-label="Course totals">
            <li>
              <b className="num">{TOTALS.sections}</b>
              <span className="eyebrow">Sections</span>
            </li>
            <li>
              <b className="num">{TOTALS.labs}</b>
              <span className="eyebrow">Code labs</span>
            </li>
            <li>
              <b className="num">{TOTALS.drills}</b>
              <span className="eyebrow">BoE drills</span>
            </li>
            <li>
              <b className="num">{TOTALS.capstones}</b>
              <span className="eyebrow">Capstones</span>
            </li>
          </ul>
          <p className="ct-facts-more mono">
            {TOTALS.animations} animations · {TOTALS.interview} interview Qs · {TOTALS.exam} exam questions · {TOTALS.company} company Qs
          </p>
        </div>
      </header>

      <section className="ct-sheet glass" aria-labelledby="ct-bp">
        <div className="ct-frame">
          <div className="ct-ruler" aria-hidden>
            {'ABCDEFGH'.split('').map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <h2 id="ct-bp" className="sr-only">
            Blueprint of the {TOTALS.phases} phases. Select a phase to jump to it.
          </h2>
          <div className="ct-sheet-scroll" ref={sheetScroll}>
            <Blueprint infos={infos} onJump={jump} />
          </div>
          <div className="ct-tblock">
            <div>
              Drawing<b>SysDesign.prep · curriculum</b>
            </div>
            <div>
              Sheet<b>01 / 01</b>
            </div>
            <div>
              Passed
              <b>
                {passedTopics} of {TOTALS.topics} topics
              </b>
            </div>
            <div>
              Company track
              <b>
                {company.unlocked ? (
                  <Link to="/companies">
                    Unlocked · {companyDone}/{COMPANY_QUESTIONS.length} done
                  </Link>
                ) : (
                  `Unlocks at ${TOTALS.topics} / ${TOTALS.topics}`
                )}
              </b>
            </div>
            <div>
              Rev<b>{new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</b>
            </div>
          </div>
        </div>
      </section>

      <div className="ct-tools">
        <div className="ct-tools-top">
          <label className="ct-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder="Search topics, tags and section headings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search the contents"
            />
          </label>
          <button type="button" className={`chip ${onlyUnread ? 'on' : ''}`} aria-pressed={onlyUnread} onClick={() => setOnlyUnread((v) => !v)}>
            Only unread
          </button>
          <button type="button" className={`chip ${onlyViz ? 'on' : ''}`} aria-pressed={onlyViz} onClick={() => setOnlyViz((v) => !v)}>
            <CirclePlay size={14} aria-hidden /> Only with animations
          </button>
          <span className="ct-expand">
            <button type="button" className="link-btn small" onClick={() => setAll(true)}>
              Expand all
            </button>
            <span className="muted small" aria-hidden>
              ·
            </span>
            <button type="button" className="link-btn small" onClick={() => setAll(false)}>
              Collapse all
            </button>
          </span>
        </div>
        <div className="ct-filters">
          <div className="ct-filter-group" role="group" aria-label="Filter phases by progress">
            {(
              [
                ['all', `All ${counts.all}`],
                ['progress', `In progress · ${counts.progress}`],
                ['passed', `Passed · ${counts.passed}`],
                ['ahead', `Ahead · ${counts.ahead}`],
              ] as [StateFilter, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" className={`chip ${stateFilter === id ? 'on' : ''}`} aria-pressed={stateFilter === id} onClick={() => setStateFilter(id)}>
                {label}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => jump('phase-tools')}>
              <Dumbbell size={14} aria-hidden /> Practice &amp; tools
            </button>
          </div>
          <span className="ct-pipeline mono">Learn → Code Lab → Interview Qs → Back-of-Envelope → Exam → Capstone</span>
        </div>
        {filtering && (
          <div className="ct-match small muted" aria-live="polite">
            {matchCount} topic{matchCount === 1 ? '' : 's'} match
          </div>
        )}
      </div>

      <div className="ct-rows">
        {phases.map(({ ph, views }) => {
          const info = infoById.get(ph.id)!;
          if (filtering && !views.length) return null;
          if (!stateOk(info.state)) return null;
          return (
            <PhaseRow
              key={ph.id}
              info={info}
              views={views}
              q={q}
              open={filtering || !!open[ph.id]}
              filtering={filtering}
              nextTopicId={nextTopic?.id}
              onToggle={() => setOpen((o) => ({ ...o, [ph.id]: !o[ph.id] }))}
            />
          );
        })}
        {!infos.some((x) => stateOk(x.state)) && (
          <p className="ct-empty muted">No phases match this filter yet.</p>
        )}
      </div>

      <ToolsGroup />
    </div>
  );
}

/* ---------- blueprint sheet ---------- */
const NODE_W = 186;
const NODE_H = 70;
const COL_X = (c: number) => 7 + c * 215;
const ROW_Y = (r: number) => 95 + r * 120;

function Blueprint({ infos, onJump }: { infos: PhaseInfo[]; onJump: (id: string) => void }) {
  const lay = layoutOf(infos.map((x) => x.ph));
  const cols = Math.max(1, ...[...lay.values()].map((l) => l.col + 1));
  const width = COL_X(cols - 1) + NODE_W + 7;
  const byId = new Map<string, PhaseInfo>(infos.map((x) => [x.ph.id, x]));
  const edges = EDGES.filter(([a, b]) => lay.has(a) && lay.has(b));
  return (
    <svg viewBox={`0 0 ${width} 430`} className="ct-bp" aria-labelledby="ct-bp">
      {/* column headings */}
      <g className="sv-mono" fontSize="10" letterSpacing="1.5" aria-hidden>
        {Array.from({ length: cols }, (_, c) => (
          <text key={c} x={COL_X(c) + NODE_W / 2} y="26" textAnchor="middle" className="sv-ink3">
            {COLUMNS[c] ?? `STAGE ${c + 1}`}
          </text>
        ))}
      </g>
      {/* edges: solid cyan with packets out of a passed phase, blue between started phases, dashed ahead */}
      <g aria-hidden>
        {edges.map(([a, b]) => {
          const from = lay.get(a)!;
          const to = lay.get(b)!;
          const x1 = COL_X(from.col) + NODE_W;
          const y1 = ROW_Y(from.row);
          const x2 = COL_X(to.col);
          const y2 = ROW_Y(to.row);
          const mx = (x1 + x2) / 2;
          const d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
          const sa = byId.get(a)!.state;
          const sb = byId.get(b)!.state;
          if (sa === 'passed') {
            return (
              <g key={`${a}-${b}`}>
                <path d={d} className="st-cyan" fill="none" strokeWidth="2" opacity=".55" />
                <path d={d} className="st-cyan flow" fill="none" strokeWidth="2" />
                <circle r="4.5" className="pkt sv-cyan ct-pkt" style={{ offsetPath: `path('${d}')`, ['--dur' as string]: '2.6s' }} />
                <circle
                  r="4.5"
                  className={`pkt ${sb === 'studying' ? 'sv-amber' : 'sv-cyan'} ct-pkt`}
                  style={{ offsetPath: `path('${d}')`, ['--dur' as string]: '2.6s', ['--dl' as string]: '1.3s' }}
                />
              </g>
            );
          }
          if (sa !== 'ahead' && sb !== 'ahead') return <path key={`${a}-${b}`} d={d} className="st-blue flow" fill="none" strokeWidth="1.6" opacity=".8" />;
          return <path key={`${a}-${b}`} d={d} className="st-line" fill="none" strokeWidth="1.4" strokeDasharray="3 6" />;
        })}
      </g>
      {/* phase nodes: links that unfold and jump to the phase row */}
      {infos.map((info) => {
        const l = lay.get(info.ph.id)!;
        const x = COL_X(l.col);
        const y = ROW_Y(l.row) - NODE_H / 2;
        const tone = STATE_TONE[info.state];
        const color = tone ? `var(--${tone})` : 'var(--ink-4)';
        const Icon = l.icon;
        const two = !!l.label[1];
        const n = `${phaseCode(info.ph.number)} · ${info.passed}/${info.topics.length}`;
        const status = info.state === 'passed' ? `${n} PASSED` : `${n} · ${info.state === 'started' ? 'STARTED' : info.state.toUpperCase()}`;
        return (
          <a
            key={info.ph.id}
            href={`#phase-${info.ph.id}`}
            className={`ct-node ct-node-${info.state}`}
            aria-label={`Phase ${info.ph.number}, ${info.ph.title}: ${info.passed} of ${info.topics.length} topics passed, ${STATE_LABEL[info.state]}. Jump to phase.`}
            onClick={(e) => {
              e.preventDefault();
              onJump(`phase-${info.ph.id}`);
            }}
          >
            {info.state === 'studying' && (
              <rect x={x - 6} y={y - 6} width={NODE_W + 12} height={NODE_H + 12} rx="20" fill="none" className="st-amber flow" strokeWidth="1.2" opacity=".7" />
            )}
            <rect
              x={x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx="15"
              className={`ct-node-box sv-surface ${tone ? `st-${tone}` : 'st-line'}`}
              strokeWidth={tone ? 1.6 : 1.2}
              fillOpacity=".92"
            />
            <rect x={x + 12} y={y + 18} width="34" height="34" rx="10" style={{ fill: color }} fillOpacity=".14" />
            <Icon x={x + 19} y={y + 25} width={20} height={20} strokeWidth={1.9} style={{ color }} aria-hidden />
            <text x={x + 56} y={two ? y + 24 : y + 32} className={`sv-text ${tone ? 'sv-ink' : 'sv-ink3'}`} fontSize="13.5" fontWeight="700">
              {l.label[0]}
            </text>
            {two && (
              <text x={x + 56} y={y + 40} className={`sv-text ${tone ? 'sv-ink' : 'sv-ink3'}`} fontSize="13.5" fontWeight="700">
                {l.label[1]}
              </text>
            )}
            <text x={x + 56} y={two ? y + 58 : y + 50} className={`sv-mono ${tone ? `sv-${tone}` : 'sv-ink3'}`} fontSize="10" letterSpacing=".6">
              {status}
            </text>
          </a>
        );
      })}
      {/* dimension line */}
      <g className="sv-mono" fontSize="10" letterSpacing="1.5" aria-hidden>
        <path d={`M7 405 H${width - 7} M7 398 V412 M${width - 7} 398 V412`} className="st-line" fill="none" />
        <rect x={width / 2 - 80} y="396" width="160" height="18" className="sv-surface" />
        <text x={width / 2} y="409" textAnchor="middle" className="sv-ink2">
          {TOTALS.topics} TOPICS · {TOTALS.phases} PHASES
        </text>
      </g>
    </svg>
  );
}

/* ---------- one phase row ---------- */
function PhaseRow({
  info,
  views,
  q,
  open,
  filtering,
  nextTopicId,
  onToggle,
}: {
  info: PhaseInfo;
  views: TopicView[];
  q: string;
  open: boolean;
  filtering: boolean;
  nextTopicId?: string;
  onToggle: () => void;
}) {
  const { ph, topics, passed, states, state } = info;
  const Icon = LOOK[ph.id]?.icon ?? LayoutPanelTop;
  const tone = STATE_TONE[state];
  const inProg = states.filter((s) => s === 'in-progress').length;
  const pct = Math.round((passed / Math.max(1, topics.length)) * 100);
  const bodyId = `phase-body-${ph.id}`;
  return (
    <section id={`phase-${ph.id}`} className={`ct-phase glass-flat st-${state} ${open ? 'open' : ''}`} aria-labelledby={`phase-h-${ph.id}`}>
      <h2 className="ct-ph-h" id={`phase-h-${ph.id}`}>
        <button type="button" className="ct-ph-top" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className={`ct-ph-n num ${tone}`}>{phaseCode(ph.number)}</span>
          <span className={`ct-ph-ic ${tone}`} aria-hidden>
            <Icon size={20} strokeWidth={1.8} />
          </span>
          <span className="ct-ph-t">
            <span className="ct-ph-title">
              <Hl text={ph.title} q={q} />
            </span>
            <span className="ct-ph-blurb">
              <Hl text={ph.blurb} q={q} />
            </span>
          </span>
          <span className="ct-ph-m">
            <span className="ct-segs" role="img" aria-label={`${passed} of ${topics.length} topics passed, ${inProg} in progress`}>
              {states.map((s, i) => (
                <span key={i} className={`ct-sg ${s === 'passed' ? 'p' : s === 'in-progress' ? 'i' : ''}`} />
              ))}
            </span>
            <span className="mono ct-ph-c">
              {passed}/{topics.length} topics · {pct}%
            </span>
          </span>
          <span className="ct-ph-s">
            <span className={`nb-chip ${tone}`}>{STATE_LABEL[state]}</span>
          </span>
          <span className="ct-ph-chev" aria-hidden>
            <ChevronDown size={16} strokeWidth={2.2} className={open ? 'up' : ''} />
          </span>
        </button>
      </h2>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            id={bodyId}
            className="collapse-anim"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <ul className="ct-tl">
              {views.map((v) => (
                <TopicEntry key={v.topic.id} view={v} q={q} filtering={filtering} next={v.topic.id === nextTopicId} />
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function TopicEntry({ view, q, filtering, next }: { view: TopicView; q: string; filtering: boolean; next: boolean }) {
  const p = useProgress();
  const [detail, setDetail] = useState(next);
  const { topic: t, sections } = view;
  const read = new Set(p.sections[t.id] ?? []);
  const st = topicStatus(p, t);
  const rec = p.tests[t.id];
  const pct = topicCompletion(p, t);
  const capstones = projectsForTopic(t.id).length;
  const companyQs = COMPANY_BY_TOPIC.get(t.id) ?? 0;
  const base = `/topic/${t.id}`;
  const showDetail = filtering || detail;
  const detailId = `topic-detail-${t.id}`;
  const chips: { label: string; to: string; count?: number; icon: typeof CodeXml }[] = [
    { label: codeLabLabel(t), to: `${base}?tab=code`, count: t.codeChallenges.length, icon: CodeXml },
    { label: 'Interview Qs', to: `${base}?tab=interview`, count: t.interviewQuestions.length, icon: MessagesSquare },
    { label: 'Back-of-Envelope', to: `${base}?tab=envelope`, count: t.envelopeQuestions.length, icon: Calculator },
    { label: 'Cheat Sheet', to: `${base}?tab=cheat`, icon: FileText },
    { label: 'Exam', to: `${base}?tab=exam`, count: t.test.length, icon: GraduationCap },
    { label: 'Capstone', to: `${base}?tab=capstone`, count: capstones, icon: Hammer },
    { label: 'Company Qs', to: '/companies', count: companyQs, icon: Building },
  ];
  const statusChip =
    st === 'passed' ? (
      <span className="nb-chip cyan">Passed · {rec?.best}%</span>
    ) : next ? (
      <span className="nb-chip amber">Next</span>
    ) : st === 'in-progress' ? (
      <span className="nb-chip blue">{rec ? `Best ${rec.best}%` : 'In progress'}</span>
    ) : (
      <span className="nb-chip">New</span>
    );
  return (
    <li className={`ct-topic st-${st} ${next ? 'is-next' : ''} ${showDetail ? 'open' : ''}`}>
      <div className="ct-topic-row">
        <span className="mono ct-tn">{topicCode(TOPICS, PHASES, t.id)}</span>
        <span className="ct-tt-wrap">
          <Link to={base} className="ct-tt">
            <Hl text={t.title} q={q} />
          </Link>
          <span className="ct-sub">
            <Hl text={t.subtitle} q={q} />
          </span>
        </span>
        <span className="ct-tm">
          <span className="track ct-track" role="img" aria-label={`${pct}% complete`}>
            {pct > 0 && <i className={st === 'passed' ? 'f-pass' : 'f-prog'} style={{ width: `${pct}%` }} />}
          </span>
          <span className="mono ct-tm-c">
            {read.size}/{t.sections.length} read · {pct}%
          </span>
        </span>
        <span className="ct-ts">{statusChip}</span>
        <button
          type="button"
          className="ct-tbtn"
          aria-expanded={showDetail}
          aria-controls={detailId}
          onClick={() => setDetail((d) => !d)}
          aria-label={`${showDetail ? 'Hide' : 'Show'} sections and practice links for ${t.title}`}
        >
          <ChevronDown size={15} strokeWidth={2.2} aria-hidden className={showDetail ? 'up' : ''} />
        </button>
      </div>
      {showDetail && (
        <div className="ct-detail" id={detailId}>
          {sections.length > 0 && (
            <ol className="ct-secs">
              {sections.map((i) => (
                <li key={i} className={read.has(i) ? 'read' : ''}>
                  <Link to={`${base}?tab=learn&s=${i}`}>
                    <span className="ct-sec-num mono">{i + 1}</span>
                    <span className="ct-sec-title">
                      <Hl text={t.sections[i].heading} q={q} />
                    </span>
                    {VIZ_SECTIONS.get(t.id)?.[i] && <CirclePlay size={15} className="ct-sec-viz" aria-label="Has an interactive animation" />}
                    {read.has(i) && <Check size={15} className="ct-sec-read" aria-label="Read" />}
                  </Link>
                </li>
              ))}
            </ol>
          )}
          <div className="ct-chips">
            {chips
              .filter((c) => c.count === undefined || c.count > 0)
              .map(({ label, to, count, icon: Icon }) => (
                <Link key={label} to={to} className="chip">
                  <Icon size={13} aria-hidden /> {label}
                  {count !== undefined && <span className="chip-count">{count}</span>}
                </Link>
              ))}
          </div>
        </div>
      )}
    </li>
  );
}

function ToolsGroup() {
  const p = useProgress();
  const { unlocked, remaining } = companyUnlocked(p, TOPICS);
  const companyDone = COMPANY_QUESTIONS.filter((q) => p.company[q.id]).length;
  const weak = weakTopics(p, TOPICS).length;
  const mistakes = TOPICS.reduce((a, t) => a + currentlyWrong(p, t).length, 0);
  return (
    <section id="phase-tools" className="ct-tools-group" aria-labelledby="ct-tools-h">
      <div className="ct-tools-head">
        <span className="ct-ph-ic" aria-hidden>
          <Dumbbell size={18} />
        </span>
        <div>
          <h2 id="ct-tools-h">Practice &amp; tools</h2>
          <p className="muted small">Everything outside the topic pages.</p>
        </div>
      </div>
      <div className="ct-tool-grid">
        <Link to="/companies" className={`ct-tool glass-flat ${unlocked ? 'unlocked' : 'locked'}`}>
          <span className="ct-tool-ic">{unlocked ? <LockOpen size={18} aria-hidden /> : <Lock size={18} aria-hidden />}</span>
          <strong>Company track</strong>
          <span className="small muted">
            {COMPANY_QUESTIONS.length} real company questions with timed mock interviews.{' '}
            {unlocked ? `${companyDone}/${COMPANY_QUESTIONS.length} done.` : `Locked: pass ${remaining.length} more topic exam${remaining.length === 1 ? '' : 's'}.`}
          </span>
        </Link>
        <div className="ct-tool glass-flat">
          <span className="ct-tool-ic">
            <Hammer size={18} aria-hidden />
          </span>
          <strong>Capstone projects ({PROJECTS.length})</strong>
          <span className="small muted">Real code projects in this repo, judged by tests.</span>
          <ul className="ct-tool-list">
            {PROJECTS.map((pr) => (
              <li key={pr.id}>
                <Link to={`/topic/${pr.topics[0]}?tab=capstone`}>{pr.title}</Link>
              </li>
            ))}
          </ul>
        </div>
        <Link to="/weak-areas" className="ct-tool glass-flat">
          <span className="ct-tool-ic">
            <Target size={18} aria-hidden />
          </span>
          <strong>Weak Areas</strong>
          <span className="small muted">
            The sections behind the questions you miss{weak ? `: ${weak} topic${weak === 1 ? '' : 's'} need work.` : '. Nothing yet.'}
          </span>
        </Link>
        <Link to="/practice" className="ct-tool glass-flat">
          <span className="ct-tool-ic">
            <Dumbbell size={18} aria-hidden />
          </span>
          <strong>Practice</strong>
          <span className="small muted">A timed drill of every exam question you currently get wrong ({mistakes}).</span>
        </Link>
        <Link to="/achievements" className="ct-tool glass-flat">
          <span className="ct-tool-ic">
            <Award size={18} aria-hidden />
          </span>
          <strong>Achievements</strong>
          <span className="small muted">
            Badges for milestones, bronze to diamond: {Object.keys(p.achievements ?? {}).length}/{ACHIEVEMENT_TOTAL} earned.
          </span>
        </Link>
        <Link to="/settings" className="ct-tool glass-flat">
          <span className="ct-tool-ic">
            <Settings size={18} aria-hidden />
          </span>
          <strong>Settings</strong>
          <span className="small muted">Pass mark, exam timing, study-first lock, theme, coach tips, guide and reset.</span>
        </Link>
      </div>
    </section>
  );
}
