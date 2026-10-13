import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect, type Socket } from 'node:net';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { encode, RespParser, MiniRedis } = mod;
type Redis = InstanceType<typeof MiniRedis>;

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const cmd = (...args: string[]) => `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('');

/** A raw TCP client that reads exactly the bytes we expect (with a timeout). */
class Client {
  sock: Socket;
  buf = Buffer.alloc(0);
  closed = false;
  #waiters: Array<() => void> = [];
  constructor(sock: Socket) {
    this.sock = sock;
    sock.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.#wake();
    });
    sock.on('close', () => {
      this.closed = true;
      this.#wake();
    });
    sock.on('error', () => {});
  }
  static open(port: number): Promise<Client> {
    return new Promise((resolve, reject) => {
      const s = connect(port, '127.0.0.1', () => resolve(new Client(s)));
      s.once('error', reject);
    });
  }
  #wake() {
    for (const w of this.#waiters.splice(0)) w();
  }
  async until(pred: () => boolean, what: string, ms = 2000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; got ${JSON.stringify(this.buf.toString())}`);
      await new Promise<void>((r) => {
        this.#waiters.push(r);
        setTimeout(r, 50).unref();
      });
    }
  }
  /** Wait for exactly `expected` (as the next bytes) and consume it. */
  async expect(expected: string): Promise<void> {
    const n = Buffer.byteLength(expected);
    await this.until(() => this.buf.length >= n || this.closed, JSON.stringify(expected));
    const got = this.buf.subarray(0, n).toString();
    this.buf = this.buf.subarray(n);
    assert.equal(got, expected);
  }
  send(s: string) {
    this.sock.write(s);
  }
}

async function withServer(fn: (r: Redis, port: number, clients: Client[]) => Promise<void>, opts = {}): Promise<void> {
  const r = new MiniRedis({ activeExpiryIntervalMs: 0, ...opts });
  const clients: Client[] = [];
  const port = await r.listen(0);
  try {
    await fn(r, port, clients);
  } finally {
    for (const c of clients) c.sock.destroy();
    await r.close(200);
  }
}

// ---------- M1: RESP serializer ----------

test('M1: encode serializes every RESP2 type (bulk length = UTF-8 bytes)', () => {
  assert.equal(encode({ type: 'simple', value: 'OK' }).toString(), '+OK\r\n');
  assert.equal(encode({ type: 'error', value: 'ERR boom' }).toString(), '-ERR boom\r\n');
  assert.equal(encode({ type: 'integer', value: -42 }).toString(), ':-42\r\n');
  assert.equal(encode({ type: 'integer', value: 9223372036854775807n }).toString(), ':9223372036854775807\r\n');
  assert.equal(encode({ type: 'bulk', value: 'héllo' }).toString(), '$6\r\nhéllo\r\n');
  assert.equal(encode({ type: 'bulk', value: '' }).toString(), '$0\r\n\r\n');
  assert.equal(encode({ type: 'bulk', value: null }).toString(), '$-1\r\n');
  assert.equal(encode({ type: 'array', value: null }).toString(), '*-1\r\n');
  assert.equal(
    encode({ type: 'array', value: [{ type: 'integer', value: 1 }, { type: 'array', value: [{ type: 'bulk', value: 'x' }] }] }).toString(),
    '*2\r\n:1\r\n*1\r\n$1\r\nx\r\n',
  );
});

// ---------- M2: RESP parser ----------

test('M2: parser decodes every type and round-trips with encode', () => {
  const p = new RespParser();
  type V = import('../solution/index.ts').RespValue;
  const values: V[] = [
    { type: 'simple', value: 'PONG' },
    { type: 'error', value: 'ERR x' },
    { type: 'integer', value: 7 },
    { type: 'bulk', value: 'a\r\nb' },
    { type: 'bulk', value: null },
    { type: 'array', value: [{ type: 'bulk', value: 'GET' }, { type: 'array', value: [] }] },
    { type: 'array', value: null },
  ];
  const wire = Buffer.concat(values.map((v) => encode(v)));
  assert.deepEqual(p.push(wire), values);
  assert.equal(p.pending, 0);
});

