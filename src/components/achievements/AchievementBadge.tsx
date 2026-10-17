import { useId, type ComponentType, type SVGProps } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Activity,
  Award,
  BadgeCheck,
  Blocks,
  BookOpen,
  Boxes,
  Briefcase,
  Bug,
  Building,
  Calculator,
  Code,
  Compass,
  Crown,
  Database,
  Gauge,
  HeartPulse,
  KeyRound,
  Layers,
  ListChecks,
  Lock,
  Medal,
  MessagesSquare,
  Mic,
  Moon,
  Mountain,
  Network,
  Puzzle,
  Rocket,
  RotateCcw,
  Scaling,
  Send,
  Server,
  ShieldCheck,
  Siren,
  Target,
  Trophy,
  Users,
  Waypoints,
  Workflow,
  Zap,
} from 'lucide-react';
import { TIER_LABEL, tierRank, type ArtKey, type TierStep } from '../../content/achievements';

type Glyph = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

/** glyph keys used by src/content/achievements.ts → lucide icons */
const ART: Record<ArtKey, Glyph> = {
  send: Send,
  'check-badge': BadgeCheck,
  calculator: Calculator,
  mic: Mic,
  book: BookOpen,
  scaling: Scaling,
  compass: Compass,
  blocks: Blocks,
  network: Network,
  zap: Zap,
  database: Database,
  waypoints: Waypoints,
  workflow: Workflow,
  shield: ShieldCheck,
  key: KeyRound,
  server: Server,
  siren: Siren,
  boxes: Boxes,
  puzzle: Puzzle,
  list: ListChecks,
  users: Users,
  crown: Crown,
  code: Code,
  gauge: Gauge,
  briefcase: Briefcase,
  mountain: Mountain,
  bug: Bug,
  target: Target,
  rocket: Rocket,
  trophy: Trophy,
  heart: HeartPulse,
  activity: Activity,
  moon: Moon,
  rotate: RotateCcw,
  layers: Layers,
  medal: Medal,
  building: Building,
  messages: MessagesSquare,
};

const SIZES = { sm: 44, md: 76, lg: 148 } as const;

// pointy-top hexagons in a 100 × 112 box
const hex = (cx: number, cy: number, r: number) =>
  [-90, -30, 30, 90, 150, 210]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    })
    .join(' ');
const OUTER = hex(50, 52, 44);
const INNER = hex(50, 52, 35);
const RIBBON = 'M10 84 L90 84 L84 93 L90 102 L10 102 L16 93 Z';

interface Props {
  art: ArtKey;
  tier?: TierStep;
  locked?: boolean;
  size?: keyof typeof SIZES;
  /** expose it as an image to assistive tech; otherwise it is decorative */
  label?: string;
  /** a light sweep across the face (celebration only; off for reduced motion) */
  shine?: boolean;
  className?: string;
}

/**
 * Achievement medallion: a hexagon with a tier-coloured metal rim, the glyph on the face, a ribbon with the
 * tier name (md / lg) or an x2–x4 multiplier (sm), and, when locked, greyscale plus a lock mark.
 */
export default function AchievementBadge({ art, tier = 'standard', locked = false, size = 'md', label, shine = false, className = '' }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const reduce = useReducedMotion();
  const t = locked ? 'locked' : tier;
  const v = (part: string) => `var(--tier-${t}-${part})`;
  const Glyph = ART[art] ?? Award;
  const px = SIZES[size];
  const showRibbon = !locked && tier !== 'standard';
  const ribbonText = size !== 'sm' && showRibbon ? TIER_LABEL[tier].toUpperCase() : '';
  // GitHub-style multiplier on small badges: x2, x3, x4 for the higher tiers
  const mult = size === 'sm' && showRibbon && tierRank(tier) > 0 ? `x${tierRank(tier) + 1}` : '';

  return (
    <svg
      className={`ach-badge ach-badge-${size} ${locked ? 'is-locked' : ''} ${className}`}
      viewBox="0 0 100 112"
      width={px}
      height={(px * 112) / 100}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: 'false' })}
    >
      <defs>
        <linearGradient id={`rim-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: v('hi') }} />
          <stop offset="0.55" style={{ stopColor: v('lo') }} />
          <stop offset="1" style={{ stopColor: v('hi') }} />
        </linearGradient>
        <linearGradient id={`shine-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--tier-shine)', stopOpacity: 0 }} />
          <stop offset="0.5" style={{ stopColor: 'var(--tier-shine)' }} />
          <stop offset="1" style={{ stopColor: 'var(--tier-shine)', stopOpacity: 0 }} />
        </linearGradient>
        <clipPath id={`clip-${uid}`}>
          <polygon points={OUTER} />
        </clipPath>
      </defs>

      {/* rim (the round join softens the corners) and a flat paper face */}
      <polygon points={OUTER} fill={`url(#rim-${uid})`} stroke={`url(#rim-${uid})`} strokeWidth="8" strokeLinejoin="round" />
      <polygon points={INNER} fill={v('face')} stroke={v('lo')} strokeOpacity="0.5" strokeWidth="1.5" strokeLinejoin="round" />
      <Glyph x={31} y={33} width={38} height={38} color={v('ink')} strokeWidth={2} aria-hidden />

      {shine && !reduce && !locked && (
        <g clipPath={`url(#clip-${uid})`}>
          <g transform="skewX(-18)">
            <motion.rect
              y="-10"
              width="34"
              height="130"
              fill={`url(#shine-${uid})`}
              initial={{ x: -60 }}
              animate={{ x: 150 }}
              transition={{ duration: 1.1, delay: 0.55, ease: 'easeInOut', repeat: Infinity, repeatDelay: 2.6 }}
            />
          </g>
        </g>
      )}

      {showRibbon && (
        <g>
          <path d={RIBBON} fill={v('ribbon')} />
          {ribbonText && (
            <text x="50" y="96.4" textAnchor="middle" className="ach-badge-ribbon-text" fill="var(--tier-ribbon-text)">
              {ribbonText}
            </text>
          )}
        </g>
      )}
      {mult && (
        <g>
          <rect x="62" y="82" width="34" height="22" rx="11" fill={v('ribbon')} stroke="var(--surface)" strokeWidth="2.5" />
          <text x="79" y="97.5" textAnchor="middle" className="ach-badge-mult" fill="var(--tier-ribbon-text)">
            {mult}
          </text>
        </g>
      )}
      {locked && (
        <g>
          <circle cx="78" cy="88" r="13" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="2" />
          <Lock x={70} y={80} width={16} height={16} color="var(--muted)" strokeWidth={2.4} aria-hidden />
        </g>
      )}
    </svg>
  );
}
