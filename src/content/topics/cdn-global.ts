import type { Topic } from '../../types';

const topic: Topic = {
  id: 'cdn-global',
  phase: 'caching',
  order: 3,
  title: 'CDN, Edge Caching & Global Architecture',
  subtitle:
    'Push vs pull CDNs, HTTP caching headers, origin shield, purge vs versioned URLs, GeoDNS vs Anycast, multi-region routing, data residency and edge compute.',
  estimatedMinutes: 95,
  sources: [
    'Alex Xu — System Design Interview Vol 2, Ch 1 Proximity Service (multi-region deployment)',
    'Alex Xu — System Design Interview Vol 2, Ch 9 S3-like Object Storage',
    'RFC 9111 (HTTP Caching), RFC 5861 (stale-while-revalidate / stale-if-error)',
    'Mastering API Architecture — Ch 3 (API gateways & edge)',
  ],
  tags: ['cdn', 'edge', 'cache-control', 'etag', 'anycast', 'geodns', 'multi-region', 'data-residency', 'edge-compute'],
  cheatSheet: [
    'Physics first: light in fiber ≈ 200 km/ms → Mumbai↔Virginia (~13,000 km path) ≈ 130–200 ms RTT; a TLS 1.3 + TCP cold connect costs 2 RTTs before the first byte. The CDN wins by terminating TCP/TLS 5–30 ms from the user.',
    'Pull CDN = lazy fill on miss (default for web/API); Push CDN = you upload ahead of time (large, predictable files: game patches, video renditions).',
    'Cache-Control: max-age governs browsers, s-maxage overrides it for shared caches (CDN); "private" forbids CDN storage; "no-cache" means store-but-revalidate, "no-store" means never store.',
    'Versioned/fingerprinted URLs (app.3f9a1c.js + max-age=31536000, immutable) beat purges for static assets; purge is for content whose URL must stay stable (HTML, API responses, images by id).',
    'Surrogate keys / cache tags let you purge "everything tagged product:42" in one call (Fastly ~150 ms global purge, Cloudflare Cache-Tag, Akamai Edge-Cache-Tag).',
    'stale-while-revalidate hides origin latency; stale-if-error hides origin outages — together they turn an origin incident into a freshness incident.',
    'Origin shield = one designated mid-tier PoP that all edge PoPs fill through → collapses N PoP misses into 1 origin request; pair with request collapsing.',
    'GeoDNS picks a region by resolver location (TTL-bound, resolver ≠ user unless ECS); Anycast announces one IP from many PoPs and BGP routes to the nearest — failover in seconds, no DNS TTL.',
    'Active-passive = cheap, simple, minutes of RTO; active-active = every region serves traffic, needs conflict strategy for writes (home-region per user, CRDTs, or a global DB).',
    'Data residency (GDPR, India DPDP Act 2023, RBI payment-data localisation) is a partitioning key: pin users to a home region and keep PII there; replicate only non-personal or tokenised data.',
  ],
  sections: [
    {
      heading: 'Why a CDN exists: latency is physics, not code',
      body: `**Intuition:** you cannot make light go faster, so you move the content closer to the user. A CDN is a fleet of caches (Points of Presence, PoPs) in hundreds of cities that answer on behalf of your origin.

**The numbers that matter**
- Light in fiber travels at ~200,000 km/s → **~1 ms per 100 km one way**, i.e. ~1 ms RTT per 100 km of path. Real routes are 1.3–2× the great-circle distance.
- Mumbai → us-east-1 (Virginia) is ~13,000 km great-circle; measured RTT is typically **190–230 ms**.
- A cold HTTPS request needs TCP handshake (1 RTT) + TLS 1.3 (1 RTT) + request (1 RTT) = **3 RTTs ≈ 600 ms** before the first byte from India to Virginia — before your server does any work.
- With a CDN PoP in Mumbai (RTT ~10 ms), the handshakes cost ~20 ms; even a **cache miss** is faster because the PoP keeps a **warm, long-lived, multiplexed connection** to the origin, so the long-haul leg is 1 RTT, not 3.

**What a CDN actually gives you**
| Benefit | Mechanism |
|---|---|
| Lower latency | TCP/TLS termination near user; cached bytes served locally |
| Origin offload | 90–99% cache hit ratio on static assets means origin sees 1–10% of traffic |
| Bandwidth cost | CDN egress is usually cheaper than cloud egress (AWS internet egress ≈ $0.05–0.09/GB vs CDN committed rates far lower at volume) |
| Resilience | Absorbs traffic spikes and L3/L4/L7 DDoS; serves stale on origin failure |
| Edge logic | WAF, bot mitigation, redirects, auth checks, A/B routing at the edge |

**In interviews say this:** "The CDN is not only a cache — it is a connection-termination layer. Even uncacheable API calls get faster because the PoP holds a warm pool to origin, removing 2 of the 3 long-haul round trips."`,
      diagram: `  User (Mumbai)                                         Origin (us-east-1)
     |  TCP+TLS: 2 x 10 ms                                       ^
     v                                                           |
 +-----------+  miss   +----------------+   warm keep-alive    +--------+
 | Edge PoP  | ------> | Origin Shield  | -------------------> | ALB /  |
 | Mumbai    | <------ | (e.g. Singapore)| <------------------ | app    |
 +-----------+  fill   +----------------+   1 RTT ~200 ms      +--------+
     | hit: ~10-20 ms total
     v
  Cached bytes`,
      keyPoints: [
        '~1 ms RTT per 100 km of fiber path; India↔US-East ≈ 200 ms RTT.',
        'Cold HTTPS = 3 RTTs before first byte; the PoP collapses that to 1 long-haul RTT even on a miss.',
        'CDN = cache + connection termination + security perimeter.',
      ],
    },
    {
      heading: 'Pull vs Push CDN',
      body: `**Intuition:** a pull CDN is a lazy cache — it fetches from you the first time someone asks. A push CDN is a warehouse — you stock it before anyone asks.

| Aspect | Pull (origin-pull) | Push (pre-populated) |
|---|---|---|
| How content arrives | Edge fetches from origin on first miss, stores per TTL | You upload to CDN storage (or it is the origin, e.g. S3 + CloudFront, Akamai NetStorage) |
| Best for | Websites, images, API responses, long tail | Large, predictable files: game patches, OS updates, video renditions, firmware |
| First-request cost | Miss penalty (origin latency) per PoP, per object | None — already there (if pre-warmed) |
| Storage | Only what is requested, evicted by LRU | Everything you pushed, you pay for it |
| Operational effort | Almost none — set headers | Upload pipeline, versioning, deletion |
| Risk | Thundering herd on origin after purge or new release | Stale content if you forget to push/delete |

**The reality in 2026:** almost every CDN is pull-based, and "push" is usually implemented as *object storage as origin + pre-warming*. For a game patch of 40 GB going to 10M players at 10:00 UTC, you pre-warm (pre-fetch) popular PoPs because a pull miss storm on launch day would hammer the storage origin.

**Interview line:** "Default to pull with good Cache-Control headers. Use push/pre-warm only when content is large, the audience is predictable and the launch time is known."`,
      keyPoints: [
        'Pull = lazy fill, push = pre-positioned; most modern CDNs are pull with optional pre-warm.',
        'Pull\'s weakness is the miss storm after a release or purge — mitigate with origin shield + request collapsing.',
      ],
    },
    {
      heading: 'HTTP caching headers: the contract between origin and every cache',
      body: `**Intuition:** the origin tells every cache (browser, corporate proxy, CDN) how long a response is fresh and who may store it. Get headers wrong and the CDN either caches nothing or caches the wrong user's data.

**Cache-Control directives you must know (RFC 9111)**
| Directive | Meaning |
|---|---|
| \`max-age=N\` | Fresh for N seconds in any cache |
| \`s-maxage=N\` | Overrides max-age for **shared** caches (CDN, proxies) only |
| \`public\` | Any cache may store it, even if the request had Authorization |
| \`private\` | Only the browser may store it — CDN must not |
| \`no-cache\` | May store, but **must revalidate** with origin before each use |
| \`no-store\` | Never store anywhere (PII, banking pages) |
| \`immutable\` | Content never changes during freshness — browser skips revalidation on reload |
| \`stale-while-revalidate=N\` | Serve stale up to N s while refreshing in the background |
| \`stale-if-error=N\` | Serve stale up to N s if origin errors (5xx) or is unreachable |

Many CDNs also honour a CDN-only header (\`Surrogate-Control\`, \`CDN-Cache-Control\` per RFC 9213, or \`Cloudflare-CDN-Cache-Control\`) so you can give the CDN a long TTL while telling browsers a short one.

**Validators — cheap revalidation**
- \`ETag: "v42-abc"\` + request \`If-None-Match\` → origin answers **304 Not Modified** with no body.
- \`Last-Modified\` + \`If-Modified-Since\` → same idea, 1-second granularity.
- A 304 still costs one round trip but saves the bytes and usually the DB work if you compute the ETag cheaply (e.g. from \`updated_at\` or a version column).
- Beware: weak ETags (\`W/"..."\`) and ETags that differ across origin nodes (e.g. inode-based ETags on Apache/nginx serving from different disks) destroy revalidation.

**Vary — the cache key multiplier**
\`Vary: Accept-Encoding\` is fine (2–3 variants). \`Vary: User-Agent\` or \`Vary: Cookie\` creates thousands of variants per URL and drives hit ratio toward zero. Normalise at the edge instead (e.g. derive a \`device-class\` header with 3 values).

**Cache key:** by default scheme + host + path + query string. Strip tracking params (\`utm_*\`, \`fbclid\`) and sort query params at the edge, or every campaign link becomes a unique miss.`,
      code: [
        {
          language: 'typescript',
          title: 'NestJS: per-route cache policy with strong ETag + CDN-only TTL',
          code: `import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { ProductService } from './product.service';

@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    // Cheap version lookup (indexed column) — avoids loading the full row for a 304
    const version = await this.products.getVersion(id);
    const etag = '"' + createHash('sha1').update(id + ':' + version).digest('hex').slice(0, 16) + '"';

    // Browser: 60 s. CDN: 1 h, serve stale 60 s while refreshing, 1 day if origin is down.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60, stale-if-error=86400');
    res.setHeader('CDN-Cache-Control', 'max-age=3600, stale-while-revalidate=60, stale-if-error=86400');
    res.setHeader('Surrogate-Key', 'product-' + id + ' products'); // purge by tag later
    res.setHeader('ETag', etag);
    res.setHeader('Vary', 'Accept-Encoding'); // never Vary on Cookie for public content

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end(); // no body, no DB row fetch
    }
    const product = await this.products.findById(id);
    return res.json(product);
  }
}`,
        },
      ],
      keyPoints: [
        's-maxage / CDN-Cache-Control lets the CDN cache longer than browsers — so you can purge the CDN but not browsers.',
        'no-cache ≠ no-store: no-cache stores and revalidates.',
        'Vary: Cookie on public content is a hit-ratio killer; normalise the cache key at the edge.',
      ],
      source: 'RFC 9111 HTTP Caching; RFC 9213 Targeted Cache-Control',
    },
    {
      heading: 'Invalidation: purge vs versioned URLs vs surrogate keys',
      body: `**Intuition:** there are two ways to change what users see — tell every cache to forget (purge) or give the new content a new name (versioning). Renaming is instant, atomic and free; forgetting is eventually consistent and can stampede your origin.

**Versioned (fingerprinted) URLs** — the gold standard for static assets
- Build emits \`app.3f9a1c.js\`; HTML references it. Serve with \`Cache-Control: public, max-age=31536000, immutable\`.
- Deploy = upload new hashed assets first, then switch HTML. Old HTML still references old assets → no broken pages mid-deploy. Keep old assets for at least one HTML TTL (ideally days) for clients with stale HTML.
- The HTML itself gets a short TTL (\`max-age=0, s-maxage=60\`) or is purged on deploy.

**Purge (invalidation)**
- By URL, by prefix/wildcard, or everything. CloudFront invalidations typically complete in well under a minute to a few minutes and the first 1,000 paths/month are free, then ~$0.005 per path; Fastly and Cloudflare purge globally in ~150 ms–a few seconds.
- A purge is **eventually consistent** across PoPs, and a purge-all causes a global miss storm.
- Prefer **soft purge** (mark stale, serve stale-while-revalidate) over hard purge (delete) — the origin sees one refresh per object per PoP instead of a spike.

**Surrogate keys / cache tags** — purge by meaning, not URL
- Origin tags responses: \`Surrogate-Key: product-42 category-7 brand-3\`.
- When product 42's price changes, purge tag \`product-42\` → every URL that rendered it (PDP, search page, category listing, API JSON) is invalidated in one call.
- Drive purges from the change-data stream (CDC/Kafka) so they are not forgotten in some code path.

| Technique | Latency to take effect | Origin impact | Use for |
|---|---|---|---|
| Versioned URL | Instant (new name) | Only new objects miss | JS/CSS/images/fonts |
| Short TTL | Up to TTL | Constant revalidation load | Frequently changing, low-value content |
| URL purge | Seconds–minutes | Miss per purged URL per PoP | Stable URLs (HTML, /api/products/42) |
| Tag purge | ~150 ms–seconds | Only affected objects | Catalog/CMS content rendered on many pages |
| Purge all | Seconds | Global miss storm | Emergencies only |`,
      code: [
        {
          language: 'typescript',
          title: 'Kafka consumer that purges CDN tags on product changes (debounced, idempotent)',
          code: `import { Kafka } from 'kafkajs';

const kafka = new Kafka({ clientId: 'cdn-purger', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'cdn-purger' });
const pending = new Set<string>();

async function flush(): Promise<void> {
  if (pending.size === 0) return;
  const tags = [...pending].slice(0, 256); // provider batch limit
  tags.forEach((t) => pending.delete(t));
  const res = await fetch('https://api.fastly.com/service/' + process.env.FASTLY_SERVICE + '/purge', {
    method: 'POST',
    headers: {
      'Fastly-Key': process.env.FASTLY_TOKEN ?? '',
      'Surrogate-Key': tags.join(' '),
      'Fastly-Soft-Purge': '1', // mark stale instead of evicting: no miss storm
    },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) tags.forEach((t) => pending.add(t)); // retry on next tick; purges are idempotent
}

export async function run(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: 'catalog.product.changed' });
  setInterval(() => void flush(), 500); // coalesce bursts: 1,000 price edits -> a few API calls
  await consumer.run({
    eachMessage: async ({ message }) => {
      const evt = JSON.parse(message.value?.toString() ?? '{}');
      pending.add('product-' + evt.productId);
      if (evt.categoryId) pending.add('category-' + evt.categoryId);
    },
  });
}`,
        },
      ],
      keyPoints: [
        'Static assets: fingerprint + immutable + 1-year TTL; never purge them.',
        'Soft purge + stale-while-revalidate avoids the post-purge stampede.',
        'Drive tag purges from CDC/events so no write path forgets to invalidate.',
      ],
    },
    {
      heading: 'Protecting the origin: origin shield, request collapsing and stale serving',
      body: `**Intuition:** 300 PoPs each missing the same object means 300 origin hits. An origin shield is a "cache in front of the cache" so the origin sees one.

**Tiered caching / origin shield**
- Edge PoPs fill from a designated **shield PoP** (CloudFront Origin Shield, Fastly shielding, Cloudflare Tiered Cache / Argo) located near the origin.
- Effect: origin requests per object drop from ~number-of-PoPs to ~1 per TTL. Hit ratio at the origin boundary typically goes from ~85–90% to 95–99%.
- Cost: one extra hop on a miss (a few ms if the shield is in the origin region) and some extra CDN charges.

**Request collapsing (coalescing)**
- 5,000 concurrent requests for a just-expired object at one PoP → the PoP sends **one** request to origin and parks the other 4,999 until it returns. Most CDNs do this by default for cacheable responses; it does **not** help for uncacheable responses (\`private\`, \`no-store\`, Set-Cookie), which pass straight through.

**Stale serving as an availability feature**
- \`stale-while-revalidate=60\`: after TTL, users get the stale object instantly while one background refresh runs.
- \`stale-if-error=86400\`: if origin returns 5xx/times out, serve the last good copy for up to a day. Your homepage stays up during an origin outage.

**Other origin-protection levers:** cache 404s briefly (negative caching, e.g. 30–60 s) so scanners do not hammer origin; normalise the cache key; restrict origin to CDN IPs or a secret header / mTLS so attackers cannot bypass the CDN.`,
      diagram: `   Without shield                      With shield
 PoP1 PoP2 ... PoP300                PoP1 PoP2 ... PoP300
   \\    |       /                       \\    |       /
    \\   |      /   300 misses            v   v      v
     v  v     v                        +--------------+
   +-----------+                       | Shield (IAD) |  1 miss
   |  Origin   |                       +------+-------+
   +-----------+                              v
                                        +-----------+
                                        |  Origin   |
                                        +-----------+`,
      keyPoints: [
        'Shield converts N-PoP misses into ~1 origin fetch per object per TTL.',
        'Request collapsing only helps cacheable responses.',
        'stale-if-error turns an origin outage into a freshness problem.',
        'Lock the origin to CDN traffic only, or the CDN is a suggestion, not a shield.',
      ],
    },
    {
      heading: 'Routing users to the right place: GeoDNS vs Anycast',
      body: `**Intuition:** GeoDNS answers "where are you?" by giving different IPs to different users. Anycast gives everyone the same IP and lets the internet's routing (BGP) deliver packets to the nearest location.

| Aspect | GeoDNS / latency-based DNS | Anycast |
|---|---|---|
| How | Authoritative DNS returns region-specific IP based on resolver IP (or EDNS Client Subnet) | Same IP prefix announced via BGP from many PoPs |
| Granularity | Per DNS resolver — a user on 8.8.8.8 may be mis-located without ECS | Per network path — whatever BGP thinks is closest |
| Failover speed | Bounded by TTL (30–60 s set, but some resolvers/clients cache longer) | Seconds — withdraw the route, traffic shifts |
| Session stickiness | Stable per resolution | Route flaps can move a TCP flow mid-connection (rare; mitigated by stable routing & connection handoff) |
| Control | Fine-grained (weights, geo rules, health checks) | Coarse — BGP is not latency-aware, only path-aware |
| Used by | Route 53 latency/geolocation routing, NS1, Azure Traffic Manager | Cloudflare, Google Front End, AWS Global Accelerator, root DNS servers |

**Common production combo:** Anycast to the CDN/edge (users hit the nearest PoP), then the edge picks the **origin region** with health-checked, latency-aware logic — so region failover does not depend on DNS TTLs at all.

**GeoDNS gotchas**
- TTL is a request, not a guarantee: JVMs historically cached DNS forever, mobile OSes and ISPs may hold records longer. Plan for a long tail of traffic hitting the old region for many minutes.
- Resolver location ≠ user location: a user in Chennai using a public resolver may be routed via Singapore unless the resolver sends ECS.`,
      code: [
        {
          language: 'yaml',
          title: 'Route 53 latency-based records with health checks (CloudFormation excerpt)',
          code: `ApiRecordIndia:
  Type: AWS::Route53::RecordSet
  Properties:
    HostedZoneId: !Ref Zone
    Name: api.example.com
    Type: A
    SetIdentifier: ap-south-1
    Region: ap-south-1            # latency-based routing
    HealthCheckId: !Ref MumbaiHealth
    AliasTarget:
      DNSName: !GetAtt MumbaiAlb.DNSName
      HostedZoneId: !GetAtt MumbaiAlb.CanonicalHostedZoneID
      EvaluateTargetHealth: true
ApiRecordUsEast:
  Type: AWS::Route53::RecordSet
  Properties:
    HostedZoneId: !Ref Zone
    Name: api.example.com
    Type: A
    SetIdentifier: us-east-1
    Region: us-east-1
    HealthCheckId: !Ref VirginiaHealth
    AliasTarget:
      DNSName: !GetAtt VirginiaAlb.DNSName
      HostedZoneId: !GetAtt VirginiaAlb.CanonicalHostedZoneID
      EvaluateTargetHealth: true
MumbaiHealth:
  Type: AWS::Route53::HealthCheck
  Properties:
    HealthCheckConfig:
      Type: HTTPS
      FullyQualifiedDomainName: mumbai-origin.example.com
      ResourcePath: /healthz/deep   # checks DB + cache, not just process liveness
      RequestInterval: 10
      FailureThreshold: 3            # ~30 s to mark unhealthy`,
        },
      ],
      keyPoints: [
        'GeoDNS failover is bounded by TTL and misbehaving caches; Anycast failover is BGP-speed.',
        'Best practice: Anycast to the edge, health-checked origin selection behind it.',
        'Use deep health checks, but beware of a shared dependency making every region "unhealthy" at once.',
      ],
    },
    {
      heading: 'Multi-region: active-passive vs active-active (routing view)',
      body: `**Intuition:** active-passive is a spare tyre — it sits idle until you need it. Active-active is running on all four tyres — every region carries real traffic, so you know it works, but you must handle writes arriving in two places.

| Aspect | Active-passive | Active-active |
|---|---|---|
| Traffic | 100% to primary; standby warm or pilot-light | Split across regions (geo or weighted) |
| Writes | Single writer region — no conflicts | Either home-region-per-user (partitioned) or multi-writer with conflict resolution |
| Failover | DNS/edge flip + promote DB replica; RTO minutes | Drain the failed region; others absorb (need ~N/(N-1) headroom) |
| Cost | Standby may be smaller (scale up on failover — risky) | Every region sized for its share + failover headroom |
| Confidence | Standby rots unless drilled | Continuously exercised |
| Latency | Far users pay the RTT to primary | Users served locally |

**Capacity math:** with 2 active regions each at 50%, losing one means the survivor needs 100% — so each must be provisioned for ~100% of peak (or accept load shedding). With 3 regions at 33%, each needs ~50% → the 3-region design is cheaper per unit of resilience.

**The routing layer during a regional outage**
1. Health checks mark the region down (edge or DNS).
2. Edge stops sending it traffic (Anycast/edge routing: seconds; DNS: TTL + stragglers).
3. Surviving regions must absorb the load **and** the retry storm — autoscaling lags by minutes, so pre-provisioned headroom or load shedding is mandatory.
4. Stateful concerns (who is now the writer, replication lag, RPO) are covered in depth in the **rel-dr** and **db-replication** topics.

**Pattern that works for most companies:** active-active for stateless read paths + CDN, **home-region per user** for writes (user's data lives in one region, routed there by a user-id → region directory), and async replication for DR.`,
      diagram: `              Anycast edge (nearest PoP)
                     |
        +------------+-------------+
        | edge routing by user home |
        v                           v
 +--------------+           +--------------+
 |  ap-south-1  |  async    |  us-east-1   |
 |  users: IN   | <-------> |  users: US   |
 |  writer: IN  |  replic.  |  writer: US  |
 +--------------+           +--------------+
   region down? edge re-routes IN users to us-east-1
   (reads from replica; writes only after controlled promotion)`,
      keyPoints: [
        'Active-active needs failover headroom: 2 regions → each ~100% of peak; 3 regions → ~50% each.',
        'Home-region-per-user avoids multi-writer conflicts while still serving locally.',
        'Deep DR (RPO/RTO, promotion, drills) lives in rel-dr.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 1 (multi-region deployment)',
    },
    {
      heading: 'Data locality and residency',
      body: `**Intuition:** some data is legally required to stay in a country, and some data is simply too slow to fetch across an ocean. Both push you toward partitioning data by geography.

**Regulatory drivers (verify specifics with legal — these evolve)**
- **GDPR (EU):** transfers outside the EU/EEA need a lawful mechanism (adequacy decision, SCCs, EU-US Data Privacy Framework). Not strict localisation, but it pushes EU PII to EU regions.
- **India DPDP Act 2023:** allows cross-border transfer except to countries the government restricts; sectoral rules are stricter — **RBI's 2018 directive requires payment system data to be stored only in India** (processing abroad allowed, data must return within 24 hours).
- Others: China PIPL, Russia 242-FZ, Saudi/UAE sector rules — often strict localisation.

**Architecture patterns**
1. **Home region / cell per user:** at signup, assign region by residency; store a small global directory \`user_id → region\` (replicated everywhere, contains no PII beyond an id). The edge routes each request to the home region.
2. **Split data by class:** PII and payment data stay local; tokenised or aggregated data (analytics, product catalog) can be global.
3. **Global services consume tokens, not PII:** e.g. a global fraud model sees \`user_token\`, not phone number.
4. **CDN caution:** personal responses must be \`Cache-Control: private\` or the CDN may store PII in a PoP in another jurisdiction. Some CDNs offer regional data-localisation controls (e.g. Cloudflare Data Localization Suite) that restrict where TLS keys and cached content live.
5. **Logs and backups count:** shipping PII-laden logs to a US observability vendor can itself be a violation — scrub at source.

**Interview line:** "Residency is a sharding key. I'd partition by home region, keep a PII-free global directory for routing, and treat logs, backups and CDN caches as data stores subject to the same rules."`,
      keyPoints: [
        'Residency turns geography into a partition key.',
        'Global directory maps user → home region and holds no PII.',
        'CDN caches, logs and backups are data stores too.',
      ],
    },
    {
      heading: 'Edge compute: what belongs at the edge (and what does not)',
      body: `**Intuition:** edge compute lets you run small functions inside the PoP — like a tiny serverless function 10 ms from the user — for decisions that do not need your database.

**Platforms:** Cloudflare Workers (V8 isolates, ~0–5 ms cold start), Fastly Compute (Wasm), CloudFront Functions (tiny JS, sub-ms, header/URL manipulation only) and Lambda@Edge (Node/Python, heavier, regional edge caches), Vercel/Netlify edge functions, Akamai EdgeWorkers.

**Good fits**
- Auth token **verification** (JWT signature + expiry) and rejecting bad requests before origin.
- Cache-key normalisation, query-param stripping, device-class detection.
- A/B test bucketing, feature flags, geo redirects, localisation.
- Signed URLs for private media; bot scoring; rate limiting at the edge.
- Personalisation by **assembling** cached fragments (ESI-style) instead of rendering at origin.

**Poor fits**
- Anything needing strongly consistent reads/writes to your primary DB — a function in Mumbai querying Postgres in Virginia is slower than doing it at origin.
- Long CPU-heavy work (edge CPU limits are typically tens of ms per request on lower tiers).
- Large dependencies / native modules.

**Edge data stores:** Workers KV (eventually consistent, global propagation up to ~60 s), Durable Objects (single-writer strongly consistent object in one location), D1/Turso (SQLite replicas). Use them for config, flags, sessions — not the ledger.`,
      code: [
        {
          language: 'typescript',
          title: 'Cloudflare Worker: normalise cache key, verify JWT at edge, route to home region',
          code: `import { jwtVerify, importSPKI } from 'jose';

export interface Env { JWT_PUBLIC_KEY: string; ORIGIN_IN: string; ORIGIN_US: string }
const STRIP = [/^utm_/, /^fbclid$/, /^gclid$/];

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // 1) Normalise cache key: drop tracking params, sort the rest
    const kept = [...url.searchParams].filter(([k]) => !STRIP.some((r) => r.test(k)));
    kept.sort(([a], [b]) => a.localeCompare(b));
    url.search = new URLSearchParams(kept).toString();

    if (url.pathname.startsWith('/api/me')) {
      // 2) Reject bad tokens at the edge: origin never sees them
      const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
      try {
        const key = await importSPKI(env.JWT_PUBLIC_KEY, 'RS256');
        const { payload } = await jwtVerify(token, key, { algorithms: ['RS256'] });
        // 3) Route to the user's home region (claim set at signup)
        const origin = payload.region === 'in' ? env.ORIGIN_IN : env.ORIGIN_US;
        return fetch(new Request(origin + url.pathname + url.search, req));
      } catch {
        return new Response('unauthorized', { status: 401 });
      }
    }
    // Public content: fetch through the CDN cache with the normalised key
    return fetch(new Request(url.toString(), req), { cf: { cacheEverything: true } });
  },
};`,
        },
      ],
      keyPoints: [
        'Edge = stateless decisions (auth verify, routing, cache keys, flags).',
        'Edge function + far-away DB = slower than origin; keep data access at origin or use edge-native stores.',
        'Workers KV is eventually consistent (~60 s); Durable Objects give single-location strong consistency.',
      ],
    },
    {
      heading: 'Scenario playbook: global latency, cost, overload, staleness, region down',
      body: `**1. "Global users see high latency" / "India users hit US servers"**
- Measure first: RUM (real user monitoring) p50/p95 by country; split into DNS, TCP, TLS, TTFB, download.
- If TCP+TLS dominate → put a CDN/edge in front of **everything**, including APIs (connection termination + warm origin pools). Enable HTTP/2 or HTTP/3, TLS 1.3, 0-RTT resumption only for idempotent GETs.
- If TTFB dominates on cacheable content → cache it (s-maxage, SWR). On uncacheable API → regional read replicas + a regional app tier for reads (ap-south-1), then home-region writes.
- Expected result: India p95 on cached assets from ~800 ms to ~50–80 ms; dynamic API from ~700 ms to ~250 ms with edge only, ~60–100 ms with an in-country region.

**2. "Static assets are expensive"**
- Check hit ratio by content type and the cache-key cardinality (query params, Vary). Fingerprint + immutable + 1-year TTL.
- Compress (Brotli for text; ~15–25% smaller than gzip), serve AVIF/WebP via content negotiation with a normalised \`Vary\`.
- Enable origin shield so origin egress drops; negotiate committed CDN rates; move origin to object storage.

**3. "Origin is overloaded"**
- Look at origin request rate vs edge request rate. Low offload → headers (no-cache, Set-Cookie on static paths, Vary: Cookie), cache-key explosion, or bots bypassing CDN.
- Fix: correct headers, shield + collapsing, negative caching, lock origin to CDN IPs, soft purge instead of purge-all, rate limit at edge.

**4. "CDN is serving stale content"**
- Confirm with \`Age\`, \`X-Cache\`, \`CF-Cache-Status\` headers from several PoPs. Causes: long s-maxage without purge on change, purge by URL missing variants (query strings, \`Accept-Encoding\` variants, trailing slash), browser cache (max-age) — which no CDN purge can clear, service worker caching, or origin itself serving stale (read replica lag).
- Fix: tag-based purge from CDC; short browser TTL + longer CDN TTL; versioned URLs for assets; document that browser caches are out of reach.

**5. "One region is down" (routing aspect)**
- Edge health checks steer traffic away in seconds; with DNS-only failover expect TTL + stragglers.
- Survivors must absorb load: pre-provisioned headroom, load shedding for non-critical traffic, and stale-if-error so cached pages keep serving.
- Writes for users homed in the failed region: read-only mode or controlled promotion (see rel-dr).`,
      keyPoints: [
        'Always decompose latency (DNS/TCP/TLS/TTFB/download) before choosing a fix.',
        'Browser caches cannot be purged — keep max-age short on mutable URLs.',
        'Regional failover needs headroom + shedding, not just a DNS change.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'cdn-global-cc-1',
      title: 'Fix the cache headers that leak user data and kill hit ratio',
      context:
        'An Express/NestJS middleware sets caching headers for every response behind CloudFront. The CDN hit ratio is 22%, origin CPU is pegged, and last week a user reported seeing someone else\'s cart summary in the header of the homepage.',
      task: 'Rewrite the middleware so public content is cached efficiently at the CDN, personalised content is never stored in shared caches, static assets use long-lived immutable caching, and the origin can survive short outages.',
      starter: {
        language: 'typescript',
        code: `import type { Request, Response, NextFunction } from 'express';

export function cacheHeaders(req: Request, res: Response, next: NextFunction) {
  // "Cache everything for 1 hour so the CDN takes load off us"
  res.setHeader('Cache-Control', 'public, max-age=3600');
  // Different layouts for mobile vs desktop
  res.setHeader('Vary', 'User-Agent, Cookie');

  if (req.path.startsWith('/static/')) {
    // bundles are named app.js, vendor.js — overwritten on each deploy
    res.setHeader('Cache-Control', 'public, max-age=31536000');
  }

  if (req.path === '/' && req.cookies?.session) {
    // homepage shows "Hi Priya, 3 items in cart" for logged-in users
    res.locals.personalised = true;
  }
  next();
}`,
      },
      hints: [
        'What does a shared cache do with a "public" response that was rendered for one logged-in user?',
        'How many distinct cache variants does Vary: User-Agent, Cookie create per URL?',
        'A 1-year TTL on a file whose name never changes means users keep old code for a year — what naming scheme fixes that?',
      ],
      solution: {
        language: 'typescript',
        code: `import type { Request, Response, NextFunction } from 'express';

const FINGERPRINTED = /\\.[0-9a-f]{8,}\\.(js|css|woff2|png|svg|avif|webp)$/;

export function cacheHeaders(req: Request, res: Response, next: NextFunction) {
  // 1) Fingerprinted static assets: content-addressed, safe to cache "forever"
  if (req.path.startsWith('/static/') && FINGERPRINTED.test(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return next();
  }

  // 2) Anything authenticated or personalised: browser-only, never the CDN
  if (req.headers.authorization || req.cookies?.session) {
    res.setHeader('Cache-Control', 'private, no-cache'); // browser may store, must revalidate
    return next();
  }

  // 3) Anonymous HTML/API: short browser TTL, longer CDN TTL, survive origin blips
  res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=30, stale-if-error=86400');
  res.setHeader('CDN-Cache-Control', 'max-age=300, stale-while-revalidate=60, stale-if-error=86400');
  // Device class is derived at the edge (CloudFront-Is-Mobile-Viewer) — 2-3 variants, not thousands
  res.setHeader('Vary', 'Accept-Encoding, CloudFront-Is-Mobile-Viewer');
  next();
}

// Homepage personalisation moves client-side: the cached shell calls
// GET /api/me/summary (private, no-store) after load, so the HTML stays cacheable.`,
      },
      explanation: `**Fixes**
- **Data leak:** the logged-in homepage was marked \`public, max-age=3600\` — the CDN stored Priya's personalised HTML and served it to others (Vary: Cookie only helps if the CDN honours it and forwards cookies; many CDN configs strip cookies from the key). Personalised/auth responses are now \`private\`.
- **Hit ratio:** \`Vary: User-Agent, Cookie\` created a variant per browser build per session. Replaced with a normalised, edge-derived device header (2–3 values) plus \`Accept-Encoding\`.
- **Static assets:** 1-year TTL on non-fingerprinted \`app.js\` meant users ran stale bundles after deploys (no purge reaches browsers). Only content-hashed files get \`immutable\`; the build must emit hashes.
- **Split TTLs:** browsers get 30 s (unpurgeable), the CDN gets 5 min (purgeable) via \`CDN-Cache-Control\`.
- **Resilience:** \`stale-while-revalidate\` hides refresh latency; \`stale-if-error\` keeps anonymous pages up during origin outages.
- **Architecture:** personalisation moved to a small private API call, so the heavy HTML shell remains cacheable for everyone.`,
      followUps: [
        {
          "q": "How would you add an automated test that guarantees a personalised response can never be marked public again?",
          "a": "Write integration tests that hit representative routes with and without a session cookie and an Authorization header, and assert on headers: any response to an authenticated request must contain private or no-store and must not contain s-maxage or CDN-Cache-Control. Add a response-level guard in production code too: a final middleware that throws (or rewrites to private) if res.locals.personalised or req.user is set while Cache-Control contains public. In staging, a synthetic check fetches the homepage logged in and verifies the CDN cache-status is MISS or BYPASS."
        },
        {
          "q": "The CDN must now serve AVIF to browsers that support it and WebP to the rest from the same image URL. How do you avoid exploding the cache?",
          "a": "Don't Vary on the raw Accept header, which differs per browser version. At the edge, derive a normalised header such as X-Img-Format with values avif, webp or jpeg from Accept, include only that in the cache key, and have origin or the image service return Vary: X-Img-Format. That gives exactly three variants per image. Many CDNs offer this as a built-in image optimisation setting. Measure hit ratio per variant; if AVIF encoding is slow at origin, pre-generate formats at upload."
        }
      ],
    },
    {
      id: 'cdn-global-cc-2',
      title: 'Harden the deploy script that purges the CDN',
      context:
        'Every deploy runs this script. After each release origin CPU spikes to 100% for ~3 minutes, p99 goes to 8 s, and some users get a blank page because their cached HTML references JS files that no longer exist.',
      task: 'Rewrite the deploy flow so releases are atomic for users, never cause a global miss storm, and purge failures do not silently leave stale HTML.',
      starter: {
        language: 'typescript',
        code: `import { S3Client, DeleteObjectsCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { readdirSync, readFileSync } from 'node:fs';

const s3 = new S3Client({});
const cf = new CloudFrontClient({});

export async function deploy(buildDir: string) {
  // 1. wipe the old release
  const old = await s3.send(new ListObjectsV2Command({ Bucket: 'web', Prefix: 'static/' }));
  await s3.send(new DeleteObjectsCommand({
    Bucket: 'web',
    Delete: { Objects: (old.Contents ?? []).map((o) => ({ Key: o.Key! })) },
  }));
  // 2. upload new files (index.html first, alphabetical)
  for (const f of readdirSync(buildDir).sort()) {
    await s3.send(new PutObjectCommand({ Bucket: 'web', Key: f === 'index.html' ? f : 'static/' + f, Body: readFileSync(buildDir + '/' + f) }));
  }
  // 3. make sure nobody sees old content
  cf.send(new CreateInvalidationCommand({
    DistributionId: 'E123',
    InvalidationBatch: { CallerReference: 'deploy', Paths: { Quantity: 1, Items: ['/*'] } },
  }));
}`,
      },
      hints: [
        'Think about ordering: what does a user with old HTML need, and what does a user with new HTML need, during the deploy window?',
        'If asset names include a content hash, which paths actually need invalidating?',
        'Look closely at the invalidation call: is it awaited, and is CallerReference unique?',
      ],
      solution: {
        language: 'typescript',
        code: `import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand, waitUntilInvalidationCompleted } from '@aws-sdk/client-cloudfront';
import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const s3 = new S3Client({});
const cf = new CloudFrontClient({});
const DIST = process.env.CF_DISTRIBUTION_ID!;

export async function deploy(buildDir: string, releaseId: string): Promise<void> {
  const files = readdirSync(buildDir);
  const assets = files.filter((f) => f !== 'index.html'); // e.g. app.3f9a1c2b.js

  // 1) Upload hashed assets FIRST, with parallelism; old assets are NOT deleted
  //    (a lifecycle rule expires objects older than 30 days instead).
  await Promise.all(assets.map((f) => s3.send(new PutObjectCommand({
    Bucket: 'web', Key: 'static/' + f, Body: readFileSync(buildDir + '/' + f),
    CacheControl: 'public, max-age=31536000, immutable',
  }))));

  // 2) Only now publish the HTML that references them (short TTLs)
  await s3.send(new PutObjectCommand({
    Bucket: 'web', Key: 'index.html', Body: readFileSync(buildDir + '/index.html'),
    CacheControl: 'public, max-age=0, s-maxage=300, stale-while-revalidate=30',
    ContentType: 'text/html; charset=utf-8',
  }));

  // 3) Invalidate ONLY the HTML entry points — hashed assets never need purging
  const inv = await cf.send(new CreateInvalidationCommand({
    DistributionId: DIST,
    InvalidationBatch: {
      CallerReference: releaseId + '-' + randomUUID(), // unique, or CloudFront dedupes it
      Paths: { Quantity: 2, Items: ['/', '/index.html'] },
    },
  }));

  // 4) Fail the pipeline loudly if the purge does not complete
  await waitUntilInvalidationCompleted(
    { client: cf, maxWaitTime: 600 },
    { DistributionId: DIST, Id: inv.Invalidation!.Id! },
  );
}`,
      },
      explanation: `**Fixes**
- **Blank pages:** deleting old assets before uploading broke every browser/CDN holding old HTML. Assets are now additive; old ones expire via an S3 lifecycle rule days later.
- **Ordering:** assets upload before HTML, so new HTML never points at missing files (the old code uploaded \`index.html\` early in an alphabetical loop, before \`vendor.*.js\`).
- **Miss storm:** \`/*\` invalidated every object in every PoP → the post-deploy origin spike. With fingerprinted assets only the HTML entry points need invalidation.
- **Silent failure:** the invalidation promise was not awaited (unhandled rejection, script exits early) and a constant \`CallerReference\` makes CloudFront treat repeat requests as the same invalidation. Now unique, awaited, and the pipeline waits for completion.
- **Headers set at upload:** immutable 1-year TTL for assets, \`max-age=0, s-maxage=300\` for HTML so browsers always revalidate and the CDN copy is purgeable.
- **Throughput:** parallel uploads instead of a serial loop.`,
      followUps: [
        {
          "q": "The deploy now waits for invalidation, which takes 4-8 minutes. Product wants a one-click rollback in under 30 seconds. How?",
          "a": "Because hashed assets for the previous release are still in S3 and the CDN, a rollback is just re-publishing the previous index.html. Store each release's index.html under releases/<id>/index.html and make rollback copy it to index.html and invalidate only / and /index.html. To avoid waiting on invalidation entirely, give the HTML a very short s-maxage (30-60 s) or route HTML through an edge function that reads the current release ID from a KV pointer, so flipping the pointer switches everyone within seconds."
        },
        {
          "q": "Two engineers trigger deploys at the same time from different branches. What can go wrong, and how do you prevent it?",
          "a": "Both upload assets safely (hashed names don't collide), but the last index.html written wins, and it may be from the older build, so production silently runs the wrong release while both pipelines report success. Serialise deploys with a lock: CI concurrency groups (GitHub Actions concurrency: production), or a DynamoDB conditional write on a deploy lock. Also write index.html conditionally with an If-Match on the previous ETag or a release-number check, so an older build can't overwrite a newer one."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'cdn-global-iq-01',
      difficulty: 'hard',
      question:
        'Our app is hosted in us-east-1. Users in India complain it feels slow — p95 page load is 4.2 s vs 1.1 s in the US. Walk me through how you would diagnose and fix it.',
      whatInterviewerLooksFor: [
        'Decomposes latency (DNS, TCP, TLS, TTFB, transfer) using RUM data before proposing fixes',
        'Knows the physics: ~200 ms RTT India↔Virginia and that cold connections cost multiple RTTs',
        'Separates cacheable vs dynamic traffic and proposes different fixes for each',
        'Stages the solution by cost: edge first, then regional reads, then regional writes',
        'Mentions data residency implications of adding an India region',
      ],
      modelAnswer: `### 1. Measure, do not guess
Pull RUM (Navigation Timing) by country: DNS, connect, TLS, TTFB, content download, plus number of requests per page. A 3 s gap usually decomposes into **round trips × RTT**: India↔Virginia RTT is ~200 ms, and a page with 3 origins, cold TCP + TLS each, and a chatty waterfall of 10 serial API calls easily burns 15+ RTTs.

### 2. Put an edge in front of everything (days, cheap)
- CDN for static assets with fingerprinted URLs, \`immutable\`, 1-year TTL, Brotli → assets served from Mumbai/Chennai PoPs at ~10–20 ms.
- Route **API traffic through the CDN too** (uncacheable pass-through). TCP/TLS terminates at the PoP (~10 ms RTT); the PoP keeps warm multiplexed connections to origin, so each API call costs ~1 long-haul RTT instead of 3.
- HTTP/2 or HTTP/3 and TLS 1.3; consolidate domains to reuse connections.
- Typical result: 4.2 s → ~2 s.

### 3. Cache what is cacheable
Anonymous pages and catalog APIs with \`s-maxage\` + \`stale-while-revalidate\`, tag purges on change. Now many API calls are ~20 ms.

### 4. Fix the application waterfall
Batch serial calls (a BFF/GraphQL aggregation endpoint), preload critical requests. Each removed serial call saves ~200 ms for India.

### 5. Regional deployment (weeks, expensive)
If dynamic reads still dominate: app tier + read replicas in ap-south-1, reads served locally; writes still go to the US primary (~200 ms, acceptable for infrequent writes) with read-your-writes handling. If India becomes a major market or payment data is involved (RBI localisation), make India a **home region** for Indian users with its own writer.

### Trade-off summary
Edge + caching fixes ~70% of the gap at low cost; regional deployment fixes the rest but adds replication lag, consistency and on-call complexity.`,
      followUps: [
        {
          q: 'The CDN is in place but API p95 from India only improved 20%. Why might that be?',
          a: 'Likely the page makes many serial API calls, each still paying one ~200 ms long-haul RTT, or the CDN is not reusing origin connections (e.g. origin keep-alive disabled, or each request opens a new TLS session to origin). Also check whether requests actually route via an Indian PoP (resolver mis-location) and whether origin TTFB itself is high.',
        },
        {
          q: 'Would you enable TLS 0-RTT to save a round trip?',
          a: 'Only for idempotent, safe requests (GETs). 0-RTT early data can be replayed by an attacker, so non-idempotent POSTs must not be accepted as early data — most CDNs restrict it to GET/HEAD without query side effects.',
        },
        {
          q: 'How do you know the regional deployment was worth it?',
          a: 'Define a target (e.g. India p95 < 1.5 s) and conversion/retention metrics per region before building; A/B route a percentage of Indian users to the new region and compare RUM and business metrics.',
        },
      ],
      pitfalls: [
        'Jumping straight to "deploy a region in India" without measuring or trying the edge first',
        'Assuming the CDN only helps static files and ignoring connection termination for APIs',
        'Forgetting replication lag and read-your-writes once reads are served from a regional replica',
      ],
    },
    {
      id: 'cdn-global-iq-02',
      difficulty: 'expert',
      question:
        'Design the invalidation strategy for an e-commerce site with 20M product pages. Prices change ~50K times per hour, and a stale price shown for more than 30 seconds is a legal/compliance issue in some markets.',
      whatInterviewerLooksFor: [
        'Uses surrogate keys/tag purges driven by change events rather than TTLs alone',
        'Reasons about purge volume, batching, and provider rate limits',
        'Separates the price from the cacheable page (edge include / client fetch) when needed',
        'Handles purge failures and verifies freshness end-to-end',
        'Considers browser caches, which cannot be purged',
      ],
      modelAnswer: `### Constraints
50K price changes/hour ≈ 14/s average, bursty (sales can be 100×). 30 s staleness bound.

### Design
1. **Tag every response** with surrogate keys: \`product-{id}\`, \`category-{id}\`, \`brand-{id}\`. A product appears on its PDP, search results, category pages and API JSON — one tag purge covers them all.
2. **Event-driven purges:** the pricing service writes to Postgres → CDC (Debezium) → Kafka \`price.changed\` → a purger service. Purges derived from the log cannot be forgotten by a code path.
3. **Batch and debounce:** coalesce keys for ~500 ms and send batches (Fastly accepts up to 256 keys per request). 14/s becomes a couple of API calls per second; during a 1M-SKU flash sale, fall back to purging \`category-*\` tags or a "price-version" bump.
4. **Soft purge** (mark stale) with a short \`stale-while-revalidate\` to avoid origin stampedes — but cap SWR at a few seconds so the 30 s bound holds.
5. **Safety net TTL:** \`s-maxage=25\` on price-bearing responses, so even a lost purge self-heals within bound. Browser \`max-age=0\` (browser caches are unpurgeable).
6. **Decouple the price** for the heaviest pages: cache the PDP shell for hours and fetch price via a tiny, 5 s-TTL, highly cacheable \`/api/price/{id}\` endpoint (or an edge-side include). Now 99% of bytes are long-lived and only a tiny object churns.

### Verification
A synthetic prober samples recently changed SKUs from several PoPs and alerts if the served price differs from the DB for > 30 s. Track purge API error rate and consumer lag on the purger.

### Numbers
Origin load from price endpoint: 20M products, but only changed ones miss — 14 misses/s × ~50 PoPs via shield ≈ tens of origin req/s. Trivial.`,
      followUps: [
        {
          q: 'The purge provider has an outage. What happens?',
          a: 'The purger retries with backoff (purges are idempotent) and pages on lag; the s-maxage=25 safety net bounds staleness regardless. For extra safety, on sustained purge failure dynamically shorten TTLs via an edge config flag.',
        },
        {
          q: 'Why not just set a 10-second TTL on everything?',
          a: '20M pages × many PoPs revalidating every 10 s means most requests become misses/revalidations for long-tail pages, hit ratio collapses and origin load scales with traffic rather than with change rate. Event-driven purge makes origin load proportional to changes.',
        },
      ],
      pitfalls: [
        'Purging by URL and missing variants (query strings, locales, encodings)',
        'Relying only on purges with no TTL safety net',
        'Forgetting that the browser cache still holds the old price',
      ],
    },
    {
      id: 'cdn-global-iq-03',
      difficulty: 'hard',
      question:
        'Right after every major release, our origin falls over for about five minutes even though we have a CDN. Why, and how do you fix it?',
      whatInterviewerLooksFor: [
        'Identifies purge-all / new-URL miss storms across hundreds of PoPs',
        'Knows origin shield / tiered cache and request collapsing',
        'Proposes versioned assets and soft purge',
        'Mentions pre-warming and capacity/headroom for the origin',
      ],
      modelAnswer: `### Root cause
A release typically does one or both of: (a) purge everything (\`/*\`), or (b) ship new asset URLs. Either way every PoP (200–300 of them) misses simultaneously on popular objects. Without tiering, origin sees **PoPs × objects** requests in a few seconds — e.g. 250 PoPs × 400 hot objects = 100K requests hitting an origin sized for its normal 2–5% miss traffic. Uncacheable/personalised HTML that sets cookies also passes straight through.

### Fixes, in order of impact
1. **Stop purging assets.** Fingerprinted filenames + \`immutable\`; only HTML entry points get invalidated. New assets only miss once per PoP.
2. **Origin shield / tiered cache.** All PoPs fill via one shield PoP near origin → ~1 origin request per object instead of ~250.
3. **Request collapsing** at edge and shield (usually default for cacheable content — verify that responses are not marked uncacheable by stray \`Set-Cookie\` or \`Cache-Control: private\`).
4. **Soft purge** for HTML with \`stale-while-revalidate\`: users get old HTML for seconds while one refresh per PoP happens.
5. **Pre-warm** the shield: deploy step fetches the new asset manifest through the shield before switching HTML.
6. **Protect origin:** autoscaling will lag by minutes — keep headroom, enable load shedding and ensure the origin serves static files from object storage, not app servers.

### Expected result
Origin request spike goes from ~100K to a few hundred requests; no user-visible blip.`,
      followUps: [
        {
          q: 'Shield is enabled but origin still spikes. What do you check?',
          a: 'Cache status headers at shield: responses may be uncacheable (Set-Cookie, private, Vary: Cookie), the cache key may include a per-request param (cache-busting ?v=timestamp), or the shield region may not match the origin so multiple shields exist per region.',
        },
        {
          q: 'Does request collapsing help an authenticated GraphQL POST endpoint?',
          a: 'No. POSTs and private responses are not cached, so they are not collapsed. Protect those with origin capacity, rate limits, and server-side caching/batching (e.g. DataLoader, persisted queries with GET for cacheable operations).',
        },
      ],
      pitfalls: [
        'Saying "just add more origin servers" without addressing the miss storm',
        'Believing a CDN automatically collapses all requests including uncacheable ones',
        'Adding cache-busting query strings with timestamps on every deploy',
      ],
    },
    {
      id: 'cdn-global-iq-04',
      difficulty: 'expert',
      question:
        'Compare GeoDNS and Anycast for routing users to the nearest region. Which would you use for a global API with three regions, and how does failover work when a region dies?',
      whatInterviewerLooksFor: [
        'Understands DNS TTL limits and resolver vs user location (ECS)',
        'Understands Anycast via BGP and its coarse, path-based notion of "nearest"',
        'Proposes a layered design: Anycast edge + health-checked origin selection',
        'Discusses capacity headroom and retry storms during failover',
      ],
      modelAnswer: `### GeoDNS / latency-based DNS
- Authoritative DNS returns the region IP closest to the **resolver** (or the client subnet if EDNS Client Subnet is sent).
- Failover = DNS health check flips the record. Speed = health-check detection (~30 s) + TTL (30–60 s) + stragglers: resolvers, OSes and long-lived HTTP clients may keep old IPs for many minutes; keep-alive connections never re-resolve until they break.
- Pros: fine-grained policies (weights, geo-fencing for residency), no BGP expertise needed.

### Anycast
- The same IP prefix is announced from many locations; BGP delivers packets to the "closest" by AS-path, not measured latency.
- Failover: withdraw the announcement and traffic re-converges in seconds.
- Cons: running your own Anycast requires ASN/IP space and BGP operations; routing can be suboptimal (a user may land on a farther PoP due to peering). TCP flows can break on route changes (rare).

### What I would build for three regions
- **Anycast at the edge** via a CDN or AWS Global Accelerator / Cloudflare — users hit the nearest PoP in seconds, with one stable IP.
- Behind it, **origin selection by health + latency** (Global Accelerator endpoint groups with health checks, or CDN origin groups/load balancing). Region failover no longer depends on client DNS caches.
- **Residency constraints** override "nearest": EU-homed users must route to the EU region even from the US.

### When a region dies
1. Health checks fail (10 s interval × 3 = ~30 s); edge drains the region.
2. Remaining two regions go from ~33% to ~50% of traffic each — they must be provisioned for it (N+1), because autoscaling takes minutes.
3. Clients retry → load is briefly > 50%; retry budgets and load shedding on low-priority traffic prevent a cascade.
4. Stateful concerns (write ownership, replica promotion) follow the DR runbook.`,
      followUps: [
        {
          q: 'Why do some users keep hitting the dead region 20 minutes after the DNS change?',
          a: 'Clients or resolvers ignoring TTL, JVM/SDK DNS caches, and persistent keep-alive or HTTP/2 connections that never re-resolve. Anycast/edge-based routing avoids this because the client-facing IP never changes.',
        },
        {
          q: 'What stops a flapping health check from bouncing traffic between regions?',
          a: 'Hysteresis: require several consecutive failures to eject and several successes over a longer window to readmit, plus gradual traffic ramp-back (weighted 10% → 50% → 100%).',
        },
      ],
      pitfalls: [
        'Assuming a 60 s TTL means failover completes in 60 s',
        'Claiming Anycast routes by lowest latency',
        'Ignoring capacity headroom in surviving regions',
      ],
    },
    {
      id: 'cdn-global-iq-05',
      difficulty: 'hard',
      question:
        'Product reports that customers keep seeing an old banner for hours after marketing updated it, even though our CDN dashboard shows the purge succeeded. How do you debug this?',
      whatInterviewerLooksFor: [
        'Systematic layer-by-layer isolation: browser, service worker, CDN PoPs, shield, origin, replicas',
        'Uses Age / X-Cache / cache-status headers and curl from multiple locations',
        'Knows browser caches and service workers cannot be purged by the CDN',
        'Checks cache-key variants that URL purges miss',
      ],
      modelAnswer: `### Layer-by-layer isolation
1. **Reproduce with curl from multiple PoPs** (or a multi-location checker), inspecting \`Age\`, \`X-Cache\`/\`CF-Cache-Status\`, \`ETag\`, \`Last-Modified\`. If curl shows fresh content but users do not → client-side cache.
2. **Browser cache:** was the banner served with \`max-age=86400\`? No CDN purge reaches browsers. Fix: short browser TTL (\`max-age=60\`) with longer \`s-maxage\`, or version the banner URL.
3. **Service worker:** a PWA precache or cache-first strategy serves the old asset until the SW updates. Check the SW version and update flow.
4. **Cache-key variants:** the purge was for \`/img/banner.jpg\` but users requested \`/img/banner.jpg?w=1200\`, \`/img/banner.jpg\` with \`Accept: image/avif\` (a different variant), or a different hostname (www vs apex, a second CDN). URL purges miss these; tag purges or prefix purges catch them.
5. **Shield / multiple tiers:** some setups purge edge but a shield or a second CDN (multi-CDN) still holds the old copy and refills the edge.
6. **Origin itself stale:** origin reads from a lagging read replica or its own in-memory cache, so the CDN re-fetched the old image right after purging. Check origin directly, bypassing the CDN.
7. **Race:** purge fired before the new content was committed/uploaded (e.g. S3 upload after invalidation) → the CDN re-cached the old version.

### Structural fix
Marketing assets go through a pipeline that uploads with a **content-hashed URL** and updates the reference in the CMS; HTML uses tag purges from CMS publish events; browser TTLs are short for mutable URLs.`,
      followUps: [
        {
          q: 'How would you prevent the purge-before-upload race permanently?',
          a: 'Trigger purges from the storage/CMS commit event (e.g. S3 ObjectCreated → queue → purger, or CDC on the CMS table), not from the same script before the write is durable, and prefer versioned URLs so no purge is needed at all.',
        },
        {
          q: 'Multi-CDN setup: what changes?',
          a: 'Purges must fan out to every provider and be verified per provider; tag schemes differ (Surrogate-Key vs Cache-Tag), so abstract it behind a purger service with per-provider adapters and monitoring.',
        },
      ],
      pitfalls: [
        'Stopping at "the CDN says purge succeeded"',
        'Not knowing that browser caches and service workers are outside the CDN\'s control',
        'Ignoring origin-side staleness (replica lag, app caches)',
      ],
    },
    {
      id: 'cdn-global-iq-06',
      difficulty: 'expert',
      question:
        'We are expanding to the EU and India. Legal says EU personal data should stay in the EU and Indian payment data must be stored in India. How does this change our global architecture?',
      context: 'Current state: single region us-east-1, one Postgres cluster, a CDN, and a global analytics pipeline.',
      whatInterviewerLooksFor: [
        'Treats residency as a partition key (home region / cells)',
        'Designs a PII-free global directory for routing',
        'Classifies data: PII, payment, global reference, analytics',
        'Remembers logs, backups, CDN caches, and third-party vendors',
        'Considers cross-region user journeys (travel, account migration)',
      ],
      modelAnswer: `### Principle: residency is a sharding key
Each user gets a **home region** at signup (EU → eu-central-1, India → ap-south-1, rest → us-east-1). All of that user's PII and payment data lives only in the home region's stack (a "cell": app, DB, cache, queue).

### Routing
- A small **global directory** \`user_id → home_region\`, replicated to all regions, holding no PII (opaque ids only).
- Edge (CDN worker/gateway) reads the region from a signed claim in the JWT (set at login) and routes to the home region — no directory lookup per request. Users travelling abroad still land at their home region (a bit more latency, but compliant).
- Login/signup needs a lookup by email → hash the email (keyed HMAC) in the directory so no raw PII is global.

### Data classification
| Class | Placement |
|---|---|
| PII, KYC, payment instruments | Home region only |
| Catalog, pricing, config | Global, replicated everywhere |
| Analytics | Aggregated or pseudonymised in-region before export |
| Payment data (India) | Stored in India; per RBI, if processed abroad must be brought back and deleted abroad within 24 h |

### Easy-to-miss stores
- **Logs/traces:** scrub PII at source or run a regional observability stack.
- **Backups and DR:** EU DR region must also be in the EU (e.g. Frankfurt + Ireland); India DR within India (Mumbai + Hyderabad).
- **CDN:** personalised responses are \`private\`; consider regional TLS/caching controls.
- **Vendors:** email/SMS providers and support tools need DPAs and regional endpoints.

### Trade-offs
Cross-region features (a US seller viewing an EU buyer's order) need APIs that return only what is lawful, not DB-level joins. Operational cost goes up (three cells), but cells also shrink blast radius.`,
      followUps: [
        {
          q: 'A user moves from Germany to India permanently. What happens?',
          a: 'A controlled migration workflow: freeze writes for the user, copy data to the new region, verify, flip the directory entry and the JWT claim, delete from the old region after the legal retention check. It is rare, so a batch process is fine.',
        },
        {
          q: 'How does a global admin dashboard work?',
          a: 'It fans out queries to each regional API and aggregates only permitted fields, or reads from pseudonymised regional aggregates; admin access itself is logged and may be restricted by region.',
        },
      ],
      pitfalls: [
        'Replicating the full database to every region for "low latency"',
        'Putting emails/phone numbers in the global routing table',
        'Forgetting logs, backups and third-party SaaS tools',
      ],
    },
    {
      id: 'cdn-global-iq-07',
      difficulty: 'hard',
      question:
        'Your team wants to move request authentication and personalization to edge functions to cut latency. What would you move to the edge, what would you keep at origin, and why?',
      whatInterviewerLooksFor: [
        'Distinguishes stateless decisions from data-dependent logic',
        'Knows edge constraints: CPU limits, cold starts, eventually consistent KV',
        'Understands that edge + far database is slower than origin',
        'Mentions security aspects: key distribution, revocation',
      ],
      modelAnswer: `### Move to the edge (stateless, latency-sensitive, rejects early)
- **JWT verification** (signature, exp, aud) with public keys cached at the edge — invalid traffic never reaches origin. ~1 ms in a V8 isolate.
- **Routing decisions:** home region from a claim, canary/A-B bucketing via hash(user_id), geo redirects.
- **Cache-key normalisation** and device class detection.
- **Personalisation by composition:** cache the page shell publicly and stitch in small per-user fragments (name, cart count) fetched from a private API or from the JWT claims.
- Edge rate limiting and bot scoring.

### Keep at origin
- Anything needing strongly consistent data: balances, inventory, cart contents, entitlement checks that must reflect revocation immediately.
- Heavy computation (edge CPU budgets are tens of ms), big dependencies.
- Business logic needing transactions.

### Why not everything at the edge?
An edge function in Mumbai that makes 3 queries to Postgres in Virginia costs 3 × 200 ms = 600 ms — worse than running at origin once and paying one long-haul RTT. Edge KV stores are eventually consistent (Workers KV can take up to ~60 s to propagate), so they are unsuitable for session revocation or balances.

### Security considerations
- Stateless JWTs cannot be revoked instantly: short token TTL (5–15 min) plus a revocation list pushed to edge KV for high-risk cases.
- Key rotation: publish JWKS with \`kid\`, edge caches keys with a TTL and refreshes on unknown \`kid\`.
- Keep secrets (signing keys) out of edge code; edge only needs public keys.`,
      followUps: [
        {
          q: 'A user is banned. How fast can the edge reject them?',
          a: 'With stateless JWT only: at token expiry (e.g. 10 min). Faster requires pushing the banned id to edge KV (seconds to ~1 min propagation) or using a strongly consistent edge primitive (Durable Object) at extra latency, or checking at origin for sensitive operations.',
        },
        {
          q: 'How do you test and roll out edge code safely?',
          a: 'Version the worker, deploy to a percentage of traffic or specific PoPs, monitor error rate and origin fallbacks, and keep a kill switch that bypasses edge logic to origin.',
        },
      ],
      pitfalls: [
        'Putting database queries in the edge function and calling it an optimisation',
        'Assuming edge KV is strongly consistent',
        'Shipping private keys or secrets to edge code',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'cdn-global-boe-1',
      question:
        'A news site serves 30M page views/day. Each page view loads 1.8 MB of assets (images, JS, CSS). Estimate monthly egress and the origin bandwidth/cost saved by a CDN with a 95% byte hit ratio.',
      assumptions: [
        '30M page views/day, 1.8 MB per page view (after browser cache, ~60% of views are cold-ish)',
        'Effective bytes from network per view ≈ 1.8 MB × 0.6 ≈ 1.08 MB',
        'Peak traffic = 3× average',
        'Cloud internet egress ≈ $0.07/GB blended; CDN committed rate ≈ $0.02/GB',
        '30 days/month',
      ],
      steps: [
        { label: 'Daily bytes', calc: '30M × 1.08 MB ≈ 32.4 TB/day' },
        { label: 'Monthly bytes', calc: '32.4 TB × 30 ≈ 972 TB ≈ ~1 PB/month' },
        { label: 'Average bandwidth', calc: '32.4 TB ÷ 86,400 s ≈ 375 MB/s ≈ 3 Gbps; peak ×3 ≈ 9 Gbps' },
        { label: 'Origin egress without CDN', calc: '~1 PB × $0.07/GB ≈ 1,000,000 GB × $0.07 ≈ $70K/month' },
        { label: 'Origin egress with 95% byte hit ratio', calc: '5% × 1 PB = 50 TB → 50,000 GB × $0.07 ≈ $3.5K (often cheaper still: origin→CDN egress is discounted/free on some providers)' },
        { label: 'CDN cost', calc: '~1 PB × $0.02/GB ≈ $20K/month' },
        { label: 'Net', calc: '$70K vs $3.5K + $20K ≈ $23.5K → ~$46K/month saved, and origin peak drops from 9 Gbps to ~0.45 Gbps' },
      ],
      answer:
        '~1 PB/month, ~3 Gbps average / ~9 Gbps peak. A 95% byte-hit CDN cuts origin to ~50 TB/month and ~0.45 Gbps peak, saving roughly $45K/month versus serving from cloud egress directly.',
      insight:
        'Byte hit ratio, not request hit ratio, drives cost: a few uncached large images can dominate. Each extra point of byte hit ratio at this scale is ~10 TB/month of origin egress, so image fingerprinting, AVIF/WebP and origin shield pay for themselves quickly.',
      followUps: [
        {
          "q": "Your byte hit ratio drops from 95% to 85% because of a new video feature. Redo the origin numbers.",
          "a": "Origin bytes become 15% × 1 PB = 150 TB per month, three times more. At $0.07/GB that's about $10.5K instead of $3.5K, and origin peak bandwidth rises from 0.45 Gbps to about 1.35 Gbps. The CDN bill stays around $20K. Each lost point of byte hit ratio costs about 10 TB per month. Video usually needs chunked, long-TTL segments and a shield to get its own hit ratio up, so track byte hit ratio per content type to see which class is hurting."
        }
      ],
    },
    {
      id: 'cdn-global-boe-2',
      question:
        'After a purge-all, how many requests hit origin within the first minute, with and without an origin shield? 250 PoPs, 2,000 hot objects, 400K req/s globally.',
      assumptions: [
        '250 edge PoPs; traffic concentrated in ~150 busy PoPs that all request the hot set within the first minute',
        '2,000 hot objects account for ~90% of requests',
        'Request collapsing works per PoP (one fill per object per PoP)',
        'Origin normally sees ~2% of 400K = 8K req/s',
      ],
      steps: [
        { label: 'Fills without shield', calc: '150 busy PoPs × 2,000 objects = 300,000 origin requests' },
        { label: 'Arrival window', calc: 'Most hot objects are requested in the first ~10 s → ~30K req/s burst on top of 8K baseline ≈ 4–5× normal' },
        { label: 'Without collapsing (worst case)', calc: 'Concurrent requests per object per PoP during the fill (say 5) → 1.5M requests ≈ 150K req/s burst' },
        { label: 'With shield', calc: 'Edges fill from shield; shield collapses to 1 fill per object → ~2,000 origin requests' },
        { label: 'With shield, burst rate', calc: '2,000 over ~10 s ≈ 200 req/s extra — ~2.5% above baseline' },
      ],
      answer:
        'Without a shield: ~300K origin requests in the first minute (~30K req/s burst, 4–5× normal; much worse without collapsing). With a shield: ~2,000 requests — negligible.',
      insight:
        'Miss storms scale with PoP count × hot objects. Tiered caching makes origin load scale with hot objects only, which is why shield + soft purge are prerequisites for frequent deploys or purges.',
      followUps: [
        {
          "q": "The shield itself is a single region and its cache was also purged. Traffic is 10× (4M req/s). What does origin see now?",
          "a": "The shield still collapses to about one fill per object, so origin sees roughly 2,000 requests regardless of the 10× edge traffic; that's the point of tiered caching. What changes is the shield: 150 PoPs × 2,000 objects = 300,000 requests hit the shield in seconds, and while each object is being filled, concurrent edge requests queue behind the collapsed fill. The shield needs capacity for that burst, or use a soft purge (mark stale and serve while revalidating), which avoids the miss entirely."
        }
      ],
    },
    {
      id: 'cdn-global-boe-3',
      question:
        'We run active-active in 3 regions for 120K req/s peak. How much capacity must each region have to survive the loss of one region, and how does that compare to 2 regions?',
      assumptions: [
        'Traffic split evenly across regions at peak',
        'Each app pod handles 500 req/s at 60% CPU target utilisation',
        'Retry storm during failover adds 20% for the first few minutes',
        'Autoscaling takes ~5 minutes to add capacity, so headroom must be pre-provisioned',
      ],
      steps: [
        { label: 'Normal share (3 regions)', calc: '120K ÷ 3 = 40K req/s per region' },
        { label: 'After losing one region', calc: '120K ÷ 2 = 60K req/s per surviving region' },
        { label: 'With retry surge', calc: '60K × 1.2 = 72K req/s' },
        { label: 'Pods per region (3-region design)', calc: '72K ÷ 500 = 144 pods per region → 432 total' },
        { label: '2-region design', calc: 'Survivor takes 120K × 1.2 = 144K → 288 pods per region → 576 total' },
        { label: 'Overprovision factor', calc: '3 regions: 432 ÷ (120K÷500=240) = 1.8×; 2 regions: 576 ÷ 240 = 2.4×' },
      ],
      answer:
        'Each of 3 regions needs ~144 pods (capacity for ~72K req/s, i.e. 1.8× steady-state total). Two regions need ~288 pods each (2.4×). Three regions are ~25% cheaper for the same failure tolerance.',
      insight:
        'N+1 redundancy costs N/(N-1): more, smaller regions reduce idle headroom. Alternatively, accept load shedding of non-critical traffic during failover to shrink the headroom requirement.',
      followUps: [
        {
          "q": "One region is in a market that has 50% of all traffic, so traffic isn't even. How does that change the per-region capacity?",
          "a": "Say the split is 60K, 30K, 30K. If the big region dies, its 60K spreads over the other two (assuming routing allows it): each takes 30K + 30K = 60K, × 1.2 = 72K, same as before. But if a small region dies, the big region takes 60K + 15K = 75K, × 1.2 = 90K req/s, so it needs 180 pods. Size each region for its own share plus the worst-case spill it receives, and verify routing can actually shift the big market's traffic, since latency and data-residency rules may forbid it."
        }
      ],
    },
  ],
  test: [
    {
      id: 'cdn-global-mcq-01',
      difficulty: 'medium',
      question:
        'A response carries the header below. A user fetches it via the CDN, and 90 seconds later a second user in the same city fetches it. What happens on the second request?',
      code: {
        language: 'text',
        code: `Cache-Control: public, max-age=30, s-maxage=120
ETag: "p42-v7"`,
      },
      options: [
        'The CDN serves it from cache without contacting origin, because s-maxage=120 applies to shared caches',
        'The CDN revalidates with origin because max-age=30 has expired',
        'The CDN never caches it because max-age and s-maxage conflict',
        'The CDN serves it but also sends a background revalidation to origin',
      ],
      correct: [0],
      explanation:
        's-maxage overrides max-age for shared caches, so the CDN treats the object as fresh for 120 s and serves the 90 s-old copy directly. max-age=30 only governs browsers (and private caches). There is no conflict — this is the intended split-TTL pattern. A background revalidation would require stale-while-revalidate and only after the object becomes stale.',
      followUps: [
        {
          "q": "At 130 seconds a third user requests it. The CDN sends If-None-Match with \"p42-v7\" and the product hasn't changed. What does origin return, and what does each cache do with it?",
          "a": "Origin returns 304 Not Modified with no body, ideally echoing the Cache-Control header. The CDN refreshes its stored copy's freshness to another 120 s without re-downloading the body and serves the full cached response to the user with 200. The user's browser stores it with max-age=30. The cost to origin is one lightweight conditional request instead of a full render, which matters if the body is large. If origin had changed the ETag, it would return 200 with the new body and the CDN would replace its copy."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-02',
      difficulty: 'hard',
      question:
        'Your CDN hit ratio for product images dropped from 96% to 41% after a frontend release. Origin shield is enabled and TTLs did not change. Which is the MOST likely cause?',
      options: [
        'The release increased the image TTL, causing more revalidations',
        'The CDN provider reduced the number of PoPs in your region',
        'The images were converted from JPEG to WebP, which CDNs cannot cache',
        'The frontend began appending a per-session analytics query parameter to image URLs',
      ],
      correct: [3],
      explanation:
        'A per-session query parameter makes every URL a unique cache key, so almost every request misses — the classic cache-key explosion. PoP changes would not cause such a sudden, release-correlated drop. WebP is cacheable like any other content type. A longer TTL would raise, not lower, the hit ratio. Fix by stripping or ignoring that parameter in the cache key.',
      followUps: [
        {
          "q": "You can't change the frontend for two weeks. How do you restore the hit ratio from the CDN side, and how do you keep the analytics team happy?",
          "a": "Configure the cache key to ignore that parameter: in CloudFront, a cache policy with a query-string allowlist (only width, format and other real variant params); in Fastly, strip it in vcl_recv; in Cloudflare, a cache rule with query-string exclusions. Hit ratio returns to around 96% within one TTL. The parameter still reaches the CDN logs, so analytics can read it from edge logs (real-time log streaming) rather than from origin. Verify with the CDN's cache-status header and the hit ratio dashboard per path prefix."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-03',
      difficulty: 'expert',
      question:
        'Your origin is fully down for 10 minutes. Which of these responses will users still receive successfully from the CDN (assuming they were cached 5 minutes before the outage)? Select ALL that apply.',
      options: [
        '"Cache-Control: public, max-age=600" — requested at minute 3 of the outage',
        '"Cache-Control: public, max-age=60, stale-if-error=3600" — requested at minute 8',
        '"Cache-Control: public, max-age=60, stale-while-revalidate=30" — requested at minute 8',
        '"Cache-Control: private, max-age=3600" — requested at minute 2',
        '"Cache-Control: no-cache" with an ETag — requested at minute 1',
      ],
      correct: [0, 1],
      explanation:
        'Option A was cached 5 min before the outage with a 10 min TTL, so at minute 3 of the outage (8 min old) it is still fresh. Option B is long stale but stale-if-error allows serving it for up to an hour when origin errors. Option C is outside its 30 s SWR window (it has been stale for ~12 minutes) and SWR does not cover errors by itself. Private responses are never stored by the CDN, and no-cache requires successful revalidation with origin before use (some CDNs have override settings, but not by default).',
      followUps: [
        {
          "q": "The outage lasts 3 hours instead of 10 minutes. Which of the cached responses still work, and what would you change in the headers to survive that?",
          "a": "Option A expired after 10 minutes of age, so it fails once origin stays down. Option B's stale-if-error=3600 runs out after about an hour of staleness. Nothing survives 3 hours. For anonymous content that can be slightly stale, set stale-if-error=86400 (24 h) via CDN-Cache-Control so only the CDN honours it, and make sure the CDN is configured to treat 5xx and connection timeouts as errors. Also note that objects evicted from a PoP for low popularity can't be served at all, so an origin shield with a large cache helps."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-04',
      difficulty: 'hard',
      question:
        'You deploy a new SPA version. Users report blank screens for about 10 minutes, with 404s on JavaScript files. The deploy script is shown. What is the root cause?',
      code: {
        language: 'bash',
        code: `aws s3 sync ./dist s3://web --delete          # upload new build, remove old files
aws cloudfront create-invalidation --distribution-id E1 --paths '/index.html'
# index.html: Cache-Control: public, max-age=600
# assets:     app.[hash].js, Cache-Control: public, max-age=31536000, immutable`,
      },
      options: [
        'The invalidation should have been /* so the hashed JS files were also refreshed',
        '--delete removed old hashed assets while browsers still hold the old index.html for up to 600 s',
        'immutable prevents CloudFront from fetching the new JS files',
        'CloudFront invalidations take up to 10 minutes, during which no files are served',
      ],
      correct: [1],
      explanation:
        'Browsers (and any intermediary) may keep the old index.html for 600 s because max-age applies to them and no CDN invalidation reaches browsers. That old HTML references old hashed assets, which --delete removed from the origin, so any edge miss returns 404. Invalidating /* would not help — the old files no longer exist. immutable only affects client revalidation. Invalidations do not stop the CDN from serving. Fix: keep old assets for days and use max-age=0 with s-maxage for HTML.',
      followUps: [
        {
          "q": "Some customers' corporate proxies ignore max-age=0 and cache index.html for a day. How do you keep those users from breaking after a deploy?",
          "a": "Keep old hashed assets around far longer than any plausible cached HTML, for example 30 days via an S3 lifecycle rule instead of deleting on deploy. Then even a day-old index.html still loads a coherent old version. Add a version check in the app: the SPA polls a tiny /version.json (no-store) and prompts a reload when it differs. And handle chunk-load failures in the client router by doing a hard reload once, so a missing lazy chunk becomes a refresh rather than a blank screen."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-05',
      difficulty: 'expert',
      question:
        'You fail over api.example.com from us-east-1 to eu-west-1 by changing a Route 53 record with TTL 60. After 15 minutes, 18% of traffic still reaches us-east-1. Which explanations are plausible? Select ALL that apply.',
      options: [
        'Long-lived HTTP/2 and keep-alive connections from clients and partner servers do not re-resolve DNS while the connection stays open',
        'Some client runtimes and resolvers cache DNS longer than the TTL',
        'Route 53 needs 15+ minutes to propagate record changes to its authoritative servers',
        'Mobile apps with an in-app DNS cache or pinned IPs keep using the old address',
        'Anycast routing is sending the traffic to the nearest region regardless of DNS',
      ],
      correct: [0, 1, 3],
      explanation:
        'Persistent connections never trigger a new DNS lookup, some resolvers/runtimes (historically the JVM with a security manager) ignore or extend TTLs, and mobile apps with their own DNS caching or pinned IPs keep using the old endpoint. Route 53 propagates changes to its authoritative servers typically within about 60 seconds, not 15 minutes. Anycast is not involved in a plain DNS-routed setup. The fix is to also drain the old region (close connections, return 421/503 with retry) or front it with an Anycast edge.',
      followUps: [
        {
          "q": "Next time you need the failover to complete in under 60 seconds for all clients, including partners with long-lived connections. What do you change?",
          "a": "Stop depending on DNS for failover. Put the API behind an Anycast edge or global load balancer (Cloudflare, AWS Global Accelerator, GCP global LB) with one stable IP; the edge health-checks regions and shifts traffic in seconds while client connections terminate at the edge. For the drain, make the old region actively close connections: send HTTP/2 GOAWAY and set Connection: close, or return 503 with Retry-After so clients reconnect. Test it in game days and measure time-to-zero traffic on the old region."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-06',
      difficulty: 'hard',
      question:
        'A GraphQL API is placed behind a CDN. All operations are sent as POST /graphql. The team expects the CDN to cache popular read queries like product listings. What should they do?',
      options: [
        'Nothing; CDNs cache POST responses automatically when the body is identical',
        'Add Cache-Control: public to all GraphQL responses, including mutations',
        'Use persisted queries sent as GET with a query hash and variables in the URL, and return Cache-Control per operation',
        'Set Vary: Content-Type so the CDN can distinguish query bodies',
      ],
      correct: [2],
      explanation:
        'CDNs generally do not cache POSTs (the body is not part of the default cache key and POST is not a cacheable method in practice). Persisted queries over GET put a stable hash and variables in the URL, giving a clean cache key, and the server can emit per-operation Cache-Control (using the most restrictive field hint). Marking all responses public would cache mutations and personalised data. Vary on Content-Type does not incorporate the body.',
      followUps: [
        {
          "q": "A persisted product-listing query includes the user's loyalty tier in its response. How do you keep it cacheable without leaking tier-specific prices?",
          "a": "Don't let user identity leak into a public cache key. Either split the operation: a public cached listing plus a small private query for tier-specific prices, merged on the client. Or make the tier an explicit variable or a normalised header (X-Tier: gold) that the CDN includes in the cache key, so there are a handful of variants rather than one per user. The server must emit Cache-Control: private when any field resolves per user, which Apollo's cache-control hints do automatically using the most restrictive scope."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-07',
      difficulty: 'expert',
      question:
        'What will this origin code cause when deployed behind a CDN that honours Vary?',
      code: {
        language: 'typescript',
        code: `app.get('/products/:id', async (req, res) => {
  const p = await repo.find(req.params.id);
  res.set('Cache-Control', 'public, s-maxage=600');
  res.set('Vary', 'Accept-Encoding, Accept-Language, User-Agent');
  res.cookie('seen', Date.now().toString());      // analytics
  res.json(p);
});`,
      },
      options: [
        'Excellent hit ratio: s-maxage=600 keeps each product cached for 10 minutes',
        'Near-zero hit ratio: Vary on User-Agent fragments the cache, and Set-Cookie commonly makes the response uncacheable at the CDN',
        'The CDN will cache the Set-Cookie header and give every user the same cookie, but hit ratio stays high',
        'Only Accept-Language is a problem; User-Agent is normalised by all CDNs',
      ],
      correct: [1],
      explanation:
        'User-Agent has thousands of distinct values, so each product has thousands of variants and most requests miss. Additionally, many CDNs by default refuse to cache responses carrying Set-Cookie (CloudFront and Fastly have specific behaviours; Cloudflare bypasses by default) precisely to avoid distributing one user\'s cookie. Option C describes the danger if the CDN did cache it, which is why that default exists. CDNs do not normalise User-Agent for you.',
      followUps: [
        {
          "q": "You remove User-Agent from Vary and move the cookie to JavaScript. Hit ratio rises to 70%, not 95%. What else would you check?",
          "a": "Accept-Language is still in Vary with hundreds of raw values (en-US,en;q=0.9 and many permutations), so normalise it at the edge to the few languages you actually serve and vary on that header instead. Check Accept-Encoding normalisation too (most CDNs reduce it to gzip/br). Then look at the cache key itself: query parameters (utm_*, fbclid) creating unique keys, and inconsistent URL casing or trailing slashes. Finally, check whether 10-minute s-maxage is short relative to request frequency for long-tail products."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-08',
      difficulty: 'medium',
      question:
        'You ship a 30 GB game patch to 8M players at a fixed launch time. Which CDN strategy best protects your storage origin?',
      options: [
        'Pure pull CDN with a 1-hour TTL; the first player per PoP warms it',
        'Use a short TTL so each PoP refreshes the patch frequently',
        'Serve directly from object storage with signed URLs to avoid CDN costs',
        'Pre-position/pre-warm the patch chunks in the CDN (push or pre-fetch through the shield) before launch, with chunked URLs',
      ],
      correct: [3],
      explanation:
        'Large, predictable content with a known launch time is the textbook push/pre-warm case. A pure pull CDN would have every PoP miss simultaneously at launch, stampeding the origin with multi-GB fetches. Serving from object storage directly moves petabytes of egress to origin at higher cost and latency. Short TTLs increase revalidation traffic for immutable content.',
      followUps: [
        {
          "q": "A critical bug is found in the patch 20 minutes after launch, and a fixed build is ready. How do you replace it without a second origin stampede?",
          "a": "Publish the fix under new chunk URLs (content-hashed or a new version path) rather than overwriting the old ones, and pre-warm the new chunks through the shield exactly as before. Then update the small manifest that tells clients which chunks to fetch, which is the only file you need to purge. Chunk-level hashing means only changed chunks are new, so if the fix touches 2 GB of the 30 GB, players download and the CDN pre-warms just those 2 GB. Old chunks stay cached for clients mid-download."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-09',
      difficulty: 'expert',
      question:
        'A Cloudflare Worker checks whether a session is revoked before forwarding. Security complains that revoked sessions keep working for up to a minute. Why?',
      code: {
        language: 'typescript',
        code: `export default {
  async fetch(req: Request, env: { REVOKED: KVNamespace }) {
    const sid = getSessionId(req);
    if (await env.REVOKED.get('sid:' + sid)) return new Response('revoked', { status: 401 });
    return fetch(req);
  },
};
// Revocation API (origin) writes: await REVOKED.put('sid:' + sid, '1')`,
      },
      options: [
        'The Worker is cached by the CDN, so it only runs once per minute',
        'Workers KV is eventually consistent; writes can take up to ~60 s to be visible in other PoPs, and reads are cached at the edge',
        'KV get() is asynchronous and the Worker returns before it resolves',
        'The revocation key lacks a TTL, so KV ignores it until expiration is set',
      ],
      correct: [1],
      explanation:
        'Workers KV is optimised for read-heavy, eventually consistent workloads: a write becomes visible globally within about 60 s, and PoPs cache values. For immediate revocation you need a strongly consistent primitive (a Durable Object, origin check) or short token lifetimes. The code correctly awaits get(); Worker execution is not cached; KV keys do not require TTLs.',
      followUps: [
        {
          "q": "Security wants revoked sessions blocked within 2 seconds globally, but the KV read path must stay fast. Design it.",
          "a": "Use short-lived access tokens (for example 5 minutes) verified statelessly at the edge, and handle revocation for the remaining window with a strongly consistent store. A Durable Object holding the revocation set gives strong consistency but adds a round trip to its location. A common hybrid: check KV for speed, and for sensitive routes (payments, admin) also consult the Durable Object or origin. On revocation, also bump a per-user token version so the next refresh fails. Measure with a synthetic test that revokes and probes from several PoPs."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-10',
      difficulty: 'hard',
      question:
        'You run active-active in two regions at 55% CPU each at peak. One region fails. What is the most likely outcome if autoscaling takes 6 minutes?',
      options: [
        'The CDN absorbs all the extra load because API traffic passes through it',
        'The surviving region runs at ~55% because DNS spreads load gradually',
        'Nothing noticeable; active-active means each region is sized for 100%',
        'The surviving region runs at ~110% demand plus retries, saturates, and latency/error rates spike until autoscaling or shedding kicks in',
      ],
      correct: [3],
      explanation:
        'Two regions at 55% means the survivor must handle ~110% of its capacity, plus a retry surge — it saturates before autoscaling reacts. Active-active does not automatically mean each region is sized for full load; that must be provisioned deliberately. DNS shifting does not reduce total load. The CDN only absorbs cacheable traffic, not dynamic API calls.',
      followUps: [
        {
          "q": "Finance won't pay to run both regions at 45% CPU. What can you do so a region loss doesn't become a full outage?",
          "a": "Plan to degrade instead of over-provision. Classify traffic into priority tiers (checkout and login first; recommendations, search suggestions and analytics last) and add load shedding at the gateway that drops low tiers when CPU or queue depth crosses a threshold. Set client retry budgets with jittered backoff so the surge doesn't add 20%. Keep warm-pool or pre-scaled capacity that can start in under a minute, and scale the survivor on region-failure signals rather than waiting for CPU metrics."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-11',
      difficulty: 'expert',
      question:
        'An EU fintech uses a global CDN in front of its account dashboard API. Which configurations risk violating EU data-residency commitments? Select ALL that apply.',
      options: [
        'Account API responses sent with "Cache-Control: public, s-maxage=30" so they are cached at whichever PoP serves the user, including US PoPs for travelling users',
        'CDN access logs containing IPs and user ids shipped to a US-hosted log analytics vendor without a transfer mechanism',
        'Static JS bundles cached at all global PoPs',
        'TLS terminated at global PoPs with request bodies containing PII inspected by an edge WAF outside the EU, when the contract promises EU-only processing',
      ],
      correct: [0, 1, 3],
      explanation:
        'Caching personal account data publicly stores it at arbitrary PoPs worldwide (and risks cross-user leaks). Logs with IPs and user ids are personal data, so exporting them is a transfer. TLS termination and WAF inspection outside the EU is processing outside the EU, which breaks an EU-only processing commitment — regional CDN controls exist for this. Static JS bundles contain no personal data, so global caching is fine.',
      followUps: [
        {
          "q": "Legal also asks you to prove that EU account responses are never cached outside the EU. How do you verify and monitor that?",
          "a": "First make it structural: account API responses are private, no-store so no PoP stores them, and use the CDN's regional services (EU-only PoPs and processing) for those hostnames. Then verify: the CDN's logs include the PoP code for every request, so run a daily query that alerts on any account-API request served from a non-EU PoP, and on any response with a cache-status of HIT for those paths. Add a synthetic check from a US vantage point asserting the request routes to an EU location or is blocked."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-12',
      difficulty: 'hard',
      question:
        'Why does putting an uncacheable, dynamic API behind a CDN still reduce latency for users 10,000 km from the origin?',
      options: [
        'The CDN compresses JSON better than the origin, reducing transfer time significantly',
        'The CDN caches the API responses anyway for a few milliseconds',
        'TCP and TLS handshakes complete at a nearby PoP, and the PoP reuses warm, long-lived connections to origin, removing handshake round trips from the long-haul path',
        'CDN backbones make light travel faster than on the public internet',
      ],
      correct: [2],
      explanation:
        'The main gain is connection termination: handshakes happen over a ~10 ms RTT to the PoP, and the PoP keeps pooled connections to origin so each request crosses the long-haul link once. Backbones can reduce path length and loss, but they do not change the speed of light. Uncacheable responses are not micro-cached unless explicitly configured. Compression helps a little but is not the primary effect.',
      followUps: [
        {
          "q": "Origin to PoP RTT is 200 ms. How many round trips does a fresh user's first API call save with edge TLS termination, and what's the latency difference?",
          "a": "Without the edge, a cold call needs TCP (1 RTT) plus TLS 1.3 (1 RTT) plus the request (1 RTT): about 3 × 200 = 600 ms plus server time. With the PoP 10 ms away, TCP and TLS cost about 20 ms locally, and the request rides an already-open connection from PoP to origin: one long-haul RTT, 200 ms. Total about 220 ms versus 600 ms. With TLS 1.2 (2 RTTs for TLS) the saving is larger. Subsequent requests on the same connection save less, which is why the gain is biggest for mobile users with frequent new connections."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-13',
      difficulty: 'expert',
      question:
        'Your origin returns the ETag computed below. Behind a load balancer with 6 origin nodes, the CDN\'s revalidations almost never get a 304 (well under 1%) instead of the expected ~95%. Why?',
      code: {
        language: 'typescript',
        code: `// each node builds the JSON and hashes it
const body = JSON.stringify({ ...product, servedBy: os.hostname(), renderedAt: Date.now() });
const etag = '"' + createHash('md5').update(body).digest('hex') + '"';
res.set('ETag', etag);
if (req.headers['if-none-match'] === etag) return res.status(304).end();
res.send(body);`,
      },
      options: [
        'MD5 is too weak for ETags; CDNs reject MD5-based validators',
        'The body includes per-node and per-request fields, so the ETag changes on every render; so it effectively never matches a previously issued ETag',
        'The CDN sends If-Modified-Since, not If-None-Match, so ETags are ignored',
        'ETags must be prefixed with W/ to work with multiple origin nodes',
      ],
      correct: [1],
      explanation:
        'Including hostname and timestamp in the hashed body makes each response unique, so revalidations essentially never match and every revalidation downloads the full body. Derive ETags from a stable version (id + updated_at or a version column). MD5 is acceptable for ETags (not security-sensitive). CDNs send If-None-Match when an ETag is present. Weak ETags do not fix non-determinism.',
      followUps: [
        {
          "q": "You fix the ETag to use id plus updated_at. Origin still renders the full JSON before checking If-None-Match. What does that cost, and how do you avoid it?",
          "a": "The 304 saves bandwidth but not CPU or DB time: every revalidation still loads and serialises the product. Check the precondition first: fetch only the version (SELECT updated_at FROM products WHERE id = $1, or the version from a cache), compute the ETag, and return 304 before loading relations or rendering. For hot products this turns revalidation into one indexed lookup. Also make sure compression middleware doesn't rewrite the ETag, since some add a -gzip suffix that breaks matching across nodes."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-14',
      difficulty: 'medium',
      question:
        'Which choice best describes how GeoDNS and Anycast decide where a user is routed?',
      options: [
        'GeoDNS uses the resolver\'s (or ECS client subnet\'s) location to choose an IP; Anycast uses one IP and BGP path selection picks the nearest announcing location',
        'GeoDNS uses BGP to pick the lowest-latency region; Anycast uses DNS TTLs to shift users',
        'Both measure real-time latency from each user to each region and choose the lowest',
        'GeoDNS routes by the user\'s GPS location; Anycast routes by the user\'s ISP billing address',
      ],
      correct: [0],
      explanation:
        'GeoDNS is a DNS-layer decision based on the resolver IP (or EDNS Client Subnet), bounded by TTL. Anycast announces the same prefix from many locations, and BGP picks based on routing policy/AS path — not measured latency. Neither uses GPS, and neither measures per-user real-time latency by default (latency-based DNS uses aggregated measurements per resolver network).',
      followUps: [
        {
          "q": "Users on a public resolver like 8.8.8.8 in India are being sent to your Singapore region instead of Mumbai. Why, and what fixes it?",
          "a": "GeoDNS sees the resolver's address, not the user's. Public resolvers use Anycast and may answer from a node whose location differs from the user's, and the ISP-to-resolver path can cross borders. If your DNS provider supports EDNS Client Subnet, the resolver passes a truncated user subnet (Google does send ECS) and your GeoDNS can map it correctly; check that ECS is enabled on your authoritative side. Alternatively use latency-based routing with real-user measurements, or Anycast so BGP picks the nearby edge regardless of resolver."
        }
      ],
    },
    {
      id: 'cdn-global-mcq-15',
      difficulty: 'expert',
      question:
        'You want product pages cached at the CDN for 1 hour but browsers to always get a reasonably fresh copy, and you must be able to fix a pricing error globally within 30 seconds. Which combination achieves this? Select ALL that apply.',
      options: [
        'Browser header Cache-Control: max-age=0, with CDN-Cache-Control (or s-maxage) set to 3600',
        'Tag each page with a surrogate key per product and purge the tag on price change',
        'Cache-Control: public, max-age=3600, immutable on product pages',
        'Rely on stale-while-revalidate=3600 so users eventually see the new price',
        'Keep old product pages in the CDN and rename product URLs whenever prices change',
      ],
      correct: [0, 1],
      explanation:
        'Split TTLs keep browsers revalidating (so they never hold an unpurgeable stale copy) while the CDN keeps a long-lived purgeable copy; tag purges then remove every page containing the product within seconds. max-age=3600, immutable pins stale copies in browsers where no purge can reach. A 1-hour SWR window allows serving stale prices for up to an hour. Renaming product URLs breaks SEO, links and bookmarks — versioned URLs suit assets, not canonical pages.',
      followUps: [
        {
          "q": "The surrogate-key purge API returns 200, but a support agent in Brazil still sees the old price 2 minutes later. How do you debug?",
          "a": "Fetch the page from that region with debug headers (X-Cache, Age, the surrogate-key header and served-by PoP) to see which layer holds the stale copy. If Age is under 2 minutes, the CDN purged correctly and refilled from a stale source: the origin's own cache, a shield that wasn't purged, or a read replica behind it. If Age is large, the page was missing the product's tag (for example a related-products widget not tagged), or the purge targeted a different service or environment. If it's the browser, max-age wasn't 0."
        }
      ],
    },
  ],
};

export default topic;
