import { useState } from 'react';
import { VizFrame, useFrames, type Stepper } from '../../core';
import { meta } from './meta';
import { LPS, PROBES, STEPS, score, type Choices } from './sim';
import './drill.css';

/** fixed, varied display order so the strongest answer isn't always in the same slot */
const ORDERS = [
  [0, 1, 2],
  [1, 2, 0],
  [0, 1, 2],
  [1, 0, 2],
  [2, 1, 0],
  [0, 2, 1],
];
const order = (k: number) => ORDERS[k % ORDERS.length];
const KIND_LABEL = { strong: 'holds up', rehearsed: 'rehearsed / thin', flag: 'red flag' };

export default function BarRaiserDrillViz() {
  const stepper = useFrames(STEPS);
  const [choices, setChoices] = useState<Choices>({});
  const k = stepper.frame.probe;
  const debrief = k >= PROBES.length;
  const probe = PROBES[k];
  const chosen = probe?.answers.find((a) => a.id === choices[k]);
  const s = score(choices);

  const caption = debrief
    ? `Debrief: ${s.overall}. ${s.flags ? `${s.flags} red flag(s) in the notes. ` : ''}${Math.round(s.standing)}% of the story still stands. Every vote must be backed by a line in the notes, so “we fixed it” never reaches the debrief as evidence.`
    : chosen
      ? `${probe.level}: ${KIND_LABEL[chosen.kind]}. Interviewer writes: “${chosen.note}”`
      : `${probe.level}: “${probe.question}” Pick an answer.`;
  const view: Stepper = {
    ...stepper,
    frame: { caption, predict: k === 2 && !chosen ? 'Rehearsed stories collapse around L2–L3. Which answer survives “how did you know?”' : undefined },
  };

  return (
    <VizFrame title={meta.title} blurb={meta.blurb} stepper={view}>
      <div className="brd">
        <ol className="brd-ladder" aria-label="Probing ladder">
          {STEPS.map((st, j) => {
            const c = st.probe < PROBES.length ? PROBES[st.probe].answers.find((a) => a.id === choices[st.probe]) : undefined;
            return (
              <li key={j}>
                <button
                  type="button"
                  className={`brd-rung ${j === stepper.i ? 'on' : ''} ${c ? `k-${c.kind}` : ''}`}
                  aria-current={j === stepper.i ? 'step' : undefined}
                  onClick={() => stepper.seek(j)}
                >
                  {st.probe < PROBES.length ? PROBES[st.probe].level : 'Debrief'}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="brd-main">
          <div className="brd-q">
            {debrief ? (
              <>
                <h4>Debrief: written votes, then evidence</h4>
                <ul className="brd-votes">
                  {LPS.map((lp) => (
                    <li key={lp}>
                      <span>{lp}</span>
                      <strong className={`v-${s.votes[lp].replace(/[^a-z]/gi, '')}`}>{s.votes[lp]}</strong>
                    </li>
                  ))}
                </ul>
                <p className="brd-overall">
                  Overall: <strong>{s.overall}</strong>
                </p>
                <button type="button" className="brd-reset" onClick={() => {
                    setChoices({});
                    stepper.seek(0);
                  }}>
                  Try another path
                </button>
              </>
            ) : (
              <>
                <h4>
                  {probe.level} <span className="brd-asks">Bar Raiser asks</span>
                </h4>
                <p className="brd-question">“{probe.question}”</p>
                <div className="brd-answers" role="group" aria-label="Your answer">
                  {order(k).map((ai) => {
                    const a = probe.answers[ai];
                    const on = choices[k] === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`brd-ans ${on ? `on k-${a.kind}` : ''}`}
                        aria-pressed={on}
                        onClick={() => setChoices((c) => ({ ...c, [k]: a.id }))}
                      >
                        {a.text}
                        {on && <span className="brd-tag">{KIND_LABEL[a.kind]}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <aside className="brd-side" aria-label="Interviewer notes and evidence">
            <h4>Story still standing</h4>
            <div className="brd-standing" role="img" aria-label={`${s.standing}% of the story still stands`}>
              <i style={{ width: `${s.standing}%` }} className={s.standing >= 80 ? 'good' : s.standing >= 50 ? 'warn' : 'bad'} />
              <span>{s.standing}%</span>
            </div>
            <h4>Evidence per assigned LP</h4>
            <ul className="brd-ev">
              {LPS.map((lp) => {
                const e = s.evidence[lp];
                return (
                  <li key={lp}>
                    <span>{lp}</span>
                    <span className="brd-dots" role="img" aria-label={`${lp}: evidence ${e}`}>
                      {[0, 1, 2, 3, 4].map((d) => (
                        <i key={d} className={e > d ? 'pos' : e < 0 && d < -e ? 'neg' : ''} />
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
            <h4>Interviewer’s notes</h4>
            <ol className="brd-notes">
              {s.notes.length ? s.notes.map((n, j) => <li key={j}>{n}</li>) : <li className="empty">(nothing written yet)</li>}
            </ol>
          </aside>
        </div>
      </div>
    </VizFrame>
  );
}
