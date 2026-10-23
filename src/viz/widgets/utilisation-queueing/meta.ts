import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'utilisation-queueing',
  title: 'Utilisation vs latency: why queues explode near 100%',
  blurb: 'Load a server pool from 30% to 95% busy. Throughput creeps up while p99 latency takes off, Little’s law (L = λ × W) holds at every step, and pooling more servers behind one queue changes the curve.',
  placements: [{ topic: 'fund-scalability', heading: 'Latency vs throughput and Little' }],
};
