import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Award,
  Building2,
  ChevronDown,
  Compass,
  Dumbbell,
  Flame,
  Home as HomeIcon,
  LayoutGrid,
  ListTree,
  Lock,
  LockOpen,
  Moon,
  MoreHorizontal,
  Search,
  Settings as SettingsIcon,
  Sun,
  Target,
  X,
} from 'lucide-react';
import { COMPANY_QUESTIONS, PHASES, TOPICS, TOPIC_BY_ID } from '../content';
import { setSettings, useProgress } from '../lib/progress';
import { companyUnlocked, topicCompletion, topicStatus } from '../lib/stats';
import { studyStreak } from '../lib/streak';
import { getUiPrefs, saveUiPrefs, stableLocation } from '../lib/uiPrefs';
import { openPalette, openTour, closePalette, useGuide } from '../lib/guide';
import { applyThemeAttrs } from '../lib/theme';
import { phaseCode } from '../lib/labels';
import { useFocusTrap } from '../lib/useFocusTrap';
import WelcomeTour from './WelcomeTour';
import { Toaster } from './Toaster';
import { CelebrationWatcher } from './CelebrationWatcher';
import { Footer } from './Footer';
import { BrandMark, Wordmark } from './BrandMark';
import { RouteMotion } from './RouteMotion';
import { useAchievementDetection } from '../lib/useAchievements';
import { achievementById, TIER_LABEL } from '../content/achievements';
import { refreshSoon, ScrollTrigger } from '../lib/gsap';

// cmdk is only needed once the palette is opened
const CommandPalette = lazy(() => import('./CommandPalette'));
// the unlock dialog (and its badge art) loads on the first unlock
const AchievementCelebration = lazy(() => import('./achievements/AchievementCelebration'));

const STATUS_LABEL = { new: 'not started', 'in-progress': 'in progress', passed: 'exam passed' } as const;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * App shell (Blueprint Nebula): a fixed ambient stage (blueprint grid + aurora orbs), a floating glass top bar,
 * the syllabus as a drawer (button on lesson pages, and in the mobile "More" sheet), a frosted bottom tab bar
 * under 1100px, the routed page and the footer. Styles: src/styles/shell.css.
 */
