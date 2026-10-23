import { useEffect, useRef, useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { codeLines, simulate, type Code, type Crash, type Params, type WorkerState } from './sim';
import './temporal.css';

const STATE_LABEL: Record<WorkerState, string> = {
  idle: 'idle',
  running: 'running',
  replaying: 'replaying',
  crashed: 'crashed',
  stuck: 'stuck (NDE)',
  done: 'done',
};

export default function TemporalReplayViz() {
  const [params, setParams] = useState<Params>({ crash: 'charge', idempotent: true, code: 'same' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = <K extends keyof Params>(k: K) => (v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const lines = codeLines(f.version, params.idempotent);

  // keep the newest history event in view (without scrolling the page)
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [f.history.length]);

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Crash>
            label="Worker A crashes"
            value={params.crash}
            options={[
              { value: 'charge', label: 'during chargeCard' },
              { value: 'timer', label: 'during the 3-day sleep' },
              { value: 'none', label: 'never' },
            ]}
            onChange={set('crash')}
          />
          <Choice<'yes' | 'no'>
            label="Idempotency key"
            value={params.idempotent ? 'yes' : 'no'}
            options={[
              { value: 'yes', label: 'yes' },
              { value: 'no', label: 'no' },
            ]}
            onChange={(v) => set('idempotent')(v === 'yes')}
          />
          <Choice<Code>
            label="Worker B runs"
            value={params.code}
            options={[
              { value: 'same', label: 'same code' },
              { value: 'v2', label: 'v2 without patched()' },
            ]}
            onChange={set('code')}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> current line / new event
          <span className="viz-key" style={{ background: 'var(--good)' }} /> replayed from history (not re-executed)
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> timeout / failure
        </>
      }
    >
      <div className="tdr">
        <div className="tdr-status" role="group" aria-label="Workers and side effects">
          {(['A', 'B'] as const).map((w) => (
            <span key={w} className={`tdr-chip is-${f.workers[w]}`}>
              worker {w}: {STATE_LABEL[f.workers[w]]}
            </span>
          ))}
          <span className={`tdr-chip ${f.charges > 1 ? 'is-crashed' : 'is-done'}`}>
            charges at provider: <strong>{f.charges}</strong>
          </span>
          <span className="tdr-clock">{f.clock}</span>
        </div>
        <div className="tdr-grid">
          <section className="tdr-panel" aria-label={`Workflow code on worker ${f.worker}`}>
            <h4 className="tdr-h">
              workflow code · worker {f.worker}
              {f.version === 'v2' ? ' · v2' : ''}
            </h4>
            <pre className="tdr-code">
              {lines.map((l, i) => (
                <div key={i} className={`tdr-line${i === f.line ? (f.workers[f.worker] === 'replaying' ? ' is-replay' : f.workers[f.worker] === 'stuck' ? ' is-error' : ' is-on') : ''}${l.op === 'fraudCheck' ? ' is-new' : ''}`}>
                  <span className="tdr-ln" aria-hidden>
                    {i + 1}
                  </span>
                  {l.text}
                </div>
              ))}
            </pre>
          </section>
          <section className="tdr-panel" aria-label="Event history">
            <h4 className="tdr-h">event history (the state) · {f.history.length} events</h4>
            <ol className="tdr-history" ref={listRef} tabIndex={0} aria-label="Event history list">
              {f.history.map((e, k) => {
                const isNew = k === f.history.length - 1;
                const replayed = f.replayed.includes(e.id);
                return (
                  <li key={e.id} className={`tdr-ev kind-${e.kind}${replayed ? ' is-replayed' : ''}${isNew && !replayed ? ' is-new' : ''}`}>
                    <span className="tdr-id">{e.id}</span>
                    <span className="tdr-type">{e.type}</span>
                    <span className="tdr-detail">{e.detail}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      </div>
    </VizFrame>
  );
}
