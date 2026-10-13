// Pure simulation of TOTP (RFC 6238 on top of HOTP, RFC 4226) with REAL values:
// a small pure-TS SHA-1 + HMAC computes every byte shown. Generation happens on the phone at
// the chosen Unix time; verification happens on a server whose clock lags the phone by
// `drift` seconds and accepts counters within ±window steps, rejecting replays.
// No React (and no node:crypto) here, so it runs in the browser and can be tested with Node.
import type { BaseFrame } from '../../core';

// ------------------------------------------------------------------ SHA-1 / HMAC-SHA1
function rotl(x: number, n: number) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

export function sha1(msg: Uint8Array): Uint8Array {
  const ml = msg.length;
  const withOne = ml + 1;
  const total = Math.ceil((withOne + 8) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[ml] = 0x80;
  const bitLen = ml * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 2 ** 32));
  dv.setUint32(total - 4, bitLen >>> 0);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
  return out;
}

export function hmacSha1(key: Uint8Array, msg: Uint8Array): Uint8Array {
  let k = key.length > 64 ? sha1(key) : key;
  const k0 = new Uint8Array(64);
  k0.set(k);
  k = k0;
  const inner = new Uint8Array(64 + msg.length);
  const outer = new Uint8Array(64 + 20);
  for (let i = 0; i < 64; i++) {
    inner[i] = k[i] ^ 0x36;
    outer[i] = k[i] ^ 0x5c;
  }
  inner.set(msg, 64);
  outer.set(sha1(inner), 64);
  return sha1(outer);
}

