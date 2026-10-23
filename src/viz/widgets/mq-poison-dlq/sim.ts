// Pure, deterministic tick simulation of one Kafka partition with a poison pill and a flaky
// message, under three retry designs:
//   inplace    — retry the head message in place forever (blocks the partition)
//   tiered     — 2 in-place tries → retry-1 (wait 3 ticks) → retry-2 (wait 6 ticks) → DLQ
//   classified — like tiered, but permanent errors (deserialization) go straight to the DLQ
// One message is produced per tick; each consumer makes at most one attempt per tick.
import type { BaseFrame } from '../../core';

export type Strategy = 'inplace' | 'tiered' | 'classified';
export type Kind = 'ok' | 'poison' | 'flaky';

export interface Params {
  strategy: Strategy;
}

export interface Msg {
  id: number;
  key: 'A' | 'B' | 'C';
  kind: Kind;
  produced: number;
}

export interface Waiting {
  id: number;
  /** tick at which a retry consumer may pick it up (retry tiers only) */
  notBefore: number;
}

export type Where = 'main' | 'retry1' | 'retry2';
export type Outcome = 'ok' | 'fail-stay' | 'to-retry1' | 'to-retry2' | 'to-dlq';

export interface Attempt {
  id: number;
  where: Where;
  /** 1-based attempt number for this message */
  n: number;
  outcome: Outcome;
}

export interface Frame extends BaseFrame {
  tick: number;
  main: number[];
  retry1: Waiting[];
  retry2: Waiting[];
  dlq: number[];
  /** completed message ids in completion order */
  done: number[];
  /** ids completed while an earlier message with the same key was still in retry / DLQ */
  outOfOrder: number[];
  attempts: Attempt[];
  totalAttempts: number;
  failedAttempts: number;
  /** messages waiting in the main partition (consumer lag) */
  lag: number;
  /** age in ticks of the oldest message still in the main partition */
  oldestAge: number;
}

export const N_MSG = 12;
export const TICKS = 20;
export const IN_PLACE_TRIES = 2;
export const RETRY1_DELAY = 3;
export const RETRY2_DELAY = 6;
/** the flaky message fails this many attempts, then succeeds (a downstream 503 blip) */
export const FLAKY_FAILS = 3;
export const POISON_ID = 4;
export const FLAKY_ID = 8;

const KEYS = ['A', 'B', 'C'] as const;

export const MESSAGES: Msg[] = Array.from({ length: N_MSG }, (_, i) => {
  const id = i + 1;
  return { id, key: KEYS[i % 3], kind: id === POISON_ID ? 'poison' : id === FLAKY_ID ? 'flaky' : 'ok', produced: i };
});

export const msg = (id: number) => MESSAGES[id - 1];

const succeeds = (m: Msg, n: number) => (m.kind === 'poison' ? false : m.kind === 'flaky' ? n > FLAKY_FAILS : true);
const errorOf = (m: Msg) => (m.kind === 'poison' ? 'DeserializationError (permanent)' : '503 from the payment API (transient)');

