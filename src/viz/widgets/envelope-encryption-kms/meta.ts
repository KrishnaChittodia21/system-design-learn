import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'envelope-encryption-kms',
  title: 'Envelope encryption with KMS: DEKs, KEKs and crypto-shredding',
  blurb:
    'Write and read tenant records with direct KMS Encrypt, a data key per record, or a cached data key. Then survive a stolen dump, catch a row-swap with encryption context, rotate the KEK without touching data, and crypto-shred one tenant.',
  placements: [{ topic: 'security-general', heading: 'Encryption at rest' }],
};
