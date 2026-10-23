// Mode 1, "Fix the flow": drag the right component into every red slot of a node/edge diagram.
import { useMemo, useRef, useState } from 'react';
import type { FlowPuzzle } from '../types';
import { flowFits, flowSlots, shuffled, starsFor } from '../logic';
import { Board, type BoardNodeView } from './Board';
import { Chip, Frame, NodeText } from './kit';
import { MODE_INFO, useRun, type GameProps } from './run';
import { useDrag, useEscape } from './useDrag';
import { replayClass } from './hooks';

export default function FlowGame({ puzzle, best, onComplete, onReset, next }: GameProps<FlowPuzzle>) {
  const run = useRun({ title: 'How it works', body: MODE_INFO.flow.how });
  const [filled, setFilled] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState<string | null>(null);
  const [hinted, setHinted] = useState<{ opt: string; slot: string } | null>(null);
  const [just, setJust] = useState<string | null>(null);
  const order = useMemo(() => shuffled(puzzle.options.map((o) => o.id)), [puzzle]);
  const scope = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const slots = flowSlots(puzzle);
  const opt = (id: string) => puzzle.options.find((o) => o.id === id);
  const used = new Set(Object.values(filled));
  const fixedCount = Object.keys(filled).length;
  const isOk = (id: string) => {
    const n = puzzle.nodes.find((x) => x.id === id);
    return !!n && (!n.answer || filled[n.id] === n.answer);
  };

  const place = (optId: string, slotId: string) => {
    const n = puzzle.nodes.find((x) => x.id === slotId);
    const o = opt(optId);
    if (!n?.answer || !o || filled[slotId] || run.done) return;
    setArmed(null);
    if (flowFits(puzzle, slotId, optId)) {
      const nextFilled = { ...filled, [slotId]: optId };
      setFilled(nextFilled);
      setJust(slotId);
      setHinted(null);
      run.say(`✓ ${o.label} fits`, `It is ${o.is}, which is exactly what “${n.hint}” asks for.`, 'good');
      if (Object.keys(nextFilled).length === slots.length) {
        const stars = run.finish();
        run.say('Everything is green', 'The request flows end to end. Read why each piece is there below.', 'good');
        onComplete(stars);
      }
    } else {
      run.miss();
      replayClass(boardRef.current?.querySelector(`[data-node="${slotId}"]`), 'shake');
      const elsewhere = slots.some((s) => s.answer === optId);
      run.say(
        `✗ Not ${o.label} here`,
        `${o.label} is ${o.is}. This slot's clue is “${n.hint}”.` +
          (o.decoy ? ' (This card is a decoy and fits nowhere in this flow.)' : elsewhere ? ' It does belong somewhere else in this flow.' : ''),
        'bad',
      );
    }
  };

  const toggleArm = (id: string) => {
    if (run.done) return;
    const nextArmed = armed === id ? null : id;
    setArmed(nextArmed);
    const o = nextArmed ? opt(nextArmed) : null;
    if (o) run.say(`Holding: ${o.label}`, 'Now tap the red slot where it belongs (or Tab to it and press Enter). Tap the card again or press Esc to put it back.');
  };
  const drag = useDrag({ scope, onDrop: (src, target) => place(src, target), onTap: toggleArm });
  useEscape(!!armed, () => {
    const back = armed;
    setArmed(null);
    scope.current?.querySelector<HTMLElement>(`[data-opt="${back}"]`)?.focus();
    run.say('Put back', 'Pick a card to try again.');
  });

  const hint = () => {
    const empty = slots.find((s) => !filled[s.id]);
    if (!empty?.answer) return;
    run.hint();
    setHinted({ opt: empty.answer, slot: empty.id });
    replayClass(scope.current?.querySelector(`[data-opt="${empty.answer}"]`), 'hinted');
    run.say('Hint', `The glowing card belongs in the slot whose clue is “${empty.hint}”.`);
  };

  const nodes: BoardNodeView[] = puzzle.nodes.map((n) => {
    if (!n.answer) return { id: n.id, col: n.col, row: n.row, kind: n.kind, content: <NodeText label={n.label} sub={n.sub} /> };
    const f = filled[n.id];
    const o = f ? opt(f) : undefined;
    if (o) {
      return {
        id: n.id,
        col: n.col,
        row: n.row,
        kind: n.kind,
        className: `slot filled ${just === n.id ? 'pop' : ''}`,
        content: <NodeText label={o.label} sub={o.sub} />,
        ariaLabel: `${o.label}, placed correctly`,
      };
    }
    return {
      id: n.id,
      col: n.col,
      row: n.row,
      kind: n.kind,
      className: `slot ${armed ? 'armed' : ''} ${hinted?.slot === n.id ? 'target' : ''}`,
      drop: true,
      content: (
        <>
          <span className="q" aria-hidden>
            ?
          </span>
          <span className="clue">{n.hint}</span>
        </>
      ),
      ariaLabel: `Empty slot: ${n.hint}`,
      onClick: () => (armed ? place(armed, n.id) : run.say('Pick a card first', 'Tap a component card below, then tap this slot.')),
    };
  });

  const left = order.filter((id) => !used.has(id));
  return (
    <div ref={scope} className="cg-scope">
      <Frame
        puzzle={puzzle}
        status={{ text: run.done ? 'FLOWING' : fixedCount ? 'PARTLY BROKEN' : 'BROKEN', ok: run.done }}
        counters={[
          { label: 'Fixed', value: `${fixedCount}/${slots.length}` },
          { label: 'Misses', value: run.misses },
        ]}
        board={
          <Board
            boardRef={boardRef}
            label={`${puzzle.title} diagram`}
            cols={puzzle.cols}
            rows={puzzle.rows}
            nodes={nodes}
            edges={puzzle.edges.map(([from, to, label]) => ({ from, to, label, live: isOk(from) && isOk(to) }))}
          />
        }
        trayTitle="Components · drag into a red slot"
        tray={
          <div className="cg-tray" role="group" aria-label="Component cards">
            {left.map((id) => {
              const o = opt(id)!;
              return <Chip key={id} id={id} label={o.label} sub={o.sub} pressed={armed === id} hinted={hinted?.opt === id} dragProps={drag(id)} />;
            })}
            {!left.length && <span className="cg-empty">Only decoys were left, and they are gone too. Nicely done.</span>}
            {run.done && left.length > 0 && <span className="cg-empty">The rest are decoys.</span>}
          </div>
        }
        msg={run.msg}
        onHint={hint}
        onReset={onReset}
        done={run.done}
        stars={starsFor(run.misses, run.hints)}
        best={best}
        misses={run.misses}
        hints={run.hints}
        winTitle="Flow restored"
        next={next}
      />
    </div>
  );
}

