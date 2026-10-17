import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import AchievementBadge from './AchievementBadge';
import { achievementById, TIER_LABEL, type TierStep } from '../../content/achievements';
import { useFocusTrap } from '../../lib/useFocusTrap';
import type { UnlockedItem } from '../../lib/useAchievements';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One confetti burst in the earned tiers' colours (read from the theme tokens). Skipped for reduced motion. */
function burst(tiers: TierStep[]) {
  if (reducedMotion()) return;
  const css = getComputedStyle(document.documentElement);
  const colors = [...new Set(tiers.flatMap((t) => [`--tier-${t}-hi`, `--tier-${t}-lo`]).concat('--accent', '--margin-rule'))]
    .map((v) => css.getPropertyValue(v).trim())
    // confetti needs plain hex/rgb colours, not color-mix() or var()
    .filter((c) => c && !c.includes('('));
  import('canvas-confetti')
    .then(({ default: confetti }) => {
      const opts = { colors: colors.length ? colors : undefined, disableForReducedMotion: true, zIndex: 120 };
      confetti({ ...opts, particleCount: 110, spread: 75, startVelocity: 45, origin: { y: 0.55 } });
      setTimeout(() => confetti({ ...opts, particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.7 } }), 200);
      setTimeout(() => confetti({ ...opts, particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.7 } }), 200);
    })
    .catch(() => {
      // confetti chunk failed to load (offline): decoration only
    });
}

/**
 * "Achievement unlocked" dialog. One item → the badge animates in large; several (first load of existing
 * progress, a big jump) → one combined grid. Focus-trapped; Esc, the close button, the backdrop or
 * "Keep going" dismiss it.
 */
export default function AchievementCelebration({ items, onClose, onViewAll }: { items: UnlockedItem[]; onClose: () => void; onViewAll: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useFocusTrap(ref, true, onClose);
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    burst(items.map((i) => i.tier));
  }, [items]);

  const list = items.flatMap((i) => (achievementById[i.id] ? [{ ...i, a: achievementById[i.id] }] : []));
  const single = list.length === 1;
  const first = list[0];
  const pop = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { scale: 0.2, rotate: -200, opacity: 0 }, animate: { scale: 1, rotate: 0, opacity: 1 } };

  return (
    <div className="modal-backdrop ach-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        ref={ref}
        className={`modal ach-modal ${single ? '' : 'ach-modal-many'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ach-title"
        aria-describedby="ach-desc"
        tabIndex={-1}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <button type="button" className="btn-ghost icon-btn ach-close" aria-label="Close" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
        <span className="eyebrow ach-eyebrow">
          <Sparkles size={14} aria-hidden /> {single ? 'Achievement unlocked' : 'Achievements unlocked'}
        </span>

        {single && first ? (
          <div className="ach-single">
            <div className="ach-hero" aria-hidden>
              <motion.div {...pop} transition={reduce ? { duration: 0.2 } : { type: 'spring', stiffness: 170, damping: 14, delay: 0.1 }}>
                <AchievementBadge art={first.a.art} tier={first.tier} size="lg" shine />
              </motion.div>
            </div>
            <h2 id="ach-title">{first.a.name}</h2>
            {TIER_LABEL[first.tier] && <span className={`ach-tier-pill tier-${first.tier}`}>{TIER_LABEL[first.tier]} tier</span>}
            <p id="ach-desc" className="muted">
              {first.a.description}
            </p>
          </div>
        ) : (
          <>
            <h2 id="ach-title">You&apos;ve earned {list.length} achievements</h2>
            <p id="ach-desc" className="muted">
              Nice work. Here is everything your progress has unlocked.
            </p>
            <ul className="ach-burst-grid">
              {list.map((i, n) => (
                <motion.li
                  key={i.id}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: -30 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={reduce ? { duration: 0.2 } : { type: 'spring', stiffness: 260, damping: 18, delay: 0.08 + Math.min(n, 16) * 0.05 }}
                >
                  <AchievementBadge art={i.a.art} tier={i.tier} size="md" />
                  <span className="ach-burst-name">{i.a.name}</span>
                  {TIER_LABEL[i.tier] && <span className="small muted">{TIER_LABEL[i.tier]}</span>}
                </motion.li>
              ))}
            </ul>
          </>
        )}

        <div className="ach-actions">
          <button type="button" className="btn" onClick={onViewAll}>
            View all achievements <ArrowRight size={15} aria-hidden />
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>
            Keep going
          </button>
        </div>
      </motion.div>
    </div>
  );
}
