// Pure model of an API validating a bearer JWT, check by check, against eight token scenarios.
// "naive" = a typical first implementation: algorithm taken from the token header, one static
// public key, only exp checked. "strict" = pinned algorithm, JWKS by kid with rate-limited refetch,
// iss + aud + exp/nbf with leeway. Authorization: route scope always; object ownership optional.
import type { BaseFrame } from '../../core';

export type Scenario = 'valid' | 'alg-none' | 'confusion' | 'expired' | 'wrong-aud' | 'new-kid' | 'scope' | 'bola';
export type Validator = 'naive' | 'strict';

export interface Params {
  scenario: Scenario;
  validator: Validator;
  ownership: boolean;
}

export type CheckId = 'parse' | 'alg' | 'key' | 'sig' | 'iss' | 'aud' | 'exp' | 'scope' | 'owner';
export type Status = 'pending' | 'pass' | 'fail' | 'skip' | 'fooled';

export interface Check {
  id: CheckId;
  label: string;
  status: Status;
  note: string;
}

export interface TokenLine {
  text: string;
  /** attacker-controlled or otherwise suspicious */
  hot?: boolean;
}

export interface Frame extends BaseFrame {
  checks: Check[];
  cur: number;
  token: { header: TokenLine[]; payload: TokenLine[]; sig: string; request: string };
  response: { code: number; text: string } | null;
  /** final judgement of the outcome */
  verdict: 'correct-allow' | 'correct-deny' | 'attack-succeeded' | 'legit-denied' | null;
}

export const NOW = 1_790_000_000;
const ISS = 'https://auth.example.com';

interface ScenarioSpec {
  label: string;
  legit: boolean;
  header: TokenLine[];
  payload: TokenLine[];
  sig: string;
  request: string;
  /** what each check concludes for this token: [strict, naive] — undefined means pass */
  outcome: Partial<Record<CheckId, { strict?: [Status, string]; naive?: [Status, string] }>>;
  /** expected correct answer */
  allow: boolean;
}

const baseHeader = (alg = 'RS256', kid = '2026-09-key-2'): TokenLine[] => [{ text: `"alg": "${alg}"` }, { text: `"kid": "${kid}"` }, { text: '"typ": "at+jwt"' }];
const basePayload = (o: { sub?: string; aud?: string; exp?: number; scope?: string } = {}): TokenLine[] => [
  { text: `"iss": "${ISS}"` },
  { text: `"sub": "${o.sub ?? 'user_42'}"` },
  { text: `"aud": "${o.aud ?? 'orders-api'}"` },
  { text: `"exp": now ${(o.exp ?? 600) >= 0 ? '+' : '−'} ${Math.abs(o.exp ?? 600)}s` },
  { text: `"scope": "${o.scope ?? 'orders:read'}"` },
];

