import type { ChallengeSet } from '../types';

const set: ChallengeSet = {
  topic: 'api-auth-sso',
  puzzles: [
    {
      mode: 'match',
      id: 'auth-method-match',
      tab: 'Pick the auth method',
      title: 'A payments company: who calls, and how they prove it',
      brief:
        'A payments company exposes one platform to five kinds of callers, from staff in a browser to partners’ servers. Patch each caller to the authentication method the lesson’s rule of thumb gives it, so no caller ends up holding a static secret that is equally powerful in every copy.',
      leftTitle: 'Caller',
      rightTitle: 'Method',
      instruction: 'Connect each caller to how it should authenticate',
      left: [
        {
          id: 'staff',
          label: 'Staff open the dashboard and log in through Okta',
          answer: 'oidc',
          because:
            'Humans go through the browser to an IdP: OIDC code + PKCE gives the app an ID token that says who logged in, with MFA, and no password ever reaches the app.',
        },
        {
          id: 'thirdparty',
          label: 'A budgeting app may read a user’s payments, with consent',
          answer: 'oauth',
          because:
            'This is delegation, not login: OAuth2 issues a short-lived access token scoped to what the user approved for that one client, revocable without touching the password.',
        },
        {
          id: 'mesh',
          label: 'orders-svc calls ledger-svc inside your cluster',
          answer: 'mtls',
          because:
            'Machines you control get workload identity: mutual TLS with mesh-issued SPIFFE certificates, rotated hourly, tells ledger exactly which service called.',
        },
        {
          id: 'partner',
          label: 'A partner’s servers call your refunds API',
          answer: 'keyhmac',
          because:
            'Machines you don’t control calling you: an API key says which integration it is (and meters it), and an HMAC signature over each request proves possession without the secret travelling.',
        },
        {
          id: 'webhook',
          label: 'You tell merchants’ servers a payment settled',
          answer: 'webhook',
          because:
            'For webhooks you send, sign timestamp.body with a per-merchant secret: the merchant recomputes the HMAC and rejects old timestamps, so a captured call can’t be replayed later.',
        },
      ],
      right: [
        { id: 'oidc', label: 'OIDC code + PKCE via the IdP', sub: 'ID token for the app', is: 'browser-based login against a central IdP that hands the app a short-lived code and then an ID token' },
        { id: 'oauth', label: 'OAuth2 scoped access token', sub: 'user → client delegation', is: 'delegated authorisation: user X lets client Y use specific scopes, for minutes, on an API' },
        { id: 'mtls', label: 'mTLS with SPIFFE IDs', sub: 'workload identity', is: 'certificates issued by the mesh that prove which workload is on each end of the connection' },
        { id: 'keyhmac', label: 'API key + HMAC request signing', sub: 'SigV4-style', is: 'an identity-and-quota key plus a per-request signature, so a logged request is useless after the time window' },
        { id: 'webhook', label: 'HMAC over timestamp.body', sub: 'per-merchant secret', is: 'a signature you compute over the exact body and a timestamp, which the receiver verifies before trusting the event' },
        {
          id: 'basic',
          label: 'HTTP Basic: user:password',
          sub: 'base64 on every call',
          decoy: true,
          is: 'a static password presented to every TLS-terminating hop and often logged; its leak means full account takeover, so keep it to bootstrap and legacy only',
        },
        {
          id: 'sharedkey',
          label: 'One long-lived shared API key',
          sub: 'same key for everyone',
          decoy: true,
          is: 'a static bearer secret: every copy in a proxy log or Git commit is equally powerful, and it identifies no caller in particular',
        },
      ],
      why: [
        'Humans → OIDC through the browser; delegated third-party access → OAuth2 scopes. OAuth2 is how you get a token, OIDC adds who logged in.',
        'Machines you control → workload identity (mTLS/SPIFFE) or client-credentials tokens.',
        'Machines you don’t control calling you → an API key for identity and quota, plus HMAC signing or mTLS for integrity.',
        'Static bearer secrets (Basic, shared keys) are the weakest option: anyone who sees one is you.',
      ],
    },
    {
      mode: 'sequence',
      id: 'totp-verify',
      tab: 'TOTP, step by step',
      title: 'Verify a 6-digit TOTP code like RFC 6238',
      brief:
        'Priya types 287082 from her authenticator app into the admin console. The server holds her enrolment secret, encrypted. Put the steps it runs to accept the code in order, so a slightly fast phone still works and a phished code cannot be replayed.',
      layout: 'stages',
      steps: [
        {
          id: 'counter',
          label: 'T = floor(unixTime / 30)',
          sub: 'T0 = 0, X = 30 s',
          clue: 'Which 30-second slot is it?',
          is: 'the time-step counter both sides compute from their clocks',
        },
        {
          id: 'msg',
          label: 'T as 8-byte big-endian',
          sub: 'the HMAC message',
          clue: 'Encode the counter',
          is: 'the counter encoded as an 8-byte big-endian integer, exactly as HOTP (RFC 4226) expects',
        },
        {
          id: 'hmac',
          label: 'HMAC-SHA1(secret, T)',
          sub: '20 bytes',
          clue: 'Mix in the shared secret',
          is: 'the keyed hash of the counter with the decrypted enrolment secret',
        },
        {
          id: 'offset',
          label: 'offset = HS[19] & 0x0F',
          sub: 'low nibble: 0–15',
          clue: 'Decide where to read from',
          is: 'dynamic truncation’s offset: the low four bits of the last HMAC byte',
        },
        {
          id: 'bits',
          label: '4 bytes, clear the top bit',
          sub: '31-bit integer',
          clue: 'Avoid signed/unsigned trouble',
          is: 'taking HS[offset..offset+3] and masking the first byte with 0x7F so every language reads the same positive number',
        },
        {
          id: 'mod',
          label: 'code = bin mod 10^6',
          sub: 'zero-padded',
          clue: 'Six digits',
          is: 'reducing the 31-bit number to six digits, left-padded with zeros',
        },
        {
          id: 'window',
          label: 'Compare steps T−1, T, T+1',
          sub: '±30 s drift',
          clue: 'Forgive a little clock drift',
          is: 'checking the submitted code against the neighbouring time steps too, and no wider',
        },
        {
          id: 'replay',
          label: 'Reject step ≤ last used',
          sub: 'then store it',
          clue: 'A code works only once',
          is: 'the replay guard: the matched step must be newer than the last accepted step for this user, which is then saved',
        },
      ],
      decoys: [
        {
          id: 'bcrypt',
          label: 'bcrypt the secret, compare',
          sub: 'like a password',
          is: 'impossible for TOTP: the server needs the secret itself to compute the HMAC, so it is stored encrypted, not hashed',
        },
        {
          id: 'wide',
          label: 'Accept steps T−5 … T+5',
          sub: 'generous window',
          is: 'a window that multiplies the guessing odds; RFC 6238 recommends at most one step of drift',
        },
        {
          id: 'sms',
          label: 'SMS the code to the user',
          sub: 'fallback',
          is: 'a different, weaker factor (SIM swap, SS7); TOTP codes are computed on the device and never sent',
        },
      ],
      why: [
        'Both sides compute the same code from (secret, 30-second slot): after enrolment the secret never crosses the network.',
        'Dynamic truncation picks 4 bytes at an offset from the last nibble and clears the sign bit, then mod 10^6 gives six digits.',
        'Accept T−1..T+1 at most: each extra step is another valid code an attacker can guess.',
        'Remember the last accepted step per user: without it a phished or shoulder-surfed code works again for up to 90 seconds.',
      ],
    },
    {
      mode: 'flow',
      id: 'multi-app-auth',
      tab: 'Auth for many apps',
      title: 'One login for a fintech’s apps and services',
      brief:
        'A fintech runs a merchant web dashboard and 120 microservices, and enterprise customers demand “SSO with our Okta”. Wire the auth path so tokens never sit in the browser, every API checks it is the intended audience, and each internal hop knows both the calling service and the user.',
      cols: 5,
      rows: 3.2,
      nodes: [
        { id: 'browser', label: 'Merchant browser', sub: 'dashboard', kind: 'terminal', col: 0, row: 2.2 },
        { id: 'bff', answer: 'bff', hint: 'Holds tokens; browser gets a cookie', col: 1, row: 2.2 },
        { id: 'idp', answer: 'idp', hint: 'One login, MFA, SAML from Okta in', col: 1, row: 0.4 },
        { id: 'gw', answer: 'gw', hint: 'Checks aud, scopes and rate limits', col: 2, row: 2.2 },
        { id: 'orders', label: 'orders-svc', sub: 'acts for user 42', col: 3, row: 2.2 },
        { id: 'sts', answer: 'sts', hint: 'Mints a short token for the next hop', col: 3, row: 0.4 },
        { id: 'mesh', answer: 'mtls', hint: 'Proves which workload is calling', col: 4, row: 2.2 },
        { id: 'ledger', label: 'ledger-svc', sub: 'checks user + caller', col: 4, row: 0.4 },
      ],
      edges: [
        ['browser', 'bff', 'cookie'],
        ['bff', 'idp', 'OIDC code'],
        ['bff', 'gw', 'token'],
        ['gw', 'orders'],
        ['orders', 'sts', 'exchange'],
        ['orders', 'mesh'],
        ['mesh', 'ledger', 'SPIFFE ID'],
      ],
      options: [
        {
          id: 'bff',
          label: 'Web BFF',
          sub: 'HttpOnly session cookie',
          is: 'a backend-for-frontend that keeps tokens server-side and gives the browser only an HttpOnly session cookie',
        },
        {
          id: 'idp',
          label: 'Central IdP / broker',
          sub: 'OIDC out, SAML/OIDC in',
          is: 'the one identity plane that owns users, MFA and sessions and federates enterprise IdPs; apps speak only OIDC to it',
        },
        {
          id: 'gw',
          label: 'API gateway',
          sub: 'JWKS cached, algs pinned',
          is: 'the edge that validates access tokens, enforces scopes and rate limits by client_id, and strips client-supplied identity headers',
        },
        {
          id: 'sts',
          label: 'Token exchange (STS)',
          sub: 'RFC 8693',
          is: 'a service that swaps the user’s token for a short-lived one with aud = the downstream service, narrower scopes and an act claim',
        },
        {
          id: 'mtls',
          label: 'Mesh mTLS',
          sub: 'SPIFFE IDs, rotated',
          is: 'workload identity: both sides present certificates issued by the mesh, so the callee knows exactly which service called',
        },
        {
          id: 'localstorage',
          label: 'JWT in localStorage',
          sub: 'SPA keeps the token',
          decoy: true,
          is: 'a bearer token any injected script can read and steal; browsers should get an HttpOnly cookie or go through a BFF',
        },
        {
          id: 'forward',
          label: 'Forward the edge token',
          sub: 'same token everywhere',
          decoy: true,
          is: 'a token with a wide audience and a long blast radius: any compromised internal service can replay it anywhere',
        },
        {
          id: 'sharedkey',
          label: 'One shared API key',
          sub: 'for all services',
          decoy: true,
          is: 'a single long-lived secret that identifies nobody in particular, so ledger cannot tell which workload called',
        },
      ],
      why: [
        'One identity plane: a central IdP federates enterprise SAML/OIDC and apps speak only OIDC to it, so SAML stops at the broker.',
        'Web apps use a BFF: tokens stay server-side and the browser holds an HttpOnly session cookie.',
        'The gateway validates aud, pinned algorithms and scopes once at the edge and strips spoofable identity headers.',
        'Internally, token exchange carries the user (aud = the next service, short-lived, act claim) and mTLS with SPIFFE IDs proves the calling workload: authorisation needs both.',
      ],
    },
    {
      mode: 'fault',
      id: 'saml-acs-hunt',
      tab: 'SAML ACS pentest',
      title: 'Enterprise SSO: the SAML endpoint lets strangers in',
      brief:
        'A pentest of a B2B app’s SAML login found three ways in. A tester signed a Response with a certificate they made themselves and was accepted; another added a second, unsigned assertion naming the CFO next to their own valid one and became the CFO; and a SAMLResponse copied from a proxy log logged someone in again three minutes later. Find the three weak checks.',
      cols: 4.6,
      rows: 2.85,
      nodes: [
        {
          id: 'idp',
          label: 'Customer Okta (IdP)',
          sub: 'signs RSA-SHA256',
          col: 0,
          row: 0.3,
          fine: 'The customer’s IdP signs every assertion with RSA-SHA256 over exclusive-canonicalised XML, valid for 5 minutes. The holes are in what the app checks.',
        },
        { id: 'browser', label: 'Browser', sub: 'auto-POST form', kind: 'terminal', col: 0, row: 1.9 },
        {
          id: 'sig',
          label: 'Verify XML signature',
          sub: 'cert from <KeyInfo>',
          col: 1.25,
          row: 1.9,
          fault: {
            answer: 'pinned',
            clue: 'Trust only the key set up out of band',
            why: 'The verifier uses the certificate embedded in the message itself, so anyone can sign a Response with their own key and it “verifies”.',
          },
        },
        {
          id: 'aud',
          label: 'Audience + Recipient',
          sub: '= our entity ID, our ACS',
          col: 2.5,
          row: 1.9,
          fine: 'Audience must equal our entity ID and Destination/Recipient our ACS URL, so an assertion minted for another app is rejected. This check is right.',
        },
        {
          id: 'attr',
          label: 'Map the user',
          sub: 'first <Assertion> in doc',
          col: 3.75,
          row: 1.9,
          fault: {
            answer: 'signedel',
            clue: 'Read what the signature protects',
            why: 'The code reads NameID and groups from the first Assertion it finds, not from the element the signature covers, so an inserted unsigned assertion wins: XML Signature Wrapping.',
          },
        },
        {
          id: 'fresh',
          label: 'Freshness check',
          sub: 'NotOnOrAfter only',
          col: 3.75,
          row: 0.3,
          fault: {
            answer: 'onetime',
            clue: 'Each assertion works exactly once',
            why: 'Only the expiry is checked, so a captured Response is valid for anyone until NotOnOrAfter. Nothing ties it to a request we sent or remembers that it was used.',
          },
        },
        {
          id: 'session',
          label: 'Local session',
          sub: 'own cookie, own lifetime',
          col: 2.5,
          row: 0.3,
          fine: 'After validation the app mints its own session and cookie, as every SP should. It only trusts what the checks before it let through.',
        },
      ],
      edges: [
        ['idp', 'browser', 'SAMLResponse'],
        ['browser', 'sig', 'POST /acs'],
        ['sig', 'aud'],
        ['aud', 'attr'],
        ['attr', 'fresh'],
        ['fresh', 'session'],
      ],
      options: [
        {
          id: 'pinned',
          label: 'Verify with the pinned cert',
          sub: 'from IdP metadata',
          is: 'checking the signature only against the IdP certificate exchanged out of band in its metadata, never one the message brings along',
        },
        {
          id: 'signedel',
          label: 'Read the signed element',
          sub: 'by the referenced ID',
          is: 'taking NameID and attributes only from the assertion the verified signature references, and rejecting documents with extra assertions',
        },
        {
          id: 'onetime',
          label: 'InResponse\u200BTo + seen IDs',
          sub: 'store ID until expiry',
          is: 'matching InResponseTo to an AuthnRequest we issued and storing each assertion ID until it expires, so a second use is refused',
        },
        {
          id: 'encrypt',
          label: 'Encrypt the assertion',
          sub: 'EncryptedAssertion',
          decoy: true,
          is: 'confidentiality for the attributes, not authenticity: a forged, wrapped or replayed assertion is accepted just the same',
        },
        {
          id: 'skew',
          label: 'Allow 10 min clock skew',
          sub: 'fewer login errors',
          decoy: true,
          is: 'a wider window that makes replay easier; the lesson keeps skew to 2–3 minutes',
        },
        {
          id: 'nodtd',
          label: 'Disable DTDs in the parser',
          sub: 'no external entities',
          decoy: true,
          is: 'a real ACS hardening step against XXE, but none of these three attacks needs an external entity',
        },
      ],
      metrics: [
        { label: 'Self-signed logins', bad: 100, good: 0, unit: '%', fixedBy: ['sig'] },
        { label: 'Wrapped logins', bad: 100, good: 0, unit: '%', fixedBy: ['attr'] },
        { label: 'Replay window', bad: 5, good: 0, unit: ' min', fixedBy: ['fresh'] },
      ],
      why: [
        'Verify the signature with the IdP’s pinned certificate from metadata, never with the KeyInfo certificate inside the message.',
        'Read attributes only from the element the signature covers: XML Signature Wrapping is the signature SAML bug.',
        'InResponseTo ties the Response to our AuthnRequest, and stored assertion IDs make each assertion single-use until it expires.',
        'Audience, Recipient and a 2–3 minute skew complete the ACS checklist. Encryption adds secrecy, not trust.',
      ],
    },
    {
      mode: 'route',
      id: 'bff-token-routes',
      tab: 'Where tokens go',
      title: 'Merchant platform: send each credential to its checker',
      brief:
        'The merchant web app sits behind a BFF, the mobile app holds its own tokens, and every API call passes the gateway, which validates access tokens with cached JWKS. Route each credential to the one place that should see it, so no token reaches the browser and no API sees a credential it can’t validate.',
      cols: 5.4,
      rows: 3.2,
      nodes: [
        { id: 'browser', label: 'Merchant browser', sub: 'session cookie only', kind: 'terminal', col: 0, row: 1.25 },
        { id: 'mobile', label: 'Mobile app', sub: 'tokens in Keychain', kind: 'terminal', col: 0, row: 2.55 },
        { id: 'idp', label: 'IdP token endpoint', sub: 'codes · refresh tokens', col: 1.7, row: 0 },
        { id: 'bff', label: 'Web BFF', sub: 'holds the web tokens', col: 1.7, row: 1.25 },
        { id: 'gw', label: 'API gateway', sub: 'JWKS cached · checks aud', col: 3.1, row: 2.55 },
        { id: 'orders', label: 'orders-api', sub: 'aud = orders-api', col: 4.5, row: 2.55 },
      ],
      edges: [
        ['browser', 'idp', '/authorize'],
        ['browser', 'bff', 'cookie'],
        ['browser', 'gw'],
        ['bff', 'idp', 'back channel'],
        ['bff', 'gw', 'Bearer'],
        ['mobile', 'bff'],
        ['mobile', 'gw'],
        ['gw', 'orders'],
      ],
      packets: [
        {
          id: 'callback',
          label: 'Login callback: ?code=…&state=…',
          sub: 'IdP redirected back after MFA',
          from: 'browser',
          paths: [['browser', 'bff', 'idp']],
          wrong: {
            'browser>idp':
              'The IdP has already done its part: it issued this one-time code and redirected the browser to the app’s redirect_uri. The code must reach the app that holds the PKCE verifier.',
            'browser>gw':
              'The gateway validates access tokens, not authorization codes. A code is useless until it is redeemed at the token endpoint together with the code_verifier.',
            'bff>gw':
              'The BFF has no access token yet. It first checks state against its cookie, then redeems the code at the token endpoint.',
          },
          right: { 'browser>bff': 'The redirect_uri is the BFF: it checks state against the cookie it set before the redirect.' },
          done: 'The BFF POSTs code + code_verifier to /token server-to-server, validates the ID token (signature, iss, aud, exp, nonce) and gives the browser only an HttpOnly session cookie.',
        },
        {
          id: 'dashboard',
          label: 'Dashboard loads today’s orders',
          sub: 'Cookie: __Host-sid=8f3a…',
          from: 'browser',
          paths: [['browser', 'bff', 'gw', 'orders']],
          wrong: {
            'browser>gw':
              'In a BFF design the browser holds no access token, only a session cookie that the gateway cannot validate. Sending tokens from browser JavaScript is exactly what the BFF removes.',
            'browser>idp':
              'Priya is already logged in: the BFF has her session. The IdP handles logins and token grants, not data requests.',
            'bff>idp':
              'The BFF already holds a valid access token. A call to the IdP on every request would put the identity plane on the hot path for nothing; the gateway validates the token locally.',
          },
          right: { 'bff>gw': 'The BFF looks up the session and attaches the access token it keeps server-side.' },
          done: 'Cookie in, token out: the BFF swaps the session for its server-side access token, and the gateway checks signature, pinned algorithms and aud = orders-api with cached JWKS, no I/O.',
        },
        {
          id: 'refresh',
          label: 'The BFF’s access token expired',
          sub: 'presents refresh token RT2',
          from: 'bff',
          paths: [['bff', 'idp']],
          wrong: {
            'bff>gw':
              'A refresh token is sent only to the authorization server. The gateway would reject it, and every extra place it travels is another place it can leak.',
          },
          done: 'The refresh goes to the token endpoint over the back channel. With rotation it returns a new access token and a new refresh token, and RT2 becomes single-use history.',
        },
        {
          id: 'mobile-call',
          label: 'Mobile app lists today’s orders',
          sub: 'Authorization: Bearer eyJ… (10 min)',
          from: 'mobile',
          paths: [['mobile', 'gw', 'orders']],
          wrong: {
            'mobile>bff':
              'The BFF exists to keep tokens out of the browser. The mobile app is its own OIDC client (code + PKCE, refresh token in the Keychain) and calls the gateway directly.',
          },
          done: 'A native app sends its short-lived access token straight to the gateway, which validates it exactly as it does for the BFF’s calls.',
        },
      ],
      why: [
        'An authorization code goes to the app that holds the PKCE verifier and is redeemed once, server-to-server, at the token endpoint.',
        'With a BFF the browser only ever holds an HttpOnly session cookie; the BFF attaches the access token on the way to the gateway.',
        'Refresh tokens are sent only to the authorization server; access tokens only to resource servers whose aud they name.',
        'Native apps are their own OIDC clients and call the gateway with their own short-lived tokens.',
      ],
    },
  ],
};

export default set;
