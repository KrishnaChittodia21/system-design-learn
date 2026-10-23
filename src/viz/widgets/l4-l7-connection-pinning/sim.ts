// Pure tick model of L4 (per-connection) vs L7 (per-request) load balancing for clients that
// send uneven traffic, with a scale-out event in the middle.
//   L4 + HTTP/2: each client's single long-lived connection is pinned to one pod.
//   L4 + HTTP/2 + max connection age: connections recycle, new ones go to the least-connected pod.
//   L4 + HTTP/1.1 (connection per request): balanced, but every request pays a TCP+TLS handshake.
//   L7: the proxy terminates connections and balances every request / HTTP/2 stream.
import type { BaseFrame } from '../../core';

export type Layer = 'l4' | 'l7';
export type Conn = 'h2' | 'h2age' | 'h1';

export interface Params {
  layer: Layer;
  conn: Conn;
}

export const CLIENTS = [260, 140, 120, 100, 50, 30];
export const POD_CAP = 200;
/** HTTP/1.1 with a new TLS connection per request burns ~15% of a pod's CPU on handshakes */
export const H1_CAP = 170;
export const START_PODS = 4;
export const SCALE_AT = 4;
export const END_PODS = 6;
export const MAX_AGE = 4;
export const TICKS = 12;
export const TOTAL = CLIENTS.reduce((a, b) => a + b, 0);

export interface Frame extends BaseFrame {
  tick: number;
  pods: number;
  cap: number;
  /** requests/s per pod */
  load: number[];
  /** connections per pod (L4 views) */
  conns: number[];
  /** client index → pod index (L4 long-lived) or null when balanced per request */
  pin: (number | null)[];
  /** clients that (re)connected this tick */
  reconnected: number[];
  errors: number;
  errorHistory: number[];
}

