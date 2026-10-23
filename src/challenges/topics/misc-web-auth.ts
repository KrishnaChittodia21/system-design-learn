import type { ChallengeSet, Expr } from '../types';

// DNS cutover scenario: api.shop.example has a 24 h TTL today; traffic must move to a new load balancer.
const OLD_TTL_H = 24;
const LOWER: Expr = { knob: 'lower' }; // hours before cutover the TTL is lowered
const NEW_TTL: Expr = { knob: 'ttl' }; // seconds
const RECYCLE: Expr = { knob: 'recycle' };
const KEEP: Expr = { knob: 'keep' }; // minutes the old LB keeps serving after the switch
/** minutes until the last client stops using the old IP */
const STALE_MIN: Expr = {
  op: 'if',
  cond: { left: RECYCLE, op: '==', right: 0 },
  then: Infinity,
  else: {
    op: 'if',
    cond: { left: LOWER, op: '>=', right: OLD_TTL_H },
    then: { op: 'div', args: [NEW_TTL, 60] },
    else: OLD_TTL_H * 60,
  },
};

const set: ChallengeSet = {
  topic: 'misc-web-auth',
  puzzles: [
    {
      mode: 'match',
      id: 'web-transport-symptoms',
      tab: 'Transport symptoms',
      title: 'Live-scores site: match each ticket to its root cause',
      brief:
        'A live-scores site streams updates over SSE and WebSockets behind nginx and an ALB, and the on-call queue has six odd tickets about TLS, streams and DNS. Patch each symptom to the root cause the lesson describes.',
      leftTitle: 'Symptom',
      rightTitle: 'Root cause',
      left: [
        {
          id: 'chain',
          label: 'Chrome loads the API, but Node and curl fail TLS checks',
          answer: 'leaf',
          because:
            'Chrome fetches or caches a missing intermediate certificate; Node, curl and Java do not. Serve the full chain (leaf + intermediates) and test with a non-browser client.',
        },
        {
          id: 'tab7',
          label: 'With six score tabs open, the seventh never updates',
          answer: 'sixconn',
          because:
            'On HTTP/1.1 each SSE stream holds one of the browser’s ~6 connections per origin, so tab seven waits. Over HTTP/2 it is one stream among ~100.',
        },
        {
          id: 'bursts',
          label: 'SSE events arrive in clumps every few seconds',
          answer: 'buffer',
          because:
            'Something between server and browser is buffering the stream. Send X-Accel-Buffering: no, flush after each event and skip gzip on that route.',
        },
        {
          id: 'idle',
          label: 'Quiet WebSockets drop after exactly one minute',
          answer: 'idle',
          because:
            'ALB and nginx close connections idle for 60 s by default. An app-level ping every 20–30 s keeps the socket busy.',
        },
        {
          id: 'nx',
          label: 'A new subdomain won’t resolve an hour after it was created',
          answer: 'negative',
          because:
            'It was queried before it existed, and resolvers cached the NXDOMAIN for min(SOA TTL, SOA MINIMUM). Don’t look names up before you create them.',
        },
        {
          id: 'loss',
          label: 'On lossy mobile links, one lost packet stalls every response',
          answer: 'tcphol',
          because:
            'HTTP/2 multiplexes every stream over one TCP connection, and TCP delivers bytes in order, so one lost segment stalls them all. QUIC recovers loss per stream.',
        },
      ],
      right: [
        { id: 'leaf', label: 'Server sends only the leaf cert', sub: 'no intermediates', is: 'an incomplete certificate chain, which only browsers quietly repair' },
        { id: 'sixconn', label: 'HTTP/1.1 limit: ~6 per origin', sub: 'one per open stream', is: 'the browser’s per-origin connection cap, which long-lived streams use up' },
        { id: 'buffer', label: 'A proxy buffers the response', sub: 'proxy_buffering, gzip', is: 'an intermediary collecting the stream into chunks before forwarding it' },
        { id: 'idle', label: 'Proxy idle timeout (60 s)', sub: 'ALB / nginx default', is: 'the load balancer closing a connection that has carried no bytes for a minute' },
        { id: 'negative', label: 'NXDOMAIN was cached', sub: 'negative caching', is: 'resolvers remembering that a name did not exist, for the negative TTL' },
        { id: 'tcphol', label: 'TCP head-of-line blocking', sub: 'under HTTP/2', is: 'in-order delivery on one connection, so a single lost segment holds back every stream' },
        {
          id: 'push',
          label: 'Chrome removed server push',
          sub: 'since v106',
          decoy: true,
          is: 'true, but it changes nothing for these tickets: push only pre-sent resources, and 103 Early Hints replaced it',
        },
        {
          id: 'samesite',
          label: 'SameSite=Lax blocks the cookie',
          sub: 'cross-site rule',
          decoy: true,
          is: 'a cookie rule for cross-site requests; none of these tickets is cross-site, and Lax still sends cookies on top-level GET navigations',
        },
      ],
      why: [
        'Always serve the full certificate chain; browsers hide the bug, other clients don’t.',
        'Long-lived streams eat HTTP/1.1’s ~6 connections per origin; HTTP/2 makes them streams on one connection.',
        'Anything that buffers turns SSE into bursts, and proxies close idle sockets after 60 s: ping every 20–30 s.',
        'DNS caches “does not exist” too, and HTTP/2 still has TCP head-of-line blocking that only QUIC removes.',
      ],
    },
    {
      mode: 'fault',
      id: 'session-takeover',
      tab: 'Session takeovers',
      title: 'Account takeovers at a shop’s web login',
      brief:
        'Support is seeing account takeovers: attackers send victims a login link carrying a session ID they chose and are logged in as the victim afterwards; a hacked blog.example.com page collected logged-in customers’ session cookies; and a refresh token copied from one phone kept minting access tokens for weeks. Find the three weak pieces.',
      cols: 5,
      rows: 3,
      nodes: [
        { id: 'browser', label: 'Browser / app', sub: 'shop.\u200Bexample.com', kind: 'terminal', col: 0, row: 1 },
        {
          id: 'login',
          label: 'Login handler',
          sub: 'keeps pre-login session ID',
          col: 1,
          row: 1,
          fault: {
            answer: 'regen',
            clue: 'New identity, new ticket',
            why: 'The session ID that existed before login is simply upgraded to logged-in, so an attacker who planted that ID rides the victim’s session (session fixation).',
          },
        },
        {
          id: 'cookie',
          label: 'Set-Cookie: sid',
          sub: 'Domain=\u200Bexample.com',
          col: 2,
          row: 0,
          fault: {
            answer: 'hostcookie',
            clue: 'Keep it to this one host',
            why: 'Domain=example.com ships the session cookie to every subdomain, including the compromised blog, and without HttpOnly any script there can read it.',
          },
        },
        {
          id: 'store',
          label: 'Redis session store',
          sub: 'idle 30m · max 12h',
          col: 3,
          row: 0,
          fine: 'Sessions live server-side with both an idle and an absolute timeout, so revocation is a DELETE. This is the strong part of the design.',
        },
        {
          id: 'refresh',
          label: 'Refresh endpoint',
          sub: 'reusable for 90 days',
          col: 2,
          row: 2,
          fault: {
            answer: 'rotate',
            clue: 'Each one usable exactly once',
            why: 'The refresh token is never replaced, so a copied token keeps working in parallel with the real one and nobody can tell them apart.',
          },
        },
        {
          id: 'api',
          label: 'Orders API',
          sub: 'access token 10 min',
          col: 3,
          row: 2,
          fine: 'Access tokens live 10 minutes, inside the recommended 5–15 minute range. The problem is what keeps minting new ones.',
        },
        {
          id: 'authz',
          label: 'Order ownership check',
          sub: '404 if not yours',
          col: 4,
          row: 1,
          fine: 'Every order is checked against the caller, and other users’ orders return 404 to hide that they exist. AuthZ is fine; the attackers are logging in as the victim.',
        },
      ],
      edges: [
        ['browser', 'login'],
        ['login', 'cookie'],
        ['cookie', 'store'],
        ['login', 'refresh', 'app'],
        ['refresh', 'api'],
        ['store', 'authz'],
        ['api', 'authz'],
      ],
      options: [
        {
          id: 'regen',
          label: 'Regenerate ID at login',
          sub: 'destroy the old one',
          is: 'issuing a fresh session ID at login and on every privilege change, and deleting the old one',
        },
        {
          id: 'hostcookie',
          label: '__Host-sid; HttpOnly; Secure',
          sub: 'SameSite=\u200BLax, no Domain',
          is: 'a host-only cookie that scripts cannot read and the browser sends only over HTTPS to this exact host',
        },
        {
          id: 'rotate',
          label: 'Rotate + reuse detection',
          sub: 'revoke the whole family',
          is: 'single-use refresh tokens: each refresh returns a new one, and presenting a used one revokes every token from that login',
        },
        {
          id: 'longid',
          label: '256-bit session IDs',
          sub: 'harder to guess',
          decoy: true,
          is: 'stronger against guessing, but fixation never guesses: the attacker chooses the ID and the server keeps it',
        },
        {
          id: 'samesitenone',
          label: 'SameSite=None; Secure',
          sub: 'works everywhere',
          decoy: true,
          is: 'the loosest setting: the cookie is sent on every cross-site request, and the blog is same-site anyway',
        },
        {
          id: 'jwtsession',
          label: 'Replace sessions with JWTs',
          sub: 'stateless',
          decoy: true,
          is: 'a step back here: revocation then needs a denylist, and none of the three attacks is about server-side state',
        },
      ],
      metrics: [
        { label: 'Fixation takeovers', bad: 42, good: 0, unit: '/wk', fixedBy: ['login'] },
        { label: 'Cookies sent to blog', bad: 100, good: 0, unit: '%', fixedBy: ['cookie'] },
        { label: 'Stolen refresh life', bad: 90, good: 0, unit: ' d', fixedBy: ['refresh'] },
      ],
      why: [
        'Always issue a new session ID at login and on privilege change, and destroy the old one: that is the whole fix for fixation.',
        'HttpOnly + Secure + SameSite=Lax + the __Host- prefix (no Domain, Path=/) keeps the session cookie on one host and out of scripts; subdomains are same-site.',
        'Rotate refresh tokens on every use and revoke the whole family on reuse, plus an absolute family lifetime.',
        'Server-side sessions already make revocation trivial; the attacks were about how IDs and tokens are issued and scoped.',
      ],
    },
    {
      mode: 'route',
      id: 'authz-status-routes',
      tab: '401, 403 or 404?',
      title: 'Invoices API: where each request stops, and with what',
      brief:
        'A multi-tenant billing API sits behind a gateway that validates tokens and coarse scopes; invoices-svc owns the tenant data. Route each request to where it should end, so failures get the right status code and no tenant learns another tenant’s invoice IDs exist.',
      cols: 5.5,
      rows: 3.65,
      nodes: [
        { id: 'client', label: 'Billing SPA', sub: 'GET /invoices/\u200B123', kind: 'terminal', col: 0, row: 1.2 },
        { id: 'gw', label: 'API gateway', sub: 'token · iss/aud · scope', col: 1.45, row: 1.2 },
        { id: 'r401', label: '401 Unauth\u00ADorized', sub: '+ WWW-Authenticate', kind: 'terminal', col: 1.45, row: 2.75 },
        { id: 'r403', label: '403 Forbidden', sub: 'known caller, “no”', kind: 'terminal', col: 3, row: 0 },
        { id: 'svc', label: 'invoices-svc', sub: 'owner + tenant check', col: 3, row: 1.2 },
        { id: 'r404', label: '404 Not Found', sub: 'hides existence', kind: 'terminal', col: 3, row: 2.75 },
        { id: 'db', label: '200: the invoice', sub: 'from the tenant’s rows', kind: 'terminal', col: 4.6, row: 1.2 },
      ],
      edges: [
        ['client', 'gw'],
        ['gw', 'r401'],
        ['gw', 'r403'],
        ['gw', 'svc'],
        ['svc', 'r403'],
        ['svc', 'r404'],
        ['svc', 'db'],
      ],
      packets: [
        {
          id: 'idtoken',
          label: 'Authorization: Bearer <the ID token>',
          sub: 'aud = billing-spa (the client id)',
          from: 'client',
          paths: [['client', 'gw', 'r401']],
          wrong: {
            'gw>r403':
              '403 means “I know who you are, and no”. This token was never meant for this API, so the caller is not authenticated here at all.',
            'gw>svc':
              'An ID token is a receipt for the client, not an API credential. The gateway checks aud = billing-api and rejects it before any service sees it.',
          },
          done: 'The audience check fails, so the request is unauthenticated: 401 with a WWW-Authenticate challenge. OAuth gives APIs access tokens; OIDC’s ID token only tells the client who logged in.',
        },
        {
          id: 'scope',
          label: 'Valid access token, scope: profile:read',
          sub: 'needs invoices:read',
          from: 'client',
          paths: [['client', 'gw', 'r403']],
          wrong: {
            'gw>r401':
              'The token is valid, so the caller is authenticated. A 401 would make the client log in again, and it would get the same scopes back.',
            'gw>svc':
              'A coarse scope check needs nothing but the token, so the gateway can and should refuse it at the edge instead of loading the service.',
          },
          done: 'Known caller, missing scope: 403 Forbidden, straight from the gateway. Coarse checks such as “scope contains invoices:read” belong at the edge.',
        },
        {
          id: 'othertenant',
          label: 'Valid token + scope, invoice of tenant B',
          sub: 'caller belongs to tenant A',
          from: 'client',
          paths: [['client', 'gw', 'svc', 'r404']],
          wrong: {
            'gw>r401': 'The token and scope are fine, so authentication succeeded. Who owns invoice 123 is a question the gateway can’t answer.',
            'gw>r403': 'The gateway has no tenant data: as far as it knows this caller may read invoices. The object-level check has to happen in the service that owns the rows.',
            'svc>r403':
              'Refusing is right, but 403 confirms that invoice 123 exists in some other tenant. When existence itself is a leak, answer 404.',
            'svc>db':
              'Returning another tenant’s invoice because the token was valid is BOLA/IDOR, OWASP’s number-one API risk: the object was never checked against the caller.',
          },
          right: { 'gw>svc': 'Authenticated and scoped: the gateway passes it on, and the owning service must now check the object.' },
          done: 'The service checks invoice 123 against the caller’s tenant and answers 404, so tenant A can’t even confirm tenant B’s invoice IDs.',
        },
        {
          id: 'own',
          label: 'Valid token + scope, caller’s own invoice',
          sub: 'tenant A reads tenant A',
          from: 'client',
          paths: [['client', 'gw', 'svc', 'db']],
          wrong: {
            'gw>r401': 'Nothing is wrong with this token: the signature, issuer, audience and expiry all check out.',
            'gw>r403': 'The token carries invoices:read, so the coarse check passes.',
            'svc>r403': 'The invoice belongs to the caller’s tenant, so there is nothing to forbid.',
            'svc>r404': 'The invoice exists and belongs to this tenant; hiding it would just be a bug.',
          },
          done: 'Authenticated at the gateway, authorised on the object in the service: 200 with the tenant’s own invoice.',
        },
      ],
      why: [
        '401 means unauthenticated (with a WWW-Authenticate challenge); 403 means a known caller is refused; 404 hides that the object exists.',
        'An ID token is not an API credential: the API checks aud, and a token minted for the client fails.',
        'The gateway does authentication and coarse scope checks; object-level checks need the owning service’s data.',
        'The gap between those two layers is BOLA/IDOR, the most common real API breach.',
      ],
    },
    {
      mode: 'tune',
      id: 'dns-cutover',
      tab: 'DNS cutover',
      title: 'Move api.shop.example to a new load balancer',
      brief:
        'api.shop.example points at the old load balancer with a 24-hour TTL. At 14:00 Thursday it switches to a new one. Every client must be on the new IP within 5 minutes, nobody may hit a dead address, and the old LB is billed until it is turned off, so retire it within an hour.',
      cols: 4,
      rows: 3.2,
      nodes: [
        { id: 'client', label: 'Clients + Node pods', sub: 'keep-alive pools', kind: 'terminal', col: 0, row: 1.3 },
        { id: 'resolver', label: 'Resolvers + OS caches', sub: 'TTL {ttl}s', col: 1.4, row: 1.3 },
        { id: 'old', label: 'Old LB', sub: 'kept {keep} min', col: 3, row: 0.2 },
        { id: 'new', label: 'New LB', sub: 'live at 14:00', col: 3, row: 2.2 },
      ],
      edges: [
        ['client', 'resolver', 'lookup'],
        ['resolver', 'old', 'stale'],
        ['resolver', 'new', 'fresh'],
      ],
      knobs: [
        {
          id: 'lower',
          label: 'Lower TTL ahead by',
          kind: 'choice',
          initial: 1,
          choices: [
            { value: 0, label: 'at cutover' },
            { value: 1, label: '1 h' },
            { value: 12, label: '12 h' },
            { value: 24, label: '24 h' },
          ],
          help: 'when the low TTL is published',
        },
        {
          id: 'ttl',
          label: 'Low TTL',
          kind: 'choice',
          initial: 3600,
          choices: [
            { value: 60, label: '60 s' },
            { value: 300, label: '5 min' },
            { value: 3600, label: '1 h' },
          ],
          help: 'TTL published before the switch',
        },
        { id: 'recycle', label: 'Recycle pooled sockets', kind: 'toggle', initial: 0, help: 'close keep-alive connections so they re-resolve' },
        {
          id: 'keep',
          label: 'Old LB kept for',
          kind: 'choice',
          initial: 0,
          choices: [
            { value: 0, label: 'none' },
            { value: 15, label: '15 min' },
            { value: 60, label: '1 h' },
            { value: 1500, label: '25 h' },
          ],
          help: 'after the record switches',
        },
      ],
      constraints: [
        {
          id: 'stale',
          label: 'All clients moved ≤ 5 min',
          left: STALE_MIN,
          op: '<=',
          right: 5,
          unit: ' min',
          decimals: 0,
          hint: 'A TTL is a promise about the future: caches keep the old answer for the old TTL. And what never re-resolves at all?',
          fail: 'Some clients keep the old IP too long: caches still hold the 24-hour answer, the low TTL is not low enough, or pooled keep-alive sockets never re-resolve.',
          pass: 'The low TTL was in place for a full old TTL, so every cache expires within it, and recycled sockets pick up the new address.',
        },
        {
          id: 'nodead',
          label: 'Old LB outlives stale caches',
          left: KEEP,
          op: '>=',
          right: STALE_MIN,
          unit: ' min',
          decimals: 0,
          hint: 'Clients holding the old answer still connect to the old address until their cache expires.',
          fail: 'The old load balancer is turned off while some clients still resolve to it: their requests hit a dead address.',
          pass: 'The old LB keeps serving until the last stale cache has expired.',
        },
        {
          id: 'cost',
          label: 'Old LB retired ≤ 1 h after',
          left: KEEP,
          op: '<=',
          right: 60,
          unit: ' min',
          hint: 'Keeping the old LB for a day works, but the brief caps it. What would let you retire it sooner?',
          fail: 'Keeping the old LB for a day only papers over a slow cutover, and it is billed the whole time.',
          pass: 'The old LB is retired within the hour.',
        },
      ],
      why: [
        'DNS is cached at every hop (browser, OS, resolver), and each copy honours the TTL it was given.',
        'Lower the TTL at least one old TTL before the cutover: lowering it only helps once the old 24-hour answers have expired everywhere.',
        'Node does not cache DNS, but pooled keep-alive sockets never re-resolve: traffic moves only when those connections close.',
        'Keep the old target serving until the last stale cache can have expired, then retire it.',
      ],
    },
    {
      mode: 'spike',
      id: 'sale-session-spike',
      tab: 'Survive the sale',
      title: 'Sale night: the session store and the JWKS endpoint',
      brief:
        'Scenario numbers: sale traffic climbs from 10K to 60K requests/s, the Redis session primary handles ~100K ops/s and the auth server ~2K requests/s. Every web request looks up its session and slides its expiry with a write; at second 20 the app’s tokens are signed for 6 s with a key missing from the JWKS, and the pods refetch the JWKS on every unknown kid. Pick two changes that keep p99 ≤ 100 ms and errors ≤ 1%.',
      cols: 4,
      rows: 2.3,
      nodes: [
        { id: 'users', label: 'Shoppers + app', sub: 'sale traffic', kind: 'terminal', col: 0, row: 0.6 },
        { id: 'api', label: 'API pods', sub: 'session + JWT verify', col: 1.35, row: 0.6, share: 1, ms: 5 },
        {
          id: 'redis',
          label: 'Redis session store',
          sub: 'primary · ~100K ops/s',
          col: 2.9,
          row: 0,
          share: 2,
          capacity: 100000,
          unit: 'ops/s',
          ms: 1,
          timeoutMs: 50,
        },
        {
          id: 'auth',
          label: 'Auth server JWKS',
          sub: 'logins + keys · ~2K/s',
          col: 2.9,
          row: 1.25,
          capacity: 2000,
          unit: 'req/s',
          base: 300,
          ms: 20,
          timeoutMs: 1000,
        },
      ],
      edges: [
        ['users', 'api'],
        ['api', 'redis', 'GET + touch'],
        ['api', 'auth', 'unknown kid'],
      ],
      duration: 60,
      step: 2,
      traffic: [
        [0, 10000],
        [40, 60000],
        [60, 60000],
      ],
      bursts: [{ node: 'auth', from: 20, to: 26, add: 20000, label: 'kid not in JWKS' }],
      maxCards: 2,
      cards: [
        {
          id: 'throttle',
          label: 'Touch session ≤ once a min',
          sub: 'throttled sliding expiry',
          node: 'api',
          effects: [{ node: 'redis', load: 0.55 }],
          is: 'sliding expiry with the write throttled: a session’s idle timer is refreshed at most once a minute instead of on every request, so the store stops taking a write per read',
        },
        {
          id: 'cooldown',
          label: 'JWKS refetch cooldown 30 s',
          sub: 'cached keys, rate-limited',
          node: 'api',
          effects: [{ node: 'auth', load: 0.003 }],
          is: 'a cached JWKS that refetches on an unknown kid at most once per cooldown per pod, so 20K bad-kid requests a second become a handful of fetches',
        },
        {
          id: 'idle5',
          label: 'Idle timeout 30 → 5 min',
          sub: 'shorter sessions',
          node: 'redis',
          decoy: true,
          effects: [],
          is: 'a shorter idle timeout: sessions die sooner, but every request still does a lookup and a sliding write, so the store’s load is unchanged',
        },
        {
          id: 'retry',
          label: 'Retry JWKS fetch 3×',
          sub: 'on timeout',
          node: 'api',
          decoy: true,
          effects: [{ node: 'auth', load: 3 }],
          is: 'a load amplifier: every timed-out JWKS fetch is sent again to an auth server that is already saturated',
        },
      ],
      goals: [
        {
          metric: 'p99',
          max: 100,
          label: 'p99 ≤ 100 ms',
          fail: 'Enough requests wait on a saturated box that the slowest 1% hit its timeout.',
        },
        {
          metric: 'errors',
          max: 1,
          label: 'Errors ≤ 1%',
          fail: 'A box is past its capacity, and every request beyond it fails.',
        },
      ],
      why: [
        'Sliding expiry writes on every request unless it is throttled: touch at most once a minute and the session store stops taking a write per read.',
        'Server-side sessions scale fine on Redis; what hurts is the extra write, not the lookup model.',
        'Select JWT keys by kid from a cached JWKS, and rate-limit the refetch on an unknown kid, or one bad kid turns every request into a call to the auth server.',
        'Retries against a saturated dependency multiply its load. A shorter idle timeout changes who is logged in, not how much the store works.',
      ],
    },
  ],
};

export default set;
