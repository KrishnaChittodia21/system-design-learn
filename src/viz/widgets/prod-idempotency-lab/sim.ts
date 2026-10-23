// "Charged twice" simulator for prod-correctness-ops §1 (idempotency).
// A sequence of messages between Client, API, DB and the payment provider (PSP). Three
// triggers from the topic (timeout ≠ failure, double-submit, a crash between the charge and
// the commit) × three server-side guards × whether the key is forwarded to the PSP.
// The ledger at the end says how many orders exist and how many times the card was captured.
import type { BaseFrame } from '../../core';

export type Lane = 'client' | 'api' | 'db' | 'psp';
export type ScenarioId = 'timeout' | 'double' | 'crash';
export type Guard = 'none' | 'check' | 'key';

export interface Params {
  scenario: ScenarioId;
  guard: Guard;
  forward: boolean;
}

export type Tone = 'ok' | 'bad' | 'warn' | 'info';

export interface Msg {
  /** seconds since the click */
  at: number;
  from: Lane;
  to: Lane;
  label: string;
  tone: Tone;
  /** which HTTP attempt this belongs to (1, 2, 3) */
  req: number;
}

export interface Ledger {
  orders: number;
  captures: number;
  /** state of the idempotency row (key guard only) */
  keyRow: 'none' | 'started' | 'completed';
  /** what the client finally saw */
  clientSees: string;
}

export interface Frame extends BaseFrame {
  msgs: Msg[];
  ledger: Ledger;
  done: boolean;
}

export const PRICE = 1499;
export const LANES: { id: Lane; label: string }[] = [
  { id: 'client', label: 'Client' },
  { id: 'api', label: 'API' },
  { id: 'db', label: 'Postgres' },
  { id: 'psp', label: 'PSP' },
];

export const SCENARIO_LABELS: Record<ScenarioId, string> = {
  timeout: 'Client timeout, then retry',
  double: 'Double-click (concurrent)',
  crash: 'Crash after the charge',
};
export const GUARD_LABELS: Record<Guard, string> = {
  none: 'No guard',
  check: 'Check-then-insert',
  key: 'Idempotency-Key + UNIQUE',
};

interface Step {
  m: Msg;
  caption: string;
  predict?: string;
}

/** Builds the message sequence; a tiny interpreter keeps the ledger honest. */
class Script {
  steps: Step[] = [];
  ledger: Ledger = { orders: 0, captures: 0, keyRow: 'none', clientSees: '…' };
  snapshots: Ledger[] = [];
  pspSeen = false; // the PSP has already seen this idempotency key
  readonly p: Params;
  constructor(p: Params) {
    this.p = p;
  }
  say(at: number, from: Lane, to: Lane, label: string, tone: Tone, req: number, caption: string, predict?: string) {
    this.steps.push({ m: { at, from, to, label, tone, req }, caption, predict });
    this.snapshots.push({ ...this.ledger });
  }
  pending = new Map<number, boolean>(); // req → will this request create a NEW capture?
  /** the API asks the PSP to capture; with a forwarded key the PSP deduplicates (decided on arrival) */
  chargeReq(at: number, req: number, why: string) {
    const fwd = this.p.forward;
    this.pending.set(req, !(fwd && this.pspSeen));
    this.pspSeen = true;
    this.say(at, 'api', 'psp', `POST /charges ₹${PRICE}${fwd ? ' + key' : ''}`, 'info', req, why);
  }
  chargeResp(at: number, req: number) {
    const fwd = this.p.forward;
    if (!this.pending.get(req)) {
      this.say(at, 'psp', 'api', 'same charge (replayed)', 'ok', req, `The PSP has seen this idempotency key before, so it returns the ORIGINAL charge instead of capturing again. The card is still charged once.`);
      return;
    }
    this.ledger.captures++;
    const dup = this.ledger.captures > 1;
    this.say(
      at,
      'psp',
      'api',
      dup ? `captured AGAIN (#${this.ledger.captures})` : 'captured',
      dup ? 'bad' : 'ok',
      req,
      dup
        ? `The PSP captures ₹${PRICE} a second time: it has no way to know this is the same purchase${fwd ? '' : ', because no idempotency key was forwarded'}.`
        : `The PSP captures ₹${PRICE}. Money has moved; nothing after this may repeat it.`,
    );
  }
  charge(at: number, req: number, why: string) {
    this.chargeReq(at, req, why);
    this.chargeResp(at + 0.3, req);
  }
  insertOrder(at: number, req: number) {
    this.ledger.orders++;
    const dup = this.ledger.orders > 1;
    this.say(at, 'api', 'db', dup ? `INSERT order #${this.ledger.orders} (duplicate!)` : `INSERT order #1 · COMMIT`, dup ? 'bad' : 'ok', req, dup ? `A second order row for the same cart is committed. Support will see "two orders with identical carts seconds apart".` : `Order #1 is committed.`);
  }
}

