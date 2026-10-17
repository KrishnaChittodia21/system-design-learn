import { useState, type CSSProperties } from 'react';
import { Award, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import AchievementBadge from '../components/achievements/AchievementBadge';
import AchievementProgress from '../components/achievements/AchievementProgress';
import { useProgress } from '../lib/progress';
import { ACHIEVEMENT_TOTAL, badgeLabel, formatEarnedDate, useAchievementEvaluations } from '../lib/achievements';
import {
  ACHIEVEMENTS,
  closestNext,
  GROUPS,
  nextToEarn,
  TIER_LABEL,
  TIERS,
  tierRank,
  type Achievement,
  type Evaluation,
  type StoredAchievement,
} from '../content/achievements';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'earned', label: 'Earned' },
  { id: 'locked', label: 'Locked' },
] as const;
type Filter = (typeof FILTERS)[number]['id'];

/** One badge card: medal, name, tier ladder, progress toward the next tier, earned date. Locked ones are shown dimmed. */
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
        className={`ach-card ${earned ? `is-earned tier-${stored?.tier}` : 'is-locked'}`}
        tabIndex={0}
        role="group"
        aria-label={badgeLabel(a, stored, ev)}
        aria-disabled={earned ? undefined : 'true'}
      >
        <div className="ach-card-medal">
          <AchievementBadge art={a.art} tier={stored?.tier ?? 'standard'} locked={!earned} size="md" />
        </div>
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
                    <span className="ach-step-dot" aria-hidden />
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
            <p className="ach-card-meta">
              {TIER_LABEL[stored.tier] && <span className={`ach-tier-pill tier-${stored.tier}`}>{TIER_LABEL[stored.tier]}</span>}
              <span>Earned {formatEarnedDate(stored.earnedAt)}</span>
              {!next && ladder.length > 0 && <span>· top tier</span>}
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
  const pct = ACHIEVEMENT_TOTAL ? Math.round((earnedCount / ACHIEVEMENT_TOTAL) * 100) : 0;
  const tierCounts = TIERS.map((t) => ({ tier: t, n: Object.values(stored).filter((s) => s.tier === t).length }));
  const next = closestNext(evs, stored);
  const nextStored = next ? stored[next.achievement.id] : undefined;
  const visible = (a: Achievement) => (filter === 'all' ? true : filter === 'earned' ? !!stored[a.id]?.tier : !stored[a.id]?.tier);

  return (
    <div className="page ach-page">
      <header className="ach-head">
        <div className="ach-head-copy">
          <span className="eyebrow">
            <Award size={14} aria-hidden /> Achievements
          </span>
          <h1>
            Milestones on the way to <span className="gtext">the offer</span>
          </h1>
          <p className="lede">Badges for what you have read, passed and practised. Tiered badges climb from bronze to diamond as you keep going.</p>
        </div>
        <div className="ach-tally glass-flat" role="group" aria-label={`${earnedCount} of ${ACHIEVEMENT_TOTAL} achievements earned`}>
          <div className="ach-ring" style={{ '--p': pct } as CSSProperties} aria-hidden>
            <div className="nb-ring" />
            <div className="ach-ring-c">
              <span className="num">{earnedCount}</span>
              <span className="mono">of {ACHIEVEMENT_TOTAL}</span>
            </div>
          </div>
          <ul className="ach-tiers" aria-label="Badges by tier">
            {tierCounts.map(({ tier, n }) => (
              <li key={tier} className={`tier-${tier} ${n ? 'has' : ''}`}>
                <span className="ach-tier-gem" aria-hidden />
                <span className="ach-tiers-lbl">{TIER_LABEL[tier]}</span>
                <span className="mono">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </header>

      {next?.ev.next && (
        <section className="ach-spot card" aria-labelledby="ach-spot-title">
          <div className="ach-spot-medal">
            <AchievementBadge
              art={next.achievement.art}
              tier={nextStored?.tier ?? 'standard'}
              locked={!nextStored?.tier}
              size="md"
              label={badgeLabel(next.achievement, nextStored, next.ev)}
            />
          </div>
          <div className="ach-spot-body">
            <span className="nb-chip cyan">
              <Sparkles size={12} aria-hidden /> Closest next
            </span>
            <h2 id="ach-spot-title">
              {next.achievement.name}
              {TIER_LABEL[next.ev.next.tier] && <span className={`ach-tier-pill tier-${next.ev.next.tier}`}>{TIER_LABEL[next.ev.next.tier]}</span>}
            </h2>
            <p className="muted">{next.ev.requirement}</p>
            <AchievementProgress
              value={next.ev.value}
              goal={next.ev.next.goal}
              label={`${next.achievement.name}: ${Math.min(next.ev.value, next.ev.next.goal)} of ${next.ev.next.goal} ${next.achievement.unit}`}
            />
          </div>
        </section>
      )}

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

      {GROUPS.map((g, gi) => {
        const all = ACHIEVEMENTS.filter((a) => a.group === g.id);
        const list = all.filter(visible);
        if (!list.length) return null;
        const got = all.filter((a) => stored[a.id]?.tier).length;
        return (
          <section key={g.id} className="ach-group" aria-labelledby={`ach-g-${g.id}`}>
            <div className="ach-group-head">
              <span className="ach-group-num mono" aria-hidden>
                {String(gi + 1).padStart(2, '0')}
              </span>
              <div className="ach-group-title">
                <h2 id={`ach-g-${g.id}`}>{g.title}</h2>
                <p className="muted">{g.blurb}</p>
              </div>
              <span className={`nb-chip ${got === all.length ? 'cyan' : ''}`}>
                {got} / {all.length}
                <span className="sr-only"> earned</span>
              </span>
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