export function simulate({ layer, conn }: Params): Frame[] {
  const perRequest = layer === 'l7' || conn === 'h1';
  const cap = layer === 'l4' && conn === 'h1' ? H1_CAP : POD_CAP;
  const pin: (number | null)[] = CLIENTS.map(() => null);
  const errorHistory: number[] = [];
  const frames: Frame[] = [];
  const mode =
    layer === 'l7'
      ? `An L7 proxy terminates every client connection, parses each request (or HTTP/2 stream) and picks the least-loaded pod per request — so how clients hold their connections (${conn === 'h1' ? 'one per request' : 'long-lived HTTP/2'}) no longer decides placement.`
      : conn === 'h1'
        ? `An L4 balancer forwards flows by 5-tuple. Clients open a new connection per request, so flows ≈ requests — but each pays a TCP + TLS handshake, leaving ${H1_CAP} of ${POD_CAP} req/s per pod for real work.`
        : `An L4 balancer forwards flows by 5-tuple and never looks inside. Each gRPC client opens ONE long-lived HTTP/2 connection and multiplexes everything over it${conn === 'h2age' ? `; the server sets a max connection age of ${MAX_AGE} ticks so clients reconnect (staggered)` : ''}.`;
  frames.push({
    tick: -1,
    pods: START_PODS,
    cap,
    load: Array(START_PODS).fill(0),
    conns: Array(START_PODS).fill(0),
    pin: [...pin],
    reconnected: [],
    errors: 0,
    errorHistory: [],
    caption: `${CLIENTS.length} clients send ${TOTAL} req/s in total (${CLIENTS.join(', ')}) to ${START_PODS} pods of ${POD_CAP} req/s. ${mode} At t=${SCALE_AT} the autoscaler adds ${END_PODS - START_PODS} pods.`,
  });

  for (let t = 0; t < TICKS; t++) {
    const pods = t >= SCALE_AT ? END_PODS : START_PODS;
    const reconnected: number[] = [];
    const load = Array(pods).fill(0);
    const conns = Array(pods).fill(0);
    if (perRequest) {
      // fluid least-request: spread evenly
      for (let p = 0; p < pods; p++) load[p] = TOTAL / pods;
    } else {
      const countConns = () => {
        conns.fill(0);
        pin.forEach((p) => p !== null && conns[p]++);
      };
      CLIENTS.forEach((_, i) => {
        const due = pin[i] === null || (conn === 'h2age' && t > 0 && (t + i) % MAX_AGE === 0);
        if (!due) return;
        if (pin[i] === null) {
          // initial connect: L4 flow hashing ≈ round robin over the pods
          pin[i] = i % pods;
        } else {
          pin[i] = null;
          countConns();
          const loadNow = Array(pods).fill(0);
          pin.forEach((p, k) => p !== null && (loadNow[p] += CLIENTS[k]));
          let best = 0;
          for (let p = 1; p < pods; p++) if (conns[p] < conns[best] || (conns[p] === conns[best] && loadNow[p] < loadNow[best])) best = p;
          pin[i] = best;
        }
        reconnected.push(i);
      });
      countConns();
      pin.forEach((p, k) => p !== null && (load[p] += CLIENTS[k]));
    }
    const errors = load.reduce((s, l) => s + Math.max(0, l - cap), 0);
    errorHistory.push(errors);
    const hot = load.map((l, p) => ({ l, p })).filter((x) => x.l > cap);
    const idle = load.map((l, p) => ({ l, p })).filter((x) => x.l === 0);
    const avgUtil = TOTAL / (pods * cap);

    let caption = `t=${t}: `;
    if (t === SCALE_AT) caption += `Average utilisation was ${Math.round((TOTAL / (START_PODS * cap)) * 100)}%, so the autoscaler added pods ${START_PODS + 1}–${END_PODS}. `;
    if (reconnected.length && t > 0) caption += `Client${reconnected.length > 1 ? 's' : ''} ${reconnected.map((i) => `c${i + 1}`).join(', ')} hit max age and reconnect${reconnected.length > 1 ? '' : 's'} → least-connections pod ${reconnected.map((i) => `p${pin[i]! + 1}`).join(', ')}. `;
    if (perRequest) caption += `Every pod gets ${Math.round(TOTAL / pods)} req/s${errors ? ` — above the ${cap} it can serve, so ${Math.round(errors)} req/s fail` : ''}.`;
    else if (hot.length)
      caption += `${hot.map((x) => `p${x.p + 1} carries ${x.l} req/s`).join(', ')} (cap ${cap}) → ${errors} req/s fail, while ${idle.length ? `${idle.map((x) => `p${x.p + 1}`).join(', ')} sit${idle.length > 1 ? '' : 's'} idle` : `average utilisation is only ${Math.round(avgUtil * 100)}%`}.`;
    else caption += `No pod is over ${cap} req/s.${idle.length ? ` ${idle.map((x) => `p${x.p + 1}`).join(', ')} idle.` : ''}`;
    if (t === 0 && layer === 'l4' && conn !== 'h1') caption += ` c1 alone sends ${CLIENTS[0]} req/s down one connection: no L4 decision can split it.`;

    let predict: string | undefined;
    if (t === SCALE_AT - 1) predict = `Two new pods join next tick. Will ${layer === 'l7' ? 'they take traffic immediately' : 'the overloaded pod get relief'}?`;
    if (t === TICKS - 1) {
      const total = errorHistory.reduce((a, b) => a + b, 0);
      caption += ` Over ${TICKS} ticks: ${Math.round(total)} failed requests. ${
        layer === 'l7'
          ? 'L7 balances streams, so new pods help instantly; the price is TLS termination and ~1 ms per hop.'
          : conn === 'h2'
            ? 'Scaling out did nothing: the new pods have no connections. Use an L7 proxy (Envoy, ALB with gRPC) or client-side balancing over all pod IPs.'
            : conn === 'h2age'
              ? 'Max connection age reshuffles connections onto new pods, but a single hot connection still lands on one pod.'
              : 'Per-request connections balance well at L4, but handshakes waste capacity and add an RTT or two of latency.'
      }`;
    }
    frames.push({ tick: t, pods, cap, load, conns: [...conns], pin: perRequest ? CLIENTS.map(() => null) : [...pin], reconnected, errors, errorHistory: [...errorHistory], caption, predict });
  }
  return frames;
}
