// Pure price-time priority matching engine for one symbol (no React, Node-testable).
//   Book: per side, price level → FIFO queue of resting orders (integer ticks and quantities).
//   An incoming order matches the best opposite level while it crosses (buy: ask ≤ limit; sell:
//   bid ≥ limit; market: any price), oldest order first, each fill at the RESTING (maker) price.
//   A partially filled maker keeps its place in the queue. A limit remainder rests at the tail of
//   its level; a market remainder is cancelled (IOC). Cancel removes by order id in O(1).
import type { BaseFrame } from '../../core';

export type Side = 'buy' | 'sell';
export type BuyType = 'limit' | 'market';

export interface Params {
  buyQty: number;
  buyType: BuyType;
}

export const DEFAULT_PARAMS: Params = { buyQty: 450, buyType: 'limit' };
export const BUY_LIMIT = 102;
export const PRICES = [103, 102, 101, 100, 99];

export interface Order {
  id: string;
  side: Side;
  price: number;
  qty: number;
  seq: number;
}

export interface Trade {
  buy: string;
  sell: string;
  price: number;
  qty: number;
  maker: string;
}

export interface Incoming {
  id: string;
  side: Side;
  /** null for a market order */
  price: number | null;
  qty: number;
  left: number;
}

export interface Frame extends BaseFrame {
  bids: Order[];
  asks: Order[];
  incoming: Incoming | null;
  trades: Trade[];
  /** maker id hit in this step */
  hit: string | null;
  /** order id that just rested / was cancelled */
  rested: string | null;
  cancelled: string | null;
}

export class Book {
  bids: Order[] = [];
  asks: Order[] = [];
  seq = 0;
  private byId = new Map<string, Order>();

  add(o: Omit<Order, 'seq'>) {
    const order = { ...o, seq: ++this.seq };
    (o.side === 'buy' ? this.bids : this.asks).push(order);
    this.byId.set(o.id, order);
    this.sort();
    return order;
  }
  sort() {
    this.bids.sort((a, b) => b.price - a.price || a.seq - b.seq);
    this.asks.sort((a, b) => a.price - b.price || a.seq - b.seq);
  }
  cancel(id: string) {
    const o = this.byId.get(id);
    if (!o) return false;
    this.byId.delete(id);
    const side = o.side === 'buy' ? this.bids : this.asks;
    side.splice(side.indexOf(o), 1);
    return true;
  }
  best(side: Side): Order | undefined {
    return side === 'buy' ? this.bids[0] : this.asks[0];
  }
  /** one fill against the best opposite order, or null if the incoming order no longer crosses */
  fillOnce(inc: Incoming): Trade | null {
    if (inc.left <= 0) return null;
    const maker = this.best(inc.side === 'buy' ? 'sell' : 'buy');
    if (!maker) return null;
    if (inc.price !== null && (inc.side === 'buy' ? maker.price > inc.price : maker.price < inc.price)) return null;
    const qty = Math.min(inc.left, maker.qty);
    maker.qty -= qty;
    inc.left -= qty;
    if (maker.qty === 0) this.cancel(maker.id);
    return {
      buy: inc.side === 'buy' ? inc.id : maker.id,
      sell: inc.side === 'sell' ? inc.id : maker.id,
      price: maker.price,
      qty,
      maker: maker.id,
    };
  }
  snapshot() {
    return { bids: this.bids.map((o) => ({ ...o })), asks: this.asks.map((o) => ({ ...o })) };
  }
}