test('M2: parser handles frames split at every possible byte boundary', () => {
  const wire = Buffer.from(cmd('SET', 'kéy', 'value with\r\ncrlf') + cmd('GET', 'kéy'));
  for (let cut = 1; cut < wire.length; cut++) {
    const p = new RespParser();
    const a = p.push(wire.subarray(0, cut));
    const b = p.push(wire.subarray(cut));
    const all = [...a, ...b];
    assert.equal(all.length, 2, `cut at ${cut}`);
    assert.deepEqual(all[0], { type: 'array', value: [{ type: 'bulk', value: 'SET' }, { type: 'bulk', value: 'kéy' }, { type: 'bulk', value: 'value with\r\ncrlf' }] });
  }
});

test('M2: parser feeds byte-by-byte and reports pending bytes', () => {
  const p = new RespParser();
  const wire = Buffer.from(cmd('PING'));
  let frames = 0;
  for (let i = 0; i < wire.length; i++) {
    frames += p.push(wire.subarray(i, i + 1)).length;
    if (i < wire.length - 1) assert.equal(p.pending, i + 1);
  }
  assert.equal(frames, 1);
  assert.equal(p.pending, 0);
});

test('M2: parser rejects malformed input with ProtocolError', () => {
  assert.throws(() => new RespParser().push('?what\r\n'), mod.ProtocolError);
  assert.throws(() => new RespParser().push('$abc\r\n'), mod.ProtocolError);
  assert.throws(() => new RespParser().push('$-5\r\n'), mod.ProtocolError);
  assert.throws(() => new RespParser().push('$3\r\nabcXY'), mod.ProtocolError);
  assert.throws(() => new RespParser().push('$999999999999\r\n'), mod.ProtocolError);
});

// ---------- M3: commands (no network) ----------

test('M3: PING, ECHO, GET/SET, DEL, EXISTS and error replies', () => {
  const r = new MiniRedis({ activeExpiryIntervalMs: 0 });
  assert.deepEqual(r.execute(['PING']), { type: 'simple', value: 'PONG' });
  assert.deepEqual(r.execute(['ping', 'hi']), { type: 'bulk', value: 'hi' });
  assert.deepEqual(r.execute(['ECHO', 'x y']), { type: 'bulk', value: 'x y' });
  assert.deepEqual(r.execute(['GET', 'k']), { type: 'bulk', value: null });
  assert.deepEqual(r.execute(['set', 'k', 'v']), { type: 'simple', value: 'OK' });
  assert.deepEqual(r.execute(['GET', 'k']), { type: 'bulk', value: 'v' });
  r.execute(['SET', 'k2', 'v2']);
  assert.deepEqual(r.execute(['EXISTS', 'k', 'k', 'nope']), { type: 'integer', value: 2 });
  assert.deepEqual(r.execute(['DEL', 'k', 'k2', 'nope', 'k']), { type: 'integer', value: 2 });
  assert.equal(r.dbsize, 0);
  assert.deepEqual(r.execute(['GET']), { type: 'error', value: "ERR wrong number of arguments for 'get' command" });
  assert.deepEqual(r.execute(['FLY', 'away']), { type: 'error', value: "ERR unknown command 'FLY'" });
});

test('M3: SET NX / XX conditions and option validation', () => {
  const r = new MiniRedis({ activeExpiryIntervalMs: 0 });
  assert.deepEqual(r.execute(['SET', 'k', '1', 'XX']), { type: 'bulk', value: null });
  assert.deepEqual(r.execute(['SET', 'k', '1', 'NX']), { type: 'simple', value: 'OK' });
  assert.deepEqual(r.execute(['SET', 'k', '2', 'nx']), { type: 'bulk', value: null });
  assert.deepEqual(r.execute(['SET', 'k', '3', 'XX']), { type: 'simple', value: 'OK' });
  assert.deepEqual(r.execute(['GET', 'k']), { type: 'bulk', value: '3' });
  assert.deepEqual(r.execute(['SET', 'k', '4', 'NX', 'XX']), { type: 'error', value: 'ERR syntax error' });
  assert.deepEqual(r.execute(['SET', 'k', '4', 'EX', '1', 'PX', '5']), { type: 'error', value: 'ERR syntax error' });
  assert.deepEqual(r.execute(['SET', 'k', '4', 'EX']), { type: 'error', value: 'ERR syntax error' });
  assert.deepEqual(r.execute(['SET', 'k', '4', 'EX', 'soon']), { type: 'error', value: 'ERR value is not an integer or out of range' });
  assert.deepEqual(r.execute(['SET', 'k', '4', 'EX', '0']), { type: 'error', value: "ERR invalid expire time in 'set' command" });
  assert.deepEqual(r.execute(['GET', 'k']), { type: 'bulk', value: '3' }, 'failed SETs must not write');
});

