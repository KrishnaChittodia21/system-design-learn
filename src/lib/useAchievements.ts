import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluateAll, newlyEarned, tierRank, type TierStep } from '../content/achievements';
import { earnAchievements, type Progress } from './progress';
import { achievementCtx } from './achievements';

// wait for a burst of updates (an exam submit records answers + the test, a reset…) to settle first
const SETTLE_MS = 600;

export interface UnlockedItem {
  id: string;
  tier: TierStep;
}

/**
 * Achievement detection, mounted once in Layout. After progress changes it evaluates the catalogue,
 * stores newly earned badges / tier-ups and queues them for the celebration overlay. Everything found in
 * one evaluation (e.g. the first load of existing progress) lands in the queue together and is shown as
 * ONE celebration; anything already stored is never celebrated again and nothing is ever revoked.
 */
export function useAchievementDetection(p: Progress) {
  const [queue, setQueue] = useState<UnlockedItem[]>([]);
  // `${id}:${tier}` already stored in this session (guards StrictMode's double effects and the window
  // before the store's update comes back round)
  const sent = useRef(new Set<string>());

  useEffect(() => {
    const timer = setTimeout(() => {
      const fresh = newlyEarned(evaluateAll(p, achievementCtx), p.achievements).filter((e) => !sent.current.has(`${e.id}:${e.tier}`));
      if (!fresh.length) return;
      for (const e of fresh) sent.current.add(`${e.id}:${e.tier}`);
      earnAchievements(fresh);
      setQueue((q) => {
        const next = [...q];
        for (const e of fresh) {
          const i = next.findIndex((x) => x.id === e.id);
          if (i === -1) next.push({ id: e.id, tier: e.tier });
          else if (tierRank(e.tier) > tierRank(next[i].tier)) next[i] = { id: e.id, tier: e.tier };
        }
        return next;
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [p]);

  // a reset wipes the stored badges, so they may be earned (and celebrated) again
  useEffect(() => {
    if (!Object.keys(p.achievements ?? {}).length) sent.current.clear();
  }, [p.achievements]);

  const dismiss = useCallback(() => setQueue([]), []);
  return { queue, dismiss };
}
