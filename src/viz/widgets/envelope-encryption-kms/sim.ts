// Pure model of application-level encryption with a KMS, step by step:
// write records → read them → stolen DB dump → row-swap attack → KEK rotation → crypto-shred a tenant.
// Approaches: "direct" (KMS Encrypt on every record), "envelope" (fresh DEK per record wrapped by a KEK),
// "cached" (envelope + a cached DEK per tenant, bounded by age and message count).
import type { BaseFrame } from '../../core';

export type Approach = 'direct' | 'envelope' | 'cached';
export type KeyScope = 'tenant' | 'shared';
export type Tenant = 'acme' | 'globex';

export interface Params {
  approach: Approach;
  keyScope: KeyScope;
  /** bind ciphertext to tenant + record id via encryption context / AAD */
  aad: boolean;
}

export interface Row {
  id: string;
  tenant: Tenant;
  kb: number;
  stored: boolean;
  /** which DEK encrypted it (envelope) or null for direct KMS Encrypt */
  dek: string | null;
  /** KEK (+ version) that wraps the DEK / encrypted the data */
  kek: string;
  kekVersion: number;
  readable: boolean;
  note: string;
}

export interface Frame extends BaseFrame {
  step: 'intro' | 'write' | 'read' | 'dump' | 'swap' | 'rotate' | 'shred' | 'summary';
  rows: Row[];
  /** keys present in KMS: name → current version, deleted flag */
  keks: { name: string; version: number; deleted: boolean }[];
  cache: string[];
  kmsCalls: number;
  kmsMs: number;
  /** bytes of payload sent to KMS (plaintext or wrapped keys) */
  kmsBytes: number;
  /** highlight: row ids touched this step */
  active: string[];
  /** KMS call kinds in this step, for the arrow label */
  calls: string;
  alert: { tone: 'good' | 'bad' | 'warn'; text: string } | null;
}

export const KMS_MS = 10;
export const KMS_MAX_KB = 4;
export const DEK_WRAP_BYTES = 184;
const RECORDS: { id: string; tenant: Tenant; kb: number }[] = [
  { id: 'a1', tenant: 'acme', kb: 1 },
  { id: 'g1', tenant: 'globex', kb: 2 },
  { id: 'a2', tenant: 'acme', kb: 2 },
  { id: 'a3', tenant: 'acme', kb: 10 },
  { id: 'g2', tenant: 'globex', kb: 1 },
  { id: 'g3', tenant: 'globex', kb: 3 },
];

