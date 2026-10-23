import { useMemo, useState } from 'react';
import { Slider, VizFrame, useFrames, useSimulation, type BaseFrame } from '../../core';
import { meta } from './meta';
import {
  AZS,
  CPU_MS,
  DAU_STEPS,
  DEFAULT_PARAMS,
  DISK_FILL,
  GROWTH,
  NIC_GBPS,
  OVERHEAD,
  RATIO_STEPS,
  RECORD_STEPS,
  REPLICATION,
  STEPS,
  TARGET_UTIL,
  VCPU_PER_POD,
  fmtBits,
  fmtBytes,
  fmtCount,
  pct,
  simulate,
  type Numbers,
  type Params,
  type StepId,
} from './sim';
import './estimation-chain.css';

interface Card {
  id: StepId;
  label: string;
  value: (n: Numbers) => string;
  formula: (n: Numbers, p: Params) => string;
  tone?: (n: Numbers) => 'warn' | 'bad' | undefined;
}

const CARDS: Card[] = [
  { id: 'avg', label: 'Average QPS', value: (n) => `${fmtCount(n.avgQps)}/s`, formula: (n, p) => `${fmtCount(n.dau)} × ${p.actions} ÷ 86,400 (≈ ÷10⁵ → ${fmtCount(n.quickQps)})` },
  { id: 'split', label: 'Reads / writes', value: (n) => `${fmtCount(n.readQps)} / ${fmtCount(n.writeQps)}`, formula: (n) => `avg split ${n.ratio}:1` },
  { id: 'peak', label: 'Peak QPS', value: (n) => `${fmtCount(n.peakQps)}/s`, formula: (n, p) => `${fmtCount(n.avgQps)} × ${p.peak} peak factor` },
  { id: 'daily', label: 'New data / day', value: (n) => fmtBytes(n.bytesPerDay), formula: (n) => `${fmtCount(n.writesPerDay)} writes × ${fmtBytes(n.record)}` },
  {
    id: 'storage',
    label: 'Disk to buy',
    value: (n) => fmtBytes(n.diskBytes),
    formula: (n, p) => `${fmtBytes(n.bytesPerDay)} × 365 × ${n.growthSum.toFixed(2)} (${p.years}y, +${Math.round(GROWTH * 100)}%/y) × ${REPLICATION} × ${OVERHEAD} ÷ ${DISK_FILL}`,
  },
  {
    id: 'egress',
    label: 'Peak egress',
    value: (n) => fmtBits(n.egressGbps),
    formula: (n, p) => `${fmtCount(n.peakRead)} reads/s × ${p.respKb} KB × 8 bits`,
    tone: (n) => (n.egressGbps > NIC_GBPS * 0.7 ? 'bad' : n.egressGbps > NIC_GBPS * 0.35 ? 'warn' : undefined),
  },
  { id: 'ingress', label: 'Peak ingress', value: (n) => fmtBits(n.ingressGbps), formula: (n) => `${fmtCount(n.peakWrite)} writes/s × ${fmtBytes(n.record)} × 8` },
  {
    id: 'servers',
    label: 'App servers',
    value: (n) => `${n.pods} pods`,
    formula: (n) => `${fmtCount(n.peakQps)} × ${CPU_MS} ms ÷ ${pct(TARGET_UTIL)} = ${fmtCount(n.vcpus)} vCPU ÷ ${VCPU_PER_POD}`,
    tone: (n) => (n.azLossUtil > 0.95 ? 'bad' : undefined),
  },
];

export default function EstimationChainViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  // Step position is independent of the inputs: dragging a slider keeps you on the same link of the chain.
  const positions = useMemo<BaseFrame[]>(() => STEPS.map((s) => ({ caption: s })), []);
  const base = useFrames(positions);
  const stepper = { ...base, frame: frames[base.i] };
  const f = stepper.frame;
  const n = f.n;
  const at = STEPS.indexOf(f.step);
  const set = (k: keyof Params) => (v: number) => setParams((p) => ({ ...p, [k]: v }));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Daily active users" value={params.dauIdx} min={0} max={DAU_STEPS.length - 1} onChange={set('dauIdx')} format={(v) => fmtCount(DAU_STEPS[v])} />
          <Slider label="Requests per user per day" value={params.actions} min={1} max={100} onChange={set('actions')} />
          <Slider label="Read:write ratio" value={params.ratioIdx} min={0} max={RATIO_STEPS.length - 1} onChange={set('ratioIdx')} format={(v) => `${RATIO_STEPS[v]}:1`} />
          <Slider label="Peak factor" value={params.peak} min={1.5} max={20} step={0.5} onChange={set('peak')} format={(v) => `${v}×`} />
          <Slider label="Bytes per write" value={params.recordIdx} min={0} max={RECORD_STEPS.length - 1} onChange={set('recordIdx')} format={(v) => fmtBytes(RECORD_STEPS[v])} />
          <Slider label="Response size" value={params.respKb} min={1} max={100} onChange={set('respKb')} format={(v) => `${v} KB`} />
          <Slider label="Years of retention" value={params.years} min={1} max={5} onChange={set('years')} format={(v) => `${v}`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--cyan)' }} /> current link
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> getting close to a limit
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> forces a design change
          <span>
            fixed: {CPU_MS} ms CPU/req · {AZS} AZs · {NIC_GBPS} Gbps NIC
          </span>
        </>
      }
    >
      <div className="ec-wrap" role="group" aria-label="Estimation chain">
        <div className={`ec-input ${f.step === 'inputs' ? 'is-now' : ''}`}>
          <span className="ec-k">Input</span>
          <span className="ec-v">
            {fmtCount(n.dau)} DAU × {params.actions} req/day = {fmtCount(n.perDay)} requests/day
          </span>
        </div>
        <ol className="ec-grid">
          {CARDS.map((c, k) => {
            const idx = STEPS.indexOf(c.id);
            const shown = at >= idx;
            const tone = shown ? c.tone?.(n) : undefined;
            return (
              <li key={c.id} className={`ec-card ${shown ? '' : 'is-hidden'} ${f.step === c.id ? 'is-now' : ''} ${tone ? `is-${tone}` : ''}`}>
                <span className="ec-k">
                  <span className="ec-no">{k + 1}</span> {c.label}
                </span>
                <span className="ec-v">{shown ? c.value(n) : '?'}</span>
                <span className="ec-f">{shown ? c.formula(n, params) : 'step through to compute'}</span>
              </li>
            );
          })}
        </ol>
        {f.step === 'summary' && (
          <p className="ec-summary">
            AZ-loss check: losing 1 of {AZS} AZs puts survivors at <strong>{pct(n.azLossUtil)}</strong> CPU. Disk is{' '}
            <strong>{(n.diskBytes / n.rawBytes).toFixed(1)}×</strong> the raw data.
          </p>
        )}
      </div>
    </VizFrame>
  );
}
