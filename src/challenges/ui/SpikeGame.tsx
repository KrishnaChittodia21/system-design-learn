// Mode 7, "Survive the spike": install capacity cards, then run a deterministic traffic simulation. A live chart draws
// traffic and every goal's metric against its limit while the bottleneck boxes heat up on the diagram. All goals must
// hold for the whole run; a failed run is a miss and shows what broke and when. Cards can change mid-run (the sim uses
// whatever is installed at each tick), so a late fix still shows its effect, but the run has to stay clean throughout.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FastForward, Flame, Play, Plus, Square, X, Zap } from 'lucide-react';
import type { SpikeGoal, SpikePuzzle } from '../types';
import { formatNum, searchSpike, spikeHolds, spikeSample, spikeTimes, spikeTraffic, spikeValue, starsFor, type SpikeSample } from '../logic';
import { Board, type BoardEdgeView, type BoardNodeView } from './Board';
import { Frame, NodeText } from './kit';
import { MODE_INFO, useRun, type GameProps } from './run';
import { useDrag } from './useDrag';
import { commiserate } from '../../lib/commiserate';
import { replayClass, useReducedMotion, useWidth } from './hooks';

type Speed = 1 | 2 | 0;
/** real seconds a whole run takes at 1× */
const RUN_MS = 8000;

interface Report {
  samples: SpikeSample[];
  /** first breach per goal index */
  breaches: { goal: number; t: number; value: number; hot?: string }[];
  pass: boolean;
}

