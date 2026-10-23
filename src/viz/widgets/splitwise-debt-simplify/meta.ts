import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'splitwise-debt-simplify',
  title: 'Splitwise: simplify debts, greedy vs exact minimum',
  blurb:
    'Turn a ledger into net balances, then settle them transfer by transfer: pay back every expense, the greedy largest-debtor-to-largest-creditor rule, or the exact minimum from disjoint zero-sum groups. The topic’s 5-person counterexample needs 4 greedy transfers but only 3.',
  placements: [{ topic: 'lld-cases-1', heading: 'Splitwise (3/3)' }],
};
