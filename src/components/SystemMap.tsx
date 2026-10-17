import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PhaseProgress } from '../lib/metrics';
import { phaseCode } from '../lib/labels';
import { STATE_COLOR, phaseState, type PhaseState } from './phaseState';

/* ---------------------------------------------------------------- phase icons (24×24 line art) */
const ICONS: Record<string, ReactNode> = {
  fundamentals: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  networking: (
    <>
      <circle cx="5" cy="12" r="2" />
      <path d="M7 12h4M11 12l6-6M11 12h6M11 12l6 6" />
      <circle cx="19" cy="6" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
      <circle cx="19" cy="18" r="1.6" />
    </>
  ),
  caching: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  databases: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  distributed: (
    <>
      <circle cx="12" cy="5" r="2.4" />
      <circle cx="5" cy="18" r="2.4" />
      <circle cx="19" cy="18" r="2.4" />
      <path d="M10.8 7.1 6.2 15.9M13.2 7.1l4.6 8.8M7.4 18h9.2" />
    </>
  ),
  messaging: (
    <>
      <rect x="2" y="7" width="20" height="10" rx="2" />
      <path d="M7 7v10M12 7v10M17 7v10" />
    </>
  ),
  reliability: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  'apis-security': (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  platform: <path d="M4 16a8 8 0 0 1 16 0M12 16l4-5M3 20h18" />,
  production: <path d="M12 3 2 20h20zM12 10v4M12 17v.5" />,
  designs: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  lld: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  miscellaneous: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.7-.9 1.3v.7M12 16.8v.4" />
    </>
  ),
  behavioral: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </>
  ),
};
const FALLBACK_ICON = <circle cx="12" cy="12" r="7" />;

export function PhaseIcon({ id, size = 18 }: { id: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {ICONS[id] ?? FALLBACK_ICON}
    </svg>
  );
}

/** Node label: drop prefixes/suffixes that don't help on a card, then wrap into at most two lines of ~16 chars. */
function nodeLines(title: string): string[] {
  const t = title
    .replace(/^Miscellaneous:\s*/, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+Round$/, '');
  if (t.length <= 16) return [t];
  const words = t.split(' ');
  let first = '';
  while (words.length && (first ? `${first} ${words[0]}` : words[0]).length <= 16) first = first ? `${first} ${words.shift()}` : (words.shift() as string);
  if (!first) first = words.shift() as string;
  return words.length ? [first, words.join(' ')] : [first];
}

/* ---------------------------------------------------------------- layout */
const W = 1275;
const H = 430;
const NW = 186;
const NH = 70;
const COLS = [100, 315, 530, 745, 960, 1175];
const ROWS = [95, 215, 335];
/** node centre for the i-th phase (0-based): two on the middle row, then columns of three */
function pos(i: number): [number, number] {
  if (i < 2) return [COLS[i], ROWS[1]];
  const k = i - 2;
  return [COLS[Math.min(COLS.length - 1, 2 + Math.floor(k / 3))], ROWS[k % 3]];
}
/** the wiring of the architecture, by 1-based position (course order) */
const EDGES: [number, number][] = [
  [1, 2], [2, 3], [2, 4], [2, 5], [3, 6], [4, 7], [5, 8], [4, 6], [6, 9], [7, 10], [8, 11], [9, 12], [10, 13], [11, 14], [7, 9], [10, 11],
];

const SUB: Record<PhaseState, (ph: PhaseProgress) => string> = {
  done: (ph) => `${ph.passed}/${ph.total} PASSED`,
  now: (ph) => `${ph.passed}/${ph.total} · STUDYING`,
  prog: (ph) => `${ph.passed}/${ph.total} · STARTED`,
  todo: (ph) => `${ph.passed}/${ph.total} · AHEAD`,
};
const SUB_CLS: Record<PhaseState, string> = { done: 'sv-cyan', now: 'sv-amber', prog: 'sv-blue', todo: 'sv-ink3' };
const STROKE: Record<PhaseState, string> = { done: 'st-cyan', now: 'st-amber', prog: 'st-blue', todo: 'st-line' };

const STATE_WORD: Record<PhaseState, string> = { done: 'passed', now: 'studying now', prog: 'in progress', todo: 'ahead' };

/**
 * "Your system map": every phase as a component of one architecture, wired left to right. Passed phases glow
 * cyan and send packets downstream; the phase being studied pulses amber; started phases are blue; phases ahead
 * are dashed. Decorative SVG with a text summary; the "By phase" card holds the same data as links.
 */
