// Pure simulation of round trips before the first response byte (TCP+TLS 1.2, TCP+TLS 1.3,
// QUIC 1-RTT, QUIC 0-RTT) and of request multiplexing / head-of-line blocking
// (HTTP/1.1 with 6 connections vs HTTP/2 vs HTTP/3). Time is counted in RTTs; ms come from `rttMs`.
import type { BaseFrame } from '../../core';

export type Mode = 'handshake' | 'multiplex';
export type Proto = 'tls12' | 'tls13' | 'quic' | 'quic0';
export type Http = 'h1' | 'h2' | 'h3';

export interface Params {
  mode: Mode;
  rttMs: number;
  /** handshake mode: protocol narrated in the captions */
  focus: Proto;
  /** multiplex mode: number of small resources the page needs */
  resources: number;
  /** multiplex mode: lose one packet of the first response */
  loss: boolean;
}

// ------------------------------------------------------------------ handshake race
export type FlightKind = 'tcp' | 'tls' | 'data' | 'resp';
export interface Flight {
  /** send time in half-RTTs (one-way delays); arrives at t + 1 */
  t: number;
  dir: 'c2s' | 's2c';
  label: string;
  kind: FlightKind;
  note: string;
}

export const PROTO_NAME: Record<Proto, string> = {
  tls12: 'TCP + TLS 1.2',
  tls13: 'TCP + TLS 1.3',
  quic: 'QUIC (HTTP/3) 1-RTT',
  quic0: 'QUIC 0-RTT resume',
};
export const PROTOS: Proto[] = ['tls12', 'tls13', 'quic', 'quic0'];

export const FLIGHTS: Record<Proto, Flight[]> = {
  tls12: [
    { t: 0, dir: 'c2s', label: 'SYN', kind: 'tcp', note: 'the client opens TCP with SYN' },
    { t: 1, dir: 's2c', label: 'SYN-ACK', kind: 'tcp', note: 'the server answers SYN-ACK' },
    { t: 2, dir: 'c2s', label: 'ACK + ClientHello', kind: 'tls', note: 'TCP is up after 1 RTT; ClientHello rides with the ACK' },
    { t: 3, dir: 's2c', label: 'ServerHello, Cert, Done', kind: 'tls', note: 'the server sends ServerHello, its certificate and ServerHelloDone' },
    { t: 4, dir: 'c2s', label: 'KeyExch, CCS, Fin', kind: 'tls', note: 'the client sends its key exchange and Finished (TLS 1.2 needs this 2nd round trip)' },
    { t: 5, dir: 's2c', label: 'CCS, Finished', kind: 'tls', note: 'the server Finished completes the 2-RTT TLS 1.2 handshake' },
    { t: 6, dir: 'c2s', label: 'GET /', kind: 'data', note: 'only now, after 3 RTTs, can the request go out' },
    { t: 7, dir: 's2c', label: '200 OK', kind: 'resp', note: 'the first response byte arrives' },
  ],
  tls13: [
    { t: 0, dir: 'c2s', label: 'SYN', kind: 'tcp', note: 'the client opens TCP with SYN' },
    { t: 1, dir: 's2c', label: 'SYN-ACK', kind: 'tcp', note: 'the server answers SYN-ACK' },
    { t: 2, dir: 'c2s', label: 'ACK + ClientHello+key', kind: 'tls', note: 'ClientHello already carries an X25519 key share, guessing the key exchange up front' },
    { t: 3, dir: 's2c', label: 'ServerHello…Finished', kind: 'tls', note: 'ServerHello, certificate and server Finished all fit in one flight' },
    { t: 4, dir: 'c2s', label: 'Finished + GET /', kind: 'data', note: 'the client Finished and the GET leave together: TLS cost just 1 RTT' },
    { t: 5, dir: 's2c', label: '200 OK', kind: 'resp', note: 'the first response byte arrives' },
  ],
  quic: [
    { t: 0, dir: 'c2s', label: 'ClientHello + key', kind: 'tls', note: 'QUIC folds the transport and TLS 1.3 handshakes into one: no separate TCP handshake' },
    { t: 1, dir: 's2c', label: 'ServerHello…Finished', kind: 'tls', note: 'the server finishes transport and crypto setup in one flight' },
    { t: 2, dir: 'c2s', label: 'Finished + GET /', kind: 'data', note: 'after a single RTT the request goes out' },
    { t: 3, dir: 's2c', label: '200 OK', kind: 'resp', note: 'the first response byte arrives' },
  ],
  quic0: [
    { t: 0, dir: 'c2s', label: 'ClientHello+PSK + GET', kind: 'data', note: 'a returning client uses its session ticket (PSK) and sends the GET as early data in the very first flight' },
    { t: 1, dir: 's2c', label: 'ServerHello + 200 OK', kind: 'resp', note: 'the server accepts the early data and answers in its first flight' },
  ],
};

