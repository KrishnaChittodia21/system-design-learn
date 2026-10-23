// Shared chrome for every puzzle mode: header + meters, feedback panel, tray chips, hint/reset, win panel.
import type { ReactNode } from 'react';
import { Activity, ArrowRight, Lightbulb, RotateCcw, Star } from 'lucide-react';
import type { Puzzle } from '../types';
import type { Stars } from '../logic';
import { MODE_INFO, type Message } from './run';

export function StarRow({ stars, label = true }: { stars: number; label?: boolean }) {
  return (
    <span className="cg-stars" role="img" aria-label={`${stars} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <Star key={i} size={16} aria-hidden className={i <= stars ? 'on' : ''} />
      ))}
      {label && <span className="sr-only">{stars} of 3 stars</span>}
    </span>
  );
}

export function Feedback({ msg }: { msg: Message }) {
  return (
    <div className={`cg-feedback ${msg.tone ?? ''}`} role="status" aria-live="polite">
      <h4>{msg.title}</h4>
      <p>{msg.body}</p>
    </div>
  );
}

export function Chip({
  label,
  sub,
  pressed,
  hinted,
  dragProps,
  id,
  className = '',
}: {
  label: string;
  sub?: string;
  pressed: boolean;
  hinted?: boolean;
  dragProps: Record<string, unknown>;
  id: string;
  className?: string;
}) {
  return (
    <button type="button" className={`cg-chip ${hinted ? 'hinted' : ''} ${className}`} aria-pressed={pressed} data-opt={id} {...dragProps}>
      <span className="cg-chip-l">{label}</span>
      {sub && <small>{sub}</small>}
    </button>
  );
}

export interface Counter {
  label: string;
  value: string | number;
}

/** The puzzle card: header with meters, the board, tray + feedback, actions and the win panel. */
export function Frame({
  puzzle,
  status,
  counters,
  board,
  trayTitle,
  tray,
  msg,
  onHint,
  hintDisabled,
  onReset,
  done,
  stars,
  best,
  misses,
  hints,
  winTitle,
  next,
  stack,
  hintLabel = 'Hint',
}: {
  puzzle: Puzzle;
  status: { text: string; ok: boolean };
  counters: Counter[];
  board: ReactNode;
  trayTitle: string;
  tray: ReactNode;
  msg: Message;
  onHint: () => void;
  hintDisabled?: boolean;
  onReset: () => void;
  done: boolean;
  stars: number;
  best?: Stars;
  misses: number;
  hints: number;
  winTitle: string;
  next?: { label: string; go: () => void };
  /** put the feedback under the tray instead of beside it */
  stack?: boolean;
  hintLabel?: string;
}) {
  const info = MODE_INFO[puzzle.mode];
  const Icon = info.icon;
  const titleId = `cg-t-${puzzle.id}`;
  return (
    <section className={`cg-puzzle ${done ? 'is-done' : ''}`} aria-labelledby={titleId}>
      <div className="cg-head">
        <div className="cg-head-text">
          <span className="cg-mode">
            <Icon size={14} aria-hidden /> {info.name}
          </span>
          <h3 id={titleId}>{puzzle.title}</h3>
          <p>{puzzle.brief}</p>
        </div>
        <div className="cg-meter">
          <span className={`cg-status ${status.ok ? 'ok' : ''}`}>
            <Activity size={13} aria-hidden /> {status.text}
          </span>
          {counters.map((c) => (
            <span key={c.label}>
              {c.label} <b>{c.value}</b>
            </span>
          ))}
        </div>
      </div>

      {board}

      <div className={`cg-tray-wrap ${stack ? 'stack' : ''}`}>
        <div className="cg-tray-col">
          <p className="cg-tray-title">{trayTitle}</p>
          {tray}
          <div className="cg-actions">
            <button className="btn btn-sm" type="button" onClick={onHint} disabled={done || hintDisabled}>
              <Lightbulb size={15} aria-hidden /> {hintLabel}
            </button>
            <button className="btn-ghost btn-sm" type="button" onClick={onReset}>
              <RotateCcw size={15} aria-hidden /> Reset
            </button>
          </div>
        </div>
        <Feedback msg={msg} />
      </div>

      {done && (
        <div className="cg-win" role="status" aria-live="polite">
          <div className="cg-win-top">
            <h4>{winTitle}</h4>
            <StarRow stars={stars} />
            {best && best > stars && <span className="cg-best mono">best {'★'.repeat(best)}</span>}
          </div>
          <p>
            {misses} miss{misses === 1 ? '' : 'es'}, {hints} hint{hints === 1 ? '' : 's'}. Why this design works:
          </p>
          <ol>
            {puzzle.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ol>
          <div className="cg-actions">
            <button className="btn btn-sm" type="button" onClick={onReset}>
              <RotateCcw size={15} aria-hidden /> Try again
            </button>
            {next && (
              <button className="btn btn-sm btn-primary" type="button" onClick={next.go}>
                {next.label} <ArrowRight size={15} aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function NodeText({ label, sub }: { label?: string; sub?: string }) {
  return (
    <>
      <span className="cg-node-l">{label}</span>
      {sub && <small>{sub}</small>}
    </>
  );
}
