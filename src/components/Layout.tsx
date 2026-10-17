import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Award,
  Building2,
  ChevronDown,
  Dumbbell,
  LayoutDashboard,
  ListTree,
  Lock,
  LockOpen,
  Menu,
  Moon,
  Settings as SettingsIcon,
  Sun,
  Target,
  X,
} from 'lucide-react';
import { COMPANY_QUESTIONS, PHASES, TOPICS, TOPIC_BY_ID } from '../content';
import { setSettings, useProgress } from '../lib/progress';
import { companyUnlocked, topicCompletion, topicStatus } from '../lib/stats';
import { getUiPrefs, saveUiPrefs, stableLocation } from '../lib/uiPrefs';
import { openPalette, openTour, closePalette, useGuide } from '../lib/guide';
import { applyThemeAttrs } from '../lib/theme';
import { phaseCode } from '../lib/labels';
import WelcomeTour from './WelcomeTour';
import { Toaster } from './Toaster';
import { CelebrationWatcher } from './CelebrationWatcher';
import { Footer } from './Footer';
import { BrandMark } from './BrandMark';
import { RouteMotion } from './RouteMotion';
import { useAchievementDetection } from '../lib/useAchievements';
import { achievementById, TIER_LABEL } from '../content/achievements';
import { refreshSoon, ScrollTrigger } from '../lib/gsap';

// cmdk is only needed once the palette is opened
const CommandPalette = lazy(() => import('./CommandPalette'));
// the unlock dialog (and its badge art) loads on the first unlock
const AchievementCelebration = lazy(() => import('./achievements/AchievementCelebration'));
/** below this width the main nav and the syllabus share one drawer */
const isCompact = () => window.matchMedia('(max-width: 1099px)').matches;

const STATUS_LABEL = { new: 'not started', 'in-progress': 'in progress', passed: 'exam passed' } as const;