export function simulate({ approach, keyScope, aad }: Params): Frame[] {
  const kekOf = (t: Tenant) => (keyScope === 'tenant' ? `kek-${t}` : 'kek-shared');
  const keks = (keyScope === 'tenant' ? ['kek-acme', 'kek-globex'] : ['kek-shared']).map((name) => ({ name, version: 1, deleted: false }));
  const rows: Row[] = [];
  let cache: string[] = [];
  let kmsCalls = 0;
  let kmsMs = 0;
  let kmsBytes = 0;
  let dekSeq = 0;
  const frames: Frame[] = [];
  const kms = (n: number, bytes: number) => {
    kmsCalls += n;
    kmsMs += n * KMS_MS;
    kmsBytes += bytes;
  };
  const push = (f: Omit<Frame, 'rows' | 'keks' | 'cache' | 'kmsCalls' | 'kmsMs' | 'kmsBytes'>) =>
    frames.push({ ...f, rows: rows.map((r) => ({ ...r })), keks: keks.map((k) => ({ ...k })), cache: [...cache], kmsCalls, kmsMs, kmsBytes });

  const how =
    approach === 'direct'
      ? 'every record is sent to KMS Encrypt'
      : approach === 'envelope'
        ? 'each record gets its own data key (DEK) from GenerateDataKey; the DEK encrypts locally with AES-256-GCM and is stored wrapped by the KEK'
        : 'one DEK per tenant is generated, cached in memory (max 5 min / 1,000 messages) and reused';
  push({
    step: 'intro',
    active: [],
    calls: '',
    alert: null,
    caption: `Two tenants store records with application-level encryption: ${how}. KEKs never leave the KMS HSM (${keyScope === 'tenant' ? 'one per tenant' : 'one shared by everyone'}). Encryption context (AAD) ${aad ? 'binds each ciphertext to {tenant, record}' : 'is not used'}.`,
  });

  // ---- writes
  for (const r of RECORDS) {
    const kek = kekOf(r.tenant);
    const row: Row = { ...r, stored: true, dek: null, kek, kekVersion: 1, readable: true, note: '' };
    let calls = '';
    let alert: Frame['alert'] = null;
    let caption: string;
    if (approach === 'direct') {
      if (r.kb > KMS_MAX_KB) {
        kms(1, 0);
        row.stored = false;
        row.readable = false;
        row.note = 'KMS: 4 KB limit';
        calls = 'Encrypt → ValidationException';
        alert = { tone: 'bad', text: `KMS Encrypt rejects ${r.kb} KB (max ${KMS_MAX_KB} KB)` };
        caption = `Write ${r.id} (${r.tenant}, ${r.kb} KB attachment): KMS Encrypt accepts at most ${KMS_MAX_KB} KB, so the call fails. Direct KMS encryption cannot handle real payloads — and every byte of plaintext crosses the network to KMS.`;
      } else {
        kms(1, r.kb * 1024);
        row.note = 'ciphertext from KMS';
        calls = `Encrypt(${r.kb} KB plaintext)`;
        caption = `Write ${r.id} (${r.tenant}, ${r.kb} KB): the plaintext goes to KMS Encrypt under ${kek} — one ${KMS_MS} ms network call and one request against the KMS quota per record.`;
      }
    } else {
      const reuse = approach === 'cached' && cache.includes(`dek-${r.tenant}`);
      if (!reuse) {
        kms(1, 0);
        dekSeq++;
        if (approach === 'cached') cache.push(`dek-${r.tenant}`);
      }
      row.dek = approach === 'cached' ? `dek-${r.tenant}` : `dek-${dekSeq}`;
      row.note = 'AES-GCM locally';
      calls = reuse ? '(cache hit — no KMS call)' : `GenerateDataKey(${kek})`;
      caption = reuse
        ? `Write ${r.id} (${r.tenant}, ${r.kb} KB): the cached ${r.tenant} DEK is reused — no KMS call. AES-GCM runs locally at GB/s; the wrapped DEK is stored next to the ciphertext.`
        : `Write ${r.id} (${r.tenant}, ${r.kb} KB): GenerateDataKey returns a plaintext DEK and the same DEK wrapped by ${kek}. Encrypt locally (${r.kb} KB is no problem), store {wrapped DEK, iv, tag, ciphertext}${
            approach === 'cached' ? ', keep the plaintext DEK in the cache' : ', then zero the plaintext DEK'
          }.`;
    }
    rows.push(row);
    push({ step: 'write', active: [r.id], calls, alert, caption });
  }

  // ---- reads
  {
    const stored = rows.filter((r) => r.stored);
    let calls: number;
    if (approach === 'direct') calls = stored.length;
    else if (approach === 'envelope') calls = stored.length;
    else calls = 0; // DEKs still in the cache from writing; a cold reader would need one Decrypt per tenant
    kms(calls, approach === 'direct' ? stored.reduce((s, r) => s + r.kb * 1024, 0) : calls * DEK_WRAP_BYTES);
    push({
      step: 'read',
      active: stored.map((r) => r.id),
      calls: calls ? `${calls}× Decrypt` : '(cache hits)',
      alert: null,
      caption:
        approach === 'direct'
          ? `Read all ${stored.length} stored records: ${calls} KMS Decrypt calls, each shipping the ciphertext to KMS and the plaintext back (${calls * KMS_MS} ms of network time).`
          : approach === 'envelope'
            ? `Read all ${stored.length}: one small KMS Decrypt per record to unwrap its DEK (${DEK_WRAP_BYTES} bytes, not the data), then decrypt locally. Every unwrap is IAM-checked and audit-logged.`
            : `Read all ${stored.length}: the tenant DEKs are still cached, so 0 KMS calls. Caching cuts KMS traffic 100–1000×; the cost is a plaintext key in memory for up to 5 minutes, bounded by max age and message count.`,
    });
  }

  // ---- stolen DB dump
  push({
    step: 'dump',
    active: rows.filter((r) => r.stored).map((r) => r.id),
    calls: '',
    alert: { tone: 'good', text: 'dump = ciphertext + wrapped keys: useless without KMS Decrypt' },
    caption: `An attacker steals a DB dump via SQL injection. They get ciphertext${approach === 'direct' ? '' : ' and wrapped DEKs'} but no key material: unwrapping needs kms:Decrypt, which only the app’s role has. Disk/TDE encryption would NOT help here — the DB decrypts for every query.`,
  });

  // ---- row swap: copy acme's ciphertext into globex's row so globex's user can read it
  {
    const src = rows.find((r) => r.id === 'a1')!;
    const dst = rows.find((r) => r.id === 'g1')!;
    dst.note = 'holds a1’s ciphertext';
    dst.dek = src.dek;
    dst.kek = src.kek;
    dst.kekVersion = src.kekVersion;
    const leak = !aad;
    if (leak) dst.readable = true;
    if (approach !== 'cached') kms(1, approach === 'direct' ? src.kb * 1024 : DEK_WRAP_BYTES);
    push({
      step: 'swap',
      active: ['a1', 'g1'],
      calls: approach === 'cached' ? '' : '1× Decrypt',
      alert: leak ? { tone: 'bad', text: 'globex user reads acme’s record' } : { tone: 'good', text: 'decrypt fails: context mismatch' },
      caption: leak
        ? `A malicious insider with DB write access copies ${src.id}’s ciphertext (and wrapped DEK) into ${dst.id}. The app’s role can decrypt it — the ciphertext carries no owner — so globex’s user now sees acme’s data. Bind ciphertext to its owner with AAD / encryption context.`
        : `A malicious insider copies ${src.id}’s ciphertext into ${dst.id}. The app decrypts with context {tenant: globex, record: g1}, but it was sealed with {tenant: acme, record: a1}: the GCM tag (or KMS context check) fails, so the swap is detected instead of leaking.`,
    });
    if (!leak) dst.readable = false;
    if (aad) dst.note = 'tampered: rejected';
  }

  // ---- rotate KEK
  {
    for (const k of keks) k.version = 2;
    const wrapped = rows.filter((r) => r.stored && r.dek);
    const dekCount = new Set(wrapped.map((r) => r.dek)).size;
    push({
      step: 'rotate',
      active: [],
      calls: approach === 'direct' ? '' : 'optional ReEncrypt of wrapped DEKs',
      alert: { tone: 'good', text: 'no data re-encrypted' },
      caption:
        approach === 'direct'
          ? `Yearly KEK rotation: KMS adds key version 2 for new encryptions and keeps v1 to decrypt old ciphertext, so nothing is re-encrypted. (Moving data off v1 would mean round-tripping every record through KMS.)`
          : `Yearly KEK rotation: KMS adds version 2 and keeps v1 for unwrapping, so no data is touched. Re-wrapping off v1 means ${dekCount} ReEncrypt call${dekCount === 1 ? '' : 's'} on ${DEK_WRAP_BYTES}-byte DEKs — for 10 TB of data it is still only the keys that move.`,
    });
  }

  // ---- crypto-shred globex
  {
    const target = keyScope === 'tenant' ? 'kek-globex' : null;
    if (target) {
      keks.find((k) => k.name === target)!.deleted = true;
      for (const r of rows)
        if (r.tenant === 'globex') {
          r.readable = false;
          r.note = 'key destroyed';
        }
      cache = cache.filter((c) => c !== 'dek-globex');
    }
    push({
      step: 'shred',
      active: rows.filter((r) => r.tenant === 'globex').map((r) => r.id),
      calls: target ? 'ScheduleKeyDeletion(kek-globex)' : '',
      alert: target ? { tone: 'good', text: 'globex erased everywhere, including backups' } : { tone: 'warn', text: 'cannot shred one tenant: shared KEK' },
      caption: target
        ? `Globex leaves and invokes GDPR erasure. Schedule deletion of kek-globex (after a waiting period): every globex row — in the DB, replicas, snapshots and year-old backups — becomes unreadable at once. That is crypto-shredding. Acme is untouched.${approach === 'cached' ? ' The cached globex DEK is evicted too.' : ''}`
        : `Globex invokes GDPR erasure, but its records are wrapped by the same KEK as acme’s. Deleting that key would destroy everyone’s data, so you must hunt down globex rows in every backup and snapshot instead. Per-tenant KEKs make erasure one API call.`,
    });
  }

  const at = 1000;
  const perSec = approach === 'cached' ? 2 : at; // cached: one GenerateDataKey per tenant per 1,000 messages
  push({
    step: 'summary',
    active: [],
    calls: '',
    alert: null,
    caption: `Totals: ${kmsCalls} KMS calls, ${kmsMs} ms waiting on KMS, ${kmsBytes >= 1024 ? `${(kmsBytes / 1024).toFixed(1)} KB` : `${kmsBytes} B`} sent to it. At ${at.toLocaleString('en-US')} writes/s that is ≈${perSec.toLocaleString('en-US')} KMS calls/s${
      approach === 'cached' ? ' (one new DEK per tenant per 1,000 messages)' : ' — near the per-region KMS quota and $0.03 per 10,000 calls'
    }.${approach === 'direct' ? ' Records over 4 KB could not be stored at all.' : ''}`,
  });
  return frames;
}
