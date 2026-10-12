import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { COMPANY_QUESTIONS, PHASES, TOPICS } from '../content';
import { setSettings, useProgress } from '../lib/progress';
import { companyUnlocked, topicStatus } from '../lib/stats';
import { getUiPrefs, saveUiPrefs } from '../lib/uiPrefs';

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

  useEffect(() => {
    const root = document.documentElement;
    if (p.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', p.settings.theme);
  }, [p.settings.theme]);

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
  useEffect(() => saveUiPrefs({ lastLocation: loc }), [loc]);

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
  const setAllPhases = (value: boolean) => setCollapsed(Object.fromEntries(PHASES.map((ph) => [ph.id, value])));

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
          ☰
        </button>
        <NavLink to="/" className="brand">
          <span className="brand-mark">◆</span> System Design <span className="brand-sub">Interview Prep</span>
        </NavLink>
        <div className="topbar-right">
          <span className="pill">
            {passedCount}/{TOPICS.length} passed
          </span>
          <button
            type="button"
            className="btn-ghost theme-toggle"
            onClick={() => setSettings({ theme: isDark ? 'light' : 'dark' })}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
          <NavLink to="/settings" className="btn-ghost">
            Settings
          </NavLink>
        </div>
      </header>

      <aside ref={sidebarRef} className={`sidebar ${navOpen ? 'open' : ''}`}>
        <input
          className="search"
          placeholder="Search topics, tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="side-tools">
          <button type="button" className="link-btn small" onClick={() => setAllPhases(true)}>
            Collapse all
          </button>
          <span className="muted small">·</span>
          <button type="button" className="link-btn small" onClick={() => setAllPhases(false)}>
            Expand all
          </button>
          <button type="button" className="link-btn small side-hide" onClick={toggleNav}>
            Hide sidebar ⟨
          </button>
        </div>
        <nav>
          <NavLink to="/" end className="side-link">
            Dashboard
          </NavLink>
          <NavLink to="/weak-areas" className="side-link">
            Weak Areas{weakCount > 0 && <span className="side-badge">{weakCount}</span>}
          </NavLink>
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
                >
                  <span>
                    {ph.number}. {ph.title}
                  </span>
                  <span className="muted">{isCollapsed ? '▸' : '▾'}</span>
                </button>
                {!isCollapsed &&
                  topics.map((t) => (
                    <NavLink key={t.id} to={`/topic/${t.id}`} className="side-link side-topic">
                      <span className={`dot dot-${topicStatus(p, t)}`} />
                      {t.title}
                    </NavLink>
                  ))}
              </div>
            );
          })}
          <div className="side-phase">
            <div className="side-phase-title static">Final Track</div>
            <NavLink to="/companies" className="side-link side-topic">
              <span className="lock">{unlocked ? '🔓' : '🔒'}</span>
              Company Questions ({COMPANY_QUESTIONS.length})
            </NavLink>
          </div>
        </nav>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
