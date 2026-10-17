import type { Accent, Settings } from './progress';

/** Pen inks (Settings → Ink). Ids are the saved setting values from earlier versions, so old saves keep working. */
export const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'indigo', label: 'Blue-black' },
  { id: 'teal', label: 'Teal' },
  { id: 'rose', label: 'Plum' },
  { id: 'amber', label: 'Graphite' },
];

/** Mirror the theme + accent settings onto <html> (CSS tokens key off data-theme / data-accent). */
export function applyThemeAttrs(s: Pick<Settings, 'theme' | 'accent'>) {
  const root = document.documentElement;
  if (s.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
  root.setAttribute('data-accent', s.accent ?? 'indigo');
}
