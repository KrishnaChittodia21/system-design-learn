import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { FIX_AT, INCIDENTS, INCIDENT_IDS, SLO_MS, TICKS, TRIGGER, simulate, type IncidentId, type Params } from './sim';
import { fmtMs, fmtNum, fmtPct, toneFor, type Tone } from './kit/queue';
import { SeriesLegend, TimeChart, Tiles, Toggles } from './kit/ui';

const P99 = 'var(--accent)';
const P50 = 'var(--ink-3)';

const levelTone = (l: number): Tone => (l >= 0.95 ? 'bad' : l >= 0.75 ? 'warn' : 'good');

export default function ProdPerfIncidentLab() {
  const [params, setParams] = useState<Params>({ incident: 'index', fixes: [], knob: INCIDENTS.index.knob.def });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const inc = INCIDENTS[params.incident];
  const t = f.tick;
  // before the run starts, show the healthy baseline (minute 0) so the tiles are never empty
  const base = frames[1];
  const now = t >= 0 ? { p50: f.p50[t], p99: f.p99[t], err: f.err[t], rps: f.rps[t] } : { p50: base.p50[0], p99: base.p99[0], err: base.err[0], rps: base.rps[0] };
  const gauges = t >= 0 ? f.gauges : base.gauges;

  const pickIncident = (incident: IncidentId) => setParams({ incident, fixes: [], knob: INCIDENTS[incident].knob.def });

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<IncidentId>
            label="Incident"
            value={params.incident}
            options={INCIDENT_IDS.map((id) => ({ value: id, label: INCIDENTS[id].label }))}
            onChange={pickIncident}
          />
          <Slider
            label={inc.knob.label}
            value={params.knob}
            min={inc.knob.min}
            max={inc.knob.max}
            step={inc.knob.step}
            format={inc.knob.unit}
            onChange={(knob) => setParams((p) => ({ ...p, knob }))}
          />
          <Toggles
            label={`Mitigations (live at minute ${FIX_AT})`}
            options={inc.fixes.map((x) => ({ value: x.id, label: x.label }))}
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
            <span className="pil-leg">
              <span className="pil-swatch" style={{ background: 'var(--bad)' }} aria-hidden />
              error rate (bottom band)
            </span>
          }
        />
      }
    >
      <Tiles
        label={t < 0 ? 'Healthy baseline before the run starts' : `Metrics at minute ${t}`}
        tiles={[
          { label: 'traffic', value: `${fmtNum(now.rps)}/s` },
          { label: 'p50', value: fmtMs(now.p50), tone: toneFor(now.p50, SLO_MS / 2, SLO_MS) },
          { label: 'p99', value: fmtMs(now.p99), tone: toneFor(now.p99, SLO_MS * 0.8, SLO_MS), sub: `SLO ${SLO_MS} ms` },
          { label: 'errors', value: fmtPct(now.err), tone: toneFor(now.err, 0.001, 0.01) },
          ...gauges.map((g) => ({ label: g.label, value: g.value, sub: g.sub, tone: levelTone(g.level) })),
        ]}
      />
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
        ariaLabel={
          t >= 0
            ? `${inc.label}, minute ${t}: p50 ${fmtMs(now.p50)}, p99 ${fmtMs(now.p99)}, errors ${fmtPct(now.err)}. ${gauges.map((g) => `${g.label} ${g.value}`).join(', ')}.`
            : `${inc.label}: latency and error timeline over ${TICKS} minutes, not started.`
        }
      />
    </VizFrame>
  );
}
