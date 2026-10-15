// ⌘K command palette (lazy-loaded): jump to any page, topic, section, company question or capstone.
import { useCallback, useMemo, useRef, useState, type ComponentType } from 'react';
import { Command, defaultFilter } from 'cmdk';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BookOpen,
  Building,
  Clock,
  Compass,
  Dumbbell,
  FileText,
  Hammer,
  LayoutDashboard,
  ListTree,
  Moon,
  Search,
  Settings,
  SunMoon,
  Target,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { COMPANIES, COMPANY_QUESTIONS, PHASES, TOPICS, TOPIC_BY_ID } from '../content';
import { PROJECTS } from '../content/projects';
import { getProgress, setSettings, useProgress } from '../lib/progress';
import { nextStep } from '../lib/nextStep';
import { companyUnlocked } from '../lib/stats';
import { closePalette, openTour } from '../lib/guide';
import { getUiPrefs, saveUiPrefs, useUiPrefs, type RecentCommand } from '../lib/uiPrefs';
import { useFocusTrap } from '../lib/useFocusTrap';

const PHASE_TITLE = new Map(PHASES.map((ph) => [ph.id as string, `Phase ${ph.number}`]));

type Icon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;

interface Item {
  id: string;
  label: string;
  hint?: string;
  href: string;
  keywords?: string[];
  icon: Icon;
}

const PAGES: Item[] = [
  { id: 'page:home', label: 'Dashboard', href: '/', icon: LayoutDashboard, keywords: ['home', 'progress'] },
  { id: 'page:contents', label: 'Contents', hint: 'everything in this course', href: '/contents', icon: ListTree, keywords: ['index', 'syllabus'] },
  { id: 'page:weak', label: 'Weak Areas', href: '/weak-areas', icon: Target, keywords: ['mistakes', 'revise'] },
  { id: 'page:practice', label: 'Practice', hint: 'drill missed exam questions', href: '/practice', icon: Dumbbell, keywords: ['drill', 'mistakes'] },
  { id: 'page:companies', label: 'Company track', href: '/companies', icon: Building, keywords: ['mock', 'interview'] },
  { id: 'page:settings', label: 'Settings', href: '/settings', icon: Settings, keywords: ['theme', 'pass mark', 'reset'] },
];

/**
 * Ranking: every word found in the label beats words found only in tags/hints, which beats a fuzzy match.
 * keywords[0] is always the item's label.
 */
function rank(value: string, search: string, keywords?: string[]): number {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const label = (keywords?.[0] ?? value).toLowerCase();
  if (words.every((w) => label.includes(w))) {
    const starts = words.every((w) => label.includes(` ${w}`) || label.startsWith(w) || label.includes(`›${w}`) || label.includes(`› ${w}`));
    return starts ? 1 : 0.9;
  }
  const all = (keywords ?? []).join(' ').toLowerCase();
  if (words.every((w) => all.includes(w))) return 0.6;
  return defaultFilter(label, search) * 0.4;
}

