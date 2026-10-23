// Pure timelines for four ways of getting server events to a client over 60 s:
// short polling, long polling, Server-Sent Events and WebSockets. Same events, same RTT,
// so delivery latency, request count and wasted (empty) responses are directly comparable.
import { rng, type BaseFrame } from '../../core';

export type Lane = 'short' | 'long' | 'sse' | 'ws';
export const LANES: Lane[] = ['short', 'long', 'sse', 'ws'];
export const LANE_NAME: Record<Lane, string> = {
  short: 'Short polling',
  long: 'Long polling',
  sse: 'Server-Sent Events',
  ws: 'WebSocket',
};
export type Traffic = 'chatty' | 'bursty' | 'quiet';

export const DURATION = 60; // seconds
export const STEP = 2; // seconds per frame
export const LONG_POLL_TIMEOUT = 25; // below the 60 s idle timeouts on the path
export const HEARTBEAT = 15; // SSE comment / WS ping interval
export const HEADER_BYTES = 700; // request + response headers per HTTP exchange
export const CLIENTS = 10_000_000;
/** client → server messages (e.g. "typing…", a chat send) */
export const UPSTREAM = [12, 40];

export interface Params {
  /** short-polling interval, seconds */
  interval: number;
  /** round-trip time, ms */
  rttMs: number;
  traffic: Traffic;
}

export const DEFAULT_PARAMS: Params = { interval: 5, rttMs: 100, traffic: 'bursty' };

/** A message on the wire: sent at `from` by one side, arriving at `to`. */
export interface Msg {
  from: number;
  to: number;
  dir: 'up' | 'down';
  kind: 'poll' | 'data' | 'empty' | 'open' | 'push' | 'beat' | 'post' | 'ack' | 'frame';
  /** number of events carried */
  events?: number;
}

export interface LaneTimeline {
  msgs: Msg[];
  /** intervals the server holds an open request / connection */
  holds: [number, number][];
  /** per event: time it reached the client */
  delivered: number[];
}

export function events(traffic: Traffic): number[] {
  if (traffic === 'quiet') return [22.4, 51.3];
  if (traffic === 'bursty') return [8.1, 8.12, 8.15, 8.4, 31.2, 31.23, 31.6, 47.5, 47.52];
  const r = rng(42);
  const out: number[] = [];
  let t = 1;
  for (;;) {
    t += 1 + r() * 4;
    if (t >= DURATION - 1) break;
    out.push(Math.round(t * 10) / 10);
  }
  return out;
}

export function timeline(lane: Lane, p: Params, ev: number[]): LaneTimeline {
  const h = p.rttMs / 2000; // one-way, seconds
  const msgs: Msg[] = [];
  const holds: [number, number][] = [];
  const delivered: number[] = new Array(ev.length).fill(Infinity);

  if (lane === 'short') {
    let cursor = -Infinity; // server time of the previous poll
    for (let t = 0; t < DURATION; t += p.interval) {
      const at = t + h;
      const got = ev.map((e, i) => [e, i] as const).filter(([e]) => e > cursor && e <= at);
      msgs.push({ from: t, to: at, dir: 'up', kind: 'poll' });
      msgs.push({ from: at, to: at + h, dir: 'down', kind: got.length ? 'data' : 'empty', events: got.length });
      for (const [, i] of got) delivered[i] = at + h;
      cursor = at;
    }
  } else if (lane === 'long') {
    let cursor = -Infinity;
    let t = 0;
    while (t < DURATION) {
      const at = t + h;
      msgs.push({ from: t, to: at, dir: 'up', kind: 'poll' });
      const pending = ev.filter((e) => e > cursor);
      const next = pending.length ? Math.max(at, pending[0]) : Infinity;
      const timeout = at + LONG_POLL_TIMEOUT;
      const respond = Math.min(next, timeout);
      if (respond > at) holds.push([at, Math.min(respond, DURATION)]);
      const got = ev.map((e, i) => [e, i] as const).filter(([e]) => e > cursor && e <= respond);
      if (respond >= DURATION) break;
      msgs.push({ from: respond, to: respond + h, dir: 'down', kind: got.length ? 'data' : 'empty', events: got.length });
      for (const [, i] of got) delivered[i] = respond + h;
      cursor = respond;
      t = respond + h; // client re-polls immediately
    }
  } else {
    // SSE and WebSocket: one long-lived connection, events pushed as they happen
    msgs.push({ from: 0, to: h, dir: 'up', kind: 'open' });
    msgs.push({ from: h, to: 2 * h, dir: 'down', kind: 'open' });
    holds.push([h, DURATION]);
    ev.forEach((e, i) => {
      const at = Math.max(e, h);
      msgs.push({ from: at, to: at + h, dir: 'down', kind: 'push', events: 1 });
      delivered[i] = at + h;
    });
    for (let b = HEARTBEAT; b < DURATION; b += HEARTBEAT) msgs.push({ from: b, to: b + h, dir: 'down', kind: 'beat' });
  }
  // client → server messages: a separate HTTP POST everywhere except on the WebSocket
  for (const u of UPSTREAM) {
    if (lane === 'ws') msgs.push({ from: u, to: u + h, dir: 'up', kind: 'frame' });
    else {
      msgs.push({ from: u, to: u + h, dir: 'up', kind: 'post' });
      msgs.push({ from: u + h, to: u + 2 * h, dir: 'down', kind: 'ack' });
    }
  }
  msgs.sort((a, b) => a.from - b.from);
  return { msgs, holds, delivered };
}