export const SCENARIOS: Record<Scenario, ScenarioSpec> = {
  valid: {
    label: 'Valid token',
    legit: true,
    header: baseHeader(),
    payload: basePayload(),
    sig: 'RS256 signature by the auth server',
    request: 'GET /orders/1001 (owner user_42)',
    outcome: {},
    allow: true,
  },
  'alg-none': {
    label: 'alg: none',
    legit: false,
    header: [{ text: '"alg": "none"', hot: true }, { text: '"typ": "JWT"' }],
    payload: basePayload({ sub: 'admin' }).map((l) => (l.text.startsWith('"sub"') ? { ...l, hot: true } : l)),
    sig: '(empty — attacker stripped it)',
    request: 'GET /orders/1001',
    outcome: {
      alg: { strict: ['fail', '"none" is not in the allow-list [RS256]'], naive: ['fooled', 'library trusts the header: alg none = no signature needed'] },
      key: { naive: ['skip', 'no key needed for alg none'] },
      sig: { naive: ['fooled', 'nothing to verify → "valid"'] },
    },
    allow: false,
  },
  confusion: {
    label: 'RS256 → HS256 confusion',
    legit: false,
    header: [{ text: '"alg": "HS256"', hot: true }, { text: '"kid": "2026-09-key-2"' }],
    payload: basePayload({ sub: 'admin', scope: 'orders:read orders:write' }).map((l) => (l.text.startsWith('"sub"') || l.text.startsWith('"scope"') ? { ...l, hot: true } : l)),
    sig: 'HMAC keyed with the server’s PUBLIC key',
    request: 'GET /orders/1001',
    outcome: {
      alg: { strict: ['fail', 'HS256 not allowed; RS key objects cannot be used as HMAC secrets'], naive: ['fooled', 'header says HS256, so HMAC it is'] },
      sig: { naive: ['fooled', 'HMAC(public key PEM) matches — the public key is public!'] },
    },
    allow: false,
  },
  expired: {
    label: 'Expired token',
    legit: false,
    header: baseHeader(),
    payload: basePayload({ exp: -7200 }).map((l) => (l.text.startsWith('"exp"') ? { ...l, hot: true } : l)),
    sig: 'RS256 signature by the auth server',
    request: 'GET /orders/1001',
    outcome: {
      exp: { strict: ['fail', 'expired 2 h ago (leeway 60 s)'], naive: ['fail', 'expired — libraries check exp by default'] },
    },
    allow: false,
  },
  'wrong-aud': {
    label: 'Token for another API',
    legit: false,
    header: baseHeader(),
    payload: basePayload({ aud: 'billing-api' }).map((l) => (l.text.startsWith('"aud"') ? { ...l, hot: true } : l)),
    sig: 'RS256 signature by the auth server',
    request: 'GET /orders/1001',
    outcome: {
      aud: { strict: ['fail', 'aud is billing-api, we are orders-api'], naive: ['skip', 'not checked → token replayed from billing-api works'] },
      iss: { naive: ['skip', 'not checked'] },
    },
    allow: false,
  },
  'new-kid': {
    label: 'Key just rotated (new kid)',
    legit: true,
    header: baseHeader('RS256', '2026-10-key-3').map((l) => (l.text.startsWith('"kid"') ? { ...l, hot: true } : l)),
    payload: basePayload(),
    sig: 'RS256 signature with the NEW key',
    request: 'GET /orders/1001 (owner user_42)',
    outcome: {
      key: { strict: ['pass', 'kid unknown → refetch JWKS (≤ 1 per 30 s) → found'], naive: ['skip', 'ignores kid, uses the one key in config'] },
      sig: { naive: ['fail', 'old key cannot verify a token signed by the new key'] },
      iss: { naive: ['skip', 'not checked'] },
      aud: { naive: ['skip', 'not checked'] },
    },
    allow: true,
  },
  scope: {
    label: 'Missing scope',
    legit: false,
    header: baseHeader(),
    payload: basePayload(),
    sig: 'RS256 signature by the auth server',
    request: 'DELETE /orders/1001 (needs orders:write)',
    outcome: {
      scope: { strict: ['fail', 'needs orders:write, token has orders:read'], naive: ['fail', 'needs orders:write, token has orders:read'] },
    },
    allow: false,
  },
  bola: {
    label: 'Someone else’s object (BOLA)',
    legit: false,
    header: baseHeader(),
    payload: basePayload(),
    sig: 'RS256 signature by the auth server',
    request: 'GET /orders/1337 (owner user_99!)',
    outcome: {},
    allow: false,
  },
};

const LABELS: Record<CheckId, string> = {
  parse: 'parse 3 base64url parts',
  alg: 'algorithm',
  key: 'pick the key (kid → JWKS)',
  sig: 'verify signature',
  iss: 'issuer (iss)',
  aud: 'audience (aud)',
  exp: 'expiry (exp / nbf)',
  scope: 'route scope (AuthZ)',
  owner: 'object ownership (AuthZ)',
};
const ORDER: CheckId[] = ['parse', 'alg', 'key', 'sig', 'iss', 'aud', 'exp', 'scope', 'owner'];

