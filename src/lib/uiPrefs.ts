// UI preferences (sidebar state, last page, scroll position, guide flags). Kept separate from
// study progress so "Reset progress" doesn't wipe layout preferences.
import { useSyncExternalStore } from 'react';

export interface RecentCommand {
  id: string;
  label: string;
  href: string;
}

export interface UiPrefs {
  sidebarCollapsed: boolean;
  collapsedPhases: Record<string, boolean>;
  /** pathname + search, e.g. "/topic/cache-failures?tab=learn" */
  lastLocation: string;
  lastScroll: { loc: string; y: number } | null;
  /** last study page (anything but the dashboard), for "Continue where you left off" */
  lastStudyLocation?: string;
  /** the welcome tour has been shown (finished or skipped) */
  tourSeen?: boolean;
  /** show the first-time coach tip on each tab type (default on) */
  coachTips?: boolean;
  /** coach tip id → dismissed */
  dismissedTips?: Record<string, true>;
  /** one-off celebrations already shown, e.g. "company-unlocked", "capstone:<id>" */
  celebrated?: Record<string, true>;
  /** command-palette items picked most recently, newest first */
  recentCommands?: RecentCommand[];
}

const KEY = 'sdl-ui-v1';

const DEFAULT: UiPrefs = { sidebarCollapsed: false, collapsedPhases: {}, lastLocation: '/', lastScroll: null };

function read(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<UiPrefs>) } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let cache: UiPrefs = read();
const listeners = new Set<() => void>();
// written on every navigation/scroll and never rendered reactively
const QUIET = new Set<string>(['lastLocation', 'lastScroll', 'lastStudyLocation']);

export function getUiPrefs(): UiPrefs {
  return cache;
}

export function saveUiPrefs(patch: Partial<UiPrefs>) {
  cache = { ...cache, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage blocked — preferences just won't persist
  }
  if (Object.keys(patch).some((k) => !QUIET.has(k))) listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive view of the UI prefs (re-renders on any change except navigation bookkeeping). */
export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(subscribe, () => cache);
}

export function dismissTip(id: string) {
  saveUiPrefs({ dismissedTips: { ...cache.dismissedTips, [id]: true } });
}

/** Mark a one-off celebration as shown; returns false if it was shown before. */
export function claimCelebration(key: string): boolean {
  if (cache.celebrated?.[key]) return false;
  saveUiPrefs({ celebrated: { ...cache.celebrated, [key]: true } });
  return true;
}

/** Where to reopen the app on a fresh start, or null to stay on the dashboard. */
export function resumeLocation(): string | null {
  const loc = getUiPrefs().lastLocation;
  if (!loc || loc === '/') return null;
  return stableLocation(loc);
}

/** An in-progress exam can't be resumed and practice drills are ephemeral, so map them to a stable page. */
export function stableLocation(loc: string): string {
  const exam = /^\/topic\/([^/?]+)\/exam/.exec(loc);
  if (exam) return `/topic/${exam[1]}?tab=exam`;
  if (loc.startsWith('/practice')) return '/weak-areas';
  return loc;
}
