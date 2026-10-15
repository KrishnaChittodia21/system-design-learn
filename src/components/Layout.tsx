import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  Compass,
  Diamond,
  LayoutDashboard,
  ListTree,
  Lock,
  LockOpen,
  Menu,
  Moon,
  Settings,
  Sun,
  Target,
} from 'lucide-react';
import { COMPANY_QUESTIONS, PHASES, TOPICS } from '../content';
import { setSettings, useProgress } from '../lib/progress';
import { companyUnlocked, topicStatus } from '../lib/stats';
import { getUiPrefs, saveUiPrefs, stableLocation } from '../lib/uiPrefs';
import { openPalette, openTour, closePalette, useGuide } from '../lib/guide';
import WelcomeTour from './WelcomeTour';
import { Toaster } from './Toaster';
import { CelebrationWatcher } from './CelebrationWatcher';
import { Footer } from './Footer';

// cmdk is only needed once the palette is opened
const CommandPalette = lazy(() => import('./CommandPalette'));
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

export default function Layout() {
  const p = useProgress();
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => getUiPrefs().sidebarCollapsed);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => getUiPrefs().collapsedPhases);
  const location = useLocation();
  const loc = location.pathname + location.search;
  const locRef = useRef(loc);
  locRef.current = loc;
  const firstRoute = useRef(true);
  const sidebarRef = useRef<HTMLElement>(null);
  const { unlocked } = companyUnlocked(p, TOPICS);
  const guide = useGuide();
  const outlet = useOutlet();

  useEffect(() => {
    const root = document.documentElement;
    if (p.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', p.settings.theme);
  }, [p.settings.theme]);

  // accent theme: indigo is the default token set, the others override a few tokens
  const accent = p.settings.accent ?? 'indigo';
  useEffect(() => {
    const root = document.documentElement;
    if (accent === 'indigo') root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', accent);
  }, [accent]);

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

  // ⌘K / Ctrl+K toggles the command palette; "?" opens the guide (when not typing).
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
      if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey && !guide.tour && !guide.palette) {
        e.preventDefault();
        openTour();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guide.palette, guide.tour]);

  // New page → top of page, except on app start, where we restore the saved scroll position.
  useEffect(() => {
    setNavOpen(false);
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

  // Keep the active topic visible inside the sidebar list.
  useEffect(() => {
    const aside = sidebarRef.current;
    const active = aside?.querySelector<HTMLElement>('.side-topic.active');
    if (aside && active && (active.offsetTop < aside.scrollTop || active.offsetTop > aside.scrollTop + aside.clientHeight - 40)) {
      aside.scrollTop = active.offsetTop - aside.clientHeight / 3;
    }
  }, [location.pathname]);

  const toggleNav = () => {
    if (isMobile()) setNavOpen((o) => !o);
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

  return (
    <div className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="topbar">
        <button
          className="btn-ghost nav-toggle"
          onClick={toggleNav}
          aria-label="Toggle topic sidebar"
          title={sidebarCollapsed ? 'Show topics' : 'Hide topics'}
          type="button"
        >
          <Menu size={20} aria-hidden />
        </button>
        <NavLink to="/" className="brand">
          <span className="brand-tile" aria-hidden>
            <Diamond size={15} strokeWidth={2.5} />
          </span>
          <span className="brand-name">System Design</span> <span className="brand-sub">Interview Prep</span>
        </NavLink>
        <div className="topbar-right">
          <span className="pill topbar-pill">
            {passedCount}/{TOPICS.length} passed
          </span>
          <button type="button" className="btn-ghost guide-btn" onClick={openTour} aria-label="Open the guide (?)" title="Guide (?)">
            <Compass size={18} aria-hidden />
            <span className="guide-btn-text">Guide</span>
          </button>
          <button
            type="button"
            className="btn-ghost btn-icon theme-toggle"
            onClick={() => setSettings({ theme: isDark ? 'light' : 'dark' })}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
          </button>
          <NavLink to="/settings" className="btn-ghost btn-icon" aria-label="Settings" title="Settings">
            <Settings size={18} aria-hidden />
          </NavLink>
        </div>
      </header>

      <aside ref={sidebarRef} className={`sidebar ${navOpen ? 'open' : ''}`}>
        <input
          className="search"
          aria-label="Filter topics"
          placeholder="Filter topics, tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <nav>
          <SideLink to="/" end>
            <LayoutDashboard size={16} aria-hidden /> Dashboard
          </SideLink>
          <SideLink to="/contents">
            <ListTree size={16} aria-hidden /> Contents
          </SideLink>
          <SideLink to="/weak-areas">
            <Target size={16} aria-hidden /> Weak Areas{weakCount > 0 && <span className="side-badge">{weakCount}</span>}
          </SideLink>
          {PHASES.map((ph) => {
            const topics = filtered.filter((t) => t.phase === ph.id);
            if (!topics.length) return null;
            const isCollapsed = collapsed[ph.id] && !query;
            return (
              <div key={ph.id} className="side-phase">
                <button
                  className="side-phase-title"
                  onClick={() => setCollapsed((c) => ({ ...c, [ph.id]: !c[ph.id] }))}
                  type="button"
                  aria-expanded={!isCollapsed}
                >
                  <span>
                    {ph.number}. {ph.title}
                  </span>
                  <ChevronDown size={14} aria-hidden className={`chev-icon ${isCollapsed ? 'closed' : ''}`} />
                </button>
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      key="topics"
                      className="side-topics"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                      {topics.map((t) => (
                        <SideLink key={t.id} to={`/topic/${t.id}`} className="side-topic">
                          <span className={`dot dot-${topicStatus(p, t)}`} />
                          {t.title}
                        </SideLink>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          <div className="side-phase">
            <div className="side-phase-title static">Final Track</div>
            <SideLink to="/companies" className="side-topic">
              <span className="lock">{unlocked ? <LockOpen size={14} aria-label="Unlocked" /> : <Lock size={14} aria-label="Locked" />}</span>
              Company Questions ({COMPANY_QUESTIONS.length})
            </SideLink>
          </div>
        </nav>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

      <main className="main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {outlet}
            <Footer />
          </motion.div>
        </AnimatePresence>
      </main>

      <CelebrationWatcher />
      <Toaster />
      <AnimatePresence>{guide.tour && <WelcomeTour key="tour" />}</AnimatePresence>
      {guide.palette && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
    </div>
  );
}

/** Sidebar link; the active one carries a soft accent pill that slides between items (shared layoutId). */
function SideLink({ to, end, className = '', children }: { to: string; end?: boolean; className?: string; children: ReactNode }) {
  return (
    <NavLink to={to} end={end} className={`side-link ${className}`}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="side-active" className="side-active" aria-hidden transition={{ type: 'spring', stiffness: 520, damping: 42 }} />}
          {children}
        </>
      )}
    </NavLink>
  );
}
