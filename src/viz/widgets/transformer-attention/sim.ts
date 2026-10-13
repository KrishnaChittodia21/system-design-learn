// Pure, deterministic single-head self-attention on a 5-token sentence with toy 4-d vectors
// (no React, Node-testable). Every number is computed from the fixed matrices below:
//   X = token embedding + positional encoding
//   Q = X·W_Q, K = X·W_K, V = X·W_V
//   scores = Q·Kᵀ / √d_k   (d_k = 4)
//   causal mask (decoder): scores[i][j] = −∞ for j > i
//   weights = softmax(scores) row by row (each row sums to 1)
//   Z = weights·V
//   next-token logits = (x_i + z_i)·W_out (residual), p = softmax(logits / T)
import type { BaseFrame } from '../../core';

export type Model = 'decoder' | 'encoder';

export interface Params {
  query: number; // 0..4
  model: Model;
  temperature: number;
}

export const DEFAULT_PARAMS: Params = { query: 2, model: 'decoder', temperature: 1 };

export const TOKENS = ['the', 'cat', 'sat', 'on', 'the'];
export const LABELS = ['the₁', 'cat', 'sat', 'on', 'the₂'];
export const VOCAB = ['the', 'cat', 'sat', 'on', 'mat', 'dog'];
export const D = 4;

const r2 = (x: number) => Math.round(x * 100) / 100;
const EMB: Record<string, number[]> = {
  // toy features: [determiner, noun, verb, preposition]
  the: [1, 0, 0, 0],
  cat: [0, 1, 0, 0],
  sat: [0, 0.2, 1, 0],
  on: [0, 0, 0.3, 1],
};
/** small sinusoidal positional encoding so the two "the"s differ */
export const POS = TOKENS.map((_, i) => [0.1 * Math.sin(i), 0.1 * Math.cos(i), 0.1 * Math.sin(i / 2), 0.1 * Math.cos(i / 2)].map(r2));
export const X = TOKENS.map((t, i) => EMB[t].map((v, k) => r2(v + POS[i][k])));
// W_Q: what each kind of token looks for (verb → noun, preposition → verb, determiner → preposition, noun → determiner)
export const WQ = [
  [0, 0, 0, 3],
  [3, 0, 0, 0],
  [0, 3, 0, 0],
  [0, 0, 3, 0],
];
export const WK = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];
export const WV = [
  [1, 0, 0, 0.5],
  [0, 1, 0.5, 0],
  [0, 0.5, 1, 0],
  [0.5, 0, 0, 1],
];
export const WOUT = [
  [-1.8, 0.9, -0.8, -0.4, 1.4, 0.7],
  [-0.2, -0.7, 3.3, 1.8, -3.8, -0.4],
  [0.2, -2.1, -1.7, 1.7, 3, -1.1],
  [2.8, 1, 0, -2.6, -1.4, 0.2],
];

export const matmul = (A: number[][], B: number[][]) => A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
export const transpose = (A: number[][]) => A[0].map((_, j) => A.map((r) => r[j]));
export function softmax(xs: number[]): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => (x === -Infinity ? 0 : Math.exp(x - m)));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / z);
}

export const Q = matmul(X, WQ);
export const K = matmul(X, WK);
export const V = matmul(X, WV);
export const RAW = matmul(Q, transpose(K));
export const SCALED = RAW.map((r) => r.map((v) => v / Math.sqrt(D)));

export function attention(model: Model) {
  const masked = SCALED.map((r, i) => r.map((v, j) => (model === 'decoder' && j > i ? -Infinity : v)));
  const W = masked.map(softmax);
  const Z = matmul(W, V);
  const H = X.map((x, i) => x.map((v, k) => v + Z[i][k]));
  const logits = matmul(H, WOUT);
  return { masked, W, Z, H, logits };
}

export type Stage = 'intro' | 'embed' | 'q' | 'k' | 'v' | 'dot' | 'scale' | 'mask' | 'softmax' | 'heat' | 'sum' | 'logits' | 'temp' | 'done';

