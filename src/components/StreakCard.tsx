import { Flame } from 'lucide-react';
import { lastSevenDays, studyStreak } from '../lib/streak';
import { CountUp } from './CountUp';

/** Study streak: consecutive days with any study activity, and a 7-day dot strip. */
export function StreakCard({ days }: { days?: string[] }) {
  const streak = studyStreak(days);
  const week = lastSevenDays(days);
  return (
    <div className={`stat streak ${streak > 0 ? 'on' : ''}`}>
      <div className="streak-top">
        <Flame size={26} aria-hidden className="streak-flame" />
        <div>
          <div className="stat-value">
            <CountUp value={streak} /> <span className="streak-unit">day{streak === 1 ? '' : 's'}</span>
          </div>
          <div className="stat-label">Study streak</div>
        </div>
      </div>
      <ol className="streak-week" aria-label="Last 7 days">
        {week.map((d) => (
          <li key={d.day} className={d.active ? 'active' : ''} title={d.day}>
            <span className="streak-dot" aria-hidden />
            <span className="streak-day" aria-hidden>
              {d.label}
            </span>
            <span className="sr-only">
              {d.day}: {d.active ? 'studied' : 'no study'}
            </span>
          </li>
        ))}
      </ol>
      <div className="stat-hint">{week[6].active ? 'You studied today. Nice.' : streak ? 'Study something today to keep it going.' : 'Read a section or answer a question to start one.'}</div>
    </div>
  );
}
