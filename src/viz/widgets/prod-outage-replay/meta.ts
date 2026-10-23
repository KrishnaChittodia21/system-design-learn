import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'prod-outage-replay',
  title: 'Outage replay: trigger → spread → mitigation → lesson',
  blurb:
    'Step through five outages from this page (GitHub 2018, Cloudflare 2019 and 2025, AWS us-east-1 2025, Meta 2021) and watch the blast radius grow, then replay each with the guard the company added afterwards.',
  placements: [{ topic: 'prod-dissections', heading: '13. The pattern map' }],
};
