import type { Topic } from '../../types';

const topic: Topic = {
  id: 'api-auth-sso',
  phase: 'apis-security',
  order: 5,
  title:
    'Authentication Building Blocks: Sessions vs Tokens, SSO (SAML & OIDC), 2FA/TOTP, JWT vs PASETO & API Keys',
  subtitle:
    'Where session state lives, the five ways to authenticate a REST call (incl. SigV4-style HMAC signing), API-key lifecycle, SSO end to end with SAML and OIDC, single logout, TOTP math, passkeys, PASETO and auth for a multi-app company',
  estimatedMinutes: 110,
  sources: [
    'RFC 4226 — HOTP: An HMAC-Based One-Time Password Algorithm (dynamic truncation, test vectors)',
    'RFC 6238 — TOTP: Time-Based One-Time Password Algorithm (time step, drift, Appendix B test vectors)',
    'NIST SP 800-63B-4 — Authentication and Authenticator Management (2025): restricted PSTN OTP, phishing resistance at AAL2/AAL3, OTP single use, reauthentication limits',
    'OASIS SAML 2.0 — Core, Bindings (HTTP-Redirect, HTTP-POST) and Profiles (Web Browser SSO, Single Logout)',
    'OpenID Connect Core 1.0; OpenID Connect RP-Initiated, Front-Channel and Back-Channel Logout 1.0',
    'RFC 7636 (PKCE), RFC 8693 (OAuth 2.0 Token Exchange), RFC 9700 (OAuth 2.0 Security BCP), RFC 8725 (JWT BCP)',
    'PASETO specification (paseto-standard/paseto-spec): Protocol Versions v3/v4, local vs public, footers, implicit assertions',
    'W3C Web Authentication (WebAuthn) Level 2/3 and FIDO Alliance passkeys',
    'AWS Signature Version 4 documentation (canonical request, string to sign, derived signing key)',
    'OWASP Session Management, CSRF Prevention and Multifactor Authentication Cheat Sheets',
    'RBI — Authentication Mechanisms for Digital Payment Transactions Directions, 2025 (press release 25 Sept 2025)',
  ],
  tags: ['sessions', 'cookies', 'sso', 'saml', 'oidc', 'totp', 'mfa', 'passkeys', 'webauthn', 'paseto', 'api-keys', 'hmac-signing', 'sigv4', 'token-exchange'],
  cheatSheet: [
    'Session cookie = reference token (server state, instant revoke, needs CSRF defence); bearer JWT = value token (no lookup, revocation only by expiry or a denylist, XSS-stealable if JS can read it). Browsers: prefer HttpOnly session cookie or a BFF; APIs/mobile: short-lived bearer tokens.',
    'Five REST auth styles: Basic (password on every call), API key (app identity), bearer token (whoever holds it wins), OAuth2 (delegated, scoped, expiring), mTLS / HMAC signing (proof of possession: the secret never crosses the wire).',
    'SigV4-style signing = HMAC over a canonical request (method, path, sorted query, signed headers, SHA-256 of body) + timestamp + scope, with a derived per-day key. Server rebuilds the same string, compares in constant time, rejects > 5–15 min skew and replayed nonces.',
    'API key format: prefix_keyId_secret_checksum. Prefix for leak scanners, keyId for an indexed lookup, SHA-256 (or HMAC with a pepper) of the secret at rest, CRC checksum to reject typos without a DB hit, two active keys per client for rotation.',
    'SSO = one IdP session cookie on the IdP domain. App #2 redirects to the IdP, the browser sends that cookie, the IdP skips the password and mints a fresh assertion/code for app #2. Each app still sets its OWN local session.',
    'SAML SP-initiated: AuthnRequest (HTTP-Redirect, deflated + signed in query) → IdP login → signed Response POSTed by the browser to the ACS URL. Verify: signature over the assertion you actually read, Audience, Recipient/Destination, InResponseTo, NotOnOrAfter, one-time assertion ID.',
    'OIDC code + PKCE: browser carries only a short-lived code; tokens come back channel. ID token (aud = client, nonce, auth_time, amr) logs the user into the app; access token (aud = API) calls APIs. Check state (CSRF) and nonce (replay).',
    'TOTP: counter = floor(unixTime / 30); HMAC-SHA1(secret, 8-byte big-endian counter); offset = last nibble; take 31 bits at offset; mod 10^6. Accept steps T-1..T+1 at most, remember the last accepted step per user to stop replay, rate-limit attempts.',
    'MFA strength ladder: SMS OTP (SIM swap, SS7, restricted by NIST) < TOTP/push (phishable via real-time proxy) < WebAuthn/passkeys (origin-bound signatures, phishing-resistant). Recovery codes: 8–10 single-use, hashed, shown once.',
    'PASETO fixes JWT foot-guns by removing algorithm choice: v4.local (XChaCha20 + BLAKE2b-MAC, encrypted) or v4.public (Ed25519, signed); footer is authenticated but NOT encrypted (put kid there). Multi-app auth: one IdP/broker, OIDC to apps, RFC 8693 token exchange and workload identity (mTLS/SPIFFE) between services.',
  ],
  sections: [
    {
      heading: 'Sessions + cookies vs stateless tokens — where the state lives decides everything',
      body: `**Intuition:** a session ID is a cloakroom ticket (meaningless number, the coat stays with the server); a self-contained token is a passport (all the facts are printed on it, and border control trusts the stamp, not a database).

Both are "remember who logged in". The real difference is **reference vs value**:

| Dimension | Server session (reference) | Self-contained token, e.g. JWT (value) |
|---|---|---|
| Per-request cost | 1 store lookup (Redis ~0.3–1 ms in-AZ) | Signature verify (ES256 ~50–100 µs), no I/O |
| Revocation | DELETE the key: instant | Wait for exp, or add a denylist / "valid-after" check (a lookup again) |
| Horizontal scaling | Shared store (Redis cluster) — not sticky pods | Trivial; any pod with the public key verifies |
| Cross-domain / mobile / 3rd-party APIs | Awkward (cookies are per-site) | Natural (Authorization header) |
| Size on the wire | ~40-byte cookie | 0.5–2 KB on every request |
| Data freshness | Always current (role removed → next request sees it) | Stale until expiry |

**The transport matters as much as the token type.** Cookies are sent *automatically* by the browser; headers are sent only by code you write:

- **Cookie (any token inside it)** → automatic sending means **CSRF** is your problem: SameSite=Lax/Strict, plus a CSRF token or Origin check for state-changing requests. Bonus: HttpOnly hides it from XSS'd JavaScript.
- **Authorization header from JS** → no CSRF (an attacker page cannot make your JS attach the header), but the token must be readable by JS, so any **XSS** exfiltrates it and replays it from anywhere until it expires.

**When to pick which:**
- First-party web app, one domain: server session in Redis behind an HttpOnly, Secure, SameSite=Lax \`__Host-\` cookie. Simplest, instantly revocable.
- SPA calling APIs on several domains: a **BFF** (backend-for-frontend) that keeps OAuth tokens server-side and gives the browser only a session cookie — this is what the IETF "OAuth 2.0 for Browser-Based Apps" draft recommends as the most secure option.
- Mobile apps, partner APIs, service-to-service: short-lived bearer access tokens (5–15 min) + rotated refresh tokens.
- At scale, most companies run a **hybrid**: session cookie at the edge, the gateway swaps it for a short-lived internal JWT so downstream services verify locally.

**In interviews say:** "Stateless isn't free — the moment you need instant logout, account lock or role changes to bite, you've re-added state. I choose by revocation requirement and client type, then choose cookie vs header by the XSS/CSRF threat I'd rather defend."`,
      diagram: `Hybrid used by most large web properties
Browser --(cookie: sid=8f3a.., HttpOnly)--> Edge/BFF --GET sess:8f3a--> Redis
                                              |  (revocable, 1 lookup)
                                              v
                         mint 60-s internal JWT {sub, roles, tenant}
                                              |
                     +------------------------+---------------------+
                     v                        v                     v
                orders-svc               billing-svc            search-svc
           (verify locally, no I/O) (verify locally, no I/O)   (verify locally)`,
      keyPoints: [
        'Reference token = revocable but needs a lookup; value token = lookup-free but stale until expiry.',
        'Cookie transport → defend CSRF; header transport from JS → defend XSS token theft.',
        'BFF keeps tokens off the browser entirely; edge can translate session → internal JWT.',
      ],
      source: 'OWASP Session Management & CSRF Prevention Cheat Sheets; IETF draft "OAuth 2.0 for Browser-Based Applications"',
    },
    {
      heading: 'The five REST API authentication methods compared',
      body: `**Intuition:** they differ in one question — *what does the client send on each request, and what can an eavesdropper or a leaked log do with it?*

| Method | Sent per request | Proves | Leak impact | Typical use |
|---|---|---|---|---|
| **HTTP Basic** | base64(user:password) | Knows the password | Full account takeover, password reuse elsewhere | Internal tools, legacy, bootstrap only |
| **API key** | Static secret in a header | Holder is some app/project | Valid until someone rotates it (often months) | Server-to-server metering (Maps, payments secret keys) |
| **Bearer token** | Access token (JWT/opaque) | Holder was issued it recently | Replayable until expiry (minutes) | First-party APIs, mobile |
| **OAuth2** | Bearer token obtained via a grant | User X delegated scopes to client Y | Scoped + short-lived; refresh token is the crown jewel | Third-party and multi-app access |
| **mTLS / HMAC request signing** | A *signature* or TLS client-cert proof; the secret never travels | Possession of a private key or shared secret, per request | A captured request is useless after the time window; the key is never in a log | Cloud APIs (AWS SigV4), webhooks, bank/partner APIs |

**Key distinctions interviewers probe:**
- Basic and API keys are **static bearer secrets**; anyone who sees one (proxy log, browser extension, Git commit) *is* you. Bearer tokens are bearer secrets too, just short-lived.
- **Proof-of-possession** methods (mTLS, HMAC signing, DPoP, RFC 8705 certificate-bound tokens) turn a stolen request into a dead end: without the key you can't produce a fresh signature.
- OAuth2 is a *framework for obtaining* tokens, not a wire format — on the wire it is still "bearer token" unless you add DPoP/mTLS binding.
- Basic over HTTPS is not "plaintext on the wire", but the password is presented to every hop that terminates TLS (CDN, LB, sidecar) and often lands in debug logs.

**Rule of thumb:** humans → OAuth2/OIDC (via browser); machines you control → workload identity (mTLS/SPIFFE) or client-credentials tokens; machines you don't control calling you → API key for identity + HMAC signing (or mTLS) for integrity; webhooks you send → HMAC signature over the body with a timestamp.`,
      keyPoints: [
        'Static bearer secrets (Basic, API keys) are the weakest because every copy is equally powerful.',
        'Proof-of-possession (mTLS, HMAC, DPoP) means the secret never crosses the wire.',
        'OAuth2 is how you get a token; bearer vs bound is how you present it.',
      ],
      source: 'RFC 7617 (Basic), RFC 6750 (Bearer), RFC 8705 (mTLS-bound tokens), RFC 9449 (DPoP)',
    },
    {
      heading: 'HMAC request signing, AWS SigV4-style — proof of possession without TLS client certs',
      body: `**Intuition:** instead of showing the key at the door, the client writes a wax seal over the exact letter it is sending, using a stamp only it and the server own. The server re-stamps the same letter and compares seals.

**SigV4 in four steps** (the pattern, simplified):
1. **Canonical request** — a deterministic string: HTTP method, URI-encoded path, query params *sorted* by name, the lowercase signed headers (\`host\`, \`x-amz-date\`, content type…) sorted and trimmed, the list of signed header names, and **hex(SHA-256(body))**.
2. **String to sign** — \`AWS4-HMAC-SHA256\` + timestamp + *credential scope* (\`20261013/ap-south-1/s3/aws4_request\`) + hex(SHA-256(canonical request)).
3. **Derived signing key** — \`kDate = HMAC("AWS4" + secret, date)\` → \`kRegion\` → \`kService\` → \`kSigning = HMAC(kService, "aws4_request")\`. A leaked derived key is only valid for one day, one region, one service, and the long-term secret is never used directly.
4. **Signature** = hex(HMAC-SHA256(kSigning, stringToSign)), sent in the Authorization header with the access-key ID and the SignedHeaders list.

**Server side:** look up the secret by access-key ID, rebuild the canonical request from what *arrived*, recompute, \`timingSafeEqual\`. AWS rejects requests whose timestamp is more than ~15 minutes off; for your own APIs use 5 minutes **plus a nonce cache** (Redis SET NX with TTL = window) if replay within the window matters (payments).

**Why canonicalisation is the hard part:** proxies reorder query strings, add headers, re-encode \`%2F\`, and JSON body parsers re-serialise. Always hash the **raw body bytes** before any parser touches them, and only sign headers that intermediaries won't rewrite. The IETF standardised a general version as **RFC 9421 HTTP Message Signatures**.

**Compared with mTLS:** HMAC needs a shared secret (server stores it recoverably — so encrypt it with KMS, you can't just hash it), works through TLS-terminating proxies, and signs the *message*. mTLS uses asymmetric keys, but its proof ends at the TLS terminator.`,
      code: [
        {
          language: 'typescript',
          title: 'Client: SigV4-style signer (node:crypto only)',
          code: `import { createHash, createHmac } from 'node:crypto';

const sha256hex = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const hmac = (k: string | Buffer, d: string) => createHmac('sha256', k).update(d).digest();

export interface SignInput {
  method: string; path: string; query: Record<string, string>;
  headers: Record<string, string>; body: Buffer;
  keyId: string; secret: string; region: string; service: string; now: Date;
}

export function sign(i: SignInput): Record<string, string> {
  const amzDate = i.now.toISOString().replace(/[-:]/g, '').replace(/\\.\\d{3}/, ''); // 20261013T101500Z
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...i.headers, 'x-amz-date': amzDate };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonicalQuery = Object.keys(i.query).sort()
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(i.query[k])).join('&');
  const canonicalRequest = [
    i.method.toUpperCase(), i.path, canonicalQuery,
    names.map((n) => n + ':' + lower[n] + '\\n').join(''), // canonical headers block
    names.join(';'),                                       // SignedHeaders
    sha256hex(i.body),                                     // hash of RAW body bytes
  ].join('\\n');
  const scope = [day, i.region, i.service, 'aws4_request'].join('/');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\\n');
  // Derived key: a leak is limited to one day / region / service
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + i.secret, day), i.region), i.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: 'AWS4-HMAC-SHA256 Credential=' + i.keyId + '/' + scope +
      ', SignedHeaders=' + names.join(';') + ', Signature=' + signature,
  };
}`,
        },
        {
          language: 'typescript',
          title: 'Server: NestJS guard — rebuild, compare in constant time, enforce window + nonce',
          code: `import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import Redis from 'ioredis';
import { sign } from './sigv4';
import { SecretStore } from './secret-store'; // KMS-decrypted secrets, cached

const MAX_SKEW_MS = 5 * 60_000;

@Injectable()
export class SignedRequestGuard implements CanActivate {
  constructor(private readonly secrets: SecretStore, private readonly redis: Redis) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const auth = String(req.headers.authorization ?? '');
    const m = /Credential=([^/]+)\\/(\\d{8})\\/([^/]+)\\/([^/]+)\\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})/.exec(auth);
    if (!m || !req.rawBody) throw new UnauthorizedException();
    const [, keyId, , region, service, signed, sig] = m;
    const amzDate = String(req.headers['x-amz-date'] ?? '');
    const ts = Date.parse(amzDate.replace(/(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'));
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) throw new UnauthorizedException('stale');
    const secret = await this.secrets.get(keyId);
    if (!secret) throw new UnauthorizedException();
    // Rebuild from ONLY the headers the client said it signed (proxies add others)
    const headers = Object.fromEntries(signed.split(';').filter((h) => h !== 'x-amz-date')
      .map((h) => [h, String(req.headers[h] ?? '')]));
    const expected = sign({ method: req.method, path: req.path, query: req.query as Record<string, string>,
      headers, body: req.rawBody, keyId, secret, region, service, now: new Date(ts) });
    const want = Buffer.from(expected.authorization.slice(-64), 'hex');
    if (!timingSafeEqual(want, Buffer.from(sig, 'hex'))) throw new UnauthorizedException();
    // Replay inside the window: each signature is single-use
    const fresh = await this.redis.set('sig:' + sig, '1', 'PX', 2 * MAX_SKEW_MS, 'NX');
    if (fresh !== 'OK') throw new UnauthorizedException('replayed');
    return true;
  }
}`,
        },
      ],
      keyPoints: [
        'Sign the canonical request, not the parsed object: raw body hash, sorted query, explicit SignedHeaders.',
        'Derived keys (date/region/service) shrink the blast radius of a leaked signing key.',
        'Timestamp window bounds replay; a nonce/signature cache closes it.',
      ],
      source: 'AWS Signature Version 4 documentation; RFC 9421 HTTP Message Signatures',
    },
    {
      heading: 'API keys vs tokens — app identity, scoping, rotation and the key lifecycle',
      body: `**Intuition:** an API key is a company credit card issued to a *project*; a user token is a signed permission slip for *one person*, *specific actions*, *today only*.

**The identity question first:** a key answers "which integration is calling?"; a user token answers "which human authorised this, through which client, with what scopes, until when?". If an endpoint needs to know the human, an API key alone is the wrong tool (no MFA, no consent, no per-session revoke).

| | API key | Access token |
|---|---|---|
| Represents | Project / integration / tenant | User + client (sub + azp/client_id) |
| Lifetime | Months, until rotated | Minutes |
| Issued by | Your developer dashboard | Authorization server via a grant |
| Scoping | Restricted keys (read-only, per-resource, IP/referrer allow-list) | OAuth scopes + audience |
| Revocation | Delete row → effective at next lookup (or after cache TTL) | Expiry / introspection / denylist |
| Storage at rest | Hash only (shown once) | Usually not stored (JWT) or hashed (opaque) |

**Production key design (beyond "hash it"):**
- **Format** \`acme_live_<keyId>_<secret>_<crc32>\`: the vendor prefix lets GitHub secret scanning and your own log scrubbers find leaks; \`live\`/\`test\` stops a test key from hitting production; \`keyId\` gives an indexed lookup so you never scan hashes; the **checksum** lets the gateway reject typos and random garbage *without a DB or cache hit* (GitHub tokens carry a CRC32 for exactly this).
- **Hash at rest:** SHA-256 is enough because the secret has ~256 bits of entropy (no dictionary to attack). Some teams use HMAC-SHA256 with a server-side **pepper** held in KMS so a DB dump alone can't even confirm a guessed key.
- **Restricted keys:** permissions on the key row (\`scopes\`, \`allowed_ips\`, \`expires_at\`), checked like scopes.
- **Rotation:** allow 2 active keys per integration; customer deploys the new key, you watch \`last_used_at\` on the old one hit zero, then revoke. Track \`last_used_at\` asynchronously (batch updates), not one write per request.
- **Caching:** cache \`keyId → {hash, scopes, tenant}\` for 30–60 s at the gateway; revocation latency = TTL, or publish a revoke event to purge.

**Tokens vs keys in one sentence:** keys identify and meter the *app*; tokens carry the *user's* delegated authority — and many APIs need both (key for quota, token for the user).`,
      code: [
        {
          language: 'typescript',
          title: 'Key format with CRC32 checksum, peppered hash, scoped lookup (NestJS service)',
          code: `import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { crc32 } from 'node:zlib'; // Node 22.2+
import { Pool } from 'pg';

const PREFIX = 'acme_live_';
const b36 = (n: number) => n.toString(36).padStart(7, '0'); // 32-bit CRC as 7 chars

@Injectable()
export class ApiKeyService {
  constructor(private readonly db: Pool, private readonly pepper: Buffer /* from KMS */) {}

  private digest(secret: string) {
    return createHmac('sha256', this.pepper).update(secret).digest(); // DB dump alone is useless
  }

  async issue(tenantId: string, scopes: string[]): Promise<string> {
    const keyId = randomBytes(8).toString('hex');           // indexed lookup handle
    const secret = randomBytes(32).toString('base64url');   // 256-bit secret, never stored
    const body = PREFIX + keyId + '_' + secret;
    await this.db.query(
      'INSERT INTO api_keys (key_id, tenant_id, secret_hmac, scopes) VALUES ($1, $2, $3, $4)',
      [keyId, tenantId, this.digest(secret), scopes],
    );
    return body + '_' + b36(crc32(body)); // shown exactly once
  }

  async verify(presented: string, needScope: string) {
    const m = /^acme_live_([0-9a-f]{16})_([A-Za-z0-9_-]{43})_([0-9a-z]{7})$/.exec(presented);
    if (!m) return null;
    const [, keyId, secret, sum] = m;
    // Typos and random scanner noise die here: no Redis, no Postgres
    if (b36(crc32(PREFIX + keyId + '_' + secret)) !== sum) return null;
    const { rows } = await this.db.query(
      'SELECT tenant_id, secret_hmac, scopes FROM api_keys WHERE key_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())',
      [keyId],
    );
    const row = rows[0];
    if (!row || !timingSafeEqual(this.digest(secret), row.secret_hmac)) return null;
    if (!row.scopes.includes(needScope)) return null; // restricted keys
    return { tenantId: row.tenant_id as string, keyId };
  }
}`,
        },
      ],
      keyPoints: [
        'Prefix → leak scanning; keyId → O(1) lookup; checksum → reject junk without I/O; hash/HMAC → DB dump is useless.',
        'Two active keys + last_used_at make rotation zero-downtime.',
        'API key = which app (quota, billing); token = which user and what they consented to.',
      ],
      source: 'GitHub engineering blog — "Behind GitHub\'s new authentication token formats" (prefix + CRC32); Stripe restricted keys docs',
    },
    {
      heading: 'SSO end to end — IdP vs SP, the IdP session cookie, and why app #2 needs no password',
      body: `**Intuition:** the IdP is the front desk of an office campus. You show ID once and get a wristband (the IdP session cookie). Every building (app) sends you back to the desk; the desk sees the wristband and hands you a building pass without asking for ID again.

**Vocabulary:**
- **IdP (Identity Provider / OpenID Provider):** authenticates users and issues assertions or tokens — Okta, Entra ID, Google Workspace, Keycloak, Auth0.
- **SP (Service Provider / Relying Party):** the app that trusts the IdP — Jira, Slack, your NestJS app.
- **Trust** is set up out of band: the SP knows the IdP's signing certificate/JWKS and endpoints; the IdP knows the SP's entity ID/client_id and its allowed callback (ACS / redirect URI).

**Step by step — two apps, one login (this is the flow to animate):**
1. User opens \`hr.acme.com\`. No local session cookie → the SP builds an authentication request and **redirects** the browser to \`login.acme-idp.com\`.
2. Browser arrives at the IdP. It has **no IdP cookie** → the IdP shows the login page.
3. User enters password + MFA. The IdP creates an **IdP session** (server-side record) and sets an **IdP session cookie** on *its own domain* (\`login.acme-idp.com\`).
4. IdP issues a **one-time proof** for hr.acme.com — a signed SAML assertion or an OIDC authorization code — and sends the browser back to hr's callback.
5. hr.acme.com validates the proof (signature, audience, expiry, request correlation), creates **its own local session**, and sets **its own cookie** on hr.acme.com.
6. Later, user opens \`wiki.acme.com\`. No wiki cookie → redirect to the IdP *again*.
7. This time the browser **automatically attaches the IdP cookie** (same IdP domain). The IdP finds a live session — no password prompt — and immediately issues a new proof whose audience is wiki.
8. wiki validates and sets its own session. The user sees a sub-second redirect bounce and is logged in.

**Things people get wrong:**
- SSO does **not** share one cookie across apps on different domains — cookies can't cross registrable domains. Each app keeps its own session; only the IdP's cookie is shared *because every app sends the browser to the same IdP origin*.
- Proofs are **per-audience**: wiki can't replay hr's assertion because the Audience/aud differs.
- The IdP can still force re-auth: \`prompt=login\` / \`max_age\` (OIDC) or \`ForceAuthn="true"\` (SAML), or step-up when the app needs MFA (\`acr_values\`).
- Third-party-cookie blocking doesn't break this flow because the IdP cookie is first-party *during the top-level redirect*; it does break silent iframe-based renew and front-channel logout.`,
      diagram: `Browser            hr (SP1)              IdP (login.acme-idp)       wiki (SP2)
  |--GET /payroll------->|                         |                          |
  |<-302 to IdP + AuthnReq/authorize?..------------|                          |
  |--GET /sso (no IdP cookie)--------------------->|                          |
  |<-login page------------------------------------|                          |
  |--POST password + TOTP------------------------->| create IdP session       |
  |<-Set-Cookie: idp_sid (IdP domain) + assertion/code for SP1               |
  |--POST/GET callback (proof for SP1)->|          |                          |
  |                     |  validate, Set-Cookie: hr_sid                       |
  |  ... later ...                                                            |
  |--GET /docs------------------------------------------------------------->|
  |<-302 to IdP-----------------------------------------------------------|
  |--GET /sso  Cookie: idp_sid -------------------->| session found: NO prompt |
  |<-302 back with proof for SP2 (aud = wiki)-----|                          |
  |--callback--------------------------------------------------------------->|
  |<-Set-Cookie: wiki_sid ---------------------------------------------------|`,
      keyPoints: [
        'Only the IdP cookie is "single"; every SP still mints its own local session.',
        'Every proof is audience-restricted and single-use; SP2 gets its own.',
        'The second login is silent because the browser revisits the IdP origin with its cookie.',
      ],
      source: 'OASIS SAML 2.0 Profiles §4.1 (Web Browser SSO); OpenID Connect Core 1.0 §3.1',
    },
    {
      heading: 'SAML 2.0 SP-initiated flow — AuthnRequest, signed assertion, ACS validation',
      body: `**Intuition:** SAML is a sealed XML letter of introduction. The SP writes "please vouch for whoever this is, reply to this address"; the IdP replies with a signed letter "this is priya@acme.com, valid for the next 5 minutes, addressed only to you".

**Step by step (Web Browser SSO profile, SP-initiated):**
1. **AuthnRequest** — the SP generates \`<samlp:AuthnRequest ID="_a1b2" IssueInstant=... Destination="https://idp/sso" AssertionConsumerServiceURL="https://sp/acs">\` with its \`<Issuer>\` (SP entity ID). It stores \`_a1b2\` against a short-lived cookie.
2. **HTTP-Redirect binding** — the XML is DEFLATE-compressed, base64-encoded and URL-encoded into \`SAMLRequest=\`, plus \`RelayState\` (where to return) and optionally \`SigAlg\` + \`Signature\` over the query string.
3. **IdP authenticates** the user (or reuses its session).
4. **Response** — the IdP builds \`<samlp:Response InResponseTo="_a1b2" Destination="https://sp/acs">\` containing an \`<Assertion>\`: \`Subject/NameID\`, \`SubjectConfirmationData Recipient=ACS NotOnOrAfter=... InResponseTo=_a1b2\`, \`Conditions NotBefore/NotOnOrAfter\` with \`AudienceRestriction=SP entity ID\`, an \`AuthnStatement\` (AuthnInstant, SessionIndex, AuthnContextClassRef) and \`AttributeStatement\` (email, groups). The assertion and/or response carries an enveloped **XML-DSig** signature (RSA-SHA256 over exclusive-canonicalised XML).
5. **HTTP-POST binding** — the IdP returns an auto-submitting HTML form; the browser POSTs \`SAMLResponse\` (base64 XML) + \`RelayState\` to the **ACS URL**.
6. **SP validates at the ACS**, then creates its local session and redirects to RelayState (validated against an allow-list — open-redirect risk).

**ACS validation checklist (each line is a real CVE class):**
- Signature verifies with the IdP's **pinned** certificate (never the \`KeyInfo\` cert embedded in the message).
- Read attributes **only from the element the signature covers** — XML Signature Wrapping attacks insert a second, unsigned assertion that naive code reads.
- Reject comments/odd canonicalisation in NameID (2018 "comment injection" bugs: \`admin@acme.com<!---->.evil.com\`).
- \`Audience\` = our entity ID; \`Destination\`/\`Recipient\` = our ACS URL; \`InResponseTo\` matches a request we issued (or explicit IdP-initiated policy).
- \`NotBefore\`/\`NotOnOrAfter\` with ≤ 2–3 min skew; store the assertion ID until expiry to **block replay**.
- Disable DTDs/external entities in the XML parser (XXE).

**IdP-initiated SSO** (user clicks a tile in the Okta dashboard) has no AuthnRequest, so no InResponseTo — it is inherently more replay/CSRF-prone; accept it only if you must, with strict one-time assertion IDs.`,
      diagram: `SP (sp.acme.com)            Browser                 IdP (idp.acme.com)
  | 1. AuthnRequest ID=_a1b2, ACS=/acs  |                      |
  |---302 Location: idp/sso?SAMLRequest=deflate+b64&RelayState=/x&Sig..|
  |                            |----GET /sso?SAMLRequest...------>|
  |                            |<---login form / existing session-|
  |                            |----credentials + MFA------------>|
  |                            |<---HTML form auto-POST:          |
  |                            |    SAMLResponse=b64(<Response    |
  |                            |      InResponseTo=_a1b2>         |
  |                            |      <Assertion signed>          |
  |                            |       Audience=sp.acme.com       |
  |                            |       NotOnOrAfter=+5m ...)      |
  |<---POST /acs SAMLResponse + RelayState|                       |
  | 2. verify sig (pinned cert), audience, recipient,             |
  |    InResponseTo, time, assertion-ID not seen -> session       |
  |---302 /x  Set-Cookie: sp_sid=...--->|                         |`,
      keyPoints: [
        'Request goes by HTTP-Redirect (deflated, query-signed); response comes by HTTP-POST to the ACS.',
        'Validate the signed element you read — XML signature wrapping is the signature SAML bug.',
        'InResponseTo + one-time assertion IDs stop replay; IdP-initiated flows lose InResponseTo.',
      ],
      source: 'OASIS SAML 2.0 Core §2–3, Bindings §3.4 (HTTP-Redirect) and §3.5 (HTTP-POST), Profiles §4.1',
    },
    {
      heading: 'OIDC authorization code + PKCE vs SAML — side by side, and ID token vs access token',
      body: `**Intuition:** SAML hands the browser the whole sealed letter; OIDC hands the browser only a claim ticket (the code) and the app collects the letter over a private back channel.

**OIDC code flow with PKCE, step by step:**
1. App generates \`state\` (CSRF binding), \`nonce\` (ID-token replay binding) and \`code_verifier\` (43–128 random chars); sends \`code_challenge = BASE64URL(SHA256(verifier))\`.
2. Redirect: \`/authorize?response_type=code&client_id=wiki&redirect_uri=https://wiki/cb&scope=openid email profile&state=..&nonce=..&code_challenge=..&code_challenge_method=S256\`.
3. IdP authenticates (or reuses its session cookie), redirects to \`/cb?code=SplxlOB..&state=..\`. Code lives ~30–60 s, single use.
4. App checks \`state\` against its cookie, then POSTs \`grant_type=authorization_code&code=..&code_verifier=..&redirect_uri=..\` to \`/token\` **server-to-server** (with client auth for confidential clients).
5. IdP returns \`id_token\` (JWT), \`access_token\`, optionally \`refresh_token\`.
6. App validates the ID token: signature via JWKS (pinned algs), \`iss\`, \`aud\` contains client_id (and \`azp\` if multiple audiences), \`exp\`/\`iat\`, \`nonce\` equals the stored nonce, \`auth_time\`/\`acr\`/\`amr\` if policy needs MFA. Then sets the app session.

| | SAML 2.0 | OIDC (code + PKCE) |
|---|---|---|
| Format | XML assertion, XML-DSig | JSON / JWT (JWS) |
| What crosses the browser | The full signed assertion | Only a short-lived code |
| Request correlation | AuthnRequest ID ↔ InResponseTo | state (CSRF) + nonce (token replay) + PKCE (code injection) |
| Key distribution | Metadata XML with X.509 certs | Discovery doc + JWKS URI (rotation-friendly) |
| Mobile/SPA/API friendly | Poor | Native (plus access tokens for APIs) |
| Where you still meet it | Enterprise B2B customers, legacy SaaS | Everything new |

**ID token vs access token:** the **ID token** is a receipt *for the client* ("Priya authenticated at 10:02 with MFA") — \`aud\` = client_id; consume it once to build the session, never send it to APIs. The **access token** is a key *for a resource server* — \`aud\` = the API, carries \`scope\`; the client should treat it as opaque. (Both are often JWTs, which is why people confuse them.)`,
      diagram: `Browser               App (RP, wiki)                     IdP (OP)
  |--GET /docs---------->| gen state,nonce,verifier            |
  |<-302 /authorize?code_challenge=S256(v)&state&nonce----------|
  |--GET /authorize (cookie idp_sid?)-------------------------->|
  |<-302 https://wiki/cb?code=abc&state=s1----------------------|
  |--GET /cb?code=abc&state=s1->|                               |
  |                      | check state==cookie                  |
  |                      |--POST /token code=abc, verifier=v -->|  back channel
  |                      |<--{ id_token, access_token, refresh }|
  |                      | verify id_token: sig, iss, aud,      |
  |                      |   exp, nonce==n1 -> local session    |
  |<-302 /docs Set-Cookie: wiki_sid|                            |
  |                      |--GET /api  Bearer access_token-----> API (aud=api)`,
      code: [
        {
          language: 'typescript',
          title: 'OIDC callback with openid-client v6 (state, nonce, PKCE checked by the library)',
          code: `import * as client from 'openid-client';
import type { Request, Response } from 'express';

const config = await client.discovery(new URL('https://login.acme-idp.com'), 'wiki', process.env.WIKI_SECRET!);

export async function login(req: Request & { session: any }, res: Response) {
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  req.session.oidc = { verifier, state, nonce, returnTo: '/docs' }; // server-side, short TTL
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: 'https://wiki.acme.com/cb', scope: 'openid email',
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256', state, nonce,
  });
  res.redirect(url.href);
}

export async function callback(req: Request & { session: any }, res: Response) {
  const pending = req.session.oidc;
  delete req.session.oidc;                        // single use
  if (!pending) return res.status(400).end();
  const tokens = await client.authorizationCodeGrant(config,
    new URL(req.originalUrl, 'https://wiki.acme.com'),
    { pkceCodeVerifier: pending.verifier, expectedState: pending.state, expectedNonce: pending.nonce });
  const claims = tokens.claims()!;                // validated ID token claims
  if (!claims.amr?.includes('mfa')) return res.redirect('/step-up');
  req.session.regenerate(() => {                  // prevent session fixation
    req.session.user = { sub: claims.sub, sid: claims.sid };
    res.redirect(pending.returnTo);
  });
}`,
        },
      ],
      keyPoints: [
        'state stops login CSRF, nonce binds the ID token to this browser flow, PKCE binds the code to this client instance.',
        'SAML puts the assertion in the browser; OIDC keeps tokens on the back channel.',
        'ID token → client session; access token → API calls. Never swap them.',
      ],
      source: 'OpenID Connect Core 1.0 §3.1.2–3.1.3.7; RFC 7636; RFC 9700 §2.1',
    },
    {
      heading: 'Single logout and session lifetimes — the hardest part of SSO',
      body: `**Intuition:** logging in once is easy because one front desk hands out wristbands. Logging out everywhere is hard because every building already gave you its own key, and the desk has to chase them down.

**Three layers of session, each with its own clock:**

| Layer | Example lifetime | Killed by |
|---|---|---|
| IdP session (idp_sid cookie) | 8–12 h absolute, 30–60 min idle; "remember device" 30 days | IdP logout, admin revoke, password reset |
| App (SP/RP) session | 1–8 h, often idle-based | App logout, back-channel logout |
| Tokens (access/refresh) | Access 5–15 min; refresh hours–days | Expiry, refresh-token revocation |

Logging out of one app only deletes **that** app's session; the next visit silently re-logs in via the IdP cookie (users think "logout is broken"). Real logout must end the IdP session **and** notify every app that got a login from it.

**Mechanisms:**
- **RP-initiated logout (OIDC):** app redirects to \`end_session_endpoint?id_token_hint=..&post_logout_redirect_uri=..\`; the IdP kills its session.
- **Front-channel logout (OIDC) / SAML SLO via browser:** the IdP renders hidden iframes or a redirect chain to each app's logout URL. Fragile: one slow/broken app stops the chain, and **third-party-cookie blocking** means the iframes often arrive without the app's cookie.
- **Back-channel logout (OIDC) / SAML SLO via SOAP:** the IdP POSTs a signed **logout token** (JWT with \`iss\`, \`aud\`, \`iat\`, \`jti\`, \`events\` containing \`http://schemas.openid.net/event/backchannel-logout\`, and \`sid\` and/or \`sub\`; **no nonce**) server-to-server to each RP. Reliable; requires the app to index sessions by IdP \`sid\`.
- Tokens already issued (JWT access tokens) still live until \`exp\` → keep them short or check a revocation signal for sensitive APIs.

**NIST SP 800-63B-4 reference points (AAL2):** reauthentication overall timeout SHOULD be ≤ 24 h, inactivity ≤ 1 h. Use them to defend your numbers in interviews.`,
      code: [
        {
          language: 'typescript',
          title: 'Back-channel logout endpoint: verify the logout token, kill sessions by sid',
          code: `import { Controller, HttpCode, Post, Body, BadRequestException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import Redis from 'ioredis';

const JWKS = createRemoteJWKSet(new URL('https://login.acme-idp.com/.well-known/jwks.json'));
const EVENT = 'http://schemas.openid.net/event/backchannel-logout';

@Controller('oidc')
export class BackchannelLogoutController {
  constructor(private readonly redis: Redis) {}

  @Post('backchannel-logout')
  @HttpCode(200)
  async logout(@Body('logout_token') token: string) {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: 'https://login.acme-idp.com', audience: 'wiki',
      algorithms: ['RS256', 'ES256'], maxTokenAge: '2m',
    }).catch(() => { throw new BadRequestException(); });
    const events = payload.events as Record<string, unknown> | undefined;
    // A logout token must carry the event, must NOT carry a nonce, needs sid or sub
    if (!events?.[EVENT] || 'nonce' in payload || (!payload.sid && !payload.sub)) throw new BadRequestException();
    // jti replay guard for the token's short life
    if ((await this.redis.set('blo:' + payload.jti, '1', 'EX', 300, 'NX')) !== 'OK') return;
    // Sessions were indexed by IdP sid / sub at login time
    const key = payload.sid ? 'idp-sid:' + payload.sid : 'idp-sub:' + payload.sub;
    const localSids = await this.redis.smembers(key);
    if (localSids.length) await this.redis.del(...localSids.map((s) => 'sess:' + s), key);
  }
}`,
        },
      ],
      keyPoints: [
        'Three clocks: IdP session, app session, token expiry — logout must address all three.',
        'Back-channel logout is server-to-server and survives third-party-cookie blocking; front-channel does not.',
        'Index local sessions by the IdP sid at login, or you cannot honour a logout token.',
      ],
      source: 'OpenID Connect Back-Channel Logout 1.0 §2.4–2.6; RP-Initiated Logout 1.0; SAML 2.0 Profiles §4.4 (Single Logout); NIST SP 800-63B-4 §2.2',
    },
    {
      heading: 'TOTP step by step — counter, HMAC, dynamic truncation, drift window and replay',
      body: `**Intuition:** the server and your phone share a secret and a clock. Every 30 seconds both compute the same 6-digit "fingerprint" of (secret, current 30-second slot). Matching fingerprints prove you hold the secret *now* — without the secret ever crossing the network after enrolment.

**Enrolment:** server generates a random secret (RFC 4226 requires ≥ 128 bits, recommends 160 — 20 bytes for SHA-1), stores it **encrypted** (it must be recoverable, so hashing is impossible), and shows a QR code of \`otpauth://totp/Acme:priya@acme.com?secret=<BASE32>&issuer=Acme&algorithm=SHA1&digits=6&period=30\`. The user confirms by typing one valid code — never activate MFA without that proof.

**Generation (RFC 6238 on top of RFC 4226 HOTP):**
1. **Counter:** \`T = floor((unixTime - T0) / X)\` with T0 = 0, X = 30 s. At unix time 59, T = 1; at 1,111,111,109, T = 37,037,036 (0x23523EC).
2. **Message:** T as an **8-byte big-endian** integer.
3. **HMAC:** \`HS = HMAC-SHA1(secret, message)\` → 20 bytes.
4. **Dynamic truncation:** \`offset = HS[19] & 0x0F\` (low nibble of the last byte, 0–15). Take 4 bytes \`HS[offset..offset+3]\`, clear the top bit (\`& 0x7F\` on the first) → a 31-bit integer. Clearing the sign bit avoids signed/unsigned ambiguity across languages.
5. **Digits:** \`code = bin mod 10^6\`, left-padded with zeros.

**Worked example (RFC 6238 Appendix B, secret = ASCII "12345678901234567890", time 59 s):** T = 1 → HMAC = \`75a48a19d4cbe100644e8ac1397eea747a2d33ab\` → last byte 0xab → offset 11 → bytes \`c1 39 7e ea\` → \`0x41397eea\` = 1,094,287,082 → mod 10^8 = **94287082** (the RFC's 8-digit vector) and mod 10^6 = **287082**.

**Verification rules that make it secure:**
- **Drift window:** accept T-1, T, T+1 (±30 s). RFC 6238 recommends at most one step back for network delay; wider windows multiply the guessing odds (3 valid codes in 10^6 per attempt).
- **Replay:** NIST SP 800-63B-4: a verifier SHALL accept a given OTP **only once**. Store the last accepted step per user; reject any step ≤ it. Without this, a shoulder-surfed or phished code works again for up to 90 s.
- **Rate limiting:** 6 digits is only 10^6 combinations. Lock or exponentially delay after ~5–10 failures (NIST caps consecutive failures at 100).
- **Constant-time compare** and **per-user drift tracking** (remember the offset a device usually lands on).
- **SHA-1 is fine here:** HOTP relies on HMAC's PRF property, not collision resistance. Most authenticator apps ignore \`algorithm=SHA256\`, so SHA-1 remains the interoperable default.`,
      diagram: `secret K (20 bytes, shared at enrolment via QR)        unix time t = 59
        |                                                      |
        |                         T = floor(59 / 30) = 1       |
        |                         msg = 00 00 00 00 00 00 00 01 (8 bytes BE)
        v                                   v
HMAC-SHA1(K,msg) = 75 a4 8a 19 d4 cb e1 00 64 4e 8a [c1 39 7e ea] 74 7a 2d 33 ab
                                                     ^ offset 11              ^
                                                     bytes 11..14  last=0xab
   offset = 0xab & 0x0f = 11; c1397eea & 0x7fffffff -> 0x41397eea = 1094287082
   1094287082 mod 10^6 = 287082   -> shown as "287 082" for 30 s

Server verify at t': try T'-1, T', T'+1; on match require step > lastUsedStep`,
      code: [
        {
          language: 'typescript',
          title: 'TOTP generate/verify with node:crypto — verified against RFC 6238 Appendix B',
          code: `import { createHmac, timingSafeEqual } from 'node:crypto';

const STEP = 30;            // seconds (X)
const DIGITS = 6;
const WINDOW = 1;           // accept T-1..T+1

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));                   // 8-byte big-endian counter
  const hs = createHmac('sha1', secret).update(msg).digest(); // 20 bytes
  const offset = hs[hs.length - 1] & 0x0f;                 // dynamic truncation
  const bin = ((hs[offset] & 0x7f) << 24) | (hs[offset + 1] << 16) |
              (hs[offset + 2] << 8) | hs[offset + 3];      // 31-bit integer
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const totp = (secret: Buffer, unixSec: number) => hotp(secret, Math.floor(unixSec / STEP));

/** Returns the matched step so the caller can persist it (replay protection), or null. */
export function verifyTotp(secret: Buffer, code: string, unixSec: number, lastUsedStep: number): number | null {
  if (!/^\\d{6}$/.test(code)) return null;
  const now = Math.floor(unixSec / STEP);
  let matched: number | null = null;
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    // check every candidate (no early exit) and compare in constant time
    const ok = timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(code));
    if (ok && s > lastUsedStep && matched === null) matched = s;
  }
  return matched;
}

// RFC 6238 Appendix B (SHA-1, 8 digits): t=59 -> 94287082, t=1111111109 -> 07081804
const k = Buffer.from('12345678901234567890');
console.assert(hotp(k, Math.floor(59 / 30), 8) === '94287082');
console.assert(hotp(k, Math.floor(1111111109 / 30), 8) === '07081804');
console.assert(totp(k, 59) === '287082');`,
        },
        {
          language: 'typescript',
          title: 'NestJS service: atomic replay guard + attempt limiting around verifyTotp',
          code: `import { Injectable, UnauthorizedException, HttpException } from '@nestjs/common';
import Redis from 'ioredis';
import { verifyTotp } from './totp';
import { SecretVault } from './secret-vault'; // decrypts the per-user TOTP secret via KMS

// Compare-and-set in one round trip: only move lastStep forward
const ADVANCE = "local cur = tonumber(redis.call('GET', KEYS[1]) or '-1') " +
  "if tonumber(ARGV[1]) > cur then redis.call('SET', KEYS[1], ARGV[1], 'EX', 120) return 1 end return 0";

@Injectable()
export class MfaService {
  constructor(private readonly redis: Redis, private readonly vault: SecretVault) {}

  async check(userId: string, code: string): Promise<void> {
    const fails = await this.redis.incr('mfa:fail:' + userId);
    if (fails === 1) await this.redis.expire('mfa:fail:' + userId, 900);
    if (fails > 5) throw new HttpException('Too many attempts, try again later', 429);

    const secret = await this.vault.totpSecret(userId);
    const last = Number((await this.redis.get('mfa:last:' + userId)) ?? -1);
    const step = verifyTotp(secret, code, Math.floor(Date.now() / 1000), last);
    // Two parallel requests with the same code: only one wins the CAS
    if (step === null || (await this.redis.eval(ADVANCE, 1, 'mfa:last:' + userId, step)) !== 1) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.redis.del('mfa:fail:' + userId);
  }
}`,
        },
      ],
      keyPoints: [
        'counter = floor(t/30) → HMAC-SHA1 → offset = last nibble → 31 bits → mod 10^6.',
        'Window ±1 step; persist last accepted step atomically to make codes single-use.',
        'The TOTP secret is stored encrypted, not hashed — the server must recompute codes.',
      ],
      source: 'RFC 4226 §5.3–5.4 and Appendix D; RFC 6238 §4, §5.2 and Appendix B; NIST SP 800-63B-4 §3.1.4–3.1.5',
    },
    {
      heading: 'MFA beyond TOTP — SMS risk, push fatigue, WebAuthn/passkeys and recovery codes',
      body: `**Intuition:** a factor is only as strong as its weakest recovery path and the easiest way to trick a human into handing it over.

**Factor categories:** something you know (password, PIN), have (phone, security key), are (biometric — in WebAuthn it only *unlocks* the local key; the biometric never leaves the device).

| Method | Main attack | Phishing-resistant? | Notes |
|---|---|---|---|
| SMS / voice OTP | **SIM swap** (social-engineer the carrier, port the number), SS7 interception, malware reading SMS | No | NIST SP 800-63B-4 calls PSTN OTP a *restricted* authenticator; verifiers should check SIM-change/porting signals. In India, OTP SMS is ubiquitous (RBI AFA for card payments), so pair it with device binding and risk scoring. |
| TOTP app | Real-time phishing proxy (Evilginx-style) relays the code within 30 s | No | Offline, cheap, no carrier. |
| Push approve | **MFA fatigue** — spam pushes until the user taps Approve | No | Use number matching (type the 2 digits shown on screen). |
| WebAuthn / passkeys | Malware on the device; account recovery | **Yes** | Signature bound to the origin. |

**Why WebAuthn is phishing-resistant:** at registration the authenticator creates a key pair *scoped to the RP ID* (e.g. \`acme.com\`) and gives the server the public key. At login the server sends a random challenge; the browser includes the **origin it is actually on** in \`clientDataJSON\`, and the authenticator signs \`authenticatorData (with rpIdHash, flags, signCount) || SHA-256(clientDataJSON)\`. On \`acme-login.evil.com\` the browser simply won't use the acme.com credential, and even a relayed signature contains the wrong origin. The server verifies challenge, origin, rpIdHash, the user-presence/user-verification flags and the signature.

**Passkeys** = discoverable WebAuthn credentials, usually **synced** across a user's devices by Apple/Google/1Password. NIST SP 800-63B-4 allows syncable authenticators up to AAL2 and requires at least one phishing-resistant option to be *offered* at AAL2; AAL3 needs a non-exportable key (device-bound security key).

**Recovery is the real attack surface:**
- Generate 8–10 **single-use recovery codes** (~50 bits each, e.g. 10 chars from a 31-symbol alphabet), show once, store **hashed** like passwords (they are low-ish entropy, so a slow hash is reasonable), mark used atomically.
- Register **two** strong factors (two passkeys / security keys) instead of falling back to SMS.
- Support-desk reset must be at least as strong as the factor it replaces (ID verification + cooling-off delay + notify all channels). A strong MFA with "reset via email link" is email security.
- Step-up: require fresh MFA (\`auth_time\` recent, \`acr\`) for payouts, MFA changes, adding API keys.`,
      code: [
        {
          language: 'typescript',
          title: 'Recovery codes: generate once, store hashed, redeem atomically',
          code: `import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { Pool } from 'pg';

const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L confusion

function code(): string {
  const b = randomBytes(10);
  const s = [...b].map((x) => A[x % A.length]).join(''); // ~49 bits; slight modulo bias acceptable here
  return s.slice(0, 5) + '-' + s.slice(5);
}

export async function issueRecoveryCodes(db: Pool, userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, code);
  const hashes = await Promise.all(codes.map((c) => argon2.hash(c.replace('-', ''))));
  await db.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]); // old set invalid
  await db.query(
    'INSERT INTO recovery_codes (user_id, hash) SELECT $1, unnest($2::text[])', [userId, hashes]);
  return codes; // display once; user must download/print
}

export async function redeem(db: Pool, userId: string, input: string): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT id, hash FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
  for (const r of rows) {
    if (await argon2.verify(r.hash, input.replace('-', '').toUpperCase())) {
      // Conditional update = single use even under concurrent redemption
      const u = await db.query(
        'UPDATE recovery_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL', [r.id]);
      return u.rowCount === 1;
    }
  }
  return false;
}`,
        },
      ],
      keyPoints: [
        'SMS OTP falls to SIM swap; TOTP and push fall to real-time phishing; WebAuthn binds the signature to the origin.',
        'Passkeys = synced discoverable WebAuthn credentials: fine for AAL2, not AAL3.',
        'Recovery codes are hashed, single-use, and the recovery path must not be weaker than MFA.',
      ],
      source: 'W3C WebAuthn Level 3 §6–7; NIST SP 800-63B-4 §2.2–2.3, §3.1.3.3, §3.2.5; OWASP Multifactor Authentication Cheat Sheet',
    },
    {
      heading: 'JWT vs PASETO — algorithm agility as a vulnerability, versions, purposes and footers',
      body: `**Intuition:** JWT is a toolbox where the *token itself* tells the verifier which tool to use — so an attacker can hand you the wrong tool. PASETO welds the tool to the version number: \`v4.public\` can only ever mean Ed25519.

**JWT's structural foot-guns (all real CVEs in popular libraries):**
- **\`alg: none\`** — an unsigned token accepted as valid.
- **RS256 → HS256 confusion** — the verifier is configured with an RSA *public* key; the attacker sets \`alg: HS256\` and signs with that public key (which is public!) as the HMAC secret. A library that picks the algorithm from the header verifies it.
- **\`jwk\`/\`jku\`/\`x5u\` header injection** — the token carries the key to verify itself with.
- **\`kid\` used as a file path or SQL fragment** — path traversal / injection.
- **ECDSA "psychic signatures"** (Java CVE-2022-21449: r = s = 0 accepted).
- JWE adds RSA1_5 padding-oracle and invalid-curve attacks.

The fixes (RFC 8725) are all "remember to configure it right": pin algorithms, ignore key-bearing headers, check \`typ\`. PASETO's design removes the choice.

**PASETO format:** \`version.purpose.payload[.footer]\`
- **Versions:** current are **v3** (NIST family — for FIPS shops) and **v4** (Sodium family — recommended default). v1/v2 are legacy; libraries should accept only the latest two per family.
- **Purposes:** \`local\` = symmetric **authenticated encryption** (claims are *confidential*; v4.local = XChaCha20 + BLAKE2b-MAC, v3.local = AES-256-CTR + HMAC-SHA384). \`public\` = **signature** (claims readable; v4.public = Ed25519, v3.public = ECDSA P-384).
- **Footer:** optional, base64url, **authenticated but never encrypted** — put the key ID there for rotation (\`{"kid":"k1"}\`); never secrets.
- **Implicit assertions (v3/v4):** data bound into the MAC/signature but not transmitted, e.g. the tenant ID or audience — a token minted for tenant A fails verification in tenant B's context.
- Uses **PAE** (pre-authentication encoding) so header, payload and footer can't be confused by concatenation tricks.

| | JWT (JWS/JWE) | PASETO v4 |
|---|---|---|
| Algorithm choice | In the token header (verifier must pin) | Fixed by version + purpose |
| Encrypted claims | JWE (complex, many modes) | \`v4.local\` (one construction) |
| Key ID | \`kid\` header | footer (authenticated) |
| Ecosystem | Universal: OIDC, every IdP, API gateways | Small; no OIDC, few gateways |
| Claim validation | Library- and config-dependent | Spec-defined registered claims, still validated by the library |

**Verdict for interviews:** for anything OIDC/IdP-facing you must use JWT — pin the algs and use a vetted library (\`jose\`). For internal tokens you mint and verify yourself (edge→service, signed links, email-verification tokens), PASETO v4 is a defensible choice that kills a whole bug class. Neither fixes revocation: both are value tokens.`,
      code: [
        {
          language: 'typescript',
          title: 'The JWT bug PASETO designs out — and the PASETO v4 equivalent',
          code: `import jwt from 'jsonwebtoken';
import { V4 } from 'paseto';                // panva/paseto v3 API
import { generateKeyPairSync } from 'node:crypto';

// BAD: header decides the algorithm. With an RSA public key passed as a string,
// older libraries accepted alg=HS256 signed with that very public key.
export function verifyUnsafe(token: string, publicKeyPem: string) {
  return jwt.verify(token, publicKeyPem); // no 'algorithms' option!
}

// FIX for JWT: pin it
export const verifyJwt = (token: string, publicKeyPem: string) =>
  jwt.verify(token, publicKeyPem, { algorithms: ['RS256'], issuer: 'edge', audience: 'orders' });

// PASETO v4.public: Ed25519 is the ONLY possibility for this prefix
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

export async function mintInternal(sub: string, tenant: string) {
  return V4.sign(
    { sub, scope: 'orders:read' },
    privateKey,
    {
      issuer: 'edge', audience: 'orders', expiresIn: '60s',
      footer: JSON.stringify({ kid: 'edge-2026-10' }), // authenticated, NOT encrypted
      assertion: tenant,                                // implicit assertion: bound, not sent
    },
  ); // => 'v4.public.eyJzdWIiOi...sig.eyJraWQiOiJlZGdlLTIwMjYtMTAifQ'
}

export async function verifyInternal(token: string, tenant: string) {
  // Wrong tenant -> signature fails even though the token bytes are genuine
  return V4.verify(token, publicKey, { issuer: 'edge', audience: 'orders', assertion: tenant });
}`,
        },
      ],
      keyPoints: [
        'JWT bugs come from header-driven algorithm and key selection; pin algs or remove the choice.',
        'PASETO local = encrypted (confidential), public = signed (readable); footer is authenticated plaintext.',
        'Implicit assertions bind context (tenant, audience) without transmitting it.',
      ],
      source: 'PASETO spec — Protocol Versions, PAE, Implicit Assertions; RFC 8725 (JWT BCP) §2.1–2.8',
    },
    {
      heading: 'Designing auth for a multi-app company — central IdP, token exchange and service-to-service',
      body: `**Scenario:** a fintech in Bengaluru runs a consumer app (web + Android/iOS), a merchant dashboard, an internal admin console, 120 microservices, and sells to enterprises who demand "SSO with our Okta/Entra". How do you design auth?

**1. One identity plane.** A central IdP/broker (Keycloak, Auth0, Cognito, Entra External ID) owns users, passwords (argon2id), MFA, passkeys, sessions and **federation**: enterprise customers' SAML/OIDC IdPs plug in per tenant (home-realm discovery by email domain). Apps speak only OIDC to the broker — SAML stops at the broker.

**2. Per-app clients.** Each app is its own OIDC client with its own redirect URIs, scopes and token lifetimes. Web apps use a **BFF** (tokens server-side, HttpOnly session cookie); mobile apps use code + PKCE with refresh tokens in Keystore/Keychain; admin console requires phishing-resistant MFA (\`acr\` = passkey/security key) and shorter sessions.

**3. Edge validation.** The API gateway validates access tokens (JWKS cached, algs pinned, \`aud\`), enforces scopes and rate limits by \`client_id\`/API key, and strips client-supplied identity headers.

**4. Propagating the user to internal services.** Don't forward the external token everywhere (wide audience, long blast radius). Use **RFC 8693 Token Exchange**: the gateway (or service) presents the subject token at the STS and receives a new short-lived token (30–120 s) with \`aud\` = the downstream service, narrower scopes, and an \`act\` claim recording the actor ("orders-svc acting for user 42"). Cheaper variant: gateway mints a signed internal token (JWT or PASETO) per request.

**5. Workload identity.** Service-to-service authentication via **mTLS with SPIFFE IDs** (\`spiffe://acme/ns/payments/sa/ledger\`) issued by the mesh/SPIRE, rotated hourly. Authorisation = "is caller workload X allowed to call method Y" (mesh policy) **and** "is end-user U allowed on object O" (service code / policy engine). Machine-to-machine without a user: client-credentials grant or the workload identity itself.

**6. Partners and webhooks.** Partner API: API key (identity, quota) + HMAC signing or mTLS. Outgoing webhooks: HMAC over \`timestamp.body\` with a per-merchant secret.

**7. Operations.** Key rotation via JWKS with overlapping keys (publish new key → wait > cache TTL → sign with new → retire old after max token lifetime). Central audit of logins and token issuance; SCIM for enterprise deprovisioning (deleting a user in Okta should kill sessions here within minutes — SCIM + back-channel logout).`,
      diagram: `   Enterprise IdPs (SAML/OIDC)      Consumers (password+passkey)
              \\                            /
            +--------------------------------+
            |  Central IdP / broker + STS    |  users, MFA, sessions,
            |  (OIDC out, SAML/OIDC in)      |  JWKS, token exchange
            +--------------------------------+
            ^ OIDC code+PKCE        ^ RFC 8693 exchange
            |                       |
 [Web BFF] [Mobile] [Admin]     +---+--------+   mTLS (SPIFFE IDs)
     \\        |       /          |  Gateway   |---------> orders-svc
      +---- access token ------> | validate,  |              | exchange:
                                 | scopes, RL |              v aud=ledger
                                 +------------+          ledger-svc`,
      keyPoints: [
        'Federate everything at one broker; apps only speak OIDC.',
        'Token exchange gives each hop a narrow-audience, short-lived token with an actor chain.',
        'Workload identity (mTLS/SPIFFE) answers "which service"; the propagated token answers "which user".',
      ],
      source: 'RFC 8693 (OAuth 2.0 Token Exchange); SPIFFE/SPIRE docs; RFC 7644 (SCIM)',
    },
  ],
  codeChallenges: [
    {
      id: 'api-auth-sso-cc-1',
      title: 'Harden a TOTP verifier that a pentest flagged',
      context:
        'A NestJS fintech app added "2FA" last sprint. The pentest report says: codes can be reused, a 6-digit code was brute-forced in under an hour against one account, and codes sometimes fail for users whose phones are a few seconds off. Here is the verifier.',
      task: 'Rewrite verification so codes are single-use, brute force is infeasible, clock drift is handled within RFC 6238 guidance, and the comparison does not leak timing. Keep it a pure function plus a small service around storage.',
      starter: {
        language: 'typescript',
        code: `import { createHmac } from 'node:crypto';

function code(secret: Buffer, t: number): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(t, 4);
  const hs = createHmac('sha1', secret).update(msg).digest();
  const o = hs[19] & 0x0f;
  const bin = hs.readUInt32BE(o);              // no sign-bit mask
  return String(bin % 1_000_000);              // no zero padding
}

export async function verify(userId: string, input: string, users: UserRepo) {
  const u = await users.find(userId);
  const secret = Buffer.from(u.totpSecret, 'base64'); // stored in plaintext column
  const now = Math.round(Date.now() / 30_000);   // rounds, not floors
  for (let s = now - 10; s <= now + 10; s++) {   // +-5 minutes "for flaky phones"
    if (code(secret, s) === input) return true;  // early exit, string compare
  }
  return false;                                  // no attempt counting, no replay check
}`,
      },
      hints: [
        'Compare the generator line by line with RFC 4226 §5.3: what happens to codes beginning with 0, and to bytes with the high bit set?',
        'How many valid codes exist per attempt with a ±10 step window, and what does an attacker get with unlimited attempts?',
        'NIST says an OTP is accepted only once. What do you need to persist, and how do you make it race-free under two concurrent requests?',
      ],
      solution: {
        language: 'typescript',
        code: `import { createHmac, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';

const STEP = 30, WINDOW = 1, MAX_FAILS = 5;

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));                 // full 64-bit counter
  const hs = createHmac('sha1', secret).update(msg).digest();
  const o = hs[19] & 0x0f;
  const bin = hs.readUInt32BE(o) & 0x7fffffff;            // RFC 4226: drop sign bit
  return String(bin % 1_000_000).padStart(6, '0');       // keep leading zeros
}

export function match(secret: Buffer, input: string, unixMs: number, lastStep: number): number | null {
  if (!/^\\d{6}$/.test(input)) return null;
  const now = Math.floor(unixMs / 1000 / STEP);           // floor per RFC 6238
  let hit: number | null = null;
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    const eq = timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(input));
    if (eq && s > lastStep && hit === null) hit = s;      // no early exit
  }
  return hit;
}

const CAS = "if tonumber(ARGV[1]) > tonumber(redis.call('GET', KEYS[1]) or '-1') then " +
  "redis.call('SET', KEYS[1], ARGV[1], 'EX', 300) return 1 end return 0";

export async function verify(userId: string, input: string, redis: Redis, kms: { totpSecret(id: string): Promise<Buffer> }) {
  const failsKey = 'totp:fail:' + userId;
  const fails = await redis.incr(failsKey);
  if (fails === 1) await redis.expire(failsKey, 900);
  if (fails > MAX_FAILS) return { ok: false, locked: true };
  const secret = await kms.totpSecret(userId);            // envelope-encrypted at rest
  const last = Number((await redis.get('totp:last:' + userId)) ?? -1);
  const step = match(secret, input, Date.now(), last);
  const ok = step !== null && (await redis.eval(CAS, 1, 'totp:last:' + userId, step)) === 1;
  if (ok) await redis.del(failsKey);
  return { ok, locked: false };
}`,
      },
      explanation: `**Fixes, one per finding:**
- **Counter encoding:** the starter wrote only the low 32 bits; RFC 4226 requires an 8-byte big-endian counter (\`writeBigUInt64BE\`). Fine today, wrong for test vectors like t = 20,000,000,000.
- **Truncation:** missing \`& 0x7fffffff\` produced different codes from Google Authenticator for ~50% of slots (whenever the selected byte had its high bit set).
- **Zero padding:** codes like \`042917\` became \`42917\` and never matched.
- **Math.round vs floor:** round shifts the slot boundary by 15 s, so the server's "current" step is wrong half of the time.
- **Window:** ±10 steps = 21 valid codes per guess; with no rate limit the expected brute-force time collapses. ±1 step + 5 failures per 15 min makes online guessing ~3 × 5 / 10^6 per window.
- **Replay:** persisting the last accepted step with an atomic compare-and-set makes each code single-use (NIST 800-63B-4), even under concurrent submissions.
- **Timing:** constant-time compare over all candidates, no early exit.
- **Secret at rest:** encrypted via KMS rather than a plaintext column; it cannot be hashed because the server must recompute codes.`,
      followUps: [
        {
          q: 'The attacker rotates across 200,000 accounts with one guess each instead of hammering one account. Does your per-user limit help?',
          a: 'Not much: each account sees one failure. Per guess the success rate is 3/10^6, so 200K guesses yield ~0.6 compromised accounts — and that is only reachable after the attacker already holds those passwords. Add global and per-IP/ASN failure-rate alarms, require the password step to succeed first (TOTP is the second factor), bind the MFA attempt to the half-authenticated session, and alert on credential-stuffing patterns upstream.',
        },
        {
          q: 'How would you write tests for this without sleeping or mocking Date globally?',
          a: 'Make time an argument (as `match` already takes `unixMs`). Use RFC 6238 Appendix B: secret "12345678901234567890", t = 59 s → 8-digit 94287082 / 6-digit 287082; t = 1111111109 → 07081804. Test window edges (step −2 rejected, −1 accepted), replay (same step twice → second fails), leading zero (07081804 path), and the CAS under `Promise.all` of two verifies with the same code against a real Redis in a container.',
        },
      ],
    },
    {
      id: 'api-auth-sso-cc-2',
      title: 'Fix an SSO callback that trusts too much',
      context:
        'Your team integrated a corporate IdP with a hand-rolled OIDC callback in a NestJS controller. Security review found login CSRF, an open redirect, and a way to log in as someone else with a token minted for a different app on the same IdP.',
      task: 'Rewrite the login and callback handlers so the authorization response is bound to this browser, the ID token is validated as OIDC Core requires, the post-login redirect cannot leave the site, and the session cannot be fixated.',
      starter: {
        language: 'typescript',
        code: `import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { decodeJwt } from 'jose';

@Controller('auth')
export class AuthController {
  @Get('login')
  login(@Query('returnTo') returnTo: string, @Res() res: any) {
    res.redirect('https://idp.acme.com/authorize?response_type=code&client_id=wiki'
      + '&redirect_uri=https://wiki.acme.com/auth/cb&scope=openid%20email&state=' + encodeURIComponent(returnTo));
  }

  @Get('cb')
  async cb(@Query('code') code: string, @Query('state') state: string, @Req() req: any, @Res() res: any) {
    const r = await fetch('https://idp.acme.com/token', {
      method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code,
        client_id: 'wiki', client_secret: process.env.SECRET!, redirect_uri: 'https://wiki.acme.com/auth/cb' }),
    });
    const { id_token } = await r.json();
    const claims = decodeJwt(id_token);          // decoded, not verified
    req.session.user = { email: claims.email };  // same session id as before login
    res.redirect(state);                          // state doubles as returnTo
  }
}`,
      },
      hints: [
        'state is supposed to be an unguessable value tied to the browser that started the flow. What is it here, and what can an attacker put in it?',
        'Which ID-token claims tie it to THIS client and THIS authorization request? decodeJwt checks none of them.',
        'What should happen to the pre-login session ID once the user is authenticated?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Controller, Get, Query, Req, Res, BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISS = 'https://idp.acme.com';
const JWKS = createRemoteJWKSet(new URL(ISS + '/.well-known/jwks.json'));
const rnd = () => randomBytes(32).toString('base64url');
const safePath = (p?: string) => (p && /^\\/(?![/\\\\])[\\w\\-./?=&%]*$/.test(p) ? p : '/'); // same-site path only

@Controller('auth')
export class AuthController {
  @Get('login')
  login(@Query('returnTo') returnTo: string, @Req() req: any, @Res() res: any) {
    const state = rnd(), nonce = rnd(), verifier = rnd();
    req.session.oidc = { state, nonce, verifier, returnTo: safePath(returnTo), at: Date.now() };
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const u = new URL(ISS + '/authorize');
    u.search = new URLSearchParams({ response_type: 'code', client_id: 'wiki',
      redirect_uri: 'https://wiki.acme.com/auth/cb', scope: 'openid email', state, nonce,
      code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    res.redirect(u.href);
  }

  @Get('cb')
  async cb(@Query('code') code: string, @Query('state') state: string, @Req() req: any, @Res() res: any) {
    const p = req.session.oidc; delete req.session.oidc;           // one-shot
    if (!p || p.state !== state || Date.now() - p.at > 10 * 60_000) throw new BadRequestException();
    const r = await fetch(ISS + '/token', { method: 'POST', signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: p.verifier,
        client_id: 'wiki', client_secret: process.env.SECRET!, redirect_uri: 'https://wiki.acme.com/auth/cb' }) });
    if (!r.ok) throw new BadRequestException();
    const { id_token } = await r.json();
    const { payload } = await jwtVerify(id_token, JWKS, {
      issuer: ISS, audience: 'wiki', algorithms: ['RS256'], maxTokenAge: '10m' });
    if (payload.nonce !== p.nonce) throw new BadRequestException();     // replay / injection
    if (payload.azp && payload.azp !== 'wiki') throw new BadRequestException();
    req.session.regenerate((err: unknown) => {                          // anti-fixation
      if (err) return res.status(500).end();
      req.session.user = { sub: payload.sub, iss: payload.iss, sid: payload.sid };
      res.redirect(p.returnTo);
    });
  }
}`,
      },
      explanation: `- **state** is now a random value stored in the pre-login session and compared on return: an attacker can no longer splice *their* authorization code into the victim's browser (login CSRF).
- **returnTo** is kept server-side and restricted to a same-site path (rejecting \`//evil.com\` and \`/\\evil.com\`): no open redirect, which matters doubly in SSO because phishers chain trusted IdP + open redirect.
- **PKCE** binds the code to this flow even for confidential clients (RFC 9700 recommends it for all clients).
- **ID token verified**: signature via JWKS with pinned alg, \`iss\`, \`aud\` = wiki (a token issued to another app on the same IdP is rejected), \`azp\`, freshness, and **nonce** equality.
- **Identity key** is \`iss\` + \`sub\`, not \`email\` — emails are reassignable and some IdPs let users edit them unverified.
- **Session regenerated** after login (fixation), with a timeout on the token call.`,
      followUps: [
        {
          q: 'An enterprise customer insists on IdP-initiated SAML from their Okta dashboard, which has no state or InResponseTo. How do you accept it safely?',
          a: 'Treat it as an untrusted entry point: validate signature (pinned cert), Audience, Recipient and NotOnOrAfter as usual, keep a one-time cache of assertion IDs until expiry, then **do not** create the session directly — immediately start a fresh SP-initiated flow (redirect to your own login with the tenant hint). The IdP session makes it silent, and you get a properly correlated response. Never honour RelayState as a redirect target without an allow-list.',
        },
        {
          q: 'You now run 15 apps against the IdP. How do you stop every team re-implementing this callback?',
          a: 'Ship one shared auth module (or a BFF/edge auth service) that owns /login, /cb and /logout using a certified library (openid-client), with per-app config only: client_id, redirect URI, scopes, required acr. Contract-test it against the IdP in CI (wrong aud, stale nonce, bad state). Better still, put OIDC at an auth proxy (oauth2-proxy / gateway plugin) so apps receive a verified internal identity header from a trusted hop and never parse IdP tokens.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'api-auth-sso-iq-01',
      difficulty: 'hard',
      question:
        'Our admin console authenticates with 24-hour JWTs in localStorage. After an employee was terminated, they kept deleting merchant data for six hours. Security now wants access cut within 60 seconds of HR offboarding, without adding 40 ms to every request. Redesign it.',
      whatInterviewerLooksFor: [
        'Recognises the problem is revocation latency of value tokens, not JWT per se',
        'Moves the browser to a revocable session (BFF / HttpOnly cookie) and explains the XSS benefit',
        'Puts a number on the revocation path (cache TTL, push invalidation) and the per-request cost',
        'Connects offboarding (SCIM / IdP) to session kill end to end',
      ],
      modelAnswer: `**Diagnosis.** A 24 h bearer JWT is an unrevocable capability for 24 h, and localStorage means any XSS can copy it off-box. Two separate problems: *lifetime* and *where the credential lives*.

**Target design**
- **Browser ↔ BFF:** admin console gets an opaque session ID in a \`__Host-\` HttpOnly, Secure, SameSite=Strict cookie. Session record in Redis: \`{sub, idpSid, roles, createdAt, lastSeen}\`, idle 30 min, absolute 8 h. Revocation = DEL — instant.
- **Per-request cost:** one Redis GET in-AZ ≈ 0.3–1 ms, nowhere near 40 ms. Cache negative results? No — cache nothing positive locally beyond ~5 s.
- **BFF → APIs:** BFF mints a 60 s internal token (or uses a 5 min access token from the IdP) so downstream services still verify locally. Worst-case staleness downstream = 60 s, which meets the SLA.
- **Offboarding path:** HR → IdP deactivates the user → SCIM \`PATCH active=false\` (or an IdP event / back-channel logout token) → our handler looks up all sessions for that \`sub\` (Redis set \`user-sessions:{sub}\`) and deletes them, and revokes refresh tokens. Target: < 10 s from IdP change.
- **Belt and braces:** a per-user \`tokens_valid_after\` timestamp in Redis checked by the BFF on each request; any session or token older than it dies.

**Migration:** dual-accept old JWTs for one release with expiry cut to 15 min, then remove. Add CSRF protection (SameSite=Strict + Origin check) since we moved to cookies.

**Hardening for an admin surface:** phishing-resistant MFA (passkeys), step-up on destructive actions (\`auth_time\` < 5 min), audit log keyed by session ID.`,
      followUps: [
        {
          q: 'Redis for sessions is down for 3 minutes. What does the admin console do?',
          a: 'Fail closed for admin — it is a privileged surface, and failing open would resurrect revoked sessions. Mitigate with Redis replicas + automatic failover (seconds), and keep a tiny in-process cache (≤5 s) to ride over blips. Consumer apps might choose a degraded read-only mode, but never for admin writes.',
        },
        {
          q: 'Why not keep JWTs and just check a denylist on every request?',
          a: 'You can, and it works — but then every request does a lookup anyway, so you pay the session cost while still shipping a JS-readable bearer token that XSS can exfiltrate and replay from another machine. The denylist also only covers tokens you know to list; a session store is an allow-list. For browsers, the cookie session plus BFF wins on both axes.',
        },
        {
          q: 'How do you prove the 60-second SLA is met?',
          a: 'Synthetic test in production: a canary user is deactivated in the IdP every hour, and a probe keeps calling an admin endpoint with its session; alert if access persists past 30 s. Emit a metric from SCIM receipt to last-session-deleted, and track p99.',
        },
      ],
      pitfalls: [
        'Shortening JWT expiry to 1 minute without a refresh story (users logged out constantly)',
        'Claiming Redis lookups are "too slow" without numbers',
        'Ignoring the XSS exposure of localStorage',
        'Forgetting downstream services may hold their own cached authorisation',
      ],
    },
    {
      id: 'api-auth-sso-iq-02',
      difficulty: 'medium',
      question:
        'Walk me through exactly what happens, request by request, when a user who has just logged into payroll.acme.com opens benefits.acme-hr.io in a new tab, and is in without typing anything. Which cookies exist on which domains at the end?',
      whatInterviewerLooksFor: [
        'Correct roles: two SPs/RPs and one IdP',
        'Knows the IdP session cookie is on the IdP domain and is what makes login silent',
        'Knows each app sets its own session; nothing is shared across app domains',
        'Mentions audience restriction and the one-time code/assertion',
      ],
      modelAnswer: `**Actors:** payroll and benefits are relying parties; login.acme-idp.com is the IdP. The two apps are on *different registrable domains*, so they can never share a cookie.

**Requests when opening benefits:**
1. \`GET benefits.acme-hr.io/\` — no \`benefits_sid\` cookie → app creates state/nonce/PKCE verifier in a short-lived pre-auth cookie and responds **302** to \`login.acme-idp.com/authorize?client_id=benefits&...\` (or a SAML AuthnRequest).
2. Browser follows the redirect to the IdP origin and **automatically sends \`idp_sid\`**, the cookie the IdP set when the user logged into payroll earlier.
3. IdP looks up the session: authenticated 12 minutes ago with password + TOTP, within max age and policy for this client → **no login page**. It checks the user is assigned to benefits, then issues a one-time authorization code (or a signed assertion) whose audience is *benefits*.
4. **302** back to \`benefits.acme-hr.io/cb?code=..&state=..\`.
5. Benefits verifies state, exchanges the code server-to-server, validates the ID token (iss, aud=benefits, nonce, exp), creates its own session and sets \`benefits_sid\`.
6. **302** to the original page. Total: 3–4 redirects, typically 200–500 ms.

**Cookies at the end:**
| Domain | Cookie | Meaning |
|---|---|---|
| login.acme-idp.com | idp_sid | IdP session (the "single" in SSO) |
| payroll.acme.com | payroll_sid | Payroll's local session |
| benefits.acme-hr.io | benefits_sid | Benefits' local session |

**Why it is safe:** the code is single-use, short-lived (~60 s), bound to benefits' client and redirect URI (and PKCE); payroll's assertion could never be replayed to benefits because of the audience restriction.`,
      followUps: [
        {
          q: 'Safari blocks third-party cookies. Does this flow break?',
          a: 'No. Every IdP interaction here is a top-level navigation, where the IdP cookie is first-party. What breaks is anything that loads the IdP in an iframe: silent token renewal via hidden iframe (prompt=none) and front-channel logout. Use refresh tokens/BFF for renewal and back-channel logout instead.',
        },
        {
          q: 'HR wants benefits to always re-ask for the password, even with a live IdP session. How?',
          a: 'Benefits sends `prompt=login` (or `max_age=0`) in OIDC, or `ForceAuthn="true"` in SAML, and then verifies the returned `auth_time` is recent — the app must check, since a misconfigured IdP could ignore the parameter. For "just MFA again", request a higher `acr_values` and check `acr`/`amr`.',
        },
      ],
      pitfalls: [
        'Saying the session cookie is shared across all apps',
        'Forgetting each app validates audience and creates a local session',
        'Confusing the IdP session with the access token',
      ],
    },
    {
      id: 'api-auth-sso-iq-03',
      difficulty: 'expert',
      context: 'B2B SaaS (think a Freshworks/Zoho-style product) with 3,000 tenants; 40 enterprise tenants demand SAML SSO with their own Okta, Entra ID or ADFS.',
      question:
        'Design multi-tenant SAML SSO for our product. Cover how a user is routed to the right IdP, how you validate assertions, how users get provisioned and deprovisioned, and what happens when a customer rotates their signing certificate.',
      whatInterviewerLooksFor: [
        'Home-realm discovery and per-tenant SP/IdP configuration',
        'A concrete assertion-validation checklist including XML signature wrapping and replay',
        'JIT provisioning vs SCIM, and account-linking risks',
        'Operational detail: certificate rollover with overlap, metadata refresh, monitoring',
      ],
      modelAnswer: `**Architecture.** Put SAML behind an identity broker (Keycloak / Auth0 / WorkOS-style service, or our own auth service) so the product only consumes OIDC. Each tenant gets a config row: \`{tenantId, idpEntityId, ssoUrl, signingCerts[], emailDomains[], enforceSso, attributeMap}\` and a **per-tenant SP entity ID and ACS URL** (\`/saml/{tenantId}/acs\`) so one tenant's assertion can never be accepted for another.

**Routing (home-realm discovery).** Login page asks for email → map verified domain \`@bigcorp.com\` to tenant → SP-initiated AuthnRequest to that tenant's IdP. Domains must be **verified** (DNS TXT) or a tenant could claim \`gmail.com\` and hijack logins. Also support tenant-specific URLs (\`bigcorp.app.com\`).

**Validation at the ACS:** signature with the tenant's pinned certs (ignore KeyInfo), read only the signed assertion (XSW), Audience = that tenant's SP entity ID, Destination/Recipient = that ACS, InResponseTo matches a stored request ID, time window ±2 min, assertion ID stored in Redis until NotOnOrAfter (replay), XML parser with DTDs off. Prefer a mature library; fuzz it with known XSW payloads in CI.

**Provisioning.** JIT: create the user on first valid assertion within that tenant, mapping groups → roles. Never auto-link to an existing **password** account by email without the user proving ownership. **Deprovisioning** needs SCIM (\`active=false\` → kill sessions, revoke API keys created by the user); JIT alone leaves ghost accounts that keep API keys alive.

**Enforcement.** \`enforceSso\` disables passwords for that tenant's users (with a break-glass admin protected by passkey).

**Cert rotation.** Store an array of certs; customers add the new cert to us (or we poll their metadata URL daily), we accept both during overlap, then remove the old. Alert 30/14/7 days before the cert's NotAfter, and alert on a spike of signature failures per tenant — that is almost always an unannounced rotation.`,
      followUps: [
        {
          q: 'A tenant admin misconfigures their IdP to send NameID as an editable display name. What can go wrong?',
          a: 'Anyone who can edit their display name in the customer IdP can impersonate another user in our app. Key accounts on an immutable identifier: persistent NameID or an immutable object ID attribute (Entra `oid`), scoped by tenant, and treat email as a mutable attribute. Store `(tenantId, idpSubject)` as the unique link.',
        },
        {
          q: 'How do you support 40 IdPs without 40 deployments of your config?',
          a: 'Make tenant SSO config data, not code: a self-serve admin UI that ingests IdP metadata XML or URL, validates it (cert parse, required endpoints), runs a test login before enabling, and versions the config so a bad change can be rolled back. The broker loads config per request from a cache keyed by tenant.',
        },
        {
          q: 'Is SAML Single Logout worth implementing for these tenants?',
          a: 'Implement SP-side receipt of LogoutRequest and our own session kill, but do not promise reliable global logout: front-channel SLO chains break on any failing SP. Most enterprises are satisfied with short app sessions (e.g. 8 h absolute) plus SCIM deactivation.',
        },
      ],
      pitfalls: [
        'One global ACS/audience for all tenants',
        'Routing by unverified email domain',
        'Auto-linking SSO identities to existing accounts by email',
        'Ignoring deprovisioning',
      ],
    },
    {
      id: 'api-auth-sso-iq-04',
      difficulty: 'hard',
      question:
        'Implement authenticator-app 2FA for our NestJS backend from scratch — enrolment, storage, verification and recovery. I want the algorithm itself, not "use a library": what exactly is computed on the phone and on the server?',
      whatInterviewerLooksFor: [
        'Exact TOTP steps: floor(t/30), 8-byte counter, HMAC-SHA1, dynamic truncation, mod 10^6',
        'Secret stored encrypted (not hashed) and why',
        'Window, single-use (replay) and rate limiting with numbers',
        'Enrolment confirmation and recovery path design',
      ],
      modelAnswer: `**Enrolment**
1. Generate a 20-byte secret with a CSPRNG, base32-encode it, render \`otpauth://totp/Acme:{email}?secret=..&issuer=Acme&period=30&digits=6\` as a QR.
2. Store the secret **envelope-encrypted** (KMS data key) with status \`pending\`. It can't be hashed: the server must recompute HMACs.
3. Activate only after the user submits one valid code. Generate 10 recovery codes, store argon2 hashes, show once.

**Algorithm (same on phone and server)**
- \`T = floor(unixSeconds / 30)\`
- \`msg = T\` as 8-byte big-endian
- \`HS = HMAC-SHA1(secret, msg)\` (20 bytes)
- \`offset = HS[19] & 0x0F\`; \`bin = (HS[offset] & 0x7F)<<24 | HS[offset+1]<<16 | HS[offset+2]<<8 | HS[offset+3]\`
- \`code = bin mod 10^6\`, zero-padded
- I'd unit-test it against RFC 6238 Appendix B: secret "12345678901234567890", t = 59 → 94287082 (8 digits).

**Verification**
- Compute for T-1, T, T+1 (±30 s drift, RFC 6238's recommended maximum backward step), constant-time compare.
- **Single use:** persist the last accepted step per user with an atomic compare-and-set; reject steps ≤ it. NIST 800-63B-4 requires accepting an OTP only once.
- **Rate limit:** 5 failures → 15 min lockout or exponential backoff, plus global anomaly alerts. Odds per guess: 3/10^6.
- The MFA step is bound to a half-authenticated session created after the password check, which expires in 5 minutes.

**Recovery**
- Recovery codes (single-use, conditional UPDATE), a second factor (passkey), and a support reset with identity proofing and a 24–72 h cooling-off + notification to all channels. Resetting MFA must trigger session revocation.

**Server time** must be NTP-synced; log the matched offset (−1/0/+1) per user to spot drifting phones.`,
      followUps: [
        {
          q: 'A user\'s phone is consistently 50 seconds slow. What happens and what do you do?',
          a: 'The phone computes T−2 for part of each 30 s period, so codes fail intermittently (only the slices that fall in T−1 work). Options: record a per-user drift offset at enrolment or after a successful "resync" (user enters two consecutive codes) and centre the window on it, as RFC 6238 §6 suggests, rather than widening the window for everyone. Also tell them to enable automatic time.',
        },
        {
          q: 'Why is HMAC-SHA1 acceptable in 2026 when SHA-1 is broken?',
          a: 'SHA-1 collision attacks don\'t break HMAC: HMAC security depends on the compression function behaving like a PRF, and no practical attack exists on HMAC-SHA1. The real weakness is the 6-digit output (10^6), which rate limiting handles. SHA-256 variants exist, but many authenticator apps ignore the algorithm parameter, so SHA-1 stays the interoperable default.',
        },
      ],
      pitfalls: [
        'Hashing the TOTP secret like a password',
        'Using a wide window "to be safe" without rate limiting',
        'No replay protection, so a phished code works for 90 s',
        'Recovery via email link that bypasses MFA entirely',
      ],
    },
    {
      id: 'api-auth-sso-iq-05',
      difficulty: 'expert',
      context: 'A UPI/wallet-style payments app in India. Login = phone number + SMS OTP; 2FA for high-value transfers = another SMS OTP.',
      question:
        'We lost ₹2.3 crore last quarter to account takeovers. Fraud analysis shows 70% were SIM swaps and 25% were users reading an OTP to a "bank official" on the phone. Redesign our authentication so neither attack works, without destroying conversion for 80 million users on mid-range Android phones.',
      whatInterviewerLooksFor: [
        'Explains why SMS OTP fails to both attacks and why TOTP does not fix social engineering',
        'Device binding / passkeys as phishing-resistant possession factors',
        'Risk-based step-up and SIM-change signals rather than one global policy',
        'A safe recovery path, since attackers will move there next',
      ],
      modelAnswer: `**Why today fails:** SMS proves control of a *phone number*, not a device. SIM swap transfers the number; voice-phishing makes the user a relay. NIST 800-63B-4 classifies PSTN OTP as restricted for exactly this reason. TOTP would stop SIM swap but not the phone scam (user can read a TOTP code too).

**Redesign: bind identity to the device, not the number**
1. **Device binding at registration:** the app generates a non-exportable key in Android Keystore (StrongBox/TEE where available) and registers the public key, plus Play Integrity attestation. SMS OTP is used *once* here — with SIM-change checks from the carrier/API and a silent SMS-from-device verification, which is common practice for Indian payment apps.
2. **Login & payments:** the server sends a challenge; the app signs it with the device key after local biometric/PIN unlock. Nothing human-readable to read out on a call — kills the vishing relay. A new SIM in the same phone doesn't help an attacker who lacks the phone.
3. **Passkeys** (WebAuthn) for the web dashboard: origin-bound, phishing-resistant; syncable passkeys are acceptable at AAL2.
4. **Risk engine:** step-up when signals spike — SIM changed in last 72 h, new device, new payee, amount > user's p95, unusual geo. High-risk + new device → cooling-off (e.g. 24 h low limits) rather than a hard block.

**Recovery (where attackers go next):** a new device enrolment requires old-device approval *or* video-KYC/Aadhaar-based re-verification + 24 h limit window + notifications on every channel. Never "SMS OTP only" to re-bind.

**Conversion:** device-bound auth is *fewer* steps than OTP (biometric tap). Expect friction only at device change (~2–5% of users/month). Roll out by cohort, measure ATO rate and login success.`,
      followUps: [
        {
          q: 'What if the attacker convinces the user to install a remote-access app (AnyDesk) and then approves on the real device?',
          a: 'Device binding can\'t stop a fully remote-controlled genuine device. Add on-device defences: detect screen sharing/accessibility-service abuse and block payment screens while active (FLAG_SECURE, checks for active remote-control apps), show in-app warnings, and use the risk engine (new payee + high amount + recent remote-access signal → hold for 4–24 h).',
        },
        {
          q: 'Regulators still expect an OTP as an additional factor for some flows. How do you reconcile that?',
          a: 'Treat SMS OTP as one signal layered on the device-bound factor, not as the sole possession proof: device signature + OTP satisfies the two-factor requirement while the OTP alone can no longer authorise anything. RBI\'s Authentication Mechanisms for Digital Payment Transactions Directions (Sept 2025, in force 1 April 2026) keep 2FA mandatory but explicitly allow factors beyond SMS OTP, require at least one dynamic factor, and permit risk-based extra checks.',
        },
      ],
      pitfalls: [
        'Replacing SMS with TOTP and claiming phishing is solved',
        'Forgetting the account-recovery path',
        'One-size policy that adds friction to every login',
      ],
    },
    {
      id: 'api-auth-sso-iq-06',
      difficulty: 'hard',
      question:
        'We are opening a public payouts API to 500 partner companies (lenders, marketplaces). Product suggests "just give them API keys". Choose the authentication scheme, justify it against the alternatives, and describe the key lifecycle.',
      whatInterviewerLooksFor: [
        'Separates partner identity (who) from request integrity and replay (proof of possession)',
        'Compares API key, OAuth client credentials, mTLS and HMAC signing with concrete trade-offs',
        'Covers issuance, storage, scoping, rotation, leak response',
        'Thinks about money movement: idempotency, IP allow-lists, audit',
      ],
      modelAnswer: `**Threat model:** payouts move money, partners integrate with varied maturity, and secrets *will* leak (logs, Git, contractors). A static bearer key alone means anyone who sees one header can send payouts until someone notices.

**Options**
| Scheme | Pros | Cons |
|---|---|---|
| API key only | Simplest DX | Static bearer secret, replayable, long-lived |
| OAuth2 client credentials | Short-lived tokens (15 min), scopes, standard | Client secret is still a static secret; token is bearer |
| mTLS (+ RFC 8705 bound tokens) | Private key never leaves partner; strong | Cert ops pain for small partners; terminates at our LB |
| HMAC request signing | Secret never on the wire, per-request integrity, replay window | Canonicalisation bugs; we must store the secret recoverably (KMS) |

**Choice:** tiered.
- **Identity + quota:** a key ID (public) per partner environment.
- **Request integrity:** HMAC-SHA256 SigV4-style signing over method, path, sorted query, \`x-timestamp\`, \`idempotency-key\` and SHA-256 of the raw body; ±5 min window; signature cached in Redis for 10 min to block replay. Large partners may choose **mTLS + client-credentials** instead (private_key_jwt client auth avoids shared secrets entirely).
- **Plus:** IP allow-list per partner (optional), idempotency keys mandatory on POST /payouts, per-partner limits (amount/day).

**Lifecycle**
- Issue in the dashboard behind MFA; show secret once; store KMS-encrypted (signing) — for pure API keys a hash would suffice.
- Prefix (\`pz_live_\`) for GitHub secret-scanning partnership → auto-revoke on leak report.
- Two active secrets per partner; rotate with overlap; dashboard shows \`last_used_at\` per secret.
- Scoped keys: \`payouts:create\` vs \`payouts:read\`; sandbox keys can never touch live.
- Every signed request logged with key ID, not the signature material.`,
      followUps: [
        {
          q: 'A partner reports "signature mismatch" on 3% of requests only when the amount has decimals. Likely cause?',
          a: 'They sign one serialisation and send another — typically signing a JSON string built by hand and then letting the HTTP client re-serialise (e.g. 100.50 → 100.5), or our server hashes `JSON.stringify(req.body)` after parsing instead of the raw bytes. Fix: both sides hash exactly the bytes on the wire; publish a reference SDK and a signature-debug endpoint that returns our canonical request (never the expected signature).',
        },
        {
          q: 'Why not let partners use asymmetric signatures instead of HMAC?',
          a: 'That is better when you can: partner holds an Ed25519/ECDSA private key, we store only the public key, so our DB leak cannot forge requests and non-repudiation improves. Cost: partners must manage key pairs and some languages\' tooling is clunkier. A common compromise: HMAC by default, `private_key_jwt` or RFC 9421 signatures with public keys for regulated partners.',
        },
      ],
      pitfalls: [
        'Treating "HTTPS" as sufficient protection for a static key',
        'Hashing an HMAC signing secret (you cannot verify signatures with a hash)',
        'No rotation plan or overlap window',
      ],
    },
    {
      id: 'api-auth-sso-iq-07',
      difficulty: 'expert',
      question:
        'After we put CloudFront and an Envoy sidecar in front of our HMAC-signed API, 1.8% of requests fail signature verification and the failures are concentrated on a few clients. How do you debug this, and how should the signing scheme have been specified to avoid it?',
      whatInterviewerLooksFor: [
        'Understands canonicalisation and which intermediaries mutate requests',
        'Systematic debugging: log server canonical request, compare with client',
        'Knows raw-body hashing, signed-header selection, encoding rules',
        'Mentions RFC 9421 / SigV4 as specified schemes',
      ],
      modelAnswer: `**Hypothesis space** — something between client and verifier changes the bytes or metadata that are signed:
- **Query string:** CDN normalises or reorders params, decodes \`%2F\`/\`+\` vs \`%20\`; clients with params like \`q=a+b\` fail.
- **Headers:** proxy adds/rewrites \`host\` (origin host header), \`content-type\` (charset appended), \`content-encoding\` (gzip at the edge), lowercases or merges duplicate headers.
- **Body:** edge compresses/decompresses; our Nest app hashes the *parsed* JSON (\`JSON.stringify(req.body)\`), which differs from the wire bytes for clients that send spaces or unusual number formats.
- **Path:** trailing-slash or double-slash normalisation, case changes.
- **Time:** clients with skew > window after the extra hop's latency.

**Debugging steps**
1. Group failures by client SDK/version, method, presence of query params, content-encoding — "concentrated on a few clients" suggests their specific encoding.
2. In a debug mode, log the server's **canonical request** and its SHA-256 (never the secret or expected signature) and ask the client for theirs; diff them.
3. Capture the request at each hop (CloudFront log, Envoy access log with headers) to find the mutating layer.

**How it should have been specified**
- Hash the **raw body bytes** (capture before parsing; Nest \`rawBody: true\`).
- Precise canonicalisation rules: RFC 3986 percent-encoding, params sorted by encoded name then value, path not normalised, header values trimmed with internal whitespace collapsed.
- Client sends an explicit **SignedHeaders** list; never sign headers proxies own (\`via\`, \`x-forwarded-*\`), always sign \`host\` as the client saw it — and configure the CDN to forward the original Host.
- Version the scheme (\`ACME1-HMAC-SHA256\`) so you can fix rules without breaking clients.
- Or adopt **RFC 9421 HTTP Message Signatures**, which specifies components (\`@method\`, \`@path\`, \`@query\`, \`content-digest\`) precisely.`,
      followUps: [
        {
          q: 'Could you just verify the signature at CloudFront/Envoy instead, before anything mutates the request?',
          a: 'Verifying at the first hop that sees original bytes (an edge function or Envoy ext_authz on the ingress) avoids mutation issues, but then everything after it trusts a header saying "verified". You need that internal hop protected (mTLS, stripped client headers), and the edge needs access to secrets — extra blast radius. Many teams verify at the gateway and pass a signed internal identity.',
        },
        {
          q: 'How do you roll out a fixed canonicalisation without breaking existing clients?',
          a: 'Introduce scheme v2 in the Authorization prefix; the server accepts both v1 and v2 for a deprecation window, emits metrics per partner on v1 usage, ships SDK updates, and turns v1 off per partner once their traffic is 100% v2.',
        },
      ],
      pitfalls: [
        'Widening the time window or disabling verification for affected clients',
        'Hashing parsed JSON',
        'Logging the expected signature (turns logs into an oracle)',
      ],
    },
    {
      id: 'api-auth-sso-iq-08',
      difficulty: 'hard',
      question:
        'A staff engineer proposes replacing all JWTs in our platform with PASETO v4 "because JWT is insecure". We use Okta for workforce login and Auth0 for customers, and our gateway signs internal tokens for 60 microservices. What do you support, what do you push back on?',
      whatInterviewerLooksFor: [
        'Precise statement of JWT\'s actual weaknesses (algorithm agility, header-supplied keys) vs misuse',
        'PASETO versions/purposes and what it does and does not solve',
        'Ecosystem constraints: OIDC mandates JWT',
        'A scoped, incremental recommendation',
      ],
      modelAnswer: `**What is true:** JWT's design lets the token pick its algorithm and even its key (\`alg\`, \`jwk\`, \`jku\`, \`kid\`), which produced real bugs: \`alg: none\`, RS256→HS256 confusion, embedded-key acceptance. RFC 8725 mitigations exist, but they depend on every service configuring them correctly. PASETO makes \`v4.public\` *always* Ed25519 and \`v4.local\` *always* XChaCha20 + BLAKE2b-MAC, adds authenticated footers and implicit assertions, and uses PAE to prevent concatenation ambiguities.

**What is not true / not solved:**
- PASETO does not fix revocation, lifetime, audience mistakes or storing tokens in localStorage — still value tokens.
- **OIDC and both IdPs issue JWTs** (ID tokens, access tokens). We can't replace those; clients and the gateway must keep validating JWT correctly.
- Library/ecosystem maturity: API gateways, service meshes, observability tools decode JWT natively; PASETO support is thin.

**Recommendation**
1. **External tokens (Okta/Auth0):** keep JWT, centralise validation in the gateway with a single hardened config (\`jose\`, algorithms pinned, \`aud\`/\`iss\`, JWKS caching). Ban direct JWT parsing in services via lint rule.
2. **Internal gateway → service tokens:** a reasonable PASETO candidate — we mint and verify both ends. Use \`v4.public\` (Ed25519) so services only hold public keys, \`kid\` in the footer, \`aud\` per service, and the tenant as an **implicit assertion**. Pilot on 3 services; measure verify cost (Ed25519 verify ≈ 50–100 µs, comparable to ES256).
3. If FIPS is required for some customers, use v3 (P-384) instead of v4.

Net: we gain removal of a bug class on the internal path; we don't pretend it fixes external auth.`,
      followUps: [
        {
          q: 'Should internal tokens be v4.local instead, since services are trusted?',
          a: 'local means a shared symmetric key across 60 services: any one compromised service can mint tokens for all others. Use local only when the same party mints and verifies (e.g. the gateway encrypting a cookie or a signed link to itself) and confidentiality of claims matters. For multi-verifier fan-out, public (asymmetric) is the right purpose.',
        },
        {
          q: 'What goes in the footer and what must never go there?',
          a: 'The footer is base64url plaintext that is authenticated but not encrypted — even for local tokens. Put the key ID and maybe a token-type marker there to select keys before verifying. Never put PII, secrets or authorisation-relevant claims that you would read before verification; claims belong in the payload.',
        },
      ],
      pitfalls: [
        'Claiming PASETO solves revocation',
        'Proposing to replace IdP-issued OIDC tokens',
        'Choosing v4.local for many verifiers',
      ],
    },
    {
      id: 'api-auth-sso-iq-09',
      difficulty: 'hard',
      question:
        'Users complain: "I clicked Logout in the employee portal, but Expense and Wiki still show me logged in, and when I go back to the portal it logs me straight back in." Explain why, and design logout that actually works across our 9 apps.',
      whatInterviewerLooksFor: [
        'Three layers of session: IdP, per-app, tokens',
        'Why local logout re-logs in silently via the IdP cookie',
        'RP-initiated + back-channel logout design and the sid index',
        'Realistic limits: already-issued JWTs, third-party cookie blocking',
      ],
      modelAnswer: `**Why it happens:** the portal deleted only *its own* session cookie. The IdP session cookie is still valid, so the portal's next redirect to the IdP is silently satisfied → logged back in. Expense and Wiki have their own independent sessions, which nobody told to end.

**Design**
1. **Portal logout = RP-initiated logout:** delete local session, then redirect to the IdP \`end_session_endpoint\` with \`id_token_hint\` and \`post_logout_redirect_uri\`. The IdP terminates its session and clears \`idp_sid\`.
2. **IdP fans out back-channel logout:** for every RP that received a login during this IdP session, it POSTs a signed logout token (\`sid\`, \`sub\`, \`events\`, \`jti\`, no \`nonce\`) server-to-server. Requires each app to register a \`backchannel_logout_uri\`.
3. **Apps index sessions by IdP sid at login:** \`idp-sid:{sid} → {local session ids}\`; the logout handler validates the token (signature, iss, aud, iat freshness, jti once) and deletes them. Works with 9 apps or 90 and survives third-party-cookie blocking (front-channel iframes don't).
4. **Tokens already issued:** access tokens (JWT) remain valid until \`exp\` — keep them ≤ 10 min; revoke refresh tokens in the same handler; for high-risk APIs check a session-active flag.
5. **SAML apps** (if any): IdP sends LogoutRequest via SOAP back channel where supported; otherwise rely on short app sessions.

**Lifetimes to quote:** IdP session 8–10 h absolute / 1 h idle (NIST AAL2 guidance: ≤ 24 h overall, ≤ 1 h inactivity), app sessions ≤ IdP session, access tokens 5–10 min.

**Monitoring:** logout-token delivery failures per RP (retry with backoff for a few minutes; the token's freshness limit bounds retries).`,
      followUps: [
        {
          q: 'One app is a legacy SAML SP that ignores logout. What can you do?',
          a: 'Shorten its session (e.g. 1 h idle, 8 h absolute) and set the IdP to send `SessionNotOnOrAfter` in the AuthnStatement, which compliant SPs honour as a hard session cap. Put it behind an auth proxy (oauth2-proxy / gateway) that owns the session and does understand back-channel logout, so the legacy app never manages login itself.',
        },
        {
          q: 'Should "Logout" on a shared kiosk behave differently from a personal laptop?',
          a: 'Yes: on a kiosk, logout must end the IdP session (global logout) and clear all cookies; on a personal device, users often expect "log out of this app" without killing every other app. Offer both explicitly, and default to global for workforce apps where the security risk of lingering sessions outweighs the minor inconvenience.',
        },
      ],
      pitfalls: [
        'Thinking deleting the app cookie is logout',
        'Relying on front-channel iframes in 2026 browsers',
        'Forgetting outstanding access tokens',
      ],
    },
    {
      id: 'api-auth-sso-iq-10',
      difficulty: 'expert',
      question:
        'A user\'s access token reaches the API gateway, then orders-svc calls payments-svc, which calls ledger-svc. Today every hop forwards the original token unchanged. Security calls this a confused-deputy risk. Redesign identity propagation.',
      whatInterviewerLooksFor: [
        'Explains why forwarding the same broad token is risky (audience, scope, replay by any compromised hop)',
        'RFC 8693 token exchange with audience narrowing and act claim',
        'Workload identity (mTLS/SPIFFE) for the caller, separate from the user',
        'Latency/caching considerations and failure modes',
      ],
      modelAnswer: `**The risk:** the forwarded token has \`aud\` = gateway/API and broad scopes; every service that sees it can replay it anywhere that accepts it. A compromised or buggy orders-svc can call ledger directly with the user's full authority, and ledger cannot tell whether payments (legitimately) or orders (not allowed) is calling — the confused deputy.

**Redesign**
1. **Workload identity on every hop:** mTLS via mesh with SPIFFE IDs; ledger's policy says only \`spiffe://acme/payments\` may call \`POST /entries\`. This answers "which service".
2. **User context via token exchange (RFC 8693):** payments calls the STS with \`subject_token\` (the incoming token), \`actor_token\` (its own workload credential), \`audience=ledger\`, and \`scope=ledger:write\`. The STS applies policy (may payments act for users towards ledger?) and returns a 60 s JWT/PASETO with \`aud=ledger\`, narrowed scopes, \`sub=user\`, and \`act: {sub: payments}\` (nested for longer chains).
3. **Ledger validates** \`aud\` = itself, \`act.sub\` = the mTLS peer identity (binding the token to the caller), then checks object-level authorisation for the user.

**Cost & caching:** each exchange is an extra hop (~2–5 ms in-region); cache exchanged tokens per (subject jti, audience) for most of their lifetime. For very hot paths, the gateway can pre-mint a per-request internal token with a list of audiences, trading precision for latency.

**Failure modes:** STS down → fail closed for writes; keep the STS horizontally scaled and stateless (keys from KMS). Audit logs record the full act chain, which also gives you "who did what on behalf of whom".`,
      followUps: [
        {
          q: 'What about asynchronous work — orders-svc publishes to Kafka and a consumer acts for the user 10 minutes later?',
          a: 'Don\'t put a bearer token on the event; it would be expired or, worse, long-lived in the log. Put the user ID and a signed, minimal authorisation context (who, what, when, initiating service) in the event, and let the consumer act under its own workload identity with policies like "consumer X may post ledger entries for orders created by user U". If user-level authority is essential, the consumer exchanges its workload credential plus the event context at the STS.',
        },
        {
          q: 'Isn\'t mTLS alone enough? Why carry the user at all?',
          a: 'mTLS proves which service is calling, not on whose behalf. Without the user, ledger must trust payments to have done all authorisation correctly — every service becomes a super-user for every customer. Carrying a verifiable user context lets each service enforce object-level checks (BOLA) and produces a trustworthy audit trail.',
        },
      ],
      pitfalls: [
        'Passing user ID in a plain header that any service can set',
        'Exchanging tokens without narrowing audience or scope',
        'Long-lived service tokens with admin scopes',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'api-auth-sso-boe-1',
      question:
        'A shopping app with 40M monthly users is debating Redis-backed sessions vs self-contained tokens. Estimate the Redis memory, peak lookup QPS and the CPU cost of the alternative (ES256 verification on every request).',
      assumptions: [
        '40M MAU, 12M daily actives, average 1.5 devices → ~18M live sessions (30-day remember-me keeps them alive)',
        'Session record ~300 bytes of data + ~100 bytes Redis key/overhead ≈ 400 bytes',
        'Each DAU makes 150 authenticated API calls/day; peak = 4× average',
        'ES256 verify ≈ 80 µs of one core in Node (jose / OpenSSL); Redis GET ≈ 0.5 ms round trip, ~150K ops/s per shard comfortably',
      ],
      steps: [
        { label: 'Session memory', calc: '18M × 400 B ≈ 7.2 GB; ×2 for replicas ≈ 14.4 GB total' },
        { label: 'Average request rate', calc: '12M × 150 ÷ 86,400 ≈ 20.8K req/s' },
        { label: 'Peak request rate', calc: '20.8K × 4 ≈ 83K lookups/s' },
        { label: 'Redis shards needed', calc: '83K ÷ 150K per shard → 1 primary is enough for throughput; 3 primaries for memory headroom and blast radius' },
        { label: 'Token alternative CPU', calc: '83K × 80 µs ≈ 6.6 core-seconds per second ≈ 7 cores fleet-wide' },
        { label: 'Bandwidth delta', calc: 'JWT ~900 B vs cookie ~60 B → 840 B × 83K ≈ 70 MB/s ≈ 560 Mbit/s more ingress at peak' },
      ],
      answer:
        'Sessions need ~15 GB of replicated Redis and ~83K GETs/s at peak — a small 3-shard cluster. Tokens instead cost ~7 cores of verification and ~560 Mbit/s of extra header bytes, and give up instant revocation.',
      insight:
        'At this scale neither option is expensive, so "sessions don\'t scale" is not a valid argument. Decide on revocation needs and client types: sessions (or a BFF) for the web app, short-lived tokens for mobile and service-to-service.',
      followUps: [
        {
          q: 'Marketing launches a sale and peak becomes 15× average instead of 4×. What breaks first?',
          a: '15 × 20.8K ≈ 312K lookups/s. A single Redis primary saturates (~150–200K simple ops/s), so you need the 3 shards actually serving traffic — ensure the client uses cluster mode and keys spread evenly (random session IDs do). Token verification would need ~25 cores, which autoscaling absorbs more easily. Also check the sliding-expiry writes: if every request does EXPIRE, writes also hit 312K/s — throttle touches to once per minute.',
        },
        {
          q: 'Legal wants all sessions to expire after 7 days instead of 30. How do the numbers change?',
          a: 'Live sessions shrink to devices used in the last 7 days — if ~60% of the 18M were active that week, ~11M sessions → ~4.4 GB, ~9 GB replicated. QPS is unchanged because it is driven by activity, not by session count. Expect more logins (IdP load) from users returning after 7 days.',
        },
      ],
    },
    {
      id: 'api-auth-sso-boe-2',
      question:
        'An attacker has the passwords of 50,000 users from a breach and targets our TOTP step. Estimate how many accounts they can take over in a week under (a) no rate limiting with a ±1-step window, (b) 5 failures per 15 minutes per account, and (c) a ±10-step window with the same limit.',
      assumptions: [
        '6-digit codes: 10^6 possibilities; a guess succeeds if it equals any accepted code in the window',
        '±1 step → 3 acceptable codes per guess; ±10 steps → 21',
        'Unlimited case: attacker can try 100 guesses/s per account (bottlenecked by our API)',
        'Limited case: 5 guesses per 15-min window per account → 480 guesses/day → 3,360 per week',
      ],
      steps: [
        { label: '(a) Guesses per account per week', calc: '100/s × 604,800 s ≈ 6×10^7 ≫ 10^6 → essentially certain compromise, in ~10^6 ÷ 3 ÷ 100 ≈ 55 min per account' },
        { label: '(b) Success probability per account', calc: '3,360 guesses × 3 ÷ 10^6 ≈ 1.0%' },
        { label: '(b) Accounts lost', calc: '50,000 × 1.0% ≈ 500 accounts per week' },
        { label: '(c) Success probability with ±10', calc: '3,360 × 21 ÷ 10^6 ≈ 7.1% → ~3,500 accounts' },
        { label: '(b′) Add exponential backoff + lock after 20 total failures', calc: '20 × 3 ÷ 10^6 = 0.006% → ~3 accounts' },
      ],
      answer:
        'Without rate limiting every account falls within an hour. 5 tries per 15 minutes still leaks ~500 accounts a week at ±1 step, and ~3,500 at ±10 steps. A cumulative lockout (e.g. 20 failures → MFA locked, user notified) brings it to single digits.',
      insight:
        'A 6-digit OTP is only as strong as the attempt budget × window size. Rate limits must be cumulative (not just per-window), the window kept at ±1 step, and a burst of second-factor failures is itself a signal that the password is compromised — force a reset.',
      followUps: [
        {
          q: 'Product asks for 8-digit codes instead of a stricter lockout. How much does that buy?',
          a: 'It divides success probability by 100: case (b) drops from ~1% to ~0.01% → ~5 accounts per week. But most authenticator apps assume 6 digits from the otpauth URI and some ignore `digits=8`, so you risk support tickets. A cumulative lockout gives similar protection with no client compatibility risk.',
        },
        {
          q: 'The attacker spreads attempts from 10,000 residential IPs. Does per-IP limiting change your estimate?',
          a: 'No — the estimate already used a per-account limit, which IP rotation cannot evade. Per-IP limits only help against attackers who concentrate traffic. What changes is detection: a global spike in second-factor failures across thousands of accounts with valid passwords is a strong credential-breach signal; trigger forced password resets for affected users.',
        },
      ],
    },
    {
      id: 'api-auth-sso-boe-3',
      question:
        'A 150,000-employee company moves 14 internal apps behind one OIDC IdP. Estimate peak authorization and token-endpoint load during the 9:00–9:30 IST login wave, and the signing CPU required.',
      assumptions: [
        '80% of employees start work in the 30-minute wave → 120K users',
        'Each user opens 6 apps in the first hour, 4 of them inside the wave; app sessions last 10 h, so no renewals in the wave',
        'Each app login = 1 /authorize (session check) + 1 /token call; first app also triggers a password + MFA login',
        'Peak-to-average within the wave = 3×; RS256 sign ≈ 1 ms core time (2048-bit), ES256 sign ≈ 0.05 ms',
        'Each token response signs 2 JWTs (ID token + access token)',
      ],
      steps: [
        { label: 'App logins in the wave', calc: '120K × 4 = 480K logins in 1,800 s ≈ 267/s; peak ×3 ≈ 800/s' },
        { label: 'IdP endpoint calls', calc: '/authorize 800/s + /token 800/s ≈ 1,600 req/s; full password+MFA logins ≈ 120K/1,800 × 3 ≈ 200/s' },
        { label: 'Password hashing', calc: '200/s × argon2id ~50 ms core ≈ 10 cores' },
        { label: 'Token signing RS256', calc: '800/s × 2 × 1 ms ≈ 1.6 cores; ES256 ≈ 0.08 cores' },
        { label: 'IdP session store', calc: '120K sessions × 1 KB ≈ 120 MB; ~1,600 lookups/s — trivial' },
      ],
      answer:
        'Roughly 1,600 IdP requests/s at peak, dominated in CPU by password hashing (~10 cores) rather than token signing (~1.6 cores with RS256). Session storage is ~120 MB.',
      insight:
        'SSO shifts load from 14 login pages to one IdP, but the expensive part is the first-factor check, not SSO hops. Size the IdP for the password+MFA burst, keep argon2 parameters tuned for that concurrency, and use ES256/EdDSA if token signing ever matters.',
      followUps: [
        {
          q: 'The IdP is down for 20 minutes at 9:10. Who is affected and how do you reduce the impact next time?',
          a: 'Anyone without a live app session: all first logins of the day and every app not yet opened — roughly 60–70% of the wave. Users already in an app keep working until their app session or access token expires. Mitigations: multi-AZ/multi-region IdP, longer app sessions for low-risk apps, refresh tokens that are validated locally for a grace period, and status-page messaging. Never let apps fall back to local passwords.',
        },
        {
          q: 'Security mandates passkeys instead of passwords. What happens to the 10-core estimate?',
          a: 'The argon2id cost disappears: WebAuthn verification is one ECDSA P-256 (or Ed25519) signature check, ~0.1 ms, so 200/s needs ~0.02 cores. The bottleneck moves to IdP request handling and session I/O, and the burst becomes cheap enough that the IdP can be sized for availability rather than CPU.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'api-auth-sso-mcq-01',
      difficulty: 'hard',
      question:
        'This guard verifies HMAC-signed partner requests. Signatures from a Java partner fail intermittently, while those from your own Node SDK always pass. What is the most likely cause?',
      code: {
        language: 'typescript',
        code: `@Post('payouts')
async create(@Body() body: PayoutDto, @Headers('x-signature') sig: string,
             @Headers('x-timestamp') ts: string) {
  const expected = createHmac('sha256', secretFor(body.partnerId))
    .update(ts + '.' + JSON.stringify(body))
    .digest('hex');
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) throw new UnauthorizedException();
  return this.payouts.create(body);
}`,
      },
      options: [
        'The server hashes a re-serialisation of the parsed body, which differs from the bytes the Java client signed (key order, whitespace, number formatting)',
        'timingSafeEqual throws when the two hex strings are different lengths, which happens for Java clients that use uppercase hex',
        'The timestamp header is in seconds from Java but milliseconds from Node, so the HMAC input differs',
        'secretFor() is looked up from the body before verification, so a forged partnerId selects the wrong secret',
      ],
      correct: [0],
      explanation:
        'Signatures must be computed over the exact bytes on the wire; JSON.stringify of a parsed DTO only coincidentally matches what Node clients produce (same serialiser), while Jackson may order keys differently or print 100.50 vs 100.5. Uppercase hex has the same length, so it would fail every time rather than intermittently. A seconds/ms mismatch would also fail consistently. Selecting the secret by an unverified partnerId is a real smell, but forging it only makes verification fail — it does not explain intermittent failures for a legitimate partner.',
      followUps: [
        {
          q: 'How do you get the raw bytes in NestJS without breaking DTO validation?',
          a: 'Create the app with `NestFactory.create(AppModule, { rawBody: true })`; Nest keeps the parsed body for pipes and exposes `req.rawBody` (a Buffer) for the guard. Hash `rawBody` in a guard that runs before validation, and reject requests where rawBody is missing rather than falling back to the parsed object.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-02',
      difficulty: 'medium',
      question:
        'Your TOTP implementation passes most manual tests, but about 1 in 10 users report "invalid code" every few minutes even with perfect clocks. Which bug in this generator explains it?',
      code: {
        language: 'typescript',
        code: `function totp(secret: Buffer, unix: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(unix / 30)));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[19] & 0x0f;
  const bin = h.readUInt32BE(o) & 0x7fffffff;
  return String(bin % 1_000_000);
}`,
      },
      options: [
        'Reading 4 bytes at offset o can run past the end of the 20-byte HMAC',
        'Codes with a leading zero lose it, so the 6-digit string never matches what the app shows',
        'Masking with 0x7fffffff changes the code compared to authenticator apps',
        'Using floor instead of round puts the server half a step behind the phone',
      ],
      correct: [1],
      explanation:
        'About 10% of codes are below 100000; String() drops the leading zero, so "042917" is generated as "42917" and never matches the user\'s input. The maximum offset is 15, and 15 + 4 = 19 ≤ 20 bytes, so there is no overrun. The 31-bit mask is required by RFC 4226; it is what the apps do. floor(t/30) is exactly RFC 6238; round would be the bug.',
      followUps: [
        {
          q: 'What test would have caught this before release?',
          a: 'Run RFC 6238 Appendix B vectors: at t = 1111111109 the 8-digit code is 07081804, which starts with zero. Add a property test over 10,000 random counters asserting `code.length === 6` and comparing against a reference implementation, plus a test with the RFC 4226 HOTP table (counter 0..9).',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-03',
      difficulty: 'expert',
      question:
        'The orders API verifies tokens issued by your RS256 IdP with the code below (an older library version that picks the algorithm from the token header). What can an attacker who knows only public information do?',
      code: {
        language: 'typescript',
        code: `const PUBLIC_PEM = await fetchIdpPublicKeyPem(); // published at a well-known URL
export function auth(token: string) {
  return jwt.verify(token, PUBLIC_PEM); // no options
}`,
      },
      options: [
        'Nothing; without the IdP private key no valid signature can be produced',
        'Replay any expired token, because exp is not checked when no options are passed',
        'Forge any token by setting alg to HS256 and computing an HMAC with the PEM text as the secret',
        'Downgrade to RS1 (SHA-1) and find a collision for an existing token signature',
      ],
      correct: [2],
      explanation:
        'With header-driven algorithm selection, the verifier will use the supplied key material as an HMAC secret when the header says HS256. The public key is public, so the attacker can mint arbitrary claims — the classic RS→HS algorithm-confusion attack (RFC 8725 §2.1). jsonwebtoken does check exp by default, so expired-token replay is not the issue. There is no practical SHA-1 collision path against an RS256 signature, and "nothing" ignores the confusion attack. Fix: pass `algorithms: [\'RS256\']` or use a library such as jose with typed keys, or a format like PASETO where the version fixes the algorithm.',
      followUps: [
        {
          q: 'You pinned algorithms. What else in the JWT header must you refuse to trust?',
          a: 'Any header that supplies key material or locations: `jwk` (embedded key), `jku` and `x5u` (URLs to fetch keys from), and `x5c` unless you validate the chain to a pinned root. Treat `kid` only as a lookup key into your own JWKS — never as a file path or SQL fragment. Also check `typ` when one key signs several token types, to stop cross-JWT confusion.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-04',
      difficulty: 'hard',
      question:
        'After launching a developer platform, p99 latency on every API call rises to 1.4 s and CPU on the auth service is pegged. What is the root cause in this API-key check?',
      code: {
        language: 'typescript',
        code: `async function findClient(presented: string) {
  const { rows } = await db.query('SELECT client_id, key_hash FROM api_keys WHERE revoked = false');
  for (const r of rows) {                         // 25,000 active keys
    if (await bcrypt.compare(presented, r.key_hash)) return r.client_id;
  }
  return null;
}`,
      },
      options: [
        'bcrypt.compare is not constant-time, so attackers can time the loop',
        'The query lacks LIMIT 1, so Postgres transfers too many rows per call',
        'bcrypt silently truncates keys beyond 72 bytes, so many keys collide and the loop never exits early',
        'Without a key ID to look up one row, each request runs up to 25,000 deliberately slow bcrypt comparisons',
      ],
      correct: [3],
      explanation:
        'bcrypt is designed to cost ~50–100 ms per comparison; with no key ID the code must try every row, so a request can need thousands of comparisons. Embed a lookup handle (key ID or prefix) in the key, fetch one row by index, and use a fast hash (SHA-256/HMAC) because the secret is high-entropy. The 72-byte truncation is a real bcrypt limit but does not cause the latency. Row transfer matters a little, but CPU is pegged by hashing, and LIMIT 1 would break the logic. bcrypt.compare timing is not the problem here.',
      followUps: [
        {
          q: 'Why is SHA-256 acceptable for API keys when it is unacceptable for passwords?',
          a: 'Passwords have low entropy, so a fast hash lets an attacker with the DB test billions of dictionary guesses per second; a slow hash raises that cost. A 32-byte random key has 2^256 possibilities — no dictionary exists, and even 10^12 guesses/s gets nowhere. So the slow hash buys nothing and costs latency. Add an HMAC pepper from KMS if you want a DB-only leak to be useless even for confirming a leaked key.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-05',
      difficulty: 'expert',
      question:
        'A SAML ACS handler verifies the XML signature with a vetted library and then reads the user like this. A pentester logs in as admin@acme.com using their own valid account. How?',
      code: {
        language: 'typescript',
        code: `const doc = parseXml(samlResponseXml);
if (!verifyXmlSignature(doc, idpCert)) throw new Error('bad signature'); // true if ANY valid sig found
const assertion = doc.getElementsByTagNameNS(SAML_NS, 'Assertion')[0];
const email = assertion.getElementsByTagNameNS(SAML_NS, 'NameID')[0].textContent;
await loginAs(email);`,
      },
      options: [
        'They replayed an old admin assertion, because NotOnOrAfter is not checked',
        'They wrapped their genuine signed assertion inside the document and inserted an unsigned assertion for admin first, which the code reads',
        'They changed the signature algorithm to none, which verifyXmlSignature accepts',
        'They injected an XML external entity that resolves to the admin\'s NameID',
      ],
      correct: [1],
      explanation:
        'This is XML Signature Wrapping: the signature check passes because a validly signed element exists somewhere, but the code reads the first Assertion in document order, which the attacker controls. The fix is to take the assertion from the verified reference (the element whose ID the signature covers) and reject documents with more than one assertion. Replay requires an admin assertion they don\'t have. XML-DSig has no "none" algorithm in vetted libraries. XXE could read files but would not produce a valid login as admin here.',
      followUps: [
        {
          q: 'Your library returns the signed element for you. What other checks are still missing from this handler?',
          a: 'Audience must equal our SP entity ID, Recipient/Destination our ACS URL, InResponseTo must match a stored AuthnRequest ID, NotBefore/NotOnOrAfter within a small skew, and the assertion ID recorded until expiry to block replay. Also key the account on (issuer, persistent NameID) instead of trusting a free-text email, and parse with DTDs disabled.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-06',
      difficulty: 'medium',
      question:
        'A user logs into hr.acme.com via SSO, then opens wiki.acme-docs.io and is logged in without a prompt. Select ALL statements that are true about what happened.',
      options: [
        'The browser sent the IdP\'s session cookie when wiki redirected it to the IdP',
        'wiki read hr\'s session cookie because both apps trust the same IdP',
        'The IdP issued a new assertion or code whose audience is wiki, distinct from the one issued to hr',
        'wiki created its own local session after validating what the IdP returned',
        'The IdP pushed a token to wiki in the background when the user first logged into hr',
      ],
      correct: [0, 2, 3],
      explanation:
        'SSO works because every app redirects the browser to the same IdP origin, where the IdP cookie lives; the IdP then mints an audience-restricted proof for wiki, and wiki sets its own session. Cookies cannot cross registrable domains, so wiki never sees hr\'s cookie. The IdP does not proactively push tokens to apps the user has not visited; login is always initiated by a redirect from the app.',
      followUps: [
        {
          q: 'The user now clicks "Log out" in hr only. What does wiki show on the next page load, and why?',
          a: 'wiki still shows the user as logged in, because its own session cookie is untouched and nothing told it about hr\'s logout. Unless hr performed RP-initiated logout at the IdP and the IdP sent back-channel logout tokens to every RP, the user stays logged into wiki — and even hr will silently log them back in on the next visit if the IdP session is alive.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-07',
      difficulty: 'hard',
      question:
        'A payments app suffers account takeovers via SIM swap; attackers receive the login OTP on the swapped number. Select ALL controls that directly break this attack path.',
      options: [
        'Binding login to a non-exportable device key registered in Android Keystore, so the new SIM in the attacker\'s phone is insufficient',
        'Raising the OTP length from 6 to 8 digits',
        'Checking a carrier/SIM-change signal and holding sensitive actions for 24–72 hours after a recent SIM change',
        'Sending the OTP over WhatsApp instead of SMS',
        'Offering passkeys (WebAuthn) as the login factor',
      ],
      correct: [0, 2, 4],
      explanation:
        'SIM swap gives the attacker the phone number, so any factor tied to the number falls. Device-bound keys and passkeys move possession to a cryptographic key the attacker doesn\'t have; SIM-change signals let you treat a just-swapped number as untrustworthy (NIST 800-63B-4 explicitly suggests considering SIM change and porting). Longer OTPs don\'t help — the attacker receives the code. WhatsApp OTP is usually re-registered to the same number after a swap, so it is still number-bound.',
      followUps: [
        {
          q: 'After you add device binding, where will the attackers move next?',
          a: 'To device re-binding and account recovery: "I lost my phone, send an OTP to my number" re-opens the SIM-swap path. Make re-binding require old-device approval or strong identity proofing (video KYC), add a cooling-off period with low limits, and notify every channel. Also expect social engineering of support agents and screen-sharing scams on the real device.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-08',
      difficulty: 'hard',
      question:
        'Your gateway mints v4.public PASETO tokens with footer {"kid":"edge-2026-10"} and the tenant ID as an implicit assertion. Select ALL statements that are correct.',
      options: [
        'Anyone who intercepts the token can read the footer, including the kid',
        'Changing the footer to point at a different kid invalidates the signature',
        'The payload claims are encrypted, because PASETO tokens are always confidential',
        'A token minted for tenant A fails verification when the service verifies with tenant B as the assertion',
        'The verifier must read the alg from the header to choose between Ed25519 and ECDSA',
      ],
      correct: [0, 1, 3],
      explanation:
        'The footer is base64url plaintext but covered by the signature, so it is readable and tamper-evident. Implicit assertions are signed but not transmitted, so verifying under a different tenant context fails. v4.public only signs; only the local purpose encrypts claims. There is no alg header: v4.public always means Ed25519, which is the whole point.',
      followUps: [
        {
          q: 'A team wants to put the user\'s email in the footer so logs can show it without verifying. Good idea?',
          a: 'No. The footer is plaintext, so the email leaks into every log, proxy and browser history that sees the token — PII exposure, even for local tokens. And reading data before verification invites decisions based on unverified input. Log the verified `sub` after verification instead, or a pseudonymous ID.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-09',
      difficulty: 'expert',
      question:
        'Employees use TOTP as the second factor for the corporate IdP. A red team clones the login page on a look-alike domain and runs a real-time reverse proxy that relays credentials and the TOTP code to the real IdP. Which change actually stops this attack?',
      options: [
        'Shrink the TOTP step from 30 s to 15 s so relayed codes expire faster',
        'Mark each TOTP code as single-use so the proxy cannot reuse it',
        'Replace TOTP with WebAuthn/passkeys bound to the IdP\'s origin',
        'Use push notifications with a 60-second approval timeout instead of TOTP',
      ],
      correct: [2],
      explanation:
        'A real-time proxy uses the code within seconds, once, and the user approves on the real factor — so shorter steps, single-use enforcement and plain push all still pass. WebAuthn includes the origin in the signed client data and the authenticator scopes credentials to the RP ID, so on the look-alike domain no credential is offered and a relayed assertion carries the wrong origin. Single-use matters for replay, but the proxy doesn\'t replay; it relays.',
      followUps: [
        {
          q: 'The proxy steals the IdP session cookie after a passkey login on a legitimate device via malware. Does WebAuthn help now?',
          a: 'No — WebAuthn protects the authentication ceremony, not the session afterwards. Defences move to session binding: short IdP session lifetimes, device-bound session credentials (DBSC in Chromium), binding tokens to keys (DPoP/mTLS), and anomaly detection (new IP/ASN with the same session → force re-auth).',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-10',
      difficulty: 'hard',
      question:
        'An XSS bug is found in your SPA. Compare two deployments: (A) access + refresh tokens in localStorage sent via Authorization header; (B) BFF with an HttpOnly, SameSite=Lax session cookie. What is the most accurate statement about the impact?',
      options: [
        'Both are equally compromised, because XSS can do anything the user can do',
        'In A the attacker can exfiltrate long-lived tokens and use them from anywhere after the tab closes; in B they can only act through the victim\'s browser while the page is open',
        'B is fully safe because HttpOnly cookies cannot be used by injected scripts',
        'A is safer because header-based tokens are immune to CSRF, which XSS relies on',
      ],
      correct: [1],
      explanation:
        'XSS in B can still send same-origin requests that carry the cookie (so B is not "fully safe"), but the session secret never leaves the browser, the attack ends when the tab closes, and the server can revoke it. In A the refresh token is copied off the device and works for days. "Equally compromised" ignores persistence and exfiltration. CSRF immunity is unrelated to XSS — XSS is same-origin and needs no CSRF.',
      followUps: [
        {
          q: 'With the BFF, what new defence must you add that A did not need?',
          a: 'CSRF protection, since the browser now attaches the cookie automatically: SameSite=Lax/Strict plus a check on state-changing requests — an anti-CSRF token, or verifying `Origin`/`Sec-Fetch-Site` and requiring a custom header such as `X-Requested-With`, which cross-site forms cannot set without a CORS preflight.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-11',
      difficulty: 'medium',
      question:
        'You add a "Log out" button to an internal app that deletes its own session cookie and redirects to "/". Users report that clicking it appears to do nothing. Why?',
      options: [
        'The browser caches the previous page, so the user sees stale content',
        'The app redirects to the IdP on "/", the IdP session cookie is still valid, and the user is silently logged back in',
        'Deleting a cookie requires matching Path and Domain, which the code omitted, so the cookie survived',
        'Logout must be a POST request; GET logouts are ignored by browsers',
      ],
      correct: [1],
      explanation:
        'With SSO, the app session is only one layer. "/" requires auth → redirect to the IdP → IdP finds its own valid session → new code → new app session, in a few hundred ms. A cookie attribute mismatch is a real bug, but it would leave the old session in place rather than create a fresh login, and is less likely than the SSO effect. Browser caching would show stale content but the next request would still need auth. POST logout is a CSRF best practice, not something browsers enforce.',
      followUps: [
        {
          q: 'Product wants "Log out of this app only" to stay logged out until the user clicks Log in. How?',
          a: 'After the local logout, redirect to a public "You are signed out" page that does not auto-trigger SSO, instead of "/". When the user clicks "Sign in", start the flow normally (silent if the IdP session is alive). Optionally pass `prompt=select_account` so the user can switch identity.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-12',
      difficulty: 'expert',
      question:
        'An attacker steals an authorization code from a mobile app\'s redirect (malicious app registered the same custom scheme) and injects it into their own session with your app. Your OIDC client checks state and nonce. Which mechanism is designed to make the stolen code useless?',
      options: [
        'The nonce, because the ID token returned for the stolen code contains the victim\'s nonce',
        'The state parameter, because the attacker cannot guess the victim\'s state',
        'PKCE, because the token request must present the code_verifier that only the original client instance holds',
        'Redirect URI exact matching at the IdP, because the attacker uses a different URI',
      ],
      correct: [2],
      explanation:
        'PKCE binds the code to the code_verifier generated by the client that started the flow; without it, redeeming the code fails at the token endpoint. state binds the response to the browser that sent the request but does nothing if the attacker redeems the code directly. nonce detection depends on the client comparing against its own stored nonce — useful, but PKCE is the purpose-built defence against code interception and injection (RFC 7636, RFC 9700). The malicious app intercepted the legitimate redirect URI, so exact matching does not help.',
      followUps: [
        {
          q: 'Is PKCE still needed for a confidential server-side web app that authenticates to the token endpoint with a client secret?',
          a: 'Yes, per RFC 9700 (OAuth 2.0 Security BCP): client authentication stops outsiders from redeeming a stolen code, but not code injection — an attacker can inject a stolen code into the legitimate client\'s callback, and the client redeems it with its own secret. PKCE (or nonce, checked correctly) detects that the code belongs to a different flow.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-13',
      difficulty: 'hard',
      question:
        'After a VM migration, the auth server\'s clock runs 75 seconds fast; phones are correct. Your verifier accepts steps T-1, T and T+1 based on server time. What do users experience?',
      options: [
        'Nothing changes, because ±1 step covers up to 90 seconds of skew',
        'Every code fails, because the phone\'s current step is about 2.5 steps behind the server, outside the window',
        'Codes work for roughly the first half of each 30-second period and fail for the rest, depending on alignment',
        'Codes are accepted but immediately rejected as replays because last-used steps are in the future',
      ],
      correct: [1],
      explanation:
        'Server step = floor((t + 75) / 30) and phone step = floor(t / 30). With r = t mod 30, the difference is floor((r + 75) / 30): 2 when r < 15 and 3 otherwise, never 1 or 0, so every code falls outside a ±1 window. Option C describes a skew between 30 and 60 s, where the difference alternates between 1 and 2. Option A overstates the window: ±1 step fully tolerates skew below 30 s and partially up to 60 s, not 90 s. Failures never advance the last-used step, so replay logic is not involved.',
      followUps: [
        {
          q: 'How would you detect this within minutes instead of via user complaints?',
          a: 'Emit metrics for TOTP outcome by matched offset (−1/0/+1/fail). A healthy fleet shows ~95% at offset 0; a clock problem shows a sudden swing to −1 or a spike in failures across all users simultaneously. Alert on chrony/NTP offset > 1 s on auth hosts, and include server time in the health check.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-14',
      difficulty: 'expert',
      question:
        'payments-svc receives a user\'s access token (aud = api.acme.com, scope = "orders payments profile") and must call ledger-svc on the user\'s behalf via RFC 8693 token exchange. Select ALL properties the exchanged token should have.',
      options: [
        'aud = ledger-svc, so ledger rejects tokens minted for other services',
        'An act claim identifying payments-svc as the actor, which ledger can match against the mTLS peer identity',
        'The same jti as the original token, so revoking one revokes both',
        'Only the scopes ledger needs (e.g. ledger:write), narrower than the subject token',
        'A longer lifetime than the subject token, so retries inside ledger never fail mid-flow',
      ],
      correct: [0, 1, 3],
      explanation:
        'Token exchange exists to narrow: a per-service audience, least-privilege scopes, and an actor chain so the recipient knows who is acting for whom. Reusing the jti breaks uniqueness and replay detection — each issued token needs its own ID; revocation is linked via the subject/session instead. Exchanged tokens should be shorter-lived (tens of seconds to minutes), never longer than the token they derive from.',
      followUps: [
        {
          q: 'The STS adds 4 ms per hop and the call chain is 5 services deep. How do you keep latency in check?',
          a: 'Cache exchanged tokens per (subject token jti, target audience) for most of their lifetime, so repeat calls skip the STS — hit rates are high because one user request often fans out to the same services. Run the STS in-cluster, stateless, with keys from KMS cached in memory. For the hottest paths, let the gateway pre-mint a token with a small list of audiences, trading precision for one fewer hop.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-15',
      difficulty: 'hard',
      question:
        'An attacker who phished one recovery code fires 20 parallel requests with it, and three succeed, each disabling MFA on a different device enrolment. What is the bug?',
      code: {
        language: 'typescript',
        code: `async function redeem(userId: string, input: string) {
  const rows = await db.query(
    'SELECT id, hash FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId]);
  for (const r of rows.rows) {
    if (await argon2.verify(r.hash, input)) {
      await db.query('UPDATE recovery_codes SET used_at = now() WHERE id = $1', [r.id]);
      return true;
    }
  }
  return false;
}`,
      },
      options: [
        'argon2.verify is too slow, so it should be replaced by SHA-256 to shrink the race window',
        'The check and the mark-as-used are separate steps; the UPDATE should be conditional (AND used_at IS NULL) and the result count must decide success',
        'The SELECT should use FOR SHARE so concurrent readers see the same snapshot',
        'Recovery codes should be stored encrypted rather than hashed so they can be compared directly in SQL',
      ],
      correct: [1],
      explanation:
        'This is a time-of-check/time-of-use race: all parallel requests read the code as unused during the ~50 ms argon2 verify, then each "wins". Making the UPDATE conditional and returning `rowCount === 1` turns it into an atomic compare-and-set; alternatively SELECT … FOR UPDATE. A faster hash only narrows the window. FOR SHARE allows concurrent readers and does not block them. Encrypting codes weakens storage and still leaves the race.',
      followUps: [
        {
          q: 'Besides atomicity, what should happen when a recovery code is successfully used?',
          a: 'Treat it as a security event: notify the user on all channels, show remaining codes, require them to enrol a new factor, and consider revoking other sessions. If two different codes are used within minutes, or a code is used from a new device/country, hold sensitive changes (MFA removal, payout changes) for a cooling-off period.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-16',
      difficulty: 'expert',
      question:
        'A bank partner requires that the integrity proof of each payout request be verifiable inside your payments service, which sits behind an AWS ALB (TLS terminated) and an Envoy sidecar. Which approach meets the requirement?',
      options: [
        'mTLS between partner and ALB, with the ALB forwarding the client certificate in a header',
        'A bearer access token from OAuth2 client credentials with a 5-minute lifetime',
        'Mutual TLS with SPIFFE identities between Envoy and the payments service',
        'An HMAC (or asymmetric) signature over the canonical request, verified in the payments service against the raw bytes',
      ],
      correct: [3],
      explanation:
        'A message signature travels with the request, so the payments service can verify method, path, body hash and timestamp itself regardless of how many TLS hops terminate in between. Client-cert mTLS proves possession only to the ALB; a forwarded certificate header proves nothing about the message and must be trusted on faith. Bearer tokens carry no message integrity. Mesh mTLS authenticates Envoy, not the partner.',
      followUps: [
        {
          q: 'The partner also wants non-repudiation: proof in a dispute that they sent a specific payout. Does HMAC give that?',
          a: 'No. With HMAC both sides hold the same secret, so you could have produced the signature yourself. Non-repudiation needs an asymmetric signature (partner signs with a private key you never see, e.g. Ed25519 under RFC 9421), with the signed request and signature stored in an append-only audit log.',
        },
      ],
    },
    {
      id: 'api-auth-sso-mcq-17',
      difficulty: 'expert',
      question:
        'Your workforce IdP lets employees log in with passkeys synced through their Apple or Google accounts. An auditor working to NIST SP 800-63B-4 says the admin console for the production database requires AAL3. What is the correct response?',
      options: [
        'Synced passkeys are phishing-resistant, so they already satisfy AAL3',
        'Synced passkeys qualify for AAL2; AAL3 needs a non-exportable key, so require device-bound security keys (or platform keys that cannot sync) for that console',
        'Add TOTP on top of synced passkeys to reach AAL3',
        'AAL3 forbids WebAuthn entirely and requires smart cards with PIV certificates',
      ],
      correct: [1],
      explanation:
        'NIST 800-63B-4 allows syncable authenticators up to AAL2; AAL3 requires a phishing-resistant authenticator with a non-exportable private key, which a cloud-synced passkey is not. Phishing resistance is necessary but not sufficient for AAL3. Adding TOTP does not make the key non-exportable. WebAuthn hardware security keys can satisfy AAL3; PIV is one option, not the only one.',
      followUps: [
        {
          q: 'How do you enforce "security key only" for one console while other apps accept synced passkeys?',
          a: 'The console requests a higher assurance level (OIDC `acr_values`, e.g. a phishing-resistant hardware ACR) and verifies the returned `acr`/`amr` before creating a session. At the IdP, restrict that ACR to credentials whose attestation (AAGUID) matches an allow-list of hardware security keys, and check that the credential\'s backup-eligible flag is not set.',
        },
      ],
    },
  ],
};

export default topic;