function build(p: Params): Script {
  const s = new Script(p);
  const { guard } = p;
  const key = guard === 'key';
  const keyNote = key ? ' with header Idempotency-Key: 7f3c…, a UUID generated once for this checkout' : '';

  if (p.scenario === 'timeout') {
    s.say(0, 'client', 'api', `POST /orders${key ? ' + key' : ''}`, 'info', 1, `The app sends POST /orders${keyNote}. Its HTTP timeout is 10 s.`);
    if (key) {
      s.ledger.keyRow = 'started';
      s.say(0.1, 'api', 'db', "INSERT key 'started' ✓", 'ok', 1, `Before doing any work the API inserts the key with state "started". A UNIQUE constraint guarantees only one request can ever own it.`);
    }
    if (guard === 'check') s.say(0.1, 'api', 'db', 'SELECT order for cart → none', 'info', 1, `The API checks whether an order for this cart exists. None does, so it goes ahead.`);
    s.chargeReq(0.4, 1, `The API calls the payment provider. Today the PSP is slow: its answer will take 11 s.`);
    s.say(10, 'client', 'client', '⏱ timeout at 10 s', 'warn', 1, `The client gives up after 10 s and shows "something went wrong", but the server is still working. Timeout ≠ failure.`, `The app retries the same POST. What does the server do with it?`);
    s.say(10.5, 'client', 'api', `retry POST /orders${key ? ' + same key' : ''}`, 'info', 2, `Auto-retry: the same request is sent again${key ? ' with the SAME idempotency key' : ''}. Attempt 1 has not finished yet.`);
    if (key) {
      s.say(10.6, 'api', 'db', 'INSERT key → UNIQUE conflict', 'warn', 2, `Attempt 2 tries to insert the same key and hits the UNIQUE constraint. The row says "started": the first attempt is still in flight.`);
      s.say(10.7, 'api', 'client', '409 in progress, retry later', 'warn', 2, `So attempt 2 does no work: it answers 409 "in progress" and the client backs off.`);
      s.chargeResp(11.5, 1);
      s.insertOrder(11.8, 1);
      s.ledger.keyRow = 'completed';
      s.say(12, 'api', 'db', "UPDATE key 'completed' + response", 'ok', 1, `Attempt 1 finishes at 12 s: the order and the stored response are saved, and the key moves to "completed". Its HTTP reply goes nowhere: the client already hung up.`);
      s.say(13, 'client', 'api', 'retry POST + same key', 'info', 3, `The client retries again after its backoff.`);
      s.ledger.clientSees = 'order #1 (replayed)';
      s.say(13.1, 'api', 'client', '200 order #1 (replayed)', 'ok', 3, `The key is "completed", so the API replays the stored response: order #1. One order, one capture.`);
    } else {
      if (guard === 'check')
        s.say(10.6, 'api', 'db', 'SELECT order for cart → none', 'bad', 2, `Attempt 2 checks for an existing order. Attempt 1 has not committed yet, so it sees nothing. Check-then-insert cannot see in-flight work.`);
      s.charge(10.8, 2, `Attempt 2 calls the PSP again (it answers quickly this time).`);
      s.insertOrder(11.2, 2);
      s.say(11.3, 'api', 'client', '200 order', 'info', 2, `The client sees a success for attempt 2. The customer believes they paid once.`);
      s.chargeResp(11.5, 1);
      s.insertOrder(11.8, 1);
      s.ledger.clientSees = 'one success';
      s.say(12, 'api', 'client', '200 (nobody listening)', 'info', 1, `Attempt 1 finishes at 12 s and replies to a connection the client already closed.`);
    }
  } else if (p.scenario === 'double') {
    s.say(0, 'client', 'api', `POST /orders${key ? ' + key' : ''}`, 'info', 1, `The user taps Pay${keyNote}.`);
    s.say(0.05, 'client', 'api', `POST /orders${key ? ' + same key' : ''}`, 'info', 2, `…and taps again 50 ms later. Both requests are now in flight on different API workers.`, `Both requests are inside the server at the same moment. What stops them both from charging?`);
    if (key) {
      s.ledger.keyRow = 'started';
      s.say(0.1, 'api', 'db', "#1 INSERT key 'started' ✓", 'ok', 1, `Request 1 inserts the key first and owns the operation.`);
      s.say(0.11, 'api', 'db', '#2 INSERT key → UNIQUE conflict', 'warn', 2, `Request 2's insert hits the UNIQUE constraint. The database, not application code, decides the winner, so there is no race window.`);
      s.charge(0.2, 1, `Only request 1 calls the PSP.`);
      s.insertOrder(0.6, 1);
      s.ledger.keyRow = 'completed';
      s.say(0.65, 'api', 'db', "UPDATE key 'completed'", 'ok', 1, `Request 1 stores its response and marks the key completed.`);
      s.say(0.7, 'api', 'client', '#2 waits, then replays order #1', 'ok', 2, `Request 2 waited on the conflict and now replays the stored result.`);
      s.ledger.clientSees = 'order #1';
      s.say(0.72, 'api', 'client', '#1 200 order #1', 'ok', 1, `Both taps show the same order #1. One capture.`);
    } else {
      if (guard === 'check') {
        s.say(0.1, 'api', 'db', '#1 SELECT order for cart → none', 'info', 1, `Request 1 checks: no order for this cart.`);
        s.say(0.11, 'api', 'db', '#2 SELECT order for cart → none', 'bad', 2, `Request 2 checks 10 ms later: still no order, because request 1 has not inserted it yet. Both pass the check.`);
      }
      s.chargeReq(0.2, 1, `Request 1 calls the PSP.`);
      s.chargeReq(0.21, 2, `Request 2 calls the PSP too.`);
      s.chargeResp(0.5, 1);
      s.chargeResp(0.51, 2);
      s.insertOrder(0.6, 1);
      s.insertOrder(0.61, 2);
      s.ledger.clientSees = 'order #2';
      s.say(0.7, 'api', 'client', '200 order #1, 200 order #2', 'info', 1, `The user sees a success screen. Two orders exist.`);
    }
  } else {
    s.say(0, 'client', 'api', `POST /orders${key ? ' + key' : ''}`, 'info', 1, `The app sends POST /orders${keyNote}.`);
    if (key) {
      s.ledger.keyRow = 'started';
      s.say(0.1, 'api', 'db', "INSERT key 'started' ✓", 'ok', 1, `The key row is committed with state "started" (a small state machine: started → completed).`);
    }
    if (guard === 'check') s.say(0.1, 'api', 'db', 'SELECT order for cart → none', 'info', 1, `No order exists yet, so the API proceeds.`);
    s.charge(0.2, 1, `The API calls the PSP.`);
    s.say(0.6, 'api', 'api', '💥 pod OOM-killed before COMMIT', 'bad', 1, `The pod is killed right after the PSP said "captured" and before the order was committed. The money moved; our database does not know.`);
    s.say(0.7, 'api', 'client', '502 Bad Gateway', 'warn', 1, `The load balancer returns 502. From the client's view the purchase failed.`, `The client retries. Which layer can still tell that the card was already charged?`);
    s.say(2, 'client', 'api', `retry POST /orders${key ? ' + same key' : ''}`, 'info', 2, `The client retries${key ? ' with the same key' : ''}.`);
    if (key) {
      s.say(2.1, 'api', 'db', "key is 'started', lease expired", 'warn', 2, `The key row is still "started" and its owner's lease has expired, so this attempt takes over and re-runs the operation. Our database cannot tell whether the PSP call happened.`);
    }
    if (guard === 'check') s.say(2.1, 'api', 'db', 'SELECT order for cart → none', 'bad', 2, `There is still no order row (the first attempt died before committing), so the check passes again.`);
    s.charge(2.2, 2, p.forward ? `It calls the PSP again, forwarding the same idempotency key.` : `It calls the PSP again. Nothing tells the PSP this is a repeat.`);
    s.insertOrder(2.6, 2);
    s.steps[s.steps.length - 1].caption = `The retry commits order #1. Only one order row exists, because the first attempt died before committing.`;
    if (key) {
      s.ledger.keyRow = 'completed';
      s.say(2.7, 'api', 'db', "UPDATE key 'completed'", 'ok', 2, `The key is marked completed with the stored response.`);
    }
    s.ledger.clientSees = 'order #1';
    s.say(2.8, 'api', 'client', '200 order #1', 'ok', 2, `The client sees one order.`);
  }
  return s;
}

