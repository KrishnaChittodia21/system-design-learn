import type { Topic } from '../../types';

const topic: Topic = {
  id: 'misc-web-auth',
  phase: 'miscellaneous',
  order: 1,
  title: 'HTTP, DNS, Real-time Transports, Sessions & Auth',
  subtitle:
    'A question bank over the web plumbing every backend interview touches: HTTP/1.1 to HTTP/3, DNS, WebSockets and SSE, cookies and sessions, JWTs, refresh tokens and the authN/authZ split. Fresh angles only.',
  estimatedMinutes: 120,
  sources: [
    'RFC 9110 (HTTP Semantics), RFC 9113 (HTTP/2), RFC 9114 (HTTP/3), RFC 9000 (QUIC), RFC 8470 (Early-Data / 425)',
    'RFC 6265 / RFC 6265bis (Cookies), Chromium "SameSite Updates" and SameSite FAQ',
    'RFC 7519 (JWT), RFC 8725 (JWT BCP), RFC 9700 (OAuth 2.0 Security BCP, Jan 2025), RFC 9449 (DPoP)',
    'RFC 2308 (DNS negative caching), RFC 9460 (SVCB/HTTPS records), RFC 7838 (Alt-Svc)',
    'OWASP Session Management and JWT Cheat Sheets',
    'Hello Interview — Networking Essentials for System Design',
    'DesignGurus — What happens when you type a URL',
    'techinterview.org — Why interviewers keep asking if you can revoke a JWT',
    'LeetCode Discuss and Glassdoor backend interview experiences (2025)',
    'Cloudflare and Google engineering blogs on HTTP/2 Rapid Reset (CVE-2023-44487)',
    'MDN Web Docs — Server-sent events, WebSocket API, 425 Too Early, Set-Cookie',
  ],
  tags: ['http', 'https', 'http2', 'http3', 'quic', 'dns', 'websockets', 'sse', 'sessions', 'cookies', 'jwt', 'oauth', 'authn', 'authz', 'question-bank'],
  cheatSheet: [
    'HTTPS hides path, query, headers and body from the network, but NOT the destination IP or (without ECH) the SNI hostname. Secrets in URLs still leak into logs, history and Referer.',
    'HTTP/2 removes HTTP-level head-of-line blocking but keeps TCP HOL: one lost packet stalls every stream on the connection. Server push is dead (Chrome 106 removed it) — use 103 Early Hints.',
    'HTTP/3 = HTTP over QUIC over UDP: per-stream loss recovery, TLS 1.3 built in, replayable 0-RTT (Early-Data: 1, 425 Too Early). Discovered via Alt-Svc (default ma 24h) or an HTTPS DNS record, so first visits are usually HTTP/2.',
    'DNS caches at every hop (browser, OS, resolver). NXDOMAIN is cached too (negative TTL = min(SOA TTL, SOA MINIMUM)). Lower TTLs at least one old-TTL before a cutover.',
    'Node does not cache DNS; dns.lookup runs getaddrinfo on the 4-thread libuv pool shared with fs, crypto and zlib. Pooled keep-alive sockets ignore DNS changes until they close.',
    'WebSocket = HTTP/1.1 Upgrade → 101, then framed full-duplex over the same TCP socket. Proxies need Upgrade/Connection forwarded and idle timeouts above your ping interval (ALB default 60s).',
    'SSE = one long GET with text/event-stream; free reconnect, Last-Event-ID, retry. Limits: GET only, no custom headers in EventSource, text only, 6 connections per origin on HTTP/1.1.',
    'Sessions: regenerate the ID on login (fixation), idle AND absolute timeouts, server-side revocation is trivial. Sliding expiry means one store write per request unless throttled.',
    'Cookies: HttpOnly + Secure + SameSite=Lax + __Host- prefix (no Domain, Path=/). Only Chrome-family treat a missing SameSite as Lax; "site" = registrable domain, so subdomains are same-site.',
    'JWT is signed, not encrypted. Pin the algorithm server-side, validate iss/aud/exp with small leeway, and accept that revocation needs state (denylist by jti or per-user "valid-after").',
    'Access + refresh: short access (5–15 min), rotated single-use refresh with family reuse detection (RFC 9700 requires rotation or sender-constraining for public clients), plus an absolute family lifetime.',
    'AuthN = who you are (401 + WWW-Authenticate); AuthZ = what you may do on THIS object (403, or 404 to hide existence). Most real breaches are object-level authZ bugs, not broken login.',
  ],
  sections: [
    {
      heading: 'HTTP / HTTPS — what TLS actually hides, and what it does not',
      body: `**Intuition:** HTTPS is a sealed envelope. The postman cannot read the letter, but he still sees the address on the envelope.

**Mechanism:** TCP handshake (1 RTT), then TLS 1.3 (1 RTT; TLS 1.2 needs 2) negotiates keys and proves the server owns the certificate for the hostname. After that, the method, path, query string, headers, cookies and body are encrypted. HTTP semantics (methods, status codes, caching) are unchanged — TLS sits underneath.

**What still leaks:** the destination IP, the SNI hostname in the ClientHello (unless Encrypted Client Hello is deployed), response sizes and timing. And anything in the URL leaks *at the endpoints*: access logs, proxy logs, browser history and the Referer header.

**#1 interview trap:** "The token is in the query string but it's HTTPS, so it's safe." The wire is safe; your nginx log and your analytics vendor are not.

**Operational traps:** a server that sends only the leaf certificate works in Chrome (which fetches or caches the missing intermediate) but fails in Node, curl and Java clients. HSTS with includeSubDomains + preload is a one-way door for every subdomain.`,
      keyPoints: [
        'TLS 1.3 = 1-RTT handshake; resumption can be 0-RTT (replayable).',
        'Encrypted: path, query, headers, body. Visible: IP, SNI (without ECH), sizes, timing.',
        'Always serve the full chain (leaf + intermediates); test with a non-browser client.',
        'HSTS preload requires max-age ≥ 1 year, includeSubDomains and preload — hard to undo.',
      ],
      source: 'RFC 9110; RFC 8446 (TLS 1.3); hstspreload.org requirements',
    },
    {
      heading: 'HTTP/2 — multiplexing, and the head-of-line blocking it did not fix',
      body: `**Intuition:** HTTP/1.1 is six single-lane roads; HTTP/2 is one multi-lane highway — until a crash (a lost packet) closes the whole highway.

**Mechanism:** one TCP connection carries many concurrent *streams*, each split into binary frames (HEADERS, DATA, RST_STREAM, SETTINGS, GOAWAY). HPACK compresses headers with a per-connection dynamic table, so a repeated 1 KB cookie or JWT costs a few bytes after the first request. The peer caps parallelism with SETTINGS_MAX_CONCURRENT_STREAMS (commonly 100–128).

**What it fixed:** HTTP-level head-of-line blocking (a slow response no longer blocks the ones behind it) and the connection explosion of domain sharding.

**What it did not fix:** TCP head-of-line blocking. TCP delivers bytes in order, so one lost segment stalls *every* stream until it is retransmitted. On a 2% loss mobile link, one HTTP/2 connection can be slower than six HTTP/1.1 connections.

**Traps worth knowing:** server push is effectively dead (Chrome removed it in v106; use 103 Early Hints). Connection *coalescing* lets a browser reuse one connection for two hostnames when the IP matches and the certificate covers both — so a server that routes by SNI instead of the :authority header can send requests to the wrong vhost (the fix is routing by :authority or returning 421 Misdirected Request). The 2023 Rapid Reset attack (CVE-2023-44487) abused cheap stream open + RST_STREAM to hit 200M+ requests/s.`,
      diagram: `HTTP/1.1 (6 conns)          HTTP/2 (1 conn, N streams)
conn1: [req A]---[resp A]   stream1: HEADERS DATA DATA
conn2: [req B]---[resp B]   stream3: HEADERS DATA
...                         stream5: HEADERS DATA DATA DATA
                            -- one lost TCP segment --> ALL streams wait`,
      source: 'RFC 9113; Cloudflare and Google blogs on CVE-2023-44487',
    },
    {
      heading: 'HTTP/3 / QUIC — UDP transport, per-stream recovery, replayable 0-RTT',
      body: `**Intuition:** QUIC gives each HTTP stream its own lane at the transport layer, so a crash in one lane does not close the others.

**Mechanism:** QUIC runs in user space over UDP. It builds in TLS 1.3 (no separate TLS handshake: new connections cost 1 RTT, resumed ones can send data in 0-RTT), does loss recovery per stream, and identifies connections by a *connection ID* instead of the IP/port 4-tuple — so a phone moving from Wi-Fi to 4G keeps its connection. Headers use QPACK instead of HPACK.

**Why UDP?** Middleboxes and OS kernels ossified TCP; a new transport protocol number would be dropped by firewalls and take a decade to ship in kernels. UDP passes through, and user-space stacks can be updated with the app.

**Discovery:** the first visit is normally HTTP/2 over TCP; the response carries Alt-Svc (cached for ma seconds, default 24 h) or DNS publishes an HTTPS record, and later requests race QUIC. Networks that block UDP 443 silently fall back to TCP.

**#1 interview trap:** 0-RTT data can be replayed by an attacker who captured it. Only idempotent requests belong in early data; the edge marks them with Early-Data: 1 and origins answer 425 Too Early for anything unsafe, which makes the client retry after the handshake.

**Cost:** QUIC often burns noticeably more CPU per byte than TCP+TLS (user-space crypto, per-packet syscalls, weaker NIC offload); UDP GSO/GRO narrows the gap.`,
      source: 'RFC 9000, RFC 9114, RFC 8470, RFC 9460',
    },
    {
      heading: 'DNS — resolution, caching layers, and the caches you forgot',
      body: `**Intuition:** DNS is a phone book whose pages are photocopied everywhere, and every copy has its own expiry date.

**Mechanism:** the stub resolver (OS) asks a recursive resolver (ISP, 8.8.8.8, CoreDNS in k8s). On a cold cache the recursor walks root → TLD (.com) → the zone's authoritative servers, then caches each answer for its TTL. Browsers, OS caches, JVMs and sidecars add their own caches, and some ignore TTLs.

**Things interviewers probe:**
- **Negative caching:** NXDOMAIN is cached for min(SOA TTL, SOA MINIMUM). Query a name before creating it and resolvers may "remember" it doesn't exist for an hour.
- **Apex CNAME:** a CNAME cannot sit at example.com (it would collide with SOA/NS records), so providers offer ALIAS/ANAME or CNAME flattening.
- **TTL is a promise about the future:** lowering the TTL only helps once the *old* TTL has expired everywhere.
- **Node specifics:** Node does not cache DNS. dns.lookup calls getaddrinfo on the libuv thread pool (4 threads by default, shared with fs, crypto and zlib), so slow DNS can stall bcrypt and file reads. Keep-alive sockets never re-resolve, so a DNS change doesn't move pooled traffic until those connections close.
- **Dangling records:** a CNAME pointing at a deleted cloud resource (bucket, app) can be claimed by an attacker — subdomain takeover.`,
      diagram: `app -> OS stub -> recursive resolver --(cold)--> root
                        |                 \\--> .com TLD
                        |                  \\-> authoritative (example.com)
                        +-- caches answer for TTL (and NXDOMAIN for neg TTL)`,
      source: 'RFC 1034/1035, RFC 2308; Node.js dns module docs',
    },
    {
      heading: 'WebSockets — the upgrade, the long-lived socket, and what breaks it',
      body: `**Intuition:** start as an HTTP phone call, then both sides agree to keep the line open and talk freely.

**Mechanism:** the client sends GET with Upgrade: websocket, Connection: Upgrade and a Sec-WebSocket-Key; the server replies 101 Switching Protocols with Sec-WebSocket-Accept. From then on both sides send framed messages (text, binary, ping, pong, close) over the same TCP socket; client-to-server frames are masked. RFC 8441 and RFC 9220 run WebSockets over HTTP/2 and HTTP/3 streams, but most production traffic is still HTTP/1.1 upgrade.

**What breaks it in production:**
- Proxies must forward Upgrade and Connection (they are hop-by-hop headers and are stripped by default in nginx).
- Idle timeouts: ALB and nginx default to 60 s; send an app-level ping every 20–30 s.
- Stateful scaling: a socket lives on one pod, so fan-out needs pub/sub (Redis, NATS, Kafka) plus a user → gateway registry; deploys must drain with jittered reconnects.
- Backpressure: send() on a slow client just grows bufferedAmount in your heap.

**#1 interview trap:** auth. The browser WebSocket API cannot set an Authorization header. Options: cookies (then you must check Origin to stop cross-site WebSocket hijacking), a short-lived single-use ticket in the query string, or a first-message auth frame. And a token validated at connect time says nothing about hour three of the connection.`,
      code: [
        {
          language: 'typescript',
          title: 'Backpressure-aware broadcast with the ws library',
          code: `import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ port: 8080, perMessageDeflate: false }); // deflate costs memory per socket
const MAX_BUFFERED = 1 * 1024 * 1024; // 1 MB queued for one client is already "too slow"

export function broadcast(payload: string): void {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.bufferedAmount > MAX_BUFFERED) {
      // Slow consumer: close with 1013 (try again later) instead of growing our heap
      client.close(1013, 'slow consumer');
      continue;
    }
    client.send(payload);
  }
}`,
        },
      ],
      source: 'RFC 6455, RFC 8441, RFC 9220',
    },
    {
      heading: 'SSE — server-sent events, the underrated one-way stream',
      body: `**Intuition:** SSE is a newsletter subscription over a single HTTP response that never ends.

**Mechanism:** the client opens a GET; the server answers Content-Type: text/event-stream and keeps writing lines: id:, event:, data:, retry: and blank-line terminators. Browsers' EventSource reconnects automatically and sends the last seen id back as the Last-Event-ID request header, so the server can replay what was missed. Lines starting with a colon are comments — handy as heartbeats. LLM APIs stream tokens this way.

**Limits:**
- GET only, and EventSource cannot set custom headers (only withCredentials for cookies). For bearer tokens, use a fetch()-based stream reader instead.
- Text only; binary needs base64.
- On HTTP/1.1 each stream holds one of the browser's ~6 connections per origin — tab seven hangs. Over HTTP/2 it is one stream among ~100.
- Anything that buffers (nginx proxy_buffering, compression middleware, corporate proxies, some CDNs) turns a stream into bursts. Send X-Accel-Buffering: no, flush after each event, and skip gzip on this route.

**#1 interview trap:** "SSE reconnects automatically, so we won't lose events." Reconnect is free; *resumption* is only as good as your server's handling of Last-Event-ID and the retention of an event log to replay from.`,
      source: 'WHATWG HTML Living Standard — Server-sent events; MDN',
    },
    {
      heading: 'Sessions — server-side state that is easy to revoke',
      body: `**Intuition:** a session is a cloakroom ticket. The ticket (session ID) is meaningless; the coat (user state) stays with the server.

**Mechanism:** on login, the server creates a random ID of at least 128 bits, stores {userId, roles, createdAt, lastSeen} in a store (Redis, Postgres), and sends the ID in a cookie. Every request looks the ID up — typically 0.2–1 ms against Redis in the same AZ.

**Strengths:** revocation is a DELETE; "log out all devices" is deleting a set; you can list active devices; the cookie stays small.

**Design knobs:**
- **Idle timeout** (e.g. 30 min) and **absolute timeout** (e.g. 12 h or 30 days for "remember me"). Without an absolute cap, an active attacker keeps a stolen session alive forever.
- **Sliding expiry** writes on every request; throttle it (touch at most once a minute) or the store takes a write per read.
- **Fixation:** always issue a new ID at login and on privilege change, and destroy the old one.
- **Concurrent writes:** libraries that save the whole session object on every response (express-session resave: true) cause lost updates when two requests race.

**#1 interview trap:** "Sessions don't scale." A Redis cluster serves millions of lookups per second; what actually hurts is sticky in-memory sessions on app pods, not the session model itself.`,
      source: 'OWASP Session Management Cheat Sheet',
    },
    {
      heading: 'Cookies — attributes, SameSite reality, and scope',
      body: `**Intuition:** a cookie is a sticky note the browser attaches to every request that matches its rules; the attributes are those rules.

**Attributes that matter:**

| Attribute | Effect | Trap |
|---|---|---|
| HttpOnly | JS cannot read it | XSS can still *use* it by sending requests |
| Secure | HTTPS only | Required for SameSite=None |
| SameSite | Lax / Strict / None: cross-site sending rules | "Site" = registrable domain, so evil.example.com is same-site |
| Domain | Omitted = host-only; set = all subdomains | Domain=example.com ships the session to every subdomain |
| Path | Limits which paths receive it | Not a security boundary within one origin |
| Max-Age / Expires | Persistent vs session cookie | Browsers may restore "session" cookies on restart |
| __Host- prefix | Forces Secure, Path=/, no Domain | Browser rejects the cookie if rules are violated |

**SameSite facts:** Chrome and other Chromium browsers treat a cookie with no SameSite as Lax (since 2020), with a temporary "Lax+POST" exception that sends such cookies on top-level cross-site POSTs for 2 minutes after they are set. Firefox and Safari do **not** apply Lax-by-default, so always set it explicitly. Lax still sends cookies on top-level GET navigations — never mutate state on GET.

**Size:** browsers guarantee at least ~4 KB per cookie and ~50 per domain; every byte is sent on every matching request.`,
      source: 'RFC 6265bis; Chromium SameSite Updates and FAQ; MDN Set-Cookie',
    },
    {
      heading: 'JWT — a signed claim set, not a session',
      body: `**Intuition:** a JWT is a laminated ID card. Anyone can read it; only the issuer can make one; nobody can un-issue it before it expires.

**Mechanism:** base64url(header).base64url(payload).signature. The header says alg (RS256, ES256, EdDSA, HS256) and kid (which key). The payload holds claims: iss, sub, aud, exp, iat, nbf, jti, plus custom ones. Verification is local and cheap — an RS256 verify is tens of microseconds — which is the whole point: no DB lookup per request.

**Validation checklist (RFC 8725):**
- Pin the allowed algorithms server-side. Never trust the token's alg header (alg: none, and RS256 → HS256 confusion where the public key becomes an HMAC secret).
- Select the key by kid from a cached JWKS, with a refetch on unknown kid (rate-limited).
- Check iss, aud, exp and nbf with a small leeway (30–60 s) for clock skew.
- Keep it small: 1–2 KB tokens travel on every request and bloat headers.

**#1 interview trap:** revocation. Statelessness and instant revocation are mutually exclusive. Real answers: short expiry (5–15 min), a denylist of jti values kept until their exp, or a per-user "tokens issued before T are invalid" timestamp checked from a cache. Each reintroduces a lookup — be explicit about the trade.

Also: JWS is signed, not encrypted. Never put PII or secrets in claims unless you use JWE.`,
      code: [
        {
          language: 'typescript',
          title: 'Verifying with jose: algorithms pinned, iss/aud enforced',
          code: `import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cached JWKS; jose refetches on unknown kid with a cooldown
const JWKS = createRemoteJWKSet(new URL('https://auth.example.com/.well-known/jwks.json'), {
  cooldownDuration: 30_000,
});

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    algorithms: ['ES256'],           // never let the header choose
    issuer: 'https://auth.example.com',
    audience: 'orders-api',          // a token minted for another API is rejected
    clockTolerance: 30,              // seconds of skew between pods
  });
  return payload; // { sub, scope, exp, jti, ... }
}`,
        },
      ],
      source: 'RFC 7519, RFC 8725; OWASP JWT Cheat Sheet',
    },
    {
      heading: 'Access + Refresh Tokens — short-lived keys, rotated long-lived keys',
      body: `**Intuition:** the access token is a day pass; the refresh token is the membership card you show at the desk for a new one — and the desk can cancel it.

**Mechanism:** access tokens (JWT or opaque) live 5–15 minutes and are sent to APIs. The refresh token lives days to weeks, is sent *only* to the authorization server, and is stored server-side (as a hash) so it can be revoked. When the access token expires, the client exchanges the refresh token for a new pair.

**Rotation with reuse detection:** every refresh returns a new refresh token and marks the old one used. If a used token is presented again, either an attacker or the real client is replaying it — the server cannot tell which, so it revokes the whole token *family* (every descendant of that login). RFC 9700 (OAuth 2.0 Security BCP, January 2025) requires refresh tokens for public clients to be either sender-constrained (DPoP, mTLS) or rotated.

**Edge cases interviewers love:**
- Two tabs or a flaky mobile network refresh at the same time → false reuse alarm. Use single-flight refresh on the client and a short grace window (for example 10–30 s) on the server that returns the same successor token.
- Reuse detection only fires when the legitimate client comes back. Add an absolute family lifetime (for example 30 days) and an idle lifetime.
- In browsers, keep the refresh token in an HttpOnly, Secure, SameSite=Strict cookie scoped to Path=/auth/refresh, or keep all tokens server-side behind a BFF.`,
      diagram: `login -> RT1 (family F)
refresh(RT1) -> AT2 + RT2   [RT1 used, replaced_by=RT2]
refresh(RT2) -> AT3 + RT3   [RT2 used]
refresh(RT1) again  -> RT1 already used => revoke family F => re-login`,
      source: 'RFC 6749, RFC 9700 (BCP 240), RFC 9449 (DPoP)',
    },
    {
      heading: 'Authentication vs Authorization — who you are vs what you may touch',
      body: `**Intuition:** authentication is showing your passport at the airport; authorization is whether your boarding pass lets you onto *this* plane and into *this* seat.

**Mechanism:** authentication establishes identity (password + MFA, passkeys, OIDC login, mTLS for services) and produces a credential — a session or token. Authorization evaluates a policy on each request: can subject S perform action A on resource R, in tenant T? Models range from RBAC (roles) to ABAC (attributes) to ReBAC (relationships, Zanzibar-style).

**Status codes:** 401 Unauthorized really means *unauthenticated* and must carry a WWW-Authenticate challenge; 403 Forbidden means "I know who you are, and no". Return 404 instead of 403 when revealing that the object exists is itself a leak (other tenants' invoice IDs).

**Where it lives:** the gateway can do authentication and coarse checks (valid token, scope contains orders:read). Object-level checks — does invoice 123 belong to this user's tenant? — need data the gateway doesn't have and must live in the owning service. OWASP's number-one API risk (BOLA/IDOR) is exactly the gap between those two layers.

**#1 interview trap:** conflating OAuth 2.0 and OIDC. OAuth 2.0 is delegated *authorization* (an access token for an API); OIDC adds *authentication* on top (an ID token that tells the client who logged in). An ID token is not an API credential. In GraphQL, authorization must also cover nested field resolvers, not just the top-level query.`,
      source: 'RFC 9110 §15.5; OWASP API Security Top 10 (2023); OpenID Connect Core 1.0',
    },
  ],
  codeChallenges: [
    {
      id: 'misc-web-auth-cc-1',
      title: 'Harden a refresh-token endpoint: rotation, reuse detection, races',
      context:
        'A NestJS auth service issues 15-minute JWT access tokens and 30-day refresh tokens for a web app and a mobile app. Security review found that a leaked refresh token works for 30 days, and support tickets show random logouts when users have two tabs open.',
      task: 'Rewrite the refresh handler so refresh tokens are single-use, a replayed token revokes the whole login lineage, concurrent refreshes from the same client do not log the user out, and stored tokens are useless if the database leaks.',
      starter: {
        language: 'typescript',
        title: 'auth.service.ts (starter)',
        code: `import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { signAccessToken } from './jwt';

@Injectable()
export class AuthService {
  constructor(private readonly db: Pool) {}

  async refresh(refreshToken: string) {
    const { rows } = await this.db.query(
      'SELECT user_id, expires_at FROM refresh_tokens WHERE token = $1',
      [refreshToken],
    );
    const row = rows[0];
    if (!row) throw new UnauthorizedException();
    if (row.expires_at < new Date()) throw new UnauthorizedException();

    // Extend the session: issue a new refresh token, keep the old one valid too
    const next = randomBytes(32).toString('hex');
    await this.db.query(
      "INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')",
      [next, row.user_id],
    );
    return { accessToken: signAccessToken(row.user_id), refreshToken: next };
  }
}`,
      },
      hints: [
        'What happens to the old token after a successful refresh? What should happen if it is presented again?',
        'Two requests can read the same unused row at the same time. How do you make "claim this token" atomic without a lock server?',
        'Every refresh currently resets a 30-day clock. What bounds the total lifetime of one login?',
      ],
      solution: {
        language: 'typescript',
        title: 'auth.service.ts (solution)',
        code: `import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { signAccessToken } from './jwt';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const GRACE_MS = 15_000; // tolerate parallel refreshes from the same client

@Injectable()
export class AuthService {
  constructor(private readonly db: Pool) {}

  async refresh(presented: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Lock the row so concurrent refreshes of the same token serialize here
      const { rows } = await client.query(
        \`SELECT t.id, t.user_id, t.family_id, t.used_at, t.replaced_by, f.revoked_at, f.absolute_expires_at
           FROM refresh_tokens t JOIN token_families f ON f.id = t.family_id
          WHERE t.token_hash = $1 FOR UPDATE OF t\`,
        [sha256(presented)],
      );
      const t = rows[0];
      if (!t || t.revoked_at || t.absolute_expires_at < new Date()) throw new UnauthorizedException();

      if (t.used_at) {
        const withinGrace = Date.now() - t.used_at.getTime() < GRACE_MS;
        if (!withinGrace) {
          // Replay of a spent token: assume theft, kill the whole lineage
          await client.query('UPDATE token_families SET revoked_at = now() WHERE id = $1', [t.family_id]);
          await client.query('COMMIT');
          throw new UnauthorizedException('refresh token reuse');
        }
        // Racing sibling request: issue only a new access token, the successor RT is already out
        await client.query('COMMIT');
        return { accessToken: signAccessToken(t.user_id), refreshToken: null };
      }

      const next = randomBytes(32).toString('base64url');
      const ins = await client.query(
        \`INSERT INTO refresh_tokens (token_hash, user_id, family_id, expires_at)
         VALUES ($1, $2, $3, LEAST(now() + interval '7 days', $4)) RETURNING id\`,
        [sha256(next), t.user_id, t.family_id, t.absolute_expires_at],
      );
      await client.query('UPDATE refresh_tokens SET used_at = now(), replaced_by = $2 WHERE id = $1', [t.id, ins.rows[0].id]);
      await client.query('COMMIT');
      return { accessToken: signAccessToken(t.user_id), refreshToken: next };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}`,
      },
      explanation: `- **Hash at rest:** only SHA-256 of the token is stored; a DB dump no longer yields usable refresh tokens (a fast hash is fine because tokens are 256-bit random, not passwords).
- **Rotation:** the old token is marked used and linked to its successor, so each refresh token works once.
- **Reuse detection:** a spent token presented outside the grace window revokes the whole family and forces re-login for both the attacker and the victim — the safe default when you cannot tell them apart.
- **Race handling:** SELECT ... FOR UPDATE serializes concurrent refreshes of one token; a sibling request inside a 15 s grace window gets a fresh access token instead of tripping the alarm. Clients should still single-flight refreshes (one in-flight refresh per app, shared across tabs).
- **Bounded lifetime:** a 7-day idle expiry per token, capped by the family's absolute expiry, so an attacker who keeps refreshing cannot extend the login forever.
- **Transaction hygiene:** explicit BEGIN/COMMIT/ROLLBACK on a dedicated client and release in finally.`,
      followUps: [
        {
          "q": "The grace path returns refreshToken: null. What should the mobile client do with that, and how does it avoid getting stuck?",
          "a": "The client treats null as 'keep using the refresh token you already have', but that token was just spent by the sibling request, so the next refresh would trip reuse detection. Fix the protocol: on the grace path, return the same successor token issued to the sibling (store it encrypted for the grace window, keyed by the parent token id), so both callers end up with the same, valid successor. And fix the client: a single-flight refresh guard (one in-flight refresh per app; other callers await its promise, and in browsers coordinate tabs with `navigator.locks`), so races become rare in the first place."
        },
        {
          "q": "How do you test the reuse detection and race handling before release?",
          "a": "Integration tests against real Postgres: (1) refresh once, then present the old token after 20 s with a mocked clock, and assert 401 and that the family is revoked (the successor token also fails now); (2) fire 10 concurrent refreshes with the same token, and assert exactly one new refresh token is minted, the others take the grace path, and the family is not revoked; (3) present a token after the family's absolute expiry and assert 401; (4) dump the table and assert no raw tokens are stored. Add a production metric for reuse-revocations per day, with an alert on spikes, since a buggy client release shows up there first."
        }
      ],
    },
    {
      id: 'misc-web-auth-cc-2',
      title: 'Fix a cookie-session login and logout flow',
      context:
        'An Express/NestJS monolith uses express-session backed by Redis. A pentest reported session fixation, a cookie readable from a marketing subdomain hosted by a vendor, account enumeration on the login form, and that "logout" leaves the session usable if the cookie was copied.',
      task: 'Rewrite the session configuration and the login/logout handlers so that the session cookie is tightly scoped, the session ID changes at login, logout really ends the session on the server, and Redis is not written on every request.',
      starter: {
        language: 'typescript',
        title: 'session.ts (starter)',
        code: `import session from 'express-session';
import { RedisStore } from 'connect-redis';
import type { Request, Response } from 'express';
import { redis } from './redis';
import { users } from './users';

export const sessionMiddleware = session({
  store: new RedisStore({ client: redis }),
  secret: 'change-me',
  name: 'sid',
  resave: true,              // save on every request
  saveUninitialized: true,   // create sessions for anonymous visitors
  rolling: true,             // reset expiry on every response
  cookie: { domain: '.example.com', maxAge: 30 * 24 * 3600 * 1000 },
});

export async function login(req: Request, res: Response) {
  const user = await users.findByEmail(req.body.email);
  if (!user) return res.status(404).json({ error: 'no such user' });
  if (!(await users.checkPassword(user, req.body.password))) {
    return res.status(401).json({ error: 'wrong password' });
  }
  req.session.userId = user.id; // reuse whatever session the browser came with
  res.json({ ok: true });
}

export function logout(req: Request, res: Response) {
  res.clearCookie('sid');
  res.json({ ok: true });
}`,
      },
      hints: [
        'Which session ID does the user have after login, and who could have chosen it?',
        'Which hosts receive a cookie with Domain=.example.com? What does the __Host- prefix force?',
        'What does clearCookie do to the Redis entry? What do resave and rolling do to write volume?',
      ],
      solution: {
        language: 'typescript',
        title: 'session.ts (solution)',
        code: `import session from 'express-session';
import { RedisStore } from 'connect-redis';
import type { Request, Response } from 'express';
import { redis } from './redis';
import { users } from './users';

const COOKIE = '__Host-sid'; // browser enforces Secure, Path=/, and no Domain

export const sessionMiddleware = session({
  store: new RedisStore({ client: redis, prefix: 'sess:', ttl: 8 * 3600 }),
  secret: [process.env.SESSION_SECRET!, process.env.SESSION_SECRET_PREV!].filter(Boolean), // rotation
  name: COOKIE,
  resave: false,            // write only when the session changed (no lost updates)
  saveUninitialized: false, // no Redis entry for anonymous traffic
  rolling: false,           // expiry set at login; idle timeout enforced below
  cookie: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 8 * 3600 * 1000 },
});

export async function login(req: Request, res: Response) {
  const user = await users.findByEmail(req.body.email);
  const ok = user ? await users.checkPassword(user, req.body.password) : await users.dummyCheck();
  if (!user || !ok) return res.status(401).json({ error: 'invalid credentials' }); // one message, similar timing

  // New session ID at the privilege boundary defeats fixation
  req.session.regenerate((err) => {
    if (err) return res.status(500).end();
    req.session.userId = user.id;
    req.session.createdAt = Date.now();
    req.session.save((e) => (e ? res.status(500).end() : res.json({ ok: true })));
  });
}

export function logout(req: Request, res: Response) {
  // Delete the server-side record, then the cookie; a copied cookie is now worthless
  req.session.destroy(() => {
    res.clearCookie(COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
    res.status(204).end();
  });
}`,
      },
      explanation: `- **Fixation:** session.regenerate() issues a new ID at login, so an ID planted by an attacker before login never becomes authenticated.
- **Scope:** the __Host- prefix makes the browser reject the cookie unless it is Secure, Path=/ and host-only, so the vendor-hosted marketing subdomain never receives it. HttpOnly and SameSite=Lax are explicit because Firefox and Safari do not default to Lax.
- **Real logout:** session.destroy() deletes the Redis record; clearing the cookie alone leaves a copied cookie valid until expiry.
- **Enumeration:** one response for unknown email and wrong password, with a dummy hash check to keep timing similar.
- **Write volume and races:** resave: false, saveUninitialized: false and no rolling stop a Redis write per request and the lost-update race of saving the whole session on every response. An 8-hour absolute lifetime replaces 30-day sliding sessions; add an idle check (compare a throttled lastSeen) if the product needs one.
- **Secret rotation:** an array of secrets lets you rotate the signing secret without logging everyone out.`,
      followUps: [
        {
          "q": "Users want 'log out of all devices'. How do you implement it with this Redis session store?",
          "a": "Maintain an index of sessions per user: on login, `SADD user_sessions:<userId> <sessionId>` (with an expiry matching the max session lifetime), and on logout `SREM`. 'Log out everywhere' reads the set, deletes each `sess:<id>` key (pipelined `DEL`), then deletes the set. Sessions already gone simply no-op. To also handle sessions missed by a race, store a `sessions_valid_after` timestamp per user and have the session middleware reject sessions created before it. Do the same on password change, and show users a device list from the same index (with user agent and last-seen data)."
        },
        {
          "q": "How would you verify the fixation fix and real logout in an automated security test?",
          "a": "Fixation test: fetch the login page and capture the pre-login cookie value, log in in the same cookie jar, and assert the session cookie value changed and that the old value now yields an anonymous response when sent manually. Logout test: log in, copy the cookie, call logout, then replay the copied cookie in a fresh client and assert 401 and that the Redis key is gone. Scope test: assert the Set-Cookie header has the `__Host-` name, Secure, HttpOnly, Path=/ and no Domain. Enumeration test: compare response bodies and median timings for unknown email vs wrong password and assert no difference beyond noise."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'misc-web-auth-iq-01',
      difficulty: 'medium',
      question:
        'Our mobile app calls https://api.example.com/v1/reset?token=... over HTTPS. A colleague says the token is safe because "everything is encrypted". Who can actually see what, on the wire and off it?',
      whatInterviewerLooksFor: [
        'Separates what TLS protects (path, query, headers, body) from what it does not (IP, SNI, sizes)',
        'Knows URLs leak at the endpoints: access logs, proxies, history, Referer, crash reporters',
        'Mentions ECH as the fix for SNI and POST bodies or headers as the fix for secrets',
        'Gives a concrete remediation, not just "use HTTPS"',
      ],
      modelAnswer: `**On the wire (ISP, café Wi-Fi, corporate network):**
- Visible: destination IP, the SNI hostname in the ClientHello (api.example.com) unless Encrypted Client Hello is on, DNS queries unless DoH/DoT, packet sizes and timing.
- Hidden: method, path, query string, headers, cookies, body. So the token itself is not visible in transit.

**Off the wire — where the token really leaks:**
- CDN, load-balancer and nginx access logs record the full request line by default.
- APM/tracing tools capture URLs as span names.
- In a browser: history, bookmarks, and the Referer header sent to any third-party script, image or link on the page (Referrer-Policy helps, but defaults vary).
- Mobile crash reporters and analytics SDKs that log request URLs.

**Fix:**
- Move the secret to a POST body or an Authorization header.
- Make reset tokens single-use and short-lived (15–30 min), stored hashed.
- Set Referrer-Policy: no-referrer on the reset page and scrub query strings in logs.

**One-liner:** TLS protects the pipe, not the endpoints; secrets belong in headers or bodies, never URLs.`,
      followUps: [
        { q: 'Can the ISP tell which specific endpoint the user hit?', a: 'Not the path. It can often infer it from the hostname plus response size and timing patterns, which is why sensitive apps sometimes pad responses.' },
        { q: 'Does HTTP/3 change any of this?', a: 'No. QUIC still exposes the IP and, without ECH, the SNI in its Initial packets (which use publicly derivable keys); the endpoint leaks are identical.' },
      ],
      pitfalls: [
        'Claiming the ISP can see the full URL over HTTPS',
        'Claiming HTTPS makes secrets in URLs safe everywhere',
        'Forgetting logs and Referer as the actual leak paths',
      ],
    },
    {
      id: 'misc-web-auth-iq-02',
      difficulty: 'hard',
      question:
        'We renewed the TLS certificate on our public API on Friday. Browsers are fine, but on Monday three partner integrations (Java, Node and a Go cron job) fail with "unable to verify the first certificate". Walk me through the diagnosis and how you prevent this class of incident.',
      whatInterviewerLooksFor: [
        'Identifies an incomplete chain (missing intermediate) as the likely cause and explains why browsers mask it',
        'Knows how to verify with openssl s_client or curl, not with a browser',
        'Considers pinning, trust stores and cross-signed roots as alternatives',
        'Proposes automation: ACME, chain checks in CI, expiry and synthetic monitoring from non-browser clients',
      ],
      modelAnswer: `**Most likely cause: the server sends only the leaf certificate.**
- A TLS server must send the leaf plus intermediates; clients have only roots.
- Chrome and Safari hide the bug: they cache intermediates seen on other sites and can fetch missing ones via the AIA URL. Node, Go, Java and curl do not fetch AIA, so they fail.
- Renewals cause this when someone uploads cert.pem instead of fullchain.pem.

**Diagnosis (10 minutes):**
- openssl s_client -connect api.example.com:443 -servername api.example.com -showcerts and count the certificates; "verify error:num=21" confirms it.
- Check every edge: each CDN PoP, the ALB listener and any regional endpoint may have a different bundle.

**Other suspects if the chain is complete:**
- **Pinning:** a partner pinned the old leaf key or intermediate. Pin to your own backup key or a CA, never a leaf you rotate.
- **Trust store:** a new CA chain whose root is missing on an old JVM trust store — this happened widely during the 2021 Let's Encrypt root expiry.
- **SNI:** an old client that does not send SNI gets the default certificate.

**Prevention:**
- ACME automation (cert-manager, ACM) that always deploys the full chain.
- A CI/CD gate that runs a non-browser TLS handshake against staging after every certificate change.
- Synthetic probes from Node/Java clients in multiple regions, alerting 21 and 7 days before expiry.
- A partner communication channel for CA changes.`,
      followUps: [
        { q: 'Why not just tell partners to disable verification until we fix it?', a: 'That turns an outage into a MITM vulnerability that usually outlives the fix. Roll back to the previous full chain instead — it is minutes of work.' },
        { q: 'Where should TLS terminate for these partners?', a: 'At the edge/ALB with a managed certificate, re-encrypting to origin; one place to get the chain right, with mTLS to origin if the network is untrusted.' },
      ],
      pitfalls: [
        'Testing in a browser and declaring the certificate fine',
        'Suggesting partners add the intermediate to their trust store as the fix',
        'Ignoring multiple edges that may carry different bundles',
      ],
    },
    {
      id: 'misc-web-auth-iq-03',
      difficulty: 'medium',
      question:
        '"HTTP/2 solved head-of-line blocking." True, false, or half true? Explain what actually changed, and when HTTP/2 can be slower than HTTP/1.1.',
      whatInterviewerLooksFor: [
        'Distinguishes HTTP-level HOL (fixed by multiplexing) from TCP-level HOL (not fixed)',
        'Explains the packet-loss scenario with numbers',
        'Knows HTTP/3 is the answer to transport-level HOL',
      ],
      modelAnswer: `**Half true.**

**What HTTP/2 fixed:** in HTTP/1.1 a connection handles one request at a time (pipelining was never usable), so a slow response blocks everything behind it on that connection. Browsers worked around it with ~6 connections per origin and domain sharding. HTTP/2 multiplexes many streams over one connection with interleaved frames, so a slow response no longer blocks others at the HTTP layer.

**What it did not fix:** TCP delivers a single ordered byte stream. If one segment is lost, the kernel holds back all bytes after it — belonging to *every* stream — until the retransmit arrives, which takes at least one RTT (often 200 ms+ on mobile, more with an RTO).

**When HTTP/2 is slower:** on a lossy link (2–5% loss, common on congested 4G), six HTTP/1.1 connections spread the damage — a loss stalls one of six — and each has its own congestion window. One HTTP/2 connection loses its whole window and stalls all streams. Measurements from large mobile apps have shown p95 regressions after consolidating onto one HTTP/2 connection.

**The real fix:** HTTP/3 over QUIC, where loss recovery is per stream, so a lost packet only stalls the stream it belonged to.

**Say in the interview:** "HTTP/2 moved head-of-line blocking from the application layer down to TCP; HTTP/3 removes it from the transport too."`,
      followUps: [
        { q: 'Does HPACK introduce any HOL issue of its own?', a: 'Yes: HPACK dynamic-table updates must be processed in order, which is fine over TCP. QUIC needed QPACK precisely because streams can arrive out of order.' },
        { q: 'Would you still use HTTP/2 between services in one data center?', a: 'Yes. Loss is near zero inside a DC, so multiplexing and header compression win, which is why gRPC uses it.' },
      ],
      pitfalls: [
        'Saying HTTP/2 eliminated head-of-line blocking entirely',
        'Confusing HTTP/1.1 pipelining with HTTP/2 multiplexing',
      ],
    },
    {
      id: 'misc-web-auth-iq-04',
      difficulty: 'expert',
      question:
        'Your edge proxies suddenly show 40× the normal request rate, CPU at 100%, but inbound bandwidth has barely moved and almost no requests reach origin. Packet captures show clients opening HTTP/2 streams and cancelling them immediately. What is happening and how do you defend the fleet?',
      context: 'Modeled on the HTTP/2 Rapid Reset attacks disclosed in October 2023 (CVE-2023-44487), which peaked above 200M requests/s at Cloudflare and ~398M at Google.',
      whatInterviewerLooksFor: [
        'Recognises Rapid Reset: HEADERS followed by RST_STREAM so streams never count against MAX_CONCURRENT_STREAMS for long',
        'Explains why per-connection stream limits and bandwidth-based DDoS defences miss it',
        'Proposes per-connection reset-rate accounting, GOAWAY, and connection-level budgets',
        'Considers upgrades, WAF/edge provider features and origin protection',
      ],
      modelAnswer: `**What's happening: HTTP/2 Rapid Reset.**
- A client sends HEADERS (opening a stream) then RST_STREAM straight away, over and over, on a few connections.
- The server has already paid the cost: parsing, HPACK decoding, allocating stream state, maybe routing and starting an upstream request.
- The cancelled stream frees its slot at once, so SETTINGS_MAX_CONCURRENT_STREAMS (say 100) never bites — the client can churn thousands of streams per second per connection.
- Requests are tiny (tens of bytes), so bandwidth-based DDoS alarms stay quiet while CPU melts.

**Immediate mitigation:**
- Upgrade to proxy versions patched for CVE-2023-44487 (nginx, Envoy, HAProxy, Go, Node all shipped fixes); they count resets per connection.
- Enforce a reset or "cancelled before first byte" budget per connection — for example, more than 100 resets in 10 s → send GOAWAY and close.
- Limit new streams per second per connection, not just concurrent streams.
- Rate-limit connections per client IP/ASN at L4, and turn on the edge provider's HTTP/2 flood protections.

**Structural defences:**
- Do not start expensive work (upstream connection, auth call) until the request is fully received, or cancel it cheaply.
- Shed load at the edge by request cost, not just by count.
- Keep origin behind the CDN with allow-listed IPs so the attack cannot bypass the edge.

**Detection:** alert on the ratio of RST_STREAM to HEADERS frames and on requests/s per connection, not just totals.`,
      followUps: [
        { q: 'Why not just drop HTTP/2 and serve HTTP/1.1 during the attack?', a: 'It works as an emergency lever but costs all clients latency and more connections; a per-connection reset budget solves it without collateral damage.' },
        { q: 'Is HTTP/3 immune?', a: 'QUIC has an equivalent (RESET_STREAM), but its stream-credit mechanism (MAX_STREAMS) grants new streams deliberately, so implementations can pace them; you still need per-connection accounting.' },
      ],
      pitfalls: [
        'Treating it as a volumetric DDoS and scaling bandwidth',
        'Lowering MAX_CONCURRENT_STREAMS and expecting that to stop it',
        'Ignoring upstream work that cancelled streams still trigger',
      ],
    },
    {
      id: 'misc-web-auth-iq-05',
      difficulty: 'medium',
      question: 'Why is QUIC built on top of UDP instead of being a new transport protocol next to TCP, and what does that choice cost you operationally?',
      whatInterviewerLooksFor: [
        'Explains protocol ossification by middleboxes and kernel release cycles',
        'Knows QUIC lives in user space and encrypts almost all of its headers to avoid future ossification',
        'Names operational costs: UDP blocking, CPU, load-balancer affinity, observability',
      ],
      modelAnswer: `**Why UDP:**
- **Middleboxes:** firewalls, NATs and corporate proxies drop anything that isn't TCP or UDP. A new IP protocol number (like SCTP) would be unreachable for a large share of users.
- **Kernel ossification:** TCP changes ship in OS kernels; getting a new TCP feature to most phones takes years. QUIC runs in user space, so Chrome or your server can ship congestion-control changes in weeks.
- **Anti-ossification by design:** QUIC encrypts almost all transport headers, so middleboxes can't start depending on fields and freeze the protocol again.

**What you get:** TLS 1.3 built in (1-RTT new, 0-RTT resumed), per-stream loss recovery, connection migration via connection IDs.

**Operational costs:**
- **UDP 443 is blocked** on some corporate and campus networks (single-digit percent of clients); you must keep HTTP/2 over TCP as a fallback.
- **CPU:** user-space crypto and per-packet syscalls, and weaker NIC offload for UDP, often cost more CPU per byte than kernel TCP + TLS; GSO/GRO helps.
- **Load balancing:** L4 balancers that hash the 5-tuple break connection migration; you need connection-ID-aware routing.
- **Observability:** encrypted headers mean tcpdump and middlebox tools can't see RTT or retransmits; you rely on endpoint stats (qlog).
- **DDoS surface:** UDP amplification controls (QUIC limits its responses to 3× the bytes received before validating the client address, plus Retry packets).`,
      followUps: [
        { q: 'Would you use QUIC for service-to-service calls in one DC?', a: 'Rarely. Loss and RTT are tiny, TCP is kernel-optimized and tooling is mature; the wins are at the lossy, high-RTT last mile.' },
        { q: 'How does a server learn that a client supports HTTP/3?', a: 'It doesn\'t need to: the server advertises HTTP/3 via Alt-Svc or an HTTPS DNS record, and the client decides to try QUIC.' },
      ],
      pitfalls: [
        'Saying UDP is used because it is "faster" than TCP',
        'Forgetting the TCP fallback requirement',
      ],
    },
    {
      id: 'misc-web-auth-iq-06',
      difficulty: 'expert',
      question:
        'You enabled HTTP/3 on the CDN for our Indian consumer app. Leadership wants proof it helped before paying for it on the origin tier too. Design the rollout and measurement: what exactly do you measure, how do you avoid fooling yourself, and what would make you roll back?',
      whatInterviewerLooksFor: [
        'Understands discovery (Alt-Svc/HTTPS RR) so first requests are not HTTP/3 and cohorts are messy',
        'Designs a proper A/B split with client-side RUM segmented by network type',
        'Measures fallback/failure rates and server CPU, not just latency',
        'States explicit rollback criteria',
      ],
      modelAnswer: `**Why naive measurement lies:** a client uses HTTP/3 only after it has learned the Alt-Svc (from an earlier HTTP/2 response) or the HTTPS DNS record, and only if UDP isn't blocked. Comparing "HTTP/3 requests vs HTTP/2 requests" compares repeat visitors on good networks with everyone else — selection bias.

**Rollout design:**
- Randomize by **user or install ID**, not request: 50% of users get the Alt-Svc header / h3-capable client config, 50% don't. Compare the cohorts as a whole (intent-to-treat), including users whose QUIC attempts fall back.
- Ramp 1% → 10% → 50% over two weeks to catch breakage.

**What to measure (client-side RUM):**
- p50/p75/p95 of time-to-first-byte and full API latency, and app-level metrics (home-screen render time, checkout completion).
- Segment by network type (4G, 5G, Wi-Fi), by ISP (Jio, Airtel, Vi), and by device tier. Gains show up mostly at the tail on lossy 4G; expect little change on good Wi-Fi.
- Connection migration wins: requests that survive a Wi-Fi ↔ cellular switch.

**Guardrails:**
- QUIC handshake failure and fallback rate per ISP; a network that silently drops UDP after a few seconds hurts more than one that blocks it outright.
- Error rate and retry rate (0-RTT rejections, 425 responses).
- Edge CPU per GB served — often noticeably higher for QUIC.

**Rollback criteria:** treatment cohort p95 worse by more than 5% on any major ISP, error rate +0.1 pp, or conversion down with statistical significance.

**Origin decision:** QUIC's win is on the lossy last mile; CDN-to-origin is usually a clean backbone, so HTTP/3 to origin rarely pays unless origin is reached directly by clients.`,
      followUps: [
        { q: 'How do you get HTTP/3 on the very first request?', a: 'Publish an HTTPS (type 65) DNS record with alpn=h3; modern browsers can then race QUIC from the first connection.' },
        { q: 'One ISP shows p95 got worse. What would you check?', a: 'UDP throttling or NAT rebinding on that carrier: look at QUIC handshake timeouts and fallback delay, then disable h3 for that ASN at the edge.' },
      ],
      pitfalls: [
        'Comparing per-request protocol metrics without randomization',
        'Looking only at averages instead of tails and network segments',
        'Ignoring CPU cost and fallback failure modes',
      ],
    },
    {
      id: 'misc-web-auth-iq-07',
      difficulty: 'medium',
      question:
        'Walk me through how api.example.com gets resolved from a cold cache. Then tell me every place the answer gets cached, and one way caching can bite you even for a record that did not exist yet.',
      whatInterviewerLooksFor: [
        'Correct recursive walk: stub → recursive resolver → root → TLD → authoritative',
        'Lists caches: browser, OS, runtime/sidecar, recursive resolver',
        'Knows negative caching (NXDOMAIN) and the SOA minimum',
      ],
      modelAnswer: `**Cold resolution:**
1. The app calls getaddrinfo; the OS stub checks /etc/hosts and its cache, then asks the configured recursive resolver (ISP, 8.8.8.8, or CoreDNS inside k8s).
2. The recursor asks a **root** server: "try the .com TLD servers" (a referral with NS records).
3. It asks a **.com TLD** server: "example.com is served by ns1.dnsprovider.net".
4. It asks the **authoritative** server, which returns the A/AAAA record (or a CNAME to follow) with a TTL.
Cold cost: 50–200 ms; warm cache: under 1 ms locally, 5–30 ms to an ISP resolver.

**Where it's cached:**
- Browser DNS cache (short-lived, typically up to about a minute).
- OS cache (systemd-resolved, mDNSResponder).
- Runtime: the JVM caches (30 s by default without a security manager); Node does not cache at all.
- Node-local caches or sidecars in k8s (NodeLocal DNSCache).
- The recursive resolver, for the record TTL — referral records for root/TLD are cached for days.

**The trap — negative caching:** if anything queries api-v2.example.com *before* you create it, resolvers cache the NXDOMAIN for min(SOA record TTL, SOA MINIMUM field), often 300–3,600 s. A deploy script that health-checks a new hostname before creating its record can make it "not exist" for an hour after creation. Fix: create records before anyone queries them, and keep the SOA negative TTL modest (60–300 s).`,
      followUps: [
        { q: 'What is the difference between a CNAME and an ALIAS record?', a: 'A CNAME redirects resolution to another name and can\'t live at the zone apex; ALIAS/flattening is a provider feature that resolves the target server-side and returns A records, so it works at the apex.' },
        { q: 'When does DNS switch from UDP to TCP?', a: 'When a response is too large for the UDP payload size (512 bytes classic, ~1,232 recommended with EDNS0) the server sets the truncation bit and the client retries over TCP; zone transfers use TCP too.' },
      ],
      pitfalls: [
        'Saying the browser asks the root servers directly',
        'Assuming TTLs are respected uniformly by every cache',
        'Not knowing NXDOMAIN is cached',
      ],
    },
    {
      id: 'misc-web-auth-iq-08',
      difficulty: 'expert',
      question:
        'A security researcher reports they are serving their own content on promo.example.com, a campaign site we shut down last year. How did this happen, what is the blast radius given our cookie and CORS setup, and how do you stop it from happening again across 2,000 DNS records?',
      whatInterviewerLooksFor: [
        'Recognises subdomain takeover via a dangling CNAME to a deprovisioned cloud resource',
        'Connects blast radius to Domain-scoped cookies, same-site status, CORS allow-lists and CSP',
        'Proposes inventory, automated dangling-record detection and deprovisioning order',
        'Treats it as an incident: rotate sessions if cookies were exposed',
      ],
      modelAnswer: `**How it happened — subdomain takeover:**
- promo.example.com is a CNAME to something like promo-2024.s3-website.amazonaws.com, a Heroku app or an Azure app service.
- The resource was deleted, but the DNS record was not. Those provider names are first-come-first-served, so the researcher created a resource with the same name and now controls the content.

**Blast radius — this is where it gets serious:**
- **Cookies:** if the session cookie is set with Domain=example.com, every request to promo.example.com carries it; attacker JavaScript can't read HttpOnly cookies, but their server receives them in the request. They can also *set* cookies for .example.com (cookie tossing), enabling session fixation on the main app.
- **SameSite:** promo.example.com is **same-site** with app.example.com, so SameSite gives zero CSRF protection against it.
- **CORS:** allow-lists like "*.example.com" with credentials let their page call your APIs as the logged-in user.
- **Phishing/OAuth:** a trusted-looking hostname; worse if it is in an OAuth redirect_uri allow-list or CSP.

**Immediate response:** delete the record (the provider can't give it back), rotate sessions if Domain-scoped cookies could have been sent there, audit logs for API calls with Origin promo.example.com.

**Prevention at 2,000 records:**
- Deprovision in the right order: DNS first, then the resource.
- DNS as code (Terraform/external-dns) tied to the resource lifecycle.
- A daily scanner: resolve every CNAME, flag targets that return NXDOMAIN or provider "no such bucket/app" fingerprints.
- Host-only cookies with the __Host- prefix; exact-origin CORS allow-lists; vendor-hosted sites on a separate registrable domain (example-promo.com).`,
      followUps: [
        { q: 'Why does a separate registrable domain help so much?', a: 'Cookies, SameSite and many CORS rules key on the registrable domain; a different eTLD+1 is cross-site, so a takeover there cannot ride or toss your cookies.' },
        { q: 'Can NS delegations be taken over too?', a: 'Yes, and worse: a subdomain delegated to a DNS provider zone that was deleted lets an attacker recreate the zone and control every record under it.' },
      ],
      pitfalls: [
        'Blaming a DNS server compromise instead of a dangling record',
        'Assuming SameSite protects against a sibling subdomain',
        'Fixing the one record without systematic detection',
      ],
    },
    {
      id: 'misc-web-auth-iq-09',
      difficulty: 'medium',
      question:
        'How does a WebSocket connection actually get established, and why does it work when you hit the Node server directly but fail with a 400 or silently hang behind our nginx and ALB?',
      whatInterviewerLooksFor: [
        'Knows the Upgrade handshake, 101 status and Sec-WebSocket-Key/Accept',
        'Knows Upgrade/Connection are hop-by-hop and must be explicitly forwarded by nginx',
        'Mentions HTTP/1.1 requirement to upstream and idle timeouts',
      ],
      modelAnswer: `**Handshake:**
- The client sends an HTTP/1.1 GET with Upgrade: websocket, Connection: Upgrade, Sec-WebSocket-Version: 13 and a random Sec-WebSocket-Key.
- The server replies 101 Switching Protocols with Sec-WebSocket-Accept = base64(SHA-1(key + a fixed GUID)), proving it understood the upgrade (not for security).
- After that the TCP socket carries WebSocket frames both ways; the HTTP exchange is over.

**Why proxies break it:**
- **Hop-by-hop headers:** Upgrade and Connection apply to one hop, so nginx strips them by default. You need proxy_http_version 1.1, proxy_set_header Upgrade $http_upgrade and proxy_set_header Connection "upgrade". Without them the backend sees a plain GET and returns 400/426.
- **HTTP version:** nginx speaks HTTP/1.0 to upstreams by default, which can't upgrade.
- **Idle timeouts:** nginx proxy_read_timeout and the ALB idle timeout both default to 60 s; a quiet socket gets closed. Send pings every 20–30 s or raise the timeouts.
- **Buffering/inspection:** some corporate proxies don't support upgrades on port 80 at all — another reason to use wss:// on 443, where the proxy only sees an encrypted tunnel.

**ALB specifics:** it supports WebSockets natively, but target health checks and deregistration delay matter: during deploys, connections are cut after the delay, so clients must reconnect with jittered backoff.`,
      followUps: [
        { q: 'Is the Sec-WebSocket-Key a security mechanism?', a: 'No. It stops caching proxies and non-WebSocket servers from accidentally accepting the upgrade; authentication must be done separately.' },
        { q: 'Why are client-to-server frames masked?', a: 'To prevent cache-poisoning attacks on transparent proxies that might interpret attacker-controlled bytes as HTTP; masking makes payload bytes unpredictable on the wire.' },
      ],
      pitfalls: [
        'Thinking WebSockets are a separate protocol that bypasses HTTP entirely',
        'Not knowing about hop-by-hop headers',
      ],
    },
    {
      id: 'misc-web-auth-iq-10',
      difficulty: 'expert',
      question:
        'Our trading app authenticates WebSocket connections with a 15-minute JWT at connect time. Connections stay open for a full trading day. Compliance asks: if we suspend an account or revoke a role at 11:02, how quickly does that user stop receiving data and placing orders over the socket? Design it.',
      whatInterviewerLooksFor: [
        'Recognises that connect-time auth goes stale; tokens expiring does not close sockets',
        'Proposes in-band re-authentication and server-pushed revocation',
        'Separates read (streaming) authorization from write (order) authorization',
        'Quantifies the revocation latency and handles scale (fan-out of revocation events)',
      ],
      modelAnswer: `**The problem:** the JWT was checked once at the handshake. Its expiry at 11:15 means nothing to an open socket; without extra work a suspended user streams data until they disconnect — possibly hours.

**Design:**
1. **Connection context:** on connect, the gateway stores {userId, sessionId, tokenExp, scopes} per socket and registers the socket in a userId → sockets map.
2. **Revocation push (seconds):** the identity service publishes "user U revoked" or "roles changed" events to a pub/sub topic (Redis pub/sub, NATS, Kafka). Every gateway subscribes and, for local sockets of U, either closes them with a policy-violation code (1008) or downgrades their subscriptions. Target: revocation reaches every gateway in under 2 seconds.
3. **In-band re-auth (minutes):** the client must send a fresh access token over the socket before tokenExp (for example, at 12 min). If it doesn't, the server closes the socket. This bounds staleness even if an event is lost.
4. **Per-message authorization for writes:** order placement over the socket is checked on every message against current permissions (cached for a few seconds), never against connect-time scopes. Reads can rely on subscription-level checks.
5. **Subscription re-check:** when roles change, re-evaluate each channel subscription (a user who lost access to the F&O segment is unsubscribed).

**Numbers:** with 500K sockets over 50 gateways, a revocation event is one pub/sub message delivered to 50 subscribers — trivial. The re-auth traffic is 500K / 12 min ≈ 700 messages/s — also trivial.

**Answer to compliance:** writes are blocked within the permission-cache TTL (say 5 s); streaming stops within about 2 s via push, and in the worst case (lost event) by the next re-auth deadline, at most 15 minutes.`,
      followUps: [
        { q: 'What if the pub/sub layer is down?', a: 'Re-auth deadlines still bound staleness to the token lifetime, and order writes still hit the live permission check; alert on revocation-event lag.' },
        { q: 'Why not re-validate the JWT on every incoming message?', a: 'It only re-checks the same stale token; the signature stays valid until exp. You need current state (revocation list or permission service), not the token.' },
      ],
      pitfalls: [
        'Assuming the socket dies when the token expires',
        'Closing all sockets on every role change instead of targeted handling',
        'No bound on staleness when the revocation event is lost',
      ],
    },
    {
      id: 'misc-web-auth-iq-11',
      difficulty: 'medium',
      question:
        'What does SSE give you for free that you would have to hand-build on WebSockets, and what are its hard limits that should make you pick something else?',
      whatInterviewerLooksFor: [
        'Lists auto-reconnect, Last-Event-ID resumption, retry hints and plain-HTTP compatibility',
        'Names the limits: one-way, GET only, no custom headers in EventSource, text only, HTTP/1.1 connection cap',
        'Gives a clear decision rule',
      ],
      modelAnswer: `**Free with SSE:**
- **Reconnect:** EventSource reconnects automatically after a drop, with a server-controlled delay via the retry: field.
- **Resumption:** it sends the last received id: back as the Last-Event-ID header, so the server can replay missed events — if it keeps a log.
- **Plain HTTP:** it is just a long GET response, so it works through CDNs, API gateways, HTTP/2 multiplexing, standard auth cookies, and logging. No upgrade handshake, no special load-balancer config.
- **Event types:** event: names route messages to different listeners.
- On WebSockets you build all of that — reconnect backoff, sequence numbers, replay protocol, heartbeats — yourself or via a library like Socket.IO.

**Hard limits:**
- **One-way.** Client → server messages go over separate HTTP requests. Fine for notifications and LLM token streams; awkward for chat typing indicators or games at 20+ messages/s from the client.
- **EventSource can't set headers** (no Authorization) and is GET-only; use cookies or a fetch()-based reader.
- **Text only** — binary must be base64 (+33%).
- **HTTP/1.1 connection cap:** ~6 per origin per browser, shared across tabs. With HTTP/2 this goes away (one stream each).
- **Buffering intermediaries** can batch events unless you disable buffering and compression on that route.

**Decision rule:** server-to-client push with modest client-to-server traffic → SSE. High-frequency bidirectional or binary → WebSockets.`,
      followUps: [
        { q: 'How would you implement heartbeats in SSE?', a: 'Write a comment line such as ": ping" every 15–30 s; clients ignore it, but it keeps intermediaries from timing out and detects dead connections server-side.' },
        { q: 'Why do most LLM APIs use SSE?', a: 'Token streaming is one-way, request-scoped and fits naturally as a streamed HTTP response on the same POST; tooling, auth and gateways all keep working.' },
      ],
      pitfalls: [
        'Claiming SSE needs a special protocol or port',
        'Forgetting that resumption requires server-side event retention',
      ],
    },
    {
      id: 'misc-web-auth-iq-12',
      difficulty: 'hard',
      question:
        'Our order-status page uses SSE. It is flawless in staging, but in production enterprise customers report updates arriving in bursts 30–60 seconds late, and some connections drop every 30 seconds and reconnect. Nothing is wrong in our server logs. How do you debug and harden this?',
      whatInterviewerLooksFor: [
        'Suspects buffering intermediaries: corporate proxies, antivirus, CDN, compression, nginx',
        'Uses controlled experiments to find the layer (direct vs CDN, per-customer, curl -N)',
        'Hardening: heartbeats, anti-buffering headers, HTTPS, fallback to long-polling',
        'Makes reconnects cheap and lossless with Last-Event-ID and a replay log',
      ],
      modelAnswer: `**Hypothesis:** something between the server and the browser buffers the response until it has "enough" bytes or the response ends, and some middlebox kills idle-looking connections at 30 s. Staging has no corporate proxy, no antivirus TLS inspection and maybe no CDN.

**Find the layer:**
- curl -N against origin, then the CDN, from our network: if both stream, the problem is on the customer side.
- Ask an affected customer for a HAR file; check the response headers for Via or proxy signatures and whether the TLS certificate is our own (if not, a TLS-inspecting proxy is re-terminating).
- Correlate by customer ASN; the pattern is usually a handful of enterprises with Zscaler/Bluecoat-style proxies.

**Harden our side:**
- Send Cache-Control: no-cache, no-transform and X-Accel-Buffering: no; disable gzip on this route (compressors buffer to fill blocks); flush after each event.
- Heartbeat comment every 15 s — stops the 30 s idle killer and gives buffers bytes to flush on some proxies.
- Serve over HTTPS only; plain HTTP streams are the ones inspected and buffered most.
- Verify CDN streaming mode is enabled for text/event-stream.

**Make reconnects harmless:**
- Put an id: on every event, keep the last few minutes of events per order in Redis Streams, and replay from Last-Event-ID on reconnect.
- Send retry: 3000 so reconnect storms are paced.

**Fallback:** if a client sees no events or heartbeats within 2× the heartbeat interval, switch that client to long-polling (30 s hold). Socket.IO and similar libraries automate this downgrade; with raw SSE you implement it in about 50 lines.`,
      followUps: [
        { q: 'Would switching to WebSockets fix it?', a: 'Sometimes — wss:// through a TLS tunnel avoids inspection — but TLS-inspecting proxies can break WebSockets too; long-polling is the universally safe fallback.' },
        { q: 'How do you avoid duplicate events after replay?', a: 'Make events idempotent on the client: keep the last applied id per order and ignore anything at or below it.' },
      ],
      pitfalls: [
        'Blaming the server because staging works',
        'Adding more server capacity for what is a buffering issue',
        'Relying on reconnect without replay from Last-Event-ID',
      ],
    },
    {
      id: 'misc-web-auth-iq-13',
      difficulty: 'medium',
      question:
        'We are building a B2B SaaS dashboard: a React web app served from our own domain, a NestJS backend, about 50K users. Server-side sessions or JWTs — which would you pick and why? Defend it against the "JWT scales better" argument.',
      whatInterviewerLooksFor: [
        'Chooses based on requirements (revocation, admin controls, one first-party web client)',
        'Quantifies session-store cost to dismiss the scaling argument',
        'Knows when JWT genuinely wins (many services, third-party APIs, mobile, cross-domain)',
      ],
      modelAnswer: `**Pick: server-side sessions in an HttpOnly cookie, stored in Redis.**

**Why it fits this product:**
- **Revocation is a real requirement in B2B:** admins deprovision employees, enforce SSO logout, and security wants "kill all sessions for tenant X". With sessions that's a DELETE; with JWTs it's a denylist you'd build anyway.
- **One first-party browser client on the same site:** cookies just work, with SameSite=Lax, HttpOnly and no token handling in JavaScript, so XSS can't exfiltrate a credential.
- **Visibility:** "active devices", idle timeouts and forced re-auth for sensitive actions are trivial.

**The "JWT scales better" argument, quantified:**
- 50K users, maybe 10K concurrently active, 20 requests/min each ≈ 3.3K lookups/s. A single Redis node does 100K+ ops/s at sub-millisecond latency. Memory: 50K sessions × 1 KB = 50 MB.
- Even at 50M users, a small Redis cluster handles it. The lookup is not the bottleneck; your database is.

**When I'd switch to JWTs:**
- Many internal services need identity without calling back (use JWTs *internally*, minted at the gateway from the session — the "phantom token" pattern).
- Third-party developers or native mobile apps calling public APIs.
- Cross-domain or cross-region setups where a shared session store is impractical.

**Common hybrid:** session cookie at the edge/BFF, short-lived JWT between services.`,
      followUps: [
        { q: 'What does the phantom token pattern give you?', a: 'Clients hold an opaque, revocable reference; the gateway swaps it for a short-lived JWT for internal hops, so services verify locally and revocation stays central.' },
        { q: 'How do you protect cookie sessions from CSRF?', a: 'SameSite=Lax or Strict, no state change on GET, plus a CSRF token or custom-header check for older browsers and same-site subdomains.' },
      ],
      pitfalls: [
        'Claiming sessions do not scale without doing the arithmetic',
        'Storing a JWT in localStorage "because stateless"',
        'Ignoring revocation requirements',
      ],
    },
    {
      id: 'misc-web-auth-iq-14',
      difficulty: 'hard',
      question:
        'Design session management for a consumer app with 20M monthly users on web and mobile: device list, "log out of all devices", 30-day remember-me, step-up auth for payments, and it must survive a Redis primary failure without logging everyone out.',
      whatInterviewerLooksFor: [
        'Data model supporting per-user session index and per-session metadata',
        'Idle vs absolute timeouts and step-up freshness (auth_time)',
        'Write-amplification control for sliding expiry',
        'Failure handling: replication, persistence, graceful degradation',
      ],
      modelAnswer: `**Data model (Redis):**
- sess:{sid} → hash {userId, deviceName, ip, createdAt, lastSeen, authTime, mfaAt}, with TTL = idle timeout.
- user-sess:{userId} → set of sids, for the device list and logout-all.
- sid = 256-bit random value, sent in a __Host- cookie on web; mobile gets the same opaque ID via a secure header, stored in Keychain/Keystore.

**Lifetimes:**
- Idle timeout 30 days for remember-me, 12 h otherwise; absolute cap 90 days (createdAt check) — then full login.
- **Throttled sliding:** update lastSeen and EXPIRE at most once every 5 minutes per session, not per request. 2M daily actives × 200 requests/day ≈ 4.6K req/s would mean 4.6K writes/s; with a 5-minute throttle and ~30 active minutes per user per day it is 2M × 6 ÷ 86,400 ≈ 140 writes/s.

**Step-up for payments:** require authTime or mfaAt within the last 10 minutes; otherwise return 401 with an insufficient-freshness error, the client re-prompts (biometric on mobile), and the server records mfaAt and regenerates the sid, because privilege just rose (same rule as login).

**Logout-all:** SMEMBERS user-sess:{uid}, DEL each, DEL the set — in a Lua script or pipeline. Also bump a per-user sessionVersion so any downstream cache of the session is invalid.

**Sizing:** 20M users × ~1.5 devices × ~400 B ≈ 12 GB plus overhead → ~20 GB; a 3-shard cluster with a replica per shard.

**Surviving failure:**
- Replica per shard with automatic failover (Redis Cluster or Sentinel); AOF everysec so a restart loses at most about 1 s of new sessions.
- Replication is async: sessions created in the last second before failover may vanish — acceptable (user logs in again).
- If Redis is fully unavailable, fail closed for payments, and optionally allow read-only browsing via a short-lived signed fallback cookie. Decide that explicitly with security.`,
      followUps: [
        { q: 'Why not store sessions in Postgres?', a: 'You can — 5K reads/s is fine with an index — but Redis TTLs give free expiry and sub-ms latency; many teams keep Postgres as the durable record and Redis as the hot cache.' },
        { q: 'How do you show "last active from Mumbai, Chrome on Android"?', a: 'Store coarse geo from IP and a parsed user-agent at login and on throttled touches; never show the raw IP to other users.' },
      ],
      pitfalls: [
        'Writing to the store on every request',
        'No absolute timeout for remember-me',
        'Forgetting the per-user index, making logout-all a KEYS scan',
      ],
    },
    {
      id: 'misc-web-auth-iq-15',
      difficulty: 'medium',
      question: 'Write out the Set-Cookie header you would use for a session cookie on app.example.com and justify every attribute — and every attribute you deliberately left out.',
      whatInterviewerLooksFor: [
        'Uses __Host- prefix, HttpOnly, Secure, SameSite, Path=/ and no Domain',
        'Explains SameSite choice and browser default differences',
        'Explains why Domain is omitted and what Max-Age means for session vs persistent cookies',
      ],
      modelAnswer: `**Header:**
Set-Cookie: __Host-sid=q3V...Zk; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200

**Why each attribute:**
- **__Host- prefix:** the browser only accepts the cookie if it is Secure, has Path=/ and has *no* Domain. That prevents a sibling subdomain or an HTTP page from setting or overwriting it (cookie tossing).
- **Secure:** never sent over plain HTTP, so it can't leak on a downgraded or mixed-content request.
- **HttpOnly:** JavaScript can't read it, so an XSS bug can't exfiltrate the session (it can still make requests while the page is open — HttpOnly limits damage, it doesn't prevent XSS).
- **SameSite=Lax:** not sent on cross-site subrequests or POSTs, so classic CSRF fails; still sent on top-level GET navigations so links from email work. I set it explicitly because Firefox and Safari do not default to Lax. Strict would break arriving via a link (user appears logged out on the first page).
- **Max-Age=43200 (12 h):** a persistent cookie aligned with the server-side absolute timeout. The server still enforces expiry; the cookie lifetime is only a hint.

**Deliberately omitted:**
- **Domain:** omitting it makes the cookie host-only, so marketing.example.com or a taken-over subdomain never receives it.
- **Partitioned:** only for third-party embedded contexts.

**Value:** at least 128 bits of randomness, opaque, no user data in it.`,
      followUps: [
        { q: 'When would you use SameSite=None?', a: 'Only when the cookie must be sent in a cross-site context (your app embedded in a customer\'s site, or a cross-site IdP flow); it requires Secure and then needs CSRF tokens.' },
        { q: 'Does HttpOnly stop CSRF?', a: 'No. CSRF never needs to read the cookie; the browser attaches it. SameSite and CSRF tokens address CSRF.' },
      ],
      pitfalls: [
        'Setting Domain=.example.com "so all subdomains work"',
        'Believing HttpOnly prevents XSS',
        'Relying on the browser default for SameSite',
      ],
    },
    {
      id: 'misc-web-auth-iq-16',
      difficulty: 'expert',
      question:
        'Our analytics widget runs in an iframe on 3,000 customer websites and needs to know which of our logged-in users is viewing it. After a Safari update, and in Firefox, users look logged out inside the iframe even though they are logged in on our main site. Explain why, and design the auth for the embedded context.',
      whatInterviewerLooksFor: [
        'Recognises third-party cookie blocking (Safari ITP, Firefox Total Cookie Protection) and SameSite=None requirements',
        'Knows CHIPS (Partitioned) and why partitioned cookies do not share the top-level login',
        'Proposes Storage Access API and/or a token-based handoff with postMessage',
        'Covers security: frame-ancestors, origin checks, token audience',
      ],
      modelAnswer: `**Why it broke:**
- Inside customer.com, the iframe from widget.ourco.com is a **third-party context**. Our session cookie is SameSite=Lax (not sent in cross-site subrequests at all), and even SameSite=None; Secure cookies are blocked or partitioned by Safari's ITP and Firefox's Total Cookie Protection. Chrome still allows them by default today, but you can't build on that.
- Partitioned storage means the iframe gets a separate cookie jar keyed by (customer.com, ourco.com) — which is empty, because the user logged in on ourco.com as a first party.

**Design options:**
1. **Storage Access API:** the iframe calls document.requestStorageAccess() after a user click; the browser (with a prompt in some cases) grants access to the unpartitioned first-party cookies. Best UX when it works; requires a user gesture and has browser-specific heuristics.
2. **Token handoff via popup:** a "Connect" button opens a first-party popup to ourco.com (where the session cookie works), which mints a short-lived, audience-scoped token (aud=widget, 5 min, bound to the customer origin) and posts it to the iframe with window.opener.postMessage, checking the exact target origin. The iframe keeps it in memory and refreshes via a partitioned cookie.
3. **CHIPS (Partitioned cookies):** Set-Cookie with Secure; SameSite=None; Partitioned lets the widget keep its *own* session per embedding site after option 1 or 2 — useful so users don't reconnect on every page view.

**Security controls:**
- Content-Security-Policy frame-ancestors listing each customer's domains (per-tenant allow-list) to prevent clickjacking on unknown sites.
- The widget token grants read-only widget scopes, never the full session.
- Validate event.origin on every postMessage; never use "*" as a target origin.

**What I'd tell product:** silent cross-site login is going away on purpose; plan for one user gesture per embedding site.`,
      followUps: [
        { q: 'Why not put our session token in the iframe URL?', a: 'It leaks into customer logs, Referer and history, and the customer\'s page scripts can read the iframe src; it hands them a full session.' },
        { q: 'Would moving the widget to a customer subdomain via CNAME help?', a: 'It makes cookies first-party to the customer, not to us — our main-site login still would not be visible, and it adds the takeover and cookie-scoping risks of sharing their domain.' },
      ],
      pitfalls: [
        'Setting SameSite=None and assuming it works everywhere',
        'Not understanding cookie partitioning',
        'Using postMessage without origin checks',
      ],
    },
    {
      id: 'misc-web-auth-iq-17',
      difficulty: 'medium',
      question:
        'A user tells support: "I changed my password after seeing a strange login, but the attacker was still active in my account an hour later." We use 1-hour JWT access tokens and 30-day refresh tokens. Explain how that is possible and what you change.',
      whatInterviewerLooksFor: [
        'Explains that password change does not invalidate already-issued JWTs or refresh tokens by default',
        'Proposes revoking refresh-token families and a per-user valid-after or token version',
        'Shortens access-token lifetime and weighs the cost',
      ],
      modelAnswer: `**How it happened:**
- The attacker already had an access token (valid up to 1 hour) and probably a refresh token (valid 30 days).
- A password change updates the password hash; it doesn't touch tokens. JWTs are verified by signature and exp only, so every service keeps accepting the attacker's token, and the refresh endpoint happily mints new ones.

**Fixes, in order of impact:**
1. **Revoke refresh tokens on password change, MFA reset and "log out everywhere":** delete or mark revoked every refresh-token family for the user (optionally except the current device). This stops new access tokens immediately.
2. **Kill outstanding access tokens:** store a per-user tokensValidAfter timestamp (or tokenVersion) in Redis; services reject tokens whose iat is before it. That is one cached lookup per request (sub-ms, or cached in-process for 30 s), and it's the standard trade for revocation.
3. **Shorten access tokens to 5–15 minutes.** Even without the check, that caps attacker time after refresh revocation. Cost: 4–12× more refresh calls, still cheap.
4. **Notify and step up:** email the user on password change with a "this wasn't me" link, and require re-auth for sensitive actions (payout details, email change), based on auth_time.

**Result:** the attacker is cut off within seconds (valid-after check) or at worst within the access TTL (5–15 min).`,
      followUps: [
        { q: 'Should password change log out the user\'s other devices?', a: 'Default yes for security-motivated changes; offer "keep this device" for the current session and require re-login elsewhere.' },
        { q: 'Why iat and not a list of token IDs?', a: 'A per-user timestamp is O(1) per user and invalidates every older token at once; a jti denylist grows with every token issued.' },
      ],
      pitfalls: [
        'Saying "JWTs can\'t be revoked, nothing to do"',
        'Forgetting the refresh token is the long-lived problem',
        'Proposing a DB lookup per request without caching or discussing the trade-off',
      ],
    },
    {
      id: 'misc-web-auth-iq-18',
      difficulty: 'expert',
      question:
        'Forty services verify JWTs from our auth service. Security just told you the private signing key may have been exposed in a leaked CI log two hours ago. Walk me through the emergency response and then the key-management design that would make this a non-event next time.',
      whatInterviewerLooksFor: [
        'Understands that a leaked private key allows minting arbitrary valid tokens, so the key must be removed from JWKS',
        'Plans the rotation order: new key published, signing switched, old key removed, caches flushed',
        'Addresses JWKS caching in 40 services and forced re-login implications',
        'Designs KMS/HSM signing, kid, overlap windows and alg pinning',
      ],
      modelAnswer: `**Why it's severe:** with the private key, an attacker can mint tokens for any sub, any scope, any exp. Signature checks pass everywhere. Short access TTLs don't help — they mint fresh ones.

**Emergency response (target: under 1 hour):**
1. Generate key K2 in KMS; publish JWKS = {K2} only — **remove K1**. Normally you overlap keys; with a compromise you accept breaking tokens signed by K1.
2. Switch the auth service to sign with K2.
3. **Flush JWKS caches**: services typically cache JWKS for 5–60 min. Trigger a config push/restart or hit an admin endpoint that clears the cache; otherwise K1 tokens keep verifying until TTL.
4. Everyone's access tokens are now invalid. Clients hit 401, call refresh — refresh tokens are opaque and DB-backed (not signed by K1), so they still work and users re-obtain K2 tokens without a login. If refresh tokens were JWTs signed with K1, everyone logs in again.
5. Forensics: search logs for tokens with kid=K1 issued outside the auth service's own issuance records (every issuance logged by jti), and for unusual subjects/scopes.

**Design for next time:**
- **Private keys never leave KMS/HSM**: the auth service calls KMS Sign; there's nothing to leak into CI logs.
- **Scheduled rotation** every 30–90 days: publish K(n+1) in JWKS at least one cache TTL before signing with it; remove K(n) after max token lifetime + cache TTL.
- **kid on every token**; verifiers pick the key by kid and refetch JWKS on an unknown kid (rate-limited, e.g. once per 30 s).
- **Pinned algorithms** (ES256 only) and pinned issuer and audience per service.
- **A tested "compromise runbook"** and a JWKS cache-invalidation hook in the shared auth library, so step 3 is one command.`,
      followUps: [
        { q: 'Why not just add the leaked kid to a denylist?', a: 'That works if every verifier checks it, but removing the key from JWKS plus a cache flush achieves the same with no new code path; denylist-by-kid is a fallback for services you cannot flush quickly.' },
        { q: 'Symmetric HS256 shared by 40 services — what changes?', a: 'Every service could mint tokens, and a leak from any of them is a compromise; asymmetric keys make verifiers unable to issue, which is why HS256 is wrong for this topology.' },
      ],
      pitfalls: [
        'Keeping the old key in JWKS for the normal overlap window during a compromise',
        'Forgetting JWKS caches in verifiers',
        'Thinking short access-token TTLs contain a signing-key leak',
      ],
    },
    {
      id: 'misc-web-auth-iq-19',
      difficulty: 'medium',
      question: 'Why do we use two tokens at all? Why not just issue a single 30-day access token and skip the refresh dance?',
      whatInterviewerLooksFor: [
        'Explains exposure differences: access tokens go to many services and logs; refresh tokens only to the AS',
        'Explains revocation: refresh is the checkpoint where state is consulted',
        'Mentions rotation, sender-constraining and RFC 9700',
      ],
      modelAnswer: `**The core idea: split "cheap to verify everywhere" from "revocable".**

**Access token:**
- Sent on every request to many APIs, through gateways, proxies, logs, APM tools and sometimes third-party services. High exposure.
- Verified locally with no database lookup — that's the performance win — which also means it can't be revoked cheaply.
- So it must be short-lived (5–15 min): if it leaks, it's worthless soon.

**Refresh token:**
- Sent only to the authorization server's token endpoint, over one path. Low exposure.
- Checked against server-side state on every use: is the user still active, was the family revoked, did the password change, is the device still trusted? This is where revocation, risk checks and policy changes take effect — every 15 minutes rather than never.

**With a single 30-day token:** a leak from any log line gives 30 days of access, a fired employee keeps access, and role changes don't apply until expiry — unless you add a lookup on every request, which removes the reason for self-contained tokens.

**Hardening the refresh token:**
- Rotation on every use with reuse detection, or sender-constraining with DPoP/mTLS — RFC 9700 (January 2025) requires one of the two for public clients such as SPAs and mobile apps.
- Absolute lifetime for the family (for example 30–90 days).

**Cost:** one extra call per ~15 minutes per active client.`,
      followUps: [
        { q: 'Does a confidential server-side client need refresh-token rotation?', a: 'It is not required by RFC 9700 because the refresh token is bound to the client\'s credentials, but rotation is still a cheap defence-in-depth.' },
        { q: 'How short can the access token be?', a: 'Practically 5 minutes; below that, refresh traffic and clock-skew failures grow faster than the security benefit.' },
      ],
      pitfalls: [
        'Saying refresh tokens exist "for performance"',
        'Treating the refresh token as just another longer-lived access token sent to APIs',
      ],
    },
    {
      id: 'misc-web-auth-iq-20',
      difficulty: 'expert',
      question:
        'After enabling refresh-token rotation with reuse detection, about 0.8% of mobile users per day are force-logged-out and support is flooded. Security refuses to turn detection off. Diagnose the false positives and design a rotation scheme that keeps detection meaningful.',
      whatInterviewerLooksFor: [
        'Identifies races: parallel refreshes, lost responses on flaky networks, app backgrounding, multiple processes',
        'Proposes client single-flight plus server grace window and idempotent refresh',
        'Keeps real theft detectable (grace bound, same-client binding, DPoP)',
        'Uses metrics to separate benign reuse from attacks',
      ],
      modelAnswer: `**Where benign "reuse" comes from:**
1. **Parallel refresh:** five API calls get 401 at once and each triggers a refresh with the same RT. The first wins; the other four look like reuse.
2. **Lost response:** the server rotated RT1 → RT2, but the response died on a tunnel or network switch. The app still holds RT1 and retries — reuse.
3. **Background/extension processes:** a widget, share extension or push handler refreshes with its own copy of the token.
4. **Restored backups:** an old keychain/app backup restored on a new phone.

**Measure first:** log each reuse with the interval since first use, the device ID, IP/ASN and user agent. Benign reuse clusters at under 5 s from the same device; theft is minutes or hours later from a different device or network.

**Fix on the client:**
- A single-flight refresh mutex shared across all API calls (and extensions via a shared keychain group); queue calls behind it.
- Persist the new RT *before* using the new access token.

**Fix on the server:**
- **Grace window:** if a used RT is presented again within ~30 s *and* from the same device binding, return the same successor tokens (idempotent refresh) instead of revoking. Store the successor encrypted, or the hash plus a way to re-issue.
- **Device binding:** sender-constrain with DPoP (RFC 9449) — the app holds a private key in the Secure Enclave/Keystore and proves possession on each refresh. Then a replay from another device fails outright, and you can relax time-based heuristics.
- **Outside the grace window, or from a different key/device:** revoke the family, as today.

**Expected outcome:** single-flight removes most of case 1, idempotent grace fixes case 2, shared storage fixes 3; false logouts drop from 0.8% to well under 0.05%, while true replays from another device are still caught instantly.`,
      followUps: [
        { q: 'Isn\'t a grace window a hole an attacker can use?', a: 'Only if they replay within seconds and pass the device-binding check; with DPoP they cannot, and without it the window is small and still logged.' },
        { q: 'What should the user see when a real reuse is detected?', a: 'A forced re-login on all devices in that family plus a security notification, because you cannot tell which party was the attacker.' },
      ],
      pitfalls: [
        'Disabling reuse detection instead of fixing races',
        'An unbounded or long grace window that makes detection meaningless',
        'Ignoring the lost-response case',
      ],
    },
    {
      id: 'misc-web-auth-iq-21',
      difficulty: 'medium',
      question:
        'In a microservices setup behind an API gateway, where does authentication happen, where does authorization happen, and when do you return 401 vs 403 vs 404?',
      whatInterviewerLooksFor: [
        'Gateway authenticates and does coarse checks; services do object-level authorization',
        'Correct status semantics including WWW-Authenticate and 404 for hiding existence',
        'Mentions propagating identity securely to services (signed internal token, mTLS)',
      ],
      modelAnswer: `**Authentication — once, at the edge:**
- The gateway validates the credential (session cookie, JWT, API key), rejects invalid ones, and forwards a verified identity: a short-lived internal JWT or signed headers over mTLS. Services must reject requests that didn't come through the gateway (network policy + mTLS), or anyone inside can spoof "X-User-Id".

**Authorization — in layers:**
- **Gateway (coarse):** is the token's scope allowed on this route (orders:read for GET /orders), is the tenant's plan allowed to use this API, rate limits.
- **Service (fine-grained):** does order 123 belong to this user's tenant, can this role refund above ₹10,000, is the document shared with them? Only the owning service has that data. Missing this layer is BOLA/IDOR — OWASP API #1.

**Status codes:**
- **401:** no credential, or it's invalid or expired. Must include WWW-Authenticate (for example Bearer error="invalid_token"). The client should re-authenticate or refresh.
- **403:** identity is known and valid, but not allowed — a viewer calling DELETE. Refreshing won't help.
- **404:** the resource belongs to someone else and even confirming it exists is a leak (another tenant's invoice ID). Treat "not yours" the same as "not found".

**Common bug:** returning 403 for expired tokens, which makes clients show "access denied" instead of silently refreshing.`,
      followUps: [
        { q: 'Should the gateway call the permissions service for every request?', a: 'Only for coarse, cacheable decisions; object-level checks need resource data, so doing them at the gateway means duplicating the service\'s data model.' },
        { q: 'What is 401 vs 407?', a: '407 is for authenticating to a proxy, with Proxy-Authenticate; 401 is for the origin.' },
      ],
      pitfalls: [
        'Doing all authorization at the gateway',
        'Trusting identity headers without verifying the caller path',
        'Swapping 401 and 403',
      ],
    },
    {
      id: 'misc-web-auth-iq-22',
      difficulty: 'expert',
      question:
        'Our NestJS GraphQL API has a JWT guard and @Roles decorators on every Query and Mutation, yet a pentester read other tenants\' invoices. They sent query { me { team { members { invoices { total } } } } }. How did that get through, and how do you design authorization for a graph so this class of bug is impossible to ship?',
      whatInterviewerLooksFor: [
        'Understands that guards on root operations do not protect nested field resolvers reached via traversal',
        'Spots DataLoader or cache keying issues that can leak across users/tenants',
        'Proposes authorization at the data/domain layer, tenant-scoped repositories, and field-level directives',
        'Adds testing and tooling: schema linting, depth and cost limits, authz tests per field',
      ],
      modelAnswer: `**Why it got through:**
- Guards run on the root field (me), which any logged-in user may call. The nested resolvers (Team.members, User.invoices) are just functions that load by parent ID with no check.
- "members" returns users from the team; the bug was a team resolver that joined through a shared partner-team relation, and User.invoices loads invoices for *any* user ID it's handed. In REST each endpoint would have had its own check; in GraphQL every edge is an endpoint.
- A second classic: a **DataLoader** or result cache created at module scope (a singleton) instead of per request, so one user's loaded rows are served to another — or cache keys without tenantId.

**Design so it can't ship:**
1. **Authorize in the domain layer, not the resolver:** every repository method takes a request context {userId, tenantId, roles} and adds WHERE tenant_id = $ctx.tenantId. Resolvers can't query without a context. Postgres row-level security with SET app.tenant_id per transaction is a strong backstop.
2. **Object-level policy per type:** a policy function canRead(ctx, invoice) invoked by a field middleware (or an @Authorize directive) on every object type that holds sensitive data, including nested ones. Default deny: types without a policy fail a schema lint in CI.
3. **Per-request DataLoaders** built in the GraphQL context factory with keys that include tenantId.
4. **Limits:** query depth (for example 8), cost analysis and pagination caps, so traversal-based scraping is bounded.
5. **Tests:** an automated suite that, for every type with a policy, requests it via the shortest path from a user in another tenant and expects null plus an error.

**Error semantics:** return null with a FORBIDDEN (or NOT_FOUND) error on the field, not the whole query, and don't reveal existence across tenants.`,
      followUps: [
        { q: 'Does persisted-query allow-listing fix this?', a: 'It narrows the attack surface for first-party clients, but authorization must still be correct because allowed queries run with attacker-chosen variables.' },
        { q: 'How do you keep per-object checks fast on lists of 500 items?', a: 'Batch the policy: filter at the query level (tenant WHERE clause) so most checks are free, and batch-load relationship data via DataLoader for the rest.' },
      ],
      pitfalls: [
        'Adding more @Roles decorators to root resolvers',
        'Authorization logic scattered and duplicated across resolvers',
        'Singleton DataLoaders or cache keys without tenant',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'misc-web-auth-boe-1',
      question:
        'Every request to our platform carries a JWT that is verified at the gateway and again by each internal service it touches. Estimate the CPU spent on signature verification at peak for RS256 vs ES256, and what you would change.',
      assumptions: [
        'Peak 100K requests/s at the edge',
        'Each request is verified by the gateway plus 3 internal services on average = 4 verifications',
        'Single-core verify throughput with native crypto: RSA-2048 (RS256) ≈ 40K/s, ECDSA P-256 (ES256) ≈ 20K/s (order of magnitude, from openssl speed-style benchmarks)',
        'Per-token overhead in Node for base64 decode, JSON.parse and claim checks ≈ 10 µs',
        'Access tokens live 15 minutes and an active client sends ~1 request/s',
      ],
      steps: [
        { label: 'Verifications per second', calc: '100K req/s × 4 = 400K verifies/s' },
        { label: 'RS256 crypto cost', calc: '400K ÷ 40K per core ≈ 10 cores' },
        { label: 'ES256 crypto cost', calc: '400K ÷ 20K per core ≈ 20 cores' },
        { label: 'Parsing overhead', calc: '400K × 10 µs = 4 core-seconds per second ≈ 4 cores' },
        { label: 'Totals', calc: 'RS256 ≈ 14 cores, ES256 ≈ 24 cores across the fleet at peak' },
        { label: 'Reuse per token', calc: '15 min × 60 × 1 req/s ≈ 900 uses of the same token per client' },
        { label: 'With an in-process verified-token cache', calc: 'hit rate ≈ 99%+ per pod (sticky-ish clients) → crypto drops to well under 1 core' },
      ],
      answer:
        'Roughly 14 cores for RS256 and 24 for ES256 at peak — real but not dramatic. A small LRU cache of verified tokens (keyed by a hash of the token, entries expiring at the token exp) removes almost all of it.',
      insight:
        'Verification cost rarely justifies weakening checks or verifying only at the gateway. RS256 verifies faster but signs slower and produces 256-byte signatures (vs 64 for ES256), so tokens are larger; cache verification results per pod and keep verifying at every hop for zero-trust.',
      followUps: [
        {
          "q": "Security wants instant revocation: a revoked token must stop working within 5 seconds everywhere. How does your verified-token cache change?",
          "a": "A cache of verified tokens otherwise keeps a revoked token valid until its exp. Add a revocation check that is cheap per request: distribute a revocation list of `jti`s (or user ids with a 'revoked before' timestamp) via pub/sub to every pod, held in memory, so each request checks a Set lookup (microseconds). Pods subscribe and receive updates within about a second. On reconnect, they fetch the full list. The list stays small because entries expire with the 15-minute token lifetime. Verification-cache hits must also consult the revocation set, so the check sits after the cache lookup."
        }
      ],
    },
    {
      id: 'misc-web-auth-boe-2',
      question:
        'A consumer mobile app with 30M monthly users moves to 15-minute access tokens with rotating refresh tokens stored in Postgres. Estimate refresh QPS, write load, and how big the refresh-token table grows if you keep used tokens for reuse detection.',
      assumptions: [
        '6M daily active users, 3 app opens per day, ~20 minutes of total use per day',
        'Each app open after a gap needs one refresh; in-session refreshes every 15 minutes',
        'Peak hour is 4× the daily average rate',
        'Each refresh = 1 row insert (new token) + 1 row update (mark old used)',
        'Row size with indexes ≈ 250 bytes; used tokens kept until their own 7-day expiry for reuse detection',
      ],
      steps: [
        { label: 'Refreshes on app open', calc: '6M × 3 = 18M/day' },
        { label: 'In-session refreshes', calc: '20 min ÷ 15 min ≈ 1 per user per day → 6M/day' },
        { label: 'Total and average rate', calc: '24M ÷ 86,400 ≈ 280 refreshes/s; peak ×4 ≈ 1.1K/s' },
        { label: 'Write load at peak', calc: '1.1K × 2 writes = 2.2K row writes/s — fine for one Postgres primary' },
        { label: 'Rows retained', calc: '24M/day × 7 days ≈ 170M rows' },
        { label: 'Table size', calc: '170M × 250 B ≈ 42 GB, growing and churning constantly (vacuum pressure)' },
        { label: 'Alternative: one row per family', calc: 'store (family_id, current_generation); ≈ 6–10M live families × 150 B ≈ 1.5 GB' },
      ],
      answer:
        'About 280 refreshes/s on average and ~1.1K/s at peak, ~2.2K writes/s — easy. Keeping every used token for 7 days means ~170M rows and ~40 GB of churn; a per-family generation counter needs only a few GB.',
      insight:
        'QPS is not the problem — storage churn is. Encode (familyId, generation, random) in the refresh token and keep one row per family: a presented generation lower than the current one is reuse, with no history table. Partition any history by day so cleanup is DROP PARTITION, not DELETE.',
      followUps: [
        {
          "q": "A bad mobile release makes every client refresh on every API call. What happens to your estimate, and how do you protect the auth service?",
          "a": "Refreshes jump from about 280/s to the API request rate. If 6M DAU make even 50 calls per day, that's about 3.5K/s on average and over 14K/s at peak, with 2 writes each: 28K writes/s, which saturates one Postgres primary and floods the token table. Protect it: rate-limit refreshes per family (for example 1 per 30 s; extra ones get the current access token back or 429), cache the newest successor briefly so duplicates are served without writes, and use a feature flag or forced app update to fix the client. Monitor refreshes per active user as a release health metric."
        }
      ],
    },
    {
      id: 'misc-web-auth-boe-3',
      question:
        'Our API hostname uses health-checked DNS failover on Route 53. Compare TTL 60 s vs 300 s: monthly query cost and worst-case failover time. Which would you choose?',
      assumptions: [
        '~500K distinct caching resolvers worldwide query the name; ~40% have continuous demand (re-query every TTL)',
        'Route 53 standard queries: $0.40 per million for the first 1B/month, $0.20 per million after (alias queries to AWS resources are free)',
        'Health check interval 30 s, failure threshold 3',
        'A small share of clients (old JVMs, some embedded devices, sticky OS caches) ignore TTLs',
      ],
      steps: [
        { label: 'Active resolvers', calc: '500K × 40% = 200K' },
        { label: 'Queries at TTL 60', calc: '200K × 1,440/day ≈ 288M/day ≈ 8.6B/month' },
        { label: 'Cost at TTL 60', calc: '1B × $0.40/M + 7.6B × $0.20/M = $400 + $1,520 ≈ $1.9K/month' },
        { label: 'Queries and cost at TTL 300', calc: '8.6B ÷ 5 ≈ 1.7B/month → $400 + 0.7B × $0.20/M ≈ $540/month' },
        { label: 'Detection time', calc: '30 s × 3 failures ≈ 90 s before DNS answers change' },
        { label: 'Worst-case failover', calc: 'TTL 60: 90 + 60 ≈ 2.5 min; TTL 300: 90 + 300 ≈ 6.5 min (plus TTL-ignoring clients)' },
      ],
      answer:
        'TTL 60 costs about $1.9K/month and fails over in about 2.5 minutes; TTL 300 costs about $540/month and takes about 6.5 minutes. For a failover record, TTL 60 is worth $1.4K/month; if the record can be an alias to an AWS load balancer, the queries are free anyway.',
      insight:
        'DNS cost is small; failover time and TTL-ignoring clients dominate. Use short TTLs only on records that fail over, long TTLs elsewhere, and do not rely on DNS alone for sub-minute failover — anycast or a global load balancer moves traffic without waiting on resolver caches.',
      followUps: [
        {
          "q": "During a real failover, a monitoring partner's JVM clients keep hitting the dead region for 20 minutes. How do you handle TTL-ignoring clients?",
          "a": "Don't let 'dead region' mean 'unreachable IP'. Keep the failed region's edge reachable if possible and have it forward to the healthy region (a reverse proxy at the edge or CDN in front of both regions), so stale DNS still works. Better: put both regions behind anycast or a global load balancer, so the IP never changes and failover happens behind it. For the partner, publish guidance (`networkaddress.cache.ttl=60` in the JVM security properties) and test it in failover drills with them. Monitor traffic still arriving at the failed region's IPs after failover."
        }
      ],
    },
    {
      id: 'misc-web-auth-boe-4',
      question:
        'Marketing tags have grown the Cookie header on www.example.com to 3.5 KB. Estimate the upstream bandwidth cost at the edge and on a mobile page load, and whether HTTP/2 header compression makes it go away.',
      assumptions: [
        'Edge traffic 50K requests/s, 60% still HTTP/1.1 (bots, older clients, API integrations)',
        'A page load makes 80 requests to the same site (HTML, API, images, JS)',
        'Mobile uplink on a congested 4G cell ≈ 1 Mbps',
        'HTTP/2 HPACK dynamic table default size is 4,096 bytes (SETTINGS_HEADER_TABLE_SIZE)',
      ],
      steps: [
        { label: 'HTTP/1.1 edge bytes', calc: '50K × 60% × 3.5 KB ≈ 105 MB/s ≈ 840 Mbps of inbound cookie bytes' },
        { label: 'Page load over HTTP/1.1', calc: '80 × 3.5 KB = 280 KB upstream ≈ 280 × 8 ÷ 1,000 ≈ 2.2 s of uplink time on 1 Mbps' },
        { label: 'HTTP/2 best case', calc: 'first request 3.5 KB, later ones a few bytes each if the header is in the HPACK table' },
        { label: 'HPACK table fit', calc: 'a single 3.5 KB header plus other headers nearly fills a 4 KB table → frequent eviction; browsers split cookies into one field per cookie ("crumbs") so individual cookies can still be indexed' },
        { label: 'Header limits', calc: 'nginx large_client_header_buffers default 4 × 8 KB: one more tag pushes some users over 8 KB → 400 "Request Header Or Cookie Too Large"' },
      ],
      answer:
        'Nearly 1 Gbps of cookie bytes at the edge from HTTP/1.1 clients and ~2 s of extra uplink per mobile page load; HTTP/2 hides most of it after the first request but not reliably once cookies approach the 4 KB table size.',
      insight:
        'Cookies are a tax on every request. Keep auth cookies small and host-only, move tracking data to first-party storage or server-side, serve static assets from a cookieless domain, and alert on Cookie header size before users hit 400s.',
      followUps: [
        {
          "q": "You move static assets to a cookieless domain. How much do you save, and what does it cost?",
          "a": "Of the 80 requests per page, typically 60–70 are images, JS and CSS. On a cookieless domain (e.g. `static.example-cdn.com`, not a subdomain of example.com, since domain-wide cookies would still be sent), those requests carry no Cookie header, saving about 60 × 3.5 KB ≈ 210 KB of uplink per HTTP/1.1 page load, roughly 1.7 s on 1 Mbps, and most of the edge's inbound cookie bytes. Costs: one more DNS lookup and TLS connection for the asset domain (mitigated by `preconnect`), and under HTTP/2 or 3 you lose connection reuse between HTML and assets."
        }
      ],
    },
  ],
  test: [
    {
      id: 'misc-web-auth-mcq-01',
      difficulty: 'hard',
      question:
        'A user on office Wi-Fi opens https://bank.example.com/statements?acct=9981 over TLS 1.3 without Encrypted Client Hello, and the OS uses plain UDP DNS. Select ALL that the Wi-Fi operator can observe from network traffic alone.',
      options: [
        'The hostname bank.example.com, from the SNI in the ClientHello',
        'The path /statements and the acct=9981 query parameter',
        'The server IP address and the approximate sizes of responses',
        'The value of the session cookie sent with the request',
        'That the device looked up bank.example.com, from the DNS query',
      ],
      correct: [0, 2, 4],
      explanation:
        'Without ECH the SNI is sent in clear, the IP and packet sizes are always visible, and plain DNS reveals the lookup. The path, query string and cookies travel inside the encrypted HTTP layer, so the operator cannot see acct=9981 or the cookie — those leak at the endpoints (logs, history, Referer), not on the wire.',
      followUps: [
        {
          "q": "The bank wants to hide even the hostname and the DNS lookup from the Wi-Fi operator. What would that take, and what still leaks?",
          "a": "Encrypted DNS (DoH or DoT to a trusted resolver) hides the lookup. Encrypted Client Hello hides the real SNI: the browser fetches the ECH config from the site's HTTPS DNS record and encrypts the inner ClientHello, leaving only a shared outer name (typically the CDN's) visible. That works best behind a large CDN, where many sites share IPs. What still leaks: the destination IP (if the bank has dedicated IPs, the hostname is effectively revealed), traffic timing and sizes (which can fingerprint pages), and the fact that the user talks to that CDN. A VPN hides those from the Wi-Fi operator but shifts trust to the VPN provider."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-02',
      difficulty: 'expert',
      question:
        'After a certificate renewal with the config below, Chrome and Safari load the API fine, but Node and Java partner clients fail with the error shown. What is the most likely cause and fix?',
      code: {
        language: 'nginx',
        code: `server {
  listen 443 ssl http2;
  server_name api.example.com;
  ssl_certificate     /etc/ssl/api.example.com.crt;   # file contains 1 certificate
  ssl_certificate_key /etc/ssl/api.example.com.key;
}
# Node client:  Error: unable to verify the first certificate
#               code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'`,
      },
      options: [
        'Node\'s bundled root store is outdated; set NODE_EXTRA_CA_CERTS to the CA root on every client',
        'Node does not send SNI by default, so it receives the default server block\'s certificate',
        'Only the leaf is served; browsers fill in the missing intermediate from cache or AIA, Node and Java do not. Serve the full chain (leaf + intermediates)',
        'TLS 1.3 with http2 is not supported by older Node clients; add TLS 1.2 ciphers',
      ],
      correct: [2],
      explanation:
        'A server must send its intermediates; clients only hold roots. Browsers mask the bug by caching intermediates and fetching them via the certificate\'s AIA URL, while Node, Java, Go and curl do not. Adding the root to clients would not help, because the chain is broken between leaf and root. Node sends SNI automatically for hostnames, and the error names the leaf, not a protocol version.',
      followUps: [
        {
          "q": "How do you stop this from recurring at the next renewal?",
          "a": "Automate and verify. Use ACME (cert-manager, Certbot) which installs `fullchain.pem`, never the bare leaf. Add a post-deploy check that connects like a strict client: `openssl s_client -connect api:443 -servername api.example.com -verify_return_error` (or a Node/Java probe) must succeed with no extra CA hints, and fail the pipeline otherwise. Run the same check as a synthetic monitor every few minutes. Monitor expiry dates for every endpoint (alert at 21 days), and test with a client that doesn't fetch AIA, since browsers hide this class of bug."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-03',
      difficulty: 'medium',
      question:
        'Security sets Strict-Transport-Security: max-age=63072000; includeSubDomains; preload on example.com and submits it to the browser preload list. What is the most likely breakage over the next weeks?',
      options: [
        'Mobile apps using OkHttp and URLSession start rejecting the API\'s certificate',
        'An internal admin UI served only over plain http://printers.example.com becomes unreachable in browsers',
        'Users can click through certificate warnings more easily on subdomains',
        'CDN caches for example.com are invalidated because HSTS changes the cache key',
      ],
      correct: [1],
      explanation:
        'includeSubDomains plus preload forces HTTPS for every subdomain in every browser, so HTTP-only internal hosts break, and removal from the preload list takes months. Native HTTP clients don\'t use the browser preload list. HSTS removes the ability to click through certificate errors rather than easing it, and it has nothing to do with CDN cache keys.',
      followUps: [
        {
          "q": "The preload submission is done. How do you recover the HTTP-only internal hosts, and what would you have done before submitting?",
          "a": "Removing from the preload list takes months, so fix the hosts instead: give them HTTPS (an internal CA trusted by managed devices, or public certificates via ACME DNS-01 even for internal names), or move them to a different registrable domain such as `example-internal.com` that isn't covered. Before submitting: inventory all subdomains (DNS zone, CT logs), roll out HSTS with `includeSubDomains` first at a short max-age (5 minutes, then a day, then a week) while monitoring for breakage, and only add `preload` once every subdomain has served HTTPS for weeks."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-04',
      difficulty: 'expert',
      question:
        'api.example.com and admin.example.com resolve to the same edge IP and share a *.example.com certificate. The edge chooses the backend from the TLS SNI. Users who open the API docs and then the admin console in the same browser get 404s from the API backend on admin pages. What is happening?',
      options: [
        'The browser\'s DNS cache returned the API\'s IP for the admin hostname',
        'HPACK reused the :authority value from the api.example.com requests in its dynamic table',
        'ALPN negotiated h2 only for the first hostname, so admin requests fell back to HTTP/1.1 on the wrong port',
        'The browser coalesced admin requests onto the existing HTTP/2 connection (same IP, certificate covers both), whose SNI says api; route by :authority/Host or answer 421 Misdirected Request',
      ],
      correct: [3],
      explanation:
        'HTTP/2 allows connection reuse across hostnames when the IP matches and the certificate is valid for both, so the admin request arrives on a connection whose SNI is api.example.com. The fix is to route on the :authority header, or return 421 so the browser opens a new connection. The IPs are identical anyway, HPACK carries each request\'s real authority, and ALPN is per connection, not per hostname.',
      followUps: [
        {
          "q": "Product wants admin to have a different certificate (client-certificate auth) from the API. Does that prevent coalescing, and what's the cleanest setup?",
          "a": "Yes, partly. Browsers only coalesce if the existing connection's certificate covers the new hostname, so giving admin its own certificate (not the wildcard) stops reuse from api to admin. But if admin requires client certificates (mTLS), the TLS handshake parameters differ anyway, so you want a separate connection. Cleanest: put admin on a different IP (or a separate listener) with its own certificate requiring client auth, and have the edge return `421 Misdirected Request` whenever `:authority` doesn't match the SNI, as a safety net. Then routing is correct regardless of client coalescing behaviour."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-05',
      difficulty: 'medium',
      question:
        'A team wants to use HTTP/2 server push to send /config.json together with index.html so the SPA starts faster. What do you recommend?',
      options: [
        'Push is fine; mark config.json Cache-Control: immutable so it is only pushed on the first visit',
        'Use push only over HTTP/3, where it is reliable because of per-stream loss recovery',
        'Push it, since Chrome keeps pushed responses in the HTTP cache for five minutes',
        'Browsers have dropped push (Chrome removed it in v106); send 103 Early Hints with a preload Link, or inline the config into the HTML',
      ],
      correct: [3],
      explanation:
        'Server push wasted bandwidth on already-cached resources and was rarely a net win, so Chrome removed it; 103 Early Hints lets the browser start fetching preloads while the server builds the page. Cache-Control does not stop the server from pushing, HTTP/3 push is likewise unsupported by major browsers, and pushed responses live in a per-connection push cache, not the HTTP cache.',
      followUps: [
        {
          "q": "You add 103 Early Hints with Link: </config.json>; rel=preload. The CDN strips 1xx responses. How do you verify it works end to end?",
          "a": "Check each hop. curl doesn't show 103 by default, but `curl -v --http2` prints informational responses with recent versions; in Chrome DevTools, the Network panel shows early-hints preloads with an initiator of 'early-hints' and an earlier start time. If the CDN strips or doesn't support 103 to the client, configure the CDN to emit Early Hints itself (Cloudflare and Fastly can generate 103 from cached Link headers). Measure in RUM: compare LCP or time-to-config-loaded with and without the hint via an A/B flag, since preloading the wrong thing can slow the page."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-06',
      difficulty: 'expert',
      question:
        'Your CDN accepts TLS 1.3 / QUIC 0-RTT and forwards early requests with Early-Data: 1. The origin runs the middleware below. A returning mobile browser sends POST /cart/checkout in early data. What happens?',
      code: {
        language: 'typescript',
        code: `app.use((req, res, next) => {
  const early = req.headers['early-data'] === '1';
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (early && !safe) {
    return res.status(425).end(); // 425 Too Early
  }
  next();
});`,
      },
      options: [
        'The user sees an error and must press "Place order" again, because 425 is a client error',
        'The CDN caches the 425 for the URL, so checkout fails for everyone until the TTL expires',
        'The order is placed twice, because 425 is advisory and the CDN also forwards the request later',
        'The browser (or the CDN) retries after the handshake completes, not in early data, so checkout runs once and a captured copy of the early packet also gets 425',
      ],
      correct: [3],
      explanation:
        'RFC 8470 expects user agents to retry automatically on 425 without early data, and intermediaries must wait for the handshake before retrying. Because every early-data POST is rejected, an attacker replaying the captured 0-RTT flight gets 425 too. 425 responses are not cacheable by default, and the origin never ran the handler for the early copy, so there is no double order.',
      followUps: [
        {
          "q": "A non-browser client (your own mobile SDK) uses 0-RTT via a custom QUIC stack. Does 425 still protect you?",
          "a": "Only if the SDK implements RFC 8470 correctly: on 425 it must resend after the handshake completes, not in early data, and not surface the error to the user. Custom stacks often don't, so users see failed checkouts. Verify with tests. More robust: don't depend on early-data handling at all for state-changing requests. Make checkout idempotent with an idempotency key, so even a replayed early request is harmless, and configure the SDK to send only GETs for safe resources in early data. Server-side, keep the 425 middleware as a backstop."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-07',
      difficulty: 'hard',
      question:
        'HTTP/3 has been enabled on the CDN for a month, but RUM shows only 35% of requests from modern browsers use h3. Select ALL plausible reasons.',
      options: [
        'The first connection to an origin uses TCP until the browser learns Alt-Svc, unless an HTTPS DNS record advertises h3',
        'Corporate and some carrier networks block or throttle UDP 443, so browsers fall back to HTTP/2',
        'Alt-Svc entries expire after their ma lifetime (24 h by default), so infrequent visitors start over on TCP',
        'HTTP/3 requires an Ed25519 certificate, which only some browsers accept',
        'HTTP/3 carries only GET requests, so POST and PUT stay on HTTP/2',
      ],
      correct: [0, 1, 2],
      explanation:
        'Discovery via Alt-Svc means first visits start on TCP (HTTPS/SVCB records fix that), UDP blocking forces fallback, and cached Alt-Svc information expires. HTTP/3 uses the same X.509 certificates as HTTPS over TCP, and it supports every HTTP method.',
      followUps: [
        {
          "q": "Publish an HTTPS DNS record for h3. What does it contain, and what's the fallback if UDP is blocked on the first visit?",
          "a": "An HTTPS (type 65) record such as `example.com. 300 IN HTTPS 1 . alpn=\"h3,h2\" ipv4hint=... ech=...` tells browsers before connecting that h3 is available (plus IP hints and ECH config), so the first visit can try QUIC immediately. Browsers race QUIC against TCP (happy-eyeballs style): if no QUIC response comes within a short delay (around 300 ms in Chrome), they use the TCP connection, and they remember a QUIC failure for that network for a while. So a UDP-blocked network costs at most a short delay on the first attempt, and later attempts use TCP directly."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-08',
      difficulty: 'expert',
      question:
        'After 60% of edge traffic moved to HTTP/3, edge CPU per Gbps served roughly doubled with no change in traffic mix. What is the most likely explanation and remedy?',
      options: [
        'QUIC does packet processing and crypto in user space with per-datagram syscalls and little NIC offload; enable UDP GSO/GRO and batched sends (sendmmsg), and tune packet sizes',
        'UDP is unreliable, so QUIC retransmits far more data; raise the congestion window',
        'QPACK compression is much more expensive than HPACK; disable header compression for HTTP/3',
        '0-RTT doubles handshake work for every connection; disable 0-RTT to halve CPU',
      ],
      correct: [0],
      explanation:
        'Kernel TCP benefits from TSO/LRO offload and large send batches, while QUIC stacks encrypt and frame each ~1,200-byte datagram in user space. GSO/GRO and batching cut syscalls and close much of the gap. Retransmission rates are not inherently higher, QPACK is not the dominant cost, and 0-RTT actually reduces handshake round trips rather than doubling CPU.',
      followUps: [
        {
          "q": "After GSO/GRO tuning, CPU is still 40% higher than TCP. Is HTTP/3 still worth keeping on, and how would you decide?",
          "a": "Decide with user-facing data versus cost. Measure in RUM for h3 vs h2 users on comparable networks: TTFB, LCP and error rates, especially at p75 and p95 on mobile, where QUIC's 0-RTT, connection migration and lack of TCP head-of-line blocking help most. If mobile p95 improves by, say, 10–20% and that moves conversion, 40% more edge CPU (a known, linear cost) may be cheap. Options to cut cost: enable h3 only for client segments that benefit (mobile apps, high-latency regions), use hardware crypto offload where available, and keep the QUIC stack up to date, since stacks keep improving."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-09',
      difficulty: 'hard',
      question:
        'At 10:00 a smoke test resolves api-v2.example.com before the record exists. At 10:05 the A record is created with TTL 60. The zone SOA has TTL 3600 and MINIMUM 900. Users behind the same ISP resolver get NXDOMAIN until about when?',
      options: ['10:05, as soon as the record is created', '10:06, one A-record TTL after creation', '10:15, when the cached negative answer expires', '11:00, one SOA TTL after the first query'],
      correct: [2],
      explanation:
        'Per RFC 2308 the resolver caches NXDOMAIN for min(SOA TTL, SOA MINIMUM) = min(3600, 900) = 900 s from the 10:00 query, so until about 10:15. The new record\'s TTL is irrelevant until the negative entry expires, and the SOA TTL alone is not the negative TTL when MINIMUM is smaller.',
      followUps: [
        {
          "q": "How would you change your launch process so new hostnames never get stuck behind cached NXDOMAINs?",
          "a": "Create DNS records well before anyone queries them: as part of infrastructure provisioning, at least the negative-cache TTL (15 minutes here) before smoke tests or announcements. Smoke tests should query the authoritative servers directly (`dig @ns1.provider api-v2.example.com`) rather than public resolvers, so they don't poison caches. Lower the SOA MINIMUM (negative TTL) to something like 60–300 s for zones with frequent launches. If it happens anyway, you can flush some public resolvers' caches (Google and Cloudflare have purge tools), but not ISPs', so prevention is the real fix."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-10',
      difficulty: 'expert',
      question:
        'To cut DNS latency, a team added this lookup cache to the Node HTTP agent calling a partner. During the partner\'s regional DNS failover, other clients moved within minutes but this service kept failing until pods were restarted. What is the best fix?',
      code: {
        language: 'typescript',
        code: `import dns from 'node:dns';
import https from 'node:https';

const cache = new Map<string, { address: string; family: number }>();

const lookup: typeof dns.lookup = ((host: string, opts: any, cb: any) => {
  const hit = cache.get(host);
  if (hit) return cb(null, hit.address, hit.family);
  dns.lookup(host, { family: 4 }, (err, address, family) => {
    if (!err) cache.set(host, { address, family });
    cb(err, address, family);
  });
}) as any;

export const agent = new https.Agent({ keepAlive: true, lookup });`,
      },
      options: [
        'Remove keepAlive, because pooled sockets are what pinned traffic to the failed region',
        'Honour record TTLs: resolve with dns.resolve4(host, { ttl: true }), cache for min(TTL, ~60 s), and evict the entry on connection errors',
        'Switch dns.lookup to dns.resolve4 but keep the Map; resolve4 bypasses the OS cache so answers are always fresh',
        'Set UV_THREADPOOL_SIZE=64 so the cache refreshes faster in the background',
      ],
      correct: [1],
      explanation:
        'The Map never expires, so the failed IP is used forever; the cache must respect TTLs (resolve4 exposes them, lookup does not) and drop entries on connect failures. Keep-alive sockets do pin to an IP, but they are closed when the backend dies — the stale cache then reconnects to the dead IP. Switching resolver APIs while keeping a permanent cache changes nothing, and thread-pool size is irrelevant because nothing ever refreshes.',
      followUps: [
        {
          "q": "Implement the fix. How does the cache interact with keep-alive pools, so failover actually takes effect?",
          "a": "Wrap a custom `lookup` for the agent: on a miss or expired entry, call `dns.resolve4(host, { ttl: true })`, cache addresses with an expiry of `min(ttl, 60) s`, and pick one address at random. On a socket `error` (ECONNREFUSED, ETIMEDOUT), delete the cache entry so the next connection re-resolves. Keep-alive pools still hold sockets to the old IP until they die or are recycled, so also set a maximum socket age (for example 60–120 s) so the pool turns over and picks up new answers even when the old IP is still reachable but no longer intended (graceful DNS moves)."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-11',
      difficulty: 'medium',
      question:
        'You want the apex domain example.com to point at your CDN hostname d123.cdn.net, and the DNS console refuses to create a CNAME. What is the most robust option?',
      options: [
        'Use your DNS provider\'s ALIAS/ANAME or CNAME flattening, which resolves the CDN name server-side and answers with A/AAAA records',
        'Look up the CDN\'s current IPs and create A records for them with a long TTL',
        'Create a TXT record at the apex containing d123.cdn.net, which browsers follow like a CNAME',
        'Lower the SOA TTL, after which the console allows a CNAME to coexist with the NS and SOA records',
      ],
      correct: [0],
      explanation:
        'A CNAME cannot coexist with the SOA and NS records that must exist at the apex, so providers offer ALIAS/flattening that tracks the target\'s changing IPs. Hard-coding CDN IPs breaks silently when the CDN re-balances. Browsers never follow TXT records for addressing, and no TTL setting makes an apex CNAME legal.',
      followUps: [
        {
          "q": "Your DNS provider doesn't support ALIAS or flattening. What do you do instead?",
          "a": "Options: move DNS hosting to a provider that supports it (Route 53 alias, Cloudflare flattening, NS1 ALIAS), which is usually the right call. Or redirect the apex: point `example.com` A records at a small, stable redirect service (anycast IPs from the CDN, many CDNs publish static anycast IPs for exactly this) that returns 301 to `www.example.com`, which can be a CNAME to the CDN. Some CDNs offer dedicated static IPs for apex domains as a paid feature. Avoid hard-coding the CDN's normal edge IPs, since they change without notice."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-12',
      difficulty: 'expert',
      question:
        'This quote-streaming server is OOM-killed during market spikes, even though the number of connections is stable at ~40K. Which explanation is most accurate?',
      code: {
        language: 'typescript',
        code: `import { WebSocketServer } from 'ws';
import { feed } from './feed'; // emits ~2,000 ticks/s during spikes

const wss = new WebSocketServer({ port: 8080 });

feed.on('tick', (tick) => {
  for (const client of wss.clients) {
    client.send(JSON.stringify(tick));
  }
});`,
      },
      options: [
        'JSON.stringify runs once per client per tick, and the garbage from 80M strings/s overwhelms V8\'s collector',
        'Without permessage-deflate, each frame is too large and the kernel send buffers overflow into the heap',
        'Clients on slow networks cannot drain fast enough, so ws queues unsent frames in memory (bufferedAmount) with no bound; drop, conflate or disconnect slow consumers',
        'TCP keepalive is not enabled, so dead connections stay in wss.clients and their buffers grow',
      ],
      correct: [2],
      explanation:
        'send() never blocks; when the socket cannot drain, data accumulates in the process heap per client. At 2,000 ticks/s a few thousand slow mobile clients can hold gigabytes. The fix is backpressure: check bufferedAmount, conflate to the latest quote, or close slow clients. Stringifying once outside the loop is a good CPU optimization but is not what grows memory, compression increases per-socket memory rather than saving it, and keepalive affects detection of dead peers, not live slow ones.',
      followUps: [
        {
          "q": "Implement the slow-consumer policy for quotes. What exactly do you do per client per tick?",
          "a": "Stringify each tick once, then for each client: if `ws.bufferedAmount` is under a soft limit (say 64 KB), send normally; if it's above the soft limit, don't send this tick, but remember the latest quote per symbol for that client (conflation), so when it drains it receives only current prices, not a stale backlog; if it stays above a hard limit (say 1 MB) for more than a few seconds, close it with code 1013 ('try again later') and let it reconnect. Export metrics: count of conflating clients and slow-client disconnects. Memory per client is then bounded."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-13',
      difficulty: 'hard',
      question:
        'A browser SPA must authenticate its wss:// connection to your gateway. Select ALL statements that are correct.',
      options: [
        'The browser WebSocket constructor cannot set an Authorization header on the handshake',
        'Putting the long-lived access token in the query string risks it landing in proxy and access logs; a short-lived, single-use connection ticket is safer',
        'If you authenticate with cookies instead, you must check the Origin header during the handshake, because CORS does not restrict WebSocket connections',
        'The Sec-WebSocket-Key header proves that the client holds a valid session',
        'Once connected, the protocol closes the socket automatically when the token\'s exp passes',
      ],
      correct: [0, 1, 2],
      explanation:
        'The browser API accepts only a URL and subprotocols, so tokens travel in the URL, a first message or a cookie. URLs are logged, so use a ticket valid for seconds, and cookie auth needs an Origin check to prevent cross-site WebSocket hijacking. Sec-WebSocket-Key is only a handshake nonce with no security value, and nothing in the protocol knows about token expiry — the server must enforce it.',
      followUps: [
        {
          "q": "Design the connection-ticket flow. What are the ticket's properties and how is it validated?",
          "a": "Client calls `POST /ws-ticket` with its normal bearer token over HTTPS. The server issues a random 128-bit ticket stored in Redis as `ticket:<id> -> {userId, tenantId, origin}` with a 30 s TTL. The client opens `wss://.../ws?ticket=<id>`. On upgrade, the server atomically consumes it (`GETDEL`), checks it exists, matches the Origin header, and binds the user to the socket. Single-use and seconds-long validity make leaked log entries worthless. The server also schedules re-authentication or disconnection when the underlying session or token expires, since the socket outlives the ticket."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-14',
      difficulty: 'medium',
      question:
        'Chat WebSockets pass through an AWS ALB and nginx, both with default timeouts. Quiet rooms disconnect after almost exactly 60 seconds, busy rooms never do. What is the right fix?',
      options: [
        'Enable TCP keepalive on the Node server with the OS default settings',
        'Increase the client reconnect backoff so users do not notice the drops',
        'Move to an NLB with sticky sessions so connections are not rebalanced',
        'Send an application-level ping (or ping frame) every ~25 s, below the smallest idle timeout, and treat a missed pong as a dead connection',
      ],
      correct: [3],
      explanation:
        'The ALB idle timeout and nginx proxy_read_timeout both default to 60 s and count only data flowing through them. A ping every 20–30 s keeps the path active and also detects half-open sockets. Kernel TCP keepalive defaults to about 2 hours before the first probe, so it is far too slow; stickiness is unrelated; and slower reconnects hide the symptom while making it worse.',
      followUps: [
        {
          "q": "A client's network drops silently (phone enters a tunnel). How fast does each side detect it with your 25 s pings, and what does the client do on resume?",
          "a": "The server sends a ping every 25 s and expects a pong within, say, 10 s, so it detects the dead socket within about 35 s and frees its resources. The client should run its own heartbeat timer too: if no message or ping arrives within 35 s, treat the connection as dead and reconnect, rather than waiting for TCP, which can take many minutes on a half-open socket. On reconnect, use backoff with jitter and resume from the last received message id, so the server replays missed chat messages from a durable store."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-15',
      difficulty: 'hard',
      question:
        'An ops dashboard opens one SSE stream per tab and is served over HTTP/1.1. Users with seven or more tabs report that the newest tab never loads, and even its ordinary API calls hang. What is going on?',
      options: [
        'EventSource allows only one open stream per browser window, so later tabs queue',
        'The server\'s keep-alive limit closes idle connections, so new tabs cannot connect',
        'Browsers allow about 6 concurrent HTTP/1.1 connections per origin, shared across tabs; open SSE streams consume them all. Serve over HTTP/2 or share one stream across tabs (SharedWorker/BroadcastChannel)',
        'CORS preflights for the SSE endpoint are cached per tab and time out after six entries',
      ],
      correct: [2],
      explanation:
        'Each HTTP/1.1 SSE stream holds a whole connection indefinitely, and the per-origin connection cap is browser-wide, so the seventh tab waits forever for a free connection. Over HTTP/2 each stream is one of ~100 multiplexed streams on a single connection. EventSource has no per-window limit, keep-alive limits do not cause a hang like this, and preflight caching has no six-entry limit.',
      followUps: [
        {
          "q": "You move to HTTP/2, but some enterprise users sit behind a proxy that downgrades to HTTP/1.1. How do you make the dashboard robust for them?",
          "a": "Share one stream per browser instead of one per tab. A SharedWorker (where supported) or a leader-tab election via `BroadcastChannel` plus `navigator.locks` holds the single EventSource and fans messages out to other tabs. When the leader tab closes, another acquires the lock and reconnects with Last-Event-ID. That uses one connection regardless of HTTP version. Alternatively serve the stream from a dedicated subdomain (a separate origin has its own 6-connection budget), though that only raises the ceiling. Detect the downgrade via `performance.getEntries()` nextHopProtocol and enable the fallback."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-16',
      difficulty: 'expert',
      question:
        'With this SSE endpoint, users who lose connectivity for ~10 seconds silently miss order updates, even though EventSource reconnects. What is missing?',
      code: {
        language: 'typescript',
        code: `app.get('/orders/:id/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });
  const onEvent = (e: OrderEvent) => {
    res.write('event: status\\n');
    res.write('data: ' + JSON.stringify(e) + '\\n\\n');
  };
  bus.on('order:' + req.params.id, onEvent);
  req.on('close', () => bus.off('order:' + req.params.id, onEvent));
});`,
      },
      options: [
        'A retry: field; without it EventSource never reconnects after a network drop',
        'An id: line on every event, plus replaying events newer than the Last-Event-ID request header from a retained log (for example Redis Streams)',
        'A Connection: keep-alive header, so the browser keeps the stream open during the blip',
        'Setting withCredentials on the client so the reconnect carries the session cookie',
      ],
      correct: [1],
      explanation:
        'EventSource reconnects by default (retry only tunes the delay) and resends the last id it saw as Last-Event-ID — but only if events carry ids, and only if the server can replay from a log. This handler only emits live events from an in-memory bus, so anything published during the gap is lost. Connection headers do not survive a network drop, and credentials only matter if the reconnect is failing auth, which it is not.',
      followUps: [
        {
          "q": "Implement replay with Redis Streams. How long do you retain events, and what happens if the client's Last-Event-ID is older than retention?",
          "a": "Publish each order event with `XADD orders:<userId> MAXLEN ~ 1000 * ...` (or a time-based MINID trim, for example 24 hours); the Redis stream entry id becomes the SSE `id:`. On connect with `Last-Event-ID`, `XRANGE` from that id (exclusive) to send the gap, then switch to live with `XREAD BLOCK`. If the id is older than the oldest retained entry, you can't fill the gap, so send an explicit `event: reset` telling the client to refetch full state via REST, then continue live. Size retention to typical offline durations (minutes to hours) rather than forever."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-17',
      difficulty: 'medium',
      question:
        'Your SSE endpoint requires Authorization: Bearer <token>, and the frontend uses new EventSource(url). Every connection gets 401. Which approach works?',
      options: [
        'Pass { headers: { Authorization } } as the second argument to the EventSource constructor',
        'Switch the endpoint to POST, since EventSource sends bodies with POST requests',
        'Put the bearer token in the Last-Event-ID header when the client first connects',
        'Read the stream with fetch() and a ReadableStream reader (or a fetch-based SSE client) so you can set headers, or authenticate the stream with a cookie',
      ],
      correct: [3],
      explanation:
        'The native EventSource accepts only a URL and a withCredentials flag; it cannot set headers and only issues GET. A fetch-based reader can send any header and parse the event stream itself, and cookies work with EventSource out of the box. Last-Event-ID is set by the browser only on reconnects and is not a place for credentials.',
      followUps: [
        {
          "q": "You choose a cookie for the SSE endpoint, but the API lives on api.example.com and the app on app.example.com. What do you need to configure?",
          "a": "Use `new EventSource(url, { withCredentials: true })`, so the browser sends cookies cross-origin. The server must reply with `Access-Control-Allow-Origin: https://app.example.com` (not `*`) and `Access-Control-Allow-Credentials: true`. The cookie must be sent to api.example.com: either set by api.example.com itself (host-only), or a `Domain=example.com` cookie (which then goes to all subdomains, a wider scope). Since both are same-site, `SameSite=Lax` works. Also check the Origin header server-side, as cookies are sent automatically."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-18',
      difficulty: 'hard',
      question:
        'An attacker obtains a pre-login session ID from your site and gets it into a victim\'s browser (a cookie set from a vulnerable sibling subdomain). The victim logs in, and the attacker then uses the same ID to access the account. Which control directly prevents this?',
      options: [
        'Marking the session cookie HttpOnly so scripts cannot read it',
        'Binding the session to the client IP address',
        'Shortening the idle timeout from 30 to 10 minutes',
        'Issuing a new session ID at login (and on privilege changes) and invalidating the old one',
      ],
      correct: [3],
      explanation:
        'This is session fixation: the attacker never steals the ID, they plant it. Regenerating the ID at the authentication boundary makes the planted ID worthless. HttpOnly is irrelevant because the attacker already knows the value, timeouts only narrow the window, and IP binding breaks mobile users and fails behind shared NAT.',
      followUps: [
        {
          "q": "The planted cookie came from a vulnerable sibling subdomain. Besides regenerating the session ID, how do you stop sibling subdomains from setting your cookies at all?",
          "a": "Use the `__Host-` prefix for the session cookie: browsers only accept a `__Host-` cookie that is host-only (no Domain attribute), Secure and Path=/, so a sibling subdomain can't set or overwrite it, because any cookie it sets for `.example.com` has a different name. Also move untrusted or vendor-hosted content to a separate registrable domain (e.g. `example-promo.com`), since siblings are same-site and can set domain-wide cookies that interfere. Audit and remove dangling DNS records that allow subdomain takeover."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-19',
      difficulty: 'expert',
      question:
        'Users occasionally add an item to their cart and it vanishes a second later. The frontend fires POST /cart/items and GET /recommendations in parallel. Session config is below (Redis store). What is the most likely cause?',
      code: {
        language: 'typescript',
        code: `app.use(session({
  store: new RedisStore({ client: redis }),
  secret: process.env.SESSION_SECRET!,
  resave: true,
  saveUninitialized: false,
  rolling: true,
}));

app.post('/cart/items', async (req, res) => {
  req.session.cart = [...(req.session.cart ?? []), req.body.item];
  res.sendStatus(201);
});

app.get('/recommendations', async (req, res) => {
  res.json(await recs.forUser(req.session.userId)); // ~300 ms
});`,
      },
      options: [
        'rolling: true resets the cookie, so the browser drops the session that contained the cart',
        'Redis evicted the session key under memory pressure between the two requests',
        'resave: true makes the slow GET write back its stale copy of the session (loaded before the POST) when it finishes, overwriting the cart; set resave: false and keep hot mutable data like carts out of the session blob',
        'saveUninitialized: false prevents the cart from being saved until the next login',
      ],
      correct: [2],
      explanation:
        'Both requests load the same session. The POST saves the new cart, then the GET — which did not modify anything — saves its old copy at the end because resave: true saves unconditionally. Whole-object session writes are last-writer-wins. rolling only refreshes the expiry, eviction would lose the whole session rather than just the cart, and saveUninitialized affects only brand-new sessions.',
      followUps: [
        {
          "q": "Keep the cart out of the session. Where does it go, and how do concurrent adds avoid lost updates?",
          "a": "Store the cart as its own record keyed by user (or by an anonymous cart id in the session): a Redis hash `cart:<id>` with fields per item, or a DB table with one row per line. Updates become atomic field operations (`HINCRBY cart:42 sku123 1`, or `INSERT ... ON CONFLICT DO UPDATE SET qty = qty + 1`), so two parallel requests modify different fields or serialise on one row without overwriting each other. The session holds only identity and small, rarely changing data, and with `resave: false` it's written only on login or logout."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-20',
      difficulty: 'expert',
      question: 'Select ALL statements about SameSite cookies that are accurate in 2026 browsers.',
      options: [
        'A cookie with no SameSite attribute is treated as Lax by Chrome, but Firefox and Safari do not apply that default',
        'Chromium browsers reject a SameSite=None cookie that is not also marked Secure',
        'A POST from evil.example.com to app.example.com is cross-site, so SameSite=Lax cookies are not attached',
        'SameSite=Lax cookies are still sent on top-level cross-site GET navigations, such as clicking a link',
        'SameSite=Strict prevents an XSS payload on your own site from using the session',
      ],
      correct: [0, 1, 3],
      explanation:
        'Lax-by-default shipped in Chromium (Firefox tried it and reverted, Safari never adopted it), and Chromium requires Secure for None. Lax permits top-level GET navigations, which is why state changes must never happen on GET. "Site" means the registrable domain, so evil.example.com and app.example.com are same-site and SameSite does not protect against a sibling subdomain. XSS runs on your own origin, so SameSite offers no protection there.',
      followUps: [
        {
          "q": "Since SameSite doesn't protect against a sibling subdomain, what does protect a state-changing POST from evil.example.com?",
          "a": "CSRF defences that don't rely on 'site': check the `Origin` header (or `Sec-Fetch-Site`) on every state-changing request and allow only your exact origins, so `https://evil.example.com` is rejected even though it's same-site. Add CSRF tokens (synchronizer or double-submit with a `__Host-` cookie, which siblings can't set or overwrite). Require `Content-Type: application/json` with a custom header, which forces a CORS preflight that siblings won't pass. And keep untrusted content off your registrable domain entirely."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-21',
      difficulty: 'hard',
      question:
        'After a security hardening release containing the change below, no user can stay logged in: every request after login is anonymous. No errors are logged server-side. Why?',
      code: {
        language: 'typescript',
        code: `res.cookie('__Host-sid', sessionId, {
  domain: 'example.com',  // so app. and admin. share the session
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 8 * 3600 * 1000,
});`,
      },
      options: [
        'Express cannot serialize cookie names containing a double underscore and silently drops the header',
        'The browser rejects the cookie: the __Host- prefix forbids a Domain attribute, so it is never stored',
        'SameSite=Lax cookies are not sent on the XHR that follows login, so the session appears missing',
        'maxAge in milliseconds overflows the Expires date, so the cookie is expired on arrival',
      ],
      correct: [1],
      explanation:
        '__Host- cookies must be Secure, have Path=/ and have no Domain; a violating Set-Cookie is silently discarded by the browser, so the server never sees an error. Choose one: host-only __Host- cookies (recommended) or a Domain-scoped cookie without the prefix. Express handles the name fine, same-site XHRs carry Lax cookies, and 8 hours in milliseconds is well within range.',
      followUps: [
        {
          "q": "How would you catch this kind of silent cookie rejection before release?",
          "a": "Browsers report rejected cookies in DevTools (Network → Cookies, 'This cookie was blocked'), but nothing reaches the server, so test end to end. An e2e test (Playwright) logs in and asserts the session cookie exists in the browser context with the expected name and attributes, then makes an authenticated request and expects 200. Run it against a staging environment with real HTTPS and domain configuration, since prefix rules depend on Secure and Domain. Also add a production canary: a synthetic login that alerts if post-login requests come back anonymous."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-22',
      difficulty: 'hard',
      question:
        'After marketing adds two more A/B-testing tools, a few percent of loyal users get nginx "400 Bad Request — Request Header Or Cookie Too Large" on every page, while new users are fine. What is the underlying cause and best fix?',
      options: [
        'Long-time users have accumulated cookies until the Cookie header exceeds nginx\'s large_client_header_buffers line size (8 KB by default); trim and scope cookies and move tracking data out of cookies',
        'The session cookie exceeds the 4 KB per-cookie browser limit, so the browser sends it truncated and nginx rejects it',
        'HTTP/2 HPACK cannot compress headers larger than 4 KB, so the edge rejects them; disable HTTP/2',
        'nginx rejects cookies with SameSite=None; switch the tracking cookies to SameSite=Lax',
      ],
      correct: [0],
      explanation:
        'Cookies accumulate per user, so only long-time users cross the header limit, and nginx rejects any header line larger than its buffer. Raising the buffer is a stopgap; the fix is fewer, smaller, well-scoped cookies (and a cookieless domain for assets). Browsers reject oversized cookies at set time rather than truncating on send, HPACK size limits do not cause 400s, and SameSite has no effect on header size.',
      followUps: [
        {
          "q": "Marketing insists their tools need cookies. How do you fix it for users already over the limit, today?",
          "a": "Immediate relief: raise `large_client_header_buffers` to `4 16k` at the edge (a stopgap with slightly more memory per connection). Then shrink: list cookies by name and size from a sample of requests, and delete the worst offenders by setting them expired from your own pages for that domain (you can clear cookies on your registrable domain with `Max-Age=0`, matching path and domain). Scope tag cookies to the paths where they're needed, or move them to `localStorage` or server-side tagging. Add an edge metric for Cookie header size p99 and alert around 6 KB."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-23',
      difficulty: 'expert',
      question:
        'The service verifies RS256 tokens from your IdP with the hand-rolled verifier below, where publicKeyPem is the IdP\'s public key. How can an attacker forge a token that passes?',
      code: {
        language: 'typescript',
        code: `import { createHmac, createVerify } from 'node:crypto';

export function verify(token: string, publicKeyPem: string): boolean {
  const [h, p, sig] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const data = h + '.' + p;
  if (header.alg === 'HS256') {
    const mac = createHmac('sha256', publicKeyPem).update(data).digest('base64url');
    return mac === sig;
  }
  if (header.alg === 'RS256') {
    return createVerify('RSA-SHA256').update(data).verify(publicKeyPem, sig, 'base64url');
  }
  return false;
}`,
      },
      options: [
        'Set alg to "none" and drop the signature; the function accepts unsigned tokens',
        'Replay an expired token, because the verifier never checks exp',
        'Brute-force the HS256 secret, since HMAC keys derived from PEM text have low entropy',
        'Set alg to HS256 and sign the forged payload with HMAC using the public PEM (which is public) as the secret; pin the algorithm to RS256 instead of trusting the header',
      ],
      correct: [3],
      explanation:
        'This is algorithm confusion: the verifier lets the token choose HS256 and then uses the public key as an HMAC secret, which anyone can download from the JWKS. The fix is a server-side algorithm allow-list and key-type checks, as RFC 8725 recommends. alg none returns false here. The missing exp check is a real bug but enables replay, not forgery. No brute force is needed because the key is public.',
      followUps: [
        {
          "q": "Replace the hand-rolled verifier. What must a correct verification check, beyond the signature?",
          "a": "Use a maintained library (`jose`) with the algorithm pinned: `jwtVerify(token, JWKS, { algorithms: ['RS256'], issuer, audience })`. Checks: allowed `alg` only; key selected by `kid` from the issuer's JWKS (cached, refreshed on an unknown kid with rate limiting) and of the right key type; `iss` matches the expected issuer; `aud` contains this service; `exp` and `nbf` with small clock tolerance; `typ` where applicable (RFC 9068 `at+jwt` for access tokens, so ID tokens can't be used as access tokens). Then check domain claims such as scope and tenant before authorising."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-24',
      difficulty: 'hard',
      question:
        'About 3% of requests with freshly issued access tokens fail with "jwt not active" (nbf in the future), always on the same few nodes of one service; a retry a few seconds later succeeds. What is the most likely cause and fix?',
      options: [
        'Those nodes\' clocks lag the issuer\'s by a few seconds; fix time sync (chrony/NTP monitoring) and allow a small clockTolerance of 30–60 s',
        'The JWKS on those nodes is stale, so they verify with the old key; shorten the JWKS cache TTL',
        'The CDN is caching responses that include the token; add Cache-Control: private',
        'The tokens\' exp is too short; raise the access-token lifetime to 1 hour',
      ],
      correct: [0],
      explanation:
        'nbf/iat checks compare token timestamps with the verifier\'s clock, so a node running behind the issuer sees brand-new tokens as not yet valid until its clock catches up. A stale JWKS produces signature errors on every request, not timing-dependent ones; CDN caching and exp length do not produce nbf failures.',
      followUps: [
        {
          "q": "Why not just set clockTolerance to 5 minutes and move on?",
          "a": "Large tolerances widen the validity window on both ends: an expired token keeps working for 5 more minutes everywhere, which matters for 15-minute tokens after logout or revocation (a 33% lifetime extension). It also hides the real problem: a node with a drifting clock breaks other things too (TLS certificate checks, distributed locks, log ordering, TOTP). Keep tolerance small (30–60 s) and fix time sync: monitor chrony offset per node, alert above ~100 ms, and cordon nodes with bad clocks automatically."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-25',
      difficulty: 'expert',
      question:
        'You use refresh-token rotation with reuse detection. An attacker steals a user\'s refresh token and uses it first; the victim does not open the app for three weeks. Which measure actually bounds how long the attacker keeps access?',
      options: [
        'Rotation alone: the attacker\'s next refresh invalidates their previous token',
        'Reducing the access-token lifetime from 15 to 5 minutes',
        'An absolute lifetime for the token family plus an idle expiry, and ideally sender-constraining (DPoP) so a copied token is useless on another device',
        'Storing the refresh token in an HttpOnly cookie instead of app storage',
      ],
      correct: [2],
      explanation:
        'Reuse detection fires only when the legitimate client presents its now-spent token; if the victim is offline, the attacker keeps rotating indefinitely. An absolute family lifetime ends the chain regardless, and DPoP binds tokens to a private key the attacker lacks. Rotation just hands the attacker fresh tokens, shorter access tokens only increase refresh frequency, and cookie storage is a theft-prevention measure that does nothing once the token is stolen.',
      followUps: [
        {
          "q": "Implement DPoP for the mobile app. What does the client do on each request, and what does the server store?",
          "a": "The app generates a key pair at install time, ideally in the Secure Enclave or Android Keystore, so the private key isn't extractable. On token requests and API calls it sends a `DPoP` header: a JWT signed with the private key, containing the HTTP method, URL, timestamp, a unique `jti`, and for API calls a hash of the access token. The authorization server binds tokens to the key's thumbprint (`cnf.jkt`). Resource servers verify the proof's signature, that `htm` and `htu` match, freshness, and the thumbprint match, and keep a short-lived `jti` cache to stop replays. A stolen token is then useless without the device key."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-26',
      difficulty: 'hard',
      question:
        'This rotation code runs on a Postgres-backed auth service. A security test sends the same refresh token in two simultaneous requests and receives two different valid successor tokens. What is the flaw and fix?',
      code: {
        language: 'typescript',
        code: `async function rotate(presentedHash: string) {
  const { rows } = await db.query(
    'SELECT id, family_id, used_at FROM refresh_tokens WHERE token_hash = $1', [presentedHash]);
  const t = rows[0];
  if (!t) throw new Unauthorized();
  if (t.used_at) return revokeFamily(t.family_id);

  await db.query('UPDATE refresh_tokens SET used_at = now() WHERE id = $1', [t.id]);
  return issueSuccessor(t.family_id);
}`,
      },
      options: [
        'Check-then-act race: both requests read used_at IS NULL before either updates. Claim atomically with UPDATE ... SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id, and treat zero rows as reuse',
        'The SELECT should use a read replica to reduce load, which would serialize the requests',
        'The default isolation level is too weak; switching to READ UNCOMMITTED makes the second request see the first update',
        'The token hash comparison should use a constant-time comparison to prevent the race',
      ],
      correct: [0],
      explanation:
        'Under READ COMMITTED both transactions can read the unused row, then both update and issue successors, forking the family and weakening reuse detection. A conditional UPDATE (or SELECT ... FOR UPDATE) makes the claim atomic, so only one request wins. Replicas add lag rather than serialization, Postgres does not implement READ UNCOMMITTED (it behaves as READ COMMITTED), and constant-time comparison addresses timing leaks, not races.',
      followUps: [
        {
          "q": "With the atomic claim, the second concurrent request now looks like 'reuse' and revokes the family. How do you avoid punishing legitimate double-taps?",
          "a": "Distinguish a near-simultaneous sibling from a later replay. When the claim affects zero rows, look at the token's `used_at`: if it was used within a short grace window (say 10–15 s) and, ideally, the request comes from the same client (same DPoP key or device id), treat it as a benign race: return the already-issued successor (store it encrypted briefly) or just a new access token. Outside the window, or from a different device, treat it as reuse and revoke the family. Also fix the client: single-flight refreshes so only one refresh is ever in flight."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-27',
      difficulty: 'medium',
      question:
        'Three requests hit the invoices API: (1) the access token expired a minute ago, (2) a valid "viewer" deletes an invoice in their own tenant, (3) a valid user requests an invoice ID that belongs to another tenant. Which status codes are the best choice, in order?',
      options: [
        '403, 401, 403',
        '401 with WWW-Authenticate, 403, 404',
        '401, 401, 403',
        '403, 403, 404',
      ],
      correct: [1],
      explanation:
        'An expired token is an authentication failure: 401 plus a WWW-Authenticate challenge tells the client to refresh. The viewer is known but lacks permission, so 403. For another tenant\'s object, 404 avoids confirming that the ID exists. Returning 403 for expiry makes clients show "access denied" instead of refreshing, and 401 for the viewer would trigger pointless re-login loops.',
      followUps: [
        {
          "q": "A client gets 403 on an invoice in its own tenant that it could read yesterday. How should the API help the client tell 'role changed' from a bug, without leaking data?",
          "a": "Return a structured error body (RFC 9457 problem details): `{ \"type\": \".../insufficient-permission\", \"title\": \"Forbidden\", \"required\": \"invoices:delete\" }`, naming the missing permission, which reveals nothing about other tenants because the user is already authenticated in this tenant. For OAuth scopes, use `WWW-Authenticate: Bearer error=\"insufficient_scope\", scope=\"invoices:write\"` so clients can request a step-up. Log authorisation decisions with policy version and role at decision time, so support can answer 'why was this denied?' from audit logs."
        }
      ],
    },
    {
      id: 'misc-web-auth-mcq-28',
      difficulty: 'expert',
      question:
        'In this NestJS GraphQL service, invoices are loaded through the provider below, and the repository applies the tenant filter. Under load, a user occasionally sees another tenant\'s invoice total. Why?',
      code: {
        language: 'typescript',
        code: `@Injectable() // default scope: singleton
export class InvoiceLoader {
  readonly byId = new DataLoader<string, Invoice | null>((ids) =>
    this.repo.findByIdsForTenant(ids, this.tenant.current()), // tenant from AsyncLocalStorage
  );
  constructor(private readonly repo: InvoiceRepo, private readonly tenant: TenantContext) {}
}

@ResolveField(() => Invoice)
invoice(@Parent() line: LineItem) {
  return this.loader.byId.load(line.invoiceId);
}`,
      },
      options: [
        'AsyncLocalStorage loses context inside DataLoader\'s batch callback, so the tenant is undefined and the filter is skipped',
        'The singleton DataLoader\'s cache (and batches) span all requests: an invoice loaded for tenant A is returned from cache to tenant B asking for the same ID. Create loaders per request in the GraphQL context, or key the cache by tenant',
        'DataLoader batches IDs from different resolvers into one query, which Postgres reorders so rows come back mismatched',
        '@ResolveField runs before guards, so nested fields bypass the JWT guard entirely',
      ],
      correct: [1],
      explanation:
        'A module-scoped DataLoader memoizes results forever and batches loads from concurrent requests together, so both the cache and a mixed batch (run with whichever tenant context the batch callback sees) cross tenants. Per-request loaders are the standard fix. The tenant filter itself works; DataLoader requires the batch function to return results in key order, which is the repository\'s job; and guards on the root operation do run — the problem is the shared cache.',
      followUps: [
        {
          "q": "You switch to per-request DataLoaders. A teammate proposes a shared cross-request cache for performance. How would you do that safely?",
          "a": "Cache at the repository or service layer, not inside DataLoader, and include the tenant in every cache key: `invoice:<tenantId>:<id>`, read only after the tenant is resolved from the verified request context. Better, cache by primary key only after an authorisation check that the row's tenant matches the caller (check, not trust the key). Use short TTLs and invalidation on writes. Keep DataLoader per request for batching and request-scoped dedupe. Add a test that loads the same id concurrently for two tenants and asserts neither sees the other's row."
        }
      ],
    },
  ],
};

export default topic;
