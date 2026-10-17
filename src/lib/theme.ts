import type { Accent, Settings } from './progress';

/** Accent families (Settings → Accent). Ids are the saved setting values from earlier versions, so old saves keep working. */
export const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'indigo', label: 'Cobalt' },
  { id: 'teal', label: 'Lagoon' },
  { id: 'rose', label: 'Garnet' },
  { id: 'amber', label: 'Copper' },
];

/** Mirror the theme + accent settings onto <html> (CSS tokens key off data-theme / data-accent). */
export function applyThemeAttrs(s: Pick<Settings, 'theme' | 'accent'>) {
  const root = document.documentElement;
  if (s.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
  root.setAttribute('data-accent', s.accent ?? 'indigo');
}
