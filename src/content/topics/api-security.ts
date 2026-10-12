import type { Topic } from '../../types';

const topic: Topic = {
  id: 'api-security',
  phase: 'apis-security',
  order: 3,
  title: 'API Authentication, Authorization & Threat Modeling',
  subtitle:
    'OAuth2 grants, PKCE, JWT validation and revocation, opaque tokens, OIDC, mTLS, scopes vs fine-grained authz, STRIDE and the OWASP API Top 10',
  estimatedMinutes: 95,
  sources: [
    'Mastering API Architecture — Ch 6 Operational Security: Threat Modeling for APIs',
    'Mastering API Architecture — Ch 7 API Authentication and Authorization',
    'OWASP API Security Top 10 (2023)',
    'RFC 6749 / RFC 7636 (PKCE) / RFC 8628 (Device Grant) / RFC 7662 (Introspection) / RFC 8705 (mTLS-bound tokens) / RFC 9700 (OAuth 2.0 Security BCP)',
  ],
  tags: ['oauth2', 'pkce', 'jwt', 'jwks', 'oidc', 'mtls', 'bola', 'stride', 'owasp', 'authorization'],
  cheatSheet: [
    'AuthN = who are you (identity); AuthZ = what may you do (permission). A valid token proves AuthN; it says NOTHING about whether this user may read order 42.',
    'API keys identify a *project/app*, not a user: long-lived, no delegation, no expiry — fine for metering server-to-server, never as the sole proof of end-user identity.',
    'OAuth2 grants today: Authorization Code + PKCE (every user-facing client, incl. SPAs/mobile), Client Credentials (machine-to-machine), Device Code (TVs/CLIs). Implicit and ROPC are deprecated by the OAuth 2.0 Security BCP (RFC 9700) and dropped in OAuth 2.1.',
    'PKCE: client sends S256(code_verifier) up front and the raw verifier at token exchange — a stolen authorization code is useless without the verifier.',
    'JWT validation checklist: pin allowed alg (never accept "none" or let the header pick HS vs RS), verify signature against JWKS key by kid, check exp/nbf (±60s skew), iss, aud, then authorize.',
    'JWTs are unrevocable by design: keep access tokens short (5–15 min), rotate refresh tokens with reuse detection, and add a denylist (jti / per-user "tokens-valid-after") only for emergencies.',
    'Opaque token + introspection (RFC 7662) = instant revocation at the cost of a network hop per request (cache 30–60s at the gateway); JWT = local validation (~50 µs), stale until exp.',
    'OIDC adds identity on top of OAuth2: the ID token is for the CLIENT (aud = client_id); never send an ID token to an API as an access token.',
    'Service-to-service: mTLS (SPIFFE IDs via mesh) proves *which workload* is calling; propagate end-user context separately (token exchange RFC 8693 or signed internal JWT).',
    'OWASP API #1 is BOLA: every object lookup must be scoped by the caller (WHERE id = $1 AND tenant_id = $2). Scopes are coarse ("orders:read"); object-level checks live in code or a policy engine.',
  ],
  sections: [
    {
      heading: 'AuthN vs AuthZ, and where each check lives',
      body: `**Intuition:** at a hotel, the front desk checking your passport is *authentication*; your key card only opening room 512 is *authorization*. Most API breaches are not broken passports — they are key cards that open every room.

**Precise mechanics.** A request passes through three distinct checks, and mixing them up is the root of most API security bugs:

| Layer | Question | Typical owner | Example failure |
|---|---|---|---|
| Authentication | Is this credential genuine and unexpired? Who is the principal? | API gateway / edge | Accepting \`alg: none\` JWTs |
| Coarse authorization | Is this principal allowed to call this *operation*? | Gateway (scopes) or service guard | Client with \`orders:read\` calls \`DELETE /orders\` |
| Fine-grained authorization | Is this principal allowed to touch *this object*? | The owning service (it has the data) | User A reads \`/orders/42\` belonging to user B (BOLA) |

The gateway can do AuthN and scope checks cheaply because it only needs the token. It **cannot** do object-level checks because it doesn't know who owns order 42 — only the orders service does. That is why "we validate JWTs at the gateway" is never a complete security answer.

**Defense in depth for a NestJS microservice fleet:**
- Gateway: TLS termination, token validation, rate limiting per client, strip spoofable headers (e.g. an incoming \`x-user-id\`).
- Service: re-validate the token (or a gateway-minted internal token) — never trust "it came from inside the network" (zero trust).
- Data layer: every query scoped by principal/tenant; optionally Postgres RLS as a backstop.

**In interviews say:** "AuthN at the edge, coarse authZ via scopes at the edge, fine-grained authZ in the service that owns the data, and I never trust the network perimeter."`,
      diagram: `  Client ──TLS──► API Gateway ─────────────► Orders Service ──► DB
                 │ 1. AuthN: verify JWT     │ 3. Fine-grained authZ:
                 │    sig/exp/iss/aud       │    order.ownerId == sub ?
                 │ 2. Coarse authZ:         │    (or policy engine)
                 │    scope orders:read ?   │ 4. Query scoped by
                 │ strip x-user-id header   │    tenant_id / owner_id
                 └── rate limit per client  └── re-verify token (zero trust)`,
      keyPoints: [
        'A valid token is necessary but never sufficient.',
        'Object-level checks must live where the ownership data lives.',
        'Strip identity headers at the edge so clients cannot spoof them.',
      ],
      source: 'Mastering API Architecture — Ch 7 API Authentication and Authorization',
    },
    {
      heading: 'API keys vs tokens — and why you should not mix keys and users',
      body: `**Intuition:** an API key is a building badge issued to a *company*; an OAuth access token is a visitor pass issued to a *specific person* for *specific rooms* that *expires at 5pm*.

**API keys**: a random secret (e.g. 32 bytes, base62) tied to an application or project. Good for: identifying the calling app, metering, quota, analytics, and simple server-to-server integrations (Stripe secret keys, Google Maps keys). Weaknesses: long-lived, no standard expiry or rotation, no delegation ("act on behalf of user X"), and they leak easily (mobile apps, git commits, browser bundles).

**Tokens** (OAuth2 access tokens): short-lived, scoped, issued by an authorization server, can represent a user *and* the client acting for them (\`sub\` + \`client_id\`/\`azp\`).

Mastering API Architecture's advice is: **don't mix keys and users.** If an API key is used to identify an end user, you've created a long-lived password with no MFA, no consent, and no revocation story per session. Keep keys for "which application", tokens for "which user, which permissions, until when".

**Storing API keys properly** (common interview probe):
- Show the key once at creation, store only a hash. Because keys are high-entropy random values, a fast hash (SHA-256) is fine — slow hashes (bcrypt) are for low-entropy human passwords.
- Use a visible prefix (\`sk_live_\`, \`ghp_\`) so secret scanners (GitHub push protection) can detect leaks, and a short key id so lookup is an indexed equality query.
- Compare with a constant-time comparison.
- Support multiple active keys per client so rotation is zero-downtime.`,
      code: [
        {
          language: 'typescript',
          title: 'Issuing and verifying API keys (hash-at-rest, prefixed, constant-time)',
          code: `import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';

const pool = new Pool();

// Format: sk_live_<keyId>_<secret>. keyId is indexed; secret is never stored.
export async function issueApiKey(clientId: string): Promise<string> {
  const keyId = randomBytes(6).toString('base64url');   // ~8 chars, lookup handle
  const secret = randomBytes(32).toString('base64url'); // 256 bits of entropy
  const hash = createHash('sha256').update(secret).digest();
  await pool.query(
    'INSERT INTO api_keys (key_id, client_id, secret_hash, created_at) VALUES ($1, $2, $3, now())',
    [keyId, clientId, hash],
  );
  return 'sk_live_' + keyId + '_' + secret; // shown to the user exactly once
}

export async function verifyApiKey(presented: string): Promise<string | null> {
  const m = /^sk_live_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{43})$/.exec(presented);
  if (!m) return null;
  const [, keyId, secret] = m;
  const { rows } = await pool.query(
    'SELECT client_id, secret_hash FROM api_keys WHERE key_id = $1 AND revoked_at IS NULL',
    [keyId],
  );
  if (rows.length === 0) return null;
  const candidate = createHash('sha256').update(secret).digest();
  // constant-time compare: avoids leaking how many bytes matched
  return timingSafeEqual(candidate, rows[0].secret_hash) ? rows[0].client_id : null;
}`,
        },
      ],
      keyPoints: [
        'API key = application identity; access token = delegated user authority.',
        'Hash API keys at rest; SHA-256 is fine because the input is high-entropy.',
        'Prefixes enable automated leak detection.',
      ],
      source: 'Mastering API Architecture — Ch 7 (Don’t Mix Keys and Users)',
    },
    {
      heading: 'OAuth2 roles and the grants you should actually use',
      body: `**Intuition:** OAuth2 is valet parking. You (resource owner) give the valet (client) a special key (access token) that starts the car but can't open the trunk (scopes), issued by the dealership (authorization server), usable only on your car (resource server / API).

**The four roles** (RFC 6749): **Resource Owner** (the user), **Client** (the app), **Authorization Server** (Auth0/Okta/Keycloak/Cognito — issues tokens), **Resource Server** (your API — validates tokens).

**Grant selection matrix:**

| Grant | Use when | Status |
|---|---|---|
| Authorization Code + PKCE | Any client acting for a user: web apps, SPAs, mobile, desktop | Recommended for all user-facing clients |
| Client Credentials | Machine-to-machine; no user (cron job calling billing API) | Recommended |
| Device Authorization (RFC 8628) | Input-constrained devices: smart TV, CLI (\`gh auth login\`) | Recommended |
| Refresh Token | Getting new access tokens without re-login | Use with rotation for public clients |
| Implicit | Old SPAs: token returned in URL fragment | **Deprecated** — tokens leak via history, referrer, logs; no refresh; no client binding |
| Resource Owner Password (ROPC) | App collects user's password directly | **Deprecated** — trains phishing, breaks MFA/SSO, client sees the password |

**Authorization Code + PKCE (RFC 7636) step by step:**
1. Client generates a random \`code_verifier\` (43–128 chars) and \`code_challenge = BASE64URL(SHA256(verifier))\`.
2. Browser is redirected to \`/authorize?response_type=code&client_id&redirect_uri&scope&state&code_challenge&code_challenge_method=S256\`.
3. User authenticates (MFA, SSO) *at the authorization server* — the client never sees the password.
4. AS redirects back with a short-lived (~60 s), single-use \`code\` and the \`state\` (CSRF protection — client must check it matches).
5. Client POSTs \`code\` + \`code_verifier\` to \`/token\`. AS recomputes the hash; only the party that started the flow can redeem the code.

PKCE defeats **authorization code interception** (malicious app registered for the same custom URL scheme on mobile, or code leaked in logs). The OAuth 2.0 Security BCP (RFC 9700, 2025) recommends PKCE for *confidential* clients too, and OAuth 2.1 makes it mandatory.

**For SPAs specifically**, the current best practice is the **BFF (Backend-for-Frontend) pattern**: the BFF is a confidential client that holds the tokens server-side and gives the browser only an \`HttpOnly; Secure; SameSite\` session cookie — so XSS can't exfiltrate tokens.`,
      diagram: `  Browser/App           Authorization Server             API
      │ 1. verifier=rand; challenge=S256(verifier)
      │──2. /authorize?...&code_challenge=..──►│
      │        3. user login + MFA + consent   │
      │◄─4. 302 redirect_uri?code=abc&state=xyz│
      │──5. POST /token code=abc               │
      │        code_verifier=... ─────────────►│ S256(verifier)==challenge?
      │◄─6. access_token (5-15m) + refresh ────│
      │──7. GET /orders  Authorization: Bearer ───────────────►│ validate
      │◄───────────────────────────────────────────── 200 ──────│`,
      code: [
        {
          language: 'typescript',
          title: 'Generating PKCE verifier/challenge and building the authorize URL',
          code: `import { randomBytes, createHash } from 'node:crypto';

export function createPkcePair() {
  // 32 random bytes -> 43-char base64url string (RFC 7636 requires 43..128 chars)
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(opts: {
  issuer: string; clientId: string; redirectUri: string; scope: string;
}) {
  const { verifier, challenge } = createPkcePair();
  const state = randomBytes(16).toString('base64url'); // anti-CSRF, bind to session
  const url = new URL('/authorize', opts.issuer);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,   // must EXACTLY match a registered URI
    scope: opts.scope,                // e.g. 'openid profile orders:read'
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',    // never 'plain' in production
  }).toString();
  // persist verifier + state server-side (BFF session), NOT in localStorage
  return { url: url.toString(), verifier, state };
}`,
        },
      ],
      keyPoints: [
        'Auth Code + PKCE for users, Client Credentials for machines, Device Code for TVs/CLIs.',
        'Implicit and ROPC are deprecated — say why (token in URL; client sees password).',
        'Redirect URIs must be exact-match registered; open redirects enable code theft.',
      ],
      source: 'Mastering API Architecture — Ch 7 (OAuth2 roles and grants)',
    },
    {
      heading: 'JWT anatomy and a validation checklist that actually holds up',
      body: `**Intuition:** a JWT is a sealed envelope with a readable letter inside. Anyone can *read* it (it's base64url, not encrypted); only the issuer can *seal* it. Your job as an API is to check the seal and the letter's dates before believing a word.

**Structure:** \`base64url(header).base64url(payload).base64url(signature)\`.
- Header: \`{ "alg": "RS256", "kid": "2026-09-key-2", "typ": "at+jwt" }\`
- Payload (claims): \`iss\` (issuer), \`sub\` (subject/user id), \`aud\` (intended API), \`exp\`/\`nbf\`/\`iat\`, \`jti\` (unique id), \`scope\`, \`client_id\`, plus custom claims (tenant_id).

**Algorithm choice:** RS256/ES256/EdDSA (asymmetric) let every API verify with a *public* key while only the AS can sign. HS256 (shared secret) means every verifier can also *forge* tokens — acceptable only inside one trust boundary.

**Classic JWT attacks and their fixes:**

| Attack | How it works | Fix |
|---|---|---|
| \`alg: none\` | Attacker strips signature, sets alg none; naive libs accept | Pin \`algorithms: ['RS256']\` in the verifier |
| RS/HS algorithm confusion | Attacker signs with HS256 using the server's *public RSA key* as the HMAC secret; library picks alg from header | Pin algorithms; key objects typed per alg (jose does this) |
| \`kid\` injection | \`kid\` used in a file path or SQL lookup ("../../dev/null") | Treat kid as an opaque lookup key into a fixed JWKS map only |
| \`jku\`/\`x5u\` header abuse | Token points to attacker-hosted keys | Ignore these headers; JWKS URL comes from config/discovery |
| Audience confusion | Token for API A replayed to API B | Always check \`aud\` |
| Long-lived tokens | Stolen token valid for days | 5–15 min exp + refresh rotation |

**JWKS rotation:** the AS publishes \`/.well-known/jwks.json\` with multiple keys. Rotation = publish new key → wait for caches (≥ max JWKS cache TTL, e.g. 24h) → start signing with it → keep old public key until all tokens it signed have expired → remove. A verifier that sees an unknown \`kid\` should refetch JWKS (rate-limited, e.g. at most once per 30s to avoid a DoS amplification).

**Performance:** RS256 verification costs ~20–50 µs of CPU in Node; ES256 verify is a bit slower than RS256 verify but tokens are smaller. Either way it's negligible vs a 1–5 ms introspection network hop.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS guard validating JWTs with jose + remote JWKS (pinned alg, iss, aud)',
          code: `import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, errors } from 'jose';

// Caches keys in memory; refetches on unknown kid with a cooldown
const JWKS = createRemoteJWKSet(new URL('https://auth.example.com/.well-known/jwks.json'), {
  cooldownDuration: 30_000,   // at most one refetch per 30s on unknown kid
  cacheMaxAge: 10 * 60_000,
});

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const { payload } = await jwtVerify(header.slice(7), JWKS, {
        algorithms: ['RS256'],               // pin: blocks alg=none and HS/RS confusion
        issuer: 'https://auth.example.com/',
        audience: 'orders-api',              // token must be minted for THIS API
        clockTolerance: 60,                  // seconds of skew allowed on exp/nbf
        typ: 'at+jwt',                       // RFC 9068 access-token type, rejects ID tokens
      });
      req.principal = {
        sub: payload.sub,
        tenantId: payload['tenant_id'],
        scopes: String(payload['scope'] ?? '').split(' '),
      };
      return true;
    } catch (e) {
      if (e instanceof errors.JWTExpired) throw new UnauthorizedException('token_expired');
      throw new UnauthorizedException('invalid_token');
    }
  }
}`,
        },
      ],
      keyPoints: [
        'JWTs are signed, not encrypted — never put secrets/PII you would not show the user in claims.',
        'Pin algorithms; never let the token header choose how it is verified.',
        'Rotate signing keys with overlap; refetch JWKS on unknown kid with a cooldown.',
      ],
      source: 'Mastering API Architecture — Ch 7 (JSON Web Tokens)',
    },
    {
      heading: 'Revocation, refresh token rotation, and opaque tokens with introspection',
      body: `**Intuition:** a JWT is a paper concert ticket — you can't un-print it, so you make it expire quickly. An opaque token is a wristband number the bouncer radios in every time — revocable instantly, but every entry costs a radio call.

