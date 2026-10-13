// Reference solution: a mini Redis — RESP2 parser/serializer, a node:net event-loop server,
// string commands with TTLs (lazy + active expiry) on an injected clock, and graceful shutdown.

import { createServer, type Server, type Socket } from 'node:net';

/** A RESP2 value. Integers may be bigint so 64-bit results survive (INCR near INT64_MAX). */
export type RespValue =
  | { type: 'simple'; value: string }
  | { type: 'error'; value: string }
  | { type: 'integer'; value: number | bigint }
  | { type: 'bulk'; value: string | null }
  | { type: 'array'; value: RespValue[] | null };

const CRLF = '\r\n';
const MAX_BULK = 512 * 1024 * 1024;

/** Serialize one value. Bulk lengths are UTF-8 BYTE lengths, not string lengths. */
export function encode(v: RespValue): Buffer {
  switch (v.type) {
    case 'simple':
      return Buffer.from(`+${v.value}${CRLF}`);
    case 'error':
      return Buffer.from(`-${v.value}${CRLF}`);
    case 'integer':
      return Buffer.from(`:${v.value}${CRLF}`);
    case 'bulk':
      if (v.value === null) return Buffer.from(`$-1${CRLF}`);
      return Buffer.concat([Buffer.from(`$${Buffer.byteLength(v.value)}${CRLF}`), Buffer.from(v.value), Buffer.from(CRLF)]);
    case 'array':
      if (v.value === null) return Buffer.from(`*-1${CRLF}`);
      return Buffer.concat([Buffer.from(`*${v.value.length}${CRLF}`), ...v.value.map(encode)]);
  }
}

/** Thrown for malformed input. The server replies `-ERR Protocol error: ...` and closes the connection. */
export class ProtocolError extends Error {}

/** Marker: not enough bytes buffered yet. */
const INCOMPLETE = Symbol('incomplete');

/**
 * Incremental parser: feed it TCP chunks in any split; it returns every complete frame and
 * keeps the remainder buffered (partial frames, pipelining).
 */
export class RespParser {
  #buf: Buffer = Buffer.alloc(0);

