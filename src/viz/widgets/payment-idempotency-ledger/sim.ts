// Pure model of a pay-in flow (no React, Node-testable).
//   Idempotency ON : client Idempotency-Key (UNIQUE insert before work), payment_order_id as the PSP
//                    idempotency key, a timeout is UNKNOWN (retry with the same key), webhook events
//                    deduped by event id, ledger posting idempotent by external_ref, forward-only
//                    state transitions.
//   Idempotency OFF: no keys anywhere; the service treats a PSP timeout as FAILED, the user pays
//                    again (new order, new charge), and webhook deliveries are applied blindly.
//   Webhooks are delivered at least once (here: twice) or lost entirely.
//   Nightly reconciliation compares the PSP settlement file with the ledger and payment orders:
//   a settled charge with no posting → auto-fix; a charge posted twice → reversing entry; two
//   charges for one checkout → refund with a reversing entry.
import type { BaseFrame } from '../../core';

export type Webhook = 'delivered' | 'lost';

export interface Params {
  idem: boolean;
  webhook: Webhook;
}

export const DEFAULT_PARAMS: Params = { idem: true, webhook: 'delivered' };

export const AMOUNT = 1000;
export const FEE = 20;

export type OrderStatus = 'NOT_STARTED' | 'PROCESSING' | 'FAILED' | 'SUCCEEDED' | 'REFUNDED';
export type Hop = 'client-svc' | 'svc-client' | 'svc-psp' | 'psp-svc' | 'psp-svc-lost' | 'recon' | null;

export interface Order {
  id: string;
  status: OrderStatus;
}
export interface Charge {
  id: string;
  order: string;
  status: 'processing' | 'succeeded' | 'refunded';
}
export interface LedgerTxn {
  id: string;
  /** e.g. PO1:succeeded, or reversal of t3 */
  ref: string;
  /** +1 = normal posting, −1 = reversing entry */
  sign: 1 | -1;
  note: string;
}
export interface LedgerRow {
  txn: string;
  account: string;
  debit: number;
  credit: number;
}

export interface Frame extends BaseFrame {
  hop: Hop;
  hopLabel: string;
  orders: Order[];
  idemKeys: { key: string; response: string }[];
  charges: Charge[];
  txns: LedgerTxn[];
  rows: LedgerRow[];
  events: string[];
  clientMsg: string;
  findings: { text: string; tone: 'good' | 'warn' | 'bad' }[];
  /** txn ids touched in this step */
  freshTxns: string[];
}

export function ledgerRowsFor(txn: string, sign: 1 | -1): LedgerRow[] {
  const d = (n: number) => (sign === 1 ? { debit: n, credit: 0 } : { debit: 0, credit: n });
  const c = (n: number) => (sign === 1 ? { debit: 0, credit: n } : { debit: n, credit: 0 });
  return [
    { txn, account: 'buyer_psp_receivable', ...d(AMOUNT) },
    { txn, account: 'seller_42_payable', ...c(AMOUNT - FEE) },
    { txn, account: 'platform_fee_revenue', ...c(FEE) },
  ];
}