export function base32Decode(s: string): Uint8Array {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = s.replace(/=+$/, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let val = 0;
  for (const ch of clean) {
    const v = A.indexOf(ch);
    if (v < 0) throw new Error(`bad base32 char ${ch}`);
    val = (val << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export const hex = (b: Uint8Array | number[]) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** 8-byte big-endian counter (works for counters above 2^32 too) */
export function counterBytes(counter: number): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, Math.floor(counter / 2 ** 32));
  dv.setUint32(4, counter >>> 0);
  return b;
}

export interface Hotp {
  counter: number;
  msg: Uint8Array;
  mac: Uint8Array;
  offset: number;
  slice: number[];
  /** 31-bit value after masking the top bit */
  bin: number;
  code: string;
}

export function hotp(secret: Uint8Array, counter: number, digits = 6): Hotp {
  const msg = counterBytes(counter);
  const mac = hmacSha1(secret, msg);
  const offset = mac[19] & 0x0f;
  const slice = Array.from(mac.slice(offset, offset + 4));
  const bin = (((slice[0] & 0x7f) << 24) | (slice[1] << 16) | (slice[2] << 8) | slice[3]) >>> 0;
  const code = String(bin % 10 ** digits).padStart(digits, '0');
  return { counter, msg, mac, offset, slice, bin, code };
}

export const STEP = 30;
export const counterAt = (unix: number) => Math.floor(unix / STEP);

// ------------------------------------------------------------------ simulation
export type SecretId = 'rfc' | 'demo';
export const SECRETS: Record<SecretId, { label: string; base32: string; note: string }> = {
  rfc: { label: 'RFC 6238 test key', base32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', note: 'ASCII "12345678901234567890"' },
  demo: { label: 'Demo key', base32: 'JBSWY3DPEHPK3PXP', note: '10 random-looking bytes' },
};
export const TIMES = [59, 1111111109, 1234567890, 2000000000] as const;

export interface Params {
  secret: SecretId;
  /** Unix time on the phone when the code is generated */
  time: number;
  /** server clock = phone clock − drift (s). Positive: phone runs ahead. */
  drift: number;
  /** accepted steps either side of the server's counter */
  window: 0 | 1;
}
export const DEFAULT_PARAMS: Params = { secret: 'rfc', time: 1111111109, drift: 35, window: 1 };

export type Stage =
  | 'secret'
  | 'time'
  | 'counter'
  | 'bytes'
  | 'hmac'
  | 'offset'
  | 'slice'
  | 'mod'
  | 'send'
  | 'server-time'
  | 'check'
  | 'verdict'
  | 'replay'
  | 'next';

export interface Candidate {
  delta: number;
  counter: number;
  code: string;
  match: boolean;
}

export interface TotpFrame extends BaseFrame {
  stage: Stage;
  secretHex: string;
  phoneTime: number;
  serverTime: number;
  h: Hotp;
  /** candidates the server has checked so far */
  checked: Candidate[];
  /** null until decided */
  accepted: boolean | null;
  /** highest counter the server has accepted for this user (replay protection) */
  lastUsed: number | null;
  window: 0 | 1;
  replayRejected?: boolean;
  next?: Hotp;
  changedBytes?: number;
}

export function simulate(p: Params): TotpFrame[] {
  const secret = base32Decode(SECRETS[p.secret].base32);
  const secretHex = hex(secret);
  const t = p.time;
  const ts = t - p.drift;
  const h = hotp(secret, counterAt(t));
  const C = h.counter;
  const Cs = counterAt(ts);
  const into = t % STEP;
  const frames: TotpFrame[] = [];
  const base = { window: p.window, secretHex, phoneTime: t, serverTime: ts, h, checked: [] as Candidate[], accepted: null as boolean | null, lastUsed: null as number | null };
  const push = (f: Partial<TotpFrame> & { stage: Stage; caption: string }) => frames.push({ ...base, ...f } as TotpFrame);
  const ctrHex = hex(h.msg);
  const last = h.mac[19];

  push({
    stage: 'secret',
    caption: `Enrolment: the server generated a ${secret.length}-byte shared secret (base32 ${SECRETS[p.secret].base32}) and showed it as a QR code; the phone app and the server both store it. Nothing else is ever shared.`,
  });
  push({
    stage: 'time',
    caption: `Login time: the phone reads Unix time t = ${t} s. TOTP replaces HOTP's stored counter with time, so both sides can derive the same counter without talking.`,
  });
  push({
    stage: 'counter',
    caption: `Counter T = floor((t − T0) / 30) = floor(${t} / 30) = ${C}. We are ${into} s into this 30 s step, so this code is valid for ${STEP - into} more second${STEP - into === 1 ? "" : "s"} on a perfectly synced clock.`,
  });
  push({
    stage: 'bytes',
    caption: `The counter becomes the HMAC message as an 8-byte big-endian integer: ${ctrHex.match(/../g)!.join(' ')}.`,
    predict: 'The counter will go up by just 1 in the next 30 s step. How many of the 20 HMAC output bytes do you expect to change?',
  });
  const next = hotp(secret, C + 1);
  const changed = h.mac.reduce((n, b, i) => n + (b !== next.mac[i] ? 1 : 0), 0);
  push({
    stage: 'hmac',
    changedBytes: changed,
    next,
    caption: `HMAC-SHA1(secret, counter) = 20 bytes. For counter ${C + 1}, ${changed} of 20 bytes differ, so codes from neighbouring steps look unrelated and one code reveals nothing about the next.`,
  });
  push({
    stage: 'offset',
    caption: `Dynamic truncation: the last byte is 0x${last.toString(16).padStart(2, '0')}; its low nibble 0x${(last & 0xf).toString(16)} gives offset = ${h.offset}.`,
    predict: `Offset ${h.offset}: which bytes become the code, and why is the top bit then masked off?`,
  });
  push({
    stage: 'slice',
    caption: `Take the 4 bytes at offset ${h.offset}..${h.offset + 3} (${hex(h.slice)}) and clear the top bit (& 0x7fffffff), giving the 31-bit number ${h.bin}. Masking avoids signed/unsigned differences between implementations.`,
  });
  push({
    stage: 'mod',
    caption: `${h.bin} mod 10^6 = ${h.code}. The phone shows ${h.code} (zero-padded to 6 digits). The 8-digit RFC variant would be ${String(h.bin % 1e8).padStart(8, '0')}.`,
  });
  push({
    stage: 'send',
    caption: `The user types ${h.code} into the login form together with their password. The code proves possession of the secret right now, without sending the secret.`,
  });
  const dir = p.drift > 0 ? `${p.drift} s behind the phone` : p.drift < 0 ? `${-p.drift} s ahead of the phone` : 'in perfect sync with the phone';
  const reach = Cs - C;
  push({
    stage: 'server-time',
    caption: `The server's clock reads ${ts} (${dir}), so its counter is ${Cs}${Cs === C ? ', the same step as the phone' : `, ${Math.abs(reach)} step${Math.abs(reach) === 1 ? '' : 's'} ${reach < 0 ? 'behind' : 'ahead of'} the phone`}. It accepts counters ${Cs - p.window}..${Cs + p.window} (window ±${p.window}).`,
    predict: `With window ±${p.window}, will the server accept ${h.code}?`,
  });
  const checked: Candidate[] = [];
  let matched: Candidate | null = null;
  const order = p.window === 0 ? [0] : [0, -1, 1];
  for (const d of order) {
    const cc = hotp(secret, Cs + d);
    const cand: Candidate = { delta: d, counter: Cs + d, code: cc.code, match: cc.code === h.code };
    checked.push(cand);
    push({
      stage: 'check',
      checked: [...checked],
      caption: `Server computes the code for counter ${Cs + d} (T${d === 0 ? '' : d > 0 ? '+1' : '−1'}): ${cc.code}. ${cand.match ? `Match with ${h.code}.` : `No match with ${h.code}.`}`,
    });
    if (cand.match) {
      matched = cand;
      break;
    }
  }
  const accepted = matched !== null;
  if (accepted) {
    push({
      stage: 'verdict',
      checked: [...checked],
      accepted: true,
      lastUsed: matched!.counter,
      caption: `Accepted at offset ${matched!.delta >= 0 ? '+' : '−'}${Math.abs(matched!.delta)} step. The server records last-used counter = ${matched!.counter} for this user${matched!.delta !== 0 ? ' and can remember the drift so the next login checks the right step first (RFC 6238 resync)' : ''}.`,
    });
  } else {
    push({
      stage: 'verdict',
      checked: [...checked],
      accepted: false,
      caption: `Rejected: the phone used counter ${C}, outside ${Cs - p.window}..${Cs + p.window}. ${p.window === 0 ? 'With no window, even a few seconds of drift or slow typing across a step boundary fails.' : `A ${Math.abs(p.drift)} s drift is more than the ±1 step (±30 s) window can absorb; fix the clock (NTP) or resync.`} Each failure should count towards rate limiting.`,
    });
  }
  push({
    stage: 'replay',
    checked: [...checked],
    accepted,
    lastUsed: accepted ? matched!.counter : null,
    replayRejected: accepted,
    caption: accepted
      ? `Replay: an attacker who shoulder-surfed ${h.code} submits it 5 s later, still inside the window. The server rejects it because counter ${matched!.counter} ≤ last-used ${matched!.counter}. RFC 6238 says a code must be accepted only once.`
      : `Replay protection would still apply: once a code is accepted, the server stores its counter and rejects any code whose counter is ≤ that value, even inside the window.`,
  });
  push({
    stage: 'next',
    checked: [...checked],
    accepted,
    lastUsed: accepted ? matched!.counter : null,
    next,
    caption: `30 s later the counter is ${C + 1} and the phone shows ${next.code}: a brand-new HMAC, offset ${next.offset}, value ${next.bin}. Codes are short-lived; the secret, not the code, is what must be protected (stored encrypted server-side).`,
  });
  // the replay frame is the third "aha": ask before showing it
  const vi = frames.findIndex((f) => f.stage === 'verdict');
  if (accepted) frames[vi].predict = `An attacker replays ${h.code} 5 s later, still inside the window. Accepted?`;
  return frames;
}