export function SystemMap({ phases, currentPhaseId }: { phases: PhaseProgress[]; currentPhaseId?: string }) {
  const st = phases.map((ph) => phaseState(ph, currentPhaseId));
  const summary = (['done', 'now', 'prog', 'todo'] as PhaseState[])
    .map((s) => {
      const names = phases.filter((_, i) => st[i] === s).map((ph) => ph.title);
      return names.length ? `${STATE_WORD[s]}: ${names.join(', ')}` : '';
    })
    .filter(Boolean)
    .join('. ');

  const edges = EDGES.filter(([a, b]) => a <= phases.length && b <= phases.length).map(([a, b]) => {
    const [x1, y1] = pos(a - 1);
    const [x2, y2] = pos(b - 1);
    const sx = x1 + NW / 2;
    const ex = x2 - NW / 2;
    const cx = (sx + ex) / 2;
    const d = `M${sx} ${y1} C${cx} ${y1} ${cx} ${y2} ${ex} ${y2}`;
    const sa = st[a - 1];
    const sb = st[b - 1];
    const key = `${a}-${b}`;
    if (sa === 'done' && sb !== 'todo') {
      return (
        <g key={key}>
          <path d={d} className="st-cyan" fill="none" strokeWidth={2} opacity={0.55} />
          <path d={d} className="st-cyan flow" fill="none" strokeWidth={2} />
          {[0, 1].map((i) => (
            <circle
              key={i}
              r={4.5}
              className={`pkt td-pkt ${sb === 'now' && i === 1 ? 'sv-amber' : 'sv-cyan'}`}
              style={{ offsetPath: `path('${d}')`, '--dur': '2.6s', '--dl': `${i * 1.3}s` } as CSSProperties}
            />
          ))}
        </g>
      );
    }
    if (sa !== 'todo' && sb !== 'todo' && sa !== 'done') return <path key={key} d={d} className="st-blue flow" fill="none" strokeWidth={1.6} opacity={0.8} />;
    if (sa === 'done') return <path key={key} d={d} className="st-cyan" fill="none" strokeWidth={1.4} opacity={0.4} strokeDasharray="3 6" />;
    return <path key={key} d={d} className="st-line" fill="none" strokeWidth={1.4} strokeDasharray="3 6" />;
  });

  return (
    <section className="glass card td-map" aria-labelledby="td-map-title">
      <div className="td-card-head">
        <h2 id="td-map-title" className="td-h2">
          Your system map
        </h2>
        <span className="muted td-head-note">
          {phases.length} phases wired as one architecture · traffic flows as you pass exams
        </span>
      </div>
      <div className="td-map-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Architecture graph of the ${phases.length} phases. ${summary}.`} focusable="false">
          {edges}
          {phases.map((ph, i) => {
            const s = st[i];
            const [x, y] = pos(i);
            const x0 = x - NW / 2;
            const y0 = y - NH / 2;
            const lines = nodeLines(ph.title);
            const col = STATE_COLOR[s];
            const textCls = s === 'todo' ? 'sv-ink3' : 'sv-ink';
            const top = lines.length === 1 ? y - 3 : y - 11;
            return (
              <g key={ph.id} aria-hidden className={`td-node td-node-${s}`}>
                {s === 'now' && <rect x={x0 - 6} y={y0 - 6} width={NW + 12} height={NH + 12} rx={20} fill="none" className="st-amber flow" strokeWidth={1.2} opacity={0.7} />}
                <rect x={x0} y={y0} width={NW} height={NH} rx={15} className={`sv-surface ${STROKE[s]}`} strokeWidth={s === 'todo' ? 1.2 : 1.6} fillOpacity={0.92} />
                <rect x={x0 + 12} y={y - 17} width={34} height={34} rx={10} fill={col} fillOpacity={0.14} />
                <g transform={`translate(${x0 + 18},${y - 11}) scale(.92)`} fill="none" stroke={col} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[ph.id] ?? FALLBACK_ICON}
                </g>
                {lines.map((ln, li) => (
                  <text key={li} x={x0 + 56} y={top + li * 16} className={`sv-text ${textCls}`} fontSize={13.5} fontWeight={700}>
                    {ln}
                  </text>
                ))}
                <text x={x0 + 56} y={top + (lines.length - 1) * 16 + 18} className={`sv-mono ${SUB_CLS[s]}`} fontSize={9.5} letterSpacing={0.3}>
                  {phaseCode(ph.number)} · {SUB[s](ph)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="td-legend td-map-legend" aria-hidden>
        <span>
          <span className="dot td-key-cyan" />
          Passed
        </span>
        <span>
          <span className="dot td-key-amber" />
          Studying now
        </span>
        <span>
          <span className="dot" style={{ background: 'var(--blue)' }} />
          In progress
        </span>
        <span>
          <span className="dot td-key-ahead" />
          Ahead
        </span>
      </div>
    </section>
  );
}

/** Phone replacement for the map (per the mobile mockup): the phase around where you are, as a short list. */
export function PhaseList({ phases, currentPhaseId }: { phases: PhaseProgress[]; currentPhaseId?: string }) {
  const at = Math.max(0, phases.findIndex((ph) => ph.id === currentPhaseId));
  const start = Math.max(0, Math.min(at - 1, phases.length - 3));
  const shown = phases.slice(start, start + 3);
  return (
    <section className="td-plist-wrap" aria-labelledby="td-plist-title">
      <div className="td-card-head">
        <h2 id="td-plist-title" className="td-h2 td-h2-s">
          Phases
        </h2>
        <Link to="/contents" className="td-link">
          All {phases.length}
        </Link>
      </div>
      <ul className="td-plist">
        {shown.map((ph) => {
          const s = phaseState(ph, currentPhaseId);
          const pct = ph.total ? Math.round((ph.passed / ph.total) * 100) : 0;
          return (
            <li key={ph.id} className={`td-plist-${s}`}>
              <Link to={`/contents#phase-${ph.id}`}>
                <span className="td-plist-ic" style={{ color: STATE_COLOR[s] }}>
                  <PhaseIcon id={ph.id} />
                </span>
                <span className="td-plist-txt">
                  <b>{ph.title}</b>
                  <span className="mono" style={{ color: s === 'todo' ? 'var(--ink-3)' : STATE_COLOR[s] }}>
                    {phaseCode(ph.number)} · {SUB[s](ph)}
                  </span>
                </span>
                {s === 'done' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2.4" aria-hidden>
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                ) : s === 'now' ? (
                  <span className="dot pulse-a td-key-amber" aria-hidden />
                ) : (
                  <span className="mono td-plist-pct">{pct}%</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
