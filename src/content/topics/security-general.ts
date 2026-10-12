import type { Topic } from '../../types';

const topic: Topic = {
  id: 'security-general',
  phase: 'apis-security',
  order: 4,
  title: 'Application Security, Secrets & Multi-Tenancy',
  subtitle:
    'TLS, envelope encryption with KMS, password hashing, secrets management, RBAC/ABAC/ReBAC, tenant isolation with Postgres RLS, injection/XSS/CSRF/SSRF and layered DDoS defence',
  estimatedMinutes: 95,
  sources: [
    'Mastering API Architecture — Ch 6 Threat Modeling (defence in depth context)',
    'Google Zanzibar paper (USENIX ATC 2019)',
    'OWASP Password Storage, SSRF, CSRF & XSS Prevention Cheat Sheets',
    'AWS SaaS Lens — silo / pool / bridge tenant isolation',
    'PostgreSQL docs — Row Security Policies',
  ],
  tags: ['security', 'encryption', 'kms', 'secrets', 'vault', 'multi-tenancy', 'rls', 'rbac', 'abac', 'rebac', 'ssrf', 'xss', 'csrf', 'ddos'],
  cheatSheet: [
    'Defence in depth: edge (CDN/WAF/DDoS) → gateway (authN, quotas) → service (authZ per object) → data (RLS, encryption, least-privilege DB role). Assume every layer above you fails.',
    'TLS 1.3 = 1-RTT handshake (0-RTT resumption is replayable — never for non-idempotent requests); forward secrecy via ephemeral ECDHE; HSTS + automated cert rotation (ACME, ≤90-day certs).',
    'Envelope encryption: KMS holds the KEK (never leaves HSM); per-object/tenant DEK encrypts data with AES-256-GCM; store the wrapped DEK next to ciphertext. Rotate KEK without re-encrypting data; delete a tenant key = crypto-shredding.',
    'AES-GCM: 96-bit nonce must NEVER repeat under one key (repeat leaks plaintext XOR + enables forgery); random nonces are safe up to ~2^32 messages per key.',
    'Passwords: argon2id (OWASP min m=19 MiB, t=2, p=1) or bcrypt cost ≥10 (72-byte input limit!). Per-user salt is automatic; pepper = HMAC key kept in a secrets manager/HSM, not the DB.',
    'Secrets: never in git/images/env files in repos. Vault/Secrets Manager + workload identity (K8s SA, IAM roles); prefer short-lived dynamic credentials (TTL minutes–hours) over rotated static ones.',
    'Leaked secret: REVOKE/ROTATE first (minutes), then audit usage logs for the exposure window, then scrub history. Deleting the commit is not remediation — bots scrape GitHub in seconds.',
    'RBAC = roles (role explosion at scale); ABAC = policy over attributes (tenant, region, clearance); ReBAC = graph of relationships (Zanzibar/OpenFGA/SpiceDB) — the model for sharing/hierarchies.',
    'Multi-tenancy: silo (DB/account per tenant, strongest, costly), pool (shared tables + tenant_id + RLS, cheapest), bridge (schema per tenant or tiered mix). RLS needs FORCE + non-owner NOBYPASSRLS role + SET LOCAL.',
    'Web vulns: SQLi → parameterize (identifiers via allowlist); XSS → contextual output encoding + CSP nonces; CSRF → SameSite + anti-CSRF token, no state change on GET; SSRF → egress allowlist, validate resolved IP at connect time, IMDSv2 hop-limit 1.',
  ],
  sections: [
    {
      heading: 'Mental model: defence in depth and blast radius',
      body: `**Intuition:** security is a castle with several walls. You do not bet the kingdom on the outer gate; each wall assumes the one before it has already fallen.

For a typical NestJS/microservices stack the walls are:

| Layer | Controls | Failure it contains |
|---|---|---|
| Edge | Anycast CDN, WAF, DDoS scrubbing, bot management | Volumetric floods, known exploit payloads |
| Gateway | TLS termination, authentication, quotas | Anonymous abuse, credential stuffing |
| Service | Per-object authorization, input validation, output encoding | BOLA-style bugs, injection, XSS |
| Data | Least-privilege DB roles, RLS, encryption at rest, KMS | A compromised service or SQL bug leaking everything |
| Platform | Secrets manager, workload identity, network policies, egress control | Stolen credentials, lateral movement, SSRF |

Two principles drive every decision below:

- **Least privilege** — each workload gets only the permissions it needs (a read replica user for the reporting service, no \`BYPASSRLS\`, IAM policies scoped to one KMS key).
- **Minimise blast radius** — when (not if) something leaks, how much leaks? Per-tenant keys, short-lived credentials and per-service DB users turn "full breach" into "one tenant, 15 minutes".

**Interview framing:** start any security answer with "what are we protecting, from whom, and what is the blast radius if this control fails", then walk the layers. That is what separates a senior answer from a list of buzzwords. (Formal threat modelling with STRIDE and the OWASP API Top 10 is covered in the API Security topic.)`,
      diagram: `  Internet
     |
 [ Anycast CDN / WAF / DDoS scrubbing ]   L3/L4 floods, L7 bad bots
     |
 [ API Gateway: TLS, authN, quotas ]      who are you? how much?
     |
 [ Services: authZ per object, validate ] may YOU touch THIS row?
     |            \\
     |         [ egress proxy ]           SSRF / exfil control
     |
 [ Data: RLS, NOBYPASSRLS role, KMS ]     last line: even buggy SQL
                                          cannot cross tenants`,
      keyPoints: [
        'Each layer must assume the previous one has failed.',
        'Least privilege + small blast radius beat any single clever control.',
        'Security answers start with assets, adversaries and blast radius.',
      ],
    },
    {
      heading: 'Encryption in transit: TLS 1.3 done properly',
      body: `**Intuition:** TLS gives you three things — the server is who it claims (authentication via certificates), nobody can read the traffic (confidentiality), nobody can modify it undetected (integrity).

**Mechanics that matter in interviews**

- **TLS 1.3** removes RSA key exchange and weak ciphers; the handshake is **1-RTT** (TLS 1.2 was 2-RTT). Over a 100 ms RTT link that saves ~100 ms on every new connection — one reason keep-alive and connection pooling matter.
- **Forward secrecy:** keys come from ephemeral (EC)DHE, so stealing the server's private key later does not decrypt recorded traffic.
- **0-RTT resumption** sends data in the first flight but that data is **replayable** — only allow it for idempotent GETs, or disable it.
- **HSTS** (\`Strict-Transport-Security\`) stops downgrade/SSL-stripping on browsers; add \`preload\` only once every subdomain is HTTPS.
- **Certificates:** automate with ACME (Let's Encrypt, cert-manager). Short-lived certs (≤90 days; the CA/Browser Forum has voted to shrink public cert lifetimes to 47 days by 2029) make automation mandatory — manual renewal is the #1 cause of TLS outages.

**Where to terminate TLS?** Terminating at the load balancer and sending plaintext inside the VPC was once normal; zero-trust designs re-encrypt to the pod (or use a mesh with mTLS between services). Cost of TLS today is small: AES-GCM with AES-NI runs at multiple GB/s per core; the expensive part is the handshake (~1–2 ms of CPU for ECDHE + signature), which is why connection reuse matters more than cipher choice.

**Say this in interviews:** "TLS 1.2+ only, prefer 1.3, ECDHE for forward secrecy, HSTS, automated rotation, and TLS all the way to the workload — not just to the load balancer."`,
      code: [
        {
          language: 'nginx',
          title: 'Hardened TLS termination (nginx)',
          code: `server {
    listen 443 ssl;
    http2 on;
    server_name api.example.com;

    ssl_certificate     /etc/ssl/live/api/fullchain.pem;  # rotated by cert-manager/ACME
    ssl_certificate_key /etc/ssl/live/api/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;            # no TLS 1.0/1.1
    ssl_prefer_server_ciphers off;            # let TLS 1.3 clients choose
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305;
    ssl_session_cache shared:TLS:20m;         # resumption = cheaper handshakes
    ssl_session_tickets off;                  # tickets weaken forward secrecy unless keys rotate
    ssl_early_data off;                       # 0-RTT data is replayable

    ssl_stapling on;                          # OCSP stapling: faster revocation checks
    ssl_stapling_verify on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass https://api_upstream;      # re-encrypt to the backend (zero trust)
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/internal-ca.pem;
    }
}`,
        },
      ],
      keyPoints: [
        'TLS 1.3: 1-RTT, forward secrecy mandatory; 0-RTT data is replayable.',
        'The handshake, not bulk encryption, is the cost — reuse connections.',
        'Automate certificate rotation; expiry is the classic TLS outage.',
      ],
    },
    {
      heading: 'Encryption at rest, envelope encryption & KMS',
      body: `**Intuition:** you do not lock every drawer with the master key. You lock each drawer with its own small key, then lock all the small keys in a safe. The safe is KMS; the small keys are data keys.

**Levels of "encryption at rest"**

| Level | Protects against | Does NOT protect against |
|---|---|---|
| Disk/volume (EBS, RDS storage encryption) | Stolen disks, decommissioned hardware | Anyone with DB access — data is decrypted for every query |
| Database TDE | Stolen backups/data files | SQL-level access, a compromised app |
| **Application-level (field) encryption** | DB dumps, SQL injection reads, rogue DBAs | A compromised app that holds decrypt permission |

Disk encryption is table stakes and nearly free; it is a compliance checkbox, not a real defence against application-level breaches. For PII/PCI fields use **application-level envelope encryption**.

**Envelope encryption mechanics**

1. Call KMS \`GenerateDataKey\` → returns a plaintext **DEK** (data encryption key) and the same DEK encrypted under the **KEK** (key encryption key, never leaves the HSM).
2. Encrypt the data locally with AES-256-GCM using the DEK. Store \`{wrappedDek, iv, tag, ciphertext}\`.
3. Zero the plaintext DEK from memory.
4. To decrypt: send \`wrappedDek\` to KMS \`Decrypt\` (IAM-checked, audit-logged), then decrypt locally.

**Why envelope and not "just call KMS Encrypt"?** KMS \`Encrypt\` accepts max 4 KB, each call is a network hop (~5–20 ms) and costs money ($0.03 per 10,000 requests on AWS) and counts against a per-account request quota (thousands to tens of thousands/s per region). Local AES-GCM runs at GB/s.

**Key design decisions**

- **Per-tenant KEK or DEK** → per-tenant blast radius and **crypto-shredding**: delete the tenant's key and every backup copy becomes unreadable (GDPR erasure without hunting through backups).
- **Encryption context / AAD:** bind ciphertext to its owner (\`tenantId\`, \`recordId\`) so a ciphertext copied to another row fails to decrypt.
- **Rotation:** KMS automatic rotation keeps old key versions for decryption, so rotating the KEK needs no data re-encryption; re-wrapping DEKs is cheap because only small keys are re-encrypted.
- **DEK caching:** cache decrypted DEKs for a few minutes (AWS Encryption SDK has a caching CMM) to cut KMS calls by 100–1000x — bounded by max age and max messages per key.
- **Searchability:** encrypted fields cannot be range-queried; store a keyed HMAC ("blind index") of normalised email for equality lookups.`,
      code: [
        {
          language: 'typescript',
          title: 'Envelope encryption with AWS KMS + AES-256-GCM',
          code: `import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const kms = new KMSClient({ region: 'eu-west-1' });
const KEK_ID = 'alias/pii-master';

export interface Sealed { wrappedDek: string; iv: string; tag: string; ct: string }

export async function seal(plain: Buffer, tenantId: string): Promise<Sealed> {
  // EncryptionContext is bound into the wrapped key and shows up in CloudTrail
  const out = await kms.send(new GenerateDataKeyCommand({
    KeyId: KEK_ID, KeySpec: 'AES_256', EncryptionContext: { tenantId },
  }));
  const dek = Buffer.from(out.Plaintext!);
  const iv = randomBytes(12);                       // 96-bit nonce, unique per encryption
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(tenantId));             // ciphertext only valid for this tenant
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  dek.fill(0); out.Plaintext!.fill(0);              // do not keep the plaintext key around
  return {
    wrappedDek: Buffer.from(out.CiphertextBlob!).toString('base64'),
    iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64'),
  };
}

export async function unseal(s: Sealed, tenantId: string): Promise<Buffer> {
  const { Plaintext } = await kms.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(s.wrappedDek, 'base64'),
    EncryptionContext: { tenantId },                // wrong tenant => KMS refuses
  }));
  const dek = Buffer.from(Plaintext!);
  try {
    const d = createDecipheriv('aes-256-gcm', dek, Buffer.from(s.iv, 'base64'));
    d.setAAD(Buffer.from(tenantId));
    d.setAuthTag(Buffer.from(s.tag, 'base64'));     // tamper => final() throws
    return Buffer.concat([d.update(Buffer.from(s.ct, 'base64')), d.final()]);
  } finally { dek.fill(0); Plaintext!.fill(0); }
}`,
        },
      ],
      keyPoints: [
        'Disk encryption ≠ protection from an app-level breach; use field-level envelope encryption for PII.',
        'KEK in KMS/HSM, DEK per object/tenant, AES-256-GCM locally, store wrapped DEK with the data.',
        'Per-tenant keys enable crypto-shredding and shrink blast radius.',
        'Encryption context/AAD binds ciphertext to its owner.',
      ],
    },
    {
      heading: 'Password hashing: argon2id, bcrypt, salts and peppers',
      body: `**Intuition:** you never store passwords, you store a *deliberately slow, memory-hungry* fingerprint so that a stolen table costs attackers years instead of minutes.

**Why not SHA-256 + salt?** A single modern GPU computes on the order of **10 billion SHA-256 hashes per second**. A salted SHA-256 table of 10M users falls to dictionary attacks overnight. Password hashes must be *slow* (work factor) and ideally *memory-hard* (defeats GPUs/ASICs, which have lots of cores but little fast memory per core).

| Algorithm | Notes | Recommended settings (OWASP) |
|---|---|---|
| **argon2id** | Memory-hard, winner of the Password Hashing Competition; default choice | m = 19 MiB, t = 2, p = 1 minimum (or m = 46 MiB, t = 1) |
| scrypt | Memory-hard, older | N = 2^17, r = 8, p = 1 |
| bcrypt | Battle-tested; **truncates input at 72 bytes** | cost ≥ 10 (≈ 50–100 ms) |
| PBKDF2-HMAC-SHA256 | Only when FIPS is mandated; not memory-hard | 600,000 iterations |

**Salt vs pepper**

- **Salt:** random per-user value stored *with* the hash (argon2/bcrypt embed it in the output string). Defeats rainbow tables and makes identical passwords hash differently.
- **Pepper:** a secret shared across users kept *outside* the database (secrets manager or HSM). A DB-only leak (SQL injection, stolen backup) is then useless. Apply it as \`HMAC(pepper, password)\` before hashing — never as string concatenation into bcrypt (72-byte truncation) — and plan for pepper rotation (store a pepper version).

**Operational concerns**

- Tune cost so one hash takes **~50–250 ms** on your hardware; it is CPU and memory per login, so logins need their own capacity plan and rate limiting (hash cost is a DoS amplifier).
- **Upgrade on login:** \`needsRehash\` lets you raise parameters or migrate legacy hashes (MD5 → argon2id) transparently; for dormant users, wrap the old hash: \`argon2id(md5_hash)\`.
- Compare secrets (API keys, tokens, HMACs) with \`crypto.timingSafeEqual\`, not \`===\`.
- Check new passwords against breached-password lists (HIBP k-anonymity API) instead of complexity rules — NIST SP 800-63B guidance.`,
      code: [
        {
          language: 'typescript',
          title: 'argon2id with an HMAC pepper and transparent rehash',
          code: `import argon2 from 'argon2';
import { createHmac } from 'node:crypto';

// Loaded from Vault / Secrets Manager at boot; versioned so it can rotate.
const PEPPERS: Record<string, string> = { v2: process.env.PEPPER_V2!, v1: process.env.PEPPER_V1! };
const CURRENT_PEPPER = 'v2';
const PARAMS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }; // 19 MiB

function pepper(pw: string, version: string): Buffer {
  // NFKC so visually identical Unicode passwords hash the same way
  return createHmac('sha256', PEPPERS[version]).update(pw.normalize('NFKC')).digest();
}

export async function hashPassword(pw: string): Promise<{ hash: string; pepperVersion: string }> {
  return { hash: await argon2.hash(pepper(pw, CURRENT_PEPPER), PARAMS), pepperVersion: CURRENT_PEPPER };
}

export async function verifyPassword(
  stored: { hash: string; pepperVersion: string },
  pw: string,
  onUpgrade: (h: { hash: string; pepperVersion: string }) => Promise<void>,
): Promise<boolean> {
  const ok = await argon2.verify(stored.hash, pepper(pw, stored.pepperVersion));
  if (!ok) return false;
  // Transparent upgrade: stronger params or a newer pepper, done while we know the plaintext
  if (stored.pepperVersion !== CURRENT_PEPPER || argon2.needsRehash(stored.hash, PARAMS)) {
    await onUpgrade(await hashPassword(pw));
  }
  return true;
}`,
        },
      ],
      keyPoints: [
        'Fast hashes (SHA-256, MD5) are wrong for passwords regardless of salting.',
        'argon2id first; bcrypt fine but mind the 72-byte limit.',
        'Pepper lives outside the DB and is applied via HMAC.',
        'Password hashing is expensive by design — capacity-plan and rate-limit login.',
      ],
    },
    {
      heading: 'Secrets management: Vault, workload identity and rotation',
      body: `**Intuition:** a secret that never exists for long cannot leak for long. The goal is to move from "one DB password in a .env file for 3 years" to "each pod gets its own credential that expires in an hour".

**Maturity ladder**

1. Secrets in code / git — the most common real-world breach vector (GitGuardian reports ~10M+ new secrets leaked on public GitHub per year).
2. Env vars from CI variables — better, but long-lived and visible to anyone who can \`kubectl describe\` or read a crash dump.
3. **Central secrets manager** (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager) — encrypted, audited, access by policy, **scheduled rotation**.
4. **Dynamic secrets** — Vault's database engine creates a unique DB user per workload with a TTL (e.g. 1 h) and drops it on expiry. Leaks self-heal; audit logs identify exactly which pod used a credential.
5. **No secrets at all** — workload identity (IRSA / EKS Pod Identity, GKE Workload Identity, SPIFFE) exchanges a platform-signed identity token for short-lived cloud credentials; RDS IAM auth tokens live 15 minutes.

**Bootstrapping ("secret zero")**: the app authenticates to Vault with something the platform gives it — the Kubernetes service-account JWT (Vault Kubernetes auth), an AWS IAM role — never with another static token baked into the image.

**Rotation without downtime**: support *two valid credentials* at once (dual-secret / "current + previous"). Rotate: create new → deploy consumers to use new → verify traffic → revoke old. For DB passwords with a pool, recreate the pool before lease expiry.

**Hygiene**: pre-commit + CI secret scanning (gitleaks, trufflehog), GitHub push protection, never log secrets (redact in logger config), mount secrets as files with tight permissions rather than env vars where possible, and keep K8s Secrets encrypted at rest with a KMS provider (base64 is not encryption).`,
      code: [
        {
          language: 'typescript',
          title: 'Dynamic DB credentials from Vault via Kubernetes auth',
          code: `import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const VAULT = process.env.VAULT_ADDR!;             // e.g. https://vault.internal:8200

async function vaultLogin(): Promise<string> {
  // Platform-issued identity: no static secret baked into the image
  const jwt = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const res = await fetch(VAULT + '/v1/auth/kubernetes/login', {
    method: 'POST',
    body: JSON.stringify({ role: 'orders-service', jwt }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error('vault login failed: ' + res.status);
  return (await res.json()).auth.client_token;
}

let pool: Pool | undefined;

export async function refreshDbPool(): Promise<void> {
  const token = await vaultLogin();
  const res = await fetch(VAULT + '/v1/database/creds/orders-rw', {
    headers: { 'X-Vault-Token': token },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error('vault creds failed: ' + res.status);
  const body = await res.json();                   // { lease_duration: 3600, data: { username, password } }
  const next = new Pool({ host: 'orders-db', database: 'orders', max: 10,
    user: body.data.username, password: body.data.password });
  const old = pool;
  pool = next;                                     // new queries use the new user immediately
  await old?.end();                                // drain the pool using the expiring user
  // Refresh at ~2/3 of the lease so we never hit expiry mid-traffic
  setTimeout(() => refreshDbPool().catch(console.error), body.lease_duration * 1000 * 0.66).unref();
}

export const db = () => { if (!pool) throw new Error('pool not ready'); return pool; };`,
        },
      ],
      keyPoints: [
        'Short-lived, per-workload credentials beat rotated long-lived ones.',
        'Solve secret-zero with platform identity (K8s SA token, IAM role).',
        'Zero-downtime rotation requires two valid secrets during the overlap.',
        'Base64 K8s Secrets are not encrypted — enable KMS encryption at rest.',
      ],
    },
    {
      heading: 'Authorization models: RBAC vs ABAC vs ReBAC (Zanzibar)',
      body: `**Intuition:** RBAC asks "what is your job title?", ABAC asks "what are the facts about you, the resource and the context?", ReBAC asks "how are you connected to this thing?".

| Model | Decision based on | Great for | Breaks down when |
|---|---|---|---|
| **RBAC** | user → role → permissions | Internal tools, admin consoles, a handful of coarse roles | Per-resource or per-tenant rules → **role explosion** (\`editor_tenant42_projectX\`) |
| **ABAC** | Policies over attributes of subject, resource, action, environment (tenant, region, clearance, time, device) | Compliance rules ("EU data only from EU staff", "PII only on managed devices") | Hard to answer "who can access X?" (reverse queries); policies become opaque |
| **ReBAC** | Relationship graph (user —member→ team —viewer→ folder —parent→ doc) | Sharing, nested groups, folder inheritance — Google Docs, GitHub, Notion | Needs a dedicated, consistent, low-latency graph service |

**Google Zanzibar** (2019) is the reference ReBAC system: relation tuples \`object#relation@subject\` (e.g. \`doc:roadmap#viewer@group:eng#member\`), a namespace config that defines how relations compose (editors are viewers; viewers of a folder view its docs), and Check/Expand/ListObjects APIs. It serves trillions of ACLs at ~10 ms p95 for Check, with millions of checks per second. Open-source descendants: **OpenFGA**, **SpiceDB**, **Permify**.

**The "new enemy" problem:** Alice removes Bob from a folder, *then* adds a secret doc. If the check uses a stale replica, Bob can see the new doc. Zanzibar solves it with **zookies** — consistency tokens stored with the content version so the check is evaluated at a snapshot at least as fresh as the content write.

**Practical architecture**

- Coarse RBAC in the gateway/JWT (\`role: admin\`), fine-grained per-object checks in the service via a policy engine — OPA/Cedar for ABAC rules, OpenFGA/SpiceDB for relationships.
- Keep **policy decision** (PDP) separate from **policy enforcement** (PEP) so rules change without redeploys, and log every decision for audit.
- For list endpoints avoid N checks per page: use ListObjects/lookup-resources, or pre-filter with tenant/owner columns in SQL and check the page.`,
      code: [
        {
          language: 'text',
          title: 'OpenFGA model: orgs, folders, documents with inheritance',
          code: `model
  schema 1.1

type user

type organization
  relations
    define admin: [user]
    define member: [user] or admin

type folder
  relations
    define org: [organization]
    define owner: [user]
    # org admins can view every folder; members of shared groups too
    define viewer: [user, organization#member] or owner or admin from org

type document
  relations
    define parent: [folder]
    define editor: [user] or owner from parent
    # inheritance: folder viewers see every doc inside
    define viewer: [user] or editor or viewer from parent`,
        },
        {
          language: 'typescript',
          title: 'Enforcing a ReBAC check in a NestJS guard',
          code: `import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { OpenFgaClient } from '@openfga/sdk';

@Injectable()
export class DocViewerGuard implements CanActivate {
  constructor(private readonly fga: OpenFgaClient) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const { allowed } = await this.fga.check({
      user: 'user:' + req.user.sub,          // from the VERIFIED token, never from the body
      relation: 'viewer',
      object: 'document:' + req.params.docId,
    });
    if (!allowed) throw new ForbiddenException(); // or 404 to avoid leaking existence
    return true;
  }
}`,
        },
      ],
      keyPoints: [
        'RBAC for coarse roles, ABAC for contextual/compliance rules, ReBAC for sharing and hierarchies.',
        'Role explosion is the signal you have outgrown RBAC.',
        'Zanzibar zookies solve the new-enemy problem (stale ACL + fresh content).',
        'Separate decision (PDP) from enforcement (PEP); log decisions.',
      ],
      source: 'Zanzibar: Google\'s Consistent, Global Authorization System (USENIX ATC 2019)',
    },
    {
      heading: 'Multi-tenant isolation: silo, pool, bridge and Postgres RLS',
      body: `**Intuition:** tenants are flats in a building. Silo = each tenant gets a separate house; pool = everyone shares one building with locked doors; bridge = shared building with a few private houses for VIPs.

| Model | Implementation | Isolation | Cost / ops | Typical use |
|---|---|---|---|---|
| **Silo** | DB (or AWS account/cluster) per tenant | Strongest; no noisy neighbours; per-tenant keys, backups, residency | Highest; N migrations, N connection pools | Enterprise, regulated, data residency |
| **Bridge** | Schema per tenant in a shared DB, or mixed tiers | Medium | Medium; thousands of schemas strain catalogs & migrations | Mid-market, gradual promotion |
| **Pool** | Shared tables + \`tenant_id\` column | Weakest by default — one missing WHERE leaks everything | Cheapest; one schema, best density | SMB/self-serve, 10K+ tenants |

Most real SaaS runs **tiered**: pool for free/SMB, silo for enterprise, with a tenant catalog that routes each request (tenantId → cluster/DB). Design the code so the tenant-routing layer is the only thing that differs.

**Making pool safe: Row-Level Security.** Put the tenant filter *in the database* so a forgotten \`WHERE tenant_id = ...\` returns zero rows instead of everyone's data.

Gotchas that bite in production:

1. **Table owners and superusers bypass RLS** — use \`FORCE ROW LEVEL SECURITY\` and connect as a non-owner role with \`NOBYPASSRLS\`.
2. **Session-level \`SET\` leaks through connection pools** — the next request on that connection inherits the previous tenant. Use \`SET LOCAL\` / \`set_config(..., true)\` inside a transaction (also works with PgBouncer transaction mode).
3. **Fail closed:** if the setting is missing the policy must match nothing (or error), never everything.
4. **Tenant ID must come from the verified token/session**, not a client header.
5. Put \`tenant_id\` first in composite indexes and unique constraints (\`UNIQUE (tenant_id, email)\`); RLS predicates are just WHERE clauses and need index support.
6. Isolation is more than rows: caches (prefix keys with tenant), search indices (filter or index-per-tenant), object storage (prefix + IAM condition), queues/logs, and per-tenant rate limits for noisy neighbours.`,
      code: [
        {
          language: 'sql',
          title: 'Postgres RLS for a pooled multi-tenant table',
          code: `CREATE TABLE invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  customer     text NOT NULL,
  amount_cents bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_tenant_created ON invoices (tenant_id, created_at DESC);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;   -- owner is subject to policies too

-- missing_ok=true returns NULL/'' when unset; NULLIF => NULL => predicate never true (fail closed)
CREATE POLICY tenant_isolation ON invoices
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- The application never connects as the owner or a superuser
CREATE ROLE app_rw LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO app_rw;`,
        },
        {
          language: 'typescript',
          title: 'Transaction-scoped tenant context (safe with pools and PgBouncer)',
          code: `import { Pool, PoolClient } from 'pg';

const pool = new Pool({ user: 'app_rw', max: 20 });

export async function withTenant<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // is_local = true: behaves like SET LOCAL, reverts at COMMIT/ROLLBACK,
    // so the next borrower of this connection cannot inherit our tenant.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// usage: tenantId comes from the verified JWT claim, not a header
// await withTenant(req.user.tenantId, c => c.query('SELECT * FROM invoices WHERE id = $1', [id]));`,
        },
      ],
      diagram: `         request (JWT: tenant=t42)
                 |
        [ tenant catalog / router ]
          /            |           \\
   tier=free      tier=pro      tier=enterprise
       |              |               |
  [ pooled DB ]  [ pooled DB ]   [ dedicated DB t42 ]
  RLS tenant_id  RLS tenant_id   own KMS key, region
  shared KMS     per-tenant DEK  own backups`,
      keyPoints: [
        'Silo = isolation, pool = density, bridge/tiered = what most SaaS actually runs.',
        'RLS makes a forgotten WHERE clause fail closed.',
        'FORCE RLS + NOBYPASSRLS role + transaction-scoped set_config are all required.',
        'Isolate caches, search, storage and queues too — not just SQL rows.',
      ],
      source: 'AWS SaaS Lens (Well-Architected) — Silo, Pool and Bridge models; PostgreSQL docs — Row Security Policies',
    },
    {
      heading: 'Injection, XSS and CSRF: the classic web trio',
      body: `**Intuition:** all three are the same bug — data crossing into a place where it is interpreted as *code* (SQL, HTML/JS) or a browser acting with the user's authority without the user's intent.

**SQL injection**

- Fix: **parameterized queries** everywhere (pg \`$1\`, TypeORM/Prisma parameters). String concatenation of user input into SQL is never acceptable, including in "internal" admin tools.
- Parameters bind **values**, not **identifiers**: \`ORDER BY $1\` binds a constant and silently does not sort by that column. Column names, sort direction and table names need an **allowlist map**.
- ORMs are not immune: raw query helpers fed by template-string interpolation, JSON operators and \`LIKE\` wildcards still need care. NoSQL has the same class (Mongo \`{ "$ne": null }\` operator injection) — validate types with a DTO schema.
- Defence in depth: least-privilege DB user (no DDL, no \`pg_read_file\`), RLS, WAF rules as a *secondary* layer only.

**Cross-site scripting (XSS)**

- **Stored** (saved comment renders script), **reflected** (query param echoed), **DOM-based** (client JS writes \`location.hash\` into \`innerHTML\`).
- Fix: **contextual output encoding** (React escapes by default — the danger is \`dangerouslySetInnerHTML\`, \`href="javascript:..."\` and server-side templates); sanitize rich HTML with DOMPurify on an allowlist; a **strict CSP** with nonces (\`script-src 'nonce-...' 'strict-dynamic'\`) so injected inline script does not run.
- Keep session cookies **HttpOnly** so XSS cannot read them (XSS can still act as the user — CSP matters).

**Cross-site request forgery (CSRF)**

- The browser automatically attaches cookies to cross-site requests; a malicious page can submit a form to your API as the logged-in user.
- Fix: \`SameSite=Lax\` (browser default in Chromium) or \`Strict\` on session cookies, **plus** an anti-CSRF token (synchronizer or signed double-submit) for state-changing requests, and **never change state on GET** (Lax still sends cookies on top-level GET navigations).
- APIs authenticated purely by an \`Authorization: Bearer\` header are not CSRF-able (browsers do not add it automatically) — but then the token lives in JS and XSS can steal it. That is the cookie-vs-header trade-off.
- CORS is **not** a CSRF defence: it controls who can *read* responses, while simple form POSTs are sent anyway.`,
      code: [
        {
          language: 'typescript',
          title: 'SQL: values as parameters, identifiers via allowlist',
          code: `import { Pool } from 'pg';
const pool = new Pool();

const SORTABLE: Record<string, string> = {        // API name -> trusted SQL identifier
  created: 'created_at',
  amount: 'amount_cents',
  customer: 'customer',
};

export async function listInvoices(q: { sort?: string; dir?: string; search?: string; limit?: number }) {
  const col = SORTABLE[q.sort ?? 'created'];
  if (!col) throw new Error('invalid sort field');  // reject, do not pass through
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';     // only two possible literals
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  // Escape LIKE wildcards so '%' from the user does not become a full scan pattern
  const term = (q.search ?? '').replace(/[\\\\%_]/g, (m) => '\\\\' + m);
  return pool.query(
    'SELECT id, customer, amount_cents, created_at FROM invoices ' +
    "WHERE customer ILIKE $1 ESCAPE '\\\\' ORDER BY " + col + ' ' + dir + ' LIMIT $2',
    ['%' + term + '%', limit],                      // values are always bound
  );
}`,
        },
        {
          language: 'typescript',
          title: 'Session cookie, CSRF and CSP headers (Express/NestJS)',
          code: `import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const nonce = randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;                     // templates add nonce="..." to their own scripts
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'nonce-" + nonce + "' 'strict-dynamic'",  // injected inline <script> will not run
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",                      // clickjacking
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

export function setSession(res: Response, sessionId: string) {
  res.cookie('__Host-sid', sessionId, {            // __Host- prefix: Secure, Path=/, no Domain
    httpOnly: true,                                // JS (and XSS) cannot read it
    secure: true,
    sameSite: 'lax',                               // blocks cross-site POST/fetch cookies
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  });
}`,
        },
      ],
      keyPoints: [
        'Parameterize values; allowlist identifiers (ORDER BY, table names).',
        'XSS: encode on output by context, sanitize rich HTML, strict CSP with nonces.',
        'CSRF: SameSite + token, no state change on GET; CORS is not CSRF protection.',
      ],
    },
    {
      heading: 'SSRF and the cloud metadata endpoint',
      body: `**Intuition:** SSRF is tricking *your* server into making a request for the attacker — from inside your network, with your server's identity. Any feature that fetches a user-supplied URL (webhooks, link previews, "import from URL", PDF renderers, image proxies) is a candidate.

**Why it is devastating in the cloud:** the instance metadata service at \`169.254.169.254\` hands out the instance's IAM role credentials. The **2019 Capital One breach** (~100M customer records) was an SSRF through a misconfigured WAF that fetched metadata credentials and then read S3 buckets.

**Why blocklists fail:** attackers bypass string checks with \`http://2852039166/\` (decimal IP), \`http://0xA9FEA9FE/\`, \`http://[::ffff:169.254.169.254]/\`, a DNS name that resolves to an internal IP, **DNS rebinding** (resolves public at validation time, private at connect time), or a public URL that **302-redirects** to an internal one.

**Defences (layered)**

1. **Allowlist** destinations where possible (known webhook domains, S3 buckets).
2. **Resolve, validate, connect to the same IP**: validate every resolved address at *connection time* (custom DNS lookup hook), rejecting private, loopback, link-local, CGNAT, ULA and IPv4-mapped IPv6 ranges.
3. **Redirects:** disable, or follow manually re-validating each hop (max 3).
4. **Scheme/port allowlist:** https only, port 443 (no \`file://\`, \`gopher://\`, \`:6379\`).
5. **Network egress control:** run fetchers in an isolated subnet/pod with a NetworkPolicy or an egress proxy (Smokescreen) that enforces the same rules — this survives application bugs.
6. **IMDSv2 with hop limit 1:** metadata requires a PUT to get a session token, and a hop limit of 1 stops containers (one extra hop) from reaching it; GCP requires \`Metadata-Flavor: Google\`. Plus least-privilege instance roles so stolen creds are nearly useless.
7. Do not return raw response bodies or detailed errors to the caller (blind SSRF port scanning via timing/errors).`,
      code: [
        {
          language: 'bash',
          title: 'Enforce IMDSv2 and a hop limit of 1 (AWS)',
          code: `# Require session tokens (IMDSv2) and block containers one hop away from the metadata service
aws ec2 modify-instance-metadata-options \\
  --instance-id i-0abc123def4567890 \\
  --http-tokens required \\
  --http-put-response-hop-limit 1 \\
  --http-endpoint enabled

# What a legitimate on-host client now has to do (a naive SSRF GET cannot):
TOKEN=$(curl -s -X PUT 'http://169.254.169.254/latest/api/token' \\
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \\
  http://169.254.169.254/latest/meta-data/iam/security-credentials/

# Org-wide guardrail: new launches must use IMDSv2
aws ec2 modify-instance-metadata-defaults --region eu-west-1 \\
  --http-tokens required --http-put-response-hop-limit 1`,
        },
      ],
      keyPoints: [
        'Any user-supplied URL fetch is an SSRF surface.',
        'String blocklists lose to IP encodings, DNS rebinding and redirects — validate the resolved IP at connect time.',
        'IMDSv2 + hop limit 1 + egress controls + least-privilege roles.',
      ],
    },
    {
      heading: 'DDoS and abuse protection in layers',
      body: `**Intuition:** you cannot out-scale a botnet with your own servers — absorb volume at the edge (someone else's enormous network), and make each request that reaches you cheap to reject.

| Attack | Example | Where to stop it |
|---|---|---|
| **Volumetric (L3/L4)** | UDP/DNS/memcached amplification, 100s of Gbps–Tbps | Anycast CDN / scrubbing (Cloudflare, AWS Shield, Akamai). Your VPC cannot absorb it — your uplink saturates before your pods see anything |
| **Protocol (L4)** | SYN flood, ACK flood | SYN cookies, edge proxies, cloud LB (not your app) |
| **Application (L7)** | HTTP floods, expensive search/login/report endpoints, Slowloris | WAF + bot management at edge, rate limits/quotas at gateway, per-endpoint cost controls, caching |
| **Business-logic abuse** | Credential stuffing, scraping, SMS-pumping, signup fraud | Bot detection, CAPTCHA/proof-of-work on risk, per-account limits, anomaly detection |

Scale reference points: record attacks now exceed **5 Tbps** and hundreds of millions of requests/s (Cloudflare reported multi-Tbps floods in 2024–2025); a single origin is sized for thousands to low hundreds of thousands of RPS.

**Principles**

- **Hide the origin:** only accept traffic from the CDN's IP ranges (or authenticated origin pulls); a leaked origin IP bypasses everything.
- **Asymmetry kills you:** a 200-byte request that triggers a 2-second DB query is a 10,000x amplifier. Identify expensive endpoints (search, export, login with argon2) and give them tighter limits, caching, queues or proof-of-work.
- **Autoscaling is not DDoS protection** — it converts an outage into a bill (and your DB does not autoscale).
- **Degrade gracefully:** load shedding, serve stale cache, disable non-critical features under attack.
- **Abuse signals:** fingerprint (JA3/JA4 TLS fingerprints), ASN/IP reputation, velocity per account/device/card, impossible travel. (Algorithms for rate limiting are covered in the Rate Limiting topic.)`,
      code: [
        {
          language: 'nginx',
          title: 'Origin hardening: only the CDN, cheap rejection, Slowloris timeouts',
          code: `# Accept traffic only from the CDN ranges (generated from the provider's published list)
geo $from_cdn {
    default         0;
    173.245.48.0/20 1;
    103.21.244.0/22 1;
    # ... remaining CDN ranges
}

limit_conn_zone $binary_remote_addr zone=perip:10m;

server {
    listen 443 ssl;
    if ($from_cdn = 0) { return 444; }        # close without response: origin stays hidden

    client_header_timeout 10s;                # Slowloris: slow headers
    client_body_timeout   10s;                # slow bodies
    send_timeout          10s;
    keepalive_timeout     30s;
    client_max_body_size  1m;                 # no giant uploads on API routes
    limit_conn perip 50;                      # per-IP concurrent connections

    location /api/search {
        proxy_read_timeout 3s;                # cap the cost of one expensive request
        proxy_pass http://search_upstream;
    }
}`,
        },
      ],
      diagram: `  botnet (Tbps)
      |
  [ Anycast edge: scrubbing, SYN cookies ]   absorbs L3/L4
      |
  [ WAF + bot mgmt + edge cache ]            L7 signatures, JA4, CAPTCHA
      |   only CDN IPs allowed
  [ Gateway: quotas per key/tenant ]         business limits
      |
  [ Service: load shedding, timeouts ]       protect the DB`,
      keyPoints: [
        'Volumetric attacks are absorbed by anycast edges, never by your origin.',
        'Lock the origin to CDN IPs; a leaked origin IP bypasses the edge.',
        'Find request-cost asymmetry (search, login, export) and cap it.',
        'Autoscaling turns a DDoS into a bill, not a defence.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'security-general-cc-1',
      title: 'Fix the multi-tenant data leak in a pooled Postgres setup',
      context:
        'A B2B invoicing SaaS runs the pool model: one Postgres cluster, tenant_id on every table, RLS enabled. Support tickets report customers occasionally seeing another company\'s invoices under load — never in local testing. The service connects with the migration user because "it already had all the grants".',
      task:
        'Find every way this code can leak data across tenants (or be exploited to do so) and rewrite it so isolation holds even if a developer forgets a WHERE clause.',
      starter: {
        language: 'typescript',
        title: 'tenant.middleware.ts + invoices.repository.ts',
        code: `import { Injectable, NestMiddleware } from '@nestjs/common';
import { Pool } from 'pg';

// Connects as the table owner (the migration user)
export const pool = new Pool({ user: 'invoices_owner', password: process.env.DB_PASS, max: 20 });

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    req.tenantId = req.headers['x-tenant-id'];     // sent by our SPA
    next();
  }
}

@Injectable()
export class InvoicesRepository {
  async findById(tenantId: string, id: string) {
    const client = await pool.connect();
    // RLS policy reads current_setting('app.tenant_id')
    await client.query("SET app.tenant_id = '" + tenantId + "'");
    const { rows } = await client.query('SELECT * FROM invoices WHERE id = $1', [id]);
    client.release();
    return rows[0];
  }

  async list(tenantId: string) {
    const client = await pool.connect();
    const { rows } = await client.query('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 100');
    client.release();                              // forgot to set tenant here
    return rows;
  }
}

// policy in the migration:
// ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
// CREATE POLICY p ON invoices USING (tenant_id::text = current_setting('app.tenant_id'));`,
      },
      hints: [
        'Who is the source of truth for tenantId, and can a client change it?',
        'What happens to a session-level SET when the connection goes back to the pool and the next request (with a different tenant, or none) borrows it?',
        'Does RLS apply to the table owner? What does the policy do when the setting is missing or stale?',
      ],
      solution: {
        language: 'typescript',
        title: 'Tenant context from the verified principal, transaction-scoped, fail-closed',
        code: `import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

// Non-owner role: NOSUPERUSER NOBYPASSRLS, DML grants only (no DDL)
export const pool = new Pool({ user: 'app_rw', max: 20 });

// Populated by the auth guard from the VERIFIED token claim, never from a header
export const tenantCtx = new AsyncLocalStorage<{ tenantId: string }>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const tenantId = tenantCtx.getStore()?.tenantId;
  if (!tenantId || !UUID.test(tenantId)) throw new UnauthorizedException('no tenant context');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // bound parameter (no injection) + is_local=true (reverts at COMMIT/ROLLBACK)
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();                              // always released, even on error
  }
}

@Injectable()
export class InvoicesRepository {
  findById(id: string) {
    return withTenant(async (c) => {
      // belt and braces: explicit filter + RLS underneath
      const { rows } = await c.query(
        'SELECT id, customer, amount_cents, created_at FROM invoices WHERE id = $1 AND tenant_id = current_setting(\\'app.tenant_id\\')::uuid',
        [id],
      );
      return rows[0] ?? null;                      // 404 upstream, same as "not yours"
    });
  }

  list() {
    return withTenant(async (c) =>
      (await c.query('SELECT id, customer, amount_cents, created_at FROM invoices ORDER BY created_at DESC LIMIT 100')).rows,
    );
  }
}

// migration (runs as owner, separately):
// ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
// ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
// CREATE POLICY tenant_isolation ON invoices
//   USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
//   WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
// CREATE ROLE app_rw LOGIN NOSUPERUSER NOBYPASSRLS;`,
      },
      explanation: `**Fixes, in order of severity**

1. **Owner bypasses RLS.** The table owner is exempt from policies unless \`FORCE ROW LEVEL SECURITY\` is set, so \`list()\` returned *every* tenant's rows. The app now connects as \`app_rw\` (\`NOBYPASSRLS\`, DML only) and the table forces RLS.
2. **Pooled session state leak (the "only under load" bug).** \`SET\` is session-scoped; the connection returned to the pool still carried tenant A, so the next borrower — including \`list()\`, which never set anything — ran as tenant A. \`set_config(..., true)\` inside a transaction reverts at COMMIT/ROLLBACK, and it is PgBouncer transaction-mode safe.
3. **Tenant from a client header** = trivial cross-tenant access by editing \`x-tenant-id\`. Tenant now comes from the verified token via \`AsyncLocalStorage\`, set by the auth guard.
4. **SQL injection in SET**: string concatenation of a header value into SQL. Replaced by a bound parameter plus UUID validation.
5. **Fail-closed policy**: \`NULLIF(current_setting(..., true), '')\` makes a missing context match nothing instead of erroring unpredictably or matching; \`WITH CHECK\` stops writing rows into another tenant.
6. **Leaked connections**: \`release()\` was skipped on exceptions, exhausting the pool; now in \`finally\`. \`SELECT *\` replaced by explicit columns, and an explicit \`tenant_id\` predicate is kept as defence in depth (and helps the planner use the composite index).`,
      followUps: [
        {
          "q": "You add PgBouncer in transaction mode in front of Postgres. Does the `withTenant` helper still work, and what would break?",
          "a": "Yes: `set_config(..., true)` is transaction-scoped, and PgBouncer transaction mode pins a server connection for the whole transaction, so the setting and the queries share a connection and it's cleared at COMMIT. What would break is any session-level state: plain `SET`, session advisory locks, `LISTEN/NOTIFY`, and (before PgBouncer 1.21) named prepared statements. Make sure every query that needs tenant context runs inside `withTenant`'s transaction; a query run outside it would land on a random server connection with no setting and return zero rows."
        },
        {
          "q": "How would you prove in CI that no repository method can ever return another tenant's rows?",
          "a": "Write a cross-tenant isolation test suite that runs against a real Postgres with the production migrations and `app_rw`: seed tenants A and B with overlapping data, then, for every repository method (enumerated via reflection or a registry), call it in tenant A's context and assert every returned row has A's tenant_id, and that fetching B's ids by primary key returns null. Add a test calling a repository with no tenant context and expect an exception. Run a catalog check that every table with `tenant_id` has `relforcerowsecurity = true` and a policy."
        }
      ],
    },
    {
      id: 'security-general-cc-2',
      title: 'Harden a "fetch URL preview" endpoint against SSRF',
      context:
        'The product team shipped link previews: users paste a URL, the backend (running on EC2/EKS with an IAM role that can read S3) fetches it and returns the title plus the first bytes of the body. A pentester says they retrieved IAM credentials through it.',
      task:
        'Rewrite the fetcher so it cannot reach internal networks or the metadata service — including via alternate IP encodings, DNS rebinding and redirects — and so it cannot be used as a resource-exhaustion or port-scanning tool.',
      starter: {
        language: 'typescript',
        title: 'preview.service.ts',
        code: `import axios from 'axios';

const BLOCKED = ['localhost', '127.0.0.1', '169.254.169.254', 'metadata.google.internal'];

export async function preview(url: string) {
  if (BLOCKED.some((b) => url.includes(b))) {
    throw new Error('blocked');
  }
  try {
    const res = await axios.get(url, {
      maxRedirects: 10,                  // follow like a browser would
      responseType: 'text',
    });
    const title = /<title>(.*?)<\\/title>/i.exec(res.data)?.[1] ?? null;
    return { title, body: String(res.data).slice(0, 2000), status: res.status };
  } catch (err: any) {
    // helpful for debugging
    return { error: err.message, code: err.code, status: err.response?.status };
  }
}`,
      },
      hints: [
        'List at least four ways to reach 169.254.169.254 without that string appearing in the URL.',
        'Validation must happen on the IP you actually connect to — Node\'s http/https accept a custom lookup function.',
        'Think about what an attacker learns from your error messages, response bodies, timing and unbounded downloads.',
      ],
      solution: {
        language: 'typescript',
        title: 'Connect-time IP validation, manual redirects, bounded and opaque',
        code: `import https from 'node:https';
import dns from 'node:dns';
import ipaddr from 'ipaddr.js';

const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 3000;

function isPublic(ip: string): boolean {
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();  // ::ffff:169.254.169.254 tricks
  }
  return addr.range() === 'unicast';               // rejects private, loopback, linkLocal, CGNAT, ULA...
}

// Runs at CONNECT time for every connection => defeats DNS rebinding (no TOCTOU gap)
function safeLookup(host: string, opts: any, cb: any) {
  dns.lookup(host, { ...opts, all: true }, (err, addrs: dns.LookupAddress[]) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => !isPublic(a.address))) return cb(new Error('blocked destination'));
    return opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
  });
}

function fetchOnce(url: URL): Promise<{ status: number; location?: string; body: string }> {
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) {
    return Promise.reject(new Error('unsupported url'));
  }
  return new Promise((resolve, reject) => {
    const req = https.get(url, { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { 'user-agent': 'PreviewBot/1.0' } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, location: res.headers.location, body: '' }); }
      if (!String(res.headers['content-type']).startsWith('text/html')) { res.destroy(); return reject(new Error('not html')); }
      let size = 0; const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) { res.destroy(); return; }       // stop at 256 KB
        chunks.push(c);
      });
      res.on('close', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

export async function preview(raw: string): Promise<{ title: string | null }> {
  let url = new URL(raw);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const r = await fetchOnce(url);                          // every hop re-validated
      if (r.location) { url = new URL(r.location, url); continue; }
      const title = /<title[^>]*>([^<]{0,300})<\\/title>/i.exec(r.body)?.[1]?.trim() ?? null;
      return { title };                                        // never echo the raw body
    }
    throw new Error('too many redirects');
  } catch {
    return { title: null };                                    // opaque: no port-scan oracle
  }
}`,
      },
      explanation: `**What was wrong and how it is fixed**

1. **String blocklist** is bypassed by \`http://2852039166/\`, \`http://0xA9FEA9FE/\`, \`http://[::ffff:a9fe:a9fe]/\`, \`http://169.254.169.254.nip.io/\` or any attacker DNS name. The fix validates the **resolved IP** against an allowlist of the public unicast range (ipaddr.js), including IPv4-mapped IPv6.
2. **DNS rebinding / TOCTOU**: validating before fetching and then letting the HTTP client resolve again allows a different answer. The custom \`lookup\` runs *for the connection itself*, so the checked IP is the connected IP.
3. **Redirects**: \`maxRedirects: 10\` let a public URL 302 to the metadata service. Redirects are now followed manually (max 3) and every hop goes through the same validation.
4. **Scheme/port/credentials**: only \`https:\` on 443; no \`http://internal:6379\`, no userinfo tricks.
5. **Resource exhaustion**: timeout (3 s), 256 KB cap, HTML only — the endpoint can no longer be used to download gigabytes or hold sockets open.
6. **Information leakage**: raw bodies and error codes (ECONNREFUSED vs timeout) turned the endpoint into an internal port scanner and data exfiltration channel. The response is now just a title, and failures are opaque.
7. **Beyond code** (mention in review): run the fetcher in an isolated pod with an egress NetworkPolicy/proxy, enforce IMDSv2 with hop limit 1, and give it an IAM role with no S3 permissions at all.`,
      followUps: [
        {
          "q": "The fetcher is fixed, but the pod still holds an IAM role that can read S3. How would you architect it so a future bypass still can't reach credentials or internal services?",
          "a": "Isolate at the network and identity layers. Run the fetcher as its own deployment in a dedicated namespace or subnet with an egress NetworkPolicy that denies RFC1918, link-local and the cluster CIDR, allowing only 0.0.0.0/0 on 443 via an egress proxy (Smokescreen-style) that enforces the same IP rules. Give it a service account with no IAM role (IRSA disabled), and enforce IMDSv2 with hop limit 1 so pods can't reach the node's metadata. Even a code bug then only reaches the public internet."
        },
        {
          "q": "How would you test the redirect and DNS-rebinding defences in an automated way?",
          "a": "Use a local test DNS server (e.g. a tiny dns2 or CoreDNS fixture) that returns a public test IP on the first query and 127.0.0.1 on the next, plus a public-looking stub HTTP server that responds `302 Location: http://169.254.169.254/latest/meta-data/`. Point `safeLookup` at the test resolver via dependency injection. Assert that both cases return `{ title: null }` and that a canary server on 127.0.0.1 records zero hits. Also test IPv4-mapped IPv6 literals, decimal and hex IPs, and a 10 MB response to verify the 256 KB cap."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'security-general-iq-01',
      difficulty: 'expert',
      question:
        'We are building a B2B SaaS with 8,000 tenants today, from 3-person startups to two banks. A contract clause says tenants must never, under any circumstances, see each other\'s data. Design the isolation strategy.',
      context: 'The banks also want data residency in the EU and their own encryption keys.',
      whatInterviewerLooksFor: [
        'Knows silo / pool / bridge and picks a tiered mix with reasons (cost vs isolation)',
        'Enforces isolation below the application (RLS, per-tenant keys), not just WHERE clauses',
        'Derives tenant from the verified identity and propagates it through every layer',
        'Covers non-SQL surfaces: cache, search, object storage, queues, logs, analytics',
        'Talks about testing and proving isolation (automated cross-tenant tests, audits)',
      ],
      modelAnswer: `### 1. Tiered isolation model
- **Pool** for the long tail (~7,990 tenants): shared schema, \`tenant_id\` on every row, Postgres **RLS** with \`FORCE ROW LEVEL SECURITY\` and a \`NOBYPASSRLS\` app role. Cheapest per tenant — silo for 8,000 tenants would mean 8,000 databases to migrate and monitor.
- **Silo** for the banks: dedicated DB cluster (or AWS account) in eu-central-1, their own KMS key (BYOK/HYOK via external key store if required), separate backups. A **tenant catalog** maps tenantId → region, cluster, key ARN; the app code is identical, only routing differs.

### 2. Tenant identity end to end
- Tenant comes **only** from the verified token/session claim, placed in \`AsyncLocalStorage\`, and forwarded to downstream services in signed context — never from a header or body.
- DB access goes through a \`withTenant()\` helper that sets \`set_config('app.tenant_id', $1, true)\` inside a transaction (pool-safe). Policies fail closed when the setting is missing.

### 3. Data-plane isolation beyond SQL
- **Cache:** keys prefixed \`t:{tenantId}:\`; no cross-tenant memoisation.
- **Search:** filtered aliases per tenant or index-per-large-tenant; the tenant filter is added by the search client wrapper, not callers.
- **Object storage:** prefix per tenant + IAM condition on the prefix; presigned URLs scoped per object.
- **Queues/events:** tenantId in the envelope; consumers re-establish tenant context before touching data.
- **Encryption:** per-tenant DEKs (envelope encryption), which also enables **crypto-shredding** on offboarding.

### 4. Noisy neighbours
Per-tenant rate limits and connection quotas; promote a heavy pool tenant to its own shard.

### 5. Proving it
- Automated **cross-tenant tests** in CI: create tenants A and B, call every endpoint as A with B's IDs, expect 404.
- DB-level lint: every table has \`tenant_id\` + policy (a migration check fails otherwise).
- Audit logs of tenant context per query, and periodic pentests.

"Never under any circumstances" means defence in depth: app checks **and** RLS **and** per-tenant keys, so a single bug does not become a breach.`,
      followUps: [
        {
          q: 'How do you run a cross-tenant analytics job (e.g. billing aggregates) without breaking RLS?',
          a: 'A separate role with BYPASSRLS used only by a dedicated, audited batch service on a read replica or a warehouse copy — never by the request-serving app. Keep it out of the app\'s credentials and alert on its use.',
        },
        {
          q: 'A pool tenant grows to 30% of total load. What now?',
          a: 'Promote it: logical replication (or dual writes + backfill) of its rows to a dedicated cluster, flip its catalog entry during a short write freeze, verify counts, then delete from the pool. The catalog indirection is what makes this possible.',
        },
        {
          q: 'Does schema-per-tenant give you better isolation than RLS?',
          a: 'Slightly (a query must pick the schema), but a wrong search_path still leaks, and 10K schemas bloat the catalog and make migrations take hours. It is a middle "bridge" option, not a free win.',
        },
      ],
      pitfalls: [
        'Relying only on developers remembering WHERE tenant_id = ?',
        'Reading tenantId from a request header or URL parameter',
        'Forgetting caches, search indices and S3 prefixes',
        'Proposing a database per tenant for 8,000 small tenants without discussing cost',
      ],
    },
    {
      id: 'security-general-iq-02',
      difficulty: 'hard',
      question:
        'At 3 a.m. GitGuardian alerts that an engineer pushed a commit containing the production Stripe secret key and the Postgres admin password to a public GitHub repo 40 minutes ago. Walk me through your response.',
      whatInterviewerLooksFor: [
        'Contain first: revoke/rotate before investigating',
        'Assumes compromise — bots scrape public GitHub within seconds',
        'Investigates the exposure window using provider and DB audit logs',
        'Handles the rotation without taking production down',
        'Follows with root-cause prevention (scanning, push protection, dynamic secrets)',
      ],
      modelAnswer: `### Assume it is already used
Public GitHub is scraped by bots within **seconds to minutes**; 40 minutes means treat both credentials as compromised. Deleting the commit or making the repo private is not remediation (forks, caches, scrapers already have it).

### 1. Contain (first 15 minutes)
- Declare an incident, page the owner of each system, open a timeline doc.
- **Stripe:** roll the key in the dashboard (Stripe lets you set the old key to expire after a short overlap). Deploy the new key from the secrets manager, then expire the old one. Prefer restricted keys.
- **Postgres admin:** create a new password / new admin role, update it in Vault, rotate the app's connections (pool restart), then \`ALTER ROLE ... PASSWORD\` on the old one and **terminate its sessions** (\`pg_terminate_backend\`). Check if the DB was even reachable from the internet — if yes, lock down security groups now.

### 2. Investigate the exposure window (commit time − 5 min → rotation time)
- Stripe: API request logs/events for unknown IPs, new webhooks endpoints, refunds, payouts, or changed bank details.
- Postgres: \`pg_stat_activity\`, connection logs, pgaudit, CloudTrail/VPC flow logs for unfamiliar sources; look for new roles, dumps (large reads), \`COPY TO PROGRAM\`.
- If misuse is found → escalate to a security incident with legal/compliance (breach notification clocks, e.g. GDPR 72 hours).

### 3. Clean up
- Remove the secret from history (git filter-repo / BFG), ask GitHub to purge cached views, invalidate forks if possible — hygiene, not the fix.

### 4. Prevent (the blameless postmortem)
- Pre-commit hooks + CI scanning (gitleaks), **GitHub push protection** org-wide.
- Why did a laptop have the prod admin password? Move to **dynamic, short-lived credentials** (Vault DB engine, IAM auth) and SSO-gated break-glass access, so a leak has a TTL of minutes.
- Measure: time-to-rotate for every critical secret; practise it.`,
      followUps: [
        {
          q: 'Rotating the DB password will break the 40 running pods. How do you avoid an outage?',
          a: 'Dual credentials: create a new role/password first, roll pods to it (rolling deploy or pool refresh from Vault), confirm no sessions use the old role, then revoke it. With dynamic secrets this is routine rather than an emergency.',
        },
        {
          q: 'The repo was private, not public. Does that change anything?',
          a: 'Urgency drops but not the action: everyone with repo access, CI logs, forks and any compromised developer token could read it. Still rotate; secrets in git are permanent and widely replicated.',
        },
      ],
      pitfalls: [
        'Starting by rewriting git history instead of revoking the credentials',
        'Assuming nobody saw it because it was only 40 minutes',
        'Rotating without checking logs for misuse during the window',
        'Blaming the engineer rather than fixing the process that allowed it',
      ],
    },
    {
      id: 'security-general-iq-03',
      difficulty: 'hard',
      question:
        'Our public API is being abused: login traffic went from 200 RPS to 40,000 RPS from ~300K residential IPs, and our search endpoint is being scraped. The DB is at 95% CPU. What do you do now and what do you build next?',
      whatInterviewerLooksFor: [
        'Recognises credential stuffing and scraping as distinct problems',
        'Pushes mitigation to the edge; knows IP-based limits fail against residential proxies',
        'Uses request cost asymmetry (argon2 login, search queries) to prioritise',
        'Protects users (breached-password checks, MFA, lockouts) not just the servers',
        'Adds detection/monitoring and graceful degradation',
      ],
      modelAnswer: `### Diagnosis
40K RPS across ~300K IPs is **credential stuffing** through a residential proxy network: ~0.13 requests per IP per second, so per-IP limits barely trigger. Each login runs argon2 (~50 ms CPU), so this is also a CPU DoS. Scraping is a separate, cheaper-per-request abuse that hurts the DB via search.

### Now (minutes to hours)
- **Edge:** enable the CDN/WAF bot-management rule set in challenge mode for \`/login\` and \`/search\`; block by TLS fingerprint (JA3/JA4) and ASN reputation of proxy providers; managed challenge for anything unverified.
- **Login:** limits keyed by **username/email** (e.g. 5 failures/15 min, then step-up) and by device fingerprint, not just IP; queue/shed login work so it cannot starve other endpoints; return identical responses for unknown user and wrong password.
- **Search:** require auth for deep pagination, cap page size, cache popular queries at the edge, tighter per-key quotas; route search to replicas / the search cluster so the primary survives.
- **Protect accounts:** force resets for accounts with successful logins from the attack pattern; notify users.

### Next (weeks)
- Risk-based authentication: new device + suspicious network → MFA/email challenge; offer passkeys (phishing-resistant, useless to stuffers).
- Check passwords against **breached-password lists** at signup/login.
- Signals pipeline: failed-login ratio per ASN/fingerprint, success rate by hour — alert on anomalies (a normal 5% failure rate jumping to 95% is the signature).
- For scraping: API keys with per-tenant quotas, signed pagination cursors, honeypot records to detect data resale, and legal terms.

### Principle
Make an attacker's request cost more than it costs you: edge challenges and proof-of-work are cheap for you and expensive at 40K RPS.`,
      followUps: [
        {
          q: 'Why not just ban all IPs that fail login more than 10 times?',
          a: 'With 300K IPs each trying a handful of times, almost none hit the threshold; and aggressive IP bans hit users behind CGNAT/corporate NAT. Key limits on the account and the fingerprint, and use IP reputation as one signal.',
        },
        {
          q: 'Should we lower the argon2 cost to survive the load?',
          a: 'No — that weakens stored passwords permanently to solve a temporary load problem. Shed and challenge at the edge instead; a dedicated login pool isolates the CPU cost.',
        },
      ],
      pitfalls: [
        'Treating it as a pure rate-limiting problem keyed on IP',
        'Autoscaling the app tier (the DB and the attacker still win)',
        'Revealing whether an email exists via different error messages',
        'Ignoring the compromised accounts after the traffic stops',
      ],
    },
    {
      id: 'security-general-iq-04',
      difficulty: 'expert',
      question:
        'Design field-level encryption for PII (name, email, SSN) in a system processing 20K writes/s, with GDPR right-to-erasure across 35 days of backups, and the ability to look users up by email.',
      whatInterviewerLooksFor: [
        'Envelope encryption with KMS and correct AEAD usage',
        'Per-user or per-tenant keys for crypto-shredding across backups',
        'Handles KMS latency/quota with DEK caching',
        'Blind index (keyed HMAC) for equality lookups, aware of leakage',
        'Key rotation and access control story',
      ],
      modelAnswer: `### Structure
- **KEK** in KMS (HSM-backed), one per region/tenant tier. Never leaves KMS.
- **DEK per user** (AES-256-GCM), stored wrapped in a \`user_keys\` table: \`{user_id, wrapped_dek, kek_version}\`.
- PII columns hold \`{iv, tag, ciphertext}\`, AAD = \`user_id || column_name\` so ciphertext cannot be swapped between rows or columns.

### Throughput
20K writes/s calling KMS per write = 20K KMS requests/s — at or above many accounts' default quotas and ~$5K/month at $0.03 per 10K. Instead: create the DEK once per user (signup), then **cache unwrapped DEKs** in-process with a short TTL (e.g. 5 min, bounded LRU). With a 95% hit rate KMS sees ~1K req/s. Local AES-GCM costs microseconds.

### Right to erasure
Backups are immutable for 35 days, so deleting rows is not enough. **Crypto-shredding**: delete the user's wrapped DEK (and keep \`user_keys\` in a store with short backup retention, or tombstone-and-purge it). Every copy of that user's PII in every backup becomes undecryptable noise immediately.

### Lookup by email
Ciphertext is randomised, so add a **blind index**: \`email_bidx = HMAC-SHA256(indexKey, lower(trim(email)))\` with a unique index. The index key is itself a secret in KMS/Vault. Trade-off: it reveals equality (two rows with the same email), acceptable for email; do not blind-index low-cardinality fields like gender.

### Rotation & access
- KEK rotation in KMS: old versions still decrypt; re-wrap DEKs lazily in a background job — no bulk data re-encryption.
- IAM: only the user-service role may call \`Decrypt\` with that key; analytics gets tokenized/pseudonymised data. CloudTrail logs every unwrap, so mass-decryption is detectable.
- Never log decrypted values; redact at the logger.

### Costs
Search/sort on encrypted fields is gone, and every read of PII pays a decrypt — so encrypt only the fields that need it.`,
      followUps: [
        {
          q: 'Why AES-GCM and not AES-CBC?',
          a: 'GCM is authenticated (AEAD): tampering is detected and AAD binds context. CBC needs a separate MAC and is prone to padding-oracle bugs. With GCM, never reuse a nonce under one key; with per-user DEKs and random 96-bit nonces you are far below the ~2^32 messages/key limit.',
        },
        {
          q: 'What if the service memory is dumped?',
          a: 'Cached DEKs are exposed for their TTL — that is the trade-off for throughput. Short TTLs, small caches, no core dumps in prod, and CloudTrail anomaly alerts limit the damage; the KEK itself is never exposed.',
        },
      ],
      pitfalls: [
        'Calling KMS Encrypt directly for every record',
        'Believing RDS storage encryption satisfies right-to-erasure or protects from SQL injection',
        'Using deterministic encryption everywhere for searchability without discussing leakage',
      ],
    },
    {
      id: 'security-general-iq-05',
      difficulty: 'hard',
      question:
        'You inherit a 12M-user database where passwords are stored as unsalted MD5. Management wants it fixed this sprint without forcing everyone to reset. How do you migrate, and what parameters do you choose?',
      whatInterviewerLooksFor: [
        'Wraps existing hashes immediately instead of waiting for logins',
        'Chooses argon2id/bcrypt with justified parameters and knows the 72-byte bcrypt issue',
        'Capacity plans login CPU/memory',
        'Handles pepper, rehash-on-login and the hash format/versioning',
      ],
      modelAnswer: `### Why urgency
Unsalted MD5: a GPU does tens of billions of MD5/s and precomputed tables exist; most of these passwords would fall in hours if the table leaked.

### Step 1 — wrap everything now (one batch job)
For every user compute \`argon2id(md5_hash)\` and store it with a version marker \`v1-wrapped\`; delete the MD5 column. This protects **all 12M users immediately**, including dormant ones, without knowing any plaintext.
- Cost: at ~20 ms per hash on one core, 12M hashes ≈ 240K core-seconds ≈ 67 core-hours → a few hours on a 32-core batch fleet.

### Step 2 — upgrade on login
On login with a \`v1-wrapped\` record: verify \`argon2id.verify(stored, md5(password))\`; if it passes, rehash the plaintext directly as \`v2\` = \`argon2id(HMAC(pepper, password))\`. Over months, active users migrate; dormant ones remain wrapped (still safe).

### Parameters
- **argon2id** m = 19 MiB, t = 2, p = 1 (OWASP minimum), tuned to ~50–100 ms on login hosts. If constrained to bcrypt: cost 12, and pre-hash with HMAC-SHA256 → base64 to avoid the **72-byte truncation** and NUL-byte issues.
- **Pepper:** HMAC key in the secrets manager with a version id stored per row.
- Store the full PHC string (\`$argon2id$v=19$m=19456,t=2,p=1$salt$hash\`) so params are self-describing and \`needsRehash\` works.

### Capacity
Peak 500 logins/s × 60 ms ≈ 30 cores; memory 500 × 0.06 s × 19 MiB ≈ 570 MiB in flight. Run login on a dedicated pool with per-account rate limits — hash cost is a DoS amplifier.

### Also
Breached-password check on the next password change, and force resets only for accounts with evidence of compromise.`,
      followUps: [
        {
          q: 'Is argon2id(md5(pw)) weaker than argon2id(pw)?',
          a: 'Marginally — MD5 collisions do not help an attacker guess passwords, and the input still has the full entropy of the password. The slow outer hash is what matters. It is a well-known accepted pattern (used by e.g. Facebook\'s password onion).',
        },
        {
          q: 'Why not just email everyone a reset link?',
          a: 'Huge support cost, users churn, and the reset emails become a phishing vector. Dormant accounts would remain MD5 until they reset — wrapping protects them today.',
        },
      ],
      pitfalls: [
        'Only rehashing on login, leaving dormant users as MD5 indefinitely',
        'Adding a salt to SHA-256 and calling it done',
        'Concatenating a long pepper into bcrypt input (72-byte truncation)',
      ],
    },
    {
      id: 'security-general-iq-06',
      difficulty: 'expert',
      question:
        'Design the authorization system for a Notion/Google-Docs-like product: workspaces, nested pages, sharing with users, groups and "anyone in the org", 50M documents, and a p99 budget of 10 ms per check.',
      whatInterviewerLooksFor: [
        'Explains why RBAC/ACL columns fail and chooses ReBAC',
        'Models relations and inheritance cleanly (Zanzibar-style tuples)',
        'Addresses the new-enemy problem and consistency tokens',
        'Handles list/search filtering, caching and latency',
        'Build vs buy (OpenFGA/SpiceDB) reasoning',
      ],
      modelAnswer: `### Why not RBAC
Permissions are per object, inherited through a page tree, and granted to users, groups and orgs. Roles would explode (\`viewer_page_123\`) and ACL arrays on rows cannot express "viewers of the parent can view the child" without copying ACLs on every share.

### ReBAC model (Zanzibar-style)
Tuples \`object#relation@subject\`:
- \`workspace:acme#member@user:alice\`
- \`group:eng#member@user:bob\`
- \`page:roadmap#parent@page:planning\`
- \`page:planning#viewer@group:eng#member\`

Schema rules: \`editor\` implies \`viewer\`; \`viewer\` of a page includes \`viewer from parent\`; "anyone in org" = \`viewer@workspace:acme#member\`. A Check walks this graph.

### Serving at 10 ms p99
- Use **SpiceDB or OpenFGA** (Zanzibar clones) rather than building; they handle graph evaluation, caching and consistency.
- Tuple count: 50M docs × ~3 tuples ≈ 150M tuples — fine for a Postgres/Spanner/CockroachDB backend.
- Cache sub-problem results (e.g. \`group:eng#member\` membership) with snapshot-based invalidation; limit tree depth; denormalise hot groups.
- Deploy the authz service close to the app (same region), batched checks for a page of results.

### New enemy problem
Alice removes Bob from \`planning\`, then writes secret content. If Bob's check hits a stale snapshot, he sees it. On every content write store the **zookie/ZedToken** returned by the latest ACL write; checks for that content use "at least as fresh as" that token. Most checks can use a slightly stale, cached snapshot for speed.

### Lists and search
"Show pages I can see" cannot be N checks: use \`LookupResources\`/\`ListObjects\` for small sets, or index the principal set (ACL-aware search filtering with a post-filter check) for large ones.

### Operations
Every decision audit-logged; the policy schema versioned in git with tests ("bob cannot view after removal").`,
      followUps: [
        {
          q: 'How do you keep search results consistent with permissions?',
          a: 'Index a denormalised list of principals (user/group ids) per doc for pre-filtering, then post-filter the top N with batched Checks; accept brief staleness in the index but never in the final Check.',
        },
        {
          q: 'How would you add an ABAC rule like "no access to confidential pages from unmanaged devices"?',
          a: 'Layer a contextual condition: OpenFGA conditions / SpiceDB caveats evaluated with request context (device posture), or a separate OPA/Cedar policy applied after the relationship check.',
        },
      ],
      pitfalls: [
        'Storing ACL arrays on every row and copying them on share',
        'Ignoring consistency — "eventually consistent permissions" without addressing revocation',
        'Doing one Check per row for list endpoints',
      ],
    },
    {
      id: 'security-general-iq-07',
      difficulty: 'hard',
      question:
        'Product wants customers to register webhook URLs and an "import from URL" feature. Your service runs on EKS with an IAM role that can write to S3. How do you ship this without creating an SSRF hole?',
      whatInterviewerLooksFor: [
        'Recognises SSRF and the metadata-credentials risk (Capital One)',
        'Knows why blocklists and pre-validation fail (encodings, rebinding, redirects)',
        'Layers network-level egress controls on top of application checks',
        'Least privilege for the fetcher and IMDSv2 hardening',
      ],
      modelAnswer: `### Threat
Both features make our infrastructure send requests to attacker-chosen URLs from inside the VPC. Targets: \`169.254.169.254\` (IAM credentials — the Capital One pattern), internal admin APIs, Redis on 6379, the K8s API, other tenants' services.

### Architecture: isolate the fetcher
- A dedicated **egress-fetcher** service (webhook delivery + imports) in its own namespace/subnet, with a **NetworkPolicy denying all private CIDRs** and egress only via an **egress proxy** (e.g. Smokescreen) that enforces the IP rules centrally.
- Its IAM role has **no** S3/DB permissions; it hands downloaded content to the import service through a queue/presigned upload, so stolen creds are nearly worthless.
- **IMDSv2 required with hop limit 1** on nodes (pods cannot reach metadata), and IRSA/Pod Identity for real workloads.

### Application checks
- Scheme https only, port 443 (webhooks maybe a small allowlist), no userinfo.
- **Resolve and validate at connection time** (custom lookup) — reject private, loopback, link-local, CGNAT, ULA, IPv4-mapped IPv6 — so DNS rebinding cannot swap the IP after validation.
- Redirects: off for webhooks; manual with re-validation (max 3) for imports.
- Timeouts (connect 2 s, total 10 s), size limits, content-type checks.
- Opaque errors to the customer (no "connection refused on port 22" — that is a port scanner).

### Webhook specifics
- Verify ownership at registration (challenge request), sign payloads with HMAC per endpoint, retry with backoff and auto-disable failing endpoints.
- Re-validate DNS on every delivery, not just at registration.

### Monitoring
Alert on proxy denials per tenant, and on any access attempt to metadata IPs — it is almost always an attack.`,
      followUps: [
        {
          q: 'Why is validating the URL once at registration insufficient?',
          a: 'DNS can change later (or per query, via rebinding), and redirects happen at delivery time. The check must run on the actual connection IP for every request.',
        },
        {
          q: 'The import needs to fetch from customers\' private S3 buckets. How?',
          a: 'Do not fetch arbitrary URLs for that: have the customer grant a cross-account role or give a presigned URL, and use the S3 SDK against an allowlisted endpoint rather than a generic HTTP fetch.',
        },
      ],
      pitfalls: [
        'A string blocklist for 169.254.169.254 and localhost',
        'Validating DNS before the request and then letting the client resolve again',
        'Running the fetcher with the main service\'s broad IAM role',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'security-general-boe-1',
      question:
        'You encrypt every order record with envelope encryption. Peak is 15K encrypts/s and 40K decrypts/s. Estimate KMS request rate and monthly cost with and without DEK caching, and decide whether caching is required.',
      assumptions: [
        'Without caching: 1 KMS call (GenerateDataKey or Decrypt) per operation',
        'AWS KMS: $0.03 per 10,000 requests; default shared symmetric quota in many regions ~10K–50K req/s',
        'Average load ≈ 1/3 of peak',
        'With caching: DEK reused per tenant for 5 min; cache hit rate 99%',
      ],
      steps: [
        { label: 'Peak KMS rate (no cache)', calc: '15K + 40K = 55K KMS req/s → exceeds typical quotas → throttling (ThrottlingException) at peak' },
        { label: 'Average rate', calc: '55K ÷ 3 ≈ 18K req/s' },
        { label: 'Monthly requests', calc: '18K × 86,400 × 30 ≈ 4.7 × 10^10 requests' },
        { label: 'Monthly cost (no cache)', calc: '4.7 × 10^10 ÷ 10^4 × $0.03 ≈ $140K / month' },
        { label: 'With 99% cache hit', calc: 'Peak 55K × 1% = 550 req/s; cost ≈ $1.4K / month' },
        { label: 'Latency', calc: 'KMS call ~5–15 ms vs local AES-GCM on a 1 KB record ~1–5 µs' },
      ],
      answer:
        'Without caching ~55K req/s at peak (throttled) and ~$140K/month; with a 5-minute per-tenant DEK cache ~550 req/s and ~$1.4K/month.',
      insight:
        'Envelope encryption must be paired with data-key caching (AWS Encryption SDK caching CMM or an in-process LRU with max age and max-messages limits). The cache TTL is the explicit trade-off between KMS cost/latency and how long a plaintext key lives in memory.',
      followUps: [
        {
          "q": "Security wants plaintext DEKs in memory for at most 30 s instead of 5 min. With 2,000 active tenants and 50 pods each keeping its own cache, what happens to KMS load?",
          "a": "With per-pod caches, KMS calls ≈ active tenants × pods ÷ TTL. At 5 min: 2,000 × 50 ÷ 300 ≈ 333 req/s. At 30 s: 2,000 × 50 ÷ 30 ≈ 3,333 req/s — 10× more, approaching the lower quotas once traffic grows, and around $8.6K/month if sustained (versus under $1K). Fix it with tenant-affinity routing (consistent hashing by tenant so each tenant hits ~2 pods, cutting the multiplier from 50 to 2) or a small shared key-unwrapping service, rather than lengthening the TTL."
        },
        {
          "q": "A deploy restarts all 50 pods at once. What does KMS see, and how do you avoid throttling?",
          "a": "All caches are empty, so every first request per tenant per pod calls KMS: up to 2,000 × 50 = 100,000 calls within seconds, well above a 10K–50K req/s quota, causing `ThrottlingException`s and failed requests. Mitigate by rolling deploys (maxSurge 10–20%) so only a few pods are cold at a time, coalescing concurrent misses for the same tenant (single-flight per DEK), retrying KMS with jittered backoff, and warming the top tenants' DEKs at startup with rate limiting. Request a quota increase as a safety margin."
        }
      ],
    },
    {
      id: 'security-general-boe-2',
      question:
        'Your login endpoint uses argon2id (m = 64 MiB, t = 3, ~80 ms CPU per hash). Normal peak is 1,500 logins/s; during a credential-stuffing attack it hits 25,000/s. How many cores and how much memory do you need, and what does it mean for the design?',
      assumptions: [
        'Each hash occupies one core for 80 ms and 64 MiB for its duration',
        'Target 60% CPU utilisation headroom',
        'Pods have 4 vCPU / 8 GiB',
      ],
      steps: [
        { label: 'Normal CPU', calc: '1,500/s × 0.08 s = 120 core-seconds/s = 120 busy cores ÷ 0.6 ≈ 200 cores' },
        { label: 'Normal memory in flight', calc: '120 concurrent hashes × 64 MiB ≈ 7.5 GiB' },
        { label: 'Pods (normal)', calc: '200 ÷ 4 = 50 pods of 4 vCPU' },
        { label: 'Attack CPU', calc: '25,000 × 0.08 = 2,000 busy cores ÷ 0.6 ≈ 3,300 cores ≈ 830 pods' },
        { label: 'Attack memory', calc: '2,000 × 64 MiB ≈ 125 GiB of hash memory' },
        { label: 'Cost of the lower setting', calc: 'm = 19 MiB, t = 2 (~25 ms) → normal ≈ 38 busy cores (~63 with headroom), 4× cheaper' },
      ],
      answer:
        'About 200 cores and ~8 GiB of hash memory at normal peak; the attack would need ~3,300 cores and ~125 GiB — you cannot scale your way out.',
      insight:
        'Password hashing makes login a CPU/memory amplifier. Choose parameters that meet OWASP minimums but fit your budget, isolate login on its own pool so it cannot starve the rest, and stop attacks before the hash (edge bot challenges, per-account limits) — never by lowering the work factor under pressure.',
      followUps: [
        {
          "q": "Edge bot challenges and per-account limits stop 95% of the 25,000/s attack. How many cores does login need now?",
          "a": "Attack traffic reaching the hash: 25,000 × 5% = 1,250/s, plus 1,500/s of normal logins = 2,750 hashes/s. CPU: 2,750 × 0.08 s = 220 busy cores; at 60% target ≈ 367 cores, about 92 pods of 4 vCPU — roughly 1.8× normal capacity, which autoscaling plus some headroom can handle. Hash memory ≈ 220 × 64 MiB ≈ 14 GiB. The 95% filter turns an impossible 3,300-core requirement into a manageable one, which is why stopping traffic before the hash matters more than hash parameters."
        },
        {
          "q": "Login runs on an isolated pool of 50 pods (200 cores) that won't scale further. During the full 25K/s attack, how many legitimate users get in, and how can you improve that?",
          "a": "Max throughput = 200 cores ÷ 0.08 s = 2,500 hashes/s. With 26,500 attempts/s arriving and admission in random order, only ~9.4% of requests (legit or not) are served, so ~90% of real users fail. Improve with prioritised admission before hashing: requests carrying a valid device cookie from a prior successful login, or from IPs/ASNs with good history, go to a priority queue; unknown traffic is challenged or throttled. Per-account limits stop attackers from repeatedly hashing the same account. Real users then keep most of the 2,500/s."
        }
      ],
    },
    {
      id: 'security-general-boe-3',
      question:
        'An L7 flood of 300K RPS hits /search, which is uncached and costs ~15 ms of DB CPU per request. Your DB primary has 32 vCPUs. How long until it falls over, and what must absorb the attack?',
      assumptions: [
        'Normal search traffic 800 RPS; DB CPU normally 40% utilised',
        'Each attacking request reaches the DB (no cache, no WAF rule yet)',
        'Edge CDN can serve cached responses at effectively unlimited RPS',
      ],
      steps: [
        { label: 'DB capacity', calc: '32 vCPU × 1,000 ms ÷ 15 ms ≈ 2,130 searches/s max' },
        { label: 'Normal usage', calc: '800 × 15 ms = 12 core-seconds/s ≈ 12 of 32 cores (~40%)' },
        { label: 'Attack demand', calc: '300K × 15 ms = 4,500 core-seconds/s ≈ 140× the whole DB' },
        { label: 'Time to failure', calc: 'Immediate: queues fill in seconds; connection pool exhausts, p99 → timeouts' },
        { label: 'Needed block rate', calc: 'To stay under ~2,000/s total, edge must stop > 99.3% of attack traffic (2,000 ÷ 300K ≈ 0.7% may pass)' },
      ],
      answer:
        'The DB can serve ~2,100 searches/s; the flood asks for ~140× that, so it saturates within seconds. More than 99% of the attack must be stopped before the origin.',
      insight:
        'Request-cost asymmetry, not bandwidth, is what takes APIs down. Protect expensive endpoints with edge caching of common queries, WAF/bot challenges, per-key quotas, query timeouts and load shedding, and move search off the primary DB entirely. Scaling the DB is never the answer to a 140× flood.',
      followUps: [
        {
          "q": "You add edge caching for /search with a 60 s TTL. The attackers start randomizing the query string. What now?",
          "a": "Each request becomes a unique cache key, so the hit rate drops to ~0% and all 300K RPS go to origin again. Normalize and limit what reaches the cache key (strip unknown params, lowercase, cap length) and only cache queries that are popular. Mainly, add controls that don't depend on caching: WAF rate rules by IP, ASN, and JA3/JA4 TLS fingerprint, bot challenges for unverified clients, and requiring an authenticated API key or session for search beyond a low anonymous rate. At the origin, load-shed search with a concurrency cap so it can't consume more than ~50% of DB CPU."
        },
        {
          "q": "The attack comes from 100,000 residential IPs. Does a per-IP limit of 10 req/s help?",
          "a": "No — 300,000 RPS ÷ 100,000 IPs = 3 req/s per IP, below the 10 req/s limit, so nothing is blocked. Per-IP limits only stop concentrated sources. Use signals that aggregate across IPs: TLS/HTTP fingerprints shared by the botnet, missing or invalid session cookies, behavioural patterns (no page loads before search), and a global limit on anonymous search (e.g. 1,500 RPS total, with challenges beyond that). Since the DB can only serve ~2,100 searches/s, an overall concurrency cap at the origin is the last line that keeps the primary alive."
        }
      ],
    },
  ],
  test: [
    {
      id: 'security-general-mcq-01',
      difficulty: 'expert',
      question:
        'This helper runs on a pg Pool of 20 connections. Under load, tenant B occasionally receives tenant A\'s invoices, but never in single-user tests. What is the root cause?',
      code: {
        language: 'typescript',
        code: `async function query(tenantId: string, sql: string, params: unknown[]) {
  const c = await pool.connect();
  try {
    await c.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
    return (await c.query(sql, params)).rows;
  } finally {
    c.release();
  }
}
// elsewhere, a background job:
// const c = await pool.connect(); await c.query('SELECT * FROM invoices'); c.release();`,
      },
      options: [
        'set_config(..., false) is session-scoped, so a pooled connection keeps the previous tenant for any caller that does not set it (like the background job)',
        'set_config with a bound parameter is not honoured by RLS; the policy only sees values from a literal SET statement',
        'RLS policies are cached per connection at first use, so the connection keeps the first tenant it ever served',
        'The two queries in the helper run on different connections of the pool, so the SELECT does not see the setting',
      ],
      correct: [0],
      explanation:
        'is_local = false makes the setting last for the whole session, and pooled sessions outlive requests, so any borrower that skips set_config (the background job) runs as whichever tenant used the connection last. Use is_local = true inside BEGIN/COMMIT (SET LOCAL). Bound parameters work fine with set_config, policies are evaluated per query, and a PoolClient pins both queries to one connection.',
      followUps: [
        {
          "q": "You move to `set_config(..., true)` inside a transaction. Now the background job that never sets a tenant runs a query. What should happen, and how do you make the policy enforce it?",
          "a": "It should see zero rows (fail closed), not whatever tenant last used the connection — and with is_local = true, the setting has reverted to empty after the previous COMMIT. Make the policy explicit about the missing case: `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`, which compares to NULL and matches nothing. Jobs that legitimately work across tenants should iterate tenants and set each one, or connect as a separate audited role with an explicit cross-tenant policy, never by relying on an unset variable."
        },
        {
          "q": "How would you write an automated test that reproduces this leak deterministically, since it never appears in single-user tests?",
          "a": "Force connection reuse: create a pool with `max: 1`, run a request as tenant A, then run the background job's code path (no tenant set) on the same pool and assert it returns zero of A's rows. Repeat with tenant B to assert no A rows appear. Add a concurrency test that fires a few hundred interleaved requests for two tenants against a pool of 2–3 connections and asserts every returned row's tenant_id matches the caller. Run against real Postgres (Testcontainers) with the app's non-owner role, since mocks hide RLS behaviour."
        }
      ],
    },
    {
      id: 'security-general-mcq-02',
      difficulty: 'hard',
      question:
        'After this migration, the app (connecting as invoices_owner, the role that ran it) still sees every tenant\'s rows even with app.tenant_id correctly set. Why?',
      code: {
        language: 'sql',
        code: `ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- app connects as invoices_owner (NOSUPERUSER)`,
      },
      options: [
        'The policy needs a WITH CHECK clause before USING is enforced on reads',
        'current_setting with missing_ok = true disables the policy when the setting exists',
        'Table owners are exempt from RLS unless FORCE ROW LEVEL SECURITY is set (and superusers/BYPASSRLS roles always bypass it)',
        'RLS only applies to roles created after the policy, so existing roles are grandfathered',
      ],
      correct: [2],
      explanation:
        'Postgres does not apply row security to the table owner by default; you need ALTER TABLE ... FORCE ROW LEVEL SECURITY, and the app should use a separate non-owner NOBYPASSRLS role anyway. WITH CHECK governs writes, not whether USING applies to reads. missing_ok only affects the unset case, and roles are not grandfathered.',
      followUps: [
        {
          "q": "Your migrations run as the owner and the app as `app_rw`. A new table is added next sprint and the developer forgets to enable RLS on it. How do you catch that automatically?",
          "a": "Add a CI check (and a startup assertion) that queries the catalog: `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)` and fails if any table with a `tenant_id` column is listed, or lacks a policy in `pg_policies`. Combine it with a cross-tenant integration test that seeds two tenants and asserts each repository method returns only the caller's rows. Schema linting turns a forgotten line into a failed build."
        },
        {
          "q": "An analyst needs a reporting role that reads all tenants. How do you grant that without weakening the app's isolation?",
          "a": "Create a separate role (e.g. `reporting_ro`) with SELECT only, used by a separate service or tool, never by the app's connection pool. Either give it `BYPASSRLS` explicitly or, better, add a policy `FOR SELECT TO reporting_ro USING (true)` so the exception is visible in `pg_policies`. Prefer running it against a read replica or analytics copy with PII masked. Log and audit its usage, and require credentials from a secrets manager with short-lived access. The app role stays NOBYPASSRLS, so a bug in the app can never inherit cross-tenant reach."
        }
      ],
    },
    {
      id: 'security-general-mcq-03',
      difficulty: 'expert',
      question:
        'You use envelope encryption: a KMS KEK wraps per-tenant DEKs stored next to the data. Security suspects one service instance\'s memory (including cached plaintext DEKs for 12 tenants) was dumped, but KMS itself is not compromised. What is the correct remediation?',
      options: [
        'Rotate the KMS KEK; automatic rotation re-encrypts all ciphertext under the new key version',
        'Generate new DEKs for the 12 affected tenants and re-encrypt their data with them; rotating the KEK alone does not help because the attacker already holds plaintext DEKs',
        'Nothing is needed: without the KEK the attacker cannot use the DEKs',
        'Delete the KEK to crypto-shred everything, then restore from backups',
      ],
      correct: [1],
      explanation:
        'A plaintext DEK decrypts its data directly; re-wrapping it under a new KEK changes nothing, so the affected tenants need new DEKs and their data re-encrypted (and revoked access for the compromised instance). KMS rotation never re-encrypts your ciphertext — it only changes which key version wraps new DEKs. Deleting the KEK destroys every tenant\'s data, including the backups you would restore from.',
      followUps: [
        {
          "q": "The 12 tenants hold 4 TB of data in total. How do you re-encrypt it under new DEKs without downtime?",
          "a": "Generate a new DEK version per tenant and record a key-version id with every ciphertext (envelope header). Immediately start encrypting new writes with the new DEK. Run a background re-encryption job that reads each record, decrypts with the old DEK and writes with the new one, idempotently and with checkpoints; reads handle both versions via the key-version id. Throttle it so production I/O isn't hurt (4 TB at ~100 MB/s ≈ 11 hours). When the job reports zero records on the old version, destroy the old DEKs. Also re-key backups or keep them in their retention window under tighter access."
        },
        {
          "q": "How would you reduce the blast radius of a memory dump next time?",
          "a": "Shrink how many plaintext DEKs live in memory and for how long: cache DEKs with a short max age (e.g. 5 min) and a max-messages limit, scope instances to fewer tenants (tenant-affinity routing so each pod caches a handful, not all), and zero buffers on eviction where the runtime allows. Use per-record or per-object DEKs for the most sensitive data so one leaked key exposes less. Run decryption in a separate small service or enclave (Nitro Enclaves) so the main app never holds plaintext keys. Restrict core dumps and debug endpoints."
        }
      ],
    },
    {
      id: 'security-general-mcq-04',
      difficulty: 'hard',
      question:
        'A team adds a pepper to bcrypt like this. PEPPER is a 64-character hex string. What is the security consequence?',
      code: {
        language: 'typescript',
        code: `import bcrypt from 'bcrypt';
const PEPPER = process.env.PEPPER!; // 64 hex chars from Vault

export const hash = (pw: string) => bcrypt.hash(PEPPER + pw, 12);
export const verify = (pw: string, h: string) => bcrypt.compare(PEPPER + pw, h);`,
      },
      options: [
        'None — cost 12 plus a secret pepper is best practice',
        'bcrypt rejects inputs over 72 bytes, so every login throws and nobody can sign in',
        'The pepper makes rainbow tables possible because it is identical for every user',
        'bcrypt only uses the first 72 bytes, so only the first 8 bytes of each password matter: "password1" and "password1234" verify as the same',
      ],
      correct: [3],
      explanation:
        'bcrypt silently truncates input at 72 bytes; 64 bytes of pepper leaves only 8 bytes of password, collapsing entropy and making long passwords equivalent to their prefix. The fix is HMAC(pepper, password) encoded as base64 before bcrypt, or argon2id. Most implementations truncate rather than throw, and per-user salts still prevent rainbow tables.',
      followUps: [
        {
          "q": "You fix it with `bcrypt(base64(HMAC-SHA256(pepper, password)))`. A year later the pepper must be rotated. How do you do it without forcing every user to reset?",
          "a": "Store a pepper version alongside each hash (e.g. `$p2$` prefix or a column). New hashes use pepper v2. At login, verify with the version recorded for that user; on success, rehash the plaintext with v2 and update the row. Keep v1 in the secrets manager until most active users have migrated (say 90 days); because bcrypt is one-way you cannot re-pepper hashes offline, so for dormant users either keep v1 available longer or, after the window, force a reset for only those accounts. Same mechanism handles bcrypt cost increases."
        },
        {
          "q": "Where should the pepper live, and what does it actually protect against?",
          "a": "Not in the database — the pepper is useful only if a database leak (SQL injection, stolen backup) doesn't include it. Store it in a secrets manager or HSM/KMS and load it at startup, or compute the HMAC inside KMS so the app never holds it. It protects against offline cracking of a leaked hash table: without the pepper, guesses can't even be tested. It doesn't help if the app server itself is compromised, since the attacker reads the pepper from memory. Salts stay per-user; the pepper is one secret for all."
        }
      ],
    },
    {
      id: 'security-general-mcq-05',
      difficulty: 'medium',
      question:
        'A startup stores passwords as SHA-256(salt + password) with a unique 16-byte salt per user. An auditor flags it as high risk. Why is the auditor right?',
      options: [
        'Salts must be secret; storing them next to the hash defeats their purpose',
        'SHA-256 is fast (billions of guesses/s per GPU), so leaked hashes are cheap to brute-force with dictionaries despite salting',
        'SHA-256 has practical collision attacks, so attackers can forge a password that matches',
        '16 bytes of salt is too short; salts should be at least as long as the hash output',
      ],
      correct: [1],
      explanation:
        'Salts stop precomputation and identical-hash detection but do nothing about raw guessing speed; a GPU tries ~10^10 SHA-256/s, so common passwords fall quickly. Password hashing needs a slow, memory-hard KDF such as argon2id. Salts are not meant to be secret (that is a pepper), SHA-256 has no practical collisions, and 16 bytes is the recommended salt size.',
      followUps: [
        {
          "q": "Management asks you to quantify the risk: 2M users, and the hash table leaks. Roughly how many accounts fall in a day to one 8-GPU rig with SHA-256 versus argon2id?",
          "a": "At ~10^10 SHA-256/s per GPU, 8 GPUs do ~8×10^10 guesses/s. Since salts are unique, the attacker attacks each user separately: a 10^9-word dictionary + rules takes ~0.0125s per user, so all 2M users take ~7 hours — every weak password falls within a day (typically 30–60% of users). With argon2id at 64 MiB, a GPU manages maybe ~10–100 guesses/s due to memory bandwidth; testing even the top 10,000 passwords across 2M users is 2×10^10 hashes, years of work. The KDF changes cracking from hours to infeasible."
        },
        {
          "q": "How do you migrate the existing SHA-256 hashes without waiting for every user to log in?",
          "a": "Wrap them now: compute `argon2id(existing_sha256_hash)` for every row in a batch job and store it with a marker (`algo = 'argon2(sha256)'`). Login then computes `argon2id(SHA-256(salt + password))` for wrapped rows. Every account is protected immediately, even dormant ones. On a successful login, rehash the plaintext directly with argon2id and change the marker so the legacy layer disappears over time. Delete the raw SHA-256 values from the DB and backups' retention as they roll off."
        }
      ],
    },
    {
      id: 'security-general-mcq-06',
      difficulty: 'expert',
      question:
        'You are reviewing SSRF defences for a server-side "fetch this URL" feature on AWS. Select ALL that are effective against a determined attacker.',
      options: [
        'Validating the IP returned by DNS inside the HTTP client\'s connection lookup hook, rejecting private, loopback and link-local ranges',
        'Rejecting URLs whose hostname string equals "169.254.169.254" or "localhost"',
        'Requiring IMDSv2 with a PUT response hop limit of 1 on the instances',
        'Disabling automatic redirect following, or re-validating every redirect hop',
        'Resolving the hostname once at submission time and storing that it was public',
      ],
      correct: [0, 2, 3],
      explanation:
        'Connect-time IP validation defeats alternate encodings and DNS rebinding, IMDSv2 with hop limit 1 blocks simple GET-based metadata theft from containers, and redirect control closes the "public URL 302s to internal" bypass. String blocklists lose to decimal/hex/IPv6-mapped forms and custom DNS names, and a one-time resolution check is exactly what DNS rebinding and later DNS changes exploit.',
      followUps: [
        {
          "q": "Your preview feature must also support customers' webhook URLs that legitimately point to their own on-prem servers via a VPN. How do you allow that without reopening SSRF?",
          "a": "Don't loosen the general fetcher. Make private destinations an explicit, per-tenant allowlist: the customer registers specific hostnames/CIDRs, ownership is verified (e.g. a challenge token served at that endpoint), and requests go through a dedicated egress proxy or connector that only routes into that tenant's VPN attachment. Cloud metadata, link-local and your own VPC ranges stay blocked at the network layer (egress NetworkPolicy, security groups), regardless of the allowlist. Log every request with tenant id for audit."
        },
        {
          "q": "How would you continuously test that the SSRF defences still hold after future refactors?",
          "a": "Keep an SSRF regression suite in CI that runs the real fetcher against a list of payloads: decimal/hex/octal IPs (`2852039166`, `0xA9FEA9FE`), IPv6-mapped (`[::ffff:169.254.169.254]`), DNS names resolving to 127.0.0.1 (`localtest.me`), a test DNS server that rebinds after the first answer, and a public stub that 302-redirects to an internal address. Assert each is blocked and that error output is generic. In staging, a canary internal endpoint that alerts if it ever receives a request from the preview service catches regressions in production configuration."
        }
      ],
    },
    {
      id: 'security-general-mcq-07',
      difficulty: 'hard',
      question:
        'The session cookie is set with SameSite=Lax, HttpOnly and Secure. Which endpoint is still exploitable by CSRF from evil.com?',
      code: {
        language: 'typescript',
        code: `@Controller('account')
export class AccountController {
  @Post('email')          // JSON body, cookie auth
  changeEmail(@Req() req, @Body() dto: EmailDto) { /* ... */ }

  @Get('delete')          // linked from the settings page
  deleteAccount(@Req() req) { return this.svc.delete(req.user.id); }

  @Put('avatar')          // multipart, cookie auth
  setAvatar(@Req() req) { /* ... */ }
}`,
      },
      options: [
        'POST /account/email, because JSON bodies bypass SameSite checks',
        'PUT /account/avatar, because multipart forms are always sent with cookies',
        'GET /account/delete, because Lax cookies are still sent on top-level cross-site GET navigations (a link or window.location)',
        'None of them, because HttpOnly prevents cross-site requests from carrying the cookie',
      ],
      correct: [2],
      explanation:
        'SameSite=Lax withholds cookies on cross-site subresource and non-GET requests but sends them on top-level GET navigations, so a link or redirect to /account/delete deletes the account. State must never change on GET. The POST and PUT are protected by Lax (though an anti-CSRF token is still recommended), and HttpOnly only blocks JavaScript reads, not sending.',
      followUps: [
        {
          "q": "You change delete to POST. A teammate says that with SameSite=Lax, an anti-CSRF token is now unnecessary. When is he wrong?",
          "a": "SameSite treats all subdomains of the same registrable domain as same-site. If any subdomain (e.g. `blog.example.com` or a user-content host under the same eTLD+1) has an XSS or is attacker-controlled, it can send a same-site POST with cookies, and SameSite doesn't stop it. Older browsers and some embedded webviews don't enforce SameSite. Also, Chrome's \"Lax by default\" briefly allowed top-level cross-site POSTs within 2 minutes of cookie creation. A synchronizer token or a required custom header (`X-CSRF-Token`, which forces a CORS preflight) closes these gaps."
        },
        {
          "q": "Your SPA calls the API on api.example.com from app.example.com with fetch and credentials. Which cookie and CORS settings do you need, and what must you not do?",
          "a": "These are same-site (same eTLD+1), so `SameSite=Lax` cookies are sent; scope the cookie with `Domain=api.example.com` or omit Domain. CORS must return `Access-Control-Allow-Origin: https://app.example.com` (exact origin, never `*` or reflecting arbitrary Origin headers) and `Access-Control-Allow-Credentials: true`, and the fetch uses `credentials: 'include'`. Don't reflect the Origin header without an allowlist — that lets any site read authenticated responses, which is worse than CSRF since it also leaks data."
        }
      ],
    },
    {
      id: 'security-general-mcq-08',
      difficulty: 'hard',
      question:
        'A React app renders user comments written in markdown. It converts markdown to HTML on the server and renders it with dangerouslySetInnerHTML. A stored XSS is found. Which fix is the most robust?',
      options: [
        'Strip "<script>" tags from comments before saving them',
        'Sanitize the generated HTML with an allowlist sanitizer (e.g. DOMPurify) at render time, and add a nonce-based CSP so any injected inline script is blocked',
        'Store the session token in localStorage instead of a cookie so XSS cannot use it',
        'Validate that comments contain only printable ASCII characters',
      ],
      correct: [1],
      explanation:
        'Allowlist sanitization of the final HTML handles event-handler attributes, javascript: URLs and SVG payloads, while a strict CSP is a second layer if sanitization misses something. Stripping script tags misses onerror= and similar vectors; localStorage makes token theft by XSS easier, not harder; and ASCII-only input still allows HTML attributes and javascript: links.',
      followUps: [
        {
          "q": "You add a CSP with nonces. The marketing team's analytics tag and an old inline `onclick` handler break. How do you roll CSP out safely?",
          "a": "Deploy it first as `Content-Security-Policy-Report-Only` with a `report-to` endpoint, and collect violations for a week or two. Fix the reports: move inline handlers into script files with `addEventListener`, add the nonce to legitimate inline scripts, and use `'strict-dynamic'` so scripts loaded by nonced scripts (like a tag manager loader) are trusted without listing every domain. Then switch to enforcing mode, keep reporting on, and alert on spikes in violations, which also reveal attempted injections."
        },
        {
          "q": "The sanitizer runs on render in the browser. A mobile app and an email digest also render the same comments. Where should sanitization happen now?",
          "a": "Sanitize for each output context, since what's safe differs: HTML for web, plain text for push notifications, and email HTML with a stricter allowlist (no forms, no external scripts, rewritten links). A common approach: store the original markdown, render and sanitize server-side with an allowlist sanitizer (DOMPurify on jsdom or a Go/Java equivalent) into a cached sanitized HTML version keyed by sanitizer version, and still sanitize on the web client as defence in depth. When the sanitizer is upgraded for a bypass, bump the version so cached HTML is regenerated."
        }
      ],
    },
    {
      id: 'security-general-mcq-09',
      difficulty: 'expert',
      question:
        'An AWS access key with S3 and DynamoDB write permissions was pushed to a public repo 20 minutes ago. Select ALL actions that belong in the first hour.',
      options: [
        'Deactivate the key and issue a replacement via the secrets manager, rolling consumers to it',
        'Force-push to remove the commit, then consider the incident closed since the window was short',
        'Review CloudTrail for the key\'s activity from the commit time onward (new IAM users/keys, unusual regions, large S3 reads)',
        'Check for persistence the attacker may have created, such as new IAM users, access keys, roles or Lambda functions',
        'Wait for the key\'s next scheduled 90-day rotation to avoid disrupting production',
      ],
      correct: [0, 2, 3],
      explanation:
        'Public GitHub is scanned by bots within minutes, so you revoke first, investigate the exposure window in CloudTrail, and hunt for persistence (attackers commonly create new keys or users so revoking the original is not enough). Removing the commit is hygiene, not remediation, since clones and scrapers already have it; waiting for scheduled rotation leaves a known-compromised key live.',
      followUps: [
        {
          "q": "CloudTrail shows the key was used from an unknown IP to call `ListBuckets` and `GetObject` on a bucket with customer PII. What changes in your response?",
          "a": "This is now a confirmed data breach, not just a credential leak. Scope it precisely: use CloudTrail data events (or S3 server access logs) to list every object read and bytes transferred, and map them to affected customers. Involve legal and privacy immediately, since GDPR requires notifying the regulator within 72 hours of becoming aware. Preserve evidence (snapshot logs to a locked bucket). Check for exfiltration paths like new bucket policies or replication rules. Then prepare customer notifications from the scoped list."
        },
        {
          "q": "How do you make this class of incident much less likely next quarter?",
          "a": "Remove long-lived keys: use IAM roles (IRSA on EKS, OIDC for CI like GitHub Actions) so there's nothing to commit. Add pre-commit and server-side secret scanning (gitleaks, GitHub push protection) that blocks pushes containing key patterns. Scope permissions so a single credential can't write to both S3 and DynamoDB across environments. Enable GuardDuty to flag anomalous credential use, and have a runbook with a one-click revoke script. Measure mean time to revoke from alert in drills."
        }
      ],
    },
    {
      id: 'security-general-mcq-10',
      difficulty: 'expert',
      question:
        'In a Zanzibar-style authorization service backed by replicas, Alice removes Bob from a folder\'s viewers and immediately uploads a confidential doc into it. Bob can briefly see the doc. What is the canonical fix?',
      options: [
        'Make every Check read from the leader with full linearizable consistency',
        'Cache negative results longer than positive results',
        'Store the consistency token (zookie) returned by the ACL/content write with the doc and evaluate checks on that doc at a snapshot at least as fresh as that token',
        'Copy the folder ACL onto the doc at upload time so the check does not traverse the parent',
      ],
      correct: [2],
      explanation:
        'This is the "new enemy" problem; Zanzibar solves it with zookies so checks on new content are evaluated at a snapshot no older than the content write, while other checks can still use fast, slightly stale snapshots. Forcing every check to the leader works but destroys latency and scale. Negative caching does not affect a stale positive, and copying ACLs at upload still reads a stale ACL and breaks later inheritance.',
      followUps: [
        {
          "q": "How does the system know which zookie to use when Bob opens the doc a minute later, and what happens if the zookie is very old?",
          "a": "The zookie returned by the doc's content write is stored with the doc (e.g. as a column in its metadata). Any check on that doc passes it, and the authorization service evaluates at a snapshot at least as fresh — it may pick any newer snapshot, typically a recent one that is already replicated, so cost stays low. An old zookie is no problem: it is a lower bound, and the service uses a fresher snapshot anyway. When an ACL changes later, the doc's stored zookie is updated on the next content write, but ACL-change semantics still need the at-least-as-fresh rule."
        },
        {
          "q": "Your service is built on Postgres read replicas, not Spanner. How can you approximate zookies?",
          "a": "Use the primary's WAL position as the token: after the ACL or content write commits, read `pg_current_wal_lsn()` and store it with the doc. At check time, a replica can serve the check only if `pg_last_wal_replay_lsn()` is ≥ the stored LSN; otherwise wait briefly (a few ms) or fall back to the primary. That gives \"at least as fresh as this write\" semantics. Most checks without a token use any replica. Lag monitoring tells you how often the fallback happens."
        }
      ],
    },
    {
      id: 'security-general-mcq-11',
      difficulty: 'medium',
      question:
        'Your SaaS has 6,000 SMB tenants on a shared pooled database. A large bank signs, requiring EU residency, its own encryption key and guaranteed performance isolation. What is the most sensible approach?',
      options: [
        'Move all 6,000 tenants to database-per-tenant so every customer gets the same isolation',
        'Keep the bank in the pool but add a stricter RLS policy for its rows',
        'Create a schema for the bank in the shared database with its own search_path',
        'Add a silo tier: a dedicated EU database (with the bank\'s KMS key) routed via a tenant catalog, leaving SMBs pooled',
      ],
      correct: [3],
      explanation:
        'A tiered/bridge approach gives the bank residency, key control and no noisy neighbours without multiplying operational cost for thousands of small tenants. Moving all tenants to silo is costly overkill, stricter RLS does not deliver residency or performance isolation, and a schema in the shared database still shares hardware, region and keys.',
      followUps: [
        {
          "q": "The bank also demands that the vendor can never read their data and that they can revoke access instantly. How does key management change?",
          "a": "Use customer-managed keys (BYOK/HYOK): the bank's KMS key in their own AWS account, with a key policy granting your service role only `Encrypt/Decrypt/GenerateDataKey`. Your data-plane DEKs are wrapped by that key. Revocation: the bank disables the key or removes the grant; after your DEK cache TTL (e.g. 5 min) expires, their data becomes unreadable everywhere, including backups. Be explicit about limits: your running service still sees plaintext while processing, so \"never read\" needs operational controls (just-in-time access, audit logging shared with the bank)."
        },
        {
          "q": "How does your tenant catalog route requests to the silo, and what happens if the catalog is down?",
          "a": "The catalog maps tenant id → deployment cell (region, DB cluster, KMS key ARN). The gateway resolves it after authentication and routes to the right cell; services get the connection info from a local cache. Make it highly available and cached aggressively: tenant placement rarely changes, so each gateway keeps an in-memory copy refreshed every minute, with a pushed invalidation on moves. If the catalog is down, the cached map keeps traffic flowing; only new tenants or migrations wait. A fallback to the pool for unknown tenants would breach the bank's residency, so fail closed."
        }
      ],
    },
    {
      id: 'security-general-mcq-12',
      difficulty: 'expert',
      question:
        'A developer "fixed" SQL injection in the sort feature by parameterizing it. What does this query do when called with sort = "amount_cents"?',
      code: {
        language: 'typescript',
        code: `const { rows } = await pool.query(
  'SELECT id, amount_cents FROM invoices WHERE tenant_id = $1 ORDER BY $2 DESC LIMIT 50',
  [tenantId, req.query.sort],
);`,
      },
      options: [
        'Sorts by amount_cents descending, safely',
        'Throws a syntax error because identifiers cannot be bound',
        'Returns rows in effectively unspecified order: $2 is bound as a constant string value, so every row has the same sort key',
        'Is still injectable, because parameters inside ORDER BY are interpolated textually',
      ],
      correct: [2],
      explanation:
        'Bind parameters are values, not identifiers; ORDER BY with a constant expression sorts every row by the same literal, so the order is arbitrary (Postgres does not error for a parameter here). It is not injectable, but it is broken — identifiers must be mapped through an allowlist. Parameters are never textually interpolated by the server.',
      followUps: [
        {
          "q": "Users can also sort by multiple columns and direction, e.g. `sort=amount_cents:desc,created_at:asc`. Write the safe approach.",
          "a": "Parse the parameter into pairs, look up each column in an allowlist map from public name to SQL identifier (`{ amount: 'amount_cents', created: 'created_at' }`), and map direction strictly (`desc` → `DESC`, anything else → `ASC`). Cap the number of sort keys (e.g. 3) and always append a unique tiebreaker (`id`). Build the clause from these trusted constants: `ORDER BY amount_cents DESC, created_at ASC, id ASC`. Unknown fields return 400 rather than being ignored. Libraries like `pg-format`'s `%I` quote identifiers, but an allowlist is still required to stop sorting by sensitive columns."
        },
        {
          "q": "Why is it still worth allowlisting even if you use proper identifier quoting like `%I`?",
          "a": "Quoting prevents injection but not abuse. Without an allowlist, a user can sort by any column in the table, including ones they can't see (`password_reset_token`, `internal_risk_score`), and infer values by observing order — a classic side-channel (\"sort by salary\" reveals ranking). They can also sort by unindexed columns on big tables, causing full scans and filesorts that degrade the DB. An allowlist limits sorting to indexed, exposed fields and keeps query plans predictable."
        }
      ],
    },
    {
      id: 'security-general-mcq-13',
      difficulty: 'medium',
      question:
        'A 400 Gbps UDP reflection attack targets your API, whose origin sits behind a 10 Gbps cloud load balancer. Which response actually helps?',
      options: [
        'Put the API behind an anycast CDN/DDoS scrubbing provider and restrict the origin to accept only the provider\'s IP ranges',
        'Increase the HPA max replicas from 50 to 500 so the pods can absorb the traffic',
        'Lower nginx client_body_timeout and add per-IP limit_req rules on the pods',
        'Enable SYN cookies on the application servers',
      ],
      correct: [0],
      explanation:
        'Volumetric L3/L4 floods saturate the network links long before packets reach pods, so they must be absorbed by an edge with far more capacity, and a hidden origin prevents attackers from going around it. More pods, nginx timeouts and rate limits act on traffic that never arrives intact; SYN cookies address TCP SYN floods, not UDP reflection.',
      followUps: [
        {
          "q": "The attackers find your origin IP from an old DNS record and hit it directly, bypassing the scrubbing provider. What do you do?",
          "a": "Change the origin IP (new load balancer or Elastic IP) since the old one is burned, and make the origin unreachable except through the provider: security groups / firewall allowing only the provider's published IP ranges, plus authenticated origin pulls (mTLS client certificate from the CDN, or a secret header verified at the LB). Better still, use a private connection such as Cloudflare Tunnel or AWS CloudFront with an origin in a private subnet via VPC origins. Purge historical DNS exposure: don't publish the origin on any subdomain, MX or old record."
        },
        {
          "q": "The provider absorbs the 400 Gbps, but your 10 Gbps link still saturates during the attack. How is that possible?",
          "a": "The provider is forwarding attack traffic it considers legitimate. Usual causes: the attack moved to L7 (valid HTTPS requests that pass L3/L4 scrubbing), or the CDN isn't caching, so every request becomes an origin fetch. Inspect origin traffic by path, user agent and source PoP. Fix by caching where possible, enabling WAF rate rules or bot challenges on the abused paths, and setting origin shielding (a single tier pulls from origin). Large uncacheable responses (exports, downloads) are also amplification targets — require authentication and rate-limit them."
        }
      ],
    },
    {
      id: 'security-general-mcq-14',
      difficulty: 'hard',
      question:
        'Select ALL signals that your authorization model has outgrown plain RBAC.',
      options: [
        'You are creating roles like editor_project_812 and viewer_folder_77 to model per-resource access',
        'Access must depend on context such as the user\'s region, device posture or data classification',
        'You have three roles (admin, member, billing) and 40 endpoints',
        'Documents inherit sharing from parent folders and can be shared with groups nested in other groups',
        'Your JWTs are getting large because they contain the role list',
      ],
      correct: [0, 1, 3],
      explanation:
        'Per-resource roles are role explosion (move to ReBAC or resource-scoped grants), contextual rules call for ABAC policies, and inheritance plus nested groups is a relationship graph (ReBAC). Three roles across 40 endpoints is exactly what RBAC is good at, and large JWTs are a token-design issue solved by referencing roles or using opaque tokens, not a model change.',
      followUps: [
        {
          "q": "You decide to move from per-resource roles to ReBAC. How do you migrate the existing `editor_project_812` roles without a big-bang cutover?",
          "a": "Translate each per-resource role into relation tuples (`project:812#editor@user:alice`) with a backfill job, and run the new authorization service in shadow mode: every request is checked by both systems, the old decision is enforced, and mismatches are logged with full context. Fix mapping bugs until the mismatch rate is ~0 for a couple of weeks, then flip enforcement per endpoint or per tenant behind a flag. Keep dual-writes from the sharing UI to both systems during the transition, and retire the old roles last."
        },
        {
          "q": "An ABAC rule says \"EU data only from EU-region devices\". Where do you evaluate it, and how do you keep it fast?",
          "a": "Evaluate it in a policy engine (OPA/Rego, Cedar) at the API gateway or a sidecar, with attributes gathered cheaply: the device region and posture from the verified token or mTLS identity, the resource classification from metadata cached alongside the resource. Avoid remote lookups per request — preload resource attributes, and keep the policy bundle in-process so decisions take microseconds. Log each decision with the attributes used for auditability. Combine with ReBAC: the relationship check says who may access, the ABAC policy adds the contextual condition."
        }
      ],
    },
    {
      id: 'security-general-mcq-15',
      difficulty: 'expert',
      question:
        'A service encrypts events with AES-256-GCM using one long-lived key and a nonce built from a 32-bit counter stored in Redis. After a Redis failover the counter restarted from an old snapshot. What is the real risk?',
      options: [
        'Only performance: GCM re-derives the key schedule when a nonce repeats',
        'Nonce reuse under the same key leaks the XOR of the plaintexts and lets an attacker recover the GHASH key and forge valid ciphertexts',
        'Decryption of old events fails because GCM tags depend on the counter being monotonic',
        'No risk, because the authentication tag still detects tampering',
      ],
      correct: [1],
      explanation:
        'GCM is CTR mode plus GHASH: a repeated (key, nonce) pair produces the same keystream, exposing plaintext XORs, and lets an attacker solve for the authentication key and forge messages — so the tag no longer protects anything. Fixes: random 96-bit nonces with key rotation well before ~2^32 messages, per-object DEKs, or a misuse-resistant mode like AES-GCM-SIV. Decryption of old events still works; the problem is confidentiality and integrity.',
      followUps: [
        {
          "q": "You switch to random 96-bit nonces. At 50,000 events/s with the same key, when must you rotate, and why?",
          "a": "With random 96-bit nonces, NIST limits a single key to 2^32 messages to keep the nonce-collision probability below about 2^-32. At 50,000 events/s, 2^32 ≈ 4.3 billion messages are reached in about 86,000 seconds ≈ 1 day. So rotate the key at least daily (in practice every few hours, or use per-tenant / per-hour DEKs under envelope encryption). Alternatively use a misuse-resistant mode (AES-GCM-SIV) or XChaCha20-Poly1305 with a 192-bit nonce, where random nonces are safe for practically unlimited messages."
        },
        {
          "q": "Events encrypted with repeated nonces are already in storage. What do you do about them?",
          "a": "Treat the key as compromised for those messages: an attacker with access to the ciphertexts can recover XORs of plaintexts and forge new ciphertexts under that key. Identify affected events (same key, nonce range overlapping the Redis snapshot window), re-encrypt all data under a new key with a correct nonce scheme, and then destroy the old key so forged messages fail to authenticate. Review consumers: any event received during the window could have been forged, so validate critical events against a source of truth (e.g. the DB)."
        }
      ],
    },
  ],
};

export default topic;
