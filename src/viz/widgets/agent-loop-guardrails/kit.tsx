// Small SVG drawing kit for the request-flow diagrams in this widget: component boxes, arrows
// between them with an optional travelling packet, and status pills. Colours are tokens only.
// Motion is CSS (kit.css), so prefers-reduced-motion simply leaves everything at its final place.
import type { ReactNode } from 'react';
import type { Tone } from './sim';
import { soft, stroke } from './tones';
import './kit.css';

const P = 'alg';

export interface NodeDef {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Arrowhead markers, one per tone. Render once inside each <svg>. */
export function Markers() {
  const tones: Tone[] = ['accent', 'good', 'warn', 'bad', 'muted', 'mag'];
  return (
    <defs>
      {tones.map((t) => (
        <marker key={t} id={`${P}-ah-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={stroke(t)} />
        </marker>
      ))}
    </defs>
  );
}

/** A component box. `tone` highlights it as active in this step. */
export function Box({ n, tone, dim, badge, badgeTone = 'accent' }: { n: NodeDef; tone?: Tone; dim?: boolean; badge?: string; badgeTone?: Tone }) {
  return (
    <g opacity={dim ? 0.45 : 1} style={{ transition: 'opacity 0.3s ease' }}>
      <rect
        x={n.x}
        y={n.y}
        width={n.w}
        height={n.h}
        rx={9}
        fill={tone ? soft(tone) : 'var(--surface)'}
        stroke={tone ? stroke(tone) : 'var(--line-2)'}
        strokeWidth={tone ? 2.4 : 1.3}
        style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
      />
      <text x={n.x + n.w / 2} y={n.y + (n.sub ? n.h / 2 - (n.h < 40 ? 0 : 2) : n.h / 2 + 4)} textAnchor="middle" fontSize={12} fontWeight={700}>
        {n.label}
      </text>
      {n.sub && (
        <text x={n.x + n.w / 2} y={n.y + n.h / 2 + (n.h < 40 ? 11 : 12)} textAnchor="middle" fontSize={10} className="alg-muted">
          {n.sub}
        </text>
      )}
      {badge && <Pill x={n.x + 4} y={n.y - 8} text={badge} tone={badgeTone} />}
    </g>
  );
}

function center(n: NodeDef) {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

/** Point where the ray from the box centre towards (tx, ty) leaves the box (plus a small gap). */
function exitPoint(n: NodeDef, tx: number, ty: number, gap = 3) {
  const c = center(n);
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : (n.w / 2 + gap) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (n.h / 2 + gap) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

/**
 * An arrow from one box to another. `packet` draws a dot that travels along it (keyed by `k`
 * so it restarts on every step); `flow` makes the dashes march.
 */
export function Edge({
  a,
  b,
  tone = 'muted',
  label,
  packet,
  k,
  dashed,
  flow,
  labelDy = -6,
  bend = 0,
}: {
  a: NodeDef;
  b: NodeDef;
  tone?: Tone;
  label?: string;
  packet?: boolean;
  k?: string | number;
  dashed?: boolean;
  flow?: boolean;
  labelDy?: number;
  /** perpendicular offset of the arrow, so two arrows between the same boxes do not overlap */
  bend?: number;
}) {
  const ca = center(a);
  const cb = center(b);
  const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
  const nx = (-(cb.y - ca.y) / len) * bend;
  const ny = ((cb.x - ca.x) / len) * bend;
  const s = exitPoint(a, cb.x + nx, cb.y + ny);
  const e = exitPoint(b, ca.x + nx, ca.y + ny);
  const sx = s.x + nx;
  const sy = s.y + ny;
  const ex = e.x + nx;
  const ey = e.y + ny;
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const active = tone !== 'muted';
  return (
    <g>
      <line
        x1={sx}
        y1={sy}
        x2={ex}
        y2={ey}
        stroke={stroke(tone)}
        strokeWidth={active ? 2.4 : 1.3}
        strokeDasharray={dashed || flow ? '6 4' : undefined}
        className={flow ? `${P}-flow` : undefined}
        markerEnd={`url(#${P}-ah-${tone})`}
      />
      {packet && (
        <circle
          key={k}
          cx={ex}
          cy={ey}
          r={5}
          fill={stroke(tone)}
          className={`${P}-packet`}
          style={{ ['--dx' as string]: `${sx - ex}px`, ['--dy' as string]: `${sy - ey}px` }}
        />
      )}
      {label && <Halo x={mx} y={my + labelDy} text={label} size={10.5} weight={700} />}
    </g>
  );
}

/** Text with a background-coloured outline, readable on top of lines. */
export function Halo({ x, y, text, size = 11, weight = 600, anchor = 'middle', tone }: { x: number; y: number; text: string; size?: number; weight?: number; anchor?: 'start' | 'middle' | 'end'; tone?: Tone }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={size}
      fontWeight={weight}
      style={{ paintOrder: 'stroke', stroke: 'var(--surface-2)', strokeWidth: 4, strokeLinejoin: 'round', fill: tone ? stroke(tone) : undefined }}
    >
      {text}
    </text>
  );
}

/** Rounded status label. */
export function Pill({ x, y, text, tone = 'accent', anchor = 'start', size = 10 }: { x: number; y: number; text: string; tone?: Tone; anchor?: 'start' | 'middle' | 'end'; size?: number }) {
  const w = text.length * size * 0.58 + 12;
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return (
    <g>
      <rect x={left} y={y - size + 1} width={w} height={size + 7} rx={(size + 7) / 2} fill={soft(tone)} stroke={stroke(tone)} strokeWidth={1.1} />
      <text x={left + w / 2} y={y + 3} textAnchor="middle" fontSize={size} fontWeight={700} style={{ fill: 'var(--ink)' }}>
        {text}
      </text>
    </g>
  );
}

/** Titled panel frame for side information. */
export function Panel({ x, y, w, h, title, children, tone }: { x: number; y: number; w: number; h: number; title: string; children?: ReactNode; tone?: Tone }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={9} fill="var(--surface)" stroke={tone ? stroke(tone) : 'var(--line)'} strokeWidth={tone ? 1.6 : 1.1} />
      <text x={x + 9} y={y + 15} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--ink-2)' }}>
        {title}
      </text>
      {children}
    </g>
  );
}

/** Legend swatch (HTML), matching the shared .viz-key look. */
export function Key({ tone, ring }: { tone: Tone; ring?: boolean }) {
  return <span className="viz-key" style={ring ? { background: 'transparent', border: `2px solid ${stroke(tone)}` } : { background: stroke(tone) }} />;
}