  /** Append a chunk and return all frames that are now complete, in order. @throws ProtocolError */
  push(chunk: Buffer | string): RespValue[] {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, Buffer.from(chunk)]) : Buffer.from(chunk);
    const out: RespValue[] = [];
    let pos = 0;
    for (;;) {
      const r = this.#parse(pos);
      if (r === INCOMPLETE) break;
      out.push(r[0]);
      pos = r[1];
    }
    this.#buf = this.#buf.subarray(pos);
    return out;
  }

  /** Bytes buffered but not yet part of a complete frame. */
  get pending(): number {
    return this.#buf.length;
  }

  #line(pos: number): [string, number] | typeof INCOMPLETE {
    const end = this.#buf.indexOf(CRLF, pos);
    if (end === -1) return INCOMPLETE;
    return [this.#buf.toString('utf8', pos, end), end + 2];
  }

  #int(s: string): number {
    if (!/^-?\d+$/.test(s)) throw new ProtocolError(`invalid length or integer '${s}'`);
    return Number(s);
  }

  #parse(pos: number): [RespValue, number] | typeof INCOMPLETE {
    if (pos >= this.#buf.length) return INCOMPLETE;
    const prefix = String.fromCharCode(this.#buf[pos]);
    const line = this.#line(pos + 1);
    if (line === INCOMPLETE) return INCOMPLETE;
    const [text, next] = line;
    switch (prefix) {
      case '+':
        return [{ type: 'simple', value: text }, next];
      case '-':
        return [{ type: 'error', value: text }, next];
      case ':': {
        if (!/^-?\d+$/.test(text)) throw new ProtocolError(`invalid integer '${text}'`);
        const n = BigInt(text);
        return [{ type: 'integer', value: n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n }, next];
      }
      case '$': {
        const len = this.#int(text);
        if (len === -1) return [{ type: 'bulk', value: null }, next];
        if (len < 0 || len > MAX_BULK) throw new ProtocolError(`invalid bulk length ${len}`);
        if (this.#buf.length < next + len + 2) return INCOMPLETE;
        if (this.#buf[next + len] !== 0x0d || this.#buf[next + len + 1] !== 0x0a) throw new ProtocolError('bulk string not terminated by CRLF');
        return [{ type: 'bulk', value: this.#buf.toString('utf8', next, next + len) }, next + len + 2];
      }
      case '*': {
        const n = this.#int(text);
        if (n === -1) return [{ type: 'array', value: null }, next];
        if (n < 0) throw new ProtocolError(`invalid multibulk length ${n}`);
        const items: RespValue[] = [];
        let p = next;
        for (let i = 0; i < n; i++) {
          const r = this.#parse(p);
          if (r === INCOMPLETE) return INCOMPLETE;
          items.push(r[0]);
          p = r[1];
        }
        return [{ type: 'array', value: items }, p];
      }
      default:
        throw new ProtocolError(`unexpected byte '${prefix}'`);
    }
  }
}

export interface MiniRedisOptions {
  /** clock in ms (default Date.now) — all TTL logic must use it */
  now?: () => number;
  /** run activeExpireCycle() on a real timer every N ms; 0 disables (default 100) */
  activeExpiryIntervalMs?: number;
}

interface Item {
  value: string;
  /** absolute ms, or undefined for no expiry */
  expiresAt?: number;
}

const OK: RespValue = { type: 'simple', value: 'OK' };
const NIL: RespValue = { type: 'bulk', value: null };
const err = (m: string): RespValue => ({ type: 'error', value: m });
const int = (n: number | bigint): RespValue => ({ type: 'integer', value: n });
const NOT_INT = err('ERR value is not an integer or out of range');
const INT64_MAX = 9223372036854775807n;
const INT64_MIN = -9223372036854775808n;

function parseInt64(s: string): bigint | null {
  if (!/^-?\d+$/.test(s) || (s.length > 1 && /^-?0/.test(s))) return null;
  const n = BigInt(s);
  return n > INT64_MAX || n < INT64_MIN ? null : n;
}

export class MiniRedis {
  #now: () => number;
  #intervalMs: number;
  #data = new Map<string, Item>();
  /** keys that carry a TTL — what the active expiry cycle scans */
  #volatile = new Set<string>();
  #server: Server | null = null;
  #sockets = new Set<Socket>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MiniRedisOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#intervalMs = options.activeExpiryIntervalMs ?? 100;
  }

  /** Number of stored keys, including expired ones not yet collected. */
  get dbsize(): number {
    return this.#data.size;
  }

  /** Port the server listens on (after listen()). */
  get port(): number {
    const a = this.#server?.address();
    if (!a || typeof a === 'string') throw new Error('not listening');
    return a.port;
  }

  /** Start listening; port 0 asks the OS for a free port. Resolves with the bound port. */
  listen(port = 0, host = '127.0.0.1'): Promise<number> {
    const server = createServer((socket) => this.#onConnection(socket));
    this.#server = server;
    if (this.#intervalMs > 0) {
      this.#timer = setInterval(() => this.activeExpireCycle(), this.#intervalMs);
      this.#timer.unref();
    }
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve(this.port);
      });
    });
  }

  /**
   * Graceful shutdown: stop accepting, let already-written replies flush (socket.end), and
   * resolve once every connection is closed (stragglers are destroyed after a grace period).
   */
  close(graceMs = 1000): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const server = this.#server;
    if (!server) return Promise.resolve();
    this.#server = null;
    return new Promise((resolve) => {
      const force = setTimeout(() => {
        for (const s of this.#sockets) s.destroy();
      }, graceMs);
      force.unref();
      server.close(() => {
        clearTimeout(force);
        resolve();
      });
      for (const s of this.#sockets) s.end();
    });
  }

  /** Delete expired keys among those with a TTL; returns how many were removed. */
  activeExpireCycle(maxChecks = Infinity): number {
    const now = this.#now();
    let checked = 0;
    let removed = 0;
    for (const key of this.#volatile) {
      if (checked++ >= maxChecks) break;
      const item = this.#data.get(key);
      if (item?.expiresAt !== undefined && item.expiresAt <= now) {
        this.#delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Execute one command (args[0] is the case-insensitive command name). Never throws. */
  execute(args: string[]): RespValue {
    if (args.length === 0) return err('ERR empty command');
    const name = args[0].toLowerCase();
    const a = args.slice(1);
    const arity = (ok: boolean): RespValue | null => (ok ? null : err(`ERR wrong number of arguments for '${name}' command`));
    switch (name) {
      case 'ping':
        return arity(a.length <= 1) ?? (a.length ? { type: 'bulk', value: a[0] } : { type: 'simple', value: 'PONG' });
      case 'echo':
        return arity(a.length === 1) ?? { type: 'bulk', value: a[0] };
      case 'get':
        return arity(a.length === 1) ?? { type: 'bulk', value: this.#get(a[0])?.value ?? null };
      case 'set':
        return arity(a.length >= 2) ?? this.#set(a);
      case 'del':
        return arity(a.length >= 1) ?? int(a.filter((k) => this.#get(k) && this.#delete(k)).length);
      case 'exists':
        return arity(a.length >= 1) ?? int(a.filter((k) => this.#get(k)).length);
      case 'incr':
        return arity(a.length === 1) ?? this.#incr(a[0]);
      case 'expire':
      case 'pexpire':
        return arity(a.length === 2) ?? this.#expire(a[0], a[1], name === 'expire' ? 1000 : 1);
      case 'ttl':
      case 'pttl': {
        const bad = arity(a.length === 1);
        if (bad) return bad;
        const item = this.#get(a[0]);
        if (!item) return int(-2);
        if (item.expiresAt === undefined) return int(-1);
        const ms = item.expiresAt - this.#now();
        return int(name === 'pttl' ? ms : Math.floor((ms + 500) / 1000));
      }
      default:
        return err(`ERR unknown command '${args[0]}'`);
    }
  }

  // ---- keyspace ----

  /** Lazy expiry: every read path goes through here. */
  #get(key: string): Item | undefined {
    const item = this.#data.get(key);
    if (item?.expiresAt !== undefined && item.expiresAt <= this.#now()) {
      this.#delete(key);
      return undefined;
    }
    return item;
  }

  #delete(key: string): boolean {
    this.#volatile.delete(key);
    return this.#data.delete(key);
  }

  #put(key: string, item: Item): void {
    this.#data.set(key, item);
    if (item.expiresAt === undefined) this.#volatile.delete(key);
    else this.#volatile.add(key);
  }

  #set(a: string[]): RespValue {
    const [key, value, ...opts] = a;
    let ttlMs: number | undefined;
    let nx = false;
    let xx = false;
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i].toUpperCase();
      if (o === 'NX' && !xx) nx = true;
      else if (o === 'XX' && !nx) xx = true;
      else if ((o === 'EX' || o === 'PX') && ttlMs === undefined && i + 1 < opts.length) {
        const n = parseInt64(opts[++i]);
        if (n === null) return NOT_INT;
        if (n <= 0n) return err("ERR invalid expire time in 'set' command");
        ttlMs = Number(n) * (o === 'EX' ? 1000 : 1);
      } else return err('ERR syntax error');
    }
    const exists = this.#get(key) !== undefined;
    if ((nx && exists) || (xx && !exists)) return NIL;
    this.#put(key, { value, expiresAt: ttlMs === undefined ? undefined : this.#now() + ttlMs });
    return OK;
  }

  #incr(key: string): RespValue {
    const item = this.#get(key);
    const cur = item ? parseInt64(item.value) : 0n;
    if (cur === null) return NOT_INT;
    if (cur === INT64_MAX) return err('ERR increment or decrement would overflow');
    const next = cur + 1n;
    // INCR keeps the existing TTL
    this.#put(key, { value: next.toString(), expiresAt: item?.expiresAt });
    return int(next >= BigInt(Number.MIN_SAFE_INTEGER) && next <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(next) : next);
  }

  #expire(key: string, amount: string, unitMs: number): RespValue {
    const n = parseInt64(amount);
    if (n === null) return NOT_INT;
    const item = this.#get(key);
    if (!item) return int(0);
    if (n <= 0n) {
      this.#delete(key); // Redis: a non-positive TTL deletes the key
      return int(1);
    }
    this.#put(key, { value: item.value, expiresAt: this.#now() + Number(n) * unitMs });
    return int(1);
  }

  // ---- networking ----

  #onConnection(socket: Socket): void {
    this.#sockets.add(socket);
    socket.on('close', () => this.#sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    const parser = new RespParser();
    socket.on('data', (chunk) => {
      let frames: RespValue[];
      try {
        frames = parser.push(chunk);
      } catch (e) {
        socket.end(encode(err(`ERR Protocol error: ${(e as Error).message}`)));
        return;
      }
      if (frames.length === 0) return;
      // pipelining: one write for all replies produced by this chunk, in request order
      const replies = frames.map((f) => {
        if (f.type !== 'array' || !f.value || f.value.some((x) => x.type !== 'bulk' || x.value === null)) {
          return encode(err('ERR Protocol error: expected an array of bulk strings'));
        }
        return encode(this.execute(f.value.map((x) => (x as { value: string }).value)));
      });
      socket.write(Buffer.concat(replies));
    });
  }
}
