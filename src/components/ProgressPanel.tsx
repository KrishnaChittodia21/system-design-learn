import { Link } from 'react-router-dom';
import { Lock, LockOpen } from 'lucide-react';
import { COMPANY_QUESTIONS, PHASES, TOPICS } from '../content';
import type { Progress } from '../lib/progress';
import { companyUnlocked } from '../lib/stats';
import { phaseProgress, practiceVolume, statusCounts, type PhaseProgress, type StatusCounts } from '../lib/metrics';
import { phaseCode } from '../lib/labels';
import { ChartCard } from './charts/ChartCard';
import { useTip } from './charts/hooks';
import { ChartTip, TipRow } from './charts/tooltip';

type StatusKey = 'passed' | 'inProgress' | 'notStarted';

// Topic status in the app's semantic colours (passed green, in progress amber, not started neutral), the same
// family QA Learn uses: --dv-st-* in index.css, validated light + dark. Labels, the legend, tooltips and the
// table view carry the same information, so colour never stands alone.
const STATES: { id: StatusKey; label: string; color: string }[] = [
  { id: 'passed', label: 'Passed', color: 'var(--dv-st-pass)' },
  { id: 'inProgress', label: 'In progress', color: 'var(--dv-st-prog)' },
  { id: 'notStarted', label: 'Not started', color: 'var(--dv-st-new)' },
];
const LEGEND = STATES.map((s) => ({ label: s.label, color: s.color }));
const pctOf = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const mix = (c: Record<StatusKey, number>) => STATES.map((s) => `${c[s.id]} ${s.label.toLowerCase()}`).join(', ');

