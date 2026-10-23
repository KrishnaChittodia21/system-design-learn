// Mode 2, "Sequence it": drop step cards into numbered positions, either as a two-actor message ladder
// (client ↔ server) or as pipeline stages on the board. Placed steps light up; packets flow to the first gap.
import { useMemo, useRef, useState } from 'react';
import type { SequencePuzzle, SequenceStep } from '../types';
import { sequenceFits, sequencePrefix, shuffled, starsFor } from '../logic';
import { Board, type BoardNodeView } from './Board';
import { Chip, Frame, NodeText } from './kit';
import { MODE_INFO, useRun, type GameProps } from './run';
import { useDrag, useEscape } from './useDrag';
import { replayClass, useReducedMotion } from './hooks';

const posId = (i: number) => `pos-${i}`;

export default function SequenceGame({ puzzle, best, onComplete, onReset, next }: GameProps<SequencePuzzle>) {
  const run = useRun({ title: 'How it works', body: MODE_INFO.sequence.how });
  const n = puzzle.steps.length;
  const [filled, setFilled] = useState<(string | undefined)[]>(() => Array(n).fill(undefined));
  const [armed, setArmed] = useState<string | null>(null);
  const [hinted, setHinted] = useState<{ step: string; pos: number } | null>(null);
  const [just, setJust] = useState<number | null>(null);
  const all = useMemo(() => [...puzzle.steps, ...puzzle.decoys], [puzzle]);
  const order = useMemo(() => shuffled(all.map((s) => s.id)), [all]);
  const scope = useRef<HTMLDivElement>(null);
  const step = (id: string) => all.find((s) => s.id === id);
  const placed = filled.filter(Boolean).length;
  const prefix = sequencePrefix(filled);
  const used = new Set(filled.filter(Boolean));

  const place = (stepId: string, pos: number) => {
    const s = step(stepId);
    if (!s || filled[pos] || run.done) return;
    setArmed(null);
    const clue = puzzle.steps[pos]?.clue;
    if (sequenceFits(puzzle, pos, stepId)) {
      const nextFilled = filled.map((x, i) => (i === pos ? stepId : x));
      setFilled(nextFilled);
      setJust(pos);
      setHinted(null);
      run.say(`✓ Step ${pos + 1}: ${s.label}`, `It is ${s.is}.`, 'good');
      if (nextFilled.every(Boolean)) {
        const stars = run.finish();
        run.say('The whole sequence runs', 'Every step is in place, start to finish. Read why the order matters below.', 'good');
        onComplete(stars);
      }
    } else {
      run.miss();
      replayClass(scope.current?.querySelector(`[data-drop="${posId(pos)}"]`), 'shake');
      const right = puzzle.steps.findIndex((x) => x.id === stepId);
      const where = s.id && right >= 0 ? (right < pos ? ' It happens earlier than this.' : ' It happens later than this.') : '';
      run.say(
        `✗ Not step ${pos + 1}`,
        `${s.label} is ${s.is}.` + (clue ? ` Step ${pos + 1}'s clue is “${clue}”.` : '') + (right < 0 ? ' (This step never happens in this flow.)' : where),
        'bad',
      );
    }
  };

  const toggleArm = (id: string) => {
    if (run.done) return;
    const nextArmed = armed === id ? null : id;
    setArmed(nextArmed);
    const s = nextArmed ? step(nextArmed) : null;
    if (s) run.say(`Holding: ${s.label}`, 'Now tap the numbered position where it happens (or Tab to it and press Enter). Esc puts it back.');
  };
  const drag = useDrag({ scope, onDrop: (src, target) => place(src, Number(target.slice(4))), onTap: toggleArm });
  useEscape(!!armed, () => {
    const back = armed;
    setArmed(null);
    scope.current?.querySelector<HTMLElement>(`[data-opt="${back}"]`)?.focus();
    run.say('Put back', 'Pick a step to try again.');
  });

  const hint = () => {
    const pos = filled.findIndex((x) => !x);
    if (pos < 0) return;
    const want = puzzle.steps[pos];
    run.hint();
    setHinted({ step: want.id, pos });
    replayClass(scope.current?.querySelector(`[data-opt="${want.id}"]`), 'hinted');
    run.say('Hint', `The glowing card is step ${pos + 1}.${want.clue ? ` Its clue: “${want.clue}”.` : ''}`);
  };

  const onSlot = (pos: number) =>
    armed ? place(armed, pos) : run.say('Pick a step first', 'Tap a step card below, then tap this position.');

  const left = order.filter((id) => !used.has(id));
  const view = {
    filled,
    armed: !!armed,
    hintedPos: hinted?.pos ?? -1,
    just,
    prefix,
    step,
    onSlot,
  };
  return (
    <div ref={scope} className="cg-scope">
      <Frame
        puzzle={puzzle}
        status={{ text: run.done ? 'RUNNING' : placed ? 'PARTIAL' : 'OUT OF ORDER', ok: run.done }}
        counters={[
          { label: 'Placed', value: `${placed}/${n}` },
          { label: 'Misses', value: run.misses },
        ]}
        board={puzzle.layout === 'ladder' ? <Ladder puzzle={puzzle} {...view} /> : <Stages puzzle={puzzle} {...view} />}
        trayTitle="Steps · drag into a numbered position"
        tray={
          <div className="cg-tray" role="group" aria-label="Step cards">
            {left.map((id) => {
              const s = step(id)!;
              return (
                <Chip
                  key={id}
                  id={id}
                  label={s.label}
                  sub={s.sub ?? arrowText(puzzle, s)}
                  pressed={armed === id}
                  hinted={hinted?.step === id}
                  dragProps={drag(id)}
                />
              );
            })}
            {run.done && left.length > 0 && <span className="cg-empty">The rest never happen in this flow.</span>}
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
        winTitle="Sequence complete"
        next={next}
      />
    </div>
  );
}

/** "Client → Server" caption for ladder cards */
function arrowText(p: SequencePuzzle, s: SequenceStep): string | undefined {
  if (p.layout !== 'ladder' || !s.from || !s.to) return undefined;
  const name = (id: string) => p.actors?.find((a) => a.id === id)?.label ?? id;
  return `${name(s.from)} → ${name(s.to)}`;
}

interface ViewProps {
  puzzle: SequencePuzzle;
  filled: (string | undefined)[];
  armed: boolean;
  hintedPos: number;
  just: number | null;
  prefix: number;
  step: (id: string) => SequenceStep | undefined;
  onSlot: (pos: number) => void;
}

function Ladder({ puzzle, filled, armed, hintedPos, just, prefix, step, onSlot }: ViewProps) {
  const reduce = useReducedMotion();
  const [a, b] = puzzle.actors ?? [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];
  return (
    <div className="cg-ladder" role="group" aria-label={`${puzzle.title}: message sequence between ${a.label} and ${b.label}`}>
      <div className="cg-lifeline l" aria-hidden />
      <div className="cg-lifeline r" aria-hidden />
      <div className="cg-actors">
        {[a, b].map((x, i) => (
          <div key={x.id} className={`cg-actor ${i ? 'r' : 'l'}`}>
            <span className="cg-node-l">{x.label}</span>
            {x.sub && <small>{x.sub}</small>}
          </div>
        ))}
      </div>
      <ol className="cg-lrows">
        {puzzle.steps.map((want, i) => {
          const id = filled[i];
          const s = id ? step(id) : undefined;
          const rightward = s ? s.from !== b.id : true;
          const flowing = !!s && i < prefix;
          return (
            <li key={want.id} className={`cg-lrow ${s ? 'filled' : ''} ${flowing ? 'flowing' : ''}`}>
              <span className="cg-lnum" aria-hidden>
                {i + 1}
              </span>
              <svg className="cg-larrow" width="100%" height="100%" aria-hidden>
                <line
                  x1={rightward ? '20%' : '80%'}
                  x2={rightward ? '80%' : '20%'}
                  y1="80%"
                  y2="80%"
                  className={`cg-edge ${s ? 'live' : ''}`}
                  markerEnd={s ? 'url(#cg-lad-ah)' : undefined}
                />
              </svg>
              {flowing && !reduce && <span className={`cg-lpacket ${rightward ? 'r' : 'l'}`} style={{ animationDelay: `${i * 0.25}s` }} aria-hidden />}
              {s ? (
                <div className={`cg-lslot filled ${just === i ? 'pop' : ''}`} aria-label={`Step ${i + 1}: ${s.label}, placed correctly`} role="img">
                  <span className="cg-node-l">{s.label}</span>
                  {s.sub && <small>{s.sub}</small>}
                </div>
              ) : (
                <button
                  type="button"
                  className={`cg-lslot slot ${armed ? 'armed' : ''} ${hintedPos === i ? 'target' : ''}`}
                  data-drop={posId(i)}
                  aria-label={`Empty step ${i + 1}${want.clue ? `: ${want.clue}` : ''}`}
                  onClick={() => onSlot(i)}
                >
                  <span className="q" aria-hidden>
                    ?
                  </span>
                  <span className="clue">{want.clue ?? `Step ${i + 1}`}</span>
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <svg width="0" height="0" className="cg-defs" aria-hidden>
        <defs>
          <marker id="cg-lad-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="cg-ah-good" />
          </marker>
        </defs>
      </svg>
    </div>
  );
}

function Stages({ puzzle, filled, armed, hintedPos, just, prefix, step, onSlot }: ViewProps) {
  const n = puzzle.steps.length;
  const perRow = n <= 5 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / perRow);
  const at = (i: number) => {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    // centred in the board's band (1.3 rows for one line of stages, 2.3 for two), leaving room for the badges
    return { col: r % 2 === 0 ? c : perRow - 1 - c, row: rows === 1 ? 0.15 : 0.025 + r * 1.25 };
  };
  const nodes: BoardNodeView[] = puzzle.steps.map((want, i) => {
    const id = filled[i];
    const s = id ? step(id) : undefined;
    const { col, row } = at(i);
    if (s) {
      return {
        id: posId(i),
        col,
        row,
        className: `slot filled ${just === i ? 'pop' : ''}`,
        content: (
          <>
            <span className="cg-stage-n">{i + 1}</span>
            <NodeText label={s.label} sub={s.sub} />
          </>
        ),
        ariaLabel: `Stage ${i + 1}: ${s.label}, placed correctly`,
      };
    }
    return {
      id: posId(i),
      col,
      row,
      className: `slot ${armed ? 'armed' : ''} ${hintedPos === i ? 'target' : ''}`,
      drop: true,
      onClick: () => onSlot(i),
      ariaLabel: `Empty stage ${i + 1}${want.clue ? `: ${want.clue}` : ''}`,
      content: (
        <>
          <span className="cg-stage-n">{i + 1}</span>
          <span className="q" aria-hidden>
            ?
          </span>
          <span className="clue">{want.clue ?? `Stage ${i + 1}`}</span>
        </>
      ),
    };
  });
  const edges = puzzle.steps.slice(1).map((_, i) => ({
    from: posId(i),
    to: posId(i + 1),
    live: !!filled[i] && !!filled[i + 1],
    flowing: i + 1 < prefix,
  }));
  return <Board label={`${puzzle.title}: pipeline stages`} cols={perRow} rows={rows === 1 ? 1.3 : 2.3} nodes={nodes} edges={edges} />;
}