export interface Frame extends BaseFrame {
  stage: Stage;
  query: number;
  /** key currently being dotted (stage 'dot') */
  key: number | null;
  /** raw dot products computed so far for the query row (null = not yet) */
  raw: (number | null)[];
  /** weights of the query row once known */
  weights: number[] | null;
  masked: boolean[];
  probs: number[] | null;
  probsT: number[] | null;
}

const f2 = (x: number) => (Math.abs(x) < 0.005 ? '0.00' : x.toFixed(2));
const p2 = (x: number) => (x < -0.005 ? `(${f2(x)})` : f2(x));
const vec = (v: number[]) => `[${v.map(f2).join(', ')}]`;

export function simulate({ query: qi, model, temperature: T }: Params): Frame[] {
  const dec = model === 'decoder';
  const { W, logits } = attention(model);
  const masked = TOKENS.map((_, j) => dec && j > qi);
  const frames: Frame[] = [];
  const base = { query: qi, key: null, raw: TOKENS.map(() => null), weights: null, masked: TOKENS.map(() => false), probs: null, probsT: null };
  const push = (f: Partial<Frame> & { stage: Stage; caption: string }) => frames.push({ ...base, ...f } as Frame);
  const q = LABELS[qi];

  push({
    stage: 'intro',
    caption: `${dec ? 'Decoder (GPT-style)' : 'Encoder (BERT-style)'} self-attention over "the cat sat on the", one head, d_k = ${D}. We follow the query token "${q}": which other tokens should shape its meaning?`,
  });
  push({
    stage: 'embed',
    caption: `Each token becomes a vector x = token embedding + positional encoding. Toy features: [determiner, noun, verb, preposition]. the₁ ${vec(X[0])} and the₂ ${vec(X[4])} differ only through position.`,
  });
  push({ stage: 'q', caption: `Queries Q = X·W_Q: what each token is looking for. W_Q maps verb → noun, preposition → verb, determiner → preposition, noun → determiner. q(${q}) = ${vec(Q[qi])}.` });
  push({
    stage: 'k',
    caption: `Keys K = X·W_K: what each token offers to be matched on (W_K = identity here, so k = x). k(cat) = ${vec(K[1])}.`,
    predict: `q(${q}) = ${vec(Q[qi])}. Its large entries sit in the ${['determiner', 'noun', 'verb', 'preposition'][Q[qi].indexOf(Math.max(...Q[qi]))]} slot. Which token's key will give the biggest dot product?`,
  });
  push({ stage: 'v', caption: `Values V = X·W_V: the information a token hands over if attended to. v(${q}) = ${vec(V[qi])}.` });

  const raw: (number | null)[] = TOKENS.map(() => null);
  const order = TOKENS.map((_, j) => j);
  let best = 0;
  for (const j of order) {
    raw[j] = RAW[qi][j];
    if (RAW[qi][j] > RAW[qi][best]) best = j;
    push({
      stage: 'dot',
      key: j,
      raw: [...raw],
      caption: `q(${q}) · k(${LABELS[j]}) = ${Q[qi].map((a, k) => `${p2(a)}×${p2(K[j][k])}`).join(' + ')} = ${f2(RAW[qi][j])}.${dec && j > qi ? ` (${LABELS[j]} comes after ${q}: a decoder will mask it.)` : ''}`,
    });
  }
  const visible = order.filter((j) => !masked[j]);
  const bestVisible = visible.reduce((a, j) => (SCALED[qi][j] > SCALED[qi][a] ? j : a), visible[0]);
  push({
    stage: 'scale',
    raw: [...raw],
    caption: `Divide by √d_k = √${D} = 2: dot products grow with d, and unscaled they would saturate the softmax into a near one-hot. Scaled: [${SCALED[qi].map(f2).join(', ')}].`,
    predict: dec && qi < TOKENS.length - 1 ? `This is a decoder. What must happen to the scores for ${LABELS.slice(qi + 1).join(', ')} before the softmax?` : `Which token will "${q}" attend to most after the softmax, and roughly with what weight?`,
  });
  if (dec)
    push({
      stage: 'mask',
      raw: [...raw],
      masked,
      caption:
        qi < TOKENS.length - 1
          ? `Causal mask: scores for future tokens (${LABELS.slice(qi + 1).join(', ')}) become −∞, so after the softmax they get weight exactly 0. During generation those tokens do not exist yet.`
          : `Causal mask: "${q}" is the last token, so nothing is masked: it may attend to every earlier token and itself.`,
    });
  const w = W[qi];
  const sum = w.reduce((a, b) => a + b, 0);
  push({
    stage: 'softmax',
    raw: [...raw],
    masked,
    weights: w,
    caption: `softmax turns the row into weights: [${w.map(f2).join(', ')}], sum = ${sum.toFixed(2)}. "${q}" attends most to ${LABELS[bestVisible]} (${(w[bestVisible] * 100).toFixed(0)}%).`,
  });
  push({
    stage: 'heat',
    raw: [...raw],
    masked,
    weights: w,
    caption: dec
      ? `Every token does the same in parallel. The full weight matrix is lower-triangular: row i only spreads over tokens 1…i. Each row still sums to 1.`
      : `Every token does the same in parallel. With no mask each row spreads over all 5 tokens, including later ones (the₁ looks ahead to "on"). Each row sums to 1.`,
  });
  const z = matmul([w], V)[0];
  const top = order.filter((j) => w[j] > 0.005).sort((a, b) => w[b] - w[a]);
  push({
    stage: 'sum',
    raw: [...raw],
    masked,
    weights: w,
    caption: `Output z(${q}) = Σ wⱼ·vⱼ = ${top
      .slice(0, 3)
      .map((j) => `${f2(w[j])}·v(${LABELS[j]})`)
      .join(' + ')}${top.length > 3 ? ' + …' : ''} = ${vec(z)}: "${q}" now carries information from ${LABELS[top[0]]}.`,
    predict: dec ? `z goes into the next-token prediction. Which word should follow "${TOKENS.slice(0, qi + 1).join(' ')}"?` : undefined,
  });

  if (dec) {
    const probs = softmax(logits[qi]);
    const probsT = softmax(logits[qi].map((l) => l / T));
    const arg = probs.indexOf(Math.max(...probs));
    const sameThe = qi === 0 || qi === 4;
    push({
      stage: 'logits',
      raw: [...raw],
      masked,
      weights: w,
      probs,
      caption: `Next-token logits = (x + z)·W_out (residual), softmax at T = 1: "${VOCAB[arg]}" ${(probs[arg] * 100).toFixed(0)}%.${
        sameThe ? ` Same word "the" as ${qi === 0 ? 'the₂' : 'the₁'}, different prediction: attention to the context made the difference.` : ''
      }`,
      predict: `Temperature divides the logits before the softmax. At T = ${T}, what happens to the top word's probability, and to the unlikely words?`,
    });
    const argT = probsT.indexOf(Math.max(...probsT));
    push({
      stage: 'temp',
      raw: [...raw],
      masked,
      weights: w,
      probs,
      probsT,
      caption:
        T === 1
          ? `At T = 1 the distribution is unchanged: "${VOCAB[argT]}" ${(probsT[argT] * 100).toFixed(0)}%. Move the temperature slider: T < 1 sharpens toward greedy decoding, T > 1 flattens toward random.`
          : `softmax(logits / ${T}): "${VOCAB[argT]}" goes from ${(probs[argT] * 100).toFixed(0)}% to ${(probsT[argT] * 100).toFixed(0)}%. ${T < 1 ? 'Lower T sharpens the distribution (more deterministic).' : 'Higher T flattens it: unlikely words get sampled more often.'} The ranking never changes, only the spread.`,
    });
  }
  push({
    stage: 'done',
    raw: [...raw],
    masked,
    weights: w,
    probs: dec ? softmax(logits[qi]) : null,
    probsT: dec ? softmax(logits[qi].map((l) => l / T)) : null,
    caption: dec
      ? `Recap: attention(Q,K,V) = softmax(QKᵀ/√d_k + mask)·V. Real models stack ~dozens of layers × many heads with d = 64–128 per head; the KV cache stores K and V of past tokens so each new token costs one row, not a recompute.`
      : `Recap: an encoder sees the whole sentence in both directions, which is ideal for understanding (classification, embeddings, retrieval) but cannot generate left-to-right; switch to the decoder to see the mask and next-token step.`,
  });
  return frames;
}
