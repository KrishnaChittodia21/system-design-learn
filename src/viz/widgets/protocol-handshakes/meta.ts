import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'protocol-handshakes',
  title: 'Round trips before the first byte, and head-of-line blocking',
  blurb: 'Race TCP+TLS 1.2, TCP+TLS 1.3, QUIC and QUIC 0-RTT to the first response byte at your RTT, then compare HTTP/1.1, HTTP/2 and HTTP/3 loading many resources with and without a lost packet.',
  placements: [
    { topic: 'net-protocols', heading: 'HTTP/3 and QUIC' },
    { topic: 'net-protocols', heading: 'TLS 1.3' },
    { topic: 'misc-web-auth', heading: 'HTTP/3 / QUIC' },
  ],
};
