// Pure simulation of browser SSO across two apps and one Identity Provider:
// OIDC authorization code + PKCE, or SAML 2.0 SP-initiated (Redirect binding AuthnRequest,
// POST binding signed assertion to the ACS). The second app reuses the IdP session cookie, so
// no password is asked. Optional logout: local only (IdP session survives → silent re-login)
// or single logout (OIDC RP-initiated + back-channel logout, or SAML front-channel SLO).
// No React here so it can be tested with Node.
import type { BaseFrame } from '../../core';

export type Lane = 'appA' | 'browser' | 'idp' | 'appB';
export const LANES: Lane[] = ['appA', 'browser', 'idp', 'appB'];
export type Protocol = 'oidc' | 'saml';
export type IdpState = 'active' | 'expired';
export type Logout = 'none' | 'local' | 'slo';

export interface Params {
  protocol: Protocol;
  /** IdP session state when the user later opens App B */
  idpSession: IdpState;
  logout: Logout;
}
export const DEFAULT_PARAMS: Params = { protocol: 'oidc', idpSession: 'active', logout: 'none' };

export type Kind = 'redirect' | 'request' | 'response' | 'back' | 'secret';
export interface Msg {
  n: number;
  from: Lane;
  to: Lane;
  label: string;
  kind: Kind;
}

export interface Sessions {
  /** cookie present in the browser */
  jar: { idp: boolean; A: boolean; B: boolean };
  /** server-side session valid */
  srv: { idp: boolean; A: boolean; B: boolean };
}

export interface SsoFrame extends BaseFrame {
  msgs: Msg[];
  /** index into msgs of the message drawn as "current", -1 if this frame is a narration step */
  cur: number;
  s: Sessions;
  prompts: number;
  phase: string;
}

export function laneName(l: Lane, p: Protocol): string {
  if (l === 'browser') return 'Browser';
  if (l === 'idp') return p === 'oidc' ? 'IdP (OpenID Provider)' : 'IdP';
  const x = l === 'appA' ? 'A' : 'B';
  return p === 'oidc' ? `App ${x} (RP)` : `SP ${x}`;
}