export function verdict(l: Ledger): { tone: Tone; text: string } {
  if (l.captures > 1 && l.orders > 1) return { tone: 'bad', text: `Charged ${l.captures}× (₹${(PRICE * l.captures).toLocaleString('en-IN')}) and ${l.orders} orders: refund and reconcile against the PSP.` };
  if (l.captures > 1) return { tone: 'bad', text: `One order, but the card was captured ${l.captures}× (₹${(PRICE * l.captures).toLocaleString('en-IN')}). The duplicate is invisible in our own DB.` };
  if (l.orders > 1) return { tone: 'warn', text: `Charged once (the PSP deduplicated by key), but ${l.orders} orders exist: duplicate fulfilment.` };
  return { tone: 'ok', text: `Exactly one order and one capture of ₹${PRICE.toLocaleString('en-IN')}.` };
}

export function simulate(p: Params): Frame[] {
  const s = build(p);
  const intro: Record<ScenarioId, string> = {
    timeout: 'Trigger: the PSP is slow today. The client times out at 10 s and retries; the server finishes at 12 s.',
    double: 'Trigger: a double-tap sends two identical requests 50 ms apart.',
    crash: 'Trigger: the API pod dies after the PSP captured the money but before the order was committed.',
  };
  const guardText: Record<Guard, string> = {
    none: 'The server has no deduplication at all.',
    check: 'The server runs "SELECT … if no order exists, INSERT" in application code, with no unique constraint.',
    key: 'The client sends an Idempotency-Key; the server inserts it under a UNIQUE constraint before doing any work and stores the response.',
  };
  const frames: Frame[] = [
    {
      msgs: [],
      ledger: { orders: 0, captures: 0, keyRow: 'none', clientSees: '…' },
      done: false,
      caption: `${intro[p.scenario]} ${guardText[p.guard]} ${p.forward ? 'The key is also forwarded to the PSP.' : 'Nothing is forwarded to the PSP.'}`,
    },
  ];
  s.steps.forEach((st, i) => {
    const last = i === s.steps.length - 1;
    const ledger = last ? { ...s.ledger } : s.snapshots[i];
    frames.push({
      msgs: s.steps.slice(0, i + 1).map((x) => x.m),
      ledger,
      done: last,
      caption: last ? `${st.caption} Result: ${verdict(s.ledger).text}` : st.caption,
      predict: st.predict,
    });
  });
  return frames;
}

/** final ledger for a parameter set (used by the check script) */
export function outcome(p: Params): Ledger {
  return build(p).ledger;
}
