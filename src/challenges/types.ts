// End-of-topic challenge data format. One file per topic: src/challenges/topics/<topic-id>.ts
// (default export: ChallengeSet). Authoring guide with full examples: src/challenges/README.md.
// Type-only module: topic files must use `import type` so plain node can load them for validation.

/** A whole topic's challenges: 5 puzzles, at least 4 different modes, including `route` or `spike` where it fits. */
export interface ChallengeSet {
  /** must equal the topic id (and the file name) */
  topic: string;
  puzzles: Puzzle[];
}

export type Puzzle = FlowPuzzle | SequencePuzzle | FaultPuzzle | MatchPuzzle | TunePuzzle | RoutePuzzle | SpikePuzzle;
export type PuzzleMode = Puzzle['mode'];

interface PuzzleBase {
  /** unique within the topic, kebab-case; progress is stored under `<topic>/<id>` (never rename after shipping) */
  id: string;
  /** short label for the puzzle picker, ≤ 24 characters (defaults to the title) */
  tab?: string;
  /** heading shown above the board, ≤ 60 characters */
  title: string;
  /** the scenario in 1–2 sentences: what must work, under what pressure */
  brief: string;
  /** "Why this design works": 2–5 short, accurate takeaways shown on completion */
  why: string[];
}

/* ------------------------------------------------------------------ shared board pieces */

/** box = component, decision = ◆ question (flowcharts), terminal = pill (user / start / end) */
export type NodeKind = 'box' | 'decision' | 'terminal';

/**
 * A node on the board grid. `col`/`row` are grid coordinates (fractions allowed, e.g. 2.6);
 * the node's CENTRE sits in the middle of that cell. On narrow screens the grid is transposed
 * (col ↔ row), so flows that run left → right run top → bottom instead.
 * The WHOLE node must fit inside the board on both layouts (validated with estimated node heights:
 * ~58–100px on desktop, up to ~140px on a 360px phone where labels wrap to 3 lines in 84px boxes).
 */
export interface BoardNode {
  id: string;
  /** ≤ 28 characters (fits a 128–150px box in two lines) */
  label?: string;
  /** small mono caption, ≤ 26 characters */
  sub?: string;
  kind?: NodeKind;
  col: number;
  row: number;
}

/** [from node id, to node id, optional wire label ≤ 14 characters] — drawn as an arrow from → to */
export type Edge = [from: string, to: string, label?: string];

/**
 * Tune boards only: an edge may carry a 4th element, a `showIf` rule (like TuneNode.showIf); the wire is drawn
 * only while it holds. Use `''` (or undefined) as the label when the wire has none: `['app', 'cache', '', rule]`.
 */
export type TuneEdge = [from: string, to: string, label?: string, showIf?: Rule];

/** A card in the tray. */
export interface Option {
  id: string;
  /** ≤ 28 characters */
  label: string;
  /** ≤ 26 characters */
  sub?: string;
  /**
   * what this card actually IS, as a noun phrase that completes "<label> is …"
   * (e.g. "an in-memory key–value cache with sub-millisecond reads"). Shown on every drop, right or wrong.
   */
  is: string;
  /** plausible but belongs nowhere; its `is` must say why it is wrong here */
  decoy?: boolean;
}

/* ------------------------------------------------------------------ 1. flow: "Fix the flow" */

export interface FlowNode extends BoardNode {
  /** makes this node a red slot: the option id that belongs here */
  answer?: string;
  /** slot clue (required for slots), ≤ 40 characters, e.g. "Answers repeat clicks near the user" */
  hint?: string;
}

export interface FlowPuzzle extends PuzzleBase {
  mode: 'flow';
  /** grid size; every node's col must be < cols and row < rows */
  cols: number;
  rows: number;
  nodes: FlowNode[];
  edges: Edge[];
  /** one option per slot answer, plus 1–3 decoys */
  options: Option[];
}

/* ------------------------------------------------------------------ 2. sequence: "Sequence it" */

export interface SequenceActor {
  id: string;
  label: string;
  sub?: string;
}

export interface SequenceStep {
  id: string;
  /** ≤ 34 characters (ladder arrows are wide), ≤ 28 for stages */
  label: string;
  sub?: string;
  /** what this step is / does, completes "<label> is …" */
  is: string;
  /** clue printed in this step's empty position (optional, ≤ 40 characters); not used on decoys */
  clue?: string;
  /** ladder layout only: the sending and receiving actor ids */
  from?: string;
  to?: string;
}

