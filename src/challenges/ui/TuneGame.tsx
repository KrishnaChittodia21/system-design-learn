// Mode 5, "Tune it": knobs (sliders / steppers / toggles / choices) drive gauges defined by declarative rules.
// Every gauge red until its constraint holds; all green → wires go live and the puzzle completes.
import { useMemo, useState } from 'react';
import { Check, Minus, Plus, X } from 'lucide-react';
import type { Knob, TuneConstraint, TunePuzzle } from '../types';
import {
  constraintHolds,
  constraintRefs,
  evalExpr,
  formatNum,
  gaugeText,
  initialValues,
  interpolate,
  knobDecimals,
  knobValues,
  OP_TEXT,
  snapKnob,
  starsFor,
  tuneVisible,
  type Values,
} from '../logic';
import { Board, type BoardNodeView } from './Board';
import { Frame, NodeText } from './kit';
import { MODE_INFO, useRun, type GameProps } from './run';

export default function TuneGame({ puzzle, best, onComplete, onReset, next }: GameProps<TunePuzzle>) {
  const run = useRun({ title: 'How it works', body: MODE_INFO.tune.how });
  const [values, setValues] = useState<Values>(() => initialValues(puzzle.knobs));
  const [focus, setFocus] = useState<string | null>(null);
  const [hintKnobs, setHintKnobs] = useState<Set<string>>(new Set());
  const passing = useMemo(() => puzzle.constraints.map((c) => constraintHolds(c, values)), [puzzle, values]);
  const nPass = passing.filter(Boolean).length;
  const allPass = nPass === puzzle.constraints.length;

  const setKnob = (k: Knob, raw: number) => {
    if (run.done) return;
    const v = snapKnob(k, raw);
    if (v === values[k.id]) return;
    const nextValues = { ...values, [k.id]: v };
    setValues(nextValues);
    const after = puzzle.constraints.map((c) => constraintHolds(c, nextValues));
    const flipped = puzzle.constraints.filter((_, i) => after[i] !== passing[i]);
    if (after.every(Boolean)) {
      const stars = run.finish();
      run.say('Every gauge is green', 'This configuration satisfies every constraint at once. Read why below.', 'good');
      onComplete(stars);
      return;
    }
    if (flipped.length) {
      const c = flipped[0];
      const ok = after[puzzle.constraints.indexOf(c)];
      const more = flipped.length > 1 ? ` (${flipped.length - 1} other gauge${flipped.length > 2 ? 's' : ''} changed too.)` : '';
      run.say(`${ok ? '✓' : '✗'} ${c.label}`, (ok ? c.pass : c.fail) + more, ok ? 'good' : 'bad');
      setFocus(c.id);
    }
  };

  const explain = (c: TuneConstraint, ok: boolean) => {
    setFocus(c.id);
    if (gaugeText(c, values).na) run.say(`– ${c.label}`, 'Not applicable to the current setting, so it counts as passing.');
    else run.say(`${ok ? '✓' : '✗'} ${c.label}`, ok ? c.pass : c.fail, ok ? 'good' : 'bad');
  };

  const hint = () => {
    const i = passing.findIndex((p) => !p);
    if (i < 0) return;
    const c = puzzle.constraints[i];
    run.hint();
    setFocus(c.id);
    setHintKnobs(constraintRefs(c));
    run.say(`Hint: ${c.label}`, c.hint);
  };

  const shown = tuneVisible(puzzle, values);
  const visible = shown.nodes;
  const nodes: BoardNodeView[] = puzzle.nodes
    .filter((n) => visible.has(n.id))
    .map((n) => ({
      id: n.id,
      col: n.col,
      row: n.row,
      kind: n.kind,
      className: allPass ? 'tuned' : '',
      content: <NodeText label={interpolate(n.label, values, puzzle.knobs)} sub={n.sub ? interpolate(n.sub, values, puzzle.knobs) : undefined} />,
    }));
  const edges = shown.edges.map(([from, to, label]) => ({ from, to, label: label ? interpolate(label, values, puzzle.knobs) : undefined, live: allPass }));

  return (
    <div className="cg-scope">
      <Frame
        puzzle={puzzle}
        status={{ text: allPass ? 'IN SPEC' : nPass ? 'PARTLY IN SPEC' : 'OUT OF SPEC', ok: allPass }}
        counters={[
          { label: 'Gauges', value: `${nPass}/${puzzle.constraints.length}` },
          { label: 'Hints', value: run.hints },
        ]}
        board={<Board label={`${puzzle.title} diagram`} cols={puzzle.cols} rows={puzzle.rows} nodes={nodes} edges={edges} />}
        trayTitle="Knobs · gauges"
        stack
        tray={
          <div className="cg-tune">
            <div className="cg-knobs" role="group" aria-label="Knobs">
              {puzzle.knobs.map((k) => (
                <KnobControl key={k.id} k={k} value={values[k.id]} hinted={hintKnobs.has(k.id)} disabled={run.done} onChange={(v) => setKnob(k, v)} />
              ))}
            </div>
            <div className="cg-gauges" role="group" aria-label="Gauges">
              {puzzle.constraints.map((c, i) => (
                <Gauge key={c.id} c={c} values={values} ok={passing[i]} focused={focus === c.id} onSelect={() => explain(c, passing[i])} />
              ))}
            </div>
          </div>
        }
        msg={run.msg}
        onHint={hint}
        hintDisabled={allPass}
        onReset={onReset}
        done={run.done}
        stars={starsFor(0, run.hints)}
        best={best}
        misses={0}
        hints={run.hints}
        winTitle="Tuned to spec"
        next={next}
      />
    </div>
  );
}