/** time to first response byte, in RTTs */
export function ttfbRtts(p: Proto): number {
  const fl = FLIGHTS[p];
  return (fl[fl.length - 1].t + 1) / 2;
}

export interface HandshakeFrame extends BaseFrame {
  mode: 'handshake';
  /** current time in half-RTTs */
  T: number;
  /** finished protocols → ttfb in RTTs */
  done: Partial<Record<Proto, number>>;
  /** a summary frame shows totals */
  summary?: boolean;
}

function handshake({ rttMs, focus }: Params): HandshakeFrame[] {
  const frames: HandshakeFrame[] = [];
  const ms = (rtts: number) => `${Math.round(rtts * rttMs)}ms`;
  const maxT = Math.max(...PROTOS.map((p) => ttfbRtts(p) * 2));
  const done: Partial<Record<Proto, number>> = {};
  frames.push({
    mode: 'handshake',
    T: 0,
    done: {},
    caption: `Four clients race to fetch the same page over a ${rttMs}ms round-trip path (DNS already cached). Each arrow is a one-way trip of ${Math.round(rttMs / 2)}ms.`,
  });
  for (let T = 1; T <= maxT; T++) {
    const arrived = PROTOS.flatMap((p) => FLIGHTS[p].filter((f) => f.t + 1 === T).map((f) => ({ p, f })));
    const finishedNow: Proto[] = [];
    for (const { p, f } of arrived) if (f.kind === 'resp') {
      done[p] = T / 2;
      finishedNow.push(p);
    }
    const mine = FLIGHTS[focus].find((f) => f.t + 1 === T);
    const parts: string[] = [];
    parts.push(`t=${T / 2} RTT (${ms(T / 2)}).`);
    if (mine) parts.push(`${PROTO_NAME[focus]}: "${mine.label}" reaches the ${mine.dir === 'c2s' ? 'server' : 'client'}: ${mine.note}.`);
    else if (done[focus] !== undefined) parts.push(`${PROTO_NAME[focus]} already has its first byte (${done[focus]} RTT).`);
    for (const p of finishedNow) if (p !== focus) parts.push(`${PROTO_NAME[p]} gets its first byte: ${T / 2} RTT = ${ms(T / 2)}.`);
    let predict: string | undefined;
    if (T === 1) predict = 'QUIC 0-RTT has already put its GET on the wire. When will its first response byte arrive?';
    if (T === 5) predict = 'TLS 1.3 has just sent Finished + GET, while TLS 1.2 is still mid-handshake. How many RTTs behind TLS 1.3 will TLS 1.2 finish?';
    if (T === 6)
      parts.push(`TLS 1.2 has only now finished its handshake (2 RTTs vs 1 for TLS 1.3); its GET leaves now, so it finishes 1 RTT (${ms(1)}) later.`);
    frames.push({ mode: 'handshake', T, done: { ...done }, caption: parts.join(' '), predict });
  }
  frames.push({
    mode: 'handshake',
    T: maxT,
    done: { ...done },
    caption: `0-RTT's catch: early data can be captured and replayed by an attacker, so servers accept it only for idempotent requests (a GET, never "pay $80"). Others get 425 Too Early and retry after the handshake.`,
  });
  frames.push({
    mode: 'handshake',
    T: maxT,
    done: { ...done },
    caption: `Reuse beats everything: on an already-open keep-alive connection any of these pays just 1 RTT (${ms(1)}), with no handshake at all. That is why connection pools matter more than protocol upgrades.`,
  });
  frames.push({
    mode: 'handshake',
    T: maxT,
    done: { ...done },
    summary: true,
    caption: `Time to first byte at ${rttMs}ms RTT: TLS 1.2 ${ttfbRtts('tls12')} RTT = ${ms(4)}, TLS 1.3 ${ttfbRtts('tls13')} RTT = ${ms(3)}, QUIC ${ttfbRtts('quic')} RTT = ${ms(2)}, QUIC 0-RTT ${ttfbRtts('quic0')} RTT = ${ms(1)}. Drag the RTT slider: the gap grows linearly with distance.`,
  });
  return frames;
}

