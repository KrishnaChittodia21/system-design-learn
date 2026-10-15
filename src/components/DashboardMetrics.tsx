import { Link } from 'react-router-dom';
import { BarChart3, Lock, LockOpen } from 'lucide-react';
import type { Topic } from '../types';
import type { Progress } from '../lib/progress';
import { localDay } from '../lib/progress';
import { studyStreak } from '../lib/streak';
import {
  activeDaysLastWeek,
  activityGrid,
  attemptTimeline,
  averageBest,
  difficultyAccuracy,
  examScores,
  mcqAccuracy,
  practiceVolume,
  ratingCounts,
  statusCounts,
} from '../lib/metrics';
import { CountUp } from './CountUp';
import { ChartCard } from './charts/ChartCard';
import { StatTile } from './charts/StatTile';
import { Donut } from './charts/Donut';
import { BarList } from './charts/BarList';
import { ColumnChart } from './charts/ColumnChart';
import { LineChart } from './charts/LineChart';
import { StackedBar } from './charts/StackedBar';
import { Heatmap } from './charts/Heatmap';

const LEVEL_LABEL: Record<string, string> = { medium: 'Medium', hard: 'Hard', expert: 'Expert' };

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The dashboard's Metrics section: KPI row plus a responsive grid of chart cards. */
export function DashboardMetrics({
  p,
  topics,
  readiness,
  companyTotal,
  companyUnlocked,
  firstExamHref,
}: {
  p: Progress;
  topics: Topic[];
  readiness: number;
  companyTotal: number;
  companyUnlocked: boolean;
  firstExamHref: string;
}) {
  const today = localDay();
  const status = statusCounts(p, topics);
  const scores = examScores(p, topics);
  const avg = averageBest(p, topics);
  const acc = mcqAccuracy(p, topics);
  const accPct = acc.seen ? Math.round((acc.correct / acc.seen) * 100) : null;
  const levels = difficultyAccuracy(p, topics);
  const ratings = ratingCounts(p, topics);
  const timeline = attemptTimeline(p, topics);
  const streak = studyStreak(p.activityDays, today);
  const week = activeDaysLastWeek(p.activityDays, today);
  const grid = activityGrid(p.activityDays, today, 12);
  const studied12 = grid.flat().filter((c) => c.active).length;
  const volume = practiceVolume(p, topics, companyTotal);
  const passMark = p.settings.passMark;
  const takeExam = (
    <Link className="btn" to={firstExamHref}>
      Take your first exam
    </Link>
  );

  return (
    <section className="dash-section" aria-labelledby="metrics-title">
      <div className="dash-section-head">
        <div>
          <div className="eyebrow">
            <BarChart3 size={14} aria-hidden /> Metrics
          </div>
          <h2 id="metrics-title">How you are doing</h2>
        </div>
      </div>

      <div className="dv-kpis">
        <StatTile
          label="Exams passed"
          value={
            <>
              <CountUp value={status.passed} />
              <span className="dv-stat-of">/{status.total}</span>
            </>
          }
          meter={(status.passed / Math.max(1, status.total)) * 100}
          hint={`pass mark ${passMark}%`}
        />
        <StatTile label="Readiness" value={<CountUp value={readiness} suffix="%" />} meter={readiness} hint="avg. completion of every topic" />
        <StatTile label="Average best score" value={avg === null ? '—' : <CountUp value={avg} suffix="%" />} hint={scores.length ? `over ${scores.length} exam${scores.length === 1 ? '' : 's'} taken` : 'no exams yet'} />
        <StatTile label="Exam question accuracy" value={accPct === null ? '—' : <CountUp value={accPct} suffix="%" />} hint={acc.seen ? `${acc.correct}/${acc.seen} latest answers right` : 'answer a question to see this'} />
        <StatTile
          label="Interview Qs practised"
          value={
            <>
              <CountUp value={ratings.rated} />
              <span className="dv-stat-of">/{ratings.total}</span>
            </>
          }
          meter={(ratings.rated / Math.max(1, ratings.total)) * 100}
          hint="self-rated after answering"
        />
        <StatTile
          label="Study streak"
          value={
            <>
              <CountUp value={streak} /> <span className="dv-stat-of">day{streak === 1 ? '' : 's'}</span>
            </>
          }
          hint={`${week} of the last 7 days`}
        />
      </div>

      <div className="dv-grid-cards">
        <ChartCard
          title="Overall progress"
          subtitle={`${status.total} topics by status`}
          table={{
            columns: ['Status', 'Topics', 'Share'],
            rows: [
              ['Passed', status.passed, `${Math.round((status.passed / Math.max(1, status.total)) * 100)}%`],
              ['In progress', status.inProgress, `${Math.round((status.inProgress / Math.max(1, status.total)) * 100)}%`],
              ['Not started', status.notStarted, `${Math.round((status.notStarted / Math.max(1, status.total)) * 100)}%`],
            ],
          }}
        >
          <Donut
            slices={[
              { id: 'passed', label: 'Passed', value: status.passed, color: 'var(--dv-ord-3)' },
              { id: 'progress', label: 'In progress', value: status.inProgress, color: 'var(--dv-ord-2)' },
              { id: 'new', label: 'Not started', value: status.notStarted, color: 'var(--dv-rest)' },
            ]}
            unit=" topics"
            center={
              <>
                <span className="dv-donut-value">{status.passed}</span>
                <span className="dv-donut-caption">of {status.total} passed</span>
              </>
            }
          />
        </ChartCard>

        <ChartCard
          title="Exam scores"
          subtitle={scores.length ? `Best score per exam, most recent first · line = pass mark ${passMark}%` : undefined}
          empty={
            scores.length ? undefined : (
              <>
                <p>Take your first exam to see your scores against the pass mark here.</p>
                {takeExam}
              </>
            )
          }
          table={{
            columns: ['Topic', 'Best', 'Last', 'Attempts', 'Passed'],
            rows: scores.map((s) => [s.title, `${s.best}%`, `${s.last}%`, s.attempts, s.passed ? 'Yes' : 'No']),
          }}
        >
          <BarList
            seriesLabel="Best exam score per topic"
            reference={{ value: passMark, label: `Pass mark ${passMark}%` }}
            rows={scores.slice(0, 8).map((s) => ({
              id: s.id,
              label: s.title,
              value: s.best,
              display: `${s.best}%`,
              detail: `last ${s.last}% · ${s.attempts} attempt${s.attempts === 1 ? '' : 's'} · ${s.passed ? 'passed' : 'not passed'}`,
              href: `/topic/${s.id}?tab=exam`,
            }))}
          />
          {scores.length > 8 && <p className="small muted">Showing the 8 most recent of {scores.length}. The table lists all.</p>}
        </ChartCard>

        <ChartCard
          title="Score trend"
          subtitle={timeline.length >= 2 ? `Your last ${timeline.length} full-length exam attempts, oldest → newest` : undefined}
          empty={
            timeline.length >= 2 ? undefined : (
              <>
                <p>{timeline.length ? 'One attempt so far. Take another full exam to see your trend.' : 'Take two full exams to see your score trend.'}</p>
                {takeExam}
              </>
            )
          }
          table={{
            columns: ['Date', 'Topic', 'Score'],
            rows: timeline.map((a) => [shortDate(a.at), a.title, `${a.score}%`]),
          }}
        >
          <LineChart
            seriesLabel="Exam score per attempt"
            reference={{ value: passMark, label: 'Pass' }}
            points={timeline.map((a, i) => ({ id: `${a.topicId}-${i}`, value: a.score, x: shortDate(a.at), label: a.title }))}
          />
        </ChartCard>

        <ChartCard
          title="Accuracy by difficulty"
          subtitle={levels.length ? 'Share of exam questions whose latest answer is right' : undefined}
          empty={
            levels.length ? undefined : (
              <>
                <p>Answer some exam questions to see where difficulty trips you up.</p>
                {takeExam}
              </>
            )
          }
          table={{ columns: ['Difficulty', 'Accuracy', 'Right', 'Answered'], rows: levels.map((l) => [LEVEL_LABEL[l.level], `${l.pct}%`, l.correct, l.seen]) }}
        >
          <ColumnChart columns={levels.map((l) => ({ id: l.level, label: LEVEL_LABEL[l.level], value: l.pct, display: `${l.pct}%`, detail: `${l.correct} of ${l.seen} right` }))} />
        </ChartCard>

        <ChartCard
          title="Interview self-ratings"
          subtitle={ratings.rated ? `${ratings.rated} of ${ratings.total} interview questions rated` : undefined}
          legend={[
            { label: `Nailed (${ratings.nailed})`, color: 'var(--dv-ord-3)' },
            { label: `Partial (${ratings.partial})`, color: 'var(--dv-ord-2)' },
            { label: `Missed (${ratings.missed})`, color: 'var(--dv-ord-1)' },
          ]}
          empty={
            ratings.rated ? undefined : (
              <>
                <p>Answer an interview question out loud, then rate yourself nailed, partial or missed. Your mix shows up here.</p>
                <Link className="btn" to="/contents">
                  Find interview questions
                </Link>
              </>
            )
          }
          table={{
            columns: ['Rating', 'Questions', 'Share'],
            rows: (['nailed', 'partial', 'missed'] as const).map((k) => [k[0].toUpperCase() + k.slice(1), ratings[k], `${Math.round((ratings[k] / Math.max(1, ratings.rated)) * 100)}%`]),
          }}
        >
          <StackedBar
            segments={[
              { id: 'nailed', label: 'Nailed', value: ratings.nailed, color: 'var(--dv-ord-3)', ink: 'var(--dv-ink-3)' },
              { id: 'partial', label: 'Partial', value: ratings.partial, color: 'var(--dv-ord-2)', ink: 'var(--dv-ink-2)' },
              { id: 'missed', label: 'Missed', value: ratings.missed, color: 'var(--dv-ord-1)', ink: 'var(--dv-ink-1)' },
            ]}
          />
          <p className="small muted">Partial and missed questions count as weak areas until you re-rate them.</p>
        </ChartCard>

        <ChartCard
          title="Study activity"
          subtitle={
            <>
              Last 12 weeks · {studied12} day{studied12 === 1 ? '' : 's'} studied ·{' '}
              <strong>
                {streak ? `${streak}-day streak` : 'no current streak'}
              </strong>
            </>
          }
          table={{
            columns: ['Week starting', 'Days studied', 'Days'],
            rows: grid.map((w) => [shortDate(`${w[0].day}T12:00:00`), w.filter((c) => c.active).length, w.filter((c) => c.active).map((c) => shortDate(`${c.day}T12:00:00`)).join(', ') || '—']),
          }}
        >
          <Heatmap weeks={grid} />
          <p className="small muted dv-heat-note">
            <span className="dv-key dv-key-rect" style={{ background: 'var(--dv-1)' }} aria-hidden />
            <span>studied</span>
            <span className="dv-key dv-key-rect dv-key-empty" aria-hidden />
            <span>no study</span>
            <span className="dv-key dv-key-rect dv-key-today" aria-hidden />
            <span>today</span>
          </p>
        </ChartCard>

        <ChartCard
          title="Practice done"
          subtitle={
            <>
              Share of each kind of practice completed ·{' '}
              <span className={`dv-lock ${companyUnlocked ? 'on' : ''}`}>
                {companyUnlocked ? <LockOpen size={12} aria-hidden /> : <Lock size={12} aria-hidden />} company track {companyUnlocked ? 'unlocked' : 'locked'}
              </span>
            </>
          }
          table={{ columns: ['Practice', 'Done', 'Total', 'Share'], rows: volume.map((v) => [v.label, v.done, v.total, `${v.pct}%`]) }}
        >
          <BarList
            seriesLabel="Practice completed by kind"
            rows={volume.map((v) => ({
              id: v.id,
              label: v.label,
              value: v.pct,
              display: `${v.done}/${v.total}`,
              detail: v.id === 'company' && !companyUnlocked ? `${v.pct}% · unlocks after every exam is passed` : `${v.pct}% done`,
              href: v.href,
            }))}
          />
        </ChartCard>
      </div>
    </section>
  );
}
