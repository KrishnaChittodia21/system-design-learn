// Brokerage order lifecycle: idempotency key → validation → conditional buying-power reservation
// + order + outbox in one transaction → Kafka → smart order router → FIX NewOrderSingle →
// ExecutionReports applied idempotently by (venue, ExecID), booked as the growth in CumQty.
import type { FlowEdge, FlowFrame, Tone } from './types';

export type BrokerScenario = 'normal' | 'dup' | 'crash';

export interface BrokerParams {
  qty: number;
  scenario: BrokerScenario;
}

export const LIMIT = 200; // $ limit price
export const CASH = 2_500; // settled + unsettled cash
export const FILL1 = 4;
export const FILL1_PX = 199.98;
export const FILL2_PX = 199.95;

export type OrderState = 'none' | 'accepted' | 'routed' | 'new' | 'partially_filled' | 'filled' | 'rejected';
export const STATES: OrderState[] = ['accepted', 'routed', 'new', 'partially_filled', 'filled'];

export interface ExecRow {
  execId: string;
  type: string;
  cumQty: number;
  booked: number;
  applied: boolean;
}

export interface BrokerFrame extends FlowFrame {
  state: OrderState;
  reserved: number;
  spent: number;
  position: number;
  execs: ExecRow[];
  ordersAtVenue: number;
}

/** The conditional UPDATE: reserve only if cash − reserved ≥ cost. Returns rows updated. */
export function reserve(cash: number, reserved: number, cost: number): number {
  return cash - reserved >= cost ? 1 : 0;
}

/** Apply one ExecutionReport idempotently. Book the growth in CumQty, never LastQty. */
export function applyExec(seen: Set<string>, venue: string, execId: string, cumQty: number, prevCum: number): { applied: boolean; booked: number } {
  const key = `${venue}:${execId}`;
  if (seen.has(key)) return { applied: false, booked: 0 };
  seen.add(key);
  return { applied: true, booked: Math.max(0, cumQty - prevCum) };
}

