// Pure model of a sidecar service mesh: service A (app + sidecar) calling three pods of service B,
// with a control plane (istiod) pushing config and certificates. Five scenarios, each a list of frames.
import { rng, type BaseFrame } from '../../core';

export type Mode = 'mtls' | 'retries' | 'canary' | 'outlier' | 'cpdown';
export const MODE_NAME: Record<Mode, string> = {
  mtls: 'mTLS + identity',
  retries: 'Retries & timeouts',
  canary: 'Canary split',
  outlier: 'Outlier ejection',
  cpdown: 'Control plane down',
};
export type Caller = 'meshed' | 'legacy';
export type PeerAuth = 'PERMISSIVE' | 'STRICT';
export type RetryLayers = 'mesh' | 'app' | 'gateway';

export interface Params {
  mode: Mode;
  caller: Caller;
  peerAuth: PeerAuth;
  retryLayers: RetryLayers;
  /** canary weight for v2, percent */
  weight: number;
}

export const DEFAULT_PARAMS: Params = { mode: 'mtls', caller: 'meshed', peerAuth: 'STRICT', retryLayers: 'mesh', weight: 10 };

export const MESH_ATTEMPTS = 3; // Istio default: 1 try + 2 retries
export const CONSECUTIVE_5XX = 3;
export const BASE_EJECTION_S = 30;
export const MAX_EJECTION_PCT = 50;
export const CANARY_REQUESTS = 40;

export type PodState = 'ok' | 'failing' | 'ejected' | 'unready' | 'dead' | 'absent';
export interface Pod {
  label: string;
  version: 'v1' | 'v2';
  state: PodState;
  /** requests this pod has received in the scenario so far */
  got: number;
  /** consecutive 5xx observed by A's sidecar */
  errs?: number;
}

export type FlowKind = 'ok' | 'fail' | 'mtls' | 'plain' | 'rejected';
export interface Flow {
  to: number;
  kind: FlowKind;
  label?: string;
}

export interface Frame extends BaseFrame {
  cp: 'up' | 'down';
  /** control plane is pushing config/certs to sidecars in this frame */
  push: boolean;
  callerSidecar: boolean;
  pods: Pod[];
  flows: Flow[];
  /** short config line shown in the caller sidecar */
  config: string;
  stats: [string, string][];
}

const basePods = (): Pod[] => [
  { label: 'B pod 1', version: 'v1', state: 'ok', got: 0 },
  { label: 'B pod 2', version: 'v1', state: 'ok', got: 0 },
  { label: 'B pod 3', version: 'v1', state: 'ok', got: 0 },
];
const clone = (pods: Pod[]) => pods.map((p) => ({ ...p }));

export const layersCount = (r: RetryLayers) => (r === 'mesh' ? 1 : r === 'app' ? 2 : 3);
export const amplification = (r: RetryLayers) => MESH_ATTEMPTS ** layersCount(r);

/** Deterministic weighted split, like Envoy's per-request random choice. */
export function canarySplit(weight: number, n = CANARY_REQUESTS, seed = 11): ('v1' | 'v2')[] {
  const r = rng(seed);
  return Array.from({ length: n }, () => (r() * 100 < weight ? 'v2' : 'v1'));
}

