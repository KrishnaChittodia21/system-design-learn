// Pure scheduler model for one LLM replica (no React, Node-testable). One step = one forward pass.
//   A request that joins the batch spends its first step in PREFILL (processes the whole prompt and
//   emits its first token, which is when streaming starts), then emits one token per DECODE step.
//   static     : a batch is formed only when the previous batch has completely finished; finished
//                sequences keep their slot (idle padding) until the longest one is done.
//   continuous : every step, finished sequences leave and waiting ones join (iteration-level).
//   KV memory  : prealloc reserves prompt + max_tokens per request up front; paged (PagedAttention)
//                reserves 16-token blocks as the sequence actually grows.
// Admission is FIFO and limited by MAX_BATCH sequences and KV_CAPACITY tokens.
import type { BaseFrame } from '../../core';

export type Scheduler = 'static' | 'continuous';
export type Kv = 'prealloc' | 'paged';

export interface Params {
  scheduler: Scheduler;
  kv: Kv;
}

export const DEFAULT_PARAMS: Params = { scheduler: 'continuous', kv: 'paged' };

export const KV_CAPACITY = 1600;
export const MAX_TOKENS = 200;
export const BLOCK = 16;
export const MAX_BATCH = 6;
export const MAX_STEPS = 40;

export interface Req {
  id: string;
  arrive: number;
  prompt: number;
  out: number;
}

export const REQUESTS: Req[] = [
  { id: 'R1', arrive: 0, prompt: 200, out: 6 },
  { id: 'R2', arrive: 0, prompt: 100, out: 16 },
  { id: 'R3', arrive: 0, prompt: 300, out: 4 },
  { id: 'R4', arrive: 1, prompt: 150, out: 9 },
  { id: 'R5', arrive: 2, prompt: 80, out: 5 },
  { id: 'R6', arrive: 4, prompt: 380, out: 7 },
  { id: 'R7', arrive: 5, prompt: 120, out: 3 },
  { id: 'R8', arrive: 7, prompt: 60, out: 10 },
];

export type Cell = 'none' | 'wait' | 'prefill' | 'decode' | 'idle' | 'done';

export interface ReqView extends Req {
  generated: number;
  start: number | null;
  finish: number | null;
  /** KV tokens actually holding state / reserved */
  used: number;
  reserved: number;
  inBatch: boolean;
}

export interface Frame extends BaseFrame {
  step: number;
  reqs: ReqView[];
  /** per request, per step */
  grid: Cell[][];
  kvUsed: number;
  kvReserved: number;
  tokensThisStep: number;
  tokensTotal: number;
  joined: string[];
  left: string[];
}

export const reservation = (kv: Kv, prompt: number, generated: number) =>
  kv === 'prealloc' ? prompt + MAX_TOKENS : Math.ceil((prompt + generated + 1) / BLOCK) * BLOCK;

