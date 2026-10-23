import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { FIX_AT, SCENARIOS, SCENARIO_IDS, SLO_MS, TICKS, TRIGGER, simulate, type HotKind, type NodeLoad, type Params, type ScenarioId } from './sim';
import { fmtMs, fmtNum, fmtPct, toneFor } from '../prod-perf-incident-lab/kit/queue';
import { SeriesLegend, TimeChart, Tiles, Toggles } from '../prod-perf-incident-lab/kit/ui';

const P99 = 'var(--accent)';
const P50 = 'var(--ink-3)';
const BAR_TOP = 22;
const BAR_BOT = 130;
const MAX_RHO = 2;

const barColor = (n: NodeLoad) => (n.down ? 'var(--ink-4)' : n.rho >= 1 ? 'var(--bad)' : n.rho >= 0.8 ? 'var(--warn)' : 'var(--good)');

function NodeBars({ nodes, kind }: { nodes: NodeLoad[]; kind: string }) {
  const slot = 552 / nodes.length;
  const w = Math.min(56, slot - 8);
  const y = (r: number) => BAR_BOT - (Math.min(MAX_RHO, r) / MAX_RHO) * (BAR_BOT - BAR_TOP);
  const many = nodes.length > 8;
  return (
    <svg
      viewBox="0 0 600 160"
      className="viz-svg"
      role="img"
      aria-label={`${kind} utilisation: ${nodes.map((n) => `${n.name} ${n.down ? 'restarting' : fmtPct(n.rho)}`).join(', ')}`}
    >
      <text x={4} y={12} className="viz-label">
        {kind}: utilisation (load ÷ capacity)
      </text>
      <line x1={40} x2={596} y1={y(1)} y2={y(1)} stroke="var(--bad)" strokeDasharray="5 4" strokeWidth={1.4} />
      <text x={36} y={y(1) + 4} textAnchor="end" fontSize={10.5} style={{ fill: 'var(--bad)' }}>
        100%
      </text>
      <text x={36} y={y(2) + 8} textAnchor="end" fontSize={10.5} className="viz-label">
        200%
      </text>
      <line x1={40} x2={596} y1={BAR_BOT} y2={BAR_BOT} stroke="var(--line-2)" />
      {nodes.map((n, i) => {
        const x = 44 + i * slot + (slot - w) / 2;
        const top = y(n.down ? 0 : n.rho);
        return (
          <g key={n.name}>
            <rect x={x} y={BAR_TOP} width={w} height={BAR_BOT - BAR_TOP} rx={4} fill="var(--tint)" />
            <rect x={x} y={top} width={w} height={BAR_BOT - top} rx={4} fill={barColor(n)} opacity={0.85} style={{ transition: 'y 0.35s ease, height 0.35s ease, fill 0.35s ease' }} />
            <text x={x + w / 2} y={Math.max(BAR_TOP + 10, top - 4)} textAnchor="middle" fontSize={many ? 9.5 : 11} fontWeight={700}>
              {n.down ? '↻' : n.rho > MAX_RHO ? `${Math.round(n.rho * 100)}%` : fmtPct(n.rho)}
            </text>
            <text x={x + w / 2} y={BAR_BOT + 14} textAnchor="middle" fontSize={many ? 9.5 : 11} className="viz-label">
              {many ? i + 1 : n.name}
            </text>
            {!many && (
              <text x={x + w / 2} y={BAR_BOT + 27} textAnchor="middle" fontSize={10} className="viz-label">
                {fmtNum(n.lambda)}/s
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function ProdHotspotLab() {
  const [params, setParams] = useState<Params>({ scenario: 'celebrity', fixes: [], knob: SCENARIOS.celebrity.knob.def, kind: 'reads' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const sc = SCENARIOS[params.scenario];
  const t = f.tick;
  const base = frames[1]; // healthy baseline shown before the run starts
  const now = t >= 0 ? { p50: f.p50[t], p99: f.p99[t], err: f.err[t] } : { p50: base.p50[0], p99: base.p99[0], err: base.err[0] };
  const hottest = f.nodes.reduce((a, b) => (b.rho > a.rho ? b : a));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<ScenarioId>
            label="Incident"
            value={params.scenario}
            options={SCENARIO_IDS.map((id) => ({ value: id, label: SCENARIOS[id].label }))}
            onChange={(scenario) => setParams((p) => ({ scenario, fixes: [], knob: SCENARIOS[scenario].knob.def, kind: p.kind }))}
          />
          {sc.hasKind && (
            <Choice<HotKind>
              label="Hot traffic is"
              value={params.kind}
              options={[
                { value: 'reads', label: 'reads (product page)' },
                { value: 'writes', label: 'writes (likes counter)' },
              ]}
              onChange={(kind) => setParams((p) => ({ ...p, kind }))}
            />
          )}
          <Slider label={sc.knob.label} value={params.knob} min={sc.knob.min} max={sc.knob.max} step={sc.knob.step} format={sc.knob.unit} onChange={(knob) => setParams((p) => ({ ...p, knob }))} />
          <Toggles
            label={`Mitigations (live at minute ${FIX_AT})`}
            options={sc.fixes.map((x) => ({ value: x.id, label: x.label }))}
            value={params.fixes}
            onChange={(fixes) => setParams((p) => ({ ...p, fixes }))}
          />
        </>
      }
      legend={
        <SeriesLegend
          series={[
            { label: 'p99 latency', color: P99 },
            { label: 'p50 latency', color: P50, dash: true },
          ]}
          extra={
            <>
              <span className="pil-leg">
                <span className="pil-swatch" style={{ background: 'var(--bad)' }} aria-hidden />
                error rate · node over 100%
              </span>
              <span className="pil-leg">
                <span className="pil-swatch" style={{ background: 'var(--good)' }} aria-hidden />
                node with headroom
              </span>
            </>
          }
        />
      }
    >
      <Tiles
        label={t < 0 ? 'Healthy baseline before the run starts' : `Metrics at minute ${t}`}
        tiles={[
          { label: 'traffic', value: `${fmtNum(f.rps)}/s` },
          { label: 'p99', value: fmtMs(now.p99), tone: toneFor(now.p99, SLO_MS * 0.8, SLO_MS), sub: `SLO ${SLO_MS} ms` },
          { label: 'errors', value: fmtPct(now.err), tone: toneFor(now.err, 0.001, 0.01) },
          { label: 'hottest node', value: hottest.down ? '↻' : fmtPct(hottest.rho), tone: toneFor(hottest.rho, 0.8, 1), sub: hottest.name },
          { label: 'max ÷ median', value: `${f.skew.toFixed(1)}×`, tone: toneFor(f.skew, 1.5, 2.5), sub: 'skew alert > 2×' },
        ]}
      />
      <NodeBars nodes={f.nodes} kind={sc.nodeKind} />
      <TimeChart
        ticks={TICKS}
        cur={t}
        series={[
          { key: 'p99', label: 'p99', color: P99, values: f.p99 },
          { key: 'p50', label: 'p50', color: P50, values: f.p50, dash: '5 4' },
        ]}
        errors={f.err}
        sloMs={SLO_MS}
        markers={[
          { tick: TRIGGER, label: 'trigger', color: 'var(--warn)' },
          { tick: FIX_AT, label: params.fixes.length ? 'fix live' : 'no fix', color: params.fixes.length ? 'var(--good)' : 'var(--ink-4)' },
        ]}
        ariaLabel={t >= 0 ? `${sc.label}, minute ${t}: p99 ${fmtMs(now.p99)}, errors ${fmtPct(now.err)}, skew ${f.skew.toFixed(1)} times.` : `${sc.label}: timeline not started.`}
      />
    </VizFrame>
  );
}
