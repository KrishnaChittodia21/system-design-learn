import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'order-book-matching',
  title: 'Order book: price-time priority, partial fills and cancels',
  blurb:
    'A limit order book for one symbol. Step through a resting sell, an aggressive buy that sweeps several price levels fill by fill, an O(1) cancel and a sell that crosses the spread. Change the buy size and make it a market order to see partial fills, resting remainders and slippage.',
  placements: [{ topic: 'design-advanced', heading: 'Stock exchange (2/3)' }],
};
