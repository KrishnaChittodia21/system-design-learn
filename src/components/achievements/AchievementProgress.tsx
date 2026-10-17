import { ProgressBar } from '../ui';

/** A labelled progress bar toward a badge's next step ("34 / 50 sections"). */
export default function AchievementProgress({ value, goal, label }: { value: number; goal: number; label: string }) {
  const shown = Math.min(value, goal);
  return (
    <div className="ach-progress">
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={shown} className="ach-progress-bar">
        <ProgressBar value={goal ? (shown / goal) * 100 : 0} />
      </div>
      <span className="small muted mono" aria-hidden>
        {shown} / {goal}
      </span>
    </div>
  );
}