**The core trade-off:**

| | Self-contained JWT | Opaque token + introspection (RFC 7662) |
|---|---|---|
| Validation | Local signature check, ~50 µs | POST /introspect to AS, 1–5 ms (+AS load) |
| Revocation | Not possible until \`exp\` (unless denylist) | Immediate |
| Token size | 800 B – 2 KB (headers bloat) | ~32–64 B |
| Privacy | Claims readable by anyone holding it | Nothing leaks |
| Failure mode | AS down → APIs keep working | AS down → all APIs fail (cache helps) |

A common hybrid (the "phantom token" pattern): clients get **opaque** tokens (no claim leakage to third parties); the **gateway** introspects once, caches the result for ~30–60 s, and forwards a short-lived **internal JWT** to services.

**Revocation strategies for JWTs, cheapest first:**
1. **Short expiry** (5–15 min). Worst-case exposure window = token lifetime.
2. **Per-user "valid-after" timestamp** in Redis: reject any token with \`iat < revokedAfter[sub]\`. O(1) lookup, one key per affected user — perfect for "log out everywhere" / password reset.
3. **\`jti\` denylist** in Redis with TTL = remaining token lifetime (the set is naturally bounded because entries expire with the tokens).
4. **Rotate the signing key** — nuclear option that logs out *everyone* (use when the key itself is compromised).

**Refresh token rotation with reuse detection** (RFC 9700 recommends it for public clients): every refresh returns a *new* refresh token and invalidates the old one. All tokens descending from one login form a **family**. If an *already-used* refresh token is presented, someone copied it — revoke the entire family so both the attacker and the victim must re-authenticate. Also: bind refresh tokens to the client (\`client_id\`), give them an absolute lifetime (e.g. 30 days) and an idle timeout (e.g. 7 days).

**Sender-constrained tokens** go further: **DPoP** (RFC 9449) or **mTLS-bound tokens** (RFC 8705) put a key thumbprint in the token (\`cnf\` claim), so a stolen bearer token is useless without the client's private key.`,
      code: [
        {
          language: 'typescript',
          title: 'Refresh token rotation with family-wide reuse detection (Postgres)',
          code: `import { randomBytes, createHash } from 'node:crypto';
import { Pool } from 'pg';

const pool = new Pool();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function rotateRefreshToken(presented: string, clientId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE: two concurrent refreshes with the same token serialize here
    const { rows } = await client.query(
      'SELECT id, family_id, user_id, used_at, expires_at, client_id FROM refresh_tokens ' +
      'WHERE token_hash = $1 FOR UPDATE', [sha(presented)]);
    const rt = rows[0];
    if (!rt || rt.client_id !== clientId || rt.expires_at < new Date()) {
      await client.query('ROLLBACK');
      throw new Error('invalid_grant');
    }
    if (rt.used_at) {
      // REUSE DETECTED: token was already rotated -> assume theft, kill the family
      await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1', [rt.family_id]);
      await client.query('COMMIT');
      throw new Error('invalid_grant'); // also alert security + revoke user sessions
    }
    await client.query('UPDATE refresh_tokens SET used_at = now() WHERE id = $1', [rt.id]);
    const next = randomBytes(32).toString('base64url');
    await client.query(
      'INSERT INTO refresh_tokens (token_hash, family_id, user_id, client_id, expires_at) ' +
      'VALUES ($1, $2, $3, $4, LEAST(now() + interval \\'30 days\\', ' +
      '(SELECT min(created_at) + interval \\'90 days\\' FROM refresh_tokens WHERE family_id = $2)))',
      [sha(next), rt.family_id, rt.user_id, clientId]);
    await client.query('COMMIT');
    return { refreshToken: next, userId: rt.user_id }; // caller also mints a new access token
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}`,
        },
      ],
      keyPoints: [
        'Pick JWT vs opaque based on revocation needs vs latency/availability coupling.',
        'Per-user valid-after timestamp is the cheapest "log out everywhere".',
        'Refresh reuse = theft signal: revoke the whole family.',
        'DPoP / mTLS-bound tokens make stolen bearer tokens useless.',
      ],
      source: 'Mastering API Architecture — Ch 7 (Refresh Tokens); RFC 7662; RFC 9449',
    },
    {
      heading: 'OIDC, SAML, and what an ID token is (and is not) for',
      body: `**Intuition:** OAuth2 answers "may this app access my photos?" — it was never designed to tell the app *who you are*. OpenID Connect (OIDC) bolts a standard identity layer on top.

**OIDC adds:**
- The \`openid\` scope, which makes the token endpoint also return an **ID token** — a JWT *for the client* (\`aud\` = client_id) with \`sub\`, \`email\`, \`auth_time\`, \`acr\`/\`amr\` (how the user authenticated, e.g. MFA), and a \`nonce\` that the client checks to prevent replay.
- A **UserInfo** endpoint and a **discovery document** (\`/.well-known/openid-configuration\`) listing endpoints and the JWKS URI — so verifiers are configured by issuer URL alone.

**The #1 OIDC mistake:** sending the ID token to your API as a bearer token. The ID token's audience is the client, not the API; it carries no scopes; and accepting it means any token minted for *any* client of the same IdP might authenticate against your API. APIs accept **access tokens** with \`aud\` = the API.

**SAML 2.0** is the older XML-based enterprise SSO protocol (browser POSTs a signed XML assertion to the service provider). You still meet it in B2B ("our customer's Okta/ADFS only speaks SAML"). Typical design: your IdP broker (Keycloak/Auth0/Cognito) federates SAML from the customer and issues OIDC/OAuth tokens to your apps — your services only ever see one token format. SAML's notorious bug class is **XML signature wrapping** — use mature libraries, never hand-roll.

| | OAuth2 | OIDC | SAML 2.0 |
|---|---|---|---|
| Purpose | Delegated authorization | Authentication (identity) on OAuth2 | Enterprise SSO (authN + attributes) |
| Token | Access token (opaque or JWT) | ID token (JWT) + access token | XML assertion |
| Typical client | Any API client | Web/mobile apps | Enterprise web apps |`,
      keyPoints: [
        'ID token → the client (who logged in). Access token → the API (what the client may do).',
        'OIDC discovery + JWKS makes verifier config a single issuer URL.',
        'Federate SAML at the IdP broker; keep one token format inside.',
      ],
      source: 'Mastering API Architecture — Ch 7 (OIDC, SAML 2.0)',
    },
    {
      heading: 'Service-to-service auth: mTLS, workload identity, and propagating the user',
      body: `**Intuition:** inside a microservice fleet, you need to answer two questions per call: *which service is calling me?* (workload identity) and *on behalf of which user?* (end-user context). Conflating them is how an internal service becomes a confused deputy.

**Workload identity options:**

| Option | How | Pros | Cons |
|---|---|---|---|
| mTLS (mesh: Istio/Linkerd, SPIFFE IDs) | Both sides present X.509 certs; sidecar rotates certs every ~24h | Transparent to app code, encrypts traffic, strong identity (\`spiffe://prod/ns/billing/sa/billing\`) | Mesh ops overhead; identity at L4 unless you read the peer cert |
| OAuth2 Client Credentials | Service gets a token from the AS with \`aud\` = target | Works across clouds/orgs; scopes | Token caching/refresh in every client; AS in the critical path |
| Cloud IAM (AWS SigV4, GCP identity tokens) | Signed by platform credentials | No secrets to distribute | Cloud-specific |

**Propagating end-user context:** don't just forward the user's external token everywhere — its \`aud\` is the edge API, and forwarding it means a compromised internal service can replay it anywhere. Better:
- **Token exchange (RFC 8693):** service A exchanges the user token for a new token with \`aud\` = service B, narrower scopes, and an \`act\` (actor) claim recording that A is acting for the user.
- Or the gateway mints a short-lived (≤60 s) **internal JWT** signed by an internal key with \`sub\`, \`tenant_id\`, \`scopes\`, which services verify locally.

**Confused deputy:** a privileged service (e.g. "reports", which can read all tenants' data) is tricked into acting for a caller who lacks that privilege — e.g. a request body containing \`tenantId: other\`. Fix: the service derives tenant/user from the *verified* token, never from the request payload, and authorizes as the *user*, not as itself.

**Header propagation** (Mastering API Ch 5 & 7): propagate \`traceparent\` and a verified identity context; strip/overwrite any client-supplied \`x-user-id\`, \`x-tenant-id\`, \`x-forwarded-*\` at the edge.`,
      code: [
        {
          language: 'yaml',
          title: 'Istio: enforce mTLS and allow only the orders service to call payments',
          code: `apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: payments
spec:
  mtls:
    mode: STRICT            # reject any plaintext traffic into this namespace
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: payments-allow-orders
  namespace: payments
spec:
  selector:
    matchLabels:
      app: payments
  action: ALLOW
  rules:
    - from:
        - source:
            # SPIFFE identity derived from the caller's k8s service account
            principals: ['cluster.local/ns/orders/sa/orders']
      to:
        - operation:
            methods: ['POST']
            paths: ['/v1/charges']
      when:
        - key: request.auth.claims[aud]   # requires a RequestAuthentication for JWTs
          values: ['payments-api']`,
        },
      ],
      keyPoints: [
        'mTLS proves the workload; a token proves the user — you usually need both.',
        'Use token exchange or internal short-lived JWTs instead of forwarding edge tokens.',
        'Derive tenant/user from the verified token, never from the payload.',
      ],
      source: 'Mastering API Architecture — Ch 7 (System-to-System Authentication)',
    },
    {
      heading: 'Scopes vs fine-grained authorization (RBAC checks, policy engines)',
      body: `**Intuition:** scopes are the *type* of key (a "read orders" key); fine-grained authorization decides *which* orders that key opens.

**Scopes** are coarse, consented permissions on the token (\`orders:read\`, \`orders:write\`). They answer "what did the user allow this *client* to do?" — a third-party app might get \`orders:read\` only. Scopes are **not** a user permission system: putting \`order:42:read\` in a token explodes token size and goes stale instantly.

**Authorization enforcement** layers:
1. **Scope check** at gateway/guard: cheap, token-only.
2. **Role/permission check** (RBAC): "is this user an admin of tenant T?" — from claims or a lookup.
3. **Object/relationship check**: "is this user the owner, or in a group that has access to document D?" — needs data. Options: code in the service, **OPA/Rego** (policy-as-code, sidecar ~1 ms), **Cedar** (AWS Verified Permissions), or **Zanzibar-style ReBAC** (OpenFGA/SpiceDB). (Deep dive on RBAC/ABAC/ReBAC models is in the Application Security topic.)

**Rule of thumb for interviews:** the effective permission is the **intersection** of what the *client* was granted (scopes) and what the *user* is allowed (roles/relationships). A first-party admin app with \`orders:write\` still cannot let a non-admin user delete another tenant's order.

**Function-level authorization** (OWASP API5): admin endpoints (\`POST /admin/users\`, \`PUT /users/:id/role\`) must be protected by explicit role checks — deny-by-default via a global guard so a newly added route is closed until someone opens it.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS: deny-by-default scope guard + object-level ownership check',
          code: `import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException,
  SetMetadata, Controller, Get, Param, Req } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const Scopes = (...s: string[]) => SetMetadata('scopes', s);

