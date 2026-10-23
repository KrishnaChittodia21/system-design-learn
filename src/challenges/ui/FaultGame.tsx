// Mode 3, "Fault hunt": a complete-looking design with red alarms. Click the node you suspect; an exposed
// fault becomes a slot to swap with the right replacement card. All faults fixed → alarms recover, wires go green.
import { useMemo, useRef, useState } from 'react';
import { BellRing, Check } from 'lucide-react';
import type { FaultMetric, FaultPuzzle } from '../types';
import { faultFits, faultIds, formatNum, metricValue, shuffled, starsFor } from '../logic';
import { Board, type BoardNodeView } from './Board';
import { Chip, Frame, NodeText } from './kit';
import { MODE_INFO, useRun, type GameProps } from './run';
import { useDrag, useEscape } from './useDrag';
import { replayClass, useTween } from './hooks';

export default function FaultGame({ puzzle, best, onComplete, onReset, next }: GameProps<FaultPuzzle>) {
  const run = useRun({ title: 'How it works', body: MODE_INFO.fault.how });
  const faults = useMemo(() => faultIds(puzzle), [puzzle]);
  const [exposed, setExposed] = useState<Set<string>>(new Set());
  const [fixed, setFixed] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState<string | null>(null);
  const [hinted, setHinted] = useState<{ node: string; opt?: string } | null>(null);
  const [just, setJust] = useState<string | null>(null);
  const order = useMemo(() => shuffled(puzzle.options.map((o) => o.id)), [puzzle]);
  const scope = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const fixedSet = useMemo(() => new Set(Object.keys(fixed)), [fixed]);
  const opt = (id: string) => puzzle.options.find((o) => o.id === id);
  const node = (id: string) => puzzle.nodes.find((x) => x.id === id);
  const shake = (id: string) => replayClass(boardRef.current?.querySelector(`[data-node="${id}"]`), 'shake');

  const expose = (id: string) => {
    const nd = node(id);
    if (!nd?.fault || exposed.has(id)) return;
    setExposed(new Set(exposed).add(id));
    setJust(id);
  };

  /** clicking a node without a card: inspect it */
  const inspect = (id: string) => {
    const nd = node(id);
    if (!nd || run.done || fixed[id]) return;
    if (nd.fault) {
      if (!exposed.has(id)) expose(id);
      run.say(`⚠ Found it: ${nd.label}`, `${nd.fault.why} Now drag the replacement into it (clue: “${nd.fault.clue}”).`, 'bad');
      return;
    }
    if (cleared.has(id)) {
      run.say(`${nd.label} is fine`, nd.fine ?? '');
      return;
    }
    run.miss();
    setCleared(new Set(cleared).add(id));
    shake(id);
    run.say(`✗ ${nd.label} is fine`, nd.fine ?? 'Nothing is wrong with this component.', 'bad');
  };

  /** dropping (or tapping) a card onto a node */
  const swap = (optId: string, id: string) => {
    const nd = node(id);
    const o = opt(optId);
    if (!nd || !o || run.done || fixed[id]) return;
    setArmed(null);
    if (!nd.fault) {
      inspect(id);
      return;
    }
    if (!exposed.has(id)) expose(id);
    if (faultFits(puzzle, id, optId)) {
      const nextFixed = { ...fixed, [id]: optId };
      setFixed(nextFixed);
      setJust(id);
      setHinted(null);
      run.say(`✓ ${o.label} fixes it`, `It is ${o.is}.`, 'good');
      if (faults.every((f) => nextFixed[f])) {
        const stars = run.finish();
        run.say('All alarms cleared', 'Every fault is fixed and the metrics are back to healthy. Read why below.', 'good');
        onComplete(stars);
      }
    } else {
      run.miss();
      shake(id);
      const elsewhere = faults.some((f) => node(f)?.fault?.answer === optId && !fixed[f]);
      run.say(
        `✗ ${o.label} won't fix this`,
        `${o.label} is ${o.is}. This fault needs: “${nd.fault.clue}”.` +
          (o.decoy ? ' (This card is a decoy and fixes nothing here.)' : elsewhere ? ' It fixes a different fault in this design.' : ''),
        'bad',
      );
    }
  };

  const toggleArm = (id: string) => {
    if (run.done) return;
    const nextArmed = armed === id ? null : id;
    setArmed(nextArmed);
    const o = nextArmed ? opt(nextArmed) : null;
    if (o) run.say(`Holding: ${o.label}`, 'Now tap the faulty component it replaces (or Tab to it and press Enter). Esc puts it back.');
  };
  const drag = useDrag({ scope, onDrop: (src, target) => swap(src, target), onTap: toggleArm });
  useEscape(!!armed, () => {
    const back = armed;
    setArmed(null);
    scope.current?.querySelector<HTMLElement>(`[data-opt="${back}"]`)?.focus();
    run.say('Put back', 'Pick a card to try again.');
  });

  const hint = () => {
    const f = faults.find((x) => !fixed[x]);
    const nd = f ? node(f) : undefined;
    if (!nd?.fault) return;
    run.hint();
    if (!exposed.has(nd.id)) {
      setHinted({ node: nd.id });
      run.say('Hint', `Look closely at the pulsing component. Which alarm would its setting cause?`);
    } else {
      setHinted({ node: nd.id, opt: nd.fault.answer });
      replayClass(scope.current?.querySelector(`[data-opt="${nd.fault.answer}"]`), 'hinted');
      run.say('Hint', `The glowing card replaces “${nd.label}”.`);
    }
  };

  const nodes: BoardNodeView[] = puzzle.nodes.map((n) => {
    const base = { id: n.id, col: n.col, row: n.row, kind: n.kind };
    const f = fixed[n.id];
    const o = f ? opt(f) : undefined;
    if (o) {
      return { ...base, className: `slot filled ${just === n.id ? 'pop' : ''}`, content: <NodeText label={o.label} sub={o.sub} />, ariaLabel: `${o.label}, fixed` };
    }
    if (n.fault && exposed.has(n.id)) {
      return {
        ...base,
        className: `slot exposed ${armed ? 'armed' : ''} ${hinted?.node === n.id ? 'target' : ''} ${just === n.id ? 'pop' : ''}`,
        drop: true,
        onClick: () => (armed ? swap(armed, n.id) : inspect(n.id)),
        ariaLabel: `Faulty: ${n.label}. Needs: ${n.fault.clue}`,
        content: (
          <>
            <span className="cg-was">{n.label}</span>
            <span className="clue">{n.fault.clue}</span>
          </>
        ),
      };
    }
    if (n.kind === 'terminal') return { ...base, content: <NodeText label={n.label} sub={n.sub} /> };
    const ok = cleared.has(n.id);
    return {
      ...base,
      className: `suspect ${ok ? 'cleared' : ''} ${hinted?.node === n.id ? 'hint-pulse' : ''}`,
      drop: !ok,
      onClick: () => (armed ? swap(armed, n.id) : inspect(n.id)),
      ariaLabel: `${n.label}${n.sub ? `, ${n.sub}` : ''}${ok ? ' (checked: fine)' : ', inspect'}`,
      content: (
        <>
          {ok && <Check size={13} strokeWidth={3} className="cg-ok-ic" aria-hidden />}
          <NodeText label={n.label} sub={n.sub} />
        </>
      ),
    };
  });

  const used = new Set(Object.values(fixed));
  const left = order.filter((id) => !used.has(id));
  const nFixed = Object.keys(fixed).length;
  return (
    <div ref={scope} className="cg-scope">
      <Frame
        puzzle={puzzle}
        status={{ text: run.done ? 'HEALTHY' : nFixed ? 'DEGRADED' : 'ALARMING', ok: run.done }}
        counters={[
          { label: 'Fixed', value: `${nFixed}/${faults.length}` },
          { label: 'Misses', value: run.misses },
        ]}
        board={
          <>
            <div className="cg-metrics" role="group" aria-label="Alarms">
              {puzzle.metrics.map((m) => (
                <MetricTile key={m.label} m={m} fixed={fixedSet} faults={faults} />
              ))}
            </div>
            <Board
              boardRef={boardRef}
              label={`${puzzle.title} diagram. Select a component to inspect it.`}
              cols={puzzle.cols}
              rows={puzzle.rows}
              nodes={nodes}
              edges={puzzle.edges.map(([from, to, label]) => ({ from, to, label, live: run.done }))}
            />
          </>
        }
        trayTitle="Replacements · find a fault, then drag one in"
        tray={
          <div className="cg-tray" role="group" aria-label="Replacement cards">
            {left.map((id) => {
              const x = opt(id)!;
              return <Chip key={id} id={id} label={x.label} sub={x.sub} pressed={armed === id} hinted={hinted?.opt === id} dragProps={drag(id)} />;
            })}
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
        winTitle="All faults fixed"
        next={next}
      />
    </div>
  );
}

function MetricTile({ m, fixed, faults }: { m: FaultMetric; fixed: ReadonlySet<string>; faults: string[] }) {
  const target = metricValue(m, fixed, faults);
  const shown = useTween(target);
  const healthy = Math.abs(target - m.good) < 1e-9;
  return (
    <div className={`cg-metric ${healthy ? 'ok' : ''}`}>
      <span className="cg-metric-l">
        <BellRing size={13} aria-hidden /> {m.label}
      </span>
      <span className="cg-metric-v mono" aria-hidden>
        {formatNum(shown, m.decimals ?? 0, m.unit ?? '')}
      </span>
      <span className="sr-only">
        {formatNum(target, m.decimals ?? 0, m.unit ?? '')}, {healthy ? 'healthy' : 'alarming'}
      </span>
      <span className="cg-metric-s mono" aria-hidden>
        {healthy ? 'healthy' : `target ${formatNum(m.good, m.decimals ?? 0, m.unit ?? '')}`}
      </span>
    </div>
  );
}