export function simulate({ idem, webhook }: Params): Frame[] {
  const orders: Order[] = [];
  const idemKeys: { key: string; response: string }[] = [];
  const charges: Charge[] = [];
  const txns: LedgerTxn[] = [];
  const rows: LedgerRow[] = [];
  const events: string[] = [];
  const seenEvents = new Set<string>();
  let clientMsg = 'cart #7 · ₹1,000';
  const findings: Frame['findings'] = [];
  const frames: Frame[] = [];
  const order = (id: string) => orders.find((o) => o.id === id)!;
  const delivered = webhook === 'delivered';

  const snap = (hop: Hop, hopLabel: string, caption: string, freshTxns: string[] = [], predict?: string) =>
    frames.push({
      caption,
      predict,
      hop,
      hopLabel,
      orders: orders.map((o) => ({ ...o })),
      idemKeys: idemKeys.map((k) => ({ ...k })),
      charges: charges.map((c) => ({ ...c })),
      txns: txns.map((t) => ({ ...t })),
      rows: rows.map((r) => ({ ...r })),
      events: [...events],
      clientMsg,
      findings: findings.map((f) => ({ ...f })),
      freshTxns,
    });

  const post = (orderId: string, note: string): string | null => {
    const ref = `${orderId}:succeeded`;
    if (idem && txns.some((t) => t.ref === ref && t.sign === 1)) return null;
    const id = `t${txns.length + 1}`;
    txns.push({ id, ref, sign: 1, note });
    rows.push(...ledgerRowsFor(id, 1));
    return id;
  };
  const reverse = (of: string, note: string) => {
    const id = `t${txns.length + 1}`;
    txns.push({ id, ref: `reversal of ${of}`, sign: -1, note });
    rows.push(...ledgerRowsFor(id, -1));
    return id;
  };

  snap(
    null,
    '',
    idem
      ? 'A buyer checks out cart #7 for ₹1,000 (₹20 platform fee). Every hop is idempotent: client key, PSP key, webhook event id and ledger external_ref.'
      : 'A buyer checks out cart #7 for ₹1,000 (₹20 platform fee). This version has no idempotency keys anywhere.',
  );

  // 1. create order
  orders.push({ id: 'PO1', status: 'NOT_STARTED' });
  if (idem) idemKeys.push({ key: 'K1', response: 'PO1 · in progress' });
  snap(
    'client-svc',
    idem ? 'POST /payments  Idempotency-Key: K1' : 'POST /payments',
    idem
      ? 'The client sends POST /payments with Idempotency-Key K1. The service INSERTs K1 into a UNIQUE table before doing any work, then creates payment order PO1.'
      : 'The client sends POST /payments. The service creates payment order PO1.',
  );

  // 2. charge, response lost
  charges.push({ id: 'ch_1', order: 'PO1', status: 'processing' });
  if (idem) {
    order('PO1').status = 'PROCESSING';
    clientMsg = 'processing…';
    snap(
      'svc-psp',
      'charge(₹1,000, idempotency_key=PO1)',
      'The service asks the PSP to charge ₹1,000 with PO1 as the PSP idempotency key. The PSP creates charge ch_1, but its response is lost and the call times out. A timeout is UNKNOWN, not failed: PO1 stays PROCESSING.',
      [],
      'The impatient buyer taps "Pay" again. What should the second request do?',
    );
  } else {
    order('PO1').status = 'FAILED';
    clientMsg = '“Payment failed, try again”';
    snap(
      'svc-psp',
      'charge(₹1,000)',
      'The service asks the PSP to charge ₹1,000. The PSP creates charge ch_1, but its response is lost and the call times out. The service treats the timeout as a failure: PO1 = FAILED and the buyer sees "payment failed". The card WAS charged.',
      [],
      'The buyer taps "Pay" again. What happens to their card?',
    );
  }

  // 3. client retry
  if (idem) {
    snap(
      'client-svc',
      'POST /payments  Idempotency-Key: K1 (retry)',
      'The retry carries the same key K1. The UNIQUE insert conflicts, so the service returns the stored response for PO1 instead of creating a new order. No second charge is possible.',
    );
    snap(
      'svc-psp',
      'charge(₹1,000, idempotency_key=PO1) (retry)',
      'The service retries the timed-out PSP call with the same key PO1. The PSP recognises it and returns the existing charge ch_1 (still processing): no second charge.',
    );
  } else {
    orders.push({ id: 'PO2', status: 'NOT_STARTED' });
    snap('client-svc', 'POST /payments', 'The second tap is just a new request, and nothing ties it to the first, so the service creates a new payment order PO2.');
    charges.push({ id: 'ch_2', order: 'PO2', status: 'processing' });
    order('PO2').status = 'PROCESSING';
    clientMsg = 'processing…';
    snap('svc-psp', 'charge(₹1,000)', 'PO2 is sent to the PSP as a brand-new charge, ch_2. The buyer now has two ₹1,000 charges on the card for one cart.');
  }

  // 4. PSP completes → webhooks
  for (const c of charges) c.status = 'succeeded';
  if (delivered) {
    const fresh: string[] = [];
    const notes: string[] = [];
    for (const c of charges) {
      const ev = `evt_${c.id.slice(3)}`;
      events.push(`${ev} ${c.id} succeeded`);
      seenEvents.add(ev);
      const o = order(c.order);
      const was = o.status;
      o.status = 'SUCCEEDED';
      const t = post(c.order, `${c.order} via ${ev}`);
      if (t) fresh.push(t);
      notes.push(
        idem
          ? `${ev} for ${c.id}: signature verified, new event id, PO1 moves forward PROCESSING → SUCCEEDED, and ledger txn ${t} posts three rows with external_ref ${c.order}:succeeded.`
          : `${ev} for ${c.id}: ${c.order} goes ${was} → SUCCEEDED${was === 'FAILED' ? ' (the handler blindly overwrites a terminal state)' : ''} and ledger txn ${t} is posted.`,
      );
    }
    clientMsg = idem ? 'paid ✓' : 'paid ✓ (charged twice)';
    snap('psp-svc', 'webhook: charge.succeeded', `The PSP completes and sends webhooks. ${notes.join(' ')}`, fresh, 'Webhooks are delivered at least once. What if the PSP sends evt_1 again?');

    // redelivery
    const ev = 'evt_1';
    events.push(`${ev} ch_1 succeeded (redelivered)`);
    if (idem) {
      snap('psp-svc', 'webhook: charge.succeeded (again)', `The PSP redelivers ${ev}. The event id was already processed, so it is acknowledged and ignored. Even if it got through, posting with external_ref PO1:succeeded would be a no-op.`);
    } else {
      const t = post('PO1', 'PO1 via evt_1 (redelivery)')!;
      snap('psp-svc', 'webhook: charge.succeeded (again)', `The PSP redelivers ${ev}. Without event-id dedup or an external_ref check, the handler posts ledger txn ${t} for PO1 a second time.`, [t]);
    }
  } else {
    clientMsg = idem ? 'still processing…' : 'processing… (charged twice)';
    snap(
      'psp-svc-lost',
      'webhook lost',
      `The PSP completes ${charges.map((c) => c.id).join(' and ')}, but our webhook endpoint was down past the PSP's retry window, so no event arrives. ${orders.filter((o) => o.status !== 'SUCCEEDED').map((o) => `${o.id} is stuck at ${o.status}`).join(', ')}. The ledger has nothing, although the money moved.`,
      [],
      'Nobody noticed. What catches this?',
    );
  }

  // 5. reconciliation
  const settled = charges.filter((c) => c.status === 'succeeded');
  findings.push({ text: `settlement file: ${settled.length} charge${settled.length > 1 ? 's' : ''}, ₹${(settled.length * AMOUNT).toLocaleString('en-IN')}`, tone: 'good' });
  const fresh: string[] = [];
  const notes: string[] = [];
  for (const c of settled) {
    const posted = txns.filter((t) => t.ref === `${c.order}:succeeded` && t.sign === 1);
    const reversed = txns.filter((t) => t.sign === -1 && posted.some((p) => t.ref === `reversal of ${p.id}`));
    const net = posted.length - reversed.length;
    if (net === 0) {
      order(c.order).status = 'SUCCEEDED';
      const t = post(c.order, `${c.order} recon auto-fix`)!;
      fresh.push(t);
      findings.push({ text: `${c.id}: settled but not in ledger → auto-fix ${t}`, tone: 'warn' });
      notes.push(`${c.id} settled but has no ledger entry (missed webhook): auto-fixed by marking ${c.order} SUCCEEDED and posting ${t}.`);
    } else if (net > 1) {
      for (const extra of posted.slice(1)) {
        const r = reverse(extra.id, `undo duplicate ${extra.id}`);
        fresh.push(r);
        findings.push({ text: `${c.id}: posted ${net}× → reversing entry ${r}`, tone: 'bad' });
        notes.push(`${c.id} was posted ${net} times: reversing entry ${r} cancels ${extra.id} (ledger rows are never deleted).`);
      }
    } else {
      findings.push({ text: `${c.id}: ledger matches ✓`, tone: 'good' });
    }
  }
  if (settled.length > 1) {
    for (const c of settled.slice(1)) {
      c.status = 'refunded';
      order(c.order).status = 'REFUNDED';
      const posting = txns.find((t) => t.ref === `${c.order}:succeeded` && t.sign === 1)!;
      const r = reverse(posting.id, `refund ${c.id}`);
      fresh.push(r);
      findings.push({ text: `cart #7 charged ${settled.length}× → refund ${c.id}, ${r}`, tone: 'bad' });
      notes.push(`Cart #7 was charged ${settled.length} times, so ${c.id} goes to the manual queue and is refunded, with reversing entry ${r}.`);
    }
    clientMsg = 'refund of ₹1,000 issued';
  } else if (!delivered) clientMsg = 'paid ✓ (after recon)';
  snap(
    'recon',
    'nightly reconciliation',
    notes.length
      ? `Nightly reconciliation compares the PSP settlement file with our orders and ledger. ${notes.join(' ')}`
      : 'Nightly reconciliation compares the PSP settlement file (ch_1, ₹1,000) with our orders and ledger: everything matches, nothing to fix.',
    fresh,
  );

  const rec = rows.filter((r) => r.account === 'buyer_psp_receivable').reduce((a, r) => a + r.debit - r.credit, 0);
  snap(
    null,
    '',
    idem
      ? `Result: one charge, one order, ${txns.length === 1 ? 'one ledger posting' : `${txns.length} ledger txns`}, receivable = ₹${rec.toLocaleString('en-IN')}. Retries plus idempotency give an exactly-once effect${delivered ? '' : '; reconciliation covered the lost webhook'}.`
      : `Result: the card was charged twice and the ledger was wrong until reconciliation repaired it (receivable now ₹${rec.toLocaleString('en-IN')}). Note that every txn balanced the whole time: double entry proves internal consistency, not correctness. Only reconciliation against the PSP's truth catches this.`,
  );
  return frames;
}