@Injectable()
export class ScopeGuard implements CanActivate {   // registered globally via APP_GUARD
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>('scopes', [ctx.getHandler(), ctx.getClass()]);
    if (!required) throw new ForbiddenException('route has no @Scopes: denied by default');
    const granted: string[] = ctx.switchToHttp().getRequest().principal?.scopes ?? [];
    if (!required.every((s) => granted.includes(s))) throw new ForbiddenException('insufficient_scope');
    return true;
  }
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly repo: { findOne(q: object): Promise<unknown | null> }) {}

  @Get(':id')
  @Scopes('orders:read')
  async get(@Param('id') id: string, @Req() req: any) {
    // Object-level check folded INTO the query: tenant + owner come from the verified token
    const order = await this.repo.findOne({ id, tenantId: req.principal.tenantId, ownerId: req.principal.sub });
    // 404 not 403: do not confirm to an attacker that the id exists
    if (!order) throw new NotFoundException();
    return order;
  }
}`,
        },
      ],
      keyPoints: [
        'Effective permission = client scopes ∩ user permissions.',
        'Deny-by-default guards close newly added routes automatically.',
        'Return 404 for objects the caller may not see to avoid ID enumeration.',
      ],
      source: 'Mastering API Architecture — Ch 7 (Scopes, Authorization Enforcement)',
    },
    {
      heading: 'Threat modeling with STRIDE — a walkthrough on a real API',
      body: `**Intuition:** threat modeling is thinking like a burglar *before* building the house: draw the system, mark where trust changes (trust boundaries), and ask "what could go wrong here?" systematically instead of by gut feel.

**The four questions** (Adam Shostack, used in Mastering API Ch 6): *What are we working on? What can go wrong? What are we going to do about it? Did we do a good job?*

**Process:** draw a data-flow diagram (external entities, processes, data stores, data flows) → mark trust boundaries (internet↔gateway, gateway↔services, services↔DB, you↔third-party webhook) → apply STRIDE to each element crossing a boundary → rank (likelihood × impact, or DREAD/CVSS) → mitigations become backlog tickets with owners.

**STRIDE applied to "mobile app → gateway → orders service → Postgres, plus Stripe webhook":**