export function simulateBroker({ qty, scenario }: BrokerParams): BrokerFrame[] {
  const frames: BrokerFrame[] = [];
  let state: OrderState = 'none';
  let reserved = 0;
  let spent = 0;
  let position = 0;
  let ordersAtVenue = 0;
  const execs: ExecRow[] = [];
  const seen = new Set<string>();
  let cum = 0;
  const cost = qty * LIMIT;
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, state, reserved, spent: +spent.toFixed(2), position, execs: execs.map((e) => ({ ...e })), ordersAtVenue });

  snap({}, [], `A user with $${CASH.toLocaleString('en-US')} of cash buys ${qty} AAPL with a $${LIMIT} limit (worst case $${cost.toLocaleString('en-US')}). Every step either sets money aside, records before acting, or applies a venue message exactly once.`);
  snap({ app: 'accent', gw: 'accent' }, [{ from: 'app', to: 'gw', label: 'POST /orders', tone: 'accent' }], 'The API gateway authenticates, rate-limits per account and dedupes on the Idempotency-Key, so a double tap on "Buy" is one order.');
  snap({ gw: 'accent', order: 'accent' }, [{ from: 'gw', to: 'order', tone: 'accent' }], 'The order service validates: AAPL is tradable and not halted, the market is open, the limit is inside the price collar, and pattern-day-trader rules pass.');
  const rows = reserve(CASH, reserved, cost);
  if (!rows) {
    state = 'rejected';
    snap(
      { order: 'bad', pg: 'bad' },
      [{ from: 'order', to: 'pg', label: 'UPDATE … 0 rows', tone: 'bad' }],
      `Pre-trade risk: UPDATE buying_power SET reserved = reserved + ${cost} WHERE cash − reserved ≥ ${cost} updates 0 rows ($${cost.toLocaleString('en-US')} > $${CASH.toLocaleString('en-US')}). Rejected before anything leaves the building; there is nothing to undo.`,
    );
    snap({ app: 'bad' }, [{ from: 'order', to: 'app', label: 'rejected', tone: 'bad' }], 'The user sees "insufficient buying power". Because the check and the reservation are one conditional statement, two concurrent orders can never both spend the same dollars.');
    return frames;
  }
  reserved = cost;
  state = 'accepted';
  snap(
    { order: 'accent', pg: 'good' },
    [{ from: 'order', to: 'pg', label: '1 txn', tone: 'good' }],
    `One transaction: the conditional UPDATE reserves $${cost.toLocaleString('en-US')} (1 row), the order is inserted as accepted, and an outbox row is written. Nothing is sent to a venue before this commit.`,
  );
  state = 'routed';
  snap({ pg: 'accent', kafka: 'accent', sor: 'accent' }, [{ from: 'pg', to: 'kafka', label: 'outbox relay', tone: 'accent' }, { from: 'kafka', to: 'sor', tone: 'accent' }], 'The relay publishes the outbox row to Kafka (partitioned by account). The smart order router weighs price improvement versus the NBBO, fill rate and venue health: best execution says a wholesale market maker this time.');
  ordersAtVenue = 1;
  snap({ sor: 'accent', fix: 'accent', venue: 'accent' }, [{ from: 'sor', to: 'fix', tone: 'accent' }, { from: 'fix', to: 'venue', label: '35=D ClOrdID=ord-77', tone: 'accent' }], 'The FIX gateway sends NewOrderSingle (35=D) with ClOrdID = our order id, ord-77. The id was persisted before sending, which is what makes a crash survivable.');

  if (scenario === 'crash') {
    snap(
      { fix: 'bad' },
      [],
      'The FIX gateway process crashes right after sending. Did the venue receive ord-77? The gateway cannot know from its own memory.',
      'A naive restart would resend the order. What could go wrong, and what should it do instead?',
    );
    snap(
      { fix: 'good', venue: 'accent' },
      [{ from: 'fix', to: 'venue', label: 'logon + ResendRequest', tone: 'good' }],
      'On restart it re-establishes the FIX session; the sequence-number gap triggers a ResendRequest and the venue replays the missed ExecutionReports. It also checks the drop copy: ord-77 exists at the venue. Orders at venue: still 1. It never sends a second order with a new id.',
    );
  }

  state = 'new';
  execs.push({ execId: 'X1', type: 'New', cumQty: 0, booked: 0, applied: true });
  seen.add('mm1:X1');
  snap({ venue: 'accent', exec: 'accent' }, [{ from: 'venue', to: 'exec', label: '35=8 New', tone: 'accent' }], 'ExecutionReport New (ExecID X1): the venue accepted ord-77. The execution processor moves the order routed → new.');
  const p1 = applyExec(seen, 'mm1', 'X2', FILL1, cum);
  cum = FILL1;
  reserved -= p1.booked * LIMIT;
  position += p1.booked;
  spent += p1.booked * FILL1_PX;
  state = qty > FILL1 ? 'partially_filled' : 'filled';
  execs.push({ execId: 'X2', type: 'Partial', cumQty: FILL1, booked: p1.booked, applied: true });
  snap(
    { venue: 'accent', exec: 'good', pg: 'good', stream: 'good' },
    [{ from: 'venue', to: 'exec', label: `Partial CumQty ${FILL1}`, tone: 'good' }, { from: 'exec', to: 'stream', label: 'push', tone: 'good' }],
    `Partial fill (ExecID X2): ${FILL1} @ $${FILL1_PX}. Book the growth in CumQty (0 → ${FILL1}) to positions and the append-only ledger, turn that slice of the reservation into a debit, and push the update to the user.`,
    scenario === 'dup' ? 'The venue resends the same partial fill (same ExecID). What stops the user from getting 8 shares?' : undefined,
  );
  if (scenario === 'dup') {
    const d = applyExec(seen, 'mm1', 'X2', FILL1, cum);
    execs.push({ execId: 'X2', type: 'Partial (dup)', cumQty: FILL1, booked: d.booked, applied: d.applied });
    snap({ venue: 'warn', exec: 'good' }, [{ from: 'venue', to: 'exec', label: 'X2 again', tone: 'warn' }], 'The same report arrives again (a resend after a reconnect). The processor keys on (venue, ExecID): already applied, so it books nothing. Booking CumQty growth rather than LastQty is a second line of defence.');
  }
  if (qty > FILL1) {
    const p2 = applyExec(seen, 'mm1', 'X3', qty, cum);
    cum = qty;
    reserved -= p2.booked * LIMIT;
    position += p2.booked;
    spent += p2.booked * FILL2_PX;
    state = 'filled';
    execs.push({ execId: 'X3', type: 'Fill', cumQty: qty, booked: p2.booked, applied: true });
    snap(
      { venue: 'accent', exec: 'good', pg: 'good', stream: 'good' },
      [{ from: 'venue', to: 'exec', label: `Fill CumQty ${qty}`, tone: 'good' }, { from: 'exec', to: 'pg', label: 'positions + ledger', tone: 'good' }],
      `Fill (ExecID X3): CumQty ${qty}, so book ${p2.booked} more @ $${FILL2_PX}. Order → filled.`,
    );
  }
  const release = cost - spent;
  reserved = 0;
  snap(
    { exec: 'good', pg: 'good', app: 'good' },
    [{ from: 'exec', to: 'pg', label: 'debit + release', tone: 'good' }],
    `Each fill converted its slice of the reservation into a real debit: $${spent.toFixed(2)} in total, and the $${release.toFixed(2)} of price improvement under the limit is released back to buying power. Position: ${position} shares; orders at the venue: ${ordersAtVenue}. Settlement (T+1) happens later; buying power used unsettled cash meanwhile.`,
  );
  return frames;
}