export interface LaneStats {
  requests: number;
  empty: number;
  delivered: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  headerBytes: number;
  /** HTTP requests per second if CLIENTS clients behaved like this */
  fleetRps: number;
  openConnections: number;
}

export function statsAt(lane: Lane, tl: LaneTimeline, ev: number[], now: number): LaneStats {
  const sent = tl.msgs.filter((m) => m.from <= now);
  const requests = sent.filter((m) => m.dir === 'up' && (m.kind === 'poll' || m.kind === 'post' || m.kind === 'open')).length;
  const empty = sent.filter((m) => m.kind === 'empty').length;
  const lats = ev.map((e, i) => [e, tl.delivered[i]] as const).filter(([, d]) => d <= now).map(([e, d]) => (d - e) * 1000);
  const elapsed = Math.max(now, STEP);
  return {
    requests,
    empty,
    delivered: lats.length,
    avgLatencyMs: lats.length ? lats.reduce((s, x) => s + x, 0) / lats.length : 0,
    maxLatencyMs: lats.length ? Math.max(...lats) : 0,
    headerBytes: requests * HEADER_BYTES,
    fleetRps: (requests / elapsed) * CLIENTS,
    openConnections: lane === 'short' ? 0 : 1,
  };
}

export interface Frame extends BaseFrame {
  now: number;
  stats: Record<Lane, LaneStats>;
}

export interface Sim {
  events: number[];
  lanes: Record<Lane, LaneTimeline>;
}

export function build(p: Params): Sim {
  const ev = events(p.traffic);
  return { events: ev, lanes: { short: timeline('short', p, ev), long: timeline('long', p, ev), sse: timeline('sse', p, ev), ws: timeline('ws', p, ev) } };
}

const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);
export function fmtRps(x: number) {
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)}M/s`;
  if (x >= 1e3) return `${Math.round(x / 1e3)}K/s`;
  return `${Math.round(x)}/s`;
}

export function simulate(p: Params): (Frame & { sim: Sim })[] {
  const sim = build(p);
  const ev = sim.events;
  const frames: (Frame & { sim: Sim })[] = [];
  for (let now = 0; now <= DURATION; now += STEP) {
    const stats = Object.fromEntries(LANES.map((l) => [l, statsAt(l, sim.lanes[l], ev, now)])) as Record<Lane, LaneStats>;
    const fresh = ev.filter((e) => e > now - STEP && e <= now);
    const up = UPSTREAM.filter((u) => u > now - STEP && u <= now);
    let caption: string;
    let predict: string | undefined;
    if (now === 0) {
      caption = `t=0: every client opens. Short polling sends its first GET; long polling sends a GET the server will hold; SSE opens one text/event-stream response; WebSocket sends an HTTP Upgrade and gets 101. RTT ${p.rttMs} ms, polling every ${p.interval} s.`;
      predict = `The first server event arrives at t=${ev[0]} s. Which transport shows it to the user last, and roughly how late?`;
    } else if (fresh.length) {
      const worst = (l: Lane) => Math.max(...fresh.map((e) => sim.lanes[l].delivered[ev.indexOf(e)] - e));
      const lp = worst('long');
      const sp = worst('short');
      caption = `t≈${fresh[0]} s: ${fresh.length > 1 ? `${fresh.length} events arrive` : 'an event arrives'} at the server. SSE and the WebSocket push ${fresh.length > 1 ? 'each one' : 'it'} immediately (≈${ms(p.rttMs / 2)}). The held long poll returns at once${fresh.length > 1 ? ', and the events that land while the client re-polls ride the next response thanks to the cursor, one extra round trip later' : ''} (up to ${ms(lp * 1000)}). Short polling waits for its next poll: up to ${Number.isFinite(sp) ? ms(sp * 1000) : 'after this window'}.`;
    } else if (up.length) {
      caption = `t=${up[0]} s: the client sends a message upstream. On the WebSocket it is one more frame on the open connection. SSE and both polling styles need a separate HTTP POST, with headers, auth and a response.`;
    } else {
      const s = stats.short;
      caption = `t=${now} s: short polling has sent ${s.requests} request${s.requests === 1 ? '' : 's'} and ${s.empty} came back empty.${now <= STEP * 2 ? ' The long poll is parked on the server, waiting.' : ''} ${stats.long.empty ? `Long polling hit its ${LONG_POLL_TIMEOUT} s timeout ${stats.long.empty}× (204, re-poll). ` : ''}SSE and WebSocket hold one connection each, with a heartbeat every ${HEARTBEAT} s to keep idle timeouts and dead-peer detection honest.`;
    }
    frames.push({ now, stats, sim, caption, predict });
  }
  const last = frames[frames.length - 1];
  const s = last.stats;
  last.caption = `After 60 s: short polling made ${s.short.requests} requests (${s.short.empty} empty) with ${ms(s.short.avgLatencyMs)} average delay; across ${CLIENTS / 1e6}M clients that is ${fmtRps(s.short.fleetRps)} of mostly empty HTTP. Long polling: ${s.long.requests} requests, ${ms(s.long.avgLatencyMs)} average${s.long.requests > s.short.requests ? ' (with busy traffic it pays one full HTTP round trip per delivery, more requests than polling)' : ''}. SSE and WebSocket: one connection each and ≈${ms(p.rttMs / 2)} delay; the WebSocket also carried the upstream messages without extra requests.`;
  return frames;
}