/** Dashboard "Progress at a glance": topics by status (donut), status mix per phase (stacked bars) and practice figures. */
export function ProgressPanel({ p }: { p: Progress }) {
  const all = statusCounts(p, TOPICS);
  const phases = phaseProgress(p, TOPICS, PHASES);
  const { unlocked, remaining } = companyUnlocked(p, TOPICS);
  const vol = new Map(practiceVolume(p, TOPICS, COMPANY_QUESTIONS.length).map((v) => [v.id, v]));
  const left = remaining.length;
  const figures = [
    { id: 'learn', label: 'Sections read', hint: 'Tick “Read” at the end of each Learn section.' },
    { id: 'code', label: 'Code labs done', hint: 'Code Lab (Answer Lab in the behavioural topics): fix it, then compare with the reference.' },
    { id: 'envelope', label: 'Back-of-envelope drills done', hint: 'Estimation maths, revealed one step at a time.' },
    {
      id: 'company',
      label: 'Company questions practised',
      href: '/companies',
      hint: unlocked ? 'Company track unlocked: timed mocks on real questions.' : `Locked: unlocks after ${left} more exam${left === 1 ? '' : 's'}.`,
    },
  ].flatMap((f) => {
    const v = vol.get(f.id);
    return v ? [{ ...f, done: v.done, total: v.total }] : [];
  });

  return (
    <section className="dash-section progress-panel" aria-labelledby="progress-title">
      <div className="dash-section-head">
        <h2 id="progress-title">Progress at a glance</h2>
        <p className="muted small">
          A topic is passed once its timed exam is. <Link to="/contents">All topics in Contents →</Link>
        </p>
      </div>
      <div className="progress-grid">
        <ChartCard
          title="Topics by status"
          subtitle={`${all.total} topics`}
          legend={LEGEND}
          table={{ columns: ['Status', 'Topics', 'Share'], rows: STATES.map((s) => [s.label, all[s.id], `${pctOf(all[s.id], all.total)}%`]) }}
        >
          <StatusDonut counts={all} />
        </ChartCard>
        <ChartCard
          title="By phase"
          subtitle="Status of each phase's topics. Select a phase to open it in Contents."
          legend={LEGEND}
          table={{
            columns: ['Phase', 'Passed', 'In progress', 'Not started', 'Topics'],
            rows: [
              ...phases.map((ph) => [`${phaseCode(ph.number)} ${ph.title}`, ph.passed, ph.inProgress, ph.notStarted, ph.total]),
              ['Company track', unlocked ? 'Unlocked' : `Locked (${left} exam${left === 1 ? '' : 's'} to go)`, '', '', COMPANY_QUESTIONS.length],
            ],
          }}
        >
          <PhaseBars phases={phases} unlocked={unlocked} remaining={left} />
        </ChartCard>
        <div className="progress-figures" role="group" aria-label="Practice done">
          {figures.map((x) => (
            <div key={x.id} className="progress-figure">
              <div className="progress-figure-label">
                {x.href ? <Link to={x.href}>{x.label}</Link> : x.label}
                {x.id === 'company' && (
                  <span className={`dv-lock ${unlocked ? 'on' : ''}`}>
                    {unlocked ? <LockOpen size={12} aria-hidden /> : <Lock size={12} aria-hidden />} {unlocked ? 'unlocked' : 'locked'}
                  </span>
                )}
              </div>
              <div className="progress-figure-value">
                {x.done}
                <span>/{x.total}</span>
              </div>
              <div className="progress-figure-meter" aria-hidden>
                <span style={{ width: `${pctOf(x.done, x.total)}%` }} />
              </div>
              <p className="progress-figure-hint">{x.hint}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusDonut({ counts }: { counts: StatusCounts }) {
  const { ref, tip, bind } = useTip();
  const size = 168;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = Math.max(1, counts.total);
  const shown = STATES.filter((s) => counts[s.id] > 0);
  const gap = shown.length > 1 ? 2 : 0; // 2px surface gap between segments
  const segs = shown.map((s, i) => ({
    ...s,
    len: (counts[s.id] / total) * c,
    start: (shown.slice(0, i).reduce((a, x) => a + counts[x.id], 0) / total) * c,
  }));
  return (
    <div className="donut-wrap status-donut" ref={ref}>
      <div className="donut">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="group" aria-label={`Topics by status: ${mix(counts)}, of ${counts.total}.`}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {segs.map((s) => {
              const share = pctOf(counts[s.id], counts.total);
              return (
                <circle
                  key={s.id}
                  className="donut-seg"
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${Math.max(0, s.len - gap)} ${c}`}
                  strokeDashoffset={-s.start}
                  tabIndex={0}
                  role="img"
                  aria-label={`${s.label}: ${counts[s.id]} of ${counts.total} topics (${share}%)`}
                  {...bind(<TipRow value={`${counts[s.id]} · ${share}%`} label={`${s.label} topics`} color={s.color} />)}
                />
              );
            })}
          </g>
        </svg>
        <div className="donut-center" aria-hidden>
          <span className="donut-value">{pctOf(counts.passed, counts.total)}%</span>
          <span className="donut-label">passed</span>
        </div>
      </div>
      <ul className="donut-direct" aria-hidden>
        {STATES.map((s) => (
          <li key={s.id}>
            <strong>{counts[s.id]}</strong> {s.label.toLowerCase()}
          </li>
        ))}
      </ul>
      <ChartTip tip={tip} />
    </div>
  );
}

/** One 100% stacked bar per phase (status mix), as in QA Learn, ending at the company track. */
function PhaseBars({ phases, unlocked, remaining }: { phases: PhaseProgress[]; unlocked: boolean; remaining: number }) {
  const { ref, tip, bind } = useTip();
  return (
    <div className="phase-bars-wrap" ref={ref}>
      <ol className="phase-bars">
        {phases.map((ph) => (
          <li key={ph.id} className="phase-bar-row">
            <div className="phase-bar-head">
              <span className="phase-bar-num" aria-hidden>
                {phaseCode(ph.number)}
              </span>
              <Link to={`/contents#phase-${ph.id}`} className="phase-bar-title">
                {ph.title}
              </Link>
              <span className="phase-bar-count">
                {ph.passed}/{ph.total} passed
              </span>
            </div>
            <div className="phase-bar" role="group" aria-label={`Phase ${ph.number}, ${ph.title}: ${mix(ph)}`}>
              {STATES.filter((s) => ph[s.id] > 0).map((s) => (
                <span
                  key={s.id}
                  className="phase-bar-seg dv-mark"
                  style={{ flexGrow: ph[s.id], background: s.color }}
                  tabIndex={0}
                  role="img"
                  aria-label={`${ph.title}: ${ph[s.id]} ${s.label.toLowerCase()}`}
                  {...bind(<TipRow value={`${ph[s.id]} of ${ph.total}`} label={`${s.label} · ${ph.title}`} color={s.color} />)}
                />
              ))}
            </div>
          </li>
        ))}
        <li className={`phase-bar-row goal ${unlocked ? 'done' : ''}`}>
          <div className="phase-bar-head">
            <span className="phase-bar-num">{unlocked ? <LockOpen size={13} aria-hidden /> : <Lock size={13} aria-hidden />}</span>
            <Link to="/companies" className="phase-bar-title">
              Company track
            </Link>
            <span className="phase-bar-count">{unlocked ? 'unlocked' : 'locked'}</span>
          </div>
          <p className="phase-bar-track-note">
            {unlocked ? 'Unlocked: timed mocks on real interview questions.' : `Unlocks after ${remaining} more exam${remaining === 1 ? '' : 's'}.`}
          </p>
        </li>
      </ol>
      <ChartTip tip={tip} />
    </div>
  );
}
