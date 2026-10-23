import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'classic-designs-flow',
  title: 'Classic designs end to end: URL shortener, Snowflake IDs, notifications',
  blurb:
    'Pick a design and step through its core request flow. Shorten a link (base62 counter, scrambled counter or hash with collision retry) and redirect it through the cache with 301 vs 302; build Snowflake IDs bit by bit through sequence overflow and a clock jump; fan a notification out through per-channel queues with retries, failover and dedup.',
  placements: [
    { topic: 'design-classics', heading: 'URL Shortener (2/3)' },
    { topic: 'design-classics', heading: 'URL Shortener (3/3)' },
    { topic: 'design-classics', heading: 'Unique ID Generator' },
    { topic: 'design-classics', heading: 'Notification Service (2/2)' },
  ],
};
