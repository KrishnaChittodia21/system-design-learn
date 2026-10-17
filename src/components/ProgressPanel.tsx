import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { PhaseProgress, StatusCounts, VolumeRow } from '../lib/metrics';
import { phaseCode, shortTitle } from '../lib/labels';
import { ChartCard } from './charts/ChartCard';
import { STATE_COLOR, phaseState } from './phaseState';

const pctOf = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

const STATES = [
  { id: 'passed', label: 'passed', color: 'var(--cyan)' },
  { id: 'inProgress', label: 'in progress', color: 'var(--amber)' },
  { id: 'notStarted', label: 'not started', color: 'var(--tint-2)' },
] as const;

/** donut stops with a hairline gap between segments, as in the mockup */
function donut(c: StatusCounts) {
  const total = Math.max(1, c.total);
  const shown = STATES.filter((s) => c[s.id] > 0);
  const gap = shown.length > 1 ? 0.5 : 0;
  let acc = 0;
  const stops: string[] = [];
  for (const s of shown) {
    const a0 = acc;
    const a1 = acc + (c[s.id] / total) * 100;
    stops.push(`${s.color} ${a0.toFixed(2)}% ${(a1 - gap).toFixed(2)}%`, `transparent ${(a1 - gap).toFixed(2)}% ${a1.toFixed(2)}%`);
    acc = a1;
  }
  return stops.length ? `conic-gradient(${stops.join(',')})` : 'var(--tint-2)';
}

/**
 * Dashboard "Progress at a glance" (topics by status, as a donut, plus practice volume) and "By phase" (one
 * passed / in-progress bar per phase, each a link into Contents). Both cards keep a "View as table" twin.
 */
export function ProgressPanel({
  counts,
  phases,
  currentPhaseId,
  passMark,
  volume,
}: {
  counts: StatusCounts;
  phases: PhaseProgress[];
  currentPhaseId?: string;
  passMark: number;
  volume: VolumeRow[];
}) {
  return (
    <section className="td-two">
      <ChartCard
        className="glass td-chart td-glance"
        title="Progress at a glance"
        subtitle={`${counts.total} topics · a topic is passed when its exam scores ${passMark}% or more`}
        table={{
          columns: ['Measure', 'Done', 'Of', 'Share'],
          rows: [
            ...STATES.map((s) => [`Topics ${s.label}`, counts[s.id], counts.total, `${pctOf(counts[s.id], counts.total)}%`]),
            ...volume.map((v) => [v.label, v.done, v.total, `${v.pct}%`]),
          ],
        }}
      >
        <div className="td-donut-row">
          <div className="td-donut" role="img" aria-label={`Topics by status: ${STATES.map((s) => `${counts[s.id]} ${s.label}`).join(', ')}.`}>
            <div className="nb-ring" style={{ '--rw': '24px', background: donut(counts) } as CSSProperties} />
            <div className="td-donut-core" aria-hidden>
              <div>
                <div className="num td-donut-n">{counts.passed}</div>
                <div className="eyebrow">of {counts.total}</div>
              </div>
            </div>
          </div>
          <ul className="td-donut-list" aria-hidden>
            {STATES.map((s) => (
              <li key={s.id}>
                <span className={`td-sq td-sq-${s.id}`} style={{ background: s.color }} />
                <strong className="num">{counts[s.id]}</strong>
                {s.label}
              </li>
            ))}
          </ul>
        </div>
        {volume.length > 0 && (
          <dl className="td-volume">
            {volume.map((v) => (
              <div key={v.id}>
                <dt>
                  <Link to={v.href}>{v.label}</Link>
                </dt>
                <dd className="mono">
                  {v.done}
                  <span>/{v.total}</span>
                </dd>
                <dd className="track td-volume-track" aria-hidden>
                  {v.done > 0 && <i className="f-pass" style={{ width: `${v.pct}%` }} />}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </ChartCard>

      <ChartCard
        className="glass td-chart td-byphase"
        title="By phase"
        action={
          <span className="td-legend td-legend-s" aria-hidden>
            <span>
              <span className="dot td-key-cyan" />
              passed
            </span>
            <span>
              <span className="dot td-key-amber" />
              in progress
            </span>
          </span>
        }
        table={{
          columns: ['Phase', 'Passed', 'In progress', 'Not started', 'Topics'],
          rows: phases.map((ph) => [`${phaseCode(ph.number)} ${ph.title}`, ph.passed, ph.inProgress, ph.notStarted, ph.total]),
        }}
      >
        <ol className="td-pb">
          {phases.map((ph) => {
            const s = phaseState(ph, currentPhaseId);
            return (
              <li key={ph.id} className="td-pb-row">
                <span className="mono td-pb-n" style={{ color: STATE_COLOR[s] }} aria-hidden>
                  {phaseCode(ph.number)}
                </span>
                <Link to={`/contents#phase-${ph.id}`} className="td-pb-t" title={ph.title}>
                  {ph.title.length > 30 ? shortTitle(ph.title.replace(/^Miscellaneous:\s*/, '')) : ph.title}
                </Link>
                <span className="mono td-pb-c">
                  {ph.passed}/{ph.total}
                  <span className="sr-only"> passed, {ph.inProgress} in progress</span>
                </span>
                <div className="track td-pb-tr" aria-hidden>
                  {ph.passed > 0 && <i className="f-pass" style={{ flex: ph.passed }} />}
                  {ph.inProgress > 0 && <i className="f-prog" style={{ flex: ph.inProgress }} />}
                  {ph.notStarted > 0 && <i className="td-pb-rest" style={{ flex: ph.notStarted }} />}
                </div>
              </li>
            );
          })}
        </ol>
      </ChartCard>
    </section>
  );
}