function mtls(p: Params): Frame[] {
  const legacy = p.caller === 'legacy';
  const fr: Frame[] = [];
  const pods = basePods();
  const f = (o: Partial<Frame> & { caption: string }): Frame => ({
    cp: 'up',
    push: false,
    callerSidecar: !legacy,
    pods: clone(pods),
    flows: [],
    config: `PeerAuthentication: ${p.peerAuth}`,
    stats: [],
    ...o,
  });
  fr.push(
    f({
      push: true,
      caption: `istiod streams config to every sidecar over xDS (listeners, routes, clusters, endpoints) and issues each workload a short-lived cert via SDS: spiffe://cluster.local/ns/shop/sa/a, valid 24 h, rotated automatically.`,
      stats: [['cert TTL', '24 h'], ['identity', 'service account']],
    }),
  );
  if (!legacy) {
    fr.push(
      f({
        caption: `App A calls http://b:8080 in plain HTTP. iptables rules installed at pod start redirect the outbound connection to A’s sidecar on :15001. The app knows nothing about TLS.`,
        predict: 'Who encrypts the call, and how does B know the caller really is A?',
      }),
    );
    pods[0].got++;
    fr.push(
      f({
        flows: [{ to: 0, kind: 'mtls', label: 'mTLS' }],
        caption: `A’s sidecar picks a B endpoint (EDS + load-balancing), applies the route’s timeout and retry policy, and opens mutual TLS: it presents A’s SPIFFE cert and verifies B’s. Both sides are authenticated and the bytes are encrypted.`,
        stats: [['encrypted', 'yes'], ['caller identity', 'sa/a (verified)']],
      }),
    );
    fr.push(
      f({
        flows: [{ to: 0, kind: 'ok', label: '200' }],
        caption: `B’s sidecar terminates mTLS, checks AuthorizationPolicy (allow sa/a → B), records metrics and forwards to B on localhost. The response returns the same way. Two proxies per hop: well under 1 ms at p50, about 1–3 ms at p99 under load.`,
        stats: [['encrypted', 'yes'], ['authz by', 'identity, not IP'], ['proxies per hop', '2']],
      }),
    );
    return fr;
  }
  fr.push(
    f({
      caption: `This caller is a legacy VM with no sidecar. It connects straight to B’s pod in plaintext: no certificate, no SPIFFE identity.`,
      predict: `B is set to ${p.peerAuth}. Does the request get in?`,
    }),
  );
  if (p.peerAuth === 'PERMISSIVE') {
    pods[0].got++;
    fr.push(
      f({
        flows: [{ to: 0, kind: 'plain', label: 'plaintext' }],
        caption: `PERMISSIVE accepts both mTLS and plaintext, so the call succeeds, but unencrypted and with no identity: identity-based AuthorizationPolicy cannot allow or deny it. This mode exists for migration only.`,
        stats: [['encrypted', 'no'], ['caller identity', 'none']],
      }),
    );
    fr.push(
      f({
        flows: [{ to: 0, kind: 'plain', label: 'plaintext' }],
        caption: `Safe rollout: PERMISSIVE everywhere → watch telemetry until every caller uses mTLS → switch to STRICT namespace by namespace. Flipping early breaks callers like this one (and Prometheus scrapes, jobs without sidecars).`,
        stats: [['encrypted', 'no'], ['next step', 'mesh the VM, then STRICT']],
      }),
    );
  } else {
    fr.push(
      f({
        flows: [{ to: 0, kind: 'rejected', label: 'reset' }],
        caption: `STRICT accepts mTLS only: B’s sidecar rejects the plaintext handshake and the VM sees a connection reset. Correct security, but if you flipped to STRICT before checking telemetry, you just caused an outage for every non-mesh caller.`,
        stats: [['encrypted', 'n/a'], ['result', 'connection reset']],
      }),
    );
  }
  return fr;
}

