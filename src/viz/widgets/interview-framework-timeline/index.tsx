import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { KIND_LABEL, LEVEL_NAME, PHASES, PHASE_NAME, PROMPT_NAME, RANGE, TOTAL, outOfRange, simulate, type Level, type Params, type Prompt } from './sim';
import './interview-framework-timeline.css';

export default function InterviewFrameworkTimelineViz() {
  const [params, setParams] = useState<Params>({ prompt: 'shortener', level: 'senior' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const off = outOfRange(params.level);
  const current = f.shown - 1;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <div className="ift-ctl">
          <Choice<Prompt>
            label="Prompt"
            value={params.prompt}
            options={(Object.keys(PROMPT_NAME) as Prompt[]).map((k) => ({ value: k, label: PROMPT_NAME[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, prompt: v }))}
          />
          <Choice<Level>
            label="Level (breadth/depth)"
            value={params.level}
            options={(Object.keys(LEVEL_NAME) as Level[]).map((k) => ({ value: k, label: LEVEL_NAME[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, level: v }))}
          />
        </div>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--cyan)' }} /> being written now
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> phase outside the recommended range
          <span>45 minutes · 5 reserved for wrap-up</span>
        </>
      }
    >
      <div className="ift-wrap">
        <div className="ift-prompt">
          <span className="ift-k">Prompt</span> “{PROMPT_NAME[params.prompt]}”
          <span className="ift-clock" aria-label={`Clock ${Math.floor(f.clock)} minutes`}>
            {String(Math.floor(f.clock)).padStart(2, '0')}:{String(Math.round((f.clock % 1) * 60)).padStart(2, '0')} / {TOTAL}:00
          </span>
        </div>
        <div className="ift-bar" role="img" aria-label={`Time budget: ${PHASES.map((p) => `${PHASE_NAME[p].slice(4)} ${f.budget[p]} minutes`).join(', ')}`}>
          {PHASES.map((p) => (
            <div key={p} className={`ift-seg ift-ph-${p} ${off.includes(p) ? 'is-off' : ''}`} style={{ flexGrow: f.budget[p] }}>
              <span className="ift-seg-name">{PHASE_NAME[p].slice(4)}</span>
              <span className="ift-seg-min">
                {f.budget[p]} min <span className="ift-range">({RANGE[p][0]}–{RANGE[p][1]})</span>
              </span>
            </div>
          ))}
          <span className="ift-now" style={{ left: `${(f.clock / TOTAL) * 100}%` }} aria-hidden />
        </div>
        <div className="ift-board">
          {PHASES.map((p) => (
            <section key={p} className="ift-col" aria-label={PHASE_NAME[p]}>
              <h4 className="ift-col-h">{PHASE_NAME[p]}</h4>
              <ul>
                {f.items.map((it, idx) =>
                  it.phase !== p ? null : (
                    <li key={it.kind} className={`ift-card ${idx < f.shown ? '' : 'is-hidden'} ${idx === current ? 'is-now' : ''}`}>
                      <span className="ift-card-k">
                        {KIND_LABEL[it.kind]} <span className="ift-at">{Math.floor(it.at)}′</span>
                      </span>
                      {idx < f.shown && <span className="ift-card-t">{it.text}</span>}
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </VizFrame>
  );
}
