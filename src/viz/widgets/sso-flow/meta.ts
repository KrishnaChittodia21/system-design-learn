import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'sso-flow',
  title: 'Single sign-on across two apps',
  blurb: 'Follow every redirect between the browser, two apps and the IdP with OIDC (authorization code + PKCE) or SAML 2.0. See why the second app needs no password, and what local logout and single logout really end.',
  placements: [
    { topic: 'api-auth-sso', heading: 'SSO end to end' },
    { topic: 'api-auth-sso', heading: 'OIDC authorization code + PKCE vs SAML' },
    { topic: 'api-auth-sso', heading: 'Single logout and session lifetimes' },
  ],
};
