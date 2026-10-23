// Non-component helpers shared by the puzzle modes (kept apart from kit.tsx for fast refresh).
import { useCallback, useState } from 'react';
import { Cable, Flame, ListOrdered, Route, SearchCheck, SlidersHorizontal, Workflow } from 'lucide-react';
import type { Puzzle, PuzzleMode } from '../types';
import { starsFor, type Stars } from '../logic';

export type Tone = '' | 'good' | 'bad';
export interface Message {
  title: string;
  body: string;
  tone?: Tone;
}

export interface GameProps<P extends Puzzle> {
  puzzle: P;
  /** best stored stars for this puzzle (from progress) */
  best?: Stars;
  onComplete: (stars: Stars) => void;
  onReset: () => void;
  next?: { label: string; go: () => void };
}

const DRAG_KEYS = 'Keyboard: Tab to a card and press Enter to pick it up, Tab to a slot and press Enter to drop it; Esc puts it back.';

export const MODE_INFO: Record<PuzzleMode, { name: string; icon: typeof Workflow; how: string; keys?: string }> = {
  flow: {
    name: 'Fix the flow',
    icon: Workflow,
    how: 'Red dashed wires are broken. Each red slot shows a clue for the component it needs. Drag a card into a slot (or tap a card, then tap a slot). Some cards are decoys that belong nowhere.',
  },
  sequence: {
    name: 'Sequence it',
    icon: ListOrdered,
    how: 'Put the steps in the order they really happen. Drag a step card into a numbered position (or tap a card, then a position). Packets flow up to the first gap. Some steps never happen at all.',
  },
  fault: {
    name: 'Fault hunt',
    icon: SearchCheck,
    how: 'The alarms are red. Something in this design is misconfigured. Click the component you suspect; once you expose a fault, swap in the right replacement card from the tray.',
  },
  match: {
    name: 'Patch cables',
    icon: Cable,
    how: 'Connect every item on the left to the one on the right that it belongs with. Drag from a left socket to a right socket (or tap left, then right). Some right-hand items are decoys.',
  },
  tune: {
    name: 'Tune it',
    icon: SlidersHorizontal,
    how: 'Turn the knobs until every gauge is green. Each gauge is a real constraint; select a gauge to read what it protects.',
    keys: 'Keyboard: Tab between knobs; arrow keys move a slider, Enter or Space presses a button.',
  },
  route: {
    name: 'Route it',
    icon: Route,
    how: 'Steer each packet hop by hop. At every junction, tap the next hop on the board (or a button under it). A right hop glides on and leaves a green trail; a wrong one bounces back and tells you why.',
    keys: 'Keyboard: press 1–4 to pick a next hop, or Tab to the hop buttons under the board and press Enter.',
  },
  spike: {
    name: 'Survive the spike',
    icon: Flame,
    how: 'Traffic is about to spike. Install capacity cards (tap one, or drag it onto the diagram), then run the spike and watch the hot spots. Every goal must hold for the whole run; each failed run is a miss. Some cards make things worse.',
    keys: 'Keyboard: Tab to a card and press Enter to install or remove it, then Tab to "Run the spike".',
  },
};

/** the keyboard help line under the challenge for a mode */
export const modeKeys = (m: PuzzleMode) => MODE_INFO[m].keys ?? DRAG_KEYS;

/** misses / hints / done + the feedback message, shared by every mode */
export function useRun(intro: Message) {
  const [misses, setMisses] = useState(0);
  const [hints, setHints] = useState(0);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<Message>(intro);
  const say = useCallback((title: string, body: string, tone: Tone = '') => setMsg({ title, body, tone }), []);
  return {
    misses,
    hints,
    done,
    msg,
    say,
    miss: () => setMisses((m) => m + 1),
    hint: () => setHints((h) => h + 1),
    /** finish: returns the stars earned (state updates are async, so pass the final counts in) */
    finish: (finalMisses = misses, finalHints = hints) => {
      setDone(true);
      return starsFor(finalMisses, finalHints);
    },
  };
}

/** upper-case the first letter */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