export interface SequencePuzzle extends PuzzleBase {
  mode: 'sequence';
  /**
   * ladder = message sequence between exactly two actors (client ↔ server), one arrow per step;
   * stages = numbered pipeline stages, laid out left → right (snaking onto a second row after 5).
   */
  layout: 'ladder' | 'stages';
  /** ladder only: exactly two actors, drawn as lifelines (first on the left) */
  actors?: [SequenceActor, SequenceActor];
  /** the steps IN THE CORRECT ORDER (3–8). The tray shuffles them. */
  steps: SequenceStep[];
  /** steps that never happen in this flow (1–3); `is` must say why */
  decoys: SequenceStep[];
}

/* ------------------------------------------------------------------ 3. fault: "Fault hunt" */

export interface FaultNode extends BoardNode {
  /** required for fault puzzles */
  label: string;
  /** why this node is FINE (shown when the learner wrongly suspects it). Required on every non-fault, non-terminal node. */
  fine?: string;
  /** marks this node as misconfigured: its label shows the WRONG design, the learner must find and replace it */
  fault?: {
    /** option id of the correct replacement */
    answer: string;
    /** shown when the fault is found: what is wrong with the current design and what it causes */
    why: string;
    /** clue printed in the exposed slot, ≤ 40 characters, e.g. "Spread the expiry times" */
    clue: string;
  };
}

/** A live alarm tile. Value = bad → good, interpolated by how many of its faults are fixed. */
export interface FaultMetric {
  /** ≤ 22 characters, e.g. "DB p99" */
  label: string;
  bad: number;
  good: number;
  /** appended to the value, e.g. "ms", "%", "/s", " QPS" (a leading space is kept) */
  unit?: string;
  /** decimals shown (default 0) */
  decimals?: number;
  /** fault node ids that drive this metric (default: every fault) */
  fixedBy?: string[];
}

export interface FaultPuzzle extends PuzzleBase {
  mode: 'fault';
  cols: number;
  rows: number;
  /** 1–3 nodes carry `fault`; every other non-terminal node carries `fine` */
  nodes: FaultNode[];
  edges: Edge[];
  /** the correct replacements, plus 1–3 decoys */
  options: Option[];
  /** 2–4 alarm tiles */
  metrics: FaultMetric[];
}

/* ------------------------------------------------------------------ 4. match: "Patch cables" */

export interface MatchLeft {
  id: string;
  /** ≤ 60 characters (symptom / problem / guarantee) */
  label: string;
  sub?: string;
  /** id of the right item it connects to (several lefts may share one right) */
  answer: string;
  /** shown when connected correctly: why this pair belongs together */
  because: string;
}

export interface MatchRight {
  id: string;
  /** ≤ 40 characters (fix / pattern / mechanism) */
  label: string;
  sub?: string;
  /** what it is, completes "<label> is …" (shown on wrong cables) */
  is: string;
  /** not the answer for any left item */
  decoy?: boolean;
}

export interface MatchPuzzle extends PuzzleBase {
  mode: 'match';
  /** column headings, e.g. "Symptom" / "Pattern" */
  leftTitle: string;
  rightTitle: string;
  /**
   * heading above the instructions (optional, ≤ 60 characters), e.g. "Patch each symptom to the fix".
   * Default: "Connect each <leftTitle> to its <rightTitle>" (lower-cased).
   */
  instruction?: string;
  /** 3–6 items */
  left: MatchLeft[];
  /** the answers plus 1–3 decoys */
  right: MatchRight[];
}

/* ------------------------------------------------------------------ 5. tune: "Tune it" */

/**
 * A safe numeric expression (no eval): a constant, a knob value, arithmetic, a list lookup,
 * a condition, or a pure function registered in src/challenges/logic.ts (FUNCTIONS).
 * Toggle knobs are 0 / 1.
 */
