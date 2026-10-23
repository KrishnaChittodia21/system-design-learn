// The topic page's "Challenge" tab: a picker over the topic's puzzles plus the active puzzle. Lazy-loaded.
// Every puzzle stays mounted (hidden when inactive) so switching puzzles keeps their in-progress state.
import { useState, type ComponentType } from 'react';
import { Puzzle as PuzzleIcon } from 'lucide-react';
import type { Puzzle } from '../types';
import type { Stars } from '../logic';
import { puzzleKey, useChallengeSet } from '../registry';
import { recordChallenge, useProgress } from '../../lib/progress';
import { celebrate } from '../../lib/celebrate';
import { StarRow } from './kit';
import { MODE_INFO, modeKeys, type GameProps } from './run';
import FlowGame from './FlowGame';
import SequenceGame from './SequenceGame';
import FaultGame from './FaultGame';
import MatchGame from './MatchGame';
import TuneGame from './TuneGame';
import RouteGame from './RouteGame';
import SpikeGame from './SpikeGame';
import './challenge.css';

const GAMES = {
  flow: FlowGame,
  sequence: SequenceGame,
  fault: FaultGame,
  match: MatchGame,
  tune: TuneGame,
  route: RouteGame,
  spike: SpikeGame,
} as unknown as Record<Puzzle['mode'], ComponentType<GameProps<Puzzle>>>;

export default function ChallengeTab({ topicId, topicTitle }: { topicId: string; topicTitle: string }) {
  const set = useChallengeSet(topicId);
  const p = useProgress();
  const [picked, setPicked] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, number>>({});
  if (!set) return <div className="tp-panel tp-card cg-loading">Loading the challenge…</div>;
  const puzzles = set.puzzles;
  const rec = (id: string) => p.challenges?.[puzzleKey(topicId, id)];
  const firstOpen = puzzles.find((x) => !rec(x.id)) ?? puzzles[0];
  const activeId = picked && puzzles.some((x) => x.id === picked) ? picked : firstOpen.id;
  const doneCount = puzzles.filter((x) => rec(x.id)).length;

  const select = (id: string) => {
    setPicked(id);
    requestAnimationFrame(() => document.getElementById('cg-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <section className="tp-panel tp-card cg-root" aria-labelledby="cg-h" aria-describedby="cg-sub" id="cg-top">
      <div className="tp-card-top">
        <span className="eyebrow tp-eb-amber">
          <PuzzleIcon size={14} aria-hidden /> End-of-topic challenge
        </span>
        <span className="nb-chip">
          {doneCount}/{puzzles.length} solved
        </span>
      </div>
      <h2 id="cg-h" className="tp-card-title">
        Put this topic to work
      </h2>
      <p id="cg-sub" className="sr-only">Challenge for {topicTitle}</p>
      {puzzles.length > 1 && (
        <div className="cg-picker" role="tablist" aria-label="Challenges">
          {puzzles.map((x, i) => {
            const r = rec(x.id);
            const Icon = MODE_INFO[x.mode].icon;
            return (
              <button
                key={x.id}
                type="button"
                role="tab"
                id={`cg-tab-${x.id}`}
                aria-selected={x.id === activeId}
                aria-controls={`cg-panel-${x.id}`}
                className={`cg-pick ${r ? 'done' : ''}`}
                onClick={() => select(x.id)}
              >
                <span className="cg-pick-dot" aria-hidden />
                <Icon size={14} aria-hidden />
                <span>
                  {i + 1}. {x.tab ?? x.title}
                </span>
                {r && <StarRow stars={r.stars} label={false} />}
                <span className="sr-only">{r ? `, solved, best ${r.stars} of 3 stars` : ', not solved yet'}</span>
              </button>
            );
          })}
        </div>
      )}
      {puzzles.map((x, i) => {
        const Game = GAMES[x.mode];
        const nextPuzzle = puzzles[i + 1];
        const onComplete = (stars: Stars) => {
          const prev = rec(x.id);
          recordChallenge(puzzleKey(topicId, x.id), stars);
          celebrate(
            prev && prev.stars >= stars ? 'Challenge solved again' : `Challenge solved: ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`,
            x.title,
          );
        };
        return (
          <div
            key={x.id}
            id={`cg-panel-${x.id}`}
            role={puzzles.length > 1 ? 'tabpanel' : undefined}
            aria-labelledby={puzzles.length > 1 ? `cg-tab-${x.id}` : undefined}
            hidden={x.id !== activeId}
          >
            <Game
              key={runs[x.id] ?? 0}
              puzzle={x}
              best={rec(x.id)?.stars}
              onComplete={onComplete}
              onReset={() => setRuns((r) => ({ ...r, [x.id]: (r[x.id] ?? 0) + 1 }))}
              next={nextPuzzle ? { label: 'Next challenge', go: () => select(nextPuzzle.id) } : undefined}
            />
          </div>
        );
      })}
      <p className="cg-keys muted small">{modeKeys(puzzles.find((x) => x.id === activeId)?.mode ?? 'flow')}</p>
    </section>
  );
}