test('M3: INCR creates, increments, rejects non-integers and detects int64 overflow', () => {
  const r = new MiniRedis({ activeExpiryIntervalMs: 0 });
  assert.deepEqual(r.execute(['INCR', 'n']), { type: 'integer', value: 1 });
  assert.deepEqual(r.execute(['INCR', 'n']), { type: 'integer', value: 2 });
  assert.deepEqual(r.execute(['GET', 'n']), { type: 'bulk', value: '2' });
  r.execute(['SET', 's', 'abc']);
  assert.deepEqual(r.execute(['INCR', 's']), { type: 'error', value: 'ERR value is not an integer or out of range' });
  r.execute(['SET', 'f', '1.5']);
  assert.equal(r.execute(['INCR', 'f']).type, 'error');
  r.execute(['SET', 'big', '9223372036854775806']);
  assert.deepEqual(r.execute(['INCR', 'big']), { type: 'integer', value: 9223372036854775807n });
  assert.deepEqual(r.execute(['INCR', 'big']), { type: 'error', value: 'ERR increment or decrement would overflow' });
  r.execute(['SET', 'neg', '-1']);
  assert.deepEqual(r.execute(['INCR', 'neg']), { type: 'integer', value: 0 });
});

// ---------- M4: expiry ----------

test('M4: SET EX/PX expire lazily on the injected clock; TTL and PTTL report correctly', () => {
  const c = clock();
  const r = new MiniRedis({ now: c.now, activeExpiryIntervalMs: 0 });
  r.execute(['SET', 'a', '1', 'EX', '10']);
  r.execute(['SET', 'b', '1', 'PX', '1500']);
  r.execute(['SET', 'c', '1']);
  assert.deepEqual(r.execute(['TTL', 'a']), { type: 'integer', value: 10 });
  assert.deepEqual(r.execute(['TTL', 'b']), { type: 'integer', value: 2 }, '1500ms rounds to 2s');
  assert.deepEqual(r.execute(['PTTL', 'b']), { type: 'integer', value: 1500 });
  assert.deepEqual(r.execute(['TTL', 'c']), { type: 'integer', value: -1 });
  assert.deepEqual(r.execute(['TTL', 'zzz']), { type: 'integer', value: -2 });
  c.advance(1499);
  assert.deepEqual(r.execute(['GET', 'b']), { type: 'bulk', value: '1' });
  c.advance(1);
  assert.deepEqual(r.execute(['GET', 'b']), { type: 'bulk', value: null });
  assert.deepEqual(r.execute(['EXISTS', 'b']), { type: 'integer', value: 0 });
  assert.deepEqual(r.execute(['TTL', 'b']), { type: 'integer', value: -2 });
  c.advance(8500);
  assert.deepEqual(r.execute(['GET', 'a']), { type: 'bulk', value: null });
});

test('M4: EXPIRE sets/replaces a TTL, plain SET clears it, INCR keeps it, EXPIRE <= 0 deletes', () => {
  const c = clock();
  const r = new MiniRedis({ now: c.now, activeExpiryIntervalMs: 0 });
  assert.deepEqual(r.execute(['EXPIRE', 'missing', '5']), { type: 'integer', value: 0 });
  r.execute(['SET', 'k', 'v']);
  assert.deepEqual(r.execute(['EXPIRE', 'k', '5']), { type: 'integer', value: 1 });
  assert.deepEqual(r.execute(['TTL', 'k']), { type: 'integer', value: 5 });
  r.execute(['SET', 'k', 'v2']);
  assert.deepEqual(r.execute(['TTL', 'k']), { type: 'integer', value: -1 }, 'SET without EX clears the TTL');
  r.execute(['SET', 'n', '1', 'EX', '100']);
  r.execute(['INCR', 'n']);
  assert.deepEqual(r.execute(['TTL', 'n']), { type: 'integer', value: 100 });
  assert.deepEqual(r.execute(['EXPIRE', 'n', 'x']), { type: 'error', value: 'ERR value is not an integer or out of range' });
  assert.deepEqual(r.execute(['EXPIRE', 'n', '0']), { type: 'integer', value: 1 });
  assert.deepEqual(r.execute(['EXISTS', 'n']), { type: 'integer', value: 0 });
});