function retries(p: Params): Frame[] {
  const fr: Frame[] = [];
  const pods = basePods();
  const layers = layersCount(p.retryLayers);
  const amp = amplification(p.retryLayers);
  const f = (o: Partial<Frame> & { caption: string }): Frame => ({
    cp: 'up',
    push: false,
    callerSidecar: true,
    pods: clone(pods),
    flows: [],
    config: `attempts ${MESH_ATTEMPTS} · perTry 1s · timeout 3s`,
    stats: [],
    ...o,
  });
  fr.push(
    f({
      push: true,
      caption: `A VirtualService sets the route policy in the caller’s sidecar: timeout 3 s total, perTryTimeout 1 s, retry on connect-failure, refused-stream and 503 (Istio’s default is 2 retries). Budgets must shrink down the call chain.`,
    }),
  );
  pods[1].state = 'failing';
  pods[1].got++;
  fr.push(
    f({
      flows: [{ to: 1, kind: 'fail', label: '503' }],
      caption: `Attempt 1 goes to pod 2, which is restarting and answers 503.`,
      predict: 'Does app A ever see this 503?',
    }),
  );
  pods[0].got++;
  fr.push(
    f({
      flows: [
        { to: 1, kind: 'fail', label: '503' },
        { to: 0, kind: 'ok', label: 'retry → 200' },
      ],
      caption: `The sidecar retries on a different endpoint, pod 1, and gets 200. App A sees one successful call that took a little longer. Retrying in the layer closest to the failure is exactly what the mesh is for.`,
      stats: [['attempts', '2'], ['app saw', '200']],
    }),
  );
  for (const pod of pods) pod.state = 'failing';
  const who = p.retryLayers === 'mesh' ? 'only the mesh retries' : p.retryLayers === 'app' ? 'the app retries 3× and the mesh retries 3×' : 'the gateway, the app and the mesh each retry 3×';
  fr.push(
    f({
      flows: [0, 1, 2].map((to) => ({ to, kind: 'fail' as const, label: '503' })),
      caption: `Now B is overloaded and every pod answers 503. Here ${who}.`,
      predict: `How many requests does B receive for one user click?`,
    }),
  );
  pods.forEach((pod, i) => (pod.got += Math.floor(amp / 3) + (i < amp % 3 ? 1 : 0)));
  fr.push(
    f({
      flows: [0, 1, 2].map((to) => ({ to, kind: 'fail' as const, label: '503' })),
      caption: `${MESH_ATTEMPTS}${layers > 1 ? ` × ${MESH_ATTEMPTS}`.repeat(layers - 1) : ''} = ${amp} requests hit the struggling service for one click${amp > 3 ? ': retries in every layer turn a slowdown into a retry storm' : ': bounded, and the mesh can enforce a retry budget (e.g. ≤ 20% extra load)'}. Retry in exactly one layer, only idempotent calls, only on connection failures and 503.`,
      stats: [['layers retrying', String(layers)], ['requests per click', String(amp)]],
    }),
  );
  return fr;
}

function canary(p: Params): Frame[] {
  const fr: Frame[] = [];
  const pods = basePods();
  pods[2].version = 'v2';
  pods[2].label = 'B v2 pod';
  const split = canarySplit(p.weight);
  const f = (o: Partial<Frame> & { caption: string }): Frame => ({
    cp: 'up',
    push: false,
    callerSidecar: true,
    pods: clone(pods),
    flows: [],
    config: `route: v1 ${100 - p.weight}% · v2 ${p.weight}%`,
    stats: [],
    ...o,
  });
  fr.push(
    f({
      push: true,
      caption: `v2 is deployed but receives nothing until istiod pushes a route with weights v1 ${100 - p.weight}% / v2 ${p.weight}%. Deploy and release are now separate steps.`,
      predict: p.weight > 0 ? `Out of ${CANARY_REQUESTS} requests, how many land on v2, and is that exactly ${(CANARY_REQUESTS * p.weight) / 100}?` : undefined,
    }),
  );
  let v1 = 0;
  let v2 = 0;
  const batch = CANARY_REQUESTS / 4;
  for (let b = 0; b < 4; b++) {
    const part = split.slice(b * batch, (b + 1) * batch);
    for (const v of part) {
      if (v === 'v2') {
        v2++;
        pods[2].got++;
      } else {
        // v1 pods share v1 traffic round-robin
        pods[v1 % 2].got++;
        v1++;
      }
    }
    const flows: Flow[] = [];
    if (part.includes('v1')) flows.push({ to: 0, kind: 'ok' }, { to: 1, kind: 'ok' });
    if (part.includes('v2')) flows.push({ to: 2, kind: 'ok', label: 'v2' });
    fr.push(
      f({
        flows,
        caption: `Requests ${b * batch + 1}–${(b + 1) * batch}: each one is an independent weighted choice in A’s sidecar, so the split is ${v2} of ${v1 + v2} to v2 (${Math.round((100 * v2) / (v1 + v2))}%), not exactly ${p.weight}%.`,
        stats: [['v1', String(v1)], ['v2', String(v2)], ['v2 share', `${Math.round((100 * v2) / (v1 + v2))}%`]],
      }),
    );
  }
  pods[2].got++;
  fr.push(
    f({
      flows: [{ to: 2, kind: 'ok', label: 'x-canary: true' }],
      config: `x-canary: true → v2 · else ${100 - p.weight}/${p.weight}`,
      caption: `A header match routes employees (x-canary: true) to v2 every time: dogfooding before customers. Small traffic gives noisy metrics (1% of 50 RPS is one request every 2 s), so tools like Flagger or Argo Rollouts step the weight and roll back automatically by setting v2 to 0%.`,
      stats: [['v1', String(v1)], ['v2', String(v2 + 1)], ['rollback', 'weight → 0, seconds']],
    }),
  );
  return fr;
}

