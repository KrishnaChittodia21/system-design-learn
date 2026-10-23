// Pure model of one request crossing the edge stack: client → CDN → WAF → load balancer →
// API gateway → BFF → services. Each layer can be switched off to see what it was buying.
import type { BaseFrame } from '../../core';

export type Layer = 'cdn' | 'waf' | 'lb' | 'gw' | 'bff';
export const LAYERS: Layer[] = ['cdn', 'waf', 'lb', 'gw', 'bff'];
export type Node = 'client' | Layer | 'svc';
export const NODES: Node[] = ['client', 'cdn', 'waf', 'lb', 'gw', 'bff', 'svc'];
export const NODE_NAME: Record<Node, string> = {
  client: 'Mobile client',
  cdn: 'CDN PoP',
  waf: 'WAF',
  lb: 'Load balancer',
  gw: 'API gateway',
  bff: 'Mobile BFF',
  svc: 'Services',
};

export type Scenario = 'static' | 'home' | 'sqli' | 'badtoken' | 'burst';
export const SCENARIO_NAME: Record<Scenario, string> = {
  static: 'GET /assets/app.js',
  home: 'GET /home (signed in)',
  sqli: "GET /search?q=' OR '1'='1",
  badtoken: 'GET /orders, expired JWT',
  burst: '101st req/s from one key',
};

/** latency model (ms) */
export const RTT_REGION = 120; // phone ↔ origin region (mobile network)
export const RTT_POP = 20; // phone ↔ nearby CDN PoP
export const POP_TO_ORIGIN = 100; // PoP ↔ origin over a warm keep-alive connection
export const RATE_LIMIT = 100; // requests per second per API key
export const SERVICE_MS: Record<string, number> = { user: 15, cart: 20, recs: 40, search: 30, orders: 25, static: 2 };

export interface Params {
  scenario: Scenario;
  on: Record<Layer, boolean>;
}

export const DEFAULT_PARAMS: Params = { scenario: 'home', on: { cdn: true, waf: true, lb: true, gw: true, bff: true } };

export type Verdict = 'start' | 'pass' | 'hit' | 'block' | 'served' | 'risk';

export interface Hop {
  node: Node;
  verdict: Verdict;
  /** what this layer did */
  note: string;
  /** time this hop added, ms */
  ms: number;
}

export interface Frame extends BaseFrame {
  hops: Hop[];
  at: Node;
  done: boolean;
  totalMs: number;
  status?: number;
  /** bytes returned to the phone */
  bytes?: number;
  /** how many separate requests the phone made */
  phoneRequests: number;
  /** did anything reach application services? */
  reachedOrigin: boolean;
}

function verdictCaption(h: Hop) {
  return `${NODE_NAME[h.node]}: ${h.note}${h.ms ? ` (+${h.ms} ms)` : ''}`;
}