export default function SpikeGame({ puzzle, best, onComplete, onReset, next }: GameProps<SpikePuzzle>) {
  const run = useRun({ title: 'How it works', body: MODE_INFO.spike.how });
  const reduce = useReducedMotion();
  const times = useMemo(() => spikeTimes(puzzle), [puzzle]);
  const [installed, setInstalled] = useState<string[]>([]);
  const [speed, setSpeed] = useState<Speed>(1);
  const [samples, setSamples] = useState<SpikeSample[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [runs, setRuns] = useState(0);
  const [hinted, setHinted] = useState<string | null>(null);
  const scope = useRef<HTMLDivElement>(null);
  const installedRef = useRef(installed);
  useEffect(() => {
    installedRef.current = installed;
  }, [installed]);
  const timer = useRef(0);
  const max = puzzle.maxCards ?? puzzle.cards.length;
  const effSpeed: Speed = reduce ? 0 : speed;
  const card = (id: string) => puzzle.cards.find((c) => c.id === id)!;
  const label = (id: string) => puzzle.nodes.find((n) => n.id === id)?.label ?? id;

  useEffect(() => () => window.clearInterval(timer.current), []);

  /** what the board shows: the sample at the playhead, else a preview at t = 0 with the current cards */
  const now = samples[samples.length - 1] ?? spikeSample(puzzle, new Set(installed), 0);

  const install = (id: string, on: boolean) => {
    if (run.done) return;
    const has = installed.includes(id);
    if (on === has) return;
    const c = card(id);
    if (on && installed.length >= max) {
      run.say(`Only ${max} change${max === 1 ? '' : 's'}`, `You can install at most ${max} card${max === 1 ? '' : 's'}. Remove one first (tap it again).`, 'bad');
      replayClass(scope.current?.querySelector(`[data-opt="${id}"]`), 'shake');
      return;
    }
    const nextSet = on ? [...installed, id] : installed.filter((x) => x !== id);
    installedRef.current = nextSet;
    setInstalled(nextSet);
    setHinted(null);
    if (on) run.say(`Installed: ${c.label}`, `On ${label(c.node)}. It is ${c.is}.${running ? ' It takes effect from this tick on.' : ' Run the spike to see what it does.'}`);
    else run.say(`Removed: ${c.label}`, running ? 'It stops working from this tick on.' : 'Pick another card, or run the spike.');
  };

  const drag = useDrag({
    scope,
    onDrop: (id, target) => install(id, target === 'board'),
    onTap: (id) => install(id, !installedRef.current.includes(id)),
  });

  /** evaluate a finished (or skipped) run */
  const finishRun = (all: SpikeSample[]) => {
    setRunning(false);
    const breaches: Report['breaches'] = [];
    puzzle.goals.forEach((g, gi) => {
      const s = all.find((x) => !spikeHolds(x, g));
      if (!s) return;
      const hot = Object.entries(s.util).sort((a, b) => b[1] - a[1])[0];
      breaches.push({ goal: gi, t: s.t, value: spikeValue(s, g.metric), hot: hot && hot[1] >= 0.95 ? hot[0] : undefined });
    });
    breaches.sort((a, b) => a.t - b.t || a.goal - b.goal);
    const r: Report = { samples: all, breaches, pass: !breaches.length };
    setReport(r);
    setRuns((n) => n + 1);
    if (r.pass) {
      const stars = run.finish();
      run.say('Survived the spike', 'Every goal held for the whole run. Read why below.', 'good');
      onComplete(stars);
      return;
    }
    run.miss();
    commiserate('The spike won this round', 'Check what broke below, change a card and run it again.');
    const b = breaches[0];
    const g = puzzle.goals[b.goal];
    const hot = b.hot ? ` ${label(b.hot)} was at ${formatNum(all.find((x) => x.t === b.t)!.util[b.hot] * 100)}% of its capacity.` : '';
    const more = breaches.length > 1 ? ` (${breaches.length - 1} other goal${breaches.length > 2 ? 's' : ''} broke too.)` : '';
    run.say(`✗ ${g.label} broke at ${fmtT(b.t)}`, `${metricText(g, b.value)}. ${g.fail}${hot}${more} Change the cards and run it again.`, 'bad');
    replayClass(scope.current?.querySelector(`[data-goal="${b.goal}"]`), 'shake');
  };

  const start = () => {
    if (running || run.done) return;
    window.clearInterval(timer.current);
    setReport(null);
    setHinted(null);
    if (effSpeed === 0) {
      const all = times.map((t) => spikeSample(puzzle, new Set(installedRef.current), t));
      setSamples(all);
      finishRun(all);
      return;
    }
    setRunning(true);
    run.say('The spike is running', `Watch the chart and the boxes heat up. You can still install or remove cards; each change applies from that tick on.`);
    const acc: SpikeSample[] = [];
    const step = () => {
      const t = times[acc.length];
      acc.push(spikeSample(puzzle, new Set(installedRef.current), t));
      setSamples([...acc]);
      if (acc.length === times.length) {
        window.clearInterval(timer.current);
        finishRun(acc);
      }
    };
    step();
    timer.current = window.setInterval(step, RUN_MS / effSpeed / Math.max(1, times.length - 1));
  };

  /** jump to the end with the cards as they are now */
  const skip = () => {
    if (!running) return;
    window.clearInterval(timer.current);
    const acc = [...samples];
    for (let i = acc.length; i < times.length; i++) acc.push(spikeSample(puzzle, new Set(installedRef.current), times[i]));
    setSamples(acc);
    finishRun(acc);
  };

  const solution = useMemo(() => {
    const decoys = new Set(puzzle.cards.filter((c) => c.decoy).map((c) => c.id));
    return searchSpike(puzzle).minimal.find((s) => !s.some((id) => decoys.has(id))) ?? [];
  }, [puzzle]);
  const hint = () => {
    if (run.done || running) return;
    const bad = installed.find((id) => !solution.includes(id));
    const missing = solution.find((id) => !installed.includes(id));
    const target = bad ?? missing;
    if (!target) {
      run.say('Hint', 'Your cards already survive the spike. Run it.');
      return;
    }
    run.hint();
    setHinted(target);
    replayClass(scope.current?.querySelector(`[data-opt="${target}"]`), 'hinted');
    if (bad) run.say('Hint', `The glowing installed card doesn't help here. Remove it (tap it) and think about which box breaks first.`);
    else run.say('Hint', `Look at which box breaks first. The glowing card relieves it.`);
  };

  /* ---------------- board ---------------- */
  const byNode = new Map<string, string[]>();
  for (const id of installed) byNode.set(card(id).node, [...(byNode.get(card(id).node) ?? []), id]);
  const nodes: BoardNodeView[] = puzzle.nodes.map((n) => {
    const u = now.util[n.id];
    const heat = u === undefined ? '' : u >= 1 ? 'melt' : u >= 0.85 ? 'hot' : u >= 0.6 ? 'warm' : 'cool';
    const mods = byNode.get(n.id)?.length ?? 0;
    return {
      id: n.id,
      col: n.col,
      row: n.row,
      kind: n.kind,
      className: `sp-node ${heat ? `sp-${heat}` : ''} ${run.done ? 'tuned' : ''}`,
      style: u === undefined ? undefined : ({ '--heat': Math.min(1.5, u).toFixed(3) } as React.CSSProperties),
      ariaLabel: `${n.label}${n.sub ? `, ${n.sub}` : ''}${u === undefined ? '' : `, at ${formatNum(u * 100)}% of capacity`}${mods ? `, ${mods} card${mods > 1 ? 's' : ''} installed` : ''}`,
      content: (
        <>
          {u !== undefined && (
            <span className="sp-util mono" aria-hidden>
              {pct(u)}
            </span>
          )}
          {mods > 0 && (
            <span className="sp-mods mono" aria-hidden>
              <Plus size={10} strokeWidth={3} />
              {mods}
            </span>
          )}
          <NodeText label={n.label} sub={n.sub} />
          {u !== undefined && (
            <span className="sp-press" aria-hidden>
              <i style={{ transform: `scaleX(${Math.min(1, u)})` }} />
            </span>
          )}
        </>
      ),
    };
  });
  const edges: BoardEdgeView[] = puzzle.edges.map(([from, to, l]) => {
    const u = now.util[to];
    const state: BoardEdgeView['state'] = run.done ? undefined : running ? (u !== undefined && u >= 1 ? 'hot' : 'run') : 'idle';
    return { from, to, label: l, live: run.done, state };
  });

  /* ---------------- goals strip ---------------- */
  const goalState = (g: SpikeGoal, gi: number) => {
    const broke = (report?.breaches ?? []).find((b) => b.goal === gi);
    const liveBreak = samples.find((s) => !spikeHolds(s, g));
    if (report) return broke ? 'bad' : 'ok';
    if (running) return liveBreak ? 'bad' : 'live';
    return '';
  };

  const status = run.done ? { text: 'SURVIVED', ok: true } : running ? { text: `RUNNING · ${fmtT(now.t)}`, ok: false } : report ? { text: `BROKE AT ${fmtT(report.breaches[0].t)}`, ok: false } : { text: 'SPIKE INCOMING', ok: false };
  const left = puzzle.cards.filter((c) => !installed.includes(c.id));

  return (
    <div ref={scope} className="cg-scope sp-scope">
      <Frame
        puzzle={puzzle}
        status={status}
        counters={[
          { label: 'Cards', value: `${installed.length}/${max}` },
          { label: 'Runs', value: runs },
          { label: 'Misses', value: run.misses },
        ]}
        board={
          <>
            <div className="sp-goals" role="group" aria-label="Goals: must hold for the whole run">
              {puzzle.goals.map((g, gi) => {
                const st = goalState(g, gi);
                return (
                  <span key={g.label} className={`sp-goal ${st}`} data-goal={gi}>
                    {st === 'ok' ? <Check size={13} strokeWidth={3} aria-hidden /> : st === 'bad' ? <X size={13} strokeWidth={3} aria-hidden /> : <Zap size={13} aria-hidden />}
                    {g.label}
                    <span className="sr-only">{st === 'ok' ? ', held' : st === 'bad' ? ', broke' : ''}</span>
                  </span>
                );
              })}
            </div>
            <div className="sp-stage" data-drop="board">
              <div className={`sp-installed ${installed.length ? '' : 'empty'}`} aria-live="off">
                <span className="sp-installed-l mono">Installed</span>
                {installed.length ? (
                  installed.map((id) => {
                    const c = card(id);
                    return (
                      <button key={id} type="button" className={`sp-tag ${hinted === id ? 'hinted' : ''}`} data-opt={id} {...drag(id)} aria-label={`Remove ${c.label} from ${label(c.node)}`}>
                        {c.label}
                        <small className="mono">@ {label(c.node)}</small>
                        <X size={12} aria-hidden />
                      </button>
                    );
                  })
                ) : (
                  <span className="sp-drop-hint">Drag cards here, or tap them below</span>
                )}
              </div>
              <Board label={`${puzzle.title} diagram`} className="sp-board" cols={puzzle.cols} rows={puzzle.rows} nodes={nodes} edges={edges} />
            </div>
            <SpikeChart puzzle={puzzle} times={times} samples={samples} report={report} running={running} />
            <Readout puzzle={puzzle} s={samples.length ? now : null} />
            {report && !running && <ReportTable puzzle={puzzle} report={report} />}
          </>
        }
        trayTitle={`Capacity cards · install up to ${max}, then run`}
        tray={
          <>
            <div className="cg-tray sp-tray" role="group" aria-label="Capacity cards" data-drop="tray">
              {puzzle.cards.map((c) => {
                const on = installed.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`cg-chip sp-card ${on ? 'on' : ''} ${hinted === c.id ? 'hinted' : ''}`}
                    aria-pressed={on}
                    data-opt={c.id}
                    {...drag(c.id)}
                    aria-label={`${c.label}${c.sub ? `, ${c.sub}` : ''}, on ${label(c.node)}: ${on ? 'installed, press to remove' : 'press to install'}`}
                  >
                    <span className="cg-chip-l">{c.label}</span>
                    {c.sub && <small>{c.sub}</small>}
                    <small className="sp-card-at">
                      {on ? <Check size={11} strokeWidth={3} aria-hidden /> : <Plus size={11} strokeWidth={3} aria-hidden />} {label(c.node)}
                    </small>
                  </button>
                );
              })}
              {!left.length && <span className="cg-empty">Every card is installed.</span>}
            </div>
            <div className="sp-run">
              {running ? (
                <button type="button" className="btn btn-sm" onClick={skip}>
                  <Square size={14} aria-hidden /> Skip to the end
                </button>
              ) : (
                <button type="button" className="btn btn-sm btn-primary sp-go" onClick={start} disabled={run.done}>
                  <Play size={15} aria-hidden /> {runs ? 'Run it again' : 'Run the spike'}
                </button>
              )}
              <div className="cg-choice sp-speed" role="group" aria-label="Run speed">
                {(
                  [
                    [1, '1×'],
                    [2, '2×'],
                    [0, 'Instant'],
                  ] as const
                ).map(([v, t]) => (
                  <button key={t} type="button" aria-pressed={effSpeed === v} disabled={running || (reduce && v !== 0)} onClick={() => setSpeed(v)}>
                    {v === 2 && <FastForward size={12} aria-hidden />} {t}
                  </button>
                ))}
              </div>
            </div>
          </>
        }
        msg={run.msg}
        onHint={hint}
        hintDisabled={running}
        onReset={onReset}
        done={run.done}
        stars={starsFor(run.misses, run.hints)}
        best={best}
        misses={run.misses}
        hints={run.hints}
        winTitle="Survived the spike"
        next={next}
      />
    </div>
  );
}

