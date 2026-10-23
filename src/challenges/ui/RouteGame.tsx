// Mode 6, "Route it": steer packets hop by hop through a system graph. At each junction the learner picks the next
// hop (tap a highlighted neighbour, a hop button, or press 1–4). A right hop glides along the wire and leaves a green
// trail; a wrong one runs out, fizzles and bounces back with the packet's explanation. Several packets play in order.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, Check, CornerDownRight, Flag, Send, X } from 'lucide-react';
import type { RoutePuzzle } from '../types';
import { edgeKey, formatNum, routeArrived, routeChoices, routeCost, starsFor } from '../logic';
import { Board, type BoardEdgeView, type BoardNodeView, type WireGeo } from './Board';
import { Frame, NodeText } from './kit';
import { MODE_INFO, useRun, type GameProps } from './run';
import { replayClass, useReducedMotion } from './hooks';

interface Anim {
  id: number;
  key: string;
  kind: 'go' | 'bounce';
}

let animSeq = 0;
/** meter chip ids: separate from animSeq and taken when the chip is created, so two chips never share a key */
let chipSeq = 0;

export default function RouteGame({ puzzle, best, onComplete, onReset, next }: GameProps<RoutePuzzle>) {
  const run = useRun({ title: 'How it works', body: MODE_INFO.route.how });
  const reduce = useReducedMotion();
  const [pi, setPi] = useState(0);
  const [path, setPath] = useState<string[]>(() => [puzzle.packets[0].from]);
  const [tried, setTried] = useState<Set<string>>(new Set());
  const [anim, setAnim] = useState<Anim | null>(null);
  const [hinted, setHinted] = useState<string | null>(null);
  const [chips, setChips] = useState<{ id: number; key: string; text: string }[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  /** keyboard users keep focus in the hop bar as it re-renders */
  const keepFocus = useRef(false);
  const pending = useRef<{ id: number; apply: () => void } | null>(null);
  /** latest wire geometry (from the board overlay) and the moving packet / trail elements */
  const wires = useRef<Record<string, WireGeo>>({});
  const packetEl = useRef<SVGGElement>(null);
  const trailEl = useRef<SVGLineElement>(null);

  const packet = puzzle.packets[pi];
  const arrived = routeArrived(packet, path);
  const at = path[path.length - 1];
  const choices = useMemo(() => (arrived ? [] : routeChoices(puzzle, packet, path)), [puzzle, packet, path, arrived]);
  const label = (id: string) => puzzle.nodes.find((n) => n.id === id)?.label ?? id;
  const meter = puzzle.meter;
  const spent = routeCost(puzzle, path);
  const lastPacket = pi === puzzle.packets.length - 1;

  // after a re-render that moved the packet, put keyboard focus back on the first live hop button
  useEffect(() => {
    if (!keepFocus.current || anim) return;
    const b = barRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    if (b) b.focus();
  }, [path, pi, anim, arrived]);

  // the packet animation: a rAF loop moving the packet (and growing the trail) along the wire, then finishing the hop
  useEffect(() => {
    if (!anim) return;
    const g = wires.current[anim.key];
    if (!g) {
      animDone(anim.id);
      return;
    }
    const dur = (anim.kind === 'go' ? hopTime(g) : BOUNCE_S) * 1000;
    const t0 = performance.now();
    let raf = 0;
    const put = (k: number) => {
      packetEl.current?.setAttribute('transform', `translate(${(g.x1 + (g.x2 - g.x1) * k).toFixed(1)} ${(g.y1 + (g.y2 - g.y1) * k).toFixed(1)})`);
      if (anim.kind === 'go') {
        trailEl.current?.setAttribute('x2', (g.x1 + (g.x2 - g.x1) * k).toFixed(1));
        trailEl.current?.setAttribute('y2', (g.y1 + (g.y2 - g.y1) * k).toFixed(1));
      }
    };
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      if (anim.kind === 'go') put(easeInOut(t));
      // bounce: out to 48% of the wire (accelerating), then spring back to the start
      else put(t < SPLIT ? 0.48 * (t / SPLIT) ** 2 : 0.48 * (1 - backOut((t - SPLIT) / (1 - SPLIT))));
      if (t < 1) raf = requestAnimationFrame(tick);
      else animDone(anim.id);
    };
    put(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // animDone only reads refs; the loop restarts only for a new animation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim]);

  /** run `apply` once the packet animation `id` has finished (immediately with reduced motion) */
  const animate = (key: string, kind: Anim['kind'], apply: () => void) => {
    const id = ++animSeq;
    if (reduce) {
      apply();
      return;
    }
    pending.current = { id, apply };
    setAnim({ id, key, kind });
  };
  const animDone = (id: number) => {
    const p = pending.current;
    if (!p || p.id !== id) return;
    pending.current = null;
    setAnim(null);
    p.apply();
  };

  /** a node was reached on a right hop: arrive, cross a single-wire node automatically, or wait for the next choice */
  const reached = (nextPath: string[], hopNote?: string) => {
    setPath(nextPath);
    setTried(new Set());
    setHinted(null);
    const node = nextPath[nextPath.length - 1];
    if (routeArrived(packet, nextPath)) {
      if (lastPacket) {
        const stars = run.finish();
        run.say(`✓ Delivered: ${packet.label}`, `${packet.done} Every packet took the right route. Read why below.`, 'good');
        onComplete(stars);
      } else run.say(`✓ Delivered: ${packet.label}`, packet.done, 'good');
      return;
    }
    const opts = routeChoices(puzzle, packet, nextPath);
    if (opts.length === 1 && opts[0].ok) {
      run.say(`→ ${label(node)}`, `${hopNote ? hopNote + ' ' : ''}Only one wire leaves ${label(node)}, so the packet carries on to ${label(opts[0].to)}.`, 'good');
      window.setTimeout(() => go(nextPath, opts[0].to, opts[0].why), reduce ? 0 : 260);
      return;
    }
    run.say(`✓ ${label(node)}`, hopNote ?? `The packet is at ${label(node)}. Pick the next hop.`, 'good');
  };

  /** a right hop: glide, leave a trail, add the meter chip */
  const go = (from: string[], to: string, note?: string) => {
    const key = edgeKey(from[from.length - 1], to);
    const cost = meter?.costs[key];
    if (meter && cost) {
      const chip = { id: ++chipSeq, key, text: `+${formatNum(cost, meter.decimals ?? 0, meter.unit ?? '')}` };
      setChips((c) => [...c.slice(-4), chip]);
    }
    animate(key, 'go', () => reached([...from, to], note));
  };

  const choose = (to: string) => {
    if (run.done || anim || arrived) return;
    const c = choices.find((x) => x.to === to);
    if (!c) {
      if (to !== at) run.say('Not connected', `There is no wire from ${label(at)} to ${label(to)}. Pick one of the highlighted next hops.`);
      return;
    }
    if (tried.has(c.key)) {
      run.say(`✗ ${label(at)} → ${label(to)}`, c.why ?? '', 'bad');
      return;
    }
    if (c.ok) {
      go(path, to, c.why);
      return;
    }
    run.miss();
    setHinted(null);
    animate(c.key, 'bounce', () => {
      setTried((t) => new Set(t).add(c.key));
      replayClass(boardRef.current?.querySelector(`[data-node="${to}"]`), 'shake');
    });
    run.say(`✗ ${label(at)} → ${label(to)} bounces back`, c.why ?? 'That hop is wrong for this packet.', 'bad');
  };

  const nextPacket = () => {
    if (!arrived || lastPacket) return;
    const k = puzzle.packets[pi + 1];
    setPi(pi + 1);
    setPath([k.from]);
    setTried(new Set());
    setHinted(null);
    setChips([]);
    run.say(`Packet ${pi + 2} of ${puzzle.packets.length}: ${k.label}`, `${k.sub ? k.sub + '. ' : ''}It starts at ${label(k.from)}. Pick its first hop.`);
    const opts = routeChoices(puzzle, k, [k.from]);
    if (opts.length === 1 && opts[0].ok) window.setTimeout(() => go([k.from], opts[0].to, opts[0].why), reduce ? 0 : 300);
  };

  // the first packet too: if its start node has a single wire out, cross it on its own (also after a reset, which remounts)
  useEffect(() => {
    const k = puzzle.packets[0];
    const opts = routeChoices(puzzle, k, [k.from]);
    if (!(opts.length === 1 && opts[0].ok)) return;
    const t = window.setTimeout(() => go([k.from], opts[0].to, opts[0].why), reduce ? 0 : 300);
    return () => window.clearTimeout(t);
    // runs once per mount; `go` only reads state/refs that are current at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hint = () => {
    const c = choices.find((x) => x.ok);
    if (!c || run.done) return;
    run.hint();
    setHinted(c.to);
    run.say('Hint', `Think about what this packet needs at ${label(at)}. The glowing hop keeps it on a right route.`);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const n = Number(e.key);
    if (n >= 1 && n <= choices.length) {
      e.preventDefault();
      keepFocus.current = !!barRef.current?.contains(document.activeElement);
      choose(choices[n - 1].to);
    }
  };

  /* ---------------- board ---------------- */
  const candIndex = new Map(choices.map((c, i) => [c.to, i]));
  const trailKeys = new Set(path.slice(1).map((x, i) => edgeKey(path[i], x)));
  const visited = new Set(path);
  const nodes: BoardNodeView[] = puzzle.nodes.map((n) => {
    const base = { id: n.id, col: n.col, row: n.row, kind: n.kind };
    const ci = candIndex.get(n.id);
    const here = n.id === at && !anim;
    const goal = packet.to === n.id && !arrived;
    const badge = here ? (
      <span className="rt-badge here" aria-hidden>
        <Send size={11} /> {arrived ? 'delivered' : 'packet'}
      </span>
    ) : goal ? (
      <span className="rt-badge goal" aria-hidden>
        <Flag size={11} /> goal
      </span>
    ) : null;
    if (ci !== undefined && !run.done) {
      const c = choices[ci];
      const nope = tried.has(c.key);
      return {
        ...base,
        className: `rt-cand ${nope ? 'nope' : ''} ${hinted === n.id ? 'hint-pulse' : ''} ${visited.has(n.id) ? 'past' : ''}`,
        onClick: () => choose(n.id),
        disabled: !!anim,
        ariaLabel: `${nope ? 'Ruled out: ' : `Next hop ${ci + 1}: `}send the packet to ${n.label}${n.sub ? `, ${n.sub}` : ''}`,
        content: (
          <>
            <span className={`rt-num ${nope ? 'nope' : ''}`} aria-hidden>
              {nope ? <X size={11} strokeWidth={3} /> : ci + 1}
            </span>
            {badge}
            <NodeText label={n.label} sub={n.sub} />
          </>
        ),
      };
    }
    return {
      ...base,
      className: `${here ? 'rt-here' : ''} ${visited.has(n.id) && !here ? 'past' : ''} ${run.done ? 'tuned' : ''}`,
      ariaLabel: `${n.label}${n.sub ? `, ${n.sub}` : ''}${here ? (arrived ? ', the packet was delivered here' : ', the packet is here') : ''}`,
      content: (
        <>
          {badge}
          <NodeText label={n.label} sub={n.sub} />
        </>
      ),
    };
  });
  const candKeys = new Set(choices.map((c) => c.key));
  const edges: BoardEdgeView[] = puzzle.edges.map(([from, to, l]) => {
    const key = edgeKey(from, to);
    const state: BoardEdgeView['state'] = run.done
      ? trailKeys.has(key)
        ? 'trail'
        : 'idle'
      : anim?.key === key
        ? anim.kind === 'bounce'
          ? 'fizz'
          : 'cand'
        : trailKeys.has(key)
          ? 'trail'
          : tried.has(key)
            ? 'nope'
            : candKeys.has(key) && !anim
              ? 'cand'
              : 'idle';
    return { from, to, label: l, live: false, state, flowing: state === 'trail' && !anim };
  });

  const overlay = (w: Record<string, WireGeo>) => {
    wires.current = w;
    const g = anim ? w[anim.key] : undefined;
    const mx = g ? g.x1 + (g.x2 - g.x1) * 0.48 : 0;
    const my = g ? g.y1 + (g.y2 - g.y1) * 0.48 : 0;
    return (
      <>
        {g && anim?.kind === 'go' && <line key={`t${anim.id}`} ref={trailEl} className="rt-trail" x1={g.x1} y1={g.y1} x2={g.x1} y2={g.y1} />}
        {g && anim && (
          <g key={anim.id} ref={packetEl} transform={`translate(${g.x1} ${g.y1})`}>
            <circle r={9} className={`rt-halo ${anim.kind}`} />
            <circle r={5.5} className={`rt-packet ${anim.kind}`} />
          </g>
        )}
        {g && anim?.kind === 'bounce' && (
          <g transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)})`}>
            <g className="rt-spark">
              {[0, 60, 120, 180, 240, 300].map((a) => (
                <line key={a} x1={0} y1={-6} x2={0} y2={-13} transform={`rotate(${a})`} />
              ))}
            </g>
          </g>
        )}
        {meter &&
          chips.map((c) => {
            const cg = w[c.key];
            if (!cg) return null;
            return (
              <text key={c.id} className="rt-chip" x={(cg.x1 + cg.x2) / 2} y={(cg.y1 + cg.y2) / 2 - 8} textAnchor="middle">
                {c.text}
              </text>
            );
          })}
      </>
    );
  };

  /* ---------------- HUD + packet strip ---------------- */
  const over = meter?.budget !== undefined && spent > meter.budget + 1e-9;
  const hud = (
    <div className="rt-hud">
      <ol className="rt-packets" aria-label="Packets">
        {puzzle.packets.map((k, i) => {
          const state = i < pi || (i === pi && (arrived || run.done)) ? 'done' : i === pi ? 'now' : 'todo';
          return (
            <li key={k.id} className={`rt-pk ${state}`} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="rt-pk-n" aria-hidden>
                {state === 'done' ? <Check size={12} strokeWidth={3} /> : i + 1}
              </span>
              <span className="sr-only">
                Packet {i + 1}: {k.label}, {state === 'done' ? 'delivered' : state === 'now' ? 'in flight' : 'waiting'}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="rt-caption">
        <span className="rt-cap-k mono">
          Packet {pi + 1} of {puzzle.packets.length}
        </span>
        <b>{packet.label}</b>
        {packet.sub && <small className="mono">{packet.sub}</small>}
      </div>
      {meter && (
        <div className={`rt-meter ${over ? 'over' : ''}`} role="group" aria-label={meter.label}>
          <span className="rt-meter-l">{meter.label}</span>
          <span className="rt-meter-v mono">
            {formatNum(spent, meter.decimals ?? 0, meter.unit ?? '')}
            {meter.budget !== undefined && <span className="cg-op"> / {formatNum(meter.budget, meter.decimals ?? 0, meter.unit ?? '')}</span>}
          </span>
          {meter.budget !== undefined && (
            <span className="cg-gauge-bar" aria-hidden>
              <i style={{ width: `${Math.min(100, (spent / meter.budget) * 100)}%` }} />
            </span>
          )}
        </div>
      )}
    </div>
  );

  const bar = (
    <div
      ref={barRef}
      className="rt-bar"
      role="group"
      aria-label={arrived ? 'Packet delivered' : `Next hop from ${label(at)}`}
      onPointerDown={() => (keepFocus.current = false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') keepFocus.current = true;
      }}
    >
      {run.done ? (
        <span className="cg-empty">All packets delivered.</span>
      ) : arrived ? (
        <button type="button" className="btn btn-sm btn-primary" onClick={nextPacket}>
          Send packet {pi + 2} <ArrowRight size={15} aria-hidden />
        </button>
      ) : (
        <>
          <span className="rt-from">
            <CornerDownRight size={14} aria-hidden /> from <b>{label(at)}</b>
          </span>
          {choices.map((c, i) => {
            const nope = tried.has(c.key);
            return (
              <button
                key={c.key}
                type="button"
                className={`rt-hop ${nope ? 'nope' : ''} ${hinted === c.to ? 'hinted' : ''}`}
                disabled={!!anim || nope}
                onClick={() => choose(c.to)}
                aria-label={`${i + 1}: ${nope ? 'ruled out, ' : ''}to ${label(c.to)}${c.label ? ` via ${c.label}` : ''}`}
              >
                <span className="rt-hop-n mono" aria-hidden>
                  {i + 1}
                </span>
                <span className="rt-hop-l">{label(c.to)}</span>
                {c.label && <small className="mono">{c.label}</small>}
              </button>
            );
          })}
        </>
      )}
    </div>
  );

  const delivered = pi + (arrived || run.done ? 1 : 0);
  return (
    <div className="cg-scope rt-scope" onKeyDown={onKey}>
      <Frame
        puzzle={puzzle}
        status={{ text: run.done ? 'DELIVERED' : anim?.kind === 'bounce' ? 'BOUNCED' : 'ROUTING', ok: run.done }}
        counters={[
          { label: 'Delivered', value: `${delivered}/${puzzle.packets.length}` },
          { label: 'Misses', value: run.misses },
        ]}
        board={
          <>
            {hud}
            <Board
              boardRef={boardRef}
              className="rt-board"
              label={`${puzzle.title} diagram. The packet is at ${label(at)}.`}
              cols={puzzle.cols}
              rows={puzzle.rows}
              nodes={nodes}
              edges={edges}
              overlay={overlay}
            />
          </>
        }
        trayTitle={arrived && !run.done ? 'Delivered · send the next packet' : 'Next hop · tap a numbered node or a button (keys 1–4)'}
        tray={bar}
        msg={run.msg}
        onHint={hint}
        hintDisabled={arrived || !!anim}
        onReset={onReset}
        done={run.done}
        stars={starsFor(run.misses, run.hints)}
        best={best}
        misses={run.misses}
        hints={run.hints}
        winTitle="Every packet delivered"
        next={next}
      />
    </div>
  );
}

/** seconds a hop takes: proportional to the wire length, 0.45–1.1 s */
const hopTime = (g: WireGeo) => Math.max(0.45, Math.min(1.1, g.len / 260));
/** a bounce: out for SPLIT of the time, back for the rest */
const BOUNCE_S = 0.8;
const SPLIT = 0.42;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const backOut = (t: number) => {
  const c = 1.4;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