function KnobControl({ k, value, hinted, disabled, onChange }: { k: Knob; value: number; hinted: boolean; disabled: boolean; onChange: (v: number) => void }) {
  const id = `cg-k-${k.id}`;
  const unit = k.unit ?? '';
  const dec = knobDecimals(k);
  const vals = knobValues(k);
  const idx = vals.indexOf(value);
  return (
    <div className={`cg-knob ${hinted ? 'hinted' : ''}`}>
      <div className="cg-knob-top">
        <label htmlFor={id} id={`${id}-l`}>
          {k.label}
        </label>
        {k.kind !== 'choice' && k.kind !== 'toggle' && <output htmlFor={id} className="mono">{formatNum(value, dec, unit)}</output>}
      </div>
      {k.kind === 'slider' && (
        <input
          id={id}
          type="range"
          min={k.min}
          max={k.max}
          step={k.step ?? 1}
          value={value}
          disabled={disabled}
          aria-valuetext={formatNum(value, dec, unit)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
      {k.kind === 'stepper' && (
        <div className="cg-stepper" role="group" aria-labelledby={`${id}-l`}>
          <button type="button" className="btn btn-xs" aria-label={`Decrease ${k.label}`} disabled={disabled || idx <= 0} onClick={() => onChange(vals[idx - 1])}>
            <Minus size={14} aria-hidden />
          </button>
          <span id={id} className="cg-stepper-v mono" aria-live="polite">
            {formatNum(value, dec, unit)}
          </span>
          <button type="button" className="btn btn-xs" aria-label={`Increase ${k.label}`} disabled={disabled || idx >= vals.length - 1} onClick={() => onChange(vals[idx + 1])}>
            <Plus size={14} aria-hidden />
          </button>
        </div>
      )}
      {k.kind === 'toggle' && (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={value === 1}
          aria-labelledby={`${id}-l`}
          className={`cg-switch ${value === 1 ? 'on' : ''}`}
          disabled={disabled}
          onClick={() => onChange(value === 1 ? 0 : 1)}
        >
          <span className="cg-switch-dot" aria-hidden />
          <span aria-hidden>{value === 1 ? 'On' : 'Off'}</span>
        </button>
      )}
      {k.kind === 'choice' && (
        <div id={id} className="cg-choice" role="group" aria-labelledby={`${id}-l`}>
          {(k.choices ?? []).map((c) => (
            <button key={c.value} type="button" aria-pressed={value === c.value} aria-label={`${k.label}: ${c.label}`} disabled={disabled} onClick={() => onChange(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {k.help && <p className="cg-knob-help">{k.help}</p>}
    </div>
  );
}

function Gauge({ c, values, ok, focused, onSelect }: { c: TuneConstraint; values: Values; ok: boolean; focused: boolean; onSelect: () => void }) {
  const shown = gaugeText(c, values);
  const l = evalExpr(c.left, values);
  const r = evalExpr(c.right, values);
  let fill = 1;
  if (shown.na) fill = 0;
  else if ((c.display ?? 'number') !== 'number') fill = ok ? 1 : 0.04;
  else if ((c.op === '<' || c.op === '<=' || c.op === '>' || c.op === '>=') && Number.isFinite(l) && Number.isFinite(r) && r > 0) fill = Math.max(0.04, Math.min(1, l / r));
  const state = ok ? 'passing' : 'failing';
  return (
    <button
      type="button"
      className={`cg-gauge ${ok ? 'ok' : ''} ${shown.na ? 'na' : ''} ${focused ? 'focused' : ''}`}
      onClick={onSelect}
      aria-label={shown.na ? `${c.label}: not applicable. Select for details.` : `${c.label}: ${shown.spoken}, ${state}. Select for details.`}
    >
      <span className="cg-gauge-top">
        <span className="cg-gauge-ic" aria-hidden>
          {shown.na ? <Minus size={13} strokeWidth={3} /> : ok ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}
        </span>
        <span className="cg-gauge-l">{c.label}</span>
      </span>
      <span className="cg-gauge-v mono" aria-hidden>
        {(c.display ?? 'number') === 'number' && !shown.na ? (
          <>
            {formatNum(l, c.decimals ?? 0, c.unit ?? '')} <span className="cg-op">{OP_TEXT[c.op]}</span> {formatNum(r, c.decimals ?? 0, c.unit ?? '')}
          </>
        ) : (
          shown.text
        )}
      </span>
      <span className="cg-gauge-bar" aria-hidden>
        <i style={{ width: `${fill * 100}%` }} />
      </span>
    </button>
  );
}
