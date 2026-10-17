/**
 * System Design's mark, in the same notebook family as QA Learn's: a page with a red margin rule and the smallest
 * system diagram written on it — a component, a connection, and the downstream component in pen ink.
 * Drawn with currentColor (ink) + the margin and accent tokens, so it follows the theme and the chosen ink.
 * The same drawing is the favicon (public/favicon.svg).
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect x="2.5" y="2.5" width="27" height="27" rx="3" fill="var(--surface)" stroke="currentColor" strokeWidth="2" />
      <path d="M9 3v26" stroke="var(--margin-rule)" strokeWidth="1.6" />
      <rect x="13" y="7.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M16.5 14.5v6h3.5" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <rect x="20" y="17" width="7" height="7" rx="1" fill="var(--accent)" />
    </svg>
  );
}