export default function Layout() {
  const p = useProgress();
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => getUiPrefs().collapsedPhases);
  const location = useLocation();
  const loc = location.pathname + location.search;
  const locRef = useRef(loc);
  const firstRoute = useRef(true);
  const sidebarRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
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

  // track the OS preference so the toggle icon is right while theme = 'system' (Nebula: dark unless the OS asks for light)
  const [systemLight, setSystemLight] = useState(() => window.matchMedia('(prefers-color-scheme: light)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => setSystemLight(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const isDark = p.settings.theme === 'dark' || (p.settings.theme === 'system' && !systemLight);
  const toggleTheme = () => setSettings({ theme: isDark ? 'light' : 'dark' });

  useEffect(() => saveUiPrefs({ collapsedPhases: collapsed }), [collapsed]);
  useEffect(() => {
    saveUiPrefs(loc === '/' ? { lastLocation: loc } : { lastLocation: loc, lastStudyLocation: stableLocation(loc) });
  }, [loc]);

  // First visit: open the welcome tour once.
  useEffect(() => {
    if (!getUiPrefs().tourSeen) openTour();
  }, []);

  // the syllabus button sits beside lessons, not beside a running exam
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

  // New page → close the drawer and the sheet (adjusted during render, not in an effect).
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setNavOpen(false);
    setMoreOpen(false);
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

  // The drawer and the sheet are modal: trap focus, Escape closes, focus returns to the opener.
  const closeNav = useCallback(() => setNavOpen(false), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useFocusTrap(sidebarRef, navOpen, closeNav);
  useFocusTrap(moreRef, moreOpen, closeMore);

  // Keep the active topic visible inside the syllabus.
  useEffect(() => {
    const aside = sidebarRef.current;
    const active = aside?.querySelector<HTMLElement>('.side-topic.active');
    if (aside && active && (active.offsetTop < aside.scrollTop || active.offsetTop > aside.scrollTop + aside.clientHeight - 40)) {
      aside.scrollTop = active.offsetTop - aside.clientHeight / 3;
    }
  }, [location.pathname, navOpen]);

  const openSyllabus = () => {
    setMoreOpen(false);
    setNavOpen(true);
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
  const streak = studyStreak(p.activityDays);
  // 81 topics: phases start folded except the one being read; a phase you open or close yourself stays that way
  const routeTopic = /^\/topic\/([^/]+)/.exec(location.pathname)?.[1];
  const routePhase = routeTopic ? TOPIC_BY_ID.get(routeTopic)?.phase : undefined;
  const lockIcon = unlocked ? <LockOpen size={13} aria-label="unlocked" /> : <Lock size={13} aria-label="locked" />;
  const weakActive = location.pathname.startsWith('/weak-areas') || location.pathname.startsWith('/practice');
  const moreActive = ['/practice', '/achievements', '/settings'].some((r) => location.pathname.startsWith(r));
  const weakTag =
    weakCount > 0 ? (
      <span className="count-tag fail" aria-label={`, ${weakCount} questions to revisit`}>
        {weakCount}
      </span>
    ) : null;

  const themeLabel = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  const ThemeIcon = isDark ? Sun : Moon;

  return (
    <div className={`nb-shell ${navOpen ? 'drawer-open' : ''} ${syllabusPage ? 'has-syllabus-btn' : ''}`}>
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

      {/* ambient stage: blueprint grid + drifting aurora (fixed, decorative, no blur filters) */}
      <div className="nb-stage" aria-hidden>
        <div className="nb-grid" />
        <span className="nb-orb o1" />
        <span className="nb-orb o2" />
        <span className="nb-orb o3" />
        <span className="nb-orb o4" />
      </div>

      <header className="nb-top">
        <div className="nb-topbar glass">
          <Link to="/" className="nb-brand" aria-label="SysDesign.prep, today">
            <BrandMark />
            <Wordmark />
          </Link>
          <nav className="nb-nav" aria-label="Main">
            <TopNavLink to="/" end>
              Today
            </TopNavLink>
            <TopNavLink to="/contents">Contents</TopNavLink>
            <TopNavLink to="/companies">
              Companies <span className="nb-nav-lock">{lockIcon}</span>
            </TopNavLink>
            <TopNavLink to="/weak-areas" active={weakActive}>
              Weak areas
              {weakTag}
            </TopNavLink>
            <TopNavLink to="/achievements">Achievements</TopNavLink>
          </nav>
          <div className="nb-tools">
            {syllabusPage && (
              <button
                type="button"
                className="nb-iconbtn nb-syllabus-btn"
                onClick={openSyllabus}
                aria-label="Open the syllabus"
                aria-expanded={navOpen}
                title="Syllabus"
              >
                <ListTree size={18} aria-hidden />
                <span className="nb-syllabus-lbl">Syllabus</span>
              </button>
            )}
            <button type="button" className="nb-search" onClick={openPalette} aria-label="Search topics and sections" title="Search (⌘K)">
              <Search size={16} aria-hidden />
              <span className="nb-search-lbl">Search topics, sections</span>
              <kbd className="nb-search-kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            <span className="nb-streak" title={`Study streak: ${streak} day${streak === 1 ? '' : 's'} in a row`}>
              <Flame size={16} aria-hidden className="nb-streak-icon" />
              <span>
                {streak}
                <span className="nb-streak-lbl">-day streak</span>
                <span className="sr-only"> day study streak</span>
              </span>
            </span>
            <button type="button" className="nb-iconbtn nb-guide-btn" onClick={openTour} aria-label="Open the guide" title="Guide (press ?)">
              <Compass size={18} aria-hidden />
            </button>
            <button type="button" className="nb-iconbtn" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
              <ThemeIcon size={18} aria-hidden />
            </button>
            <NavLink to="/settings" className="nb-iconbtn nb-settings-btn" aria-label="Settings" title="Settings">
              <SettingsIcon size={18} aria-hidden />
            </NavLink>
          </div>
        </div>
      </header>

      <aside
        ref={sidebarRef}
        className={`nb-drawer ${navOpen ? 'open' : ''}`}
        aria-label="Syllabus"
        aria-hidden={!navOpen}
        inert={!navOpen}
        role="dialog"
        aria-modal={navOpen}
        tabIndex={-1}
      >
        <div className="nb-drawer-head">
          <div>
            <div className="eyebrow">Syllabus</div>
            <span className="syllabus-legend" aria-hidden>
              <span className="st-mark st-mark-passed" /> passed <span className="st-mark st-mark-in-progress" /> started{' '}
              <span className="st-mark" /> new
            </span>
          </div>
          <button type="button" className="nb-iconbtn" onClick={closeNav} aria-label="Close the syllabus">
            <X size={18} aria-hidden />
          </button>
        </div>
        <input
          id="topic-filter"
          className="nb-filter"
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
      {navOpen && <div className="nb-scrim" onClick={closeNav} aria-hidden />}

      <main className="nb-main" id="main" tabIndex={-1}>
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

      {/* under 1100px: frosted bottom tab bar; "More" opens a sheet with everything else */}
      <nav className="nb-tabbar glass" aria-label="Main (tabs)">
        <NavLink to="/" end className="nb-tab">
          <HomeIcon size={21} aria-hidden />
          <span>Today</span>
        </NavLink>
        <NavLink to="/contents" className="nb-tab">
          <LayoutGrid size={21} aria-hidden />
          <span>Contents</span>
        </NavLink>
        <NavLink to="/companies" className="nb-tab">
          <Building2 size={21} aria-hidden />
          <span>Companies</span>
        </NavLink>
        <NavLink to="/weak-areas" className={() => `nb-tab ${weakActive ? 'active' : ''}`} aria-current={weakActive ? 'page' : undefined}>
          <span className="nb-tab-icon">
            <Target size={21} aria-hidden />
            {weakCount > 0 && <span className="nb-tab-dot" aria-label={`${weakCount} questions to revisit`} />}
          </span>
          <span>Weak areas</span>
        </NavLink>
        <button
          type="button"
          className={`nb-tab ${moreActive || moreOpen ? 'active' : ''}`}
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
        >
          <MoreHorizontal size={21} aria-hidden />
          <span>More</span>
        </button>
      </nav>

      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              key="more-scrim"
              className="nb-scrim nb-sheet-scrim"
              onClick={closeMore}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              key="more-sheet"
              ref={moreRef}
              className="nb-sheet glass"
              role="dialog"
              aria-modal="true"
              aria-label="More"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 42 }}
            >
              <div className="nb-sheet-head">
                <span className="eyebrow">More</span>
                <button type="button" className="nb-iconbtn" onClick={closeMore} aria-label="Close">
                  <X size={18} aria-hidden />
                </button>
              </div>
              <div className="nb-sheet-grid">
                <SheetLink to="/practice" icon={<Dumbbell size={20} aria-hidden />} label="Practice" hint="Drill missed questions" />
                <SheetLink to="/achievements" icon={<Award size={20} aria-hidden />} label="Achievements" hint="Badges and streaks" />
                <SheetLink to="/settings" icon={<SettingsIcon size={20} aria-hidden />} label="Settings" hint="Theme, exam, data" />
                <SheetButton
                  onClick={() => {
                    closeMore();
                    openPalette();
                  }}
                  icon={<Search size={20} aria-hidden />}
                  label="Search"
                  hint="Topics and sections"
                />
                <SheetButton onClick={openSyllabus} icon={<ListTree size={20} aria-hidden />} label="Syllabus" hint="All topics by phase" />
                <SheetButton
                  onClick={() => {
                    closeMore();
                    openTour();
                  }}
                  icon={<Compass size={20} aria-hidden />}
                  label="Guide"
                  hint="How this course works"
                />
                <SheetButton onClick={toggleTheme} icon={<ThemeIcon size={20} aria-hidden />} label={isDark ? 'Light mode' : 'Dark mode'} hint="Switch theme" />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
function TopNavLink({ to, end, active, children }: { to: string; end?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `nb-nav-link ${(active ?? isActive) ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {({ isActive }) => (
        <>
          {(active ?? isActive) && (
            <motion.span layoutId="nb-nav-pill" className="nb-nav-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />
          )}
          {children}
        </>
      )}
    </NavLink>
  );
}

function SheetLink({ to, icon, label, hint }: { to: string; icon: ReactNode; label: string; hint: string }) {
  return (
    <NavLink to={to} className="nb-sheet-item">
      <span className="nb-sheet-ic">{icon}</span>
      <span>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
    </NavLink>
  );
}

function SheetButton({ onClick, icon, label, hint }: { onClick: () => void; icon: ReactNode; label: string; hint: string }) {
  return (
    <button type="button" className="nb-sheet-item" onClick={onClick}>
      <span className="nb-sheet-ic">{icon}</span>
      <span>
        <b>{label}</b>
        <small>{hint}</small>
      </span>
    </button>
  );
}
