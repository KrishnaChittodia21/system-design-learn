// Pure model of HDFS-style block placement and failure recovery (no React, Node-testable).
//   Placement (RF = 3): rack-aware = 1st replica on the writer's node, 2nd on a node in a different
//   rack, 3rd on another node of that same remote rack; random = any 3 distinct nodes.
//   Failure detection: DataNodes heartbeat every 3 s; the NameNode declares a node dead after
//   ~10.5 min of silence, then queues every under-replicated block, lowest live-replica count first,
//   and schedules at most THROTTLE clone copies per round so recovery does not starve clients.
//   Targets prefer restoring rack diversity, then the least-loaded live node.
import { rng, type BaseFrame } from '../../core';

export type Placement = 'rack' | 'random';
export type Failure = 'node' | 'rack';

export interface Params {
  placement: Placement;
  failure: Failure;
}

export const DEFAULT_PARAMS: Params = { placement: 'rack', failure: 'node' };

export const RF = 3;
export const THROTTLE = 2;
export const NODES = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const;
export const RACK: Record<string, 'R1' | 'R2'> = { D1: 'R1', D2: 'R1', D3: 'R1', D4: 'R2', D5: 'R2', D6: 'R2' };
export const BLOCKS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];

export interface NodeView {
  id: string;
  rack: 'R1' | 'R2';
  /** process up (sending heartbeats) */
  up: boolean;
  /** the NameNode has declared it dead */
  dead: boolean;
  blocks: string[];
}

export interface BlockView {
  id: string;
  /** replicas on nodes the NameNode still counts as live */
  live: string[];
  /** replicas on dead nodes (gone) */
  gone: string[];
}

export interface Frame extends BaseFrame {
  phase: 'write' | 'healthy' | 'silent' | 'dead' | 'repair' | 'summary' | 'intro';
  clock: string;
  nodes: NodeView[];
  blocks: BlockView[];
  queue: { id: string; live: number }[];
  copies: { block: string; from: string; to: string }[];
}

/** deterministic placement for one block */
export function place(placement: Placement, writer: string, rand: () => number): string[] {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  if (placement === 'rack') {
    const other = NODES.filter((n) => RACK[n] !== RACK[writer]);
    const second = pick(other);
    const third = pick(other.filter((n) => n !== second));
    return [writer, second, third];
  }
  const pool: string[] = [...NODES];
  const out: string[] = [];
  while (out.length < RF) {
    const n = pick(pool);
    out.push(n);
    pool.splice(pool.indexOf(n), 1);
  }
  return out;
}

export function placeAll(placement: Placement): Record<string, string[]> {
  // for random placement pick the first seed where some block sits entirely in rack R1, so a rack
  // failure shows the risk that rack-aware placement removes
  for (let seed = 7; seed < 500; seed++) {
    const rand = rng(seed);
    const map: Record<string, string[]> = {};
    BLOCKS.forEach((b, i) => (map[b] = place(placement, NODES[i % NODES.length], rand)));
    if (placement === 'rack') return map;
    const allR1 = BLOCKS.filter((b) => map[b].every((n) => RACK[n] === 'R1')).length;
    const allR2 = BLOCKS.filter((b) => map[b].every((n) => RACK[n] === 'R2')).length;
    if (allR1 === 1 && allR2 === 0) return map;
  }
  throw new Error('no seed');
}

