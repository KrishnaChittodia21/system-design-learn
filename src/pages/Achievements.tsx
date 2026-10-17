import { useState } from 'react';
import { Award } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import AchievementBadge from '../components/achievements/AchievementBadge';
import AchievementProgress from '../components/achievements/AchievementProgress';
import { useProgress } from '../lib/progress';
import { ACHIEVEMENT_TOTAL, badgeLabel, formatEarnedDate, useAchievementEvaluations } from '../lib/achievements';
import { ACHIEVEMENTS, GROUPS, nextToEarn, TIER_LABEL, tierRank, type Achievement, type Evaluation, type StoredAchievement } from '../content/achievements';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'earned', label: 'Earned' },
  { id: 'locked', label: 'Locked' },
] as const;
type Filter = (typeof FILTERS)[number]['id'];

/** One badge card: art, name, tier ladder, progress toward the next tier, earned date. Locked ones are shown disabled. */
function AchievementCard({ a, stored, ev }: { a: Achievement; stored?: StoredAchievement; ev: Evaluation }) {
  const earned = !!stored?.tier;
  const ladder = ev.tiers.filter((t) => t.tier !== 'standard');
  const next = nextToEarn(ev, stored);
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
    >
      <article
        className={`ach-card ${earned ? 'is-earned' : 'is-locked'}`}
        tabIndex={0}
        role="group"
        aria-label={badgeLabel(a, stored, ev)}
        aria-disabled={earned ? undefined : 'true'}
      >
        <AchievementBadge art={a.art} tier={stored?.tier ?? 'standard'} locked={!earned} size="md" />
        <div className="ach-card-body">
          <h3 className="ach-card-name">{a.name}</h3>
          <p className="ach-card-desc">{earned ? a.description : ev.requirement}</p>
          {ladder.length > 0 && (
            <ol className="ach-ladder" aria-label="Tiers">
              {ladder.map((t) => {
                const got = !!stored?.tier && tierRank(stored.tier) >= tierRank(t.tier);
                const when = got ? stored?.tiers?.[t.tier] : undefined;
                return (
                  <li
                    key={t.tier}
                    className={`ach-step tier-${t.tier} ${got ? 'got' : ''}`}
                    title={`${TIER_LABEL[t.tier]}: ${t.goal}${when ? ` · earned ${formatEarnedDate(when)}` : ''}`}
                  >
                    <span className="sr-only">{`${TIER_LABEL[t.tier]} at ${t.goal}${got ? ', earned' : ''}`}</span>
                    <span aria-hidden>{t.goal}</span>
                  </li>
                );
              })}
            </ol>
          )}
          {next && (
            <AchievementProgress
              value={ev.value}
              goal={next.goal}
              label={`${a.name}: ${Math.min(ev.value, next.goal)} of ${next.goal} ${a.unit}${TIER_LABEL[next.tier] ? ` toward ${TIER_LABEL[next.tier]}` : ''}`}
            />
          )}
          {earned && stored && (
            <p className="ach-card-meta small">
              {TIER_LABEL[stored.tier] && <span className={`ach-tier-pill tier-${stored.tier}`}>{TIER_LABEL[stored.tier]}</span>}
              <span className="muted">Earned {formatEarnedDate(stored.earnedAt)}</span>
              {!next && ladder.length > 0 && <span className="muted">· top tier</span>}
            </p>
          )}
        </div>
      </article>
    </motion.li>
  );
}

export default function AchievementsPage() {
  const p = useProgress();
  const evs = useAchievementEvaluations(p);
  const stored = p.achievements ?? {};
  const [filter, setFilter] = useState<Filter>('all');
  const earnedCount = ACHIEVEMENTS.filter((a) => stored[a.id]?.tier).length;
  const visible = (a: Achievement) => (filter === 'all' ? true : filter === 'earned' ? !!stored[a.id]?.tier : !stored[a.id]?.tier);

  return (
    <div className="page ach-page">
      <header className="ach-head">
        <div>
          <div className="eyebrow">Achievements</div>
          <h1>Milestones on the way to the offer</h1>
          <p className="lead">Badges for what you have read, passed and practised. Tiered badges climb from bronze to diamond as you keep going.</p>
        </div>
        <div className="ach-count" aria-label={`${earnedCount} of ${ACHIEVEMENT_TOTAL} achievements earned`}>
          <Award size={20} aria-hidden className="ach-summary-icon" />
          <strong>
            {earnedCount}
            <span className="muted"> / {ACHIEVEMENT_TOTAL}</span>
          </strong>
          <span className="small muted">earned</span>
        </div>
      </header>

      <div className="pill-group ach-filters" role="group" aria-label="Show achievements">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`chip ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {filter === f.id && <motion.span layoutId="ach-filter-pill" className="chip-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
            {f.label}
            {f.id === 'earned' && ` (${earnedCount})`}
            {f.id === 'locked' && ` (${ACHIEVEMENT_TOTAL - earnedCount})`}
          </button>
        ))}
      </div>

      {GROUPS.map((g) => {
        const list = ACHIEVEMENTS.filter((a) => a.group === g.id && visible(a));
        if (!list.length) return null;
        return (
          <section key={g.id} className="ach-group" aria-labelledby={`ach-g-${g.id}`}>
            <div className="dash-section-head">
              <h2 id={`ach-g-${g.id}`}>{g.title}</h2>
              <span className="small muted">{g.blurb}</span>
            </div>
            <ul className="ach-grid">
              <AnimatePresence initial={false}>
                {list.map((a) => (
                  <AchievementCard key={a.id} a={a} stored={stored[a.id]} ev={evs[a.id]} />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        );
      })}
      {filter === 'earned' && earnedCount === 0 && (
        <div className="card ach-none">
          <p className="muted">No badges yet. Read a Learn section or pass an exam to earn your first one.</p>
        </div>
      )}
    </div>
  );
}
