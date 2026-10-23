import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'pg-wal-crash-recovery',
  title: 'Life of a write, a power cut, and WAL replay',
  blurb: 'Step through UPDATEs, COMMITs, a checkpoint and a background-writer eviction, then pull the plug at any step. Recovery replays the fsynced WAL from the redo point; flip synchronous_commit off to lose acknowledged commits.',
  placements: [
    { topic: 'db-postgres-internals', heading: 'The life of a write' },
    { topic: 'db-postgres-internals', heading: 'Checkpoints and crash recovery' },
  ],
};
