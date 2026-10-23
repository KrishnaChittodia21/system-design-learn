// Mode 4, "Patch cables": connect each left item to the right item it belongs with. A correct cable turns
// green and glows; a wrong one snaps back with an explanation. Right-hand decoys are allowed.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MatchPuzzle } from '../types';
import { matchFits, shuffled, starsFor } from '../logic';
import { Frame } from './kit';
import { MODE_INFO, useRun, type GameProps } from './run';
import { useDrag, useEscape } from './useDrag';
import { replayClass, useReducedMotion } from './hooks';

type Pt = { x: number; y: number };

/** "Symptom" → "symptom", but "API change" / "SLO" keep their capitals */
const lowerFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

const cable = (a: Pt, b: Pt) => {
  const dx = Math.max(24, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${(a.x + dx).toFixed(1)} ${a.y.toFixed(1)} ${(b.x - dx).toFixed(1)} ${b.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
};

export default function MatchGame({ puzzle, best, onComplete, onReset, next }: GameProps<MatchPuzzle>) {
  const run = useRun({ title: 'How it works', body: MODE_INFO.match.how });
  const [links, setLinks] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState<string | null>(null);
  const [hinted, setHinted] = useState<{ l: string; r: string } | null>(null);
  const [snap, setSnap] = useState<{ l: string; r: string; n: number } | null>(null);
  const [pointer, setPointer] = useState<{ id: string; p: Pt } | null>(null);
  const rightOrder = useMemo(() => shuffled(puzzle.right.map((r) => r.id)), [puzzle]);
  const scope = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, '');
  const reduce = useReducedMotion();
  const left = (id: string) => puzzle.left.find((l) => l.id === id);
  const right = (id: string) => puzzle.right.find((r) => r.id === id);
  const nLinked = Object.keys(links).length;
  // a wrong cable shows for a moment, then snaps back
  useEffect(() => {
    if (!snap) return;
    const t = setTimeout(() => setSnap(null), 750);
    return () => clearTimeout(t);
  }, [snap]);

  // socket centres in the area's coordinates: re-measured on resize (incl. un-hiding) and after state changes
  const [sockets, setSockets] = useState<{ key: string; pts: Record<string, Pt> }>({ key: '', pts: {} });
  const measure = useCallback(() => {
    const box = area.current;
    if (!box) return;
    const b = box.getBoundingClientRect();
    const pts: Record<string, Pt> = {};
    box.querySelectorAll<HTMLElement>('[data-socket]').forEach((el) => {
      const r = el.getBoundingClientRect();
      pts[el.dataset.socket!] = { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 };
    });
    const key = JSON.stringify(pts);
    setSockets((prev) => (prev.key === key ? prev : { key, pts }));
  }, []);
  useLayoutEffect(() => {
    const box = area.current;
    if (!box) return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [measure]);
  useLayoutEffect(measure, [measure, links, armed, hinted, run.msg]);
  const snapCount = useRef(0);

  const connect = (lId: string, rId: string) => {
    const l = left(lId);
    const r = right(rId);
    if (!l || !r || links[lId] || run.done) return;
    setArmed(null);
    if (matchFits(puzzle, lId, rId)) {
      const nextLinks = { ...links, [lId]: rId };
      setLinks(nextLinks);
      setHinted(null);
      run.say(`✓ ${r.label}`, l.because, 'good');
      if (puzzle.left.every((x) => nextLinks[x.id])) {
        const stars = run.finish();
        run.say('Every cable is live', 'All pairs are patched. Read why each one fits below.', 'good');
        onComplete(stars);
      }
    } else {
      run.miss();
      snapCount.current += 1;
      setSnap({ l: lId, r: rId, n: snapCount.current });
      replayClass(area.current?.querySelector(`[data-drop="r:${rId}"]`), 'shake');
      const other = puzzle.left.some((x) => x.answer === rId && x.id !== lId);
      run.say(
        `✗ ${r.label} doesn't fix that`,
        `${r.label} is ${r.is}.` + (r.decoy ? ' (A decoy: it is not the answer for any item here.)' : other ? ' It is the answer for a different item.' : ''),
        'bad',
      );
    }
  };

  const toggleArm = (id: string) => {
    if (run.done || links[id]) return;
    const nextArmed = armed === id ? null : id;
    setArmed(nextArmed);
    const l = nextArmed ? left(nextArmed) : null;
    if (l) run.say(`Cable in hand: ${l.label}`, `Now tap the item under “${puzzle.rightTitle}” it connects to (or Tab to it and press Enter). Esc drops the cable.`);
  };
  const drag = useDrag({
    scope,
    ghost: false,
    onDrop: (src, target) => connect(src, target.slice(2)),
    onTap: toggleArm,
    onMove: (id, p) => {
      const b = area.current?.getBoundingClientRect();
      setPointer(p && b ? { id, p: { x: p.x - b.left, y: p.y - b.top } } : null);
    },
  });
  useEscape(!!armed, () => {
    const back = armed;
    setArmed(null);
    scope.current?.querySelector<HTMLElement>(`[data-src="${back}"]`)?.focus();
    run.say('Cable dropped', 'Pick an item on the left to try again.');
  });

  const hint = () => {
    const l = puzzle.left.find((x) => !links[x.id]);
    if (!l) return;
    run.hint();
    setHinted({ l: l.id, r: l.answer });
    run.say('Hint', `“${l.label}” connects to the glowing item on the right.`);
  };

  const pts = sockets.pts;
  const cables = Object.entries(links).flatMap(([l, r]) => (pts[`l:${l}`] && pts[`r:${r}`] ? [{ l, r, d: cable(pts[`l:${l}`], pts[`r:${r}`]) }] : []));
  const live = pointer && pts[`l:${pointer.id}`] ? cable(pts[`l:${pointer.id}`], pointer.p) : null;
  const snapD = snap && pts[`l:${snap.l}`] && pts[`r:${snap.r}`] ? cable(pts[`l:${snap.l}`], pts[`r:${snap.r}`]) : null;

  return (
    <div ref={scope} className="cg-scope">
      <Frame
        puzzle={puzzle}
        status={{ text: run.done ? 'ALL PATCHED' : nLinked ? 'PATCHING' : 'UNPLUGGED', ok: run.done }}
        counters={[
          { label: 'Patched', value: `${nLinked}/${puzzle.left.length}` },
          { label: 'Misses', value: run.misses },
        ]}
        board={
          <div ref={area} className="cg-match" role="group" aria-label={`${puzzle.title}: connect ${puzzle.leftTitle} to ${puzzle.rightTitle}`}>
            <svg className="cg-cables" width="100%" height="100%" aria-hidden>
              {cables.map((c, i) => (
                <g key={c.l}>
                  <path id={`${uid}-c${i}`} d={c.d} className="cg-cable live" />
                  {!reduce && (
                    <circle r="3.5" className="cg-packet">
                      <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${(i * 0.35).toFixed(2)}s`}>
                        <mpath href={`#${uid}-c${i}`} />
                      </animateMotion>
                    </circle>
                  )}
                </g>
              ))}
              {snapD && <path key={snap!.n} d={snapD} className="cg-cable snap" />}
              {live && <path d={live} className="cg-cable pending" />}
            </svg>
            <div className="cg-mcol l">
              <p className="cg-mtitle">{puzzle.leftTitle}</p>
              {puzzle.left.map((l) => {
                const linked = !!links[l.id];
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`cg-mitem l ${linked ? 'linked' : ''} ${hinted?.l === l.id ? 'hinted' : ''}`}
                    aria-pressed={armed === l.id}
                    aria-label={linked ? `${l.label}: connected to ${right(links[l.id])?.label}` : undefined}
                    aria-disabled={linked || undefined}
                    data-src={l.id}
                    {...(linked ? {} : drag(l.id))}
                  >
                    <span className="cg-mtext">
                      <span className="cg-node-l">{l.label}</span>
                      {l.sub && <small>{l.sub}</small>}
                    </span>
                    <span className="cg-socket" data-socket={`l:${l.id}`} aria-hidden />
                  </button>
                );
              })}
            </div>
            <div className="cg-mcol r">
              <p className="cg-mtitle">{puzzle.rightTitle}</p>
              {rightOrder.map((id) => {
                const r = right(id)!;
                const linked = Object.values(links).includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`cg-mitem r ${linked ? 'linked' : ''} ${armed ? 'armed' : ''} ${hinted?.r === id ? 'target' : ''}`}
                    data-drop={`r:${id}`}
                    onClick={() =>
                      armed ? connect(armed, id) : run.say(`Pick from “${puzzle.leftTitle}” first`, 'Tap an item on the left, then tap the one it connects to here.')
                    }
                  >
                    <span className="cg-socket" data-socket={`r:${id}`} aria-hidden />
                    <span className="cg-mtext">
                      <span className="cg-node-l">{r.label}</span>
                      {r.sub && <small>{r.sub}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        }
        trayTitle={puzzle.instruction ?? `Connect each ${lowerFirst(puzzle.leftTitle)} to its ${lowerFirst(puzzle.rightTitle)}`}
        tray={<p className="cg-howto">Mouse or touch: drag a cable from the socket on the left. Keyboard: Enter on a left item, then Enter on a right item.</p>}
        msg={run.msg}
        onHint={hint}
        onReset={onReset}
        done={run.done}
        stars={starsFor(run.misses, run.hints)}
        best={best}
        misses={run.misses}
        hints={run.hints}
        winTitle="All cables patched"
        next={next}
      />
    </div>
  );
}
