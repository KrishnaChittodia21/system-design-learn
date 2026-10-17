import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';

/** Circular progress indicator (SVG stroke), animated when the value changes. */
export function ProgressRing({
  value,
  size = 40,
  stroke = 4,
  tone,
  label,
  gradient,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: 'good' | 'warn';
  /** accessible label, e.g. "Topic 40% complete" */
  label?: string;
  /** stroke with the accent button gradient (hero ring) */
  gradient?: boolean;
  children?: ReactNode;
}) {
  const gid = useId();
  const v = Math.min(100, Math.max(0, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span
      className={`ring ${tone ? `ring-${tone}` : ''}`}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {gradient && (
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--btn-from)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--btn-to)' }} />
            </linearGradient>
          </defs>
        )}
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <motion.circle
          className="ring-fill"
          style={gradient && !tone ? { stroke: `url(#${CSS.escape(gid)})` } : undefined}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="butt"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (v / 100) * c }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children !== undefined && <span className="ring-center">{children}</span>}
    </span>
  );
}