| Threat | Violates | Concrete example here | Mitigation |
|---|---|---|---|
| **S**poofing | Authentication | Forged Stripe webhook marks order paid | Verify \`Stripe-Signature\` HMAC + timestamp tolerance |
| **T**ampering | Integrity | Client edits \`price\` in the order request body | Server computes price; ignore client totals; TLS |
| **R**epudiation | Non-repudiation | Admin denies issuing a refund | Immutable audit log (who, what, when, from where), append-only store |
| **I**nformation disclosure | Confidentiality | \`GET /users/:id\` returns password hash and internal flags | Response DTO allow-list; field-level authz |
| **D**enial of service | Availability | Unbounded \`?limit=100000\` or a GraphQL query 20 levels deep | Pagination caps, query depth/complexity limits, rate limits |
| **E**levation of privilege | Authorization | \`PATCH /users/me {"role":"admin"}\` accepted (mass assignment) | Explicit DTO whitelisting (\`whitelist: true, forbidNonWhitelisted: true\`) |

**In production:** run a threat-modeling session per new service or major feature (1–2 hours with dev + security), keep the DFD next to the code, and automate what you can (OWASP ZAP/DAST in CI, dependency scanning, secret scanning).`,
      diagram: `  [Mobile App] ──(1)──►|TB1|──► [API Gateway] ──(2)──►|TB2|──► [Orders Svc]
    external           internet    process           mesh        process
                       boundary                     boundary        │ (3)
  [Stripe] ──webhook──►|TB1|──► [Webhook Svc] ──event──► Kafka    |TB3|
                                                                    ▼
    Apply S-T-R-I-D-E to every flow that crosses a TB          [(Postgres)]`,
      keyPoints: [
        'Trust boundaries are where threats concentrate — list them first.',
        'Each STRIDE letter maps to a violated property (authN, integrity, non-repudiation, confidentiality, availability, authZ).',
        'Mitigations must end up as owned tickets, not a PDF.',
      ],
      source: 'Mastering API Architecture — Ch 6 Threat Modeling (STRIDE)',
    },
    {
      heading: 'OWASP API Security Top 10 (2023) — what each means in a NestJS codebase',
      body: `**Intuition:** the OWASP web Top 10 is about browsers and HTML; the API Top 10 exists because APIs expose object IDs and business flows directly, and most API breaches are *authorization logic* bugs, not crypto failures.

| # | Risk | What it looks like | Primary control |
|---|---|---|---|
| API1 | **Broken Object Level Authorization (BOLA)** | \`GET /accounts/1002\` works for any logged-in user | Scope every lookup by principal/tenant; RLS backstop; unguessable IDs as defense in depth only |
| API2 | Broken Authentication | No rate limit on \`/login\`, JWT \`alg\` not pinned, tokens in URLs | Standard IdP, MFA, credential-stuffing protection, strict token validation |
| API3 | Broken Object *Property* Level Authorization | Mass assignment (\`role\` in PATCH body) or excessive data exposure (hash in response) | Input and output DTO allow-lists |
| API4 | Unrestricted Resource Consumption | No pagination cap, huge uploads, costly SMS/email endpoints | Limits on size, count, rate, and spend |
| API5 | Broken Function Level Authorization | Regular user calls \`/admin/*\` | Deny-by-default role guards |
| API6 | Unrestricted Access to Sensitive Business Flows | Bots buying all concert tickets, mass referral signups | Bot detection, device fingerprinting, per-flow limits |
| API7 | Server-Side Request Forgery | \`POST /webhooks {url: 'http://169.254.169.254/...'}\` | URL allow-list, block private ranges, egress proxy |
| API8 | Security Misconfiguration | Verbose stack traces, permissive CORS, missing TLS | Hardened defaults, config scanning |
| API9 | Improper Inventory Management | Forgotten \`v1\` or staging API with no auth | API catalog, gateway-only exposure, sunset old versions |
| API10 | Unsafe Consumption of APIs | Trusting a partner API's response blindly | Validate/sanitize third-party data, timeouts, TLS |

**Why BOLA is #1:** it's invisible to generic scanners (the request is well-formed and authenticated), every endpoint with an ID in the path is a candidate, and it's usually one missing \`AND owner_id = $2\`. Detection signals: one principal requesting many distinct object IDs sequentially, or a high 403/404 ratio per principal.

**Testing for it:** automated "two-user" integration tests — create resources as user A, then replay every A request with user B's token and assert 404/403. Run it in CI for every route.`,
      code: [
        {
          language: 'typescript',
          title: 'CI test that replays every resource request with a second tenant (BOLA regression)',
          code: `import request from 'supertest';
import { INestApplication } from '@nestjs/common';

// Routes that take an object id; kept in sync by a lint rule that scans controllers
const ID_ROUTES: Array<{ method: 'get' | 'patch' | 'delete'; path: (id: string) => string }> = [
  { method: 'get', path: (id) => '/orders/' + id },
  { method: 'patch', path: (id) => '/orders/' + id },
  { method: 'get', path: (id) => '/orders/' + id + '/invoice' },
  { method: 'delete', path: (id) => '/orders/' + id },
];

export function bolaSuite(getApp: () => INestApplication, tokenA: () => string, tokenB: () => string) {
  describe('BOLA: tenant B must never touch tenant A objects', () => {
    let orderId: string;
    beforeAll(async () => {
      const res = await request(getApp().getHttpServer())
        .post('/orders').set('Authorization', 'Bearer ' + tokenA()).send({ sku: 'X1', qty: 1 });
      orderId = res.body.id;
    });

    it.each(ID_ROUTES)('$method route denies foreign tenant', async ({ method, path }) => {
      const res = await request(getApp().getHttpServer())[method](path(orderId))
        .set('Authorization', 'Bearer ' + tokenB()).send({ qty: 99 });
      expect([403, 404]).toContain(res.status);   // never 200/204
    });
  });
}`,
        },
      ],
      keyPoints: [
        'BOLA (API1) is the most exploited API flaw: well-formed, authenticated, wrong object.',
        'API3 merges mass assignment and excessive data exposure: use input/output DTO allow-lists.',
        'Improper inventory (API9): the forgotten v1 endpoint is often the breach.',
      ],
      source: 'Mastering API Architecture — Ch 6 (OWASP API Security Top 10)',
    },
  ],
  codeChallenges: [
    {
      id: 'api-security-cc-1',
      title: 'Harden a hand-rolled JWT middleware',
      context:
        'A legacy Express middleware in the payments API validates JWTs. A pentest report says "tokens can be forged" and "logged-out users keep access". The IdP signs RS256 access tokens and publishes a JWKS; the middleware was written before that.',
      task: 'Find every security flaw in the middleware and rewrite it to be production-grade: correct signature verification, claim checks, key rotation support, and a way to revoke a user\'s tokens after password reset.',
      starter: {
        language: 'typescript',
        code: `import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import type { Request, Response, NextFunction } from 'express';

export function auth(req: Request, res: Response, next: NextFunction) {
  // token may come from header or query string (for download links)
  const token = (req.headers.authorization || '').replace('Bearer ', '') || String(req.query.token);
  const decoded: any = jwt.decode(token, { complete: true });
  if (!decoded) return res.status(401).send('no token');

  // pick the key by kid from the keys folder
  const key = fs.readFileSync('./keys/' + decoded.header.kid + '.pem', 'utf8');

  try {
    // verify using whatever algorithm the token says it uses
    const payload: any = jwt.verify(token, key, { algorithms: [decoded.header.alg] });
    (req as any).user = { id: payload.sub, tenantId: req.headers['x-tenant-id'], role: payload.role };
    next();
  } catch (err: any) {
    res.status(401).send(err.message); // helpful for debugging
  }
}`,
      },
      hints: [
        'What happens if the header says alg HS256 and the "key" is an RSA public key PEM? What about alg none?',
        'Where does kid end up, and what does the verifier check besides the signature (iss, aud, typ)?',
        'Tokens in query strings end up in access logs and Referer headers. And where does tenantId come from?',
      ],
      solution: {
        language: 'typescript',
        code: `import { createRemoteJWKSet, jwtVerify, errors } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);
// JWKS from config (never from token headers); cached, refetched on unknown kid w/ cooldown
const JWKS = createRemoteJWKSet(new URL(process.env.JWKS_URL!), { cooldownDuration: 30_000 });

export async function auth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  // header only: query-string tokens leak into logs, proxies, browser history
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'invalid_token' });
  try {
    const { payload } = await jwtVerify(h.slice(7), JWKS, {
      algorithms: ['RS256'],              // pinned: blocks alg=none and HS/RS confusion
      issuer: process.env.JWT_ISSUER!,
      audience: 'payments-api',           // reject tokens minted for other APIs / ID tokens
      typ: 'at+jwt',
      clockTolerance: 60,
      maxTokenAge: '15m',                 // defense in depth even if IdP misconfigures exp
    });
    // revocation: tokens issued before the user's cut-off are dead (password reset, logout-all)
    const cutoff = await redis.get('revoked-after:' + payload.sub);
    if (cutoff && (payload.iat ?? 0) <= Number(cutoff)) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    (req as any).principal = {
      sub: payload.sub,
      tenantId: payload['tenant_id'],     // from the SIGNED token, never a client header
      scopes: String(payload['scope'] ?? '').split(' ').filter(Boolean),
    };
    return next();
  } catch (err) {
    const code = err instanceof errors.JWTExpired ? 'token_expired' : 'invalid_token';
    // generic error to client; details go to logs (without the token itself)
    req.log?.warn({ err: (err as Error).name }, 'jwt rejected');
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    return res.status(401).json({ error: code });
  }
}

// Called on password reset / "log out everywhere"; TTL = max access-token lifetime
export async function revokeAllForUser(sub: string) {
  await redis.set('revoked-after:' + sub, Math.floor(Date.now() / 1000), 'EX', 15 * 60);
}`,
      },
      explanation: `**Fixes, in order of severity:**
- **Algorithm taken from the token** (\`algorithms: [decoded.header.alg]\`): an attacker sets \`alg: HS256\` and HMAC-signs with the *public* RSA PEM (which is public!) — classic algorithm confusion, full token forgery. Now pinned to RS256.
- **\`kid\` path traversal**: \`kid: "../../../dev/null"\` or any readable file becomes the verification key. Keys now come only from the configured JWKS, looked up by kid as an opaque map key; rotation works automatically.
- **No \`iss\`/\`aud\`/\`typ\` checks**: any token from the IdP — including ID tokens or tokens for other APIs — was accepted. Now audience-bound.
- **Tenant from a client header** (\`x-tenant-id\`): trivial cross-tenant access (BOLA at the tenant level). Now read from the signed claim.
- **Token in the query string**: leaks into access logs, CDN logs, Referer. Use short-lived signed download URLs instead.
- **No revocation**: added a per-user "revoked-after" timestamp — O(1) Redis lookup, TTL equal to max token lifetime so the keyspace stays bounded.
- **Leaking error messages** ("invalid signature", "jwt malformed") helps attackers iterate; now generic with a \`WWW-Authenticate\` header per RFC 6750.
- **Sync \`readFileSync\` on every request** blocked the event loop; JWKS is cached in memory.`,
      followUps: [
        {
          "q": "Download links used `?token=` for a reason: browsers can't add an Authorization header to an `<a href>`. How do you support downloads now?",
          "a": "Issue a short-lived, single-purpose signed URL. The SPA calls `POST /files/{id}/download-url` with its bearer token. The API checks authorization and returns a presigned S3 URL, or an HMAC-signed `/download?f=..&exp=..&sig=..`, valid for about 60 s and scoped to that one object. The URL may leak into logs, but it's useless after a minute and grants access to only one file. For browser downloads behind a BFF, the session cookie works naturally."
        },
        {
          "q": "How do you test this middleware so a future refactor can't silently reintroduce any of these flaws?",
          "a": "Build a table of malicious tokens in unit tests, using a local JWKS with test keys: `alg: none`, HS256 signed with the public PEM, a `kid` like `../../etc/passwd`, wrong `iss`, wrong `aud`, an ID token (`typ: JWT`), an expired token, `iat` before the revoked-after cutoff, and a token in the query string. Every case must return 401 with a generic body. Add positive cases for a valid token and for a JWKS rotation (a new kid appears and gets fetched). Run it as part of the shared auth library's CI."
        }
      ],
    },
    {
      id: 'api-security-cc-2',
      title: 'Fix BOLA and mass assignment in a NestJS documents API',
      context:
        'A multi-tenant document API. A bug-bounty hunter reported they could read and edit other companies\' documents by incrementing IDs and could make themselves an "owner". Tokens are validated correctly by a global guard which sets req.principal = { sub, tenantId, roles }.',
      task: 'Rewrite the controller/service so that no caller can read, list, or modify another tenant\'s documents or escalate their own permissions, and so that responses do not over-expose fields.',
      starter: {
        language: 'typescript',
        code: `@Controller('documents')
export class DocumentsController {
  constructor(@InjectRepository(Document) private repo: Repository<Document>) {}

  @Get()
  list(@Query('tenantId') tenantId: string, @Query('limit') limit = 50) {
    return this.repo.find({ where: { tenantId }, take: limit });
  }

  @Get(':id')
  async get(@Param('id') id: number) {
    const doc = await this.repo.findOneBy({ id });
    if (!doc) throw new NotFoundException();
    return doc; // entity includes tenantId, ownerId, s3Key, internalNotes, aclJson
  }

  @Patch(':id')
  async update(@Param('id') id: number, @Body() body: any, @Req() req: any) {
    const doc = await this.repo.findOneBy({ id });
    if (doc.ownerId !== req.principal.sub && !req.principal.roles.includes('admin')) {
      throw new ForbiddenException('not your document');
    }
    Object.assign(doc, body);   // update whatever fields were sent
    return this.repo.save(doc);
  }
}`,
      },
      hints: [
        'Which values here come from the client that should come from the verified principal?',
        'Is the "admin" in the update check an admin of which tenant? What does 403 vs 404 reveal?',
        'Object.assign(doc, body) — what if body contains tenantId, ownerId or aclJson? What does the GET return that the client should not see?',
      ],
      solution: {
        language: 'typescript',
        code: `import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Expose, plainToInstance } from 'class-transformer';

export class UpdateDocumentDto {           // input allow-list (ValidationPipe whitelist + forbidNonWhitelisted)
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(100_000) body?: string;
}

export class DocumentView {                // output allow-list: only these fields leave the service
  @Expose() id!: string;
  @Expose() title!: string;
  @Expose() body!: string;
  @Expose() updatedAt!: Date;
}
const view = (d: object) => plainToInstance(DocumentView, d, { excludeExtraneousValues: true });

@Controller('documents')
export class DocumentsController {
  constructor(@InjectRepository(Document) private repo: Repository<Document>) {}

  @Get()
  @Scopes('documents:read')
  async list(@Req() req: any, @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    const docs = await this.repo.find({
      where: { tenantId: req.principal.tenantId },   // tenant from the token, never the query
      take: Math.min(limit, 100),                     // cap: unrestricted consumption (API4)
      order: { updatedAt: 'DESC' },
    });
    return docs.map(view);
  }

  @Get(':id')
  @Scopes('documents:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const doc = await this.repo.findOneBy({ id, tenantId: req.principal.tenantId });
    if (!doc) throw new NotFoundException();          // same response for "absent" and "not yours"
    return view(doc);
  }

  @Patch(':id')
  @Scopes('documents:write')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto, @Req() req: any) {
    const { sub, tenantId, roles } = req.principal;
    const isTenantAdmin = roles.includes('tenant-admin');   // role scoped to token's tenant
    // authorization folded into the WHERE: atomic, no read-then-check race
    const res = await this.repo.update(
      isTenantAdmin ? { id, tenantId } : { id, tenantId, ownerId: sub },
      { title: dto.title, body: dto.body },                  // only allow-listed fields
    );
    if (res.affected === 0) throw new NotFoundException();
    return view(await this.repo.findOneByOrFail({ id, tenantId }));
  }
}`,
      },
      explanation: `**What was wrong and how it is fixed:**
- **BOLA on read** (API1): \`findOneBy({ id })\` returned any tenant's document. Every query now includes \`tenantId\` from the verified token.
- **Tenant from the query string** in \`list\`: attacker passes another tenant's id. Removed — tenant always comes from the principal.
- **Sequential integer IDs**: made enumeration trivial. Switched to UUIDs (\`ParseUUIDPipe\`) — defense in depth, *not* the fix (authorization is the fix).
- **Global "admin" role**: an admin of tenant X could edit tenant Y's docs. Now \`tenant-admin\` only within the token's tenant.
- **Null deref / info leak** in update: missing doc crashed with a 500; "not your document" (403) confirmed existence. Now uniform 404.
- **Mass assignment** (API3): \`Object.assign(doc, body)\` let callers set \`ownerId\`, \`tenantId\`, \`aclJson\`. Input DTO allow-list plus explicit field mapping.
- **Excessive data exposure** (API3): \`s3Key\`, \`internalNotes\`, \`aclJson\` were returned. Output DTO with \`excludeExtraneousValues\`.
- **Unbounded \`limit\`** (API4): capped at 100 and parsed as an int.
- **TOCTOU**: check-then-save could race with an ownership transfer; the conditional \`UPDATE ... WHERE owner\` is atomic.
- Belt and braces: add Postgres RLS on \`tenant_id\` so a future missed filter still fails closed.`,
      followUps: [
        {
          "q": "Documents can now be shared with users in other tenants (a 'share with external collaborator' feature). How does your authorization model change?",
          "a": "Tenant scoping stops being the whole rule; access becomes relationship-based. Add a `document_shares (document_id, grantee_user_id, permission)` table, or model it in a ReBAC engine (OpenFGA: `document#viewer@user:x`). Queries become `WHERE id=$1 AND (tenant_id=$tenant OR EXISTS (share for sub))`. RLS policies must include the share condition. Shared users should get a restricted view DTO (no internal fields) and must never gain list access to the owning tenant's other documents."
        },
        {
          "q": "How would you verify in CI that every endpoint in this API enforces tenant isolation?",
          "a": "Generate the test from the route table: for every route with an `:id` parameter, create a resource in tenant B, call the route with a valid tenant-A token (owner, member and admin roles), and assert 404 and no side effects (row unchanged). For list routes, assert that tenant B's ids never appear. Fail the build when a new route isn't covered, by comparing against Nest's discovered routes. With RLS enabled in the test database, a missing filter shows up as an empty result instead of a leak."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'api-security-iq-01',
      difficulty: 'hard',
      question:
        'We are launching a public API used by our own SPA, our iOS/Android apps, partner backends, and a CLI. Design authentication and authorization end to end.',
      context: 'Roughly 5M users, 200 partner integrations, NestJS microservices behind a gateway.',
      whatInterviewerLooksFor: [
        'Picks a different grant per client type and says why (not "just use JWT")',
        'Separates app identity (keys/client ids) from user identity (tokens)',
        'Puts coarse authZ at the edge and object-level authZ in services',
        'Has a revocation and key-rotation story',
        'Mentions BFF for the SPA and PKCE for mobile',
      ],
      modelAnswer: `### 1. Identity provider
Use a standards-based authorization server (Auth0/Okta/Keycloak/Cognito) rather than hand-rolling. It handles login, MFA, SSO federation (SAML/OIDC for enterprise customers), consent, and publishes OIDC discovery + JWKS.

### 2. Grant per client type
| Client | Grant | Notes |
|---|---|---|
| SPA | Auth Code + PKCE via a **BFF** | Tokens stay server-side; browser gets an HttpOnly, SameSite=Lax session cookie, so XSS can't steal tokens |
| iOS/Android | Auth Code + PKCE, system browser (ASWebAuthenticationSession / Custom Tabs) | Refresh tokens with rotation, stored in Keychain/Keystore |
| Partner backends | Client Credentials (their own data), or Auth Code if acting for our users | Per-partner client_id, secret or better \`private_key_jwt\`/mTLS |
| CLI | Device Authorization Grant | Like \`gh auth login\` |

### 3. Tokens
- Access tokens: JWT RS256, 10 min, \`aud\` per API, \`scope\`, \`tenant_id\`. Refresh tokens: opaque, rotated with reuse detection, 30-day absolute lifetime.
- Signing keys rotated quarterly with overlap in the JWKS; verifiers cache JWKS and refetch on unknown kid.

### 4. Enforcement
- **Gateway:** verify JWT (pinned alg, iss, aud, exp), check route scopes, per-client rate limits (partners get quota tiers), strip client-sent identity headers.
- **Services:** re-verify (zero trust) and do object-level checks: every query scoped by tenant/owner. Complex sharing rules go to a policy engine (OPA or OpenFGA).
- **Service to service:** mesh mTLS for workload identity, plus token exchange so downstream services see a narrowed token.

### 5. Operations
- Revocation: short access TTL, a per-user revoked-after timestamp in Redis for password reset, refresh-family revocation.
- Audit log of auth events; alerts on refresh reuse, spikes in 401/403, and one principal enumerating many ids.
- A threat model (STRIDE) per new endpoint group and BOLA regression tests in CI.`,
      followUps: [
        { q: 'Why not just give partners API keys?', a: 'Keys are fine for identifying the partner app and metering, but they don\'t expire, can\'t be scoped per user, and can\'t express delegation. If partners act on behalf of our users they need OAuth with user consent. For their own data, client credentials with short-lived tokens beats a static key because a leaked token dies in minutes.' },
        { q: 'How do you log a user out of all devices immediately?', a: 'Revoke every refresh-token family for the user in the AS, and set revoked-after:{sub} = now in Redis with TTL = max access-token lifetime. Gateways reject tokens with iat <= that timestamp. Worst-case lag is the Redis propagation, not the 10-minute exp.' },
        { q: 'The AS goes down. What still works?', a: 'With JWTs, existing sessions keep working until their access tokens expire (validation is local with cached JWKS). New logins and refreshes fail, so users drop off over roughly 10 minutes. That is why the AS needs multi-AZ HA, and why JWKS caching must survive AS downtime.' },
      ],
      pitfalls: [
        'Using the implicit flow or storing tokens in localStorage for the SPA',
        'Checking only scopes and assuming that covers object access',
        'Sending the ID token to APIs',
        'No plan for key rotation or revocation',
      ],
    },
    {
      id: 'api-security-iq-02',
      difficulty: 'expert',
      question:
        'At 2am security tells you an attacker has a batch of valid access and refresh tokens for about 3,000 users, scraped from a compromised logging pipeline. Walk me through the response.',
      whatInterviewerLooksFor: [
        'Contain first, investigate in parallel',
        'Knows JWTs cannot be un-issued and uses the right revocation lever',
        'Fixes the root cause (tokens in logs) and not just the symptom',
        'Assesses blast radius via audit logs',
        'Thinks about signing keys versus tokens',
      ],
      modelAnswer: `### Contain (first 15 to 30 minutes)
1. **Stop the leak.** Shut off or quarantine the log sink, and rotate the log pipeline's credentials. Any token still flowing into it is newly compromised.
2. **Kill the refresh tokens.** Revoke every refresh-token family for the 3,000 users at the AS. This is the durable credential, and without it an attacker's access ends at the next access-token expiry.
3. **Kill the live access tokens.** They are JWTs with a 10 to 15 minute TTL, so either:
   - set \`revoked-after:{sub} = now\` in Redis for the 3,000 users (the gateway checks it), or
   - if we can't scope the leak confidently (we don't know which users are affected), rotate the **signing key**. That invalidates every token globally and forces everyone to refresh. Refresh still works for unaffected users, so the cost is a burst of refresh traffic, not a mass logout.
4. Is the signing key itself compromised? If the logs contained private keys or client secrets, rotate those immediately. That is a much bigger incident.

### Investigate
- Pull the gateway access logs for the affected \`sub\`s and \`jti\`s: requests from unusual IPs, ASNs, or user agents since the leak window started. The \`jti\` and \`client_id\` let you tell attacker use apart from legitimate use.
- Scope the damage: which data was read, and which writes happened (orders, payouts, email changes)? Reverse fraudulent writes.

### Eradicate the root cause
- Tokens in logs means the \`Authorization\` header or query-string tokens were logged. Add redaction at the logger (pino \`redact: ['req.headers.authorization']\`), scanners in CI, and a DLP rule on the log store.
- Harden: sender-constrained tokens (DPoP/mTLS) make a replayed bearer token useless. Shorten access TTL for high-risk scopes.

### Communicate
Notify affected users and force a re-login, with a password reset if session hijack could have changed credentials. Check legal and regulatory notification duties (GDPR allows 72 hours). Write a blameless postmortem.`,
      followUps: [
        { q: 'Why not just add all leaked jti values to a denylist?', a: 'You can, and it is precise. But you must be sure the list is complete, and every refresh mints new jtis the attacker could also get if they hold refresh tokens. A per-user revoked-after timestamp covers all tokens past and in-flight for those users in one key each, which is simpler and safer.' },
        { q: 'What does signing-key rotation cost at 5M users?', a: 'Every active client gets a 401 and refreshes within about 10 minutes. With, say, 500K concurrent sessions that is roughly 800 refreshes/s spread over 10 minutes, which a well-provisioned AS handles. It is worse if clients all retry at once, so jittered client backoff matters.' },
      ],
      pitfalls: [
        'Waiting for tokens to expire naturally while refresh tokens remain valid',
        'Rotating keys but forgetting to plug the logging leak',
        'Not using audit logs to determine what the attacker actually did',
      ],
    },
    {
      id: 'api-security-iq-03',
      difficulty: 'hard',
      question:
        'A customer reports they can see another company\'s invoices by changing the number in the URL. Everything is behind OAuth and the tokens validate. How did this happen, how do you fix it now, and how do you make sure it never happens again?',
      whatInterviewerLooksFor: [
        'Names it BOLA (OWASP API1) and explains why authentication did not help',
        'Gives an immediate hotfix plus a structural fix',
        'Uses layered defenses: query scoping, RLS, tests, detection',
        'Investigates past exploitation',
      ],
      modelAnswer: `### Diagnosis
This is **Broken Object Level Authorization** (OWASP API #1). The token proved *who* the caller is. The handler then did \`SELECT * FROM invoices WHERE id = $1\` with no ownership predicate. Sequential IDs made it trivially enumerable. The gateway couldn't catch it because it doesn't know who owns invoice 1043.

### Immediate (hours)
1. Hotfix the handler: \`WHERE id = $1 AND tenant_id = $2\`, with the tenant taken from the verified token. Return 404, not 403.
2. Grep for the same pattern across all \`:id\` routes, since the bug is rarely in one place.
3. **Assess exposure:** query the access logs for principals that requested invoice IDs outside their tenant (join the log's \`sub\`/\`tenant\` to \`invoices.tenant_id\`). Count the affected records and tenants. This drives breach notification.

### Structural (weeks)
- **Data-layer backstop:** Postgres Row-Level Security with \`current_setting('app.tenant_id')\` set per transaction, so a missed filter returns nothing instead of leaking.
- **Repository pattern:** a tenant-scoped repository that makes unscoped queries impossible to write by accident, plus a lint rule banning raw \`findOneBy({ id })\`.
- **Unguessable IDs** (UUIDv7/ULID): defense in depth only.
- **Tests:** a two-tenant BOLA suite in CI that replays every ID route with a foreign token.
- **Detection:** alert when one principal hits a high rate of 404s on ID routes or touches many distinct IDs sequentially.
- **Process:** add "object-level authZ" to the PR checklist and the threat model.`,
      followUps: [
        { q: 'Would switching to UUIDs have fixed it?', a: 'No. It makes enumeration hard but not impossible: IDs leak in URLs, emails, shared links, and logs. Authorization must not depend on the secrecy of an identifier. UUIDs are a good second layer.' },
        { q: 'RLS has a cost. When is it worth it?', a: 'For multi-tenant SaaS, the policy check is a predicate on an indexed tenant_id column and usually costs single-digit percent. The main risks are connection-pool leakage of the session variable (use SET LOCAL inside a transaction) and superuser/BYPASSRLS roles. For tenant isolation it is almost always worth it.' },
      ],
      pitfalls: [
        'Blaming the gateway or saying "we need better JWT validation"',
        'Relying on UUIDs as the fix',
        'Fixing one endpoint without auditing the others or checking the logs for past exploitation',
      ],
    },
    {
      id: 'api-security-iq-04',
      difficulty: 'expert',
      question:
        'Your team debates JWT access tokens validated locally versus opaque tokens with introspection. The API does 40K RPS across 60 services. Make the call and defend it.',
      whatInterviewerLooksFor: [
        'Quantifies the latency and load impact of introspection',
        'Addresses revocation latency explicitly',
        'Knows the hybrid (phantom token) pattern',
        'Considers availability coupling to the AS',
      ],
      modelAnswer: `### The numbers
- Pure introspection: 40K RPS, and if every service introspects every hop (average fan-out 3), that is ~120K introspection calls/s against the AS, each adding 1 to 5 ms. The AS becomes the most critical and most loaded system in the company.
- Local JWT verification: ~50 us of CPU per verify. At 120K verifies/s that is ~6 CPU-seconds per second, about 6 cores spread across the fleet. Negligible.

### Recommendation: a hybrid
1. **External clients get opaque tokens.** Nothing leaks to third parties (claims, internal IDs), tokens are small, and revocation is instant at the edge.
2. **The gateway introspects** and caches the result keyed by token hash for min(30 s, remaining TTL). With cache hits the AS load drops to roughly new tokens/s plus 1/30 per active token, so a few hundred to a few thousand calls/s.
3. **The gateway mints a short-lived internal JWT** (60 s, internal signing key, \`aud\` = internal) carrying sub, tenant, and scopes. Services verify locally.

### Why not pure JWT everywhere?
It works and many companies do it. The cost is that revocation needs a denylist, token size grows (1 to 2 KB per request header), and claims are visible to clients. If we choose it: 5 to 10 minute TTL plus a per-user revoked-after check in Redis at the gateway only.

### Revocation latency
- Hybrid: at most the introspection cache TTL (30 s) plus the internal JWT TTL (60 s).
- Pure JWT: up to the access-token TTL, unless a denylist is checked.

### Availability
Introspection couples every request to the AS. Mitigate with cache TTLs, multi-region AS, and a documented fail-closed decision. For auth, fail closed: a brief outage is better than an open door.`,
      followUps: [
        { q: 'Would you ever cache introspection negatively?', a: 'Yes, briefly (around 5 s) for inactive results to absorb floods of garbage tokens. Keep it short so a just-issued token isn\'t wrongly rejected due to replication lag.' },
        { q: 'What goes in the internal JWT, and what doesn\'t?', a: 'Include sub, tenant, scopes, client_id, an act claim if delegated, and a trace id. Leave out PII like email and permissions lists that change often; services look those up. Keep it under about 1 KB.' },
      ],
      pitfalls: [
        'Every service introspecting every request',
        'Claiming JWTs can be revoked without infrastructure',
        'Ignoring AS availability coupling',
      ],
    },
    {
      id: 'api-security-iq-05',
      difficulty: 'hard',
      question:
        'Your orders service calls payments, inventory, and notifications. How should those calls be authenticated, and how does payments know which end user the charge is for without trusting orders blindly?',
      whatInterviewerLooksFor: [
        'Separates workload identity from user context',
        'Knows mTLS/SPIFFE and client credentials',
        'Understands the confused-deputy risk and token exchange',
        'Uses least privilege between services',
      ],
      modelAnswer: `### Workload identity: which service is calling?
- **Service mesh mTLS** (Istio/Linkerd): every pod gets a SPIFFE identity tied to its Kubernetes service account, certificates rotate automatically (Istio default is 24h), and traffic is encrypted. An \`AuthorizationPolicy\` on payments allows only \`orders\` and \`refunds\` to call \`POST /charges\`.
- Without a mesh, use OAuth2 client credentials: orders gets a token with \`aud=payments\` and caches it until shortly before expiry.

### User context: on whose behalf?
Don't forward the edge token as is. Its \`aud\` is the public API, it may carry broad scopes, and if orders is compromised it can replay it anywhere. Options:
- **Token exchange (RFC 8693):** orders exchanges the user token for one with \`aud=payments\`, scope \`payments:charge\`, \`sub=user\`, and \`act={sub: orders}\`. Payments verifies both: the user is entitled, and orders is an allowed actor.
- Or the gateway mints an internal JWT (60 s) that each service verifies.

### Payments must still authorize
- Derive user and tenant from the verified token, not from the request body, which prevents the confused deputy.
- Check business invariants: the order belongs to that user, the amount matches the order total held by payments or orders, not the request.
- Use idempotency keys so a replayed charge doesn't double-bill.

### Least privilege
Notifications has no need to call payments, so the mesh policy denies it by default. Network policies add L3/L4 isolation underneath.`,
      followUps: [
        { q: 'mTLS is on. Isn\'t that enough?', a: 'It proves orders is calling, not that the user authorized this charge. A compromised or buggy orders service could charge any user. You need the user context too, cryptographically verifiable.' },
        { q: 'What about async calls via Kafka?', a: 'Put the verified principal (sub, tenant, actor) in event headers, ideally signed or at least written only by trusted producers enforced via Kafka ACLs. Consumers re-authorize on the domain rules. Tokens themselves don\'t fit, since they expire before replay.' },
      ],
      pitfalls: [
        'Trusting any request from inside the VPC',
        'Passing userId in the request body',
        'One shared service account for all services',
      ],
    },
    {
      id: 'api-security-iq-06',
      difficulty: 'medium',
      question:
        'Run a quick STRIDE threat model on a new "export my data" feature: user clicks export, a job builds a ZIP of their data in S3, and they get an email with a download link.',
      whatInterviewerLooksFor: [
        'Draws trust boundaries first',
        'Gives a concrete threat for every letter',
        'Proposes proportional, specific mitigations',
        'Spots the email link as a bearer credential',
      ],
      modelAnswer: `### Elements and trust boundaries
User, then API (internet boundary), then a job queue, then an export worker, then the database and S3 (data-store boundary), then the email provider (third party), then the user's inbox (outside our control).

### STRIDE
- **Spoofing:** anyone with the emailed link downloads the data, because the link is a bearer credential. Use an S3 presigned URL with a 15-minute expiry, generated only after the user re-authenticates in the app, rather than a long-lived link in email. The email just says "your export is ready, log in to download".
- **Tampering:** the worker takes \`userId\` from the job payload, and a malicious enqueue could export someone else's data. The job carries the authenticated principal from the API. Only the API can enqueue (queue ACLs), and the worker re-checks.
- **Repudiation:** "I never requested an export". Keep an audit log of request, generation, and download with IP and user agent.
- **Information disclosure:** the ZIP sits in S3 forever, or the bucket is public. Use a private bucket, SSE-KMS encryption, a lifecycle rule deleting after 7 days, and block public access. Export only the requester's own data (BOLA at the job level).
- **Denial of service:** repeated export requests each scanning gigabytes. Allow one concurrent export per user and N per day, and give exports a separate, lower-priority worker pool.
- **Elevation of privilege:** the worker's IAM role can read all buckets. Least privilege: write to the export prefix only, read the DB through a tenant-scoped role.

### Prioritize
Fix spoofing via the link and the tampered job payload first (high impact, easy to exploit), then retention and rate limits.`,
      followUps: [
        { q: 'How do you rank threats in practice?', a: 'Likelihood times impact on a simple 1 to 3 scale, or CVSS for external reporting. What matters is that every high item gets an owner and a ticket before launch.' },
        { q: 'When would you repeat the threat model?', a: 'On any new trust boundary: a new third party, a new data store, a new public endpoint, a change in auth, or a significant data classification change.' },
      ],
      pitfalls: [
        'Listing STRIDE definitions without applying them to the feature',
        'Treating the email link as safe because it is "random"',
        'Skipping the worker/queue boundary',
      ],
    },
    {
      id: 'api-security-iq-07',
      difficulty: 'expert',
      question:
        'We need to rotate the RSA key that signs all our access tokens, with no user-visible impact, across 60 services and some partners who validate our tokens themselves. Plan it.',
      whatInterviewerLooksFor: [
        'Understands JWKS caching and kid semantics',
        'Sequences publish, then sign, then retire with correct wait times',
        'Handles external verifiers with slow caches',
        'Covers the emergency (compromise) variant',
      ],
      modelAnswer: `### Preconditions
- Every verifier resolves keys by \`kid\` from the JWKS (discovery URL), caches it (say 24h max-age), and refetches on an unknown kid with a cooldown. Audit this first. Any service with a hard-coded PEM is a blocker.

### Planned rotation timeline
1. **T0, publish:** add key K2 (new kid) to the JWKS *alongside* K1. Keep signing with K1.
2. **Wait at least the maximum JWKS cache TTL** among all verifiers, including partners (announce the change; say 48h to be safe). Verify with metrics: the kid refetch counter, and partner confirmation.
3. **T1, switch signing to K2.** New tokens carry kid=K2. Even a verifier with a stale cache refetches on the unknown kid.
4. **Wait at least the maximum token lifetime** (access 15 min; also any longer-lived signed artifacts such as signed URLs or ID tokens).
5. **T2, remove K1** from the JWKS. Watch 401 rates by kid for regressions.

### Automation
Do this on a schedule (for example every 90 days) via the AS's rotation feature or a job holding the key in KMS/HSM, so the private key never leaves the HSM. A routine rotation is also a drill for the emergency case.

### Emergency (key compromised)
- Skip the waits: publish K2, switch signing immediately, **remove K1 right away.** Every K1 token becomes invalid, so clients refresh. Refresh tokens are opaque and stored at the AS, so they still work unless they are also suspect.
- Expect a refresh storm. Scale the AS and make sure client backoff is jittered.
- Partners with long caches will reject K2 tokens until they refetch, so push notifications or webhooks to force it.

### Observability
Dashboards for token-validation failures by \`kid\` and by service, and JWKS fetch counts. These show exactly who hasn't picked up the new key.`,
      followUps: [
        { q: 'Why not sign with both keys at once?', a: 'A JWS compact token has one signature. JWS JSON serialization allows several, but almost no verifiers support it. The overlap is achieved by publishing both public keys, not by dual-signing.' },
        { q: 'A verifier refetches the JWKS on every unknown kid with no cooldown. Risk?', a: 'An attacker sends tokens with random kids, and each one triggers an outbound JWKS fetch. That amplifies into a DoS on your IdP and on the service. Cooldowns (e.g. one fetch per 30 s) and caching negative results prevent it.' },
      ],
      pitfalls: [
        'Switching signing before verifiers have the new public key',
        'Removing the old key before issued tokens expire',
        'Storing the private key on the application filesystem',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'api-security-boe-1',
      question:
        'Opaque tokens are introspected at the gateway with a result cache. Estimate the load on the authorization server for (a) per-pod in-memory caches behind round-robin load balancing and (b) a shared Redis cache.',
      assumptions: [
        '40K RPS at the edge (peak), 20 gateway pods behind round-robin',
        '400K concurrently active users, each making about 1 request every 10 s',
        'Introspection cache TTL = 60 s (capped at the token\'s remaining lifetime)',
        'One introspection call costs about 2 ms on the AS; a cached entry is about 500 B',
      ],
      steps: [
        { label: 'Requests per user per TTL window', calc: '60 s ÷ 10 s = 6 requests per user per 60 s window' },
        { label: '(a) Per-pod cache: requests land on random pods', calc: '6 requests spread over 20 pods, so nearly every request hits a pod that hasn\'t seen this token (P(hit) ≈ 1 − (19/20)^k, small for k ≤ 5) ⇒ ~85–95% misses ⇒ ≈ 35K introspections/s' },
        { label: '(b) Shared cache: one miss per user per TTL', calc: '400K users ÷ 60 s ≈ 6.7K introspections/s (≈ 17% of edge traffic)' },
        { label: 'AS capacity needed for (b)', calc: '6.7K/s × 2 ms ≈ 13 CPU-seconds per second ⇒ ~13 cores busy, ×2 headroom ≈ 26 cores' },
        { label: 'Shared cache memory', calc: '400K entries × 500 B ≈ 200 MB, so one small Redis node (plus a replica)' },
        { label: 'TTL 300 s instead', calc: '400K ÷ 300 ≈ 1.3K/s, but revocation lag grows to 5 min' },
      ],
      answer:
        'Per-pod caches barely help (~35K/s, close to the raw request rate). A shared cache cuts AS load to ~6.7K/s at a 60 s TTL, needing about 200 MB of Redis.',
      insight:
        'Cache locality matters as much as TTL. Either share the introspection cache or route by token hash (consistent hashing) so each token stays on one pod. The TTL is the direct knob between AS load and revocation latency. If you need both a low TTL and a low AS load, use the phantom-token pattern: introspect once, then mint short-lived internal JWTs.',
      followUps: [
        {
          "q": "Peak traffic doubles to 80K RPS but the active-user count stays at 400K. What happens to AS load with the shared cache?",
          "a": "Nothing changes much. With a shared cache, AS load is driven by distinct tokens per TTL window (400K ÷ 60 s ≈ 6.7K/s), not by request volume. The doubled traffic just raises the hit rate from about 83% to about 92%. The new bottleneck is Redis: 80K GETs/s plus 6.7K SETs/s fits on one node, but add read replicas or client-side caching for headroom. Per-pod caches would have roughly doubled AS load to about 70K/s."
        },
        {
          "q": "The shared Redis cache goes down. What does the AS see, and how do you avoid a cascade?",
          "a": "Every request misses, so introspection load jumps from 6.7K/s to the full 40K/s, about 6× the 26-core sizing, and the AS falls over, taking login down with it. Defences: keep a small per-pod in-memory L1 cache in front of Redis (it absorbs some load), coalesce concurrent introspections of the same token (single-flight), put a circuit breaker and concurrency limit on AS calls, and run Redis with a replica and automatic failover. Load-test the AS at the 'cache down' rate, not the steady state."
        }
      ],
    },
    {
      id: 'api-security-boe-2',
      question:
        'Size the Redis memory for JWT revocation: (a) a jti denylist for normal logouts and (b) a per-user "revoked-after" key for a mass forced logout of all 5M users.',
      assumptions: [
        'Access-token TTL = 15 min; a revoked token has on average 7.5 min left',
        '2M explicit logouts per day',
        'Redis key + value + overhead ≈ 100 B for a jti entry, ≈ 120 B for a revoked-after entry',
        'Every entry has TTL = remaining token lifetime (≤ 15 min)',
      ],
      steps: [
        { label: 'Logout rate', calc: '2M ÷ 86,400 ≈ 23 logouts/s (peak ×3 ≈ 70/s)' },
        { label: '(a) Steady-state entries (Little\'s law: L = λ × W)', calc: '70/s × 450 s ≈ 31.5K entries' },
        { label: '(a) Memory', calc: '31.5K × 100 B ≈ 3 MB, trivial' },
        { label: '(a) With no TTL on entries', calc: '2M/day × 365 × 100 B ≈ 73 GB/year, unbounded growth' },
        { label: '(b) Mass revocation, one key per user', calc: '5M × 120 B ≈ 600 MB for 15 min, then it all expires' },
        { label: '(b) Alternative: one global cut-off', calc: 'a single key "revoked-after:*" = now: 1 key, same effect as signing-key rotation' },
      ],
      answer:
        'The normal jti denylist needs only a few MB because entries expire with the tokens. A per-user mass revocation briefly needs ~600 MB. A global cut-off timestamp (or key rotation) does the same job in O(1).',
      insight:
        'Denylists for short-lived JWTs are cheap only because each entry\'s TTL equals the token\'s remaining lifetime. Forgetting the TTL turns them into an ever-growing database. For "everyone" events use a global timestamp or rotate the signing key rather than millions of per-user keys.',
      followUps: [
        {
          "q": "Access-token TTL goes from 15 minutes to 24 hours to reduce refresh traffic. Redo the denylist sizing and say what else changes.",
          "a": "Average remaining life becomes about 12 h = 43,200 s, so steady-state entries are 70/s × 43,200 ≈ 3M entries × 100 B ≈ 300 MB. Still manageable, but 100× bigger. Mass per-user revocation needs 5M × 120 B ≈ 600 MB held for 24 h instead of 15 min. Worse is the security side: a stolen token now lives a day, so the denylist becomes mandatory on every request rather than defence in depth, and Redis availability becomes part of your auth path's SLO."
        },
        {
          "q": "The denylist lives in one region's Redis, but you serve from three regions. How do revocations propagate, and what's the exposure window?",
          "a": "Write the revocation locally and replicate it: publish revocation events to a global stream (Kafka with MirrorMaker, or a multi-region pub/sub), and each region applies them to its local Redis. Typical cross-region lag is 100 ms–2 s, so a revoked token might work in another region for about that long, which is acceptable for logout. For forced-logout incidents, also rotate the signing key or bump a global revoked-after timestamp held in a strongly consistent config store that every region reads."
        }
      ],
    },
    {
      id: 'api-security-boe-3',
      question:
        'The platform team wants to put user roles, permissions, and group memberships inside the JWT "so services don\'t need lookups". Estimate the bandwidth and header-size impact.',
      assumptions: [
        'Lean JWT ≈ 800 B; the proposed rich JWT ≈ 6 KB (base64url inflates JSON by about 33%)',
        '40K RPS at the edge; each request fans out to 3 internal hops that forward the token',
        'Default limits: nginx large_client_header_buffers 4 × 8 KB (a single header line must fit in 8 KB); Node.js max header size 16 KB',
      ],
      steps: [
        { label: 'Token-bearing requests per second', calc: '40K × (1 edge + 3 internal) = 160K/s' },
        { label: 'Lean token bandwidth', calc: '160K × 800 B ≈ 128 MB/s ≈ 1 Gbps' },
        { label: 'Rich token bandwidth', calc: '160K × 6 KB ≈ 960 MB/s ≈ 7.7 Gbps, just for the Authorization header' },
        { label: 'Header limit headroom', calc: '6 KB token + cookies + tracing headers can exceed nginx\'s 8 KB line buffer ⇒ 400/494 errors for power users with many groups' },
        { label: 'Staleness', calc: 'role change takes effect after up to 15 min (token TTL); removing a fired admin is not instant' },
      ],
      answer:
        'The rich token adds roughly 7 Gbps of header traffic fleet-wide, risks hitting 8 KB header limits for users with many groups, and makes permission changes lag by up to the token TTL.',
      insight:
        'Keep access tokens lean: identity, tenant, and coarse scopes. Resolve fine-grained permissions at the service or policy engine (OPA/OpenFGA) with a short local cache. HTTP/2 HPACK compression helps only on repeated headers within one connection, so it does not remove the cost at the edge or the staleness problem.',
      followUps: [
        {
          "q": "You keep the lean token and move to a policy engine (OpenFGA) for permission checks. Estimate the authorization lookup load and how to cache it.",
          "a": "Every request checks permissions: 40K edge RPS × 3 hops ≈ 160K checks/s if each service checks. Cut it by checking once per request at the service that owns the resource (about 40K/s) and caching decisions locally keyed by (user, relation, object) with a short TTL (10–30 s). Hit rates are high because users repeat actions. 40K/s on OpenFGA needs a few replicas with a read-optimised datastore. Use consistency tokens (zookies) only for checks that must see a just-granted permission."
        },
        {
          "q": "A single user belongs to 3,000 groups and their requests fail with 431 even with the lean token. Why, and what's the fix?",
          "a": "The lean token is fine, so something else is bloating headers. Usually cookies (an IdP or session cookie embedding group claims) or a SAML-derived header that the BFF forwards. 431 is 'Request Header Fields Too Large'. Find the large header in the gateway's logs (log header sizes, not values), then stop shipping group lists in any header. Resolve memberships server-side via the policy engine. Raising buffer limits only postpones the problem for the next user with 6,000 groups."
        }
      ],
    },
  ],
  test: [
    {
      id: 'api-security-mcq-01',
      difficulty: 'expert',
      question: 'The IdP signs RS256 tokens. An attacker forges a token that this verifier accepts. What is the most likely technique?',
      code: {
        language: 'typescript',
        code: `const publicPem = fs.readFileSync('idp-public.pem', 'utf8'); // published by the IdP
export function verify(token: string) {
  const { header } = jwt.decode(token, { complete: true })!;
  return jwt.verify(token, publicPem, { algorithms: [header.alg as jwt.Algorithm] });
}`,
      },
      options: [
        'Brute-forcing the RSA private key offline from captured tokens',
        'Setting alg to HS256 and HMAC-signing the token using the public PEM as the shared secret',
        'Replaying an expired token, because jwt.verify skips exp when algorithms is set',
        'Changing the kid header so the verifier loads a different public key',
      ],
      correct: [1],
      explanation:
        'Letting the token header choose the algorithm enables RS/HS confusion. With alg HS256 the library treats the key string as an HMAC secret, and the public PEM is public, so the attacker can compute a valid MAC. Some libraries now refuse to use a PEM public key as an HMAC secret, but that should not be your defense. Pin algorithms to RS256. Brute-forcing RSA-2048 is infeasible. exp is still checked. kid is not used by this code at all.',
      followUps: [
        {
          "q": "You pin `algorithms: ['RS256']`. The IdP announces it will move to ES256 next quarter. How do you migrate verifiers without opening the confusion hole again?",
          "a": "Pin per key, not per token: allow `['RS256','ES256']` only, and bind each JWKS key to its own algorithm (`alg` and `kty` in the JWK). The verifier must check that the header alg matches the selected key's alg. Libraries like `jose` do this when you pass the JWKS. Rollout: verifiers first accept both, then the IdP publishes the EC key and waits out the JWKS cache TTL, then switches signing. Once RS256 tokens have expired (15 min plus margin), remove RS256 from the allow-list and the JWKS."
        },
        {
          "q": "How would you scan 60 services to find any other verifier with this bug?",
          "a": "Search the code for `jwt.verify(` and `jwtVerify(` calls whose `algorithms` option is missing or derived from `decode(...).header`. Add a lint rule (eslint `no-restricted-syntax`) to block that pattern in CI. Then test the running services: a DAST job sends each API an HS256 token MAC'd with the public PEM, an `alg: none` token and a token with a bogus `kid`, and asserts 401 every time. Best of all, move every service onto one shared auth library or gateway so there's one implementation to get right."
        }
      ],
    },
    {
      id: 'api-security-mcq-02',
      difficulty: 'hard',
      question:
        'A React SPA needs to call your APIs for logged-in users, and the security team is most worried about XSS stealing tokens. Which architecture best addresses that?',
      options: [
        'Authorization Code + PKCE in the browser, with the access token in localStorage and a 5-minute expiry',
        'Implicit flow with the access token in sessionStorage so it disappears when the tab closes',
        'A Backend-for-Frontend acting as a confidential client that holds the tokens server-side and issues an HttpOnly, Secure, SameSite session cookie',
        'Authorization Code + PKCE with the refresh token stored in an in-memory JavaScript variable and rotated on every call',
      ],
      correct: [2],
      explanation:
        'Any token readable by JavaScript can be exfiltrated by XSS, whether it sits in localStorage, sessionStorage, or memory. Memory only shrinks the window. With a BFF the browser never holds a token. The cookie is HttpOnly so script cannot read it, and SameSite plus CSRF tokens handle cross-site request forgery. Implicit flow is deprecated and still exposes tokens to JS. PKCE in the browser is acceptable, but it does not solve token theft by XSS.',
      followUps: [
        {
          "q": "With the BFF, an attacker who achieves XSS can still make API calls through the user's session cookie. So what did you actually gain?",
          "a": "You turned token theft into session riding, which is much less damaging. With XSS the attacker can act only while the victim's page is open, from the victim's browser, through your BFF. You can rate-limit, log and revoke that session server-side. Without a BFF, a stolen refresh token works from the attacker's own machine for days, invisibly. Combine the BFF with a strict CSP (no inline scripts, nonce-based) to make the XSS itself harder, and short idle timeouts to cap the window."
        },
        {
          "q": "The BFF now handles all SPA traffic at 20K RPS. What does it cost you operationally, and how do you scale it?",
          "a": "It becomes stateful: it maps session id to tokens. Store sessions in Redis (session cookie → encrypted access and refresh tokens, around 2–4 KB each), so BFF pods stay stateless and scale horizontally. Token refresh happens server-side, so use a per-session lock to stop parallel requests from refreshing simultaneously and tripping refresh-token reuse detection. It adds one hop of latency (~1–2 ms in-region). Keep it thin, proxying with token injection only, so it doesn't turn into a second monolith."
        }
      ],
    },
    {
      id: 'api-security-mcq-03',
      difficulty: 'expert',
      question:
        'Your AS implements refresh-token rotation. It receives a refresh token that was already exchanged 10 minutes ago. Select ALL appropriate actions.',
      options: [
        'Revoke the entire token family descended from that login, including the newest refresh token',
        'Issue new tokens anyway, since the user is probably on a flaky network retrying',
        'Reject the request with invalid_grant and emit a security event or alert for the user and client',
        'Revoke only the presented (old) token, since it is already used',
        'Increase the access-token lifetime for that user to reduce refresh frequency',
      ],
      correct: [0, 2],
      explanation:
        'Reuse of a rotated refresh token means two parties hold the same credential, and the AS cannot tell which one is the attacker. So it revokes the whole family, forcing both to re-authenticate, and flags the event. Many implementations allow a short grace period of a few seconds for genuine network retries, but 10 minutes is not a retry. Revoking only the old token leaves the attacker, who may hold the newest token, logged in. Longer lifetimes widen exposure.',
      followUps: [
        {
          "q": "Mobile users on flaky networks occasionally trigger family revocation by genuinely retrying a refresh. How do you stop false positives without losing reuse detection?",
          "a": "Add a short grace window: if the old refresh token is presented again within a few seconds (for example 10 s) of its rotation, from the same client and device binding, return the same new token pair that was just issued (idempotent replay) instead of revoking. Outside that window, or from a different IP or device fingerprint, treat it as reuse and revoke the family. Log grace replays separately so you can tune the window. Also make clients persist the new token before discarding the old one."
        },
        {
          "q": "How do you represent a 'token family' so revoking it is O(1) even after 500 rotations?",
          "a": "Store a `family_id` (the original login grant) on every refresh token record. Revoking means setting `families.revoked_at = now()` (one row), and every refresh checks the family row first. Access tokens carry `sid` (the family or session id), so resource servers can also deny them via a per-session revoked-after key if you need immediate cutoff. Old rotated tokens can be deleted aggressively, because you only need to remember 'used' long enough to detect reuse, typically the refresh token's max lifetime."
        }
      ],
    },
    {
      id: 'api-security-mcq-04',
      difficulty: 'hard',
      question: 'This handler is behind a gateway that fully validates JWTs. What is the vulnerability?',
      code: {
        language: 'typescript',
        code: `@Post('invoices/:id/pay')
@Scopes('invoices:write')
async pay(@Param('id') id: string, @Body() body: { tenantId: string; amount: number }) {
  const inv = await this.invoices.findOne({ where: { id, tenantId: body.tenantId } });
  if (!inv) throw new NotFoundException();
  return this.payments.charge(inv.id, body.amount);
}`,
      },
      options: [
        'Missing CSRF protection, because POST endpoints need a CSRF token even with bearer auth',
        'The scope check runs after the handler, so unauthenticated calls reach the database',
        'Tenant and amount are taken from the request body, so a caller can pay (or probe) any tenant\'s invoice with an arbitrary amount',
        'findOne is vulnerable to SQL injection through the id path parameter',
      ],
      correct: [2],
      explanation:
        'The query looks tenant-scoped, but the tenant comes from attacker-controlled input. That is BOLA in disguise, and the client-supplied amount is a tampering bug too. Tenant must come from the verified principal, and the amount from the invoice itself. Bearer-token APIs that do not use cookies are not CSRF-prone. Nest guards run before the handler. The ORM parameterizes id.',
      followUps: [
        {
          "q": "You fix this handler. How do you make sure the next engineer can't write the same bug in a different controller?",
          "a": "Make the safe path the default. Give repositories a tenant-scoped API: inject a request-scoped `TenantContext` from the verified principal, and expose `invoices.forTenant(ctx).findOne(id)` rather than raw `findOne` with arbitrary filters. Add Postgres RLS keyed on `current_setting('app.tenant_id')` as a backstop that fails closed. Add a lint rule banning `tenantId` in DTOs and request bodies, plus an authorization test suite that calls every route with tenant A's token against tenant B's ids and expects 404."
        },
        {
          "q": "Taking amount from the invoice fixes tampering. But product wants partial payments. How do you allow a client-supplied amount safely?",
          "a": "Treat the amount as a request to be validated against server state, not as truth: check `0 < amount ≤ invoice.outstanding`, in the invoice's currency, inside a transaction that locks the invoice row (or a conditional `UPDATE ... SET outstanding = outstanding - $1 WHERE id=$2 AND outstanding >= $1`). Require an idempotency key so a retried partial payment isn't applied twice. Record each payment as its own row linked to the invoice, so the outstanding balance is derived and auditable."
        }
      ],
    },
    {
      id: 'api-security-mcq-05',
      difficulty: 'expert',
      question:
        'You added a 60-second introspection cache inside each of 24 gateway pods (round-robin LB). AS load dropped only about 10%. Why, and what is the best fix?',
      options: [
        'The TTL is too short. Raising it to 10 minutes will fix the load with no downside.',
        'Each user\'s requests are spread across 24 pods, so most requests land on a pod with a cold entry. Use a shared cache (Redis) or route by token hash.',
        'Introspection responses cannot be cached per RFC 7662, so the gateway ignores the cache.',
        'Round-robin disables HTTP keep-alive to the AS, so each call opens a new TLS connection.',
      ],
      correct: [1],
      explanation:
        'Hit rate depends on how often the same token revisits the same cache within the TTL. With 24 independent caches and a few requests per user per minute, most lookups miss. A shared cache or token-affinity routing restores the hit rate. A longer TTL raises the hit rate slightly but also raises revocation latency, so it is not free. RFC 7662 allows caching and discusses its revocation trade-off. Keep-alive affects latency, not the number of calls.',
      followUps: [
        {
          "q": "You choose token-hash routing instead of Redis. What happens to the hit rate and the AS when you scale the gateway from 24 to 30 pods?",
          "a": "With consistent hashing (ring with virtual nodes), adding 6 pods remaps about 6/30 = 20% of tokens to new owners. Those tokens miss once, so introspection load briefly rises by about 20% of the steady-state miss rate for one TTL window (60 s), then settles. With naive `hash mod N`, almost every token remaps and the AS sees a near-total cold start, around the raw request rate, for a minute. That's an outage risk during autoscaling, so use consistent hashing with bounded load."
        },
        {
          "q": "Security wants revocation to take effect within 5 seconds, but you need the cache for AS load. How do you reconcile both?",
          "a": "Keep the 60 s cache but add push-based invalidation: when the AS revokes a token or session, it publishes an event (Redis pub/sub or Kafka) and gateways delete that cache entry immediately. Revocation latency becomes event propagation time, under a second, while normal traffic still hits the cache. If you use a shared Redis cache, the AS can simply delete the key. Keep the TTL as a safety net for missed events, and monitor the event lag."
        }
      ],
    },
    {
      id: 'api-security-mcq-06',
      difficulty: 'medium',
      question:
        'On Android, a malicious app registers the same custom URL scheme as your app and receives the authorization code from the redirect. Which control makes that stolen code useless?',
      options: [
        'The state parameter, because the malicious app cannot guess it',
        'A client secret embedded in the app, sent at the token endpoint',
        'Short authorization-code expiry of 60 seconds',
        'PKCE, because redeeming the code requires the code_verifier that only the legitimate app holds',
      ],
      correct: [3],
      explanation:
        'PKCE binds the code to a secret verifier created by the app that started the flow, so the interceptor cannot exchange it. state protects the legitimate client against CSRF and injected responses, not against code theft by another app. Secrets embedded in mobile apps can be extracted and are not secret. Short expiry narrows the window, but the attacker redeems immediately. Claimed HTTPS redirects (App Links) help as well.',
      followUps: [
        {
          "q": "PKCE is in place. Should you also use claimed HTTPS redirects (App Links / Universal Links)? What do they add?",
          "a": "Yes. PKCE makes a stolen code unredeemable, but a custom scheme still lets the malicious app receive the code and learn that a login happened, and it could phish the user with a fake 'login failed' screen. App Links tie the redirect URL to your verified domain via `assetlinks.json`, so the OS delivers it only to your signed app. The attacker never sees the code. Combine both: verified HTTPS redirect plus PKCE plus `state`, and use the system browser (Custom Tabs), not a webview."
        },
        {
          "q": "How would you test that your AS actually enforces PKCE?",
          "a": "Write negative tests against the token endpoint: start a flow with `code_challenge` (S256), then try redeeming the code with no `code_verifier`, with the wrong verifier, and with the challenge itself as the verifier. All must return `invalid_grant`. Then check that the AS rejects `code_challenge_method=plain` for public clients and that it refuses an authorization request with no challenge at all for that client (PKCE required, not optional). Run these in CI against a staging AS after every config change."
        }
      ],
    },
    {
      id: 'api-security-mcq-07',
      difficulty: 'expert',
      question:
        'A "reports" service holds a DB role that can read all tenants. A user of tenant A calls GET /reports?tenantId=B and receives tenant B\'s report. The user\'s token was valid. What is the precise name of this flaw, and what is the structural fix?',
      options: [
        'Confused deputy. The service acts with its own broad privilege on behalf of a less-privileged caller. Derive the tenant from the verified token and authorize as the user, ideally with a DB role or RLS scoped to that tenant.',
        'Broken authentication. Require MFA for report endpoints.',
        'SSRF. The service fetched data from an internal endpoint on the attacker\'s behalf. Add an egress allow-list.',
        'Improper inventory management. Move reports to a separate internal-only API version.',
      ],
      correct: [0],
      explanation:
        'The service\'s broad privilege was borrowed by a caller who lacks it: a classic confused deputy, and BOLA by OWASP taxonomy. The fix is to base authorization on the caller\'s verified identity and to shrink the service\'s own privilege per request (tenant-scoped role or RLS). Authentication worked fine. No outbound request to an attacker-chosen URL occurred, so it is not SSRF. Moving the endpoint does not change the logic.',
      followUps: [
        {
          "q": "The reports service runs heavy cross-tenant analytics for internal staff too. How do you keep that capability without reintroducing the confused deputy?",
          "a": "Split the paths by principal type. Tenant users go through an endpoint that derives the tenant from their token and queries under a tenant-scoped DB role or RLS. Internal staff use a separate admin endpoint that requires a distinct staff identity (workforce IdP, with an admin scope or role), justification logging and ideally just-in-time elevation. That path runs under a different DB role with cross-tenant read. Never let one endpoint switch behaviour based on a client-supplied `tenantId`."
        },
        {
          "q": "How do you implement RLS so a pooled connection can't leak one tenant's context into another request?",
          "a": "Set the tenant per transaction, not per session: `BEGIN; SET LOCAL app.tenant_id = $1; ...; COMMIT;`. `SET LOCAL` is discarded at transaction end, so a connection returned to the pool carries nothing over. Write policies like `USING (tenant_id = current_setting('app.tenant_id')::uuid)` and have `current_setting` raise an error if unset, so a forgotten SET fails closed. Use a non-owner DB role so RLS isn't bypassed, and enable `FORCE ROW LEVEL SECURITY`."
        }
      ],
    },
    {
      id: 'api-security-mcq-08',
      difficulty: 'hard',
      question:
        'A frontend developer sends the OIDC ID token (signed by your IdP, not expired) as the Bearer token to orders-api. Select ALL verifier checks that should cause it to be rejected.',
      options: [
        'aud check: the ID token\'s audience is the client_id, not orders-api',
        'Signature check against the IdP\'s JWKS',
        'typ check requiring at+jwt (RFC 9068 access-token profile)',
        'exp check with 60 s clock tolerance',
        'iss check against the IdP issuer URL',
      ],
      correct: [0, 2],
      explanation:
        'The ID token is genuinely signed by the same issuer and is not expired, so the signature, iss, and exp checks all pass. That is exactly why they are not sufficient. The audience check rejects it because ID tokens are addressed to the client. A typ check for at+jwt also rejects it where the IdP follows RFC 9068. Without these checks, any token for any client of the IdP would authenticate against your API.',
      followUps: [
        {
          "q": "Your IdP doesn't set `typ: at+jwt`, and the frontend's client_id happens to equal the API's audience string because of a lazy config. What now?",
          "a": "Then nothing in the token distinguishes an ID token from an access token, and you must fix the configuration. Register the API as a separate resource with its own audience (`https://orders.api`) and have the frontend request access tokens for it, so ID tokens carry the client_id and fail the `aud` check. As a stopgap, reject tokens that contain ID-token-only claims (`nonce`, `at_hash`) or lack the `scope` claim your access tokens always have. That's a heuristic, not a guarantee."
        },
        {
          "q": "orders-api is called by five different frontends. Should each have its own audience?",
          "a": "No. The audience identifies the resource (the API), not the caller, so all five frontends request tokens with `aud = orders-api`, and `azp` or `client_id` in the token records which frontend got it. Authorize per client through scopes and client policies on the AS (the partner portal can't get `orders:admin`). The API can additionally check `client_id` against an allow-list for sensitive routes. Separate audiences per API keep a token stolen from orders-api useless against payments-api."
        }
      ],
    },
    {
      id: 'api-security-mcq-09',
      difficulty: 'expert',
      question: 'What is the operational risk in this custom key resolver?',
      code: {
        language: 'typescript',
        code: `let keys = new Map<string, KeyObject>();
async function getKey(kid: string) {
  if (!keys.has(kid)) {
    const jwks = await fetch(JWKS_URL).then((r) => r.json());   // refresh on miss
    keys = new Map(jwks.keys.map((k: any) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
  }
  const key = keys.get(kid);
  if (!key) throw new Error('unknown kid');
  return key;
}`,
      },
      options: [
        'Keys are never refreshed, so rotation breaks verification',
        'Replacing the map discards keys that are still valid, so in-flight tokens fail after rotation',
        'createPublicKey accepts private JWKs, so a private key could leak',
        'An attacker can send tokens with random kid values to trigger an outbound JWKS fetch per request, a DoS on the service and the IdP',
      ],
      correct: [3],
      explanation:
        'Refetching on an unknown kid is correct behavior. Doing it without a cooldown or negative caching lets unauthenticated garbage tokens amplify into one IdP request each. Rate-limit refetches (for example once per 30 s) and cache unknown kids briefly. Keys are refreshed on miss. The map is rebuilt from the current JWKS, which still contains any key in its overlap period, so valid tokens keep working. createPublicKey derives the public part, and a JWKS endpoint should not serve private keys anyway.',
      followUps: [
        {
          "q": "Rewrite the resolver to fix the DoS without breaking legitimate key rotation.",
          "a": "Keep refetch-on-miss but serialise and throttle it: hold a single in-flight fetch promise so concurrent misses share one request, and enforce a cooldown (`lastFetch + 30s > now`, then skip the fetch and reject the unknown kid). Optionally cache unknown kids negatively for the cooldown period. Also validate the token cheaply before any fetch: well-formed, `alg` in the allow-list, `iss` matching. Garbage then never triggers network I/O. `jose`'s `createRemoteJWKSet({ cooldownDuration })` does exactly this."
        },
        {
          "q": "The IdP's JWKS endpoint itself goes down for 20 minutes. What happens to your service with the fixed resolver?",
          "a": "Tokens signed with already-cached keys keep verifying, so almost all traffic is fine because verification is local. Only tokens with a kid you haven't seen fail, which during the outage means none unless a rotation coincides. Make sure a failed refresh never clears the existing map: keep last-known-good keys and serve stale on error. Persisting the JWKS to disk on each successful fetch also protects pods that restart during the outage, which would otherwise start with no keys at all."
        }
      ],
    },
    {
      id: 'api-security-mcq-10',
      difficulty: 'hard',
      question:
        'During a routine signing-key rotation, the AS started signing with the new key K2 at the same moment K2 was added to the JWKS. For about an hour, some services reject most new tokens. What happened?',
      options: [
        'Services cached the JWKS and had no refetch-on-unknown-kid (or had a long cooldown), so K2 tokens failed until the cache expired',
        'Old K1 tokens were invalidated immediately, logging everyone out',
        'The new key used a different algorithm, and verifiers cannot mix algorithms in one JWKS',
        'Clock skew between the AS and the services made the new tokens appear not yet valid (nbf)',
      ],
      correct: [0],
      explanation:
        'The safe sequence is: publish the new key, wait at least the maximum JWKS cache TTL, then switch signing. Switching immediately relies on every verifier refetching on unknown kid, and a verifier that doesn\'t will fail until its cache refreshes. K1 was still published, so old tokens kept working. JWKS can hold keys of different algorithms. Clock skew would affect all tokens briefly (seconds), not for an hour, and not selectively by key.',
      followUps: [
        {
          "q": "The max JWKS cache TTL across your verifiers is unknown, since some partners validate your tokens too. How do you pick the wait time between publishing K2 and signing with it?",
          "a": "Set and publish it: serve JWKS with `Cache-Control: max-age=3600` and document 'cache at most 1 h, refetch on unknown kid'. Then wait at least 2× that, say 24–48 h for safety with partners, before switching signing. Use the time to watch JWKS fetch logs, which show who refetched since K2 appeared. Partners whose user agents haven't fetched in days get contacted. Prepublishing early is free, so there's no reason to rush the switch."
        },
        {
          "q": "How would you have detected the failure within the first minute rather than an hour?",
          "a": "Watch verification failures by reason and by kid. A spike in `unknown kid` or `signature invalid` rejections right after the AS switch is unambiguous. Alert on the 401 rate per service relative to baseline, and have the AS emit a 'signing key changed' event that dashboards annotate. A canary helps too: switch signing for a small slice of clients (or one region) first and watch their 401 rate before going global, which an AS with multiple active keys can support."
        }
      ],
    },
    {
      id: 'api-security-mcq-11',
      difficulty: 'expert',
      question:
        'After six months, the Redis instance backing the logout denylist is at 40 GB and growing. The access-token TTL is 15 minutes. What is the root cause and the right fix?',
      code: {
        language: 'typescript',
        code: `export async function logout(token: JWTPayload) {
  await redis.sadd('revoked-jtis', token.jti!);
}
export async function isRevoked(jti: string) {
  return (await redis.sismember('revoked-jtis', jti)) === 1;
}`,
      },
      options: [
        'Sets are memory-inefficient. Switch to a Bloom filter to cut memory by 90%.',
        'Entries never expire. Store each jti as its own key with a TTL equal to (exp − now), so the denylist only holds tokens that could still be used.',
        'The TTL should be on the whole set. Call EXPIRE revoked-jtis 900 after each SADD.',
        'Move the denylist into Postgres, which handles large tables better than Redis.',
      ],
      correct: [1],
      explanation:
        'A revoked JWT only needs to be remembered until its own exp, and after that the signature check rejects it anyway. Per-key TTLs bound the set to (logout rate × token lifetime), a few MB. A Bloom filter only shrinks an unbounded problem and adds false positives, which log out innocent users. EXPIRE on the whole set wipes every revocation every 15 minutes, including ones made seconds ago, and keeps being reset by new SADDs. Postgres moves the growth problem and adds latency.',
      followUps: [
        {
          "q": "You switch to per-jti keys with TTL. Every API request now does a Redis lookup. At 40K RPS, what does that cost, and can you avoid it?",
          "a": "40K GETs/s is easy for Redis (one node does 100K+ ops/s), adding about 0.3–0.5 ms per request in-region, but it makes Redis a hard dependency for every request. Reduce it: keep a local in-process copy of the denylist (small, a few MB) synced via pub/sub on each revocation, and check that first. Or only check the denylist for sensitive operations. Decide fail-open vs fail-closed if Redis is down: usually fail-open for reads and fail-closed for payments."
        },
        {
          "q": "Now you must delete the 40 GB legacy set in production without blocking Redis. How?",
          "a": "Don't `DEL` it on old Redis versions, because deleting a giant set synchronously can block the single-threaded server for seconds. Use `UNLINK revoked-jtis` (Redis 4+), which frees memory in a background thread, or enable `lazyfree-lazy-user-del`. On older versions, drain it incrementally with `SSCAN` plus `SREM` in batches of ~1,000 with small pauses. Deploy the new per-key code first so nothing reads the old set, then delete it."
        }
      ],
    },
    {
      id: 'api-security-mcq-12',
      difficulty: 'medium',
      question:
        'You are adding login to a smart-TV app with only a remote control, and a nightly cron job that syncs invoices to an accounting API with no user present. Which grant pair is correct?',
      options: [
        'TV: Resource Owner Password (user types the password with the remote). Cron: Authorization Code.',
        'TV: Implicit flow in an embedded webview. Cron: Refresh token from an admin\'s login.',
        'TV: Device Authorization Grant (user approves on their phone). Cron: Client Credentials.',
        'TV: Authorization Code + PKCE in an embedded webview. Cron: Device Authorization Grant.',
      ],
      correct: [2],
      explanation:
        'The device grant exists for input-constrained devices: the TV shows a code, the user approves on a phone with full MFA and SSO, and the TV polls for tokens. Machine-to-machine with no user is client credentials. ROPC and implicit are deprecated. Running a cron job on a human admin\'s refresh token ties it to a person who may leave and over-grants it. The device grant needs a human, so it doesn\'t fit a cron job.',
      followUps: [
        {
          "q": "The cron's client credentials secret is in a Kubernetes Secret. Security asks you to eliminate long-lived secrets entirely. What do you do?",
          "a": "Use workload identity instead of a shared secret. Authenticate the client with `private_key_jwt` using a key from a KMS that never leaves it, or better, with workload identity federation: the pod's projected service-account token (short-lived, audience-bound, auto-rotated by Kubernetes) is exchanged at the AS for an access token. AWS IRSA and GCP Workload Identity work this way. No static secret to leak, and access dies when the service account is removed."
        },
        {
          "q": "On the TV, a user starts a device login and walks away. How should the device grant's polling and expiry be tuned?",
          "a": "The user code should expire in about 10–15 minutes (`expires_in`), short enough that a photographed code is quickly useless. The TV polls the token endpoint at the AS-specified `interval` (5 s by default), and must back off by 5 s each time it gets `slow_down`. That's about 120–180 polls per login, trivial per device but worth rate-limiting at the AS by device code. When it expires, the TV shows a 'code expired, get a new one' screen rather than polling forever."
        }
      ],
    },
    {
      id: 'api-security-mcq-13',
      difficulty: 'medium',
      question:
        'Select ALL issues that fall under OWASP API3:2023, Broken Object Property Level Authorization.',
      options: [
        'PATCH /users/me accepts {"isAdmin": true} and persists it',
        'GET /users/:id returns passwordHash and mfaSecret fields to the client',
        'GET /users/:id returns another user\'s profile when the id is changed',
        'GET /users?limit=1000000 is accepted and scans the whole table',
      ],
      correct: [0, 1],
      explanation:
        'API3 merged 2019\'s mass assignment and excessive data exposure: authorization at the level of individual properties, for reads and writes. Reading another user\'s whole object is API1 (BOLA). An unbounded limit is API4 (unrestricted resource consumption). The fix for API3 is explicit input and output DTO allow-lists.',
      followUps: [
        {
          "q": "You add input and output DTOs. Admins legitimately need to set `isAdmin` on other users. How do you design that without reopening mass assignment?",
          "a": "Make it a separate, explicit operation rather than a field on the general update: `PUT /users/{id}/roles` or `POST /users/{id}/admin-grant`, with its own DTO, its own scope (`users:admin`), an authorization check that the caller is an admin of the same tenant, and an audit log entry. The general `PATCH /users/me` DTO never contains role fields. Separating privileged properties into their own endpoints makes them easy to review, rate-limit and alert on."
        },
        {
          "q": "How would you test that no endpoint returns `passwordHash` or `mfaSecret` anywhere?",
          "a": "Use a response-scanning test: seed users with sentinel values (`passwordHash = 'SENTINEL_HASH_x9'`), call every GET route in the OpenAPI spec as various roles, and assert that no response body contains the sentinel strings. Add a contract check that every response schema has `additionalProperties: false` and the actual response validates against it. In production, a gateway or DLP filter can log or block bodies matching bcrypt (`$2b$`) or TOTP secret patterns as a last line of defence."
        }
      ],
    },
    {
      id: 'api-security-mcq-14',
      difficulty: 'expert',
      question: 'Review this payment-provider webhook verifier. Select ALL real problems.',
      code: {
        language: 'typescript',
        code: `app.post('/webhooks/psp', express.json(), (req, res) => {
  const [t, sig] = String(req.headers['psp-signature']).split(',');   // "t=169...,v1=abc..."
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
    .update(t.slice(2) + '.' + JSON.stringify(req.body)).digest('hex');
  if (expected !== sig.slice(3)) return res.sendStatus(401);
  handleEvent(req.body);
  res.sendStatus(200);
});`,
      },
      options: [
        'The HMAC is computed over re-serialized JSON, not the raw bytes that were signed, so legitimate webhooks can fail (key order, whitespace, unicode escaping)',
        'The timestamp is never compared to the current time, so a captured webhook can be replayed indefinitely',
        'String !== comparison is not constant-time, which leaks timing information about the expected signature',
        'HMAC-SHA256 is too weak for webhooks. An RSA signature is required.',
        'The secret should be sent in the request so the provider can rotate it',
      ],
      correct: [0, 1, 2],
      explanation:
        'Signature checks must use the exact raw body (express.raw or a verify hook), because JSON.stringify of the parsed object is not byte-identical. The signed timestamp exists to enforce a tolerance window (for example 5 minutes) against replay, and that also calls for idempotent handling by event id. Use crypto.timingSafeEqual on equal-length buffers. HMAC-SHA256 is standard and secure for this. Sending the secret defeats its purpose.',
      followUps: [
        {
          "q": "Write the corrected verification steps, including what you do after the signature passes.",
          "a": "Use `express.raw({type:'application/json'})` on this route. Parse `t` and `v1` from the header by key (not by position). Reject if `|now − t| > 300 s`. Compute HMAC-SHA256 over `t + '.' + rawBody`, compare with `crypto.timingSafeEqual` after checking the lengths match, and only then `JSON.parse` the body. After that, dedupe by event id (insert into a `processed_events` table with a unique constraint), return 2xx quickly, and process asynchronously so slow handlers don't trigger provider retries."
        },
        {
          "q": "The PSP rotates the webhook secret. How do you avoid rejecting valid webhooks during the switch?",
          "a": "Support multiple active secrets. During rotation, the provider typically signs with both and sends multiple `v1=` signatures in the header, or you accept either of two configured secrets. Verify against each secret and accept if any matches. Sequence: add the new secret to your config and deploy, rotate at the provider, watch for successful verifications with the new secret, then remove the old one. Store secrets in a secret manager with versioning, not in environment variables baked into images."
        }
      ],
    },
    {
      id: 'api-security-mcq-15',
      difficulty: 'hard',
      question:
        'Istio STRICT mTLS is on, and an AuthorizationPolicy lets only the orders service call payments POST /charges. A bug in orders lets any user trigger charges against other users\' cards. Why didn\'t the mesh stop it, and what is missing?',
      options: [
        'STRICT mode only encrypts traffic. You also need PERMISSIVE mode for identity checks.',
        'AuthorizationPolicy is evaluated only for ingress traffic from outside the cluster, not for service-to-service calls',
        'SPIFFE identities are shared across all pods in a namespace, so any pod could impersonate orders',
        'mTLS authenticates the calling workload (orders), not the end user. Payments needs verifiable user context (token exchange or an internal JWT with sub and act) and must authorize the charge against that user.',
      ],
      correct: [3],
      explanation:
        'The mesh correctly verified that orders made the call, and orders is allowed to charge. It has no notion of which user the charge is for. Payments must receive cryptographically verifiable user context and check that the card belongs to that user. PERMISSIVE is weaker, not stronger. AuthorizationPolicy applies to in-mesh traffic at the sidecar. SPIFFE IDs derive from the service account, not the whole namespace.',
      followUps: [
        {
          "q": "You add an internal JWT from the gateway carrying the user's `sub`. orders forwards it to payments. What stops a compromised orders pod from forging or swapping that context?",
          "a": "orders can't forge it because it's signed by the gateway or the token-exchange service, whose key orders doesn't hold, and payments verifies the signature and audience. But orders could replay another user's token that it legitimately received. Mitigate with short lifetimes (about 1 minute), audience restriction (`aud = payments`), binding the token to the request (a `txn` or request id), and token exchange (RFC 8693) that issues a narrow token with `act: orders` and only the needed scope (`payments:charge`)."
        },
        {
          "q": "Payments now gets user context. Exactly what check prevents charging another user's card?",
          "a": "Payments verifies ownership of the object using data it trusts. It loads the payment method by id and checks `card.ownerId == token.sub` (and the tenant matches) in the same query: `WHERE id=$1 AND owner_id=$2`. If there's no row, it returns 404 and charges nothing. The amount and order reference should also be checked against the order (or signed by orders) so a compromised caller can't charge arbitrary amounts. Every charge is logged with both the user (`sub`) and the actor (`act`)."
        }
      ],
    },
  ],
};

export default topic;