export function simulate(p: Params): SsoFrame[] {
  const oidc = p.protocol === 'oidc';
  const A = oidc ? 'App A' : 'SP A';
  const B = oidc ? 'App B' : 'SP B';
  const frames: SsoFrame[] = [];
  const msgs: Msg[] = [];
  const s: Sessions = { jar: { idp: false, A: false, B: false }, srv: { idp: false, A: false, B: false } };
  let prompts = 0;
  let phase = '';
  const snap = (): Sessions => ({ jar: { ...s.jar }, srv: { ...s.srv } });
  const say = (caption: string, predict?: string) => frames.push({ msgs: [...msgs], cur: -1, s: snap(), prompts, phase, caption, predict });
  const send = (from: Lane, to: Lane, label: string, kind: Kind, caption: string, predict?: string) => {
    msgs.push({ n: msgs.length + 1, from, to, label, kind });
    frames.push({ msgs: [...msgs], cur: msgs.length - 1, s: snap(), prompts, phase, caption: `${msgs.length}. ${caption}`, predict });
  };
  const app = (x: 'A' | 'B'): Lane => (x === 'A' ? 'appA' : 'appB');

  /** login page + credentials; returns after the IdP session exists */
  const passwordAtIdp = (forApp: string) => {
    send('idp', 'browser', '200 login page', 'response', `No valid IdP session cookie, so the IdP shows its login page (for ${forApp}).`);
    prompts++;
    send('browser', 'idp', 'POST username + password (+MFA)', 'secret', `The user types the password into the IdP only; ${forApp} never sees it. Password prompt #${prompts}.`);
  };

  /** full sign-in to one app; `silentOk` means the IdP session is valid */
  const signIn = (x: 'A' | 'B', path: string, opts: { predictAt?: string; reauth?: boolean } = {}) => {
    const appN = x === 'A' ? A : B;
    const L = app(x);
    send('browser', L, `GET ${path}`, 'request', `The browser asks ${appN} for ${path}. There is no ${appN} session cookie${x === 'B' ? ` (${A}'s cookie belongs to ${A}'s domain and is never sent here)` : ''}, so ${appN} must authenticate the user.`);
    if (oidc) {
      send(
        L,
        'browser',
        `302 → IdP /authorize?client_id=${x}…`,
        'redirect',
        `${appN} creates state, nonce and a PKCE code_verifier (kept in a short-lived cookie) and redirects to /authorize with response_type=code, scope=openid, state, nonce and code_challenge = BASE64URL(SHA-256(verifier)).`,
        opts.predictAt,
      );
    } else {
      send(
        L,
        'browser',
        `302 → IdP ?SAMLRequest=AuthnRequest`,
        'redirect',
        `${appN} builds an AuthnRequest (ID=_${x.toLowerCase()}1, Issuer = ${appN}'s entityID, ACS URL), deflates and base64-encodes it into the URL (HTTP-Redirect binding), and sets RelayState=${path}.`,
        opts.predictAt,
      );
    }
    const hasIdp = s.jar.idp && s.srv.idp;
    send(
      'browser',
      'idp',
      `GET ${oidc ? '/authorize' : '/sso'}${s.jar.idp ? ' + idp_sid cookie' : ''}`,
      'request',
      s.jar.idp
        ? `The browser follows the redirect and automatically attaches the IdP's own session cookie idp_sid, because this request goes to the IdP's domain.${hasIdp ? '' : ' But that session has expired on the IdP.'}`
        : `The browser follows the redirect to the IdP. It holds no IdP session cookie${frames.length > 4 && !s.srv.idp ? ' any more' : ''}.`,
    );
    if (!hasIdp) {
      passwordAtIdp(appN);
      s.jar.idp = true;
      s.srv.idp = true;
    }
    if (oidc) {
      send(
        'idp',
        'browser',
        `${hasIdp ? '' : 'Set-Cookie idp_sid; '}302 → ${x}/callback?code=…&state=…`,
        'redirect',
        hasIdp
          ? `Valid SSO session: the IdP skips the login page and immediately issues a one-time authorization code for client ${x}. This silent redirect is single sign-on.`
          : `The IdP creates its SSO session (cookie idp_sid on the IdP's domain) and redirects back with a short-lived, one-time authorization code bound to client ${x}, its redirect_uri and the code_challenge.`,
      );
      send(
        'browser',
        L,
        'GET /callback?code=…&state=…',
        'request',
        `${appN} checks that state matches the value it stored (CSRF protection).`,
        x === 'A' && !opts.reauth ? 'The authorization code just travelled in the browser URL (history, logs, Referer). If an attacker steals it, can they get tokens?' : undefined,
      );
      send(
        L,
        'idp',
        'POST /token code + code_verifier',
        'back',
        `Back channel: ${appN} redeems the code server-to-server with its client credentials and the code_verifier. The IdP checks SHA-256(verifier) = code_challenge and that the code is unused, so a stolen code alone gets nothing.`,
      );
      send(
        'idp',
        L,
        `id_token (aud=${x}) + access_token`,
        'back',
        `The IdP returns a signed JWT id_token (iss, sub, aud=${x}, exp, nonce) plus an access token (and optionally a refresh token). Tokens never travel in the browser URL.`,
      );
      s.jar[x] = true;
      s.srv[x] = true;
      send(
        L,
        'browser',
        `Set-Cookie ${x}_sid; 302 ${path}`,
        'response',
        `${appN} verifies the id_token signature with the IdP's JWKS and checks iss, aud, exp and nonce, then creates its OWN session cookie ${x}_sid. Signed in to ${appN}${opts.reauth ? ' again' : ''}.`,
      );
    } else {
      send(
        'idp',
        'browser',
        `${hasIdp ? '' : 'Set-Cookie idp_sid; '}auto-POST form: SAMLResponse`,
        'redirect',
        `${hasIdp ? 'Valid IdP session: no login page. ' : 'The IdP creates a new SSO session (cookie idp_sid). '}It builds an XML assertion (Subject NameID, Audience = ${appN}, NotBefore/NotOnOrAfter, InResponseTo=_${x.toLowerCase()}1), signs it with its private key (XML-DSig) and returns a self-submitting HTML form.`,
      );
      send(
        'browser',
        L,
        'POST /acs SAMLResponse + RelayState',
        'request',
        `HTTP-POST binding: the browser carries the signed assertion to ${appN}'s Assertion Consumer Service. No back-channel call: the assertion itself is the credential, and the browser could read it.`,
        x === 'A' ? `The assertion passed through the browser. What stops someone from editing it, or replaying it to ${B}?` : undefined,
      );
      s.jar[x] = true;
      s.srv[x] = true;
      send(
        L,
        'browser',
        `Set-Cookie ${x}_sid; 302 ${path}`,
        'response',
        `${appN} verifies the signature with the IdP certificate from metadata, Audience, InResponseTo, the time window and that the assertion ID was not seen before (replay). Then it creates its own session ${x}_sid.`,
      );
    }
  };

  phase = 'Setup';
  say(
    oidc
      ? `Two apps trust one IdP via OpenID Connect. Each app is registered as a client with a redirect_uri; both trust the IdP's signing keys (JWKS). The user has never signed in.`
      : `Two service providers trust one IdP via SAML 2.0. They exchanged metadata up front: entityIDs, ACS URLs and the IdP's signing certificate. The user has never signed in.`,
  );
  phase = `Sign in to ${A}`;
  signIn('A', '/dashboard');

  phase = `Open ${B}`;
  if (p.idpSession === 'expired') {
    s.srv.idp = false;
    say(`Hours later the IdP session times out (idle/absolute lifetime). The browser still holds the idp_sid cookie, but the IdP no longer honours it. ${A}'s own session is unaffected.`);
  }
  signIn('B', '/reports', { predictAt: `${B} sends the user to the IdP. Will the user have to type a password again?` });

  if (p.logout === 'none') {
    phase = 'Done';
    say(
      `Result: ${prompts} password prompt${prompts === 1 ? '' : 's'} for two apps. There are now three separate sessions: the IdP's (idp_sid) and one per app. SSO works because the IdP session cookie is shared, not the app cookies.`,
    );
    return frames;
  }

  phase = `Log out of ${A}`;
  if (p.logout === 'local') {
    send('browser', 'appA', 'GET /logout', 'request', `The user clicks "Log out" in ${A}.`);
    s.jar.A = false;
    s.srv.A = false;
    send('appA', 'browser', 'Clear A_sid; 200 "Logged out"', 'response', `${A} deletes only its own session. The IdP session and ${B}'s session are untouched.`, `The user now opens ${A} again. Will they be asked for a password?`);
    phase = `Re-open ${A}`;
    send('browser', 'appA', 'GET /dashboard', 'request', `No ${A} session, so ${A} starts a new sign-in.`);
    send('appA', 'browser', oidc ? '302 → IdP /authorize' : '302 → IdP ?SAMLRequest', 'redirect', `Redirect to the IdP as before.`);
    send('browser', 'idp', `GET ${oidc ? '/authorize' : '/sso'} + idp_sid cookie`, 'request', `The IdP session cookie is still valid.`);
    send('idp', 'browser', oidc ? '302 → A/callback?code=…' : 'auto-POST form: SAMLResponse', 'redirect', `No login page: the IdP silently issues a new ${oidc ? 'code' : 'assertion'}.`);
    s.jar.A = true;
    s.srv.A = true;
    send(
      'browser',
      'appA',
      oidc ? 'callback → tokens → Set-Cookie A_sid' : 'POST /acs → Set-Cookie A_sid',
      'request',
      `${A} completes the ${oidc ? 'code exchange' : 'assertion check'} and the user is signed straight back in. A local logout does not end SSO.`,
    );
    phase = 'Done';
    say(`Local logout is a trap on shared machines: the user thinks they are out, but the IdP session (and ${B}) still let anyone in without a password. Real logout must end the IdP session too.`);
    return frames;
  }

  // single logout
  send('browser', 'appA', 'GET /logout', 'request', `The user clicks "Log out" in ${A}, which offers single logout.`);
  s.jar.A = false;
  s.srv.A = false;
  if (oidc) {
    send('appA', 'browser', 'Clear A_sid; 302 → IdP /end_session?id_token_hint', 'redirect', `${A} deletes its session and redirects to the IdP's end_session_endpoint (RP-initiated logout) with id_token_hint and post_logout_redirect_uri.`);
    send('browser', 'idp', 'GET /end_session + idp_sid', 'request', `The IdP ends the SSO session and looks up every client that received tokens in it: ${B}.`, `${B} still has its own session cookie in the browser. How can the IdP end it?`);
    s.srv.idp = false;
    send('idp', 'appB', 'POST /backchannel_logout logout_token', 'back', `OIDC Back-Channel Logout: the IdP POSTs a signed logout_token (iss, aud=B, sid, events) directly to ${B}'s server, without needing the browser.`);
    s.srv.B = false;
    send('appB', 'idp', '200 OK', 'back', `${B} validates the token and deletes the matching server-side session. Its B_sid cookie in the browser is now worthless.`);
    s.jar.idp = false;
    send('idp', 'browser', 'Clear idp_sid; 302 → post_logout_redirect_uri', 'redirect', `The IdP clears its cookie and returns the user to ${A}'s logged-out page.`);
  } else {
    send('appA', 'browser', 'Clear A_sid; 302 → IdP ?SAMLRequest=LogoutRequest', 'redirect', `${A} deletes its session and sends a LogoutRequest (NameID, SessionIndex) to the IdP's SLO endpoint.`);
    s.srv.idp = false;
    send('browser', 'idp', 'GET /slo LogoutRequest', 'request', `The IdP ends its session and must now tell every other SP that used it: ${B}.`, `SAML SLO here runs through the browser (front channel). What could stop ${B} from being logged out?`);
    send('idp', 'browser', `302 → ${B} /slo ?LogoutRequest`, 'redirect', `Front-channel SLO: the IdP bounces the browser to ${B} with a LogoutRequest.`);
    send('browser', 'appB', 'GET /slo LogoutRequest', 'request', `This only works if the browser actually makes this hop. A closed tab or a slow or erroring SP breaks the chain (and with hidden iframes instead of redirects, third-party-cookie blocking does too).`);
    s.jar.B = false;
    s.srv.B = false;
    send('appB', 'browser', 'Clear B_sid; 302 → IdP LogoutResponse', 'redirect', `${B} deletes its session and answers with a LogoutResponse.`);
    send('browser', 'idp', 'GET /slo LogoutResponse (from B)', 'request', `The IdP records that ${B} confirmed.`);
    s.jar.idp = false;
    send('idp', 'browser', `Clear idp_sid; 302 → ${A} LogoutResponse`, 'redirect', `All SPs are done, so the IdP clears its cookie and returns a LogoutResponse to ${A}.`);
  }
  phase = `Re-open ${B}`;
  send('browser', 'appB', `GET /reports${s.jar.B ? ' + B_sid' : ''}`, 'request', s.jar.B ? `The browser still sends B_sid, but ${B} deleted that session, so it is rejected.` : `No ${B} session any more.`);
  send('appB', 'browser', oidc ? '302 → IdP /authorize' : '302 → IdP ?SAMLRequest', 'redirect', `${B} starts a new sign-in.`);
  send('browser', 'idp', `GET ${oidc ? '/authorize' : '/sso'}`, 'request', `No IdP session cookie either.`);
  prompts++;
  send('idp', 'browser', '200 login page', 'response', `Password required again (prompt #${prompts}): single logout ended the IdP session and every app session that hung off it.`);
  phase = 'Done';
  say(
    oidc
      ? `Single logout = end the IdP session + tell each app. Back-channel logout is reliable because it is server-to-server; front-channel (iframe) logout depends on the browser and third-party cookies. Access tokens already issued still live until exp, so keep them short.`
      : `Single logout = end the IdP session + tell each SP. SAML front-channel SLO is fragile, so many deployments also keep app sessions short and rely on re-authentication at the IdP.`,
  );
  return frames;
}
