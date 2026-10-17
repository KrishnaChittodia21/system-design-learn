// "Where you left off": a readable label for a saved study location (uiPrefs.lastStudyLocation).
// Pure: content lookups are passed in, so it can be unit-tested without the content bundle.

export interface LocationLookup {
  topic: (id: string) => { title: string; sections: { heading: string }[] } | undefined;
  /** the topic tab's visible name (e.g. "Code Lab", or "Answer Lab" in the behavioural topics); undefined for unknown tabs */
  tabLabel: (topicId: string, tab: string) => string | undefined;
  /** company question title */
  companyQuestion: (id: string) => string | undefined;
}

export const PAGE_LABELS: Record<string, string> = {
  '/contents': 'Contents',
  '/weak-areas': 'Weak areas',
  '/practice': 'Practice',
  '/companies': 'Company track',
};

/** Human label, e.g. "Caching Patterns · Learn · §3 Write-through" or "Company track · Design a URL shortener". */
export function describeLocation(loc: string, look: LocationLookup): string | null {
  if (!loc) return null;
  const [path, search = ''] = loc.split('?');
  const params = new URLSearchParams(search);
  const topic = /^\/topic\/([^/]+)/.exec(path);
  if (topic) {
    const t = look.topic(topic[1]);
    if (!t) return null;
    const tab = params.get('tab') ?? 'learn';
    const tabName = look.tabLabel(topic[1], tab) ?? 'Learn';
    const s = Number(params.get('s'));
    const sec =
      tab === 'learn' && params.has('s') && Number.isInteger(s) && t.sections[s]
        ? ` · §${s + 1} ${t.sections[s].heading.split(' — ')[0].replace(/^\d+\.\s+/, '')}`
        : '';
    return `${t.title} · ${tabName}${sec}`;
  }
  const cq = /^\/companies\/([^/]+)$/.exec(path);
  if (cq) {
    const title = look.companyQuestion(cq[1]);
    return title ? `${PAGE_LABELS['/companies']} · ${title}` : PAGE_LABELS['/companies'];
  }
  return PAGE_LABELS[path] ?? null;
}

/** path + tab of a location; a topic without ?tab= opens on Learn */
function target(loc: string): string {
  const [path, search = ''] = loc.split('?');
  if (!/^\/topic\/[^/]+$/.test(path)) return path;
  return `${path}?tab=${new URLSearchParams(search).get('tab') ?? 'learn'}`;
}

/** true when the saved location opens the same page and tab as the next step (section index ignored) */
export function sameStudyTarget(a: string, b: string): boolean {
  return target(a) === target(b);
}
