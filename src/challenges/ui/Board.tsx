// The blueprint board shared by flow, fault, tune and sequence (stages): nodes on a col/row grid with wires
// between them. Broken wires are red, dashed and carry a blinking ✗; live wires are green and (motion allowed)
// carry packets. When the board is narrow the grid is transposed so flows run top → bottom.
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { NodeKind } from '../types';
import { useReducedMotion, useWidth } from './hooks';
import { placeEdgeLabel } from '../logic';

export interface BoardNodeView {
  id: string;
  col: number;
  row: number;
  kind?: NodeKind;
  /** extra state classes, e.g. 'slot', 'filled', 'exposed' */
  className?: string;
  content: ReactNode;
  /** render as a <button> (slot / clickable node) */
  onClick?: () => void;
  /** accepts drops: sets data-drop=<id> */
  drop?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  /** extra inline style (e.g. CSS custom properties such as --heat) */
  style?: CSSProperties;
}

export interface BoardEdgeView {
  from: string;
  to: string;
  label?: string;
  /** green */
  live: boolean;
  /** packets travel along it (defaults to live) */
  flowing?: boolean;
  /**
   * route / spike wires: overrides the broken/live look. idle = neutral, cand = a choice (accent, marching),
   * trail = travelled (green), nope = a hop already ruled out (red, dim), fizz = a hop bouncing right now (red),
   * run = traffic flowing (accent), hot = flowing into a saturated box (red). No blinking ✗ in any of them.
   */
  state?: 'idle' | 'cand' | 'trail' | 'nope' | 'fizz' | 'run' | 'hot';
}

/** a wire's drawn geometry (clipped at the node borders), for overlays such as a travelling packet */
export interface WireGeo {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  len: number;
}

const STATE_MARKER = { idle: 'idle', cand: 'acc', trail: 'good', nope: 'bad', fizz: 'bad', run: 'acc', hot: 'bad' } as const;

/** width below which the grid is transposed */
const NARROW_BOARD = 620;

/** node centres + sizes for a board width (scripts/validate-challenges.mjs mirrors this for its overlap check) */
function gridLayout(width: number, cols: number, rows: number) {
  const narrow = width > 0 && width < NARROW_BOARD;
  const gc = narrow ? rows : cols;
  const gr = narrow ? cols : rows;
  const pad = narrow ? 10 : 20;
  const height = Math.round(gr * (narrow ? 150 : 112) + 40);
  const inner = Math.max(1, width - 2 * pad);
  // node width shrinks with the column spacing so neighbours never overlap on small screens
  const spacing = inner / Math.max(1, gc);
  const nodeW = Math.round(narrow ? Math.max(84, Math.min(128, spacing - 8)) : Math.max(92, Math.min(150, spacing - 12)));
  const pos = (n: { col: number; row: number }) => {
    const c = narrow ? n.row : n.col;
    const r = narrow ? n.col : n.row;
    const x = pad + (inner * (c + 0.5)) / gc;
    // keep every node fully inside the board (it clips its overflow)
    return { x: Math.min(Math.max(x, nodeW / 2 + 4), width - nodeW / 2 - 4), y: 20 + ((height - 40) * (r + 0.5)) / gr };
  };
  return { narrow, height, nodeW, pos };
}

interface Geo {
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bx: number;
  by: number;
  lx: number;
  ly: number;
  anchor: 'start' | 'middle' | 'end';
  len: number;
}

