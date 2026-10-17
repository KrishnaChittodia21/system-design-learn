/**
 * System Design's mark: a gradient tile (the accent's --brand-gradient) carrying the smallest system diagram —
 * a component, a wire, the downstream component, and an amber "signal" dot in the accent's counterpoint colour.
 * The tile follows the theme and the chosen accent. The same drawing is the favicon (public/favicon.svg).
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  const glyph = Math.round(size * 0.64);
  return (
    <span className="brand-tile" style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }} aria-hidden>
      <svg className="brand-mark" width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" focusable="false">
        <rect x="2.5" y="3" width="8.5" height="6.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M6.75 9.5v4.25a1.75 1.75 0 0 0 1.75 1.75H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="13" y="12.5" width="8.5" height="6.5" rx="1.8" fill="currentColor" />
        <circle cx="18" cy="5.75" r="2.3" fill="var(--accent-2)" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </span>
  );
}
