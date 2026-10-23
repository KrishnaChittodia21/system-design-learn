import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'jwt-validation-gauntlet',
  title: 'JWT validation: which check stops which attack',
  blurb:
    'Send a valid token, alg:none, an RS256→HS256 confusion, an expired or wrong-audience token, a freshly rotated key, a missing scope or someone else’s order through a naive and a strict validator, and see exactly where each is stopped or slips through.',
  placements: [{ topic: 'api-security', heading: 'JWT anatomy' }],
};