export function simulate({ strategy }: Params): Frame[] {
  const main: number[] = [];
  let retry1: Waiting[] = [];
  let retry2: Waiting[] = [];
  const dlq: number[] = [];
  const done: number[] = [];
  const outOfOrder: number[] = [];
  const tries = new Map<number, number>(); // total attempts per message
  const inPlace = new Map<number, number>(); // attempts made at the head of the main partition
  let totalAttempts = 0;
  let failedAttempts = 0;

  const policy =
    strategy === 'inplace'
      ? 'The consumer retries a failing message in place until it succeeds.'
      : strategy === 'tiered'
        ? `Retry ${IN_PLACE_TRIES}× in place, then publish to retry-1 (wait ${RETRY1_DELAY} ticks), then retry-2 (wait ${RETRY2_DELAY}), then the DLQ — commit the offset each time it leaves.`
        : `Classify first: permanent errors go straight to the DLQ; transient ones go ${IN_PLACE_TRIES}× in place → retry-1 (${RETRY1_DELAY} ticks) → retry-2 (${RETRY2_DELAY}) → DLQ.`;

  const frames: Frame[] = [
    {
      tick: -1,
      main: [],
      retry1: [],
      retry2: [],
      dlq: [],
      done: [],
      outOfOrder: [],
      attempts: [],
      totalAttempts: 0,
      failedAttempts: 0,
      lag: 0,
      oldestAge: 0,
      caption: `A producer writes one message per tick (keys A/B/C) to one partition. m${POISON_ID} is a poison pill (malformed payload, can never succeed); m${FLAKY_ID} hits a downstream blip and fails its first ${FLAKY_FAILS} attempts. ${policy}`,
    },
  ];

  // is an earlier message with the same key still unresolved (in a retry tier or the DLQ)?
  const blockedByEarlier = (id: number) => {
    const k = msg(id).key;
    const parked = [...retry1.map((w) => w.id), ...retry2.map((w) => w.id), ...dlq];
    return parked.some((p) => p < id && msg(p).key === k);
  };

  for (let t = 0; t < TICKS; t++) {
    if (t < N_MSG) main.push(t + 1);
    const attempts: Attempt[] = [];

    const attempt = (id: number) => {
      const n = (tries.get(id) ?? 0) + 1;
      tries.set(id, n);
      totalAttempts++;
      const ok = succeeds(msg(id), n);
      if (!ok) failedAttempts++;
      return { n, ok };
    };
    const complete = (id: number) => {
      if (blockedByEarlier(id)) outOfOrder.push(id);
      done.push(id);
    };

    // retry tiers first (independent consumers), so a message moved this tick is not retried twice
    const r2 = retry2[0];
    if (r2 && r2.notBefore <= t) {
      retry2 = retry2.slice(1);
      const { n, ok } = attempt(r2.id);
      if (ok) complete(r2.id);
      else dlq.push(r2.id);
      attempts.push({ id: r2.id, where: 'retry2', n, outcome: ok ? 'ok' : 'to-dlq' });
    }
    const r1 = retry1[0];
    if (r1 && r1.notBefore <= t) {
      retry1 = retry1.slice(1);
      const { n, ok } = attempt(r1.id);
      if (ok) complete(r1.id);
      else retry2.push({ id: r1.id, notBefore: t + RETRY2_DELAY });
      attempts.push({ id: r1.id, where: 'retry1', n, outcome: ok ? 'ok' : 'to-retry2' });
    }

    const head = main[0];
    if (head !== undefined) {
      const { n, ok } = attempt(head);
      const ip = (inPlace.get(head) ?? 0) + 1;
      inPlace.set(head, ip);
      let outcome: Outcome;
      if (ok) {
        main.shift();
        complete(head);
        outcome = 'ok';
      } else if (strategy === 'inplace') {
        outcome = 'fail-stay';
      } else if (strategy === 'classified' && msg(head).kind === 'poison') {
        main.shift();
        dlq.push(head);
        outcome = 'to-dlq';
      } else if (ip < IN_PLACE_TRIES) {
        outcome = 'fail-stay';
      } else {
        main.shift();
        retry1.push({ id: head, notBefore: t + RETRY1_DELAY });
        outcome = 'to-retry1';
      }
      attempts.push({ id: head, where: 'main', n, outcome });
    }

    const lag = main.length;
    const oldestAge = main.length ? t - msg(main[0]).produced : 0;

    // narration
    const parts = attempts
      .slice()
      .reverse()
      .map((a) => {
        const m = msg(a.id);
        const where = a.where === 'main' ? 'main' : a.where === 'retry1' ? 'retry-1' : 'retry-2';
        const tag = `m${a.id} (${where}, attempt ${a.n})`;
        switch (a.outcome) {
          case 'ok':
            return `${tag} succeeds${outOfOrder.includes(a.id) && done[done.length - 1] === a.id ? ` — but an earlier key-${m.key} message is still parked, so key ${m.key} is now out of order` : ''}`;
          case 'fail-stay':
            return strategy === 'inplace'
              ? `${tag} fails: ${errorOf(m)}; it stays at the head and blocks the partition`
              : `${tag} fails: ${errorOf(m)}; one more quick in-place try`;
          case 'to-retry1':
            return `${tag} fails again → published to retry-1 (due t=${t + RETRY1_DELAY}), offset committed, the partition moves on`;
          case 'to-retry2':
            return `${tag} fails → retry-2 (due t=${t + RETRY2_DELAY})`;
          case 'to-dlq':
            return a.where === 'main'
              ? `${tag} fails with a permanent ${errorOf(m).split(' ')[0]} → straight to the DLQ, no retries wasted`
              : `${tag} fails at the last tier → DLQ with error headers; alert fires`;
        }
      });
    const due = [...retry1, ...retry2].map((w) => w.notBefore);
    let caption = `t=${t}: ${
      parts.length
        ? parts.join('; ') + '.'
        : due.length
          ? `main partition drained; retry consumers are paused until their next message is due (t=${Math.min(...due)}) — paused, not sleeping inside the handler.`
          : 'idle.'
    }`;
    if (lag > 2) caption += ` Lag ${lag} messages, oldest waiting ${oldestAge} ticks.`;
    let predict: string | undefined;
    if (t === POISON_ID - 2) predict = `m${POISON_ID} (malformed JSON) reaches the head next tick. What happens to m${POISON_ID + 1}…m${N_MSG} behind it?`;
    if (t === TICKS - 1) {
      caption +=
        strategy === 'inplace'
          ? ` End: only ${done.length} of ${N_MSG} processed and ${failedAttempts} attempts burned on m${POISON_ID}. One bad message stalled the whole partition — lag in time keeps rising.`
          : ` End: ${done.length}/${N_MSG} processed, ${dlq.length} in the DLQ, ${failedAttempts} failed attempts${strategy === 'tiered' ? ` (m${POISON_ID} wasted ${tries.get(POISON_ID)} tries — retrying a permanent error is pointless)` : ''}. ${outOfOrder.length} message${outOfOrder.length === 1 ? '' : 's'} (${outOfOrder.map((i) => `m${i}`).join(', ')}) overtook an earlier same-key message: retry topics trade per-key order for liveness — park the key or version-check if order matters.`;
    }

    frames.push({
      tick: t,
      main: [...main],
      retry1: retry1.map((w) => ({ ...w })),
      retry2: retry2.map((w) => ({ ...w })),
      dlq: [...dlq],
      done: [...done],
      outOfOrder: [...outOfOrder],
      attempts,
      totalAttempts,
      failedAttempts,
      lag,
      oldestAge,
      caption,
      predict,
    });
  }
  return frames;
}
