import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'totp',
  title: 'TOTP: from Unix time to a 6-digit code',
  blurb: 'Compute a real RFC 6238 code step by step (counter, HMAC-SHA1, dynamic truncation, mod 10^6), then verify it on a server with clock drift, a ±1 step window and replay protection.',
  placements: [{ topic: 'api-auth-sso', heading: 'TOTP step by step' }],
};