function outlier(): Frame[] {
  const fr: Frame[] = [];
  const pods = basePods();
  let failedCalls = 0;
  const f = (o: Partial<Frame> & { caption: string }): Frame => ({
    cp: 'up',
    push: false,
    callerSidecar: true,
    pods: clone(pods),
    flows: [],
    config: `outlier: ${CONSECUTIVE_5XX}×5xx → eject ${BASE_EJECTION_S}s · max ${MAX_EJECTION_PCT}%`,
    stats: [],
    ...o,
  });
  fr.push(
    f({
      push: true,
      caption: `A DestinationRule turns on outlier detection in every caller’s sidecar: eject a host after ${CONSECUTIVE_5XX} consecutive 5xx, for ${BASE_EJECTION_S} s (longer each time), never more than ${MAX_EJECTION_PCT}% of the pool. Pod 3 has just gone bad.`,
    }),
  );
  pods[2].state = 'failing';
  pods[2].errs = 0;
  for (let round = 1; round <= CONSECUTIVE_5XX; round++) {
    pods.forEach((pod) => pod.got++);
    pods[2].errs = round;
    failedCalls++;
    const ejected = round === CONSECUTIVE_5XX;
    if (ejected) pods[2].state = 'ejected';
    fr.push(
      f({
        flows: [
          { to: 0, kind: 'ok' },
          { to: 1, kind: 'ok' },
          { to: 2, kind: 'fail', label: ejected ? 'ejected' : `5xx #${round}` },
        ],
        caption: ejected
          ? `Third 5xx in a row from pod 3: A’s sidecar ejects it from its load-balancing pool for ${BASE_EJECTION_S} s. No central decision, no app code: each caller’s proxy does this locally.`
          : `Round-robin round ${round}: pods 1 and 2 answer 200, pod 3 answers 5xx (${round} in a row).`,
        predict: round === 1 ? `How many more failures before pod 3 stops getting traffic?` : undefined,
        stats: [['failed calls', String(failedCalls)], ['pod 3 streak', String(round)]],
      }),
    );
  }
  pods[0].got += 3;
  pods[1].got += 3;
  fr.push(
    f({
      flows: [
        { to: 0, kind: 'ok' },
        { to: 1, kind: 'ok' },
      ],
      caption: `For the next ${BASE_EJECTION_S} s all traffic goes to pods 1 and 2: zero errors. The mesh fails fast and routes around; the fallback (e.g. a generic schedule) is still app logic.`,
      stats: [['failed calls', String(failedCalls)], ['pool', '2 of 3']],
    }),
  );
  pods[2].state = 'failing';
  pods[2].got++;
  failedCalls++;
  fr.push(
    f({
      flows: [{ to: 2, kind: 'fail', label: 'probe 5xx' }],
      caption: `After ${BASE_EJECTION_S} s pod 3 is let back in, fails again, and is ejected for ${2 * BASE_EJECTION_S} s: ejection time grows with each repeat.`,
      stats: [['failed calls', String(failedCalls)], ['next ejection', `${2 * BASE_EJECTION_S} s`]],
    }),
  );
  pods[2].state = 'ejected';
  pods[1].state = 'failing';
  pods[1].errs = CONSECUTIVE_5XX;
  fr.push(
    f({
      flows: [
        { to: 0, kind: 'ok' },
        { to: 1, kind: 'fail', label: 'kept in pool' },
      ],
      caption: `Now pod 2 also fails. Ejecting it would leave 1 of 3 hosts (67% ejected > ${MAX_EJECTION_PCT}%), so it stays in the pool. maxEjectionPercent stops a bad day from ejecting the whole service.`,
      stats: [['ejected', '1 of 3'], ['cap', `${MAX_EJECTION_PCT}%`]],
    }),
  );
  return fr;
}