export function simulate({ scheduler, kv }: Params): Frame[] {
  const reqs: ReqView[] = REQUESTS.map((r) => ({ ...r, generated: 0, start: null, finish: null, used: 0, reserved: 0, inBatch: false }));
  const grid: Cell[][] = reqs.map(() => []);
  const frames: Frame[] = [];
  let tokensTotal = 0;
  let firstBatchFormed = false;

  const view = () => reqs.map((r) => ({ ...r }));
  const kvTotals = () => {
    const inb = reqs.filter((r) => r.inBatch);
    return { used: inb.reduce((a, r) => a + r.used, 0), reserved: inb.reduce((a, r) => a + r.reserved, 0) };
  };

  frames.push({
    caption: `One GPU replica with ${KV_CAPACITY} tokens of KV-cache memory and room for ${MAX_BATCH} sequences per forward pass. Scheduling: ${scheduler === 'static' ? 'static batches' : 'continuous (iteration-level) batching'}; KV: ${kv === 'prealloc' ? `pre-allocate prompt + max_tokens (${MAX_TOKENS}) per request` : `PagedAttention, ${BLOCK}-token blocks allocated as tokens are generated`}.`,
    step: -1,
    reqs: view(),
    grid: grid.map((g) => [...g]),
    kvUsed: 0,
    kvReserved: 0,
    tokensThisStep: 0,
    tokensTotal: 0,
    joined: [],
    left: [],
  });

  for (let s = 0; s < MAX_STEPS; s++) {
    const joined: string[] = [];
    const left: string[] = [];
    const batch = () => reqs.filter((r) => r.inBatch);
    // leave
    const finishedInBatch = batch().filter((r) => r.finish !== null);
    if (scheduler === 'continuous' || (finishedInBatch.length && finishedInBatch.length === batch().length)) {
      for (const r of finishedInBatch) {
        r.inBatch = false;
        r.used = 0;
        r.reserved = 0;
        left.push(r.id);
      }
    }
    // join
    const canAdmit = scheduler === 'continuous' || batch().length === 0;
    if (canAdmit) {
      const queue = reqs.filter((r) => r.arrive <= s && r.start === null);
      for (const r of queue) {
        const need = reservation(kv, r.prompt, 0);
        if (batch().length >= MAX_BATCH || kvTotals().reserved + need > KV_CAPACITY) break;
        r.inBatch = true;
        r.start = s;
        r.reserved = need;
        r.used = r.prompt;
        joined.push(r.id);
      }
    }
    // execute one forward pass
    let tokens = 0;
    reqs.forEach((r, i) => {
      if (r.inBatch) {
        if (r.finish !== null) grid[i][s] = 'idle';
        else {
          grid[i][s] = r.generated === 0 ? 'prefill' : 'decode';
          r.generated++;
          tokens++;
          r.used = r.prompt + r.generated;
          r.reserved = reservation(kv, r.prompt, r.generated);
          if (r.generated === r.out) r.finish = s;
        }
      } else if (r.finish !== null) grid[i][s] = 'done';
      else if (r.arrive <= s) grid[i][s] = 'wait';
      else grid[i][s] = 'none';
    });
    tokensTotal += tokens;
    const kvt = kvTotals();
    const waiting = reqs.filter((r) => r.arrive <= s && r.start === null).map((r) => r.id);
    const idle = reqs.filter((r) => r.inBatch && grid[reqs.indexOf(r)][s] === 'idle').map((r) => r.id);
    const parts: string[] = [];
    if (left.length) parts.push(`${left.join(', ')} ${left.length > 1 ? 'leave' : 'leaves'} the batch and frees ${left.length > 1 ? 'their' : 'its'} KV memory.`);
    if (joined.length) parts.push(`${joined.join(', ')} ${joined.length > 1 ? 'join' : 'joins'} and run${joined.length > 1 ? '' : 's'} prefill (the first token streams back).`);
    if (idle.length) parts.push(`${idle.join(', ')} already finished but ${idle.length > 1 ? 'hold their slots' : 'holds its slot'} until the whole batch is done.`);
    if (waiting.length) {
      const why =
        scheduler === 'static' && batch().length
          ? 'the current static batch is still running'
          : batch().length >= MAX_BATCH
            ? `the batch is full (${MAX_BATCH})`
            : `KV memory is ${kv === 'prealloc' ? 'fully reserved by pre-allocations' : 'full'}`;
      parts.push(`${waiting.join(', ')} ${waiting.length > 1 ? 'wait' : 'waits'} because ${why}.`);
    }
    frames.push({
      caption: `Step ${s}: ${tokens} token${tokens === 1 ? '' : 's'} generated. ${parts.length ? `${parts.join(' ')} ` : ''}KV: ${kvt.used} tokens of state in ${kvt.reserved} reserved.`,
      predict:
        !firstBatchFormed && scheduler === 'static' && joined.length
          ? `R3 needs only ${REQUESTS[2].out} tokens but R2 needs ${REQUESTS[1].out}. What happens to R3's slot after it finishes?`
          : undefined,
      step: s,
      reqs: view(),
      grid: grid.map((g) => [...g]),
      kvUsed: kvt.used,
      kvReserved: kvt.reserved,
      tokensThisStep: tokens,
      tokensTotal,
      joined,
      left,
    });
    if (joined.length) firstBatchFormed = true;
    if (reqs.every((r) => r.finish !== null)) break;
  }

  const steps = frames[frames.length - 1].step + 1;
  const ttft = reqs.map((r) => (r.start ?? steps) - r.arrive + 1);
  const avgTtft = ttft.reduce((a, b) => a + b, 0) / ttft.length;
  frames.push({
    caption: `Result: all ${reqs.length} answers (${tokensTotal} tokens) took ${steps} forward passes, ${(tokensTotal / steps).toFixed(1)} tokens per pass. Average time to first token: ${avgTtft.toFixed(1)} steps. ${
      scheduler === 'static' ? 'Static batches wait for their slowest member, so slots idle and the queue grows. ' : 'Continuous batching refills a slot the moment it frees. '
    }${kv === 'prealloc' ? `Pre-allocating ${MAX_TOKENS} tokens per request reserved far more KV than was used, which capped the batch.` : 'Paged KV wastes under one block per sequence, so more requests fit.'}`,
    step: steps,
    reqs: view(),
    grid: grid.map((g) => [...g]),
    kvUsed: 0,
    kvReserved: 0,
    tokensThisStep: 0,
    tokensTotal,
    joined: [],
    left: [],
  });
  return frames;
}
