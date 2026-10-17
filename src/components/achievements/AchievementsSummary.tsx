import { Link } from 'react-router-dom';
import { ArrowRight, Award } from 'lucide-react';
import { motion } from 'motion/react';
import AchievementBadge from './AchievementBadge';
import AchievementProgress from './AchievementProgress';
import type { Progress } from '../../lib/progress';
import { ACHIEVEMENT_TOTAL, badgeLabel, formatEarnedDate, useAchievementEvaluations } from '../../lib/achievements';
import { closestNext, earnedList, TIER_LABEL } from '../../content/achievements';

const SHOW = 8;

/** Dashboard section: recent badges, x / total earned, and the closest next badge. */
export function AchievementsSummary({ p }: { p: Progress }) {
  const evs = useAchievementEvaluations(p);
  const earned = earnedList(p.achievements);
  const next = closestNext(evs, p.achievements);
  const nextStored = next ? p.achievements?.[next.achievement.id] : undefined;

  return (
    <section className="dash-section" aria-labelledby="dash-ach">
      <div className="dash-section-head">
        <h2 id="dash-ach">Achievements</h2>
        <Link to="/achievements" className="small">
          All achievements →
        </Link>
      </div>
      <div className="card ach-summary">
        <div className="ach-summary-earned">
          <div className="ach-summary-head">
            <Award size={18} aria-hidden className="ach-summary-icon" />
            <strong>
              {earned.length} / {ACHIEVEMENT_TOTAL}
            </strong>
            <span className="muted small">earned</span>
          </div>
          {earned.length ? (
            <ul className="ach-mini-grid" aria-label="Most recent achievements">
              {earned.slice(0, SHOW).map((e) => (
                <motion.li
                  key={e.id}
                  title={`${e.achievement.name}${TIER_LABEL[e.tier] ? ` · ${TIER_LABEL[e.tier]}` : ''} · ${formatEarnedDate(e.earnedAt)}`}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                >
                  <Link to="/achievements" className="ach-mini" aria-label={badgeLabel(e.achievement, e)}>
                    <AchievementBadge art={e.achievement.art} tier={e.tier} size="sm" />
                    <span className="ach-mini-name" aria-hidden>
                      {e.achievement.name}
                    </span>
                  </Link>
                </motion.li>
              ))}
            </ul>
          ) : (
            <p className="muted ach-empty">
              No badges yet, and that is how every system starts: with one request. Read your first Learn section or pass your first exam to
              earn one. Bronze, silver, gold and diamond tiers follow as you keep going.
            </p>
          )}
          {earned.length > SHOW && <p className="small muted ach-more">+{earned.length - SHOW} more on the Achievements page.</p>}
        </div>

        {next?.ev.next && (
          <div className="ach-summary-next">
            <span className="eyebrow">Closest next badge</span>
            <div className="ach-next">
              <AchievementBadge
                art={next.achievement.art}
                tier={nextStored?.tier ?? 'standard'}
                locked={!nextStored?.tier}
                size="md"
                label={badgeLabel(next.achievement, nextStored, next.ev)}
              />
              <div className="ach-next-body">
                <strong>
                  {next.achievement.name}
                  {TIER_LABEL[next.ev.next.tier] && <span className={`ach-tier-pill tier-${next.ev.next.tier}`}>{TIER_LABEL[next.ev.next.tier]}</span>}
                </strong>
                <span className="small muted">{next.ev.requirement}</span>
                <AchievementProgress
                  value={next.ev.value}
                  goal={next.ev.next.goal}
                  label={`${next.achievement.name}: ${Math.min(next.ev.value, next.ev.next.goal)} of ${next.ev.next.goal} ${next.achievement.unit}`}
                />
              </div>
            </div>
            <Link to="/achievements" className="btn btn-sm">
              View all achievements <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