// ------------------------------------------------------------------ multiplexing & HOL blocking
export type Phase = 'queued' | 'req' | 'resp' | 'lost' | 'hol' | 'done' | 'idle';
export interface Req {
  /** connection index (h1) or 0 */
  conn: number;
  start: number;
  /** when the response is complete and usable, in RTTs */
  done: number;
  lost: boolean;
  /** stalled behind another stream's lost packet (TCP HOL) */
  hol: boolean;
}

export const HTTP_NAME: Record<Http, string> = { h1: 'HTTP/1.1 · 6 TCP conns', h2: 'HTTP/2 · 1 TCP conn', h3: 'HTTP/3 · QUIC' };
export const HTTPS: Http[] = ['h1', 'h2', 'h3'];
/** extra time to detect the loss and retransmit (duplicate ACKs → fast retransmit) */
export const RECOVERY_RTT = 1;

export function schedule(http: Http, n: number, loss: boolean): Req[] {
  const reqs: Req[] = [];
  if (http === 'h1') {
    const free = new Array(6).fill(0) as number[]; // time each connection becomes free
    for (let i = 0; i < n; i++) {
      const c = i % 6;
      const start = free[c];
      const lost = loss && i === 0;
      const done = start + 1 + (lost ? RECOVERY_RTT : 0);
      free[c] = done;
      reqs.push({ conn: c, start, done, lost, hol: false });
    }
    return reqs;
  }
  for (let i = 0; i < n; i++) {
    const lost = loss && i === 0;
    // HTTP/2: one TCP byte stream; every stream's later bytes wait for the retransmit
    const hol = http === 'h2' && loss && i !== 0;
    reqs.push({ conn: 0, start: 0, done: 1 + (lost || hol ? RECOVERY_RTT : 0), lost, hol });
  }
  return reqs;
}

export function phaseAt(r: Req, T: number): Phase {
  if (T < r.start) return 'queued';
  if (T >= r.done) return 'done';
  const age = T - r.start;
  if (age < 0.5) return 'req';
  if (age < 1) return r.lost && age >= 0.5 ? 'lost' : 'resp';
  return r.lost ? 'lost' : r.hol ? 'hol' : 'resp';
}

export interface MuxFrame extends BaseFrame {
  mode: 'multiplex';
  /** current time in RTTs */
  T: number;
  horizon: number;
  reqs: Record<Http, Req[]>;
  summary?: boolean;
}

export function finish(reqs: Req[]): number {
  return Math.max(...reqs.map((r) => r.done));
}

