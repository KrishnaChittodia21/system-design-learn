import { useState } from 'react';
import { VizFrame, useFrames, type Stepper } from '../../core';
import { meta } from './meta';
import { FRAGMENTS, SLOTS, STEPS, assess, byId, type Choices, type Slot } from './sim';
import './star.css';

const LEVEL = ['missing', 'partial', 'strong'];
/** fixed, varied display order so the strongest fragment isn't always in the same slot */
const ORDER: Record<Slot, number[]> = { S: [0, 2, 1], T: [2, 0, 1], A: [0, 1, 2], R: [1, 2, 0], L: [2, 0, 1] };

export default function StarStoryBuilderViz() {
  const stepper = useFrames(STEPS);
  const [choices, setChoices] = useState<Choices>({});
  const step = stepper.frame;
  const a = assess(choices);
  const slotMeta = SLOTS.find((s) => s.id === step.slot);
  const chosen = step.slot !== 'debrief' ? byId(choices[step.slot]) : undefined;

  const caption =
    step.slot === 'debrief'
      ? `Score ${a.score}/100. ${a.verdict} ≈${Math.round(a.seconds.total / 6) / 10} min spoken.`
      : chosen
        ? `${slotMeta!.name}: ${chosen.note}`
        : `${slotMeta!.name} (${slotMeta!.budget}). Pick one of the three fragments; the signal meters update as you build.`;
  const view: Stepper = { ...stepper, frame: { caption, predict: step.slot === 'A' && !chosen ? 'Which fragment would make the interviewer write “candidate” as the subject of a sentence?' : undefined } };

  const choose = (slot: Slot, id: string) => setChoices((c) => ({ ...c, [slot]: id }));
  const options =
    step.slot === 'debrief'
      ? []
      : ORDER[step.slot].map((i) => FRAGMENTS.filter((f) => f.slot === step.slot)[i]);
  const budget = [
    { k: 'S+T', v: a.seconds.st, lo: 30, hi: 40 },
    { k: 'Action', v: a.seconds.a, lo: 90, hi: 120 },
    { k: 'R+L', v: a.seconds.rl, lo: 30, hi: 45 },
  ];

  return (
    <VizFrame title={meta.title} blurb={meta.blurb} stepper={view}>
      <div className="star">
        <p className="star-prompt">
          <span className="star-q">Prompt</span> “Tell me about a time you improved a system’s performance.”
        </p>
        <nav className="star-tabs" aria-label="Story parts">
          {STEPS.map((s, k) => {
            const done = s.slot !== 'debrief' && !!choices[s.slot];
            return (
              <button
                key={s.slot}
                type="button"
                className={`star-tab ${k === stepper.i ? 'on' : ''} ${done ? 'done' : ''}`}
                aria-current={k === stepper.i ? 'step' : undefined}
                onClick={() => stepper.seek(k)}
              >
                {s.slot === 'debrief' ? 'Debrief' : s.slot}
                {done && <span aria-label=" chosen"> ✓</span>}
              </button>
            );
          })}
          <button type="button" className="star-tab star-clear" onClick={() => setChoices({})} disabled={!Object.keys(choices).length}>
            Clear story
          </button>
        </nav>

        {step.slot !== 'debrief' && (
          <div className="star-options" role="group" aria-label={`Choose the ${slotMeta!.name}`}>
            {options.map((o) => {
              const on = choices[o.slot] === o.id;
              return (
                <button key={o.id} type="button" className={`star-opt ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => choose(o.slot, o.id)}>
                  <span className="star-opt-text">{o.text}</span>
                  <span className="star-opt-meta">≈{o.secs} s</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="star-grid">
          <section className="star-story" aria-label="Your story so far">
            <h4>Your answer</h4>
            {SLOTS.map((s) => {
              const f = byId(choices[s.id]);
              return (
                <p key={s.id} className={`star-line ${f ? '' : 'empty'} ${step.slot === s.id ? 'cur' : ''}`}>
                  <span className={`star-badge star-b-${s.id}`}>{s.id}</span>
                  {f ? f.text : `(${s.name.toLowerCase()} not chosen yet)`}
                </p>
              );
            })}
          </section>
          <section className="star-signals" aria-label="Signals the interviewer can write down">
            <h4>
              Signals <span className="star-score">{a.score}/100</span>
            </h4>
            <ul>
              {a.signals.map((s) => (
                <li key={s.name}>
                  <span className="star-sig-name">{s.name}</span>
                  <span className={`star-meter l${s.level}`} role="img" aria-label={`${s.name}: ${LEVEL[s.level]}`}>
                    <i />
                    <i />
                  </span>
                  <span className="star-sig-why">{s.why}</span>
                </li>
              ))}
            </ul>
            <div className="star-budget" aria-label="Time budget">
              {budget.map((b) => {
                const tone = b.v === 0 ? 'zero' : b.v < b.lo * 0.66 ? 'low' : b.v > b.hi * 1.15 ? 'high' : 'ok';
                return (
                  <div key={b.k} className="star-bud">
                    <span>{b.k}</span>
                    <span className={`star-bud-bar ${tone}`}>
                      <i style={{ width: `${Math.min(100, (b.v / (b.hi * 1.5)) * 100)}%` }} />
                      <em style={{ left: `${(b.lo / (b.hi * 1.5)) * 100}%`, width: `${((b.hi - b.lo) / (b.hi * 1.5)) * 100}%` }} />
                    </span>
                    <span className="star-bud-v">{b.v} s</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </VizFrame>
  );
}