export function simulate({ placement, failure }: Params): Frame[] {
  const map = placeAll(placement);
  const nodes = new Map<string, NodeView>(NODES.map((n) => [n, { id: n, rack: RACK[n], up: true, dead: false, blocks: [] }]));
  for (const b of BLOCKS) for (const n of map[b]) nodes.get(n)!.blocks.push(b);
  const frames: Frame[] = [];
  const failed: string[] = failure === 'node' ? ['D2'] : ['D1', 'D2', 'D3'];
  let queue: { id: string; live: number }[] = [];

  const blockViews = (): BlockView[] =>
    BLOCKS.map((b) => {
      const holders = [...nodes.values()].filter((n) => n.blocks.includes(b));
      return { id: b, live: holders.filter((n) => !n.dead).map((n) => n.id), gone: holders.filter((n) => n.dead).map((n) => n.id) };
    });

  const snap = (phase: Frame['phase'], clock: string, caption: string, copies: Frame['copies'] = [], predict?: string) =>
    frames.push({
      caption,
      predict,
      phase,
      clock,
      nodes: [...nodes.values()].map((n) => ({ ...n, blocks: [...n.blocks] })),
      blocks: blockViews(),
      queue: queue.map((q) => ({ ...q })),
      copies,
    });

  snap(
    'intro',
    't = 0',
    `A NameNode holds the metadata (file → blocks → DataNodes); six DataNodes in two racks hold the bytes. RF = ${RF} and placement is ${placement === 'rack' ? 'rack-aware' : 'random'}.`,
  );

  const sameRack = BLOCKS.filter((b) => new Set(map[b].map((n) => RACK[n])).size === 1);
  snap(
    'write',
    't = 0',
    placement === 'rack'
      ? `The client writes /logs/day1 as 6 blocks through a replica pipeline. Each block gets one replica on the writer's node and two on a single remote rack, so every block spans both racks and the write crosses the rack boundary once.`
      : `The client writes /logs/day1 as 6 blocks, each to 3 random DataNodes. ${sameRack.length ? `${sameRack.join(', ')} ended up with all three replicas in one rack.` : ''}`,
  );

  snap('healthy', 't = 3 s', 'Every DataNode heartbeats every 3 s and sends periodic block reports, so the NameNode knows exactly where each replica lives.');

  for (const n of failed) nodes.get(n)!.up = false;
  snap(
    'silent',
    't = 6 s',
    failure === 'node'
      ? 'D2 loses its disk controller and stops heartbeating. The NameNode does not react yet: a missed heartbeat might just be a GC pause or a network blip.'
      : 'The top-of-rack switch for R1 fails. D1, D2 and D3 all go silent at once. The NameNode waits: missed heartbeats are not yet proof of death.',
    [],
    'After the dead-node timeout, which blocks should be copied first?',
  );

  for (const n of failed) nodes.get(n)!.dead = true;
  const bv = blockViews();
  queue = bv
    .filter((b) => b.live.length < RF && b.live.length > 0)
    .map((b) => ({ id: b.id, live: b.live.length }))
    .sort((a, b) => a.live - b.live || a.id.localeCompare(b.id));
  const missing = bv.filter((b) => b.live.length === 0).map((b) => b.id);
  snap(
    'dead',
    't ≈ 10.5 min',
    `No heartbeat for ~10.5 min: the NameNode declares ${failed.join(', ')} dead. ${queue.length} block${queue.length === 1 ? ' is' : 's are'} under-replicated and queued with the fewest live replicas first${
      missing.length ? `. ${missing.join(', ')} has NO live replica left: those bytes are gone` : ''
    }.`,
  );

  // re-replication rounds
  let round = 0;
  while (queue.length) {
    round++;
    const copies: Frame['copies'] = [];
    const batch = queue.slice(0, THROTTLE);
    for (const q of batch) {
      const b = blockViews().find((x) => x.id === q.id)!;
      const liveRacks = new Set(b.live.map((n) => RACK[n]));
      const candidates = [...nodes.values()].filter((n) => !n.dead && !n.blocks.includes(q.id));
      if (!candidates.length) continue;
      candidates.sort((x, y) => {
        const dx = liveRacks.has(x.rack) ? 1 : 0;
        const dy = liveRacks.has(y.rack) ? 1 : 0;
        return dx - dy || x.blocks.length - y.blocks.length || x.id.localeCompare(y.id);
      });
      const target = candidates[0];
      const from = b.live[0];
      target.blocks.push(q.id);
      copies.push({ block: q.id, from, to: target.id });
    }
    queue = blockViews()
      .filter((b) => b.live.length > 0 && b.live.length < RF && [...nodes.values()].some((n) => !n.dead && !n.blocks.includes(b.id)))
      .map((b) => ({ id: b.id, live: b.live.length }))
      .sort((a, b) => a.live - b.live || a.id.localeCompare(b.id));
    snap(
      'repair',
      `round ${round}`,
      `Re-replication round ${round}, throttled to ${THROTTLE} copies: ${copies.map((c) => `${c.block} ${c.from} → ${c.to}${RACK[c.from] !== RACK[c.to] ? ' (cross-rack)' : ''}`).join(', ')}. ${
        queue.length ? `${queue.length} still queued.` : 'Queue empty.'
      }`,
      copies,
    );
  }

  const end = blockViews();
  const lost = end.filter((b) => b.live.length === 0).map((b) => b.id);
  const oneRack = end.filter((b) => b.live.length > 0 && new Set(b.live.map((n) => RACK[n])).size === 1).length;
  snap(
    'summary',
    'recovered',
    lost.length
      ? `Result: ${lost.join(', ')} is permanently lost because all of its replicas sat in the failed rack. Rack-aware placement makes a whole-rack failure survivable for every block.`
      : failure === 'rack'
        ? `Result: no block lost. Every block had a replica in R2, so R2 re-cloned them back to ${RF} copies${oneRack ? `, though with R1 down they all sit in one rack until it returns` : ''}.`
        : `Result: every block is back to ${RF} replicas. Re-replication went to the block with the fewest live copies first and was throttled so client reads and writes keep their bandwidth.`,
  );
  return frames;
}
