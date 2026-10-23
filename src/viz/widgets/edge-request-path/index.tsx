import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, LAYERS, NODES, NODE_NAME, SCENARIO_NAME, simulate, type Layer, type Node as HopNode, type Params, type Scenario, type Verdict } from './sim';
import './edge-request-path.css';

const SHORT: Record<Layer, string> = { cdn: 'CDN', waf: 'WAF', lb: 'LB', gw: 'Gateway', bff: 'BFF' };
const CHAIN_NAME: Record<HopNode, string> = { client: 'Phone', cdn: 'CDN', waf: 'WAF', lb: 'LB', gw: 'Gateway', bff: 'BFF', svc: 'Services' };
const VERDICT_LABEL: Record<Verdict, string> = {
  start: 'sent',
  pass: 'passed',
  hit: 'cache hit',
  block: 'blocked',
  served: 'served',
  risk: 'let through',
};

function fmtBytes(b: number) {
  return b >= 1000 ? `${Math.round(b / 1000)} KB` : `${b} B`;
}

export default function EdgeRequestPathViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const visited = new Map(f.hops.map((h) => [h.node, h]));
  const toggle = (l: Layer) => setParams((p) => ({ ...p, on: { ...p.on, [l]: !p.on[l] } }));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <div className="erp-ctl">
          <Choice<Scenario>
            label="Request"
            value={params.scenario}
            options={(Object.keys(SCENARIO_NAME) as Scenario[]).map((k) => ({ value: k, label: SCENARIO_NAME[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, scenario: v }))}
          />
          <div className="viz-choice" role="group" aria-label="Layers in the path">
            <span>Layers:</span>
            {LAYERS.map((l) => (
              <button key={l} type="button" className={`chip ${params.on[l] ? 'on' : ''}`} aria-pressed={params.on[l]} onClick={() => toggle(l)}>
                {params.on[l] ? '✓ ' : '✕ '}
                {SHORT[l]}
              </button>
            ))}
          </div>
        </div>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> request is here
          <span className="viz-key" style={{ background: 'var(--good)' }} /> passed / answered
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> rejected
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> got through but should not have
        </>
      }
    >
      <div className="erp-wrap">
        <ol className="erp-chain" aria-label="Request path">
          {NODES.map((n) => {
            const layerOff = n !== 'client' && n !== 'svc' && !params.on[n as Layer];
            const h = visited.get(n);
            const here = f.at === n;
            return (
              <li key={n} className={`erp-node ${layerOff ? 'is-off' : ''} ${h ? `is-${h.verdict}` : ''} ${here ? 'is-here' : ''}`}>
                <span className="erp-name" title={NODE_NAME[n]}>
                  {CHAIN_NAME[n]}
                </span>
                <span className="erp-state">{layerOff ? 'switched off' : h ? VERDICT_LABEL[h.verdict] : '·'}</span>
              </li>
            );
          })}
        </ol>
        <ol className="erp-log">
          {f.hops.map((h, i) => (
            <li key={i} className={`is-${h.verdict}`}>
              <span className="erp-lnode">{NODE_NAME[h.node]}</span>
              <span className="erp-lnote">{h.note}</span>
              <span className="erp-lms">{h.ms ? `+${h.ms} ms` : ''}</span>
            </li>
          ))}
        </ol>
        <div className="erp-summary">
          <span>
            status <strong className={f.status ? (f.status >= 400 ? 'is-bad' : 'is-good') : ''}>{f.status ?? '…'}</strong>
          </span>
          <span>
            latency <strong>{f.totalMs} ms</strong>
          </span>
          <span>
            phone requests <strong>{f.phoneRequests}</strong>
          </span>
          <span>
            payload <strong>{f.bytes ? fmtBytes(f.bytes) : '…'}</strong>
          </span>
          <span>
            reached services <strong>{f.reachedOrigin ? 'yes' : 'no'}</strong>
          </span>
        </div>
      </div>
    </VizFrame>
  );
}