test('M4: active expiry reclaims memory for keys nobody reads', () => {
  const c = clock();
  const r = new MiniRedis({ now: c.now, activeExpiryIntervalMs: 0 });
  for (let i = 0; i < 100; i++) r.execute(['SET', 'tmp' + i, 'x', 'PX', String(100 + i)]);
  for (let i = 0; i < 50; i++) r.execute(['SET', 'perm' + i, 'x']);
  assert.equal(r.dbsize, 150);
  c.advance(150); // tmp0..tmp50 have expired (expiresAt <= now)
  assert.equal(r.dbsize, 150, 'lazy expiry alone keeps them in memory');
  assert.equal(r.activeExpireCycle(), 51);
  assert.equal(r.dbsize, 99);
  c.advance(1000);
  assert.equal(r.activeExpireCycle(10), 10, 'maxChecks bounds the work per cycle');
  assert.equal(r.activeExpireCycle(), 39);
  assert.equal(r.dbsize, 50);
});

// ---------- M5: TCP server ----------

test('M5: server listens on port 0 and answers commands over TCP', () =>
  withServer(async (r, port, clients) => {
    assert.ok(port > 0);
    assert.equal(r.port, port);
    const c = await Client.open(port);
    clients.push(c);
    c.send(cmd('PING'));
    await c.expect('+PONG\r\n');
    c.send(cmd('SET', 'greeting', 'héllo'));
    await c.expect('+OK\r\n');
    c.send(cmd('GET', 'greeting'));
    await c.expect('$6\r\nhéllo\r\n');
    c.send(cmd('GET', 'nope'));
    await c.expect('$-1\r\n');
    c.send(cmd('INCR', 'greeting'));
    await c.expect('-ERR value is not an integer or out of range\r\n');
  }));

test('M5: pipelined commands in one write get in-order replies; split frames are reassembled', () =>
  withServer(async (_r, port, clients) => {
    const c = await Client.open(port);
    clients.push(c);
    c.send(cmd('SET', 'n', '9223372036854775806') + cmd('INCR', 'n') + cmd('INCR', 'n') + cmd('ECHO', 'done'));
    await c.expect('+OK\r\n:9223372036854775807\r\n-ERR increment or decrement would overflow\r\n$4\r\ndone\r\n');
    const wire = cmd('ECHO', 'split-across-packets');
    c.send(wire.slice(0, 7));
    await new Promise((res) => setTimeout(res, 30));
    c.send(wire.slice(7, 20));
    await new Promise((res) => setTimeout(res, 30));
    c.send(wire.slice(20));
    await c.expect('$20\r\nsplit-across-packets\r\n');
  }));

test('M5: many concurrent clients share one keyspace', () =>
  withServer(async (_r, port, clients) => {
    const cs = await Promise.all(Array.from({ length: 10 }, () => Client.open(port)));
    clients.push(...cs);
    for (const c of cs) for (let i = 0; i < 20; i++) c.send(cmd('INCR', 'counter'));
    for (const c of cs) {
      await c.until(() => c.buf.toString().split('\r\n').length > 20, '20 replies');
      c.buf = Buffer.alloc(0);
    }
    cs[0].send(cmd('GET', 'counter'));
    await cs[0].expect('$3\r\n200\r\n');
  }));

test('M5: protocol errors get an error reply and the connection is closed', () =>
  withServer(async (_r, port, clients) => {
    const c = await Client.open(port);
    clients.push(c);
    c.send('?garbage\r\n');
    await c.until(() => c.closed, 'connection close');
    assert.match(c.buf.toString(), /^-ERR Protocol error/);
    const ok = await Client.open(port); // the server itself must survive
    clients.push(ok);
    ok.send(cmd('PING'));
    await ok.expect('+PONG\r\n');
  }));

test('M5: graceful shutdown flushes replies, closes clients and refuses new connections', async () => {
  const r = new MiniRedis({ activeExpiryIntervalMs: 0 });
  const port = await r.listen(0);
  const a = await Client.open(port);
  const b = await Client.open(port); // idle client must not block shutdown
  try {
    a.send(cmd('ECHO', 'last words'));
    await a.expect('$10\r\nlast words\r\n');
    await r.close();
    await a.until(() => a.closed, 'client a closed');
    await b.until(() => b.closed, 'client b closed');
    await assert.rejects(Client.open(port), /ECONNREFUSED/);
  } finally {
    a.sock.destroy();
    b.sock.destroy();
  }
});
