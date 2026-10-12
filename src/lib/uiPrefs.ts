// UI preferences (sidebar state, last page, scroll position). Kept separate from
// study progress so "Reset progress" doesn't wipe layout preferences.

export interface UiPrefs {
  sidebarCollapsed: boolean;
  collapsedPhases: Record<string, boolean>;
  /** pathname + search, e.g. "/topic/cache-failures?tab=learn" */
  lastLocation: string;
  lastScroll: { loc: string; y: number } | null;
}

const KEY = 'sdl-ui-v1';

const DEFAULT: UiPrefs = { sidebarCollapsed: false, collapsedPhases: {}, lastLocation: '/', lastScroll: null };

export function getUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<UiPrefs>) } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function saveUiPrefs(patch: Partial<UiPrefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getUiPrefs(), ...patch }));
  } catch {
    // storage blocked — preferences just won't persist
  }
}

/** Where to reopen the app on a fresh start, or null to stay on the dashboard. */
export function resumeLocation(): string | null {
  const loc = getUiPrefs().lastLocation;
  if (!loc || loc === '/') return null;
  // an in-progress exam can't be resumed, so reopen the topic's exam tab instead
  const exam = /^\/topic\/([^/?]+)\/exam/.exec(loc);
  if (exam) return `/topic/${exam[1]}?tab=exam`;
  if (loc.startsWith('/practice')) return '/weak-areas';
  return loc;
}