export function simulate({ scenario, validator, ownership }: Params): Frame[] {
  const spec = SCENARIOS[scenario];
  const checks: Check[] = ORDER.map((id) => ({ id, label: LABELS[id], status: 'pending', note: '' }));
  const token = { header: spec.header, payload: spec.payload, sig: spec.sig, request: spec.request };
  const frames: Frame[] = [];
  const snap = (cur: number, extra: Partial<Frame> & { caption: string }): Frame => ({
    checks: checks.map((c) => ({ ...c })),
    cur,
    token,
    response: null,
    verdict: null,
    ...extra,
  });
  frames.push(
    snap(-1, {
      caption: `${spec.label}: a request arrives with "Authorization: Bearer eyJ…". Anyone can decode a JWT — it is signed, not encrypted — so nothing in it is trusted until the checks pass. Validator: ${
        validator === 'strict' ? 'strict (pinned RS256, JWKS by kid, iss + aud + exp)' : 'naive (alg from the header, one static key, only exp)'
      }; object-level check ${ownership ? 'on' : 'off'}.`,
      predict: spec.legit ? 'This is a legitimate request. Will every check let it through?' : 'This request should be refused. Which check stops it — if any?',
    }),
  );

  let denied: { code: number; text: string } | null = null;
  let fooled = false;
  for (let i = 0; i < ORDER.length; i++) {
    const id = ORDER[i];
    const c = checks[i];
    const o = spec.outcome[id]?.[validator];
    let status: Status = 'pass';
    let note = 'ok';
    if (o) [status, note] = o;
    else if (validator === 'naive' && (id === 'iss' || id === 'aud')) [status, note] = ['skip', 'not checked'];
    else if (id === 'owner') {
      if (!ownership) [status, note] = ['skip', 'not implemented: valid token ⇒ any order id works'];
      else if (scenario === 'bola') [status, note] = ['fail', 'order 1337 belongs to user_99, caller is user_42'];
      else note = 'order 1001 belongs to user_42 ✓';
    } else {
      note =
        id === 'parse'
          ? 'header.payload.signature'
          : id === 'alg'
            ? validator === 'strict'
              ? 'RS256 is in the allow-list'
              : `using "${spec.header[0].text.split('"')[3]}" from the header`
            : id === 'key'
              ? validator === 'strict'
                ? 'kid found in cached JWKS'
                : 'the one public key from config'
              : id === 'sig'
                ? 'signature valid'
                : id === 'iss'
                  ? 'trusted issuer'
                  : id === 'aud'
                    ? 'aud = orders-api'
                    : id === 'exp'
                      ? 'valid for 10 more minutes'
                      : 'orders:read covers GET';
    }
    // a skipped ownership check on a BOLA request is where the attack gets through
    if (scenario === 'bola' && id === 'owner' && !ownership) status = 'fooled';
    if (scenario === 'wrong-aud' && id === 'aud' && validator === 'naive') status = 'fooled';
    c.status = status;
    c.note = note;
    if (status === 'fooled') fooled = true;
    let caption = `Check ${i + 1} — ${c.label}: ${status === 'fail' ? 'REJECT' : status === 'skip' ? 'skipped' : status === 'fooled' ? 'FOOLED' : 'pass'} (${note}).`;
    if (status === 'fail') {
      denied = id === 'scope' || id === 'owner' ? (id === 'owner' ? { code: 404, text: 'Not Found (don’t confirm it exists)' } : { code: 403, text: 'Forbidden: insufficient_scope' }) : { code: 401, text: `Unauthorized: invalid_token (${id})` };
      caption += ` The pipeline stops here with ${denied.code}.`;
      if (id === 'scope' || id === 'owner') caption += ' Authentication succeeded; authorization did its job.';
      frames.push(snap(i, { caption }));
      break;
    }
    if (status === 'fooled' && id !== 'owner' && id !== 'aud') caption += ' The attacker chose this behaviour by editing the header.';
    frames.push(snap(i, { caption }));
  }

  const allowed = denied === null;
  const verdict: Frame['verdict'] = allowed ? (spec.allow ? 'correct-allow' : 'attack-succeeded') : spec.allow ? 'legit-denied' : 'correct-deny';
  const response = denied ?? { code: 200, text: scenario === 'bola' && fooled ? 'OK — user_99’s order, address and card last4' : scenario === 'wrong-aud' && fooled ? 'OK — a billing-api token now reads orders' : fooled ? 'OK — as "admin"' : 'OK' };
  const lesson: Record<NonNullable<Frame['verdict']>, string> = {
    'correct-allow': 'Correct: a legitimate request passed every check.',
    'correct-deny': 'Correct: the request was refused at the first check that could see the problem.',
    'attack-succeeded':
      scenario === 'bola'
        ? 'ATTACK SUCCEEDED: authentication was perfect, but nobody asked "is this YOUR order?" — BOLA, #1 in the OWASP API Top 10. Turn on the object-level check.'
        : scenario === 'wrong-aud'
          ? 'ATTACK SUCCEEDED: a token minted for billing-api was accepted by orders-api. Always check aud (and iss).'
          : 'ATTACK SUCCEEDED: the token chose its own verification rules. Pin the algorithm in the verifier; never read it from the token.',
    'legit-denied': 'A LEGITIMATE user got 401: the auth server rotated keys and this verifier only knows the old one. Look keys up by kid in the JWKS and refetch (rate-limited) on an unknown kid.',
  };
  frames.push(snap(frames[frames.length - 1].cur, { response, verdict, caption: `Response ${response.code} ${response.text}. ${lesson[verdict]}` }));
  return frames;
}
