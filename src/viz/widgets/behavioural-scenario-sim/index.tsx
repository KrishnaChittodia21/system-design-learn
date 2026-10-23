import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation, type Stepper } from '../../core';
import { meta } from './meta';
import { SCENARIOS, debrief, simulate, type Picks, type ScenarioId } from './sim';
import './scenario.css';

/** fixed, varied display order so the strongest answer isn't always first */
const order = (scenario: number, beat: number) => {
  const r = (scenario + beat * 2) % 3;
  return [0, 1, 2].map((i) => (i + r) % 3);
};
const PTS_LABEL: Record<number, string> = { 2: '+2 strong', 1: '+1', 0: '0 neutral', '-1': '−1 weak', '-2': '−2 red flag' };

export default function BehaviouralScenarioViz() {
  const [params, setParams] = useState<{ scenario: ScenarioId }>({ scenario: 'conflict' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const [picks, setPicks] = useState<Record<ScenarioId, Picks>>({ conflict: [], incident: [], failure: [], influence: [], mentoring: [] });
  const sIdx = SCENARIOS.findIndex((x) => x.id === params.scenario);
  const s = SCENARIOS[sIdx];
  const my = picks[s.id];
  const k = stepper.frame.beat;
  const isDebrief = k >= s.beats.length;
  const beat = s.beats[k];
  const pick = isDebrief ? undefined : my[k];
  const chosen = pick === undefined || isDebrief ? undefined : beat.options[pick];
  const best = isDebrief ? undefined : beat.options.reduce((a, b) => (b.pts > a.pts ? b : a));
  const d = debrief(s, my);

  const caption = isDebrief
    ? `Debrief: ${d.score}/100. ${d.verdict}.${d.flags.length ? ` Red flags: ${d.flags.join(', ')}.` : ''}`
    : chosen
      ? `${beat.ask}: ${PTS_LABEL[chosen.pts]}. ${chosen.why}`
      : `Beat ${k + 1} of ${s.beats.length}, ${beat.ask.toLowerCase()}. Choose how you would tell it.`;
  const view: Stepper = {
    ...stepper,
    frame: { caption, predict: k === 0 && !chosen ? `Primary signal: ${s.signal}. The trap: ${s.trap}. Which opening avoids it?` : undefined },
  };
  const setPick = (i: number) => setPicks((all) => ({ ...all, [s.id]: Object.assign([...all[s.id]], { [k]: i }) }));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={view}
      controls={
        <Choice<ScenarioId>
          label="Prompt"
          value={params.scenario}
          options={SCENARIOS.map((x) => ({ value: x.id, label: x.label }))}
          onChange={(scenario) => setParams({ scenario })}
        />
      }
    >
      <div className="bss">
        <div className="bss-prompt">
          <p className="bss-q">“{s.prompt}”</p>
          <p className="bss-meta">
            <span className="bss-pill good">signal: {s.signal}</span>
            <span className="bss-pill bad">trap: {s.trap}</span>
          </p>
        </div>
        <nav className="bss-beats" aria-label="Beats of the story">
          {frames.map((f, j) => {
            const o = f.beat < s.beats.length && my[f.beat] !== undefined ? s.beats[f.beat].options[my[f.beat]!] : undefined;
            return (
              <button
                key={j}
                type="button"
                className={`bss-beat ${j === stepper.i ? 'on' : ''} ${o ? (o.pts > 0 ? 'p-good' : o.pts < 0 ? 'p-bad' : 'p-mid') : ''}`}
                aria-current={j === stepper.i ? 'step' : undefined}
                onClick={() => stepper.seek(j)}
              >
                {f.beat < s.beats.length ? `${f.beat + 1}. ${s.beats[f.beat].ask}` : 'Debrief'}
              </button>
            );
          })}
        </nav>

        {!isDebrief ? (
          <div className="bss-body">
            <div className="bss-opts" role="group" aria-label={`${beat.ask}: choose a response`}>
              {order(sIdx, k).map((i) => {
                const o = beat.options[i];
                const on = pick === i;
                return (
                  <button key={i} type="button" className={`bss-opt ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setPick(i)}>
                    {o.text}
                  </button>
                );
              })}
            </div>
            <div className="bss-feedback" aria-live="polite">
              {chosen ? (
                <>
                  <p className={`bss-pts ${chosen.pts > 0 ? 'good' : chosen.pts < 0 ? 'bad' : 'mid'}`}>{PTS_LABEL[chosen.pts]}</p>
                  {chosen.signals?.map((x) => (
                    <span key={x} className="bss-pill good">
                      ✓ {x}
                    </span>
                  ))}
                  {chosen.flags?.map((x) => (
                    <span key={x} className="bss-pill bad">
                      ⚑ {x}
                    </span>
                  ))}
                  <p className="bss-why">{chosen.why}</p>
                  {best && best !== chosen && (
                    <p className="bss-better">
                      <strong>Stronger:</strong> the answer that conveys {best.signals?.join(' and ')}. {best.why}
                    </p>
                  )}
                </>
              ) : (
                <p className="bss-why muted">Pick a response to see the signals it conveys and the traps it trips.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="bss-debrief">
            <div className="bss-score" role="img" aria-label={`Score ${d.score} out of 100`}>
              <span className="bss-score-n">{d.score}</span>
              <span className="bss-score-bar">
                <i style={{ width: `${d.score}%` }} className={d.score >= 85 ? 'good' : d.score >= 60 ? 'mid' : 'bad'} />
              </span>
            </div>
            <p className="bss-verdict">{d.verdict}.</p>
            <div className="bss-cols">
              <div>
                <h4>Signals conveyed</h4>
                {d.signals.length ? d.signals.map((x, j) => <span key={j} className="bss-pill good">✓ {x}</span>) : <p className="bss-why muted">none yet</p>}
              </div>
              <div>
                <h4>Red flags</h4>
                {d.flags.length ? d.flags.map((x, j) => <span key={j} className="bss-pill bad">⚑ {x}</span>) : <p className="bss-why muted">none</p>}
              </div>
            </div>
            <button type="button" className="bss-reset" onClick={() => setPicks((all) => ({ ...all, [s.id]: [] }))}>
              Clear answers for this prompt
            </button>
          </div>
        )}
      </div>
    </VizFrame>
  );
}