export function simulate(p: Params): Frame[] {
  const { scenario, on } = p;
  const hops: Hop[] = [];
  const frames: Frame[] = [];
  let total = 0;
  let phoneRequests = 1;
  let reachedOrigin = false;
  const push = (h: Hop, extra: Partial<Frame> = {}, predict?: string) => {
    hops.push(h);
    total += h.ms;
    frames.push({
      hops: [...hops],
      at: h.node,
      done: false,
      totalMs: Math.round(total),
      phoneRequests,
      reachedOrigin,
      caption: verdictCaption(h),
      predict,
      ...extra,
    });
  };
  const finish = (status: number, bytes: number, summary: string) => {
    const last = frames[frames.length - 1];
    last.done = true;
    last.status = status;
    last.bytes = bytes;
    last.totalMs = Math.round(total);
    last.caption = `${last.caption} → ${status}. ${summary} Total ≈ ${Math.round(total)} ms${phoneRequests > 1 ? ` across ${phoneRequests} phone requests` : ''}.`;
    return frames;
  };

  // --- client: connection setup to whoever terminates TLS first
  const edgeRtt = on.cdn ? RTT_POP : RTT_REGION;
  const terminator = on.cdn ? 'the nearby CDN PoP' : on.lb ? 'the regional load balancer' : on.gw ? 'the gateway' : 'the service';
  push(
    { node: 'client', verdict: 'start', note: `TCP + TLS 1.3 handshake with ${terminator} (2 × ${edgeRtt} ms RTT), then the request (1 RTT)`, ms: 3 * edgeRtt },
    {},
    scenario === 'sqli' ? 'This query string is an injection attempt. Which layer should reject it, and what happens if that layer is switched off?' : undefined,
  );
  frames[0].caption = `${SCENARIO_NAME[scenario]}: the phone opens a connection. ${on.cdn ? `TLS terminates at a PoP ${RTT_POP} ms away, so the handshake costs ${2 * RTT_POP} ms instead of ${2 * RTT_REGION} ms.` : `With no CDN, TLS terminates in the region ${RTT_REGION} ms away: ${2 * RTT_REGION} ms of handshakes before the first byte.`}`;

  // --- CDN
  if (on.cdn) {
    if (scenario === 'static') {
      push({ node: 'cdn', verdict: 'hit', note: 'cache HIT for a content-hashed, immutable URL; served from the PoP', ms: 1 });
      return finish(200, 180_000, 'The origin never saw this request.');
    }
    push({
      node: 'cdn',
      verdict: 'pass',
      note: `${scenario === 'home' || scenario === 'badtoken' ? 'MISS: personalised (Authorization header), not cacheable' : 'MISS: dynamic request'}; forwarded over a warm keep-alive connection to the origin (${POP_TO_ORIGIN} ms RTT)`,
      ms: POP_TO_ORIGIN,
    });
  }

  // --- WAF
  if (on.waf) {
    if (scenario === 'sqli') {
      push({ node: 'waf', verdict: 'block', note: 'OWASP rule matches SQL injection in the query string; blocked', ms: 1 });
      return finish(403, 200, 'Rejected cheaply before any application code ran.');
    }
    push({ node: 'waf', verdict: 'pass', note: 'OWASP rules, bot and geo checks pass', ms: 1 });
  }

  // --- LB
  if (on.lb) push({ node: 'lb', verdict: 'pass', note: 'picks a healthy gateway instance (health-checked pool)', ms: 0.5 });

  // --- gateway
  if (on.gw) {
    if (scenario === 'badtoken') {
      push({ node: 'gw', verdict: 'block', note: 'JWT signature checked against cached JWKS in µs: token expired', ms: 1 });
      return finish(401, 300, 'Authentication is enforced once, at the gateway, for every service behind it.');
    }
    if (scenario === 'burst') {
      push({ node: 'gw', verdict: 'block', note: `token bucket for this API key is empty (${RATE_LIMIT} req/s, global counter in Redis +0.5 ms)`, ms: 1.5 });
      return finish(429, 300, 'Retry-After tells the client when to come back; the services never feel the burst.');
    }
    const route = scenario === 'home' ? (on.bff ? '/home → mobile BFF' : '/home → no BFF: the client must call user, cart and recs itself') : scenario === 'static' ? '/assets → static origin' : scenario === 'sqli' ? '/search → search service (the gateway does not parse payloads)' : '/orders → orders service';
    push({
      node: 'gw',
      verdict: scenario === 'sqli' ? 'risk' : 'pass',
      note: `JWT valid; strips client-supplied X-User-Id, sets the verified one, adds X-Request-Id + traceparent; routes ${route}`,
      ms: 1,
    });
  }

  // --- BFF / services
  if (scenario === 'home') {
    if (on.bff) {
      reachedOrigin = true;
      push({ node: 'bff', verdict: 'pass', note: 'fans out in parallel to user, cart and recs (each with a timeout, 300 ms total deadline)', ms: 1 });
      push({ node: 'svc', verdict: 'served', note: `user ${SERVICE_MS.user} ms ‖ cart ${SERVICE_MS.cart} ms ‖ recs ${SERVICE_MS.recs} ms → waits for the slowest; trims 40 KB to 3 KB`, ms: SERVICE_MS.recs });
      return finish(200, 3_000, 'One round trip for the phone, all fan-out inside the data centre.');
    }
    reachedOrigin = true;
    phoneRequests = 3;
    // a second round trip on the already-open connection: one RTT plus the same proxy hops
    const perCall = edgeRtt + (on.cdn ? POP_TO_ORIGIN : 0) + (on.waf ? 1 : 0) + (on.lb ? 0.5 : 0) + (on.gw ? 1 : 0);
    push({
      node: 'svc',
      verdict: 'served',
      note: `user ${SERVICE_MS.user} ms; then the phone needs a second round trip (≈${Math.round(perCall)} ms) for cart ‖ recs (${SERVICE_MS.recs} ms) because they need the user first`,
      ms: SERVICE_MS.user + perCall + SERVICE_MS.recs,
    });
    frames[frames.length - 1].phoneRequests = 3;
    return finish(200, 40_000, 'Without a BFF the phone makes 3 calls over the slow mobile link, in two sequential rounds, and downloads untrimmed payloads.');
  }

  reachedOrigin = true;
  if (scenario === 'static') {
    push({ node: 'svc', verdict: 'served', note: 'static origin reads the file and returns it', ms: SERVICE_MS.static });
    return finish(200, 180_000, 'Every user worldwide now pays the full trip to the origin, and the origin pays all the egress.');
  }
  if (scenario === 'sqli') {
    push({ node: 'svc', verdict: 'risk', note: 'search service receives the injection payload', ms: SERVICE_MS.search });
    return finish(200, 8_000, 'Only parameterised queries in the service stand between this string and the database.');
  }
  if (scenario === 'badtoken') {
    push({ node: 'svc', verdict: 'block', note: 'the orders service has to validate the JWT itself (and so do the other 39 services, in 4 languages)', ms: 2 });
    return finish(401, 300, 'Rejected, but only because this service remembered to check.');
  }
  // burst, gateway off
  push({ node: 'svc', verdict: 'risk', note: `the ${RATE_LIMIT + 1}st request this second is served; nothing limits one noisy key`, ms: SERVICE_MS.orders });
  return finish(200, 2_000, 'One client can now take the database down for everyone.');
}