export type Expr =
  | number
  | { knob: string }
  | { op: 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max'; args: Expr[] }
  /** 1-based lookup: list[index − 1]; out of range → Infinity (e.g. "latency of the W-th fastest replica") */
  | { op: 'pick'; list: number[]; index: Expr }
  | { op: 'if'; cond: Rule; then: Expr; else: Expr }
  | { op: 'fn'; fn: string; args: Expr[] };

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

export type Rule = { left: Expr; op: CompareOp; right: Expr } | { all: Rule[] } | { any: Rule[] } | { not: Rule };

export interface Knob {
  id: string;
  /** ≤ 24 characters */
  label: string;
  /** slider / stepper: numeric range · toggle: 0 = off, 1 = on · choice: segmented buttons with numeric values */
  kind: 'slider' | 'stepper' | 'toggle' | 'choice';
  min?: number;
  max?: number;
  /** default 1 */
  step?: number;
  /** starting value: must leave at least one constraint failing */
  initial: number;
  unit?: string;
  /**
   * digits shown for this knob's value (its readout and `{id}` placeholders). Default: as many as `min` / `step`
   * have, so `step: 0.5` shows "2.5" (choice knobs: as many as their values have).
   */
  decimals?: number;
  /** choice only: 2–5 buttons */
  choices?: { value: number; label: string }[];
  /** one line under the control */
  help?: string;
}

/**
 * How a gauge's value line reads.
 * - 'number' (default): "left op right", e.g. "18 ms ≤ 20 ms" (with `unit` / `decimals`).
 * - 'yesno': for 0/1 gauges (a toggle, or an `if` that yields 1 / 0): the left side as "yes" / "no" plus what
 *   passing needs, e.g. "yes · needs no". Use it instead of the raw "1 = 0".
 * - { pass, fail }: your own text for each state, e.g. { pass: 'no gap', fail: 'train/serve gap' }.
 */
export type GaugeDisplay = 'number' | 'yesno' | { pass: string; fail: string };

/** A gauge: passes when `left op right`. The gauge shows the left value against the right value. */
export interface TuneConstraint {
  id: string;
  /** ≤ 32 characters, e.g. "Reads see the latest write" */
  label: string;
  left: Expr;
  op: CompareOp;
  right: Expr;
  /** unit of the two sides, e.g. "ms", "$", " acks" */
  unit?: string;
  /** digits shown for both sides (default 0) */
  decimals?: number;
  /** how the value line reads (default 'number'); use 'yesno' or { pass, fail } for 0/1 gauges */
  display?: GaugeDisplay;
  /**
   * the gauge only applies while this rule holds (e.g. "poll load" only when the transport is polling).
   * Otherwise it shows "n/a", counts as passing and is skipped by hints. Must not hold for no setting at all.
   */
  applies?: Rule;
  /** hint button text for this gauge: a nudge, not the answer */
  hint: string;
  /** shown while failing: what goes wrong in production */
  fail: string;
  /** shown once passing: why it now holds */
  pass: string;
}

export interface TuneNode extends BoardNode {
  /**
   * placeholders in label / sub are replaced live:
   * `{id}` → the knob's value (its `decimals`), `{id:2}` → with 2 decimals,
   * `{id.label}` → a choice knob's button text ("1 h") or a toggle's "on" / "off".
   * The validator measures labels with the widest value.
   */
  label: string;
  /** hide the node (and its wires) unless this rule holds, e.g. replica 4 only when N ≥ 4 */
  showIf?: Rule;
}

export interface TunePuzzle extends PuzzleBase {
  mode: 'tune';
  cols: number;
  rows: number;
  nodes: TuneNode[];
  /** edge labels may use the same placeholders; a 4th element `showIf` hides the wire unless it holds */
  edges: TuneEdge[];
  /** 1–5 knobs */
  knobs: Knob[];
  /** 2–6 gauges; some knob setting must satisfy all of them (the validator searches the grid) */
  constraints: TuneConstraint[];
}

/* ------------------------------------------------------------------ 6. route: "Route it" */

/** an edge key, `'<from>><to>'`, e.g. `'router>replica-a'` (the wire must exist in `edges`) */
export type EdgeKey = string;

export interface RouteNode extends BoardNode {
  /** required for route puzzles */
  label: string;
}

/**
 * One packet the learner steers hop by hop from `from` along one of its acceptable `paths`. At every node with 2–4
 * outgoing wires the learner picks the next hop; a node with a single outgoing wire is crossed automatically. The
 * packet arrives when it has followed a whole acceptable path.
 */
export interface RoutePacket {
  id: string;
  /** caption, ≤ 44 characters, e.g. "Top-up: UPDATE wallet … RETURNING" */
  label: string;
  /** small mono line under the caption, ≤ 44 characters, e.g. "carries token LSN 3/A1B2" */
  sub?: string;
  from: string;
  /**
   * optional destination, shown on the board as the goal flag. Leave it out when choosing the destination IS the
   * puzzle (e.g. which replica serves a read); when set, every path must end there.
   */
  to?: string;
  /**
   * the acceptable routes as node sequences (from … end), most-preferred first. Several are fine when more than
   * one route is genuinely right (none may be a prefix of another); every hop that leaves all of them is wrong.
   */
  paths: string[][];
  /**
   * why a hop is wrong FOR THIS PACKET, keyed by edge `'a>b'`, as a full sentence
   * ("A read replica is read-only: it replays the primary's WAL and rejects writes.").
   * Required for every outgoing wire, at every junction an acceptable route passes, that leaves all acceptable routes.
   */
  wrong: Record<EdgeKey, string>;
  /** optional note shown when a correct hop is taken, keyed by edge (full sentence) */
  right?: Record<EdgeKey, string>;
  /** shown when the packet arrives: why this route is right (full sentence) */
  done: string;
}

/** optional HUD: a number accumulated along each packet's route (latency, cost, primary load …) */
export interface RouteMeter {
  /** ≤ 22 characters, e.g. "Latency" */
  label: string;
  /** appended verbatim, e.g. " ms" */
  unit?: string;
  decimals?: number;
  /** what crossing a wire adds, keyed by edge `'a>b'` (missing = 0) */
  costs: Record<EdgeKey, number>;
  /** per-packet budget (an SLO); every acceptable route must stay within it */
  budget?: number;
}

export interface RoutePuzzle extends PuzzleBase {
  mode: 'route';
  cols: number;
  rows: number;
  nodes: RouteNode[];
  /** directed wires; a packet can only travel from → to */
  edges: Edge[];
  /** 1–4 packets, played in order */
  packets: RoutePacket[];
  meter?: RouteMeter;
}

/* ------------------------------------------------------------------ 7. spike: "Survive the spike" */

/**
 * A node of the spike simulation. Each tick the engine computes its load (per second):
 *   load = (admitted rps × share + bursts) × Π card `load` factors + base
 * and its utilisation u = load / capacity (× card `capacity` factors).
 */
export interface SpikeNode extends BoardNode {
  label: string;
  /** what it can take per second (same unit as its load); omit for "never the bottleneck" */
  capacity?: number;
  /** unit name for the capacity readout, e.g. "ops/s" (≤ 10 characters) */
  unit?: string;
  /** load per admitted request (1 = every request touches it once; 0 / omitted = only bursts and base) */
  share?: number;
  /** background load from the rest of the system, untouched by cards (per second) */
  base?: number;
  /** service time at low load in ms (omit = adds no latency) */
  ms?: number;
  /** latency once saturated (u ≥ 1), e.g. a client timeout; default 20 × ms */
  timeoutMs?: number;
}

/**
 * What an installed card does (all declarative, applied in the engine):
 * - `{ node, load: 0.01 }` multiplies the request-driven load on a node (cache hits, coalescing; > 1 amplifies, e.g. retries)
 * - `{ node, capacity: 3 }` multiplies the node's capacity (replicas, bigger box; < 1 for contention)
 * - `{ node, ms: 5 }` adds service time to the node
 * - `{ shed: 0.2 }` rejects that share of incoming traffic at the edge (counted as `shed`, not as errors)
 */
export type SpikeEffect = { node: string; load?: number; capacity?: number; ms?: number } | { shed: number };

export interface SpikeCard {
  id: string;
  /** ≤ 28 characters */
  label: string;
  /** ≤ 26 characters */
  sub?: string;
  /** completes "<label> is …"; for a decoy say why it doesn't help (or hurts) here */
  is: string;
  /** node it attaches to (shown on that node while installed) */
  node: string;
  effects: SpikeEffect[];
  /** monthly cost or any unit the `cost` goal uses (default 0) */
  cost?: number;
  decoy?: boolean;
}

/** a timed extra load on one node, e.g. a hot key expiring: `{ node: 'db', from: 6, to: 8, add: 4000 }` (seconds) */
export interface SpikeBurst {
  node: string;
  from: number;
  to: number;
  /** extra request-driven load per second while active (card `load` factors apply to it) */
  add: number;
  /** chart annotation, ≤ 18 characters, e.g. "key expires" */
  label?: string;
}

/** `p99` (ms) · `errors` (% of offered requests that fail) · `shed` (% rejected at the edge) · `cost` · `util:<node id>` (%) */
export type SpikeMetric = 'p99' | 'errors' | 'shed' | 'cost' | `util:${string}`;

/** must hold at every tick of the run: metric ≤ max */
export interface SpikeGoal {
  metric: SpikeMetric;
  max: number;
  /** ≤ 24 characters, e.g. "p99 ≤ 100 ms" */
  label: string;
  /** shown when it breaks: what users feel (full sentence) */
  fail: string;
}

export interface SpikePuzzle extends PuzzleBase {
  mode: 'spike';
  cols: number;
  rows: number;
  nodes: SpikeNode[];
  edges: Edge[];
  /** simulated seconds (the run animates them in ~8 s) and the tick size; 10–60 ticks */
  duration: number;
  step: number;
  /** offered requests per second as [second, rps] points, linearly interpolated (first at 0, last at duration) */
  traffic: [number, number][];
  bursts?: SpikeBurst[];
  /** 3–8 cards, 1–3 of them decoys */
  cards: SpikeCard[];
  /** 1–4 goals, all must hold for the whole run */
  goals: SpikeGoal[];
  /** at most this many cards may be installed at once (optional) */
  maxCards?: number;
}