export function Board({
  cols,
  rows,
  nodes,
  edges,
  label,
  boardRef,
  overlay,
  className = '',
}: {
  cols: number;
  rows: number;
  nodes: BoardNodeView[];
  edges: BoardEdgeView[];
  /** accessible name of the diagram */
  label: string;
  boardRef?: React.RefObject<HTMLDivElement | null>;
  /** extra SVG drawn above the wires, given each wire's geometry keyed `'from>to'` */
  overlay?: (wires: Record<string, WireGeo>) => ReactNode;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  const reduce = useReducedMotion();
  const L = gridLayout(width, cols, rows);
  const { narrow, height, nodeW, pos } = L;

  const nodeEls = useRef(new Map<string, HTMLElement>());
  const [geo, setGeo] = useState<{ key: string; list: (Geo | null)[] }>({ key: '', list: [] });

  // wires are clipped at node borders, so they need each node's rendered size (re-measured whenever the
  // nodes, wires or board size change; content changes arrive as new node views)
  useLayoutEffect(() => {
    const L = gridLayout(width, cols, rows);
    if (!width) return;
    const size = (id: string) => {
      const el = nodeEls.current.get(id);
      return el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
    };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const list = edges.map((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      const sa = size(e.from);
      const sb = size(e.to);
      if (!a || !b || !sa || !sb) return null;
      const pa = L.pos(a);
      const pb = L.pos(b);
      const clip = (p: { x: number; y: number }, s: { w: number; h: number }, tx: number, ty: number) => {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const kx = dx === 0 ? Infinity : (s.w / 2 + 6) / Math.abs(dx);
        const ky = dy === 0 ? Infinity : (s.h / 2 + 6) / Math.abs(dy);
        const k = Math.min(kx, ky, 0.49);
        return [p.x + dx * k, p.y + dy * k];
      };
      const [x1, y1] = clip(pa, sa, pb.x, pb.y);
      const [x2, y2] = clip(pb, sb, pa.x, pa.y);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const lab = e.label ? placeEdgeLabel({ x1, y1, x2, y2 }, { ...pa, ...sa }, { ...pb, ...sb }, e.label, width) : null;
      const g: Geo = {
        d: `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`,
        x1,
        y1,
        x2,
        y2,
        bx: x1 + (x2 - x1) * 0.4,
        by: y1 + (y2 - y1) * 0.4,
        lx: lab?.x ?? 0,
        ly: lab?.y ?? 0,
        anchor: lab?.anchor ?? 'middle',
        len,
      };
      return g;
    });
    const key = JSON.stringify(list);
    setGeo((prev) => (prev.key === key ? prev : { key, list }));
  }, [width, cols, rows, nodes, edges]);

  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (boardRef) boardRef.current = el;
      }}
      className={`cg-board ${narrow ? 'is-narrow' : ''} ${className}`}
      style={{ height, ['--cg-node-w' as string]: `${nodeW}px` }}
      role="group"
      aria-label={label}
    >
      <svg className="cg-edges" width="100%" height="100%" aria-hidden>
        <defs>
          <marker id={`${uid}-bad`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="cg-ah-bad" />
          </marker>
          <marker id={`${uid}-good`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="cg-ah-good" />
          </marker>
          <marker id={`${uid}-idle`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="cg-ah-idle" />
          </marker>
          <marker id={`${uid}-acc`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="cg-ah-acc" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const g = geo.list[i];
          if (!g) return null;
          const flowing = e.flowing ?? (e.state ? e.state === 'run' || e.state === 'hot' : e.live);
          const st = e.state;
          const look = st ? `st-${st}` : e.live ? 'live' : '';
          const marker = st ? STATE_MARKER[st] : e.live ? 'good' : 'bad';
          return (
            <g key={`${e.from}-${e.to}-${i}`}>
              <path id={`${uid}-e${i}`} d={g.d} className={`cg-edge ${look}`} markerEnd={`url(#${uid}-${marker})`} />
              {!st && (
                <g className={`cg-break ${e.live ? 'hidden' : ''}`}>
                  <line x1={g.bx - 6} y1={g.by - 6} x2={g.bx + 6} y2={g.by + 6} />
                  <line x1={g.bx - 6} y1={g.by + 6} x2={g.bx + 6} y2={g.by - 6} />
                </g>
              )}
              {e.label && (
                <text className={`cg-edge-label ${look}`} x={g.lx.toFixed(1)} y={g.ly.toFixed(1)} textAnchor={g.anchor}>
                  {e.label}
                </text>
              )}
              {flowing && !reduce && (
                <circle r="4" className={`cg-packet ${st === 'run' ? 'acc' : st === 'hot' ? 'bad' : ''}`}>
                  <animateMotion dur={`${Math.max(0.6, g.len / 90).toFixed(2)}s`} repeatCount="indefinite" begin={`${(i * 0.3).toFixed(1)}s`}>
                    <mpath href={`#${uid}-e${i}`} />
                  </animateMotion>
                </circle>
              )}
            </g>
          );
        })}
        {overlay?.(Object.fromEntries(edges.flatMap((e, i) => (geo.list[i] ? [[`${e.from}>${e.to}`, geo.list[i]!]] : []))))}
      </svg>
      {width > 0 &&
        nodes.map((n) => {
          const p = pos(n);
          const cls = `cg-node ${n.kind ?? 'box'} ${n.className ?? ''}`;
          const style = { ...n.style, left: p.x, top: p.y };
          const setEl = (el: HTMLElement | null) => {
            if (el) nodeEls.current.set(n.id, el);
            else nodeEls.current.delete(n.id);
          };
          return n.onClick || n.drop ? (
            <button
              key={n.id}
              ref={setEl}
              type="button"
              className={cls}
              style={style}
              data-node={n.id}
              data-drop={n.drop ? n.id : undefined}
              aria-label={n.ariaLabel}
              aria-disabled={n.disabled || undefined}
              onClick={n.disabled ? undefined : n.onClick}
            >
              {n.content}
            </button>
          ) : (
            <div key={n.id} ref={setEl} className={cls} style={style} data-node={n.id} aria-label={n.ariaLabel} role={n.ariaLabel ? 'img' : undefined}>
              {n.content}
            </div>
          );
        })}
    </div>
  );
}
