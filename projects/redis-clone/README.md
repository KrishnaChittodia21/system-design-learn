# Build a Mini Redis: RESP Protocol & an Event-Loop Server

## Goal
Implement in `src/index.ts`:
- `encode(value)` and `RespParser` — the RESP2 wire protocol.
- `MiniRedis` — `execute(args)` (the command engine), `listen(port)`, `close()`, `activeExpireCycle()`, `dbsize`, `port`.

The doc comment on `MiniRedis` lists every command, its replies and the **exact** error strings the judge expects (they match real Redis).

## Wire format cheat sheet (RESP2)
```
+OK\r\n            simple string        -ERR msg\r\n       error
:42\r\n            integer              $5\r\nhello\r\n    bulk string ($-1\r\n = null)
*2\r\n$3\r\nGET\r\n$1\r\nk\r\n          array of bulk strings = how clients send commands
```
Bulk lengths count **bytes** (`Buffer.byteLength`), so `héllo` is `$6`.

## What the judge checks
- Parser: every type, every possible split point of a two-command stream, byte-by-byte feeding with `pending` tracking, malformed input → `ProtocolError`.
- Commands through `execute()` (no network): NX/XX, option validation (failed SETs don't write), INCR overflow at INT64_MAX (use `BigInt`), TTL rounding, EXPIRE semantics.
- Expiry on the injected clock: expired when `now() >= expiresAt`; lazy on every read path; `activeExpireCycle(maxChecks)` only scans keys that carry a TTL.
- Server: `listen(0)` resolves with the OS-assigned port; pipelined replies in order; split frames; 10 concurrent clients; a protocol error replies `-ERR Protocol error...` and closes **only** that connection; `close()` ends every client (including idle ones), and new connections are refused.
- Tests pass `activeExpiryIntervalMs: 0`, so no real timers run; `close()` must still clear any timer you start.

## Run
```bash
npm run project -- redis-clone
npm run project -- redis-clone --solution
```

## Hints
- TCP is a byte stream: one `data` event may hold half a command or ten commands. Keep a per-connection buffer, parse as many complete frames as possible, keep the rest.
- Return a sentinel ("incomplete") from your recursive parse instead of throwing, so arrays of partial bulk strings just wait for more bytes.
- Concatenate the replies produced by one chunk into a single `socket.write` — that's what makes pipelining cheap.
- `server.close()` only stops *accepting*; its callback waits for existing sockets, so you must `end()` them yourself (and `destroy()` stragglers after a grace period).
- Keep a `Set` of keys with a TTL — that's what real Redis samples in its active expiry cycle.

## Stretch goals
- Inline commands (`PING\r\n` typed into `nc`), `MGET`/`MSET`, `INCRBY`/`DECR`, `KEEPTTL`, `GETEX`.
- Probabilistic active expiry like Redis: sample 20 volatile keys, repeat while > 25 % were expired, cap CPU time per cycle.
- RDB-style snapshot or AOF persistence; `MULTI`/`EXEC`; pub/sub with RESP push frames.
- Point `redis-cli -p <port>` or `redis-benchmark` at it.