export default function CommandPalette() {
  const nav = useNavigate();
  const p = useProgress();
  const prefs = useUiPrefs();
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, closePalette);

  const topics = useMemo<Item[]>(
    () =>
      TOPICS.map((t) => ({
        id: `topic:${t.id}`,
        label: t.title,
        hint: `${PHASE_TITLE.get(t.phase) ?? ''}`,
        href: `/topic/${t.id}`,
        icon: BookOpen,
        keywords: t.tags,
      })),
    [],
  );
  const sections = useMemo<Item[]>(
    () =>
      TOPICS.flatMap((t) =>
        t.sections.map((s, i) => ({
          id: `section:${t.id}:${i}`,
          label: `${t.title} › ${s.heading}`,
          href: `/topic/${t.id}?tab=learn&s=${i}`,
          icon: FileText,
        })),
      ),
    [],
  );
  const unlocked = companyUnlocked(p, TOPICS).unlocked;
  const company = useMemo<Item[]>(
    () =>
      COMPANY_QUESTIONS.map((q) => ({
        id: `company:${q.id}`,
        label: q.title,
        hint: `${COMPANIES.find((c) => c.id === q.company)?.name ?? q.company}${unlocked ? '' : ' · locked'}`,
        href: `/companies/${q.id}`,
        icon: Building,
      })),
    [unlocked],
  );
  const capstones = useMemo<Item[]>(
    () =>
      PROJECTS.flatMap((pr) => {
        const t = pr.topics.map((id) => TOPIC_BY_ID.get(id)).find(Boolean);
        return t ? [{ id: `capstone:${pr.id}`, label: pr.title, hint: `capstone · ${t.title}`, href: `/topic/${t.id}?tab=capstone`, icon: Hammer }] : [];
      }),
    [],
  );
  const recent = (prefs.recentCommands ?? []).slice(0, 5);

  const go = useCallback(
    (item: RecentCommand) => {
      const rest = (getUiPrefs().recentCommands ?? []).filter((r) => r.id !== item.id);
      saveUiPrefs({ recentCommands: [{ id: item.id, label: item.label, href: item.href }, ...rest].slice(0, 8) });
      closePalette();
      nav(item.href);
    },
    [nav],
  );

  const isDark =
    p.settings.theme === 'dark' || (p.settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const q = search.trim();

  const row = (item: Item, prefix = '') => {
    const Icon = item.icon;
    return (
      <Command.Item key={prefix + item.id} value={prefix + item.id} keywords={[item.label, item.hint ?? '', ...(item.keywords ?? [])]} onSelect={() => go(item)}>
        <Icon size={16} aria-hidden />
        <span className="cmdk-label">{item.label}</span>
        {item.hint && <span className="cmdk-hint">{item.hint}</span>}
      </Command.Item>
    );
  };

  return (
    <div className="modal-backdrop cmdk-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
      <motion.div
        ref={ref}
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        <Command label="Command palette" loop filter={rank}>
          <div className="cmdk-input-row">
            <Search size={18} aria-hidden />
            <Command.Input value={search} onValueChange={setSearch} placeholder="Search topics, sections, company questions…" data-autofocus />
            <button type="button" className="cmdk-close" onClick={closePalette} aria-label="Close search">
              <kbd>Esc</kbd>
            </button>
          </div>
          <Command.List>
            <Command.Empty>No results. Try a shorter word.</Command.Empty>
            {!q && recent.length > 0 && (
              <Command.Group heading="Recent">
                {recent.map((r) => row({ ...r, icon: Clock }, 'recent:'))}
              </Command.Group>
            )}
            <Command.Group heading="Actions">
              <Command.Item
                value="action:next"
                keywords={['next step', 'continue', 'what now']}
                onSelect={() => {
                  const s = nextStep(getProgress(), TOPICS, { companyTotal: COMPANY_QUESTIONS.length });
                  go({ id: 'action:next', label: 'Go to my next step', href: s.href });
                }}
              >
                <ArrowRight size={16} aria-hidden />
                <span className="cmdk-label">Go to my next step</span>
              </Command.Item>
              <Command.Item
                value="action:guide"
                keywords={['guide', 'tour', 'help', 'how']}
                onSelect={() => {
                  closePalette();
                  openTour();
                }}
              >
                <Compass size={16} aria-hidden />
                <span className="cmdk-label">Open the guide</span>
              </Command.Item>
              <Command.Item
                value="action:theme"
                keywords={['theme', 'dark', 'light', 'mode']}
                onSelect={() => {
                  setSettings({ theme: isDark ? 'light' : 'dark' });
                  closePalette();
                }}
              >
                {isDark ? <SunMoon size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
                <span className="cmdk-label">Switch to {isDark ? 'light' : 'dark'} mode</span>
              </Command.Item>
            </Command.Group>
            <Command.Group heading="Pages">{PAGES.map((i) => row(i))}</Command.Group>
            <Command.Group heading="Topics">{topics.map((i) => row(i))}</Command.Group>
            {q.length >= 2 && <Command.Group heading="Sections">{sections.map((i) => row(i))}</Command.Group>}
            {company.length > 0 && <Command.Group heading="Company questions">{company.map((i) => row(i))}</Command.Group>}
            {capstones.length > 0 && <Command.Group heading="Capstone projects">{capstones.map((i) => row(i))}</Command.Group>}
          </Command.List>
          <div className="cmdk-foot small muted">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> move
            </span>
            <span>
              <kbd>Enter</kbd> open
            </span>
            <span>Sections appear once you type 2+ letters</span>
          </div>
        </Command>
      </motion.div>
    </div>
  );
}
