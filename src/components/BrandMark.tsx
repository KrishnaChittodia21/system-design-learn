import { useId } from 'react';

/**
 * SysDesign.prep's mark (Blueprint Nebula): a rounded blueprint tile drawn with the brand gradient
 * (blue → cyan → amber) and a load balancer fanning one request out to three nodes.
 * Decorative: the accessible name lives on the link that wraps it.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  const id = `bm${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className="nb-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset=".55" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="none" stroke={`url(#${id})`} strokeWidth="1.8" />
      <path d="M9 16h5M14 16l6-6.5M14 16h6M14 16l6 6.5" fill="none" stroke={`url(#${id})`} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="16" r="2.6" fill="#22d3ee" />
      <circle cx="22" cy="9.5" r="2" fill="#60a5fa" />
      <circle cx="22" cy="16" r="2" fill="#22d3ee" />
      <circle cx="22" cy="22.5" r="2" fill="#fbbf24" />
    </svg>
  );
}

/** The "SysDesign.prep" wordmark (Unbounded; the dot takes the cyan signal colour). */
export function Wordmark() {
  return (
    <b className="nb-wordmark">
      SysDesign<span>.</span>prep
    </b>
  );
}