/** utilisation as a percentage: '<1%' for a sliver, '>999%' for a meltdown */
const pct = (u: number) => (u >= 10 ? '>999%' : u > 0 && u < 0.01 ? '<1%' : `${formatNum(u * 100)}%`);
const fmtT = (t: number) => `${formatNum(t, Number.isInteger(t) ? 0 : 1)} s`;

/** a goal metric's value as words */
function metricText(g: SpikeGoal, v: number): string {
  const m = g.metric;
  const val = m === 'p99' ? formatNum(v, 0, ' ms') : m === 'cost' ? formatNum(v) : formatNum(v, v < 10 ? 1 : 0, '%');
  const lim = m === 'p99' ? formatNum(g.max, 0, ' ms') : m === 'cost' ? formatNum(g.max) : formatNum(g.max, g.max < 10 ? 1 : 0, '%');
  const name = m === 'p99' ? 'p99' : m === 'errors' ? 'Errors' : m === 'shed' ? 'Shed traffic' : m === 'cost' ? 'Cost' : 'Utilisation';
  return `${name} reached ${val}, over the ${lim} limit`;
}
const unitOf = (g: SpikeGoal) => (g.metric === 'p99' ? ' ms' : g.metric === 'cost' ? '' : '%');
const fmtMetric = (g: SpikeGoal, v: number) => formatNum(v, g.metric === 'p99' || g.metric === 'cost' || v >= 10 ? 0 : 1, unitOf(g));
const fmtRps = (v: number) => (v >= 1e6 ? `${formatNum(v / 1e6, 1)}M` : v >= 1e3 ? `${formatNum(v / 1e3, v >= 1e4 ? 0 : 1)}K` : formatNum(v));