function cpdown(): Frame[] {
  const fr: Frame[] = [];
  const pods = basePods();
  pods[2] = { label: '(no pod yet)', version: 'v1', state: 'absent', got: 0 };
  const f = (o: Partial<Frame> & { caption: string }): Frame => ({
    cp: 'up',
    push: false,
    callerSidecar: true,
    pods: clone(pods),
    flows: [],
    config: 'endpoints: pod 1, pod 2',
    stats: [],
    ...o,
  });
  fr.push(f({ push: true, caption: `istiod is healthy and has pushed endpoints (pod 1, pod 2), routes and certs to every sidecar.` }));
  pods[0].got++;
  fr.push(
    f({
      cp: 'down',
      flows: [{ to: 0, kind: 'ok', label: 'last-known config' }],
      caption: `istiod crashes. Nothing breaks yet: the data plane keeps serving with its last-known config and existing certs. Like planes in the air when air-traffic control goes quiet.`,
      predict: 'The autoscaler adds a third B pod now. Does it get traffic?',
    }),
  );
  pods[2] = { label: 'B pod 3 (new)', version: 'v1', state: 'unready', got: 0 };
  fr.push(
    f({
      cp: 'down',
      flows: [{ to: 0, kind: 'ok' }, { to: 1, kind: 'ok' }],
      caption: `The new pod’s sidecar gets no config and no certificate, so it never becomes ready, and A’s endpoint list never learns it exists. Scaling out silently does nothing.`,
      stats: [['new pods ready', '0'], ['endpoint updates', 'frozen']],
    }),
  );
  pods[1].state = 'dead';
  fr.push(
    f({
      cp: 'down',
      flows: [{ to: 1, kind: 'fail', label: 'stale endpoint' }],
      caption: `Pod 2 dies. The endpoint removal cannot propagate, so A’s sidecar keeps sending to it until outlier detection or connection failures route around it. Every change to the fleet is stuck until istiod returns.`,
      stats: [['endpoint updates', 'frozen'], ['cert expiry', 'in ≤ 24 h']],
    }),
  );
  fr.push(
    f({
      cp: 'down',
      flows: [{ to: 0, kind: 'rejected', label: 'cert expired' }],
      caption: `If istiod stays down past the workload cert lifetime (24 h by default), certs expire and mTLS fails mesh-wide. The control plane issues identities: run it HA, secure it, and alert on push errors and latency.`,
      stats: [['mTLS', 'failing'], ['lesson', 'HA control plane']],
    }),
  );
  return fr;
}

export function simulate(p: Params): Frame[] {
  switch (p.mode) {
    case 'mtls':
      return mtls(p);
    case 'retries':
      return retries(p);
    case 'canary':
      return canary(p);
    case 'outlier':
      return outlier();
    case 'cpdown':
      return cpdown();
  }
}
