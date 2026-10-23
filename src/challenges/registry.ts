// Discovery of end-of-topic challenges. Each topic's puzzles live in src/challenges/topics/<topic-id>.ts
// (default export: ChallengeSet). The glob is NOT eager: the file names are known at build time, but the
// puzzle data is a separate chunk loaded only when a topic page needs it.
import { useEffect, useState } from 'react';
import type { ChallengeSet } from './types';

const loaders = import.meta.glob<{ default: ChallengeSet }>('./topics/*.ts');

const byTopic = new Map(Object.entries(loaders).map(([path, load]) => [path.replace(/^.*\/([^/]+)\.ts$/, '$1'), load]));

/** topic ids that have a challenge file */
export const CHALLENGE_TOPICS: ReadonlySet<string> = new Set(byTopic.keys());

export const hasChallenges = (topicId: string) => byTopic.has(topicId);

const cache = new Map<string, Promise<ChallengeSet | null>>();

export function loadChallenges(topicId: string): Promise<ChallengeSet | null> {
  const load = byTopic.get(topicId);
  if (!load) return Promise.resolve(null);
  let p = cache.get(topicId);
  if (!p) {
    p = load()
      .then((m) => m.default ?? null)
      .catch(() => {
        cache.delete(topicId); // allow a retry after a failed chunk load (offline)
        return null;
      });
    cache.set(topicId, p);
  }
  return p;
}

/** The topic's challenge set once loaded (null while loading or when the topic has none). */
export function useChallengeSet(topicId: string): ChallengeSet | null {
  const [state, setState] = useState<{ id: string; set: ChallengeSet | null }>({ id: '', set: null });
  useEffect(() => {
    let live = true;
    loadChallenges(topicId).then((set) => live && setState({ id: topicId, set }));
    return () => {
      live = false;
    };
  }, [topicId]);
  return state.id === topicId ? state.set : null;
}

/** progress key of one puzzle */
export const puzzleKey = (topicId: string, puzzleId: string) => `${topicId}/${puzzleId}`;