/** live numbers under the chart (hidden from screen readers while running: the end report speaks) */
function Readout({ puzzle, s }: { puzzle: SpikePuzzle; s: SpikeSample | null }) {
  return (
    <div className="sp-readout mono" aria-hidden>
      <span>
        t <b>{s ? fmtT(s.t) : '—'}</b>
      </span>
      <span>
        traffic <b>{s ? `${fmtRps(s.offered)}/s` : '—'}</b>
      </span>
      {puzzle.goals.map((g) => (
        <span key={g.label} className={s && !spikeHolds(s, g) ? 'bad' : ''}>
          {g.metric.startsWith('util:') ? g.label.split(' ')[0] : g.metric} <b>{s ? fmtMetric(g, spikeValue(s, g.metric)) : '—'}</b>
        </span>
      ))}
    </div>
  );
}

/** lanes: traffic, then one per goal (its metric against the limit), drawn up to the playhead */
function SpikeChart({ puzzle, times, samples, report, running }: { puzzle: SpikePuzzle; times: number[]; samples: SpikeSample[]; report: Report | null; running: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const W = Math.max(240, width);
  const lanes = 1 + puzzle.goals.length;
  const laneH = W < 480 ? 54 : 62;
  const gap = 12;
  const padL = 8;
  const padR = 8;
  const top = 16;
  const H = top + lanes * laneH + (lanes - 1) * gap + 18;
  const T = puzzle.duration || 1;
  const x = (t: number) => padL + ((W - padL - padR) * t) / T;
  const peakRps = Math.max(1, ...puzzle.traffic.map((p) => p[1]));
  const laneTop = (i: number) => top + i * (laneH + gap);
  const yIn = (i: number, v: number, vmax: number) => laneTop(i) + laneH - (laneH * Math.max(0, Math.min(v, vmax))) / vmax;
  const line = (i: number, vals: number[], vmax: number) => vals.map((v, k) => `${k ? 'L' : 'M'}${x(samples[k].t).toFixed(1)} ${yIn(i, v, vmax).toFixed(1)}`).join(' ');
  const playT = samples.length ? samples[samples.length - 1].t : 0;
  const first = report?.breaches[0];
  // the planned traffic curve (faint) so the learner sees the spike coming
  const plan = times.map((t, k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)} ${yIn(0, spikeTraffic(puzzle, t), peakRps * 1.1).toFixed(1)}`).join(' ');
  return (
    <div ref={ref} className="sp-chart" role="img" aria-label={chartLabel(puzzle, samples, report)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        {/* traffic lane */}
        <g>
          <rect className="sp-lane" x={padL} y={laneTop(0)} width={W - padL - padR} height={laneH} rx={6} />
          <text className="sp-lane-l" x={padL + 6} y={laneTop(0) + 13}>
            traffic · peak {fmtRps(peakRps)}/s
          </text>
          <path className="sp-plan" d={plan} />
          {samples.length > 1 && (
            <>
              <path className="sp-area" d={`${line(0, samples.map((s) => s.offered), peakRps * 1.1)} L${x(playT).toFixed(1)} ${laneTop(0) + laneH} L${x(0)} ${laneTop(0) + laneH} Z`} />
              <path className="sp-line rps" d={line(0, samples.map((s) => s.offered), peakRps * 1.1)} />
            </>
          )}
        </g>
        {puzzle.goals.map((g, gi) => {
          const i = gi + 1;
          const vals = samples.map((s) => spikeValue(s, g.metric));
          const vmax = Math.max(g.max * 2.5, 1e-9);
          const yLim = yIn(i, g.max, vmax);
          const br = report?.breaches.find((b) => b.goal === gi) ?? (running ? (() => {
            const s = samples.find((q) => !spikeHolds(q, g));
            return s ? { goal: gi, t: s.t, value: spikeValue(s, g.metric) } : undefined;
          })() : undefined);
          return (
            <g key={g.label}>
              <rect className="sp-lane" x={padL} y={laneTop(i)} width={W - padL - padR} height={laneH} rx={6} />
              <rect className="sp-danger" x={padL} y={laneTop(i)} width={W - padL - padR} height={Math.max(0, yLim - laneTop(i))} rx={6} />
              <line className="sp-limit" x1={padL} x2={W - padR} y1={yLim} y2={yLim} />
              <text className="sp-lane-l" x={padL + 6} y={laneTop(i) + 13}>
                {g.label}
              </text>
              {samples.length > 1 && <path className={`sp-line ${br ? 'bad' : 'ok'}`} d={line(i, vals, vmax)} />}
              {samples.length > 0 &&
                vals.map((v, k) => (v > vmax ? <path key={k} className="sp-clip" d={`M${x(samples[k].t) - 3} ${laneTop(i) + 5} l3 -4 l3 4z`} /> : null))}
              {br && (
                <g className="sp-breach">
                  <circle cx={x(br.t)} cy={yIn(i, br.value, vmax)} r={4.5} />
                </g>
              )}
            </g>
          );
        })}
        {(puzzle.bursts ?? []).map((b, k) => (
          <g key={k} className="sp-burst">
            <rect x={x(b.from)} y={top - 4} width={Math.max(3, x(b.to) - x(b.from))} height={H - top - 14} />
            {b.label && (
              <text x={Math.min(W - 4, x(b.from) + 4)} y={top - 6} textAnchor={x(b.from) > W - 90 ? 'end' : 'start'}>
                {b.label}
              </text>
            )}
          </g>
        ))}
        {first && (
          <g className="sp-breach-line">
            <line x1={x(first.t)} x2={x(first.t)} y1={top - 2} y2={H - 16} />
          </g>
        )}
        {samples.length > 0 && !report && <line className="sp-playhead" x1={x(playT)} x2={x(playT)} y1={top - 2} y2={H - 16} />}
        <text className="sp-axis" x={padL} y={H - 3}>
          0 s
        </text>
        <text className="sp-axis" x={W - padR} y={H - 3} textAnchor="end">
          {puzzle.duration} s
        </text>
        {first && (
          <text className="sp-axis bad" x={Math.min(Math.max(x(first.t), 40), W - 40)} y={H - 3} textAnchor="middle">
            broke at {fmtT(first.t)}
          </text>
        )}
      </svg>
    </div>
  );
}

function chartLabel(p: SpikePuzzle, samples: SpikeSample[], report: Report | null): string {
  const peak = Math.max(...p.traffic.map((x) => x[1]));
  const base = `Chart: traffic over ${p.duration} s, peaking at ${fmtRps(peak)} requests per second, with ${p.goals.map((g) => g.label).join(', ')}.`;
  if (!report) return samples.length ? `${base} Running.` : `${base} Not run yet.`;
  if (report.pass) return `${base} Every goal held.`;
  return `${base} ${report.breaches.map((b) => `${p.goals[b.goal].label} broke at ${fmtT(b.t)}`).join('; ')}.`;
}

/** the end-of-run report: each goal's peak against its limit, when it first broke, and the hottest box */
function ReportTable({ puzzle, report }: { puzzle: SpikePuzzle; report: Report }) {
  const peakUtil = puzzle.nodes
    .filter((n) => n.capacity !== undefined)
    .map((n) => {
      const all = report.samples.map((s) => s.util[n.id] ?? 0);
      const pk = Math.max(...all);
      return { n, pk, at: report.samples[all.indexOf(pk)]?.t ?? 0 };
    });
  return (
    <div className={`sp-report ${report.pass ? 'ok' : 'bad'}`}>
      <h4>
        {report.pass ? <Check size={15} strokeWidth={3} aria-hidden /> : <Flame size={15} aria-hidden />} Run report
      </h4>
      <table>
        <thead>
          <tr>
            <th scope="col">Goal</th>
            <th scope="col">Peak</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {puzzle.goals.map((g, gi) => {
            const vals = report.samples.map((s) => spikeValue(s, g.metric));
            const peak = Math.max(...vals);
            const br = report.breaches.find((b) => b.goal === gi);
            return (
              <tr key={g.label} className={br ? 'bad' : 'ok'}>
                <th scope="row">{g.label}</th>
                <td className="mono">{fmtMetric(g, peak)}</td>
                <td>{br ? `broke at ${fmtT(br.t)}` : 'held'}</td>
              </tr>
            );
          })}
          {peakUtil.map(({ n, pk, at }) => (
            <tr key={n.id} className={pk >= 1 ? 'bad' : 'ok'}>
              <th scope="row">{n.label}</th>
              <td className="mono">{pct(pk)}</td>
              <td>{pk >= 1 ? `over capacity at ${fmtT(at)}` : `peak at ${fmtT(at)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
