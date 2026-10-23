import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'sfu-mesh-mcu',
  title: 'Video call topologies: mesh vs MCU vs SFU',
  blurb:
    'Add people to a call one at a time and watch each participant\'s uplink and downlink, the server\'s work and the added latency. Mesh uplink grows with every guest, an MCU burns CPU re-encoding, and an SFU just forwards packets, with simulcast keeping thumbnails cheap.',
  placements: [{ topic: 'design-modern', heading: 'Video conferencing (Zoom/Meet) (1/3)' }],
};
