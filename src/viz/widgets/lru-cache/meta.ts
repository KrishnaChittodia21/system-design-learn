import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'lru-cache',
  title: 'LRU cache: hash map + doubly linked list',
  blurb: 'Step through get, put and evict and watch every pointer write. Change the capacity, or switch to a one-off scan that flushes the hot set.',
  placements: [
    { topic: 'lld-lru-cache', heading: 'The data structure: why a hash map AND a doubly linked list' },
    { topic: 'lld-lru-cache', heading: 'Pointer moves step by step' },
    { topic: 'cache-fundamentals', heading: 'Eviction policies and an O(1) LRU implementation' },
  ],
};