export default function Layout() {
  const p = useProgress();
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getUiPrefs().sidebarCollapsed);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => getUiPrefs().collapsedPhases);
  const location = useLocation();
  const loc = location.pathname + location.search;
  const locRef = useRef(loc);
  const firstRoute = useRef(true);
  const sidebarRef = useRef<HTMLElement>(null);
  const { unlocked } = companyUnlocked(p, TOPICS);
  const guide = useGuide();
  const outlet = useOutlet();
  const navigate = useNavigate();
  const { queue: newBadges, dismiss: dismissUnlocked } = useAchievementDetection(p);
  const viewAllAchievements = useCallback(() => {
    dismissUnlocked();
    navigate('/achievements');
  }, [dismissUnlocked, navigate]);
  // unlocks wait while the guide is open (e.g. the first-visit tour)
  const showUnlocked = newBadges.length > 0 && !guide.tour;

  useEffect(() => {
    locRef.current = loc;
  }, [loc]);

  useEffect(() => applyThemeAttrs(p.settings), [p.settings]);

  // track the OS preference so the toggle icon is right while theme = 'system'
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const isDark = p.settings.theme === 'dark' || (p.settings.theme === 'system' && systemDark);

  useEffect(() => saveUiPrefs({ sidebarCollapsed }), [sidebarCollapsed]);
  useEffect(() => saveUiPrefs({ collapsedPhases: collapsed }), [collapsed]);
  useEffect(() => {
    saveUiPrefs(loc === '/' ? { lastLocation: loc } : { lastLocation: loc, lastStudyLocation: stableLocation(loc) });
  }, [loc]);

  // First visit: open the welcome tour once.
  useEffect(() => {
    if (!getUiPrefs().tourSeen) openTour();
  }, []);

  // the syllabus sits beside lessons, not beside a running exam
  const syllabusPage = location.pathname.startsWith('/topic/') && !location.pathname.endsWith('/exam');

  // ⌘K / Ctrl+K toggles the command palette; "?" opens the guide; "/" focuses the topic filter (when it is on screen).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (guide.palette) closePalette();
        else openPalette();
        return;
      }
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
      if (typing || e.metaKey || e.ctrlKey || e.altKey || guide.tour || guide.palette) return;
      if (e.key === '?') {
        e.preventDefault();
        openTour();
      } else if (e.key === '/') {
        const input = document.getElementById('topic-filter') as HTMLInputElement | null;
        if (input && input.offsetParent !== null && getComputedStyle(input).visibility !== 'hidden') {
          e.preventDefault();
          input.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guide.palette, guide.tour]);

  // New page → close the drawer (adjusted during render, not in an effect).
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setNavOpen(false);
  }
  // New page → top of page, except on app start, where we restore the saved scroll position.
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      const saved = getUiPrefs().lastScroll;
      if (saved && saved.loc === locRef.current) {
        requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: saved.y })));
        return;
      }
    }
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Scroll-triggered reveals: re-measure once the new route has mounted and settled, and once the web fonts load.
  useEffect(() => {
    const call = refreshSoon(0.5);
    return () => {
      call.kill();
    };
  }, [location.pathname]);
  useEffect(() => {
    document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => {});
  }, []);

  // Remember how far down the current page the user has read.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => saveUiPrefs({ lastScroll: { loc: locRef.current, y: Math.round(window.scrollY) } }), 200);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Escape closes the drawer.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // Keep the active topic visible inside the syllabus.
  useEffect(() => {
    const aside = sidebarRef.current;
    const active = aside?.querySelector<HTMLElement>('.side-topic.active');
    if (aside && active && (active.offsetTop < aside.scrollTop || active.offsetTop > aside.scrollTop + aside.clientHeight - 40)) {
      aside.scrollTop = active.offsetTop - aside.clientHeight / 3;
    }
  }, [location.pathname, navOpen]);

  const toggleNav = () => {
    if (isCompact() || !syllabusPage) setNavOpen((o) => !o);
    else setSidebarCollapsed((c) => !c);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOPICS;
    return TOPICS.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.subtitle.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [query]);

  const weakCount = Object.values(p.mcq).filter((r) => !r.lastCorrect).length;
  const passedCount = TOPICS.filter((t) => topicStatus(p, t) === 'passed').length;
  // 81 topics: phases start folded except the one being read; a phase you open or close yourself stays that way
  const routeTopic = /^\/topic\/([^/]+)/.exec(location.pathname)?.[1];
  const routePhase = routeTopic ? TOPIC_BY_ID.get(routeTopic)?.phase : undefined;
  const lockIcon = unlocked ? <LockOpen size={13} aria-label="unlocked" /> : <Lock size={13} aria-label="locked" />;

  return (
    <div className={`shell ${syllabusPage ? 'has-syllabus' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* hash routing owns the URL fragment, so the skip link moves focus itself instead of using href="#main" */}
      <a
        className="skip-link"
        href="#/"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <button
          className={`btn-ghost nav-toggle ${syllabusPage ? 'nav-toggle-syllabus' : ''}`}
          onClick={toggleNav}
          aria-label={syllabusPage ? 'Toggle the syllabus' : 'Open the menu'}
          aria-expanded={navOpen}
          title={syllabusPage ? (sidebarCollapsed ? 'Show syllabus' : 'Hide syllabus') : 'Menu'}
          type="button"
        >
          <Menu size={20} aria-hidden />
        </button>
        <Link to="/" className="brand" aria-label="System Design Interview Prep, overview">
          <BrandMark />
          <span className="brand-name">System Design</span>
        </Link>
        <nav className="topnav" aria-label="Main">
          <TopNavLink to="/" end>
            Overview
          </TopNavLink>
          <TopNavLink to="/contents">Contents</TopNavLink>
          <TopNavLink to="/weak-areas">
            Weak areas
            {weakCount > 0 && (
              <span className="count-tag fail" aria-label={`, ${weakCount} questions to revisit`}>
                {weakCount}
              </span>
            )}
          </TopNavLink>
          <span className="topnav-sep" aria-hidden />
          <TopNavLink to="/practice">Practice</TopNavLink>
          <TopNavLink to="/companies">Company track {lockIcon}</TopNavLink>
        </nav>
        <div className="topbar-right">
          <span className="topbar-report" title="Topics whose timed exam you have passed">
            <span className="report-pass">{passedCount}</span>/{TOPICS.length} passed
          </span>
          <button type="button" className="btn-ghost guide-btn" onClick={openTour} title="Open the guide (press ?)">
            Guide me
          </button>
          <button
            type="button"
            className="btn-ghost icon-btn theme-toggle"
            onClick={() => setSettings({ theme: isDark ? 'light' : 'dark' })}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
          </button>
          <NavLink to="/achievements" className="btn-ghost icon-btn topbar-ach" aria-label="Achievements" title="Achievements">
            <Award size={18} aria-hidden />
          </NavLink>
          <NavLink to="/settings" className="btn-ghost icon-btn" aria-label="Settings" title="Settings">
            <SettingsIcon size={18} aria-hidden />
          </NavLink>
        </div>
      </header>

      <aside ref={sidebarRef} className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="Syllabus">
        <div className="drawer-head">
          <span className="drawer-label">Menu</span>
          <button type="button" className="btn-ghost icon-btn" onClick={() => setNavOpen(false)} aria-label="Close the menu">
            <X size={18} aria-hidden />
          </button>
        </div>
        <nav className="drawer-nav" aria-label="Main (menu)">
          <NavLink to="/" end className="drawer-link">
            <LayoutDashboard size={16} aria-hidden /> Overview
          </NavLink>
          <NavLink to="/contents" className="drawer-link">
            <ListTree size={16} aria-hidden /> Contents
          </NavLink>
          <NavLink to="/weak-areas" className="drawer-link">
            <Target size={16} aria-hidden /> Weak areas{weakCount > 0 && <span className="count-tag fail">{weakCount}</span>}
          </NavLink>
          <div className="drawer-label">Practice</div>
          <NavLink to="/practice" className="drawer-link">
            <Dumbbell size={16} aria-hidden /> Practice mistakes
          </NavLink>
          <NavLink to="/companies" className="drawer-link">
            <Building2 size={16} aria-hidden /> Company track ({COMPANY_QUESTIONS.length}) {lockIcon}
          </NavLink>
          <NavLink to="/achievements" className="drawer-link">
            <Award size={16} aria-hidden /> Achievements
          </NavLink>
          <NavLink to="/settings" className="drawer-link">
            <SettingsIcon size={16} aria-hidden /> Settings
          </NavLink>
        </nav>
        <div className="syllabus-head">
          <span className="syllabus-title">Syllabus</span>
          <span className="syllabus-legend" aria-hidden>
            <span className="st-mark st-mark-passed" /> passed <span className="st-mark st-mark-in-progress" /> started <span className="st-mark" /> new
          </span>
        </div>
        <input
          id="topic-filter"
          className="search"
          type="search"
          placeholder={`Filter ${TOPICS.length} topics, tags…`}
          aria-label="Filter topics (press / to focus)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <nav aria-label="Topics by phase">
          {query.trim() && filtered.length === 0 && (
            <p className="side-empty">
              No topic matches “{query}”. Try a tag such as <em>kafka</em>, or{' '}
              <button type="button" className="link-btn" onClick={openPalette}>
                search section headings
              </button>
              .
            </p>
          )}
          {PHASES.map((ph) => {
            const topics = filtered.filter((t) => t.phase === ph.id);
            if (!topics.length) return null;
            const isCollapsed = !query.trim() && (collapsed[ph.id] ?? ph.id !== routePhase);
            const phPassed = topics.filter((t) => topicStatus(p, t) === 'passed').length;
            return (
              <div key={ph.id} className="side-phase">
                <button
                  className="side-phase-title"
                  onClick={() => setCollapsed((c) => ({ ...c, [ph.id]: !isCollapsed }))}
                  type="button"
                  aria-expanded={!isCollapsed}
                >
                  <span className="side-phase-num">{phaseCode(ph.number)}</span>
                  <span className="side-phase-name">{ph.title}</span>
                  <span className="side-phase-count">
                    {phPassed}/{topics.length}
                  </span>
                  <ChevronDown size={14} aria-hidden className={`chev-icon ${isCollapsed ? 'closed' : ''}`} />
                </button>
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      className="side-phase-list"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                    >
                      {topics.map((t) => {
                        const st = topicStatus(p, t);
                        const pct = topicCompletion(p, t);
                        return (
                          <NavLink key={t.id} to={`/topic/${t.id}`} className="side-link side-topic">
                            <span className={`st-mark st-mark-${st}`} aria-hidden />
                            <span className="side-topic-body">
                              <span className="side-topic-title">{t.title}</span>
                              <span className={`side-topic-bar side-topic-bar-${st}`} aria-hidden>
                                <span style={{ width: `${pct}%` }} />
                              </span>
                            </span>
                            <span className="side-topic-pct" aria-hidden>
                              {pct}%
                            </span>
                            <span className="sr-only">
                              , {STATUS_LABEL[st]}, {pct}% complete
                            </span>
                          </NavLink>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>
        <div className="side-phase side-final">
          <div className="side-phase-title">
            <span className="side-phase-name">Final track</span>
          </div>
          <NavLink to="/companies" className="side-link side-company">
            <span className="side-code">{lockIcon}</span>
            <span className="side-topic-title">Company questions ({COMPANY_QUESTIONS.length})</span>
          </NavLink>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />}

      <main className="main" id="main" tabIndex={-1}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            className="route"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.06 } }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <RouteMotion>{outlet}</RouteMotion>
          </motion.div>
        </AnimatePresence>
        <Footer />
      </main>

      <CelebrationWatcher />
      <Toaster />
      <AnimatePresence>{guide.tour && <WelcomeTour key="tour" />}</AnimatePresence>
      {guide.palette && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
      {showUnlocked && (
        <Suspense fallback={null}>
          <AchievementCelebration items={newBadges} onClose={dismissUnlocked} onViewAll={viewAllAchievements} />
        </Suspense>
      )}
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {!showUnlocked
          ? ''
          : newBadges.length === 1
            ? `Achievement unlocked: ${achievementById[newBadges[0].id]?.name}${TIER_LABEL[newBadges[0].tier] ? `, ${TIER_LABEL[newBadges[0].tier]} tier` : ''}`
            : `You've earned ${newBadges.length} achievements`}
      </div>
    </div>
  );
}

/** A main-nav link whose active state is a pill that slides between links (Framer Motion layoutId). */
function TopNavLink({ to, end, children }: { to: string; end?: boolean; children: ReactNode }) {
  return (
    <NavLink to={to} end={end} className="topnav-link">
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="topnav-pill" className="topnav-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
          {children}
        </>
      )}
    </NavLink>
  );
}