export function simulate({ buyQty, buyType }: Params): Frame[] {
  const book = new Book();
  const frames: Frame[] = [];
  const trades: Trade[] = [];

  [
    { id: 's1', side: 'sell', price: 101, qty: 100 },
    { id: 's2', side: 'sell', price: 101, qty: 200 },
    { id: 's3', side: 'sell', price: 102, qty: 300 },
    { id: 's4', side: 'sell', price: 103, qty: 150 },
    { id: 'b1', side: 'buy', price: 100, qty: 200 },
    { id: 'b2', side: 'buy', price: 99, qty: 300 },
    { id: 'b3', side: 'buy', price: 100, qty: 100 },
  ].forEach((o) => book.add(o as Omit<Order, 'seq'>));

  const snap = (caption: string, incoming: Incoming | null, extra: Partial<Pick<Frame, 'hit' | 'rested' | 'cancelled'>> = {}, predict?: string) =>
    frames.push({
      caption,
      predict,
      ...book.snapshot(),
      incoming: incoming ? { ...incoming } : null,
      trades: trades.map((t) => ({ ...t })),
      hit: extra.hit ?? null,
      rested: extra.rested ?? null,
      cancelled: extra.cancelled ?? null,
    });

  const spread = () => `Best bid ${book.best('buy')?.price ?? '—'}, best ask ${book.best('sell')?.price ?? '—'}`;

  snap(`The book for one symbol: buyers sorted highest price first, sellers lowest first, and within a price level by arrival (FIFO). ${spread()}.`, null);

  /** run one incoming order fill by fill */
  const run = (inc: Incoming, label: string, firstPredict?: string) => {
    snap(`${label} arrives.${inc.price !== null && !crosses(inc) ? ` It does not cross the spread (${spread().toLowerCase()}).` : ' It crosses the spread, so it matches against the best opposite orders.'}`, inc, {}, firstPredict);
    let t: Trade | null;
    let n = 0;
    while ((t = book.fillOnce(inc))) {
      n++;
      trades.push(t);
      const maker = [...book.bids, ...book.asks].find((o) => o.id === t!.maker);
      snap(
        `Fill ${n}: ${t.qty} @ ${t.price} against ${t.maker}, the oldest order at the best price${
          maker ? `. ${t.maker} is only partly filled; its remaining ${maker.qty} keeps its place at the front of ${maker.price}` : ` (fully filled, removed from the level)`
        }. ${inc.left} left to fill.`,
        inc,
        { hit: t.maker },
      );
    }
    if (inc.left > 0) {
      if (inc.price === null) {
        snap(`The opposite side is exhausted, so the market order's remaining ${inc.left} is cancelled (immediate-or-cancel). A market order never rests.`, inc, { cancelled: inc.id });
      } else {
        const ahead = (inc.side === 'buy' ? book.bids : book.asks).filter((o) => o.price === inc.price).map((o) => o.id);
        book.add({ id: inc.id, side: inc.side, price: inc.price, qty: inc.left });
        snap(
          `${n ? `No more crossing orders at or ${inc.side === 'buy' ? 'below' : 'above'} ${inc.price}, so the remaining ${inc.left}` : `All ${inc.left}`} ${n ? 'rests' : 'rest'} at ${inc.price}${ahead.length ? `, behind ${ahead.join(' and ')}, which arrived earlier (time priority)` : ' as a new price level'}. ${spread()}.`,
          { ...inc },
          { rested: inc.id },
        );
      }
    }
  };
  const crosses = (inc: Incoming) => {
    const m = book.best(inc.side === 'buy' ? 'sell' : 'buy');
    return !!m && (inc.price === null || (inc.side === 'buy' ? m.price <= inc.price : m.price >= inc.price));
  };

  run({ id: 's5', side: 'sell', price: 101, qty: 50, left: 50 }, 'Sell limit 101 × 50 (s5)');

  const buy: Incoming = { id: 'B', side: 'buy', price: buyType === 'limit' ? BUY_LIMIT : null, qty: buyQty, left: buyQty };
  run(
    buy,
    buyType === 'limit' ? `Buy limit ${BUY_LIMIT} × ${buyQty} (B)` : `Buy MARKET × ${buyQty} (B)`,
    'Three sells wait at 101: s1, s2 and s5. In what order are they filled?',
  );
  const filled = buyQty - buy.left;
  const cost = trades.filter((t) => t.buy === 'B').reduce((a, t) => a + t.price * t.qty, 0);
  const vwap = filled ? (cost / filled).toFixed(2) : '—';

  book.cancel('b1');
  snap(`b1 cancels. The orderId → node map finds it directly and unlinks it from the 100 level in O(1); b3 moves to the front. ${spread()}.`, null, { cancelled: 'b1' });

  run({ id: 's6', side: 'sell', price: 99, qty: 250, left: 250 }, 'Sell limit 99 × 250 (s6)');

  snap(
    `Summary: B bought ${filled} at an average of ${vwap}${buy.left && buyType === 'market' ? `, and ${buy.left} was cancelled for lack of liquidity` : ''}. Every trade printed at the resting order's price, oldest first at each level. ${trades.length} trades in total. ${spread()}.`,
    null,
  );
  return frames;
}