function multiplex({ rttMs, resources: n, loss }: Params): MuxFrame[] {
  const reqs = { h1: schedule('h1', n, loss), h2: schedule('h2', n, loss), h3: schedule('h3', n, loss) };
  const fin = { h1: finish(reqs.h1), h2: finish(reqs.h2), h3: finish(reqs.h3) };
  const horizon = Math.max(fin.h1, fin.h2, fin.h3);
  const ms = (rtts: number) => `${Math.round(rtts * rttMs)}ms`;
  const frames: MuxFrame[] = [];
  const base = { mode: 'multiplex' as const, horizon, reqs };
  const count = (h: Http, T: number) => reqs[h].filter((r) => r.done <= T).length;
  frames.push({
    ...base,
    T: 0,
    caption: `The page needs ${n} small resources over warm connections (handshakes already paid). HTTP/1.1 allows one request in flight per connection, and browsers open about 6; HTTP/2 and HTTP/3 send all ${n} at once as streams.`,
  });
  frames.push({
    ...base,
    T: 0,
    caption: `t=0: HTTP/1.1 sends 6 requests, one per connection, and ${Math.max(0, n - 6)} wait in the browser's queue. HTTP/2 and HTTP/3 send all ${n} requests as interleaved streams in one flight.`,
  });
  for (let q = 1; q <= horizon * 4; q++) {
    const T = q / 4;
    const parts: string[] = [`t=${T} RTT (${ms(T)}).`];
    let predict: string | undefined;
    if (T === 0.25) parts.push(`Requests are half-way to the server: 6 on HTTP/1.1, ${n} on HTTP/2 and HTTP/3.`);
    else if (T === 0.5) {
      parts.push('Requests reach the server and responses start streaming back.');
      if (loss) parts.push('One packet carrying part of response #1 is dropped on the way.');
    } else if (T === 0.75) {
      if (loss) {
        parts.push('The client notices a gap in the data (duplicate ACKs) and asks for a retransmit, which costs about 1 more RTT.');
        predict = 'Only response #1 lost a packet. Which other responses get stuck behind it on HTTP/2? And on HTTP/3?';
      } else {
        parts.push('Responses are arriving on every connection and stream.');
        predict = `HTTP/2 has all ${n} streams in flight on one connection. How many will be complete at t=1 RTT, and how many for HTTP/1.1?`;
      }
    } else if (T === 1) {
      parts.push(`Done so far: HTTP/1.1 ${count('h1', 1)}/${n}, HTTP/2 ${count('h2', 1)}/${n}, HTTP/3 ${count('h3', 1)}/${n}.`);
      if (loss)
        parts.push(
          `HTTP/2's ${n - 1} other streams already sit in the kernel, but TCP delivers bytes in order, so all of them wait for #1's retransmit (TCP head-of-line blocking). QUIC recovers per stream: only #1 waits on HTTP/3.`,
        );
      if (fin.h1 > 1)
        predict = `HTTP/1.1 finished only ${count('h1', 1)} of ${n} after 1 RTT. When will it finish the rest?`;
    } else {
      const doneNow = HTTPS.filter((h) => fin[h] === T);
      if (doneNow.length) parts.push(doneNow.map((h) => `${HTTP_NAME[h]} completes all ${n} at ${T} RTT = ${ms(T)}.`).join(' '));
      else if (Number.isInteger(T * 2) && T < fin.h1)
        parts.push(`HTTP/1.1 is working through its queue: ${count('h1', T)}/${n} done; each connection must finish one response before sending the next request.`);
      else parts.push(`In flight: HTTP/1.1 ${count('h1', T)}/${n} done, HTTP/2 ${count('h2', T)}/${n}, HTTP/3 ${count('h3', T)}/${n}.`);
    }
    frames.push({ ...base, T, caption: parts.join(' '), predict });
  }
  frames.push({
    ...base,
    T: horizon,
    caption: loss
      ? `With loss: HTTP/1.1 ${fin.h1} RTT, HTTP/2 ${fin.h2} RTT, HTTP/3 ${fin.h3} RTT, and only stream #1 was delayed on HTTP/3. One lost packet stalled every HTTP/2 stream; on links with 2%+ loss, one HTTP/2 connection can lose to six HTTP/1.1 connections.`
      : `No loss: HTTP/2 and HTTP/3 finish all ${n} in ${fin.h2} RTT (${ms(fin.h2)}); HTTP/1.1 needs ${fin.h1} RTT (${ms(fin.h1)}) because ${n} requests share 6 single-lane connections. Turn on packet loss to see TCP head-of-line blocking.`,
  });
  frames.push({
    ...base,
    T: horizon,
    summary: true,
    caption: `Takeaway: HTTP/2 fixed HTTP-level queueing (${fin.h1} → ${fin.h2} RTT here) but not TCP head-of-line blocking; QUIC streams recover loss independently. On a cold start HTTP/1.1 would also pay 6 separate TCP+TLS handshakes.`,
  });
  return frames;
}

export type Frame = HandshakeFrame | MuxFrame;

export function simulate(p: Params): Frame[] {
  return p.mode === 'handshake' ? handshake(p) : multiplex(p);
}
